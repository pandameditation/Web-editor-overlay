/**
 * The boundary. Nothing a model says reaches the page except through here.
 *
 * The design premise is that a prompt is a request and this is a wall. The system prompt in
 * `ops.ts` tells the model what it may do, which is worth doing because a model that keeps
 * proposing refused work makes the feature look broken — but it is advice, and advice is not
 * a security property. Every operation is re-derived and re-checked here against the live
 * page and the active permission, and a refusal carries a sentence the user can read.
 *
 * Validation only. This function touches nothing: it returns a plan, and `session.ts` applies
 * it. That split is what makes the boundary testable — a fixture can feed hostile operations
 * and assert on the verdicts without a single mutation having to be undone, and can watch the
 * overlay host for mutations to prove it.
 *
 * Four checks, in this order, because the order is the useful one:
 *
 * 1. **Shape.** Is this one of the six operations, with the fields it needs?
 * 2. **Permission.** Is the scope class this operation needs switched on for this request? Off is
 *    a refusal, stated with the name of the switch that would allow it. There is nothing to ask:
 *    the answer was given in the popover a moment ago and is one click from being changed.
 * 3. **Reach.** For the one operation carrying a selector, does that selector actually stay
 *    inside what the user selected, and does it keep away from the overlay?
 * 4. **Content.** Markup through the HTML sanitiser, declarations through the property
 *    validator and the CSS URL check.
 */

import { normalizeClassName } from '../classes.js';
import { fromElementClass } from '../css.js';
import { findStyleRule } from '../sheets.js';
import { checkDeclaration } from '../declarations.js';
import { isOverlayNode } from '../dom.js';
import { safeCssValue, sanitizeFragmentReporting, type SanitizeReport } from '../sanitize.js';
import { safeSelector } from '../selectors.js';
import { OPERATION_SCOPE, type AiOperation, type AiOperationName } from './ops.js';
import {
  AI_CONTEXT_LABELS,
  AI_SCOPE_LABELS,
  type AiContextScope,
  type AiScopeClass,
} from './types.js';

/**
 * The chip label for each scope, so a refusal names the control the user is looking at.
 * `AI_SCOPE_LABELS` is the long form for prose; this is what is written on the switch.
 */
const CHIP_LABELS: Record<AiScopeClass, string> = {
  classes: AI_CONTEXT_LABELS.find((one) => one.key === 'classes')?.label ?? 'Classes',
  rules: AI_CONTEXT_LABELS.find((one) => one.key === 'rules')?.label ?? 'CSS rules',
  parent: AI_CONTEXT_LABELS.find((one) => one.key === 'parent')?.label ?? 'Parent',
};

/** The two elements an operation may name, resolved once by the caller. */
export interface BrokerTarget {
  element: HTMLElement;
  parent: HTMLElement | null;
}

/** A validated operation, ready to apply, with everything the UI has to say about it. */
export interface PlannedOperation {
  /** Normalised: names lower-cased, values trimmed, refused declarations already removed. */
  op: AiOperation;
  /** Which permission it needs. `none` for a summary. */
  scope: AiScopeClass | 'element' | 'none';
  /** One sentence naming what it will do, for the run log and the change record. */
  describe: string;
  /**
   * Why this change reaches past the selected element, when it does.
   *
   * The text the run's closing message flags. Derived here rather than taken from the model,
   * because it is a fact about what is being applied and the model is not a witness to that.
   */
  sideEffect?: string;
  /** What the sanitiser took out, so the user is told rather than left wondering. */
  removed?: string[];
  /** Declarations dropped by the validator, with the reason each was dropped. */
  rejected?: string[];
  /** For a rule that already exists in the page's own stylesheets. See `resolveLiveRule`. */
  liveRule?: CSSStyleRule | null;
}

export type BrokerVerdict =
  | { ok: true; plan: PlannedOperation }
  | { ok: false; reason: string };

