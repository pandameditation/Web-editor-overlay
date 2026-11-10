/**
 * A floor of rendered values under the captured rules, so the paste looks like the source.
 *
 * The rules that come along are what keep the copy responsive, but they are never the whole
 * story. Some cannot travel (`li:nth-child(2)` on the picked element, `:host` in a component),
 * and the page the copy lands in has rules of its own: `* { box-sizing: border-box }`,
 * `p { margin: 0 }`, `img { height: auto }`, `a { color: … }`. Either way the paste came out
 * with sizes, spacing and colours that were not the source's.
 *
 * So every element also gets the values it was rendered with, in a rule that loses to every
 * captured rule: `:where([data-cap-s="3"])` weighs nothing, and these rules come first. Where a
 * captured rule applies (at this width or any other, hovered or not), it wins; where none does,
 * the element still renders as it did, and the host page's own CSS, which HEO's scope outweighs,
 * does not reach it. Identical sets share one rule.
 *
 * What is not pinned:
 * - widths and heights, except of images, icons and other replaced elements: a block's width is
 *   the layout's business, and pinning it would undo the responsiveness the rules carry;
 * - grid templates, which read back as pixel track lists;
 * - inherited values that only repeat the parent's, unless the element is one host pages restyle
 *   (links, buttons, headings, form controls);
 * - properties a captured rule without conditions already sets on the element: that rule applies
 *   at every width, outweighs the host page, and is the value the reader should see;
 * - properties an animation or transition is driving right now, and properties a captured
 *   `:hover`/`:focus` rule sets on an element in that state: those values are a moment, not the
 *   element's resting look.
 */

export const PIN_ATTR = 'data-cap-s';

const INHERITED = [
  'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant-caps',
  'font-variant-ligatures', 'font-feature-settings', 'font-variation-settings', 'line-height',
  'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform', 'text-shadow',
  'white-space', 'word-break', 'overflow-wrap', 'list-style-type', 'list-style-position', 'visibility',
  'cursor', 'direction', '-webkit-font-smoothing',
];

const BOX = [
  'display', 'box-sizing', 'float', 'clear', 'vertical-align',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'background-clip', 'box-shadow', 'opacity', 'overflow-x', 'overflow-y', 'text-overflow',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self',
  'justify-items', 'justify-self', 'row-gap', 'column-gap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end', 'grid-auto-flow',
  'min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio', 'object-fit', 'object-position',
  'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'transform', 'filter',
  'outline-style', 'outline-width', 'outline-color',
];

/** Always pinned: what host-page resets change most. */
const ALWAYS = new Set([
  'box-sizing', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
]);

/** Elements host pages restyle: every listed value is pinned on them. */
const RESTYLED = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p',
  'small', 'strong', 'b', 'em', 'i', 'code', 'pre', 'kbd', 'th', 'td', 'li', 'ul', 'ol', 'summary',
  'blockquote', 'figure', 'hr', 'sup', 'sub', 'table',
]);

/** On restyled elements, the inherited values host pages set on them directly. */
const RESTYLED_INHERITED = new Set([
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-transform', 'text-align', 'list-style-type', 'white-space',
]);
/** On restyled elements, the box values host resets change. */
const RESTYLED_BOX = new Set([
  'display', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'text-decoration-line', 'background-color', 'vertical-align', 'max-width',
]);

/** Elements whose size is their own, not the layout's. */
const REPLACED = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'picture', 'object', 'embed', 'input', 'select', 'textarea', 'button']);

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'color', 'opacity', 'display', 'visibility'];

const PSEUDO_PROPS = [
  'content', 'display', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
  'color', 'vertical-align', 'text-transform', 'letter-spacing', '-webkit-font-smoothing', 'font-feature-settings',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'background-color', 'background-image', 'opacity', 'transform',
];

const USER_STATE = ':hover, :focus, :focus-within, :active';

type Snapshot = Record<string, string>;

/** Computed values for an element of each tag in a blank standards-mode document. */
function defaultStyles(doc: Document): { of(element: Element): Snapshot; dispose(): void } {
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position: fixed; width: 0; height: 0; border: 0; visibility: hidden; left: -10px;';
  doc.documentElement.append(frame);
  const inner = frame.contentDocument;
  const view = frame.contentWindow;
  try {
    inner?.open();
    inner?.write('<!doctype html><html><head></head><body></body></html>');
    inner?.close();
  } catch {
    /* a sandboxed page refuses; every value then counts as different, which is only larger */
  }
  const cache = new Map<string, Snapshot>();
  return {
    of(element) {
      const key = `${element.namespaceURI}|${element.localName}`;
      const known = cache.get(key);
      if (known) return known;
      const out: Snapshot = {};
      if (inner?.body && view) {
        const probe = inner.createElementNS(element.namespaceURI ?? '', element.localName);
        (element.namespaceURI === SVG_NS && element.localName !== 'svg'
          ? inner.body.appendChild(inner.createElementNS(SVG_NS, 'svg'))
          : inner.body
        ).appendChild(probe);
        const style = view.getComputedStyle(probe);
        for (const name of [...INHERITED, ...BOX]) out[name] = style.getPropertyValue(name);
        probe.remove();
      }
      cache.set(key, out);
      return out;
    },
    dispose: () => frame.remove(),
  };
}

const kebab = (name: string): string => name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

/** True when `declared` (a longhand or shorthand name) sets `property`. */
function sets(declared: string, property: string): boolean {
  if (declared === property) return true;
  const want = property.split('-');
  const have = declared.split('-');
  let at = 0;
  for (const part of want) if (part === have[at]) at += 1;
  return at === have.length && have[0] === want[0];
}

