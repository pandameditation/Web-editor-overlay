import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { labelFor } from '../../core/dom.js';
import { safeURL } from '../../core/sanitize.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { buildSuggestions, valueKindFor } from '../suggestions.js';
import '../controls/value-field.js';
import '../controls/segmented.js';
import '../controls/section.js';

const FITS = ['fill', 'contain', 'cover', 'none', 'scale-down'] as const;
const POSITIONS: Array<[string, string]> = [
  ['left top', 'Top left'],
  ['center top', 'Top'],
  ['right top', 'Top right'],
  ['left center', 'Left'],
  ['center center', 'Center'],
  ['right center', 'Right'],
  ['left bottom', 'Bottom left'],
  ['center bottom', 'Bottom'],
  ['right bottom', 'Bottom right'],
];

const openSections = new Set<string>(['fit', 'size', 'source']);

/**
 * Media controls for images, video and picture sources.
 *
 * Object fit and position are the two properties that decide whether a
 * replaced element looks right, and both are hard to get correct by typing. Fit
 * is shown as live previews of the actual image; position is a nine-point grid.
 * Between them, framing an image takes two clicks.
 */
@customElement('heo-media-panel')
export class HeoMediaPanel extends HeoElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        padding-bottom: 16px;
      }
      .top {
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .preview {
        display: grid;
        place-items: center;
        height: 128px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background:
          linear-gradient(45deg, var(--heo-sunken) 25%, transparent 25%),
          linear-gradient(-45deg, var(--heo-sunken) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, var(--heo-sunken) 75%),
          linear-gradient(-45deg, transparent 75%, var(--heo-sunken) 75%);
        background-size: 14px 14px;
        background-position:
          0 0,
          0 7px,
          7px -7px,
          -7px 0;
        overflow: hidden;
      }
      .preview img {
        max-width: 100%;
        max-height: 100%;
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 8px;
      }

      .fits {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 5px;
      }
      .fit {
        display: grid;
        gap: 4px;
        padding: 4px;
        border: 1px solid var(--heo-line);
        border-radius: 7px;
        background: var(--heo-sunken);
        color: var(--heo-text-faint);
        cursor: pointer;
        transition:
          border-color var(--heo-fast),
          color var(--heo-fast);
      }
      .fit:hover {
        border-color: var(--heo-line-strong);
        color: var(--heo-text);
      }
      .fit[aria-pressed='true'] {
        border-color: var(--heo-accent);
        color: var(--heo-text);
        box-shadow: 0 0 0 2px var(--heo-accent-soft);
      }
      .fit .box {
        height: 34px;
        border-radius: 4px;
        background: var(--heo-bg);
        overflow: hidden;
      }
      .fit .box img {
        width: 100%;
        height: 100%;
        display: block;
      }
      .fit .n {
        font-size: 8.5px;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pos {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
        width: 92px;
      }
      .pos button {
        aspect-ratio: 1;
        border: 1px solid var(--heo-line);
        border-radius: 5px;
        background: var(--heo-sunken);
        cursor: pointer;
        padding: 0;
        position: relative;
      }
      .pos button::after {
        content: '';
        position: absolute;
        inset: 26%;
        border-radius: 2px;
        background: var(--heo-text-faint);
        opacity: 0.4;
      }
      .pos button:hover {
        border-color: var(--heo-line-strong);
      }
      .pos button[aria-pressed='true'] {
        border-color: var(--heo-accent);
        background: var(--heo-accent-soft);
      }
      .pos button[aria-pressed='true']::after {
        background: var(--heo-accent);
        opacity: 1;
      }
      .posrow {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }
      .posrow .side {
        flex: 1 1 auto;
        display: grid;
        gap: 6px;
      }

      .rows {
        display: grid;
        gap: 6px;
      }
      .row {
        display: grid;
        grid-template-columns: 96px 1fr;
        align-items: center;
        gap: 6px;
      }
      .row .name {
        overflow: hidden;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.revision, s.geometry] as const,
    shallowArrayEquals,
  );

  @state() private version = 0;

  override render(): TemplateResult {
    const el = this.editor.selected;
    if (!el || !el.isConnected) {
      return html`<div class="empty">Select an image, video or figure to edit its framing.</div>`;
    }
    const tag = el.tagName.toLowerCase();
    const isMedia = tag === 'img' || tag === 'video' || tag === 'picture' || tag === 'source';
    const computed = getComputedStyle(el);

    if (!isMedia) {
      return html`
        <div class="empty">
          <p style="margin:0 0 10px">
            ${labelFor(el)} is not a media element, so there is nothing to frame here.
          </p>
          <p class="hint" style="margin:0">
            Background images are edited in the Styles panel under Background &amp; border.
          </p>
        </div>
      `;
    }

    return html`
      ${this.#renderPreview(el)}
      ${this.#renderFit(el, computed)}
      ${this.#renderPosition(el, computed)}
      ${this.#renderSize(el, computed)}
      ${this.#renderSource(el)}
      ${this.#renderRendering(el, computed)}
    `;
  }

  #renderPreview(el: HTMLElement): TemplateResult {
    const src = el instanceof HTMLImageElement ? el.currentSrc || el.src : '';
    const natural =
      el instanceof HTMLImageElement && el.naturalWidth
        ? `${el.naturalWidth}×${el.naturalHeight}`
        : null;
    const box = el.getBoundingClientRect();
    const ratio = natural && el instanceof HTMLImageElement
      ? (el.naturalWidth / el.naturalHeight).toFixed(2)
      : null;

    return html`<div class="top">
      <div class="preview">
        ${src
          ? html`<img src=${src} alt="" />`
          : html`<span class="hint">No source to preview</span>`}
      </div>
      <div class="facts">
        <span class="chip">${icon('image', 11)} ${labelFor(el)}</span>
        <span class="chip">rendered ${Math.round(box.width)}×${Math.round(box.height)}</span>
        ${natural ? html`<span class="chip">intrinsic ${natural}</span>` : nothing}
        ${ratio ? html`<span class="chip">ratio ${ratio}</span>` : nothing}
      </div>
    </div>`;
  }

  /**
   * Fit previews render the real image at each value.
   *
   * The difference between `cover` and `contain` is only obvious on the actual
   * asset, so showing five live thumbnails answers the question faster than any
   * label can.
   */
  #renderFit(el: HTMLElement, computed: CSSStyleDeclaration): TemplateResult {
    const current = el.style.objectFit || computed.objectFit;
    const src = el instanceof HTMLImageElement ? el.currentSrc || el.src : '';

    return html`<heo-section
      heading="Object fit"
      glyph="image"
      badge=${current}
      ?open=${openSections.has('fit')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('fit', event.detail.open)}
    >
      <div class="fits">
        ${FITS.map(
          (fit) => html`<button
            class="fit"
            type="button"
            aria-pressed=${current === fit}
            title=${`object-fit: ${fit}`}
            @click=${() => this.editor.setStyle('object-fit', fit, el)}
          >
            <span class="box">
              ${src ? html`<img src=${src} alt="" style=${`object-fit:${fit}`} />` : nothing}
            </span>
            <span class="n">${fit}</span>
          </button>`,
        )}
      </div>
    </heo-section>`;
  }

  #renderPosition(el: HTMLElement, computed: CSSStyleDeclaration): TemplateResult {
    const current = normalizePosition(el.style.objectPosition || computed.objectPosition);

    return html`<heo-section
      heading="Object position"
      glyph="center"
      badge=${current}
      ?open=${openSections.has('position')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('position', event.detail.open)}
    >
      <div class="posrow">
        <div class="pos" role="group" aria-label="Object position">
          ${POSITIONS.map(
            ([value, label]) => html`<button
              type="button"
              aria-pressed=${current === value}
              aria-label=${label}
              title=${label}
              @click=${() => this.editor.setStyle('object-position', value, el)}
            ></button>`,
          )}
        </div>
        <div class="side">
          <span class="label">Custom</span>
          <heo-value-field
            .value=${el.style.objectPosition}
            .suggestions=${buildSuggestions(this.editor, 'object-position', el)}
            placeholder=${computed.objectPosition}
            clearable
            @value-change=${(event: CustomEvent<{ value: string }>) =>
              this.editor.setStyle('object-position', event.detail.value, el)}
          ></heo-value-field>
          <p class="hint" style="margin:0">
            Position only has an effect when the fit crops or letterboxes the image.
          </p>
        </div>
      </div>
    </heo-section>`;
  }

  #renderSize(el: HTMLElement, computed: CSSStyleDeclaration): TemplateResult {
    const properties = ['width', 'height', 'aspect-ratio', 'max-width', 'max-height', 'border-radius'];
    return html`<heo-section
      heading="Size & shape"
      glyph="wrap"
      ?open=${openSections.has('size')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('size', event.detail.open)}
    >
      <div class="rows">
        ${properties.map((property) => this.#renderStyleRow(el, computed, property))}
      </div>
      <div class="row" style="margin-top:8px">
        <span class="name">presets</span>
        <heo-segmented
          .options=${[
            { value: '1 / 1', label: '1:1' },
            { value: '4 / 3', label: '4:3' },
            { value: '16 / 9', label: '16:9' },
            { value: '3 / 4', label: '3:4' },
            { value: '', label: 'auto' },
          ]}
          .value=${el.style.aspectRatio}
          label="Aspect ratio presets"
          @segment-change=${(event: CustomEvent<{ value: string }>) =>
            this.editor.setStyle('aspect-ratio', event.detail.value, el)}
        ></heo-segmented>
      </div>
    </heo-section>`;
  }

  #renderSource(el: HTMLElement): TemplateResult {
    const src = el.getAttribute('src') ?? '';
    const alt = el.getAttribute('alt');
    const tag = el.tagName.toLowerCase();

    return html`<heo-section
      heading="Source & text"
      glyph="link"
      ?open=${openSections.has('source')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('source', event.detail.open)}
    >
      <div class="rows">
        <div class="row">
          <span class="name">src</span>
          <heo-value-field
            .value=${src}
            .suggestions=${[]}
            placeholder="https://…"
            @value-change=${(event: CustomEvent<{ value: string }>) => this.#setSrc(el, event.detail.value)}
          ></heo-value-field>
        </div>
        ${tag === 'img'
          ? html`<div class="row">
                <span class="name">alt</span>
                <heo-value-field
                  .value=${alt ?? ''}
                  .suggestions=${[]}
                  placeholder=${alt === null ? 'describe the image' : 'decorative (empty)'}
                  @value-change=${(event: CustomEvent<{ value: string }>) =>
                    this.editor.setAttribute('alt', event.detail.value, el)}
                ></heo-value-field>
              </div>
              <div class="row">
                <span class="name">srcset</span>
                <heo-value-field
                  .value=${el.getAttribute('srcset') ?? ''}
                  .suggestions=${[]}
                  placeholder="image-2x.png 2x"
                  clearable
                  @value-change=${(event: CustomEvent<{ value: string }>) =>
                    this.editor.setAttribute('srcset', event.detail.value || null, el)}
                ></heo-value-field>
              </div>
              <div class="row">
                <span class="name">loading</span>
                <heo-segmented
                  .options=${[
                    { value: 'lazy', label: 'lazy' },
                    { value: 'eager', label: 'eager' },
                  ]}
                  .value=${el.getAttribute('loading') ?? ''}
                  clearable
                  label="Loading"
                  @segment-change=${(event: CustomEvent<{ value: string }>) =>
                    this.editor.setAttribute('loading', event.detail.value || null, el)}
                ></heo-segmented>
              </div>`
          : nothing}
      </div>
      ${alt === null && tag === 'img'
        ? html`<p class="hint" style="margin:9px 0 0;color:var(--heo-warn)">
            ${icon('eye', 11)} This image has no alt attribute.
          </p>`
        : nothing}
    </heo-section>`;
  }

  #renderRendering(el: HTMLElement, computed: CSSStyleDeclaration): TemplateResult {
    return html`<heo-section
      heading="Rendering"
      glyph="sparkle"
      ?open=${openSections.has('rendering')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('rendering', event.detail.open)}
    >
      <div class="rows">
        ${['image-rendering', 'filter', 'opacity', 'mix-blend-mode', 'box-shadow'].map((property) =>
          this.#renderStyleRow(el, computed, property),
        )}
      </div>
    </heo-section>`;
  }

  #renderStyleRow(
    el: HTMLElement,
    computed: CSSStyleDeclaration,
    property: string,
  ): TemplateResult {
    return html`<div class="row">
      <span class="name" title=${property}>${property}</span>
      <heo-value-field
        .value=${this.editor.inlineStyle(property, el)}
        .kind=${valueKindFor(property)}
        .property=${property}
        .suggestions=${buildSuggestions(this.editor, property, el)}
        placeholder=${computed.getPropertyValue(property).slice(0, 24)}
        clearable
        @value-change=${(event: CustomEvent<{ value: string }>) =>
          this.editor.setStyle(property, event.detail.value, el)}
      ></heo-value-field>
    </div>`;
  }

  #setSrc(el: HTMLElement, value: string): void {
    const safe = safeURL(value, true);
    if (value && !safe) {
      this.editor.notify('That URL was rejected as unsafe.', 'error');
      return;
    }
    this.editor.setAttribute('src', safe || null, el);
  }

  #remember(id: string, open: boolean): void {
    if (open) openSections.add(id);
    else openSections.delete(id);
    this.version += 1;
  }
}

/** Collapse computed pixel positions back onto the nine named presets. */
function normalizePosition(value: string): string {
  const text = value.trim().toLowerCase();
  const map: Record<string, string> = {
    '0% 0%': 'left top',
    '50% 0%': 'center top',
    '100% 0%': 'right top',
    '0% 50%': 'left center',
    '50% 50%': 'center center',
    '100% 50%': 'right center',
    '0% 100%': 'left bottom',
    '50% 100%': 'center bottom',
    '100% 100%': 'right bottom',
  };
  return map[text] ?? text;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-media-panel': HeoMediaPanel;
  }
}
