import { SOURCE_ATTR } from './constants.js';
import {
  patchCSS,
  upsertSection,
  type DeclarationPatch,
  type PatchFailure,
} from './css-patch.js';
import {
  parseSourceMarker,
  patchHTML,
  type ElementAnchor,
  type HtmlPatch,
} from './html-patch.js';
import type { FileHost } from './file-host.js';
import { DOCUMENT_TARGET, styleElementById } from './sheets.js';
import type { ChangeRecord } from './types.js';

/**
 * A session, as a set of files to write.
 *
 * The save prompt already describes every change precisely enough for a person or an
 * agent to apply: this file, that rule, this value. A write plan is the same
 * description executed instead of handed over. Nothing new is inferred — the records
 * are the source of truth for both, which is what keeps the two from disagreeing
 * about what a save means.
 *
 * Deriving the plan from `handoffRecords` rather than from the editor's live state
 * has a consequence worth stating: the include/exclude checkboxes in the save dialog
 * govern what reaches disk, not just what reaches the prompt. Unticking a change
 * leaves it on the page and out of the file, which is the same asymmetry the dialog
 * already explains.
 *
 * **Three kinds of file come out of this.**
 *
 * 1. *The document.* Everything the exported HTML already carries — text, attributes,
 *    structure, inline `<style>` and `<script>` — is one write of one file.
 * 2. *Linked stylesheets.* Rule edits are replayed as declaration patches against the
 *    file's own text, so a one-line change is a one-line diff. A whole-sheet edit from
 *    the CSS panel replaces the file outright, because that is literally what the user
 *    typed.
 * 3. *External scripts.* Replaced outright. Nothing else is possible: the editor can
 *    only know the new text, never which part of it is the change.
 *
 * A plan is built before anything is written, and it reads back what is on disk to do
 * it. That ordering is the point: the user sees which files are about to change, and
 * how many bytes each way, while it is still a proposal.
 */

/** One file the plan will write. */
export interface PlannedWrite {
  /** Project-relative path, as the host understands it. */
  path: string;
  /** What kind of thing this is, for grouping and for choosing an icon. */
  kind: 'document' | 'stylesheet' | 'script';
  /** Why this file is in the plan, in one phrase. */
  reason: string;
  /** Current contents, or null when the file is being created. */
  before: string | null;
  after: string;
  /** Records this write carries, so the UI can tie a file to the changes in it. */
  records: ChangeRecord[];
  /** Edits that could not be placed in this file. The write still happens without them. */
  unplaced: PatchFailure[];
  /**
   * Things about this write worth knowing before agreeing to it.
   *
   * Distinct from `unplaced`, which is about edits that did not land. This is about the
   * write itself doing more than the change list implies — most of all the document
   * write, which is a serialization of the live page and therefore carries whatever the
   * page's own code built, alongside the edits that were actually asked for.
   */
  warnings?: string[];
}

/** A change that cannot be written, and why. */
export interface UnwritableChange {
  record: ChangeRecord;
  reason: string;
}

export interface WritePlan {
  writes: PlannedWrite[];
  /**
   * Changes with nowhere to go.
   *
   * Never silently dropped. A cross-origin stylesheet, a file outside the folder that
   * was handed over, a script served from a CDN — each is a real limit, and the honest
   * response is to name it and leave the prompt carrying that change.
   */
  unwritable: UnwritableChange[];
}

export interface WriteResult {
  written: string[];
  failed: Array<{ path: string; reason: string }>;
  /** Edits that had no place in the file they belong to. */
  unplaced: PatchFailure[];
}

