import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  appliedRules,
  cascadedDeclarations,
  inlineDeclarations,
  PROPERTY_GROUP_LABELS,
  searchProperties,
  splitTopLevel,
  type AppliedRule,
} from '../../core/css.js';
import { labelFor } from '../../core/dom.js';
import { normalizeClassName } from '../../core/classes.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { buildSuggestions, classSuggestions, valueKindFor } from '../suggestions.js';
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
  {
    id: 'child',
    heading: 'In its parent',
    glyph: 'moveOut',
    properties: ['flex', 'align-self', 'order', 'grid-column', 'grid-row'],
  },
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

/** Sections open by default, then remembered for the session. */
const openSections = new Set<string>(['modified', 'classes', 'spacing', 'layout', 'typography']);

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
      .chip button {
        display: grid;
        place-items: center;
        width: 13px;
        height: 13px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
        padding: 0;
      }
      .chip button:hover {
        background: var(--heo-line-strong);
        color: var(--heo-text);
      }
      .chip.known {
        border-color: var(--heo-accent-line);
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
  @state() private newProperty = '';
  @state() private newValue = '';
  @state() private propertyPickerOpen = false;
  @state() private sectionsVersion = 0;

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
    const declared = declaredMap(el, cascade);

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

      ${this.#renderModified(el, computed)}
      ${this.#renderClasses(el)} ${this.#renderSpacing(el, computed, declared)}
      ${SECTIONS.filter((section) => !section.when || section.when(computed)).map((section) =>
      this.#renderSection(section, el, computed, declared),
    )}
      ${this.#renderAdder(el)} ${this.#renderCascade(rules, cascade)}
    `;
  }

  /**
   * Everything set directly on this element, first in the panel.
   *
   * This is the answer to "what does this element itself do", which the grouped
   * sections below cannot give: they are organised by concern, so a declaration
   * like `margin-top` is buried inside Spacing and an unusual property might not
   * appear in any group at all. Values are read from the `style` attribute as
   * authored, so a shorthand stays a shorthand.
   *
   * Rows are intentionally duplicated with the sections below — the same
   * declaration being editable in two places is less confusing than not being
   * able to find it.
   */
  #renderModified(el: HTMLElement, computed: CSSStyleDeclaration): TemplateResult {
    const declarations = inlineDeclarations(el);
    const properties = Object.keys(declarations);

    return html`<heo-section
      heading="Modified"
      glyph="sliders"
      badge=${properties.length ? String(properties.length) : ''}
      ?open=${openSections.has('modified')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('modified', event.detail.open)}
    >
      ${properties.length === 0
        ? html`<p class="hint" style="margin:0">
            Nothing is set on this element yet. Values shown below come from the stylesheet or are
            inherited; changing one here writes it onto the element.
          </p>`
        : html`<p class="hint" style="margin:0 0 9px">
              Declared on this element via its <code class="mono">style</code> attribute, which wins
              over every stylesheet rule.
            </p>
            <div class="rows">
              ${repeat(
          properties,
          (property) => property,
          (property) => this.#renderRow(property, el, computed, new Map(Object.entries(declarations))),
        )}
            </div>
            <button
              class="btn sm"
              type="button"
              style="margin-top:9px"
              title="Move these declarations into a reusable class"
              @click=${() => this.editor.beginClassExtraction()}
            >
              ${icon('blocks', 12)} Extract ${properties.length} into a class
            </button>`}
    </heo-section>`;
  }

  /* ---------------------------------------------------------------------- */

  #renderClasses(el: HTMLElement): TemplateResult {
    const classes = Array.from(el.classList).filter((name) => !name.startsWith('heo-'));
    return html`<heo-section
      heading="Classes"
      glyph="blocks"
      badge=${classes.length ? String(classes.length) : ''}
      ?open=${openSections.has('classes')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('classes', event.detail.open)}
    >
      ${classes.length
        ? html`<div class="chips">
            ${repeat(
          classes,
          (name) => name,
          (name) => html`<span
                class=${`chip${this.editor.classes.get(name) ? ' known' : ''}`}
                title=${this.editor.classes.get(name)
              ? `${Object.keys(this.editor.classes.get(name)!.declarations).length} declarations`
              : 'Not defined in a stylesheet the editor can read'}
                >${name}
                <button
                  type="button"
                  aria-label=${`Remove class ${name}`}
                  @click=${() => this.editor.toggleClass(name, el)}
                >
                  ${icon('close', 9)}
                </button>
              </span>`,
        )}
          </div>`
        : html`<p class="hint" style="margin:0 0 8px">
            No classes yet. Adding one keeps styling reusable instead of inline.
          </p>`}

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
      ?open=${openSections.has('spacing')}
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
          this.#renderRow(property, el, computed, declared, `all sides`),
        )}
      </div>
    </heo-section>`;
  }

  #renderSection(
    section: SectionSpec,
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
  ): TemplateResult {
    const setCount = section.properties.filter((property) => declared.has(property)).length;
    return html`<heo-section
      heading=${section.heading}
      glyph=${section.glyph}
      badge=${setCount ? String(setCount) : ''}
      ?open=${openSections.has(section.id)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember(section.id, event.detail.open)}
    >
      <div class="rows">
        ${section.properties.map((property) => this.#renderRow(property, el, computed, declared))}
      </div>
    </heo-section>`;
  }

  #renderRow(
    property: string,
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    declared: Map<string, string>,
    placeholderOverride?: string,
  ): TemplateResult {
    const value = declared.get(property) ?? '';
    const isSet = declared.has(property);
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
          .suggestions=${buildSuggestions(this.editor, property, el)}
          placeholder=${placeholderOverride ?? shorten(computedValue)}
          clearable
          @value-change=${(event: CustomEvent<{ value: string }>) =>
          this.editor.setStyle(property, event.detail.value, el)}
        ></heo-value-field>`;

    const resettable = this.editor.canResetStyle(el, property);
    const baseline = this.editor.styleBaseline(el, property);

    return html`<div class=${`row${isSet ? ' set' : ''}`}>
      <span
        class="name"
        title=${isSet
        ? `${property}: ${value} (set on this element)`
        : `${property} is ${computedValue || 'unset'} — inherited from the cascade`}
      >
        <span class="dot"></span>${property}
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
      ?open=${openSections.has('adder')}
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

  /**
   * The cascade, most specific last.
   *
   * Declarations that lose to a later rule are dimmed rather than hidden: knowing
   * that a value is being overridden is usually the answer to "why did nothing
   * happen when I changed it".
   */
  #renderCascade(
    rules: AppliedRule[],
    cascade: Map<string, { from: AppliedRule }>,
  ): TemplateResult {
    // Include the style attribute so the list shows the real picture: it sits at
    // the top as the highest-priority source, and its declarations are editable
    // like any rule's, just written onto the element instead of into a sheet.
    const stylesheetRules = rules;
    return html`<heo-section
      heading="Matched CSS rules"
      glyph="code"
      badge=${String(stylesheetRules.length)}
      ?open=${openSections.has('cascade')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('cascade', event.detail.open)}
    >
      ${stylesheetRules.length === 0
        ? html`<p class="hint" style="margin:0">
            No rule matches this element, so everything comes from inheritance.
          </p>`
        : html`<p class="hint" style="margin:0 0 8px">
              Most specific first. Editing a stylesheet rule changes it for every element that uses
              it; editing the style attribute only affects this one.
            </p>
            ${repeat(
          [...stylesheetRules].reverse(),
          (rule, index) => `${rule.selector}:${index}`,
          (rule) => this.#renderRule(rule, cascade),
        )}`}
    </heo-section>`;
  }

  #renderRule(rule: AppliedRule, cascade: Map<string, { from: AppliedRule }>): TemplateResult {
    const isInline = rule.origin === 'inline';
    return html`<div class=${`rule${isInline ? ' inline' : ''}`}>
      <header>
        ${isInline ? icon('cursor', 11) : nothing}
        <span class="sel" title=${rule.selector}>${rule.selector}</span>
        <span class="src" title=${isInline ? 'On the element itself' : 'Stylesheet'}>
          ${isInline ? 'this element' : rule.source}
        </span>
      </header>
      <div class="decls">
        ${rule.declarations.map((declaration) => {
      const winner = cascade.get(declaration.property);
      const overridden = winner ? winner.from !== rule : false;
      return html`<div class=${`decl${overridden ? ' overridden' : ''}`}>
            <span
              class="p"
              title=${overridden
          ? `Overridden by ${winner!.from.selector}`
          : `${declaration.property} wins the cascade here`}
              >${declaration.property}</span
            >
            <heo-value-field
              .value=${declaration.value}
              .kind=${valueKindFor(declaration.property)}
              .property=${declaration.property}
              .suggestions=${buildSuggestions(this.editor, declaration.property, this.editor.selected)}
              clearable
              @value-change=${(event: CustomEvent<{ value: string }>) => {
          if (isInline) this.editor.setStyle(declaration.property, event.detail.value);
          else if (rule.rule) {
            this.editor.setRuleDeclaration(rule.rule, declaration.property, event.detail.value);
          }
        }}
            ></heo-value-field>
          </div>`;
    })}
      </div>
      ${rule.condition ? html`<div class="cond">${rule.condition}</div>` : nothing}
    </div>`;
  }

  #remember(id: string, open: boolean): void {
    if (open) openSections.add(id);
    else openSections.delete(id);
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
function declaredMap(
  el: HTMLElement,
  cascade: Map<string, { property: string; value: string; from: AppliedRule }>,
): Map<string, string> {
  const out = new Map<string, string>();

  for (const [property, entry] of cascade) {
    if (entry.from.origin === 'inline') out.set(property, entry.value);
  }
  // Parsed from cssText so a shorthand holding a var() — which does not
  // enumerate as its longhands — is still shown as set on this element.
  for (const [property, value] of Object.entries(inlineDeclarations(el))) {
    out.set(property, value);
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
    names.forEach((name, index) => {
      if (!out.has(name)) out.set(name, sides[index]);
    });
  }
  return out;
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
