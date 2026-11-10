import { hasContainerGroup, type RuleNode } from './css-text.js';

/**
 * What the picked element got from outside itself, written so it travels with the copy.
 *
 * An element inherits its colour and font from `body` and further up, and those rules are not
 * kept (they do not match the element). The values that reach it are therefore read from its
 * parent and emitted as bare declarations, which HEO applies to the block root. Only the ones that
 * differ from a fresh document's defaults: a `color: rgb(0, 0, 0)` that is merely the default is
 * the paste target's business.
 */
const INHERITED = [
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-transform',
  'white-space',
  'direction',
  'writing-mode',
];

/** What a default element looks like, when no reference frame can be made. */
const FALLBACK: Record<string, string> = {
  color: 'rgb(0, 0, 0)',
  'font-size': '16px',
  'font-style': 'normal',
  'font-weight': '400',
  'line-height': 'normal',
  'letter-spacing': 'normal',
  'word-spacing': '0px',
  'text-align': 'start',
  'text-transform': 'none',
  'white-space': 'normal',
  direction: 'ltr',
  'writing-mode': 'horizontal-tb',
};

function referenceStyle(doc: Document): Record<string, string> {
  const frame = doc.createElement('iframe');
  frame.style.cssText = 'position: fixed; width: 0; height: 0; border: 0; visibility: hidden;';
  try {
    doc.documentElement.append(frame);
    const inner = frame.contentDocument;
    const view = frame.contentWindow;
    if (!inner?.body || !view) return FALLBACK;
    const probe = inner.createElement('div');
    inner.body.append(probe);
    const style = view.getComputedStyle(probe);
    return Object.fromEntries(INHERITED.map((name) => [name, style.getPropertyValue(name)]));
  } catch {
    return FALLBACK;
  } finally {
    frame.remove();
  }
}

export interface CaptureContext {
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
    const reference = referenceStyle(doc);
    const style = view.getComputedStyle(parent);
    for (const name of INHERITED) {
      const value = style.getPropertyValue(name);
      if (value && value !== reference[name]) declarations.push(`${name}: ${value}`);
    }
  }
  /*
   * A kept `@container` rule queried some ancestor that does not come along. Making the root a
   * container gives the query something to measure; without it the rule never applies at all.
   */
  if (hasContainerGroup(kept)) declarations.push('container-type: inline-size');
  const warnings: string[] = [];
  const rootFont = view.getComputedStyle(doc.documentElement).fontSize;
  if (rootFont && rootFont !== '16px') {
    warnings.push(`The source page's root font size is ${rootFont}; rem sizes will follow the page it is pasted into.`);
  }
  return { declarations, viewport: view.innerWidth, warnings };
}
