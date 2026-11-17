import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  composeBackground,
  composeBlend,
  gradientCss,
  imageCss,
  KEYWORD_POSITIONS,
  positionPercent,
  type Background,
  type BackgroundLayer,
  type Gradient,
  type Placement,
} from '../../core/background.js';
import { listen, unlisten } from '../../core/shield.js';
import { killStyles, renderKill } from '../kill.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import type { HeoValueField, ValueKind, ValueSuggestion } from './value-field.js';
import type { SegmentOption } from './segmented.js';
import './value-field.js';
import './segmented.js';

/** Everything a field needs from the host: its list, and the switch at the list's head. */
export interface BackgroundFieldSpec {
  suggestions: ValueSuggestion[];
  head: TemplateResult | null;
}

/** Gradients to start from, one click each. */
const PRESETS: Gradient[] = [
  { kind: 'linear', angle: 135, shape: '', at: '', stops: [{ color: '#6366f1', at: 0 }, { color: '#ec4899', at: 100 }] },
  { kind: 'linear', angle: 90, shape: '', at: '', stops: [{ color: '#06b6d4', at: 0 }, { color: '#3b82f6', at: 100 }] },
  { kind: 'linear', angle: 180, shape: '', at: '', stops: [{ color: '#f59e0b', at: 0 }, { color: '#ef4444', at: 100 }] },
  { kind: 'linear', angle: 45, shape: '', at: '', stops: [{ color: '#22c55e', at: 0 }, { color: '#14b8a6', at: 50 }, { color: '#0ea5e9', at: 100 }] },
  { kind: 'linear', angle: 180, shape: '', at: '', stops: [{ color: '#00000000', at: 0 }, { color: '#000000b3', at: 100 }] },
  { kind: 'radial', angle: 180, shape: 'circle', at: '', stops: [{ color: '#fde68a', at: 0 }, { color: '#f97316', at: 60 }, { color: '#7c2d12', at: 100 }] },
  { kind: 'radial', angle: 180, shape: 'ellipse', at: 'left top', stops: [{ color: '#a5b4fc', at: 0 }, { color: '#6366f100', at: 70 }] },
  { kind: 'linear', angle: 120, shape: '', at: '', stops: [{ color: '#0f172a', at: 0 }, { color: '#334155', at: 50 }, { color: '#0f172a', at: 100 }] },
];

const SIZE_OPTIONS: SegmentOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'custom', label: 'Set', title: 'A size of your own' },
];
const CLIP_OPTIONS: SegmentOption[] = [
  { value: 'border-box', label: 'Border', title: 'Paint into the border box' },
  { value: 'padding-box', label: 'Padding', title: 'Paint into the padding box' },
  { value: 'content-box', label: 'Content', title: 'Paint into the content box' },
];

/** The mini element's border and padding: where each box sits inside it, as an inset. */
const BOX_INSET: Record<string, number> = { 'border-box': -12, 'padding-box': 0, 'content-box': 14 };
/** How close to one of the nine dots, in pixels, a placement snaps to that keyword. */
const SNAP = 12;

const clone = (background: Background): Background => ({
  color: background.color,
  layers: background.layers.map((layer) => ({
    ...layer,
    gradient: layer.gradient ? { ...layer.gradient, stops: layer.gradient.stops.map((stop) => ({ ...stop })) } : undefined,
  })),
});
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
const placement = (): Placement => ({ position: '', size: '', repeat: '', attachment: '', origin: '', clip: '', blend: '' });
const isPending = (layer: BackgroundLayer | undefined): boolean => layer?.kind === 'image' && !layer.url?.trim();