/** What a plan needs to know about the session, without reaching into the engine. */
export interface WriteSubject {
  records: readonly ChangeRecord[];
  /** The document as it should be written, overlay stripped. */
  html: string;
  /** Suggested name for the page's own file, when its URL does not give one. */
  fileName: string;
  /**
   * CSS the editor generated this session: new tokens and reusable classes.
   *
   * Kept apart from the records because it is not a change to an existing file — it
   * is new vocabulary that has to be given a home. See `designSystemTarget`.
   */
  designSystemCSS: string;
  /**
   * Where that CSS should go: a stylesheet URL, or `'document'` to leave it in the
   * `<style>` block the page is already rendering it from.
   *
   * A page keeping its CSS in files does not want its design tokens in a `<style>`
   * tag in the markup, and a page with no stylesheet to put them in has nowhere else.
   * So it is a choice with a sensible default rather than a rule.
   */
  designSystemTarget: string;
  /**
   * How many elements in `html` the page's own code built rather than the file declaring.
   *
   * `html` is the live page serialized, so for a page that renders part of itself the
   * document write carries that rendered markup into the source — a list built from data
   * arrives as a list of hand-written elements, and the script then overwrites it at
   * runtime anyway. Counted here rather than worked out in the plan because only the
   * engine can ask, and reported rather than silently removed: taking it out means
   * reconstructing the file instead of serializing the page, which is a different and
   * much larger change than saying what is about to happen.
   */
  generatedElements?: number;
}

/* -------------------------------------------------------------------------- */
/* Reading the records                                                         */
/* -------------------------------------------------------------------------- */

/** One rule-level edit, with the sheet it belongs to resolved. */
interface RulePatch {
  /** `'document'` or a stylesheet URL. */
  writeTo: string;
  sheetId: string;
  patch: DeclarationPatch;
  record: ChangeRecord;
}

/**
 * Rule edits, as patches.
 *
 * These are the changes that exist nowhere but in the record. Mutating `rule.style`
 * updates what renders and leaves both the `<style>` element's text and the linked
 * file untouched, so unless the edit is replayed into text it is lost the moment the
 * page reloads — which is true of the HTML export as much as of a file write.
 */
export function rulePatches(records: readonly ChangeRecord[]): RulePatch[] {
  const out: RulePatch[] = [];
  for (const record of records) {
    const detail = record.detail;
    if (detail?.scope !== 'stylesheet rule') continue;
    if (!detail.property) continue;
    out.push({
      writeTo: detail.writeTo ?? DOCUMENT_TARGET,
      sheetId: detail.sheet ?? '',
      record,
      patch: {
        path: detail.rulePath ? detail.rulePath.split('.').map(Number) : undefined,
        selector: detail.selector ?? record.target,
        context: parseContext(detail.ruleContext),
        property: detail.property,
        value: detail.value ?? '',
        priority: detail.priority,
      },
    });
  }
  return out;
}

function parseContext(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : undefined;
  } catch {
    return undefined;
  }
}

/** One inline `<style>` element and the rule edits that have to be replayed into it. */
export interface InlineStyleEdit {
  element: HTMLStyleElement;
  patches: DeclarationPatch[];
}

/**
 * Rule edits that belong to an inline `<style>`, grouped by the element.
 *
 * Handed to `exportHTML` so a serialized page carries them. Without this the export
 * is quietly wrong: the `<style>` element's text still says what it said before the
 * session, because CSSOM mutations never touch it.
 */
export function inlineStyleEdits(records: readonly ChangeRecord[]): InlineStyleEdit[] {
  const byElement = new Map<HTMLStyleElement, DeclarationPatch[]>();
  for (const entry of rulePatches(records)) {
    if (entry.writeTo !== DOCUMENT_TARGET) continue;
    const element = entry.sheetId ? styleElementById(entry.sheetId) : null;
    if (!element) continue;
    const bucket = byElement.get(element);
    if (bucket) bucket.push(entry.patch);
    else byElement.set(element, [entry.patch]);
  }
  return [...byElement.entries()].map(([element, patches]) => ({ element, patches }));
}

/* -------------------------------------------------------------------------- */
/* Building the plan                                                           */
/* -------------------------------------------------------------------------- */

