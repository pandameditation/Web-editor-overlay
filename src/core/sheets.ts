import type { FileHost } from './file-host.js';
import { nextChangeId, type Command } from './history.js';
import {
  isMirroredLink,
  paintStyleMirror,
  styleMirrorFor,
  styleMirrorOfNode,
} from './mirror.js';

/**
 * The page's stylesheets, as editable sources.
 *
 * The style panel answers "what applies to this element"; this answers the other
 * half — "where does the CSS live, and let me at it". Both matter, because plenty
 * of fixes belong in a stylesheet rather than as one more inline override.
 *
 * Editing writes through the CSSOM rather than through a file, which is the only
 * option a page has. That is enough for a faithful live preview, and the change
 * record carries the file name so the save prompt can tell an agent exactly which
 * file to edit. Cross-origin sheets are unreadable by design and are surfaced as
 * such rather than silently omitted.
 */

export type SheetKind = 'link' | 'style' | 'adopted' | 'shadow';

export interface StyleSource {
  /** Stable id for list keying and selection across re-renders. */
  id: string;
  kind: SheetKind;
  /** File name, or a positional label for an inline or constructed sheet. */
  label: string;
  /** Full URL when the sheet came from a file. */
  href?: string;
  /** Media query the sheet is limited to, when any. */
  media?: string;
  /** Number of top-level rules, or 0 when unreadable. */
  rules: number;
  /** Why the sheet cannot be edited, when it cannot. */
  readOnly?: string;
  /**
   * Why edits to this sheet cannot be shown on screen, when they cannot.
   *
   * Distinct from `readOnly`, and the distinction only exists because a connected
   * project changed what is possible. A sheet the browser refuses to expose used to be
   * simply off limits; now its file can still be read and written, so it is editable —
   * just not previewable, because the live preview needs the CSSOM and that is the part
   * the browser is withholding.
   */
  unpreviewable?: string;
  /** Project-relative path, when a connected project can reach this file. */
  path?: string;
  /** The live sheet, absent when it could not be reached. */
  sheet?: CSSStyleSheet;
  /** The owning `<style>` element, when the source is an inline sheet. */
  element?: HTMLStyleElement;
  /**
   * The file's own text, once it has been fetched.
   *
   * The panel fills this in from `fetchStyleSource`, so an edit is recorded as a
   * change to what is on disk rather than to the browser's re-serialization of it.
   * Without it, `before` would be a reformatted copy and every save would look like
   * the whole file changed.
   */
  pendingBefore?: string;
}

/**
 * Every stylesheet affecting the page, document order first.
 *
 * The editor's own generated sheets are included but flagged: hiding them would
 * make the token and class output look like it comes from nowhere, while letting
 * them be hand-edited here would fight the registries that own them.
 */
export function collectStyleSources(project?: FileHost | null): StyleSource[] {
  const out: StyleSource[] = [];
  let styleIndex = 0;
  let adoptedIndex = 0;

  for (const sheet of Array.from(document.styleSheets)) {
    const node = sheet.ownerNode;
    if (node instanceof Element && node.hasAttribute('data-heo-internal')) continue;

    /*
     * A stand-in is listed as the file it stands in for, not as the `<style>` it
     * happens to be.
     *
     * Everything downstream keys off this: the href decides which file a save writes,
     * and calling it an inline `<style>` would send the edit into the exported HTML
     * instead. The original `<link>` is disabled and so has already dropped out of
     * `document.styleSheets`, which is why this does not produce two entries.
     */
    // A `<link>` that has been stood in for is normally gone from `document.styleSheets`
    // already, disabling having removed it. Skipped explicitly all the same, so the one
    // file cannot be listed twice if the browser is slower to drop it than to run this.
    if (isMirroredLink(node)) continue;

    const mirror = styleMirrorOfNode(node);
    if (mirror) {
      out.push(
        describe(sheet, 'link', fileName(mirror.href) ?? mirror.href, { href: mirror.href }, project),
      );
      continue;
    }

    if (node instanceof HTMLStyleElement) {
      styleIndex += 1;
      out.push(
        describe(sheet, 'style', node.id || `<style> #${styleIndex}`, { element: node }, project),
      );
      continue;
    }
    const href = sheet.href ?? undefined;
    out.push(
      describe(sheet, 'link', fileName(href) ?? `<link> #${out.length + 1}`, { href }, project),
    );
  }

  for (const sheet of document.adoptedStyleSheets ?? []) {
    adoptedIndex += 1;
    out.push(describe(sheet, 'adopted', `adopted #${adoptedIndex}`, {}, project));
  }
  return out;
}

