/**
 * Build-time source marking.
 *
 * The overlay edits a rendered page, so on its own it can only describe changes
 * by CSS selector. Stamping every opening tag with the file, line and column it
 * came from turns the save prompt from "find the element that matches this
 * selector" into "edit line 42 of this file", which is the difference between a
 * change an agent can apply mechanically and one it has to search for.
 *
 * Two rules keep the recorded positions honest:
 *
 * 1. Positions are measured against the *original* source, before any attribute
 *    is inserted.
 * 2. Insertions are applied in descending offset order, so earlier offsets are
 *    never shifted by a later edit.
 */

/** Tags that are never marked: they are not selectable in the editor anyway. */
const SKIP = new Set([
  'html',
  'head',
  'meta',
  'link',
  'title',
  'base',
  'script',
  'style',
  'noscript',
  'template',
  'br',
  'wbr',
]);

export interface Injection {
  /** Offset in the original source where the attribute text is inserted. */
  offset: number;
  text: string;
}

interface Tag {
  name: string;
  /** Offset of the `<`. */
  start: number;
  /** Offset to insert an attribute at: just before `>` or `/>`. */
  insertAt: number;
  /** True when the tag already carries a marker. */
  marked: boolean;
}

/**
 * Walk opening tags, respecting comments, CDATA-ish constructs and quoted
 * attribute values.
 *
 * A regex cannot do this correctly: `<a title="a > b">` and `<!-- <div> -->`
 * both break naive matching, and both appear in real markup.
 */
export function scanOpeningTags(source: string, attributeName: string): Tag[] {
  const tags: Tag[] = [];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source[lt + 1] === '!' || source[lt + 1] === '?') {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(source.slice(lt, lt + 64));
    if (!nameMatch) {
      i = lt + 1;
      continue;
    }
    const name = nameMatch[1].toLowerCase();

    // Scan attributes, tracking quotes, until the tag closes.
    let j = lt + nameMatch[0].length;
    let quote: string | null = null;
    let end = -1;
    while (j < source.length) {
      const ch = source[j];
      if (quote) {
        if (ch === quote) quote = null;
        j += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        j += 1;
        continue;
      }
      if (ch === '>') {
        end = j;
        break;
      }
      j += 1;
    }
    if (end === -1) break;

    const raw = source.slice(lt, end + 1);
    const selfClosing = source[end - 1] === '/';
    const bodyEnd = selfClosing ? end - 1 : end;

    // The raw text of `<script>`/`<style>` bodies must not be scanned for tags.
    if (name === 'script' || name === 'style' || name === 'textarea') {
      const closeTag = `</${name}`;
      const close = source.toLowerCase().indexOf(closeTag, end);
      i = close === -1 ? source.length : close;
      continue;
    }

    if (!SKIP.has(name)) {
      tags.push({
        name,
        start: lt,
        insertAt: bodyEnd,
        marked: raw.includes(attributeName),
      });
    }
    i = end + 1;
  }

  return tags;
}

/** 1-based line and column for a byte offset. Handles both LF and CRLF. */
export function positionAt(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      lastBreak = i;
    }
  }
  return { line, column: offset - lastBreak };
}

/** Apply injections to the source. Sorted descending so offsets stay valid. */
export function applyInjections(source: string, injections: Injection[]): string {
  if (!injections.length) return source;
  const ordered = [...injections].sort((a, b) => b.offset - a.offset);
  let out = source;
  for (const injection of ordered) {
    out = out.slice(0, injection.offset) + injection.text + out.slice(injection.offset);
  }
  return out;
}

function attribute(name: string, file: string, line: number, column: number): string {
  return ` ${name}="${file}:${line}:${column}"`;
}

/** Mark every opening tag in an HTML document. */
export function instrumentHTML(source: string, file: string, attributeName: string): string {
  const injections: Injection[] = [];
  for (const tag of scanOpeningTags(source, attributeName)) {
    if (tag.marked) continue;
    const { line, column } = positionAt(source, tag.start);
    injections.push({ offset: tag.insertAt, text: attribute(attributeName, file, line, column) });
  }
  return applyInjections(source, injections);
}

/**
 * Mark tags inside tagged template literals (`html`…``).
 *
 * Interpolations are blanked out to equal-length whitespace before scanning, so
 * offsets computed on the masked text are valid in the real text while `${...}`
 * regions — which may contain nested templates, strings or `>` characters — are
 * invisible to the tag scanner. Nested templates are still marked, because the
 * outer loop finds them on their own iteration.
 */
export function instrumentTemplates(
  source: string,
  file: string,
  attributeName: string,
  tagNames: readonly string[] = ['html', 'svg'],
): string {
  const injections: Injection[] = [];
  const pattern = new RegExp(String.raw`\b(?:${tagNames.join('|')})\s*` + '`', 'g');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const contentStart = match.index + match[0].length;
    const contentEnd = findTemplateEnd(source, contentStart);
    if (contentEnd === -1) continue;

    const content = source.slice(contentStart, contentEnd);
    const masked = maskInterpolations(content);

    for (const tag of scanOpeningTags(masked, attributeName)) {
      if (tag.marked) continue;
      const absoluteStart = contentStart + tag.start;
      const { line, column } = positionAt(source, absoluteStart);
      injections.push({
        offset: contentStart + tag.insertAt,
        text: attribute(attributeName, file, line, column),
      });
    }
    // Continue scanning after the opening backtick, not past the template, so
    // nested templates are still discovered.
    pattern.lastIndex = contentStart;
  }

  return applyInjections(source, injections);
}

/** Replace `${…}` with equal-length whitespace, preserving newlines. */
function maskInterpolations(template: string): string {
  const chars = template.split('');
  let i = 0;
  while (i < template.length) {
    if (template[i] === '\\') {
      i += 2;
      continue;
    }
    if (template[i] === '$' && template[i + 1] === '{') {
      const end = skipBraces(template, i + 2);
      for (let j = i; j < end && j < template.length; j += 1) {
        if (chars[j] !== '\n') chars[j] = ' ';
      }
      i = end;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

function findTemplateEnd(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '`') return i;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '$' && source[i + 1] === '{') {
      i = skipBraces(source, i + 2);
      continue;
    }
    i += 1;
  }
  return -1;
}

function skipBraces(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '`') {
      const end = findTemplateEnd(source, i + 1);
      i = end === -1 ? source.length : end + 1;
      continue;
    } else if (ch === "'" || ch === '"') {
      i = skipString(source, i);
      continue;
    } else if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
      continue;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    i += 1;
  }
  return i;
}

function skipString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}
