import { EDITING_ATTR, HOST_TAG, IGNORE_ATTR, INSERTED_ATTR, SOURCE_ATTR } from './constants.js';

/**
 * Two line breaks in a row, read as the paragraph break they almost always stand for.
 *
 * People press Enter twice to start a new paragraph, and inside a `<p>` the editor can only give
 * them a `<br>` each time — so the page ends up with one paragraph holding a blank line instead of
 * two paragraphs. This finds those blank lines and turns each into a split: the element is ended
 * at the breaks and what followed them moves into a new sibling of the same kind.
 */

/** Two or more consecutive line breaks inside one text block. */
export interface BreakRun {
  /** The element that gets split: the nearest block-level ancestor of the breaks. */
  block: HTMLElement;
  /**
   * The breaks that make the blank line, in document order.
   *
   * Never includes a trailing placeholder: a `<br>` with nothing after it in its block only holds
   * an empty last line open, which is how browsers make the line after an Enter visible.
   */
  breaks: HTMLBRElement[];
}

export interface FindBreakOptions {
  /** Do not look further up than this for the block: the element being edited, or `<body>`. */
  limit?: HTMLElement;
  /**
   * Accept a blank line at the very end of a block, with nothing after it yet.
   *
   * Only for the text edit the caret is in: it is what pressing Enter twice at the end of a
   * paragraph produces, and splitting there opens an empty paragraph to type into. Anywhere
   * else a trailing blank line has nothing to split off.
   */
  allowTrailing?: boolean;
  /** A last say over each block, for content the editor should not reshape. */
  accept?: (block: HTMLElement) => boolean;
}

/**
 * Elements that are never split.
 *
 * Table cells, captions and the like because a second one changes the structure around it rather
 * than adding a paragraph; preformatted text because its breaks are meant literally; controls and
 * one-per-parent elements because a copy of them is not a sentence anyone wants.
 */
const NEVER_SPLIT = new Set([
  'html', 'head', 'body', 'title', 'script', 'style', 'template', 'noscript',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup',
  'ul', 'ol', 'dl', 'menu',
  'pre', 'code', 'textarea', 'select', 'option', 'optgroup', 'button', 'label',
  'summary', 'legend', 'figcaption',
]);

/** Elements that are content in their own right, with or without text inside them. */
const REPLACED = new Set([
  'img', 'picture', 'video', 'audio', 'iframe', 'embed', 'object', 'canvas',
  'input', 'select', 'textarea', 'button', 'meter', 'progress', 'hr',
]);
const REPLACED_SELECTOR = [...REPLACED, 'svg', 'math'].join(',');

type Token = { kind: 'br'; node: HTMLBRElement } | { kind: 'content' };

/** Every run of double breaks under `root`, in document order. */
export function findBreakRuns(root: HTMLElement, options: FindBreakOptions = {}): BreakRun[] {
  const limit = options.limit ?? root;
  const blocks: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const br of Array.from(root.querySelectorAll('br'))) {
    if (br.closest(`[${IGNORE_ATTR}], ${HOST_TAG}`)) continue;
    const block = blockFor(br, limit);
    if (!block || seen.has(block)) continue;
    seen.add(block);
    blocks.push(block);
  }

  const runs: BreakRun[] = [];
  for (const block of blocks) {
    if (!splittable(block) || (options.accept && !options.accept(block))) continue;
    runs.push(...runsIn(block, Boolean(options.allowTrailing)));
  }
  return runs.sort((a, b) =>
    a.breaks[0].compareDocumentPosition(b.breaks[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/** The nearest ancestor that lays out as a block, without going past `limit`. */
function blockFor(br: HTMLBRElement, limit: HTMLElement): HTMLElement | null {
  let el = br.parentElement;
  while (el && el !== limit && isInlineLevel(el)) el = el.parentElement;
  return el;
}

function isInlineLevel(el: Element): boolean {
  const display = getComputedStyle(el).display;
  return display === 'inline' || display === 'contents';
}

function splittable(block: HTMLElement): boolean {
  if (!block.isConnected || !block.parentElement) return false;
  if (NEVER_SPLIT.has(block.tagName.toLowerCase())) return false;
  if (block.closest(`[${IGNORE_ATTR}], ${HOST_TAG}`)) return false;
  // A rich-text field the page runs itself is the page's to shape. The editor's own edit is
  // the one `contenteditable` that is marked as such.
  const editable = block.closest('[contenteditable]');
  if (editable && !editable.hasAttribute(EDITING_ATTR)) return false;
  return true;
}

function runsIn(block: HTMLElement, allowTrailing: boolean): BreakRun[] {
  const tokens: Token[] = [];
  collect(block, tokens);
  const runs: BreakRun[] = [];
  // Where the next piece would start once the previous run has been cut.
  let cut = 0;
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].kind !== 'br') {
      i += 1;
      continue;
    }
    let j = i;
    while (j < tokens.length && tokens[j].kind === 'br') j += 1;
    const breaks = tokens.slice(i, j).map((token) => (token as { node: HTMLBRElement }).node);
    const before = tokens.slice(cut, i).some((token) => token.kind === 'content');
    const after = tokens.slice(j).some((token) => token.kind === 'content');
    // With nothing after it, the last break is the placeholder holding the empty line open.
    const counted = after ? breaks : breaks.slice(0, -1);
    if (counted.length >= 2 && before && (after || allowTrailing)) {
      runs.push({ block, breaks: counted });
      cut = j;
    }
    i = j;
  }
  return runs;
}

