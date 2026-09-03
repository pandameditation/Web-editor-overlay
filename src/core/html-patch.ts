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

// The only import this module has, and it is a string. Everything else here is text in, text
// out — but the seed tag it writes has to be the tag the engine looks for, and two copies of
// that MIME type is how the writer and the reader end up describing different tags.
import { SEED_SCRIPT_TYPE } from './constants.js';

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
  /** Which one it is among the container's children of the same tag and classes. */
  nth?: number;
  /** Which one it is among the container's children of the same tag, whatever their classes. */
  nthTag?: number;
  /** Sorted class list, used to narrow the siblings before counting. */
  classes?: string;
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
  const edits: Array<{ start: number; end: number; text: string; patch: HtmlPatch }> = [];
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
    if (edit) edits.push({ ...edit, patch });
  }

  if (!edits.length) return { html, applied, failed };

  // Overlapping edits would corrupt each other, and two edits to one attribute is the
  // only way that happens — the last one recorded is the one the user last asked for.
  // Applied back to front so that earlier offsets stay valid as the text changes under them.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    /*
     * Overlapping edits cannot both be applied, and the one that loses says so.
     *
     * Skipping it quietly is how a container rebuild went missing: the rebuild spans
     * everything between its tags, so a one-attribute edit on a child overlapped it, won on
     * position, and the rebuild was dropped — while still counted as applied, so the save
     * reported patching an insert into the file that was not in it. Callers order their passes
     * to keep this from arising; when it does arise it is a bug and has to surface as one.
     */
    if (edit.end > previousStart) {
      failed.push({ patch: edit.patch, reason: 'this edit overlaps another one in the same pass' });
      applied -= 1;
      continue;
    }
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

  /*
   * Failing all that: the nth child of a container that can be found.
   *
   * This is what makes an ordinary `<div class="sec">` addressable. Reading an index against
   * the whole file would be hopeless, but read against one container's direct children it is
   * a short list — and the tag name and classes are compared before the answer is used, so a
   * file whose shape no longer matches is declined instead of patched at the wrong element.
   */
  if (anchor.parent && (anchor.nth != null || anchor.nthTag != null)) {
    const container = resolveAnchor(html, anchor.parent);
    if (typeof container === 'string') return container;
    const children = directChildTags(html, container).filter((child) => child.name === wanted);

    /*
     * Narrowed by class first, then by tag alone.
     *
     * Two passes because the classes may be the thing that changed: an edit that adds a class
     * is recorded after the fact, so the anchor describes classes the file has not got yet.
     * Falling back to the tag keeps that edit placeable instead of rewriting the file over it.
     */
    const sameClass = children.filter(
      (child) => classSignatureOf(html.slice(child.start, child.end + 1)) === (anchor.classes ?? ''),
    );
    if (anchor.nth != null && sameClass.length > anchor.nth) return sameClass[anchor.nth];
    if (anchor.nthTag != null && children.length > anchor.nthTag) return children[anchor.nthTag];

    const described = anchor.classes ? `<${wanted} class="${anchor.classes}">` : `<${wanted}>`;
    return (
      `the file's <${container.name}> has ${children.length} <${wanted}> ` +
      `${children.length === 1 ? 'child' : 'children'}, not enough to reach the ${described} this changed`
    );
  }

  return `could not find this <${wanted}> in the file`;
}

/**
 * The direct element children of an open tag, in order.
 *
 * Each child is skipped past to its own close before looking for the next, so a nested tag is
 * never mistaken for a sibling. Raw-text bodies are stepped over whole.
 */
