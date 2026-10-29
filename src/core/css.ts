import { declaredValues } from './cascade.js';
import type { TokenGroup } from './types.js';

/**
 * The property catalogue that drives the style editor, and the value helpers around it.
 *
 * Describing properties well enough that the UI can pick the right control and offer sensible
 * completions, parsing declaration text and values, and the two layout questions the panel asks
 * about ancestors. What CSS actually applies to an element — the cascade — lives in `cascade.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Property catalogue                                                          */
/* -------------------------------------------------------------------------- */

export type ControlType =
  | 'length'
  | 'color'
  | 'keyword'
  | 'number'
  | 'text'
  | 'box'
  | 'font'
  | 'shadow';

export type PropertyGroup =
  | 'layout'
  | 'flex'
  | 'grid'
  | 'spacing'
  | 'size'
  | 'typography'
  | 'appearance'
  | 'border'
  | 'effects'
  | 'media'
  | 'transition';

export interface PropertyMeta {
  name: string;
  group: PropertyGroup;
  control: ControlType;
  /** Allowed keywords, offered first in the autocomplete list. */
  keywords?: string[];
  /** Token group whose values make sense here. */
  tokens?: TokenGroup;
  /**
   * Several token groups, for a shorthand that genuinely takes more than one kind.
   *
   * `border` wants a width *and* a colour. `tokens` cannot say that, and widening the whole `border`
   * group to include colours instead — which is what this replaced — leaked colour tokens onto
   * `border-width`, a property that takes only a length.
   */
  tokenGroups?: TokenGroup[];
  /**
   * Ready-made values for this property, shown under "Common values".
   *
   * Per-property because the control type cannot supply them: `filter`, `backdrop-filter`, `border`
   * and `outline` are all `text` controls, and a text control has no generic vocabulary — so they
   * offered nothing at all, which is the least helpful state for exactly the properties whose syntax
   * nobody remembers.
   */
  literals?: string[];
  /** Shown as placeholder / hint text. */
  hint?: string;
  /**
   * A side or component of a shorthand listed just above it.
   *
   * Findable by name, but kept out of the unprompted list. Both halves are the point.
   *
   * They have to be findable: the catalogue held `margin`, `padding`, `border` and `outline` and
   * none of their sides, so typing `margin-left` or `border-bottom` into any property adder — an
   * element's, a class's, a rule's — offered nothing and the panel's own search said the page
   * declared no such thing. `border-bottom` is in the markup this editor inserts for a table, so
   * the gap was reachable in about three clicks.
   *
   * And they have to stay out of the default list, which is what an adder shows before anything has
   * been typed. Thirty-five sides ahead of `width` would answer a question nobody asked with the
   * least interesting third of CSS.
   */
  longhand?: true;
}

const K = {
  display: [
    'block',
    'inline',
    'inline-block',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'contents',
    'flow-root',
    'none',
  ],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  overflow: ['visible', 'hidden', 'clip', 'scroll', 'auto'],
  justify: [
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
    'start',
    'end',
    'stretch',
  ],
  align: ['stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end'],
  wrap: ['nowrap', 'wrap', 'wrap-reverse'],
  direction: ['row', 'row-reverse', 'column', 'column-reverse'],
  objectFit: ['fill', 'contain', 'cover', 'none', 'scale-down'],
  textAlign: ['start', 'end', 'left', 'right', 'center', 'justify'],
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'],
  borderStyle: ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'],
  auto: ['auto'],
  sizing: ['auto', 'min-content', 'max-content', 'fit-content', '100%'],
} as const;

/**
 * The catalogue. Ordered within groups so the style panel reads top-to-bottom
 * the way a designer thinks: what kind of box, then where, then how big, then
 * how it looks.
 */
