import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { acceptsChildren, labelFor } from '../../core/dom.js';
import { formatHTML } from '../../core/sanitize.js';
import { blockFromSource, normalizeCustomElementTag } from '../../core/library.js';
import type { InsertPosition } from '../../core/mutations.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { BlockKind, LibraryBlock } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { PropForm } from './prop-form.js';
import '../controls/code-editor.js';
import '../controls/section.js';
import '../controls/segmented.js';

const openSections = new Set<string>(['blocks']);

/**
 * The block library.
 *
 * Containers and components in one place because the distinction only matters at
 * insert time: a container is something you put things inside, a component is
 * something you configure. Both insert relative to the current selection, and a
 * block with props opens a form first so what lands on the page is already
 * configured.
 *
 * The author form is the interesting half. Paste HTML for a static block, or give
 * a tag name plus a module and the block registers a real custom element and
 * inserts that tag — which is how a Lit component gets into a page that has no
 * build step.
 */
@customElement('heo-library-panel')
export class HeoLibraryPanel extends HeoElement {
  static override styles = [
    baseStyles,
    PropForm.styles,
    css`
      :host {
        display: block;
        padding-bottom: 16px;
      }

      .top {
        display: grid;
        gap: 7px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .search {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .search input {
        flex: 1 1 auto;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
      }
      .search input:focus {
        outline: none;
      }
      .target {
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .target code {
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
      }

      .group {
        padding: 10px 12px 4px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
        gap: 7px;
        padding: 0 12px;
      }
      .card {
        display: grid;
        gap: 6px;
        padding: 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-raised);
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
        transition:
          border-color var(--heo-fast),
          background var(--heo-fast),
          transform var(--heo-fast);
      }
      .card:hover {
        border-color: var(--heo-accent-line);
        background: var(--heo-hover);
        transform: translateY(-1px);
      }
      .card .glyph {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 1px solid var(--heo-line);
        border-radius: 8px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
      }
      .card .name {
        font-size: 11.5px;
        font-weight: 550;
        line-height: 1.3;
      }
      .card .desc {
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .card .foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 5px;
      }
      .card .kind {
        color: var(--heo-text-faint);
        font-size: 9px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .card .kill {
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
        padding: 0;
      }
      .card .kill:hover {
        color: var(--heo-danger);
        background: var(--heo-line-strong);
      }

      .configure {
        margin: 10px 12px 0;
        padding: 10px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-sunken);
      }
      .configure header {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 9px;
      }
      .configure header .n {
        flex: 1 1 auto;
        font-size: 12px;
        font-weight: 550;
      }
      .configure .actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 10px;
      }

      .author {
        display: grid;
        gap: 8px;
      }
      .author .two {
        display: grid;
        grid-template-columns: 1fr 108px;
        gap: 6px;
      }
      .tabs {
        display: flex;
        gap: 2px;
        margin-bottom: 2px;
      }
      .tabs button {
        height: 24px;
        padding: 0 9px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        font-size: 11px;
        cursor: pointer;
      }
      .tabs button:hover {
        color: var(--heo-text);
        background: var(--heo-hover);
      }
      .tabs button[aria-selected='true'] {
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }

      .editing-banner {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 6px 8px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-accent-soft);
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .editing-banner span {
        flex: 1 1 auto;
      }
      .save-error {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 0;
        color: var(--heo-danger);
        font-size: 11px;
        line-height: 1.45;
      }
      .tagfix {
        margin: 0;
        color: var(--heo-warn);
      }
      .card .foot .kill + .kill {
        margin-left: 2px;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.registry, s.insertAnchor] as const,
    shallowArrayEquals,
  );

  @state() private query = '';
  @state() private kind: BlockKind | 'all' = 'all';
  @state() private position: InsertPosition = 'after';
  @state() private configuring: LibraryBlock | null = null;
  @state() private props: Record<string, string> = {};
  @state() private sourceTab: 'html' | 'css' | 'js' = 'html';

  /**
   * The authoring buffer.
   *
   * `id` is null for a new block and set when editing an existing one, which is
   * the only difference between the create and edit flows — the form is the same,
   * so there is one code path and no second dialog to keep in sync.
   *
   * All three source buffers live here rather than in the editors, so switching
   * tabs cannot lose work.
   */
  @state() private draft = emptyDraft();
  @state() private error = '';
  @state() private version = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    // Seed the name once the library is known, so the form is ready to use.
    if (!this.draft.name) this.draft = emptyDraft(this.#defaultName());
  }

  override render(): TemplateResult {
    const selected = this.editor.selected;
    const blocks = this.#visibleBlocks();
    const groups = groupBy(blocks);

    return html`
      <div class="top">
        <div class="search">
          ${icon('search', 13)}
          <input
            type="text"
            placeholder="Search blocks…"
            .value=${this.query}
            spellcheck="false"
            aria-label="Search blocks"
            @input=${(event: Event) => {
        this.query = (event.target as HTMLInputElement).value;
      }}
          />
        </div>
        <heo-segmented
          .options=${[
        { value: 'all', label: 'All' },
        { value: 'container', label: 'Containers' },
        { value: 'component', label: 'Components' },
      ]}
          .value=${this.kind}
          label="Block kind"
          @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.kind = (event.detail.value || 'all') as BlockKind | 'all';
      }}
        ></heo-segmented>
        ${this.#renderTarget(selected)}
      </div>

      ${this.configuring ? this.#renderConfigure(this.configuring) : nothing}

      ${groups.length === 0
        ? html`<div class="empty">No block matches. Create one below.</div>`
        : groups.map(
          (group) => html`
              <div class="group">${group.name}</div>
              <div class="cards">
                ${repeat(
            group.blocks,
            (block) => block.id,
            (block) => this.#renderCard(block),
          )}
              </div>
            `,
        )}

      ${this.#renderAuthor()}
    `;
  }

  /* ---------------------------------------------------------------------- */

  #renderTarget(selected: HTMLElement | null): TemplateResult {
    if (!selected) {
      return html`<p class="target">
        Nothing selected, so blocks are appended to the end of <code>body</code>.
      </p>`;
    }
    const canNest = acceptsChildren(selected);
    return html`
      <heo-segmented
        .options=${[
        { value: 'before', label: 'Before' },
        { value: 'after', label: 'After' },
        ...(canNest ? [{ value: 'lastChild', label: 'Inside' }] : []),
      ]}
        .value=${this.position}
        label="Insert position"
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.position = (event.detail.value || 'after') as InsertPosition;
      }}
      ></heo-segmented>
      <p class="target">
        Inserting ${this.position === 'lastChild' ? 'inside' : this.position}
        <code>${labelFor(selected)}</code>
      </p>
    `;
  }

  #renderCard(block: LibraryBlock): TemplateResult {
    const removable = block.origin !== 'preset';
    return html`<button
      class="card"
      type="button"
      title=${block.description ?? block.name}
      @click=${() => this.#pick(block)}
    >
      <span class="glyph">${icon(block.icon ?? (block.kind === 'container' ? 'wrap' : 'blocks'), 15)}</span>
      <span class="name">${block.name}</span>
      <span class="desc">${block.description ?? ''}</span>
      <span class="foot">
        <span class="kind">
          ${block.element ? 'web component' : block.kind === 'container' ? 'container' : 'component'}
        </span>
        <span
          class="kill"
          role="button"
          tabindex="0"
          aria-label=${`Edit ${block.name}`}
          title="Inspect and edit this block"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#startEdit(block);
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.stopPropagation();
            this.#startEdit(block);
          }}
          >${icon('sliders', 11)}</span
        >
        ${removable
        ? html`<span
              class="kill"
              role="button"
              tabindex="0"
              aria-label=${`Delete ${block.name}`}
              @click=${(event: Event) => {
            event.stopPropagation();
            this.#remove(block);
          }}
              @keydown=${(event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.stopPropagation();
            this.#remove(block);
          }}
              >${icon('trash', 11)}</span
            >`
        : nothing}
      </span>
    </button>`;
  }

  #renderConfigure(block: LibraryBlock): TemplateResult {
    return html`<div class="configure">
      <header>
        ${icon(block.icon ?? 'blocks', 14)}
        <span class="n">${block.name}</span>
        <button
          class="btn icon ghost sm"
          type="button"
          aria-label="Cancel"
          @click=${() => {
        this.configuring = null;
      }}
        >
          ${icon('close', 12)}
        </button>
      </header>
      ${PropForm.render(
        block.props ?? {},
        this.props,
        (name, value) => {
          this.props = { ...this.props, [name]: value };
        },
        this.editor,
      )}
      <div class="actions">
        <button
          class="btn"
          type="button"
          @click=${() => {
        this.configuring = null;
      }}
        >
          Cancel
        </button>
        <button class="btn primary" type="button" @click=${() => void this.#insert(block)}>
          ${icon('plus', 12)} Insert
        </button>
      </div>
    </div>`;
  }

  #renderAuthor(): TemplateResult {
    const isElement = Boolean(this.draft.tag.trim() && this.draft.script.trim());
    const editing = this.draft.id !== null;
    const normalizedTag = normalizeCustomElementTag(this.draft.tag);
    const tagCorrected = Boolean(this.draft.tag.trim()) && normalizedTag !== this.draft.tag.trim();

    return html`<heo-section
      heading=${editing ? `Editing ${this.draft.name || 'block'}` : 'Create a block'}
      glyph=${editing ? 'sliders' : 'plus'}
      ?open=${openSections.has('author')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => {
        if (event.detail.open) openSections.add('author');
        else openSections.delete('author');
        this.version += 1;
      }}
    >
      <div class="author">
        ${editing
        ? html`<div class="editing-banner">
              ${icon('sliders', 12)}
              <span>Changes replace the existing block.</span>
              <button class="btn sm ghost" type="button" @click=${this.#resetDraft}>
                ${icon('close', 11)} New instead
              </button>
            </div>`
        : nothing}
        <div class="two">
          <input
            class="input"
            type="text"
            placeholder="Block name"
            .value=${this.draft.name}
            aria-label="Block name"
            @input=${(event: Event) => this.#edit('name', (event.target as HTMLInputElement).value)}
          />
          <select
            class="input"
            .value=${this.draft.kind}
            aria-label="Block kind"
            @change=${(event: Event) =>
        this.#edit('kind', (event.target as HTMLSelectElement).value as BlockKind)}
          >
            <option value="component" ?selected=${this.draft.kind === 'component'}>Component</option>
            <option value="container" ?selected=${this.draft.kind === 'container'}>Container</option>
          </select>
        </div>
        <input
          class="input"
          type="text"
          placeholder="Short description (optional)"
          .value=${this.draft.description}
          aria-label="Description"
          @input=${(event: Event) =>
        this.#edit('description', (event.target as HTMLInputElement).value)}
        />

        <div class="tabs" role="tablist">
          ${(['html', 'css', 'js'] as const).map(
          (tab) => html`<button
              type="button"
              role="tab"
              aria-selected=${this.sourceTab === tab}
              @click=${() => {
              this.sourceTab = tab;
            }}
            >
              ${tab === 'js' ? 'JS / Lit' : tab.toUpperCase()}
            </button>`,
        )}
        </div>

        ${this.sourceTab === 'html'
        ? html`<heo-code-editor
              language="html"
              rows="7"
              .value=${this.draft.html}
              placeholder=${isElement
            ? 'Ignored: this block inserts its custom element tag instead.'
            : '<div class="my-block">…</div>  ·  use {{propName}} for props'}
              @code-input=${(event: CustomEvent<{ value: string }>) =>
            this.#edit('html', event.detail.value)}
            ></heo-code-editor>`
        : nothing}
        ${this.sourceTab === 'css'
        ? html`<heo-code-editor
              language="css"
              rows="7"
              .value=${this.draft.css}
              placeholder=".my-block { display: grid; gap: var(--space-md, 16px); }"
              @code-input=${(event: CustomEvent<{ value: string }>) =>
            this.#edit('css', event.detail.value)}
            ></heo-code-editor>`
        : nothing}
        ${this.sourceTab === 'js'
        ? html`
              <input
                class="input mono"
                type="text"
                placeholder="custom element tag, e.g. my-widget"
                .value=${this.draft.tag}
                aria-label="Custom element tag"
                @input=${(event: Event) =>
            this.#edit('tag', (event.target as HTMLInputElement).value)}
                @blur=${this.#normalizeTag}
              />
              ${tagCorrected
            ? html`<p class="hint tagfix">
                  ${icon('sparkle', 11)} Will be used as
                  <code class="mono">${normalizedTag || '(unusable — needs a letter)'}</code>.
                  Custom element names are lowercase and need a hyphen.
                </p>`
            : nothing}
              <heo-code-editor
                language="js"
                rows="10"
                .value=${this.draft.script}
                placeholder=${"import { LitElement, html, css } from 'lit';\n\nclass MyWidget extends LitElement { … }\ncustomElements.define('my-widget', MyWidget);"}
                @code-input=${(event: CustomEvent<{ value: string }>) =>
            this.#edit('script', event.detail.value)}
              ></heo-code-editor>
              <p class="hint">
                Imports of <code class="mono">lit</code> resolve to the copy the overlay already
                loads, so a component pasted here runs without a build step. The module has to call
                <code class="mono">customElements.define</code> with the tag above.
              </p>
            `
        : nothing}

        ${this.error ? html`<p class="save-error">${icon('close', 11)} ${this.error}</p>` : nothing}

        <div class="row">
          <button class="btn primary" type="button" @click=${this.#save}>
            ${icon(editing ? 'check' : 'plus', 12)} ${editing ? 'Update block' : 'Save block'}
          </button>
          ${editing
        ? html`<button class="btn" type="button" @click=${this.#resetDraft}>Cancel</button>`
        : nothing}
        </div>
      </div>
    </heo-section>`;
  }

  /* ---------------------------------------------------------------------- */

  #visibleBlocks(): LibraryBlock[] {
    const found = this.editor.library.search(this.query);
    return this.kind === 'all' ? found : found.filter((block) => block.kind === this.kind);
  }

  #pick(block: LibraryBlock): void {
    if (block.props && Object.keys(block.props).length) {
      this.props = this.editor.library.defaultProps(block);
      this.configuring = block;
      return;
    }
    void this.#insert(block);
  }

  async #insert(block: LibraryBlock): Promise<void> {
    const selected = this.editor.selected;
    const anchor = selected
      ? { reference: selected, position: this.position }
      : { reference: document.body, position: 'lastChild' as InsertPosition };
    await this.editor.insertBlock(block, this.props, anchor);
    this.configuring = null;
  }

  #remove(block: LibraryBlock): void {
    this.editor.library.remove(block.id);
    this.editor.notify(`Removed ${block.name} from the library.`, 'info');
  }

  #edit<K extends keyof BlockDraft>(key: K, value: BlockDraft[K]): void {
    this.draft = { ...this.draft, [key]: value };
    this.error = '';
  }

  /** Apply the tag correction once the user leaves the field. */
  #normalizeTag(): void {
    const normalized = normalizeCustomElementTag(this.draft.tag);
    if (normalized && normalized !== this.draft.tag) this.#edit('tag', normalized);
  }

  #resetDraft = (): void => {
    this.draft = emptyDraft(this.#defaultName(), this.draft.kind);
    this.error = '';
    this.sourceTab = 'html';
  };

  /** Load an existing block into the form so it can be inspected and changed. */
  #startEdit(block: LibraryBlock): void {
    this.draft = {
      id: block.id,
      name: block.name,
      kind: block.kind,
      category: block.category ?? '',
      description: block.description ?? '',
      html: formatHTML(block.html),
      css: block.css ?? '',
      script: block.element?.module ?? block.element?.script ?? '',
      tag: block.element?.tag ?? '',
    };
    this.error = '';
    this.sourceTab = block.element ? 'js' : 'html';
    openSections.add('author');
    this.version += 1;
    // Bring the form into view; it sits below a potentially long block grid.
    requestAnimationFrame(() => {
      this.renderRoot.querySelector('.author')?.scrollIntoView({ block: 'nearest' });
    });
  }

  /**
   * Validate and save.
   *
   * The button stays enabled whatever the state of the form: a disabled button
   * cannot explain itself, and "why can't I click this" is a worse experience
   * than being told exactly what is missing.
   */
  #save = (): void => {
    const name = this.draft.name.trim();
    const hasScript = Boolean(this.draft.script.trim());
    const tag = normalizeCustomElementTag(this.draft.tag);

    if (!name) {
      this.error = 'Give the block a name so it can be found in the library.';
      return;
    }
    if (hasScript && !tag) {
      this.error =
        'A component with a module needs a custom element tag: lowercase letters, numbers and at least one hyphen.';
      return;
    }
    if (tag && !hasScript) {
      this.error = `Add the module that defines <${tag}>, or clear the tag to save plain markup.`;
      return;
    }
    if (!hasScript && !this.draft.html.trim()) {
      this.error = 'Add some HTML, or a tag and module on the JS / Lit tab.';
      return;
    }
    if (hasScript && !this.draft.script.includes('customElements.define')) {
      this.error = `The module must call customElements.define('${tag}', …) for the tag to exist.`;
      return;
    }

    try {
      const existing = this.draft.id ? this.editor.library.get(this.draft.id) : undefined;
      const built = blockFromSource({
        ...this.draft,
        tag,
        id: this.draft.id ?? this.editor.library.uniqueId(name),
      });
      // Merge so editing keeps what the form does not cover, such as declared
      // props and the card icon.
      const block = this.editor.library.upsert({ ...existing, ...built });
      this.editor.notify(
        this.draft.id ? `Updated ${block.name}.` : `Saved ${block.name} to the library.`,
        'success',
      );
      this.#resetDraft();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  };

  /** `Block 1`, `Block 2`, … so a new form is usable without thinking. */
  #defaultName(): string {
    const used = new Set(this.editor.library.list().map((block) => block.name));
    for (let n = 1; n < 500; n += 1) {
      const candidate = `Block ${n}`;
      if (!used.has(candidate)) return candidate;
    }
    return 'Block';
  }
}

interface BlockDraft {
  /** Null for a new block, otherwise the block being edited. */
  id: string | null;
  name: string;
  kind: BlockKind;
  category: string;
  description: string;
  html: string;
  css: string;
  script: string;
  tag: string;
}

function emptyDraft(name = 'Block 1', kind: BlockKind = 'component'): BlockDraft {
  return {
    id: null,
    name,
    kind,
    category: '',
    description: '',
    html: '',
    css: '',
    script: '',
    tag: '',
  };
}

function groupBy(blocks: LibraryBlock[]): Array<{ name: string; blocks: LibraryBlock[] }> {
  const groups: Array<{ name: string; blocks: LibraryBlock[] }> = [];
  for (const block of blocks) {
    const name = block.category ?? (block.kind === 'container' ? 'Layout' : 'Components');
    const existing = groups.find((group) => group.name === name);
    if (existing) existing.blocks.push(block);
    else groups.push({ name, blocks: [block] });
  }
  return groups;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-library-panel': HeoLibraryPanel;
  }
}
