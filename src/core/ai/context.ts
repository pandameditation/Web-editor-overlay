/**
 * What the model is told about the element it is being asked to change.
 *
 * A serialiser, not new analysis. Everything here already exists because the Styles panel
 * needs it to draw itself, and the bundle deliberately reads the *same* functions rather
 * than its own equivalents — `declaredMap` is the definition of "set" behind the panel's
 * blue dot, so a model told something different would be told something the user cannot see.
 *
 * Three things it takes care to get right.
 *
 * **It reports origin, not just value.** `padding: 12px` arriving from `.card` and the same
 * declaration written on the element are the same value and completely different facts: one
 * is shared with eleven other cards and the other is not. A model that cannot tell them
 * apart will cheerfully edit the class when it meant to nudge one element.
 *
 * **It says what is off limits.** Scope is enforced in `broker.ts` and nothing here can
 * change that, but a model that is not told will keep proposing edits that get refused,
 * and the user reads a list of refusals as the feature being broken. So each class and rule
 * carries whether this set may edit it.
 *
 * **It has a budget and admits when it hits it.** A real page can match two hundred rules.
 * Sending all of them costs more than it is worth and can exceed the window outright, so
 * the least specific are dropped and the bundle says how many — silently truncating is how
 * a model comes to look as though it ignored a rule that was never sent.
 */

import { normalizeClassName } from '../classes.js';
import {
  appliedRules,
  authoredInline,
  cascadedDeclarations,
  declaredMap,
  declaredValues,
  fromElementClass,
  parentLayoutProperties,
  sizeConstraints,
  stateRules,
  type AppliedRule,
  type InlinePreview,
} from '../css.js';
import { labelFor, selectableParent, selectorFor } from '../dom.js';
import { cleanInnerMarkup, cleanMarkup } from '../mutations.js';
import type { ClassRegistry } from '../classes.js';
import type { RuleRegistry } from '../rules.js';
import {
  AI_SCOPE_CLASSES,
  DEFAULT_AI_CONTEXT_SCOPE,
  type AiContextScope,
  type AiScopeClass,
} from './types.js';

/** How much of the element's own markup travels. Past this the model gets a summary. */
const MARKUP_BUDGET = 4000;
/** How many matched rules are worth sending, most specific first. */
const RULE_BUDGET = 24;
/** How many declarations of one rule or class are worth sending. */
const DECLARATION_BUDGET = 40;

/** One declaration, with the thing that set it. */
export interface ContextDeclaration {
  property: string;
  value: string;
  /** `style attribute`, or the selector it won from. */
  from: string;
  /** True when it is written on the element itself rather than arriving from a rule. */
  own: boolean;
}

/** A class on the element, and whether the editor knows how to change it. */
export interface ContextClass {
  name: string;
  /** Absent when the class is on the element but nothing declares it. */
  declarations?: Record<string, string>;
  /** `stylesheet` for one read out of the page, `user` once this session has touched it. */
  origin?: string;
  /** How many elements on this page wear it, so the model can weigh a shared edit. */
  usedBy: number;
  /** False when the active set may not edit classes. */
  editable: boolean;
}

/** A rule that reaches the element, or would in some state. */
export interface ContextRule {
  selector: string;
  /** The one compound of a selector list that actually matched. */
  matched?: string;
  /** File name, `embedded`, `adopted`, or a shadow root. */
  source: string;
  specificity: number;
  /** `@media …` this rule sits inside, when any. */
  condition?: string;
  /** `:hover`, `::before` — set only for rules that do not apply as the element stands. */
  pseudo?: string;
  declarations: Record<string, string>;
  /** How many elements it matches right now. */
  matches?: number;
  /** False when the active set may not edit rules. */
  editable: boolean;
}

/** How the container treats the element, and what is capping it. */
export interface ContextParent {
  label: string;
  selector: string;
  tag: string;
  classes: string[];
  /** The parent's own layout declarations, chosen for its display mode. */
  layout: ContextDeclaration[];
  /**
   * An ancestor declaration the element is actually flush against.
   *
   * Only the binding ones. "Something above sets a max-width" is trivia; "you cannot get
   * wider than 640px because this section says so" is the answer to a question the user is
   * about to ask the model.
   */
  caps: Array<{ label: string; property: string; value: string; available: number; depth: number }>;
  /** False when the active set may not touch the parent. */
  editable: boolean;
}

