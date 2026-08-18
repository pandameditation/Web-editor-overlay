import { BLOCK_STYLE_ID } from './constants.js';
import { evaluateModule } from './lit-bridge.js';
import { allPresets } from './presets.js';
import { renderBlockTemplate, sanitizeFragment } from './sanitize.js';
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
    const tag = element.tag.toLowerCase();
    if (!tag.includes('-')) {
      throw new Error(`"${tag}" is not a valid custom element name: it needs a hyphen.`);
    }
    if (this.#registered.has(tag) || customElements.get(tag)) {
      this.#registered.add(tag);
      return;
    }
    const source = element.module ?? element.script;
    if (!source) return;
    await evaluateModule(source);
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
export function blockFromSource(input: {
  name: string;
  kind: BlockKind;
  html?: string;
  css?: string;
  script?: string;
  tag?: string;
  description?: string;
  category?: string;
}): LibraryBlock {
  const id = slugify(input.name) || `block-${Date.now().toString(36)}`;
  const tag = input.tag?.trim().toLowerCase();
  const hasElement = Boolean(tag && input.script?.trim());

  const html = hasElement
    ? `<${tag}></${tag}>`
    : (input.html?.trim() ?? '<div>New block</div>');

  return {
    id,
    name: input.name.trim() || 'Untitled block',
    kind: input.kind,
    category: input.category?.trim() || (input.kind === 'container' ? 'Layout' : 'Components'),
    description: input.description?.trim(),
    html,
    css: input.css?.trim() || undefined,
    slots: input.kind === 'container',
    origin: 'user',
    element: hasElement ? { tag: tag!, module: input.script!.trim() } : undefined,
  };
}

export { BLOCK_STYLE_ID };
