import { css, html, LitElement, nothing, svg, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { bezierCss, EASINGS, parseBezier } from '../../core/animations.js';
import { listen, unlisten } from '../../core/shield.js';
import { baseStyles } from '../theme.js';

/** The curve box: x is time 0–1, y is progress, with room above and below for overshoot. */
const W = 132;
const H = 104;
const Y_TOP = 1.45;
const Y_BOTTOM = -0.45;
const px = (x: number): number => 8 + x * (W - 16);
const py = (y: number): number => ((Y_TOP - y) / (Y_TOP - Y_BOTTOM)) * H;

/** A curve's points in the 0–1 box, for drawing: a Bézier sampled, or `linear()`'s stops. */
export function curvePoints(value: string, samples = 32): Array<[number, number]> | null {
  const bezier = parseBezier(value);
  if (bezier) {
    const [x1, y1, x2, y2] = bezier;
    const at = (t: number, a: number, b: number): number => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
    return Array.from({ length: samples + 1 }, (_, i) => {
      const t = i / samples;
      return [at(t, x1, x2), at(t, y1, y2)];
    });
  }
  const linear = /^linear\((.*)\)$/i.exec(value.trim());
  if (linear) {
    const stops = linear[1]!.split(',').map((one) => parseFloat(one)).filter(Number.isFinite);
    if (stops.length < 2) return null;
    return stops.map((y, i) => [i / (stops.length - 1), y]);
  }
  return null;
}

const pathOf = (points: Array<[number, number]>, sx: (x: number) => number, sy: (y: number) => number): string =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');

/**
 * An easing curve, drawn and editable.
 *
 * A `cubic-bezier()` (or a keyword that is one) shows its two handles, which are dragged to
 * reshape it; their x stays within 0–1, as CSS requires, and their y may leave it, which is how a
 * curve overshoots. A spring is a `linear()` and is shown, not dragged. The presets below are one
 * click each, springs included.
 *
 * Fires `easing-input` with `{ value }` while a handle is dragged and `easing-change` on release
 * or a preset.
 */
@customElement('heo-easing-editor')
export class HeoEasingEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 6px;
        justify-items: stretch;
      }
      svg.graph {
        justify-self: start;
        width: ${W}px;
        height: ${H}px;
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        box-shadow: inset 0 0 0 1px var(--heo-line);
        touch-action: none;
        overflow: visible;
      }
      .frame {
        fill: none;
        stroke: var(--heo-line-strong);
        stroke-dasharray: 2 3;
      }
      .curve {
        fill: none;
        stroke: var(--heo-accent);
        stroke-width: 2;
      }
      .arm {
        stroke: var(--heo-text-faint);
        stroke-width: 1;
      }
      .handle {
        fill: var(--heo-raised);
        stroke: var(--heo-accent);
        stroke-width: 2;
        cursor: grab;
      }
      .handle:focus-visible {
        outline: none;
        stroke-width: 3;
      }
      .presets {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 4px;
      }
      .preset {
        display: grid;
        justify-items: center;
        gap: 1px;
        padding: 3px 2px;
        border: 1px solid var(--heo-line);
        border-radius: 6px;
        background: var(--heo-raised);
        color: var(--heo-text-dim);
        font: inherit;
        font-size: 9.5px;
        line-height: 1.1;
        cursor: pointer;
      }
      .preset:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .preset[aria-pressed='true'] {
        border-color: var(--heo-accent);
        color: var(--heo-text);
      }
      .preset:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .preset svg {
        width: 34px;
        height: 18px;
        overflow: visible;
      }
      .preset path {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
      }
    `,
  ];

  @property({ type: String }) value = '';
  /** The handles being dragged, ahead of the value the host hands back. */
  @state() private draft: [number, number, number, number] | null = null;

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('value')) this.draft = null;
  }

  override render(): TemplateResult {
    const bezier = this.draft ?? parseBezier(this.value);
    const shown = this.draft ? bezierCss(this.draft) : this.value;
    const points = curvePoints(shown);
    return html`
      <svg class="graph" viewBox=${`0 0 ${W} ${H}`} role="group" aria-label="Easing curve">
        <rect class="frame" x=${px(0)} y=${py(1)} width=${px(1) - px(0)} height=${py(0) - py(1)}></rect>
        ${bezier
        ? svg`
          <line class="arm" x1=${px(0)} y1=${py(0)} x2=${px(bezier[0])} y2=${py(bezier[1])}></line>
          <line class="arm" x1=${px(1)} y1=${py(1)} x2=${px(bezier[2])} y2=${py(bezier[3])}></line>`
        : nothing}
        ${points ? svg`<path class="curve" d=${pathOf(points, px, py)}></path>` : nothing}
        ${bezier
        ? [0, 1].map((n) => svg`<circle
            class="handle"
            data-handle=${n}
            tabindex="0"
            role="slider"
            aria-label=${`Handle ${n + 1}`}
            aria-valuetext=${`${bezier[n * 2]!.toFixed(2)}, ${bezier[n * 2 + 1]!.toFixed(2)}`}
            cx=${px(bezier[n * 2]!)}
            cy=${py(bezier[n * 2 + 1]!)}
            r="5"
            @pointerdown=${(event: PointerEvent) => this.#drag(event, n, bezier)}
            @keydown=${(event: KeyboardEvent) => this.#key(event, n, bezier)}
          ></circle>`)
        : nothing}
      </svg>
      <div class="presets" role="group" aria-label="Easing presets">
        ${EASINGS.map((one) => {
          const mini = curvePoints(one.value, 16);
          return html`<button
            type="button"
            class="preset"
            title=${one.value.length > 60 ? `${one.label} (a spring, as linear())` : one.value}
            aria-pressed=${String(this.value.trim() === one.value)}
            @click=${() => this.#emit('easing-change', one.value)}
          >
            <svg viewBox="0 0 34 18" aria-hidden="true">
              ${mini ? svg`<path d=${pathOf(mini, (x) => 2 + x * 30, (y) => 15 - y * 12)}></path>` : nothing}
            </svg>
            ${one.label}
          </button>`;
        })}
      </div>
    `;
  }

  #drag(event: PointerEvent, n: number, start: [number, number, number, number]): void {
    event.preventDefault();
    const svgEl = this.renderRoot.querySelector('svg.graph') as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    let next: [number, number, number, number] = [...start];
    const move = (at: PointerEvent): void => {
      const x = Math.max(0, Math.min(1, ((at.clientX - rect.left) * (W / rect.width) - 8) / (W - 16)));
      const y = Math.max(-1, Math.min(2, Y_TOP - ((at.clientY - rect.top) * (H / rect.height)) / H * (Y_TOP - Y_BOTTOM)));
      next = [...next] as [number, number, number, number];
      next[n * 2] = Math.round(x * 100) / 100;
      next[n * 2 + 1] = Math.round(y * 100) / 100;
      this.draft = next;
      this.#emit('easing-input', bezierCss(next));
    };
    const up = (): void => {
      unlisten(window, 'pointermove', move, true);
      unlisten(window, 'pointerup', up, true);
      unlisten(window, 'pointercancel', up, true);
      this.#emit('easing-change', bezierCss(next));
    };
    // Capture phase, through the shield's own listener: the route a real move over the panel takes.
    listen(window, 'pointermove', move, true);
    listen(window, 'pointerup', up, true);
    listen(window, 'pointercancel', up, true);
  }

  #key(event: KeyboardEvent, n: number, start: [number, number, number, number]): void {
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = [...start] as [number, number, number, number];
    next[n * 2] = Math.round(Math.max(0, Math.min(1, next[n * 2]! + move[0])) * 100) / 100;
    next[n * 2 + 1] = Math.round((next[n * 2 + 1]! + move[1]) * 100) / 100;
    this.#emit('easing-change', bezierCss(next));
  }

  #emit(type: 'easing-input' | 'easing-change', value: string): void {
    this.dispatchEvent(new CustomEvent(type, { detail: { value }, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-easing-editor': HeoEasingEditor;
  }
}
