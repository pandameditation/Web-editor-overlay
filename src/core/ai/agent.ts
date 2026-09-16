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
  safeStorage,
  type KeyPersistence,
  type KeyStatus,
} from './keys.js';
import { AiRun, type RunOutcome, type SessionHost } from './session.js';
import {
  portableProviderSet,
  type AiContextScope,
  type AiProviderSet,
} from './types.js';

/**
 * Where the provider list is kept between reloads.
 *
 * `sessionStorage`, matching the default for a key: a provider the user typed in should still be
 * there after a reload of the dev server, and gone when the tab is. Reloading and finding an
 * empty list is the bug this fixes; a list that outlives the browser session is a different
 * decision, and the design system is the place to make it — `exportDesignSystem` already carries
 * providers, and that artefact is explicitly one the user chose to keep.
 */
const SETS_KEY = 'heo.ai.sets';

/**
 * Where the request scope is kept between reloads.
 *
 * A sibling of the provider list rather than part of it, because it belongs to neither a provider
 * nor a page: it is how *this person* wants requests scoped, and switching provider or reloading
 * the dev server should not silently widen or narrow it. `sessionStorage` for the same reason the
 * providers use it — it should outlive a reload and die with the tab.
 */
const SCOPE_KEY = 'heo.ai.scope';

/**
 * Ids the environment owns.
 *
 * A `heo-env-` set exists because the dev server found a key in `.env` this boot, and it is
 * re-offered on the next one from the same place. So the set itself is not written to storage:
 * that would mean a provider surviving the removal of its own key, showing a model that cannot
 * answer, removable only by finding the storage entry.
 *
 * What *is* written is any field the user changed on one — see `#overrides`. Not doing that was a
 * bug worth stating: someone switched a discovered provider to an in-page key, typed a model name,
 * reloaded, and got the pristine dev-server version back, because the rule that protected against
 * resurrection was also discarding every edit.
 */
const ENVIRONMENT_PREFIXES = ['heo-env-', 'heo-config-'];

