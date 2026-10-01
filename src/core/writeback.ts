import { BLOCK_ATTR } from './constants.js';
import {
  patchCSS,
  upsertSection,
  type DeclarationPatch,
  type PatchFailure,
} from './css-patch.js';
import { isEditorOwned, type DomOp } from './dom-journal.js';
import type { JournalEntry } from './history.js';
import { dropBlockLinks, upsertSeedBlock, upsertStyleBlock } from './html-patch.js';
import { elementOfRecord } from './mutations.js';
import { patchSourceFromJournal } from './source-patch.js';
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
 * 1. *The document.* Every DOM change the session journaled — text, attributes,
 *    structure, inline `<style>` and `<script>` — patched into the file's own text and
 *    verified by reading it back. See `source-patch.ts`.
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
   * write itself doing more than the change list implies.
   */
  warnings?: string[];
  /**
   * For a document write, the journal operations the written file now carries.
   *
   * Handed back after a successful write so the next save knows what the file already says.
   */
  journalOps?: readonly (readonly DomOp[])[];
}

/** The page's DOM history, as the save needs it. See `History.journal`. */
export interface DocumentJournal {
  retired: readonly JournalEntry[];
  applied: readonly JournalEntry[];
  rolledBack: readonly JournalEntry[];
  /** Every pending change, ticked or not. */
  pending: readonly ChangeRecord[];
  /** What each file received from an earlier save in this session, by path. */
  written: ReadonlyMap<string, { text: string; ops: readonly (readonly DomOp[])[] }>;
}

/**
 * The vocabulary kinds a session can author, each as CSS.
 *
 * Empty strings are the normal case: most sessions touch one of the four.
 */
export interface DesignSystemCSS {
  tokens: string;
  classes: string;
  rules: string;
  /** Generated, component-scoped CSS from the block library. */
  blockCSS?: string;
}

/** The parts, in cascade order, as one block. Empty when nothing was authored. */
export function designSystemCSSText(css: DesignSystemCSS): string {
  return [css.tokens, css.classes, css.rules, css.blockCSS ?? '']
    .filter((part) => part.trim())
    .join('\n\n');
}

/** Which kinds are present, for a reason a reader can act on. */
function designSystemKinds(css: DesignSystemCSS): string[] {
  const kinds: string[] = [];
  if (css.tokens.trim()) kinds.push('tokens');
  if (css.classes.trim()) kinds.push('classes');
  if (css.rules.trim()) kinds.push('rules');
  if (css.blockCSS?.trim()) kinds.push('scoped block CSS');
  return kinds;
}

/** `tokens and classes`, `tokens, classes and rules`. */
function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A change that cannot be written, and why. */
export interface UnwritableChange {
  record: ChangeRecord;
  reason: string;
  /**
   * True when the change could be written once the reason is dealt with — the document patch was
   * refused — rather than having nowhere to go at all. Such a change is still pending after the
   * save; it must not be counted as saved.
   */
  blocking?: boolean;
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
   * CSS the editor generated this session, in four parts.
   *
   * Kept apart from the records because it is not a change to an existing file — it is
   * new vocabulary that has to be given a home. See `designSystemTarget`.
   *
   * Split rather than pre-joined so the plan can say which kinds a file is about to
   * receive: "new tokens and rules" is a materially different write from "new classes",
   * and a single string can only be described as "the design system". The join order is
   * settled here, in one place, because it decides the cascade — two rules of equal
   * specificity are resolved by which comes last.
   */
  designSystemCSS: DesignSystemCSS;
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
   * The block library, encoded as a seed, when the user asked for it to travel with the page.
   *
   * Empty or absent means it does not. A separate field from `designSystemCSS` because it is a
   * separate payload with a separate destination: CSS can go to a stylesheet and a seed cannot
   * go anywhere but the markup, so there is no target to choose — only whether to write it.
   */
  blockLibrarySeed?: string;
  /**
   * Take the library out of the file rather than leaving or updating it.
   *
   * The third state `blockLibrarySeed` cannot express. Empty means "not this time", which has to
   * leave a library already in the file alone — so wanting it gone needs saying separately, and
   * it takes the instance links with it: a `data-heo-block` naming a template the file no longer
   * carries is a dangling reference, which is the thing the link was kept out of exports to avoid
   * in the first place.
   */
  removeBlockLibrary?: boolean;
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
  generatedRegions?: readonly HTMLElement[];
  /**
   * Every DOM operation the session made, which is what the document write is built from.
   *
   * Without it the document cannot be patched, and is not written.
   */
  journal?: DocumentJournal;
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

