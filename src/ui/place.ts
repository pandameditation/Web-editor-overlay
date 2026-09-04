/**
 * Where an anchored popover goes.
 *
 * Six controls grew their own copy of this — the value field, the search field, the selector field,
 * the two add-declaration popups and the extract dialog's name list — and every copy carried the
 * same defects, because they were written by copying each other:
 *
 * - The "below" branch was never clamped. `top = anchor.bottom + 5` with no upper bound, so an
 *   anchor low in the viewport put the popover partly or wholly under the fold. Flipping only
 *   happened when there was *more* room above, which is not the same question as whether it fits.
 * - Half of them set a `max-height` and half did not, so the ones that did not could be taller than
 *   the screen with their footer — the row holding Apply — off the bottom.
 * - None of them coped with an anchor scrolled out of view, which happens routinely: these live in
 *   a scrolling panel and the anchor can be above or below it.
 *
 * The rule here is: always fully on screen, and otherwise as close to where it was aiming as
 * possible. Fitting wins over proximity, because a popover the user cannot see all of is not a
 * placement problem, it is a broken control.
 */

export interface PlaceRequest {
  /** The element the popover belongs to, in viewport coordinates. */
  anchor: DOMRect;
  /**
   * The popover's own measured box, when it has one.
   *
   * Absent on the very first pass: the popover does not exist until it renders, which is why every
   * caller places twice — once to get it roughly right, once it can be measured.
   */
  popup?: DOMRect | null;
  /** Height to assume before it can be measured. */
  estimate?: number;
  /** Narrowest useful width. The popover is at least this wide, and at least as wide as its anchor. */
  minWidth?: number;
  /** Gap between anchor and popover. */
  gap?: number;
  /** Distance kept from every viewport edge. */
  margin?: number;
}

export interface Placement {
  top: number;
  left: number;
  width: number;
  /** The tallest it may be here. Callers must apply it, or the guarantee does not hold. */
  maxHeight: number;
  side: 'above' | 'below';
}

/**
 * The smallest height worth offering.
 *
 * Below this a list is not usable and a form has no room for its buttons, so a viewport this short
 * gets a popover that overlaps its anchor rather than one squeezed to nothing. Overlapping is
 * recoverable — the user can still read and press things.
 */
const LEAST_HEIGHT = 132;

export function placeAnchored(request: PlaceRequest): Placement {
  const { anchor, popup, estimate = 240, minWidth = 200, gap = 5, margin = 8 } = request;

  /* Width first: it is independent of the vertical decision, and the height may depend on it. */
  const roomWide = Math.max(LEAST_HEIGHT, innerWidth - margin * 2);
  const width = Math.min(Math.max(anchor.width, minWidth), roomWide);
  const left = clamp(anchor.left, margin, Math.max(margin, innerWidth - width - margin));

  /*
   * How much room each side has, measured from the anchor as it actually sits — which may be off
   * screen, in which case one of these goes negative and the other wins by default.
   */
  const below = innerHeight - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const wanted = popup?.height || estimate;

  /*
   * Below unless it does not fit and above fits better.
   *
   * Preferring below is what makes the popover feel attached to what opened it; the previous rule
   * compared the two spaces without ever asking whether the content fits in either, so a popover
   * that would have fitted below flipped above and vice versa.
   */
  const side: 'above' | 'below' = below >= wanted || below >= above ? 'below' : 'above';
  const room = side === 'below' ? below : above;
  const maxHeight = Math.max(LEAST_HEIGHT, Math.min(wanted, Math.max(room, LEAST_HEIGHT)));

  // The height it will actually occupy, which is what the top has to be clamped against.
  const height = Math.min(wanted, maxHeight);
  const ideal = side === 'below' ? anchor.bottom + gap : anchor.top - gap - height;
  const top = clamp(ideal, margin, Math.max(margin, innerHeight - height - margin));

  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(width),
    maxHeight: Math.round(maxHeight),
    side,
  };
}

/** The same, as the inline style string every one of these popovers already uses. */
export function anchoredStyle(request: PlaceRequest): string {
  const at = placeAnchored(request);
  return `top:${at.top}px;left:${at.left}px;width:${at.width}px;max-height:${at.maxHeight}px`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
