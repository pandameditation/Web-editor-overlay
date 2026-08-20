import { acceptsChildren, isHorizontalFlow, isOverlayNode, isSelectable, labelFor } from './dom.js';

/** Which side of the reference element the drop lands on. */
export type DropSide = 'before' | 'after' | 'inside';

/** The decision a previous hit test reached, replayed to keep the next one stable. */
export interface DropDecision {
  reference: HTMLElement;
  side: DropSide;
}

/** Where the element would go if the drop happened now. */
export interface DropPlacement {
  parent: Node;
  before: Node | null;
}

/** Carried between pointer samples so the re-parent gestures can be timed. */
export interface DragScope {
  /** The parent whose children are being reordered. */
  home: Node;
  /** Last before/after conclusion, for the sticky midpoint. */
  decision: DropDecision | null;
  /** When the pointer first left the home's frame; null while inside it. */
  leftHomeAt: number | null;
  /** The container the pointer has been resting inside, and since when. */
  dwell: { host: HTMLElement; since: number } | null;
}

export interface DragPlan extends DragScope {
  placement: DropPlacement;
  /** Human description of the pending drop, shown in the drag chip. */
  hint: string;
  /** A re-parent being counted down rather than performed. */
  waiting: 'nest' | 'leave' | null;
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
 * How far inside a container the pointer must be for it to read as "in here".
 *
 * Without this, passing over a container on the way somewhere else counts as
 * aiming into it, and reordering past a card would nest inside it. The edges
 * belong to the gaps between siblings; the middle belongs to the container.
 */
function nestInset(extent: number): number {
  return Math.min(28, Math.max(8, extent * 0.22));
}

/**
 * The plan for one pointer sample of a reorder.
 *
 * The gesture is deliberately narrow: a drag reorders siblings, and nothing else.
 * That constraint is the whole fix for the flicker this used to have — hit-testing
 * the element stack let a drag re-parent itself on any pointer move, and since a
 * re-parent reflows the *ancestors* too, the next sample saw a different page and
 * proposed something else. Reordering within one parent can only move the parent's
 * own children, so the ground under the pointer stays still.
 *
 * Changing parent is therefore a separate, explicit gesture with a dwell on it:
 * rest inside another container to go into it, or leave the current parent's frame
 * and stay out to become a sibling somewhere else. Both cost the same 200-ish ms,
 * so neither can happen by brushing past.
 *
 * Pure: takes the previous scope and a clock, returns the next one. All the timing
 * lives in the caller's state, which makes the whole gesture reproducible.
 */
export function planDrag(
  dragged: HTMLElement,
  scope: DragScope,
  x: number,
  y: number,
  now: number,
  reparentMs: number,
): DragPlan {
  let home = scope.home;
  let leftHomeAt = scope.leftHomeAt;
  let dwell = scope.dwell;
  let waiting: 'nest' | 'leave' | null = null;

  const insideHome = containsPoint(home, x, y);

  if (insideHome) {
    leftHomeAt = null;
    // Descending: resting well inside a container that is not the current parent.
    const host = hostUnder(dragged, x, y, home);
    if (host) {
      if (dwell?.host !== host) dwell = { host, since: now };
      if (now - dwell.since >= reparentMs) {
        home = host;
        dwell = null;
      } else {
        waiting = 'nest';
      }
    } else {
      dwell = null;
    }
  } else {
    // Leaving: the pointer has to stay out, not merely cross the boundary.
    dwell = null;
    leftHomeAt ??= now;
    if (now - leftHomeAt >= reparentMs) {
      const next = siblingHomeUnder(dragged, x, y, home);
      if (next && next !== home) {
        home = next;
        leftHomeAt = null;
      } else {
        // Nothing to move into out here; keep counting rather than snapping back.
        waiting = 'leave';
      }
    } else {
      waiting = 'leave';
    }
  }

  const slot = slotWithin(home, dragged, x, y, scope.decision);
  const hint =
    waiting === 'nest' && dwell
      ? `Hold to move inside ${labelFor(dwell.host)}`
      : waiting === 'leave'
        ? `Hold outside ${labelFor(asElement(home))} to move it out`
        : slot.hint;

  return {
    home,
    placement: slot.placement,
    decision: slot.decision,
    hint,
    leftHomeAt,
    dwell,
    waiting,
  };
}

/**
 * Where the element sits among `home`'s children, from the pointer's position.
 *
 * Projection onto the parent's own children rather than a hit test on the element
 * stack. Two things fall out of that: only siblings can ever be proposed, and a
 * pointer in the gap between two items still resolves to a slot instead of to
 * whatever happens to be painted underneath.
 *
 * The nearest child is chosen by distance to its box, then before or after it
 * along the container's flow axis, so rows, columns, grids and wrapped layouts all
 * behave without special cases.
 */
export function slotWithin(
  home: Node,
  dragged: HTMLElement,
  x: number,
  y: number,
  held?: DropDecision | null,
): { placement: DropPlacement; decision: DropDecision | null; hint: string } {
  const homeEl = asElement(home);
  const children = orderableChildren(home, dragged);

  if (!children.length) {
    return {
      placement: { parent: home, before: null },
      decision: homeEl ? { reference: homeEl, side: 'inside' } : null,
      hint: `Into ${labelFor(homeEl)}`,
    };
  }

  let nearest = children[0];
  let best = Infinity;
  for (const child of children) {
    const distance = distanceToBox(child.getBoundingClientRect(), x, y);
    if (distance < best) {
      best = distance;
      nearest = child;
    }
  }

  const box = nearest.getBoundingClientRect();
  const horizontal = homeEl ? isHorizontalFlow(homeEl) : false;
  const extent = horizontal ? box.width : box.height;
  const distance = (horizontal ? x - box.left : y - box.top) - extent / 2;

  let after = distance > 0;
  // Inside the deadzone, keep the side already chosen for this same element: a
  // move reflows the siblings, which moves the midpoint the decision was based on.
  if (Math.abs(distance) < stickyBand(extent) && held?.reference === nearest) {
    after = held.side === 'after';
  }

  return {
    placement: { parent: home, before: after ? nearest.nextSibling : nearest },
    decision: { reference: nearest, side: after ? 'after' : 'before' },
    hint: `${after ? 'After' : 'Before'} ${labelFor(nearest)}`,
  };
}

/** Children of `home` that could take the dragged element's place. */
function orderableChildren(home: Node, dragged: HTMLElement): HTMLElement[] {
  const parent = home as ParentNode;
  if (!parent.children) return [];
  const out: HTMLElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement) && !(child instanceof SVGElement)) continue;
    const el = child as HTMLElement;
    if (el === dragged || dragged.contains(el)) continue;
    if (isOverlayNode(el) || !isSelectable(el)) continue;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 && box.height <= 0) continue;
    out.push(el);
  }
  return out;
}

