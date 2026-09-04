import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { DIRTY_ATTR, EDIT_DISCARDED_EVENT } from '../../core/constants.js';
import {
  formatCssFunction,
  formatLength,
  nextUnit,
  parseCssFunction,
  parseLength,
  toHexColor,
} from '../../core/css.js';
import { listen, unlisten } from '../../core/shield.js';
import { PopoverPlacer } from '../place.js';
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
  /**
   * Picking this opens a composer instead of committing a value.
   *
   * A function cannot be offered as a completion the way `16px` can: it takes several values, and a
   * list row has nowhere to ask for several values. So the row is a way in rather than an answer.
   */
  opens?: FunctionName;
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

      /* The dimensional counterpart of the colour swatch: same slot, same 1px separator, and the
         same relationship to the value -- it shows it and it changes it. */
      .gauge {
        display: grid;
        place-items: center;
        width: 22px;
        border: 0;
        border-right: 1px solid var(--heo-line);
        background: transparent;
        cursor: ew-resize;
        touch-action: none;
        user-select: none;
        padding: 0;
      }
      .gauge .bar {
        height: 4px;
        border-radius: 2px;
        background: var(--heo-text-faint);
        transition:
          background var(--heo-fast),
          width var(--heo-fast);
      }
      .gauge:hover .bar,
      .gauge.active .bar {
        background: var(--heo-accent);
      }
      /* While dragging, the whole well reads as engaged rather than just the bar inside it. */
      .gauge.active {
        background: var(--heo-accent-soft);
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
      /* ---- Function composer ---- */

      /* Wider than a value field: three labelled rows each holding a field of its own do not fit the
         width of the box that opened them, and a form that scrolls sideways is not a form.

         A column whose rows scroll, not a box that scrolls. Placement caps the height so the
         composer always fits on screen, and the popup class scrolls -- which would put the footer
         holding Apply below the fold. The head and foot stay; the rows give way. */
      .composer {
        display: flex;
        flex-direction: column;
        gap: 7px;
        min-width: 296px;
        padding: 9px;
        overflow: hidden;
      }
      .composer > .cm-head,
      .composer > .cm-out,
      .composer > .cm-foot,
      .composer > .btn {
        flex: 0 0 auto;
      }
      .cm-head {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .cm-name {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
      }
      .cm-what {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cm-rows {
        display: grid;
        gap: 5px;
        flex: 0 1 auto;
        min-height: 0;
        overflow-y: auto;
      }
      /* The label column is fixed so the nested fields line up; the trailing track collapses when a
         row cannot be removed. */
      .cm-row {
        display: grid;
        grid-template-columns: 58px minmax(0, 1fr) auto;
        align-items: center;
        gap: 6px;
      }
      .cm-label {
        overflow: hidden;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: help;
      }
      .cm-op {
        height: 26px;
        padding: 0 4px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 12px;
        text-align: center;
      }
      /* The value being built, spelled out. The rows say what the parts are; this says what the
         declaration will be, which is the thing actually being written. */
      .cm-out {
        min-width: 0;
        overflow-x: auto;
        padding: 5px 7px;
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        white-space: nowrap;
      }
      .cm-out.bad {
        color: var(--heo-danger);
      }
      .cm-foot {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cm-foot .spacer {
        flex: 1 1 auto;
      }
      .cm-why {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--heo-danger);
        font-size: 10px;
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
  /** Places the popup, and refuses to let the measurement feed back into the placement. */
  readonly #placer = new PopoverPlacer();
  /**
   * The function being composed, or null when none is.
   *
   * Held here rather than in a separate control so the composer and the list share one popover: two
   * in the top layer at once look like a rendering fault, and only one can be the one the keyboard
   * is driving.
   */
  @state() private composer: {
    fn: FunctionName;
    parts: string[];
    operators: string[];
  } | null = null;

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
    // Abandoning a composer by pressing elsewhere discards it, and the live preview it painted has
    // to go with it — this field's own value never changed.
    if (this.composer) {
      this.composer = null;
      this.dispatchEvent(new CustomEvent('value-revert', { bubbles: true, composed: true }));
    }
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
    /*
     * The rows are about to change, so the cached height is stale.
     *
     * Without this a list that shrank as the user typed kept the placement of the taller one -- and
     * one that grew was placed as though it still fitted.
     */
    if (changed.has('suggestions') || changed.has('value')) this.#placer.invalidate();
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

  /**
   * The fields whose popups this one is rendered inside, innermost first.
   *
   * `contains` cannot answer this: a composer's part lives in its host's shadow root, and containment
   * does not cross that boundary. Walking the host chain does. Bounded, because a cycle here would
   * hang the field rather than misplace it.
   */
  #hostFields(): HeoValueField[] {
    const out: HeoValueField[] = [];
    let node: Node = this;
    for (let depth = 0; depth < 8; depth += 1) {
      const root = node.getRootNode();
      if (!(root instanceof ShadowRoot)) break;
      const host = root.host;
      if (host instanceof HeoValueField) out.push(host);
      node = host;
    }
    return out;
  }

  /**
   * Open the list from outside.
   *
   * For a host that knows the user has just asked to change this value — the spacing box opening a
   * side, for one. Silent when there is nothing to show, so a caller does not have to ask first.
   */
  openList(): void {
    if (!this.open && this.#canOpen) this.#openPopup();
  }

  /** Whether this field's own suggestion list is up. Read by a composer hosting it. */
  get listIsOpen(): boolean {
    return this.open && !this.composer;
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
    /*
     * Filtering is for searching, and you are only searching once you have changed the text.
     *
     * The draft starts out as the field's committed value, so treating it as a query meant opening
     * the list on `width: 220px` filtered every token out — "220px" matches no token name — and the
     * list showed one row: the value already in the box. The palette was reachable only by first
     * deleting the value, which is the opposite of offering it.
     *
     * It showed up worst inside the clamp composer, where each part always holds a value, so the
     * token list was always empty and "use the design tokens for the bounds" was impossible.
     */
    const searching = this.draft.trim() !== this.value.trim();
    const needle = searching ? this.draft.trim().toLowerCase() : '';
    const units = this.#unitSuggestions();
    const functions = this.#functionSuggestions();
    const all = this.suggestions;
    if (!needle) return [...this.#computedSuggestion(), ...units, ...all, ...functions];

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
    /*
     * Functions narrow only when the query is about a function.
     *
     * The draft is usually the field's committed value rather than a search — open the list on a
     * width of `16px` and the needle is "16px", which matches no function name and filtered every
     * one of them out. So they were unreachable from precisely the state a user opens the list in.
     *
     * Treated like the unit completions instead, which are synthesised and always offered when they
     * apply: four rows, grouped and last, so they cost little and are always findable. Typing "cl"
     * still narrows to the one, which is what keeps the list a search when it is used as one.
     */
    const named = functions.filter(
      (item) =>
        item.value.toLowerCase().startsWith(needle) ||
        (item.label ?? '').toLowerCase().startsWith(needle),
    );
    return [
      ...this.#computedSuggestion(),
      ...units,
      ...scored.filter((item) => !unitValues.has(item.value)),
      ...(named.length ? named : functions),
    ];
  }

  /**
   * The CSS functions worth offering on a dimensional value.
   *
   * Only where a length makes sense, and only these four: they are the ones that answer a question a
   * single number cannot. Each opens a form rather than inserting text, because each takes several
   * values — see FUNCTIONS for what differs between them.
   */
  #functionSuggestions(): ValueSuggestion[] {
    if (!this.isNumeric || this.kind === 'number') return [];
    return (Object.keys(FUNCTIONS) as FunctionName[]).map((fn) => {
      const existing = parseCssFunction(this.draft, [fn]);
      return {
        value: `${fn}()`,
        label: existing ? `${fn}() — edit` : `${fn}()`,
        hint: FUNCTIONS[fn].what,
        group: 'Functions',
        opens: fn,
      };
    });
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

    return html`
      <div class="wrap">
        ${this.#renderLead()}
        ${this.label
        ? html`<button
              class="scrub ${this.scrubbing ? 'active' : ''} ${this.isNumeric ? '' : 'plain'}"
              @pointerdown=${this.#startScrub}
              title=${this.isNumeric ? this.#scrubTitle() : this.label}
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

  /**
   * The leading affordance, chosen by what kind of value this is.
   *
   * One slot, several jobs: a swatch that opens the colour picker, or a gauge that is the drag
   * handle for a dimensional value. The colour button had this position to itself and was the model
   * for the rest -- a small, always-visible thing at the head of the field that both *shows* the
   * value and is the direct way to change it.
   *
   * Dimensional values had no such handle anywhere except the Tokens panel, and there only by
   * accident: the scrub is bound to the label, and Tokens is the one panel that passes one. The
   * Styles panel shows the property name in its own column, so giving the field a label there would
   * print it twice — hence a handle that is not the label.
   */
  #renderLead(): TemplateResult | typeof nothing {
    if (this.kind === 'color') return this.#renderColorButton();
    if (!this.isNumeric) return nothing;
    return this.#renderGauge();
  }

  /**
   * A bar that reads as the size it represents, and scrubs.
   *
   * Deliberately the same 22px well as the Tokens panel's `.preview`, clamped the same way, because
   * it is answering the same question there and here. The difference is that this one is a control:
   * the read-only version could show you that `--space-lg` was bigger than `--space-sm` and left
   * you to type the change.
   *
   * The bar is drawn from the *resolved* value, so a `var()` or a `calc()` still shows a length
   * rather than collapsing to the 2px floor.
   */
  #renderGauge(): TemplateResult {
    return html`<button
      class=${`gauge${this.scrubbing ? ' active' : ''}`}
      type="button"
      tabindex="-1"
      title=${this.#scrubTitle()}
      aria-hidden="true"
      @pointerdown=${this.#startScrub}
    >
      <span class="bar" style=${`width:${this.#gaugeWidth()}px`}></span>
    </button>`;
  }

  /**
   * The bar's length: 2px to 16px, logarithmic.
   *
   * Computed here rather than left to a CSS `clamp`, for two reasons. A clamp has to be handed the
   * raw value, and `max(2px, none)` is not a length — so `max-width: none` produced an invalid
   * declaration and a bar of no width at all, which read as a broken control rather than as "no
   * limit set".
   *
   * And it is logarithmic because the range is not. Clamping linearly at 16px, which is what the
   * Tokens panel does over a 4–48px token scale, makes every width above the ceiling look the same:
   * `16px` and `220px` were the same bar. A log curve keeps small spacing values distinguishable
   * while still leaving room to tell a padding from a page width.
   */
  #gaugeWidth(): number {
    // The resolved value first: it is in pixels, so a `%`, a `rem` and a `var()` all become
    // comparable instead of being drawn as whatever number happens to precede the unit.
    const px = parseLength(this.computed.trim()) ?? parseLength(this.draft);
    const size = Math.abs(px?.number ?? 0);
    if (!size) return 2;
    // log10(1)=0 → 2px, log10(1000)=3 → 16px.
    const scaled = 2 + (Math.log10(size) / 3) * 14;
    return Math.round(Math.min(16, Math.max(2, scaled)));
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

  /**
   * The composer, in place of the list.
   *
   * Every part is a `heo-value-field` in its own right, and that is the whole point: a bound of a
   * clamp is a length like any other, so it gets the project's tokens, the unit chip, the gauge and
   * the scrub without a line of that being written again.
   *
   * The nested events are stopped here. They bubble and compose, so left alone the host panel would
   * hear a part's value as though it were the whole declaration and write `10px` where
   * `clamp(10px, …)` was meant.
   */
  #renderComposer(): TemplateResult {
    const state = this.composer!;
    const spec = FUNCTIONS[state.fn];
    const composed = this.#composed();
    const invalid = !CSS.supports(this.property || 'width', composed);

    return html`<div
      class="popup composer"
      popover="manual"
      style=${this.popupStyle}
      role="dialog"
      aria-label=${`Compose a ${state.fn}()`}
      @keydown=${this.#onComposerKey}
    >
      <div class="cm-head">
        <span class="cm-name">${state.fn}()</span>
        <span class="cm-what">${spec.what}</span>
        <button class="mini" type="button" title="Cancel" @click=${() => this.#closeComposer()}>
          ${icon('close', 11)}
        </button>
      </div>

      <div class="cm-rows">
        ${state.parts.map((part, index) => this.#renderPart(state, spec, part, index))}
      </div>

      ${spec.variadic
        ? html`<button
            class="btn sm"
            type="button"
            title=${`Add another value to this ${state.fn}()`}
            @click=${() => this.#addPart()}
          >
            ${icon('plus', 12)} Another
          </button>`
        : nothing}

      <code class=${`cm-out${invalid ? ' bad' : ''}`}>${composed}</code>
      <div class="cm-foot">
        ${invalid
        ? html`<span class="cm-why">${icon('alert', 11)} Not a value this browser accepts</span>`
        : nothing}
        <span class="spacer"></span>
        <button class="btn sm primary" type="button" @click=${() => this.#applyComposer()}>
          ${icon('check', 12)} Apply
        </button>
      </div>
    </div>`;
  }

  #renderPart(
    state: { fn: FunctionName; parts: string[]; operators: string[] },
    spec: ComposerSpec,
    part: string,
    index: number,
  ): TemplateResult {
    const label = spec.labels?.[index];
    const removable = spec.variadic && state.parts.length > spec.least;

    return html`<div class="cm-row">
      ${spec.operators && index > 0
        ? html`<select
            class="cm-op"
            aria-label="Operator"
            @change=${(event: Event) =>
        this.#setOperator(index - 1, (event.target as HTMLSelectElement).value)}
          >
            ${['+', '-', '*', '/'].map(
          (op) => html`<option value=${op} ?selected=${state.operators[index - 1] === op}>
                ${op}
              </option>`,
        )}
          </select>`
        : html`<span class="cm-label" title=${label?.hint ?? ''}>
            ${label?.label ?? `Value ${index + 1}`}
          </span>`}
      <heo-value-field
        .value=${part}
        kind="length"
        .property=${this.property}
        .suggestions=${this.suggestions}
        placeholder=${label?.hint ?? 'a length'}
        @value-input=${(event: Event) => {
        event.stopPropagation();
        this.#setPart(index, (event as CustomEvent<{ value: string }>).detail.value);
      }}
        @value-change=${(event: Event) => {
        event.stopPropagation();
        this.#setPart(index, (event as CustomEvent<{ value: string }>).detail.value);
      }}
        @value-revert=${(event: Event) => event.stopPropagation()}
      ></heo-value-field>
      ${removable
        ? html`<button
            class="mini"
            type="button"
            title="Remove this value"
            aria-label="Remove this value"
            @click=${() => this.#removePart(index)}
          >
            ${icon('close', 11)}
          </button>`
        : nothing}
    </div>`;
  }

  /** Enter applies and Escape cancels, wherever the caret is inside the composer. */
  #onComposerKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.#closeComposer();
      return;
    }
    if (event.key !== 'Enter') return;
    /*
     * Enter applies, unless a part's own list is driving it.
     *
     * A part is a full field, so Enter there may be accepting a token from its dropdown. Applying
     * the whole function at the same moment would close the composer on the keystroke that was
     * choosing one of its values.
     */
    const target = event.composedPath()[0];
    if (target instanceof HTMLElement) {
      const owner = (target.getRootNode() as ShadowRoot).host;
      if (owner instanceof HeoValueField && owner !== this && owner.listIsOpen) return;
    }
    event.preventDefault();
    this.#applyComposer();
  };

  #renderPopup(): TemplateResult {
    // The composer replaces the list while it is up: it answers the question the list was asking.
    if (this.composer) return this.#renderComposer();
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
      /*
       * A composer owns its own lifetime.
       *
       * Its parts are fields, so focus moves in and out of them constantly, and each move looked
       * from here like the field being abandoned — which closed the popup and, because the draft
       * still equalled the value, announced a revert that rolled the composed preview back off the
       * page. Apply and Cancel are the only two ways out, and both are explicit.
       */
      if (this.composer) return;
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
    /*
     * Emptied, so offer the alternatives.
     *
     * Clearing a value is rarely the end of the thought — it is how you get to a different one. The
     * cross left an empty box and a closed list, so choosing the replacement meant reaching for the
     * chevron straight afterwards. Backspacing to empty already reopened it, through `#onInput`;
     * this is the same intention expressed with the button.
     */
    this.textInput?.focus();
    if (this.#canOpen) this.#openPopup();
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
    /*
     * One list at a time, except the one this is standing inside.
     *
     * Stacked popovers in the top layer look like a rendering fault, and only one can be the one the
     * keyboard is driving — so opening a list closes every other. A composer breaks that assumption:
     * its parts are fields in their own right, rendered inside this field's popup, so "close every
     * other" would close the popup containing the field that just opened one, and the part would
     * vanish under the cursor mid-edit.
     */
    const hosts = new Set(this.#hostFields());
    for (const other of openFields) {
      if (other !== this && !hosts.has(other)) other.closePopup();
    }
    openFields.add(this);
    this.open = true;
    // A fresh opening measures afresh: the rows may be different from last time.
    this.#placer.invalidate();
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
    const style = this.#placer.style(this.renderRoot.querySelector<HTMLElement>('.popup'), {
      anchor: this.getBoundingClientRect(),
      // A composer is wider than a list: three labelled rows each holding a field of their own.
      minWidth: this.composer ? 296 : 200,
    });
    if (style !== null) this.popupStyle = style;
  }

  #choose(item: ValueSuggestion): void {
    /*
     * A row that opens a composer is a way in, not an answer.
     *
     * Nothing is committed here: `clamp()` as a literal is not a value, and `#commit` would adopt
     * it, so the next keystroke would be editing an empty function rather than filling one in. The
     * value the field already holds stays behind the form until Apply.
     */
    if (item.opens) {
      this.#openComposer(item.opens);
      return;
    }
    this.draft = item.value;
    this.open = false;
    this.highlight = -1;
    this.#highlightMoved = false;
    if (this.action) this.#submit();
    else this.#commit();
  }

  /* ---- Function composer ---- */

  /**
   * Open the composer, seeded from what is on screen.
   *
   * An existing call of the same function is taken apart, so opening it is editing it rather than
   * starting again. What is deliberately *not* a seed is the text in the box: reaching the row means
   * having typed a search for it, and `clamp` is not a length. See `seedFor`.
   */
  #openComposer(fn: FunctionName): void {
    const existing = parseCssFunction(this.draft, [fn]);
    /*
     * The search that found the row is discarded with it.
     *
     * Typing "clamp" to reach the function leaves "clamp" in the box, and the box commits what is in
     * it when focus leaves — so abandoning the composer wrote `width: clamp` onto the element. The
     * query was a means of finding the row, never a value.
     */
    if (!existing) this.draft = this.value;
    this.composer = existing
      ? { fn, parts: existing.parts, operators: existing.operators }
      : { fn, ...seedFor(fn, this.computed) };
    this.open = true;
    this.highlight = -1;
    /*
     * The caret lands in the first part, selected.
     *
     * Opening a form with nothing focused makes it look inert: the composer arrived with its parts
     * filled in and no obvious way to change them, and typing went to the document — where the
     * global keymap was listening. Selected rather than merely focused, because the part is already
     * holding a seeded guess, and the first thing anyone does is replace it.
     */
    void this.updateComplete.then(() => {
      this.#positionPopup();
      const first = this.renderRoot.querySelector<HeoValueField>('.cm-row heo-value-field');
      first?.focusInput({ select: true });
      // Re-placed once the parts have laid out, since their height is what decides whether the
      // composer flips above the field.
      requestAnimationFrame(() => {
        if (this.composer) this.#positionPopup();
      });
    });
  }

  #closeComposer(): void {
    const painted = Boolean(this.composer);
    this.composer = null;
    this.open = false;
    // Cancelling has to undo the live preview, or the page keeps the last part that was typed while
    // the field goes on showing the value it never left.
    if (painted) {
      this.dispatchEvent(new CustomEvent('value-revert', { bubbles: true, composed: true }));
    }
  }

  #composed(state = this.composer): string {
    if (!state) return '';
    return formatCssFunction({ name: state.fn, parts: state.parts, operators: state.operators });
  }

  /** Update the composer and preview the result, the way typing in the field does. */
  #updateComposer(next: { fn: FunctionName; parts: string[]; operators: string[] }): void {
    this.composer = next;
    this.dispatchEvent(
      new CustomEvent('value-input', {
        detail: { value: this.#composed(next) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #setPart(index: number, value: string): void {
    const state = this.composer;
    if (!state) return;
    this.#updateComposer({
      ...state,
      parts: state.parts.map((part, at) => (at === index ? value : part)),
    });
  }

  #setOperator(index: number, operator: string): void {
    const state = this.composer;
    if (!state) return;
    this.#updateComposer({
      ...state,
      operators: state.operators.map((op, at) => (at === index ? operator : op)),
    });
  }

  #addPart(): void {
    const state = this.composer;
    if (!state) return;
    this.#updateComposer({
      ...state,
      parts: [...state.parts, state.parts[state.parts.length - 1] ?? '0px'],
      operators: FUNCTIONS[state.fn].operators ? [...state.operators, '+'] : state.operators,
    });
  }

  #removePart(index: number): void {
    const state = this.composer;
    if (!state) return;
    this.#updateComposer({
      ...state,
      parts: state.parts.filter((_part, at) => at !== index),
      // The operator that joined this part to the one before it goes with it; the first part has
      // none, so removing it drops the operator that followed instead.
      operators: state.operators.filter((_op, at) => at !== Math.max(0, index - 1)),
    });
  }

  #applyComposer(): void {
    if (!this.composer) return;
    this.draft = this.#composed();
    this.composer = null;
    this.open = false;
    this.#commit();
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
    this.#placer.invalidate();
    this.highlight = -1;
    // The composer goes with it. Left set, an abandoned form would stand in for the list the next
    // time one was asked for.
    this.composer = null;
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
   * The number a drag should start from, and in what unit.
   *
   * A field showing `var(--space-lg)` used to start from zero, because `parseLength` cannot read a
   * `var()` and the fallback was `{0, 'px'}` -- so dragging a token-valued field threw the token
   * away and restarted the value from `0px`. The resolved value is what the user can see on screen,
   * so that is where the drag begins; the token is only replaced once the drag actually moves.
   */
  #scrubOrigin(): { number: number; unit: string } {
    const parsed = this.parsed;
    if (parsed) return parsed;
    const resolved = parseLength(this.computed.trim());
    if (resolved) return resolved;
    return { number: 0, unit: this.kind === 'number' ? '' : 'px' };
  }

  /**
   * The scale this property can be snapped through, ascending.
   *
   * Built from the same suggestions the list shows, so "hold Shift" walks exactly the values the
   * dropdown offers -- the project's own tokens first, then the common ladder. Narrowed to the unit
   * being dragged, because a scale that mixes `8px` with `100%` is not an ordering anyone can feel.
   * Tokens keep their `var()` spelling, so snapping onto one adopts the token rather than flattening
   * it to a number.
   */
  #snapLadder(unit: string): SnapRung[] {
    const rungs: SnapRung[] = [];
    const seen = new Set<number>();
    for (const item of this.suggestions) {
      const rung = rungOf(item);
      if (!rung) continue;
      // A bare `0` belongs on every ladder; anything else has to be in the same unit.
      if (rung.number !== 0 && rung.unit !== unit) continue;
      if (seen.has(rung.number)) continue;
      seen.add(rung.number);
      rungs.push(rung);
    }
    return rungs.sort((a, b) => a.number - b.number);
  }

  /**
   * Horizontal drag changes the value.
   *
   * Pointer capture rather than document listeners, so the gesture survives the pointer leaving the
   * control. The vertical axis is ignored so the gesture cannot be mistaken for a scroll.
   *
   * Two modes, and which one Shift selects depends on what the property has. Where a scale is
   * available -- which in the Styles panel means the project's spacing and size tokens -- Shift
   * walks that scale, because on a design-system value the useful coarse movement is "the next size
   * up", not "ten of whatever unit this is". Where there is no scale, as in the Tokens panel, Shift
   * keeps its usual x10 meaning. Alt is x0.1 either way.
   */
  #startScrub(event: PointerEvent): void {
    if (!this.isNumeric) return;
    event.preventDefault();
    const origin = this.#scrubOrigin();
    const ladder = this.#snapLadder(origin.unit);
    // Where on the ladder the current value sits, so a snap drag moves relative to it.
    const nearest = ladder.reduce(
      (best, rung, index) =>
        Math.abs(rung.number - origin.number) < Math.abs(ladder[best].number - origin.number)
          ? index
          : best,
      0,
    );
    const step = SCRUB_STEP[origin.unit] ?? 1;

    this.#scrubStart = { x: event.clientX, value: origin.number, unit: origin.unit };
    this.scrubbing = true;

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    /*
     * A dead zone, so a press that never travels is a press.
     *
     * Without it a plain click on the handle emitted a change for the number already there, which
     * put a no-op on the undo stack and, on a token-valued field, replaced the token with its own
     * resolved number.
     */
    let moved = false;
    let last = '';

    const move = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - this.#scrubStart.x;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;

      let next: string;
      if (moveEvent.shiftKey && ladder.length > 1) {
        const at = Math.min(
          ladder.length - 1,
          Math.max(0, nearest + Math.round(dx / SNAP_PITCH)),
        );
        next = ladder[at].write;
      } else {
        const scale = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
        next = formatLength(
          this.#scrubStart.value + Math.round(dx) * step * scale,
          this.#scrubStart.unit,
        );
      }
      if (next === last) return;
      last = next;
      this.draft = next;
      this.#emit('value-input');
    };

    const up = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      this.scrubbing = false;
      // Nothing moved, so there is nothing to commit. Hand the caret over instead, which is what a
      // click on a value is usually asking for.
      if (!moved) {
        this.textInput?.focus();
        return;
      }
      this.#commit();
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  /** What the handle promises, spelled out — the gesture is invisible otherwise. */
  #scrubTitle(): string {
    if (!this.isNumeric) return this.label;
    const ladder = this.#snapLadder(this.#scrubOrigin().unit);
    const coarse =
      ladder.length > 1
        ? `hold Shift to step through the ${ladder.length} values on this scale`
        : 'hold Shift for larger steps';
    return `Drag to change${this.label ? ` ${this.label}` : ''} — ${coarse}, Alt for finer ones`;
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

