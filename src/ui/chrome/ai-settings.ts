import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { DEFAULT_AI_SCOPE } from '../../core/ai/agent.js';
import { testTransport, createTransport } from '../../core/ai/transport.js';
import {
  AI_SCOPE_CLASSES,
  AI_SCOPE_CONSEQUENCE,
  AI_SCOPE_LABELS,
  AI_SELF_SCOPE,
  baseURLFor,
  DEFAULT_BASE_URL,
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
      /*
       * 32: the top of the content-dialog band, not above it.
       *
       * This was 42, which is the highest number in the overlay and was the reason a
       * confirmation raised from here — "Remove this provider?" — painted *behind* the dialog
       * that asked it. 40 is reserved for the two surfaces that have to sit over everything,
       * the confirmation and the toast, precisely because they are raised *from* the dialogs
       * below. A settings modal is one of those dialogs, so it belongs in their band beside
       * the save (30) and CSS-paste (31) surfaces.
       */
      :host {
        position: fixed;
        inset: 0;
        z-index: 32;
        display: grid;
        place-items: center;
        padding: 24px;
        background: oklch(12% 0.01 265 / 55%);
        backdrop-filter: blur(3px);
        pointer-events: auto;
        animation: fade var(--heo-fast) var(--heo-ease);
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

      /* One tab in the provider list: a button, because picking one is the only thing it does. */
      .tab {
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
      .tab:hover {
        background: var(--heo-sunken);
        color: var(--heo-text);
      }
      .tab[aria-current='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-sunken);
        color: var(--heo-text);
      }
      .tab .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11.5px;
        font-weight: 600;
      }
      .tab .dot {
        flex: 0 0 auto;
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--heo-accent);
      }
      .tab .dot.needs {
        background: var(--heo-danger);
      }
      .tab .dot.exposed {
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
      /* The security sentence on the left, the actions on the provider itself on the right. */
      .why {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin: 0 0 10px;
      }
      .why p {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.55;
      }
      .owner-acts {
        display: flex;
        flex: 0 0 auto;
        gap: 6px;
      }

      /*
       * .field is the shared grid from theme.ts; only the spacing between fields is local.
       *
       * The label used to be positioned by hand here, which meant this dialog's fields drifted
       * from every other panel's the moment one of them changed.
       */
      .field {
        margin-bottom: 8px;
      }
      .field > span {
        color: var(--heo-text-dim);
        font-size: 10px;
      }
      /*
       * Controls carry .input, so there is no bare element rule for input here.
       *
       * There was, and it caught every checkbox in the dialog — which is why the "remember this
       * key" box needed an inline width:auto to escape it. Naming the class instead means the
       * fields get the shared hover, focus, placeholder and drawn select chevron for free, and
       * a checkbox is simply not one of them.
       */
      textarea.input {
        min-height: 46px;
        font-family: inherit;
        font-size: 11px;
      }
      .pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
      }

      /* The permissions get a heading, because they are the only settings here about reach. */
      .scope-title {
        margin: 14px 0 3px;
        font-size: 11.5px;
        font-weight: 600;
      }
      .scope-lede {
        margin: 0 0 2px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }

      /*
       * Scope rows: the permission, its consequence, and the choice, in that reading order.
       *
       * Top-aligned rather than centred now the explanation is two clauses long — a select
       * floating against the vertical middle of four lines of text belongs to none of them.
       */
      .scope {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 8px 0;
        border-top: 1px solid var(--heo-line);
      }
      .scope .text {
        flex: 1 1 auto;
        min-width: 0;
      }
      .scope .text b {
        display: block;
        margin-bottom: 1px;
        font-size: 11px;
        font-weight: 600;
      }
      .scope .text span {
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.5;
      }
      .scope select {
        width: auto;
        flex: 0 0 auto;
      }
      /*
       * The selected element's row is stated, not offered.
       *
       * Kept legible rather than dimmed to the usual disabled opacity: this is the row that says
       * what the AI is allowed to do at all, and a greyed-out "Always" reads as unavailable
       * rather than as settled.
       */
      .scope.fixed .text b {
        color: var(--heo-accent);
      }
      .scope.fixed select:disabled {
        opacity: 1;
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-text);
        cursor: default;
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
        margin: 0 auto;
        max-width: 46ch;
        color: var(--heo-text-dim);
        font-size: 11.5px;
        line-height: 1.7;
        text-align: center;
      }
      /* Variable names read as names rather than as prose, so they can be copied by eye. */
      .empty code {
        padding: 1px 4px;
        border-radius: 4px;
        background: var(--heo-surface-2);
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        white-space: nowrap;
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

      /*
       * Narrow screens, at the same 560px the CSS-paste dialog uses.
       *
       * Two things break rather than merely tighten. The 232px provider list left about 90px for
       * a form, and .pair put two selects side by side in it — so the sensible move is not to
       * shrink either but to change what they are: the list becomes a strip of tabs along the
       * top, which is the same "pick one, then edit it" relationship read vertically instead of
       * horizontally, and every field gets its own line.
       */
      @media (max-width: 560px) {
        :host {
          padding: 8px;
        }
        .dialog {
          height: auto;
          max-height: calc(100vh - 16px);
        }
        .split,
        .split.solo {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto minmax(0, 1fr);
        }
        /* A horizontal strip, scrollable, so ten providers do not push the form off screen. */
        .list {
          flex-direction: row;
          gap: 6px;
          padding: 2px 12px 10px;
          border-right: 0;
          border-bottom: 1px solid var(--heo-line);
          overflow-x: auto;
          overflow-y: hidden;
          scrollbar-width: thin;
        }
        .tab {
          width: auto;
          flex: 0 0 auto;
        }
        /* The default marker is the one thing worth dropping: the leftmost tab is the default. */
        .tab .first {
          display: none;
        }
        .pane,
        .body-rows {
          padding-left: 12px;
          padding-right: 12px;
        }
        header,
        footer {
          padding-left: 12px;
          padding-right: 12px;
        }
        /* One control per line, which is the whole point of the breakpoint. */
        .pair {
          grid-template-columns: minmax(0, 1fr);
        }
        /*
         * The permission rows turn into label-above-control.
         *
         * Side by side, the consequence sentence — the part that has to be read rather than
         * skimmed — was wrapping to four lines beside a select.
         */
        .scope {
          flex-wrap: wrap;
        }
        .scope select.input {
          width: 100%;
        }
        /* Actions below the sentence they belong to rather than squeezed against it. */
        .why {
          flex-wrap: wrap;
        }
        .owner-acts {
          flex: 1 1 100%;
        }
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
              <!--
                The empty state names the shortest route rather than only stating the situation.
                A key in .env is one line and needs no configuration, and it is also the only
                tier that keeps the credential out of this page — so it is the one to put first.
              -->
              <p class="empty">
                No model yet. Put a key in <code>.env</code> and restart the dev server — 
                <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code> and
                <code>GEMINI_API_KEY</code> are all picked up on their own, and stay on the
                server. Or add a provider below to use a local model or your own key.
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
      class="tab"
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
    /**
     * Write one field, over whatever the set holds *now*.
     *
     * Re-read rather than spread from the `set` this render closed over. The captured copy is a
     * snapshot, and a change arriving between the render and the input's own change event — a
     * sibling field committing, a key being stored, anything the agent emits — would be undone by
     * the next thing the user typed, because the stale copy carries the old value of every field
     * it is not setting.
     */
    const patch = (next: Partial<AiProviderSet>): void => {
      const live = this.editor.ai.get(set.id) ?? set;
      this.editor.ai.upsert({ ...live, ...next });
      // A changed destination invalidates whatever the last test proved.
      this.verdict = { ...this.verdict, [set.id]: undefined as never };
    };
    /** The set as it stands, for a handler that needs to read a field before writing another. */
    const live = (): AiProviderSet => this.editor.ai.get(set.id) ?? set;

    return html`<div class="body-rows">
      <div class="head">
        <span class="name">${set.label}</span>
        ${set.model ? html`<span class="model">${set.model}</span>` : nothing}
        <span class=${`shield ${shield}`} title=${badge.detail}>
          ${icon(needsKey ? 'alert' : set.transport === 'in-page' ? 'eye' : 'lock', 10)}
          ${needsKey ? 'Needs a key' : badge.badge}
        </span>
      </div>

      <!--
        The security statement, and beside it the two actions on the provider as a whole.

        Up here rather than at the foot of the form, which is where they were: below a
        credential field, three permission rows and a free-text box, "Delete" was a bare icon
        several scroll-lengths away from the name of the thing it deleted. These act on the
        provider, so they belong level with the line that identifies it — and Delete is last,
        because the destructive one should not be the one the hand reaches first.
      -->
      <div class="why">
        <p>${badge.detail}</p>
        <div class="owner-acts">
          ${index > 0
        ? html`<button
                class="btn sm"
                type="button"
                title="Move to the top of the list, making it the default"
                @click=${() => this.editor.ai.reorder(set.id, 0)}
              >
                ${icon('arrowUp', 12)} Promote
              </button>`
        : nothing}
          <button
            class="btn sm danger"
            type="button"
            title=${`Remove ${set.label} and forget its key`}
            @click=${() => this.#remove(set)}
          >
            ${icon('trash', 12)} Delete
          </button>
        </div>
      </div>

      <label class="field">
        <span>Name</span>
        <input
          class="input"
          .value=${set.label}
          @change=${(event: Event) => patch({ label: (event.target as HTMLInputElement).value })}
        />
      </label>

      <div class="pair">
        <label class="field">
          <span>Where the key lives</span>
          <select
            class="input"
            @change=${(event: Event) => {
        const transport = (event.target as HTMLSelectElement).value as AiTransportKind;
        /*
         * Leaving proxy means the page now has to know where to send the request.
         *
         * A proxied set carries no base URL by design — the server decides and the page is not
         * told — so switching one to a tier that sends its own requests left the field empty,
         * and an empty base produced the relative path `/chat/completions`. That is a request
         * to the page's own origin, which fails in a way that reads like a broken editor
         * rather than a missing setting.
         */
        const now = live();
        patch(
          transport === 'proxy'
            ? { transport }
            : { transport, baseURL: baseURLFor(now.provider, now.baseURL) },
        );
      }}
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
            class="input"
            @change=${(event: Event) => {
        const provider = (event.target as HTMLSelectElement).value as AiProviderKind;
        // The dialect implies the host, so choosing one fills the other in — unless the user
        // typed a host of their own, which `baseURLFor` leaves alone.
        const now = live();
        patch(
          now.transport === 'proxy'
            ? { provider }
            : { provider, baseURL: baseURLFor(provider, now.baseURL) },
        );
      }}
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
              class="input"
              .value=${set.baseURL ?? ''}
              placeholder=${DEFAULT_BASE_URL[set.provider] || 'http://127.0.0.1:11434/v1'}
              @change=${(event: Event) =>
            patch({ baseURL: (event.target as HTMLInputElement).value })}
            />
          </label>`}

      <label class="field">
        <span>Model</span>
        <input
          class="input"
          .value=${set.model}
          placeholder="gpt-4o-mini"
          @change=${(event: Event) => patch({ model: (event.target as HTMLInputElement).value })}
        />
      </label>

      ${set.transport === 'in-page' ? this.#renderKeyField(set, status.hint, refusal) : nothing}

      <label class="field">
        <span>Extra instructions (optional)</span>
        <textarea
          class="input"
          .value=${set.systemPrompt ?? ''}
          placeholder="Prefer short copy. Never use exclamation marks."
          @change=${(event: Event) =>
        patch({ systemPrompt: (event.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>

      <!--
        The permissions, under a heading that says what they are.

        Ungrouped, these read as three more settings between a textarea and a Test button. They
        are the only settings on this screen that decide how far a change can travel, so they get
        a title and the selected element is listed with them — see AI_SELF_SCOPE.
      -->
      <h3 class="scope-title">Scope of AI changes</h3>
      <p class="scope-lede">
        What this provider may edit when you ask it for something. Everything beyond the selected
        element reaches other parts of the page.
      </p>
      ${this.#renderSelfScope()}
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
        class="input"
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
              class="btn sm danger"
              type="button"
              title="Forget this key everywhere it is stored"
              @click=${() => this.editor.ai.clearKey(set.id)}
            >
              ${icon('unlink', 12)} Forget key
            </button>`
        : nothing}
      </div>
      ${refusal ? html`<span class="verdict">${refusal}</span>` : nothing}
    </label>`;
  }

  /**
   * The selected element, listed with the permissions but not one of them.
   *
   * A disabled select rather than a chip or a tick, so the four rows read as one list with one
   * kind of answer in it. It is disabled rather than absent because "Always" is the fact worth
   * stating: a reader deciding whether to allow class edits is comparing them against something,
   * and that something should be on screen.
   */
  #renderSelfScope(): TemplateResult {
    return html`<div class="scope fixed">
      <span class="text">
        <b>${AI_SELF_SCOPE.label}</b>
        <span>${AI_SELF_SCOPE.consequence}</span>
      </span>
      <select
        class="input"
        disabled
        aria-label=${`${AI_SELF_SCOPE.label} — always allowed and not changeable`}
        title="The element you selected is always editable. That is what the AI is for."
      >
        <option selected>Always</option>
      </select>
    </div>`;
  }

  #renderScope(set: AiProviderSet, scope: AiScopeClass): TemplateResult {
    const current = set.scope[scope];
    return html`<div class="scope">
      <span class="text">
        <b>${AI_SCOPE_LABELS[scope]}</b>
        <span>${AI_SCOPE_CONSEQUENCE[scope]}</span>
      </span>
      <select
        class="input"
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
    /*
     * A local model, not a proxied one.
     *
     * Proxied providers are not made here — the dev server discovers its own keys and hands the
     * page a set per provider, already named and pointed at a model. So reaching for this button
     * means the environment did not supply what you wanted, and the useful thing to offer is the
     * other keyless option rather than a `proxy` set with an id no server has heard of.
     */
    this.editor.ai.upsert({
      id,
      label: 'New provider',
      transport: 'local',
      provider: 'openai-compatible',
      baseURL: 'http://127.0.0.1:11434/v1',
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
