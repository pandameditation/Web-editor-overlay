import { BLOCK_STYLE_ID } from './constants.js';
import { evaluateModule } from './lit-bridge.js';
import { allPresets } from './presets.js';
import { renameTemplateProp, renderBlockTemplate, sanitizeFragment, templatePropNames } from './sanitize.js';
import { ManagedStyleSheet } from './stylesheet.js';
import type { BlockKind, LibraryBlock, PropSpec } from './types.js';

/**
 * The block library.
 *
 * Holds containers and components, instantiates them with prop values, and — for
 * blocks that ship a custom element — registers that element before inserting
 * its tag. Block CSS accumulates in one managed stylesheet, written once per
 * block rather than per instance.
 */
export class BlockLibrary {
  #blocks = new Map<string, LibraryBlock>();
  #sheet = new ManagedStyleSheet(BLOCK_STYLE_ID);
  #injectedCSS = new Map<string, string>();
  #registered = new Set<string>();
  #listeners = new Set<() => void>();

  constructor(options: { presets?: boolean } = {}) {
    if (options.presets !== false) {
      for (const block of allPresets()) this.#blocks.set(block.id, block);
    }
  }

  list(kind?: BlockKind): LibraryBlock[] {
    const all = [...this.#blocks.values()];
    return kind ? all.filter((block) => block.kind === kind) : all;
  }

  /** Blocks bucketed by category, in insertion order. */
  grouped(kind?: BlockKind): Array<{ category: string; blocks: LibraryBlock[] }> {
    const buckets = new Map<string, LibraryBlock[]>();
    for (const block of this.list(kind)) {
      const category = block.category ?? (block.kind === 'container' ? 'Layout' : 'Components');
      const bucket = buckets.get(category);
      if (bucket) bucket.push(block);
      else buckets.set(category, [block]);
    }
    return [...buckets.entries()].map(([category, blocks]) => ({ category, blocks }));
  }

  get(id: string): LibraryBlock | undefined {
    return this.#blocks.get(id);
  }

  /**
   * An id derived from `base` that is not already taken.
   *
   * Extracting a block called "Card" must not silently replace the built-in card
   * preset, which is what a bare slug would do.
   */
  uniqueId(base: string): string {
    const root = slugify(base) || 'block';
    if (!this.#blocks.has(root)) return root;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${root}-${n}`;
      if (!this.#blocks.has(candidate)) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  search(query: string): LibraryBlock[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.list();
    return this.list().filter((block) =>
      `${block.name} ${block.description ?? ''} ${block.category ?? ''}`.toLowerCase().includes(needle),
    );
  }

  upsert(block: LibraryBlock): LibraryBlock {
    const id = slugify(block.id || block.name);
    if (!id) throw new Error('A block needs an id or a name.');
    const next: LibraryBlock = { ...block, id, origin: block.origin ?? 'user' };
    this.#blocks.set(id, next);
    // The CSS may have changed, so allow it to be re-injected.
    this.#injectedCSS.delete(id);
    this.#notify();
    return next;
  }

  remove(id: string): LibraryBlock | undefined {
    const block = this.#blocks.get(id);
    if (!block) return undefined;
    this.#blocks.delete(id);
    this.#injectedCSS.delete(id);
    this.#writeCSS();
    this.#notify();
    return block;
  }

  import(blocks: LibraryBlock[], options: { overwrite?: boolean } = {}): number {
    let count = 0;
    for (const block of blocks) {
      const id = slugify(block.id || block.name);
      if (!id) continue;
      if (!options.overwrite && this.#blocks.has(id)) continue;
      this.#blocks.set(id, { ...block, id, origin: block.origin ?? 'imported' });
      count += 1;
    }
    this.#notify();
    return count;
  }

  /** Only blocks worth carrying between projects: presets are rebuilt anyway. */
  export(): LibraryBlock[] {
    return this.list().filter((block) => block.origin !== 'preset');
  }

  /** Default prop values for the insert form. */
  defaultProps(block: LibraryBlock): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, spec] of Object.entries(block.props ?? {})) {
      out[name] = String(spec.default ?? firstOption(spec) ?? '');
    }
    return out;
  }

  /**
   * Build the nodes for a block.
   *
   * Registering the custom element is awaited before the markup is parsed, so
   * the element upgrades immediately rather than rendering as an unknown tag and
   * flashing empty.
   */
  async instantiate(
    block: LibraryBlock,
    props: Record<string, unknown> = {},
  ): Promise<{ nodes: HTMLElement[]; html: string }> {
    if (block.element) await this.registerElement(block);
    this.#applyCSS(block);

    const values = { ...this.defaultProps(block), ...props };
    const html = renderBlockTemplate(block.html, values, block.props ?? {});
    const fragment = sanitizeFragment(html);
    const nodes = Array.from(fragment.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    return { nodes, html };
  }

  /** Define the block's custom element, once per tag per page. */
  async registerElement(block: LibraryBlock): Promise<void> {
    const element = block.element;
    if (!element?.tag) return;
    // Normalising here as well as at authoring time means a block that arrived
    // through an import or a config object cannot smuggle in an invalid tag.
    const tag = normalizeCustomElementTag(element.tag);
    if (!tag) {
      throw new Error(
        `"${element.tag}" cannot be used as a custom element name. Use lowercase letters, ` +
        'numbers and at least one hyphen, for example my-widget.',
      );
    }
    if (this.#registered.has(tag) || customElements.get(tag)) {
      this.#registered.add(tag);
      return;
    }

    const raw = element.tag.trim();
    let source = element.module ?? element.script;
    if (!source) return;
    // The tag was corrected; the module still names the original. Carry the
    // correction into the source so `define` agrees with the tag being inserted.
    if (raw && raw !== tag) source = retagSource(source, raw, tag);

    try {
      await evaluateModule(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`<${tag}> could not be registered: ${message}`);
    }
    if (!customElements.get(tag)) {
      throw new Error(
        `The module ran but did not define <${tag}>. Check that it calls customElements.define('${tag}', ...).`,
      );
    }
    this.#registered.add(tag);
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The CSS the library has injected so far, for the save prompt. */
  get css(): string {
    return this.#sheet.css;
  }

  destroy(): void {
    this.#sheet.destroy();
    this.#injectedCSS.clear();
    this.#listeners.clear();
  }

  #applyCSS(block: LibraryBlock): void {
    if (!block.css || this.#injectedCSS.has(block.id)) return;
    this.#injectedCSS.set(block.id, block.css);
    this.#writeCSS();
  }

  #writeCSS(): void {
    const parts = [...this.#injectedCSS.entries()].map(
      ([id, css]) => `/* block: ${id} */\n${css}`,
    );
    this.#sheet.write(parts.join('\n\n'));
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[html-editor-overlay] library listener failed', error);
      }
    }
  }
}

