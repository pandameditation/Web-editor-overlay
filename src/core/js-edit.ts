import { nextChangeId, type Command } from './history.js';
import type { Provenance } from './provenance.js';

/**
 * Editing the code that renders a piece of the page.
 *
 * Provenance says which file, and roughly where. That is not yet enough to put in
 * front of someone: a file is hundreds of lines, and "line 412" is a coordinate, not
 * an answer. Two things turn it into one.
 *
 * **The string is a better anchor than the line.** A line number from a captured
 * stack refers to the code the browser ran, and behind a dev server that is a
 * transformed copy of what is on disk — same file, different line. The text on the
 * page, on the other hand, is usually right there in the source as a literal, and
 * finding it pins the exact thing worth changing regardless of how the file was
 * transformed on the way to the browser. So the line is a hint used to disambiguate
 * between matches, and the match is what the view is built around.
 *
 * **A window, not a file.** What comes back is a short span of lines around the
 * anchor, edited as its own buffer and spliced back into the whole file on the way
 * out. That is what makes this a tactical edit rather than "here is main.js, good
 * luck": the user sees the code that produces what they clicked on, with enough
 * around it to understand it, and nothing else. It also sidesteps having to teach a
 * folding editor to scroll to a line, which is real work for a worse result.
 *
 * When the text cannot be found — a value that is computed, interpolated, or fetched —
 * the window falls back to the hinted line and says so. That case is common and
 * honest: the code is still the right code, the literal simply is not in it.
 */

/** The file a piece of the page came from, in the shape needed to read and write it. */
export interface SourceTarget {
  /** Project-relative path, when build-time instrumentation supplied one. */
  path?: string;
  /** Absolute URL, when a captured stack supplied one. */
  url?: string;
  /** File name, for headings. */
  label: string;
  /** 1-based line the provenance pointed at. */
  line?: number;
}

/** How the anchor line was arrived at, so the UI can be honest about it. */
export type AnchorKind = 'literal' | 'line' | 'start';

/** A span of a file, ready to be shown and edited. */
export interface SourceWindow {
  /** 1-based line the window begins at. */
  from: number;
  /** Number of lines it covers. */
  count: number;
  /** The window's text. What the editor edits. */
  code: string;
  /** 1-based line holding the anchor, absolute in the file. */
  anchor: number;
  anchorKind: AnchorKind;
  /** The page text that was matched, when it was. */
  matched?: string;
  /** Total lines in the file, so the UI can say where the window sits. */
  lines: number;
}

/** Where a target's file lives, as a `FileHost` path. Null when it cannot be reached. */
export function sourceTargetOf(provenance: Provenance, resolve: (url: string) => string | null): SourceTarget | null {
  if (provenance.file) {
    return {
      path: provenance.file,
      label: provenance.file.split('/').pop() || provenance.file,
      line: provenance.line,
    };
  }
  if (!provenance.url) return null;
  const path = resolve(provenance.url) ?? undefined;
  let label = provenance.url;
  try {
    label = new URL(provenance.url).pathname.split('/').pop() || provenance.url;
  } catch {
    /* not a URL we can shorten; the whole thing is the label */
  }
  return { path, url: provenance.url, label, line: provenance.line };
}

/** Lines of context kept either side of the anchor. */
const RADIUS = 10;

/**
 * Build the window to show for a piece of page text.
 *
 * `text` is what is on screen. The search is for the whole collapsed run first,
 * because that is the least ambiguous thing to match, and then for its longest single
 * line — a heading that wraps in the markup is one string on the page and two in the
 * file.
 */
export function sourceWindow(file: string, text: string, hint?: number): SourceWindow {
  const lines = file.split('\n');
  const found = findAnchor(file, text, hint);

  const anchorKind: AnchorKind = found ? 'literal' : hint ? 'line' : 'start';
  const anchor = clamp(found?.line ?? hint ?? 1, 1, lines.length);

  const from = clamp(anchor - RADIUS, 1, lines.length);
  const to = clamp(anchor + RADIUS, 1, lines.length);
  return {
    from,
    count: to - from + 1,
    code: lines.slice(from - 1, to).join('\n'),
    anchor,
    anchorKind,
    matched: found?.matched,
    lines: lines.length,
  };
}

