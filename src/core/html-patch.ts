/**
 * Text-level helpers for HTML files.
 *
 * Two jobs live here. Editing one opening tag in place — an attribute, or some declarations of
 * its `style` — keeping the file's quoting and order, for the journal-driven patcher in
 * `source-patch.ts`. And the editor's two managed regions in `<head>`, the design-system
 * `<style>` block and the block-library seed, which are found by their marker comments and
 * replaced as wholes.
 *
 * `ElementAnchor` stays here because change records carry one to describe where an edit was
 * made. Saving no longer looks anything up by it: the file is patched from the DOM journal.
 */

// The seed tag written here has to be the tag the engine looks for, so its MIME type is shared.
import { SEED_SCRIPT_TYPE } from './constants.js';
import { parseDeclarations } from './css.js';

/** Where an element is, as a change record describes it to a reader. */
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
  /**
   * The attribute that names this element, for a tag identified by one rather than by an id.
   *
   * `<head>` is what this is for, and it is the only place in a document where identity works
   * this way: `<meta name="description">`, `<meta property="og:title">`, `<link rel="canonical">`.
   * There is no id to find them by, counting siblings is unsafe because a dev server injects
   * tags of its own, and their text is the thing being changed — so the attribute *is* the name,
   * exactly as the CSS selector that reads them says.
   */
  attr?: { name: string; value: string };
  /** The element's container, for a change about position rather than content. */
  parent?: ElementAnchor;
  /** Which one it is among the container's children of the same tag and classes. */
  nth?: number;
  /** Which one it is among the container's children of the same tag, whatever their classes. */
  nthTag?: number;
  /** Sorted class list, used to narrow the siblings before counting. */
  classes?: string;
}

/** An opening tag located in the source: `start` is the `<`, `end` is the `>`. */
interface OpenTag {
  name: string;
  start: number;
  end: number;
  selfClosing: boolean;
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
 * One attribute's value out of a raw opening tag, unquoted, or null when it has none.
 *
 * The four places that needed this each stripped `name="` with a regex of their own, one of them
 * built at runtime from the attribute name. `attributeRange` has already found the span, so the
 * value is simply what follows the `=` — no second pattern required, and one place to be wrong.
 */
function attributeValueOf(raw: string, name: string): string | null {
  const range = attributeRange(raw, name);
  if (!range) return null;
  const text = raw.slice(range.start, range.end);
  const equals = text.indexOf('=');
  if (equals === -1) return '';
  return text.slice(equals + 1).trim().replace(/^["']|["']$/g, '');
}

/** Every opening tag in the source, in order, skipping raw-text element bodies. */
function openTags(html: string): OpenTag[] {
  const out: OpenTag[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    /*
     * A comment is not markup, and stepping over it whole is the only way to be sure.
     *
     * Character-by-character scanning happily read `<head>` out of the middle of a sentence
     * someone had commented out, which made the file look like it had two of them — and
     * `uniqueTag` answers "several" with null, so the tag could not be found at all. Anything
     * inside a comment is prose as far as this is concerned.
     */
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
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

/**
 * Rewrite named declarations inside a `style` attribute, keeping the rest of the file's.
 *
 * Built on `attributeEdit` rather than beside it, so there is one place that knows how to put an
 * attribute into a tag and one place that knows when the file already agrees.
 *
 * The file's own order is kept and a property it does not have is appended, which is the same
 * rule the live writer follows — in CSS, order is precedence, and reordering someone's
 * declarations changes what their page does.
 */
function declarationsEdit(
  html: string,
  tag: OpenTag,
  declarations: Readonly<Record<string, string | null>>,
): { start: number; end: number; text: string } | null | string {
  const raw = html.slice(tag.start, tag.end + 1);
  const existing = attributeValueOf(raw, 'style') ?? '';

  const entries: Array<[string, string]> = Object.entries(parseDeclarations(existing));
  for (const [property, value] of Object.entries(declarations)) {
    const wanted = value === null ? '' : value.trim();
    const at = entries.findIndex(([name]) => name.toLowerCase() === property.toLowerCase());
    if (!wanted) {
      if (at >= 0) entries.splice(at, 1);
      continue;
    }
    if (at >= 0) entries[at] = [entries[at][0], wanted];
    else entries.push([property, wanted]);
  }

  const text = entries.map(([name, value]) => `${name}: ${value}`).join('; ');
  return attributeEdit(html, tag, 'style', text ? `${text};` : null);
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
    /*
     * A comment between here and the next candidate hides whatever it contains.
     *
     * Depth counting reads text, and text inside a comment is prose: a page whose `<head>`
     * carries a commented-out explanation mentioning `<head>` counted those mentions as nested
     * tags, so the real `</head>` never brought the depth back to zero and the element was
     * reported as unclosed.
     */
    const comment = lower.indexOf('<!--', i);
    if (comment !== -1 && comment < nextShut && (nextOpen === -1 || comment < nextOpen)) {
      const end = lower.indexOf('-->', comment + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
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

/** The span of `name="…"` (or a bare `name`) within an opening tag's text, quotes included. */
function attributeRange(raw: string, name: string): { start: number; end: number } | null {
  const pattern = new RegExp(
    `(^|\\s)(${escapeRegExp(name)})(?=[\\s/>=]|$)(\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+))?`,
    'i',
  );
  const match = pattern.exec(raw);
  if (!match) return null;
  const start = match.index + match[1].length;
  return { start, end: start + match[0].length - match[1].length };
}

/** One change to an opening tag: a whole attribute, or some declarations of its `style`. */
export type OpenTagEdit =
  | { name: string; value: string | null }
  | { name: 'style'; declarations: Readonly<Record<string, string | null>> };

/**
 * Apply attribute edits to the text of one opening tag, keeping everything else in it.
 *
 * Quoting, attribute order, letter case and the declarations of a `style` nobody touched all
 * stay as the file has them.
 */
export function editOpenTag(raw: string, edits: readonly OpenTagEdit[]): string {
  let text = raw;
  for (const edit of edits) {
    const tag = readOpenTag(text, 0);
    if (!tag) return raw;
    const change =
      'declarations' in edit
        ? declarationsEdit(text, tag, edit.declarations)
        : attributeEdit(text, tag, edit.name, edit.value);
    if (!change || typeof change === 'string') continue;
    text = text.slice(0, change.start) + change.text + text.slice(change.end);
  }
  return text;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
