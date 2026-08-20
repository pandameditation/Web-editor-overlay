import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { INSERTED_ATTR, SOURCE_ATTR } from '../../core/constants.js';
import {
  ancestors,
  isVisible,
  queryDeep,
  selectableChildren,
  sourceRefOf,
} from '../../core/dom.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { modLabel } from '../chrome/toolbar.js';

interface Row {
  el: HTMLElement;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** Expansion survives selection changes and panel switches. */
const expanded = new Set<HTMLElement>();

/**
 * The DOM tree.
 *
 * A real expandable tree rather than a fixed window around the selection, so the
 * page structure can be read as a whole. Three things make it usable on a real
 * page: the path to the selection expands and scrolls itself into view, shadow
 * roots and slots are traversed as the flattened tree the user actually sees, and
 * a filter turns it into a flat search result when you know what you are looking
 * for but not where it is.
 *
 * Navigation keys work anywhere in the overlay; the pad at the bottom exists to
 * make them discoverable.
 */
@customElement('heo-tree-panel')
export class HeoTreePanel extends HeoElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .filter {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 9px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .filter input {
        flex: 1 1 auto;
        min-width: 0;
        height: 24px;
        border: 0;
        background: transparent;
        color: var(--heo-text);
      }
      .filter input:focus {
        outline: none;
      }

      .crumbs {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 7px 12px;
        border-bottom: 1px solid var(--heo-line);
        overflow-x: auto;
        scrollbar-width: none;
      }
      .crumbs::-webkit-scrollbar {
        display: none;
      }
      .crumb {
        flex: 0 0 auto;
        height: 21px;
        padding: 0 6px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        cursor: pointer;
      }
      .crumb:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .crumb.current {
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }
      .sepc {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 9px;
      }

      .list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 5px 6px 10px;
      }

      .row {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        height: 24px;
        padding: 0 5px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 11px;
        text-align: left;
        white-space: nowrap;
        cursor: pointer;
      }
      .row:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .row[aria-selected='true'] {
        background: var(--heo-accent-soft);
        box-shadow: inset 0 0 0 1px var(--heo-accent-line);
        color: var(--heo-text);
      }
      .row.hidden {
        opacity: 0.45;
      }

      .twisty {
        display: grid;
        place-items: center;
        width: 15px;
        height: 15px;
        flex: 0 0 auto;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
        padding: 0;
      }
      .twisty:hover {
        background: var(--heo-line-strong);
        color: var(--heo-text);
      }
      .twisty.leaf {
        cursor: default;
        opacity: 0;
      }

      .tag {
        color: oklch(76% 0.14 20);
      }
      :host-context([data-theme='light']) .tag {
        color: oklch(50% 0.17 20);
      }
      .id {
        color: oklch(80% 0.12 250);
      }
      .cls {
        color: var(--heo-text-faint);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .text {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-family: var(--heo-font);
        font-size: 10.5px;
        text-overflow: ellipsis;
        opacity: 0.75;
      }
      .marks {
        display: flex;
        gap: 3px;
        flex: 0 0 auto;
      }
      .mark {
        display: grid;
        place-items: center;
        width: 14px;
        height: 14px;
        border-radius: 3px;
        color: var(--heo-text-faint);
      }
      .mark.cmp {
        color: var(--heo-accent);
      }
      .mark.new {
        color: var(--heo-success);
      }

      .pad {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 5px;
        padding: 9px 12px;
        border-top: 1px solid var(--heo-line);
      }
      .pad .btn {
        justify-content: flex-start;
      }
      .pad kbd {
        margin-left: auto;
        padding: 1px 4px;
        border: 1px solid var(--heo-line);
        border-radius: 4px;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
      }
      .keys {
        padding: 0 12px 10px;
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.6;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.revision, s.geometry] as const,
    shallowArrayEquals,
  );

  @state() private query = '';
  @state() private version = 0;

  override updated(): void {
    this.#scrollSelectionIntoView();
  }

