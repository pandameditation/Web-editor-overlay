import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { isHorizontalFlow, isMutable, labelFor, selectableParent, visualBox } from '../../core/dom.js';
import type { EditorEngine, TransformState } from '../../core/editor.js';
import { describeProvenance } from '../../core/provenance.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { handleCursor, RESIZE_HANDLES, type ResizeHandle } from '../../core/transform.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

/**
 * The selection and hover chrome drawn over the page.
 *
 * Everything here is a fixed-position box measured from the target element, so the layer never
 * touches the page's own layout.
 *
 * It used to say that nothing in it was resizable on purpose, because dragging a corner produces
 * hard-coded pixels and that is the opposite of what a token-driven design system wants. The
 * objection was right and the conclusion was too strong: what it actually argues against is
 * handles that *only* emit pixels. So the handles are here now, and the unit is not thrown away —
 * `formatLength` writes back in whatever the declaration already used, so an element sized in
 * percent stays in percent and one sized with a `var()` is the only case that falls to pixels,
 * which is also the only case where there was nothing to preserve. The Styles panel remains the
 * place to *say* something exactly; this is the place to find out what you meant.
 *
 * Two coordinate systems live here, which is the thing to understand before changing any of it.
 * Most chrome is drawn from `visualBox` — `getBoundingClientRect`, axis-aligned, viewport space.
 * The transform frame is not: a rotated element's bounding rect is the box *around* it, so the
 * frame is drawn at the element's pre-transform box and carries the element's own matrix, which
 * puts its handles on the rotated edges rather than on the corners of a box the user cannot see.
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

      /*
       * The ring around the selection.
       *
       * It is drawn one of two ways: standalone, placed in viewport coordinates, or inside the
       * handle frame filling it, which is what makes it follow a rotated element instead of
       * boxing it in. Both carry the same class on purpose. Giving the framed one its own name
       * meant the outline silently stopped being findable the moment handles appeared, which is
       * the sort of thing only a test notices.
       */
      .select {
        position: fixed;
        border: 1.5px solid var(--heo-accent);
        border-radius: 3px;
        box-shadow: 0 0 0 3px var(--heo-accent-soft);
        pointer-events: none;
      }
      .frame > .select {
        position: absolute;
        inset: 0;
        border-radius: 2px;
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

      /*
       * The handle frame.
       *
       * Sits at the element's *pre-transform* box and carries the element's own matrix and
       * origin, so its children land on the element's real edges however it is rotated. Doing it
       * this way rather than computing eight corner positions in script is what keeps the
       * arithmetic in one place: the browser is already very good at applying a matrix, and the
       * handles only have to know they are at "the middle of the top edge".
       */
      .frame {
        position: fixed;
        pointer-events: none;
      }

      /*
       * A handle is deliberately larger than it looks.
       *
       * The visible square is 9px, which is the right size to sit on an edge without hiding the
       * content behind it — and far too small to hit reliably. The button around it is more than
       * twice that, with the dot drawn in the middle, so the target is much bigger than the
       * affordance. This is the highest-value trick available in a direct-manipulation surface and
       * it costs nothing but a margin.
       */
      .h {
        position: absolute;
        width: 18px;
        height: 18px;
        margin: -9px 0 0 -9px;
        padding: 0;
        border: 0;
        background: transparent;
        pointer-events: auto;
        touch-action: none;
      }
      .h::after {
        content: '';
        display: block;
        width: 9px;
        height: 9px;
        margin: 4.5px;
        border: 1.5px solid var(--heo-accent);
        border-radius: 2px;
        /*
         * White, not a themed surface.
         *
         * A handle is drawn on top of the user's page, not on the editor's own chrome, so it has
         * to read against whatever is behind it — and the raised surface token is near-black in
         * the dark theme, which made every handle a smudge on any mid-tone element. White with
         * an accent border is the convention every canvas tool converged on for exactly this
         * reason: it is legible on light and dark content alike.
         */
        background: #fff;
        box-shadow: var(--heo-shadow-sm);
        transition: transform var(--heo-fast), background var(--heo-fast);
      }
      .h:hover::after {
        transform: scale(1.25);
        background: var(--heo-accent);
      }
      /* The edge handles read as bars rather than dots, so which axis they move is visible
         before the cursor has to say it. */
      .h.n::after,
      .h.s::after {
        width: 15px;
        margin-left: 1.5px;
        border-radius: 3px;
      }
      .h.e::after,
      .h.w::after {
        height: 15px;
        margin-top: 1.5px;
        border-radius: 3px;
      }

      .h.nw { left: 0; top: 0; }
      .h.n { left: 50%; top: 0; }
      .h.ne { left: 100%; top: 0; }
      .h.e { left: 100%; top: 50%; }
      .h.se { left: 100%; top: 100%; }
      .h.s { left: 50%; top: 100%; }
      .h.sw { left: 0; top: 100%; }
      .h.w { left: 0; top: 50%; }

      /* Outside the box and on its own stem, because a rotate handle inside the frame reads as
         a ninth resize handle and gets grabbed by mistake. */
      .rot {
        position: absolute;
        left: 50%;
        top: 0;
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        margin: -37px 0 0 -11px;
        padding: 0;
        border: 1px solid var(--heo-accent-line);
        border-radius: 999px;
        background: var(--heo-raised);
        color: var(--heo-accent);
        box-shadow: var(--heo-shadow-md);
        cursor: grab;
        pointer-events: auto;
        touch-action: none;
        transition: background var(--heo-fast), color var(--heo-fast);
      }
      .rot:hover {
        background: var(--heo-accent);
        color: var(--heo-accent-ink);
      }
      .rot:active {
        cursor: grabbing;
      }
      .stem {
        position: absolute;
        left: 50%;
        top: -16px;
        width: 1.5px;
        height: 16px;
        margin-left: -0.75px;
        background: var(--heo-accent);
        opacity: 0.45;
      }

      /* While a gesture runs, everything that is not the gesture gets out of the way. */
      :host([data-transforming]) .h::after,
      :host([data-transforming]) .rot {
        opacity: 0.35;
      }
      :host([data-transforming]) .h[data-active]::after {
        opacity: 1;
        transform: scale(1.25);
        background: var(--heo-accent);
      }
      :host([data-transforming]) .thumb,
      :host([data-transforming]) .insert {
        opacity: 0;
        pointer-events: none;
      }

      /* The live numbers, on the badge, because that is where the size already was. */
      .badge .live {
        padding: 0 5px;
        border-radius: 3px;
        background: color-mix(in oklab, var(--heo-accent-ink) 22%, transparent);
        font-variant-numeric: tabular-nums;
      }
      .hint {
        position: fixed;
        padding: 0 7px;
        border-radius: 5px;
        background: var(--heo-raised);
        border: 1px solid var(--heo-line);
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 19px;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: var(--heo-shadow-sm);
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
        s.transform,
      ] as const,
    shallowArrayEquals,
  );

  override render(): TemplateResult | typeof nothing {
    const state = this.state.value;
    if (!state.editing) return nothing;
    this.toggleAttribute('data-dragging', Boolean(state.drag));
    this.toggleAttribute('data-waiting', Boolean(state.drag?.waiting));
    this.toggleAttribute('data-transforming', Boolean(state.transform));

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

    /*
     * Handles are offered unless something else owns the pointer.
     *
     * Not while reordering, because the element is mid-flight and its box is a preview. Not while
     * its text is being edited either: the caret is in there, and a resize handle a few pixels
     * from the last character is a corner somebody is about to grab instead of clicking.
     */
    const gesture = state.transform?.element === el ? state.transform : null;
    const affordances =
      !state.drag && !editingText ? this.editor.transformAffordances(el) : null;

    return html`
      ${affordances
        ? this.#renderFrame(affordances, gesture)
        : html`<div class="select" style=${boxStyle(box)}></div>`}
      ${replacing ? html`<div class="doomed" style=${boxStyle(box)}></div>` : nothing}

      <div class="badge" style=${badgeStyle}>
        ${editingText ? icon('text', 11) : icon('cursor', 11)}
        <span>${labelFor(el)}</span>
        ${gesture?.readout
        ? html`<span class="live">${gesture.readout}</span>`
        : html`<span class="dim">${Math.round(box.width)}×${Math.round(box.height)}</span>`}
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

      ${gesture?.hint
        ? html`<div
            class="hint"
            style=${`left:${Math.max(4, Math.round(box.left))}px;top:${Math.round(
          box.top + box.height + 6,
        )}px`}
          >
            ${gesture.hint}
          </div>`
        : nothing}

      ${canMove ? this.#renderThumb(box) : nothing}
      ${canMove ? this.#renderInsert(box, horizontal, 'before') : nothing}
      ${canMove ? this.#renderInsert(box, horizontal, 'after') : nothing}
    `;
  }

  /**
   * The handle frame: the element's own box, at the element's own angle.
   *
   * The frame is positioned at the pre-transform box and given the element's matrix, so a handle
   * declaring `left: 50%; top: 0` lands on the middle of the top edge whatever the rotation. The
   * alternative — solving for eight viewport positions on every render — would be the same
   * arithmetic done worse, and would still leave the outline axis-aligned around a rotated
   * element.
   */
  #renderFrame(
    affordances: NonNullable<ReturnType<EditorEngine['transformAffordances']>>,
    gesture: TransformState | null,
  ): TemplateResult {
    const { box, linear, origin, angle } = affordances;
    const style = [
      boxStyle(box),
      `transform:matrix(${linear.a},${linear.b},${linear.c},${linear.d},0,0)`,
      `transform-origin:${origin.x}px ${origin.y}px`,
    ].join(';');

    return html`<div class="frame" style=${style}>
      <div class="select"></div>
      ${affordances.resize
        ? RESIZE_HANDLES.map(
          (handle) => html`<button
          class=${`h ${handle}`}
          type="button"
          data-mode="resize"
          data-handle=${handle}
          ?data-active=${gesture?.handle === handle}
          aria-label=${`Resize from the ${HANDLE_NAMES[handle]}`}
          title=${`Drag to resize · Shift keeps the ratio · Alt from the centre`}
          style=${`cursor:${handleCursor(handle, angle)}`}
          @pointerdown=${this.#onHandleDown}
        ></button>`,
        )
        : nothing}
      <div class="stem"></div>
      <button
        class="rot"
        type="button"
        data-mode="rotate"
        aria-label="Rotate"
        title="Drag to rotate · Shift snaps to 15°"
        @pointerdown=${this.#onHandleDown}
      >
        ${icon('refresh', 12)}
      </button>
    </div>`;
  }

  /**
   * A handle press: a drag resizes or rotates, a click does nothing.
   *
   * Modelled on `#onThumbDown`, with one addition that matters more than it sounds — the
   * modifier keys are watched for the length of the gesture. Shift and Alt change what the *same*
   * pointer position means, so a user who has stopped moving and then presses Shift expects the
   * ratio to lock there and then. Waiting for the next pointer move makes the modifier feel
   * broken on exactly the careful, deliberate adjustment it exists for.
   */
  #onHandleDown(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const el = this.state.value.selected;
    if (!el) return;

    const target = event.currentTarget as HTMLElement;
    const mode = target.dataset.mode === 'rotate' ? 'rotate' : 'resize';
    const handle = (target.dataset.handle ?? null) as ResizeHandle | null;
    const from = { x: event.clientX, y: event.clientY };
    let started = false;
    target.setPointerCapture(event.pointerId);

    const modifiers = (source: PointerEvent | KeyboardEvent): { shift: boolean; alt: boolean } => ({
      shift: source.shiftKey,
      alt: source.altKey,
    });

    const move = (moveEvent: PointerEvent): void => {
      if (!started) {
        // Small, because a handle is a deliberate target: the threshold is only here so that a
        // click which happens to jitter does not open a gesture and commit nothing.
        if (Math.hypot(moveEvent.clientX - from.x, moveEvent.clientY - from.y) < 2) return;
        started = this.editor.startTransform(el, mode, handle, from.x, from.y);
        if (!started) {
          detach();
          return;
        }
      }
      this.editor.updateTransform(moveEvent.clientX, moveEvent.clientY, modifiers(moveEvent));
    };
    const key = (keyEvent: KeyboardEvent): void => {
      if (!started) return;
      if (keyEvent.key === 'Escape') {
        detach();
        this.editor.cancelTransform();
        return;
      }
      const at = this.editor.transformPointer;
      if (at) this.editor.updateTransform(at.x, at.y, modifiers(keyEvent));
    };
    const up = (): void => {
      detach();
      if (started) this.editor.endTransform();
    };
    const cancel = (): void => {
      detach();
      if (started) this.editor.cancelTransform();
    };
    const detach = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
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

/** Spelled out for the screen reader, since a compass point is not a label. */
const HANDLE_NAMES: Record<ResizeHandle, string> = {
  nw: 'top left corner',
  n: 'top edge',
  ne: 'top right corner',
  e: 'right edge',
  se: 'bottom right corner',
  s: 'bottom edge',
  sw: 'bottom left corner',
  w: 'left edge',
};

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
