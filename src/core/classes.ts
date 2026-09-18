import { CLASS_STYLE_ID } from './constants.js';
import {
  fromRecord,
  toRecord,
  withPromotedSide,
  withValue,
  type Declaration,
} from './declaration-list.js';
import { queryDeep } from './dom.js';
import { ruleDeclarations, withParsedSheet } from './sheets.js';
import { declarationsToCSS, ManagedStyleSheet } from './stylesheet.js';
import type { DesignClass } from './types.js';

/**
 * The reusable-class registry.
 *
 * A class here is just a named group of declarations. Two things feed it: simple
 * `.class` rules already in the page's stylesheets, and groups the user promotes
 * out of a component ("these five token-based declarations are really a `.card`").
 * That promotion is the main reason this exists — it turns ad-hoc inline styling
 * back into something reusable and consistent.
 */
export class ClassRegistry {
  #classes = new Map<string, DesignClass>();
  #sheet = new ManagedStyleSheet(CLASS_STYLE_ID);
  #listeners = new Set<() => void>();
  #usageCache: Map<string, number> | null = null;
  /** Which live rule each scanned declaration was read from, keyed `name|property`. */
  #origins = new Map<string, CSSStyleRule>();
  /** The unconditional rule each scanned class was last declared in. See `originRule`. */
  #homes = new Map<string, CSSStyleRule>();

