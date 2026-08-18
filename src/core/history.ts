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
   * Commands sharing a merge key, committed close together, collapse into one
   * undo step. Used for slider scrubs and typing so undo is not per-keystroke.
   */
  mergeKey?: string;
}

const MERGE_WINDOW_MS = 700;

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
   * The applied change set, oldest first.
   *
   * This is exactly what the save prompt is generated from: undoing a change
   * removes it from the set, so the prompt always describes the page as it
   * currently stands rather than replaying a log of abandoned experiments.
   */
  get records(): ChangeRecord[] {
    return this.#past.map((command) => command.record);
  }

  get size(): number {
    return this.#past.length;
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
