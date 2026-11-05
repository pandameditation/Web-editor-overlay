import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { MAX_CUSTOM_SIZES, MAX_VIEWPORT, MIN_VIEWPORT, iconForWidth } from '../../core/breakpoints.js';
import type { EditorEngine } from '../../core/editor.js';
import { sortViewports, type Viewport } from '../../core/viewports.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import './value-field.js';

/**
 * The viewport sizes, for editing: which ones the preview bar shows, and at which width.
 *
 * One row per size: its name, which ticks or unticks it for the bar, its width in px (typed, or
 * dragged by its gauge like a spacing), and for a size of the user's own a way to remove it. A size
 * taken from the page's CSS keeps the width its media query says, so it is shown and not editable.
 * "Add a viewport size…" adds one.
 *
 * Every change is kept as it is made, like any other edit: the bar follows at once, each change is
 * one undo step (a drag is one, however many widths it passes through), and the list is sorted by
 * width when a width is settled rather than while it is being dragged, so a row does not move from
 * under the pointer. The same panel in the preview bar's ⋮ and in Settings.
 *
 * Fires `viewports-layout` after each render, for a host that sizes a layer to it.
 */
@customElement('heo-viewport-sizes')
export class HeoViewportSizes extends LitElement {
  static override shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .list {
        display: grid;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .vp {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 112px 20px;
        align-items: center;
        gap: 7px;
        min-height: 34px;
        padding: 3px 2px;
        border-bottom: 1px solid var(--heo-line);
      }
      .vp:last-child {
        border-bottom: 0;
      }
      .vp input[type='checkbox'] {
        width: 13px;
        height: 13px;
        margin: 0;
        accent-color: var(--heo-accent);
      }
      .vp .pick {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        cursor: pointer;
      }
      .vp .pick svg {
        flex: 0 0 auto;
        color: var(--heo-text-dim);
      }
      /* A page size's width is its media query's, so it reads as a value rather than a field. */
      .vp .fixed {
        padding: 0 8px;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .vp .name {
        min-width: 0;
        overflow: hidden;
        color: var(--heo-text);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vp .name small {
        margin-left: 5px;
        color: var(--heo-text-dim);
        font-size: 10px;
      }
      /* Hidden from the bar: still listed, its width still editable, in a quieter ink. */
      .vp.off .name,
      .vp.off .pick svg {
        color: var(--heo-text-dim);
      }
      .vp .kill {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text-dim);
        cursor: pointer;
      }
      .vp .kill:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .vp .kill:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .err {
        grid-column: 1 / -1;
        margin: 0 0 3px;
        color: var(--heo-danger);
        font-size: 10.5px;
      }
      .add {
        display: grid;
        gap: 5px;
        padding: 7px 2px 2px;
      }
      .add .row {
        display: flex;
        gap: 5px;
      }
      .add .row .input {
        flex: 1 1 auto;
        min-width: 0;
      }
      .link {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 0;
        border: 0;
        background: transparent;
        color: var(--heo-text-dim);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .link:hover:not(:disabled) {
        color: var(--heo-text);
      }
      .link:disabled {
        color: var(--heo-text-disabled);
        cursor: not-allowed;
      }
      .link:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      details {
        margin-top: 8px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }
      details summary {
        cursor: pointer;
      }
      details ul {
        margin: 4px 0 0;
        padding-left: 16px;
      }
    `,
  ];

  @property({ attribute: false }) engine!: EditorEngine;
  /** The notes on what a preview cannot change, under the list. */
  @property({ type: Boolean }) limits = false;
  /** Shown in the limits: the selection sits in a shadow root, whose sheets keep the real width. */
  @property({ type: Boolean, attribute: 'in-shadow-root' }) inShadowRoot = false;

  /** The rows, in the order shown: the kept list, held in place while a width is being dragged. */
  @state() private draft: Viewport[] | null = null;
  /** A row's width problem, by key, until the row is edited again. */
  @state() private errors = new Map<string, string>();
  /** "Add a viewport size…" text while its field is open. */
  @state() private adding: string | null = null;
  @state() private addError = '';

  /** Set while this panel is the one changing the settings, so it does not re-read its own edit. */
  #writing = false;
  #unsubscribe: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.engine) this.#listen();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  override willUpdate(): void {
    if (this.engine && !this.#unsubscribe) this.#listen();
  }

  /*
   * After the host has placed its layer: the host renders first and this a frame later, so the
   * layer was measured holding nothing and capped at that height (measured: 132px for 334px).
   */
  override updated(): void {
    this.dispatchEvent(new CustomEvent('viewports-layout', { bubbles: true, composed: true }));
  }

  /** Read the list now, and again whenever the settings change from elsewhere (an undo). */
  #listen(): void {
    this.#reload();
    this.#unsubscribe = this.engine.settings.onChange(() => {
      if (!this.#writing) this.#reload();
    });
  }

  /** The kept list, by width. */
  #reload(): void {
    this.draft = this.engine.viewports();
  }

  /**
   * Keep a list. A width being dragged merges into one undo step under `merge`, and holds the rows
   * where they are; anything else re-reads the list, sorted.
   */
  #keep(next: Viewport[], options: { merge?: string; hold?: boolean } = {}): void {
    this.draft = next;
    this.#writing = true;
    try {
      this.engine.applyViewports(sortViewports(next), options.merge);
    } finally {
      this.#writing = false;
    }
    if (!options.hold) this.#reload();
  }

  #setError(key: string, message: string | null): void {
    const errors = new Map(this.errors);
    if (message) errors.set(key, message);
    else errors.delete(key);
    this.errors = errors;
  }

  #toggle(one: Viewport, shown: boolean): void {
    this.#keep((this.draft ?? []).map((other) => (other.key === one.key ? { ...other, shown } : other)));
  }

  /**
   * A typed or dragged width, in px. Kept as it changes while it is a width no other size has;
   * once settled (Enter, leaving the field), a width that is not one says so and goes back.
   */
  #setWidth(one: Viewport, text: string, settled: boolean): void {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(text);
    const px = match ? Math.round(Number(match[1])) : NaN;
    let problem: string | null = null;
    if (!Number.isInteger(px) || px < MIN_VIEWPORT || px > MAX_VIEWPORT) {
      problem = `Type a width between ${MIN_VIEWPORT} and ${MAX_VIEWPORT} pixels.`;
    } else if ((this.draft ?? []).some((other) => other.key !== one.key && other.width === px)) {
      problem = `${px}px is already in the list.`;
    }
    if (problem) {
      // A half-typed or passing width is not a mistake yet.
      if (!settled) return;
      this.#setError(one.key, problem);
      this.#reload();
      return;
    }
    this.#setError(one.key, null);
    const next = (this.draft ?? []).map((other) => (other.key === one.key
      ? { ...other, width: px, icon: other.origin === 'preset' ? other.icon : iconForWidth(px) }
      : other));
    this.#keep(next, { merge: `viewport-width:${one.key}`, hold: !settled });
  }

  #remove(one: Viewport): void {
    this.#setError(one.key, null);
    this.#keep((this.draft ?? []).filter((other) => other.key !== one.key));
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.add .link, .add input')?.focus());
  }

  #customCount(): number {
    return (this.draft ?? []).filter((one) => one.origin === 'custom').length;
  }

  #add(): void {
    const text = (this.adding ?? '').trim().replace(/px$/i, '').trim();
    const width = Number(text);
    if (!text || !Number.isInteger(width) || width < MIN_VIEWPORT || width > MAX_VIEWPORT) {
      this.addError = `Type a width between ${MIN_VIEWPORT} and ${MAX_VIEWPORT} pixels.`;
      return;
    }
    if ((this.draft ?? []).some((one) => one.width === width)) {
      this.addError = 'That size is already in the list.';
      return;
    }
    const key = `custom:${width}`;
    this.adding = null;
    this.addError = '';
    this.#keep([
      ...(this.draft ?? []),
      { key, origin: 'custom', base: width, width, shown: true, name: 'Custom', icon: iconForWidth(width) },
    ]);
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(`.vp[data-key="${CSS.escape(key)}"] input[type="checkbox"]`)?.focus());
  }

  #renderRow(one: Viewport): TemplateResult {
    const error = this.errors.get(one.key);
    const kind = one.origin === 'page' ? 'page' : one.origin === 'custom' ? 'yours' : '';
    return html`<li class=${`vp${one.shown ? '' : ' off'}`} data-key=${one.key} data-origin=${one.origin}>
      <!-- The whole name is the checkbox's label, so it ticks the size as the box does. -->
      <label
        class="pick"
        title=${one.media
        ? `Written in this page's CSS: @media ${one.media}`
        : one.origin === 'custom' ? 'Your own size: a preview width and a breakpoint' : one.name}
      >
        <input
          type="checkbox"
          .checked=${one.shown}
          @change=${(event: Event) => this.#toggle(one, (event.target as HTMLInputElement).checked)}
        />
        ${icon(one.icon, 12)}
        <span class="name">${one.name}${kind ? html`<small>${kind}</small>` : nothing}</span>
      </label>
      ${one.origin === 'page'
        ? html`<span class="fixed" title="The width its media query switches at">${one.width}px</span>`
        : html`<heo-value-field
            kind="length"
            fixed-unit="px"
            .value=${`${one.width}px`}
            .computed=${`${one.width}px`}
            field-label=${`${one.name} width`}
            @value-input=${(event: CustomEvent<{ value: string }>) => this.#setWidth(one, event.detail.value, false)}
            @value-change=${(event: CustomEvent<{ value: string }>) => this.#setWidth(one, event.detail.value, true)}
          ></heo-value-field>`}
      ${one.origin === 'custom'
        ? html`<button
            class="kill"
            type="button"
            aria-label=${`Remove the ${one.width}px size`}
            title="Remove this size, and its breakpoint"
            @click=${() => this.#remove(one)}
          >
            ${icon('trash', 11)}
          </button>`
        : html`<span></span>`}
      ${error ? html`<p class="err" role="alert">${error}</p>` : nothing}
    </li>`;
  }

  #renderAdd(): TemplateResult {
    const full = this.#customCount() >= MAX_CUSTOM_SIZES;
    if (this.adding === null) {
      return html`<div class="add">
        <button
          class="link"
          type="button"
          ?disabled=${full}
          title=${full ? `At most ${MAX_CUSTOM_SIZES} sizes of your own` : 'A size of your own: a preview width and a breakpoint'}
          @click=${() => {
          this.adding = '';
          void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.add input')?.focus());
        }}
        >
          ${icon('plus', 11)} Add a viewport size…
        </button>
      </div>`;
    }
    return html`<div class="add">
      <div class="row">
        <input
          class="input mono"
          type="text"
          inputmode="numeric"
          aria-label="New viewport width in pixels"
          aria-invalid=${this.addError ? 'true' : 'false'}
          placeholder="1280"
          autocomplete="off"
          .value=${this.adding}
          @input=${(event: Event) => {
        this.adding = (event.target as HTMLInputElement).value;
        this.addError = '';
      }}
          @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.#add();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.adding = null;
          this.addError = '';
          void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.add .link')?.focus());
        }
      }}
        />
        <button class="btn sm" type="button" @click=${() => this.#add()}>Add</button>
      </div>
      ${this.addError ? html`<p class="err" role="alert" style="grid-column:auto">${this.addError}</p>` : nothing}
    </div>`;
  }

  #renderLimits(): TemplateResult | typeof nothing {
    if (!this.limits) return nothing;
    const unreadable = this.engine.viewport.unreadableSheets;
    return html`<details>
      <summary>Where a preview is not reliable</summary>
      <ul>
        <li>Animations (@keyframes) keep vw at the real window's width.</li>
        <li>Page scripts see the real window: matchMedia, innerWidth, resize.</li>
        <li>Fixed elements still span the whole window.</li>
        <li>A size wider than the window is scaled to fit; page scripts measure it scaled.</li>
        <li>Images picked by &lt;picture&gt; or srcset don't change.</li>
        ${unreadable
        ? html`<li>${unreadable} stylesheet${unreadable === 1 ? '' : 's'} from another origin can't be previewed.</li>`
        : nothing}
        ${this.inShadowRoot ? html`<li>Styles inside this component's shadow root keep the real width.</li>` : nothing}
      </ul>
    </details>`;
  }

  override render(): TemplateResult {
    const draft = this.draft ?? [];
    return html`
      <ul class="list" aria-label="Viewport sizes">
        ${repeat(draft, (one) => one.key, (one) => this.#renderRow(one))}
      </ul>
      ${this.#renderAdd()}
      ${this.#renderLimits()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-viewport-sizes': HeoViewportSizes;
  }
}
