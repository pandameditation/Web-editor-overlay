import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  FILTER_SPECS,
  filterAmount,
  filterSpec,
  formatFilter,
  isEmptyUrl,
  neutralPart,
  parseFilter,
  urlPart,
  urlTarget,
  withAmount,
  type FilterName,
  type FilterPart,
  type FilterSpec,
} from '../../core/filter.js';
import type { ShadowSwatch } from '../../core/shadow.js';
import { firstFocusable } from '../../core/modal.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import type { ValueSuggestion } from './value-field.js';
import './shadow-editor.js';
import './value-field.js';

/** What an empty function means, said under its slider: the value at which it changes nothing. */
const NEUTRAL_NOTE = (spec: FilterSpec): string => `${spec.neutral}${spec.unit} = unchanged`;

/**
 * The filter editor, for `filter` and `backdrop-filter`: the functions, built and previewed live.
 *
 * Opened in the popup the shadow editor and the colour picker use, from the control at the head of
 * the field; the popup's head — grip, title ("Filter", "Backdrop filter"), ✕ — is the field's.
 *
 * Top to bottom:
 * - the functions set, as chips in the order the filter applies them, with their values as written
 *   (`sepia(0.6)`). A chip is picked by clicking it, moved by dragging it (or Alt and an arrow), and
 *   removed by its ✕. Order is part of a filter: blur then grayscale is not grayscale then blur;
 * - the picked function's editor, right under its chip: a slider and its number for the amounts
 *   and the blur, the background editor's angle dial for hue-rotate, the shadow editor for
 *   drop-shadow(), and a reference to an SVG filter — the page's own offered — for url();
 * - the functions not set yet, as dashed chips: clicking one adds it at its neutral value, which
 *   changes nothing on screen until its control moves, and picks it.
 *
 * An amount is written in the form it was written in: `sepia(0.6)` stays a plain number, a new one
 * is a percentage. A part this cannot model (a `var()`, a function it does not know) is kept as
 * written, and can still be moved, removed, or edited in the field.
 *
 * Writes as it goes, like the shadow editor: `filter-input` while something is being dragged, for
 * the host's live preview, and `filter-change` when it settles. `filter-select` asks the field to
 * select one part of its text, for a part that is edited there.
 */
