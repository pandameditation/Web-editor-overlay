/** Version reported by the public API and stamped on the host element. */
export const VERSION = '2.0.0';

/** Tag name of the single host element the whole overlay lives inside. */
export const HOST_TAG = 'html-editor-overlay';

/** Any element carrying this attribute (and its subtree) is invisible to the editor. */
export const IGNORE_ATTR = 'data-heo-ignore';

/**
 * A `<style>` standing in for a `<link>` the browser will not let the page read.
 *
 * Its own marker rather than one of the two that already exist, because it needs the
 * opposite of both: `data-heo-internal` hides a sheet from the cascade inspector,
 * which is the one place this sheet exists to be seen, and `data-heo-generated`
 * survives the export, which would bake a copy of the linked file into the HTML.
 * This one means "visible to the editor, absent from the export".
 */
export const MIRROR_ATTR = 'data-heo-mirror';

/**
 * A tag put into the page by tooling, which must never be written back to the file.
 *
 * The distinction it draws is between a script that is *in* your HTML and one that a dev
 * server or a plugin added on the way to the browser. Both are in the DOM and the export
 * serializes the DOM, so without a way to tell them apart, saving writes the injected one
 * into the source — and the next request injects it again on top, so the file grows a
 * copy per save.
 *
 * Only for tags the overlay's own tooling injects. A script the page author added by hand
 * is theirs and stays, even when it is the overlay's own bundle: it is already in the file,
 * so writing it back changes nothing.
 */
export const INJECTED_ATTR = 'data-heo-injected';

/**
 * Marks a region the page's own code built, for the length of one export.
 *
 * Set just before the document is cloned and removed immediately after, so it rides along
 * with `cloneNode` and can be stripped from the copy. It never survives a tick of the live
 * page and never reaches a file — pairing the two trees up by position afterwards was the
 * alternative, and that is index arithmetic waiting to meet an implied `<tbody>`.
 */
export const RENDERED_ATTR = 'data-heo-rendered';

/**
 * Marks a control holding an edit the user has not committed.
 *
 * Read as a plain attribute so the keymap can tell that a keystroke belongs to the
 * panel without knowing anything about the panel's components.
 */
export const DIRTY_ATTR = 'data-heo-dirty';

/**
 * Fired on `document` when undo takes back an edit that was still being typed.
 *
 * The engine can restore the page on its own, but the box the draft lives in is the
 * control's private state, so it has to be told to let go of it.
 */
export const EDIT_DISCARDED_EVENT = 'heo-edit-discarded';

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
 * Set on `<html>` while a modal is open, so the page stops scrolling behind it.
 *
 * An attribute rather than an inline style because `exportHTML` clones `<html>`:
 * a style set while a dialog was open would be baked into a page exported from
 * that dialog's own footer. An attribute is one thing to strip.
 */
export const MODAL_ATTR = 'data-heo-modal';

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
  /**
   * How long the pointer must hold a re-parent gesture.
   *
   * Changing which parent an element belongs to is a bigger edit than reordering
   * within one, and it is the edit that reflows ancestors — so it is gated behind a
   * deliberate pause rather than available on any pointer move.
   */
  reparent: 200,
  /** Poll interval while a re-parent countdown is running. */
  tick: 40,
} as const;

/** id of the `<style>` element the token editor writes into. */
export const TOKEN_STYLE_ID = 'heo-design-tokens';

/** id of the `<style>` element the class editor writes into. */
export const CLASS_STYLE_ID = 'heo-design-classes';

/** id of the `<style>` element block CSS accumulates in. */
export const BLOCK_STYLE_ID = 'heo-block-styles';

/**
 * Elements that are never selectable.
 *
 * The SVG entries are definition and paint-server nodes: they render nothing of
 * their own, so listing them in the tree would be noise between the `<svg>` and
 * the shapes actually worth selecting.
 */
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
  'defs',
  'desc',
  'metadata',
  'clippath',
  'mask',
  'symbol',
  'lineargradient',
  'radialgradient',
  'stop',
  'pattern',
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