/** Everything the model is given about one element. */
export interface AiContext {
  label: string;
  selector: string;
  tag: string;
  id?: string;
  classes: ContextClass[];
  attributes: Record<string, string>;
  /** The element's own markup, bookkeeping attributes stripped. */
  innerHTML: string;
  /** Plain text, so a model asked only to reword has the words without the tags. */
  text: string;
  /** True when `innerHTML` was cut to fit the budget. */
  markupTruncated: boolean;
  /** What the element sets, own declarations first. The blue-dot set. */
  declared: ContextDeclaration[];
  /** Rules reaching it now, most specific first. */
  rules: ContextRule[];
  /** Rules needing a state or drawing a pseudo-element. Not currently applying. */
  stateRules: ContextRule[];
  /** How many matched rules were dropped for the budget. */
  rulesOmitted: number;
  parent: ContextParent | null;
  /** The scope classes this set may write, for the model to read as well as the broker. */
  allowed: AiScopeClass[];
  /**
   * What was left out of this bundle at the user's request.
   *
   * Named rather than silently absent, because "no matched rules" and "you were not shown the
   * matched rules" lead to different replies — the first invites inventing a selector, the second
   * invites saying that the answer needs them.
   */
  withheld: (keyof AiContextScope)[];
}

export interface ContextSources {
  classes: ClassRegistry;
  rules: RuleRegistry;
  /** The in-flight style preview, when it belongs to this element. See `authoredInline`. */
  preview?: InlinePreview | null;
}

/**
 * Build the bundle for one element.
 *
 * Pure with respect to the page: it reads the DOM and the registries and writes nothing.
 * That matters because it runs immediately before a request goes out, and a builder with
 * side effects would make the thing it describes differ from the thing it described.
 */
export function buildAiContext(
  el: HTMLElement,
  sources: ContextSources,
  include: AiContextScope = DEFAULT_AI_CONTEXT_SCOPE,
): AiContext {
  /*
   * One question, asked once.
   *
   * Described and editable are the same answer now: a scope switched on is sent and may be
   * changed, a scope switched off is neither. The broker is handed this same object, so what the
   * model is told here and what is enforced there cannot drift — they used to be computed
   * separately and the gap between them was a bug.
   */
  const allowed = AI_SCOPE_CLASSES.filter((key) => include[key]);
  const may = (scope: AiScopeClass): boolean => include[scope];
  const shown = may;

  const rules = appliedRules(el);
  const inline = authoredInline(el, sources.preview ?? null);
  const { values, origins } = declaredMap(cascadedDeclarations(rules), inline);

  const declared: ContextDeclaration[] = [...values.keys()]
    .filter((property) => origins.has(property))
    .map((property) => {
      const origin = origins.get(property);
      return {
        property,
        value: values.get(property) ?? '',
        from: origin?.selector ?? '',
        own: origin?.kind === 'inline',
      };
    })
    // Own declarations first: they are what this element decides for itself, and they are
    // what an edit to the element will collide with.
    .sort((a, b) => Number(b.own) - Number(a.own) || a.property.localeCompare(b.property));

  const markup = cleanInnerMarkup(el);
  const markupTruncated = markup.length > MARKUP_BUDGET;

  return {
    label: labelFor(el),
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    /*
     * A class list, but only the names, when classes are not being sent.
     *
     * Not an empty array: the names are on the element's own markup, which is always in the
     * bundle, so hiding them would be a fiction the model can see through — and it would invite
     * a request to "add a class" that duplicates one already there. What is withheld is what
     * each class *declares*, which is the bulk of it and the part about other elements.
     */
    classes: shown('classes')
      ? describeClasses(el, sources.classes, may('classes'))
      : bareClasses(el, may('classes')),
    attributes: authoredAttributes(el),
    innerHTML: markupTruncated ? `${markup.slice(0, MARKUP_BUDGET)}\n<!-- … truncated -->` : markup,
    text: (el.textContent ?? '').trim(),
    markupTruncated,
    declared,
    ...(shown('rules')
      ? describeRules(el, rules, sources.rules, may('rules'))
      : { rules: [], rulesOmitted: 0 }),
    stateRules: shown('rules')
      ? stateRules(el)
        .slice(-RULE_BUDGET)
        .reverse()
        .map((rule) => describeRule(rule, sources.rules, may('rules')))
      : [],
    parent: shown('parent') ? describeParent(el, may('parent')) : null,
    allowed,
    withheld: (['classes', 'rules', 'parent'] as const).filter((scope) => !shown(scope)),
  };
}

