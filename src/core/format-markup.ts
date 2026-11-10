/**
 * Indent a block's markup without changing how it renders.
 *
 * `formatHTML` (the code panel's pretty-printer) puts every tag on its own line, which is
 * harmless to read and not harmless to render: a line break between `<i class="icon">` and
 * `<span>`, or between two `inline-block` cards, is a space on screen. A captured block arrives as
 * one long line, and indenting it that way would have opened gaps that were not on the source.
 *
 * So this works on a rendered copy and only breaks lines where whitespace cannot show:
 * - inside flex and grid containers, table parts and `display: none` subtrees, which ignore
 *   whitespace-only text between their children;
 * - inside a block container whose children are all block-level (block, list-item, table,
 *   flex/grid boxes, floats, absolutely positioned), with no text of its own between them;
 * - inside SVG, outside `<text>`.
 * Never inside anything whose `white-space` preserves spaces, nor in `pre`, `textarea` and the like.
 * Elsewhere the markup is left exactly as it was, so a paragraph of inline content stays one line.
 */

const PRESERVED = new Set(['pre', 'textarea', 'script', 'style', 'code', 'kbd', 'samp', 'listing', 'xmp', 'plaintext']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TEXT = new Set(['text', 'tspan', 'textpath']);
const WHITESPACE_BLIND = /^(?:flex|inline-flex|grid|inline-grid|none|table|inline-table|table-row|table-row-group|table-header-group|table-footer-group|table-column-group)$/;
const BLOCK_LEVEL = /^(?:block|list-item|table|flex|grid|flow-root|none)$/;

function isBlank(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && !/\S/.test(node.nodeValue ?? '');
}

function breakable(element: Element, view: Window): boolean {
  const children = Array.from(element.childNodes);
  // Text of its own between the children: that is inline content, and its spacing is the author's.
  if (children.some((node) => node.nodeType === Node.TEXT_NODE && !isBlank(node))) return false;
  const kids = children.filter((node): node is Element => node.nodeType === Node.ELEMENT_NODE);
  if (!kids.length) return false;
  if (element.namespaceURI === SVG_NS) return !SVG_TEXT.has(element.localName.toLowerCase());
  const style = view.getComputedStyle(element);
  if (/^(?:pre|pre-wrap|pre-line|break-spaces)$/.test(style.whiteSpace)) return false;
  if (style.display === 'contents') return false;
  if (WHITESPACE_BLIND.test(style.display)) return true;
  return kids.every((kid) => {
    if (kid.namespaceURI === SVG_NS && kid.localName !== 'svg') return false;
    const own = view.getComputedStyle(kid);
    return BLOCK_LEVEL.test(own.display) || own.float !== 'none' || /^(?:absolute|fixed)$/.test(own.position);
  });
}

function indentChildren(element: Element, depth: number, unit: string, view: Window): void {
  if (PRESERVED.has(element.localName.toLowerCase())) return;
  if (breakable(element, view)) {
    for (const node of Array.from(element.childNodes)) if (isBlank(node)) node.remove();
    const doc = element.ownerDocument;
    for (const child of Array.from(element.childNodes)) {
      element.insertBefore(doc.createTextNode(`\n${unit.repeat(depth + 1)}`), child);
    }
    element.append(doc.createTextNode(`\n${unit.repeat(depth)}`));
  }
  for (const child of Array.from(element.children)) indentChildren(child, depth + 1, unit, view);
}

/**
 * The markup in `container`, re-indented where whitespace is invisible, as HTML text.
 *
 * `container` must be rendered (in a document with the block's CSS) so displays can be read.
 * It is changed in place.
 */
export function formatRenderedMarkup(container: Element, unit = '  '): string {
  const view = container.ownerDocument.defaultView;
  if (!view) return container.innerHTML;
  // The top level is left as it is: those nodes are inserted into the page side by side.
  for (const child of Array.from(container.children)) indentChildren(child, 0, unit, view);
  return container.innerHTML.trim();
}
