import { composite, parseColor, type Rgba } from '../core/color.js';
import { splitTop } from '../core/background.js';

/**
 * What a colour being picked is measured against, for the picker's contrast check.
 *
 * A text colour is measured against what is behind the text: the element's own background and,
 * where that is translucent or missing, its ancestors', down to the first opaque one (or the white
 * canvas). Gradients count by their stops and images by their sampled pixels, and the worst of them
 * is the ratio shown, since text has to be readable over every part of what it sits on.
 *
 * A background colour is measured the other way round, against the element's text colour, laid
 * over what is under the element when the pick is translucent. A border or outline colour is
 * non-text (WCAG 1.4.11, 3:1) against what is behind it.
 */
export interface ContrastTarget {
  /** Whether the colour being picked is the foreground (text, line) or the background. */
  picked: 'foreground' | 'background';
  kind: 'text' | 'large-text' | 'non-text';
  /** The other side: the backdrop's colours for a foreground, the text colour for a background. */
  others: Rgba[];
  /** Under a picked background: what a translucent pick is laid over. */
  under: Rgba[];
  /** What the others are, said in a few words: "text colour", "gradient · 3 colours". */
  label: string;
  /** Set while an image is being sampled; resolves to the target with its pixels counted. */
  pending?: Promise<ContrastTarget>;
  /** Why part of the backdrop could not be read (a cross-origin image), when one could not. */
  unread?: string;
}

/** Whose colours a picker measures against: the Styles panel's element, while it has one. */
let subject: (() => HTMLElement | null) | null = null;

export function setContrastSubject(next: (() => HTMLElement | null) | null): void {
  subject = next;
}

const TEXT = new Set(['color', '-webkit-text-fill-color']);
const BACKGROUND = new Set(['background-color', 'background']);
const NON_TEXT = /^(?:border(?:-(?:top|right|bottom|left))?-color|outline-color|column-rule-color|text-decoration-color|caret-color|accent-color|fill|stroke)$/;

/** The target for a field editing `property`, or null when contrast is not a question for it. */
export function contrastTargetFor(property: string): ContrastTarget | null {
  const el = subject?.();
  if (!el?.isConnected) return null;
  const name = property.trim().toLowerCase();
  const kind = TEXT.has(name) || BACKGROUND.has(name) ? textKind(el) : NON_TEXT.test(name) ? 'non-text' : null;
  if (!kind) return null;
  if (BACKGROUND.has(name)) {
    const text = resolveColor(getComputedStyle(el).color);
    if (!text) return null;
    const under = backdrop(el.parentElement);
    return finish({ picked: 'background', kind, others: [text], under: under.colours, label: 'text colour' }, under, 'under');
  }
  const behind = backdrop(el);
  return finish({ picked: 'foreground', kind, others: behind.colours, under: [], label: behind.label }, behind, 'others');
}

/** Large text in WCAG's sense: 24px, or 18.66px and bold. */
function textKind(el: HTMLElement): 'text' | 'large-text' {
  const style = getComputedStyle(el);
  const size = parseFloat(style.fontSize) || 16;
  const bold = (parseInt(style.fontWeight, 10) || 400) >= 700;
  return size >= 24 || (bold && size >= 18.66) ? 'large-text' : 'text';
}

/** A target, with its image sampling (if any) as a promise of the completed one. */
function finish(target: ContrastTarget, behind: Backdrop, side: 'others' | 'under'): ContrastTarget {
  if (!behind.images.length) return target;
  return {
    ...target,
    pending: behind.complete().then((done) => ({
      ...target,
      [side]: done.colours,
      label: side === 'others' ? done.label : target.label,
      unread: done.unread,
    })),
  };
}

interface Layer {
  color: Rgba | null;
  /** Top first, as CSS lists them. */
  images: string[];
}

interface Backdrop {
  colours: Rgba[];
  label: string;
  images: string[];
  complete: () => Promise<{ colours: Rgba[]; label: string; unread?: string }>;
}

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
const MAX_COLOURS = 48;

/**
 * Everything that can be behind a point of `from`: each background from `from` up to the first
 * opaque one, laid over each other bottom up. Images are left out until sampled.
 */
