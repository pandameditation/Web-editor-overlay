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
 * A width wider than the room is scaled to fit by default, and the label says by how much and
 * offers 100% instead; at 100% the page scrolls sideways and the label offers fitting again.
 *
 * Inert apart from its buttons, so the page under the shade can still be selected.
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
        /* At the bottom: the toolbar starts at the top and covered the label's buttons there. */
        bottom: 12px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 2px 8px;
        min-height: 30px;
        padding: 3px 4px 3px 11px;
        border-radius: 15px;
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
    const { scale, overflows, canFit, room } = this.editor.viewport;
    const left = this.editor.viewport.frameLeft - scrollX;
    // What the frame covers on screen: a fitted preview is drawn at `scale`.
    const shown = width * scale;
    const right = left + shown;
    const scaled = scale < 1;
    // At 100% and wider than the room: there is something to scroll to.
    const scrolls = overflows && !scaled;
    /*
     * Centred in the room beside the dock, never on the frame: at 100% the frame runs under the
     * dock and off screen, and centring on it put "Fit to window" where it could not be clicked.
     * Narrower than its text, the label wraps rather than spilling out of the room.
     */
    const placed = `left:${Math.round(room / 2)}px;max-width:${Math.max(160, room - 16)}px`;
    return html`
      ${left > 0 ? html`<div class="shade" style=${`left:0;width:${left}px`}></div>` : nothing}
      ${right < innerWidth
        ? html`<div class="shade" style=${`left:${right}px;right:0`}></div>`
        : nothing}
      <div class="label surface" style=${placed} role="status">
        <span>
          Previewing ${width}px${scaled
            ? html` <span class="note">at ${Math.round(scale * 100)}% to fit</span>`
            : scrolls
              ? html` <span class="note">at 100%, scroll to see it</span>`
              : nothing}
        </span>
        ${scaled || (scrolls && canFit)
          ? html`<button
              class="btn sm ghost"
              type="button"
              data-fit=${scaled ? '100' : 'fit'}
              @click=${() => this.editor.setPreviewFit(!scaled)}
            >
              ${scaled ? 'Show at 100%' : 'Fit to window'}
            </button>`
          : nothing}
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
