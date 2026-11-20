import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { DOCKED_BAR_HEIGHT } from '../../core/constants.js';
import { firstFocusable } from '../../core/modal.js';
import { listen, unlisten } from '../../core/shield.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { tabsOf, type PanelSide } from '../../core/panels.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { tip, tipId, tipStyles } from '../controls/tip.js';
import { menuStyles, placeLayer, renderMenu } from '../panels/styles/menu.js';
import { renderViewportControls, viewportMenuStyles } from './viewport-menu.js';

/**
 * The floating toolbar.
 *
 * Deliberately the only always-visible piece of chrome. When edit mode is off it collapses to
 * the handle and the Edit switch, so it stays out of the way of the page it sits on; turning
 * edit mode on grows it to the right into the full set, in this order: the handle (grip and the
 * H menu), Edit, the selection, the preview size, undo, redo and Save, then the two panel
 * switches and the pin.
 *
 * The bar used to carry one button per panel tab and a Settings gear. The tabs are the panels'
 * own now (their keys are in the panel switches' tips), and Settings is in the H menu.
 *
 * It stays where it was put. Its left end is the anchor: growing or shrinking never moves the
 * handle, and a window too narrow for it shows it nudged left without forgetting where it was.
 * Only a drag moves it.
 *
 * Pinned (layout 'dock', while editing), it is a full-width bar across the top instead, in three
 * groups: the handle, Edit and the selection on the left, the preview size in the middle, and the
 * history, Save, the panel switches and the pin on the right. Nothing to drag then. With Edit off
 * it floats as usual, since the panels it was pinned with are hidden and the page has the window.
 */

/** Movement under this many pixels is a click on the handle, which opens the menu. */
const DRAG_SLOP = 4;
/**
 * The bar's editing width, guessed, when it is first placed with Edit off: it centres on the
 * window at the width it will have when editing, so turning Edit on grows it in place. Close to
 * the measured width at a wide window (about 650px); a guess is enough, as it only picks x once.
 */
const EDITING_WIDTH_GUESS = 640;

type Layer = 'heo' | 'viewport' | 'sizes';

