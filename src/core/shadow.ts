import { parseColor, toHex, type Rgba } from './color.js';
import { splitTopLevel, splitTopLevelCommas } from './css.js';

/**
 * Shadows, read and written: `box-shadow`, `text-shadow`, and the `drop-shadow()` functions of
 * `filter`.
 *
 * The three are one idea with different limits. A box shadow has four lengths and may be inset; a
 * text shadow and a drop shadow have three and may not. One model serves all three, so the editor
 * can turn one into another — and so a value that loses something on the way (a spread, an inset)
 * can be told about it rather than quietly losing it.
 *
 * Lengths and the colour are kept as written: `0.5rem`, `var(--glow)`, `currentColor`. A shadow is
 * only rewritten where the user changed it, so nothing they did not touch is reformatted.
 */

export type ShadowMode = 'box' | 'text' | 'drop';

export interface Shadow {
  x: string;
  y: string;
  blur: string;
  /** Box shadows only. Kept on the others so converting back does not lose it. */
  spread: string;
  color: string;
  /** Box shadows only. */
  inset: boolean;
}

export const NO_SHADOW: Shadow = { x: '0px', y: '0px', blur: '0px', spread: '0px', color: 'rgb(0 0 0 / 20%)', inset: false };

/** A length as the editor drags it, or null when it is something else: `calc()`, `var()`. */
export function lengthParts(value: string): { number: number; unit: string } | null {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(value.trim());
  if (!match) return null;
  const number = Number(match[1]);
  // A bare zero is a length; any other bare number is not one.
  if (!match[2] && number !== 0) return null;
  return { number, unit: match[2] || 'px' };
}

