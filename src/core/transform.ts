/**
 * The geometry and arithmetic behind dragging an element's own handles.
 *
 * Direct manipulation is a translation problem, not a pointer problem. What the user does is
 * move a corner across the screen; what has to come out the other end is a CSS declaration —
 * and between those two lie four conversions that are each easy to get subtly wrong:
 *
 * - **Screen space to element space.** A rotated element's `getBoundingClientRect` is the
 *   axis-aligned box *around* it, which is not its box. Dragging its right-hand handle has to
 *   widen it along its own axis, not the screen's, so pointer deltas are projected through the
 *   inverse of its transform.
 * - **Rendered size to declared size.** `width` means the content box unless `box-sizing` says
 *   otherwise, so the number that produces a given rendered width depends on padding and
 *   borders the user is not thinking about.
 * - **Pixels to the unit that was already there.** This is the objection the selection layer
 *   was written to avoid: handles that emit hard pixels are hostile to a design system. An
 *   element declaring `left: 10%` should still declare a percentage after being dragged, so the
 *   unit is read first and the result is converted back into it.
 * - **Resize to position, when the element is rotated.** A transform rotates about the element's
 *   centre, so changing its size moves that centre and the whole shape swings. Keeping the
 *   corner the user is *not* dragging visually still requires a compensating offset, which has
 *   a closed form and is applied here rather than being left as a mystery drift.
 *
 * Everything in this file is a pure function of numbers and strings. Nothing reads or writes the
 * DOM except the three `read*` helpers at the top, which exist to gather a snapshot once at the
 * start of a gesture — after which the gesture runs entirely on that snapshot, so a page
 * reflowing underneath cannot make the arithmetic drift.
 */

/** Which handle is being dragged. Compass points, as every design tool names them. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

/** Which edges a handle moves. */
const EDGES: Record<ResizeHandle, { top: boolean; right: boolean; bottom: boolean; left: boolean }> = {
  nw: { top: true, right: false, bottom: false, left: true },
  n: { top: true, right: false, bottom: false, left: false },
  ne: { top: true, right: true, bottom: false, left: false },
  e: { top: false, right: true, bottom: false, left: false },
  se: { top: false, right: true, bottom: true, left: false },
  s: { top: false, right: false, bottom: true, left: false },
  sw: { top: false, right: false, bottom: true, left: true },
  w: { top: false, right: false, bottom: false, left: true },
};

/** The cursor for each handle, rotated with the element so it points the right way. */
const HANDLE_ANGLE: Record<ResizeHandle, number> = {
  n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
};

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A 2×2 linear map plus the origin it acts about, which is all a CSS transform is here. */
export interface Linear {
  a: number;
  b: number;
  c: number;
  d: number;
}

export const IDENTITY: Linear = { a: 1, b: 0, c: 0, d: 1 };

/* -------------------------------------------------------------------------- */
/* Reading the element                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The element's transform as a linear map, ignoring its translation.
 *
 * Translation is deliberately dropped. It shifts where the element is drawn and has no bearing
 * on either question this module asks of the matrix — which way the element's own axes point,
 * and how a screen delta maps onto them.
 */
export function linearOf(transform: string): Linear {
  const raw = transform.trim();
  if (!raw || raw === 'none') return IDENTITY;
  const inside = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')'));
  const parts = inside.split(',').map((part) => Number.parseFloat(part));
  if (raw.startsWith('matrix3d(')) {
    // Columns 1 and 2 of a 4×4, which are the 2D components of it.
    if (parts.length < 6 || parts.some(Number.isNaN)) return IDENTITY;
    return { a: parts[0], b: parts[1], c: parts[4], d: parts[5] };
  }
  if (raw.startsWith('matrix(')) {
    if (parts.length < 4 || parts.some(Number.isNaN)) return IDENTITY;
    return { a: parts[0], b: parts[1], c: parts[2], d: parts[3] };
  }
  return IDENTITY;
}

/** True when the map does nothing, so every rotation-aware branch can be skipped. */
export function isIdentity(m: Linear): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
}

