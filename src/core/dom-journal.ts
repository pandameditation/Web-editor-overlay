import {
  BLOCK_ATTR,
  HOST_TAG,
  IGNORE_ATTR,
  INJECTED_ATTR,
  MIRROR_ATTR,
} from './constants.js';

/**
 * The page's DOM, as a journal of exact operations.
 *
 * Commands used to undo themselves from closures that held the nodes they once touched. That only
 * works while nothing else replaces those nodes, and a lot does: typing merges and splits text
 * nodes, a markup reconcile reuses some nodes and recreates others, a later structural edit
 * re-parents everything it moves. The closure then puts a stale node back next to its
 * replacement, and the page silently stops being the page the user made.
 *
 * A `MutationRecord` names the actual nodes and the actual neighbours at the moment of the
 * change. Replaying a command's records backwards in reverse order restores the previous state
 * exactly, node identity included, as long as undo runs in stack order — which it does. The same
 * records are what the save reads: they say precisely which attributes, which text nodes and
 * which child lists the user changed, so the file is patched there and nowhere else.
 */

export type DomOp =
  | {
    type: 'attr';
    target: Element;
    name: string;
    namespace: string | null;
    before: string | null;
    after: string | null;
  }
  | { type: 'text'; target: CharacterData; before: string; after: string }
  | {
    type: 'children';
    target: Node;
    removed: Node[];
    added: Node[];
    previous: Node | null;
    next: Node | null;
  };

const OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  attributeOldValue: true,
  characterData: true,
  characterDataOldValue: true,
};

/** Every shadow root `node` sits inside, innermost first. */
export function shadowRootsOf(node: Node | null | undefined): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  for (let root = node?.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) {
    out.push(root);
  }
  return out;
}

/** The editor's own nodes, which no file declares and no undo should touch. */
export function isEditorOwned(node: Node): boolean {
  for (let at: Node | null = node; at; at = at.parentNode ?? (at instanceof ShadowRoot ? at.host : null)) {
    if (!(at instanceof Element)) continue;
    if (at.localName === HOST_TAG) return true;
    if (
      at.hasAttribute(IGNORE_ATTR) ||
      at.hasAttribute(INJECTED_ATTR) ||
      at.hasAttribute(MIRROR_ATTR) ||
      at.hasAttribute('data-heo-generated') ||
      at.hasAttribute('data-heo-internal')
    ) {
      return true;
    }
  }
  return false;
}

/** Attributes the editor writes for itself. Their history is not the page's history. */
export function isBookkeepingAttribute(name: string): boolean {
  return name.startsWith('data-heo-') && name !== BLOCK_ATTR;
}

/** Which records belong to an operation running across several tasks. */
export type SessionFilter = (record: MutationRecord) => boolean;

/**
 * Records inside `root`, for a gesture confined to one element such as typing into it.
 *
 * Nodes that leave the element while the gesture runs are still followed, because what happens
 * to them afterwards is part of the same edit. `ignored` names attributes the gesture sets on
 * `root` for its own purposes, like `contenteditable`.
 */
export function within(root: Node, ignored: readonly string[] = []): SessionFilter {
  /*
   * Records are filtered when they are delivered, which is after the fact: a text node the user
   * typed over has usually left the element by then. So everything inside it at the start is
   * remembered up front, and everything that arrives during the gesture as it arrives.
   */
  const seen = new WeakSet<Node>();
  const remember = (node: Node): void => {
    seen.add(node);
    for (let child = node.firstChild; child; child = child.nextSibling) remember(child);
  };
  remember(root);
  return (record) => {
    let inside = false;
    for (let at: Node | null = record.target; at; at = at.parentNode) {
      if (at === root || seen.has(at)) {
        inside = true;
        break;
      }
    }
    if (!inside) return false;
    if (
      record.type === 'attributes' &&
      record.target === root &&
      ignored.includes(record.attributeName ?? '')
    ) {
      return false;
    }
    if (record.type === 'childList') {
      for (const node of Array.from(record.addedNodes)) remember(node);
      for (const node of Array.from(record.removedNodes)) remember(node);
    }
    return true;
  };
}

