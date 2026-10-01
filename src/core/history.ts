import { domRecorder, replayOps, revertOps, type DomOp } from './dom-journal.js';
import { withoutProvenance } from './provenance.js';
import type { ChangeRecord } from './types.js';

/**
 * One reversible edit.
 *
 * Commands hold live node references rather than serialized positions. A node
 * removed from the document is still referenced by the command that removed it,
 * so re-inserting it on undo restores the exact same node — including any state
 * the browser attached to it, such as form values or media playback position.
 */
export interface Command {
  /** Shown in the undo tooltip. */
  label: string;
  /** Semantic description that ends up in the save prompt. */
  record: ChangeRecord;
  /**
   * The rest of what this command changed, for a command that touched more than one element.
   *
   * One command is one undo step, and one undo step is one thing the user did — but "update
   * every instance of this block" is one thing the user did to twenty elements, and the save
   * path needs all twenty. A record carries a single anchor, which is to say a single place in
   * a single file, so no amount of detail on one record can describe twenty of them.
   *
   * Alongside `record` rather than instead of it, so everything keyed off a command's identity
   * keeps working untouched: merging still compares one record, and the save point is still a
   * map from one id to one command.
   *
   * Not to be combined with `subject`. A subject reduces a run of commands to the net
   * difference between their first and last state, which is meaningful for one thing changing
   * repeatedly and meaningless for many things changing at once — so these records are always
   * reported as the one-off events they are.
   */
  extraRecords?: readonly ChangeRecord[];
  apply(): void;
  revert(): void;
  /**
   * Adjacent commands sharing a merge key collapse into one undo step. Used for
   * slider scrubs, steppers and typing, so undo is not per-keystroke.
   */
  mergeKey?: string;
  /**
   * What this command changes, independent of *when*. Commands sharing a subject
   * describe successive states of the same thing, so the reported change set can
   * be reduced to the net difference between the first and the last.
   *
   * Examples: `style:e3:margin-top`, `class:e3`, `node:e9`, `move:e3`.
   */
  subject?: string;
  /**
   * Every page-DOM operation this command performed, captured by `History`.
   *
   * Undo and redo replay this rather than trusting `revert` and `apply` to find the same nodes
   * again, and the save reads it to know exactly what changed. Absent only for a command that
   * arrived already applied without a journal of its own, which is then undone the old way.
   */
  journal?: readonly DomOp[];
  /**
   * True when `apply` and `revert` do nothing but change the page DOM.
   *
   * Such a command is undone and redone from its journal alone. Any other command still runs its
   * own `revert`/`apply` for the state outside the DOM — a registry, a stylesheet rule — and the
   * DOM half of what that does is then corrected to the journal's exact answer.
   */
  domOnly?: boolean;
}

/** One command, as the save sees it. */
export interface JournalEntry {
  ops: readonly DomOp[];
  /**
   * Every row the save dialog shows for this command — its own change, its extra records, or the
   * rollback of it — so unticking can be honoured exactly. Empty when it has no row.
   */
  changeIds: readonly string[];
  /** True once a save has accounted for it, whether or not it went into a file. */
  saved: boolean;
}

/**
 * How long after a commit an adjacent same-subject edit still folds into it.
 *
 * Generous on purpose: clicking a stepper thirty times should be one undo step,
 * while coming back to a property after a pause should not silently rewrite the
 * step you are about to undo.
 */
const MERGE_WINDOW_MS = 2500;

let sequence = 0;

/** Monotonic id for change records. */
export function nextChangeId(): string {
  sequence += 1;
  return `c${sequence.toString(36)}`;
}

