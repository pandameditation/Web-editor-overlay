/**
 * The capture's pure CSS-text helpers: no DOM, no CSSOM, so they run (and are tested) in Node.
 *
 * The capture reads a page's rules through the CSSOM into `RuleNode`s, decides which of them
 * matter for the picked element, and writes the survivors back out as text. Everything about
 * that which is string work lives here; `collect.ts` does the browser half.
 */

export type RuleNode =
  | { kind: 'style'; selector: string; declarations: string }
  | { kind: 'group'; prelude: string; children: RuleNode[] }
  | { kind: 'keyframes'; name: string; text: string }
  | { kind: 'font-face'; family: string; text: string }
  | { kind: 'other'; text: string };

/** Pseudo-classes that depend on what the user is doing, and every pseudo-element. */
const USER_ACTION = new Set(['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited']);
/** Pseudo-elements that predate the `::` syntax and still parse with one colon. */
const LEGACY_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

/**
 * A selector with its user-action pseudo-classes and pseudo-elements taken out.
 *
 * Used only to ask "would this rule ever apply to the picked subtree": `a:hover` does not match
 * now, but it will the moment the user points at the pasted link, so it has to come along. The
 * kept rule keeps its original selector. A compound emptied by the removal becomes `*`, so
 * `.card :hover` still means "a descendant of .card". Quotes and attribute brackets are skipped
 * over, so `[data-x=":hover"]` is left alone.
 */
export function stripUserActionPseudos(selector: string): string {
  let out = '';
  let at = 0;
  const text = selector;
  const boundary = (ch: string | undefined): boolean =>
    ch === undefined || /[\s>+~,()]/.test(ch);
  while (at < text.length) {
    const ch = text[at];
    if (ch === '"' || ch === "'") {
      const end = skipString(text, at);
      out += text.slice(at, end);
      at = end;
      continue;
    }
    if (ch === '[') {
      let end = at + 1;
      while (end < text.length && text[end] !== ']') {
        end = text[end] === '"' || text[end] === "'" ? skipString(text, end) : end + 1;
      }
      out += text.slice(at, end + 1);
      at = end + 1;
      continue;
    }
    if (ch === '\\') {
      out += text.slice(at, at + 2);
      at += 2;
      continue;
    }
    if (ch === ':') {
      const element = text[at + 1] === ':';
      const nameStart = at + (element ? 2 : 1);
      let nameEnd = nameStart;
      while (nameEnd < text.length && /[\w-]/.test(text[nameEnd])) nameEnd += 1;
      const name = text.slice(nameStart, nameEnd).toLowerCase();
      if (element || USER_ACTION.has(name) || LEGACY_ELEMENTS.has(name)) {
        let end = nameEnd;
        // `::part(x)`, `::slotted(x)`: the argument goes with the pseudo-element.
        if (text[end] === '(') end = skipParens(text, end);
        const before = out.replace(/\s+$/, '') === out ? out[out.length - 1] : ' ';
        if (boundary(before) && boundary(text[end])) out += '*';
        at = end;
        continue;
      }
      out += text.slice(at, nameEnd);
      at = nameEnd;
      continue;
    }
    out += ch;
    at += 1;
  }
  return out;
}

function skipString(text: string, at: number): number {
  const quote = text[at];
  let end = at + 1;
  while (end < text.length && text[end] !== quote) end += text[end] === '\\' ? 2 : 1;
  return end + 1;
}

function skipParens(text: string, at: number): number {
  let depth = 0;
  let end = at;
  while (end < text.length) {
    const ch = text[end];
    if (ch === '"' || ch === "'") {
      end = skipString(text, end);
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return end + 1;
    }
    end += 1;
  }
  return end;
}

/**
 * The style rules `keep` accepts, inside the groups that still hold any, in source order.
 *
 * Groups (`@media`, `@container`, `@supports`, `@layer`, `@starting-style`) are kept with their
 * prelude whether or not they apply right now: a `@media (max-width: 600px)` rule is the
 * responsiveness, and it is exactly the one that does not apply on a wide screen. Keyframes and
 * font faces are not kept here; `pickDependencies` brings the ones in use.
 */
export function filterRuleTree(nodes: RuleNode[], keep: (selector: string) => boolean): RuleNode[] {
  const out: RuleNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'style') {
      if (keep(node.selector)) out.push(node);
    } else if (node.kind === 'group') {
      const children = filterRuleTree(node.children, keep);
      if (children.length) out.push({ kind: 'group', prelude: node.prelude, children });
    }
  }
  return out;
}

