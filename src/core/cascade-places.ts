import { leanBlockSelector } from './block-rule-edit.js';
import {
  compareContributions,
  stateTrigger,
  withState,
  type CascadeContext,
  type Contribution,
  type ElementModel,
  type RuleEntry,
  type WriteTarget,
} from './cascade.js';
import { toRecord } from './declaration-list.js';
import type { AddDestination } from './save-plan.js';
import { specificityOf } from './specificity.js';
import { mediaApplies } from './viewport.js';

/**
 * The places one property can be written for one element under one condition: the rungs of the
 * cascade ladder, strongest first.
 *
 * A place is a block that holds a declaration of the property now (inline, a class, any rule
 * reaching the element) or one that could: the element's inline style at Element, each of its
 * classes and every other family reaching it under the condition, and a new class of its own. The
 * same list answers "what is applied, and why" and "where should this edit go", so the menu, the
 * row and every rich editor agree on where a value lands. Before this, the panel built the
 * candidates in three methods per kind of group and the row added the current source in front,
 * so two surfaces could offer different places for the same row.
 */

/**
 * The condition a place is under: a media key (`base`, a slot key, `other:<media>`) and a state
 * (`''` for none, `:hover`, `::before`, `:hover on .nav`).
 */
export interface PlaceCondition {
  media: string;
  state: string;
}

export interface Place {
  /**
   * Stable across renders, unique in one ladder: `inline`, `<family>|<condition key>` (a condition
   * key as the strip writes it: `base`, `tablet`, `state::hover`, `state::hover@tablet`), and
   * `new-class|<condition key>` for the element's new class. A second block with the same family
   * and condition (`.card` written in two sheets) gets `#2`, `#3` after it, in rank order.
   */
  key: string;
  /** What the rung is called: `inline`, `.card`, `.card:hover`, `new class`. No media in it. */
  label: string;
  /** The media query it writes under, as written; null for none. */
  media: string | null;
  /** The media key of `media`: `base`, a slot key or `other:<media>`. */
  slot: string;
  state: string;
  /** The family it belongs to (`.card`, `.promo .card`); null for inline and the new class. */
  family: string | null;
  /** Where `engine.writeDeclarationTo` writes a value for this place. */
  dest: AddDestination;
  /** The block it is, once there is one; null for a rule or class not made yet. */
  target: WriteTarget | null;
  /** The declaration of the property this block holds now, when it applies under the condition. */
  declared: Contribution | null;
  /** What the block declares already (every property): an adder refuses a duplicate with it. */
  existing: Record<string, string>;
  /** How many elements a value here styles. */
  reach: number;
  /** Whether its declaration is the one the element renders with under the condition. */
  winner: boolean;
  /** What it is ranked by: its declaration, or the one a value written here would be. */
  rank: Contribution;
}

export interface PlacesOptions {
  /**
   * A registry class the editor owns, by name, when there is one: a class with no rule on the page
   * yet is written into its registry entry rather than into a new rule beside it.
   */
  ownedClass?(name: string): { declarations: Record<string, string>; origin?: string } | null;
}

/** The key the strip names a condition by: `base`, `tablet`, `state::hover`, `state::hover@tablet`. */
export function placeConditionKey(cond: PlaceCondition): string {
  if (!cond.state) return cond.media;
  return cond.media === 'base' ? `state:${cond.state}` : `state:${cond.state}@${cond.media}`;
}

/** The media query a media key stands for; null for `base`. */
export function conditionMedia(model: ElementModel, media: string): string | null {
  if (media === 'base') return null;
  if (media.startsWith('other:')) return media.slice('other:'.length);
  return model.slots().find((one) => one.key === media)?.media ?? null;
}

/**
 * The cascade a condition is read under: a size on screen at the width the page is drawn at, a size
 * that is not at its slot's width, another media query taken to hold, a state in its state. So the
 * ladder ranks what applies when the condition is in effect, and for a size on screen what applies
 * on screen. Read at its slot's width instead, ≥768px picked while previewing 1024px ranked its own
 * padding "now" and "Applies" while ≥1024px's was the one drawn, and the row said it was hidden.
 */
export function conditionContext(model: ElementModel, cond: PlaceCondition): CascadeContext {
  const state = cond.state ? { state: cond.state } : {};
  if (cond.media === 'base') return { width: null, ...state };
  if (cond.media.startsWith('other:')) return { width: null, media: cond.media.slice('other:'.length), ...state };
  const slot = model.slots().find((one) => one.key === cond.media);
  if (slot && mediaApplies(slot.media, null)) return { width: null, ...state };
  return { width: slot?.at ?? null, ...state };
}