/**
 * How much one pixel of drag moves the value, per unit.
 *
 * A flat "one pixel is one step" is what the scrub used to do, and it makes the gesture mean
 * something different in every unit: dragging a `rem` value moved it a whole root font size per
 * pixel, so two pixels of travel was a 32px jump. These are chosen so a drag covers roughly the
 * same *visual* distance whatever the unit is written in, which is what makes the unit chip and
 * the drag work together rather than against each other.
 */
const SCRUB_STEP: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 1,
  '%': 0.5,
  vw: 0.5,
  vh: 0.5,
  svh: 0.5,
  dvh: 0.5,
  rem: 0.0625,
  em: 0.0625,
  ch: 0.25,
  fr: 0.1,
  ms: 10,
  s: 0.01,
  deg: 1,
};

/** Travel needed to advance one rung when snapping through a scale. */
const SNAP_PITCH = 14;

/** One stop on a property's scale: what to write, and where it sits numerically. */
interface SnapRung {
  /** The text to commit -- a `var()` reference for a token, so snapping keeps the token. */
  write: string;
  number: number;
  unit: string;
  label: string;
  token: boolean;
}

/**
 * The rung behind a suggestion, or null when it is not a measurable one.
 *
 * A token suggestion carries its resolved value in `hint`, sometimes with a usage count appended
 * (`12px · 3×`), so the count comes off before parsing. A literal carries it in `value`. Keywords
 * like `auto` parse to nothing and drop out, which is right -- a scale is made of sizes.
 */
