/**
 * Reconcile a live subtree toward some target markup, keeping the nodes that still fit.
 *
 * The alternative is `innerHTML =`, and the reason that is not good enough has nothing to do
 * with performance. A page's behaviour lives on its *nodes*: every listener the page's own
 * scripts attached, every bit of state the browser keeps per element — an open `<details>`, a
 * scroll position, what is typed in an input, where a video is up to. Replacing the markup
 * throws all of it away, and the scripts do not put it back, because a script that has already
 * run does not run again. So editing one heading in the HTML buffer and pressing Apply left a
 * page that looked right and did nothing: the menu button was still there and no longer opened
 * the menu, through undo and redo alike, until the page was reloaded.
 *
 * Reusing a node is therefore the whole point, and the rule for when a node may be reused is
 * deliberately strict: same kind of node, same tag, same id. Anything else is replaced. A
 * conservative rule loses listeners on elements that really did change, which is correct — they
 * are different elements now — while keeping them everywhere the edit did not reach.
 *
 * What it is not: a keyed diff. Reordering siblings is matched positionally, so a move is seen
 * as "these two elements both changed" and both are rebuilt. That is the honest outcome for an
 * operation expressed as a wholesale markup replacement, and it costs listeners only on the
 * elements actually reordered rather than on the entire page.
 */

/** Nodes the target markup does not describe, which stay exactly where they are. */
export interface MorphOptions {
  /**
   * Elements to leave alone, wherever they sit.
   *
   * The whole-document apply needs this: the buffer it writes leaves out the overlay host, the
   * editor's generated stylesheets and every `<script>`, so those must neither be matched
   * against the target nor removed for being absent from it.
   */
  preserve?: (el: Element) => boolean;
}

/**
 * Make `parent`'s children match `markup`, reusing what fits.
 *
 * The postcondition is the same one `innerHTML =` gives: afterwards the parent's contents
 * serialize to `markup`, give or take the browser's own normalisation of it. Anything less
 * would be a silent corruption, which is why the fixtures assert the serialization rather than
 * trusting the walk.
 */
export function morphChildren(parent: HTMLElement, markup: string, options: MorphOptions = {}): void {
  const template = parent.ownerDocument.createElement('template');
  template.innerHTML = markup;
  morphNodeList(parent, Array.from(template.content.childNodes), options);
}

/** The same, for a target that is already parsed. */
function morphNodeList(parent: Node, wanted: readonly Node[], options: MorphOptions): void {
  const preserve = options.preserve;
  /*
   * The cursor walks the live children, stepping over preserved nodes rather than matching
   * them. They occupy no slot in the target, so the two lists stay aligned around them.
   */
  let cursor: ChildNode | null = parent.firstChild;
  const step = (node: ChildNode | null): ChildNode | null => {
    let at = node;
    while (at && at instanceof Element && preserve?.(at)) at = at.nextSibling;
    return at;
  };

  for (const target of wanted) {
    cursor = step(cursor);
    if (cursor && canReuse(cursor, target)) {
      morphNode(cursor, target, options);
      cursor = cursor.nextSibling;
      continue;
    }
    /*
     * Nothing here to reuse, so the target's node is adopted rather than the live one edited.
     * Imported rather than moved, because the caller's parsed tree may be walked again — a
     * revert and a redo trade the same two markup strings back and forth indefinitely.
     */
    const fresh = parent.ownerDocument!.importNode(target, true);
    parent.insertBefore(fresh, cursor);
  }

  // Whatever is left over is not in the target. Preserved nodes are not "left over".
  let extra = step(cursor);
  while (extra) {
    const next = step(extra.nextSibling);
    extra.parentNode?.removeChild(extra);
    extra = next;
  }
}

/**
 * Whether the live node can become the target one without being replaced.
 *
 * Tag and id both, and the id is what stops two same-tag siblings being confused for each
 * other when one of them is the element the page's scripts hold by id.
 */
function canReuse(live: Node, target: Node): boolean {
  if (live.nodeType !== target.nodeType) return false;
  if (live instanceof Element && target instanceof Element) {
    return live.tagName === target.tagName && live.id === target.id;
  }
  // Text, comment, CDATA: interchangeable, and their value is synced below.
  return true;
}

function morphNode(live: Node, target: Node, options: MorphOptions): void {
  if (live instanceof Element && target instanceof Element) {
    syncAttributes(live, target);
    /*
     * A raw-text element's content is text, not a tree, and its text node is not addressable
     * the way markup is — so it is written wholesale. This is the one place a reparse is right:
     * there is nothing inside a `<style>` or a `<textarea>` that could be carrying a listener.
     */
    if (live.tagName === 'STYLE' || live.tagName === 'SCRIPT' || live.tagName === 'TEXTAREA') {
      if (live.textContent !== target.textContent) live.textContent = target.textContent;
      return;
    }
    morphNodeList(live, Array.from(target.childNodes), options);
    return;
  }
  if (live.nodeValue !== target.nodeValue) live.nodeValue = target.nodeValue;
}

/**
 * Make the live element's attributes match the target's exactly.
 *
 * Compared before writing, so an attribute that has not changed is not touched. That matters
 * beyond tidiness: setting `value` or `checked` on a live form control resets it, and setting
 * `src` on an `<img>` or an `<iframe>` starts a fresh load, even when the value is identical.
 */
function syncAttributes(live: Element, target: Element): void {
  for (const attribute of Array.from(target.attributes)) {
    if (live.getAttribute(attribute.name) !== attribute.value) {
      live.setAttribute(attribute.name, attribute.value);
    }
  }
  for (const attribute of Array.from(live.attributes)) {
    if (target.hasAttribute(attribute.name)) continue;
    /*
     * The editor's own bookkeeping is not the page's to drop.
     *
     * Every buffer the code panel shows has `data-heo-*` stripped out of it, so their absence
     * from the target says nothing about them — and `data-heo-src` in particular is the build
     * marker the save uses to find an element in the file. Removing it would turn a one-line
     * patch back into a whole-file rewrite.
     */
    if (attribute.name.startsWith('data-heo-')) continue;
    live.removeAttribute(attribute.name);
  }
}