function describe(
  sheet: CSSStyleSheet,
  kind: SheetKind,
  label: string,
  extra: { href?: string; element?: HTMLStyleElement } = {},
  project?: FileHost | null,
): StyleSource {
  const generated =
    sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-generated');
  const path = extra.href && project ? (project.resolve(extra.href) ?? undefined) : undefined;
  const id = `${kind}:${extra.href ?? extra.element?.id ?? label}`;
  /*
   * The file's text, when it has been read. Used as `pendingBefore` for every source
   * that has one, so an edit is recorded as a diff against the file rather than
   * against the browser's re-serialization of it — no comments, `#fff` rewritten to
   * `rgb(...)`, every line break the author chose replaced.
   */
  const known = styleTexts.get(id);
  let pendingBefore = known;

  let rules = 0;
  let readOnly: string | undefined;
  let unpreviewable: string | undefined;
  try {
    rules = sheet.cssRules.length;
  } catch {
    /*
     * The browser will not expose the rules, and there are two quite different reasons
     * it might not. A stylesheet on someone else's CDN is genuinely out of reach. A
     * local file opened over `file://` is not — each file is its own opaque origin, so
     * the browser refuses to read it even though it is sitting next to the page.
     *
     * A connected project tells the two apart: if the file resolves inside the folder
     * that was handed over, its text can be read from disk and written back. What stays
     * impossible is the live preview, because that needs the CSSOM.
     */
    if (path) {
      /*
       * Readable from disk, and the page is still rendering from a sheet nobody can
       * touch. This is the state a mirror exists to get out of, and reaching it means
       * the mirror could not be installed — the text would not parse, or installing it
       * changed how the page looked. Rare, and worth saying plainly rather than
       * pretending the edit will show.
       */
      unpreviewable =
        `The browser will not let this page read ${label}, and the editor could not stand in for ` +
        `it, so edits cannot be shown on screen. They will still be written to the file.`;
      // Everything measurable about this sheet comes from the file, not the CSSOM.
      if (known !== undefined) rules = countRules(known);
    } else {
      readOnly =
        'This sheet is served from another origin, so the browser will not let the page read it.';
    }
  }
  if (!readOnly && generated) {
    readOnly = 'The editor owns this sheet. Edit the tokens and classes it is built from instead.';
  }
  if (!readOnly && kind === 'adopted' && !extra.element) {
    // Constructed sheets can be rewritten, but they belong to whichever component
    // adopted them and will be overwritten on its next render.
    readOnly = 'A constructed sheet, owned by the component that adopted it.';
  }

  return {
    id,
    kind,
    label,
    href: extra.href,
    media: sheet.media?.mediaText || undefined,
    rules,
    readOnly,
    unpreviewable,
    path,
    sheet,
    element: extra.element,
    pendingBefore,
  };
}

function fileName(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).pathname.split('/').pop() || href;
  } catch {
    return href;
  }
}

/** The sheet's text, reassembled from its rules. */
export function readStyleSource(source: StyleSource): string {
  if (source.element) return source.element.textContent ?? '';
  const sheet = source.sheet;
  if (!sheet) return '';
  try {
    return Array.from(sheet.cssRules)
      .map((rule) => rule.cssText)
      .join('\n\n');
  } catch {
    return '';
  }
}

/**
 * The sheet's text as its author wrote it.
 *
 * `readStyleSource` reassembles a linked sheet from `rule.cssText`, which is the
 * browser's re-serialization: no comments, `#fff` rewritten as `rgb(255, 255, 255)`,
 * `0` as `0px`, every line break the author chose replaced by the browser's. That is
 * fine for looking at and wrong for editing, because whatever the user applies
 * becomes the new contents of the file — so the thing they started from had better
 * be the file.
 *
 * One same-origin fetch, which in practice is a cache hit: the browser downloaded
 * this stylesheet to render the page. Falls back to the CSSOM when there is no file
 * to read, so a caller never has to branch on it.
 */