/** Records that move `node` from one place to another, and nothing else. */
export function movesOf(node: Node): SessionFilter {
  return (record) =>
    record.type === 'childList' &&
    (Array.from(record.addedNodes).includes(node as ChildNode) ||
      Array.from(record.removedNodes).includes(node as ChildNode));
}

interface Session {
  filter: SessionFilter;
  records: MutationRecord[];
}

class DomRecorder {
  #observer: MutationObserver | null = null;
  #observing = false;
  /** Open shadow roots already being observed alongside the document. */
  #roots = new WeakSet<ShadowRoot>();
  #sessions = new Set<Session>();
  #frames: MutationRecord[][] = [];

  #ensure(roots: readonly Node[] = []): MutationObserver | null {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return null;
    this.#observer ??= new MutationObserver((records) => this.#route(records));
    if (!this.#observing) {
      this.#observer.observe(document, OPTIONS);
      this.#roots = new WeakSet();
      this.#observing = true;
    }
    /*
     * The shadow roots the operation is about, as well as the document.
     *
     * An observer on the document does not see inside shadow trees, and the editor does edit
     * elements in them. Only the roots the caller names are added: a component re-rendering its
     * own shadow tree because the editor changed its host is the component's business, and
     * recording it would make redo put the old rendering back beside the new one.
     */
    for (const root of roots) {
      if (!(root instanceof ShadowRoot) || this.#roots.has(root) || isEditorOwned(root.host)) continue;
      this.#observer.observe(root, OPTIONS);
      this.#roots.add(root);
    }
    return this.#observer;
  }

  #flush(): void {
    if (!this.#observer || !this.#observing) return;
    this.#route(this.#observer.takeRecords());
  }

  #route(records: MutationRecord[]): void {
    if (!records.length) return;
    const frame = this.#frames.at(-1);
    if (frame) {
      frame.push(...records);
      return;
    }
    for (const session of this.#sessions) {
      for (const record of records) if (session.filter(record)) session.records.push(record);
    }
  }

  #release(): void {
    if (this.#frames.length || this.#sessions.size || !this.#observer || !this.#observing) return;
    this.#route(this.#observer.takeRecords());
    this.#observer.disconnect();
    this.#observing = false;
  }

  /**
   * Run `fn` and return every page-DOM operation it performed, in order.
   *
   * `roots` names shadow roots to watch as well, for an operation on something inside one.
   */
  capture(fn: () => void, roots: readonly Node[] = []): DomOp[] {
    const observer = this.#ensure(roots);
    if (!observer) {
      fn();
      return [];
    }
    this.#flush();
    const frame: MutationRecord[] = [];
    this.#frames.push(frame);
    try {
      fn();
    } finally {
      frame.push(...observer.takeRecords());
      this.#frames.pop();
      const outer = this.#frames.at(-1);
      if (outer) outer.push(...frame);
      this.#release();
    }
    return toOps(frame);
  }

  /** Run `fn` without letting its mutations reach any capture or session. */
  ignore(fn: () => void): void {
    const observer = this.#ensure();
    if (!observer) {
      fn();
      return;
    }
    this.#flush();
    const frame: MutationRecord[] = [];
    this.#frames.push(frame);
    try {
      fn();
    } finally {
      observer.takeRecords();
      this.#frames.pop();
      this.#release();
    }
  }

  /**
   * Collect the mutations a gesture makes across several tasks, typing being the main one.
   *
   * The filter keeps the page's concurrent work out of the user's command.
   */
  begin(filter: SessionFilter, roots: readonly Node[] = []): { end(): DomOp[]; cancel(): void } {
    const observer = this.#ensure(roots);
    this.#flush();
    const session: Session = { filter, records: [] };
    if (observer) this.#sessions.add(session);
    let open = Boolean(observer);
    const close = (): void => {
      if (!open) return;
      open = false;
      this.#flush();
      this.#sessions.delete(session);
      this.#release();
    };
    return {
      end: () => {
        close();
        return toOps(session.records);
      },
      cancel: close,
    };
  }
}

