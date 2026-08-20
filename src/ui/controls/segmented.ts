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
      button {
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
      button:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      button[aria-pressed='true'] {
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-sm);
        color: var(--heo-text);
      }
      button[aria-pressed='true'].accent {
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
    `,
  ];

  @property({ attribute: false }) options: SegmentOption[] = [];
  @property({ type: String }) value = '';
  @property({ type: Boolean }) clearable = false;
  @property({ type: Boolean }) accent = false;
  @property({ type: String }) label = '';

  override render(): TemplateResult {
    return html`<div class="bar" role="group" aria-label=${this.label || 'Options'}>
      ${this.options.map((option) => {
      const active = option.value === this.value;
      return html`<button
          type="button"
          aria-pressed=${active}
          class=${this.accent ? 'accent' : ''}
          title=${option.title ?? option.label ?? option.value}
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
    </div>`;
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