export async function buildWritePlan(
  host: FileHost,
  subject: WriteSubject,
): Promise<WritePlan> {
  const writes: PlannedWrite[] = [];
  const unwritable: UnwritableChange[] = [];

  const documentPath = host.resolve(location.href);
  const records = [...subject.records];

  /* ---- 1. Linked stylesheets ---- */

  // Grouped per file, because a file is written once however many edits it holds.
  const sheetGroups = new Map<string, { records: ChangeRecord[]; patches: DeclarationPatch[]; replace?: string }>();

  for (const entry of rulePatches(records)) {
    if (entry.writeTo === DOCUMENT_TARGET) continue;
    const group = groupFor(sheetGroups, entry.writeTo);
    group.patches.push(entry.patch);
    group.records.push(entry.record);
  }

  for (const record of records) {
    const detail = record.detail;
    if (detail?.scope !== 'stylesheet' || !detail.css) continue;
    const target = detail.writeTo ?? DOCUMENT_TARGET;
    if (target === DOCUMENT_TARGET) continue;
    const group = groupFor(sheetGroups, target);
    // A whole-sheet edit is the user's own text for the file, so it wins over any
    // patch aimed at the same file: they were editing the result, not a declaration.
    group.replace = detail.css;
    group.records.push(record);
  }

  for (const [url, group] of sheetGroups) {
    const path = host.resolve(url);
    if (!path) {
      for (const record of group.records) {
        unwritable.push({ record, reason: reasonForUnreachable(url, host) });
      }
      continue;
    }
    const before = await host.read(path);
    if (before === null && !group.replace) {
      for (const record of group.records) {
        unwritable.push({
          record,
          reason: `${path} is not in ${host.label}, so its rules cannot be edited in place.`,
        });
      }
      continue;
    }

    const base = group.replace ?? before ?? '';
    const result = group.replace
      ? { css: group.replace, failed: [] as PatchFailure[] }
      : patchCSS(base, group.patches);

    if (result.css === before) continue;
    writes.push({
      path,
      kind: 'stylesheet',
      reason: group.replace
        ? 'replaced from the CSS panel'
        : plural(group.patches.length, 'declaration'),
      before,
      after: result.css,
      records: group.records,
      unplaced: result.failed,
    });
  }

  /* ---- 2. External scripts ---- */

  for (const record of records) {
    const detail = record.detail;
    if (detail?.scope !== 'external script' || !detail.script) continue;
    const url = detail.writeTo ?? detail.file ?? '';
    /*
     * `sourcePath` skips resolution, and only build-time instrumentation sets it.
     *
     * That marker reports a path relative to the project root, which is already what a
     * host wants — putting it through `resolve` would first have to turn it into a URL
     * against the page, and a page served from a subdirectory would resolve it to the
     * wrong file. A URL is the case `resolve` exists for.
     */
    const path = detail.sourcePath ?? (url ? host.resolve(url) : null);
    if (!path) {
      unwritable.push({ record, reason: reasonForUnreachable(url, host) });
      continue;
    }
    const before = await host.read(path);
    if (before === detail.script) continue;
    writes.push({
      path,
      kind: 'script',
      reason: 'replaced from the JS panel',
      before,
      after: detail.script,
      records: [record],
      unplaced: [],
    });
  }

  /* ---- 2b. Source files behind rendered content ---- */

  for (const record of records) {
    const detail = record.detail;
    if (detail?.scope !== 'rendered source' || !detail.script) continue;
    const path = detail.sourcePath ?? (detail.writeTo ? host.resolve(detail.writeTo) : null);
    if (!path) {
      unwritable.push({ record, reason: reasonForUnreachable(detail.writeTo ?? '', host) });
      continue;
    }
    const before = await host.read(path);
    if (before === detail.script) continue;
    writes.push({
      path,
      kind: 'script',
      reason: 'the code that renders edited content',
      before,
      after: detail.script,
      records: [record],
      unplaced: [],
    });
  }

  /* ---- 3. New tokens and classes, when they belong in a file ---- */

  const systemTarget = subject.designSystemTarget;
  if (systemTarget && systemTarget !== DOCUMENT_TARGET) {
    const path = host.resolve(systemTarget);
    if (!path) {
      // Not fatal: the CSS is still in the page and still in the prompt.
      unwritable.push({
        record: designSystemRecord(subject.designSystemCSS),
        reason: reasonForUnreachable(systemTarget, host),
      });
    } else {
      const existing = writes.find((write) => write.path === path);
      const before = existing ? existing.before : await host.read(path);
      const base = existing ? existing.after : (before ?? '');
      const after = upsertSection(base, subject.designSystemCSS);
      if (after !== before) {
        if (existing) {
          existing.after = after;
          existing.reason = `${existing.reason}, plus tokens and classes`;
        } else {
          writes.push({
            path,
            kind: 'stylesheet',
            reason: 'new tokens and classes',
            before,
            after,
            records: [],
            unplaced: [],
          });
        }
      }
    }
  }

  /* ---- 4. The document itself ---- */

  // Last, so the reason can mention what is *not* in it, and so a page with no
  // document-level change at all does not get rewritten for nothing.
  /*
   * An edit to rendered content is reported, not written.
   *
   * The element it changes is not in the HTML file — the page builds it — so the document
   * write cannot carry the edit, and the next render would replace it even if it could.
   * Counting it as a change to the file would make the plan promise something it has no
   * way to deliver, so it goes in the list of changes with nowhere to go, where the
   * reason is stated and the prompt still carries it.
   */
  const systemInDocument = subject.designSystemTarget === DOCUMENT_TARGET;
  const documentRecords: ChangeRecord[] = [];
  for (const record of records) {
    if (!isDocumentChange(record, systemInDocument)) continue;
    const rendered = record.detail?.rendered;
    if (rendered) {
      unwritable.push({ record, reason: rendered });
      continue;
    }
    documentRecords.push(record);
  }
  if (documentRecords.length) {
    if (!documentPath) {
      for (const record of documentRecords) {
        unwritable.push({
          record,
          reason: `This page is not inside ${host.label}, so its markup cannot be written.`,
        });
      }
    } else {
      const before = await host.read(documentPath);

      /*
       * Patch the file where every change can be placed in it.
       *
       * All or nothing, deliberately. Patching some changes and serializing for the rest
       * would mean writing the serialized page anyway, so the patches would be pointless;
       * and patching some and dropping the rest would silently stop writing edits that
       * used to reach the file. So either the whole change set can be expressed as edits to
       * the file — in which case nothing else in it is touched, which is the entire point —
       * or the page is serialized exactly as before.
       */
      const patched =
        before === null ? null : tryPatchDocument(before, documentRecords, documentPath);
      if (patched) {
        if (patched.html !== before) {
          writes.push({
            path: documentPath,
            kind: 'document',
            reason: `${plural(documentRecords.length, 'change')}, patched in place`,
            before,
            after: patched.html,
            records: documentRecords,
            unplaced: [],
          });
        }
      } else if (before !== subject.html) {
        const warnings: string[] = [];
        const generated = subject.generatedElements ?? 0;
        // Only reached when a change could not be placed, so say which and why: this is
        // the difference between "the editor reformatted my file" and a known trade.
        const blockers = documentRecords
          .filter((record) => !anchorInFile(record, documentPath))
          .map((record) => record.summary);
        if (blockers.length) {
          warnings.push(
            `The whole file is rewritten because ${blockers.length === 1 ? 'one change could' : `${blockers.length} changes could`} ` +
            `not be located in it: ${blockers.slice(0, 3).join('; ')}${blockers.length > 3 ? '; …' : ''}.`,
          );
        }
        if (generated) {
          warnings.push(
            `This is the page as it stands, so ${generated} element${generated === 1 ? '' : 's'} ` +
            `built by the page's own code ${generated === 1 ? 'is' : 'are'} written into the ` +
            `markup as well. The code will rebuild ${generated === 1 ? 'it' : 'them'} on the ` +
            `next load either way. Untick the changes below to leave this file alone.`,
          );
        }
        warnings.push(
          'The whole file is rewritten from the page, so quoting, self-closing tags and ' +
          'letter case are normalised even on lines that did not change.',
        );
        writes.push({
          path: documentPath,
          kind: 'document',
          reason: plural(documentRecords.length, 'change'),
          before,
          after: subject.html,
          records: documentRecords,
          unplaced: [],
          warnings,
        });
      }
    }
  }

  return { writes, unwritable };
}

