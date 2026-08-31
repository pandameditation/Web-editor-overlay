import { RULE_STYLE_ID } from './constants.js';
import { countMatches, safeSelector } from './selectors.js';
import { declarationsToCSS, ManagedStyleSheet } from './stylesheet.js';
import type { DesignRule } from './types.js';

/**
 * The CSS rule registry.
 *
 * The third piece of vocabulary, alongside tokens and reusable classes, and the one
 * that closes an obvious gap. A token names a value. A class names a group of
 * declarations that then has to be put on an element by hand. Neither can say "every
 * `h2` on this page", "a `p` directly inside `.prose`", or "this link, on hover" —
 * those are rules, and until now the only way to write one was to open the CSS panel
 * and type CSS.
 *
 * **Keyed on the selector.** Two rules with the same selector are one rule with the
 * declarations merged, which is both what a stylesheet does and what the user means.
 * It also makes the registry idempotent under re-import, which is what a design system
 * needs to be portable.
 *
 * **Insertion order is preserved, not sorted.** Every other registry here sorts its
 * list alphabetically because a token's position has no meaning. A rule's does: two
 * rules of equal specificity are decided by which comes last, so sorting the list
 * would quietly reorder the cascade every time a rule was added. The list is therefore
 * the order the rules were written in, and it is the order they are emitted in.
 *
 * **Nothing is scanned out of the page.** The page's own rules are edited in place by
 * the cascade inspector, which patches the file they live in; ingesting them here as
 * well would give one edit two homes and turn a one-line diff into a copy of the theme.
 * So this registry only ever holds rules the editor owns — which also means everything
 * in it is safe to emit, and `toCSS` needs no origin filter.
 */
export class RuleRegistry {
  #rules = new Map<string, DesignRule>();
  #sheet = new ManagedStyleSheet(RULE_STYLE_ID);
  #listeners = new Set<() => void>();
  #matchCache: Map<string, number> | null = null;