/** The block's inline content as breaks and anything else, ignoring inline wrappers. */
function collect(node: Node, out: Token[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (/\S/.test((child as Text).data)) out.push({ kind: 'content' });
      continue;
    }
    if (!(child instanceof Element)) continue;
    if (child.hasAttribute(IGNORE_ATTR)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') {
      out.push({ kind: 'br', node: child as HTMLBRElement });
      continue;
    }
    if (!(child instanceof HTMLElement) || REPLACED.has(tag)) {
      out.push({ kind: 'content' });
      continue;
    }
    const display = getComputedStyle(child).display;
    if (display === 'none') continue;
    // A nested block is content, and a barrier: its own breaks are its own business.
    if (display === 'inline' || display === 'contents') collect(child, out);
    else out.push({ kind: 'content' });
  }
}

/** True when an element holds anything a reader would see. Safe on detached nodes. */
function hasContent(el: Element): boolean {
  return /\S/.test(el.textContent ?? '') || Boolean(el.querySelector(REPLACED_SELECTOR));
}

/**
 * Split a block at a run of breaks, and return the new element holding what came after.
 *
 * Built attached and filled afterwards, in that order on purpose: the DOM journal only sees
 * changes inside the document, and a node filled while detached would be replayed empty on redo.
 *
 * `extractContents` does the hard part. When the breaks sit inside inline wrappers — a `<b>` that
 * spans the blank line — it clones each wrapper it cuts through, so the bold carries on in the new
 * element exactly as it did on screen. The clones lose their `id` and build marker on the way, for
 * the reason a duplicate does: two elements cannot both be the one the file names.
 */
export function splitRun(run: BreakRun): HTMLElement {
  const { block, breaks } = run;
  const first = breaks[0];
  const last = breaks[breaks.length - 1];
  let wrappers = 0;
  for (let node = last.parentElement; node && node !== block; node = node.parentElement) wrappers += 1;

  const tail = document.createRange();
  tail.setStartAfter(last);
  tail.setEnd(block, block.childNodes.length);
  const moved = tail.extractContents();
  let edge: Node | null = moved.firstChild;
  for (let depth = 0; depth < wrappers && edge instanceof Element; depth += 1) {
    edge.removeAttribute('id');
    edge.removeAttribute(SOURCE_ATTR);
    edge = edge.firstChild;
  }

  const next = block.cloneNode(false) as HTMLElement;
  for (const name of ['id', SOURCE_ATTR, EDITING_ATTR, 'contenteditable', 'spellcheck']) {
    next.removeAttribute(name);
  }
  next.setAttribute(INSERTED_ATTR, '');
  block.after(next);
  next.append(moved);

  const gap = document.createRange();
  gap.setStartBefore(first);
  gap.setEndAfter(last);
  gap.deleteContents();

  trimEdge(block, 'end');
  trimEdge(next, 'start');
  // An element with nothing in it collapses to no height and cannot hold a caret.
  if (!hasContent(next) && !next.querySelector('br')) next.append(document.createElement('br'));
  return next;
}

/** Drop blank text and emptied wrappers left at the cut, so neither half starts or ends hollow. */
function trimEdge(el: HTMLElement, side: 'start' | 'end'): void {
  for (;;) {
    const node = side === 'end' ? el.lastChild : el.firstChild;
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (/\S/.test((node as Text).data)) return;
      node.remove();
      continue;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br' || REPLACED.has(tag) || hasContent(node) || node.querySelector('br')) return;
    node.remove();
  }
}
