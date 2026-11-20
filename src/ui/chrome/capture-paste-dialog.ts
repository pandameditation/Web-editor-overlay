import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { blockPreviewDocument } from '../../core/block-preview.js';
import { acceptsChildren, isMutable, labelFor } from '../../core/dom.js';
import type { CapturePaste, InsertAnchor } from '../../core/editor.js';
import { ModalController } from '../../core/modal.js';
import { INSERT_POSITION_LABELS, type InsertPosition } from '../../core/mutations.js';
import { sanitizeFragment } from '../../core/sanitize.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { LibraryBlock } from '../../core/types.js';
import { fieldLabel } from '../form-errors.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import '../controls/segmented.js';

/**
 * Embedded fonts and images in a block, counted from the block itself.
 *
 * Read off the markup and CSS that will be inserted rather than off the capture metadata, so
 * the licensing note can never disagree with what actually lands in the page.
 */
export function embeddedAssetCounts(block: Pick<LibraryBlock, 'html' | 'css'>): { fonts: number; images: number } {
  const text = `${block.html ?? ''}\n${block.css ?? ''}`;
  // Distinct URLs: one image in a src and again in a srcset is still one image.
  const urls = new Set(text.match(/data:[^"'()\s]+/gi) ?? []);
  let fonts = 0;
  let images = 0;
  for (const url of urls) {
    if (/^data:(?:font\/|application\/(?:x-)?font)/i.test(url)) fonts += 1;
    else if (/^data:image\//i.test(url)) images += 1;
  }
  return { fonts, images };
}

/** The block's markup as it will be inserted: sanitised, so refused URLs are already gone. */
function sanitisedMarkup(block: LibraryBlock): string {
  const holder = document.createElement('div');
  holder.append(sanitizeFragment(block.html));
  return holder.innerHTML;
}


function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** The preview renders at the chosen page width and is scaled to the box, measured once drawn. */
const PREVIEW_WIDTH = 722;
/** Tallest the preview frame is drawn (before scaling); taller blocks scroll inside it. */
const PREVIEW_MAX_HEIGHT = 560;
const PREVIEW_MIN_HEIGHT = 160;
/** Widths offered besides the capture's own. */
const PREVIEW_WIDTHS = [1280, 768, 390];

/**
 * Pasting a block captured from another site.
 *
 * The clipboard holds one block from the capture extension, and there are two reasonable
 * things to do with it: put it in this page, or keep it in the library for later. Both are
 * offered, ticked independently, because choosing one should not cost the other.
 *
 * It shows the block before anything happens (a sandboxed preview, the source it came from),
 * says what CSS was removed on the way in, and, when the block carries embedded fonts or
 * images, says plainly that those belong to somebody and need checking before publishing.
 */
@customElement('heo-capture-paste-dialog')
export class HeoCapturePasteDialog extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 30;
        display: grid;
        place-items: center;
        padding: 24px;
        background: oklch(12% 0.01 265 / 55%);
        backdrop-filter: blur(3px);
        pointer-events: auto;
      }

      .dialog {
        display: flex;
        flex-direction: column;
        width: min(760px, 100%);
        max-height: min(90vh, 760px);
        border-radius: var(--heo-r-lg);
        overflow: hidden;
      }

      header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--heo-line);
      }
      header .body {
        flex: 1 1 auto;
        min-width: 0;
      }
      h2 {
        margin: 0 0 4px;
        font-size: 14px;
        font-weight: 600;
      }
      header p {
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }

      .content {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1 1 auto;
        min-height: 0;
        padding: 14px 18px;
        overflow: auto;
      }

      /* The preview frame is drawn at the capture width and scaled to fit. */
      .preview {
        position: relative;
        flex: 0 0 auto;
        overflow: hidden;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: #f1f1f3;
      }
      .preview iframe {
        position: absolute;
        top: 0;
        left: 0;
        border: 0;
        transform-origin: 0 0;
        background: #f1f1f3;
      }
      .field.name {
        display: grid;
        gap: 4px;
      }
      .field.name .id {
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .field.name code {
        font-family: var(--heo-mono);
        color: var(--heo-text-dim);
      }
      .variant {
        display: grid;
        gap: 6px;
      }
      .variant .hint {
        margin: 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .preview-bar {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .preview-bar .hint {
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }

      .choices {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 18px;
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: var(--heo-text);
      }

      .where {
        display: grid;
        gap: 6px;
      }
      .where .target {
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .where .target b {
        color: var(--heo-text-dim);
        font-weight: 550;
      }

      .note {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        padding: 9px 11px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .note .g {
        flex: 0 0 auto;
        margin-top: 1px;
        color: var(--heo-text-faint);
      }
      .note.warn {
        border-color: var(--heo-warn);
      }
      .note.warn .g {
        color: var(--heo-warn);
      }
      .note ul {
        margin: 4px 0 0;
        padding-left: 16px;
      }
      .note code {
        font-family: var(--heo-mono);
        color: var(--heo-text);
        overflow-wrap: anywhere;
      }

      footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        padding: 12px 18px;
        border-top: 1px solid var(--heo-line);
      }
      footer .fine {
        flex: 1 1 220px;
        max-width: 420px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      footer .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .err {
        color: var(--heo-danger);
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.capturePaste] as const,
    shallowArrayEquals,
  );

  protected modal = new ModalController(this, { initialFocus: 'button.primary' });

  /** The markup and preview last built, keyed by content, so renaming or a toggle does not reload the frame. */
  #previewKey = '';
  #markup = '';
  #preview = '';
  /** The page width the preview renders at; null is the capture's own width. */
  #width: number | null = null;
  /** The preview document's height at that width, measured once it has loaded. */
  #contentHeight = 0;
  /** The preview box's inner width in the dialog. */
  #available = PREVIEW_WIDTH;

  #resize: ResizeObserver | null = null;
  #observed: Element | null = null;

  protected override updated(): void {
    const box = this.renderRoot.querySelector<HTMLElement>('.preview');
    if (box && box !== this.#observed && typeof ResizeObserver !== 'undefined') {
      // The dialog narrows with the window; the preview's scale has to follow it.
      this.#resize ??= new ResizeObserver(() => this.#fit());
      if (this.#observed) this.#resize.unobserve(this.#observed);
      this.#resize.observe(box);
      this.#observed = box;
    }
    this.#fit();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#resize?.disconnect();
    this.#resize = null;
    this.#observed = null;
  }

  #fit(): void {
    const available = this.renderRoot.querySelector<HTMLElement>('.preview')?.clientWidth ?? 0;
    if (available > 0 && Math.abs(available - this.#available) > 1) {
      this.#available = available;
      this.requestUpdate();
    }
  }

  override render(): TemplateResult | typeof nothing {
    const open = this.state.value.capturePaste;
    if (!open) return nothing;
    const { block } = open;
    const key = `${block.html}\u0000${block.css ?? ''}`;
    if (this.#previewKey !== key) {
      this.#previewKey = key;
      this.#markup = sanitisedMarkup(block);
      this.#preview = blockPreviewDocument(block, this.#markup);
      this.#contentHeight = 0;
    }
    const capture = block.capture;
    const native = Math.max(320, Math.round(capture?.viewport || 1200));
    const width = this.#width ?? native;
    const scale = Math.min(1, this.#available / width);
    const frameHeight = Math.min(PREVIEW_MAX_HEIGHT, Math.max(PREVIEW_MIN_HEIGHT, this.#contentHeight || PREVIEW_MAX_HEIGHT));
    const widths = [native, ...PREVIEW_WIDTHS.filter((value) => Math.abs(value - native) > 40)];
    const verb = open.insert && open.save ? 'Insert and save' : open.save ? 'Save to Blocks' : 'Insert';

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-label="Import block"
      @pointerdown=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: KeyboardEvent) => {
        // The page keymap and the engine's capture handlers must not act behind the dialog.
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.editor.cancelCapturePaste();
      }}
    >
      <header>
        <div class="body">
          <h2>Import block</h2>
          <p class="source">
            ${capture
        ? html`Captured from <a href=${capture.url} target="_blank" rel="noopener noreferrer">${capture.url}</a>
                at ${Math.round(capture.viewport)} px wide.`
        : 'A single block from a seed.'}
          </p>
        </div>
        <button
          class="btn icon ghost"
          type="button"
          aria-label="Close"
          @click=${() => this.editor.cancelCapturePaste()}
        >
          ${icon('close', 14)}
        </button>
      </header>

      <div class="content">
        <div class="field name">
          ${fieldLabel('Name', { required: true })}
          <input
            class="input"
            type="text"
            name="block-name"
            aria-label="Block name"
            spellcheck="false"
            .value=${block.name}
            @input=${(event: Event) => this.editor.renameCapturePaste((event.target as HTMLInputElement).value)}
            @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void this.editor.commitCapturePaste();
      }}
          />
          <span class="id">Saved as <code>${block.id}</code></span>
        </div>

        ${this.#renderVariant(open)}

        <div class="preview-bar">
          <heo-segmented
            label="Preview width"
            .options=${widths.map((value, index) => ({
        value: String(value),
        label: `${value}`,
        title: index === 0 && capture ? `Preview at ${value} px, the width it was captured at` : `Preview at ${value} px wide`,
      }))}
            .value=${String(width)}
            @segment-change=${(event: CustomEvent<{ value: string }>) => {
        const next = Number(event.detail.value) || native;
        this.#width = next === native ? null : next;
        this.#contentHeight = 0;
        this.requestUpdate();
      }}
          ></heo-segmented>
          <span class="hint">${width === native && capture ? 'px, as captured' : 'px'}</span>
        </div>
        <div class="preview" style=${`height: ${Math.round(frameHeight * scale)}px`}>
          <iframe
            title="Preview of the block on a neutral background"
            sandbox="allow-same-origin"
            .srcdoc=${this.#preview}
            style=${`width: ${width}px; height: ${frameHeight}px; transform: scale(${scale})`}
            @load=${(event: Event) => this.#measure(event.target as HTMLIFrameElement)}
          ></iframe>
        </div>

        <div class="choices">
          <label class="check">
            <input
              type="checkbox"
              name="insert"
              .checked=${open.insert}
              @change=${(event: Event) =>
        this.editor.updateCapturePaste({ insert: (event.target as HTMLInputElement).checked, error: '' })}
            />
            Insert into page
          </label>
          <label class="check">
            <input
              type="checkbox"
              name="save"
              .checked=${open.save}
              @change=${(event: Event) =>
        this.editor.updateCapturePaste({ save: (event.target as HTMLInputElement).checked, error: '' })}
            />
            Save to Blocks
          </label>
        </div>

        ${open.insert ? this.#renderWhere(open.anchor) : nothing}
        ${this.#renderRemoved(open.removed)}
        ${this.#renderLicence(block)}
      </div>

      <footer>
        <span class=${`fine${open.error ? ' err' : ''}`} role=${open.error ? 'alert' : nothing}>
          ${open.error || 'The block keeps its own styles, scoped so they cannot leak into the page.'}
        </span>
        <div class="actions">
          <button class="btn" type="button" @click=${() => this.editor.cancelCapturePaste()}>
            Cancel
          </button>
          <button class="btn primary" type="button" @click=${() => void this.editor.commitCapturePaste()}>
            ${icon('plus', 12)} ${verb}
          </button>
        </div>
      </footer>
    </div>`;
  }

  /**
   * Size the frame to the block. Scripts never run in it (no `allow-scripts`); `allow-same-origin`
   * is only there so its height can be read.
   */
  #measure(frame: HTMLIFrameElement): void {
    const doc = frame.contentDocument;
    if (!doc?.body) return;
    // The canvas is at least a viewport tall; the block is what sets the useful height.
    const blocks = Array.from(doc.body.children);
    const bottom = blocks.reduce((max, element) => Math.max(max, element.getBoundingClientRect().bottom), 0);
    const height = Math.ceil(bottom + 24);
    if (Math.abs(height - this.#contentHeight) < 2) return;
    this.#contentHeight = height;
    this.requestUpdate();
  }

  /**
   * Full or lean: the copy as captured, or with what changes nothing taken out. Lean is the default;
   * the preview shows whichever is picked, so switching is how the two are compared.
   */
  #renderVariant(open: NonNullable<CapturePaste>): TemplateResult | typeof nothing {
    const variants = open.variants;
    if (!variants) return nothing;
    const { report } = variants;
    const kb = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`);
    const parts = [
      [report.removedRules + report.removedStateRules, 'rule', 'rules'],
      [report.removedVariables, 'variable', 'variables'],
      [report.removedKeyframes + report.removedFonts, 'unused keyframe or font', 'unused keyframes and fonts'],
      [report.removedWrappers, 'wrapper element', 'wrapper elements'],
      [report.removedAttributes + report.removedClasses, 'attribute or class', 'attributes and classes'],
    ].filter(([count]) => (count as number) > 0)
      .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
    const saved = Math.round((1 - report.leanBytes / Math.max(1, report.fullBytes)) * 100);
    return html`<div class="variant">
      <heo-segmented
        label="Version"
        .options=${[
        { value: 'lean', label: `Lean · ${kb(report.leanBytes)}`, title: 'Only what changes how the block looks and behaves' },
        { value: 'full', label: `Full · ${kb(report.fullBytes)}`, title: 'Everything the capture brought, as it was' },
      ]}
        .value=${open.variant ?? 'lean'}
        @segment-change=${(event: CustomEvent<{ value: string }>) =>
        this.editor.chooseCaptureVariant(event.detail.value === 'full' ? 'full' : 'lean')}
      ></heo-segmented>
      <p class="hint">
        ${open.variant === 'full'
        ? html`Everything the capture brought. Lean is ${saved}% smaller and looks the same.`
        : html`${saved}% smaller: ${parts.join(', ') || 'nothing'} taken out. Each cleanup was
            checked against the full version at the capture width and at phone width, and put back
            if anything looked different.${report.reverted.length
            ? html` Kept as captured: ${report.reverted.join(', ')}.`
            : nothing}`}
      </p>
    </div>`;
  }

  /** The position switch, gated as the insert menu and the HTML paste dialog gate it. */
  #renderWhere(anchor: InsertAnchor): TemplateResult {
    const reference = anchor.reference;
    const options = [
      { value: 'before', label: 'Before', title: `Insert before ${labelFor(reference)}` },
      { value: 'after', label: 'After', title: `Insert after ${labelFor(reference)}` },
      ...(acceptsChildren(reference)
        ? [{ value: 'lastChild', label: 'Inside', title: `Insert inside ${labelFor(reference)}` }]
        : []),
      ...(isMutable(reference)
        ? [{ value: 'replace', label: 'Replace', title: `Replace ${labelFor(reference)}` }]
        : []),
    ];

    return html`<div class="where">
      <heo-segmented
        label="Where it goes"
        .options=${options}
        .value=${anchor.position}
        @segment-change=${(event: CustomEvent<{ value: string }>) =>
        this.editor.updateCapturePaste({
          anchor: { reference, position: (event.detail.value || 'after') as InsertPosition },
        })}
      ></heo-segmented>
      <span class="target">
        ${anchor.position === 'replace'
        ? html`Replaces <b>${labelFor(reference)}</b> and everything inside it`
        : html`${INSERT_POSITION_LABELS[anchor.position]} <b>${labelFor(reference)}</b>`}
      </span>
    </div>`;
  }

  /** What vetting took out. Drawn only when something was. */
  #renderRemoved(removed: string[]): TemplateResult | typeof nothing {
    if (!removed.length) return nothing;
    return html`<div class="note warn removed">
      <span class="g">${icon('alert', 12)}</span>
      <span>
        Removed ${removed.length} unsafe CSS value${removed.length === 1 ? '' : 's'} on the way in:
        <ul>
          ${removed.slice(0, 6).map((entry) => html`<li><code>${entry}</code></li>`)}
          ${removed.length > 6 ? html`<li>and ${removed.length - 6} more</li>` : nothing}
        </ul>
      </span>
    </div>`;
  }

  /**
   * The licensing note, for a captured block that embeds fonts or images.
   *
   * Shown at paste time rather than at copy time: copying for reference is fine, and it is
   * putting the assets into a page that may be published where the question matters.
   */
  #renderLicence(block: LibraryBlock): TemplateResult | typeof nothing {
    if (!block.capture) return nothing;
    // Counted on the sanitised markup, so a refused URL is not counted as an embedded asset.
    const { fonts, images } = embeddedAssetCounts({ html: this.#markup, css: block.css });
    if (!fonts && !images) return nothing;
    const parts = [
      fonts && `${fonts} font${fonts === 1 ? '' : 's'}`,
      images && `${images} image${images === 1 ? '' : 's'}`,
    ].filter(Boolean);
    return html`<div class="note licence">
      <span class="g">${icon('alert', 12)}</span>
      <span>
        This block embeds ${parts.join(' and ')} copied from ${hostOf(block.capture.url)}. Fonts and
        images are usually licensed by their owners; check you may use them before publishing.
      </span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-capture-paste-dialog': HeoCapturePasteDialog;
  }
}
