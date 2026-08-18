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