export const domRecorder = new DomRecorder();

/**
 * Turn records into self-contained operations.
 *
 * A record carries only the old value of an attribute or text node. The new one is the old value
 * of the next record for the same thing, or whatever it holds now, so this has to run before
 * anything else touches the page.
 */
function toOps(records: readonly MutationRecord[]): DomOp[] {
  const ops: DomOp[] = [];
  const attrAt = new Map<Element, Map<string, Extract<DomOp, { type: 'attr' }>>>();
  const textAt = new Map<CharacterData, Extract<DomOp, { type: 'text' }>>();

  for (const record of records) {
    if (record.type === 'attributes') {
      const target = record.target as Element;
      const name = record.attributeName ?? '';
      if (!name || isBookkeepingAttribute(name) || isEditorOwned(target)) continue;
      const ns = record.attributeNamespace;
      const key = `${ns ?? ''}|${name}`;
      let latest = attrAt.get(target);
      if (!latest) {
        latest = new Map();
        attrAt.set(target, latest);
      }
      const previous = latest.get(key);
      if (previous) previous.after = record.oldValue;
      const op: Extract<DomOp, { type: 'attr' }> = {
        type: 'attr',
        target,
        name,
        namespace: ns,
        before: record.oldValue,
        after: null,
      };
      latest.set(key, op);
      ops.push(op);
      continue;
    }
    if (record.type === 'characterData') {
      const target = record.target as CharacterData;
      if (isEditorOwned(target)) continue;
      const previous = textAt.get(target);
      if (previous) previous.after = record.oldValue ?? '';
      const op: Extract<DomOp, { type: 'text' }> = {
        type: 'text',
        target,
        before: record.oldValue ?? '',
        after: '',
      };
      textAt.set(target, op);
      ops.push(op);
      continue;
    }
    if (isEditorOwned(record.target)) continue;
    const removed = Array.from(record.removedNodes).filter((node) => !isEditorOwned(node));
    const added = Array.from(record.addedNodes).filter((node) => !isEditorOwned(node));
    if (!removed.length && !added.length) continue;
    ops.push({
      type: 'children',
      target: record.target,
      removed,
      added,
      previous: record.previousSibling,
      next: record.nextSibling,
    });
  }

  for (const latest of attrAt.values()) {
    for (const op of latest.values()) {
      op.after = op.namespace
        ? op.target.getAttributeNS(op.namespace, localNameOf(op.name))
        : op.target.getAttribute(op.name);
    }
  }
  for (const [node, op] of textAt) op.after = node.data;

  return withHiddenMoves(ops).filter(
    (op) => op.type === 'children' || op.before !== op.after,
  );
}

/**
 * Put back the moves an observer of the document cannot see.
 *
 * Building a container off the page and moving existing nodes into it before inserting it is
 * ordinary DOM code — retagging an element does exactly that. The observer sees the nodes leave
 * and sees the container arrive, but not the nodes entering the container, because that happened
 * outside the document. Replayed as recorded, the container arrives empty. So for every node that
 * left and is back in the page by the end without a recorded arrival, the arrival is written in,
 * just before the container that carried it was inserted.
 */
function withHiddenMoves(ops: DomOp[]): DomOp[] {
  const last = new Map<Node, 'removed' | 'added'>();
  for (const op of ops) {
    if (op.type !== 'children') continue;
    for (const node of op.removed) last.set(node, 'removed');
    for (const node of op.added) last.set(node, 'added');
  }
  const hidden: Node[] = [];
  for (const [node, state] of last) {
    if (state === 'removed' && node.isConnected && node.parentNode && !isEditorOwned(node)) hidden.push(node);
  }
  if (!hidden.length) return ops;
  // Last first, so that splicing each in front of its container leaves them in document order.
  hidden.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1));

  const out = [...ops];
  for (const node of hidden) {
    let at = -1;
    for (let k = 0; k < out.length; k += 1) {
      const op = out[k];
      if (op.type !== 'children') continue;
      if (op.added.some((added) => added !== node && added.contains(node))) {
        at = k;
        break;
      }
    }
    if (at === -1) continue;
    const parent = node.parentNode!;
    out.splice(at, 0, {
      type: 'children',
      target: parent,
      removed: [],
      added: [node],
      previous: node.previousSibling,
      next: node.nextSibling,
    });
  }
  return out;
}

