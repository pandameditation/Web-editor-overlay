import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { ChangeRecord } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
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
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.savePreview, s.saving] as const,
    shallowArrayEquals,
  );

  @state() private tab: 'changes' | 'prompt' = 'changes';

  override render(): TemplateResult | typeof nothing {
    const preview = this.state.value.savePreview;
    if (preview == null) return nothing;
    const records = this.editor.records;
    const instrumented = records.some((record) => record.source);

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-label="Review and save changes"
      @pointerdown=${(event: Event) => event.stopPropagation()}
    >
      <header>
        <div class="body">
          <h2>${records.length} change${records.length === 1 ? '' : 's'} ready to hand off</h2>
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
          ${this.editor.tokens.export().filter((token) => token.origin !== 'stylesheet').length}
          new tokens ·
          ${this.editor.classes.export().filter((entry) => entry.origin !== 'stylesheet').length}
          new classes
        </span>
        <span class="spacer"></span>
        <button class="btn" type="button" @click=${() => this.editor.exportDesignSystemFile()}>
          ${icon('download', 12)} Design system
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
          ?disabled=${this.state.value.saving}
          @click=${() => void this.editor.save()}
        >
          ${icon('save', 12)} Save changes
        </button>
      </footer>
    </div>`;
  }

  #renderChanges(records: ChangeRecord[]): TemplateResult {
    if (!records.length) return html`<div class="empty">No changes yet.</div>`;

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
        ${entries.map(
          (record) => html`<div class="change">
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
          </div>`,
        )}
      </div>`,
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-save-dialog': HeoSaveDialog;
  }
}
