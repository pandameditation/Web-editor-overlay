import { splitTopLevel } from './css.js';
import { lengthParts } from './shadow.js';

/**
 * `filter` and `backdrop-filter`, read and written as a list of functions.
 *
 * Order is part of the value — `blur(2px) grayscale(1)` and `grayscale(1) blur(2px)` draw
 * differently — so the list is kept in the order written, and a function the editor did not touch
 * is written back exactly as it was. What the editor cannot model (a `var()`, a function it does
 * not know) is kept as an opaque part: shown, movable, removable, never rewritten.
 */

export type FilterName =
  | 'grayscale'
  | 'sepia'
  | 'blur'
  | 'brightness'
  | 'hue-rotate'
  | 'saturate'
  | 'opacity'
  | 'contrast'
  | 'invert'
  | 'drop-shadow'
  | 'url';

export interface FilterSpec {
  name: FilterName;
  /** What the slider and the number are in. */
  unit: '%' | 'px' | 'deg' | '';
  /** The slider's end. The number box takes more where the function does (brightness, saturate, contrast). */
  max: number;
  /** Past this the function draws nothing new: grayscale(150%) is grayscale(100%). */
  clamp?: number;
  /** The value that changes nothing, so a function added by clicking it shows no change yet. */
  neutral: number;
  step: number;
}

/** Every function, in the order they are offered. */
export const FILTER_SPECS: readonly FilterSpec[] = [
  { name: 'grayscale', unit: '%', max: 100, clamp: 100, neutral: 0, step: 1 },
  { name: 'sepia', unit: '%', max: 100, clamp: 100, neutral: 0, step: 1 },
  { name: 'blur', unit: 'px', max: 10, neutral: 0, step: 0.5 },
  { name: 'brightness', unit: '%', max: 200, neutral: 100, step: 1 },
  { name: 'hue-rotate', unit: 'deg', max: 360, neutral: 0, step: 1 },
  { name: 'saturate', unit: '%', max: 1000, neutral: 100, step: 1 },
  { name: 'opacity', unit: '%', max: 100, clamp: 100, neutral: 100, step: 1 },
  { name: 'contrast', unit: '%', max: 1000, neutral: 100, step: 1 },
  { name: 'invert', unit: '%', max: 100, clamp: 100, neutral: 0, step: 1 },
  { name: 'drop-shadow', unit: '', max: 0, neutral: 0, step: 1 },
  { name: 'url', unit: '', max: 0, neutral: 0, step: 1 },
];

export const filterSpec = (name: string): FilterSpec | undefined => FILTER_SPECS.find((one) => one.name === name);

export interface FilterPart {
  /** The function, or null for a part this cannot model: a `var()`, an unknown function. */
  name: FilterName | null;
  /** The part as written: `sepia(0.6)`, `url(#grain)`, `var(--glass)`. */
  text: string;
}

/** The function's name and what is inside its parentheses, or null when it is not a function. */
function fnParts(text: string): { name: string; inner: string } | null {
  const match = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(text.trim());
  return match ? { name: match[1].toLowerCase(), inner: match[2].trim() } : null;
}

/** A value's parts, in order. `none` and an empty value are an empty list. */
export function parseFilter(value: string): FilterPart[] {
  const text = value.trim();
  if (!text || /^none$/i.test(text)) return [];
  return splitTopLevel(text).map((token) => {
    const fn = fnParts(token);
    const spec = fn ? filterSpec(fn.name) : undefined;
    return { name: spec ? spec.name : null, text: token };
  });
}

/** An added `url()` with nothing picked yet. Kept in the editor, never written: it would void the whole value. */
export const isEmptyUrl = (part: FilterPart): boolean => part.name === 'url' && /^url\(\s*(?:''|"")?\s*\)$/i.test(part.text.trim());

/** The parts written back as one value, leaving out a `url()` that points at nothing yet. */
export function formatFilter(parts: readonly FilterPart[]): string {
  const written = parts.filter((one) => !isEmptyUrl(one));
  return written.length ? written.map((one) => one.text).join(' ') : 'none';
}

