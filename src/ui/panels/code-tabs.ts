import { css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CodeTab } from '../../core/editor.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import './code-panel.js';
import './css-panel.js';
import './js-panel.js';

/**
 * The Code panel: one place for the page's HTML, CSS and JavaScript.
 *
 * They were three dock tabs, which read as three unrelated tools and cost three slots
 * in a bar that has better uses for them. They are one subject — the page's source —
 * looked at through three lenses, so they get one tab and a lens switch.
 *
 * The switch writes to the store rather than to local state, which is what lets the
 * fullscreen view show the same language: expanding does not land you somewhere else,
 * and collapsing brings you back to what you were reading.
 */
export const CODE_TABS: Array<{ id: CodeTab; label: string; glyph: string }> = [
  { id: 'html', label: 'HTML', glyph: 'code' },
  { id: 'css', label: 'CSS', glyph: 'styles' },
  { id: 'js', label: 'JS', glyph: 'play' },
];

@customElement('heo-code-tabs')
export class HeoCodeTabs extends HeoElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .strip {
        display: flex;
        gap: 2px;
        flex: 0 0 auto;
        padding: 8px 10px;
        border-bottom: 1px solid var(--heo-line);
      }
      .strip button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        flex: 1 1 auto;
        padding: 5px 10px;
        border: 1px solid transparent;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text-faint);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        transition:
          background var(--heo-fast),
          color var(--heo-fast);
      }
      .strip button:hover {
        color: var(--heo-text);
        background: var(--heo-hover);
      }
      .strip button[data-on] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }
      .strip button:focus-visible {
        outline: 2px solid var(--heo-accent);
        outline-offset: 1px;
      }
      .pane {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
      }
      .pane > * {
        flex: 1 1 auto;
        min-width: 0;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.codeTab] as const,
    shallowArrayEquals,
  );

  /** True for the copy inside the fullscreen view, which has its own tab strip. */
  @property({ type: Boolean }) bare = false;

  override render(): TemplateResult {
    const active = this.state.value.codeTab;
    return html`
      ${this.bare
        ? ''
        : html`<div class="strip" role="tablist" aria-label="Language">
            ${CODE_TABS.map(
          (tab) => html`<button
                type="button"
                role="tab"
                aria-selected=${tab.id === active}
                ?data-on=${tab.id === active}
                @click=${() => this.editor.setCodeTab(tab.id)}
              >
                ${icon(tab.glyph, 12)} ${tab.label}
              </button>`,
        )}
          </div>`}
      <div class="pane">${paneFor(active, this.bare)}</div>
    `;
  }
}

/**
 * The panel for a language.
 *
 * `embedded` is what tells a panel it is already as large as it gets, so it drops the
 * affordance that would expand it again.
 */
export function paneFor(tab: CodeTab, embedded: boolean): TemplateResult {
  switch (tab) {
    case 'css':
      return embedded
        ? html`<heo-css-panel embedded></heo-css-panel>`
        : html`<heo-css-panel></heo-css-panel>`;
    case 'js':
      return embedded
        ? html`<heo-js-panel embedded></heo-js-panel>`
        : html`<heo-js-panel></heo-js-panel>`;
    default:
      return embedded
        ? html`<heo-code-panel embedded></heo-code-panel>`
        : html`<heo-code-panel></heo-code-panel>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-code-tabs': HeoCodeTabs;
  }
}
