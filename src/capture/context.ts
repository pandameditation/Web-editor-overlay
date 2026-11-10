import { hasContainerGroup, type RuleNode } from './css-text.js';

/**
 * What the picked element got from its surroundings, carried by a frame around the copy.
 *
 * The copy is wrapped in `<div data-cap-frame>`, which becomes the pasted block's root and stands
 * in for the source parent. HEO applies the bare declarations returned here to it:
 *
 * - every inherited value the parent passed down, whatever it is. Leaving out the ones that equal
 *   a blank page's defaults (as this used to) assumed the paste target is a blank page; a dark HEO
 *   page then turned black source text white;
 * - the background the element was seen on, when the element is see-through itself. Backgrounds do
 *   not inherit, so a white card on a dark band pasted as a white card on nothing;
 * - its rendered width as a `max-width`, when the parent's layout decided it (a card in a
 *   three-column grid). The frame is a plain block, and without it the card filled the whole row.
 *   A maximum, not a width, so the copy still narrows;
 * - `container-type`, when a kept rule is an `@container` query: the source's container stays
 *   behind, and the frame (an ancestor of the copy, as the container was) answers instead.
 */
export const FRAME_ATTR = 'data-cap-frame';

const INHERITED = [
  'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant-caps',
  'font-variant-ligatures', 'font-feature-settings', 'font-variation-settings', 'font-kerning',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform',
  'text-shadow', 'text-rendering', '-webkit-font-smoothing', 'white-space', 'word-break', 'overflow-wrap',
  'hyphens', 'tab-size', 'list-style-type', 'list-style-position', 'quotes', 'cursor', 'visibility',
  'direction', 'writing-mode', 'color-scheme', 'accent-color', 'caret-color', 'fill', 'stroke',
];

const seeThrough = (value: string): boolean => {
  const text = value.replace(/\s+/g, '');
  return text === 'transparent' || /^rgba\(\d+,\d+,\d+,0(?:\.0+)?\)$/.test(text);
};

/** The background colour the element was painted over: the nearest ancestor's that is not clear. */
function backdrop(start: Element | null, view: Window): string {
  for (let element = start; element;) {
    const color = view.getComputedStyle(element).backgroundColor;
    if (color && !seeThrough(color)) return color;
    const own = element.getRootNode();
    element = element.parentElement ?? (own instanceof ShadowRoot ? own.host : null);
  }
  // Nothing painted: the canvas, which is white unless the page asks for a dark scheme.
  const scheme = view.getComputedStyle(start?.ownerDocument.documentElement ?? document.documentElement).colorScheme;
  return /^dark\b/.test(scheme ?? '') ? 'rgb(18, 18, 18)' : 'rgb(255, 255, 255)';
}

export interface CaptureContext {
  /** Bare declarations for the frame. */
  declarations: string[];
  viewport: number;
  warnings: string[];
}

export function readContext(root: Element, kept: RuleNode[]): CaptureContext {
  const doc = root.ownerDocument;
  const view = doc.defaultView ?? window;
  const declarations: string[] = [];
  const own = root.getRootNode();
  const parent = root.parentElement ?? (own instanceof ShadowRoot ? own.host : null);
  if (parent) {
    const style = view.getComputedStyle(parent);
    for (const name of INHERITED) {
      const value = style.getPropertyValue(name);
      if (value) declarations.push(`${name}: ${value}`);
    }
  }

  const rootStyle = view.getComputedStyle(root);
  if (seeThrough(rootStyle.backgroundColor) && rootStyle.backgroundImage === 'none') {
    declarations.push(`background-color: ${backdrop(parent, view)}`);
  }

  if (parent) {
    const parentStyle = view.getComputedStyle(parent);
    const layout = parentStyle.display;
    const rect = root.getBoundingClientRect();
    const inner = parent.clientWidth -
      (parseFloat(parentStyle.paddingLeft) || 0) - (parseFloat(parentStyle.paddingRight) || 0);
    const margins = (parseFloat(rootStyle.marginLeft) || 0) + (parseFloat(rootStyle.marginRight) || 0);
    const outer = rect.width + Math.max(0, margins);
    const placedByParent = /flex|grid/.test(layout) || outer < inner - 1;
    if (placedByParent && rect.width > 0 && !/^inline/.test(rootStyle.display)) {
      declarations.push(`max-width: ${Math.ceil(outer)}px`);
    }
  }
  /*
   * A kept `@container` rule queried some ancestor that does not come along. The frame is an
   * ancestor of the copy, as that container was, so it can answer the query.
   */
  if (hasContainerGroup(kept)) declarations.push('container-type: inline-size');
  return { declarations, viewport: view.innerWidth, warnings: [] };
}
