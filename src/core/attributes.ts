import { safeURL, URL_ATTRIBUTES } from './sanitize.js';

/**
 * The HTML attribute catalogue, and the rules for writing one safely.
 *
 * The counterpart to the property catalogue in `css.ts`, and it exists for the same reason: the
 * props panel could only ever edit an attribute that was *already there*, because nothing in the
 * codebase knew the name of an attribute nobody had written yet. `TAG_ATTRIBUTES` in `props.ts` is
 * a different thing and stays as it is — a small curated set of attributes worth a typed form row
 * per tag. This is the broad set, for finding and adding.
 *
 * Safety lives here too, next to the names, because this is the module that made arbitrary
 * attributes reachable from the UI. Every guard the markup path already applied through
 * `sanitize.ts` has to apply here as well: before this, `setAttribute` was only ever handed a name
 * from a hardcoded table, so it needed no opinion about `onclick`.
 */

export type AttributeGroup =
  | 'global'
  | 'aria'
  | 'link'
  | 'media'
  | 'embed'
  | 'form'
  | 'table'
  | 'list'
  | 'meta'
  | 'data';

export interface AttributeMeta {
  name: string;
  group: AttributeGroup;
  /**
   * Tags the attribute belongs on. Absent means it applies to everything.
   *
   * Used for ranking rather than filtering: searching on a `<div>` should not put `srcset` above
   * `data-`, but an attribute genuinely does sometimes belong on an element the spec disagrees
   * about, and refusing to offer it would be the editor overruling the user.
   */
  tags?: string[];
  /** Allowed values, offered first in the value field. */
  values?: string[];
  /** Present-or-absent rather than a value. */
  boolean?: boolean;
  /** Shown as placeholder text. */
  hint?: string;
}

export const ATTRIBUTE_GROUP_LABELS: Record<AttributeGroup, string> = {
  global: 'Global',
  aria: 'Accessibility',
  link: 'Link',
  media: 'Media',
  embed: 'Embedded',
  form: 'Form',
  table: 'Table',
  list: 'List',
  meta: 'Metadata',
  data: 'Custom data',
};

const BOOL = { boolean: true } as const;

/**
 * The catalogue.
 *
 * Deliberately broader than the form rows in `props.ts`: this is what somebody reaches for when
 * they know the attribute exists and want it on this element. Event handlers are the one omission,
 * and that is not an oversight — see `attributeRefusal`.
 */