/** The rotation the map carries, in degrees. Meaningless for a skewed matrix, as CSS is. */
export function angleOf(m: Linear): number {
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

/** Apply the map about the origin `o`. */
export function apply(m: Linear, p: Point, o: Point): Point {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return { x: o.x + m.a * dx + m.c * dy, y: o.y + m.b * dx + m.d * dy };
}

/**
 * A screen delta expressed in the element's own axes.
 *
 * The whole reason dragging the right-hand handle of a rotated element widens it rather than
 * shearing it sideways. Falls back to the raw delta for a degenerate matrix, which is the safe
 * direction to be wrong in: the drag feels wrong rather than producing NaN.
 */
export function toLocal(m: Linear, d: Point): Point {
  const det = m.a * m.d - m.b * m.c;
  if (!det || !Number.isFinite(det)) return d;
  return {
    x: (m.d * d.x - m.c * d.y) / det,
    y: (m.a * d.y - m.b * d.x) / det,
  };
}

/** `transform-origin` in element coordinates, from its computed two-value form. */
export function originOf(computed: CSSStyleDeclaration, box: Box): Point {
  const parts = computed.transformOrigin.split(' ').map((part) => Number.parseFloat(part));
  const x = Number.isFinite(parts[0]) ? parts[0] : box.width / 2;
  const y = Number.isFinite(parts[1]) ? parts[1] : box.height / 2;
  return { x, y };
}

/**
 * The element's border box as it would sit with no transform, in viewport coordinates.
 *
 * `getBoundingClientRect` reports the axis-aligned box around the *transformed* element, so for
 * anything rotated it is both the wrong size and the wrong place. The size comes from
 * `offsetWidth`/`offsetHeight` instead, which are pre-transform by definition; the position is
 * recovered by asking where the transform would have put the corners and subtracting that from
 * the box it actually reported.
 *
 * Untransformed elements skip all of it and use the rect directly, which is exact rather than
 * rounded to whole pixels.
 */
export function untransformedBox(el: HTMLElement, m: Linear, computed: CSSStyleDeclaration): Box {
  const rect = el.getBoundingClientRect();
  if (isIdentity(m)) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  const width = el.offsetWidth || rect.width;
  const height = el.offsetHeight || rect.height;
  const o = originOf(computed, { left: 0, top: 0, width, height });

  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((corner) => apply(m, corner, o));

  const minX = Math.min(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  return { left: rect.left - minX, top: rect.top - minY, width, height };
}

/** The element's visual centre, which is what a rotation turns about. */
export function centreOf(box: Box, m: Linear, origin: Point): Point {
  const middle = apply(m, { x: box.width / 2, y: box.height / 2 }, origin);
  return { x: box.left + middle.x, y: box.top + middle.y };
}

/**
 * The corners of the untransformed box, transformed, in viewport coordinates.
 *
 * What the handles are drawn on. Returned in `nw, ne, se, sw` order.
 */
export function cornersOf(box: Box, m: Linear, origin: Point): [Point, Point, Point, Point] {
  const local: Point[] = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: box.width, y: box.height },
    { x: 0, y: box.height },
  ];
  const out = local.map((corner) => {
    const moved = apply(m, corner, origin);
    return { x: box.left + moved.x, y: box.top + moved.y };
  });
  return out as [Point, Point, Point, Point];
}

/** Where a handle sits on the box, in element coordinates. */
export function handlePoint(handle: ResizeHandle, box: Box): Point {
  const edge = EDGES[handle];
  const x = edge.left ? 0 : edge.right ? box.width : box.width / 2;
  const y = edge.top ? 0 : edge.bottom ? box.height : box.height / 2;
  return { x, y };
}

/**
 * The cursor for a handle on an element rotated by `angle`.
 *
 * A north-west handle on an element turned ninety degrees is, to the hand holding the mouse, a
 * north-east handle. Eight compass cursors quantised to the nearest 45° is what makes the
 * affordance honest; keeping `nwse-resize` on a rotated corner points the wrong way and reads
 * as a bug in the handle rather than in the cursor.
 */
export function handleCursor(handle: ResizeHandle, angle: number): string {
  const turned = ((HANDLE_ANGLE[handle] + angle) % 360 + 360) % 360;
  const step = Math.round(turned / 45) % 8;
  return ['ns', 'nesw', 'ew', 'nwse', 'ns', 'nesw', 'ew', 'nwse'][step] + '-resize';
}

/* -------------------------------------------------------------------------- */
/* Resizing                                                                    */
/* -------------------------------------------------------------------------- */

export interface ResizeInput {
  handle: ResizeHandle;
  /** The box as it was when the gesture began, untransformed. */
  start: Box;
  /** The pointer's travel since then, already projected into the element's axes. */
  local: Point;
  /** Lock the aspect ratio the element started with. */
  aspect: boolean;
  /** Grow or shrink about the centre, so both sides move together. */
  symmetric: boolean;
  /** Smallest size a gesture may produce, so an element cannot be dragged out of existence. */
  min: number;
}

export interface ResizeResult {
  width: number;
  height: number;
  /** How far the untransformed box's top-left corner moved, in element coordinates. */
  shift: Point;
}

