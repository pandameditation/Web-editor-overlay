import { leanBlockSelector } from '../../../core/block-rule-edit.js';
import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { isPseudoElement } from '../../../core/breakpoints.js';
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
import { icon } from '../../icons.js';
import { buildSuggestions, shadowSwatches, valueKindFor } from '../../suggestions.js';
import { composeFilter, formatShadows, splitFilter } from '../../../core/shadow.js';
import type { HeoValueField } from '../../controls/value-field.js';
import type { ShadowConvert } from '../../controls/shadow-editor.js';
import { destinationParts, displayName, explainDestination, type AdderDestination } from './property-adder.js';
import { renderMenu } from './menu.js';
import type { RowScope, StylesHost } from './types.js';

/**
 * The one property row: Effective styles, its size and state groups, every category section and
 * In its parent all draw this, so a value means the same thing and an edit goes the same way
 * wherever it is made.
 *
 * Left of the name sits a dot that is a button: it opens the cascade for the property, and its
 * crescents count the applying declarations the winner beats. The name says where the winning
 * value comes from. In Effective styles an edit goes where the value is written now, or wherever
 * the switch at the head of its value list says. Elsewhere it writes an inline override by
 * default, asks where it should stay when the value depends on the viewport, and writes into the
 * state's own rule in a state group.
 *
 * The grid element keeps today's `div.row[data-property]` (fixtures find fields that way), inside
 * an attribute-less `div.prow` that also holds a segmented row's destination line under it.
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
  /**
   * Effective styles: where an edit can go, offered as a switch at the head of the value's list.
   * The row's current source is picked until another is, and the panel includes it.
   */
  destinations?: readonly AdderDestination[];
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