export function directChildTags(html: string, container: OpenTag): OpenTag[] {
  if (container.selfClosing) return [];
  const end = matchingClose(html, container);
  const limit = end === -1 ? html.length : end;
  const out: OpenTag[] = [];
  let i = container.end + 1;

  while (i < limit) {
    const lt = html.indexOf('<', i);
    if (lt === -1 || lt >= limit) break;
    // A close tag or a comment is not a child; step over it.
    if (html.startsWith('</', lt) || html.startsWith('<!', lt)) {
      const gt = html.indexOf('>', lt);
      i = gt === -1 ? limit : gt + 1;
      continue;
    }
    const tag = readOpenTag(html, lt);
    if (!tag) {
      i = lt + 1;
      continue;
    }
    out.push(tag);
    if (tag.selfClosing) {
      i = tag.end + 1;
      continue;
    }
    const close = matchingClose(html, tag);
    i = close === -1 ? tag.end + 1 : close;
  }
  return out;
}

/** The `class` attribute of a raw opening tag, sorted to match how the anchor records it. */
function classSignatureOf(raw: string): string {
  const range = attributeRange(raw, 'class');
  if (!range) return '';
  const value = raw
    .slice(range.start, range.end)
    .replace(/^class\s*=\s*/i, '')
    .replace(/^["']|["']$/g, '');
  return value
    .split(/\s+/)
    .filter((name) => name && !name.startsWith('heo-'))
    .sort()
    .join(' ');
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

/* -------------------------------------------------------------------------- */
/* The design system's block in the markup                                     */
/* -------------------------------------------------------------------------- */

/**
 * Marker comments around the `<style>` block the editor owns inside a file it does not.
 *
 * The same device `css-patch.ts` uses for a stylesheet, and for the same reason: tokens and
 * reusable classes have to go somewhere on the way to disk, and finding them again on the next
 * save is what stops every session appending another copy.
 *
 * HTML comments rather than an `id` or a `data-` attribute, deliberately. The export strips the
 * editor's markers so a saved file carries no trace of the tool, and an attribute smuggled past
 * that would be the exception people notice. A comment is content — legible, greppable, and
 * plainly the author's file explaining itself.
 */
export const STYLE_BLOCK_START = '<!-- heo:design-system start — managed by html-editor-overlay -->';
export const STYLE_BLOCK_END = '<!-- heo:design-system end -->';

/**
 * Add or replace the editor's managed `<style>` block in an HTML file.
 *
 * Idempotent by construction: the block is found by its markers and replaced wholesale, so
 * saving twice produces one block rather than two. Placed just before `</head>` when it is not
 * there yet, indented to match whatever sits above it.
 *
 * **It never removes.** `upsertSection` does, for stylesheets, and the asymmetry is deliberate.
 * A block written into an HTML file is, on the next load, an ordinary `<style>` the page owns:
 * the registries scan it and record those tokens as `origin: 'stylesheet'`, which `toCSS`
 * excludes precisely because they are already in a file. So the second save would compute an
 * empty design system, and a version of this that removed on empty would delete the block it
 * wrote a moment ago. Leaving it alone costs the ability to retract, which `designSystemScope`
 * of `none` now means "do not add mine" rather than "delete what is there" — the safer reading
 * anyway, since by then the block may have been edited by hand.
 */
export function upsertStyleBlock(html: string, css: string): string {
  const body = css.trim();
  if (!body) return html;
  /*
   * Already there without markers, so leave it be.
   *
   * A save that had to serialize wrote the design system as a plain `<style>`, unmarked, because
   * a serialized file is the DOM and the DOM has no markers in it. If a later save patches, this
   * would otherwise add a marked block beside the unmarked one and the file would declare every
   * token twice. Matching the text is enough to recognise that case and the values are identical
   * when it fires, so nothing is lost by declining.
   *
   * It does not cover a design system that *changed* between the two saves: the old unmarked
   * block stays and a marked one joins it. Same-valued duplication is harmless and this is not,
   * so it is worth naming — the durable fix is for both routes to emit the markers, which means
   * the serializer emitting one block where it currently emits three.
   */
  if (!html.includes(STYLE_BLOCK_START) && html.includes(body)) return html;

  return upsertManagedBlock(html, STYLE_BLOCK_START, STYLE_BLOCK_END, (indent) =>
    styleBlock(body, indent),
  );
}

/*
 * The block library, as a seed the next load reads back.
 *
 * Its own markers rather than a share of the design system's, because the two answer different
 * questions and are ticked independently: one is "how much CSS travels with this page", the
 * other is "do the components travel at all". A single block would make unticking either one
 * rewrite the other.
 */
export const SEED_BLOCK_START = '<!-- heo:blocks start — managed by html-editor-overlay -->';
export const SEED_BLOCK_END = '<!-- heo:blocks end -->';

/**
 * Write the block library into the file as a seed script.
 *
 * The one shape a block can travel in. Tokens, classes and rules become CSS, and CSS is
 * something any file can hold — but a block is markup plus prop declarations plus, sometimes, a
 * module that defines a custom element, and no stylesheet can carry that. The seed format
 * already exists for exactly this payload and the script-tag integration already reads
 * `<script type="application/heo-seed">` back at mount, so writing one here closes a loop that
 * was otherwise open: a library authored in a session lived only in that session.
 *
 * `type` is a non-executable MIME, so the browser parses the tag and runs nothing. The seed is
 * data; the overlay is what does anything with it, and a page without the overlay carries an
 * inert comment-with-a-payload that costs a few kB and breaks nothing.
 *
 * Same never-removes rule as the style block, for the same reason turned around: an empty seed
 * means "the user did not ask for the library to travel", which is not the same as "delete the
 * library that is already in this file" — and by the time a second save runs, that block may
 * have been edited by hand.
 */
export function upsertSeedBlock(html: string, seed: string, remove = false): string {
  /*
   * Removing is its own instruction, and it has to be, because "no seed" is ambiguous.
   *
   * An empty seed means "the user did not ask for the library to travel this time", which must
   * leave a library already in the file alone. Wanting it *gone* is a different statement and had
   * no way to be made: unticking the box stopped updating the block and left it there for ever.
   */
  if (remove) return dropManagedBlock(html, SEED_BLOCK_START, SEED_BLOCK_END);

  const body = seed.trim();
  if (!body) return html;
  if (!html.includes(SEED_BLOCK_START) && html.includes(body)) return html;

  return upsertManagedBlock(html, SEED_BLOCK_START, SEED_BLOCK_END, (indent) =>
    seedBlock(body, indent),
  );
}

/**
 * Take out the instance links, wherever they are in the text.
 *
 * The companion to removing the seed. The per-element attribute removals are recorded as real
 * changes and the patcher places the ones it can anchor, but an instance the patcher cannot find
 * would keep its `data-heo-block` and end up naming a template the file no longer carries. This
 * is a text pass over an attribute the editor writes itself, in a shape it controls, so matching
 * it literally is safe in a way that parsing attributes generally is not.
 */
export function dropBlockLinks(html: string): string {
  return html.replace(/\s+data-heo-block="[^"]*"/g, '');
}

/** Delete a marked region and close the gap, leaving a file with no region untouched. */
function dropManagedBlock(html: string, startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end <= start) return html;
  const finish = end + endMarker.length;
  // The whole line the region sat on, so removing it does not leave its indentation behind as a
  // trailing-whitespace line the next diff would report.
  const lineStart = html.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const head = html.slice(0, lineStart).replace(/[ \t]+$/, '');
  const tail = html.slice(finish).replace(/^[ \t]*\r?\n/, '');
  return `${head}${tail}`;
}

/**
 * Replace a marked region, or put one in `<head>` if there is not one yet.
 *
 * Shared by the two managed blocks because the placement is the fiddly part and it is identical
 * for both: find the markers and swap between them, otherwise work out where `</head>` sits and
 * what it is indented by. Having written that twice once, the second copy is where the two would
 * quietly stop agreeing about indentation.
 */
function upsertManagedBlock(
  html: string,
  startMarker: string,
  endMarker: string,
  render: (indent: string) => string,
): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);

  if (start !== -1 && end > start) {
    const finish = end + endMarker.length;
    const block = render(lineIndentAt(html, start));
    // A save that changes nothing writes nothing, so the diff stays honest about what moved.
    if (html.slice(start, finish) === block) return html;
    return `${html.slice(0, start)}${block}${html.slice(finish)}`;
  }

  const head = uniqueTag(html, 'head');
  if (head) {
    const close = matchingClose(html, head);
    if (close !== -1) {
      // The indentation of whatever `</head>` sits behind, plus one level for its children.
      const closeIndent = lineIndentAt(html, close);
      const indent = closeIndent ? `${closeIndent}  ` : '  ';
      const lead = html.slice(0, close);
      /*
       * The marker lands at exactly the indentation the block is rendered with, and that
       * equality is what makes a second save produce the same bytes.
       *
       * It did not before. When `</head>` already began its own line the block was inserted
       * with no leading whitespace — marker at column zero — while its inner lines were
       * indented one level. The next save then read the indent back off the marker, got
       * nothing, and re-rendered the whole block one level out. Nothing was broken by it, but
       * every save reported a change to a file whose content had not moved, which is exactly
       * the noise the patching path exists to avoid.
       */
      const trailing = /\n([ \t]*)$/.exec(lead);
      if (trailing) {
        const existing = trailing[1];
        // Whitespace already on the line wins when there is more of it, since that is what a
        // later pass will measure.
        const at = existing.length >= indent.length ? existing : indent;
        return `${lead}${at.slice(existing.length)}${render(at)}\n${closeIndent}${html.slice(close)}`;
      }
      return `${lead}\n${indent}${render(indent)}\n${closeIndent}${html.slice(close)}`;
    }
  }

  /*
   * No `<head>` to put it in, which is legal HTML and not worth refusing over.
   *
   * A file that opens with `<html>` and goes straight to content still honours a `<style>` or a
   * `<script>` wherever it finds one, so the block goes at the top of `<body>`, or at the very
   * start when there is no `<body>` either. Nothing is lost but tidiness.
   */
  const bodyTag = uniqueTag(html, 'body');
  if (bodyTag) {
    const at = bodyTag.end + 1;
    const indent = `${lineIndentAt(html, bodyTag.start)}  `;
    return `${html.slice(0, at)}\n${indent}${render(indent)}${html.slice(at)}`;
  }
  return `${render('')}\n${html}`;
}

