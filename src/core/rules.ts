import { simpleClassName } from './classes.js';
import { MIRROR_ATTR, RULE_STYLE_ID } from './constants.js';
import { parseDeclarations } from './css.js';
import { countMatches, safeSelector } from './selectors.js';
import { withParsedSheet } from './sheets.js';
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
 * **The page's own rules are read in, and left alone until edited.** Exactly what the
 * token and class registries do, and the reason is the same: a panel for managing CSS
 * rules that could only show the ones created in this session would be blind to the file
 * it is meant to be managing, and a rule written last session would vanish on reload.
 * Scanned rules carry `origin: 'stylesheet'` and are excluded from `toCSS`, so nothing is
 * written back until it is changed; editing one flips it to `'user'`, after which it is
 * emitted as an override that wins by coming later.
 *
 * **The registry does not claim what another one owns.** A bare `.card` rule is a
 * reusable class and belongs to `ClassRegistry`; a `:root` block of custom properties
 * belongs to `TokenRegistry`. Both are skipped here, because a selector held in two
 * registries is a selector emitted twice.
 */
export class RuleRegistry {
  #rules = new Map<string, DesignRule>();
  #sheet = new ManagedStyleSheet(RULE_STYLE_ID);
  #listeners = new Set<() => void>();
  #matchCache: Map<string, number> | null = null;
  /**
   * Where each scanned rule was read from, as something to show a person.
   *
   * Kept beside the rules rather than on them: a `DesignRule` is exported, seeded and
   * imported, and which sheet a rule happened to live in on one page is not a fact worth
   * carrying to the next one.
   */
  #sources = new Map<string, string>();
  /** True once a scan stopped at the cap, so the panel can say the list is partial. */
  #truncated = false;

  /* ------------------------------------------------------------------------ */
  /* Reading the page                                                          */
  /* ------------------------------------------------------------------------ */

  /**
   * Collect the page's own rules.
   *
   * Idempotent, and safe to call again after an edit: a rule the user has touched is no
   * longer `'stylesheet'`, and the collector leaves those alone. That is what makes this
   * runnable on mount, on demand from the refresh button, and again whenever a connected
   * folder makes another stylesheet readable.
   */
  scanDocument(): void {
    for (const sheet of Array.from(document.styleSheets)) {
      // The editor's own output. Scanning it would re-ingest what this registry just
      // emitted, and a rule would become its own source.
      if (sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-generated')) {
        continue;
      }
      this.#collect(sheet, sheetLabel(sheet));
    }
    for (const sheet of document.adoptedStyleSheets ?? []) {
      this.#collect(sheet, 'adopted stylesheet');
    }
    this.#invalidate();
  }