/**
 * The change kinds that can be expressed as an edit to the file's text.
 *
 * Attribute, class and style edits rewrite one attribute; a text edit replaces one
 * element's content. Structural change — inserting, deleting, moving, wrapping — is a
 * different problem: it needs the file's own indentation and sibling layout reproduced, and
 * getting that subtly wrong makes a mess of a file rather than a wrong value in it. Those
 * still go through serialization, which handles them correctly.
 */
const PATCHABLE = new Set<ChangeRecord['kind']>(['text', 'attribute', 'class', 'style']);

/**
 * The anchor to use for this record against this file, or null when there is none.
 *
 * The source marker is only honoured when it names the file being patched. On a page built
 * from components it names a template instead, and its line number describes a position in
 * that template — following it into the HTML would land somewhere arbitrary and patch the
 * wrong element, which is the one outcome worth more care than a reformatted file.
 */
function anchorInFile(record: ChangeRecord, documentPath: string): ElementAnchor | null {
  const anchor = record.anchor;
  if (!anchor || !PATCHABLE.has(record.kind)) return null;

  const marker = anchor.src ? parseSourceMarker(anchor.src) : null;
  const inThisFile = marker != null && samePath(marker.file, documentPath);
  if (inThisFile && marker) {
    return { ...anchor, line: marker.line, column: marker.column };
  }
  if (anchor.id) return { tag: anchor.tag, id: anchor.id };
  // Nothing durable on the element itself. For a text edit the text being replaced can
  // stand in, provided the file contains it once — which is what makes a plain page with
  // no ids and no build step patchable at all.
  if (record.kind === 'text' && record.before) {
    return { tag: anchor.tag, text: record.before };
  }
  return null;
}

