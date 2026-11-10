import { absolutizeCssUrls } from '../core/css-urls.js';
import { srcsetCandidates } from '../core/srcset.js';
import { escapeTemplateBraces } from './css-text.js';

/**
 * The picked element as standalone markup: what is rendered, not what the framework wrote.
 *
 * Open shadow roots are flattened into the copy and slots replaced by what they show, since a
 * pasted block has no component definition to recreate them. `<use href="#icon">` points at a
 * sprite that stays behind, so it becomes a copy of the symbol. Scripts and handlers go (v1
 * carries no JS), and so do framework attributes, unless the captured CSS selects on them.
 * Form state the user typed lives in properties, so it is written back to attributes.
 */

const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const FRAMEWORK = /^(?:data-reactroot|data-reactid|ng-version|data-server-rendered|wire:|x-|hx-|v-(?!-)|@|:)/;
/** Never copied: script, and the style sources whose rules are collected separately. */
const DROPPED = new Set(['script', 'noscript', 'style', 'link', 'template', 'meta', 'base']);

export interface Flattened {
  clone: Element;
  /** Live element to its copy, for marking copies found through the live tree. */
  map: Map<Element, Element>;
}

export function cloneFlattened(root: Element, options: { cssText?: string } = {}): Flattened {
  const doc = root.ownerDocument;
  const base = doc.baseURI;
  const css = options.cssText ?? '';
  const map = new Map<Element, Element>();
  const viewBoxes: Array<[Element, string]> = [];
  const expanding = new Set<Element>();

  const absolute = (value: string): string => {
    const text = value.trim();
    if (!text || /^(?:#|data:|blob:|javascript:)/i.test(text)) return value;
    try {
      return new URL(text, base).href;
    } catch {
      return value;
    }
  };

  const cloneChildren = (from: Iterable<Node>, into: Node): void => {
    for (const child of from) {
      const copy = cloneNode(child);
      if (copy) into.appendChild(copy);
    }
  };

  const scrubAttributes = (copy: Element): void => {
    for (const attr of Array.from(copy.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || (FRAMEWORK.test(name) && !css.includes(attr.name))) {
        copy.removeAttribute(attr.name);
      } else if (name === 'src' || name === 'poster' || name === 'href' || name === 'xlink:href') {
        attr.value = absolute(attr.value);
      } else if (name === 'srcset') {
        attr.value = srcsetCandidates(attr.value)
          .map((entry) => (entry.descriptor ? `${absolute(entry.url)} ${entry.descriptor}` : absolute(entry.url)))
          .join(', ');
      } else if (name === 'style') {
        attr.value = absolutizeCssUrls(attr.value, base);
      }
    }
  };

  const formState = (live: Element, copy: Element): void => {
    if (live instanceof HTMLInputElement) {
      if (live.type === 'checkbox' || live.type === 'radio') {
        if (live.checked) copy.setAttribute('checked', '');
        else copy.removeAttribute('checked');
      } else if (live.type === 'password' || live.type === 'file') {
        // A typed password never goes on a clipboard.
        copy.removeAttribute('value');
      } else if (live.value) {
        copy.setAttribute('value', live.value);
      }
    } else if (live instanceof HTMLOptionElement) {
      if (live.selected) copy.setAttribute('selected', '');
      else copy.removeAttribute('selected');
    } else if (live instanceof HTMLImageElement) {
      // The candidate on screen, plus the largest one for wider screens; the rest stay behind.
      const current = live.currentSrc;
      if (current) copy.setAttribute('src', current);
      const srcset = copy.getAttribute('srcset');
      if (srcset) {
        const candidates = srcsetCandidates(srcset);
        const weight = (descriptor: string): number => parseFloat(descriptor) || 1;
        const largest = candidates.reduce<(typeof candidates)[number] | null>(
          (best, entry) => (!best || weight(entry.descriptor) > weight(best.descriptor) ? entry : best), null);
        const kept = candidates.filter((entry) => entry.url === current || entry === largest);
        copy.setAttribute('srcset', kept.map((entry) => `${entry.url} ${entry.descriptor}`.trim()).join(', '));
      }
    }
  };

  const inlineUse = (use: Element): Element | null => {
    const ref = use.getAttribute('href') ?? use.getAttributeNS(XLINK, 'href');
    if (!ref || !ref.startsWith('#')) return null;
    const scope = use.getRootNode() as Document | ShadowRoot;
    let target: Element | null = null;
    try {
      target = scope.getElementById?.(decodeURIComponent(ref.slice(1))) ?? null;
    } catch {
      target = null;
    }
    if (!target || expanding.has(target)) return null;
    const group = doc.createElementNS(SVG, 'g');
    for (const attr of Array.from(use.attributes)) {
      if (/^(?:href|xlink:href|x|y|width|height)$/i.test(attr.name) || /^on/i.test(attr.name)) continue;
      group.setAttribute(attr.name, attr.value);
    }
    const x = parseFloat(use.getAttribute('x') ?? '') || 0;
    const y = parseFloat(use.getAttribute('y') ?? '') || 0;
    if (x || y) group.setAttribute('transform', `translate(${x} ${y}) ${group.getAttribute('transform') ?? ''}`.trim());
    expanding.add(target);
    cloneChildren(target.localName === 'symbol' ? Array.from(target.childNodes) : [target], group);
    expanding.delete(target);
    const viewBox = target.localName === 'symbol' ? target.getAttribute('viewBox') : null;
    if (viewBox) viewBoxes.push([group, viewBox]);
    map.set(use, group);
    return group;
  };

  function cloneNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.nodeValue ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const live = node as Element;
    if (DROPPED.has(live.localName)) return null;
    if (live.localName === 'slot' && live.getRootNode() instanceof ShadowRoot) {
      // What the slot shows: its assigned nodes, or its fallback content when there are none.
      const fragment = doc.createDocumentFragment();
      const assigned = (live as HTMLSlotElement).assignedNodes({ flatten: true });
      cloneChildren(assigned.length ? assigned : Array.from(live.childNodes), fragment);
      return fragment;
    }
    if (live.localName === 'use' && live.namespaceURI === SVG) {
      const inlined = inlineUse(live);
      if (inlined) return inlined;
    }
    const copy = live.cloneNode(false) as Element;
    map.set(live, copy);
    scrubAttributes(copy);
    formState(live, copy);
    cloneChildren(Array.from((live.shadowRoot ?? live).childNodes), copy);
    if (live instanceof HTMLTextAreaElement) copy.textContent = live.value;
    return copy;
  }

  const clone = cloneNode(root);
  if (!(clone instanceof Element)) throw new TypeError('This element cannot be captured.');
  for (const [group, viewBox] of viewBoxes) {
    const svg = group.closest('svg');
    if (svg && !svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', viewBox);
  }
  return { clone, map };
}

/** Markup text, with `{{` escaped so HEO's block templates do not take page text for props. */
export function serializeMarkup(element: Element): string {
  return escapeTemplateBraces(element.outerHTML);
}
