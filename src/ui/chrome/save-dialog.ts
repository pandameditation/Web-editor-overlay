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
import type { PlannedWrite } from '../../core/writeback.js';

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

      /* ---- The write plan ---- */

      .write {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        padding: 8px 10px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        margin-bottom: 5px;
      }
      .write .glyph {
        flex: 0 0 auto;
        margin-top: 1px;
        color: var(--heo-accent);
      }
      .write .detail {
        flex: 1 1 auto;
        min-width: 0;
      }
      .write .path {
        display: block;
        overflow: hidden;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
        font-weight: 550;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .write .why {
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .write .size {
        flex: 0 0 auto;
        margin-top: 1px;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        white-space: nowrap;
      }
      .write .size .grew {
        color: var(--heo-success);
      }
      .write .size .shrank {
        color: var(--heo-danger);
      }

      /* Changes with nowhere to go. Stated, never hidden: this is the difference
         between "saved" and "saved except for the bit you cared about". */
      .stranded {
        margin-top: 14px;
        padding: 10px 11px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
      }
      .stranded h3 {
        margin: 0 0 7px;
        color: var(--heo-text);
        font-size: 11.5px;
        font-weight: 600;
      }
      .stranded p {
        margin: 0 0 8px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .stranded li {
        margin-bottom: 5px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .stranded ul {
        margin: 0;
        padding-left: 16px;
      }
      .stranded .what {
        color: var(--heo-text);
      }

      .destination {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        padding: 9px 11px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
      }
      .destination label {
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .destination select {
        height: 25px;
        max-width: 220px;
        padding: 0 6px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .destination .hint {
        flex: 1 1 100%;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
      }

      .where {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      header .where {
        margin-top: 5px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      header .where code {
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
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
    (s) => [s.savePreview, s.saving, s.registry, s.project, s.writePlan, s.planning] as const,
    shallowArrayEquals,
  );

  @state() private tab: 'changes' | 'prompt' = 'changes';

  /**
   * Whether this browser could offer a folder at all.
   *
   * Asked once, because the answer cannot change while the page is open, and because
   * the button that depends on it should not appear in a browser that has no picker —
   * an affordance that does nothing is worse than no affordance.
   */
  @state() private canPickFolder = false;

  /**
   * Which half of the dialog is showing.
   *
   * Handing the design system over used to be a download button in this footer,
   * which answered the wrong question: a file has to be hosted somewhere before
   * another page can use it, and the moment you finish a session is exactly when you
   * want to carry the system to the next page rather than archive it. So the button
   * became a step, and the step is the same surface the Tokens panel offers.
   */
  @state() private view: 'review' | 'transfer' | 'files' = 'review';

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

  override connectedCallback(): void {
    super.connectedCallback();
    void this.editor.hostOptions().then((options) => {
      this.canPickFolder = options.picker;
    });
  }

  private static readonly LABEL = {
    transfer: 'Share this design system',
    files: 'Review the files this will write',
    review: 'Review and save changes',
  } as const;

  override render(): TemplateResult | typeof nothing {
    const preview = this.state.value.savePreview;
    if (preview == null) return nothing;

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-label=${HeoSaveDialog.LABEL[this.view]}
      @pointerdown=${(event: Event) => event.stopPropagation()}
    >
      ${this.view === 'transfer'
        ? this.#renderTransfer()
        : this.view === 'files'
          ? this.#renderFiles()
          : this.#renderReview(preview)}
    </div>`;
  }

  /**
   * The files a save would write, before it writes them.
   *
   * The whole reason this is a step rather than a confidence: the overlay is about to
   * change files the user has open in an editor, and the honest way to do that is to
   * name every one of them first, with the reason it is in the list. Changes that
   * could not be filed are named here too — a save that reports success while
   * quietly dropping an edit is the failure mode worth designing against.
   */
  #renderFiles(): TemplateResult {
    const { project, writePlan, planning } = this.state.value;
    const targets = this.editor.styleTargets();
    const chosen = this.editor.designSystemTarget;
    const hasSystem = Boolean(this.#designSystemCSS());

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
          <h2>
            ${planning
        ? 'Working out what to write…'
        : writePlan
          ? `${writePlan.writes.length} file${writePlan.writes.length === 1 ? '' : 's'} to write`
          : 'Nothing to write'}
          </h2>
          <p>
            Every edit is replayed against the file's own text, so a one-line change is a
            one-line diff. Comments and formatting are left where they are.
          </p>
          ${project
        ? html`<span class="where">
                ${icon(project.kind === 'server' ? 'server' : 'folder', 11)}
                <span>${project.kind === 'server' ? 'Dev server' : 'Folder'}</span>
                <code>${project.label}</code>
              </span>`
        : nothing}
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

      <div class="content">
        ${hasSystem && targets.length > 1
        ? html`<div class="destination">
              <label for="heo-ds-target">New tokens and classes go in</label>
              <select
                id="heo-ds-target"
                .value=${chosen}
                @change=${(event: Event) =>
            this.editor.setDesignSystemTarget((event.target as HTMLSelectElement).value)}
              >
                ${targets.map(
              (target) => html`<option value=${target.value} ?selected=${target.value === chosen}>
                      ${target.label}
                    </option>`,
            )}
              </select>
              <span class="hint">
                A page that keeps its CSS in files should keep its tokens there too. "Keep in the
                page" leaves them in the &lt;style&gt; block they are rendering from now.
              </span>
            </div>`
        : nothing}
        ${planning
        ? html`<div class="empty">Reading the project files…</div>`
        : this.#renderPlan()}
      </div>

      <footer>
        <button
          class="btn"
          type="button"
          @click=${() => {
        this.view = 'review';
      }}
        >
          ${icon('chevronLeft', 12)} Back
        </button>
        <span class="spacer"></span>
        ${project
        ? html`<button
              class="btn"
              type="button"
              title="Stop writing files. Saving goes back to producing a prompt."
              @click=${() => void this.editor.disconnectProject()}
            >
              ${icon('unlink', 12)} Disconnect
            </button>`
        : nothing}
        <button
          class="btn"
          type="button"
          title="Read the files again and rebuild the list"
          ?disabled=${planning}
          @click=${() => void this.editor.previewWritePlan()}
        >
          ${icon('refresh', 12)} Recheck
        </button>
        ${this.#renderPrimary()}
      </footer>
    `;
  }

  #renderPlan(): TemplateResult {
    const plan = this.state.value.writePlan;
    if (!plan) {
      return html`<div class="empty">
        Could not read the project files. Try Recheck, or reconnect the folder.
      </div>`;
    }
    if (!plan.writes.length && !plan.unwritable.length) {
      return html`<div class="empty">Every change is already in the files.</div>`;
    }

    return html`
      ${plan.writes.map(
      (write) => html`<div class="write">
          <span class="glyph">${icon(GLYPH[write.kind], 13)}</span>
          <span class="detail">
            <span class="path">${write.path}</span>
            <span class="why">${write.reason}</span>
          </span>
          <span class="size">${sizeChange(write.before, write.after)}</span>
        </div>`,
    )}
      ${this.#renderStranded()}
    `;
  }

  /**
   * Changes that will not reach a file, and why.
   *
   * Two distinct kinds, kept apart because the answer differs. Something unreachable —
   * a cross-origin stylesheet, a file outside the folder — is a limit to accept. An
   * edit that could not be placed in a file this *is* writing means the file moved on
   * since the session started, and rechecking may well fix it.
   */
  #renderStranded(): TemplateResult | typeof nothing {
    const plan = this.state.value.writePlan;
    if (!plan) return nothing;
    const unplaced = plan.writes.flatMap((write) =>
      write.unplaced.map((failure) => ({ path: write.path, failure })),
    );
    if (!plan.unwritable.length && !unplaced.length) return nothing;

    return html`<div class="stranded">
      <h3>
        ${plan.unwritable.length + unplaced.length} change${plan.unwritable.length + unplaced.length === 1 ? '' : 's'
      } will not reach a file
      </h3>
      <p>
        These stay on the page and stay in the generated prompt, so nothing is lost — they
        just have to be applied by hand or by an agent.
      </p>
      <ul>
        ${plan.unwritable.map(
        (entry) => html`<li>
            <span class="what">${entry.record.summary}</span> — ${entry.reason}
          </li>`,
      )}
        ${unplaced.map(
        (entry) => html`<li>
            <span class="what">
              ${entry.failure.patch.property} on ${entry.failure.patch.selector}
            </span>
            — ${entry.failure.reason || `no such rule in ${entry.path}`}
          </li>`,
      )}
      </ul>
    </div>`;
  }

  /** New tokens and classes, as CSS. Empty when the session authored none. */
  #designSystemCSS(): string {
    return [this.editor.tokens.toCSS(), this.editor.classes.toCSS()].filter(Boolean).join('\n');
  }

  /**
   * The one button that commits, drawn the same wherever it appears.
   *
   * Its label is the answer to "what happens if I press this", which changes with the
   * connection: a project makes saving a write to named files, and calling that "Save
   * changes" would be the one place this dialog was coy about what it does.
   */
  #renderPrimary(): TemplateResult {
    const { saving, project, writePlan, planning } = this.state.value;
    const records = this.editor.records;
    const dropped = records.length - this.editor.handoffRecords.length;
    const nothingToDo = records.length === 0 || dropped === records.length;

    if (!project) {
      return html`<button
        class="btn primary"
        type="button"
        ?disabled=${saving || nothingToDo}
        title=${records.length === 0
          ? 'Nothing has changed since the last save'
          : nothingToDo
            ? 'Every change is unchecked, so there is nothing to hand off'
            : 'Hand these changes off'}
        @click=${() => void this.editor.save()}
      >
        ${icon('save', 12)} Save changes
      </button>`;
    }

    const count = writePlan?.writes.length;

    /*
     * Away from the Files step, this goes *to* it rather than writing.
     *
     * Writing files is the one irreversible thing the overlay does, and the step that
     * says which files, why each one, and where the design system is heading is one
     * click away — so putting it on the way through costs a click and buys the review.
     * The label says where the button leads, not what it eventually does.
     */
    if (this.view !== 'files') {
      return html`<button
        class="btn primary"
        type="button"
        ?disabled=${saving || nothingToDo}
        title=${nothingToDo
          ? 'Nothing to write'
          : `Review the files this will write in ${project.label}`}
        @click=${() => this.#openFiles()}
      >
        ${icon('folder', 12)}
        ${count === undefined ? 'Write to files' : `Write ${count} file${count === 1 ? '' : 's'}`}
        ${icon('chevronRight', 11)}
      </button>`;
    }

    return html`<button
      class="btn primary"
      type="button"
      ?disabled=${saving || planning || nothingToDo || count === 0}
      title=${count === 0
        ? 'Every change is already in the files'
        : `Write these files in ${project.label}`}
      @click=${() => void this.editor.save()}
    >
      ${icon('save', 12)}
      ${count === undefined ? 'Write files' : `Write ${count} file${count === 1 ? '' : 's'}`}
    </button>`;
  }

  /** Show the plan, building it first if it is not already there. */
  #openFiles(): void {
    this.view = 'files';
    if (!this.state.value.writePlan) void this.editor.previewWritePlan();
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
        ${this.#renderPrimary()}
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
            ${records.length === 0
        ? this.editor.history.hasSavePoint
          ? 'Everything is saved'
          : 'Nothing has changed yet'
        : dropped
          ? `${records.length - dropped} of ${records.length} changes ready to hand off`
          : `${records.length} change${records.length === 1 ? '' : 's'} ready to hand off`}
          </h2>
          <p>
            ${records.length === 0
        ? this.#renderIdleNote()
        : instrumented
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
        ${this.#renderFilesEntry()}
        ${this.#renderPrimary()}
      </footer>
    `;
  }

  /**
   * The way in to writing files, or the offer to make it possible.
   *
   * Only ever an offer. Nothing here connects on its own and nothing writes without a
   * second, named action — the overlay's default is still that it cannot reach your
   * source, and a folder is something you hand over rather than something it takes.
   */
  #renderFilesEntry(): TemplateResult | typeof nothing {
    const project = this.state.value.project;
    if (project) {
      // The primary button already leads to the Files step, so this only has to say
      // where the files are going.
      return html`<span class="where" title=${`Connected to ${project.label}`}>
        ${icon(project.kind === 'server' ? 'server' : 'folder', 11)}
        <code>${project.label}</code>
      </span>`;
    }

    // No picker and no server means there is nothing to offer, so nothing is offered.
    // A button that can only explain why it does not work is worse than its absence.
    if (!this.canPickFolder) return nothing;

    return html`<button
      class="btn"
      type="button"
      title="Hand over the folder holding this page, so saving edits its files instead of describing them"
      @click=${async () => {
        if (await this.editor.connectProjectFolder()) this.view = 'files';
      }}
    >
      ${icon('folder', 12)} Write to files…
    </button>`;
  }

  /**
   * What to say when there is nothing pending.
   *
   * After a write the interesting fact is not "no changes" but that undo still works
   * and would put changes back on the counter — because the files have moved on, so
   * rolling one back is something that needs saving again.
   */
  #renderIdleNote(): string {
    if (!this.editor.history.hasSavePoint) {
      return 'Edit something on the page and it will be listed here, with the file and line it came from.';
    }
    const project = this.state.value.project;
    return this.editor.store.value.canUndo
      ? `The page and ${project?.label ?? 'the files'} agree. Undo still works — rolling a saved change back counts as a change again, so it will reappear here.`
      : `The page and ${project?.label ?? 'the files'} agree.`;
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

const GLYPH: Record<PlannedWrite['kind'], string> = {
  document: 'file',
  stylesheet: 'droplet',
  script: 'code',
};

/**
 * How much the file grows or shrinks, as the thing a reviewer actually checks.
 *
 * A byte count is a crude proxy for a diff, and deliberately so: the point is to catch
 * the case that should never happen — a file about to lose most of itself — without
 * pretending to be a diff viewer inside a save dialog.
 */
function sizeChange(before: string | null, after: string): string {
  if (before === null) return `new · ${bytes(after.length)}`;
  const delta = after.length - before.length;
  if (delta === 0) return bytes(after.length);
  return `${bytes(before.length)} → ${bytes(after.length)}`;
}

function bytes(count: number): string {
  return count < 1024 ? `${count} B` : `${(count / 1024).toFixed(1)} kB`;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-save-dialog': HeoSaveDialog;
  }
}