@customElement('heo-toolbar')
export class HeoToolbar extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    tipStyles,
    menuStyles,
    viewportMenuStyles,
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

      /* Floating, the groups are not boxes: the bar is one row. Pinned, they are its three cells. */
      .grp {
        display: contents;
      }
      :host([data-layout='dock']) {
        left: 0;
        right: 0;
        top: 0;
        height: ${DOCKED_BAR_HEIGHT}px;
      }
      :host([data-layout='dock']) .bar {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        gap: 12px;
        box-sizing: border-box;
        height: 100%;
        max-width: none;
        padding: 0 8px;
        border-width: 0 0 1px;
        border-radius: 0;
        box-shadow: none;
      }
      :host([data-layout='dock']) .grp {
        display: flex;
        align-items: center;
        gap: 3px;
        min-width: 0;
      }
      :host([data-layout='dock']) .grp.end {
        justify-content: flex-end;
      }
      /* The separators between the groups: the grid's gap is the separation when pinned. */
      :host([data-layout='dock']) .sep.between {
        display: none;
      }
      :host([data-layout='dock']) .selection {
        min-width: 0;
        flex: 0 1 auto;
      }

      /* Every control holds its tip, placed under it. */
      .bar button,
      .selection {
        position: relative;
      }

      /*
       * The grip and the H are one handle: lit as one, a press on either is the same gesture
       * (click opens the menu, drag moves the bar), so the zone to aim at is the pair.
       */
      .handle {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        border-radius: var(--heo-r-md);
        cursor: grab;
        touch-action: none;
      }
      :host([data-layout='dock']) .handle {
        cursor: default;
      }
      .handle:hover,
      .handle:has(.logo[aria-expanded='true']) {
        background: var(--heo-hover);
      }
      :host([data-dragging]) .handle {
        background: var(--heo-accent-soft);
        cursor: grabbing;
      }
      .grip {
        display: grid;
        place-items: center;
        width: 16px;
        height: 30px;
        color: var(--heo-text-faint);
      }
      .handle:hover .grip,
      :host([data-dragging]) .grip {
        color: var(--heo-text);
      }
      .logo {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        height: 30px;
        padding: 0 5px 0 3px;
        border: 0;
        border-radius: var(--heo-r-md);
        background: transparent;
        color: var(--heo-text-faint);
        cursor: inherit;
      }
      .logo:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: -1px;
      }
      .mark {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
        font: 800 11px var(--heo-font);
      }
      /* Hovering the grip shows the H's tip too: they are one control to the eye. */
      .handle:hover .logo > .tip {
        visibility: visible;
        opacity: 1;
        transition-delay: 450ms;
      }
      /* The ends of the bar hold their tips inside the window. */
      .logo > .tip {
        left: 0;
        transform: none;
      }
      .pin > .tip {
        left: auto;
        right: 0;
        transform: none;
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
        animation: pulse 2.4s var(--heo-ease) 3;
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

      .selection {
        display: flex;
        align-items: center;
        gap: 5px;
        max-width: 170px;
        height: 26px;
        padding: 0 9px;
        border-radius: 999px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        white-space: nowrap;
      }
      .selection > svg {
        flex: 0 0 auto;
      }
      .selection .name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* The two panel switches read as a pair, just before the pin. */
      .panels {
        display: inline-flex;
        flex: 0 0 auto;
        gap: 1px;
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
        .selection,
        .selection + .sep {
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
        s.pageOpen,
        s.layout,
        s.canUndo,
        s.canRedo,
        s.undoLabel,
        s.changeCount,
        s.toolbar,
        s.saving,
        s.previewWidth,
        s.viewportSizes,
        s.geometry,
      ] as const,
    shallowArrayEquals,
  );

  /** The open layer: the H menu, the preview size menu, or the viewport sizes editor. */
  @state() private open: Layer | null = null;

  /**
   * Where the bar centred itself the first time it was drawn, until the user drags it (the
   * store's `toolbar` stays null until then). Chosen once, so it does not follow the window.
   */
  #home: { x: number; y: number } | null = null;
  /** What to focus once the next render has drawn it. */
  #focusAfter: { layer: Layer; into: boolean } | null = null;
  #resizeObserver = new ResizeObserver(() => {
    this.#applyPosition();
    this.#placeOpen();
  });
  #offSettings: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resizeObserver.observe(this);
    listen(window, 'resize', this.#onResize);
    listen(document, 'pointerdown', this.#onOutsidePress, true);
    // The hidden and renamed sizes are settings, which the store does not mirror.
    this.#offSettings = this.editor.settings.onChange(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#resizeObserver.disconnect();
    unlisten(window, 'resize', this.#onResize);
    unlisten(document, 'pointerdown', this.#onOutsidePress, true);
    this.#offSettings?.();
    this.#offSettings = null;
  }

  override updated(): void {
    this.#applyPosition();
    this.#placeOpen();
    this.#focusPending();
  }

  /** The window changed: the bar is clamped again (from the kept x) and Actual's width is new. */
  #onResize = (): void => {
    this.requestUpdate();
  };

  /**
   * Show the bar at its place, clamped into the window, without writing the clamp back: the
   * stored x is where the user put it, and a window narrowed for a moment must not move it for
   * good. The old resize handler wrote the clamped value into the store.
   */
  #applyPosition(): void {
    const width = this.offsetWidth;
    const height = this.offsetHeight;
    if (!this.isConnected || !width) return;
    // Pinned, the stylesheet places it across the top; the floating place is kept for later.
    if (this.dataset.layout === 'dock') {
      this.style.removeProperty('left');
      this.style.removeProperty('top');
      return;
    }
    const stored = this.state.value.toolbar;
    if (!stored && !this.#home) {
      const full = this.state.value.editing ? width : EDITING_WIDTH_GUESS;
      this.#home = { x: Math.max(8, Math.round((innerWidth - full) / 2)), y: 14 };
    }
    const at = stored ?? this.#home ?? { x: 8, y: 14 };
    const left = `${clamp(at.x, 8, innerWidth - width - 8)}px`;
    const top = `${clamp(at.y, 8, innerHeight - height - 8)}px`;
    if (this.style.left !== left) this.style.left = left;
    if (this.style.top !== top) this.style.top = top;
  }

  /* ---------------------------------------------------------------- layers */

  #setOpen(next: Layer | null, refocus = false): void {
    const was = this.open;
    if (next === was) return;
    this.open = next;
    if (next) this.#focusAfter = { layer: next, into: true };
    else if (refocus && was) this.#focusAfter = { layer: was, into: false };
  }

  #placeOpen(): void {
    const id = this.open;
    if (!id) return;
    const root = this.renderRoot;
    const anchor = root.querySelector<HTMLElement>(`[data-menu-anchor="${id}"]`);
    // Gone from the bar (Edit turned off while it was open): so is the layer.
    if (!anchor) {
      this.open = null;
      return;
    }
    const place = id === 'heo'
      ? root.querySelector('.handle')
      : id === 'sizes' ? root.querySelector('[data-menu-place="sizes"]') : anchor;
    placeLayer(root.querySelector<HTMLElement>(`.menu[data-menu="${id}"]`), place ?? anchor, {
      minWidth: id === 'sizes' ? 320 : id === 'heo' ? 210 : 250,
      gap: 6,
      source: anchor,
    });
  }

  /** Into a layer just opened (its first item), or back to the control a closed one came from. */
  #focusPending(): void {
    const pending = this.#focusAfter;
    if (!pending) return;
    this.#focusAfter = null;
    const root = this.renderRoot;
    const tries = { left: 4 };
    const go = (): void => {
      const layer = root.querySelector<HTMLElement>(`.menu[data-menu="${pending.layer}"]`);
      const target = pending.into
        ? layer && (layer.querySelector<HTMLElement>('.mi:not([disabled])') ?? firstFocusable(layer))
        : root.querySelector<HTMLElement>(`[data-menu-anchor="${pending.layer}"]`);
      // The sizes editor draws its rows a render after the layer: try again a frame later.
      if (!target && pending.into && tries.left-- > 0) {
        requestAnimationFrame(go);
        return;
      }
      target?.focus({ preventScroll: true });
    };
    requestAnimationFrame(go);
  }

  /*
   * Closed by a press anywhere else. Through listen, because the event shield gates pointerdown
   * on the document. A press on the handle is the handle's own: it toggles the menu on release,
   * and closing it here first would reopen it there.
   */
  #onOutsidePress = (event: Event): void => {
    const id = this.open;
    if (!id) return;
    const path = event.composedPath();
    const root = this.renderRoot;
    const keep = [
      root.querySelector(`.menu[data-menu="${id}"]`),
      id === 'heo' ? root.querySelector('.handle') : root.querySelector(`[data-menu-anchor="${id}"]`),
    ];
    if (keep.some((el) => el && path.includes(el))) return;
    this.#setOpen(null);
  };

  /* ---------------------------------------------------------------- render */

  override render(): TemplateResult {
    const state = this.state.value;
    const docked = state.editing && state.layout === 'dock';
    this.dataset.layout = docked ? 'dock' : 'float';
    const label = state.selected ? tagLabel(state.selected) : null;
    const heoOpen = this.open === 'heo';

    return html`<div class="bar surface">
        <div class="grp start">
        <div class="handle" @pointerdown=${docked ? nothing : this.#onHandleDown}>
          ${docked ? nothing : html`<span class="grip" aria-hidden="true">${icon('grip', 13)}</span>`}
          <button
            class="logo"
            type="button"
            data-menu-anchor="heo"
            aria-label="HEO menu"
            aria-haspopup="menu"
            aria-expanded=${heoOpen ? 'true' : 'false'}
            aria-describedby=${tipId('HEO menu')}
            @click=${(event: MouseEvent) => {
        // A mouse press is the handle's (released without moving, it toggles); this is
        // Enter and Space, whose click has no detail, or any click once docked.
        if (docked || event.detail === 0) this.#setOpen(heoOpen ? null : 'heo');
      }}
          >
            <span class="mark" aria-hidden="true">H</span>${icon('chevronDown', 10)}
            ${tip('HEO menu', '', docked ? 'Settings and keyboard shortcuts' : 'Click to open, drag to move the toolbar')}
          </button>
        </div>

        <button
          class="toggle"
          type="button"
          aria-label="Edit"
          aria-pressed=${state.editing}
          aria-describedby=${tipId(state.editing ? 'Leave edit mode' : 'Enter edit mode')}
          @click=${() => this.editor.toggleEditing()}
        >
          <span class="led"></span>
          Edit
          ${tip(state.editing ? 'Leave edit mode' : 'Enter edit mode', `${modLabel()} E`, 'Panels, sizes and layout are kept until you reload')}
        </button>
        ${state.editing ? this.#renderSelection(label) : nothing}
        </div>

        ${state.editing ? this.#renderTools(state.changeCount, docked) : nothing}
      </div>
      ${heoOpen ? this.#renderHeoMenu() : nothing}`;
  }

  #renderHeoMenu(): TemplateResult {
    const editing = this.state.value.editing;
    // Focus goes back to H before the dialog opens, so closing the dialog lands there too.
    const then = (act: () => void) => (): void => {
      this.#setOpen(null);
      this.renderRoot.querySelector<HTMLElement>('[data-menu-anchor="heo"]')?.focus({ preventScroll: true });
      act();
    };
    return renderMenu({
      id: 'heo',
      label: 'HEO menu',
      onClose: () => this.#setOpen(null, true),
      groups: [
        {
          items: [
            { key: 'settings', label: 'Settings…', icon: 'settings', onSelect: then(() => this.editor.setAiSettings(true, 'general')) },
            { key: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', onSelect: then(() => this.editor.setShortcuts(true)) },
          ],
        },
        {
          items: [{
            key: 'edit',
            label: editing ? 'Leave edit mode' : 'Enter edit mode',
            icon: 'exit',
            note: `${modLabel()}E`,
            onSelect: then(() => this.editor.toggleEditing()),
          }],
        },
      ],
    });
  }

  #renderSelection(label: string | null): TemplateResult {
    return html`
      <span class="sep"></span>

      <span class="selection" aria-describedby=${tipId('Current selection')}>
        ${icon('cursor', 11)}<span class="name">${label ?? 'Click any element'}</span>
        ${tip('Current selection', '', label ? 'Click any element on the page to change it' : 'Nothing is selected yet')}
      </span>
    `;
  }

  #renderTools(changes: number, docked: boolean): TemplateResult {
    const state = this.state.value;
    const mod = modLabel();
    const undoTip = state.undoLabel ? `Undo: ${state.undoLabel}` : 'Undo';
    const pinTip = docked ? 'Docked to the edges' : 'Floating over the page';
    return html`
      <span class="sep between"></span>

      <div class="grp mid">
      ${renderViewportControls({
      engine: this.editor,
      previewWidth: state.previewWidth,
      docked,
      open: this.open === 'viewport' || this.open === 'sizes' ? this.open : null,
      onOpen: (layer, refocus) => this.#setOpen(layer, refocus),
      onLayout: () => this.#placeOpen(),
      refresh: () => this.requestUpdate(),
      inShadowRoot: state.selected !== null && state.selected.getRootNode() instanceof ShadowRoot,
    })}
      </div>

      <span class="sep between"></span>

      <div class="grp end">
      <button
        class="btn icon ghost"
        type="button"
        ?disabled=${!state.canUndo}
        aria-label="Undo"
        aria-describedby=${tipId(undoTip)}
        @click=${() => this.editor.undo()}
      >
        ${icon('undo', 14)}${tip(undoTip, `${mod} Z`)}
      </button>
      <button
        class="btn icon ghost"
        type="button"
        ?disabled=${!state.canRedo}
        aria-label="Redo"
        aria-describedby=${tipId('Redo')}
        @click=${() => this.editor.redo()}
      >
        ${icon('redo', 14)}${tip('Redo', `⇧ ${mod} Z`)}
      </button>

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
        aria-label=${changes ? `Save, ${changes} unsaved` : 'Save'}
        aria-describedby=${tipId('Review and save changes')}
        @click=${() => this.editor.previewSave()}
      >
        ${icon('save', 13)} Save
        ${changes ? html`<span class="count">${changes}</span>` : nothing}
        ${tip('Review and save changes', `${mod} S`)}
      </button>

      <span class="sep"></span>

      <span class="panels" role="group" aria-label="Panels">
        ${this.#renderPanelToggle('page', state.pageOpen)}
        ${this.#renderPanelToggle('selection', state.dockOpen)}
      </span>
      <button
        class="btn icon ghost pin"
        type="button"
        aria-label="Pin the toolbar and panels to the edges"
        aria-pressed=${docked}
        aria-describedby=${tipId(pinTip)}
        @click=${() => this.editor.toggleLayout()}
      >
        ${icon('pin', 15)}
        ${tip(pinTip, 'D', docked ? 'D: float over the page' : 'D: pin to the edges, with the page between the panels')}
      </button>
      </div>
    `;
  }

  /** Show or hide one side; the tip lists the tabs it holds and their keys. */
  #renderPanelToggle(side: PanelSide, open: boolean): TemplateResult {
    const name = side === 'page' ? 'page' : 'selection';
    const text = `${open ? 'Hide' : 'Show'} the ${name} panel`;
    const keys = tabsOf(side).map((tab) => `${tab.label} ${tab.key}`).join(' · ');
    return html`<button
      class="btn icon ghost"
      type="button"
      data-side=${side}
      aria-label=${side === 'page' ? 'Page panel' : 'Selection panel'}
      aria-pressed=${open}
      aria-describedby=${tipId(text)}
      @click=${() => this.editor.setPanelOpen(side, !open)}
    >
      ${icon(side === 'page' ? 'panelLeft' : 'panel', 15)}${tip(text, '', keys)}
    </button>`;
  }

  /**
   * A press on the handle: a click opens the H menu, a drag moves the bar.
   *
   * Both from one press, so the grip and the H are one target. The move starts past a few
   * pixels, and only then takes pointer capture (so the gesture keeps working when the pointer
   * outruns the bar); a release before that is the click. The button's own click is ignored for a
   * mouse, or the menu would toggle twice.
   */
  #onHandleDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    // No focus ring from a mouse press, and no text selected by the drag.
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const box = this.getBoundingClientRect();
    const offset = { x: event.clientX - box.left, y: event.clientY - box.top };
    const start = { x: event.clientX, y: event.clientY };
    let moving = false;

    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== event.pointerId) return;
      if (!moving) {
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) <= DRAG_SLOP) return;
        moving = true;
        try {
          handle.setPointerCapture(moveEvent.pointerId);
        } catch {
          /* released already */
        }
        this.toggleAttribute('data-dragging', true);
        if (this.open === 'heo') this.#setOpen(null);
      }
      const x = clamp(Math.round(moveEvent.clientX - offset.x), 8, innerWidth - this.offsetWidth - 8);
      const y = clamp(Math.round(moveEvent.clientY - offset.y), 8, innerHeight - this.offsetHeight - 8);
      this.editor.setToolbarPosition(x, y);
    };
    const up = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== event.pointerId) return;
      unlisten(window, 'pointermove', move, true);
      unlisten(window, 'pointerup', up, true);
      unlisten(window, 'pointercancel', up, true);
      this.toggleAttribute('data-dragging', false);
      if (!moving && upEvent.type === 'pointerup') this.#setOpen(this.open === 'heo' ? null : 'heo');
    };
    listen(window, 'pointermove', move, true);
    listen(window, 'pointerup', up, true);
    listen(window, 'pointercancel', up, true);
  };
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
