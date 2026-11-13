import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { isPseudoElement, isWidthQuery, mediaIcon, mediaKind, mediaNow, needsGeneratedContent } from '../../core/breakpoints.js';
import { rulesPass, type ElementModel, type WriteTarget } from '../../core/cascade.js';
import {
  escapeRegExp,
  parentLayoutProperties,
  PROPERTY_GROUP_LABELS,
  searchProperties,
  sizeConstraints,
  type SizeConstraint,
} from '../../core/css.js';
import { toRecord } from '../../core/declaration-list.js';
import { normalizeProperty, propertyIsKnown } from '../../core/declarations.js';
import { labelFor, selectableParent } from '../../core/dom.js';
import { listen, unlisten } from '../../core/shield.js';
import { resolvesOffsets } from '../../core/transform.js';
import { normalizeClassName, simpleClassName } from '../../core/classes.js';
import { entryLabel, reachText } from '../../core/save-plan.js';
import type { CssPasteOptions } from '../../core/editor.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { buildSuggestions, classSuggestions, valueKindFor } from '../suggestions.js';
import { adderStyles } from './adder.js';
import { selectionNotice, selectionNoticeStyles } from './selection-notice.js';
import { ClassEditor, focusDeclaration } from './class-editor.js';
import {
  blockId,
  cardView,
  INLINE_LIST_ID,
  removeCondition,
  renderBlockAdder,
  renderBlockHeader,
  renderFamilyCard,
  renderInlineCard,
  renderPseudoAdder,
  renderUnknownCard,
  sourcesStyles,
  type CardView,
  type Popped,
} from './styles/family-card.js';
import { renderCascadePopover, popoverStyles } from './styles/cascade-popover.js';
import { headerStyles, renderElementHeader } from './styles/header.js';
import { previewBarStyles, renderPreviewBar } from './styles/preview-bar.js';
import { CREATE_CLASS_TITLE, createClassLabel } from '../create-offer.js';
import {
  barConditions,
  conditionKey,
  conditionName,
  conditionOf,
  conditionParts,
  mediaKeyFor,
  previewToShow,
  remainingConditions,
  renderConditionBar,
  sizeStripStyles,
  slotMedia,
  slotName,
  stripMediaIssues,
  type BarChip,
} from './styles/size-strip.js';
import { menuStyles, placeLayer } from './styles/menu.js';
import { searchPopoverStyles } from './styles/search-popover.js';
import { stylesDestination, valueStepDraft, type AdderDestination } from './styles/property-adder.js';
import {
  previewSlot,
  propertyRowStyles,
  previewChosen,
  readRow,
  renderPropertyRows,
  writeChosen,
  sameTarget,
  rowIdOf,
  destinationChoice,
  shownValue,
  targetOf,
  type RowSpec,
} from './styles/property-row.js';
import type { RowScope, StylesHost, StylesUiState } from './styles/types.js';
import type { HeoValueField } from '../controls/value-field.js';
import '../controls/value-field.js';
import '../controls/search-field.js';
import '../controls/box-editor.js';
import '../controls/border-editor.js';
import type { BorderFieldSpec, EdgeView, LineView } from '../controls/border-editor.js';
import {
  composeEdge,
  composeLine,
  LINE_PARTS,
  parseLine,
  SIDES,
  type LineKind,
  type LinePart,
  type LineParts,
  type Side,
} from '../../core/border.js';
import '../controls/segmented.js';
import '../controls/section.js';
import { classNameIssues, forkNameIssues } from '../../core/validation.js';
import { mediaApplies } from '../../core/viewport.js';
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
    heading: 'Background',
    glyph: 'droplet',
    // Borders and outlines have their own section and editor: see BORDER_PROPERTIES.
    properties: ['background-color', 'background-image', 'background-size', 'background-position'],
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

/**
 * What the Border section covers, for the same reason as SPACING_PROPERTIES: it is drawn by hand.
 *
 * The parts are here for the search, not as rows. The editor reads and writes them as one `border`
 * or `outline` shorthand, so they are listed as rows only where a block declares one on its own,
 * which is when there is a real declaration for a row to show. Listed always, a part supplied by
 * the shorthand sat under it as though it were another declaration, and its trash removed the
 * whole shorthand.
 */
const BORDER_SHORTHANDS = ['border', 'outline'] as const;
const BORDER_PARTS = ['border-width', 'border-style', 'border-color', 'outline-width', 'outline-style', 'outline-color'];
/** A side's own family: `border-bottom` and its three longhands. Rows, likewise, only where declared. */
const BORDER_SIDE_PROPERTIES = SIDES.flatMap((side) => [`border-${side}`, ...LINE_PARTS.map((part) => `border-${side}-${part}`)]);
const BORDER_PROPERTIES = [...BORDER_SHORTHANDS, 'border-radius', ...BORDER_PARTS, ...BORDER_SIDE_PROPERTIES, 'outline-offset'];

/** The Effective styles element block: its rows' list and its adder share the id. */
const EFFECTIVE_LIST_ID = 'effective';
/** The header popovers of the element's own styles: the tag chip's, and the id chip's. */
const ELEMENT_POP = 'element';
const ID_POP = 'id';
/** The id popover's adder, while no rule is written for the id. */
const NEW_ID_RULE = 'new-id-rule';

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
  effPick: null,
  popover: null,
  cardPop: null,
  rowDest: null,
  effPseudo: null,
  menu: null,
  adder: null,
  finderOpen: false,
  rulesOpen: false,
  mediaDraft: null,
  otherSlots: new Map(),
  cardPicks: new Map(),
  pendingStates: [],
  blockHint: null,
  detachOpen: null,
  forkDraft: '',
};