/**
 * Check one operation and return what applying it would mean.
 *
 * `raw` is whatever came off the wire — unknown, possibly not an object at all — because the
 * only trustworthy assumption about model output is that it is a string somebody else wrote.
 */
export function reviewOperation(
  raw: unknown,
  target: BrokerTarget,
  /**
   * What this request may see and change — the popover's three switches.
   *
   * The same object the context builder was given, so what the model was told and what it is held
   * to are the same fact. There is no second, standing permission to reconcile it with: that
   * existed, could disagree with this, and did.
   */
  scope: AiContextScope,
): BrokerVerdict {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'That reply was not an operation the editor understands.' };
  }
  const name = (raw as { op?: unknown }).op;
  if (typeof name !== 'string' || !(name in OPERATION_SCOPE)) {
    return {
      ok: false,
      reason: `“${String(name ?? 'nothing')}” is not something this editor can do.`,
    };
  }
  const op = name as AiOperationName;
  const needs = OPERATION_SCOPE[op];

  /*
   * Permission before content: being told "you may not edit classes" is more useful than being
   * told a property name was wrong in a change that was never going to be allowed.
   *
   * The refusal names the switch to flip, and says where it is. A refusal that only states the
   * boundary sends the user to the settings, where this no longer lives.
   */
  if (needs !== 'element' && needs !== 'none' && !scope[needs]) {
    return {
      ok: false,
      reason:
        `${AI_SCOPE_LABELS[needs]} are switched off for this request, so that change was not ` +
        `made. Turn on ${CHIP_LABELS[needs]} beside the prompt and ask again — or ask for the ` +
        'same result on the element itself, which is always allowed.',
    };
  }

  switch (op) {
    case 'summary':
      return reviewSummary(raw);
    case 'setText':
      return reviewSetText(raw, target);
    case 'setStyles':
      return reviewStyles(raw, target.element, 'setStyles');
    case 'setParentStyles':
      return target.parent
        ? reviewStyles(raw, target.parent, 'setParentStyles')
        : {
          ok: false,
          reason: 'This element has no editable parent, so there is nothing to change there.',
        };
    case 'setClasses':
      return reviewSetClasses(raw, target.element);
    case 'upsertClass':
      return reviewUpsertClass(raw);
    case 'upsertRule':
      return reviewUpsertRule(raw, target, scope);
    default:
      return { ok: false, reason: 'That operation is not implemented.' };
  }
}

/* -------------------------------------------------------------------------- */
/* One reviewer per operation                                                  */
/* -------------------------------------------------------------------------- */

function reviewSummary(raw: object): BrokerVerdict {
  const text = String((raw as { text?: unknown }).text ?? '').trim();
  if (!text) return { ok: false, reason: 'The summary was empty.' };
  return {
    ok: true,
    plan: {
      op: { op: 'summary', text },
      scope: 'none',
      describe: text,
    },
  };
}

/**
 * Replacing what is inside the element.
 *
 * Sanitised here rather than on the way in, so the plan carries the cleaned markup and the
 * account of what was taken out. `setInnerHTML` does not sanitise — it is built for
 * `contenteditable` output, which the browser already made safe — so this is the only thing
 * standing between model output and the page.
 */
function reviewSetText(raw: object, target: BrokerTarget): BrokerVerdict {
  const html = (raw as { html?: unknown }).html;
  if (typeof html !== 'string') {
    return { ok: false, reason: 'That change to the text carried no markup.' };
  }
  const { fragment, report } = sanitizeFragmentReporting(html);
  const container = document.createElement('div');
  container.append(fragment);
  const cleaned = container.innerHTML;
  if (!cleaned.trim() && html.trim()) {
    return {
      ok: false,
      reason: 'Everything in that markup was removed as unsafe, so there is nothing to write.',
    };
  }
  return {
    ok: true,
    plan: {
      op: { op: 'setText', html: cleaned },
      scope: 'element',
      describe: `Rewrite the contents of ${target.element.tagName.toLowerCase()}`,
      removed: describeRemoved(report),
    },
  };
}

