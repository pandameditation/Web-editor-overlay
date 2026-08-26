import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { acceptsChildren, isMutable, labelFor, visualBox } from '../../core/dom.js';
import type { InsertAnchor } from '../../core/editor.js';
import {
  elementBlock,
  HTML_ELEMENTS,
  searchElements,
  type HtmlElementSpec,
} from '../../core/elements.js';
import { INSERT_POSITION_LABELS, type InsertPosition } from '../../core/mutations.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { LibraryBlock } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { PropForm } from '../panels/prop-form.js';
import '../controls/segmented.js';

/**
 * Block picker for the `+` affordances.
 *
 * Opens keyboard-first: the search field takes focus, arrows move through the
 * results and Enter inserts. A block with declared props switches the popover to
 * a small form instead of inserting immediately, so the first render is already
 * configured rather than something to fix afterwards.
 *
 * Below the blocks sit the HTML primitives — a paragraph, a list, a table, a
 * marquee. The library is a set of assembled patterns, which is the right vocabulary
 * most of the time and the wrong one when what you want is a `<p>`; both live in one
 * list so one search and one set of arrow keys reach either.
 */

/**
 * One offer in the list.
 *
 * Flat and tagged rather than two parallel lists, because the keyboard indexes a
 * single array — which is what lets arrows and Enter cross from a block to an
 * element without either side knowing about the other.
 */
