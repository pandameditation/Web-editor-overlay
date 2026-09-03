import { INSERTED_ATTR, SOURCE_ATTR } from './constants.js';
import { directText, labelFor, nearestSourceRef, selectorFor } from './dom.js';
import type { ElementAnchor } from './html-patch.js';
import { nextChangeId, type Command } from './history.js';
import { sanitizeFragment } from './sanitize.js';
import type { ChangeRecord } from './types.js';

/**
 * Reversible DOM edits.
 *
 * Every editor action is expressed as a `Command` built here, so undo/redo and
 * the save prompt come for free: the command carries both the inverse operation
 * and the semantic description of what changed.
 */
/**
 * The element each change was made to, if it is still in the page.
 *
 * A record's anchor describes where the element sits in the *file*, frozen at the moment of
 * the edit. Reading a value back out of the page at save time needs the element itself, and
 * re-deriving it from that frozen description goes wrong as soon as a later insert shifts the
 * live tree — a font size on a plain `<div>` was placeable in the file yet unreadable from the
 * page, and the file got rewritten over it.
 *
 * Carried as a string key rather than a node, because records are plain data: they are copied
 * with spreads and passed through `JSON.stringify` for the prompt, either of which would drop
 * a node reference or choke on it.
 */
export function elementOfRecord(record: ChangeRecord): HTMLElement | null {
  return record.elementRef ? elementForKey(record.elementRef) : null;
}

function record(
  el: HTMLElement,
  kind: ChangeRecord['kind'],
  summary: string,
  extra: Partial<ChangeRecord> = {},
): ChangeRecord {
  return {
    id: nextChangeId(),
    kind,
    summary,
    target: selectorFor(el),
    source: nearestSourceRef(el),
    /*
     * How to find this element in the HTML file, captured now.
     *
     * Now rather than at save time, for the same reason `describeRule` captures a CSS
     * rule's position when the edit is made: by the time a plan is built the user has
     * inserted, moved and deleted things, so nothing positional still means what it meant.
     * An id and a build-time marker both survive all of that.
     *
     * `sourceRefOf` rather than `nearestSourceRef` — the nearest marker may belong to an
     * ancestor, and an anchor that resolves to the wrong element is worse than no anchor,
     * which merely falls back to writing the whole file.
     */
    anchor: anchorFor(el),
    // Every change about this element, tied together for the prompt. Overridden by
    // the commands whose subject is a node they create rather than the one they were
    // called on — insert, duplicate and wrap — so the follow-up edits to the new
    // element group with the operation that produced it.
    group: elementKey(el),
    // The element this change was made to. Unlike `group`, never reassigned to a different
    // node by the commands that create one, so it always names the element that was read.
    elementRef: elementKey(el),
    at: Date.now(),
    ...extra,
  };
}

/**
 * How to find this element in the HTML file.
 *
 * The parent chain is followed rather than recorded one level deep, and that is what makes an
 * arbitrary element addressable. A nameless `<div>` is the nth child of a nameless `<div>`
 * which is the nth child of `<body>` — and `<body>` names itself, so the chain always
 * terminates somewhere resolvable. Stopping at the first parent meant a container without an
 * id of its own broke the whole chain, and the file got rewritten because of a font size.
 *
 * It stops as soon as an ancestor names itself outright, so the common case stays short: one
 * link for anything inside an element with an id.
 */
export function anchorFor(el: HTMLElement, depth = 6): ElementAnchor {
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    /*
     * The container, for a change that is about where this element sits rather than what it
     * says. Captured here because `record()` runs while the element is still attached — a
     * delete has not happened yet, and after it there is no parent left to ask.
     */
    parent: parentAnchor(el, depth),
    /*
     * Where it sits among its siblings, and what it looks like.
     *
     * The anchor of last resort, and the one that makes a plain `<div>` addressable at all: an
     * element with no id, no build marker and no distinctive text is still the third child of
     * something findable. Resolution is scoped to that container's own range, so the index is
     * being read against a handful of tags rather than the whole file — and the tag name and
     * classes are checked before it is believed, so a file that has since diverged is refused
     * rather than patched in the wrong place.
     */
    nth: el.parentElement ? nthAmongLike(el, true) : undefined,
    nthTag: el.parentElement ? nthAmongLike(el, false) : undefined,
    classes: classSignature(el),
    // The marker verbatim, which serves twice: it finds the element again in the live DOM,
    // and it names the file and position to patch. Kept raw rather than parsed because the
    // file half decides whether the position means anything — a marker pointing at a `.ts`
    // template says nothing about where the tag is in the HTML.
    src: el.getAttribute(SOURCE_ATTR) ?? undefined,
  };
}

