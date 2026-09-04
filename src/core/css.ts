import { styleMirrorFor } from './mirror.js';
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
  /*
   * Both spellings of the same property, on purpose.
   *
   * `font-width` is what the spec calls it and `font-stretch` is the deprecated alias -- and yet
   * the alias is the one browsers actually support, so an author needs to be able to reach either.
   * Listing both is also what makes them findable: neither was in the catalogue, so searching
   * `font-stretch` found nothing and the panel had no control to offer for it.
   */
  { name: 'font-stretch', group: 'typography', control: 'length', keywords: ['normal', 'condensed', 'semi-condensed', 'expanded', 'semi-expanded', '50%', '100%', '200%'], hint: '50% - 200%' },
  { name: 'font-width', group: 'typography', control: 'length', keywords: ['normal', 'condensed', 'semi-condensed', 'expanded', 'semi-expanded', '50%', '100%', '200%'], hint: '50% - 200%' },
  { name: 'font-variant', group: 'typography', control: 'text', hint: 'small-caps' },
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
  /**
   * The part of a selector list that actually matched.
   *
   * `h1, .card p` tells the user very little about why it applies here; the one
   * compound that matched tells them everything.
   */
  matchedSelector?: string;
  /**
   * The state or pseudo-element this rule targets, e.g. `:hover`, `::before`.
   *
   * Only set for rules found by `stateRules`. Empty means the rule applies to the
   * element as it is right now, which is the only kind the cascade may consider.
   */
  pseudo?: string;
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
      /*
       * From the attribute, so this agrees with `inlineDeclarations`.
       *
       * Reading the CSSOM here and the attribute there meant one declaration written with a
       * legacy name appeared twice in the panel, once under the name the author used and once
       * under the name the browser prefers -- as though the element declared both.
       */
      declarations: toAppliedDeclarations(inlineDeclarations(el)),
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
  // A stand-in is a `<style>` with no href of its own, and reporting a rule's source
  // as "embedded" when it came out of `theme.css` would misdirect anyone reading the
  // cascade to find where a declaration lives.
  const href = styleMirrorFor(sheet)?.href ?? sheet.href;
  if (!href) return fallback;
  try {
    return new URL(href).pathname.split('/').pop() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param wantPseudo Collect only the rules that need a state or draw a
 * pseudo-element, instead of only the ones applying as the element stands.
 */
function walkRules(
  container: CSSStyleSheet | CSSGroupingRule,
  source: string,
  condition: string | undefined,
  el: HTMLElement,
  out: AppliedRule[],
  wantPseudo = false,
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
      const reach = reachesElement(el, rule.selectorText);
      if (!reach) continue;
      if (Boolean(reach.pseudo) !== wantPseudo) continue;
      out.push({
        selector: rule.selectorText,
        origin: 'stylesheet',
        source,
        specificity: specificityOf(rule.selectorText) + (condition ? 1 : 0),
        declarations: readDeclarations(rule.style),
        rule,
        condition,
        matchedSelector: reach.matchedSelector,
        pseudo: reach.pseudo || undefined,
      });
      continue;
    }
    if (rule instanceof CSSMediaRule) {
      if (!safeMatchMedia(rule.conditionText)) continue;
      walkRules(rule, source, `@media ${rule.conditionText}`, el, out, wantPseudo);
      continue;
    }
    if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
      walkRules(rule, source, `@container ${rule.conditionText}`, el, out, wantPseudo);
      continue;
    }
    if (rule instanceof CSSSupportsRule) {
      walkRules(rule, source, `@supports ${rule.conditionText}`, el, out, wantPseudo);
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

/**
 * Pseudo-classes that describe a passing state rather than a place in the tree.
 *
 * The distinction is what makes a rule findable. `el.matches('a:hover')` answers
 * "is this link hovered *right now*", which is false every time a panel asks, so
 * the rule styling a link's hover was invisible to the editor. Structural
 * pseudo-classes are the opposite: `:first-child` and `:nth-of-type()` are facts
 * about the element, so they stay in the selector and keep matching honest.
 */
const STATE_PSEUDO_CLASSES = new Set([
  'active', 'autofill', 'checked', 'default', 'disabled', 'enabled', 'focus',
  'focus-visible', 'focus-within', 'fullscreen', 'hover', 'in-range',
  'indeterminate', 'invalid', 'link', 'open', 'optional', 'out-of-range',
  'placeholder-shown', 'read-only', 'read-write', 'required', 'target',
  'user-invalid', 'user-valid', 'valid', 'visited',
]);

/** Pseudo-elements, including the four that predate the double colon. */
const PSEUDO_ELEMENTS = new Set([
  'after', 'backdrop', 'before', 'details-content', 'file-selector-button',
  'first-letter', 'first-line', 'grammar-error', 'marker', 'placeholder',
  'selection', 'spelling-error', 'target-text',
]);

/** Split a selector list on top-level commas, so `:is(a, b)` survives intact. */
function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of selectorText) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Peel the state and pseudo-element parts off one compound selector.
 *
 * Returns the selector that can still be tested against a live element, plus what
 * was removed, in source order — so `a:hover::before` reports `:hover::before` and
 * leaves `a` to match against.
 */
