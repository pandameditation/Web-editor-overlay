/**
 * One run of the agent: stream in, edits land live, one entry on the undo stack.
 *
 * The shape is settled by three requirements that pull against each other. The user watches
 * the element change as the model talks, so edits cannot wait for the reply to finish. They can
 * abort at any moment, so a half-finished run has to be a coherent state. And one undo has to
 * take the whole thing back, so a run that changed six things cannot be six entries.
 *
 * The resolution is the pattern this codebase already uses twice — `endTextEdit` and
 * `#applyDrop` both mutate first and commit afterwards with `alreadyApplied`. Each operation is
 * built as a `Command` using the *same* factories the panels use, applied immediately, and kept.
 * When the run ends, one composite command is committed whose `apply` replays them all in order
 * and whose `revert` unwinds them in reverse.
 *
 * Building real commands rather than mutating directly is what makes this cheap. Every record
 * the save path needs, every anchor, every summary in the change list comes out of the existing
 * factories, so an AI edit is indistinguishable downstream from the same edit made by hand.
 *
 * Two details that are easy to get wrong and expensive to debug:
 *
 * `withoutProvenance` wraps every application. Without it the runtime observer sees the agent's
 * writes, decides the page's own code produced them, and the save plan then refuses to write
 * the element to a file — the exact failure the provenance machinery exists to prevent, arriving
 * from the one direction it was not watching.
 *
 * `markUserOwned` follows a text rewrite, for the same reason `endTextEdit` calls it. The
 * served-HTML comparison would otherwise find markup in the page that is not in the file and
 * conclude the page generates it, which quietly makes the change unsaveable.
 */

import { withoutProvenance, markUserOwned } from '../provenance.js';
import { upsertClassCommand, upsertRuleCommand, type CssRegistries } from '../css-commands.js';
import { nextChangeId, type Command, type History } from '../history.js';
import {
  captureIdentity,
  setClassList,
  setInnerHTML,
  setStyleProperties,
  type IdentityMap,
} from '../mutations.js';
import { labelFor } from '../dom.js';
import { describeRule } from '../sheets.js';
import { splitCssPriority } from '../css-paste.js';
import type { ChangeRecord } from '../types.js';
import type { PlannedOperation } from './broker.js';
import type { AiScopeClass } from './types.js';

/** What the host has to provide for a run to be able to apply anything. */
export interface SessionHost extends CssRegistries {
  history: History;
  /** Called after every applied operation, so panels redraw as the run progresses. */
  changed: () => void;
  /**
   * Ask the user about one operation. Resolves true to go ahead.
   *
   * A function rather than a flag because the answer arrives from a modal, and the run has to
   * wait for it. Awaited one at a time — see `#consent`.
   */
  consent: (plan: PlannedOperation) => Promise<boolean>;
}

/** One line of the run's own account of itself, for the transcript in the menu. */
export interface RunEntry {
  /** `done` for applied, `skipped` when the user declined, `refused` when the broker did. */
  outcome: 'done' | 'skipped' | 'refused';
  text: string;
  /** Present on `done` when the change reaches past the selected element. */
  sideEffect?: string;
  /** Present when sanitising or validation dropped part of it. */
  notes?: string[];
}

/** What a finished run produced, for the UI to show and for a test to assert on. */
export interface RunOutcome {
  /** The model's closing message, or a stand-in when it did not send one. */
  summary: string;
  entries: RunEntry[];
  /** Facts about what was changed beyond the element, derived from what was applied. */
  warnings: string[];
  applied: number;
  refused: number;
  skipped: number;
  /** True when the user stopped it, or when it broke. */
  aborted: boolean;
  /** Why it broke, or null when it did not. */
  failure: string | null;
  /** True when nothing was applied, so nothing was committed either. */
  empty: boolean;
}

/**
 * A run in progress.
 *
 * Holds the element, the commands applied so far, and the transcript. Created per request and
 * discarded when it finishes: nothing about one run is worth carrying into the next, and a
 * long-lived object holding a detached element is how the editor would leak a page.
 */
export class AiRun {
  readonly element: HTMLElement;
  readonly prompt: string;

