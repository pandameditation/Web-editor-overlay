import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { acceptsChildren, isMutable, labelFor } from '../../core/dom.js';
import type { InsertAnchor } from '../../core/editor.js';
import { ModalController } from '../../core/modal.js';
import { INSERT_POSITION_LABELS, type InsertPosition } from '../../core/mutations.js';
import { nothingRemoved, previewMarkup } from '../../core/sanitize.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import '../controls/code-editor.js';
import '../controls/segmented.js';

/**
 * Putting a blob of HTML into the page.
 *
 * The library offers assembled patterns and the catalogue offers bare tags. Between them sits
 * the thing people actually have most often: markup from somewhere else — a snippet from a
 * component library's docs, a chunk copied from another page, an embed a service handed over.
 * There was no route for it, and the answer was to build it out of primitives by hand.
 *
 * Two decisions shape this.
 *
 * **It says what will happen before it happens.** The markup is parsed and sanitised on every
 * keystroke, and the line under the field reports how many elements will land, where, and what
 * was taken out. Sanitisation is not optional — the editor will not put runnable code into
 * someone's page — but it being silent was never the point of it, and a stripped `onclick` is
 * a button that does nothing for a reason the user cannot see.
 *
 * **Where it goes is changeable here.** The plus button that opened this was a guess at intent
 * from which edge was clicked. Reopening the menu from the other side to change your mind is
 * busywork, so the switch is in the dialog, gated the same way the insert menu gates it:
 * "inside" only for elements that can hold children, "replace" only for ones that can go.
 */
@customElement('heo-paste-dialog')
export class HeoPasteDialog extends HeoElement {
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
        max-height: min(86vh, 700px);
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
      .content heo-code-editor {
        flex: 1 1 auto;
        min-height: 0;
      }

      /* Where it lands, and what that reads as in words. */
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
      .note code {
        font-family: var(--heo-mono);
        color: var(--heo-text);
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
    (s) => [s.htmlPaste] as const,
    shallowArrayEquals,
  );

  protected modal = new ModalController(this, { initialFocus: 'heo-code-editor' });

  override render(): TemplateResult | typeof nothing {
    const open = this.state.value.htmlPaste;
    if (!open) return nothing;

    const preview = previewMarkup(open.draft);
    const written = open.draft.trim().length > 0;

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-label="Insert HTML"
      @pointerdown=${(event: Event) => event.stopPropagation()}
    >
      <header>
        <div class="body">
          <h2>Insert HTML</h2>
          <p>
            Paste or write any markup. It goes into the page as elements you can then select,
            style and move like anything else — and it is one change, so undo takes all of it
            back out.
          </p>
        </div>
        <button
          class="btn icon ghost"
          type="button"
          aria-label="Close"
          @click=${() => this.editor.cancelHtmlPaste()}
        >
          ${icon('close', 14)}
        </button>
      </header>

      <div class="content">
        ${this.#renderWhere(open.anchor)}
        <heo-code-editor
          fill
          language="html"
          rows="14"
          heading="Markup to insert"
          placeholder=${'<section class="card">\n  <h2>Title</h2>\n</section>'}
          .value=${open.draft}
          .error=${open.error}
          @code-input=${(event: CustomEvent<{ value: string }>) =>
        this.editor.updateHtmlPaste({ draft: event.detail.value, error: '' })}
          @code-submit=${() => this.editor.commitHtmlPaste()}
          @code-cancel=${() => this.editor.cancelHtmlPaste()}
        ></heo-code-editor>
        ${written ? this.#renderPreview(preview) : nothing}
      </div>

      <footer>
        <span class=${`fine${open.error ? ' err' : ''}`}>
          ${open.error
        ? open.error
        : written
          ? this.#summary(preview, open.anchor)
          : 'Scripts and event handlers are removed — the page will not run code the editor put into it.'}
        </span>
        <div class="actions">
          <button class="btn" type="button" @click=${() => this.editor.cancelHtmlPaste()}>
            Cancel
          </button>
          <button
            class="btn primary"
            type="button"
            ?disabled=${!written || preview.elements === 0}
            title=${preview.elements === 0
        ? 'Markup has to start with a tag'
        : `Insert ${INSERT_POSITION_LABELS[open.anchor.position]} ${labelFor(open.anchor.reference)}`}
            @click=${() => this.editor.commitHtmlPaste()}
          >
            ${icon('plus', 12)} Insert
          </button>
        </div>
      </footer>
    </div>`;
  }

  /**
   * The position switch.
   *
   * Gated exactly as the insert menu gates it: "inside" only where children are accepted, and
   * "replace" only where the element can actually go. Offering either where it cannot work is
   * an error message waiting to be shown.
   */
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
        this.editor.updateHtmlPaste({
          anchor: {
            reference,
            position: (event.detail.value || 'after') as InsertPosition,
          },
        })}
      ></heo-segmented>
      <span class="target">
        ${anchor.position === 'replace'
        ? html`Replaces <b>${labelFor(reference)}</b> and everything inside it`
        : html`${INSERT_POSITION_LABELS[anchor.position]} <b>${labelFor(reference)}</b>`}
      </span>
    </div>`;
  }

  /**
   * What sanitisation took out, and what will be dropped for other reasons.
   *
   * Only drawn when there is something to say. A note that appears on every paste to report
   * that nothing happened is a note people learn to stop reading.
   */
  #renderPreview(preview: ReturnType<typeof previewMarkup>): TemplateResult | typeof nothing {
    const { report } = preview;
    const removed = [
      report.scripts && `${report.scripts} <script> block${report.scripts === 1 ? '' : 's'}`,
      report.handlers &&
      `${report.handlers} event handler${report.handlers === 1 ? '' : 's'} (onclick and the like)`,
      report.urls && `${report.urls} link${report.urls === 1 ? '' : 's'} to a script URL`,
      report.styles && `${report.styles} inline style${report.styles === 1 ? '' : 's'} carrying script`,
    ].filter((entry): entry is string => Boolean(entry));

    if (!removed.length && !preview.looseText && preview.elements > 0) return nothing;

    return html`<div class="note warn">
      <span class="g">${icon('alert', 12)}</span>
      <span>
        ${preview.elements === 0
        ? html`Nothing here can be placed yet — markup has to start with a tag. Text on its
            own needs wrapping in one, a <code>&lt;p&gt;</code> for instance.`
        : nothing}
        ${preview.looseText && preview.elements > 0
        ? html`Text outside any tag will be dropped: insertion works in elements, so the
              loose words have nowhere to go. Wrap them to keep them.${removed.length
            ? ' '
            : ''}`
        : nothing}
        ${removed.length
        ? html`Removed on the way in: ${removed.join(', ')}. The editor will not put runnable
              code into your page.`
        : nothing}
      </span>
    </div>`;
  }

  /** The one-line account in the footer, for the case where nothing is wrong. */
  #summary(preview: ReturnType<typeof previewMarkup>, anchor: InsertAnchor): string {
    if (!preview.elements) return 'Markup has to start with a tag.';
    const what =
      preview.elements === 1
        ? `<${preview.tags[0]}>`
        : `${preview.elements} elements (${preview.tags.slice(0, 3).join(', ')}${preview.tags.length > 3 ? '…' : ''})`;
    const clean = nothingRemoved(preview.report) ? '' : ' Some of it was stripped — see above.';
    return `Inserts ${what} ${INSERT_POSITION_LABELS[anchor.position]} ${labelFor(anchor.reference)}.${clean}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-paste-dialog': HeoPasteDialog;
  }
}