function firstOption(spec: PropSpec): string | undefined {
  const option = spec.options?.[0];
  if (option == null) return undefined;
  return typeof option === 'object' ? String(option.value ?? option.label) : String(option);
}

export function slugify(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a block definition from raw user input in the library panel.
 *
 * The four inputs map onto one block: HTML becomes the template, CSS is injected
 * once, and a JS/Lit module plus tag name turns the block into a real custom
 * element whose tag is what actually gets inserted.
 */
/**
 * One `{{placeholder}}` in a block's markup, and what the author decided about it.
 *
 * Lives here rather than in the panel that renders it because two entry points now
 * author blocks — the library and "save as reusable block" — and they have to reach
 * the same conclusions from the same markup.
 */
export interface BlockPropRow {
  /** The name as it currently appears in the markup, which renaming rewrites. */
  placeholder: string;
  name: string;
  type: PropSpec['type'];
  label: string;
  description: string;
  default: string;
}

export const PROP_TYPES = ['text', 'number', 'color', 'select', 'url', 'boolean', 'token'] as const;

/**
 * Propose a row per placeholder, keeping whatever the block already declared.
 *
 * Matched by name, so revisiting a block does not discard the descriptions written
 * last time. Names absent from the markup are dropped: they are props nothing can
 * ever fill.
 */
export function blockPropRows(
  html: string,
  existing?: Record<string, PropSpec>,
): BlockPropRow[] {
  return templatePropNames(html).map((placeholder) => {
    const spec = existing?.[placeholder];
    return {
      placeholder,
      name: placeholder,
      type: spec?.type ?? inferPropType(placeholder),
      label: spec?.label ?? humanisePropName(placeholder),
      description: spec?.description ?? '',
      default: spec?.default === undefined ? '' : String(spec.default),
    };
  });
}

/**
 * Turn reviewed rows into declared props, rewriting the markup for any rename.
 *
 * Renaming has to reach the template or the two drift apart, leaving a prop the
 * insert form offers and the markup never substitutes. Returns an error message
 * instead of throwing, because the caller's job is to show it next to the field.
 */
export function applyBlockProps(
  html: string,
  rows: readonly BlockPropRow[],
): { html: string; props: Record<string, PropSpec>; error?: string } {
  let out = html;
  const props: Record<string, PropSpec> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) {
      return { html, props: {}, error: `Give {{${row.placeholder}}} a name, or remove it from the markup.` };
    }
    if (!/^[A-Za-z][\w-]*$/.test(name)) {
      return {
        html,
        props: {},
        error: `"${name}" cannot be a prop name: start with a letter, then letters, digits, - or _.`,
      };
    }
    if (props[name]) {
      return { html, props: {}, error: `Two props are called ${name}. Names have to be unique.` };
    }
    if (name !== row.placeholder) out = renameTemplateProp(out, row.placeholder, name);
    // A label still matching what the placeholder produced was never chosen, so it
    // follows the rename. One the author set is left alone.
    const untouched = !row.label.trim() || row.label.trim() === humanisePropName(row.placeholder);
    props[name] = {
      type: row.type,
      label: untouched ? humanisePropName(name) : row.label.trim(),
      ...(row.description.trim() ? { description: row.description.trim() } : {}),
      ...(row.default.trim() ? { default: row.default.trim() } : {}),
    };
  }
  return { html: out, props };
}

