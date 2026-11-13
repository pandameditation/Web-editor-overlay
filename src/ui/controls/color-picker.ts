import { css, html, LitElement, nothing, svg, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  composite,
  contrastLevels,
  contrastRatio,
  hsvToRgb,
  inGamut,
  oklchToRgb,
  parseOklch,
  rgbToHsv,
  rgbToOklch,
  toHex,
  toOklchString,
  type Hsva,
  type Oklch,
  type Rgba,
} from '../../core/color.js';
import { listen, unlisten } from '../../core/shield.js';
import { resolveColor, type ContrastTarget } from '../contrast.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

/** A token offered as a swatch: its `var()` and the colour it resolves to. */
export interface ColorSwatch {
  value: string;
  label: string;
  color: string;
}

type Format = 'hex' | 'oklch';

/** The square's size, in CSS pixels: the contrast curve is computed at this resolution. */
const AREA_W = 236;
const AREA_H = 148;

/**
 * The colour picker a colour field opens: a saturation and brightness square over a hue, hue and
 * alpha sliders, an eyedropper where the browser has one, HEX and OKLCH fields, the project's
 * colour tokens, and the WCAG contrast of the colour against what it will be read with.
 *
 * Writes in one of two formats, HEX or OKLCH, switched by the format control or by typing into
 * either field. Starts in the format of the value it was given. An OKLCH value outside sRGB keeps
 * its exact numbers when written as OKLCH; the square and the HEX field show it clipped.
 *
 * The contrast check draws the AA line on the square, so every colour on the passing side of it
 * passes: a text colour against the worst colour behind the text (a gradient's stops, an image's
 * pixels), a background against the text colour.
 *
 * Fires `color-input` with `{ value }` while a colour is explored (dragging, typing), `color-change`
 * when it is committed, and `color-close` on Escape, which keeps the colour as it is: undo is the way
 * back, as for any other edit.
 */