export class History {
  #past: Command[] = [];
  #future: Command[] = [];
  #retired: Array<{ ops: readonly DomOp[]; saved: boolean }> = [];
  #validate: ((ops: readonly DomOp[]) => string | null) | null = null;
  #onRefused: ((reason: string) => void) | null = null;
  /** Which shadow roots a command's own element lives in, so they are journaled with it. */
  #rootsOf: ((record: ChangeRecord) => Node[]) | null = null;
  #lastCommitAt = 0;
  #listeners = new Set<() => void>();
  #limit: number;
  /**
   * The stack as it stood the last time the changes were written to disk.
   *
   * Held as commands rather than a depth, because a depth cannot answer the question
   * that matters after a save: *which* commands were persisted. Undo moves commands
   * off the stack and a later edit discards them entirely, so the only way to still
   * describe "you have rolled back something that was saved" is to have kept a
   * reference to it.
   *
   * Null means nothing has been written, which is the state every session starts in.
   */
  #saved: Map<string, Command> | null = null;

  constructor(limit = 200) {
    this.#limit = limit;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  get undoLabel(): string | null {
    return this.#past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.#future.at(-1)?.label ?? null;
  }

  /**
   * The applied change set, oldest first, reduced to net differences.
   *
   * This is what the save prompt is generated from, and what the change counter
   * shows. Two reductions happen here:
   *
   * - Successive edits to the same subject collapse to one entry spanning the
   *   first `before` and the last `after`. Nudging a margin from 0 to 1 to 2 is
   *   one change, `0 → 2`, not two.
   * - Round trips disappear. Setting a value and putting it back, or inserting an
   *   element and deleting it again, leaves nothing to report.
   *
   * Undo history is untouched by this: the granular steps remain on the stack.
   */
  get records(): ChangeRecord[] {
    const saved = this.#saved;
    if (!saved) return netRecords(this.#past);

    /*
     * Measured from the last write, not from the start of the session.
     *
     * Two things can be pending. A command committed since the write, obviously. And
     * a command that *was* written and has since been undone — rolling back a saved
     * change is itself an unsaved change, and the file on disk still holds the value
     * the page no longer shows.
     *
     * Both go through `netRecords` together, and they have to, because they can
     * concern the same thing. Save `padding: 0 → 2`, undo it, then set padding to 7:
     * reported separately that reads as "put 2 back to 0" plus "set 0 to 7", the
     * first of which is not true of anything. Sharing the subject reduces the pair to
     * the one change that is: `2 → 7`.
     */
    const present = new Set(this.#past.map((command) => command.record.id));
    const timeline: Command[] = [];
    for (const command of saved.values()) {
      if (!present.has(command.record.id)) timeline.push(asRolledBack(command));
    }
    for (const command of this.#past) {
      if (!saved.has(command.record.id)) timeline.push(command);
    }
    return netRecords(timeline);
  }

  /**
   * Take the current stack as written, so nothing is pending until it changes again.
   *
   * The stack itself is untouched: everything stays undoable, and undoing past this
   * point puts the rolled-back changes back on the pending count rather than pretending
   * the page and the files still agree.
   */
  markSaved(): void {
    this.#saved = new Map(this.#past.map((command) => [command.record.id, command]));
    // A keystroke after a save starts a new step, so what was written stays one command.
    this.#lastCommitAt = 0;
    this.#emit();
  }

  /** True once anything has been written, so the count means "since that write". */
  get hasSavePoint(): boolean {
    return this.#saved !== null;
  }

  /**
   * Everything currently applied to the page, measured from the start of the session.
   *
   * Distinct from `records`, which is measured from the last write and is what a save
   * hands off. This is for the callers that describe the page rather than the pending
   * work — notably the HTML export, which has to replay every CSSOM edit still in
   * effect into the `<style>` text it serializes, whether or not that edit has already
   * been written to a file. Using the pending set there would export the value the page
   * had before the session the moment a save reset the count.
   *
   * Exclusions do not apply here either, for the same reason: unticking a change leaves
   * it on the page, and this is the page.
   */
  get appliedRecords(): ChangeRecord[] {
    return netRecords(this.#past);
  }

  /** Raw undo-stack depth. */
  get size(): number {
    return this.#past.length;
  }

  /** Number of net changes, i.e. what the user would call "unsaved changes". */
  get netSize(): number {
    return this.records.length;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Run a command and push it on the undo stack.
   *
   * Pass `alreadyApplied` when the DOM has already been changed by direct user
   * interaction — inline text editing and drag reordering both mutate the page
   * as they go, and re-applying would be a visible no-op flicker at best.
   */
  commit(
    command: Command,
    options: { alreadyApplied?: boolean; journal?: readonly DomOp[]; validate?: boolean } = {},
  ): boolean {
    if (!options.alreadyApplied) {
      // Not attributed to the page. Every command in here writes to the document
      // through the same DOM APIs `provenance` watches, and counting the editor's own
      // work as the page's would make an element uneditable the moment it was edited.
      command.journal = domRecorder.capture(
        () => withoutProvenance(() => command.apply()),
        this.#rootsOf?.(command.record) ?? [],
      );
    } else if (options.journal) {
      command.journal = options.journal;
    }
    /*
     * A change that leaves the page in a shape no HTML file can hold is taken back at once.
     *
     * Otherwise the page looks right and can never be saved: the file would be read back
     * restructured, so the save has to refuse, and the user finds out long after the edit.
     */
    if (options.validate !== false && command.journal && this.#validate) {
      const refusal = this.#validate(command.journal);
      if (refusal) {
        try {
          this.#revert(command);
        } catch (error) {
          console.error('[html-editor-overlay] could not take back a refused change', error);
        }
        this.#onRefused?.(refusal);
        this.#emit();
        return false;
      }
    }
    this.#future = [];

    const previous = this.#past.at(-1);
    const now = Date.now();
    const mergeable =
      previous &&
      command.mergeKey &&
      previous.mergeKey === command.mergeKey &&
      now - this.#lastCommitAt < MERGE_WINDOW_MS;

    if (mergeable && previous) {
      // Keep the *old* revert (the true "before" state) and the *new* apply.
      this.#past[this.#past.length - 1] = {
        label: command.label,
        mergeKey: command.mergeKey,
        subject: command.subject,
        apply: command.apply,
        revert: previous.revert,
        journal:
          previous.journal && command.journal
            ? [...previous.journal, ...command.journal]
            : undefined,
        domOnly: Boolean(previous.domOnly && command.domOnly),
        extraRecords: [...(previous.extraRecords ?? []), ...(command.extraRecords ?? [])],
        record: {
          ...command.record,
          id: previous.record.id,
          before: previous.record.before,
        },
      };
    } else {
      this.#past.push(command);
      if (this.#past.length > this.#limit) {
        const retired = this.#past.shift()!;
        /*
         * Still on the page, no longer undoable, and no longer anything the save dialog lists:
         * kept as operations so the save still knows the page, and dropped from the save point so
         * it is not mistaken for a saved change that has since been undone.
         */
        const saved = this.#saved?.delete(retired.record.id) ?? false;
        if (retired.journal) this.#retired.push({ ops: retired.journal, saved });
      }
    }

    this.#lastCommitAt = now;
    this.#emit();
    return true;
  }

  /**
   * Check every change before it is kept, and say why one was refused.
   *
   * The check sees the operations the change made and returns a reason to refuse it, or null.
   */
  validateWith(validate: (ops: readonly DomOp[]) => string | null, onRefused: (reason: string) => void): void {
    this.#validate = validate;
    this.#onRefused = onRefused;
  }

  /**
   * Take a command off the page.
   *
   * From its journal when it has one, which restores the exact nodes it found. A command with
   * state outside the DOM still runs its own `revert` for that state first; whatever that does to
   * the DOM is taken straight back, because the journal is the authority on the DOM.
   */
  #revert(command: Command): void {
    const journal = command.journal;
    withoutProvenance(() => {
      if (!journal) {
        command.revert();
        return;
      }
      if (!command.domOnly) {
        const stray = domRecorder.capture(() => {
          try {
            command.revert();
          } catch (error) {
            console.error('[html-editor-overlay] undo failed', error);
          }
        });
        domRecorder.ignore(() => revertOps(stray));
      }
      domRecorder.ignore(() => revertOps(journal));
    });
  }

  /** Put a reverted command back, by the same rules as `#revert`. */
  #replay(command: Command): void {
    const journal = command.journal;
    withoutProvenance(() => {
      if (!journal) {
        command.apply();
        return;
      }
      if (!command.domOnly) {
        const stray = domRecorder.capture(() => {
          try {
            command.apply();
          } catch (error) {
            console.error('[html-editor-overlay] redo failed', error);
          }
        });
        domRecorder.ignore(() => revertOps(stray));
      }
      domRecorder.ignore(() => replayOps(journal));
    });
  }

  undo(): Command | null {
    const command = this.#past.pop();
    if (!command) return null;
    try {
      this.#revert(command);
    } catch (error) {
      console.error('[html-editor-overlay] undo failed', error);
    }
    this.#future.push(command);
    this.#lastCommitAt = 0;
    this.#emit();
    return command;
  }

  redo(): Command | null {
    const command = this.#future.pop();
    if (!command) return null;
    try {
      this.#replay(command);
    } catch (error) {
      console.error('[html-editor-overlay] redo failed', error);
    }
    this.#past.push(command);
    this.#lastCommitAt = 0;
    this.#emit();
    return command;
  }

  /** Revert every applied command, newest first. */
  reset(): void {
    while (this.#past.length) {
      const command = this.#past.pop()!;
      try {
        this.#revert(command);
      } catch (error) {
        console.error('[html-editor-overlay] reset failed', error);
      }
    }
    for (let i = this.#retired.length - 1; i >= 0; i -= 1) {
      const { ops } = this.#retired[i];
      withoutProvenance(() => domRecorder.ignore(() => revertOps(ops)));
    }
    this.#retired = [];
    this.#future = [];
    this.#lastCommitAt = 0;
    this.#emit();
  }

  /**
   * The page-DOM history the save works from.
   *
   * `retired` is what fell off the bottom of the undo stack: still on the page, no longer
   * undoable. `applied` is the undo stack, oldest first. `rolledBack` is what was saved and has
   * since been undone, which the file still holds. Each entry names the pending rows it is
   * reported under, the same ids `records` hands out, so an unticked row can be left out.
   */
  get journal(): {
    retired: readonly JournalEntry[];
    applied: readonly JournalEntry[];
    rolledBack: readonly JournalEntry[];
  } {
    const rows = this.#rowIds();
    const saved = this.#saved;
    const present = new Set(this.#past.map((command) => command.record.id));
    const rolledBack: JournalEntry[] = [];
    for (const command of saved?.values() ?? []) {
      if (present.has(command.record.id) || !command.journal) continue;
      rolledBack.push({ ops: command.journal, changeIds: rows.get(command) ?? [], saved: true });
    }
    return {
      retired: this.#retired.map(({ ops, saved: done }) => ({ ops, changeIds: [], saved: done })),
      applied: this.#past.map((command) => ({
        ops: command.journal ?? [],
        changeIds: rows.get(command) ?? [],
        saved: saved?.has(command.record.id) ?? false,
      })),
      rolledBack,
    };
  }

  /**
   * Tell history how to find the shadow roots a change's element lives in.
   *
   * Only those are journaled with the command. Observing every shadow root on the page would
   * also record a component's own re-render in reaction to an attribute the editor set on its
   * host, and replaying that on redo would put the old rendering back beside the new one.
   */
  observeRootsWith(resolver: (record: ChangeRecord) => Node[]): void {
    this.#rootsOf = resolver;
  }

  /** True when every applied command carries a journal, so the save can rely on it. */
  get fullyJournaled(): boolean {
    return this.#past.every((command) => command.journal !== undefined);
  }

  /**
   * Which pending rows each command is reported under, worked out exactly as `records` does.
   *
   * A rolled-back command appears under its rollback's id, a subject under the first id of its
   * run, and every extra record under its own id — or its group's, for staged block CSS.
   */
  #rowIds(): Map<Command, string[]> {
    const saved = this.#saved;
    const timeline: Array<{ original: Command; reported: Command }> = [];
    if (saved) {
      const present = new Set(this.#past.map((command) => command.record.id));
      for (const command of saved.values()) {
        if (!present.has(command.record.id)) timeline.push({ original: command, reported: asRolledBack(command) });
      }
      for (const command of this.#past) {
        if (!saved.has(command.record.id)) timeline.push({ original: command, reported: command });
      }
    } else {
      for (const command of this.#past) timeline.push({ original: command, reported: command });
    }
    const first = new Map<string, string>();
    const out = new Map<Command, string[]>();
    for (const { original, reported } of timeline) {
      const ids: string[] = [];
      if (reported.subject) {
        if (!first.has(reported.subject)) first.set(reported.subject, reported.record.id);
        ids.push(first.get(reported.subject)!);
      } else {
        ids.push(reported.record.id);
      }
      for (const extra of reported.extraRecords ?? []) {
        if (extra.detail?.source === 'block-css-paste' && extra.group) {
          const key = `extra:${extra.group}`;
          if (!first.has(key)) first.set(key, extra.id);
          ids.push(first.get(key)!);
        } else {
          ids.push(extra.id);
        }
      }
      out.set(original, ids);
    }
    return out;
  }

  /**
   * Forget history without touching the DOM.
   *
   * Not what a save should do — that is `markSaved`, which leaves the stack intact so
   * the work stays undoable. This is for tearing a session down.
   */
  clear(): void {
    this.#past = [];
    this.#future = [];
    this.#retired = [];
    this.#saved = null;
    this.#lastCommitAt = 0;
    this.#emit();
  }

  /**
   * End the current merge run, so the next commit starts a new undo step.
   *
   * Merging is decided by the clock, which is right for the thing it exists for — thirty clicks on
   * a stepper are one step, and the window is generous so a pause does not silently rewrite the
   * step you were about to undo. But the clock is the *only* way a run currently ends without also
   * throwing the stack away: `undo`, `redo`, `reset` and `clear` all reset the timer, and each of
   * them does something else as well.
   *
   * So this is the missing half of that mechanism, and it is a standard one — the same operation
   * CodeMirror and ProseMirror both expose as `closeHistory`. A caller that knows an edit is
   * finished can say so instead of waiting to be believed.
   *
   * It is also what lets a test assert the boundary without sleeping through the window. Seven
   * sleeps of two and a half seconds were eighteen seconds of one fixture, spent waiting for a
   * timer to expire so that the next commit would count separately — which is this call.
   */
  sealStep(): void {
    this.#lastCommitAt = 0;
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[html-editor-overlay] history listener failed', error);
      }
    }
  }
}

