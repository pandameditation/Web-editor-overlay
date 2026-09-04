import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  appliedRules,
  cascadedDeclarations,
  declaredValues,
  inlineDeclarations,
  parentLayoutProperties,
  PROPERTY_GROUP_LABELS,
  searchProperties,
  sizeConstraints,
  stateRules,
  splitTopLevel,
  type AppliedRule,
  type SizeConstraint,
} from '../../core/css.js';
import {
  checkDeclaration,
  normalizeProperty,
  propertyIsKnown,
} from '../../core/declarations.js';
import { labelFor, selectableParent } from '../../core/dom.js';
import { listen, unlisten } from '../../core/shield.js';
import { resolvesOffsets } from '../../core/transform.js';
import { normalizeClassName } from '../../core/classes.js';
import type { DesignClass } from '../../core/types.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { buildSuggestions, classSuggestions, valueKindFor } from '../suggestions.js';
import { adderStyles } from './adder.js';
import {
  ClassEditor,
  focusDeclaration,
  initialValueFor,
  type DeclarationTarget,
} from './class-editor.js';
import type { HeoValueField } from '../controls/value-field.js';
import '../controls/value-field.js';
import '../controls/search-field.js';
import '../controls/box-editor.js';
import '../controls/segmented.js';
import '../controls/section.js';

interface SectionSpec {
  id: string;
  heading: string;
  glyph: string;
  properties: string[];
  /** Only render when the element's computed style makes the section relevant. */
  when?: (computed: CSSStyleDeclaration) => boolean;
  /** A line above the rows, for a section that has a second way in. */
  note?: string;
}

const SECTIONS: SectionSpec[] = [
  {
    id: 'layout',
    heading: 'Layout',
    glyph: 'panel',
    properties: ['display', 'position', 'overflow', 'z-index'],
  },
  {
    id: 'inset',
    heading: 'Offsets',
    glyph: 'moveIn',
    properties: ['top', 'right', 'bottom', 'left'],
    // The same condition the page's handles use, from the same function: this section and those
    // handles set the same four properties, so they are shown or hidden together by construction.
    when: resolvesOffsets,
    /*
     * The same four properties the page's own handles write.
     *
     * Said here because the two are easy to mistake for alternatives, and they are not: a field is
     * how you say a number you already know, and dragging is how you find out which number you
     * meant. Whichever is used, the declaration that comes out is the same — and the drag keeps
     * the unit, so an offset written in percent is still in percent afterwards.
     */
    note: 'Or drag the element on the page. Shift keeps it on one axis.',
  },
  {
    id: 'flex',
    heading: 'Flex',
    glyph: 'columns',
    properties: [
      'flex-direction',
      'flex-wrap',
      'justify-content',
      'align-items',
      'gap',
      'row-gap',
      'column-gap',
    ],
    when: (computed) => computed.display.includes('flex'),
  },
  {
    id: 'grid',
    heading: 'Grid',
    glyph: 'grid',
    properties: [
      'grid-template-columns',
      'grid-template-rows',
      'grid-auto-flow',
      'grid-auto-rows',
      'place-items',
      'gap',
    ],
    when: (computed) => computed.display.includes('grid'),
  },
  // `child` is rendered by hand — see #renderParent — because it mixes the
  // element's own properties with its parent's, and the two need telling apart.
  {
    id: 'size',
    heading: 'Size',
    glyph: 'wrap',
    properties: [
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'aspect-ratio',
      'box-sizing',
    ],
  },
  {
    id: 'typography',
    heading: 'Typography',
    glyph: 'text',
    properties: [
      'color',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
      'text-transform',
      'text-decoration',
      'text-wrap',
      'white-space',
    ],
  },
  {
    id: 'surface',
    heading: 'Background & border',
    glyph: 'droplet',
    properties: [
      'background-color',
      'background-image',
      'background-size',
      'background-position',
      'border-radius',
      'border',
      'border-width',
      'border-style',
      'border-color',
      'outline',
    ],
  },
  {
    id: 'effects',
    heading: 'Effects',
    glyph: 'sparkle',
    properties: ['opacity', 'box-shadow', 'filter', 'backdrop-filter', 'transform', 'mix-blend-mode', 'cursor'],
  },
  {
    id: 'motion',
    heading: 'Motion',
    glyph: 'refresh',
    properties: ['transition', 'transition-duration', 'transition-timing-function', 'will-change'],
  },
];

/**
 * What the Spacing section covers, named where the search can see it.
 *
 * Spacing is drawn by hand rather than from SECTIONS, because a box editor is not a list of
 * rows — and the cost of that was a search that could not find `margin` or `padding` at all.
 * Declaring the list here is what lets the filter and the section agree about what is in it.
 */
const SPACING_PROPERTIES = [
  'margin',
  'padding',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
];

/** Properties rendered as a segmented control instead of a text field. */
const SEGMENTED: Record<string, Array<{ value: string; label?: string; icon?: string; title?: string }>> = {
  'flex-direction': [
    { value: 'row', icon: 'columns', title: 'Row' },
    { value: 'column', icon: 'rows', title: 'Column' },
    { value: 'row-reverse', label: 'R⇄', title: 'Row reverse' },
    { value: 'column-reverse', label: 'C⇅', title: 'Column reverse' },
  ],
  'text-align': [
    { value: 'left', label: 'L', title: 'Left' },
    { value: 'center', label: 'C', title: 'Center' },
    { value: 'right', label: 'R', title: 'Right' },
    { value: 'justify', label: 'J', title: 'Justify' },
  ],
  'box-sizing': [
    { value: 'content-box', label: 'content' },
    { value: 'border-box', label: 'border' },
  ],
  'flex-wrap': [
    { value: 'nowrap', label: 'no wrap' },
    { value: 'wrap', label: 'wrap' },
  ],
};

/**
 * Sections the user has opened or closed by hand, which then wins for the session.
 *
 * Separate from the default so the two can disagree. A section whose default is
 * "open when it has something in it" still has to stay shut once someone shuts it,
 * and stay open once someone opens it — including the empty ones, where opening it
 * is how you get to the affordance inside.
 */
const userToggled = new Map<string, boolean>();

/**
 * Whether a section renders open.
 *
 * Empty sections used to open anyway, so selecting a plain element produced a column
 * of headings with nothing under them and the ones that did have content were pushed
 * off screen. Content decides now, and the user overrules.
 */
function sectionOpen(id: string, fallback: boolean): boolean {
  return userToggled.get(id) ?? fallback;
}

/**
 * The style editor.
 *
 * Two halves. The top half is a task-oriented form: the groups a designer
 * reaches for, each field aware of the project's design tokens, each showing
 * whether the value is set here or inherited from the cascade. The bottom half is
 * a cascade inspector that shows which rule actually wins and lets that rule be
 * edited in place — the difference between patching one element with an inline
 * override and fixing the class that every instance shares.
 */
