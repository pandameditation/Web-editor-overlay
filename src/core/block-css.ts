import { splitCssPriority, type PastedCssRule } from './css-paste.js';
import { formatHTML, safeCssValue, sanitizeFragment } from './sanitize.js';
import { withParsedSheet } from './sheets.js';

/**
 * Apply pasted selector rules to the in-memory markup of a block.
 *
 * The block author is editing a template, not a live page element, so the ordinary
 * CSS-paste inline destination cannot be used here. Matching is done against the
 * sanitised fragment and the result is written back as template HTML.
 */
export function blockMatchRoot(source: string): DocumentFragment {
  return sanitizeFragment(source);
}

export function applyBlockInlineRules(
  source: string,
  rules: readonly PastedCssRule[],
): { html: string; matched: number } {
  const fragment = blockMatchRoot(source);
  const roots = blockRoots(fragment);
  const elements = blockElements(fragment, roots);
  let matched = 0;

  for (const rule of rules) {
    const selected = elements.filter((element) => {
      if (rule.selector.trim() === ':scope') return roots.includes(element);
      try {
        return element.matches(rule.selector);
      } catch {
        return false;
      }
    });
    if (!selected.length) continue;
    matched += selected.length;
    for (const element of selected) {
      for (const [property, rawValue] of Object.entries(rule.declarations)) {
        const { value, priority } = splitCssPriority(rawValue);
        element.style.setProperty(property, value, priority);
      }
    }
  }

  return { html: serialiseFragment(fragment), matched };
}

/** Add a class to every block element matching a selector. */
export function addClassToBlockElements(
  source: string,
  name: string,
  selector: string,
): { html: string; matched: number } {
  const fragment = sanitizeFragment(source);
  const roots = blockRoots(fragment);
  const elements = blockElements(fragment, roots);
  const selected = selector.trim().startsWith(':scope')
    ? blockScopeMatches(roots, selector)
    : elements.filter((element) => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    });
  for (const element of selected) element.classList.add(name);
  return { html: serialiseFragment(fragment), matched: selected.length };
}

/** Add a global class to every root element in a block template. */
export function addClassToBlockRoots(
  source: string,
  name: string,
): { html: string; roots: number } {
  const result = addClassToBlockElements(source, name, ':scope');
  return { html: result.html, roots: result.matched };
}

/*
 * Block CSS scoping.
 *
 * Every selector is constrained on its *subject*, the compound the rule actually styles, rather
 * than prefixed with an ancestor. The old prefix (`[data-heo-block="id"] p`) could never match the
 * block's own top-level element, so `p { … }` in a block whose markup is `<p>` matched nothing.
 *
 * With S = this block's hooks and H = any block's hooks, the term appended to the subject is
 *
 *   :is(S, S *):not(#heo-block-scope):not(:where(S H:not(S) *))
 *
 * - `:is(S, S *)` keeps the subject on an instance's top-level element or inside it, so nothing
 *   outside an instance can match (no leak to the page or to other blocks).
 * - `:not(#heo-block-scope)` adds one ID of weight, so a scoped rule beats qualified page rules
 *   such as `body .prose p` or `#main p`. The id `heo-block-scope` is reserved: an element that
 *   carries it would not receive block styles.
 * - `:not(:where(…))` excludes what is inside a foreign block nested in the instance. The nested
 *   block's own root is still reachable, so a container's `.row > *` lays it out.
 *
 * `@scope` was measured and rejected: its implicit relation is descendant-only, which reproduces
 * the root-element miss, and it adds no specificity.
 */

/** The attribute on an instance's first top-level element. */
const BLOCK_HOOK = 'data-heo-block';
/** The attribute on an instance's further top-level elements. */
const PART_HOOK = 'data-heo-block-part';

interface BlockHooks {
  /** This block's hooks. */
  scope: string;
  /** The term appended to every subject compound. */
  term: string;
}

function blockHooks(blockId: string): BlockHooks {
  const escapedId = blockId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const scope = `:is([${BLOCK_HOOK}="${escapedId}"], [${PART_HOOK}="${escapedId}"])`;
  const anyBlock = `:is([${BLOCK_HOOK}], [${PART_HOOK}])`;
  const term = `:is(${scope}, ${scope} *):not(#heo-block-scope):not(:where(${scope} ${anyBlock}:not(${scope}) *))`;
  return { scope, term };
}

