/**
 * Width-relative viewport units at a previewed width.
 *
 * A viewport preview narrows the root to the previewed width, but `vw` (and `vi`, `vmin`, `vmax`
 * and their `s`/`l`/`d` forms) still resolve against the real window: a `clamp(1rem, 5vw, 3rem)`
 * heading at a 320 phone preview in a 1440 window renders at 3rem, not at 1rem. CSS has no way to
 * point those units at another box, so the values are restated in px.
 *
 * Nothing the page owns is touched. The restatement lives in one internal sheet, last in the
 * document, holding a twin of every declaration of every longhand that has a width unit anywhere,
 * width unit or not, in cascade order and under its own selector, nesting, `@layer`, `@supports`,
 * `@container` and `@scope`. Because every competitor for such a longhand is restated, in the
 * order and with the specificity it had, the twins resolve exactly as the originals did, only with
 * the units at the preview width. A longhand nothing writes in a width unit is left out entirely.
 *
 * Inline values are restated as `!important` under a zero-specificity path selector, first in the
 * sheet. That keeps the order inline values have against rules: they beat every normal
 * declaration, and every important declaration of the same longhand beats them, because that
 * declaration's own twin comes later with at least zero specificity.
 *
 * Height units (`vh`, `vb`) are left alone: the previewed frame is as tall as the window, so the
 * window's height is the frame's. `vmin` and `vmax` keep a live `1vh` for the same reason.
 *
 * Measured limits: `@keyframes` keep the window's width, anonymous `@layer` blocks are not
 * restated, an inline `!important` width-unit value cannot be outranked, and sheets inside shadow
 * roots or from another origin are out of reach, as they are for media queries.
 */

import { absolutizeCssUrls } from './css-urls.js';
import { isEditorOwned } from './dom-journal.js';

/** The internal sheet's id. */
export const UNITS_SHEET_ID = 'heo-viewport-units';

/** One declaration as the twin restates it. */
interface Twin {
  /** The name written: a longhand, or a shorthand whose value waits on a `var()`. */
  name: string;
  /** The longhands it sets, which is how it competes with other declarations. */
  longhands: readonly string[];
  value: string;
  important: boolean;
  /** Whether `value` has a width unit to restate. */
  units: boolean;
}

/** One style rule's (or nested declaration block's) declarations, with where they sit. */
interface Block {
  /** Outermost first: preludes and selectors, each opening one brace. */
  chain: readonly string[];
  twins: Twin[];
  /** What a relative `url()` in the value resolves against, when it is not the document. */
  base: string | null;
}

/** Inline declarations of one element, under its path. */
interface InlineBlock {
  selector: string;
  twins: Twin[];
}

/** Quick test, before any scanning. */
const HAS_UNIT = /\d(?:[sld]?)(?:vw|vi|vmin|vmax)(?![\w-])/i;

