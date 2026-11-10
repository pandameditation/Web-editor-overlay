import { BLOCK_ATTR, BLOCK_PART_ATTR, BLOCK_STYLE_ID } from './constants.js';
import { scopeBlockCSS } from './block-css.js';
import { allPresets } from './presets.js';
import { renameTemplateProps, renderBlockTemplate, sanitizeFragment, templatePropNames } from './sanitize.js';
import { ManagedStyleSheet } from './stylesheet.js';
import type { BlockKind, LibraryBlock, PropSpec } from './types.js';

/**
 * The block library.
 *
 * Holds containers and components and instantiates them with prop values. A block is
 * an HTML template plus optional CSS. Block CSS accumulates in one managed stylesheet,
 * written once per block rather than per instance.
 */
export class BlockLibrary {
  #blocks = new Map<string, LibraryBlock>();
  #sheet = new ManagedStyleSheet(BLOCK_STYLE_ID);
  #injectedCSS = new Map<string, string>();
  /** Names of blocks that have CSS here, library entry or not: what a notice calls a pasted copy. */
  #names = new Map<string, string>();
  /** Ids whose CSS is scoped as captured CSS (renamed keyframes and fonts, root mapping). */
  #captured = new Set<string>();
  /**
   * Already-scoped chunks of a claimed saved sheet whose block the library does not know.
   *
   * A capture pasted "insert only" is not a library block, so a page that also carries a seed
   * regenerated its saved sheet from library blocks alone and the instance lost its styles on
   * the next library write. These are carried through verbatim while the page still has an
   * element of that block.
   */
  #foreignChunks = new Map<string, string>();
  #listeners = new Set<() => void>();
  /** Names of legacy web component blocks skipped by `import`, until `takeDroppedLegacy`. */
  #droppedLegacy: string[] = [];

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
  uniqueId(base: string, taken?: (id: string) => boolean): string {
    // `taken` widens what counts as used: a capture pasted "insert only" is never in the
    // library, yet its id still owns a CSS chunk and elements on the page.
    const used = (id: string): boolean => this.#blocks.has(id) || Boolean(taken?.(id));
    const root = slugify(base) || 'block';
    if (!used(root)) return root;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${root}-${n}`;
      if (!used(candidate)) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  /**
   * A block's source CSS as the page is using it, library block or insert-only paste; undefined
   * when this library never wrote CSS for the id (a saved chunk carried through for a block it
   * does not know has no source to edit).
   */
  sourceCSS(id: string): string | undefined {
    if (this.#injectedCSS.has(id)) return this.#injectedCSS.get(id);
    return this.#blocks.has(id) ? this.#blocks.get(id)?.css ?? '' : undefined;
  }

  /** The block's name: its library entry's, or the one it was inserted under. */
  nameOf(id: string): string | undefined {
    return this.#blocks.get(id)?.name ?? this.#names.get(id);
  }

  /** Whether the id's CSS is scoped as a capture's (keyframes and fonts renamed). */
  isCaptured(id: string): boolean {
    return this.#captured.has(id) || this.#blocks.get(id)?.origin === 'captured';
  }

  /**
   * Replace a block's source CSS and re-scope it: its library entry when it has one, and the CSS
   * every instance on the page is drawn with either way.
   */
  setSourceCSS(id: string, css: string): void {
    const block = this.#blocks.get(id);
    if (block) this.#blocks.set(id, { ...block, css: css.trim() ? css : undefined });
    if (this.#injectedCSS.has(id) || block) this.#injectedCSS.set(id, css);
    this.#writeCSS();
    this.#notify();
  }

  /** Whether this id has a CSS slot in the managed sheet, library block or not. */
  hasCSS(id: string): boolean {
    return this.#injectedCSS.has(id) || this.#foreignChunks.has(id);
  }

  search(query: string): LibraryBlock[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.list();
    return this.list().filter((block) =>
      `${block.name} ${block.description ?? ''} ${block.category ?? ''}`.toLowerCase().includes(needle),
    );
  }

  upsert(block: LibraryBlock): LibraryBlock {
    if (isLegacyElementBlock(block)) throw new Error(LEGACY_BLOCK_MESSAGE);
    const id = slugify(block.id || block.name);
    if (!id) throw new Error('A block needs an id or a name.');
    const next: LibraryBlock = { ...block, id, origin: block.origin ?? 'user' };
    this.#blocks.set(id, next);
    this.#noteOrigin(next);
    // The CSS may have changed, so allow it to be re-injected. If this block was already
    // used on the page, rewrite its existing slot immediately rather than waiting for a
    // later instance to make the edit visible.
    if (this.#injectedCSS.has(id)) this.#injectedCSS.set(id, next.css ?? '');
    this.#writeCSS();
    this.#notify();
    return next;
  }

  remove(id: string): LibraryBlock | undefined {
    const block = this.#blocks.get(id);
    if (!block) return undefined;
    this.#blocks.delete(id);
    this.#injectedCSS.delete(id);
    this.#captured.delete(id);
    this.#writeCSS();
    this.#notify();
    return block;
  }

  import(blocks: LibraryBlock[], options: { overwrite?: boolean } = {}): number {
    let count = 0;
    for (const block of blocks) {
      // Web component blocks are gone. An old seed or import may still carry one; it is
      // skipped rather than kept as an entry that would insert an empty unknown element.
      if (isLegacyElementBlock(block)) {
        this.#droppedLegacy.push(String(block.name || block.id || 'unnamed block'));
        continue;
      }
      let id = slugify(block.id || block.name);
      if (!id) continue;
      if (!options.overwrite && this.#blocks.has(id)) {
        /*
         * A taken id means "already here" for authored blocks, which share ids on purpose across
         * pages. A capture is different: every capture is a new component, and seeds from the
         * extension's first build all carried the id `captured`, so after one import every later
         * capture was skipped as a duplicate. A captured block is skipped only when it really is
         * the same one; otherwise it comes in under an id of its own.
         */
        const captured = block.origin === 'captured' || Boolean(block.capture);
        if (!captured) continue;
        const same = [...this.#blocks.values()].some((existing) =>
          existing.html === block.html && (existing.css ?? '') === (block.css ?? ''));
        if (same) continue;
        id = this.uniqueId(block.name || id, (candidate) => this.hasCSS(candidate));
      }
      const next: LibraryBlock = { ...block, id, origin: block.origin ?? 'imported' };
      this.#blocks.set(id, next);
      this.#noteOrigin(next);
      count += 1;
    }
    this.#notify();
    return count;
  }

  /** Names of the legacy blocks `import` skipped since the last call, de-duplicated. */
  takeDroppedLegacy(): string[] {
    const names = [...new Set(this.#droppedLegacy)];
    this.#droppedLegacy = [];
    return names;
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
   * Async for its callers' sake: they await it, and keeping the signature avoids touching
   * every one of them now that nothing here has to wait.
   */
  async instantiate(
    block: LibraryBlock,
    props: Record<string, unknown> = {},
  ): Promise<{ nodes: HTMLElement[]; html: string }> {
    this.#applyCSS(block);

    const values = { ...this.defaultProps(block), ...props };
    const html = renderBlockTemplate(block.html, values, block.props ?? {});
    const fragment = sanitizeFragment(html);
    const nodes = Array.from(fragment.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    return { nodes, html };
  }

  /**
   * Ensure this block has a managed stylesheet slot without rendering an instance.
   *
   * Restored pages already contain the markup, so calling `instantiate` would create a duplicate
   * tree. Hydration needs the CSS side effect alone, including an empty slot for a later upsert.
   */
  ensureCSS(block: LibraryBlock): void {
    this.#applyCSS(block);
  }

  /**
   * The markup this block would produce for these values, without producing it.
   *
   * `instantiate` is what builds an instance, and it has a side effect by design — it writes
   * CSS into the page. That makes it the wrong tool for the one question a caller asks far
   * more often than "give me one of these": *is the element on the page still what this block
   * says?* Answering that by instantiating would inject stylesheets as a side effect of
   * looking, and it would have to be awaited, which a render pass cannot do.
   *
   * So this is the same substitution with nothing else attached: synchronous, inert, and
   * comparable against `cleanMarkup` of a live element once both have been through a DOM
   * round trip.
   */
  expand(block: LibraryBlock, props: Record<string, string> = {}): string {
    const values = { ...this.defaultProps(block), ...props };
    return renderBlockTemplate(block.html, values, block.props ?? {});
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Take over a saved `#heo-block-styles` element before the page's CSS is scanned.
   *
   * Only meaningful when the page carries a seed: then every block whose CSS that element
   * holds is about to be loaded, and the library's first write regenerates it in place.
   */
  claimSavedStyle(): void {
    // Read before claiming: the first write replaces the text, and with it any chunk for a
    // block this library will never load (see #foreignChunks).
    const saved = document.getElementById(BLOCK_STYLE_ID)?.textContent ?? '';
    if (!this.#sheet.claimExisting()) return;
    for (const [id, css] of savedBlockChunks(saved)) this.#foreignChunks.set(id, css);
  }

  /** The CSS the library has injected so far, for the save prompt. */
  get css(): string {
    return this.#sheet.css;
  }

  destroy(): void {
    this.#sheet.destroy();
    this.#injectedCSS.clear();
    this.#names.clear();
    this.#captured.clear();
    this.#foreignChunks.clear();
    this.#listeners.clear();
  }

  #noteOrigin(block: LibraryBlock): void {
    if (block.origin === 'captured') this.#captured.add(block.id);
    else this.#captured.delete(block.id);
  }

  #applyCSS(block: LibraryBlock): void {
    if (this.#injectedCSS.has(block.id)) return;
    // Insert-only captures reach here without ever being upserted.
    if (block.origin === 'captured') this.#captured.add(block.id);
    // Keep an empty slot too: a block first used without CSS can gain styles later,
    // and the next upsert must then have a managed slot to rewrite.
    const css = block.css ?? '';
    this.#injectedCSS.set(block.id, css);
    if (block.name) this.#names.set(block.id, block.name);
    // An empty slot changes nothing in the joined sheet. Writing anyway would turn the first
    // CSS-less instance met during hydration into write(''), removing the claimed saved style.
    if (css.trim()) this.#writeCSS();
  }

  #writeCSS(): void {
    const parts = [...this.#injectedCSS.entries()]
      .filter(([, css]) => css.trim())
      .map(([id, css]) => `/* block: ${id} */\n${scopeBlockCSS(css, id, { captured: this.#captured.has(id) })}`);
    /*
     * Saved chunks for blocks the library does not know, carried through verbatim (they are
     * already scoped) while an element of that block is still on the page. The library's own
     * chunk wins once the id is known, so a later upsert is never shadowed by a stale copy.
     */
    for (const [id, css] of this.#foreignChunks) {
      if (this.#injectedCSS.has(id) || this.#blocks.has(id)) {
        this.#foreignChunks.delete(id);
        continue;
      }
      if (!blockIdInPage(id)) continue;
      parts.push(`/* block: ${id} */\n${css}`);
    }
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

/** The per-block chunks of a managed block sheet's text (each under a "block: id" comment), by id. */
function savedBlockChunks(text: string): Map<string, string> {
  const chunks = new Map<string, string>();
  // Indentation allowed: a saved page may be pretty-printed, which indents the sheet's text.
  const header = /^[ \t]*\/\* block: (.+?) \*\/[ \t]*$/gm;
  const found = [...text.matchAll(header)];
  found.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < found.length ? (found[index + 1].index ?? text.length) : text.length;
    const css = text.slice(start, end).trim();
    if (css) chunks.set(match[1], css);
  });
  return chunks;
}

/** Whether an element of this block is still on the page. */
function blockIdInPage(id: string): boolean {
  const value = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return Boolean(document.querySelector(`[${BLOCK_ATTR}="${value}"], [${BLOCK_PART_ATTR}="${value}"]`));
}

function firstOption(spec: PropSpec): string | undefined {
  const option = spec.options?.[0];
  if (option == null) return undefined;
  return typeof option === 'object' ? String(option.value ?? option.label) : String(option);
}

/* -------------------------------------------------------------------------- */
/* Bringing a template change to a block already on the page                   */
/* -------------------------------------------------------------------------- */

/** Tags that cannot hold content, so there is never anything to carry into one. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * The template's markup, carrying the words already on the page.
 *
 * A placed block is two things at once, and updating it has to respect both. Its *structure*
 * belongs to the template — the tags, the classes, the wrapper somebody added in the library
 * last week. Its *words* belong to the page: they were typed into this copy, they are different
 * in every copy, and they are the entire reason there are nine cards rather than one.
 *
 * Re-rendering the template and swapping the element out gets the first and destroys the
 * second, which makes "apply to all" a feature nobody can afford to use — the markup fix
 * arrives and the nine headings become nine copies of the placeholder. So the template is the
 * skeleton and the page is the content, and this is where they are put back together.
 *
 * The rule, in order:
 *
 * - Where the template has a leaf, the page's content for it goes in whole, markup included,
 *   so a word somebody emphasised or a link they added comes across with its sentence.
 * - Where the template has structure, children are paired by tag and then by position — the
 *   second `<p>` to the second `<p>`, and a heading the template retagged to the heading it
 *   used to be — and each pair is merged the same way.
 * - Where the template has something the page has no counterpart for, the template's own
 *   content stays. That is what makes a newly added tag arrive with something in it rather
 *   than arriving empty, and it is why the guarantee holds in the direction that matters:
 *   nothing the template fills comes out blank.
 *
 * Attributes are the template's throughout. A template edit is an edit to markup, and taking
 * half of it would leave the page in a state neither side ever described.
 */
export function mergeInstanceText(template: HTMLElement, instance: HTMLElement): HTMLElement {
  const merged = template.cloneNode(true) as HTMLElement;
  carryWords(merged, instance);
  return merged;
}

function carryWords(target: HTMLElement, source: HTMLElement): void {
  if (VOID_TAGS.has(target.tagName.toLowerCase())) return;

  const slots = elementChildren(target);
  /*
   * A leaf in the template is a place for words, and all of the page's words go into it.
   *
   * `innerHTML` rather than `textContent`, because what is here is not necessarily plain: the
   * user may have bolded a phrase or linked a name, and that is part of what they wrote.
   */
  if (!slots.length) {
    if (hasWords(source)) target.innerHTML = source.innerHTML;
    return;
  }

  // Text sitting between the children, paired in the order it appears.
  const donorText = textChildren(source);
  const targetText = textChildren(target);
  for (let i = 0; i < targetText.length && i < donorText.length; i += 1) {
    if (!written(donorText[i].nodeValue)) continue;
    targetText[i].nodeValue = donorText[i].nodeValue;
  }

  const donors = elementChildren(source);

  /*
   * The template has wrapped what used to be bare text.
   *
   * The one case where the pairing below has nothing to work with and the words would simply
   * be dropped: the page holds a sentence and nothing else, and the template now holds
   * structure with no room for text at the top level. Putting the sentence in the first place
   * the template can hold one is the answer that keeps it, and the situation is narrow enough
   * to be sure that is where it was meant to go.
   */
  if (!targetText.length && !donors.length && hasWords(source)) {
    const leaf = firstLeaf(target);
    if (leaf) leaf.innerHTML = source.innerHTML;
    return;
  }

  /*
   * Same tag first, in order, each donor used once. Then whatever is left over by position,
   * which is what carries a heading's words through the template retagging it.
   */
  const taken = new Set<HTMLElement>();
  const pairs = new Map<HTMLElement, HTMLElement>();
  for (const slot of slots) {
    const match = donors.find((donor) => !taken.has(donor) && donor.tagName === slot.tagName);
    if (!match) continue;
    taken.add(match);
    pairs.set(slot, match);
  }
  slots.forEach((slot, index) => {
    if (pairs.has(slot)) return;
    const candidate = donors[index];
    if (!candidate || taken.has(candidate)) return;
    taken.add(candidate);
    pairs.set(slot, candidate);
  });

  for (const [slot, donor] of pairs) carryWords(slot, donor);
}

function elementChildren(el: Element): HTMLElement[] {
  return Array.from(el.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function textChildren(el: Element): Text[] {
  return Array.from(el.childNodes).filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE,
  );
}

/** The first descendant that can hold words, for text the template has moved inwards. */
function firstLeaf(el: HTMLElement): HTMLElement | null {
  for (const child of elementChildren(el)) {
    if (VOID_TAGS.has(child.tagName.toLowerCase())) continue;
    if (!elementChildren(child).length) return child;
    const deeper = firstLeaf(child);
    if (deeper) return deeper;
  }
  return null;
}

/** Whether there is anything here a reader would call words. */
function hasWords(el: Element): boolean {
  return written(el.textContent);
}

function written(value: string | null): boolean {
  return Boolean(value && value.trim());
}

export function slugify(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

/** What a prop name has to look like: it is written between `{{` and `}}` in the markup. */
const PROP_NAME = /^[A-Za-z][\w-]*$/;

/**
 * Why a prop name cannot be used, or null when it can.
 *
 * Shared by the dialog, which shows it under the field as the name is typed, and by
 * `applyBlockProps`, which refuses to save with it — so the two can never disagree about what
 * counts as a valid name. `others` are the names every other prop ends up with.
 */
export function propNameProblem(name: string, others: readonly string[] = []): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give it a name.';
  if (!PROP_NAME.test(trimmed)) return 'Use letters, digits, - or _, starting with a letter — no spaces.';
  if (others.some((other) => other.trim() === trimmed)) return `Another prop is already called ${trimmed}.`;
  return null;
}

/** The nearest usable prop name to what was typed: `Card title` becomes `cardTitle`. */
export function suggestPropName(text: string): string {
  const words = String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9_-]+/)
    .filter(Boolean);
  const camel = words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
  return camel.replace(/^[^A-Za-z]+/, '');
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
  const names = rows.map((row) => row.name.trim());
  for (const [index, row] of rows.entries()) {
    const problem = propNameProblem(row.name, names.filter((_, other) => other !== index));
    if (problem) {
      const suggestion = suggestPropName(row.name);
      const hint = suggestion && suggestion !== row.name.trim() && !names.includes(suggestion) ? ` Try ${suggestion}.` : '';
      return { html, props: {}, error: `{{${row.placeholder}}}: ${problem}${hint}` };
    }
  }

