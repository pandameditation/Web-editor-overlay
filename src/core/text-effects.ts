/**
 * Text effects: gradient letters, glows, hand-drawn underlines, highlights. The text toolbar's
 * "Text effects" menu offers them, and applying one wraps the selected text in a `<span>` (a
 * `<mark>` for a highlight) that carries the effect as inline styles.
 *
 * Each effect is a recipe, not a picture. Most are plain CSS (`background-clip: text`,
 * `text-decoration: wavy`, a filter). The hand-drawn ones are one SVG path each, drawn as the
 * wrapper's background image when the effect is applied, so the page's HTML never holds an
 * `<svg>`: the text stays text for screen readers, copy, search and translation, and the
 * drawing follows each line when it wraps (`box-decoration-break: clone`).
 *
 * The data and the declarations, and the few DOM steps that wrap, unwrap and tidy. No UI.
 */

/** The attribute that says which effect a wrapper carries: kept in the page, it is what finds it again. */
export const TEXT_EFFECT_ATTR = 'data-text-effect';

/** A colour for an effect: two inks for a gradient or a stroke, and a glow. */
export interface EffectColor {
  id: string;
  label: string;
  a: string;
  b: string;
  glow: string;
}

export const EFFECT_COLORS: readonly EffectColor[] = [
  { id: 'violet', label: 'Violet', a: '#6366f1', b: '#ec4899', glow: 'rgb(168 85 247 / 70%)' },
  { id: 'mint', label: 'Mint', a: '#22c55e', b: '#14b8a6', glow: 'rgb(20 184 166 / 70%)' },
  { id: 'sun', label: 'Sun', a: '#f59e0b', b: '#ef4444', glow: 'rgb(245 158 11 / 70%)' },
  { id: 'sky', label: 'Sky', a: '#06b6d4', b: '#818cf8', glow: 'rgb(6 182 212 / 70%)' },
  { id: 'lemon', label: 'Lemon', a: '#fde047', b: '#facc15', glow: 'rgb(250 204 21 / 70%)' },
  { id: 'ink', label: 'Ink', a: '#1f2937', b: '#475569', glow: 'rgb(31 41 55 / 50%)' },
];

export type EffectGroup = 'Text' | 'Underline' | 'Highlight';

/** A drawing: its paths in a viewBox, stroked (or filled), and where it sits under the text. */
interface Doodle {
  viewBox: string;
  paths: readonly string[];
  stroke: number;
  fill?: boolean;
  /** `background-position` and `background-size`, as `position / size`. */
  at: string;
  size: string;
  padding: string;
}

export interface TextEffect {
  id: string;
  group: EffectGroup;
  label: string;
  about: string;
  /** A highlight: wrapped in `<mark>`, which says the words are marked as relevant. */
  mark?: boolean;
  declarations: (color: EffectColor) => Record<string, string>;
}

/** Each wrapped line gets its own drawing, padding and rounding: a stroke does not run off the line's end. */
const CLONE = { '-webkit-box-decoration-break': 'clone', 'box-decoration-break': 'clone' } as const;

/**
 * A drawing as a background image: a tiny SVG, its colours in a gradient, as a data URL. Every
 * `#` is escaped: an unescaped one starts the URL's fragment and cuts the image short (the
 * prototype's first strokes drew nothing for that reason).
 */
function doodleImage(doodle: Doodle, color: EffectColor): string {
  const gradient = `<defs><linearGradient id='g'><stop offset='0' stop-color='${color.a}'/><stop offset='1' stop-color='${color.b}'/></linearGradient></defs>`;
  const paths = doodle.paths
    .map((d) => doodle.fill
      ? `<path d='${d}' fill='url(#g)' fill-opacity='.85'/>`
      : `<path d='${d}' fill='none' stroke='url(#g)' stroke-width='${doodle.stroke}' stroke-linecap='round' stroke-linejoin='round'/>`)
    .join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${doodle.viewBox}' preserveAspectRatio='none'>${gradient}${paths}</svg>`;
  const encoded = svg.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'");
  return `url("data:image/svg+xml,${encoded}")`;
}

const drawn = (doodle: Doodle) => (color: EffectColor): Record<string, string> => ({
  // A <mark>'s own yellow would show under the drawing.
  'background-color': 'transparent',
  'background-image': doodleImage(doodle, color),
  'background-repeat': 'no-repeat',
  'background-position': doodle.at,
  'background-size': doodle.size,
  padding: doodle.padding,
  ...CLONE,
});

