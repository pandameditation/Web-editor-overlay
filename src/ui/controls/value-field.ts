import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { formatLength, nextUnit, parseLength, toHexColor } from '../../core/css.js';
import { icon } from '../icons.js';
import { baseStyles, swatchStyle } from '../theme.js';

export interface ValueSuggestion {
  value: string;
  label?: string;
  /** Secondary text, e.g. a token's resolved value or a usage count. */
  hint?: string;
  /** Section heading. Suggestions are rendered in the order groups first appear. */
  group: string;
  /** Colour to show as a swatch. */
  swatch?: string;
  /** Renders the token affordance and marks the value as design-system-backed. */
  token?: boolean;
}

export type ValueKind = 'text' | 'length' | 'number' | 'color' | 'keyword';

/**
 * The overlay's primary value control.
 *
 * One field handles every CSS value because the interaction that matters is the
 * same in all cases: show what design tokens are already available, make picking
 * one the path of least resistance, but never block a custom value. On top of
 * that it adds the numeric affordances a style editor needs — drag to scrub,
 * arrow keys to step, click to cycle units — so common adjustments do not
 * require typing at all.
 *
 * Fires `value-input` continuously (for live preview) and `value-change` on
 * commit (for the undo stack).
 */
@customElement('heo-value-field')
export class HeoValueField extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        position: relative;
      }

      .wrap {
        display: flex;
        align-items: stretch;
        height: 28px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        transition:
          border-color var(--heo-fast),
          background var(--heo-fast);
      }
      .wrap:hover {
        border-color: var(--heo-line-strong);
      }
      .wrap:focus-within {
        border-color: var(--heo-accent-line);
        background: var(--heo-bg);
      }
      :host([data-token]) .wrap {
        background: var(--heo-accent-soft);
        border-color: var(--heo-accent-line);
      }

      /* Drag-to-scrub target. Doubles as the property label so the control stays
         compact while giving the gesture a generous hit area. */
      .scrub {
        display: flex;
        align-items: center;
        padding: 0 7px;
        border: 0;
        border-right: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm) 0 0 var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.02em;
        white-space: nowrap;
        cursor: ew-resize;
        touch-action: none;
        user-select: none;
        transition: color var(--heo-fast);
      }
      .scrub:hover,
      .scrub.active {
        color: var(--heo-accent);
      }
      .scrub.plain {
        cursor: default;
      }

      input {
        flex: 1 1 auto;
        min-width: 0;
        padding: 0 6px;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
      }
      input:focus {
        outline: none;
      }
      input::placeholder {
        color: var(--heo-text-faint);
        font-family: var(--heo-font);
      }

      .trailing {
        display: flex;
        align-items: center;
        gap: 2px;
        padding-right: 3px;
      }
      .unit {
        height: 20px;
        padding: 0 5px;
        border: 0;
        border-radius: 5px;
        background: var(--heo-hover);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10px;
        cursor: pointer;
      }
      .unit:hover {
        background: var(--heo-active);
        color: var(--heo-text);
      }
      .mini {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .mini:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }

      .color-btn {
        display: grid;
        place-items: center;
        width: 26px;
        border: 0;
        border-right: 1px solid var(--heo-line);
        background: transparent;
        cursor: pointer;
        padding: 0;
      }
      .color-btn .swatch {
        width: 15px;
        height: 15px;
      }
      input[type='color'] {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }

      /* ---- Popup ---- */

      .popup {
        position: fixed;
        z-index: 30;
        max-height: 320px;
        overflow-y: auto;
        padding: 4px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-md);
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-lg);
        animation: pop var(--heo-fast);
      }
      @keyframes pop {
        from {
          opacity: 0;
          transform: translateY(-3px);
        }
      }
      .group {
        padding: 6px 8px 3px;
        color: var(--heo-text-faint);
        font-size: 10px
        ;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .option {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        padding: 5px 8px;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
      }
      .option:hover,
      .option[aria-selected='true'] {
        background: var(--heo-hover);
      }
      .option[aria-selected='true'] {
        box-shadow: inset 0 0 0 1px var(--heo-accent-line);
      }
      .option .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .option .meta {
        flex: 0 0 auto;
        max-width: 40%;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option .tokenmark {
        color: var(--heo-accent);
      }
      .none {
        padding: 10px 8px;
        color: var(--heo-text-faint);
        font-size: 11px;
      }
    `,
  ];

  @property({ type: String }) label = '';
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = '';
  @property({ type: String }) kind: ValueKind = 'text';
  @property({ attribute: false }) suggestions: ValueSuggestion[] = [];
  /** Show the unit chip and enable scrubbing. Inferred from `kind` by default. */
  @property({ type: Boolean }) numeric = false;
  @property({ type: Boolean }) clearable = false;

  @state() private draft = '';
  @state() private open = false;
  @state() private highlight = -1;
  @state() private scrubbing = false;
  @state() private popupStyle = '';

  @query('input[type="text"]') private textInput!: HTMLInputElement;
  @query('input[type="color"]') private colorInput?: HTMLInputElement;

  #scrubStart = { x: 0, value: 0, unit: 'px' };
  #onScroll = (): void => {
    if (this.open) this.#positionPopup();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.draft = this.value;
    addEventListener('scroll', this.#onScroll, true);
    addEventListener('resize', this.#onScroll);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    removeEventListener('scroll', this.#onScroll, true);
    removeEventListener('resize', this.#onScroll);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // Adopt an external value change unless the user is mid-edit.
    if (changed.has('value') && document.activeElement !== this) {
      this.draft = this.value;
    }
    if (changed.has('value')) {
      this.toggleAttribute('data-token', this.value.includes('var(--'));
    }
  }

  private get isNumeric(): boolean {
    return this.numeric || this.kind === 'length' || this.kind === 'number';
  }

  private get parsed(): { number: number; unit: string } | null {
    return parseLength(this.draft);
  }

  private get filtered(): ValueSuggestion[] {
    const needle = this.draft.trim().toLowerCase();
    const all = this.suggestions;
    if (!needle) return all;
    const scored = all.filter(
      (item) =>
        item.value.toLowerCase().includes(needle) ||
        (item.label ?? '').toLowerCase().includes(needle),
    );
    // An exact-prefix match on the label is what the user is most likely after.
    return scored.sort((a, b) => {
      const aHit = (a.label ?? a.value).toLowerCase().startsWith(needle) ? 1 : 0;
      const bHit = (b.label ?? b.value).toLowerCase().startsWith(needle) ? 1 : 0;
      return bHit - aHit;
    });
  }

  override render(): TemplateResult {
    const parsed = this.parsed;
    const showUnit = this.isNumeric && parsed !== null && this.kind !== 'number';
    const isColor = this.kind === 'color';

    return html`
      <div class="wrap">
        ${isColor ? this.#renderColorButton() : nothing}
        ${this.label
        ? html`<button
              class="scrub ${this.scrubbing ? 'active' : ''} ${this.isNumeric ? '' : 'plain'}"
              @pointerdown=${this.#onScrubStart}
              title=${this.isNumeric
            ? `${this.label} — drag left or right to change, or use the arrow keys`
            : this.label}
              tabindex="-1"
              type="button"
            >
              ${this.label}
            </button>`
        : nothing}
        <input
          type="text"
          .value=${this.draft}
          placeholder=${this.placeholder || 'auto'}
          spellcheck="false"
          autocomplete="off"
          role="combobox"
          aria-expanded=${this.open}
          aria-autocomplete="list"
          @input=${this.#onInput}
          @focus=${this.#onFocus}
          @blur=${this.#onBlur}
          @keydown=${this.#onKeyDown}
        />
        <div class="trailing">
          ${showUnit
        ? html`<button
                class="unit"
                type="button"
                tabindex="-1"
                title="Cycle the unit"
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#cycleUnit}
              >
                ${parsed!.unit || '—'}
              </button>`
        : nothing}
          ${this.clearable && this.draft
        ? html`<button
                class="mini"
                type="button"
                tabindex="-1"
                title="Clear"
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#clear}
              >
                ${icon('close', 11)}
              </button>`
        : nothing}
          ${this.suggestions.length
        ? html`<button
                class="mini"
                type="button"
                tabindex="-1"
                title="Show tokens and values"
                aria-label="Show tokens and values"
                @pointerdown=${(event: Event) => event.preventDefault()}
                @click=${this.#toggleOpen}
              >
                ${icon('chevronDown', 12)}
              </button>`
        : nothing}
        </div>
      </div>
      ${this.open ? this.#renderPopup() : nothing}
    `;
  }

  #renderColorButton(): TemplateResult {
    const resolved = this.#resolvedColor();
    return html`
      <button
        class="color-btn"
        type="button"
        tabindex="-1"
        title="Pick a colour"
        aria-label="Pick a colour"
        @click=${() => this.colorInput?.click()}
      >
        <span class="swatch" style=${swatchStyle(resolved)}></span>
      </button>
      <input
        type="color"
        .value=${toHexColor(resolved, '#000000')}
        @input=${this.#onColorInput}
        @change=${this.#onColorChange}
        tabindex="-1"
        aria-hidden="true"
      />
    `;
  }

  #renderPopup(): TemplateResult {
    const items = this.filtered;
    if (!items.length) {
      return html`<div class="popup" style=${this.popupStyle} role="listbox">
        <div class="none">No matching token. Press Enter to keep your own value.</div>
      </div>`;
    }

    // Group while preserving the order groups first appear in.
    const groups: Array<{ name: string; items: ValueSuggestion[] }> = [];
    for (const item of items) {
      const existing = groups.find((group) => group.name === item.group);
      if (existing) existing.items.push(item);
      else groups.push({ name: item.group, items: [item] });
    }

    let index = -1;
    return html`<div class="popup" style=${this.popupStyle} role="listbox">
      ${repeat(
      groups,
      (group) => group.name,
      (group) => html`
          <div class="group">${group.name}</div>
          ${repeat(
        group.items,
        (item) => `${group.name}:${item.value}`,
        (item) => {
          index += 1;
          const current = index;
          return html`<button
                class="option"
                type="button"
                role="option"
                aria-selected=${current === this.highlight}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @pointerenter=${() => {
              this.highlight = current;
            }}
                @click=${() => this.#choose(item)}
              >
                ${item.swatch
              ? html`<span class="swatch" style=${swatchStyle(item.swatch)}></span>`
              : nothing}
                <span class="name">${item.label ?? item.value}</span>
                ${item.token ? html`<span class="tokenmark">${icon('droplet', 11)}</span>` : nothing}
                ${item.hint ? html`<span class="meta">${item.hint}</span>` : nothing}
              </button>`;
        },
      )}
        `,
    )}
    </div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Interaction                                                            */
  /* ---------------------------------------------------------------------- */

  #onInput(event: Event): void {
    this.draft = (event.target as HTMLInputElement).value;
    this.highlight = -1;
    if (this.suggestions.length && !this.open) this.#openPopup();
    this.#emit('value-input');
  }

  #onFocus(): void {
    if (this.suggestions.length) this.#openPopup();
  }

  #onBlur(): void {
    // Let a click on an option land before the popup unmounts.
    setTimeout(() => {
      this.open = false;
      this.highlight = -1;
      if (this.draft !== this.value) this.#commit();
    }, 120);
  }

  #onKeyDown(event: KeyboardEvent): void {
    const items = this.filtered;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.open) {
        this.open = false;
        return;
      }
      this.draft = this.value;
      this.#emit('value-input');
      this.textInput.blur();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.open && this.highlight >= 0 && items[this.highlight]) {
        this.#choose(items[this.highlight]);
        return;
      }
      this.open = false;
      this.#commit();
      return;
    }

    if (event.key === 'Tab') {
      if (this.open && this.highlight >= 0 && items[this.highlight]) {
        event.preventDefault();
        this.#choose(items[this.highlight]);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1;

      // With the list open the arrows move the highlight; otherwise they step
      // the number, which is the faster interaction for a length field.
      if (this.open && items.length) {
        event.preventDefault();
        const next = this.highlight + direction;
        this.highlight = next < 0 ? items.length - 1 : next >= items.length ? 0 : next;
        return;
      }
      if (this.isNumeric) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
        this.#step(direction * step);
      }
    }
  }

  #step(delta: number): void {
    const parsed = this.parsed ?? { number: 0, unit: this.kind === 'number' ? '' : 'px' };
    this.draft = formatLength(parsed.number + delta, parsed.unit);
    this.#emit('value-input');
    this.#commit();
  }

  #cycleUnit(event: MouseEvent): void {
    const parsed = this.parsed;
    if (!parsed) return;
    const unit = nextUnit(parsed.unit, event.shiftKey ? -1 : 1);
    this.draft = formatLength(parsed.number, unit);
    this.#commit();
  }

  #clear(): void {
    this.draft = '';
    this.#commit();
  }

  #toggleOpen(): void {
    if (this.open) {
      this.open = false;
      return;
    }
    this.#openPopup();
    this.textInput?.focus();
  }

  #openPopup(): void {
    this.open = true;
    this.#positionPopup();
    // Re-measure after the popup renders so its real height is used.
    requestAnimationFrame(() => this.#positionPopup());
  }

  /**
   * Place the popup in viewport coordinates.
   *
   * The field lives inside a scrolling panel, so an absolutely positioned popup
   * would be clipped by the panel's overflow. Fixed positioning avoids that, at
   * the cost of having to recompute on scroll and resize.
   */
  #positionPopup(): void {
    const anchor = this.getBoundingClientRect();
    const popup = this.renderRoot.querySelector('.popup');
    const height = popup?.getBoundingClientRect().height ?? 240;
    const width = Math.max(anchor.width, 200);

    const spaceBelow = innerHeight - anchor.bottom;
    const above = spaceBelow < height + 12 && anchor.top > spaceBelow;
    const top = above ? Math.max(8, anchor.top - height - 5) : anchor.bottom + 5;
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, innerWidth - width - 8));

    this.popupStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px;width:${Math.round(width)}px;max-height:${Math.round(above ? anchor.top - 16 : spaceBelow - 16)}px`;
  }

  #choose(item: ValueSuggestion): void {
    this.draft = item.value;
    this.open = false;
    this.highlight = -1;
    this.#commit();
  }

  /* ---- Colour ---- */

  /**
   * The colour to paint in the swatch.
   *
   * Falls back to the placeholder, which the style panel fills with the computed
   * value. Without that, every field showing an inherited colour would paint an
   * empty checkerboard even though the element visibly has a colour.
   */
  #resolvedColor(): string {
    const raw = this.draft.trim() || this.placeholder.trim();
    if (!raw) return 'transparent';
    if (!raw.includes('var(--')) return raw;
    // Resolve against the host page so a token shows its real colour.
    const name = /var\(\s*(--[\w-]+)/.exec(raw)?.[1];
    if (!name) return raw;
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return resolved || 'transparent';
  }

  #onColorInput(event: Event): void {
    this.draft = (event.target as HTMLInputElement).value;
    this.#emit('value-input');
  }

  #onColorChange(event: Event): void {
    this.draft = (event.target as HTMLInputElement).value;
    this.#commit();
  }

  /* ---- Emitting ---- */

  #commit(): void {
    const next = this.draft.trim();
    if (next === this.value.trim()) return;
    this.value = next;
    this.#emit('value-change');
  }

  #emit(type: 'value-input' | 'value-change'): void {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { value: this.draft.trim() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /* ---- Scrub gesture ---- */

  /**
   * Horizontal drag on the label changes the value.
   *
   * Uses pointer capture rather than document listeners so the gesture survives
   * the pointer leaving the control, and the vertical axis is ignored so the
   * gesture cannot be confused with a scroll.
   */
  #onScrubStart(event: PointerEvent): void {
    if (!this.isNumeric) return;
    event.preventDefault();
    const parsed = this.parsed ?? { number: 0, unit: this.kind === 'number' ? '' : 'px' };
    this.#scrubStart = { x: event.clientX, value: parsed.number, unit: parsed.unit };
    this.scrubbing = true;

    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - this.#scrubStart.x;
      const scale = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
      const next = this.#scrubStart.value + Math.round(dx) * scale;
      this.draft = formatLength(next, this.#scrubStart.unit);
      this.#emit('value-input');
    };
    const up = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      this.scrubbing = false;
      this.#commit();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-value-field': HeoValueField;
  }
}
