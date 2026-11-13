import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { blockRoots } from '../../core/block-css.js';
import {
  bestBlockSelector,
  matchedBlockElements,
  readableEquivalents,
  type SelectorVocabulary,
} from '../../core/selectors.js';
import { baseStyles } from '../theme.js';
import type { HeoSelectorField } from './selector-field.js';
import './selector-field.js';

/** One rendered attribute of a tree node, truncated for display. */
interface NodeAttr {
  name: string;
  /** The value as shown inside the quotes, with an ellipsis when truncated. */
  display: string;
  /** The untruncated value, for the row's title. */
  full: string;
}

/** One row of the template tree. */
interface TreeRow {
  element: HTMLElement;
  depth: number;
  tag: string;
  attrs: NodeAttr[];
}

/** Values longer than this are truncated with an ellipsis. A readability choice. */
const ATTR_MAX = 40;

/**
 * The "WHICH ELEMENTS?" two-pane picker for the block Paste CSS modal.
 *
 * Left: the existing selector field and its autocomplete. Right: a read-only, indented
 * tree of the block template's static HTML, one row per element, with a per-row
 * selection checkbox. The two are bound both ways with latest-action-wins: typing on the
 * left highlights matching rows; checking rows on the right rewrites the selector to an
 * exact match. There is one source of truth — `selector`, owned by the dialog — so the
 * component never persists a competing copy; the picked set is derived from the current
 * selector on each render, tracked transiently only between a click and the
 * `selector-input` it emits.
 *
 * Re-emits `selector-input` / `selector-submit` upward so the dialog's existing handlers
 * are unchanged. `matchRoot` is non-nullable by contract — the dialog only mounts this
 * when `#blockMatchRoot()` is non-null.
 */