const gradientText = (color: EffectColor): Record<string, string> => ({
  background: `linear-gradient(120deg, ${color.a}, ${color.b}) text`,
  color: 'transparent',
  ...CLONE,
});

export const TEXT_EFFECTS: readonly TextEffect[] = [
  { id: 'gradient', group: 'Text', label: 'Gradient', about: 'The letters filled with a gradient', declarations: gradientText },
  {
    id: 'echo', group: 'Text', label: 'Echo', about: 'Gradient letters with an offset copy behind',
    declarations: (color) => ({ ...gradientText(color), filter: 'drop-shadow(0.06em 0.06em 0 #fde68a)' }),
  },
  {
    id: 'glow', group: 'Text', label: 'Glow', about: 'Coloured letters with a soft halo',
    declarations: (color) => ({ color: color.a, 'text-shadow': `0 0 0.35em ${color.glow}` }),
  },
  {
    id: 'outline', group: 'Text', label: 'Outline', about: 'Hollow letters with a coloured outline',
    declarations: (color) => ({ color: 'transparent', '-webkit-text-stroke': `0.035em ${color.a}` }),
  },
  {
    id: 'wavy', group: 'Underline', label: 'Wavy', about: 'The browser\u2019s own underline, wavy',
    declarations: (color) => ({ 'text-decoration': `underline wavy ${color.a}`, 'text-decoration-thickness': '0.07em', 'text-underline-offset': '0.2em' }),
  },
  {
    id: 'arc', group: 'Underline', label: 'Marker arc', about: 'One hand-drawn swoop under the words',
    declarations: drawn({ viewBox: '0 0 200 18', paths: ['M3 13 C 48 4, 138 2, 197 11'], stroke: 5.5, at: '0 100%', size: '100% 0.38em', padding: '0 0 0.2em' }),
  },
  {
    id: 'sketch', group: 'Underline', label: 'Sketchy', about: 'Two quick strokes, as if drawn twice',
    declarations: drawn({ viewBox: '0 0 200 22', paths: ['M4 11 C 52 3, 142 3, 196 10', 'M16 18 C 68 12, 136 13, 186 17'], stroke: 4.5, at: '0 100%', size: '100% 0.46em', padding: '0 0 0.24em' }),
  },
  {
    id: 'squiggle', group: 'Underline', label: 'Squiggle', about: 'A hand-drawn wave',
    declarations: drawn({ viewBox: '0 0 200 18', paths: ['M3 11 Q 22 3, 42 11 T 82 11 T 122 11 T 162 11 T 197 9'], stroke: 4.8, at: '0 100%', size: '100% 0.4em', padding: '0 0 0.2em' }),
  },
  {
    id: 'loop', group: 'Underline', label: 'Loop', about: 'An underline that doubles back on itself',
    declarations: drawn({ viewBox: '0 0 200 20', paths: ['M196 4 C 150 3.6, 60 4.4, 6 5 C 2 5, 2 7.5, 6 7.5 C 70 8, 120 8.6, 140 9.6 C 143 9.8, 143 12, 140 12.1 C 110 13, 70 14.6, 58 17'], stroke: 3.2, at: '0 100%', size: '100% 0.42em', padding: '0 0 0.22em' }),
  },
  {
    id: 'marker', group: 'Highlight', label: 'Marker', about: 'A straight highlighter band', mark: true,
    declarations: (color) => ({ color: 'inherit', background: `linear-gradient(transparent 62%, color-mix(in oklab, ${color.a} 55%, transparent) 0)`, padding: '0 0.08em', ...CLONE }),
  },
  {
    id: 'brush', group: 'Highlight', label: 'Brush', about: 'A rough highlighter stroke behind the words', mark: true,
    declarations: (color) => ({ color: 'inherit', ...drawn({ viewBox: '0 0 200 40', fill: true, paths: ['M4 12 L196 6 L198 20 L190 34 L12 36 L2 26 Z'], stroke: 1, at: '0 80%', size: '100% 0.9em', padding: '0 0.12em' })(color) }),
  },
  {
    id: 'circle', group: 'Highlight', label: 'Circled', about: 'A hand-drawn ring round the words', mark: true,
    declarations: (color) => ({ color: 'inherit', ...drawn({ viewBox: '0 0 200 60', paths: ['M150 6 C 70 0, 6 14, 6 32 C 6 52, 70 58, 120 55 C 170 52, 196 42, 194 28 C 192 12, 150 6, 92 9'], stroke: 3, at: 'center', size: '100% 100%', padding: '0.1em 0.3em' })(color) }),
  },
];

