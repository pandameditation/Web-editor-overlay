import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  composeBackground,
  composeBlend,
  gradientCss,
  imageCss,
  isDefault,
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

/** Everything a field needs from the host: its list. */
export interface BackgroundFieldSpec {
  suggestions: ValueSuggestion[];
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
/** What a layer paints into: the three boxes, drawn as rings, and the letters, drawn as Aa. */
const CLIPS: ReadonlyArray<{ value: string; label: string; title: string }> = [
  { value: 'border-box', label: 'Border', title: 'Paints under the border too' },
  { value: 'padding-box', label: 'Padding', title: 'Stops at the inside of the border' },
  { value: 'content-box', label: 'Content', title: 'Only behind the content' },
  { value: 'text', label: 'Text', title: 'Only inside the letters' },
];
/** What a layer does when the page scrolls, said as what is seen, each with its CSS word. */
const ATTACH_OPTIONS: SegmentOption[] = [
  { value: 'scroll', label: 'Moves', title: 'scroll: moves with the element as the page scrolls' },
  { value: 'fixed', label: 'Stays', title: 'fixed: stays still in the window; the element slides over it' },
  { value: 'local', label: 'Inside', title: 'local: scrolls with what is inside the element' },
];
/** The layer's sections, folded by the user, for the session: the same ones stay folded layer to layer. */
const folded = new Set<string>();

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
/** A layer's clip and attachment as they read: the default where nothing is written. */
const clipOf = (layer: BackgroundLayer): string => layer.clip.trim().toLowerCase() || 'border-box';
const attachmentOf = (layer: BackgroundLayer): string => layer.attachment.trim().toLowerCase() || 'scroll';
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
        grid-template-columns: 14px 26px minmax(0, 1fr) auto auto;
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
      button.thumb {
        padding: 0;
        border: 0;
        cursor: pointer;
      }
      button.thumb:focus-visible {
        outline: 2px solid var(--heo-accent);
        outline-offset: 1px;
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

      /* A layer's tags in the list: what it paints into, how it scrolls, where not the default. */
      .tags {
        display: flex;
        gap: 4px;
      }
      .tag {
        padding: 0 6px;
        border-radius: 999px;
        background: var(--heo-active);
        color: var(--heo-text-dim);
        font-size: 9.5px;
        font-weight: 600;
        line-height: 16px;
        white-space: nowrap;
      }
      .tag.accent {
        background: var(--heo-accent-soft);
        color: var(--heo-accent-text);
      }

      /*
       * The layer's sections: Fill, Paint, Placement. The head is the group label the detail had,
       * made a button that folds its section, with what the section holds at its end.
       */
      .sect + .sect {
        margin-top: 12px;
      }
      .shead {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        margin: 0 0 8px;
        padding: 2px 0;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
      }
      .shead::after {
        content: '';
        flex: 1;
        order: 2;
        min-width: 12px;
        border-top: 1px solid var(--heo-line);
      }
      .shead:hover {
        color: var(--heo-text-dim);
      }
      .shead:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 2px;
      }
      .shead .chev {
        display: grid;
        transition: rotate var(--heo-fast);
      }
      .shead[aria-expanded='false'] {
        margin-bottom: 0;
      }
      .shead[aria-expanded='false'] .chev {
        rotate: -90deg;
      }
      .shead .sval {
        order: 3;
        max-width: 60%;
        overflow: hidden;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10px;
        font-weight: 400;
        letter-spacing: 0;
        text-overflow: ellipsis;
        text-transform: none;
        white-space: nowrap;
      }