export const HTML_ATTRIBUTES: AttributeMeta[] = [
  /* Global -------------------------------------------------------------- */
  { name: 'id', group: 'global' },
  { name: 'title', group: 'global', hint: 'tooltip text' },
  { name: 'lang', group: 'global', hint: 'en, fr, de-CH' },
  { name: 'dir', group: 'global', values: ['ltr', 'rtl', 'auto'] },
  { name: 'hidden', group: 'global', ...BOOL },
  { name: 'inert', group: 'global', ...BOOL },
  { name: 'tabindex', group: 'global', values: ['0', '-1'] },
  { name: 'accesskey', group: 'global' },
  { name: 'autofocus', group: 'global', ...BOOL },
  { name: 'translate', group: 'global', values: ['yes', 'no'] },
  { name: 'contenteditable', group: 'global', values: ['true', 'false', 'plaintext-only'] },
  { name: 'spellcheck', group: 'global', values: ['true', 'false'] },
  { name: 'autocapitalize', group: 'global', values: ['off', 'none', 'sentences', 'words', 'characters'] },
  { name: 'draggable', group: 'global', values: ['true', 'false'] },
  { name: 'enterkeyhint', group: 'global', values: ['enter', 'done', 'go', 'next', 'previous', 'search', 'send'] },
  { name: 'inputmode', group: 'global', values: ['none', 'text', 'decimal', 'numeric', 'tel', 'search', 'email', 'url'] },
  { name: 'popover', group: 'global', values: ['auto', 'manual'] },
  { name: 'slot', group: 'global' },
  { name: 'part', group: 'global' },
  { name: 'exportparts', group: 'global' },
  { name: 'is', group: 'global' },

  /* Accessibility ------------------------------------------------------- */
  { name: 'role', group: 'aria', hint: 'button, navigation, dialog' },
  { name: 'aria-label', group: 'aria' },
  { name: 'aria-labelledby', group: 'aria' },
  { name: 'aria-describedby', group: 'aria' },
  { name: 'aria-description', group: 'aria' },
  { name: 'aria-details', group: 'aria' },
  { name: 'aria-hidden', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-disabled', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-expanded', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-pressed', group: 'aria', values: ['true', 'false', 'mixed'] },
  { name: 'aria-checked', group: 'aria', values: ['true', 'false', 'mixed'] },
  { name: 'aria-selected', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-current', group: 'aria', values: ['page', 'step', 'location', 'date', 'time', 'true', 'false'] },
  { name: 'aria-live', group: 'aria', values: ['off', 'polite', 'assertive'] },
  { name: 'aria-atomic', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-relevant', group: 'aria', values: ['additions', 'removals', 'text', 'all'] },
  { name: 'aria-busy', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-controls', group: 'aria' },
  { name: 'aria-owns', group: 'aria' },
  { name: 'aria-haspopup', group: 'aria', values: ['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'] },
  { name: 'aria-modal', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-invalid', group: 'aria', values: ['false', 'true', 'grammar', 'spelling'] },
  { name: 'aria-errormessage', group: 'aria' },
  { name: 'aria-required', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-readonly', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-placeholder', group: 'aria' },
  { name: 'aria-autocomplete', group: 'aria', values: ['none', 'inline', 'list', 'both'] },
  { name: 'aria-multiline', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-multiselectable', group: 'aria', values: ['true', 'false'] },
  { name: 'aria-orientation', group: 'aria', values: ['horizontal', 'vertical'] },
  { name: 'aria-sort', group: 'aria', values: ['none', 'ascending', 'descending', 'other'] },
  { name: 'aria-level', group: 'aria' },
  { name: 'aria-posinset', group: 'aria' },
  { name: 'aria-setsize', group: 'aria' },
  { name: 'aria-valuenow', group: 'aria' },
  { name: 'aria-valuemin', group: 'aria' },
  { name: 'aria-valuemax', group: 'aria' },
  { name: 'aria-valuetext', group: 'aria' },
  { name: 'aria-roledescription', group: 'aria' },
  { name: 'aria-keyshortcuts', group: 'aria' },
  { name: 'aria-activedescendant', group: 'aria' },
  { name: 'aria-colcount', group: 'aria' },
  { name: 'aria-colindex', group: 'aria' },
  { name: 'aria-colspan', group: 'aria' },
  { name: 'aria-rowcount', group: 'aria' },
  { name: 'aria-rowindex', group: 'aria' },
  { name: 'aria-rowspan', group: 'aria' },
  { name: 'aria-flowto', group: 'aria' },

  /* Links --------------------------------------------------------------- */
  { name: 'href', group: 'link', tags: ['a', 'area', 'link', 'base'], hint: '/page or https://' },
  { name: 'target', group: 'link', tags: ['a', 'area', 'form', 'base'], values: ['_self', '_blank', '_parent', '_top'] },
  { name: 'rel', group: 'link', tags: ['a', 'area', 'link'], values: ['noopener', 'noreferrer', 'nofollow', 'external', 'me'] },
  { name: 'download', group: 'link', tags: ['a', 'area'] },
  { name: 'hreflang', group: 'link', tags: ['a', 'link'] },
  { name: 'ping', group: 'link', tags: ['a', 'area'] },
  { name: 'referrerpolicy', group: 'link', tags: ['a', 'area', 'img', 'iframe', 'link', 'script'], values: ['no-referrer', 'origin', 'same-origin', 'strict-origin-when-cross-origin', 'unsafe-url'] },

  /* Media --------------------------------------------------------------- */
  { name: 'src', group: 'media', tags: ['img', 'video', 'audio', 'source', 'iframe', 'embed', 'script', 'track', 'input'] },
  { name: 'srcset', group: 'media', tags: ['img', 'source'] },
  { name: 'sizes', group: 'media', tags: ['img', 'source', 'link'] },
  { name: 'alt', group: 'media', tags: ['img', 'area', 'input'] },
  { name: 'width', group: 'media', tags: ['img', 'video', 'canvas', 'iframe', 'embed', 'object', 'input'] },
  { name: 'height', group: 'media', tags: ['img', 'video', 'canvas', 'iframe', 'embed', 'object', 'input'] },
  { name: 'loading', group: 'media', tags: ['img', 'iframe'], values: ['lazy', 'eager'] },
  { name: 'decoding', group: 'media', tags: ['img'], values: ['async', 'sync', 'auto'] },
  { name: 'fetchpriority', group: 'media', tags: ['img', 'link', 'script'], values: ['high', 'low', 'auto'] },
  { name: 'crossorigin', group: 'media', tags: ['img', 'video', 'audio', 'script', 'link'], values: ['anonymous', 'use-credentials'] },
  { name: 'poster', group: 'media', tags: ['video'] },
  { name: 'controls', group: 'media', tags: ['video', 'audio'], ...BOOL },
  { name: 'autoplay', group: 'media', tags: ['video', 'audio'], ...BOOL },
  { name: 'loop', group: 'media', tags: ['video', 'audio'], ...BOOL },
  { name: 'muted', group: 'media', tags: ['video', 'audio'], ...BOOL },
  { name: 'playsinline', group: 'media', tags: ['video'], ...BOOL },
  { name: 'preload', group: 'media', tags: ['video', 'audio'], values: ['none', 'metadata', 'auto'] },
  { name: 'kind', group: 'media', tags: ['track'], values: ['subtitles', 'captions', 'descriptions', 'chapters', 'metadata'] },
  { name: 'srclang', group: 'media', tags: ['track'] },

  /* Embedded content ---------------------------------------------------- */
  { name: 'srcdoc', group: 'embed', tags: ['iframe'] },
  { name: 'allow', group: 'embed', tags: ['iframe'] },
  { name: 'allowfullscreen', group: 'embed', tags: ['iframe'], ...BOOL },
  { name: 'sandbox', group: 'embed', tags: ['iframe'], values: ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups'] },
  { name: 'data', group: 'embed', tags: ['object'] },

  /* Forms --------------------------------------------------------------- */
  { name: 'name', group: 'form', tags: ['input', 'select', 'textarea', 'button', 'form', 'output', 'fieldset', 'iframe', 'object', 'map', 'meta'] },
  { name: 'value', group: 'form', tags: ['input', 'button', 'option', 'li', 'progress', 'meter', 'param'] },
  { name: 'type', group: 'form', tags: ['input', 'button', 'script', 'link', 'source', 'ol', 'object', 'embed'] },
  { name: 'placeholder', group: 'form', tags: ['input', 'textarea'] },
  { name: 'required', group: 'form', tags: ['input', 'select', 'textarea'], ...BOOL },
  { name: 'disabled', group: 'form', tags: ['input', 'select', 'textarea', 'button', 'fieldset', 'option', 'optgroup'], ...BOOL },
  { name: 'readonly', group: 'form', tags: ['input', 'textarea'], ...BOOL },
  { name: 'checked', group: 'form', tags: ['input'], ...BOOL },
  { name: 'multiple', group: 'form', tags: ['input', 'select'], ...BOOL },
  { name: 'min', group: 'form', tags: ['input', 'meter', 'progress'] },
  { name: 'max', group: 'form', tags: ['input', 'meter', 'progress'] },
  { name: 'step', group: 'form', tags: ['input'] },
  { name: 'pattern', group: 'form', tags: ['input'] },
  { name: 'minlength', group: 'form', tags: ['input', 'textarea'] },
  { name: 'maxlength', group: 'form', tags: ['input', 'textarea'] },
  { name: 'size', group: 'form', tags: ['input', 'select'] },
  { name: 'rows', group: 'form', tags: ['textarea'] },
  { name: 'cols', group: 'form', tags: ['textarea'] },
  { name: 'wrap', group: 'form', tags: ['textarea'], values: ['soft', 'hard'] },
  { name: 'accept', group: 'form', tags: ['input'] },
  { name: 'autocomplete', group: 'form', tags: ['input', 'select', 'textarea', 'form'], values: ['on', 'off', 'name', 'email', 'username', 'current-password', 'new-password', 'one-time-code'] },
  { name: 'list', group: 'form', tags: ['input'] },
  { name: 'form', group: 'form', tags: ['input', 'select', 'textarea', 'button', 'output', 'fieldset'] },
  { name: 'action', group: 'form', tags: ['form'] },
  { name: 'method', group: 'form', tags: ['form'], values: ['get', 'post', 'dialog'] },
  { name: 'enctype', group: 'form', tags: ['form'], values: ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'] },
  { name: 'novalidate', group: 'form', tags: ['form'], ...BOOL },
  { name: 'for', group: 'form', tags: ['label', 'output'] },
  { name: 'selected', group: 'form', tags: ['option'], ...BOOL },
  { name: 'label', group: 'form', tags: ['option', 'optgroup', 'track'] },
  { name: 'open', group: 'form', tags: ['details', 'dialog'], ...BOOL },

  /* Tables -------------------------------------------------------------- */
  { name: 'colspan', group: 'table', tags: ['td', 'th'] },
  { name: 'rowspan', group: 'table', tags: ['td', 'th'] },
  { name: 'headers', group: 'table', tags: ['td', 'th'] },
  { name: 'scope', group: 'table', tags: ['th'], values: ['col', 'row', 'colgroup', 'rowgroup'] },
  { name: 'abbr', group: 'table', tags: ['th'] },
  { name: 'span', group: 'table', tags: ['col', 'colgroup'] },

  /* Lists --------------------------------------------------------------- */
  { name: 'start', group: 'list', tags: ['ol'] },
  { name: 'reversed', group: 'list', tags: ['ol'], ...BOOL },

  /* Metadata ------------------------------------------------------------ */
  { name: 'datetime', group: 'meta', tags: ['time', 'ins', 'del'] },
  { name: 'cite', group: 'meta', tags: ['blockquote', 'q', 'ins', 'del'] },
  { name: 'media', group: 'meta', tags: ['source', 'link', 'style'] },
  { name: 'integrity', group: 'meta', tags: ['script', 'link'] },
  { name: 'itemprop', group: 'meta' },
  { name: 'itemscope', group: 'meta', ...BOOL },
  { name: 'itemtype', group: 'meta' },
  { name: 'itemid', group: 'meta' },
  { name: 'itemref', group: 'meta' },
];

const INDEX = new Map(HTML_ATTRIBUTES.map((meta) => [meta.name, meta]));

/** The catalogue entry, or undefined for a name it does not list. */
export function attributeMeta(name: string): AttributeMeta | undefined {
  return INDEX.get(name.toLowerCase());
}

/** True for the one prefix HTML reserves for arbitrary names. */
export function isDataAttribute(name: string): boolean {
  return /^data-[^\s"'>/=]+$/.test(name.toLowerCase());
}

/**
 * Whether the browser will accept this as an attribute name.
 *
 * The HTML spec forbids whitespace, quotes, `>`, `/`, `=` and control characters, and requires at
 * least one character. Worth checking before writing rather than after: `el.setAttribute` throws
 * `InvalidCharacterError` on a bad name, and that throw would happen inside a history command's
 * `apply`, leaving an entry on the undo stack for a change that never landed.
 */
export function isValidAttributeName(name: string): boolean {
  return name.length > 0 && !/[\s"'>/=]/.test(name) && !/[\u0000-\u001f\u007f-\u009f]/.test(name);
}

/**
 * Why this attribute must not be written, or null when it may be.
 *
 * The reason is returned rather than a boolean because every one of these is something the user
 * needs telling: silently dropping an `onclick` they deliberately typed is the worst outcome, since
 * the editor would appear to have accepted it.
 *
 * `on*` is refused outright. The overlay writes into a live page and then serialises that page to
 * disk, so an event handler added here is both executed immediately and exported — which makes this
 * the one place in the editor that could turn an editing session into stored script injection.
 * `sanitize.ts` has always stripped `on*` from pasted markup for exactly that reason; this is the
 * same rule at the other door.
 */
export function attributeRefusal(name: string, value: string, tag: string): string | null {
  const lower = name.toLowerCase();
  if (!isValidAttributeName(name)) {
    return `${name} is not a valid attribute name.`;
  }
  if (lower.startsWith('on')) {
    return `Event handler attributes like ${lower} are not allowed — they would run in the page and be written into the saved file.`;
  }
  if (lower === 'style') {
    return 'Use the Styles panel for style, so the declarations stay editable.';
  }
  if (lower === 'class') {
    return 'Use the Classes section in Styles for class.';
  }
  if (lower.startsWith('data-heo-')) {
    return `${lower} belongs to the editor itself.`;
  }
  if (value && URL_ATTRIBUTES.has(lower)) {
    const allowDataImage = /^(?:img|source|video|audio|track|image)$/i.test(tag);
    if (!safeURL(value, allowDataImage)) {
      return `That is not a URL the editor will write: ${lower} rejects javascript:, vbscript: and data: URLs.`;
    }
  }
  return null;
}

/**
 * Catalogue entries matching `query`, ranked prefix-first and tag-first.
 *
 * Tag relevance is a ranking and not a filter, so `srcset` is still reachable on a `<div>` — it is
 * simply not the first thing offered there. An empty query lists what belongs on this tag, which
 * makes the chevron in a suggest field into "what can this element have".
 */
export function searchAttributes(query: string, tag: string, limit = 12): AttributeMeta[] {
  const needle = query.trim().toLowerCase();
  const lowerTag = tag.toLowerCase();
  const fits = (meta: AttributeMeta): boolean => !meta.tags || meta.tags.includes(lowerTag);

  const rank = (meta: AttributeMeta): number => {
    const starts = meta.name.startsWith(needle) ? 0 : 2;
    return starts + (fits(meta) ? 0 : 1);
  };

  const matches = HTML_ATTRIBUTES.filter((meta) => !needle || meta.name.includes(needle));
  const ranked = [...matches].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  /*
   * A synthetic row for the arbitrary case.
   *
   * `data-` is the prefix HTML sets aside for names nobody can enumerate, so it cannot be in the
   * catalogue and is the answer whenever somebody wants an attribute the catalogue lacks. Offering
   * it as a completion is how that becomes discoverable rather than folklore.
   */
  const out = needle && !needle.startsWith('data-') && 'data-'.startsWith(needle)
    ? [{ name: 'data-', group: 'data' as const, hint: 'any name you like' }, ...ranked]
    : ranked;

  return out.slice(0, limit);
}

/** What an attribute is for, in a few words, when the catalogue has an opinion. */
export function attributeHint(name: string): string {
  const meta = attributeMeta(name);
  if (meta) return ATTRIBUTE_GROUP_LABELS[meta.group];
  if (isDataAttribute(name) || name === 'data-') return ATTRIBUTE_GROUP_LABELS.data;
  return '';
}
