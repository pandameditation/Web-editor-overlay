import { leanBlockSelector } from '../../../core/block-rule-edit.js';
import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { EDITABLE_STATES, isPseudoElement, isWidthQuery, mediaNow, mediaShort, needsGeneratedContent, pseudoElementNamed } from '../../../core/breakpoints.js';
import { classFamily, type Family, type RuleEntry, type WriteTarget } from '../../../core/cascade.js';
import { simpleClassName } from '../../../core/classes.js';
import { escapeRegExp } from '../../../core/css.js';
import {
  displayOrder,
  shorthandGroups,
  toRecord,
  type Declaration,
} from '../../../core/declaration-list.js';
import { countText, reachText } from '../../../core/save-plan.js';
import { mediaApplies } from '../../../core/viewport.js';
import { field } from '../../form-errors.js';
import { icon } from '../../icons.js';
import { renderKill } from '../../kill.js';
import {
  ClassEditor,
  initialValueFor,
  renderCardHeader,
  renderDeclarationRow,
  renderFamilies,
  type DeclarationTarget,
} from '../class-editor.js';
import { renderAdder, stylesDestination, valueStepDraft, type AdderDestination } from './property-adder.js';
import { bestRow, renderSearchField, renderSearchPopover } from './search-popover.js';
import { pseudoElementSuggestions } from '../../suggestions.js';
import type { HeoValueField } from '../../controls/value-field.js';
import { previewSlot } from './property-row.js';
import {
  barConditions,
  conditionKey,
  conditionName,
  conditionOf,
  conditionParts,
  mediaKeyFor,
  remainingConditions,
  renderConditionBar,
  slotMedia,
  slotName,
  type BarChip,
} from './size-strip.js';
import type { PendingState, StylesHost } from './types.js';
import type { CssPasteOptions } from '../../../core/editor.js';

/**
 * Where an element's styles are written, one card per place.
 *
 * Each card is the Tokens class card (the same header, rows, promote toggle and adder), because a
 * class is the same thing in both panels and editing it here changes every element wearing it,
 * exactly as it does there. A card is a selector family: `.card`, its sizes and its states, since
 * those are what an author thinks of as "the card styles". The cascade is not traced here; that is
 * Effective styles' job, and dimming a card's rows by what beats them on one element made the card
 * read as broken for the other elements it styles.
 */

/** The inline card's declaration list, and its adder: one id, so focus lands in the list. */
export const INLINE_LIST_ID = 'inline';

/** A card's block at one size and state: its rows' list and its adder share this id. */
export function blockId(family: string, slot: string, state: string): string {
  return `card|${family}|${slot}|${state}`;
}

/**
 * What a property added from the Styles panel starts as: the value the element resolves to now,
 * so adding it changes nothing until it is edited. A pseudo-element's rule starts from `initial`,
 * and `content` in a `::before`/`::after` from an empty string, which is what makes it render.
 */
export function seedFor(el: HTMLElement, state: string, property: string): string {
  if (state && isPseudoElement(state)) {
    return property === 'content' && needsGeneratedContent(state) ? '""' : 'initial';
  }
  return getComputedStyle(el).getPropertyValue(property).trim() || initialValueFor(property);
}

/** Whether a rule is in effect at the width being previewed. Every rule is, at Actual (R7). */
export function visibleAt(entry: RuleEntry, previewWidth: number | null): boolean {
  return previewWidth === null || entry.medias.every((media) => mediaApplies(media, previewWidth));
}


/** A card worked out once per render: the panel counts and orders by it, the card draws it. */
export interface CardView {
  family: Family;
  /** Members in effect at the preview width; a state rule emptied by its trash is left out. */
  visible: RuleEntry[];
  /** `base` (Always) or a condition key. */
  picked: string;
  /** The conditions bar's buttons. */
  chips: BarChip[];
  count(key: string): number;
}

export function cardView(family: Family, host: StylesHost): CardView {
  const { model, previewWidth, ui } = host;
  const visible = family.members.filter((entry) =>
    visibleAt(entry, previewWidth) && !(entry.state && !entry.declarations.length));
  // Picked from ⋮ or added as a state, with nothing written yet: on the bar until something is.
  const waiting = [
    ...(ui.otherSlots.get(family.key) ?? []),
    ...ui.pendingStates
      .filter((one) => one.family === family.key && !isPseudoElement(one.state))
      .map((one) => conditionKey(one.slot, one.state)),
  ];
  let picked = ui.cardPicks.get(family.key) ?? previewSlot(model, previewWidth);
  // The pick keeps its button while it is the pick, even empty: the size a preview follows, say.
  const { chips, count } = barConditions(model, visible, previewWidth, [...waiting, picked]);
  if (picked !== 'base' && !chips.some((chip) => chip.key === picked)) picked = 'base';
  return { family, visible, picked, chips, count };
}


/** One declaration list's card target: rows write that rule's declaration and nothing else. */
function entryTarget(entry: RuleEntry, label: string, listId: string, host: StylesHost): DeclarationTarget {
  return writeTarget(entry.target, entry.declarations, entry.state, label, listId, host);
}