/** Block ids already warned about, so a page load logs each problem once per block. */
const warnedDropped = new Set<string>();
const warnedUnparsed = new Set<string>();

/**
 * Scope a block's CSS to the instances of that block.
 *
 * Rules apply to an instance's top-level element(s) and everything inside them, and nowhere else;
 * class-rooted selectors are scoped too. Declarations written without a selector become defaults
 * for the top-level element(s). CSS that cannot be parsed produces nothing rather than leaking
 * unscoped into the page.
 */
export function scopeBlockCSS(
  source: string,
  blockId: string,
  options: { captured?: boolean } = {},
): string {
  const text = String(source ?? '').trim();
  if (!text || !blockId) return '';

  const hooks = blockHooks(blockId);
  const split = splitTopLevel(text);
  const context: ScopeContext = {
    hooks,
    dropped: split.droppedCharset || split.droppedImports,
    captured: options.captured ? { keyframes: new Map(), fonts: new Map() } : null,
  };
  const out: string[] = [];

  /*
   * Rules are read before the bare declarations because a captured block's renames are
   * collected from its rules, and a bare `animation: fade 1s` has to use the same new name.
   */
  const rules = split.rules.trim()
    ? withParsedSheet(split.rules, (sheet) => {
      if (context.captured) collectCapturedNames(sheet.cssRules, blockId, context.captured);
      return Array.from(sheet.cssRules)
        .map((rule) => rewriteRule(rule, context))
        .filter((rule) => rule !== null);
    })
    : [];

  const bareText = split.declarations.trim()
    ? withParsedSheet(`heo-bare { ${split.declarations} }`, (sheet) => {
      const rule = sheet.cssRules[0];
      return rule instanceof CSSStyleRule ? rule.style.cssText : '';
    })
    : '';
  const bare = bareText && context.captured ? renameInDeclarations(bareText, context.captured) : bareText;
  /*
   * `:where(S)` adds nothing, so the bare rule weighs (1,1,0) and comes first: any authored rule
   * targeting the same element is at least as specific and later, so it wins for the properties
   * both set, whatever order the author wrote them in.
   */
  if (bare) out.push(`:where(${hooks.scope})${hooks.term} { ${bare} }`);

  if (split.rules.trim()) {
    if (rules === null) {
      // Failing closed: returning the raw text here used to inject it unscoped into the page.
      if (!warnedUnparsed.has(blockId)) {
        warnedUnparsed.add(blockId);
        console.warn('[html-editor-overlay] block CSS could not be parsed and was not applied', blockId);
      }
      return '';
    }
    out.push(...rules);
  }

  if (context.dropped && !warnedDropped.has(blockId)) {
    warnedDropped.add(blockId);
    console.warn(
      '[html-editor-overlay] block CSS: @import/@namespace/@charset is not supported in block CSS and was dropped',
      blockId,
    );
  }
  return out.join('\n\n');
}

/** What a captured block's CSS renames: keyframes by name, font faces by family. */
export interface CapturedRenames {
  keyframes: Map<string, string>;
  fonts: Map<string, string>;
}

interface ScopeContext {
  hooks: BlockHooks;
  dropped: boolean;
  /** Set for captured blocks only; authored blocks keep their global names. */
  captured: CapturedRenames | null;
}

/**
 * Give a captured block's keyframes and font faces names of their own.
 *
 * A capture brings CSS written for a whole site, where `fade` and `Inter` are global names.
 * Pasted as-is, two captures (or a capture and the page) would fight over the same
 * `@keyframes fade`, and whichever came last would animate both. Suffixing by block id makes
 * every paste self-contained. Walked recursively, so a keyframes rule inside `@media` counts.
 */
function collectCapturedNames(rules: CSSRuleList, blockId: string, renames: CapturedRenames): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSKeyframesRule) {
      if (rule.name && !renames.keyframes.has(rule.name)) {
        renames.keyframes.set(rule.name, cssIdent(`${rule.name}--${blockId}`));
      }
      continue;
    }
    if (rule instanceof CSSFontFaceRule) {
      const family = unquote(rule.style.getPropertyValue('font-family'));
      if (family && !renames.fonts.has(family.toLowerCase())) {
        renames.fonts.set(family.toLowerCase(), `${blockId}--${family}`);
      }
      continue;
    }
    const children = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
    if (children?.length) collectCapturedNames(children, blockId, renames);
  }
}

