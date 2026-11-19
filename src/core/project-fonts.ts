import { ManagedStyleSheet } from './stylesheet.js';
import { WEB_FONTS, type FontCategory, type WebFont } from './fonts.js';

/**
 * The web fonts a page carries itself.
 *
 * A Google font is not linked from Google: its files are fetched once and kept with the page, as
 * the design files are — embedded as `data:` URLs, or stored beside the page in the fonts folder —
 * and its `@font-face` rules are written into the design system's managed CSS. So nothing a visitor
 * loads asks Google for anything, and the page renders the same on every machine.
 *
 * A font is made of faces: one file per style and character set. A variable font has one file per
 * style (upright, italic) that holds every weight; a static one has one per weight and style.
 *
 * The rules are written so the page can be read back: an embedded face's URL carries its name as
 * a `heo-font` parameter of the data URL, and a stored one is named `<family>-<style>-<set>.woff2`.
 * That is how a reload tells these faces from the page's own `@font-face` rules (`readProjectFonts`)
 * without a marker the CSSOM would drop.
 */

/** A style a font is offered in: `upright` / `italic` for a variable font, `400` / `700i` for a static one. */
export type FontStyleKey = string;

export interface ProjectFontFace {
  style: FontStyleKey;
  /** The character set, as Google names it: `latin`, `latin-ext`, `cyrillic`… */
  subset: string;
  /** `400`, or a range for a variable face: `100 900`. */
  weight: string;
  fontStyle: 'normal' | 'italic';
  unicodeRange?: string;
  /** The file: a `data:` URL, or a path relative to the page. */
  src: string;
}

export interface ProjectFont {
  family: string;
  category: FontCategory;
  styles: FontStyleKey[];
  subsets: string[];
  place: 'embedded' | 'stored';
  faces: ProjectFontFace[];
}

/** A face's file name, without a folder: `lora-italic-latin-ext.woff2`. */
export function fontFileName(family: string, style: FontStyleKey, subset: string): string {
  return `${fontSlug(family)}-${style}-${subset}.woff2`;
}

export function fontSlug(family: string): string {
  return family.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
}

/** The parameter an embedded face's data URL carries its name in. */
const EMBED_PARAM = 'heo-font';

/** A face's bytes as a data URL that names it: `data:font/woff2;heo-font=lora-upright-latin;base64,…`. */
export function embeddedFontUrl(bytes: Uint8Array, name: string): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return `data:font/woff2;${EMBED_PARAM}=${name.replace(/\.woff2$/, '')};base64,${btoa(binary)}`;
}

