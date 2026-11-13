/**
 * Colour as numbers: reading CSS colours, moving between sRGB, HSV and OKLCH, and the WCAG 2
 * contrast between two colours. No DOM: what this cannot read (a named colour, `hsl()`, a token)
 * the colour picker resolves through the browser first.
 */

/** An sRGB colour, each channel 0–1, alpha included. Channels may leave 0–1 when out of gamut. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** OKLCH: lightness 0–1, chroma 0–~0.4, hue in degrees, alpha 0–1. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
  a: number;
}

/** HSV, the picker's square: hue in degrees, saturation and value 0–1. */
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;

/** One channel: a number, or a percentage of `full`. `none` is zero. */
function channel(text: string, full: number): number | null {
  const value = text.trim().toLowerCase();
  if (value === 'none') return 0;
  if (new RegExp(`^${NUMBER}%$`).test(value)) return (parseFloat(value) / 100) * full;
  if (new RegExp(`^${NUMBER}$`).test(value)) return parseFloat(value);
  return null;
}

function hueOf(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (value === 'none') return 0;
  const match = new RegExp(`^(${NUMBER})(deg|turn|rad|grad)?$`).exec(value);
  if (!match) return null;
  const n = parseFloat(match[1]!);
  const unit = match[2] ?? 'deg';
  const deg = unit === 'deg' ? n : unit === 'turn' ? n * 360 : unit === 'rad' ? (n * 180) / Math.PI : n * 0.9;
  return ((deg % 360) + 360) % 360;
}

/** A function's arguments, with or without commas, and its `/ alpha`. */
function argsOf(inner: string): { parts: string[]; alpha: string | null } {
  const [main, alpha] = inner.split('/');
  const parts = main!.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  // The legacy comma form puts alpha fourth.
  if (alpha === undefined && parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3]! };
  return { parts, alpha: alpha === undefined ? null : alpha.trim() };
}

function alphaOf(text: string | null): number | null {
  if (text === null) return 1;
  const value = channel(text, 1);
  return value === null ? null : clamp01(value);
}

/**
 * A CSS colour read as sRGB, or null for what this does not read: named colours, `hsl()`,
 * `color-mix()`, tokens, `currentColor`. Reads hex, `rgb()`, `oklch()`, `oklab()` and
 * `color(srgb …)`, which between them are what the browser serialises a computed colour as.
 */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const digits = hex[1]!.length <= 4 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!;
    const n = (i: number): number => parseInt(digits.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) : 1 };
  }
  const fn = /^([a-z]+)\((.*)\)$/.exec(text);
  if (!fn) return null;
  const [, name, inner] = fn as unknown as [string, string, string];
  if (name === 'rgb' || name === 'rgba') {
    const { parts, alpha } = argsOf(inner);
    if (parts.length !== 3) return null;
    const [r, g, b] = parts.map((part) => channel(part, 255));
    const a = alphaOf(alpha);
    if (r == null || g == null || b == null || a === null) return null;
    return { r: r / 255, g: g / 255, b: b / 255, a };
  }
  if (name === 'oklch') {
    const { parts, alpha } = argsOf(inner);
    if (parts.length !== 3) return null;
    const l = channel(parts[0]!, 1);
    const c = channel(parts[1]!, 0.4);
    const h = hueOf(parts[2]!);
    const a = alphaOf(alpha);
    if (l === null || c === null || h === null || a === null) return null;
    return oklchToRgb({ l, c, h, a });
  }
  if (name === 'oklab') {
    const { parts, alpha } = argsOf(inner);
    if (parts.length !== 3) return null;
    const l = channel(parts[0]!, 1);
    const A = channel(parts[1]!, 0.4);
    const B = channel(parts[2]!, 0.4);
    const a = alphaOf(alpha);
    if (l === null || A === null || B === null || a === null) return null;
    return { ...oklabToRgb(l, A, B), a };
  }
  if (name === 'color') {
    const { parts, alpha } = argsOf(inner);
    if (parts[0] !== 'srgb' || parts.length !== 4) return null;
    const [r, g, b] = parts.slice(1).map((part) => channel(part, 1));
    const a = alphaOf(alpha);
    if (r == null || g == null || b == null || a === null) return null;
    return { r, g, b, a };
  }
  return null;
}

