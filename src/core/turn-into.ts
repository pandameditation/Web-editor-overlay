import { EDITING_ATTR, INSERTED_ATTR, SOURCE_ATTR } from './constants.js';
import type { LibraryBlock } from './types.js';

/**
 * Turning an element into a block, keeping what it says.
 *
 * Replacing an element with a freshly inserted block throws its words away and leaves the
 * block's placeholder text in their place, which is the opposite of what "turn this into a card"
 * means. So both sides are read as *content* rather than as trees: the old element's headings,
 * paragraphs, list items, links and images, and the new block's places for each. They are paired
 * by what they are — a heading goes to the heading, a link to the link — and only then by order,
 * so the transfer survives two structures that have nothing else in common.
 *
 * Where the block declares a prop for a place, the words go into the prop rather than straight
 * into the markup. That keeps the result an honest instance of its block: its Props panel shows
 * the carried text, and syncing it with a newer version of the block keeps it.
 */

/** A piece of content, on either side of the transfer. */
interface Piece {
  node: Element | Text;
  tag: string;
  family: Family;
  media: boolean;
}

type Family = 'heading' | 'para' | 'item' | 'action' | 'quote' | 'term' | 'cell' | 'inline' | 'media';

/** Elements that only ever hold a run of text, so one of them with words in it is one piece. */
const PHRASING = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark',
  'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'label',
  'del', 'ins', 'font', 'img', 'svg', 'picture',
]);
const MEDIA = new Set(['img', 'picture', 'video', 'audio', 'svg', 'iframe', 'canvas', 'object', 'embed']);
/** Elements that carry nothing a reader would move: separators, controls, scripts. */
const SKIPPED = new Set([
  'br', 'hr', 'wbr', 'script', 'style', 'template', 'noscript', 'input', 'select', 'textarea',
  'meta', 'link', 'source', 'track',
]);

function familyOf(tag: string): Family {
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'li') return 'item';
  if (tag === 'a' || tag === 'button') return 'action';
  if (tag === 'blockquote' || tag === 'q') return 'quote';
  if (tag === 'dt' || tag === 'dd') return 'term';
  if (tag === 'td' || tag === 'th') return 'cell';
  if (MEDIA.has(tag)) return 'media';
  if (tag === '#text' || PHRASING.has(tag)) return 'inline';
  return 'para';
}

/** Generic boxes: a run of separate spans inside one of these is several places, not one. */
const BOXES = new Set([
  'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'figure', 'form',
  'fieldset', 'details', 'hgroup', 'address',
]);
/** Elements that cannot hold children, so a block made of one has nowhere to put content. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * True when the element is one place for words: everything inside it is text-level.
 *
 * Except a generic box holding several separate pieces and nothing between them — a stat's value
 * and label, a cluster's tags — which is several places that happen to be inline.
 */
function isTextBlock(el: Element): boolean {
  const children = Array.from(el.children).filter((child) => child.tagName !== 'BR');
  if (children.some((child) => !PHRASING.has(child.tagName.toLowerCase()))) return false;
  if (!BOXES.has(el.tagName.toLowerCase()) || children.length <= 1) return true;
  return Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && hasWords(node));
}

function hasWords(node: Node): boolean {
  return /\S/.test(node.textContent ?? '');
}

/**
 * Every piece of content under `root`, in reading order.
 *
 * `slots` reads a block's template rather than a page element: there an element with no words in
 * it is still a place to put some, because a template may leave a `<p></p>` to be filled.
 */