/** The destination a row's value is written in now, among those offered, or null. */
function currentDestination(
  destinations: readonly AdderDestination[],
  shown: Contribution | undefined,
  element: HTMLElement,
): AdderDestination | null {
  const now: WriteTarget = shown ? targetOf(shown, element) : { kind: 'inline', element };
  return destinations.find((one) => one.dest?.kind === 'target' && sameTarget(one.dest.target, now)) ?? null;
}
const isInline = (one: AdderDestination | null | undefined): boolean =>
  one?.dest?.kind === 'target' && one.dest.target.kind === 'inline';

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
  /** Drawn inside the button after the dot: the property's name and where its value comes from. */
  name?: TemplateResult;
}): TemplateResult {
  const winner = spec.list.applying[0];
  const beaten = Math.max(0, onePerSource(spec.list.applying).length - 1);
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
    <span class="marks" aria-hidden="true">
      <span class=${winner ? 'dot' : 'dot none'}></span>
      ${Array.from({ length: Math.min(beaten, 3) }, () => html`<span class="moon"></span>`)}
    </span>
    ${spec.name ?? nothing}
  </button>`;
}

/* -------------------------------------------------------------------------- */
/* The row                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a row's edit goes: the destinations offered for it, the one its value is written in now,
 * and the one picked (the current one until the user picks another). The one question about
 * where, asked the same way by a value list's switch, a segmented row's line and the box editor.
 */
export interface DestinationChoice {
  offered: readonly AdderDestination[];
  current: AdderDestination | null;
  picked: AdderDestination;
  pick(key: string): void;
  /** Alt+Left/Right from a field: the next destination either way. */
  step(delta: number): void;
  /** The switch and its line, for a value list's head; null with one place to write. */
  head: TemplateResult | null;
}

export function destinationChoice(spec: RowSpec, host: StylesHost, rowId: string, shown: Contribution | undefined): DestinationChoice {
  const offered = spec.destinations?.length ? spec.destinations : host.destinationsFor(spec);
  const current = currentDestination(offered, shown, spec.element);
  const pickedKey = host.ui.rowDest?.rowId === rowId ? host.ui.rowDest.key : current?.key;
  const picked = offered.find((one) => one.key === pickedKey) ?? current ?? offered[0];
  const pick = (key: string): void => {
    host.engine.cancelPreview();
    host.patch({ rowDest: { rowId, key }, menu: null });
  };
  const step = (delta: number): void => {
    const keys = offered.map((one) => one.key);
    pick(keys[(keys.indexOf(picked.key) + delta + keys.length) % keys.length]);
  };
  const head = offered.length > 1
    ? html`<heo-segmented
        .options=${offered.map((one) => ({ value: one.key, label: displayName(one.short ?? one.label, 24), title: explainDestination(one, spec.property, true) }))}
        .value=${picked.key}
        label="Where it goes"
        wrap
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        if (event.detail.value) pick(event.detail.value);
      }}
      ></heo-segmented>
      <p class="explain" title=${explainDestination(picked, spec.property, true)}>${explainDestination(picked, spec.property)}</p>`
    : null;
  return { offered, current, picked, pick, step, head };
}

/**
 * Write one value where the choice says: the element's own value moves when another destination is
 * picked for it, so the inline copy does not go on beating it. Empty removes the element's own
 * value; a shared rule's declaration is removed with the trash, which asks first.
 */
export function writeChosen(
  host: StylesHost,
  spec: RowSpec,
  choice: DestinationChoice,
  shown: Contribution | undefined,
  text: string,
): void {
  const { engine } = host;
  const { property, element } = spec;
  const { picked, current } = choice;
  host.patch({ rowDest: null });
  engine.cancelPreview();
  const typed = splitImportant(text);
  if (!typed.value) {
    if (isInline(picked)) engine.overrideStyle(property, '', element);
    return;
  }
  if (picked === current && shown && typed.important === null && shown.value === typed.value) return;
  if (!picked.dest) return;
  const moving = isInline(current) && !isInline(picked);
  const { hint } = engine.writeDeclarationTo(picked.dest, property, text, moving ? { move: element } : {});
  if (hint) engine.notify(hint, 'info');
}

/** Paint a value being typed where the choice would write it. */
export function previewChosen(host: StylesHost, spec: RowSpec, picked: AdderDestination, text: string): void {
  const { engine } = host;
  const { property, element, model } = spec;
  if (isInline(picked)) {
    const typed = splitImportant(text);
    const strong = typed.important === null && typed.value && needsImportant(model, property);
    engine.previewStyle(property, strong ? `${typed.value} !important` : text, element);
  } else if (picked.dest?.kind === 'target') {
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
  const { list, winner, shown } = readRow(spec);
  const pseudo = scope.kind === 'state' && isPseudoElement(scope.state);
  const computed = (pseudo ? getComputedStyle(element, scope.state) : getComputedStyle(element))
    .getPropertyValue(property)
    .trim();
  const value = shownValue(shown);
  const expanded = host.ui.popover?.rowId === rowId;
  const choice = destinationChoice(spec, host, rowId, shown);
  const { picked, current } = choice;

  /*
   * Who may drop a shown `!important` from the field's tag: a row writing the declaration it shows.
   * A rule's importance shown while another destination is picked is not this edit's to change; the
   * tag stays text and points to the popover, where that rule's own line has the toggle.
   */
  const tagWrites = Boolean(shown && current && picked === current);
  const commit = (text: string): void => writeChosen(host, spec, choice, shown, text);
  /*
   * box-shadow ↔ filter: drop-shadow(): the shadows move to the other property, where the same
   * destination is written, and the editor opens again on that row so editing carries on.
   * The property being left becomes `none`, or the filter's other functions.
   */
  const convertShadows = (event: CustomEvent<ShadowConvert>): void => {
    event.stopPropagation();
    const { to, shadows, rest, lost } = event.detail;
    const source = event.target as HeoValueField;
    /*
     * A shadow with a spread or an inset loses it as a drop shadow. Said once, as a question, at
     * the moment of converting, rather than as a standing warning under the box.
     */
    if (lost) {
      engine.askToConfirm({
        title: 'Convert to drop-shadow()?',
        message:
          `drop-shadow() has no spread or inset, so ${lost === 1 ? 'one shadow loses' : `${lost} shadows lose`} ` +
          'them on the way. Undo takes the conversion back.',
        confirmLabel: 'Convert',
        dismissLabel: 'Keep box-shadow',
        tone: 'warn',
        reversible: true,
        run: () => convertNow(to, shadows, rest, source),
      });
      return;
    }
    convertNow(to, shadows, rest, source);
  };
  const convertNow = (
    to: ShadowConvert['to'],
    shadows: ShadowConvert['shadows'],
    rest: string,
    source: HeoValueField,
  ): void => {
    source.closePopup();
    const otherSpec: RowSpec = { ...spec, property: to };
    const other = shownValue(readRow(otherSpec).shown) || 'none';
    let next: string;
    if (to === 'filter') {
      // Drop shadows already in the filter are replaced; its other functions stay where they are.
      const split = splitFilter(other) ?? { others: [], drops: [], at: 0 };
      next = composeFilter(split.others, shadows, split.at);
    } else {
      next = formatShadows(shadows, 'box');
    }
    // The field captured when the event arrived: after a confirmation the event has no target left.
    const root = source.getRootNode() as ParentNode;
    commit(rest);
    writeChosen(host, otherSpec, choice, undefined, next);
    // Open again where the shadows went, once the panel has drawn the new values.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const field = root.querySelector<HeoValueField>(`heo-value-field[data-property="${to}"]`);
      field?.openShadowEditor();
    }));
  };
  const removeImportant = (): void => {
    if (!shown) return;
    if (shown.source.kind === 'inline') engine.overrideStyle(property, shown.value, element, { important: false });
    else engine.setImportance(shown.source.entry.target, shown.via ?? property, false);
  };

  const segments = SEGMENTED[property];
  const menuId = `dest-${rowId}`;
  const menuOpen = host.ui.menu?.id === menuId;
  const control = segments
    ? html`<heo-segmented
        .options=${segments}
        .value=${value || computed}
        clearable
        label=${property}
        @segment-change=${(event: CustomEvent<{ value: string }>) => commit(event.detail.value)}
      ></heo-segmented>`
    : html`<heo-value-field
        data-property=${property}
        .value=${value}
        ?important=${Boolean(shown?.important)}
        ?important-removable=${tagWrites}
        important-title=${shown && !tagWrites
        ? `!important in ${shortLabel(shown)}. Change it from the dot's popover.`
        : ''}
        .head=${choice.head}
        @head-step=${(event: CustomEvent<{ delta: number }>) => choice.step(event.detail.delta)}
        .kind=${valueKindFor(property)}
        .property=${property}
        .computed=${computed}
        .suggestions=${buildSuggestions(engine, property, element)}
        .shadowTokens=${valueKindFor(property) === 'shadow' || property === 'filter' ? shadowSwatches(engine) : []}
        ?shadow-convertible=${property === 'box-shadow' || property === 'filter'}
        @shadow-convert=${(event: CustomEvent<ShadowConvert>) => convertShadows(event)}
        placeholder=${spec.placeholder ?? shorten(computed)}
        @value-input=${(event: CustomEvent<{ value: string }>) => previewChosen(host, spec, picked, event.detail.value)}
        @value-revert=${() => engine.cancelPreview()}
        @value-change=${(event: CustomEvent<{ value: string }>) => commit(event.detail.value)}
        @important-change=${removeImportant}
      ></heo-value-field>`;

  const removable = shown && targetOf(shown, element).kind !== 'readonly' ? shown : null;
  const from = winner && winner.source.kind === 'rule' ? winner : null;

  /*
   * A segmented row has no value list to hold the switch, so its line sits under the row while the
   * row is in use, the destination a menu in it. Focusable, so a press in the line keeps it open.
   */
  const parts = destinationParts(picked, property);
  const destLine = segments && choice.offered.length > 1
    ? html`<p class=${menuOpen || host.ui.rowDest?.rowId === rowId ? 'dest-line on' : 'dest-line'} tabindex="-1">
        ${parts.verb}
        <button
          class="dest-pick"
          type="button"
          aria-haspopup="menu"
          aria-expanded=${menuOpen ? 'true' : 'false'}
          data-menu-anchor=${menuId}
          title=${`Choose where it goes. Now: ${parts.fullName}`}
          @click=${() => host.toggleMenu(menuId, !menuOpen)}
        >${parts.name} ${icon('chevronDown', 10)}</button>
        ${parts.media} • impacting ${parts.impact}
      </p>
      ${menuOpen
        ? renderMenu({
          id: menuId,
          label: 'Where it goes',
          groups: [{
            caption: 'Where it goes',
            items: choice.offered.map((one) => ({
              key: one.key,
              label: destinationParts(one, property).name,
              title: destinationParts(one, property).fullName,
              note: destinationParts(one, property).impact,
              checked: one.key === picked.key,
              onSelect: () => choice.pick(one.key),
            })),
          }],
          onClose: () => host.toggleMenu(menuId, false),
        })
        : nothing}`
    : nothing;

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
    onToggle: () => {
      host.patch({ popover: expanded ? null : { scope, property, rowId }, menu: null, cardPop: null });
      // Closed by its dot, focus is on the dot: Safari does not focus a pressed button by itself.
      if (expanded) host.focusSelector(`.row[data-row="${CSS.escape(rowId)}"] .dots`);
    },
    // The name and its source open the cascade too: one target, with the dot's tooltip over all of it.
    name: html`<span class="name">
        <span class="pn">${property}</span>
        ${from ? html`<span class="from">${shortLabel(from)}</span>` : nothing}
      </span>`,
  })}
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
    ${destLine}
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
   * Dot slot · name · value · trash: a card's row with the dot in front. The trash column is kept
   * when there is nothing to remove, so every value field in the panel ends at the same line.
   */
  .row {
    display: grid;
    grid-template-columns: 20px 92px minmax(0, 1fr) 18px;
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
  .dots:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }

  /*
   * The dot, and the declarations it beats behind it: the winner a plain accent dot, each override
   * an empty grey circle tucked under its right edge, at most three. Nothing rings the dot: the
   * row's own surface shows around it.
   */
  /*
   * The cascade's button spans the dot's slot and the name's column: the dot, the property and its
   * source are one target, so the cascade opens from anywhere on the left of the row.
   */
  .dots {
    display: grid;
    grid-column: 1 / span 2;
    grid-template-columns: 20px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
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
  .dots .marks {
    display: inline-flex;
    align-items: center;
    padding: 0 3px;
  }
  .dots:hover,
  .dots[aria-expanded='true'] {
    background: var(--heo-hover);
  }
  .dot,
  .moon {
    position: relative;
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 999px;
  }
  .dot {
    z-index: 4;
    background: var(--heo-accent);
  }
  /* Nothing declares it: nothing at rest, a dim ring when the row is hovered, focused or open. */
  .dot.none {
    background: transparent;
  }
  .prow:hover .dot.none,
  .dots:focus-visible .dot.none,
  .dots[aria-expanded='true'] .dot.none {
    box-shadow: inset 0 0 0 1px var(--heo-text-dim);
  }
  /* Decorative: what they say is in the dot's name. */
  .moon {
    margin-left: -3px;
    box-shadow: inset 0 0 0 1px var(--heo-text-faint);
  }
  .moon:nth-child(2) {
    z-index: 3;
  }
  .moon:nth-child(3) {
    z-index: 2;
  }
  .moon:nth-child(4) {
    z-index: 1;
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
    margin: 2px 0 0 26px;
    color: var(--heo-text-dim);
    font-size: 10px;
    line-height: 1.4;
  }
  .side-note b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-weight: 400;
  }
  /* A segmented row's "where it goes", under the row while the row is in use. */
  .dest-line {
    overflow-wrap: anywhere;
    display: none;
    margin: 4px 0 0 26px;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.5;
    outline: none;
  }
  .prow:focus-within .dest-line,
  .dest-line.on {
    display: block;
  }
  .dest-pick {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 4px 0 6px;
    border: 1px solid var(--heo-line-strong);
    border-radius: 999px;
    background: var(--heo-raised);
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10.5px;
    cursor: pointer;
  }
  .dest-pick:hover {
    border-color: var(--heo-accent-line);
  }
  .dest-pick:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
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