/**
 * The deepest container under the pointer that the element could move into.
 *
 * Must be strictly inside `home` — going up a level is the other gesture — and the
 * pointer must be well inside it rather than near an edge, so passing over a
 * container on the way past does not read as aiming into it.
 */
function hostUnder(dragged: HTMLElement, x: number, y: number, home: Node): HTMLElement | null {
  for (const candidate of document.elementsFromPoint(x, y)) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate === dragged || dragged.contains(candidate)) continue;
    if (isOverlayNode(candidate) || !isSelectable(candidate)) continue;
    if (candidate === home) return null;
    if (!home.contains(candidate)) continue;
    if (!canHostChildren(candidate)) continue;
    const box = candidate.getBoundingClientRect();
    const inset = Math.min(nestInset(box.width), box.width / 2);
    const insetY = Math.min(nestInset(box.height), box.height / 2);
    if (x < box.left + inset || x > box.right - inset) continue;
    if (y < box.top + insetY || y > box.bottom - insetY) continue;
    return candidate;
  }
  return null;
}

/** The parent to reorder within once the pointer has committed to leaving home. */
function siblingHomeUnder(
  dragged: HTMLElement,
  x: number,
  y: number,
  home: Node,
): Node | null {
  for (const candidate of document.elementsFromPoint(x, y)) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate === dragged || dragged.contains(candidate)) continue;
    if (isOverlayNode(candidate) || !isSelectable(candidate)) continue;
    // Landing on the old parent's own box means the pointer is back in bounds.
    if (candidate === home) return null;
    // A container the pointer is inside is a place to go into; anything else means
    // "beside this", which is its parent.
    const target = canHostChildren(candidate) ? candidate : candidate.parentNode;
    if (!target || target === home) continue;
    if (dragged.contains(target as Node)) continue;
    return target;
  }
  // Past the end of everything: the document itself is the parent.
  if (y > innerHeight * 0.9) return document.body;
  return null;
}

/**
 * True when children can meaningfully be put inside this element.
 *
 * A paragraph or a heading technically accepts children, but dropping a card into
 * one is never the intent — its content is a run of text, not a layout. Requiring
 * either existing element children or a genuinely empty box separates containers
 * from leaves without needing a tag list.
 */
export function canHostChildren(el: HTMLElement): boolean {
  if (!acceptsChildren(el)) return false;
  if (el.children.length > 0) return true;
  if (el.textContent?.trim()) return false;
  const box = el.getBoundingClientRect();
  return box.width > 24 && box.height > 24;
}

/** True when (x, y) is within the element's frame. A non-element home is the page. */
export function containsPoint(home: Node, x: number, y: number): boolean {
  const el = asElement(home);
  if (!el || el === document.body || el === document.documentElement) {
    return x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
  }
  const box = el.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** Zero inside the box, otherwise the shortest distance to its edge. */
function distanceToBox(box: DOMRect, x: number, y: number): number {
  const dx = Math.max(box.left - x, 0, x - box.right);
  const dy = Math.max(box.top - y, 0, y - box.bottom);
  return Math.hypot(dx, dy);
}

function asElement(node: Node | null): HTMLElement | null {
  return node instanceof HTMLElement ? node : null;
}

/** True when two placements resolve to the same slot. */
export function samePlacement(a: DropPlacement, b: DropPlacement): boolean {
  return a.parent === b.parent && a.before === b.before;
}
