/**
 * A `background`, as its layers and its colour.
 *
 * The Background section edits a background the way the Border section edits a line: as parts
 * (layers of image, gradient or solid colour, each placed and sized, over one base colour), written
 * back as one `background` shorthand. The shorthand cannot carry a blend mode, so that is the one
 * longhand written beside it. These are the two halves of that, reading and writing, with no DOM.
 */

export type LayerKind = 'gradient' | 'image' | 'solid' | 'raw';

export interface GradientStop {
  color: string;
  /** Where on the 0–100 line, in percent. */
  at: number;
}

export interface Gradient {
  kind: 'linear' | 'radial';
  /** Linear only: degrees, 0 pointing up, clockwise (CSS's own convention). */
  angle: number;
  /** Radial only: `circle`, `ellipse`, or '' for the default. */
  shape: string;
  /** Radial only: the centre (`right top`), or '' for the default. */
  at: string;
  stops: GradientStop[];
}

/** One layer's placement, each '' where nothing is written (the CSS default applies). */
export interface Placement {
  position: string;
  size: string;
  repeat: string;
  attachment: string;
  origin: string;
  clip: string;
  blend: string;
}

export interface BackgroundLayer extends Placement {
  kind: LayerKind;
  gradient?: Gradient;
  /** `image`: the address, unquoted. */
  url?: string;
  /** `solid`: the colour, written as a one-colour gradient so it can sit above other layers. */
  color?: string;
  /** `raw`: an image this editor does not take apart (`conic-gradient(…)`, `image-set(…)`), kept as written. */
  raw?: string;
}

export interface Background {
  /** Top layer first, as CSS lists them. */
  layers: BackgroundLayer[];
  /** The base colour under every layer, or ''. */
  color: string;
}

export const PLACEMENT_KEYS: readonly (keyof Placement)[] = ['position', 'size', 'repeat', 'attachment', 'origin', 'clip', 'blend'];

/** The longhand each placement part is read from, and written to when it is a list of its own. */
export const LONGHAND_OF: Record<keyof Placement, string> = {
  position: 'background-position',
  size: 'background-size',
  repeat: 'background-repeat',
  attachment: 'background-attachment',
  origin: 'background-origin',
  clip: 'background-clip',
  blend: 'background-blend-mode',
};

/** Every longhand the editor reads, in the order a later one is laid over an earlier one. */
export const BACKGROUND_LONGHANDS = [
  'background-image',
  'background-position',
  'background-size',
  'background-repeat',
  'background-attachment',
  'background-origin',
  'background-clip',
  'background-color',
  'background-blend-mode',
] as const;

const DEFAULTS: Record<keyof Placement, readonly string[]> = {
  position: ['0% 0%', '0 0', 'left top', 'top left', 'left', 'top', '0px 0px'],
  size: ['auto', 'auto auto'],
  repeat: ['repeat', 'repeat repeat'],
  attachment: ['scroll'],
  origin: ['padding-box'],
  clip: ['border-box'],
  blend: ['normal'],
};

/** A placement part that says nothing CSS would not do anyway. */
export function isDefault(key: keyof Placement, value: string): boolean {
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return !text || DEFAULTS[key].includes(text);
}

export const emptyPlacement = (): Placement => ({ position: '', size: '', repeat: '', attachment: '', origin: '', clip: '', blend: '' });

/* -------------------------------------------------------------------------- */
/* Splitting                                                                   */
/* -------------------------------------------------------------------------- */