/** A number with a width unit, not inside an identifier. */
const UNIT = /(^|[^\w.\\-])([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)[sld]?(vw|vi|vmin|vmax)(?![\w-])/gi;

/** Whether `value` uses a width-relative viewport unit outside strings and `url()`. */
export function hasWidthUnits(value: string): boolean {
  if (!HAS_UNIT.test(value)) return false;
  let found = false;
  mapOutsideStrings(value, (text) => {
    UNIT.lastIndex = 0;
    if (UNIT.test(text)) found = true;
    return text;
  });
  return found;
}

/**
 * `value` with every width unit restated for a `width`-px viewport.
 *
 * `5vw` at 320 becomes `16px`, which `calc()`, `clamp()`, `min()` and `max()` all accept in place.
 * `vmin`/`vmax` become `calc(n * min(3.2px, 1vh))`, keeping the window's height live.
 */
export function restateWidthUnits(value: string, width: number): string {
  if (!HAS_UNIT.test(value)) return value;
  const perUnit = width / 100;
  return mapOutsideStrings(value, (text) =>
    text.replace(UNIT, (_match, before: string, number: string, unit: string) => {
      const n = Number(number);
      const kind = unit.toLowerCase();
      if (kind === 'vmin' || kind === 'vmax') {
        const fn = kind === 'vmin' ? 'min' : 'max';
        return `${before}calc(${n} * ${fn}(${round(perUnit)}px, 1vh))`;
      }
      return `${before}${round(n * perUnit)}px`;
    }));
}

function round(n: number): number {
  return Number(n.toFixed(4));
}

/**
 * Apply `map` to the parts of `value` outside quoted strings and `url(…)`.
 *
 * A file called `5vw.png` or a `content: "50vw"` is text, not a length.
 */
function mapOutsideStrings(value: string, map: (text: string) => string): string {
  let out = '';
  let plain = '';
  let i = 0;
  const flush = (): void => {
    if (plain) out += map(plain);
    plain = '';
  };
  while (i < value.length) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      flush();
      let j = i + 1;
      while (j < value.length && value[j] !== ch) j += value[j] === '\\' ? 2 : 1;
      out += value.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (
      (ch === 'u' || ch === 'U') &&
      /^url\(/i.test(value.slice(i, i + 4)) &&
      (i === 0 || !/[\w-]/.test(value[i - 1]))
    ) {
      flush();
      const close = value.indexOf(')', i);
      const end = close === -1 ? value.length : close + 1;
      out += value.slice(i, end);
      i = end;
      continue;
    }
    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reading declarations                                                        */
/* -------------------------------------------------------------------------- */

/** A shorthand's longhands, as this browser expands it. */
const expansions = new Map<string, readonly string[]>();
let scratch: CSSStyleDeclaration | null = null;

function longhandsOfShorthand(name: string): readonly string[] {
  const known = expansions.get(name);
  if (known) return known;
  scratch ??= document.createElement('div').style;
  scratch.cssText = '';
  scratch.setProperty(name, 'initial');
  const out = Array.from(scratch);
  scratch.cssText = '';
  expansions.set(name, out);
  return out;
}

/** Split declaration text at top-level semicolons; enough for the pending shorthands below. */
function declarationsOf(cssText: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let quote = '';
  let current = '';
  const push = (): void => {
    const colon = current.indexOf(':');
    if (colon > 0) out.push([current.slice(0, colon).trim().toLowerCase(), current.slice(colon + 1).trim()]);
    current = '';
  };
  for (const ch of cssText) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      push();
      continue;
    }
    current += ch;
  }
  push();
  return out;
}

/**
 * A declaration block's declarations, as longhands where the CSSOM can say.
 *
 * A shorthand whose value holds a `var()` is stored as a pending substitution: its longhands read
 * as empty, so it is read back from the block's text and restated whole, competing for exactly the
 * longhands that read empty.
 */
function readTwins(style: CSSStyleDeclaration): Twin[] {
  const out: Twin[] = [];
  const names = Array.from(style);
  const pending = new Set<string>();
  for (const name of names) {
    const value = style.getPropertyValue(name);
    if (!value) {
      pending.add(name);
      continue;
    }
    out.push({
      name,
      longhands: [name],
      value,
      important: style.getPropertyPriority(name) === 'important',
      units: hasWidthUnits(value),
    });
  }
  if (pending.size) {
    for (const [name, raw] of declarationsOf(style.cssText)) {
      if (names.includes(name) || name.startsWith('--')) continue;
      const longhands = longhandsOfShorthand(name).filter((one) => pending.has(one));
      if (!longhands.length) continue;
      const important = /!\s*important\s*$/i.test(raw);
      const value = raw.replace(/!\s*important\s*$/i, '').trim();
      out.push({ name, longhands, value, important, units: hasWidthUnits(value) });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Collecting the page                                                         */
/* -------------------------------------------------------------------------- */

/** What a `<style>` or `<link>` resolves `url()` against, when it differs from the document. */
function baseOf(sheet: CSSStyleSheet, fallback: string | null): string | null {
  return sheet.href ?? fallback;
}

/** An at-rule's prelude, up to its brace. */
function preludeOf(rule: CSSRule): string | null {
  let css = '';
  try {
    css = rule.cssText;
  } catch {
    return null;
  }
  const brace = css.indexOf('{');
  return brace === -1 ? null : css.slice(0, brace).trim();
}

/** The `@media` prelude to keep, `''` for none, or null when the condition does not apply. */
function mediaPrelude(list: MediaList | null | undefined): string | null {
  const text = list?.mediaText.trim() ?? '';
  // A preview has already rewritten every width query to `all` or `not all`.
  if (!text || text === 'all') return '';
  if (text === 'not all') return null;
  return `@media ${text}`;
}

/** The style containers whose declarations were read, so one edited rule can be read again. */
export type BlockIndex = Map<CSSRule, Block>;

/**
 * Every style rule and nested declaration block in `sheets`, in cascade order.
 *
 * Disabled sheets, conditions that do not apply and anonymous layers are skipped; unreadable
 * sheets are skipped too, since their rules cannot be restated.
 */
export function collectBlocks(sheets: readonly CSSStyleSheet[], index: BlockIndex): Block[] {
  index.clear();
  const out: Block[] = [];
  const visit = (container: CSSStyleSheet | CSSRule, chain: readonly string[], base: string | null): void => {
    let rules: CSSRuleList;
    try {
      rules = (container as CSSStyleSheet).cssRules;
    } catch {
      return;
    }
    if (!rules) return;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const own = [...chain, rule.selectorText];
        const block: Block = { chain: own, twins: readTwins(rule.style), base };
        out.push(block);
        index.set(rule, block);
        if (rule.cssRules?.length) visit(rule, own, base);
      } else if (typeof CSSNestedDeclarations !== 'undefined' && rule instanceof CSSNestedDeclarations) {
        // Declarations after a nested rule (Chrome 130+): the parent's, at this point in its order.
        const block: Block = { chain, twins: readTwins(rule.style), base };
        out.push(block);
        index.set(rule, block);
      } else if (rule instanceof CSSImportRule) {
        const media = mediaPrelude(rule.media);
        if (media === null || !rule.styleSheet || rule.layerName === '') continue;
        const next = [...chain];
        if (media) next.push(media);
        if (rule.supportsText) next.push(`@supports ${rule.supportsText}`);
        if (rule.layerName) next.push(`@layer ${rule.layerName}`);
        visit(rule.styleSheet, next, baseOf(rule.styleSheet, base));
      } else if (rule instanceof CSSMediaRule) {
        const media = mediaPrelude(rule.media);
        if (media === null) continue;
        visit(rule, media ? [...chain, media] : chain, base);
      } else if (rule instanceof CSSLayerBlockRule) {
        // An anonymous layer cannot be named again, so its rules cannot be put back in it.
        if (!rule.name) continue;
        visit(rule, [...chain, `@layer ${rule.name}`], base);
      } else if (rule instanceof CSSGroupingRule) {
        // `@supports`, `@container`, `@scope`, `@starting-style`: the prelude is kept as written.
        const prelude = preludeOf(rule);
        if (prelude) visit(rule, [...chain, prelude], base);
      }
    }
  };
  for (const sheet of sheets) {
    if (sheet.disabled) continue;
    const media = mediaPrelude(sheet.media);
    if (media === null) continue;
    visit(sheet, media ? [media] : [], baseOf(sheet, null));
  }
  return out;
}

/** Read one block again after a live edit. False when it is not one of the collected blocks. */
export function rereadBlock(rule: CSSRule, index: BlockIndex): boolean {
  const block = index.get(rule);
  if (!block) return false;
  const style = (rule as CSSStyleRule).style;
  if (!style) return false;
  block.twins = readTwins(style);
  return true;
}

/** A selector for `el` with zero specificity, by its position under the root. */
function pathOf(el: Element): string {
  const steps: string[] = [];
  let at: Element | null = el;
  while (at && at !== document.documentElement) {
    let index = 1;
    for (let sib = at.previousElementSibling; sib; sib = sib.previousElementSibling) index += 1;
    steps.unshift(`:nth-child(${index})`);
    at = at.parentElement;
  }
  return `:where(${[':root', ...steps].join(' > ')})`;
}

/** Inline declarations with a width unit, on the document's own elements. */
export function collectInline(): InlineBlock[] {
  const out: InlineBlock[] = [];
  for (const el of Array.from(document.querySelectorAll('[style]'))) {
    const style = (el as HTMLElement | SVGElement).style;
    if (!style?.length || !HAS_UNIT.test(el.getAttribute('style') ?? '')) continue;
    if (isEditorOwned(el)) continue;
    // An inline `!important` already outranks anything a sheet can say.
    const twins = readTwins(style).filter((one) => one.units && !one.important);
    if (twins.length) out.push({ selector: pathOf(el), twins });
  }
  return out;
}

/**
 * The internal sheet's text for a preview at `width`, or `''` when nothing uses a width unit.
 */
export function unitsCss(blocks: readonly Block[], inline: readonly InlineBlock[], width: number): string {
  const contested = new Set<string>();
  const note = (twins: readonly Twin[]): void => {
    for (const one of twins) if (one.units) for (const longhand of one.longhands) contested.add(longhand);
  };
  for (const one of inline) note(one.twins);
  for (const one of blocks) note(one.twins);
  if (!contested.size) return '';

  const body = (twins: readonly Twin[], base: string | null, important: boolean): string =>
    twins
      .map((one) => {
        let value = one.units ? restateWidthUnits(one.value, width) : one.value;
        if (base && /url\(/i.test(value)) value = absolutizeCssUrls(value, base);
        return `${one.name}: ${value}${important || one.important ? ' !important' : ''};`;
      })
      .join(' ');

  const out: string[] = [];
  for (const one of inline) out.push(`${one.selector} { ${body(one.twins, null, true)} }`);
  for (const block of blocks) {
    const picked = block.twins.filter((one) => one.longhands.some((longhand) => contested.has(longhand)));
    if (!picked.length) continue;
    const open = block.chain.map((part) => `${part} { `).join('');
    out.push(`${open}${body(picked, block.base, false)}${' }'.repeat(block.chain.length)}`);
  }
  return out.join('\n');
}