  override render(): TemplateResult {
    const selected = this.editor.selected;
    const rows = this.query.trim() ? this.#searchRows() : this.#treeRows(selected);

    return html`
      <div class="filter">
        ${icon('search', 13)}
        <input
          type="text"
          placeholder="Filter by tag, #id or .class"
          .value=${this.query}
          spellcheck="false"
          autocomplete="off"
          aria-label="Filter elements"
          @input=${(event: Event) => {
        this.query = (event.target as HTMLInputElement).value;
      }}
          @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.query = '';
        }
      }}
        />
        ${this.query
        ? html`<button
              class="btn icon ghost sm"
              type="button"
              aria-label="Clear filter"
              @click=${() => {
            this.query = '';
          }}
            >
              ${icon('close', 11)}
            </button>`
        : nothing}
      </div>

      ${selected && !this.query ? this.#renderCrumbs(selected) : nothing}

      <div class="list" role="tree">
        ${rows.length === 0
        ? html`<div class="empty">
              ${this.query ? `Nothing matches “${this.query}”.` : 'This page has no editable elements.'}
            </div>`
        : repeat(
          rows,
          (row) => row.el,
          (row) => this.#renderRow(row, selected),
        )}
      </div>

      ${this.#renderPad()}
    `;
  }

  /* ---------------------------------------------------------------------- */

  #treeRows(selected: HTMLElement | null): Row[] {
    // Auto-expand the path to the selection so it is always reachable.
    if (selected) {
      for (const ancestor of ancestors(selected)) expanded.add(ancestor);
      expanded.add(document.body);
    }

    const rows: Row[] = [];
    const walk = (el: HTMLElement, depth: number): void => {
      const children = selectableChildren(el);
      const isOpen = expanded.has(el);
      rows.push({ el, depth, hasChildren: children.length > 0, expanded: isOpen });
      if (!isOpen) return;
      for (const child of children) walk(child, depth + 1);
    };

