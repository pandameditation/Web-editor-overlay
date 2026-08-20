import { DRAGGING_ATTR, DRAG_TIMING } from './constants.js';
import { isOverlayNode } from './dom.js';

/**
 * Position animation for structural edits.
 *
 * Moving a node in the DOM is instantaneous, which is exactly what makes drag
 * reordering feel violent: half the page jumps a hundred pixels between two
 * pointer events. The fix is the FLIP technique — measure before the change,
 * measure after, then animate each element from where it *was* to where it now
 * *is*. The layout is always the real one; only the paint catches up.
 *
 * Two details make it safe to use on a page the editor does not own. Animations
 * composite onto the element's own transform rather than replacing it, so a card
 * that is already translated keeps its offset. And an in-flight animation is
 * measured before being cancelled, so a second move mid-glide continues from
 * where the element visibly is instead of snapping.
 */

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const FLIP_ID = 'heo-flip';
const DROP_ID = 'heo-drop';

/** True when the user asked for less motion; every helper here becomes a no-op. */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Every element a structural change between these parents could displace.
 *
 * Children of both the old and the new parent, which is where reflow is visible.
 * Going deeper would mean animating descendants that move only because their
 * ancestor did, and they are already carried along by it.
 *
 * The overlay's own host is skipped. It is a child of `<body>`, so any drag at
 * body level would otherwise put the entire editor chrome in the animation set.
 */
export function neighbourhood(...parents: Array<Node | null | undefined>): HTMLElement[] {
  const out = new Set<HTMLElement>();
  for (const parent of parents) {
    if (!parent) continue;
    const children = (parent as ParentNode).children;
    if (!children) continue;
    for (const child of Array.from(children)) {
      if (child instanceof HTMLElement && !isOverlayNode(child)) out.add(child);
    }
  }
  return [...out];
}

/**
 * Where these elements are right now.
 *
 * `getBoundingClientRect` reports the transformed box, so an element part-way
 * through a previous glide is captured where it actually appears. That is what
 * lets consecutive moves chain smoothly.
 */
export function captureRects(elements: Iterable<HTMLElement>): Map<HTMLElement, DOMRect> {
  const rects = new Map<HTMLElement, DOMRect>();
  if (reducedMotion()) return rects;
  for (const el of elements) rects.set(el, el.getBoundingClientRect());
  return rects;
}

/** Animate each element from its captured position to its current one. */
export function playFlip(
  before: Map<HTMLElement, DOMRect>,
  options: { duration?: number } = {},
): void {
  if (!before.size || reducedMotion()) return;
  const duration = options.duration ?? DRAG_TIMING.flip;

  for (const [el, first] of before) {
    if (!el.isConnected) continue;
    // Cancel after the capture, before the final measurement: the element then
    // reports its untransformed resting place, which is the glide's end point.
    for (const animation of el.getAnimations()) {
      if (animation.id === FLIP_ID) animation.cancel();
    }
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
      { duration, easing: EASE, composite: 'add', id: FLIP_ID },
    );
  }
}

/**
 * Turn the drag preview back into a solid element.
 *
 * The element is already in its final position — it moved there during the drag —
 * so the only thing left is to fade the preview treatment out. Animating opacity
 * back to the element's *own* computed value, read after the preview attribute is
 * gone, avoids the pop that a hard-coded `1` would cause on anything the page
 * deliberately renders translucent.
 */
export function settleDrop(el: HTMLElement, duration = DRAG_TIMING.drop): void {
  el.removeAttribute(DRAGGING_ATTR);
  if (reducedMotion()) return;
  for (const animation of el.getAnimations()) {
    if (animation.id === DROP_ID) animation.cancel();
  }
  const own = getComputedStyle(el).opacity || '1';
  el.animate([{ opacity: '0.45' }, { opacity: own }], { duration, easing: EASE, id: DROP_ID });
}
