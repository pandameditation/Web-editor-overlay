import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { DOCKED_BAR_HEIGHT } from '../../core/constants.js';
import { labelFor } from '../../core/dom.js';
import { tabFor, tabsOf, type PanelSide } from '../../core/panels.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { PanelId } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { tip, tipId, tipStyles } from '../controls/tip.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

import '../panels/styles-panel.js';
import '../panels/tokens-panel.js';
import '../panels/tree-panel.js';
import '../panels/library-panel.js';
import '../panels/props-panel.js';
import '../panels/media-panel.js';
import '../panels/code-tabs.js';
import '../panels/seo-panel.js';

/** One side's fields in the store, read the same way for both panels. */
interface SideState {
  open: boolean;
  tab: PanelId;
  width: number;
  float: { x: number; y: number; height: number } | null;
}

/**
 * A side panel: the page panel on the left, or the selection panel on the right.
 *
 * Two docks, each with its own tabs, rather than one dock with all eight: what describes the
 * page (layers, blocks, tokens, SEO) and what describes the selected element (styles, props,
 * media, code) are used side by side, and one dock made the user give up one to see the other.
 * Each is resizable from its inner edge, can be moved by its header row while floating, and is
 * inert to the page beneath it so clicking inside never changes the selection.
 *
 * Pinned (layout dock), a panel sits flush to its window edge under the toolbar and cannot be
 * moved; it can still be resized.
 */
