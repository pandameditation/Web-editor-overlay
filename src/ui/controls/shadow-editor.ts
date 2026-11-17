import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { parseColor, type Rgba } from '../../core/color.js';
import {
  alphaOf,
  composeFilter,
  formatShadow,
  formatShadows,
  HEO_SHADOW_SWATCHES,
  lengthParts,
  lostIn,
  NO_SHADOW,
  parseShadows,
  sameShadows,
  splitFilter,
  withAlpha,
  type Shadow,
  type ShadowMode,
  type ShadowSwatch,
} from '../../core/shadow.js';
import { icon } from '../icons.js';
import { killStyles, renderKill } from '../kill.js';
import { baseStyles } from '../theme.js';
import './segmented.js';
import './value-field.js';

/** What the editor writes: `box-shadow`, `text-shadow`, or the drop shadows of `filter`. */
export type ShadowEditorMode = 'box' | 'text' | 'filter';

/** A conversion between box-shadow and filter: drop-shadow(), for the host to write as two properties. */
export interface ShadowConvert {
  /** The property the shadows move to. */
  to: 'filter' | 'box-shadow';
  /** The shadows, as the editor has them. */
  shadows: Shadow[];
  /** What the property being left becomes: `none`, or the filter's other functions. */
  rest: string;
  /** How many shadows lose a spread or an inset on the way: the host confirms before converting. */
  lost: number;
}

/** A shadow drawn small: lengths divided down, so a 24px blur reads in a 12px tile. */
export function miniShadow(list: readonly Shadow[], divide: number, mode: ShadowMode = 'box'): string {
  const scale = (length: string): string => {
    const parts = lengthParts(length);
    return parts ? `${Math.round((parts.unit === 'px' ? parts.number : parts.number * 16) / divide)}px` : '0px';
  };
  const shown = list.map((one) => ({ ...one, x: scale(one.x), y: scale(one.y), blur: scale(one.blur), spread: scale(one.spread) }));
  return mode === 'box' ? formatShadows(shown, 'box') : formatShadows(shown, 'text');
}

/*
 * A colour name read as sRGB, through a canvas: `black`, `rebeccapurple`.
 *
 * Never through the page. This used to append a probe span to the body and read its computed
 * colour, on every render — and the editor watches the body, so each probe was a page change that
 * re-rendered the panel, which drew this editor, which appended another probe. A named shadow colour
 * froze the page outright. A canvas context lives outside the document, so reading one cannot be
 * seen as an edit; and the answers are cached, since the same few colours are asked about every frame.
 *
 * `currentColor` and `var()` mean something only on an element, which a canvas has none of: they
 * come back null, and the opacity control says it cannot read them.
 */
let canvas: CanvasRenderingContext2D | null | undefined;
const resolved = new Map<string, Rgba | null>();
function resolveColor(color: string): Rgba | null {
  const key = color.trim().toLowerCase();
  if (resolved.has(key)) return resolved.get(key)!;
  if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d');
  let out: Rgba | null = null;
  if (canvas && !/^(?:currentcolor|inherit|initial|unset|revert)$/.test(key) && !key.includes('var(')) {
    // A sentinel first: an unknown colour leaves fillStyle as it was, which must not read as an answer.
    canvas.fillStyle = '#010203';
    canvas.fillStyle = color;
    const read = String(canvas.fillStyle);
    out = read === '#010203' && key !== '#010203' ? null : parseColor(read);
  }
  if (resolved.size > 200) resolved.clear();
  resolved.set(key, out);
  return out;
}

const DRAG_RANGE = 40;

/**
 * The shadow & glow editor: one or more shadows, built and previewed live.
 *
 * Opened from the field of `box-shadow`, `text-shadow` or `filter`, in the popup the colour picker
 * uses, and from the same place: the control at the head of the field. Top to bottom: the stack of
 * shadows, the swatches, then the picked shadow's offset (a pad to drag, and X and Y), blur, spread,
 * opacity and color.
 *
 * The swatches are small, like the colour picker's. The first is the value as it was when the editor
 * opened; the rest are the design system's shadow tokens, or eight of HEO's when it has none. Picking
 * one loads it into the editor and every control stays editable; editing never changes a swatch. A
 * token picked and left as it is, is written as its `var()`.
 *
 * Writes as it goes, like the background editor: `shadow-input` while a value is being dragged, for
 * the host's live preview, and `shadow-change` when it settles. `shadow-convert` asks the host to
 * move the shadows between `box-shadow` and `filter: drop-shadow()`, which is two properties and so
 * the host's to write. `filter-select` asks it to select one of the filter's other functions in the
 * field. `shadow-close` is Done.
 */
