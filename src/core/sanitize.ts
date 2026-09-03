import type { PropSpec } from './types.js';

/**
 * HTML sanitisation for anything the editor injects into the page.
 *
 * The overlay accepts HTML from three places the page author does not fully
 * control: the block library, the raw HTML code panel, and imported design
 * system files. All three funnel through here. This is deliberately a
 * conservative allow-list on attributes rather than a general-purpose
 * sanitiser: inline event handlers and script-bearing URLs are removed, and
 * `<script>` never survives.
 */

const SAFE_DATA_URL = /^data:image\/(?:gif|jpeg|jpg|png|webp|avif|svg\+xml)[;,]/i;
const SAFE_PROTOCOL = /^(?:https?:|mailto:|tel:|blob:|file:)$/;
/**
 * Attributes whose value is a URL, and therefore has to be vetted.
 *
 * Exported because the props panel now lets a user type an attribute name of their own, so the
 * same list has to gate that door as gates pasted markup. One list, or the two doors drift.
 */
export const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'poster',
  'action',
  'formaction',
  'xlink:href',
]);
const MEDIA_TAGS = /^(?:img|source|video|audio|track|image)$/i;

export function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}

/** Returns the URL when it is safe to keep, otherwise an empty string. */
export function safeURL(value: string, allowDataImage = false): string {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^\s*(?:javascript|vbscript):/i.test(url)) return '';
  if (/^\s*data:/i.test(url)) {
    return allowDataImage && SAFE_DATA_URL.test(url) ? url : '';
  }
  // Fragment, query, root-relative and explicitly relative URLs are fine.
  if (/^(?:#|\?|\/|\.{1,2}\/)/.test(url)) return url;
  try {
    const parsed = new URL(url, document.baseURI);
    return SAFE_PROTOCOL.test(parsed.protocol) ? url : '';
  } catch {
    // A bare relative path such as `images/a.png` fails URL parsing but is safe.
    return /^[\w.@+-]+(?:\/[\w.@%+-]*)*(?:\?[^\s]*)?$/.test(url) ? url : '';
  }
}

/**
 * What sanitisation took out.
 *
 * Counted rather than discarded because someone pasting markup is entitled to know that
 * their `onclick` is gone. Silently dropping it produces the worst kind of bug report — the
 * feature appears to work, the button does nothing, and nothing ever said why.
 */
export interface SanitizeReport {
  /** `<script>` elements removed. */
  scripts: number;
  /** `on*` attributes removed. */
  handlers: number;
  /** URL attributes dropped for pointing somewhere unsafe. */
  urls: number;
  /** `style` attributes dropped for carrying script. */
  styles: number;
}

function emptyReport(): SanitizeReport {
  return { scripts: 0, handlers: 0, urls: 0, styles: 0 };
}

/** True when nothing was taken out. */
export function nothingRemoved(report: SanitizeReport): boolean {
  return !report.scripts && !report.handlers && !report.urls && !report.styles;
}

/**
 * Strip script, event handlers and unsafe URLs from a live subtree, in place.
 *
 * Returns what it removed. Every existing caller ignores that, which is correct for them —
 * the library and the code panel sanitise markup the user is not looking at. The paste route
 * does look at it, and tells them.
 */
export function scrubElement(root: ParentNode): SanitizeReport {
  const report = emptyReport();
  for (const script of Array.from(root.querySelectorAll('script'))) {
    script.remove();
    report.scripts += 1;
  }
  const all = [root, ...Array.from(root.querySelectorAll('*'))].filter(
    (node): node is Element => node instanceof Element,
  );
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        report.handlers += 1;
        continue;
      }
      if (name === 'style' && /(?:expression|javascript:|vbscript:)/i.test(value)) {
        el.removeAttribute(attr.name);
        report.styles += 1;
        continue;
      }
      if (URL_ATTRIBUTES.has(name)) {
        const allowData = MEDIA_TAGS.test(el.tagName);
        if (name === 'srcset') {
          const candidates = value.split(',').map((entry) => entry.trim()).filter(Boolean);
          const kept = candidates.filter((entry) =>
            safeURL(entry.split(/\s+/)[0] ?? '', allowData),
          );
          if (kept.length) el.setAttribute(attr.name, kept.join(', '));
          else el.removeAttribute(attr.name);
          if (kept.length !== candidates.length) report.urls += 1;
          continue;
        }
        if (!safeURL(value, allowData)) {
          el.removeAttribute(attr.name);
          report.urls += 1;
        }
      }
    }
  }
  return report;
}

/**
 * Parse an HTML string into a sanitized fragment.
 *
 * Uses `<template>` so the markup is inert while it is being cleaned: no
 * network requests fire and no scripts run before `scrubElement` gets to it.
 */
export function sanitizeFragment(html: string): DocumentFragment {
  return sanitizeFragmentReporting(html).fragment;
}

/** The same, with an account of what was taken out on the way through. */
export function sanitizeFragmentReporting(html: string): {
  fragment: DocumentFragment;
  report: SanitizeReport;
} {
  const template = document.createElement('template');
  /*
   * Scripts go before the parse, so they are counted here rather than by `scrubElement`.
   *
   * The regex pass exists because a `<script>` that has been parsed is a `<script>` whose
   * `src` the browser may already have queued. Stripping the text first means the markup is
   * inert before it becomes nodes at all — belt and braces with the removal inside
   * `scrubElement`, which catches whatever the regex could not see.
   */
  const source = String(html ?? '');
  let scripts = 0;
  template.innerHTML = source
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, () => {
      scripts += 1;
      return '';
    })
    .replace(/<script\b[^>]*\/?>/gi, () => {
      scripts += 1;
      return '';
    });
  const report = scrubElement(template.content);
  report.scripts += scripts;
  return { fragment: template.content, report };
}

