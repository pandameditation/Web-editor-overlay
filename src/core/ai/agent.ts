/**
 * The editor's AI capability, as one object the engine owns.
 *
 * Its own class rather than a dozen methods on `EditorEngine` for the reason the block
 * library is its own class: this holds state with a lifecycle of its own — configured
 * providers, which one is active, a run in flight — and the engine is already long enough
 * that a subsystem hiding inside it stops being findable.
 *
 * What lives here is the *decision* layer: which provider set is active, what that set is
 * permitted to change, and whether one operation may go ahead. Applying an operation is the
 * engine's job, because applying is what the engine's commands and history are for.
 *
 * There is deliberately no capability at all until the user configures one. An editor that
 * shipped with a model attached would be an editor that sent somebody's page somewhere by
 * default, and that is not a decision to make on their behalf.
 */

import { selectableParent } from '../dom.js';
import { reviewOperation, type BrokerTarget, type BrokerVerdict } from './broker.js';
import {
  isLoopbackOrigin,
  keyVault,
  persistenceRefusal,
  type KeyPersistence,
  type KeyStatus,
} from './keys.js';
import { AiRun, type RunOutcome, type SessionHost } from './session.js';
import {
  AI_SCOPE_CLASSES,
  type AiAllowance,
  type AiProviderSet,
  type AiScopeClass,
  type AiScopePolicy,
} from './types.js';

/** What every new provider set starts with, and what the settings UI shows as the default. */
export const DEFAULT_AI_SCOPE: AiScopePolicy = {
  classes: 'always',
  rules: 'always',
  parent: 'always',
};

export class AiAgent {
  #sets: AiProviderSet[] = [];
  #activeId: string | null = null;
  #listeners = new Set<() => void>();

  /**
   * Permissions widened for this session only.
   *
   * "Always allow class changes" from an approval dialog lands here rather than on the set,
   * and that is the difference between answering a question and rewriting a setting. The set
   * is written into the design-system seed and travels; a decision made in the middle of one
   * run should not follow the seed onto somebody else's machine. The settings UI is where a
   * lasting change belongs, and it says as much.
   */
  #widened = new Map<string, Set<AiScopeClass>>();

