import { isEditorOwned } from './dom-journal.js';

/**
 * Whether a piece of the page can be written as HTML and read back the same.
 *
 * The DOM accepts trees the HTML parser never builds: a `<div>` inside a `<p>`, a link inside a
 * link, text directly inside a `<table>`. Scripts and editing tools produce them freely, and they
 * look fine on screen — but written into a file, the browser restructures them on the next load:
 * the paragraph closes before the `<div>`, the inner link ends the outer one, the text is moved out
 * of the table. A file cannot hold such a page, whoever writes it.
 *
 * The test asks the parser itself. A skeleton of the element's open ancestors and of the node
 * being placed — tags and the presence of text, nothing else — is parsed, and the result has to
 * have the same shape. Only the ancestor stack decides how a node parses, so that is all the
 * context needed.
 */

export interface Offender {
  parent: Element;
  child: Node;
  message: string;
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr', 'basefont', 'bgsound', 'frame', 'keygen',
]);
const OPAQUE = new Set([
  'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template',
]);
const LIMIT = 3000;

function kids(node: Node): Node[] {
  return Array.from(node.childNodes).filter(
    (child) =>
      (child.nodeType === Node.ELEMENT_NODE && !isEditorOwned(child)) ||
      (child.nodeType === Node.TEXT_NODE && (child as Text).data.trim() !== ''),
  );
}

/** Tags and text presence, as markup the parser can be asked about. */
function skeleton(node: Node, budget: { left: number }): string | null {
  if (--budget.left < 0) return null;
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.trim() ? 'x' : '';
  if (!(node instanceof Element)) return '';
  const name = node.localName;
  if (VOID.has(name)) return `<${name}>`;
  if (OPAQUE.has(name)) return `<${name}></${name}>`;
  let inner = '';
  for (const kid of kids(node)) {
    const part = skeleton(kid, budget);
    if (part === null) return null;
    inner += part;
  }
  return `<${name}>${inner}</${name}>`;
}

/** The comparable shape of a tree: element names and where text is. */
function shape(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return 't';
  const el = node as Element;
  if (OPAQUE.has(el.localName) || VOID.has(el.localName)) return el.localName;
  return `${el.localName}(${kids(el).map(shape).join(',')})`;
}

/** Where two trees of the same intent first part ways: the parent and the child it lost. */
function firstDivergence(live: Element, parsed: Element): { parent: Element; child: Node } | null {
  const a = kids(live);
  const b = kids(parsed);
  for (let i = 0; i < a.length; i += 1) {
    const mine = a[i];
    const theirs = b[i];
    if (!theirs || shape(mine) !== shape(theirs)) {
      if (
        theirs &&
        mine instanceof Element &&
        theirs instanceof Element &&
        mine.localName === theirs.localName
      ) {
        return firstDivergence(mine, theirs) ?? { parent: live, child: mine };
      }
      return { parent: live, child: mine };
    }
  }
  return null;
}

function describe(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return 'text';
  const el = node as Element;
  return `a <${el.localName}>`;
}

function explain(parent: Element, child: Node): string {
  return (
    `${describe(child)} cannot go inside <${parent.localName}> in HTML — a browser reading the file ` +
    `would move it out, so the page would not reopen the way it looks. Put it beside the ` +
    `<${parent.localName}> instead, or change one of the two tags`
  );
}

let probe: DOMParser | null = null;

/**
 * Why `node`, placed as a child of `parent`, could not be written as HTML — or null when it can.
 *
 * `node` does not have to be inside `parent` yet, which is what lets a drag ask before it drops.
 * Null as well when the question cannot be answered: a tree too large to test, or ancestors that
 * are themselves already something HTML cannot express — that is not this placement's doing.
 */
export function inexpressibleAt(parent: Element, node: Node): Offender | null {
  // Only elements and words have a place in the content model; comments go anywhere.
  if (node.nodeType === Node.TEXT_NODE ? !(node as Text).data.trim() : node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  if (isEditorOwned(parent) || isEditorOwned(node)) return null;
  if (VOID.has(parent.localName)) {
    return {
      parent,
      child: node,
      message: `a <${parent.localName}> cannot contain anything in HTML, so ${describe(node)} put inside it would be lost when the file is read`,
    };
  }
  const chain: Element[] = [];
  for (let at: Element | null = parent; at; at = at.parentElement) {
    if (at.localName === 'body' || at.localName === 'head' || at.localName === 'html') break;
    chain.unshift(at);
  }
  const inHead = Boolean(parent.closest('head'));
  if (chain.some((el) => OPAQUE.has(el.localName) || VOID.has(el.localName))) return null;

  const budget = { left: LIMIT };
  const subject = skeleton(node, budget);
  if (subject === null) return null;
  const open = chain.map((el) => `<${el.localName}>`).join('');
  const close = chain.map((el) => `</${el.localName}>`).reverse().join('');
  const section = inHead ? 'head' : 'body';
  probe ??= new DOMParser();
  const parse = (inner: string): Element =>
    probe!.parseFromString(`<!doctype html><${section}>${open}${inner}${close}</${section}>`, 'text/html')[
      inHead ? 'head' : 'body'
    ];

  // The ancestors on their own must survive, or what is wrong is not this placement.
  const descend = (root: Element): Element | null => {
    let at: Element | null = root;
    for (const el of chain) {
      const next: Element | undefined = kids(at!).find(
        (kid): kid is Element => kid instanceof Element,
      );
      if (!next || next.localName !== el.localName) return null;
      at = next;
    }
    return at;
  };
  if (!descend(parse(''))) return null;

  const host = descend(parse(subject));
  const where = host ?? null;
  if (!where) return { parent, child: node, message: explain(parent, node) };
  const placed = kids(where);
  if (placed.length !== 1 || shape(placed[0]) !== shape(node)) {
    const first = placed[0];
    // The node itself parsed where it belongs, and something inside it did not.
    if (node instanceof Element && first instanceof Element && first.localName === node.localName) {
      const inner = firstDivergence(node, first);
      if (inner) return { ...inner, message: explain(inner.parent, inner.child) };
    }
    return { parent, child: node, message: explain(parent, node) };
  }
  return null;
}

/**
 * The first placement in a change that HTML could not express, as a sentence, or null.
 *
 * Only what the change itself put somewhere is asked about. A shape the page's own code built
 * before the edit is not this change's doing, and refusing an unrelated edit over it would leave
 * the user unable to touch that part of the page at all.
 */
export function refusalFor(ops: readonly { type: string; target: Node; added?: readonly Node[] }[]): string | null {
  for (const op of ops) {
    if (op.type !== 'children' || !(op.target instanceof Element) || !op.target.isConnected) continue;
    for (const node of op.added ?? []) {
      if (node.parentNode !== op.target) continue;
      if (node.nodeType === Node.TEXT_NODE && !(node as Text).data.trim()) continue;
      const offender = inexpressibleAt(op.target, node);
      if (offender) return offender.message;
    }
  }
  return null;
}
