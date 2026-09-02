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
  commit(command: Command, options: { alreadyApplied?: boolean } = {}): void {
    if (!options.alreadyApplied) {
      // Not attributed to the page. Every command in here writes to the document
      // through the same DOM APIs `provenance` watches, and counting the editor's own
      // work as the page's would make an element uneditable the moment it was edited.
      withoutProvenance(() => command.apply());
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
        record: {
          ...command.record,
          id: previous.record.id,
          before: previous.record.before,
        },
      };
    } else {
      this.#past.push(command);
      if (this.#past.length > this.#limit) this.#past.shift();
    }

    this.#lastCommitAt = now;
    this.#emit();
  }

  undo(): Command | null {
    const command = this.#past.pop();
    if (!command) return null;
    try {
      withoutProvenance(() => command.revert());
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
      withoutProvenance(() => command.apply());
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
        withoutProvenance(() => command.revert());
      } catch (error) {
        console.error('[html-editor-overlay] reset failed', error);
      }
    }
    this.#future = [];
    this.#lastCommitAt = 0;
    this.#emit();
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
    this.#saved = null;
    this.#lastCommitAt = 0;
    this.#emit();
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

  for (const command of commands) {
    const subject = command.subject;
    if (!subject) {
      sequence.push({ subject: null, record: command.record });
    } else {
      const existing = groups.get(subject);
      if (existing) {
        existing.push(command.record);
      } else {
        groups.set(subject, [command.record]);
        // Placeholder marking where this subject belongs in the timeline.
        sequence.push({ subject, record: command.record });
      }
    }
    /*
     * A fan-out's other elements, each reported in its own right.
     *
     * Never folded into a subject group. They are twenty different elements, not twenty
     * states of one, and reducing them to a first `before` and a last `after` would report
     * one change and silently drop nineteen — which is exactly the shape of a save that
     * claims to have written everything and did not.
     */
    for (const extra of command.extraRecords ?? []) {
      sequence.push({ subject: null, record: extra });
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
    out.push({
      ...last,
      before: first.before,
      after: last.after,
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