/**
 * The amount of a numeric function in the editor's unit, and whether it was written as a plain
 * number (`sepia(0.6)`), so an edit keeps the author's form. Null when it cannot be dragged: a
 * `calc()`, a blur in `rem`, a `var()`.
 */
export function filterAmount(part: FilterPart): { value: number; plain: boolean } | null {
  const spec = part.name ? filterSpec(part.name) : undefined;
  const fn = fnParts(part.text);
  if (!spec || !fn || !spec.unit) return null;
  const inner = fn.inner;
  // An empty function is its default: 100% for the amounts, nothing for blur and hue-rotate.
  if (!inner) return { value: spec.unit === '%' ? 100 : 0, plain: false };
  if (spec.unit === 'px') {
    const length = lengthParts(inner);
    return length && length.unit === 'px' ? { value: length.number, plain: false } : null;
  }
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(inner);
  if (!match) return null;
  const number = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (spec.unit === 'deg') {
    const toDeg: Record<string, number> = { deg: 1, '': 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 };
    // A bare number is only an angle when it is zero.
    if (!(unit in toDeg) || (unit === '' && number !== 0)) return null;
    return { value: Math.round(number * toDeg[unit] * 100) / 100, plain: false };
  }
  if (unit === '%') return { value: number, plain: false };
  if (unit === '') return { value: Math.round(number * 10000) / 100, plain: true };
  return null;
}

/** A numeric function at an amount, in the form it was written in (`0.6`) or in its unit (`60%`). */
export function withAmount(name: FilterName, value: number, plain = false): FilterPart {
  const spec = filterSpec(name)!;
  const clamped = Math.max(0, spec.clamp === undefined ? value : Math.min(spec.clamp, value));
  const round = (n: number): number => Math.round(n * 100) / 100;
  if (spec.unit === 'deg') return { name, text: `${name}(${round(value)}deg)` };
  if (spec.unit === 'px') return { name, text: `${name}(${round(clamped)}px)` };
  return { name, text: plain ? `${name}(${round(clamped / 100)})` : `${name}(${round(clamped)}%)` };
}

/**
 * A function as it is first added: at its neutral value, which changes nothing on screen. Not a drop
 * shadow, which starts as the shadow editor's first shadow, nor a `url()`, which starts empty.
 */
export function neutralPart(name: FilterName): FilterPart {
  // The shadow editor's own first shadow: a shadow at nothing would show nothing to edit.
  if (name === 'drop-shadow') return { name, text: 'drop-shadow(0px 4px 12px rgb(0 0 0 / 20%))' };
  if (name === 'url') return { name, text: 'url()' };
  return withAmount(name, filterSpec(name)!.neutral);
}

/** What a `url()` part points at, unquoted: `#grain`, `filters.svg#paper`. */
export function urlTarget(part: FilterPart): string {
  const inner = fnParts(part.text)?.inner ?? '';
  return inner.replace(/^(['"])(.*)\1$/, '$2');
}

/** A `url()` part pointing at a reference, quoted when it has to be. */
export function urlPart(target: string): FilterPart {
  const ref = target.trim();
  return { name: 'url', text: /[\s()'"]/.test(ref) ? `url("${ref.replace(/"/g, '\\"')}")` : `url(${ref})` };
}

/**
 * A filter for a small picture of it, `divide` times smaller: the blur scaled down with it, and the
 * parts a picture cannot show left out — a `url()` points into the page, which a picture in the
 * overlay cannot reach, a drop shadow is lost at that size, and an opaque part may not be valid.
 */
export function filterPreview(value: string, divide: number): string {
  const shown: string[] = [];
  for (const part of parseFilter(value)) {
    if (!part.name || part.name === 'url' || part.name === 'drop-shadow') continue;
    if (part.name === 'blur') {
      const amount = filterAmount(part);
      if (amount) shown.push(`blur(${Math.round((amount.value / divide) * 100) / 100}px)`);
      continue;
    }
    shown.push(part.text);
  }
  return shown.join(' ') || 'none';
}
