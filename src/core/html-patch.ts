/**
 * Editing an HTML file by changing only the part that changed.
 *
 * The document write used to be `exportHTML()` — the live page serialized — replacing the
 * file wholesale. That is the wrong shape for a save, and in four separate ways at once.
 * The browser's serializer normalises quoting, letter case and self-closing tags, so every
 * save reformatted lines nobody touched. The live page contains whatever the page's own
 * code built, so a list rendered from data was written back as hand-authored markup. It
 * also *lacks* whatever that code removed at load, so authored markup could be deleted
 * from the file with no record it had existed. And a dev server's injected tags came along
 * too, one more copy per save.
 *
 * All four have the same cause and the same cure: never rewrite a byte that did not change.
 * This is what `css-patch.ts` already does for stylesheets, which is why a one-declaration
 * CSS edit produces a one-line diff while an HTML edit produced a reformatted file.
 *
 * The hard part is not the editing, it is saying *where*. An element in the live DOM has to
 * be found in the source text, and the two are not the same tree — the user has been
 * inserting and moving things, and the page's own code has been rendering. So position is
 * not usable as an anchor. Three things are:
 *
 * - **A build-time source marker.** `data-heo-src` carries the file, line and column of the
 *   tag itself. Exact, and free on any page using the Vite plugin.
 * - **An `id`.** Unique in a valid document by definition, and unaffected by anything moving.
 * - **The text being replaced.** For a text edit, the old text is known, and when it occurs
 *   exactly once in the file it identifies the element beyond doubt. This is the one that
 *   makes plain hand-written pages work, because that is where the text edits are.
 *
 * Anything that cannot be anchored is reported, not guessed at. The caller then falls back
 * to writing the whole file, which is what it did before — so nothing that used to reach
 * the file stops reaching it.
 */

/**
 * The file, line and column out of a `data-heo-src` value.
 *
 * Split from the right so a Windows drive letter survives, matching `sourceRefOf`.
 */
export function parseSourceMarker(
  raw: string,
): { file: string; line: number; column: number } | null {
  const parts = raw.split(':');
  const column = Number.parseInt(parts.pop() ?? '', 10);
  const line = Number.parseInt(parts.pop() ?? '', 10);
  const file = parts.join(':');
  if (!file || !Number.isFinite(line) || !Number.isFinite(column)) return null;
  return { file, line, column };
}

/** Where an element is, in terms the source text can be searched for. */
export interface ElementAnchor {
  /** Tag name, always. Every resolved position is checked against it before being used. */
  tag: string;
  /** The element's own `id`, when it has one. */
  id?: string;
  /**
   * The element's `data-heo-src` marker, verbatim: `file:line:column`.
   *
   * Unparsed on purpose. The position is only usable when the file half names the very
   * file being patched — a marker from a `.ts` template describes a line in that template,
   * and following it into the HTML would land somewhere arbitrary.
   */
  src?: string;
  /** 1-based line, once a caller has confirmed the marker refers to this file. */
  line?: number;
  /** 1-based column from the same marker. */
  column?: number;
  /** The exact text being replaced, for a text patch with nothing better to go on. */
  text?: string;
  /** The element's container, for a change about position rather than content. */
  parent?: ElementAnchor;
}

export type HtmlPatch =
  | { anchor: ElementAnchor; kind: 'attribute'; name: string; value: string | null }
  | { anchor: ElementAnchor; kind: 'text'; value: string };

export interface HtmlPatchFailure {
  patch: HtmlPatch;
  reason: string;
}

export interface HtmlPatchResult {
  html: string;
  /** How many patches changed the text. One the file already satisfied counts here. */
  applied: number;
  failed: HtmlPatchFailure[];
}

/**
 * Apply every patch that can be placed, and report the ones that cannot.
 *
 * Edits are collected first and written last, in descending offset order, so that each
 * one is computed against the original text and no earlier edit can shift a later
 * offset out from under it.
 */
