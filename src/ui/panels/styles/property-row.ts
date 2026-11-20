import { leanBlockSelector } from '../../../core/block-rule-edit.js';
import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { isPseudoElement, mediaLabel } from '../../../core/breakpoints.js';
import type {
  CascadeContext,
  CascadeList,
  Contribution,
  ElementModel,
  RuleEntry,
  WriteTarget,
} from '../../../core/cascade.js';
import { longhandsOf, shorthandChain, shorthandGroups, splitImportant, type Declaration } from '../../../core/declaration-list.js';
import { renderFamilies } from '../class-editor.js';
import { entryLabel, reachText, shortLabel } from '../../../core/save-plan.js';
import { mediaApplies } from '../../../core/viewport.js';
import { defaultPlace, placesFor, type Place, type PlaceCondition } from '../../../core/cascade-places.js';
import { icon } from '../../icons.js';
import { buildSuggestions, shadowSwatches, valueKindFor } from '../../suggestions.js';
import { renderUses } from '../class-editor.js';
import type { RowScope, StylesHost } from './types.js';

/**
 * The one property row: Effective styles, its size and state groups, every category section and
 * In its parent all draw this, so a value means the same thing and an edit goes the same way
 * wherever it is made.
 *
 * Name · value · trash. The name is a button that opens the property's cascade ladder, where the
 * place the row edits is picked; it carries the reach chip when that place styles more than this
 * element, so an edit that changes other elements says so before it is typed. Without a pick the
 * row edits where its value is written under the row's condition, else the default place
 * (`defaultPlace`): inline at Element, the element's own class under a state or a size.
 *
 * The grid element keeps today's `div.row[data-property]` (fixtures find fields that way), inside
 * an attribute-less `div.prow` that also holds the row's side note.
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
  /**
   * What the row is called, when not its CSS name: Typography's "Line distance". The CSS name is
   * then the name's tooltip, and the cascade popover the name opens says it too.
   */
  label?: string;
  /** Drawn as a detail of the row before it, indented. */
  sub?: boolean;
  /** A segmented control instead of the value field, with these options. */
  segments?: Array<{ value: string; label?: string; icon?: string; title?: string; ariaLabel?: string }>;
  /** The `data-declarations` id of the list the row sits in. */
  listId: string;
  /**
   * Edit inline unless a place is picked, even where the value is written elsewhere: Typography
   * under a text style, whose class every element wearing the style shares.
   */
  preferInline?: boolean;
  /** A line under the row: a side written in another block than its shorthand says which wins. */
  note?: TemplateResult;
  /**
   * Show what this block itself declares for the property, even where the block's own shorthand
   * beats it. A family's side row: its value is the author's, not the shorthand's expansion.
   */
  ownIn?: WriteTarget;
}

/**
 * One line per source: a block that declares both a shorthand and its side competes with itself
 * by order, which its family control shows, so the cascade keeps only that block's winning line.
 */
export function onePerSource(contributions: readonly Contribution[]): Contribution[] {
  const out: Contribution[] = [];
  for (const one of contributions) {
    const block = one.source.kind === 'inline' ? 'inline' : one.source.entry.rule;
    if (out.some((kept) => (kept.source.kind === 'inline' ? 'inline' : kept.source.entry.rule) === block)) continue;
    out.push(one);
  }
  return out;
}

/** Whether two write targets are the same declaration block. */
export function sameTarget(a: WriteTarget, b: WriteTarget): boolean {
  switch (a.kind) {
    case 'inline':
      return b.kind === 'inline' && b.element === a.element;
    case 'live':
      return b.kind === 'live' && b.rule === a.rule;
    case 'class':
      return b.kind === 'class' && b.name === a.name;
    case 'design-rule':
      return b.kind === 'design-rule' && b.key === a.key;
    case 'block':
      return b.kind === 'block' && b.locator.blockId === a.locator.blockId && b.locator.selector === a.locator.selector &&
        b.locator.occurrence === a.locator.occurrence && b.locator.conditions.join('\n') === a.locator.conditions.join('\n');
    case 'readonly':
      return false;
  }
}

/* -------------------------------------------------------------------------- */
/* What a row shows                                                            */
/* -------------------------------------------------------------------------- */