  /* ---------------------------------------------------------------------- */
  /* Provider sets                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * The configured sets, in priority order. The first is the default.
   *
   * Order is the user's, not sorted: they said which one they wanted first by dragging it
   * there, and re-sorting by name or by recency would silently overrule that.
   */
  list(): AiProviderSet[] {
    return [...this.#sets];
  }

  get size(): number {
    return this.#sets.length;
  }

  get(id: string): AiProviderSet | undefined {
    return this.#sets.find((entry) => entry.id === id);
  }

  /**
   * The set a run would use.
   *
   * The explicitly chosen one, or the first, or none. Falling back to the first is what makes
   * "order them by priority" mean something without the user also having to pick one.
   */
  get active(): AiProviderSet | null {
    if (this.#activeId) {
      const chosen = this.get(this.#activeId);
      if (chosen) return chosen;
    }
    return this.#sets[0] ?? null;
  }

  /** True once there is somewhere to send a request. */
  get configured(): boolean {
    return this.#sets.length > 0;
  }

  activate(id: string): void {
    if (!this.get(id)) return;
    this.#activeId = id;
    this.#emit();
  }

  upsert(entry: AiProviderSet): AiProviderSet {
    const next: AiProviderSet = {
      ...entry,
      label: entry.label.trim() || 'Untitled provider',
      scope: { ...entry.scope },
    };
    const at = this.#sets.findIndex((one) => one.id === next.id);
    if (at === -1) this.#sets.push(next);
    else this.#sets[at] = next;
    this.#emit();
    return next;
  }

  remove(id: string): void {
    const before = this.#sets.length;
    this.#sets = this.#sets.filter((entry) => entry.id !== id);
    if (this.#sets.length === before) return;
    if (this.#activeId === id) this.#activeId = null;
    this.#widened.delete(id);
    this.#emit();
  }

  /** Move a set to a new index, which is how priority is expressed. */
  reorder(id: string, to: number): void {
    const from = this.#sets.findIndex((entry) => entry.id === id);
    if (from === -1) return;
    const bounded = Math.max(0, Math.min(to, this.#sets.length - 1));
    if (bounded === from) return;
    const [moved] = this.#sets.splice(from, 1);
    this.#sets.splice(bounded, 0, moved);
    this.#emit();
  }

  /**
   * Replace every set at once, for a seed or a design-system import.
   *
   * Sets arriving this way carry no credential — the seed never held one — so an imported
   * `in-page` set is configured but unusable until a key is supplied, and the settings UI
   * says `Needs a key` rather than failing at the moment of use.
   */
  import(sets: readonly AiProviderSet[]): number {
    this.#sets = sets.map((entry) => ({ ...entry, scope: { ...entry.scope } }));
    this.#activeId = null;
    this.#widened.clear();
    this.#emit();
    return this.#sets.length;
  }

  /** Every set, for the design-system document. Secrets are not here to be excluded. */
  export(): AiProviderSet[] {
    return this.list();
  }

  /* ---------------------------------------------------------------------- */
  /* Permission                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * What the active set may change right now, session widening included.
   *
   * The one function that answers the permission question, so that the broker, the context
   * bundle and the settings UI cannot disagree about it. No set means an empty policy, which
   * denies everything — the safe direction for the case where there is nothing to ask.
   */
  policy(set: AiProviderSet | null = this.active): AiScopePolicy {
    if (!set) return {};
    const widened = this.#widened.get(set.id);
    const out: AiScopePolicy = {};
    for (const scope of AI_SCOPE_CLASSES) {
      const configured = set.scope[scope];
      if (!configured) continue;
      out[scope] = widened?.has(scope) ? 'always' : configured;
    }
    return out;
  }

  /** Whether this kind of change still needs a question. */
  allowance(scope: AiScopeClass, set: AiProviderSet | null = this.active): AiAllowance | null {
    return this.policy(set)[scope] ?? null;
  }

  /** Stop asking about this kind of change for the rest of the session. */
  widen(scope: AiScopeClass, set: AiProviderSet | null = this.active): void {
    if (!set) return;
    const current = this.#widened.get(set.id) ?? new Set<AiScopeClass>();
    current.add(scope);
    this.#widened.set(set.id, current);
    this.#emit();
  }

  /** True when a scope has been widened for this session but not in the set itself. */
  widenedThisSession(scope: AiScopeClass, set: AiProviderSet | null = this.active): boolean {
    return Boolean(set && this.#widened.get(set.id)?.has(scope));
  }

  /* ---------------------------------------------------------------------- */
  /* Credentials, at arm's length                                           */
  /* ---------------------------------------------------------------------- */

  /*
   * The vault is proxied rather than exposed, and every method here is deliberately one that
   * cannot hand a key back.
   *
   * `engine.ai` is reachable from the page, from a fixture and from any script sharing the realm.
   * Putting the vault on it would put a reader for the secret on it — and a `getKey` would be one
   * careless log line away from the thing this whole subsystem is built to avoid. So: write it,
   * ask whether it is there, ask what it ends with, forget it. Never read it.
   */

  /** Store a key for a set. Returns where it actually ended up. */
  setKey(
    id: string,
    key: string,
    persistence: KeyPersistence = 'session',
    passphrase?: string,
  ): Promise<{ persistence: KeyPersistence; refused?: string }> {
    return keyVault.set(id, key, persistence, passphrase);
  }

  /** Whether a key is held, where, and its last four characters. Never the key. */
  keyStatus(id: string): KeyStatus {
    return keyVault.status(id);
  }

  /** Unlock a passphrase-wrapped key. False when the passphrase is wrong. */
  unlockKey(id: string, passphrase: string): Promise<boolean> {
    return keyVault.unlock(id, passphrase);
  }

  /** Forget a key everywhere, keeping the provider it belonged to. */
  clearKey(id: string): void {
    keyVault.clear(id);
  }

  /** True when a request for this set could be made right now. */
  ready(set: AiProviderSet | null | undefined = this.active): boolean {
    return set ? keyVault.ready(set) : false;
  }

  /** True when this origin may keep a key beyond the tab. See `isLoopbackOrigin`. */
  loopbackOrigin(): boolean {
    return isLoopbackOrigin();
  }

  /** Why a key cannot be kept beyond the tab here, or null when it can. */
  persistenceRefusal(): string | null {
    return persistenceRefusal();
  }

  /* ---------------------------------------------------------------------- */
  /* The boundary                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Whether one operation may go ahead, and what it would mean.
   *
   * The single door. Everything a model produces comes through this, including in tests —
   * which is the point of having it on the agent rather than inline in the run loop: the
   * boundary can be driven directly and proven to hold without a provider, a network, or a
   * single mutation to undo afterwards.
   */
  review(raw: unknown, element: HTMLElement, set: AiProviderSet | null = this.active): BrokerVerdict {
    const target: BrokerTarget = { element, parent: selectableParent(element) };
    return reviewOperation(raw, target, this.policy(set));
  }

  /* ---------------------------------------------------------------------- */
  /* Running                                                                */
  /* ---------------------------------------------------------------------- */

  #run: AiRun | null = null;

  /** The run in flight, for the UI to show progress and offer Stop. */
  get running(): AiRun | null {
    return this.#run;
  }

  /** Stop the run in flight. What has already landed stays, as one undo entry. */
  abort(): void {
    this.#run?.abort();
  }

  /**
   * Drive one exchange from a stream of operations the model has already emitted.
   *
   * Takes parsed operations rather than a transport, and that separation is deliberate: it is
   * what lets a fixture script an exact sequence — including malformed and hostile ones — with
   * no network, no provider and no timing. The transport's job is to turn bytes into this
   * stream; everything downstream of it is here and testable.
   *
   * `finally` rather than a tidy path, because the run must be committed whatever happened. A
   * transport that throws mid-stream, a model that stops talking, an abort: all of them leave
   * changes already showing on the page, and changes on the page with nothing on the undo stack
   * is the one outcome that would be unrecoverable.
   */
  async run(options: {
    element: HTMLElement;
    prompt: string;
    operations: AsyncIterable<unknown>;
    host: SessionHost;
    set?: AiProviderSet | null;
  }): Promise<RunOutcome> {
    const set = options.set ?? this.active;
    const run = new AiRun(options.element, options.prompt, options.host);
    this.#run = run;
    this.#emit();
    try {
      for await (const raw of options.operations) {
        if (run.aborted) break;
        await run.offer(this.review(raw, options.element, set));
      }
    } catch (error) {
      /*
       * Recorded, not swallowed.
       *
       * The first version of this returned the outcome from a `finally`, which does commit the
       * run — the important half — but discards the exception with it. A request that failed
       * halfway then reported "nothing was changed" with no reason, which is indistinguishable
       * from a model that declined to do anything and sends the user looking in the wrong place.
       */
      run.fail(error);
    }
    const outcome = run.finish();
    this.#run = null;
    this.#emit();
    return outcome;
  }

  /* ---------------------------------------------------------------------- */

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  destroy(): void {
    this.#listeners.clear();
    this.#sets = [];
    this.#widened.clear();
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[html-editor-overlay] AI listener failed', error);
      }
    }
  }
}