/** Two paths for the same file, allowing for one being root-relative and one not. */
function samePath(a: string, b: string): boolean {
  const clean = (value: string): string => value.replace(/^\.?\//, '');
  return clean(a) === clean(b) || clean(b).endsWith(`/${clean(a)}`) || clean(a).endsWith(`/${clean(b)}`);
}

/** The element a record refers to, still in the page, or null. */
function liveElementFor(anchor: ElementAnchor): HTMLElement | null {
  if (anchor.id) {
    const byId = document.getElementById(anchor.id);
    if (byId) return byId;
  }
  if (anchor.src) {
    const found = document.querySelector(`[${SOURCE_ATTR}="${CSS.escape(anchor.src)}"]`);
    if (found instanceof HTMLElement) return found;
  }
  return null;
}

/**
 * Turn the document changes into edits to the file, or return null.
 *
 * Null means "not every change fits", and the caller then serializes as it always did.
 * Nothing here is best-effort: a patch that resolved to the wrong element would write an
 * edit into unrelated markup, which is worse than the reformatting this avoids.
 */
function tryPatchDocument(
  html: string,
  records: readonly ChangeRecord[],
  documentPath: string,
): { html: string } | null {
  if (!records.length) return null;

  /*
   * Values come from the live element, not from the record.
   *
   * A style record's `after` is one declaration's value and a class record's is one class
   * name, so writing either into the attribute it belongs to would produce `padding="12px"`.
   * The element itself has the finished attribute, which is also what makes several edits to
   * one attribute collapse into a single patch carrying the value the user ended up with.
   * Keyed on the anchor and the attribute so that collapsing happens by construction.
   */
  const wanted = new Map<string, HtmlPatch>();

  for (const record of records) {
    const anchor = anchorInFile(record, documentPath);
    if (!anchor) return null;
    const el = liveElementFor(record.anchor ?? anchor);

    if (record.kind === 'text') {
      // No live element is fine here: the recorded `after` is the text, and for a text
      // anchor there is nothing else to read anyway.
      const value = el ? el.innerHTML : (record.after ?? '');
      wanted.set(`${anchorKey(anchor)}|#text`, { anchor, kind: 'text', value });
      continue;
    }

    const name =
      record.kind === 'style' ? 'style' : record.kind === 'class' ? 'class' : record.detail?.attribute;
    if (!name || !el) return null;
    wanted.set(`${anchorKey(anchor)}|${name}`, {
      anchor,
      kind: 'attribute',
      name,
      value: el.getAttribute(name),
    });
  }

  const result = patchHTML(html, [...wanted.values()]);
  // One failure and the whole approach is off: the edit has to reach the file somehow.
  if (result.failed.length) return null;
  return { html: result.html };
}

function anchorKey(anchor: ElementAnchor): string {
  return `${anchor.tag}|${anchor.id ?? ''}|${anchor.line ?? ''}|${anchor.column ?? ''}|${anchor.text ?? ''}`;
}

function groupFor(
  groups: Map<string, { records: ChangeRecord[]; patches: DeclarationPatch[]; replace?: string }>,
  key: string,
): { records: ChangeRecord[]; patches: DeclarationPatch[]; replace?: string } {
  const existing = groups.get(key);
  if (existing) return existing;
  const created = { records: [], patches: [] };
  groups.set(key, created);
  return created;
}

/**
 * True when serializing the page carries this change.
 *
 * Everything except a linked stylesheet and an external script, which is why this is
 * written as an exclusion: a new kind of element edit should be covered by the
 * document write without anyone having to remember to add it here.
 */
function isDocumentChange(record: ChangeRecord, designSystemInDocument: boolean): boolean {
  /*
   * A token or class edit belongs to the design system, not to the document.
   *
   * Where it lands is the one thing the design-system target decides, and it is delivered
   * by `designSystemCSS` — so counting these as document changes as well wrote the same
   * `--clay: #846b62` into two files at once: the stylesheet that was chosen for it, and the
   * page, via the generated `<style>` block the editor renders it from. The block is how the
   * change shows on screen before it is saved; it is not a second home for it.
   *
   * When the target *is* the document, that block is the only place it can go, and then
   * these really are document changes.
   */
  if (record.kind === 'token' || record.kind === 'token-class') return designSystemInDocument;
  const target = record.detail?.writeTo;
  return !target || target === DOCUMENT_TARGET;
}

function reasonForUnreachable(url: string, host: FileHost): string {
  const label = url || 'that file';
  try {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== location.origin && parsed.protocol !== 'file:') {
      return `${label} is served from another origin, so this page cannot write it.`;
    }
  } catch {
    /* not a URL; the generic answer is the right one */
  }
  return `${label} is outside ${host.label}, so it cannot be written from here.`;
}

