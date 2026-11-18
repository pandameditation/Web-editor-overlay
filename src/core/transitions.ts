import { splitTopLevel, splitTopLevelCommas } from './css.js';
import { shorthandChain } from './declaration-list.js';

/**
 * `transition`, read and written as a list of transitions: one per property, each with its own
 * duration, easing and delay — what `transition: opacity 150ms, transform 250ms ease-out` says.
 *
 * Times are kept as written (`var(--motion-fast)`, `.2s`), so a token survives an edit that did
 * not touch it; `timeMs` turns one into milliseconds for the timeline.
 */

export interface TransitionItem {
  /** A property, `all`, or a custom property. */
  property: string;
  /** As written: `150ms`, `.2s`, `var(--motion-fast)`. */
  duration: string;
  /** As written; `''` for none (0s). */
  delay: string;
  /** As written; `''` for the initial `ease`. */
  easing: string;
  /** `allow-discrete`, or `''` for normal. */
  behavior: string;
}

/** Every property a transition is written with, the shorthand first. */
export const TRANSITION_PROPERTIES: readonly string[] = [
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'transition-delay',
  'transition-behavior',
];

const TIME = /^-?(?:\d+\.?\d*|\.\d+)(?:ms|s)$/i;
const EASING_KEYWORD = /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i;
const EASING_FN = /^(?:cubic-bezier|steps|linear)\(/i;
/*
 * A `var()` in the shorthand may stand for a time or an easing, which the text cannot say. Its name
 * usually does: `--ease-out`, `--easing-spring` are easings; `--motion-fast` is a time.
 */
const EASING_VAR = /^var\(\s*--[\w-]*(?:ease|easing|curve|bezier|spring)/i;
const kindOf = (token: string): 'time' | 'easing' | 'other' => {
  if (TIME.test(token)) return 'time';
  if (EASING_KEYWORD.test(token) || EASING_FN.test(token) || EASING_VAR.test(token)) return 'easing';
  if (/^(?:var|calc)\(/i.test(token)) return 'time';
  return 'other';
};

/** A time as milliseconds, a `var()` through `resolve`; null when it cannot be read. */
export function timeMs(text: string, resolve?: (name: string) => string): number | null {
  const value = text.trim();
  if (!value) return 0;
  const variable = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/i.exec(value);
  if (variable) {
    const resolved = resolve?.(variable[1])?.trim() || variable[2]?.trim() || '';
    return resolved && !/^var\(/i.test(resolved) ? timeMs(resolved, resolve) : null;
  }
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/i.exec(value);
  if (!match) return null;
  return Math.round(Number(match[1]) * (match[2].toLowerCase() === 's' ? 1000 : 1));
}

/** One item of the shorthand: a property, then times (duration, then delay), an easing, a behavior. */
function parseOne(text: string): TransitionItem | null {
  const item: TransitionItem = { property: 'all', duration: '0s', delay: '', easing: '', behavior: '' };
  let times = 0;
  let named = false;
  for (const token of splitTopLevel(text.trim())) {
    const kind = kindOf(token);
    if (kind === 'time') {
      if (times === 0) item.duration = token;
      else if (times === 1) item.delay = timeMs(token) === 0 ? '' : token;
      else return null;
      times += 1;
    } else if (kind === 'easing') {
      if (item.easing) return null;
      item.easing = /^ease$/i.test(token) ? '' : token;
    } else if (/^(?:allow-discrete|normal)$/i.test(token)) {
      item.behavior = /^allow-discrete$/i.test(token) ? 'allow-discrete' : '';
    } else if (!named && /^-{0,2}[a-z_][\w-]*$/i.test(token)) {
      item.property = token;
      named = true;
    } else {
      return null;
    }
  }
  return item;
}

/**
 * The transitions a block declares: its `transition` shorthand, with any longhand it also
 * declares laid over it, list by list (a shorter list repeats, as CSS repeats it). `none` and
 * nothing are an empty list; null is a value this cannot read (a `var()` for the whole list).
 */
export function readTransitions(read: (property: string) => string): TransitionItem[] | null {
  const shorthand = read('transition').trim();
  let items: TransitionItem[] = [];
  if (shorthand && !/^(?:none|initial|unset|inherit|revert|revert-layer)$/i.test(shorthand)) {
    for (const part of splitTopLevelCommas(shorthand)) {
      const one = parseOne(part);
      if (!one) return null;
      items.push(one);
    }
    if (items.length && items.every((one) => one.property === 'none')) items = [];
  }
  const list = (property: string): string[] | null => {
    const text = read(property).trim();
    return text ? splitTopLevelCommas(text) : null;
  };
  const properties = list('transition-property');
  if (properties) {
    if (properties.length === 1 && /^none$/i.test(properties[0])) return [];
    const was = items;
    items = properties.map((property, i) => ({
      ...(was[i] ?? was[was.length - 1] ?? { duration: '0s', delay: '', easing: '', behavior: '' }),
      property,
    }));
  }
  const lay = (property: string, key: 'duration' | 'delay' | 'easing' | 'behavior'): void => {
    const values = list(property);
    if (!values || !items.length) return;
    items = items.map((one, i) => {
      const value = values[i % values.length];
      if (key === 'behavior') return { ...one, behavior: /^allow-discrete$/i.test(value) ? 'allow-discrete' : '' };
      if (key === 'delay') return { ...one, delay: timeMs(value) === 0 ? '' : value };
      if (key === 'easing') return { ...one, easing: /^ease$/i.test(value) ? '' : value };
      return { ...one, duration: value };
    });
  };
  lay('transition-duration', 'duration');
  lay('transition-delay', 'delay');
  lay('transition-timing-function', 'easing');
  lay('transition-behavior', 'behavior');
  return items;
}

/** One transition as the shorthand writes it: what it says and no more. */
export function formatTransition(item: TransitionItem): string {
  const parts = [item.property, item.duration || '0s'];
  if (item.easing && !/^ease$/i.test(item.easing)) parts.push(item.easing);
  if (item.delay && timeMs(item.delay) !== 0) parts.push(item.delay);
  if (item.behavior === 'allow-discrete') parts.push('allow-discrete');
  return parts.join(' ');
}

/** The list as the `transition` shorthand, or `none`. */
export function formatTransitions(items: readonly TransitionItem[]): string {
  return items.length ? items.map(formatTransition).join(', ') : 'none';
}

/** Longhands by shorthand, as the browser expands them; filled as asked. */
const members = new Map<string, Set<string> | null>();

/**
 * The longhands `shorthand` sets, asked of the browser: set it on a style nobody renders and see
 * what it filled in. Null outside a browser, or for a property that is not a shorthand.
 */
function longhandsSet(shorthand: string): Set<string> | null {
  if (members.has(shorthand)) return members.get(shorthand)!;
  let out: Set<string> | null = null;
  if (typeof document !== 'undefined') {
    const style = document.createElement('i').style;
    style.setProperty(shorthand, 'initial');
    const names = Array.from({ length: style.length }, (_unused, i) => style.item(i)).filter((name) => name !== shorthand);
    out = names.length ? new Set(names) : null;
  }
  members.set(shorthand, out);
  return out;
}

/**
 * Whether a transition of `property` (`all`, a shorthand) carries a change to `changed`.
 *
 * By what the shorthand sets, never by its name. Guessing from the prefix said `outline` carries
 * `outline-offset`, which it does not — `outline` is its color, style and width — so adding
 * `outline` took `outline-offset` off the suggestions, and its change went on snapping. The same
 * guess was wrong for `border-radius` under `border` and `background-blend-mode` under
 * `background`.
 */
export function covers(property: string, changed: string): boolean {
  const p = property.trim().toLowerCase();
  const c = changed.trim().toLowerCase();
  if (p === 'all') return !c.startsWith('--');
  if (c === p) return true;
  if (p.startsWith('--') || c.startsWith('--')) return false;
  const set = longhandsSet(p);
  if (set) return set.has(c) || [...set].some((one) => one !== p && longhandsSet(one)?.has(c));
  // Outside a browser: the shorthand families the editor knows.
  return shorthandChain(c).includes(p);
}
