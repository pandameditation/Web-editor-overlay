import { css, html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { formatLength, parseLength } from '../../core/css.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import './value-field.js';
import type { HeoValueField, ValueSuggestion } from './value-field.js';

export type BoxSide = 'top' | 'right' | 'bottom' | 'left';
const SIDES: BoxSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * Visual margin and padding editor.
 *
 * Modelled on the box diagram every developer already knows from devtools, but
 * with each side directly editable. Two decisions make it fast in practice:
 * every side scrubs horizontally so nudging spacing needs no typing, and edits
 * write the individual longhand rather than the shorthand — writing
 * `margin: 8px 0 0 0` when the user only touched the top would silently reset the
 * other three sides that a class was setting.
 *
 * Declared values render solid; values inherited from the cascade render dimmed,
 * so it is always clear what this element actually sets.
 *
 * Fires `box-change` with `{ declarations }`.
 */
@customElement('heo-box-editor')
export class HeoBoxEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      /* The horizontal bands have to be wide enough to hold a side field
         entirely inside them; centring the fields on the borders instead makes
         the margin and padding values of the same side overlap. */
      .frame {
        position: relative;
        padding: 21px 37px;
        border: 1px dashed color-mix(in oklab, var(--heo-warn) 45%, transparent);
        border-radius: var(--heo-r-md);
        background: color-mix(in oklab, var(--heo-warn) 6%, transparent);
      }
      .frame.inner {
        padding: 19px 33px;
        border-color: color-mix(in oklab, var(--heo-success) 45%, transparent);
        background: color-mix(in oklab, var(--heo-success) 7%, transparent);
      }

      .tag {
        position: absolute;
        top: 3px;
        left: 6px;
        color: var(--heo-text-faint);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        pointer-events: none;
      }

      .core {
        display: grid;
        place-items: center;
        height: 28px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        overflow: hidden;
        white-space: nowrap;
      }

      /* Sides are absolutely positioned so the diagram keeps its shape at any
         panel width, which a grid would not guarantee with 8 inputs. */
      .side {
        position: absolute;
        width: 33px;
        height: 18px;
        padding: 0 1px;
        border: 1px solid transparent;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        text-align: center;
        cursor: ew-resize;
        touch-action: none;
        transition:
          background var(--heo-fast),
          border-color var(--heo-fast);
      }
      .side:hover {
        background: var(--heo-raised);
        border-color: var(--heo-line-strong);
      }
      .side:focus {
        outline: none;
        background: var(--heo-bg);
        border-color: var(--heo-accent-line);
        cursor: text;
      }
      .side.inherited {
        color: var(--heo-text-faint);
      }
      .side.token {
        color: var(--heo-accent);
      }
      .side.active {
        background: var(--heo-accent-soft);
        border-color: var(--heo-accent-line);
      }

      .editor {
        margin-top: 9px;
        padding: 8px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .editor-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 6px;
      }
      .editor-name {
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }

      .side.top {
        top: 2px;
        left: 50%;
        transform: translateX(-50%);
      }
      .side.bottom {
        bottom: 2px;
        left: 50%;
        transform: translateX(-50%);
      }
      .side.left {
        left: 2px;
        top: 50%;
        transform: translateY(-50%);
      }
      .side.right {
        right: 2px;
        top: 50%;
        transform: translateY(-50%);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 7px;
      }
      .legend {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .key {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .tip {
        margin: 7px 0 0;
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.4;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 2px;
      }
      .dot.m {
        background: color-mix(in oklab, var(--heo-warn) 70%, transparent);
      }
      .dot.p {
        background: color-mix(in oklab, var(--heo-success) 70%, transparent);
      }
    `,
  ];

  /** Declared values, keyed by longhand, e.g. `margin-top`. */
  @property({ attribute: false }) declared: Record<string, string> = {};
  /** Computed values, used as dimmed placeholders where nothing is declared. */
  @property({ attribute: false }) computed: Record<string, string> = {};
  /** Token suggestions offered when a side is opened for editing. */
  @property({ attribute: false }) suggestions: ValueSuggestion[] = [];

  @state() private linked = false;
  /** Which side, if any, is open in the token/unit editor. */
  @state() private editing: string | null = null;

  override render(): TemplateResult {
    return html`
      <div class="head">
        <div class="legend">
          <span class="key"><span class="dot m"></span>margin</span>
          <span class="key"><span class="dot p"></span>padding</span>
        </div>
        <button
          class="btn sm ghost"
          type="button"
          aria-pressed=${this.linked}
          title=${this.linked ? 'Editing all four sides together' : 'Edit each side on its own'}
          @click=${() => {
        this.linked = !this.linked;
      }}
        >
          ${icon(this.linked ? 'link' : 'unlink', 12)} ${this.linked ? 'Linked' : 'Sides'}
        </button>
      </div>

      <div class="frame">
        <span class="tag">margin</span>
        ${SIDES.map((side) => this.#renderSide('margin', side))}
        <div class="frame inner">
          <span class="tag">padding</span>
          ${SIDES.map((side) => this.#renderSide('padding', side))}
          <div class="core" title="Content box">${this.#coreLabel()}</div>
        </div>
      </div>
      ${this.editing
        ? this.#renderSideEditor(this.editing)
        : html`<p class="tip">Drag a side to change it, or double-click for tokens and units.</p>`}
    `;
  }

  /**
   * Full editor for one side, opened from the diagram.
   *
   * The 33px fields in the diagram are right for dragging and for typing `12px`,
   * but far too small for `var(--space-lg)` or a unit menu. Rather than grow them
   * and wreck the diagram, selecting a side reveals the same token-aware control
   * used everywhere else in the panel.
   */
  #renderSideEditor(property: string): TemplateResult {
    const value = this.declared[property] ?? '';
    const computed = this.computed[property] ?? '';
    return html`<div class="editor">
      <div class="editor-head">
        <span class="editor-name">${property}</span>
        <button
          class="btn sm ghost"
          type="button"
          aria-label="Close"
          @click=${() => {
        this.editing = null;
      }}
        >
          ${icon('close', 11)}
        </button>
      </div>
      <heo-value-field
        .value=${value}
        kind="length"
        .property=${property}
        .suggestions=${this.suggestions}
        placeholder=${computed}
        clearable
        @value-change=${(event: CustomEvent<{ value: string }>) =>
        this.#emit(property, event.detail.value)}
      ></heo-value-field>
    </div>`;
  }

  /**
   * Open a side for editing, with its value list already showing.
   *
   * Selecting a side is asking "what else could this be", and the answer is the project's spacing
   * scale — so the list is what should arrive, not an empty focused box the user then has to open.
   * The field is asked for it directly rather than being left to a focus handler, because opening on
   * focus alone would also fire when the caret merely passes through.
   */
  #openSide(property: string | null): void {
    this.editing = property;
    if (!property) return;
    void this.updateComplete.then(() => {
      const field = this.renderRoot.querySelector<HeoValueField>('.editor heo-value-field');
      field?.focusInput({ select: true });
      field?.openList();
    });
  }

  #coreLabel(): string {
    const width = this.computed.width ?? 'auto';
    const height = this.computed.height ?? 'auto';
    return `${short(width)} × ${short(height)}`;
  }

  #renderSide(group: 'margin' | 'padding', side: BoxSide): TemplateResult {
    const property = `${group}-${side}`;
    const declared = (this.declared[property] ?? '').trim();
    const computed = (this.computed[property] ?? '').trim();
    const value = declared || '';
    const isToken = declared.includes('var(--');
    const classes = ['side', side, declared ? '' : 'inherited', isToken ? 'token' : '']
      .filter(Boolean)
      .join(' ');

    return html`<input
      class=${`${classes}${this.editing === property ? ' active' : ''}`}
      .value=${isToken ? tokenShort(declared) : value}
      placeholder=${short(computed) || '0'}
      spellcheck="false"
      autocomplete="off"
      aria-label=${`${group} ${side}`}
      title=${declared
        ? `${property}: ${declared} — drag to change, double-click for tokens and units`
        : `${property} is ${computed || 'not set'} — drag to change, double-click for tokens and units`}
      @pointerdown=${(event: PointerEvent) => this.#onScrub(event, property, declared || computed)}
      @dblclick=${() => this.#openSide(this.editing === property ? null : property)}
      @keydown=${(event: KeyboardEvent) => this.#onKeyDown(event, property)}
      @change=${(event: Event) => this.#commitInput(event, property)}
      @focus=${(event: Event) => this.#onFocus(event, declared, computed)}
    />`;
  }

  /** Reveal the real value on focus, since tokens render abbreviated. */
  #onFocus(event: Event, declared: string, computed: string): void {
    const input = event.target as HTMLInputElement;
    input.value = declared || '';
    if (!declared) input.placeholder = short(computed) || '0';
    input.select();
  }

  #onKeyDown(event: KeyboardEvent, property: string): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      input.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.#emit(property, input.value);
      input.blur();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const step = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1);
      const parsed = parseLength(input.value) ?? { number: 0, unit: 'px' };
      const next = formatLength(parsed.number + step, parsed.unit);
      input.value = next;
      this.#emit(property, next);
    }
  }

  #commitInput(event: Event, property: string): void {
    const input = event.target as HTMLInputElement;
    this.#emit(property, input.value);
  }

  #onScrub(event: PointerEvent, property: string, current: string): void {
    const input = event.target as HTMLInputElement;
    // Once focused the field behaves as a text input; scrubbing would fight the
    // caret, so only the unfocused state starts a drag.
    if (this.shadowRoot?.activeElement === input) return;
    event.preventDefault();

    const start = parseLength(current) ?? { number: 0, unit: 'px' };
    const startX = event.clientX;
    let moved = false;
    input.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      const scale = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
      const next = formatLength(start.number + Math.round(dx) * scale, start.unit || 'px');
      input.value = next;
      this.#emit(property, next);
    };
    const up = (): void => {
      input.removeEventListener('pointermove', move);
      input.removeEventListener('pointerup', up);
      input.removeEventListener('pointercancel', up);
      // A click without movement should place the caret instead.
      if (!moved) input.focus();
    };
    input.addEventListener('pointermove', move);
    input.addEventListener('pointerup', up);
    input.addEventListener('pointercancel', up);
  }

  #emit(property: string, rawValue: string): void {
    const value = rawValue.trim();
    const declarations: Record<string, string> = {};
    if (this.linked) {
      const group = property.startsWith('margin') ? 'margin' : 'padding';
      for (const side of SIDES) declarations[`${group}-${side}`] = value;
    } else {
      declarations[property] = value;
    }
    this.dispatchEvent(
      new CustomEvent('box-change', {
        detail: { declarations },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/** `var(--space-lg)` shows as `space-lg` so it fits a 46px field. */
function tokenShort(value: string): string {
  return /var\(\s*--([\w-]+)/.exec(value)?.[1] ?? value;
}

function short(value: string): string {
  const parsed = parseLength(value);
  if (!parsed) return value === '0px' ? '0' : value;
  if (parsed.number === 0) return '0';
  return formatLength(Math.round(parsed.number * 10) / 10, parsed.unit);
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-box-editor': HeoBoxEditor;
  }
}