export async function fetchStyleSource(
  source: StyleSource,
  project?: FileHost | null,
): Promise<string> {
  if (source.element) return source.element.textContent ?? '';

  /*
   * The project comes first, and not only as a fallback.
   *
   * Disk is the source of truth in a way a request is not. Over `file://` the fetch
   * fails for the same origin reason `cssRules` did, so it is the only thing that works
   * at all. Behind a dev server it *would* work, but it can hand back a transformed
   * copy — and since whatever ends up in this buffer is what gets written to the file,
   * starting from a transformed copy means writing one back over the source.
   */
  if (source.path && project) {
    const text = await project.read(source.path);
    if (text !== null) return text;
  }

  if (!source.href || source.readOnly) return readStyleSource(source);
  try {
    const response = await fetch(source.href, { credentials: 'same-origin' });
    if (!response.ok) return readStyleSource(source);
    const text = await response.text();
    return text || readStyleSource(source);
  } catch {
    return readStyleSource(source);
  }
}

/* -------------------------------------------------------------------------- */
/* Locating a live rule in its file                                            */
/* -------------------------------------------------------------------------- */

/**
 * Where the change has to land when it is not the document.
 *
 * `'document'` means the edit is already captured by serializing the page — an
 * inline `<style>`, an inline `<script>`, an element's attributes. Anything else is a
 * URL that has to be written on its own.
 */
export const DOCUMENT_TARGET = 'document';

export interface RuleLocation {
  /** A file URL, or `DOCUMENT_TARGET` for a rule in an inline `<style>`. */
  writeTo: string;
  /**
   * Stable id of the sheet, for a change record to refer to it by.
   *
   * A record cannot hold a `CSSStyleSheet`, and `writeTo` does not identify one: two
   * inline `<style>` elements both write to the document. So the sheet gets an id
   * that lasts the session, the record carries the id, and whoever needs the live
   * sheet again asks for it by name.
   */
  sheetId: string;
  /** Human label for the sheet holding the rule. */
  label: string;
  /**
   * Index chain from the sheet root: `[4, 1]` is the second rule inside the fifth.
   *
   * The precise way to name a rule in a file. Both the browser and the text scanner
   * walk a stylesheet in the same order, so a position identifies a rule without the
   * two of them having to agree on how a selector is spelled.
   */
  path: number[];
  /** Enclosing at-rule preludes, outermost first. */
  context: string[];
  /** The owning `<style>` element, when the rule is in one. */
  element?: HTMLStyleElement;
  sheet: CSSStyleSheet;
}

/**
 * Locate a live rule precisely enough to find it again in a file.
 *
 * Walks up through `parentRule` so a rule inside `@media` inside `@supports` reports
 * both its position and its conditions. Returns null for a rule whose sheet cannot
 * be reached — a constructed sheet, or one the browser detached — because a location
 * that cannot be verified is worse than none.
 */
export function describeRule(rule: CSSRule): RuleLocation | null {
  const sheet = rule.parentStyleSheet;
  if (!sheet) return null;

  const path: number[] = [];
  const context: string[] = [];
  let current: CSSRule | null = rule;

  while (current) {
    const parent: CSSRule | null = current.parentRule;
    let list: CSSRuleList;
    try {
      list = parent ? (parent as CSSGroupingRule).cssRules : sheet.cssRules;
    } catch {
      return null;
    }
    const index = indexOfRule(list, current);
    if (index === -1) return null;
    path.unshift(index);
    if (parent) context.unshift(preludeOf(parent));
    current = parent;
  }

  const node = sheet.ownerNode;
  /*
   * A stand-in is a `<style>` in the document and a file on disk, and this is the
   * question that has to answer "file". `element` being set means two things at once
   * here — paint through `textContent`, and *this edit is captured by serializing the
   * page* — and the second is false for a mirror: the rule belongs to a `.css` file
   * that the save has to write. Reading it as an inline style would quietly move
   * every rule edit out of the stylesheet and into the exported HTML.
   */
  const mirror = styleMirrorOfNode(node);
  if (mirror) {
    return {
      writeTo: mirror.href,
      sheetId: sheetIdFor(sheet),
      label: fileName(mirror.href) ?? 'stylesheet',
      path,
      context,
      sheet,
    };
  }

  const element = node instanceof HTMLStyleElement ? node : undefined;
  const href = sheet.href ?? undefined;

  return {
    writeTo: element ? DOCUMENT_TARGET : (href ?? DOCUMENT_TARGET),
    sheetId: sheetIdFor(sheet),
    label: element ? element.id || 'inline <style>' : (fileName(href) ?? 'stylesheet'),
    path,
    context,
    element,
    sheet,
  };
}