@customElement('heo-dock')
export class HeoDock extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    tipStyles,
    css`
      :host {
        position: fixed;
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
      :host([data-side='page']) .dock {
        animation-name: slide-page;
      }
      @keyframes slide-page {
        from {
          opacity: 0;
          transform: translateX(-14px);
        }
      }
      /* Pinned: flush to the window edge, square, and drawn as part of the frame. */
      :host([data-layout='dock']) .dock {
        border-width: 0 0 0 1px;
        border-radius: 0;
        animation: none;
        /* Opaque, like the pinned bar (see toolbar.ts): a frame around the page, not glass on it. */
        background: var(--heo-bg);
        box-shadow: none;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }
      :host([data-layout='dock'][data-side='page']) .dock {
        border-width: 0 1px 0 0;
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
      /* The page panel is anchored on the left, so its inner edge is the right one. */
      :host([data-side='page']) .grab {
        left: auto;
        right: -3px;
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
      :host([data-layout='dock']) header {
        cursor: default;
      }
      /* Controls inside the header must not start a drag. */
      header .btn {
        position: relative;
        cursor: pointer;
      }
      /* Right-aligned to its button, which sits at the panel's edge: centred, it was clipped. */
      header .tip {
        left: auto;
        right: 0;
        transform: none;
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
        position: relative;
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        padding: 0 8px 8px;
        border-bottom: 1px solid var(--heo-line);
      }
      /*
       * Tab tips hang under the whole strip rather than under their tab: the panel clips its
       * content, and a tip centred under the last tab ran out past the panel's edge.
       */
      .tabs .tip {
        top: calc(100% + 4px);
        left: 8px;
        right: 8px;
        width: auto;
        max-width: none;
        transform: none;
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

      /*
       * No narrow-window bottom sheet. The old rule under 760px set left and height in this sheet
       * while the geometry wrote right, top and bottom inline, so the inline box won half the
       * fight: the dock landed at left 8px, 62vh tall, with its resize grab hidden. With two
       * panels it drew the selection panel over the page panel and hid both grabs.
       */
    `,
  ];

  /** Which panel this is. Reflected as data-side for the styles. */
  @property() side: PanelSide = 'selection';

  /*
   * Both sides' fields, rather than a selector that reads this.side: the controller runs its
   * selector before the side attribute is applied, and a slice taken for the wrong side would
   * then never notice its own panel changing.
   */
  protected state = new StoreController(
    this,
    this.editor.store,
    (s) =>
      [
        s.dockOpen,
        s.dockTab,
        s.dockWidth,
        s.dockFloat,
        s.pageOpen,
        s.pageTab,
        s.pageWidth,
        s.pageFloat,
        s.selected,
        s.layout,
      ] as const,
    shallowArrayEquals,
  );

  #side(): SideState {
    const s = this.editor.store.value;
    return this.side === 'page'
      ? { open: s.pageOpen, tab: s.pageTab, width: s.pageWidth, float: s.pageFloat }
      : { open: s.dockOpen, tab: s.dockTab, width: s.dockWidth, float: s.dockFloat };
  }

  override render(): TemplateResult | typeof nothing {
    const page = this.side === 'page';
    const side = this.#side();
    const docked = this.editor.store.value.layout === 'dock';
    const selected = this.editor.store.value.selected;
    this.dataset.side = this.side;
    this.dataset.layout = docked ? 'dock' : 'float';
    if (!side.open) return nothing;

    // A box parked while floating means nothing once pinned to the edge, so it is ignored there
    // (and kept, for when the panels float again).
    const float = docked ? null : side.float;
    this.#applyGeometry(side.width, float, docked);
    const tabs = tabsOf(this.side);
    const current = tabs.find((entry) => entry.id === side.tab) ?? tabs[0]!;
    const title = page ? 'Page' : tabFor(current.id).label;
    const target = page
      ? document.title || 'Untitled page'
      : selected
        ? labelFor(selected)
        : 'Nothing selected';
    const back = page ? 'Back to the left edge' : 'Back to the right edge';
    const close = page ? 'Close the page panel' : 'Close the selection panel';

    return html`<div class="dock surface">
      <div
        class="grab"
        role="separator"
        aria-orientation="vertical"
        aria-label=${page ? 'Resize the page panel' : 'Resize the selection panel'}
        @pointerdown=${this.#onResize}
      ></div>

      <header @pointerdown=${docked ? null : this.#onDragStart}>
        ${docked
        ? nothing
        : html`<span class="grip-dots" aria-hidden="true">${icon('grip', 12)}</span>`}
        <div class="title">
          <div class="name">${title}</div>
          <span class="target">${target}</span>
        </div>
        ${float
        ? html`<button
              class="btn icon ghost"
              type="button"
              aria-label=${back}
              aria-describedby=${tipId(back)}
              @click=${() => this.editor.resetPanelPosition(this.side)}
            >
              ${icon(page ? 'snapLeft' : 'snapRight', 14)} ${tip(back)}
            </button>`
        : nothing}
        <button
          class="btn icon ghost"
          type="button"
          aria-label="Close panel"
          aria-describedby=${tipId(close)}
          @click=${() => this.editor.setPanelOpen(this.side, false)}
        >
          ${icon('close', 14)} ${tip(close)}
        </button>
      </header>

      <div class="tabs" role="tablist">
        ${tabs.map(
          (entry) => html`<button
            class="tab"
            role="tab"
            data-tab=${entry.id}
            aria-label=${entry.label}
            aria-selected=${entry.id === side.tab}
            aria-describedby=${tipId(entry.label)}
            @click=${() => this.editor.setDockTab(entry.id)}
          >
            ${icon(entry.glyph, 13)} <span class="label">${entry.label}</span>
            ${tip(entry.label, entry.key, entry.hint)}
          </button>`,
        )}
      </div>

      <div class="body" role="tabpanel">${this.#renderPanel(current.id)}</div>
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
        return html`<heo-code-tabs></heo-code-tabs>`;
      case 'seo':
        return html`<heo-seo-panel></heo-seo-panel>`;
      default:
        return html`<div class="empty">Unknown panel.</div>`;
    }
  }

  /**
   * Switch between edge-anchored, free-floating and pinned layout.
   *
   * Anchored is the default and stays responsive to window height. Once dragged,
   * the panel keeps an explicit box, which is what lets it be parked over a wide
   * page's empty space instead of covering the content being edited. Pinned, it is
   * flush to its edge from under the toolbar to the bottom of the window.
   */
  #applyGeometry(
    width: number,
    float: { x: number; y: number; height: number } | null,
    docked: boolean,
  ): void {
    const edge = this.side === 'page' ? 'left' : 'right';
    const other = this.side === 'page' ? 'right' : 'left';
    this.style.width = `${width}px`;
    this.toggleAttribute('data-floating', Boolean(float));
    if (!float) {
      const inset = docked ? 0 : 14;
      this.style.removeProperty(other);
      this.style.removeProperty('height');
      this.style.setProperty(edge, `${inset}px`);
      this.style.top = `${docked ? DOCKED_BAR_HEIGHT : inset}px`;
      this.style.bottom = `${inset}px`;
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
      this.editor.setPanelFloat(this.side, moveEvent.clientX - offset.x, moveEvent.clientY - offset.y, height);
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
    const startWidth = this.#side().width;
    // The grab is on the inner edge: the selection panel's left, the page panel's right. So
    // dragging towards the middle of the window grows either one.
    const grows = this.side === 'page' ? 1 : -1;
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      this.editor.setPanelWidth(this.side, startWidth + grows * (moveEvent.clientX - startX));
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
