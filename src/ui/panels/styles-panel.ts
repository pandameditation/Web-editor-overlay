import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { isPseudoElement, isWidthQuery, mediaNow, needsGeneratedContent } from '../../core/breakpoints.js';
import {
  inlineDeclarations,
  rulesPass,
  stateTrigger,
  type CascadeContext,
  type CascadeList,
  type ElementModel,
  type WriteTarget,
} from '../../core/cascade.js';
import {
  escapeRegExp,
  parentLayoutProperties,
  PROPERTY_GROUP_LABELS,
  searchProperties,
  sizeConstraints,
  type SizeConstraint,
} from '../../core/css.js';
import { normalizeProperty, propertyIsKnown } from '../../core/declarations.js';
import { labelFor, selectableParent } from '../../core/dom.js';
import { listen, unlisten } from '../../core/shield.js';
import { resolvesOffsets } from '../../core/transform.js';
import { normalizeClassName, simpleClassName } from '../../core/classes.js';
import { reachText } from '../../core/save-plan.js';
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
  renderFamilyCard,
  renderInlineCard,
  renderUnknownCard,
  sourcesStyles,
  type CardView,
  type Popped,
} from './styles/family-card.js';
import { renderCascadePopover, popoverStyles } from './styles/cascade-popover.js';
import { headerStyles, renderElementHeader } from './styles/header.js';
import { CREATE_CLASS_TITLE, createClassLabel } from '../create-offer.js';
import {
  barConditions,
  conditionKey,
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
import { stylesDestination, valueStepDraft, type AdderPlaces } from './styles/property-adder.js';
import { cardArt, cardArtStyles, SHADOW_FLOOR } from './styles/card-art.js';
import {
  previewSlot,
  propertyRowStyles,
  previewChosen,
  readRow,
  renderPropertyRows,
  writeChosen,
  sameTarget,
  rowIdOf,
  rowPlace,
  shownValue,
  targetOf,
  renderPropertyRow,
  rowCondition,
  scopeContext,
  type RowPlace,
  type RowSpec,
} from './styles/property-row.js';
import { defaultPlace, inactivePlaces, placeOutcome, placesFor, type PlaceCondition } from '../../core/cascade-places.js';
import { NEW_CLASS_FIELD } from './styles/cascade-popover.js';
import type { RowScope, StylesHost, StylesUiState } from './styles/types.js';
import type { HeoValueField } from '../controls/value-field.js';
import '../controls/value-field.js';
import '../controls/search-field.js';
import type { SearchSuggestion } from '../controls/search-field.js';
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
import '../controls/background-editor.js';
import type { BackgroundFieldSpec } from '../controls/background-editor.js';
import {
  applyLonghand,
  BACKGROUND_LONGHANDS,
  composeBackground,
  composeBlend,
  composeLonghand,
  parseBackground,
  type Background,
} from '../../core/background.js';
import { compareContributions } from '../../core/cascade.js';
import { setContrastSubject } from '../contrast.js';
import '../controls/animation-editor.js';
import '../controls/transition-editor.js';
import type { TransitionTrigger, TriggerChange } from '../controls/transition-editor.js';
import { formatTransitions, readTransitions, timeMs, TRANSITION_PROPERTIES, type TransitionItem } from '../../core/transitions.js';
import type { SegmentOption } from '../controls/segmented.js';
import { shownTypographyRows } from './styles/typography.js';
import { proposedTextStyleName, textStyleDeclarations, TYPOGRAPHY_PROPERTIES, TYPOGRAPHY_SHORTHANDS } from '../../core/text-styles.js';
import { parseFamilies } from '../../core/fonts.js';
import '../controls/type-tuning.js';
import '../controls/text-style-dialog.js';
import type { DialogTextStyle } from '../controls/text-style-dialog.js';
import type { TuningValues } from '../controls/type-tuning.js';
import {
  ANIMATION_PROPERTIES,
  composeAnimation,
  readAnimation,
  type AnimationConfig,
} from '../../core/animations.js';
import type { Contribution } from '../../core/cascade.js';
import type { AddDestination } from '../../core/save-plan.js';
import '../controls/segmented.js';
import '../controls/section.js';
import { classNameIssues, forkNameIssues } from '../../core/validation.js';
import { mediaApplies } from '../../core/viewport.js';
import { field, FormErrors } from '../form-errors.js';

/**
 * What a card's list is worked out from: the element, its computed style under the condition
 * picked on the strip (the pseudo-element's own, under one), and the parent it sits in.
 */
interface CardContext {
  el: HTMLElement;
  computed: CSSStyleDeclaration;
  /** The pseudo-element picked on the strip, or ''. */
  pseudo: string;
  parent: HTMLElement | null;
}

/**
 * One category card. Its property list is fixed beforehand (decision 12): the card is where those
 * properties are edited, set or not, and Other holds whatever no card lists.
 */
interface CardSpec {
  id: string;
  heading: string;
  glyph: string;
  /** Its colour, an oklch hue: the tile, its picture and its head are drawn in it (CARD_ART). */
  hue: number;
  /** Every property it can hold: where the adder says a property shows, and what Other leaves to it. */
  all: readonly string[];
  /** What it lists for this element now, when not all of them: Flex rows only for a flex box. */
  properties?: (ctx: CardContext) => readonly string[];
  /** Only shown where this says. */
  when?: (ctx: CardContext) => boolean;
}

const FLEX_PROPERTIES = ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'row-gap', 'column-gap'];
const GRID_PROPERTIES = ['grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'grid-auto-rows', 'place-items', 'gap'];
const OFFSET_PROPERTIES = ['top', 'right', 'bottom', 'left'];

/**
 * What the Spacing card covers, named where the search can see it.
 *
 * Spacing is drawn by hand, because a box editor is not a list of rows — and the cost of that was
 * once a search that could not find `margin` or `padding` at all. Declaring the list here is what
 * lets the filter and the card agree about what is in it.
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
 * What the Border card covers, for the same reason as SPACING_PROPERTIES: it is drawn by hand.
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

/**
 * The longhands Spacing and Border draw as rows only where a block declares them on their own
 * (BORDER_PROPERTIES says why). Supplied by their shorthand there is no row of theirs to go to, so
 * the search offers to add one instead: "margin-top" taken while margin set it went to the card
 * and found only the margin row, with no way to give the side its own value.
 */
const ROWS_WHEN_DECLARED = new Set([
  ...SPACING_PROPERTIES.filter((property) => property.includes('-')),
  ...BORDER_PARTS,
  ...BORDER_SIDE_PROPERTIES,
]);

/** The Text style card's rows that are not its labelled typography rows: listed by name, as set. */
const TEXT_EXTRAS = ['white-space', ...TYPOGRAPHY_SHORTHANDS];

/**
 * The Layout card's line above its offset rows: the same four properties the page's own handles
 * write.
 *
 * Said here because the two are easy to mistake for alternatives, and they are not: a field is
 * how you say a number you already know, and dragging is how you find out which number you
 * meant. Whichever is used, the declaration that comes out is the same — and the drag keeps
 * the unit, so an offset written in percent is still in percent afterwards.
 */
const DRAG_NOTE = 'Or drag the element on the page. Shift keeps it on one axis.';

/**
 * The cards, in their one fixed order, set or not: Layout (with Position), Flex or Grid when the
 * element is one, Spacing, Size, Text style, Background, Border, Shadow & effects, Motion,
 * Interaction, In its parent, Other. Content leads, and only under a pseudo-element, where nothing
 * shows without it. A fixed order is what makes a card findable by where it is; sorting the set
 * ones first moved every card each time a value was added or removed.
 */
const CARDS: readonly CardSpec[] = [
  { id: 'content', heading: 'Content', glyph: 'pseudo', hue: 55, all: ['content', 'quotes'], when: (ctx) => Boolean(ctx.pseudo) },
  {
    id: 'layout',
    heading: 'Layout',
    glyph: 'panel',
    hue: 255,
    // Display stays a row: there is no display control to reuse (decision 13).
    all: ['display', 'overflow', 'position', ...OFFSET_PROPERTIES, 'z-index'],
    // The offsets only while they move the element: the same predicate the page's handles use, so
    // the rows and the handles are shown or hidden together by construction.
    properties: ({ computed }) => [
      'display',
      'overflow',
      'position',
      ...(resolvesOffsets(computed) ? OFFSET_PROPERTIES : []),
      'z-index',
    ],
  },
  // A flex or grid box's own properties, right after the display that makes it one.
  { id: 'flex', heading: 'Flex', glyph: 'columns', hue: 228, all: FLEX_PROPERTIES, when: (ctx) => ctx.computed.display.includes('flex') },
  { id: 'grid', heading: 'Grid', glyph: 'grid', hue: 228, all: GRID_PROPERTIES, when: (ctx) => ctx.computed.display.includes('grid') },
  { id: 'spacing', heading: 'Spacing', glyph: 'wrap', hue: 160, all: SPACING_PROPERTIES },
  {
    id: 'size',
    heading: 'Size',
    glyph: 'expand',
    hue: 200,
    all: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio', 'box-sizing'],
  },
  // Drawn by hand (#renderTypography): text styles, then the rows of typography/rows.ts.
  { id: 'typography', heading: 'Text style', glyph: 'text', hue: 285, all: [...TYPOGRAPHY_PROPERTIES, ...TEXT_EXTRAS] },
  // Drawn by hand, as the background editor and its rows (#renderBackground).
  { id: 'surface', heading: 'Background', glyph: 'droplet', hue: 330, all: ['background', ...BACKGROUND_LONGHANDS] },
  { id: 'border', heading: 'Border', glyph: 'frame', hue: 30, all: BORDER_PROPERTIES },
  {
    id: 'effects',
    heading: 'Shadow & effects',
    glyph: 'eye',
    hue: 70,
    // text-shadow is Text style's, beside the text it shades; cursor is Interaction's.
    all: ['opacity', 'box-shadow', 'filter', 'backdrop-filter', 'transform', 'mix-blend-mode'],
  },
  /*
   * Drawn by hand (#renderMotion): Animation (keyframes that play on their own) and Transition
   * (how a change of state plays), one at a time, each its editor then its declarations.
   */
  { id: 'motion', heading: 'Motion', glyph: 'play', hue: 305, all: [...TRANSITION_PROPERTIES, ...ANIMATION_PROPERTIES] },
  { id: 'interaction', heading: 'Interaction', glyph: 'cursor', hue: 100, all: ['cursor', 'pointer-events', 'user-select'] },
  /*
   * Drawn by hand (#renderParent): the element's own child properties, then why a size is capped,
   * then the parent's own controls (decision 1). Not under a pseudo-element, which is no child.
   */
  {
    id: 'child',
    heading: 'In its parent',
    glyph: 'moveOut',
    hue: 180,
    all: ['flex', 'align-self', 'order', 'grid-column', 'grid-row'],
    properties: ({ parent }) => [
      'flex',
      'align-self',
      'order',
      ...(parent && getComputedStyle(parent).display.includes('grid') ? ['grid-column', 'grid-row'] : []),
    ],
    when: (ctx) => Boolean(ctx.parent) && !ctx.pseudo,
  },
  // Whatever is set that no card lists, then "+ Add property" and "Paste CSS…".
  { id: 'other', heading: 'Other', glyph: 'code', hue: 240, all: [] },
];

/** The `data-declarations` id of a card's rows; In its parent keeps the list id it always had. */
function listOf(cardId: string): string {
  return cardId === 'child' ? 'parent-self' : cardId;
}

/** A card's heading, by id. */
function headingOf(cardId: string): string {
  return CARDS.find((card) => card.id === cardId)?.heading ?? 'Other';
}

/** The adder the search opens, drawn right under it (decision 14). */
const SEARCH_ADDER = 'search';
/** How many suggestions the search lists, and how many of them may be ones already set. */
const SUGGESTION_MAX = 8;
const SUGGESTION_SET_MAX = 5;

/** The panel's two views: Cards to edit by category, Applied to check everything set at once. */
const VIEWS: SegmentOption[] = [
  // Each drawn as what it shows: a grid of cards, a list of rows.
  { value: 'cards', label: 'Cards', icon: 'grid', title: 'Cards: edit by category' },
  { value: 'applied', label: 'Applied', icon: 'list', title: 'Applied: everything set on this element, as one list' },
];

/** The panel's condition strip: its id, for its menu and the conditions added to it. */
const PANEL_STRIP = 'panel';
/** On the panel's strip, pseudo-elements are conditions and sizes off the previewed width stay, dimmed. */
const STRIP_OPTIONS = { pseudo: 'condition', offWidth: 'dim' } as const;

/** The condition picked on the strip, as the scope every row and rich editor reads and writes under. */
function scopeOfCondition(key: string): RowScope {
  if (key === 'base') return { kind: 'element' };
  const { media, state } = conditionParts(key);
  if (!state) return { kind: 'size', slot: media };
  // A pseudo-element at no media reads any of its rules in effect now (readRow).
  if (isPseudoElement(state) && media === 'base') return { kind: 'state', state };
  return { kind: 'state', state, slot: media };
}

/**
 * The card a property shows in for this render: the first visible card listing it now, else
 * Other (which holds whatever is set that no card lists: an offset on a static element too).
 */
function landingOf(cards: CardRender, property: string): string {
  return cards.visible.find((card) => card.id !== 'other' && (cards.lists.get(card.id) ?? []).includes(property))?.id ?? 'other';
}

/** Everything one render's cards read: the condition's scope, the lists, and the shared lookups. */
interface CardRender {
  el: HTMLElement;
  model: ElementModel;
  host: StylesHost;
  computed: CSSStyleDeclaration;
  scope: RowScope;
  /** The cascade context of the scope: what the rich editors read their values under. */
  ctx: CascadeContext;
  cond: PlaceCondition;
  /** The state or pseudo-element picked, or ''. */
  state: string;
  pseudo: string;
  parent: HTMLElement | null;
  /** The cards shown, in order. */
  visible: readonly CardSpec[];
  /** Each shown card's properties now; Other's are what is set and no shown card lists. */
  lists: ReadonlyMap<string, readonly string[]>;
  /** The declaration a row of this property shows under the scope (readRow). */
  read(property: string): Contribution | undefined;
  cascade(property: string): CascadeList;
  spec(property: string, listId: string): RowSpec;
}
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
  cond: null,
  view: 'cards',
  popover: null,
  cardPop: null,
  places: new Map(),
  pendingImportant: new Set(),
  newClass: null,
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

/** The open cascade menu, among the panel's popovers. */
const CASCADE_POP = '.pop:not(.cardpop):not(.finderpop)';

/** Whether a node is inside a container, through the shadow roots between them. */
function composedContains(container: Node, node: Node): boolean {
  for (let at: Node | null = node; at; at = at instanceof ShadowRoot ? at.host : at.parentNode) {
    if (at === container) return true;
  }
  return false;
}

/** The focused element, through shadow roots. */
function deepActive(): Element | null {
  let node: Element | null = document.activeElement;
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
  return node;
}

/**
 * The style editor.
 *
 * One panel: the element's header, the condition strip (Element, its states, sizes and
 * pseudo-elements), then the element's styles in one of two views. Cards is a two-column grid of
 * categories, the ones set first, each opening in place on its rich editor and its fixed rows;
 * Applied is everything set at once, grouped the same way. Every property row is the same row with
 * the same edit path, read and written under the condition picked on the strip, and its name opens
 * the cascade ladder where the place an edit goes is picked.
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
    sizeStripStyles,
    searchPopoverStyles,
    sourcesStyles,
    cardArtStyles,
    css`
      :host {
        display: block;
        padding-bottom: 16px;
      }
      /* Typography: the text styles, each drawn in its own look. */
      .typestyles {
        display: grid;
        gap: 2px;
        margin-bottom: 10px;
      }
      .tgroup {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .tgroup::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--heo-line);
      }
      .tstyle {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 30px;
        padding: 4px 8px;
        border: 1px solid transparent;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .tstyle:hover {
        background: var(--heo-hover);
      }
      .tstyle[aria-current='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
      }
      .tstyle.mine {
        border-style: dashed;
        cursor: default;
      }
      .tstyle .p {
        overflow: hidden;
        max-height: 30px;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tstyle .m {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        text-align: right;
      }
      .tstyle.mine .m {
        color: var(--heo-accent-text);
      }
      .tactions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 4px;
      }
      heo-section > .more,
      .more {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin: 8px 0 6px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-accent-text);
        font: inherit;
        font-size: 11.5px;
        cursor: pointer;
      }

      /* The search, then the view switch on a line of its own, where it reads as the view. */
      .top {
        display: grid;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .top heo-search-field {
        min-width: 0;
      }
      .viewrow {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .viewrow heo-segmented.views {
        flex: 1 1 auto;
        min-width: 0;
      }
      /* The search's adder, right under it, above the cards it adds to. */
      .search-add {
        padding: 6px 12px 10px;
        border-bottom: 1px solid var(--heo-line);
      }

      /* The condition strip under the header, and its one line about the picked condition. */
      .cond {
        padding: 10px 12px 0;
      }
      .ctxline {
        margin: -2px 0 8px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .ctxline code {
        color: var(--heo-text);
        font-family: var(--heo-mono);
      }
      .ctxline .on {
        color: var(--heo-success-text);
      }
      .ctxline .off {
        color: var(--heo-warn-text);
      }

      /* Cards: a two-column grid of tiles; an open one takes the whole row, where it was. */
      .cards-view {
        padding: 10px 12px;
      }
      .glabel {
        margin: 12px 0 7px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .glabel:first-child {
        margin-top: 0;
      }
      .cats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .cats > heo-section[open] {
        grid-column: 1 / -1;
      }
      .cats > heo-section.flash {
        animation: heo-row-flash 1.2s ease-out;
      }
      .drag-note {
        margin: 0;
      }

      /* Applied: one list, grouped by card; a group's head goes to its card. */
      .applied {
        padding: 4px 0;
      }
      .agroup {
        padding: 2px 12px 10px;
        border-bottom: 1px solid var(--heo-line);
      }
      .agroup:last-child {
        border-bottom: 0;
      }
      .ahead {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        height: 32px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text-dim);
        text-align: left;
        cursor: pointer;
      }
      .ahead:hover {
        color: var(--heo-text);
      }
      .ahead:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .ahead .an {
        flex: 1 1 auto;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .ahead .gw {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .applied-none {
        margin: 0;
        padding: 12px;
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
  /** The cascade ladder's new-class name: checked when Enter picks the rung under that name. */
  protected newClassForm = new FormErrors(this, () => classNameIssues(NEW_CLASS_FIELD, this.ui.newClass?.name ?? ''));
  /** "Add a media query…" in a strip's menu. */
  protected mediaForm = new FormErrors(this, () => stripMediaIssues(this.ui.mediaDraft?.text ?? null));
  /** The element whose size cap has already auto-opened the In its parent card. */
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
        places: new Map(),
        pendingImportant: new Set(),
        newClass: null,
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
        cond: null,
        cardPicks: new Map(),
        // A place picked at one width is a question asked at that width.
        places: new Map(),
        pendingImportant: new Set(),
        newClass: null,
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
      else placeLayer(root.querySelector<HTMLElement>('.finderpop'), root.querySelector('.ident .line') ?? add, { gap: 6, source: add, beside: false });
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
      else placeLayer(root.querySelector<HTMLElement>('.cardpop'), anchor, { ...this.#cardPopFrame(), source: anchor, beside: false });
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
      newClassForm: this.newClassForm,
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
    // The preview size is the toolbar's now: the width is the page's, not the element's.
    if (!el || !el.isConnected) {
      return html`<div class="empty">
        Select an element on the page to edit its styles.<br />
        Arrow keys move the selection once something is selected.
      </div>`;
    }

    const model = this.#model(el);
    const host = this.#host(el, model);
    this.#syncOwnCards(el, model, host);
    const strip = this.#strip(model, host.previewWidth);
    const cards = this.#cardRender(el, model, host, strip.picked);
    const found = host.filtering ? this.#matchCount(cards) : -1;
    const popover = this.ui.popover;
    const popoverOn = popover?.scope.kind === 'parent' && popover.scope.element !== el
      ? popover.scope.element
      : el;

    return html`
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
      <div class="cond">
        ${this.#renderStrip(model, host, strip)}
        ${this.#renderContextLine(model, strip.picked, cards)}
      </div>
      <div class="top">
        <heo-search-field
          label="Search styles"
          placeholder="Search properties, values, selectors…"
          .value=${this.ui.filter}
          .count=${found}
          mode="suggest"
          .suggestions=${this.#suggestions(cards)}
          action=${this.#addLabel()}
          action-icon="plus"
          action-compact
          @search-input=${(event: CustomEvent<{ value: string }>) => this.#patch({ filter: event.detail.value })}
          @search-pick=${(event: CustomEvent<{ value: string }>) => this.#pickSuggestion(cards, event.detail.value)}
          @search-submit=${() => this.#openAdder(this.ui.filter.trim())}
        ></heo-search-field>
        <div class="viewrow">
          <heo-segmented
            class="views"
            size="lg"
            label="View"
            .options=${VIEWS}
            .value=${this.ui.view}
            @segment-change=${(event: CustomEvent<{ value: string }>) => {
        const view = event.detail.value;
        if (view === 'cards' || view === 'applied') this.#patch({ view });
      }}
          ></heo-segmented>
        </div>
      </div>
      ${this.ui.adder?.id === SEARCH_ADDER ? this.#renderSearchAdder(cards) : nothing}

      ${this.ui.view === 'applied' ? this.#renderApplied(cards) : this.#renderCards(cards)}
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
  /* The condition strip                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * The strip's chips and its pick: every condition a rule reaching the element declares under
   * (pseudo-elements included), plus one added from "+" and not written yet, and the pick itself
   * while it is empty (the size a preview follows). The pick is the hand pick, else the previewed
   * width's size (R13).
   */
  #strip(model: ElementModel, previewWidth: number | null): { chips: BarChip[]; picked: string } {
    const wanted = this.ui.cond ?? previewSlot(model, previewWidth);
    const { chips } = barConditions(
      model,
      model.entries,
      previewWidth,
      [...(this.ui.otherSlots.get(PANEL_STRIP) ?? []), wanted],
      STRIP_OPTIONS,
    );
    const picked = wanted !== 'base' && chips.some((chip) => chip.key === wanted) ? wanted : 'base';
    return { chips, picked };
  }

  #renderStrip(model: ElementModel, host: StylesHost, strip: { chips: BarChip[]; picked: string }): TemplateResult {
    const { chips, picked } = strip;
    const menuId = `strip-${PANEL_STRIP}`;
    const draft = this.ui.mediaDraft?.owner === PANEL_STRIP ? this.ui.mediaDraft : null;
    return renderConditionBar({
      owner: PANEL_STRIP,
      picked,
      alwaysLabel: 'Element',
      alwaysCount: model.appliedProperties().length,
      alwaysTitle: 'The element itself, as it renders now',
      chips,
      remaining: remainingConditions(model, chips.map((chip) => chip.key), host.previewWidth, picked, STRIP_OPTIONS),
      menuOpen: this.ui.menu?.id === menuId,
      mediaDraft: draft ? draft.text : null,
      widthDraft: draft ? draft.width ?? null : null,
      onWidthDraft: (width) => this.#patch({ mediaDraft: { owner: PANEL_STRIP, text: '', ...(width ? { width } : {}) } }),
      viewports: this.editor.viewports().filter((one) => one.shown),
      mediaForm: this.mediaForm,
      // A button is a toggle: the bar hands back `base` for the one already picked. An open adder
      // goes with the condition it was opened under: its ladder is that condition's places.
      onPick: (key) => this.#patch({ cond: key, adder: null }),
      onMenu: (open, refocus) => this.#toggleMenu(menuId, open, refocus),
      onMediaDraft: (text) => this.#patch({ mediaDraft: text === null ? null : { owner: PANEL_STRIP, text } }),
      // A size not in effect at the previewed width moves the preview to one it is (decision 3).
      onAdd: (key) => this.#showCondition(slotMedia(model, key), () => {
        // Only remembered here until a declaration is written under it: nothing empty is stored.
        const next = new Map(this.ui.otherSlots);
        next.set(PANEL_STRIP, [...new Set([...(next.get(PANEL_STRIP) ?? []), key])]);
        this.#patch({ otherSlots: next, cond: key });
      }),
      keyForMedia: (media) => mediaKeyFor(model, media),
      onRemove: (key) => removeCondition(host, {
        owner: PANEL_STRIP,
        key,
        entries: model.entries,
        pseudo: 'condition',
        onCleared: () => this.#patch({ cond: 'base' }),
      }),
    });
  }

  /** One line under the strip for the picked condition: what is being styled, and whether it shows now. */
  #renderContextLine(model: ElementModel, picked: string, cards: CardRender): TemplateResult | typeof nothing {
    if (picked === 'base') return nothing;
    const { state } = conditionParts(picked);
    const media = slotMedia(model, picked);
    const size = slotName(model, picked);
    const at = size ? html` at <code>${size}</code>` : nothing;
    if (state && isPseudoElement(state)) {
      const side = /before$/i.test(state) ? 'before' : /after$/i.test(state) ? 'after' : '';
      // A ::before or ::after with no content is not drawn at all, whatever else it is given.
      const empty = needsGeneratedContent(state) && !cards.read('content');
      return html`<p class="ctxline" data-ctx="pseudo">
        Styling <code>${state}</code>${at}, ${side ? `a box the browser draws ${side} the element’s content` : 'a part of the element the browser draws'}.${empty
          ? html` It shows nothing until it has <b>content</b>.`
          : nothing}
      </p>`;
    }
    if (state) {
      return html`<p class="ctxline" data-ctx="state">
        Showing the element on <code>${state}</code>${at}. What it does not set there is its value at rest.
      </p>`;
    }
    const applies = media !== null && mediaApplies(media, null);
    return html`<p class="ctxline" data-ctx="size">
      Styling at <code>${size}</code>${media !== null && isWidthQuery(media) ? html` (<code>@media ${media}</code>)` : nothing},
      <span class=${applies ? 'on' : 'off'}>${mediaNow(media ?? '', applies, model.width)}</span>.
    </p>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Cards and Applied                                                      */
  /* ---------------------------------------------------------------------- */

  /** What this render's cards read: the picked condition as a scope, and each card's list. */
  #cardRender(el: HTMLElement, model: ElementModel, host: StylesHost, picked: string): CardRender {
    const scope = scopeOfCondition(picked);
    const state = scope.kind === 'state' ? scope.state : '';
    const pseudo = isPseudoElement(state) ? state : '';
    // Under a pseudo-element, the pseudo-element's own computed style: its editors read what it draws.
    const computed = pseudo ? getComputedStyle(el, pseudo) : getComputedStyle(el);
    const parent = selectableParent(el);
    const ctx = scopeContext(scope, model);
    const shown = new Map<string, Contribution | undefined>();
    const spec = (property: string, listId: string): RowSpec => ({ property, scope, element: el, model, listId });
    const read = (property: string): Contribution | undefined => {
      if (!shown.has(property)) shown.set(property, readRow(spec(property, '')).shown);
      return shown.get(property);
    };
    const cardContext: CardContext = { el, computed, pseudo, parent };
    const visible = CARDS.filter((card) => !card.when || card.when(cardContext));
    const lists = new Map<string, readonly string[]>();
    const owned = new Set<string>();
    for (const card of visible) {
      if (card.id === 'other') continue;
      // A property is the first card's that lists it (gap is Flex's and Grid's, so Layout's once).
      const list = (card.properties ? card.properties(cardContext) : card.all).filter((property) => !owned.has(property));
      for (const property of list) owned.add(property);
      lists.set(card.id, list);
    }
    // Other: whatever is declared for the element, applies under the condition, and no card lists.
    const declared = new Set(model.inline.map((one) => one.property.toLowerCase()));
    for (const entry of model.entries) for (const one of entry.declarations) declared.add(one.property.toLowerCase());
    lists.set('other', [...declared].filter((property) => !owned.has(property) && read(property)).sort());
    // Under a text style, Text style's rows write the element's own style attribute (preferInline).
    const typeInline = Boolean(this.editor.textStyleOf(el));
    return {
      el,
      model,
      host,
      computed,
      scope,
      ctx,
      cond: rowCondition(scope),
      state,
      pseudo,
      parent,
      visible,
      lists,
      read,
      cascade: (property) => model.cascade(property, ctx),
      spec: (property, listId) => ({
        ...spec(property, listId),
        ...(typeInline && TYPOGRAPHY_PROPERTIES.includes(property) ? { preferInline: true } : {}),
      }),
    };
  }

  /** A card's properties that are set under the condition, and those declared by their own name. */
  #cardState(card: CardSpec, cards: CardRender): { set: string[]; own: string[] } {
    const list = cards.lists.get(card.id) ?? [];
    const set = list.filter((property) => cards.read(property));
    return { set, own: set.filter((property) => !cards.read(property)!.via) };
  }

  /**
   * Cards: every card in its one fixed order (CARDS), each a tile of a two-column grid that opens in
   * place across both columns. A card says by itself whether anything is set in it (its fill, count
   * and values, or an outline and "Empty"), so there is no "On this element" / "Not set yet" split:
   * that split reordered the grid whenever a value came or went, and moved a card being edited to
   * the other group, a new element, losing the editor or list open in it. While searching, the
   * cards with something that matches, open.
   */
  #renderCards(cards: CardRender): TemplateResult {
    const drawn = cards.visible.map((card) => ({ card, ...this.#cardState(card, cards) }));
    const shown = drawn
      .map((one) => ({ id: one.card.id, card: this.#renderCard(one, cards) }))
      .filter((one): one is { id: string; card: TemplateResult } => one.card !== null);
    return html`<div class="cards-view" data-view="cards">
      ${shown.length
        ? html`<div class="cats" data-cards="all">${repeat(shown, (one) => one.id, (one) => one.card)}</div>`
        : nothing}
    </div>`;
  }

  /** One card: a tile while closed (its picture, name, count and first values), its body open. */
  #renderCard(one: { card: CardSpec; set: string[]; own: string[] }, cards: CardRender): TemplateResult | null {
    const { card, set, own } = one;
    const open = this.#cardOpen(card, cards);
    const body = this.#cardBody(card, cards, open);
    if (cards.host.filtering && body === nothing) return null;
    const valuesOf = (list: readonly string[]): string => list
      .slice(0, 3)
      .map((property) => (cards.read(property)?.value ?? '').split(/,(?![^(]*\))/)[0]!.trim())
      .filter(Boolean)
      .join(' · ');
    return html`<heo-section
      card
      class=${set.length ? 'set' : 'unset'}
      style=${styleMap({ '--h': String(card.hue), ...(card.id === 'effects' ? { '--art-bg': SHADOW_FLOOR } : {}) })}
      data-card=${card.id}
      heading=${card.heading}
      glyph=${card.glyph}
      badge=${own.length ? String(own.length) : ''}
      summary=${valuesOf(own) || valuesOf(set)}
      ?empty=${!set.length}
      ?open=${open}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#remember(card.id, event.detail.open)}
    >
      ${cardArt(card.id)}
      ${body}
    </heo-section>`;
  }

  /**
   * Whether a card is open: every card with a match while searching; else as the user left it,
   * closed by default. In its parent opens itself the first time a cap turns up for this element:
   * it is the answer to a question the user is actively asking ("I set a bigger width and nothing
   * happened"). Recorded in the session map rather than forced, so closing it still sticks.
   */
  #cardOpen(card: CardSpec, cards: CardRender): boolean {
    if (cards.host.filtering) return true;
    if (card.id === 'child' && this.#capsShownFor !== cards.el && this.#caps(cards.el).length) {
      this.#capsShownFor = cards.el;
      userToggled.set('child', true);
    }
    return sectionOpen(card.id, false);
  }

  #cardBody(card: CardSpec, cards: CardRender, open: boolean): TemplateResult | typeof nothing {
    switch (card.id) {
      case 'spacing':
        return this.#renderSpacing(cards);
      case 'border':
        return this.#renderBorder(cards);
      case 'surface':
        return this.#renderBackground(cards);
      case 'motion':
        return this.#renderMotion(cards);
      case 'typography':
        return this.#renderTypography(cards);
      case 'child':
        return this.#renderParent(cards, open);
      case 'other':
        return this.#renderOther(cards);
      default:
        return this.#renderRows(card, cards);
    }
  }

  /** A card of rows only (Layout, Size, Position, Shadow & effects, Interaction, Content). */
  #renderRows(card: CardSpec, cards: CardRender): TemplateResult | typeof nothing {
    const { host } = cards;
    const properties = (cards.lists.get(card.id) ?? []).filter((property) =>
      this.#matches(cards, property));
    // Searched and nothing here matches: the card goes rather than standing open and empty.
    if (!properties.length) return nothing;
    const listId = listOf(card.id);
    const rows = (list: readonly string[]): TemplateResult | typeof nothing =>
      list.length ? renderPropertyRows(list, (property) => cards.spec(property, listId), host) : nothing;
    const offsets = properties.filter((property) => OFFSET_PROPERTIES.includes(property));
    // The drag note is about the element's own offsets on the page: at Element, above those rows.
    if (card.id === 'layout' && offsets.length && cards.scope.kind === 'element') {
      // Layout's own rows up to position, the note, the offsets it explains, then the rest (z-index).
      const rest = properties.filter((property) => !offsets.includes(property));
      const lead = rest.slice(0, rest.indexOf('position') + 1);
      return html`<div class="rows" data-declarations=${listId}>
        ${rows(lead)}
        <p class="hint drag-note" data-drag-note>${DRAG_NOTE}</p>
        ${rows(offsets)}
        ${rows(rest.slice(lead.length))}
      </div>`;
    }
    return html`<div class="rows" data-declarations=${listId}>${rows(properties)}</div>`;
  }

  /**
   * Other: what is set and no card lists, then "+ Add property" (the one adder of the cards, its
   * value step the ladder for the picked condition) and "Paste CSS…" (decision 15).
   */
  #renderOther(cards: CardRender): TemplateResult | typeof nothing {
    const { el, host } = cards;
    const properties = (cards.lists.get('other') ?? []).filter((property) =>
      this.#matches(cards, property));
    if (host.filtering && !properties.length) return nothing;
    return html`
      ${properties.length
        ? html`<div class="rows" data-declarations="other">
            ${renderPropertyRows(properties, (property) => cards.spec(property, 'other'), host)}
          </div>`
        : nothing}
      ${host.filtering
        ? nothing
        : html`${renderBlockAdder(host, 'other', [], cards.state, { places: this.#adderPlaces(cards) })}
          <div class="actions">
            <button
              class="btn sm"
              type="button"
              data-act="paste"
              title="Paste CSS and choose whether it belongs inline, in a class, or in a rule"
              @click=${() => this.editor.beginCssPaste(this.#pasteOptions(el, { context: 'inline', element: el }))}
            >
              ${icon('clipboard', 12)} Paste CSS…
            </button>
          </div>`}`;
  }

  /**
   * Applied: everything set under the condition at once, one list grouped by card in the cards'
   * order, each property once. A group's heading goes to its card in Cards, where it is edited
   * with its editor.
   */
  #renderApplied(cards: CardRender): TemplateResult {
    const { host } = cards;
    const groups = cards.visible
      .map((card) => ({
        card,
        properties: this.#cardState(card, cards).own.filter((property) =>
          this.#matches(cards, property)),
      }))
      .filter((group) => group.properties.length);
    if (!groups.length) {
      return html`<p class="hint applied-none">
        ${host.filtering ? 'Nothing set matches.' : 'Nothing is set for this element yet.'}
      </p>`;
    }
    return html`<div class="applied" data-view="applied">
      ${groups.map(({ card, properties }) => html`<div class="agroup" data-applied=${card.id}>
        <button
          class="ahead"
          type="button"
          data-applied-group=${card.id}
          title=${`Edit in the ${card.heading} card`}
          @click=${() => this.#goToCard(card.id)}
        >
          ${icon(card.glyph, 12)}
          <span class="an">${card.heading}</span>
          <span class="gw">${properties.length}</span>
          ${icon('chevronRight', 10)}
        </button>
        <div class="rows" data-declarations=${listOf(card.id)}>
          ${renderPropertyRows(properties, (property) => cards.spec(property, listOf(card.id)), host)}
        </div>
      </div>`)}
    </div>`;
  }

  /** From Applied to a card: Cards, that card open, scrolled to and flashed, its head focused. */
  #goToCard(id: string): void {
    userToggled.set(id, true);
    this.#patch({ view: 'cards', popover: null, menu: null });
    void this.updateComplete.then(() => requestAnimationFrame(() => {
      const card = this.renderRoot.querySelector<HTMLElement>(`heo-section[data-card="${CSS.escape(id)}"]`);
      if (!card) return;
      card.scrollIntoView({ block: 'nearest' });
      card.classList.remove('flash');
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1300);
      card.shadowRoot?.querySelector<HTMLElement>('.head')?.focus({ preventScroll: true });
    }));
  }

  /** Open or close one of the panel's menus; closing hands focus back to what opened it. */
  #toggleMenu(id: string, open: boolean, refocus = true): void {
    this.mediaForm.reset();
    this.#patch({ menu: open ? { id } : null, popover: null, mediaDraft: null });
    // A search popover is focused at its field; a menu at its first item.
    const inside = ':is(heo-value-field, .mi)';
    if (open || refocus) this.#focusSelector(
      open ? `.menu[data-menu="${CSS.escape(id)}"] ${inside}` : `[data-menu-anchor="${CSS.escape(id)}"]`,
      open,
    );
  }

  /**
   * What an element adder offers under a condition, for the property being added: the ladder's
   * places (cascade-places.ts), strongest first, the default pick (inline at Element, the
   * element's own class under a condition) and what a value at each would do.
   */
  #adderPlaces(cards: CardRender): (property: string) => AdderPlaces {
    const { el, model, cond } = cards;
    const ownedClass = (name: string) => this.editor.classes.get(name) ?? null;
    return (property) => {
      const list = placesFor(model, property, cond, el, { ownedClass });
      return {
        list,
        inactive: inactivePlaces(model, property, cond),
        owner: headingOf(landingOf(cards, property)),
        fallback: defaultPlace(model, el, cond, list).key,
        outcome: (place, important) => placeOutcome(model, property, cond, place, important),
      };
    };
  }

  /**
   * Open the adder under the search, seeded with what was being looked for: at its name step
   * (the search's Add, the no-match offers), or at the value step of a property picked from the
   * suggestions, whose name is already settled.
   *
   * Searching for a property and not finding it is the most common way somebody arrives at wanting
   * to add one, so the query carries over as the draft. The search is cleared on the way: adders
   * are hidden while it narrows the panel, and the question it asked has been answered.
   */
  #openAdder(seed = '', valueStep = false): void {
    const property = normalizeProperty(seed);
    this.#clearFilter();
    this.adderForm.reset();
    this.#patch({
      adder: { id: SEARCH_ADDER, draft: valueStep && property ? valueStepDraft(property) : property, dest: '' },
      menu: null,
      popover: null,
    });
    this.#focusSelector(`.property-adder[data-adder="${SEARCH_ADDER}"] heo-value-field`);
  }

  /**
   * The search's adder: today's one adder (name, then the ladder for the picked condition), drawn
   * under the search while it is open. A declaration is not shown here once written: it goes to
   * the card that lists its property, or to Other, opened and flashed there.
   */
  #renderSearchAdder(cards: CardRender): TemplateResult | typeof nothing {
    const added = renderBlockAdder(cards.host, SEARCH_ADDER, [], cards.state, {
      places: this.#adderPlaces(cards),
      // It opened from the search: Cancel goes back there.
      cancelFocus: '.top heo-search-field',
      onAdded: (hint, property) => {
        if (hint) this.editor.notify(hint, 'info');
        this.#goToRow(property, landingOf(cards, property));
      },
    });
    return added === nothing ? nothing : html`<div class="search-add">${added}</div>`;
  }

  /**
   * What the search suggests for its text (the part before a colon, for "property: value"): the
   * properties set under the condition that match, to go to, then properties to add, each saying
   * the card it would show in. Empty text lists what is set, then the common ones: the list the
   * field's chevron promises.
   */
  #suggestions(cards: CardRender): SearchSuggestion[] {
    const needle = this.ui.filter.split(':')[0]!.trim().toLowerCase();
    const set = new Set<string>();
    for (const card of cards.visible) {
      for (const property of cards.lists.get(card.id) ?? []) if (this.#hasSetRow(cards, property)) set.add(property);
    }
    const goTo = [...set]
      .filter((property) => property.includes(needle))
      // Names starting with the text first, as searchProperties ranks them.
      .sort((a, b) => Number(b.startsWith(needle)) - Number(a.startsWith(needle)))
      .slice(0, SUGGESTION_SET_MAX);
    const add = searchProperties(needle, SUGGESTION_MAX * 3)
      .map((meta) => meta.name)
      .filter((property) => !set.has(property))
      .slice(0, SUGGESTION_MAX - goTo.length);
    return [
      ...goTo.map((property) => ({ value: property, hint: 'set · go to it', group: 'Set on this element' })),
      ...add.map((property) => {
        // A side its shorthand sets now: added, it gets its own declaration, over the shorthand's.
        const via = cards.read(property)?.via;
        return { value: property, hint: `add · ${headingOf(landingOf(cards, property))}${via ? ` · now from ${via}` : ''}`, group: 'Add' };
      }),
    ];
  }

  /** Whether a property is set and has a row of its own to go to (ROWS_WHEN_DECLARED). */
  #hasSetRow(cards: CardRender, property: string): boolean {
    const shown = cards.read(property);
    return Boolean(shown) && !(shown!.via && ROWS_WHEN_DECLARED.has(property));
  }

  /** A suggestion taken: a set property is gone to in its card; an unset one opens its value step. */
  #pickSuggestion(cards: CardRender, value: string): void {
    const property = normalizeProperty(value);
    if (!property) return;
    if (this.#hasSetRow(cards, property)) {
      this.#clearFilter();
      this.#goToRow(property, landingOf(cards, property));
    } else this.#openAdder(property, true);
  }

  /**
   * To a property's row in its card: Cards, the card opened, the row scrolled to and flashed, and
   * focus on its name (the cascade menu's opener), so the keyboard arrives where the eye does.
   */
  #goToRow(property: string, cardId: string): void {
    userToggled.set(cardId, true);
    this.#patch({ view: 'cards', menu: null, popover: null });
    this.#flashRow(property, listOf(cardId), true);
  }

  /* ---------------------------------------------------------------------- */
  /* Focus and the layers                                                   */
  /* ---------------------------------------------------------------------- */

  /** Flash a property's row in one list once the next render has landed: where an add landed. */
  #flashRow(property: string, listId: string, reveal = false): void {
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
        if (!reveal) return;
        row?.scrollIntoView({ block: 'nearest' });
        row?.querySelector<HTMLElement>('.dots')?.focus({ preventScroll: true });
      }),
    );
  }

  /**
   * Focus a control once the next render has landed. A value field or the search takes the caret
   * in its input.
   * `onlyFromKeyboard` leaves focus where it is unless it was on the control that asked.
   */
  #focusSelector(selector: string, onlyFromKeyboard = false): void {
    const from = onlyFromKeyboard ? (this.renderRoot as ShadowRoot).activeElement : null;
    if (onlyFromKeyboard && (!from || from.localName === 'input')) return;
    void this.updateComplete.then(() =>
      requestAnimationFrame(() => {
        const found = this.renderRoot.querySelector<HTMLElement>(selector);
        if (!found) return;
        // A value field, or the search, takes the caret in its input: neither host is focusable.
        if (found.localName === 'heo-value-field') (found as HeoValueField).focusInput();
        else if (found.localName === 'heo-search-field') (found as HTMLElement & { focusInput(): void }).focusInput();
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
    const path = event.composedPath();
    const root = this.renderRoot;
    /*
     * Tabbing out of the cascade menu closes it, as the value lists and the class finder close:
     * left open, it sat over the rows the focus had moved on to, pointing at a row no longer
     * being edited. Read a frame later, once focus has landed: a move between the menu's own
     * controls, or back to the name that opened it, keeps it. Focus dropped onto nothing is the
     * other case below, which puts it back on the name.
     */
    const popover = this.ui.popover;
    // Not by relatedTarget: focus moving from one shadow root's field to another's reads as null.
    if (popover) {
      // The cascade menu: the class finder and the card popovers are pops too.
      const layer = root.querySelector(CASCADE_POP);
      const opener = root.querySelector(`.row[data-row="${CSS.escape(popover.rowId)}"] .dots`);
      if ((layer && path.includes(layer)) || (opener && path[0] === opener)) {
        requestAnimationFrame(() => {
          if (this.ui.popover?.rowId !== popover.rowId) return;
          const active = deepActive();
          if (!active || active === document.body) return;
          const now = root.querySelector(CASCADE_POP);
          const by = root.querySelector(`.row[data-row="${CSS.escape(popover.rowId)}"] .dots`);
          if ((now && composedContains(now, active)) || active === by) return;
          this.#patch({ popover: null });
        });
      }
    }
    if (event.relatedTarget) return;
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
      // Else a card's button: focus is in the panel, where Backspace is not a page key.
      else root.querySelector('heo-section')?.shadowRoot?.querySelector<HTMLElement>('.head, .tile')?.focus({ preventScroll: true });
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
    // The colour picker measures contrast for the element this panel is editing.
    setContrastSubject(() => this.editor.selected ?? null);
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
    setContrastSubject(null);
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
   * it outright. They edit the parent's own rules at rest, which a state or a size
   * picked on the strip does not reach, so they are drawn at Element only.
   */
  #renderParent(cards: CardRender, open: boolean): TemplateResult | typeof nothing {
    const { el, host, parent } = cards;
    const filtering = host.filtering;
    const own = (cards.lists.get('child') ?? []).filter((property) => this.#matches(cards, property));
    // The parent's own controls and the cap notices are about the parent, and the field says
    // "search styles" of this element — so while filtering this card is its matching rows or nothing.
    if (filtering && !own.length) return nothing;
    const caps = filtering ? [] : this.#caps(el);
    return html`
      ${caps.map((cap) => this.#renderConstraint(cap))}
      <div class="rows" data-declarations="parent-self">
        ${renderPropertyRows(own, (property) => cards.spec(property, 'parent-self'), host)}
      </div>
      ${!filtering && parent && open && cards.scope.kind === 'element'
        // The parent's model is built only when the card is open to show it.
        ? this.#renderParentControls(parent, host)
        : nothing}`;
  }

  /** The ancestors capping the element's width or height: why a size set on it is not what it gets. */
  #caps(el: HTMLElement): SizeConstraint[] {
    return [...sizeConstraints(el, 'width'), ...sizeConstraints(el, 'height')].filter((cap) => cap.binding);
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
    // The search row spans the panel's column, as the sections under it once did.
    const place = this.renderRoot.querySelector('.top');
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
   * Searchable, which it once was not: the box editor is a diagram, not a list of rows, so this
   * card is written by hand, and the filter used to look only at the sections' lists, so the two
   * most-reached-for properties in CSS could not be found by typing their names (SPACING_PROPERTIES
   * fixed that). The card narrows itself instead: the box editor stays for any spacing query,
   * since it is the editor for all eight sides at once, and the shorthand rows come and go with
   * the query like every other row.
   *
   * The box commits a batch, which follows the same rule as one row: inline unless one of its
   * sides depends on the viewport, in which case one box asks where the whole batch should stay.
   */
  #renderSpacing(cards: CardRender): TemplateResult | typeof nothing {
    const { el, model, computed, host, scope } = cards;
    const longhands = SPACING_PROPERTIES.filter((property) => property.includes('-'));
    const declaredBox: Record<string, string> = {};
    for (const property of longhands) declaredBox[property] = shownValue(cards.cascade(property).applying[0]);
    const computedBox: Record<string, string> = { width: computed.width, height: computed.height };
    for (const property of longhands) computedBox[property] = computed.getPropertyValue(property);

    const hits = SPACING_PROPERTIES.filter((property) =>
      this.#matches(cards, property),
    );
    if (!hits.length) return nothing;
    // The shorthands, and each side declared for this element, under its shorthand: written in the
    // same block they are one family, with its control for which comes last.
    const shorthands = ['margin', 'padding'].filter((property) => hits.includes(property));
    const rowsShown = shorthands.flatMap((shorthand) => [
      shorthand,
      ...longhands.filter((side) => side.startsWith(`${shorthand}-`) && hits.includes(side) &&
        cards.cascade(side).applying.some((one) => !one.via)),
    ]);

    return html`
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
        : nothing}`;
  }

  /**
   * A box-editor batch, as one undo entry: each side where its value is written now, or where its
   * editor's switch says, the same as a row (its value list carries the switch).
   */
  #commitBox(declarations: Record<string, string>, scope: RowScope, el: HTMLElement, model: ElementModel, host: StylesHost): void {
    const writes = Object.entries(declarations).map(([property, value]) => {
      const spec: RowSpec = { property, scope, element: el, model, listId: 'spacing' };
      const choice = rowPlace(spec, host, rowIdOf(scope, property, el));
      return { property, value, choice };
    });
    this.editor.writeDeclarationsTo(
      writes.map(({ property, value, choice }) => ({
        dest: choice.picked.dest,
        property,
        value,
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
  #renderBorder(cards: CardRender): TemplateResult | typeof nothing {
    const { el, model, computed, host, scope, ctx } = cards;
    const hits = BORDER_PROPERTIES.filter((property) =>
      this.#matches(cards, property));
    if (!hits.length) return nothing;
    const specOf = (property: string): RowSpec => ({ property, scope, element: el, model, listId: 'border' });
    const choiceOf = (property: string) => {
      const spec = specOf(property);
      const { shown } = readRow(spec);
      return { spec, shown, choice: rowPlace(spec, host, rowIdOf(scope, property, el)) };
    };

    const lines = { border: this.#lineView('border', model, computed, ctx), outline: this.#lineView('outline', model, computed, ctx) };
    const fields: Record<string, BorderFieldSpec> = {};
    for (const kind of BORDER_SHORTHANDS) {
      for (const part of LINE_PARTS) {
        fields[`${kind}-${part}`] = { suggestions: buildSuggestions(this.editor, `${kind}-${part}`, el) };
      }
    }
    fields['border-radius'] = { suggestions: buildSuggestions(this.editor, 'border-radius', el) };
    fields['outline-offset'] = { suggestions: buildSuggestions(this.editor, 'outline-offset', el) };
    const radius = { value: shownValue(cards.cascade('border-radius').applying[0]), computed: computed.borderRadius };
    const offset = { value: shownValue(cards.cascade('outline-offset').applying[0]), computed: computed.outlineOffset };

    // Each shorthand, then the parts a block declares on their own (a real declaration to show):
    // the border's, each side's family, the outline's, and its offset.
    const own = (property: string): boolean => cards.cascade(property).applying.some((one) => !one.via);
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
        this.#commitEdge(edgeWrites(line.side, line.part, value), choiceOf('border').choice, el, model, ctx, `Set border-${line.side}`);
        return;
      }
      this.#commitLine(line.kind, composeLine(this.#lineBase(lines[line.kind]), line.part, value), choiceOf(line.kind).choice, el, model, ctx);
    };
    const reset = (side: Side): void => {
      const writes = Object.fromEntries([`border-${side}`, ...LINE_PARTS.map((part) => `border-${side}-${part}`)].map((name) => [name, '']));
      this.#commitEdge(writes, choiceOf('border').choice, el, model, ctx, `Reset border-${side}`);
    };

    return html`
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
        : nothing}`;
  }

  /**
   * One line as the editor shows it: each part as written, read through whichever declaration
   * supplies it (the part's own, or the shorthand's text), and the parts the page draws.
   */
  #lineView(kind: LineKind, model: ElementModel, computed: CSSStyleDeclaration, ctx: CascadeContext): LineView {
    const parts: LineParts = { width: '', style: '', color: '' };
    let token = '';
    for (const part of LINE_PARTS) {
      const winner = model.cascade(`${kind}-${part}`, ctx).applying[0];
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
    const edges = Object.fromEntries(SIDES.map((side): [Side, EdgeView] => [side, this.#edgeView(side, model, computed, ctx)])) as Record<Side, EdgeView>;
    return { parts, token, computed: drawn, mixed, edges };
  }

  /**
   * One side as the editor shows it: the parts it declares for itself, by its longhand or through
   * its own shorthand (`border-bottom`), and not those it takes from `border` or `border-width`.
   */
  #edgeView(side: Side, model: ElementModel, computed: CSSStyleDeclaration, ctx: CascadeContext): EdgeView {
    const parts: LineParts = { width: '', style: '', color: '' };
    const drawn: LineParts = { width: '', style: '', color: '' };
    for (const part of LINE_PARTS) {
      const property = `border-${side}-${part}`;
      drawn[part] = computed.getPropertyValue(property).trim();
      const winner = model.cascade(property, ctx).applying[0];
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
    choice: RowPlace,
    el: HTMLElement,
    model: ElementModel,
    ctx: CascadeContext,
    label: string,
  ): void {
    const dest = choice.picked.dest;
    if (!dest) return;
    this.editor.cancelPreview();
    const into = dest.kind === 'target' ? dest.target : null;
    const declaredHere = (property: string): boolean => Boolean(into) &&
      model.cascade(property, ctx).applying.some((one) => !one.via && sameTarget(targetOf(one, el), into!));
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
  #commitLine(kind: LineKind, value: string, choice: RowPlace, el: HTMLElement, model: ElementModel, ctx: CascadeContext): void {
    const dest = choice.picked.dest;
    if (!dest) return;
    this.editor.cancelPreview();
    const into = dest.kind === 'target' ? dest.target : null;
    const folded = into
      ? LINE_PARTS.map((part) => `${kind}-${part}`).filter((property) =>
        model.cascade(property, ctx).applying.some((one) =>
          !one.via && sameTarget(targetOf(one, el), into)))
      : [];
    this.editor.writeDeclarationsTo(
      [
        { dest, property: kind, value, remove: !value },
        ...folded.map((property) => ({ dest, property, value: '', remove: true })),
      ],
      value ? `Set ${kind}` : `Remove ${kind}`,
      el,
    );
  }

  /**
   * Background: the layers editor, plus `background` and any longhand a block declares on its own
   * as rows, the way the Border section lists its parts.
   *
   * The editor reads the background as layers over a colour and writes it back as one shorthand
   * where the `background` row writes, folding away the longhands the same block declares, and
   * `background-blend-mode` beside it, which the shorthand cannot carry. A change to the colour alone,
   * in a block with no shorthand, stays the `background-color` it was.
   */
  #renderBackground(cards: CardRender): TemplateResult | typeof nothing {
    const { el, model, computed, host, scope, ctx } = cards;
    const properties = ['background', ...BACKGROUND_LONGHANDS];
    const hits = properties.filter((property) => this.#matches(cards, property));
    if (!hits.length) return nothing;
    const specOf = (property: string): RowSpec => ({ property, scope, element: el, model, listId: 'surface' });
    const choiceOf = (property: string) => {
      const spec = specOf(property);
      const { shown } = readRow(spec);
      return { spec, shown, choice: rowPlace(spec, host, rowIdOf(scope, property, el)) };
    };
    const value = this.#backgroundView(model, ctx);
    const fields: Record<string, BackgroundFieldSpec> = {};
    for (const property of BACKGROUND_LONGHANDS) {
      fields[property] = { suggestions: buildSuggestions(this.editor, property, el) };
    }
    const own = (property: string): boolean => cards.cascade(property).applying.some((one) => !one.via);
    const rowsShown = ['background', ...BACKGROUND_LONGHANDS.filter(own)].filter((property) => hits.includes(property));

    /*
     * A background a block writes as longhands (background-image: a gradient, with its colour and
     * size beside it) is edited as those longhands, where they are: written as a shorthand at the
     * background row's place instead, the gradient went inline over the rule, and the longhand
     * rows went on showing the rule's old values, as though the editor had changed nothing.
     */
    const image = cards.cascade('background-image').applying[0];
    const asLonghands = Boolean(image && !image.via);
    const changedLonghands = (next: Background): string[] =>
      BACKGROUND_LONGHANDS.filter((property) => composeLonghand(next, property) !== composeLonghand(value, property));
    const placeOfLonghand = (property: string) => choiceOf(own(property) ? property : 'background-image');

    const preview = (next: Background): void => {
      if (asLonghands) {
        const property = changedLonghands(next)[0] ?? 'background-image';
        const { spec, choice } = placeOfLonghand(property);
        previewChosen(host, spec.property === property ? spec : { ...spec, property }, choice.picked, composeLonghand(next, property));
        return;
      }
      const { spec, choice } = choiceOf('background');
      previewChosen(host, spec, choice.picked, composeBackground(next));
    };
    const commit = (next: Background): void => {
      if (!asLonghands) {
        this.#commitBackground(value, next, choiceOf('background').choice, choiceOf('background-color').choice, el, model, ctx);
        return;
      }
      const writes = changedLonghands(next).flatMap((property) => {
        const dest = placeOfLonghand(property).choice.picked.dest;
        const text = composeLonghand(next, property);
        // Back to saying nothing: taken away where it is declared, not written as a default.
        if (!dest || (!text && !own(property))) return [];
        return [{ dest, property, value: text, remove: !text }];
      });
      this.editor.cancelPreview();
      if (writes.length) this.editor.writeDeclarationsTo(writes, 'Set background', el);
    };

    return html`
      <heo-background-editor
        .value=${value}
        .computedColor=${computed.backgroundColor}
        .fields=${fields}
        @background-input=${(event: CustomEvent<{ value: Background }>) => preview(event.detail.value)}
        @background-change=${(event: CustomEvent<{ value: Background }>) => commit(event.detail.value)}
        @background-revert=${() => this.editor.cancelPreview()}
      ></heo-background-editor>
      ${rowsShown.length
        ? html`<div class="rows" style="margin-top:10px" data-declarations="surface">
            ${renderPropertyRows(rowsShown, specOf, host)}
          </div>`
        : nothing}`;
  }

  /**
   * The background as the editor shows it: the winning shorthand read as layers, with each longhand
   * that beats it laid over (a later `background-size`, a more specific rule's colour).
   */
  #backgroundView(model: ElementModel, ctx: CascadeContext): Background {
    const shorthand = model.cascade('background', ctx).applying[0];
    let background = shorthand ? parseBackground(shorthand.value) : { layers: [], color: '' };
    for (const property of BACKGROUND_LONGHANDS) {
      const winner = model.cascade(property, ctx).applying[0];
      if (!winner || winner.via) continue;
      if (shorthand && compareContributions(shorthand, winner) < 0) continue;
      background = applyLonghand(background, property, winner.value);
    }
    return background;
  }

  /**
   * Write a background where the `background` row writes, as one undo entry: the shorthand, with the
   * longhands the same block declares folded into it (kept, they would compete with it by order),
   * and the blend list beside it. A colour-only change in a block with no shorthand writes the
   * colour alone, so `background-color: white` is not turned into a shorthand for nothing.
   */
  #commitBackground(
    before: Background,
    next: Background,
    shorthandChoice: RowPlace,
    colourChoice: RowPlace,
    el: HTMLElement,
    model: ElementModel,
    ctx: CascadeContext,
  ): void {
    const declaredIn = (property: string, into: WriteTarget | null): boolean => Boolean(into) &&
      model.cascade(property, ctx).applying.some((one) => !one.via && sameTarget(targetOf(one, el), into!));
    const targetOfChoice = (choice: RowPlace): WriteTarget | null =>
      choice.picked.dest?.kind === 'target' ? choice.picked.dest.target : null;
    const layersOf = (background: Background): string => composeBackground({ ...background, color: '' });
    const blend = composeBlend(next);
    // The colour alone, where no shorthand is written: the colour, where the colour's row writes.
    const colourOnly = layersOf(before) === layersOf(next) && composeBlend(before) === blend &&
      !declaredIn('background', targetOfChoice(shorthandChoice));
    const choice = colourOnly ? colourChoice : shorthandChoice;
    const dest = choice.picked.dest;
    if (!dest) return;
    this.editor.cancelPreview();
    const into = targetOfChoice(choice);
    const declaredHere = (property: string): boolean => declaredIn(property, into);
    const writes: Array<{ dest: NonNullable<typeof dest>; property: string; value: string; remove?: boolean }> = [];
    if (colourOnly) {
      if (next.color || declaredHere('background-color')) {
        writes.push({ dest, property: 'background-color', value: next.color, remove: !next.color });
      }
    } else {
      const value = composeBackground(next);
      writes.push({ dest, property: 'background', value, remove: !value });
      for (const property of BACKGROUND_LONGHANDS) {
        if (property !== 'background-blend-mode' && declaredHere(property)) writes.push({ dest, property, value: '', remove: true });
      }
      if (blend || declaredHere('background-blend-mode')) {
        writes.push({ dest, property: 'background-blend-mode', value: blend, remove: !blend });
      }
    }
    if (!writes.length) return;
    this.editor.writeDeclarationsTo(writes, writes.some((one) => one.value) ? 'Set background' : 'Remove background', el);
  }

  /**
   * Animation: a ready-made animation, its trigger and its controls, written as declarations where
   * the `animation-name` row writes; a hover animation goes into the element's `:hover` state.
   * The declarations a block holds are rows under it.
   */
  #animationPart(cards: CardRender): MotionPart | null {
    const { el, model, host, scope, ctx } = cards;
    const hits = ANIMATION_PROPERTIES.filter((property) => this.#matches(cards, property));
    if (!hits.length) return null;
    const specOf = (property: string): RowSpec => ({ property, scope, element: el, model, listId: 'motion' });
    const hover = { width: null, state: ':hover' } as const;
    // Written where the animation already is: its name's row, or the shorthand's when only that
    // is declared, so a rule's `animation` is replaced in that rule and not shadowed inline.
    const anchor = !cards.cascade('animation-name').applying[0] && cards.cascade('animation').applying[0] ? 'animation' : 'animation-name';
    const choice = (() => {
      const spec = specOf(anchor);
      return rowPlace(spec, host, rowIdOf(scope, anchor, el));
    })();
    const winner = (property: string, onHover: boolean): Contribution | undefined =>
      model.cascade(property, onHover ? hover : ctx).applying[0];
    const fromHover = (one: Contribution | undefined): boolean =>
      one?.source.kind === 'rule' && one.source.entry.state.includes(':hover');
    const baseName = winner('animation-name', false) ?? winner('animation', false);
    const hoverName = winner('animation-name', true) ?? winner('animation', true);
    const onHover = !baseName && fromHover(hoverName);
    const value = readAnimation((property) => {
      const one = winner(property, onHover);
      return one && (!onHover || fromHover(one) || property.startsWith('--')) ? one.value : '';
    }, onHover);
    // Where the animation now lives, so a change rewrites it there and a move takes it out.
    const home = onHover ? hoverName : baseName;
    const own = (property: string): boolean => cards.cascade(property).applying.some((one) => !one.via);
    const rowsShown = ANIMATION_PROPERTIES.filter((property) => own(property) && hits.includes(property));

    const commit = (next: AnimationConfig | null): void => {
      const base = choice.picked.dest;
      if (!base) return;
      this.editor.cancelPreview();
      const homeTarget = home ? targetOf(home, el) : null;
      // Hover: into the state block it is already in, else the element's own `:hover` class.
      const dest: AddDestination = next?.trigger === 'hover'
        ? (onHover && homeTarget ? { kind: 'target', target: homeTarget } : { kind: 'auto-class', element: el, media: null, state: ':hover' })
        : base;
      const writes = next ? composeAnimation(next) : {};
      const list: Array<{ dest: AddDestination; property: string; value: string; remove?: boolean }> = [];
      const into = dest.kind === 'target' ? dest.target : null;
      const declaredIn = (property: string, target: WriteTarget | null, onHoverState: boolean): boolean => Boolean(target) &&
        model.cascade(property, onHoverState ? hover : ctx).applying.some((one) => !one.via && sameTarget(targetOf(one, el), target!));
      // Everything about an animation the destination block holds and the new one does not say,
      // the shorthand included: kept, it would go on competing with the longhands.
      for (const property of ANIMATION_PROPERTIES) {
        if (writes[property] === undefined && declaredIn(property, into, dest.kind === 'target' && onHover && next?.trigger === 'hover')) {
          list.push({ dest, property, value: '', remove: true });
        }
      }
      for (const [property, text] of Object.entries(writes)) list.push({ dest, property, value: text });
      // Moved somewhere else (to or from hover, or another block): taken out of where it was.
      if (homeTarget && !(into && sameTarget(homeTarget, into))) {
        for (const property of ANIMATION_PROPERTIES) {
          if (declaredIn(property, homeTarget, onHover)) list.push({ dest: { kind: 'target', target: homeTarget }, property, value: '', remove: true });
        }
      }
      if (!list.length) return;
      this.editor.writeDeclarationsTo(list, next ? `Animate: ${next.preset}` : 'Remove animation', el);
    };

    return {
      set: Boolean(value),
      body: html`
        <heo-animation-editor
          .value=${value}
          .targets=${this.editor.selection.length ? [...this.editor.selection] : [el]}
          @animation-change=${(event: CustomEvent<{ value: AnimationConfig | null }>) => commit(event.detail.value)}
        ></heo-animation-editor>
        ${rowsShown.length
          ? html`<div class="rows" style="margin-top:10px" data-declarations="animation">
              ${renderPropertyRows(rowsShown, specOf, host)}
            </div>`
          : nothing}`,
    };
  }

  /**
   * Transition: the element's transitions on a timeline, written as the `transition` shorthand
   * where its row writes, the longhands that block declares taken out so they cannot go on
   * competing with it. The declarations a block holds are rows under it.
   */
  #transitionPart(cards: CardRender): MotionPart | null {
    const { el, model, host, scope } = cards;
    const hits = TRANSITION_PROPERTIES.filter((property) => this.#matches(cards, property));
    if (!hits.length) return null;
    const specOf = (property: string): RowSpec => ({ property, scope, element: el, model, listId: 'motion' });
    const winner = (property: string): Contribution | undefined => cards.cascade(property).applying[0];
    // Written where the transition already is: the shorthand's row, or a longhand's when only
    // longhands are declared, so a rule's transition is replaced in that rule.
    const anchor = winner('transition') || !winner('transition-property') ? 'transition' : 'transition-property';
    const choice = (() => {
      const spec = specOf(anchor);
      return rowPlace(spec, host, rowIdOf(scope, anchor, el));
    })();
    const items = readTransitions((property) => winner(property)?.value ?? '');
    const own = (property: string): boolean => cards.cascade(property).applying.some((one) => !one.via);
    const rowsShown = TRANSITION_PROPERTIES.filter((property) => own(property) && hits.includes(property));
    const shown = getComputedStyle(el);
    const durations = this.editor.tokens
      .list('motion')
      .map((token) => {
        const name = token.name.startsWith('--') ? token.name : `--${token.name}`;
        return { name, ms: timeMs(token.value, (one) => shown.getPropertyValue(one)) };
      })
      .filter((one): one is { name: string; ms: number } => one.ms !== null && one.ms > 0)
      .sort((a, b) => a.ms - b.ms);

    const commit = (next: readonly TransitionItem[]): void => {
      const dest = choice.picked.dest;
      if (!dest) return;
      this.editor.cancelPreview();
      const into = dest.kind === 'target' ? dest.target : null;
      const declaredIn = (property: string): boolean => Boolean(into) &&
        cards.cascade(property).applying.some((one) => !one.via && sameTarget(targetOf(one, el), into!));
      const list: Array<{ dest: AddDestination; property: string; value: string; remove?: boolean }> = [];
      for (const property of TRANSITION_PROPERTIES.slice(1)) {
        if (declaredIn(property)) list.push({ dest, property, value: '', remove: true });
      }
      if (next.length) list.push({ dest, property: 'transition', value: formatTransitions(next) });
      else if (declaredIn('transition')) list.push({ dest, property: 'transition', value: '', remove: true });
      if (!list.length) return;
      this.editor.writeDeclarationsTo(list, next.length ? 'Set transition' : 'Remove transition', el);
    };

    return {
      set: Boolean(items?.length),
      body: html`
        ${items === null
          ? html`<p class="hint" style="margin:0 0 9px">
              This transition is written in a way the timeline cannot read (a token for the whole list): edit it in its row below.
            </p>`
          : html`<heo-transition-editor
              .items=${items}
              .triggers=${transitionTriggers(model)}
              .durations=${durations}
              .target=${el}
              .resolve=${(name: string) => getComputedStyle(el).getPropertyValue(name)}
              @transition-change=${(event: CustomEvent<{ items: TransitionItem[] }>) => commit(event.detail.items)}
            ></heo-transition-editor>`}
        ${rowsShown.length
          ? html`<div class="rows" style="margin-top:10px" data-declarations="transition">
              ${renderPropertyRows(rowsShown, specOf, host)}
            </div>`
          : nothing}`,
    };
  }

  /** The Text style card's dialog, while open: saving, or saving on the way to another style. */
  #typeDialog: { mode: 'save' | 'leave'; target: string | null } | null = null;
  #typeTune = false;

  /**
   * Text style: the design system's text styles, then the element's typography as labelled rows.
   *
   * A text style is a class (see core/text-styles.ts). The rows write to the element's style
   * attribute, so editing anything makes the element differ from its style: the list then shows
   * "This text", unsaved, and "Save as text style…" names it. Picking another style with edits
   * unsaved asks first, in one dialog that can save them as it goes. The styles are offered at
   * Element only: wearing one is the element's, not a state's or a size's.
   */
  #renderTypography(cards: CardRender): TemplateResult | typeof nothing {
    const { el, model, host, scope } = cards;
    const engine = this.editor;
    const atElement = scope.kind === 'element';
    const styles = atElement ? engine.textStyles() : [];
    const current = engine.textStyleOf(el);
    const edited = engine.hasOwnTypography(el);
    /*
     * Under a text style, one place to write: the element's own style attribute, so an edit makes
     * the element its own rather than changing the style every other element wears (that is done
     * from Tokens, or by saving over it). Without one, rows write where the value is written now,
     * as every section of the panel does. The ladder can still pick the style's class by hand.
     */
    const inline = Boolean(current);
    const value = (property: string): string => cards.cascade(property).applying[0]?.value ?? '';
    const rows = shownTypographyRows(value('text-decoration-line') || cards.computed.textDecorationLine)
      .filter((row) => this.#matches(cards, row.property, row.label));
    // white-space is laid out with the text; the shorthands are listed only where one is set.
    const extras = (cards.lists.get('typography') ?? [])
      .filter((property) => TEXT_EXTRAS.includes(property) && (property === 'white-space' || cards.read(property)))
      .filter((property) => this.#matches(cards, property));
    const tuning = (['text-wrap', 'hyphens', 'text-indent', 'font-variant-numeric', 'font-variant-caps', 'font-variant-ligatures'] as const);
    const tuneShown = tuning.some((property) => host.hit(property, value(property)));
    const styleHits = styles.filter((one) => host.hit(one.name, one.entry.name));
    if (!rows.length && !extras.length && !tuneShown && !styleHits.length) return nothing;

    const look = (): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const property of TYPOGRAPHY_PROPERTIES) {
        const one = value(property);
        if (one) out[property] = one;
      }
      return out;
    };
    const dialogStyles: DialogTextStyle[] = styles.map((one) => ({
      className: one.entry.name,
      name: one.name,
      used: one.used,
      declarations: textStyleDeclarations(one.entry),
    }));
    const fromName = current ? styles.find((one) => one.entry.name === current.name)?.name ?? '' : '';
    const pick = (className: string): void => {
      if (edited) {
        this.#typeDialog = { mode: 'leave', target: className };
        this.requestUpdate();
        return;
      }
      if (className !== current?.name) engine.applyTextStyle(className, el);
    };
    const changes = Object.keys(inlineDeclarations(el)).filter((property) => TYPOGRAPHY_PROPERTIES.includes(property)).length;
    const dialog = this.#typeDialog;
    const targetName = dialog?.target ? styles.find((one) => one.entry.name === dialog.target)?.name ?? '' : '';
    const computedFamily = cards.computed.fontFamily;
    const sizeOf = (decl: Record<string, string>): string => {
      const size = decl['font-size'] ?? '';
      return /^var\(/.test(size) ? (getComputedStyle(el).getPropertyValue(size.replace(/^var\(\s*|\s*(,.*)?\)$/g, '')).trim() || size) : size;
    };
    const preview = (decl: Record<string, string>): string => Object.entries(decl)
      .filter(([property]) => !property.startsWith('--') && property !== 'font-size' && property !== 'line-height')
      .map(([property, text]) => `${property}:${text.replace(/[;{}<>]/g, '')}`)
      .join(';');

    /*
     * Fine-tuning writes where its rows write: through the row's place, under the condition picked
     * on the strip, rather than always into the style attribute.
     */
    const tune = (property: string, text: string): void => {
      const spec = cards.spec(property, 'typography');
      writeChosen(host, spec, rowPlace(spec, host), cards.read(property), text);
    };

    return html`
      ${atElement ? html`<div class="typestyles" data-text-styles>
        <div class="tgroup">Text style</div>
        ${edited
          ? html`<div class="tstyle mine" aria-current="true" data-text-style="mine">
              <span class="p" style=${preview(look())}>This text</span>
              <span class="m">${current ? `edited from ${fromName} · not saved` : 'not saved'}</span>
            </div>`
          : nothing}
        ${styleHits.map((one) => {
            const decl = textStyleDeclarations(one.entry);
            return html`<button
            class="tstyle"
            type="button"
            data-text-style=${one.entry.name}
            aria-current=${!edited && current?.name === one.entry.name ? 'true' : 'false'}
            title=${`${one.name}: .${one.entry.name}, used ${one.used}×`}
            @click=${() => pick(one.entry.name)}
          >
            <span class="p" style=${`${preview(decl)};font-size:min(22px, ${sizeOf(decl) || '16px'})`}>${one.name}</span>
            <span class="m">${[sizeOf(decl), decl['line-height']].filter(Boolean).join('/')}${decl['font-size'] || decl['line-height'] ? ' · ' : ''}${one.used}×</span>
          </button>`;
          })}
        ${!styles.length
          ? html`<p class="hint" style="margin:0">No text styles yet. Style this text below, then save it as one to use it elsewhere.</p>`
          : nothing}
        ${edited || !current
          ? html`<div class="tactions">
              ${edited && current
              ? html`<button class="btn sm ghost" type="button" @click=${() => engine.applyTextStyle(current.name, el)}>Discard changes</button>`
              : nothing}
              <button class="btn sm primary" type="button" data-save-text-style ?disabled=${!edited && !Object.keys(look()).length} @click=${() => {
              this.#typeDialog = { mode: 'save', target: null };
              this.requestUpdate();
            }}>Save as text style…</button>
            </div>`
          : nothing}
      </div>` : nothing}
      <div class="rows" data-declarations="typography">
        ${rows.map((row) => renderPropertyRow({
            property: row.property,
            scope,
            element: el,
            model,
            listId: 'typography',
            label: row.label,
            sub: row.sub,
            segments: row.segments,
            ...(inline ? { preferInline: true } : {}),
          }, host))}
        ${extras.length ? renderPropertyRows(extras, (property) => cards.spec(property, 'typography'), host) : nothing}
      </div>
      ${tuneShown
        ? html`<button class="more" type="button" aria-expanded=${this.#typeTune ? 'true' : 'false'} @click=${() => {
          this.#typeTune = !this.#typeTune;
          this.requestUpdate();
        }}>${this.#typeTune ? 'Hide fine-tuning' : 'Fine-tuning: line breaks, numbers & letters'} ${icon(this.#typeTune ? 'chevronUp' : 'chevronDown', 10)}</button>
          ${this.#typeTune || host.filtering
            ? html`<heo-type-tuning
                .values=${Object.fromEntries(tuning.map((property) => [property, value(property)])) as unknown as TuningValues}
                family=${computedFamily}
                familyName=${parseFamilies(computedFamily)[0] ?? ''}
                @tune-change=${(event: CustomEvent<{ property: string; value: string }>) =>
                tune(event.detail.property, event.detail.value)}
              ></heo-type-tuning>`
            : nothing}`
        : nothing}
      <heo-text-style-dialog
        ?open=${Boolean(dialog)}
        mode=${dialog?.mode ?? 'save'}
        .styles=${dialogStyles}
        from=${fromName}
        target=${targetName}
        .look=${look()}
        .changes=${changes}
        sample=${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}
        proposed=${proposedTextStyleName(fromName || null, styles.map((one) => one.name))}
        @style-cancel=${() => {
        this.#typeDialog = null;
        this.requestUpdate();
      }}
        @style-discard=${() => {
        const target = this.#typeDialog?.target ?? null;
        this.#typeDialog = null;
        engine.applyTextStyle(target, el);
        this.requestUpdate();
      }}
        @style-save=${(event: CustomEvent<{ name: string; replace: string | null }>) => {
        const target = this.#typeDialog?.target ?? null;
        this.#typeDialog = null;
        const saved = engine.saveTextStyle(event.detail.name, look(), event.detail.replace, el);
        if (saved && target && target !== saved) engine.applyTextStyle(target, el);
        if (saved) engine.notify(`Saved ${event.detail.name} as a text style.`, 'success', { label: 'Undo', run: () => engine.undo() });
        this.requestUpdate();
      }}
      ></heo-text-style-dialog>`;
  }

  /** Which of the two the Motion card shows, once picked; until then, the one in use. */
  #motionTab: 'animation' | 'transition' | null = null;

  /**
   * Motion: Animation and Transition, one at a time behind a switch. Unpicked, it shows the one
   * the element uses — a transition with no animation opens on Transition — and Animation
   * otherwise. While searching, a tab with nothing that matches gives way to the other.
   */
  #renderMotion(cards: CardRender): TemplateResult | typeof nothing {
    const animation = this.#animationPart(cards);
    const transition = this.#transitionPart(cards);
    if (!animation && !transition) return nothing;
    let tab = this.#motionTab ?? (transition?.set && !animation?.set ? 'transition' : 'animation');
    if (tab === 'transition' && !transition) tab = 'animation';
    if (tab === 'animation' && !animation) tab = 'transition';
    const options: SegmentOption[] = [
      { value: 'animation', label: 'Animation', title: 'Keyframes that play on their own: on load, on hover, on scroll' },
      { value: 'transition', label: 'Transition', title: 'How a change plays: when a state such as :hover starts or ends' },
    ];
    return html`
      <div class="motion-tabs" style="margin-bottom:10px">
        <heo-segmented
          label="Animation or transition"
          .options=${options}
          .value=${tab}
          @segment-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#motionTab = event.detail.value === 'transition' ? 'transition' : 'animation';
        this.requestUpdate();
      }}
        ></heo-segmented>
      </div>
      <div data-motion=${tab}>${tab === 'transition' ? transition!.body : animation!.body}</div>`;
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
  /**
   * Whether a card's row matches the search: its property, its label, what it shows under the
   * condition, or the selector of any declaration applying to it there (`card` finds what `.card`
   * writes).
   */
  #matches(cards: CardRender, property: string, ...also: Array<string | undefined>): boolean {
    if (!this.ui.filter.trim()) return true;
    const applying = cards.cascade(property).applying;
    return this.#hit(
      property,
      ...also,
      shownValue(cards.read(property)),
      applying[0]?.value,
      ...applying.map((one) => (one.source.kind === 'rule' ? one.source.entry.selector : 'inline style')),
    );
  }

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
   * answer to "is this here". Counted over the cards' own lists, Other's included.
   */
  #matchCount(cards: CardRender): number {
    const properties = new Set<string>();
    for (const list of cards.lists.values()) {
      for (const property of list) {
        if (this.#matches(cards, property)) properties.add(property);
      }
    }
    return properties.size;
  }

  /** What the add action would do, named after what has been typed. */
  #addLabel(): string {
    const seed = this.ui.filter.trim();
    return seed ? `Add ${seed}` : 'Add a property';
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

/** What one tab of the Motion card draws, and whether it is in use. */
interface MotionPart {
  body: TemplateResult;
  /** Whether the element has one now. */
  set: boolean;
}

/** Motion's own properties: what a state changes in them is not a change a transition plays. */
const MOTION_OWN = new Set([...TRANSITION_PROPERTIES, ...ANIMATION_PROPERTIES]);

/**
 * The states the page's CSS gives the element that change something, and what: each property a
 * state's rules declare and win, from the value the element has now to the state's. A state on
 * another element (`:hover on .nav`) is one too, said as such.
 */
function transitionTriggers(model: ElementModel): TransitionTrigger[] {
  const el = model.element;
  const computed = getComputedStyle(el);
  const out: TransitionTrigger[] = [];
  for (const group of model.groups()) {
    if (group.kind !== 'state') continue;
    const changes: TriggerChange[] = [];
    for (const property of statePropertiesOf(model, group.state)) {
      if (MOTION_OWN.has(property)) continue;
      const to = model.cascade(property, { width: null, state: group.state }).applying[0];
      if (!to || to.source.kind !== 'rule' || to.source.entry.state !== group.state) continue;
      const from = model.cascade(property).applying[0]?.value ?? (computed.getPropertyValue(property).trim() || 'initial');
      if (from.trim() === to.value.trim()) continue;
      changes.push({ property, from, to: to.value });
    }
    if (changes.length) out.push({ state: group.state, label: group.state, on: stateTrigger(group.state).on, changes });
  }
  return out;
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