  const renames = new Map<string, string>();
  const props: Record<string, PropSpec> = {};
  for (const [index, row] of rows.entries()) {
    const name = names[index];
    if (name !== row.placeholder) renames.set(row.placeholder, name);
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
  return { html: renames.size ? renameTemplateProps(html, renames) : html, props };
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

/**
 * Build a block definition from raw user input in the block dialog.
 *
 * HTML becomes the template and CSS is injected once, scoped to the block's instances.
 */
export function blockFromSource(input: {
  name: string;
  kind: BlockKind;
  html?: string;
  css?: string;
  description?: string;
  category?: string;
  /** Supply to update an existing block instead of deriving a new id. */
  id?: string;
}): LibraryBlock {
  const id = input.id ?? slugify(input.name) ?? '';
  const resolvedId = id || `block-${Date.now().toString(36)}`;
  const html = input.html?.trim() || '<div>New block</div>';

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
  };
}

/** What legacy blocks are refused with: blocks are HTML and CSS only now. */
export const LEGACY_BLOCK_MESSAGE =
  'Web component blocks are no longer supported; this block has an element definition.';

/**
 * A block from an earlier version that defined a custom element.
 *
 * Read off the untyped record: `LibraryBlock` no longer declares `element`, but stored data may.
 */
export function isLegacyElementBlock(block: unknown): boolean {
  return block != null && (block as { element?: unknown }).element != null;
}

export { BLOCK_STYLE_ID };