  /**
   * Collect rules from CSS text rather than from a live sheet.
   *
   * The counterpart to `ClassRegistry.scanCSS`, and for the same reason: a sheet the
   * browser refuses to expose is invisible to `scanDocument`, but its text — read off
   * disk by a connected project — parses like any other CSS.
   */
  scanCSS(css: string, label = 'a project stylesheet'): void {
    withParsedSheet(css, (sheet) => this.#collect(sheet, label));
    this.#invalidate();
  }

  /**
   * Take the top-level style rules out of a sheet.
   *
   * Deliberately not recursive, which is the one place this diverges from
   * `ClassRegistry.#collect`. A rule inside `@media`, `@supports`, `@container` or
   * `@layer` applies under a condition this registry has nowhere to record — a
   * `DesignRule` is a selector and declarations — so hoisting one out would emit it
   * unconditionally and change the page. Not showing a conditional rule is a gap;
   * misrepresenting one is a bug, so the gap is the better trade.
   *
   * Tolerant of a sheet it cannot read, so one cross-origin `<link>` does not stop the
   * scan at the sheet it happens to appear before.
   */
  #collect(container: CSSStyleSheet, label: string): void {
    let list: CSSRuleList;
    try {
      list = container.cssRules;
    } catch {
      // Cross-origin. A connected project reads these off disk and `scanCSS` handles
      // them; from here there is nothing to see.
      return;
    }

    for (const rule of Array.from(list)) {
      if (this.#rules.size >= SCAN_LIMIT) {
        // Recorded rather than just stopped: a list that quietly ends at 400 looks like
        // the page only has 400 rules, and the panel should be able to say otherwise.
        this.#truncated = true;
        return;
      }
      if (!(rule instanceof CSSStyleRule)) continue;

      const selector = safeSelector(rule.selectorText);
      // A selector the browser will not take back — a vendor hack, or something a
      // preprocessor left behind. It cannot be re-emitted, so it cannot be managed.
      if (!selector) continue;
      // Owned by another registry. Checked through the class registry's own predicate so
      // the two cannot drift into both claiming it.
      if (rule.selectorText.split(',').every((part) => simpleClassName(part))) continue;

      const declarations = parseDeclarations(rule.style.cssText);
      const properties = Object.keys(declarations);
      if (!properties.length) continue;
      // A block of nothing but custom properties is the token registry's, and the Tokens
      // sections above already list every one of them.
      if (properties.every((property) => property.startsWith('--'))) continue;

      const existing = this.#rules.get(selector);
      // Once the user has touched it, it is theirs. A rescan must not put the file's
      // values back over an edit that has not been saved yet.
      if (existing && existing.origin !== 'stylesheet') continue;

      this.#rules.set(selector, {
        selector,
        // Merged, because one selector can be written more than once in a sheet and the
        // later declarations win — which is what the map already models.
        declarations: { ...existing?.declarations, ...declarations },
        origin: 'stylesheet',
      });
      this.#sources.set(selector, this.#sources.get(selector) ?? label);
    }
  }

  /** Which stylesheet a scanned rule came from, for the panel to show. */
  sourceOf(selector: string): string | undefined {
    return this.#sources.get(safeSelector(selector));
  }

  /**
   * True when a scan hit the cap, so the page has more rules than the list shows.
   *
   * Worth saying out loud. Everything else in this panel is exhaustive, so a silently
   * partial list is the one thing here that could mislead someone into thinking a rule
   * does not exist.
   */
  get truncated(): boolean {
    return this.#truncated;
  }

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
      // A rule read out of the page becomes this session's the moment it is edited, and
      // that word is what makes the edit real: `toCSS` leaves `'stylesheet'` rules out, so
      // without the flip the map would hold the new value, the row would show the new
      // value, and the page would go on rendering the old one.
      origin: 'user',
    });
  }

  /** Drop a declaration entirely, name and all. */
  removeDeclaration(selector: string, property: string): DesignRule | undefined {
    const entry = this.get(selector);
    if (!entry) return undefined;
    const declarations = { ...entry.declarations };
    delete declarations[property];
    /*
     * Also an edit, so also `'user'` — with one caveat worth stating.
     *
     * For a rule this registry authored, removing a declaration removes it. For one read
     * out of a file, the emitted override simply stops mentioning the property, and the
     * file's own declaration then shows through again. Which is the honest outcome of an
     * override: this registry adds CSS, it does not reach into someone else's rule and
     * delete a line from it.
     */
    return this.upsert({ ...entry, declarations, origin: 'user' });
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

    /*
     * A rule read out of the page cannot be retargeted, and refusing is the honest answer.
     *
     * This registry emits CSS; it does not edit someone else's rule. Pointing a scanned
     * rule at a new selector would emit the new one and leave the original applying from
     * the file — two rules where the user asked for one moved. Changing the selector of a
     * rule in a file is the cascade inspector's job, because that patches the file.
     */
    if (entry.origin === 'stylesheet') return null;

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

  /**
   * Everything the registry holds, page rules included.
   *
   * The same as `ClassRegistry.export`, and for the same reason: a design system document
   * — and the seed built from it — has to stand on its own, because the page receiving it
   * does not have the stylesheet these were read from. `compactDesignSystem` drops
   * `origin` on the way out, so what arrives is vocabulary the receiving page owns and
   * emits.
   *
   * Which is not the same question as what a *save* writes. That is `toCSS`, and it leaves
   * scanned rules out — the file they came from already says it.
   */
  export(): DesignRule[] {
    return this.list();
  }

  /**
   * The rules the editor owns, as CSS, in registry order.
   *
   * Rules read out of the page's own stylesheets are left out unless they have been
   * edited, which is the same filter the token and class registries apply and the reason
   * scanning is safe at all: emitting them would write the page's stylesheet back into
   * itself and turn a one-line diff into a copy of the theme.
   *
   * Rules with no declarations are skipped too — an empty rule is a row mid-edit, not CSS.
   */
  toCSS(includeAll = false): string {
    return this.#css(this.#owned(includeAll));
  }

  /** The same CSS, narrowed to named selectors, for writing out only what is used. */
  cssFor(selectors: ReadonlySet<string>, includeAll = false): string {
    return this.#css(this.#owned(includeAll).filter((entry) => selectors.has(entry.selector)));
  }

  #owned(includeAll: boolean): DesignRule[] {
    return this.list().filter((entry) => includeAll || entry.origin !== 'stylesheet');
  }

  #css(entries: readonly DesignRule[]): string {
    return entries
      .filter((entry) => Object.values(entry.declarations).some((value) => value.trim()))
      .map((entry) => `${entry.selector} {\n${declarationsToCSS(entry.declarations)}\n}`)
      .join('\n\n');
  }

  /** The rules this session authored or changed, which is what a save carries. */
  authored(): DesignRule[] {
    return this.list().filter((entry) => entry.origin !== 'stylesheet');
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
    this.#invalidate();
  }

  /**
   * Announce a change without rewriting the sheet.
   *
   * What a scan needs: it only ever adds `'stylesheet'` rules, which `toCSS` leaves out,
   * so there is nothing new to render — but the panel has more to list and the match
   * counts are stale.
   */
  #invalidate(): void {
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
 * A ceiling on how many rules are read out of the page.
 *
 * Not a performance limit — the scan itself is fast. It is a limit on the panel: a page
 * linking a utility framework has thousands of rules, and a list of thousands is not a
 * thing anyone manages. Same-origin frameworks are the case this catches; a CDN's sheet
 * throws on `cssRules` and never reaches here at all.
 */
const SCAN_LIMIT = 400;

/** A short name for where a rule came from: the file, or the page itself. */
function sheetLabel(sheet: CSSStyleSheet): string {
  if (sheet.href) return fileName(sheet.href);
  const owner = sheet.ownerNode;
  if (owner instanceof Element) {
    // A stand-in the editor installed for a `<link>` it could not read. Naming the
    // stand-in would be meaningless; the marker carries the file it stands for.
    const mirrored = owner.getAttribute(MIRROR_ATTR);
    if (mirrored) return fileName(mirrored);
  }
  return 'this page';
}

/** The last path segment of a URL, or the URL when it has none. */
function fileName(href: string): string {
  try {
    return new URL(href, location.href).pathname.split('/').pop() || href;
  } catch {
    return href;
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
