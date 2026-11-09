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
import { longhandsOf, shorthandGroups, splitImportant, type Declaration, type DisplayEntry } from '../../../core/declaration-list.js';
import { renderFamilies } from '../class-editor.js';
import { entryLabel, reachText, shortLabel } from '../../../core/save-plan.js';
import { mediaApplies } from '../../../core/viewport.js';
import { icon } from '../../icons.js';
import { buildSuggestions, valueKindFor } from '../../suggestions.js';
import { destinationParts, explainDestination, type AdderDestination } from './property-adder.js';
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
        .options=${offered.map((one) => ({ value: one.key, label: one.short ?? one.label, title: explainDestination(one, spec.property) }))}
        .value=${picked.key}
        label="Where it goes"
        wrap
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        if (event.detail.value) pick(event.detail.value);
      }}
      ></heo-segmented>
      <p class="explain">${explainDestination(picked, spec.property)}</p>`
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
function previewChosen(host: StylesHost, spec: RowSpec, picked: AdderDestination, text: string): void {
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
 * A list of rows, with a shorthand and its sides shown as one family when the same block declares
 * them: the control cards use, which says which comes last and so wins, and moves the other last.
 *
 * Only within one block. Written in different places (`padding` in `.card`, `padding-left` inline)
 * they do not compete by order but by the cascade, which the dot's popover shows and edits.
 */
export function renderPropertyRows(
  properties: readonly string[],
  specFor: (property: string) => RowSpec,
  host: StylesHost,
): TemplateResult {
  type Block = { target: WriteTarget; label: string; declarations: readonly Declaration[]; names: string[] };
  const blocks: Block[] = [];
  const blockOf = new Map<string, Block>();
  for (const property of properties) {
    const spec = specFor(property);
    const { list, shown: winner } = readRow(spec);
    /*
     * A side shown through its shorthand (the shorthand comes last and wins) still has its own
     * declaration in that block, beaten: that is the one to place, or flipping the family back
     * would have nothing to offer.
     */
    const shown = winner?.via
      ? list.applying.find((one) => !one.via && sameTarget(targetOf(one, spec.element), targetOf(winner, spec.element)))
      : winner;
    if (!shown || shown.via) continue;
    const target = targetOf(shown, spec.element);
    if (target.kind === 'readonly') continue;
    let block = blocks.find((one) => sameTarget(one.target, target));
    if (!block) {
      block = {
        target,
        label: shortLabel(shown),
        declarations: shown.source.kind === 'rule' ? shown.source.entry.declarations : spec.model.inline,
        names: [],
      };
      blocks.push(block);
    }
    block.names.push(property.toLowerCase());
    blockOf.set(property.toLowerCase(), block);
  }
  const familyOf = new Map<string, { group: ReturnType<typeof shorthandGroups>[number]; block: Block }>();
  for (const block of blocks) {
    // The block's own order, narrowed to what these rows show: that order is what decides.
    const listed = block.declarations.filter((one) => block.names.includes(one.property.toLowerCase()));
    for (const group of shorthandGroups(listed)) {
      for (const name of [group.shorthand, ...group.longhands]) familyOf.set(name.toLowerCase(), { group, block });
    }
  }
  const done = new Set<string>();
  const entries: Array<{ entry: DisplayEntry; block?: Block }> = [];
  for (const property of properties) {
    const key = property.toLowerCase();
    if (done.has(key)) continue;
    const family = familyOf.get(key);
    if (!family) {
      done.add(key);
      entries.push({ entry: { kind: 'row', property } });
      continue;
    }
    entries.push({ entry: { kind: 'family', group: family.group }, block: family.block });
    for (const name of [family.group.shorthand, ...family.group.longhands]) done.add(name.toLowerCase());
  }
  const renderRow = (property: string): TemplateResult => renderPropertyRow(specFor(property), host);
  return html`${entries.map(({ entry, block }) => {
    if (entry.kind === 'row' || !block) return renderRow(entry.kind === 'row' ? entry.property : entry.group.shorthand);
    // Writing a declaration again, as it is, moves it last in its block, which is what makes it win.
    const promote = (property: string): void => {
      const declared = [...block.declarations].reverse().find((one) => one.property.toLowerCase() === property.toLowerCase());
      if (!declared) return;
      host.engine.setDeclaration(block.target, property, `${declared.value}${declared.important ? ' !important' : ''}`);
    };
    return renderFamilies([entry], renderRow, promote, block.label);
  })}`;
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
          title="Choose where it goes"
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
  /* A segmented row's "where it goes", under the row while the row is in use. */
  .dest-line {
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
