import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { listen, unlisten } from '../../core/shield.js';
import { PopoverPlacer } from '../place.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

/** One row in the suggestion list. `label` defaults to `value`. */
export interface SearchSuggestion {
  value: string;
  label?: string;
  /** Right-aligned detail: a count, a resolved value, what kind of thing it is. */
  hint?: string;
  /** Heading this row sits under. Rows are drawn in the order given, grouped by first appearance. */
  group?: string;
  /** Draws the row as present-but-unavailable rather than hiding it. */
  dead?: boolean;
}

/**
 * One box for finding what is there and adding what is not.
 *
 * Every panel had grown its own answer to the same question. The tree had a bare filter bar, the
 * library a bordered pill, the styles panel a hand-rolled dropdown with no keyboard support at all,
 * and the tokens panel had no search of any kind while offering three different "add" forms. Four
 * shapes for one intention, and the differences were accidents of when each was written rather than
 * anything a user could learn from.
 *
 * The pattern this settles on comes from `heo-selector-field`, which got it right first: a field
 * with the search glyph inside it and the creating action at its right edge, so "look for it" and
 * "make it" are one gesture apart instead of in different parts of the panel. That control stays
 * as it is — a CSS selector needs combinators, live match painting and a draft that survives
 * choosing a completion, none of which generalise — and this is the same silhouette for the plain
 * cases.
 *
 * Two modes, because there are two genuinely different jobs:
 *
 * - `filter` narrows a list the panel is already drawing. There is no popover: the results *are*
 *   the panel. The trailing action then means "none of these, make a new one", and panels pair it
 *   with the same offer at the end of the list, since running out of results is exactly when
 *   somebody decides to create one.
 * - `suggest` owns a popover list of things that are not otherwise on screen — CSS property names,
 *   for instance. Choosing a row fills the field rather than committing, so the field is a step
 *   towards an answer and the action button is the answer.
 *
 * Fires `search-input` on every keystroke, `search-pick` when a suggestion is taken, and
 * `search-submit` when the trailing action fires.
 */
