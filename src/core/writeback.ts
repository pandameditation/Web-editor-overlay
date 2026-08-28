import {
  patchCSS,
  upsertSection,
  type DeclarationPatch,
  type PatchFailure,
} from './css-patch.js';
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
  const documentRecords = records.filter((record) => isDocumentChange(record));
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
      if (before !== subject.html) {
        writes.push({
          path: documentPath,
          kind: 'document',
          reason: plural(documentRecords.length, 'change'),
          before,
          after: subject.html,
          records: documentRecords,
          unplaced: [],
        });
      }
    }
  }

  return { writes, unwritable };
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
function isDocumentChange(record: ChangeRecord): boolean {
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