function localNameOf(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/* -------------------------------------------------------------------------- */
/* Applying operations to the live page                                        */
/* -------------------------------------------------------------------------- */

function place(target: Node, nodes: readonly Node[], previous: Node | null, next: Node | null): void {
  let before: Node | null;
  if (next && next.parentNode === target) before = next;
  else if (previous && previous.parentNode === target) before = previous.nextSibling;
  else before = previous ? null : target.firstChild;
  for (const node of nodes) target.insertBefore(node, before);
}

function setAttribute(op: Extract<DomOp, { type: 'attr' }>, value: string | null): void {
  if (value === null) {
    if (op.namespace) op.target.removeAttributeNS(op.namespace, localNameOf(op.name));
    else op.target.removeAttribute(op.name);
  } else if (op.namespace) {
    op.target.setAttributeNS(op.namespace, op.name, value);
  } else {
    op.target.setAttribute(op.name, value);
  }
}

/**
 * Whether a child-list operation still describes the page.
 *
 * Replayed in stack order it always does. When it does not, something outside the journal has
 * already redone the work — a component re-rendering itself when an attribute came back — and
 * replaying it as well would put a second copy beside the first, so it is skipped.
 */
function stale(op: Extract<DomOp, { type: 'children' }>, leaving: readonly Node[]): boolean {
  return leaving.length > 0 && leaving.every((node) => node.parentNode !== op.target);
}

/** Put the page back to how it was before `ops` ran. */
export function revertOps(ops: readonly DomOp[]): void {
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    if (op.type === 'attr') setAttribute(op, op.before);
    else if (op.type === 'text') op.target.data = op.before;
    else {
      if (stale(op, op.added)) continue;
      for (const node of op.added) if (node.parentNode === op.target) op.target.removeChild(node);
      place(op.target, op.removed, op.previous, op.next);
    }
  }
}

