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
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'action', 'formaction', 'xlink:href']);
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

/** Strip script, event handlers and unsafe URLs from a live subtree, in place. */
export function scrubElement(root: ParentNode): void {
  for (const script of Array.from(root.querySelectorAll('script'))) script.remove();
  const all = [root, ...Array.from(root.querySelectorAll('*'))].filter(
    (node): node is Element => node instanceof Element,
  );
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style' && /(?:expression|javascript:|vbscript:)/i.test(value)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.has(name)) {
        const allowData = MEDIA_TAGS.test(el.tagName);
        if (name === 'srcset') {
          const kept = value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => safeURL(entry.split(/\s+/)[0] ?? '', allowData))
            .join(', ');
          if (kept) el.setAttribute(attr.name, kept);
          else el.removeAttribute(attr.name);
          continue;
        }
        if (!safeURL(value, allowData)) el.removeAttribute(attr.name);
      }
    }
  }
}

/**
 * Parse an HTML string into a sanitized fragment.
 *
 * Uses `<template>` so the markup is inert while it is being cleaned: no
 * network requests fire and no scripts run before `scrubElement` gets to it.
 */
export function sanitizeFragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '');
  scrubElement(template.content);
  return template.content;
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
export function renderBlockTemplate(
  html: string,
  values: Record<string, unknown>,
  specs: Record<string, PropSpec> = {},
): string {
  const filled = String(html ?? '').replace(
    /\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g,
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