function rewriteRule(rule: CSSRule, context: ScopeContext): string | null {
  /*
   * Dropped by type. In the joined managed sheet an @import is only valid before every other
   * rule, so it would work or not depending on block order, and it would load unscoped CSS.
   */
  if (rule instanceof CSSImportRule || rule instanceof CSSNamespaceRule) {
    context.dropped = true;
    return null;
  }
  // A captured block's keyframes and font faces are re-emitted under their block-local names.
  if (context.captured && rule instanceof CSSKeyframesRule) {
    return renameKeyframesRule(rule.cssText, context.captured.keyframes.get(rule.name));
  }
  if (context.captured && rule instanceof CSSFontFaceRule) {
    return renameFontFaceRule(rule.cssText, context.captured.fonts);
  }
  // Keyframe and font names are global by nature; their bodies hold no selectors.
  if (rule instanceof CSSKeyframesRule || rule instanceof CSSFontFaceRule) return rule.cssText;

  const children = 'cssRules' in rule
    ? (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules
    : undefined;
  const nested = children?.length
    ? Array.from(children)
      .map((child) => rewriteRule(child, context))
      .filter((child): child is string => child !== null)
    : [];

  if (rule instanceof CSSStyleRule) {
    const selector = scopeSelectorList(rule.selectorText, context.hooks, Boolean(context.captured));
    const declarations = context.captured
      ? renameInDeclarations(rule.style.cssText, context.captured)
      : rule.style.cssText;
    /*
     * Nested rules (CSS nesting) are scoped the same way, from their own read-back selector.
     * Copying them verbatim would keep `& + div` able to style a page element next to the block.
     */
    if (!nested.length) return `${selector} { ${declarations} }`;
    const body = [declarations, ...nested].filter((part) => part.trim()).map(indent).join('\n');
    return `${selector} {\n${body}\n}`;
  }

  // @media, @supports, @container, @layer blocks, @scope and the like: scope what is inside.
  if (!nested.length) return rule.cssText;
  const source = rule.cssText;
  const open = source.indexOf('{');
  if (open < 0) return source;
  const prelude = source.slice(0, open).trim();
  return `${prelude} {\n${nested.map(indent).join('\n')}\n}`;
}

function scopeSelectorList(selectorText: string, hooks: BlockHooks, captured = false): string {
  return splitSelectorList(selectorText)
    .map((part) => scopeSelector(captured ? rootSubjectsToScope(part) : part, hooks))
    .filter(Boolean)
    .join(', ');
}

/*
 * Captured CSS helpers.
 *
 * Pure string functions, so the node tests can pin them. They run only on blocks whose
 * origin is `captured`: an authored block's `fade` may be the page's own keyframes on purpose.
 */

/** The leading document-root compounds a captured page's CSS hangs its base styles on. */
const ROOT_SUBJECT = /^(?:(?:html|:root)\s*>\s*body|(?:html|:root)\s+body|html|body|:root)(?![\w-])/i;

/**
 * Map a leading `:root`, `html`, `body`, `html body` or `html > body` to `:scope`.
 *
 * A capture's `body { color: … }` is the colour the element inherited on its own site. Scoped
 * as written, `body` can never match inside a block, so the rule did nothing and the paste
 * came out in the host page's colour. As `:scope` it lands on the block's root, where it is
 * inherited by everything inside. `.body` and `bodyx` are other selectors and stay as they are.
 */
export function rootSubjectsToScope(selector: string): string {
  const trimmed = selector.trim();
  return trimmed.replace(ROOT_SUBJECT, ':scope');
}

/** Rename keyframes references in an `animation` or `animation-name` value. */
export function renameAnimationNames(value: string, map: ReadonlyMap<string, string>): string {
  if (!map.size) return value;
  let out = '';
  let depth = 0;
  let index = 0;
  while (index < value.length) {
    const ch = value[index];
    if (ch === '"' || ch === "'") {
      const end = skipString(value, index);
      const inner = value.slice(index + 1, end - 1);
      // A quoted keyframes name is still a name; it comes back as an identifier.
      const renamed = depth === 0 ? map.get(inner) : undefined;
      out += renamed ?? value.slice(index, end);
      index = end;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    const ident = /^-?[A-Za-z_\u00a0-\uffff][\w\u00a0-\uffff-]*/.exec(value.slice(index));
    // Not the tail of a longer token (`1s`, `ease-in`), and not the `important` of `!important`.
    if (ident && (index === 0 || !/[\w!-]/.test(value[index - 1]))) {
      const word = ident[0];
      out += depth === 0 && map.has(word) ? (map.get(word) as string) : word;
      index += word.length;
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
}

/**
 * Rename font families in a `font-family` value, or in the family list of a `font` shorthand.
 *
 * `map` is keyed by the lower-cased family, because family matching is case-insensitive.
 * Quoted and unquoted spellings both count; the new name is always written quoted. Only a
 * whole family is renamed: `Probe` is not found inside `Probe Sans`.
 */
export function renameFontFamilies(
  value: string,
  map: ReadonlyMap<string, string>,
  shorthand = false,
): string {
  if (!map.size) return value;
  const segments = splitTopLevelOn(value, ',');
  return segments
    .map((segment, index) => {
      const lead = /^\s*/.exec(segment)?.[0] ?? '';
      const tail = /\s*$/.exec(segment)?.[0] ?? '';
      const body = segment.trim();
      // In the shorthand, the first family follows the size, so only the end of it is a name.
      const prefixed = shorthand && index === 0;
      const quoted = /(["'])((?:\\.|(?!\1).)*)\1$/.exec(body);
      if (quoted && (!prefixed ? quoted.index === 0 : true)) {
        const renamed = map.get(quoted[2].toLowerCase());
        if (!renamed) return segment;
        return `${lead}${body.slice(0, quoted.index)}${quoteFamily(renamed)}${tail}`;
      }
      if (!prefixed) {
        const renamed = map.get(body.replace(/\s+/g, ' ').toLowerCase());
        return renamed ? `${lead}${quoteFamily(renamed)}${tail}` : segment;
      }
      // Unquoted after the size: try the longest run of trailing identifiers that is a known family.
      const words = body.split(/\s+/);
      for (let take = words.length - 1; take >= 1; take -= 1) {
        const family = words.slice(words.length - take).join(' ');
        const renamed = map.get(family.toLowerCase());
        if (renamed) {
          return `${lead}${words.slice(0, words.length - take).join(' ')} ${quoteFamily(renamed)}${tail}`;
        }
      }
      return segment;
    })
    .join(',');
}

/**
 * Rename keyframes and families in a custom property's value.
 *
 * A capture carries resolved variables as bare `--x: value` declarations, and Tailwind v4
 * (`--animate-*`, `--font-*`) or next/font route names through them, so `animation: var(--x)`
 * would point at the old name. The value's use is unknown, so each comma segment that is a
 * whole renamed family takes the font rename; any other segment takes the keyframes rename,
 * which only touches whole top-level identifiers.
 */
function renameInCustomProperty(value: string, renames: CapturedRenames): string {
  return splitTopLevelOn(value, ',')
    .map((segment) => {
      const family = renameFontFamilies(segment, renames.fonts);
      return family !== segment ? family : renameAnimationNames(segment, renames.keyframes);
    })
    .join(',');
}
/** Apply a captured block's renames to a declaration list, leaving everything else as written. */
export function renameInDeclarations(cssText: string, renames: CapturedRenames): string {
  if (!renames.keyframes.size && !renames.fonts.size) return cssText;
  return splitTopLevelOn(cssText, ';')
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 0) return declaration;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const raw = declaration.slice(colon + 1);
      // The priority is not part of the value; a family list ending in it would not match.
      const priority = /\s*!\s*important\s*$/i.exec(raw)?.[0] ?? '';
      const value = raw.slice(0, raw.length - priority.length);
      let next = value;
      if (/^(?:-webkit-)?animation(?:-name)?$/.test(property)) {
        next = renameAnimationNames(value, renames.keyframes);
      } else if (property === 'font-family') {
        next = renameFontFamilies(value, renames.fonts);
      } else if (property === 'font') {
        next = renameFontFamilies(value, renames.fonts, true);
      } else if (property.startsWith('--')) {
        next = renameInCustomProperty(value, renames);
      }
      return next === value ? declaration : `${declaration.slice(0, colon + 1)}${next}${priority}`;
    })
    .join(';');
}

/**
 * Captured CSS with every unsafe value taken out, and a list of what went.
 *
 * A capture arrives through the clipboard, so its CSS is untrusted however it was made. Block
 * CSS is otherwise authored here and never vetted, which left `background: url(javascript:…)`
 * in a pasted capture free to reach the page. Each style property, and each `@font-face src`,
 * goes through `safeCssValue`; a font face whose `src` is refused is dropped whole, since it
 * cannot load anything. When nothing is removed the text comes back exactly as given.
 * Browser-only: it needs the CSS parser.
 */
export function vetCapturedCSS(css: string): { css: string; removed: string[] } {
  const source = String(css ?? '');
  const removed: string[] = [];
  const split = splitTopLevel(source);

  const vetStyle = (style: CSSStyleDeclaration, where: string): void => {
    for (const property of Array.from(style)) {
      const verdict = safeCssValue(style.getPropertyValue(property));
      if (!verdict) continue;
      style.removeProperty(property);
      removed.push(`${where} { ${property} } (${shorten(verdict.unsafe)})`);
    }
  };
  const vetRules = (list: CSSRuleList, owner: { deleteRule(index: number): void }): void => {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const rule = list[index];
      if (rule instanceof CSSFontFaceRule) {
        const verdict = safeCssValue(rule.style.getPropertyValue('src'));
        if (verdict) {
          owner.deleteRule(index);
          removed.push(`@font-face { src } (${shorten(verdict.unsafe)})`);
        }
        continue;
      }
      if (rule instanceof CSSStyleRule) vetStyle(rule.style, rule.selectorText);
      else if (rule instanceof CSSKeyframeRule) vetStyle(rule.style, rule.keyText);
      const children = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      if (children?.length) {
        const parent = rule as unknown as { deleteRule?(index: number): void };
        vetRules(children, {
          deleteRule: (at) => parent.deleteRule?.(at),
        });
      }
    }
  };

  const bare = split.declarations.trim()
    ? withParsedSheet(`heo-bare { ${split.declarations} }`, (sheet) => {
      const rule = sheet.cssRules[0];
      if (!(rule instanceof CSSStyleRule)) return '';
      vetStyle(rule.style, '(no selector)');
      return rule.style.cssText;
    })
    : '';
  const rules = split.rules.trim()
    ? withParsedSheet(split.rules, (sheet) => {
      vetRules(sheet.cssRules, sheet);
      return Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
    })
    : '';

  if (!removed.length) return { css: source, removed };
  return { css: [bare ?? '', rules ?? ''].filter((part) => part.trim()).join('\n'), removed };
}

function shorten(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** `@keyframes fade { … }` re-emitted as `@keyframes <name> { … }`. */
function renameKeyframesRule(cssText: string, name: string | undefined): string {
  if (!name) return cssText;
  const open = cssText.indexOf('{');
  if (open < 0) return cssText;
  const at = /^@[\w-]*keyframes/i.exec(cssText)?.[0] ?? '@keyframes';
  return `${at} ${name} ${cssText.slice(open)}`;
}

/** `@font-face { font-family: X; … }` re-emitted with the block-local family. */
function renameFontFaceRule(cssText: string, fonts: ReadonlyMap<string, string>): string {
  const open = cssText.indexOf('{');
  const close = cssText.lastIndexOf('}');
  if (open < 0 || close < open) return cssText;
  const body = splitTopLevelOn(cssText.slice(open + 1, close), ';')
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== 'font-family') return declaration;
      const renamed = fonts.get(unquote(declaration.slice(colon + 1)).toLowerCase());
      return renamed ? `${declaration.slice(0, colon + 1)} ${quoteFamily(renamed)}` : declaration;
    })
    .join(';');
  return `${cssText.slice(0, open + 1)}${body}${cssText.slice(close)}`;
}

