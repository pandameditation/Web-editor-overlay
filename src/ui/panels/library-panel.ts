import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { acceptsChildren, labelFor } from '../../core/dom.js';
import { blockFromSource } from '../../core/library.js';
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
  @state() private draft = {
    name: '',
    kind: 'component' as BlockKind,
    category: '',
    description: '',
    html: '',
    css: '',
    script: '',
    tag: '',
  };
  @state() private version = 0;

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
    return html`<heo-section
      heading="Create a block"
      glyph="plus"
      ?open=${openSections.has('author')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => {
        if (event.detail.open) openSections.add('author');
        else openSections.delete('author');
        this.version += 1;
      }}
    >
      <div class="author">
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
              />
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

        <button
          class="btn primary"
          type="button"
          ?disabled=${!this.draft.name.trim() || (!this.draft.html.trim() && !isElement)}
          @click=${this.#create}
        >
          ${icon('plus', 12)} Save block
        </button>
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

  #edit<K extends keyof HeoLibraryPanel['draft']>(
    key: K,
    value: HeoLibraryPanel['draft'][K],
  ): void {
    this.draft = { ...this.draft, [key]: value };
  }

  #create(): void {
    try {
      const block = blockFromSource(this.draft);
      this.editor.library.upsert(block);
      this.editor.notify(`Saved ${block.name}.`, 'success');
      this.draft = {
        name: '',
        kind: this.draft.kind,
        category: '',
        description: '',
        html: '',
        css: '',
        script: '',
        tag: '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.editor.notify(message, 'error');
    }
  }
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