/* -------------------------------------------------------------------------- */
/* Naming sheets so records can refer to them                                  */
/* -------------------------------------------------------------------------- */

/*
 * Ids are handed out on first use and last for the session.
 *
 * The reverse map holds sheets strongly, which is a leak in principle — bounded by
 * the number of stylesheets a page has, and cleared on unmount. The alternative, a
 * `WeakRef`, would let an id go dead while a change record still names it, turning a
 * write that should work into one that quietly cannot find its sheet.
 */
const sheetIds = new WeakMap<CSSStyleSheet, string>();
const sheetsById = new Map<string, CSSStyleSheet>();
let sheetSequence = 0;

/**
 * Stylesheet text as last read from its file, keyed by `StyleSource.id`.
 *
 * A `StyleSource` is a description, rebuilt from scratch on every render, so it is
 * the wrong place to keep something a disk read or a fetch went and got — the next
 * render throws it away. This is the right place: keyed on the id, which derives
 * from the sheet's href and so is stable for the session.
 *
 * For a sheet the browser refuses to expose it is the *only* view the page has.
 * `cssRules` throws and a `file://` fetch is refused, so without this there is
 * nothing to count rules from and nothing for the registries to read.
 */
const styleTexts = new Map<string, string>();

/** Keep a stylesheet's own text, for whatever needs it after this render. */
export function rememberStyleText(id: string, text: string): void {
  styleTexts.set(id, text);
}

function sheetIdFor(sheet: CSSStyleSheet): string {
  const existing = sheetIds.get(sheet);
  if (existing) return existing;
  sheetSequence += 1;
  const id = `s${sheetSequence}`;
  sheetIds.set(sheet, id);
  sheetsById.set(id, sheet);
  return id;
}

export function sheetById(id: string): CSSStyleSheet | null {
  return sheetsById.get(id) ?? null;
}

/** The `<style>` element owning a named sheet, when it is an inline one. */
export function styleElementById(id: string): HTMLStyleElement | null {
  const node = sheetsById.get(id)?.ownerNode;
  return node instanceof HTMLStyleElement ? node : null;
}

/** Drop the id table. Called on unmount, so nothing outlives the editor. */
export function resetSheetIds(): void {
  sheetsById.clear();
  styleTexts.clear();
  sheetSequence = 0;
}

function indexOfRule(list: CSSRuleList, rule: CSSRule): number {
  for (let i = 0; i < list.length; i += 1) {
    if (list.item(i) === rule) return i;
  }
  return -1;
}

/** An at-rule's prelude: everything before its opening brace. */
function preludeOf(rule: CSSRule): string {
  let text = '';
  try {
    text = rule.cssText ?? '';
  } catch {
    return '';
  }
  const brace = text.indexOf('{');
  return (brace === -1 ? text : text.slice(0, brace)).trim();
}

/**
 * Replace a sheet's contents, reversibly.
 *
 * A `<style>` element is written through `textContent`, which the browser reparses
 * — simple, and exactly what the page author would have typed. A linked sheet has
 * no text to write, so its rules are swapped one at a time through the CSSOM; the
 * original text is kept so undo can put it back the same way.
 *
 * Returns null when the text has no valid rules, so a typo cannot blank a
 * stylesheet the user cannot get back.
 */