/** Two hex colours mixed, for a stop added between two others; the left one where either is not hex. */
function mix(a: string, b: string, t: number): string {
  const hex = (c: string): number[] | null => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
    if (!m) return null;
    const full = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join('') : m[1]!;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const pa = hex(a);
  const pb = hex(b);
  if (!pa || !pb) return a;
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The Background section's editor: the layers, top first, over the base colour, and the picked
 * layer's fill and placement.
 *
 * A layer is a gradient (built from swatches or by hand: linear with an angle, or radial with a
 * shape and centre, and its stops on a 0–100 bar), an image by address, or a solid colour. Its
 * position is set on a drawing of the element: click or drag anywhere, and within reach of one of
 * the nine dots it snaps to that keyword. The dots are on the origin box, the box CSS measures the
 * position in; the clip control picks the box the layer paints into, outlined on the drawing.
 *
 * Keeps a working copy of the background, so a drag or a draft shows at once, and writes nothing
 * itself. Fires, with `{ value }` the whole background as it would now be:
 *
 * - `background-input` while a value is being explored, for the host's live preview;
 * - `background-change` when it is committed; the host writes one `background` shorthand (and
 *   `background-blend-mode` when a layer blends);
 * - `background-revert` when a field is left with nothing committed.
 *
 * An image layer just added has no address yet, so nothing is written for it until it has one.
 */
@customElement('heo-background-editor')
export class HeoBackgroundEditor extends LitElement {
  static override styles = [
    baseStyles,
    killStyles,
    css`
      :host {
        display: block;
      }
      button {
        font: inherit;
      }

      .checker {
        position: relative;
        overflow: hidden;
        background-image: var(--heo-checker);
        background-size: 8px 8px;
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
      }
      .checker > i {
        position: absolute;
        inset: 0;
        background-position: center;
        background-size: cover;
      }

      /* The layers, top first, and the base colour under them. */
      .layers {
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        overflow: hidden;
      }
      .layer {
        display: grid;
        grid-template-columns: 14px 26px minmax(0, 1fr) auto;
        gap: 7px;
        align-items: center;
        min-height: 38px;
        padding: 5px 4px 5px 4px;
        border-bottom: 1px solid var(--heo-line);
        background: var(--heo-raised);
        cursor: pointer;
      }
      .layer:hover {
        background: var(--heo-hover);
      }
      .layer[aria-pressed='true'] {
        background: color-mix(in oklab, var(--heo-accent) 12%, transparent);
        box-shadow: inset 2px 0 0 var(--heo-accent);
      }
      .layer:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: -2px;
      }
      .layer.over {
        box-shadow: inset 0 2px 0 var(--heo-accent);
      }
      .grip {
        display: grid;
        place-items: center;
        color: var(--heo-text-faint);
        cursor: grab;
      }
      .thumb {
        width: 26px;
        height: 26px;
        border-radius: 5px;
      }
      .name {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .name b {
        font-size: 11.5px;
        font-weight: 600;
        color: var(--heo-text);
      }
      .name span {
        overflow: hidden;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .base {
        display: grid;
        grid-template-columns: 14px 26px auto minmax(0, 1fr);
        gap: 7px;
        align-items: center;
        padding: 5px 6px 5px 4px;
        background: var(--heo-sunken);
      }
      .base b {
        font-size: 11.5px;
        font-weight: 600;
      }

      .adds {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 6px;
      }
      .add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 26px;
        padding: 0 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        color: var(--heo-text-dim);
        font-size: 11.5px;
        cursor: pointer;
      }
      .add:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
        border-color: var(--heo-line-strong);
      }
      .add:focus-visible,
      .icon-btn:focus-visible,
      .preset:focus-visible,
      .dot9:focus-visible,
      .stop:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }

      /* The picked layer. */
      .detail {
        margin-top: 10px;
        padding: 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
      }
      .detail-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 11px;
        font-weight: 600;
      }
      .detail-head heo-segmented {
        margin-left: auto;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 12px 0 6px;
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
      .row {
        display: grid;
        grid-template-columns: 70px minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        margin-bottom: 5px;
      }
      .row > .label {
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .line {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .note {
        margin: 6px 0 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.4;
      }
      details.more > summary {
        margin: 8px 0 4px;
        color: var(--heo-accent);
        font-size: 11px;
        cursor: pointer;
        list-style: none;
      }
      details.more > summary::-webkit-details-marker {
        display: none;
      }

      /* Gradient. */
      .presets {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 5px;
        margin-bottom: 8px;
      }
      .preset {
        aspect-ratio: 1;
        padding: 0;
        border: 0;
        border-radius: 6px;
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
        cursor: pointer;
      }
      .preset:hover {
        transform: scale(1.08);
      }
      .dial {
        position: relative;
        flex: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--heo-sunken);
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
        cursor: grab;
        touch-action: none;
      }
      .dial i {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 2px;
        height: 13px;
        margin-left: -1px;
        border-radius: 2px;
        background: var(--heo-accent);
        transform-origin: 50% 0;
      }
      .dial b {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 6px;
        height: 6px;
        margin: -3px;
        border-radius: 50%;
        background: var(--heo-accent);
      }
      .icon-btn {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-dim);
        cursor: pointer;
      }
      .icon-btn:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .narrow {
        width: 84px;
        flex: none;
      }
      .nine {
        display: grid;
        grid-template-columns: repeat(3, 14px);
        gap: 2px;
      }
      .dot9 {
        width: 14px;
        height: 14px;
        padding: 0;
        border: 0;
        border-radius: 3px;
        background: var(--heo-sunken);
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
        cursor: pointer;
      }
      .dot9[aria-pressed='true'] {
        background: var(--heo-accent);
        box-shadow: none;
      }

      .bar {
        position: relative;
        margin: 10px 7px 0;
        user-select: none;
      }
      .track {
        height: 28px;
        border-radius: 6px;
        cursor: copy;
      }
      .stop {
        position: absolute;
        top: -5px;
        width: 14px;
        height: 38px;
        margin-left: -7px;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: ew-resize;
        touch-action: none;
      }
      .stop::before {
        content: '';
        position: absolute;
        left: 6px;
        top: 4px;
        bottom: 4px;
        width: 2px;
        background: #fff;
        box-shadow: 0 0 0 1px rgb(0 0 0 / 30%);
      }
      .stop i {
        position: absolute;
        left: 0;
        bottom: -6px;
        width: 14px;
        height: 14px;
        border: 2px solid #fff;
        border-radius: 4px;
        box-shadow: 0 0 0 1px rgb(0 0 0 / 25%), 0 1px 3px rgb(0 0 0 / 30%);
      }
      .stop[aria-pressed='true'] i {
        box-shadow: 0 0 0 2px var(--heo-accent), 0 1px 3px rgb(0 0 0 / 30%);
      }
      .scale {
        position: relative;
        height: 20px;
        margin-top: 10px;
      }
      .scale span {
        position: absolute;
        transform: translateX(-50%);
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
      }
      .stops {
        display: grid;
        gap: 4px;
      }
      .stop-row {
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr) 80px 22px;
        gap: 5px;
        align-items: center;
        border-radius: 6px;
      }
      .stop-row.over {
        box-shadow: 0 -2px 0 var(--heo-accent);
      }

      /* Position: the element drawn, its boxes, the nine dots and the point. */
      .canvas {
        padding: 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-sunken);
      }
      .mini {
        position: relative;
        height: 136px;
        padding: 14px;
        border: 12px dashed color-mix(in oklab, var(--heo-accent) 28%, transparent);
        border-radius: 10px;
      }
      .clip-line {
        position: absolute;
        border: 2px solid var(--heo-accent);
        border-radius: 4px;
        box-shadow: 0 0 0 1px rgb(255 255 255 / 60%);
        pointer-events: none;
      }
      .origin {
        position: absolute;
        cursor: crosshair;
        touch-action: none;
      }
      .origin::before {
        content: '';
        position: absolute;
        inset: 0;
        border: 1px dashed rgb(255 255 255 / 80%);
        border-radius: 3px;
        mix-blend-mode: difference;
        pointer-events: none;
      }
      .snap {
        position: absolute;
        width: 8px;
        height: 8px;
        margin: -4px;
        border-radius: 50%;
        background: rgb(255 255 255 / 85%);
        box-shadow: 0 0 0 1px rgb(0 0 0 / 35%);
        pointer-events: none;
      }
      .snap.on {
        background: var(--heo-accent);
        box-shadow: 0 0 0 2px #fff;
        transform: scale(1.6);
      }
      .point {
        position: absolute;
        width: 22px;
        height: 22px;
        margin: -11px;
        border: 2px solid #fff;
        border-radius: 50%;
        background: rgb(255 255 255 / 18%);
        box-shadow: 0 0 0 1px rgb(0 0 0 / 35%), 0 2px 6px rgb(0 0 0 / 35%);
        pointer-events: none;
      }
      .point.snapped {
        border-color: var(--heo-accent);
      }
      .canvas-bar {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        margin-top: 7px;
      }
      .canvas-bar .in {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .clip {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        margin-top: 7px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }

      .tip {
        margin: 8px 0 0;
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.4;
      }
    `,
  ];

  /** The background as read from the page. */
  @property({ attribute: false }) value: Background = { layers: [], color: '' };
  /** What the page draws for the colour, for its placeholder. */
  @property({ type: String }) computedColor = '';
  /** Keyed by longhand: `background-color`, `background-repeat`, `background-blend-mode`. */
  @property({ attribute: false }) fields: Record<string, BackgroundFieldSpec> = {};

  /** The working copy: what the editor shows, ahead of the host while something is explored. */
  @state() private draft: Background = { layers: [], color: '' };
  @state() private selected = 0;
  /** The stop picked on the bar, by index into the gradient's stops. */
  @state() private stop = 0;
  /** What is being dragged in a list: a layer, or a stop's colour. */
  #dragFrom: { list: 'layer' | 'stop'; index: number } | null = null;
  /** The host's value last taken, as text: the host hands a new object on every render. */
  #taken = '';

  override willUpdate(changed: Map<string, unknown>): void {
    // A new answer from the host, and not the same one again: a preview re-renders the host, which
    // reads the page with the preview taken out, and that must not throw away the drag in progress.
    const taken = JSON.stringify(this.value);
    if (changed.has('value') && taken !== this.#taken) {
      this.#taken = taken;
      this.#reset();
    }
  }

  /**
   * Back to the host's value, the committed answer. An image just added and still waiting for its
   * address was never written, so it is carried over rather than lost.
   */
  #reset(): void {
    const pending = isPending(this.draft.layers[0]) ? this.draft.layers[0] : null;
    const next = clone(this.value);
    if (pending) next.layers.unshift(pending);
    this.draft = next;
    this.selected = clamp(this.selected, 0, Math.max(0, next.layers.length - 1));
  }

  override render(): TemplateResult {
    const layer = this.draft.layers[this.selected];
    return html`
      <div class="layers" role="group" aria-label="Background layers, top first">
        ${this.draft.layers.map((one, index) => this.#renderLayerRow(one, index))}
        <div class="base">
          <span></span>
          <span class="thumb checker"><i style=${this.draft.color ? `background:${this.draft.color}` : ''}></i></span>
          <b>Color</b>
          ${this.#field('background-color', 'color', this.draft.color, this.computedColor, 'Background color', (value, commit) =>
      this.#change((next) => { next.color = value; }, commit))}
        </div>
      </div>
      <div class="adds">
        <button type="button" class="add" data-add="gradient" @click=${() => this.#add('gradient')}>${icon('plus', 11)} Gradient</button>
        <button type="button" class="add" data-add="image" @click=${() => this.#add('image')}>${icon('plus', 11)} Image</button>
        <button type="button" class="add" data-add="solid" @click=${() => this.#add('solid')}>${icon('plus', 11)} Solid</button>
      </div>
      ${layer ? this.#renderDetail(layer, this.selected) : nothing}
      <p class="tip">Top layer first; the color is always underneath. Written as one background.</p>
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* The list                                                               */
  /* ---------------------------------------------------------------------- */

  #renderLayerRow(layer: BackgroundLayer, index: number): TemplateResult {
    return html`<div
      class="layer"
      role="button"
      tabindex="0"
      draggable="true"
      data-layer=${index}
      aria-pressed=${String(index === this.selected)}
      aria-label=${`${layerName(layer)}, layer ${index + 1}`}
      @click=${() => this.#select(index)}
      @keydown=${(event: KeyboardEvent) => this.#layerKey(event, index)}
      @dragstart=${(event: DragEvent) => this.#dragStart(event, 'layer', index)}
      @dragover=${(event: DragEvent) => this.#dragOver(event, 'layer')}
      @dragleave=${(event: DragEvent) => (event.currentTarget as HTMLElement).classList.remove('over')}
      @drop=${(event: DragEvent) => this.#drop(event, 'layer', index)}
    >
      <span class="grip" title="Drag to reorder">${icon('grip', 12)}</span>
      <span class="thumb checker"><i style=${thumbStyle(layer)}></i></span>
      <span class="name"><b>${layerName(layer)}</b><span>${layerSummary(layer)}</span></span>
      <span @click=${(event: Event) => event.stopPropagation()}>${renderKill({ label: `Remove ${layerName(layer).toLowerCase()} layer`, tight: true, onClick: () => this.#remove(index) })}</span>
    </div>`;
  }

  #layerKey(event: KeyboardEvent, index: number): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.#select(index);
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // Alt and an arrow move a layer, the keyboard's way to reorder.
      event.preventDefault();
      const to = clamp(index + (event.key === 'ArrowUp' ? -1 : 1), 0, this.draft.layers.length - 1);
      if (to !== index) this.#move(index, to);
    }
  }

  #select(index: number): void {
    this.selected = index;
    this.stop = 0;
  }

  #add(kind: 'gradient' | 'image' | 'solid'): void {
    const layer: BackgroundLayer = { kind, ...placement() };
    if (kind === 'gradient') layer.gradient = { kind: 'linear', angle: 180, shape: '', at: '', stops: [{ color: '#00000000', at: 0 }, { color: '#000000aa', at: 100 }] };
    if (kind === 'solid') layer.color = '#ffffff33';
    if (kind === 'image') Object.assign(layer, { url: '', size: 'cover', position: 'center', repeat: 'no-repeat' });
    // Only one image waits for its address at a time: a second "add image" picks the first.
    if (kind === 'image' && isPending(this.draft.layers[0])) {
      this.#select(0);
      this.#focusUrl();
      return;
    }
    const next = clone(this.draft);
    next.layers.unshift(layer);
    this.selected = 0;
    this.stop = 0;
    if (kind === 'image') {
      this.draft = next;
      this.#focusUrl();
    } else {
      this.#emit('background-change', next);
    }
  }

  #focusUrl(): void {
    void this.updateComplete.then(() => {
      (this.renderRoot.querySelector('heo-value-field[data-property="background-image"]') as HeoValueField | null)?.focusInput?.();
    });
  }

  #remove(index: number): void {
    const next = clone(this.draft);
    const [gone] = next.layers.splice(index, 1);
    this.selected = clamp(this.selected >= index ? this.selected - 1 : this.selected, 0, Math.max(0, next.layers.length - 1));
    if (isPending(gone)) this.draft = next;
    else this.#emit('background-change', next);
  }

  #move(from: number, to: number): void {
    const next = clone(this.draft);
    const [layer] = next.layers.splice(from, 1);
    next.layers.splice(to, 0, layer!);
    this.selected = to;
    this.#emit('background-change', next);
  }

  /* ---------------------------------------------------------------------- */
  /* The picked layer                                                       */
  /* ---------------------------------------------------------------------- */

  #renderDetail(layer: BackgroundLayer, index: number): TemplateResult {
    const kinds: SegmentOption[] = [{ value: 'gradient', label: 'Gradient' }, { value: 'solid', label: 'Solid' }];
    return html`<div class="detail" data-detail=${index}>
      <div class="detail-head">
        ${layerName(layer)}
        ${layer.kind === 'gradient' || layer.kind === 'solid'
        ? html`<heo-segmented
            label="Layer kind"
            .options=${kinds}
            .value=${layer.kind}
            @segment-change=${(event: CustomEvent<{ value: string }>) => this.#retype(index, event.detail.value as 'gradient' | 'solid')}
          ></heo-segmented>`
        : nothing}
      </div>
      ${this.#renderFill(layer, index)}
      <div class="group">Placement</div>
      ${this.#renderCanvas(layer, index)}
      ${this.#renderPlacement(layer, index)}
    </div>`;
  }

  #renderFill(layer: BackgroundLayer, index: number): TemplateResult {
    switch (layer.kind) {
      case 'gradient':
        return this.#renderGradient(layer.gradient!, index);
      case 'image':
        return html`<div class="row">
          <span class="label">image</span>
          ${this.#field('background-image', 'text', layer.url ?? '', '', 'Image address', (value, commit) =>
          this.#change((next) => { next.layers[index]!.url = value.replace(/^url\(\s*["']?|["']?\s*\)$/gi, ''); }, commit), 'https://…')}
        </div>`;
      case 'solid':
        return html`<div class="row">
          <span class="label">color</span>
          ${this.#field('solid-color', 'color', layer.color ?? '', '', 'Layer color', (value, commit) =>
          this.#change((next) => { next.layers[index]!.color = value; }, commit))}
        </div>`;
      default:
        return html`<div class="row">
          <span class="label">image</span>
          ${this.#field('background-image', 'text', layer.raw ?? '', '', 'Image', (value, commit) =>
          this.#change((next) => { next.layers[index]!.raw = value; }, commit))}
        </div>
        <p class="note">Written as it is: this editor does not take this kind of image apart.</p>`;
    }
  }

  #retype(index: number, kind: 'gradient' | 'solid'): void {
    const layer = this.draft.layers[index]!;
    if (layer.kind === kind) return;
    this.#change((next) => {
      const one = next.layers[index]!;
      if (kind === 'solid') {
        one.color = one.gradient?.stops[0]?.color ?? '#6366f1';
        one.gradient = undefined;
      } else {
        const color = one.color || '#6366f1';
        one.gradient = { kind: 'linear', angle: 180, shape: '', at: '', stops: [{ color, at: 0 }, { color: mix(color, '#ffffff', 0.6), at: 100 }] };
        one.color = undefined;
      }
      one.kind = kind;
    }, true);
  }

  /* ---------------------------------------------------------------------- */
  /* Gradient                                                               */
  /* ---------------------------------------------------------------------- */

  #renderGradient(gradient: Gradient, index: number): TemplateResult {
    const order = gradient.stops.map((_, k) => k).sort((a, b) => gradient.stops[a]!.at - gradient.stops[b]!.at);
    const kinds: SegmentOption[] = [{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }];
    const shapes: SegmentOption[] = [{ value: 'circle', label: 'Circle' }, { value: 'ellipse', label: 'Ellipse' }];
    const setGradient = (fn: (g: Gradient) => void, commit = true): void =>
      this.#change((next) => fn(next.layers[index]!.gradient!), commit);
    const line = { ...gradient, kind: 'linear' as const, angle: 90 };
    return html`
      <div class="presets" role="group" aria-label="Gradient swatches">
        ${PRESETS.map((preset, i) => html`<button
          type="button"
          class="preset"
          data-preset=${i}
          title="Use this gradient"
          aria-label=${`Gradient swatch ${i + 1}`}
          style=${`background:${gradientCss(preset)}`}
          @click=${() => {
        this.stop = 0;
        setGradient((g) => Object.assign(g, { ...preset, stops: preset.stops.map((stop) => ({ ...stop })) }));
      }}
        ></button>`)}
      </div>
      <div class="line">
        <heo-segmented
          label="Gradient kind"
          .options=${kinds}
          .value=${gradient.kind}
          @segment-change=${(event: CustomEvent<{ value: string }>) => setGradient((g) => { g.kind = event.detail.value as Gradient['kind']; })}
        ></heo-segmented>
      </div>
      <div class="line" style="margin-top:8px">
        ${gradient.kind === 'linear'
        ? html`
          <span
            class="dial"
            role="slider"
            tabindex="0"
            aria-label="Angle"
            aria-valuemin="0"
            aria-valuemax="359"
            aria-valuenow=${Math.round(gradient.angle)}
            title="Drag to turn; Shift snaps to 15°"
            @pointerdown=${(event: PointerEvent) => this.#dragDial(event, index)}
            @keydown=${(event: KeyboardEvent) => {
            const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            setGradient((g) => { g.angle = (((g.angle + step * (event.shiftKey ? 15 : 1)) % 360) + 360) % 360; });
          }}
          ><i style=${`transform:rotate(${gradient.angle + 180}deg)`}></i><b></b></span>
          <span class="narrow">${this.#field('gradient-angle', 'number', String(Math.round(gradient.angle)), '', 'Angle in degrees', (value, commit) => {
            const n = parseFloat(value);
            if (Number.isFinite(n)) setGradient((g) => { g.angle = ((n % 360) + 360) % 360; }, commit);
          })}</span>
          ${[[0, 'arrowUp'], [90, 'arrowRight'], [180, 'arrowDown'], [270, 'arrowLeft']].map(([angle, name]) => html`<button
            type="button"
            class="icon-btn"
            title=${`${angle}°`}
            aria-label=${`Angle ${angle}°`}
            @click=${() => setGradient((g) => { g.angle = angle as number; })}
          >${icon(name as string, 12)}</button>`)}`
        : html`
          <heo-segmented
            label="Shape"
            .options=${shapes}
            .value=${gradient.shape || 'ellipse'}
            @segment-change=${(event: CustomEvent<{ value: string }>) => setGradient((g) => { g.shape = event.detail.value === 'ellipse' ? '' : event.detail.value; })}
          ></heo-segmented>
          <span class="label" style="color:var(--heo-text-faint);font-size:10.5px">at</span>
          <span class="nine" role="group" aria-label="Centre">
            ${KEYWORD_POSITIONS.map((at) => html`<button
              type="button"
              class="dot9"
              title=${at}
              aria-label=${`Centre ${at}`}
              aria-pressed=${String((gradient.at || 'center') === at)}
              @click=${() => setGradient((g) => { g.at = at === 'center' ? '' : at; })}
            ></button>`)}
          </span>`}
      </div>
      <div class="bar">
        <div
          class="track checker"
          title="Click to add a stop"
          @pointerdown=${(event: PointerEvent) => this.#addStop(event, index)}
        ><i style=${`background:${gradientCss(line)}`}></i></div>
        ${gradient.stops.map((stop, k) => html`<button
          type="button"
          class="stop"
          data-stop=${k}
          style=${`left:${stop.at}%`}
          aria-pressed=${String(k === this.stop)}
          aria-label=${`Stop ${k + 1}: ${stop.color} at ${Math.round(stop.at)}%. Arrows move it, Delete removes it.`}
          @pointerdown=${(event: PointerEvent) => this.#dragStop(event, index, k)}
          @keydown=${(event: KeyboardEvent) => this.#stopKey(event, index, k)}
        ><i style=${`background:${stop.color}`}></i></button>`)}
        <div class="scale" aria-hidden="true">${[0, 25, 50, 75, 100].map((n) => html`<span style=${`left:${n}%`}>${n}</span>`)}</div>
      </div>
      <div class="stops" role="list" aria-label="Color stops">
        ${order.map((k) => {
          const stop = gradient.stops[k]!;
          return html`<div
            class="stop-row"
            role="listitem"
            draggable="true"
            data-row=${k}
            @dragstart=${(event: DragEvent) => this.#dragStart(event, 'stop', k)}
            @dragover=${(event: DragEvent) => this.#dragOver(event, 'stop')}
            @dragleave=${(event: DragEvent) => (event.currentTarget as HTMLElement).classList.remove('over')}
            @drop=${(event: DragEvent) => this.#drop(event, 'stop', k)}
          >
            <span class="grip" title="Drag to reorder the colors">${icon('grip', 12)}</span>
            ${this.#field('gradient-stop', 'color', stop.color, '', `Stop ${k + 1} color`, (value, commit) => {
            this.stop = k;
            setGradient((g) => { g.stops[k]!.color = value; }, commit);
          }, '', String(k))}
            ${this.#field('gradient-stop-at', 'number', String(Math.round(stop.at * 100) / 100), '', `Stop ${k + 1} position, percent`, (value, commit) => {
            const n = parseFloat(value);
            if (Number.isFinite(n)) setGradient((g) => { g.stops[k]!.at = clamp(n, 0, 100); }, commit);
          })}
            ${gradient.stops.length > 2
              ? renderKill({ label: `Remove stop ${k + 1}`, tight: true, onClick: () => this.#removeStop(index, k) })
              : html`<span></span>`}
          </div>`;
        })}
      </div>`;
  }

  #removeStop(index: number, k: number): void {
    this.stop = 0;
    this.#change((next) => { next.layers[index]!.gradient!.stops.splice(k, 1); }, true);
  }

  /** A press on the bar adds a stop there, coloured as the gradient is at that point. */
  #addStop(event: PointerEvent, index: number): void {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const at = clamp(Math.round(((event.clientX - rect.left) / rect.width) * 100), 0, 100);
    const stops = [...this.draft.layers[index]!.gradient!.stops].sort((a, b) => a.at - b.at);
    const right = stops.find((one) => one.at >= at) ?? stops[stops.length - 1]!;
    const left = [...stops].reverse().find((one) => one.at <= at) ?? stops[0]!;
    const t = right.at === left.at ? 0 : (at - left.at) / (right.at - left.at);
    this.#change((next) => {
      const g = next.layers[index]!.gradient!;
      g.stops.push({ color: mix(left.color, right.color, t), at });
      this.stop = g.stops.length - 1;
    }, true);
  }

  /** Drag a stop along the bar, past its neighbours if need be; a press that does not move opens its colour. */
  #dragStop(event: PointerEvent, index: number, k: number): void {
    event.preventDefault();
    this.stop = k;
    const rect = (this.renderRoot.querySelector('.track') as HTMLElement).getBoundingClientRect();
    const x0 = event.clientX;
    let moved = false;
    this.#track(
      (move) => {
        if (!moved && Math.abs(move.clientX - x0) < 3) return;
        moved = true;
        const at = clamp(Math.round(((move.clientX - rect.left) / rect.width) * 100), 0, 100);
        this.#change((next) => { next.layers[index]!.gradient!.stops[k]!.at = at; }, false);
      },
      () => {
        if (moved) this.#emit('background-change', this.draft);
        else (this.renderRoot.querySelector(`heo-value-field[data-stop="${k}"]`) as HeoValueField | null)?.pickColor();
      },
    );
  }

  #stopKey(event: KeyboardEvent, index: number, k: number): void {
    const stops = this.draft.layers[index]!.gradient!.stops;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1);
      this.#change((next) => {
        const stop = next.layers[index]!.gradient!.stops[k]!;
        stop.at = clamp(Math.round(stop.at + step), 0, 100);
      }, true);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && stops.length > 2) {
      event.preventDefault();
      this.#removeStop(index, k);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      (this.renderRoot.querySelector(`heo-value-field[data-stop="${k}"]`) as HeoValueField | null)?.pickColor();
    }
  }

  #dragDial(event: PointerEvent, index: number): void {
    event.preventDefault();
    const dial = event.currentTarget as HTMLElement;
    const rect = dial.getBoundingClientRect();
    const turn = (at: PointerEvent): void => {
      let angle = (Math.atan2(at.clientY - (rect.top + rect.height / 2), at.clientX - (rect.left + rect.width / 2)) * 180) / Math.PI + 90;
      angle = ((angle % 360) + 360) % 360;
      if (at.shiftKey) angle = Math.round(angle / 15) * 15;
      this.#change((next) => { next.layers[index]!.gradient!.angle = Math.round(angle) % 360; }, false);
    };
    turn(event);
    this.#track(turn, () => this.#emit('background-change', this.draft));
  }

  /* ---------------------------------------------------------------------- */
  /* Placement                                                              */
  /* ---------------------------------------------------------------------- */

  /** The element drawn with this background: click or drag on it to place the layer. */
  #renderCanvas(layer: BackgroundLayer, index: number): TemplateResult {
    const point = positionPercent(layer.position);
    const keyword = KEYWORD_POSITIONS.find((one) => one === layer.position.trim().toLowerCase().replace(/\s+/g, ' '));
    const origin = layer.origin || 'padding-box';
    const clip = layer.clip || 'border-box';
    const blend = composeBlend(this.draft);
    const paint = `background:${composeBackground(this.draft) || 'transparent'};${blend ? `background-blend-mode:${blend};` : ''}`;
    return html`<div class="canvas">
      <div class="mini" style=${paint}>
        <span class="clip-line" style=${`inset:${BOX_INSET[clip] ?? -12}px`}></span>
        <div
          class="origin"
          style=${`inset:${BOX_INSET[origin] ?? 0}px`}
          title="Click or drag to place this layer. Near a dot it snaps; Alt places it freely."
          @pointerdown=${(event: PointerEvent) => this.#place(event, index)}
        >
          ${KEYWORD_POSITIONS.map((one) => {
      const [x, y] = positionPercent(one)!;
      return html`<span class=${`snap${keyword === one ? ' on' : ''}`} style=${`left:${x}%;top:${y}%`}></span>`;
    })}
          ${point ? html`<span class=${`point${keyword ? ' snapped' : ''}`} style=${`left:${point[0]}%;top:${point[1]}%`}></span>` : nothing}
        </div>
      </div>
      <div class="canvas-bar">
        ${this.#field('background-position', 'text', layer.position, '', 'Position', (value, commit) =>
      this.#change((next) => { next.layers[index]!.position = value; }, commit), '0% 0%')}
        <span class="in">in ${origin.replace('-box', '')} box</span>
      </div>
      <div class="clip">
        <span>clip</span>
        <heo-segmented
          label="Paint into"
          .options=${CLIP_OPTIONS}
          .value=${clip}
          @segment-change=${(event: CustomEvent<{ value: string }>) => this.#change((next) => {
        next.layers[index]!.clip = event.detail.value === 'border-box' ? '' : event.detail.value;
      }, true)}
        ></heo-segmented>
      </div>
    </div>`;
  }

  /**
   * Where a press or a drag on the drawing puts the layer: within reach of one of the nine dots,
   * that keyword, which is what most positions are; elsewhere, or with Alt held, x% y%.
   */
  #place(event: PointerEvent, index: number): void {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const at = (move: PointerEvent): void => {
      const px = move.clientX - rect.left;
      const py = move.clientY - rect.top;
      let best: { keyword: string; distance: number } | null = null;
      if (!move.altKey) {
        for (const keyword of KEYWORD_POSITIONS) {
          const [x, y] = positionPercent(keyword)!;
          const distance = Math.hypot(px - (x / 100) * rect.width, py - (y / 100) * rect.height);
          if (distance <= SNAP && (!best || distance < best.distance)) best = { keyword, distance };
        }
      }
      const position = best
        ? best.keyword
        : `${clamp(Math.round((px / rect.width) * 100), 0, 100)}% ${clamp(Math.round((py / rect.height) * 100), 0, 100)}%`;
      this.#change((next) => { next.layers[index]!.position = position; }, false);
    };
    at(event);
    this.#track(at, () => this.#emit('background-change', this.draft));
  }

  #renderPlacement(layer: BackgroundLayer, index: number): TemplateResult {
    const size = layer.size.trim();
    const custom = Boolean(size) && !['auto', 'cover', 'contain'].includes(size);
    const set = (key: keyof Placement) => (value: string, commit: boolean): void =>
      this.#change((next) => { next.layers[index]![key] = value; }, commit);
    const boxed = !!(layer.attachment || layer.origin);
    return html`
      <div class="row" style="margin-top:8px">
        <span class="label">size</span>
        <heo-segmented
          label="Size"
          .options=${SIZE_OPTIONS}
          .value=${custom ? 'custom' : size || 'auto'}
          @segment-change=${(event: CustomEvent<{ value: string }>) => {
        const value = event.detail.value;
        this.#change((next) => { next.layers[index]!.size = value === 'auto' ? '' : value === 'custom' ? '50% auto' : value; }, true);
      }}
        ></heo-segmented>
      </div>
      ${custom
        ? html`<div class="row"><span></span>${this.#field('background-size', 'text', size, '', 'Size', set('size'))}</div>`
        : nothing}
      <div class="row">
        <span class="label">repeat</span>
        ${this.#field('background-repeat', 'keyword', layer.repeat, '', 'Repeat', set('repeat'), 'repeat')}
      </div>
      <div class="row">
        <span class="label">blend</span>
        ${this.#field('background-blend-mode', 'keyword', layer.blend, '', 'Blend mode', set('blend'), 'normal')}
      </div>
      <details class="more" ?open=${boxed}>
        <summary>More: attachment, origin</summary>
        <div class="row">
          <span class="label">attachment</span>
          ${this.#field('background-attachment', 'keyword', layer.attachment, '', 'Attachment', set('attachment'), 'scroll')}
        </div>
        <div class="row">
          <span class="label">origin</span>
          ${this.#field('background-origin', 'keyword', layer.origin, '', 'Origin', set('origin'), 'padding-box')}
        </div>
      </details>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Plumbing                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * One of the panel's own value fields. `property` names it (and finds its list in `fields`);
   * `stop` marks a stop's colour, so the bar can open that field's picker.
   */
  #field(
    property: string,
    kind: ValueKind,
    value: string,
    computed: string,
    label: string,
    write: (value: string, commit: boolean) => void,
    placeholder = '',
    stop = '',
  ): TemplateResult {
    const spec = this.fields[property] ?? (kind === 'color' ? this.fields['background-color'] : undefined);
    return html`<heo-value-field
      data-property=${property}
      data-stop=${stop || nothing}
      field-label=${label}
      .value=${value}
      .kind=${kind}
      .property=${property.startsWith('background-') ? property : kind === 'color' ? 'background-color' : ''}
      .computed=${computed}
      .suggestions=${spec?.suggestions ?? []}
      .head=${spec?.head ?? null}
      placeholder=${placeholder || computed}
      @value-input=${(event: CustomEvent<{ value: string }>) => { event.stopPropagation(); write(event.detail.value, false); }}
      @value-change=${(event: CustomEvent<{ value: string }>) => { event.stopPropagation(); write(event.detail.value, true); }}
      @value-revert=${(event: Event) => {
        event.stopPropagation();
        this.#reset();
        this.dispatchEvent(new CustomEvent('background-revert', { bubbles: true, composed: true }));
      }}
    ></heo-value-field>`;
  }

  /** Change the working copy, and say so: as a preview, or as the committed value. */
  #change(edit: (next: Background) => void, commit: boolean): void {
    const next = clone(this.draft);
    edit(next);
    this.#emit(commit ? 'background-change' : 'background-input', next);
  }

  #emit(type: 'background-input' | 'background-change', next: Background): void {
    this.draft = next;
    this.dispatchEvent(new CustomEvent(type, { detail: { value: clone(next) }, bubbles: true, composed: true }));
  }

  /**
   * Follow the pointer until it is let go, on the window so leaving the control does not drop it.
   *
   * In the capture phase, through the shield's own `listen`. The shield stops the editor's own
   * events at the overlay host on their way out (shieldOverlayEvents), so a bubbling listener on the
   * window never heard a real move made over the panel, and the drag did nothing; and the window's
   * own addEventListener is gated for the page. Synthetic events sent to the window itself hid that.
   */
  #track(move: (event: PointerEvent) => void, done: () => void): void {
    const onMove = (event: PointerEvent): void => move(event);
    const onUp = (): void => {
      unlisten(window, 'pointermove', onMove, true);
      unlisten(window, 'pointerup', onUp, true);
      unlisten(window, 'pointercancel', onUp, true);
      done();
    };
    listen(window, 'pointermove', onMove, true);
    listen(window, 'pointerup', onUp, true);
    listen(window, 'pointercancel', onUp, true);
  }

  #dragStart(event: DragEvent, list: 'layer' | 'stop', index: number): void {
    // A drag that starts in a field is the field's text being selected, not the row moving.
    if ((event.composedPath()[0] as HTMLElement).closest?.('heo-value-field')) {
      event.preventDefault();
      return;
    }
    this.#dragFrom = { list, index };
    event.dataTransfer?.setData('text/plain', `${list}:${index}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  #dragOver(event: DragEvent, list: 'layer' | 'stop'): void {
    if (this.#dragFrom?.list !== list) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.add('over');
  }

  #drop(event: DragEvent, list: 'layer' | 'stop', index: number): void {
    (event.currentTarget as HTMLElement).classList.remove('over');
    const from = this.#dragFrom;
    this.#dragFrom = null;
    if (!from || from.list !== list || from.index === index) return;
    event.preventDefault();
    if (list === 'layer') {
      this.#move(from.index, index);
      return;
    }
    // A stop's colour moves along the list; the positions stay where they are on the bar.
    this.#change((next) => {
      const g = next.layers[this.selected]!.gradient!;
      const order = g.stops.map((_, k) => k).sort((a, b) => g.stops[a]!.at - g.stops[b]!.at);
      const colours = order.map((k) => g.stops[k]!.color);
      const [moved] = colours.splice(order.indexOf(from.index), 1);
      colours.splice(order.indexOf(index), 0, moved!);
      order.forEach((k, i) => { g.stops[k]!.color = colours[i]!; });
      this.stop = index;
    }, true);
  }
}

function layerName(layer: BackgroundLayer): string {
  switch (layer.kind) {
    case 'gradient':
      return layer.gradient!.kind === 'linear' ? 'Linear gradient' : 'Radial gradient';
    case 'image':
      return 'Image';
    case 'solid':
      return 'Solid';
    default:
      return layer.raw === 'none' ? 'No image' : 'Image (as written)';
  }
}

function layerSummary(layer: BackgroundLayer): string {
  const blend = layer.blend && layer.blend !== 'normal' ? ` · ${layer.blend}` : '';
  switch (layer.kind) {
    case 'gradient': {
      const g = layer.gradient!;
      return `${g.kind === 'linear' ? `${Math.round(g.angle)}°` : g.shape || 'ellipse'} · ${g.stops.length} stops${blend}`;
    }
    case 'image': {
      const url = layer.url?.trim() ?? '';
      // An inline image says what it is, not the tail of its encoded text.
      const name = !url ? 'no address yet'
        : url.startsWith('data:') ? `inline ${/^data:image\/([\w.+-]+)/i.exec(url)?.[1]?.replace('+xml', '') ?? 'image'}`
        : url.split(/[?#]/)[0]!.split('/').pop()!.slice(0, 40) || url.slice(0, 40);
      return `${name}${blend}`;
    }
    case 'solid':
      return `${layer.color}${blend}`;
    default:
      return `${(layer.raw ?? '').slice(0, 40)}${blend}`;
  }
}

function thumbStyle(layer: BackgroundLayer): string {
  const image = imageCss(layer);
  return image ? `background-image:${image}` : '';
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-background-editor': HeoBackgroundEditor;
  }
}
