import { CLASS_STYLE_ID } from './constants.js';
import { parseDeclarations } from './css.js';
import { queryDeep } from './dom.js';
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

  /**
   * Collect single-class rules from the page.
   *
   * Compound and descendant selectors are skipped: `.card .title` is not a
   * reusable class you can drop onto an element, so offering it would mislead.
   */
  scanDocument(): void {
    const visit = (container: CSSStyleSheet | CSSGroupingRule): void => {
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
            const declarations = readDeclarations(rule.style);
            if (!Object.keys(declarations).length) continue;
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
          visit(rule);
        }
      }
    };

    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-generated')) {
        continue;
      }
      visit(sheet);
    }
    for (const sheet of document.adoptedStyleSheets ?? []) visit(sheet);
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
    const declarations = { ...entry.declarations, [property]: value.trim() };
    return this.upsert({ ...entry, declarations, origin: 'user' });
  }

  /** Drop a declaration entirely, name and all. */
  removeDeclaration(name: string, property: string): DesignClass | undefined {
    const entry = this.#classes.get(name.replace(/^\./, ''));
    if (!entry) return undefined;
    const declarations = { ...entry.declarations };
    delete declarations[property];
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
    const owned = this.list().filter((entry) => includeAll || entry.origin !== 'stylesheet');
    return owned
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

/** `.card` from a selector, or null when the selector is not a bare class. */
function simpleClassName(selector: string): string | null {
  const text = selector.trim();
  const match = /^\.([A-Za-z_][\w-]*)$/.exec(text);
  if (!match) return null;
  if (match[1].startsWith('heo-')) return null;
  return match[1];
}

/**
 * A rule's declarations, as they were written.
 *
 * Parsed from `cssText` rather than read by index, because indexing expands every
 * shorthand: a `.card` with four declarations came back as nineteen longhands,
 * which is what the class editor then had to show and what an export would have
 * emitted. The authored form is both shorter and what the developer will recognise.
 */
function readDeclarations(style: CSSStyleDeclaration): Record<string, string> {
  return parseDeclarations(style.cssText);
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