  /**
   * Collect single-class rules from the page.
   *
   * Compound and descendant selectors are skipped: `.card .title` is not a
   * reusable class you can drop onto an element, so offering it would mislead.
   */
  scanDocument(): void {
    // Rebuilt from what the page says now, so a rule in a sheet that has since been removed
    // cannot go on being offered as somewhere to write.
    this.#origins.clear();
    this.#homes.clear();
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-generated')) {
        continue;
      }
      this.#collect(sheet, true);
    }
    for (const sheet of document.adoptedStyleSheets ?? []) this.#collect(sheet, true);
    this.#invalidate();
  }

  /**
   * Collect classes from CSS text rather than from a live sheet.
   *
   * The counterpart to `TokenRegistry.scanCSS`, and for the same reason: a sheet the
   * browser refuses to expose is invisible to `scanDocument`, but its text — read off
   * disk by a connected project — parses like any other CSS.
   */
  scanCSS(css: string): void {
    /*
     * Not `live`: these rules belong to a throwaway sheet.
     *
     * Recording one as somewhere to write an edit would name a rule that no longer exists by the
     * time anyone used it, and mutating it would change nothing a reader could see.
     */
    withParsedSheet(css, (sheet) => this.#collect(sheet, false));
    this.#invalidate();
  }

  /**
   * Walk a sheet or at-rule, taking every bare single-class rule.
   *
   * Recursive so a class declared inside `@media` counts, and tolerant of a
   * container it cannot read so one cross-origin sheet does not stop the scan.
   *
   * `live` says the rules being walked are the page's own, and therefore that they can be
   * edited later. See `originRule`.
   */
  #collect(container: CSSStyleSheet | CSSGroupingRule, live: boolean): void {
    let list: CSSRuleList;
    try {
      list = container.cssRules;
    } catch {
      return;
    }
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        for (const selector of rule.selectorText.split(',')) {
          const name = simpleClassName(selector);
          if (!name) continue;
          const declarations = readDeclarations(rule);
          if (!Object.keys(declarations).length) continue;
          if (live) this.#noteOrigin(name, rule, declarations);
          const existing = this.#classes.get(name);
          if (existing && existing.origin !== 'stylesheet') continue;
          this.#classes.set(name, {
            name,
            declarations: { ...existing?.declarations, ...declarations },
            label: prettifyClassName(name),
            origin: 'stylesheet',
          });
        }
        continue;
      }
      if (
        rule instanceof CSSMediaRule ||
        rule instanceof CSSSupportsRule ||
        (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule)
      ) {
        this.#collect(rule, live);
      }
    }
  }

  /**
   * Remember where each of a scanned class's declarations was written.
   *
   * Deliberately recorded *before* the caller's `origin` check, not after. `scanDocument` clears
   * these maps and rebuilds them, and a rescan skips a class the user has already touched — so
   * recording afterwards would drop the very location the next edit to that class needs, and only
   * the second edit of a session would append a duplicate. That is a far worse bug than the one
   * being fixed, because it looks intermittent.
   *
   * The last declaration wins, which is also what the browser decided. A class declared twice — a
   * base rule and a media-query override — is walked twice, and the value kept is the later one,
   * so the rule remembered has to be that same one or an edit would patch the declaration that is
   * not in effect.
   */
  #noteOrigin(name: string, rule: CSSStyleRule, declarations: Record<string, string>): void {
    for (const property of Object.keys(declarations)) {
      this.#origins.set(`${name}|${property}`, rule);
    }
    /*
     * Where a property the class does *not* declare yet should go, which is a different question.
     *
     * Only an unconditional rule can answer it. Adding a declaration to the `@media` block that
     * happens to mention this class would apply it at one viewport width and nowhere else, which
     * is not what adding a declaration to a class means. A class that only ever appears inside a
     * condition has no answer here, and falls through to the managed block — which writes an
     * unconditional rule, and is honest about being a new one.
     */
    if (!rule.parentRule) this.#homes.set(name, rule);
  }

  /**
   * The live rule an edit to this declaration belongs in, when the page already declares it.
   *
   * What makes editing a class the project already has a one-line diff. Without it the only way
   * to change `.card`'s padding was to declare `.card` again in the editor's managed block, which
   * lands at the bottom of whichever file the design system points at — so the file ended up
   * declaring `.card` twice, the original left behind holding the old value, and a reader had to
   * know cascade order to work out which one was in effect.
   *
   * The declaration's own rule first, then the class's unconditional rule for a property being
   * added rather than changed. Null for a class the editor invented, which has no declaration
   * anywhere yet and genuinely does belong in the managed block.
   *
   * Also null once the editor owns the class, because then its declarations are the managed
   * block's to emit and patching a file rule from them would write the same CSS in two places.
   */
  originRule(name: string, property: string): CSSStyleRule | null {
    const key = name.replace(/^\./, '');
    if (this.#classes.get(key)?.origin !== 'stylesheet') return null;
    return this.#origins.get(`${key}|${property}`) ?? this.#homes.get(key) ?? null;
  }

  /**
   * Record what the page now says about a declaration this registry does not own.
   *
   * The other half of routing an edit through `originRule`: the value was changed in the rule that
   * declares it, and a CSSOM mutation is invisible from here, so the copy held in this map is stale
   * and the editor would go on showing the old value.
   *
   * Handed the rule's whole declaration list rather than one property, because order is part of what
   * changed. When a block holds both a shorthand and one of its longhands, the edit moves the
   * touched side last so it wins — and a copy that took only the new value kept the old order, so
   * the panel showed the other side as the winner while the page rendered this one. One list, copied
   * across, cannot disagree with itself.
   *
   * `setDeclaration` cannot do this job. It flips `origin` to `'user'`, which is precisely what makes
   * `toCSS` emit the class — and emitting something that was just patched in place is the duplicate
   * this path exists to avoid.
   */
  noteStylesheetDeclarations(name: string, declarations: readonly Declaration[]): void {
    const key = name.replace(/^\./, '');
    const entry = this.#classes.get(key);
    if (!entry || entry.origin !== 'stylesheet') return;
    this.#classes.set(key, { ...entry, declarations: toRecord(declarations) });
    // `#invalidate` rather than `#flush`: the managed sheet is built from `toCSS`, which leaves
    // scanned classes out, so rewriting it would emit the same bytes it already holds.
    this.#invalidate();
  }

  list(): DesignClass[] {
    return [...this.#classes.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): DesignClass | undefined {
    return this.#classes.get(name.replace(/^\./, ''));
  }

  get size(): number {
    return this.#classes.size;
  }

  /** Classes actually applied to elements, most used first. */
  usedInProject(limit = 40): DesignClass[] {
    const usage = this.usage();
    return this.list()
      .filter((entry) => (usage.get(entry.name) ?? 0) > 0)
      .sort((a, b) => (usage.get(b.name) ?? 0) - (usage.get(a.name) ?? 0))
      .slice(0, limit);
  }

  usage(): Map<string, number> {
    if (this.#usageCache) return this.#usageCache;
    const counts = new Map<string, number>();
    for (const el of queryDeep('[class]')) {
      for (const name of Array.from(el.classList)) {
        if (name.startsWith('heo-')) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    this.#usageCache = counts;
    return counts;
  }

  /** Class names matching a prefix, for the class input's autocomplete. */
  search(query: string, limit = 12): DesignClass[] {
    const needle = query.trim().toLowerCase().replace(/^\./, '');
    const usage = this.usage();
    const scored = this.list()
      .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(needle) ? 1 : 0;
        const bStarts = b.name.toLowerCase().startsWith(needle) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        return (usage.get(b.name) ?? 0) - (usage.get(a.name) ?? 0);
      });
    return scored.slice(0, limit);
  }

  /**
   * A name derived from `base` that no class holds yet.
   *
   * Forking `.card` for one element has to produce a second class, not silently
   * rewrite the first — which is exactly what a bare name would do.
   */
  uniqueName(base: string): string {
    const root = normalizeClassName(base) || 'style';
    if (!this.#classes.has(root)) return root;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${root}-${n}`;
      if (!this.#classes.has(candidate)) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  upsert(entry: DesignClass): DesignClass {
    const name = normalizeClassName(entry.name);
    if (!name) throw new Error('A class needs a valid name.');
    const next: DesignClass = {
      name,
      declarations: { ...entry.declarations },
      label: entry.label ?? prettifyClassName(name),
      description: entry.description,
      origin: entry.origin ?? 'user',
    };
    this.#classes.set(name, next);
    this.#flush();
    return next;
  }

  /**
   * Change one declaration on a class.
   *
   * An emptied value is kept as an empty string rather than dropped. Clearing a
   * field is how you retype it, and having the row vanish mid-edit — taking the
   * property name with it — costs far more than an inert entry does. `toCSS` skips
   * empties, so nothing invalid reaches the page; `removeDeclaration` is the way to
   * actually get rid of one.
   */
  setDeclaration(name: string, property: string, value: string): DesignClass | undefined {
    const entry = this.#classes.get(name.replace(/^\./, ''));
    if (!entry) return undefined;
    const next = value.trim();
    /*
     * The edit itself goes through the shared model, so a class, an inline style and a stylesheet
     * rule cannot disagree about what setting a declaration means — including the promotion: when a
     * block holds both a shorthand and one of its longhands, CSS decides between them by position,
     * so the side just touched is moved last and wins.
     *
     * An emptied value is the one thing kept local, and it is a UI affordance rather than a storage
     * rule: clearing a field is how you retype it, and having the row vanish mid-edit — taking the
     * property name with it — costs more than an inert entry does. `toCSS` skips empties, so nothing
     * invalid reaches the page, and `removeDeclaration` is how you actually get rid of one.
     */
    const declarations = next
      ? toRecord(
        withPromotedSide(withValue(fromRecord(entry.declarations), property, next), property),
      )
      : { ...entry.declarations, [property]: '' };

    return this.upsert({
      ...entry,
      declarations,
      /*
       * A cleared value does not claim the class.
       *
       * `toCSS` skips empties, so an emptied declaration emits nothing and there is no override to
       * own yet. Flipping `origin` on the way through would hand the editor a class it has nothing
       * to say about — and for a class read out of a stylesheet that is expensive: the save would
       * emit the whole thing again into the managed block, so the file would gain a second `.card`
       * because someone pressed backspace.
       */
      origin: next ? 'user' : entry.origin,
    });
  }

  /** Drop a declaration entirely, name and all. */
  removeDeclaration(name: string, property: string): DesignClass | undefined {
    const entry = this.#classes.get(name.replace(/^\./, ''));
    if (!entry) return undefined;
    // Through the shared model like every other edit, so "remove a declaration" cannot come to mean
    // two different things in two registries.
    const declarations = toRecord(withValue(fromRecord(entry.declarations), property, ''));
    return this.upsert({ ...entry, declarations, origin: 'user' });
  }

  remove(name: string): DesignClass | undefined {
    const key = name.replace(/^\./, '');
    const entry = this.#classes.get(key);
    if (!entry) return undefined;
    this.#classes.delete(key);
    this.#flush();
    return entry;
  }

  import(classes: DesignClass[], options: { overwrite?: boolean } = {}): number {
    let count = 0;
    for (const entry of classes) {
      const name = normalizeClassName(entry.name);
      if (!name) continue;
      if (!options.overwrite && this.#classes.has(name)) continue;
      this.#classes.set(name, {
        ...entry,
        name,
        label: entry.label ?? prettifyClassName(name),
        origin: entry.origin ?? 'imported',
      });
      count += 1;
    }
    this.#flush();
    return count;
  }

  export(): DesignClass[] {
    return this.list();
  }

  /** CSS for classes the overlay owns. Page-authored classes are left alone. */
  toCSS(includeAll = false): string {
    return this.#css(this.#owned(includeAll));
  }

  /** The same CSS, narrowed to named classes, for writing out only what is used. */
  cssFor(names: ReadonlySet<string>, includeAll = false): string {
    return this.#css(this.#owned(includeAll).filter((entry) => names.has(entry.name)));
  }

  #owned(includeAll: boolean): DesignClass[] {
    return this.list().filter((entry) => includeAll || entry.origin !== 'stylesheet');
  }

  #css(entries: readonly DesignClass[]): string {
    return entries
      .filter((entry) => Object.keys(entry.declarations).length > 0)
      .map((entry) => `.${entry.name} {\n${declarationsToCSS(entry.declarations)}\n}`)
      .join('\n\n');
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  destroy(): void {
    this.#sheet.destroy();
    this.#listeners.clear();
    this.#classes.clear();
    // These hold live `CSSStyleRule` objects, and through them their sheets. Dropping them is
    // what stops an unmounted editor keeping the page's stylesheets alive.
    this.#origins.clear();
    this.#homes.clear();
  }

  #flush(): void {
    this.#sheet.write(this.toCSS());
    this.#invalidate();
  }

  #invalidate(): void {
    this.#usageCache = null;
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[html-editor-overlay] class listener failed', error);
      }
    }
  }
}

