import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { isHorizontalFlow, isMutable, labelFor, selectableParent, visualBox } from '../../core/dom.js';
import { describeProvenance } from '../../core/provenance.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

/**
 * The selection and hover chrome drawn over the page.
 *
 * Everything here is a fixed-position box measured from the target element, so
 * the layer never touches the page's own layout. Nothing in it is resizable on
 * purpose: dragging a corner produces hard-coded pixel dimensions, which is the
 * opposite of what a token-driven design system wants. Size is edited in the
 * Styles panel where it can be expressed as a token, a percentage or a ratio.
 *
 * The controls that do appear are the ones tied to a specific element and its
 * position in the document: the drag thumb, and the insert affordances on the
 * leading and trailing edges.
 */
@customElement('heo-selection-layer')
export class HeoSelectionLayer extends HeoElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 4;
      }

      .hover {
        position: fixed;
        border: 1px solid color-mix(in oklab, var(--heo-accent) 55%, transparent);
        border-radius: 3px;
        background: color-mix(in oklab, var(--heo-accent) 7%, transparent);
        pointer-events: none;
        transition:
          top 60ms linear,
          left 60ms linear,
          width 60ms linear,
          height 60ms linear;
      }

      .select {
        position: fixed;
        border: 1.5px solid var(--heo-accent);
        border-radius: 3px;
        box-shadow: 0 0 0 3px var(--heo-accent-soft);
        pointer-events: none;
      }
      :host([data-dragging]) .select {
        border-style: dashed;
        box-shadow: none;
      }

      .badge {
        position: fixed;
        display: flex;
        align-items: center;
        gap: 6px;
        height: 21px;
        padding: 0 7px;
        border-radius: 5px;
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: var(--heo-shadow-sm);
      }
      .badge .dim {
        opacity: 0.75;
      }
      /* Reads as part of the label rather than as an alert: this is a fact about the
         element, not a problem with it. */
      .badge .owned {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 0 4px;
        border-radius: 3px;
        background: color-mix(in oklab, var(--heo-accent-ink) 22%, transparent);
      }

      /* Notion-style thumb: sits just outside the leading edge and is the single
         entry point for both dragging and the element menu. */
      .thumb {
        position: fixed;
        display: grid;
        place-items: center;
        width: 20px;
        height: 24px;
        padding: 0;
        border: 1px solid var(--heo-line);
        border-radius: 6px;
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-md);
        color: var(--heo-text-faint);
        cursor: grab;
        pointer-events: auto;
        touch-action: none;
        transition:
          color var(--heo-fast),
          background var(--heo-fast),
          transform var(--heo-fast);
      }
      .thumb:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
        transform: scale(1.06);
      }
      .thumb:active {
        cursor: grabbing;
      }
      :host([data-dragging]) .thumb {
        opacity: 0;
      }

      .insert {
        position: fixed;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 1px solid var(--heo-accent-line);
        border-radius: 999px;
        background: var(--heo-raised);
        color: var(--heo-accent);
        box-shadow: var(--heo-shadow-md);
        cursor: pointer;
        pointer-events: auto;
        opacity: 0.55;
        transition:
          opacity var(--heo-fast),
          transform var(--heo-fast),
          background var(--heo-fast);
      }
      .insert:hover {
        opacity: 1;
        transform: scale(1.15);
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      .insert[aria-pressed='true'] {
        opacity: 1;
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      :host([data-dragging]) .insert {
        display: none;
      }

      /* Guide line paired with each insert button, so the drop position reads
         as a place in the flow rather than a floating button. */
      .guide {
        position: fixed;
        background: var(--heo-accent);
        opacity: 0.35;
        border-radius: 2px;
        pointer-events: none;
      }

      /* The container a drag is currently reordering within.
         A drag only moves the element among this element's children, so saying
         which element that is turns an invisible rule into a visible one — and
         makes the two hold-to-re-parent gestures discoverable rather than magic. */
      .scope {
        position: fixed;
        border: 1px dashed color-mix(in oklab, var(--heo-accent) 45%, transparent);
        border-radius: 4px;
        background: color-mix(in oklab, var(--heo-accent) 5%, transparent);
        pointer-events: none;
      }
      :host([data-waiting]) .scope {
        border-style: solid;
        border-color: var(--heo-accent);
        animation: pulse 620ms var(--heo-ease) infinite;
      }
      @keyframes pulse {
        50% {
          opacity: 0.45;
        }
      }
      .scope .tag {
        position: absolute;
        left: 0;
        top: -17px;
        padding: 0 5px;
        border-radius: 4px;
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
        font-family: var(--heo-mono);
        font-size: 9.5px;
        line-height: 16px;
        white-space: nowrap;
      }

      /* The element a pending Replace will swap out. Every other insert position
         adds something and shows an accent guide line at the seam; this one takes
         something away, and it deserves to say so before the block is picked. */
      .doomed {
        position: fixed;
        border: 1.5px dashed var(--heo-danger);
        border-radius: 3px;
        background: color-mix(in oklab, var(--heo-danger) 10%, transparent);
        pointer-events: none;
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
        s.hovered,
        s.textEditing,
        s.geometry,
        s.revision,
        s.drag,
        s.insertAnchor,
        s.quickMenuOpen,
      ] as const,
    shallowArrayEquals,
  );

  override render(): TemplateResult | typeof nothing {
    const state = this.state.value;
    if (!state.editing) return nothing;
    this.toggleAttribute('data-dragging', Boolean(state.drag));
    this.toggleAttribute('data-waiting', Boolean(state.drag?.waiting));

    const selected = state.selected;
    const hovered =
      state.hovered && state.hovered !== selected && !state.drag ? state.hovered : null;

    return html`
      ${state.drag ? this.#renderScope(state.drag.home) : nothing}
      ${hovered ? this.#renderHover(hovered) : nothing}
      ${selected && selected.isConnected ? this.#renderSelection(selected) : nothing}
    `;
  }

  /** The parent a drag is confined to, labelled so the rule is legible. */
  #renderScope(home: Node): TemplateResult | typeof nothing {
    if (!(home instanceof HTMLElement) || home === document.body) return nothing;
    const box = visualBox(home);
    if (box.width <= 0 && box.height <= 0) return nothing;
    return html`<div class="scope" style=${boxStyle(box)}>
      <span class="tag">reordering in ${labelFor(home)}</span>
    </div>`;
  }

  #renderHover(el: HTMLElement): TemplateResult {
    const box = visualBox(el);
    return html`<div class="hover" style=${boxStyle(box)}></div>`;
  }

  #renderSelection(el: HTMLElement): TemplateResult {
    const state = this.state.value;
    const box = visualBox(el);
    const editingText = state.textEditing === el;
    const parent = selectableParent(el);
    const horizontal = parent ? isHorizontalFlow(parent) : false;
    const canMove = isMutable(el);
    const rendered = this.editor.provenanceOf(el);

    // Keep the badge inside the viewport: flip below the element when there is
    // no room above it.
    const badgeAbove = box.top > 26;
    const badgeStyle = `left:${Math.max(4, Math.round(box.left))}px;top:${Math.round(
      badgeAbove ? box.top - 25 : box.top + box.height + 4,
    )}px`;

    const replacing =
      state.insertAnchor?.reference === el && state.insertAnchor.position === 'replace';

    return html`
      <div class="select" style=${boxStyle(box)}></div>
      ${replacing ? html`<div class="doomed" style=${boxStyle(box)}></div>` : nothing}

      <div class="badge" style=${badgeStyle}>
        ${editingText ? icon('text', 11) : icon('cursor', 11)}
        <span>${labelFor(el)}</span>
        <span class="dim">${Math.round(box.width)}×${Math.round(box.height)}</span>
        <!--
          Said on the outline, before anything is tried.
          The refusal and the quick menu both explain this properly, but by then the
          user has already reached for an edit. A mark on the selection is the one
          place it can be known in advance, which is the difference between a rule
          the editor enforces and a rule the user can work with.
        -->
        ${rendered
        ? html`<span class="owned" title=${describeProvenance(rendered)}>
              ${icon('code', 10)} rendered${rendered.confidence === 'possible' ? '?' : ''}
            </span>`
        : nothing}
      </div>

      ${canMove ? this.#renderThumb(box) : nothing}
      ${canMove ? this.#renderInsert(box, horizontal, 'before') : nothing}
      ${canMove ? this.#renderInsert(box, horizontal, 'after') : nothing}
    `;
  }

  #renderThumb(box: { top: number; left: number; height: number }): TemplateResult {
    const left = Math.round(Math.max(4, box.left - 26));
    const top = Math.round(Math.max(4, box.top + Math.min(box.height / 2 - 12, 4)));
    return html`<button
      class="thumb"
      type="button"
      title="Drag to move · click for actions"
      aria-label="Element actions and drag handle"
      style=${`left:${left}px;top:${top}px`}
      @pointerdown=${this.#onThumbDown}
    >
      ${icon('grip', 12)}
    </button>`;
  }

  #renderInsert(
    box: { top: number; left: number; width: number; height: number },
    horizontal: boolean,
    side: 'before' | 'after',
  ): TemplateResult {
    const state = this.state.value;
    const active =
      state.insertAnchor?.reference === state.selected && state.insertAnchor.position === side;

    const button = horizontal
      ? {
        left: Math.round(side === 'before' ? box.left - 10 : box.left + box.width - 10),
        top: Math.round(box.top + box.height / 2 - 10),
      }
      : {
        left: Math.round(box.left + box.width / 2 - 10),
        top: Math.round(side === 'before' ? box.top - 10 : box.top + box.height - 10),
      };

    const guide = horizontal
      ? `left:${Math.round(side === 'before' ? box.left - 1 : box.left + box.width - 1)}px;top:${Math.round(box.top)}px;width:2px;height:${Math.round(box.height)}px`
      : `left:${Math.round(box.left)}px;top:${Math.round(side === 'before' ? box.top - 1 : box.top + box.height - 1)}px;width:${Math.round(box.width)}px;height:2px`;

    return html`
      ${active ? html`<div class="guide" style=${guide}></div>` : nothing}
      <button
        class="insert"
        type="button"
        aria-pressed=${active}
        title=${`Insert ${side} this element`}
        aria-label=${`Insert ${side} this element`}
        style=${`left:${button.left}px;top:${button.top}px`}
        @click=${() =>
        this.editor.setInsertAnchor(
          active ? null : { reference: this.state.value.selected!, position: side },
        )}
      >
        ${icon('plus', 12)}
      </button>
    `;
  }

  /**
   * Thumb press: a drag past a small threshold starts a reorder, anything less
   * opens the element menu.
   *
   * Distinguishing by distance rather than by time means a deliberate click is
   * never interpreted as a drag, and a fast drag never opens the menu.
   */
  #onThumbDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const el = this.state.value.selected;
    if (!el) return;

    const thumb = event.currentTarget as HTMLElement;
    const start = { x: event.clientX, y: event.clientY };
    let started = false;
    thumb.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      if (!started) {
        const distance = Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y);
        if (distance < 4) return;
        started = true;
        this.editor.startDrag(el, moveEvent.clientX, moveEvent.clientY);
      }
      this.editor.updateDrag(moveEvent.clientX, moveEvent.clientY);
    };
    const up = (): void => {
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', up);
      thumb.removeEventListener('pointercancel', cancel);
      if (started) this.editor.endDrag();
      else this.editor.setQuickMenu(!this.state.value.quickMenuOpen);
    };
    const cancel = (): void => {
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', up);
      thumb.removeEventListener('pointercancel', cancel);
      if (started) this.editor.cancelDrag();
    };

    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', up);
    thumb.addEventListener('pointercancel', cancel);
  }
}

function boxStyle(box: { top: number; left: number; width: number; height: number }): string {
  return `top:${Math.round(box.top)}px;left:${Math.round(box.left)}px;width:${Math.round(
    box.width,
  )}px;height:${Math.round(box.height)}px`;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-selection-layer': HeoSelectionLayer;
  }
}
