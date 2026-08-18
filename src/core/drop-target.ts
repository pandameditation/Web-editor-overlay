import { acceptsChildren, isHorizontalFlow, isSelectable, labelFor } from './dom.js';

export interface DropTarget {
  parent: Node;
  before: Node | null;
  /** Human description of the pending drop, shown in the drag chip. */
  hint: string;
}

/**
 * Where a drop at (x, y) should land.
 *
 * Two decisions make dragging feel right. First, hit-testing walks the whole
 * stack at the pointer rather than taking the topmost element: while dragging,
 * the element's former neighbours frequently overlap the gap the user is aiming
 * at, and the topmost hit is often the wrong answer. Second, the before/after
 * decision is made along the container's own flow axis, so the gesture reads the
 * same whether the parent lays its children out in a row or a column.
 *
 * Pure geometry, deliberately free of editor state, so it can be reasoned about
 * and exercised on its own.
 */
export function findDropTarget(dragged: HTMLElement, x: number, y: number): DropTarget | null {
  for (const candidate of document.elementsFromPoint(x, y)) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate === dragged || dragged.contains(candidate)) continue;
    if (!isSelectable(candidate)) continue;
    if (candidate === document.body) break;

    const parent = candidate.parentNode;
    if (!parent) continue;

    // An empty container big enough to aim at is almost always meant as a target
    // to drop *into*, not next to.
    if (acceptsChildren(candidate) && !candidate.children.length && isLargeEnough(candidate)) {
      return { parent: candidate, before: null, hint: `Into ${labelFor(candidate)}` };
    }

    const box = candidate.getBoundingClientRect();
    const parentEl = candidate.parentElement;
    const horizontal = parentEl ? isHorizontalFlow(parentEl) : false;
    const after = horizontal ? x > box.left + box.width / 2 : y > box.top + box.height / 2;

    return {
      parent,
      before: after ? candidate.nextSibling : candidate,
      hint: `${after ? 'After' : 'Before'} ${labelFor(candidate)}`,
    };
  }

  // Below everything: append to the end of the document.
  if (y > innerHeight * 0.9) {
    return { parent: document.body, before: null, hint: 'At the end of the page' };
  }
  return null;
}

/** Big enough that the pointer is plausibly aiming inside it, not past it. */
function isLargeEnough(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  return box.width > 24 && box.height > 24;
}