/**
 * Class names with nothing attached, for a request that is not about styling.
 *
 * `declarations` is left undefined rather than empty, which is the same shape a class carries
 * when the registry has never seen it — so a model reading this cannot tell "not sent" from
 * "nothing recorded", and correctly treats neither as "declares nothing".
 */
function bareClasses(el: HTMLElement, editable: boolean): ContextClass[] {
  return Array.from(el.classList)
    .filter((name) => !name.startsWith('heo-'))
    .map((name) => ({ name, usedBy: 1, editable }));
}

/**
 * The element's classes, registry entries where there are any.
 *
 * `heo-` names are dropped: they are the overlay's own, they are not in anybody's file, and
 * describing them to a model invites it to try to edit them.
 */
function describeClasses(
  el: HTMLElement,
  registry: ClassRegistry,
  editable: boolean,
): ContextClass[] {
  const usage = registry.usage();
  return Array.from(el.classList)
    .filter((name) => !name.startsWith('heo-'))
    .map((name) => {
      const entry = registry.get(name);
      return {
        name,
        declarations: entry ? capDeclarations(entry.declarations) : undefined,
        origin: entry?.origin,
        usedBy: usage.get(name) ?? 1,
        editable,
      };
    });
}

/**
 * Attributes worth describing.
 *
 * The editor's own bookkeeping is excluded, and so is `class` and `style` — both are
 * reported in richer form elsewhere in the bundle, and sending them twice invites a model
 * to rewrite the whole attribute when it meant to change one declaration.
 */
function authoredAttributes(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name === 'class' || name === 'style') continue;
    if (name.startsWith('data-heo-')) continue;
    if (name === 'contenteditable' || name === 'spellcheck') continue;
    out[name] = attr.value;
  }
  return out;
}

/**
 * The rules reaching this element, budgeted from the most specific end.
 *
 * Most specific first because that is the end that decides. When the budget bites it is the
 * `*` and `body` rules that go, which are the ones a targeted edit was never going to touch.
 *
 * Rules arriving from one of the element's own classes are left out: they are already in the
 * `classes` list with their usage count, and listing them twice makes a class edit look like
 * two different offers.
 */
function describeRules(
  el: HTMLElement,
  rules: AppliedRule[],
  registry: RuleRegistry,
  editable: boolean,
): { rules: ContextRule[]; rulesOmitted: number } {
  const own = rules.filter(
    (rule) => rule.origin === 'stylesheet' && !fromElementClass(rule.selector, el),
  );
  const ordered = [...own].sort((a, b) => b.specificity - a.specificity);
  return {
    rules: ordered.slice(0, RULE_BUDGET).map((rule) => describeRule(rule, registry, editable)),
    rulesOmitted: Math.max(0, ordered.length - RULE_BUDGET),
  };
}

function describeRule(
  rule: AppliedRule,
  registry: RuleRegistry,
  editable: boolean,
): ContextRule {
  const declarations: Record<string, string> = {};
  for (const one of rule.declarations.slice(0, DECLARATION_BUDGET)) {
    declarations[one.property] = one.important ? `${one.value} !important` : one.value;
  }
  return {
    selector: rule.selector,
    matched: rule.matchedSelector !== rule.selector ? rule.matchedSelector : undefined,
    source: rule.source,
    specificity: rule.specificity,
    condition: rule.condition,
    pseudo: rule.pseudo,
    declarations,
    matches: registry.has(rule.selector) ? registry.matchCount(rule.selector) : undefined,
    editable,
  };
}

/**
 * The container, when the element has one worth describing.
 *
 * Its layout declarations rather than everything it sets, chosen by its display mode the
 * same way the Styles panel chooses them — a flex row's `gap` decides how much room this
 * child gets, and its `color` does not.
 */