/** Split on a separator at the top level: not inside brackets or quotes. */
export function splitTop(value: string, separator: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    const breaks = depth === 0 && (separator === ',' ? char === ',' : /\s/.test(char));
    if (breaks) {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  // Words are separated by any run of spaces; list items keep their place even when empty.
  return separator === ' ' ? out.filter(Boolean) : out.length === 1 && !out[0] ? [] : out;
}

/** A layer's words, with a top-level `/` as a word of its own (`center/cover` is three). */
function wordsOf(layer: string): string[] {
  return splitTop(layer, ' ').flatMap((word) => {
    if (word.includes('(') || !word.includes('/')) return [word];
    return word.split(/(\/)/).filter(Boolean);
  });
}

const IMAGE_RE = /^(?:url|(?:repeating-)?(?:linear|radial|conic)-gradient|-webkit-(?:linear|radial)-gradient|image-set|-webkit-image-set|cross-fade|element|paint|image)\(/i;
const REPEAT_RE = /^(?:repeat-x|repeat-y|repeat|space|round|no-repeat)$/i;
const ATTACHMENT_RE = /^(?:scroll|fixed|local)$/i;
const BOX_RE = /^(?:border-box|padding-box|content-box|text)$/i;
const POSITION_WORD_RE = /^(?:left|right|top|bottom|center)$/i;
const LENGTH_RE = /^(?:0|-?[\d.]+(?:px|em|rem|%|vw|vh|vmin|vmax|svh|dvh|lvh|svw|dvw|lvw|ch|ex|cm|mm|in|pt|pc|q|cqw|cqh)|(?:calc|min|max|clamp)\(.*\))$/i;
const SIZE_WORD_RE = /^(?:auto|cover|contain)$/i;

/* -------------------------------------------------------------------------- */
/* Gradients                                                                   */
/* -------------------------------------------------------------------------- */

const TO_ANGLE: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
  'to top right': 45,
  'to right top': 45,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom left': 225,
  'to left bottom': 225,
  'to top left': 315,
  'to left top': 315,
};

function angleOf(text: string): number | null {
  const direction = TO_ANGLE[text.trim().toLowerCase().replace(/\s+/g, ' ')];
  if (direction !== undefined) return direction;
  const match = /^(-?[\d.]+)(deg|turn|rad|grad)$/i.exec(text.trim());
  if (!match) return null;
  const n = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();
  const deg = unit === 'deg' ? n : unit === 'turn' ? n * 360 : unit === 'rad' ? (n * 180) / Math.PI : n * 0.9;
  return ((Math.round(deg * 100) / 100) % 360 + 360) % 360;
}

/**
 * A linear or radial gradient as kind, direction and stops, or null where it says something the
 * editor cannot show and write back unchanged: a repeating gradient, a colour hint, a stop placed
 * in a length or twice, a radial size. Those stay `raw`, edited as text.
 */
export function parseGradient(text: string): Gradient | null {
  const match = /^(linear|radial)-gradient\((.*)\)$/is.exec(text.trim());
  if (!match) return null;
  const kind = match[1]!.toLowerCase() as Gradient['kind'];
  const args = splitTop(match[2]!, ',');
  const gradient: Gradient = { kind, angle: 180, shape: '', at: '', stops: [] };
  if (kind === 'linear') {
    const angle = angleOf(args[0] ?? '');
    if (angle !== null) {
      gradient.angle = angle;
      args.shift();
    }
  } else if (/^(?:circle|ellipse|at\s|closest-|farthest-|-?[\d.])/i.test(args[0] ?? '')) {
    const [shapeText, at = ''] = args.shift()!.split(/\bat\b/i).map((one) => one.trim());
    const shape = shapeText!.toLowerCase();
    if (shape && shape !== 'circle' && shape !== 'ellipse') return null;
    gradient.shape = shape;
    gradient.at = at;
  }
  const stops: Array<{ color: string; at: number | null }> = [];
  for (const arg of args) {
    const words = splitTop(arg, ' ');
    const last = words[words.length - 1] ?? '';
    let at: number | null = null;
    if (/^-?[\d.]+%$/.test(last) && words.length > 1) {
      at = parseFloat(last);
      words.pop();
    }
    // A second position, a length, or a colour hint (a position with no colour).
    if (!words.length || words.some((word) => LENGTH_RE.test(word))) return null;
    stops.push({ color: words.join(' '), at });
  }
  if (stops.length < 2) return null;
  // Unplaced stops are spread evenly between their placed neighbours, as CSS does.
  if (stops[0]!.at === null) stops[0]!.at = 0;
  if (stops[stops.length - 1]!.at === null) stops[stops.length - 1]!.at = 100;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i]!.at !== null) continue;
    let next = i;
    while (stops[next]!.at === null) next++;
    const from = stops[i - 1]!.at!;
    const to = stops[next]!.at!;
    for (let k = i; k < next; k++) stops[k]!.at = from + ((to - from) * (k - i + 1)) / (next - i + 1);
  }
  gradient.stops = stops.map((stop) => ({ color: stop.color, at: Math.round(stop.at! * 100) / 100 }));
  return gradient;
}

const round = (n: number): string => String(Math.round(n * 100) / 100);

