import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { labelFor, visualBox } from '../../core/dom.js';
import type { RunOutcome } from '../../core/ai/session.js';
import { describeTransport } from '../../core/ai/types.js';
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

      .scopes {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      /* What this provider may reach, as facts rather than controls: changing them is a
         settings decision, and putting toggles here would invite doing it mid-thought. */
      .scope {
        padding: 1px 6px;
        border: 1px solid var(--heo-line);
        border-radius: 999px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        white-space: nowrap;
      }
      .scope.on {
        border-color: var(--heo-accent-line);
        color: var(--heo-accent);
      }
      .scope.ask {
        border-color: var(--heo-warn);
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

  #send(): void {
    const asked = this.draft.trim();
    if (!asked || this.state.value.aiBusy) return;
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
   * What this provider may reach, stated before a request rather than after.
   *
   * The permission is the most surprising thing about the feature — a request that edits a
   * shared class changes twelve other elements — so it is visible at the moment of asking. Shown
   * as facts and not switches on purpose: widening what a model may do is a settings decision,
   * and a toggle here would invite making it in the middle of a thought about copy.
   */
  #renderScopes(): TemplateResult | typeof nothing {
    const set = this.editor.ai.active;
    if (!set) return nothing;
    const policy = this.editor.ai.policy(set);
    const rows: TemplateResult[] = [];
    for (const [scope, label] of [
      ['classes', 'classes'],
      ['rules', 'CSS rules'],
      ['parent', 'parent'],
    ] as const) {
      const allowance = policy[scope];
      rows.push(
        html`<span
          class=${`scope${allowance === 'always' ? ' on' : allowance === 'ask' ? ' ask' : ''}`}
          title=${allowance === 'always'
            ? `${label} may be changed without asking`
            : allowance === 'ask'
              ? `You will be asked before ${label} are changed`
              : `${label} cannot be changed by this provider`}
        >
          ${allowance === 'ask' ? `${label}: ask` : allowance ? label : `no ${label}`}
        </span>`,
      );
    }
    return html`<div class="scopes">
      <span class="scope on">this element</span>
      ${rows}
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
