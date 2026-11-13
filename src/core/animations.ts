/**
 * Ready-made animations, as CSS an element can carry on its own.
 *
 * Every animation here is one `@keyframes` from a fixed library, parameterised by custom properties
 * (`--heo-y`, `--heo-scale`, …) whose fallbacks are the defaults. So an element's animation is just
 * declarations: `animation-name: heo-slide; --heo-y: 40px; …`, written where any other style goes,
 * and only the keyframes a page refers to are written out with its design system. Nothing is
 * generated per element, and nothing needs a script.
 *
 * Triggers are CSS only. On load is a plain time-based animation. In view and On scroll are
 * scroll-driven (`animation-timeline: view()` / `scroll()`), which runs off the main thread for
 * opacity and transforms and is Baseline since Firefox 159 (October 2026); a browser without it
 * ignores the timeline, and with a duration of `auto` the animation ends at once and the content
 * simply shows. Hover writes the animation into the element's `:hover` state.
 *
 * Longhands rather than the `animation` shorthand, on purpose: the shorthand resets
 * `animation-timeline` and `animation-range`, so a shorthand edited after a timeline was written
 * silently turned a scroll-driven animation back into a timed one.
 */

export type Trigger = 'load' | 'in-view' | 'scroll' | 'hover';
export type Category = 'reveal' | 'attention' | 'scroll';

export interface ParamSpec {
  key: string;
  label: string;
  kind: 'direction' | 'length' | 'angle' | 'number' | 'color' | 'select';
  default: string;
  options?: Array<{ value: string; label: string }>;
}

export interface Keyframe {
  /** `from`, `to`, `50%`, or several: `0%, 100%`. */
  at: string;
  declarations: Record<string, string>;
}

export interface AnimationPreset {
  id: string;
  label: string;
  category: Category;
  /** Shown beside it in the list. */
  description: string;
  /** Listed first, as what an animation looks like in 2026. */
  featured?: boolean;
  keyframes: Keyframe[];
  params: ParamSpec[];
  /** The custom properties these parameters write. Every value read back through `read`. */
  vars: (params: Record<string, string>) => Record<string, string>;
  read: (vars: Record<string, string>) => Record<string, string>;
  defaults: Omit<AnimationTiming, 'trigger'> & { trigger: Trigger };
  triggers: Trigger[];
  /** What drives it On scroll: the element passing through the viewport, or the page's scroll. */
  scrollTimeline?: 'view' | 'root';
}

export interface AnimationTiming {
  trigger: Trigger;
  /** Milliseconds. Ignored for the scroll-driven triggers, whose length is the scroll. */
  duration: number;
  delay: number;
  easing: string;
  /** A number, or `infinite`. */
  iterations: string;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  /** In view: how much of the element's entry it plays over. */
  range: 'enter' | 'relaxed';
}

