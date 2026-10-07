/**
 * What a multi-element selection may do, worked out from the DOM alone.
 *
 * Pure functions over nodes, with no engine state: the quick menu reads them to grey out an item
 * and say why, and the engine reads them again before it mutates anything, because the menu is
 * advisory and the engine is callable without it.
 */

import { isMutable } from './dom.js';

export type Eligibility = { ok: true } | { ok: false; reason: string };

export interface GroupActions {
  wrap: Eligibility;
  merge: Eligibility;
  delete: Eligibility;
  saveBlock: Eligibility;
}

/** [node, host of node's tree, host of that host's tree, …], ending in a node of the document tree. */
const lift = (n: Node): Node[] => {
  const chain = [n];
  for (let root = n.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) chain.push(root.host);
  return chain;
};

/*
 * Shadow-including document order.
 *
 * `compareDocumentPosition` alone reports nodes in different trees as disconnected, with an
 * order that is implementation-defined, so a member inside a shadow root sorted wherever the
 * browser felt like. Both nodes are lifted to the deepest tree they share and compared there.
 */
function compare(a: Node, b: Node): number {
  if (a === b) return 0;
  const ca = lift(a), cb = lift(b);
  // Deepest tree both chains reach: walk from the document end while the roots match.
  let i = ca.length - 1, j = cb.length - 1;
  while (i > 0 && j > 0 && ca[i - 1].getRootNode() === cb[j - 1].getRootNode()) { i--; j--; }
  const x = ca[i], y = cb[j];                 // the two representatives in that common tree
  if (x === y) return i === 0 ? -1 : 1;       // one is the host of the other's tree: the host first
  return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * The members sorted into document order, crossing shadow boundaries.
 *
 * The selection is stored this way so click order can never leak into a group result: wrapping
 * b-then-a must produce the same container as a-then-b.
 */
export function inDocumentOrder(els: readonly HTMLElement[]): HTMLElement[] {
  return [...els].sort(compare);
}

/** True when `ancestor` contains `node`, looking through shadow roots to their hosts. */
function shadowIncludingContains(ancestor: Node, node: Node): boolean {
  for (let n: Node | null = node; n;) {
    if (n === ancestor) return true;
    const parent: Node | null = n.parentNode;
    n = parent instanceof ShadowRoot ? parent.host : parent;
  }
  return false;
}

/**
 * Drop every member that has another member as a shadow-including ancestor (DP-8).
 *
 * A descendant goes wherever its ancestor goes, so deleting or capturing both would act on the
 * child twice: once as itself, once inside its parent.
 */
export function outermost(els: readonly HTMLElement[]): HTMLElement[] {
  return els.filter((el) => !els.some((other) => other !== el && shadowIncludingContains(other, el)));
}

const OK: Eligibility = { ok: true };

/**
 * Wrap needs every member under one parent (DP-1a).
 *
 * Wrapping at the first member's parent would silently pull the others out of their own
 * containers. A nested pair fails here too, because the child's parent is not the ancestor's.
 * Provenance is not checked, mirroring the single-element wrap.
 */
export function wrapEligibility(els: readonly HTMLElement[]): Eligibility {
  const parent = els[0]?.parentNode ?? null;
  if (els.every((el) => isMutable(el) && el.parentNode === parent)) return OK;
  return { ok: false, reason: 'Selected elements are in different containers.' };
}

export const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Elements whose children are not what the user sees, or that cannot have any. */
export const NOT_MERGEABLE: ReadonlySet<string> = new Set([
  // void
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
  // replaced or opaque
  'textarea', 'select', 'script', 'style', 'template', 'iframe', 'video', 'audio', 'canvas',
  'object', 'picture', 'noscript', 'math', 'svg',
]);

/**
 * True when an element's light-DOM children are its visible content.
 *
 * The namespace test is the one doing the work for SVG, which `isSelectable` admits: without it
 * two icons merged into one viewBox, and two paths "merged" by deleting the second. A shadow host
 * or a custom element renders its own content, so appending to its light DOM shows nothing.
 * A closed shadow root is invisible as `shadowRoot`, which the hyphen test covers for every
 * autonomous custom element.
 */
export const holdsContent = (el: Element): boolean =>
  el.namespaceURI === HTML_NS &&
  !NOT_MERGEABLE.has(el.localName) &&
  !el.shadowRoot &&
  !el.localName.includes('-');

/** Nothing a reader would see stands between two siblings: only comments and blank text. */
function sideBySide(a: Node, b: Node): boolean {
  for (let n = a.nextSibling; n; n = n.nextSibling) {
    if (n === b) return true;
    if (n.nodeType === Node.COMMENT_NODE) continue;
    if (n.nodeType === Node.TEXT_NODE && !(n.nodeValue ?? '').trim()) continue;
    return false;
  }
  return false;
}

/**
 * Merge rules (DP-2), first failing rule wins, so the reason the menu shows is the first thing
 * the user would have to change.
 *
 * Rule 0 comes first because the merge removes every later member and rewrites the first: a
 * member the editor may not touch would otherwise be refused only by the later rules, or not at
 * all, depending on its shape.
 */
export function mergeEligibility(
  els: readonly HTMLElement[],
  mayReshape: (el: HTMLElement) => boolean,
): Eligibility {
  if (!els.every((el) => isMutable(el))) {
    return { ok: false, reason: 'One of the selected elements cannot be changed.' };
  }
  const tag = els[0]?.localName;
  if (!els.every((el) => el.localName === tag)) {
    return { ok: false, reason: 'Merge needs elements of the same type.' };
  }
  if (!els.every(holdsContent)) {
    return { ok: false, reason: 'Merge needs elements that can hold content.' };
  }
  const parent = els[0]?.parentNode ?? null;
  const adjacent = els.every(
    (el, index) => el.parentNode === parent && (index === 0 || sideBySide(els[index - 1], el)),
  );
  if (!adjacent) {
    return { ok: false, reason: 'Merge needs elements side by side in the same container.' };
  }
  if (!els.every((el) => mayReshape(el))) {
    return { ok: false, reason: "Merge needs elements not built by the page's code." };
  }
  return OK;
}

/**
 * Delete needs every outermost member to be removable (FR-9.1).
 *
 * Unreachable through the UI, which only ever selects mutable elements; kept for API callers.
 */
export function deleteEligibility(els: readonly HTMLElement[]): Eligibility {
  if (outermost(els).every((el) => isMutable(el))) return OK;
  return { ok: false, reason: 'One of the selected elements cannot be removed.' };
}

/** Saving as a block copies markup and touches nothing, so any set of roots can be saved. */
export function saveBlockEligibility(_els: readonly HTMLElement[]): Eligibility {
  return OK;
}

/*
 * A child the merge boundary counts: not a comment, not blank text, not a script or template,
 * and not an element the page hides. Those read as nothing, so the boundary looks past them.
 */
function meaningful(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return Boolean((node.nodeValue ?? '').trim());
  if (!(node instanceof Element)) return false;
  if (node.localName === 'script' || node.localName === 'template') return false;
  return getComputedStyle(node).display !== 'none';
}

/** An element whose box breaks the line on its own: anything but inline-level, contents or ruby. */
function blockLevel(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  const display = getComputedStyle(node).display;
  return !(
    display.startsWith('inline') ||
    display === 'contents' ||
    display === 'none' ||
    display.startsWith('ruby')
  );
}

const isBreak = (node: Node): boolean => node instanceof Element && node.localName === 'br';

/**
 * What a merge puts between `into`'s current content and `next`'s, so the merged texts read as
 * separate lines rather than running together.
 *
 * Decided on the boundary *children*, never descending: in a div holding a paragraph, the
 * boundary is the paragraph, not its text, which would read as inline and get a break.
 *
 * - `'none'`: one side has nothing to separate.
 * - `'newline'`: a line already breaks there, because one side is a `<br>` or a block-level
 *   box. Only a source newline is added. A `<br>` beside a block makes a line of its own, a blank
 *   one (measured: a div holding a margin-free paragraph, a `<br>` and text grew from 40px to
 *   60px at a 20px line height), and a `<br>` beside an existing one makes a double break, which
 *   the split-at-double-breaks feature treats as a paragraph boundary.
 * - `'break'`: text or inline content on both sides, which would run on. A `<br>` goes between.
 */
export function mergeBoundary(into: Element, next: Element): 'break' | 'newline' | 'none' {
  const last = Array.from(into.childNodes).reverse().find(meaningful);
  const head = Array.from(next.childNodes).find(meaningful);
  if (!last || !head) return 'none';
  if (isBreak(last) || isBreak(head)) return 'newline';
  if (blockLevel(last) || blockLevel(head)) return 'newline';
  return 'break';
}

/**
 * True when the element collapses white space, so a source newline in it is invisible.
 *
 * In pre and pre-wrap a newline renders as a line of its own, so there it is left out.
 */
export function collapsesWhiteSpace(el: Element): boolean {
  const style = getComputedStyle(el);
  const collapse = style.getPropertyValue('white-space-collapse');
  if (collapse) return collapse === 'collapse';
  return style.whiteSpace === 'normal' || style.whiteSpace === 'nowrap';
}
