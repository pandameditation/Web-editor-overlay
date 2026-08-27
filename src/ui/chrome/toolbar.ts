import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import type { PanelId } from '../../core/types.js';

const TABS: Array<{ id: PanelId; label: string; glyph: string; key: string }> = [
  { id: 'styles', label: 'Styles', glyph: 'styles', key: 'S' },
  { id: 'tokens', label: 'Tokens', glyph: 'droplet', key: 'T' },
  { id: 'tree', label: 'Tree', glyph: 'tree', key: 'E' },
  { id: 'library', label: 'Library', glyph: 'blocks', key: 'B' },
  { id: 'props', label: 'Props', glyph: 'sliders', key: 'P' },
  { id: 'media', label: 'Media', glyph: 'image', key: 'M' },
  { id: 'code', label: 'Code', glyph: 'code', key: 'C' },
  { id: 'seo', label: 'SEO', glyph: 'search', key: 'O' },
];

/**
 * The floating toolbar.
 *
 * Deliberately the only always-visible piece of chrome. When edit mode is off it
 * collapses to a single pill so it stays out of the way of the page it is sitting
 * on top of; turning edit mode on expands it into the full control set.
 *
 * Dragging moves it, and the position is clamped on release so it can never end
 * up off-screen after a window resize.
 */
