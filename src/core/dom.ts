import {
  HOST_TAG,
  IGNORE_ATTR,
  NATIVE_INPUT_TAGS,
  NON_SELECTABLE_TAGS,
  SOURCE_ATTR,
  VOID_TAGS,
} from './constants.js';
import type { SourceRef } from './types.js';

/**
 * The really-focused element, following the chain down through shadow roots.
 *
 * `document.activeElement` stops at the outermost shadow host, which for this
 * overlay is almost always `<html-editor-overlay>` — accurate and useless. Lives
 * here rather than with the focus-containment code so both that and the modal
 * controller can reach it without importing each other.
 */
export function deepActiveElement(): HTMLElement | null {
  let node: Element | null = document.activeElement;
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
  return node instanceof HTMLElement ? node : null;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/* -------------------------------------------------------------------------- */
/* Overlay boundary                                                            */
/* -------------------------------------------------------------------------- */

/**
 * True when the node belongs to the overlay's own UI.
 *
 * Checked against both the host tag and the opt-out attribute so that host-page
 * chrome can also be excluded by adding `data-heo-ignore`.
 */
export function isOverlayNode(node: unknown): boolean {
  let current = node as Node | null;
  while (current) {
    if (current instanceof Element) {
      const tag = current.tagName.toLowerCase();
      if (tag === HOST_TAG) return true;
      if (current.hasAttribute(IGNORE_ATTR)) return true;
    }
    current = flatParentNode(current);
  }
  return false;
}

/** The event's true target, defeating shadow-DOM retargeting. */
export function deepTarget(event: Event): HTMLElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (node instanceof HTMLElement) return node;
  }
  return event.target instanceof HTMLElement ? event.target : null;
}

/** The first element in the event path the editor is allowed to select. */
export function selectableFromEvent(event: Event): HTMLElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    if (isOverlayNode(node)) return null;
    if (isSelectable(node)) return node;
  }
  return null;
}

/** True when the event happened inside a native form control we should not hijack. */
export function isNativeInputEvent(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  return path.some((node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (NATIVE_INPUT_TAGS.has(node.tagName.toLowerCase())) return true;
    return node.isContentEditable;
  });
}

/* -------------------------------------------------------------------------- */
/* Flattened-tree traversal                                                    */
/* -------------------------------------------------------------------------- */

function flatParentNode(node: Node): Node | null {
  if (node instanceof Element && node.assignedSlot) return node.assignedSlot;
  if (node.parentNode instanceof ShadowRoot) return node.parentNode.host;
  return node.parentNode;
}

/**
 * The parent as the user perceives it on screen.
 *
 * Priority matters: a slotted element's visual parent is the `<slot>` that
 * renders it, not its light-DOM parent. Using `assignedSlot` first keeps upward
 * traversal symmetric with `flatChildren`'s descent, so walking up then down
 * returns you where you started.
 */
export function flatParent(el: HTMLElement): HTMLElement | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  if (root instanceof ShadowRoot) return root.host as HTMLElement;
  return null;
}

/**
 * The children as the user perceives them:
 * a `<slot>` yields its assigned (or fallback) elements, a shadow host yields
 * its shadow root's children, anything else yields its own children.
 */
export function flatChildren(el: HTMLElement): HTMLElement[] {
  if (el instanceof HTMLSlotElement) {
    const assigned = el.assignedElements({ flatten: true }).filter(isEditableElement);
    return assigned.length ? assigned : Array.from(el.children).filter(isEditableElement);
  }
  const root: ParentNode = el.shadowRoot ?? el;
  return Array.from(root.children).filter(isEditableElement);
}

/**
 * An element node the editor is willing to work with.
 *
 * SVG counts. `<svg>` is an `SVGSVGElement`, not an `HTMLElement`, so an
 * `instanceof HTMLElement` filter here silently dropped every inline icon and
 * illustration from the tree — even though clicking one on the page selected it
 * quite happily, because `isSelectable` admits SVG. The two have to agree.
 *
 * The `HTMLElement` return type is the same deliberate simplification the rest of
 * this module makes: everything the editor touches on an SVG element (style,
 * classList, dataset, getBoundingClientRect) exists on both, and typing the whole
 * surface as `Element` would cost far more than it explains.
 */
function isEditableElement(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement || node instanceof SVGElement;
}

