import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { DIRTY_ATTR, EDIT_DISCARDED_EVENT } from '../../core/constants.js';
import { formatLength, nextUnit, parseLength, toHexColor } from '../../core/css.js';
import { listen, unlisten } from '../../core/shield.js';
import { icon } from '../icons.js';
import { baseStyles, swatchStyle } from '../theme.js';

export interface ValueSuggestion {
  value: string;
  label?: string;
  /** Secondary text, e.g. a token's resolved value or a usage count. */
  hint?: string;
  /** Section heading. Suggestions are rendered in the order groups first appear. */
  group: string;
  /** Colour to show as a swatch. */
  swatch?: string;
  /** Renders the token affordance and marks the value as design-system-backed. */
  token?: boolean;
  /**
   * Context rather than a choice.
   *
   * Shown in the list but never pre-highlighted and never reachable with the arrow
   * keys, because picking it is not what the user is looking for — the resolved
   * value of an expression is something to read, not something to switch to.
   */
  info?: boolean;
}

export type ValueKind = 'text' | 'length' | 'number' | 'color' | 'keyword';

/**
 * The overlay's primary value control.
 *
 * One field handles every CSS value because the interaction that matters is the
 * same in all cases: show what design tokens are already available, make picking
 * one the path of least resistance, but never block a custom value. On top of
 * that it adds the numeric affordances a style editor needs — drag to scrub,
 * arrow keys to step, click to cycle units — so common adjustments do not
 * require typing at all.
 *
 * Fires `value-input` continuously (for live preview) and `value-change` on
 * commit (for the undo stack). Set `action` to turn it into a submit control,
 * which fires `value-submit` instead — see that property.
 */
