import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { isPseudoElement, mediaShort } from '../../../core/breakpoints.js';
import type {
  CascadeContext,
  CascadeList,
  Contribution,
  ElementModel,
  WriteTarget,
} from '../../../core/cascade.js';
import { longhandsOf, splitImportant } from '../../../core/declaration-list.js';
import { reachText, shortLabel, type SaveContext } from '../../../core/save-plan.js';
import { mediaApplies } from '../../../core/viewport.js';
import { icon } from '../../icons.js';
import { buildSuggestions, valueKindFor } from '../../suggestions.js';
import { beginSave, cancelSave, renderSaveBox } from './save-box.js';
import type { RowScope, StylesHost } from './types.js';

/**
 * The one property row: Effective styles, its size and state groups, every category section and
 * In its parent all draw this, so a value means the same thing and an edit goes the same way
 * wherever it is made.
 *
 * Left of the name sits a dot that is a button: it opens the cascade for the property, and its
 * crescents count the applying declarations the winner beats. The name says where the winning
 * value comes from; editing it writes an inline override by default, asks where it should stay
 * when the value depends on the viewport, and writes into the state's own rule in a state group.
 *
 * The grid element keeps today's `div.row[data-property]` (fixtures find fields that way), inside
 * an attribute-less `div.prow` that also holds the focus hint or the save box under it.
 */

/** Properties drawn as a segmented control instead of a text field. */
export const SEGMENTED: Record<
  string,
  Array<{ value: string; label?: string; icon?: string; title?: string }>