export const EFFECT_GROUPS: readonly EffectGroup[] = ['Text', 'Underline', 'Highlight'];

export const textEffectById = (id: string): TextEffect | undefined => TEXT_EFFECTS.find((one) => one.id === id);
export const effectColorById = (id: string): EffectColor => EFFECT_COLORS.find((one) => one.id === id) ?? EFFECT_COLORS[0]!;

/** An effect's declarations as a style attribute. */
export function effectStyle(effect: TextEffect, color: EffectColor): string {
  return Object.entries(effect.declarations(color)).map(([property, value]) => `${property}: ${value}`).join('; ');
}

/* -------------------------------------------------------------------------- */
/* In the text                                                                 */
/* -------------------------------------------------------------------------- */

/** The zero-width space that holds the caret inside a wrapper nothing has been typed into yet. */
export const CARET_HOLDER = '\u200b';

const BLOCKS = 'address,article,aside,blockquote,dd,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,ul';

/** The effect wrapper a range sits in, inside `host`, or null. */
export function effectWrapperAt(range: Range | null, host: HTMLElement): HTMLElement | null {
  if (!range) return null;
  let at: Node | null = range.commonAncestorContainer;
  if (at.nodeType !== Node.ELEMENT_NODE) at = at.parentElement;
  const found = (at as Element | null)?.closest?.(`[${TEXT_EFFECT_ATTR}]`);
  return found instanceof HTMLElement && host.contains(found) && found !== host ? found : null;
}

/** Whether a range can be wrapped: inline content only, a wrapper cannot hold a paragraph. */
export function wrapsInline(range: Range): boolean {
  if (range.collapsed) return true;
  return !range.cloneContents().querySelector(BLOCKS);
}

/**
 * Wrap the range in a new wrapper made by `make`, or, for a caret, put an empty one there with the
 * caret inside it, so what is typed next goes in. Effect wrappers inside the range are unwrapped
 * first: the new effect replaces theirs rather than nesting. Returns the wrapper.
 */
export function wrapRange(range: Range, make: () => HTMLElement): HTMLElement {
  const el = make();
  if (range.collapsed) {
    el.textContent = CARET_HOLDER;
    range.insertNode(el);
    placeCaret(el.firstChild!, 1);
    return el;
  }
  const contents = range.extractContents();
  for (const inner of Array.from(contents.querySelectorAll<HTMLElement>(`[${TEXT_EFFECT_ATTR}]`))) {
    inner.replaceWith(...Array.from(inner.childNodes));
  }
  el.append(contents);
  range.insertNode(el);
  selectContents(el);
  return el;
}

/** A wrapper as another one, its contents kept: an effect changed on the same text. */
export function rewrap(old: HTMLElement, make: () => HTMLElement): HTMLElement {
  const el = make();
  el.append(...Array.from(old.childNodes));
  old.replaceWith(el);
  selectContents(el);
  return el;
}

/** Take a wrapper away, its contents left where it was and selected. */
export function unwrapEffect(el: HTMLElement): void {
  const first = el.firstChild;
  const last = el.lastChild;
  el.replaceWith(...Array.from(el.childNodes));
  if (!first || !last) return;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Before the edit is read back: the caret holders go, and a wrapper nothing was typed into goes
 * with them, so an effect picked and not used leaves nothing in the page.
 */
export function tidyEffects(host: HTMLElement): void {
  for (const el of Array.from(host.querySelectorAll<HTMLElement>(`[${TEXT_EFFECT_ATTR}]`))) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
    for (const text of texts) {
      if (!text.data.includes(CARET_HOLDER)) continue;
      const kept = text.data.split(CARET_HOLDER).join('');
      if (kept) text.data = kept;
      else text.remove();
    }
    if (!el.textContent && !el.querySelector('img, br, svg, video, picture')) el.remove();
  }
}

function placeCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectContents(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
