import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { isPseudoElement, needsGeneratedContent } from '../../core/breakpoints.js';
import {
  appliedRules,
  cascadedDeclarations,
  fromElementClass,
  stateRules,
  type AppliedRule,
  type ElementModel,
  type WriteTarget,
} from '../../core/cascade.js';
import {
  parentLayoutProperties,
  PROPERTY_GROUP_LABELS,
  searchProperties,
  sizeConstraints,
  type SizeConstraint,
} from '../../core/css.js';
import { splitImportant, toRecord } from '../../core/declaration-list.js';
import { ruleDeclarations } from '../../core/sheets.js';
import { normalizeProperty, propertyIsKnown } from '../../core/declarations.js';
import { labelFor, selectableParent } from '../../core/dom.js';
import { listen, unlisten } from '../../core/shield.js';
import { resolvesOffsets } from '../../core/transform.js';
import { normalizeClassName, simpleClassName } from '../../core/classes.js';
import type { DesignClass } from '../../core/types.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { buildSuggestions, classSuggestions, valueKindFor } from '../suggestions.js';
import { adderStyles } from './adder.js';
import { selectionNotice, selectionNoticeStyles } from './selection-notice.js';
import {
  ClassEditor,
  focusDeclaration,
  initialValueFor,
  type DeclarationTarget,
} from './class-editor.js';
import { renderCascadePopover, popoverStyles } from './styles/cascade-popover.js';
import { menuStyles, placeLayer } from './styles/menu.js';
import {
  renderAdder,
  stylesDestination,
  type AdderDestination,
} from './styles/property-adder.js';
import {
  isViewportDependent,
  propertyRowStyles,
  renderPropertyRow,
  saveContextFor,
  scopeKey,
  shownValue,
  type RowSpec,
} from './styles/property-row.js';
import { beginSave, cancelSave, renderSaveBox, saveBoxStyles } from './styles/save-box.js';
import type { RowScope, StylesHost, StylesUiState } from './styles/types.js';
import type { HeoValueField } from '../controls/value-field.js';
import '../controls/value-field.js';
import '../controls/search-field.js';
import '../controls/box-editor.js';
import '../controls/segmented.js';
import '../controls/section.js';
import { classNameIssues, forkNameIssues } from '../../core/validation.js';
import { field, FormErrors } from '../form-errors.js';

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
    // Not the sparkle any more: that is Effective styles' glyph, and two sections sharing one
    // picture made the panel's two most different sections look related.
    glyph: 'eye',
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

/** The Effective styles element block: its rows' list and its adder share the id. */
const EFFECTIVE_LIST_ID = 'effective';

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

const EMPTY_UI: StylesUiState = {
  filter: '',
  popover: null,
  menu: null,
  adder: null,
  pending: null,
};

/**
 * The style editor.
 *
 * Effective styles comes first: what the element renders with, one row per property, each with a
 * dot that opens the cascade behind it. Under it, where those styles are written, then the
 * task-oriented sections a designer reaches for. Every property row in the panel is the same row
 * with the same edit path, so a value typed in Typography goes where one typed in Effective styles
 * goes, and asks where it should stay when the page shows it only at some widths.
 */
@customElement('heo-styles-panel')
export class HeoStylesPanel extends HeoElement {
  static override styles = [
    baseStyles,
    ClassEditor.styles,
    adderStyles,
    selectionNoticeStyles,
    propertyRowStyles,
    popoverStyles,
    saveBoxStyles,
    menuStyles,
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

      /* Effective styles: the element, then a group per state or pseudo-element. */
      .egroup {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid var(--heo-line);
      }
      .egroup-h {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 7px;
        color: var(--heo-text-dim);
      }
      .egroup-h .sel {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
        font-weight: 500;
      }
      .egroup-h .kind,
      .egroup-h .note {
        color: var(--heo-text-dim);
        font-size: 10px;
      }
      .egroup-h .note {
        margin-left: auto;
      }
      .block-add {
        margin-top: 4px;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
      }
      .spacing-save {
        margin-top: 4px;
      }
      /* The cap notice keeps its own two-column row: a name and the owner's value. */
      .capped .row {
        grid-template-columns: 96px minmax(0, 1fr);
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
      .property-adder {
        grid-template-columns: 96px minmax(0, 1fr) 18px;
      }
      .property-adder .pair {
        display: flex;
        gap: 4px;
        min-width: 0;
      }
      .property-adder .pair .input {
        flex: 1 1 auto;
        min-width: 0;
      }
      .property-adder .confirm {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 28px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-accent-soft);
        color: var(--heo-accent);
        cursor: pointer;
        padding: 0;
        transition:
          background var(--heo-fast),
          color var(--heo-fast);
      }
      .property-adder .confirm:hover:not(:disabled) {
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      .property-adder .confirm:disabled {
        border-color: var(--heo-line);
        background: transparent;
        color: var(--heo-text-disabled);
        cursor: not-allowed;
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

    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.selection, s.revision, s.registry, s.geometry, s.previewWidth] as const,
    shallowArrayEquals,
  );

  /** Everything the panel's pieces read and change, replaced whole so a render follows. */
  @state() private ui: StylesUiState = EMPTY_UI;

  @state() private classDraft = '';
  /** Which class chip is expanded into its definition, if any. */
  @state() private openClass: string | null = null;
  /** Which class has its "just this element" options showing, if any. */
  @state() private detachOpen: string | null = null;
  /** Name typed for the copy, empty while the suggested one will do. */
  @state() private forkDraft = '';
  @state() private classProperty = '';

  /* The panel's small forms, each with its own errors. See `form-errors.ts`. */
  protected classForm = new FormErrors(this, () => classNameIssues('class-add', this.classDraft));
  protected forkForm = new FormErrors(this, () => {
    const name = this.detachOpen;
    if (!name) return [];
    return forkNameIssues('class-fork', this.forkDraft, name, (candidate) => Boolean(this.editor.classes.get(candidate)));
  });
  /** The one open adder's errors; checks run on commit, through `form.fail`. */
  protected adderForm = new FormErrors(this, () => []);
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

  /** The model of the last render, and what it was built from. */
  #memo: { key: unknown[]; model: ElementModel } | null = null;
  /** What the last update saw, to tell a new selection or preview width from a re-render. */
  #seen: { element: HTMLElement | null; width: number | null } = { element: null, width: null };
  /** The popover that was open after the last render, to focus a new one once. */
  #shownPopover: string | null = null;

  /**
   * The selected element's model, built once per render and reused until something it reads
   * changes: the element, the document, the registries, the geometry, the preview width or one of
   * the engine's in-flight previews (whose paint the model subtracts).
   */
  #model(el: HTMLElement): ElementModel {
    const engine = this.editor;
    const s = engine.store.value;
    const inline = engine.previewTarget;
    const rule = engine.rulePreviewTarget;
    const cls = engine.classPreviewTarget;
    const design = engine.designRulePreviewTarget;
    const key: unknown[] = [
      el, s.revision, s.registry, s.geometry, s.previewWidth, engine.settings.value.viewportSizes,
      inline?.el, inline?.property, inline?.before,
      rule?.rule, rule?.property, rule?.before,
      cls?.name, cls && JSON.stringify(cls.declarations),
      design?.key, design && JSON.stringify(design.declarations),
    ];
    const memo = this.#memo;
    if (memo && memo.key.length === key.length && memo.key.every((one, at) => one === key[at])) {
      return memo.model;
    }
    const model = engine.elementModel(el);
    this.#memo = { key, model };
    return model;
  }