/** An `oklch()` value read exactly, so a colour typed out of the sRGB gamut keeps its numbers. */
export function parseOklch(value: string): Oklch | null {
  const fn = /^oklch\((.*)\)$/i.exec(value.trim());
  if (!fn) return null;
  const { parts, alpha } = argsOf(fn[1]!.toLowerCase());
  if (parts.length !== 3) return null;
  const l = channel(parts[0]!, 1);
  const c = channel(parts[1]!, 0.4);
  const h = hueOf(parts[2]!);
  const a = alphaOf(alpha);
  if (l === null || c === null || h === null || a === null) return null;
  return { l, c, h, a };
}

/* -------------------------------------------------------------------------- */
/* Converting                                                                  */
/* -------------------------------------------------------------------------- */

const toLinear = (c: number): number => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number): number => (Math.abs(c) <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055));

function oklabToRgb(l: number, a: number, b: number): Omit<Rgba, 'a'> {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

/** sRGB to OKLCH. A grey has no hue; it reads as 0, and the picker keeps the hue it had instead. */
export function rgbToOklch(rgb: Rgba): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : (((Math.atan2(B, A) * 180) / Math.PI) % 360 + 360) % 360;
  return { l: L, c, h, a: rgb.a };
}

export function oklchToRgb(color: Oklch): Rgba {
  const rad = (color.h * Math.PI) / 180;
  return { ...oklabToRgb(color.l, color.c * Math.cos(rad), color.c * Math.sin(rad)), a: color.a };
}

/** Whether a colour is inside sRGB, which is all a hex value or the picker's square can show. */
export function inGamut(rgb: Rgba, tolerance = 1e-4): boolean {
  return [rgb.r, rgb.g, rgb.b].every((c) => c >= -tolerance && c <= 1 + tolerance);
}

/** The colour clipped into sRGB: what a hex value of it is. */
export const clampRgb = (rgb: Rgba): Rgba => ({ r: clamp01(rgb.r), g: clamp01(rgb.g), b: clamp01(rgb.b), a: clamp01(rgb.a) });

export function rgbToHsv(rgb: Rgba, hueIfGrey = 0): Hsva {
  const { r, g, b } = clampRgb(rgb);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = hueIfGrey;
  if (d > 1e-6) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    h = (h + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a: rgb.a };
}

export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

const byte = (n: number): string => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when translucent. Out-of-gamut channels are clipped. */
export function toHex(rgb: Rgba): string {
  return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}${rgb.a < 1 ? byte(rgb.a) : ''}`;
}

const trim = (n: number, digits: number): string => String(Number(n.toFixed(digits)));

/** `oklch(62.4% 0.188 264.1)`, with `/ 50%` when translucent. */
export function toOklchString(color: Oklch): string {
  const alpha = color.a < 1 ? ` / ${trim(color.a * 100, 1)}%` : '';
  return `oklch(${trim(color.l * 100, 2)}% ${trim(color.c, 4)} ${trim(color.c < 1e-4 ? 0 : color.h, 2)}${alpha})`;
}

/* -------------------------------------------------------------------------- */
/* Contrast (WCAG 2)                                                           */
/* -------------------------------------------------------------------------- */

/** A translucent colour over an opaque one. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = clamp01(top.a);
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2 relative luminance of an opaque sRGB colour. */
export function luminance(rgb: Rgba): number {
  const { r, g, b } = clampRgb(rgb);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2 contrast ratio, 1–21. A translucent foreground is laid over the background first. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const bg = background.a < 1 ? composite(background, { r: 1, g: 1, b: 1, a: 1 }) : background;
  const fg = foreground.a < 1 ? composite(foreground, bg) : foreground;
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The worst ratio against several backgrounds: a gradient's stops, an image's colours. */
export function worstContrast(foreground: Rgba, backgrounds: readonly Rgba[]): { ratio: number; against: Rgba | null } {
  let worst: { ratio: number; against: Rgba | null } = { ratio: 21, against: null };
  for (const background of backgrounds) {
    const ratio = contrastRatio(foreground, background);
    if (ratio < worst.ratio) worst = { ratio, against: background };
  }
  return worst;
}

/** What a ratio passes: text needs 4.5 (AA) and 7 (AAA), large text 3 and 4.5, anything else 3. */
export function contrastLevels(ratio: number, kind: 'text' | 'large-text' | 'non-text'): { aa: boolean; aaa: boolean; needed: number } {
  if (kind === 'non-text') return { aa: ratio >= 3, aaa: ratio >= 3, needed: 3 };
  const [aa, aaa] = kind === 'large-text' ? [3, 4.5] : [4.5, 7];
  return { aa: ratio >= aa, aaa: ratio >= aaa, needed: aa };
}
