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
import { labelFor, selectableParent } from '../../core/dom.js';
import { normalizeClassName } from '../../core/classes.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { buildSuggestions, classSuggestions, valueKindFor } from '../suggestions.js';
import { ClassEditor, focusDeclaration, type DeclarationTarget } from './class-editor.js';
import type { HeoValueField } from '../controls/value-field.js';
import '../controls/value-field.js';
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
    when: (computed) => computed.position !== 'static',
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
      .top .spacer {
        flex: 1 1 auto;
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
  @state() private classProperty = '';
  @state() private newProperty = '';
  /** The element whose size cap has already auto-opened the parent section. */
  #capsShownFor: HTMLElement | null = null;
  @state() private newValue = '';
  @state() private propertyPickerOpen = false;
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
    const rules = appliedRules(el);
    const cascade = cascadedDeclarations(rules);
    const { values: declared, origins } = declaredMap(el, cascade);
    // Subtract any live preview. It is painted onto the style attribute, so the cascade
    // read above cannot tell it apart from a value the user actually set — and feeding
    // it back into the row it came from would tell that row its half-typed text is
    // already committed. Undo then has nothing to take back, and the commit that
    // follows looks like a no-op.
    const preview = this.editor.previewTarget;
    if (preview && preview.el === el) {
      if (preview.before) declared.set(preview.property, preview.before);
      else declared.delete(preview.property);
    }

    return html`
      <div class="top">
        <span class="chip">${icon('cursor', 11)} ${labelFor(el)}</span>
        <span class="spacer"></span>
        <button
          class="btn sm"
          type="button"
          title="Turn this element's inline styles into a reusable class"
          @click=${() => this.editor.beginClassExtraction(el)}
        >
          ${icon('droplet', 12)} Extract class
        </button>
      </div>

      ${this.#renderModified(el, computed, declared, origins)}
      ${this.#renderClasses(el)} ${this.#renderCssRules(el, rules, cascade)}
      ${this.#renderSpacing(el, computed, declared, origins)}
      ${SECTIONS.filter((section) => !section.when || section.when(computed)).map((section) =>
      this.#renderSection(section, el, computed, declared, origins),
    )}
      ${this.#renderParent(el, computed, declared, origins)}
      ${this.#renderAdder(el)}
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
  ): TemplateResult {
    const parent = selectableParent(el);
    const parentComputed = parent ? getComputedStyle(parent) : null;
    const own = ['flex', 'align-self', 'order'];
    if (parentComputed?.display.includes('grid')) own.push('grid-column', 'grid-row');

    const caps = [
      ...sizeConstraints(el, 'width'),
      ...sizeConstraints(el, 'height'),
    ].filter((cap) => cap.binding);
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
      ?open=${sectionOpen('child', caps.length > 0 || setCount > 0)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('child', event.detail.open)}
    >
      ${caps.length ? caps.map((cap) => this.#renderConstraint(cap)) : nothing}

      <div class="rows">
        ${own.map((property) =>
          this.#renderRow(property, el, computed, declared, undefined, origins),
        )}
      </div>

      ${parent && parentComputed
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
  ): TemplateResult {
    const inline = inlineDeclarations(el);
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
      .sort((a, b) => {
        const rank = (property: string): number => (inline[property] !== undefined ? 0 : 1);
        return rank(a) - rank(b) || a.localeCompare(b);
      });
    const inlineCount = Object.keys(inline).length;

    return html`<heo-section
      heading="Set on this element"
      glyph="sliders"
      badge=${properties.length ? String(properties.length) : ''}
      ?open=${sectionOpen('modified', properties.length > 0)}
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
            ${inlineCount
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
    rules: AppliedRule[],
    cascade: Map<string, { from: AppliedRule }>,
  ): TemplateResult {
    // What belongs here: stylesheet rules that are not the element's own classes.
    // Inline is "Set on this element"; a bare `.card` is "Classes". Both of those
    // edit the same declarations somewhere better suited to them.
    const direct = rules.filter(
      (rule) => rule.origin === 'stylesheet' && !fromElementClass(rule.selector, el),
    );
    const all = [...direct, ...stateRules(el)].sort((a, b) => b.specificity - a.specificity);

    return html`<heo-section
      heading="CSS rules"
      glyph="code"
      badge=${all.length ? String(all.length) : ''}
      ?open=${sectionOpen('cssrules', all.length > 0)}
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

  #renderClasses(el: HTMLElement): TemplateResult {
    const classes = Array.from(el.classList).filter((name) => !name.startsWith('heo-'));
    return html`<heo-section
      heading="Classes"
      glyph="blocks"
      badge=${classes.length ? String(classes.length) : ''}
      ?open=${sectionOpen('classes', classes.length > 0)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('classes', event.detail.open)}
    >
      ${classes.length
        ? html`<div class="chips">
            ${repeat(
          classes,
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

      ${this.openClass && classes.includes(this.openClass)
        ? this.#renderOpenClass(this.openClass, el)
        : nothing}

      <heo-value-field
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
      </p>
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
      </p>
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

  #renderSpacing(
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    origins: Map<string, DeclarationOrigin>,
  ): TemplateResult {
    const longhands = [
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ];
    const declaredBox: Record<string, string> = {};
    for (const property of longhands) declaredBox[property] = declared.get(property) ?? '';
    const computedBox: Record<string, string> = { width: computed.width, height: computed.height };
    for (const property of longhands) computedBox[property] = computed.getPropertyValue(property);

    const touched = longhands.filter((property) => declaredBox[property]).length;

    return html`<heo-section
      heading="Spacing"
      glyph="wrap"
      badge=${touched ? String(touched) : ''}
      ?open=${sectionOpen('spacing', true)}
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

      <div class="rows" style="margin-top:10px">
        ${['margin', 'padding'].map((property) =>
          this.#renderRow(property, el, computed, declared, `all sides`, origins),
        )}
      </div>
    </heo-section>`;
  }

  #renderSection(
    section: SectionSpec,
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    origins: Map<string, DeclarationOrigin>,
  ): TemplateResult {
    const setCount = section.properties.filter((property) => declared.has(property)).length;
    return html`<heo-section
      heading=${section.heading}
      glyph=${section.glyph}
      badge=${setCount ? String(setCount) : ''}
      ?open=${sectionOpen(section.id, section.id === 'layout' || section.id === 'typography')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember(section.id, event.detail.open)}
    >
      <div class="rows">
        ${section.properties.map((property) =>
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

  #renderAdder(el: HTMLElement): TemplateResult {
    const matches = this.propertyPickerOpen ? searchProperties(this.newProperty, 14) : [];
    return html`<heo-section
      heading="Add a declaration"
      glyph="plus"
      ?open=${sectionOpen('adder', false)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('adder', event.detail.open)}
    >
      <div class="adder">
        <div class="pick">
          <input
            class="input mono"
            type="text"
            placeholder="property, e.g. scroll-margin-top"
            .value=${this.newProperty}
            spellcheck="false"
            autocomplete="off"
            aria-label="CSS property"
            @input=${(event: Event) => {
        this.newProperty = (event.target as HTMLInputElement).value;
        this.propertyPickerOpen = true;
      }}
            @focus=${() => {
        this.propertyPickerOpen = true;
      }}
            @blur=${() => setTimeout(() => {
        this.propertyPickerOpen = false;
      }, 140)}
          />
          ${matches.length
        ? html`<div class="options">
                ${matches.map(
          (meta) => html`<button
                    class="option"
                    type="button"
                    @pointerdown=${(event: Event) => event.preventDefault()}
                    @click=${() => {
              this.newProperty = meta.name;
              this.propertyPickerOpen = false;
            }}
                  >
                    <span>${meta.name}</span>
                    <span>${PROPERTY_GROUP_LABELS[meta.group]}</span>
                  </button>`,
        )}
              </div>`
        : nothing}
        </div>

        <heo-value-field
          .value=${this.newValue}
          .kind=${this.newProperty ? valueKindFor(this.newProperty) : 'text'}
          .property=${this.newProperty}
          .suggestions=${this.newProperty ? buildSuggestions(this.editor, this.newProperty, el) : []}
          placeholder="value"
          @value-change=${(event: CustomEvent<{ value: string }>) => {
        this.newValue = event.detail.value;
        this.#commitNew(el);
      }}
        ></heo-value-field>

        <button
          class="btn"
          type="button"
          ?disabled=${!this.newProperty.trim() || !this.newValue.trim()}
          @click=${() => this.#commitNew(el)}
        >
          ${icon('plus', 12)} Add declaration
        </button>
      </div>
    </heo-section>`;
  }

  #commitNew(el: HTMLElement): void {
    const property = this.newProperty.trim();
    const value = this.newValue.trim();
    if (!property || !value) return;
    if (!CSS.supports(property, value) && !value.includes('var(--')) {
      this.editor.notify(`The browser does not accept ${property}: ${value}.`, 'error');
      return;
    }
    this.editor.setStyle(property, value, el);
    this.newProperty = '';
    this.newValue = '';
  }
  #remember(id: string, open: boolean): void {
    userToggled.set(id, open);
    this.sectionsVersion += 1;
  }
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
  el: HTMLElement,
  cascade: Map<string, { property: string; value: string; from: AppliedRule }>,
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
  for (const [property, value] of Object.entries(inlineDeclarations(el))) {
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