function fromEnvironment(id: string): boolean {
  return ENVIRONMENT_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** The fields a user can change on a provider, so an override carries only those. */
const EDITABLE_FIELDS = ['label', 'transport', 'provider', 'baseURL', 'model', 'systemPrompt'] as const;

type ProviderOverride = Partial<Pick<AiProviderSet, (typeof EDITABLE_FIELDS)[number]>>;

export class AiAgent {
  #sets: AiProviderSet[] = [];
  #activeId: string | null = null;
  #listeners = new Set<() => void>();

  /**
   * What the environment last offered, per id, so an edit can be told from a default.
   *
   * Kept in memory only. It is the baseline `#persist` diffs against: without it the choice is
   * between storing the whole discovered set — which resurrects providers whose key is gone — and
   * storing nothing, which was the bug.
   */
  #offered = new Map<string, AiProviderSet>();

  /**
   * Edits to environment-supplied providers, waiting for the environment to offer them again.
   *
   * Held rather than applied because `restore()` runs before `offer()`: the set an override belongs
   * to does not exist yet at the moment the override is read. An override for a provider that is
   * never offered again simply never applies, which is what keeps a removed key from coming back.
   */
  #overrides = new Map<string, ProviderOverride>();

  /** An active id read from storage whose set had not arrived yet. Resolved by `offer`. */
  #pendingActiveId: string | null = null;

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
    this.#persist();
    this.#emit();
  }

  upsert(entry: AiProviderSet): AiProviderSet {
    const next: AiProviderSet = {
      ...entry,
      label: entry.label.trim() || 'Untitled provider',
    };
    const at = this.#sets.findIndex((one) => one.id === next.id);
    if (at === -1) this.#sets.push(next);
    else this.#sets[at] = next;
    this.#persist();
    this.#emit();
    return next;
  }

  remove(id: string): void {
    const before = this.#sets.length;
    this.#sets = this.#sets.filter((entry) => entry.id !== id);
    if (this.#sets.length === before) return;
    if (this.#activeId === id) this.#activeId = null;
    this.#persist();
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
    this.#persist();
    this.#emit();
  }

  /**
   * Replace every set at once, for a seed or a design-system import.
   *
   * Replacing rather than merging is right for this caller and only this one: a design system's
   * provider list *is* the list, and its order is its priority — merging would decide the default
   * provider by import order. `offer` is the merging form, for the environment.
   *
   * Sets arriving this way carry no credential — the seed never held one — so an imported
   * `in-page` set is configured but unusable until a key is supplied, and the settings UI
   * says `Needs a key` rather than failing at the moment of use.
   */
  import(sets: readonly AiProviderSet[]): number {
    this.#sets = sets.map((entry) => ({ ...entry }));
    this.#activeId = null;
    this.#persist();
    this.#emit();
    return this.#sets.length;
  }

  /**
   * Add sets the environment supplied, keeping whatever is already configured.
   *
   * This is the difference between "here is a design system" and "here is what this machine has
   * a key for", and conflating them cost the user's own providers. `options.aiProviders` used to
   * call `import`, so a dev server offering one discovered provider wiped every set restored from
   * storage or from the page's own seed — and because the seed's async path resolves *after*
   * mount, the two could also wipe each other depending on which finished first.
   *
   * Offered sets go first, because they are the ones that work without being asked for anything:
   * a proxied provider needs no key, so it is the better default than a local endpoint that may
   * not be running.
   */
  offer(sets: readonly AiProviderSet[]): number {
    /*
     * Offered as the environment describes them, then the user's own edits put back on top.
     *
     * Both halves matter. Taking the environment's version means a model name changed in `.env`
     * shows through, and a provider whose key was removed does not appear at all. Reapplying the
     * override means the transport somebody switched to, and the model they typed, survive the
     * reload that follows.
     */
    const offered = sets.map((entry) => {
      this.#offered.set(entry.id, { ...entry });
      const override = this.#overrides.get(entry.id);
      return override ? { ...entry, ...override } : { ...entry };
    });
    const ids = new Set(offered.map((entry) => entry.id));
    this.#sets = [...offered, ...this.#sets.filter((entry) => !ids.has(entry.id))];
    // An id restored from storage may only now have something to point at.
    if (this.#pendingActiveId && ids.has(this.#pendingActiveId)) {
      this.#activeId = this.#pendingActiveId;
      this.#pendingActiveId = null;
    }
    this.#persist();
    this.#emit();
    return offered.length;
  }

  /** Every set, for the design-system document. Secrets are not here to be excluded. */
  export(): AiProviderSet[] {
    return this.list();
  }

  /* ---------------------------------------------------------------------- */
  /* Surviving a reload                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Read back the providers this tab configured by hand.
   *
   * Through `portableProviderSet`, the same allow-list the seed uses. Storage is not a trusted
   * input — another script on the origin can write to it — so a blob claiming to carry an
   * `apiKey`, or a `transport` this version does not know, is rebuilt into something safe rather
   * than believed. A set too broken to rebuild is dropped.
   */
  restore(): number {
    const raw = safeStorage('session')?.getItem(SETS_KEY);
    if (!raw) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 0;
    }
    const payload = parsed as { sets?: unknown; activeId?: unknown; overrides?: unknown };
    const list = Array.isArray(payload?.sets) ? payload.sets : [];
    const restored = list
      .map((entry) => portableProviderSet(entry))
      .filter((entry): entry is AiProviderSet => Boolean(entry))
      // Belt and braces: the writer already excludes these, so one here means storage was edited.
      .filter((entry) => !fromEnvironment(entry.id));

    /*
     * Edits to discovered providers, held until the environment offers them again.
     *
     * Read here and applied in `offer` because that is the order these run in at mount. Rebuilt
     * field by field through `portableProviderSet`, the same gate the sets go through, so a blob
     * that arrived carrying an `apiKey` or an unknown transport cannot smuggle one in through the
     * override path.
     */
    this.#overrides = new Map();
    const overrides = payload.overrides;
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      for (const [id, value] of Object.entries(overrides as Record<string, unknown>)) {
        if (!fromEnvironment(id) || !value || typeof value !== 'object') continue;
        // Given an id and a model so the shared rebuilder accepts it; both are then discarded.
        const safe = portableProviderSet({ ...(value as object), id, model: 'x' });
        if (!safe) continue;
        const kept: ProviderOverride = {};
        for (const field of EDITABLE_FIELDS) {
          if (field in (value as object) && safe[field] !== undefined) {
            kept[field] = safe[field] as never;
          }
        }
        // `model` is the one field the rebuilder insists on, so take it from the raw entry.
        const model = (value as { model?: unknown }).model;
        if (typeof model === 'string') kept.model = model.trim();
        if (Object.keys(kept).length) this.#overrides.set(id, kept);
      }
    }

    const known = new Set(this.#sets.map((entry) => entry.id));
    this.#sets = [...this.#sets, ...restored.filter((entry) => !known.has(entry.id))];
    if (typeof payload.activeId === 'string') {
      // Applied now when the set is already here, held for `offer` when it is a discovered one.
      if (this.get(payload.activeId)) this.#activeId = payload.activeId;
      else this.#pendingActiveId = payload.activeId;
    }
    this.#emit();
    return restored.length;
  }

  /**
   * The request scope this tab last used, or null when it has never set one.
   *
   * Null rather than the default, so the caller can tell "never chosen" from "deliberately
   * minimal" — they happen to look the same today and would stop doing so the moment the default
   * changed.
   */
  restoreScope(): AiContextScope | null {
    const raw = safeStorage('session')?.getItem(SCOPE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<Record<keyof AiContextScope, unknown>>;
      if (!parsed || typeof parsed !== 'object') return null;
      // Rebuilt field by field: storage is writable by anything else on this origin, and a scope
      // arriving with a truthy string in it would widen what a request may change.
      return {
        classes: parsed.classes === true,
        rules: parsed.rules === true,
        parent: parsed.parent === true,
      };
    } catch {
      return null;
    }
  }

  /** Remember the request scope for this tab. */
  rememberScope(scope: AiContextScope): void {
    const store = safeStorage('session');
    if (!store) return;
    try {
      store.setItem(SCOPE_KEY, JSON.stringify({
        classes: scope.classes === true,
        rules: scope.rules === true,
        parent: scope.parent === true,
      }));
    } catch {
      // A full or blocked store costs the convenience, not the session.
    }
  }

  /**
   * Write the hand-made providers back, on every change to the list.
   *
   * Called from the mutators rather than from `#emit`, because `#emit` also fires when a run
   * starts and stops and rewriting storage on each streamed operation would be absurd.
   */
  #persist(): void {
    const store = safeStorage('session');
    if (!store) return;
    const mine = this.#sets
      .filter((entry) => !fromEnvironment(entry.id))
      .map((entry) => portableProviderSet(entry))
      .filter((entry): entry is AiProviderSet => Boolean(entry));

    /*
     * For a discovered provider, the difference from what was offered — and only that.
     *
     * Storing the whole set would resurrect a provider whose key has been removed from `.env`;
     * storing nothing loses the user's edits, which is the bug this fixes. The diff keeps both
     * properties: a field the user never touched still tracks the environment, so a model changed
     * in `.env` shows through, while one they did touch survives the reload.
     */
    const overrides: Record<string, ProviderOverride> = {};
    for (const entry of this.#sets) {
      if (!fromEnvironment(entry.id)) continue;
      const base = this.#offered.get(entry.id) ?? this.#overrides.get(entry.id);
      const diff: ProviderOverride = {};
      for (const field of EDITABLE_FIELDS) {
        if (entry[field] !== base?.[field]) diff[field] = entry[field] as never;
      }
      if (Object.keys(diff).length) overrides[entry.id] = diff;
    }

    try {
      if (!mine.length && !Object.keys(overrides).length && !this.#activeId) {
        store.removeItem(SETS_KEY);
        return;
      }
      store.setItem(SETS_KEY, JSON.stringify({
        sets: mine,
        ...(Object.keys(overrides).length ? { overrides } : {}),
        // Kept whichever kind of provider it names: choosing the dev server's model as the default
        // is a choice, and forgetting it on reload is the same complaint as forgetting the rest.
        ...(this.#activeId ? { activeId: this.#activeId } : {}),
      }));
    } catch {
      // A full or blocked store costs the convenience, not the session.
    }
  }

  /*
   * No permission methods here any more.
   *
   * A provider used to carry its own scope, so this class answered "what may it change" and had a
   * per-session widening map to hold "yes, and stop asking". Both are gone: permission belongs to
   * the request, is chosen in the popover, and is passed in — see `AiContextScope`. What is left is
   * the provider list, the credential proxy and the boundary.
   */

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
  review(
    raw: unknown,
    element: HTMLElement,
    /**
     * What this request may see and change.
     *
     * Required rather than defaulted, because there is no sensible default left. The provider does
     * not carry a scope any more and guessing one here would either deny everything — making the
     * boundary untestable — or grant everything, which is the opposite mistake. The caller that
     * decided what to describe is the caller that knows.
     */
    scope: AiContextScope,
  ): BrokerVerdict {
    const target: BrokerTarget = { element, parent: selectableParent(element) };
    return reviewOperation(raw, target, scope);
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
    /** What this run may see and change — the popover's switches, as chosen for this request. */
    scope: AiContextScope;
  }): Promise<RunOutcome> {
    const run = new AiRun(options.element, options.prompt, options.host);
    this.#run = run;
    this.#emit();
    try {
      for await (const raw of options.operations) {
        if (run.aborted) break;
        await run.offer(this.review(raw, options.element, options.scope));
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