@customElement('heo-toolbar')
export class HeoToolbar extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        z-index: 12;
        pointer-events: auto;
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 5px;
        border-radius: var(--heo-r-xl);
        max-width: calc(100vw - 32px);
      }

      .grip {
        display: grid;
        place-items: center;
        width: 18px;
        height: 30px;
        color: var(--heo-text-faint);
        cursor: grab;
        touch-action: none;
      }
      .grip:active {
        cursor: grabbing;
      }
      :host([data-dragging]) .grip {
        color: var(--heo-accent);
      }

      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 30px;
        padding: 0 12px 0 9px;
        border: 1px solid var(--heo-line);
        border-radius: 999px;
        background: var(--heo-raised);
        color: var(--heo-text-dim);
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        transition:
          background var(--heo-med),
          color var(--heo-med),
          border-color var(--heo-med);
      }
      .toggle:hover {
        border-color: var(--heo-line-strong);
        color: var(--heo-text);
      }
      .toggle[aria-pressed='true'] {
        background: var(--heo-accent);
        border-color: transparent;
        color: var(--heo-accent-ink);
        box-shadow: 0 0 0 4px var(--heo-accent-soft);
      }
      .led {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: currentColor;
        opacity: 0.45;
        transition: opacity var(--heo-med);
      }
      .toggle[aria-pressed='true'] .led {
        opacity: 1;
        animation: pulse 2.4s var(--heo-ease) infinite;
      }
      @keyframes pulse {
        50% {
          opacity: 0.45;
        }
      }

      .sep {
        width: 1px;
        height: 20px;
        margin: 0 3px;
        background: var(--heo-line);
        flex: 0 0 auto;
      }

      .tabs {
        display: flex;
        gap: 2px;
      }

      .selection {
        display: flex;
        align-items: center;
        gap: 5px;
        max-width: 190px;
        height: 26px;
        padding: 0 9px;
        border-radius: 999px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        white-space: nowrap;
        overflow: hidden;
      }
      .selection .name {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .count {
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
        font-size: 10px;
        font-weight: 600;
        text-align: center;
        line-height: 18px;
      }

      @media (max-width: 720px) {
        .tabs .wide,
        .selection {
          display: none;
        }
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) =>
      [
        s.editing,
        s.selected,
        s.dockOpen,
        s.dockTab,
        s.canUndo,
        s.canRedo,
        s.changeCount,
        s.toolbar,
        s.saving,
      ] as const,
    shallowArrayEquals,
  );

  #pointerOffset = { x: 0, y: 0 };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#applyPosition();
    addEventListener('resize', this.#clamp);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    removeEventListener('resize', this.#clamp);
  }

  override updated(): void {
    this.#applyPosition();
  }

  #applyPosition(): void {
    const { x, y } = this.state.value.toolbar;
    this.style.left = `${x}px`;
    this.style.top = `${y}px`;
  }

  #clamp = (): void => {
    const { x, y } = this.state.value.toolbar;
    const box = this.getBoundingClientRect();
    const maxX = Math.max(8, innerWidth - box.width - 8);
    const maxY = Math.max(8, innerHeight - box.height - 8);
    this.editor.setToolbarPosition(
      Math.min(Math.max(8, x), maxX),
      Math.min(Math.max(8, y), maxY),
    );
  };

  override render(): TemplateResult {
    const state = this.state.value;
    const label = state.selected ? tagLabel(state.selected) : null;

    return html`<div class="bar surface">
      <div
        class="grip"
        title="Drag to move the toolbar"
        @pointerdown=${this.#onDragStart}
      >
        ${icon('grip', 13)}
      </div>

      <button
        class="toggle"
        type="button"
        aria-pressed=${state.editing}
        title=${`${state.editing ? 'Leave' : 'Enter'} edit mode (${modLabel()}+E)`}
        @click=${() => this.editor.toggleEditing()}
      >
        <span class="led"></span>
        Edit
      </button>

      ${state.editing ? this.#renderTools(label, state.changeCount) : nothing}
    </div>`;
  }

  #renderTools(label: string | null, changes: number): TemplateResult {
    const state = this.state.value;
    return html`
      <span class="sep"></span>

      ${label
        ? html`<span class="selection" title="Current selection">
            ${icon('cursor', 11)}<span class="name">${label}</span>
          </span>`
        : html`<span class="selection">Click any element</span>`}

      <span class="sep"></span>

      <div class="tabs">
        ${TABS.map(
          (tab) => html`<button
            class="btn icon ghost"
            type="button"
            aria-pressed=${state.dockOpen && state.dockTab === tab.id}
            title=${`${tab.label} (${tab.key})`}
            aria-label=${tab.label}
            @click=${() =>
              state.dockOpen && state.dockTab === tab.id
                ? this.editor.setDock(false)
                : this.editor.setDockTab(tab.id)}
          >
            ${icon(tab.glyph, 14)}
          </button>`,
        )}
      </div>

      <span class="sep"></span>

      <button
        class="btn icon ghost"
        type="button"
        ?disabled=${!state.canUndo}
        title=${state.undoLabel ? `Undo: ${state.undoLabel}` : 'Undo'}
        aria-label="Undo"
        @click=${() => this.editor.undo()}
      >
        ${icon('undo', 14)}
      </button>
      <button
        class="btn icon ghost"
        type="button"
        ?disabled=${!state.canRedo}
        title="Redo"
        aria-label="Redo"
        @click=${() => this.editor.redo()}
      >
        ${icon('redo', 14)}
      </button>

      <span class="sep"></span>

      <!--
        Never disabled by the change count. The dialog behind this button holds the
        change list, the file plan, the design-system hand-off and the way to connect a
        folder in the first place — none of which stop being worth reaching just because
        there is nothing pending right now.
      -->
      <button
        class="btn primary"
        type="button"
        ?disabled=${state.saving}
        title=${`Review and save changes (${modLabel()}+S)`}
        @click=${() => this.editor.previewSave()}
      >
        ${icon('save', 13)} Save
        ${changes ? html`<span class="count">${changes}</span>` : nothing}
      </button>
    `;
  }

  /**
   * Drag the toolbar with pointer capture.
   *
   * Capture on the grip means the gesture keeps working when the pointer outruns
   * the element, which is easy to do with a fast flick.
   */
  #onDragStart(event: PointerEvent): void {
    event.preventDefault();
    const box = this.getBoundingClientRect();
    this.#pointerOffset = { x: event.clientX - box.left, y: event.clientY - box.top };
    this.toggleAttribute('data-dragging', true);

    const grip = event.currentTarget as HTMLElement;
    grip.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      const width = this.offsetWidth;
      const height = this.offsetHeight;
      const x = clamp(moveEvent.clientX - this.#pointerOffset.x, 8, innerWidth - width - 8);
      const y = clamp(moveEvent.clientY - this.#pointerOffset.y, 8, innerHeight - height - 8);
      this.editor.setToolbarPosition(x, y);
    };
    const up = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      this.toggleAttribute('data-dragging', false);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function tagLabel(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = Array.from(el.classList)
    .filter((name) => !name.startsWith('heo-'))
    .slice(0, 1)
    .map((name) => `.${name}`)
    .join('');
  return `${tag}${id}${cls}`;
}

export function modLabel(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-toolbar': HeoToolbar;
  }
}
