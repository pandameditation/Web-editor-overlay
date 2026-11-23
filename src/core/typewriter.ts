/**
 * The Typewriter animation, in CSS only.
 *
 * One line of text typed out, held, and deleted or cleared, then the next text, in a loop. The
 * element keeps its own text (text 1): it stays in the page, selectable, indexed and read by
 * screen readers, and is painted transparent while its `::after` draws the typed text over it.
 * The texts after the first are custom properties on the element (`--heo-t2: "…"`), drawn only.
 *
 * How it types, measured in Chrome 157 (tmp probe, later folded into test/typewriter.html):
 *
 * - `--heo-c`, a registered `<integer>`, is animated from 0 to a text's length: an integer
 *   interpolates by whole steps, so each step is one more character, with no `steps()` to set;
 * - `--heo-text` and `--heo-n` (the text shown and its length) are animated discretely, each
 *   keyframe saying them both, so they switch only where a new text starts;
 * - the `::after` reveals `--heo-c / --heo-n` of its own width with `clip-path`, so it types in any
 *   font: a step is the fraction of the line one character is, not a `ch`.
 *
 * Its keyframes are a pure function of their name: `heo-typewriter-b-70-1600-35-14-12` is
 * backspace, 70ms a character, a 1600ms hold, 35ms a character deleted, texts of 14 and 12
 * characters. So the library writes exactly the keyframes a page names, as it does for every other
 * animation, and nothing is stored per element but declarations.
 *
 * Without the registered property (an older browser) the count is not stepped and the text shows
 * at each keyframe whole; without the animation at all, `--heo-c` is at its initial value and the
 * `::after` shows text 1 in full, so the element never reads as empty.
 */

/** What happens after a text is typed and held. */
export type TypewriterAfter = 'backspace' | 'clear' | 'keep';
export type TypewriterCaret = 'bar' | 'block' | 'under' | 'none';

export interface TypewriterSettings {
  /** Text 1 is the element's own; the rest are drawn. At least one, at most MAX_TEXTS. */
  texts: string[];
  /** Milliseconds a character, typing. */
  speed: number;
  /** Milliseconds a typed text stays. */
  hold: number;
  after: TypewriterAfter;
  /** Milliseconds a character, deleting (backspace). */
  remove: number;
  caret: TypewriterCaret;
  blink: boolean;
}

export const MAX_TEXTS = 6;
export const TYPEWRITER_PREFIX = 'heo-typewriter';
export const CARET_BLINK = 'heo-caret-blink';
/** The pause before each text is typed, so a deleted one and the next do not run together. */
const GAP_MS = 250;
const AFTER_CODE: Record<TypewriterAfter, string> = { backspace: 'b', clear: 'c', keep: 'k' };

export const DEFAULT_TYPEWRITER: Omit<TypewriterSettings, 'texts'> = {
  speed: 70,
  hold: 1600,
  after: 'backspace',
  remove: 35,
  caret: 'bar',
  blink: true,
};

/** Every custom property the element side writes: the texts and the caret's shape. */
export const TYPEWRITER_VARS = [
  ...Array.from({ length: MAX_TEXTS }, (_, i) => `--heo-t${i + 1}`),
  '--heo-caret-w',
  '--heo-caret-h',
  '--heo-caret-y',
  '--heo-caret-a',
  '--heo-tw-pos',
] as const;

/** A text's length in characters, as the steps count them (code points, not UTF-16 units). */
export const lengthOf = (text: string): number => [...text].length;

/** A text as a CSS string: quoted, escaped, and safe inside a `<style>` element. */
export function cssString(text: string): string {
  const body = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\a ')
    // A `</style>` in a text would end the stylesheet it is written in.
    .replace(/</g, '\\3c ');
  return `"${body}"`;
}