export interface AnimationConfig extends AnimationTiming {
  preset: string;
  params: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Easing                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A damped spring as a `linear()` easing: the curve a physical spring traces, overshoot and all,
 * which a cubic Bézier cannot draw. The 2026 way to get spring motion in plain CSS.
 */
export function springEasing(stiffness: number, damping: number, mass = 1, points = 40): string {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  const at = (t: number): number => {
    if (zeta < 1) return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  };
  // Long enough for the spring to settle within a hundredth.
  let end = 0.1;
  while (end < 10 && Math.abs(Math.exp(-zeta * w0 * end)) > 0.01) end += 0.05;
  const values: string[] = [];
  for (let i = 0; i <= points; i++) {
    const v = i === points ? 1 : at((i / points) * end);
    values.push(String(Math.round(v * 1000) / 1000));
  }
  return `linear(${values.join(', ')})`;
}

export interface EasingPreset {
  label: string;
  value: string;
  /** Springs and back curves overshoot: their curve leaves the 0–1 box. */
  spring?: boolean;
}

export const EASINGS: EasingPreset[] = [
  { label: 'Smooth out', value: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  { label: 'Ease', value: 'ease' },
  { label: 'Ease in-out', value: 'cubic-bezier(0.65, 0, 0.35, 1)' },
  { label: 'Snappy', value: 'cubic-bezier(0.2, 0.9, 0.1, 1)' },
  { label: 'Ease in', value: 'cubic-bezier(0.5, 0, 0.75, 0)' },
  { label: 'Linear', value: 'linear' },
  { label: 'Back out', value: 'cubic-bezier(0.34, 1.56, 0.64, 1)', spring: true },
  { label: 'Spring', value: springEasing(170, 18), spring: true },
  { label: 'Bouncy spring', value: springEasing(220, 11), spring: true },
  { label: 'Gentle spring', value: springEasing(90, 16), spring: true },
];

/** The four numbers of a `cubic-bezier()` (or a keyword that is one), or null. */
export function parseBezier(value: string): [number, number, number, number] | null {
  const named: Record<string, [number, number, number, number]> = {
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
    linear: [0, 0, 1, 1],
  };
  const text = value.trim().toLowerCase();
  if (named[text]) return named[text]!;
  const match = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(text);
  if (!match) return null;
  const n = match.slice(1).map(Number) as [number, number, number, number];
  return n.every(Number.isFinite) ? n : null;
}

export const bezierCss = ([a, b, c, d]: readonly number[]): string =>
  `cubic-bezier(${[a, b, c, d].map((n) => Math.round(n! * 100) / 100).join(', ')})`;

/* -------------------------------------------------------------------------- */
/* The library                                                                 */
/* -------------------------------------------------------------------------- */

const DIRECTIONS = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

/** A motion direction as where it starts from: moving up starts below. */
function offsetFor(direction: string, distance: string): { x: string; y: string } {
  const neg = (v: string): string => (v.startsWith('-') ? v.slice(1) : `-${v}`);
  switch (direction) {
    case 'down': return { x: '0px', y: neg(distance) };
    case 'left': return { x: distance, y: '0px' };
    case 'right': return { x: neg(distance), y: '0px' };
    default: return { x: '0px', y: distance };
  }
}

function directionOf(x = '0px', y = '0px', fallback = 'up'): { direction: string; distance: string } {
  const zero = (v: string): boolean => /^-?0(?:\.0+)?[a-z%]*$/i.test(v.trim());
  const abs = (v: string): string => v.trim().replace(/^-/, '');
  if (!zero(y)) return { direction: y.trim().startsWith('-') ? 'down' : 'up', distance: abs(y) };
  if (!zero(x)) return { direction: x.trim().startsWith('-') ? 'right' : 'left', distance: abs(x) };
  return { direction: fallback, distance: '' };
}

/** Only what differs from the keyframes' own fallback is written. */
function lean(vars: Record<string, string>, defaults: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).filter(([key, value]) => value.trim() && value.trim() !== defaults[key]));
}