export function serializeRuleTree(nodes: RuleNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'style':
          return `${node.selector} { ${node.declarations} }`;
        case 'group':
          return `${node.prelude} {\n${serializeRuleTree(node.children)}\n}`;
        default:
          return node.text;
      }
    })
    .join('\n');
}

/** Every style node in the tree, groups opened. */
export function styleNodesIn(nodes: RuleNode[]): Extract<RuleNode, { kind: 'style' }>[] {
  const out: Extract<RuleNode, { kind: 'style' }>[] = [];
  for (const node of nodes) {
    if (node.kind === 'style') out.push(node);
    else if (node.kind === 'group') out.push(...styleNodesIn(node.children));
  }
  return out;
}

/** True when any node sits under an `@container` group. */
export function hasContainerGroup(nodes: RuleNode[]): boolean {
  return nodes.some((node) => node.kind === 'group' &&
    (/^@container\b/i.test(node.prelude) || hasContainerGroup(node.children)));
}

/* -------------------------------------------------------------------------- */
/* Names a rule set depends on                                                 */
/* -------------------------------------------------------------------------- */

/** Split on commas outside parentheses and quotes. */
export function splitTopLevelCommas(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (let at = 0; at < value.length; at += 1) {
    const ch = value[at];
    if (ch === '"' || ch === "'") {
      const end = skipString(value, at);
      current += value.slice(at, end);
      at = end - 1;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter(Boolean);
}

/** Every value of a property in a declaration list (`a: 1; b: 2`), longhand and shorthand alike. */
function valuesOf(declarations: string, property: RegExp): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`(?:^|[;{\\s])(${property.source})\\s*:\\s*([^;}]*)`, 'gi');
  for (const match of declarations.matchAll(pattern)) out.push(match[2].trim());
  return out;
}

const ANIMATION_KEYWORDS = new Set([
  'none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer',
  'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end',
  'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse',
  'forwards', 'backwards', 'both', 'running', 'paused', 'auto',
]);

/** Animation names used by `animation` and `animation-name` in a declaration list. */
export function animationNamesIn(declarations: string): string[] {
  const names = new Set<string>();
  for (const value of valuesOf(declarations, /animation-name/)) {
    for (const part of splitTopLevelCommas(value)) {
      const name = unquote(part);
      if (name && !ANIMATION_KEYWORDS.has(name.toLowerCase())) names.add(name);
    }
  }
  for (const value of valuesOf(declarations, /animation/)) {
    for (const part of splitTopLevelCommas(value)) {
      // The name is the one token that is not a keyword, a time, a number or a function.
      const tokens = part.replace(/\([^)]*\)/g, '()').split(/\s+/);
      for (const token of tokens) {
        if (!token || token.includes('(')) continue;
        if (/^[-+]?[\d.]/.test(token)) continue;
        if (ANIMATION_KEYWORDS.has(token.toLowerCase())) continue;
        names.add(unquote(token));
        break;
      }
    }
  }
  return [...names];
}

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif',
  'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
  'inherit', 'initial', 'unset', 'revert', '-apple-system', 'blinkmacsystemfont',
]);

/** The families named in a `font-family` value, unquoted, generics left out. */
export function fontFamiliesIn(value: string): string[] {
  return splitTopLevelCommas(value)
    .map((part) => unquote(part))
    .filter((name) => name && !GENERIC_FAMILIES.has(name.toLowerCase()));
}

/** The families named by `font-family` and `font` declarations in a declaration list. */
export function fontFamiliesInDeclarations(declarations: string): string[] {
  const out = new Set<string>();
  for (const value of valuesOf(declarations, /font-family/)) {
    for (const family of fontFamiliesIn(value)) out.add(family);
  }
  return [...out];
}

/** Every `var(--x)` name in a stylesheet, nested fallbacks included. */
export function customPropertiesIn(css: string): string[] {
  const names = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--[\w-]+)/g)) names.add(match[1]);
  return [...names];
}

/**
 * The keyframes and font faces that the kept rules use, found anywhere in the sheet tree.
 *
 * Names compare case-sensitively for keyframes (they are identifiers) and case-insensitively for
 * families (font matching is). Returned flat, in source order.
 */