/** A CSS string back to its text; '' for anything that is not one. */
export function cssUnquote(value: string): string {
  const text = value.trim();
  const quote = text[0];
  if ((quote !== '"' && quote !== "'") || text.at(-1) !== quote || text.length < 2) return '';
  return text
    .slice(1, -1)
    .replace(/\\([0-9a-f]{1,6}) ?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

/** The settings' texts that play: one only when the last one is kept. */
function played(settings: TypewriterSettings): string[] {
  const texts = settings.texts.map((one) => one.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_TEXTS);
  return settings.after === 'keep' ? texts.slice(0, 1) : texts;
}

/** The keyframes' name for these settings: everything their timing depends on. */
export function typewriterName(settings: TypewriterSettings): string {
  const lengths = played(settings).map(lengthOf);
  const n = (value: number): number => Math.max(1, Math.round(value));
  return [TYPEWRITER_PREFIX, AFTER_CODE[settings.after], n(settings.speed), n(settings.hold), n(settings.remove), ...(lengths.length ? lengths : [1])].join('-');
}

interface ParsedName {
  after: TypewriterAfter;
  speed: number;
  hold: number;
  remove: number;
  lengths: number[];
}

/** A typewriter keyframes name read back, or null for any other name. */
export function parseTypewriterName(name: string): ParsedName | null {
  const match = /^heo-typewriter-([bck])-(\d+)-(\d+)-(\d+)((?:-\d+){1,6})$/.exec(name.trim());
  if (!match) return null;
  const after = (Object.keys(AFTER_CODE) as TypewriterAfter[]).find((one) => AFTER_CODE[one] === match[1])!;
  const lengths = match[5]!.slice(1).split('-').map(Number);
  if (lengths.some((one) => !(one > 0))) return null;
  return { after, speed: Number(match[2]), hold: Number(match[3]), remove: Number(match[4]), lengths };
}

interface Frame {
  at: number;
  text: number;
  n: number;
  c: number;
}

/** One loop as frames in milliseconds, and its length. */
function framesOf(parsed: ParsedName): { frames: Frame[]; total: number } {
  const frames: Frame[] = [];
  let t = 0;
  parsed.lengths.forEach((n, index) => {
    const text = index + 1;
    if (parsed.after !== 'keep') {
      frames.push({ at: t, text, n, c: 0 });
      t += GAP_MS;
    }
    frames.push({ at: t, text, n, c: 0 });
    t += n * parsed.speed;
    frames.push({ at: t, text, n, c: n });
    if (parsed.after === 'keep') return;
    t += parsed.hold;
    frames.push({ at: t, text, n, c: n });
    if (parsed.after === 'backspace') t += n * parsed.remove;
    frames.push({ at: t, text, n, c: 0 });
  });
  return { frames, total: Math.max(1, t) };
}

/** How long one loop lasts, in milliseconds. */
export function typewriterDuration(name: string): number {
  const parsed = parseTypewriterName(name);
  return parsed ? framesOf(parsed).total : 0;
}

/**
 * The keyframes a name stands for. A text's switch to the next is one thousandth of a percent
 * after the last frame of the one before, at a count of 0, so the change never shows.
 */
export function typewriterKeyframes(name: string): string {
  const parsed = parseTypewriterName(name);
  if (!parsed) return '';
  const { frames, total } = framesOf(parsed);
  const lines: string[] = [];
  let last = -1;
  for (const frame of frames) {
    let at = Math.round((frame.at / total) * 100000) / 1000;
    // Two frames at one offset are one keyframe in CSS: the later is moved on by the smallest step.
    if (at <= last) at = Math.round((last + 0.001) * 1000) / 1000;
    last = at;
    lines.push(`  ${Math.min(100, at)}% { --heo-text: var(--heo-t${frame.text}, ""); --heo-n: ${frame.n}; --heo-c: ${frame.c}; }`);
  }
  return `@keyframes ${name} {\n${lines.join('\n')}\n}`;
}

/** The registered count, and the caret's blink: the library CSS every typewriter needs once. */
export const TYPEWRITER_BASE_CSS = `@property --heo-c {
  syntax: '<integer>';
  inherits: true;
  initial-value: 9999;
}

@keyframes ${CARET_BLINK} {
  0%, 49.9% { --heo-caret-ink: currentColor; }
  50%, 100% { --heo-caret-ink: transparent; }
}`;

/** Whether a keyframes name is one this module writes. */
export const isTypewriterName = (name: string): boolean => name === CARET_BLINK || parseTypewriterName(name) !== null;

/** The library CSS for these names: the shared part once, then each typewriter's keyframes. */
export function typewriterLibraryCss(names: Iterable<string>): string {
  const typed = [...new Set(names)].filter((name) => parseTypewriterName(name));
  if (!typed.length) return '';
  return [TYPEWRITER_BASE_CSS, ...typed.map(typewriterKeyframes)].join('\n\n');
}

const CARETS: Record<TypewriterCaret, { w: string; h: string; y: string; a: string }> = {
  bar: { w: '2px', h: '1.05em', y: '50%', a: '1' },
  block: { w: '0.6em', h: '1.05em', y: '50%', a: '0.55' },
  under: { w: '0.6em', h: '2px', y: '88%', a: '1' },
  none: { w: '0px', h: '0px', y: '50%', a: '0' },
};

/**
 * The element's declarations: its texts, its keyframes, its caret, and its own text painted
 * transparent (the `::after` draws it). Only what differs from a bar caret is written.
 */
export function typewriterDeclarations(settings: TypewriterSettings, iterations: string): Record<string, string> {
  const texts = played(settings);
  // Nothing to type: nothing written, rather than an animation of an empty line.
  if (!texts.length) return {};
  const name = typewriterName(settings);
  const out: Record<string, string> = {};
  texts.forEach((text, i) => {
    out[`--heo-t${i + 1}`] = cssString(text);
  });
  const caret = CARETS[settings.caret];
  if (settings.caret !== 'bar') {
    out['--heo-caret-w'] = caret.w;
    out['--heo-caret-h'] = caret.h;
    if (caret.y !== CARETS.bar.y) out['--heo-caret-y'] = caret.y;
    if (caret.a !== CARETS.bar.a) out['--heo-caret-a'] = caret.a;
  }
  const blink = settings.blink && settings.caret !== 'none';
  const keep = settings.after === 'keep';
  const count = keep ? '1' : iterations || 'infinite';
  out['animation-name'] = blink ? `${name}, ${CARET_BLINK}` : name;
  out['animation-duration'] = blink ? `${typewriterDuration(name)}ms, 1000ms` : `${typewriterDuration(name)}ms`;
  out['animation-timing-function'] = blink ? 'linear, linear' : 'linear';
  out['animation-iteration-count'] = blink ? `${count}, infinite` : count;
  // Kept: the typed text stays when the typing ends. Otherwise the count goes back to its
  // initial value at the end, which shows text 1 whole.
  if (keep) out['animation-fill-mode'] = blink ? 'forwards, none' : 'forwards';
  out['-webkit-text-fill-color'] = 'transparent';
  return out;
}

/** The `::after` that draws the typed text: the same declarations on every typewriter. */
export const TYPEWRITER_AFTER: Readonly<Record<string, string>> = {
  content: 'var(--heo-text, var(--heo-t1, ""))',
  position: 'absolute',
  left: '0',
  top: '0',
  'white-space': 'pre',
  'padding-right': 'var(--heo-caret-w, 2px)',
  '-webkit-text-fill-color': 'currentColor',
  'pointer-events': 'none',
  'clip-path': 'inset(-0.3em calc(100% - 100% * min(1, var(--heo-c) / var(--heo-n, 1))) -0.3em -0.3em)',
  background: 'linear-gradient(color-mix(in srgb, var(--heo-caret-ink, currentColor) calc(var(--heo-caret-a, 1) * 100%), transparent) 0 0) no-repeat calc(100% * min(1, var(--heo-c) / var(--heo-n, 1))) var(--heo-caret-y, 50%) / var(--heo-caret-w, 2px) var(--heo-caret-h, 1.05em)',
};

/** Whether a `::after` content value is the typewriter's. */
export const isTypewriterContent = (value: string): boolean => /^var\(\s*--heo-text\b/.test(value.trim());

/**
 * The settings an element's declarations describe, or null when it is not a typewriter. `read`
 * gives a property's written value, '' when none.
 */
export function readTypewriter(read: (property: string) => string): TypewriterSettings | null {
  const names = read('animation-name').split(',').map((one) => one.trim());
  const parsed = names.map(parseTypewriterName).find(Boolean);
  if (!parsed) return null;
  const texts: string[] = [];
  for (let i = 1; i <= Math.min(MAX_TEXTS, parsed.lengths.length); i++) texts.push(cssUnquote(read(`--heo-t${i}`)));
  const w = read('--heo-caret-w').trim();
  const h = read('--heo-caret-h').trim();
  const caret = (Object.keys(CARETS) as TypewriterCaret[]).find((one) =>
    (w || CARETS.bar.w) === CARETS[one].w && (h || CARETS.bar.h) === CARETS[one].h) ?? 'bar';
  return {
    texts,
    speed: parsed.speed,
    hold: parsed.hold,
    after: parsed.after,
    remove: parsed.remove,
    caret,
    blink: names.includes(CARET_BLINK),
  };
}

/** Settings as an animation's string parameters, and back: the shape every preset's params have. */
export function typewriterParams(settings: TypewriterSettings): Record<string, string> {
  return {
    texts: JSON.stringify(settings.texts),
    speed: String(settings.speed),
    hold: String(settings.hold),
    after: settings.after,
    remove: String(settings.remove),
    caret: settings.caret,
    blink: settings.blink ? 'yes' : 'no',
  };
}

export function typewriterSettings(params: Readonly<Record<string, string>>): TypewriterSettings {
  let texts: string[] = [];
  try {
    const parsed: unknown = JSON.parse(params.texts ?? '[]');
    if (Array.isArray(parsed)) texts = parsed.map((one) => String(one));
  } catch {
    texts = [];
  }
  const number = (value: string | undefined, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const after = (['backspace', 'clear', 'keep'] as const).find((one) => one === params.after) ?? DEFAULT_TYPEWRITER.after;
  const caret = (['bar', 'block', 'under', 'none'] as const).find((one) => one === params.caret) ?? DEFAULT_TYPEWRITER.caret;
  return {
    texts,
    speed: number(params.speed, DEFAULT_TYPEWRITER.speed),
    hold: number(params.hold, DEFAULT_TYPEWRITER.hold),
    after,
    remove: number(params.remove, DEFAULT_TYPEWRITER.remove),
    caret,
    blink: params.blink !== 'no',
  };
}