const REVEAL: AnimationPreset['defaults'] = { trigger: 'in-view', duration: 700, delay: 0, easing: EASINGS[0]!.value, iterations: '1', direction: 'normal', range: 'relaxed' };
const LOOP: AnimationPreset['defaults'] = { trigger: 'load', duration: 1200, delay: 0, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', iterations: 'infinite', direction: 'normal', range: 'relaxed' };
const SCROLLED: AnimationPreset['defaults'] = { trigger: 'scroll', duration: 1000, delay: 0, easing: 'linear', iterations: '1', direction: 'normal', range: 'relaxed' };
const REVEAL_TRIGGERS: Trigger[] = ['in-view', 'load', 'hover'];
const LOOP_TRIGGERS: Trigger[] = ['load', 'hover', 'in-view'];

/** A slide-like preset: a direction and a distance, as `--heo-x` / `--heo-y`. */
function moving(defaultDistance: string, extra: { fade?: boolean } = {}): Pick<AnimationPreset, 'params' | 'vars' | 'read'> {
  const params: ParamSpec[] = [
    { key: 'direction', label: 'Direction', kind: 'direction', default: 'up', options: DIRECTIONS },
    { key: 'distance', label: 'Distance', kind: 'length', default: defaultDistance },
  ];
  if (extra.fade) params.push({ key: 'fade', label: 'Fade', kind: 'select', default: 'yes', options: YES_NO });
  return {
    params,
    vars: (p) => {
      const { x, y } = offsetFor(p.direction ?? 'up', p.distance || defaultDistance);
      return lean({ '--heo-x': x, '--heo-y': y, ...(extra.fade ? { '--heo-opacity': p.fade === 'no' ? '1' : '0' } : {}) }, { '--heo-x': '0px', '--heo-y': defaultDistance, '--heo-opacity': '0' });
    },
    read: (v) => {
      const { direction, distance } = directionOf(v['--heo-x'], v['--heo-y'] ?? defaultDistance);
      return { direction, distance: distance || defaultDistance, ...(extra.fade ? { fade: v['--heo-opacity']?.trim() === '1' ? 'no' : 'yes' } : {}) };
    },
  };
}

/** One number-like parameter as one custom property. */
function single(key: string, label: string, kind: ParamSpec['kind'], property: string, fallback: string): Pick<AnimationPreset, 'params' | 'vars' | 'read'> {
  return {
    params: [{ key, label, kind, default: fallback }],
    vars: (p) => lean({ [property]: p[key] || fallback }, { [property]: fallback }),
    read: (v) => ({ [key]: v[property]?.trim() || fallback }),
  };
}

export const PRESETS: AnimationPreset[] = [
  /* ---- Reveal ---- */
  {
    id: 'blur-in', label: 'Blur in', category: 'reveal', featured: true,
    description: 'Out of focus into place, on a spring',
    keyframes: [{ at: 'from', declarations: { opacity: '0', filter: 'blur(var(--heo-blur, 12px))', translate: '0 var(--heo-y, 16px)' } }],
    params: [
      { key: 'blur', label: 'Blur', kind: 'length', default: '12px' },
      { key: 'distance', label: 'Rise', kind: 'length', default: '16px' },
    ],
    vars: (p) => lean({ '--heo-blur': p.blur || '12px', '--heo-y': p.distance || '16px' }, { '--heo-blur': '12px', '--heo-y': '16px' }),
    read: (v) => ({ blur: v['--heo-blur']?.trim() || '12px', distance: v['--heo-y']?.trim() || '16px' }),
    defaults: { ...REVEAL, duration: 900, easing: EASINGS[7]!.value }, triggers: REVEAL_TRIGGERS,
  },
  {
    id: 'pop', label: 'Spring pop', category: 'reveal', featured: true,
    description: 'Scales up past its size and settles',
    keyframes: [{ at: 'from', declarations: { opacity: '0', scale: 'var(--heo-scale, 0.6)' } }],
    ...single('scale', 'From scale', 'number', '--heo-scale', '0.6'),
    defaults: { ...REVEAL, duration: 800, easing: EASINGS[8]!.value }, triggers: REVEAL_TRIGGERS,
  },
  {
    id: 'fade', label: 'Fade', category: 'reveal', description: 'Opacity only',
    keyframes: [{ at: 'from', declarations: { opacity: '0' } }],
    params: [], vars: () => ({}), read: () => ({}),
    defaults: REVEAL, triggers: REVEAL_TRIGGERS,
  },
  {
    id: 'slide', label: 'Slide', category: 'reveal', description: 'Fades in while moving a short way',
    keyframes: [{ at: 'from', declarations: { opacity: 'var(--heo-opacity, 0)', translate: 'var(--heo-x, 0px) var(--heo-y, 24px)' } }],
    ...moving('24px', { fade: true }),
    defaults: REVEAL, triggers: REVEAL_TRIGGERS,
  },
  {
    id: 'push', label: 'Push', category: 'reveal', description: 'Travels its own size into place',
    keyframes: [{ at: 'from', declarations: { translate: 'var(--heo-x, 0px) var(--heo-y, 100%)' } }],
    ...moving('100%'),
    defaults: { ...REVEAL, duration: 800 }, triggers: REVEAL_TRIGGERS,
  },
  {
    id: 'zoom', label: 'Zoom', category: 'reveal', description: 'Grows from smaller',
    keyframes: [{ at: 'from', declarations: { opacity: '0', scale: 'var(--heo-scale, 0.85)' } }],
    ...single('scale', 'From scale', 'number', '--heo-scale', '0.85'),
    defaults: REVEAL, triggers: REVEAL_TRIGGERS,
  },
  {
    id: 'wipe', label: 'Wipe', category: 'reveal', description: 'Uncovered by a moving edge',
    keyframes: [
      { at: 'from', declarations: { 'clip-path': 'var(--heo-clip, inset(100% 0 0 0))' } },
      { at: 'to', declarations: { 'clip-path': 'inset(0 0 0 0)' } },
    ],
    params: [{ key: 'direction', label: 'Direction', kind: 'direction', default: 'up', options: DIRECTIONS }],
    vars: (p) => lean({ '--heo-clip': WIPES[p.direction ?? 'up'] ?? WIPES.up! }, { '--heo-clip': WIPES.up! }),
    read: (v) => ({ direction: Object.entries(WIPES).find(([, clip]) => clip === v['--heo-clip']?.trim())?.[0] ?? 'up' }),
    defaults: { ...REVEAL, duration: 900 }, triggers: REVEAL_TRIGGERS,
  },
  {
    id: 'flip', label: 'Flip', category: 'reveal', description: 'Turns in on an axis, in perspective',
    keyframes: [{ at: 'from', declarations: { opacity: '0', transform: 'perspective(800px) rotate3d(var(--heo-axis, 1, 0), 0, var(--heo-rotate, 70deg))' } }],
    params: [
      { key: 'axis', label: 'Axis', kind: 'select', default: 'x', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
      { key: 'angle', label: 'Angle', kind: 'angle', default: '70deg' },
    ],
    vars: (p) => lean({ '--heo-axis': p.axis === 'y' ? '0, 1' : '1, 0', '--heo-rotate': p.angle || '70deg' }, { '--heo-axis': '1, 0', '--heo-rotate': '70deg' }),
    read: (v) => ({ axis: v['--heo-axis']?.replace(/\s/g, '') === '0,1' ? 'y' : 'x', angle: v['--heo-rotate']?.trim() || '70deg' }),
    defaults: REVEAL, triggers: REVEAL_TRIGGERS,
  },

  /* ---- Attention ---- */
  {
    id: 'glow', label: 'Glow', category: 'attention', featured: true, description: 'A soft halo that breathes',
    keyframes: [
      { at: '0%, 100%', declarations: { 'box-shadow': '0 0 0 0 transparent' } },
      { at: '50%', declarations: { 'box-shadow': '0 0 var(--heo-blur, 24px) var(--heo-spread, 4px) var(--heo-color, oklch(65% 0.2 280 / 55%))' } },
    ],
    params: [
      { key: 'color', label: 'Colour', kind: 'color', default: 'oklch(65% 0.2 280 / 55%)' },
      { key: 'blur', label: 'Size', kind: 'length', default: '24px' },
    ],
    vars: (p) => lean({ '--heo-color': p.color || 'oklch(65% 0.2 280 / 55%)', '--heo-blur': p.blur || '24px' }, { '--heo-color': 'oklch(65% 0.2 280 / 55%)', '--heo-blur': '24px' }),
    read: (v) => ({ color: v['--heo-color']?.trim() || 'oklch(65% 0.2 280 / 55%)', blur: v['--heo-blur']?.trim() || '24px' }),
    defaults: { ...LOOP, duration: 2400 }, triggers: LOOP_TRIGGERS,
  },
  {
    id: 'float', label: 'Float', category: 'attention', description: 'Drifts up and down, weightless',
    keyframes: [
      { at: '0%, 100%', declarations: { translate: '0 0' } },
      { at: '50%', declarations: { translate: '0 calc(-1 * var(--heo-y, 8px))' } },
    ],
    ...single('distance', 'Height', 'length', '--heo-y', '8px'),
    defaults: { ...LOOP, duration: 3200 }, triggers: LOOP_TRIGGERS,
  },
  {
    id: 'bounce', label: 'Bounce', category: 'attention', description: 'Hops and lands',
    keyframes: [
      { at: '0%, 100%', declarations: { translate: '0 0', 'animation-timing-function': 'cubic-bezier(0.3, 0, 0.7, 1)' } },
      { at: '40%', declarations: { translate: '0 calc(-1 * var(--heo-y, 14px))', 'animation-timing-function': 'cubic-bezier(0.3, 0, 0.7, 1)' } },
      { at: '60%', declarations: { translate: '0 0' } },
      { at: '75%', declarations: { translate: '0 calc(-0.3 * var(--heo-y, 14px))' } },
    ],
    ...single('distance', 'Height', 'length', '--heo-y', '14px'),
    defaults: { ...LOOP, duration: 1100 }, triggers: LOOP_TRIGGERS,
  },
  {
    id: 'pulse', label: 'Pulse', category: 'attention', description: 'Swells a little, and back',
    keyframes: [{ at: '50%', declarations: { scale: 'var(--heo-scale, 1.06)' } }],
    ...single('scale', 'Scale', 'number', '--heo-scale', '1.06'),
    defaults: { ...LOOP, duration: 1600 }, triggers: LOOP_TRIGGERS,
  },
  {
    id: 'heartbeat', label: 'Heartbeat', category: 'attention', description: 'Two quick beats, a rest',
    keyframes: [
      { at: '0%, 40%, 100%', declarations: { scale: '1' } },
      { at: '15%, 55%', declarations: { scale: 'var(--heo-scale, 1.12)' } },
    ],
    ...single('scale', 'Scale', 'number', '--heo-scale', '1.12'),
    defaults: { ...LOOP, duration: 1400, easing: 'ease' }, triggers: LOOP_TRIGGERS,
  },
  {
    id: 'shake', label: 'Shake', category: 'attention', description: 'Side to side, as a no',
    keyframes: [
      { at: '0%, 100%', declarations: { translate: '0 0' } },
      { at: '20%, 60%', declarations: { translate: 'calc(-1 * var(--heo-x, 6px)) 0' } },
      { at: '40%, 80%', declarations: { translate: 'var(--heo-x, 6px) 0' } },
    ],
    ...single('distance', 'Distance', 'length', '--heo-x', '6px'),
    defaults: { ...LOOP, duration: 500, iterations: '1', easing: 'ease' }, triggers: LOOP_TRIGGERS,
  },
  {
    id: 'wiggle', label: 'Wiggle', category: 'attention', description: 'Rocks on its centre',
    keyframes: [
      { at: '0%, 100%', declarations: { rotate: '0deg' } },
      { at: '25%', declarations: { rotate: 'calc(-1 * var(--heo-rotate, 4deg))' } },
      { at: '75%', declarations: { rotate: 'var(--heo-rotate, 4deg)' } },
    ],
    ...single('angle', 'Angle', 'angle', '--heo-rotate', '4deg'),
    defaults: { ...LOOP, duration: 700, iterations: '2' }, triggers: LOOP_TRIGGERS,
  },
  {
    id: 'spin', label: 'Spin', category: 'attention', description: 'A full turn',
    keyframes: [{ at: 'to', declarations: { rotate: 'var(--heo-turn, 360deg)' } }],
    params: [{ key: 'way', label: 'Way', kind: 'select', default: 'cw', options: [{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Anticlockwise' }] }],
    vars: (p) => lean({ '--heo-turn': p.way === 'ccw' ? '-360deg' : '360deg' }, { '--heo-turn': '360deg' }),
    read: (v) => ({ way: v['--heo-turn']?.trim() === '-360deg' ? 'ccw' : 'cw' }),
    defaults: { ...LOOP, duration: 2000, easing: 'linear' }, triggers: LOOP_TRIGGERS,
  },

  /* ---- Scroll-driven ---- */
  {
    id: 'parallax', label: 'Parallax', category: 'scroll', featured: true,
    description: 'Moves slower than the page as it scrolls past',
    keyframes: [
      { at: 'from', declarations: { translate: '0 var(--heo-y, 60px)' } },
      { at: 'to', declarations: { translate: '0 calc(-1 * var(--heo-y, 60px))' } },
    ],
    ...single('distance', 'Depth', 'length', '--heo-y', '60px'),
    defaults: SCROLLED, triggers: ['scroll'], scrollTimeline: 'view',
  },
  {
    id: 'spotlight', label: 'Spotlight', category: 'scroll', featured: true,
    description: 'Comes forward at the middle of the screen, recedes at the edges',
    keyframes: [
      { at: '0%, 100%', declarations: { opacity: 'var(--heo-opacity, 0.25)', scale: 'var(--heo-scale, 0.9)' } },
      { at: '50%', declarations: { opacity: '1', scale: '1' } },
    ],
    params: [
      { key: 'scale', label: 'Edge scale', kind: 'number', default: '0.9' },
      { key: 'opacity', label: 'Edge opacity', kind: 'number', default: '0.25' },
    ],
    vars: (p) => lean({ '--heo-scale': p.scale || '0.9', '--heo-opacity': p.opacity || '0.25' }, { '--heo-scale': '0.9', '--heo-opacity': '0.25' }),
    read: (v) => ({ scale: v['--heo-scale']?.trim() || '0.9', opacity: v['--heo-opacity']?.trim() || '0.25' }),
    defaults: SCROLLED, triggers: ['scroll'], scrollTimeline: 'view',
  },
  {
    id: 'progress', label: 'Reading progress', category: 'scroll', featured: true,
    description: 'Fills from the left as the page is read: put it on a thin bar',
    keyframes: [
      { at: 'from', declarations: { scale: '0 1', 'transform-origin': '0 50%' } },
      { at: 'to', declarations: { scale: '1 1', 'transform-origin': '0 50%' } },
    ],
    params: [], vars: () => ({}), read: () => ({}),
    defaults: SCROLLED, triggers: ['scroll'], scrollTimeline: 'root',
  },
];

const WIPES: Record<string, string> = {
  up: 'inset(100% 0 0 0)',
  down: 'inset(0 0 100% 0)',
  left: 'inset(0 0 0 100%)',
  right: 'inset(0 100% 0 0)',
};

export const presetById = (id: string): AnimationPreset | undefined => PRESETS.find((one) => one.id === id.trim());
export const keyframesName = (preset: AnimationPreset): string => `heo-${preset.id}`;

export const TRIGGER_LABELS: Record<Trigger, string> = {
  load: 'On load',
  'in-view': 'In view',
  scroll: 'On scroll',
  hover: 'Hover',
};

/** Every property this editor writes or takes away. */
export const ANIMATION_LONGHANDS = [
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'animation-iteration-count',
  'animation-direction',
  'animation-fill-mode',
  'animation-timeline',
  'animation-range',
] as const;
export const ANIMATION_VARS = ['--heo-x', '--heo-y', '--heo-opacity', '--heo-scale', '--heo-blur', '--heo-spread', '--heo-color', '--heo-rotate', '--heo-axis', '--heo-turn', '--heo-clip'] as const;
/** Everything that can describe an element's animation, the shorthand included, for folding. */
export const ANIMATION_PROPERTIES: readonly string[] = ['animation', ...ANIMATION_LONGHANDS, 'animation-range-start', 'animation-range-end', 'animation-play-state', ...ANIMATION_VARS];

/* -------------------------------------------------------------------------- */
/* Composing and reading                                                       */
/* -------------------------------------------------------------------------- */

/** A preset with its defaults, ready to write. */
export function defaultConfig(preset: AnimationPreset, trigger?: Trigger): AnimationConfig {
  const params = Object.fromEntries(preset.params.map((one) => [one.key, one.default]));
  const chosen = trigger && preset.triggers.includes(trigger) ? trigger : preset.defaults.trigger;
  return { preset: preset.id, params, ...preset.defaults, trigger: chosen };
}

const isScrollDriven = (trigger: Trigger): boolean => trigger === 'in-view' || trigger === 'scroll';

/**
 * The declarations an animation is, in order. Hover's are the same; it is where they are written
 * (the element's `:hover` state) that makes it a hover animation.
 */
export function composeAnimation(config: AnimationConfig): Record<string, string> {
  const preset = presetById(config.preset);
  if (!preset) return {};
  const out: Record<string, string> = { ...preset.vars(config.params) };
  const driven = isScrollDriven(config.trigger);
  out['animation-name'] = keyframesName(preset);
  // `auto` is a scroll timeline's own length, and in a browser without scroll timelines an
  // animation of no length ends at once, so the content shows rather than waiting on a trigger.
  out['animation-duration'] = driven ? 'auto' : `${Math.max(0, Math.round(config.duration))}ms`;
  out['animation-timing-function'] = config.easing || 'ease';
  if (!driven && config.delay > 0) out['animation-delay'] = `${Math.round(config.delay)}ms`;
  if (!driven && config.iterations !== '1') out['animation-iteration-count'] = config.iterations;
  if (config.direction !== 'normal') out['animation-direction'] = config.direction;
  // Reveals hold their first frame before they start and their last after; loops rest as they are.
  if (preset.category !== 'attention' || driven) out['animation-fill-mode'] = 'both';
  if (config.trigger === 'in-view') {
    out['animation-timeline'] = 'view()';
    out['animation-range'] = config.range === 'enter' ? 'entry 0% entry 100%' : 'entry 0% cover 40%';
  } else if (config.trigger === 'scroll') {
    if (preset.scrollTimeline === 'root') {
      out['animation-timeline'] = 'scroll(root)';
    } else {
      out['animation-timeline'] = 'view()';
      out['animation-range'] = 'cover 0% cover 100%';
    }
  }
  return out;
}

/**
 * The animation an element's declarations describe, or null when it is not one of these. `read`
 * gives a property's written value, '' when none. `hover` says the values came from `:hover`.
 */
export function readAnimation(read: (property: string) => string, hover = false): AnimationConfig | null {
  const name = read('animation-name').trim() || (/\bheo-[a-z-]+/.exec(read('animation'))?.[0] ?? '');
  const preset = PRESETS.find((one) => keyframesName(one) === name);
  if (!preset) return null;
  const vars = Object.fromEntries(ANIMATION_VARS.map((one) => [one, read(one).trim()]).filter(([, value]) => value));
  const timeline = read('animation-timeline').trim();
  const range = read('animation-range').trim();
  const trigger: Trigger = hover ? 'hover'
    : timeline.startsWith('scroll') ? 'scroll'
      : timeline.startsWith('view') ? (range.startsWith('cover') || !preset.triggers.includes('in-view') ? 'scroll' : 'in-view')
        : 'load';
  const ms = (text: string, fallback: number): number => {
    const match = /^(-?[\d.]+)(ms|s)$/.exec(text.trim());
    return match ? parseFloat(match[1]!) * (match[2] === 's' ? 1000 : 1) : fallback;
  };
  const direction = read('animation-direction').trim();
  return {
    preset: preset.id,
    params: { ...defaultConfig(preset).params, ...preset.read(vars) },
    trigger,
    duration: ms(read('animation-duration'), preset.defaults.duration),
    delay: ms(read('animation-delay'), 0),
    easing: read('animation-timing-function').trim() || preset.defaults.easing,
    iterations: read('animation-iteration-count').trim() || '1',
    direction: (['reverse', 'alternate', 'alternate-reverse'].includes(direction) ? direction : 'normal') as AnimationTiming['direction'],
    range: range.startsWith('entry 0% entry') ? 'enter' : 'relaxed',
  };
}

/* -------------------------------------------------------------------------- */
/* Keyframes as CSS, and for a preview                                         */
/* -------------------------------------------------------------------------- */

export function keyframesCss(preset: AnimationPreset): string {
  const frames = preset.keyframes
    .map((frame) => `  ${frame.at} {\n${Object.entries(frame.declarations).map(([p, v]) => `    ${p}: ${v};`).join('\n')}\n  }`)
    .join('\n');
  return `@keyframes ${keyframesName(preset)} {\n${frames}\n}`;
}

/** The library as CSS: every preset, or only those named. */
export function animationLibraryCss(names?: ReadonlySet<string>): string {
  return PRESETS.filter((one) => !names || names.has(keyframesName(one))).map(keyframesCss).join('\n\n');
}

/** The library keyframe names that appear in a piece of CSS (a rule, a style attribute). */
export function animationNamesIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\bheo-[a-z]+(?:-[a-z]+)*\b/g)) {
    if (PRESETS.some((one) => keyframesName(one) === match[0])) found.add(match[0]);
  }
  return [...found];
}

/** `var(--heo-y, 24px)` with the element's values put in, as a preview has no stylesheet to read. */
export function resolveVars(value: string, vars: Record<string, string>): string {
  let text = value;
  for (let pass = 0; pass < 4 && text.includes('var('); pass++) {
    text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_, name: string, fallback = '') => vars[name] ?? fallback.trim());
  }
  return text;
}

export interface PreviewFrame {
  offset: number;
  [property: string]: string | number;
}

/** A preset's keyframes for `element.animate()`, with these parameters put in. */
export function previewFrames(config: AnimationConfig): { frames: PreviewFrame[]; options: KeyframeAnimationOptions } | null {
  const preset = presetById(config.preset);
  if (!preset) return null;
  const vars = { ...preset.vars(defaultConfig(preset).params), ...preset.vars(config.params) };
  const frames: PreviewFrame[] = [];
  for (const frame of preset.keyframes) {
    for (const at of frame.at.split(',')) {
      const word = at.trim();
      const offset = word === 'from' ? 0 : word === 'to' ? 1 : parseFloat(word) / 100;
      const out: PreviewFrame = { offset };
      for (const [property, value] of Object.entries(frame.declarations)) {
        const key = property === 'animation-timing-function' ? 'easing' : property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        out[key] = resolveVars(value, vars);
      }
      frames.push(out);
    }
  }
  frames.sort((a, b) => a.offset - b.offset);
  const driven = isScrollDriven(config.trigger);
  const iterations = config.iterations === 'infinite' ? 2 : Math.min(3, Number(config.iterations) || 1);
  return {
    frames,
    options: {
      duration: driven ? 1400 : Math.max(200, config.duration),
      easing: config.easing || 'ease',
      iterations: driven ? 1 : iterations,
      direction: config.direction,
      fill: 'none',
    },
  };
}
