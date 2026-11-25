import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

export interface SegmentOption {
  value: string;
  label?: string;
  /** Icon name from the overlay icon set. */
  icon?: string;
  title?: string;
  /**
   * The accessible name, when the visible label is not enough.
   *
   * An icon-only option ("Phone") or a short one ("320") reads as nothing or as a bare number to a
   * screen reader; the preview bar says "Phone, 320px".
   */
  ariaLabel?: string;
}

/**
 * Segmented control for properties with a handful of options.
 *
 * Used wherever a dropdown would be a worse fit: `flex-direction`,
 * `text-align`, `object-fit`. Seeing every option at once, one click away, beats
 * a select for values a designer toggles repeatedly.
 *
 * Fires `segment-change` with `{ value }`. Clicking the active option clears it
 * when `clearable` is set, which is how "no override" is expressed.
 *
 * `removable` adds a visible ✕ at the end, the same one a value field shows when it holds a value.
 * Clicking the active option again was the only way to remove a property drawn as segments, and
 * nothing on screen said so — the rows beside it all had a ✕ and this one appeared to have none.
 */
@customElement('heo-segmented')
export class HeoSegmented extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        padding: 2px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        gap: 2px;
      }
      /* Inline row rather than a grid: an option may carry an icon, a label, or
         both, and a single-column grid stacked the two into a 22px box and clipped
         them. */
      /* The segments: the bar's buttons only, never the toggle's own, which these sized 28px tall. */
      .bar button {
        flex: 1 1 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 0;
        height: 22px;
        padding: 0 6px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        transition:
          background var(--heo-fast),
          color var(--heo-fast);
      }
      /* More options than fit on one line: they wrap onto the next, each at its natural width,
         rather than squeezing every label to an ellipsis. */
      .bar.wrap {
        flex-wrap: wrap;
      }
      .bar.wrap button {
        flex: 1 0 auto;
      }
      .bar button:disabled {
        color: var(--heo-text-disabled);
        cursor: not-allowed;
      }
      .bar button:hover:not(:disabled) {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .bar button[aria-pressed='true'] {
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-sm);
        color: var(--heo-text);
      }
      .bar button[aria-pressed='true'].accent {
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      /* The larger size, for a switch between views: taller, its icons in the accent when picked. */
      :host([size='lg']) .bar {
        padding: 3px;
        gap: 3px;
        border-radius: 9px;
      }
      :host([size='lg']) .bar button {
        gap: 7px;
        height: 28px;
        border-radius: 6px;
        color: var(--heo-text-dim);
        font-size: 11.5px;
      }
      :host([size='lg']) .bar button[aria-pressed='true'] svg {
        color: var(--heo-accent-text);
      }
      /*
       * Toggle: two options drawn as the large tabs, but one control. A press anywhere on it picks
       * the other option, so the whole bar is the target and not only the half that is not picked;
       * the raised thumb springs across and squashes on the way, which says what changed.
       */
      .flip {
        all: unset;
        position: relative;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
        width: 100%;
        box-sizing: border-box;
        padding: 3px;
        border: 1px solid var(--heo-line);
        border-radius: 9px;
        background: var(--heo-sunken);
        cursor: pointer;
        isolation: isolate;
        -webkit-tap-highlight-color: transparent;
      }
      .flip:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 2px;
      }
      .flip .thumb {
        position: absolute;
        z-index: 0;
        top: 3px;
        bottom: 3px;
        left: 3px;
        width: calc((100% - 9px) / 2);
        border-radius: 6px;
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-sm), inset 0 0 0 1px var(--heo-line-strong);
        transition: translate 460ms cubic-bezier(0.34, 1.45, 0.5, 1);
      }
      .flip[aria-checked='true'] .thumb {
        translate: calc(100% + 3px) 0;
      }
      .flip .opt {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 0;
        height: 28px;
        padding: 0 6px;
        border-radius: 6px;
        color: var(--heo-text-dim);
        font-size: 11.5px;
        white-space: nowrap;
        transition: color var(--heo-med), background var(--heo-fast);
      }
      .flip .opt.on {
        color: var(--heo-text);
        font-weight: 600;
      }
      .flip .opt.on svg {
        color: var(--heo-accent-text);
      }
      /* Hovering anywhere on it lights the side a press picks: it reads as a switch, not two tabs. */
      .flip:hover .opt:not(.on) {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .flip:disabled {
        cursor: not-allowed;
      }
      /* Matches the value field's clear button, so every set row ends the same way. */
      .bar button.remove {
        flex: 0 0 22px;
        padding: 0;
        /* Dim, not the segments' faint: an icon control needs 3:1, and faint read 2.5:1. */
        color: var(--heo-text-dim);
      }
    `,
  ];

  @property({ attribute: false }) options: SegmentOption[] = [];
  @property({ type: String }) value = '';
  @property({ type: Boolean }) clearable = false;
  @property({ type: Boolean }) accent = false;
  /** Wrap onto more lines when the options do not fit on one. */
  @property({ type: Boolean }) wrap = false;
  @property({ type: String }) label = '';
  /** Show a ✕ that clears the value. For a value that is set, rather than inherited or computed. */
  @property({ type: Boolean }) removable = false;
  /**
   * Two options as one toggle (the Styles panel's Cards | Applied): drawn as the large tabs, a press
   * anywhere on it picks the other one, and the arrows pick the one they point at.
   */
  @property({ type: Boolean, reflect: true }) toggle = false;
  /** 'lg' for a switch between views; the default fits a property row. */
  @property({ type: String, reflect: true }) size = '';
  /** Every segment off, for a choice the page cannot offer right now; the host's title says why. */
  @property({ type: Boolean, reflect: true }) disabled = false;

  override render(): TemplateResult {
    if (this.toggle && this.options.length === 2) return this.#renderToggle();
    return html`<div class=${this.wrap ? 'bar wrap' : 'bar'} role="group" aria-label=${this.label || 'Options'}>
      ${this.options.map((option) => {
      const active = option.value === this.value;
      return html`<button
          type="button"
          aria-pressed=${active}
          class=${this.accent ? 'accent' : ''}
          title=${option.title ?? option.label ?? option.value}
          aria-label=${option.ariaLabel ?? nothing}
          ?disabled=${this.disabled}
          @click=${() => this.#pick(option, active)}
        >
          ${option.icon ? icon(option.icon, 13) : nothing}
          ${
        // An icon on its own is the whole label; falling through to `value`
        // printed "row" under the row glyph and clipped it.
        option.label ?? (option.icon ? nothing : option.value)
        }
        </button>`;
    })}
      ${this.removable
        ? html`<button
            class="remove"
            type="button"
            aria-label=${`Remove ${this.label || 'value'}`}
            title=${`Remove ${this.label || 'value'}`}
            @click=${this.#remove}
          >
            ${icon('close', 11)}
          </button>`
        : nothing}
    </div>`;
  }

  #renderToggle(): TemplateResult {
    const [first, second] = this.options as [SegmentOption, SegmentOption];
    const onSecond = this.value === second.value;
    const current = onSecond ? second : first;
    const other = onSecond ? first : second;
    const name = (option: SegmentOption): string => option.label ?? option.ariaLabel ?? option.value;
    /*
     * A switch, on for the second option: "View: Applied, switch, off" says what it is and what
     * a press does, where one button's name changing under the focus says neither.
     */
    return html`<button
      class="flip"
      type="button"
      role="switch"
      aria-checked=${onSecond ? 'true' : 'false'}
      aria-label=${`${this.label || 'Options'}: ${name(second)}`}
      title=${`${current.title ?? name(current)}. Press for ${name(other)}`}
      ?disabled=${this.disabled}
      @click=${() => this.#pick(other, false)}
      @keydown=${(event: KeyboardEvent) => {
        const to = event.key === 'ArrowLeft' ? first : event.key === 'ArrowRight' ? second : null;
        if (!to) return;
        event.preventDefault();
        if (to !== current) this.#pick(to, false);
      }}
    >
      <span class="thumb" aria-hidden="true"></span>
      ${[first, second].map((option) => html`<span class=${option === current ? 'opt on' : 'opt'} data-value=${option.value} aria-hidden="true">
        ${option.icon ? icon(option.icon, 13) : nothing}${name(option)}
      </span>`)}
    </button>`;
  }

  /** The value the toggle last drew, so a change (and only a change) plays its motion. */
  #drawn: string | null = null;

  override updated(): void {
    if (!this.toggle) return;
    const before = this.#drawn;
    this.#drawn = this.value;
    if (before === null || before === this.value) return;
    if (typeof this.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The thumb squashes as it springs across, and the picked side's icon swells once. No turn:
    // a rotating icon read as a loading spinner.
    this.renderRoot.querySelector('.thumb')?.animate(
      [
        { scale: '1 1' },
        { scale: '1.14 0.86', boxShadow: 'var(--heo-shadow-sm), inset 0 0 0 1px var(--heo-accent-line), 0 0 0 4px var(--heo-accent-soft)', offset: 0.35 },
        { scale: '0.97 1.04', offset: 0.7 },
        { scale: '1 1' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    this.renderRoot.querySelector('.opt.on svg')?.animate(
      [{ scale: 0.7 }, { scale: 1.18, offset: 0.6 }, { scale: 1 }],
      { duration: 380, easing: 'cubic-bezier(0.34, 1.45, 0.5, 1)' },
    );
  }

  #remove(): void {
    this.value = '';
    this.dispatchEvent(
      new CustomEvent('segment-change', { detail: { value: '' }, bubbles: true, composed: true }),
    );
  }

  #pick(option: SegmentOption, active: boolean): void {
    const next = active && this.clearable ? '' : option.value;
    this.value = next;
    this.dispatchEvent(
      new CustomEvent('segment-change', {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-segmented': HeoSegmented;
  }
}