function describeParent(el: HTMLElement, editable: boolean): ContextParent | null {
  const parent = selectableParent(el);
  if (!parent) return null;

  const declared = declaredValues(parent);
  const layout: ContextDeclaration[] = parentLayoutProperties(parent)
    .map((property) => {
      const entry = declared.get(property);
      return entry
        ? {
          property,
          value: entry.value,
          from: entry.from,
          own: entry.from === 'style attribute',
        }
        : null;
    })
    .filter((one): one is ContextDeclaration => one !== null);

  const caps = [...sizeConstraints(el, 'width'), ...sizeConstraints(el, 'height')]
    .filter((cap) => cap.binding)
    .map((cap) => ({
      label: labelFor(cap.el),
      property: cap.property,
      value: cap.value,
      available: Math.round(cap.available),
      depth: cap.depth,
    }));

  return {
    label: labelFor(parent),
    selector: selectorFor(parent),
    tag: parent.tagName.toLowerCase(),
    classes: Array.from(parent.classList).filter((name) => !name.startsWith('heo-')),
    layout,
    caps,
    editable,
  };
}

/** A registry entry's declarations, capped the same way a rule's are. */
function capDeclarations(declarations: Record<string, string>): Record<string, string> {
  const entries = Object.entries(declarations).slice(0, DECLARATION_BUDGET);
  return Object.fromEntries(entries);
}

/**
 * The bundle as the text a model actually reads.
 *
 * JSON rather than prose, and that is a considered choice: the model has to answer in
 * structured operations, so giving it structure to read makes the shape of the reply
 * obvious from the shape of the request. The one piece of prose is the note about what is
 * off limits, because a bare `"editable": false` reads as a hint and this needs to read as
 * a boundary.
 */
export function renderAiContext(context: AiContext): string {
  const refused = (['classes', 'rules', 'parent'] as AiScopeClass[]).filter(
    (scope) => !context.allowed.includes(scope),
  );
  const notes: string[] = [];
  if (refused.length) {
    notes.push(
      `You may not change: ${refused.join(', ')}. Operations touching them will be refused, ` +
      'so do not propose them — say so in your summary instead if the change needs one.',
    );
  }
  if (context.rulesOmitted) {
    notes.push(
      `${context.rulesOmitted} less specific matched rule${context.rulesOmitted === 1 ? '' : 's'} ` +
      'were left out of this listing.',
    );
  }
  if (context.markupTruncated) {
    notes.push('The element markup was truncated, so do not reproduce it wholesale.');
  }
  /*
   * What was withheld, said before what is present is trusted.
   *
   * Without this a bundle carrying `"rules": []` reads as "nothing styles this element", and the
   * reply confidently proposes a selector that already exists. The note is what turns an absence
   * into a known unknown, and it tells the model what to do about it — ask, rather than guess.
   */
  /*
   * What is out of scope, and — the part that matters — what to do instead.
   *
   * Three sentences that each cost a complaint to learn.
   *
   * *Not evidence that there are none*: a bundle carrying `"rules": []` reads as "nothing styles
   * this element", and the reply invents a selector that already exists.
   *
   * *Not yours to change*: saying only that they were undescribed, while the allowed list still
   * named them, told the model rules existed and that it might edit ones it had not seen. It did.
   *
   * *Everything inside the element still is*: told only what was off limits, a model asked to
   * restyle a nested `<b>` replied that it could not and changed nothing — while the route needing
   * no scope at all, rewriting the element's own markup, sat unused. A boundary that does not also
   * point at the way through reads as a refusal of the request rather than of one method.
   */
  if (context.withheld.length) {
    notes.push(
      `Out of scope for this request: ${context.withheld.join(', ')}. That is a choice the user ` +
      'made, not evidence there are none — so do not assume the element has no classes, no ' +
      'matching rules and no parent, and do not invent any. They are not yours to change here ' +
      'either: operations touching them will be refused. It restricts the method, not the ' +
      'request. Everything inside the element remains yours through setText, including putting a ' +
      'style or class attribute on a nested node, and that is always in scope. Use it. Decline ' +
      'only when no route in scope reaches the result, and then name the one switch that would.',
    );
  }
  const payload = { ...context, notes: notes.length ? notes : undefined };
  return JSON.stringify(payload, null, 1);
}

/**
 * A class name the broker would accept, or null.
 *
 * Exported from here rather than restated in the broker because the context builder is what
 * told the model which classes exist, so the two have to agree about what a class name is.
 */
export function contextClassName(raw: string): string | null {
  return normalizeClassName(raw) || null;
}

/** The element's outer markup, for a caller that wants to show the user what is being sent. */
export function contextMarkup(el: HTMLElement): string {
  return cleanMarkup(el);
}
