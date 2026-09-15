/**
 * Undoable upserts into the class and rule registries.
 *
 * Extracted from `EditorEngine.applyCssPaste`, which built these inline and committed them in
 * the same breath. That was fine while pasting was the only way in. It stopped being fine when
 * the AI agent needed the same two upserts as *parts* of a larger undo step: a run that edits a
 * class and a rule and the element's text has to be one entry on the stack, which means the
 * pieces have to be commands somebody else commits.
 *
 * So these build and return; the caller decides whether to commit one or fold several into one.
 * Both paths therefore produce identical records, identical merge behaviour and identical undo —
 * which is the point. The alternative was a second implementation of "add these declarations to
 * a class", and the two would have disagreed about `origin`, about what undo restores, or about
 * the shape of the change record, and only one of them would have been the one the save path
 * knew how to write.
 */

import { normalizeClassName } from './classes.js';
import { nextChangeId, type Command } from './history.js';
import { safeSelector } from './selectors.js';
import type { ChangeRecord, DesignClass, DesignRule } from './types.js';

/** The registries these commands write into, passed rather than imported to keep this pure. */
export interface CssRegistries {
  classes: {
    get(name: string): DesignClass | undefined;
    upsert(entry: DesignClass): DesignClass;
    remove(name: string): DesignClass | undefined;
  };
  rules: {
    get(selector: string): DesignRule | undefined;
    upsert(entry: DesignRule): DesignRule;
    remove(selector: string): DesignRule | undefined;
  };
}

export interface UpsertOptions {
  /**
   * What the change list calls this, per declaration: `Paste` or `Set`.
   *
   * The verb is the caller's because it is the one part of the record that is about *how* the
   * change was made rather than what it did, and "Paste padding into .card" beside a change
   * nobody pasted is the kind of small lie that makes a change list untrustworthy.
   */
  verb?: string;
  /** Tags the record's origin, e.g. `css-paste` or `ai`. Read by the save plan and the prompt. */
  source?: string;
}

/**
 * Add declarations to a reusable class, optionally putting it on an element.
 *
 * Merged over whatever the class already declares rather than replacing it: naming an existing
 * class is nearly always "these belong on `.card` too". `ClassRegistry.upsert` replaces the
 * declaration map wholesale, so the merge has to happen here.
 *
 * One record per declaration, not one per call. The save path writes a file per record anchor
 * and the change list is read declaration by declaration, so a paste of six properties that
 * arrived as one entry could neither be reviewed nor unticked property by property.
 */
export function upsertClassCommand(
  registries: CssRegistries,
  name: string,
  declarations: Record<string, string>,
  element: HTMLElement | null,
  applyToElement: boolean,
  options: UpsertOptions = {},
): Command | null {
  const key = normalizeClassName(name);
  const entries = Object.entries(declarations);
  if (!key || !entries.length) return null;

  const verb = options.verb ?? 'Paste';
  const existing = registries.classes.get(key);
  const previous = existing ? { ...existing, declarations: { ...existing.declarations } } : null;
  const next: DesignClass = {
    ...(existing ?? { name: key, origin: 'user' as const }),
    name: key,
    declarations: { ...(existing?.declarations ?? {}), ...declarations },
    origin: 'user',
  };
  /*
   * The whole attribute, captured before anything is applied.
   *
   * Undo restores the attribute rather than removing the one class, because the command may
   * have added it and may not — and `classList.remove` on a class the element already had
   * would take away something the user put there.
   */
  const beforeClassAttribute = element?.getAttribute('class') ?? null;

  const records: ChangeRecord[] = entries.map(([property, value]) => ({
    id: nextChangeId(),
    kind: 'token-class',
    summary: `${verb} ${property} into .${key}`,
    target: `.${key}`,
    before: existing?.declarations[property],
    after: value,
    detail: { class: key, property, value, ...(options.source ? { source: options.source } : {}) },
    at: Date.now(),
  }));

  return {
    label: `${verb} CSS into .${key}`,
    record: records[0],
    extraRecords: records.slice(1),
    apply: () => {
      registries.classes.upsert(next);
      if (applyToElement && element) element.classList.add(key);
    },
    revert: () => {
      if (previous) registries.classes.upsert(previous);
      else registries.classes.remove(key);
      if (element) {
        if (beforeClassAttribute === null) element.removeAttribute('class');
        else element.setAttribute('class', beforeClassAttribute);
      }
    },
  };
}

/**
 * Add declarations to a rule the editor owns, keyed by selector.
 *
 * For a rule that lives in one of the page's own stylesheets there is a better route —
 * editing the live `CSSStyleRule` so the change lands on the rule the author wrote instead of
 * appending an override that wins by coming later. That route is `upsertLiveRuleCommand`.
 */
export function upsertRuleCommand(
  registries: CssRegistries,
  rawSelector: string,
  declarations: Record<string, string>,
  options: UpsertOptions = {},
): Command | null {
  const selector = safeSelector(rawSelector);
  const entries = Object.entries(declarations);
  if (!selector || !entries.length) return null;

  const verb = options.verb ?? 'Paste';
  const existing = registries.rules.get(selector);
  const previous = existing ? { ...existing, declarations: { ...existing.declarations } } : null;
  const next: DesignRule = {
    ...(existing ?? { selector, origin: 'user' as const }),
    selector,
    declarations: { ...(existing?.declarations ?? {}), ...declarations },
    origin: 'user',
  };

  const records: ChangeRecord[] = entries.map(([property, value]) => ({
    id: nextChangeId(),
    kind: 'token-rule',
    summary: `${verb} ${property} into ${selector}`,
    target: selector,
    before: existing?.declarations[property],
    after: value,
    detail: { selector, property, value, ...(options.source ? { source: options.source } : {}) },
    at: Date.now(),
  }));

  return {
    label: `${verb} CSS into ${selector}`,
    record: records[0],
    extraRecords: records.slice(1),
    apply: () => {
      registries.rules.upsert(next);
    },
    revert: () => {
      if (previous) registries.rules.upsert(previous);
      else registries.rules.remove(selector);
    },
  };
}