const LENGTH_FN = /^(?:calc|min|max|clamp)\(/i;
const isLength = (token: string): boolean => lengthParts(token) !== null || LENGTH_FN.test(token);

/** One shadow: two to four lengths, an optional colour either side, and `inset` for a box. */
function parseOne(text: string, mode: ShadowMode): Shadow | null {
  const tokens = splitTopLevel(text.trim());
  const lengths: string[] = [];
  let color = '';
  let inset = false;
  // Lengths are one run: once something else follows them, another length is not a shadow.
  let ended = false;
  for (const token of tokens) {
    if (/^inset$/i.test(token)) {
      if (mode !== 'box' || inset) return null;
      inset = true;
      if (lengths.length) ended = true;
    } else if (isLength(token)) {
      if (ended) return null;
      lengths.push(token);
    } else {
      if (color) return null;
      color = token;
      if (lengths.length) ended = true;
    }
  }
  const most = mode === 'box' ? 4 : 3;
  if (lengths.length < 2 || lengths.length > most) return null;
  return {
    x: lengths[0],
    y: lengths[1],
    blur: lengths[2] ?? '0px',
    spread: lengths[3] ?? '0px',
    // The initial colour of a shadow is currentColor; written out, so the editor can show it.
    color: color || 'currentColor',
    inset,
  };
}

/**
 * A `box-shadow` or `text-shadow` value as shadows: `none` is an empty list, and anything this
 * cannot read — a `var()` standing for the whole list, a typo — is null.
 */
export function parseShadows(value: string, mode: 'box' | 'text'): Shadow[] | null {
  const text = value.trim();
  if (!text || /^none$/i.test(text)) return [];
  const out: Shadow[] = [];
  for (const part of splitTopLevelCommas(text)) {
    const one = parseOne(part, mode);
    if (!one) return null;
    out.push(one);
  }
  return out;
}

const isZero = (length: string): boolean => lengthParts(length)?.number === 0;

/** One shadow as it is written for `mode`: the blur and spread only when they say something. */
export function formatShadow(shadow: Shadow, mode: ShadowMode): string {
  const parts = [shadow.x, shadow.y];
  const spread = mode === 'box' && !isZero(shadow.spread);
  if (!isZero(shadow.blur) || spread) parts.push(shadow.blur);
  if (spread) parts.push(shadow.spread);
  const body = `${parts.join(' ')} ${shadow.color}`.trim();
  if (mode === 'drop') return `drop-shadow(${body})`;
  return mode === 'box' && shadow.inset ? `inset ${body}` : body;
}

/** A list of shadows as a `box-shadow` or `text-shadow` value. */
export function formatShadows(list: readonly Shadow[], mode: 'box' | 'text'): string {
  return list.length ? list.map((one) => formatShadow(one, mode)).join(', ') : 'none';
}

/** What a shadow loses as a text or drop shadow: a spread, an inset. Empty when nothing. */
export function lostIn(shadow: Shadow, mode: ShadowMode): Array<'spread' | 'inset'> {
  if (mode === 'box') return [];
  const lost: Array<'spread' | 'inset'> = [];
  if (!isZero(shadow.spread)) lost.push('spread');
  if (shadow.inset) lost.push('inset');
  return lost;
}

/* -------------------------------------------------------------------------- */
/* filter                                                                      */
/* -------------------------------------------------------------------------- */

/** A `filter` value's functions, in order, as written. `none` is an empty list. */
export function filterFunctions(value: string): string[] {
  const text = value.trim();
  if (!text || /^none$/i.test(text)) return [];
  return splitTopLevel(text);
}

const isDropShadow = (fn: string): boolean => /^drop-shadow\(/i.test(fn.trim());

/**
 * A `filter` taken apart: the drop shadows, which the editor owns, and everything else, which it
 * leaves exactly as written. Null when a drop-shadow() in it cannot be read.
 */
export function splitFilter(value: string): { others: string[]; drops: Shadow[]; at: number } | null {
  const fns = filterFunctions(value);
  const others: string[] = [];
  const drops: Shadow[] = [];
  // Where the drop shadows go back: where the first one was, or at the end.
  let at = -1;
  for (const fn of fns) {
    if (!isDropShadow(fn)) {
      others.push(fn);
      continue;
    }
    if (at < 0) at = others.length;
    const inner = fn.trim().replace(/^drop-shadow\(/i, '').replace(/\)$/, '');
    const one = parseOne(inner, 'drop');
    if (!one) return null;
    drops.push(one);
  }
  return { others, drops, at: at < 0 ? others.length : at };
}

/** A `filter` with its drop shadows replaced, the other functions kept where they were. */
export function composeFilter(others: readonly string[], drops: readonly Shadow[], at = others.length): string {
  const written = drops.map((one) => formatShadow(one, 'drop'));
  const fns = [...others.slice(0, at), ...written, ...others.slice(at)];
  return fns.length ? fns.join(' ') : 'none';
}

/* -------------------------------------------------------------------------- */
/* Opacity                                                                     */
/* -------------------------------------------------------------------------- */

/** A colour's alpha as 0–1, or null when the colour cannot be read here (a name, a token). */
export function alphaOf(color: string, resolve?: (color: string) => Rgba | null): number | null {
  const rgba = parseColor(color) ?? resolve?.(color) ?? null;
  return rgba ? rgba.a : null;
}

/**
 * The colour at another opacity, as `rgb(r g b / a%)` — or as hex when fully opaque, which is how
 * a picked colour is written elsewhere. Null when the colour cannot be read.
 */
export function withAlpha(color: string, alpha: number, resolve?: (color: string) => Rgba | null): string | null {
  const rgba = parseColor(color) ?? resolve?.(color) ?? null;
  if (!rgba) return null;
  const a = Math.max(0, Math.min(1, alpha));
  if (a >= 1) return toHex({ ...rgba, a: 1 });
  const byte = (n: number): number => Math.round(Math.max(0, Math.min(1, n)) * 255);
  return `rgb(${byte(rgba.r)} ${byte(rgba.g)} ${byte(rgba.b)} / ${Math.round(a * 100)}%)`;
}

/* -------------------------------------------------------------------------- */
/* Swatches                                                                    */
/* -------------------------------------------------------------------------- */

export interface ShadowSwatch {
  name: string;
  /** What is written when the swatch is picked and left as it is: `var(--shadow-md)` for a token. */
  value: string;
  shadows: Shadow[];
}

const s = (x: number, y: number, blur: number, spread: number, color: string, inset = false): Shadow => ({
  x: `${x}px`,
  y: `${y}px`,
  blur: `${blur}px`,
  spread: `${spread}px`,
  color,
  inset,
});

/** HEO's own swatches, offered when the design system has no shadow tokens. */
export const HEO_SHADOW_SWATCHES: readonly ShadowSwatch[] = [
  ['Soft', [s(0, 8, 24, -6, 'rgb(15 23 42 / 18%)')]],
  ['Lifted', [s(0, 1, 2, 0, 'rgb(15 23 42 / 8%)'), s(0, 18, 36, -12, 'rgb(15 23 42 / 25%)')]],
  ['Hard', [s(6, 6, 0, 0, '#0f172a')]],
  ['Glow', [s(0, 0, 22, 4, 'rgb(99 102 241 / 60%)')]],
  ['Neon', [s(0, 0, 4, 0, 'rgb(34 211 238 / 90%)'), s(0, 0, 28, 6, 'rgb(34 211 238 / 50%)')]],
  ['Inner', [s(0, 2, 6, 0, 'rgb(15 23 42 / 20%)', true)]],
  ['Deep', [s(0, 24, 48, -12, 'rgb(15 23 42 / 35%)')]],
  ['Ring', [s(0, 0, 0, 3, 'rgb(99 102 241 / 35%)')]],
].map(([name, shadows]) => ({ name: name as string, shadows: shadows as Shadow[], value: formatShadows(shadows as Shadow[], 'box') }));

/** Two lists the same, field by field. */
export function sameShadows(a: readonly Shadow[], b: readonly Shadow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
