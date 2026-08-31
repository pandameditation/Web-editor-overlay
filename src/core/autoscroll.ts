/**
 * Edge scrolling for a drag that reaches past what is on screen.
 *
 * The gesture this serves is "take this element there", where *there* is off screen. The pointer
 * is already holding something, so it cannot also reach for a scrollbar or a wheel: pushing
 * towards the edge has to be the whole instruction. Everything here is about making that one
 * instruction expressive enough to mean both "a little" and "a long way".
 *
 * Four things do that work, and each one exists because leaving it out feels wrong:
 *
 * - **Depth.** How far into the edge band the pointer is, eased rather than linear, so the first
 *   third of the band is a crawl and the last few pixels are a sprint. Linear depth gives no
 *   usable slow speed: by the time the movement is visible, it is already too fast to aim.
 *
 * - **Dwell.** Speed also builds while the pointer stays in the band, from a fifth of the target
 *   rate up to all of it. Without it, clipping a corner on the way somewhere else launches the
 *   page, and the user has lost their place; with it, a brief overshoot costs a few pixels.
 *
 * - **Forgiveness.** Leaving the band briefly does not reset the dwell. Hands shake, and a
 *   gesture that has been held for a second should not be demoted for one frame of jitter.
 *
 * - **Continuity.** After every step, whatever depends on what is under the pointer is told to
 *   look again. The pointer is not moving — the page is moving underneath it — and a drop
 *   indicator that only updates on `pointermove` freezes while the content slides past it,
 *   which reads as the editor having lost track of the drag.
 *
 * Velocity is in pixels per second and integrated against real elapsed time, so it behaves the
 * same on a 60Hz laptop and a 120Hz display.
 */

/** How the caller is asked about, and told about, the drag in flight. */
export interface EdgeScrollHooks {
  /** Where the pointer is, in viewport coordinates, or null when the drag is over. */
  pointer: () => { x: number; y: number } | null;
  /** Called after each scroll step so the drop target can be re-read under the pointer. */
  moved: () => void;
}

/**
 * The band's size, and why it is measured from the viewport rather than fixed.
 *
 * A fixed band is either unreachably thin on a large display or most of the screen on a small
 * one. A share of the dimension holds its meaning at any size, and the cap stops it from
 * swallowing a short window, where the band would otherwise overlap in the middle and the page
 * would drift with the pointer at rest.
 */
const BAND_SHARE = 0.14;
const BAND_MAX = 140;
const BAND_MIN = 44;

/** Slow enough to place something precisely, at the very inner edge of the band. */
const SLOWEST = 30;
/** Fast enough to cross a long document without lifting the pointer, at the outer edge. */
const FASTEST = 1600;

/** How long the pointer has to stay in the band to earn full speed, and where it starts. */
const WARMUP_MS = 850;
const WARMUP_FLOOR = 0.2;
/** How long a slip out of the band is forgiven before the warm-up is given up on. */
const FORGIVE_MS = 140;

export function startEdgeScroll(hooks: EdgeScrollHooks): () => void {
  let frame = 0;
  let last = performance.now();
  /** When the pointer entered the band, or null while it is outside one. */
  let since: number | null = null;
  /** When it left, so a brief slip can be forgiven rather than punished. */
  let leftAt: number | null = null;
  /*
   * Fractions of a pixel are carried over instead of discarded.
   *
   * At the slow end a frame's worth of travel is well under a pixel, and rounding each frame
   * on its own rounds it to nothing — the band's gentlest setting would do nothing at all.
   */
  const debt = { x: 0, y: 0 };

  const stop = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const step = (now: number): void => {
    frame = requestAnimationFrame(step);
    // Clamped, because a backgrounded tab resumes with a gap that would otherwise arrive as
    // one enormous jump the moment the user comes back to it.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const pointer = hooks.pointer();
    if (!pointer) {
      stop();
      return;
    }

    const wanted = edgePush(pointer);
    if (!wanted) {
      /*
       * Out of the band. The warm-up is kept for a moment in case this is jitter, and the
       * pointer's absence from the band is what eventually clears it.
       */
      if (since !== null) {
        if (leftAt === null) leftAt = now;
        else if (now - leftAt > FORGIVE_MS) {
          since = null;
          leftAt = null;
        }
      }
      debt.x = 0;
      debt.y = 0;
      return;
    }

    if (since === null) since = now;
    leftAt = null;

    const held = (now - since) / WARMUP_MS;
    // Eased out, so the build-up is felt early and has clearly finished by the end rather
    // than creeping up on the user for the whole second.
    const warm = WARMUP_FLOOR + (1 - WARMUP_FLOOR) * easeOut(clamp01(held));

    let scrolled = false;
    for (const axis of ['x', 'y'] as const) {
      const push = wanted[axis];
      if (!push) continue;
      const target = scrollableFor(pointer, axis, Math.sign(push));
      if (!target) continue;
      // `push` carries the sign; its magnitude is the eased depth into the band.
      const speed = SLOWEST + (FASTEST - SLOWEST) * ease(Math.abs(push));
      debt[axis] += Math.sign(push) * speed * warm * dt;
      const whole = Math.trunc(debt[axis]);
      if (!whole) continue;
      debt[axis] -= whole;
      const before = axis === 'y' ? target.scrollTop : target.scrollLeft;
      if (axis === 'y') target.scrollTop = before + whole;
      else target.scrollLeft = before + whole;
      if ((axis === 'y' ? target.scrollTop : target.scrollLeft) !== before) scrolled = true;
    }

    // Only when something actually moved: at a scroll limit there is nothing new under the
    // pointer, and re-planning the drop on every frame for no reason is just work.
    if (scrolled) hooks.moved();
  };

  frame = requestAnimationFrame(step);
  return stop;
}