export function pickDependencies(
  nodes: RuleNode[],
  used: { animationNames: Iterable<string>; fontFamilies: Iterable<string> },
): RuleNode[] {
  const animations = new Set(used.animationNames);
  const families = new Set([...used.fontFamilies].map((name) => name.toLowerCase()));
  const out: RuleNode[] = [];
  const seenKeyframes = new Set<string>();
  const walk = (list: RuleNode[]): void => {
    for (const node of list) {
      if (node.kind === 'keyframes' && animations.has(node.name)) {
        // The last definition of a name wins in CSS, so a later duplicate replaces the earlier.
        if (seenKeyframes.has(node.name)) {
          const index = out.findIndex((entry) => entry.kind === 'keyframes' && entry.name === node.name);
          if (index >= 0) out.splice(index, 1);
        }
        seenKeyframes.add(node.name);
        out.push(node);
      } else if (node.kind === 'font-face' && families.has(node.family.toLowerCase())) {
        out.push(node);
      } else if (node.kind === 'group') {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

export function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[text.length - 1] === text[0]) {
    return text.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Script-driven animations                                                    */
/* -------------------------------------------------------------------------- */

export interface WaapiTiming {
  duration?: number | string;
  delay?: number;
  iterations?: number;
  direction?: string;
  fill?: string;
  easing?: string;
}

const KEYFRAME_META = new Set(['offset', 'computedOffset', 'easing', 'composite']);

function kebab(property: string): string {
  if (property.startsWith('--')) return property;
  if (property === 'cssFloat') return 'float';
  if (property === 'cssOffset') return 'offset';
  return property.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/**
 * A Web Animations animation as a `@keyframes` rule plus the `animation` value that plays it.
 *
 * Script-started animations (`element.animate(...)`) leave no trace in any stylesheet, so a capture
 * of an entrance animation driven that way would paste as a still. Converting them keeps the
 * opening animation without carrying any script. Offsets come from `computedOffset` when the
 * browser spaced them itself.
 */
export function waapiToCss(
  name: string,
  keyframes: Array<Record<string, unknown>>,
  timing: WaapiTiming,
): { keyframes: string; animation: string } {
  const count = keyframes.length;
  const frames = keyframes.map((frame, index) => {
    const offset = typeof frame.computedOffset === 'number'
      ? frame.computedOffset
      : typeof frame.offset === 'number'
        ? frame.offset
        : count > 1 ? index / (count - 1) : 1;
    const declarations = Object.entries(frame)
      .filter(([key, value]) => !KEYFRAME_META.has(key) && value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${kebab(key)}: ${String(value)};`);
    if (typeof frame.easing === 'string' && frame.easing !== 'linear') {
      declarations.push(`animation-timing-function: ${frame.easing};`);
    }
    const percent = `${Math.round(offset * 10000) / 100}%`;
    return `  ${percent} { ${declarations.join(' ')} }`;
  });
  const duration = typeof timing.duration === 'number' ? timing.duration : 0;
  const iterations = timing.iterations === Infinity ? 'infinite' : String(timing.iterations ?? 1);
  const animation = [
    name,
    `${duration}ms`,
    timing.easing ?? 'linear',
    `${timing.delay ?? 0}ms`,
    iterations,
    timing.direction ?? 'normal',
    timing.fill && timing.fill !== 'auto' ? timing.fill : 'none',
  ].join(' ');
  return { keyframes: `@keyframes ${name} {\n${frames.join('\n')}\n}`, animation };
}

/**
 * `{{` written so the block template renderer does not take page text for a prop.
 *
 * HEO blocks use `{{name}}` placeholders; a captured page that shows `{{ price }}` in its text (a
 * Vue or Angular page before hydration, or docs about them) would otherwise lose that text to a
 * prop that does not exist. `&#123;` decodes back to `{` when the markup is parsed.
 */
export function escapeTemplateBraces(html: string): string {
  return html.replace(/\{\{+/g, (run) => '&#123;'.repeat(run.length));
}

/**
 * An `@font-face` rule reduced to one source: the woff2 one when there is one, else the first url().
 *
 * Sites list woff2, woff and ttf for old browsers, and embedding all three would triple the
 * cost of every font for a format nobody will pick. `local()` entries go too: the pasted page
 * runs on another machine, and a local face that happens to exist there would win over the
 * embedded one.
 */
export function preferFontSource(fontFace: string): string {
  return fontFace.replace(/(\bsrc\s*:\s*)([^;}]*)/i, (whole, lead: string, value: string) => {
    const entries = splitTopLevelCommas(value).filter((entry) => /\burl\(/i.test(entry));
    if (!entries.length) return whole;
    const chosen = entries.find((entry) => /woff2/i.test(entry)) ?? entries[0];
    return `${lead}${chosen}`;
  });
}