/** Split on a delimiter at paren depth 0, outside strings, keeping every segment's own text. */
function splitTopLevelOn(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === '\\') {
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      index = skipString(text, index) - 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === delimiter && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])((?:\\.|(?!\1).)*)\1$/.exec(trimmed);
  return (quoted ? quoted[2].replace(/\\(.)/g, '$1') : trimmed).replace(/\s+/g, ' ');
}

function quoteFamily(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A keyframes name as an identifier, escaped when it is not already one. */
function cssIdent(name: string): string {
  if (/^-?[A-Za-z_][\w-]*$/.test(name)) return name;
  const escape = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape;
  return escape ? escape(name) : name.replace(/[^\w-]/g, '_');
}

/** Constrain one complex selector's subject compound to the block. */
function scopeSelector(selector: string, hooks: BlockHooks): string {
  const trimmed = replaceScopeToken(selector.trim(), hooks.scope);
  if (!trimmed) return '';
  const { start, pseudoElement } = subjectCompound(trimmed);
  if (start >= trimmed.length) return '';
  const at = pseudoElement ?? trimmed.length;
  return `${trimmed.slice(0, at)}${hooks.term}${trimmed.slice(at)}`;
}

/** `:scope` means the block's own top-level element(s), inside `:is()` and `:has()` as well. */
function replaceScopeToken(selector: string, scope: string): string {
  let out = '';
  let quote = '';
  for (let index = 0; index < selector.length; index += 1) {
    const ch = selector[index];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += selector[index + 1] ?? '';
        index += 1;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '\\') {
      out += ch + (selector[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (
      ch === ':' &&
      selector[index - 1] !== ':' &&
      selector.slice(index, index + 6).toLowerCase() === ':scope' &&
      !/[\w-]/.test(selector[index + 6] ?? '')
    ) {
      out += scope;
      index += 5;
      continue;
    }
    out += ch;
  }
  return out;
}

const LEGACY_PSEUDO_ELEMENTS = ['before', 'after', 'first-line', 'first-letter'];

/**
 * Where the subject compound starts, and where its first pseudo-element is.
 *
 * Scanned at bracket, paren and quote depth 0, honouring backslash escapes: the subject starts
 * after the last top-level combinator, and the scope term has to go before a pseudo-element
 * because nothing may follow one in a compound.
 */
function subjectCompound(selector: string): { start: number; pseudoElement: number | null } {
  let start = 0;
  let pseudoElement: number | null = null;
  let brackets = 0;
  let parentheses = 0;
  let quote = '';
  for (let index = 0; index < selector.length; index += 1) {
    const ch = selector[index];
    if (ch === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[') brackets += 1;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    else if (ch === '(') parentheses += 1;
    else if (ch === ')') parentheses = Math.max(0, parentheses - 1);
    if (brackets || parentheses || ch === '[' || ch === ']' || ch === '(' || ch === ')') continue;
    if (/[\s>+~]/.test(ch)) {
      start = index + 1;
      pseudoElement = null;
      continue;
    }
    if (ch === ':' && pseudoElement === null) {
      if (selector[index + 1] === ':') {
        pseudoElement = index;
        index += 1;
        continue;
      }
      const rest = selector.slice(index + 1).toLowerCase();
      const legacy = LEGACY_PSEUDO_ELEMENTS.find(
        (name) => rest.startsWith(name) && !/[\w-]/.test(rest[name.length] ?? ''),
      );
      if (legacy) pseudoElement = index;
    }
  }
  return { start, pseudoElement };
}

/**
 * Split block CSS into declarations written without a selector, and everything else.
 *
 * Needed because the CSS parser drops a declaration that precedes a rule together with that
 * rule. Depth-0 segments ending in `;` are declarations, unless they are at-rule statements;
 * `@charset` is dropped and reported, and so are `@import` and `@namespace` — dropping them here
 * rather than after parsing means the parse never fetches a sheet that would be thrown away.
 * Segments ending in `{` go to `rules` with their block. A trailing segment with no terminator is
 * a declaration when it has a colon.
 */
export function splitTopLevel(css: string): {
  declarations: string;
  rules: string;
  droppedCharset: boolean;
  droppedImports: boolean;
} {
  const source = String(css ?? '');
  const declarations: string[] = [];
  const rules: string[] = [];
  let droppedCharset = false;
  let droppedImports = false;
  let start = 0;
  let index = 0;
  let parentheses = 0;
  let brackets = 0;

  const statement = (text: string): void => {
    const bare = stripComments(text).trim();
    if (!bare || bare === ';') return;
    if (bare.startsWith('@')) {
      if (/^@charset\b/i.test(bare)) droppedCharset = true;
      else if (/^@(?:import|namespace)\b/i.test(bare)) droppedImports = true;
      else rules.push(text.trim());
      return;
    }
    declarations.push(text.trim());
  };

  while (index < source.length) {
    const ch = source[index];
    if (ch === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === '\\') {
      index += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      index = skipString(source, index);
      continue;
    }
    if (ch === '(') parentheses += 1;
    else if (ch === ')') parentheses = Math.max(0, parentheses - 1);
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    else if (!parentheses && !brackets) {
      if (ch === ';') {
        statement(source.slice(start, index + 1));
        start = index + 1;
      } else if (ch === '{') {
        const end = matchingBrace(source, index);
        rules.push(source.slice(start, end).trim());
        index = end;
        start = end;
        continue;
      } else if (ch === '}') {
        // A stray close brace: drop the segment it ends, as the parser would.
        start = index + 1;
      }
    }
    index += 1;
  }
  const tail = source.slice(start);
  if (stripComments(tail).trim()) {
    if (stripComments(tail).includes(':') && !stripComments(tail).trim().startsWith('@')) {
      declarations.push(`${tail.trim()};`);
    } else {
      statement(`${tail.trim()};`);
    }
  }
  return { declarations: declarations.join(' '), rules: rules.join('\n'), droppedCharset, droppedImports };
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');
}

/** The index just past the string starting at `open`. */
function skipString(source: string, open: number): number {
  const quote = source[open];
  for (let index = open + 1; index < source.length; index += 1) {
    if (source[index] === '\\') index += 1;
    else if (source[index] === quote || source[index] === '\n') return index + 1;
  }
  return source.length;
}

/** The index just past the brace that closes the one at `open`, or the end when unbalanced. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) return source.length;
      index = end + 1;
    } else if (ch === '\\') {
      index += 1;
    } else if (ch === '"' || ch === "'") {
      index = skipString(source, index) - 1;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

/**
 * The block ids a set of CSS texts refers to through `data-heo-block` or `data-heo-block-part`.
 *
 * A save that does not carry the library still keeps an instance's link while some CSS the page
 * carries targets it, or that CSS would be written dead.
 */
export function blockIdsReferencedByCSS(cssTexts: Iterable<string>): Set<string> {
  const ids = new Set<string>();
  const pattern = /data-heo-block(?:-part)?="((?:[^"\\]|\\.)*)"/g;
  for (const text of cssTexts) {
    for (const match of String(text ?? '').matchAll(pattern)) {
      ids.add(match[1].replace(/\\(["\\])/g, '$1'));
    }
  }
  return ids;
}

function splitSelectorList(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let brackets = 0;
  let parentheses = 0;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[') brackets += 1;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    else if (ch === '(') parentheses += 1;
    else if (ch === ')') parentheses = Math.max(0, parentheses - 1);
    else if (ch === ',' && brackets === 0 && parentheses === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.filter((part) => part.trim());
}

function blockScopeMatches(roots: HTMLElement[], selector: string): HTMLElement[] {
  const selected: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const root of roots) {
    try {
      if (root.matches(selector) && !seen.has(root)) {
        seen.add(root);
        selected.push(root);
      }
      for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        if (!seen.has(element)) {
          seen.add(element);
          selected.push(element);
        }
      }
    } catch {
      return [];
    }
  }
  return selected;
}

function blockElements(fragment: DocumentFragment, roots = blockRoots(fragment)): HTMLElement[] {
  const descendants = Array.from(fragment.querySelectorAll<HTMLElement>('*'));
  return [...roots, ...descendants];
}

function blockRoots(fragment: DocumentFragment): HTMLElement[] {
  return Array.from(fragment.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

function serialiseFragment(fragment: DocumentFragment): string {
  const holder = document.createElement('div');
  holder.append(fragment);
  return formatHTML(holder.innerHTML);
}

function indent(source: string): string {
  return source
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
