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
      command.apply();
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
      command.revert();
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
      command.apply();
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
        command.revert();
      } catch (error) {
        console.error('[html-editor-overlay] reset failed', error);
      }
    }
    this.#future = [];
    this.#lastCommitAt = 0;
    this.#emit();
  }

  /** Forget history without touching the DOM. Used after a successful save. */
  clear(): void {
    this.#past = [];
    this.#future = [];
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
      continue;
    }
    const existing = groups.get(subject);
    if (existing) {
      existing.push(command.record);
    } else {
      groups.set(subject, [command.record]);
      // Placeholder marking where this subject belongs in the timeline.
      sequence.push({ subject, record: command.record });
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
    if (normalize(first.before) === normalize(last.after)) continue;
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
