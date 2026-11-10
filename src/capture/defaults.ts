/**
 * When a captured value is worth writing down.
 *
 * Reading computed styles gives a value for every property of every element, and almost all of
 * them are the browser's defaults: `list-style-type: disc` on a `div`, `line-height: normal`,
 * `letter-spacing: normal`, `padding: 0px`. Written into the block they change nothing and bury the
 * few values that matter. Two questions decide each one:
 *
 * - **Is it the default?** The CSS initial value, as `getComputedStyle` writes it. A default is
 *   what the element gets in any page that does not restyle it, so it only needs writing where host
 *   pages commonly do restyle it, and the callers say where that is.
 * - **Can it affect this element?** List styles act on list items, flex alignment on flex and grid
 *   containers, `flex-grow` on their children, `object-fit` on images, `box-sizing` on an element
 *   with padding or a border, `text-decoration-color` on decorated text. Elsewhere any value is
 *   inert, default or not.
 */

/** Initial values as the CSSOM reads them back. */
export const INITIAL: Readonly<Record<string, readonly string[]>> = {
  // Inherited
  'font-style': ['normal'],
  'font-weight': ['400', 'normal'],
  'font-stretch': ['100%', 'normal'],
  'font-variant-caps': ['normal'],
  'font-variant-ligatures': ['normal'],
  'font-feature-settings': ['normal'],
  'font-variation-settings': ['normal'],
  'font-kerning': ['auto'],
  'line-height': ['normal'],
  'letter-spacing': ['normal', '0px'],
  'word-spacing': ['0px', 'normal'],
  'text-align': ['start'],
  'text-indent': ['0px'],
  'text-transform': ['none'],
  'text-shadow': ['none'],
  'text-rendering': ['auto'],
  '-webkit-font-smoothing': ['auto'],
  'white-space': ['normal'],
  'word-break': ['normal'],
  'overflow-wrap': ['normal'],
  hyphens: ['manual'],
  'tab-size': ['8'],
  'list-style-type': ['disc'],
  'list-style-position': ['outside'],
  quotes: ['auto'],
  cursor: ['auto'],
  visibility: ['visible'],
  direction: ['ltr'],
  'writing-mode': ['horizontal-tb'],
  'color-scheme': ['normal'],
  'accent-color': ['auto'],
  fill: ['rgb(0, 0, 0)'],
  'fill-opacity': ['1'],
  stroke: ['none'],
  'stroke-width': ['1px'],
  'stroke-linecap': ['butt'],
  'stroke-linejoin': ['miter'],
  'stroke-opacity': ['1'],
  // Not inherited
  'box-sizing': ['content-box'],
  float: ['none'],
  clear: ['none'],
  'vertical-align': ['baseline'],
  'margin-top': ['0px'],
  'margin-right': ['0px'],
  'margin-bottom': ['0px'],
  'margin-left': ['0px'],
  'padding-top': ['0px'],
  'padding-right': ['0px'],
  'padding-bottom': ['0px'],
  'padding-left': ['0px'],
  'border-top-style': ['none'],
  'border-right-style': ['none'],
  'border-bottom-style': ['none'],
  'border-left-style': ['none'],
  'border-top-left-radius': ['0px'],
  'border-top-right-radius': ['0px'],
  'border-bottom-right-radius': ['0px'],
  'border-bottom-left-radius': ['0px'],
  'background-color': ['rgba(0, 0, 0, 0)', 'transparent'],
  'background-image': ['none'],
  'background-size': ['auto', 'auto auto'],
  'background-position': ['0% 0%'],
  'background-repeat': ['repeat'],
  'background-clip': ['border-box'],
  'box-shadow': ['none'],
  opacity: ['1'],
  'overflow-x': ['visible'],
  'overflow-y': ['visible'],
  'text-overflow': ['clip'],
  'flex-direction': ['row'],
  'flex-wrap': ['nowrap'],
  'justify-content': ['normal'],
  'align-items': ['normal'],
  'align-content': ['normal'],
  'align-self': ['auto'],
  'justify-items': ['normal', 'legacy'],
  'justify-self': ['auto'],
  'row-gap': ['normal'],
  'column-gap': ['normal'],
  'flex-grow': ['0'],
  'flex-shrink': ['1'],
  'flex-basis': ['auto'],
  order: ['0'],
  'grid-column-start': ['auto'],
  'grid-column-end': ['auto'],
  'grid-row-start': ['auto'],
  'grid-row-end': ['auto'],
  'grid-auto-flow': ['row'],
  'min-width': ['auto', '0px'],
  'max-width': ['none'],
  'min-height': ['auto', '0px'],
  'max-height': ['none'],
  'aspect-ratio': ['auto'],
  'object-fit': ['fill'],
  'object-position': ['50% 50%'],
  'text-decoration-line': ['none'],
  'text-decoration-style': ['solid'],
  transform: ['none'],
  filter: ['none'],
  'outline-style': ['none'],
  content: ['normal', 'none'],
  display: ['inline'],
};