  override willUpdate(): void {
    const element = this.editor.selected;
    const width = this.editor.store.value.previewWidth;
    const seen = this.#seen;
    this.#seen = { element, width };
    // What was open belonged to the old selection or the old width's question. The engine has
    // already put the page back (select and setPreviewWidth end a save preview).
    if (element !== seen.element) {
      this.ui = { ...this.ui, popover: null, menu: null, adder: null, pending: null };
    } else if (width !== seen.width) {
      this.ui = { ...this.ui, popover: null, menu: null, pending: null };
    }
  }

  override updated(): void {
    this.#placeLayers();
    const popover = this.ui.popover?.rowId ?? null;
    if (popover && popover !== this.#shownPopover) {
      this.renderRoot.querySelector<HTMLElement>('.pop')?.focus({ preventScroll: true });
    }
    this.#shownPopover = popover;
  }

  /** Keep the open popover and menu under what they belong to; close one whose anchor went away. */
  #placeLayers(): void {
    const root = this.renderRoot;
    const popover = this.ui.popover;
    if (popover) {
      const anchor = root.querySelector(`.row[data-row="${CSS.escape(popover.rowId)}"]`);
      if (!anchor) this.ui = { ...this.ui, popover: null };
      else placeLayer(root.querySelector<HTMLElement>('.pop'), anchor, { minWidth: 300, gap: 4 });
    }
    const menu = this.ui.menu;
    if (menu) {
      const anchor = root.querySelector(`[data-menu-anchor="${CSS.escape(menu.id)}"]`);
      if (!anchor) this.ui = { ...this.ui, menu: null };
      else placeLayer(root.querySelector<HTMLElement>(`.menu[data-menu="${CSS.escape(menu.id)}"]`), anchor);
    }
  }

  #patch(next: Partial<StylesUiState>): void {
    this.ui = { ...this.ui, ...next };
  }

  /** What every piece is handed: the engine, this render's model and the panel's state. */
  #host(el: HTMLElement, model: ElementModel): StylesHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const panel = this;
    return {
      engine: this.editor,
      element: el,
      model,
      previewWidth: this.editor.store.value.previewWidth,
      get ui() {
        return panel.ui;
      },
      patch: (next) => this.#patch(next),
      filtering: Boolean(this.ui.filter.trim()),
      hit: (...texts) => this.#hit(...texts),
      focusAfterRender: (property, listId) => this.#focusAfterRender(property, listId),
      focusSelector: (selector) => this.#focusSelector(selector),
      adderForm: this.adderForm,
      form: this.adderForm,
      // The adder's draft is a view of the one open adder: nothing else holds one.
      get newProperty() {
        return panel.ui.adder?.draft ?? '';
      },
      onNewProperty: (value) => {
        const adder = this.ui.adder;
        if (adder) this.#patch({ adder: { ...adder, draft: value } });
      },
      onFocus: (property, scope) => this.#focusAfterRender(property, scope ?? ''),
      openSource: (_property, target) => this.#openSource(el, target),
    };
  }

  override render(): TemplateResult {
    const el = this.editor.selected;
    if (!el || !el.isConnected) {
      return html`<div class="empty">
        Select an element on the page to edit its styles.<br />
        Arrow keys move the selection once something is selected.
      </div>`;
    }

    const computed = getComputedStyle(el);
    const model = this.#model(el);
    const host = this.#host(el, model);
    const rules = appliedRules(el);
    const cascade = cascadedDeclarations(rules);
    const filtering = host.filtering;
    /*
     * Computed once, used three times.
     *
     * #matchingRules walks every stylesheet through stateRules, and this render runs on every
     * keystroke while filtering — so the count beside the field, the empty-state test and the
     * CSS rules section all read the same list rather than each rebuilding it.
     */
    const matching = this.#matchingRules(el, rules);
    const found = filtering ? this.#matchCount(el, model, computed, matching) : -1;
    const popover = this.ui.popover;
    const popoverOn = popover?.scope.kind === 'parent' && popover.scope.element !== el
      ? popover.scope.element
      : el;

    return html`
      ${selectionNotice(this.editor.selection.length, el)}
      <div class="top">
        <span class="chip">${icon('cursor', 11)} ${labelFor(el)}</span>
        <heo-search-field
          label="Search styles"
          placeholder="Search properties, values, selectors…"
          .value=${this.ui.filter}
          .count=${found}
          action=${this.#addLabel()}
          action-icon="plus"
          action-compact
          @search-input=${(event: CustomEvent<{ value: string }>) => this.#patch({ filter: event.detail.value })}
          @search-submit=${() => this.#openEffectiveAdder(this.ui.filter.trim())}
        ></heo-search-field>
      </div>

      ${this.#renderEffective(el, model, host)}
      ${this.#renderInlineCard(el, model, host)}
      ${this.#renderClasses(el)} ${this.#renderCssRules(el, matching, cascade)}
      ${this.#renderSpacing(el, model, computed, host)}
      ${SECTIONS.filter((section) => !section.when || section.when(computed)).map((section) =>
      this.#renderSection(section, el, model, host),
    )}
      ${this.#renderParent(el, model, host)}
      ${found === 0 ? this.#renderNoMatch() : nothing}
      ${popover
        ? renderCascadePopover(
          popover,
          host,
          popoverOn,
          popoverOn === el ? model : this.editor.elementModel(popoverOn),
        )
        : nothing}
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* Effective styles                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * What the element renders with, first in the panel.
   *
   * One row per property with an applying declaration, wherever it is declared, because "what is
   * this element actually using" is the question people open a style panel with. Each row's dot
   * opens the cascade behind its value; the rows edit like every other row in the panel. Then a
   * group per state or pseudo-element in effect now, whose rows write into that state's own rule,
   * since a hover colour cannot be an inline style.
   */
  #renderEffective(el: HTMLElement, model: ElementModel, host: StylesHost): TemplateResult | typeof nothing {
    const filtering = host.filtering;
    const own = model.appliedProperties().filter((property) => {
      const list = model.cascade(property);
      return this.#hit(
        property,
        list.applying[0]?.value,
        ...list.applying.map((one) => (one.source.kind === 'rule' ? one.source.entry.selector : 'inline style')),
      );
    });
    const groups = model.groups().map((group) => {
      const all = statePropertiesOf(model, group.state);
      return {
        ...group,
        properties: this.#hit(group.state)
          ? all
          : all.filter((property) =>
            this.#hit(property, shownValue(model.cascade(property, { width: null, state: group.state }).applying[0]))),
      };
    }).filter((group) => group.properties.length);
    if (filtering && !own.length && !groups.length) return nothing;
    const at = host.previewWidth;

    return html`<heo-section
      heading="Effective styles"
      glyph="sparkle"
      badge=${model.appliedProperties().length ? String(model.appliedProperties().length) : ''}
      ?open=${filtering ? true : sectionOpen('effective', true)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#remember('effective', event.detail.open)}
    >
      <p class="hint" style="margin:0 0 9px">
        What this element renders with${at !== null ? ` at ${at}px` : ''}, after the cascade. Pick a
        size to see what changes there. Click a dot to see what else declares it.
      </p>
      <div class="rows" data-declarations=${EFFECTIVE_LIST_ID}>
        ${own.map((property) =>
      renderPropertyRow({ property, scope: { kind: 'element' }, element: el, model, listId: EFFECTIVE_LIST_ID }, host))}
      </div>
      ${own.length ? nothing : html`<p class="hint" style="margin:0">
        ${filtering ? 'No property matches.' : 'Nothing declares anything for this element yet.'}
      </p>`}
      ${this.#renderBlockAdder(host, EFFECTIVE_LIST_ID, this.#elementDestinations(el, model), '')}
      ${groups.map((group) => {
        const scope: RowScope = { kind: 'state', state: group.state };
        const listId = `state-${group.state}`;
        const pseudo = group.kind === 'pseudo-element';
        return html`<div class="egroup" data-egroup=${group.state}>
          <div class="egroup-h">
            ${icon(pseudo ? 'pseudo' : 'cursor', 12)}
            <span class="sel">${group.state}</span>
            <span class="kind">${pseudo ? 'pseudo-element' : 'state'}</span>
            <span class="note">${pseudo ? 'its own box' : 'when it applies, over the above'}</span>
          </div>
          <div class="rows" data-declarations=${listId}>
            ${group.properties.map((property) =>
          renderPropertyRow({ property, scope, element: el, model, listId }, host))}
          </div>
          ${this.#renderBlockAdder(host, listId, this.#stateDestinations(el, model, group.state), group.state)}
        </div>`;
      })}
      ${filtering
        ? nothing
        : html`<div class="actions">
            <button
              class="btn sm"
              type="button"
              title="Paste CSS and choose whether it belongs inline, in a class, or in a rule"
              @click=${() => this.editor.beginCssPaste({ context: 'inline', element: el })}
            >
              ${icon('clipboard', 12)} Paste CSS…
            </button>
          </div>`}
    </heo-section>`;
  }

  /** "+ Add property" under a block, with the places it can write. Hidden while searching. */
  #renderBlockAdder(
    host: StylesHost,
    id: string,
    destinations: AdderDestination[],
    state: string,
  ): TemplateResult | typeof nothing {
    if (host.filtering) return nothing;
    const open = this.ui.adder?.id === id ? this.ui.adder : null;
    const el = host.element;
    return html`<div class="block-add">
      ${renderAdder(
      {
        id,
        mode: 'property',
        destinations,
        selected: open?.dest,
        disclosure: true,
        open: Boolean(open),
        menuOpen: this.ui.menu?.id === `dest-${id}`,
        onOpen: () => {
          this.adderForm.reset();
          this.#patch({ adder: { id, draft: '', dest: '' }, menu: null, popover: null });
        },
        onCancel: () => {
          this.adderForm.reset();
          this.#patch({ adder: null, menu: null });
        },
        onPick: (key) => {
          const adder = this.ui.adder;
          if (adder) this.#patch({ adder: { ...adder, dest: key } });
        },
        onMenu: (opened) => {
          this.#patch({ menu: opened ? { id: `dest-${id}` } : null });
          if (opened) this.#focusSelector(`.menu[data-menu="${CSS.escape(`dest-${id}`)}"] .mi[aria-checked="true"]`, true);
        },
        seed: (property) => seedFor(el, state, property),
        commit: (property, value, dest) => {
          if (!dest.dest) return;
          this.#patch({ adder: null, menu: null });
          const { hint } = this.editor.addDeclaration(dest.dest, property, value);
          if (hint) this.editor.notify(hint, 'info');
        },
      },
      host,
    )}
    </div>`;
  }

  /** Where the element block's adder writes: inline (the default), each class, a new class. */
  #elementDestinations(el: HTMLElement, model: ElementModel): AdderDestination[] {
    const destinations = [
      stylesDestination(
        'inline style',
        'this element only, every size',
        { kind: 'target', target: { kind: 'inline', element: el } },
        toRecord(model.inline),
        'this element',
      ),
    ];
    for (const name of Array.from(el.classList)) {
      if (name.startsWith('heo-')) continue;
      const base = model.entries.find((entry) =>
        simpleClassName(entry.family) === name &&
        entry.state === '' &&
        entry.media === null &&
        entry.target.kind !== 'readonly');
      const owned = this.editor.classes.get(name);
      const target: WriteTarget | null = base
        ? base.target
        : owned && owned.origin !== 'stylesheet'
          ? { kind: 'class', name }
          : null;
      const reach = model.reach(`.${CSS.escape(name)}`);
      destinations.push(
        stylesDestination(
          `.${name}`,
          `${reach} ${reach === 1 ? 'element' : 'elements'}, every size`,
          target ? { kind: 'target', target } : { kind: 'new-rule', selector: `.${CSS.escape(name)}`, media: null },
          base ? toRecord(base.declarations) : owned ? { ...owned.declarations } : {},
          `.${name}`,
        ),
      );
    }
    destinations.push(
      stylesDestination(
        'a new class',
        'this element only',
        { kind: 'auto-class', element: el, media: null, state: '' },
        {},
        'a new class',
      ),
    );
    return destinations;
  }

  /**
   * Where a state group's adder writes: the families that already have that state first, then the
   * rest, then a new class of the element's own in that state.
   */
  #stateDestinations(el: HTMLElement, model: ElementModel, state: string): AdderDestination[] {
    const { classes, others } = model.families();
    const keys = [...classes, ...others].map((family) => family.key);
    const existing = (key: string) =>
      model.entries.find((entry) =>
        entry.family === key && entry.state === state && entry.media === null && entry.target.kind !== 'readonly');
    const ordered = [...keys.filter((key) => existing(key)), ...keys.filter((key) => !existing(key))];
    return [
      ...ordered.map((key) => {
        const entry = existing(key);
        const reach = model.reach(key);
        return stylesDestination(
          `${key}${state}`,
          `${reach} ${reach === 1 ? 'element' : 'elements'}`,
          entry ? { kind: 'target', target: entry.target } : { kind: 'new-rule', selector: `${key}${state}`, media: null },
          entry ? toRecord(entry.declarations) : {},
          `${key}${state}`,
        );
      }),
      stylesDestination(
        `a new class${state}`,
        'this element only',
        { kind: 'auto-class', element: el, media: null, state },
        {},
        `a new class${state}`,
      ),
    ];
  }

  /**
   * Open the Effective styles adder, seeded with what was being looked for.
   *
   * Searching for a property and not finding it is the most common way somebody arrives at wanting
   * to add one, so the query carries over as the draft. The search is cleared on the way: adders
   * are hidden while it narrows the panel, and the question it asked has been answered.
   */
  #openEffectiveAdder(seed = ''): void {
    const property = normalizeProperty(seed);
    this.#clearFilter();
    userToggled.set('effective', true);
    this.adderForm.reset();
    this.#patch({ adder: { id: EFFECTIVE_LIST_ID, draft: property, dest: '' }, menu: null, popover: null });
    this.#focusSelector(`.property-adder[data-adder="${EFFECTIVE_LIST_ID}"] input`);
  }

  /* ---------------------------------------------------------------------- */
  /* Focus and the layers                                                   */
  /* ---------------------------------------------------------------------- */

  /** Focus a property's value field in one list once the next render has landed, and flash its row. */
  #focusAfterRender(property: string, listId: string): void {
    void this.updateComplete.then(() =>
      requestAnimationFrame(() => {
        const root = this.renderRoot;
        const selector = `heo-value-field[data-property="${CSS.escape(property)}"]`;
        const list = listId ? root.querySelector(`[data-declarations="${CSS.escape(listId)}"]`) : null;
        const found = (list?.querySelector(selector) ?? root.querySelector(selector)) as HeoValueField | null;
        if (!found) return;
        found.focusInput({ select: true });
        const row = found.closest('.prow') ?? found.closest('.decl');
        row?.classList.remove('flash');
        row?.classList.add('flash');
        setTimeout(() => row?.classList.remove('flash'), 1300);
      }),
    );
  }

  /**
   * Focus a control once the next render has landed. A value field takes the caret in its input.
   * `onlyFromKeyboard` leaves focus where it is unless it was on the control that asked.
   */
  #focusSelector(selector: string, onlyFromKeyboard = false): void {
    const from = onlyFromKeyboard ? (this.renderRoot as ShadowRoot).activeElement : null;
    if (onlyFromKeyboard && (!from || from.localName === 'input')) return;
    void this.updateComplete.then(() =>
      requestAnimationFrame(() => {
        const found = this.renderRoot.querySelector<HTMLElement>(selector);
        if (!found) return;
        if (found.localName === 'heo-value-field') (found as HeoValueField).focusInput();
        else found.focus({ preventScroll: true });
      }),
    );
  }

  /*
   * Dismissed by a press anywhere else, through `listen`.
   *
   * `listen` and not `addEventListener`, for the reason the other popovers document: the event
   * shield suppresses `pointerdown` for the page, so a plain listener never hears the press that
   * should close these. A save box is not closed this way: clicking elsewhere to read is allowed,
   * and only a new edit, a new selection or a new preview width cancels it. An adder with a draft
   * is left to its own blur, which adds what was typed.
   */
  #onOutsidePress = (event: Event): void => {
    const path = event.composedPath();
    const inside = (selector: string): boolean =>
      path.some((node) => node instanceof Element && node.matches?.(selector));
    const next: Partial<StylesUiState> = {};
    const popover = this.ui.popover;
    if (popover && !inside('.pop') && !inside(`.row[data-row="${CSS.escape(popover.rowId)}"] .dots`)) {
      next.popover = null;
    }
    const menu = this.ui.menu;
    if (menu && !inside(`.menu[data-menu="${CSS.escape(menu.id)}"]`) && !inside(`[data-menu-anchor="${CSS.escape(menu.id)}"]`)) {
      next.menu = null;
    }
    const adder = this.ui.adder;
    if (adder && !adder.draft.trim() && !inside(`[data-adder="${CSS.escape(adder.id)}"]`) && !inside('.menu')) {
      next.adder = null;
    }
    if (Object.keys(next).length) this.#patch(next);
  };

  /*
   * Kept under their anchors when the world moves.
   *
   * A fixed layer is placed against a rect that anything can invalidate: the panel scrolls under
   * it, the dock is dragged, the window is resized.
   */
  #onViewportChange = (): void => {
    if (this.ui.popover || this.ui.menu) this.#placeLayers();
  };

  /*
   * Escape closes the innermost open thing, and goes no further: the global keymap reads Escape as
   * "deselect". Menus, adders, value fields and the save box handle their own; this is for when
   * focus sits elsewhere in the panel.
   */
  #onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const ui = this.ui;
    if (ui.menu) {
      const id = ui.menu.id;
      this.#patch({ menu: null });
      this.#focusSelector(`[data-menu-anchor="${CSS.escape(id)}"]`);
    } else if (ui.adder) {
      this.adderForm.reset();
      this.#patch({ adder: null });
    } else if (ui.popover) {
      const rowId = ui.popover.rowId;
      this.#patch({ popover: null });
      this.#focusSelector(`.row[data-row="${CSS.escape(rowId)}"] .dots`);
    } else if (ui.pending) {
      const el = this.editor.selected;
      if (el) cancelSave(this.#host(el, this.#model(el)), true);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    listen(document, 'pointerdown', this.#onOutsidePress, true);
    listen(window, 'scroll', this.#onViewportChange, true);
    listen(window, 'resize', this.#onViewportChange);
    this.addEventListener('keydown', this.#onKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(document, 'pointerdown', this.#onOutsidePress, true);
    unlisten(window, 'scroll', this.#onViewportChange, true);
    unlisten(window, 'resize', this.#onViewportChange);
    this.removeEventListener('keydown', this.#onKeydown);
  }

  /**
   * Where a popover line's link goes: the class or rule that line writes, opened in place.
   *
   * Today's Classes and CSS rules sections hold them until Sources replaces both.
   */
  #openSource(el: HTMLElement, target: { selector: string; family: string; isClass: boolean }): void {
    this.#patch({ popover: null });
    const name = target.isClass ? simpleClassName(target.family) : null;
    let heading: string;
    if (name && el.classList.contains(name)) {
      this.openClass = name;
      userToggled.set('classes', true);
      heading = 'Classes';
    } else {
      userToggled.set('cssrules', true);
      const rule = this.#matchingRules(el, appliedRules(el)).find((one) => one.selector === target.selector);
      if (rule) this.openRules.set(this.#ruleKey(rule), this.openRules.get(this.#ruleKey(rule)) ?? '');
      this.sectionsVersion += 1;
      heading = 'CSS rules';
    }
    void this.updateComplete.then(() => {
      const section = Array.from(this.renderRoot.querySelectorAll<HTMLElement & { heading: string }>('heo-section'))
        .find((one) => one.heading === heading);
      section?.scrollIntoView({ block: 'nearest' });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* In its parent                                                          */
  /* ---------------------------------------------------------------------- */

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
  #renderParent(el: HTMLElement, model: ElementModel, host: StylesHost): TemplateResult | typeof nothing {
    const parent = selectableParent(el);
    const parentComputed = parent ? getComputedStyle(parent) : null;
    const all = ['flex', 'align-self', 'order'];
    if (parentComputed?.display.includes('grid')) all.push('grid-column', 'grid-row');
    const filtering = host.filtering;
    const own = all.filter((property) => this.#hit(property, shownValue(model.cascade(property).applying[0])));
    // The parent's own controls and the cap notices are about the parent, and the field says
    // "search styles" of this element — so while filtering this section is its matching rows or nothing.
    if (filtering && !own.length) return nothing;

    const caps = filtering
      ? []
      : [...sizeConstraints(el, 'width'), ...sizeConstraints(el, 'height')].filter(
        (cap) => cap.binding,
      );
    const setCount = own.filter((property) => model.cascade(property).applying.length).length;

    // Open itself the first time a cap turns up for this element: it is the answer
    // to a question the user is actively asking, and hiding it behind a disclosure
    // defeats the point. Recorded in the session set rather than forcing `open`, so
    // collapsing it still sticks.
    if (caps.length && this.#capsShownFor !== el) {
      this.#capsShownFor = el;
      userToggled.set('child', true);
    }
    const open = filtering ? true : sectionOpen('child', caps.length > 0 || setCount > 0);
    const scope: RowScope = { kind: 'parent', element: el };

    return html`<heo-section
      heading="In its parent"
      glyph="moveOut"
      badge=${caps.length ? String(caps.length) : setCount ? String(setCount) : ''}
      ?open=${open}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('child', event.detail.open)}
    >
      ${caps.length ? caps.map((cap) => this.#renderConstraint(cap)) : nothing}

      <div class="rows" data-declarations="parent-self">
        ${own.map((property) =>
          renderPropertyRow({ property, scope, element: el, model, listId: 'parent-self' }, host))}
      </div>

      ${filtering
        ? nothing
        : parent && parentComputed
          // The parent's model is built only when the section is open to show it.
          ? open ? this.#renderParentControls(parent, host) : nothing
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
          ${cap.property}
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
  #renderParentControls(parent: HTMLElement, host: StylesHost): TemplateResult {
    const properties = parentLayoutProperties(parent);
    const model = this.editor.elementModel(parent);
    const setCount = properties.filter((property) => model.cascade(property).applying.length).length;
    const scope: RowScope = { kind: 'parent', element: parent };

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
      <div class="rows" data-declarations="parent-up">
        ${properties.map((property) =>
      renderPropertyRow({ property, scope, element: parent, model, listId: 'parent-up' }, host))}
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Where the styles are written, until Sources replaces these sections    */
  /* ---------------------------------------------------------------------- */

  /**
   * The element's own style attribute, as a card of declarations.
   *
   * Effective styles shows what wins; this is what the element itself writes, in the order it
   * writes it, with the card editor every class and rule uses: so a shorthand and its side are one
   * family with the control that says which one wins, and each row has its `!important` toggle and
   * its trash.
   */
  #renderInlineCard(el: HTMLElement, model: ElementModel, host: StylesHost): TemplateResult | typeof nothing {
    const target: WriteTarget = { kind: 'inline', element: el };
    const declarations = toRecord(model.inline);
    const count = model.inline.length;
    const filtering = host.filtering;
    const shown = filtering
      ? Object.fromEntries(Object.entries(declarations).filter(([property, value]) => this.#hit(property, value)))
      : declarations;
    if (filtering && !Object.keys(shown).length) return nothing;
    const open = filtering ? true : sectionOpen('inline', count > 0);
    const adder = this.ui.adder?.id === 'inline' ? this.ui.adder : null;
    return html`<heo-section
      heading="Inline style"
      glyph="cursor"
      badge=${count ? String(count) : ''}
      ?open=${open}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#remember('inline', event.detail.open)}
    >
      <p class="hint" style="margin:0 0 7px">
        On this element only, at every size. Wins over every rule unless one is
        <code class="mono">!important</code>.
      </p>
      <div class="cls" data-card="inline">
        ${ClassEditor.renderDeclarations(
      {
        label: 'this element',
        id: 'inline',
        declarations: shown,
        empty: 'Nothing is written on the element itself.',
        preview: (property, value) => this.editor.previewDeclaration(target, property, value),
        commit: (property, value) => this.editor.setDeclaration(target, property, value),
        remove: (property) => this.editor.removeDeclaration(target, property),
        important: (property) => model.inline.some((one) => one.property === property && one.important),
        setImportance: (property, important) => this.editor.setImportance(target, property, important),
        seed: (property) => seedFor(el, '', property),
      },
      {
        engine: this.editor,
        element: el,
        form: this.adderForm,
        newProperty: adder?.draft ?? '',
        onNewProperty: (value) => this.#patch({ adder: { id: 'inline', draft: value, dest: '' } }),
        onFocus: (property, scope) => this.#focusAfterRender(property, scope ?? 'inline'),
        actions: 'none',
      },
    )}
      </div>
    </heo-section>`;
  }

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
    const filtering = Boolean(this.ui.filter.trim());
    if (filtering && !all.length) return nothing;

    return html`<heo-section
      heading="CSS rules"
      glyph="code"
      badge=${all.length ? String(all.length) : ''}
      ?open=${filtering ? true : sectionOpen('cssrules', all.length > 0)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('cssrules', event.detail.open)}
    >
      ${!filtering
        ? html`<button
            class="btn sm"
            type="button"
            style="margin-bottom:9px"
            title="Paste CSS and choose a shared selector or another destination"
            @click=${() =>
            this.editor.beginCssPaste({
              context: 'rule',
              element: el,
              selector: this.editor.suggestedRuleSelector(el),
            })}
          >
            ${icon('clipboard', 12)} Paste CSS…
          </button>`
        : nothing}
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
    const live = rule.rule;
    /*
     * A declaration list the editor owns, exactly as a class gets one.
     *
     * `rule.declarations` comes from `rule.style.cssText`, and a `CSSStyleDeclaration` rewrites what
     * it is asked to serialise: it stores longhands and rebuilds shorthands, so an authored `#222`
     * reads back `rgb(34, 34, 34)` and a rule declaring `padding: 8px` then `padding-left: 0` reads
     * back as one merged `padding: 8px 8px 8px 0px`, with neither name the user typed in it. Rows
     * drawn from that disagreed with the file a save writes — which is how adding a side to a rule
     * could look like it had edited the shorthand instead.
     *
     * A class never had this problem because `ClassRegistry` holds its declarations as data and only
     * ever generates CSS from them. `ruleDeclarations` gives a rule the same footing: the file's
     * text where it can be read, the live rule as a one-time seed where it cannot, and this
     * session's edits on top either way.
     */
    const source = live ? ruleDeclarations(live) : rule.declarations;
    const declarations: Record<string, string> = {};
    // Keyed by name because that is what a row is. Two declarations of the *same* property cannot
    // both be shown this way and the later one wins, which is also what the browser does; the
    // shorthand-and-its-side case, which is the one that was broken, is two different names and
    // survives in the order the file has them.
    for (const one of source) declarations[one.property] = one.value;

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
      // Read off the rule's declarations, which carry importance as a flag rather than in the text.
      important: (property) =>
        source.some((one) => one.property === property && one.important),
      setImportance: (property, important) => {
        if (live) this.editor.setImportance({ kind: 'live', rule: live }, property, important);
      },
      seed: initialValueFor,
      paste: () => {
        if (live) {
          this.editor.beginCssPaste({
            context: 'rule',
            element: el,
            selector: rule.selector,
            liveRule: live,
          });
        }
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
      form: this.adderForm,
      newProperty: this.openRules.get(key) ?? '',
      onNewProperty: (value: string) => {
        this.openRules.set(key, value);
        this.sectionsVersion += 1;
      },
      onFocus: (property: string, scope?: string) =>
        focusDeclaration(this.renderRoot, property, scope),
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
    const filtering = Boolean(this.ui.filter.trim());
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
          </button>
          <button
            class="btn sm"
            type="button"
            style="margin-bottom:9px"
            title="Paste CSS and choose a reusable class or another destination"
            @click=${() => this.editor.beginCssPaste({ context: 'class', element: el })}
          >
            ${icon('clipboard', 12)} Paste CSS…
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
              ${field(this.classForm, 'class-add')}
              leading-icon="search"
              clearable
              action="Add class"
              action-icon="plus"
              .suggestions=${classSuggestions(this.editor, this.classDraft)}
              placeholder="find or create a class"
              @value-input=${(event: CustomEvent<{ value: string }>) => {
            this.classDraft = event.detail.value;
          }}
              @value-change=${(event: CustomEvent<{ value: string }>) => {
            this.classDraft = event.detail.value;
          }}
              @value-submit=${(event: CustomEvent<{ value: string }>) => {
            this.classDraft = event.detail.value;
            if (this.classForm.submit()) this.#addClass(el, event.detail.value, event.target as HeoValueField);
          }}
            ></heo-value-field>
            ${this.classForm.error('class-add')}
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
      form: this.adderForm,
      newProperty: this.classProperty,
      onNewProperty: (value: string) => {
        this.classProperty = value;
      },
      onRemoved: () => {
        this.openClass = null;
      },
      onFocus: (property: string, scope?: string) =>
        focusDeclaration(this.renderRoot, property, scope),
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
            ${field(this.forkForm, 'class-fork')}
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
        ${this.forkForm.error('class-fork')}
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
    if (!this.forkForm.submit()) return;
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
  #addClass(el: HTMLElement, raw: string, input?: HeoValueField): void {
    // Checked by `classForm` before this is reached.
    const name = normalizeClassName(raw);
    if (!name) return;
    if (el.classList.contains(name)) {
      this.editor.notify(`${labelFor(el)} already has .${name}.`, 'info');
    } else {
      this.editor.toggleClass(name, el);
    }
    this.classDraft = '';
    this.classForm.reset();
    input?.reset('');
    input?.focusInput();
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
   *
   * The box commits a batch, which follows the same rule as one row: inline unless one of its
   * sides depends on the viewport, in which case one box asks where the whole batch should stay.
   */
  #renderSpacing(
    el: HTMLElement,
    model: ElementModel,
    computed: CSSStyleDeclaration,
    host: StylesHost,
  ): TemplateResult | typeof nothing {
    const longhands = SPACING_PROPERTIES.filter((property) => property.includes('-'));
    const declaredBox: Record<string, string> = {};
    for (const property of longhands) declaredBox[property] = shownValue(model.cascade(property).applying[0]);
    const computedBox: Record<string, string> = { width: computed.width, height: computed.height };
    for (const property of longhands) computedBox[property] = computed.getPropertyValue(property);

    const hits = SPACING_PROPERTIES.filter((property) =>
      this.#hit(property, shownValue(model.cascade(property).applying[0])),
    );
    if (!hits.length) return nothing;
    const shorthands = ['margin', 'padding'].filter((property) => hits.includes(property));
    const touched = longhands.filter((property) => declaredBox[property]).length;
    const scope: RowScope = { kind: 'section', id: 'spacing' };
    const boxId = `box:${scopeKey(scope, el)}`;
    const pending = this.ui.pending?.rowId === boxId ? this.ui.pending : null;

    return html`<heo-section
      heading="Spacing"
      glyph="wrap"
      badge=${touched ? String(touched) : ''}
      ?open=${host.filtering ? true : sectionOpen('spacing', true)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('spacing', event.detail.open)}
    >
      <heo-box-editor
        .declared=${declaredBox}
        .computed=${computedBox}
        .suggestions=${buildSuggestions(this.editor, 'margin', el)}
        @box-change=${(event: CustomEvent<{ declarations: Record<string, string> }>) =>
        this.#commitBox(event.detail.declarations, { property: '', scope, element: el, model, listId: 'spacing' }, boxId, host)}
      ></heo-box-editor>
      ${pending ? html`<div class="spacing-save">${renderSaveBox(pending, host)}</div>` : nothing}

      ${shorthands.length
        ? html`<div class="rows" style="margin-top:10px" data-declarations="spacing">
            ${shorthands.map((property) =>
          renderPropertyRow(
            { property, scope, element: el, model, placeholder: 'all sides', listId: 'spacing' },
            host,
          ))}
          </div>`
        : nothing}
    </heo-section>`;
  }

  /** A box-editor batch: inline as one entry, or one save box when any side depends on the viewport. */
  #commitBox(declarations: Record<string, string>, spec: RowSpec, boxId: string, host: StylesHost): void {
    const previewWidth = host.previewWidth;
    const dependent = Object.keys(declarations).filter((property) =>
      splitImportant(declarations[property]).value && isViewportDependent(spec.scope, spec.model, property, previewWidth));
    if (host.ui.pending) cancelSave(host);
    if (!dependent.length) {
      this.editor.overrideStyles(declarations, 'Adjust spacing', spec.element);
      return;
    }
    // Led by a side that depends on the viewport, so the save context takes its size.
    const ordered = Object.fromEntries([
      ...dependent.map((property) => [property, declarations[property]]),
      ...Object.entries(declarations).filter(([property]) => !dependent.includes(property)),
    ]);
    beginSave(host, boxId, 'spacing', saveContextFor(spec, ordered, previewWidth), true);
  }

  #renderSection(
    section: SectionSpec,
    el: HTMLElement,
    model: ElementModel,
    host: StylesHost,
  ): TemplateResult | typeof nothing {
    const properties = section.properties.filter((property) =>
      this.#hit(property, shownValue(model.cascade(property).applying[0])),
    );
    // Searched and nothing here matches: the section goes rather than standing open and empty.
    if (!properties.length) return nothing;
    const setCount = properties.filter((property) => model.cascade(property).applying.length).length;
    const scope: RowScope = { kind: 'section', id: section.id };
    return html`<heo-section
      heading=${section.heading}
      glyph=${section.glyph}
      badge=${setCount ? String(setCount) : ''}
      ?open=${host.filtering
        ? true
        : sectionOpen(section.id, section.id === 'layout' || section.id === 'typography')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember(section.id, event.detail.open)}
    >
      ${section.note ? html`<p class="hint" style="margin:0 0 9px">${section.note}</p>` : nothing}
      <div class="rows" data-declarations=${section.id}>
        ${properties.map((property) =>
          renderPropertyRow({ property, scope, element: el, model, listId: section.id }, host))}
      </div>
    </heo-section>`;
  }

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
    const needle = this.ui.filter.trim().toLowerCase();
    if (!needle) return true;
    return texts.some((text) => text?.toLowerCase().includes(needle));
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
    model: ElementModel,
    computed: CSSStyleDeclaration,
    matchingRules: readonly AppliedRule[],
  ): number {
    const properties = new Set<string>();
    const consider = (property: string): void => {
      if (this.#hit(property, shownValue(model.cascade(property).applying[0]))) properties.add(property);
    };
    for (const section of SECTIONS.filter((section) => !section.when || section.when(computed))) {
      for (const property of section.properties) consider(property);
    }
    for (const property of SPACING_PROPERTIES) consider(property);
    for (const property of model.appliedProperties()) consider(property);
    return properties.size + this.#matchingClasses(el).length + matchingRules.length;
  }

  /** What the add action would do, named after what has been typed. */
  #addLabel(): string {
    const seed = this.ui.filter.trim();
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
    const seed = this.ui.filter.trim();
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
                @click=${() => this.#openEffectiveAdder(meta.name)}
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
            @click=${() => this.#openEffectiveAdder(seed)}
          >
            ${icon('plus', 12)} ${this.#addLabel()}
          </button>`
        : nothing}
    </div>`;
  }

  /**
   * Empty the filter, through the field's own API.
   *
   * `reset` and not an assignment: the control deliberately ignores an external write to `value`
   * while it has focus, so that a re-render of this panel cannot overwrite what is being typed.
   */
  #clearFilter(): void {
    this.#patch({ filter: '' });
    this.renderRoot
      .querySelector<HTMLElement & { reset?: (next?: string) => void }>('.top heo-search-field')
      ?.reset?.('');
  }

  #remember(id: string, open: boolean): void {
    userToggled.set(id, open);
    this.sectionsVersion += 1;
  }
}

/** The properties a state's rules in effect now declare, sorted. */
function statePropertiesOf(model: ElementModel, state: string): string[] {
  const names = new Set<string>();
  for (const entry of model.entries) {
    if (entry.state !== state || !model.applies(entry)) continue;
    for (const one of entry.declarations) names.add(one.property.toLowerCase());
  }
  return [...names].sort();
}

/**
 * What a property added from the Styles panel starts as: the value the element resolves to now,
 * so adding it changes nothing until it is edited. A pseudo-element's rule starts from `initial`,
 * and `content` in a `::before`/`::after` from an empty string, which is what makes it render.
 */
function seedFor(el: HTMLElement, state: string, property: string): string {
  if (state && isPseudoElement(state)) {
    return property === 'content' && needsGeneratedContent(state) ? '""' : 'initial';
  }
  return getComputedStyle(el).getPropertyValue(property).trim() || initialValueFor(property);
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-styles-panel': HeoStylesPanel;
  }
}