/** A gradient written out, stops in position order. */
export function gradientCss(gradient: Gradient): string {
  const stops = [...gradient.stops].sort((a, b) => a.at - b.at).map((stop) => `${stop.color} ${round(stop.at)}%`).join(', ');
  if (gradient.kind === 'linear') return `linear-gradient(${round(gradient.angle)}deg, ${stops})`;
  const head = [gradient.shape, gradient.at && !/^center( center)?$/i.test(gradient.at) ? `at ${gradient.at}` : ''].filter(Boolean).join(' ');
  return `radial-gradient(${head ? `${head}, ` : ''}${stops})`;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** An image's text as a layer's kind: a URL, a gradient, a solid colour, or kept as written. */
export function parseImage(text: string): Pick<BackgroundLayer, 'kind' | 'gradient' | 'url' | 'color' | 'raw'> {
  const value = text.trim();
  const url = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)$/i.exec(value);
  if (url) return { kind: 'image', url: url[1] ?? url[2] ?? url[3] ?? '' };
  const gradient = parseGradient(value);
  if (gradient) {
    // A one-colour gradient is how a colour is written above other layers: read it back as one.
    const [a, b] = gradient.stops;
    if (gradient.kind === 'linear' && gradient.stops.length === 2 && a!.color === b!.color && a!.at === 0 && b!.at === 100) {
      return { kind: 'solid', color: a!.color };
    }
    return { kind: 'gradient', gradient };
  }
  return { kind: 'raw', raw: value };
}

const newLayer = (): BackgroundLayer => ({ kind: 'raw', raw: 'none', ...emptyPlacement() });