@customElement('heo-shadow-editor')
export class HeoShadowEditor extends LitElement {
  static override styles = [
    baseStyles,
    killStyles,
    css`
      :host {
        display: grid;
        gap: 10px;
        width: 100%;
        min-width: 0;
        font-size: 11.5px;
      }
      /* Shadows are drawn on a light ground whatever the theme: on the dark glass they vanished. */
      heo-value-field {
        min-width: 0;
        width: 100%;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: -2px 0 0;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      .head:active {
        cursor: grabbing;
      }
      .head .close {
        width: 22px;
        height: 22px;
        cursor: pointer;
      }
      .grip {
        display: grid;
        place-items: center;
        color: var(--heo-text-faint);
        cursor: grab;
      }
      .add-first {
        justify-self: start;
      }
      .head .title {
        font-weight: 600;
        font-size: 12px;
        color: var(--heo-text);
      }
      .head .mono {
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .head .spacer {
        flex: 1 1 auto;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 5px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .group::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--heo-line);
      }
      .convert {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        padding: 8px 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        cursor: pointer;
      }
      .convert input {
        margin: 1px 0 0;
        accent-color: var(--heo-accent);
      }
      .convert b {
        display: block;
        color: var(--heo-text);
        font-weight: 600;
      }
      .convert span span {
        display: block;
        margin-top: 2px;
        color: var(--heo-text-hint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      code {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }
      .warn {
        display: flex;
        gap: 6px;
        margin: 0;
        color: var(--heo-warn);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .fns {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .fns .chip {
        font-family: var(--heo-mono);
        font-size: 10.5px;
        cursor: pointer;
      }
      .fns .chip:hover {
        border-color: var(--heo-line-strong);
        color: var(--heo-text);
      }
      .fns .chip.mine {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-text);
        font-weight: 600;
      }

      /* The stack: one row per shadow, the picked one marked. */
      .layers {
        display: grid;
        gap: 2px;
      }
      .layer {
        display: grid;
        grid-template-columns: 14px 24px minmax(0, 1fr) auto;
        align-items: center;
        gap: 7px;
        padding: 2px 4px;
        border: 1px solid transparent;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text-dim);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .layer:hover {
        background: var(--heo-hover);
      }
      .layer.over {
        box-shadow: inset 0 2px 0 var(--heo-accent);
      }
      .layer[aria-current='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }
      .layer .v {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }
      .tile {
        display: grid;
        place-items: center;
        width: 24px;
        height: 18px;
        border-radius: 4px;
        background: #e4e7ed;
      }
      .tile i {
        width: 12px;
        height: 9px;
        border-radius: 2px;
        background: #fff;
      }
      .tile b {
        color: #fff;
        font: 700 11px/1 var(--heo-font, system-ui);
      }
      /* The swatches: small, like the colour picker's. */
      .swatches {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
      }
      .swatch {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: #e4e7ed;
        cursor: pointer;
      }
      .swatch:hover:not(:disabled) {
        background: #d6dae2;
      }
      .swatch[aria-pressed='true'] {
        box-shadow: 0 0 0 2px var(--heo-accent);
      }
      .swatch:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
      .swatch i {
        width: 12px;
        height: 12px;
        border-radius: 3px;
        background: #fff;
      }
      .swatch b {
        color: #fff;
        font: 700 12px/1 var(--heo-font, system-ui);
      }
      .sep {
        width: 1px;
        height: 18px;
        margin: 0 1px;
        background: var(--heo-line-strong);
      }

      /* The offset: a pad to drag, and the two numbers beside it. */
      .offset {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 10px;
        min-width: 0;
        align-items: center;
      }
      .pad {
        position: relative;
        width: 88px;
        height: 88px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background:
          linear-gradient(var(--heo-line), var(--heo-line)) center / 1px 100% no-repeat,
          linear-gradient(var(--heo-line), var(--heo-line)) center / 100% 1px no-repeat,
          var(--heo-sunken);
        cursor: crosshair;
        touch-action: none;
      }
      .pad.off {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .pad .zero {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 20px;
        height: 14px;
        margin: -7px -10px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 3px;
        background: var(--heo-raised);
        pointer-events: none;
      }
      .pad .dot {
        position: absolute;
        width: 12px;
        height: 12px;
        margin: -6px;
        border-radius: 50%;
        background: var(--heo-accent);
        box-shadow: 0 0 0 3px var(--heo-raised), 0 1px 4px rgb(0 0 0 / 30%);
        pointer-events: none;
      }
      .pad:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .xy {
        display: grid;
        gap: 5px;
        min-width: 0;
      }
      .line {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr) 92px;
        align-items: center;
        gap: 8px;
      }
      .line > label {
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .line.off {
        opacity: 0.45;
      }
      .line.wide {
        grid-template-columns: 52px minmax(0, 1fr);
      }
      input[type='range'] {
        width: 100%;
        margin: 0;
        accent-color: var(--heo-accent);
      }
      .pct {
        display: flex;
        align-items: center;
        height: 28px;
        padding: 0 7px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .pct input {
        flex: 1 1 auto;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
        outline: none;
      }
      .pct span {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }
      .unreadable {
        margin: 0;
        color: var(--heo-text-hint);
        font-size: 11px;
        line-height: 1.5;
      }
    `,
  ];

