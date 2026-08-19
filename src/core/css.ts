import type { TokenGroup } from './types.js';

/**
 * CSS introspection and the property catalogue that drives the style editor.
 *
 * Two jobs live here. First, working out what CSS actually applies to an
 * element — including rules from shadow roots and adopted stylesheets, which
 * `document.styleSheets` never lists. Second, describing properties well enough
 * that the UI can pick the right control and offer sensible completions.
 */

/* -------------------------------------------------------------------------- */
/* Property catalogue                                                          */
/* -------------------------------------------------------------------------- */

export type ControlType =
  | 'length'
  | 'color'
  | 'keyword'
  | 'number'
  | 'text'
  | 'box'
  | 'font'
  | 'shadow';

export type PropertyGroup =
  | 'layout'
  | 'flex'
  | 'grid'
  | 'spacing'
  | 'size'
  | 'typography'
  | 'appearance'
  | 'border'
  | 'effects'
  | 'media'
  | 'transition';

export interface PropertyMeta {
  name: string;
  group: PropertyGroup;
  control: ControlType;
  /** Allowed keywords, offered first in the autocomplete list. */
  keywords?: string[];
  /** Token group whose values make sense here. */
  tokens?: TokenGroup;
  /** Shown as placeholder / hint text. */
  hint?: string;
}