/** A `background` shorthand as layers and a colour. `!important` is not part of the value. */
export function parseBackground(value: string): Background {
  const text = value.replace(/!\s*important\s*$/i, '').trim();
  const out: Background = { layers: [], color: '' };
  if (!text) return out;
  const layers = splitTop(text, ',');
  layers.forEach((layerText, index) => {
    const last = index === layers.length - 1;
    const layer = newLayer();
    let image = '';
    let afterSlash = false;
    const position: string[] = [];
    const size: string[] = [];
    const repeat: string[] = [];
    const boxes: string[] = [];
    for (const word of wordsOf(layerText)) {
      if (word === '/') afterSlash = true;
      else if (!image && (IMAGE_RE.test(word) || /^none$/i.test(word))) image = word;
      else if (REPEAT_RE.test(word)) repeat.push(word);
      else if (ATTACHMENT_RE.test(word)) layer.attachment = word;
      else if (BOX_RE.test(word)) boxes.push(word);
      else if (afterSlash && (SIZE_WORD_RE.test(word) || LENGTH_RE.test(word))) size.push(word);
      else if (!afterSlash && (POSITION_WORD_RE.test(word) || LENGTH_RE.test(word))) position.push(word);
      // A token on its own in a layer above the last is an image (`var(--hero)`); in the last, the
      // colour, which is what a lone token there almost always is.
      else if (!last && !image && /^var\(/i.test(word)) image = word;
      else if (last) out.color = out.color ? `${out.color} ${word}` : word;
    }
    if (image && !/^none$/i.test(image)) Object.assign(layer, parseImage(image));
    layer.position = position.join(' ');
    layer.size = size.join(' ');
    layer.repeat = repeat.join(' ');
    if (boxes.length) {
      layer.origin = boxes[0]!;
      layer.clip = boxes[1] ?? boxes[0]!;
    }
    out.layers.push(layer);
  });
  // A last layer that is only a colour (`background: red`) has no image: it is not a layer.
  const bottom = out.layers[out.layers.length - 1];
  if (bottom && bottom.kind === 'raw' && bottom.raw === 'none' && PLACEMENT_KEYS.every((key) => !bottom[key])) out.layers.pop();
  return out;
}

/**
 * A longhand's list laid over a background, as the cascade would: `background-image` decides how
 * many layers there are, every other list repeats to fill them.
 */
export function applyLonghand(background: Background, property: string, value: string): Background {
  const text = value.replace(/!\s*important\s*$/i, '').trim();
  const next: Background = { color: background.color, layers: background.layers.map((layer) => ({ ...layer })) };
  if (property === 'background-color') {
    next.color = text;
    return next;
  }
  const list = splitTop(text, ',');
  if (property === 'background-image') {
    if (list.length === 1 && /^none$/i.test(list[0]!)) return { ...next, layers: [] };
    next.layers = list.map((image, index) => {
      const layer = next.layers[index] ?? newLayer();
      const parsed = parseImage(image);
      return { ...layer, gradient: undefined, url: undefined, color: undefined, raw: undefined, ...parsed };
    });
    return next;
  }
  const key = (Object.keys(LONGHAND_OF) as (keyof Placement)[]).find((one) => LONGHAND_OF[one] === property);
  if (!key || !list.length) return next;
  next.layers.forEach((layer, index) => {
    layer[key] = list[index % list.length]!;
  });
  return next;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/** A layer's image, or '' for one with nothing to draw yet (an image with no address). */
export function imageCss(layer: BackgroundLayer): string {
  switch (layer.kind) {
    case 'gradient':
      return layer.gradient ? gradientCss(layer.gradient) : '';
    case 'image':
      return layer.url?.trim() ? `url("${layer.url.trim().replace(/"/g, '%22')}")` : '';
    case 'solid':
      return layer.color?.trim() ? `linear-gradient(${layer.color.trim()}, ${layer.color.trim()})` : '';
    default:
      return layer.raw?.trim() ?? '';
  }
}

/** One layer as the shorthand writes it, parts at their default left out. */
export function layerCss(layer: BackgroundLayer): string {
  const out = [imageCss(layer) || 'none'];
  const position = isDefault('position', layer.position) ? '' : layer.position.trim();
  const size = isDefault('size', layer.size) ? '' : layer.size.trim();
  // A size can only be written after a position and a slash.
  if (size) out.push(`${position || '0 0'} / ${size}`);
  else if (position) out.push(position);
  if (!isDefault('repeat', layer.repeat)) out.push(layer.repeat.trim());
  if (!isDefault('attachment', layer.attachment)) out.push(layer.attachment.trim());
  const origin = isDefault('origin', layer.origin) ? 'padding-box' : layer.origin.trim();
  const clip = isDefault('clip', layer.clip) ? 'border-box' : layer.clip.trim();
  // One box sets both; two are the origin, then the clip.
  if (origin !== 'padding-box' || clip !== 'border-box') out.push(origin === clip ? origin : `${origin} ${clip}`);
  return out.join(' ');
}

/** The layers that draw something: an image layer still waiting for its address is not written. */
export const drawnLayers = (background: Background): BackgroundLayer[] =>
  background.layers.filter((layer) => imageCss(layer));

/** The `background` shorthand for these layers over this colour, or '' when there is nothing. */
export function composeBackground(background: Background): string {
  const layers = drawnLayers(background).map(layerCss);
  const color = background.color.trim();
  if (!layers.length) return color;
  if (color) layers[layers.length - 1] += ` ${color}`;
  return layers.join(', ');
}

/**
 * One longhand's value for these layers, as a block that writes its background as longhands
 * would: `background-image` lists every drawn layer's image, a placement lists each layer's part
 * (its default where the layer has none), the colour is the colour. '' when it would say nothing
 * CSS does not do anyway: no colour, or every layer at the placement's default.
 */
export function composeLonghand(background: Background, property: string): string {
  if (property === 'background-color') return background.color.trim();
  const layers = drawnLayers(background);
  if (property === 'background-image') return layers.length ? layers.map(imageCss).join(', ') : 'none';
  if (property === 'background-blend-mode') return composeBlend(background);
  const key = (Object.keys(LONGHAND_OF) as (keyof Placement)[]).find((one) => LONGHAND_OF[one] === property);
  if (!key || !layers.length || layers.every((layer) => isDefault(key, layer[key]))) return '';
  return layers.map((layer) => (isDefault(key, layer[key]) ? DEFAULTS[key][0]! : layer[key].trim())).join(', ');
}

/** The `background-blend-mode` list, or '' when every layer blends normally. */
export function composeBlend(background: Background): string {
  const layers = drawnLayers(background);
  if (layers.every((layer) => isDefault('blend', layer.blend))) return '';
  return layers.map((layer) => (isDefault('blend', layer.blend) ? 'normal' : layer.blend.trim())).join(', ');
}

/* -------------------------------------------------------------------------- */
/* Positions                                                                   */
/* -------------------------------------------------------------------------- */

/** The nine keyword positions, as `x y`, in reading order. */
export const KEYWORD_POSITIONS = [
  'left top', 'center top', 'right top',
  'left center', 'center', 'right center',
  'left bottom', 'center bottom', 'right bottom',
] as const;

const AT: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

/**
 * A position as x% and y% of its box, for drawing it, or null for one that cannot be placed
 * without the box's size (`20px 30%`, `calc(…)`, four-value offsets).
 */
export function positionPercent(position: string): [number, number] | null {
  const words = position.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [0, 0];
  if (words.length > 2) return null;
  const [a, b = 'center'] = words as [string, string];
  const pct = (word: string): number | null => (word in AT ? AT[word]! : /^-?[\d.]+%$/.test(word) ? parseFloat(word) : word === '0' ? 0 : null);
  // `top right` and `bottom left` name y first.
  const yFirst = a === 'top' || a === 'bottom' || b === 'left' || b === 'right';
  const x = pct(yFirst ? b : a);
  const y = pct(yFirst ? a : b);
  return x === null || y === null ? null : [x, y];
}
