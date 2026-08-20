/** Version reported by the public API and stamped on the host element. */
export const VERSION = '2.0.0';

/** Tag name of the single host element the whole overlay lives inside. */
export const HOST_TAG = 'html-editor-overlay';

/** Any element carrying this attribute (and its subtree) is invisible to the editor. */
export const IGNORE_ATTR = 'data-heo-ignore';

/** Source location marker, written by the Vite plugin: `file:line:column`. */
export const SOURCE_ATTR = 'data-heo-src';

/** Marks elements the overlay itself created, so the save prompt can call them out. */
export const INSERTED_ATTR = 'data-heo-inserted';

/**
 * Set on the element being dragged, so the page stylesheet can render it as a
 * translucent preview of where it will land.
 */
export const DRAGGING_ATTR = 'data-heo-dragging';

/**
 * Timings for the reorder gesture, in milliseconds.
 *
 * `dwell` is the heart of it: a candidate position has to persist before the DOM
 * is touched, so a pointer grazing a midpoint cannot start a move. `settle`
 * covers the reflow a move causes — during it, different elements sit under the
 * pointer, and reacting to that immediately is what produced the flicker loop.
 */
export const DRAG_TIMING = {
  dwell: 90,
  settle: 190,
  flip: 190,
  drop: 180,
  /** Pointer travel that overrides the settle freeze, for deliberate fast drags. */
  escape: 26,
} as const;

/** id of the `<style>` element the token editor writes into. */
export const TOKEN_STYLE_ID = 'heo-design-tokens';

/** id of the `<style>` element the class editor writes into. */
export const CLASS_STYLE_ID = 'heo-design-classes';

/** id of the `<style>` element block CSS accumulates in. */
export const BLOCK_STYLE_ID = 'heo-block-styles';

/** Elements that are never selectable. */
export const NON_SELECTABLE_TAGS = new Set([
  'html',
  'head',
  'meta',
  'link',
  'title',
  'base',
  'script',
  'style',
  'noscript',
  'br',
  'wbr',
  HOST_TAG,
]);

/** Elements that cannot hold children, so insertion targets them as siblings only. */
export const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Native interactive elements whose default behaviour we keep usable in edit mode. */
export const NATIVE_INPUT_TAGS = new Set(['input', 'select', 'textarea', 'option', 'optgroup']);

/** z-index band reserved for overlay chrome. */
export const Z_BASE = 2147482000;