/** Stable within one render: what popovers and destination picks name a row by. */
export function scopeKey(scope: RowScope, selected: HTMLElement): string {
  switch (scope.kind) {
    case 'element':
      return 'element';
    case 'size':
      return `size:${scope.slot}`;
    case 'state':
      return `state:${scope.state}${scope.slot && scope.slot !== 'base' ? `@${scope.slot}` : ''}`;
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

/**
 * The cascade a row reads: a size group at its slot's width, a group under another media query
 * with that query taken to hold, a state group in its state (under its media, when it has one).
 * So a group shows what the element renders with when its condition is in effect, not now.
 */
export function scopeContext(scope: RowScope, model: ElementModel): CascadeContext {
  const under = (slot: string | undefined): CascadeContext => {
    if (!slot || slot === 'base') return { width: null };
    if (slot.startsWith('other:')) return { width: null, media: slot.slice('other:'.length) };
    return { width: slotWidth(model, slot) };
  };
  if (scope.kind === 'size') return under(scope.slot);
  if (scope.kind === 'state') return { ...under(scope.slot), state: scope.state };
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


/** Where a value comes from, in full: `inline style`, `.card @media (min-width: 768px)`. */
export function sourceLabel(contribution: Contribution): string {
  if (contribution.source.kind === 'inline') return 'inline style';
  const entry = contribution.source.entry;
  return `${leanBlockSelector(entry.selector)}${entry.media ? ` @media ${entry.media}` : ''}`;
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
    // The group's own rule: this state under this media, whatever else would also apply then.
    const slot = scope.slot ?? 'base';
    // A pseudo-element group is drawn as it always was: any of its rules that applies now.
    const anyMedia = scope.slot === undefined && isPseudoElement(scope.state);
    const mine = (entry: RuleEntry): boolean =>
      entry.state === scope.state && (anyMedia ? model.applies(entry) : model.slotOf(entry) === slot);
    const own = list.applying.find((one) => one.source.kind === 'rule' && mine(one.source.entry));
    shown = own ?? winner;
    const entry =
      own?.source.kind === 'rule'
        ? own.source.entry
        : [...model.entries].reverse().find((one) => mine(one) && one.target.kind !== 'readonly');
    stateTarget = entry?.target ?? null;
  }
  /*
   * A side its block declares, under that block's shorthand: the side's own declaration, winning
   * or not. Shown as the shorthand's expansion instead, promoting the shorthand made every side
   * read as the shorthand's value, as though the sides had been rewritten; they had not.
   */
  const ownIn = spec.ownIn;
  if (ownIn) {
    shown = list.applying.find((one) => !one.via && sameTarget(targetOf(one, spec.element), ownIn)) ?? shown;
  }
  return { list, winner, shown, stateTarget };
}



export function shorten(value: string, max = 22): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/* -------------------------------------------------------------------------- */
/* The row                                                                     */
/* -------------------------------------------------------------------------- */

/** The block a contribution is in: the style attribute, or its rule. */
const blockOf = (one: Contribution): unknown => (one.source.kind === 'inline' ? 'inline' : one.source.entry.rule);

/** The condition a row is read and written under. */
export function rowCondition(scope: RowScope): PlaceCondition {
  if (scope.kind === 'size') return { media: scope.slot, state: '' };
  if (scope.kind === 'state') return { media: scope.slot ?? 'base', state: scope.state };
  return { media: 'base', state: '' };
}

/**
 * Where a row's edit goes: the ladder's places for it, the one its value is written in now, and the
 * one picked. The one question about where, asked the same way by the cascade menu, the row, and
 * every rich editor (box, border, background, motion), which write through their rows' picks.
 */
export interface RowPlace {
  cond: PlaceCondition;
  places: readonly Place[];
  /** The place the row's value is written in now, under the row's condition; null for none. */
  current: Place | null;
  picked: Place;
  rowId: string;
}

/** Whether a rule's declaration is written under the row's own condition. */
function underCondition(spec: RowSpec, cond: PlaceCondition, one: Contribution): boolean {
  if (one.source.kind === 'inline') return cond.media === 'base' && !cond.state;
  const entry = one.source.entry;
  if (entry.state !== cond.state) return false;
  // At Element any size that applies now is where the value is; a pseudo-element group reads any.
  if (cond.media === 'base') return !cond.state || isPseudoElement(cond.state) || entry.media === null;
  return spec.model.slotOf(entry) === cond.media;
}

/** The places for one row and its pick, built from `placesFor` and the panel's `ui.places`. */
export function rowPlace(spec: RowSpec, host: StylesHost, rowId = rowIdOf(spec.scope, spec.property, host.element)): RowPlace {
  const cond = rowCondition(spec.scope);
  const { shown } = readRow(spec);
  const named = host.ui.newClass?.rowId === rowId ? host.ui.newClass.name.trim() : '';
  const places = placesFor(spec.model, spec.property, cond, spec.element, {
    ownedClass: (name) => host.engine.classes.get(name) ?? null,
  }).map((place) => place.key.startsWith('new-class|') && named && place.dest.kind === 'auto-class'
    ? { ...place, label: `.${named.replace(/^\./, '')}`, dest: { ...place.dest, name: named } }
    : place);
  const writable = (place: Place | undefined): Place | undefined =>
    place && place.target?.kind !== 'readonly' ? place : undefined;
  const current = shown
    ? places.find((place) => place.declared && blockOf(place.declared) === blockOf(shown)) ?? null
    : null;
  const pickedKey = host.ui.places.get(rowId);
  /*
   * A value read from somewhere outside the row's condition (the rule at rest, under a hover) is
   * not where the row writes: that would change the element at rest, or every element the rule
   * styles. The default place is, as for a new declaration (decision 8).
   */
  const picked =
    writable(places.find((place) => place.key === pickedKey)) ??
    (spec.preferInline ? places.find((place) => place.key === 'inline') : undefined) ??
    (shown && underCondition(spec, cond, shown) ? writable(current ?? undefined) : undefined) ??
    defaultPlace(spec.model, spec.element, cond, places);
  return { cond, places, current, picked, rowId };
}

const isInlinePlace = (place: Place | null | undefined): boolean =>
  place?.dest.kind === 'target' && place.dest.target.kind === 'inline';

/**
 * Write one value where the row's place says: the element's own value moves when another place is
 * picked for it, so the inline copy does not go on beating it. Empty removes the element's own
 * value; a shared rule's declaration is removed with the trash, which asks first. A pending
 * `!important` asked for on an empty place goes in with the first value.
 */
export function writeChosen(
  host: StylesHost,
  spec: RowSpec,
  choice: RowPlace,
  shown: Contribution | undefined,
  text: string,
): void {
  const { engine } = host;
  const { property, element } = spec;
  const { picked, current } = choice;
  engine.cancelPreview();
  const typed = splitImportant(text);
  if (!typed.value) {
    if (isInlinePlace(picked)) engine.overrideStyle(property, '', element);
    return;
  }
  if (picked === current && shown && typed.important === null && shown.value === typed.value) return;
  const pendingKey = `${choice.rowId}|${picked.key}`;
  const pending = host.ui.pendingImportant.has(pendingKey);
  const written = pending && typed.important === null ? `${typed.value} !important` : text;
  if (pending) {
    const next = new Set(host.ui.pendingImportant);
    next.delete(pendingKey);
    host.patch({ pendingImportant: next });
  }
  // A new class, once made, is the class the row's value is in: the row follows it from there.
  if (picked.key.startsWith('new-class|')) {
    const places = new Map(host.ui.places);
    places.delete(choice.rowId);
    host.patch({ places, newClass: null });
  }
  const moving = isInlinePlace(current) && !isInlinePlace(picked);
  const { hint } = engine.writeDeclarationTo(picked.dest, property, written, moving ? { move: element } : {});
  if (hint) engine.notify(hint, 'info');
}

/** Paint a value being typed where the place would write it. */
export function previewChosen(host: StylesHost, spec: RowSpec, picked: Place, text: string): void {
  const { engine } = host;
  const { property, element, model } = spec;
  if (isInlinePlace(picked)) {
    const typed = splitImportant(text);
    const strong = typed.important === null && typed.value && needsImportant(model, property);
    engine.previewStyle(property, strong ? `${typed.value} !important` : text, element);
  } else if (picked.dest.kind === 'target' && picked.dest.target.kind !== 'readonly') {
    engine.previewDeclaration(picked.dest.target, property, text);
  } else {
    // A rule or class not made yet shows once it is written.
    engine.cancelPreview();
  }
}

/**
 * The trash: removes the declaration the row shows, where it is written. One the element alone
 * wears goes at once; one in a rule other elements wear too asks first, since they change with it.
 */
function removeShown(host: StylesHost, spec: RowSpec, shown: Contribution): void {
  const { engine, model } = host;
  const declared = shown.via ?? spec.property;
  if (shown.source.kind === 'inline') {
    engine.overrideStyle(declared, '', spec.element);
    return;
  }
  const entry = shown.source.entry;
  const label = entryLabel(entry);
  const reach = model.reach(entry.family);
  const remove = (): void => engine.removeDeclaration(entry.target, declared);
  if (reach <= 1) {
    remove();
    return;
  }
  engine.askToConfirm({
    title: `Remove ${declared} from ${label}?`,
    message: `${label} styles ${reachText(reach)}: removing ${declared} changes all of them, not only this one.`,
    confirmLabel: `Remove ${declared}`,
    tone: 'danger',
    reversible: true,
    run: remove,
  });
}

/**
 * A list of rows, with each shorthand and its sides together.
 *
 * A family is the shorthand's own block (where its winning value is written) and every side that
 * block declares too: they compete by order there, and the control cards use says which comes
 * last and moves the other last. Whether a side's overall winner is that block or another (an
 * important class rule, say) does not decide this: the block still holds both, in an order.
 *
 * A side written only in another block (`margin` inline, `margin-right` in a class) is listed under
 * its shorthand too, with no order control, since order does not decide between two blocks: its
 * note says which wins by the cascade, and its dot is where that is changed.
 */
export function renderPropertyRows(
  properties: readonly string[],
  specFor: (property: string) => RowSpec,
  host: StylesHost,
): TemplateResult {
  type Block = { target: WriteTarget; label: string; declarations: readonly Declaration[] };
  const names = properties.map((one) => one.toLowerCase());
  const declares = (block: Block, property: string): boolean =>
    block.declarations.some((one) => one.property.toLowerCase() === property);
  // The shorthand a side is listed under: its outermost one among these rows.
  const ownerOf = (property: string): string | undefined =>
    shorthandChain(property).filter((name) => names.includes(name)).pop();

  /* Each shorthand's block, from its winning declaration. */
  const blockOf = new Map<string, Block>();
  for (const property of names) {
    if (!longhandsOf(property).length) continue;
    const spec = specFor(property);
    const { shown } = readRow(spec);
    if (!shown || shown.via) continue;
    const target = targetOf(shown, spec.element);
    if (target.kind === 'readonly') continue;
    blockOf.set(property, {
      target,
      label: shortLabel(shown),
      declarations: shown.source.kind === 'rule' ? shown.source.entry.declarations : spec.model.inline,
    });
  }
  /* Its sides among these rows: in its block, or written elsewhere. */
  const sidesOf = new Map<string, { inBlock: string[]; elsewhere: string[] }>();
  for (const property of names) {
    const owner = ownerOf(property);
    if (!owner) continue;
    const block = blockOf.get(owner);
    const sides = sidesOf.get(owner) ?? { inBlock: [], elsewhere: [] };
    if (block && declares(block, property)) sides.inBlock.push(property);
    else sides.elsewhere.push(property);
    sidesOf.set(owner, sides);
  }

  const renderRow = (property: string, note?: TemplateResult): TemplateResult =>
    renderPropertyRow({ ...specFor(property), ...(note ? { note } : {}) }, host);
  /** Under its shorthand, from another block: which of the two wins, by the cascade. */
  const elsewhereNote = (side: string, shorthand: string): TemplateResult => {
    const block = blockOf.get(shorthand);
    const { shown } = readRow(specFor(side));
    const from = block?.label ?? shorthand;
    const sideWins = Boolean(shown) && !shown!.via;
    return sideWins
      ? html`Wins over <b>${shorthand}</b> in <b>${from}</b> by the cascade`
      : html`Overridden by <b>${shorthand}</b> in <b>${from}</b>`;
  };

  const done = new Set<string>();
  const out: TemplateResult[] = [];
  for (const property of properties) {
    const key = property.toLowerCase();
    if (done.has(key)) continue;
    const owner = sidesOf.has(key) ? key : ownerOf(key);
    if (!owner || !sidesOf.has(owner)) {
      done.add(key);
      out.push(renderRow(property));
      continue;
    }
    const shorthand = properties.find((one) => one.toLowerCase() === owner) ?? owner;
    const { inBlock, elsewhere } = sidesOf.get(owner)!;
    const block = blockOf.get(owner);
    for (const name of [owner, ...inBlock, ...elsewhere]) done.add(name);
    const display = (name: string): string => properties.find((one) => one.toLowerCase() === name) ?? name;
    const others = elsewhere.length
      ? html`<div class="fam-elsewhere">${elsewhere.map((side) => renderRow(display(side), elsewhereNote(side, owner)))}</div>`
      : nothing;
    if (!inBlock.length || !block) {
      out.push(html`<div class="family-loose">${renderRow(shorthand)}${others}</div>`);
      continue;
    }
    // The block's own order, narrowed to what these rows show: that order is what decides.
    const listed = block.declarations.filter((one) => [owner, ...inBlock].includes(one.property.toLowerCase()));
    const group = shorthandGroups(listed).find((one) => one.shorthand.toLowerCase() === owner);
    if (!group) {
      out.push(html`<div class="family-loose">${renderRow(shorthand)}${inBlock.map((side) => renderRow(display(side)))}${others}</div>`);
      continue;
    }
    // Writing a declaration again, as it is, moves it last in its block, which is what makes it win.
    const promote = (name: string): void => {
      const declared = [...block.declarations].reverse().find((one) => one.property.toLowerCase() === name.toLowerCase());
      if (!declared) return;
      host.engine.setDeclaration(block.target, name, `${declared.value}${declared.important ? ' !important' : ''}`);
    };
    // A side its block declares, beaten by another block anyway (an important class rule): the order
    // here still decides within the block, and its note says what wins over both.
    const inBlockRow = (name: string): TemplateResult => {
      const spec = specFor(name);
      const { shown } = readRow(spec);
      const beatenElsewhere = shown && !shown.via && !sameTarget(targetOf(shown, spec.element), block.target);
      const note = beatenElsewhere ? html`<b>${shortLabel(shown!)}</b> wins over this block by the cascade` : undefined;
      // The side's own value in this block, whichever of the family wins.
      return renderPropertyRow({ ...spec, ownIn: block.target, ...(note ? { note } : {}) }, host);
    };
    out.push(html`${renderFamilies([{ kind: 'family', group }], inBlockRow, promote, block.label)}${others}`);
  }
  return html`${out}`;
}

export function renderPropertyRow(spec: RowSpec, host: StylesHost): TemplateResult {
  const { property, scope, element } = spec;
  const engine = host.engine;
  const rowId = rowIdOf(scope, property, host.element);
  const { winner, shown } = readRow(spec);
  const pseudo = scope.kind === 'state' && isPseudoElement(scope.state);
  const computed = (pseudo ? getComputedStyle(element, scope.state) : getComputedStyle(element))
    .getPropertyValue(property)
    .trim();
  const value = shownValue(shown);
  const expanded = host.ui.popover?.rowId === rowId;
  const choice = rowPlace(spec, host, rowId);
  const { picked, current } = choice;

  /*
   * Who may drop a shown `!important` from the field's tag: a row writing the declaration it shows.
   * A rule's importance shown while another place is picked is not this edit's to change; the tag
   * stays text and points to the cascade menu, where that place's own toggle is.
   */
  const tagWrites = Boolean(shown && current && picked === current);
  const commit = (text: string): void => writeChosen(host, spec, choice, shown, text);
  const removeImportant = (): void => {
    if (!shown) return;
    if (shown.source.kind === 'inline') engine.overrideStyle(property, shown.value, element, { important: false });
    else engine.setImportance(shown.source.entry.target, shown.via ?? property, false);
  };

  const segments = spec.segments ?? SEGMENTED[property];
  const control = segments
    ? html`<heo-segmented
        .options=${segments}
        .value=${value || computed}
        clearable
        label=${spec.label ?? property}
        @segment-change=${(event: CustomEvent<{ value: string }>) => commit(event.detail.value)}
      ></heo-segmented>`
    : html`<heo-value-field
        data-property=${property}
        list-min-width="280"
        .value=${value}
        ?important=${Boolean(shown?.important)}
        ?important-removable=${tagWrites}
        important-title=${shown && !tagWrites
        ? `!important in ${shortLabel(shown)}. Change it from the name's cascade menu.`
        : ''}
        .kind=${valueKindFor(property)}
        .property=${property}
        .computed=${computed}
        .suggestions=${buildSuggestions(engine, property, element)}
        .shadowTokens=${valueKindFor(property) === 'shadow' || valueKindFor(property) === 'filter' ? shadowSwatches(engine) : []}
        placeholder=${spec.placeholder ?? shorten(computed)}
        @value-input=${(event: CustomEvent<{ value: string }>) => previewChosen(host, spec, picked, event.detail.value)}
        @value-revert=${() => engine.cancelPreview()}
        @value-change=${(event: CustomEvent<{ value: string }>) => commit(event.detail.value)}
        @important-change=${removeImportant}
      ></heo-value-field>`;

  const removable = shown && targetOf(shown, element).kind !== 'readonly' ? shown : null;
  const where = `${picked.label}${picked.media ? ` ${mediaLabel(picked.media)}` : ''}`;
  const label = `${property}: ${winner ? `from ${shortLabel(winner)}` : 'not declared for this element'}; edits ${where}, ${
    picked.reach === 1 ? 'only this element' : reachText(picked.reach)}. Show cascade`;

  return html`<div class="prow">
    <div
      class=${winner ? 'row set' : 'row'}
      data-property=${property}
      data-heo-part="row"
      data-row=${rowId}
    >
      <button
        class="dots"
        type="button"
        aria-haspopup="dialog"
        aria-expanded=${expanded ? 'true' : 'false'}
        aria-label=${label}
        title=${label}
        @click=${() => {
      host.patch({ popover: expanded ? null : { scope, property, rowId }, menu: null, cardPop: null });
      // Closed by its name, focus is on the name: Safari does not focus a pressed button by itself.
      if (expanded) host.focusSelector(`.row[data-row="${CSS.escape(rowId)}"] .dots`);
    }}
      >
        <span class="name" title=${spec.label ? property : ''}>
          <span class=${spec.label ? `pn label${spec.sub ? ' sub' : ''}` : 'pn'}>${spec.label ?? property}</span>
          ${picked.reach > 1 ? renderUses(picked.reach) : nothing}
        </span>
      </button>
      ${control}
      ${removable
      ? html`<button
            class="kill tight reset"
            type="button"
            aria-label=${`Remove ${removable.via ?? property} from ${shortLabel(removable)}`}
            title=${`Remove ${removable.via ?? property} from ${shortLabel(removable)}`}
            @click=${() => removeShown(host, spec, removable)}
          >
            ${icon('trash', 11)}
          </button>`
      : nothing}
    </div>
    ${spec.note ? html`<p class="side-note">${spec.note}</p>` : nothing}
  </div>`;
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
   * Name · value · trash. The trash column is kept when there is nothing to remove, so every value
   * field in the panel ends at the same line.
   */
  .row {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr) 18px;
    align-items: center;
    gap: 6px;
  }
  .row .name {
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
  .row.set .name {
    color: var(--heo-text);
  }
  /* The name takes what the reach chip leaves; the chip is never cut. */
  .row .pn {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* A row named for what it does (Typography's "Line distance"): in the panel's own type. */
  .row .pn.label {
    font-family: var(--heo-font, inherit);
    font-size: 11px;
    letter-spacing: 0;
    text-transform: none;
  }
  .row .pn.label.sub {
    padding-left: 10px;
    color: var(--heo-text-dim);
  }
  .dots:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }

  /* The name is the cascade menu's button: the whole name column opens it. */
  .dots {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 24px;
    margin: 0 -2px;
    padding: 0 2px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .dots:hover,
  .dots[aria-expanded='true'] {
    background: var(--heo-hover);
  }
  /*
   * The reach chip on an opaque base: over the glass panel on a white page its orange ink read
   * 4.15:1 (a11y-contrast styles.reachChip).
   */
  .dots .uses {
    flex: 0 0 auto;
  }
  .dots .uses.many {
    background: color-mix(in oklab, var(--heo-shared) 20%, var(--heo-raised));
  }
  /*
   * A side written in another block than its shorthand: under it, indented and ruled like a family's
   * sides, but solid-free (dotted) and with no order control, since the cascade decides, not order.
   */
  .fam-elsewhere,
  .family-loose > .fam-elsewhere {
    display: grid;
    gap: 6px;
    margin-left: 23px;
    padding-left: 7px;
    border-left: 2px dotted var(--heo-line-strong);
  }
  .family-loose {
    display: grid;
    gap: 6px;
  }
  .side-note {
    margin: 2px 0 0;
    color: var(--heo-text-dim);
    font-size: 10px;
    line-height: 1.4;
  }
  .side-note b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
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