function piecesOf(root: Element, slots: boolean): Piece[] {
  const out: Piece[] = [];
  const visit = (el: Element): void => {
    const tag = el.tagName.toLowerCase();
    if (SKIPPED.has(tag)) return;
    if (MEDIA.has(tag)) {
      out.push({ node: el, tag, family: 'media', media: true });
      return;
    }
    if (isTextBlock(el)) {
      if (slots || hasWords(el) || el.querySelector('img, svg, picture')) {
        out.push({ node: el, tag, family: familyOf(tag), media: false });
      }
      return;
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (hasWords(child)) out.push({ node: child as Text, tag: '#text', family: 'inline', media: false });
      } else if (child instanceof Element) {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
}

/**
 * Which piece goes where: same tag, then same kind, then order. Each piece is used once, and media
 * only ever goes to media.
 */
function pair(slots: readonly Piece[], pieces: readonly Piece[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const used = new Set<number>();
  const pass = (fits: (slot: Piece, piece: Piece) => boolean): void => {
    slots.forEach((slot, s) => {
      if (pairs.has(s)) return;
      const p = pieces.findIndex((piece, index) => !used.has(index) && fits(slot, piece));
      if (p < 0) return;
      pairs.set(s, p);
      used.add(p);
    });
  };
  pass((slot, piece) => slot.media === piece.media && slot.tag === piece.tag && slot.tag !== '#text');
  pass((slot, piece) => slot.media === piece.media && slot.family === piece.family);
  pass((slot, piece) => slot.media === piece.media);
  return pairs;
}

/** How to find a node again in a second render of the same template: element indices, then text. */
interface NodePath {
  root: number;
  steps: number[];
  /** For a text node: which text child of the element at `steps` it is. */
  text?: number;
}

function pathOf(node: Element | Text, roots: readonly Element[]): NodePath | null {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return null;
  const steps: number[] = [];
  let current: Element = element;
  for (;;) {
    const root = roots.indexOf(current);
    if (root >= 0) {
      const text = node instanceof Text
        ? Array.from(element.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE).indexOf(node)
        : undefined;
      return { root, steps: steps.reverse(), text };
    }
    const parent: Element | null = current.parentElement;
    if (!parent) return null;
    steps.push(Array.from(parent.children).indexOf(current));
    current = parent;
  }
}

function resolve(path: NodePath, roots: readonly Element[]): Element | Text | null {
  let current: Element | undefined = roots[path.root];
  for (const step of path.steps) current = current?.children[step];
  if (!current) return null;
  if (path.text === undefined) return current;
  const text = Array.from(current.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE)[path.text];
  return (text as Text | undefined) ?? null;
}

/** Everything decided before the block is built. */
export interface TurnPlan {
  /** Prop values the block is to be instantiated with: the carried words, where a prop takes them. */
  values: Record<string, string>;
  /** Where each paired piece goes in the built block, found again by path. */
  fills: Array<{ slot: NodePath; piece: Piece; viaProp: boolean }>;
  /** Pieces nothing in the block has room for, to be added beside a slot of the same kind. */
  leftovers: Piece[];
  /** The block has no places for content at all, so the old content goes inside it whole. */
  container: boolean;
  /** Old and new roots are both a single run of text: a retag, which keeps id, class and style. */
  retag: boolean;
  source: HTMLElement;
}

/**
 * Plan the transfer from `source` into `block`, using `expand` to render the template inertly.
 *
 * Text and URL props are rendered as unique markers first, which is how a place in the template is
 * known to be filled by a prop rather than written into the markup.
 */
export function planTurnInto(
  source: HTMLElement,
  block: LibraryBlock,
  expand: (block: LibraryBlock, values: Record<string, string>) => string,
  defaults: Record<string, string>,
): TurnPlan {
  const markers = new Map<string, string>();
  const probeValues: Record<string, string> = { ...defaults };
  Object.entries(block.props ?? {}).forEach(([name, spec], index) => {
    if (spec.type !== 'text' && spec.type !== 'url') return;
    const marker = `heoturn${index}x${Math.random().toString(36).slice(2, 8)}`;
    markers.set(marker, name);
    probeValues[name] = marker;
  });
  const holder = document.createElement('template');
  holder.innerHTML = expand(block, probeValues);
  const roots = Array.from(holder.content.children);

  const slots = roots.flatMap((root) => piecesOf(root, true));
  const pieces = piecesOf(source, false);
  const pairs = pair(slots, pieces);

  const values: Record<string, string> = { ...defaults };
  const fills: TurnPlan['fills'] = [];
  for (const [s, p] of pairs) {
    const slot = slots[s];
    const piece = pieces[p];
    const path = pathOf(slot.node, roots);
    if (!path) continue;
    const prop = markers.get((slot.node.textContent ?? '').trim());
    if (prop) values[prop] = plainText(piece.node);
    // A link's address goes with it, into the prop that holds the slot's own address.
    if (slot.node instanceof Element && slot.tag === 'a') {
      const hrefProp = markers.get(slot.node.getAttribute('href') ?? '');
      const href = linkOf(piece.node)?.getAttribute('href');
      if (hrefProp && href) values[hrefProp] = href;
    }
    // Rich content still goes into the markup, so a bolded word or a link inside a sentence
    // survives; the prop holds its text, which is all a prop can hold.
    fills.push({ slot: path, piece, viaProp: Boolean(prop) && !hasMarkup(piece.node) });
  }

  const paired = new Set(pairs.values());
  const sourceRoot = pieces.length === 1 && pieces[0].node === source;
  const targetRoot = slots.length === 1 && roots.length === 1 && slots[0].node === roots[0];
  /*
   * A generic box whose only place is itself — `<div>Empty div</div>` — is a container, not a
   * sentence. Several pieces of content go inside it as they are, instead of being run together.
   */
  const box = targetRoot && pieces.length > 1 && BOXES.has(roots[0].tagName.toLowerCase());
  return {
    values,
    fills: box ? [] : fills,
    leftovers: box ? [] : pieces.filter((_, index) => !paired.has(index)),
    container: slots.length === 0 || box,
    retag: sourceRoot && targetRoot,
    source,
  };
}

/**
 * Carry the content into the built block. Returns how many pieces could not be placed anywhere.
 */
export function applyTurnInto(plan: TurnPlan, nodes: readonly HTMLElement[]): number {
  const roots = [...nodes];
  const root = roots[0];
  if (!root) return plan.leftovers.length + plan.fills.length;

  if (plan.container) {
    // Nothing can go inside a lone `<hr>` or `<img>`: the content is dropped, and the user is told.
    if (VOID.has(root.tagName.toLowerCase())) return Math.max(1, plan.leftovers.length);
    // No places for content: what the element held goes inside the block whole, replacing
    // whatever placeholder the box came with.
    const content = isTextBlock(plan.source) || !plan.source.children.length
      ? [clean(plan.source)]
      : Array.from(plan.source.childNodes).map((child) => clean(child));
    root.replaceChildren(...content);
    return 0;
  }

  const filled: Array<{ node: Element | Text; piece: Piece }> = [];
  for (const fill of plan.fills) {
    const slot = resolve(fill.slot, roots);
    if (!slot) continue;
    if (!fill.viaProp) fillSlot(slot, fill.piece);
    filled.push({ node: slot, piece: fill.piece });
  }

  if (plan.retag) {
    for (const name of ['id', 'class', 'style']) {
      const value = plan.source.getAttribute(name);
      if (value !== null && !root.hasAttribute(name)) root.setAttribute(name, value);
    }
  }

  let dropped = 0;
  for (const piece of plan.leftovers) {
    if (!placeLeftover(piece, filled, roots)) dropped += 1;
  }
  return dropped;
}

/** Add a piece nothing was paired with, beside the last slot of the same kind. */
function placeLeftover(
  piece: Piece,
  filled: Array<{ node: Element | Text; piece: Piece }>,
  roots: readonly Element[],
): boolean {
  const inside = (node: Element | Text): boolean => node instanceof Element && !roots.includes(node);
  const like = [...filled].reverse().find(
    (entry) => inside(entry.node) && entry.piece.media === piece.media && entry.piece.family === piece.family,
  ) ?? [...filled].reverse().find(
    (entry) => inside(entry.node) && entry.piece.media === piece.media && entry.piece.family !== 'heading',
  );
  if (like && like.node instanceof Element) {
    const shell = like.node.cloneNode(false) as Element;
    shell.removeAttribute('id');
    fillSlot(shell, piece);
    // After the run of siblings already added beside it, so leftovers keep their order.
    let anchor: Element = like.node;
    while (anchor.nextElementSibling?.hasAttribute('data-heo-turn-extra')) anchor = anchor.nextElementSibling;
    shell.setAttribute('data-heo-turn-extra', '');
    anchor.after(shell);
    return true;
  }
  // Nowhere of its own kind: the words join the last place that took text.
  const last = [...filled].reverse().find((entry) => !entry.piece.media && entry.node instanceof Element);
  if (last && last.node instanceof Element && !piece.media) {
    last.node.append(' ', ...Array.from(contentOf(piece.node, last.node).childNodes));
    return true;
  }
  return false;
}

/** Put a piece's content into a slot, keeping its markup and, between links, its address. */
function fillSlot(slot: Element | Text, piece: Piece): void {
  if (slot instanceof Text) {
    slot.data = plainText(piece.node);
    return;
  }
  if (piece.media) {
    const from = piece.node as Element;
    if (slot.tagName === from.tagName && slot.tagName === 'IMG') {
      for (const name of ['src', 'srcset', 'sizes', 'alt', 'width', 'height']) {
        const value = from.getAttribute(name);
        if (value === null) slot.removeAttribute(name);
        else slot.setAttribute(name, value);
      }
    } else {
      slot.replaceWith(clean(from));
    }
    return;
  }
  slot.replaceChildren(...Array.from(contentOf(piece.node, slot).childNodes));
  const link = linkOf(piece.node);
  if (slot.tagName === 'A' && link) {
    for (const name of ['href', 'target', 'rel']) {
      const value = link.getAttribute(name);
      if (value !== null) slot.setAttribute(name, value);
    }
  }
}

/**
 * What a piece puts inside a slot.
 *
 * A link brings itself, so its address survives in a slot that is not a link — unless the slot is
 * already inside one, where a second `<a>` would be nested, which HTML does not allow.
 */
function contentOf(node: Element | Text, slot: Element): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (node instanceof Text) {
    fragment.append(node.data.trim());
    return fragment;
  }
  const inLink = Boolean(slot.closest('a, button'));
  if (node.tagName === 'A' && !inLink) {
    fragment.append(clean(node));
    return fragment;
  }
  if (inLink && node.querySelector('a, button')) {
    fragment.append(plainText(node));
    return fragment;
  }
  for (const child of Array.from(node.childNodes)) fragment.append(clean(child));
  return fragment;
}

/** A copy of a node without the editor's bookkeeping on it or under it. */
function clean<T extends Node>(node: T): T {
  const copy = node.cloneNode(true) as T;
  if (copy instanceof Element) {
    for (const el of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
      for (const name of [SOURCE_ATTR, INSERTED_ATTR, EDITING_ATTR, 'contenteditable', 'spellcheck']) {
        el.removeAttribute(name);
      }
    }
  }
  return copy;
}

function linkOf(node: Element | Text): Element | null {
  if (!(node instanceof Element)) return null;
  if (node.tagName === 'A') return node;
  const links = node.querySelectorAll('a[href]');
  return links.length === 1 && plainText(links[0]) === plainText(node) ? links[0] : null;
}

function hasMarkup(node: Element | Text): boolean {
  return node instanceof Element && node.children.length > 0;
}

function plainText(node: Node): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Drop the transfer's own bookkeeping once the block is built. */
export function finishTurnInto(nodes: readonly HTMLElement[]): void {
  for (const node of nodes) {
    for (const el of [node, ...Array.from(node.querySelectorAll('[data-heo-turn-extra]'))]) {
      el.removeAttribute('data-heo-turn-extra');
    }
  }
}