@customElement('heo-filter-editor')
export class HeoFilterEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        /* Not auto: a column sized to its content took the width of the longest chip, past the dialog's. */
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        width: 100%;
        min-width: 0;
        font-size: 11.5px;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .group::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--heo-line);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      /* A set function: the chip picks it, its grip drags it, its cross removes it. */
      /* Shrinks with its text cut short: a drop shadow's chip is longer than the dialog is wide. */
      .fchip {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        max-width: 100%;
        height: 22px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 999px;
        background: var(--heo-sunken);
        color: var(--heo-text);
      }
      .fchip.over {
        box-shadow: -2px 0 0 var(--heo-accent);
      }
      .fchip[data-picked='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
      }
      .fchip .pick {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        height: 100%;
        padding: 0 2px 0 6px;
        border: 0;
        border-radius: 999px 0 0 999px;
        background: transparent;
        color: inherit;
        font-family: var(--heo-mono);
        font-size: 10.5px;
        cursor: pointer;
      }
      .fchip[data-picked='true'] .pick {
        font-weight: 600;
      }
      .fchip .pick .t {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fchip .pick .g {
        display: grid;
        color: var(--heo-text-faint);
        cursor: grab;
      }
      .fchip .x {
        flex: none;
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        margin-right: 2px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--heo-text-dim);
        cursor: pointer;
      }
      .fchip .x:hover {
        background: var(--heo-hover);
        color: var(--heo-danger);
      }
      .fchip button:focus-visible,
      .add:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .fchip.opaque .pick {
        color: var(--heo-text-dim);
        font-style: italic;
      }
      /* A function not set yet: dashed, as an empty slot. */
      .add {
        display: inline-flex;
        align-items: center;
        height: 22px;
        padding: 0 8px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: 999px;
        background: transparent;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        cursor: pointer;
      }
      .add:hover {
        border-color: var(--heo-accent-line);
        color: var(--heo-text);
      }
      /* The picked function's editor. */
      .ed {
        display: grid;
        gap: 8px;
        min-width: 0;
        padding: 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .ed > code {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
        font-weight: 600;
      }
      .line {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 84px;
        align-items: center;
        gap: 8px;
      }
      .line.dial-line {
        grid-template-columns: 32px minmax(0, 1fr) 84px;
      }
      input[type='range'] {
        width: 100%;
        margin: 0;
        accent-color: var(--heo-accent);
      }
      .num {
        display: flex;
        align-items: center;
        height: 28px;
        padding: 0 7px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
      }
      .num:focus-within {
        border-color: var(--heo-accent-line);
      }
      .num input {
        flex: 1 1 auto;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
        outline: none;
      }
      .num span {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }
      .scale {
        display: flex;
        justify-content: space-between;
        margin-top: -4px;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
      }
      /* The background editor's angle dial. */
      .dial {
        position: relative;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--heo-raised);
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
        cursor: grab;
        touch-action: none;
      }
      .dial:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .dial i {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 2px;
        height: 13px;
        margin-left: -1px;
        border-radius: 2px;
        background: var(--heo-accent);
        transform-origin: 50% 0;
      }
      .dial b {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 6px;
        height: 6px;
        margin: -3px;
        border-radius: 50%;
        background: var(--heo-accent);
      }
      /* The hues, turned by the angle: what hue-rotate does to every colour. */
      .hues {
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      }
      .note {
        margin: 0;
        color: var(--heo-text-hint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .linkish {
        justify-self: start;
      }
      heo-value-field {
        min-width: 0;
        width: 100%;
      }
    `,
  ];

  /** The value the property holds as written. */
  @property({ type: String }) value = '';
  /** The property: `filter` or `backdrop-filter`, for what the controls are called. */
  @property({ type: String }) property = 'filter';
  /** The design system's shadow tokens, for the drop shadow's swatches. */
  @property({ attribute: false }) tokens: readonly ShadowSwatch[] = [];

  @state() private parts: FilterPart[] = [];
  /** The picked part, by position; -1 for none. */
  @state() private picked = -1;
  /** The values this editor sent, recent first, so its own echoes are not read as another change. */
  #sent: string[] = [];

  override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('value')) return;
    const value = this.value.trim();
    if (this.#sent.includes(value) || value === formatFilter(this.parts)) return;
    this.parts = parseFilter(this.value);
    this.picked = this.parts.length ? 0 : -1;
    this.#sent = [];
  }

  #emit(kind: 'filter-input' | 'filter-change'): void {
    const value = formatFilter(this.parts);
    this.#sent = [value, ...this.#sent.filter((one) => one !== value)].slice(0, 12);
    this.dispatchEvent(new CustomEvent(kind, { detail: { value }, bubbles: true, composed: true }));
  }

  /** Replace a part. `settle` commits; without it the change is only previewed. */
  #set(index: number, part: FilterPart, settle: boolean): void {
    if (!this.parts[index]) return;
    this.parts = this.parts.map((one, at) => (at === index ? part : one));
    this.#emit(settle ? 'filter-change' : 'filter-input');
  }

  #add(name: FilterName): void {
    this.parts = [...this.parts, neutralPart(name)];
    this.picked = this.parts.length - 1;
    this.#emit('filter-change');
    // The dashed chip pressed is gone: focus goes to what was added, its first control.
    void this.updateComplete.then(async () => {
      const ed = this.renderRoot.querySelector<HTMLElement>('.ed');
      const nested = ed?.querySelector<LitElement>('heo-shadow-editor, heo-value-field');
      if (nested) await nested.updateComplete;
      const target = (ed ? firstFocusable(ed) : null) ?? this.#chip(this.picked);
      target?.focus({ preventScroll: true });
    });
  }

  /** Remove a part, and keep the keyboard in the chips: on the next, else on the first to add. */
  #remove(index: number): void {
    this.parts = this.parts.filter((_one, at) => at !== index);
    if (this.picked >= this.parts.length) this.picked = this.parts.length - 1;
    else if (this.picked > index) this.picked -= 1;
    this.#emit('filter-change');
    void this.updateComplete.then(() => {
      const next = this.#chip(Math.min(index, this.parts.length - 1)) ?? this.renderRoot.querySelector<HTMLElement>('.add');
      next?.focus({ preventScroll: true });
    });
  }

  #move(from: number, to: number): void {
    if (from === to || !this.parts[from] || !this.parts[to]) return;
    const next = [...this.parts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const pickedPart = this.parts[this.picked];
    this.parts = next;
    this.picked = pickedPart ? next.indexOf(pickedPart) : -1;
    this.#emit('filter-change');
    void this.updateComplete.then(() => this.#chip(to)?.focus({ preventScroll: true }));
  }

  #chip(index: number): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`.fchip[data-part="${index}"] .pick`);
  }

  override render(): TemplateResult {
    const present = new Set(this.parts.map((one) => one.name));
    const unset = FILTER_SPECS.filter((spec) => !present.has(spec.name));
    const picked = this.parts[this.picked];
    return html`
      ${this.parts.length
        ? html`<div>
            <div class="group">Applied, in order</div>
            <div class="chips" role="list" aria-label="Filter functions, in the order they apply">
              ${this.parts.map((part, index) => this.#renderChip(part, index))}
            </div>
          </div>`
        : nothing}
      ${
      /*
       * The picked function's editor right under the chips it edits, then Add. With Add between
       * them, the editor sat a whole list of buttons away from the chip that opened it, and it
       * moved down every time a function was added or removed above it.
       */
      picked ? this.#renderEditor(picked, this.picked) : nothing}
      ${unset.length
        ? html`<div>
            <div class="group">Add</div>
            <div class="chips" role="group" aria-label="Functions not set yet">
              ${unset.map((spec) => html`<button
                class="add"
                type="button"
                data-add=${spec.name}
                title=${`Add ${spec.name}()`}
                @click=${() => this.#add(spec.name)}
              >+ ${spec.name}</button>`)}
            </div>
          </div>`
        : nothing}
    `;
  }

  #renderChip(part: FilterPart, index: number): TemplateResult {
    const text = isEmptyUrl(part) ? 'url(…)' : part.text;
    return html`<div
      class=${part.name ? 'fchip' : 'fchip opaque'}
      role="listitem"
      draggable="true"
      data-part=${index}
      data-picked=${index === this.picked ? 'true' : 'false'}
      @dragstart=${(event: DragEvent) => this.#dragStart(event, index)}
      @dragover=${(event: DragEvent) => this.#dragOver(event)}
      @dragleave=${(event: DragEvent) => (event.currentTarget as HTMLElement).classList.remove('over')}
      @drop=${(event: DragEvent) => this.#drop(event, index)}
      @dragend=${() => {
        this.#dragFrom = null;
      }}
    >
      <button
        class="pick"
        type="button"
        aria-pressed=${index === this.picked ? 'true' : 'false'}
        title=${part.name ? `Edit ${part.name}(). Drag to reorder; Alt and an arrow move it.` : 'Kept as written. Drag to reorder.'}
        @click=${() => {
          this.picked = index;
        }}
        @keydown=${(event: KeyboardEvent) => this.#chipKey(event, index)}
      >
        <span class="g" aria-hidden="true">${icon('grip', 10)}</span>
        <span class="t">${text}</span>
      </button>
      <button
        class="x"
        type="button"
        aria-label=${`Remove ${text}`}
        title=${`Remove ${text}`}
        @click=${() => this.#remove(index)}
      >${icon('close', 9)}</button>
    </div>`;
  }

  #chipKey(event: KeyboardEvent, index: number): void {
    if (!event.altKey) return;
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    this.#move(index, Math.max(0, Math.min(this.parts.length - 1, index + step)));
  }

  #dragFrom: number | null = null;

  #dragStart(event: DragEvent, index: number): void {
    // A drag that starts on the cross is a press of the cross, not the chip moving.
    if ((event.composedPath()[0] as HTMLElement).closest?.('.x')) {
      event.preventDefault();
      return;
    }
    this.#dragFrom = index;
    event.dataTransfer?.setData('text/plain', `filter:${index}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  #dragOver(event: DragEvent): void {
    if (this.#dragFrom === null) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.add('over');
  }

  #drop(event: DragEvent, index: number): void {
    (event.currentTarget as HTMLElement).classList.remove('over');
    const from = this.#dragFrom;
    this.#dragFrom = null;
    if (from === null || from === index) return;
    event.preventDefault();
    this.#move(from, index);
  }

  /* ---------------------------------------------------------------------- */
  /* The picked function's editor                                           */
  /* ---------------------------------------------------------------------- */

  #renderEditor(part: FilterPart, index: number): TemplateResult {
    const spec = part.name ? filterSpec(part.name) : undefined;
    if (!spec) {
      return html`<div class="ed">
        <code>${part.text}</code>
        <p class="note">Not a function this editor knows, so it is kept exactly as written. Edit it in the field.</p>
        <button class="btn sm linkish" type="button" @click=${() => this.#selectInField(part.text)}>Edit in the field</button>
      </div>`;
    }
    if (spec.name === 'drop-shadow') return this.#renderDropShadow(part, index);
    if (spec.name === 'url') return this.#renderUrl(part, index);
    const amount = filterAmount(part);
    if (!amount) {
      return html`<div class="ed">
        <code>${spec.name}()</code>
        <p class="note">${part.text} is not a plain amount here (a calc(), a unit other than ${spec.unit}). Edit it in the field.</p>
        <button class="btn sm linkish" type="button" @click=${() => this.#selectInField(part.text)}>Edit in the field</button>
      </div>`;
    }
    const write = (value: number, settle: boolean): void => {
      if (!Number.isFinite(value)) return;
      this.#set(index, withAmount(spec.name, value, amount.plain), settle);
    };
    const number = html`<span class="num">
      <input
        aria-label=${`${spec.name}, ${spec.unit === '%' ? 'percent' : spec.unit === 'deg' ? 'degrees' : 'pixels'}`}
        inputmode="decimal"
        .value=${String(amount.value)}
        @input=${(event: Event) => {
          // Previewed only once it is a number: drawn back half-typed, "0." would lose its point.
          const text = (event.target as HTMLInputElement).value.trim();
          if (/^-?\d+(?:\.\d+)?$/.test(text)) write(Number(text), false);
        }}
        @change=${(event: Event) => write(Number.parseFloat((event.target as HTMLInputElement).value), true)}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const by = (event.shiftKey ? 10 : 1) * spec.step * (event.key === 'ArrowUp' ? 1 : -1);
          write(Math.max(0, amount.value + by), true);
        }}
      />
      <span>${spec.unit}</span>
    </span>`;
    if (spec.name === 'hue-rotate') {
      return html`<div class="ed">
        <code>hue-rotate()</code>
        <div class="line dial-line">
          <span
            class="dial"
            role="slider"
            tabindex="0"
            aria-label="Hue rotation"
            aria-valuemin="0"
            aria-valuemax="360"
            aria-valuenow=${Math.round(amount.value)}
            title="Drag to turn; Shift snaps to 15°. The arrow keys turn it by 1°, with Shift by 15°."
            @pointerdown=${(event: PointerEvent) => this.#dragDial(event, index)}
            @keydown=${(event: KeyboardEvent) => {
              const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              write((((amount.value + step * (event.shiftKey ? 15 : 1)) % 360) + 360) % 360, true);
            }}
          ><i style=${`transform:rotate(${amount.value + 180}deg)`}></i><b></b></span>
          <span class="hues" style=${`filter:hue-rotate(${amount.value}deg)`} aria-hidden="true"></span>
          ${number}
        </div>
      </div>`;
    }
    return html`<div class="ed">
      <code>${spec.name}()</code>
      <div class="line">
        <input
          type="range"
          aria-label=${spec.name}
          min="0"
          max=${spec.max}
          step=${spec.step}
          .value=${String(Math.min(spec.max, amount.value))}
          @input=${(event: Event) => write(Number((event.target as HTMLInputElement).value), false)}
          @change=${(event: Event) => write(Number((event.target as HTMLInputElement).value), true)}
        />
        ${number}
      </div>
      <div class="scale" aria-hidden="true">
        <span>0</span>
        <span>${NEUTRAL_NOTE(spec)}</span>
        <span>${spec.max}${spec.unit}</span>
      </div>
    </div>`;
  }

  /** drop-shadow(): the shadow editor itself, for one shadow. */
  #renderDropShadow(part: FilterPart, index: number): TemplateResult {
    return html`<div class="ed">
      <code>drop-shadow()</code>
      <heo-shadow-editor
        mode="drop"
        .value=${part.text}
        .tokens=${this.tokens}
        @shadow-input=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (event.detail.value) this.#set(index, { name: 'drop-shadow', text: event.detail.value }, false);
        }}
        @shadow-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (event.detail.value) this.#set(index, { name: 'drop-shadow', text: event.detail.value }, true);
        }}
      ></heo-shadow-editor>
    </div>`;
  }

  /** url(): an SVG filter by reference — the page's own offered, or a file and an id typed in. */
  #renderUrl(part: FilterPart, index: number): TemplateResult {
    const ids = Array.from(document.querySelectorAll('filter[id]'), (one) => one.id).filter(Boolean);
    const suggestions: ValueSuggestion[] = ids.map((id) => ({ value: `#${id}`, group: 'In this page' }));
    const write = (value: string, settle: boolean): void => {
      this.#set(index, urlPart(value.trim()), settle);
    };
    return html`<div class="ed">
      <code>url()</code>
      <heo-value-field
        kind="text"
        field-label="SVG filter reference"
        placeholder="#id or file.svg#id"
        .value=${urlTarget(part)}
        .suggestions=${suggestions}
        @value-input=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          write(event.detail.value, false);
        }}
        @value-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          write(event.detail.value, true);
        }}
        @value-revert=${(event: Event) => event.stopPropagation()}
      ></heo-value-field>
      <p class="note">
        ${ids.length
          ? `An SVG <filter> by its id: ${ids.length} in this page, or one in a file, typed as file.svg#id.`
          : 'An SVG <filter> by its id, typed as #id, or file.svg#id for one in a file. This page has none of its own.'}
        Until it points at one, it is not written: an empty url() would void the whole ${this.property}.
      </p>
    </div>`;
  }

  #selectInField(text: string): void {
    this.dispatchEvent(new CustomEvent('filter-select', { detail: { fn: text }, bubbles: true, composed: true }));
  }

  /** Turn the dial: the angle from its middle to the pointer, previewed, settled on release. */
  #dragDial(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const dial = event.currentTarget as HTMLElement;
    dial.focus({ preventScroll: true });
    try {
      dial.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer: the listeners below still follow it.
    }
    const turn = (at: PointerEvent, settle: boolean): void => {
      const rect = dial.getBoundingClientRect();
      let angle = (Math.atan2(at.clientY - (rect.top + rect.height / 2), at.clientX - (rect.left + rect.width / 2)) * 180) / Math.PI + 90;
      angle = ((angle % 360) + 360) % 360;
      if (at.shiftKey) angle = Math.round(angle / 15) * 15;
      this.#set(index, withAmount('hue-rotate', Math.round(angle) % 360), settle);
    };
    turn(event, false);
    const move = (at: PointerEvent): void => turn(at, false);
    const up = (at: PointerEvent): void => {
      dial.removeEventListener('pointermove', move);
      dial.removeEventListener('pointerup', up);
      dial.removeEventListener('pointercancel', up);
      turn(at, true);
    };
    dial.addEventListener('pointermove', move);
    dial.addEventListener('pointerup', up);
    dial.addEventListener('pointercancel', up);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-filter-editor': HeoFilterEditor;
  }
}