/**
 * The size and offset a resize drag asks for.
 *
 * `min` rather than zero, and it matters more than it looks: an element dragged to nothing has
 * no handles left to drag back, so the gesture would be one-way. A floor of a few pixels keeps
 * every drag reversible by the same means it was made.
 */
export function resizeTo(input: ResizeInput): ResizeResult {
  const { handle, start, local, aspect, symmetric, min } = input;
  const edge = EDGES[handle];
  const scale = symmetric ? 2 : 1;

  let width = start.width + scale * ((edge.right ? local.x : 0) - (edge.left ? local.x : 0));
  let height = start.height + scale * ((edge.bottom ? local.y : 0) - (edge.top ? local.y : 0));

  if (aspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const horizontal = edge.left || edge.right;
    const vertical = edge.top || edge.bottom;
    if (horizontal && vertical) {
      /*
       * A corner: the axis that travelled further decides, and the other follows.
       *
       * Picking one axis unconditionally makes the diagonal feel dead in one direction, since
       * half the pointer's motion would be discarded.
       */
      if (Math.abs(width - start.width) * start.height >= Math.abs(height - start.height) * start.width) {
        height = width / ratio;
      } else {
        width = height * ratio;
      }
    } else if (horizontal) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
  }

  width = Math.max(min, width);
  height = Math.max(min, height);

  /*
   * Where the box's own top-left ended up.
   *
   * Dragging a west or north edge changes the size *and* moves the corner, because the opposite
   * edge is the one staying put. A symmetric drag moves it by half the growth in both axes,
   * which is what keeps the centre still.
   */
  const shift: Point = symmetric
    ? { x: -(width - start.width) / 2, y: -(height - start.height) / 2 }
    : { x: edge.left ? start.width - width : 0, y: edge.top ? start.height - height : 0 };

  return { width, height, shift };
}

/**
 * The offset that keeps a rotated element's anchored corner where it looks anchored.
 *
 * A transform turns the element about its `transform-origin`, which by default is its centre —
 * so growing it moves that centre, and the rotation then swings the whole shape around the new
 * one. The corner the user is not dragging drifts, by an amount that has nothing to do with the
 * drag and everything to do with the angle.
 *
 * It has a closed form. A local point `p` lands at `origin + M(p - origin)`, so moving the
 * origin by `Δ` moves every point by `Δ - MΔ`. Cancelling that means adding `MΔ - Δ` to the
 * element's own position, which is what this returns. Zero for an untransformed element, so the
 * caller does not need to ask whether it applies.
 */
export function originDrift(m: Linear, before: Point, after: Point): Point {
  if (isIdentity(m)) return { x: 0, y: 0 };
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  return { x: m.a * dx + m.c * dy - dx, y: m.b * dx + m.d * dy - dy };
}

/* -------------------------------------------------------------------------- */
/* Rotating                                                                    */
/* -------------------------------------------------------------------------- */

/** Degrees from the centre to a point, measured the way CSS turns: clockwise from up. */
export function angleTo(centre: Point, p: Point): number {
  return (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI + 90;
}

/** Fold an angle into `(-180, 180]`, so a readout never says 350° when it means -10°. */
export function normalizeAngle(deg: number): number {
  let out = deg % 360;
  if (out > 180) out -= 360;
  if (out <= -180) out += 360;
  return out;
}

const ROTATE_STEP = 15;

/** Nearest 15°, which is the step every design tool settled on for a held modifier. */
export function snapAngle(deg: number): number {
  return Math.round(deg / ROTATE_STEP) * ROTATE_STEP;
}

const ROTATE_CALL = /(^|\s)rotate\(\s*[^)]*\)/;

/**
 * Put a rotation into a `transform` value without disturbing what else is in it.
 *
 * `transform` is a list, and the styles panel already edits it as free text — so an element may
 * well arrive carrying `translateY(-4px) scale(1.02)` that somebody wrote on purpose. Replacing
 * the whole declaration with `rotate(20deg)` would silently delete their work, and appending a
 * second `rotate()` would compose with the first rather than replace it. So the existing call is
 * found and rewritten in place, and only added when there is none.
 *
 * An angle of zero removes the call rather than writing `rotate(0deg)`, so straightening an
 * element back up leaves the declaration as clean as it found it — and leaves nothing at all if
 * the rotation was the only thing in it.
 */
export function withRotation(transform: string, deg: number): string {
  const base = transform.trim() === 'none' ? '' : transform.trim();
  const rounded = Math.round(deg * 100) / 100;

  if (!rounded) {
    const without = base.replace(ROTATE_CALL, '').replace(/\s{2,}/g, ' ').trim();
    return without;
  }
  const call = `rotate(${rounded}deg)`;
  if (!base) return call;
  if (ROTATE_CALL.test(base)) {
    return base.replace(ROTATE_CALL, (match) => (match.startsWith(' ') ? ` ${call}` : call));
  }
  return `${base} ${call}`;
}

