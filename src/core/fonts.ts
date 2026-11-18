import { splitTopLevelCommas } from './css.js';

/**
 * Fonts for the font picker: a family stack read and written, which families the page and the
 * system have, a catalogue of web fonts, and loading those for a preview without touching the page.
 */

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);

export const isGenericFamily = (name: string): boolean => GENERIC.has(name.trim().toLowerCase());

/** A `font-family` value as its families, unquoted: `'Fraunces', Georgia, serif` → three. */
export function parseFamilies(value: string): string[] {
  return splitTopLevelCommas(value)
    .map((one) => one.trim().replace(/^(['"])(.*)\1$/, '$2').trim())
    .filter(Boolean);
}

/** Families as a `font-family` value: names quoted where they need it, generic ones bare. */
export function formatFamilies(families: readonly string[]): string {
  return families
    .filter((one) => one.trim())
    .map((one) => {
      const name = one.trim();
      if (isGenericFamily(name) || /^var\(/i.test(name)) return name;
      return /^[a-z][a-z0-9-]*$/i.test(name) && !/^\d/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
    })
    .join(', ');
}

export type FontCategory = 'Sans' | 'Serif' | 'Mono' | 'Display' | 'Hand';

export interface WebFont {
  name: string;
  category: FontCategory;
  /** The weight range or list to ask for, in the CSS2 API's terms: `400..900`, `400;700`. */
  weights: string;
}

/** A curated set of Google Fonts, offered once web fonts are turned on. */
export const WEB_FONTS: readonly WebFont[] = [
  { name: 'Inter', category: 'Sans', weights: '100..900' },
  { name: 'Roboto', category: 'Sans', weights: '100..900' },
  { name: 'Open Sans', category: 'Sans', weights: '300..800' },
  { name: 'Lato', category: 'Sans', weights: '400;700' },
  { name: 'Montserrat', category: 'Sans', weights: '100..900' },
  { name: 'Poppins', category: 'Sans', weights: '400;600;700' },
  { name: 'DM Sans', category: 'Sans', weights: '100..1000' },
  { name: 'Manrope', category: 'Sans', weights: '200..800' },
  { name: 'Work Sans', category: 'Sans', weights: '100..900' },
  { name: 'Space Grotesk', category: 'Sans', weights: '300..700' },
  { name: 'IBM Plex Sans', category: 'Sans', weights: '100..700' },
  { name: 'Nunito', category: 'Sans', weights: '200..1000' },
  { name: 'Playfair Display', category: 'Serif', weights: '400..900' },
  { name: 'Fraunces', category: 'Serif', weights: '100..900' },
  { name: 'Merriweather', category: 'Serif', weights: '300..900' },
  { name: 'Lora', category: 'Serif', weights: '400..700' },
  { name: 'EB Garamond', category: 'Serif', weights: '400..800' },
  { name: 'Libre Baskerville', category: 'Serif', weights: '400;700' },
  { name: 'Source Serif 4', category: 'Serif', weights: '200..900' },
  { name: 'Crimson Pro', category: 'Serif', weights: '200..900' },
  { name: 'Instrument Serif', category: 'Serif', weights: '400' },
  { name: 'DM Serif Display', category: 'Display', weights: '400' },
  { name: 'Bricolage Grotesque', category: 'Display', weights: '200..800' },
  { name: 'Abril Fatface', category: 'Display', weights: '400' },
  { name: 'Bebas Neue', category: 'Display', weights: '400' },
  { name: 'Archivo Black', category: 'Display', weights: '400' },
  { name: 'JetBrains Mono', category: 'Mono', weights: '100..800' },
  { name: 'IBM Plex Mono', category: 'Mono', weights: '100..700' },
  { name: 'Space Mono', category: 'Mono', weights: '400;700' },
  { name: 'Fira Code', category: 'Mono', weights: '300..700' },
  { name: 'Caveat', category: 'Hand', weights: '400..700' },
  { name: 'Dancing Script', category: 'Hand', weights: '400..700' },
  { name: 'Kalam', category: 'Hand', weights: '300;400;700' },
];

/** The CSS2 API stylesheet for a web font: the whole of it, or only the glyphs of `text`. */
export function webFontCss(font: WebFont, text?: string): string {
  const axis = font.weights.includes('..') || font.weights.includes(';') ? `:wght@${font.weights}` : '';
  const only = text ? `&text=${encodeURIComponent(text)}` : '';
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.name).replace(/%20/g, '+')}${axis}${only}&display=swap`;
}

/** What a web font falls back to while it loads, or if it never does. */
export const GENERIC_FOR: Record<FontCategory, string> = {
  Sans: 'sans-serif',
  Serif: 'serif',
  Mono: 'monospace',
  Display: 'serif',
  Hand: 'cursive',
};

/** System fonts worth offering, checked for on this machine before they are. */
export const SYSTEM_FONTS: ReadonlyArray<{ name: string; category: FontCategory }> = [
  { name: 'system-ui', category: 'Sans' },
  { name: 'Helvetica Neue', category: 'Sans' },
  { name: 'Helvetica', category: 'Sans' },
  { name: 'Arial', category: 'Sans' },
  { name: 'Avenir Next', category: 'Sans' },
  { name: 'Segoe UI', category: 'Sans' },
  { name: 'Verdana', category: 'Sans' },
  { name: 'Trebuchet MS', category: 'Sans' },
  { name: 'Optima', category: 'Sans' },
  { name: 'Gill Sans', category: 'Sans' },
  { name: 'Georgia', category: 'Serif' },
  { name: 'Times New Roman', category: 'Serif' },
  { name: 'Palatino', category: 'Serif' },
  { name: 'Baskerville', category: 'Serif' },
  { name: 'Hoefler Text', category: 'Serif' },
  { name: 'Iowan Old Style', category: 'Serif' },
  { name: 'Cambria', category: 'Serif' },
  { name: 'Didot', category: 'Display' },
  { name: 'Menlo', category: 'Mono' },
  { name: 'Monaco', category: 'Mono' },
  { name: 'Consolas', category: 'Mono' },
  { name: 'Courier New', category: 'Mono' },
  { name: 'Snell Roundhand', category: 'Hand' },
];

let probe: CanvasRenderingContext2D | null | undefined;
const installed = new Map<string, boolean>();

/**
 * Whether a family is installed here: drawn against two different fallbacks, a missing family
 * takes each fallback's widths, so a family that matches neither is real.
 */
export function hasLocalFont(name: string): boolean {
  if (isGenericFamily(name)) return true;
  const known = installed.get(name);
  if (known !== undefined) return known;
  if (probe === undefined) probe = document.createElement('canvas').getContext('2d');
  let found = false;
  if (probe) {
    const text = 'mmmmmmmmmmlli 0123456789 WQgy';
    const width = (font: string): number => {
      probe!.font = `72px ${font}`;
      return probe!.measureText(text).width;
    };
    const quoted = `"${name.replace(/"/g, '')}"`;
    found = width(`${quoted}, monospace`) !== width('monospace') || width(`${quoted}, serif`) !== width('serif');
  }
  installed.set(name, found);
  return found;
}