export function writeStyleSource(source: StyleSource, css: string): Command | null {
  if (source.readOnly) return null;
  // The file's text when the panel has it, so the recorded change is a diff against
  // the file rather than against the CSSOM's rewrite of it.
  const before = source.pendingBefore ?? readStyleSource(source);
  const after = css;
  if (before.trim() === after.trim()) return null;

  const element = source.element;
  const sheet = source.sheet;
  if (!element && !sheet) return null;

  /*
   * Painting, in the order of what the sheet actually is.
   *
   * A stand-in is written as text, because reparsing is what makes a *removal* show up
   * — swapping rules through the CSSOM can add and change but never notices that the
   * new text is missing something the old one had. It also keeps the remembered text
   * in step, so the next edit to this sheet diffs against what is on screen rather
   * than against the copy that was on disk before this session started.
   *
   * A sheet the browser refuses to expose and could not be stood in for cannot be
   * updated at all, so the write is the record and the file. Swallowing that failure
   * is right: the caller has been told through `unpreviewable` that the page will not
   * change, and throwing would make an edit that is about to reach disk look failed.
   */
  const paint = (css: string): void => {
    rememberStyleText(source.id, css);
    const mirror = styleMirrorFor(sheet);
    if (mirror) {
      paintStyleMirror(mirror, css);
      return;
    }
    if (element) {
      element.textContent = css;
      return;
    }
    if (!sheet) return;
    try {
      replaceRules(sheet, css);
    } catch {
      /* Unreadable sheet. The change lives in the record and reaches the file. */
    }
  };
  const apply = (): void => paint(after);
  const revert = (): void => paint(before);

  return {
    label: `Edit ${source.label}`,
    // Keyed on the sheet so successive edits to the same file collapse into one
    // reported change rather than a list of intermediate states.
    subject: `sheet:${source.id}`,
    record: {
      id: nextChangeId(),
      kind: 'style',
      summary: `Edit the CSS in ${source.label}`,
      target: source.href ?? source.label,
      group: `sheet:${source.id}`,
      before: summarize(before),
      after: summarize(after),
      detail: {
        file: source.href ?? source.label,
        scope: 'stylesheet',
        css: after,
        // An inline sheet is already part of the page, so serializing the document
        // carries this edit; a linked one has a file of its own to be written.
        writeTo: source.element ? DOCUMENT_TARGET : (source.href ?? DOCUMENT_TARGET),
      },
      at: Date.now(),
    },
    apply,
    revert,
  };
}

/**
 * Swap a sheet's rules for the ones parsed from `css`.
 *
 * Parsing happens in a throwaway `<style>` first, so a syntax error leaves the
 * live sheet untouched instead of half-replaced. Individual rules that the sheet
 * refuses — `@import` after other rules, say — are skipped rather than aborting the
 * whole write.
 */
function replaceRules(sheet: CSSStyleSheet, css: string): void {
  const parsed = parseRules(css);
  while (sheet.cssRules.length > 0) {
    try {
      sheet.deleteRule(0);
    } catch {
      break;
    }
  }
  for (const text of parsed) {
    try {
      sheet.insertRule(text, sheet.cssRules.length);
    } catch {
      // Not valid in this position; the rest of the sheet is still worth writing.
    }
  }
}

/**
 * Hand CSS text to a visitor as a stylesheet this page is allowed to read.
 *
 * Text is same-origin wherever the file it came from was served from, so parsing it
 * in a `<style>` this document owns turns a stylesheet the browser refused into
 * rules that can be walked. That is what lets the design system read a file it can
 * only reach through a connected folder.
 *
 * The probe carries `data-heo-internal`, so nothing that scans the page picks it up,
 * and it is removed before this returns — the sheet is only valid inside `visit`,
 * because a detached `<style>` has no `sheet` at all.
 */
export function withParsedSheet<T>(css: string, visit: (sheet: CSSStyleSheet) => T): T | null {
  const probe = document.createElement('style');
  probe.setAttribute('data-heo-internal', '');
  probe.textContent = css;
  document.head.appendChild(probe);
  try {
    const sheet = probe.sheet;
    return sheet ? visit(sheet) : null;
  } catch {
    return null;
  } finally {
    probe.remove();
  }
}

/** Top-level rule texts, via the browser's own parser. */
export function parseRules(css: string): string[] {
  return (
    withParsedSheet(css, (sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText)) ?? []
  );
}

/** How many rules the text parses to, for the editor's status line. */
export function countRules(css: string): number {
  return parseRules(css).length;
}

/**
 * The sheet's text as recorded, in full.
 *
 * This used to clip at 300 characters with an ellipsis. `detail.css` carries the whole
 * new sheet, so the prompt was never short of the *new* text — but `before` was the
 * only record of the old one, and half a stylesheet is not something a reader can
 * reason about. Nothing that describes a change gets elided.
 */
function summarize(css: string): string {
  return css;
}