/**
 * Reduce a command stack to the net change set.
 *
 * Commands are grouped by `subject` while preserving the order each subject was
 * first touched, so the reported list still reads chronologically. Within a
 * group, only the first `before` and the last `after` matter; if they agree the
 * group is dropped entirely, which is what makes an insert-then-delete or a
 * value-and-back-again vanish from the count.
 *
 * Commands without a subject are passed through untouched — they describe
 * one-off events with no natural "same thing changed again" successor.
 */
function netRecords(commands: readonly Command[]): ChangeRecord[] {
  const groups = new Map<string, ChangeRecord[]>();
  const sequence: Array<{ subject: string | null; record: ChangeRecord }> = [];
  const addGrouped = (key: string, record: ChangeRecord): void => {
    const existing = groups.get(key);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
      // Placeholder marking where this subject belongs in the timeline.
      sequence.push({ subject: key, record });
    }
  };

  for (const command of commands) {
    if (command.subject) addGrouped(command.subject, command.record);
    else sequence.push({ subject: null, record: command.record });
    /*
     * Only block-library CSS staging has a group that means successive states of one design-system
     * value. Other fan-outs may carry an element group for anchoring, but their records describe
     * distinct effects and must remain one-off entries — notably a multi-attribute batch.
     */
    for (const extra of command.extraRecords ?? []) {
      if (extra.detail?.source === 'block-css-paste' && extra.group) {
        addGrouped(`extra:${extra.group}`, extra);
      } else {
        sequence.push({ subject: null, record: extra });
      }
    }
  }

  const out: ChangeRecord[] = [];
  for (const entry of sequence) {
    if (entry.subject === null) {
      out.push(entry.record);
      continue;
    }
    const group = groups.get(entry.subject)!;
    const first = group[0];
    const last = group[group.length - 1];
    /*
     * Compared on markup where there is markup to compare.
     *
     * A group whose first state matches its last has cancelled itself out and is not a pending
     * change. For a text edit the state is the markup: judged on the stripped text instead,
     * wrapping a word in a link looked like a no-op and the link was dropped from the change
     * set. Both ends have to carry markup for it to be the fair comparison, which is the case
     * exactly when the group is text edits — they are grouped by element and kind.
     */
    const markup = first.markupBefore != null && last.markupAfter != null;
    const from = markup ? first.markupBefore : first.before;
    const to = markup ? last.markupAfter : last.after;
    if (normalize(from) === normalize(to)) continue;
    /*
     * Every container the whole run touched, not just the last command's.
     *
     * Walking an element into a neighbouring container with three keystrokes is one net
     * change, and `...last` keeps only the last keystroke's view of it — which is the
     * container the element ended up in. The container it started in is named by the first
     * command and nothing else, so the save had no reason to take the element out of it and
     * the file came out holding it twice. Duplicates are harmless: the write plan keys
     * containers by anchor before it resolves them.
     */
    const containers = group.flatMap((record) => record.containers ?? []);
    out.push({
      ...last,
      before: first.before,
      after: last.after,
      ...(containers.length ? { containers } : {}),
      // Keep the group's identity stable so consumers can diff between reads.
      id: first.id,
    });
  }
  return out;
}