      /*
       * Paint: the element drawn as its three boxes, the layer painted into the one it clips to.
       * Each ring is a button; the Aa in the middle paints only inside the letters.
       */
      .paint {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 84px;
        gap: 8px;
      }
      .rings {
        position: relative;
        height: 136px;
        overflow: hidden;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-sunken);
      }
      .rings .fill {
        position: absolute;
        inset: 6px;
        display: grid;
        place-items: center;
        padding: 14px 16px;
        border: 14px solid color-mix(in oklab, var(--heo-text-faint) 22%, transparent);
        border-radius: 9px;
        pointer-events: none;
      }
      .aa {
        font: 900 30px/1 system-ui, sans-serif;
      }
      .ring {
        position: absolute;
        padding: 0;
        border: 0;
        border-radius: 9px;
        background: transparent;
        cursor: pointer;
        transition: box-shadow var(--heo-fast);
      }
      .ring.border {
        inset: 6px;
      }
      .ring.padding {
        inset: 20px;
        border-radius: 6px;
      }
      .ring.content {
        inset: 34px 36px;
        border-radius: 4px;
      }
      .ring .lbl {
        position: absolute;
        top: 1px;
        left: 7px;
        color: var(--heo-text-faint);
        font-size: 8.5px;
        font-weight: 650;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        text-shadow: 0 1px 2px rgb(0 0 0 / 45%);
        pointer-events: none;
      }
      .ring:hover {
        box-shadow: inset 0 0 0 2px var(--heo-accent-line);
      }
      .ring:hover .lbl {
        color: var(--heo-text);
      }
      .ring[aria-checked='true'] {
        box-shadow: inset 0 0 0 2px var(--heo-accent);
      }
      .ring[aria-checked='true'] .lbl {
        color: #fff;
      }
      .ring:focus-visible,
      .aa-btn:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .aa-btn {
        position: absolute;
        left: 50%;
        top: 50%;
        z-index: 1;
        translate: -50% -50%;
        padding: 2px 8px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--heo-text);
        font: 900 30px/1 system-ui, sans-serif;
        cursor: pointer;
        transition: box-shadow var(--heo-fast);
      }
      .aa-btn:hover {
        box-shadow: 0 0 0 2px var(--heo-accent-line);
      }
      /* Picked, it lets the painted letters under it show: it is only their frame now. */
      .aa-btn[aria-checked='true'] {
        color: transparent;
        box-shadow: 0 0 0 2px var(--heo-accent);
      }

      /* The scroll preview: a little page with the element on it, scrolled by its slider. */
      .scrub {
        display: grid;
        grid-template-rows: 1fr auto auto;
        gap: 3px;
      }
      .vp {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--heo-line-strong);
        border-radius: 8px;
        background: var(--heo-raised);
      }
      .vp .doc {
        position: absolute;
        inset: 0 0 auto;
        height: 220px;
      }
      .vp .doc i {
        display: block;
        height: 4px;
        margin: 6px 8px;
        border-radius: 2px;
        background: var(--heo-line-strong);
      }
      .vp .doc .el {
        display: block;
        height: 42px;
        margin: 8px 6px;
        border: 1px solid var(--heo-text-faint);
        border-radius: 5px;
        background-size: cover;
      }
      .vp .pinned {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .scrub input[type='range'] {
        width: 100%;
        margin: 0;
        accent-color: var(--heo-accent);
      }
      .scrub .cap {
        color: var(--heo-text-faint);
        font-size: 9.5px;
        text-align: center;
      }

      .textfill {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        padding: 7px 9px;
        border-radius: var(--heo-r-sm);
        background: var(--heo-accent-soft);
        color: var(--heo-text);
        font-size: 11px;
        line-height: 1.35;
        cursor: pointer;
      }
      .textfill input {
        flex: none;
        margin: 0;
        accent-color: var(--heo-accent);
      }
      .note.warn {
        color: var(--heo-warn-text);
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
  /**
   * Whether the element's text is see-through (its colour fully transparent), so a layer clipped to
   * the text shows through the letters. The host reads it from the page; the switch sets it.
   */
  @property({ type: Boolean }) textTransparent = false;
  /** Keyed by longhand: `background-color`, `background-repeat`, `background-blend-mode`. */
  @property({ attribute: false }) fields: Record<string, BackgroundFieldSpec> = {};

  /** The working copy: what the editor shows, ahead of the host while something is explored. */
  @state() private draft: Background = { layers: [], color: '' };
  @state() private selected = 0;
  /** The stop picked on the bar, by index into the gradient's stops. */
  @state() private stop = 0;
  /** How far the scroll preview's little page is scrolled, 0 to 100. */
  @state() private scrubbed = 0;
  /** What is being dragged in a list: a layer, or a stop's colour. */
  #dragFrom: { list: 'layer' | 'stop'; index: number } | null = null;
  /** The host's value last taken, as text: the host hands a new object on every render. */
  #taken = '';
  /**
   * The field being typed into, and what it held before the first keystroke.
   *
   * Every field here is drawn from the draft, and a keystroke's preview changes the draft, so the
   * field was handed its own preview back as its value. Leaving it then found nothing to commit
   * (the text equalled the value) and announced a revert instead, which threw the edit away: type a
   * stop's colour, Tab out, and it snapped back. Until it commits or reverts, the field keeps being
   * told the value it started from, as every other host's fields are.
   */
  #typing: { key: string; value: string } | null = null;

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
          <button
            type="button"
            class="thumb checker"
            aria-label="Pick background color"
            title="Pick background color"
            @click=${() => (this.renderRoot.querySelector('.base heo-value-field[data-property="background-color"]') as HeoValueField | null)?.pickColor()}
          ><i style=${this.draft.color ? `background:${this.draft.color}` : ''}></i></button>
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
      ${this.#renderTags(layer)}
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
      ${this.#renderSection('fill', 'Fill', layerSummary(layer), this.#renderFill(layer, index))}
      ${this.#renderSection('paint', 'Paint', `${CLIPS.find((one) => one.value === clipOf(layer))?.label ?? clipOf(layer)} · ${ATTACH_OPTIONS.find((one) => one.value === attachmentOf(layer))?.label ?? attachmentOf(layer)}`, this.#renderPaint(layer, index))}
      ${this.#showsPlacement(layer)
        ? this.#renderSection('placement', 'Placement', placementSummary(layer), html`${this.#renderCanvas(layer, index)}${this.#renderPlacement(layer, index)}`)
        : nothing}
    </div>`;
  }

  /**
   * Placement is offered on image layers: on a gradient or a colour, a panel of position, size and
   * repeat was noise for what it draws. A layer that already carries placement of its own keeps
   * the panel, so an authored value (a gradient's size, say) is never written to the page with no
   * way left to see or change it.
   */
  #showsPlacement(layer: BackgroundLayer): boolean {
    if (layer.kind === 'image') return true;
    // Clip and attachment are Paint's, which every layer has: they do not open Placement.
    // A part at its default says nothing: "padding-box text" reads back an origin of padding-box,
    // the default, and that opened Placement on a gradient clipped to its text.
    return (Object.keys(placement()) as Array<keyof Placement>)
      .filter((key) => key !== 'clip' && key !== 'attachment')
      .some((key) => !isDefault(key, layer[key] ?? ''));
  }

  /**
   * One of the layer's sections: a head that folds it, saying what it holds, so a folded section
   * still reads ("Text · Stays"), and its body.
   */
  #renderSection(id: string, title: string, summary: string, body: TemplateResult): TemplateResult {
    const open = !folded.has(id);
    return html`<section class="sect" data-section=${id}>
      <button
        type="button"
        class="shead"
        aria-expanded=${String(open)}
        @click=${() => {
          if (open) folded.add(id);
          else folded.delete(id);
          this.requestUpdate();
        }}
      >
        <span class="chev" aria-hidden="true">${icon('chevronDown', 10)}</span>
        <span class="stitle">${title}</span>
        <span class="sval">${summary}</span>
      </button>
      ${open ? html`<div class="sbody">${body}</div>` : nothing}
    </section>`;
  }

  /** A layer's tags in the list: what it paints into and how it scrolls, where those are not the default. */
  #renderTags(layer: BackgroundLayer): TemplateResult | typeof nothing {
    const clip = clipOf(layer);
    const attachment = attachmentOf(layer);
    if (clip === 'border-box' && attachment === 'scroll') return nothing;
    return html`<span class="tags">
      ${clip !== 'border-box' ? html`<span class=${clip === 'text' ? 'tag accent' : 'tag'}>${CLIPS.find((one) => one.value === clip)?.label ?? clip}</span>` : nothing}
      ${attachment !== 'scroll' ? html`<span class="tag">${attachment === 'fixed' ? 'Fixed' : attachment === 'local' ? 'Local' : attachment}</span>` : nothing}
    </span>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Paint: what the layer paints into, and what it does when the page scrolls */
  /* ---------------------------------------------------------------------- */

  /**
   * The layer drawn in the element's three boxes, each ring a button: click one to paint into that
   * box, or the Aa to paint only inside the letters. Beside it, a little page with the element on
   * it: drag its slider to scroll, and the layer moves, stays or scrolls inside, as it will.
   */
  #renderPaint(layer: BackgroundLayer, index: number): TemplateResult {
    const clip = clipOf(layer);
    const text = clip === 'text';
    const fill = paintStyle(layer);
    const setClip = (value: string): void => this.#change((next) => {
      next.layers[index]!.clip = value === 'border-box' ? '' : value;
    }, true);
    const rings = CLIPS.slice(0, 3).map((one) => html`<button
      type="button"
      class=${`ring ${one.label.toLowerCase()}`}
      role="radio"
      data-clip=${one.value}
      aria-checked=${String(clip === one.value)}
      tabindex=${clip === one.value || (text && one.value === 'border-box') ? '0' : '-1'}
      aria-label=${`Paint into the ${one.label.toLowerCase()} box`}
      title=${one.title}
      @click=${() => setClip(one.value)}
    ><span class="lbl">${one.label}</span></button>`);
    const others = this.draft.layers.some((one, at) => at !== index && imageCss(one) && clipOf(one) !== 'text');
    return html`
      <div class="paint">
        <div class="rings" role="radiogroup" aria-label="Paints into" @keydown=${(event: KeyboardEvent) => this.#ringKey(event, index)}>
          ${text
        ? html`<span class="fill" style=${`inset:6px;border-width:14px`}><b class="aa" style=${`${fill}-webkit-background-clip:text;background-clip:text;color:transparent`}>Aa</b></span>`
        : html`<span class="fill" style=${`${fill}background-clip:${clip};background-origin:border-box`}></span>`}
          ${rings}
          <button
            type="button"
            class="aa-btn"
            role="radio"
            data-clip="text"
            aria-checked=${String(text)}
            tabindex=${text ? '0' : '-1'}
            aria-label="Paint only inside the text"
            title="Only inside the letters"
            @click=${() => setClip('text')}
          >Aa</button>
        </div>
        ${this.#renderScrollPreview(layer)}
      </div>
      ${text
        ? html`<label class="textfill">
            <input
              type="checkbox"
              .checked=${this.textTransparent}
              @change=${(event: Event) => this.dispatchEvent(new CustomEvent('background-text-transparent', {
          detail: { value: (event.target as HTMLInputElement).checked },
          bubbles: true,
          composed: true,
        }))}
            />
            <span>Make the text transparent, so the layer shows through</span>
          </label>
          ${others ? html`<p class="note warn">The other layers still paint the whole box. Clip them to Text too, or the letters sit on a filled box.</p>` : nothing}`
        : nothing}
      <div class="row" style="margin-top:8px">
        <span class="label">on scroll</span>
        <heo-segmented
          label="On scroll"
          .options=${ATTACH_OPTIONS}
          .value=${attachmentOf(layer)}
          @segment-change=${(event: CustomEvent<{ value: string }>) => this.#change((next) => {
          next.layers[index]!.attachment = event.detail.value === 'scroll' ? '' : event.detail.value;
        }, true)}
        ></heo-segmented>
      </div>`;
  }

  /** The rings and the Aa are one radio group: the arrows move along it, as they do in any. */
  #ringKey(event: KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const order = CLIPS.map((one) => one.value);
    const at = order.indexOf(clipOf(this.draft.layers[index]!));
    const next = order[(at + step + order.length) % order.length]!;
    this.#change((draft) => { draft.layers[index]!.clip = next === 'border-box' ? '' : next; }, true);
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`.rings [data-clip="${next}"]`)?.focus());
  }

  /**
   * A little page with the element on it, to scroll by its slider. "Moves": the layer goes with the
   * element. "Stays": it stays in the window and the element slides over it. "Inside": it scrolls
   * with what is in the element, so here it drifts against the element's frame.
   */
  #renderScrollPreview(layer: BackgroundLayer): TemplateResult {
    const attachment = attachmentOf(layer);
    const fill = paintStyle(layer);
    // The little page scrolls up to 60px; the element sits 30px down it and is 42px tall.
    const y = Math.round(this.scrubbed * 0.6);
    const top = 30 - y;
    return html`<div class="scrub">
      <div class="vp" aria-hidden="true">
        ${attachment === 'fixed'
        ? html`<span class="pinned" style=${`${fill}clip-path:inset(${top}px 7px calc(100% - ${top + 42}px) 7px round 5px)`}></span>`
        : nothing}
        <div class="doc" style=${`translate:0 ${-y}px`}>
          <i></i><i style="width:60%"></i>
          <span class="el" style=${attachment === 'fixed' ? '' : `${fill}${attachment === 'local' ? `background-position:0 ${-y * 0.8}px;` : ''}`}></span>
          <i></i><i style="width:70%"></i><i></i><i style="width:50%"></i>
        </div>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        .value=${String(this.scrubbed)}
        aria-label="Scroll the preview page"
        @input=${(event: Event) => { this.scrubbed = Number((event.target as HTMLInputElement).value); }}
      />
      <span class="cap">drag to scroll</span>
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
    const boxed = !isDefault('origin', layer.origin);
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
        <summary>More: origin</summary>
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
    const key = `${this.selected}\u0000${label}`;
    const typing = this.#typing?.key === key ? this.#typing : null;
    const settled = (): void => { if (this.#typing?.key === key) this.#typing = null; };
    return html`<heo-value-field
      data-property=${property}
      data-stop=${stop || nothing}
      field-label=${label}
      .value=${typing ? typing.value : value}
      .kind=${kind}
      .property=${property.startsWith('background-') ? property : kind === 'color' ? 'background-color' : ''}
      .computed=${computed}
      .suggestions=${spec?.suggestions ?? []}
      placeholder=${placeholder || computed}
      @value-input=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (!typing) this.#typing = { key, value };
        write(event.detail.value, false);
      }}
      @value-change=${(event: CustomEvent<{ value: string }>) => { event.stopPropagation(); settled(); write(event.detail.value, true); }}
      @value-revert=${(event: Event) => {
        event.stopPropagation();
        settled();
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

/** Placement, as its section head says it: where the layer sits, and its size. */
function placementSummary(layer: BackgroundLayer): string {
  const parts = [layer.position.trim() || '0% 0%', layer.size.trim() || 'auto'];
  if (layer.repeat.trim() && layer.repeat.trim() !== 'repeat') parts.push(layer.repeat.trim());
  return parts.join(' · ');
}

/** A layer's paint, for the Paint drawings: its image, an image covering the box as it would at a glance. */
function paintStyle(layer: BackgroundLayer): string {
  const image = imageCss(layer);
  if (!image) return '';
  return layer.kind === 'image' ? `background-image:${image};background-size:cover;background-position:center;` : `background-image:${image};`;
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
