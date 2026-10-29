import { mediaShort } from './breakpoints.js';
import { simpleClassName } from './classes.js';
import {
  managedOrder,
  winnerWith,
  type Contribution,
  type ElementModel,
  type Hypothetical,
  type RuleEntry,
  type WriteTarget,
} from './cascade.js';
import { RULE_STYLE_ID } from './constants.js';
import { mediaApplies } from './viewport.js';

/**
 * Where an edit to a viewport-dependent value should be saved, as options with verdicts.
 *
 * Editing a value the page only shows at one size raises a question a plain inline write
 * answers wrongly: should the change stay at that size, on this element, on the rule, or on a class
 * every card wears? This planner turns the question into a short list of options, each saying how
 * far it reaches and whether the page would then show the value — computed from the cascade model
 * by simulation, so nothing is written to find out.
 *
 * Pure on top of the model: the engine wraps it with the parts only the engine can answer (the
 * automatic class name, inline importance) and commits the option the user picks.
 *
 * One rule it never breaks: a shared rule is never made `!important` on the user's behalf. Only the
 * explicit promote toggle can do that.
 */

/** Where an adder writes one declaration (`EditorEngine.addDeclaration`). */
export type AddDestination =
  | { kind: 'target'; target: WriteTarget }
  /** A rule to create, e.g. `.card` at `(max-width: 767px)`, or `.card:hover`. */
  | { kind: 'new-rule'; selector: string; media: string | null }
  /** This element's automatic class, at a size and in a state. */
  | { kind: 'auto-class'; element: HTMLElement; media: string | null; state: string };

/** What is being saved: one property, or a box editor's batch, for one element. */
export interface SaveContext {
  element: HTMLElement;
  declarations: Record<string, string>;
  /** The size group's slot, else the preview's, else the winning media rule's; null for none. */
  slot: string | null;
  /** The width the edit was made at. */
  width: number;
}

/** How a chosen option is written. */
export type SaveApply =
  | { kind: 'inline'; important: boolean }
  /** The existing rule, its importance kept. */
  | { kind: 'replace'; target: WriteTarget }
  | { kind: 'new-rule'; selector: string; media: string | null }
  | { kind: 'auto-class'; name: string; reuse: boolean; media: string | null; important: boolean };

export interface SaveOption {
  kind: 'solo' | 'inline' | 'rule';
  title: string;
  sub: string;
  /** How many elements the option changes. */
  reach: number;
  /** Whether the option writes `!important`. Never true for `rule`. */
  important: boolean;
  /** Whether the page would show the value afterwards, at the context's width. */
  verdict: { wins: true } | { wins: false; by: string };
  /** Whether the option's condition applies at the width the page renders at now. */
  visibleNow: boolean;
  apply: SaveApply;
}

export interface SavePlan {
  options: SaveOption[];
  /** The automatic class the solo option would write to. */
  autoName: string;
}

/** What only the engine can answer. */
export interface SaveNaming {
  /** The automatic class for this element at this suffix, and whether it already exists on it. */
  autoClass(element: HTMLElement, suffix: string): { name: string; reuse: boolean };
  /** Whether an inline write of this value would carry `!important` (`overrideStyle`'s rule). */
  inlineImportant(element: HTMLElement, property: string, value: string): boolean;
  /** The element's first own class that is not an automatic one, or null. */
  stemClass(element: HTMLElement): string | null;
}

/** Where a value comes from, short: `inline style`, `.card ≥768px`. */
export function shortLabel(by: Contribution): string {
  return by.source.kind === 'inline' ? 'inline style' : entryLabel(by.source.entry);
}
/** A rule entry, short: `.card`, `.card ≥768px`. */
export function entryLabel(entry: Pick<RuleEntry, 'selector' | 'media'>): string {
  return `${entry.selector}${entry.media ? ` ${mediaShort(entry.media)}` : ''}`;
}
/** A person-readable name for what wins: `.promo .card !important`, `.card ≥768px`, `inline style`. */
export function contributionLabel(by: Contribution): string {
  const base = shortLabel(by);
  return by.important ? `${base} !important` : base;
}
/** `word` for one, its plural otherwise: the one place a count picks its noun. Regular plurals only. */
export function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
/** "1 rule", "3 rules": a count with its noun. */
export function countText(n: number, word: string): string {
  return `${n} ${plural(n, word)}`;
}
/** "1 element", "4 elements": how many elements a rule or class reaches, said the same everywhere. */
export function reachText(n: number): string {
  return countText(n, 'element');
}

let warned = false;