/** The rotation already declared in a `transform` string, or null when there is none. */
export function declaredRotation(transform: string): number | null {
  const match = /rotate\(\s*(-?[\d.]+)(deg|rad|turn|grad)?\s*\)/.exec(transform);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  switch (match[2]) {
    case 'rad':
      return (value * 180) / Math.PI;
    case 'turn':
      return value * 360;
    case 'grad':
      return value * 0.9;
    default:
      return value;
  }
}

/* -------------------------------------------------------------------------- */
/* Units                                                                       */
/* -------------------------------------------------------------------------- */

/** The units a drag knows how to write back. Anything else falls to pixels. */
export type LengthUnit = 'px' | '%' | 'rem' | 'em';

const LENGTH = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(px|%|rem|em)\s*$/;

/**
 * The unit a declaration is written in, when it is a plain length.
 *
 * Null for everything else, and the list of "everything else" is the point: `auto`, `calc(...)`,
 * `var(--gutter)`, `clamp(...)`, a keyword. Those carry intent a number cannot express, so a
 * drag cannot preserve them and must not pretend to — the caller falls back to pixels and the
 * readout says which unit it is writing.
 */
export function unitOf(value: string): LengthUnit | null {
  const match = LENGTH.exec(value);
  return match ? (match[2] as LengthUnit) : null;
}

/** Reference lengths a relative unit is measured against. Gathered once per gesture. */
export interface UnitBasis {
  /** The containing block's size, for percentages. */
  width: number;
  height: number;
  /** The element's own font size, for `em`. */
  font: number;
  /** The root font size, for `rem`. */
  root: number;
}

/**
 * A pixel measurement, written in the unit the declaration already used.
 *
 * This is the whole answer to the objection the selection layer was built around — that handles
 * produce hard-coded pixels and a design system wants anything but. An element declaring
 * `width: 50%` still declares a percentage after being dragged; one declaring `left: 2rem` still
 * declares rem. Only a value that was never a plain length in the first place becomes pixels,
 * and there was nothing to preserve in that case.
 *
 * Percentages against a zero-sized container fall back to pixels rather than dividing by zero.
 */
export function formatLength(px: number, unit: LengthUnit, basis: UnitBasis, axis: 'x' | 'y'): string {
  switch (unit) {
    case '%': {
      const reference = axis === 'x' ? basis.width : basis.height;
      if (!reference) return `${round(px, 0)}px`;
      return `${round((px / reference) * 100, 2)}%`;
    }
    case 'rem':
      return basis.root ? `${round(px / basis.root, 3)}rem` : `${round(px, 0)}px`;
    case 'em':
      return basis.font ? `${round(px / basis.font, 3)}em` : `${round(px, 0)}px`;
    default:
      return `${round(px, 0)}px`;
  }
}

/** Trailing zeros dropped, so a value reads as a person would write it. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The difference between an element's border box and the box `width` refers to.
 *
 * `width: 200px` on a `content-box` element with 16px of padding renders 232px wide, so a drag
 * that measured 232 on screen has to declare 200. Returned as a pair to add or subtract, per
 * axis, and zero under `border-box` — which is what most pages set, and why getting this wrong
 * looks fine until it does not.
 */
export function boxInset(computed: CSSStyleDeclaration): { x: number; y: number } {
  if (computed.boxSizing === 'border-box') return { x: 0, y: 0 };
  const n = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    x:
      n(computed.paddingLeft) + n(computed.paddingRight) +
      n(computed.borderLeftWidth) + n(computed.borderRightWidth),
    y:
      n(computed.paddingTop) + n(computed.paddingBottom) +
      n(computed.borderTopWidth) + n(computed.borderBottomWidth),
  };
}

/**
 * Which offset property each axis should be written through.
 *
 * An absolutely positioned element may be anchored from either side, and rewriting the wrong one
 * does not move it — it stretches it. So the declared side wins: an element holding `right: 0`
 * is dragged by changing `right`, which also means the delta runs backwards. When both sides are
 * declared the element is pinned to both, and moving it means moving both together.
 *
 * Neither declared falls to the leading side, which is where an untouched absolutely positioned
 * element already sits.
 */
export function offsetAxis(
  near: string,
  far: string,
): { near: boolean; far: boolean } {
  const hasNear = Boolean(near.trim()) && near.trim() !== 'auto';
  const hasFar = Boolean(far.trim()) && far.trim() !== 'auto';
  if (hasNear && hasFar) return { near: true, far: true };
  if (hasFar) return { near: false, far: true };
  return { near: true, far: false };
}