export function isInitial(name: string, value: string): boolean {
  return INITIAL[name]?.includes(value.trim()) ?? false;
}

const FLEX_OR_GRID = /^(?:inline-)?(?:flex|grid)$/;
const FLEX_CONTAINER = new Set(['flex-direction', 'flex-wrap']);
const ALIGN_CONTAINER = new Set(['justify-content', 'align-items', 'align-content', 'row-gap', 'column-gap']);
const GRID_CONTAINER = new Set(['justify-items', 'grid-auto-flow']);
const FLEX_ITEM = new Set(['flex-grow', 'flex-shrink', 'flex-basis', 'order', 'align-self', 'justify-self']);
const GRID_ITEM = new Set(['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end']);
const REPLACED_ONLY = new Set(['object-fit', 'object-position']);
const CONTROLS = new Set(['input', 'select', 'textarea', 'button', 'progress', 'meter']);

export interface Placement {
  tag: string;
  /** The element's own computed style. */
  style: CSSStyleDeclaration;
  /** Its parent's, when it has one. */
  parent: CSSStyleDeclaration | null;
  replaced: boolean;
}

/** Whether any value of `name` can change how this element renders. */
export function canAffect(name: string, at: Placement): boolean {
  const display = at.style.display;
  const parentDisplay = at.parent?.display ?? 'block';
  if (name.startsWith('list-style-')) return display === 'list-item';
  if (FLEX_CONTAINER.has(name)) return /flex$/.test(display);
  if (ALIGN_CONTAINER.has(name)) return FLEX_OR_GRID.test(display) || (name === 'column-gap' && at.style.columnCount !== 'auto');
  if (GRID_CONTAINER.has(name)) return /grid$/.test(display);
  if (FLEX_ITEM.has(name)) return FLEX_OR_GRID.test(parentDisplay);
  if (GRID_ITEM.has(name)) return /grid$/.test(parentDisplay);
  if (REPLACED_ONLY.has(name)) return at.replaced;
  if (name === 'vertical-align') return /^inline|^table-cell$/.test(display);
  if (name === 'text-overflow') return at.style.overflowX !== 'visible';
  if (name.startsWith('text-decoration-') && name !== 'text-decoration-line') return at.style.textDecorationLine !== 'none';
  if (name === 'box-sizing') {
    // Only an element with padding or a border sizes differently under the two models.
    const sides = ['top', 'right', 'bottom', 'left'];
    return sides.some((side) => parseFloat(at.style.getPropertyValue(`padding-${side}`)) > 0 ||
      (at.style.getPropertyValue(`border-${side}-style`) !== 'none' && parseFloat(at.style.getPropertyValue(`border-${side}-width`)) > 0));
  }
  if (name === 'caret-color' || name === 'accent-color') return CONTROLS.has(at.tag) || at.style.getPropertyValue('-webkit-user-modify') === 'read-write';
  if (name === 'tab-size') return /^pre/.test(at.style.whiteSpace) || at.style.whiteSpace === 'break-spaces';
  if (name === 'quotes') return at.tag === 'q' || at.tag === 'blockquote';
  return true;
}