    for (const child of selectableChildren(document.body)) walk(child, 0);
    return rows;
  }

  #searchRows(): Row[] {
    const needle = this.query.trim().toLowerCase();
    const selector = needle.startsWith('#') || needle.startsWith('.') ? needle : '*';
    let candidates: HTMLElement[] = [];
    try {
      candidates = queryDeep(selector, document.body);
    } catch {
      candidates = queryDeep('*', document.body);
    }
    const matches =
      selector === '*'
        ? candidates.filter((el) => describe(el).toLowerCase().includes(needle))
        : candidates;
    return matches.slice(0, 300).map((el) => ({ el, depth: 0, hasChildren: false, expanded: false }));
  }

  #renderCrumbs(selected: HTMLElement): TemplateResult {
    const chain = [...ancestors(selected)].reverse();
    return html`<div class="crumbs" aria-label="Ancestors">
      ${chain.map(
      (el) => html`<button
          class="crumb"
          type="button"
          title="Select this ancestor"
          @pointerenter=${() => this.editor.hover(el)}
          @pointerleave=${() => this.editor.hover(null)}
          @click=${() => this.editor.select(el)}
        >
          ${el.tagName.toLowerCase()}
        </button>
        <span class="sepc">${icon('chevronRight', 9)}</span>`,
    )}
      <button class="crumb current" type="button" disabled>
        ${selected.tagName.toLowerCase()}
      </button>
    </div>`;
  }

  #renderRow(row: Row, selected: HTMLElement | null): TemplateResult {
    const el = row.el;
    const tag = el.tagName.toLowerCase();
    const isComponent = tag.includes('-');
    const isNew = el.hasAttribute(INSERTED_ATTR);
    const hasSource = el.hasAttribute(SOURCE_ATTR);
    const classes = Array.from(el.classList)
      .filter((name) => !name.startsWith('heo-'))
      .slice(0, 2);
    const preview = directTextPreview(el);
    const hidden = !isVisible(el);

    return html`<button
      class=${`row${hidden ? ' hidden' : ''}`}
      type="button"
      role="treeitem"
      aria-selected=${el === selected}
      aria-expanded=${row.hasChildren ? row.expanded : nothing}
      style=${`padding-left:${5 + row.depth * 13}px`}
      title=${hidden ? `${describe(el)} — not visible` : describe(el)}
      @pointerenter=${() => this.editor.hover(el)}
      @pointerleave=${() => this.editor.hover(null)}
      @click=${() => this.editor.select(el)}
      @dblclick=${() => {
        // Expand as well as edit. A double click on a row that has children is
        // just as likely to mean "show me what is in here" as "let me retype the
        // label", and doing both costs nothing: the twisty state is independent
        // of whether a text edit started.
        this.editor.select(el);
        if (row.hasChildren && !row.expanded) this.#toggle(el);
        this.editor.beginTextEdit(el);
      }}
    >
      <span
        class=${`twisty${row.hasChildren ? '' : ' leaf'}`}
        role="presentation"
        @click=${(event: Event) => {
        if (!row.hasChildren) return;
        event.stopPropagation();
        this.#toggle(el);
      }}
      >
        ${icon(row.expanded ? 'chevronDown' : 'chevronRight', 10)}
      </span>
      <span class="tag">${tag}</span>
      ${el.id ? html`<span class="id">#${el.id}</span>` : nothing}
      ${classes.length ? html`<span class="cls">.${classes.join('.')}</span>` : nothing}
      ${preview ? html`<span class="text">${preview}</span>` : html`<span class="text"></span>`}
      <span class="marks">
        ${isComponent
        ? html`<span class="mark cmp" title="Custom element">${icon('component', 11)}</span>`
        : nothing}
        ${isNew
        ? html`<span class="mark new" title="Added in this session">${icon('plus', 11)}</span>`
        : nothing}
        ${hasSource
        ? html`<span class="mark" title=${`Source: ${formatSource(el)}`}>${icon('code', 11)}</span>`
        : nothing}
      </span>
    </button>`;
  }

  #renderPad(): TemplateResult {
    const has = Boolean(this.editor.selected);
    return html`
      <div class="pad">
        <button
          class="btn sm"
          type="button"
          ?disabled=${!has}
          @click=${() => this.editor.navigate('parent')}
        >
          ${icon('arrowUp', 12)} Parent <kbd>←</kbd>
        </button>
        <button
          class="btn sm"
          type="button"
          ?disabled=${!has}
          @click=${() => this.editor.navigate('child')}
        >
          ${icon('arrowDown', 12)} Child <kbd>→</kbd>
        </button>
        <button
          class="btn sm"
          type="button"
          ?disabled=${!has}
          @click=${() => this.editor.navigate('previous')}
        >
          ${icon('chevronUp', 12)} Previous <kbd>↑</kbd>
        </button>
        <button
          class="btn sm"
          type="button"
          ?disabled=${!has}
          @click=${() => this.editor.navigate('next')}
        >
          ${icon('chevronDown', 12)} Next <kbd>↓</kbd>
        </button>
      </div>
      <div class="keys">
        Shift + arrows moves the element · Enter edits text · ${modLabel()}+D duplicates · Delete
        removes · Alt+↑ selects the parent
      </div>
    `;
  }

  #toggle(el: HTMLElement): void {
    if (expanded.has(el)) expanded.delete(el);
    else expanded.add(el);
    this.version += 1;
  }

  /** Keep the selected row visible without yanking the panel on every keystroke. */
  #scrollSelectionIntoView(): void {
    const row = this.renderRoot.querySelector('.row[aria-selected="true"]');
    if (!(row instanceof HTMLElement)) return;
    const list = this.renderRoot.querySelector('.list');
    if (!(list instanceof HTMLElement)) return;
    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top >= listBox.top && rowBox.bottom <= listBox.bottom) return;
    row.scrollIntoView({ block: 'nearest' });
  }
}

function describe(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const classes = Array.from(el.classList)
    .filter((name) => !name.startsWith('heo-'))
    .map((name) => `.${name}`)
    .join('');
  return `${tag}${id}${classes}`;
}

function directTextPreview(el: HTMLElement): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? '';
  }
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > 42 ? `${trimmed.slice(0, 41)}…` : trimmed;
}

function formatSource(el: HTMLElement): string {
  const ref = sourceRefOf(el);
  return ref ? `${ref.file}:${ref.line}:${ref.column}` : '';
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-tree-panel': HeoTreePanel;
  }
}