/** The face name a URL written here carries, or null for anyone else's. */
export function managedFaceName(src: string): string | null {
  const embedded = new RegExp(`^data:font/woff2;${EMBED_PARAM}=([a-z0-9-]+);base64,`, 'i').exec(src);
  if (embedded) return embedded[1];
  const stored = /(?:^|\/)([a-z0-9-]+-(?:upright|italic|\d{3}i?)-[a-z-]+)\.woff2(?:[?#].*)?$/i.exec(src);
  return stored ? stored[1] : null;
}

/* -------------------------------------------------------------------------- */
/* Styles and character sets                                                   */
/* -------------------------------------------------------------------------- */

const isVariable = (font: WebFont): boolean => font.weights.includes('..');

/** What a style is called in the popover: `Upright`, `Italic`, `700`, `700 italic`. */
export function styleLabel(style: FontStyleKey): string {
  if (style === 'upright') return 'Upright';
  if (style === 'italic') return 'Italic';
  return style.endsWith('i') ? `${style.slice(0, -1)} italic` : style;
}

export const isItalicStyle = (style: FontStyleKey): boolean => style === 'italic' || /^\d+i$/.test(style);

/** The styles a catalogue font comes in, before Google says whether it has italics. */
export function catalogueStyles(font: WebFont, italic = true): FontStyleKey[] {
  if (isVariable(font)) return italic ? ['upright', 'italic'] : ['upright'];
  const weights = font.weights.split(';').map((one) => one.trim()).filter(Boolean);
  return [...weights, ...(italic ? weights.map((one) => `${one}i`) : [])];
}

/** What a new font starts with: its regular style, and its italic when it has one. */
export function defaultStyles(available: readonly FontStyleKey[]): FontStyleKey[] {
  const regular = available.filter((one) => one === 'upright' || one === 'italic' || one === '400' || one === '400i');
  return regular.length ? regular : available.slice(0, 1);
}

export const SUBSET_LABELS: Record<string, string> = {
  latin: 'Latin',
  'latin-ext': 'Latin extended (é, ł, ő…)',
  cyrillic: 'Cyrillic',
  'cyrillic-ext': 'Cyrillic extended',
  greek: 'Greek',
  'greek-ext': 'Greek extended',
  vietnamese: 'Vietnamese',
};

/** The character sets worth offering, in this order; Google's others (math, symbols) are left out. */
export const OFFERED_SUBSETS = Object.keys(SUBSET_LABELS);

/**
 * The CSS2 API stylesheet for some of a font's styles, every character set included.
 *
 * Tuples sorted as the API wants them, italics last: `ital,wght@0,400..700;1,400..700`.
 */
export function fontCssUrl(font: WebFont, styles: readonly FontStyleKey[]): string {
  const family = encodeURIComponent(font.name).replace(/%20/g, '+');
  const italic = styles.some(isItalicStyle);
  const upright = styles.some((one) => !isItalicStyle(one));
  let axis: string;
  if (isVariable(font)) {
    const tuples = [...(upright ? [`0,${font.weights}`] : []), ...(italic ? [`1,${font.weights}`] : [])];
    axis = `:ital,wght@${tuples.join(';')}`;
  } else {
    const weights = (list: FontStyleKey[]) => [...new Set(list.map((one) => one.replace(/i$/, '')))].sort((a, b) => Number(a) - Number(b));
    const ups = weights(styles.filter((one) => !isItalicStyle(one)));
    const its = weights(styles.filter(isItalicStyle));
    const single = font.weights.split(';').length === 1;
    axis = single
      ? `:ital@${[...(ups.length ? ['0'] : []), ...(its.length ? ['1'] : [])].join(';')}`
      : `:ital,wght@${[...ups.map((w) => `0,${w}`), ...its.map((w) => `1,${w}`)].join(';')}`;
  }
  return `https://fonts.googleapis.com/css2?family=${family}${axis}&display=swap`;
}

/** One face of Google's stylesheet, before its file is fetched. */
export interface GoogleFace {
  style: FontStyleKey;
  subset: string;
  weight: string;
  fontStyle: 'normal' | 'italic';
  unicodeRange?: string;
  url: string;
}

/**
 * Google's stylesheet as faces. Each `@font-face` follows a comment naming its character set
 * (`/* latin-ext *\/`), which is the only place that name is written.
 */
export function parseGoogleCss(css: string, font: WebFont): GoogleFace[] {
  const out: GoogleFace[] = [];
  const variable = isVariable(font);
  for (const match of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi)) {
    const subset = match[1].toLowerCase();
    const body = match[2];
    const read = (name: string): string | undefined => new RegExp(`${name}\\s*:\\s*([^;]+);`, 'i').exec(body)?.[1]?.trim();
    const url = /url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^'")\s]+)['"]?\s*\)/i.exec(body)?.[1];
    if (!url) continue;
    const fontStyle = read('font-style') === 'italic' ? 'italic' : 'normal';
    const weight = read('font-weight') ?? '400';
    const style = variable ? (fontStyle === 'italic' ? 'italic' : 'upright') : `${weight.split(/\s+/)[0]}${fontStyle === 'italic' ? 'i' : ''}`;
    out.push({ style, subset, weight, fontStyle, unicodeRange: read('unicode-range'), url });
  }
  return out;
}

/** The catalogue entry for a family, if it is one. */
export function catalogueFont(family: string): WebFont | undefined {
  const name = family.trim().toLowerCase();
  return WEB_FONTS.find((one) => one.name.toLowerCase() === name);
}

/* -------------------------------------------------------------------------- */
/* CSS                                                                         */
/* -------------------------------------------------------------------------- */

const quoteUrl = (url: string): string => `"${url.replace(/["\\]/g, (c) => `\\${c}`)}"`;

/** A font's `@font-face` rules. */
export function fontFaceCss(font: ProjectFont): string {
  return font.faces
    .map((face) => [
      '@font-face {',
      `  font-family: "${font.family.replace(/["\\]/g, '')}";`,
      `  font-style: ${face.fontStyle};`,
      `  font-weight: ${face.weight};`,
      '  font-display: swap;',
      `  src: url(${quoteUrl(face.src)}) format("woff2");`,
      ...(face.unicodeRange ? [`  unicode-range: ${face.unicodeRange};`] : []),
      '}',
    ].join('\n'))
    .join('\n');
}

/** One `@font-face` as the page has it, read off a live rule. */
export interface ReadFace {
  family: string;
  fontStyle: string;
  weight: string;
  unicodeRange?: string;
  src: string;
}

/**
 * The project fonts among a page's `@font-face` rules: faces of a catalogue family whose files
 * were written here (see `managedFaceName`). A family with any face of someone else's is the
 * page's own and is left out, so editing it can never drop a face the author wrote.
 */
export function readProjectFonts(faces: readonly ReadFace[]): ProjectFont[] {
  const byFamily = new Map<string, ReadFace[]>();
  for (const face of faces) {
    const family = face.family.replace(/^(['"])(.*)\1$/, '$2').trim();
    byFamily.set(family, [...(byFamily.get(family) ?? []), { ...face, family }]);
  }
  const out: ProjectFont[] = [];
  for (const [family, list] of byFamily) {
    const font = catalogueFont(family);
    if (!font) continue;
    const named = list.map((face) => ({ face, name: managedFaceName(face.src) }));
    if (named.some((one) => !one.name)) continue;
    const slug = fontSlug(font.name);
    const parsed: ProjectFontFace[] = [];
    for (const { face, name } of named) {
      const rest = name!.startsWith(`${slug}-`) ? name!.slice(slug.length + 1) : null;
      const parts = rest ? /^(upright|italic|\d{3}i?)-([a-z-]+)$/.exec(rest) : null;
      if (!parts) continue;
      parsed.push({
        style: parts[1],
        subset: parts[2],
        weight: face.weight || '400',
        fontStyle: face.fontStyle === 'italic' ? 'italic' : 'normal',
        unicodeRange: face.unicodeRange || undefined,
        src: face.src,
      });
    }
    if (!parsed.length) continue;
    // De-duplicated: the managed sheet and the saved copy it was read from hold the same faces.
    const unique = [...new Map(parsed.map((face) => [`${face.style}|${face.subset}`, face])).values()];
    out.push({
      family: font.name,
      category: font.category,
      styles: [...new Set(unique.map((face) => face.style))],
      subsets: [...new Set(unique.map((face) => face.subset))],
      place: unique.every((face) => face.src.startsWith('data:')) ? 'embedded' : 'stored',
      faces: unique,
    });
  }
  return out;
}

/** A face as the CSSOM serialises it: the URL out of `src`, unquoted. */
export function faceFromRule(rule: CSSFontFaceRule): ReadFace | null {
  const style = rule.style;
  const src = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(style.getPropertyValue('src'))?.[2];
  const family = style.getPropertyValue('font-family');
  if (!src || !family) return null;
  return {
    family,
    fontStyle: style.getPropertyValue('font-style') || 'normal',
    weight: style.getPropertyValue('font-weight') || '400',
    unicodeRange: style.getPropertyValue('unicode-range') || undefined,
    src,
  };
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

export const FONT_STYLE_ID = 'heo-design-fonts';

/**
 * The page's project fonts, by family, and the managed sheet their `@font-face` rules live in.
 *
 * Read back on load from the page's own sheets (`scanDocument`), so a saved font is a project font
 * again in the next session: its rules are then written from here, and a save rebuilds the managed
 * section with them rather than leaving the earlier copy behind.
 */
export class FontRegistry {
  #fonts = new Map<string, ProjectFont>();
  #sheet = new ManagedStyleSheet(FONT_STYLE_ID);
  #listeners = new Set<() => void>();

  scanDocument(): void {
    const faces: ReadFace[] = [];
    const visit = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const face = faceFromRule(rule);
          if (face) faces.push(face);
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-generated')) continue;
      try {
        visit(sheet.cssRules);
      } catch {
        // Cross-origin: not a sheet a save of this editor wrote.
      }
    }
    let changed = false;
    for (const font of readProjectFonts(faces)) {
      if (this.#fonts.has(font.family)) continue;
      this.#fonts.set(font.family, font);
      changed = true;
    }
    if (changed) this.#flush();
  }

  list(): ProjectFont[] {
    return [...this.#fonts.values()].sort((a, b) => a.family.localeCompare(b.family));
  }

  get(family: string): ProjectFont | undefined {
    const name = family.trim().toLowerCase();
    return [...this.#fonts.values()].find((one) => one.family.toLowerCase() === name);
  }

  has(family: string): boolean {
    return Boolean(this.get(family));
  }

  upsert(font: ProjectFont): void {
    const existing = this.get(font.family);
    if (existing) this.#fonts.delete(existing.family);
    this.#fonts.set(font.family, { ...font, faces: font.faces.map((face) => ({ ...face })) });
    this.#flush();
  }

  remove(family: string): ProjectFont | undefined {
    const existing = this.get(family);
    if (!existing) return undefined;
    this.#fonts.delete(existing.family);
    this.#flush();
    return existing;
  }

  toCSS(): string {
    return this.list().map(fontFaceCss).join('\n');
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  destroy(): void {
    this.#sheet.destroy();
    this.#listeners.clear();
    this.#fonts.clear();
  }

  #flush(): void {
    this.#sheet.write(this.toCSS());
    for (const listener of this.#listeners) listener();
  }
}
