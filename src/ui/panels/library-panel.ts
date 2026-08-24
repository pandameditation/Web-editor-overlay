import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { acceptsChildren, isMutable, labelFor } from '../../core/dom.js';
import { INSERT_POSITION_LABELS, type InsertPosition } from '../../core/mutations.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { BlockKind, LibraryBlock } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { PropForm } from './prop-form.js';
import '../controls/section.js';
import '../controls/segmented.js';


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
        ? html`<div class="empty">
            <p style="margin:0 0 9px">
              ${this.query.trim()
            ? html`Nothing matches <strong>${this.query}</strong>.`
            : html`No block here yet.`}
            </p>
            ${this.#renderCreateButton()}
          </div>`
        : html`${groups.map(
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
            <!-- After the last card as well as on an empty result: looking through the
                 library and not finding the thing is exactly when someone decides to
                 build it. -->
            <div class="makerow">${this.#renderCreateButton()}</div>`}
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
    const canReplace = isMutable(selected);
    // A position that no longer applies to the new selection would silently insert
    // somewhere unexpected, so fall back rather than keep it.
    if (this.position === 'lastChild' && !canNest) this.position = 'after';
    if (this.position === 'replace' && !canReplace) this.position = 'after';

    return html`
      <heo-segmented
        .options=${[
        { value: 'before', label: 'Before' },
        { value: 'after', label: 'After' },
        ...(canNest ? [{ value: 'lastChild', label: 'Inside' }] : []),
        ...(canReplace ? [{ value: 'replace', label: 'Replace' }] : []),
      ]}
        .value=${this.position}
        label="Insert position"
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.position = (event.detail.value || 'after') as InsertPosition;
      }}
      ></heo-segmented>
      <p class="target">
        ${this.position === 'replace'
        ? html`Replacing <code>${labelFor(selected)}</code> and everything inside it`
        : html`Inserting ${INSERT_POSITION_LABELS[this.position]}
            <code>${labelFor(selected)}</code>`}
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
        this.editor.beginBlockEdit(block.id);
      }}
          @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        event.stopPropagation();
        this.editor.beginBlockEdit(block.id);
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
        // As in the insert popover: Insert must see what is on screen, not what was
        // last committed by a blur.
        {
          onInput: (name, value) => {
            this.props = { ...this.props, [name]: value };
          },
        },
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

  /**
   * Start a block from the list, seeded with whatever was being searched for.
   *
   * The panel used to carry its own copy of the authoring form in a collapsible
   * section, so there were two forms for one job — and the one reached from an element
   * could not express half of what a block can hold. There is one dialog now, and both
   * this and a card's edit action are ways into it.
   */
  #renderCreateButton(): TemplateResult {
    const seed = this.query.trim();
    return html`<button
      class="btn sm"
      type="button"
      title="Author a new block"
      @click=${() => this.editor.beginBlockDraft(seed, this.kind === 'all' ? 'component' : this.kind)}
    >
      ${icon('plus', 12)} ${seed ? `Create "${seed}"` : 'Create a block'}
    </button>`;
  }

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
