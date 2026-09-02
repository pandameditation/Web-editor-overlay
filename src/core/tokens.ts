import { TOKEN_STYLE_ID } from './constants.js';
import { appliedRules, isColorValue, tokensInValue } from './css.js';
import { queryDeep } from './dom.js';
import { withParsedSheet } from './sheets.js';
import { ManagedStyleSheet } from './stylesheet.js';
import type { DesignToken, TokenGroup } from './types.js';

/**
 * The design token registry.
 *
 * Tokens come from three places and are treated identically once here: custom
 * properties already declared in the page's stylesheets, tokens the user creates
 * in the tokens panel, and tokens imported from a design system file. Writes go
 * to one managed stylesheet so a token edit takes effect immediately and the
 * exact CSS can be handed to the save prompt.
 */

export const TOKEN_GROUPS: TokenGroup[] = [
  'color',
  'space',
  'size',
  'radius',
  'shadow',
  'font',
  'border',
  'motion',
  'other',
];

export const TOKEN_GROUP_LABELS: Record<TokenGroup, string> = {
  color: 'Colour',
  space: 'Spacing',
  size: 'Size',
  radius: 'Radius',
  shadow: 'Shadow',
  font: 'Typography',
  border: 'Border',
  motion: 'Motion',
  other: 'Other',
};

/**
 * Guess a token's group.
 *
 * The value is consulted before the name, because names are ambiguous in ways
 * values are not: `--text-lg: 20px` is a font size, while `--text-muted: #667`
 * is a colour, and only the value distinguishes them. The name then decides
 * between the groups a given value shape could belong to — `24px` could be
 * spacing, a size or a radius.
 */
