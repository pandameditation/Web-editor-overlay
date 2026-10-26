import { splitCssPriority, type PastedCssRule } from './css-paste.js';
import { formatHTML, sanitizeFragment } from './sanitize.js';
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
export function scopeBlockCSS(source: string, blockId: string): string {
  const text = String(source ?? '').trim();
  if (!text || !blockId) return '';

  const hooks = blockHooks(blockId);
  const split = splitTopLevel(text);
  const context = { hooks, dropped: split.droppedCharset || split.droppedImports };
  const out: string[] = [];

  const bare = split.declarations.trim()
    ? withParsedSheet(`heo-bare { ${split.declarations} }`, (sheet) => {
      const rule = sheet.cssRules[0];
      return rule instanceof CSSStyleRule ? rule.style.cssText : '';
    })
    : '';
  /*
   * `:where(S)` adds nothing, so the bare rule weighs (1,1,0) and comes first: any authored rule
   * targeting the same element is at least as specific and later, so it wins for the properties
   * both set, whatever order the author wrote them in.
   */
  if (bare) out.push(`:where(${hooks.scope})${hooks.term} { ${bare} }`);

  if (split.rules.trim()) {
    const rules = withParsedSheet(split.rules, (sheet) =>
      Array.from(sheet.cssRules)
        .map((rule) => rewriteRule(rule, context))
        .filter((rule) => rule !== null),
    );
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

function rewriteRule(rule: CSSRule, context: { hooks: BlockHooks; dropped: boolean }): string | null {
  /*
   * Dropped by type. In the joined managed sheet an @import is only valid before every other
   * rule, so it would work or not depending on block order, and it would load unscoped CSS.
   */
  if (rule instanceof CSSImportRule || rule instanceof CSSNamespaceRule) {
    context.dropped = true;
    return null;
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
    const selector = scopeSelectorList(rule.selectorText, context.hooks);
    const declarations = rule.style.cssText;
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

function scopeSelectorList(selectorText: string, hooks: BlockHooks): string {
  return splitSelectorList(selectorText)
    .map((part) => scopeSelector(part, hooks))
    .filter(Boolean)
    .join(', ');
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
