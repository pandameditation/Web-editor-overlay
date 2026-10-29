import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { EDITABLE_STATES, isPseudoElement, needsGeneratedContent } from '../../../core/breakpoints.js';
import type { Family, RuleEntry, WriteTarget } from '../../../core/cascade.js';
import { simpleClassName } from '../../../core/classes.js';
import {
  displayOrder,
  shorthandGroups,
  toRecord,
  type Declaration,
} from '../../../core/declaration-list.js';
import { mediaApplies } from '../../../core/viewport.js';
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
import { renderSizeStrip, slotMedia, slotName, stripSizes, type StripOther, type StripSlot } from './size-strip.js';
import type { StylesHost } from './types.js';

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

const reachText = (n: number): string => `${n} ${n === 1 ? 'element' : 'elements'}`;

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
  let picked = ui.cardPicks.get(family.key) ?? previewSlotOf(host);
  if (!available.includes(picked)) picked = 'base';
  // A card found by one of its declarations opens at a size that holds one (R8).
  if (host.filtering && !familyHit) {
    const holding = [...new Set(visible.filter(rowHit).map((entry) => model.slotOf(entry)))];
    if (holding.length && !holding.includes(picked)) picked = holding[0];
  }
  return { family, visible, familyHit, shown, picked, slots, others, count };
}

/** The slot the preview width picks, the one every size picker follows until a hand pick. */
function previewSlotOf(host: StylesHost): string {
  const width = host.previewWidth;
  if (width === null) return 'base';
  const slots = host.model.slots();
  const exact = slots.find((one) => one.at === width);
  if (exact) return exact.key;
  return slots.filter((one) => mediaApplies(one.media, width)).sort((a, b) => a.at - b.at).at(-1)?.key ?? 'base';
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
          if (hint) host.engine.notify(hint, 'info');
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
 * pseudo-element at that size, each block with its own "+ Add property".
 *
 * `group` is the Sources group it is drawn in; `actions` is what a class card on the element ends
 * with, owned by the panel.
 */
export function renderFamilyCard(
  view: CardView,
  host: StylesHost,
  options: { group: 'classes' | 'rules'; actions?: TemplateResult | typeof nothing },
): TemplateResult | typeof nothing {
  const actions = options.actions ?? nothing;
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
      ${renderBlockAdder(host, baseId, [baseDest], '')}
    </div>`;

    // Each state or pseudo-element at this size, in the state list's order.
    const order = (state: string): number => {
      const at = EDITABLE_STATES.findIndex((one) => one.name === state);
      return at === -1 ? EDITABLE_STATES.length : at;
    };
    const states = [...new Set(inSlot.filter((entry) => entry.state).map((entry) => entry.state))]
      .sort((a, b) => order(a) - order(b));
    const stateBlocks = states.map((state) => {
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
        ${renderBlockAdder(
          host,
          id,
          [stylesDestination(stateLabel, reachText(model.reach(key)), { kind: 'target', target: target.target }, toRecord(target.declarations), stateLabel)],
          state,
        )}
      </div>`;
    });

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
      ${host.filtering ? nothing : actions}
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
`;
