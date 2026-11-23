import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

/** How long a card takes to grow into its row, or shrink back into its tile. */
const MORPH_MS = 380;
const MORPH_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

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
 * it is a head (the picture small, the name, the summary) over the body, and the grid gives it the
 * whole row. One component for both so a card opens, closes and remembers the way every section
 * of the overlay does. A card is drawn in its hue, the `--h` custom property the panel sets on it.
 *
 * Opening a card grows it out of its tile into the whole row and slides the cards after it out of
 * its way, rather than redrawing the grid in one jump: in a two-column grid the jump read as the
 * card vanishing and another appearing a row lower. Focus goes with it, to the open card's head,
 * and back to the tile when it closes.
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

      /* A card: a tile of the Styles panel's category grid, tinted with its hue. */
      :host([card]),
      :host([card]:last-of-type) {
        --hue: var(--h, 265);
        position: relative;
        min-width: 0;
        border: 1px solid oklch(var(--heo-card-line) var(--hue) / 24%);
        border-radius: 12px;
        background: linear-gradient(180deg, oklch(var(--heo-card-tint) var(--hue)), var(--heo-raised) 62%);
        transition:
          transform var(--heo-med),
          box-shadow var(--heo-med),
          border-color var(--heo-med);
      }
      :host([card]:not([open]):hover) {
        transform: translateY(-2px);
        border-color: oklch(var(--heo-card-line) var(--hue) / 60%);
        box-shadow: 0 12px 26px -14px oklch(var(--heo-card-line) var(--hue) / 70%);
      }
      :host([card]:not([open]):active) {
        transform: translateY(0) scale(0.985);
      }
      /* Nothing set: one look on every card, an outline with no fill and a dimmed picture. */
      :host([card][empty]:not([open])) {
        border-style: dashed;
        border-color: var(--heo-line-strong);
        background: transparent;
      }
      :host([card][empty]:not([open]):hover) {
        border-color: oklch(var(--heo-card-line) var(--hue) / 60%);
        background: oklch(var(--heo-card-tint) var(--hue) / 60%);
      }
      :host([card][open]) {
        border-color: oklch(var(--heo-card-line) var(--hue) / 45%);
        background: var(--heo-raised);
        box-shadow: 0 16px 36px -24px oklch(var(--heo-card-line) var(--hue) / 70%);
      }
      :host([card][open][empty]) {
        border-color: var(--heo-line-strong);
        box-shadow: none;
      }
      .tile {
        position: relative;
        display: grid;
        align-content: start;
        gap: 4px;
        width: 100%;
        min-width: 0;
        padding: 6px 6px 8px;
        border: 0;
        border-radius: 11px;
        background: transparent;
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
      }
      .tile:focus-visible,
      .head:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: -2px;
      }
      /* The picture's well, in the card's hue; the panel may lay its own floor (the shadow's light one). */
      .art,
      .thumb {
        position: relative;
        display: grid;
        place-items: center;
        overflow: hidden;
        border-radius: 8px;
        background: var(
          --art-bg,
          radial-gradient(120% 120% at 20% 0%, oklch(var(--heo-card-well-a) var(--hue)), oklch(var(--heo-card-well-b) var(--hue)))
        );
        color: oklch(var(--heo-card-ink) var(--hue));
        transition:
          filter var(--heo-med),
          opacity var(--heo-med);
      }
      .art {
        height: 62px;
        margin-bottom: 2px;
      }
      :host([empty]) .art {
        filter: grayscale(0.85);
        opacity: 0.5;
      }
      :host([empty]) .tile:hover .art,
      :host([empty]) .tile:focus-visible .art {
        filter: none;
        opacity: 0.9;
      }
      /* Says, on hover, that the tile opens across both columns. */
      .grow {
        position: absolute;
        top: 6px;
        right: 6px;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 6px;
        background: color-mix(in oklab, var(--heo-bg) 72%, transparent);
        color: var(--heo-text);
        opacity: 0;
        transform: scale(0.8);
        transition:
          opacity var(--heo-fast),
          transform var(--heo-med);
      }
      .tile:hover .grow,
      .tile:focus-visible .grow {
        opacity: 1;
        transform: none;
      }
      .ic {
        display: grid;
        flex: 0 0 auto;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 5px;
        background: oklch(var(--heo-card-chip) var(--hue));
        color: oklch(var(--heo-card-chip-ink) var(--hue));
      }
      :host([empty]) .ic {
        background: var(--heo-hover);
        color: var(--heo-text-dim);
      }
      .tile .ct,
      .tl {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .tile .ct {
        padding: 0 2px;
      }
      :host([card]) .title {
        overflow: hidden;
        color: var(--heo-text);
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0;
        text-overflow: ellipsis;
        text-transform: none;
        white-space: nowrap;
      }
      :host([empty]) .tile .title {
        color: var(--heo-text-dim);
        font-weight: 500;
      }
      :host([card]) .count {
        flex: 0 0 auto;
        padding: 0 6px;
        border-radius: 999px;
        background: oklch(var(--heo-card-count) var(--hue));
        color: oklch(var(--heo-card-count-ink) var(--hue));
        font-family: var(--heo-font);
        font-size: 9.5px;
        font-weight: 650;
        line-height: 15px;
      }
      .sum {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        min-height: 1.35em;
        padding: 0 3px;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10px;
        line-height: 1.35;
        white-space: nowrap;
      }
      .sum .txt {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Set: a dot in the hue before the values. Empty: a ring, then "Empty", then "+ add" on hover. */
      .sum .dot {
        flex: 0 0 auto;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: oklch(var(--heo-card-ink) var(--hue));
      }
      :host([empty]) .sum {
        color: var(--heo-text-faint);
        font-family: var(--heo-font);
      }
      :host([empty]) .sum .dot {
        background: transparent;
        box-shadow: inset 0 0 0 1.5px var(--heo-text-faint);
      }
      .sum .plus {
        margin-left: auto;
        color: oklch(var(--heo-card-chip-ink) var(--hue));
        font-weight: 500;
        opacity: 0;
        transition: opacity var(--heo-fast);
      }
      .tile:hover .plus,
      .tile:focus-visible .plus {
        opacity: 1;
      }

      /* An open card's head: its picture small, its name and summary, and the way to close it. */
      :host([card]) .head {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr) auto auto;
        gap: 10px;
        padding: 5px 6px;
        border-radius: 11px 11px 0 0;
        background: linear-gradient(90deg, oklch(var(--heo-card-chip) var(--hue)), oklch(var(--heo-card-tint) var(--hue)) 70%);
        color: var(--heo-text);
      }
      :host([card][empty]) .head {
        background: var(--heo-sunken);
      }
      .thumb {
        height: 38px;
        border-radius: 7px;
      }
      .thumb ::slotted(*) {
        transform: scale(0.6);
      }
      .tt {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .tt .sum {
        padding: 0;
      }
      .up {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        color: var(--heo-text-dim);
      }
      :host([card]) .head:hover .up {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      :host([card]) .body {
        padding: 10px;
        animation: heo-card-body var(--heo-med) both;
      }
      @keyframes heo-card-body {
        from {
          opacity: 0;
        }
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
  /** A card with nothing set: drawn as an outline, its summary "Empty". */
  @property({ type: Boolean, reflect: true }) empty = false;

  override render(): TemplateResult {
    if (this.card) return this.open ? this.#renderOpenCard() : this.#renderTile();
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

  /** The summary line: the values in the hue's dot, or a ring and "Empty". */
  #summary(withPlus: boolean): TemplateResult {
    return this.empty
      ? html`<span class="sum"><span class="dot"></span><span class="txt">Empty</span>${withPlus
        ? html`<span class="plus" aria-hidden="true">+ add</span>`
        : nothing}</span>`
      : html`<span class="sum"><span class="dot"></span><span class="txt">${this.summary}</span></span>`;
  }

  #renderTile(): TemplateResult {
    const what = this.empty ? 'nothing set' : this.summary;
    return html`<button
      class="tile"
      type="button"
      aria-expanded="false"
      title=${what ? `${this.heading}: ${what}. Opens across both columns` : `${this.heading}. Opens across both columns`}
      @click=${this.#toggle}
    >
      <span class="art" aria-hidden="true"><slot name="art">${this.glyph ? icon(this.glyph, 18) : nothing}</slot></span>
      <span class="grow" aria-hidden="true">${icon('widen', 12)}</span>
      <span class="ct">
        <span class="ic" aria-hidden="true">${this.glyph ? icon(this.glyph, 11) : nothing}</span>
        <span class="title">${this.heading}</span>
        ${this.badge ? html`<span class="count">${this.badge}</span>` : nothing}
      </span>
      ${this.#summary(true)}
    </button>`;
  }

  #renderOpenCard(): TemplateResult {
    return html`<button class="head" type="button" aria-expanded="true" title=${`Close ${this.heading}`} @click=${this.#toggle}>
        <span class="thumb" aria-hidden="true"><slot name="art">${this.glyph ? icon(this.glyph, 16) : nothing}</slot></span>
        <span class="tt">
          <span class="tl">
            <span class="ic" aria-hidden="true">${this.glyph ? icon(this.glyph, 11) : nothing}</span>
            <span class="title">${this.heading}</span>
            ${this.badge ? html`<span class="count">${this.badge}</span>` : nothing}
          </span>
          ${this.#summary(false)}
        </span>
        <span class="actions" @click=${(event: Event) => event.stopPropagation()}>
          <slot name="actions"></slot>
        </span>
        <span class="up" aria-hidden="true">${icon('chevronUp', 13)}</span>
      </button>
      <div class="body"><slot></slot></div>`;
  }

  #toggle(): void {
    const before = this.card ? this.#measure() : null;
    this.open = !this.open;
    if (this.card) {
      void this.updateComplete.then(() => {
        /*
         * The tile and the head are different buttons: the one pressed goes, so focus follows to the
         * other, whether it was pressed by key or by pointer (Safari does not focus a clicked button,
         * and focus then fell to the document). Opened, that is the card's head, the first stop
         * inside it; closed, the tile it shrank back into. Focusing may scroll the head into view,
         * so the morph measures afterwards.
         */
        this.shadowRoot?.querySelector<HTMLElement>(this.open ? '.head' : '.tile')?.focus();
        if (before) this.#morph(before);
      });
    }
    this.dispatchEvent(
      new CustomEvent('section-toggle', {
        detail: { open: this.open },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Where this card and the cards beside it are, before it opens or closes; null for no motion. */
  #measure(): Map<HTMLElement, DOMRect> | null {
    if (typeof this.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    const siblings = Array.from(this.parentElement?.children ?? []).filter((one): one is HTMLElement => one instanceof HTMLElement);
    return new Map(siblings.map((one) => [one, one.getBoundingClientRect()]));
  }

  /**
   * Each card from where it was to where it is: the one opened grows out of its tile (moved back
   * to the tile's corner and clipped to its size, then let go), the others slide, and one that
   * changed size (this one, closing) slides in faded.
   */
  #morph(before: Map<HTMLElement, DOMRect>): void {
    const timing = { duration: MORPH_MS, easing: MORPH_EASE };
    for (const [one, from] of before) {
      if (!one.isConnected) continue;
      const to = one.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (one === this && this.open) {
        const right = Math.max(0, to.width - from.width);
        const bottom = Math.max(0, to.height - from.height);
        one.animate(
          [
            { translate: `${dx}px ${dy}px`, clipPath: `inset(0px ${right}px ${bottom}px 0px round 12px)` },
            { translate: '0px 0px', clipPath: 'inset(0px 0px 0px 0px round 12px)' },
          ],
          timing,
        );
        // Then its frame glows once in its hue: this is the card that opened.
        one.animate(
          [{ boxShadow: '0 0 0 3px oklch(var(--heo-card-line) var(--hue) / 45%)', offset: 0 }],
          { duration: 900, delay: MORPH_MS - 80, easing: MORPH_EASE },
        );
        continue;
      }
      const resized = Math.abs(from.width - to.width) > 2 || Math.abs(from.height - to.height) > 2;
      if (!resized && Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      one.animate(
        [
          { translate: `${dx}px ${dy}px`, ...(resized ? { opacity: 0.35 } : {}) },
          { translate: '0px 0px', opacity: 1 },
        ],
        timing,
      );
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-section': HeoSection;
  }
}