@customElement('heo-which-elements')
export class HeoWhichElements extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .eyebrow {
        display: block;
        margin: 0 0 8px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 650;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .which {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 10px;
      }
      @media (max-width: 560px) {
        .which {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .pane-label {
        margin: 0 0 4px;
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .tree {
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        padding: 6px;
        max-height: 240px;
        overflow: auto;
        font-family: var(--heo-mono);
        font-size: 11px;
        line-height: 1.7;
      }
      .node {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        border-radius: 5px;
        padding: 2px 6px;
        color: var(--heo-text-dim);
        white-space: nowrap;
      }
      .node:hover {
        background: var(--heo-hover);
      }
      /* The match/picked backgrounds are secondary cues. The checkbox plus aria-checked
         and aria-selected carry the real state, so it is not conveyed by colour alone. */
      .node.match {
        background: color-mix(in oklab, var(--heo-accent) 14%, transparent);
        color: var(--heo-text);
        box-shadow: inset 0 0 0 1px var(--heo-accent-line);
      }
      .node.synthetic .label {
        color: var(--heo-text);
        font-style: italic;
      }
      .node .box {
        flex: 0 0 auto;
        width: 13px;
        height: 13px;
        margin: 0;
        accent-color: var(--heo-accent);
        cursor: pointer;
      }
      .node .label {
        flex: 1 1 auto;
        min-width: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font-family: var(--heo-mono);
        font-size: 11px;
        text-align: left;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .node .box:focus-visible,
      .node .label:focus-visible {
        outline: 2px solid var(--heo-accent);
        outline-offset: 1px;
      }
      .tag {
        color: var(--heo-accent);
      }
      .attr-name {
        color: color-mix(in oklab, var(--heo-success) 70%, var(--heo-text));
      }
      .attr-val {
        color: var(--heo-text-dim);
      }
      .punct {
        color: var(--heo-text-faint);
      }
      .empty {
        padding: 10px 8px;
        color: var(--heo-text-faint);
        font-size: 11px;
      }
    `,
  ];

  /** The committed selector, mirrored from the dialog's `open.selector`. */
  @property({ attribute: false }) selector = '';
  /** The block-template fragment. Non-nullable by contract. */
  @property({ attribute: false }) matchRoot!: DocumentFragment;
  /** An optional vocabulary the dialog already built for the match root. */
  @property({ attribute: false }) vocabulary?: SelectorVocabulary;

  /** The simpler equivalents of the last generated selector, for the autocomplete. */
  @state() private equivalents: string[] = [];

  @query('heo-selector-field') private field?: HeoSelectorField;

  /** The tree walk, cached by fragment identity so it is not redone on each keystroke. */
  #rows: TreeRow[] = [];
  #rowsFor: DocumentFragment | null = null;
  /** True when the template has several top-level siblings and needs a synthetic row. */
  #multiRoot = false;
  /**
   * The elements picked by consecutive clicks, so clicks accumulate but a left edit
   * starts fresh.
   *
   * Latest-action-wins: when the last action was typing, the next click begins a new
   * picked set from just that element (it does not add to whatever the typed selector
   * happened to match); consecutive clicks toggle within this set. Cleared on any
   * left-pane edit. Not persisted across dialog opens — the dialog resets the selector.
   */
  #picked: HTMLElement[] = [];
  /** True when the last action was a right-pane click, so the next click accumulates. */
  #lastWasClick = false;
  /** The selector this component last emitted, to tell our own writes from external ones. */
  #lastEmitted: string | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('matchRoot') && this.matchRoot !== this.#rowsFor) {
      this.#rows = this.matchRoot ? buildRows(this.matchRoot) : [];
      this.#rowsFor = this.matchRoot ?? null;
      this.#multiRoot = this.matchRoot ? blockRoots(this.matchRoot).length > 1 : false;
      // A new template invalidates any accumulated picks.
      this.#picked = [];
      this.#lastWasClick = false;
      this.#lastEmitted = null;
    }
    // An external selector write (the dialog reset it, or another surface changed it)
    // ends the click streak so the next click starts fresh from just that element.
    if (changed.has('selector') && this.selector !== this.#lastEmitted) {
      this.#picked = [];
      this.#lastWasClick = false;
    }
  }

  override render(): TemplateResult {
    const matched = new Set(
      this.matchRoot ? matchedBlockElements(this.selector, this.matchRoot) : [],
    );
    const scopeSelected = this.selector.trim() === ':scope';

    return html`
      <span class="eyebrow">WHICH ELEMENTS?</span>
      <div class="which">
        <div>
          <p class="pane-label">Element selector</p>
          <heo-selector-field
            .value=${this.selector}
            .matchRoot=${this.matchRoot}
            .vocabulary=${this.vocabulary}
            .equivalents=${this.equivalents}
            .peek=${false}
            action="Use this element"
            placeholder="choose an element in this block"
            @selector-input=${this.#onFieldInput}
            @selector-submit=${this.#onFieldSubmit}
          ></heo-selector-field>
        </div>
        <div>
          <p class="pane-label">Block template</p>
          <div class="tree" role="tree" aria-label="Block template elements">
            ${this.#rows.length
        ? html`
                  ${this.#multiRoot ? this.#renderSynthetic(scopeSelected) : nothing}
                  ${repeat(
          this.#rows,
          (row) => row.element,
          (row) => this.#renderRow(row, matched),
        )}
                `
        : html`<div class="empty">This block has no elements yet.</div>`}
          </div>
        </div>
      </div>
    `;
  }

  /** The synthetic "Block's top element" row, only for a multi-root template. */
  #renderSynthetic(checked: boolean): TemplateResult {
    return html`<div
      class=${`node synthetic${checked ? ' match' : ''}`}
      role="treeitem"
      aria-level="1"
      aria-checked=${checked}
      aria-selected=${checked}
      style="padding-left: 6px"
    >
      <input
        type="checkbox"
        class="box"
        aria-label="Select the block's top element"
        .checked=${checked}
        @change=${this.#onSyntheticToggle}
      />
      <button class="label" type="button" @click=${this.#onSyntheticToggle}>
        Block's top element
      </button>
    </div>`;
  }

  #renderRow(row: TreeRow, matched: Set<HTMLElement>): TemplateResult {
    const isMatch = matched.has(row.element);
    // A multi-root template indents the real roots one level under the synthetic row.
    const depth = row.depth + (this.#multiRoot ? 1 : 0);
    const level = depth + 1;
    const full = openTagText(row);
    return html`<div
      class=${`node${isMatch ? ' match' : ''}`}
      role="treeitem"
      aria-level=${level}
      aria-checked=${isMatch}
      aria-selected=${isMatch}
      style=${`padding-left: ${6 + depth * 16}px`}
    >
      <input
        type="checkbox"
        class="box"
        aria-label=${`Select ${row.tag}`}
        .checked=${isMatch}
        @change=${() => this.#onRowToggle(row.element)}
      />
      <button
        class="label"
        type="button"
        title=${full}
        @click=${() => this.#onRowToggle(row.element)}
      >
        <span class="punct">&lt;</span><span class="tag">${row.tag}</span>${row.attrs.map(
      (attr) => html` <span class="attr-name">${attr.name}</span><span class="punct">="</span><span
              class="attr-val"
              >${attr.display}</span
            ><span class="punct">"</span>`,
    )}<span class="punct">&gt;</span>
      </button>
    </div>`;
  }

  /* ---------------------------------------------------------------------- */

  #onFieldInput(event: CustomEvent<{ value: string }>): void {
    // A left-pane edit takes over; the next click starts a fresh picked set.
    this.equivalents = [];
    this.#picked = [];
    this.#lastWasClick = false;
    this.#reemit('selector-input', event.detail.value);
  }

  #onFieldSubmit(event: CustomEvent<{ value: string }>): void {
    this.#reemit('selector-submit', event.detail.value);
  }

  /**
   * Toggle an element in the picked set and emit the exact selector for it.
   *
   * A click right after a left edit (or the first click) starts a fresh set holding just
   * this element — the latest action wins, it does not add to whatever the typed selector
   * matched. Consecutive clicks accumulate, so a second click adds a second element.
   */
  #onRowToggle(element: HTMLElement): void {
    const base = this.#lastWasClick ? this.#picked : [];
    const picked = new Set(base);
    if (picked.has(element)) picked.delete(element);
    else picked.add(element);
    this.#picked = [...picked];
    this.#lastWasClick = true;
    this.#emitPicked(this.#picked);
  }

  #onSyntheticToggle(): void {
    // The synthetic row means "the whole top level"; picking it is the bare :scope.
    this.equivalents = [];
    this.#picked = [];
    this.#lastWasClick = false;
    this.#blurField();
    this.#reemit('selector-input', ':scope');
  }

  #emitPicked(picked: HTMLElement[]): void {
    if (!this.matchRoot) return;
    const value = picked.length ? bestBlockSelector(picked, this.matchRoot) : ':scope';
    this.equivalents = picked.length ? readableEquivalents(picked, this.matchRoot) : [];
    // Blur first so the field's :focus-within guard does not swallow the external write.
    this.#blurField();
    this.#reemit('selector-input', value);
  }

  #blurField(): void {
    this.field?.blurInput();
  }

  #reemit(type: 'selector-input' | 'selector-submit', value: string): void {
    this.#lastEmitted = value;
    this.dispatchEvent(
      new CustomEvent(type, { detail: { value }, bubbles: true, composed: true }),
    );
  }
}

/** Build the tree rows from a template fragment, depth-first, elements only. */
function buildRows(fragment: DocumentFragment): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (element: HTMLElement, depth: number): void => {
    rows.push({
      element,
      depth,
      tag: element.tagName.toLowerCase(),
      attrs: attrsOf(element),
    });
    for (const child of Array.from(element.children)) {
      if (child instanceof HTMLElement) walk(child, depth + 1);
    }
  };
  for (const root of blockRoots(fragment)) walk(root, 0);
  return rows;
}

/** The displayable attributes of an element, skipping the overlay's own markers. */
function attrsOf(element: HTMLElement): NodeAttr[] {
  const out: NodeAttr[] = [];
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith('data-heo-')) continue;
    out.push({ name: attr.name, display: truncateValue(attr.value), full: attr.value });
  }
  return out;
}

/**
 * Cut a long attribute value at the last whitespace within the limit, then ellipsis.
 *
 * Falls back to a hard cut when there is no whitespace, so a single long token still
 * truncates. The ellipsis sits inside the quotes; the untruncated value lives in the
 * row's title.
 */
function truncateValue(value: string): string {
  if (value.length <= ATTR_MAX) return value;
  const head = value.slice(0, ATTR_MAX);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head;
  return `${cut} \u2026`;
}

/** The full open-tag text, for the row title (untruncated values). */
function openTagText(row: TreeRow): string {
  const attrs = row.attrs.map((attr) => ` ${attr.name}="${attr.full}"`).join('');
  return `<${row.tag}${attrs}>`;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-which-elements': HeoWhichElements;
  }
}
