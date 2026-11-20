import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ModalController } from '../../core/modal.js';
import { tabsOf } from '../../core/panels.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { modLabel } from './toolbar.js';

/**
 * The keyboard shortcuts, from the H menu. Read-only.
 *
 * The panel letters used to be written on nine toolbar buttons. Those buttons are gone, so the
 * letters live in the panel switches' tips and here, both read from the one panel table
 * (`core/panels.ts`) so they cannot drift from what the keymap does.
 */
@customElement('heo-shortcuts-dialog')
export class HeoShortcutsDialog extends HeoElement {
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
        width: min(440px, 100%);
        max-height: 100%;
        border-radius: var(--heo-r-lg);
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 11px;
        padding: 14px 14px 8px 18px;
      }
      h2 {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
      }
      .content {
        overflow: auto;
        padding: 0 18px 16px;
      }
      h3 {
        margin: 12px 0 4px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      dl {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 2px 16px;
        margin: 0;
      }
      dt,
      dd {
        margin: 0;
        padding: 4px 0;
        border-bottom: 1px solid var(--heo-line);
        font-size: 11.5px;
      }
      dd {
        display: flex;
        justify-content: flex-end;
        gap: 3px;
      }
      .note {
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.5;
      }
      kbd {
        display: inline-grid;
        place-items: center;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 5px;
        background: var(--heo-hover);
        color: var(--heo-text);
        font: 500 10.5px var(--heo-mono);
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.shortcutsOpen] as const,
    shallowArrayEquals,
  );

  protected modal = new ModalController(this, { initialFocus: '.close' });

  override render(): TemplateResult | typeof nothing {
    if (!this.state.value.shortcutsOpen) return nothing;
    const mod = modLabel();
    const panel = (side: 'page' | 'selection'): Array<[string, string]> =>
      tabsOf(side).map((tab) => [tab.label, tab.key]);
    const groups: Array<[string, Array<[string, string]>]> = [
      ['Page panel', panel('page')],
      ['Selection panel', panel('selection')],
      [
        'Editing',
        [
          ['Enter or leave edit mode', `${mod} E`],
          ['Undo', `${mod} Z`],
          ['Redo', `⇧ ${mod} Z`],
          ['Review and save changes', `${mod} S`],
          ['Duplicate the selection', `${mod} D`],
          ['Pin the toolbar and panels to the edges, or float them', 'D'],
        ],
      ],
    ];
    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="heo-shortcuts-title"
      @pointerdown=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: KeyboardEvent) => {
        // Kept from the page's keymap and the engine's own handlers: a letter here opens nothing.
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.editor.setShortcuts(false);
      }}
    >
      <header>
        <h2 id="heo-shortcuts-title">Keyboard shortcuts</h2>
        <button
          class="btn icon ghost close"
          type="button"
          aria-label="Close"
          @click=${() => this.editor.setShortcuts(false)}
        >
          ${icon('close', 13)}
        </button>
      </header>
      <div class="content">
        <p class="note">A panel's letter opens its tab; pressed again, it closes the panel.</p>
        ${groups.map(([title, rows]) => html`<h3>${title}</h3>
          <dl>
            ${rows.map(([action, keys]) => html`<dt>${action}</dt>
              <dd>${keys.split(' ').map((key) => html`<kbd>${key}</kbd>`)}</dd>`)}
          </dl>`)}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-shortcuts-dialog': HeoShortcutsDialog;
  }
}