function peelPseudos(part: string): { base: string; pseudo: string } {
  let base = '';
  let pseudo = '';
  let index = 0;
  let depth = 0;
  while (index < part.length) {
    const ch = part[index];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch !== ':' || depth > 0) {
      base += ch;
      index += 1;
      continue;
    }
    const double = part[index + 1] === ':';
    const start = index + (double ? 2 : 1);
    let end = start;
    while (end < part.length && /[\w-]/.test(part[end])) end += 1;
    const name = part.slice(start, end).toLowerCase();
    // Any argument travels with the pseudo it belongs to.
    let argument = '';
    if (part[end] === '(') {
      let inner = 1;
      let cursor = end + 1;
      while (cursor < part.length && inner > 0) {
        if (part[cursor] === '(') inner += 1;
        if (part[cursor] === ')') inner -= 1;
        cursor += 1;
      }
      argument = part.slice(end, cursor);
      end = cursor;
    }
    const token = `${double ? '::' : ':'}${name}${argument}`;
    const isPseudoElement = double || PSEUDO_ELEMENTS.has(name);
    if (isPseudoElement || STATE_PSEUDO_CLASSES.has(name)) pseudo += token;
    else base += token;
    index = end;
  }
  return { base: base.trim(), pseudo };
}

/**
 * How a rule reaches this element, if it does.
 *
 * `pseudo` empty means the rule applies as the element stands. Anything else means
 * the rule waits for a state or draws a pseudo-element, which is exactly the set
 * the cascade must ignore and the panel must still offer.
 */
function reachesElement(
  el: HTMLElement,
  selectorText: string,
): { matchedSelector: string; pseudo: string } | null {
  for (const part of splitSelectorList(selectorText)) {
    const { base, pseudo } = peelPseudos(part);
    // A bare `::selection` or `:hover` has no base left and applies to anything.
    if (matches(el, base || '*')) return { matchedSelector: part, pseudo };
  }
  return null;
}

/**
 * Rules that target this element in a state it is not currently in, or through a
 * pseudo-element.
 *
 * Deliberately separate from `appliedRules`: these do not apply right now, so
 * letting them into the cascade would report a hover colour as the element's
 * current value. The panel shows them as their own, editable, group.
 */
export function stateRules(el: HTMLElement): AppliedRule[] {
  const rules: AppliedRule[] = [];
  for (const sheet of collectSheets(el)) {
    walkRules(sheet.sheet, sheet.label, undefined, el, rules, true);
  }
  rules.sort((a, b) => a.specificity - b.specificity);
  return rules;
}

/**
 * A rule's declarations, as they were authored.
 *
 * Parsed from `cssText` rather than read by index, because indexing expands every
 * shorthand and drops any it cannot: `overflow: hidden` enumerates as `overflow-x`
 * and `overflow-y` with no `overflow` at all, so a panel row for `overflow` found
 * nothing and showed the property as unset. `width: min(980px, calc(...))` fares
 * worse still — a var-bearing value is stored as a pending substitution that does
 * not enumerate.
 *
 * Longhands are still available where they matter: the style panel expands box
 * shorthands itself for the per-side editor.
 */
function readDeclarations(style: CSSStyleDeclaration): AppliedDeclaration[] {
  return toAppliedDeclarations(parseDeclarations(style.cssText));
}