/**
 * The container's anchor, followed up until one of them names itself.
 *
 * `<body>` is the floor: it is unique in any document, so resolution can always land there.
 * `<html>` is not included — nothing is ever a change to it.
 */
function parentAnchor(el: HTMLElement, depth: number): ElementAnchor | undefined {
  const parent = el.parentElement;
  if (depth <= 0 || !parent || parent === document.documentElement) return undefined;
  // An ancestor with an id or a build marker is findable on its own, so the chain ends there.
  const named = Boolean(parent.id) || parent.hasAttribute(SOURCE_ATTR) || parent === document.body;
  return anchorFor(parent, named ? 0 : depth - 1);
}

/**
 * Which one it is among the siblings that look like it, rather than among all of them.
 *
 * Counting every sibling meant that inserting or moving anything ahead of the element shifted
 * it: the file's seventh child was a `<div>` where the page now had a `<p>`, and the save gave
 * up and rewrote the file. Counting only the siblings of the same tag — and, first, the same
 * tag *and* classes — makes the position survive edits to everything unlike it.
 */
function nthAmongLike(el: HTMLElement, withClasses: boolean): number {
  const parent = el.parentElement;
  if (!parent) return 0;
  const classes = classSignature(el) ?? '';
  let seen = 0;
  for (const sibling of Array.from(parent.children)) {
    if (sibling === el) return seen;
    if (!(sibling instanceof HTMLElement)) continue;
    if (sibling.localName !== el.localName) continue;
    if (withClasses && (classSignature(sibling) ?? '') !== classes) continue;
    seen += 1;
  }
  return seen;
}

/** Classes the author wrote, sorted, so the order they appear in cannot matter. */
function classSignature(el: HTMLElement): string | undefined {
  const names = Array.from(el.classList)
    .filter((name) => !name.startsWith('heo-'))
    .sort();
  return names.length ? names.join(' ') : undefined;
}

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Replace the element's inner HTML, used by inline text editing.
 *
 * Text editing happens directly in the page via `contenteditable`, so the DOM
 * already holds the new value by the time this is committed; pass
 * `alreadyApplied` to `History.commit`.
 */
export function setInnerHTML(el: HTMLElement, before: string, after: string): Command {
  return {
    label: 'Edit text',
    mergeKey: `text:${elementKey(el)}`,
    subject: `text:${elementKey(el)}`,
    record: record(el, 'text', `Change text of ${labelFor(el)}`, {
      before: exact(stripTags(before)),
      after: exact(stripTags(after)),
      // The markup as well, so a change that is only markup is not mistaken for no change.
      markupBefore: before,
      markupAfter: after,
    }),
    apply: () => {
      el.innerHTML = after;
    },
    revert: () => {
      el.innerHTML = before;
    },
  };
}