function backdrop(from: Element | null): Backdrop {
  const layers: Layer[] = [];
  for (let node: Element | null = from; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const color = resolveColor(style.backgroundColor);
    const images = splitTop(style.backgroundImage, ',').filter((one) => one && one !== 'none');
    if ((color && color.a > 0) || images.length) layers.push({ color, images });
    if (color && color.a >= 1) break;
  }
  const build = (sampled: Map<string, Rgba[] | null>): { colours: Rgba[]; label: string; unread?: string } => {
    let colours: Rgba[] = [WHITE];
    let gradients = 0;
    let pictures = 0;
    let unread: string | undefined;
    for (const layer of [...layers].reverse()) {
      if (layer.color && layer.color.a > 0) colours = colours.map((under) => composite(layer.color!, under));
      for (const image of [...layer.images].reverse()) {
        const stops = /^url\(/i.test(image) ? sampled.get(urlOf(image)) : gradientColours(image);
        if (/^url\(/i.test(image)) {
          if (stops === undefined) continue;
          if (stops === null) {
            unread = 'An image could not be read (another site’s, served without CORS): it is left out.';
            continue;
          }
          pictures += 1;
        } else {
          gradients += 1;
        }
        if (!stops?.length) continue;
        colours = distinct(stops.flatMap((stop) => colours.map((under) => composite(stop, under))));
      }
    }
    const parts = [
      gradients ? `gradient${gradients > 1 ? 's' : ''}` : '',
      pictures ? `image${pictures > 1 ? 's' : ''}` : '',
    ].filter(Boolean);
    const label = parts.length ? `${parts.join(' and ')} · ${colours.length} colour${colours.length === 1 ? '' : 's'}` : 'background';
    return { colours, label, unread };
  };
  const urls = layers.flatMap((layer) => layer.images.filter((image) => /^url\(/i.test(image)).map(urlOf));
  return {
    ...build(new Map()),
    images: urls,
    complete: async () => {
      const sampled = new Map<string, Rgba[] | null>();
      await Promise.all(urls.map(async (url) => sampled.set(url, await sampleImage(url))));
      return build(sampled);
    },
  };
}

/** The colours a gradient is made of, as the browser serialises them (`rgb(…)`, `oklch(…)`). */
function gradientColours(image: string): Rgba[] {
  const found = image.match(/(?:rgba?|oklch|oklab|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi) ?? [];
  return found.map((one) => parseColor(one)).filter((one): one is Rgba => Boolean(one));
}

const urlOf = (image: string): string => /^url\(\s*["']?(.*?)["']?\s*\)$/i.exec(image)?.[1] ?? '';

/** Fewer colours, closest ones merged: an image's pixels are mostly near-repeats. */
function distinct(colours: Rgba[]): Rgba[] {
  const seen = new Map<string, Rgba>();
  for (const colour of colours) {
    const key = [colour.r, colour.g, colour.b].map((c) => Math.round(c * 31)).join(',');
    if (!seen.has(key)) seen.set(key, colour);
  }
  const out = [...seen.values()];
  if (out.length <= MAX_COLOURS) return out;
  // Keep the spread: the darkest and lightest matter most to a contrast check.
  out.sort((a, b) => a.r + a.g + a.b - (b.r + b.g + b.b));
  const step = out.length / MAX_COLOURS;
  return Array.from({ length: MAX_COLOURS }, (_, i) => out[Math.min(out.length - 1, Math.round(i * step))]!).concat(out[out.length - 1]!);
}

const samples = new Map<string, Promise<Rgba[] | null>>();

/**
 * An image's colours, from a small copy of it, or null when the page may not read it (a
 * cross-origin image without CORS taints the canvas). Cached by address.
 */
export function sampleImage(url: string): Promise<Rgba[] | null> {
  const known = samples.get(url);
  if (known) return known;
  const run = new Promise<Rgba[] | null>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, size, size);
        const data = context.getImageData(0, 0, size, size).data;
        const colours: Rgba[] = [];
        for (let i = 0; i < data.length; i += 4) {
          colours.push({ r: data[i]! / 255, g: data[i + 1]! / 255, b: data[i + 2]! / 255, a: data[i + 3]! / 255 });
        }
        resolve(distinct(colours.filter((one) => one.a > 0.05)));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve([]);
    image.src = new URL(url, document.baseURI).href;
  });
  samples.set(url, run);
  return run;
}

let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS colour as sRGB: read directly where `parseColor` can, else through a canvas, which
 * normalises every colour the browser knows without touching the document. Tokens are resolved
 * against the page's root first. Null for what is not a colour.
 */
export function resolveColor(value: string): Rgba | null {
  let text = value.trim();
  if (!text) return null;
  const token = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/i.exec(text);
  if (token) text = getComputedStyle(document.documentElement).getPropertyValue(token[1]!).trim() || token[2]?.trim() || '';
  if (!text) return null;
  const direct = parseColor(text);
  if (direct) return direct;
  if (probe === undefined) {
    try {
      probe = document.createElement('canvas').getContext('2d');
    } catch {
      probe = null;
    }
  }
  if (!probe) return null;
  // An invalid assignment leaves the old value, so probing from two colours detects one.
  probe.fillStyle = '#000000';
  probe.fillStyle = text;
  const fromBlack = String(probe.fillStyle);
  probe.fillStyle = '#ffffff';
  probe.fillStyle = text;
  if (String(probe.fillStyle) !== fromBlack) return null;
  return parseColor(fromBlack);
}