/** Inline declarations, on the element or on its parent. */
function reviewStyles(
  raw: object,
  el: HTMLElement,
  op: 'setStyles' | 'setParentStyles',
): BrokerVerdict {
  const checked = vetDeclarations((raw as { declarations?: unknown }).declarations);
  if ('reason' in checked) return { ok: false, reason: checked.reason };
  const properties = Object.keys(checked.declarations);
  const parentOp = op === 'setParentStyles';
  return {
    ok: true,
    plan: {
      op: parentOp
        ? { op: 'setParentStyles', declarations: checked.declarations }
        : { op: 'setStyles', declarations: checked.declarations },
      scope: parentOp ? 'parent' : 'element',
      describe: `Set ${listOf(properties)} on ${el.tagName.toLowerCase()}`,
      sideEffect: parentOp
        ? `${listOf(properties)} set on the parent <${el.tagName.toLowerCase()}> — every child moves with it.`
        : undefined,
      rejected: checked.rejected.length ? checked.rejected : undefined,
    },
  };
}

/**
 * Class names on the element.
 *
 * `element` scope, not `classes`: putting an existing class on one element changes that one
 * element, which is a different act from editing what the class declares. Conflating them
 * would mean a user who wanted the model to apply their design system had to also let it
 * rewrite it.
 *
 * The overlay's own `heo-` names are refused rather than filtered, because a model asking for
 * one has misunderstood something and silently ignoring it hides that.
 */
function reviewSetClasses(raw: object, el: HTMLElement): BrokerVerdict {
  const source = raw as { add?: unknown; remove?: unknown };
  const add = nameList(source.add);
  const remove = nameList(source.remove);
  if ('reason' in add) return { ok: false, reason: add.reason };
  if ('reason' in remove) return { ok: false, reason: remove.reason };
  if (!add.names.length && !remove.names.length) {
    return { ok: false, reason: 'That change to the classes named none.' };
  }
  const parts: string[] = [];
  if (add.names.length) parts.push(`add ${add.names.map((name) => `.${name}`).join(' ')}`);
  if (remove.names.length) parts.push(`remove ${remove.names.map((name) => `.${name}`).join(' ')}`);
  return {
    ok: true,
    plan: {
      op: { op: 'setClasses', add: add.names, remove: remove.names },
      scope: 'element',
      describe: `On ${el.tagName.toLowerCase()}, ${parts.join(' and ')}`,
    },
  };
}

/** Defining or extending a reusable class. */
function reviewUpsertClass(raw: object): BrokerVerdict {
  const name = normalizeClassName(String((raw as { name?: unknown }).name ?? ''));
  if (!name) {
    return { ok: false, reason: 'That class name cannot be used — it has to start with a letter.' };
  }
  if (name.startsWith('heo-')) {
    return { ok: false, reason: `.${name} belongs to the editor, so it cannot be changed.` };
  }
  const checked = vetDeclarations((raw as { declarations?: unknown }).declarations);
  if ('reason' in checked) return { ok: false, reason: checked.reason };
  const wearing = document.querySelectorAll(`.${CSS.escape(name)}`).length;
  return {
    ok: true,
    plan: {
      op: { op: 'upsertClass', name, declarations: checked.declarations },
      scope: 'classes',
      describe: `Set ${listOf(Object.keys(checked.declarations))} on .${name}`,
      sideEffect:
        wearing > 1
          ? `.${name} changed — ${wearing} elements on this page use it.`
          : `.${name} changed — a reusable class, so anything given it later picks this up.`,
      rejected: checked.rejected.length ? checked.rejected : undefined,
    },
  };
}

/**
 * Defining or extending a CSS rule. The one operation that carries a selector, and the one
 * that gets the most scrutiny.
 *
 * Three questions, and a selector has to pass all three. Is it a selector at all. Does it
 * stay inside what the user selected — meaning it matches the element, or the parent when
 * that is permitted, or only things inside the element. And does it keep away from the
 * overlay's own DOM.
 *
 * The last one is not covered by the second. `*` matches the element, so a reach test alone
 * would wave it through while it also matches every other node in the document including the
 * editor's own. So the match set is walked and any overlay node in it is fatal.
 */
