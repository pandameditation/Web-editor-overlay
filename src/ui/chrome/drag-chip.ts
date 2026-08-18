import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { labelFor } from '../../core/dom.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * The chip that follows the cursor during a reorder.
 *
 * The page itself already shows the outcome — the element is really moved as you
 * drag — so this only has to answer two questions: what am I holding, and what
 * will happen if I let go. It turns red once the pointer leaves the viewport,
 * which is the cancel gesture.
 */
@customElement('heo-drag-chip')
export class HeoDragChip extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        z-index: 20;
        pointer-events: none;
      }
      .chip {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 30px;
        padding: 0 11px;
        border-radius: 999px;
        font-size: 11.5px;
        white-space: nowrap;
        transform: translate(14px, 14px);
      }
      .chip .what {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }
      .chip .hint {
        color: var(--heo-text-dim);
      }
      .chip .glyph {
        color: var(--heo-accent);
      }
      :host([data-cancel]) .chip {
        border-color: color-mix(in oklab, var(--heo-danger) 55%, transparent);
      }
      :host([data-cancel]) .chip .glyph,
      :host([data-cancel]) .chip .hint {
        color: var(--heo-danger);
      }
      kbd {
        padding: 1px 4px;
        border: 1px solid var(--heo-line);
        border-radius: 4px;
        background: var(--heo-sunken);
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.drag] as const,
    shallowArrayEquals,
  );

  override render(): TemplateResult | typeof nothing {
    const drag = this.state.value.drag;
    if (!drag) return nothing;

    this.toggleAttribute('data-cancel', drag.willCancel);
    this.style.left = `${Math.round(drag.pointer.x)}px`;
    this.style.top = `${Math.round(drag.pointer.y)}px`;

    return html`<div class="chip surface">
      <span class="glyph">${icon(drag.willCancel ? 'close' : 'grip', 13)}</span>
      <span class="what">${labelFor(drag.element)}</span>
      <span class="hint">${drag.hint}</span>
      ${drag.willCancel ? nothing : html`<kbd>Esc</kbd>`}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-drag-chip': HeoDragChip;
  }
}
