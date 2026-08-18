import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { Z_BASE } from '../core/constants.js';
import { shallowArrayEquals, StoreController } from '../core/store.js';
import { HeoElement } from './context.js';
import { baseStyles, themeVariables } from './theme.js';

import './chrome/toolbar.js';
import './chrome/selection-layer.js';
import './chrome/quick-menu.js';
import './chrome/insert-menu.js';
import './chrome/text-toolbar.js';
import './chrome/drag-chip.js';
import './chrome/toast.js';
import './chrome/save-dialog.js';
import './chrome/dock.js';

/**
 * The overlay root.
 *
 * Owns the theme variables — which every descendant inherits through their shadow
 * boundaries — and decides which pieces of chrome exist at any moment. Children
 * are created and destroyed rather than hidden, so a closed panel costs nothing
 * and cannot hold a stale reference to a detached element.
 *
 * The host itself is inert to the pointer; each child opts back in. Without that,
 * a full-viewport overlay would swallow every click on the page underneath.
 */
@customElement('heo-overlay')
export class HeoOverlay extends HeoElement {
  static override styles = [
    themeVariables,
    baseStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        display: block;
        pointer-events: none;
        z-index: ${Z_BASE};
        color-scheme: dark;
      }
      :host([data-theme='light']) {
        color-scheme: light;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) =>
      [
        s.editing,
        s.dockOpen,
        s.quickMenuOpen,
        s.insertAnchor,
        s.textEditing,
        s.drag,
        s.toast,
        s.savePreview,
        s.theme,
        s.accent,
      ] as const,
    shallowArrayEquals,
  );

  override render(): TemplateResult {
    const state = this.state.value;

    this.dataset.theme = state.theme;
    this.style.setProperty('--heo-accent', state.accent);
    // The page needs to know about edit mode so text selection and cursors can be
    // adjusted; see the page stylesheet installed at mount.
    document.documentElement.toggleAttribute('data-heo-edit', state.editing);

    return html`
      ${state.editing ? html`<heo-selection-layer></heo-selection-layer>` : nothing}
      <heo-toolbar></heo-toolbar>
      ${state.editing && state.dockOpen ? html`<heo-dock></heo-dock>` : nothing}
      ${state.editing && state.quickMenuOpen ? html`<heo-quick-menu></heo-quick-menu>` : nothing}
      ${state.editing && state.insertAnchor ? html`<heo-insert-menu></heo-insert-menu>` : nothing}
      ${state.editing && state.textEditing ? html`<heo-text-toolbar></heo-text-toolbar>` : nothing}
      ${state.drag ? html`<heo-drag-chip></heo-drag-chip>` : nothing}
      ${state.toast ? html`<heo-toast></heo-toast>` : nothing}
      ${state.savePreview != null ? html`<heo-save-dialog></heo-save-dialog>` : nothing}
    `;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.documentElement.removeAttribute('data-heo-edit');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-overlay': HeoOverlay;
  }
}