/** Inline style is a place only at Element: a size, a state or a pseudo-element cannot be inline. */
export const inlineAllowed = (cond: PlaceCondition): boolean => cond.media === 'base' && !cond.state;

/** The block a contribution is in: the style attribute, or its rule (none for one not written yet). */
const blockOf = (one: Contribution): unknown => (one.source.kind === 'inline' ? 'inline' : one.source.entry.rule);

/** One contribution per block: a block's shorthand and side compete inside it, not here. */
function onePerBlock(list: readonly Contribution[]): Contribution[] {
  const out: Contribution[] = [];
  for (const one of list) {
    if (out.some((kept) => blockOf(kept) === blockOf(one))) continue;
    out.push(one);
  }
  return out;
}

/** The media key a rule is under, from the model's slots. */
const slotKeyOf = (model: ElementModel, entry: RuleEntry): string => model.slotOf(entry);

/*
 * Where a rule the editor has not written yet will land, measured (tmp-new-rule-order probe): the
 * rule registry's sheet comes after every page sheet, and the class registry's after that. So a
 * new rule ranks after every rule on the page at equal specificity, and a new registry class after
 * every rule. Ranked anywhere else, an empty rung would promise "will apply" for a value the page
 * would then hide, or the other way round.
 */
function laterOrders(model: ElementModel): { rule: number; cls: number } {
  let rule = 0;
  let all = 0;
  for (const entry of model.entries) {
    all = Math.max(all, entry.order);
    if (entry.target.kind !== 'class') rule = Math.max(rule, entry.order);
  }
  return { rule: rule + 1, cls: Math.max(all, rule + 1) + 1 };
}

/**
 * A declaration not written yet, to rank an empty rung by: in its existing block after what the
 * block holds, else in a rule of its selector at the order the registry would give it. Only the
 * fields the cascade's ranking reads are meaningful.
 */
function syntheticRank(
  property: string,
  important: boolean,
  at: { entry: RuleEntry } | { selector: string; media: string | null; order: number } | 'inline',
): Contribution {
  if (at === 'inline') return { property, value: '', important, index: Number.MAX_SAFE_INTEGER, source: { kind: 'inline' } };
  if ('entry' in at) {
    return { property, value: '', important, index: at.entry.declarations.length, source: { kind: 'rule', entry: at.entry } };
  }
  const entry = {
    selector: at.selector,
    matched: at.selector,
    family: at.selector,
    state: '',
    media: at.media,
    medias: at.media ? [at.media] : [],
    conditions: at.media ? [`@media ${at.media}`] : [],
    supports: true,
    container: false,
    layered: false,
    specificity: specificityOf(at.selector),
    order: at.order,
    sheetLabel: 'editor',
    declarations: [],
    target: { kind: 'readonly', reason: 'Not written yet' },
  } as unknown as RuleEntry;
  return { property, value: '', important, index: 0, source: { kind: 'rule', entry } };
}

/** The element's own classes, in its class list order, as family keys. */
function ownClasses(element: HTMLElement): string[] {
  return Array.from(element.classList).filter((name) => !name.startsWith('heo-'));
}

/**
 * The places a condition offers before any property is asked about, in the order an adder lists
 * them: inline (Element only), each class the element wears, every other family reaching it (under
 * a size or a state), then a new class of the element's own (not for a state on another element:
 * a class of its own cannot say "while the nav is hovered"). Each is the block already written
 * under the condition when there is one, else the rule or class a first value creates.
 */