function animatedProperties(element: Element): string[] {
  const out: string[] = [];
  for (const animation of element.getAnimations?.() ?? []) {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || effect.pseudoElement) continue;
    for (const frame of effect.getKeyframes()) {
      for (const key of Object.keys(frame)) {
        if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key)) out.push(kebab(key));
      }
    }
  }
  return out;
}

const transparent = (value: string): boolean =>
  value === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(value.replace(/\s+/g, ' '));

export interface PinResult {
  css: string;
  /** Elements given a floor. */
  count: number;
}

/**
 * Pin the rendered values of every element in the copy.
 *
 * `map` is live element to copy, as `cloneFlattened` returns it; `stateful` is the property
 * names that captured `:hover`/`:focus` rules declare.
 */
export function pinRendered(
  root: Element,
  map: Map<Element, Element>,
  stateful: Iterable<string>,
  explained: (element: Element) => readonly string[] = () => [],
): PinResult {
  const doc = root.ownerDocument;
  const view = doc.defaultView ?? window;
  const live = new Map<Element, Element>();
  for (const [from, to] of map) live.set(to, from);
  const copyRoot = map.get(root);
  if (!copyRoot) return { css: '', count: 0 };
  const stateNames = [...new Set(stateful)];
  const defaults = defaultStyles(doc);
  const rules = new Map<string, string>();
  let count = 0;
  try {
    const copies = [copyRoot, ...Array.from(copyRoot.querySelectorAll('*'))];
    for (const copy of copies) {
      const source = live.get(copy);
      if (!source || source.localName === 'use') continue;
      const style = view.getComputedStyle(source);
      const parentLive = copy === copyRoot
        ? source.parentElement ?? ((source.getRootNode() as ShadowRoot).host ?? null)
        : live.get(copy.parentElement as Element) ?? null;
      const parent = parentLive ? view.getComputedStyle(parentLive) : null;
      const reference = defaults.of(source);
      const tag = source.localName.toLowerCase();
      const isSvg = source.namespaceURI === SVG_NS;
      const restyled = RESTYLED.has(tag);

      let inState = false;
      try {
        inState = stateNames.length > 0 && source.matches(USER_STATE);
      } catch {
        inState = false;
      }
      const moving = animatedProperties(source);
      const covered = explained(source);
      const skip = (name: string): boolean =>
        covered.some((declared) => sets(declared, name)) ||
        moving.some((animated) => sets(animated, name)) ||
        (inState && stateNames.some((declared) => sets(declared, name)));

      const declarations: string[] = [];
      const add = (name: string, value: string): void => {
        if (value && !skip(name)) declarations.push(`${name}: ${value}`);
      };
      if (isSvg && tag !== 'svg') {
        for (const name of SVG_PROPS) add(name, style.getPropertyValue(name));
      } else {
        for (const name of INHERITED) {
          const value = style.getPropertyValue(name);
          if ((restyled && RESTYLED_INHERITED.has(name)) || !parent || parent.getPropertyValue(name) !== value) add(name, value);
        }
        const bordered = (side: string): boolean => style.getPropertyValue(`border-${side}-style`) !== 'none';
        for (const name of BOX) {
          const value = style.getPropertyValue(name);
          const side = /^border-(top|right|bottom|left)-(?:width|color)$/.exec(name)?.[1];
          if (side && !bordered(side)) continue;
          if (name.startsWith('outline-') && name !== 'outline-style' && style.getPropertyValue('outline-style') === 'none') continue;
          if ((restyled && RESTYLED_BOX.has(name)) || ALWAYS.has(name) || value !== reference[name]) add(name, value);
        }
        if (REPLACED.has(tag)) {
          add('width', style.getPropertyValue('width'));
          add('height', style.getPropertyValue('height'));
        }
        if (tag === 'svg') for (const name of ['fill', 'stroke']) add(name, style.getPropertyValue(name));
      }

      const pseudos: string[] = [];
      if (!isSvg) {
        for (const pseudo of ['::before', '::after']) {
          const generated = view.getComputedStyle(source, pseudo);
          const content = generated.getPropertyValue('content');
          if (!content || content === 'none' || content === 'normal') continue;
          const parts = PSEUDO_PROPS
            .map((name) => [name, generated.getPropertyValue(name)] as const)
            .filter(([name, value]) => value && !(name === 'background-color' && transparent(value)) &&
              !(name === 'background-image' && value === 'none'))
            .map(([name, value]) => `${name}: ${value}`);
          pseudos.push(`${pseudo}|${parts.join('; ')}`);
        }
      }
      if (!declarations.length && !pseudos.length) continue;
      const key = `${declarations.join('; ')}\n${pseudos.join('\n')}`;
      let id = rules.get(key);
      if (!id) {
        id = String(rules.size + 1);
        rules.set(key, id);
      }
      copy.setAttribute(PIN_ATTR, id);
      count += 1;
    }
  } finally {
    defaults.dispose();
  }

  const css: string[] = [];
  for (const [key, id] of rules) {
    const [own, ...pseudos] = key.split('\n');
    const selector = `:where([${PIN_ATTR}="${id}"])`;
    if (own) css.push(`${selector} { ${own}; }`);
    for (const entry of pseudos) {
      if (!entry) continue;
      const bar = entry.indexOf('|');
      css.push(`${selector}${entry.slice(0, bar)} { ${entry.slice(bar + 1)}; }`);
    }
  }
  return { css: css.join('\n'), count };
}
