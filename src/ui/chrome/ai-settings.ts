import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { testTransport, createTransport } from '../../core/ai/transport.js';
import {
  baseURLFor,
  DEFAULT_BASE_URL,
  describeTransport,
  type AiProviderKind,
  type AiProviderSet,
  type AiTransportKind,
} from '../../core/ai/types.js';
import { ModalController } from '../../core/modal.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import type { FieldIssue } from '../../core/validation.js';
import { field, FormErrors } from '../form-errors.js';

/**
 * Settings: how the editor behaves on this page, and where a model is connected.
 *
 * Editing preferences come first and are short — they travel with the page in its seed. The rest of
 * the dialog is the AI providers, which are most of what there is to configure.
 *
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
        padding: 10px;
        border-right: 1px solid var(--heo-line);
        overflow-y: auto;
      }
      .split.solo .list {
        display: none;
      }
      .pane {
        padding: 8px 16px 14px;
        overflow-y: auto;
      }
      /* Another row of the list, drawn as a slot waiting to be filled rather than as a provider. */
      .add-list {
        justify-content: flex-start;
        width: 100%;
        margin-top: 2px;
        border: 1px dashed var(--heo-line);
        background: transparent;
        color: var(--heo-text-dim);
      }
      .add-list:hover {
        color: var(--heo-text);
      }
      /* With one provider the list is hidden, and the button moves into that provider's actions. */
      .split.solo .add-list {
        display: none;
      }
      .empty-acts {
        display: flex;
        justify-content: center;
        padding-bottom: 6px;
      }
      .key-note {
        color: var(--heo-text-faint);
        font-size: 10.5px;
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

      /*
       * The body: titled sections, each one a card.
       *
       * The providers section takes the remaining height and scrolls inside its card, so the
       * footer with Save stays in view however long a provider's form gets.
       */
      .sections {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 16px;
        min-height: 0;
        padding: 2px 16px 14px;
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .section.providers {
        flex: 1 1 auto;
        min-height: 0;
      }
      .section-head h3 {
        margin: 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .section-head p {
        margin: 3px 0 0;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.55;
      }
      .card {
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: color-mix(in oklab, var(--heo-sunken) 60%, transparent);
      }
      .providers-card {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      .setting {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 11px 12px;
        cursor: pointer;
      }
      .setting input {
        margin: 2px 0 0;
        width: 14px;
        height: 14px;
        accent-color: var(--heo-accent);
      }
      .setting .name {
        display: block;
        font-size: 12px;
        font-weight: 600;
      }
      .setting .desc {
        display: block;
        margin-top: 2px;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.5;
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
        padding: 0;
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
        padding: 12px 16px 14px;
        border-top: 1px solid var(--heo-line);
      }
      footer .spacer {
        flex: 1 1 auto;
      }
      footer .quiet {
        color: var(--heo-text-faint);
        font-size: 11px;
      }
      footer .unsaved {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-warn);
        font-size: 11px;
        font-weight: 600;
      }
      footer .unsaved::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: currentColor;
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
        footer,
        .sections {
          padding-left: 12px;
          padding-right: 12px;
        }
        /* The add button stays a short chip at the end of the strip of tabs. */
        .add-list {
          width: auto;
          flex: 0 0 auto;
          margin-top: 0;
        }
        /* One control per line, which is the whole point of the breakpoint. */
        .pair {
          grid-template-columns: minmax(0, 1fr);
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
    (s) => [s.aiSettingsOpen, s.registry, s.splitDoubleBreaks] as const,
    shallowArrayEquals,
  );

  protected modal = new ModalController(this, { initialFocus: '.close' });

  /** What a provider needs before it can be tested or saved. See `form-errors.ts`. */
  protected providerForm = new FormErrors(this, () => {
    const set = this.#currentOrNull();
    return set ? this.#issuesFor(set) : [];
  });

  /**
   * The settings as they will be once saved. Nothing in here reaches the editor until Save.
   *
   * Taken from the editor when the dialog opens, and taken again whenever the editor changes while
   * nothing here has been touched — so a provider the dev server reports a moment after opening
   * still shows up, but an edit in progress is never overwritten by one.
   */
  @state() private draft: SettingsDraft | null = null;
  /** What the draft was taken from: tells an edit from no edit, and a removal from a newcomer. */
  #baseline: SettingsDraft | null = null;
  /** Stored keys to forget on Save, by provider id. */
  @state() private forget: ReadonlySet<string> = new Set();

  override willUpdate(): void {
    if (!this.state.value.aiSettingsOpen) {
      this.draft = null;
      this.#baseline = null;
      return;
    }
    if (this.draft && this.#dirty) return;
    const now = this.#snapshot();
    if (this.draft && sameDraft(now, this.#baseline)) return;
    this.#baseline = now;
    this.draft = cloneDraft(now);
  }

  #snapshot(): SettingsDraft {
    return {
      sets: this.editor.ai.list().map((set) => ({ ...set })),
      split: this.editor.settings.value.splitDoubleBreaks,
    };
  }

  /** Whether Save would change anything. */
  get #dirty(): boolean {
    if (!this.draft || !this.#baseline) return false;
    return (
      !sameDraft(this.draft, this.#baseline) ||
      this.forget.size > 0 ||
      Object.values(this.keyDraft).some((key) => key.trim())
    );
  }

  #sets(): AiProviderSet[] {
    return this.draft?.sets ?? [];
  }

  #setDraft(next: Partial<SettingsDraft>): void {
    if (this.draft) this.draft = { ...this.draft, ...next };
  }

  #updateSet(id: string, next: Partial<AiProviderSet>): void {
    this.#setDraft({ sets: this.#sets().map((one) => (one.id === id ? { ...one, ...next } : one)) });
  }

  #currentOrNull(): AiProviderSet | null {
    const sets = this.#sets();
    return sets.length ? this.#current(sets) : null;
  }

  /**
   * Whether a request could be made with this provider once the draft is saved.
   *
   * A key typed here counts, and a key marked to be forgotten does not, so the list and the badge
   * describe what Save will produce rather than what the vault holds right now.
   */
  #hasKey(set: AiProviderSet): boolean {
    if (set.transport !== 'in-page') return this.editor.ai.ready(set);
    if ((this.keyDraft[set.id] ?? '').trim()) return true;
    if (this.forget.has(set.id)) return false;
    return this.editor.ai.ready(set);
  }

  #issuesFor(set: AiProviderSet): FieldIssue[] {
    const issues: FieldIssue[] = [];
    if (!set.label.trim()) issues.push({ field: 'ai-name', message: 'Give the provider a name.' });
    if (set.transport !== 'proxy' && !(set.baseURL ?? '').trim()) {
      issues.push({ field: 'ai-base', message: 'Type the address requests go to.' });
    }
    if (!set.model.trim()) issues.push({ field: 'ai-model', message: 'Type the model to use, as the provider names it.' });
    return issues;
  }

  /** Which set is expanded. One at a time: these are long forms and two open is a wall. */
  @state() private openId: string | null = null;
  /** Key drafts, per set. Never read back out of the vault — see `keys.ts`. */
  @state() private keyDraft: Record<string, string> = {};
  /**
   * Whether to keep a key past the tab, per set, once the user has said.
   *
   * Undefined means "not chosen here", and the control then shows where the key already lives —
   * see `#renderKeyField`. A plain boolean default would have this component asserting a fact it
   * does not own.
   */
  @state() private remember: Record<string, boolean | undefined> = {};
  @state() private testing: string | null = null;
  @state() private verdict: Record<string, { ok: boolean; text: string }> = {};

  override render(): TemplateResult | typeof nothing {
    if (!this.state.value.aiSettingsOpen || !this.draft) return nothing;
    const sets = this.draft.sets;
    const dirty = this.#dirty;

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="heo-settings-title"
      @pointerdown=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.#cancel();
      }}
    >
      <header>
        <div class="body">
          <h2 id="heo-settings-title">Settings</h2>
          <p>How the editor behaves on this page, and which AI models it can use.</p>
        </div>
        <button
          class="btn icon ghost close"
          type="button"
          aria-label="Close"
          @click=${() => this.#cancel()}
        >
          ${icon('close', 14)}
        </button>
      </header>

      <div class="sections">
        <section class="section" aria-labelledby="heo-settings-editing">
          <div class="section-head">
            <h3 id="heo-settings-editing">Editing</h3>
          </div>
          <label class="setting card">
            <input
              type="checkbox"
              .checked=${this.draft.split}
              @change=${(event: Event) =>
        this.#setDraft({ split: (event.target as HTMLInputElement).checked })}
            />
            <span>
              <span class="name">Split automatically at double line breaks</span>
              <span class="desc">
                Two line breaks in a row inside a paragraph, a heading or any text element become
                two separate elements — including the ones already in the page. Saved with the
                page.
              </span>
            </span>
          </label>
        </section>

        <section class="section providers" aria-labelledby="heo-settings-ai">
          <div class="section-head">
            <h3 id="heo-settings-ai">AI providers</h3>
            <p>
              Bring your own model. The first in the list is the default, and Promote moves one to
              the top. Each one carries its own rules about what it may change.
            </p>
          </div>
          <div class="card providers-card">
            ${sets.length
        ? html`<div class=${`split${sets.length === 1 ? ' solo' : ''}`}>
                  <div class="list" role="tablist" aria-label="Providers">
                    ${sets.map((set, index) => this.#renderRow(set, index))}
                    ${this.#renderAdd('list')}
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
                    server. Or add a provider to use a local model or your own key.
                  </p>
                  <div class="empty-acts">${this.#renderAdd('empty')}</div>
                </div>`}
          </div>
        </section>
      </div>

      <footer>
        ${dirty
        ? html`<span class="unsaved" role="status">Unsaved changes</span>`
        : html`<span class="quiet">Changes apply when you save them.</span>`}
        <span class="spacer"></span>
        <button class="btn sm" type="button" @click=${() => this.#cancel()}>Cancel</button>
        <button class="btn sm primary" type="button" @click=${() => void this.#save()}>
          ${icon('check', 12)} Save settings
        </button>
      </footer>
    </div>`;
  }

  /**
   * Add a provider, inside the providers section rather than in the dialog's footer.
   *
   * Beside the list when there is one, so it reads as "another row"; in the action line of the
   * only provider when there is just one; centred under the explanation when there are none.
   */
  #renderAdd(where: 'list' | 'acts' | 'empty'): TemplateResult {
    return html`<button
      class=${`btn sm add add-${where}`}
      type="button"
      @click=${() => this.#add()}
    >
      ${icon('plus', 12)} ${where === 'acts' ? 'Add another provider' : 'Add a provider'}
    </button>`;
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
    const chosen = this.#current(this.#sets()).id === set.id;
    const needsKey = !this.#hasKey(set);
    const tone = needsKey ? 'needs' : set.transport === 'in-page' ? 'exposed' : 'safe';
    return html`<button
      class="tab"
      type="button"
      role="tab"
      aria-current=${chosen ? 'true' : 'false'}
      @click=${() => {
        if (this.openId === set.id) return;
        this.openId = set.id;
        // The errors on screen were about the provider being left.
        this.providerForm.reset();
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
    const needsKey = !this.#hasKey(set);
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
      this.#updateSet(set.id, next);
      // A changed destination invalidates whatever the last test proved.
      this.verdict = { ...this.verdict, [set.id]: undefined as never };
    };
    /** The set as it stands, for a handler that needs to read a field before writing another. */
    const live = (): AiProviderSet => this.#sets().find((one) => one.id === set.id) ?? set;

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
                @click=${() => this.#promote(set.id)}
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
        <span>Name <span class="required">(required)</span></span>
        <input
          ${field(this.providerForm, 'ai-name', { required: true })}
          class="input"
          .value=${set.label}
          @change=${(event: Event) => patch({ label: (event.target as HTMLInputElement).value })}
        />
      </label>
      ${this.providerForm.error('ai-name')}

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
            <span>Base URL <span class="required">(required)</span></span>
            <input
              ${field(this.providerForm, 'ai-base', { required: true })}
              class="input"
              .value=${set.baseURL ?? ''}
              placeholder=${DEFAULT_BASE_URL[set.provider] || 'http://127.0.0.1:11434/v1'}
              @change=${(event: Event) =>
            patch({ baseURL: (event.target as HTMLInputElement).value })}
            />
          </label>
          ${this.providerForm.error('ai-base')}`}

      <label class="field">
        <span>Model <span class="required">(required)</span></span>
        <input
          ${field(this.providerForm, 'ai-model', { required: true })}
          class="input"
          .value=${set.model}
          placeholder="gpt-4o-mini"
          @change=${(event: Event) => patch({ model: (event.target as HTMLInputElement).value })}
        />
      </label>
      ${this.providerForm.error('ai-model')}

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
        No scope section here.

        What the AI may change is decided per request, on the chips beside the prompt, not per
        provider. It lived here and was wrong in two ways: it travelled in the design-system seed,
        so somebody else's document arrived deciding what the AI could do to your page; and having
        a standing permission meant it needed an "ask me" state, which then interrupted to ask
        about something the user had set moments earlier.
      -->
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
        ${sets.length === 1 ? this.#renderAdd('acts') : nothing}
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
    /*
     * The box shows where the key actually is, not where a draft says to put it.
     *
     * `this.remember` is component state that starts empty, so on a fresh render — after a reload,
     * say — it read false for a key that was in fact saved on this machine. The heading beside it
     * said "remembered", from the vault, so the panel contradicted itself. The vault is the fact;
     * the draft only speaks once the user has touched the control.
     */
    const stored = this.editor.ai.keyStatus(set.id);
    const remember = this.remember[set.id] ?? stored.persistence === 'origin';
    const forgetting = this.forget.has(set.id);
    const current = forgetting ? undefined : hint;
    return html`<div class="field">
      <label for=${`heo-ai-key-${set.id}`}>
        <span>API key${current ? ` — currently ends ${current}` : ''}</span>
      </label>
      <input
        id=${`heo-ai-key-${set.id}`}
        class="input"
        type="password"
        autocomplete="current-password"
        name=${`heo-ai-key-${set.id}`}
        .value=${draft}
        placeholder=${current ? '•••••••• (unchanged)' : 'sk-…'}
        @input=${(event: Event) => {
        this.keyDraft = { ...this.keyDraft, [set.id]: (event.target as HTMLInputElement).value };
        this.verdict = { ...this.verdict, [set.id]: undefined as never };
      }}
      />
      ${draft.trim()
        ? html`<span class="key-note">
            ${current ? 'Replaces the current key when you save.' : 'Stored when you save.'}
          </span>`
        : nothing}
      <div class="acts">
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
        ${forgetting
        ? html`<span class="key-note">Forgotten when you save.</span>
              <button class="btn sm" type="button" @click=${() => this.#keepKey(set.id)}>
                Keep it
              </button>`
        : hint
          ? html`<button
                class="btn sm danger"
                type="button"
                title="Forget this key everywhere it is stored, when you save"
                @click=${() => {
              this.forget = new Set([...this.forget, set.id]);
            }}
              >
                ${icon('unlink', 12)} Forget key
              </button>`
          : nothing}
      </div>
      ${refusal ? html`<span class="verdict">${refusal}</span>` : nothing}
    </div>`;
  }

  #keepKey(id: string): void {
    const next = new Set(this.forget);
    next.delete(id);
    this.forget = next;
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
    this.#setDraft({
      sets: [
        ...this.#sets(),
        {
          id,
          label: 'New provider',
          transport: 'local',
          provider: 'openai-compatible',
          baseURL: 'http://127.0.0.1:11434/v1',
          model: '',
        },
      ],
    });
    this.openId = id;
    this.providerForm.reset();
  }

  /** Take a provider out of the draft. Nothing is lost until Save, so there is nothing to confirm. */
  #remove(set: AiProviderSet): void {
    this.#setDraft({ sets: this.#sets().filter((one) => one.id !== set.id) });
    const { [set.id]: _typed, ...keys } = this.keyDraft;
    this.keyDraft = keys;
    this.#keepKey(set.id);
    if (this.openId === set.id) this.openId = null;
    this.providerForm.reset();
  }

  /** First in the list is the default. */
  #promote(id: string): void {
    const sets = this.#sets();
    const moving = sets.find((one) => one.id === id);
    if (!moving) return;
    this.#setDraft({ sets: [moving, ...sets.filter((one) => one.id !== id)] });
  }

  /**
   * Close, discarding the draft — after asking, when there is something to lose.
   */
  #cancel(): void {
    if (!this.#dirty) {
      this.editor.setAiSettings(false);
      return;
    }
    this.editor.askToConfirm({
      title: 'Discard your changes?',
      message: 'Nothing you changed in Settings has been saved yet.',
      confirmLabel: 'Discard changes',
      dismissLabel: 'Keep editing',
      tone: 'warn',
      reversible: false,
      run: () => this.editor.setAiSettings(false),
    });
  }

  /**
   * Apply the draft, then close.
   *
   * Every provider is checked, not only the one on screen: an incomplete one elsewhere in the list
   * is opened and its first problem shown, the same way a form takes the user to a field. Then the
   * difference is written — removals, edits, order, keys, and the editing setting last, because it
   * may split the page and says so in its own message.
   */
  async #save(): Promise<void> {
    const draft = this.draft;
    const before = this.#baseline;
    if (!draft || !before) return;
    if (!this.#dirty) {
      this.editor.setAiSettings(false);
      return;
    }

    const incomplete = draft.sets.find((set) => this.#issuesFor(set).length);
    if (incomplete) {
      if (this.#current(draft.sets).id !== incomplete.id) {
        this.openId = incomplete.id;
        this.providerForm.reset();
        await this.updateComplete;
      }
      this.providerForm.submit();
      return;
    }

    const ai = this.editor.ai;
    const kept = new Set(draft.sets.map((set) => set.id));
    for (const set of before.sets) {
      if (kept.has(set.id)) continue;
      ai.clearKey(set.id);
      ai.remove(set.id);
    }
    for (const set of draft.sets) {
      const was = before.sets.find((one) => one.id === set.id);
      if (!was || JSON.stringify(was) !== JSON.stringify(set)) ai.upsert(set);
    }
    const order = draft.sets.map((set) => set.id).join('|');
    if (order !== before.sets.filter((set) => kept.has(set.id)).map((set) => set.id).join('|')) {
      draft.sets.forEach((set, index) => ai.reorder(set.id, index));
    }

    const notes: string[] = [];
    for (const id of this.forget) if (kept.has(id)) ai.clearKey(id);
    for (const set of draft.sets) {
      const key = (this.keyDraft[set.id] ?? '').trim();
      if (!key || set.transport !== 'in-page') continue;
      // The same resolution the checkbox draws itself from: the draft if there is one, else where
      // the key already lives. Reading only the draft made saving a second key quietly downgrade it.
      const keep = this.remember[set.id] ?? ai.keyStatus(set.id).persistence === 'origin';
      const result = await ai.setKey(set.id, key, keep ? 'origin' : 'session');
      if (result.refused) {
        // Not remembered, but not lost: held for this tab, and said why.
        await ai.setKey(set.id, key, 'session');
        notes.push(`${set.label}: ${result.refused} The key is held until this tab closes.`);
      }
    }
    // Dropped the moment the vault has them, so the only copy is the one in the vault's closure.
    this.keyDraft = {};
    this.forget = new Set();

    const splitChanged = draft.split !== this.editor.settings.value.splitDoubleBreaks;
    this.editor.setAiSettings(false);
    // Its own message, with Undo and a count of what was split, says more than "saved" would.
    if (splitChanged) this.editor.setSplitDoubleBreaks(draft.split);
    if (notes.length) this.editor.notify(notes.join(' '), 'warn');
    else if (!splitChanged) this.editor.notify('Settings saved.', 'success');
  }

  /**
   * Ask the provider for one operation, and report what came back.
   *
   * A real request rather than a reachability probe. A host that answers and a model name that
   * does not exist is the most common misconfiguration by a distance, and a ping would call it
   * healthy — so the test succeeds only on a reply this editor could actually use.
   *
   * Tests the provider as it is drafted, key included. A key typed but not saved is lent to the
   * vault for the request alone, in memory, under an id of its own, and taken back afterwards; a
   * key marked to be forgotten is left out.
   */
  async #test(set: AiProviderSet): Promise<void> {
    if (!this.providerForm.submit()) return;
    this.testing = set.id;
    this.verdict = { ...this.verdict, [set.id]: undefined as never };
    const typed = (this.keyDraft[set.id] ?? '').trim();
    const borrowed = set.transport === 'in-page' && typed ? `${set.id}::test` : null;
    const probe =
      borrowed ? { ...set, id: borrowed }
        : set.transport === 'in-page' && this.forget.has(set.id) ? { ...set, id: `${set.id}::forgotten` }
          : set;
    try {
      if (borrowed) await this.editor.ai.setKey(borrowed, typed, 'none');
      const transport =
        this.editor.options.aiTransport ??
        createTransport(this.editor.project?.aiEndpoint?.() ?? null);
      const result = await testTransport(transport, probe);
      this.verdict = {
        ...this.verdict,
        [set.id]: result.ok
          ? { ok: true, text: 'Connected.' }
          : { ok: false, text: result.reason },
      };
    } finally {
      if (borrowed) this.editor.ai.clearKey(borrowed);
      this.testing = null;
    }
  }
}

/** What the dialog edits: the providers in priority order, and the editing setting. */
interface SettingsDraft {
  sets: AiProviderSet[];
  split: boolean;
}

function cloneDraft(draft: SettingsDraft): SettingsDraft {
  return { sets: draft.sets.map((set) => structuredClone(set)), split: draft.split };
}

function sameDraft(a: SettingsDraft | null, b: SettingsDraft | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-ai-settings': HeoAiSettings;
  }
}