function writeTarget(
  target: WriteTarget,
  declarations: readonly Declaration[],
  state: string,
  label: string,
  listId: string,
  host: StylesHost,
): DeclarationTarget {
  const engine = host.engine;
  return {
    label,
    id: listId,
    declarations: toRecord(declarations),
    empty: '',
    preview: (property, value) => engine.previewDeclaration(target, property, value),
    commit: (property, value) => engine.setDeclaration(target, property, value),
    remove: (property) => engine.removeDeclaration(target, property),
    important: (property) => declarations.some((one) => one.property === property && one.important),
    setImportance: (property, important) => engine.setImportance(target, property, important),
    seed: (property) => seedFor(host.element, state, property),
    readonly: target.kind === 'readonly' ? target.reason : undefined,
  };
}

/** A card block's rows: shorthands and their sides as families, each row writing its own rule. */
function renderRows(target: DeclarationTarget, list: readonly Declaration[], host: StylesHost): TemplateResult {
  const rows = displayOrder(list, shorthandGroups(list));
  return renderFamilies(
    rows,
    (property) => renderDeclarationRow(target, property, host, { promote: true }),
    (property) => target.commit(property, target.declarations[property] ?? ''),
    target.label,
  );
}

/**
 * The head of a block of declarations: its icon, its name (`:hover`, `≤767px`), what kind it is,
 * then whatever the place adds at the end (a card's trash, Effective's "when it applies" note).
 * One markup for the card blocks and the Effective groups, so they read as the same thing.
 */
export function renderBlockHeader(
  iconName: string,
  name: string,
  kind: string,
  trailing: TemplateResult | typeof nothing = nothing,
): TemplateResult {
  return html`<div class="blabel">
    ${icon(iconName, 12)}
    <span class="sel">${name}</span>
    <span class="kindtxt">${kind}</span>
    ${trailing}
  </div>`;
}
/**
 * "+ Add property" under a block, with the places it can write. One open at a time, through the
 * panel's state; hidden while searching (R8).
 */
export function renderBlockAdder(
  host: StylesHost,
  id: string,
  destinations: AdderDestination[],
  state: string,
  options: {
    /** After a property is written, with the engine's note when there is one; else it is notified. */
    onAdded?: (hint: string | null) => void;
    /** Effective styles: the value's list offers the destinations as a switch. */
    choose?: boolean;
  } = {},
): TemplateResult | typeof nothing {
  if (host.filtering) return nothing;
  const { ui, engine } = host;
  const open = ui.adder?.id === id ? ui.adder : null;
  const el = host.element;
  return html`<div class="block-add">
    ${renderAdder(
    {
      id,
      destinations,
      selected: open?.dest,
      disclosure: true,
      open: Boolean(open),
      choose: options.choose,
      onOpen: () => {
        host.form.reset();
        host.patch({ adder: { id, draft: '', dest: '' }, menu: null, popover: null });
      },
      onCancel: () => {
        host.form.reset();
        host.patch({ adder: null, menu: null });
        host.focusSelector(`.add-prop[data-adder="${CSS.escape(id)}"]`);
      },
      onPick: (key) => {
        const adder = host.ui.adder;
        if (adder) host.patch({ adder: { ...adder, dest: key } });
      },
      seed: (property) => seedFor(el, state, property),
      // The value being typed, shown where it would be written: inline and an existing rule have
      // their previews; a rule or class not made yet shows once it is.
      preview: (property, value, dest) => {
        const to = dest.dest;
        if (to?.kind === 'target' && to.target.kind === 'inline') engine.previewStyle(property, value, el);
        else if (to?.kind === 'target') engine.previewDeclaration(to.target, property, value);
        else engine.cancelPreview();
      },
      revert: () => engine.cancelPreview(),
      computed: (property) =>
        (isPseudoElement(state) ? getComputedStyle(el, state) : getComputedStyle(el)).getPropertyValue(property).trim(),
      commit: (property, value, dest) => {
        if (!dest.dest) return;
        engine.cancelPreview();
        host.patch({ adder: null, menu: null });
        const { hint } = engine.addDeclaration(dest.dest, property, value);
        host.flashRow(property, id);
        if (options.onAdded) options.onAdded(hint);
        else if (hint) engine.notify(hint, 'info');
      },
    },
    host,
  )}
  </div>`;
}

/* -------------------------------------------------------------------------- */
/* Family cards                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One selector family as a card: the strip, then what the picked size declares, then each state or
 * pseudo-element at that size, each block with its own "+ Add property", then "+ Add state or
 * pseudo-element". A card for a class the element wears ends with its way out of the class.
 *
 * Drawn in a popover, from a header chip or under a cascade popover's line: always open, and its
 * header calls `popped.onClose`. `group` says whether it is one of the element's classes.
 */
