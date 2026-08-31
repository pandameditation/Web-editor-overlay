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
  /**
   * Called after each scroll step so the drop target can be re-read under the pointer.
   *
   * Given the position the scroll was worked out from, clamped into the window. A replay is not
   * a fresh event and must not be able to change what the drag thinks the *user* did: reporting
   * a stale position that had fallen outside a shrunken viewport put the drag into its
   * about-to-be-abandoned state and left it there, since every later replay said the same thing.
   */
  moved: (at: { x: number; y: number }) => void;
  /**
   * True while the drag is in its "release to abandon" state, which is the caller's own
   * judgement about the pointer having left the window rather than a second guess made here.
   */
  suspended: () => boolean;
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

/** How long the pointer has to stay in the band to earn ordinary full speed, and where it starts. */
const WARMUP_MS = 850;
const WARMUP_FLOOR = 0.2;

/**
 * And then it keeps building, in gears, for someone who is clearly going a long way.
 *
 * Ordinary full speed is tuned for placing something a screen or two away. Held right against the
 * edge, the intent is different — the target is nowhere near, and the only thing the gesture can
 * still express is "further" — so each further three seconds of holding roughly doubles what the
 * one before it offered. Three seconds says "not close"; nine says "the other end of the
 * document", and the ceiling is high enough to get there.
 *
 * Gears rather than one long ramp because the useful speeds are far apart. A single curve to the
 * top would rush through everything in the middle, and those middle rates are the ones that put
 * something a few screens away — which is most drags.
 *
 * Every join is smooth, and that is designed rather than lucky. The warm-up's ease flattens to
 * zero slope as it completes, and each gear's ease starts and ends at zero slope, so no boundary
 * anywhere has a kink in it. A step in acceleration is felt as the page lurching, which is
 * precisely the impression these ramps exist to avoid.
 */
const GEARS: readonly { at: number; gain: number }[] = [
  { at: 3000, gain: 3 },
  { at: 6000, gain: 6 },
  { at: 9000, gain: 12 },
];
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

    const within = { x: clamp(pointer.x, innerWidth), y: clamp(pointer.y, innerHeight) };
    const wanted = hooks.suspended() ? null : edgePush(within);
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

    const held = now - since;
    // Eased out, so the build-up is felt early and has clearly finished by the end rather
    // than creeping up on the user for the whole second.
    const warm = WARMUP_FLOOR + (1 - WARMUP_FLOOR) * easeOut(clamp01(held / WARMUP_MS));
    /*
     * Which gear the hold has earned, once the warm-up has run its course. Gated on depth
     * below, per axis: this is the reward for holding against the edge, and a pointer resting
     * in the shallows has not asked for it.
     */
    const gain = gearFor(held);

    let scrolled = false;
    for (const axis of ['x', 'y'] as const) {
      const push = wanted[axis];
      if (!push) continue;
      const target = scrollableFor(within, axis, Math.sign(push));
      if (!target) continue;
      // `push` carries the sign; its magnitude is the eased depth into the band.
      const into = Math.abs(push);
      const speed = SLOWEST + (FASTEST - SLOWEST) * ease(into);
      /*
       * Depth decides how much of the sustained gain is on offer, linearly.
       *
       * Linearly and not through `ease`, because `ease` has already shaped the base speed —
       * compounding the two would leave the gain unreachable anywhere but the outermost pixel,
       * which is not somewhere a hand can be asked to stay for three seconds.
       */
      const sustained = 1 + (gain - 1) * into;
      debt[axis] += Math.sign(push) * speed * warm * sustained * dt;
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
    if (scrolled) hooks.moved(within);
  };

  frame = requestAnimationFrame(step);
  return stop;
}

/**
 * How hard the pointer is pushing at each edge, as a signed depth from 0 to 1, or null for
 * neither edge.
 *
 * The position is clamped into the window rather than rejected for being outside it. Whether the
 * user has left is the drag's own call — it has the live events and a state for it — and making
 * that judgement a second time from geometry got it wrong: the viewport can shrink mid-gesture,
 * and a pointer resting at the old bottom edge then sits past the new one without having moved
 * at all. Read as departure, that killed the scrolling for the rest of the drag while the user
 * was still holding against the edge waiting for it.
 */
function edgePush(pointer: { x: number; y: number }): { x: number; y: number } | null {
  const push = { x: depth(pointer.x, innerWidth), y: depth(pointer.y, innerHeight) };
  return push.x || push.y ? push : null;
}

function clamp(at: number, size: number): number {
  return at < 0 ? 0 : at > size ? size : at;
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

/**
 * The multiplier a hold of this length has reached, interpolated inside its gear.
 *
 * Each segment runs from where the previous one left off, so the value is continuous, and each
 * uses an ease that is flat at both ends, so the rate of change is continuous too.
 */
function gearFor(held: number): number {
  let fromAt = WARMUP_MS;
  let fromGain = 1;
  for (const gear of GEARS) {
    if (held < gear.at) {
      const t = easeInOut(clamp01((held - fromAt) / (gear.at - fromAt)));
      return fromGain + (gear.gain - fromGain) * t;
    }
    fromAt = gear.at;
    fromGain = gear.gain;
  }
  return fromGain;
}

/** Fine control near the band's inner edge, real speed only at the outer few pixels. */
function ease(depth: number): number {
  return depth * depth * depth;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Flat at both ends, so a ramp using it neither starts nor finishes with a jolt. */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
