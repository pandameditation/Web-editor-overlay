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
        /*
         * Above every dialog, and that is not a preference.
         *
         * A toast is usually the confirmation *of* something done in a dialog — "Recorded
         * an edit to stories.js", with an Undo attached — so it is the one piece of chrome
         * that can never be the thing that gets covered. It used to sit at 22, below both
         * dialog layers, which meant the reply to an action arrived behind the surface the
         * action was taken on.
         */
        z-index: 40;
        transform: translateX(-50%);
        pointer-events: auto;
      }
      /*
       * The top layer, for the modals a z-index cannot reach.
       *
       * The fullscreen code view and the expanded code editor are native dialog elements
       * opened with showModal(), which puts them in the top layer — above every z-index
       * in the document, however large. The only way to be above *them* is to be in the
       * top layer too, and to enter it later: entries are ordered by when they were
       * shown, and a toast is created fresh each time one appears, so it is always the
       * most recent arrival.
       *
       * Layout has to be restated here because the UA stylesheet gives an open popover
       * inset 0 and margin auto to centre it. Appearance does not: .surface is an author
       * rule and so beats the UA background.
       */
      .toast:popover-open {
        position: fixed;
        inset: auto;
        left: 50%;
        bottom: 22px;
        margin: 0;
        transform: translateX(-50%);
        overflow: visible;
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

  /**
   * Promote into the top layer once the element exists.
   *
   * After every render rather than only the first: a second toast replaces the message
   * inside the same component, and re-showing is what moves it back above a dialog that
   * was opened in between. A browser without popovers throws or no-ops here, and the
   * toast still renders and still sits above both dialog layers on its z-index — which
   * is the only case the old behaviour ever got wrong.
   */
  override updated(): void {
    const toast = this.renderRoot?.querySelector<HTMLElement>('.toast');
    if (!toast || typeof toast.showPopover !== 'function') return;
    if (toast.matches(':popover-open')) return;
    try {
      toast.showPopover();
    } catch {
      /* Unsupported, or already open. The z-index fallback covers it. */
    }
  }

  override render(): TemplateResult | typeof nothing {
    const toast = this.state.value.toast;
    if (!toast) return nothing;

    const glyph = toast.tone === 'success' ? 'check' : toast.tone === 'error' ? 'close' : 'sparkle';

    return html`<div class="toast surface" popover="manual" role="status" aria-live="polite">
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
