import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { labelFor } from '../../core/dom.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { PanelId } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

import '../panels/styles-panel.js';
import '../panels/tokens-panel.js';
import '../panels/tree-panel.js';
import '../panels/library-panel.js';
import '../panels/props-panel.js';
import '../panels/media-panel.js';
import '../panels/code-panel.js';
import '../panels/css-panel.js';

const TABS: Array<{ id: PanelId; label: string; glyph: string }> = [
  { id: 'styles', label: 'Styles', glyph: 'styles' },
  { id: 'tokens', label: 'Tokens', glyph: 'droplet' },
  { id: 'tree', label: 'Tree', glyph: 'tree' },
  { id: 'library', label: 'Library', glyph: 'blocks' },
  { id: 'props', label: 'Props', glyph: 'sliders' },
  { id: 'media', label: 'Media', glyph: 'image' },
  { id: 'code', label: 'HTML', glyph: 'code' },
  { id: 'css', label: 'CSS', glyph: 'styles' },
];

/**
 * The docked side panel.
 *
 * One dock with switchable tabs rather than several floating windows: at this
 * information density, overlapping panels spend more time being moved than used.
 * The width is draggable and clamped, and the whole dock is inert to the page
 * beneath it so clicking inside never changes the selection.
 */
@customElement('heo-dock')
export class HeoDock extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        right: 14px;
        top: 14px;
        bottom: 14px;
        z-index: 10;
        pointer-events: auto;
        display: block;
      }

      .dock {
        display: flex;
        flex-direction: column;
        height: 100%;
        border-radius: var(--heo-r-lg);
        overflow: hidden;
        animation: slide 220ms var(--heo-ease);
      }
      @keyframes slide {
        from {
          opacity: 0;
          transform: translateX(14px);
        }
      }

      .grab {
        position: absolute;
        left: -3px;
        top: 0;
        bottom: 0;
        width: 8px;
        cursor: ew-resize;
        touch-action: none;
        z-index: 2;
      }
      .grab::after {
        content: '';
        position: absolute;
        left: 3px;
        top: 50%;
        width: 2px;
        height: 34px;
        border-radius: 2px;
        background: var(--heo-line-strong);
        transform: translateY(-50%);
        opacity: 0;
        transition: opacity var(--heo-fast);
      }
      .grab:hover::after {
        opacity: 1;
      }

      header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 11px 12px 9px;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      header:active {
        cursor: grabbing;
      }
      /* Controls inside the header must not start a drag. */
      header .btn {
        cursor: pointer;
      }
      .grip-dots {
        display: grid;
        place-items: center;
        color: var(--heo-text-faint);
        flex: 0 0 auto;
      }
      :host([data-floating]) .grip-dots {
        color: var(--heo-accent);
      }
      .title {
        flex: 1 1 auto;
        min-width: 0;
      }
      .title .name {
        font-size: 13px;
        font-weight: 600;
      }
      .title .target {
        display: block;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Wraps rather than scrolls: a horizontally scrolled tab strip hides tabs
         with no affordance, and at 340px seven of them never fit on one line. */
      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        padding: 0 8px 8px;
        border-bottom: 1px solid var(--heo-line);
      }
      .tab {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        flex: 0 0 auto;
        height: 26px;
        padding: 0 9px;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text-faint);
        font-size: 11.5px;
        cursor: pointer;
        transition:
          background var(--heo-fast),
          color var(--heo-fast);
      }
      .tab:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .tab[aria-selected='true'] {
        background: var(--heo-accent-soft);
        color: var(--heo-text);
        box-shadow: inset 0 0 0 1px var(--heo-accent-line);
      }

      .body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      @media (max-width: 760px) {
        :host:not([data-floating]) {
          left: 8px;
          right: 8px;
          top: auto;
          bottom: 8px;
          height: 62vh;
        }
        .grab {
          display: none;
        }
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.dockOpen, s.dockTab, s.selected, s.dockWidth, s.dockFloat] as const,
    shallowArrayEquals,
  );

  override render(): TemplateResult | typeof nothing {
    const state = this.state.value;
    if (!state.dockOpen) return nothing;

    this.#applyGeometry(state.dockWidth, state.dockFloat);
    const tab = TABS.find((entry) => entry.id === state.dockTab) ?? TABS[0];

    return html`<div class="dock surface">
      <div class="grab" title="Drag to resize" @pointerdown=${this.#onResize}></div>

      <header @pointerdown=${this.#onDragStart}>
        <span class="grip-dots" title="Drag to move the panel">${icon('grip', 12)}</span>
        <div class="title">
          <div class="name">${tab.label}</div>
          <span class="target">
            ${state.selected ? labelFor(state.selected) : 'Nothing selected'}
          </span>
        </div>
        ${state.dockFloat
        ? html`<button
              class="btn icon ghost"
              type="button"
              aria-label="Dock to the right edge"
              title="Dock to the right edge"
              @click=${() => this.editor.resetDockPosition()}
            >
              ${icon('panel', 14)}
            </button>`
        : nothing}
        <button
          class="btn icon ghost"
          type="button"
          aria-label="Close panel"
          title="Close panel"
          @click=${() => this.editor.setDock(false)}
        >
          ${icon('close', 14)}
        </button>
      </header>

      <div class="tabs" role="tablist">
        ${TABS.map(
          (entry) => html`<button
            class="tab"
            role="tab"
            aria-selected=${entry.id === state.dockTab}
            @click=${() => this.editor.setDockTab(entry.id)}
          >
            ${icon(entry.glyph, 13)} ${entry.label}
          </button>`,
        )}
      </div>

      <div class="body" role="tabpanel">${this.#renderPanel(state.dockTab)}</div>
    </div>`;
  }

  #renderPanel(tab: PanelId): TemplateResult {
    switch (tab) {
      case 'styles':
        return html`<heo-styles-panel></heo-styles-panel>`;
      case 'tokens':
        return html`<heo-tokens-panel></heo-tokens-panel>`;
      case 'tree':
        return html`<heo-tree-panel></heo-tree-panel>`;
      case 'library':
        return html`<heo-library-panel></heo-library-panel>`;
      case 'props':
        return html`<heo-props-panel></heo-props-panel>`;
      case 'media':
        return html`<heo-media-panel></heo-media-panel>`;
      case 'code':
        return html`<heo-code-panel></heo-code-panel>`;
      case 'css':
        return html`<heo-css-panel></heo-css-panel>`;
      default:
        return html`<div class="empty">Unknown panel.</div>`;
    }
  }

  /**
   * Switch between edge-anchored and free-floating layout.
   *
   * Anchored is the default and stays responsive to window height. Once dragged,
   * the dock keeps an explicit box, which is what lets it be parked over a wide
   * page's empty space instead of covering the content being edited.
   */
  #applyGeometry(width: number, float: { x: number; y: number; height: number } | null): void {
    this.style.width = `${width}px`;
    this.toggleAttribute('data-floating', Boolean(float));
    if (!float) {
      this.style.removeProperty('left');
      this.style.removeProperty('height');
      this.style.right = '14px';
      this.style.top = '14px';
      this.style.bottom = '14px';
      return;
    }
    this.style.removeProperty('right');
    this.style.removeProperty('bottom');
    this.style.left = `${float.x}px`;
    this.style.top = `${float.y}px`;
    this.style.height = `${float.height}px`;
  }

  #onDragStart(event: PointerEvent): void {
    // A press on a button in the header is a button press, not a drag.
    if (event.composedPath().some((node) => node instanceof HTMLElement && node.closest?.('.btn'))) {
      return;
    }
    event.preventDefault();

    const box = this.getBoundingClientRect();
    const offset = { x: event.clientX - box.left, y: event.clientY - box.top };
    const height = box.height;
    const header = event.currentTarget as HTMLElement;
    header.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      this.editor.setDockFloat(moveEvent.clientX - offset.x, moveEvent.clientY - offset.y, height);
    };
    const up = (): void => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', up);
      header.removeEventListener('pointercancel', up);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
    header.addEventListener('pointercancel', up);
  }

  #onResize(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = this.state.value.dockWidth;
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      // The dock is right-anchored, so dragging left grows it.
      this.editor.setDockWidth(startWidth - (moveEvent.clientX - startX));
    };
    const up = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-dock': HeoDock;
  }
}