/** The same shape, from declarations already parsed out of authored text. */
function toAppliedDeclarations(declarations: Record<string, string>): AppliedDeclaration[] {
  const out: AppliedDeclaration[] = [];
  for (const [property, raw] of Object.entries(declarations)) {
    const important = /!\s*important\s*$/i.test(raw);
    out.push({
      property,
      value: important ? raw.replace(/!\s*important\s*$/i, '').trim() : raw,
      important,
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

/**
 * What an element declares, as opposed to what it computes to.
 *
 * The distinction is the whole point when explaining why a size is not applying:
 * every laid-out element has a computed `width` in pixels, so only the declared
 * value tells you whether an author actually asked for one.
 */
export function declaredValues(el: HTMLElement): Map<string, { value: string; from: string }> {
  const out = new Map<string, { value: string; from: string }>();
  for (const [property, entry] of cascadedDeclarations(appliedRules(el))) {
    out.set(property, { value: entry.value, from: entry.from.selector });
  }
  return out;
}

export type SizeAxis = 'width' | 'height';

/** An ancestor declaration that limits how large the element can become. */
export interface SizeConstraint {
  /** The ancestor imposing the limit. */
  el: HTMLElement;
  axis: SizeAxis;
  property: string;
  /** The value as declared, e.g. `600px` or `hidden`. */
  value: string;
  /** Selector the declaration came from, for provenance. */
  from: string;
  /** How many levels above the element the ancestor sits. */
  depth: number;
  /** Content extent the ancestor leaves its children, in CSS pixels. */
  available: number;
  /** True when the element is already filling that extent, so the cap is active. */
  binding: boolean;
}

/** Properties that cap a child's extent, per axis. */
const CAPS: Record<SizeAxis, string[]> = {
  width: ['max-width', 'width', 'overflow-x', 'overflow'],
  height: ['max-height', 'height', 'overflow-y', 'overflow'],
};

/**
 * Ancestor declarations that stop the element from growing along one axis.
 *
 * Answers the question a designer actually asks — "I set a bigger width and
 * nothing happened" — by naming the element and the declaration responsible.
 * Only declared caps count: an ancestor that merely happens to be narrow because
 * *its* parent is narrow is not where the fix belongs, and reporting it would send
 * the user to the wrong place.
 *
 * `binding` separates "there is a cap somewhere above" from "that cap is what you
 * are hitting right now", which is what lets the UI stay quiet until it matters.
 */
export function sizeConstraints(el: HTMLElement, axis: SizeAxis, limit = 3): SizeConstraint[] {
  const extent = axis === 'width' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
  const out: SizeConstraint[] = [];

  let current = el.parentElement;
  let depth = 1;
  while (current && current !== document.documentElement && out.length < limit) {
    const declared = declaredValues(current);
    const available = contentExtent(current, axis);
    for (const property of CAPS[axis]) {
      const entry = declared.get(property);
      if (!entry) continue;
      if (!isCapping(property, entry.value)) continue;
      out.push({
        el: current,
        axis,
        property,
        value: entry.value,
        from: entry.from,
        depth,
        available,
        // Within a pixel of the space available is "flush against it"; subpixel
        // layout means an exact comparison would almost never be true.
        binding: extent >= available - 1,
      });
      break; // One reason per ancestor is enough; the first is the most specific.
    }
    current = current.parentElement;
    depth += 1;
  }
  return out;
}

/** True when this declaration actually limits children rather than just existing. */
function isCapping(property: string, value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text || text === 'auto' || text === 'none' || text === 'initial' || text === 'unset') {
    return false;
  }
  if (property.startsWith('overflow')) return text !== 'visible';
  // A percentage or `100%` width does not cap anything on its own; a length does.
  if (property === 'width' || property === 'height') return !text.endsWith('%');
  return true;
}

/** The space an element leaves its children along one axis, padding excluded. */
function contentExtent(el: HTMLElement, axis: SizeAxis): number {
  const style = getComputedStyle(el);
  if (axis === 'width') {
    const pad = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    return Math.max(0, el.clientWidth - (Number.isFinite(pad) ? pad : 0));
  }
  const pad = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  return Math.max(0, el.clientHeight - (Number.isFinite(pad) ? pad : 0));
}

/**
 * The parent properties that govern how much room this child gets.
 *
 * Tailored to the parent's own layout mode, because the useful set is completely
 * different: a flex row's `flex-wrap` and `gap` decide a child's width, while in a
 * grid it is the template that does. Showing all of them regardless would turn a
 * targeted answer back into a property dump.
 */
export function parentLayoutProperties(parent: HTMLElement): string[] {
  const display = getComputedStyle(parent).display;
  const common = ['display', 'width', 'max-width', 'padding', 'overflow'];

  if (display.includes('flex')) {
    return [
      'display',
      'flex-direction',
      'flex-wrap',
      'justify-content',
      'align-items',
      'gap',
      'width',
      'max-width',
      'padding',
      'overflow',
    ];
  }
  if (display.includes('grid')) {
    return [
      'display',
      'grid-template-columns',
      'grid-auto-flow',
      'justify-items',
      'align-items',
      'gap',
      'width',
      'max-width',
      'padding',
      'overflow',
    ];
  }
  return common;
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
 * The element's inline declarations, as authored.
 *
 * Read from the `style` *attribute* rather than from `style.cssText`. The two are usually the
 * same string, and where they differ the attribute is the honest one: `cssText` is serialised
 * back out of the CSSOM, which canonicalises a family of legacy property names on the way in --
 * `word-wrap` to `overflow-wrap`, `grid-gap` to `gap`, `-webkit-transform` to `transform`,
 * `font-stretch` to `font-width` in recent builds. Reading the attribute is what lets a panel
 * show, and an extracted class carry, the name the author actually wrote.
 *
 * Parsed as text rather than indexed either way, because indexing into `style` misses shorthands
 * whose value contains `var()`: the browser stores those as a pending-substitution value that
 * does not enumerate as its longhands, so `padding: var(--space-lg)` is invisible to an index
 * walk.
 */
export function inlineDeclarations(el: HTMLElement): Record<string, string> {
  return parseDeclarations(el.getAttribute('style') ?? '');
}

/**
 * Declarations from serialized CSS text, as authored.
 *
 * The alternative — indexing into a `CSSStyleDeclaration` — expands every
 * shorthand, so one `background: #fff` comes back as eight longhands and
 * `padding: var(--x)` comes back as nothing at all, because the browser stores a
 * var-bearing shorthand as a pending-substitution value that does not enumerate.
 * Parsing the text keeps what the author wrote, which is what belongs in an
 * editor and in an exported rule.
 */
export function parseDeclarations(cssText: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cssText?.trim()) return out;

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

/**
 * A CSS function taken apart, so a form can be offered for it.
 *
 * `operators` is what separates the two shapes a function comes in. `clamp`, `min` and `max` take a
 * comma-separated list, so it is empty. `calc` takes an expression, so it holds the arithmetic
 * between the parts and is one shorter than `parts`.
 */
export interface CssFunctionParts {
  name: string;
  parts: string[];
  operators: string[];
}

/** Operators `calc()` accepts. `+` and `-` require surrounding whitespace; the spec says so. */
const CALC_SPLIT = /\s+([+\-])\s+|\s*([*/])\s*/;

/**
 * Take a function value apart, or null when it is not one of `allowed`.
 *
 * Split on top-level separators so a nested function survives: `clamp(1rem, calc(2vw + 1rem), 3rem)`
 * has three parts, not four. A part count the function cannot accept returns null rather than being
 * reinterpreted -- a `clamp` with two arguments is something the author wrote, not something to
 * guess at.
 */
export function parseCssFunction(
  value: string,
  allowed: readonly string[] = ['clamp', 'min', 'max', 'calc'],
): CssFunctionParts | null {
  const match = /^\s*([a-z-]+)\s*\((.*)\)\s*$/is.exec(String(value ?? '').trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (!allowed.includes(name)) return null;
  const inner = match[2];

  if (name === 'calc') {
    const parts: string[] = [];
    const operators: string[] = [];
    let current = '';
    let depth = 0;
    for (let index = 0; index < inner.length; index += 1) {
      const ch = inner[index];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0) {
        const rest = inner.slice(index);
        const hit = CALC_SPLIT.exec(rest);
        if (hit && hit.index === 0) {
          parts.push(current.trim());
          operators.push(hit[1] ?? hit[2]);
          index += hit[0].length - 1;
          current = '';
          continue;
        }
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    if (parts.length < 2) return null;
    return { name, parts, operators };
  }

  const parts = splitTopLevelCommas(inner);
  if (name === 'clamp' && parts.length !== 3) return null;
  if (parts.length < 2) return null;
  return { name, parts, operators: [] };
}

/** Put one back together, as it will be written. */
export function formatCssFunction(fn: CssFunctionParts): string {
  const parts = fn.parts.map((part) => part.trim()).filter(Boolean);
  if (fn.operators.length) {
    const body = parts.reduce(
      (text, part, index) => (index === 0 ? part : `${text} ${fn.operators[index - 1] ?? '+'} ${part}`),
      '',
    );
    return `${fn.name}(${body})`;
  }
  return `${fn.name}(${parts.join(', ')})`;
}

/**
 * Split on commas that are not inside brackets.
 *
 * The counterpart to `splitTopLevel`, which splits on whitespace. Needed separately because a CSS
 * function's arguments are comma-separated and its own arguments may be functions.
 */
export function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of String(value ?? '')) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
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