/**
 * A first guess at a prop's type, from what it is called.
 *
 * By word, not by substring: `ctaHref` has to read as a URL, which an anchored test
 * misses, while a loose substring test would call `iconColour` a URL. The order is
 * the tie-breaker — `linkColour` is a colour first. Wrong sometimes, and cheap to
 * correct from the control beside it; the point is that a colour prop arrives as a
 * colour picker rather than a text box.
 */
export function inferPropType(name: string): PropSpec['type'] {
  const words = name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const has = (...candidates: string[]): boolean => words.some((word) => candidates.includes(word));

  if (has('color', 'colour', 'background', 'bg', 'fill', 'stroke', 'tint', 'accent')) return 'color';
  if (has('href', 'url', 'link', 'src', 'image', 'img', 'logo', 'icon', 'avatar', 'poster')) {
    return 'url';
  }
  if (has('count', 'size', 'width', 'height', 'index', 'qty', 'quantity', 'amount', 'level',
    'columns', 'rows', 'total', 'max', 'min')) {
    return 'number';
  }
  if (words.length > 1 && has('is', 'has', 'show', 'hide', 'enable', 'disable', 'with')) {
    return 'boolean';
  }
  if (has('spacing', 'space', 'gap', 'radius', 'shadow', 'font')) return 'token';
  return 'text';
}

/** `ctaLabel` → `Cta label`. A starting point for the insert form's field label. */
export function humanisePropName(name: string): string {
  const spaced = name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function blockFromSource(input: {
  name: string;
  kind: BlockKind;
  html?: string;
  css?: string;
  script?: string;
  tag?: string;
  description?: string;
  category?: string;
  /** Supply to update an existing block instead of deriving a new id. */
  id?: string;
}): LibraryBlock {
  const id = input.id ?? slugify(input.name) ?? '';
  const resolvedId = id || `block-${Date.now().toString(36)}`;
  const tag = normalizeCustomElementTag(input.tag ?? '');
  const hasElement = Boolean(tag && input.script?.trim());

  const html = hasElement
    ? `<${tag}></${tag}>`
    : (input.html?.trim() ?? '<div>New block</div>');

  return {
    id: resolvedId,
    name: input.name.trim() || 'Untitled block',
    kind: input.kind,
    category: input.category?.trim() || (input.kind === 'container' ? 'Layout' : 'Components'),
    description: input.description?.trim(),
    html,
    css: input.css?.trim() || undefined,
    slots: input.kind === 'container',
    origin: 'user',
    element: hasElement ? { tag, module: input.script!.trim() } : undefined,
  };
}

/**
 * Coerce anything the user types into a valid custom element name.
 *
 * The spec's `PotentialCustomElementName` is far more permissive than people
 * expect — `my-foo@ter` is legal — which means an accidental character sails past
 * `customElements.define` and only fails later, somewhere unrelated, with a
 * message about an illegal character. Restricting to a conservative subset makes
 * such a name impossible to create in the first place.
 *
 * Two corrections are applied: illegal characters are dropped, and a name with no
 * hyphen gets one, splitting on a camelCase boundary or a common prefix so
 * `myFooter` and `myfooter` both become `my-footer`.
 */
export function normalizeCustomElementTag(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  // Split camelCase before lowercasing, while the boundary is still visible.
  let name = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  // A custom element name must start with an ASCII lowercase letter.
  name = name.replace(/^[^a-z]+/, '');
  if (!name) return '';

  if (!name.includes('-')) {
    const prefix = COMMON_PREFIXES.find(
      (candidate) => name.startsWith(candidate) && name.length > candidate.length,
    );
    name = prefix ? `${prefix}-${name.slice(prefix.length)}` : `${name}-block`;
  }

  if (RESERVED_TAGS.has(name)) name = `${name}-block`;
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(name) ? name : '';
}

/**
 * Rename a tag inside module source.
 *
 * Only quoted occurrences and actual tag usages are touched, so a variable or a
 * comment that happens to contain the same letters is left alone.
 */
function retagSource(source: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source
    .replace(new RegExp(`(['"\`])${escaped}\\1`, 'g'), `$1${to}$1`)
    .replace(new RegExp(`</?${escaped}(?=[\\s/>])`, 'g'), (match) =>
      match.replace(from, to),
    );
}

/** Prefixes people actually use, so `myfooter` splits where they meant it to. */
const COMMON_PREFIXES = [
  'my',
  'app',
  'site',
  'page',
  'ui',
  'the',
  'our',
  'web',
  'heo',
  'demo',
  'custom',
];

/** Names the HTML spec reserves and `customElements.define` rejects. */
const RESERVED_TAGS = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);

export { BLOCK_STYLE_ID };