function rungOf(item: ValueSuggestion): SnapRung | null {
  if (item.info) return null;
  const raw = item.token ? (item.hint ?? '').split('·')[0] : item.value;
  const parsed = parseLength(raw.trim());
  if (!parsed) return null;
  return {
    write: item.value,
    number: parsed.number,
    unit: parsed.unit,
    label: item.label ?? item.value,
    token: Boolean(item.token),
  };
}

export type FunctionName = 'clamp' | 'min' | 'max' | 'calc';

interface ComposerSpec {
  /** One line saying what the function is for, under its name. */
  what: string;
  /** Fixed labels, where the parts mean different things. Absent means they are a plain list. */
  labels?: Array<{ label: string; hint: string }>;
  /** Fewest parts a valid call needs, and so the point below which rows stop being removable. */
  least: number;
  variadic: boolean;
  /** Whether an operator sits between parts rather than a comma. */
  operators: boolean;
}

/**
 * The functions the composer knows, and the shape of each.
 *
 * All four get a form, not only `clamp`, because the reason `clamp` needed one applies to every one
 * of them: they take several values and a list row has nowhere to ask for several values. What
 * differs is only arity and how the parts are joined, which is what this table holds — so adding a
 * fifth is a row here rather than a second composer.
 */
const FUNCTIONS: Record<FunctionName, ComposerSpec> = {
  clamp: {
    what: 'a floor, an ideal and a ceiling',
    labels: [
      { label: 'Minimum', hint: 'never smaller than' },
      { label: 'Ideal', hint: 'what it wants to be' },
      { label: 'Maximum', hint: 'never larger than' },
    ],
    least: 3,
    variadic: false,
    operators: false,
  },
  min: { what: 'whichever is smallest', least: 2, variadic: true, operators: false },
  max: { what: 'whichever is largest', least: 2, variadic: true, operators: false },
  calc: { what: 'arithmetic on lengths', least: 2, variadic: true, operators: true },
};

/**
 * Starting parts for a function that is not already there.
 *
 * Seeded from the resolved value, never from the text in the box. Reaching the row means having
 * typed a search to find it, and "clamp" is not a length — it used to become the ideal value, so
 * composing a clamp began from a bound reading `clamp`. Where there is nothing to go on, 18px: a
 * plausible body size, and a number large enough to see move.
 *
 * The defaults differ per function because the useful starting point does. A clamp wants bounds
 * either side of the value, since one whose three parts are equal is valid and pointless. A calc
 * wants `100% - something`, which is what very nearly every calc in the wild is.
 */
function seedFor(fn: FunctionName, computed: string): { parts: string[]; operators: string[] } {
  const base = parseLength(computed.trim()) ?? { number: 18, unit: 'px' };
  const unit = base.unit || 'px';
  const at = (factor: number): string => formatLength(round(base.number * factor), unit);
  switch (fn) {
    case 'clamp':
      return { parts: [at(0.75), at(1), at(1.5)], operators: [] };
    case 'calc':
      return { parts: ['100%', at(1)], operators: ['-'] };
    default:
      return { parts: [at(1), at(1.5)], operators: [] };
  }
}

/** Three decimals is what `formatLength` keeps, so a seeded part matches what a drag would write. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
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