/**
 * `.card` from a selector, or null when the selector is not a bare class.
 *
 * Exported because it is also the line between this registry and the rule registry: a
 * selector this recognises is a reusable class and belongs here, and everything else is a
 * rule. Shared rather than restated so the two cannot both claim the same selector and
 * emit it twice.
 */
export function simpleClassName(selector: string): string | null {
  const text = selector.trim();
  const match = /^\.([A-Za-z_][\w-]*)$/.exec(text);
  if (!match) return null;
  if (match[1].startsWith('heo-')) return null;
  return match[1];
}

/**
 * A rule's declarations, as they were written.
 *
 * From the stylesheet's own text, not from the live rule. `rule.style.cssText` is the CSSOM's
 * re-serialization, and a `CSSStyleDeclaration` is a flat list of longhands that rebuilds shorthands
 * on the way out — so a class declaring `padding: 12px` and then `padding-left: 0` came back as one
 * merged `padding`, and an authored `#222` came back `rgb(34, 34, 34)`. Scanning that way meant the
 * editor could not see, and so could not show or export, declarations plainly in the file.
 *
 * The same read a stylesheet rule uses, because a class *is* a rule whose selector is one class
 * name. Falls back to the live rule when the sheet has no text to read.
 */
function readDeclarations(rule: CSSStyleRule): Record<string, string> {
  return toRecord(ruleDeclarations(rule));
}

