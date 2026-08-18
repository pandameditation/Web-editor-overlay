import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { visualBox } from '../../core/dom.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { LibraryBlock } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { PropForm } from '../panels/prop-form.js';

/**
 * Block picker for the `+` affordances.
 *
 * Opens keyboard-first: the search field takes focus, arrows move through the
 * results and Enter inserts. A block with declared props switches the popover to
 * a small form instead of inserting immediately, so the first render is already
 * configured rather than something to fix afterwards.
 */
@customElement('heo-insert-menu')
export class HeoInsertMenu extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    PropForm.styles,
    css`
      :host {
        position: fixed;
        z-index: 15;
        pointer-events: auto;
      }
      .pop {
        display: flex;
        flex-direction: column;
        width: 300px;
        max-height: min(72vh, 480px);
        border-radius: var(--heo-r-md);
        overflow: hidden;
        animation: in var(--heo-fast);
      }
      @keyframes in {
        from {
          opacity: 0;
          transform: translateY(-4px) scale(0.99);
        }
      }

      .top {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 9px;
        border-bottom: 1px solid var(--heo-line);
      }
      .top input {
        flex: 1 1 auto;
        min-width: 0;
        height: 24px;
        border: 0;
        background: transparent;
        color: var(--heo-text);
      }
      .top input:focus {
        outline: none;
      }
      .where {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        white-space: nowrap;
      }

      .list {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 5px;
      }
      .group {
        padding: 7px 7px 3px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 7px;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
      }
      .row:hover,
      .row[aria-selected='true'] {
        background: var(--heo-hover);
      }
      .row .glyph {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        flex: 0 0 auto;
        border: 1px solid var(--heo-line);
        border-radius: 7px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
      }
      .row .body {
        flex: 1 1 auto;
        min-width: 0;
      }
      .row .name {
        font-size: 12px;
      }
      .row .desc {
        display: block;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row .kind {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .configure {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .chead {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 8px 9px;
        border-bottom: 1px solid var(--heo-line);
      }
      .chead .name {
        flex: 1 1 auto;
        font-size: 12px;
        font-weight: 550;
      }
      .cbody {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 10px;
      }
      .cfoot {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        padding: 9px;
        border-top: 1px solid var(--heo-line);
      }
      .back {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .back:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.insertAnchor, s.geometry, s.registry] as const,
    shallowArrayEquals,
  );

  @state() private query = '';
  @state() private highlight = 0;
  @state() private configuring: LibraryBlock | null = null;
  @state() private props: Record<string, string> = {};

  @query('.top input') private search?: HTMLInputElement;

  #onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.state.value.insertAnchor) return;
    const path = event.composedPath();
    if (path.includes(this)) return;
    if (path.some((node) => node instanceof HTMLElement && node.classList.contains('insert'))) return;
    this.editor.setInsertAnchor(null);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.#onDocumentPointerDown, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true);
  }

  override updated(): void {
    if (this.state.value.insertAnchor && !this.configuring && this.search) {
      if (this.shadowRoot?.activeElement !== this.search) this.search.focus();
    }
  }

  private get results(): LibraryBlock[] {
    return this.editor.library.search(this.query);
  }

  override render(): TemplateResult | typeof nothing {
    const anchor = this.state.value.insertAnchor;
    if (!anchor || !anchor.reference.isConnected) {
      if (this.configuring) this.configuring = null;
      return nothing;
    }
    this.#place(anchor.reference);

    return html`<div class="pop surface">
      ${this.configuring ? this.#renderConfigure(this.configuring) : this.#renderList()}
    </div>`;
  }

  #renderList(): TemplateResult {
    const anchor = this.state.value.insertAnchor!;
    const results = this.results;

    const groups: Array<{ name: string; blocks: LibraryBlock[] }> = [];
    for (const block of results) {
      const name = block.category ?? (block.kind === 'container' ? 'Layout' : 'Components');
      const existing = groups.find((group) => group.name === name);
      if (existing) existing.blocks.push(block);
      else groups.push({ name, blocks: [block] });
    }

    let index = -1;
    return html`
      <div class="top">
        ${icon('search', 13)}
        <input
          type="text"
          placeholder="Search blocks…"
          .value=${this.query}
          spellcheck="false"
          autocomplete="off"
          aria-label="Search blocks"
          @input=${(event: Event) => {
            this.query = (event.target as HTMLInputElement).value;
            this.highlight = 0;
          }}
          @keydown=${this.#onSearchKey}
        />
        <span class="where">${anchor.position}</span>
      </div>
      <div class="list" role="listbox">
        ${results.length === 0
          ? html`<div class="empty">
              No block matches “${this.query}”. Create one in the Library panel.
            </div>`
          : repeat(
              groups,
              (group) => group.name,
              (group) => html`
                <div class="group">${group.name}</div>
                ${repeat(
                  group.blocks,
                  (block) => block.id,
                  (block) => {
                    index += 1;
                    const current = index;
                    return html`<button
                      class="row"
                      type="button"
                      role="option"
                      aria-selected=${current === this.highlight}
                      @pointerenter=${() => {
                        this.highlight = current;
                      }}
                      @click=${() => this.#pick(block)}
                    >
                      <span class="glyph">${icon(block.icon ?? 'blocks', 14)}</span>
                      <span class="body">
                        <span class="name">${block.name}</span>
                        <span class="desc">${block.description ?? ''}</span>
                      </span>
                      <span class="kind">${block.kind === 'container' ? 'box' : 'cmp'}</span>
                    </button>`;
                  },
                )}
              `,
            )}
      </div>
    `;
  }

  #renderConfigure(block: LibraryBlock): TemplateResult {
    return html`<div class="configure">
      <div class="chead">
        <button class="back" type="button" title="Back" @click=${() => {
          this.configuring = null;
        }}>
          ${icon('chevronLeft', 12)}
        </button>
        <span class="name">${block.name}</span>
      </div>
      <div class="cbody">
        ${block.description ? html`<p class="hint" style="margin:0 0 10px">${block.description}</p>` : nothing}
        ${PropForm.render(block.props ?? {}, this.props, (name, value) => {
          this.props = { ...this.props, [name]: value };
        }, this.editor)}
      </div>
      <div class="cfoot">
        <button class="btn" type="button" @click=${() => {
          this.configuring = null;
        }}>
          Cancel
        </button>
        <button class="btn primary" type="button" @click=${() => this.#insert(block)}>
          ${icon('plus', 12)} Insert
        </button>
      </div>
    </div>`;
  }

  #onSearchKey(event: KeyboardEvent): void {
    const results = this.results;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.editor.setInsertAnchor(null);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = this.highlight + delta;
      this.highlight = next < 0 ? results.length - 1 : next >= results.length ? 0 : next;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const block = results[this.highlight];
      if (block) this.#pick(block);
    }
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
    const anchor = this.state.value.insertAnchor;
    await this.editor.insertBlock(block, this.props, anchor ?? undefined);
    this.configuring = null;
    this.query = '';
    this.highlight = 0;
  }

  #place(reference: HTMLElement): void {
    const anchor = this.state.value.insertAnchor!;
    const box = visualBox(reference);
    const width = 300;
    const height = Math.min(innerHeight * 0.72, 480);

    const left = Math.min(
      Math.max(8, box.left + box.width / 2 - width / 2),
      Math.max(8, innerWidth - width - 8),
    );
    const wanted = anchor.position === 'before' ? box.top - height - 14 : box.top + box.height + 14;
    const top = Math.min(Math.max(8, wanted), Math.max(8, innerHeight - height - 8));

    this.style.left = `${Math.round(left)}px`;
    this.style.top = `${Math.round(top)}px`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-insert-menu': HeoInsertMenu;
  }
}
