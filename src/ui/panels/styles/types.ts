import type { TemplateResult, nothing } from 'lit';
import type { ElementModel, RuleEntry } from '../../../core/cascade.js';
import type { EditorEngine } from '../../../core/editor.js';
import type { AddDestination } from '../../../core/save-plan.js';
import type { FormErrors } from '../../form-errors.js';
import type { AdderDestination, AdderHost } from './property-adder.js';
import type { RowSpec } from './property-row.js';

/**
 * The Styles panel's pieces program against these.
 *
 * One state object rather than a field per concern, because the pieces live in separate modules
 * and each needs to read and change what the others show: a press outside the popover closes it,
 * only one adder or menu may be open at once. Handing every
 * piece the same `ui` and one `patch` keeps those rules in the panel instead of in six places.
 */

/** Which cascade a row shows and where its edits go. */
export type RowScope =
  /** The element's own rows in Effective styles. */
  | { kind: 'element' }
  /** A size group in Effective styles: the cascade at the slot's width. */
  | { kind: 'size'; slot: string }
  /** A state or pseudo-element group: edits go into that state's rule. */
  /** A state, under a media key (`tablet`, `other:print`) when `slot` is set: `:hover ≥768px`. */
  | { kind: 'state'; state: string; slot?: string }
  /** A category section (Typography, Spacing…). */
  | { kind: 'section'; id: string }
  /** In its parent: the element's own rows there, or the parent's controls. */
  | { kind: 'parent'; element: HTMLElement };

export interface StylesUiState {
  /** What the panel is being filtered by. Empty shows everything. */
  filter: string;
  /**
   * The one cascade popover. `rowId` names the row it is anchored to. `source` is the line whose
   * card is expanded under it, by the rule entry's `order`, with the block to focus in it.
   */
  popover: {
    scope: RowScope;
    property: string;
    rowId: string;
    source?: { key: string; order: number; slot: string; state: string } | null;
  } | null;
  /**
   * The element's cards opened over the panel from the header. `key` is what opened it: a class's family,
   * `element` (the tag chip: inline style and the id's rules) or `id` (the id chip: its rules).
   * `cards` are the cards shown, in order, when they are not just `key`'s. `anchor` selects what
   * it is placed against.
   */
  cardPop: { key: string; anchor: string; cards?: string[] } | null;
  /** The destination picked in one Effective row's value list, until that edit is written. */
  rowDest: { rowId: string; key: string } | null;
  /** A pseudo-element added to Effective styles, shown empty until its first property. */
  effPseudo: string | null;
  /** The one open menu, by id. */
  menu: { id: string } | null;
  /** The one open adder: its id, the draft, and the destination picked in it. */
  adder: { id: string; draft: string; dest: string } | null;
  /** Effective styles' hand-picked size; null follows the preview (R13). */
  effPick: string | null;
  /** The header's "find or create a class" field is showing. */
  finderOpen: boolean;
  /** The header's "N rules" chip is open on the rules' own chips. */
  rulesOpen: boolean;
  /** A strip menu's "Add a media query…" field, for one strip at a time. */
  mediaDraft: { owner: string; text: string; width?: { side: 'max' | 'min'; text: string } } | null;
  /**
   * Media queries added to a strip with nothing written at them yet, by strip owner. Held here
   * until a declaration lands, so nothing empty is ever stored to show a size.
   */
  otherSlots: ReadonlyMap<string, readonly string[]>;
  /** A card's hand-picked size, by family key; cleared when the preview width changes (R13). */
  cardPicks: ReadonlyMap<string, string>;
  /**
   * States and pseudo-elements added to a card with nothing written yet (§5.7). Shown as blocks
   * until their first property lands; nothing empty is ever stored to show them.
   */
  pendingStates: ReadonlyArray<PendingState>;
  /** A note under one card block after an add, such as why no `content` was written. */
  blockHint: { block: string; text: string } | null;
  /** The class card whose "Detach styles from class" panel is open, by class name. */
  detachOpen: string | null;
  /** The name typed for the detached copy; empty while the suggested one will do. */
  forkDraft: string;
}

/** A block waiting for its first property: where it is shown and where that property goes. */
export interface PendingState {
  family: string;
  slot: string;
  state: string;
  dest: AddDestination;
}

export interface StylesHost extends AdderHost {
  /** Where a row's edit can go: the same places everywhere the panel shows a property. */
  destinationsFor(spec: RowSpec): AdderDestination[];
  /** Flash a property's row in a list once it has rendered: where an add landed. */
  flashRow(property: string, listId: string): void;
  engine: EditorEngine;
  /** The selected element. */
  element: HTMLElement;
  /** Its cascade model, built once per render. */
  model: ElementModel;
  /** The width being previewed, or null at Actual. */
  previewWidth: number | null;
  ui: StylesUiState;
  /** Replace part of `ui` and schedule a render. */
  patch(next: Partial<StylesUiState>): void;
  /** Whether a search narrows the panel, and the one predicate every surface filters with. */
  filtering: boolean;
  hit(...texts: Array<string | undefined>): boolean;
  /**
   * Run `then` (put a condition on a bar) where that condition shows: at once, or after moving the
   * preview to a width it is in effect at, which a toast says.
   */
  showCondition(media: string | null, then: () => void): void;
  /** Focus a control inside the panel once the next render has landed. */
  focusSelector(selector: string): void;
  /** The strips' "Add a media query…" field: one is open at a time. */
  mediaForm: FormErrors;
  /** Open or close one of the panel's menus; closing hands focus back to what opened it. */
  /** Open or close a menu; closing hands focus back to its opener unless `refocus` is false. */
  toggleMenu(id: string, open: boolean, refocus?: boolean): void;
  /** The Detach copy's name field. */
  forkForm: FormErrors;
  /** Open a card from its chip in the header. */
  openCard(key: string): void;
  /**
   * A popover line's link: expand the card the declaration is written in under that line, at its
   * size, or collapse it when it is the one expanded.
   */
  openSource(property: string, entry: RuleEntry): void;
  /** The card for `key`, drawn whole and always open, for a popover to hold. */
  sourceCard(key: string): TemplateResult | typeof nothing;
}
