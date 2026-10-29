import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { EDITABLE_STATES, isPseudoElement, mediaShort, needsGeneratedContent } from '../../../core/breakpoints.js';
import { classFamily, type Family, type RuleEntry, type WriteTarget } from '../../../core/cascade.js';
import { simpleClassName } from '../../../core/classes.js';
import {
  displayOrder,
  shorthandGroups,
  toRecord,
  type Declaration,
} from '../../../core/declaration-list.js';
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
import { renderAdder, stylesDestination, type AdderDestination } from './property-adder.js';
import { previewSlot, reachText } from './property-row.js';
import { renderSizeStrip, slotMedia, slotName, stripSizes, type StripOther, type StripSlot } from './size-strip.js';
import type { PendingState, StylesHost } from './types.js';

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
  /** The search names the family itself, so every row is shown. */
  familyHit: boolean;
  /** Something in the card matches the search (always true without one). */
  shown: boolean;
  picked: string;
  slots: StripSlot[];
  others: StripOther[];
  count(key: string): number;
}

export function cardView(family: Family, host: StylesHost): CardView {
  const { model, previewWidth, ui } = host;
  const visible = family.members.filter((entry) =>
    visibleAt(entry, previewWidth) && !(entry.state && !entry.declarations.length));
  const familyHit = host.filtering && host.hit(family.key);
  const rowHit = (entry: RuleEntry): boolean =>
    entry.declarations.some((one) => host.hit(one.property, one.value));
  const shown = !host.filtering || familyHit || visible.some(rowHit);
  const { slots, others, count } = stripSizes(model, visible, previewWidth, ui.otherSlots.get(family.key) ?? []);
  const available = ['base', ...slots.map((slot) => slot.key), ...others.map((other) => other.key)];
  let picked = ui.cardPicks.get(family.key) ?? previewSlot(model, previewWidth);
  if (!available.includes(picked)) picked = 'base';
  // A card found by one of its declarations opens at a size that holds one (R8).
  if (host.filtering && !familyHit) {
    const holding = [...new Set(visible.filter(rowHit).map((entry) => model.slotOf(entry)))];
    if (holding.length && !holding.includes(picked)) picked = holding[0];
  }
  return { family, visible, familyHit, shown, picked, slots, others, count };
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
 * "+ Add property" (or "+ Add state or pseudo-element") under a block, with the places it can
 * write. One open at a time, through the panel's state; hidden while searching (R8).
 */
export function renderBlockAdder(
  host: StylesHost,
  id: string,
  destinations: AdderDestination[],
  state: string,
  options: {
    mode?: 'property' | 'state';
    /** State mode: what to do with the state named. */
    onState?: (state: string, dest: AdderDestination) => void;
    /** After a property is written, with the engine's note when there is one; else it is notified. */
    onAdded?: (hint: string | null) => void;
  } = {},
): TemplateResult | typeof nothing {
  if (host.filtering) return nothing;
  const { ui } = host;
  const open = ui.adder?.id === id ? ui.adder : null;
  const el = host.element;
  return html`<div class="block-add">
    ${renderAdder(
      {
        id,
        mode: options.mode ?? 'property',
        destinations,
        selected: open?.dest,
        disclosure: true,
        open: Boolean(open),
        menuOpen: ui.menu?.id === `dest-${id}`,
        onOpen: () => {
          host.adderForm.reset();
          host.patch({ adder: { id, draft: '', dest: '' }, menu: null, popover: null });
        },
        onCancel: () => {
          host.adderForm.reset();
          host.patch({ adder: null, menu: null });
        },
        onPick: (key) => {
          const adder = host.ui.adder;
          if (adder) host.patch({ adder: { ...adder, dest: key } });
        },
        onMenu: (opened) => {
          host.patch({ menu: opened ? { id: `dest-${id}` } : null });
          if (opened) host.focusSelector(`.menu[data-menu="${CSS.escape(`dest-${id}`)}"] .mi[aria-checked="true"]`);
        },
        seed: (property) => seedFor(el, state, property),
        commit: (property, value, dest) => {
          if (options.mode === 'state') {
            options.onState?.(property, dest);
            return;
          }
          if (!dest.dest) return;
          host.patch({ adder: null, menu: null });
          const { hint } = host.engine.addDeclaration(dest.dest, property, value);
          if (options.onAdded) options.onAdded(hint);
          else if (hint) host.engine.notify(hint, 'info');
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
 * `group` is the Sources group it is drawn in.
 */
export function renderFamilyCard(
  view: CardView,
  host: StylesHost,
  options: { group: 'classes' | 'rules' },
): TemplateResult | typeof nothing {
  if (!view.shown) return nothing;
  const { family, visible, picked } = view;
  const { model, ui, engine } = host;
  const key = family.key;
  const name = family.isClass ? simpleClassName(key) : null;
  const owned = name ? engine.classes.get(name) : undefined;
  const open = host.filtering || !ui.closedCards.has(key);
  const declarations = visible.reduce((sum, entry) => sum + entry.declarations.length, 0);
  const uses = model.reach(key);
  const lead = visible[0] ?? family.members[0];
  const file = lead?.sheetLabel;
  const body = (): TemplateResult => {
    const inSlot = visible.filter((entry) => model.slotOf(entry) === picked);
    const short = slotName(model, picked);
    const media = slotMedia(model, picked);
    const label = `${key}${short ? ` ${short}` : ''}`;
    const rowHit = (one: Declaration): boolean => !host.filtering || view.familyHit || host.hit(one.property, one.value);
    const hintFor = (id: string): TemplateResult | typeof nothing =>
      ui.blockHint?.block === id ? html`<p class="hint block-hint">${ui.blockHint.text}</p>` : nothing;
    const noteAdded = (id: string) => (hint: string | null): void =>
      host.patch({ blockHint: hint ? { block: id, text: hint } : null });

    // The base block: the selector itself at this size, with no repeated selector label (R19).
    const base = inSlot.filter((entry) => !entry.state);
    const baseId = blockId(key, picked, '');
    const writable = [...base].reverse().find((entry) => entry.target.kind !== 'readonly');
    const baseTarget: WriteTarget | null = writable
      ? writable.target
      : picked === 'base' && owned && owned.origin !== 'stylesheet'
        ? { kind: 'class', name: owned.name }
        : null;
    const baseDest = stylesDestination(
      label,
      reachText(uses),
      baseTarget ? { kind: 'target', target: baseTarget } : { kind: 'new-rule', selector: key, media },
      writable ? toRecord(writable.declarations) : owned ? { ...owned.declarations } : {},
      label,
    );
    const baseRows = base.flatMap((entry) => entry.declarations.filter(rowHit));
    const baseBlock = html`<div class="block" data-block="base">
      <div class="decls" data-declarations=${baseId}>
        ${base.length && baseRows.length
          ? repeat(
            base,
            (entry) => entry.order,
            (entry) => renderRows(entryTarget(entry, label, baseId, host), entry.declarations.filter(rowHit), host),
          )
          : html`<p class="hint" style="margin:0">
              ${picked === 'base' ? 'No declarations yet.' : 'Nothing at this size yet.'}
            </p>`}
      </div>
      ${hintFor(baseId)}
      ${renderBlockAdder(host, baseId, [baseDest], '', { onAdded: noteAdded(baseId) })}
    </div>`;

    // Each state or pseudo-element at this size, in the state list's order.
    const order = (state: string): number => {
      const at = EDITABLE_STATES.findIndex((one) => one.name === state);
      return at === -1 ? EDITABLE_STATES.length : at;
    };
    const states = [...new Set(inSlot.filter((entry) => entry.state).map((entry) => entry.state))];
    // Added with nothing written yet; dropped once its rule has a declaration, which makes it real.
    const pending = ui.pendingStates.filter((one) =>
      one.family === key && one.slot === picked && !states.includes(one.state));
    const ordered = [...states, ...pending.map((one) => one.state)].sort((a, b) => order(a) - order(b));
    const stateBlocks = ordered.map((state) => {
      const waiting = pending.find((one) => one.state === state);
      if (waiting) return host.filtering ? nothing : renderPendingBlock(waiting, `${key}${state}${short ? ` ${short}` : ''}`, uses, host);
      const members = inSlot.filter((entry) => entry.state === state);
      const rows = members.flatMap((entry) => entry.declarations.filter(rowHit));
      if (host.filtering && !view.familyHit && !rows.length) return nothing;
      const id = blockId(key, picked, state);
      const stateLabel = `${key}${state}${short ? ` ${short}` : ''}`;
      const target = [...members].reverse().find((entry) => entry.target.kind !== 'readonly') ?? members.at(-1)!;
      const pseudo = isPseudoElement(state);
      const live = target.target.kind === 'live';
      return html`<div class="block" data-block=${state}>
        <div class="blabel">
          ${icon(pseudo ? 'pseudo' : 'cursor', 12)}
          <span class="sel">${state}</span>
          <span class="kindtxt">${pseudo ? 'pseudo-element' : 'state'}</span>
          ${host.filtering
            ? nothing
            : renderKill({
              label: `Remove ${target.selector}`,
              title: live
                ? `Remove ${state}'s declarations from ${target.selector} (the empty rule stays in ${target.sheetLabel})`
                : `Remove ${target.selector}`,
              tight: true,
              size: 11,
              onClick: () => engine.removeRule(target.target),
            })}
        </div>
        <div class="decls" data-declarations=${id}>
          ${repeat(
            members,
            (entry) => entry.order,
            (entry) => renderRows(entryTarget(entry, stateLabel, id, host), entry.declarations.filter(rowHit), host),
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

    // "+ Add state or pseudo-element": the same adder, naming a state instead of a property (R24).
    const stateAdderId = `state|${key}|${picked}`;
    const stateAdder = renderBlockAdder(
      host,
      stateAdderId,
      [stylesDestination(label, reachText(uses), { kind: 'new-rule', selector: key, media }, {}, label)],
      '',
      {
        mode: 'state',
        onState: (state) => {
          const result = engine.addStateRule(key, state, media === null ? null : { media });
          if (result.kind === 'refused') {
            host.adderForm.fail(`prop-add-${stateAdderId}`, result.message);
            return;
          }
          const id = blockId(key, picked, state);
          const pendingStates = result.kind === 'pending'
            ? [
              ...host.ui.pendingStates.filter((one) =>
                !(one.family === key && one.slot === picked && one.state === state)),
              { family: key, slot: picked, state, dest: result.dest },
            ]
            : host.ui.pendingStates;
          // A ::before or ::after renders nothing without content, so its adder offers that first.
          const draft = result.kind === 'pending' && needsGeneratedContent(state) ? 'content' : '';
          host.adderForm.reset();
          host.patch({ pendingStates, adder: { id, draft, dest: '' }, menu: null });
        },
      },
    );

    return html`<div class="body">
      ${renderSizeStrip({
        owner: key,
        picked,
        baseCount: view.count('base'),
        baseTitle: 'Without a media query: at every size',
        slots: view.slots,
        others: view.others,
        width: model.width,
        menuOpen: ui.menu?.id === `strip-${key}`,
        mediaDraft: ui.mediaDraft?.owner === key ? ui.mediaDraft.text : null,
        mediaForm: host.mediaForm,
        onPick: (slot) => {
          const next = new Map(host.ui.cardPicks);
          next.set(key, slot);
          host.patch({ cardPicks: next });
        },
        onMenu: (opened) => host.toggleMenu(`strip-${key}`, opened),
        onMediaDraft: (text) => host.patch({ mediaDraft: text === null ? null : { owner: key, text } }),
        onAddMedia: (added) => {
          // Only remembered here until a declaration is written at it: nothing empty is stored.
          const slots = new Map(host.ui.otherSlots);
          slots.set(key, [...new Set([...(slots.get(key) ?? []), added])]);
          const picks = new Map(host.ui.cardPicks);
          picks.set(key, `other:${added}`);
          host.patch({ otherSlots: slots, cardPicks: picks });
        },
      })}
      ${picked === 'base'
        ? nothing
        : html`<p class="hint slot-hint" style="margin:0 0 7px">
            Only at <b>${short}</b> — ${media !== null && mediaApplies(media, null) ? `in effect at ${model.width}px` : `not at ${model.width}px`}.
            Adds to or overrides “All sizes” there${uses > 1 ? `, for all ${uses} elements` : ''}.
          </p>`}
      ${baseBlock}
      ${stateBlocks}
      ${stateAdder}
      ${name && options.group === 'classes' && owned && host.element.classList.contains(name) && !host.filtering
        ? renderClassActions(name, host)
        : nothing}
    </div>`;
  };

  return html`<div class="cls" data-card=${key} data-group=${options.group}>
    ${renderCardHeader({
      name: key,
      meta: `${declarations} ${declarations === 1 ? 'rule' : 'rules'} · ${uses}×`,
      file,
      expanded: open,
      onToggle: () => toggleCard(host, key),
      sessionDot: Boolean(owned && owned.origin !== 'stylesheet'),
    })}
    ${open ? body() : nothing}
  </div>`;
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
    <div class="blabel">
      ${icon(pseudo ? 'pseudo' : 'cursor', 12)}
      <span class="sel">${entry.state}</span>
      <span class="kindtxt">${pseudo ? 'pseudo-element' : 'state'}</span>
      ${renderKill({ label: `Remove ${label}`, title: `Remove ${label}: nothing is written yet`, tight: true, size: 11, onClick: forget })}
    </div>
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
  const mention = new RegExp(`\\.${CSS.escape(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
  return [...new Set(host.model.entries.map((entry) => entry.family))]
    .filter((family) => family !== `.${CSS.escape(name)}` && mention.test(family));
}

/** "Manage in Tokens" and "Detach styles from class", then the detach panel while it is open. */
function renderClassActions(name: string, host: StylesHost): TemplateResult {
  const { engine, ui } = host;
  const uses = engine.classes.usage().get(name) ?? 0;
  const open = ui.detachOpen === name;
  return html`<div class="actions">
      <button
        class="link"
        type="button"
        title="Open this class in the design system panel"
        @click=${() => engine.setDockTab('tokens')}
      >
        Manage in Tokens
      </button>
      <span class="spacer"></span>
      <button
        class="link"
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
        ${open ? 'Never mind' : 'Detach styles from class'}
      </button>
    </div>
    ${open ? renderDetach(name, host, uses) : nothing}`;
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
  const plural = (n: number): string => `${n} declaration${n === 1 ? '' : 's'}`;
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
        Makes <code class="mono">.${forkName}</code> with the same ${plural(count)}${family.members.length
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
        Its ${plural(base)} become this element's inline style and
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

function toggleCard(host: StylesHost, key: string): void {
  const next = new Set(host.ui.closedCards);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  host.patch({ closedCards: next });
}

/**
 * The element's own style attribute, as a card (R21).
 *
 * Shown even when empty, since its "+ Add property" is the way in. Last, "Extract into a class",
 * which is where inline styles go once they turn out to be worth reusing.
 */
export function renderInlineCard(host: StylesHost): TemplateResult | typeof nothing {
  const { model, engine, element } = host;
  const all = model.inline;
  const familyHit = host.filtering && host.hit('inline style');
  const shown = host.filtering && !familyHit ? all.filter((one) => host.hit(one.property, one.value)) : all;
  if (host.filtering && !familyHit && !shown.length) return nothing;
  const open = host.filtering || !host.ui.closedCards.has(INLINE_LIST_ID);
  const target: WriteTarget = { kind: 'inline', element };
  const count = all.length;
  return html`<div class="cls" data-card=${INLINE_LIST_ID}>
    ${renderCardHeader({
      name: 'Inline style',
      plain: true,
      meta: `${count} ${count === 1 ? 'rule' : 'rules'}`,
      expanded: open,
      onToggle: () => toggleCard(host, INLINE_LIST_ID),
      sessionDot: false,
    })}
    ${open
      ? html`<div class="body">
          <p class="hint" style="margin:0 0 7px">
            On this element only, at every size. Wins over every rule unless one is
            <code class="mono">!important</code>.
          </p>
          <div class="block" data-block="base">
            <div class="decls" data-declarations=${INLINE_LIST_ID}>
              ${shown.length
                ? renderRows(writeTarget(target, all, '', 'inline style', INLINE_LIST_ID, host), shown, host)
                : html`<p class="hint" style="margin:0">Nothing is written on the element itself.</p>`}
            </div>
            ${renderBlockAdder(
              host,
              INLINE_LIST_ID,
              [stylesDestination('inline style', 'this element only, every size', { kind: 'target', target }, toRecord(all), 'this element')],
              '',
            )}
          </div>
          ${host.filtering
            ? nothing
            : html`<div class="actions">
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
              </div>`}
        </div>`
      : nothing}
  </div>`;
}

/**
 * A class on the element that no readable rule defines: a framework utility, a cross-origin rule,
 * or a typo. Its card says so and offers to define it (R18).
 */
export function renderUnknownCard(name: string, host: StylesHost): TemplateResult | typeof nothing {
  const key = `.${name}`;
  if (host.filtering && !host.hit(key)) return nothing;
  const open = host.filtering || !host.ui.closedCards.has(key);
  return html`<div class="cls" data-card=${key} data-group="classes" data-unknown>
    ${renderCardHeader({
      name: key,
      meta: 'not defined',
      expanded: open,
      onToggle: () => toggleCard(host, key),
      sessionDot: false,
    })}
    ${open ? ClassEditor.renderUnknownBody(name, host) : nothing}
  </div>`;
}

export const sourcesStyles: CSSResult = css`
  .src-tabs {
    display: flex;
    gap: 2px;
    margin: 0 0 4px;
    padding: 2px;
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-md);
    background: var(--heo-sunken);
  }
  .src-tabs [role='tab'] {
    flex: 1 1 0;
    height: 22px;
    padding: 0 4px;
    border: 0;
    border-radius: var(--heo-r-sm);
    background: transparent;
    color: var(--heo-text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .src-tabs [role='tab']:hover {
    background: var(--heo-hover);
    color: var(--heo-text);
  }
  .src-tabs [role='tab'][aria-selected='true'] {
    background: var(--heo-raised);
    box-shadow: var(--heo-shadow-sm);
    color: var(--heo-text);
  }
  .src-tabs [role='tab']:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  .src-tabs .c {
    margin-left: 1px;
    color: var(--heo-text-dim);
    font-family: var(--heo-mono);
    font-size: 10px;
  }
  /* Groups by meaning, each under a captioned rule. */
  .src-h {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 14px 0 7px;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .src-h .c {
    color: var(--heo-text-dim);
    font-family: var(--heo-mono);
    font-size: 10px;
    font-weight: 400;
  }
  .src-h .rule-line {
    flex: 1;
    height: 1px;
    background: var(--heo-line);
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
  .blabel .kindtxt {
    color: var(--heo-text-dim);
    font-size: 10px;
  }
  .blabel .kill {
    margin-left: auto;
  }
  .cls .body .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
  }
  .cls.flash {
    animation: heo-row-flash 1.2s ease-out;
  }
  .block-add {
    margin-top: 4px;
  }
  .block-hint {
    margin: 4px 0 0;
  }
  .cls .body .actions .spacer {
    flex: 1 1 auto;
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