export const CSS_PROPERTIES: PropertyMeta[] = [
  // Layout
  { name: 'display', group: 'layout', control: 'keyword', keywords: [...K.display] },
  { name: 'position', group: 'layout', control: 'keyword', keywords: [...K.position] },
  { name: 'top', group: 'layout', control: 'length', tokens: 'space' },
  { name: 'right', group: 'layout', control: 'length', tokens: 'space' },
  { name: 'bottom', group: 'layout', control: 'length', tokens: 'space' },
  { name: 'left', group: 'layout', control: 'length', tokens: 'space' },
  { name: 'z-index', group: 'layout', control: 'number' },
  { name: 'overflow', group: 'layout', control: 'keyword', keywords: [...K.overflow] },
  { name: 'overflow-x', group: 'layout', control: 'keyword', keywords: [...K.overflow] },
  { name: 'overflow-y', group: 'layout', control: 'keyword', keywords: [...K.overflow] },
  { name: 'float', group: 'layout', control: 'keyword', keywords: ['none', 'left', 'right'] },
  { name: 'isolation', group: 'layout', control: 'keyword', keywords: ['auto', 'isolate'] },

  // Flex
  { name: 'flex-direction', group: 'flex', control: 'keyword', keywords: [...K.direction] },
  { name: 'flex-wrap', group: 'flex', control: 'keyword', keywords: [...K.wrap] },
  { name: 'justify-content', group: 'flex', control: 'keyword', keywords: [...K.justify] },
  { name: 'align-items', group: 'flex', control: 'keyword', keywords: [...K.align] },
  { name: 'align-content', group: 'flex', control: 'keyword', keywords: [...K.justify] },
  { name: 'align-self', group: 'flex', control: 'keyword', keywords: ['auto', ...K.align] },
  { name: 'flex', group: 'flex', control: 'text', hint: '1 1 auto' },
  { name: 'flex-grow', group: 'flex', control: 'number' },
  { name: 'flex-shrink', group: 'flex', control: 'number' },
  { name: 'flex-basis', group: 'flex', control: 'length', tokens: 'size' },
  { name: 'order', group: 'flex', control: 'number' },
  { name: 'gap', group: 'flex', control: 'length', tokens: 'space' },
  { name: 'row-gap', group: 'flex', control: 'length', tokens: 'space' },
  { name: 'column-gap', group: 'flex', control: 'length', tokens: 'space' },

  // Grid
  { name: 'grid-template-columns', group: 'grid', control: 'text', hint: 'repeat(3, minmax(0, 1fr))' },
  { name: 'grid-template-rows', group: 'grid', control: 'text', hint: 'auto' },
  { name: 'grid-template-areas', group: 'grid', control: 'text' },
  { name: 'grid-auto-flow', group: 'grid', control: 'keyword', keywords: ['row', 'column', 'dense', 'row dense', 'column dense'] },
  { name: 'grid-auto-rows', group: 'grid', control: 'text', hint: 'minmax(120px, auto)' },
  { name: 'grid-column', group: 'grid', control: 'text', hint: 'span 2' },
  { name: 'grid-row', group: 'grid', control: 'text', hint: 'span 2' },
  { name: 'place-items', group: 'grid', control: 'keyword', keywords: ['center', 'start', 'end', 'stretch'] },
  { name: 'place-content', group: 'grid', control: 'keyword', keywords: ['center', 'start', 'end', 'space-between'] },

  // Spacing
  { name: 'margin', group: 'spacing', control: 'box', tokens: 'space' },
  { name: 'padding', group: 'spacing', control: 'box', tokens: 'space' },
  { name: 'margin-top', group: 'spacing', control: 'length', tokens: 'space', keywords: [...K.auto], longhand: true },
  { name: 'margin-right', group: 'spacing', control: 'length', tokens: 'space', keywords: [...K.auto], longhand: true },
  { name: 'margin-bottom', group: 'spacing', control: 'length', tokens: 'space', keywords: [...K.auto], longhand: true },
  { name: 'margin-left', group: 'spacing', control: 'length', tokens: 'space', keywords: [...K.auto], longhand: true },
  { name: 'padding-top', group: 'spacing', control: 'length', tokens: 'space', longhand: true },
  { name: 'padding-right', group: 'spacing', control: 'length', tokens: 'space', longhand: true },
  { name: 'padding-bottom', group: 'spacing', control: 'length', tokens: 'space', longhand: true },
  { name: 'padding-left', group: 'spacing', control: 'length', tokens: 'space', longhand: true },

  // Size
  { name: 'width', group: 'size', control: 'length', tokens: 'size', keywords: [...K.sizing] },
  { name: 'height', group: 'size', control: 'length', tokens: 'size', keywords: [...K.sizing] },
  { name: 'min-width', group: 'size', control: 'length', tokens: 'size', keywords: [...K.sizing] },
  { name: 'min-height', group: 'size', control: 'length', tokens: 'size', keywords: [...K.sizing] },
  { name: 'max-width', group: 'size', control: 'length', tokens: 'size', keywords: ['none', ...K.sizing] },
  { name: 'max-height', group: 'size', control: 'length', tokens: 'size', keywords: ['none', ...K.sizing] },
  { name: 'aspect-ratio', group: 'size', control: 'text', hint: '16 / 9' },
  { name: 'box-sizing', group: 'size', control: 'keyword', keywords: ['content-box', 'border-box'] },

  // Typography
  { name: 'color', group: 'typography', control: 'color', tokens: 'color' },
  { name: 'font-family', group: 'typography', control: 'font', tokens: 'font' },
  { name: 'font-size', group: 'typography', control: 'length', tokens: 'size' },
  { name: 'font-weight', group: 'typography', control: 'keyword', keywords: [...K.weight] },
  { name: 'font-style', group: 'typography', control: 'keyword', keywords: ['normal', 'italic', 'oblique'] },
  /*
   * Both spellings of the same property, on purpose.
   *
   * `font-width` is what the spec calls it and `font-stretch` is the deprecated alias -- and yet
   * the alias is the one browsers actually support, so an author needs to be able to reach either.
   * Listing both is also what makes them findable: neither was in the catalogue, so searching
   * `font-stretch` found nothing and the panel had no control to offer for it.
   */
  { name: 'font-stretch', group: 'typography', control: 'length', keywords: ['normal', 'condensed', 'semi-condensed', 'expanded', 'semi-expanded', '50%', '100%', '200%'], hint: '50% - 200%' },
  { name: 'font-width', group: 'typography', control: 'length', keywords: ['normal', 'condensed', 'semi-condensed', 'expanded', 'semi-expanded', '50%', '100%', '200%'], hint: '50% - 200%' },
  { name: 'font-variant', group: 'typography', control: 'text', hint: 'small-caps' },
  { name: 'line-height', group: 'typography', control: 'length', tokens: 'size', hint: '1.5' },
  { name: 'letter-spacing', group: 'typography', control: 'length', keywords: ['normal'] },
  { name: 'word-spacing', group: 'typography', control: 'length', keywords: ['normal'] },
  { name: 'text-align', group: 'typography', control: 'keyword', keywords: [...K.textAlign] },
  { name: 'text-transform', group: 'typography', control: 'keyword', keywords: ['none', 'uppercase', 'lowercase', 'capitalize'] },
  { name: 'text-decoration', group: 'typography', control: 'text', hint: 'underline' },
  { name: 'text-wrap', group: 'typography', control: 'keyword', keywords: ['wrap', 'nowrap', 'balance', 'pretty'] },
  { name: 'white-space', group: 'typography', control: 'keyword', keywords: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'] },
  { name: 'text-overflow', group: 'typography', control: 'keyword', keywords: ['clip', 'ellipsis'] },

  // Appearance
  { name: 'background-color', group: 'appearance', control: 'color', tokens: 'color' },
  { name: 'background', group: 'appearance', control: 'text', hint: 'linear-gradient(...)' },
  { name: 'background-image', group: 'appearance', control: 'text', hint: 'url(...)' },
  { name: 'background-size', group: 'appearance', control: 'keyword', keywords: ['auto', 'cover', 'contain'] },
  { name: 'background-position', group: 'appearance', control: 'text', hint: 'center' },
  { name: 'background-repeat', group: 'appearance', control: 'keyword', keywords: ['repeat', 'no-repeat', 'repeat-x', 'repeat-y'] },
  { name: 'opacity', group: 'appearance', control: 'number', hint: '0 – 1' },
  { name: 'cursor', group: 'appearance', control: 'keyword', keywords: ['auto', 'default', 'pointer', 'text', 'move', 'grab', 'not-allowed', 'wait'] },

  // Border
  { name: 'border-radius', group: 'border', control: 'box', tokens: 'radius' },
  { name: 'border-width', group: 'border', control: 'length', tokens: 'border' },
  { name: 'border-style', group: 'border', control: 'keyword', keywords: [...K.borderStyle] },
  { name: 'border-color', group: 'border', control: 'color', tokens: 'color' },
  {
    name: 'border',
    group: 'border',
    control: 'text',
    hint: '1px solid var(--border)',
    tokenGroups: ['border', 'color'],
    literals: ['none', '1px solid', '1px solid currentColor', '2px solid', '1px dashed', '1px solid transparent'],
  },
  {
    name: 'outline',
    group: 'border',
    control: 'text',
    hint: '2px solid',
    tokenGroups: ['border', 'color'],
    literals: ['none', '1px solid', '2px solid currentColor', '2px dashed', '2px solid transparent'],
  },
  { name: 'outline-offset', group: 'border', control: 'length' },
  /*
   * One side of a border is a `border` value, not a length.
   *
   * Worth saying explicitly rather than leaving to `metaFor`'s inference, which reads a trailing
   * `top` or `bottom` as a length — so `border-bottom` would have been handed a length control and
   * the spacing token scale, for a property whose value is `2px solid currentColor`.
   */
  { name: 'border-top', group: 'border', control: 'text', hint: '1px solid var(--border)', tokenGroups: ['border', 'color'], literals: ['none', '1px solid', '1px solid currentColor', '2px solid', '1px dashed'], longhand: true },
  { name: 'border-right', group: 'border', control: 'text', hint: '1px solid var(--border)', tokenGroups: ['border', 'color'], literals: ['none', '1px solid', '1px solid currentColor', '2px solid', '1px dashed'], longhand: true },
  { name: 'border-bottom', group: 'border', control: 'text', hint: '1px solid var(--border)', tokenGroups: ['border', 'color'], literals: ['none', '1px solid', '1px solid currentColor', '2px solid', '1px dashed'], longhand: true },
  { name: 'border-left', group: 'border', control: 'text', hint: '1px solid var(--border)', tokenGroups: ['border', 'color'], literals: ['none', '1px solid', '1px solid currentColor', '2px solid', '1px dashed'], longhand: true },
  // A width takes the border scale, not the size scale that a trailing `width` would infer.
  { name: 'border-top-width', group: 'border', control: 'length', tokens: 'border', longhand: true },
  { name: 'border-right-width', group: 'border', control: 'length', tokens: 'border', longhand: true },
  { name: 'border-bottom-width', group: 'border', control: 'length', tokens: 'border', longhand: true },
  { name: 'border-left-width', group: 'border', control: 'length', tokens: 'border', longhand: true },
  { name: 'border-top-style', group: 'border', control: 'keyword', keywords: [...K.borderStyle], longhand: true },
  { name: 'border-right-style', group: 'border', control: 'keyword', keywords: [...K.borderStyle], longhand: true },
  { name: 'border-bottom-style', group: 'border', control: 'keyword', keywords: [...K.borderStyle], longhand: true },
  { name: 'border-left-style', group: 'border', control: 'keyword', keywords: [...K.borderStyle], longhand: true },
  { name: 'border-top-color', group: 'border', control: 'color', tokens: 'color', longhand: true },
  { name: 'border-right-color', group: 'border', control: 'color', tokens: 'color', longhand: true },
  { name: 'border-bottom-color', group: 'border', control: 'color', tokens: 'color', longhand: true },
  { name: 'border-left-color', group: 'border', control: 'color', tokens: 'color', longhand: true },
  { name: 'border-top-left-radius', group: 'border', control: 'length', tokens: 'radius', longhand: true },
  { name: 'border-top-right-radius', group: 'border', control: 'length', tokens: 'radius', longhand: true },
  { name: 'border-bottom-right-radius', group: 'border', control: 'length', tokens: 'radius', longhand: true },
  { name: 'border-bottom-left-radius', group: 'border', control: 'length', tokens: 'radius', longhand: true },
  { name: 'outline-width', group: 'border', control: 'length', tokens: 'border', longhand: true },
  { name: 'outline-style', group: 'border', control: 'keyword', keywords: [...K.borderStyle], longhand: true },
  { name: 'outline-color', group: 'border', control: 'color', tokens: 'color', longhand: true },

  // Effects
  { name: 'box-shadow', group: 'effects', control: 'shadow', tokens: 'shadow' },
  { name: 'text-shadow', group: 'effects', control: 'text', hint: '0 1px 2px rgb(0 0 0 / .2)' },
  {
    name: 'filter',
    group: 'effects',
    control: 'text',
    hint: 'blur(4px)',
    literals: [
      'none',
      'blur(4px)',
      'brightness(1.1)',
      'contrast(1.2)',
      'saturate(1.4)',
      'grayscale(1)',
      'sepia(0.6)',
      'invert(1)',
      'opacity(0.5)',
      'hue-rotate(90deg)',
      'drop-shadow(0 2px 4px rgb(0 0 0 / 30%))',
    ],
  },
  {
    name: 'backdrop-filter',
    group: 'effects',
    control: 'text',
    hint: 'blur(12px)',
    literals: [
      'none',
      'blur(12px)',
      'blur(12px) saturate(1.4)',
      'brightness(0.8)',
      'saturate(1.8)',
      'grayscale(1)',
      'invert(1)',
    ],
  },
  { name: 'transform', group: 'effects', control: 'text', hint: 'translateY(-2px)' },
  { name: 'transform-origin', group: 'effects', control: 'text', hint: 'center' },
  { name: 'mix-blend-mode', group: 'effects', control: 'keyword', keywords: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'] },

  // Media
  { name: 'object-fit', group: 'media', control: 'keyword', keywords: [...K.objectFit] },
  { name: 'object-position', group: 'media', control: 'text', hint: 'center' },
  { name: 'image-rendering', group: 'media', control: 'keyword', keywords: ['auto', 'smooth', 'crisp-edges', 'pixelated'] },

  // Transition
  { name: 'transition', group: 'transition', control: 'text', tokens: 'motion', hint: 'all .2s ease' },
  { name: 'transition-property', group: 'transition', control: 'text', hint: 'opacity, transform' },
  { name: 'transition-duration', group: 'transition', control: 'length', tokens: 'motion', hint: '200ms' },
  { name: 'transition-timing-function', group: 'transition', control: 'keyword', keywords: ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'cubic-bezier(.4,0,.2,1)'] },
  { name: 'animation', group: 'transition', control: 'text' },
  { name: 'will-change', group: 'transition', control: 'keyword', keywords: ['auto', 'transform', 'opacity'] },
];

const PROPERTY_INDEX = new Map(CSS_PROPERTIES.map((meta) => [meta.name, meta]));

export const PROPERTY_GROUP_LABELS: Record<PropertyGroup, string> = {
  layout: 'Layout',
  flex: 'Flex',
  grid: 'Grid',
  spacing: 'Spacing',
  size: 'Size',
  typography: 'Typography',
  appearance: 'Appearance',
  border: 'Border',
  effects: 'Effects',
  media: 'Media',
  transition: 'Motion',
};

export function propertyMeta(name: string): PropertyMeta {
  return (
    PROPERTY_INDEX.get(name) ?? {
      name,
      group: 'appearance',
      control: inferControl(name),
      tokens: inferTokenGroup(name),
    }
  );
}

function inferControl(name: string): ControlType {
  if (/color$/.test(name) || name === 'fill' || name === 'stroke') return 'color';
  if (/(?:width|height|size|gap|spacing|radius|offset|inset|top|left|right|bottom)$/.test(name)) {
    return 'length';
  }

  if (/^(?:opacity|order|flex-grow|flex-shrink|z-index)$/.test(name)) return 'number';
  return 'text';
}

function inferTokenGroup(name: string): TokenGroup | undefined {
  if (/color$/.test(name) || name === 'fill' || name === 'stroke') return 'color';
  if (/radius/.test(name)) return 'radius';
  if (/shadow/.test(name)) return 'shadow';
  if (/(?:margin|padding|gap|inset)/.test(name)) return 'space';
  if (/(?:width|height|size)/.test(name)) return 'size';
  if (/font/.test(name)) return 'font';
  if (/(?:duration|delay|transition|animation)/.test(name)) return 'motion';
  return undefined;
}

/**
 * Properties whose names contain `query`, ranked prefix-first.
 *
 * The empty query is the unprompted list an adder shows before anything is typed, and it stays the
 * curated shorthands. Once something has been typed the sides join in, ranked below a shorthand
 * that matches the same text — so `margin` still offers `margin` first and `margin-l` reaches
 * `margin-left`, which the catalogue could not reach at all.
 */
export function searchProperties(query: string, limit = 12): PropertyMeta[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return CSS_PROPERTIES.filter((meta) => !meta.longhand).slice(0, limit);
  const prefix: PropertyMeta[] = [];
  const contains: PropertyMeta[] = [];
  const sides: PropertyMeta[] = [];
  for (const meta of CSS_PROPERTIES) {
    if (!meta.name.includes(needle)) continue;
    if (meta.longhand) sides.push(meta);
    else if (meta.name.startsWith(needle)) prefix.push(meta);
    else contains.push(meta);
  }
  // Sides keep prefix-before-substring order among themselves, for the same reason the
  // shorthands do: `border-bottom` should beat `border-top-left-radius` for `border-b`.
  sides.sort(
    (a, b) => Number(b.name.startsWith(needle)) - Number(a.name.startsWith(needle)),
  );
  return [...prefix, ...contains, ...sides].slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Sizing limits from ancestors                                                */
/* -------------------------------------------------------------------------- */

export type SizeAxis = 'width' | 'height';

/** An ancestor declaration that limits how large the element can become. */
export interface SizeConstraint {
  /** The ancestor imposing the limit. */
  el: HTMLElement;
  axis: SizeAxis;
  property: string;
  /** The value as declared, e.g. `600px` or `hidden`. */
  value: string;
  /** Selector the declaration came from, for provenance. */
  from: string;
  /** How many levels above the element the ancestor sits. */
  depth: number;
  /** Content extent the ancestor leaves its children, in CSS pixels. */
  available: number;
  /** True when the element is already filling that extent, so the cap is active. */
  binding: boolean;
}

/** Properties that cap a child's extent, per axis. */
const CAPS: Record<SizeAxis, string[]> = {
  width: ['max-width', 'width', 'overflow-x', 'overflow'],
  height: ['max-height', 'height', 'overflow-y', 'overflow'],
};

/**
 * Ancestor declarations that stop the element from growing along one axis.
 *
 * Answers the question a designer actually asks — "I set a bigger width and
 * nothing happened" — by naming the element and the declaration responsible.
 * Only declared caps count: an ancestor that merely happens to be narrow because
 * *its* parent is narrow is not where the fix belongs, and reporting it would send
 * the user to the wrong place.
 *
 * `binding` separates "there is a cap somewhere above" from "that cap is what you
 * are hitting right now", which is what lets the UI stay quiet until it matters.
 */
export function sizeConstraints(el: HTMLElement, axis: SizeAxis, limit = 3): SizeConstraint[] {
  const extent = axis === 'width' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
  const out: SizeConstraint[] = [];

  let current = el.parentElement;
  let depth = 1;
  while (current && current !== document.documentElement && out.length < limit) {
    const declared = declaredValues(current);
    const available = contentExtent(current, axis);
    for (const property of CAPS[axis]) {
      const entry = declared.get(property);
      if (!entry) continue;
      if (!isCapping(property, entry.value)) continue;
      out.push({
        el: current,
        axis,
        property,
        value: entry.value,
        from: entry.from,
        depth,
        available,
        // Within a pixel of the space available is "flush against it"; subpixel
        // layout means an exact comparison would almost never be true.
        binding: extent >= available - 1,
      });
      break; // One reason per ancestor is enough; the first is the most specific.
    }
    current = current.parentElement;
    depth += 1;
  }
  return out;
}

/** True when this declaration actually limits children rather than just existing. */
function isCapping(property: string, value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text || text === 'auto' || text === 'none' || text === 'initial' || text === 'unset') {
    return false;
  }
  if (property.startsWith('overflow')) return text !== 'visible';
  // A percentage or `100%` width does not cap anything on its own; a length does.
  if (property === 'width' || property === 'height') return !text.endsWith('%');
  return true;
}

/** The space an element leaves its children along one axis, padding excluded. */
function contentExtent(el: HTMLElement, axis: SizeAxis): number {
  const style = getComputedStyle(el);
  if (axis === 'width') {
    const pad = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    return Math.max(0, el.clientWidth - (Number.isFinite(pad) ? pad : 0));
  }
  const pad = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  return Math.max(0, el.clientHeight - (Number.isFinite(pad) ? pad : 0));
}

/**
 * The parent properties that govern how much room this child gets.
 *
 * Tailored to the parent's own layout mode, because the useful set is completely
 * different: a flex row's `flex-wrap` and `gap` decide a child's width, while in a
 * grid it is the template that does. Showing all of them regardless would turn a
 * targeted answer back into a property dump.
 */
export function parentLayoutProperties(parent: HTMLElement): string[] {
  const display = getComputedStyle(parent).display;
  const common = ['display', 'width', 'max-width', 'padding', 'overflow'];

  if (display.includes('flex')) {
    return [
      'display',
      'flex-direction',
      'flex-wrap',
      'justify-content',
      'align-items',
      'gap',
      'width',
      'max-width',
      'padding',
      'overflow',
    ];
  }
  if (display.includes('grid')) {
    return [
      'display',
      'grid-template-columns',
      'grid-auto-flow',
      'justify-items',
      'align-items',
      'gap',
      'width',
      'max-width',
      'padding',
      'overflow',
    ];
  }
  return common;
}

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

export interface ParsedLength {
  number: number;
  unit: string;
}

const LENGTH_UNITS = [
  'px',
  'rem',
  'em',
  '%',
  'vw',
  'vh',
  'svh',
  'dvh',
  'ch',
  'fr',
  'ms',
  's',
  'deg',
  'pt',
];

export function parseLength(value: string): ParsedLength | null {
  const match = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return null;
  return { number, unit: match[2] || '' };
}

export function formatLength(number: number, unit: string): string {
  const rounded = Math.round(number * 1000) / 1000;
  return unit ? `${rounded}${unit}` : String(rounded);
}

export function nextUnit(unit: string, direction: 1 | -1): string {
  const index = LENGTH_UNITS.indexOf(unit || 'px');
  const next = (index + direction + LENGTH_UNITS.length) % LENGTH_UNITS.length;
  return LENGTH_UNITS[next];
}

export const AVAILABLE_UNITS = LENGTH_UNITS;

/** True when the value references a custom property. */
export function isTokenValue(value: string): boolean {
  return /var\(\s*--[\w-]+/.test(value);
}

/** Token names referenced by a value, without the leading `--`. */
export function tokensInValue(value: string): string[] {
  return Array.from(String(value ?? '').matchAll(/var\(\s*--([\w-]+)/g)).map((match) => match[1]);
}

/**
 * Split a box shorthand into four sides.
 *
 * Accepts anything the browser accepts, including `var()` values, by splitting
 * on top-level whitespace so `var(--a, 1px) 2px` yields two parts, not three.
 */
export function splitBoxValue(value: string): [string, string, string, string] {
  const parts = splitTopLevel(String(value ?? '').trim());
  if (parts.length === 0) return ['', '', '', ''];
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** Recombine four sides into the shortest equivalent shorthand. */
export function joinBoxValue(sides: [string, string, string, string]): string {
  const [top, right, bottom, left] = sides.map((side) => side.trim() || '0') as [
    string,
    string,
    string,
    string,
  ];
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

/**
 * Declarations from serialized CSS text, as authored.
 *
 * The alternative — indexing into a `CSSStyleDeclaration` — expands every
 * shorthand, so one `background: #fff` comes back as eight longhands and
 * `padding: var(--x)` comes back as nothing at all, because the browser stores a
 * var-bearing shorthand as a pending-substitution value that does not enumerate.
 * Parsing the text keeps what the author wrote, which is what belongs in an
 * editor and in an exported rule.
 */
export function parseDeclarations(cssText: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cssText?.trim()) return out;

  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (const ch of cssText) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) parts.push(current);

  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const property = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (property && value) out[property] = value;
  }
  return out;
}

/** Split on whitespace that is not inside parentheses. */
export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  if (current) parts.push(current);
  return parts;
}

/**
 * A CSS function taken apart, so a form can be offered for it.
 *
 * `operators` is what separates the two shapes a function comes in. `clamp`, `min` and `max` take a
 * comma-separated list, so it is empty. `calc` takes an expression, so it holds the arithmetic
 * between the parts and is one shorter than `parts`.
 */
export interface CssFunctionParts {
  name: string;
  parts: string[];
  operators: string[];
}

/** Operators `calc()` accepts. `+` and `-` require surrounding whitespace; the spec says so. */
const CALC_SPLIT = /\s+([+\-])\s+|\s*([*/])\s*/;

/**
 * Take a function value apart, or null when it is not one of `allowed`.
 *
 * Split on top-level separators so a nested function survives: `clamp(1rem, calc(2vw + 1rem), 3rem)`
 * has three parts, not four. A part count the function cannot accept returns null rather than being
 * reinterpreted -- a `clamp` with two arguments is something the author wrote, not something to
 * guess at.
 */
export function parseCssFunction(
  value: string,
  allowed: readonly string[] = ['clamp', 'min', 'max', 'calc'],
): CssFunctionParts | null {
  const match = /^\s*([a-z-]+)\s*\((.*)\)\s*$/is.exec(String(value ?? '').trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (!allowed.includes(name)) return null;
  const inner = match[2];

  if (name === 'calc') {
    const parts: string[] = [];
    const operators: string[] = [];
    let current = '';
    let depth = 0;
    for (let index = 0; index < inner.length; index += 1) {
      const ch = inner[index];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0) {
        const rest = inner.slice(index);
        const hit = CALC_SPLIT.exec(rest);
        if (hit && hit.index === 0) {
          parts.push(current.trim());
          operators.push(hit[1] ?? hit[2]);
          index += hit[0].length - 1;
          current = '';
          continue;
        }
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    if (parts.length < 2) return null;
    return { name, parts, operators };
  }

  const parts = splitTopLevelCommas(inner);
  if (name === 'clamp' && parts.length !== 3) return null;
  if (parts.length < 2) return null;
  return { name, parts, operators: [] };
}

/** Put one back together, as it will be written. */
export function formatCssFunction(fn: CssFunctionParts): string {
  const parts = fn.parts.map((part) => part.trim()).filter(Boolean);
  if (fn.operators.length) {
    const body = parts.reduce(
      (text, part, index) => (index === 0 ? part : `${text} ${fn.operators[index - 1] ?? '+'} ${part}`),
      '',
    );
    return `${fn.name}(${body})`;
  }
  return `${fn.name}(${parts.join(', ')})`;
}

/**
 * Split on commas that are not inside brackets.
 *
 * The counterpart to `splitTopLevel`, which splits on whitespace. Needed separately because a CSS
 * function's arguments are comma-separated and its own arguments may be functions.
 */
export function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of String(value ?? '')) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Resolve a value that may be a `var()` reference against the element. */
export function resolveValue(el: HTMLElement, value: string): string {
  if (!isTokenValue(value)) return value;
  const names = tokensInValue(value);
  if (!names.length) return value;
  const computed = getComputedStyle(el);
  let out = value;
  for (const name of names) {
    const resolved = computed.getPropertyValue(`--${name}`).trim();
    if (resolved) out = out.replace(new RegExp(`var\\(\\s*--${escapeRegExp(name)}[^)]*\\)`), resolved);
  }
  return out;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when a string looks like a colour the browser will accept. */
export function isColorValue(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^(?:#|rgb|hsl|oklch|oklab|lab|lch|color-mix|color\()/i.test(text)) return true;
  if (isTokenValue(text)) return true;
  return CSS.supports('color', text);
}

/**
 * A detached 2D canvas context, used to normalise colours.
 *
 * The obvious implementation — insert a probe element, read its computed colour,
 * remove it — mutates the document on every call. That is unacceptable here: the
 * editor watches the page with a MutationObserver, so a probe inserted during
 * render triggers a re-render, which probes again. A canvas context normalises
 * any CSS colour with no DOM involvement at all.
 */
let colorContext: CanvasRenderingContext2D | null | undefined;

function colorProbe(): CanvasRenderingContext2D | null {
  if (colorContext === undefined) {
    try {
      colorContext = document.createElement('canvas').getContext('2d');
    } catch {
      colorContext = null;
    }
  }
  return colorContext;
}

/** Convert any CSS colour to `#rrggbb`, for `<input type="color">`. */
export function toHexColor(value: string, fallback = '#000000'): string {
  const text = value.trim();
  if (!text) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text
      .slice(1)
      .split('')
      .map((ch) => ch + ch)
      .join('')}`.toLowerCase();
  }

  const ctx = colorProbe();
  if (!ctx) return fallback;

  // An invalid assignment leaves `fillStyle` untouched, so probing from two
  // different starting colours is how an unparseable value is detected.
  ctx.fillStyle = '#000000';
  ctx.fillStyle = text;
  const fromBlack = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = text;
  const fromWhite = ctx.fillStyle;
  if (typeof fromBlack !== 'string' || fromBlack !== fromWhite) return fallback;

  if (/^#[0-9a-f]{6}$/i.test(fromBlack)) return fromBlack.toLowerCase();
  const match = /rgba?\(([^)]+)\)/i.exec(fromBlack);
  if (!match) return fallback;
  const [r, g, b] = match[1]
    .split(/[,\s/]+/)
    .slice(0, 3)
    .map((part) => Math.max(0, Math.min(255, Math.round(Number.parseFloat(part)))));
  if (![r, g, b].every(Number.isFinite)) return fallback;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