function reviewUpsertRule(
  raw: object,
  target: BrokerTarget,
  scope: AiContextScope,
): BrokerVerdict {
  const requested = String((raw as { selector?: unknown }).selector ?? '');
  const selector = safeSelector(requested);
  if (!selector) {
    return {
      ok: false,
      reason: `“${requested.trim() || 'that'}” is not a CSS selector the browser accepts.`,
    };
  }

  /*
   * A rule whose selector is one of the element's own classes is a class edit, and is
   * permitted as one.
   *
   * Found by the fixture, and it was a real hole. `{"op":"upsertRule","selector":".card"}`
   * and `{"op":"upsertClass","name":"card"}` change exactly the same CSS and reach exactly
   * the same elements — so a set that granted rules and only asked about classes could have
   * its class question walked straight past by spelling the request the other way. Which
   * permission applies has to follow what the change *does*, not which word the model
   * happened to choose for it.
   *
   * `fromElementClass` is the same predicate the Styles panel uses to decide what belongs in
   * its Classes section rather than its CSS rules section, which is the same distinction.
   */
  if (fromElementClass(selector, target.element)) {
    if (!scope.classes) {
      return {
        ok: false,
        reason:
          `${selector} is one of this element's classes, and ${CHIP_LABELS.classes} is switched ` +
          'off for this request, so that change was not made.',
      };
    }
    return reviewUpsertClass({
      name: selector.replace(/^\./, ''),
      declarations: (raw as { declarations?: unknown }).declarations,
    });
  }

  const reach = reviewReach(selector, target);
  if (reach) return { ok: false, reason: reach };

  const checked = vetDeclarations((raw as { declarations?: unknown }).declarations);
  if ('reason' in checked) return { ok: false, reason: checked.reason };

  const matches = safeQuery(selector).length;
  return {
    ok: true,
    plan: {
      op: { op: 'upsertRule', selector, declarations: checked.declarations },
      scope: 'rules',
      describe: `Set ${listOf(Object.keys(checked.declarations))} on ${selector}`,
      sideEffect:
        matches > 1
          ? `${selector} changed — ${matches} elements on this page match it.`
          : `${selector} changed — a CSS rule, so anything matching it later picks this up.`,
      liveRule: resolveLiveRule(selector),
      rejected: checked.rejected.length ? checked.rejected : undefined,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reach                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Why this selector goes further than the user's selection, or null when it does not.
 *
 * Written as "why not" rather than "may it" so every refusal arrives with its own sentence.
 * A user who is told "that selector was refused" learns nothing; one who is told it also
 * matches thirty elements outside the selection learns what to ask for instead.
 */
function reviewReach(selector: string, target: BrokerTarget): string | null {
  const found = safeQuery(selector);
  if (!found.length) {
    return `${selector} matches nothing on this page, so a rule for it would have no effect.`;
  }
  const chrome = found.find((node) => isOverlayNode(node));
  if (chrome) {
    return `${selector} reaches the editor's own interface, so it cannot be used.`;
  }
  const { element, parent } = target;
  if (found.some((node) => node === element)) return null;
  if (parent && found.some((node) => node === parent)) return null;

  // A rule scoped inside the element — `#intro a`, say — is a legitimate and common thing to
  // want, and it is still within what the user selected. Every match has to be inside it,
  // though: one stray match elsewhere makes this a rule about the rest of the page.
  const outside = found.filter((node) => !element.contains(node));
  if (!outside.length) return null;
  return (
    `${selector} matches ${outside.length} element${outside.length === 1 ? '' : 's'} outside ` +
    'the selection, so it is not this element\'s rule to change.'
  );
}

/**
 * The page's own rule with this selector, when there is one.
 *
 * Handed to the session so an edit lands on the rule that already exists rather than adding a
 * second one that wins by coming later. That is the difference between a one-line diff in the
 * stylesheet the user wrote and a growing pile of overrides.
 *
 * Looked up across the sheets rather than through `appliedRules(element)`, which was the first
 * attempt and was wrong: `appliedRules` lists rules matching the *element*, so a rule scoped
 * inside it — `#subject h2` — was never found, and every edit to one quietly became a new
 * registry rule instead of a patch to the author's own stylesheet.
 */
function resolveLiveRule(selector: string): CSSStyleRule | null {
  return findStyleRule(selector);
}

/** `querySelectorAll` that cannot throw, because the selector came from outside. */
function safeQuery(selector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Vet a declaration map, dropping what cannot be written and saying why.
 *
 * The same two gates every other CSS writer in the editor goes through, in the same order:
 * `checkDeclaration` for the property name, then `safeCssValue` for a `url()` pointing
 * somewhere that runs script. Refusing the whole operation when one declaration is bad would
 * throw away nine good ones over a typo, so bad ones are dropped individually and reported —
 * but an operation with nothing left is refused, because applying nothing and calling it done
 * is the failure this editor works hardest to avoid.
 */
function vetDeclarations(
  raw: unknown,
): { declarations: Record<string, string>; rejected: string[] } | { reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reason: 'That style change carried no declarations.' };
  }
  const declarations: Record<string, string> = {};
  const rejected: string[] = [];
  for (const [rawProperty, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
      rejected.push(`${rawProperty} was dropped: its value was not text.`);
      continue;
    }
    const value = String(rawValue).trim();
    const verdict = checkDeclaration({ property: rawProperty, value });
    if (verdict.refusal) {
      rejected.push(verdict.refusal);
      continue;
    }
    if (!verdict.property) continue;
    const unsafe = safeCssValue(value);
    if (unsafe) {
      rejected.push(`${verdict.property} was dropped: “${unsafe.unsafe}” is not a URL this can load.`);
      continue;
    }
    declarations[verdict.property] = value;
  }
  if (!Object.keys(declarations).length) {
    return {
      reason: rejected.length
        ? `Nothing in that style change could be written. ${rejected[0]}`
        : 'That style change carried no declarations.',
    };
  }
  return { declarations, rejected };
}

/** Class names from a list, refusing rather than silently filtering. */
function nameList(raw: unknown): { names: string[] } | { reason: string } {
  if (raw === undefined || raw === null) return { names: [] };
  if (!Array.isArray(raw)) return { reason: 'A list of class names was expected.' };
  const names: string[] = [];
  for (const entry of raw) {
    const name = normalizeClassName(String(entry ?? ''));
    if (!name) return { reason: `“${String(entry)}” is not a usable class name.` };
    if (name.startsWith('heo-')) {
      return { reason: `.${name} belongs to the editor, so it cannot be used.` };
    }
    if (!names.includes(name)) names.push(name);
  }
  return { names };
}

/** What the HTML sanitiser took out, as sentences rather than counts. */
function describeRemoved(report: SanitizeReport): string[] | undefined {
  const out: string[] = [];
  if (report.scripts) out.push(plural(report.scripts, 'script', 'removed'));
  if (report.handlers) out.push(plural(report.handlers, 'event handler', 'removed'));
  if (report.urls) out.push(plural(report.urls, 'unsafe link', 'removed'));
  if (report.styles) out.push(plural(report.styles, 'style attribute', 'removed'));
  return out.length ? out : undefined;
}

function plural(count: number, noun: string, verb: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'} ${verb}`;
}

/** `a`, `a and b`, `a, b and c` — for a sentence rather than a list. */
function listOf(items: readonly string[]): string {
  if (!items.length) return 'nothing';
  if (items.length === 1) return items[0];
  if (items.length <= 3) return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  return `${items.slice(0, 2).join(', ')} and ${items.length - 2} more`;
}
