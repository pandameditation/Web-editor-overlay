// Shadow-DOM-aware DOM traversal helpers.
//
// Web components (e.g. Lit elements) render their content into a shadow root.
// Standard DOM APIs do not cross these boundaries:
//   - Events dispatched from inside a shadow root are *retargeted* to the host
//     when observed by a listener on an ancestor (e.g. document), so `e.target`
//     reports the host element, not the real element under the pointer.
//   - `parentElement` is null for the top-level nodes of a shadow root.
//   - `querySelector(All)` does not descend into shadow roots.
//
// These helpers pierce shadow boundaries so the overlay can inspect and edit
// elements nested inside web components.

/** The real, deepest element an event originated from, piercing shadow DOM. */
export function deepTarget(e: Event): HTMLElement | null {
  const path = e.composedPath();
  const first = path[0];
  if (first instanceof HTMLElement) return first;
  return (e.target as HTMLElement) ?? null;
}

/** Parent element, crossing out of a shadow root to its host when needed. */
export function shadowParent(el: HTMLElement): HTMLElement | null {
  // If the element is projected into a slot (light-DOM child rendered inside a
  // web component's shadow tree), its *flattened-tree* parent is the <slot> it
  // is assigned to — not its light-DOM parent (the shadow host). Using the slot
  // keeps upward traversal symmetric with renderedChildren()'s descent, so a
  // slotted element appears correctly nested under the component that renders it.
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  if (root instanceof ShadowRoot) return root.host as HTMLElement;
  return null;
}

/**
 * Nearest ancestor (inclusive) carrying data-live-src, crossing shadow
 * boundaries. Returns null if a data-live-edit-ignore element is hit first.
 */
export function closestWithSrc(el: HTMLElement | null): HTMLElement | null {
  while (el && el !== document.body) {
    if (el.dataset && el.dataset.liveEditIgnore !== undefined) return null;
    if (el.dataset && el.dataset.liveSrc) return el;
    el = shadowParent(el);
  }
  return null;
}

/**
 * The "rendered" children of an element, mirroring the flattened tree the user
 * actually sees on screen:
 *   - A <slot> renders the light-DOM elements assigned to it (or its fallback
 *     content when nothing is assigned), so we descend into those instead of
 *     the empty slot itself.
 *   - A shadow host renders the children of its shadow root.
 *   - Anything else renders its own light-DOM children.
 */
export function renderedChildren(el: HTMLElement): HTMLElement[] {
  if (el instanceof HTMLSlotElement) {
    const assigned = el.assignedElements({ flatten: true }) as HTMLElement[];
    // assignedElements({flatten:true}) already returns fallback content when
    // nothing is assigned, but guard defensively for older engines.
    return assigned.length ? assigned : (Array.from(el.children) as HTMLElement[]);
  }
  const root: ParentNode = el.shadowRoot ?? el;
  return Array.from(root.children) as HTMLElement[];
}

/** First descendant carrying data-live-src, descending into shadow roots. */
export function firstChildWithSrc(el: HTMLElement): HTMLElement | null {
  for (const child of renderedChildren(el)) {
    if (child.dataset && child.dataset.liveEditIgnore !== undefined) continue;
    if (child.dataset && child.dataset.liveSrc) return child;
    const nested = firstChildWithSrc(child);
    if (nested) return nested;
  }
  return null;
}

export interface Rect { top: number; left: number; width: number; height: number; }

/**
 * A bounding rectangle suitable for the selection/hover overlay.
 *
 * Most elements use their own box. But a <slot> has no box of its own — what's
 * painted is the content projected into it — so its `getBoundingClientRect()`
 * is empty and the overlay would be invisible. For such zero-size elements we
 * union the rectangles of their rendered content instead (a slot's assigned
 * elements, or an ordinary element's children). Falls back to the element's own
 * rect when there's nothing better to measure.
 */
export function renderedRect(el: HTMLElement): Rect {
  const own = el.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) {
    return { top: own.top, left: own.left, width: own.width, height: own.height };
  }

  const kids = el instanceof HTMLSlotElement
    ? (el.assignedElements({ flatten: true }) as HTMLElement[])
    : (Array.from(el.children) as HTMLElement[]);
  const rects = kids
    .map((k) => k.getBoundingClientRect())
    .filter((r) => r.width > 0 || r.height > 0);

  if (rects.length === 0) {
    return { top: own.top, left: own.left, width: own.width, height: own.height };
  }

  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const right = Math.max(...rects.map((r) => r.right));
  return { top, left, width: right - left, height: bottom - top };
}

/**
 * All descendants matching `selector`, recursing through every shadow root.
 */
export function queryAllDeep(
  selector: string,
  root: Document | ShadowRoot | HTMLElement = document,
): HTMLElement[] {
  const results: HTMLElement[] = [];
  const visit = (node: Document | ShadowRoot | HTMLElement) => {
    node.querySelectorAll<HTMLElement>(selector).forEach((el) => results.push(el));
    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };
  visit(root);
  return results;
}
