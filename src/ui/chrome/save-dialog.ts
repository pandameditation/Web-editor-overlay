import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ModalController } from '../../core/modal.js';
import type { SeedTarget } from '../../core/seed.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { ChangeRecord } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { DesignTransfer, type DesignTransferHost } from '../panels/design-transfer.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * The save review dialog.
 *
 * The overlay cannot write to source files, so "save" means handing over a
 * precise description of what changed. Showing that description before it leaves
 * makes the handoff reviewable: the change list is grouped by file when the page
 * was instrumented, and the generated prompt is visible in full rather than
 * copied blind.
 */
@customElement('heo-save-dialog')
export class HeoSaveDialog extends HeoElement {
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
        animation: fade var(--heo-fast);
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
      }

      .dialog {
        display: flex;
        flex-direction: column;
        width: min(880px, 100%);
        max-height: min(86vh, 760px);
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
      }
      /* Nudged down so the chevron lines up with the heading rather than with the
         cap height of the line above it. */
      header .back {
        margin-top: 1px;
      }
      h2 {
        margin: 0 0 3px;
        font-size: 15px;
        font-weight: 600;
      }
      header p {
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 11.5px;
        line-height: 1.5;
      }

      .tabs {
        display: flex;
        gap: 3px;
        padding: 9px 18px 0;
      }
      .tab {
        height: 27px;
        padding: 0 11px;
        border: 0;
        border-radius: var(--heo-r-sm) var(--heo-r-sm) 0 0;
        background: transparent;
        color: var(--heo-text-faint);
        font-size: 11.5px;
        cursor: pointer;
      }
      .tab:hover {
        color: var(--heo-text);
      }
      .tab[aria-selected='true'] {
        background: var(--heo-sunken);
        color: var(--heo-text);
        box-shadow: inset 0 -2px 0 var(--heo-accent);
      }

      .content {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 14px 18px;
        background: var(--heo-sunken);
      }

      pre {
        margin: 0;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 11px;
        line-height: 1.65;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .file {
        margin-bottom: 14px;
      }
      .file h3 {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 6px;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
        font-weight: 550;
      }
      .change {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        padding: 7px 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        margin-bottom: 5px;
        transition:
          opacity var(--heo-fast),
          border-color var(--heo-fast);
      }
      /* Dropped, but still legible: this is the state you have to be able to
         recognise in order to change your mind about it. */
      .change.dropped {
        opacity: 0.5;
        border-style: dashed;
      }
      .change.dropped .summary {
        text-decoration: line-through;
        text-decoration-color: var(--heo-text-faint);
      }
      .change .pick {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 16px;
        height: 16px;
        margin-top: 1px;
        padding: 0;
        border: 1px solid var(--heo-line-strong);
        border-radius: 4px;
        background: var(--heo-sunken);
        color: var(--heo-accent-ink);
        cursor: pointer;
      }
      .change .pick[aria-checked='true'] {
        border-color: var(--heo-accent);
        background: var(--heo-accent);
      }
      .change .pick:hover {
        border-color: var(--heo-accent);
      }
      .change .pick:focus-visible {
        outline: 2px solid var(--heo-accent);
        outline-offset: 1px;
      }
      /* The transfer step's own scroller wants the same padding the review body
         has, but the fragment brings its own vertical rhythm. */
      .content .transfer {
        padding-bottom: 4px;
      }

      .change .kind {
        flex: 0 0 auto;
        min-width: 62px;
        color: var(--heo-accent);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding-top: 2px;
      }
      .change .detail {
        flex: 1 1 auto;
        min-width: 0;
      }
      .change .summary {
        color: var(--heo-text);
        font-size: 11.5px;
      }
      .change .where {
        display: block;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .change .diff {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      /* Clamped here rather than in the data. Change records hold the full value now —
         a whole stylesheet, or a paragraph with its line breaks — because the prompt
         must hand over exactly what changed. That is the wrong length for a review row,
         so the row limits what it draws and the value stays intact underneath. */
      .change .before,
      .change .after {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        max-width: 100%;
        overflow: hidden;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .change .before {
        color: var(--heo-danger);
        text-decoration: line-through;
        text-decoration-color: color-mix(in oklab, var(--heo-danger) 50%, transparent);
      }
      .change .after {
        color: var(--heo-success);
      }

      footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid var(--heo-line);
      }
      footer .spacer {
        flex: 1 1 auto;
      }
      .note {
        max-width: 300px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .note .link {
        padding: 0;
        border: 0;
        background: none;
        color: var(--heo-accent);
        font: inherit;
        text-decoration: underline;
        cursor: pointer;
      }
    `,
    DesignTransfer.styles,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    // `registry` is in here for the include/exclude checkboxes: toggling one bumps it,
    // and without that the row would keep drawing its old state while the preview
    // beside it had already changed.
    (s) => [s.savePreview, s.saving, s.registry] as const,
    shallowArrayEquals,
  );

  @state() private tab: 'changes' | 'prompt' = 'changes';

  /**
   * Which half of the dialog is showing.
   *
   * Handing the design system over used to be a download button in this footer,
   * which answered the wrong question: a file has to be hosted somewhere before
   * another page can use it, and the moment you finish a session is exactly when you
   * want to carry the system to the next page rather than archive it. So the button
   * became a step, and the step is the same surface the Tokens panel offers.
   */
  @state() private view: 'review' | 'transfer' = 'review';

  /** State the shared transfer surface reads back from its host. */
  @state() private seedTarget: SeedTarget | null = null;
  @state() private incoming = '';
  @state() private overwrite = false;

  /**
   * Focus starts on the active tab rather than the close button.
   *
   * This dialog is read before it is acted on, and the tabs are where reading
   * starts. Landing on Close would put the first keystroke on the way out.
   */
  protected modal = new ModalController(this, { initialFocus: '.tab[aria-selected="true"]' });

  override render(): TemplateResult | typeof nothing {
    const preview = this.state.value.savePreview;
    if (preview == null) return nothing;

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-label=${this.view === 'transfer'
        ? 'Share this design system'
        : 'Review and save changes'}
      @pointerdown=${(event: Event) => event.stopPropagation()}
    >
      ${this.view === 'transfer' ? this.#renderTransfer() : this.#renderReview(preview)}
    </div>`;
  }

  /**
   * The design system, on its way somewhere else.
   *
   * A step rather than a second dialog: it belongs to the same act of finishing up,
   * and stacking a modal on a modal to show one panel would be a lot of ceremony
   * for a screen you arrive at by clicking one button and leave by clicking another.
   */
  #renderTransfer(): TemplateResult {
    return html`
      <header>
        <button
          class="btn icon ghost back"
          type="button"
          aria-label="Back to the changes"
          title="Back to the changes"
          @click=${() => {
        this.view = 'review';
      }}
        >
          ${icon('chevronLeft', 14)}
        </button>
        <div class="body">
          <h2>Take this design system with you</h2>
          <p>
            Everything this session defined — tokens, reusable classes and blocks — ready to paste
            into the next page, or to bring one in from another.
          </p>
        </div>
        <button
          class="btn icon ghost"
          type="button"
          aria-label="Close"
          @click=${() => this.editor.closeSavePreview()}
        >
          ${icon('close', 14)}
        </button>
      </header>

      <div class="content">${DesignTransfer.render(this.#transfer())}</div>

      <footer>
        <button
          class="btn"
          type="button"
          @click=${() => {
        this.view = 'review';
      }}
        >
          ${icon('chevronLeft', 12)} Back to the changes
        </button>
        <span class="spacer"></span>
        <button
          class="btn primary"
          type="button"
          ?disabled=${this.state.value.saving}
          @click=${() => void this.editor.save()}
        >
          ${icon('save', 12)} Save changes
        </button>
      </footer>
    `;
  }

  #transfer(): DesignTransferHost {
    return {
      engine: this.editor,
      target: this.seedTarget,
      onTarget: (target) => {
        this.seedTarget = target;
      },
      incoming: this.incoming,
      onIncoming: (text) => {
        this.incoming = text;
      },
      overwrite: this.overwrite,
      onOverwrite: (value) => {
        this.overwrite = value;
      },
      onSeed: () => {
        this.requestUpdate();
      },
    };
  }

  #renderReview(preview: string): TemplateResult {
    const records = this.editor.records;
    const instrumented = records.some((record) => record.source);
    const dropped = records.length - this.editor.handoffRecords.length;

    return html`
      <header>
        <div class="body">
          <h2>
            ${dropped
        ? `${records.length - dropped} of ${records.length} changes ready to hand off`
        : `${records.length} change${records.length === 1 ? '' : 's'} ready to hand off`}
          </h2>
          <p>
            ${instrumented
        ? 'Every change is tied to a source file and line, so the instructions point straight at the code.'
        : 'This page was not instrumented, so changes are described by CSS selector. Add the Vite plugin to get exact file and line references.'}
          </p>
        </div>
        <button
          class="btn icon ghost"
          type="button"
          aria-label="Close"
          @click=${() => this.editor.closeSavePreview()}
        >
          ${icon('close', 14)}
        </button>
      </header>

      <div class="tabs" role="tablist">
        <button
          class="tab"
          role="tab"
          aria-selected=${this.tab === 'changes'}
          @click=${() => {
        this.tab = 'changes';
      }}
        >
          Changes
        </button>
        <button
          class="tab"
          role="tab"
          aria-selected=${this.tab === 'prompt'}
          @click=${() => {
        this.tab = 'prompt';
      }}
        >
          Generated prompt
        </button>
      </div>

      <div class="content">
        ${this.tab === 'prompt' ? html`<pre>${preview}</pre>` : this.#renderChanges(records)}
      </div>

      <footer>
        <span class="note">
          ${dropped
        ? html`${dropped} unchecked, left out of the prompt. ${dropped === 1 ? 'It stays' : 'They stay'
          } on the page — undo takes ${dropped === 1 ? 'it' : 'them'} back.
              <button
                class="link"
                type="button"
                @click=${() => this.editor.includeAllChanges()}
              >
                Include all
              </button>`
        : html`${this.editor.tokens.export().filter((token) => token.origin !== 'stylesheet')
          .length}
              new tokens ·
              ${this.editor.classes.export().filter((entry) => entry.origin !== 'stylesheet')
            .length}
              new classes`}
        </span>
        <span class="spacer"></span>
        <button
          class="btn"
          type="button"
          title="Copy this system as a seed, download it, or bring another one in"
          @click=${() => {
        this.view = 'transfer';
      }}
        >
          ${icon('blocks', 12)} Design system ${icon('chevronRight', 11)}
        </button>
        <button class="btn" type="button" @click=${() => this.editor.exportPageHTML()}>
          ${icon('code', 12)} HTML
        </button>
        <button class="btn" type="button" @click=${() => void this.editor.copyPrompt()}>
          ${icon('copy', 12)} Copy prompt
        </button>
        <button
          class="btn primary"
          type="button"
          ?disabled=${this.state.value.saving || dropped === records.length}
          title=${dropped === records.length
        ? 'Every change is unchecked, so there is nothing to hand off'
        : 'Hand these changes off'}
          @click=${() => void this.editor.save()}
        >
          ${icon('save', 12)} Save changes
        </button>
      </footer>
    `;
  }

  /**
   * The change set, with a checkbox per entry.
   *
   * Unchecking takes the change out of the prompt and out of the payload, and the
   * preview updates as you go — the two must never disagree about what is being
   * handed over. It does not take the change off the page; the note in the footer
   * says so, because a reviewer who assumes otherwise would hand over instructions
   * that do not match what they are looking at.
   */
  #renderChanges(records: ChangeRecord[]): TemplateResult {
    if (!records.length) return html`<div class="empty">No changes yet.</div>`;
    const excluded = this.editor.excludedChanges;

    // Group by file so the reviewer reads it the way they will apply it.
    const groups = new Map<string, ChangeRecord[]>();
    for (const record of records) {
      const key = record.source?.file ?? 'Matched by selector';
      const bucket = groups.get(key);
      if (bucket) bucket.push(record);
      else groups.set(key, [record]);
    }

    return html`${[...groups.entries()].map(
      ([file, entries]) => html`<div class="file">
        <h3>${icon(file === 'Matched by selector' ? 'search' : 'code', 12)} ${file}</h3>
        ${entries.map((record) => {
        const included = !excluded.has(record.id);
        return html`<div class=${`change${included ? '' : ' dropped'}`}>
            <button
              class="pick"
              type="button"
              role="checkbox"
              aria-checked=${included}
              title=${included
            ? 'Leave this change out of the hand-off'
            : 'Put this change back in the hand-off'}
              aria-label=${`${included ? 'Exclude' : 'Include'}: ${record.summary}`}
              @click=${() => this.editor.setChangeIncluded(record.id, !included)}
            >
              ${included ? icon('check', 11) : nothing}
            </button>
            <span class="kind">${record.kind}</span>
            <span class="detail">
              <span class="summary">${record.summary}</span>
              <span class="where">
                ${record.target}${record.source ? ` · line ${record.source.line}` : ''}
              </span>
              ${record.before || record.after
            ? html`<span class="diff">
                    ${record.before ? html`<span class="before">${record.before}</span>` : nothing}
                    ${record.after ? html`<span class="after">${record.after}</span>` : nothing}
                  </span>`
            : nothing}
            </span>
          </div>`;
      })}
      </div>`,
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-save-dialog': HeoSaveDialog;
  }
}