export function patchHTML(html: string, patches: readonly HtmlPatch[]): HtmlPatchResult {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const failed: HtmlPatchFailure[] = [];
  let applied = 0;

  for (const patch of patches) {
    const found = resolveAnchor(html, patch.anchor);
    if (typeof found === 'string') {
      failed.push({ patch, reason: found });
      continue;
    }

    const edit =
      patch.kind === 'attribute'
        ? attributeEdit(html, found, patch.name, patch.value)
        : textEdit(html, found, patch.value);
    if (typeof edit === 'string') {
      failed.push({ patch, reason: edit });
      continue;
    }
    applied += 1;
    // A patch the file already satisfies is applied and contributes nothing to write.
    if (edit) edits.push(edit);
  }

  if (!edits.length) return { html, applied, failed };

  // Overlapping edits would corrupt each other, and two edits to one attribute is the
  // only way that happens — the last one recorded is the one the user last asked for.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    if (edit.end > previousStart) continue;
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    previousStart = edit.start;
  }
  return { html: out, applied, failed };
}

/* -------------------------------------------------------------------------- */
/* Finding the element                                                         */
/* -------------------------------------------------------------------------- */

/** An opening tag located in the source: `start` is the `<`, `end` is the `>`. */
interface OpenTag {
  name: string;
  start: number;
  end: number;
  selfClosing: boolean;
}

/** The tag, or a sentence explaining why it could not be found. */
function resolveAnchor(html: string, anchor: ElementAnchor): OpenTag | string {
  const wanted = anchor.tag.toLowerCase();

  if (anchor.line != null) {
    const tag = tagAtPosition(html, anchor.line, anchor.column ?? 1);
    if (tag && tag.name === wanted) return tag;
  }

  /*
   * An anchor that names an id is answered by that id or not at all.
   *
   * Falling through to a weaker match was a real bug: a newly inserted `<p id="added">` is
   * not in the file, and the tag-name fallback below then handed back the only `<p>` that
   * was — so the new element was written as a second copy of an existing one. An id that is
   * absent is information, not a dead end.
   */
  if (anchor.id) {
    const tag = tagWithId(html, anchor.id);
    if (typeof tag === 'string') return tag;
    if (!tag) return `the file has no element with id "${anchor.id}"`;
    if (tag.name !== wanted) {
      return `the file has ${anchor.id} on a <${tag.name}> rather than a <${wanted}>`;
    }
    return tag;
  }

  if (anchor.text) {
    const tag = tagAroundText(html, anchor.text, wanted);
    if (typeof tag === 'string') return tag;
    if (tag) return tag;
  }

  /*
   * A tag the file contains exactly once identifies itself.
   *
   * `<body>` is why this exists: a top-level element's container has no id and needs none,
   * and without this every reorder at the top of a page fell back to serializing. The
   * uniqueness requirement is the same safeguard the text anchor uses — one match is a fact,
   * two is a guess.
   */
  /*
   * Nothing named this element, so a tag the file holds exactly once will do. Reached only
   * when there was no id and no marker to go on — `<body>` and `<br>` rather than anything
   * that was supposed to identify itself.
   */
  const unique = uniqueTag(html, wanted);
  if (unique) return unique;

  return `could not find this <${wanted}> in the file`;
}

/** The only tag of this name in the file, or null when there are none or several. */
function uniqueTag(html: string, name: string): OpenTag | null {
  let found: OpenTag | null = null;
  for (const tag of openTags(html)) {
    if (tag.name !== name) continue;
    if (found) return null;
    found = tag;
  }
  return found;
}

/**
 * The opening tag at a line and column, from a build-time marker.
 *
 * The marker records where the tag *started* in the file the plugin transformed, so the
 * lookup is exact when the file has not been edited since — and when it has, the tag name
 * check rejects the miss rather than patching a neighbour.
 */
