import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  canCombine,
  COMBINATORS,
  completeSelector,
  countMatches,
  normalizeSelector,
  selectorProblem,
  selectorVocabulary,
  type SelectorCompletion,
  type SelectorVocabulary,
} from '../../core/selectors.js';
import { listen, unlisten } from '../../core/shield.js';
import { ManagedStyleSheet } from '../../core/stylesheet.js';
import { icon } from '../icons.js';
import { anchoredStyle } from '../place.js';
import { baseStyles } from '../theme.js';

/**
 * A field for writing a CSS selector, with the page as its dictionary.
 *
 * Its own control rather than a `heo-value-field` with a different suggestion list, and
 * the reason is one behaviour: **picking a suggestion must not submit.** A value field
 * used as a submit control fires the moment a row is chosen, which is right for "add
 * this class" and wrong here — `h2` is a step towards `h2 > p`, not an answer. So a
 * choice fills the box and leaves the caret in it, ready for the next part.
 *
 * Three other things follow from that, and together they are why this exists:
 *
 * - **Combinators are buttons, not suggestions.** `h2 >` is not a selector, so it can
 *   never be offered as one; but until the `>` is typed there is no way to reach `h2 > p`
 *   at all. A row of chips that extend the draft is the only shape that works.
 * - **The match count is live, and it is the answer to the real question.** "Does this
 *   select what I think it selects" is asked constantly and cannot be answered by looking
 *   at the selector. Zero matches is shown rather than hidden: a rule matching nothing
 *   usually means the structure being described is not the structure the page has.
 * - **What it matches is drawn on the page.** A count says how many; an outline says
 *   which, which is the part that catches `h2 > p` quietly meaning "no paragraph is a
 *   direct child of a heading".
 *
 * Fires `selector-input` as the draft changes and `selector-submit` on commit.
 */