@customElement('heo-search-field')
export class HeoSearchField extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        position: relative;
        /* Routinely a grid or flex item in a narrow dock, where an automatic minimum size lets
           the contents decide the column width. It should be the other way round. */
        min-width: 0;
      }

      /* One ring that tightens and turns accent on focus, rather than a border plus a shadow:
         one moving part reads as one control. Matches heo-selector-field deliberately. */
      .wrap {
        display: flex;
        align-items: stretch;
        min-height: 30px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        box-shadow: var(--heo-inset);
        transition:
          border-color var(--heo-fast),
          background var(--heo-fast),
          box-shadow var(--heo-fast);
      }
      .wrap:hover {
        border-color: var(--heo-line-strong);
      }
      .wrap:focus-within {
        border-color: var(--heo-accent-line);
        background: var(--heo-bg);
        box-shadow: 0 0 0 3px var(--heo-accent-soft);
      }

      .sigil {
        display: grid;
        place-items: center;
        width: 26px;
        flex: 0 0 auto;
        color: var(--heo-text-faint);
      }

      input {
        flex: 1 1 auto;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        padding: 0 2px 0 0;
      }
      input:focus {
        outline: none;
      }
      input::placeholder {
        color: var(--heo-text-faint);
      }

      .trailing {
        display: flex;
        align-items: center;
        gap: 3px;
        flex: 0 0 auto;
        padding: 3px;
      }

      .count {
        color: var(--heo-text-faint);
        font-size: 10.5px;
        padding: 0 2px;
        white-space: nowrap;
      }

      /* Clear and chevron: quiet, square, and never focus stops. Tabbing through a panel should
         not land on a button that only undoes what the field already shows. */
      .mini {
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
      .mini:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }

      /* The action, in the accent so it reads as the one thing here that makes something. */
      .go {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 22px;
        padding: 0 7px;
        border: 0;
        border-radius: 5px;
        background: var(--heo-accent-soft);
        color: var(--heo-accent);
        font-size: 11px;
        font-weight: 550;
        white-space: nowrap;
        cursor: pointer;
        transition:
          background var(--heo-fast),
          color var(--heo-fast);
      }
      .go:hover:not(:disabled) {
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      .go:disabled {
        background: transparent;
        color: var(--heo-text-faint);
        cursor: not-allowed;
      }
      .go.bare {
        width: 22px;
        padding: 0;
        justify-content: center;
      }

      /*
       * The popover lives in the top layer.
       *
       * The dock clips its descendants and carries a backdrop filter, which makes it the
       * containing block for anything fixed inside it — so a normally painted list is cut off by
       * the panel it belongs to. Same reasoning, and same solution, as the selector field.
       */
      .popup {
        position: fixed;
        margin: 0;
        padding: 4px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-md);
        background: var(--heo-bg);
        box-shadow: var(--heo-shadow-lg);
        overflow-y: auto;
        overscroll-behavior: contain;
        z-index: 2147483000;
      }
      .popup::backdrop {
        background: transparent;
      }

      .group {
        padding: 6px 7px 3px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .option {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 24px;
        padding: 0 7px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-dim);
        text-align: left;
        cursor: pointer;
      }
      .option:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .option[aria-selected='true'] {
        background: var(--heo-accent-soft);
        box-shadow: inset 0 0 0 1px var(--heo-accent-line);
        color: var(--heo-text);
      }
      .option.dead {
        opacity: 0.5;
      }
      .option .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        font-family: var(--heo-mono);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option .meta {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }

      .none {
        padding: 9px 8px;
        color: var(--heo-text-faint);
        font-size: 11px;
        line-height: 1.5;
      }
    `,
  ];

  /** The committed text. An external write is ignored while the field has focus. */
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = 'Search…';
  /** Accessible name for the input. Panels set it to what they are searching. */
  @property({ type: String }) label = 'Search';
  @property({ type: String }) mode: 'filter' | 'suggest' = 'filter';
  /**
   * Label for the trailing action. Empty means there is no action, which is the right answer for
   * a field that only narrows something — the Code panel has nothing to create.
   */
  @property({ type: String }) action = '';
  @property({ type: String, attribute: 'action-icon' }) actionIcon = 'plus';
  /** Draw the action as an icon alone. For a field too narrow to carry a word. */
  @property({ type: Boolean, attribute: 'action-compact' }) actionCompact = false;
  @property({ type: Boolean, attribute: 'action-disabled' }) actionDisabled = false;
  /** Rows for `suggest` mode. Ignored in `filter` mode, where the panel draws the results. */
  @property({ attribute: false }) suggestions: SearchSuggestion[] = [];
  /**
   * How many things the query is currently matching, shown inside the field. Negative hides it.
   *
   * The panel counts, not this control: in `filter` mode only the panel knows what it drew, and a
   * number this field invented could disagree with the list underneath it.
   */
  @property({ type: Number }) count = -1;

  @state() private draft = '';
  @state() private open = false;
  @state() private highlight = -1;
  @state() private popupStyle = '';
  /** Places the popup, and refuses to let the measurement feed back into the placement. */
  readonly #placer = new PopoverPlacer();

  @query('input') private input!: HTMLInputElement;

  #onScroll = (): void => {
    if (this.open) this.#position();
  };

  #onDocumentDown = (event: Event): void => {
    if (!this.open) return;
    if (event.composedPath().includes(this)) return;
    this.#close();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.draft = this.value;
    // Through `listen`: the event shield suppresses `pointerdown` and `scroll` for the page, and
    // this field needs both to keep its list placed and to dismiss it.
    listen(window, 'scroll', this.#onScroll, true);
    listen(window, 'resize', this.#onScroll);
    listen(document, 'pointerdown', this.#onDocumentDown, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(window, 'scroll', this.#onScroll, true);
    unlisten(window, 'resize', this.#onScroll);
    unlisten(document, 'pointerdown', this.#onDocumentDown, true);
    this.open = false;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    /*
     * The rows are about to change, so the cached height is stale.
     *
     * Without this a list that shrank as the user typed kept the placement of the taller one, and one
     * that grew was placed as though it still fitted.
     */
    if (changed.has('suggestions') || changed.has('value')) this.#placer.invalidate();
    // An external write wins unless the user is mid-edit. `:focus-within` is the question that
    // can be answered from inside a shadow root; `document.activeElement` reports the host.
    if (changed.has('value') && !this.matches(':focus-within')) this.draft = this.value;
  }

  override updated(): void {
    const popup = this.renderRoot.querySelector<HTMLElement>('.popup');
    if (popup && this.open) {
      if (typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
        try {
          popup.showPopover();
        } catch {
          // Already open, or popovers are unsupported: it still renders, just in the normal
          // painting order.
        }
      }
      this.#position();
    }
  }

  override render(): TemplateResult {
    const trimmed = this.draft.trim();
    const suggesting = this.mode === 'suggest';

    return html`
      <div class="wrap">
        <span class="sigil" aria-hidden="true">${icon('search', 13)}</span>
        <input
          type="text"
          .value=${this.draft}
          placeholder=${this.placeholder}
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          role=${suggesting ? 'combobox' : 'searchbox'}
          aria-expanded=${suggesting ? String(this.open) : nothing}
          aria-autocomplete=${suggesting ? 'list' : nothing}
          aria-label=${this.label}
          @input=${this.#onInput}
          @focus=${this.#onFocus}
          @blur=${this.#onBlur}
          @keydown=${this.#onKeyDown}
        />
        <div class="trailing">
          ${this.count >= 0 && trimmed
        ? html`<span class="count">${this.count} found</span>`
        : nothing}
          ${trimmed
        ? html`<button
              class="mini"
              type="button"
              tabindex="-1"
              title="Clear"
              aria-label="Clear ${this.label.toLowerCase()}"
              @pointerdown=${(event: Event) => event.preventDefault()}
              @click=${this.#clear}
            >
              ${icon('close', 11)}
            </button>`
        : nothing}
          ${suggesting
        ? html`<button
              class="mini"
              type="button"
              tabindex="-1"
              title="Show what is available"
              aria-label="Show what is available"
              @pointerdown=${(event: Event) => event.preventDefault()}
              @click=${this.#toggle}
            >
              ${icon('chevronDown', 12)}
            </button>`
        : nothing}
          ${this.action ? this.#renderAction() : nothing}
        </div>
      </div>
      ${suggesting && this.open ? this.#renderPopup() : nothing}
    `;
  }

  #renderAction(): TemplateResult {
    const compact = this.actionCompact;
    return html`<button
      class=${`go${compact ? ' bare' : ''}`}
      type="button"
      title=${this.action}
      aria-label=${this.action}
      ?disabled=${this.actionDisabled}
      @pointerdown=${(event: Event) => event.preventDefault()}
      @click=${this.#submit}
    >
      ${icon(this.actionIcon, 12)}${compact ? nothing : html`<span>${this.action}</span>`}
    </button>`;
  }

  #renderPopup(): TemplateResult {
    const items = this.suggestions;
    if (!items.length) {
      return html`<div class="popup" popover="manual" style=${this.popupStyle} role="listbox">
        <div class="none">Nothing matches that.</div>
      </div>`;
    }

    // Grouped in the order the groups first appear, which is the order the host gave them and
    // therefore the ranking it intended.
    const groups: Array<{ name: string; items: SearchSuggestion[] }> = [];
    for (const item of items) {
      const name = item.group ?? '';
      const existing = groups.find((group) => group.name === name);
      if (existing) existing.items.push(item);
      else groups.push({ name, items: [item] });
    }

    let index = -1;
    return html`<div class="popup" popover="manual" style=${this.popupStyle} role="listbox">
      ${repeat(
      groups,
      (group) => group.name,
      (group) => html`
          ${group.name ? html`<div class="group">${group.name}</div>` : nothing}
          ${repeat(
        group.items,
        (item) => item.value,
        (item) => {
          index += 1;
          const current = index;
          return html`<button
                class=${`option${item.dead ? ' dead' : ''}`}
                type="button"
                role="option"
                aria-selected=${current === this.highlight}
                title=${item.hint ? `${item.value} — ${item.hint}` : item.value}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @pointerenter=${() => {
              this.highlight = current;
            }}
                @click=${() => this.#choose(item)}
              >
                <span class="name">${item.label ?? item.value}</span>
                ${item.hint ? html`<span class="meta">${item.hint}</span>` : nothing}
              </button>`;
        },
      )}
        `,
    )}
    </div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Interaction                                                            */
  /* ---------------------------------------------------------------------- */

  #onInput(event: Event): void {
    this.draft = (event.target as HTMLInputElement).value;
    this.highlight = -1;
    if (this.mode === 'suggest' && !this.open) this.#openList();
    this.#emit('search-input');
  }

  #onFocus(): void {
    if (this.mode === 'suggest') this.#openList();
  }

  /**
   * Deferred, because at `blur` time the element receiving focus is not active yet — an
   * immediate check would tear the list down under a click landing on one of its rows.
   */
  #onBlur(): void {
    setTimeout(() => {
      if (this.matches(':focus-within')) return;
      this.#close();
    }, 120);
  }

  #onKeyDown(event: KeyboardEvent): void {
    const items = this.mode === 'suggest' ? this.suggestions : [];

    if (event.key === 'Escape') {
      event.preventDefault();
      /*
       * Stopped here rather than allowed to bubble.
       *
       * The global keymap reads Escape as "deselect", and dismissing a list — or clearing a
       * filter — is not a request to change what is selected in the page.
       */
      event.stopPropagation();
      if (this.open) {
        this.#close();
        return;
      }
      if (this.draft) {
        this.#clear();
        return;
      }
      this.input?.blur();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = this.open && this.highlight >= 0 ? items[this.highlight] : undefined;
      if (chosen) {
        this.#choose(chosen);
        return;
      }
      this.#submit();
      return;
    }

    if (event.key === 'Tab') {
      const chosen = this.open && this.highlight >= 0 ? items[this.highlight] : undefined;
      if (!chosen) return;
      event.preventDefault();
      this.#choose(chosen);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!items.length) return;
      event.preventDefault();
      if (!this.open) this.#openList();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let next = this.highlight + direction;
      if (next < 0) next = items.length - 1;
      else if (next >= items.length) next = 0;
      this.highlight = next;
    }
  }

  /** Take a suggestion into the field, and stay put so it can be acted on. */
  #choose(item: SearchSuggestion): void {
    this.draft = item.value;
    this.highlight = -1;
    this.#emit('search-input');
    this.#emit('search-pick');
    this.#close();
    this.input?.focus();
  }

  #clear(): void {
    if (!this.draft) return;
    this.draft = '';
    this.highlight = -1;
    this.#emit('search-input');
    this.input?.focus();
  }

  /**
   * Fired by the action button, and by Enter whether or not there is one.
   *
   * A field with no action still has something for Enter to mean. In the Code panel it is "next
   * match", which is what Enter does in every find box ever built — so the guard is on the button
   * being usable, not on the button existing.
   */
  #submit(): void {
    if (this.actionDisabled) return;
    this.#close();
    this.#emit('search-submit');
  }

  #emit(type: 'search-input' | 'search-pick' | 'search-submit'): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail: { value: this.draft }, bubbles: true, composed: true }),
    );
  }

  #toggle(): void {
    if (this.open) {
      this.#close();
      return;
    }
    this.#openList();
    this.input?.focus();
  }

  #openList(): void {
    // One list at a time across every instance. Two popovers in the top layer look like a
    // rendering fault, and only one of them can be the one the keyboard drives.
    for (const other of openLists) if (other !== this) other.close();
    openLists.add(this);
    this.open = true;
    // A fresh opening measures afresh: the rows may differ from last time.
    this.#placer.invalidate();
    requestAnimationFrame(() => {
      if (this.open) this.#position();
    });
  }

  #close(): void {
    openLists.delete(this);
    this.open = false;
    this.highlight = -1;
  }

  /** Close the list from the outside. */
  close(): void {
    this.#close();
  }

  /** Replace the buffer from outside, for a host that has consumed a submission. */
  reset(next = ''): void {
    this.value = next;
    this.draft = next;
    this.#close();
  }

  focusInput(options: { select?: boolean } = {}): void {
    const input = this.input;
    if (!input) return;
    input.focus();
    if (options.select) input.select();
  }

  #position(): void {
    const style = this.#placer.style(this.renderRoot.querySelector<HTMLElement>('.popup'), {
      anchor: this.getBoundingClientRect(),
      minWidth: 220,
    });
    if (style !== null) this.popupStyle = style;
  }
}

/** Every field with an open list, so a second one can close the first. */
const openLists = new Set<HeoSearchField>();

declare global {
  interface HTMLElementTagNameMap {
    'heo-search-field': HeoSearchField;
  }
}