export function candidatePlaces(
  model: ElementModel,
  cond: PlaceCondition,
  element: HTMLElement,
  options: PlacesOptions = {},
): Place[] {
  const condKey = placeConditionKey(cond);
  const media = conditionMedia(model, cond.media);
  const orders = laterOrders(model);
  const property = '';
  const out: Place[] = [];
  if (inlineAllowed(cond)) {
    out.push({
      key: 'inline',
      label: 'inline',
      media: null,
      slot: 'base',
      state: '',
      family: null,
      dest: { kind: 'target', target: { kind: 'inline', element } },
      target: { kind: 'inline', element },
      declared: null,
      existing: toRecord(model.inline),
      reach: 1,
      winner: false,
      rank: syntheticRank(property, false, 'inline'),
    });
  }
  const { others } = model.families();
  const classKeys = ownClasses(element).map((name) => `.${CSS.escape(name)}`);
  // At Element, the element's classes only, as today; a size or a state offers every family.
  const keys = cond.media === 'base' && !cond.state
    ? classKeys
    : [...classKeys, ...others.map((family) => family.key).filter((key) => !classKeys.includes(key))];
  const contextual = stateTrigger(cond.state).on !== null;
  for (const family of keys) {
    const selector = withState(family, cond.state);
    if (selector === null) continue;
    const entry = model.entries.find((one) =>
      one.family === family &&
      one.state === cond.state &&
      slotKeyOf(model, one) === cond.media &&
      one.target.kind !== 'readonly');
    const name = classKeys.includes(family) ? ownClasses(element)[classKeys.indexOf(family)] : null;
    // A registry class with no rule on the page yet is written in the registry, unconditional only.
    const owned = !entry && name && cond.media === 'base' && !cond.state ? options.ownedClass?.(name) ?? null : null;
    const ownedTarget: WriteTarget | null = owned && owned.origin !== 'stylesheet' && name ? { kind: 'class', name } : null;
    const target = entry?.target ?? ownedTarget;
    out.push({
      key: `${family}|${condKey}`,
      label: leanBlockSelector(selector),
      media,
      slot: cond.media,
      state: cond.state,
      family,
      dest: target ? { kind: 'target', target } : { kind: 'new-rule', selector, media },
      target,
      declared: null,
      existing: entry ? toRecord(entry.declarations) : owned ? { ...owned.declarations } : {},
      reach: model.reach(family),
      winner: false,
      rank: entry
        ? syntheticRank(property, false, { entry })
        : syntheticRank(property, false, { selector, media, order: ownedTarget ? orders.cls : orders.rule }),
    });
  }
  if (!contextual) {
    const stem = ownClasses(element)[0] ?? element.localName;
    // Ranked as the class it will be: `.stem-x` plus the state, registry class or managed rule.
    const selector = `.${CSS.escape(stem)}-new${cond.state}`;
    out.push({
      key: `new-class|${condKey}`,
      label: 'new class',
      media,
      slot: cond.media,
      state: cond.state,
      family: null,
      dest: { kind: 'auto-class', element, media, state: cond.state },
      target: null,
      declared: null,
      existing: {},
      reach: 1,
      winner: false,
      rank: syntheticRank(property, false, { selector, media, order: media || cond.state ? orders.rule : orders.cls }),
    });
  }
  return out;
}

/**
 * Every place for `property` under `cond`, strongest first: each block declaring it that applies
 * under the condition (inline only at Element), and every candidate place that does not declare it
 * yet. The new class comes last whatever its rank: it is the "somewhere else" rung.
 */
export function placesFor(
  model: ElementModel,
  property: string,
  cond: PlaceCondition,
  element: HTMLElement,
  options: PlacesOptions = {},
): Place[] {
  const list = model.cascade(property, conditionContext(model, cond));
  const applying = onePerBlock(list.applying);
  const winner = applying[0];
  const declared: Place[] = [];
  const used = new Map<string, number>();
  for (const one of applying) {
    if (one.source.kind === 'inline') {
      if (!inlineAllowed(cond)) continue;
      declared.push({
        key: 'inline',
        label: 'inline',
        media: null,
        slot: 'base',
        state: '',
        family: null,
        dest: { kind: 'target', target: { kind: 'inline', element } },
        target: { kind: 'inline', element },
        declared: one,
        existing: toRecord(model.inline),
        reach: 1,
        winner: one === winner,
        rank: one,
      });
      continue;
    }
    const entry = one.source.entry;
    const slot = slotKeyOf(model, entry);
    const base = `${entry.family}|${placeConditionKey({ media: slot, state: entry.state })}`;
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);
    declared.push({
      key: seen > 1 ? `${base}#${seen}` : base,
      label: leanBlockSelector(entry.matched),
      media: entry.media,
      slot,
      state: entry.state,
      family: entry.family,
      dest: { kind: 'target', target: entry.target },
      target: entry.target,
      declared: one,
      existing: toRecord(entry.declarations),
      reach: model.reach(entry.family),
      winner: one === winner,
      rank: one,
    });
  }
  const candidates = candidatePlaces(model, cond, element, options)
    .map((place) => ({ ...place, rank: { ...place.rank, property } }));
  const empty = candidates.filter((place) => !declared.some((one) => one.key === place.key));
  const newClass = empty.filter((place) => place.key.startsWith('new-class|'));
  const ranked = [...declared, ...empty.filter((place) => !newClass.includes(place))]
    .sort((a, b) => compareContributions(a.rank, b.rank));
  return [...ranked, ...newClass];
}