  /** The value the property holds as written. */
  @property({ type: String }) value = '';
  /** Its computed value, read when the written one is a token or another value this cannot read. */
  @property({ type: String }) computed = '';
  @property({ type: String }) mode: ShadowEditorMode = 'box';
  /** The design system's shadow tokens, as swatches. HEO's own are used when there are none. */
  @property({ attribute: false }) tokens: readonly ShadowSwatch[] = [];
  /** Whether the host can move the shadows between box-shadow and filter. */
  @property({ type: Boolean }) convertible = false;

  @state() private shadows: Shadow[] = [];
  @state() private picked = 0;
  /** The value when the editor opened: the first swatch, which never changes. */
  @state() private original: Shadow[] = [];
  /** The swatch the stack still is, until something is edited. Written as the swatch's own value. */
  @state() private fromSwatch: ShadowSwatch | null = null;
  @state() private readable = true;
  #others: string[] = [];
  #at = 0;
  /**
   * The values this editor sent, recent first, so its own echoes are not read as somebody else's
   * change. More than the last one: two quick edits are both in flight, and the host's answer to the
   * first arriving after the second was sent read as an outside change and put the first back.
   */
  #sent: string[] = [];

  override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('value') && !changed.has('mode') && !changed.has('computed')) return;
    const value = this.value.trim();
    if (this.#sent.includes(value) || value === this.#written().trim()) return;
    this.#read();
  }

  /** Take the value apart: the written one, else a token's own value, else the computed one. */
  #read(): void {
    let list: Shadow[] | null = null;
    if (this.mode === 'filter') {
      const split = splitFilter(this.value) ?? splitFilter(this.computed);
      if (split) {
        this.#others = split.others;
        this.#at = split.at;
        list = split.drops;
      }
    } else {
      const mode = this.mode;
      list = parseShadows(this.value, mode);
      const token = this.tokens.find((one) => one.value.trim() === this.value.trim());
      if (!list && token) list = token.shadows.map((one) => ({ ...one }));
      if (!list) list = parseShadows(this.computed, mode);
      this.fromSwatch = token ?? null;
    }
    this.readable = list !== null;
    this.shadows = list ?? [];
    this.original = this.shadows.map((one) => ({ ...one }));
    this.picked = Math.max(0, this.shadows.length - 1);
    this.#sent = [];
  }

  get #shadowMode(): ShadowMode {
    return this.mode === 'filter' ? 'drop' : this.mode;
  }

  /** The value as it would be written now. */
  #written(list = this.shadows): string {
    if (this.mode === 'filter') return composeFilter(this.#others, list, this.#at);
    if (this.fromSwatch && this.mode === 'box' && sameShadows(this.fromSwatch.shadows, list)) return this.fromSwatch.value;
    return formatShadows(list, this.mode);
  }

  #emit(kind: 'shadow-input' | 'shadow-change'): void {
    const value = this.#written();
    this.#sent = [value.trim(), ...this.#sent.filter((one) => one !== value.trim())].slice(0, 12);
    this.dispatchEvent(new CustomEvent(kind, { detail: { value }, bubbles: true, composed: true }));
  }

  /** Change the picked shadow. `settle` commits; without it the change is only previewed. */
  #edit(patch: Partial<Shadow>, settle: boolean): void {
    const current = this.shadows[this.picked];
    if (!current) return;
    this.shadows = this.shadows.map((one, index) => (index === this.picked ? { ...one, ...patch } : one));
    this.fromSwatch = null;
    this.#emit(settle ? 'shadow-change' : 'shadow-input');
  }

  #replace(list: Shadow[], swatch: ShadowSwatch | null): void {
    this.shadows = list.map((one) => ({ ...one }));
    this.picked = Math.max(0, Math.min(this.picked, this.shadows.length - 1));
    this.fromSwatch = swatch;
    this.readable = true;
    this.#emit('shadow-change');
  }

  override render(): TemplateResult {
    const mode = this.#shadowMode;
    const current = this.shadows[this.picked];
    const title = this.mode === 'filter' ? 'Drop shadow' : this.mode === 'text' ? 'Text shadow' : 'Box shadow';
    const property = this.mode === 'filter' ? 'filter: drop-shadow()' : this.mode === 'text' ? 'text-shadow' : 'box-shadow';
    /*
     * Top to bottom, the colour picker's order: what is being edited, the controls, the swatches
     * last. The head is the handle the editor is moved by, and ✕ closes it, as other popovers do.
     */
    return html`
      <div class="head" title="Drag to move" @pointerdown=${this.#startMove}>
        <span class="grip" aria-hidden="true">${icon('grip', 12)}</span>
        <span class="title">${title}</span>
        <span class="mono">${property}</span>
        <span class="spacer"></span>
        <button
          class="btn ghost icon sm close"
          type="button"
          aria-label="Close"
          title="Close"
          @pointerdown=${(event: Event) => event.stopPropagation()}
          @click=${this.#close}
        >${icon('close', 11)}</button>
      </div>
      ${this.#renderConvert()}
      ${this.mode === 'filter' ? this.#renderFunctions() : nothing}
      ${this.readable
        ? this.#renderStack()
        : html`<p class="unreadable">
            This value cannot be edited here as it is. Pick a swatch to start from, or add a shadow.
          </p>`}
      ${current ? this.#renderShadow(current, mode) : nothing}
      ${this.#renderSwatches()}
    `;
  }

  /*
   * Between box-shadow and filter: drop-shadow(). Ticked in filter mode, so unticking goes back.
   *
   * The box is put back as it was the moment it is clicked: whether it ends up the other way is
   * the host's to say, after the conversion — and after the user confirms one that loses a spread
   * or an inset, which they may decline.
   */
  #renderConvert(): TemplateResult | typeof nothing {
    if (!this.convertible || this.mode === 'text') return nothing;
    if (this.mode === 'filter' && !this.shadows.length) return nothing;
    const toFilter = this.mode === 'box';
    return html`<label class="convert">
      <input
        type="checkbox"
        .checked=${!toFilter}
        @change=${(event: Event) => {
          (event.target as HTMLInputElement).checked = !toFilter;
          this.#convert(toFilter ? 'filter' : 'box-shadow');
        }}
      />
      <span>
        <b>Use filter: drop-shadow() instead</b>
        <span>
          ${toFilter
            ? html`Follows the element's shape instead of its box — better for complex shapes, icons, etc.`
            : html`Untick to make these a <code>box-shadow</code> again.`}
        </span>
      </span>
    </label>`;
  }

  #convert(to: 'filter' | 'box-shadow'): void {
    const lost = to === 'filter' ? this.shadows.filter((one) => lostIn(one, 'drop').length) : [];
    const detail: ShadowConvert = {
      to,
      shadows: this.shadows.map((one) => ({ ...one })),
      rest: to === 'filter' ? 'none' : composeFilter(this.#others, [], this.#at),
      lost: lost.length,
    };
    this.dispatchEvent(new CustomEvent<ShadowConvert>('shadow-convert', { detail, bubbles: true, composed: true }));
  }

  /** The filter's functions: the drop shadows are this editor's, the rest open in the field. */
  #renderFunctions(): TemplateResult {
    const drops = this.shadows.map((one) => formatShadow(one, 'drop'));
    return html`<div>
      <div class="group">filter</div>
      <div class="fns">
        ${this.#others.map((fn) => html`<button
          class="chip"
          type="button"
          title=${`Edit ${fn} in the field`}
          @click=${() =>
            this.dispatchEvent(new CustomEvent('filter-select', { detail: { fn }, bubbles: true, composed: true }))}
        >${fn}</button>`)}
        ${drops.map((_fn, index) => html`<button
          class="chip mine"
          type="button"
          title="Edited here"
          aria-pressed=${index === this.picked ? 'true' : 'false'}
          @click=${() => {
            this.picked = index;
          }}
        >drop-shadow(…)</button>`)}
      </div>
    </div>`;
  }

  #add(): void {
    const base = this.shadows[this.picked] ?? { ...NO_SHADOW, y: '4px', blur: '12px' };
    this.picked = this.shadows.length;
    this.#replace([...this.shadows, { ...base }], null);
  }

  /**
   * The stack: one row per shadow, the background editor's layer row — a grip to drag it by, a
   * picture, what it is, and the trash. Alt and an arrow move the focused row.
   */
  #renderStack(): TemplateResult {
    const mode = this.#shadowMode;
    const label = this.mode === 'filter' ? 'Drop shadows' : 'Shadows';
    return html`<div>
      <div class="group">
        ${label}
        ${this.shadows.length
          ? html`<button
              class="btn ghost icon sm"
              type="button"
              style="width:20px;height:20px"
              aria-label="Add a shadow"
              title="Add a shadow"
              @click=${() => this.#add()}
            >${icon('plus', 11)}</button>`
          : nothing}
      </div>
      ${this.shadows.length
        ? html`<div class="layers">
            ${this.shadows.map((one, index) => html`<div
              class="layer"
              role="button"
              tabindex="0"
              draggable="true"
              data-layer=${index}
              aria-current=${index === this.picked ? 'true' : 'false'}
              aria-label=${`Shadow ${index + 1}: ${this.#summary(one, mode)}`}
              @click=${() => {
                this.picked = index;
              }}
              @keydown=${(event: KeyboardEvent) => this.#layerKey(event, index)}
              @dragstart=${(event: DragEvent) => this.#dragStart(event, index)}
              @dragover=${(event: DragEvent) => this.#dragOver(event)}
              @dragleave=${(event: DragEvent) => (event.currentTarget as HTMLElement).classList.remove('over')}
              @drop=${(event: DragEvent) => this.#drop(event, index)}
            >
              <span class="grip" title="Drag to reorder">${icon('grip', 12)}</span>
              ${this.#tile([one], mode)}
              <span class="v">${this.#summary(one, mode)}</span>
              <span @click=${(event: Event) => event.stopPropagation()}>${renderKill({
                label: `Remove shadow ${index + 1}`,
                tight: true,
                onClick: () => this.#replace(this.shadows.filter((_one, at) => at !== index), null),
              })}</span>
            </div>`)}
          </div>`
        : html`<button class="btn sm add-first" type="button" @click=${() => this.#add()}>
            ${icon('plus', 11)} Add shadow
          </button>`}
    </div>`;
  }

  #layerKey(event: KeyboardEvent, index: number): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.picked = index;
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const to = Math.max(0, Math.min(this.shadows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
      if (to !== index) this.#move(index, to);
    }
  }

  /** Move a shadow in the stack. The first one is drawn on top, so order is what the eye sees. */
  #move(from: number, to: number): void {
    const next = [...this.shadows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.picked = to;
    this.#replace(next, null);
  }

  #dragFrom: number | null = null;

  #dragStart(event: DragEvent, index: number): void {
    // A drag that starts in a control is that control's, not the row moving.
    if ((event.composedPath()[0] as HTMLElement).closest?.('button')) {
      event.preventDefault();
      return;
    }
    this.#dragFrom = index;
    event.dataTransfer?.setData('text/plain', `shadow:${index}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  #dragOver(event: DragEvent): void {
    if (this.#dragFrom === null) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.add('over');
  }

  #drop(event: DragEvent, index: number): void {
    (event.currentTarget as HTMLElement).classList.remove('over');
    const from = this.#dragFrom;
    this.#dragFrom = null;
    if (from === null || from === index) return;
    event.preventDefault();
    this.#move(from, index);
  }

  #summary(one: Shadow, mode: ShadowMode): string {
    const alpha = alphaOf(one.color, resolveColor);
    return [
      mode === 'box' && one.inset ? 'inset' : '',
      `${one.x} ${one.y}`,
      `blur ${one.blur}`,
      mode === 'box' ? `spread ${one.spread}` : '',
      alpha === null ? one.color : `${Math.round(alpha * 100)}%`,
    ].filter(Boolean).join(' · ');
  }

  /** A small picture of shadows: on a card for a box, on a letter for a text or a drop shadow. */
  #tile(list: readonly Shadow[], mode: ShadowMode): TemplateResult {
    if (mode === 'box') return html`<span class="tile"><i style=${`box-shadow:${miniShadow(list, 3)}`}></i></span>`;
    return html`<span class="tile"><b style=${`text-shadow:${miniShadow(list, 3, 'text')}`}>A</b></span>`;
  }

  /**
   * The swatches, last, as in the colour picker: the value as it was, then the design system's
   * shadow tokens, then HEO's own, each set behind its own short rule. They wrap onto more lines.
   */
  #renderSwatches(): TemplateResult {
    const mode = this.#shadowMode;
    const cell = (shadows: readonly Shadow[], label: string, swatch: ShadowSwatch | null, first = false): TemplateResult => {
      // An inset cannot be a text or a drop shadow, so a swatch made of one cannot be picked there.
      const blocked = mode !== 'box' && shadows.some((one) => one.inset);
      const pressed = sameShadows(shadows, this.shadows) && (first ? !this.fromSwatch : this.fromSwatch === null || this.fromSwatch.value === swatch?.value);
      return html`<button
        class="swatch"
        type="button"
        ?disabled=${blocked}
        aria-pressed=${pressed ? 'true' : 'false'}
        aria-label=${label}
        title=${blocked ? `${label}: an inset shadow, which ${this.mode === 'text' ? 'text-shadow' : 'drop-shadow()'} cannot be` : label}
        data-swatch=${first ? 'original' : label}
        @click=${() => this.#replace(shadows.map((one) => ({ ...one })), mode === 'box' ? swatch : null)}
      >
        ${mode === 'box'
          ? html`<i style=${`box-shadow:${miniShadow(shadows, 2)}`}></i>`
          : html`<b style=${`text-shadow:${miniShadow(shadows, 2, 'text')}`}>A</b>`}
      </button>`;
    };
    const sep = html`<span class="sep" aria-hidden="true"></span>`;
    return html`<div>
      <div class="group">Swatches</div>
      <div class="swatches" role="group" aria-label="Shadow swatches">
        ${cell(this.original, 'As it was', null, true)}
        ${this.tokens.length ? html`${sep}${this.tokens.map((one) => cell(one.shadows, one.name, one))}` : nothing}
        ${sep}
        ${HEO_SHADOW_SWATCHES.map((one) => cell(one.shadows, one.name, one))}
      </div>
    </div>`;
  }

  /** Drag the editor by its head: the host moves the popup by as much as the pointer moved. */
  #startMove = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const head = event.currentTarget as HTMLElement;
    event.preventDefault();
    head.setPointerCapture(event.pointerId);
    let last = { x: event.clientX, y: event.clientY };
    const move = (at: PointerEvent): void => {
      const delta = { dx: at.clientX - last.x, dy: at.clientY - last.y };
      last = { x: at.clientX, y: at.clientY };
      this.dispatchEvent(new CustomEvent('shadow-move', { detail: delta, bubbles: true, composed: true }));
    };
    const up = (): void => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  };

  #renderShadow(current: Shadow, mode: ShadowMode): TemplateResult {
    const x = lengthParts(current.x);
    const y = lengthParts(current.y);
    const draggable = x !== null && y !== null;
    const px = (length: { number: number; unit: string } | null): number =>
      length ? (length.unit === 'px' ? length.number : length.number * 16) : 0;
    const left = 50 + (Math.max(-DRAG_RANGE, Math.min(DRAG_RANGE, px(x))) / DRAG_RANGE) * 45;
    const top = 50 + (Math.max(-DRAG_RANGE, Math.min(DRAG_RANGE, px(y))) / DRAG_RANGE) * 45;
    const alpha = alphaOf(current.color, resolveColor);
    return html`
      <div class="offset">
        <div
          class=${draggable ? 'pad' : 'pad off'}
          tabindex=${draggable ? '0' : '-1'}
          role="slider"
          aria-label="Offset: drag, or use the arrow keys"
          aria-valuetext=${`${current.x} ${current.y}`}
          title=${draggable ? 'Drag to set the offset. Arrow keys nudge it; Shift for 10.' : 'The offset is not a plain length here; type it beside.'}
          @pointerdown=${this.#startDrag}
          @keydown=${this.#nudge}
        >
          <span class="zero"></span>
          <span class="dot" style=${`left:${left}%;top:${top}%`}></span>
        </div>
        <div class="xy">
          ${this.#lengthField('x', 'X', current.x)}
          ${this.#lengthField('y', 'Y', current.y)}
          ${mode === 'box'
        ? html`<heo-segmented
                label="Outer or inset"
                .options=${[{ value: 'outer', label: 'Outer' }, { value: 'inset', label: 'Inset' }]}
                .value=${current.inset ? 'inset' : 'outer'}
                @segment-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#edit({ inset: event.detail.value === 'inset' }, true);
          }}
              ></heo-segmented>`
        : nothing}
        </div>
      </div>
      ${this.#slider('blur', 'Blur', current.blur, 0, 80, false)}
      ${this.#slider('spread', 'Spread', current.spread, -40, 40, mode !== 'box')}
      <div class=${alpha === null ? 'line off' : 'line'} title=${alpha === null ? 'This color cannot be read here, so its opacity is set with the color itself.' : ''}>
        <label for="heo-shadow-alpha">Opacity</label>
        <input
          id="heo-shadow-alpha"
          type="range"
          min="0"
          max="100"
          .value=${String(Math.round((alpha ?? 1) * 100))}
          ?disabled=${alpha === null}
          @input=${(event: Event) => this.#setAlpha(Number((event.target as HTMLInputElement).value), false)}
          @change=${(event: Event) => this.#setAlpha(Number((event.target as HTMLInputElement).value), true)}
        />
        <span class="pct">
          <input
            aria-label="Opacity, percent"
            .value=${String(Math.round((alpha ?? 1) * 100))}
            ?disabled=${alpha === null}
            @change=${(event: Event) => this.#setAlpha(Number((event.target as HTMLInputElement).value), true)}
          />
          <span>%</span>
        </span>
      </div>
      <div class="line wide">
        <label>Color</label>
        <heo-value-field
          kind="color"
          property="color"
          field-label="Shadow color"
          .value=${current.color}
          @value-input=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (event.detail.value.trim()) this.#edit({ color: event.detail.value.trim() }, false);
      }}
          @value-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (event.detail.value.trim()) this.#edit({ color: event.detail.value.trim() }, true);
      }}
          @value-revert=${(event: Event) => event.stopPropagation()}
        ></heo-value-field>
      </div>
      ${lostIn(current, mode).length && this.mode !== 'box'
        ? html`<p class="warn">${icon('alert', 12)}<span>
            ${this.mode === 'text' ? 'text-shadow' : 'drop-shadow()'} has no ${lostIn(current, mode).join(' or ')}:
            this shadow is drawn without it.
          </span></p>`
        : nothing}
    `;
  }

  #lengthField(key: 'x' | 'y', label: string, value: string): TemplateResult {
    return html`<heo-value-field
      kind="length"
      chevron-hidden
      field-label=${`Offset ${label}`}
      .value=${value}
      @value-input=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (event.detail.value.trim()) this.#edit({ [key]: event.detail.value.trim() }, false);
      }}
      @value-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#edit({ [key]: event.detail.value.trim() || '0px' }, true);
      }}
      @value-revert=${(event: Event) => event.stopPropagation()}
    ></heo-value-field>`;
  }

  /** A range and its field. Off — and said why — where the mode has no such length. */
  #slider(key: 'blur' | 'spread', label: string, value: string, min: number, max: number, off: boolean): TemplateResult {
    const parts = lengthParts(value);
    const plain = parts !== null && parts.unit === 'px';
    const why = off ? `${this.mode === 'text' ? 'text-shadow' : 'drop-shadow()'} has no ${label.toLowerCase()}` : '';
    return html`<div class=${off ? 'line off' : 'line'} title=${why}>
      <label>${label}</label>
      <input
        type="range"
        aria-label=${label}
        min=${min}
        max=${max}
        .value=${String(parts?.number ?? 0)}
        ?disabled=${off || !plain}
        @input=${(event: Event) => this.#edit({ [key]: `${(event.target as HTMLInputElement).value}px` }, false)}
        @change=${(event: Event) => this.#edit({ [key]: `${(event.target as HTMLInputElement).value}px` }, true)}
      />
      ${off
        ? html`<span class="pct"><input aria-label=${label} disabled .value=${value} /></span>`
        : html`<heo-value-field
            kind="length"
            chevron-hidden
            field-label=${label}
            .value=${value}
            @value-input=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (event.detail.value.trim()) this.#edit({ [key]: event.detail.value.trim() }, false);
          }}
            @value-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#edit({ [key]: event.detail.value.trim() || '0px' }, true);
          }}
            @value-revert=${(event: Event) => event.stopPropagation()}
          ></heo-value-field>`}
    </div>`;
  }

  #setAlpha(percent: number, settle: boolean): void {
    if (!Number.isFinite(percent)) return;
    const current = this.shadows[this.picked];
    if (!current) return;
    const color = withAlpha(current.color, percent / 100, resolveColor);
    if (color) this.#edit({ color }, settle);
  }

  /** Drag on the pad: the shadow falls where the pointer is, previewed, and settles on release. */
  #startDrag = (event: PointerEvent): void => {
    const pad = event.currentTarget as HTMLElement;
    const current = this.shadows[this.picked];
    if (!current || !lengthParts(current.x) || !lengthParts(current.y)) return;
    event.preventDefault();
    pad.focus();
    pad.setPointerCapture(event.pointerId);
    const place = (at: PointerEvent, settle: boolean): void => {
      const box = pad.getBoundingClientRect();
      const toPx = (offset: number, size: number): number =>
        Math.round(Math.max(-DRAG_RANGE, Math.min(DRAG_RANGE, ((offset - size / 2) / (size * 0.45)) * DRAG_RANGE)));
      this.#edit({ x: `${toPx(at.clientX - box.left, box.width)}px`, y: `${toPx(at.clientY - box.top, box.height)}px` }, settle);
    };
    place(event, false);
    const move = (at: PointerEvent): void => place(at, false);
    const up = (at: PointerEvent): void => {
      pad.removeEventListener('pointermove', move);
      pad.removeEventListener('pointerup', up);
      pad.removeEventListener('pointercancel', up);
      place(at, true);
    };
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
  };

  #nudge = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    const current = this.shadows[this.picked];
    if (!delta || !current) return;
    const x = lengthParts(current.x);
    const y = lengthParts(current.y);
    if (!x || !y) return;
    event.preventDefault();
    event.stopPropagation();
    this.#edit({ x: `${x.number + delta[0]}${x.unit}`, y: `${y.number + delta[1]}${y.unit}` }, true);
  };

  #close = (): void => {
    this.dispatchEvent(new CustomEvent('shadow-close', { bubbles: true, composed: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-shadow-editor': HeoShadowEditor;
  }
}
