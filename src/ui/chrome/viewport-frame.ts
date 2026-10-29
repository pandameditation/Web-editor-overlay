import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * The frame around a viewport preview.
 *
 * The preview narrows the page's root to the chosen width, so everything outside it is the real
 * window showing through: fixed bars that still span it, the page background. Shading that space
 * makes the overflow read as outside the preview rather than as part of the page, and the label
 * says what is being previewed and how to stop.
 *
 * Inert apart from its one button, so the page under the shade can still be selected.
 */
@customElement('heo-viewport-frame')
export class HeoViewportFrame extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 1;
        pointer-events: none;
      }
      .shade {
        position: fixed;
        top: 0;
        bottom: 0;
        background: color-mix(in oklab, var(--heo-bg) 70%, transparent);
      }
      .label {
        position: fixed;
        top: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        height: 30px;
        padding: 0 4px 0 11px;
        border-radius: 999px;
        color: var(--heo-text);
        font-size: 11.5px;
        white-space: nowrap;
        transform: translateX(-50%);
        pointer-events: auto;
      }
      .label .note {
        color: var(--heo-text-dim);
      }
    `,
  ];

  /* Everything the frame's position depends on, so it moves with the dock and the scroll. */
  protected state = new StoreController(
    this,
    this.editor.store,
    (s) =>
      [s.editing, s.previewWidth, s.geometry, s.dockOpen, s.dockWidth, s.dockFloat] as const,
    shallowArrayEquals,
  );

  override render(): TemplateResult | typeof nothing {
    const { editing, previewWidth: width } = this.state.value;
    if (!editing || width === null) return nothing;
    const left = this.editor.viewport.frameLeft - scrollX;
    const right = left + width;
    const wider = width > innerWidth;
    // Centred on the frame, but kept on screen when the frame is wider than the window.
    const middle = Math.min(Math.max(left + width / 2, 120), innerWidth - 120);
    return html`
      ${left > 0 ? html`<div class="shade" style=${`left:0;width:${left}px`}></div>` : nothing}
      ${right < innerWidth
        ? html`<div class="shade" style=${`left:${right}px;right:0`}></div>`
        : nothing}
      <div class="label surface" style=${`left:${middle}px`} role="status">
        <span>
          Previewing ${width}px${wider
            ? html` <span class="note">(wider than this window, scroll to see it)</span>`
            : nothing}
        </span>
        <button
          class="btn sm ghost"
          type="button"
          @click=${() => this.editor.setPreviewWidth(null)}
        >
          ${icon('close', 11)} Back to actual
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-viewport-frame': HeoViewportFrame;
  }
}