/**
 * A stand-in record for the design system, which is vocabulary rather than an edit.
 *
 * Only ever used to explain why the CSS could not be filed, so it needs a summary and
 * nothing else that would make it look like a change the user made.
 */
function designSystemRecord(css: string): ChangeRecord {
  return {
    id: 'design-system',
    kind: 'token',
    summary: 'New tokens and reusable classes',
    target: 'design system',
    after: css,
    at: Date.now(),
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/* -------------------------------------------------------------------------- */
/* Writing it                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Write the plan, one file at a time, reporting each outcome.
 *
 * Sequential rather than parallel, and it keeps going after a failure. A partial
 * write is the honest outcome of a partial success — there is no transaction to roll
 * back to on a filesystem, and stopping at the first error would leave the user with
 * an arbitrary prefix of their changes and no list of which ones landed.
 */
export async function applyWritePlan(host: FileHost, plan: WritePlan): Promise<WriteResult> {
  const written: string[] = [];
  const failed: Array<{ path: string; reason: string }> = [];
  const unplaced: PatchFailure[] = [];

  for (const write of plan.writes) {
    unplaced.push(...write.unplaced);
    try {
      await host.write(write.path, write.after);
      written.push(write.path);
    } catch (error) {
      failed.push({
        path: write.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { written, failed, unplaced };
}
