import {
  iconForWidth,
  MAX_CUSTOM_SIZES,
  MAX_VIEWPORT,
  mediaShort,
  MIN_VIEWPORT,
  VIEWPORT_PRESETS,
  widthBound,
  type DeviceIcon,
} from './breakpoints.js';

/**
 * The viewport sizes the preview bar offers, as plain data.
 *
 * Three kinds, one list. The four presets; one size per width media query the page writes, at the
 * width it switches (`≤520px` is 520, `≥768px` is 768), so a page's own breakpoints can be put in
 * the bar without being typed; and the sizes the user added, which also add a breakpoint to write
 * rules at. The bar shows the presets and the user's sizes by default, and none of the page's: a
 * page with a dozen breakpoints would otherwise fill it. The user can show or hide any of them and
 * give a preset another width (a page size keeps its media query's); those choices are `ViewportEdit`s, keyed by the width
 * the size started at, and they travel in the seed with the rest of the settings. A user's own size is edited by moving it, since its
 * width is its breakpoint. No DOM in here: the page's media queries are handed in.
 */

export type ViewportOrigin = 'preset' | 'page' | 'custom';

/**
 * A change to one size: another width, hidden from the bar, or (a page size, hidden by default)
 * shown in it. Keyed by the width it started at.
 */
export interface ViewportEdit {
  base: number;
  width?: number;
  hidden?: boolean;
  shown?: boolean;
}

export interface Viewport {
  /** `<origin>:<base>`, stable while the width is being edited. */
  key: string;
  origin: ViewportOrigin;
  /** The width it started at: the preset's, the media query's, or the user's own. */
  base: number;
  width: number;
  shown: boolean;
  name: string;
  icon: DeviceIcon;
  /** The page's media query a `page` size stands for. */
  media?: string;
}

/** At most this many edits are kept: one per preset, page size and custom size is far below it. */
const MAX_EDITS = 48;

const inRange = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= MIN_VIEWPORT && (value as number) <= MAX_VIEWPORT;

/**
 * Edits fit to keep: a base and width in range, unique bases, and nothing that changes nothing.
 * Anything else is dropped silently, as other settings are.
 */
export function viewportEditsOf(input: unknown): readonly ViewportEdit[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<number>();
  const out: ViewportEdit[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const { base, width, hidden, shown } = raw as Record<string, unknown>;
    if (!inRange(base) || seen.has(base)) continue;
    const edit: ViewportEdit = { base };
    if (inRange(width) && width !== base) edit.width = width;
    if (hidden === true) edit.hidden = true;
    else if (shown === true) edit.shown = true;
    if (edit.width === undefined && !edit.hidden && !edit.shown) continue;
    seen.add(base);
    out.push(Object.freeze(edit));
    if (out.length >= MAX_EDITS) break;
  }
  return Object.freeze(out.sort((a, b) => a.base - b.base));
}

/**
 * The width each single width bound switches at, once per width, in the page's order.
 *
 * An upper bound is the widest width it still holds (`max-width: 767.98px` is 767), a lower bound
 * the narrowest (`min-width: 48em` is 768). Two bounds, print, preferences and the rest are not
 * sizes and give none.
 */
export function pageViewportWidths(media: readonly string[]): Array<{ width: number; media: string }> {
  const out: Array<{ width: number; media: string }> = [];
  for (const text of media) {
    const bound = widthBound(text);
    if (!bound) continue;
    const width = bound.side === 'max' ? Math.floor(bound.px) : Math.ceil(bound.px);
    if (!inRange(width) || out.some((one) => one.width === width)) continue;
    out.push({ width, media: text });
  }
  return out;
}

/**
 * Every size, by width: presets, the user's own, then the page's, with the edits applied.
 *
 * A width already offered is not offered twice: a page's `≥768px` is the tablet preset, and a
 * user's 1280 written in the page as well is the user's.
 */
export function viewportList(
  custom: readonly number[],
  edits: readonly ViewportEdit[],
  pageMedia: readonly string[],
): Viewport[] {
  const byBase = new Map(edits.map((edit) => [edit.base, edit]));
  const out: Viewport[] = [];
  const add = (origin: ViewportOrigin, base: number, name: string, icon: DeviceIcon | null, media?: string): void => {
    if (out.some((one) => one.base === base)) return;
    const edit = origin === 'custom' ? { base, hidden: byBase.get(base)?.hidden } : byBase.get(base);
    // A page size is its media query's width: only whether it is shown can change.
    const width = origin === 'page' ? base : edit?.width ?? base;
    out.push({
      key: `${origin}:${base}`,
      origin,
      base,
      width,
      // A page size waits to be asked for; the rest are in the bar until hidden.
      shown: origin === 'page' ? edit?.shown === true : !edit?.hidden,
      name,
      icon: icon ?? iconForWidth(width),
      ...(media ? { media } : {}),
    });
  };
  for (const preset of VIEWPORT_PRESETS) add('preset', preset.width, preset.name, preset.icon);
  for (const width of custom.slice(0, MAX_CUSTOM_SIZES)) add('custom', width, 'Custom', null);
  for (const one of pageViewportWidths(pageMedia)) add('page', one.width, mediaShort(one.media), null, one.media);
  return sortViewports(out);
}

/** By width; at one width, a preset before a user's size before a page's. */
export function sortViewports(list: readonly Viewport[]): Viewport[] {
  const rank: Record<ViewportOrigin, number> = { preset: 0, custom: 1, page: 2 };
  return [...list].sort((a, b) => a.width - b.width || rank[a.origin] - rank[b.origin]);
}

/**
 * A list as settings: the user's sizes at their widths, and an edit for every other size whose
 * width or visibility is not what it started as. A hidden user size is kept as an edit on its width.
 */
export function viewportSettingsOf(list: readonly Viewport[]): {
  viewportSizes: number[];
  viewportEdits: ViewportEdit[];
} {
  const viewportSizes = list
    .filter((one) => one.origin === 'custom')
    .map((one) => one.width)
    .sort((a, b) => a - b);
  const viewportEdits: ViewportEdit[] = [];
  for (const one of list) {
    if (one.origin === 'custom') {
      if (!one.shown) viewportEdits.push({ base: one.width, hidden: true });
      continue;
    }
    const edit: ViewportEdit = { base: one.base };
    if (one.width !== one.base) edit.width = one.width;
    if (one.origin === 'page' ? one.shown : !one.shown) {
      if (one.origin === 'page') edit.shown = true;
      else edit.hidden = true;
    }
    if (edit.width !== undefined || edit.hidden || edit.shown) viewportEdits.push(edit);
  }
  return { viewportSizes, viewportEdits: viewportEdits.sort((a, b) => a.base - b.base) };
}
