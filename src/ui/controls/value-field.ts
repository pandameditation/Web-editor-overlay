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
} from '../../core/css.js';
import { splitImportant } from '../../core/declaration-list.js';
import { listen, unlisten } from '../../core/shield.js';
import { PopoverPlacer } from '../place.js';
import { contrastTargetFor, type ContrastTarget } from '../contrast.js';
import type { ColorSwatch } from './color-picker.js';
import './color-picker.js';
import { parseShadows, type ShadowSwatch } from '../../core/shadow.js';
import { filterPreview } from '../../core/filter.js';
import { miniShadow } from './shadow-editor.js';
import { pushEscapeLayer } from '../../core/keymap.js';
import { tieLayer } from '../../core/focus.js';
import { firstFocusable } from '../../core/modal.js';
import './shadow-editor.js';
import './filter-editor.js';
import './font-picker.js';
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
  /** An icon before the label, from the overlay set: a device, a state's cursor, an action's plus. */
  icon?: string;
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

/**
 * `shadow` is box-shadow and text-shadow, `filter` is filter: both are text to type, with the shadow
 * editor at the head of the field where a colour has its swatch.
 */
export type ValueKind = 'text' | 'length' | 'number' | 'color' | 'keyword' | 'shadow' | 'filter' | 'font';

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

      .sigil {
        display: grid;
        place-items: center;
        width: 26px;
        flex: 0 0 auto;
        color: var(--heo-text-faint);
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
      :host([leading-icon]) .wrap {
        height: 30px;
        box-shadow: var(--heo-inset);
      }
      :host([leading-icon]) .wrap:focus-within {
        box-shadow: 0 0 0 3px var(--heo-accent-soft);
      }
      :host([leading-icon]) input {
        padding: 0 2px 0 0;
      }
      :host([leading-icon]) .trailing {
        padding: 3px;
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

      /* The text and its !important tag scroll together: the tag reads as the end of the value,
         rather than a fixed block taking the room a long value needed. */
      .text {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
      }
      .text::-webkit-scrollbar {
        display: none;
      }
      /* As wide as the value, so the tag sits just after it; the box's empty end is still the field. */
      .text.sized input {
        flex: 0 0 auto;
      }
      .text.sized {
        cursor: text;
      }
      input {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        padding: 0 6px;
        border: 0;
        background: transparent;
        /* A host can say its value is set but not drawn (a row's value a later rule hides). */
        color: var(--heo-field-ink, var(--heo-text));
        font-family: var(--heo-mono);
        font-size: 11.5px;
        text-decoration: var(--heo-field-decoration, none);
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
      /* Never narrower than what it holds: shrinking it slid the tag and the buttons over the text.
         The input gives way instead. */
      .trailing {
        display: flex;
        flex: 0 0 auto;
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
        /* Dim, not faint: these are icon controls, and faint read 2.5:1 on the glass. */
        color: var(--heo-text-dim);
        cursor: pointer;
      }
      .mini:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      /* The eyedropper is the one strip control in the tab order (no key does what it does). */
      .mini.sample:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: -1px;
      }

      /* The !important tag, in the accent's text ink: readable as text in both themes. */
      .imp {
        flex: 0 0 auto;
        align-self: center;
        padding: 0 3px;
        color: var(--heo-accent-text);
        font-family: var(--heo-mono);
        font-size: 9.5px;
        line-height: 18px;
        white-space: nowrap;
      }
      button.imp {
        height: 18px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
      }
      button.imp:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      button.imp:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
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
      /* Nothing matches what was typed, so this is the way on: said by filling it in. */
      .action.ready {
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      .action:hover:not(:disabled) {
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      .action:disabled {
        background: transparent;
        color: var(--heo-text-disabled);
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
      /* The shadow editor's opener: a tiny picture of the shadow, as the colour's swatch is of it. */
      .shadow-btn .mini {
        display: grid;
        place-items: center;
        width: 15px;
        height: 15px;
        border-radius: 4px;
        background: color-mix(in oklab, var(--heo-text) 12%, var(--heo-sunken));
      }
      .shadow-btn .mini i {
        width: 9px;
        height: 7px;
        border-radius: 2px;
        background: #fff;
      }
      .shadow-btn .mini b {
        color: #fff;
        font: 700 10px/1 system-ui, sans-serif;
      }
      /* A filter's opener: a patch of colours, drawn through the filter. */
      .shadow-btn .filter-mini i {
        width: 11px;
        height: 11px;
        border-radius: 3px;
        background: linear-gradient(135deg, #f97316, #ec4899 45%, #6366f1 75%, #22d3ee);
      }
      .shadow-btn[aria-expanded='true'] {
        background: var(--heo-accent-soft);
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
      /* In the field's flow, inside a popover of its own: no second frame, shadow or float. */
      .popup.inline {
        position: static;
        max-height: 260px;
        margin-top: 4px;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        animation: none;
      }
      :host([inline-list]) {
        display: block;
      }
      /* The colour picker, in place of the list. */
      .popup.picker {
        max-height: none;
        padding: 10px;
      }
      /*
       * The colour picker and the shadow editor are small dialogs rather than lists: they open from
       * their own middle, and when they grow they grow about it (see #onDialogResize).
       */
      .popup.dialog {
        animation: dialog-in 170ms var(--heo-ease);
        transform-origin: 50% 50%;
      }
      /* Focused so its keys are its own; the ring belongs on its controls, not round the whole. */
      .popup.dialog:focus {
        outline: none;
      }
      @keyframes dialog-in {
        from {
          opacity: 0;
          scale: 0.94;
        }
      }
      /* Their head: a grip and a title to move them by, and the close cross. */
      .dialog-head {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: -3px -2px 8px 0;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      .dialog-head:active {
        cursor: grabbing;
      }
      .dialog-head .grip {
        display: grid;
        place-items: center;
        color: var(--heo-text-faint);
      }
      .dialog-head .title {
        color: var(--heo-text);
        font-size: 12px;
        font-weight: 600;
      }
      .dialog-head .sub {
        overflow: hidden;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dialog-head .spacer {
        flex: 1 1 auto;
      }
      .dialog-head .close {
        width: 22px;
        height: 22px;
        cursor: pointer;
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
      /*
       * A group of short, plain values (0, 4px, auto) as a grid of cells rather than a row each:
       * the same option look, three or four to a line, so a long list of common values does not
       * make the list tall. A row with a hint, a swatch or an icon keeps its own line.
       */
      .cells {
        display: grid;
        grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr));
        gap: 2px;
      }
      .option.cell {
        padding: 5px 8px;
      }
      .option .ico {
        display: inline-flex;
        flex: 0 0 auto;
        color: var(--heo-text-dim);
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
      /* Nothing matches, and the way on is to make it: the line, then the button that does. */
      .none.create {
        display: grid;
        justify-items: start;
        gap: 8px;
        padding: 6px 2px 2px;
        color: var(--heo-text-dim);
      }
      .none.create p {
        margin: 0;
      }
      .none.create strong {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-weight: 500;
      }
    `,
  ];

  @property({ type: String }) label = '';
  /** The input's accessible name, where the field sits in a row that names it some other way. */
  @property({ type: String, attribute: 'field-label' }) fieldLabel = '';
  /**
   * A length that only ever takes this unit (the viewport widths: px): no unit to cycle, and no
   * list of units, functions or values to open, so the field is a number with its gauge.
   */
  @property({ type: String, attribute: 'fixed-unit' }) fixedUnit = '';
  /**
   * Draw the list in the field's own flow, under the input, instead of floating it: for a field
   * that already sits in a popover of its own (the header's class finder), so the field and its
   * list are one box rather than a box and a second one hanging under it.
   */
  @property({ type: Boolean, attribute: 'inline-list' }) inlineList = false;
  /**
   * Match the list by words rather than by one exact run of text: every word typed has to appear
   * somewhere in a row's value, label or hint, in any order. For a list of expressions with a fixed
   * syntax nobody types exactly (media queries): "reduced motion" finds
   * `(prefers-reduced-motion: reduce)`, "dark" finds the colour-scheme query.
   */
  @property({ type: Boolean }) fuzzy = false;
  /** Optional search-style leading icon for fields that name or filter an item. */
  @property({ type: String, attribute: 'leading-icon' }) leadingIcon = '';
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = '';
  @property({ type: String }) kind: ValueKind = 'text';
  @property({ attribute: false }) suggestions: ValueSuggestion[] = [];
  /** Show the unit chip and enable scrubbing. Inferred from `kind` by default. */
  @property({ type: Boolean }) numeric = false;
  @property({ type: Boolean }) clearable = false;
  /**
   * A value to offer while the field is empty: an eyedropper at its end writes it, in one click.
   *
   * For the cascade menu's empty places, where the value that applies is shown as the
   * placeholder and the usual wish is to write that same value here. Committed straight away
   * rather than put in the box: filling and focusing the box opened its suggestion list, which
   * moved under the eye every time a place was picked.
   */
  @property({ type: String }) sample = '';
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
  /**
   * With an `action`: what pressing it would make of the text typed (`Create ".hero"`), shown as a
   * button where the list would say nothing matches. Read from the host, which knows the noun.
   */
  @property({ type: String, attribute: 'create-label' }) createLabel = '';
  @property({ type: String, attribute: 'create-title' }) createTitle = '';
  /** What the list says when nothing matches, where the default wording does not fit. */
  @property({ type: String, attribute: 'empty-text' }) emptyText = '';
  /** For a font field that is a token's own value: that token, left out of the picker's tokens. */
  @property({ type: String, attribute: 'self-token' }) selfToken = '';
  /** A font field whose picker offers no typography tokens: a token's own value, in Tokens. */
  @property({ type: Boolean, attribute: 'no-font-tokens' }) noFontTokens = false;
  @property({ type: String, attribute: 'action-icon' }) actionIcon = 'plus';
  /**
   * Submit without the action button: Enter and a pick from the list submit, and nothing beside
   * the field competes with the list for the click (the conditions bar's search, where the answer
   * is always a row).
   */
  @property({ type: Boolean, attribute: 'action-hidden' }) actionHidden = false;
  /**
   * No chevron: the list opens as the field is typed in or focused, and the action beside it is
   * the one control (the property adder's name, whose arrow goes on to the value).
   */
  @property({ type: Boolean, attribute: 'chevron-hidden' }) chevronHidden = false;
  /**
   * The declaration this field shows is `!important`.
   *
   * The value itself is passed without the flag, so the tag is the one place it shows. It used to
   * be nowhere: a rule's `!important` beat the element's own value while the panel showed the
   * losing one, with nothing on screen to say why.
   */
  @property({ type: Boolean, reflect: true }) important = false;
  /**
   * The tag is a button that removes the flag, rather than a label.
   *
   * Only where the field writes the very declaration it shows (a card row, a popover line, an
   * inline winner). A row showing a rule's importance does not write that rule, so its tag stays
   * text and its title says where to change it.
   */
  @property({ type: Boolean, reflect: true, attribute: 'important-removable' })
  importantRemovable = false;
  /** The tag's title when it is text: where the `!important` lives and how to change it. */
  @property({ type: String, reflect: true, attribute: 'important-title' }) importantTitle = '';
  /**
   * The list's least width. The Styles panel's rows ask for 280: their lists were that wide while
   * a destination switch sat at their head, and the value grid, the list's placement and its
   * measured room are tuned to it. Without it, the rows' lists fell to 200 and lost a column.
   */
  @property({ type: Number, attribute: 'list-min-width' }) listMinWidth = 200;

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
  /** The popup is the colour picker rather than the list. */
  @state() private picking = false;
  /** The popup is the shadow editor. */
  @state() private shadowing = false;
  /** How far the shadow editor has been dragged from where it was placed. */
  @state() private popupShift = { x: 0, y: 0 };
  /** The design system's shadow tokens, for the shadow editor's swatches. */
  @property({ attribute: false }) shadowTokens: readonly ShadowSwatch[] = [];
  /** What the picker measures contrast against, read when it opens. */
  @state() private pickerContrast: ContrastTarget | null = null;

  #scrubStart = { x: 0, value: 0, unit: 'px' };
  /**
   * Whether the highlight was moved with the arrow keys.
   *
   * Typing pre-highlights the best match so Enter can accept it, but that guess
   * must never override something the user aimed at deliberately.
   */
  #highlightMoved = false;
  #blurTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The text `seedDraft` put in the box. Not a search: the list filters only once the user types
   * something else, so a seeded value opens the whole list as a committed one does.
   */
  #seed: string | null = null;
  /** The last value this field committed, to tell an echo from an external change. */
  #lastCommitted = '';
  /** A `value-input` went out since the last commit or revert: a preview may be painted. */
  #painted = false;
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
    this.picking = false;
    this.shadowing = false;
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
    this.#escapeLayer?.();
    this.#escapeLayer = null;
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
     * one that grew was placed as though it still fitted. The typed text filters the rows too, so it
     * counts: beside its field the list is centred on the field's middle by the measured height, and
     * measured once for the whole list it stayed at that list's top as typing shortened it, riding
     * up far from the field. The Styles panel hid it by handing new suggestions on every preview.
     */
    if (changed.has('suggestions') || changed.has('value') || (changed as Map<PropertyKey, unknown>).has('draft')) this.#placer.invalidate();
    /*
     * A dialog belongs to the kind that opened it. A host that decides the kind from the value
     * (Tokens decides "font" from what the value reads as) changed it under an open font picker,
     * and the render, seeing a dialog open on a field that was no longer a font, drew the shadow
     * editor in its place. The dialog closes with the kind instead.
     */
    if (changed.has('kind') && this.open) {
      const dialogKinds: readonly ValueKind[] = ['shadow', 'filter', 'font'];
      if ((this.shadowing && !dialogKinds.includes(this.kind)) || (this.picking && this.kind !== 'color')) this.closePopup();
    }
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
    this.#announceHighlight();
    // Closed some other way than closePopup (a press elsewhere, the chevron): let go of Escape too.
    if (this.#escapeLayer && !(this.open && (this.picking || this.shadowing))) {
      this.#escapeLayer();
      this.#escapeLayer = null;
      this.#dialogBox = null;
    }
    if (this.open && !this.picking && !this.shadowing && !this.composer) this.#measureRoom();
    const popup = this.renderRoot.querySelector<HTMLElement>('.popup');
    if (!popup || !this.open) return;
    if (!this.inlineList && typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
      try {
        popup.showPopover();
      } catch {
        // Already open, or popovers are unsupported: the popup still renders,
        // it just stays in the normal painting order.
      }
    }
    this.#positionPopup();
  }

  /** The suggestion last announced as highlighted, so each change is said once. */
  #announced: string | null = null;

  /**
   * Say which suggestion is highlighted, by pointer or by arrow keys, as `suggestion-hover` with
   * `{ value }` (null once none is): for a host that previews a choice before it is made, as the
   * Animation section plays the one under the pointer.
   */
  #announceHighlight(): void {
    const item = this.open && !this.picking && !this.composer && this.highlight >= 0 ? this.filtered[this.highlight] : undefined;
    const value = item && !item.info ? item.value : null;
    if (value === this.#announced) return;
    this.#announced = value;
    this.dispatchEvent(new CustomEvent('suggestion-hover', { detail: { value }, bubbles: true, composed: true }));
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
    /*
     * A dialog of the field's own — the picker, the shadow editor — stays up whatever focus does.
     * A press outside, Escape and its ✕ close it. Checked before asking where focus is, because a
     * control inside that removes itself (Add shadow, a shadow's trash) drops focus on nothing, and
     * that read as focus leaving: the editor closed under the click that added a shadow.
     */
    if (this.picking || this.shadowing) return true;
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

  /**
   * Open the colour picker from outside: for a host drawing the colour somewhere else too, as the
   * gradient bar draws its stops. Does nothing for a field that is not a colour.
   */
  pickColor(): void {
    if (this.kind === 'color') this.#openPicker();
  }

  /** Open the colour picker in the popup, with the contrast it is to be measured against. */
  #openPicker(): void {
    this.composer = null;
    this.shadowing = false;
    this.picking = true;
    this.pickerContrast = this.property ? contrastTargetFor(this.property) : null;
    if (!this.open) this.#openPopup();
    // Measured again once the picker has drawn itself: it renders a frame after the popup does,
    // and a popup measured empty was capped short of it and scrolled.
    void this.updateComplete
      .then(() => this.renderRoot.querySelector('heo-color-picker')?.updateComplete)
      .then(() => {
        if (!this.open || !this.picking) return;
        this.#dialogBox = null;
        this.#placer.invalidate();
        this.#positionPopup();
        return this.updateComplete;
      })
      .then(() => {
        const popup = this.renderRoot.querySelector<HTMLElement>('.popup.dialog');
        if (this.open && this.picking && popup) this.#settleDialog(popup);
      });
  }

  /** The project's colour tokens, as the picker's swatches. */
  get #swatches(): ColorSwatch[] {
    return this.suggestions
      .filter((item) => item.token && item.swatch)
      .map((item) => ({ value: item.value, label: item.label ?? item.value, color: item.swatch! }));
  }

  #renderPicker(): TemplateResult {
    const painted = this.draft.trim() || this.placeholder.trim();
    return html`<div
      class="popup picker dialog"
      popover="manual"
      tabindex="-1"
      style=${this.#dialogStyle()}
      @pointerdown=${keepFocusOnBlank}
      @keydown=${this.#onDialogKey}
      role="dialog"
      aria-label=${this.fieldLabel ? `${this.fieldLabel}: color picker` : 'Color picker'}
    >
      ${this.#renderDialogHead('Color', this.fieldLabel || this.property)}
      <heo-color-picker
        .value=${painted}
        .contrast=${this.pickerContrast}
        .swatches=${this.#swatches}
        @color-input=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.draft = event.detail.value;
        this.#emit('value-input');
      }}
        @color-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.draft = event.detail.value;
        this.#commit();
      }}
        @color-close=${(event: Event) => {
        event.stopPropagation();
        this.#closeDialog();
      }}
      ></heo-color-picker>
    </div>`;
  }

  /** Open the shadow editor, as its button does: for a host or a test opening it from outside. */
  openShadowEditor(): void {
    if (this.kind !== 'shadow' && this.kind !== 'filter' && this.kind !== 'font') return;
    this.composer = null;
    this.picking = false;
    this.shadowing = true;
    if (!this.open) this.#openPopup();
    void this.updateComplete
      .then(() => this.renderRoot.querySelector<LitElement>('heo-shadow-editor, heo-filter-editor, heo-font-picker')?.updateComplete)
      .then(() => {
        if (!this.open || !this.shadowing) return;
        this.#dialogBox = null;
        this.#placer.invalidate();
        this.#positionPopup();
        return this.updateComplete;
      })
      .then(() => {
        const popup = this.renderRoot.querySelector<HTMLElement>('.popup.dialog');
        if (this.open && this.shadowing && popup) this.#settleDialog(popup);
      });
  }

  /**
   * The opener: the shadow drawn small, on a card for a box and on a letter for text; for a filter,
   * a patch of colours drawn through it.
   */
  #renderShadowButton(): TemplateResult {
    const text = this.property === 'text-shadow';
    const source = this.draft.trim() || this.computed.trim();
    const filter = this.kind === 'filter';
    const list = filter ? [] : (parseShadows(source, text ? 'text' : 'box') ?? parseShadows(this.computed, text ? 'text' : 'box') ?? []);
    const label = filter ? `Open the ${this.#filterTitle.toLowerCase()} editor` : 'Open the shadow editor';
    return html`<button
      class="color-btn shadow-btn"
      type="button"
      tabindex="-1"
      title=${label}
      aria-label=${label}
      aria-expanded=${this.open && this.shadowing}
      @pointerdown=${(event: Event) => event.preventDefault()}
      @click=${() => (this.open && this.shadowing ? this.closePopup() : this.openShadowEditor())}
    >
      ${filter
        ? html`<span class="mini filter-mini"><i style=${`filter:${filterPreview(source, 4)}`}></i></span>`
        : html`<span class="mini">${text
          ? html`<b style=${`text-shadow:${miniShadow(list, 4, 'text')}`}>A</b>`
          : html`<i style=${`box-shadow:${miniShadow(list, 4)}`}></i>`}</span>`}
    </button>`;
  }

  /*
   * The value the picker shows while a font is being previewed: the one before the preview. A host
   * that repaints the element hands the previewed stack back as the value, and the picker's
   * fallback chain then changed with every hover, resizing the dialog under the pointer.
   */
  get #fontBase(): string {
    return this.#fontCommitted ?? (this.value || this.computed);
  }
  #fontCommitted: string | null = null;

  /** A font field's opener: "Aa" in the font the field holds. */
  #renderFontButton(): TemplateResult {
    const value = this.draft.trim() || this.computed.trim();
    return html`<button
      class="color-btn shadow-btn font-btn"
      type="button"
      tabindex="-1"
      title="Open the font picker"
      aria-label="Open the font picker"
      aria-expanded=${this.open && this.shadowing}
      @pointerdown=${(event: Event) => event.preventDefault()}
      @click=${() => (this.open && this.shadowing ? this.#closeDialog() : this.openShadowEditor())}
    ><span class="mini"><b style=${`font-family:${value.replace(/[;{}]/g, '')}`}>Aa</b></span></button>`;
  }

  /** The font picker, in the shadow editor's dialog. Hovering a font previews it; leaving puts the value back. */
  #renderFontPicker(): TemplateResult {
    return html`<div
      class="popup picker shadowing dialog"
      popover="manual"
      tabindex="-1"
      style=${this.#dialogStyle()}
      @pointerdown=${keepFocusOnBlank}
      @keydown=${this.#onDialogKey}
      role="dialog"
      aria-label="Font picker"
    >
      ${this.#renderDialogHead('Font', this.property || 'font-family')}
      <heo-font-picker
        .value=${this.#painted ? this.#fontBase : this.value || this.computed}
        .selfToken=${this.selfToken}
        .noTokens=${this.noFontTokens}
        @font-preview=${(event: CustomEvent<{ value: string | null }>) => {
        event.stopPropagation();
        if (event.detail.value) {
          if (!this.#painted) this.#fontCommitted = this.value || this.computed;
          this.draft = event.detail.value;
          this.#emit('value-input');
          return;
        }
        this.#fontCommitted = null;
        this.draft = this.value;
        if (this.#painted) {
          this.#painted = false;
          this.dispatchEvent(new CustomEvent('value-revert', { bubbles: true, composed: true }));
        }
      }}
        @font-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#fontCommitted = null;
        this.draft = event.detail.value;
        this.#commit();
      }}
      ></heo-font-picker>
    </div>`;
  }

  /** The filter editor's title: "Filter", "Backdrop filter". */
  get #filterTitle(): string {
    return this.property === 'backdrop-filter' ? 'Backdrop filter' : 'Filter';
  }

  /** The filter editor, in the shadow editor's dialog, for filter and backdrop-filter. */
  #renderFilterEditor(): TemplateResult {
    const property = this.property || 'filter';
    return html`<div
      class="popup picker shadowing dialog"
      popover="manual"
      tabindex="-1"
      style=${this.#dialogStyle()}
      @pointerdown=${keepFocusOnBlank}
      @keydown=${this.#onDialogKey}
      role="dialog"
      aria-label=${`${property}: filter editor`}
    >
      ${this.#renderDialogHead(this.#filterTitle, property)}
      <heo-filter-editor
        .value=${this.draft}
        .property=${property}
        .tokens=${this.shadowTokens}
        @filter-input=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.draft = event.detail.value;
        this.#emit('value-input');
      }}
        @filter-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.draft = event.detail.value;
        this.#commit();
      }}
        @filter-select=${(event: CustomEvent<{ fn: string }>) => {
        event.stopPropagation();
        this.#selectText(event.detail.fn);
      }}
      ></heo-filter-editor>
    </div>`;
  }

  #renderShadowEditor(): TemplateResult {
    if (this.kind === 'filter') return this.#renderFilterEditor();
    const mode = this.property === 'text-shadow' ? 'text' : 'box';
    const title = mode === 'text' ? 'Text shadow' : 'Box shadow';
    const sub = mode === 'text' ? 'text-shadow' : 'box-shadow';
    return html`<div
      class="popup picker shadowing dialog"
      popover="manual"
      tabindex="-1"
      style=${this.#dialogStyle()}
      @pointerdown=${keepFocusOnBlank}
      @keydown=${this.#onDialogKey}
      role="dialog"
      aria-label=${`${this.property || 'shadow'}: shadow editor`}
    >
      ${this.#renderDialogHead(title, sub)}
      <heo-shadow-editor
        .value=${this.draft}
        .computed=${this.computed}
        .mode=${mode}
        .tokens=${this.shadowTokens}
        @shadow-input=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.draft = event.detail.value;
        this.#emit('value-input');
      }}
        @shadow-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.draft = event.detail.value;
        this.#commit();
        // A shadow added or removed changes the height: #onDialogResize grows it about its middle.
      }}
      ></heo-shadow-editor>
    </div>`;
  }

  /*
   * A dialog popup — the colour picker, the shadow editor — is placed once, when it opens, and then
   * stays where it is: placed again on every change, it jumped whenever it grew (adding the first
   * shadow pushed it from below the field to above it). Growing keeps its middle where it was, and
   * the new height is revealed from that middle. Dragging the head moves it by `popupShift`.
   */
  #dialogBox: { top: number; left: number; width: number; height: number; maxHeight: number; content: number } | null = null;
  #dialogObserver: ResizeObserver | null = null;
  #resizeFrame = 0;

  #dialogStyle(): string {
    const box = this.#dialogBox;
    const placed = box
      ? `top:${box.top}px;left:${box.left}px;width:${box.width}px;max-height:${box.maxHeight}px`
      : this.popupStyle;
    return `${placed};translate:${this.popupShift.x}px ${this.popupShift.y}px`;
  }

  /** Take the first placement as the dialog's own, and watch it for growth. */
  /** Unregisters this field's dialog from the page's Escape, while one is open. */
  #escapeLayer: (() => void) | null = null;

  #settleDialog(popup: HTMLElement): void {
    const opening = !this.#escapeLayer;
    // From the page or the dock too: a layer inside the dialog (the font picker's list) goes first.
    if (!this.#escapeLayer) {
      this.#escapeLayer = pushEscapeLayer(() => {
        if (this.renderRoot.querySelector<HTMLElement & { closeList?: () => boolean }>('heo-font-picker')?.closeList?.()) return;
        this.#closeDialog();
      });
    }
    /*
     * As the overlay's other popovers do: focus goes in, to the first control (menus focus their
     * first item; modals their first field), and Tab treats the dialog as sitting right after the
     * button that opened it (`tieLayer`, as the panel's menus are tied). The head's grip and ✕ are
     * left out of "first", so a keyboard lands on what the dialog is for.
     */
    if (opening) {
      const opener = this.renderRoot.querySelector<HTMLElement>('.color-btn');
      tieLayer(popup, opener);
      const body = popup.querySelector<HTMLElement>('heo-color-picker, heo-shadow-editor, heo-filter-editor, heo-font-picker');
      const first = body ? firstFocusable(body.shadowRoot ?? body) : null;
      (first ?? popup).focus({ preventScroll: true });
    }
    /*
     * From the placement and from layout, never from the painted box: this runs while the opening
     * animation still has the dialog at 94% scale, and a box read from it made the first drag snap
     * the dialog narrower and off to one side.
     */
    // What the popup is drawn at right now, so taking it over changes nothing on screen.
    const number = (value: string): number | null => (value.endsWith('px') ? Number.parseFloat(value) : null);
    const top = number(popup.style.top);
    const left = number(popup.style.left);
    const width = number(popup.style.width) ?? popup.offsetWidth;
    const height = popup.offsetHeight;
    if (top === null || left === null || !height) return;
    /*
     * Exactly as placed, cap included: settling must not move or resize anything. Lifting the cap
     * here grew a picker opened in a short window under the pointer that was dragging in it.
     * Only what the content does afterwards changes the dialog — see #onDialogResize.
     */
    this.#dialogBox = { top, left, width, height, maxHeight: number(popup.style.maxHeight) ?? height, content: popup.scrollHeight };

    /*
     * Answered in the next frame, not in the callback. Resizing the dialog there can resize what is
     * observed again in the same frame — a scrollbar coming or going narrows the content, which
     * rewraps the filter editor's chips — and the browser reports that as a ResizeObserver loop.
     */
    if (!this.#dialogObserver) {
      this.#dialogObserver = new ResizeObserver(() => {
        cancelAnimationFrame(this.#resizeFrame);
        this.#resizeFrame = requestAnimationFrame(() => this.#onDialogResize());
      });
    }
    this.#dialogObserver.disconnect();
    // The content, not the popup: the popup's own size is what this sets.
    for (const child of Array.from(popup.children)) this.#dialogObserver.observe(child);
  }

  #onDialogResize(): void {
    const popup = this.renderRoot.querySelector<HTMLElement>('.popup.dialog');
    const box = this.#dialogBox;
    if (!popup || !box || !this.open) return;
    // What the content wants now against what it wanted when the dialog settled.
    const content = popup.scrollHeight;
    if (Math.abs(content - box.content) < 1) return;
    const height = Math.round(Math.min(Math.max(120, box.height + content - box.content), Math.max(120, innerHeight - 16)));
    // About the middle, kept on screen.
    const middle = box.top + box.height / 2;
    const top = Math.round(Math.min(Math.max(8, middle - height / 2), Math.max(8, innerHeight - height - 8)));
    const grew = height - box.height;
    this.#dialogBox = { ...box, top, height, maxHeight: height, content };
    this.requestUpdate();
    if (grew > 0 && typeof popup.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const edge = Math.round(grew / 2);
      popup.animate(
        [{ clipPath: `inset(${edge}px 0 ${edge}px 0 round 9px)` }, { clipPath: 'inset(0 0 0 0 round 9px)' }],
        { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
  }

  /**
   * Close a dialog and hand focus back to the button that opened it.
   *
   * The button, not the text: the dialog was opened from it, and the text box is a different
   * control with its own list. The colour picker commits what it shows on the way out, as Escape
   * always did; the shadow editor has already written every change.
   */
  #closeDialog(): void {
    // A font hovered and not picked: the element goes back to the font it has.
    if (this.kind === 'font' && this.#painted && this.draft !== this.value) {
      this.draft = this.value;
      this.#painted = false;
      this.dispatchEvent(new CustomEvent('value-revert', { bubbles: true, composed: true }));
    }
    if (this.picking) this.#closePicker();
    else this.closePopup();
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>('.color-btn')?.focus({ preventScroll: true }));
  }

  /*
   * Escape anywhere in a dialog closes it — a swatch just clicked, the pad, a slider — and only the
   * dialog. A control inside that answers Escape itself (a field's own list, the colour area) marks
   * the key as handled, and is left to it.
   */
  #onDialogKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    // A layer inside the dialog first: the font picker's open list closes, the dialog stays.
    if (this.renderRoot.querySelector<HTMLElement & { closeList?: () => boolean }>('heo-font-picker')?.closeList?.()) return;
    this.#closeDialog();
  };

  /** The head the colour picker and the shadow editor share: drag it to move them, ✕ to close. */
  #renderDialogHead(title: string, sub: string): TemplateResult {
    return html`<div class="dialog-head" title="Drag to move" @pointerdown=${this.#startDialogMove}>
      <span class="grip" aria-hidden="true">${icon('grip', 12)}</span>
      <span class="title">${title}</span>
      ${sub ? html`<span class="sub">${sub}</span>` : nothing}
      <span class="spacer"></span>
      <button
        class="btn ghost icon sm close"
        type="button"
        aria-label="Close"
        title="Close"
        @pointerdown=${(event: Event) => event.stopPropagation()}
        @click=${() => this.#closeDialog()}
      >${icon('close', 11)}</button>
    </div>`;
  }

  #startDialogMove = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const head = event.currentTarget as HTMLElement;
    event.preventDefault();
    // Moved before it settled: settle it where it is, so a later placement cannot pull it back.
    const popup = head.closest<HTMLElement>('.popup.dialog');
    if (popup && !this.#dialogBox) this.#settleDialog(popup);
    try {
      head.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic or already-released pointer: the drag still follows the listeners below.
    }
    let last = { x: event.clientX, y: event.clientY };
    const move = (at: PointerEvent): void => {
      this.popupShift = { x: this.popupShift.x + at.clientX - last.x, y: this.popupShift.y + at.clientY - last.y };
      last = { x: at.clientX, y: at.clientY };
    };
    const up = (): void => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  };

  /**
   * Select a stretch of the value in the box, scrolled into view: one function of a long filter,
   * picked from the filter editor, so it can be typed over at once.
   */
  #selectText(part: string): void {
    const input = this.textInput;
    if (!input) return;
    const at = input.value.indexOf(part);
    if (at < 0) return;
    this.closePopup();
    input.focus();
    input.setSelectionRange(at, at + part.length);
    // The width of the text before it, in the box's own font, is how far to scroll.
    const style = getComputedStyle(input);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    context.font = `${style.fontSize} ${style.fontFamily}`;
    input.scrollLeft = Math.max(0, context.measureText(input.value.slice(0, at)).width - 12);
  }

  /**
   * Escape in the picker: close it on the colour it shows. One typed but not yet entered is kept
   * too, since it is already on the page; undo takes any of it back.
   */
  #closePicker(): void {
    this.closePopup();
    if (this.draft.trim() !== this.value.trim()) this.#commit();
  }

  /** The rows the list shows for what is typed, in order: for a host taking the best match. */
  get listMatches(): readonly ValueSuggestion[] {
    return this.filtered;
  }

  /** Whether this field's own suggestion list is up. Read by a composer hosting it. */
  get listIsOpen(): boolean {
    return this.open && !this.composer;
  }

  /**
   * Whether the list has a chevron and a trailing strip that opens it. Not for an inline list:
   * it comes with the field, so a control to open it again has nothing to do.
   */
  get #canToggle(): boolean {
    return this.#canOpen && !this.inlineList && !this.chevronHidden;
  }

  /** True when there is a list worth showing, i.e. when opening it does something. */
  get #canOpen(): boolean {
    if (this.fixedUnit) return this.suggestions.length > 0;
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

  /**
   * The rows in the order they are drawn: each group's rows together, groups in the order they
   * first appear. The highlight indexes this list, so the arrow keys and the drawn list agree.
   */
  private get filtered(): ValueSuggestion[] {
    const groups: ValueSuggestion[][] = [];
    const at = new Map<string, ValueSuggestion[]>();
    for (const item of this.#matches()) {
      let group = at.get(item.group);
      if (!group) {
        group = [];
        at.set(item.group, group);
        groups.push(group);
      }
      group.push(item);
    }
    return groups.flatMap((group) => inCellOrder(group, this.#room));
  }

  /** The list's room, as measured once it is drawn: see cellLayout. */
  #room: ListRoom = { width: 261, ch: 6.62 };

  /** Measure the open list: its inner width, and its mono font's character. Redrawn if it changed. */
  #measureRoom(): void {
    const popup = this.renderRoot.querySelector<HTMLElement>('.popup[role="listbox"]');
    const name = popup?.querySelector<HTMLElement>('.option .name');
    if (!popup || !name || !popup.clientWidth) return;
    const style = getComputedStyle(popup);
    const width = popup.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    let ch = this.#room.ch;
    const font = getComputedStyle(name);
    const context = document.createElement('canvas').getContext('2d');
    if (context) {
      context.font = `${font.fontSize} ${font.fontFamily}`;
      ch = context.measureText('0123456789').width / 10 || ch;
    }
    if (Math.abs(width - this.#room.width) < 2 && Math.abs(ch - this.#room.ch) < 0.05) return;
    this.#room = { width, ch };
    this.requestUpdate();
  }

  #matches(): ValueSuggestion[] {
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
    const searching = this.draft.trim() !== this.value.trim() && this.draft.trim() !== this.#seed?.trim();
    const needle = searching ? this.draft.trim().toLowerCase() : '';
    const units = this.#unitSuggestions();
    const functions = this.#functionSuggestions();
    const all = this.suggestions;
    if (!needle) return [...this.#computedSuggestion(), ...units, ...all, ...functions];

    const words = needle.split(/[^a-z0-9]+/).filter(Boolean);
    const scored = all.filter((item) => {
      if (item.value.toLowerCase().includes(needle) || (item.label ?? '').toLowerCase().includes(needle)) return true;
      if (!this.fuzzy || !words.length) return false;
      const text = `${item.value} ${item.label ?? ''} ${item.hint ?? ''}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
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
    if (!this.isNumeric || this.kind === 'number' || this.fixedUnit) return [];
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
    if (!this.isNumeric || this.kind === 'number' || this.fixedUnit) return [];
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
    const showUnit = this.isNumeric && parsed !== null && this.kind !== 'number' && !this.fixedUnit;

    return html`
      <div class="wrap">
        ${this.leadingIcon
        ? html`<span class="sigil" aria-hidden="true">${icon(this.leadingIcon, 13)}</span>`
        : nothing}
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
        <div class=${this.important ? 'text sized' : 'text'} @pointerdown=${this.#onTextDown}>
        <input
          type="text"
          style=${this.important ? `width:calc(${Math.max(this.draft.length, 1) + 0.5}ch + 12px)` : ''}
          .value=${this.draft}
          placeholder=${this.placeholder || 'auto'}
          spellcheck="false"
          autocomplete="off"
          role="combobox"
          aria-label=${this.fieldLabel || nothing}
          aria-expanded=${this.open}
          aria-autocomplete="list"
          @input=${this.#onInput}
          @focus=${this.#onFocus}
          @keydown=${this.#onKeyDown}
          @keyup=${this.#followCaret}
          @click=${this.#followCaret}
          @select=${this.#followCaret}
        />
          ${this.#renderImportant()}
        </div>
        <div
          class=${`trailing${this.#canToggle ? ' actionable' : ''}`}
          title=${this.#canToggle ? 'Show tokens and values' : ''}
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
          ${this.sample.trim() && !this.draft.trim()
        ? html`<button
                class="mini sample"
                type="button"
                title="Same value here"
                aria-label=${`Same value here: ${this.sample.trim()}`}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#takeSample}
              >
                ${icon('pipette', 12)}
              </button>`
        : nothing}
          ${this.#canToggle
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
          ${this.action && !this.actionHidden
        ? html`<button
                class=${`action${this.open && this.draft.trim() && !this.filtered.length ? ' ready' : ''}`}
                type="button"
                title=${this.action}
                aria-label=${this.action}
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
   * The `!important` tag, at the start of the trailing strip.
   *
   * A button only where the host says this field owns the declaration. It reports the change
   * rather than making it, like every other edit here: the host knows which declaration to write.
   */
  #renderImportant(): TemplateResult | typeof nothing {
    if (!this.important) return nothing;
    if (!this.importantRemovable) {
      return html`<span class="imp" title=${this.importantTitle || '!important'}>!important</span>`;
    }
    return html`<button
      class="imp"
      type="button"
      aria-pressed="true"
      aria-label="Remove !important"
      title="Remove !important"
      @pointerdown=${(event: Event) => event.preventDefault()}
      @click=${this.#removeImportant}
    >
      !important
    </button>`;
  }

  #removeImportant(event: Event): void {
    this.dispatchEvent(
      new CustomEvent('important-change', {
        detail: { important: false },
        bubbles: true,
        composed: true,
      }),
    );
    /*
     * Keep focus in the field, like the clear button does.
     *
     * The tag goes away on the render the change triggers, and a focused element that disappears
     * drops focus to the document, where the next key press reaches the global keymap instead of
     * this row. Pressed from the keyboard, the caret moves to the value instead; the list stays shut,
     * since asking to drop a flag is not asking for a different value.
     */
    if (this.shadowRoot?.activeElement === event.currentTarget) {
      this.textInput?.focus();
      this.closePopup();
    }
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
    if (this.kind === 'shadow' || this.kind === 'filter') return this.#renderShadowButton();
    if (this.kind === 'font') return this.#renderFontButton();
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
        title="Pick a color"
        aria-label="Pick a color"
        aria-expanded=${this.open && this.picking}
        @pointerdown=${(event: Event) => event.preventDefault()}
        @click=${() => (this.open && this.picking ? this.closePopup() : this.#openPicker())}
      >
        <span class="swatch" style=${swatchStyle(resolved)}></span>
      </button>
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
      @pointerdown=${keepFocusOnBlank}
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
    if (this.picking) return this.#renderPicker();
    if (this.shadowing && this.kind === 'font') return this.#renderFontPicker();
    if (this.shadowing) return this.#renderShadowEditor();
    const items = this.filtered;
    if (!items.length) {
      const typed = this.draft.trim();
      return html`<div
        class=${this.inlineList ? 'popup inline' : 'popup'}
        popover=${this.inlineList ? nothing : 'manual'}
        @pointerdown=${keepFocusOnBlank}
        style=${this.inlineList ? '' : this.popupStyle}
        role="listbox"
      >
        ${this.action && this.createLabel
          ? html`<div class="none create">
              ${typed ? html`<p>Nothing matches <strong>${typed}</strong>.</p>` : nothing}
              <!-- The same act as the field's action: the offer, said with the name it will make. -->
              <button
                class="btn sm"
                type="button"
                data-act="create"
                title=${this.createTitle || this.action}
                ?disabled=${!typed}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#submit}
              >
                ${icon('plus', 12)} ${this.createLabel}
              </button>
            </div>`
          : html`<div class="none">
              ${this.emptyText || (this.action
              ? 'No matching name. Press Enter to use what you typed.'
              : 'No matching token. Press Enter to keep your own value.')}
            </div>`}
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
    return html`<div
      class=${this.inlineList ? 'popup inline' : 'popup'}
      popover=${this.inlineList ? nothing : 'manual'}
        @pointerdown=${keepFocusOnBlank}
      style=${this.inlineList ? '' : this.popupStyle}
      role="listbox"
    >
      ${repeat(
      groups,
      (group) => group.name,
      (group) => {
        const layout = cellLayout(group.items, this.#room);
        const cols = layout?.cols ?? 0;
        const row = (item: ValueSuggestion, cell: boolean): TemplateResult => {
          index += 1;
          const current = index;
          return html`<button
                class=${`option${item.info ? ' info' : ''}${cell ? ' cell' : ''}`}
                type="button"
                role="option"
                aria-selected=${current === this.highlight}
                title=${item.info
              ? `${item.label} — what ${item.hint} currently resolves to. Selecting this keeps the expression.`
              : (item.hint ?? item.value)}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @pointerenter=${() => {
              if (item.info) return;
              if (this.#highlightMoved) return;
              this.highlight = current;
            }}
                @click=${() => this.#choose(item)}
              >
                ${item.swatch
              ? html`<span class="swatch" style=${swatchStyle(item.swatch)}></span>`
              : nothing}
                ${item.icon ? html`<span class="ico">${icon(item.icon, 12)}</span>` : nothing}
                <span class="name">${item.label ?? item.value}</span>
                ${item.token ? html`<span class="tokenmark">${icon('droplet', 11)}</span>` : nothing}
                ${item.hint ? html`<span class="meta">${item.hint}</span>` : nothing}
              </button>`;
        };
        if (layout) {
          const cells = group.items.slice(0, layout.cells);
          const after = group.items.slice(layout.cells);
          return html`
            <div class="group">${group.name}</div>
            <div class="cells" style=${`--cols:${cols}`}>${repeat(cells, (item) => `${group.name}:${item.value}`, (item) => row(item, true))}</div>
            ${repeat(after, (item) => `${group.name}:${item.value}`, (item) => row(item, false))}
          `;
        }
        const rows = repeat(
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
                ${item.icon ? html`<span class="ico">${icon(item.icon, 12)}</span>` : nothing}
                <span class="name">${item.label ?? item.value}</span>
                ${item.token ? html`<span class="tokenmark">${icon('droplet', 11)}</span>` : nothing}
                ${item.hint ? html`<span class="meta">${item.hint}</span>` : nothing}
              </button>`;
          },
        );
        return html`
          <div class="group">${group.name}</div>
          ${rows}
        `;
      },
    )}
    </div>`;
  }


  /* ---------------------------------------------------------------------- */
  /* Interaction                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Keep the caret in view when the text scrolls with its tag.
   *
   * The input is as wide as its text there, so it never scrolls itself: the box around it does,
   * and nothing moves that box when the caret walks past its edge. The face is monospaced, so the
   * caret's offset is its index times one character's width.
   */
  /** A press in the empty end after the tag puts the caret at the end of the value, as a field's would. */
  #onTextDown = (event: PointerEvent): void => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const input = this.textInput;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    this.#followCaret();
  };

  #followCaret = (): void => {
    if (!this.important) return;
    const box = this.renderRoot.querySelector<HTMLElement>('.text');
    const input = this.textInput;
    if (!box || !input) return;
    const at = input.selectionEnd ?? input.value.length;
    const x = 6 + at * this.#charWidth(input);
    if (x < box.scrollLeft + 4) box.scrollLeft = Math.max(0, x - 12);
    else if (x > box.scrollLeft + box.clientWidth - 4) box.scrollLeft = x - box.clientWidth + 12;
  };
  #measure: CanvasRenderingContext2D | null = null;
  #charWidth(input: HTMLInputElement): number {
    this.#measure ??= document.createElement('canvas').getContext('2d');
    if (!this.#measure) return 7;
    this.#measure.font = getComputedStyle(input).font;
    return this.#measure.measureText('0').width || 7;
  }

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
    if (!this.#canToggle && !this.action) return;
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
    if (!this.#canToggle) return;
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
      /*
       * A font the picker is only showing — a slot selected, a row hovered — is never committed by
       * looking away. The picker moves the focus between its slots, and a focus that fell out for
       * a moment wrote the previewed fallback as the value. It goes back instead.
       */
      if (this.kind === 'font' && this.#fontCommitted !== null) {
        if (this.open && this.shadowing) return;
        this.#fontCommitted = null;
        this.draft = this.value;
        if (this.#painted) {
          this.#painted = false;
          this.dispatchEvent(new CustomEvent('value-revert', { bubbles: true, composed: true }));
        }
        return;
      }
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
      //
      // Only when this field did paint one. The host's revert puts back whatever preview is in
      // flight, and one field's delayed focus-out used to land after the next field had started
      // previewing: commit a value with Enter, click into the row below, type, and the page
      // snapped back while the new field still showed the typed text.
      if (!this.#painted) return;
      this.#painted = false;
      this.dispatchEvent(new CustomEvent('value-revert', { bubbles: true, composed: true }));
    }, 120);
  }

  /**
   * Commit what is in the box now, instead of 120ms after focus leaves it.
   *
   * For a host that is about to take the field away. The delay above exists so that
   * clicking the unit chip does not race a commit, and `disconnectedCallback` cancels the
   * timer so a detached field cannot fire one — which together mean a value typed and then
   * confirmed with the surrounding surface's own button went into the draft and was thrown
   * away with it. Collapsing a class card mid-edit has always lost the value that way; a
   * dialog whose primary button is Done does it every time, so hosts flush first.
   *
   * The two early exits mirror `#onFocusOut` deliberately: a composer owns its own lifetime
   * and has Apply and Cancel, and a submit field's action is an explicit trigger that must
   * not be pulled by the surface closing.
   */
  commitNow(): void {
    clearTimeout(this.#blurTimer);
    if (this.composer) return;
    if (this.action) return;
    if (this.draft !== this.value) this.#commit();
  }

  #onKeyDown(event: KeyboardEvent): void {
    const items = this.filtered;


    if (event.key === 'Escape') {
      /*
       * A field inside another field's dialog (the shadow editor's X, its blur) with no list open
       * lets Escape through to the dialog, which closes. Blurring here dropped focus on the page,
       * where the next Escape deselected the element.
       */
      if (!this.open && this.#hostFields().length) {
        this.draft = this.value;
        return;
      }
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
        // In a grid of cells, up and down move a line: to the cell above or below, or out of the
        // grid past its first or last line, the way the rows around it go.
        const cell = next >= 0 ? cellOf(items, next, this.#room) : null;
        const within = cell ? next + direction * cell.cols : -1;
        if (cell && within >= cell.start && within < cell.end) {
          this.highlight = within;
          this.#highlightMoved = true;
          return;
        }
        if (cell) next = direction > 0 ? cell.end - 1 : cell.start;
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

  /** Write the offered value. Focus stays where it was: no list opens, nothing moves. */
  #takeSample(): void {
    this.draft = this.sample.trim();
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
      this.picking = false;
      this.shadowing = false;
      return;
    }
    this.picking = false;
    this.shadowing = false;
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
    if (this.inlineList) return;
    // A dialog placed once stays put; see #dialogBox.
    if ((this.picking || this.shadowing) && this.#dialogBox) return;
    const style = this.#placer.style(this.renderRoot.querySelector<HTMLElement>('.popup'), {
      anchor: this.getBoundingClientRect(),
      // A composer is wider than a list: three labelled rows each holding a field of their own.
      minWidth: this.shadowing ? 320 : this.picking ? 268 : this.composer ? 296 : this.listMinWidth,
    });
    if (style !== null) this.popupStyle = style;
    // A dialog takes this placement as its own once it has drawn at it, and stays there.
    if ((this.picking || this.shadowing) && !this.#settling) {
      this.#settling = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.#settling = false;
        const popup = this.renderRoot.querySelector<HTMLElement>('.popup.dialog');
        if (this.open && (this.picking || this.shadowing) && popup && !this.#dialogBox) this.#settleDialog(popup);
      }));
    }
  }
  #settling = false;

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
      // composer flips above the field. Measured afresh: the cached height was read before the
      // parts had drawn, so it was too short, and a composer opened low in the window stayed
      // below its field with Apply cut off under the cap instead of flipping.
      requestAnimationFrame(() => {
        if (!this.composer) return;
        this.#placer.invalidate();
        this.#positionPopup();
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
    this.#painted = true;
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
    // Empty included: the host's form says what is missing, below the field.
    const next = this.draft.trim();
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

  /**
   * Put text in the box as an edit not yet committed, over a value that stays as it is.
   *
   * For a value being added (the property adder's value step): the seed is a suggestion, so Enter
   * takes it as typed, which needs it to differ from the committed value. Through `reset` it would
   * equal it, and Enter on an untouched seed would commit nothing.
   */
  seedDraft(text: string): void {
    this.draft = text;
    this.#seed = text;
    this.highlight = -1;
    this.#highlightMoved = false;
  }

  /** Close the list, from the outside. */
  closePopup(): void {
    openFields.delete(this);
    if (!this.open) return;
    this.open = false;
    this.picking = false;
    this.shadowing = false;
    // Dragged somewhere for this opening only: the next one is placed afresh.
    this.popupShift = { x: 0, y: 0 };
    const dialog = this.renderRoot.querySelector<HTMLElement>('.popup.dialog');
    if (dialog) tieLayer(dialog, null);
    this.#dialogBox = null;
    this.#dialogObserver?.disconnect();
    cancelAnimationFrame(this.#resizeFrame);
    this.#escapeLayer?.();
    this.#escapeLayer = null;
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

  /* ---- Emitting ---- */

  #commit(): void {
    const next = this.draft.trim();
    if (next === this.value.trim()) return;
    /*
     * A typed `!important` becomes the tag, and the text keeps only the value.
     *
     * Declaration hosts bind the value without its flag and show the flag as `important`. Kept as
     * text, the field held `0 0 12px !important` while the host bound `0 0 12px` before and after
     * the commit; Lit sets a property only when the bound value changes, so nothing ever corrected
     * the text. Turning the promote toggle off then removed the flag from the rule and left it in
     * the field, which wrote it straight back on its next commit. The host still receives the
     * whole text, flag included, and the tag holds until the host binds `important` itself.
     *
     * Only where the host owns the tag (`importantRemovable`): the Styles rows, the cascade popover
     * and class cards. A field with no tag (the box editor, Media, Extract) keeps the text as typed,
     * or a flag would appear that nothing there clears.
     */
    const typed = this.property && this.importantRemovable ? splitImportant(next) : null;
    const kept = typed?.important && typed.value ? typed.value : next;
    if (kept !== next) {
      this.important = true;
      this.draft = kept;
    }
    this.value = kept;
    // Remembered so a later `value` change can be told apart from the host simply
    // echoing this commit back. See `willUpdate`.
    this.#lastCommitted = kept;
    this.#emit('value-change', next);
  }

  #emit(type: 'value-input' | 'value-change', text = this.draft.trim()): void {
    this.#painted = type === 'value-input';
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { value: text },
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
/** The list's inner width and its mono character's, measured once open (the panel's, until then). */
export interface ListRoom {
  width: number;
  ch: number;
}

const CELL_PADDING = 16;
const CELL_GAP = 2;

/**
 * How a group is laid out: its first `cells` values as a grid of `cols` to a line, the rest as rows
 * after it; null for a list of rows. Only a group of plain values (no hint, swatch, icon, token or
 * composer) is a grid, and only one of at least four.
 *
 * Columns come from the room each cell has, measured, not from a fixed length. The old rule — four
 * when every value was as short as `48px`, three up to `flex-end` — put `cursor` in rows for
 * `not-allowed` and `mix-blend-mode` for `difference`, and one long `drop-shadow(…)` put all of
 * `filter`'s common values in rows. Now as many to a line as fit, and up to two values too long for
 * even two to a line go after the grid, on rows of their own, never cut short.
 */
export function cellLayout(items: readonly ValueSuggestion[], room: ListRoom): { cols: number; cells: number } | null {
  if (items.length < 4) return null;
  for (const item of items) {
    if (item.hint || item.swatch || item.icon || item.token || item.info || item.opens) return null;
  }
  const length = (item: ValueSuggestion): number => (item.label ?? item.value).length;
  // Half a character spare, so a value at the edge is not drawn against it.
  const fits = (item: ValueSuggestion, cols: number): boolean =>
    (length(item) + 0.5) * room.ch + CELL_PADDING <= (room.width - CELL_GAP * (cols - 1)) / cols;
  for (const cols of [4, 3, 2]) {
    if (items.every((item) => fits(item, cols))) return { cols, cells: items.length };
  }
  const short = items.filter((item) => fits(item, 2));
  if (short.length < 4 || items.length - short.length > 2) return null;
  for (const cols of [4, 3, 2]) {
    if (short.every((item) => fits(item, cols))) return { cols, cells: short.length };
  }
  return null;
}

/**
 * A group in the order it is drawn: the values that go in the grid first, then the long ones, each
 * part in its own order. The highlight indexes the drawn order, so this is the list's order too.
 */
function inCellOrder(items: ValueSuggestion[], room: ListRoom): ValueSuggestion[] {
  const layout = cellLayout(items, room);
  if (!layout || layout.cells === items.length) return items;
  const cols = layout.cols;
  const fits = (item: ValueSuggestion): boolean =>
    ((item.label ?? item.value).length + 0.5) * room.ch + CELL_PADDING <= (room.width - CELL_GAP * (cols - 1)) / cols;
  return [...items.filter(fits), ...items.filter((item) => !fits(item))];
}

/** The grid the row at `index` is a cell of: its span in the list and its columns. */
function cellOf(items: readonly ValueSuggestion[], index: number, room: ListRoom): { start: number; end: number; cols: number } | null {
  const group = items[index]?.group;
  if (group === undefined) return null;
  let start = index;
  while (start > 0 && items[start - 1].group === group) start -= 1;
  let end = index + 1;
  while (end < items.length && items[end].group === group) end += 1;
  const layout = cellLayout(items.slice(start, end), room);
  if (!layout || index >= start + layout.cells) return null;
  return { start, end: start + layout.cells, cols: layout.cols };
}

const openFields = new Set<HeoValueField>();

/**
 * A press on a popup's blank space (its padding, a heading, a label) leaves focus where it is.
 *
 * The browser moves focus to the body when a press lands on nothing focusable, and the field reads
 * focus leaving as the user leaving: a slightly missed click inside the colour picker or the list
 * closed it. A press on something that takes focus (a field, a button, the picker's square) is left
 * to do so.
 */
export function keepFocusOnBlank(event: PointerEvent): void {
  const target = event.composedPath()[0];
  if (!(target instanceof Element)) return;
  if (target.closest('input, textarea, select, button, a[href], [tabindex], [contenteditable]')) return;
  event.preventDefault();
}

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
