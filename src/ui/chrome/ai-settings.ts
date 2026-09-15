import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { DEFAULT_AI_SCOPE } from '../../core/ai/agent.js';
import { testTransport, createTransport } from '../../core/ai/transport.js';
import {
  AI_SCOPE_CLASSES,
  AI_SCOPE_CONSEQUENCE,
  AI_SCOPE_LABELS,
  describeTransport,
  type AiProviderKind,
  type AiProviderSet,
  type AiScopeClass,
  type AiTransportKind,
} from '../../core/ai/types.js';
import { ModalController } from '../../core/modal.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * Where a model is connected, and what it is trusted with.
 *
 * Two questions on one surface, and they are deliberately not separated. Which provider a request
 * goes to and what that request may change are the same decision from the user's point of view —
 * "my own key on my own machine, let it do anything" and "a shared team key, ask me first" are
 * one thought — so switching provider also switches trust level, and the panel is arranged to
 * make that visible rather than surprising.
 *
 * The part worth the most care is the credential. It is the only thing here the editor cannot
 * protect once it is in the page, so the panel says which of three situations applies in plain
 * words instead of showing a lock and implying a guarantee. See `keys.ts`.
 */
@customElement('heo-ai-settings')
export class HeoAiSettings extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 42;
        display: grid;
        place-items: center;
        padding: 24px;
        background: oklch(12% 0.01 265 / 55%);
        backdrop-filter: blur(3px);
        pointer-events: auto;
      }
      /*
       * Full screen, near enough, and that is a considered size rather than a generous one.
       *
       * A provider set is six fields, a credential and three permission rows, and the permission
       * rows are the part that has to be read rather than skimmed — each is a sentence about what
       * changes beyond the element. Squeezed into a popover they became three dropdowns with
       * truncated labels, which is how a security control turns into furniture.
       */
      .dialog {
        display: flex;
        flex-direction: column;
        width: min(860px, 100%);
        height: min(88vh, 760px);
        border-radius: var(--heo-r-lg);
        overflow: hidden;
      }

      /*
       * Two columns once there is more than one provider.
       *
       * The list on the left is the thing being navigated and the form on the right is the thing
       * being edited, which is the shape every settings surface converges on for the same reason:
       * it keeps the answer to "which one am I changing" on screen while you change it. With a
       * single provider there is nothing to navigate, so the list would be a column of one and
       * the layout collapses to the form alone.
       */
      .split {
        display: grid;
        grid-template-columns: 232px minmax(0, 1fr);
        flex: 1 1 auto;
        min-height: 0;
      }
      .split.solo {
        grid-template-columns: minmax(0, 1fr);
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px 10px 10px 16px;
        border-right: 1px solid var(--heo-line);
        overflow-y: auto;
      }
      .split.solo .list {
        display: none;
      }
      .pane {
        padding: 4px 16px 12px;
        overflow-y: auto;
      }

      header {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 15px 16px 11px;
      }
      header .body {
        flex: 1 1 auto;
        min-width: 0;
      }
      h2 {
        margin: 0 0 3px;
        font-size: 13.5px;
        font-weight: 600;
      }
      header p {
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.55;
      }

      .content {
        flex: 1 1 auto;
        padding: 0 16px 4px;
        overflow-y: auto;
      }

      /* One row in the left-hand list: a button, because picking one is the only thing it does. */
      .row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 7px 8px;
        border: 1px solid transparent;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text-dim);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .row:hover {
        background: var(--heo-sunken);
        color: var(--heo-text);
      }
      .row[aria-current='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-sunken);
        color: var(--heo-text);
      }
      .row .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11.5px;
        font-weight: 600;
      }
      .row .dot {
        flex: 0 0 auto;
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--heo-accent);
      }
      .row .dot.needs {
        background: var(--heo-danger);
      }
      .row .dot.exposed {
        background: var(--heo-warn);
      }

      /* The header of the form pane: which provider, and how safe its credential is. */
      .head {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 6px 0 10px;
      }
      .head .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 600;
      }
      .head .model {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      /* The default provider, named rather than merely first. Order is priority here, and a
         list whose first row was special without saying so would be a rule nobody could see. */
      .first {
        padding: 1px 5px;
        border-radius: 999px;
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
        font-size: 9px;
      }
      .shield {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 6px;
        border: 1px solid var(--heo-line);
        border-radius: 999px;
        font-size: 9.5px;
        white-space: nowrap;
      }
      .shield.safe {
        border-color: var(--heo-accent-line);
        color: var(--heo-accent);
      }
      .shield.exposed {
        border-color: var(--heo-warn);
        color: var(--heo-warn);
      }
      .shield.needs {
        border-color: var(--heo-danger);
        color: var(--heo-danger);
      }

      .body-rows {
        padding: 0 10px 10px;
      }
      .why {
        margin: 0 0 9px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.55;
      }
      label.field {
        display: block;
        margin-bottom: 7px;
      }
      label.field > span {
        display: block;
        margin-bottom: 3px;
        color: var(--heo-text-dim);
        font-size: 10px;
      }
      input,
      select,
      textarea {
        width: 100%;
        padding: 5px 7px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-base);
        color: var(--heo-text);
        font: inherit;
        font-size: 11px;
      }
      textarea {
        min-height: 46px;
        resize: vertical;
        line-height: 1.5;
      }
      input:focus-visible,
      select:focus-visible,
      textarea:focus-visible {
        border-color: var(--heo-accent-line);
        outline: none;
      }
      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
      }

      /* Scope rows: the permission, its consequence, and the choice, in that reading order. */
      .scope {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        border-top: 1px solid var(--heo-line);
      }
      .scope .text {
        flex: 1 1 auto;
        min-width: 0;
      }
      .scope .text b {
        display: block;
        font-size: 11px;
        font-weight: 600;
      }
      .scope .text span {
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.45;
      }
      .scope select {
        width: auto;
        flex: 0 0 auto;
      }

      .acts {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 9px;
      }
      .acts .spacer {
        flex: 1 1 auto;
      }
      .verdict {
        font-size: 10.5px;
      }
      .verdict.ok {
        color: var(--heo-accent);
      }
      .verdict.bad {
        color: var(--heo-danger);
      }

      .empty {
        padding: 14px 0 18px;
        color: var(--heo-text-dim);
        font-size: 11.5px;
        line-height: 1.6;
        text-align: center;
      }

      footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px 15px;
      }
      footer .spacer {
        flex: 1 1 auto;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.aiSettingsOpen, s.registry] as const,
    shallowArrayEquals,
  );

  protected modal = new ModalController(this, { initialFocus: '.close' });

  /** Which set is expanded. One at a time: these are long forms and two open is a wall. */
  @state() private openId: string | null = null;
  /** Key drafts, per set. Never read back out of the vault — see `keys.ts`. */
  @state() private keyDraft: Record<string, string> = {};
  @state() private remember: Record<string, boolean> = {};
  @state() private testing: string | null = null;
  @state() private verdict: Record<string, { ok: boolean; text: string }> = {};

  override render(): TemplateResult | typeof nothing {
    if (!this.state.value.aiSettingsOpen) return nothing;
    const sets = this.editor.ai.list();

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="heo-ai-settings-title"
      @pointerdown=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.editor.setAiSettings(false);
      }}
    >
      <header>
        <div class="body">
          <h2 id="heo-ai-settings-title">AI providers</h2>
          <p>
            Bring your own model. The first in the list is the default; drag order is priority.
            Each one carries its own rules about what it may change.
          </p>
        </div>
        <button
          class="btn icon ghost close"
          type="button"
          aria-label="Close"
          @click=${() => this.editor.setAiSettings(false)}
        >
          ${icon('close', 14)}
        </button>
      </header>

      ${sets.length
        ? html`<div class=${`split${sets.length === 1 ? ' solo' : ''}`}>
              <div class="list" role="tablist" aria-label="Providers">
                ${sets.map((set, index) => this.#renderRow(set, index))}
              </div>
              <div class="pane">${this.#renderForm(this.#current(sets), sets)}</div>
            </div>`
        : html`<div class="pane">
              <p class="empty">
                No model yet. Add one and any element on the page can be edited by describing
                the change you want.
              </p>
            </div>`}

      <footer>
        <button class="btn primary sm" type="button" @click=${() => this.#add()}>
          ${icon('plus', 12)} Add a provider
        </button>
        <span class="spacer"></span>
        <button class="btn sm" type="button" @click=${() => this.editor.setAiSettings(false)}>
          Done
        </button>
      </footer>
    </div>`;
  }

  /**
   * Which provider the form is showing.
   *
   * Falls back to the first rather than to nothing, so the pane is never empty while the list has
   * rows — and so removing the selected provider lands on a neighbour instead of a blank column.
   */
  #current(sets: readonly AiProviderSet[]): AiProviderSet {
    return sets.find((one) => one.id === this.openId) ?? sets[0];
  }

  /** One row in the list: the name, and a dot saying how exposed its credential is. */
  #renderRow(set: AiProviderSet, index: number): TemplateResult {
    const chosen = this.#current(this.editor.ai.list()).id === set.id;
    const needsKey = !this.editor.ai.ready(set);
    const tone = needsKey ? 'needs' : set.transport === 'in-page' ? 'exposed' : 'safe';
    return html`<button
      class="row"
      type="button"
      role="tab"
      aria-current=${chosen ? 'true' : 'false'}
      @click=${() => {
        this.openId = set.id;
      }}
    >
      <span class=${`dot ${tone}`}></span>
      <span class="name">${set.label}</span>
      ${index === 0 ? html`<span class="first">Default</span>` : nothing}
    </button>`;
  }

  #renderForm(set: AiProviderSet, sets: readonly AiProviderSet[]): TemplateResult {
    const index = sets.findIndex((one) => one.id === set.id);
    const status = this.editor.ai.keyStatus(set.id);
    const badge = describeTransport(set, status.persistence);
    const refusal = this.editor.ai.persistenceRefusal();
    const verdict = this.verdict[set.id];
    const needsKey = !this.editor.ai.ready(set);
    const shield = needsKey ? 'needs' : set.transport === 'in-page' ? 'exposed' : 'safe';
    const patch = (next: Partial<AiProviderSet>): void => {
      this.editor.ai.upsert({ ...set, ...next });
      // A changed destination invalidates whatever the last test proved.
      this.verdict = { ...this.verdict, [set.id]: undefined as never };
    };

    return html`<div class="body-rows">
      <div class="head">
        <span class="name">${set.label}</span>
        ${set.model ? html`<span class="model">${set.model}</span>` : nothing}
        <span class=${`shield ${shield}`} title=${badge.detail}>
          ${icon(needsKey ? 'alert' : set.transport === 'in-page' ? 'eye' : 'lock', 10)}
          ${needsKey ? 'Needs a key' : badge.badge}
        </span>
      </div>

      <!-- The security statement, before the fields that decide it. -->
      <p class="why">${badge.detail}</p>

      <label class="field">
        <span>Name</span>
        <input
          .value=${set.label}
          @change=${(event: Event) => patch({ label: (event.target as HTMLInputElement).value })}
        />
      </label>

      <div class="pair">
        <label class="field">
          <span>Where the key lives</span>
          <select
            @change=${(event: Event) =>
        patch({ transport: (event.target as HTMLSelectElement).value as AiTransportKind })}
          >
            <option value="proxy" ?selected=${set.transport === 'proxy'}>
              Dev server (safest)
            </option>
            <option value="local" ?selected=${set.transport === 'local'}>
              Local model (no key)
            </option>
            <option value="in-page" ?selected=${set.transport === 'in-page'}>
              In this page
            </option>
          </select>
        </label>
        <label class="field">
          <span>API shape</span>
          <select
            @change=${(event: Event) =>
        patch({ provider: (event.target as HTMLSelectElement).value as AiProviderKind })}
          >
            <option value="openai-compatible" ?selected=${set.provider === 'openai-compatible'}>
              OpenAI-compatible
            </option>
            <option value="openai" ?selected=${set.provider === 'openai'}>OpenAI</option>
            <option value="anthropic" ?selected=${set.provider === 'anthropic'}>Anthropic</option>
            <option value="google" ?selected=${set.provider === 'google'}>Google</option>
          </select>
        </label>
      </div>

      ${set.transport === 'proxy'
        ? nothing
        : html`<label class="field">
            <span>Base URL</span>
            <input
              .value=${set.baseURL ?? ''}
              placeholder="http://127.0.0.1:11434/v1"
              @change=${(event: Event) =>
            patch({ baseURL: (event.target as HTMLInputElement).value })}
            />
          </label>`}

      <label class="field">
        <span>Model</span>
        <input
          .value=${set.model}
          placeholder="gpt-4o-mini"
          @change=${(event: Event) => patch({ model: (event.target as HTMLInputElement).value })}
        />
      </label>

      ${set.transport === 'in-page' ? this.#renderKeyField(set, status.hint, refusal) : nothing}

      <label class="field">
        <span>Extra instructions (optional)</span>
        <textarea
          .value=${set.systemPrompt ?? ''}
          placeholder="Prefer short copy. Never use exclamation marks."
          @change=${(event: Event) =>
        patch({ systemPrompt: (event.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>

      ${AI_SCOPE_CLASSES.map((scope) => this.#renderScope(set, scope))}

      <div class="acts">
        <button
          class="btn sm"
          type="button"
          ?disabled=${this.testing === set.id}
          @click=${() => void this.#test(set)}
        >
          ${icon('play', 11)} ${this.testing === set.id ? 'Testing…' : 'Test'}
        </button>
        ${verdict
        ? html`<span class=${`verdict ${verdict.ok ? 'ok' : 'bad'}`}>
              ${icon(verdict.ok ? 'check' : 'alert', 11)} ${verdict.text}
            </span>`
        : nothing}
        <span class="spacer"></span>
        ${index > 0
        ? html`<button
              class="btn icon ghost"
              type="button"
              aria-label="Make this the default"
              title="Move to the top, making it the default"
              @click=${() => this.editor.ai.reorder(set.id, 0)}
            >
              ${icon('arrowUp', 12)}
            </button>`
        : nothing}
        <button
          class="btn icon ghost"
          type="button"
          aria-label=${`Remove ${set.label}`}
          @click=${() => this.#remove(set)}
        >
          ${icon('trash', 12)}
        </button>
      </div>
    </div>`;
  }

  /**
   * The key field, and the choice about how long it lives.
   *
   * A real `type="password"` inside a form with `autocomplete`, which is the recommended path
   * rather than a nicety: the browser's own password manager then holds the secret at rest, with
   * OS-level protection, and the editor persists nothing. That is a better answer than anything
   * this code could do, so it is the one the markup asks for.
   *
   * The "remember" control is disabled off loopback *and says why*, because the reason is the
   * whole point — a saved key on a shared origin is readable by every script on it, for ever.
   */
  #renderKeyField(
    set: AiProviderSet,
    hint: string | undefined,
    refusal: string | null,
  ): TemplateResult {
    const draft = this.keyDraft[set.id] ?? '';
    const remember = Boolean(this.remember[set.id]);
    return html`<label class="field">
      <span>API key${hint ? ` — currently ends ${hint}` : ''}</span>
      <input
        type="password"
        autocomplete="current-password"
        name=${`heo-ai-key-${set.id}`}
        .value=${draft}
        placeholder=${hint ? '••••••••' : 'sk-…'}
        @input=${(event: Event) => {
        this.keyDraft = { ...this.keyDraft, [set.id]: (event.target as HTMLInputElement).value };
      }}
      />
      <div class="acts">
        <button
          class="btn sm"
          type="button"
          ?disabled=${!draft.trim()}
          @click=${() => void this.#saveKey(set)}
        >
          ${icon('check', 11)} Use this key
        </button>
        <label class="verdict" title=${refusal ?? 'Keep it on this machine until you remove it'}>
          <input
            type="checkbox"
            style="width:auto"
            ?checked=${remember}
            ?disabled=${Boolean(refusal)}
            @change=${(event: Event) => {
        this.remember = {
          ...this.remember,
          [set.id]: (event.target as HTMLInputElement).checked,
        };
      }}
          />
          Remember on this machine
        </label>
        <span class="spacer"></span>
        ${hint
        ? html`<button
              class="btn icon ghost"
              type="button"
              aria-label="Forget this key"
              title="Forget this key everywhere"
              @click=${() => this.editor.ai.clearKey(set.id)}
            >
              ${icon('unlink', 12)}
            </button>`
        : nothing}
      </div>
      ${refusal ? html`<span class="verdict">${refusal}</span>` : nothing}
    </label>`;
  }

  #renderScope(set: AiProviderSet, scope: AiScopeClass): TemplateResult {
    const current = set.scope[scope];
    return html`<div class="scope">
      <span class="text">
        <b>${AI_SCOPE_LABELS[scope]}</b>
        <span>${AI_SCOPE_CONSEQUENCE[scope]}</span>
      </span>
      <select
        aria-label=${AI_SCOPE_LABELS[scope]}
        @change=${(event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        const next = { ...set.scope };
        if (value === 'never') delete next[scope];
        else next[scope] = value as 'always' | 'ask';
        this.editor.ai.upsert({ ...set, scope: next });
      }}
      >
        <option value="always" ?selected=${current === 'always'}>Always</option>
        <option value="ask" ?selected=${current === 'ask'}>Ask me</option>
        <option value="never" ?selected=${!current}>Never</option>
      </select>
    </div>`;
  }

  /* ---------------------------------------------------------------------- */

  #add(): void {
    const id = `ai-${Math.random().toString(36).slice(2, 9)}`;
    // Defaults to the safest transport available: a dev server is holding a key or it is not,
    // and finding out is one Test away — whereas defaulting to an in-page key would make the
    // least safe option the one that happens by not choosing.
    const proxied = Boolean(this.editor.project);
    this.editor.ai.upsert({
      id,
      label: proxied ? 'Dev server model' : 'New provider',
      transport: proxied ? 'proxy' : 'local',
      provider: 'openai-compatible',
      baseURL: proxied ? undefined : 'http://127.0.0.1:11434/v1',
      model: '',
      scope: { ...DEFAULT_AI_SCOPE },
    });
    this.openId = id;
  }

  #remove(set: AiProviderSet): void {
    this.editor.askToConfirm({
      title: `Remove ${set.label}?`,
      message: 'Its settings and its stored key are both forgotten.',
      confirmLabel: 'Remove',
      tone: 'danger',
      // Honest: the agent's registry is not on the undo stack, so this really is one way.
      reversible: false,
      run: () => {
        this.editor.ai.clearKey(set.id);
        this.editor.ai.remove(set.id);
        if (this.openId === set.id) this.openId = null;
      },
    });
  }

  async #saveKey(set: AiProviderSet): Promise<void> {
    const draft = (this.keyDraft[set.id] ?? '').trim();
    if (!draft) return;
    const result = await this.editor.ai.setKey(
      set.id,
      draft,
      this.remember[set.id] ? 'origin' : 'session',
    );
    // Dropped from component state the moment the vault has it, so the only copy is the one in
    // the vault's closure rather than one in a Lit property anybody can read off the element.
    this.keyDraft = { ...this.keyDraft, [set.id]: '' };
    if (result.refused) this.editor.notify(result.refused, 'error');
    else {
      this.editor.notify(
        result.persistence === 'origin'
          ? `Key saved for ${set.label} on this machine.`
          : `Key held for ${set.label} until this tab closes.`,
        'success',
      );
    }
  }

  /**
   * Ask the provider for one operation, and report what came back.
   *
   * A real request rather than a reachability probe. A host that answers and a model name that
   * does not exist is the most common misconfiguration by a distance, and a ping would call it
   * healthy — so the test succeeds only on a reply this editor could actually use.
   */
  async #test(set: AiProviderSet): Promise<void> {
    this.testing = set.id;
    this.verdict = { ...this.verdict, [set.id]: undefined as never };
    try {
      const transport =
        this.editor.options.aiTransport ??
        createTransport(this.editor.project?.aiEndpoint?.() ?? null);
      const result = await testTransport(transport, set);
      this.verdict = {
        ...this.verdict,
        [set.id]: result.ok
          ? { ok: true, text: 'Connected.' }
          : { ok: false, text: result.reason },
      };
    } finally {
      this.testing = null;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-ai-settings': HeoAiSettings;
  }
}