/* -------------------------------------------------------------------------- */
/* The gesture, as bookkeeping                                                 */
/* -------------------------------------------------------------------------- */

/** Which direct-manipulation gesture is in flight. */
export type TransformMode = 'move' | 'resize' | 'rotate';

/**
 * Everything a handle drag measures once, at the moment the pointer goes down.
 *
 * Measured once rather than per frame, and that is not an optimisation. The gesture changes the
 * element's geometry, so reading it again mid-drag feeds the gesture's own output back in as
 * input — and the arithmetic then compounds its own rounding, which shows up as a corner that
 * creeps away from the pointer it is supposed to be following.
 */
export interface TransformSnapshot {
  el: HTMLElement;
  mode: TransformMode;
  handle: ResizeHandle | null;
  /** Where the pointer went down. */
  start: Point;
  box: Box;
  linear: Linear;
  origin: Point;
  centre: Point;
  /** The rotation already on the element, and the angle the pointer began at. */
  angle: number;
  grabAngle: number;
  /**
   * The element's own inline values, for putting it back exactly as the gesture found it.
   *
   * Distinct from `authored` and the distinction is load-bearing: restoring means writing the
   * *style attribute* back, so this has to be what was on the attribute — including nothing at
   * all, which is the common case for an element styled entirely by rules.
   */
  inline: Record<string, string>;
  /**
   * The value that actually wins the cascade, as it was written.
   *
   * What the arithmetic reads: the unit to preserve, and the number to start from. Reading the
   * *computed* value instead is the trap, and it is a quiet one — `getComputedStyle` resolves
   * `left: 10%` to `60px` and `2rem` to `32px`, so a gesture that consulted it would faithfully
   * preserve a unit the author never wrote, converting every percentage in the page to pixels
   * the first time anyone nudged it. Which is precisely the failure the whole unit-preserving
   * exercise exists to avoid.
   */
  authored: Record<string, string>;
  /** The unit each written property should come back out in. */
  units: Record<string, LengthUnit>;
  basis: UnitBasis;
  inset: { x: number; y: number };
  /** Which offset properties this element is anchored by, per axis. */
  anchors: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  positioned: boolean;
  /** The last values written, so the commit lands exactly what the page is showing. */
  written: Record<string, string>;
}

/**
 * What each gesture is allowed to touch, which is also exactly what it snapshots.
 *
 * A resize reaches for the offsets as well as the size, because dragging a west or north edge
 * moves the box's own corner — the opposite edge is the one holding still.
 */
export const TRANSFORM_TOUCHES: Record<TransformMode, readonly string[]> = {
  move: ['left', 'right', 'top', 'bottom'],
  resize: ['width', 'height', 'left', 'right', 'top', 'bottom'],
  rotate: ['transform'],
};

export const TRANSFORM_LABEL: Record<TransformMode, string> = {
  move: 'Moved',
  resize: 'Resized',
  rotate: 'Rotated',
};

/**
 * The smallest box a drag may produce.
 *
 * Not zero, and the reason is that the gesture has to stay reversible by the same means it was
 * made: an element dragged down to nothing has no edges left to grab, so undo becomes the only
 * way back out of a perfectly ordinary slip.
 */
export const MIN_TRANSFORM_SIZE = 8;

/** A declared length, in pixels. The inverse of `formatLength`, for reading a starting offset. */
export function pxOf(value: string, unit: LengthUnit, basis: UnitBasis, axis: 'x' | 'y'): number {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  switch (unit) {
    case '%':
      return (number / 100) * (axis === 'x' ? basis.width : basis.height);
    case 'rem':
      return number * basis.root;
    case 'em':
      return number * basis.font;
    default:
      return number;
  }
}

/**
 * The padding box an element's offsets are measured from, in viewport coordinates.
 *
 * `offsetParent` answers this for everything except `position: fixed`, where it is null because
 * the containing block is the viewport itself rather than any element. Falling through to
 * `documentElement` there would measure against the whole scrolled document, putting a fixed
 * element's offsets out by however far the page happened to be scrolled.
 */