/**
 * The line holding the page's text, preferring the one nearest the hint.
 *
 * Nearest rather than first because a string can legitimately appear more than once —
 * a label and its test, a default and its override — and the stack already told us
 * roughly where the write came from. When there is no hint, first wins.
 */
function findAnchor(file: string, text: string, hint?: number): { line: number; matched: string } | null {
  for (const needle of candidates(text)) {
    const hits: number[] = [];
    let at = file.indexOf(needle);
    while (at !== -1) {
      hits.push(at);
      at = file.indexOf(needle, at + needle.length);
    }
    if (!hits.length) continue;

    const lineOf = (offset: number): number => file.slice(0, offset).split('\n').length;
    if (!hint) return { line: lineOf(hits[0]), matched: needle };
    let best = hits[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const offset of hits) {
      const distance = Math.abs(lineOf(offset) - hint);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = offset;
      }
    }
    return { line: lineOf(best), matched: needle };
  }
  return null;
}

/**
 * Search strings for a piece of page text, most specific first.
 *
 * Short runs are dropped: matching `OK` against a file finds it inside a dozen
 * identifiers and would anchor the window somewhere arbitrary, which is worse than
 * admitting the literal was not found.
 */
function candidates(text: string): string[] {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  if (collapsed.length >= 4) out.push(collapsed);
  const longest = text
    .split('\n')
    .map((line) => line.trim())
    .sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length >= 4 && longest !== collapsed) out.push(longest);
  return out;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Put an edited window back into the file it came from. */
export function spliceWindow(file: string, window: SourceWindow, edited: string): string {
  const lines = file.split('\n');
  const head = lines.slice(0, window.from - 1);
  const tail = lines.slice(window.from - 1 + window.count);
  return [...head, ...edited.split('\n'), ...tail].join('\n');
}

/**
 * Record an edit to a source file, reversibly.
 *
 * Nothing is applied to the page, and that is the whole shape of this change: the file
 * is what renders the content, so until it is written and the page reloads, the screen
 * is showing the old result. Saying so is the summary's job.
 *
 * The record carries the complete new file because that is the only contract the write
 * plan has for code — it replaces a script outright, having no way to know which part
 * of a new text is the change. The splice happens here, where both the window and the
 * file are in hand.
 */
export function writeSourceEdit(
  target: SourceTarget,
  file: string,
  window: SourceWindow,
  edited: string,
): Command | null {
  if (edited === window.code) return null;
  const after = spliceWindow(file, window, edited);
  if (after === file) return null;

  const where = `${target.label}:${window.anchor}`;
  return {
    label: `Edit ${where}`,
    // Keyed on the file, so a run of edits to one source is reported as one change
    // rather than as a list of intermediate versions of it.
    subject: `source:${target.path ?? target.url ?? target.label}`,
    record: {
      id: nextChangeId(),
      kind: 'attribute',
      summary: `Edit the code in ${where} that renders this content (the page still shows the old result until this file is saved and reloaded)`,
      target: where,
      group: `source:${target.path ?? target.url ?? target.label}`,
      before: window.code,
      after: edited,
      detail: {
        file: target.url ?? target.path ?? target.label,
        // Its own scope rather than reusing `'external script'`: that one means "the JS
        // panel replaced this whole file", and the plan says so when it lists it. This
        // is a targeted edit to the code behind something on screen, which is a
        // different sentence to put in front of someone about to write a file.
        scope: 'rendered source',
        script: after,
        /*
         * `sourcePath` when the path is already known, `writeTo` when only a URL is.
         *
         * Build-time instrumentation reports a project-relative path directly, and
         * putting it through URL resolution would only be a chance to get it wrong. A
         * captured stack gives an absolute URL, which is what the host resolves.
         */
        ...(target.path ? { sourcePath: target.path } : {}),
        writeTo: target.url ?? target.path ?? '',
      },
      at: Date.now(),
    },
    // The page is not touched either way: what changes is a file, and the running page
    // was rendered from the old one.
    apply: () => { },
    revert: () => { },
  };
}