/** True when the markers are already in the text. */
export function hasStyleBlock(html: string): boolean {
  return html.includes(STYLE_BLOCK_START);
}

/** True when the seed markers are already in the text. */
export function hasSeedBlock(html: string): boolean {
  return html.includes(SEED_BLOCK_START);
}

/**
 * The seed block, marker to marker.
 *
 * The payload stays on its own line and is never wrapped or indented internally: it is one
 * base64url token, and a line break inside it would be text content the reader has to strip
 * before decoding. `script-tag.ts` trims, so surrounding whitespace is safe and inner is not.
 */
function seedBlock(seed: string, indent: string): string {
  return [
    SEED_BLOCK_START,
    `${indent}<script type="${SEED_SCRIPT_TYPE}">`,
    `${indent}  ${seed}`,
    `${indent}</script>`,
    `${indent}${SEED_BLOCK_END}`,
  ].join('\n');
}

/** The managed block, marker to marker, with every line at the given indentation. */
function styleBlock(css: string, indent: string): string {
  const inner = css
    .split('\n')
    .map((line) => (line.trim() ? `${indent}  ${line}` : ''))
    .join('\n');
  return [
    STYLE_BLOCK_START,
    `${indent}<style>`,
    inner,
    `${indent}</style>`,
    `${indent}${STYLE_BLOCK_END}`,
  ].join('\n');
}

/** The whitespace at the start of the line the offset falls on. */
function lineIndentAt(html: string, offset: number): string {
  const lineStart = html.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const lead = html.slice(lineStart, offset);
  return lead.trim() === '' ? lead : '';
}