> = {
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

export interface RowSpec {
  property: string;
  scope: RowScope;
  /** The element the row edits: the selection, or its parent for the parent's controls. */
  element: HTMLElement;
  model: ElementModel;
  /** Placeholder text instead of the shortened computed value. */
  placeholder?: string;
  /** The `data-declarations` id of the list the row sits in. */
  listId: string;
}

/* -------------------------------------------------------------------------- */
/* What a row shows                                                            */
/* -------------------------------------------------------------------------- */

/** Stable within one render: what popovers and save boxes name a row by. */
export function scopeKey(scope: RowScope, selected: HTMLElement): string {
  switch (scope.kind) {
    case 'element':
      return 'element';
    case 'size':
      return `size:${scope.slot}`;
    case 'state':
      return `state:${scope.state}`;
    case 'section':
      return `section:${scope.id}`;
    case 'parent':
      return scope.element === selected ? 'parent:self' : 'parent:up';
  }
}

export function rowIdOf(scope: RowScope, property: string, selected: HTMLElement): string {
  return `${scopeKey(scope, selected)}:${property}`;
}

/** The width a slot is represented by: phone → 320, the others → their preset. */
export function slotWidth(model: ElementModel, slot: string): number | null {
  return model.slots().find((one) => one.key === slot)?.at ?? null;
}

/** The cascade a row reads: a size group at its slot's width, a state group in its state. */
export function scopeContext(scope: RowScope, model: ElementModel): CascadeContext {
  if (scope.kind === 'size') return { width: slotWidth(model, scope.slot) };
  if (scope.kind === 'state') return { width: null, state: scope.state };
  return { width: null };
}

/**
 * The slot a preview width picks: the slot whose own width it is, else the widest slot whose
 * media applies there, else All sizes. Actual picks All sizes.
 */
export function previewSlot(model: ElementModel, width: number | null): string {
  if (width === null) return 'base';
  const slots = model.slots();
  const exact = slots.find((one) => one.at === width);
  if (exact) return exact.key;
  const applying = slots
    .filter((one) => mediaApplies(one.media, width))
    .sort((a, b) => a.at - b.at);
  return applying.at(-1)?.key ?? 'base';
}

/**
 * Whether an edit to this row depends on the viewport, and so asks where it should stay.
 *
 * True in a size group; while previewing a width whose slot is not All sizes; and at Actual when
 * the winning declaration sits in a media rule. Never in a state group, which writes its own rule.
 */
export function isViewportDependent(
  scope: RowScope,
  model: ElementModel,
  property: string,
  previewWidth: number | null,
): boolean {
  if (scope.kind === 'size') return true;
  if (scope.kind === 'state') return false;
  if (previewWidth !== null) return previewSlot(model, previewWidth) !== 'base';
  const winner = model.cascade(property).applying[0];
  return winner?.source.kind === 'rule' && winner.source.entry.media !== null;
}

/** Where a value comes from, in full: `inline style`, `.card @media (min-width: 768px)`. */
export function sourceLabel(contribution: Contribution): string {
  if (contribution.source.kind === 'inline') return 'inline style';
  const entry = contribution.source.entry;
  return `${entry.selector}${entry.media ? ` @media ${entry.media}` : ''}`;
}


/**
 * The value a field shows for a contribution.
 *
 * A box side supplied by its shorthand shows that side. Any other longhand supplied by a
 * shorthand (`border-color` from `border`) shows nothing, with the computed value as placeholder:
 * the shorthand's whole text in a colour field would read as a colour that is not one.
 */
export function shownValue(contribution: Contribution | undefined): string {
  if (!contribution) return '';
  if (contribution.via && !/^(margin|padding|border-radius)$/i.test(contribution.via)) return '';
  return contribution.value;
}

/** Where a contribution writes when its value is edited. */
export function targetOf(contribution: Contribution, element: HTMLElement): WriteTarget {
  return contribution.source.kind === 'inline'
    ? { kind: 'inline', element }
    : contribution.source.entry.target;
}

/** Whether an inline value of this property would need `!important` to show (§5.3). */
function needsImportant(model: ElementModel, property: string): boolean {
  const own = model.inline.some((one) => one.property === property && one.important);
  return (
    own ||
    [property, ...longhandsOf(property)].some((name) =>
      model.cascade(name).applying.some((one) => one.source.kind === 'rule' && one.important))
  );
}

/** What a row's cascade, value and own rule are, for one scope. */
export function readRow(spec: RowSpec): {
  list: CascadeList;
  winner: Contribution | undefined;
  /** The contribution whose value the field shows. */
  shown: Contribution | undefined;
  /** In a state group, the rule an edit writes into. */
  stateTarget: WriteTarget | null;
} {
  const { scope, model, property } = spec;
  const list = model.cascade(property, scopeContext(scope, model));
  const winner = list.applying[0];
  let shown = winner;
  let stateTarget: WriteTarget | null = null;
  if (scope.kind === 'size') {
    shown =
      list.applying.find((one) =>
        one.source.kind === 'rule' &&
        one.source.entry.state === '' &&
        model.slotOf(one.source.entry) === scope.slot) ?? winner;
  } else if (scope.kind === 'state') {
    const own = list.applying.find((one) =>
      one.source.kind === 'rule' && one.source.entry.state === scope.state);
    shown = own ?? winner;
    const entry =
      own?.source.kind === 'rule'
        ? own.source.entry
        : model.entries.find((one) => one.state === scope.state && model.applies(one));
    stateTarget = entry?.target ?? null;
  }
  return { list, winner, shown, stateTarget };
}

/** The save context for a value entered in a row. */
export function saveContextFor(
  spec: RowSpec,
  declarations: Record<string, string>,
  previewWidth: number | null,
): SaveContext {
  const { scope, model } = spec;
  let slot: string | null = null;
  if (scope.kind === 'size') slot = scope.slot;
  else if (previewWidth !== null && previewSlot(model, previewWidth) !== 'base') {
    slot = previewSlot(model, previewWidth);
  } else {
    const winner = model.cascade(Object.keys(declarations)[0] ?? '').applying[0];
    if (winner?.source.kind === 'rule' && winner.source.entry.media !== null) {
      slot = model.slotOf(winner.source.entry);
    }
  }
  const width = scope.kind === 'size' ? slotWidth(model, scope.slot) ?? model.width : model.width;
  return { element: spec.element, declarations, slot, width };
}


export function shorten(value: string, max = 22): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/* -------------------------------------------------------------------------- */
/* The dot                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The dot and its crescents: one crescent per applying declaration the winner beats, at most
 * three. Idle declarations (another size, a state) do not count; the popover lists them.
 */
export function renderCascadeDot(spec: {
  property: string;
  list: CascadeList;
  expanded: boolean;
  onToggle(): void;
}): TemplateResult {
  const winner = spec.list.applying[0];
  const beaten = Math.max(0, spec.list.applying.length - 1);
  const label = winner
    ? `${spec.property} from ${sourceLabel(winner)}${beaten ? `, ${beaten} overridden` : ''}. Show cascade`
    : `${spec.property} is not declared for this element. Show cascade`;
  return html`<button
    class="dots"
    type="button"
    aria-haspopup="dialog"
    aria-expanded=${spec.expanded ? 'true' : 'false'}
    aria-label=${label}
    title=${label}
    @click=${() => spec.onToggle()}
  >
    <span class=${winner ? 'dot' : 'dot none'} aria-hidden="true"></span>
    ${Array.from({ length: Math.min(beaten, 3) }, () => html`<span class="moon" aria-hidden="true"></span>`)}
  </button>`;
}

/* -------------------------------------------------------------------------- */
/* The row                                                                     */
/* -------------------------------------------------------------------------- */

export function renderPropertyRow(spec: RowSpec, host: StylesHost): TemplateResult {
  const { property, scope, element, model } = spec;
  const engine = host.engine;
  const rowId = rowIdOf(scope, property, host.element);
  const { list, winner, shown, stateTarget } = readRow(spec);
  const pending = host.ui.pending?.rowId === rowId ? host.ui.pending : null;
  const writesInline = scope.kind === 'element' || scope.kind === 'section' || scope.kind === 'parent';
  const ownInline = model.inline.find((one) => one.property === property);
  const pseudo = scope.kind === 'state' && isPseudoElement(scope.state);
  const computed = (pseudo ? getComputedStyle(element, scope.state) : getComputedStyle(element))
    .getPropertyValue(property)
    .trim();
  const value = pending ? pending.ctx.declarations[property] ?? '' : shownValue(shown);
  const asks = isViewportDependent(scope, model, property, host.previewWidth);
  const expanded = host.ui.popover?.rowId === rowId;

  /*
   * Who may drop a shown `!important` from the field's tag: only a row that writes the declaration
   * it shows. A rule's importance shown on an element row is not this row's to change; the tag
   * stays text and points to the popover, where that rule's own line has the toggle.
   */
  const tagWrites = shown
    ? (writesInline && shown.source.kind === 'inline') ||
      (scope.kind === 'state' && shown.source.kind === 'rule' && shown.source.entry.state === scope.state)
    : false;

  const preview = (text: string): void => {
    if (host.ui.pending) cancelSave(host);
    if (scope.kind === 'state') {
      if (stateTarget) engine.previewDeclaration(stateTarget, property, text);
      return;
    }
    if (scope.kind === 'size') {
      engine.previewStyle(property, text, element);
      return;
    }
    const typed = splitImportant(text);
    const strong = typed.important === null && typed.value && needsImportant(model, property);
    engine.previewStyle(property, strong ? `${typed.value} !important` : text, element);
  };

  /** The one path a committed value takes (R25), from typing, the value list or a segment. */
  const commit = (text: string, event: Event): void => {
    if (scope.kind === 'state') {
      if (stateTarget) engine.setDeclaration(stateTarget, property, text);
      else engine.cancelPreview();
      return;
    }
    const typed = splitImportant(text);
    if (!typed.value) {
      if (scope.kind === 'size') engine.cancelPreview();
      else engine.overrideStyle(property, '', element);
      return;
    }
    if (shown && typed.important === null && shown.value === typed.value) {
      engine.cancelPreview();
      return;
    }
    if (asks) {
      // Focus goes to the box unless the value was committed by moving to another control.
      const active = ((event.target as Element).getRootNode() as ShadowRoot).activeElement;
      const left = active !== null && active !== event.target;
      beginSave(host, rowId, property, saveContextFor(spec, { [property]: text }, host.previewWidth), !left);
      return;
    }
    engine.overrideStyle(property, text, element);
  };

  const removeImportant = (): void => {
    if (scope.kind === 'state') {
      if (stateTarget) engine.setImportance(stateTarget, property, false);
      return;
    }
    engine.overrideStyle(property, shown?.value ?? '', element, { important: false });
  };

  const segments = SEGMENTED[property];
  const control = segments
    ? html`<heo-segmented
        .options=${segments}
        .value=${value || computed}
        clearable
        ?removable=${writesInline && Boolean(ownInline)}
        label=${property}
        @segment-change=${(event: CustomEvent<{ value: string }>) => commit(event.detail.value, event)}
      ></heo-segmented>`
    : html`<heo-value-field
        data-property=${property}
        .value=${value}
        ?important=${!pending && Boolean(shown?.important)}
        ?important-removable=${tagWrites}
        important-title=${shown && !tagWrites
      ? `!important in ${shortLabel(shown)}. Change it from the dot's popover.`
      : ''}
        ?pending=${Boolean(pending)}
        .kind=${valueKindFor(property)}
        .property=${property}
        .computed=${computed}
        .suggestions=${buildSuggestions(engine, property, element)}
        placeholder=${spec.placeholder ?? shorten(computed)}
        ?clearable=${writesInline && Boolean(ownInline)}
        @value-input=${(event: CustomEvent<{ value: string }>) => preview(event.detail.value)}
        @value-revert=${() => engine.cancelPreview()}
        @value-change=${(event: CustomEvent<{ value: string }>) => commit(event.detail.value, event)}
        @important-change=${removeImportant}
      ></heo-value-field>`;

  const resettable = writesInline && engine.canResetStyle(element, property);
  const baseline = resettable ? engine.styleBaseline(element, property) : null;
  const from = winner && winner.source.kind === 'rule' ? winner : null;

  return html`<div class="prow">
    <div
      class=${winner ? 'row set' : 'row'}
      data-property=${property}
      data-heo-part="row"
      data-row=${rowId}
    >
      ${renderCascadeDot({
    property,
    list,
    expanded,
    onToggle: () =>
      host.patch({ popover: expanded ? null : { scope, property, rowId }, menu: null }),
  })}
      <span class="name">
        <span class="pn" title=${property}>${property}</span>
        ${from
      ? html`<span class="from" title=${`From ${sourceLabel(from)}`}>${shortLabel(from)}</span>`
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
            @click=${() => engine.resetStyle(property, element)}
          >
            ${icon('undo', 11)}
          </button>`
      : nothing}
    </div>
    <div class="under">
      ${pending ? renderSaveBox(pending, host) : html`<span class="where">${whereHint(spec, winner, stateTarget, asks)}</span>`}
    </div>
  </div>`;
}

/** The one line under a focused row saying where an edit goes (R9). */
function whereHint(
  spec: RowSpec,
  winner: Contribution | undefined,
  stateTarget: WriteTarget | null,
  asks: boolean,
): TemplateResult {
  if (spec.scope.kind === 'state') {
    const state = spec.scope.state;
    const entry = spec.model.entries.find((one) =>
      one.target === stateTarget && one.state === state);
    if (!entry) return html`Edits the <b>${state}</b> rule`;
    const reach = spec.model.reach(entry.family);
    return html`Edits <b>${entry.selector}${entry.media ? ` ${mediaShort(entry.media)}` : ''}</b> ·
      ${reachText(reach)}`;
  }
  if (asks) return html`Depends on the viewport: after Enter, choose where it stays`;
  if (winner && winner.source.kind === 'rule') {
    return html`Overrides in the <b>inline style</b> · this element only · ${shortLabel(winner)} stays as is`;
  }
  if (winner) return html`Edits the <b>inline style</b> · this element only, at every size`;
  return html`Adds it to the <b>inline style</b> · this element only, at every size`;
}

export const propertyRowStyles: CSSResult = css`
  .rows {
    display: grid;
    gap: 6px;
  }
  .prow {
    display: grid;
    border-radius: var(--heo-r-sm);
  }
  /*
   * Dot slot · name · value · reset. The first two are fixed, so names line up with or without a
   * dot; the reset column collapses when there is nothing to reset, giving the value its width.
   */
  .row {
    display: grid;
    grid-template-columns: 20px 92px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
  }
  .row > .name {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    color: var(--heo-text-dim);
    font-family: var(--heo-mono);
    font-size: 10.5px;
    white-space: nowrap;
  }
  .row.set > .name {
    color: var(--heo-text);
  }
  /* The name keeps its room; the source hint takes what is left, and goes first when there is none. */
  .row .pn {
    flex: 0 0 auto;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The selector the value arrived from: an edit here overrides it rather than changing it. */
  .row .from {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--heo-accent-text);
    font-size: 9.5px;
    text-overflow: ellipsis;
  }
  .reset {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--heo-text-dim);
    cursor: pointer;
  }
  .reset:hover {
    background: var(--heo-hover);
    color: var(--heo-accent);
  }
  .reset:focus-visible,
  .dots:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }

  /* The dot, and the applying declarations it beats as crescents behind it. */
  .dots {
    display: inline-flex;
    align-items: center;
    width: 20px;
    height: 18px;
    padding: 0 3px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    --ring: var(--heo-bg);
  }
  .dots:hover,
  .dots[aria-expanded='true'] {
    --ring: var(--heo-hover);
    background: var(--heo-hover);
  }
  .dot,
  .moon {
    position: relative;
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--heo-accent);
    box-shadow: 0 0 0 1.5px var(--ring);
  }
  .dot {
    z-index: 4;
  }
  /* Nothing declares it: nothing at rest, a dim ring when the row is hovered, focused or open. */
  .dot.none {
    background: transparent;
    box-shadow: none;
  }
  .prow:hover .dot.none,
  .dots:focus-visible .dot.none,
  .dots[aria-expanded='true'] .dot.none {
    box-shadow: inset 0 0 0 1px var(--heo-text-dim);
  }
  /* Decorative: what they say is in the dot's name. */
  .moon {
    margin-left: -3.5px;
  }
  .moon:nth-child(2) {
    z-index: 3;
    opacity: 0.6;
  }
  .moon:nth-child(3) {
    z-index: 2;
    opacity: 0.4;
  }
  .moon:nth-child(4) {
    z-index: 1;
    opacity: 0.25;
  }

  /* Under the row: where an edit goes, while the row has focus; or the save box. */
  .under {
    padding-left: 26px;
  }
  .under .where {
    display: none;
    color: var(--heo-text-dim);
    font-size: 10px;
    line-height: 1.4;
  }
  .prow:focus-within .under .where {
    display: block;
    margin-top: 3px;
  }
  .under .where b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10px;
    font-weight: 400;
  }

  .flash {
    animation: heo-row-flash 1.2s ease-out;
  }
  @keyframes heo-row-flash {
    0%,
    35% {
      background: color-mix(in oklab, var(--heo-accent) 22%, transparent);
    }
    100% {
      background: transparent;
    }
  }
`;