  #host: SessionHost;
  #commands: Command[] = [];
  #entries: RunEntry[] = [];
  #warnings: string[] = [];
  #summary = '';
  #aborted = false;
  #settled = false;
  /** Why the request stopped, when it stopped by breaking rather than by finishing. */
  #failure: string | null = null;
  /** Text rewritten during this run, so the identity snapshot is taken exactly once. */
  #textIdentity: IdentityMap | undefined;
  #textBefore: string | null = null;

  constructor(element: HTMLElement, prompt: string, host: SessionHost) {
    this.element = element;
    this.prompt = prompt;
    this.#host = host;
  }

  get applied(): number {
    return this.#commands.length;
  }

  get aborted(): boolean {
    return this.#aborted;
  }

  /** Stop accepting operations. What has landed stays; see `finish`. */
  abort(): void {
    this.#aborted = true;
  }

  /**
   * The request broke. Record why, and stop.
   *
   * Whatever already landed still gets committed — it is on screen, so it has to be undoable —
   * but the transcript has to carry the reason or the run reads as a model that did nothing.
   * A failure and a refusal to act are very different things to the person looking at it.
   */
  fail(error: unknown): void {
    this.#aborted = true;
    const message = error instanceof Error ? error.message : String(error);
    this.#failure = message.trim() || 'The request failed.';
    this.#entries.push({ outcome: 'refused', text: this.#failure });
  }