/** Run `ops` again, after `revertOps` took them back. */
export function replayOps(ops: readonly DomOp[]): void {
  for (const op of ops) {
    if (op.type === 'attr') setAttribute(op, op.after);
    else if (op.type === 'text') op.target.data = op.after;
    else {
      if (stale(op, op.removed)) continue;
      for (const node of op.removed) if (node.parentNode === op.target) op.target.removeChild(node);
      place(op.target, op.added, op.previous, op.next);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The page as it would be with a different set of operations                  */
/* -------------------------------------------------------------------------- */

/**
 * The live page with some operations taken back or added, without touching the page.
 *
 * The save needs three versions of one document: as the file has it, as the user wants it, and
 * the one on screen. Only the third exists. The other two differ from it by a list of journal
 * operations, so they are the live tree read through an overlay that holds those differences.
 */
export class TreeView {
  #children = new Map<Node, Node[]>();
  #parents = new Map<Node, Node | null>();
  #attrs = new Map<Element, Map<string, string | null>>();
  #data = new Map<CharacterData, string>();
  /** Operations that could not be placed, for the caller to report. */
  readonly conflicts: DomOp[] = [];

  children(node: Node): readonly Node[] {
    return this.#children.get(node) ?? Array.from(node.childNodes);
  }

  parent(node: Node): Node | null {
    return this.#parents.has(node) ? this.#parents.get(node)! : node.parentNode;
  }

  attribute(el: Element, name: string): string | null {
    const values = this.#attrs.get(el);
    if (values?.has(name)) return values.get(name)!;
    return el.getAttribute(name);
  }

  attributeNames(el: Element): string[] {
    const names = new Set(el.getAttributeNames());
    for (const [name, value] of this.#attrs.get(el) ?? []) {
      if (value === null) names.delete(name);
      else names.add(name);
    }
    return [...names];
  }

  data(node: CharacterData): string {
    return this.#data.get(node) ?? node.data;
  }

  /** True when `node` is attached to the document in this view. */
  connected(node: Node): boolean {
    for (let at: Node | null = node; at; at = this.parent(at)) {
      if (at.nodeType === Node.DOCUMENT_NODE) return true;
    }
    return false;
  }

  #mutable(node: Node): Node[] {
    let list = this.#children.get(node);
    if (!list) {
      list = Array.from(node.childNodes);
      this.#children.set(node, list);
    }
    return list;
  }

  #remove(target: Node, nodes: readonly Node[]): boolean {
    const list = this.#mutable(target);
    let ok = true;
    for (const node of nodes) {
      const index = list.indexOf(node);
      if (index === -1) {
        ok = false;
        continue;
      }
      list.splice(index, 1);
      this.#parents.set(node, null);
    }
    return ok;
  }

  #insert(target: Node, nodes: readonly Node[], previous: Node | null, next: Node | null): boolean {
    const list = this.#mutable(target);
    let at: number;
    let ok = true;
    const nextAt = next ? list.indexOf(next) : -1;
    const previousAt = previous ? list.indexOf(previous) : -1;
    if (nextAt !== -1) at = nextAt;
    else if (previous === null) at = 0;
    else if (previousAt !== -1) at = previousAt + 1;
    else {
      at = list.length;
      ok = next === null;
    }
    for (const node of nodes) {
      const old = this.parent(node);
      if (old && old !== target) {
        const from = this.#mutable(old);
        const index = from.indexOf(node);
        if (index !== -1) from.splice(index, 1);
      } else if (old === target) {
        const index = list.indexOf(node);
        if (index !== -1) {
          list.splice(index, 1);
          if (index < at) at -= 1;
        }
      }
    }
    list.splice(at, 0, ...nodes);
    for (const node of nodes) this.#parents.set(node, target);
    return ok;
  }

  #setAttribute(el: Element, name: string, value: string | null): void {
    let values = this.#attrs.get(el);
    if (!values) {
      values = new Map();
      this.#attrs.set(el, values);
    }
    values.set(name, value);
  }

  /** Take one operation back. False when the tree no longer has the shape it expects. */
  revert(op: DomOp): boolean {
    if (op.type === 'attr') {
      this.#setAttribute(op.target, op.name, op.before);
      return true;
    }
    if (op.type === 'text') {
      this.#data.set(op.target, op.before);
      return true;
    }
    const removed = this.#remove(op.target, op.added);
    const inserted = this.#insert(op.target, op.removed, op.previous, op.next);
    if (!removed || !inserted) this.conflicts.push(op);
    return removed && inserted;
  }

  /** Run one operation again. False when the tree no longer has the shape it expects. */
  replay(op: DomOp): boolean {
    if (op.type === 'attr') {
      this.#setAttribute(op.target, op.name, op.after);
      return true;
    }
    if (op.type === 'text') {
      this.#data.set(op.target, op.after);
      return true;
    }
    const removed = this.#remove(op.target, op.removed);
    const inserted = this.#insert(op.target, op.added, op.previous, op.next);
    if (!removed || !inserted) this.conflicts.push(op);
    return removed && inserted;
  }

  /** A copy that can diverge from this one. */
  fork(): TreeView {
    const copy = new TreeView();
    for (const [node, list] of this.#children) copy.#children.set(node, [...list]);
    for (const [node, parent] of this.#parents) copy.#parents.set(node, parent);
    for (const [el, values] of this.#attrs) copy.#attrs.set(el, new Map(values));
    for (const [node, value] of this.#data) copy.#data.set(node, value);
    return copy;
  }
}
