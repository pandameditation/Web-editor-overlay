import type { ElementModel } from '../../../core/cascade.js';
import type { EditorEngine } from '../../../core/editor.js';
import type { SaveContext, SaveOption, SavePlan } from '../../../core/save-plan.js';
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
}

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
  /** Open the place a declaration is written, from a popover line's link. */
  openSource(property: string, target: { selector: string; family: string; isClass: boolean }): void;
}