/** Absent and empty are the same thing when deciding whether anything changed. */
function normalize(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * A saved command, described as the rollback it has become.
 *
 * Only ever reported, never run: whatever this describes has already happened, because
 * the undo that took the command off the stack is what created the need to describe it.
 * `apply` and `revert` exist to satisfy the shape and would be a bug to call.
 *
 * The `subject` is carried over deliberately. It is what lets a rollback and a
 * subsequent edit to the same thing collapse into one net change.
 */
function asRolledBack(command: Command): Command {
  return {
    label: `Roll back ${command.label}`,
    subject: command.subject,
    apply: () => { },
    revert: () => { },
    record: invertRecord(command.record),
    // Turned around too. Undoing a saved fan-out rolls back every element it touched, and
    // the file still holds the version each of them no longer shows.
    extraRecords: command.extraRecords?.map(invertRecord),
  };
}

/**
 * A change record, turned around.
 *
 * `before` and `after` swap, and so does anything in `detail` that carries a payload
 * rather than a description — a whole stylesheet, a whole script, one declaration's
 * value. Those are what a consumer would write or hand to an agent, so leaving them
 * pointing at the new state while the sentence says "roll back" would produce
 * instructions that do the opposite of what they claim.
 */
function invertRecord(record: ChangeRecord): ChangeRecord {
  const detail = record.detail ? { ...record.detail } : undefined;
  if (detail) {
    const previous = record.before ?? '';
    if (detail.scope === 'stylesheet rule') detail.value = previous;
    if (detail.css !== undefined) detail.css = previous;
    if (detail.script !== undefined) detail.script = previous;
  }
  return {
    ...record,
    // Derived from the original rather than freshly minted, so the id is stable across
    // re-reads and the save dialog's checkboxes keep pointing at the same row.
    id: `${record.id}~`,
    summary: `Roll back: ${record.summary}`,
    before: record.after,
    after: record.before,
    detail,
  };
}
