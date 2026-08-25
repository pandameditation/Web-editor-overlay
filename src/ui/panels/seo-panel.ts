import { css, html, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { HeoElement } from '../context.js';
import { baseStyles } from '../theme.js';
import './seo-form.js';

/**
 * The SEO panel.
 *
 * The head form used to live behind a tab inside the HTML panel, which put it one
 * level too deep: it is not a way of looking at the markup, it is a different job with
 * different fields and its own audience. Its own tab says so.
 *
 * No expand affordance, deliberately — a form of short fields gains nothing from a
 * fullscreen view, unlike a buffer of code.
 */
@customElement('heo-seo-panel')
export class HeoSeoPanel extends HeoElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
      }
      .body {
        padding: 11px 12px;
      }
    `,
  ];

  override render(): TemplateResult {
    return html`<div class="body"><heo-seo-form></heo-seo-form></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-seo-panel': HeoSeoPanel;
  }
}