  /* ---- 3. New tokens, classes and rules, when they belong in a file ---- */

  const systemTarget = subject.designSystemTarget;
  const systemCSS = designSystemCSSText(subject.designSystemCSS);
  const systemKinds = listPhrase(designSystemKinds(subject.designSystemCSS));
  /*
   * Whether the design system reached a file, so step 5 can account for the records that
   * describe it. This step is driven by the CSS text rather than by the records, which is right —
   * it is delivered wholesale — but it left nobody responsible for saying that a token edit had
   * gone nowhere.
   */
  let systemFiled = false;
  let systemPath: string | null = null;
  if (systemTarget && systemTarget !== DOCUMENT_TARGET) {
    const path = host.resolve(systemTarget);
    systemPath = path;
    if (!path) {
      // Not fatal: the CSS is still in the page and still in the prompt.
      systemFiled = true;
      unwritable.push({
        record: designSystemRecord(systemCSS),
        reason: reasonForUnreachable(systemTarget, host),
      });
    } else {
      const existing = writes.find((write) => write.path === path);
      const before = existing ? existing.before : await host.read(path);
      const base = existing ? existing.after : (before ?? '');
      const after = upsertSection(base, systemCSS);
      if (after !== before) {
        systemFiled = true;
        /*
         * Whether the *section* step changed anything, which is not the same question as whether
         * the file differs from disk.
         *
         * `base` is what this file was already going to say — the patched text, when step 1 has
         * queued a write for it. Asking only `after !== before` conflated the two: a declaration
         * patched into a stylesheet that also happens to be the design system's target made this
         * step restate a write it had not touched, stamping it with a reason that ended in
         * "plus " and nothing at all. It also pushed a write of an empty string for a file that
         * does not exist and had no design system to put in it.
         */
        if (after !== base) {
          // Empty kinds and a changed section means the block came *out*: the session's vocabulary
          // was undone, and `upsertSection` closed the gap it left behind.
          if (existing) {
            existing.after = after;
            existing.reason = `${existing.reason}, plus ${systemKinds || 'its design system block removed'
              }`;
          } else {
            writes.push({
              path,
              kind: 'stylesheet',
              reason: systemKinds ? `new ${systemKinds}` : 'the design system block removed',
              before,
              after,
              records: [],
              unplaced: [],
            });
          }
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
  const blockSeed = subject.blockLibrarySeed?.trim() ?? '';
  const removeLibrary = subject.removeBlockLibrary === true;
  /*
   * Whether an element belongs to a region the page built.
   *
   * Only the outermost element of each region is handed over, so containment is the question
   * rather than membership — a rebuilt container's child may be any depth inside one.
   */
  const regions = subject.generatedRegions ?? [];
  const isGenerated = (el: HTMLElement): boolean =>
    regions.some((region) => region === el || region.contains(el));
  const documentRecords: ChangeRecord[] = [];
  const unreachableRecords: ChangeRecord[] = [];
  for (const record of records) {
    // Removing the library is a document change too: the seed region and the links it justified
    // both live in the markup, so the file has to be reached even with no seed to put in it.
    if (!isDocumentChange(record, systemInDocument, Boolean(blockSeed), removeLibrary)) continue;
    const beyondReach = unreachableInMarkup(record, isGenerated);
    if (beyondReach) {
      unwritable.push({ record, reason: beyondReach });
      unreachableRecords.push(record);
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
       * Patch the file from the journal, or do not write it.
       *
       * Never a serialization of the page: that reformats every line and drags the page's own
       * rendering into the markup. The journal-driven patch either places every ticked change
       * and proves the result reads back as intended, or names what stopped it — and then the
       * changes are listed as not written, where the user can see them and act.
       */
      const why: string[] = [];
      if (before === null) {
        writes.push({
          path: documentPath,
          kind: 'document',
          reason: `${plural(documentRecords.length, 'change')}, written as a new file`,
          before,
          after: subject.html,
          records: documentRecords,
          unplaced: [],
        });
      } else {
        const patched = tryPatchDocument(
          before,
          documentRecords,
          documentPath,
          why,
          subject,
          // Only when the document is where the design system is going. A stylesheet target
          // has already had it written by step 3, and writing it twice is the bug that
          // `isDocumentChange` exists to prevent.
          systemInDocument ? systemCSS : '',
          unreachableRecords,
        );
        if (patched) {
          /*
           * An edit made to something this write leaves out — a copy whose duplication was
           * unticked — has nowhere in the file to go. Said, not silently dropped.
           */
          for (const record of patched.stranded) {
            unwritable.push({
              record,
              reason: `“${record.summary}” was made to an element that is not itself going into the file.`,
            });
          }
          for (const record of patched.unplaced) {
            unwritable.push({ record, reason: unplacedReason(record) });
          }
          if (patched.html !== before) {
            writes.push({
              path: documentPath,
              kind: 'document',
              reason: `${plural(documentRecords.length, 'change')}, patched in place`,
              before,
              after: patched.html,
              records: documentRecords.filter(
                (record) => !patched.stranded.includes(record) && !patched.unplaced.includes(record),
              ),
              unplaced: [],
              journalOps: patched.ops,
            });
          }
        } else {
          const reason = `This change could not be written into ${documentPath}: ${why[0] ?? 'it could not be placed in the file'}.`;
          for (const record of documentRecords) unwritable.push({ record, reason, blocking: true });
        }
      }
    }
  }

  /* ---- 5. Design-system and library changes that reached no file ---- */

  /*
   * The step that stops a change disappearing.
   *
   * Steps 3 and 4 divide these between them by destination and neither owned the case where
   * *neither* applied, so a real, ticked, undoable change could produce no write and no
   * explanation. The plan then said "every change is already in the files" — which is how
   * deleting a token and pressing save produced a dialog with nothing to write and no reason.
   *
   * Three ways it happens, and they want different things said. The design system's CSS may be
   * unchanged by the edit: deleting a token the page's own stylesheet declares removes it from the
   * editor's list, and the editor never wrote it, so there is nothing of the editor's to rewrite.
   * The library may have nowhere to go because the box is clear. And the document write may simply
   * not have happened.
   */
  const documentFiled = writes.some((write) => write.kind === 'document');
  const systemHome = systemPath ?? (systemInDocument ? 'this page' : systemTarget);
  for (const record of records) {
    if (!DESIGN_SYSTEM.has(record.kind)) continue;

    if (record.kind === 'block') {
      if (blockSeed || removeLibrary) {
        if (!documentFiled) {
          unwritable.push({
            record,
            reason:
              'The library is written into the markup, and this save is not writing the markup.',
          });
        }
        continue;
      }
      unwritable.push({
        record,
        reason:
          'The block library is not being written into the page, so this has nowhere to go. ' +
          'Tick “Write the library into the page” above to persist it.',
      });
      continue;
    }

    if (isAuthoredBlockCSSRecord(record) && blockSeed) {
      if (!documentFiled) {
        unwritable.push({
          record,
          reason:
            'This authored block CSS is carried by the block-library seed, and this save is not writing the markup.',
        });
      }
      continue;
    }

    if (systemInDocument ? documentFiled : systemFiled) continue;
    unwritable.push({
      record,
      reason: systemCSS.trim()
        ? `The design system in ${systemHome} already matches this session, so this change does not alter it.`
        : `Nothing of the editor's design system is left to write, and ${systemHome} has no block of it to clear. A value the page's own stylesheet declares is removed by editing that file.`,
    });
  }

  return { writes, unwritable };
}

/**
 * Patch a copy of the document's own source, for a save that has nowhere to write.
 *
 * The same work as the document step of `buildWritePlan`, reachable without a `FileHost`. With
 * no folder connected there is still a file the page came from, and a download that reproduces
 * it with three attributes changed is worth much more than one serialized out of the DOM — the
 * user has to reconcile the result with what is on disk either way, and a diff of three lines
 * is a different proposition from a diff of the whole file.
 *
 * Returns the reasons rather than a string when it cannot be done, so the caller can say so
 * instead of quietly handing over a rewrite.
 */
export function patchDocumentSource(
  source: string,
  subject: WriteSubject,
  documentPath: string,
): { html: string; why: string[] } | { why: string[] } {
  const attempt = attemptDocumentPatch(source, subject, documentPath);
  if (attempt.html !== null) return { html: attempt.html, why: attempt.why };
  if (!attempt.records) return { why: ['nothing in this change set belongs to the markup'] };
  return { why: attempt.why.length ? attempt.why : ['no change could be placed in the file'] };
}

/**
 * Why this change set cannot be written into the file, or null when it can.
 *
 * The same question the save plan answers, asked as each change lands so the user hears it while
 * Undo is still the obvious response rather than when the save dialog opens.
 *
 * Null for "nothing to write here" as much as for "this all fits": a change set with nothing in
 * it for the markup has nothing to warn about.
 */
export function rewriteReason(
  source: string,
  subject: WriteSubject,
  documentPath: string,
): string | null {
  const attempt = attemptDocumentPatch(source, subject, documentPath);
  if (!attempt.records) return null;
  if (attempt.html !== null) return attempt.why[0] ?? null;
  return attempt.why[0] ?? 'part of this change cannot be placed in the file';
}

/**
 * One attempt at patching the document, described rather than decided.
 *
 * Shared so that the callers cannot drift: what the download offers, what the live warning
 * claims and what the save writes have to be the same judgement.
 */
function attemptDocumentPatch(
  source: string,
  subject: WriteSubject,
  documentPath: string,
): { html: string | null; records: number; why: string[] } {
  const systemInDocument = subject.designSystemTarget === DOCUMENT_TARGET;
  const blockSeed = subject.blockLibrarySeed?.trim() ?? '';
  const removeLibrary = subject.removeBlockLibrary === true;
  const regions = subject.generatedRegions ?? [];
  const isGenerated = (el: HTMLElement): boolean =>
    regions.some((region) => region === el || region.contains(el));

  // The same selection the write path makes: what the markup can carry, minus what the
  // page's own code owns. Literally the same, via `unreachableInMarkup`, because the two
  // answering this differently is how a warning ends up describing a save that never happens.
  const candidates = subject.records.filter((record) =>
    isDocumentChange(record, systemInDocument, Boolean(blockSeed), removeLibrary),
  );
  const unreachable = candidates.filter((record) => unreachableInMarkup(record, isGenerated));
  const documentRecords = candidates.filter((record) => !unreachable.includes(record));
  if (!documentRecords.length) return { html: null, records: 0, why: [] };

  const why: string[] = [];
  const patched = tryPatchDocument(
    source,
    documentRecords,
    documentPath,
    why,
    subject,
    systemInDocument ? designSystemCSSText(subject.designSystemCSS) : '',
    unreachable,
  );
  if (patched) why.push(...patched.unplaced.map((record) => unplacedReason(record)));
  return { html: patched?.html ?? null, records: documentRecords.length, why };
}

/** Why a change to content the page builds is not in the file. */
function unplacedReason(record: ChangeRecord): string {
  return `“${record.summary}” is inside content the page builds, which the file does not contain`;
}

/**
 * Changes about where an element sits rather than what it says.
 *
 * The file receives them like any other DOM change, from the journal. They are named here
 * because a structural change to an element the page builds has nowhere in the file to go.
 */
const STRUCTURAL = new Set<ChangeRecord['kind']>([
  'insert', 'delete', 'move', 'duplicate', 'wrap', 'replace',
]);

/**
 * Changes to the design system rather than to any element.
 *
 * They reach a file as one block of CSS — `upsertSection` for a stylesheet, `upsertStyleBlock`
 * for the markup — or, for `block`, as one seed script, so they are delivered wholesale rather
 * than placed individually.
 */
const DESIGN_SYSTEM = new Set<ChangeRecord['kind']>([
  'token', 'token-class', 'token-rule', 'block',
]);

/**
 * CSS rule edits that belong to one of the page's own `<style>` blocks, as text transforms.
 *
 * A CSSOM edit changes what renders and leaves the element's text alone, so the journal never
 * sees it. Replayed here against the block's text in the file, the same way a linked stylesheet
 * is patched.
 */
function inlineStyleTransforms(
  records: readonly ChangeRecord[],
  why: string[],
): Map<Element, (css: string) => string> {
  const out = new Map<Element, (css: string) => string>();
  for (const { element, patches } of inlineStyleEdits(records)) {
    if (isEditorOwned(element)) continue;
    out.set(element, (css) => {
      const result = patchCSS(css, patches);
      for (const failure of result.failed) why.push(failure.reason);
      return result.css;
    });
  }
  return out;
}

/**
 * The pending changes the file must not receive: unticked ones, and ones with nowhere to go.
 *
 * Everything else the journal holds is written, whichever record describes it. A command can
 * change an element and a registry at once, and the element half belongs in the markup even when
 * its record is filed under the design system.
 */
function excludedChanges(
  journal: DocumentJournal,
  ticked: readonly ChangeRecord[],
  unreachable: readonly ChangeRecord[],
): Set<string> {
  const present = new Set(ticked.map((record) => record.id));
  const out = new Set<string>();
  for (const record of journal.pending) {
    // Rows about CSS or scripts say nothing about the markup, so unticking one leaves the DOM half
    // of the same command alone.
    if (!touchesMarkup(record)) continue;
    if (!present.has(record.id)) out.add(record.id);
  }
  for (const record of unreachable) out.add(record.id);
  return out;
}

/** Whether a change record describes the page's markup rather than a stylesheet or script file. */
function touchesMarkup(record: ChangeRecord): boolean {
  if (DESIGN_SYSTEM.has(record.kind)) return false;
  const scope = record.detail?.scope;
  if (scope === 'stylesheet rule' || scope === 'stylesheet' || scope === 'external script') return false;
  if (scope === 'rendered source') return false;
  return true;
}

/**
 * Turn the document changes into edits to the file, or return null and say why.
 *
 * The DOM half comes from the journal: exactly the attributes, text and child lists the ticked
 * changes touched, written over their own bytes in the file and verified by reading the result
 * back. CSSOM edits to the page's own `<style>` blocks are replayed into those blocks' text. The
 * editor-managed regions — the design system and the block library — are upserted last.
 */
function tryPatchDocument(
  html: string,
  records: readonly ChangeRecord[],
  documentPath: string,
  why: string[],
  subject: WriteSubject,
  designSystemCSS = '',
  unreachable: readonly ChangeRecord[] = [],
): {
  html: string;
  ops: (readonly DomOp[])[];
  stranded: ChangeRecord[];
  unplaced: ChangeRecord[];
} | null {
  if (!records.length) return null;
  const blockSeed = subject.blockLibrarySeed?.trim() ?? '';
  const removeBlockLibrary = subject.removeBlockLibrary === true;

  /*
   * A change can still declare that it cannot be patched, and that declaration is honoured.
   * Nothing in the editor makes one any more — the journal carries every DOM change — but a
   * record from elsewhere is entitled to say so.
   */
  const forced = records.find((record) => record.detail?.forcesRewrite);
  if (forced?.detail?.forcesRewrite) {
    why.push(forced.detail.forcesRewrite);
    return null;
  }

  const journal = subject.journal;
  if (!journal) {
    why.push('the editor has no journal of how the page changed');
    return null;
  }

  const keepAttributes = blockSeed ? [BLOCK_ATTR] : [];
  const styleEdits = inlineStyleTransforms(records, why);
  const result = patchSourceFromJournal({
    source: html,
    journal: {
      retired: journal.retired,
      applied: journal.applied,
      rolledBack: journal.rolledBack,
      written: journal.written.get(documentPath) ?? null,
    },
    excluded: excludedChanges(journal, subject.records, unreachable),
    markupRows: new Set(journal.pending.filter(touchesMarkup).map((record) => record.id)),
    styleEdits,
    keep: keepAttributes,
  });
  if (!result.ok) {
    why.push(...result.why);
    return null;
  }
  if (why.length) return null;

  /*
   * The design system and the library last, as managed regions.
   *
   * Two regions in `<head>`, each with its own markers, so a save that changes only one leaves the
   * other byte-identical. Removal of the library is the third state and happens last of all,
   * taking the instance links with it.
   */
  const withBlocks = upsertSeedBlock(
    upsertStyleBlock(result.html, designSystemCSS),
    blockSeed,
    removeBlockLibrary,
  );
  return {
    html: removeBlockLibrary ? dropBlockLinks(withBlocks) : withBlocks,
    ops: result.ops,
    stranded: records.filter((record) => result.stranded.has(record.id)),
    unplaced: records.filter((record) => result.unplaced.has(record.id)),
  };
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
function isDocumentChange(
  record: ChangeRecord,
  designSystemInDocument: boolean,
  blockLibraryInDocument: boolean,
  removeBlockLibrary: boolean,
): boolean {
  /*
   * A token, class or ordinary rule edit belongs to the design system, not to the document.
   *
   * Where it lands is the one thing the design-system target decides, and it is delivered
   * by `designSystemCSS` — so counting these as document changes as well wrote the same
   * `--clay: #846b62` into two files at once: the stylesheet that was chosen for it, and the
   * page, via the generated `<style>` block the editor renders it from. The block is how the
   * change shows on screen before it is saved; it is not a second home for it.
   *
   * A block-library paste is the deliberate exception. Its token-rule row describes CSS that is
   * also embedded in the block definition, and that definition reaches the file through the
   * seed even when the design-system target is a separate stylesheet. Without this exception an
   * unused block — one whose CSS has not been injected into the managed sheet yet — is falsely
   * reported as unwritable.
   */
  if (
    record.kind === 'token' ||
    record.kind === 'token-class' ||
    record.kind === 'token-rule'
  ) {
    return designSystemInDocument ||
      (isAuthoredBlockCSSRecord(record) && blockLibraryInDocument);
  }
  /*
   * A block can carry two independent payloads.
   *
   * Its generated CSS follows the design-system target, while its template and props follow the
   * library checkbox. A document write is therefore needed when either the CSS belongs in the
   * document or the seed belongs in the document; the stylesheet route handles the CSS when it
   * has another target.
   */
  if (record.kind === 'block') {
    return designSystemInDocument || blockLibraryInDocument || removeBlockLibrary;
  }
  const target = record.detail?.writeTo;
  return !target || target === DOCUMENT_TARGET;
}

/** A block-scoped rule authored in a library definition, rather than injected from an instance. */
function isAuthoredBlockCSSRecord(record: ChangeRecord): boolean {
  return record.kind === 'token-rule' && record.detail?.source === 'block-css-paste';
}

/**
 * Why the markup cannot carry this change, or null when it can.
 *
 * One function because two places ask it — the write plan, which owes the user a reason, and
 * the early warning, which only needs the verdict — and them answering differently is how a
 * warning comes to describe a save that does not happen.
 *
 * Two grounds. The record may have been stamped at edit time with what is known about the
 * element's content being set by code, which is already a sentence written for the user. Or the
 * element may belong to a region the page built: the container rebuild leaves generated children
 * out, deliberately, because a script's output is not the file's to hold — so rearranging one is
 * expressed by rebuilding the container exactly as the file already has it.
 *
 * That second case is what made this necessary. The patch came out byte-identical, so nothing
 * was written and nothing was reported, and a save with one pending change announced that every
 * change was already in the files. A change that cannot reach a file is something to be told
 * about; the one thing it must not be is quietly dropped.
 *
 * A delete is exempt. Its element has already left the page, so there is nothing there to be
 * generated, and the rebuild omitting it is the intended outcome rather than a refusal.
 */
function unreachableInMarkup(
  record: ChangeRecord,
  isGenerated: (el: HTMLElement) => boolean,
): string | null {
  const rendered = record.detail?.rendered;
  if (rendered) return rendered;
  if (!STRUCTURAL.has(record.kind) || record.kind === 'delete') return null;
  const about = elementOfRecord(record);
  if (!about || !isGenerated(about)) return null;
  return (
    'This element is built by the page’s own code rather than declared in the markup, so ' +
    'there is nowhere in the file to put it. Where it goes is decided by the code that ' +
    'builds it.'
  );
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
    summary: 'New tokens, reusable classes, CSS rules and scoped block CSS',
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