/**
 * Declarations of the property that do not apply under the condition because their media query
 * does not hold there (another size, print): listed under the ladder, not as rungs.
 */
export function inactivePlaces(model: ElementModel, property: string, cond: PlaceCondition): Contribution[] {
  const list = model.cascade(property, conditionContext(model, cond));
  // Idle at Element also holds every state's rules; those are conditions of their own, not sizes.
  return onePerBlock(list.idle).filter((one) => one.source.kind === 'rule' && one.source.entry.state === cond.state);
}

/**
 * What a value at `place` does: whether it applies, what it wins over, or what hides it. With
 * `important`, as though it were `!important` (the "Make it !important" offer asks this first).
 */
export function placeOutcome(
  model: ElementModel,
  property: string,
  cond: PlaceCondition,
  place: Place,
  important: boolean,
): { applies: boolean; over: Contribution | null; by: Contribution | null } {
  const list = model.cascade(property, conditionContext(model, cond));
  const mine: Contribution = { ...place.rank, important };
  // The place's own block does not compete with the value written into it: it is replaced.
  const own = blockOf(place.rank);
  const top = onePerBlock(list.applying).filter((one) => blockOf(one) !== own)[0] ?? null;
  if (!top || compareContributions(mine, top) < 0) return { applies: true, over: top, by: null };
  return { applies: false, over: null, by: top };
}

/**
 * Where a new declaration goes when nothing was picked: inline at Element; under a state, a size or
 * a pseudo-element the element's own class (the first it wears that styles it alone), else its new
 * class. Never "any class": writing a hover colour into a class four cards share would change all
 * four without asking.
 */
export function defaultPlace(model: ElementModel, element: HTMLElement, cond: PlaceCondition, places: readonly Place[]): Place {
  if (inlineAllowed(cond)) {
    const inline = places.find((one) => one.key === 'inline');
    if (inline) return inline;
  }
  const condKey = placeConditionKey(cond);
  const own = ownClasses(element).find((name) => model.reach(`.${CSS.escape(name)}`) === 1);
  const mine = own ? places.find((one) => one.key === `.${CSS.escape(own)}|${condKey}`) : undefined;
  return mine ?? places.find((one) => one.key === `new-class|${condKey}`) ?? places[0];
}

/**
 * When a value written at `picked` (a size, a state) would be hidden by the element's own inline
 * declaration of the property, and nothing else: where that inline value can go instead so both
 * show. The inline value moves into the same family's block at Base (the picked class, or the
 * element's new class), which every condition's rule then beats by coming later.
 *
 * Measured, not assumed: the move happens only if the Base block's value would still be what the
 * element renders with at Base (no other rule beats it once inline is gone), and the picked place
 * ranks after it. Without this, a value typed under ≥768px landed in `.featured` at ≥768px while
 * the element's `style="font-size: 16px"` kept winning: the field changed and the page did not.
 */
export function inlineHandOff(
  model: ElementModel,
  property: string,
  cond: PlaceCondition,
  picked: Place,
  element: HTMLElement,
  options: PlacesOptions = {},
): { base: Place; value: string } | null {
  if (inlineAllowed(cond) || picked.key === 'inline') return null;
  const own = model.inline.find((one) => one.property.toLowerCase() === property.toLowerCase());
  if (!own || own.important) return null;
  const { by } = placeOutcome(model, property, cond, picked, false);
  if (by?.source.kind !== 'inline') return null;
  const atBase: PlaceCondition = { media: 'base', state: '' };
  const places = placesFor(model, property, atBase, element, options);
  const base = picked.key.startsWith('new-class|')
    ? places.find((one) => one.key.startsWith('new-class|'))
    : places.find((one) => one.family !== null && one.family === picked.family && one.key === `${picked.family}|base`);
  if (!base || base.target?.kind === 'readonly' || base.reach !== 1) return null;
  // At Base, with inline gone, the moved value must still be the one drawn.
  const rest = onePerBlock(model.cascade(property, conditionContext(model, atBase)).applying)
    .filter((one) => one.source.kind !== 'inline' && blockOf(one) !== blockOf(base.rank));
  const moved: Contribution = { ...base.rank, property };
  if (rest[0] && compareContributions(moved, rest[0]) >= 0) return null;
  // And the picked rule must come after it, to win where its condition holds.
  if (compareContributions({ ...picked.rank, property }, moved) >= 0) return null;
  return { base, value: own.value };
}