/** Selectable ancestors and self, nearest first, stopping at `<body>`. */
export function ancestors(el: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let current: HTMLElement | null = flatParent(el);
  while (current && current !== document.documentElement) {
    if (isOverlayNode(current)) break;
    if (isSelectable(current)) chain.push(current);
    current = flatParent(current);
  }
  return chain;
}

/** Nearest selectable ancestor, or null. */
export function selectableParent(el: HTMLElement): HTMLElement | null {
  let current = flatParent(el);
  while (current && current !== document.documentElement) {
    if (isOverlayNode(current)) return null;
    if (isSelectable(current)) return current;
    current = flatParent(current);
  }
  return null;
}

/** Selectable children in document order. */
export function selectableChildren(el: HTMLElement): HTMLElement[] {
  return flatChildren(el).filter((child) => !isOverlayNode(child) && isSelectable(child));
}

/** Selectable siblings in document order, including `el`. */
export function selectableSiblings(el: HTMLElement): HTMLElement[] {
  const parent = selectableParent(el) ?? (el.parentElement as HTMLElement | null);
  if (!parent) return [el];
  const siblings = selectableChildren(parent);
  return siblings.length ? siblings : [el];
}

export function previousSibling(el: HTMLElement): HTMLElement | null {
  const siblings = selectableSiblings(el);
  const index = siblings.indexOf(el);
  return index > 0 ? siblings[index - 1] : null;
}

export function nextSibling(el: HTMLElement): HTMLElement | null {
  const siblings = selectableSiblings(el);
  const index = siblings.indexOf(el);
  return index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
}

export function firstSelectableChild(el: HTMLElement): HTMLElement | null {
  return selectableChildren(el)[0] ?? null;
}

/**
 * Next element in document order: first child, else next sibling, else climb
 * until an ancestor has a next sibling. Never dead-ends inside a subtree.
 */
export function nextInFlow(el: HTMLElement, options: { descend?: boolean } = {}): HTMLElement | null {
  if (options.descend !== false) {
    const child = firstSelectableChild(el);
    if (child) return child;
  }
  let current: HTMLElement | null = el;
  while (current) {
    const sibling = nextSibling(current);
    if (sibling) return sibling;
    current = selectableParent(current);
  }
  return null;
}

/** Previous element in document order: previous sibling's deepest tail, else parent. */
export function previousInFlow(el: HTMLElement): HTMLElement | null {
  const previous = previousSibling(el);
  if (!previous) return selectableParent(el);
  let deepest = previous;
  for (; ;) {
    const children = selectableChildren(deepest);
    if (!children.length) return deepest;
    deepest = children[children.length - 1];
  }
}

/** Every descendant matching `selector`, crossing every shadow root. */
export function queryDeep(
  selector: string,
  root: Document | ShadowRoot | HTMLElement = document,
): HTMLElement[] {
  const results: HTMLElement[] = [];
  const seen = new Set<ShadowRoot | Document | HTMLElement>();
  const visit = (node: Document | ShadowRoot | HTMLElement): void => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const el of node.querySelectorAll<HTMLElement>(selector)) {
      if (!isOverlayNode(el)) results.push(el);
    }
    for (const el of node.querySelectorAll<HTMLElement>('*')) {
      if (el.shadowRoot && !isOverlayNode(el)) visit(el.shadowRoot);
    }
  };

  visit(root);
  return results;
}

/* -------------------------------------------------------------------------- */
/* Candidacy                                                                   */
/* -------------------------------------------------------------------------- */

/** True when the editor may select this element. */
export function isSelectable(el: Element | null): el is HTMLElement {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
  if (NON_SELECTABLE_TAGS.has(el.tagName.toLowerCase())) return false;
  if (el.hasAttribute(IGNORE_ATTR)) return false;
  return el !== document.documentElement;
}

/** True when children may be inserted into this element. */
export function acceptsChildren(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (VOID_TAGS.has(tag)) return false;
  if (tag === 'iframe' || tag === 'svg' || tag === 'canvas' || tag === 'video') return false;
  return true;
}

/** True when the element can be structurally moved or removed. */
export function isMutable(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.parentNode) return false;
  if (el === document.body || el === document.documentElement) return false;
  return isSelectable(el);
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A box suitable for drawing the selection outline.
 *
 * A `<slot>` has no box of its own — what is painted is the projected content —
 * so zero-size elements fall back to the union of their rendered children.
 */
