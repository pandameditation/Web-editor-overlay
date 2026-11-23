/**
 * The animation between the floating and the pinned layout.
 *
 * Pinning turns the pill into the bar across the top and slides each floating panel flush to its
 * edge, while the page cross-fades to its new width between them; unpinning plays it backwards.
 * It is the prototypes' View Transition, rebuilt for a shadow tree: Chrome ignores a
 * `view-transition-name` inside a shadow root (measured in Chrome 157: neither a nested element
 * nor a shadow host is captured), so the bar and the panels cannot be groups of their own.
 * Instead:
 *
 * - the overlay's host, a fixed full-window box in the document, is the one named group. Its new
 *   image is live, so the boxes inside it are morphed with plain Web Animations: each box goes
 *   from where it was to where it is now (position, size, corner radius);
 * - its old image fades out quickly over that, which is the cross-fade between the pill's and
 *   the bar's contents;
 * - the root cross-fades as any view transition does, which is the page settling between the
 *   panels instead of jumping.
 *
 * The page sheet (index.ts) times all of it, scoped to the `heo-layout` transition type so a
 * page's own view transitions are left as they were. Without View Transitions the boxes still
 * morph and the page simply re-lays out; with reduced motion nothing animates.
 */

/** Carried by the overlay's host for the length of a switch, and only then. */
export const CHROME_TRANSITION_NAME = 'heo-chrome';
/** The view transition type the page sheet scopes its timing to. */
export const LAYOUT_TRANSITION_TYPE = 'heo-layout';

const DURATION = 260;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

interface Shape {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
}

/** The boxes that move: the toolbar's bar and each open panel's box, by a stable key. */
function boxes(overlay: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  const root = overlay.shadowRoot;
  if (!root) return found;
  const bar = root.querySelector('heo-toolbar')?.shadowRoot?.querySelector<HTMLElement>('.bar');
  if (bar) found.set('bar', bar);
  for (const dock of Array.from(root.querySelectorAll<HTMLElement>('heo-dock'))) {
    const box = dock.shadowRoot?.querySelector<HTMLElement>('.dock');
    if (box) found.set(`dock:${dock.getAttribute('side') ?? ''}`, box);
  }
  return found;
}

function shapeOf(el: HTMLElement): Shape {
  const box = el.getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width, height: box.height, radius: getComputedStyle(el).borderRadius };
}

function frameOf(shape: Shape, from: Shape): Keyframe {
  return {
    translate: `${from.left - shape.left}px ${from.top - shape.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    // The floating bar is capped to the window less a margin; mid-morph it is wider than that.
    maxWidth: 'none',
    borderRadius: from.radius,
  };
}

let active: ViewTransition | null = null;

/**
 * Apply a layout switch, animated. `apply` changes the state; `settle` resolves once the chrome
 * has rendered it. Resolves when the animation is over, with the final geometry in place.
 */
export async function morphLayout(
  overlay: HTMLElement,
  apply: () => void,
  settle: () => Promise<void>,
): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply();
    await settle();
    return;
  }
  // Measured before anything changes, so a switch made mid-morph starts from where the boxes are.
  const before = new Map(Array.from(boxes(overlay), ([key, el]) => [key, shapeOf(el)]));
  const running: Animation[] = [];

  const update = async (): Promise<void> => {
    apply();
    await settle();
    for (const [key, el] of boxes(overlay)) {
      // A panel's slide-in is for opening it, not for a layout change: unpinning restarts it,
      // because the pinned rule sets its animation to none. Finished, it is not replayed.
      for (const animation of el.getAnimations()) {
        if (animation instanceof CSSAnimation) animation.finish();
      }
      const from = before.get(key);
      if (!from) continue;
      const to = shapeOf(el);
      if (from.left === to.left && from.top === to.top && from.width === to.width && from.height === to.height) continue;
      running.push(el.animate([frameOf(to, from), frameOf(to, to)], { duration: DURATION, easing: EASE }));
    }
  };

  const start = typeof document.startViewTransition === 'function'
    ? document.startViewTransition.bind(document)
    : null;
  if (!start) {
    await update();
  } else {
    overlay.style.setProperty('view-transition-name', CHROME_TRANSITION_NAME);
    let transition: ViewTransition;
    try {
      transition = start({ update, types: [LAYOUT_TRANSITION_TYPE] });
    } catch {
      // A browser with View Transitions but not their options object: untimed, still a morph.
      transition = start(update);
    }
    active = transition;
    // A switch made mid-morph skips this one, which rejects its ready promise; nothing waits on it.
    transition.ready.catch(() => undefined);
    try {
      await transition.updateCallbackDone;
      await transition.finished;
    } catch {
      // Skipped (another switch, a hidden tab): the update has still run.
    } finally {
      if (active === transition) {
        active = null;
        overlay.style.removeProperty('view-transition-name');
      }
    }
  }
  await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
}
