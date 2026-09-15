import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { labelFor, visualBox } from '../../core/dom.js';
import type { RunOutcome } from '../../core/ai/session.js';
import { AI_CONTEXT_LABELS, AI_QUICK_ACTIONS, describeTransport } from '../../core/ai/types.js';
import { listen, unlisten } from '../../core/shield.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { anchoredStyle, PopoverPlacer } from '../place.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * Editing one element by describing the change.
 *
 * Anchored to the element rather than parked in the dock, and that placement is the feature: the
 * thing being changed and the sentence describing it are in the same glance, so "make this
 * quieter" has an unambiguous *this*. A prompt box in a side panel would need the user to hold
 * the selection in their head.
 *
 * Three states, and the transitions between them are most of the design.
 *
 * **Nothing configured.** The default, and it stays the default: an editor that shipped with a
 * model attached would send somebody's page somewhere without being asked. So the empty state
 * explains what the feature does and offers the one action that turns it on.
 *
 * **Ready.** An input, and under it the controls that decide what a request means — which
 * provider, and what it is allowed to touch. Both are one click from the prompt because both
 * change the answer.
 *
 * **Afterwards.** The run's own account of itself: what it did, what it declined, and what
 * reached past this element. That last part is why the transcript exists rather than a toast —
 * "`.card` changed, 12 elements use it" is a thing to read and decide about, and a toast is a
 * thing that disappears.
 */