@customElement('heo-value-field')
export class HeoValueField extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        position: relative;
      }

      .wrap {
        display: flex;
        align-items: stretch;
        height: 28px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        transition:
          border-color var(--heo-fast),
          background var(--heo-fast);
      }
      .wrap:hover {
        border-color: var(--heo-line-strong);
      }
      .wrap:focus-within {
        border-color: var(--heo-accent-line);
        background: var(--heo-bg);
      }
      :host([data-token]) .wrap {
        background: var(--heo-accent-soft);
        border-color: var(--heo-accent-line);
      }

      /* Drag-to-scrub target. Doubles as the property label so the control stays
         compact while giving the gesture a generous hit area. */
      .scrub {
        display: flex;
        align-items: center;
        padding: 0 7px;
        border: 0;
        border-right: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm) 0 0 var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
        cursor: ew-resize;
        touch-action: none;
        user-select: none;
        transition: color var(--heo-fast);
      }
      .scrub:hover,
      .scrub.active {
        color: var(--heo-accent);
      }
      .scrub.plain {
        cursor: default;
      }

      input {
        flex: 1 1 auto;
        min-width: 0;
        padding: 0 6px;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
      }
      input:focus {
        outline: none;
      }
      input::placeholder {
        color: var(--heo-text-faint);
        font-family: var(--heo-font);
      }

      /* A generous strip rather than a hairline: it is the affordance for opening
         the list, so it has to be aimable even when it holds no chip. */
      .trailing {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 2px;
        min-width: 14px;
        padding-right: 3px;
        padding-left: 2px;
      }
      .trailing.actionable {
        cursor: pointer;
      }
      .unit {
        height: 20px;
        padding: 0 5px;
        border: 0;
        border-radius: 5px;
        background: var(--heo-hover);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10px;
        cursor: pointer;
      }
      .unit:hover {
        background: var(--heo-active);
        color: var(--heo-text);
      }
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

      /* Submit affordance, shown only when the field is used as an "add" control. */
      .action {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 0;
        border-radius: 5px;
        background: var(--heo-accent-soft);
        color: var(--heo-accent);
        cursor: pointer;
        transition:
          background var(--heo-fast),
          color var(--heo-fast);
      }
      .action:hover:not(:disabled) {
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      .action:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .color-btn {
        display: grid;
        place-items: center;
        width: 26px;
        border: 0;
        border-right: 1px solid var(--heo-line);
        background: transparent;
        cursor: pointer;
        padding: 0;
      }
      .color-btn .swatch {
        width: 15px;
        height: 15px;
      }
      input[type='color'] {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }

      /* ---- Popup ---- */

      /* Rendered as a popover so it is painted in the top layer. The field lives
         inside the dock, which sets backdrop-filter and overflow: hidden — that
         makes the dock the containing block for fixed descendants and clips them,
         so a plain fixed popup ended up hundreds of pixels off and invisible. The
         top layer is positioned against the viewport and is never clipped by an
         ancestor, which is the only reliable way out of that box.

         Manual rather than auto: light dismiss would close the list on a click
         anywhere else in the overlay, including the panel scrollbar, and it claims
         Escape — which this field needs for "revert what I typed". Dismissal is
         driven by focus instead, which every open path guarantees. */
      .popup {
        position: fixed;
        inset: auto;
        z-index: 30;
        margin: 0;
        max-height: 320px;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 4px;
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
        padding: 6px 8px 3px;
        color: var(--heo-text-faint);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .option {
        display: flex;
        align-items: center;
        gap: 7px;
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
        font-size: 11px;
      }
      .option .meta {
        flex: 0 0 auto;
        max-width: 40%;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option .tokenmark {
        color: var(--heo-accent);
      }
      /* The resolved value of an expression: a reading, not an option. Its formula
         gets the room, since that is the part worth recognising. */
      .option.info {
        cursor: default;
      }
      .option.info .name {
        flex: 0 0 auto;
        max-width: 45%;
        color: var(--heo-text-dim);
      }
      .option.info .meta {
        flex: 1 1 auto;
        max-width: none;
        color: var(--heo-accent);
        font-family: var(--heo-mono);
        text-align: right;
      }
      .option.info:hover {
        background: transparent;
      }
      .none {
        padding: 10px 8px;
        color: var(--heo-text-faint);
        font-size: 11px;
      }
    `,
  ];

  @property({ type: String }) label = '';
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = '';
  @property({ type: String }) kind: ValueKind = 'text';
  @property({ attribute: false }) suggestions: ValueSuggestion[] = [];
  /** Show the unit chip and enable scrubbing. Inferred from `kind` by default. */
  @property({ type: Boolean }) numeric = false;
  @property({ type: Boolean }) clearable = false;
  /**
   * The CSS property being edited, when there is one.
   *
   * Used to decide whether what the user typed is already a value the browser
   * accepts. That is what separates "I am searching for a token" from "I am
   * typing a literal", and therefore what Enter should do.
   */
  @property({ type: String }) property = '';
  /**
   * What the browser resolves the current value to.
   *
   * Shown as the first row of the list whenever it differs from what is typed, so
   * `min(980px, calc(100% - var(--space-xl)))` can stay on screen as the authored
   * intent while `948px` is one click away. Picking it replaces the expression with
   * the number, which is occasionally what you want and never a surprise.
   */
  @property({ type: String }) computed = '';
  /**
   * Turns the field into a submit control.
   *
   * Set it to the action's description ("Add this class") and the field grows a
   * trailing action button, Enter submits whatever is typed, and picking a
   * suggestion submits it too. The distinction from the default behaviour
   * matters: a value field commits a value and dedupes against the one it
   * already has, whereas a submit control has to fire every time even when the
   * host keeps handing the same buffer back.
   */
  @property({ type: String }) action = '';
  @property({ type: String, attribute: 'action-icon' }) actionIcon = 'plus';

  @state() private draft = '';
  @state() private open = false;
  @state() private highlight = -1;
  @state() private scrubbing = false;
  @state() private popupStyle = '';

  @query('input[type="text"]') private textInput!: HTMLInputElement;
  @query('input[type="color"]') private colorInput?: HTMLInputElement;

  #scrubStart = { x: 0, value: 0, unit: 'px' };
  /**
   * Whether the highlight was moved with the arrow keys.
   *
   * Typing pre-highlights the best match so Enter can accept it, but that guess
   * must never override something the user aimed at deliberately.
   */
  #highlightMoved = false;
  #blurTimer: ReturnType<typeof setTimeout> | undefined;
  /** The last value this field committed, to tell an echo from an external change. */
  #lastCommitted = '';
  #onScroll = (): void => {
    if (this.open) this.#positionPopup();
  };

  /**
   * Close on a press anywhere else.
   *
   * Blur alone is not enough: opening a second field's list starts with a
   * `preventDefault`ed pointerdown so the caret is not lost, which means the first
   * field never blurs and its list stays up. Two popovers in the top layer at once,
   * one of them stale. Capture phase so this runs before the press is acted on.
   */
  #onFocusOutBound = (): void => this.#onFocusOut();
  #onDocumentDown = (event: Event): void => {
    if (!this.open) return;
    if (event.composedPath().includes(this)) return;
    this.open = false;
    this.highlight = -1;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.draft = this.value;
    // Through `listen` so the event shield never gates the overlay's own housekeeping:
    // `pointerdown` and `scroll` are both types it suppresses for the page, and this
    // field needs them to dismiss its list and keep it positioned.
    listen(window, 'scroll', this.#onScroll, true);
    listen(window, 'resize', this.#onScroll);
    listen(document, 'pointerdown', this.#onDocumentDown, true);
    listen(document, EDIT_DISCARDED_EVENT, this.#onEditDiscarded);
    if (this.hasUpdated) this.#watchFocus();
  }

  /**
   * Undo took back the edit being typed here, so let go of the draft.
   *
   * The engine has already put the page back; without this the box would keep showing
   * the text that was just taken back, and looking away would commit it all over again.
   */
  #onEditDiscarded = (): void => {
    if (!this.hasAttribute(DIRTY_ATTR)) return;
    this.draft = this.value;
  };

  /**
   * Listen for focus moves on the shadow root, not on the host.
   *
   * `focusout` is composed, but the platform trims its propagation path when focus
   * moves between two elements of the *same* shadow tree — internal focus changes
   * are not the outside world's business. Every move this field cares about is
   * exactly that kind: input to chevron, list row to clear button. Bound to the root
   * of the tree, all of them are visible; bound to the host, none of them are.
   */
  #watchFocus(): void {
    this.renderRoot.addEventListener('focusout', this.#onFocusOutBound);
  }

  override firstUpdated(): void {
    this.#watchFocus();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(window, 'scroll', this.#onScroll, true);
    unlisten(window, 'resize', this.#onScroll);
    unlisten(document, 'pointerdown', this.#onDocumentDown, true);
    unlisten(document, EDIT_DISCARDED_EVENT, this.#onEditDiscarded);
    this.renderRoot?.removeEventListener('focusout', this.#onFocusOutBound);
    // The deferred blur would otherwise commit from a detached element, and a
    // still-open flag would re-promote the popover if Lit reuses this instance.
    clearTimeout(this.#blurTimer);
    openFields.delete(this);
    this.open = false;
    this.highlight = -1;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // Adopt an external value change unless the user is mid-edit. `:focus-within`
    // is the question that can actually be answered here: `document.activeElement`
    // reports the outermost shadow host, so comparing it against this element was
    // always false and every host re-render clobbered the buffer being typed.
    //
    // Focus is not a veto, though — only a tie-breaker. A new value that this field
    // did not produce came from somewhere else, and undo is the case that matters:
    // pressing Mod+Z with the caret still in the field restored the page but left the
    // box showing the text that had just been undone.
    if (changed.has('value') && (!this.#hasFocus() || this.value.trim() !== this.#lastCommitted)) {
      this.draft = this.value;
    }
    if (changed.has('value')) {
      this.toggleAttribute('data-token', this.value.includes('var(--'));
    }
    /*
     * Announce an uncommitted edit, as an attribute.
     *
     * The global keymap listens in the capture phase, so a control cannot claim a key
     * by stopping propagation — the decision has to be made before the event arrives.
     * An attribute lets that decision be made without the keymap knowing what a value
     * field is: it looks for a marked control in the event's path, the same way it
     * already recognises a textarea.
     *
     * What it buys is a correct answer to "what is the most recent edit". While this
     * is set, the typing in this box is more recent than anything in the undo stack,
     * so Mod+Z belongs to the box.
     */
    this.toggleAttribute(DIRTY_ATTR, this.draft.trim() !== this.value.trim());
  }

  /**
   * Move the popup into the top layer once it exists.
   *
   * Done here rather than in `render()` because `showPopover` needs the element
   * to be in the document, and the measurement that positions it needs the
   * popover to be laid out.
   */
  override updated(): void {
    const popup = this.renderRoot.querySelector<HTMLElement>('.popup');
    if (!popup || !this.open) return;
    if (typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
      try {
        popup.showPopover();
      } catch {
        // Already open, or popovers are unsupported: the popup still renders,
        // it just stays in the normal painting order.
      }
    }
    this.#positionPopup();
  }

  /** True when focus is inside this component, across the shadow boundary. */
  #hasFocus(): boolean {
    return this.matches(':focus-within');
  }

  /**
   * True while the list has a reason to stay open.
   *
   * Narrower than "focus is somewhere in this field". A list belongs to the text
   * input that drives it and to its own rows; the chevron, the clear button, the unit
   * chip and the colour swatch are all siblings of the input, not part of the
   * editing context, so landing on one of them ends the list. Anything looser leaves
   * a list standing over a control that has nothing to do with it.
   *
   * `shadowRoot.activeElement` is the right question here: it names the element
   * inside *this* shadow tree that holds focus, which is exactly the distinction
   * `:focus-within` on the host flattens away.
   */
  #focusKeepsListOpen(): boolean {
    const active = this.shadowRoot?.activeElement;
    if (!active) return false;
    if (active === this.textInput) return true;
    const popup = this.renderRoot.querySelector('.popup');
    return Boolean(popup && (active === popup || popup.contains(active)));
  }

  private get isNumeric(): boolean {
    return this.numeric || this.kind === 'length' || this.kind === 'number';
  }

  /** True when there is a list worth showing, i.e. when opening it does something. */
  get #canOpen(): boolean {
    return (
      this.suggestions.length > 0 || this.isNumeric || this.#computedSuggestion().length > 0
    );
  }

  private get parsed(): { number: number; unit: string } | null {
    return parseLength(this.draft);
  }

  /**
   * The resolved value, when it is worth stating.
   *
   * Only when it actually differs from what is written: repeating `16px` back as
   * `16px` is noise, whereas `auto` → `948px` or a `calc()` → `948px` is the answer
   * to why the box is the size it is.
   */
  #computedSuggestion(): ValueSuggestion[] {
    const resolved = this.computed.trim();
    const raw = this.draft.trim();
    if (!resolved || resolved === raw) return [];
    return [
      {
        // The authored expression, not the number. Selecting this row — or pressing
        // Enter while it happens to be under the cursor — must never flatten
        // `var(--ink-muted)` into `rgb(71, 84, 103)`: the formula is the thing worth
        // keeping, and the resolved value is only here to say what it comes to.
        value: raw,
        label: resolved,
        hint: raw || 'inherited',
        group: 'Computed',
        info: true,
      },
    ];
  }

  private get filtered(): ValueSuggestion[] {
    const needle = this.draft.trim().toLowerCase();
    const units = this.#unitSuggestions();
    const all = this.suggestions;
    if (!needle) return [...this.#computedSuggestion(), ...units, ...all];

    const scored = all.filter(
      (item) =>
        item.value.toLowerCase().includes(needle) ||
        (item.label ?? '').toLowerCase().includes(needle),
    );
    // An exact-prefix match on the label is what the user is most likely after.
    scored.sort((a, b) => {
      const aHit = (a.label ?? a.value).toLowerCase().startsWith(needle) ? 1 : 0;
      const bHit = (b.label ?? b.value).toLowerCase().startsWith(needle) ? 1 : 0;
      return bHit - aHit;
    });
    // Units come first: having typed a bare number, a unit is the only thing that
    // makes the value usable, so it should be one keystroke away. Any static
    // suggestion a unit already covers is dropped rather than listed twice.
    const unitValues = new Set(units.map((unit) => unit.value));
    // The resolved value leads even while filtering: it is context for what is being
    // typed rather than a match for it.
    return [
      ...this.#computedSuggestion(),
      ...units,
      ...scored.filter((item) => !unitValues.has(item.value)),
    ];
  }

  /**
   * Unit completions for a bare number.
   *
   * `12` on a length property is not a value at all, so offering `12px`, `12rem`
   * and friends turns the most common half-finished input into a single choice
   * rather than something the user has to finish typing correctly.
   */
  #unitSuggestions(): ValueSuggestion[] {
    if (!this.isNumeric || this.kind === 'number') return [];
    const match = /^(-?[\d.]+)([a-z%]*)$/i.exec(this.draft.trim());
    if (!match) return [];
    const [, number, typed] = match;
    const candidates = ['px', 'rem', 'em', '%', 'vw', 'vh', 'ch'];
    return candidates
      // Once a unit is typed, only offer the ones that extend it.
      .filter((unit) => !typed || (unit.startsWith(typed.toLowerCase()) && unit !== typed.toLowerCase()))
      .map((unit) => ({
        value: `${number}${unit}`,
        label: `${number}${unit}`,
        hint: UNIT_HINTS[unit],
        group: 'Units',
      }));
  }

  /** True when the draft is already something the browser would accept. */
  #draftIsComplete(): boolean {
    const raw = this.draft.trim();
    if (!raw) return false;
    // A submit control takes free text: whatever was typed is what the user meant,
    // so a fuzzy match must never hijack Enter.
    if (this.action) return true;
    if (raw.includes('var(--')) return true;
    if (!this.property) return this.suggestions.some((item) => item.value === raw);
    try {
      return CSS.supports(this.property, raw);
    } catch {
      return false;
    }
  }

  override render(): TemplateResult {
    const parsed = this.parsed;
    const showUnit = this.isNumeric && parsed !== null && this.kind !== 'number';
    const isColor = this.kind === 'color';

    return html`
      <div class="wrap">
        ${isColor ? this.#renderColorButton() : nothing}
        ${this.label
        ? html`<button
              class="scrub ${this.scrubbing ? 'active' : ''} ${this.isNumeric ? '' : 'plain'}"
              @pointerdown=${this.#onScrubStart}
              title=${this.isNumeric
            ? `${this.label} — drag left or right to change, or use the arrow keys`
            : this.label}
              tabindex="-1"
              type="button"
            >
              ${this.label}
            </button>`
        : nothing}
        <input
          type="text"
          .value=${this.draft}
          placeholder=${this.placeholder || 'auto'}
          spellcheck="false"
          autocomplete="off"
          role="combobox"
          aria-expanded=${this.open}
          aria-autocomplete="list"
          @input=${this.#onInput}
          @focus=${this.#onFocus}
          @keydown=${this.#onKeyDown}
        />
        <div
          class=${`trailing${this.#canOpen ? ' actionable' : ''}`}
          title=${this.#canOpen ? 'Show tokens and values' : ''}
          @pointerdown=${this.#onTrailingDown}
          @click=${this.#onTrailingClick}
        >
          ${showUnit
        ? html`<button
                class="unit"
                type="button"
                tabindex="-1"
                title="Cycle the unit"
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#cycleUnit}
              >
                ${parsed!.unit || '—'}
              </button>`
        : nothing}
          ${this.clearable && this.draft
        ? html`<button
                class="mini"
                type="button"
                tabindex="-1"
                title="Clear"
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#clear}
              >
                ${icon('close', 11)}
              </button>`
        : nothing}
          ${this.#canOpen
        ? html`<button
                class="mini"
                type="button"
                tabindex="-1"
                title="Show tokens and values"
                aria-label="Show tokens and values"
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#toggleOpen}
              >
                ${icon('chevronDown', 12)}
              </button>`
        : nothing}
          ${this.action
        ? html`<button
                class="action"
                type="button"
                title=${this.action}
                aria-label=${this.action}
                ?disabled=${!this.draft.trim()}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#submit}
              >
                ${icon(this.actionIcon, 12)}
              </button>`
        : nothing}
        </div>
      </div>
      ${this.open ? this.#renderPopup() : nothing}
    `;
  }

  #renderColorButton(): TemplateResult {
    const resolved = this.#resolvedColor();
    return html`
      <button
        class="color-btn"
        type="button"
        tabindex="-1"
        title="Pick a colour"
        aria-label="Pick a colour"
        @click=${() => this.colorInput?.click()}
      >
        <span class="swatch" style=${swatchStyle(resolved)}></span>
      </button>
      <input
        type="color"
        .value=${toHexColor(resolved, '#000000')}
        @input=${this.#onColorInput}
        @change=${this.#onColorChange}
        tabindex="-1"
        aria-hidden="true"
      />
    `;
  }

  #renderPopup(): TemplateResult {
    const items = this.filtered;
    if (!items.length) {
      return html`<div class="popup" popover="manual" style=${this.popupStyle} role="listbox">
        <div class="none">
          ${this.action
          ? 'No matching name. Press Enter to use what you typed.'
          : 'No matching token. Press Enter to keep your own value.'}
        </div>
      </div>`;
    }

    // Group while preserving the order groups first appear in.
    const groups: Array<{ name: string; items: ValueSuggestion[] }> = [];
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
        (item) => `${group.name}:${item.value}`,
        (item) => {
          index += 1;
          const current = index;
          return html`<button
                class=${`option${item.info ? ' info' : ''}`}
                type="button"
                role="option"
                aria-selected=${current === this.highlight}
                title=${item.info
              ? `${item.label} — what ${item.hint} currently resolves to. Selecting this keeps the expression.`
              : (item.hint ?? item.value)}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @pointerenter=${() => {
              if (item.info) return;
              // Once the arrow keys have been used they own the highlight. Letting
              // the pointer move it would make the selected row and the row Tab
              // takes disagree — and a mouse resting anywhere over the list would
              // quietly redirect a keyboard choice. Clicking a row still works
              // regardless; that is an explicit act.
              if (this.#highlightMoved) return;
              this.highlight = current;
            }}
                @click=${() => this.#choose(item)}
              >
                ${item.swatch
              ? html`<span class="swatch" style=${swatchStyle(item.swatch)}></span>`
              : nothing}
                <span class="name">${item.label ?? item.value}</span>
                ${item.token ? html`<span class="tokenmark">${icon('droplet', 11)}</span>` : nothing}
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
    if (!this.open && this.#canOpen) this.#openPopup();
    // Pre-highlight the best match, matching the block search popover: typing a
    // few letters of a token name and pressing Enter should pick it.
    //
    // Never in a submit control, though. There, Enter sends what was typed, so a
    // pre-selected row would both tell a screen reader the wrong thing and quietly
    // turn "car" into `.card` — or, worse, register the typo. The arrow keys are
    // how a suggestion gets taken.
    // An emptied field is a request to clear the declaration, not the start of a
    // search, so nothing is pre-selected: Enter used to grab the first suggestion in
    // the list and set that instead of removing the value.
    this.highlight =
      this.action || !this.draft.trim() ? -1 : this.filtered.findIndex((item) => !item.info);
    this.#highlightMoved = false;
    this.#emit('value-input');
  }

  #onFocus(): void {
    if (this.filtered.length) this.#openPopup();
  }

  /**
   * Keep focus on the input when the trailing strip is pressed.
   *
   * Without this the press blurs the input, and the blur handler then closed the
   * popup the click had just opened — which is what made the strip look inert.
   */
  #onTrailingDown(event: PointerEvent): void {
    if (!this.#canOpen && !this.action) return;
    event.preventDefault();
  }

  /**
   * The whole trailing strip opens the list, not just the chevron.
   *
   * The chevron is a 22px target inside a wider area that looks clickable; only
   * honouring the icon itself makes the control feel broken. Clicks that already
   * landed on a button are left to that button.
   */
  #onTrailingClick(event: MouseEvent): void {
    if (!this.#canOpen) return;
    const onButton = event
      .composedPath()
      .some((node) => node instanceof HTMLElement && node.tagName === 'BUTTON');
    if (onButton) return;
    this.#toggleOpen();
  }

  /**
   * Re-decide what should be open and what should be committed, after focus moves.
   *
   * Bound to `focusout` on the host rather than `blur` on the input, because focus
   * moving *within* the field matters as much as focus leaving it: stepping onto the
   * chevron has to close the list, and stepping from a list row out to another
   * control has to as well. `blur` on the input sees neither of those.
   *
   * Deferred because at `focusout` time the incoming target is not yet active, so an
   * immediate answer always reads as "focus left" — which would tear the list down
   * mid-click.
   *
   * Two independent questions, deliberately not conflated: the list closes when focus
   * is no longer in the input or the list, while committing waits until focus has
   * left the field altogether. Otherwise clicking the unit chip, which has its own
   * handler, would race a commit against it.
   */
  #onFocusOut(): void {
    clearTimeout(this.#blurTimer);
    this.#blurTimer = setTimeout(() => {
      if (!this.#focusKeepsListOpen()) this.closePopup();
      if (this.#hasFocus()) return;
      // A submit control has an explicit trigger, so looking away is not an
      // instruction to act. Committing here would fire an action the host never
      // asked for — adding a class the user was only half-way through typing.
      if (this.action) return;
      if (this.draft !== this.value) {
        this.#commit();
        return;
      }
      // Nothing to commit, but `value-input` may have painted a live preview on the
      // way here — typing a value and deleting it again, or cancelling a colour
      // picker. Say so, so the host can put the page back.
      this.dispatchEvent(new CustomEvent('value-revert', { bubbles: true, composed: true }));
    }, 120);
  }

  #onKeyDown(event: KeyboardEvent): void {
    const items = this.filtered;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.open) {
        this.open = false;
        return;
      }
      this.draft = this.value;
      this.#emit('value-input');
      this.textInput.blur();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const candidate = this.open && this.highlight >= 0 ? items[this.highlight] : undefined;
      // A context row is never what Enter meant. Without this, committing an
      // expression would swap it for its own resolved number.
      const highlighted = candidate?.info ? undefined : candidate;
      // An arrow-key selection always wins. Failing that, a draft the browser
      // already accepts is a literal the user meant; anything else was a search,
      // so Enter takes the highlighted match.
      if (highlighted && (this.#highlightMoved || !this.#draftIsComplete())) {
        this.#choose(highlighted);
        return;
      }
      this.open = false;
      if (this.action) this.#submit();
      else this.#commit();
      return;
    }

    if (event.key === 'Tab') {
      /*
       * Only a keyboard selection is a selection.
       *
       * The highlight has three possible sources — the arrow keys, the pre-highlight
       * that typing applies, and whatever the pointer happens to be resting over —
       * and only the first is something the user chose. Tabbing used to accept the
       * others too, so a mouse left anywhere over the list silently rewrote the value
       * on the way out, and a half-typed search was replaced by its first guess.
       *
       * With nothing chosen, Tab is just Tab: leave, and leave the text alone.
       */
      const chosen = this.#highlightMoved && this.highlight >= 0 ? items[this.highlight] : undefined;
      if (chosen && !chosen.info) {
        event.preventDefault();
        this.#choose(chosen);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1;

      // With the list open the arrows move the highlight; otherwise they step
      // the number, which is the faster interaction for a length field.
      if (this.open && items.length) {
        event.preventDefault();
        // Step over context rows: the resolved value of an expression is there to
        // read, and landing on it would make the arrows feel like they had stuck.
        let next = this.highlight;
        for (let step = 0; step < items.length; step += 1) {
          next += direction;
          if (next < 0) next = items.length - 1;
          else if (next >= items.length) next = 0;
          if (!items[next]?.info) break;
        }
        this.highlight = items[next]?.info ? -1 : next;
        this.#highlightMoved = true;
        return;
      }
      if (this.isNumeric) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
        this.#step(direction * step);
      }
    }
  }

  #step(delta: number): void {
    const parsed = this.parsed ?? { number: 0, unit: this.kind === 'number' ? '' : 'px' };
    this.draft = formatLength(parsed.number + delta, parsed.unit);
    this.#emit('value-input');
    this.#commit();
  }

  #cycleUnit(event: MouseEvent): void {
    const parsed = this.parsed;
    if (!parsed) return;
    const unit = nextUnit(parsed.unit, event.shiftKey ? -1 : 1);
    this.draft = formatLength(parsed.number, unit);
    this.#commit();
  }

  #clear(): void {
    this.draft = '';
    this.#commit();
  }

  #toggleOpen(): void {
    if (this.open) {
      this.open = false;
      return;
    }
    this.#openPopup();
    this.textInput?.focus();
  }

  #openPopup(): void {
    // One list at a time. Stacked popovers in the top layer look like a rendering
    // fault, and only one of them can be the one the keyboard is driving.
    for (const other of openFields) {
      if (other !== this) other.closePopup();
    }
    openFields.add(this);
    this.open = true;
    this.highlight = -1;
    this.#highlightMoved = false;
    // First placement happens in `updated()`, once the popover exists and has been
    // promoted to the top layer. A second pass after the frame has settled picks
    // up the popup's real height and any layout the panel did in between.
    requestAnimationFrame(() => {
      if (this.open) this.#positionPopup();
    });
  }

  /**
   * Place the popup in viewport coordinates.
   *
   * The field lives inside a scrolling panel, so an absolutely positioned popup
   * would be clipped by the panel's overflow. Fixed positioning avoids that, at
   * the cost of having to recompute on scroll and resize.
   */
  #positionPopup(): void {
    const anchor = this.getBoundingClientRect();
    const popup = this.renderRoot.querySelector('.popup');
    const height = popup?.getBoundingClientRect().height ?? 240;
    const width = Math.max(anchor.width, 200);

    const spaceBelow = innerHeight - anchor.bottom;
    const above = spaceBelow < height + 12 && anchor.top > spaceBelow;
    const top = above ? Math.max(8, anchor.top - height - 5) : anchor.bottom + 5;
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, innerWidth - width - 8));

    this.popupStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px;width:${Math.round(width)}px;max-height:${Math.round(above ? anchor.top - 16 : spaceBelow - 16)}px`;
  }

  #choose(item: ValueSuggestion): void {
    this.draft = item.value;
    this.open = false;
    this.highlight = -1;
    this.#highlightMoved = false;
    if (this.action) this.#submit();
    else this.#commit();
  }

  /**
   * Fire the action, unconditionally.
   *
   * Deliberately skips the "did the value change" guard that `#commit` applies.
   * A submit control is usually bound to a buffer the host mirrors straight back,
   * which makes every submission look like a no-op to that guard — the reason the
   * add button and Enter appeared to do nothing.
   */
  #submit(): void {
    const next = this.draft.trim();
    if (!next) return;
    this.open = false;
    this.dispatchEvent(
      new CustomEvent('value-submit', {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Replace the buffer from the outside.
   *
   * Hosts that consume a submission need a way to clear the field while it still
   * has focus, which the `value` property alone cannot do: an in-flight edit is
   * intentionally protected from external writes.
   */
  reset(next = ''): void {
    this.value = next;
    this.#lastCommitted = next.trim();
    this.draft = next;
    this.open = false;
    this.highlight = -1;
    this.#highlightMoved = false;
  }

  /** Close the list, from the outside. */
  closePopup(): void {
    openFields.delete(this);
    if (!this.open) return;
    this.open = false;
    this.highlight = -1;
  }

  /**
   * Focus the text input.
   *
   * `select` preselects the whole value, which is what a field arriving under the
   * caret should do: the value there is a placeholder the user is expected to
   * replace, so typing should overwrite it rather than append to it.
   */
  focusInput(options: { select?: boolean } = {}): void {
    const input = this.textInput;
    if (!input) return;
    input.focus();
    if (options.select) input.select();
  }

  /* ---- Colour ---- */

  /**
   * The colour to paint in the swatch.
   *
   * Falls back to the placeholder, which the style panel fills with the computed
   * value. Without that, every field showing an inherited colour would paint an
   * empty checkerboard even though the element visibly has a colour.
   */
  #resolvedColor(): string {
    const raw = this.draft.trim() || this.placeholder.trim();
    if (!raw) return 'transparent';
    if (!raw.includes('var(--')) return raw;
    // Resolve against the host page so a token shows its real colour.
    const name = /var\(\s*(--[\w-]+)/.exec(raw)?.[1];
    if (!name) return raw;
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return resolved || 'transparent';
  }

  #onColorInput(event: Event): void {
    this.draft = (event.target as HTMLInputElement).value;
    this.#emit('value-input');
  }

  #onColorChange(event: Event): void {
    this.draft = (event.target as HTMLInputElement).value;
    this.#commit();
  }

  /* ---- Emitting ---- */

  #commit(): void {
    const next = this.draft.trim();
    if (next === this.value.trim()) return;
    this.value = next;
    // Remembered so a later `value` change can be told apart from the host simply
    // echoing this commit back. See `willUpdate`.
    this.#lastCommitted = next;
    this.#emit('value-change');
  }

  #emit(type: 'value-input' | 'value-change'): void {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { value: this.draft.trim() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /* ---- Scrub gesture ---- */

  /**
   * Horizontal drag on the label changes the value.
   *
   * Uses pointer capture rather than document listeners so the gesture survives
   * the pointer leaving the control, and the vertical axis is ignored so the
   * gesture cannot be confused with a scroll.
   */
  #onScrubStart(event: PointerEvent): void {
    if (!this.isNumeric) return;
    event.preventDefault();
    const parsed = this.parsed ?? { number: 0, unit: this.kind === 'number' ? '' : 'px' };
    this.#scrubStart = { x: event.clientX, value: parsed.number, unit: parsed.unit };
    this.scrubbing = true;

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - this.#scrubStart.x;
      const scale = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
      const next = this.#scrubStart.value + Math.round(dx) * scale;
      this.draft = formatLength(next, this.#scrubStart.unit);
      this.#emit('value-input');
    };
    const up = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      this.scrubbing = false;
      this.#commit();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }
}

/**
 * Every field with its list open.
 *
 * Module-level because the constraint is global: there is one keyboard and one top
 * layer, so there can be one open list. Nothing else in the overlay needs to know
 * about it, which is why this is not editor state.
 */
const openFields = new Set<HeoValueField>();

declare global {
  interface HTMLElementTagNameMap {
    'heo-value-field': HeoValueField;
  }
}

/** Short explanations shown beside unit completions. */
const UNIT_HINTS: Record<string, string> = {
  px: 'pixels',
  rem: 'root font size',
  em: 'own font size',
  '%': 'of the parent',
  vw: 'viewport width',
  vh: 'viewport height',
  ch: 'character width',
};