export function normalizeClassName(name: string): string {
  const text = String(name ?? '')
    .trim()
    .replace(/^\./, '')
    .replace(/\s+/g, '-');
  return /^[A-Za-z_][\w-]*$/.test(text) ? text : '';
}

export function prettifyClassName(name: string): string {
  const text = name.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** How an extraction resolves a name that is already taken. */
export type ClassCollision = 'merge' | 'replace';

/**
 * What writing a set of declarations into an existing class would do.
 *
 * Extraction used to be create-only: naming it after a class that already existed
 * replaced that class outright, taking every declaration it held with it and
 * changing every element wearing it, with nothing said beforehand. Since reaching
 * for an existing name is usually a request to *add* to it, the outcome now has to
 * be describable before it happens — which is what this is. Split out as a pure
 * function so the review UI and the command that applies it cannot disagree about
 * what is about to change.
 */
export interface ClassMergePlan {
  /** The class being written into, or null when this name is new. */
  existing: DesignClass | null;
  /** Properties the class does not set yet. */
  added: string[];
  /** Properties whose value changes, with what it changes from. */
  replaced: Array<{ property: string; from: string; to: string }>;
  /** Properties the class already sets to exactly this value. */
  unchanged: string[];
  /** The class's own declarations this leaves alone. Empty when replacing. */
  kept: string[];
  /** What the class ends up holding. */
  result: Record<string, string>;
  /** True when the class would come out exactly as it went in. */
  noop: boolean;
}

export function planClassMerge(
  existing: DesignClass | null | undefined,
  declarations: Record<string, string>,
  mode: ClassCollision = 'merge',
): ClassMergePlan {
  const previous = existing?.declarations ?? {};
  const added: string[] = [];
  const replaced: ClassMergePlan['replaced'] = [];
  const unchanged: string[] = [];

  for (const [property, value] of Object.entries(declarations)) {
    const from = previous[property];
    if (from === undefined) added.push(property);
    else if (from.trim() === value.trim()) unchanged.push(property);
    else replaced.push({ property, from, to: value });
  }

  const kept =
    mode === 'replace'
      ? []
      : Object.keys(previous).filter((property) => declarations[property] === undefined);

  // Merging spreads the incoming declarations last, which is what makes "add these,
  // and let them win where they clash" true. Replacing drops everything else.
  const result = mode === 'replace' ? { ...declarations } : { ...previous, ...declarations };

  const noop =
    Boolean(existing) &&
    Object.keys(result).length === Object.keys(previous).length &&
    Object.entries(result).every(([property, value]) => previous[property]?.trim() === value.trim());

  return { existing: existing ?? null, added, replaced, unchanged, kept, result, noop };
}

/**
 * Suggest a class name for a group of declarations.
 *
 * Names after the dominant concern so the suggestion reads like something a
 * developer would have written: mostly-layout declarations become `layout-*`,
 * mostly-colour become `surface-*`, and so on.
 */
export function suggestClassName(declarations: Record<string, string>, seed = 'style'): string {
  const properties = Object.keys(declarations);
  const has = (pattern: RegExp): number => properties.filter((p) => pattern.test(p)).length;
  const scores: Array<[string, number]> = [
    ['layout', has(/^(?:display|flex|grid|gap|justify|align|place)/)],
    ['spacing', has(/^(?:margin|padding)/)],
    ['surface', has(/^(?:background|box-shadow|border|backdrop)/)],
    ['text', has(/^(?:color|font|line-height|letter|text)/)],
    ['size', has(/^(?:width|height|min-|max-|aspect)/)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const prefix = scores[0][1] > 0 ? scores[0][0] : seed;
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
}