@customElement('heo-ai-menu')
export class HeoAiMenu extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        z-index: 16;
        pointer-events: auto;
      }
      /*
       * Positioned itself, because the placement is written onto it.
       *
       * The host is fixed with no offsets, so it collapses to a zero-size box at its static
       * position at the top of the overlay. Without a position here the top and left the placer
       * computes have nothing to apply to, and the popover renders in the corner of the page —
       * which is exactly what it did.
       */
      .pop {
        position: fixed;
        display: flex;
        flex-direction: column;
        width: 320px;
        max-height: min(70vh, 460px);
        border-radius: var(--heo-r-md);
        overflow: hidden;
        animation: in var(--heo-fast);
      }
      @keyframes in {
        from {
          opacity: 0;
          transform: translateY(-3px);
        }
      }

      header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 9px 10px 0;
        color: var(--heo-text-dim);
        font-size: 10.5px;
      }
      header .who {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        color: var(--heo-accent);
        font-family: var(--heo-mono);
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      header .spacer {
        flex: 1 1 auto;
      }

      form {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 8px 10px 10px;
      }
      textarea {
        width: 100%;
        min-height: 56px;
        max-height: 160px;
        padding: 7px 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font: inherit;
        font-size: 11.5px;
        line-height: 1.5;
        resize: vertical;
      }
      textarea:focus-visible {
        border-color: var(--heo-accent-line);
        outline: none;
      }
      textarea::placeholder {
        color: var(--heo-text-faint);
      }

      /* The row under the input: settings, provider, send. Everything that decides what
         pressing Send means, in the order it is decided in. */
      .row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .row .spacer {
        flex: 1 1 auto;
      }
      select {
        max-width: 132px;
        padding: 3px 5px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font: inherit;
        font-size: 10.5px;
      }

      /*
       * The one-press requests.
       *
       * Squarer and slightly larger than the scope chips below, because they do something rather
       * than describe something — two rows of identical pills either side of the box would read
       * as one control with eight settings.
       */
      .quick {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .chip {
        padding: 3px 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        box-shadow: var(--heo-inset);
        color: var(--heo-text-dim);
        font: inherit;
        font-size: 10.5px;
        white-space: nowrap;
        cursor: pointer;
        transition:
          background var(--heo-fast),
          color var(--heo-fast),
          border-color var(--heo-fast);
      }
      .chip:hover:not(:disabled) {
        border-color: var(--heo-accent-line);
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .chip:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .scopes {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      /*
       * What the request describes, as switches over the bundle.
       *
       * A button rather than a checkbox and a label, because at this size a native control plus
       * its text is three times the ink for the same one-bit answer — and these have to sit four
       * to a 320px row without becoming a second paragraph.
       */
      .scope {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 7px 2px 5px;
        border: 1px solid var(--heo-line);
        border-radius: 999px;
        background: transparent;
        color: var(--heo-text-faint);
        font: inherit;
        font-size: 9.5px;
        white-space: nowrap;
        cursor: pointer;
        transition:
          background var(--heo-fast),
          border-color var(--heo-fast),
          color var(--heo-fast);
      }
      .scope:hover:not(:disabled):not(.fixed) {
        border-color: var(--heo-line-strong);
        color: var(--heo-text);
      }
      .scope:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .scope.on {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-accent);
      }
      /* The element is always sent, so its chip is a statement and does not invite a press. */
      .scope.fixed {
        cursor: default;
      }
      /*
       * Sent, but this provider may not change it.
       *
       * Worth its own treatment rather than only a tooltip: it is the one combination where the
       * model will confidently describe an edit that is then refused, and the warn colour is the
       * same one the transcript uses for a side effect.
       */
      .scope.mismatch {
        border-color: var(--heo-warn);
        background: color-mix(in oklab, var(--heo-warn) 10%, transparent);
        color: var(--heo-warn);
      }

      /* The empty state. Deliberately the largest thing in the popover when it applies. */
      .intro {
        padding: 4px 10px 12px;
      }
      .intro h3 {
        margin: 4px 0 5px;
        font-size: 12.5px;
        font-weight: 600;
      }
      .intro p {
        margin: 0 0 10px;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.55;
      }

      .log {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 0 10px 10px;
        overflow-y: auto;
      }
      .said {
        margin: 0 0 3px;
        color: var(--heo-text);
        font-size: 11.5px;
        line-height: 1.5;
      }
      .entry {
        display: flex;
        align-items: flex-start;
        gap: 5px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .entry .g {
        flex: 0 0 auto;
        margin-top: 2px;
      }
      .entry.done .g {
        color: var(--heo-ok, var(--heo-accent));
      }
      .entry.skipped .g,
      .entry.refused .g {
        color: var(--heo-text-faint);
      }
      /* A side effect is the one line here somebody has to act on, so it is the one line
         that does not look like the others. */
      .caveat {
        display: flex;
        align-items: flex-start;
        gap: 5px;
        padding: 5px 7px;
        border: 1px solid color-mix(in oklab, var(--heo-warn) 40%, transparent);
        border-radius: var(--heo-r-sm);
        background: color-mix(in oklab, var(--heo-warn) 9%, transparent);
        color: var(--heo-text);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .caveat .g {
        flex: 0 0 auto;
        margin-top: 1px;
        color: var(--heo-warn);
      }
      .note {
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.5;
      }
      .undo {
        align-self: flex-start;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) =>
      [
        s.selected,
        s.aiMenuOpen,
        s.aiSettingsOpen,
        s.aiOutcome,
        s.aiBusy,
        // A fresh object per change, so reference comparison in the slice is enough. Omitting it
        // is the bug that made the menu render stale — see the note on the overlay root's slice.
        s.aiContextScope,
        s.geometry,
        s.registry,
      ] as const,
    shallowArrayEquals,
  );

  @state() private draft = '';
  /** Where the popover sits, written from `updated` once its real height is known. */
  @state() private popStyle = '';

  @query('textarea') private field?: HTMLTextAreaElement;

  /**
   * Placed from a measurement, not an estimate.
   *
   * The first version placed once during render with an assumed height, and the assumption was
   * wrong in the case that matters: an element low on the page has no room below it, so the
   * popover flips above — and flipping above from a guessed height put it off the top of the
   * viewport. The shared placer measures the content once per change and repositions without
   * re-reading, which is what keeps this out of the read-write-read loop that shape invites.
   */
  readonly #placer = new PopoverPlacer();

  override connectedCallback(): void {
    super.connectedCallback();
    // Anywhere outside puts it away, which is what a popover anchored to a page element has to
    // do — there is no scrim to click, and the page behind it is still live.
    listen(document, 'pointerdown', this.#outside, true);
    listen(document, 'keydown', this.#key, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(document, 'pointerdown', this.#outside, true);
    unlisten(document, 'keydown', this.#key, true);
  }

  override firstUpdated(): void {
    // Focus lands in the input, because there is exactly one thing to do here and it is typing.
    this.field?.focus({ preventScroll: true });
  }

  override updated(changed: Map<string, unknown>): void {
    // The transcript arriving changes the height, so the measurement has to be retaken — a run
    // that adds four lines to the popover would otherwise overflow the box it was placed in.
    if (changed.has('draft') || changed.has('state')) this.#placer.invalidate();
    this.#position();
  }

  #position(): void {
    const selected = this.state.value.selected;
    if (!selected?.isConnected) return;
    const box = visualBox(selected);
    const style = this.#placer.style(this.renderRoot.querySelector<HTMLElement>('.pop'), {
      anchor: new DOMRect(box.left, box.top, box.width, box.height),
      minWidth: 320,
      estimate: 220,
    });
    if (style !== null) this.popStyle = style;
  }

  #outside = (event: Event): void => {
    if (event.composedPath().includes(this)) return;
    // The settings dialog is modal and lives elsewhere in the tree; a click in it must not be
    // read as a click away from this.
    if (this.state.value.aiSettingsOpen) return;
    this.editor.setAiMenu(false);
  };

  #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.state.value.aiSettingsOpen) return;
    /*
     * Escape stops a run before it closes the menu.
     *
     * Two things to cancel and one key, so the more urgent wins: a request in flight is
     * spending money and changing the page, and closing the popover would leave it doing both
     * with nothing on screen to stop it.
     */
    event.stopPropagation();
    event.preventDefault();
    if (this.state.value.aiBusy) this.editor.stopAi();
    else this.editor.setAiMenu(false);
  };

  /**
   * Send a request.
   *
   * With no argument it sends what is in the box. A quick action passes its own sentence and it
   * becomes the draft first, deliberately: the box then shows what was actually asked, so the
   * result can be read against the request and the sentence can be edited and sent again. A
   * quick action that sent something invisible would make its own outcome unaccountable.
   */
  #send(prompt?: string): void {
    if (this.state.value.aiBusy) return;
    if (prompt !== undefined) this.draft = prompt;
    const asked = (prompt ?? this.draft).trim();
    if (!asked) return;
    // Kept, not cleared: a request that comes back with nothing useful is one the user wants to
    // rephrase rather than retype.
    void this.editor.promptAi(asked);
  }

  override render(): TemplateResult | typeof nothing {
    const { selected, aiMenuOpen } = this.state.value;
    if (!aiMenuOpen || !selected?.isConnected) return nothing;

    /*
     * The first paint uses an estimate; `updated` replaces it with a measurement.
     *
     * Two passes rather than one because the popover does not exist until it renders, which is
     * the same reason every other popover here places twice.
     */
    const box = visualBox(selected);
    const style =
      this.popStyle ||
      anchoredStyle({
        anchor: new DOMRect(box.left, box.top, box.width, box.height),
        minWidth: 320,
        estimate: 220,
      });

    /*
     * The settings are deliberately *not* rendered here.
     *
     * They were, and it was wrong twice over. This popover is a fixed box with
     * `overflow: hidden`, so a full-screen dialog nested inside it is clipped to 320px and
     * positioned against the popover rather than the viewport — which is exactly what it looked
     * like: a modal squeezed into the corner of a popover. And it is the wrong relationship
     * anyway. Configuring a provider is a task of its own, not a step inside this prompt, so it
     * belongs at the overlay root beside every other dialog. See `overlay-root`.
     */
    return html`<div class="pop surface" style=${style} @pointerdown=${(e: Event) => e.stopPropagation()}>
      ${this.editor.ai.configured ? this.#renderReady(selected) : this.#renderIntro()}
    </div>`;
  }

  /**
   * Before a model is connected.
   *
   * Says what the feature does and what it costs, then offers the single next step. The sentence
   * about nothing being sent is there because "AI" in a page editor raises that question
   * immediately, and answering it unprompted is cheaper than being asked.
   */
  #renderIntro(): TemplateResult {
    return html`<div class="intro">
      <h3>${icon('sparkle', 13)} Edit with words</h3>
      <p>
        Describe a change and it edits this element's text and styles. Bring your own model —
        nothing is sent anywhere until you set one up.
      </p>
      <button
        class="btn primary sm"
        type="button"
        @click=${() => this.editor.setAiSettings(true)}
      >
        ${icon('settings', 12)} Set up a model
      </button>
    </div>`;
  }

  #renderReady(el: HTMLElement): TemplateResult {
    const busy = this.state.value.aiBusy;
    const outcome = this.state.value.aiOutcome;
    const set = this.editor.ai.active;
    const sets = this.editor.ai.list();
    const status = set ? this.editor.ai.keyStatus(set.id) : null;
    const badge = set ? describeTransport(set, status?.persistence ?? 'none') : null;
    const missing = Boolean(set && !this.editor.ai.ready(set));

    return html`
      <header>
        ${icon('sparkle', 11)}
        <span>${labelFor(el)}</span>
        <span class="spacer"></span>
        ${badge
        ? html`<span class="who" title=${badge.detail}>${badge.badge}</span>`
        : nothing}
      </header>

      <form
        @submit=${(event: Event) => {
        event.preventDefault();
        this.#send();
      }}
      >
        <!--
          Above the box, not below it.

          These are an alternative to typing, so they belong where the eye arrives before the
          empty field rather than after it — below the textarea they read as things to do with
          what you have already written.
        -->
        <div class="quick" role="group" aria-label="Common requests">
          ${AI_QUICK_ACTIONS.map(
        (action) => html`<button
              class="chip"
              type="button"
              ?disabled=${busy || missing}
              title=${action.prompt}
              @click=${() => this.#send(action.prompt)}
            >
              ${action.label}
            </button>`,
      )}
        </div>

        <textarea
          .value=${this.draft}
          placeholder="Describe a change in text or style"
          aria-label="Describe a change in text or style"
          ?disabled=${busy}
          @input=${(event: Event) => {
        this.draft = (event.target as HTMLTextAreaElement).value;
      }}
          @keydown=${(event: KeyboardEvent) => {
        // Enter sends, Shift+Enter breaks the line. A prompt is usually one sentence, so
        // the common case is the one that costs no modifier.
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        this.#send();
      }}
        ></textarea>

        ${missing
        ? html`<p class="note">
              ${set?.label} needs an API key before it can be used.
              <button
                class="btn link sm"
                type="button"
                @click=${() => this.editor.setAiSettings(true)}
              >
                Add one
              </button>
            </p>`
        : nothing}

        <div class="row">
          <button
            class="btn icon ghost"
            type="button"
            aria-label="AI settings"
            title="Providers, keys and what the AI may change"
            @click=${() => this.editor.setAiSettings(true)}
          >
            ${icon('settings', 12)}
          </button>

          <!--
            Only with a choice to make.
            One provider and a dropdown holding it is a control that cannot do anything, and
            the badge in the header already says which one is in use.
          -->
          ${sets.length > 1
        ? html`<select
                aria-label="Provider"
                ?disabled=${busy}
                @change=${(event: Event) =>
            this.editor.ai.activate((event.target as HTMLSelectElement).value)}
              >
                ${sets.map(
              (one) => html`<option value=${one.id} ?selected=${one.id === set?.id}>
                      ${one.label}
                    </option>`,
            )}
              </select>`
        : nothing}

          <span class="spacer"></span>

          ${busy
        ? html`<button class="btn sm" type="button" @click=${() => this.editor.stopAi()}>
                ${icon('close', 11)} Stop
              </button>`
        : html`<button
                class="btn primary sm"
                type="submit"
                ?disabled=${!this.draft.trim() || missing}
              >
                ${icon('sparkle', 11)} Send
              </button>`}
        </div>

        ${this.#renderScopes()}
      </form>

      ${outcome ? this.#renderOutcome(outcome) : nothing}
    `;
  }

  /**
   * What the request describes, chosen at the moment of asking.
   *
   * These used to be read-only badges reporting the provider's *permissions*. They are now
   * switches over what the model is *shown*, which is a different question and the one that
   * belongs on this surface: permission is a standing decision about a provider and lives in the
   * settings, while "does this task need the cascade" changes with every sentence typed above.
   *
   * Minimal by default. Rewording a heading does not need twenty-four matched rules, and sending
   * them anyway costs tokens and hands a third party more of the page than the job required.
   *
   * The permission is still shown, as the chip's own subtitle when a scope is switched on and the
   * provider may not write it — that combination is worth knowing before pressing Send, and it is
   * the only place the two axes are visible together.
   */
  #renderScopes(): TemplateResult | typeof nothing {
    const set = this.editor.ai.active;
    if (!set) return nothing;
    const policy = this.editor.ai.policy(set);
    const include = this.state.value.aiContextScope;
    const busy = this.state.value.aiBusy;

    return html`<div class="scopes" role="group" aria-label="What the request describes">
      ${AI_CONTEXT_LABELS.map((entry) => {
      if (entry.key === 'element') {
        return html`<span class="scope on fixed" title=${entry.hint}>
            ${icon('check', 9)} ${entry.label}
          </span>`;
      }
      const key = entry.key;
      const on = include[key];
      const allowance = policy[key];
      /*
       * The two axes, in one tooltip, in the order they are decided.
       *
       * "Sent, but this provider may not change it" is a real and confusing state — the model
       * will describe an edit it is then refused — so it is said here rather than discovered in
       * the transcript afterwards.
       */
      const reach = !allowance
        ? ` ${set.label} may not change ${entry.label.toLowerCase()}.`
        : allowance === 'ask'
          ? ` You will be asked before ${entry.label.toLowerCase()} are changed.`
          : '';
      return html`<button
          class=${`scope${on ? ' on' : ''}${on && !allowance ? ' mismatch' : ''}`}
          type="button"
          role="switch"
          aria-checked=${on ? 'true' : 'false'}
          ?disabled=${busy}
          title=${`${entry.hint}${reach}`}
          @click=${() => this.editor.setAiContextScope(key, !on)}
        >
          ${on ? icon('check', 9) : icon('plus', 9)} ${entry.label}
        </button>`;
    })}
    </div>`;
  }

  /**
   * The run's account of itself.
   *
   * Ordered by what the reader needs: the summary, then anything that reached past this element,
   * then the itemised list. Side effects come before the detail because they are the part that
   * might need undoing, and burying them under six lines of "set padding" is how a shared class
   * gets changed without anybody noticing.
   */
  #renderOutcome(outcome: RunOutcome): TemplateResult {
    const glyph = { done: 'check', skipped: 'minus', refused: 'alert' } as const;
    return html`<div class="log">
      <p class="said">${outcome.summary}</p>

      ${outcome.warnings.map(
      (warning) => html`<span class="caveat">${icon('alert', 11)}<span>${warning}</span></span>`,
    )}

      ${outcome.entries.map(
      (entry) => html`<span class=${`entry ${entry.outcome}`}>
          <span class="g">${icon(glyph[entry.outcome], 10)}</span>
          <span>
            ${entry.text}
            ${(entry.notes ?? []).length
          ? html`<span class="note"> — ${(entry.notes ?? []).join('; ')}</span>`
          : nothing}
          </span>
        </span>`,
    )}

      ${outcome.applied
        ? html`<button
            class="btn sm undo"
            type="button"
            title="Take the whole run back in one step"
            @click=${() => {
            this.editor.undo();
            this.editor.setAiMenu(false);
          }}
          >
            ${icon('undo', 11)} Undo ${outcome.applied}
            change${outcome.applied === 1 ? '' : 's'}
          </button>`
        : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-ai-menu': HeoAiMenu;
  }
}
