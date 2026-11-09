import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { splitTopLevel } from '../../core/block-css.js';
import { acceptsChildren, isMutable, labelFor } from '../../core/dom.js';
import type { InsertAnchor } from '../../core/editor.js';
import { ModalController } from '../../core/modal.js';
import { INSERT_POSITION_LABELS, type InsertPosition } from '../../core/mutations.js';
import { sanitizeFragment } from '../../core/sanitize.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { LibraryBlock } from '../../core/types.js';
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

/** The preview document: the capture's own CSS, unscoped, around its sanitised markup. */
function previewDocument(block: LibraryBlock, markup: string): string {
  const split = splitTopLevel(block.css ?? '');
  // Declarations written without a selector are defaults for the block's top-level elements.
  const bare = split.declarations.trim() ? `body > * { ${split.declarations} }\n` : '';
  // A closing style tag inside the CSS would end the element early and spill the rest as markup.
  const sheet = `${bare}${split.rules}`.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><meta charset="utf-8"><style>body { margin: 0; }</style><style>${sheet}</style>${markup}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/** The preview renders at the capture width and is scaled down to the dialog. */
const PREVIEW_WIDTH = 680;
const PREVIEW_HEIGHT = 520;

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
        overflow: hidden;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: white;
      }
      .preview iframe {
        position: absolute;
        top: 0;
        left: 0;
        border: 0;
        transform-origin: 0 0;
        background: white;
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

  /** The markup and preview last built, so a checkbox toggle does not reload the frame. */
  #previewFor: LibraryBlock | null = null;
  #markup = '';
  #preview = '';

  override render(): TemplateResult | typeof nothing {
    const open = this.state.value.capturePaste;
    if (!open) return nothing;
    const { block } = open;
    if (this.#previewFor !== block) {
      this.#previewFor = block;
      this.#markup = sanitisedMarkup(block);
      this.#preview = previewDocument(block, this.#markup);
    }
    const capture = block.capture;
    const width = Math.max(320, Math.round(capture?.viewport || 1200));
    const scale = Math.min(1, PREVIEW_WIDTH / width);
    const verb = open.insert && open.save ? 'Insert and save' : open.save ? 'Save to library' : 'Insert';

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-label="Paste captured block"
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
          <h2>Paste ${block.name}</h2>
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
        <div class="preview" style=${`height: ${Math.round(PREVIEW_HEIGHT * scale)}px`}>
          <iframe
            title="Preview of the captured block"
            sandbox=""
            .srcdoc=${this.#preview}
            style=${`width: ${width}px; height: ${PREVIEW_HEIGHT}px; transform: scale(${scale})`}
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
            Save to library
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
