import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

/**
 * Collapsible panel section.
 *
 * The style panel has more groups than fit on a screen, so collapsing is not a
 * nicety. Open state is owned by the caller, which lets a panel remember which
 * groups a user works in across selections rather than resetting every time.
 *
 * Fires `section-toggle` with `{ open }`.
 */
@customElement('heo-section')
export class HeoSection extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        border-bottom: 1px solid var(--heo-line);
      }
      :host(:last-of-type) {
        border-bottom: 0;
      }

      .head {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        padding: 9px 12px;
        border: 0;
        background: transparent;
        color: var(--heo-text-dim);
        text-align: left;
        cursor: pointer;
        transition: color var(--heo-fast);
      }
      .head:hover {
        color: var(--heo-text);
      }
      .chev {
        display: grid;
        place-items: center;
        color: var(--heo-text-faint);
        transition: transform var(--heo-med);
      }
      :host([open]) .chev {
        transform: rotate(90deg);
      }
      .title {
        flex: 1 1 auto;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .count {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .body {
        padding: 0 12px 12px;
      }
      .actions {
        display: flex;
        gap: 4px;
      }
    `,
  ];

  @property({ type: String }) heading = '';
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) badge = '';
  @property({ type: String }) glyph = '';

  override render(): TemplateResult {
    return html`
      <button
        class="head"
        type="button"
        aria-expanded=${this.open}
        @click=${this.#toggle}
      >
        <span class="chev">${icon('chevronRight', 11)}</span>
        ${this.glyph ? icon(this.glyph, 13) : nothing}
        <span class="title">${this.heading}</span>
        ${this.badge ? html`<span class="count">${this.badge}</span>` : nothing}
        <span class="actions" @click=${(event: Event) => event.stopPropagation()}>
          <slot name="actions"></slot>
        </span>
      </button>
      ${this.open ? html`<div class="body"><slot></slot></div>` : nothing}
    `;
  }

  #toggle(): void {
    this.open = !this.open;
    this.dispatchEvent(
      new CustomEvent('section-toggle', {
        detail: { open: this.open },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-section': HeoSection;
  }
}