export function containingFrame(el: HTMLElement, scheme?: string): Box {
  /*
   * `scheme` is the positioning the offsets are being measured *for*, which is not always the one
   * the element currently has. Converting an element to absolute has to measure it against the
   * block it is about to be resolved in, before it is resolved there. Defaults to what it is now.
   */
  if ((scheme ?? getComputedStyle(el).position) === 'fixed') {
    return { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  const parent =
    el.offsetParent instanceof HTMLElement ? el.offsetParent : document.documentElement;
  const rect = parent.getBoundingClientRect();
  return {
    left: rect.left + parent.clientLeft,
    top: rect.top + parent.clientTop,
    width: parent.clientWidth,
    height: parent.clientHeight,
  };
}

/**
 * The value an offset property already has, for a move with nothing declared to start from.
 *
 * The first drag of an element is the only one that needs this — after it, `left` is on the style
 * attribute and every later drag just adds to the number. Which is exactly why getting it wrong
 * is so confusing to look at: the first move flies off somewhere and every move after it is
 * perfect, so the gesture appears to be fine and the element appears to be cursed.
 *
 * **`left` does not mean the same thing on both sides of `position`.** On an absolutely positioned
 * element it is a coordinate: the distance from the containing block's padding edge. On a
 * relative or sticky one it is a *displacement* from wherever normal flow already put the
 * element — so an element with no `left` is at zero by definition, however far from its container's
 * origin it happens to sit. Measuring the container distance for those is what made the first
 * drag of a relative element jump by the width of everything to its left.
 *
 * Two smaller corrections for the absolute case. The box is the *untransformed* one, because a
 * rotated element's bounding rect is the box around it and would report a position it does not
 * have. And the margin comes off, because `left` positions the margin edge rather than the border
 * edge — an element with `margin-left: 18px` would otherwise shift by 18px on its first nudge.
 */
export function offsetFrom(el: HTMLElement, property: OffsetProperty): number {
  const computed = getComputedStyle(el);
  if (computed.position === 'relative' || computed.position === 'sticky') return 0;
  const box = untransformedBox(el, linearOf(computed.transform), computed);
  return offsetWithin(box, containingFrame(el), computed, property);
}

/** The four properties that place a positioned element. */
export type OffsetProperty = 'left' | 'right' | 'top' | 'bottom';

/**
 * What one offset property would have to say for a box to stay where it is inside a frame.
 *
 * The arithmetic on its own, so the two callers cannot drift apart: a drag needs it for the axis
 * it is moving, and a conversion to absolute needs it for every axis at once. The margin comes
 * off because these properties position the margin edge, not the border edge.
 */
function offsetWithin(
  box: Box,
  frame: Box,
  computed: CSSStyleDeclaration,
  property: OffsetProperty,
): number {
  const margin = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  switch (property) {
    case 'left':
      return box.left - frame.left - margin(computed.marginLeft);
    case 'right':
      return frame.left + frame.width - (box.left + box.width) - margin(computed.marginRight);
    case 'top':
      return box.top - frame.top - margin(computed.marginTop);
    default:
      return frame.top + frame.height - (box.top + box.height) - margin(computed.marginBottom);
  }
}

/**
 * The offsets that leave an element exactly where it is when it becomes absolute or fixed.
 *
 * Taking an element out of flow with no offsets declared is the most disorienting thing the
 * position control can do. The browser resolves `auto` offsets to the element's static position,
 * which sounds like "where it was" and often is — but not inside a flex or grid parent, where the
 * static position of an out-of-flow child is the container's content box corner, so the element
 * leaps there. Meanwhile the Offsets fields all read zero, giving no clue where it went.
 *
 * Measuring first and pinning the result means the element does not move at all, and the numbers
 * it lands on are the ones describing where it already was — which is also what makes the next
 * drag or nudge start from somewhere sensible.
 *
 * `authored` reads the winning cascade value, so the side an element is already anchored from is
 * the side that gets written. Rewriting the other one would not move it, it would stretch it.
 */
export function pinnedOffsets(
  el: HTMLElement,
  scheme: 'absolute' | 'fixed',
  authored: (property: string) => string,
): Record<string, string> {
  const computed = getComputedStyle(el);
  const box = untransformedBox(el, linearOf(computed.transform), computed);
  if (box.width <= 0 || box.height <= 0) return {};

  const frame = containingFrame(el, scheme);
  const horizontal = offsetAxis(authored('left'), authored('right'));
  const vertical = offsetAxis(authored('top'), authored('bottom'));
  const wanted: OffsetProperty[] = [];
  if (horizontal.near) wanted.push('left');
  if (horizontal.far) wanted.push('right');
  if (vertical.near) wanted.push('top');
  if (vertical.far) wanted.push('bottom');

  const declarations: Record<string, string> = {};
  for (const property of wanted) {
    // Whole pixels: the panel shows integers, and half a pixel of precision is not worth a
    // number nobody can read.
    declarations[property] = `${Math.round(offsetWithin(box, frame, computed, property))}px`;
  }
  return declarations;
}

/**
 * Displays whose size comes from their own layout rather than from `width` and `height`.
 *
 * A flex or grid container sizes itself around its tracks, its gaps and its children's own flex
 * properties; a table row is sized by the table algorithm. Pinning a width on one of these is
 * usually not what someone dragging a corner meant, and the result either fights the layout or
 * is quietly ignored — so the resize handles stay away and leave the job to the properties that
 * actually govern it. Rotation and dragging are unaffected: neither is a question about size.
 */
const LAYOUT_SIZED = new Set([
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  // No box of its own at all, so there is nothing to take hold of.
  'contents',
  // The table algorithm decides these, whatever a rule asks for.
  'table-row',
  'table-row-group',
  'table-header-group',
  'table-footer-group',
  'table-column',
  'table-column-group',
  'table-cell',
  'table-caption',
]);

/** Whether dragging a corner of this element is a sensible way to set its size. */
export function isResizableDisplay(display: string): boolean {
  return !LAYOUT_SIZED.has(display.trim());
}

/**
 * Read everything a gesture needs off the element, once.
 *
 * Here rather than in the engine because it is all measurement, and measurement belongs with the
 * arithmetic that consumes it. The engine's job is the gesture's lifecycle — what to do on
 * pointerdown, what to commit on release — not the trigonometry.
 *
 * Returns null when there is nothing to manipulate: an element with no box has no edges to grab,
 * and a move needs a `position` other than `static` because an element in normal flow is placed
 * by its neighbours. Writing `left` onto that would look right until the first reflow.
 */
export function readSnapshot(
  el: HTMLElement,
  mode: TransformMode,
  handle: ResizeHandle | null,
  x: number,
  y: number,
  read: { inline: (property: string) => string; authored: (property: string) => string },
): TransformSnapshot | null {
  const computed = getComputedStyle(el);
  const positioned = computed.position !== 'static';
  if (mode === 'move' && !positioned) return null;
  // Refused here rather than only in the chrome, so a keyboard or scripted resize cannot reach
  // an element whose size is not its own to give.
  if (mode === 'resize' && !isResizableDisplay(computed.display)) return null;

  const linear = linearOf(computed.transform);
  const box = untransformedBox(el, linear, computed);
  if (box.width <= 0 || box.height <= 0) return null;
  const origin = originOf(computed, box);
  const centre = centreOf(box, linear, origin);

  const inline: Record<string, string> = {};
  const authored: Record<string, string> = {};
  const units: Record<string, LengthUnit> = {};
  for (const property of TRANSFORM_TOUCHES[mode]) {
    inline[property] = read.inline(property);
    authored[property] = read.authored(property);
    // Only from what was written. A value that is not a plain length — `auto`, a `calc()`, a
    // `var()` — has no unit to keep, and pixels are the honest fallback.
    units[property] = unitOf(authored[property]) ?? 'px';
  }

  const frame = containingFrame(el);
  /*
   * Which side anchors the element, read from the cascade rather than the attribute.
   *
   * An element whose stylesheet says `right: 40px` is anchored from the right even though its
   * style attribute is empty. Asking the attribute reports "neither", and the gesture would then
   * write `left` — which does not move an element pinned to the right, it stretches it.
   */
  const horizontal = offsetAxis(authored.left ?? '', authored.right ?? '');
  const vertical = offsetAxis(authored.top ?? '', authored.bottom ?? '');

  return {
    el,
    mode,
    handle,
    start: { x, y },
    box,
    linear,
    origin,
    centre,
    // From the authored text where there is one, so `rotate(30deg)` is read as thirty degrees
    // rather than recovered from a matrix; and from the matrix when the transform came from
    // somewhere this cannot see the source of.
    angle: declaredRotation(authored.transform ?? '') ?? angleOf(linear),
    grabAngle: angleTo(centre, { x, y }),
    inline,
    authored,
    units,
    basis: {
      width: frame.width,
      height: frame.height,
      font: Number.parseFloat(computed.fontSize) || 16,
      root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    },
    inset: boxInset(computed),
    anchors: {
      left: horizontal.near,
      right: horizontal.far,
      top: vertical.near,
      bottom: vertical.far,
    },
    positioned,
    written: {},
  };
}

/** What a gesture wants written, and what it should say about itself while it runs. */
export interface TransformStep {
  declarations: Record<string, string>;
  /** The values being produced, for the badge. */
  readout: string;
  /** What a held modifier would do, so the shortcut is discoverable mid-gesture. */
  hint: string;
}

export interface Modifiers {
  shift: boolean;
  alt: boolean;
}

/**
 * The declarations a pointer position asks for.
 *
 * One entry point for all three gestures, so the engine's update path is a single call and the
 * decision about which arithmetic applies lives with the arithmetic.
 */
export function stepFor(gesture: TransformSnapshot, x: number, y: number, mod: Modifiers): TransformStep {
  if (gesture.mode === 'rotate') return rotateStep(gesture, x, y, mod);
  if (gesture.mode === 'resize') return resizeStep(gesture, x, y, mod);
  return moveStep(gesture, x, y, mod);
}

function resizeStep(gesture: TransformSnapshot, x: number, y: number, mod: Modifiers): TransformStep {
  const local = toLocal(gesture.linear, { x: x - gesture.start.x, y: y - gesture.start.y });
  const result = resizeTo({
    handle: gesture.handle ?? 'se',
    start: gesture.box,
    local,
    aspect: mod.shift,
    symmetric: mod.alt,
    min: MIN_TRANSFORM_SIZE,
  });

  const declarations: Record<string, string> = {
    width: formatLength(Math.max(0, result.width - gesture.inset.x), gesture.units.width, gesture.basis, 'x'),
    height: formatLength(Math.max(0, result.height - gesture.inset.y), gesture.units.height, gesture.basis, 'y'),
  };

  /*
   * Only a positioned element gets its offsets touched.
   *
   * Dragging the west edge of an element in normal flow shrinks it from the right, because the
   * left edge is where the flow put it and CSS has no way to say otherwise. Writing `left` would
   * appear to work and then break the moment anything above it changed height.
   */
  if (gesture.positioned) {
    const drift = originDrift(
      gesture.linear,
      { x: gesture.box.width / 2, y: gesture.box.height / 2 },
      { x: result.width / 2, y: result.height / 2 },
    );
    Object.assign(
      declarations,
      offsetDeclarations(gesture, result.shift.x + drift.x, result.shift.y + drift.y),
    );
  }

  const shown = `${Math.round(result.width)} × ${Math.round(result.height)}`;
  return {
    declarations,
    readout: mod.shift ? `${shown} · ratio locked` : shown,
    hint: 'Shift locks the ratio · Alt resizes from the centre',
  };
}

function moveStep(gesture: TransformSnapshot, x: number, y: number, mod: Modifiers): TransformStep {
  let dx = x - gesture.start.x;
  let dy = y - gesture.start.y;
  /*
   * Shift constrains to one axis, chosen by which way the hand has travelled further.
   *
   * The dominant axis rather than the first one to move: a drag that starts with a two-pixel
   * wobble should not be locked to whichever direction the wobble happened to favour.
   */
  if (mod.shift) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }

  const declarations = offsetDeclarations(gesture, dx, dy);
  const parts = Object.entries(declarations)
    .filter(([, value]) => value)
    .map(([property, value]) => `${property} ${value}`);
  return {
    declarations,
    readout: parts.join('  ') || 'nothing to offset',
    hint: 'Shift keeps it on one axis',
  };
}

function rotateStep(gesture: TransformSnapshot, x: number, y: number, mod: Modifiers): TransformStep {
  const travelled = angleTo(gesture.centre, { x, y }) - gesture.grabAngle;
  const raw = gesture.angle + travelled;
  const angle = normalizeAngle(mod.shift ? snapAngle(raw) : raw);
  return {
    /*
     * Composed into the *authored* transform, not the inline one.
     *
     * An element whose rule says `translateX(4px) rotate(30deg)` has an empty style attribute, so
     * composing into that would write a bare `rotate(...)` inline — which overrides the whole
     * declaration and silently drops the translate. Carrying the authored list across keeps
     * everything the author wrote and changes only the angle.
     */
    declarations: { transform: withRotation(gesture.authored.transform ?? '', angle) },
    readout: `${Math.round(angle)}°`,
    hint: 'Shift snaps to 15°',
  };
}

/**
 * Offsets for a shift of the untransformed box, in whichever properties anchor it.
 *
 * The sign flips for `right` and `bottom`: those measure inwards from the far edge, so moving an
 * element that hangs off `right: 0` to the right means making `right` smaller.
 */
function offsetDeclarations(
  gesture: TransformSnapshot,
  dx: number,
  dy: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  const axis = (
    property: 'left' | 'right' | 'top' | 'bottom',
    delta: number,
    direction: 'x' | 'y',
  ): void => {
    const written = gesture.authored[property] ?? '';
    const from = Number.isFinite(Number.parseFloat(written))
      ? pxOf(written, gesture.units[property], gesture.basis, direction)
      : offsetFrom(gesture.el, property);
    out[property] = formatLength(from + delta, gesture.units[property], gesture.basis, direction);
  };

  if (gesture.anchors.left) axis('left', dx, 'x');
  if (gesture.anchors.right) axis('right', -dx, 'x');
  if (gesture.anchors.top) axis('top', dy, 'y');
  if (gesture.anchors.bottom) axis('bottom', -dy, 'y');
  return out;
}