const K = {
  display: [
    'block',
    'inline',
    'inline-block',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'contents',
    'flow-root',
    'none',
  ],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  overflow: ['visible', 'hidden', 'clip', 'scroll', 'auto'],
  justify: [
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
    'start',
    'end',
    'stretch',
  ],
  align: ['stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end'],
  wrap: ['nowrap', 'wrap', 'wrap-reverse'],
  direction: ['row', 'row-reverse', 'column', 'column-reverse'],
  objectFit: ['fill', 'contain', 'cover', 'none', 'scale-down'],
  textAlign: ['start', 'end', 'left', 'right', 'center', 'justify'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'],
  borderStyle: ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'],
  auto: ['auto'],
  sizing: ['auto', 'min-content', 'max-content', 'fit-content', '100%'],
} as const;

/**
 * The catalogue. Ordered within groups so the style panel reads top-to-bottom
 * the way a designer thinks: what kind of box, then where, then how big, then
 * how it looks.
 */
export const CSS_PROPERTIES: PropertyMeta[] = [
  // Layout
  { name: 'display', group: 'layout', control: 'keyword', keywords: [...K.display] },
  { name: 'position', group: 'layout', control: 'keyword', keywords: [...K.position] },
  { name: 'top', group: 'layout', control: 'length', tokens: 'space' },
  { name: 'right', group: 'layout', control: 'length', tokens: 'space' },
  { name: 'bottom', group: 'layout', control: 'length', tokens: 'space' },
  { name: 'left', group: 'layout', control: 'length', tokens: 'space' },
  { name: 'z-index', group: 'layout', control: 'number' },
  { name: 'overflow', group: 'layout', control: 'keyword', keywords: [...K.overflow] },
  { name: 'overflow-x', group: 'layout', control: 'keyword', keywords: [...K.overflow] },
  { name: 'overflow-y', group: 'layout', control: 'keyword', keywords: [...K.overflow] },
  { name: 'float', group: 'layout', control: 'keyword', keywords: ['none', 'left', 'right'] },
  { name: 'isolation', group: 'layout', control: 'keyword', keywords: ['auto', 'isolate'] },

  // Flex
  { name: 'flex-direction', group: 'flex', control: 'keyword', keywords: [...K.direction] },
  { name: 'flex-wrap', group: 'flex', control: 'keyword', keywords: [...K.wrap] },
  { name: 'justify-content', group: 'flex', control: 'keyword', keywords: [...K.justify] },
  { name: 'align-items', group: 'flex', control: 'keyword', keywords: [...K.align] },
  { name: 'align-content', group: 'flex', control: 'keyword', keywords: [...K.justify] },
  { name: 'align-self', group: 'flex', control: 'keyword', keywords: ['auto', ...K.align] },
  { name: 'flex', group: 'flex', control: 'text', hint: '1 1 auto' },
  { name: 'flex-grow', group: 'flex', control: 'number' },
  { name: 'flex-shrink', group: 'flex', control: 'number' },
  { name: 'flex-basis', group: 'flex', control: 'length', tokens: 'size' },
  { name: 'order', group: 'flex', control: 'number' },
  { name: 'gap', group: 'flex', control: 'length', tokens: 'space' },
  { name: 'row-gap', group: 'flex', control: 'length', tokens: 'space' },
  { name: 'column-gap', group: 'flex', control: 'length', tokens: 'space' },

  // Grid
  { name: 'grid-template-columns', group: 'grid', control: 'text', hint: 'repeat(3, minmax(0, 1fr))' },
  { name: 'grid-template-rows', group: 'grid', control: 'text', hint: 'auto' },
  { name: 'grid-template-areas', group: 'grid', control: 'text' },
  { name: 'grid-auto-flow', group: 'grid', control: 'keyword', keywords: ['row', 'column', 'dense', 'row dense', 'column dense'] },
  { name: 'grid-auto-rows', group: 'grid', control: 'text', hint: 'minmax(120px, auto)' },
  { name: 'grid-column', group: 'grid', control: 'text', hint: 'span 2' },
  { name: 'grid-row', group: 'grid', control: 'text', hint: 'span 2' },
  { name: 'place-items', group: 'grid', control: 'keyword', keywords: ['center', 'start', 'end', 'stretch'] },
  { name: 'place-content', group: 'grid', control: 'keyword', keywords: ['center', 'start', 'end', 'space-between'] },

  // Spacing
  { name: 'margin', group: 'spacing', control: 'box', tokens: 'space' },
  { name: 'padding', group: 'spacing', control: 'box', tokens: 'space' },

  // Size
  { name: 'width', group: 'size', control: 'length', tokens: 'size', keywords: [...K.sizing] },
  { name: 'height', group: 'size', control: 'length', tokens: 'size', keywords: [...K.sizing] },
  { name: 'min-width', group: 'size', control: 'length', tokens: 'size', keywords: [...K.sizing] },
  { name: 'min-height', group: 'size', control: 'length', tokens: 'size', keywords: [...K.sizing] },
  { name: 'max-width', group: 'size', control: 'length', tokens: 'size', keywords: ['none', ...K.sizing] },
  { name: 'max-height', group: 'size', control: 'length', tokens: 'size', keywords: ['none', ...K.sizing] },
  { name: 'aspect-ratio', group: 'size', control: 'text', hint: '16 / 9' },
  { name: 'box-sizing', group: 'size', control: 'keyword', keywords: ['content-box', 'border-box'] },

  // Typography
  { name: 'color', group: 'typography', control: 'color', tokens: 'color' },
  { name: 'font-family', group: 'typography', control: 'font', tokens: 'font' },
  { name: 'font-size', group: 'typography', control: 'length', tokens: 'size' },
  { name: 'font-weight', group: 'typography', control: 'keyword', keywords: [...K.weight] },
  { name: 'font-style', group: 'typography', control: 'keyword', keywords: ['normal', 'italic', 'oblique'] },
  { name: 'line-height', group: 'typography', control: 'length', tokens: 'size', hint: '1.5' },
  { name: 'letter-spacing', group: 'typography', control: 'length', keywords: ['normal'] },
  { name: 'word-spacing', group: 'typography', control: 'length', keywords: ['normal'] },
  { name: 'text-align', group: 'typography', control: 'keyword', keywords: [...K.textAlign] },
  { name: 'text-transform', group: 'typography', control: 'keyword', keywords: ['none', 'uppercase', 'lowercase', 'capitalize'] },
  { name: 'text-decoration', group: 'typography', control: 'text', hint: 'underline' },
  { name: 'text-wrap', group: 'typography', control: 'keyword', keywords: ['wrap', 'nowrap', 'balance', 'pretty'] },
  { name: 'white-space', group: 'typography', control: 'keyword', keywords: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'] },
  { name: 'text-overflow', group: 'typography', control: 'keyword', keywords: ['clip', 'ellipsis'] },

  // Appearance
  { name: 'background-color', group: 'appearance', control: 'color', tokens: 'color' },
  { name: 'background', group: 'appearance', control: 'text', hint: 'linear-gradient(...)' },
  { name: 'background-image', group: 'appearance', control: 'text', hint: 'url(...)' },
  { name: 'background-size', group: 'appearance', control: 'keyword', keywords: ['auto', 'cover', 'contain'] },
  { name: 'background-position', group: 'appearance', control: 'text', hint: 'center' },
  { name: 'background-repeat', group: 'appearance', control: 'keyword', keywords: ['repeat', 'no-repeat', 'repeat-x', 'repeat-y'] },
  { name: 'opacity', group: 'appearance', control: 'number', hint: '0 – 1' },
  { name: 'cursor', group: 'appearance', control: 'keyword', keywords: ['auto', 'default', 'pointer', 'text', 'move', 'grab', 'not-allowed', 'wait'] },

  // Border
  { name: 'border-radius', group: 'border', control: 'box', tokens: 'radius' },
  { name: 'border-width', group: 'border', control: 'length', tokens: 'border' },
  { name: 'border-style', group: 'border', control: 'keyword', keywords: [...K.borderStyle] },
  { name: 'border-color', group: 'border', control: 'color', tokens: 'color' },
  { name: 'border', group: 'border', control: 'text', hint: '1px solid var(--border)' },
  { name: 'outline', group: 'border', control: 'text', hint: '2px solid' },
  { name: 'outline-offset', group: 'border', control: 'length' },

  // Effects
  { name: 'box-shadow', group: 'effects', control: 'shadow', tokens: 'shadow' },
  { name: 'text-shadow', group: 'effects', control: 'text', hint: '0 1px 2px rgb(0 0 0 / .2)' },
  { name: 'filter', group: 'effects', control: 'text', hint: 'blur(4px)' },
  { name: 'backdrop-filter', group: 'effects', control: 'text', hint: 'blur(12px)' },
  { name: 'transform', group: 'effects', control: 'text', hint: 'translateY(-2px)' },
  { name: 'transform-origin', group: 'effects', control: 'text', hint: 'center' },
  { name: 'mix-blend-mode', group: 'effects', control: 'keyword', keywords: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'] },

  // Media
  { name: 'object-fit', group: 'media', control: 'keyword', keywords: [...K.objectFit] },
  { name: 'object-position', group: 'media', control: 'text', hint: 'center' },
  { name: 'image-rendering', group: 'media', control: 'keyword', keywords: ['auto', 'smooth', 'crisp-edges', 'pixelated'] },

  // Transition
  { name: 'transition', group: 'transition', control: 'text', tokens: 'motion', hint: 'all .2s ease' },
  { name: 'transition-property', group: 'transition', control: 'text', hint: 'opacity, transform' },
  { name: 'transition-duration', group: 'transition', control: 'length', tokens: 'motion', hint: '200ms' },
  { name: 'transition-timing-function', group: 'transition', control: 'keyword', keywords: ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'cubic-bezier(.4,0,.2,1)'] },
  { name: 'animation', group: 'transition', control: 'text' },
  { name: 'will-change', group: 'transition', control: 'keyword', keywords: ['auto', 'transform', 'opacity'] },
];

const PROPERTY_INDEX = new Map(CSS_PROPERTIES.map((meta) => [meta.name, meta]));

export const PROPERTY_GROUP_LABELS: Record<PropertyGroup, string> = {
  layout: 'Layout',
  flex: 'Flex',
  grid: 'Grid',
  spacing: 'Spacing',
  size: 'Size',
  typography: 'Typography',
  appearance: 'Appearance',
  border: 'Border',
  effects: 'Effects',
  media: 'Media',
  transition: 'Motion',
};

export function propertyMeta(name: string): PropertyMeta {
  return (
    PROPERTY_INDEX.get(name) ?? {
      name,
      group: 'appearance',
      control: inferControl(name),
      tokens: inferTokenGroup(name),
    }
  );
}

function inferControl(name: string): ControlType {
  if (/color$/.test(name) || name === 'fill' || name === 'stroke') return 'color';
  if (/(?:width|height|size|gap|spacing|radius|offset|inset|top|left|right|bottom)$/.test(name)) {
    return 'length';
  }

  if (/^(?:opacity|order|flex-grow|flex-shrink|z-index)$/.test(name)) return 'number';
  return 'text';
}

function inferTokenGroup(name: string): TokenGroup | undefined {
  if (/color$/.test(name) || name === 'fill' || name === 'stroke') return 'color';
  if (/radius/.test(name)) return 'radius';
  if (/shadow/.test(name)) return 'shadow';
  if (/(?:margin|padding|gap|inset)/.test(name)) return 'space';
  if (/(?:width|height|size)/.test(name)) return 'size';
  if (/font/.test(name)) return 'font';
  if (/(?:duration|delay|transition|animation)/.test(name)) return 'motion';
  return undefined;
}

/** Properties whose names contain `query`, ranked prefix-first. */
export function searchProperties(query: string, limit = 12): PropertyMeta[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return CSS_PROPERTIES.slice(0, limit);
  const prefix: PropertyMeta[] = [];
  const contains: PropertyMeta[] = [];
  for (const meta of CSS_PROPERTIES) {
    if (meta.name.startsWith(needle)) prefix.push(meta);
    else if (meta.name.includes(needle)) contains.push(meta);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Applied rules                                                               */
/* -------------------------------------------------------------------------- */

export interface AppliedDeclaration {
  property: string;
  value: string;
  important: boolean;
}

export interface AppliedRule {
  /** `inline` for the style attribute, otherwise the selector text. */
  selector: string;
  origin: 'inline' | 'stylesheet';
  /** File name or `embedded` / `adopted`. */
  source: string;
  specificity: number;
  declarations: AppliedDeclaration[];
  /** The live rule, so the tokens panel can write back into it. */
  rule?: CSSStyleRule;
  /** Media/container query text this rule sits inside, when any. */
  condition?: string;
}

/**
 * Every rule that matches the element, most specific last.
 *
 * Shadow roots carry their own `styleSheets` and `adoptedStyleSheets` — the
 * latter is where Lit's `static styles` lands, and neither shows up in
 * `document.styleSheets`. Missing them means missing most of the CSS on a page
 * built from web components.
 */
export function appliedRules(el: HTMLElement): AppliedRule[] {
  const rules: AppliedRule[] = [];

  for (const sheet of collectSheets(el)) {
    walkRules(sheet.sheet, sheet.label, undefined, el, rules);
  }

  rules.sort((a, b) => a.specificity - b.specificity);

  if (el.style.length > 0) {
    rules.push({
      selector: 'style attribute',
      origin: 'inline',
      source: 'inline',
      specificity: 10_000,
      declarations: readDeclarations(el.style),
    });
  }
  return rules;
}

interface LabelledSheet {
  sheet: CSSStyleSheet;
  label: string;
}

function collectSheets(el: HTMLElement): LabelledSheet[] {
  const out: LabelledSheet[] = [];
  const push = (sheet: CSSStyleSheet, fallback: string): void => {
    out.push({ sheet, label: sheetLabel(sheet, fallback) });
  };

  for (const sheet of Array.from(document.styleSheets)) {
    // The editor's own behavioural CSS is not part of the user's cascade.
    if (sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-internal')) {
      continue;
    }
    push(sheet, 'embedded');
  }

  for (const sheet of document.adoptedStyleSheets ?? []) push(sheet, 'adopted');

  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    for (const sheet of Array.from(root.styleSheets)) push(sheet, 'shadow');
    for (const sheet of root.adoptedStyleSheets ?? []) push(sheet, 'shadow (adopted)');
  }
  return out;
}

function sheetLabel(sheet: CSSStyleSheet, fallback: string): string {
  if (!sheet.href) return fallback;
  try {
    return new URL(sheet.href).pathname.split('/').pop() || fallback;
  } catch {
    return fallback;
  }
}

function walkRules(
  container: CSSStyleSheet | CSSGroupingRule,
  source: string,
  condition: string | undefined,
  el: HTMLElement,
  out: AppliedRule[],
): void {
  let list: CSSRuleList;
  try {
    list = container.cssRules;
  } catch {
    // Cross-origin stylesheet: unreadable by design.
    return;
  }

  for (const rule of Array.from(list)) {
    if (rule instanceof CSSStyleRule) {
      if (!matches(el, rule.selectorText)) continue;
      out.push({
        selector: rule.selectorText,
        origin: 'stylesheet',
        source,
        specificity: specificityOf(rule.selectorText) + (condition ? 1 : 0),
        declarations: readDeclarations(rule.style),
        rule,
        condition,
      });
      continue;
    }
    if (rule instanceof CSSMediaRule) {
      if (!safeMatchMedia(rule.conditionText)) continue;
      walkRules(rule, source, `@media ${rule.conditionText}`, el, out);
      continue;
    }
    if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
      walkRules(rule, source, `@container ${rule.conditionText}`, el, out);
      continue;
    }
    if (rule instanceof CSSSupportsRule) {
      walkRules(rule, source, `@supports ${rule.conditionText}`, el, out);
    }
  }
}

function safeMatchMedia(condition: string): boolean {
  try {
    return matchMedia(condition).matches;
  } catch {
    return true;
  }
}

function matches(el: HTMLElement, selectorText: string): boolean {
  // `:host`, `::part()` and friends throw on plain elements.
  try {
    return el.matches(selectorText);
  } catch {
    return false;
  }
}

function readDeclarations(style: CSSStyleDeclaration): AppliedDeclaration[] {
  const out: AppliedDeclaration[] = [];
  for (let i = 0; i < style.length; i += 1) {
    const property = style[i];
    out.push({
      property,
      value: style.getPropertyValue(property).trim(),
      important: style.getPropertyPriority(property) === 'important',
    });
  }
  return out;
}

/** Approximate CSS specificity, good enough to order the rule list. */
export function specificityOf(selectorText: string): number {
  // Take the winning compound of a selector list.
  const parts = selectorText.split(',').map((part) => part.trim());
  let best = 0;
  for (const part of parts) {
    const ids = (part.match(/#[\w-]+/g) ?? []).length;
    const classes = (part.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const elements = (part.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
    best = Math.max(best, ids * 100 + classes * 10 + elements);
  }
  return best;
}

/**
 * The declarations that actually win, property by property, after the cascade.
 * Later rules in `appliedRules` order override earlier ones.
 */
export function cascadedDeclarations(rules: AppliedRule[]): Map<string, AppliedDeclaration & { from: AppliedRule }> {
  const winner = new Map<string, AppliedDeclaration & { from: AppliedRule }>();
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      const current = winner.get(declaration.property);
      if (current?.important && !declaration.important) continue;
      winner.set(declaration.property, { ...declaration, from: rule });
    }
  }
  return winner;
}

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

export interface ParsedLength {
  number: number;
  unit: string;
}

const LENGTH_UNITS = [
  'px',
  'rem',
  'em',
  '%',
  'vw',
  'vh',
  'svh',
  'dvh',
  'ch',
  'fr',
  'ms',
  's',
  'deg',
  'pt',
];

export function parseLength(value: string): ParsedLength | null {
  const match = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return null;
  return { number, unit: match[2] || '' };
}

export function formatLength(number: number, unit: string): string {
  const rounded = Math.round(number * 1000) / 1000;
  return unit ? `${rounded}${unit}` : String(rounded);
}

export function nextUnit(unit: string, direction: 1 | -1): string {
  const index = LENGTH_UNITS.indexOf(unit || 'px');
  const next = (index + direction + LENGTH_UNITS.length) % LENGTH_UNITS.length;
  return LENGTH_UNITS[next];
}

export const AVAILABLE_UNITS = LENGTH_UNITS;

/** True when the value references a custom property. */
export function isTokenValue(value: string): boolean {
  return /var\(\s*--[\w-]+/.test(value);
}

/** Token names referenced by a value, without the leading `--`. */
export function tokensInValue(value: string): string[] {
  return Array.from(String(value ?? '').matchAll(/var\(\s*--([\w-]+)/g)).map((match) => match[1]);
}

/**
 * Split a box shorthand into four sides.
 *
 * Accepts anything the browser accepts, including `var()` values, by splitting
 * on top-level whitespace so `var(--a, 1px) 2px` yields two parts, not three.
 */
export function splitBoxValue(value: string): [string, string, string, string] {
  const parts = splitTopLevel(String(value ?? '').trim());
  if (parts.length === 0) return ['', '', '', ''];
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** Recombine four sides into the shortest equivalent shorthand. */
export function joinBoxValue(sides: [string, string, string, string]): string {
  const [top, right, bottom, left] = sides.map((side) => side.trim() || '0') as [
    string,
    string,
    string,
    string,
  ];
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

/**
 * The element's inline declarations, parsed from `cssText`.
 *
 * Indexing into `style` misses shorthands whose value contains `var()`: the
 * browser stores those as a pending-substitution value that does not enumerate
 * as its longhands, so `padding: var(--space-lg)` is invisible to an index walk.
 * Parsing the serialized text keeps declarations exactly as they were authored,
 * which is also what should end up in an extracted class.
 */
export function inlineDeclarations(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  const cssText = el.style.cssText;
  if (!cssText.trim()) return out;

  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (const ch of cssText) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) parts.push(current);

  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const property = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (property && value) out[property] = value;
  }
  return out;
}

/** Split on whitespace that is not inside parentheses. */
export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  if (current) parts.push(current);
  return parts;
}

/** Resolve a value that may be a `var()` reference against the element. */
export function resolveValue(el: HTMLElement, value: string): string {
  if (!isTokenValue(value)) return value;
  const names = tokensInValue(value);
  if (!names.length) return value;
  const computed = getComputedStyle(el);
  let out = value;
  for (const name of names) {
    const resolved = computed.getPropertyValue(`--${name}`).trim();
    if (resolved) out = out.replace(new RegExp(`var\\(\\s*--${escapeRegExp(name)}[^)]*\\)`), resolved);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when a string looks like a colour the browser will accept. */
export function isColorValue(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^(?:#|rgb|hsl|oklch|oklab|lab|lch|color-mix|color\()/i.test(text)) return true;
  if (isTokenValue(text)) return true;
  return CSS.supports('color', text);
}

/**
 * A detached 2D canvas context, used to normalise colours.
 *
 * The obvious implementation — insert a probe element, read its computed colour,
 * remove it — mutates the document on every call. That is unacceptable here: the
 * editor watches the page with a MutationObserver, so a probe inserted during
 * render triggers a re-render, which probes again. A canvas context normalises
 * any CSS colour with no DOM involvement at all.
 */
let colorContext: CanvasRenderingContext2D | null | undefined;

function colorProbe(): CanvasRenderingContext2D | null {
  if (colorContext === undefined) {
    try {
      colorContext = document.createElement('canvas').getContext('2d');
    } catch {
      colorContext = null;
    }
  }
  return colorContext;
}

/** Convert any CSS colour to `#rrggbb`, for `<input type="color">`. */
export function toHexColor(value: string, fallback = '#000000'): string {
  const text = value.trim();
  if (!text) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text
      .slice(1)
      .split('')
      .map((ch) => ch + ch)
      .join('')}`.toLowerCase();
  }

  const ctx = colorProbe();
  if (!ctx) return fallback;

  // An invalid assignment leaves `fillStyle` untouched, so probing from two
  // different starting colours is how an unparseable value is detected.
  ctx.fillStyle = '#000000';
  ctx.fillStyle = text;
  const fromBlack = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = text;
  const fromWhite = ctx.fillStyle;
  if (typeof fromBlack !== 'string' || fromBlack !== fromWhite) return fallback;

  if (/^#[0-9a-f]{6}$/i.test(fromBlack)) return fromBlack.toLowerCase();
  const match = /rgba?\(([^)]+)\)/i.exec(fromBlack);
  if (!match) return fallback;
  const [r, g, b] = match[1]
    .split(/[,\s/]+/)
    .slice(0, 3)
    .map((part) => Math.max(0, Math.min(255, Math.round(Number.parseFloat(part)))));
  if (![r, g, b].every(Number.isFinite)) return fallback;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
