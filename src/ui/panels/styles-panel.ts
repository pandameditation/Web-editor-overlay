import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mediaIcon, mediaShort } from '../../core/breakpoints.js';
import { rulesPass, type ElementModel, type RuleEntry, type WriteTarget } from '../../core/cascade.js';
import {
  parentLayoutProperties,
  PROPERTY_GROUP_LABELS,
  searchProperties,
  sizeConstraints,
  type SizeConstraint,
} from '../../core/css.js';
import { splitImportant, toRecord } from '../../core/declaration-list.js';
import { normalizeProperty, propertyIsKnown } from '../../core/declarations.js';
import { labelFor, selectableParent } from '../../core/dom.js';
import { listen, unlisten } from '../../core/shield.js';
import { resolvesOffsets } from '../../core/transform.js';
import { normalizeClassName, simpleClassName } from '../../core/classes.js';
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
  renderBlockAdder,
  renderFamilyCard,
  renderInlineCard,
  renderUnknownCard,
  sourcesStyles,
  visibleAt,
  type CardView,
} from './styles/family-card.js';
import { renderCascadePopover, popoverStyles } from './styles/cascade-popover.js';
import { headerStyles, renderElementHeader } from './styles/header.js';
import { previewBarStyles, previewPresets, renderPreviewBar, SIZE_FIELD } from './styles/preview-bar.js';
import { renderSizeStrip, sizeStripStyles, stripMediaIssues, stripSizes } from './styles/size-strip.js';
import { menuStyles, placeLayer } from './styles/menu.js';
import { stylesDestination, type AdderDestination } from './styles/property-adder.js';
import {
  isViewportDependent,
  previewSlot,
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
import { classNameIssues, forkNameIssues, viewportSizeIssues } from '../../core/validation.js';
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
  effPick: null,
  popover: null,
  menu: null,
  adder: null,
  pending: null,
  finderOpen: false,
  sizeDraft: null,
  mediaDraft: null,
  otherSlots: new Map(),
  tab: 'all',
  cardPicks: new Map(),
  closedCards: new Set(),
  pendingStates: [],
  blockHint: null,
  detachOpen: null,
  forkDraft: '',
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
    headerStyles,
    previewBarStyles,
    sizeStripStyles,
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
  /** "Add a viewport size…" in the preview menu: a width the list does not have yet. */
  protected sizeForm = new FormErrors(this, () =>
    this.ui.sizeDraft === null
      ? []
      : viewportSizeIssues(
        SIZE_FIELD,
        this.ui.sizeDraft,
        previewPresets(this.editor.settings.value.viewportSizes).map((preset) => preset.width),
      ));
  /** "Add a media query…" in a strip's menu. */
  protected mediaForm = new FormErrors(this, () => stripMediaIssues(this.ui.mediaDraft?.text ?? null));
  /** The element whose size cap has already auto-opened the parent section. */
  #capsShownFor: HTMLElement | null = null;
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
      this.ui = {
        ...this.ui,
        popover: null,
        menu: null,
        adder: null,
        pending: null,
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
        pending: null,
        sizeDraft: null,
        pendingStates: [],
        blockHint: null,
      };
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
      // Placed against the whole bar or strip when it names one, so a menu opened from a small ⋮
      // gets the bar's width rather than spilling past the panel's edge.
      const place = root.querySelector(`[data-menu-place="${CSS.escape(menu.id)}"]`) ?? anchor;
      if (!anchor) this.ui = { ...this.ui, menu: null };
      else placeLayer(root.querySelector<HTMLElement>(`.menu[data-menu="${CSS.escape(menu.id)}"]`), place, { minWidth: 260 });
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
      mediaForm: this.mediaForm,
      toggleMenu: (id, open) => this.#toggleMenu(id, open),
      forkForm: this.forkForm,
      openCard: (key) => this.#openCard(key),
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
      openSource: (property, entry) => this.#openSource(property, entry),
    };
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
    if (!el || !el.isConnected) {
      return html`<div class="empty">
        Select an element on the page to edit its styles.<br />
        Arrow keys move the selection once something is selected.
      </div>`;
    }

    const computed = getComputedStyle(el);
    const model = this.#model(el);
    const host = this.#host(el, model);
    const found = host.filtering ? this.#matchCount(el, model, computed, host) : -1;
    const popover = this.ui.popover;
    const popoverOn = popover?.scope.kind === 'parent' && popover.scope.element !== el
      ? popover.scope.element
      : el;

    return html`
      ${selectionNotice(this.editor.selection.length, el)}
      ${renderElementHeader({
        element: el,
        finderOpen: this.ui.finderOpen,
        onToggleFinder: (open) => {
          this.classForm.reset();
          this.#patch({ finderOpen: open });
          this.#focusSelector(open ? '.ident .finder heo-value-field' : '.ident .cchip.add');
        },
        onOpenClass: (name) => this.#openCard(`.${CSS.escape(name)}`),
        onRemoveClass: (name) => this.editor.toggleClass(name, el),
        finder: this.#renderFinder(el),
      })}
      ${renderPreviewBar({
        engine: this.editor,
        previewWidth: host.previewWidth,
        breakpoints: model.breakpoints(),
        customSizes: this.editor.settings.value.viewportSizes,
        menuOpen: this.ui.menu?.id === 'preview',
        onMenu: (open) => this.#toggleMenu('preview', open),
        sizeDraft: this.ui.sizeDraft,
        sizeForm: this.sizeForm,
        onSizeDraft: (text) => this.#patch({ sizeDraft: text }),
        inShadowRoot: el.getRootNode() instanceof ShadowRoot,
      })}
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
      ${this.#renderSources(el, model, host)}
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
      ${this.#renderEffectiveStrip(model, host)}
      <div class="rows" data-declarations=${EFFECTIVE_LIST_ID}>
        ${own.map((property) =>
      renderPropertyRow({ property, scope: { kind: 'element' }, element: el, model, listId: EFFECTIVE_LIST_ID }, host))}
      </div>
      ${own.length ? nothing : html`<p class="hint" style="margin:0">
        ${filtering ? 'No property matches.' : 'Nothing declares anything for this element yet.'}
      </p>`}
      ${renderBlockAdder(host, EFFECTIVE_LIST_ID, this.#elementDestinations(el, model), '')}
      ${this.#renderSizeGroup(el, model, host)}
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
          ${renderBlockAdder(host, listId, this.#stateDestinations(el, model, group.state), group.state)}
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

  /** Open or close one of the panel's menus; closing hands focus back to what opened it. */
  #toggleMenu(id: string, open: boolean): void {
    this.sizeForm.reset();
    this.mediaForm.reset();
    this.#patch({ menu: open ? { id } : null, popover: null, sizeDraft: null, mediaDraft: null });
    this.#focusSelector(
      open ? `.menu[data-menu="${CSS.escape(id)}"] .mi` : `[data-menu-anchor="${CSS.escape(id)}"]`,
      open,
    );
  }

  /** The size Effective styles shows a group for: the hand pick, else the preview's slot. */
  #effectiveSlot(model: ElementModel, previewWidth: number | null, available: readonly string[]): string {
    const wanted = this.ui.effPick ?? previewSlot(model, previewWidth);
    return wanted === 'base' || available.includes(wanted) ? wanted : 'base';
  }

  /** Effective styles' sizes: what changes at each, counted from the rules reaching the element. */
  #effectiveSizes(model: ElementModel, previewWidth: number | null): ReturnType<typeof stripSizes> {
    return stripSizes(
      model,
      model.entries.filter((entry) => entry.state === ''),
      previewWidth,
      this.ui.otherSlots.get(EFFECTIVE_LIST_ID) ?? [],
    );
  }

  #renderEffectiveStrip(model: ElementModel, host: StylesHost): TemplateResult {
    const { slots, others } = this.#effectiveSizes(model, host.previewWidth);
    const picked = this.#effectiveSlot(model, host.previewWidth, [...slots, ...others].map((one) => one.key));
    const menuId = `strip-${EFFECTIVE_LIST_ID}`;
    return renderSizeStrip({
      owner: EFFECTIVE_LIST_ID,
      picked,
      baseCount: model.appliedProperties().length,
      baseTitle: 'What the element renders with now, every size included',
      slots,
      others,
      width: model.width,
      menuOpen: this.ui.menu?.id === menuId,
      mediaDraft: this.ui.mediaDraft?.owner === EFFECTIVE_LIST_ID ? this.ui.mediaDraft.text : null,
      mediaForm: this.mediaForm,
      // Picking the size already shown goes back to All sizes, so a size is a toggle here.
      onPick: (key) => this.#patch({ effPick: key === picked && key !== 'base' ? 'base' : key }),
      onMenu: (open) => this.#toggleMenu(menuId, open),
      onMediaDraft: (text) =>
        this.#patch({ mediaDraft: text === null ? null : { owner: EFFECTIVE_LIST_ID, text } }),
      onAddMedia: (media) => {
        // Only remembered here until a declaration is written at it: nothing empty is stored.
        const next = new Map(this.ui.otherSlots);
        next.set(EFFECTIVE_LIST_ID, [...new Set([...(next.get(EFFECTIVE_LIST_ID) ?? []), media])]);
        this.#patch({ otherSlots: next, effPick: `other:${media}` });
      },
    });
  }

  /**
   * The picked size, as a group under the element's rows: what the rules at that size declare,
   * read at that size's own width, and an adder that writes at it.
   */
  #renderSizeGroup(el: HTMLElement, model: ElementModel, host: StylesHost): TemplateResult | typeof nothing {
    const { slots, others } = this.#effectiveSizes(model, host.previewWidth);
    const picked = this.#effectiveSlot(model, host.previewWidth, [...slots, ...others].map((one) => one.key));
    if (picked === 'base') return nothing;
    const slot = model.slots().find((one) => one.key === picked) ?? null;
    const media = slot ? slot.media : picked.slice('other:'.length);
    const short = slot ? mediaShort(media) : `@media ${media}`;
    const scope: RowScope = { kind: 'size', slot: picked };
    const listId = `size-${picked}`;
    const names = new Set<string>();
    for (const entry of model.entries) {
      if (entry.state !== '' || model.slotOf(entry) !== picked) continue;
      for (const one of entry.declarations) names.add(one.property.toLowerCase());
    }
    const properties = [...names].sort().filter((property) => this.#hit(property, picked, short));
    const now = mediaApplies(media, null);
    return html`<div class="egroup" data-egroup=${`size:${picked}`}>
      <div class="egroup-h">
        ${icon(mediaIcon(media), 12)}
        <span class="sel">${short}</span>
        <span class="kind">size</span>
        <span class="note">${now ? `in effect at ${model.width}px` : `not at ${model.width}px`}</span>
      </div>
      <div class="rows" data-declarations=${listId}>
        ${properties.map((property) =>
          renderPropertyRow({ property, scope, element: el, model, listId }, host))}
      </div>
      ${properties.length
        ? nothing
        : html`<p class="hint" style="margin:0">Nothing changes at this size yet.</p>`}
      ${renderBlockAdder(host, listId, this.#sizeDestinations(el, model, picked, media, short), '')}
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
          `${reach} ${reach === 1 ? 'element' : 'elements'}`,
          entry ? { kind: 'target', target: entry.target } : { kind: 'new-rule', selector: family.key, media },
          entry ? toRecord(entry.declarations) : {},
          `${family.key} ${short}`,
        );
      }),
      stylesDestination(
        `a new class ${short}`,
        'this element only',
        { kind: 'auto-class', element: el, media, state: '' },
        {},
        `a new class ${short}`,
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
    if (userToggled.get('effective') === false) userToggled.delete('effective');
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
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(document, 'pointerdown', this.#onOutsidePress, true);
    unlisten(window, 'scroll', this.#onViewportChange, true);
    unlisten(window, 'resize', this.#onViewportChange);
    if (this.#scrollRoot) unlisten(this.#scrollRoot, 'scroll', this.#onViewportChange, true);
    this.#scrollRoot = null;
    this.removeEventListener('keydown', this.#onKeydown);
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
  /* Sources                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * The cards Sources shows, in its order: the element's classes in class-list order, then every
   * other family reaching it in file order (R17). Worked out once per render, because the badge,
   * the tabs, the search count and the section itself all read the same list.
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
   * Where the element's styles are written: its style attribute, its classes, every other rule
   * reaching it. Grouped by what they are rather than by specificity, which is Effective styles'
   * question; editing here changes the class or rule itself, for every element it styles.
   */
  #renderSources(el: HTMLElement, model: ElementModel, host: StylesHost): TemplateResult | typeof nothing {
    const { classes, others } = this.#sourceCards(el, model, host);
    const filtering = host.filtering;
    const tab = this.ui.tab;
    const inlineCount = model.inline.length ? 1 : 0;
    const inline = tab === 'all' || tab === 'inline' ? renderInlineCard(host) : nothing;
    const classCards = tab === 'all' || tab === 'classes'
      ? classes.map(({ name, view }) =>
        view
          ? renderFamilyCard(view, host, { group: 'classes' })
          : renderUnknownCard(name, host))
        .filter((card) => card !== nothing)
      : [];
    const otherCards = tab === 'all' || tab === 'rules'
      ? others.map((view) => renderFamilyCard(view, host, { group: 'rules' })).filter((card) => card !== nothing)
      : [];
    const empty = inline === nothing && !classCards.length && !otherCards.length;
    if (filtering && empty) return nothing;

    const tabs: Array<[typeof tab, string, number | null]> = [
      ['all', 'All', null],
      ['inline', 'Inline', inlineCount],
      ['classes', 'Classes', classes.length],
      ['rules', 'Rules', others.length],
    ];
    const pick = (next: typeof tab): void => {
      this.#patch({ tab: next });
      this.#focusSelector(`.src-tabs [data-tab="${next}"]`);
    };
    const badge = inlineCount + classes.length + others.length;
    const head = (label: string, count: number): TemplateResult =>
      html`<p class="src-h">${label} <span class="c">${count}</span><span class="rule-line"></span></p>`;

    return html`<heo-section
      heading="Sources"
      glyph="layers"
      badge=${badge ? String(badge) : ''}
      ?open=${filtering ? true : sectionOpen('sources', badge > 0)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#remember('sources', event.detail.open)}
    >
      <p class="hint" style="margin:0 0 8px">
        Where those styles are written. Editing here changes the class or rule itself.
      </p>
      <div
        class="src-tabs"
        role="tablist"
        aria-label="Show sources"
        @keydown=${(event: KeyboardEvent) => {
        const keys = tabs.map(([key]) => key);
        const at = keys.indexOf(tab);
        const to = event.key === 'ArrowRight'
          ? (at + 1) % keys.length
          : event.key === 'ArrowLeft'
            ? (at - 1 + keys.length) % keys.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? keys.length - 1
                : -1;
        if (to === -1) return;
        event.preventDefault();
        pick(keys[to]);
      }}
      >
        ${tabs.map(([key, label, count]) => html`<button
          type="button"
          role="tab"
          data-tab=${key}
          aria-selected=${tab === key ? 'true' : 'false'}
          tabindex=${tab === key ? '0' : '-1'}
          @click=${() => pick(key)}
        >
          ${label}${count === null ? nothing : html` <span class="c">${count}</span>`}
        </button>`)}
      </div>
      ${inline === nothing ? nothing : html`${head('Inline style', inlineCount)}${inline}`}
      ${tab === 'all' || tab === 'classes'
        ? classCards.length || !filtering
          ? html`${head('Classes', classes.length)}${classCards.length
            ? classCards
            : html`<p class="hint" style="margin:0">No classes yet. Add one with + at the top.</p>`}`
          : nothing
        : nothing}
      ${(tab === 'all' || tab === 'rules') && (otherCards.length || !filtering)
        ? html`${head('Other rules', others.length)}${otherCards}`
        : nothing}
      ${empty ? html`<p class="hint" style="margin:10px 0 0">Nothing here matches.</p>` : nothing}
      ${filtering
        ? nothing
        : html`<div class="actions">
            <button
              class="btn sm"
              type="button"
              data-act="paste"
              title="Paste CSS and choose where it goes: inline, a class, a rule, a size"
              @click=${() =>
            this.editor.beginCssPaste({
              context: 'rule',
              element: el,
              selector: this.editor.suggestedRuleSelector(el),
            })}
            >
              ${icon('clipboard', 12)} Paste CSS…
            </button>
          </div>`}
    </heo-section>`;
  }

  /**
   * Open a card where it is written, scroll it into view and flash it; with a property, focus that
   * declaration in the block at `slot` and `state`.
   *
   * Reached from the header's class names and from the popover's links. A hand-shut Sources
   * section or card gives way, and nothing is recorded as a hand pick of the section.
   */
  #openCard(key: string, options: { slot?: string; state?: string; property?: string } = {}): void {
    const el = this.editor.selected;
    const isClass = el ? Array.from(el.classList).some((name) => `.${name}` === key || `.${CSS.escape(name)}` === key) : false;
    const tab = this.ui.tab;
    const fits = tab === 'all' || (tab === 'classes' && isClass) || (tab === 'rules' && !isClass);
    const closed = new Set(this.ui.closedCards);
    closed.delete(key);
    const picks = new Map(this.ui.cardPicks);
    if (options.slot) picks.set(key, options.slot);
    if (userToggled.get('sources') === false) userToggled.delete('sources');
    this.#clearFilter();
    this.#patch({ popover: null, tab: fits ? tab : 'all', closedCards: closed, cardPicks: picks });
    void this.updateComplete.then(() => requestAnimationFrame(() => {
      const card = this.renderRoot.querySelector<HTMLElement>(`.cls[data-card="${CSS.escape(key)}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'nearest' });
      card.classList.remove('flash');
      // Restarted on a later frame, so a second open flashes again.
      requestAnimationFrame(() => card.classList.add('flash'));
      setTimeout(() => card.classList.remove('flash'), 1300);
      if (options.property) {
        focusDeclaration(this.renderRoot, options.property, blockId(key, options.slot ?? 'base', options.state ?? ''));
      } else {
        card.querySelector<HTMLElement>(':scope > header')?.focus({ preventScroll: true });
      }
    }));
  }

  /**
   * Where a popover line's link goes: the card the declaration is written in, at its size.
   *
   * A rule not in effect at the width being previewed is not on screen, so the preview goes back
   * to Actual first, and the card is picked only once the new width has cleared the old picks.
   */
  #openSource(property: string, entry: RuleEntry): void {
    this.#patch({ popover: null });
    const el = this.editor.selected;
    if (!el) return;
    const slot = this.#model(el).slotOf(entry);
    const open = (): void => this.#openCard(entry.family, { slot, state: entry.state, property });
    if (!visibleAt(entry, this.editor.store.value.previewWidth)) {
      this.editor.setPreviewWidth(null);
      void this.updateComplete.then(open);
    } else {
      open();
    }
  }

  /** The header's "find or create a class" field: today's finder, with its form and suggestions. */
  #renderFinder(el: HTMLElement): TemplateResult {
    return html`<heo-value-field
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
    host: StylesHost,
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
    // A card counts once as itself, whether its selector or one of its declarations matched.
    const { classes, others } = this.#sourceCards(el, model, host);
    const cards = classes.filter(({ name, view }) => (view ? view.shown : this.#hit(`.${name}`))).length +
      others.filter((view) => view.shown).length;
    return properties.size + cards;
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
