import { acceptsChildren, isHorizontalFlow, isSelectable, labelFor } from './dom.js';

/** Which side of the reference element the drop lands on. */
export type DropSide = 'before' | 'after' | 'inside';

/** The decision a previous hit test reached, replayed to keep the next one stable. */
export interface DropDecision {
  reference: HTMLElement;
  side: DropSide;
}

export interface DropTarget {
  parent: Node;
  before: Node | null;
  /** Human description of the pending drop, shown in the drag chip. */
  hint: string;
  /** What the decision was made against, so the caller can feed it back in. */
  decision: DropDecision;
}

/**
 * How far past an element's midpoint the pointer must travel to flip sides.
 *
 * Proportional to the element, because a 24px chip and a 600px hero need
 * different deadzones, but clamped so neither extreme becomes unusable.
 */
function stickyBand(extent: number): number {
  return Math.min(24, Math.max(6, extent * 0.15));
}

/**
 * Where a drop at (x, y) should land.
 *
 * Three decisions make dragging feel right. First, hit-testing walks the whole
 * stack at the pointer rather than taking the topmost element: while dragging,
 * the element's former neighbours frequently overlap the gap the user is aiming
 * at, and the topmost hit is often the wrong answer. Second, the before/after
 * decision is made along the container's own flow axis, so the gesture reads the
 * same whether the parent lays its children out in a row or a column. Third, that
 * decision is sticky: once a side has been chosen for a given element, the pointer
 * has to commit to the other half rather than merely graze the midpoint.
 *
 * The stickiness is what stops the loop that made this feel broken. Applying a
 * move reflows the page, which moves the midpoint the decision was based on,
 * which flips the decision, which reflows again. A deadzone around the midpoint
 * breaks that cycle without the user ever noticing it is there.
 *
 * Pure geometry, deliberately free of editor state, so it can be reasoned about
 * and exercised on its own. `null` means "no opinion" — the caller should keep
 * whatever placement it already has.
 */
export function findDropTarget(
  dragged: HTMLElement,
  x: number,
  y: number,
  held?: DropDecision | null,
): DropTarget | null {
  for (const candidate of document.elementsFromPoint(x, y)) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate === dragged || dragged.contains(candidate)) continue;
    if (!isSelectable(candidate)) continue;
    if (candidate === document.body) break;

    const parent = candidate.parentNode;
    if (!parent) continue;

    // An empty container big enough to aim at is almost always meant as a target
    // to drop *into*, not next to.
    if (acceptsChildren(candidate) && isEmptyContainer(candidate) && isLargeEnough(candidate)) {
      return {
        parent: candidate,
        before: null,
        hint: `Into ${labelFor(candidate)}`,
        decision: { reference: candidate, side: 'inside' },
      };
    }

    const box = candidate.getBoundingClientRect();
    const parentEl = candidate.parentElement;
    const horizontal = parentEl ? isHorizontalFlow(parentEl) : false;
    const extent = horizontal ? box.width : box.height;
    const distance = (horizontal ? x - box.left : y - box.top) - extent / 2;

    let after = distance > 0;
    // Inside the deadzone, keep the side already chosen for this same element.
    if (Math.abs(distance) < stickyBand(extent) && held?.reference === candidate) {
      if (held.side === 'inside') return null;
      after = held.side === 'after';
    }

    return {
      parent,
      before: after ? candidate.nextSibling : candidate,
      hint: `${after ? 'After' : 'Before'} ${labelFor(candidate)}`,
      decision: { reference: candidate, side: after ? 'after' : 'before' },
    };
  }

  // Below everything: append to the end of the document.
  if (y > innerHeight * 0.9) {
    return {
      parent: document.body,
      before: null,
      hint: 'At the end of the page',
      decision: { reference: document.body, side: 'inside' },
    };
  }
  return null;
}

/** True when two targets resolve to the same slot. */
export function sameSlot(a: DropTarget, b: DropTarget): boolean {
  return a.parent === b.parent && a.before === b.before;
}

/** Big enough that the pointer is plausibly aiming inside it, not past it. */
function isLargeEnough(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  return box.width > 24 && box.height > 24;
}

/**
 * Truly empty: no element children *and* no text.
 *
 * Checking `children.length` alone counted every card and paragraph as an empty
 * container, because their content is a text node. Dragging over a paragraph then
 * swallowed the element into it, which is essentially never the intent and was
 * the most jarring thing about the old gesture.
 */
function isEmptyContainer(el: HTMLElement): boolean {
  return el.children.length === 0 && !el.textContent?.trim();
}
