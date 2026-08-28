import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { labelFor } from '../../core/dom.js';
import { ModalController } from '../../core/modal.js';
import { describeProvenance } from '../../core/provenance.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import '../controls/code-editor.js';

/**
 * Editing the code that renders a piece of the page.
 *
 * This is the answer to a refusal. The user tried to change some text, was told the
 * page's own JavaScript decides it, and the only edit that would actually hold is one
 * to that code — so this is where they land, and it has one job: make that edit small
 * enough to be worth making.
 *
 * Three decisions shape it.
 *
 * **A window, not a file.** What is shown is the span of lines around the code that
 * produces what was clicked on, and the line itself is called out. A whole file with a
 * scroll position would be the same information arranged as a search problem.
 *
 * **It says how it found the place.** Anchoring on the page's own text is reliable and
 * anchoring on a line number is not — a dev server serves a transformed copy of the
 * file, so the line the browser reported and the line on disk are not the same line.
 * When the text was found, the dialog says which string it matched. When it was not,
 * it says the value looks computed and that this is its best guess at where. Those are
 * different degrees of confidence and hiding the difference would be the one thing
 * that could make this untrustworthy.
 *
 * **It does not pretend to have changed the page.** A file edit reaches the screen
 * when the file is written and the page reloads, and the footer says exactly that.
 * Every other edit in this editor is live, so this one has to be explicit about not
 * being — the alternative is a user who applies, sees nothing move, and concludes the
 * feature is broken.
 */
@customElement('heo-source-dialog')
export class HeoSourceDialog extends HeoElement {
  static override styles = [
    baseStyles,
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
        width: min(820px, 100%);
        max-height: min(86vh, 720px);
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
      .where {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 7px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .where code {
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
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
      .content heo-code-editor {
        flex: 1 1 auto;
        min-height: 0;
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
      .note.guess {
        border-color: var(--heo-warn);
      }
      .note.guess .g {
        color: var(--heo-warn);
      }
      .note code {
        font-family: var(--heo-mono);
        color: var(--heo-text);
      }

      .empty {
        display: grid;
        place-items: center;
        min-height: 160px;
        color: var(--heo-text-faint);
        font-size: 11.5px;
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
      footer .actions > .btn {
        flex: 0 0 auto;
      }
      .err {
        color: var(--heo-danger);
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.sourceEdit] as const,
    shallowArrayEquals,
  );

  protected modal = new ModalController(this, { initialFocus: 'heo-code-editor' });

  override render(): TemplateResult | typeof nothing {
    const open = this.state.value.sourceEdit;
    if (!open) return nothing;

    const { target, provenance, window: span } = open;

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-label=${`Edit the code that renders ${labelFor(open.element)}`}
      @pointerdown=${(event: Event) => event.stopPropagation()}
    >
      <header>
        <div class="body">
          <h2>The code behind ${labelFor(open.element)}</h2>
          <p>${describeProvenance(provenance)}</p>
          <span class="where">
            ${icon('file', 11)}
            <code>${target.path ?? target.url ?? target.label}${span ? `:${span.anchor}` : ''}</code>
          </span>
        </div>
        <button
          class="btn icon ghost"
          type="button"
          aria-label="Close"
          @click=${() => this.editor.closeSourceEdit()}
        >
          ${icon('close', 14)}
        </button>
      </header>

      <div class="content">
        ${open.error && !span ? html`<div class="note guess">
              <span class="g">${icon('alert', 12)}</span>
              <span>${open.error}</span>
            </div>`
        : nothing}
        ${span ? this.#renderAnchorNote(open.text, span.anchorKind, span.matched) : nothing}
        ${span
        ? html`<heo-code-editor
              fill
              language="js"
              rows="16"
              .expandable=${false}
              heading=${`${target.label} · lines ${span.from}–${span.from + span.count - 1}`}
              .value=${open.draft}
              .error=${open.error}
              @code-input=${(event: CustomEvent<{ value: string }>) =>
            this.editor.updateSourceEdit({ draft: event.detail.value, error: '' })}
              @code-submit=${() => this.editor.commitSourceEdit()}
              @code-cancel=${() => this.editor.closeSourceEdit()}
            ></heo-code-editor>`
        : open.error
          ? nothing
          : html`<div class="empty">Reading ${target.label}…</div>`}
      </div>

      <footer>
        <span class=${`fine${open.error && span ? ' err' : ''}`}>
          ${open.error && span
        ? open.error
        : open.recorded
          ? 'Recorded. The page still shows the old result — it changes when this file is written and the page reloads.'
          : 'Edits to a file are not live. This is recorded as a change to the file, and reaches the page when it is saved and the page reloads.'}
        </span>
        <div class="actions">
          ${target.path || target.url
        ? html`<button
                class="btn"
                type="button"
                title="Open the whole file in the code view"
                @click=${() => {
            this.editor.closeSourceEdit();
            this.editor.openCodeWorkspace('js');
          }}
              >
                ${icon('expand', 12)} Whole file
              </button>`
        : nothing}
          <button class="btn" type="button" @click=${() => this.editor.closeSourceEdit()}>
            ${open.recorded ? 'Done' : 'Cancel'}
          </button>
          <button
            class="btn primary"
            type="button"
            ?disabled=${!span || open.draft === span.code}
            @click=${() => this.editor.commitSourceEdit()}
          >
            ${icon('check', 12)} Record this edit
          </button>
        </div>
      </footer>
    </div>`;
  }

  /**
   * How the window was located, said plainly.
   *
   * The two cases deserve different treatment because they carry different risk. A
   * matched string is the code that produces what the user is looking at, full stop. A
   * line number from a stack is a starting point that may be off by however much the
   * file was transformed on its way to the browser — so it gets the warning treatment
   * and an explanation of why the text was not findable.
   */
  #renderAnchorNote(
    text: string,
    kind: 'literal' | 'line' | 'start',
    matched: string | undefined,
  ): TemplateResult {
    if (kind === 'literal' && matched) {
      return html`<div class="note">
        <span class="g">${icon('search', 12)}</span>
        <span>
          Found <code>${clip(matched)}</code> in this file, so this window is the code that
          produces what is on the page.
        </span>
      </div>`;
    }
    return html`<div class="note guess">
      <span class="g">${icon('alert', 12)}</span>
      <span>
        ${text
        ? html`<code>${clip(text)}</code> is not written literally in this file, so the value is
              built rather than typed — interpolated, translated, or fetched.`
        : html`This element has no text to look for in the file.`}
        ${kind === 'line'
        ? ' This window is where the code that wrote it was running, which is the best available guess.'
        : ' This window is the top of the file, since nothing narrowed it down.'}
      </span>
    </div>`;
  }
}

/** Enough of a string to recognise, and no more than a line of the dialog. */
function clip(value: string, limit = 72): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-source-dialog': HeoSourceDialog;
  }
}
