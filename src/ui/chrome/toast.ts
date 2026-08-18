import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * Transient feedback.
 *
 * Destructive actions attach an Undo action to their toast, which is the
 * difference between a confirmation dialog for every delete and just letting
 * people work. `role="status"` keeps it announced without stealing focus.
 */
@customElement('heo-toast')
export class HeoToast extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        left: 50%;
        bottom: 22px;
        z-index: 22;
        transform: translateX(-50%);
        pointer-events: auto;
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: min(460px, calc(100vw - 32px));
        padding: 9px 10px 9px 12px;
        border-radius: 999px;
        font-size: 12px;
        animation: rise 220ms var(--heo-ease);
      }
      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
      }
      .glyph {
        display: grid;
        place-items: center;
        color: var(--heo-text-faint);
      }
      .glyph.success {
        color: var(--heo-success);
      }
      .glyph.error {
        color: var(--heo-danger);
      }
      .msg {
        flex: 1 1 auto;
        color: var(--heo-text);
      }
      .close {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .close:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.toast] as const,
    shallowArrayEquals,
  );

  override render(): TemplateResult | typeof nothing {
    const toast = this.state.value.toast;
    if (!toast) return nothing;

    const glyph = toast.tone === 'success' ? 'check' : toast.tone === 'error' ? 'close' : 'sparkle';

    return html`<div class="toast surface" role="status" aria-live="polite">
      <span class=${`glyph ${toast.tone}`}>${icon(glyph, 13)}</span>
      <span class="msg">${toast.message}</span>
      ${toast.action
        ? html`<button
            class="btn sm"
            type="button"
            @click=${() => {
              toast.action!.run();
              this.editor.dismissToast();
            }}
          >
            ${toast.action.label}
          </button>`
        : nothing}
      <button
        class="close"
        type="button"
        aria-label="Dismiss"
        @click=${() => this.editor.dismissToast()}
      >
        ${icon('close', 11)}
      </button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-toast': HeoToast;
  }
}