/**
 * What inserting this markup would produce, without inserting it.
 *
 * The paste route needs to say three things before anything is committed: how many elements
 * arrive, what sanitisation took out, and whether any of it will be dropped for a reason
 * that has nothing to do with safety.
 *
 * That last one is the easy mistake. Insertion works in elements, so text sitting at the top
 * level of a paste — the `Hello ` in `Hello <b>world</b>` — has nowhere to go and disappears.
 * Reporting it is the difference between a tool with a documented edge and a tool that eats
 * half your paragraph.
 */
export interface MarkupPreview {
  /** Elements that would be inserted. */
  elements: number;
  /** Tag names of those elements, in order, for a short summary. */
  tags: string[];
  /** True when text outside any element would be lost. */
  looseText: boolean;
  report: SanitizeReport;
}

export function previewMarkup(html: string): MarkupPreview {
  const { fragment, report } = sanitizeFragmentReporting(html);
  const tags = Array.from(fragment.children)
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map((node) => node.tagName.toLowerCase());
  const looseText = Array.from(fragment.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0,
  );
  return { elements: tags.length, tags, looseText, report };
}

/** Parse to a single element, or null when the markup has no element root. */
export function sanitizeToElement(html: string): HTMLElement | null {
  const fragment = sanitizeFragment(html);
  const first = fragment.firstElementChild;
  return first instanceof HTMLElement ? first : null;
}

/* -------------------------------------------------------------------------- */
/* Block templates                                                             */
/* -------------------------------------------------------------------------- */

/** Coerce a prop value to something safe to interpolate into a template. */
export function safePropValue(value: unknown, spec?: PropSpec): string {
  const type = spec?.type ?? 'text';
  const raw = value ?? spec?.default ?? '';

  switch (type) {
    case 'number': {
      const num = Number(raw);
      return Number.isFinite(num) ? String(num) : String(spec?.default ?? '0');
    }
    case 'boolean':
      return raw === true || raw === 'true' ? 'true' : 'false';
    case 'select': {
      const allowed = (spec?.options ?? []).map((option) =>
        typeof option === 'object' ? String(option.value ?? option.label) : String(option),
      );
      const chosen = allowed.includes(String(raw))
        ? String(raw)
        : String(spec?.default ?? allowed[0] ?? '');
      return escapeHTML(chosen);
    }
    case 'url':
      return escapeHTML(safeURL(String(raw), true));
    case 'color':
    case 'token': {
      const text = String(raw).trim();
      const valid =
        /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|color-mix\([^)]*\)|var\(--[\w-]+(?:,[^)]*)?\)|[a-z-]+)$/i.test(
          text,
        );
      return escapeHTML(valid ? text : '');
    }
    default:
      return escapeHTML(String(raw));
  }
}

/** Fill `{{prop}}` placeholders and return sanitized markup. */
/**
 * A block template's placeholder syntax, in one place.
 *
 * Three things read it — filling a template, discovering what props a block needs,
 * and renaming one — and they have to agree exactly, or a prop the author named in
 * the form would not be the prop the template substitutes.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g;

/**
 * The prop names a template refers to, in the order they first appear.
 *
 * Source order rather than alphabetical: it matches the order the author wrote them
 * and, in practice, the order they read on screen.
 */
export function templatePropNames(html: string): string[] {
  const seen: string[] = [];
  for (const match of String(html ?? '').matchAll(PLACEHOLDER)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

/** Rewrite every occurrence of one placeholder, leaving the rest of the markup alone. */
export function renameTemplateProp(html: string, from: string, to: string): string {
  return String(html ?? '').replace(PLACEHOLDER, (match, name: string) =>
    name === from ? `{{${to}}}` : match,
  );
}

export function renderBlockTemplate(
  html: string,
  values: Record<string, unknown>,
  specs: Record<string, PropSpec> = {},
): string {
  const filled = String(html ?? '').replace(
    PLACEHOLDER,
    (_match, name: string) => safePropValue(values[name], specs[name]),
  );
  const holder = document.createElement('div');
  holder.append(sanitizeFragment(filled));
  return holder.innerHTML;
}

/** Pretty-print HTML with two-space indentation, for the code panel. */
export function formatHTML(html: string, indent = '  '): string {
  const tokens = String(html ?? '')
    .replace(/>\s*</g, '>\n<')
    .split('\n');
  let depth = 0;
  const lines: string[] = [];
  const voidTag = /^<(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b/i;

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (!token) continue;
    const isClosing = /^<\//.test(token);
    const isSelfClosing = /\/>$/.test(token) || voidTag.test(token);
    // A token like `<p>Hello</p>` is balanced on its own line and must not indent.
    const isBalanced = /^<([a-zA-Z][\w-]*)\b[^>]*>.*<\/\1\s*>$/.test(token);
    const isOpening = /^<[^/!]/.test(token) && !isSelfClosing && !isBalanced;

    if (isClosing) depth = Math.max(0, depth - 1);
    lines.push(indent.repeat(depth) + token);
    if (isOpening) depth += 1;
  }
  return lines.join('\n');
}
