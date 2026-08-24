import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import type { CodeWorkspaceTab } from '../../core/editor.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import '../panels/code-panel.js';
import '../panels/css-panel.js';
import '../panels/js-panel.js';

/**
 * The fullscreen code view: HTML, CSS and JS in one place.
 *
 * Each language previously expanded into its own modal, owned by the panel it came
 * from. That made reaching another language a four-step journey — collapse, switch
 * dock tab, find the expand button, expand — and the three views could not be
 * compared at all. This is one shell with a tab strip, so switching language is one
 * click and never costs the expanded view.
 *
 * It hosts the same three panels the dock does rather than reimplementing them. They
 * read their own state from the store, so a source selected here is still selected
 * when the view is collapsed, and a buffer edited in either place is the same buffer.
 * Two views of one thing, not two things.
 */
const TABS: Array<{ id: CodeWorkspaceTab; label: string; glyph: string }> = [
  { id: 'html', label: 'HTML', glyph: 'code' },
  { id: 'css', label: 'CSS', glyph: 'styles' },
  { id: 'js', label: 'JS', glyph: 'play' },
];

@customElement('heo-code-workspace')
export class HeoCodeWorkspace extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      /* A dialog, because the top layer is the only reliable way to sit above a page
         that may itself use z-index freely. */
      dialog.shell {
        display: flex;
        flex-direction: column;
        width: min(1180px, 94vw);
        max-width: none;
        height: min(88vh, 940px);
        max-height: none;
        padding: 0;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-lg);
        /* Opaque, and the same surface the inline expanded view uses. A translucent
           panel with code on it is unreadable, and the name this used before was never
           a real variable: an undefined custom property with no fallback invalidates the
           whole declaration, so the background was computing to transparent. */
        background: var(--heo-bg);
        color: var(--heo-text);
        overflow: hidden;
        pointer-events: auto;
      }
      dialog.shell::backdrop {
        background: rgb(6 8 15 / 62%);
        backdrop-filter: blur(2px);
      }

      header {
        display: flex;
        align-items: center;
        gap: 9px;
        flex: 0 0 auto;
        padding: 10px 13px;
        border-bottom: 1px solid var(--heo-line);
      }
      header .title {
        color: var(--heo-text);
        font-size: 12px;
        font-weight: 600;
      }
      header .spacer {
        flex: 1 1 auto;
      }
      header .hint {
        color: var(--heo-text-faint);
        font-size: 10px;
      }

      .tabs {
        display: flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
      }
      .tabs button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 11px;
        border: 0;
        border-radius: calc(var(--heo-r-sm) - 2px);
        background: transparent;
        color: var(--heo-text-faint);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .tabs button:hover {
        color: var(--heo-text);
      }
      .tabs button[data-on] {
        background: var(--heo-accent);
        color: #fff;
      }
      .tabs button:focus-visible {
        outline: 2px solid var(--heo-accent);
        outline-offset: 1px;
      }

      /* The hosted panel fills the shell. It was built for a dock column, and the only
         thing it needs told is that it now has room. */
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
    (s) => [s.codeWorkspace] as const,
    shallowArrayEquals,
  );

  @query('dialog') private dialog?: HTMLDialogElement;

  override updated(): void {
    const open = this.state.value.codeWorkspace !== null;
    const dialog = this.dialog;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // A modal removed while open leaves the top layer and the page's inertness in an
    // inconsistent state.
    if (this.dialog?.open) this.dialog.close();
  }

  override render(): TemplateResult {
    const active = this.state.value.codeWorkspace;
    return html`<dialog
      class="shell"
      aria-label="Code"
      @cancel=${(event: Event) => {
        // Escape leaves the big view; it never discards a buffer.
        event.preventDefault();
        this.editor.closeCodeWorkspace();
      }}
      @close=${() => this.editor.closeCodeWorkspace()}
      @keydown=${(event: KeyboardEvent) => this.#onKeyDown(event)}
    >
      ${active ? this.#renderBody(active) : nothing}
    </dialog>`;
  }

  #renderBody(active: CodeWorkspaceTab): TemplateResult {
    return html`
      <header>
        ${icon('code', 14)}
        <span class="title">Code</span>
        <div class="tabs" role="tablist" aria-label="Language">
          ${TABS.map(
      (tab) => html`<button
              type="button"
              role="tab"
              aria-selected=${tab.id === active}
              ?data-on=${tab.id === active}
              @click=${() => this.editor.setCodeWorkspaceTab(tab.id)}
            >
              ${icon(tab.glyph, 11)} ${tab.label}
            </button>`,
    )}
        </div>
        <span class="spacer"></span>
        <span class="hint">${modKey()}+1/2/3 to switch · Esc to close</span>
        <button
          class="btn sm"
          type="button"
          title="Back to the panel"
          @click=${() => this.editor.closeCodeWorkspace()}
        >
          ${icon('collapse', 12)} Collapse
        </button>
      </header>
      <div class="pane">${paneFor(active)}</div>
    `;
  }

  /**
   * Keys handled here, and stopped from reaching the page.
   *
   * Without the stop, typing in a buffer would also drive the page keymap — the trap
   * that has bitten every editing surface in this codebase, because the engine's own
   * listener is registered in the capture phase.
   */
  #onKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.editor.closeCodeWorkspace();
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    const index = ['1', '2', '3'].indexOf(event.key);
    if (index === -1) return;
    event.preventDefault();
    this.editor.setCodeWorkspaceTab(TABS[index].id);
  }
}

function paneFor(tab: CodeWorkspaceTab): TemplateResult {
  switch (tab) {
    case 'css':
      return html`<heo-css-panel embedded></heo-css-panel>`;
    case 'js':
      return html`<heo-js-panel embedded></heo-js-panel>`;
    default:
      return html`<heo-code-panel embedded></heo-code-panel>`;
  }
}

function modKey(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-code-workspace': HeoCodeWorkspace;
  }
}
