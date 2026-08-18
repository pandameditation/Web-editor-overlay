import { INSERTED_ATTR } from './constants.js';
import { directText, labelFor, nearestSourceRef, selectorFor } from './dom.js';
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
    at: Date.now(),
    ...extra,
  };
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
    record: record(el, 'text', `Change text of ${labelFor(el)}`, {
      before: truncate(stripTags(before)),
      after: truncate(stripTags(after)),
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
    record: record(el, 'text', `Change text of ${labelFor(el)}`, {
      before: truncate(before),
      after: truncate(after),
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
    record: record(el, 'style', `${label} on ${labelFor(el)}`, {
      after: entries.map(([property, value]) => `${property}: ${value}`).join('; '),
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

export function setAttribute(el: HTMLElement, name: string, value: string | null): Command {
  const before = el.getAttribute(name);
  return {
    label: `Set ${name}`,
    mergeKey: `attr:${elementKey(el)}:${name}`,
    record: record(el, 'attribute', `Set ${name}="${value ?? ''}" on ${labelFor(el)}`, {
      before: before ?? undefined,
      after: value ?? undefined,
      detail: { attribute: name, value: value ?? '' },
    }),
    apply: () => {
      if (value === null || value === '') el.removeAttribute(name);
      else el.setAttribute(name, value);
    },
    revert: () => {
      if (before === null) el.removeAttribute(name);
      else el.setAttribute(name, before);
    },
  };
}

export function setClassList(el: HTMLElement, classes: string[]): Command {
  const before = el.getAttribute('class');
  const after = classes.filter(Boolean).join(' ');
  return {
    label: 'Update classes',
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

export type InsertPosition = 'before' | 'after' | 'firstChild' | 'lastChild';

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
  for (const node of nodes) node.setAttribute(INSERTED_ATTR, '');

  const anchor = resolveAnchor(reference, position);
  if (!anchor) return null;

  const command: Command = {
    label,
    record: record(reference, 'insert', `${label} ${position} ${labelFor(reference)}`, {
      after: truncate(nodes.map(cleanMarkup).join('')),
      detail: { position, html: nodes.map(cleanMarkup).join('\n') },
    }),
    apply: () => {
      for (const node of nodes) anchor.parent.insertBefore(node, anchor.before);
    },
    revert: () => {
      for (const node of nodes) node.remove();
    },
  };
  return { command, nodes };
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
  const anchor = resolveAnchor(reference, position);
  if (!anchor || !nodes.length) return null;
  for (const node of nodes) node.setAttribute(INSERTED_ATTR, '');
  return {
    label,
    record: record(reference, 'insert', `${label} ${position} ${labelFor(reference)}`, {
      after: truncate(nodes.map(cleanMarkup).join('')),
      detail: { position, html: nodes.map(cleanMarkup).join('\n') },
    }),
    apply: () => {
      for (const node of nodes) anchor.parent.insertBefore(node, anchor.before);
    },
    revert: () => {
      for (const node of nodes) node.remove();
    },
  };
}

export function removeElement(el: HTMLElement): Command | null {
  const parent = el.parentNode;
  if (!parent) return null;
  const before = el.nextSibling;
  return {
    label: `Delete ${labelFor(el)}`,
    record: record(el, 'delete', `Delete ${labelFor(el)}`, {
      before: truncate(cleanMarkup(el)),
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
    record: record(el, 'duplicate', `Duplicate ${labelFor(el)}`, {
      after: truncate(cleanMarkup(clone)),
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
    record: record(el, 'move', `${describe} ${labelFor(el)}`, {
      detail: {
        newParent:
          targetParent instanceof HTMLElement ? selectorFor(targetParent) : 'shadow root',
        newIndex: String(indexWithin(targetParent, targetBefore)),
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
    record: record(el, 'move', `${describe} ${labelFor(el)}`, {
      detail: {
        newParent: targetParent instanceof HTMLElement ? selectorFor(targetParent) : 'shadow root',
        newIndex: String(indexWithin(targetParent, targetBefore)),
        previousParent:
          origin.parent instanceof HTMLElement ? selectorFor(origin.parent) : 'shadow root',
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
    record: record(el, 'wrap', `Wrap ${labelFor(el)} in <${wrapper.tagName.toLowerCase()}>`, {
      after: truncate(cleanMarkup(wrapper)),
      detail: { wrapper: cleanMarkup(wrapper) },
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
    record: record(el, 'replace', `Rewrite markup of ${labelFor(el)}`, {
      before: truncate(cleanMarkup(el)),
      after: truncate(cleanMarkup(replacement)),
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
let keySequence = 0;

/** Stable per-element key, used to scope merge keys to one element. */
export function elementKey(el: HTMLElement): string {
  let key = keys.get(el);
  if (!key) {
    keySequence += 1;
    key = `e${keySequence.toString(36)}`;
    keys.set(el, key);
  }
  return key;
}

/**
 * Position among element children, not child nodes.
 *
 * The prompt is read by a person or an agent looking at source, where whitespace
 * text nodes are invisible; a childNodes index would not match what they count.
 */
function indexWithin(parent: Node, before: Node | null): number {
  const elements = Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === Node.ELEMENT_NODE,
  );
  if (!before) return elements.length;
  let index = 0;
  for (const element of elements) {
    if (element === before) return index;
    index += 1;
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
 */
export function cleanMarkup(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('data-heo-') || attr.name === 'contenteditable') {
        node.removeAttribute(attr.name);
      }
    }
  }
  return clone.outerHTML;
}

function truncate(value: string, max = 400): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