  /**
   * Take one verdict from the broker and, if it may go ahead, apply it.
   *
   * Every path records a transcript line. A run that refused four operations and applied one
   * has to be able to say so — the alternative is a summary claiming success over a page that
   * barely changed, which is the failure mode this whole feature is most likely to have.
   */
  async offer(verdict: { ok: true; plan: PlannedOperation } | { ok: false; reason: string }): Promise<void> {
    if (this.#settled || this.#aborted) return;
    if (!verdict.ok) {
      this.#entries.push({ outcome: 'refused', text: verdict.reason });
      return;
    }
    const { plan } = verdict;

    if (plan.op.op === 'summary') {
      this.#summary = plan.op.text;
      return;
    }

    // Asked before applying, and awaited: the user is answering about this change, so the page
    // must not already show it. A run that applied first and asked second would be asking
    // permission for something it had done.
    if (plan.allowance === 'ask' && !(await this.#host.consent(plan))) {
      this.#entries.push({ outcome: 'skipped', text: plan.describe });
      return;
    }
    // The answer took a modal's worth of time, in which the user may have pressed Stop.
    if (this.#aborted || this.#settled) return;

    const command = this.#build(plan);
    if (!command) {
      this.#entries.push({
        outcome: 'refused',
        text: `${plan.describe} — the editor could not apply that.`,
      });
      return;
    }

    withoutProvenance(() => command.apply());
    this.#commands.push(command);
    this.#entries.push({
      outcome: 'done',
      text: plan.describe,
      sideEffect: plan.sideEffect,
      notes: [...(plan.removed ?? []), ...(plan.rejected ?? [])].length
        ? [...(plan.removed ?? []), ...(plan.rejected ?? [])]
        : undefined,
    });
    if (plan.sideEffect) this.#warnings.push(plan.sideEffect);
    this.#host.changed();
  }

  /**
   * End the run and put one entry on the undo stack.
   *
   * `sealStep` first, so a slider scrub or a keystroke from a moment ago cannot be absorbed
   * into this by the merge window. Neither `mergeKey` nor `subject` is set on the composite:
   * a subject reduces a run of commands to the net difference between their first and last
   * state, which is meaningful for one value changing repeatedly and meaningless for six
   * different things changing at once — and `extraRecords` documents that they must not be
   * combined.
   *
   * Committed with `alreadyApplied`, because the page has been showing these changes since
   * they arrived. `apply` still has to work: redo calls it.
   */
  finish(): RunOutcome {
    if (this.#settled) return this.outcome();
    this.#settled = true;

    if (this.#commands.length) {
      const commands = [...this.#commands];
      const records = commands.flatMap((command) => [
        command.record,
        ...(command.extraRecords ?? []),
      ]);
      this.#host.history.sealStep();
      this.#host.history.commit(
        {
          label: this.#label(),
          record: records[0],
          extraRecords: records.slice(1),
          apply: () => {
            for (const command of commands) command.apply();
          },
          revert: () => {
            // Reverse order, because a later command may have been built against the state a
            // earlier one produced.
            for (const command of [...commands].reverse()) command.revert();
          },
        },
        { alreadyApplied: true },
      );
      this.#host.changed();
    }
    return this.outcome();
  }

  outcome(): RunOutcome {
    const applied = this.#entries.filter((entry) => entry.outcome === 'done').length;
    return {
      summary: this.#summary || this.#standInSummary(applied),
      entries: [...this.#entries],
      warnings: [...this.#warnings],
      applied,
      refused: this.#entries.filter((entry) => entry.outcome === 'refused').length,
      skipped: this.#entries.filter((entry) => entry.outcome === 'skipped').length,
      aborted: this.#aborted,
      failure: this.#failure,
      empty: this.#commands.length === 0,
    };
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Turn one validated operation into a command, through the same factories a panel uses.
   *
   * Nothing here validates. By this point the broker has settled what may happen and to what;
   * repeating any of that would put a second opinion in the codebase about the boundary, and
   * the boundary is the one thing that must have exactly one.
   */
  #build(plan: PlannedOperation): Command | null {
    const el = this.element;
    switch (plan.op.op) {
      case 'setText': {
        /*
         * The identity snapshot is taken once, on the first rewrite of the run.
         *
         * `setInnerHTML` needs the identity the markup had *before* the edit so undo hands
         * element keys back to the same nodes. A run that rewrites the text twice must undo to
         * the state before the first rewrite, not the second, so the first snapshot is the one
         * that survives — and `#textBefore` is what makes the pair consistent.
         */
        if (this.#textBefore === null) {
          this.#textBefore = el.innerHTML;
          this.#textIdentity = captureIdentity(el);
        }
        const command = setInnerHTML(el, this.#textBefore, plan.op.html, {
          before: this.#textIdentity,
        });
        command.label = `Rewrite ${labelFor(el)}`;
        // The element is the user's now, whatever the page does next. Said here for the same
        // reason `endTextEdit` says it: without this the file comparison decides markup it
        // cannot find in the HTML was generated, and the change stops being saveable.
        markUserOwned(el);
        // Merge keys would let two rewrites in one run collapse and lose the middle state, and
        // a subject is wrong on anything folded into a composite.
        delete command.mergeKey;
        delete command.subject;
        return command;
      }
      case 'setStyles':
        return this.#styleCommand(el, plan.op.declarations);
      case 'setParentStyles': {
        const parent = el.parentElement;
        return parent ? this.#styleCommand(parent, plan.op.declarations) : null;
      }
      case 'setClasses': {
        const current = Array.from(el.classList);
        const remove = new Set(plan.op.remove ?? []);
        const next = current.filter((name) => !remove.has(name));
        for (const name of plan.op.add ?? []) if (!next.includes(name)) next.push(name);
        if (next.join(' ') === current.join(' ')) return null;
        const command = setClassList(el, next);
        delete command.mergeKey;
        delete command.subject;
        return command;
      }
      case 'upsertClass':
        return upsertClassCommand(
          this.#host,
          plan.op.name,
          plan.op.declarations,
          el,
          // Defining a class the element does not wear and not putting it on would be a
          // definition nobody asked for. Adding it is what makes the request take effect.
          true,
          { verb: 'Set', source: 'ai' },
        );
      case 'upsertRule':
        return plan.liveRule
          ? this.#liveRuleCommand(plan.liveRule, plan.op.selector, plan.op.declarations)
          : upsertRuleCommand(this.#host, plan.op.selector, plan.op.declarations, {
            verb: 'Set',
            source: 'ai',
          });
      default:
        return null;
    }
  }

  #styleCommand(el: HTMLElement, declarations: Record<string, string>): Command {
    const command = setStyleProperties(
      el,
      declarations,
      `Set ${Object.keys(declarations).length} ${Object.keys(declarations).length === 1 ? 'style' : 'styles'} on ${labelFor(el)}`,
    );
    delete command.mergeKey;
    delete command.subject;
    return command;
  }

  /**
   * Edit a rule that lives in one of the page's own stylesheets.
   *
   * The reason this is worth a separate path: writing to the live `CSSStyleRule` changes the
   * rule the author wrote, so the save patches their stylesheet in place. Adding a registry
   * rule with the same selector would render identically and write a *second* rule that wins
   * by coming later, which is a growing pile of overrides instead of a one-line diff.
   *
   * `describeRule` captures where the rule sits while it is still there, because a CSSOM edit
   * is invisible from outside the CSSOM and the location is the only thing that lets it be
   * replayed against the file's text.
   */
  #liveRuleCommand(
    rule: CSSStyleRule,
    selector: string,
    declarations: Record<string, string>,
  ): Command {
    const pending = Object.entries(declarations).map(([property, raw]) => ({
      property,
      ...splitCssPriority(raw),
    }));
    const before = pending.map(({ property }) => ({
      property,
      value: rule.style.getPropertyValue(property),
      priority: rule.style.getPropertyPriority(property),
    }));
    const at = describeRule(rule);

    const records: ChangeRecord[] = pending.map((entry, index) => ({
      id: nextChangeId(),
      kind: 'style',
      summary: `Set ${entry.property} to ${entry.value || '(removed)'} in the ${selector} rule`,
      target: selector,
      group: `rule:${selector}`,
      before: before[index].value || undefined,
      after: entry.value || undefined,
      detail: {
        property: entry.property,
        value: entry.value,
        selector,
        scope: 'stylesheet rule',
        priority: entry.priority,
        source: 'ai',
        ...(at
          ? {
            file: at.label,
            writeTo: at.writeTo,
            sheet: at.sheetId,
            rulePath: at.path.join('.'),
            ruleContext: JSON.stringify(at.context),
          }
          : {}),
      },
      at: Date.now(),
    }));

    return {
      label: `Set CSS on ${selector}`,
      record: records[0],
      extraRecords: records.slice(1),
      apply: () => {
        for (const entry of pending) {
          if (entry.value) rule.style.setProperty(entry.property, entry.value, entry.priority);
          else rule.style.removeProperty(entry.property);
        }
      },
      revert: () => {
        for (const old of before) {
          if (old.value) rule.style.setProperty(old.property, old.value, old.priority);
          else rule.style.removeProperty(old.property);
        }
      },
    };
  }

  /** The undo label, which is the user's own words back at them, trimmed to fit a tooltip. */
  #label(): string {
    const asked = this.prompt.trim().replace(/\s+/g, ' ');
    if (!asked) return `AI edit of ${labelFor(this.element)}`;
    return asked.length > 48 ? `AI: ${asked.slice(0, 47)}…` : `AI: ${asked}`;
  }

  /**
   * What to say when the model applied changes and never sent a summary.
   *
   * Which happens, and saying nothing would leave the user looking at a changed page with no
   * account of it. Counted rather than described, because the only honest thing available here
   * is the count.
   */
  #standInSummary(applied: number): string {
    if (this.#failure) {
      return applied
        ? `${this.#failure} ${applied} change${applied === 1 ? '' : 's'} had already been made, and can be undone.`
        : this.#failure;
    }
    if (this.#aborted) {
      return applied
        ? `Stopped after ${applied} change${applied === 1 ? '' : 's'}.`
        : 'Stopped before anything changed.';
    }
    if (!applied) return 'Nothing was changed.';
    return `Made ${applied} change${applied === 1 ? '' : 's'}.`;
  }
}

/** The scope classes a finished run actually reached, for a caller that wants to report them. */
export function scopesTouched(outcome: RunOutcome): AiScopeClass[] {
  const out: AiScopeClass[] = [];
  for (const entry of outcome.entries) {
    if (entry.outcome !== 'done' || !entry.sideEffect) continue;
    const scope: AiScopeClass | null = entry.sideEffect.startsWith('.')
      ? 'classes'
      : entry.sideEffect.includes('the parent')
        ? 'parent'
        : 'rules';
    if (!out.includes(scope)) out.push(scope);
  }
  return out;
}