type InsertEntry =
  | { id: string; kind: 'block'; block: LibraryBlock }
  | { id: string; kind: 'element'; spec: HtmlElementSpec }
  | { id: string; kind: 'more'; hidden: number };
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
      /* Where the block lands, changeable without closing the popover. Which plus
         button was clicked is a guess at the intent, not a commitment, and
         re-opening the menu from the other edge just to switch sides is busywork. */
      .where {
        display: grid;
        gap: 6px;
        padding: 8px 9px;
        border-bottom: 1px solid var(--heo-line);
      }
      .where .target {
        overflow: hidden;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .where .target b {
        color: var(--heo-text-dim);
        font-weight: 500;
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
      /* The tag itself, which is more use than a category badge would be: it is what
         the element is called, what gets inserted, and what you would have typed. */
      .row .kind.tag {
        padding: 1px 5px;
        border: 1px solid var(--heo-line);
        border-radius: 4px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 9.5px;
        letter-spacing: 0;
        text-transform: none;
      }
      .row[aria-selected='true'] .kind.tag {
        border-color: var(--heo-accent-line);
        color: var(--heo-accent);
      }
      .row.more .name {
        color: var(--heo-accent);
      }

      /* Blocks or primitives. Sits with the search rather than with the position
         switch below it: both are about *what* is being inserted. */
      .scope {
        padding: 0 9px 8px;
        border-bottom: 1px solid var(--heo-line);
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
      /* The configure view is a form, not a menu, so its prose is text to read and
         copy rather than a target to click past. */
      .selectable {
        -webkit-user-select: text;
        user-select: text;
        cursor: text;
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
  /**
   * Whether the whole HTML catalogue is showing, or just the everyday tags.
   *
   * Forty-odd primitives listed unconditionally would bury the curated blocks that
   * are the better answer most of the time. A dozen common ones plus one row that
   * reveals the rest keeps both reachable, and searching ignores the distinction
   * because someone typing `marquee` has already said what they want.
   */
  @state() private allElements = false;
  /**
   * Which half of the catalogue is on offer.
   *
   * `all` leads with the blocks, because an assembled pattern is the better answer
   * more often than a bare tag is. But "more often" is not "always", and a list of
   * seventeen blocks above the primitives meant nobody scrolled far enough to learn
   * the primitives were there. One switch, and the same one the Library panel uses
   * for its own two kinds.
   */
  @state() private scope: 'all' | 'blocks' | 'html' = 'all';

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

  /**
   * Everything on offer, flat, in the order it is drawn.
   *
   * One list rather than two because the keyboard indexes it: `highlight` is a
   * position in this array, so arrows and Enter cross from a block to an element
   * without knowing there is a boundary. `more` is an entry rather than a bare row
   * for the same reason — a reveal you can only click is a reveal a keyboard user
   * does not have.
   */
  private get entries(): InsertEntry[] {
    const blocks: InsertEntry[] =
      this.scope === 'html'
        ? []
        : this.editor.library
          .search(this.query)
          .map((block) => ({ id: `b:${block.id}`, kind: 'block', block }));

    if (this.scope === 'blocks') return blocks;

    // Browsing the primitives deliberately means wanting all of them; the short
    // list exists to stop them crowding the blocks, which is not a concern here.
    const everything = this.scope === 'html' || this.allElements;
    const shown = searchElements(this.query, everything);
    const elements: InsertEntry[] = shown.map((spec) => ({
      id: `e:${spec.tag}`,
      kind: 'element',
      spec,
    }));

    const hidden = this.query.trim() || everything ? 0 : HTML_ELEMENTS.length - shown.length;
    if (hidden > 0) elements.push({ id: 'e:more', kind: 'more', hidden });

    /*
     * Blocks lead, except when the query names a tag outright.
     *
     * Browsing wants the assembled patterns first. Typing `p` does not: it is an
     * unambiguous request for a paragraph, and blocks match a bare letter far too
     * easily — "p" appears in half the block descriptions, so `<p>` ended up below
     * six things nobody asked for. An exact tag is the one signal strong enough to
     * reorder on; anything vaguer keeps the browsing order.
     */
    const typed = this.query.trim().toLowerCase().replace(/^<|>$/g, '');
    const exact = typed && shown[0]?.tag === typed;
    return exact ? [...elements, ...blocks] : [...blocks, ...elements];
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
    const entries = this.entries;

    /*
     * Blocks by category, then the primitives under one heading.
     *
     * The elements stay in a single section rather than being split by concern:
     * eight sub-headings over the dozen everyday tags would be more chrome than
     * content, and the catalogue is already ordered text → structure → lists →
     * media → interactive → forms → code → old web, which reads as grouped without
     * saying so.
     */
    const groups: Array<{ name: string; entries: InsertEntry[] }> = [];
    for (const entry of entries) {
      const name =
        entry.kind === 'block'
          ? entry.block.category ?? (entry.block.kind === 'container' ? 'Layout' : 'Components')
          : entry.kind === 'element' && this.scope === 'html'
            ? entry.spec.group
            : 'HTML elements';
      const existing = groups.find((group) => group.name === name);
      if (existing) existing.entries.push(entry);
      else groups.push({ name, entries: [entry] });
    }

    let index = -1;
    return html`
      <div class="top">
        ${icon('search', 13)}
        <input
          type="text"
          placeholder="Search blocks and HTML…"
          .value=${this.query}
          spellcheck="false"
          autocomplete="off"
          aria-label="Search blocks and HTML elements"
          @input=${(event: Event) => {
        this.query = (event.target as HTMLInputElement).value;
        this.highlight = 0;
      }}
          @keydown=${this.#onSearchKey}
        />
      </div>
      <div class="scope">
        <heo-segmented
          label="What to insert"
          .value=${this.scope}
          .options=${[
        { value: 'all', label: 'All', title: 'Blocks first, then the HTML primitives' },
        { value: 'blocks', label: 'Blocks', title: 'Assembled patterns from the Library' },
        { value: 'html', label: 'HTML', title: 'Plain elements: paragraphs, lists, tables' },
      ]}
          @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.scope = (event.detail.value || 'all') as 'all' | 'blocks' | 'html';
        this.highlight = 0;
      }}
        ></heo-segmented>
      </div>
      ${this.#renderWhere(anchor)}
      <div class="list" role="listbox">
        ${entries.length === 0
        ? html`<div class="empty">
              Nothing matches “${this.query}”. Try a tag name, or create a block in the Library
              panel.
            </div>`
        : repeat(
          groups,
          (group) => group.name,
          (group) => html`
                <div class="group">${group.name}</div>
                ${repeat(
            group.entries,
            (entry) => entry.id,
            (entry) => {
              index += 1;
              return this.#renderRow(entry, index);
            },
          )}
              `,
        )}
      </div>
    `;
  }

  /** One row, whichever kind of thing it stands for. */
  #renderRow(entry: InsertEntry, current: number): TemplateResult {
    const selected = current === this.highlight;
    const onEnter = (): void => {
      this.highlight = current;
    };

    if (entry.kind === 'more') {
      return html`<button
        class="row more"
        type="button"
        role="option"
        aria-selected=${selected}
        @pointerenter=${onEnter}
        @click=${() => this.#pick(entry)}
      >
        <span class="glyph">${icon('plus', 14)}</span>
        <span class="body">
          <span class="name">${entry.hidden} more element${entry.hidden === 1 ? '' : 's'}</span>
          <span class="desc">Tables, forms, embeds, and a marquee.</span>
        </span>
      </button>`;
    }

    if (entry.kind === 'element') {
      const { spec } = entry;
      return html`<button
        class="row"
        type="button"
        role="option"
        aria-selected=${selected}
        title=${`<${spec.tag}> — ${spec.description}`}
        @pointerenter=${onEnter}
        @click=${() => this.#pick(entry)}
      >
        <span class="glyph">${icon(spec.icon, 14)}</span>
        <span class="body">
          <span class="name">${spec.label}</span>
          <span class="desc">${spec.description}</span>
        </span>
        <span class="kind tag">${spec.tag}</span>
      </button>`;
    }

    const { block } = entry;
    return html`<button
      class="row"
      type="button"
      role="option"
      aria-selected=${selected}
      @pointerenter=${onEnter}
      @click=${() => this.#pick(entry)}
    >
      <span class="glyph">${icon(block.icon ?? 'blocks', 14)}</span>
      <span class="body">
        <span class="name">${block.name}</span>
        <span class="desc">${block.description ?? ''}</span>
      </span>
      <span class="kind">${block.kind === 'container' ? 'box' : 'cmp'}</span>
    </button>`;
  }

  /**
   * The position switch.
   *
   * `Inside` only appears for elements that can hold children, and `Replace` only
   * for elements that can actually be removed — offering either where it cannot
   * work would just be an error message waiting to happen.
   */
  #renderWhere(anchor: InsertAnchor): TemplateResult {
    const reference = anchor.reference;
    const options = [
      { value: 'before', label: 'Before', title: `Insert before ${labelFor(reference)}` },
      { value: 'after', label: 'After', title: `Insert after ${labelFor(reference)}` },
      ...(acceptsChildren(reference)
        ? [{ value: 'lastChild', label: 'Inside', title: `Insert inside ${labelFor(reference)}` }]
        : []),
      ...(isMutable(reference)
        ? [{ value: 'replace', label: 'Replace', title: `Replace ${labelFor(reference)}` }]
        : []),
    ];

    return html`<div class="where">
      <heo-segmented
        .options=${options}
        .value=${anchor.position}
        label="Insert position"
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        const position = (event.detail.value || 'after') as InsertPosition;
        this.editor.setInsertAnchor({ reference, position });
      }}
      ></heo-segmented>
      <span class="target">
        ${anchor.position === 'replace'
        ? html`Replaces <b>${labelFor(reference)}</b> and everything inside it`
        : html`${INSERT_POSITION_LABELS[anchor.position]} <b>${labelFor(reference)}</b>`}
      </span>
    </div>`;
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
        ${block.description
        ? html`<p class="hint selectable" style="margin:0 0 10px">${block.description}</p>`
        : nothing}
        ${PropForm.render(
          block.props ?? {},
          this.props,
          (name, value) => {
            this.props = { ...this.props, [name]: value };
          },
          this.editor,
          // Track every keystroke: Insert is one click away and would otherwise fire
          // before the field's blur debounce had handed over what was typed.
          {
            onInput: (name, value) => {
              this.props = { ...this.props, [name]: value };
            },
          },
        )}
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
    const entries = this.entries;
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
      this.highlight = next < 0 ? entries.length - 1 : next >= entries.length ? 0 : next;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[this.highlight];
      if (entry) this.#pick(entry);
    }
  }

  #pick(entry: InsertEntry): void {
    if (entry.kind === 'more') {
      this.allElements = true;
      // The reveal replaces the row that was highlighted, so hold the position
      // rather than jumping the selection to whatever slid into that slot.
      this.highlight = Math.max(0, this.highlight);
      return;
    }
    // An element is a bare tag with nothing to configure, so it goes straight in.
    // Everything about the insertion is the block path: same command, same undo
    // label, same selection afterwards.
    if (entry.kind === 'element') {
      void this.#insert(elementBlock(entry.spec));
      return;
    }
    const { block } = entry;
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