export function visualBox(el: HTMLElement): Box {
  const own = el.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) {
    return { top: own.top, left: own.left, width: own.width, height: own.height };
  }
  const kids =
    el instanceof HTMLSlotElement
      ? el.assignedElements({ flatten: true }).filter(isEditableElement)
      : Array.from(el.children).filter(isEditableElement);
  const rects = kids.map((k) => k.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (!rects.length) {
    return { top: own.top, left: own.left, width: own.width, height: own.height };
  }
  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const right = Math.max(...rects.map((r) => r.right));
  return { top, left, width: right - left, height: bottom - top };
}

/** True when the box has any on-screen presence. */
export function isVisible(el: HTMLElement): boolean {
  const box = visualBox(el);
  if (box.width <= 0 && box.height <= 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

/** True when the element's children are laid out along the inline axis. */
export function isHorizontalFlow(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display.includes('flex')) return !style.flexDirection.startsWith('column');
  if (style.display.includes('grid')) {
    const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length;
    return columns > 1;
  }

  if (style.display.includes('inline')) return true;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Addressing and labelling                                                    */
/* -------------------------------------------------------------------------- */

/** Structural index path from `<html>`, used to recover a node after re-render. */
export function pathOf(el: HTMLElement): number[] | null {
  if (!el.isConnected) return null;
  const path: number[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== document.documentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return path;
}

export function elementAtPath(path: number[] | null | undefined): HTMLElement | null {
  if (!path) return null;
  let node: Element | null = document.documentElement;
  for (const index of path) {
    node = node?.children[index] ?? null;
    if (!node) return null;
  }
  return node instanceof HTMLElement ? node : null;
}

/**
 * A CSS selector that identifies the element well enough for a human or an
 * agent to find it in source. Prefers an id, then a unique class chain, then
 * falls back to `:nth-of-type` steps.
 */
export function selectorFor(el: HTMLElement): string {
  if (el.id && document.querySelectorAll(cssEscapeId(el.id)).length === 1) {
    return cssEscapeId(el.id);
  }
  const parts: string[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(cssEscapeId(node.id));
      break;
    }
    const classes = Array.from(node.classList)
      .filter((name) => !name.startsWith('heo-'))
      .slice(0, 2)
      .map((name) => `.${CSS.escape(name)}`)
      .join('');
    part += classes;
    const parent: HTMLElement | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

function cssEscapeId(id: string): string {
  return `#${CSS.escape(id)}`;
}

/** Compact label such as `article.card#story`. */
export function labelFor(el: HTMLElement | null): string {
  if (!el) return 'No selection';
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const classes = Array.from(el.classList)
    .filter((name) => !name.startsWith('heo-'))
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join('');
  return `${tag}${id}${classes}`;
}

/** Text belonging directly to the element, ignoring descendants. */
export function directText(el: HTMLElement): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? '';
  }
  return text.trim();
}

/** True when the element's content is a single run of text, safe to edit inline. */
export function isTextHost(el: HTMLElement): boolean {
  if (!el.childNodes.length) return true;
  const hasBlockChild = Array.from(el.children).some((child) => {
    const display = getComputedStyle(child).display;
    return display.startsWith('block') || display.startsWith('flex') || display.startsWith('grid');
  });
  return !hasBlockChild && el.textContent!.trim().length > 0;
}

/** Read the source marker written by the build-time instrumentation. */
export function sourceRefOf(el: HTMLElement): SourceRef | undefined {
  const raw = el.getAttribute(SOURCE_ATTR);
  if (!raw) return undefined;
  // Split from the right so Windows drive letters survive.
  const parts = raw.split(':');
  const column = Number.parseInt(parts.pop() ?? '', 10);
  const line = Number.parseInt(parts.pop() ?? '', 10);
  const file = parts.join(':');
  if (!file || !Number.isFinite(line) || !Number.isFinite(column)) return undefined;
  return { file, line, column };
}

/** Nearest source marker at or above the element, for uninstrumented children. */
export function nearestSourceRef(el: HTMLElement): SourceRef | undefined {
  let current: HTMLElement | null = el;
  while (current) {
    const ref = sourceRefOf(current);
    if (ref) return ref;
    current = flatParent(current);
  }
  return undefined;
}
