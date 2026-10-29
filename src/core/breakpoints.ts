/**
 * Viewport sizes, media-query parsing and the states the editor can author, as plain data.
 *
 * One home for these, because four modules need them — the cascade model sorts rules into sizes,
 * the viewport preview decides which media lists to rewrite, the engine names the media of a rule
 * it creates, and the panel draws the size strip — and a breakpoint restated in two places is two
 * breakpoints the moment one of them is edited. No DOM in here, so the parsing is testable in
 * plain Node (`npm run test:breakpoints`).
 */

export type DeviceIcon = 'phone' | 'tablet' | 'laptop' | 'desktop';

/** A width the preview bar offers, with the device it stands for. */
export interface ViewportPreset {
  width: number;
  icon: DeviceIcon;
  name: string;
  custom?: boolean;
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = Object.freeze([
  { width: 320, icon: 'phone', name: 'Phone' },
  { width: 768, icon: 'tablet', name: 'Tablet' },
  { width: 1024, icon: 'laptop', name: 'Laptop' },
  { width: 1440, icon: 'desktop', name: 'Desktop' },
]);

/**
 * One size a declaration can be written for: a width bound, the device it stands for, and the
 * canonical media text a new rule for it is written with.
 */
export interface SizeSlot {
  /** `phone`, `tablet`, `laptop`, `desktop`, or `from-<width>` for a size the user added. */
  key: string;
  side: 'max' | 'min';
  /**
   * The width where the slot's bound flips: phone covers everything below 768, tablet everything
   * from 768. Comparing this rather than the authored number is what lets `max-width: 767px`,
   * `max-width: 767.98px` and `width < 768px` all land on the same slot.
   */
  breakpoint: number;
  /** Written for new rules, e.g. `(max-width: 767px)`. */
  media: string;
  /** The width that represents the slot when it is previewed. */
  at: number;
  icon: DeviceIcon;
  name: string;
}

export const SIZE_SLOTS: readonly SizeSlot[] = Object.freeze([
  {
    key: 'phone',
    side: 'max',
    breakpoint: 768,
    media: '(max-width: 767px)',
    at: 320,
    icon: 'phone',
    name: 'Phone, up to 767px',
  },
  {
    key: 'tablet',
    side: 'min',
    breakpoint: 768,
    media: '(min-width: 768px)',
    at: 768,
    icon: 'tablet',
    name: 'Tablet and up, from 768px',
  },
  {
    key: 'laptop',
    side: 'min',
    breakpoint: 1024,
    media: '(min-width: 1024px)',
    at: 1024,
    icon: 'laptop',
    name: 'Laptop and up, from 1024px',
  },
  {
    key: 'desktop',
    side: 'min',
    breakpoint: 1440,
    media: '(min-width: 1440px)',
    at: 1440,
    icon: 'desktop',
    name: 'Desktop, from 1440px',
  },
]);

/** How many sizes a user may add to the presets, and the range a preview may take. */
export const MAX_CUSTOM_SIZES = 8;
export const MIN_VIEWPORT = 200;
export const MAX_VIEWPORT = 4000;

/**
 * The preset slots plus one `from-W` slot per size the user added, ordered by width.
 *
 * The one place slots are assembled, so the strip, the model and the save planner cannot disagree
 * about which sizes exist. A custom width that a preset already covers adds nothing.
 */
export function slotsWith(customWidths: readonly number[]): SizeSlot[] {
  const out: SizeSlot[] = [...SIZE_SLOTS];
  for (const width of customWidths) {
    if (!Number.isInteger(width)) continue;
    if (out.some((slot) => slot.side === 'min' && slot.breakpoint === width)) continue;
    out.push({
      key: `from-${width}`,
      side: 'min',
      breakpoint: width,
      media: `(min-width: ${width}px)`,
      at: width,
      icon: iconForWidth(width),
      name: `From ${width}px`,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

/* -------------------------------------------------------------------------- */
/* Media query parsing                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How far inside an exclusive bound the inclusive equivalent sits.
 *
 * `width < 768px` is "up to just under 768", which is what Bootstrap spells `max-width: 767.98px`.
 * Representing the strict bound the same way keeps every caller working with one kind of number.
 */
const STRICT = 0.02;

/** A length in a media query, in CSS px. Media queries resolve `em` against the initial 16px. */
function toPx(number: string, unit: string): number | null {
  const value = Number.parseFloat(number);
  if (!Number.isFinite(value)) return null;
  const lower = unit.toLowerCase();
  if (lower === 'px') return value;
  if (lower === 'em' || lower === 'rem') return value * 16;
  return null;
}

const LENGTH = String.raw`(-?\d*\.?\d+)\s*(px|em|rem)`;
const LEGACY_BOUND = new RegExp(String.raw`^\(\s*(min|max)-width\s*:\s*${LENGTH}\s*\)$`, 'i');
const RANGE_AFTER = new RegExp(String.raw`^\(\s*width\s*(<=|>=|<|>)\s*${LENGTH}\s*\)$`, 'i');
const RANGE_BEFORE = new RegExp(String.raw`^\(\s*${LENGTH}\s*(<=|>=|<|>)\s*width\s*\)$`, 'i');

/**
 * One simple width bound, or null for anything else.
 *
 * Exactly one bound, optionally after `screen and`, `only screen and` or `all and`. Two bounds, a
 * list (`,` or `or`), `not`, or any other feature makes it an "other media query": the editor can
 * show and edit those, but cannot place them on a size.
 */
export function widthBound(media: string): { side: 'max' | 'min'; px: number } | null {
  let text = media.trim();
  if (!text || /,/.test(text)) return null;
  text = text.replace(/^(?:only\s+)?(?:screen|all)\s+and\s+/i, '');
  if (/\b(?:and|or|not)\b/i.test(text)) return null;

  const legacy = LEGACY_BOUND.exec(text);
  if (legacy) {
    const px = toPx(legacy[2], legacy[3]);
    return px === null ? null : { side: legacy[1].toLowerCase() as 'max' | 'min', px };
  }
  const after = RANGE_AFTER.exec(text);
  if (after) return rangeBound(after[1], after[2], after[3], false);
  const before = RANGE_BEFORE.exec(text);
  if (before) return rangeBound(before[3], before[1], before[2], true);
  return null;
}

/** `width OP X`, or `X OP width` when `reversed`, as one inclusive bound. */
function rangeBound(
  operator: string,
  number: string,
  unit: string,
  reversed: boolean,
): { side: 'max' | 'min'; px: number } | null {
  const px = toPx(number, unit);
  if (px === null) return null;
  // `X < width` says the same as `width > X`.
  const op = reversed ? ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' } as const)[operator as '<'] : operator;
  if (op === '<=') return { side: 'max', px };
  if (op === '<') return { side: 'max', px: px - STRICT };
  if (op === '>=') return { side: 'min', px };
  return { side: 'min', px: px + STRICT };
}

/**
 * The first width a bound covers (`min`) or no longer covers (`max`), as an integer.
 *
 * `max-width: 767px`, `max-width: 767.98px` and `width < 768px` are all 768; `min-width: 768px`
 * and `min-width: 48em` are 768 too.
 */
export function breakpointOf(media: string): number | null {
  const bound = widthBound(media);
  if (!bound) return null;
  return bound.side === 'min' ? Math.ceil(bound.px) : Math.floor(bound.px) + 1;
}

/**
 * The slot a media query belongs to, tolerantly.
 *
 * Side and breakpoint have to match, nothing else, so a framework's `767.98px` lands on phone
 * instead of under "other media queries".
 */
export function slotForMedia(media: string, slots: readonly SizeSlot[]): SizeSlot | null {
  const bound = widthBound(media);
  if (!bound) return null;
  const at = breakpointOf(media);
  return slots.find((slot) => slot.side === bound.side && slot.breakpoint === at) ?? null;
}

/** A media query short enough for a chip: `≤767px`, `≥768px`, or the text without parentheses. */
export function mediaShort(media: string): string {
  const bound = widthBound(media);
  const at = breakpointOf(media);
  if (bound && at !== null) return bound.side === 'max' ? `≤${at - 1}px` : `≥${at}px`;
  return media.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
}

/** The device a width belongs to: under 600 a phone, under 1000 a tablet, under 1300 a laptop. */
export function iconForWidth(px: number): DeviceIcon {
  if (px < 600) return 'phone';
  if (px < 1000) return 'tablet';
  if (px < 1300) return 'laptop';
  return 'desktop';
}

/**
 * The icon a media query is drawn with.
 *
 * An upper bound always reads as "the small screens", so it is a phone whatever the number; a
 * lower bound is the device it starts at. Print has its own icon, and anything else is a window.
 */
export function mediaIcon(media: string): DeviceIcon | 'print' | 'window' {
  const bound = widthBound(media);
  if (bound) return bound.side === 'max' ? 'phone' : iconForWidth(bound.px);
  return /\bprint\b/i.test(media) ? 'print' : 'window';
}

/**
 * The width to preview when the user picks a media query, or null when it is not a width query.
 *
 * The widest preset an upper bound holds, or the narrowest a lower bound holds, so picking
 * `≤767px` previews the phone and `≥768px` the tablet. With no preset inside the bound, the
 * bound itself.
 */
export function previewWidthFor(media: string, presets: readonly ViewportPreset[]): number | null {
  const bound = widthBound(media);
  if (!bound) return null;
  const fits = presets
    .map((preset) => preset.width)
    .filter((width) => (bound.side === 'max' ? width <= bound.px : width >= bound.px));
  if (bound.side === 'max') return fits.length ? Math.max(...fits) : Math.floor(bound.px);
  return fits.length ? Math.min(...fits) : Math.ceil(bound.px);
}

/**
 * Whether a media query depends on the viewport's size.
 *
 * The filter for what the preview rewrites: print, `prefers-*` and `hover` queries keep their real
 * answer, because the preview changes the width and nothing else.
 */
export function isWidthQuery(media: string): boolean {
  return /\b(?:min-|max-)?(?:device-)?(?:width|height|aspect-ratio)\b|\borientation\b/i.test(media);
}

/* -------------------------------------------------------------------------- */
/* States and pseudo-elements                                                  */
/* -------------------------------------------------------------------------- */

/** The states and pseudo-elements offered by "Add state", in the order they are offered. */
export const EDITABLE_STATES: readonly { name: string; kind: 'state' | 'pseudo-element' }[] =
  Object.freeze([
    { name: ':hover', kind: 'state' },
    { name: ':focus', kind: 'state' },
    { name: ':focus-visible', kind: 'state' },
    { name: ':focus-within', kind: 'state' },
    { name: ':active', kind: 'state' },
    { name: ':disabled', kind: 'state' },
    { name: '::before', kind: 'pseudo-element' },
    { name: '::after', kind: 'pseudo-element' },
    { name: '::placeholder', kind: 'pseudo-element' },
    { name: '::marker', kind: 'pseudo-element' },
    { name: '::selection', kind: 'pseudo-element' },
  ]);

/**
 * Whether a state string draws a pseudo-element rather than styling the element in a state.
 *
 * Any `::`, so `:hover::before` counts, plus the four that predate the double colon.
 */
export function isPseudoElement(state: string): boolean {
  return /::/.test(state) || /(?:^|[^:]):(?:before|after|first-line|first-letter)$/i.test(state);
}

/**
 * `::before` and `::after`, in either spelling and after any state: the two pseudo-elements that
 * render nothing until they have `content`.
 */
export function needsGeneratedContent(state: string): boolean {
  return /(?:^|[^:])::?(?:before|after)$/i.test(state);
}
