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
 *
 * `card` draws it as a tile instead, for the Styles panel's grid of categories: closed it is one
 * button (its picture in the `art` slot, else its glyph, then its name, count and `summary`); open
 * it is the same head and body as a section, and the grid gives it the whole row. One component
 * for both so a card opens, closes and remembers the way every section of the overlay does.
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

      /* A card: a tile of the Styles panel's category grid. */
      :host([card]) {
        min-width: 0;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-raised);
      }
      :host([card]:last-of-type) {
        border-bottom: 1px solid var(--heo-line);
      }
      :host([card][open]) {
        border-color: var(--heo-line-strong);
      }
      :host([card]) .head {
        padding: 8px 10px;
        border-radius: var(--heo-r-md) var(--heo-r-md) 0 0;
      }
      :host([card]) .body {
        padding: 0 10px 10px;
      }
      .tile {
        display: grid;
        align-content: start;
        gap: 3px;
        width: 100%;
        min-width: 0;
        padding: 5px 5px 8px;
        border: 0;
        border-radius: var(--heo-r-md);
        background: transparent;
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
        transition: background var(--heo-fast);
      }
      .tile:hover {
        background: var(--heo-hover);
      }
      .tile:focus-visible,
      .head:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: -2px;
      }
      .art {
        display: grid;
        place-items: center;
        height: 52px;
        margin-bottom: 3px;
        overflow: hidden;
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
      }
      .tile .ct {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-width: 0;
        padding: 0 3px;
      }
      .tile .title {
        overflow: hidden;
        color: var(--heo-text);
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0;
        text-overflow: ellipsis;
        text-transform: none;
        white-space: nowrap;
      }
      .tile .count {
        flex: 0 0 auto;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--heo-accent-soft);
        color: var(--heo-accent-text);
      }
      .sum {
        min-height: 1.35em;
        padding: 0 3px;
        overflow: hidden;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];

  @property({ type: String }) heading = '';
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) badge = '';
  @property({ type: String }) glyph = '';
  /** Drawn as a tile of a card grid while closed. */
  @property({ type: Boolean, reflect: true }) card = false;
  /** A card's one line under its name: what it holds, at a glance. */
  @property({ type: String }) summary = '';

  override render(): TemplateResult {
    if (this.card && !this.open) {
      return html`<button
        class="tile"
        type="button"
        aria-expanded="false"
        title=${this.summary ? `${this.heading}: ${this.summary}` : this.heading}
        @click=${this.#toggle}
      >
        <span class="art" aria-hidden="true"><slot name="art">${this.glyph ? icon(this.glyph, 18) : nothing}</slot></span>
        <span class="ct">
          <span class="title">${this.heading}</span>
          ${this.badge ? html`<span class="count">${this.badge}</span>` : nothing}
        </span>
        <span class="sum">${this.summary}</span>
      </button>`;
    }
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
    // The tile and the head are different buttons: the one pressed goes, so focus follows to the other.
    const focused = Boolean(this.shadowRoot?.activeElement);
    this.open = !this.open;
    if (focused && this.card) {
      void this.updateComplete.then(() =>
        this.shadowRoot?.querySelector<HTMLElement>(this.open ? '.head' : '.tile')?.focus({ preventScroll: true }));
    }
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