function tagAtPosition(html: string, line: number, column: number): OpenTag | null {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = html.indexOf('\n', offset);
    if (next === -1) return null;
    offset = next + 1;
  }
  const at = offset + column - 1;
  // The marker points at the `<`, but a column off by a character should not lose the
  // tag, so the search starts a little before and takes the first tag at or after it.
  const from = Math.max(0, at - 2);
  const lt = html.indexOf('<', from);
  return lt === -1 ? null : readOpenTag(html, lt);
}

/** The opening tag carrying `id`, or a reason when the file has more than one. */
function tagWithId(html: string, id: string): OpenTag | null | string {
  const matches: OpenTag[] = [];
  for (const tag of openTags(html)) {
    const raw = html.slice(tag.start, tag.end + 1);
    const range = attributeRange(raw, 'id');
    if (!range) continue;
    // The range covers `id="value"`, so the value is what is left after the quotes.
    const value = raw.slice(range.start, range.end).replace(/^id\s*=\s*/i, '').replace(/^["']|["']$/g, '');
    if (value === id) matches.push(tag);
  }
  if (matches.length > 1) return `the file has ${matches.length} elements with id "${id}"`;
  return matches[0] ?? null;
}

/**
 * The element whose content is exactly this text, when the file contains it once.
 *
 * The uniqueness requirement is what makes this safe: a second occurrence means the text
 * cannot say which element it belongs to, and a guess here writes the edit into the wrong
 * place — far worse than declining and letting the whole file be written.
 */
function tagAroundText(html: string, text: string, wanted: string): OpenTag | null | string {
  const first = html.indexOf(text);
  if (first === -1) return null;
  if (html.indexOf(text, first + text.length) !== -1) {
    return `“${clip(text)}” appears more than once in the file, so it cannot say which element changed`;
  }
  // Back to the opening tag that encloses it.
  const lt = html.lastIndexOf('<', first);
  if (lt === -1) return null;
  const tag = readOpenTag(html, lt);
  if (!tag || tag.name !== wanted) return null;
  return tag;
}

/** Every opening tag in the source, in order, skipping raw-text element bodies. */
function openTags(html: string): OpenTag[] {
  const out: OpenTag[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    const tag = readOpenTag(html, lt);
    if (!tag) {
      i = lt + 1;
      continue;
    }
    out.push(tag);
    // A raw-text body can contain anything that looks like a tag and is not one.
    if (RAW_TEXT.has(tag.name) && !tag.selfClosing) {
      const close = html.toLowerCase().indexOf(`</${tag.name}`, tag.end);
      i = close === -1 ? html.length : close;
      continue;
    }
    i = tag.end + 1;
  }
  return out;
}

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Read one opening tag, or null when this `<` does not begin one.
 *
 * Quote-aware, because an attribute value is entitled to contain `>` and stopping at the
 * first one would cut the tag in half.
 */
function readOpenTag(html: string, lt: number): OpenTag | null {
  const match = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(lt, lt + 64));
  if (!match) return null;
  const name = match[1].toLowerCase();

  let quote = '';
  for (let i = lt + match[0].length; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') {
      return { name, start: lt, end: i, selfClosing: html[i - 1] === '/' || VOID.has(name) };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Making the change                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Rewrite one attribute inside an opening tag.
 *
 * Returns null when the file already says this, so a save does not rewrite a line to the
 * value it already had — which is what keeps a diff honest about what changed.
 */
function attributeEdit(
  html: string,
  tag: OpenTag,
  name: string,
  value: string | null,
): { start: number; end: number; text: string } | null | string {
  const raw = html.slice(tag.start, tag.end + 1);
  const found = attributeRange(raw, name);

  if (value === null) {
    if (!found) return null;
    // Take the leading whitespace with it, or removing an attribute leaves a double space.
    let start = found.start;
    while (start > 0 && /\s/.test(raw[start - 1])) start -= 1;
    return { start: tag.start + start, end: tag.start + found.end, text: '' };
  }

  const attribute = `${name}="${escapeAttribute(value)}"`;
  if (found) {
    if (raw.slice(found.start, found.end) === attribute) return null;
    return { start: tag.start + found.start, end: tag.start + found.end, text: attribute };
  }
  // Not there yet: in it goes, just before the tag closes.
  const insertAt = tag.selfClosing && html[tag.end - 1] === '/' ? tag.end - 1 : tag.end;
  const spacer = /\s/.test(html[insertAt - 1] ?? '') ? '' : ' ';
  return { start: insertAt, end: insertAt, text: `${spacer}${attribute}` };
}

/** Replace an element's content, leaving its opening and closing tags alone. */
function textEdit(
  html: string,
  tag: OpenTag,
  value: string,
): { start: number; end: number; text: string } | null | string {
  if (tag.selfClosing) return `<${tag.name}> has no content to change`;
  const close = matchingClose(html, tag);
  if (close === -1) return `could not find the closing </${tag.name}> in the file`;
  const start = tag.end + 1;
  if (html.slice(start, close) === value) return null;
  return { start, end: close, text: value };
}

/**
 * Where the element's content ends, accounting for the same tag nested inside it.
 *
 * A `<div>` inside a `<div>` means the first `</div>` is not the one that closes this
 * element, so depth is counted rather than the first close being taken.
 */
function matchingClose(html: string, tag: OpenTag): number {
  const lower = html.toLowerCase();
  const open = `<${tag.name}`;
  const shut = `</${tag.name}`;
  let depth = 1;
  let i = tag.end + 1;

  while (i < html.length) {
    const nextOpen = lower.indexOf(open, i);
    const nextShut = lower.indexOf(shut, i);
    if (nextShut === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextShut) {
      const nested = readOpenTag(html, nextOpen);
      // A prefix match such as `<sectionish` inside `<section` is not a nested tag.
      if (nested && nested.name === tag.name && !nested.selfClosing) depth += 1;
      i = nested ? nested.end + 1 : nextOpen + open.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextShut;
    i = nextShut + shut.length;
  }
  return -1;
}

/** The span of `name="…"` within an opening tag's text, quotes included. */
function attributeRange(raw: string, name: string): { start: number; end: number } | null {
  const pattern = new RegExp(`(^|\\s)(${escapeRegExp(name)})\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const match = pattern.exec(raw);
  if (!match) return null;
  const start = match.index + match[1].length;
  return { start, end: start + match[0].length - match[1].length };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clip(value: string, limit = 40): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

/* -------------------------------------------------------------------------- */
/* Reading the file back                                                       */
/* -------------------------------------------------------------------------- */

/**
 * An element's own text, exactly as the file has it.
 *
 * The whole point of reordering by reconciliation: a child that merely moved contributes the
 * bytes it already had, so its markup, comments, formatting and nested content come through
 * untouched. Leading whitespace on its line comes with it when the tag starts the line, which
 * is what makes a pure reorder reproduce the original lines rather than re-indent them.
 */
export function elementText(html: string, anchor: ElementAnchor): string | null {
  const tag = resolveAnchor(html, anchor);
  if (typeof tag === 'string') return null;

  let start = tag.start;
  const lineStart = html.lastIndexOf('\n', start - 1) + 1;
  if (html.slice(lineStart, start).trim() === '') start = lineStart;

  if (tag.selfClosing) return html.slice(start, tag.end + 1);
  const close = matchingClose(html, tag);
  if (close === -1) return null;
  const gt = html.indexOf('>', close);
  return gt === -1 ? null : html.slice(start, gt + 1);
}

/** The whitespace an element sits behind on its line, for indenting what joins it. */
export function indentOf(html: string, anchor: ElementAnchor): string {
  const tag = resolveAnchor(html, anchor);
  if (typeof tag === 'string') return '';
  const lineStart = html.lastIndexOf('\n', tag.start - 1) + 1;
  const lead = html.slice(lineStart, tag.start);
  return lead.trim() === '' ? lead : '';
}

/** True when the file contains this element at all. */
export function canResolve(html: string, anchor: ElementAnchor): boolean {
  return typeof resolveAnchor(html, anchor) !== 'string';
}