/** The faces loaded for a preview: in the document's font set, but not the page's own fonts. */
const previewFaces = new WeakSet<FontFace>();

/** The families the page loads with `@font-face`, by name. Not the ones loaded for a preview. */
export function pageFontFamilies(): string[] {
  const names = new Set<string>();
  try {
    for (const face of document.fonts as unknown as Iterable<FontFace>) {
      if (previewFaces.has(face)) continue;
      const name = face.family.replace(/^(['"])(.*)\1$/, '$2').trim();
      if (name && !name.startsWith('heo-')) names.add(name);
    }
  } catch {
    // A browser without iteration over the font set: none listed.
  }
  return [...names];
}

const loading = new Map<string, Promise<boolean>>();

/**
 * Load a web font for a preview, into the document's font set rather than its head: the page's
 * markup is not touched, so nothing of it can reach a save. The stylesheet is fetched and each
 * `@font-face` in it added as a FontFace. Resolves true once usable, false if it could not be.
 */
export function previewWebFont(font: WebFont, text?: string): Promise<boolean> {
  const href = webFontCss(font, text);
  const known = loading.get(href);
  if (known) return known;
  const job = (async (): Promise<boolean> => {
    try {
      const response = await fetch(href, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) return false;
      const css = await response.text();
      const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
      const added: FontFace[] = [];
      for (const block of faces) {
        const src = /src:\s*([^;]+);/.exec(block)?.[1];
        if (!src || !/url\(\s*['"]?https:\/\/fonts\.gstatic\.com\//.test(src)) continue;
        const descriptor = (name: string): string | undefined => new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
        const face = new FontFace(font.name, src, {
          weight: descriptor('font-weight') ?? 'normal',
          style: descriptor('font-style') ?? 'normal',
          unicodeRange: descriptor('unicode-range') ?? undefined,
          display: 'swap',
        });
        previewFaces.add(face);
        document.fonts.add(face);
        added.push(face);
      }
      await Promise.all(added.map((face) => face.load().catch(() => null)));
      return added.length > 0;
    } catch {
      return false;
    }
  })();
  loading.set(href, job);
  return job;
}