/** The options for saving `ctx`, in order: solo (with a slot), inline, rule. */
export function planViewportSave(
  model: ElementModel,
  ctx: SaveContext,
  naming: SaveNaming,
): SavePlan {
  const properties = Object.keys(ctx.declarations);
  const slot = ctx.slot ? model.slots().find((one) => one.key === ctx.slot) ?? null : null;
  const otherMedia = ctx.slot?.startsWith('other:') ? ctx.slot.slice('other:'.length) : null;
  const media = slot?.media ?? otherMedia;
  const width = slot?.at ?? ctx.width;
  const sizeLabel = media ? mediaShort(media) : '';
  const visibleNow = mediaApplies(media, null);

  /** Every property of the batch simulated as `as`; the first loser names the verdict. */
  const simulate = (
    as: (property: string) => Hypothetical['as'],
    important: (property: string) => boolean,
  ): SaveOption['verdict'] => {
    try {
      for (const property of properties) {
        const result = winnerWith(
          model,
          { property, value: ctx.declarations[property], important: important(property), as: as(property) },
          { width },
        );
        if (!result.wins) return { wins: false, by: result.by ? contributionLabel(result.by) : 'another rule' };
      }
      return { wins: true };
    } catch (error) {
      // Recoverable: the option stays selectable and says it cannot tell.
      if (!warned) {
        warned = true;
        console.warn('[html-editor-overlay] could not simulate a save option', error);
      }
      return { wins: false, by: 'unknown' };
    }
  };

  const options: SaveOption[] = [];
  const suffix = slot?.key ?? (otherMedia ? 'media' : 'own');
  const auto = naming.autoClass(ctx.element, suffix);

  /* ---- solo: an automatic class on this element, at this size ---- */
  if (media) {
    const sheetOrder = managedOrder(RULE_STYLE_ID);
    const asNew = (): Hypothetical['as'] => ({
      kind: 'new-rule',
      selector: `.${cssEscape(auto.name)}`,
      media,
      state: '',
      sheetOrder,
    });
    let important = false;
    let verdict = simulate(asNew, () => false);
    if (!verdict.wins) {
      const retried = simulate(asNew, () => true);
      if (retried.wins) {
        important = true;
        verdict = retried;
      }
    }
    const beaten = important ? simulate(asNew, () => false) : null;
    options.push({
      kind: 'solo',
      title: `This element only, at ${sizeLabel}`,
      sub:
        `${auto.reuse ? 'in its automatic class' : 'adds an automatic class'}, .${auto.name}, ` +
        `${auto.reuse ? 'on' : 'to'} this element` +
        (important && beaten && !beaten.wins ? `, with !important to beat ${beaten.by}` : ''),
      reach: 1,
      important,
      verdict,
      visibleNow,
      apply: { kind: 'auto-class', name: auto.name, reuse: auto.reuse, media, important },
    });
  }

  /* ---- inline: this element, at every size ---- */
  const inlineImportant = properties.some((property) =>
    naming.inlineImportant(ctx.element, property, ctx.declarations[property]));
  options.push({
    kind: 'inline',
    title: media ? 'This element, at every size' : 'This element only',
    sub: `inline style${inlineImportant ? ', with !important to beat a rule that has it' : ''}`,
    reach: 1,
    important: inlineImportant,
    verdict: simulate(() => ({ kind: 'inline' }), () => inlineImportant),
    visibleNow: true,
    apply: { kind: 'inline', important: inlineImportant },
  });

  /* ---- rule: the rule or class itself, at that size ---- */
  const rule = ruleOption(model, ctx, properties[0], media, width, naming.stemClass(ctx.element));
  if (rule) {
    const asRule = (): Hypothetical['as'] =>
      rule.entry
        ? { kind: 'replace', entry: rule.entry }
        : {
          kind: 'new-rule',
          selector: rule.selector,
          media,
          state: '',
          sheetOrder: managedOrder(RULE_STYLE_ID),
        };
    // Replacing keeps the declaration's own importance; a new rule has none.
    const keptImportance = (property: string): boolean =>
      rule.entry?.declarations.some(
        (one) => one.property.toLowerCase() === property.toLowerCase() && one.important,
      ) ?? false;
    const option: SaveOption = {
      kind: 'rule',
      title: `The ${rule.isClass ? 'class' : 'rule'} ${rule.selector}${sizeLabel ? ` ${sizeLabel}` : ''}`,
      sub: rule.entry
        ? rule.isClass ? 'the class itself, at that size' : 'the stylesheet rule'
        : 'added to the class, for every element that has it',
      reach: model.reach(rule.selector),
      important: false,
      verdict: simulate(asRule, keptImportance),
      visibleNow: rule.entry ? model.applies(rule.entry) : visibleNow,
      apply: rule.entry
        ? { kind: 'replace', target: rule.entry.target }
        : { kind: 'new-rule', selector: rule.selector, media },
    };
    // The one invariant this planner owns: a shared rule is never promoted on the user's behalf.
    if (option.important) throw new Error('A rule option must never set !important.');
    options.push(option);
  }

  return { options, autoName: auto.name };
}

/**
 * The rule option's rule: the winner's family entry at this size when it exists, else a class the
 * element wears, to be created at this size. Null when there is neither.
 */
function ruleOption(
  model: ElementModel,
  ctx: SaveContext,
  property: string,
  media: string | null,
  width: number,
  stem: string | null,
): { selector: string; isClass: boolean; entry: RuleEntry | null } | null {
  const winner = model.cascade(property, { width: ctx.width }).applying[0]
    ?? model.cascade(property, { width }).applying[0];
  const family = winner?.source.kind === 'rule' ? winner.source.entry.family : null;
  if (family) {
    const slotKey = ctx.slot;
    const entry = model.entries.find((one) =>
      one.family === family &&
      one.state === '' &&
      (slotKey ? model.slotOf(one) === slotKey : one.media === null));
    if (entry && entry.target.kind !== 'readonly') {
      return { selector: family, isClass: simpleClassName(family) !== null, entry };
    }
    const name = simpleClassName(family);
    if (name && media && ctx.element.classList.contains(name)) {
      return { selector: family, isClass: true, entry: null };
    }
  }
  // The element's own class, at this size: a new rule every element with the class gets.
  if (!media || !stem) return null;
  return { selector: `.${cssEscape(stem)}`, isClass: true, entry: null };
}

function cssEscape(name: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(name) : name;
}