/** The focused element, through shadow roots. */
function deepActive(): Element | null {
  let node: Element | null = document.activeElement;
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
  return node;
}

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
    menuStyles,
    headerStyles,
    previewBarStyles,
    sizeStripStyles,
    searchPopoverStyles,
    sourcesStyles,
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
      .top heo-search-field {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* Effective styles: the element, then a group per state or pseudo-element. */
      .egroup {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid var(--heo-line);
      }
      /* A group heads a whole section rather than a block inside a card: a little larger. */
      .egroup > .blabel {
        margin-bottom: 7px;
      }
      .egroup > .blabel .sel {
        font-size: 11px;
        font-weight: 500;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
      }
      /* The cap notice keeps its own two-column row: a name and the owner's value. */
      .capped .row {
        grid-template-columns: 96px minmax(0, 1fr);
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

  /* The panel's small forms, each with its own errors. See `form-errors.ts`. */
  protected classForm = new FormErrors(this, () => classNameIssues('class-add', this.classDraft));
  protected forkForm = new FormErrors(this, () => {
    const name = this.ui.detachOpen;
    if (!name) return [];
    return forkNameIssues('class-fork', this.ui.forkDraft, name, (candidate) => Boolean(this.editor.classes.get(candidate)));
  });
  /** The one open adder's errors; checks run on commit, through `form.fail`. */
  protected adderForm = new FormErrors(this, () => []);
  /** "Add a media query…" in a strip's menu. */
  protected mediaForm = new FormErrors(this, () => stripMediaIssues(this.ui.mediaDraft?.text ?? null));
  /** The element whose size cap has already auto-opened the parent section. */
  #capsShownFor: HTMLElement | null = null;
  /** The model of the last render, and what it was built from. */
  #memo: { key: unknown[]; model: ElementModel } | null = null;
  /** What the last update saw, to tell a new selection or preview width from a re-render. */
  #seen: { element: HTMLElement | null; width: number | null } = { element: null, width: null };

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
      this.ui = {
        ...this.ui,
        popover: null,
        cardPop: null,
        rowDest: null,
        effPseudo: null,
        menu: null,
        adder: null,
        finderOpen: false,
        mediaDraft: null,
        otherSlots: new Map(),
        pendingStates: [],
        blockHint: null,
        detachOpen: null,
        forkDraft: '',
      };
    }
    // A new width: every size picker follows it again (R13), and what was asked at the old one goes.
    if (width !== seen.width) {
      this.ui = {
        ...this.ui,
        effPick: null,
        cardPicks: new Map(),
        popover: null,
        menu: null,
        pendingStates: [],
        blockHint: null,
      };
    }
  }

  /*
   * Focus stays where it was when a layer opens: on the dot, the class name, the link. Each layer
   * is shown for that opener, so Tab goes from it into the layer and on out of it, and closing puts
   * focus back on it (`#refocusOpener`). Moving focus into the layer instead left it on the layer's
   * own box, which shows no ring and sits at the end of the panel's tab order.
   */
  override updated(): void {
    this.#placeLayers();
  }

  #finderWatched: HTMLElement | null = null;
  #finderObserver = new ResizeObserver(() => {
    if (this.ui.finderOpen) this.#placeLayers();
  });

  /** What opened each open layer, as a selector into the panel; innermost first. */
  #openers(): Array<{ layer: string; opener: string }> {
    const out: Array<{ layer: string; opener: string }> = [];
    const popover = this.ui.popover;
    if (popover) out.push({ layer: '.pop:not(.cardpop):not(.finderpop)', opener: `.row[data-row="${CSS.escape(popover.rowId)}"] .dots` });
    if (this.ui.cardPop) out.push({ layer: '.cardpop', opener: this.ui.cardPop.anchor });
    if (this.ui.finderOpen) out.push({ layer: '.finderpop', opener: '.ident .cchip.add' });
    return out;
  }

  /**
   * Close something and give focus back to what opened it, unless focus has gone somewhere else
   * that can hold it. `opener` is a selector into the panel.
   */
  #closeTo(next: Partial<StylesUiState>, opener: string): void {
    const active = deepActive();
    const keep = active && active !== document.body && this.renderRoot.contains(active) &&
      !this.#openers().some(({ layer }) => this.renderRoot.querySelector(layer)?.contains(active));
    this.#patch(next);
    if (!keep) this.#focusSelector(opener);
  }

  /** Keep the open popover and menu under what they belong to; close one whose anchor went away. */
  #placeLayers(): void {
    const root = this.renderRoot;
    const popover = this.ui.popover;
    if (popover) {
      const anchor = root.querySelector(`.row[data-row="${CSS.escape(popover.rowId)}"]`);
      if (!anchor) this.ui = { ...this.ui, popover: null };
      else {
        placeLayer(root.querySelector<HTMLElement>('.pop:not(.cardpop):not(.finderpop)'), anchor, {
          minWidth: 300,
          gap: 4,
          source: anchor.querySelector<HTMLElement>('.dots'),
        });
      }
    }
    if (this.ui.finderOpen) {
      const add = root.querySelector<HTMLElement>('.ident .cchip.add');
      const field = root.querySelector<HTMLElement>('.finderpop heo-value-field');
      if (!add) this.ui = { ...this.ui, finderOpen: false };
      // Across the header's line rather than from the "+": the "+" sits near the panel's right
      // edge, and a layer starting there ran out past it.
      else placeLayer(root.querySelector<HTMLElement>('.finderpop'), root.querySelector('.ident .line') ?? add, { gap: 6, source: add });
      /*
       * Placed again whenever the field resizes: its list is drawn inside it, a frame after this
       * placement and again with every keystroke, and a layer sized before that is capped at the
       * height of a lone input.
       */
      if (field && this.#finderWatched !== field) {
        this.#finderObserver.disconnect();
        this.#finderObserver.observe(field);
        this.#finderWatched = field;
      }
    } else if (this.#finderWatched) {
      this.#finderObserver.disconnect();
      this.#finderWatched = null;
    }
    const cardPop = this.ui.cardPop;
    if (cardPop) {
      const anchor = root.querySelector<HTMLElement>(cardPop.anchor);
      if (!anchor) this.ui = { ...this.ui, cardPop: null };
      else placeLayer(root.querySelector<HTMLElement>('.cardpop'), anchor, { ...this.#cardPopFrame(), source: anchor });
    }
    const menu = this.ui.menu;
    if (menu) {
      const anchor = root.querySelector(`[data-menu-anchor="${CSS.escape(menu.id)}"]`);
      // Placed against the whole bar or strip when it names one, so a menu opened from a small ⋮
      // gets the bar's width rather than spilling past the panel's edge.
      const place = root.querySelector(`[data-menu-place="${CSS.escape(menu.id)}"]`) ?? anchor;
      if (!anchor) this.ui = { ...this.ui, menu: null };
      else {
        placeLayer(root.querySelector<HTMLElement>(`.menu[data-menu="${CSS.escape(menu.id)}"]`), place, {
          minWidth: 260,
          source: anchor instanceof HTMLElement ? anchor : null,
        });
      }
    }
  }

  #patch(next: Partial<StylesUiState>): void {
    this.ui = { ...this.ui, ...next };
  }

  /** What every piece is handed: the engine, this render's model and the panel's state. */
  #host(el: HTMLElement, model: ElementModel): StylesHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const panel = this;
    const host: StylesHost = {
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
      focusSelector: (selector) => this.#focusSelector(selector),
      showCondition: (media, then) => this.#showCondition(media, then),
      mediaForm: this.mediaForm,
      toggleMenu: (id, open, refocus) => this.#toggleMenu(id, open, refocus),
      forkForm: this.forkForm,
      openCard: (key) => this.#openCard(key),
      // The adder's errors: one adder is open at a time, so one form.
      form: this.adderForm,
      // The adder's draft is a view of the one open adder: nothing else holds one.
      get newProperty() {
        return panel.ui.adder?.draft ?? '';
      },
      onNewProperty: (value) => {
        const adder = this.ui.adder;
        if (adder) this.#patch({ adder: { ...adder, draft: value } });
      },
      flashRow: (property, listId) => this.#flashRow(property, listId),
      destinationsFor: (spec) => this.#rowDestinations(spec.element, spec.model, spec.property, spec.scope),
    };
    return host;
  }

  /**
   * A render only reads, and asks the same element's rules many times over (every value field's
   * token suggestions do), so the rule walks are shared for the length of one update. The update
   * and not just render: a repeat() directive builds its rows while the template commits.
   */
  protected override update(changed: PropertyValues): void {
    rulesPass(() => super.update(changed));
  }
  override render(): TemplateResult {
    const el = this.editor.selected;
    // The preview bar comes first and works with or without a selection: the width is the page's.
    const bar = this.#renderPreviewBar(el && el.isConnected ? el : null);
    if (!el || !el.isConnected) {
      return html`${bar}
      <div class="empty">
        Select an element on the page to edit its styles.<br />
        Arrow keys move the selection once something is selected.
      </div>`;
    }

    const computed = getComputedStyle(el);
    const model = this.#model(el);
    const host = this.#host(el, model);
    this.#syncOwnCards(el, model, host);
    const found = host.filtering ? this.#matchCount(model, computed) : -1;
    const popover = this.ui.popover;
    const popoverOn = popover?.scope.kind === 'parent' && popover.scope.element !== el
      ? popover.scope.element
      : el;

    return html`
      ${bar}
      ${renderElementHeader({
      element: el,
      reach: (key) => model.reach(key),
      elementOpen: this.ui.cardPop?.key === ELEMENT_POP,
      onOpenElement: () => this.#popOwn(el, model, host, ELEMENT_POP),
      idOpen: this.ui.cardPop?.key === ID_POP,
      onOpenId: () => this.#popOwn(el, model, host, ID_POP),
      onRemoveId: () => {
        if (this.ui.cardPop?.key === ID_POP) this.#patch({ cardPop: null });
        this.editor.setAttribute('id', null, el);
        this.#focusSelector('.ident .el-chip');
      },
      finderOpen: this.ui.finderOpen,
      onToggleFinder: (open, refocus = true) => {
        this.classForm.reset();
        this.#patch({ finderOpen: open, ...(open ? { popover: null, cardPop: null, menu: null } : {}) });
        if (open) {
          this.#focusSelector('.finderpop heo-value-field');
          // The list comes with the field: the "+" asks which class, and the answers are the list.
          void this.updateComplete.then(() => requestAnimationFrame(() =>
            this.renderRoot.querySelector<HeoValueField>('.finderpop heo-value-field')?.openList()));
        } else if (refocus) this.#focusSelector('.ident .cchip.add');
      },
      openClass: (() => {
        const key = this.ui.cardPop?.key;
        return Array.from(el.classList).find((name) => `.${CSS.escape(name)}` === key) ?? null;
      })(),
      // A toggle: the open class's name closes its card.
      onOpenClass: (name) => {
        const key = `.${CSS.escape(name)}`;
        const anchor = `.ident .cchip[data-class="${CSS.escape(name)}"] .name`;
        if (this.ui.cardPop?.key === key) this.#closeTo({ cardPop: null }, anchor);
        else this.#popCard(key, anchor);
      },
      onRemoveClass: (name) => this.editor.toggleClass(name, el),
      // Every other family reaching the element, as the cascade lists them.
      rules: this.#sourceCards(el, model, host).others.map((view) => view.family.key),
      rulesOpen: this.ui.rulesOpen,
      onShowRules: () => {
        this.#patch({ rulesOpen: true });
        this.#focusSelector('.ident .cchip.rule .name');
      },
      openRule: this.ui.cardPop?.anchor.startsWith('.ident .cchip.rule') ? this.ui.cardPop.key : null,
      onOpenRule: (key) => {
        const anchor = `.ident .cchip.rule[data-rule="${CSS.escape(key)}"] .name`;
        if (this.ui.cardPop?.key === key) this.#closeTo({ cardPop: null }, anchor);
        else this.#popCard(key, anchor);
      },
      finder: this.#renderFinder(el),
    })}
      ${selectionNotice(this.editor.selection.length, el)}
      <div class="top">
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
      ${this.#renderSpacing(el, model, computed, host)}
      ${this.#renderBorder(el, model, computed, host)}
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
      ${this.ui.cardPop ? this.#renderCardPop(el, model, host) : nothing}
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
    // Pseudo-elements stay listed; states are picked on the bar, like media queries.
    const groups = model.groups().filter((group) => group.kind === 'pseudo-element').map((group) => {
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
    const { picked } = this.#effectiveConditions(model, host.previewWidth);
    // A pseudo-element just added from "+ Add pseudo-element": its group, empty, until its first
    // property makes it real.
    const pendingPseudo = this.ui.effPseudo && !groups.some((group) => group.state === this.ui.effPseudo)
      && !model.groups().some((group) => group.state === this.ui.effPseudo)
      ? this.ui.effPseudo
      : null;

    return html`<heo-section
      heading="Effective styles"
      glyph="sparkle"
      badge=${model.appliedProperties().length ? String(model.appliedProperties().length) : ''}
      ?open=${filtering ? true : sectionOpen('effective', true)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#remember('effective', event.detail.open)}
    >
      <p class="hint" style="margin:0 0 9px">
        What this element renders with${at !== null ? ` at ${at}px` : ''}, after the cascade. Pick a
        size, media query or state to see what it declares when it applies. Click a dot to see what
        else declares a value.
      </p>
      ${this.#renderEffectiveStrip(model, host)}
      ${picked === 'base'
        ? html`<div class="rows" data-declarations=${EFFECTIVE_LIST_ID}>
              ${renderPropertyRows(own, (property) => {
          const scope: RowScope = { kind: 'element' };
          return {
            property,
            scope,
            element: el,
            model,
            listId: EFFECTIVE_LIST_ID,
            destinations: this.#rowDestinations(el, model, property, scope),
          };
        }, host)}
            </div>
            ${own.length ? nothing : html`<p class="hint" style="margin:0">
              ${filtering ? 'No property matches.' : 'Nothing declares anything for this element yet.'}
            </p>`}
            ${renderBlockAdder(host, EFFECTIVE_LIST_ID, this.#elementDestinations(el, model), '', { choose: true })}
            ${groups.map((group) => this.#renderPseudoGroup(el, model, host, group.state, group.properties))}
            ${pendingPseudo ? this.#renderPseudoGroup(el, model, host, pendingPseudo, []) : nothing}
            ${filtering
            ? nothing
            : renderPseudoAdder(host, {
              id: EFFECTIVE_LIST_ID,
              existing: [...groups.map((group) => group.state), ...(pendingPseudo ? [pendingPseudo] : [])],
              onPick: (state) => {
                const id = `state-${state}`;
                host.form.reset();
                this.#patch({
                  effPseudo: state,
                  menu: null,
                  adder: { id, draft: needsGeneratedContent(state) ? valueStepDraft('content', '""') : '', dest: '' },
                });
                return null;
              },
            })}`
        : this.#renderSizeGroup(el, model, host)}
      ${filtering
        ? nothing
        : html`<div class="actions">
            <button
              class="btn sm"
              type="button"
              data-act="paste"
              title="Paste CSS and choose whether it belongs inline, in a class, or in a rule"
              @click=${() => this.editor.beginCssPaste(this.#pasteOptions(el, { context: 'inline', element: el }))}
            >
              ${icon('clipboard', 12)} Paste CSS…
            </button>
          </div>`}
    </heo-section>`;
  }

  /** One pseudo-element's group under Always: its rows, written into its own rules, and its adder. */
  #renderPseudoGroup(
    el: HTMLElement,
    model: ElementModel,
    host: StylesHost,
    state: string,
    properties: readonly string[],
  ): TemplateResult {
    const scope: RowScope = { kind: 'state', state };
    const listId = `state-${state}`;
    return html`<div class="egroup" data-egroup=${state}>
      ${renderBlockHeader('pseudo', state, 'pseudo-element', html`<span class="note">its own box</span>`)}
      <div class="rows" data-declarations=${listId}>
        ${renderPropertyRows(properties, (property) => ({
      property,
      scope,
      element: el,
      model,
      listId,
      destinations: this.#rowDestinations(el, model, property, scope),
    }), host)}
      </div>
      ${properties.length ? nothing : html`<p class="hint" style="margin:0">No declarations yet.</p>`}
      ${renderBlockAdder(host, listId, this.#stateDestinations(el, model, state), state, { choose: true })}
    </div>`;
  }

  /**
   * Where an Effective row's edit can go: what its block's adder offers, and the rule the value is
   * written in now when that is not among them (another family, another size), first.
   */
  #rowDestinations(el: HTMLElement, model: ElementModel, property: string, scope: RowScope): AdderDestination[] {
    const offered = scope.kind === 'size'
      ? this.#sizeDestinations(el, model, scope.slot, slotMedia(model, scope.slot) ?? '', slotName(model, scope.slot))
      : scope.kind === 'state'
        ? this.#stateDestinations(el, model, scope.state, scope.slot)
        : this.#elementDestinations(el, model);
    const { shown } = readRow({ property, scope, element: el, model, listId: '' });
    const entry = shown?.source.kind === 'rule' ? shown.source.entry : null;
    if (entry && entry.target.kind !== 'readonly' &&
      !offered.some((one) => one.dest?.kind === 'target' && sameTarget(one.dest.target, entry.target))) {
      const label = entryLabel(entry);
      const impact = model.reach(entry.family);
      offered.unshift(stylesDestination(
        label,
        reachText(impact),
        { kind: 'target', target: entry.target },
        toRecord(entry.declarations),
        label,
        { short: entry.family, name: `${entry.family}${entry.state}`, media: entry.media, impact },
      ));
    }
    // The switch names a rule by its family; two at once under different conditions say which.
    const shorts = offered.map((one) => one.short);
    return offered.map((one, at) =>
      shorts.indexOf(one.short) !== at || shorts.lastIndexOf(one.short) !== at
        ? { ...one, short: one.label }
        : one);
  }

  /** Open or close one of the panel's menus; closing hands focus back to what opened it. */
  #toggleMenu(id: string, open: boolean, refocus = true): void {
    this.mediaForm.reset();
    this.#patch({ menu: open ? { id } : null, popover: null, mediaDraft: null });
    // A dialog of fields (the viewport sizes, a search popover) is focused at its first; a menu at
    // its first item.
    const inside = id === 'preview' ? 'heo-viewport-sizes' : ':is(heo-value-field, .mi)';
    if (open || refocus) this.#focusSelector(
      open ? `.menu[data-menu="${CSS.escape(id)}"] ${inside}` : `[data-menu-anchor="${CSS.escape(id)}"]`,
      open,
    );
  }

  /**
   * Effective styles' bar and its pick: every condition a rule reaching the element declares under,
   * plus one picked from ⋮ and not written yet, and the pick itself while it is empty (the size a
   * preview follows). The pick is the hand pick, else the previewed width's size (R13).
   */
  #effectiveConditions(model: ElementModel, previewWidth: number | null): { chips: BarChip[]; count(key: string): number; picked: string } {
    const wanted = this.ui.effPick ?? previewSlot(model, previewWidth);
    const { chips, count } = barConditions(
      model,
      model.entries,
      previewWidth,
      [...(this.ui.otherSlots.get(EFFECTIVE_LIST_ID) ?? []), wanted],
    );
    const picked = wanted !== 'base' && chips.some((chip) => chip.key === wanted) ? wanted : 'base';
    return { chips, count, picked };
  }
  #renderEffectiveStrip(model: ElementModel, host: StylesHost): TemplateResult {
    const { chips, picked } = this.#effectiveConditions(model, host.previewWidth);
    const menuId = `strip-${EFFECTIVE_LIST_ID}`;
    return renderConditionBar({
      owner: EFFECTIVE_LIST_ID,
      picked,
      alwaysCount: model.appliedProperties().length,
      alwaysTitle: 'What the element renders with now',
      chips,
      remaining: remainingConditions(model, chips.map((chip) => chip.key), host.previewWidth, picked),
      menuOpen: this.ui.menu?.id === menuId,
      mediaDraft: this.ui.mediaDraft?.owner === EFFECTIVE_LIST_ID ? this.ui.mediaDraft.text : null,
      widthDraft: this.ui.mediaDraft?.owner === EFFECTIVE_LIST_ID ? this.ui.mediaDraft.width ?? null : null,
      onWidthDraft: (width) => this.#patch({ mediaDraft: { owner: EFFECTIVE_LIST_ID, text: '', ...(width ? { width } : {}) } }),
      viewports: this.editor.viewports().filter((one) => one.shown),
      mediaForm: this.mediaForm,
      // A button is a toggle: the bar hands back `base` for the one already picked.
      onPick: (key) => this.#patch({ effPick: key }),
      onMenu: (open, refocus) => this.#toggleMenu(menuId, open, refocus),
      onMediaDraft: (text) =>
        this.#patch({ mediaDraft: text === null ? null : { owner: EFFECTIVE_LIST_ID, text } }),
      onAdd: (key) => this.#showCondition(slotMedia(model, key), () => {
        // Only remembered here until a declaration is written under it: nothing empty is stored.
        const next = new Map(this.ui.otherSlots);
        next.set(EFFECTIVE_LIST_ID, [...new Set([...(next.get(EFFECTIVE_LIST_ID) ?? []), key])]);
        this.#patch({ otherSlots: next, effPick: key });
      }),
      keyForMedia: (media) => mediaKeyFor(model, media),
      onRemove: (key) => removeCondition(host, {
        owner: EFFECTIVE_LIST_ID,
        key,
        entries: model.entries,
        onCleared: () => this.#patch({ effPick: 'base' }),
      }),
    });
  }

  /**
   * The picked condition, as a group under the element's rows: what the rules under it declare, read
   * as though it were in effect (at its size's width, with its media query held, in its state), and
   * an adder that writes under it. Not what the element renders with now, where the condition is
   * usually off and the group would show nothing it declares.
   */
  #renderSizeGroup(el: HTMLElement, model: ElementModel, host: StylesHost): TemplateResult | typeof nothing {
    const { picked } = this.#effectiveConditions(model, host.previewWidth);
    if (picked === 'base') return nothing;
    const { media: slot, state } = conditionParts(picked);
    const media = slotMedia(model, picked);
    const short = slotName(model, picked);
    const scope: RowScope = state ? { kind: 'state', state, slot } : { kind: 'size', slot };
    const listId = state ? `state-${state}${slot === 'base' ? '' : `@${slot}`}` : `size-${slot}`;
    const names = new Set<string>();
    for (const entry of model.entries) {
      if (conditionOf(model, entry) !== picked) continue;
      for (const one of entry.declarations) names.add(one.property.toLowerCase());
    }
    const name = conditionName(model, picked);
    const properties = [...names].sort().filter((property) => this.#hit(property, picked, name));
    const note = state
      ? `when it applies, over “Always”${short ? ` · ${media !== null && !isWidthQuery(media) ? 'under' : 'at'} ${short}` : ''}`
      : mediaNow(media ?? '', media !== null && mediaApplies(media, null), model.width);
    return html`<div class="egroup" data-egroup=${state ? `state:${picked.slice('state:'.length)}` : `size:${slot}`}>
      ${renderBlockHeader(
      state ? 'cursor' : mediaIcon(media ?? ''),
      state || short,
      state ? 'state' : mediaKind(media ?? ''),
      html`<span class="note">${note}</span>`,
    )}
      <div class="rows" data-declarations=${listId}>
        ${renderPropertyRows(properties, (property) => ({
      property,
      scope,
      element: el,
      model,
      listId,
      destinations: this.#rowDestinations(el, model, property, scope),
    }), host)}
      </div>
      ${properties.length
        ? nothing
        : html`<p class="hint" style="margin:0">
            Nothing ${state ? `on ${state}` : media !== null && isWidthQuery(media) ? 'changes at this size' : 'changes under this media query'} yet.
          </p>`}
      ${renderBlockAdder(
          host,
          listId,
          state ? this.#stateDestinations(el, model, state, slot) : this.#sizeDestinations(el, model, slot, media ?? '', short),
          state,
          { choose: true },
        )}
    </div>`;
  }
  /** Where a size group's adder writes: every family at that size, then a new class of its own. */
  #sizeDestinations(
    el: HTMLElement,
    model: ElementModel,
    slot: string,
    media: string,
    short: string,
  ): AdderDestination[] {
    const { classes, others } = model.families();
    return [
      ...[...classes, ...others].map((family) => {
        const entry = model.entries.find((one) =>
          one.family === family.key &&
          one.state === '' &&
          model.slotOf(one) === slot &&
          one.target.kind !== 'readonly');
        const reach = model.reach(family.key);
        return stylesDestination(
          `${family.key} ${short}`,
          reachText(reach),
          entry ? { kind: 'target', target: entry.target } : { kind: 'new-rule', selector: family.key, media },
          entry ? toRecord(entry.declarations) : {},
          `${family.key} ${short}`,
          { short: family.key, media, impact: reach },
        );
      }),
      stylesDestination(
        `a new class ${short}`,
        'this element only',
        { kind: 'auto-class', element: el, media, state: '' },
        {},
        `a new class ${short}`,
        { media, impact: 1 },
      ),
    ];
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
        { impact: 1 },
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
          `${reachText(reach)}, every size`,
          target ? { kind: 'target', target } : { kind: 'new-rule', selector: `.${CSS.escape(name)}`, media: null },
          base ? toRecord(base.declarations) : owned ? { ...owned.declarations } : {},
          `.${name}`,
          { impact: reach },
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
        { impact: 1 },
      ),
    );
    return destinations;
  }

  /**
   * Where a state group's adder writes: the families that already have that state first, then the
   * rest, then a new class of the element's own in that state.
   */
  #stateDestinations(el: HTMLElement, model: ElementModel, state: string, slot = 'base'): AdderDestination[] {
    const { classes, others } = model.families();
    const keys = [...classes, ...others].map((family) => family.key);
    // Under the group's media too: `:hover ≥768px` writes into the `≥768px` hover rule.
    const media = slotMedia(model, slot);
    const short = slotName(model, slot);
    const existing = (key: string) =>
      model.entries.find((entry) =>
        entry.family === key && entry.state === state && model.slotOf(entry) === slot && entry.target.kind !== 'readonly');
    const ordered = [...keys.filter((key) => existing(key)), ...keys.filter((key) => !existing(key))];
    return [
      ...ordered.map((key) => {
        const entry = existing(key);
        const reach = model.reach(key);
        const label = `${key}${state}${short ? ` ${short}` : ''}`;
        return stylesDestination(
          label,
          reachText(reach),
          entry ? { kind: 'target', target: entry.target } : { kind: 'new-rule', selector: `${key}${state}`, media },
          entry ? toRecord(entry.declarations) : {},
          label,
          { short: key, name: `${key}${state}`, media, impact: reach },
        );
      }),
      stylesDestination(
        `a new class${state}${short ? ` ${short}` : ''}`,
        'this element only',
        { kind: 'auto-class', element: el, media, state },
        {},
        `a new class${state}${short ? ` ${short}` : ''}`,
        { media, impact: 1 },
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
    if (userToggled.get('effective') === false) userToggled.delete('effective');
    this.adderForm.reset();
    this.#patch({ adder: { id: EFFECTIVE_LIST_ID, draft: property, dest: '' }, menu: null, popover: null });
    this.#focusSelector(`.property-adder[data-adder="${EFFECTIVE_LIST_ID}"] heo-value-field`);
  }

  /* ---------------------------------------------------------------------- */
  /* Focus and the layers                                                   */
  /* ---------------------------------------------------------------------- */

  /** Flash a property's row in one list once the next render has landed: where an add landed. */
  #flashRow(property: string, listId: string): void {
    void this.updateComplete.then(() =>
      requestAnimationFrame(() => {
        const root = this.renderRoot;
        const selector = `heo-value-field[data-property="${CSS.escape(property)}"]`;
        const list = listId ? root.querySelector(`[data-declarations="${CSS.escape(listId)}"]`) : null;
        const found = (list?.querySelector(selector) ?? root.querySelector(selector)) as HeoValueField | null;
        if (!found) return;
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
   * should close these. An adder with a draft is left to its own blur.
   */
  /** When the last press landed outside this panel: focus is not pulled back into it after one. */
  #pressedOutsideAt = 0;

  /*
   * Focus that drops out of a layer onto nothing goes back to the layer's opener.
   *
   * A value field blurs itself on Escape, a press on blank panel space blurs whatever had focus,
   * and a removed control takes focus with it. Each left focus on the document body, where the next
   * Escape reached the page's keymap and deselected the element. A press outside the panel is left
   * alone: the user moved on.
   */
  #onFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget) return;
    const path = event.composedPath();
    const root = this.renderRoot;
    // By the path, not `contains`: a field's input sits in the field's own shadow root.
    const owner = this.#openers().find(({ layer, opener }) => {
      const at = root.querySelector(layer);
      const by = root.querySelector(opener);
      return (at && path.includes(at)) || (by && path[0] === by);
    });
    if (!owner) {
      this.#keepFocusInPanel(path);
      return;
    }
    requestAnimationFrame(() => {
      if (performance.now() - this.#pressedOutsideAt < 400) return;
      const active = deepActive();
      if (active && active !== document.body) return;
      // The innermost opener still on screen: a collapsed card's link, else the popover's dot.
      const back = [owner, ...this.#openers()].map(({ opener }) => root.querySelector<HTMLElement>(opener)).find(Boolean)
        ?? root.querySelector<HTMLElement>(owner.opener);
      back?.focus({ preventScroll: true });
    });
  };

  /**
   * A value field taken away under the caret (its row re-rendered, or went) leaves focus on the page,
   * where the next Backspace, meant for the field, would delete the selected element. Focus goes to
   * the same property's field when it is still drawn, else to the panel itself, never to the page.
   */
  #keepFocusInPanel(path: EventTarget[]): void {
    const field = path.find((node): node is HTMLElement => node instanceof HTMLElement && node.localName === 'heo-value-field');
    if (!field) return;
    const property = field.dataset.property;
    const list = field.closest('[data-declarations]')?.getAttribute('data-declarations');
    requestAnimationFrame(() => {
      if (field.isConnected) return;
      if (performance.now() - this.#pressedOutsideAt < 400) return;
      const active = deepActive();
      if (active && active !== document.body) return;
      const root = this.renderRoot;
      const same = property
        ? root.querySelector<HeoValueField>(`${list ? `[data-declarations="${CSS.escape(list)}"] ` : ''}heo-value-field[data-property="${CSS.escape(property)}"]`)
        ?? root.querySelector<HeoValueField>(`heo-value-field[data-property="${CSS.escape(property)}"]`)
        : null;
      if (same) same.focusInput();
      // Else the section's header, a button: focus is in the panel, where Backspace is not a page key.
      else root.querySelector('heo-section')?.shadowRoot?.querySelector<HTMLElement>('.head')?.focus({ preventScroll: true });
    });
  }

  #onOutsidePress = (event: Event): void => {
    const path = event.composedPath();
    if (!path.includes(this)) this.#pressedOutsideAt = performance.now();
    const inside = (selector: string): boolean =>
      path.some((node) => node instanceof Element && node.matches?.(selector));
    const next: Partial<StylesUiState> = {};
    const popover = this.ui.popover;
    if (popover && !inside('.pop') && !inside(`.row[data-row="${CSS.escape(popover.rowId)}"] .dots`)) {
      next.popover = null;
    }
    // Its own menus, adders and value lists are inside it, so a press there keeps it.
    const cardPop = this.ui.cardPop;
    // A press on "Paste CSS…" keeps the card: the paste opens on its class, and the card shows
    // what landed in it.
    if (cardPop && !inside('.cardpop') && !inside(cardPop.anchor) && !inside('[data-act="paste"]')) next.cardPop = null;
    const menu = this.ui.menu;
    if (menu && !inside(`.menu[data-menu="${CSS.escape(menu.id)}"]`) && !inside(`[data-menu-anchor="${CSS.escape(menu.id)}"]`)) {
      next.menu = null;
    }
    // The class finder's list is inside its popover, so a press on a suggestion keeps it.
    if (this.ui.finderOpen && !inside('.finderpop') && !inside('.ident .cchip.add')) {
      this.classForm.reset();
      next.finderOpen = false;
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
    if (this.ui.popover || this.ui.menu || this.ui.cardPop || this.ui.finderOpen) this.#placeLayers();
  };

  /*
   * Escape closes the innermost open thing, and goes no further: the global keymap reads Escape as
   * "deselect". Menus, adders and value fields handle their own; this is for when
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
    } else if (ui.cardPop) {
      const anchor = ui.cardPop.anchor;
      this.#patch({ cardPop: null });
      // Back to what opened it: the class name, or the dot of the row a popover link came from.
      this.#focusSelector(anchor.startsWith('.row') ? `${anchor} .dots` : anchor);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  /*
   * The tree the panel is rendered in, listened to for scrolls as well as the window: a scroll
   * event does not leave the shadow root it happens in, so the dock's own scroller (the one the
   * panel scrolls in) never reached the window listener, and an open popover stayed put while its
   * row scrolled away (measured: 0 events at the window, 1 at the dock's root).
   */
  #scrollRoot: Node | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    listen(document, 'pointerdown', this.#onOutsidePress, true);
    listen(window, 'scroll', this.#onViewportChange, true);
    listen(window, 'resize', this.#onViewportChange);
    const root = this.getRootNode();
    this.#scrollRoot = root === document ? null : root;
    if (this.#scrollRoot) listen(this.#scrollRoot, 'scroll', this.#onViewportChange, true);
    this.addEventListener('keydown', this.#onKeydown);
    this.renderRoot.addEventListener('focusout', this.#onFocusOut as EventListener);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // The rules' chips stay shown from selection to selection, until the panel is closed.
    this.ui = { ...this.ui, rulesOpen: false };
    unlisten(document, 'pointerdown', this.#onOutsidePress, true);
    unlisten(window, 'scroll', this.#onViewportChange, true);
    unlisten(window, 'resize', this.#onViewportChange);
    if (this.#scrollRoot) unlisten(this.#scrollRoot, 'scroll', this.#onViewportChange, true);
    this.#scrollRoot = null;
    this.removeEventListener('keydown', this.#onKeydown);
    this.renderRoot.removeEventListener('focusout', this.#onFocusOut as EventListener);
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
        ${renderPropertyRows(own, (property) => ({ property, scope, element: el, model, listId: 'parent-self' }), host)}
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
        ${renderPropertyRows(properties, (property) => ({ property, scope, element: parent, model, listId: 'parent-up' }), host)}
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* The element's cards                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * The element's cards, in their order: its classes in class-list order, then every other family
   * reaching it in file order (R17). What the header's chips and the card popovers are built from.
   */
  #sourceCards(el: HTMLElement, model: ElementModel, host: StylesHost): {
    classes: Array<{ name: string; view: CardView | null }>;
    others: CardView[];
  } {
    const { classes, others } = model.families();
    const byName = new Map(classes.map((family) => [simpleClassName(family.key), family]));
    return {
      classes: Array.from(el.classList)
        .filter((name) => !name.startsWith('heo-'))
        .map((name) => {
          const family = byName.get(name);
          if (family) return { name, view: cardView(family, host) };
          // Defined in the registry but writing nothing yet (an empty class): a card to fill.
          if (this.editor.classes.get(name)) {
            return {
              name,
              view: cardView({ key: `.${name}`, isClass: true, members: [], first: Infinity }, host),
            };
          }
          return { name, view: null };
        }),
      // While previewing, a rule with nothing in effect at that width is not where anything is written.
      others: others.map((family) => cardView(family, host)).filter((view) => view.visible.length),
    };
  }

  /**
   * Open a card from its chip in the header, with a property focused when one is named: a class
   * the element wears, or one of the other rules, whose chips are shown for it if they were folded.
   * Reached from "Copy it for this element" (the new class) and from a popover's link to a rule
   * that has no card under it.
   */
  #openCard(key: string, options: { slot?: string; state?: string; property?: string } = {}): void {
    const el = this.editor.selected;
    if (!el) return;
    // A class opens from its chip; any other rule from its own, shown for it if they were folded.
    const name = Array.from(el.classList).find((one) => `.${CSS.escape(one)}` === key);
    const anchor = name
      ? `.ident .cchip[data-class="${CSS.escape(name)}"] .name`
      : `.ident .cchip.rule[data-rule="${CSS.escape(key)}"] .name`;
    if (!name) this.#patch({ rulesOpen: true });
    this.#popCard(key, anchor, options);
  }


  /**
   * Open a card over the panel, against `anchor`: where it was asked for, so the class or
   * rule is edited without leaving the row (or the header) and scrolling down to its card. With a
   * property, that declaration is focused in the block at `slot` and `state`.
   */
  #popCard(key: string, anchor: string, options: { slot?: string; state?: string; property?: string } = {}): void {
    const picks = new Map(this.ui.cardPicks);
    // The condition the declaration is under: its size, and its state when it is not a pseudo-element.
    if (options.slot) picks.set(key, conditionKey(options.slot, isPseudoElement(options.state ?? '') ? '' : options.state ?? ''));
    this.#patch({ popover: null, menu: null, adder: null, cardPop: { key, anchor }, cardPicks: picks });
    // Focus stays on the class name; Tab goes on into the card from there.
    if (!options.property) return;
    void this.updateComplete.then(() => requestAnimationFrame(() => {
      const pop = this.renderRoot.querySelector<HTMLElement>('.cardpop');
      if (pop) focusDeclaration(pop, options.property!, blockId(key, options.slot ?? 'base', options.state ?? ''));
    }));
  }

  /**
   * The element's own styles over the panel, from the header: the tag chip opens its style
   * attribute and its id's rules, the id chip only the id's rules. A toggle, like a class name.
   */
  #popOwn(el: HTMLElement, model: ElementModel, host: StylesHost, key: typeof ELEMENT_POP | typeof ID_POP): void {
    const anchor = key === ELEMENT_POP ? '.ident .el-chip' : '.ident .cchip.id .name';
    if (this.ui.cardPop?.key === key) {
      this.#closeTo({ cardPop: null }, anchor);
      return;
    }
    this.#patch({ popover: null, menu: null, adder: null, cardPop: { key, anchor, cards: this.#ownCards(el, model, host, key) } });
  }

  /** What the tag chip or the id chip shows: the style attribute first for the tag, then the id's rules. */
  #ownCards(el: HTMLElement, model: ElementModel, host: StylesHost, key: string): string[] {
    const ids = this.#idCards(el, model, host).map((view) => view.family.key);
    return key === ELEMENT_POP ? [INLINE_LIST_ID, ...ids] : ids;
  }

  /**
   * Keep an open tag or id popover's cards in step with the rules: one written from it (its first
   * property, through the id popover's adder), or one edited away, joins or leaves it.
   *
   * Assigned rather than patched, while rendering: the popover drawn after reads the list, so it
   * has to be right in this same render, and nothing else needs to hear of it.
   */
  #syncOwnCards(el: HTMLElement, model: ElementModel, host: StylesHost): void {
    const pop = this.ui.cardPop;
    if (!pop || (pop.key !== ELEMENT_POP && pop.key !== ID_POP)) return;
    const cards = this.#ownCards(el, model, host, pop.key);
    if (cards.join('\n') !== (pop.cards ?? []).join('\n')) this.ui = { ...this.ui, cardPop: { ...pop, cards } };
  }

  /** The rules written for the element's id (`#hero`, `main #hero > p`) that reach it, in file order. */
  #idCards(el: HTMLElement, model: ElementModel, host: StylesHost): CardView[] {
    if (!el.id) return [];
    const mention = new RegExp(`#${escapeRegExp(CSS.escape(el.id))}(?![\\w-])`);
    return this.#sourceCards(el, model, host).others.filter((view) => mention.test(view.family.key));
  }

  /**
   * Where a popped card goes across: over the panel's own column, at its width, so a card wraps
   * the same whichever chip opened it; only its height follows what opened it.
   */
  #cardPopFrame(): { minWidth: number; gap: number; left?: number } {
    const place = this.renderRoot.querySelector('heo-section');
    const box = place?.getBoundingClientRect();
    /*
     * The popover's frame is 3px of padding and 1px of border each side, and the popped card drops
     * its own 1px border: 6px wider than the place leaves the card's rows exactly as wide.
     */
    return box && box.width
      ? { minWidth: Math.round(box.width) + 6, gap: 4, left: Math.round(box.left) - 3 }
      : { minWidth: 320, gap: 4 };
  }

  /**
   * One of the element's cards, drawn for a popover: always open, and unfiltered, since a search
   * narrows the panel, not the card asked for. Nothing when the element has no such card.
   */
  #poppedCard(
    el: HTMLElement,
    model: ElementModel,
    host: StylesHost,
    key: string,
    popped: Popped,
  ): TemplateResult | typeof nothing {
    const whole: StylesHost = Object.assign(Object.create(host) as StylesHost, {
      filtering: false,
      hit: () => true,
    });
    if (key === INLINE_LIST_ID) return renderInlineCard(whole, { popped });
    const { classes, others } = this.#sourceCards(el, model, whole);
    const named = classes.find(({ name, view }) => (view?.family.key ?? `.${CSS.escape(name)}`) === key);
    const other = others.find((view) => view.family.key === key);
    return named
      ? named.view
        ? renderFamilyCard(named.view, whole, { group: 'classes', popped })
        : renderUnknownCard(named.name, whole, { popped })
      : other
        ? renderFamilyCard(other, whole, { group: 'rules', popped })
        : nothing;
  }

  /** A header chip's cards, in a popover under the chips: a class's, or the element's own. */
  #renderCardPop(el: HTMLElement, model: ElementModel, host: StylesHost): TemplateResult | typeof nothing {
    const pop = this.ui.cardPop;
    if (!pop) return nothing;
    const popped: Popped = { onClose: () => this.#closeTo({ cardPop: null }, pop.anchor) };
    const cards = (pop.cards ?? [pop.key])
      .map((key) => this.#poppedCard(el, model, host, key, popped))
      .filter((card) => card !== nothing);
    // An id no rule is written for yet: say so, and offer the rule, rather than open nothing.
    const none = pop.key === ID_POP && !cards.length && el.id ? this.#renderNoIdRule(el, host) : nothing;
    if (!cards.length && none === nothing) return nothing;
    const label = pop.key === ELEMENT_POP
      ? `Edit this ${el.localName}'s own styles`
      : pop.key === ID_POP ? `Edit the rules for #${el.id}` : `Edit ${pop.key}`;
    return html`<div
      class="pop cardpop"
      role="dialog"
      popover="manual"
      tabindex="-1"
      data-card-pop=${pop.key}
      aria-label=${label}
    >
      ${cards}${none}
    </div>`;
  }

  /**
   * The id chip's popover when no rule targets the id: an adder for the first property, written
   * into a new `#id` rule, which then shows here as its card. An empty rule is never written.
   */
  #renderNoIdRule(el: HTMLElement, host: StylesHost): TemplateResult {
    const selector = `#${CSS.escape(el.id)}`;
    return html`<div class="none">
      <p class="hint" style="margin:0">No rule is written for <code class="mono">${selector}</code> yet.</p>
      ${renderBlockAdder(
      host,
      NEW_ID_RULE,
      [stylesDestination(selector, reachText(1), { kind: 'new-rule', selector, media: null }, {}, selector)],
      '',
    )}
    </div>`;
  }

  /**
   * Put a condition on a bar where it can be seen. A preview width resets the bars' picks, so the
   * pick is made once the new width has rendered.
   */
  #showCondition(media: string | null, then: () => void): void {
    const was = this.editor.store.value.previewWidth;
    const to = media === null ? 'here' : previewToShow(media, was);
    if (to === 'here') {
      then();
      return;
    }
    this.editor.setPreviewWidth(to);
    this.editor.notify(to === null
      ? `Back to Actual: @media ${media} is not in effect at ${was}px, so the bar could not show it there.`
      : `Previewing ${to}px, where @media ${media} is in effect.`, 'info');
    void this.updateComplete.then(then);
  }

  /**
   * Where a general "Paste CSS…" opens: on a class of the element whose card is open over the panel
   * (from its chip), since that is the class being worked on; else on `fallback`.
   */
  #pasteOptions(el: HTMLElement, fallback: CssPasteOptions): CssPasteOptions {
    const key = this.ui.cardPop?.key;
    const name = key ? Array.from(el.classList).find((one) => `.${CSS.escape(one)}` === key) : undefined;
    return name ? { context: 'class', element: el, className: name } : fallback;
  }

  /** The preview bar: the page's width, set with or without a selected element. */
  #renderPreviewBar(el: HTMLElement | null): TemplateResult {
    return renderPreviewBar({
      engine: this.editor,
      previewWidth: this.editor.store.value.previewWidth,
      viewports: this.editor.viewports(),
      menuOpen: this.ui.menu?.id === 'preview',
      onMenu: (open) => this.#toggleMenu('preview', open),
      onLayout: () => this.#placeLayers(),
      inShadowRoot: el !== null && el.getRootNode() instanceof ShadowRoot,
    });
  }

  /** The header's "find or create a class" field: today's finder, with its form and suggestions. */
  #renderFinder(el: HTMLElement): TemplateResult {
    return html`<heo-value-field
        ${field(this.classForm, 'class-add')}
        inline-list
        leading-icon="search"
        clearable
        action="Add class"
        action-icon="plus"
        create-label=${createClassLabel(normalizeClassName(this.classDraft) || this.classDraft)}
        create-title=${CREATE_CLASS_TITLE}
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
      ${this.classForm.error('class-add')}`;
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
    // The shorthands, and each side declared for this element, under its shorthand: written in the
    // same block they are one family, with its control for which comes last.
    const shorthands = ['margin', 'padding'].filter((property) => hits.includes(property));
    const rowsShown = shorthands.flatMap((shorthand) => [
      shorthand,
      ...longhands.filter((side) => side.startsWith(`${shorthand}-`) && hits.includes(side) &&
        model.cascade(side).applying.some((one) => !one.via)),
    ]);
    const touched = longhands.filter((property) => declaredBox[property]).length;
    const scope: RowScope = { kind: 'section', id: 'spacing' };

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
        @box-change=${(event: CustomEvent<{ declarations: Record<string, string> }>) =>
        this.#commitBox(event.detail.declarations, scope, el, model, host)}
      ></heo-box-editor>

      ${shorthands.length
        ? html`<div class="rows" style="margin-top:10px" data-declarations="spacing">
            ${renderPropertyRows(rowsShown, (property) => ({
          property,
          scope,
          element: el,
          model,
          ...(property.includes('-') ? {} : { placeholder: 'all sides' }),
          listId: 'spacing',
        }), host)}
          </div>`
        : nothing}
    </heo-section>`;
  }

  /**
   * A box-editor batch, as one undo entry: each side where its value is written now, or where its
   * editor's switch says, the same as a row (its value list carries the switch).
   */
  #commitBox(declarations: Record<string, string>, scope: RowScope, el: HTMLElement, model: ElementModel, host: StylesHost): void {
    const writes = Object.entries(declarations).map(([property, value]) => {
      const spec: RowSpec = { property, scope, element: el, model, listId: 'spacing' };
      const { shown } = readRow(spec);
      const choice = destinationChoice(spec, host, rowIdOf(scope, property, el), shown);
      return { property, value, choice };
    });
    this.#patch({ rowDest: null });
    this.editor.writeDeclarationsTo(
      writes.map(({ property, value, choice }) => ({
        dest: choice.picked.dest!,
        property,
        value,
        move: choice.current?.dest?.kind === 'target' && choice.current.dest.target.kind === 'inline' &&
          !(choice.picked.dest?.kind === 'target' && choice.picked.dest.target.kind === 'inline'),
      })),
      'Adjust spacing',
      el,
    );
  }

  /**
   * Border: the outline-border-content editor, plus `border`, `outline` and `border-radius` as rows.
   *
   * The editor edits a line by its parts and writes it as one shorthand, where the shorthand's row
   * writes (its destination switch). The parts a block declares on their own are rows under their
   * shorthand, as a family, since then they are real declarations; supplied by the shorthand they
   * are not rows at all (BORDER_PROPERTIES).
   */
  #renderBorder(
    el: HTMLElement,
    model: ElementModel,
    computed: CSSStyleDeclaration,
    host: StylesHost,
  ): TemplateResult | typeof nothing {
    const hits = BORDER_PROPERTIES.filter((property) =>
      this.#hit(property, shownValue(model.cascade(property).applying[0])));
    if (!hits.length) return nothing;
    const scope: RowScope = { kind: 'section', id: 'border' };
    const specOf = (property: string): RowSpec => ({ property, scope, element: el, model, listId: 'border' });
    const choiceOf = (property: string) => {
      const spec = specOf(property);
      const { shown } = readRow(spec);
      return { spec, shown, choice: destinationChoice(spec, host, rowIdOf(scope, property, el), shown) };
    };

    const lines = { border: this.#lineView('border', model, computed), outline: this.#lineView('outline', model, computed) };
    const fields: Record<string, BorderFieldSpec> = {};
    for (const kind of BORDER_SHORTHANDS) {
      const head = choiceOf(kind).choice.head;
      for (const part of LINE_PARTS) {
        fields[`${kind}-${part}`] = { suggestions: buildSuggestions(this.editor, `${kind}-${part}`, el), head };
      }
    }
    fields['border-radius'] = { suggestions: buildSuggestions(this.editor, 'border-radius', el), head: choiceOf('border-radius').choice.head };
    fields['outline-offset'] = { suggestions: buildSuggestions(this.editor, 'outline-offset', el), head: choiceOf('outline-offset').choice.head };
    const radius = { value: shownValue(model.cascade('border-radius').applying[0]), computed: computed.borderRadius };
    const offset = { value: shownValue(model.cascade('outline-offset').applying[0]), computed: computed.outlineOffset };

    // Each shorthand, then the parts a block declares on their own (a real declaration to show):
    // the border's, each side's family, the outline's, and its offset.
    const own = (property: string): boolean => model.cascade(property).applying.some((one) => !one.via);
    const partsOf = (kind: LineKind): string[] => BORDER_PARTS.filter((part) => part.startsWith(`${kind}-`) && own(part));
    const rowsShown = [
      'border',
      ...partsOf('border'),
      ...BORDER_SIDE_PROPERTIES.filter(own),
      'outline',
      ...partsOf('outline'),
      ...(own('outline-offset') ? ['outline-offset'] : []),
      'border-radius',
    ].filter((property) => hits.includes(property));
    const touched = BORDER_PROPERTIES.filter(own).length;

    /** The line a field's edit writes: a shorthand's part, a side's part, or null for its own property. */
    const lineOf = (property: string): { kind: LineKind; part: LinePart; side?: Side } | null => {
      const words = property.split('-');
      const [kind] = words as [LineKind];
      if (kind !== 'border' && kind !== 'outline') return null;
      const part = words[words.length - 1] as LinePart;
      if (!LINE_PARTS.includes(part)) return null;
      if (words.length === 2) return { kind, part };
      const side = words[1] as Side;
      return kind === 'border' && words.length === 3 && SIDES.includes(side) ? { kind, part, side } : null;
    };
    /** What one side's edit writes, as its whole family (composeEdge). */
    const edgeWrites = (side: Side, part: LinePart, value: string): Record<string, string> =>
      composeEdge(side, lines.border.edges![side].parts, this.#allSides(lines.border), part, value);
    const preview = (property: string, value: string): void => {
      const line = lineOf(property);
      const { choice } = choiceOf(line ? line.kind : property);
      if (line?.side) {
        // The side's own shorthand when that is what the edit writes, else its one longhand.
        const writes = edgeWrites(line.side, line.part, value);
        const shorthand = `border-${line.side}`;
        const [name, text] = writes[shorthand]
          ? [shorthand, writes[shorthand]!]
          : [property, writes[property] || value || this.#allSides(lines.border)?.[line.part] || ''];
        previewChosen(host, specOf(name), choice.picked, text);
        return;
      }
      previewChosen(host, specOf(line ? line.kind : property), choice.picked, line ? composeLine(this.#lineBase(lines[line.kind]), line.part, value) : value);
    };
    const commit = (property: string, value: string): void => {
      const line = lineOf(property);
      if (!line) {
        const { spec, shown, choice } = choiceOf(property);
        writeChosen(host, spec, choice, shown, value);
        return;
      }
      if (line.side) {
        this.#commitEdge(edgeWrites(line.side, line.part, value), choiceOf('border').choice, el, model, `Set border-${line.side}`);
        return;
      }
      this.#commitLine(line.kind, composeLine(this.#lineBase(lines[line.kind]), line.part, value), choiceOf(line.kind).choice, el, model);
    };
    const reset = (side: Side): void => {
      const writes = Object.fromEntries([`border-${side}`, ...LINE_PARTS.map((part) => `border-${side}-${part}`)].map((name) => [name, '']));
      this.#commitEdge(writes, choiceOf('border').choice, el, model, `Reset border-${side}`);
    };

    return html`<heo-section
      heading="Border"
      glyph="frame"
      badge=${touched ? String(touched) : ''}
      ?open=${host.filtering ? true : sectionOpen('border', true)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#remember('border', event.detail.open)}
    >
      <heo-border-editor
        .lines=${lines}
        .radius=${radius}
        .offset=${offset}
        .fields=${fields}
        @line-input=${(event: CustomEvent<{ property: string; value: string }>) => preview(event.detail.property, event.detail.value)}
        @line-change=${(event: CustomEvent<{ property: string; value: string }>) => commit(event.detail.property, event.detail.value)}
        @line-revert=${() => this.editor.cancelPreview()}
        @line-reset=${(event: CustomEvent<{ property: string }>) => reset(event.detail.property.replace(/^border-/, '') as Side)}
      ></heo-border-editor>
      ${rowsShown.length
        ? html`<div class="rows" style="margin-top:10px" data-declarations="border">
            ${renderPropertyRows(rowsShown, specOf, host)}
          </div>`
        : nothing}
    </heo-section>`;
  }

  /**
   * One line as the editor shows it: each part as written, read through whichever declaration
   * supplies it (the part's own, or the shorthand's text), and the parts the page draws.
   */
  #lineView(kind: LineKind, model: ElementModel, computed: CSSStyleDeclaration): LineView {
    const parts: LineParts = { width: '', style: '', color: '' };
    let token = '';
    for (const part of LINE_PARTS) {
      const winner = model.cascade(`${kind}-${part}`).applying[0];
      if (!winner) continue;
      if (!winner.via) parts[part] = winner.value;
      else if (winner.via === kind) {
        const read = parseLine(winner.value);
        parts[part] = read[part];
        token ||= read.token;
      }
    }
    const sides = kind === 'border' ? SIDES : [null];
    const drawn: LineParts = { width: '', style: '', color: '' };
    const mixed: LineView['mixed'] = {};
    for (const part of LINE_PARTS) {
      const values = sides.map((side) => computed.getPropertyValue(side ? `${kind}-${side}-${part}` : `${kind}-${part}`).trim());
      drawn[part] = values[0] ?? '';
      mixed[part] = new Set(values).size > 1;
    }
    if (kind !== 'border') return { parts, token, computed: drawn, mixed };
    const edges = Object.fromEntries(SIDES.map((side): [Side, EdgeView] => [side, this.#edgeView(side, model, computed)])) as Record<Side, EdgeView>;
    return { parts, token, computed: drawn, mixed, edges };
  }

  /**
   * One side as the editor shows it: the parts it declares for itself, by its longhand or through
   * its own shorthand (`border-bottom`), and not those it takes from `border` or `border-width`.
   */
  #edgeView(side: Side, model: ElementModel, computed: CSSStyleDeclaration): EdgeView {
    const parts: LineParts = { width: '', style: '', color: '' };
    const drawn: LineParts = { width: '', style: '', color: '' };
    for (const part of LINE_PARTS) {
      const property = `border-${side}-${part}`;
      drawn[part] = computed.getPropertyValue(property).trim();
      const winner = model.cascade(property).applying[0];
      if (!winner) continue;
      if (!winner.via) parts[part] = winner.value;
      else if (winner.via === `border-${side}`) parts[part] = parseLine(winner.value)[part];
    }
    return { parts, computed: drawn };
  }

  /**
   * What every side takes from the all-sides border, or null when there is none to take: as
   * written, and as drawn where a part is not written (`border: dashed` draws `medium`).
   */
  #allSides(border: LineView): LineParts | null {
    if (!border.token && !LINE_PARTS.some((part) => border.parts[part])) return null;
    const base = this.#lineBase(border);
    return { width: base.width || border.computed.width, style: base.style || border.computed.style, color: base.color || border.computed.color };
  }

  /**
   * Write one side's family where the border writes, as one undo entry. A removal is only of what
   * that same block declares: there is nothing to take out of a block not yet written.
   */
  #commitEdge(
    writes: Record<string, string>,
    choice: ReturnType<typeof destinationChoice>,
    el: HTMLElement,
    model: ElementModel,
    label: string,
  ): void {
    const dest = choice.picked.dest;
    if (!dest) return;
    this.editor.cancelPreview();
    this.#patch({ rowDest: null });
    const into = dest.kind === 'target' ? dest.target : null;
    const declaredHere = (property: string): boolean => Boolean(into) &&
      model.cascade(property).applying.some((one) => !one.via && sameTarget(targetOf(one, el), into!));
    const list = Object.entries(writes)
      .filter(([property, value]) => value || declaredHere(property))
      .map(([property, value]) => ({ dest, property, value, remove: !value }));
    if (!list.length) return;
    this.editor.writeDeclarationsTo(list, label, el);
  }

  /**
   * The parts an edit starts from: as written, or as drawn when the line is written as one token
   * (`var(--border)`), since a part of a token cannot be changed and the rest kept otherwise.
   */
  #lineBase(line: LineView): LineParts {
    if (!line.token) return line.parts;
    const style = line.computed.style;
    return /^(?:none|hidden)$/i.test(style) ? { width: '', style: '', color: '' } : { ...line.computed };
  }

  /**
   * Write a line as one shorthand where its row writes, and fold away the parts the same block
   * declares on their own: kept, they would compete with the new shorthand by order, which is how
   * `border-width` came to override a border just set. One undo entry.
   */
  #commitLine(kind: LineKind, value: string, choice: ReturnType<typeof destinationChoice>, el: HTMLElement, model: ElementModel): void {
    const dest = choice.picked.dest;
    if (!dest) return;
    this.editor.cancelPreview();
    this.#patch({ rowDest: null });
    const into = dest.kind === 'target' ? dest.target : null;
    const folded = into
      ? LINE_PARTS.map((part) => `${kind}-${part}`).filter((property) =>
        model.cascade(property).applying.some((one) =>
          !one.via && sameTarget(targetOf(one, el), into)))
      : [];
    const moving = choice.current?.dest?.kind === 'target' && choice.current.dest.target.kind === 'inline' && into?.kind !== 'inline';
    this.editor.writeDeclarationsTo(
      [
        { dest, property: kind, value, move: moving, remove: !value },
        ...folded.map((property) => ({ dest, property, value: '', remove: true })),
      ],
      value ? `Set ${kind}` : `Remove ${kind}`,
      el,
    );
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
        ${renderPropertyRows(properties, (property) => ({ property, scope, element: el, model, listId: section.id }), host)}
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

  /**
   * How many things the filter is showing, across every surface that draws one.
   *
   * Counted rather than inferred so the number beside the field and what is on screen cannot
   * disagree — which is the whole reason the count lives here and not in the control. Properties
   * are de-duplicated across surfaces because one property drawn in two sections is still one
   * answer to "is this here".
   */
  #matchCount(model: ElementModel, computed: CSSStyleDeclaration): number {
    const properties = new Set<string>();
    const consider = (property: string): void => {
      if (this.#hit(property, shownValue(model.cascade(property).applying[0]))) properties.add(property);
    };
    for (const section of SECTIONS.filter((section) => !section.when || section.when(computed))) {
      for (const property of section.properties) consider(property);
    }
    for (const property of SPACING_PROPERTIES) consider(property);
    for (const property of BORDER_PROPERTIES) consider(property);
    for (const property of model.appliedProperties()) consider(property);
    return properties.size;
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
    this.requestUpdate();
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

declare global {
  interface HTMLElementTagNameMap {
    'heo-styles-panel': HeoStylesPanel;
  }
}
