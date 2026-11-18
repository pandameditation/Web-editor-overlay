import type { DesignClass } from './types.js';

/**
 * Text styles: named groups of typography declarations, kept in the design system as classes.
 *
 * CSS has no multi-property token, but it has the class, so a text style is one: `.text-heading-1`
 * with its font, size, spacing and the rest. What tells it apart from any other class is one
 * declaration in it, `--heo-text-style: "Heading 1"`, which also carries its name. It is written
 * into the class itself rather than kept beside it, so it survives every way a class travels —
 * the page's design CSS, a save to disk and a reload that scans it back, the seed, an export — and
 * nothing else has to remember which classes are styles. A custom property is inert: it inherits,
 * but nothing reads it but the editor, and only off the class's own rule.
 */

export const TEXT_STYLE_MARKER = '--heo-text-style';

/** The properties a text style holds and the Typography section edits, in the section's order. */
export const TYPOGRAPHY_PROPERTIES: readonly string[] = [
  'color',
  'font-family',
  'font-weight',
  'font-style',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-underline-offset',
  'text-decoration-color',
  'text-align',
  'text-transform',
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
  '-webkit-text-stroke',
  'text-shadow',
  // Fine-tuning.
  'text-wrap',
  'hyphens',
  'text-indent',
  'font-variant-numeric',
  'font-variant-caps',
  'font-variant-ligatures',
];

/** Shorthands that set some of them: removed with them, so an old `text-decoration` cannot win over a style. */
export const TYPOGRAPHY_SHORTHANDS: readonly string[] = ['text-decoration', 'font', 'font-variant'];

const isTypography = (property: string): boolean => {
  const name = property.trim().toLowerCase();
  return TYPOGRAPHY_PROPERTIES.includes(name) || TYPOGRAPHY_SHORTHANDS.includes(name);
};
export { isTypography };

/** Whether a class is a text style. */
export function isTextStyle(entry: Pick<DesignClass, 'declarations'> | undefined | null): boolean {
  return Boolean(entry && TEXT_STYLE_MARKER in entry.declarations);
}

/** A text style's name, from its marker: `Heading 1`. Falls back to the class's label. */
export function textStyleName(entry: DesignClass): string {
  const raw = entry.declarations[TEXT_STYLE_MARKER]?.trim() ?? '';
  const quoted = /^(['"])(.*)\1$/.exec(raw);
  const name = (quoted ? quoted[2] : raw).replace(/\\(.)/g, '$1').trim();
  return name || entry.label || entry.name;
}

/** The marker's value for a name, as a CSS string. */
export function textStyleMarker(name: string): string {
  return `"${name.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The class a new text style called `name` gets: `text-heading-1`. */
export function textStyleClass(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `text-${slug || 'style'}`;
}

/** A style's typography declarations, without its marker: what it applies. */
export function textStyleDeclarations(entry: DesignClass): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [property, value] of Object.entries(entry.declarations)) {
    if (property === TEXT_STYLE_MARKER || !value.trim()) continue;
    out[property] = value;
  }
  return out;
}

/** The declarations a style is stored with: its typography, and its marker last. */
export function storedTextStyle(name: string, declarations: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [property, value] of Object.entries(declarations)) {
    if (property === TEXT_STYLE_MARKER || !value.trim() || !isTypography(property)) continue;
    out[property] = value.trim();
  }
  out[TEXT_STYLE_MARKER] = textStyleMarker(name);
  return out;
}

/**
 * A name proposed for saving: the style it came from with " alt", or "Text style", made unique
 * against the names already taken (case-insensitively, as the dialog matches them).
 */
export function proposedTextStyleName(from: string | null, taken: readonly string[]): string {
  const base = from ? `${from} alt` : 'Text style';
  const used = new Set(taken.map((one) => one.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now().toString(36)}`;
}
