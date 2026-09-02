import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ModalController } from '../../core/modal.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * The one dialog that asks before something cannot be taken back.
 *
 * Generic on purpose. Every other dialog here is a surface for one job and knows what it is
 * editing; this one knows nothing except the sentence it was handed, because the alternative is
 * a bespoke confirmation per destructive action and four different opinions about where the
 * Cancel button goes.
 *
 * What it insists on saying, and the reason it exists rather than a `window.confirm`:
 *
 * - The **title is the question** and the **primary button is the answer**, named after the
 *   action. "OK" makes the user re-read the sentence to work out which way round it was.
 * - Whether **undo will get it back**. This is the single most useful fact at the moment of
 *   hesitation, and it is the one a native prompt can never tell you. It also keeps the
 *   product honest: an action that says "this cannot be undone" has to mean it.
 * - **Cancel leads.** It is first in the DOM and it takes the initial focus, so the reflex
 *   press of Return or Escape is the safe one. The destructive button has to be aimed at.
 */
@customElement('heo-confirm-dialog')
export class HeoConfirmDialog extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: grid;
        place-items: center;
        padding: 24px;
        background: oklch(12% 0.01 265 / 55%);
        backdrop-filter: blur(3px);
        pointer-events: auto;
      }

      .dialog {
        display: flex;
        flex-direction: column;
        width: min(420px, 100%);
        border-radius: var(--heo-r-lg);
        overflow: hidden;
      }

      header {
        display: flex;
        align-items: flex-start;
        gap: 11px;
        padding: 16px 18px 12px;
      }
      .g {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 26px;
        height: 26px;
        border-radius: 999px;
      }
      .g.danger {
        background: color-mix(in oklab, var(--heo-danger) 18%, transparent);
        color: var(--heo-danger);
      }
      .g.warn {
        background: color-mix(in oklab, var(--heo-warn) 18%, transparent);
        color: var(--heo-warn);
      }
      h2 {
        margin: 3px 0 0;
        font-size: 13.5px;
        font-weight: 600;
      }

      .content {
        padding: 0 18px 4px 55px;
      }
      p {
        margin: 0 0 8px;
        color: var(--heo-text-dim);
        font-size: 11.5px;
        line-height: 1.55;
      }
      .detail {
        margin: 0 0 8px;
        padding: 7px 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font-size: 11px;
        line-height: 1.5;
      }
      /* The fact that decides how carefully the rest needs reading, so it is not buried in it. */
      .undoable {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 8px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }

      footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 18px 16px;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.confirm] as const,
    shallowArrayEquals,
  );

  /**
   * Focus lands on Cancel.
   *
   * The keyboard reflex on a dialog is Return, and on this dialog Return must not be the
   * destructive answer. Escape cancels too, through `ModalController`, so both ways out are
   * the safe way out.
   */
  protected modal = new ModalController(this, { initialFocus: '.cancel' });

  override render(): TemplateResult | typeof nothing {
    const ask = this.state.value.confirm;
    if (!ask) return nothing;

    return html`<div
      class="dialog surface"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="heo-confirm-title"
      @pointerdown=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: KeyboardEvent) => {
        // The page keymap is behind an inert layer, but the engine's own capture handlers are
        // not — and Escape there ends a text edit rather than answering this.
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.editor.cancelConfirm();
      }}
    >
      <header>
        <span class=${`g ${ask.tone}`}>${icon('alert', 14)}</span>
        <h2 id="heo-confirm-title">${ask.title}</h2>
      </header>

      <div class="content">
        <p>${ask.message}</p>
        ${ask.detail ? html`<p class="detail">${ask.detail}</p>` : nothing}
        <p class="undoable">
          ${icon(ask.reversible ? 'undo' : 'alert', 11)}
          ${ask.reversible
        ? 'Undo will put this back.'
        : 'This cannot be undone.'}
        </p>
      </div>

      <footer>
        <button
          class="btn cancel"
          type="button"
          @click=${() => this.editor.cancelConfirm()}
        >
          Cancel
        </button>
        <button
          class=${`btn ${ask.tone === 'danger' ? 'danger' : 'primary'}`}
          type="button"
          @click=${() => this.editor.resolveConfirm()}
        >
          ${ask.confirmLabel}
        </button>
      </footer>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-confirm-dialog': HeoConfirmDialog;
  }
}