export function inferGroup(name: string, value: string): TokenGroup {
  const n = name.toLowerCase();
  const v = value.trim();

  const looksShadow = /\d+\s*px[^;]*\b(?:rgb|rgba|hsl|hsla|oklch|oklab|#[0-9a-f]{3,8})/i.test(v);
  const looksColor = /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(|color-mix\()/i.test(v);
  const looksTime = /^-?[\d.]+(?:ms|s)$/i.test(v);
  const looksSingleLength = /^-?[\d.]+(?:px|rem|em|%|vw|vh|svh|dvh|ch|pt|fr)?$/i.test(v);

  if (looksShadow) return 'shadow';
  if (looksColor) return 'color';
  if (looksTime) return 'motion';

  // Unambiguous name signals, whatever the value looks like.
  if (/(?:radius|rounded|corner)/.test(n)) return 'radius';
  if (/(?:shadow|elevation)/.test(n)) return 'shadow';
  if (/(?:duration|delay|ease|easing|transition|motion|spring)/.test(n)) return 'motion';
  if (/(?:space|spacing|gap|gutter|inset|pad|margin)/.test(n)) return 'space';
  if (/(?:font|family|leading|tracking|typeface|text|type)/.test(n)) return 'font';
  if (/(?:border|stroke|outline)/.test(n)) return 'border';
  if (/(?:size|width|height|scale|step|measure)/.test(n)) return 'size';

  // A named colour such as `rebeccapurple`, or a keyword the browser accepts.
  if (
    /(?:^|-)(?:color|colour|bg|background|fg|foreground|ink|surface|accent|brand|fill|tint|shade)(?:-|$)/.test(n)
  ) {
    return 'color';
  }

  if (!looksSingleLength && isColorValue(v)) return 'color';
  if (looksSingleLength) return 'size';
  return 'other';
}

/** `brand-blue-500` becomes `Brand blue 500`. */
export function prettifyTokenName(name: string): string {
  const text = name.replace(/^--/, '').replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export class TokenRegistry {
  #tokens = new Map<string, DesignToken>();
  #sheet = new ManagedStyleSheet(TOKEN_STYLE_ID);
  #listeners = new Set<() => void>();
  #usageCache: Map<string, number> | null = null;

  /* ---------------------------------------------------------------------- */
  /* Reading                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Read custom properties out of the page's stylesheets.
   *
   * Only root-ish selectors are scanned (`:root`, `html`, `:host`, `*`): those
   * are the global token declarations. Component-scoped custom properties are
   * intentionally left alone, since redefining them globally would change more
   * than the user asked for.
   */
  scanDocument(): void {
    const found: DesignToken[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      // Skip our own generated sheets so scanning is idempotent.
      if (sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-generated')) {
        continue;
      }
      collectTokens(sheet, found);
    }
    for (const sheet of document.adoptedStyleSheets ?? []) collectTokens(sheet, found);
    this.#adopt(found);
  }

  /**
   * Read tokens out of CSS text rather than out of a live sheet.
   *
   * For a stylesheet the browser will not expose — a local file over `file://`, most
   * often — `scanDocument` walks straight past it: `cssRules` throws and there is
   * nothing to look at. Its text, once a connected project has read it off disk, is
   * ordinary same-origin CSS, and this is how the tokens in it get in.
   */
  scanCSS(css: string): void {
    const found: DesignToken[] = [];
    withParsedSheet(css, (sheet) => collectTokens(sheet, found));
    this.#adopt(found);
  }

  #adopt(found: DesignToken[]): void {
    for (const token of found) {
      // Never let a scan clobber a token the user has edited.
      const existing = this.#tokens.get(token.name);
      if (existing && existing.origin !== 'stylesheet') continue;
      this.#tokens.set(token.name, token);
    }
    this.#invalidate();
  }

  list(group?: TokenGroup): DesignToken[] {
    const all = [...this.#tokens.values()];
    const filtered = group ? all.filter((token) => token.group === group) : all;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Tokens bucketed by group, empty groups omitted. */
  grouped(): Array<{ group: TokenGroup; label: string; tokens: DesignToken[] }> {
    return TOKEN_GROUPS.map((group) => ({
      group,
      label: TOKEN_GROUP_LABELS[group],
      tokens: this.list(group),
    })).filter((entry) => entry.tokens.length > 0);
  }

  get(name: string): DesignToken | undefined {
    return this.#tokens.get(name.replace(/^--/, ''));
  }

  get size(): number {
    return this.#tokens.size;
  }

  /* ---------------------------------------------------------------------- */
  /* Writing                                                               */
  /* ---------------------------------------------------------------------- */

  upsert(token: Omit<DesignToken, 'group'> & { group?: TokenGroup }): DesignToken {
    const name = token.name.replace(/^--/, '').trim();
    const value = token.value.trim();
    const next: DesignToken = {
      name,
      value,
      group: token.group ?? inferGroup(name, value),
      label: token.label ?? prettifyTokenName(name),
      origin: token.origin ?? 'user',
      description: token.description,
    };
    this.#tokens.set(name, next);
    this.#flush();
    return next;
  }

  remove(name: string): DesignToken | undefined {
    const key = name.replace(/^--/, '');
    const existing = this.#tokens.get(key);
    if (!existing) return undefined;
    this.#tokens.delete(key);
    this.#flush();
    return existing;
  }

  /** Rename a token and rewrite every `var()` reference in the page. */
  rename(from: string, to: string): { updated: number } {
    const source = from.replace(/^--/, '');
    const target = to.replace(/^--/, '').trim();
    const token = this.#tokens.get(source);
    if (!token || !target || source === target) return { updated: 0 };

    this.#tokens.delete(source);
    this.#tokens.set(target, { ...token, name: target, label: prettifyTokenName(target) });

    let updated = 0;
    const pattern = new RegExp(`var\\(\\s*--${escapeRegExp(source)}\\b`, 'g');
    for (const el of queryDeep('[style]')) {
      const style = el.getAttribute('style') ?? '';
      if (!pattern.test(style)) continue;
      el.setAttribute('style', style.replace(pattern, `var(--${target}`));
      updated += 1;
    }
    this.#flush();
    return { updated };
  }

  /** Merge in tokens from an import, keeping existing user edits by default. */
  import(tokens: DesignToken[], options: { overwrite?: boolean } = {}): number {
    let count = 0;
    for (const token of tokens) {
      const name = token.name.replace(/^--/, '');
      if (!name || !token.value) continue;
      if (!options.overwrite && this.#tokens.has(name)) continue;
      this.#tokens.set(name, {
        ...token,
        name,
        group: token.group ?? inferGroup(name, token.value),
        label: token.label ?? prettifyTokenName(name),
        origin: token.origin ?? 'imported',
      });
      count += 1;
    }
    this.#flush();
    return count;
  }

  export(): DesignToken[] {
    return this.list();
  }

  /**
   * CSS for the tokens the overlay owns.
   *
   * Tokens that came from the page's own stylesheets are skipped unless the user
   * changed them, so the generated sheet stays a minimal diff rather than a copy
   * of the project's theme.
   */
  toCSS(includeAll = false): string {
    return this.#css(this.#owned(includeAll));
  }

  /**
   * The same CSS, narrowed to named tokens.
   *
   * For writing out only the part of a design system something actually uses. Shares the
   * formatter with `toCSS` rather than repeating it, because the two producing subtly
   * different CSS for the same tokens is the kind of difference nobody notices until a diff
   * is twice the size it should be.
   */
  cssFor(names: ReadonlySet<string>, includeAll = false): string {
    return this.#css(this.#owned(includeAll).filter((token) => names.has(token.name)));
  }

  #owned(includeAll: boolean): DesignToken[] {
    return this.list().filter((token) => includeAll || token.origin !== 'stylesheet');
  }

  #css(tokens: readonly DesignToken[]): string {
    if (!tokens.length) return '';
    const body = tokens.map((token) => `  --${token.name}: ${token.value};`).join('\n');
    return `:root {\n${body}\n}`;
  }

  /* ---------------------------------------------------------------------- */
  /* Usage                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * How many places reference each token.
   *
   * Drives the "Used in this project" section: a token already in use is a
   * safer choice than a new custom value, so those are surfaced first in every
   * value picker.
   */
  usage(): Map<string, number> {
    if (this.#usageCache) return this.#usageCache;
    const counts = new Map<string, number>();
    const bump = (name: string): void => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    };

    const visit = (container: CSSStyleSheet | CSSGroupingRule): void => {
      let list: CSSRuleList;
      try {
        list = container.cssRules;
      } catch {
        return;
      }
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSStyleRule) {
          for (const name of tokensInValue(rule.style.cssText)) bump(name);
        } else if (
          rule instanceof CSSMediaRule ||
          rule instanceof CSSSupportsRule ||
          (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule)
        ) {
          visit(rule);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) visit(sheet);
    for (const sheet of document.adoptedStyleSheets ?? []) visit(sheet);
    for (const el of queryDeep('[style]')) {
      for (const name of tokensInValue(el.getAttribute('style') ?? '')) bump(name);
    }

    this.#usageCache = counts;
    return counts;
  }

  /** Tokens used anywhere, most used first. */
  usedInProject(group?: TokenGroup, limit = 24): DesignToken[] {
    const usage = this.usage();
    return this.list(group)
      .filter((token) => (usage.get(token.name) ?? 0) > 0)
      .sort((a, b) => (usage.get(b.name) ?? 0) - (usage.get(a.name) ?? 0))
      .slice(0, limit);
  }

  /**
   * Tokens referenced by the CSS that applies to one element.
   *
   * This is the set re-proposed as "Used in this component", so styling a
   * sibling of an already-tokenised element pushes the user toward the tokens
   * that component already relies on.
   */
  usedBy(el: HTMLElement): DesignToken[] {
    const names = new Set<string>();
    for (const rule of appliedRules(el)) {
      for (const declaration of rule.declarations) {
        for (const name of tokensInValue(declaration.value)) names.add(name);
      }
    }
    const out: DesignToken[] = [];
    for (const name of names) {
      const token = this.#tokens.get(name);
      if (token) out.push(token);
      else {
        const value = getComputedStyle(el).getPropertyValue(`--${name}`).trim();
        if (value) out.push({ name, value, group: inferGroup(name, value), label: prettifyTokenName(name) });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Every declaration on the element (and its subtree) that resolves to a token,
   * as a declaration map. This is what "save these tokens as a class" uses.
   */
  tokenDeclarationsOf(el: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rule of appliedRules(el)) {
      for (const declaration of rule.declarations) {
        if (declaration.value.includes('var(--')) out[declaration.property] = declaration.value;
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------- */
  /* Plumbing                                                               */
  /* ---------------------------------------------------------------------- */

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  destroy(): void {
    this.#sheet.destroy();
    this.#listeners.clear();
    this.#tokens.clear();
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
        console.error('[html-editor-overlay] token listener failed', error);
      }
    }
  }
}

/**
 * Every root-level custom property declared in a stylesheet or at-rule.
 *
 * Recursive, so a token declared inside `@media` or `@supports` counts. Unreadable
 * containers are stepped over rather than thrown from: a page with one cross-origin
 * sheet should still get the tokens from all the others.
 */
function collectTokens(container: CSSStyleSheet | CSSGroupingRule, found: DesignToken[]): void {
  let list: CSSRuleList;
  try {
    list = container.cssRules;
  } catch {
    return;
  }
  for (const rule of Array.from(list)) {
    if (rule instanceof CSSStyleRule) {
      if (!isRootSelector(rule.selectorText)) continue;
      for (let i = 0; i < rule.style.length; i += 1) {
        const property = rule.style[i];
        if (!property.startsWith('--')) continue;
        const value = rule.style.getPropertyValue(property).trim();
        if (!value) continue;
        const name = property.slice(2);
        found.push({
          name,
          value,
          group: inferGroup(name, value),
          label: prettifyTokenName(name),
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
      collectTokens(rule, found);
    }
  }
}

function isRootSelector(selectorText: string): boolean {
  return selectorText
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === ':root' || part === 'html' || part === '*' || part === ':host' || part === 'body');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