  /** Every rule, in the order it will be written. */
  list(): DesignRule[] {
    return [...this.#rules.values()];
  }

  get(selector: string): DesignRule | undefined {
    return this.#rules.get(safeSelector(selector) || String(selector ?? '').trim());
  }

  get size(): number {
    return this.#rules.size;
  }

  has(selector: string): boolean {
    return this.get(selector) !== undefined;
  }

  /**
   * How many elements each rule currently matches.
   *
   * Cached per change rather than per call: the panel asks once per rule per render,
   * and a `querySelectorAll` for every row on every keystroke is measurable on a large
   * page. Invalidated by any registry change, which is not the whole truth — the page
   * itself can change under it — but the count is context rather than a promise, and a
   * stale one is corrected by the next edit.
   */
  matches(): Map<string, number> {
    if (this.#matchCache) return this.#matchCache;
    const counts = new Map<string, number>();
    for (const selector of this.#rules.keys()) counts.set(selector, countMatches(selector));
    this.#matchCache = counts;
    return counts;
  }

  matchCount(selector: string): number {
    return this.matches().get(safeSelector(selector)) ?? 0;
  }

  /**
   * Add or replace a rule.
   *
   * Throws on an invalid selector rather than storing it. A rule the browser will not
   * accept cannot be inserted into a stylesheet, so keeping one would put a row in the
   * list that looks real and does nothing — the exact failure this feature exists to
   * remove.
   */
  upsert(entry: DesignRule): DesignRule {
    const selector = safeSelector(entry.selector);
    if (!selector) throw new Error(`"${entry.selector}" is not a valid CSS selector.`);
    const next: DesignRule = {
      selector,
      declarations: { ...entry.declarations },
      label: entry.label,
      description: entry.description,
      origin: entry.origin ?? 'user',
    };
    this.#rules.set(selector, next);
    this.#flush();
    return next;
  }

  /**
   * Change one declaration on a rule.
   *
   * An emptied value is kept as an empty string rather than dropped, matching
   * `ClassRegistry.setDeclaration` and for the same reason: clearing a field is how you
   * retype it, and having the row vanish mid-edit — taking the property name with it —
   * costs far more than an inert entry does. `toCSS` skips empties, so nothing invalid
   * reaches the page; `removeDeclaration` is how you actually get rid of one.
   */
  setDeclaration(selector: string, property: string, value: string): DesignRule | undefined {
    const entry = this.get(selector);
    if (!entry) return undefined;
    return this.upsert({
      ...entry,
      declarations: { ...entry.declarations, [property]: value.trim() },
    });
  }

  /** Drop a declaration entirely, name and all. */
  removeDeclaration(selector: string, property: string): DesignRule | undefined {
    const entry = this.get(selector);
    if (!entry) return undefined;
    const declarations = { ...entry.declarations };
    delete declarations[property];
    return this.upsert({ ...entry, declarations });
  }

  /**
   * Change a rule's selector, keeping its declarations and its place in the order.
   *
   * Position has to survive, which rules out delete-then-insert: that would move the
   * rule to the end and change which of two equally specific rules wins. So the map is
   * rebuilt with the key swapped in place — cheap at these sizes, and the only version
   * that leaves the cascade alone.
   *
   * Returns null when the new selector is invalid or already taken by another rule.
   */
  rename(from: string, to: string): DesignRule | null {
    const previous = safeSelector(from);
    const next = safeSelector(to);
    const entry = previous ? this.#rules.get(previous) : undefined;
    if (!entry || !next) return null;
    if (next === previous) return entry;
    if (this.#rules.has(next)) return null;

    const renamed: DesignRule = { ...entry, selector: next };
    const rebuilt = new Map<string, DesignRule>();
    for (const [key, value] of this.#rules) {
      if (key === previous) rebuilt.set(next, renamed);
      else rebuilt.set(key, value);
    }
    this.#rules = rebuilt;
    this.#flush();
    return renamed;
  }

  remove(selector: string): DesignRule | undefined {
    const key = safeSelector(selector);
    const entry = key ? this.#rules.get(key) : undefined;
    if (!entry) return undefined;
    this.#rules.delete(key);
    this.#flush();
    return entry;
  }

  import(rules: readonly DesignRule[], options: { overwrite?: boolean } = {}): number {
    let count = 0;
    for (const entry of rules) {
      const selector = safeSelector(entry.selector);
      if (!selector) continue;
      if (!options.overwrite && this.#rules.has(selector)) continue;
      this.#rules.set(selector, {
        ...entry,
        selector,
        declarations: { ...entry.declarations },
        origin: entry.origin ?? 'imported',
      });
      count += 1;
    }
    this.#flush();
    return count;
  }

  export(): DesignRule[] {
    return this.list();
  }

  /**
   * The rules as CSS, in registry order.
   *
   * No origin filter, unlike the token and class registries: everything in here is a
   * rule the editor owns, because nothing else is ever put in. Rules with no
   * declarations are skipped — an empty rule is a row mid-edit, not CSS.
   */
  toCSS(): string {
    return this.list()
      .filter((entry) => Object.values(entry.declarations).some((value) => value.trim()))
      .map((entry) => `${entry.selector} {\n${declarationsToCSS(entry.declarations)}\n}`)
      .join('\n\n');
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  destroy(): void {
    this.#sheet.destroy();
    this.#listeners.clear();
    this.#rules.clear();
  }

  #flush(): void {
    this.#sheet.write(this.toCSS());
    this.#matchCache = null;
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[html-editor-overlay] rule listener failed', error);
      }
    }
  }
}

/**
 * A rule's declarations, as text, for the one-line summary in a collapsed row.
 *
 * Truncated on purpose: the row is a way to recognise a rule, not to read it. The
 * expanded editor is where the values live.
 */
export function summarizeRule(entry: DesignRule, limit = 3): string {
  const written = Object.entries(entry.declarations).filter(([, value]) => value.trim());
  if (!written.length) return 'no declarations yet';
  const shown = written.slice(0, limit).map(([property]) => property);
  const rest = written.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}