@customElement('heo-styles-panel')
export class HeoStylesPanel extends HeoElement {
  static override styles = [
    baseStyles,
    ClassEditor.styles,
    adderStyles,
    css`
      :host {
        display: block;
        padding-bottom: 16px;
      }

      .top {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }

      .rows {
        display: grid;
        gap: 6px;
      }
      /* The trailing column collapses to nothing when a row has no reset button,
         so rows without one stay flush with the rest. */
      .row {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr) auto;
        align-items: center;
        gap: 6px;
      }
      .reset {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
        padding: 0;
      }
      .reset:hover {
        background: var(--heo-hover);
        color: var(--heo-accent);
      }
      .row .pn {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row > .name {
        display: flex;
        align-items: center;
        gap: 4px;
        overflow: hidden;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row.set > .name {
        color: var(--heo-text);
      }
      /* The selector a value arrived from. Worth a glance because editing the row
         writes an inline override rather than changing that rule. */
      .row .from {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        color: var(--heo-accent);
        font-size: 9.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.75;
      }
      .row .dot {
        width: 5px;
        height: 5px;
        flex: 0 0 auto;
        border-radius: 999px;
        background: var(--heo-accent);
        opacity: 0;
      }
      .row.set .dot {
        opacity: 1;
      }

      /* Classes */
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 8px;
      }
      /* Two targets in one chip: the name opens the definition, the cross takes the
         class off this element. Separating them matters because the two actions are
         not comparable — one edits a shared rule, the other edits one element. */
      .chip {
        padding: 0;
        gap: 0;
      }
      .chip .name {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 100%;
        padding: 0 3px 0 7px;
        border: 0;
        border-radius: 999px 0 0 999px;
        background: transparent;
        color: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .chip .name:hover {
        color: var(--heo-text);
      }
      .chip .kill {
        display: grid;
        place-items: center;
        width: 15px;
        height: 15px;
        margin-right: 4px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
        padding: 0;
      }
      .chip .kill:hover {
        background: var(--heo-line-strong);
        color: var(--heo-text);
      }
      .chip.known {
        border-color: var(--heo-accent-line);
        color: var(--heo-text);
      }
      .chip.open {
        background: var(--heo-accent-soft);
        border-color: var(--heo-accent-line);
        color: var(--heo-text);
      }

      /* A cap somewhere above. Warm rather than red: it is an explanation, not a
         mistake — plenty of layouts are capped on purpose. */
      .capped {
        margin-bottom: 9px;
        padding: 8px 9px;
        border: 1px solid color-mix(in oklab, var(--heo-warn) 40%, transparent);
        border-radius: var(--heo-r-sm);
        background: color-mix(in oklab, var(--heo-warn) 8%, transparent);
      }
      .capped .head {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        margin-bottom: 7px;
      }
      .capped .g {
        flex: 0 0 auto;
        color: var(--heo-warn);
      }
      .capped .what {
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }

      /* Rows that edit the parent, not the selection. Fenced with an accent rail
         so a glance is enough to tell whose properties these are. */
      .onparent {
        margin-top: 11px;
        padding: 9px 0 0 10px;
        border-left: 2px solid var(--heo-accent-line);
      }
      .onparent .sub {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 5px;
      }
      .onparent .g {
        color: var(--heo-accent);
      }
      .onparent .who {
        flex: 1 1 auto;
        min-width: 0;
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .onparent .count {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 9.5px;
      }

      .link {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-accent);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }
      .link:hover {
        color: var(--heo-text);
      }

      /* Leaving a shared class, for one element. Two routes, each stating what it
         does to the class and to everything else wearing it — the question that
         decides between them, and one nobody should have to work out from a label. */
      .detach {
        display: grid;
        gap: 7px;
        margin: 0 0 8px;
        padding: 9px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-accent-soft);
      }
      .detach .lede {
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .detach .choice {
        display: grid;
        gap: 6px;
        padding: 8px 9px;
        border-radius: var(--heo-r-sm);
        background: var(--heo-bg);
      }
      .detach .choice .head {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-text);
        font-size: 11.5px;
      }
      .detach .choice .head b {
        font-weight: 600;
      }
      .detach .choice > p {
        margin: 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .detach .choice .row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .detach .choice .row .input {
        flex: 1 1 auto;
        min-width: 0;
        height: 24px;
        font-size: 11px;
      }
      .detach .choice .row .spacer {
        flex: 1 1 auto;
      }

      /* Cascade inspector */
      .rule {
        margin-bottom: 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        overflow: hidden;
      }
      .rule > header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: var(--heo-sunken);
      }
      .rule.inline {
        border-color: var(--heo-accent-line);
      }
      .rule.inline > header {
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }
      .rule .sel {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rule .src {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 9.5px;
      }
      .rule .decls {
        padding: 6px 8px;
        display: grid;
        gap: 4px;
      }
      .decl {
        display: grid;
        grid-template-columns: 96px 1fr;
        align-items: center;
        gap: 6px;
      }
      .decl .p {
        overflow: hidden;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .decl.overridden .p,
      .decl.overridden heo-value-field {
        opacity: 0.45;
      }
      .cond {
        padding: 4px 8px;
        border-top: 1px solid var(--heo-line);
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
      }

      /* Add declaration */
      .adder {
        display: grid;
        gap: 6px;
      }
      .adder .pick {
        position: relative;
      }
      .adder .options {
        position: absolute;
        left: 0;
        right: 0;
        top: 30px;
        z-index: 5;
        max-height: 190px;
        overflow-y: auto;
        padding: 4px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-lg);
      }
      .adder .option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 4px 7px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
        text-align: left;
        cursor: pointer;
      }
      .adder .option:hover {
        background: var(--heo-hover);
      }
      .adder .option span:last-child {
        color: var(--heo-text-faint);
        font-family: var(--heo-font);
        font-size: 10px;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.revision, s.registry, s.geometry] as const,
    shallowArrayEquals,
  );

  @state() private classDraft = '';
  /** Which class chip is expanded into its definition, if any. */
  @state() private openClass: string | null = null;
  /** Which class has its "just this element" options showing, if any. */
  @state() private detachOpen: string | null = null;
  /** Name typed for the copy, empty while the suggested one will do. */
  @state() private forkDraft = '';
  @state() private classProperty = '';
  /** What the panel is being filtered by. Empty shows every section. */
  @state() private filter = '';
  /** Whether the add-a-declaration popup is up. */
  @state() private adderOpen = false;
  /** Where it is placed, computed against the trigger when it opens. */
  @state() private adderStyle = '';
  /**
   * The declarations being written, one row each.
   *
   * A list rather than a single pair, because setting one property is rarely the whole intention —
   * a shadow is a colour and an offset, a grid is a template and a gap. The old form could only
   * take one at a time, so three declarations meant three trips through the same box and three
   * separate entries on the undo stack.
   */
  @state() private draftRows: Array<{ property: string; value: string }> = [];
  /** The element whose size cap has already auto-opened the parent section. */
  #capsShownFor: HTMLElement | null = null;
  @state() private sectionsVersion = 0;
  /**
   * Which CSS rule groups are open, and the add-property draft inside each.
   *
   * A Map rather than a Set because every open group owns a draft: they are all on
   * screen at once, so one shared field would put the text in the wrong group.
   * Not reactive by itself — mutations bump `sectionsVersion`.
   */
  private readonly openRules = new Map<string, string>();

  override render(): TemplateResult {
    const el = this.editor.selected;
    if (!el || !el.isConnected) {
      return html`<div class="empty">
        Select an element on the page to edit its styles.<br />
        Arrow keys move the selection once something is selected.
      </div>`;
    }

    const computed = getComputedStyle(el);
    const inFlight = this.editor.previewTarget;
    const preview = inFlight && inFlight.el === el ? inFlight : null;
    const rules = appliedRules(el);
    const cascade = cascadedDeclarations(rules);
    const inline = authoredInline(el, preview);
    const { values: declared, origins } = declaredMap(cascade, inline);
    // Subtract any live preview. It is painted onto the style attribute, so the cascade
    // read above cannot tell it apart from a value the user actually set — and feeding
    // it back into the row it came from would tell that row its half-typed text is
    // already committed. Undo then has nothing to take back, and the commit that
    // follows looks like a no-op.
    //
    // The origin is put back along with the value, and that is the part that keeps
    // backspace from being destructive. Emptying a field takes the property out of the
    // style attribute, so the row read as "this element declares nothing here" and was
    // dropped from "Set on this element" on the keystroke that blanked it — taking the
    // caret, and the value being replaced, with it. The declaration is still there as
    // far as the user and the undo stack are concerned, so the row stays until the
    // empty value is actually committed, which is to say until focus leaves.
    if (preview) {
      if (preview.before) {
        declared.set(preview.property, preview.before);
        origins.set(preview.property, { kind: 'inline', selector: 'style attribute' });
      } else {
        declared.delete(preview.property);
      }
    }

    const filtering = Boolean(this.filter.trim());
    /*
     * Computed once, used three times.
     *
     * #matchingRules walks every stylesheet through stateRules, and this render runs on every
     * keystroke while filtering — so the count beside the field, the empty-state test and the
     * CSS rules section all read the same list rather than each rebuilding it.
     */
    const matching = this.#matchingRules(el, rules);
    const found = filtering ? this.#matchCount(el, computed, declared, matching) : -1;

    return html`
      <div class="top">
        <span class="chip">${icon('cursor', 11)} ${labelFor(el)}</span>
        <!--
          The filter sits on the first line, in the room Extract class used to take.

          It is the most-wanted thing in a panel this long — there are more than a hundred
          properties across a dozen sections — so it belongs where the eye already is rather than
          buried among them. Extract class moved into Classes, which is where the rest of that
          subject lives anyway.
        -->
        <heo-search-field
          label="Search in element"
          placeholder="Search in element…"
          .value=${this.filter}
          .count=${found}
          action=${this.#addLabel()}
          action-icon="plus"
          action-compact
          @search-input=${(event: CustomEvent<{ value: string }>) => {
        this.filter = event.detail.value;
      }}
          @search-submit=${() => this.#openAdder(this.filter.trim())}
        ></heo-search-field>
      </div>

      ${this.#renderModified(el, computed, declared, origins, inline)}
      ${this.#renderClasses(el)} ${this.#renderCssRules(el, matching, cascade)}
      ${this.#renderSpacing(el, computed, declared, origins)}
      ${SECTIONS.filter((section) => !section.when || section.when(computed)).map((section) =>
        this.#renderSection(section, el, computed, declared, origins),
      )}
      ${this.#renderParent(el, computed, declared, origins)}
      <!-- Withheld while the popup is up: the user has acted on these completions, and leaving
           them behind the popup restates a question that has been answered. -->
      ${found === 0 && !this.adderOpen ? this.#renderNoMatch() : nothing}
      ${this.adderOpen ? this.#renderAddPopup(el) : nothing}
    `;
  }

  /**
   * How the parent treats this element — and, when it is the reason a size is
   * being ignored, the parent's own properties.
   *
   * Two things live here that used to be missing. First, an answer to "I set a
   * bigger width and nothing happened": the ancestor holding the cap is named,
   * with its declaration editable in place, so the fix happens where the cause is
   * rather than by piling `!important` onto the child. Second, the parent controls
   * that decide how much room a child gets at all — a flex row's `flex-wrap` and
   * `gap`, a grid's template.
   *
   * Editing someone else's element is the risk here, so the parent's rows are
   * fenced off: their own sub-header names the element, every row says so in its
   * tooltip, hovering the group highlights it on the page, and one click selects
   * it outright.
   */
  #renderParent(
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    origins: Map<string, DeclarationOrigin>,
  ): TemplateResult | typeof nothing {
    const parent = selectableParent(el);
    const parentComputed = parent ? getComputedStyle(parent) : null;
    const all = ['flex', 'align-self', 'order'];
    if (parentComputed?.display.includes('grid')) all.push('grid-column', 'grid-row');
    const filtering = Boolean(this.filter.trim());
    const own = all.filter((property) => this.#matches(property, declared.get(property)));
    // The parent's own controls and the cap notices are about the parent, and the field says
    // "search in element" — so while filtering this section is its matching rows or nothing.
    if (filtering && !own.length) return nothing;

    const caps = filtering
      ? []
      : [...sizeConstraints(el, 'width'), ...sizeConstraints(el, 'height')].filter(
        (cap) => cap.binding,
      );
    const setCount = own.filter((property) => declared.has(property)).length;

    // Open itself the first time a cap turns up for this element: it is the answer
    // to a question the user is actively asking, and hiding it behind a disclosure
    // defeats the point. Recorded in the session set rather than forcing `open`, so
    // collapsing it still sticks.
    if (caps.length && this.#capsShownFor !== el) {
      this.#capsShownFor = el;
      userToggled.set('child', true);
    }

    return html`<heo-section
      heading="In its parent"
      glyph="moveOut"
      badge=${caps.length ? String(caps.length) : setCount ? String(setCount) : ''}
      ?open=${filtering ? true : sectionOpen('child', caps.length > 0 || setCount > 0)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('child', event.detail.open)}
    >
      ${caps.length ? caps.map((cap) => this.#renderConstraint(cap)) : nothing}

      <div class="rows">
        ${own.map((property) =>
          this.#renderRow(property, el, computed, declared, undefined, origins),
        )}
      </div>

      ${filtering
        ? nothing
        : parent && parentComputed
          ? this.#renderParentControls(parent, parentComputed)
          : html`<p class="hint" style="margin:9px 0 0">
              This element has no editable parent, so its size is decided by the viewport.
            </p>`}
    </heo-section>`;
  }

  /** One "something above is capping this" notice, with the cause editable. */
  #renderConstraint(cap: SizeConstraint): TemplateResult {
    const owner = cap.el;
    return html`<div
      class="capped"
      @pointerenter=${() => this.editor.hover(owner)}
      @pointerleave=${() => this.editor.hover(null)}
    >
      <div class="head">
        <span class="g">${icon('lock', 12)}</span>
        <span class="what">
          Only ${Math.round(cap.available)}px of ${cap.axis} is available here:
          <button
            class="link"
            type="button"
            title="Select this ancestor"
            @click=${() => this.editor.select(owner)}
          >
            ${labelFor(owner)}
          </button>
          sets <code class="mono">${cap.property}: ${cap.value}</code>${cap.depth > 1
        ? html`, ${cap.depth} levels up`
        : nothing}.
        </span>
      </div>
      <div class="row">
        <span class="name" title=${`${cap.property} on ${labelFor(owner)}`}>
          <span class="dot"></span>${cap.property}
        </span>
        <heo-value-field
          .value=${cap.value}
          .kind=${valueKindFor(cap.property)}
          .property=${cap.property}
          .suggestions=${buildSuggestions(this.editor, cap.property, owner)}
          clearable
          @value-change=${(event: CustomEvent<{ value: string }>) =>
        this.editor.setStyle(cap.property, event.detail.value, owner)}
        ></heo-value-field>
      </div>
    </div>`;
  }

  /** The parent's own layout properties, clearly fenced off as not this element's. */
  #renderParentControls(parent: HTMLElement, parentComputed: CSSStyleDeclaration): TemplateResult {
    const properties = parentLayoutProperties(parent);
    const parentDeclared = new Map(
      Array.from(declaredValues(parent), ([property, entry]) => [property, entry.value]),
    );
    const parentOrigins = new Map<string, DeclarationOrigin>(
      Array.from(declaredValues(parent), ([property, entry]) => [
        property,
        {
          kind: entry.from === 'style attribute' ? ('inline' as const) : ('rule' as const),
          selector: entry.from,
        },
      ]),
    );
    const setCount = properties.filter((property) => parentDeclared.has(property)).length;

    return html`<div
      class="onparent"
      @pointerenter=${() => this.editor.hover(parent)}
      @pointerleave=${() => this.editor.hover(null)}
    >
      <div class="sub">
        <span class="g">${icon('moveOut', 11)}</span>
        <span class="who">
          On the parent,
          <button
            class="link"
            type="button"
            title="Select the parent"
            @click=${() => this.editor.select(parent)}
          >
            ${labelFor(parent)}
          </button>
        </span>
        ${setCount ? html`<span class="count">${setCount} set</span>` : nothing}
      </div>
      <p class="hint" style="margin:0 0 8px">
        These change the container, so every child moves with them.
      </p>
      <div class="rows">
        ${properties.map((property) =>
      this.#renderRow(property, parent, parentComputed, parentDeclared, undefined, parentOrigins),
    )}
      </div>
    </div>`;
  }

  /**
   * Everything this element actually sets, first in the panel.
   *
   * "Set" means declared somewhere that matches this element, as opposed to
   * inherited or left at the browser's default — which is the same distinction the
   * blue dot has always drawn on a row. Restricting this to the `style` attribute
   * made the section disagree with its own dots and hid the majority of what a real
   * page declares, since most declarations live in a stylesheet.
   *
   * It answers a question the grouped sections below cannot: they are organised by
   * concern, so `margin-top` is buried inside Spacing and an unusual property might
   * not appear in any group at all. Rows are intentionally duplicated with those
   * sections — the same declaration being editable in two places is less confusing
   * than not being able to find it.
   *
   * Ordered inline-first, because the values written onto this element are the ones
   * a user is most likely to have just changed.
   */
  #renderModified(
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    origins: Map<string, DeclarationOrigin>,
    inline: Record<string, string>,
  ): TemplateResult | typeof nothing {
    const filtering = Boolean(this.filter.trim());
    const properties = [...declared.keys()]
      // Longhands synthesised from a box shorthand are already represented by the
      // shorthand itself; listing both would double every margin and padding.
      .filter((property) => origins.has(property))
      // Only what this element itself declares. Anything arriving from a rule belongs
      // to that rule, and now has somewhere better to be edited: a class under
      // Classes, any other selector under CSS rules. Listing them here invited the
      // one edit nobody wants — an inline override on this element, forking the
      // design instead of fixing the rule that was actually responsible.
      .filter((property) => origins.get(property)?.kind === 'inline')
      // Narrowed by the search like every other surface, on the name or the value.
      .filter((property) => this.#matches(property, declared.get(property)))
      .sort((a, b) => {
        const rank = (property: string): number => (inline[property] !== undefined ? 0 : 1);
        return rank(a) - rank(b) || a.localeCompare(b);
      });
    const inlineCount = Object.keys(inline).length;
    // While filtering the section is only worth drawing when it has a row: its empty state is an
    // explanation of the cascade, which is not an answer to what was typed.
    if (filtering && !properties.length) return nothing;

    return html`<heo-section
      heading="Set on this element"
      glyph="sliders"
      badge=${properties.length ? String(properties.length) : ''}
      ?open=${filtering ? true : sectionOpen('modified', properties.length > 0)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('modified', event.detail.open)}
    >
      ${properties.length === 0
        ? html`<p class="hint" style="margin:0">
            Nothing is set on the element itself. What reaches it comes from its classes or from
            other rules, listed below. Changing a value anywhere else on this panel writes it
            onto the element and it will appear here.
          </p>`
        : html`<p class="hint" style="margin:0 0 9px">
              On the element itself, as authored — highest priority in the cascade. What its
              classes and other rules contribute is below, editable at the source.
            </p>
            <div class="rows">
              ${repeat(
          properties,
          (property) => property,
          (property) => this.#renderRow(property, el, computed, declared, undefined, origins),
        )}
            </div>
            ${inlineCount && !filtering
            ? html`<button
                  class="btn sm"
                  type="button"
                  style="margin-top:9px"
                  title="Move this element's inline declarations into a reusable class"
                  @click=${() => this.editor.beginClassExtraction()}
                >
                  ${icon('blocks', 12)} Extract ${inlineCount} inline into a class
                </button>`
            : nothing}`}
    </heo-section>`;
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Every rule reaching this element that is not one of its own classes.
   *
   * The reason this section exists is a mismatch it fixes. `*`, `p`, `.fig .ph` and
   * `.pull blockquote` all put declarations on an element, and they used to surface
   * among the element's own values — where changing one wrote an inline override on
   * this element alone, quietly forking the design instead of editing the rule that
   * was actually responsible. Grouping them by the selector they came from, with the
   * same editor a class gets, means the edit lands where the cause is.
   *
   * State and pseudo-element rules live here too. They are found separately, because
   * `:hover` does not match while a panel is asking and `::before` cannot match at
   * all, so both were previously invisible — there was no way to reach the styling of
   * a link's hover, or a pseudo-element's content, from the editor.
   *
   * Closed by default, and one closed sub-section per selector: this is reference
   * material for when something unexpected is happening, not the first thing to read.
   */
  #renderCssRules(
    el: HTMLElement,
    all: AppliedRule[],
    cascade: Map<string, { from: AppliedRule }>,
  ): TemplateResult | typeof nothing {
    // Already narrowed by #matchingRules in render, because the count beside the search field is
    // drawn from the same list and the two must not disagree. Inline is "Set on this element"; a
    // bare single-class selector is "Classes". Both edit the same declarations somewhere better.
    const filtering = Boolean(this.filter.trim());
    if (filtering && !all.length) return nothing;

    return html`<heo-section
      heading="CSS rules"
      glyph="code"
      badge=${all.length ? String(all.length) : ''}
      ?open=${filtering ? true : sectionOpen('cssrules', all.length > 0)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('cssrules', event.detail.open)}
    >
      ${all.length === 0
        ? html`<p class="hint" style="margin:0">
            No stylesheet rule beyond this element's own classes reaches it, so everything else is
            inherited or a browser default.
          </p>`
        : html`<p class="hint" style="margin:0 0 8px">
              Most specific first. Editing one of these changes the rule itself, so every element it
              matches changes with it — unlike the values above, which are this element's alone.
            </p>
            ${repeat(
          all,
          (rule) => this.#ruleKey(rule),
          (rule) => this.#renderRuleGroup(rule, el, cascade),
        )}`}
    </heo-section>`;
  }

  /**
   * Identity for a rule across re-renders.
   *
   * Selector plus source plus condition, rather than the live `CSSStyleRule`: keying
   * on the object would defeat `repeat`'s reuse the moment a stylesheet is re-read.
   * The pseudo is in there because `a` and `a:hover` are two groups the user opens
   * independently.
   */
  #ruleKey(rule: AppliedRule): string {
    return `${rule.source}|${rule.condition ?? ''}|${rule.selector}|${rule.pseudo ?? ''}`;
  }

  /** One selector, collapsed, with the Classes editor inside it. */
  #renderRuleGroup(
    rule: AppliedRule,
    el: HTMLElement,
    cascade: Map<string, { from: AppliedRule }>,
  ): TemplateResult {
    const key = this.#ruleKey(rule);
    const expanded = this.openRules.has(key);
    const shown = rule.matchedSelector ?? rule.selector;
    const declarations: Record<string, string> = {};
    for (const one of rule.declarations) declarations[one.property] = one.value;
    const live = rule.rule;

    // Subtract any live preview, exactly as the element's own rows do with an inline
    // one. `rule.declarations` was read off the live rule, and a preview is painted
    // into that rule — so without this the row is handed its own half-typed text as
    // its committed value. Nothing then looks like it changed: the commit dedupes to
    // a no-op, and the focus-out that follows reverts the preview instead, which read
    // as the edit being rolled back to whatever the stylesheet said.
    //
    // An emptied field restores the value it started from rather than dropping the
    // property, so backspacing to retype cannot delete the declaration out from under
    // the caret. Removing it is what the commit does, once it is asked for.
    const preview = this.editor.rulePreviewTarget;
    if (live && preview && preview.rule === live) {
      if (preview.before) declarations[preview.property] = preview.before;
      else delete declarations[preview.property];
    }

    const target: DeclarationTarget = {
      label: shown,
      id: key.replace(/[^\w-]/g, '_'),
      declarations,
      empty: 'This rule declares nothing the editor can read.',
      preview: (property, value) => {
        if (live) this.editor.previewRuleDeclaration(live, property, value);
      },
      commit: (property, value) => {
        if (live) this.editor.setRuleDeclaration(live, property, value);
      },
      remove: (property) => {
        if (live) this.editor.setRuleDeclaration(live, property, '');
      },
      // A state rule is not in the cascade as things stand, so it cannot be said to be
      // overridden — dimming it on that basis would be telling the user something false.
      overridden: (property) => {
        if (rule.pseudo) return false;
        const winner = cascade.get(property);
        return winner ? winner.from !== rule : false;
      },
      describe: (property) => {
        if (rule.pseudo) {
          return `${property} applies to ${shown}, a state this element is not in right now`;
        }
        const winner = cascade.get(property);
        if (winner && winner.from !== rule) return `Overridden by ${winner.from.selector}`;
        return `${property} wins the cascade here`;
      },
      resolve: (property) =>
        rule.pseudo ? '' : getComputedStyle(el).getPropertyValue(property).trim(),
    };

    const host = {
      engine: this.editor,
      element: el,
      newProperty: this.openRules.get(key) ?? '',
      onNewProperty: (value: string) => {
        this.openRules.set(key, value);
        this.sectionsVersion += 1;
      },
      onFocus: (property: string) => focusDeclaration(this.renderRoot, property),
      // Editing the declarations is the point here; a rule has no "apply to selection"
      // and deleting a shared rule from one element's panel is far too large an action.
      actions: 'none' as const,
    };

    return html`<div class="cls">
      <header
        role="button"
        tabindex="0"
        aria-expanded=${expanded}
        @click=${() => this.#toggleRule(key)}
        @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.#toggleRule(key);
      }}
      >
        ${icon(expanded ? 'chevronDown' : 'chevronRight', 11)}
        <span class="n mono" title=${rule.selector}>${shown}</span>
        <span class="meta">
          ${rule.declarations.length}
          ${rule.declarations.length === 1 ? 'rule' : 'rules'} · ${rule.source}${rule.condition
        ? ` · ${rule.condition}`
        : ''}
        </span>
      </header>
      ${expanded
        ? html`${rule.pseudo
          ? html`<p class="hint" style="margin:0 0 6px">
                Applies on <code class="mono">${rule.pseudo}</code>, so the page will not change
                until that state is active.
              </p>`
          : nothing}
            ${ClassEditor.renderDeclarations(target, host)}`
        : nothing}
    </div>`;
  }

  #toggleRule(key: string): void {
    if (this.openRules.has(key)) this.openRules.delete(key);
    else this.openRules.set(key, '');
    this.sectionsVersion += 1;
  }

  /**
   * The element's classes, and the way to add one.
   *
   * Searchable by name and by what the class declares, so `1px solid` finds the class that sets
   * it. Hiding this section while filtering — which is what it used to do — meant a search could
   * not answer the question a class is most often the answer to: where is this value coming from.
   */
  #renderClasses(el: HTMLElement): TemplateResult | typeof nothing {
    const classes = Array.from(el.classList).filter((name) => !name.startsWith('heo-'));
    const filtering = Boolean(this.filter.trim());
    const shown = filtering ? this.#matchingClasses(el) : classes;
    // Nothing here matches, and while filtering the affordances below are not what was asked for.
    if (filtering && !shown.length) return nothing;
    return html`<heo-section
      heading="Classes"
      glyph="blocks"
      badge=${shown.length ? String(shown.length) : ''}
      ?open=${filtering ? true : sectionOpen('classes', classes.length > 0)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('classes', event.detail.open)}
    >
      <!-- Moved off the panel's first line. Making a class out of what is set here is a thing
           about classes, so it belongs with them. Withheld while filtering: a search asks what is
           already here, and this makes something new. -->
      ${filtering
        ? nothing
        : html`<button
            class="btn sm"
            type="button"
            style="margin-bottom:9px"
            title="Turn this element's inline styles into a reusable class"
            @click=${() => this.editor.beginClassExtraction(el)}
          >
            ${icon('droplet', 12)} Extract class
          </button>`}
      ${shown.length
        ? html`<div class="chips">
            ${repeat(
          shown,
          (name) => name,
          (name) => {
            const defined = this.editor.classes.get(name);
            const open = this.openClass === name;
            return html`<span
                class=${`chip${defined ? ' known' : ''}${open ? ' open' : ''}`}
                title=${defined
                ? `${Object.keys(defined.declarations).length} declarations — click to edit them`
                : 'Click to see where this class comes from'}
                >
                <button
                  class="name"
                  type="button"
                  aria-expanded=${open}
                  @click=${() => {
                this.openClass = open ? null : name;
                // Whatever was half-answered about the last class does not carry
                // over to this one.
                this.detachOpen = null;
                this.forkDraft = '';
              }}
                >
                  ${icon(open ? 'chevronDown' : 'chevronRight', 8)} ${name}
                </button>
                <button
                  class="kill"
                  type="button"
                  aria-label=${`Remove class ${name}`}
                  title=${`Remove .${name} from this element`}
                  @click=${() => this.editor.toggleClass(name, el)}
                >
                  ${icon('close', 9)}
                </button>
              </span>`;
          },
        )}
          </div>`
        : html`<p class="hint" style="margin:0 0 8px">
            No classes yet. Adding one keeps styling reusable instead of inline.
          </p>`}

      ${this.openClass && shown.includes(this.openClass)
        ? this.#renderOpenClass(this.openClass, el)
        : nothing}

      ${filtering
        ? nothing
        : html`<heo-value-field
              label="class"
              action="Add this class"
              action-icon="plus"
              .suggestions=${classSuggestions(this.editor, this.classDraft)}
              placeholder="find or type a class name"
              @value-input=${(event: CustomEvent<{ value: string }>) => {
            this.classDraft = event.detail.value;
          }}
              @value-submit=${(event: CustomEvent<{ value: string }>) =>
            this.#addClass(el, event.detail.value, event.target as HeoValueField)}
            ></heo-value-field>
            <p class="hint" style="margin:6px 0 0">
              Search the project's classes or type a new name, then press Enter or the add
              button.
            </p>`}
    </heo-section>`;
  }

  /**
   * The class's definition, opened in place under its chip.
   *
   * The same editor the design system panel uses, on purpose: a class means the
   * same thing in both places, and editing one here changes every element wearing
   * it — a distinction worth making obvious rather than re-teaching in a second UI.
   */
  #renderOpenClass(name: string, el: HTMLElement): TemplateResult {
    const entry = this.editor.classes.get(name);
    const host = {
      engine: this.editor,
      element: el,
      newProperty: this.classProperty,
      onNewProperty: (value: string) => {
        this.classProperty = value;
      },
      onRemoved: () => {
        this.openClass = null;
      },
      onFocus: (property: string) => focusDeclaration(this.renderRoot, property),
      // Reached from this element's own chips: "Apply to selection" is already true,
      // and deleting a rule every other element shares is far too large an action to
      // sit under one element's panel. The design system panel owns both.
      actions: 'none' as const,
    };
    if (!entry) return ClassEditor.renderUnknown(name, host);

    const uses = this.editor.classes.usage().get(name) ?? 0;
    return html`
      <p class="hint" style="margin:0 0 6px">
        Editing <code class="mono">.${name}</code>${uses > 1
        ? html` changes all ${uses} elements using it.`
        : html`, which only this element uses.`}
        <button
          class="link"
          type="button"
          title="Open this class in the design system panel"
          @click=${() => this.editor.setDockTab('tokens')}
        >
          Manage it in Tokens
        </button>
        ·
        <button
          class="link"
          type="button"
          aria-expanded=${this.detachOpen === name}
          title=${uses > 1
        ? `Style this element on its own, without affecting the other ${uses - 1} using .${name}`
        : `Style this element on its own, without .${name}`}
          @click=${() => {
        this.detachOpen = this.detachOpen === name ? null : name;
      }}
        >
          ${this.detachOpen === name ? 'Never mind' : 'Just this element…'}
        </button>
      </p>
      ${this.detachOpen === name ? this.#renderDetach(entry, el, uses) : nothing}
      ${ClassEditor.render(entry, {
        expanded: true,
        uses,
        bare: true,
        onToggle: () => {
          this.openClass = null;
        },
        host,
      })}
    `;
  }

  /**
   * The way back out of a shared class, for one element.
   *
   * Extracting into a class is a one-way door as things stand: past that point the
   * only ways to make a single element differ were to pile an inline override on top
   * of the class — which leaves the class in the markup, still claiming to describe
   * the element — or to retype every declaration by hand and remember to remove it.
   * Neither is what "just change this one" means, and both are worse than the state
   * before the extraction happened.
   *
   * Two routes rather than one, because the two answers to "is this still a thing
   * worth naming" lead different places. Inlining is the exact inverse of extraction
   * and the right move for values that were only ever this element's. Forking keeps a
   * reusable rule and is the right move for a variant, which is most of the time —
   * so it leads, and it is the one Enter would take.
   */
  #renderDetach(entry: DesignClass, el: HTMLElement, uses: number): TemplateResult {
    const count = Object.keys(entry.declarations).length;
    const others = Math.max(0, uses - 1);
    const suggestion = this.editor.classes.uniqueName(entry.name);
    const forkName = this.forkDraft.trim() || suggestion;
    // Dropped with the last element wearing it, unless the page authored it: an
    // overlay-owned rule with no users is dead weight in the export.
    const orphans = others === 0 && entry.origin !== 'stylesheet';

    return html`<div class="detach">
      <p class="lede">
        ${others
        ? html`<code class="mono">.${entry.name}</code> is on ${uses} elements. Both options leave
            the other ${others} alone.`
        : html`Only this element uses <code class="mono">.${entry.name}</code>.`}
      </p>

      <div class="choice">
        <div class="head">
          ${icon('duplicate', 12)}
          <b>Copy it for this element</b>
        </div>
        <p>
          Makes <code class="mono">.${forkName}</code> with the same ${count}
          declaration${count === 1 ? '' : 's'} and swaps it in here. Still a class you can reuse,
          just not a shared one.
        </p>
        <div class="row">
          <input
            class="input mono fork-input"
            type="text"
            .value=${this.forkDraft}
            placeholder=${suggestion}
            spellcheck="false"
            autocomplete="off"
            aria-label="Name for the copy"
            @input=${(event: Event) => {
        this.forkDraft = (event.target as HTMLInputElement).value;
      }}
            @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.#fork(entry.name, el);
      }}
          />
          <button class="btn sm primary" type="button" @click=${() => this.#fork(entry.name, el)}>
            ${icon('duplicate', 12)} Copy
          </button>
        </div>
      </div>

      <div class="choice">
        <div class="head">
          ${icon('unlink', 12)}
          <b>Move the styles onto the element</b>
        </div>
        <p>
          The exact opposite of extracting a class: the ${count}
          declaration${count === 1 ? '' : 's'} become this element's own inline styles and
          <code class="mono">.${entry.name}</code>
          comes off it${orphans
        ? html`. Nothing else uses it, so the rule goes too.`
        : html`, but stays defined for the rest.`}
        </p>
        <div class="row">
          <span class="spacer"></span>
          <button
            class="btn sm"
            type="button"
            @click=${() => {
        if (!this.editor.inlineClass(entry.name, el)) return;
        this.detachOpen = null;
        this.openClass = null;
      }}
          >
            ${icon('unlink', 12)} Move to this element
          </button>
        </div>
      </div>
    </div>`;
  }

  /** Fork the class, then follow it: the panel should be editing the copy. */
  #fork(name: string, el: HTMLElement): void {
    const forked = this.editor.forkClass(name, el, this.forkDraft.trim() || undefined);
    if (!forked) return;
    this.forkDraft = '';
    this.detachOpen = null;
    this.openClass = forked;
  }

  /**
   * Apply a class and hand the field back, empty, still focused.
   *
   * Clearing has to be done through the field's own API: while it has focus it
   * deliberately ignores external writes to `value`, otherwise every re-render of
   * this panel would overwrite what is being typed.
   */
  #addClass(el: HTMLElement, raw: string, field?: HeoValueField): void {
    const name = normalizeClassName(raw);
    if (!name) {
      if (raw.trim()) this.editor.notify(`"${raw}" is not a valid class name.`, 'error');
      return;
    }
    if (el.classList.contains(name)) {
      this.editor.notify(`${labelFor(el)} already has .${name}.`, 'info');
    } else {
      this.editor.toggleClass(name, el);
    }
    this.classDraft = '';
    field?.reset('');
    field?.focusInput();
  }

  /**
   * Spacing: the box editor, plus the two shorthands as rows.
   *
   * Searchable now, which it was not. `margin` and `padding` are not in SECTIONS — the box editor
   * is a diagram, not a list of rows, so this section is written by hand — and the filter only ever
   * looked at SECTIONS, so the two most-reached-for properties in CSS could not be found by typing
   * their names. The section narrows itself instead: the box editor stays for any spacing query,
   * since it is the editor for all eight sides at once, and the shorthand rows come and go with
   * the query like every other row.
   */
  #renderSpacing(
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    origins: Map<string, DeclarationOrigin>,
  ): TemplateResult | typeof nothing {
    const longhands = SPACING_PROPERTIES.filter((property) => property.includes('-'));
    const declaredBox: Record<string, string> = {};
    for (const property of longhands) declaredBox[property] = declared.get(property) ?? '';
    const computedBox: Record<string, string> = { width: computed.width, height: computed.height };
    for (const property of longhands) computedBox[property] = computed.getPropertyValue(property);

    const hits = SPACING_PROPERTIES.filter((property) =>
      this.#matches(property, declared.get(property)),
    );
    if (!hits.length) return nothing;
    const shorthands = ['margin', 'padding'].filter((property) => hits.includes(property));

    const touched = longhands.filter((property) => declaredBox[property]).length;

    return html`<heo-section
      heading="Spacing"
      glyph="wrap"
      badge=${touched ? String(touched) : ''}
      ?open=${this.filter.trim() ? true : sectionOpen('spacing', true)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('spacing', event.detail.open)}
    >
      <heo-box-editor
        .declared=${declaredBox}
        .computed=${computedBox}
        .suggestions=${buildSuggestions(this.editor, 'margin', el)}
        @box-change=${(event: CustomEvent<{ declarations: Record<string, string> }>) =>
        this.editor.setStyles(event.detail.declarations, 'Adjust spacing', el)}
      ></heo-box-editor>

      ${shorthands.length
        ? html`<div class="rows" style="margin-top:10px">
            ${shorthands.map((property) =>
          this.#renderRow(property, el, computed, declared, `all sides`, origins),
        )}
          </div>`
        : nothing}
    </heo-section>`;
  }

  #renderSection(
    section: SectionSpec,
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    origins: Map<string, DeclarationOrigin>,
  ): TemplateResult | typeof nothing {
    const properties = section.properties.filter((property) =>
      this.#matches(property, declared.get(property)),
    );
    // Searched and nothing here matches: the section goes rather than standing open and empty.
    if (!properties.length) return nothing;
    const setCount = properties.filter((property) => declared.has(property)).length;
    return html`<heo-section
      heading=${section.heading}
      glyph=${section.glyph}
      badge=${setCount ? String(setCount) : ''}
      ?open=${this.filter.trim()
        ? true
        : sectionOpen(section.id, section.id === 'layout' || section.id === 'typography')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember(section.id, event.detail.open)}
    >
      ${section.note ? html`<p class="hint" style="margin:0 0 9px">${section.note}</p>` : nothing}
      <div class="rows">
        ${properties.map((property) =>
          this.#renderRow(property, el, computed, declared, undefined, origins),
        )}
      </div>
    </heo-section>`;
  }

  /**
   * One property row.
   *
   * Shows the value that actually wins the cascade, as authored. That matters more
   * than it sounds: a `width: min(980px, calc(100% - var(--space-xl)))` living in a
   * stylesheet used to appear as a grey `948px` placeholder, so the panel described
   * the outcome while hiding the intent — and the expression the user wanted to
   * adjust was nowhere on screen. The resolved number is still one click away, at
   * the top of the value list.
   *
   * Where the value came from is marked rather than flattened, because editing here
   * always writes onto this element: adjusting a value that arrived from `.card`
   * creates an inline override, which is a different act from fixing the class.
   */
  #renderRow(
    property: string,
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    placeholderOverride?: string,
    origins?: Map<string, DeclarationOrigin>,
  ): TemplateResult {
    const value = declared.get(property) ?? '';
    const isSet = declared.has(property);
    const origin = origins?.get(property);
    const computedValue = computed.getPropertyValue(property).trim();
    const segments = SEGMENTED[property];

    const control = segments
      ? html`<heo-segmented
          .options=${segments}
          .value=${value || computedValue}
          clearable
          label=${property}
          @segment-change=${(event: CustomEvent<{ value: string }>) =>
          this.editor.setStyle(property, event.detail.value, el)}
        ></heo-segmented>`
      : html`<heo-value-field
          .value=${value}
          .kind=${valueKindFor(property)}
          .property=${property}
          .computed=${computedValue}
          .suggestions=${buildSuggestions(this.editor, property, el)}
          placeholder=${placeholderOverride ?? shorten(computedValue)}
          clearable
          @value-input=${(event: CustomEvent<{ value: string }>) =>
          this.editor.previewStyle(property, event.detail.value, el)}
          @value-revert=${() => this.editor.cancelPreview()}
          @value-change=${(event: CustomEvent<{ value: string }>) =>
          this.editor.setStyle(property, event.detail.value, el)}
        ></heo-value-field>`;

    const resettable = this.editor.canResetStyle(el, property);
    const baseline = this.editor.styleBaseline(el, property);

    return html`<div class=${`row${isSet ? ' set' : ''}`} data-property=${property}>
      <span class="name" title=${describeOrigin(property, value, computedValue, origin)}>
        <span class="dot"></span><span class="pn">${property}</span>
        ${origin && origin.kind === 'rule'
        ? html`<span class="from" title=${`From the ${origin.selector} rule`}>
              ${origin.selector}
            </span>`
        : nothing}
      </span>
      ${control}
      ${resettable
        ? html`<button
            class="reset"
            type="button"
            aria-label=${`Reset ${property}`}
            title=${baseline
            ? `Back to ${baseline}, its value before this session`
            : 'Remove this declaration, as it was before this session'}
            @click=${() => this.editor.resetStyle(property, el)}
          >
            ${icon('undo', 11)}
          </button>`
        : nothing}
    </div>`;
  }

  /* ---------------------------------------------------------------------- */

  /* ---------------------------------------------------------------------- */
  /* Finding a property, and adding one                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Whether any of these strings contains what is being searched for.
   *
   * One predicate for every surface, so "search in element" means the same thing wherever it is
   * applied: a property name, a value, a class name, a selector. Empty query matches everything,
   * which is what makes the unfiltered panel fall out of the same code path.
   */
  #hit(...texts: Array<string | undefined>): boolean {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) return true;
    return texts.some((text) => text?.toLowerCase().includes(needle));
  }

  /**
   * Whether a property row survives the filter.
   *
   * The value counts as well as the name, because half of what a user is looking for is a value:
   * which rows mention `var(--brand)`, where `1px solid` is coming from, what else is `flex`.
   * Searching only names meant the panel could not answer any of those.
   */
  #matches(property: string, value?: string): boolean {
    return this.#hit(property, value);
  }

  /** The element's classes the query reaches — by name, or by what the class declares. */
  #matchingClasses(el: HTMLElement): string[] {
    return Array.from(el.classList)
      .filter((name) => !name.startsWith('heo-'))
      .filter((name) => {
        if (this.#hit(name)) return true;
        const entry = this.editor.classes.get(name);
        if (!entry) return false;
        return Object.entries(entry.declarations).some(([property, value]) =>
          this.#hit(property, value),
        );
      });
  }

  /** The rules in the CSS rules section the query reaches — by selector, or by declaration. */
  #matchingRules(el: HTMLElement, rules: AppliedRule[]): AppliedRule[] {
    const direct = rules.filter(
      (rule) => rule.origin === 'stylesheet' && !fromElementClass(rule.selector, el),
    );
    return [...direct, ...stateRules(el)]
      .sort((a, b) => b.specificity - a.specificity)
      .filter(
        (rule) =>
          this.#hit(rule.selector, rule.matchedSelector, rule.source, rule.condition) ||
          rule.declarations.some((one) => this.#hit(one.property, one.value)),
      );
  }

  /**
   * How many things the filter is showing, across every surface that draws one.
   *
   * Counted rather than inferred so the number beside the field and what is on screen cannot
   * disagree — which is the whole reason the count lives here and not in the control. Properties
   * are de-duplicated across surfaces because one property drawn in two sections is still one
   * answer to "is this here"; a class and a rule each count once as themselves.
   */
  #matchCount(
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    matchingRules: readonly AppliedRule[],
  ): number {
    const properties = new Set<string>();
    const consider = (property: string): void => {
      if (this.#matches(property, declared.get(property))) properties.add(property);
    };
    for (const section of SECTIONS.filter((section) => !section.when || section.when(computed))) {
      for (const property of section.properties) consider(property);
    }
    for (const property of SPACING_PROPERTIES) consider(property);
    for (const property of declared.keys()) consider(property);
    return properties.size + this.#matchingClasses(el).length + matchingRules.length;
  }

  /** What the add action would do, named after what has been typed. */
  #addLabel(): string {
    const seed = this.filter.trim();
    return seed ? `Add ${seed}` : 'Add a declaration';
  }

  /**
   * What to show once the panel below has run out of rows.
   *
   * The completions belong here, not inside the add popup. Learning whether `flx` is a real
   * property only after opening a dialog and reading "nothing matches that" is one step too late:
   * by then the user has committed to adding something and still does not know what to type. So
   * the moment the panel empties, the field answers the question it just raised — here is what
   * exists with that in the name, and here is whether the thing you typed is a property at all.
   *
   * Validity comes from the browser rather than the catalogue. CSS.supports with `initial` is true
   * for any property the engine knows, which is a much larger set than the catalogue lists — so a
   * real property that is merely absent from it, `scroll-margin` for one, is not called invalid.
   */
  #renderNoMatch(): TemplateResult {
    const seed = this.filter.trim();
    const near = searchProperties(seed, 12).filter((meta) => meta.name !== seed);
    const real = seed ? propertyIsKnown(seed) : false;

    return html`<div class="nomatch">
      <p class="lede">
        Nothing on <b>${labelFor(this.editor.selected ?? document.body)}</b> matches
        “${seed}”.
      </p>

      ${real
        ? html`<p class="verdict yes">
            ${icon('check', 11)}
            <span><code class="mono">${seed}</code> is a CSS property. It is just not set here.</span>
          </p>`
        : near.length
          ? html`<p class="verdict no">
              ${icon('alert', 11)}
              <span>
                This browser does not recognise <code class="mono">${seed}</code>. It can still be
                written — for another browser, or for one that has yet to catch up — or you may
                have meant one of these:
              </span>
            </p>`
          : html`<p class="verdict no">
              ${icon('alert', 11)}
              <span>
                This browser does not recognise <code class="mono">${seed}</code>, and nothing
                resembles it. It can still be written if you are aiming at a browser that does.
              </span>
            </p>`}

      ${near.length
        ? html`<div class="offer" role="list">
            ${near.map(
          (meta) => html`<button
                class="option"
                type="button"
                role="listitem"
                title=${`Add ${meta.name} to this element`}
                @click=${() => this.#openAdder(meta.name)}
              >
                <span class="name">${meta.name}</span>
                <span class="meta">${PROPERTY_GROUP_LABELS[meta.group]}</span>
              </button>`,
        )}
          </div>`
        : nothing}

      <!--
        Offered whatever the verdict says, and only styled as the primary action when this browser
        agrees the property exists. It used to be withheld for anything CSS.supports rejected,
        which quietly made the editor unable to write a declaration aimed at a different browser —
        and CSS.supports is an answer about this engine, not about CSS.
      -->
      ${seed
        ? html`<button
            class=${`btn sm${real ? ' primary' : ''}`}
            type="button"
            title=${real
          ? `Add ${seed} to this element`
          : `Add ${seed} anyway — this browser will ignore it`}
            @click=${() => this.#openAdder(seed)}
          >
            ${icon('plus', 12)} ${this.#addLabel()}
          </button>`
        : nothing}
    </div>`;
  }

  /**
   * Open the popup, seeded with whatever was being looked for.
   *
   * Searching for a property and not finding it is the most common way somebody arrives at wanting
   * to add one, so the query carries over rather than having to be typed a second time.
   */
  #openAdder(seed = ''): void {
    /*
     * Seeded with a starting value, not just a name.
     *
     * The same thing the class editor has always done when a property is added there, and the
     * reason is the same: a declaration with no value neither renders nor says what kind of value
     * it wants. It also means the commit button is live the moment the popup opens, so arriving
     * from "font-stretch is a CSS property, it is just not set here" and pressing the button
     * writes the declaration -- which is what pressing it looks like it should do.
     */
    const property = normalizeProperty(seed);
    this.draftRows = [{ property, value: property ? initialValueFor(property) : '' }];
    /*
     * Measured before it opens, not after.
     *
     * The anchor is already on screen — it is what was just clicked — while the popup is not, so
     * there is nothing to wait for. Positioning it afterwards meant one frame painted at the
     * element's static position, which for a panel pinned to the right edge put it across the page.
     */
    this.#positionAdder();
    this.adderOpen = true;
    void this.updateComplete.then(() => {
      // Re-measured once it exists, since its height decides whether it flips above the field.
      this.#positionAdder();
      const popup = this.renderRoot.querySelector<HTMLElement>('.addpop');
      if (popup && typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
        try {
          popup.showPopover();
        } catch {
          /* already open, or popovers are unsupported: it still renders in place */
        }
      }
      /*
       * Focused on the half that is missing.
       *
       * The popup used to open with nothing focused at all, which made a working feature look
       * broken: arriving from "font-stretch is a CSS property, it is just not set here" and
       * pressing the button gave a popup with the name already filled and no caret, so the value
       * being typed went to the document — where the global keymap was listening — and the commit
       * button stayed disabled. Clicking it then did nothing, correctly and unhelpfully.
       */
      const row = this.renderRoot.querySelector('.poprow');
      const target = property
        ? row?.querySelector('heo-value-field')
        : row?.querySelector('heo-search-field');
      target?.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus();
    });
  }

  /*
   * Dismissed by a press anywhere else, through `listen`.
   *
   * `listen` and not `addEventListener`, for the reason the other popovers document: the event
   * shield suppresses `pointerdown` for the page, so a plain listener never hears the press that
   * should close this.
   */
  #onOutsidePress = (event: Event): void => {
    if (!this.adderOpen) return;
    if (event.composedPath().some((node) => node instanceof HTMLElement && node.classList?.contains('addpop'))) {
      return;
    }
    if (event.composedPath().includes(this.renderRoot.querySelector('.top') as EventTarget)) return;
    this.#closeAdder();
  };

  /*
   * Kept under its anchor when the world moves.
   *
   * A fixed popup is placed once against a rect that anything can invalidate: the panel scrolls
   * under it, the dock is dragged, the window is resized. Without this it stays where it was and
   * ends up pointing at nothing — and since it is clamped to the viewport, a narrower window is
   * exactly the case where the first placement is furthest from where it belongs.
   */
  #onViewportChange = (): void => {
    if (this.adderOpen) this.#positionAdder();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    listen(document, 'pointerdown', this.#onOutsidePress, true);
    listen(window, 'scroll', this.#onViewportChange, true);
    listen(window, 'resize', this.#onViewportChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(document, 'pointerdown', this.#onOutsidePress, true);
    unlisten(window, 'scroll', this.#onViewportChange, true);
    unlisten(window, 'resize', this.#onViewportChange);
  }

  #closeAdder(): void {
    this.adderOpen = false;
    this.draftRows = [];
  }

  /**
   * Placed against the field that opened it, in the top layer.
   *
   * A popup rather than a modal, which is the point: adding a declaration is a small act done while
   * reading the panel, and a modal would black out the very rows the user is comparing against. The
   * top layer is needed all the same, because the dock clips its descendants and carries a backdrop
   * filter, so anything painted normally is cut off by the panel it belongs to.
   */
  #positionAdder(): void {
    const field =
      this.renderRoot.querySelector('.top heo-search-field') ?? this.renderRoot.querySelector('.top');
    const anchor = field?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(Math.max(anchor.width, 300), Math.max(300, innerWidth - 16));
    // Absent on the first pass, which is the point of the estimate: the popup does not exist yet.
    const height = this.renderRoot.querySelector('.addpop')?.getBoundingClientRect().height || 240;
    const spaceBelow = innerHeight - anchor.bottom;
    const above = spaceBelow < height + 12 && anchor.top > spaceBelow;
    const top = above ? Math.max(8, anchor.top - height - 6) : anchor.bottom + 6;
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, innerWidth - width - 8));
    this.adderStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px;width:${Math.round(width)}px`;
  }

  /**
   * The popup: a property and its value side by side, as many times as needed.
   *
   * Side by side because they are one declaration, and stacking them made a pair of unrelated
   * boxes. Repeatable because the useful unit of work is a rule, not a property — and committing
   * the rows together means one undo entry for a change the user made as one decision.
   */
  #renderAddPopup(el: HTMLElement): TemplateResult {
    const ready = this.draftRows.filter((row) => row.property.trim() && row.value.trim()).length;

    return html`<div
      class="addpop"
      popover="manual"
      style=${this.adderStyle}
      role="dialog"
      aria-label="Add declarations"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        // Not allowed to bubble: the global keymap reads Escape as "deselect", and closing a
        // popup is not a request to change what is selected.
        event.stopPropagation();
        this.#closeAdder();
      }}
    >
      <div class="pophead">
        <span>Add declarations to <code class="mono">${labelFor(el)}</code></span>
        <button
          class="btn icon ghost sm"
          type="button"
          aria-label="Close"
          @click=${() => this.#closeAdder()}
        >
          ${icon('close', 11)}
        </button>
      </div>

      <div class="poprows">
        ${this.draftRows.map((row, index) => this.#renderDraftRow(el, row, index))}
      </div>

      <div class="popfoot">
        <button
          class="btn sm"
          type="button"
          title="Add another declaration to this batch"
          @click=${() => {
        this.draftRows = [...this.draftRows, { property: '', value: '' }];
      }}
        >
          ${icon('plus', 12)} Another
        </button>
        <!-- A disabled button is a dead end unless it says what is missing. -->
        ${ready === 0
        ? html`<span class="why">${icon('alert', 11)} Needs a property and a value</span>`
        : nothing}
        <span class="spacer"></span>
        <button
          class="btn sm primary"
          type="button"
          ?disabled=${ready === 0}
          title=${ready === 0
        ? 'Fill in both a property and a value first'
        : 'Write these declarations onto the element'}
          @click=${() => this.#commitRows(el)}
        >
          ${icon('check', 12)}
          ${ready > 1 ? `Add ${ready} declarations` : 'Add declaration'}
        </button>
      </div>
    </div>`;
  }

  #renderDraftRow(
    el: HTMLElement,
    row: { property: string; value: string },
    index: number,
  ): TemplateResult {
    const matches = searchProperties(row.property, 14).map((meta) => ({
      value: meta.name,
      hint: PROPERTY_GROUP_LABELS[meta.group],
    }));
    const update = (next: Partial<{ property: string; value: string }>): void => {
      this.draftRows = this.draftRows.map((entry, at) =>
        at === index ? { ...entry, ...next } : entry,
      );
    };

    return html`<div class="poprow">
      <heo-search-field
        mode="suggest"
        label="CSS property"
        placeholder="property"
        .value=${row.property}
        .suggestions=${matches}
        @search-input=${(event: CustomEvent<{ value: string }>) =>
        update({ property: event.detail.value })}
      ></heo-search-field>
      <heo-value-field
        .value=${row.value}
        .kind=${row.property ? valueKindFor(row.property) : 'text'}
        .property=${row.property}
        .suggestions=${row.property ? buildSuggestions(this.editor, row.property, el) : []}
        placeholder="value"
        @value-input=${(event: CustomEvent<{ value: string }>) =>
        update({ value: event.detail.value })}
        @value-change=${(event: CustomEvent<{ value: string }>) =>
        update({ value: event.detail.value })}
      ></heo-value-field>
      <button
        class="btn icon ghost sm"
        type="button"
        ?disabled=${this.draftRows.length < 2}
        title="Remove this row"
        aria-label="Remove this row"
        @click=${() => {
        this.draftRows = this.draftRows.filter((_entry, at) => at !== index);
      }}
      >
        ${icon('close', 11)}
      </button>
    </div>`;
  }

  /**
   * Write every complete row, as one change.
   *
   * Incomplete rows are ignored rather than refused: a half-typed fourth row is somebody having
   * changed their mind, not an error to report. A value the browser rejects still is one, and it is
   * named individually so the message says which row to fix.
   */
  #commitRows(el: HTMLElement): void {
    /*
     * Vetted through the shared check, so this agrees with a class and with a CSS rule.
     *
     * The three surfaces used to disagree. Here the value was checked and anything this browser
     * rejected was refused outright; in a class nothing was checked at all but adding a property
     * twice was caught. So `flx: 1` was impossible here and trivial there, and `font-stretch`
     * added twice was caught there and silently duplicated here.
     */
    const inline = inlineDeclarations(el);
    const declarations: Record<string, string> = {};
    const advice: string[] = [];

    for (const row of this.draftRows) {
      if (!row.property.trim()) continue;
      const verdict = checkDeclaration({
        property: row.property,
        value: row.value,
        // Both what the element already declares and what earlier rows in this same batch claimed,
        // so a name typed into two rows is caught before it silently overwrites itself.
        existing: { ...inline, ...declarations },
        label: labelFor(el),
      });
      if (verdict.refusal) {
        this.editor.notify(verdict.refusal, 'error');
        return;
      }
      if (!verdict.property) continue;
      // A value is no longer required: the popup seeds one, and a property with an empty value is
      // a row waiting to be filled rather than an error.
      const value = row.value.trim() || initialValueFor(verdict.property);
      declarations[verdict.property] = value;
      if (verdict.advice) advice.push(verdict.advice);
    }

    const names = Object.keys(declarations);
    if (!names.length) return;
    this.editor.setStyles(
      declarations,
      names.length === 1 ? 'Add a declaration' : `Add ${names.length} declarations`,
      el,
    );
    this.#closeAdder();
    /*
     * The filter goes with it, so the panel shows what just happened.
     *
     * Keeping the query narrowed the panel to whichever sections still matched it, which for a
     * property in no section at all is a single row under "Set on this element" — and for a
     * property picked from the completions rather than typed, nothing at all. The search was the
     * way in to adding something; once it is added, leaving a filter over the result answers a
     * question nobody is still asking.
     */
    this.#clearFilter();

    const added =
      names.length === 1
        ? `Added ${names[0]} to ${labelFor(el)}.`
        : `Added ${names.length} declarations to ${labelFor(el)}.`;
    // One notice, and the advice decides its tone: everything landed either way, so a warning here
    // means "this worked, and here is something you may not have known".
    this.editor.notify(
      advice.length ? `${added} ${advice.join(' ')}` : added,
      advice.length ? 'warn' : 'success',
    );
  }

  /**
   * Empty the filter, through the field's own API.
   *
   * `reset` and not an assignment: the control deliberately ignores an external write to `value`
   * while it has focus, so that a re-render of this panel cannot overwrite what is being typed.
   */
  #clearFilter(): void {
    this.filter = '';
    this.renderRoot
      .querySelector<HTMLElement & { reset?: (next?: string) => void }>('.top heo-search-field')
      ?.reset?.('');
  }

  #remember(id: string, open: boolean): void {
    userToggled.set(id, open);
    this.sectionsVersion += 1;
  }
}

/** An in-flight live preview, as the panel needs to see it. */
type StylePreview = { property: string; before: string };

/**
 * The element's inline declarations, as authored rather than as painted.
 *
 * A preview writes the value being typed straight onto the style attribute, so
 * reading the attribute back mid-edit describes the exploration instead of what the
 * user has: a half-deleted value, or — once the field is empty — no declaration at
 * all, which is what used to make the row vanish out from under the caret. The
 * property the preview owns is put back to the value it had when the edit started,
 * or dropped if the edit started from nothing.
 */
function authoredInline(el: HTMLElement, preview: StylePreview | null): Record<string, string> {
  const inline = inlineDeclarations(el);
  if (!preview) return inline;
  if (preview.before) {
    // `before` is the authored text, so any `!important` is already in it.
    inline[preview.property] = preview.before;
  } else {
    delete inline[preview.property];
  }
  return inline;
}

/**
 * What this element declares, as opposed to what it computes to.
 *
 * Inline styles first, then whichever matched rule wins. Longhands are expanded
 * from box shorthands so the box editor can show a value that was written as
 * `padding: 8px 12px`.
 */
/** Where a row's value came from, so the row can say so. */
export interface DeclarationOrigin {
  kind: 'inline' | 'rule';
  /** Selector of the winning rule; `style attribute` when inline. */
  selector: string;
}

function declaredMap(
  cascade: Map<string, { property: string; value: string; from: AppliedRule }>,
  inline: Record<string, string>,
): { values: Map<string, string>; origins: Map<string, DeclarationOrigin> } {
  const out = new Map<string, string>();
  const origins = new Map<string, DeclarationOrigin>();

  // Every declaration that wins the cascade, from wherever it won. `cascade` is
  // already ordered by specificity with the style attribute last, so inline values
  // overwrite rule values here for the same reason the browser prefers them.
  for (const [property, entry] of cascade) {
    out.set(property, entry.value);
    origins.set(property, {
      kind: entry.from.origin === 'inline' ? 'inline' : 'rule',
      selector: entry.from.selector,
    });
  }
  // Parsed from cssText so a shorthand holding a var() — which does not
  // enumerate as its longhands — is still shown as set on this element.
  for (const [property, value] of Object.entries(inline)) {
    out.set(property, value);
    origins.set(property, { kind: 'inline', selector: 'style attribute' });
  }

  for (const group of ['margin', 'padding', 'border-radius'] as const) {
    const shorthand = out.get(group);
    if (!shorthand) continue;
    const parts = splitTopLevel(shorthand);
    const sides = expand(parts);
    const names =
      group === 'border-radius'
        ? ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
        : [`${group}-top`, `${group}-right`, `${group}-bottom`, `${group}-left`];
    const from = origins.get(group);
    names.forEach((name, index) => {
      if (out.has(name)) return;
      out.set(name, sides[index]);
      if (from) origins.set(name, from);
    });
  }
  return { values: out, origins };
}

/**
 * True when a declaration arrived from one of the element's own classes.
 *
 * Only a bare single-class selector counts, because that is exactly the shape the
 * Classes section can show and edit. A compound or descendant selector like
 * `.card .title` is not a class you can take off an element, so its declarations
 * still belong in the list of what is set here.
 */
function fromElementClass(selector: string, el: HTMLElement): boolean {
  return selector.split(',').some((part) => {
    const match = /^\s*\.([A-Za-z_][\w-]*)\s*$/.exec(part);
    return match ? el.classList.contains(match[1]) : false;
  });
}

/** A row's tooltip: the value, and where it is coming from. */
function describeOrigin(
  property: string,
  value: string,
  computedValue: string,
  origin: DeclarationOrigin | undefined,
): string {
  if (!origin) {
    return `${property} is ${computedValue || 'unset'} — inherited, or the browser's default`;
  }
  if (origin.kind === 'inline') return `${property}: ${value} — set on this element`;
  return (
    `${property}: ${value} — from the ${origin.selector} rule. ` +
    'Changing it here writes an inline override on this element only; edit the rule ' +
    'itself under Matched CSS rules to change every element using it.'
  );
}

function expand(parts: string[]): [string, string, string, string] {
  if (parts.length === 0) return ['', '', '', ''];
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}

function shorten(value: string, max = 22): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-styles-panel': HeoStylesPanel;
  }
}