/** Replace the element's plain-text content. */
export function setTextContent(el: HTMLElement, after: string): Command {
  const before = directText(el);
  return {
    label: 'Edit text',
    mergeKey: `text:${elementKey(el)}`,
    subject: `text:${elementKey(el)}`,
    record: record(el, 'text', `Change text of ${labelFor(el)}`, {
      before: exact(before),
      after: exact(after),
    }),
    apply: () => {
      el.textContent = after;
    },
    revert: () => {
      el.textContent = before;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Style                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Set or remove one inline CSS declaration.
 *
 * An empty `value` removes the property, which is how the style panel's clear
 * button and "revert to inherited" both work.
 */
export function setStyleProperty(el: HTMLElement, property: string, value: string): Command {
  const before = el.style.getPropertyValue(property);
  const beforePriority = el.style.getPropertyPriority(property);
  const after = value.trim();

  return {
    label: `Set ${property}`,
    mergeKey: `style:${elementKey(el)}:${property}`,
    subject: `style:${elementKey(el)}:${property}`,
    record: record(el, 'style', `Set ${property} to ${after || '(removed)'} on ${labelFor(el)}`, {
      before: before || undefined,
      after: after || undefined,
      detail: { property, value: after },
    }),
    apply: () => {
      if (after) el.style.setProperty(property, after);
      else el.style.removeProperty(property);
      tidyStyleAttribute(el);
    },
    revert: () => {
      if (before) el.style.setProperty(property, before, beforePriority);
      else el.style.removeProperty(property);
      tidyStyleAttribute(el);
    },
  };
}

/**
 * Drop an empty `style` attribute.
 *
 * Removing the last inline declaration leaves `style=""` behind, which would
 * show up as noise in the exported HTML and in the save prompt's diff.
 */
export function tidyStyleAttribute(el: HTMLElement): void {
  if (el.hasAttribute('style') && el.getAttribute('style')!.trim() === '') {
    el.removeAttribute('style');
  }
}

/** Apply several declarations at once, e.g. when a container preset is picked. */
export function setStyleProperties(
  el: HTMLElement,
  declarations: Record<string, string>,
  label = 'Update styles',
): Command {
  const entries = Object.entries(declarations);
  const before = entries.map(([property]) => ({
    property,
    value: el.style.getPropertyValue(property),
    priority: el.style.getPropertyPriority(property),
  }));

  return {
    label,
    // Scoped to the exact property set so re-applying the same group collapses,
    // and so a group put back to its original values cancels out.
    mergeKey: `styles:${elementKey(el)}:${entries.map(([p]) => p).join(',')}`,
    subject: `styles:${elementKey(el)}:${entries.map(([p]) => p).join(',')}`,
    record: record(el, 'style', `${label} on ${labelFor(el)}`, {
      before: before
        .filter((item) => item.value)
        .map((item) => `${item.property}: ${item.value}`)
        .join('; '),
      after: entries
        .filter(([, value]) => value)
        .map(([property, value]) => `${property}: ${value}`)
        .join('; '),
      detail: Object.fromEntries(entries),
    }),
    apply: () => {
      for (const [property, value] of entries) {
        if (value) el.style.setProperty(property, value);
        else el.style.removeProperty(property);
      }
      tidyStyleAttribute(el);
    },
    revert: () => {
      for (const item of before) {
        if (item.value) el.style.setProperty(item.property, item.value, item.priority);
        else el.style.removeProperty(item.property);
      }
      tidyStyleAttribute(el);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Attributes and classes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One attribute. `null` removes it; `''` sets it to the empty string.
 *
 * The two used to mean the same thing, and that was a bug with two victims already in the tree: a
 * boolean attribute is written as `disabled=""`, so every checkbox in the props panel removed the
 * attribute it meant to add, and an empty `alt` is how an image is marked decorative, so the media
 * panel deleted the attribute that carried that meaning. `null` was always the way to say remove --
 * the signature says so -- and nothing else in the tree passed `''`, since every other caller
 * normalises through `value || null`.
 */
export function setAttribute(el: HTMLElement, name: string, value: string | null): Command {
  const before = el.getAttribute(name);
  return {
    label: `Set ${name}`,
    mergeKey: `attr:${elementKey(el)}:${name}`,
    subject: `attr:${elementKey(el)}:${name}`,
    record: record(el, 'attribute', `Set ${name}="${value ?? ''}" on ${labelFor(el)}`, {
      before: before ?? undefined,
      after: value ?? undefined,
      detail: { attribute: name, value: value ?? '' },
    }),
    apply: () => {
      if (value === null) el.removeAttribute(name);
      else el.setAttribute(name, value);
    },
    revert: () => {
      if (before === null) el.removeAttribute(name);
      else el.setAttribute(name, before);
    },
  };
}

/**
 * Several attributes at once, as one entry on the undo stack.
 *
 * The counterpart to `setStyleProperties`, and added for the same reason: a user adding `role` and
 * `aria-label` together made one decision, and looping the single setter would have charged them
 * two undos for it. An empty value writes an empty attribute, as it does in `setAttribute`, which
 * is what a boolean attribute is.
 *
 * One record *per attribute*, through `extraRecords`, rather than one record describing the batch.
 * That is not bookkeeping neatness — the save path builds its file patch from `detail.attribute`,
 * one patch per name, and a record that named only the first attribute would have written one of
 * them to disk and silently dropped the rest. A record with no `detail.attribute` at all is worse
 * still: the surgical patch refuses the whole document and the save falls back to rewriting it.
 *
 * No `mergeKey` and no `subject`: a batch is a deliberate act with a beginning and an end, so
 * there is nothing for a later edit to coalesce into, and `subject` is documented as being for one
 * thing changing repeatedly rather than many things changing at once.
 */
export function setAttributes(
  el: HTMLElement,
  values: Record<string, string>,
  label = 'Set attributes',
): Command {
  const names = Object.keys(values);
  const before = new Map(names.map((name) => [name, el.getAttribute(name)]));
  const write = (name: string, value: string | null): void => {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };
  const describe = (name: string): ChangeRecord =>
    record(el, 'attribute', `Set ${name}="${values[name]}" on ${labelFor(el)}`, {
      before: before.get(name) ?? undefined,
      after: values[name] || undefined,
      detail: { attribute: name, value: values[name] },
    });

  return {
    label,
    record: describe(names[0]),
    extraRecords: names.slice(1).map(describe),
    apply: () => {
      for (const name of names) write(name, values[name]);
    },
    revert: () => {
      for (const name of names) write(name, before.get(name) ?? null);
    },
  };
}

export function setClassList(el: HTMLElement, classes: string[]): Command {
  const before = el.getAttribute('class');
  const after = classes.filter(Boolean).join(' ');
  return {
    label: 'Update classes',
    subject: `class:${elementKey(el)}`,
    record: record(el, 'class', `Set class="${after}" on ${labelFor(el)}`, {
      before: before ?? undefined,
      after,
      detail: { classes: after },
    }),
    apply: () => {
      if (after) el.setAttribute('class', after);
      else el.removeAttribute('class');
    },
    revert: () => {
      if (before === null) el.removeAttribute('class');
      else el.setAttribute('class', before);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

export type InsertPosition = 'before' | 'after' | 'firstChild' | 'lastChild' | 'replace';

/** Human phrasing for each position, used in labels and change summaries. */
export const INSERT_POSITION_LABELS: Record<InsertPosition, string> = {
  before: 'before',
  after: 'after',
  firstChild: 'at the start of',
  lastChild: 'inside',
  replace: 'in place of',
};

/**
 * Insert sanitized HTML relative to a reference element.
 *
 * Resolves to concrete nodes up front so undo can remove exactly what was
 * added, even when the markup expands to several siblings.
 */
export function insertHTML(
  reference: HTMLElement,
  position: InsertPosition,
  html: string,
  label = 'Insert element',
): { command: Command; nodes: HTMLElement[] } | null {
  const fragment = sanitizeFragment(html);
  const nodes = Array.from(fragment.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  if (!nodes.length) return null;
  const command = insertNodes(reference, position, nodes, label);
  return command ? { command, nodes } : null;
}

function resolveAnchor(
  reference: HTMLElement,
  position: InsertPosition,
): { parent: Node; before: Node | null } | null {
  switch (position) {
    case 'before': {
      const parent = reference.parentNode;
      return parent ? { parent, before: reference } : null;
    }
    case 'after': {
      const parent = reference.parentNode;
      return parent ? { parent, before: reference.nextSibling } : null;
    }
    case 'firstChild':
      return { parent: reference, before: reference.firstChild };
    case 'lastChild':
      return { parent: reference, before: null };
    default:
      return null;
  }
}

/** Insert already-constructed nodes. Used when a block registers a custom element. */
export function insertNodes(
  reference: HTMLElement,
  position: InsertPosition,
  nodes: HTMLElement[],
  label = 'Insert element',
): Command | null {
  if (!nodes.length) return null;
  if (position === 'replace') return replaceWithNodes(reference, nodes, label);

  const anchor = resolveAnchor(reference, position);
  if (!anchor) return null;
  for (const node of nodes) node.setAttribute(INSERTED_ATTR, '');
  return {
    label,
    subject: `node:${elementKey(nodes[0])}`,
    record: record(
      reference,
      'insert',
      `${label} ${INSERT_POSITION_LABELS[position]} ${labelFor(reference)}`,
      {
        after: exact(nodes.map((node) => cleanMarkup(node)).join('')),
        detail: { position, html: nodes.map((node) => cleanMarkup(node)).join('\n') },
        group: elementKey(nodes[0]),
      },
    ),
    apply: () => {
      for (const node of nodes) anchor.parent.insertBefore(node, anchor.before);
    },
    revert: () => {
      for (const node of nodes) node.remove();
    },
  };
}

/**
 * Swap the reference element out for the new nodes.
 *
 * Both sides are held by the closure, so undo and redo can trade them back and
 * forth indefinitely. Each direction anchors on the node the other direction just
 * put in place, which is what makes repeated alternation exact rather than
 * approximate.
 *
 * Both anchors are also treated as advisory. Replacing an element and then
 * dragging the replacement somewhere else is an ordinary next step, and it leaves
 * the anchor in a different parent — an unguarded `insertBefore` would throw,
 * `History.undo` would log and advance anyway, and the command would be stranded
 * with neither direction able to move anything. Falling back to appending gets
 * the element back into the right parent, which is the part that matters.
 *
 * Recorded as a `replace`, not an insert plus a delete, because that is the one
 * thing the change is: "this element became that one".
 */
function replaceWithNodes(
  reference: HTMLElement,
  nodes: HTMLElement[],
  label: string,
): Command | null {
  const parent = reference.parentNode;
  if (!parent) return null;
  if (reference === document.body || reference === document.documentElement) return null;
  for (const node of nodes) node.setAttribute(INSERTED_ATTR, '');
  const markup = nodes.map((node) => cleanMarkup(node)).join('\n');

  return {
    label,
    // Keyed on position: the element at this spot is what changed, and keying on
    // a node identity would make replacing twice look like two unrelated edits.
    subject: `markup:${selectorFor(reference)}`,
    // Described by what the swap produced rather than by the caller's label, so
    // the prompt reads the same whether the replacement came from the block
    // library, the code panel or the public API.
    record: record(reference, 'replace', `Replace ${labelFor(reference)} with ${labelFor(nodes[0])}`, {
      before: exact(cleanMarkup(reference)),
      after: exact(markup),
      detail: { position: 'replace', html: markup },
    }),
    apply: () => {
      for (const node of nodes) insertNear(parent, node, reference);
      reference.remove();
    },
    revert: () => {
      insertNear(parent, reference, nodes[0]);
      for (const node of nodes) node.remove();
    },
  };
}

/** Insert `node` before `anchor`, or append when the anchor has moved away. */
function insertNear(parent: Node, node: Node, anchor: Node): void {
  parent.insertBefore(node, anchor.parentNode === parent ? anchor : null);
}

export function removeElement(el: HTMLElement): Command | null {
  const parent = el.parentNode;
  if (!parent) return null;
  const before = el.nextSibling;
  return {
    label: `Delete ${labelFor(el)}`,
    subject: `node:${elementKey(el)}`,
    record: record(el, 'delete', `Delete ${labelFor(el)}`, {
      before: exact(cleanMarkup(el)),
    }),
    apply: () => {
      el.remove();
    },
    revert: () => {
      parent.insertBefore(el, before);
    },
  };
}

export function duplicateElement(el: HTMLElement): { command: Command; node: HTMLElement } | null {
  const parent = el.parentNode;
  if (!parent) return null;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.setAttribute(INSERTED_ATTR, '');
  const before = el.nextSibling;
  const command: Command = {
    label: `Duplicate ${labelFor(el)}`,
    subject: `node:${elementKey(clone)}`,
    record: record(el, 'duplicate', `Duplicate ${labelFor(el)}`, {
      after: exact(cleanMarkup(clone)),
      // The copy, not the original: whatever the user does to it next belongs with
      // this operation, which is the whole reason the group exists.
      group: elementKey(clone),
    }),
    apply: () => {
      parent.insertBefore(clone, before);
    },
    revert: () => {
      clone.remove();
    },
  };
  return { command, node: clone };
}

/** Move an element to a new parent/position. Used by drag reorder and the tree. */
export function moveElement(
  el: HTMLElement,
  targetParent: Node,
  targetBefore: Node | null,
  describe = 'Move',
): Command | null {
  const originParent = el.parentNode;
  if (!originParent) return null;
  const originBefore = el.nextSibling;
  if (originParent === targetParent && originBefore === targetBefore) return null;

  return {
    label: `${describe} ${labelFor(el)}`,
    subject: `move:${elementKey(el)}`,
    record: record(el, 'move', `${describe} ${labelFor(el)}`, {
      // Positions as comparable strings, so moving an element and moving it back
      // reduces to no change at all.
      before: describePosition(originParent, originBefore, el),
      after: describePosition(targetParent, targetBefore, el),
      detail: {
        newParent:
          targetParent instanceof HTMLElement ? selectorFor(targetParent) : 'shadow root',
        newIndex: String(indexWithin(targetParent, targetBefore, el)),
        previousParent:
          originParent instanceof HTMLElement ? selectorFor(originParent) : 'shadow root',
        previousIndex: String(indexWithin(originParent, originBefore, el)),
      },
    }),
    apply: () => {
      targetParent.insertBefore(el, targetBefore);
    },
    revert: () => {
      originParent.insertBefore(el, originBefore);
    },
  };
}

/** A position as a stable string: parent selector plus index among elements. */
function describePosition(parent: Node, before: Node | null, moving?: Node): string {
  const where = parent instanceof HTMLElement ? selectorFor(parent) : 'shadow root';
  return `${where}[${indexWithin(parent, before, moving)}]`;
}

/**
 * A move command for an element that has *already* been moved.
 *
 * Drag reordering repositions the real element as the pointer moves so the user
 * sees true layout rather than a placeholder. By the time the drop is committed
 * the element is in its final position, so the origin has to be supplied
 * explicitly — reading `parentNode` here would record the destination as the
 * thing to undo back to.
 */
export function moveCommandFromOrigin(
  el: HTMLElement,
  origin: { parent: Node; nextSibling: Node | null },
  describe = 'Move',
): Command | null {
  const targetParent = el.parentNode;
  if (!targetParent) return null;
  const targetBefore = el.nextSibling;
  if (origin.parent === targetParent && origin.nextSibling === targetBefore) return null;

  return {
    label: `${describe} ${labelFor(el)}`,
    subject: `move:${elementKey(el)}`,
    record: record(el, 'move', `${describe} ${labelFor(el)}`, {
      before: describePosition(origin.parent, origin.nextSibling, el),
      after: describePosition(targetParent, targetBefore, el),
      detail: {
        newParent: targetParent instanceof HTMLElement ? selectorFor(targetParent) : 'shadow root',
        newIndex: String(indexWithin(targetParent, targetBefore, el)),
        previousParent:
          origin.parent instanceof HTMLElement ? selectorFor(origin.parent) : 'shadow root',
        previousIndex: String(indexWithin(origin.parent, origin.nextSibling, el)),
      },
    }),
    apply: () => {
      targetParent.insertBefore(el, targetBefore);
    },
    revert: () => {
      origin.parent.insertBefore(el, origin.nextSibling);
    },
  };
}

/**
 * Wrap the element in a new container, preserving its position.
 *
 * The wrapper markup comes from the library, so a "wrap in flex row" is just a
 * wrap with the flex container preset as `wrapperHTML`.
 */
export function wrapElement(
  el: HTMLElement,
  wrapperHTML: string,
): { command: Command; wrapper: HTMLElement } | null {
  const parent = el.parentNode;
  if (!parent) return null;
  const fragment = sanitizeFragment(wrapperHTML);
  const wrapper = fragment.firstElementChild;
  if (!(wrapper instanceof HTMLElement)) return null;
  wrapper.setAttribute(INSERTED_ATTR, '');

  // Nest into the deepest single-child descendant so wrappers with inner
  // scaffolding (a section holding a div) place the element where it belongs.
  let mountPoint: HTMLElement = wrapper;
  while (mountPoint.children.length === 1 && mountPoint.firstElementChild instanceof HTMLElement) {
    mountPoint = mountPoint.firstElementChild;
  }

  const before = el.nextSibling;
  const command: Command = {
    label: `Wrap ${labelFor(el)}`,
    subject: `node:${elementKey(wrapper)}`,
    record: record(el, 'wrap', `Wrap ${labelFor(el)} in <${wrapper.tagName.toLowerCase()}>`, {
      after: exact(cleanMarkup(wrapper)),
      detail: { wrapper: cleanMarkup(wrapper) },
      group: elementKey(wrapper),
    }),
    apply: () => {
      parent.insertBefore(wrapper, before);
      mountPoint.appendChild(el);
    },
    revert: () => {
      parent.insertBefore(el, wrapper);
      wrapper.remove();
    },
  };
  return { command, wrapper };
}

/** Unwrap: replace a container with its children. */
export function unwrapElement(el: HTMLElement): Command | null {
  const parent = el.parentNode;
  if (!parent) return null;
  const children = Array.from(el.childNodes);
  const before = el.nextSibling;
  if (!children.length) return null;

  return {
    label: `Unwrap ${labelFor(el)}`,
    subject: `node:${elementKey(el)}`,
    record: record(el, 'replace', `Unwrap ${labelFor(el)}, keeping its ${children.length} children`),
    apply: () => {
      for (const child of children) parent.insertBefore(child, el);
      el.remove();
    },
    revert: () => {
      parent.insertBefore(el, before);
      for (const child of children) el.appendChild(child);
    },
  };
}

/**
 * Replace an element with new markup from the HTML code panel.
 *
 * Both the old and new nodes are retained by the closure, so undo/redo can swap
 * between them any number of times.
 */
export function replaceElement(
  el: HTMLElement,
  html: string,
): { command: Command; node: HTMLElement } | null {
  const parent = el.parentNode;
  if (!parent) return null;
  const fragment = sanitizeFragment(html);
  const replacement = fragment.firstElementChild;
  if (!(replacement instanceof HTMLElement)) return null;

  const command: Command = {
    label: `Edit HTML of ${labelFor(el)}`,
    // Keyed on position, not node identity: each edit replaces the node, so a
    // node key would make successive markup edits look like unrelated changes.
    subject: `markup:${selectorFor(el)}`,
    record: record(el, 'replace', `Rewrite markup of ${labelFor(el)}`, {
      before: exact(cleanMarkup(el)),
      after: exact(cleanMarkup(replacement)),
      detail: { html: cleanMarkup(replacement) },
    }),
    apply: () => {
      parent.replaceChild(replacement, el);
    },
    revert: () => {
      parent.replaceChild(el, replacement);
    },
  };
  return { command, node: replacement };
}

/** Change an element's tag while keeping attributes and children. */
export function retagElement(
  el: HTMLElement,
  tagName: string,
): { command: Command; node: HTMLElement } | null {
  const parent = el.parentNode;
  if (!parent) return null;
  const safeTag = tagName.trim().toLowerCase();
  if (!/^[a-z][\w-]*$/.test(safeTag) || safeTag === el.tagName.toLowerCase()) return null;

  const replacement = document.createElement(safeTag);
  for (const attr of Array.from(el.attributes)) replacement.setAttribute(attr.name, attr.value);
  while (el.firstChild) replacement.appendChild(el.firstChild);
  const originalChildren = Array.from(replacement.childNodes);

  const command: Command = {
    label: `Change to <${safeTag}>`,
    subject: `tag:${selectorFor(el)}`,
    record: record(el, 'replace', `Change <${el.tagName.toLowerCase()}> to <${safeTag}>`, {
      before: el.tagName.toLowerCase(),
      after: safeTag,
      detail: { tagName: safeTag },
    }),
    apply: () => {
      while (el.firstChild) replacement.appendChild(el.firstChild);
      parent.replaceChild(replacement, el);
    },
    revert: () => {
      for (const child of originalChildren) el.appendChild(child);
      parent.replaceChild(el, replacement);
    },
  };
  return { command, node: replacement };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const keys = new WeakMap<HTMLElement, string>();
/*
 * And the way back, so a record can name its element without holding it.
 *
 * Weakly, so an element the user deleted is still collectable — the map only has to answer
 * for elements that are still on the page.
 */
const keyed = new Map<string, WeakRef<HTMLElement>>();
let keySequence = 0;

/** Stable per-element key, used to scope merge keys to one element. */
export function elementKey(el: HTMLElement): string {
  let key = keys.get(el);
  if (!key) {
    keySequence += 1;
    key = `e${keySequence.toString(36)}`;
    keys.set(el, key);
    keyed.set(key, new WeakRef(el));
  }
  return key;
}

/** The element behind a key, if it is still in the page. */
export function elementForKey(key: string): HTMLElement | null {
  const el = keyed.get(key)?.deref();
  if (!el) {
    keyed.delete(key);
    return null;
  }
  return el.isConnected ? el : null;
}

/**
 * Position among element children, not child nodes.
 *
 * The prompt is read by a person or an agent looking at source, where whitespace
 * text nodes are invisible; a childNodes index would not match what they count.
 *
 * `moving` is left out of the count. Positions are computed before the move is
 * applied, so an element on its way forward within its own parent was still
 * occupying a slot ahead of its destination and every such move was reported one
 * place too far along — "move it to position 4" in a list that only has four
 * elements. Excluding it gives the index the element will actually hold, which is
 * both what the reader needs and what makes a move and its reverse compare equal.
 */
function indexWithin(parent: Node, before: Node | null, moving?: Node): number {
  const elements = Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === Node.ELEMENT_NODE && node !== moving,
  );
  if (!before) return elements.length;
  // `before` is an `insertBefore` anchor, which is very often the whitespace text
  // node between two tags, so walk forward to the first element at or after it.
  // Looking only for an exact element match reported every such position as "at
  // the end" — which made moving an element read as no change at all, and the
  // change set then dropped the move entirely.
  let node: Node | null = before;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const index = elements.indexOf(node as Element);
      if (index >= 0) return index;
    }
    node = node.nextSibling;
  }
  return elements.length;
}

function stripTags(html: string): string {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return holder.textContent ?? '';
}

/**
 * Markup as it should appear in the save prompt.
 *
 * Works on a clone with every `data-heo-*` attribute removed: the source markers
 * and insertion flags are editor bookkeeping, and leaving them in would have the
 * agent paste them into the codebase.
 *
 * `keep` names the exceptions. There is exactly one so far and it earns it: when the block
 * library travels with the page, `data-heo-block` stops being bookkeeping and becomes the only
 * thing tying an element in the file to the template it came from. Strip it then and the next
 * load restores the library but knows nothing about what in the page came from it.
 */
export function cleanMarkup(el: HTMLElement, keep: readonly string[] = []): string {
  const clone = el.cloneNode(true) as HTMLElement;
  const kept = new Set(keep);
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of Array.from(node.attributes)) {
      if (kept.has(attr.name)) continue;
      if (attr.name.startsWith('data-heo-') || attr.name === 'contenteditable') {
        node.removeAttribute(attr.name);
      }
    }
  }
  return clone.outerHTML;
}

/**
 * A recorded value, verbatim.
 *
 * This used to collapse whitespace and cut the value off at 400 characters with an
 * ellipsis. For markup that was survivable, since `detail.html` carries the full copy
 * — but for a text edit and for a deletion, `before` and `after` are the *only* record
 * of what the value was, so the save prompt asked an agent to reproduce a paragraph it
 * had only been shown the first 400 characters of. Whitespace mattered too: collapsing
 * it silently rewrote the value that was being asked for.
 *
 * Kept as a named function rather than deleted so the intent stays visible at every
 * call site: these are values, and values are recorded as they are.
 */
function exact(value: string): string {
  return value;
}

/**
 * Whether two pieces of markup are the same but for pretty-printing.
 *
 * Exists because "Save as a reusable block" reported the element it had just been captured from
 * as already out of date. The block's markup is stored formatted — that is what the dialog shows
 * and what the author edits — so re-rendering the template puts a newline and an indent between
 * every pair of tags, while the element it came from has whatever the file had. Comparing the two
 * byte for byte therefore always differed, and the component was born drifted.
 *
 * Only whitespace that *contains a newline* is collapsed, and that restraint is the whole point.
 * A single space between two inline elements is content — `<b>a</b> <i>b</i>` does not render like
 * `<b>a</b><i>b</i>` — so a blanket `>\s+<` would have declared a real difference to be none. A
 * newline between tags is what a formatter adds and what no author relies on.
 */
export function sameStructure(a: string, b: string): boolean {
  const collapse = (html: string): string => html.replace(/>[ \t]*\r?\n\s*</g, '><').trim();
  return collapse(a) === collapse(b);
}
