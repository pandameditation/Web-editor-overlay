import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A component whose template is instrumented by the Vite plugin, so the demo
 * proves that source markers land inside `html` templates and not just in the
 * HTML file. Selecting the number below should show a source location in the
 * Props panel pointing at this file.
 */
@customElement('heo-demo-stat')
export class HeoDemoStat extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: baseline;
      gap: var(--space-sm, 8px);
      padding: var(--space-md, 16px);
      border: 1px solid var(--border-color, #dfe4ee);
      border-radius: var(--radius-md, 14px);
      background: var(--surface, #fff);
    }
    .value {
      color: var(--accent, #4f46e5);
      font-size: var(--text-xl, 32px);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .label {
      color: var(--ink-muted, #4a5568);
      font-size: var(--text-sm, 14px);
    }
  `;

  @property({ type: String }) value = '0';
  @property({ type: String }) label = '';

  override render() {
    return html`
      <span class="value">${this.value}</span>
      <span class="label">${this.label}</span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-demo-stat': HeoDemoStat;
  }
}