@customElement('heo-color-picker')
export class HeoColorPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: 9px;
        width: 100%;
        min-width: 236px;
        user-select: none;
      }

      .checker {
        position: relative;
        overflow: hidden;
        background-image: var(--heo-checker);
        background-size: 8px 8px;
      }

      /* The square. */
      .area {
        position: relative;
        height: ${AREA_H}px;
        border-radius: var(--heo-r-sm);
        cursor: crosshair;
        touch-action: none;
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
      }
      .area:focus-visible,
      .slider:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 2px;
      }
      .area svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        pointer-events: none;
      }
      .curve {
        fill: none;
        stroke: #fff;
        stroke-width: 1.5;
        filter: drop-shadow(0 0 1px rgb(0 0 0 / 70%));
      }
      .curve.aaa {
        stroke-dasharray: 3 3;
        stroke-width: 1;
      }
      .knob {
        position: absolute;
        width: 14px;
        height: 14px;
        margin: -7px;
        border: 2px solid #fff;
        border-radius: 50%;
        box-shadow: 0 0 0 1px rgb(0 0 0 / 40%), 0 1px 4px rgb(0 0 0 / 40%);
        pointer-events: none;
      }

      .controls {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) 32px;
        gap: 8px;
        align-items: center;
      }
      .sliders {
        display: grid;
        gap: 8px;
      }
      .slider {
        position: relative;
        height: 12px;
        border-radius: 6px;
        cursor: pointer;
        touch-action: none;
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
      }
      .slider.hue {
        background: linear-gradient(to right, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%);
      }
      /* The opacity track: the checkerboard in a box of its own, so the thumb is not clipped by it. */
      .slider > .track {
        position: absolute;
        inset: 0;
        border-radius: 6px;
      }
      .slider > .track > i {
        position: absolute;
        inset: 0;
      }
      .slider .thumb {
        position: absolute;
        top: 50%;
        width: 12px;
        height: 12px;
        margin: -6px;
        border: 2px solid #fff;
        border-radius: 50%;
        box-shadow: 0 0 0 1px rgb(0 0 0 / 40%);
        pointer-events: none;
      }
      .icon-btn {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        color: var(--heo-text-dim);
        cursor: pointer;
      }
      .icon-btn:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .icon-btn:focus-visible,
      .swatch:focus-visible,
      .format button:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .preview {
        height: 32px;
        border-radius: var(--heo-r-sm);
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
      }
      .preview > i {
        position: absolute;
        inset: 0;
      }

      /* The numbers. */
      .line {
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr);
        gap: 6px;
        align-items: center;
      }
      .tag {
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
      }
      .tag.on {
        color: var(--heo-accent);
      }
      .inputs {
        display: grid;
        gap: 4px;
      }
      .inputs.hex {
        grid-template-columns: minmax(0, 1fr) 56px;
      }
      .inputs.oklch {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      label.num {
        display: flex;
        align-items: center;
        min-width: 0;
        height: 26px;
        padding: 0 6px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        gap: 3px;
      }
      label.num:focus-within {
        border-color: var(--heo-accent);
      }
      label.num input {
        all: unset;
        flex: 1;
        min-width: 0;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
        user-select: text;
      }
      label.num span {
        color: var(--heo-text-faint);
        font-size: 9.5px;
      }
      .format {
        display: inline-flex;
        margin-left: auto;
        padding: 2px;
        gap: 2px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .format button {
        padding: 2px 7px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--heo-text-dim);
        font: inherit;
        font-size: 10.5px;
        cursor: pointer;
      }
      .format button[aria-pressed='true'] {
        background: var(--heo-raised);
        color: var(--heo-text);
        font-weight: 600;
        box-shadow: 0 1px 2px rgb(0 0 0 / 15%);
      }
      .head {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .gamut {
        color: var(--heo-warning, #d97706);
        font-size: 10.5px;
      }

      /* Contrast. */
      .contrast {
        display: grid;
        gap: 5px;
        padding: 7px 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .ratio {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ratio b {
        font-family: var(--heo-mono);
        font-size: 14px;
        font-weight: 600;
        color: var(--heo-text);
      }
      .badge {
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 600;
        border: 1px solid currentColor;
      }
      .badge.pass {
        color: var(--heo-success, #16a34a);
      }
      .badge.fail {
        color: var(--heo-danger);
      }
      .ratio .kind {
        margin-left: auto;
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .against {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .against .chip {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
      }
      .against .chip.worst {
        box-shadow: 0 0 0 2px var(--heo-danger);
      }
      .note {
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.35;
      }

      /* Tokens. */
      .swatches {
        display: grid;
        grid-template-columns: repeat(10, minmax(0, 1fr));
        gap: 4px;
        max-height: 92px;
        overflow: auto;
      }
      .swatch {
        aspect-ratio: 1;
        padding: 0;
        border: 0;
        border-radius: 4px;
        cursor: pointer;
        box-shadow: inset 0 0 0 1px var(--heo-line-strong);
      }
      .swatch > i {
        position: absolute;
        inset: 0;
      }
      .swatch[aria-pressed='true'] {
        box-shadow: 0 0 0 2px var(--heo-accent);
      }
    `,
  ];

  /** The colour as written: any CSS colour, a token included. */
  @property({ type: String }) value = '';
  /** What to measure contrast against, or null for no check. */
  @property({ attribute: false }) contrast: ContrastTarget | null = null;
  @property({ attribute: false }) swatches: ColorSwatch[] = [];

  @state() private hsv: Hsva = { h: 0, s: 0, v: 0, a: 1 };
  /** The OKLCH value as typed, kept exactly while it is the one being written. */
  @state() private exact: Oklch | null = null;
  @state() private format: Format = 'hex';
  /** The field being typed in, so redrawing does not overwrite it under the cursor. */
  @state() private typing = '';
  #taken: string | null = null;
  #curveKey = '';
  #curve: { aa: string[]; aaa: string[] } = { aa: [], aaa: [] };

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('value') && this.value !== this.#taken) this.#take(this.value);
    if (changed.has('contrast') && this.contrast?.pending) {
      const pending = this.contrast.pending;
      void pending.then((done) => {
        if (this.contrast?.pending === pending) this.contrast = done;
      });
    }
  }

  /** Adopt a value from outside, in its own format. */
  #take(value: string): void {
    this.#taken = value;
    const exact = parseOklch(value);
    const rgb = exact ? oklchToRgb(exact) : resolveColor(value);
    this.exact = exact;
    this.format = exact ? 'oklch' : 'hex';
    if (rgb) this.hsv = rgbToHsv(rgb, this.hsv.h);
  }

  get #rgb(): Rgba {
    return this.exact ? oklchToRgb(this.exact) : hsvToRgb(this.hsv);
  }

  get #oklch(): Oklch {
    return this.exact ?? rgbToOklch(hsvToRgb(this.hsv));
  }

  /** The colour in the format being written. */
  get #written(): string {
    return this.format === 'oklch' ? toOklchString(this.#oklch) : toHex(this.#rgb);
  }

  override render(): TemplateResult {
    const rgb = this.#rgb;
    const opaque = toHex({ ...rgb, a: 1 });
    const hue = toHex(hsvToRgb({ h: this.hsv.h, s: 1, v: 1, a: 1 }));
    const oklch = this.#oklch;
    const outside = this.exact ? !inGamut(oklchToRgb(this.exact)) : false;
    return html`
      <div
        class="area"
        role="slider"
        tabindex="0"
        aria-label="Saturation and brightness"
        aria-valuetext=${`Saturation ${Math.round(this.hsv.s * 100)}%, brightness ${Math.round(this.hsv.v * 100)}%`}
        style=${`background:linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})`}
        @pointerdown=${this.#dragArea}
        @keydown=${this.#areaKey}
      >
        ${this.#renderCurves()}
        <span class="knob" style=${`left:${this.hsv.s * 100}%;top:${(1 - this.hsv.v) * 100}%;background:${opaque}`}></span>
      </div>

      <div class="controls">
        ${'EyeDropper' in window
        ? html`<button type="button" class="icon-btn" title="Pick a colour from the screen" aria-label="Pick a colour from the screen" @click=${this.#eyedrop}>
            ${icon('droplet', 13)}
          </button>`
        : html`<span></span>`}
        <div class="sliders">
          <div
            class="slider hue"
            role="slider"
            tabindex="0"
            aria-label="Hue"
            aria-valuemin="0"
            aria-valuemax="360"
            aria-valuenow=${Math.round(this.hsv.h)}
            @pointerdown=${(event: PointerEvent) => this.#dragSlider(event, 'h')}
            @keydown=${(event: KeyboardEvent) => this.#sliderKey(event, 'h')}
          ><span class="thumb" style=${`left:${(this.hsv.h / 360) * 100}%;background:${hue}`}></span></div>
          <div
            class="slider"
            role="slider"
            tabindex="0"
            aria-label="Opacity"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow=${Math.round(rgb.a * 100)}
            @pointerdown=${(event: PointerEvent) => this.#dragSlider(event, 'a')}
            @keydown=${(event: KeyboardEvent) => this.#sliderKey(event, 'a')}
          ><span class="track checker"><i style=${`background:linear-gradient(to right, transparent, ${opaque})`}></i></span>
            <span class="thumb" style=${`left:${rgb.a * 100}%;background:${opaque}`}></span></div>
        </div>
        <div class="preview checker" title=${this.#written}><i style=${`background:${toHex(rgb)}`}></i></div>
      </div>

      <div class="head">
        <span>Writes</span>
        ${outside ? html`<span class="gamut" title="Outside sRGB: screens that cannot show it show the nearest colour">● outside sRGB</span>` : nothing}
        <span class="format" role="group" aria-label="Format written">
          ${(['hex', 'oklch'] as Format[]).map((one) => html`<button
            type="button"
            aria-pressed=${String(this.format === one)}
            @click=${() => this.#setFormat(one)}
          >${one.toUpperCase()}</button>`)}
        </span>
      </div>
      <div class="line">
        <span class=${`tag${this.format === 'hex' ? ' on' : ''}`}>HEX</span>
        <div class="inputs hex">
          ${this.#num('hex', toHex({ ...rgb, a: 1 }).slice(1).toUpperCase(), 'Hex', '#')}
          ${this.#num('alpha', String(Math.round(rgb.a * 100)), 'Opacity, percent', '', '%')}
        </div>
      </div>
      <div class="line">
        <span class=${`tag${this.format === 'oklch' ? ' on' : ''}`}>OKLCH</span>
        <div class="inputs oklch">
          ${this.#num('l', trim(oklch.l * 100, 1), 'OKLCH lightness, percent', 'L')}
          ${this.#num('c', trim(oklch.c, 3), 'OKLCH chroma', 'C')}
          ${this.#num('h', trim(oklch.c < 1e-4 ? this.hsv.h : oklch.h, 1), 'OKLCH hue, degrees', 'H')}
        </div>
      </div>

      ${this.#renderContrast()}
      ${this.swatches.length
        ? html`<div class="swatches" role="group" aria-label="Colour tokens">
            ${this.swatches.map((one) => html`<button
              type="button"
              class="swatch checker"
              title=${`${one.label} · ${one.color}`}
              aria-label=${one.label}
              aria-pressed=${String(this.value.trim() === one.value)}
              @click=${() => this.#emit('color-change', one.value)}
            ><i style=${`background:${one.color}`}></i></button>`)}
          </div>`
        : nothing}
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* Contrast                                                               */
  /* ---------------------------------------------------------------------- */

  /** The worst ratio of a colour against the target, and the colour that gives it. */
  #measure(pick: Rgba): { ratio: number; worst: Rgba | null } {
    const target = this.contrast;
    if (!target || !target.others.length) return { ratio: 21, worst: null };
    let ratio = 21;
    let worst: Rgba | null = null;
    if (target.picked === 'foreground') {
      for (const other of target.others) {
        const r = contrastRatio(pick, other);
        if (r < ratio) [ratio, worst] = [r, other];
      }
    } else {
      // A translucent background shows what is under it: every layer of that is a background.
      const unders = target.under.length ? target.under : [{ r: 1, g: 1, b: 1, a: 1 }];
      for (const under of unders) {
        const background = composite(pick, under);
        for (const text of target.others) {
          const r = contrastRatio(text, background);
          if (r < ratio) [ratio, worst] = [r, text];
        }
      }
    }
    return { ratio, worst };
  }

  #renderContrast(): TemplateResult | typeof nothing {
    const target = this.contrast;
    if (!target) return nothing;
    const { ratio, worst } = this.#measure(this.#rgb);
    const levels = contrastLevels(ratio, target.kind);
    const kindLabel = target.kind === 'non-text' ? 'Non-text · 3:1' : target.kind === 'large-text' ? 'Large text' : 'Text';
    const shown = target.others.slice(0, 12);
    return html`<div class="contrast" aria-live="polite">
      <div class="ratio">
        <b>${ratio.toFixed(2)}:1</b>
        <span class=${`badge ${levels.aa ? 'pass' : 'fail'}`}>${levels.aa ? '✓' : '✕'} AA</span>
        ${target.kind === 'non-text' ? nothing : html`<span class=${`badge ${levels.aaa ? 'pass' : 'fail'}`}>${levels.aaa ? '✓' : '✕'} AAA</span>`}
        <span class="kind">${kindLabel}</span>
      </div>
      <div class="against">
        <span>vs ${target.label}${target.pending ? ' · reading image…' : ''}</span>
        ${shown.map((one) => html`<span
          class=${`chip checker${one === worst && target.others.length > 1 ? ' worst' : ''}`}
          title=${toHex(one)}
        ><i style=${`position:absolute;inset:0;background:${toHex(one)}`}></i></span>`)}
        ${target.others.length > shown.length ? html`<span>+${target.others.length - shown.length}</span>` : nothing}
      </div>
      ${target.unread ? html`<span class="note">${target.unread}</span>` : nothing}
      ${!levels.aa && target.others.length > 1 && !this.#curve.aa.length
        ? html`<span class="note">No colour of this hue passes AA against every one of these: the backdrop is too varied.</span>`
        : nothing}
    </div>`;
  }

  /**
   * The AA (solid) and AAA (dashed) lines on the square: where the ratio crosses what is needed.
   * Column by column, the brightness at which it crosses, found by sampling and interpolating; a
   * column can cross twice (darker than every background, or lighter than every one).
   */
  #renderCurves(): TemplateResult | typeof nothing {
    const target = this.contrast;
    if (!target || !target.others.length) return nothing;
    const key = `${this.hsv.h}|${this.hsv.a}|${target.picked}|${target.kind}|${target.others.length}|${target.under.length}|${target.others.map(toHex).join()}`;
    if (key !== this.#curveKey) {
      this.#curveKey = key;
      const levels = contrastLevels(0, target.kind);
      const aaa = target.kind === 'non-text' ? null : target.kind === 'large-text' ? 4.5 : 7;
      this.#curve = { aa: this.#crossings(levels.needed), aaa: aaa ? this.#crossings(aaa) : [] };
    }
    return html`<svg viewBox=${`0 0 ${AREA_W} ${AREA_H}`} preserveAspectRatio="none" aria-hidden="true">
      ${this.#curve.aa.map((points) => svg`<polyline class="curve" points=${points}></polyline>`)}
      ${this.#curve.aaa.map((points) => svg`<polyline class="curve aaa" points=${points}></polyline>`)}
    </svg>`;
  }

  #crossings(needed: number): string[] {
    const columns = 48;
    const rows = 40;
    const branches: Array<Array<[number, number]>> = [[], []];
    for (let x = 0; x <= columns; x++) {
      const s = x / columns;
      let previous = this.#measure(hsvToRgb({ h: this.hsv.h, s, v: 0, a: this.hsv.a })).ratio - needed;
      let found = 0;
      for (let y = 1; y <= rows && found < 2; y++) {
        const v = y / rows;
        const now = this.#measure(hsvToRgb({ h: this.hsv.h, s, v, a: this.hsv.a })).ratio - needed;
        if (Math.sign(now) !== Math.sign(previous)) {
          const t = previous / (previous - now);
          const at = (y - 1 + t) / rows;
          branches[found]!.push([s * AREA_W, (1 - at) * AREA_H]);
          found++;
        }
        previous = now;
      }
    }
    return branches.filter((one) => one.length > 1).map((one) => one.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  }

  /* ---------------------------------------------------------------------- */
  /* Input                                                                  */
  /* ---------------------------------------------------------------------- */

  #num(name: string, value: string, label: string, prefix = '', suffix = ''): TemplateResult {
    return html`<label class="num">
      ${prefix ? html`<span>${prefix}</span>` : nothing}
      <input
        data-input=${name}
        aria-label=${label}
        .value=${this.typing === name ? live(this.renderRoot, name, value) : value}
        spellcheck="false"
        autocomplete="off"
        @focus=${() => { this.typing = name; }}
        @input=${(event: InputEvent) => this.#typed(name, (event.target as HTMLInputElement).value, false)}
        @change=${(event: Event) => this.#typed(name, (event.target as HTMLInputElement).value, true)}
        @blur=${() => { this.typing = ''; }}
        @keydown=${(event: KeyboardEvent) => this.#numKey(event, name)}
      />
      ${suffix ? html`<span>${suffix}</span>` : nothing}
    </label>`;
  }

  #numKey(event: KeyboardEvent, name: string): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dispatchEvent(new CustomEvent('color-close', { bubbles: true, composed: true }));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.#typed(name, input.value, true);
      return;
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && name !== 'hex') {
      event.preventDefault();
      const step = { l: 1, c: 0.005, h: 1, alpha: 1, oalpha: 1 }[name as 'l'] * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      const next = (parseFloat(input.value) || 0) + step;
      input.value = name === 'c' ? trim(Math.max(0, next), 3) : trim(next, 1);
      this.#typed(name, input.value, true);
    }
  }

  /** A field typed into: the colour it says, in that field's format. */
  #typed(name: string, text: string, commit: boolean): void {
    const value = text.trim();
    const oklch = this.#oklch;
    if (name === 'hex') {
      const rgb = resolveColor(value.startsWith('#') ? value : `#${value}`);
      if (!rgb) return;
      this.exact = null;
      this.format = 'hex';
      this.hsv = rgbToHsv({ ...rgb, a: /^#?(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(value) ? rgb.a : this.hsv.a }, this.hsv.h);
    } else if (name === 'alpha' || name === 'oalpha') {
      const n = parseFloat(value);
      if (!Number.isFinite(n)) return;
      const a = Math.max(0, Math.min(1, n / 100));
      if (this.exact) this.exact = { ...this.exact, a };
      this.hsv = { ...this.hsv, a };
    } else {
      const n = parseFloat(value);
      if (!Number.isFinite(n)) return;
      const next: Oklch = {
        ...oklch,
        h: oklch.c < 1e-4 ? this.hsv.h : oklch.h,
        [name]: name === 'l' ? Math.max(0, Math.min(1, n / 100)) : name === 'c' ? Math.max(0, n) : ((n % 360) + 360) % 360,
      };
      this.exact = next;
      this.format = 'oklch';
      this.hsv = rgbToHsv(oklchToRgb(next), name === 'h' ? next.h : this.hsv.h);
    }
    this.#emit(commit ? 'color-change' : 'color-input', this.#written);
  }

  #setFormat(format: Format): void {
    if (format === this.format) return;
    if (format === 'hex') this.exact = null;
    this.format = format;
    this.#emit('color-change', this.#written);
  }

  /** The square: drag for saturation across and brightness up. */
  #dragArea = (event: PointerEvent): void => {
    event.preventDefault();
    const area = event.currentTarget as HTMLElement;
    area.focus({ preventScroll: true });
    const rect = area.getBoundingClientRect();
    const at = (move: PointerEvent): void => {
      const s = clamp01((move.clientX - rect.left) / rect.width);
      const v = clamp01(1 - (move.clientY - rect.top) / rect.height);
      this.#setHsv({ ...this.hsv, s, v }, false);
    };
    at(event);
    this.#track(at, () => this.#emit('color-change', this.#written));
  };

  #dragSlider(event: PointerEvent, which: 'h' | 'a'): void {
    event.preventDefault();
    const slider = event.currentTarget as HTMLElement;
    slider.focus({ preventScroll: true });
    const rect = slider.getBoundingClientRect();
    const at = (move: PointerEvent): void => {
      const t = clamp01((move.clientX - rect.left) / rect.width);
      this.#setHsv(which === 'h' ? { ...this.hsv, h: t * 360 } : { ...this.hsv, a: Math.round(t * 100) / 100 }, false);
    };
    at(event);
    this.#track(at, () => this.#emit('color-change', this.#written));
  }

  #areaKey = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dispatchEvent(new CustomEvent('color-close', { bubbles: true, composed: true }));
      return;
    }
    if (!move) return;
    event.preventDefault();
    this.#setHsv({ ...this.hsv, s: clamp01(this.hsv.s + move[0]), v: clamp01(this.hsv.v + move[1]) }, true);
  };

  #sliderKey(event: KeyboardEvent, which: 'h' | 'a'): void {
    const sign = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dispatchEvent(new CustomEvent('color-close', { bubbles: true, composed: true }));
      return;
    }
    if (!sign) return;
    event.preventDefault();
    const big = event.shiftKey ? 10 : 1;
    if (which === 'h') this.#setHsv({ ...this.hsv, h: (this.hsv.h + sign * big + 360) % 360 }, true);
    else this.#setHsv({ ...this.hsv, a: clamp01(Math.round((this.hsv.a + sign * big * 0.01) * 100) / 100) }, true);
  }

  /** A move on the square or a slider: from here the colour is the square's, so in sRGB. */
  #setHsv(next: Hsva, commit: boolean): void {
    if (this.exact) {
      // Still written as OKLCH, but of the colour the square now shows.
      this.exact = rgbToOklch(hsvToRgb(next));
    }
    this.hsv = next;
    this.#emit(commit ? 'color-change' : 'color-input', this.#written);
  }

  async #eyedrop(): Promise<void> {
    const Dropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!Dropper) return;
    try {
      const { sRGBHex } = await new Dropper().open();
      const rgb = resolveColor(sRGBHex);
      if (!rgb) return;
      this.exact = this.format === 'oklch' ? rgbToOklch({ ...rgb, a: this.hsv.a }) : null;
      this.hsv = rgbToHsv({ ...rgb, a: this.hsv.a }, this.hsv.h);
      this.#emit('color-change', this.#written);
    } catch {
      // Cancelled with Escape: nothing to do.
    }
  }

  #emit(type: 'color-input' | 'color-change', value: string): void {
    this.#taken = value;
    this.dispatchEvent(new CustomEvent(type, { detail: { value }, bubbles: true, composed: true }));
  }

  /**
   * Follow the pointer until it is let go: in the capture phase on the window, through the shield's
   * own listener, which is the only route a real move over the panel takes (the shield stops the
   * editor's own events at the overlay host on their way out).
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
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const trim = (n: number, digits: number): string => String(Number(n.toFixed(digits)));

/** The text in a field being typed in, left as typed rather than reformatted under the cursor. */
function live(root: ParentNode, name: string, fallback: string): string {
  return (root.querySelector(`input[data-input="${name}"]`) as HTMLInputElement | null)?.value ?? fallback;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-color-picker': HeoColorPicker;
  }
}
