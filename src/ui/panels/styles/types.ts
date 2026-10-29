import type { ElementModel, RuleEntry } from '../../../core/cascade.js';
import type { EditorEngine } from '../../../core/editor.js';
import type { AddDestination, SaveContext, SaveOption, SavePlan } from '../../../core/save-plan.js';
import type { FormErrors } from '../../form-errors.js';
import type { AdderHost } from './property-adder.js';

/**
 * The Styles panel's pieces program against these.
 *
 * One state object rather than a field per concern, because the pieces live in separate modules
 * and each needs to read and change what the others show: a press outside the popover closes it, a
 * new preview width cancels the save box, only one adder or menu may be open at once. Handing every
 * piece the same `ui` and one `patch` keeps those rules in the panel instead of in six places.
 */

/** Which cascade a row shows and where its edits go. */
export type RowScope =
  /** The element's own rows in Effective styles. */
  | { kind: 'element' }
  /** A size group in Effective styles: the cascade at the slot's width. */
  | { kind: 'size'; slot: string }
  /** A state or pseudo-element group: edits go into that state's rule. */
  | { kind: 'state'; state: string }
  /** A category section (Typography, Spacing…). */
  | { kind: 'section'; id: string }
  /** In its parent: the element's own rows there, or the parent's controls. */
  | { kind: 'parent'; element: HTMLElement };

/** A value that was entered and now waits for "where should this stay". */
export interface PendingSave {
  /** The row it was entered in: `${scope key}:${property}`, or `box:${scope key}` for a batch. */
  rowId: string;
  /** What the box names: the property, or `spacing` for a box-editor batch. */
  label: string;
  ctx: SaveContext;
  plan: SavePlan;
  selected: SaveOption['kind'];
}

export interface StylesUiState {
  /** What the panel is being filtered by. Empty shows everything. */
  filter: string;
  /** The one cascade popover. `rowId` names the row it is anchored to. */
  popover: { scope: RowScope; property: string; rowId: string } | null;
  /** The one open menu, by id. */
  menu: { id: string } | null;
  /** The one open adder: its id, the draft, and the destination picked in it. */
  adder: { id: string; draft: string; dest: string } | null;
  /** The one save box. */
  pending: PendingSave | null;
  /** Effective styles' hand-picked size; null follows the preview (R13). */
  effPick: string | null;
  /** The header's "find or create a class" field is showing. */
  finderOpen: boolean;
  /** The preview menu's "Add a viewport size…" field, or null while it is closed. */
  sizeDraft: string | null;
  /** A strip menu's "Add a media query…" field, for one strip at a time. */
  mediaDraft: { owner: string; text: string } | null;
  /**
   * Media queries added to a strip with nothing written at them yet, by strip owner. Held here
   * until a declaration lands, so nothing empty is ever stored to show a size.
   */
  otherSlots: ReadonlyMap<string, readonly string[]>;
  /** Which Sources groups are shown. */
  tab: SourcesTab;
  /** A card's hand-picked size, by family key; cleared when the preview width changes (R13). */
  cardPicks: ReadonlyMap<string, string>;
  /** Cards shut by hand this session, by family key (`inline` for the inline card). */
  closedCards: ReadonlySet<string>;
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

export type SourcesTab = 'all' | 'inline' | 'classes' | 'rules';

export interface StylesHost extends AdderHost {
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
  /** Focus a property's value field in one declaration list once the next render has landed. */
  focusAfterRender(property: string, listId: string): void;
  /** Focus a control inside the panel once the next render has landed. */
  focusSelector(selector: string): void;
  /** The adder's errors: one adder is open at a time, so one form. */
  adderForm: FormErrors;
  /** The strips' "Add a media query…" field: one is open at a time. */
  mediaForm: FormErrors;
  /** Open or close one of the panel's menus; closing hands focus back to what opened it. */
  toggleMenu(id: string, open: boolean): void;
  /** The Detach copy's name field. */
  forkForm: FormErrors;
  /** Open a card in Sources, scroll it into view and flash it. */
  openCard(key: string): void;
  /** Open the card a declaration is written in, at its size, from a popover line's link. */
  openSource(property: string, entry: RuleEntry): void;
}