export function renderFamilyCard(
  view: CardView,
  host: StylesHost,
  options: { group: 'classes' | 'rules'; popped: Popped },
): TemplateResult {
  const { family, visible, picked } = view;
  const { model, ui, engine } = host;
  const key = family.key;
  const name = family.isClass ? simpleClassName(key) : null;
  const owned = name ? engine.classes.get(name) : undefined;
  const declarations = visible.reduce((sum, entry) => sum + entry.declarations.length, 0);
  const uses = model.reach(key);
  const lead = visible[0] ?? family.members[0];
  const file = lead?.sheetLabel;
  const body = (): TemplateResult => {
    // The pick as its media (the slot the blocks are under) and its state, when it is one.
    const { media: slot, state: pickedState } = conditionParts(picked);
    const inSlot = visible.filter((entry) => model.slotOf(entry) === slot);
    const short = slotName(model, picked);
    const media = slotMedia(model, picked);
    const label = `${key}${short ? ` ${short}` : ''}`;
    const hintFor = (id: string): TemplateResult | typeof nothing =>
      ui.blockHint?.block === id ? html`<p class="hint block-hint">${ui.blockHint.text}</p>` : nothing;
    const noteAdded = (id: string) => (hint: string | null): void =>
      host.patch({ blockHint: hint ? { block: id, text: hint } : null });

    // The base block: the selector itself at this size, with no repeated selector label (R19).
    const base = inSlot.filter((entry) => !entry.state);
    const baseId = blockId(key, slot, '');
    const writable = [...base].reverse().find((entry) => entry.target.kind !== 'readonly');
    const baseTarget: WriteTarget | null = writable
      ? writable.target
      : slot === 'base' && owned && owned.origin !== 'stylesheet'
        ? { kind: 'class', name: owned.name }
        : null;
    const baseDest = stylesDestination(
      label,
      reachText(uses),
      baseTarget ? { kind: 'target', target: baseTarget } : { kind: 'new-rule', selector: key, media },
      // What is already there to refuse a duplicate against: the rule at this size, else the class
      // itself only at Always. A size with no rule yet has nothing; the class's own color is
      // not "already set" under @media (max-width: 100px).
      writable ? toRecord(writable.declarations) : slot === 'base' && owned ? { ...owned.declarations } : {},
      label,
    );
    const baseRows = base.flatMap((entry) => entry.declarations);
    const baseBlock = html`<div class="block" data-block="base">
      <div class="decls" data-declarations=${baseId}>
        ${base.length && baseRows.length
        ? repeat(
          base,
          (entry) => entry.order,
          (entry) => renderRows(entryTarget(entry, label, baseId, host), entry.declarations, host),
        )
        : html`<p class="hint" style="margin:0">
              ${slot === 'base'
            ? 'No declarations yet.'
            : `Nothing ${media !== null && !isWidthQuery(media) ? 'under this media query' : 'at this size'} yet.`}
            </p>`}
      </div>
      ${hintFor(baseId)}
      ${renderBlockAdder(host, baseId, [baseDest], '', { onAdded: noteAdded(baseId) })}
    </div>`;

    /*
     * The blocks under the pick. Always or a media condition: its pseudo-elements, as blocks under
     * the base block. A state: that state's block alone, since a state is picked on the bar.
     */
    const order = (state: string): number => {
      const at = EDITABLE_STATES.findIndex((one) => one.name === state);
      return at === -1 ? EDITABLE_STATES.length : at;
    };
    const belongs = (state: string): boolean => (pickedState ? state === pickedState : isPseudoElement(state));
    const states = [...new Set(inSlot.filter((entry) => entry.state && belongs(entry.state)).map((entry) => entry.state))];
    // Added with nothing written yet; dropped once its rule has a declaration, which makes it real.
    const pending = ui.pendingStates.filter((one) =>
      one.family === key && one.slot === slot && belongs(one.state) && !states.includes(one.state));
    const ordered = [...states, ...pending.map((one) => one.state)].sort((a, b) => order(a) - order(b));
    /*
     * A state picked on the bar with nothing under it (its declarations removed): its block, empty,
     * with the way to write one. Nothing is recorded until "+ Add property" is pressed, which adds
     * it as a pending state, and the first property writes it.
     */
    const emptyPicked = pickedState && !ordered.length
      ? html`<div class="block pending" data-waiting=${pickedState}>
          ${renderBlockHeader('cursor', pickedState, 'state', nothing)}
          <div class="decls"><p class="hint" style="margin:0">No declarations yet.</p></div>
          <div class="block-add">
            <button
              class="add-prop"
              type="button"
              data-heo-part="adder"
              @click=${() => {
          const refused = addState(pickedState, slot);
          if (refused) engine.notify(refused, 'info');
        }}
            >
              ${icon('plus', 12)} Add property
            </button>
          </div>
        </div>`
      : nothing;
    const stateBlocks = ordered.map((state) => {
      const waiting = pending.find((one) => one.state === state);
      if (waiting) return renderPendingBlock(waiting, `${key}${state}${short ? ` ${short}` : ''}`, uses, host);
      const members = inSlot.filter((entry) => entry.state === state);
      const id = blockId(key, slot, state);
      const stateLabel = `${key}${state}${short ? ` ${short}` : ''}`;
      const target = [...members].reverse().find((entry) => entry.target.kind !== 'readonly') ?? members.at(-1)!;
      const pseudo = isPseudoElement(state);
      const live = target.target.kind === 'live';
      return html`<div class="block" data-block=${state}>
        ${renderBlockHeader(
        pseudo ? 'pseudo' : 'cursor',
        state,
        pseudo ? 'pseudo-element' : 'state',
        renderKill({
          label: `Remove ${target.selector}`,
          title: live
            ? `Remove ${state}'s declarations from ${target.selector} (the empty rule stays in ${target.sheetLabel})`
            : `Remove ${target.selector}`,
          tight: true,
          size: 11,
          onClick: () => engine.removeRule(target.target),
        }),
      )}
        <div class="decls" data-declarations=${id}>
          ${repeat(
        members,
        (entry) => entry.order,
        (entry) => renderRows(entryTarget(entry, stateLabel, id, host), entry.declarations, host),
      )}
        </div>
        ${hintFor(id)}
        ${renderBlockAdder(
        host,
        id,
        [stylesDestination(stateLabel, reachText(model.reach(key)), { kind: 'target', target: target.target }, toRecord(target.declarations), stateLabel)],
        state,
        { onAdded: noteAdded(id) },
      )}
      </div>`;
    });

    /*
     * "+ Add pseudo-element" (R24): the same search popover as the bar's "+", listing the
     * pseudo-elements this card has no block for yet. Picking one adds its block, written as nothing
     * until its first property. Not under a picked state: a pseudo-element is a block under Always
     * or a media query, and one added there had no block to show in.
     */
    const stateAdder = pickedState
      ? nothing
      : renderPseudoAdder(host, {
        id: `${key}|${slot}`,
        existing: ordered.filter(isPseudoElement),
        onPick: (named) => addState(named, slot),
      });

    const pick = (next: string): void => {
      const picks = new Map(host.ui.cardPicks);
      picks.set(key, next);
      host.patch({ cardPicks: picks });
    };
    /*
     * A state for this card, under `under`: written as nothing until its first property (§5.7). A
     * state becomes the pick, on the bar; a pseudo-element is a block under the pick. The message
     * when it is refused, else null.
     */
    const addState = (state: string, under: string): string | null => {
      const at = slotMedia(model, under);
      const result = engine.addStateRule(key, state, at === null ? null : { media: at });
      if (result.kind === 'refused') return result.message;
      const id = blockId(key, under, state);
      const pendingStates = result.kind === 'pending'
        ? [
          ...host.ui.pendingStates.filter((one) =>
            !(one.family === key && one.slot === under && one.state === state)),
          { family: key, slot: under, state, dest: result.dest },
        ]
        : host.ui.pendingStates;
      // A ::before or ::after renders nothing without content, so its adder offers that first.
      // Straight to its value, `""`, which Enter takes and typing replaces.
      const draft = result.kind === 'pending' && needsGeneratedContent(state) ? valueStepDraft('content', '""') : '';
      const picks = new Map(host.ui.cardPicks);
      if (!isPseudoElement(state)) picks.set(key, conditionKey(under, state));
      host.form.reset();
      host.patch({ pendingStates, cardPicks: picks, adder: { id, draft, dest: '' }, menu: null });
      return null;
    };
    const whenText = pickedState
      ? html`Only on <b>${pickedState}</b>${short ? html`, ${media !== null && !isWidthQuery(media) ? 'under' : 'at'} <b>${short}</b>` : nothing} — when it applies, over “Always”${uses > 1 ? `, for all ${uses} elements` : ''}.`
      : html`Only ${media !== null && !isWidthQuery(media) ? 'under' : 'at'} <b>${short}</b> — ${media === null ? '' : mediaNow(media, mediaApplies(media, null), model.width)}.
          Adds to or overrides “Always” there${uses > 1 ? `, for all ${uses} elements` : ''}.`;
    return html`<div class="body">
      ${renderConditionBar({
      owner: key,
      picked,
      alwaysCount: view.count('base'),
      alwaysTitle: 'With no condition: at every size and in every state',
      chips: view.chips,
      remaining: remainingConditions(model, view.chips.map((chip) => chip.key), host.previewWidth, picked),
      menuOpen: ui.menu?.id === `strip-${key}`,
      mediaDraft: ui.mediaDraft?.owner === key ? ui.mediaDraft.text : null,
      widthDraft: ui.mediaDraft?.owner === key ? ui.mediaDraft.width ?? null : null,
      onWidthDraft: (width) => host.patch({ mediaDraft: { owner: key, text: '', ...(width ? { width } : {}) } }),
      viewports: engine.viewports().filter((one) => one.shown),
      mediaForm: host.mediaForm,
      onPick: pick,
      onMenu: (opened, refocus) => host.toggleMenu(`strip-${key}`, opened, refocus),
      onMediaDraft: (text) => host.patch({ mediaDraft: text === null ? null : { owner: key, text } }),
      onAdd: (added) => host.showCondition(slotMedia(model, added), () => {
        const parts = conditionParts(added);
        if (parts.state) {
          const refused = addState(parts.state, parts.media);
          if (refused) host.engine.notify(refused, 'info');
          return;
        }
        // Only remembered here until a declaration is written at it: nothing empty is stored.
        const waiting = new Map(host.ui.otherSlots);
        waiting.set(key, [...new Set([...(waiting.get(key) ?? []), added])]);
        const picks = new Map(host.ui.cardPicks);
        picks.set(key, added);
        host.patch({ otherSlots: waiting, cardPicks: picks });
      }),
      keyForMedia: (typed) => mediaKeyFor(model, typed),
      onRemove: (removed) => removeCondition(host, {
        owner: key,
        key: removed,
        entries: family.members,
        onCleared: () => {
          const picks = new Map(host.ui.cardPicks);
          picks.set(key, 'base');
          host.patch({ cardPicks: picks });
        },
      }),
    })}
      ${picked === 'base' ? nothing : html`<p class="hint slot-hint" style="margin:0 0 7px">${whenText}</p>`}
      ${pickedState ? nothing : baseBlock}
      ${stateBlocks}
      ${emptyPicked}
      ${stateAdder}
      ${renderCardActions(host, {
        paste: name
            ? { context: 'class', element: host.element, className: name }
            : { context: 'rule', element: host.element, selector: key, liveRule: writable?.target.kind === 'live' ? writable.target.rule : null },
          detach: name && options.group === 'classes' && owned && host.element.classList.contains(name) ? name : null,
        })}
    </div>`;
  };

  return html`<div class="cls" data-card=${key} data-group=${options.group}>
    ${renderCardHeader({
    name: leanBlockSelector(key),
    meta: countText(declarations, 'rule'),
    uses,
    file,
    expanded: true,
    onToggle: () => options.popped.onClose(),
    sessionDot: Boolean(owned && owned.origin !== 'stylesheet'),
  })}
    ${body()}
  </div>`;
}
/**
 * "+ Add pseudo-element" (R24): the same search popover as the bar's "+", listing the
 * pseudo-elements not offered yet. Picking one hands it to `onPick`, which adds its block, written
 * as nothing until its first property, and says why when it refuses. Cards and Effective styles
 * both draw this one. Not under a picked state: a pseudo-element is a block under Always or a
 * media query, and one added there had no block to show in.
 */
export function renderPseudoAdder(
  host: StylesHost,
  options: { id: string; existing: readonly string[]; onPick(state: string): string | null },
): TemplateResult {
  const menu = `pseudo-${options.id}`;
  const fieldName = `pseudo-add-${options.id}`;
  const open = host.ui.menu?.id === menu;
  const submit = (text: string, fieldEl: HeoValueField | null): void => {
    const named = pseudoElementNamed(text) ?? pseudoElementNamed(bestRow(text, fieldEl)?.value ?? '');
    if (!named) {
      host.form.fail(fieldName, text.trim()
        ? `::${text.trim().replace(/^:+/, '')} is not a pseudo-element the editor knows.`
        : 'Pick a pseudo-element, like ::before.');
      return;
    }
    const refused = options.onPick(named);
    if (refused) host.form.fail(fieldName, refused);
  };
  return html`<div class="block-add" data-menu-place=${menu}>
      <button
        class="add-prop"
        type="button"
        data-heo-part="adder"
        aria-haspopup="dialog"
        aria-expanded=${open ? 'true' : 'false'}
        data-menu-anchor=${menu}
        @click=${() => {
    host.form.reset();
    host.toggleMenu(menu, !open);
  }}
      >
        ${icon('plus', 12)} Add pseudo-element
      </button>
    </div>
    ${open
    ? renderSearchPopover(
      { id: menu, kind: 'pseudopop', label: 'Add a pseudo-element', onEscape: () => host.toggleMenu(menu, false) },
      renderSearchField({
        form: host.form,
        name: fieldName,
        fieldLabel: 'Search pseudo-elements',
        placeholder: 'before, marker, placeholder…',
        suggestions: pseudoElementSuggestions([...options.existing]),
        emptyText: 'No pseudo-element by that name.',
        onSubmit: submit,
      }),
    )
    : nothing}`;
}
/**
 * Take a condition off a bar (its ×): what is written under it goes, as one undo entry, after
 * asking when there is anything; one added from "+" and never written just leaves the bar. Rules
 * the editor cannot write (another origin's sheet) stay, and the question says so.
 */
export function removeCondition(
  host: StylesHost,
  options: { owner: string; key: string; entries: readonly RuleEntry[]; onCleared(): void },
): void {
  const { engine, model } = host;
  const { owner, key } = options;
  const under = options.entries.filter((entry) => conditionOf(model, entry) === key && entry.declarations.length);
  const writable = under.filter((entry) => entry.target.kind !== 'readonly');
  const name = conditionName(model, key);
  const clear = (): void => {
    const waiting = new Map(host.ui.otherSlots);
    waiting.set(owner, (waiting.get(owner) ?? []).filter((one) => one !== key));
    host.patch({
      otherSlots: waiting,
      pendingStates: host.ui.pendingStates.filter((one) =>
        !(one.family === owner && conditionKey(one.slot, one.state) === key)),
    });
    options.onCleared();
  };
  if (!under.length) {
    clear();
    return;
  }
  if (!writable.length) {
    engine.notify(`${name} is written in a stylesheet the editor cannot change, so it stays.`, 'info');
    return;
  }
  const declarations = writable.reduce((sum, entry) => sum + entry.declarations.length, 0);
  const rules = [...new Set(writable.map((entry) => entry.selector))];
  const kept = under.length - writable.length;
  engine.askToConfirm({
    title: `Remove ${name}?`,
    message: `This removes ${countText(declarations, 'declaration')} written under ${name}, from ${rules.join(', ')}.`,
    ...(kept ? { detail: `${countText(kept, 'rule')} in a stylesheet the editor cannot change stay.` } : {}),
    confirmLabel: `Remove ${name}`,
    tone: 'danger',
    reversible: true,
    run: () => {
      engine.removeRules(writable.map((entry) => entry.target), `Remove ${name} from ${rules.join(', ')}`);
      clear();
    },
  });
}

/** A card drawn in a popover, and how its header closes it there. */
export interface Popped {
  onClose(): void;
}
/**
 * A state or pseudo-element added to a card and not written yet (§5.7).
 *
 * Adding a block must not change the page: an empty rule never reaches it, and a seed declaration
 * would (a `::marker { content: "" }` hides the bullet, an empty `::before` becomes a flex item).
 * So the block is only UI until its first property, which `addDeclaration` writes in one entry.
 * Its trash only forgets it.
 */
function renderPendingBlock(entry: PendingState, label: string, uses: number, host: StylesHost): TemplateResult {
  const id = blockId(entry.family, entry.slot, entry.state);
  const pseudo = isPseudoElement(entry.state);
  const forget = (): void => {
    host.patch({
      pendingStates: host.ui.pendingStates.filter((one) => one !== entry),
      adder: host.ui.adder?.id === id ? null : host.ui.adder,
    });
  };
  return html`<div class="block pending" data-block=${entry.state}>
    ${renderBlockHeader(
    pseudo ? 'pseudo' : 'cursor',
    entry.state,
    pseudo ? 'pseudo-element' : 'state',
    renderKill({ label: `Remove ${label}`, title: `Remove ${label}: nothing is written yet`, tight: true, size: 11, onClick: forget }),
  )}
    <div class="decls" data-declarations=${id}>
      <p class="hint" style="margin:0">No declarations yet.</p>
    </div>
    ${renderBlockAdder(
    host,
    id,
    [stylesDestination(label, reachText(uses), entry.dest, {}, label)],
    entry.state,
    {
      onAdded: (hint) => host.patch({
        pendingStates: host.ui.pendingStates.filter((one) => one !== entry),
        blockHint: hint ? { block: id, text: hint } : null,
      }),
    },
  )}
  </div>`;
}

/* -------------------------------------------------------------------------- */
/* A class card's way out of the class                                         */
/* -------------------------------------------------------------------------- */

/** Rules written for the class in combination (`.card.featured`, `.promo .card`) reaching the element. */
function rulesElsewhere(name: string, host: StylesHost): string[] {
  const mention = new RegExp(`\\.${escapeRegExp(CSS.escape(name))}(?![\\w-])`);
  return [...new Set(host.model.entries.map((entry) => entry.family))]
    .filter((family) => family !== `.${CSS.escape(name)}` && mention.test(family));
}

/**
 * "Paste CSS", at the end of a card: the paste dialog, opened on this card's class, rule or inline
 * style, so what is pasted lands in it by default. The same button on every kind of card.
 */
export function renderPasteButton(host: StylesHost, paste: CssPasteOptions): TemplateResult {
  return html`<button
    class="btn sm"
    type="button"
    data-act="paste-here"
    title="Paste CSS into this card"
    @click=${() => host.engine.beginCssPaste(paste)}
  >
    ${icon('clipboard', 12)} Paste CSS
  </button>`;
}

/**
 * A card's actions row: "Paste CSS", and for a class the element wears "Detach styles from class"
 * on the same line, then the detach panel while it is open.
 */
function renderCardActions(
  host: StylesHost,
  options: { paste: CssPasteOptions; detach: string | null },
): TemplateResult {
  return html`<div class="actions">
      ${renderPasteButton(host, options.paste)}
      ${options.detach ? renderDetachButton(options.detach, host) : nothing}
    </div>
    ${options.detach && host.ui.detachOpen === options.detach
      ? renderDetach(options.detach, host, host.engine.classes.usage().get(options.detach) ?? 0)
      : nothing}`;
}

/**
 * "Detach styles from class": a button like the panel's other actions, with the Spacing editor's
 * unlink icon, and "Never mind" while the detach panel is open.
 */
function renderDetachButton(name: string, host: StylesHost): TemplateResult {
  const { engine, ui } = host;
  const uses = engine.classes.usage().get(name) ?? 0;
  const open = ui.detachOpen === name;
  return html`<button
        class="btn sm"
        type="button"
        data-act="detach"
        aria-expanded=${open ? 'true' : 'false'}
        title=${uses > 1
      ? `Style this element on its own, without affecting the other ${uses - 1} using .${name}`
      : `Style this element on its own, without .${name}`}
        @click=${() => {
      host.forkForm.reset();
      host.patch({ detachOpen: open ? null : name, forkDraft: '' });
    }}
      >
        ${icon(open ? 'close' : 'unlink', 12)} ${open ? 'Never mind' : 'Detach styles from class'}
      </button>`;
}

/**
 * The way back out of a shared class, for one element (R22).
 *
 * Two routes, because the two answers to "is this still a thing worth naming" lead different
 * places. Copying keeps a reusable rule, its sizes and states included, and is the right move for
 * a variant, which is most of the time, so it leads and Enter takes it. Moving the declarations
 * inline is the exact inverse of extracting a class, for values that were only ever this
 * element's; only the unconditional ones can go there, and the panel says what is lost.
 */
function renderDetach(name: string, host: StylesHost, uses: number): TemplateResult | typeof nothing {
  const { engine, element, ui } = host;
  const entry = engine.classes.get(name);
  if (!entry) return nothing;
  const family = classFamily(name);
  const base = family.base.length || Object.keys(entry.declarations).length;
  const count = base + family.members.reduce((sum, member) => sum + member.declarations.length, 0);
  const others = Math.max(0, uses - 1);
  const suggestion = engine.classes.uniqueName(entry.name);
  const forkName = ui.forkDraft.trim() || suggestion;
  const variants = [...new Set(family.members.map((member) =>
    member.state || (member.media ? mediaShort(member.media) : '')).filter(Boolean))];
  const elsewhere = rulesElsewhere(name, host);
  // Dropped with the last element wearing it, unless the page authored it: an overlay-owned rule
  // with no users is dead weight in the export.
  const orphans = others === 0 && entry.origin !== 'stylesheet';
  const fork = (): void => {
    if (!host.forkForm.submit()) return;
    const forked = engine.forkClass(name, element, ui.forkDraft.trim() || undefined);
    if (!forked) return;
    host.patch({ detachOpen: null, forkDraft: '' });
    host.openCard(`.${CSS.escape(forked)}`);
  };

  return html`<div class="detach">
    <p class="lede">
      ${others
      ? html`<code class="mono">.${entry.name}</code> is on ${uses} elements. Both options leave the
            other ${others} alone.`
      : html`Only this element uses <code class="mono">.${entry.name}</code>.`}
    </p>

    <div class="choice" data-choice="copy">
      <div class="head">${icon('duplicate', 12)} <b>Copy it for this element</b></div>
      <p>
        Makes <code class="mono">.${forkName}</code> with the same ${countText(count, 'declaration')}${family.members.length
      ? ', its states and sizes included,'
      : ''} and swaps it in here. Still a class you can reuse, just not a shared one.
      </p>
      ${elsewhere.length
      ? html`<p class="warn">
            ${icon('alert', 11)}
            <span>Rules written for <code class="mono">.${entry.name}</code> elsewhere
              (${elsewhere.join(', ')}) stop applying here.</span>
          </p>`
      : nothing}
      <div class="row">
        <input
          ${field(host.forkForm, 'class-fork')}
          class="input mono fork-input"
          type="text"
          .value=${ui.forkDraft}
          placeholder=${suggestion}
          spellcheck="false"
          autocomplete="off"
          aria-label="Name for the copy"
          @input=${(event: Event) => host.patch({ forkDraft: (event.target as HTMLInputElement).value })}
          @keydown=${(event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      fork();
    }}
        />
        <button class="btn sm primary" type="button" @click=${fork}>${icon('duplicate', 12)} Copy</button>
      </div>
      ${host.forkForm.error('class-fork')}
    </div>

    <div class="choice" data-choice="move">
      <div class="head">${icon('unlink', 12)} <b>Move the styles onto the element</b></div>
      <p>
        Its ${countText(base, 'declaration')} become this element's inline style and
        <code class="mono">.${entry.name}</code> comes off it${orphans
      ? html`. Nothing else uses it, so the rule goes too.`
      : html`, but stays defined for the rest.`}
      </p>
      ${variants.length
      ? html`<p class="warn">
            ${icon('alert', 11)}
            <span>Its ${variants.join(', ')} rules can't be written inline, so this element loses them.</span>
          </p>`
      : nothing}
      <div class="row">
        <span class="spacer"></span>
        <button
          class="btn sm"
          type="button"
          @click=${() => {
      if (engine.inlineClass(entry.name, element)) host.patch({ detachOpen: null });
    }}
        >
          ${icon('unlink', 12)} Move to this element
        </button>
      </div>
    </div>
  </div>`;
}

/**
 * The element's own style attribute, as a card (R21).
 *
 * Shown even when empty, since its "+ Add property" is the way in. Last, "Extract into a class",
 * which is where inline styles go once they turn out to be worth reusing.
 */
export function renderInlineCard(
  host: StylesHost,
  options: { popped: Popped },
): TemplateResult {
  const { model, engine, element } = host;
  const all = model.inline;
  const target: WriteTarget = { kind: 'inline', element };
  const count = all.length;
  return html`<div class="cls" data-card=${INLINE_LIST_ID}>
    ${renderCardHeader({
    name: 'Inline style',
    plain: true,
    meta: countText(count, 'rule'),
    expanded: true,
    onToggle: () => options.popped.onClose(),
    sessionDot: false,
  })}
    <div class="body">
          <p class="hint" style="margin:0 0 7px">
            On this element only, at every size. Wins over every rule unless one is
            <code class="mono">!important</code>.
          </p>
          <div class="block" data-block="base">
            <div class="decls" data-declarations=${INLINE_LIST_ID}>
              ${all.length
          ? renderRows(writeTarget(target, all, '', 'inline style', INLINE_LIST_ID, host), all, host)
          : html`<p class="hint" style="margin:0">Nothing is written on the element itself.</p>`}
            </div>
            ${renderBlockAdder(
            host,
            INLINE_LIST_ID,
            [stylesDestination('inline style', 'this element only, every size', { kind: 'target', target }, toRecord(all), 'this element')],
            '',
          )}
          </div>
          <div class="actions">
                <button
                  class="btn sm"
                  type="button"
                  data-act="extract"
                  ?disabled=${!count}
                  title="Move these declarations into a reusable class"
                  @click=${() => engine.beginClassExtraction(element)}
                >
                  ${icon('droplet', 12)} Extract ${count || ''} into a class
                </button>
                ${renderPasteButton(host, { context: 'inline', element })}
              </div>
        </div>
  </div>`;
}

/**
 * A class on the element that no readable rule defines: a framework utility, a cross-origin rule,
 * or a typo. Its card says so and offers to define it (R18).
 */
export function renderUnknownCard(
  name: string,
  host: StylesHost,
  options: { popped: Popped },
): TemplateResult {
  const key = `.${CSS.escape(name)}`;
  return html`<div class="cls" data-card=${key} data-group="classes" data-unknown>
    ${renderCardHeader({
    name: leanBlockSelector(key),
    meta: 'not defined',
    expanded: true,
    onToggle: () => options.popped.onClose(),
    sessionDot: false,
  })}
    ${ClassEditor.renderUnknownBody(name, host)}
  </div>`;
}

export const sourcesStyles: CSSResult = css`
  /* A card opened over the panel: the popover's surface is the card's frame, so the card's own
     border and gap go, and a tall card scrolls inside the popover rather than past the window. */
  .pop.cardpop {
    max-height: min(70vh, 560px);
    padding: 3px 3px 6px;
  }
  .pop.cardpop > .cls {
    margin: 0;
    border: 0;
    background: transparent;
  }
  /* Several cards in one popover (the element's own styles): a line between them, not a gap. */
  .pop.cardpop > .cls + .cls {
    border-top: 1px solid var(--heo-line);
  }
  .pop.cardpop > .none {
    display: grid;
    gap: 7px;
    justify-items: start;
    margin: 0;
    padding: 8px 9px 4px;
  }
  .cls .body {
    padding: 8px;
  }
  .cls .body .decls {
    padding: 0;
  }
  .block + .block {
    margin-top: 9px;
    padding-top: 8px;
    border-top: 1px dashed var(--heo-line-strong);
  }
  .blabel {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 6px;
    color: var(--heo-text-dim);
  }
  .blabel .sel {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10.5px;
  }
  .blabel .kindtxt,
  .blabel .note {
    color: var(--heo-text-dim);
    font-size: 10px;
  }
  .blabel .kill,
  .blabel .note {
    margin-left: auto;
  }
  .cls .body .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
  .block-add {
    margin-top: 4px;
  }
  .block-hint {
    margin: 4px 0 0;
  }
  /* Leaving a shared class, for one element. Two routes, each stating what it does to the class
     and to everything else wearing it: the question that decides between them. */
  .detach {
    display: grid;
    gap: 7px;
    margin: 8px 0 0;
    padding: 9px;
    border: 1px solid var(--heo-accent-line);
    border-radius: var(--heo-r-sm);
    background: var(--heo-accent-soft);
  }
  .detach .lede {
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.45;
  }
  .detach .choice {
    display: grid;
    gap: 6px;
    padding: 8px 9px;
    border-radius: var(--heo-r-sm);
    background: var(--heo-bg);
  }
  .detach .choice .head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--heo-text);
    font-size: 11.5px;
  }
  .detach .choice .head b {
    font-weight: 600;
  }
  .detach .choice > p {
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.5;
  }
  .detach .choice > p.warn {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .detach .choice > p.warn svg {
    flex: 0 0 auto;
    margin-top: 2px;
    color: var(--heo-warn);
  }
  .detach .choice .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .detach .choice .row .input {
    flex: 1 1 auto;
    min-width: 0;
    height: 24px;
    font-size: 11px;
  }
  .detach .choice .row .spacer {
    flex: 1 1 auto;
  }
`;