@customElement('heo-selector-field')
export class HeoSelectorField extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        position: relative;
        /* This control is routinely a grid or flex item inside a narrow panel, and an
           automatic minimum size there means its contents decide how wide the column
           gets. It should be the other way round. */
        min-width: 0;
      }

      .shell {
        display: grid;
        /* Not an auto track: that takes its base size from its items' min-content
           contributions and overflows when they do not fit, which is the one thing a
           control this nested must never do. */
        grid-template-columns: minmax(0, 1fr);
        gap: 6px;
      }

      /* The field. A single ring that tightens on focus and turns the accent colour,
         rather than a border plus a shadow: one moving part reads as one control. */
      .wrap {
        display: flex;
        align-items: stretch;
        min-height: 32px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
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
      :host([data-invalid]) .wrap {
        border-color: color-mix(in oklab, var(--heo-danger) 55%, transparent);
      }
      :host([data-invalid]) .wrap:focus-within {
        box-shadow: 0 0 0 3px color-mix(in oklab, var(--heo-danger) 18%, transparent);
      }

      .sigil {
        display: grid;
        place-items: center;
        width: 26px;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 12px;
        user-select: none;
      }
      .wrap:focus-within .sigil {
        color: var(--heo-accent);
      }

      input {
        flex: 1 1 auto;
        min-width: 0;
        padding: 0 2px;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 12px;
        letter-spacing: 0.01em;
      }
      input:focus {
        outline: none;
      }
      input::placeholder {
        color: var(--heo-text-faint);
        font-family: var(--heo-font);
        letter-spacing: 0;
      }

      .trailing {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 3px 3px 3px 0;
      }

      /* How many elements this selector hits, right now. Colour carries the meaning so
         it can be read without stopping to parse a number. */
      .count {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        background: var(--heo-hover);
        color: var(--heo-text-dim);
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: default;
      }
      .count.hit {
        background: color-mix(in oklab, var(--heo-success) 20%, transparent);
        color: color-mix(in oklab, var(--heo-success) 78%, var(--heo-text));
      }
      .count.miss {
        background: color-mix(in oklab, var(--heo-warn) 18%, transparent);
        color: color-mix(in oklab, var(--heo-warn) 80%, var(--heo-text));
      }
      .count .dot {
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: currentColor;
      }

      .mini {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
        padding: 0;
      }
      .mini:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .go {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 6px;
        background: var(--heo-accent-soft);
        color: var(--heo-accent);
        cursor: pointer;
        padding: 0;
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

      /* ---- Combinators ---- */

      /* Wrapping, because this row must never be the widest thing in the field. An
         unwrapped flex row's min-content width is the sum of its children, and a grid
         track sized from that minimum overflows its container rather than clamping —
         which is what pushed the whole control past the edge of a rule card. */
      .combos {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }
      .combo {
        display: grid;
        place-items: center;
        min-width: 26px;
        height: 22px;
        padding: 0 6px;
        border: 1px solid var(--heo-line);
        border-radius: 6px;
        background: var(--heo-raised);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 11px;
        cursor: pointer;
        transition:
          background var(--heo-fast),
          border-color var(--heo-fast),
          color var(--heo-fast);
      }
      .combo:hover:not(:disabled) {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }
      .combo:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
      .combos .lead {
        color: var(--heo-text-faint);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .problem {
        display: flex;
        align-items: center;
        gap: 5px;
        color: color-mix(in oklab, var(--heo-danger) 80%, var(--heo-text));
        font-size: 10.5px;
      }

      /* ---- Popup ----
         Fixed and promoted to the top layer for the same reason the value field does
         it: this control lives inside the dock, which sets overflow and a backdrop
         filter, and either one is enough to clip a normally painted popup. */
      .popup {
        position: fixed;
        inset: auto;
        z-index: 30;
        margin: 0;
        max-height: 340px;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 5px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-md);
        background: var(--heo-raised);
        color: var(--heo-text);
        box-shadow: var(--heo-shadow-lg);
        animation: pop var(--heo-fast);
      }
      .popup:popover-open {
        display: block;
      }
      @keyframes pop {
        from {
          opacity: 0;
          transform: translateY(-3px);
        }
      }
      .group {
        padding: 7px 8px 3px;
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
        padding: 5px 8px;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
      }
      .option:hover,
      .option[aria-selected='true'] {
        background: var(--heo-hover);
      }
      .option[aria-selected='true'] {
        box-shadow: inset 0 0 0 1px var(--heo-accent-line);
      }
      .option .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--heo-mono);
        font-size: 11.5px;
      }
      .option .meta {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 10px;
        white-space: nowrap;
      }
      /* A candidate that selects nothing. Kept in the list, dimmed, because "this
         matches nothing" is information rather than a reason to hide it. */
      .option.dead .name {
        color: var(--heo-text-dim);
      }
      .option.dead .meta {
        color: color-mix(in oklab, var(--heo-warn) 70%, var(--heo-text-faint));
      }
      .none {
        padding: 10px 8px;
        color: var(--heo-text-faint);
        font-size: 11px;
        line-height: 1.5;
      }
    `,
  ];

  /** The committed selector. Assigning it replaces the draft unless one is in flight. */
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = 'h2 > p';
  /** Label for the submit affordance. Also its tooltip. */
  @property({ type: String }) action = 'Use this selector';
  @property({ type: String, attribute: 'action-icon' }) actionIcon = 'check';
  /**
   * Paint an outline over what the selector matches while this field has focus.
   *
   * On by default, and off for the rename field on an existing rule — there the rule is
   * already styling those elements, so a second highlight is noise on top of a change
   * the user can already see.
   */
  @property({ type: Boolean }) peek = true;

  @state() private draft = '';
  @state() private open = false;
  @state() private highlight = -1;
  @state() private popupStyle = '';

  @query('input') private input!: HTMLInputElement;

  /**
   * The page's tags, classes and ids, cached for as long as the list is open.
   *
   * Built by walking every element in the document, which is not something to redo on
   * each keystroke. Rebuilt whenever the list is opened, so a page that changed since
   * the last time is still described correctly — the staleness window is one interaction.
   */
  #vocabulary: SelectorVocabulary | null = null;
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
    // Through `listen`, for the reason the value field documents: the shield suppresses
    // `pointerdown` and `scroll` for the page, and this field needs both.
    listen(window, 'scroll', this.#onScroll, true);
    listen(window, 'resize', this.#onScroll);
    listen(document, 'pointerdown', this.#onDocumentDown, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(window, 'scroll', this.#onScroll, true);
    unlisten(window, 'resize', this.#onScroll);
    unlisten(document, 'pointerdown', this.#onDocumentDown, true);
    // The outline is drawn on the page, not in this shadow root, so it does not go
    // away with the component. Every teardown path has to clear it.
    clearPeek(this);
    this.open = false;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // An external write wins unless the user is mid-edit, matching `heo-value-field`.
    // `:focus-within` is the question that can be answered from inside a shadow root;
    // `document.activeElement` reports the outermost host and is always this element.
    if (changed.has('value') && !this.matches(':focus-within')) this.draft = this.value;
    const problem = selectorProblem(this.draft);
    this.toggleAttribute('data-invalid', Boolean(problem));
  }

  override updated(): void {
    const popup = this.renderRoot.querySelector<HTMLElement>('.popup');
    if (popup && this.open) {
      if (typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
        try {
          popup.showPopover();
        } catch {
          // Already open, or popovers are unsupported: it still renders, just in the
          // normal painting order.
        }
      }
      this.#position();
    }
    if (this.peek) paintPeek(this, this.matches(':focus-within') ? this.draft : '');
  }

  /* ---------------------------------------------------------------------- */

  private get completions(): SelectorCompletion[] {
    this.#vocabulary ??= selectorVocabulary();
    return completeSelector(this.draft, this.#vocabulary);
  }

  override render(): TemplateResult {
    const problem = selectorProblem(this.draft);
    const trimmed = this.draft.trim();
    const matches = problem || !trimmed ? 0 : countMatches(trimmed);
    const submittable = Boolean(trimmed) && !problem;

    return html`
      <div class="shell">
        <div class="wrap">
          <span class="sigil" aria-hidden="true">${icon('search', 12)}</span>
          <input
            type="text"
            .value=${this.draft}
            placeholder=${this.placeholder}
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            role="combobox"
            aria-expanded=${this.open}
            aria-autocomplete="list"
            aria-label="CSS selector"
            aria-invalid=${problem ? 'true' : 'false'}
            @input=${this.#onInput}
            @focus=${this.#onFocus}
            @blur=${this.#onBlur}
            @keydown=${this.#onKeyDown}
          />
          <div class="trailing">
            ${trimmed && !problem ? this.#renderCount(matches) : nothing}
            <button
              class="mini"
              type="button"
              tabindex="-1"
              title="Show what this page offers"
              aria-label="Show what this page offers"
              @pointerdown=${(event: Event) => event.preventDefault()}
              @click=${this.#toggle}
            >
              ${icon('chevronDown', 12)}
            </button>
            <button
              class="go"
              type="button"
              title=${this.action}
              aria-label=${this.action}
              ?disabled=${!submittable}
              @pointerdown=${(event: Event) => event.preventDefault()}
              @click=${this.#submit}
            >
              ${icon(this.actionIcon, 12)}
            </button>
          </div>
        </div>

        ${this.#renderCombinators()}
        ${problem
        ? html`<p class="problem">${icon('alert', 11)} ${problem}</p>`
        : nothing}
      </div>
      ${this.open ? this.#renderPopup() : nothing}
    `;
  }

  #renderCount(matches: number): TemplateResult {
    const tone = matches > 0 ? 'hit' : 'miss';
    return html`<span
      class=${`count ${tone}`}
      title=${matches > 0
        ? `${matches} element${matches === 1 ? '' : 's'} on this page match, and are outlined while this field has focus`
        : 'Nothing on this page matches this selector yet'}
    >
      <span class="dot"></span>${matches > 0 ? `${matches} match${matches === 1 ? '' : 'es'}` : 'no match'}
    </span>`;
  }

  /**
   * The combinators, as one-tap extensions of the draft.
   *
   * Disabled rather than hidden when the draft cannot take one. A row that appears and
   * disappears as you type moves everything under it; a row that dims explains itself.
   */
  #renderCombinators(): TemplateResult {
    const allowed = canCombine(this.draft);
    return html`<div class="combos">
      <span class="lead">then</span>
      ${COMBINATORS.map(
      (combo) => html`<button
          class="combo"
          type="button"
          tabindex="-1"
          ?disabled=${!allowed}
          title=${allowed
          ? `${combo.hint} — appends "${combo.value.trim() || 'a space'}"`
          : 'Name something first, then combine it with what comes next'}
          aria-label=${combo.hint}
          @pointerdown=${(event: Event) => event.preventDefault()}
          @click=${() => this.#append(combo.value)}
        >
          ${combo.label}
        </button>`,
    )}
    </div>`;
  }

  #renderPopup(): TemplateResult {
    const items = this.completions;
    if (!items.length) {
      return html`<div class="popup" popover="manual" style=${this.popupStyle} role="listbox">
        <div class="none">
          Nothing in this page matches that. Any selector still works — press Enter to use
          what you typed.
        </div>
      </div>`;
    }

    // Grouped in the order the groups first appear, which is the order
    // `completeSelector` decided and therefore the ranking it intended.
    const groups: Array<{ name: string; items: SelectorCompletion[] }> = [];
    for (const item of items) {
      const existing = groups.find((group) => group.name === item.group);
      if (existing) existing.items.push(item);
      else groups.push({ name: item.group, items: [item] });
    }

    let index = -1;
    return html`<div class="popup" popover="manual" style=${this.popupStyle} role="listbox">
      ${repeat(
      groups,
      (group) => group.name,
      (group) => html`
          <div class="group">${group.name}</div>
          ${repeat(
        group.items,
        (item) => item.value,
        (item) => {
          index += 1;
          const current = index;
          return html`<button
                class=${`option${item.matches === 0 ? ' dead' : ''}`}
                type="button"
                role="option"
                aria-selected=${current === this.highlight}
                title=${`${item.value} — ${item.hint}`}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @pointerenter=${() => {
              this.highlight = current;
            }}
                @click=${() => this.#choose(item)}
              >
                <span class="name">${item.label}</span>
                <span class="meta">
                  ${item.matches === 0 ? 'matches nothing' : `${item.matches}×`}
                </span>
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
    if (!this.open) this.#openList();
    this.#emitInput();
  }

  #onFocus(): void {
    this.#openList();
  }

  /**
   * Leaving does not commit, and does not keep the outline up.
   *
   * The asymmetry with `heo-value-field` is deliberate: there, looking away means "that
   * is my value". Here a half-written selector is the normal state of the field, and
   * committing one would create a rule for `h2 >`. Submission is always explicit.
   *
   * Deferred, because at `blur` time the element receiving focus is not active yet — an
   * immediate check would tear the list down under a click landing on one of its rows.
   */
  #onBlur(): void {
    setTimeout(() => {
      if (this.matches(':focus-within')) return;
      this.#close();
      clearPeek(this);
    }, 120);
  }

  #onKeyDown(event: KeyboardEvent): void {
    const items = this.completions;

    if (event.key === 'Escape') {
      event.preventDefault();
      // Stopped here rather than allowed to bubble: the global keymap reads Escape as
      // "deselect", and a list being dismissed is not a request to change the selection.
      event.stopPropagation();
      if (this.open) {
        this.#close();
        return;
      }
      this.draft = this.value;
      this.#emitInput();
      this.dispatchEvent(new CustomEvent('selector-cancel', { bubbles: true, composed: true }));
      this.input.blur();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      // A highlighted row is a choice; it fills the field rather than submitting, so
      // Enter twice is "take this, then use it" — which is what chaining a selector
      // together feels like.
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

  /** Take a completion into the field, and stay put so the next part can be added. */
  #choose(item: SelectorCompletion): void {
    this.draft = item.value;
    this.highlight = -1;
    this.#emitInput();
    // Re-opened rather than closed: having picked `h2`, the next thing wanted is a
    // combinator or a narrowing class, and both are in this list.
    this.#openList();
    this.input?.focus();
  }

  /** Extend the draft with a combinator, keeping focus and reopening the list. */
  #append(text: string): void {
    if (!canCombine(this.draft)) return;
    this.draft = `${this.draft.trimEnd()}${text}`;
    this.highlight = -1;
    this.#emitInput();
    this.#openList();
    this.input?.focus();
  }

  #submit(): void {
    const next = normalizeSelector(this.draft);
    if (!next || selectorProblem(next)) return;
    this.#close();
    this.dispatchEvent(
      new CustomEvent('selector-submit', {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #emitInput(): void {
    this.dispatchEvent(
      new CustomEvent('selector-input', {
        detail: { value: this.draft },
        bubbles: true,
        composed: true,
      }),
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
    // One list at a time across every instance. Two popovers in the top layer look
    // like a rendering fault, and only one of them can be the one the keyboard drives.
    for (const other of openLists) if (other !== this) other.close();
    openLists.add(this);
    // Rebuilt on open so a page that has changed is described correctly.
    this.#vocabulary = null;
    this.open = true;
    requestAnimationFrame(() => {
      if (this.open) this.#position();
    });
  }

  #close(): void {
    this.#closeQuietly();
  }

  #closeQuietly(): void {
    openLists.delete(this);
    this.open = false;
    this.highlight = -1;
  }

  /** Close the list from the outside. */
  close(): void {
    this.#closeQuietly();
  }

  #position(): void {
    this.popupStyle = anchoredStyle({
      anchor: this.getBoundingClientRect(),
      popup: this.renderRoot.querySelector('.popup')?.getBoundingClientRect(),
      estimate: 260,
      minWidth: 240,
    });
  }

  /**
   * Replace the buffer from outside, for a host that has consumed a submission.
   *
   * `value` alone cannot do it while the field has focus, by design — an in-flight edit
   * is protected from external writes.
   */
  reset(next = ''): void {
    this.value = next;
    this.draft = next;
    this.#closeQuietly();
  }

  focusInput(options: { select?: boolean } = {}): void {
    const input = this.input;
    if (!input) return;
    input.focus();
    if (options.select) input.select();
  }
}

/** Every field with an open list, so a second one can close the first. */
const openLists = new Set<HeoSelectorField>();

/* -------------------------------------------------------------------------- */
/* Showing what a selector matches                                             */
/* -------------------------------------------------------------------------- */

/**
 * The outline drawn over matching elements, as one stylesheet rule.
 *
 * A rule rather than attributes on the elements, and the difference matters more than
 * it looks. Marking elements means a DOM write per match on every keystroke, on a page
 * whose mutations the editor is watching — so each one would be attributed, undone and
 * re-applied, and a selector like `*` would touch every node in the document. A single
 * declaration hands the whole job to the engine that already does it, for one text
 * assignment.
 *
 * `internal` keeps it out of the export and out of the cascade inspector: it describes
 * an editor that will not be there when the file is opened.
 */
const peekSheet = new ManagedStyleSheet('heo-selector-peek', { internal: true });

/** Which field owns the outline, so a stale one cannot clear a live one. */
let peekOwner: HeoSelectorField | null = null;

function paintPeek(field: HeoSelectorField, selector: string): void {
  const text = selector.trim();
  if (!text || selectorProblem(text)) {
    if (peekOwner === field) clearPeek(field);
    return;
  }
  peekOwner = field;
  /*
   * `:not()` guards, because the overlay is in the document too.
   *
   * A selector as ordinary as `div` matches the editor's own chrome, and outlining the
   * dock while typing a rule for the page is both alarming and useless. The host element
   * is excluded along with everything the page marked as off limits, which is the same
   * pair `countMatches` skips — so the outline and the number agree about what counts.
   */
  peekSheet.write(
    `${text}:not(html-editor-overlay, html-editor-overlay *, [data-heo-ignore], [data-heo-ignore] *) {\n` +
    '  outline: 2px dashed color-mix(in oklab, currentColor 35%, #6366f1) !important;\n' +
    '  outline-offset: 2px !important;\n' +
    '}',
  );
}

function clearPeek(field: HeoSelectorField): void {
  if (peekOwner !== field && peekOwner !== null) return;
  peekOwner = null;
  peekSheet.write('');
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-selector-field': HeoSelectorField;
  }
}