/**
 * How hard the pointer is pushing at each edge, as a signed depth from 0 to 1.
 *
 * Null when it is in neither band, or when it has left the viewport altogether — off-window is
 * the drag's cancel gesture, and scrolling the page while the user is on their way to abandoning
 * the move would undo the very thing they are trying to get back to.
 */
function edgePush(pointer: { x: number; y: number }): { x: number; y: number } | null {
  if (pointer.x < 0 || pointer.y < 0 || pointer.x > innerWidth || pointer.y > innerHeight) {
    return null;
  }
  const push = {
    x: depth(pointer.x, innerWidth),
    y: depth(pointer.y, innerHeight),
  };
  return push.x || push.y ? push : null;
}

/** Signed depth into the near or far band along one axis, 0 outside both. */
function depth(at: number, size: number): number {
  const band = Math.max(BAND_MIN, Math.min(BAND_MAX, size * BAND_SHARE));
  if (at < band) return -(1 - at / band);
  if (at > size - band) return 1 - (size - at) / band;
  return 0;
}

/**
 * The thing to scroll: the innermost scrollable box under the pointer with room left to give.
 *
 * Under the pointer rather than the dragged element, because a drag over a scrolling panel
 * should scroll that panel and not the page behind it — and it walks outwards when the inner
 * one has hit its limit, so reaching the end of a list carries on into the document instead of
 * stalling with the pointer still pressed at the edge.
 */
function scrollableFor(
  pointer: { x: number; y: number },
  axis: 'x' | 'y',
  sign: number,
): HTMLElement | null {
  const root = document.scrollingElement;
  const under = document.elementFromPoint(pointer.x, pointer.y);
  for (let el = under; el instanceof HTMLElement; el = el.parentElement) {
    // The overlay's own panels are not the page, and are not what a page drag scrolls.
    if (el.closest('html-editor-overlay')) continue;
    if (el !== root && !overflows(el, axis)) continue;
    if (hasRoom(el, axis, sign)) return el;
  }
  return root instanceof HTMLElement && hasRoom(root, axis, sign) ? root : null;
}

/** Whether this element's own overflow lets it scroll on this axis at all. */
function overflows(el: HTMLElement, axis: 'x' | 'y'): boolean {
  const style = getComputedStyle(el);
  const value = axis === 'y' ? style.overflowY : style.overflowX;
  // `hidden` is excluded deliberately. It can be scrolled programmatically, but the author
  // has said this box does not scroll, and moving it would be the editor overruling them.
  return value === 'auto' || value === 'scroll' || value === 'overlay';
}

/** Whether there is anywhere left to go on this axis in this direction. */
function hasRoom(el: HTMLElement, axis: 'x' | 'y', sign: number): boolean {
  const max = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  if (max <= 1) return false;
  const at = axis === 'y' ? el.scrollTop : el.scrollLeft;
  return sign < 0 ? at > 0.5 : at < max - 0.5;
}

/** Fine control near the band's inner edge, real speed only at the outer few pixels. */
function ease(depth: number): number {
  return depth * depth * depth;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
