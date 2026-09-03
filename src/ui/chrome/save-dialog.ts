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
import { localAssetLimit, type AssetKind } from '../../core/assets.js';
import {
  bundleName,
  bundleShape,
  canArchive,
  planCanArchive,
  planIsStale,
  PLACEMENT_KEYS,
  type BundleFile,
  type BundlePackaging,
  type BundlePlan,
  type BundleSurvey,
} from '../../core/bundle.js';
import { designSystemCSSText, type PlannedWrite } from '../../core/writeback.js';
import { fileAccessStyles } from '../panels/file-access.js';

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
      /* Distinct from the reason line above, which says what the write is for. This says
         what else it does, so it reads as a caution rather than as more description. */
      .write .caveat {
        display: flex;
        align-items: flex-start;
        gap: 5px;
        margin-top: 5px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .write .caveat svg {
        margin-top: 1px;
        color: var(--heo-warn);
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

      /* ---- The export step's three choices ---- */

      /* One of the export step's questions, with its heading and its controls. */
      .pick {
        margin-bottom: 14px;
      }
      /* Being rebuilt: still there, still the right height, visibly not yet the answer. */
      .plan {
        transition: opacity var(--heo-fast);
      }
      .plan.refreshing {
        opacity: 0.45;
      }
      /* The heading keeps its line and the action sits at the far edge of it, so a destructive
         button is nowhere near the checkbox it is the opposite of. */
      .pickhead {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }
      .pickhead > .btn {
        flex: 0 0 auto;
      }
      /* The current state, above the controls that change it. Dimmer than the choices on
         purpose: it is what is, not what to do. */
      .persist {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0 0 9px;
        padding: 7px 9px;
        border: 1px solid var(--heo-border);
        border-radius: var(--heo-radius-sm, 5px);
        background: var(--heo-surface-sunken, rgba(0, 0, 0, 0.14));
        font-size: 10.5px;
        line-height: 1.5;
      }
      .persist .row {
        display: flex;
        align-items: baseline;
        gap: 4px;
        color: var(--heo-text-faint);
      }
      .persist .what {
        min-width: 62px;
        color: var(--heo-text-dim, var(--heo-text));
      }
      .persist .row.unfiled .sep,
      .persist .row.removing .sep {
        color: var(--heo-warn, #f59e0b);
      }
      .persist .hintrow {
        margin-top: 3px;
        display: block;
      }
      .lead.warn {
        display: flex;
        align-items: flex-start;
        gap: 5px;
        color: var(--heo-warn, #f59e0b);
      }
      .pick h3 {
        margin: 0 0 3px;
        color: var(--heo-text);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .pick .lead {
        margin: 0 0 8px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .choices {
        display: grid;
        gap: 6px;
      }

      /* The packaging alternatives: large enough to read before choosing. */
      .packages {
        display: grid;
        gap: 7px;
      }
      .package {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 11px 12px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        cursor: pointer;
        transition:
          border-color var(--heo-fast),
          background var(--heo-fast);
      }
      .package:hover {
        border-color: var(--heo-line-strong);
      }
      .package.on {
        border-color: var(--heo-accent);
        background: color-mix(in oklab, var(--heo-accent) 8%, var(--heo-raised));
      }
      .package input {
        width: 15px;
        height: 15px;
        margin: 1px 0 0;
        flex: 0 0 auto;
        accent-color: var(--heo-accent);
        cursor: inherit;
      }
      .package .body {
        display: grid;
        gap: 3px;
        min-width: 0;
      }
      .package .name {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-text);
        font-size: 12px;
        font-weight: 550;
      }
      .package .detail {
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .choice {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        padding: 9px 11px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        cursor: pointer;
        transition: border-color var(--heo-fast);
      }
      .choice:hover {
        border-color: var(--heo-line-strong);
      }
      /* A chosen alternative, where the rows are radios rather than independent checkboxes. */
      .choice.on {
        border-color: var(--heo-accent);
        background: color-mix(in oklab, var(--heo-accent) 8%, var(--heo-raised));
      }
      /* Indented under the row above, with an elbow, because it depends on it: a face can only
         travel inside a stylesheet that travels. */
      .choice.sub {
        position: relative;
        margin-left: 17px;
      }
      .choice.sub::before {
        content: '';
        position: absolute;
        left: -11px;
        top: -8px;
        bottom: 50%;
        width: 10px;
        border-left: 1px solid var(--heo-line);
        border-bottom: 1px solid var(--heo-line);
        border-bottom-left-radius: 5px;
        pointer-events: none;
      }
      /* Nothing to decide: no assets of this kind, or none that can be read here. Dimmed
         rather than dropped, because the absence is a fact about the page worth seeing. */
      .choice.settled {
        cursor: default;
        opacity: 0.62;
      }
      .choice.settled:hover {
        border-color: var(--heo-line);
      }
      .choice input {
        width: 14px;
        height: 14px;
        margin: 1px 0 0;
        flex: 0 0 auto;
        accent-color: var(--heo-accent);
        cursor: inherit;
      }
      .choice .text {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .choice .name {
        color: var(--heo-text);
        font-size: 11.5px;
      }
      .choice .detail {
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .choice .why {
        color: color-mix(in oklab, var(--heo-warn) 74%, var(--heo-text-faint));
        font-size: 10.5px;
        line-height: 1.45;
      }

      /* ---- What it is called, and where it lands ---- */

      .naming {
        display: grid;
        gap: 7px;
        padding: 9px 11px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
      }
      .naming .row {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .naming .field-label {
        flex: 0 0 auto;
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .naming input[type='text'] {
        flex: 1 1 auto;
        min-width: 0;
        height: 25px;
        padding: 0 7px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .naming input[type='text']:focus-visible {
        outline: none;
        border-color: var(--heo-accent);
      }
      /* The extension is shown, not editable: it follows the shape, and a zip named .html
         is a file that does not open. */
      .naming .ext {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .naming .to {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .naming .to input[type='checkbox'] {
        width: 13px;
        height: 13px;
        margin: 1px 0 0;
        flex: 0 0 auto;
        accent-color: var(--heo-accent);
        cursor: pointer;
      }
      .naming label.to {
        cursor: pointer;
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
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        padding: 12px 18px;
        border-top: 1px solid var(--heo-line);
      }
      /*
       * The actions are a group of their own, not a row of siblings after a spacer.
       *
       * The row grows with the connection — a connected project adds the folder name and
       * Disconnect to everything already there — and the dialog is only ever as wide as
       * the window. A spacer right-aligns one line and has nothing to push against on a
       * second, which stranded the primary button at the left. Grouping them means they
       * wrap as a block and stay right-aligned however many lines they take.
       */
      footer .actions {
        display: flex;
        flex: 1 1 auto;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      footer .actions > .btn {
        flex: 0 0 auto;
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
    // The export step reuses the notice the code panels draw when a page opened from disk
    // cannot read its own files, because it is the same fact and should read the same way.
    fileAccessStyles,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    // `registry` is in here for the include/exclude checkboxes: toggling one bumps it,
    // and without that the row would keep drawing its old state while the preview
    // beside it had already changed.
    (s) =>
      [
        s.savePreview,
        s.saving,
        s.registry,
        s.project,
        s.writePlan,
        s.planning,
        // The export step's own three: the choices, the plan they produced, and whether one
        // is being built. Without them a checkbox would move and the footer would go on
        // promising the file the previous choice would have written.
        s.bundleOptions,
        s.bundlePlan,
        s.bundling,
        // And where it is going, since the footer names the file: typing in the name field
        // has to reach the button that promises to write it.
        s.exportName,
        s.exportPrompt,
        // How much of the design system travels, which both save steps offer.
        s.designSystemScope,
        // And whether the block library goes with it, offered beside it in both.
        s.saveBlockLibrary,
        // And whether it is being taken out, which is a different answer to a different question.
        s.removeBlockLibrary,
      ] as const,
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
  @state() private view: 'review' | 'transfer' | 'files' | 'export' = 'review';

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
    // The dialog is created fresh each time it opens, so whoever opened it gets to say
    // which step it lands on. The CSS and JS panels use that to send someone straight to
    // the file plan when a file they cannot read is what they came to ask about.
    if (this.editor.store.value.saveView === 'files' && this.state.value.project) {
      this.view = 'files';
      if (!this.state.value.writePlan) void this.editor.previewWritePlan();
    }
  }

  private static readonly LABEL = {
    transfer: 'Share this design system',
    files: 'Review the files this will write',
    export: 'Save as HTML',
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
          : this.view === 'export'
            ? this.#renderExport()
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
              <label for="heo-ds-target">New tokens, classes and rules go in</label>
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
        ${this.#renderDesignSystemScope()} ${this.#renderBlockLibrary()}
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
        <div class="actions">
          ${this.#renderDisconnect()}
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
        </div>
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
            <!--
              What the write does beyond what the change list says.
              The byte delta was the only clue that the document write carries more than
              the edits asked for, and a number is not an explanation — someone seeing
              "+313 B" on a three-word change has no way to find out why.
            -->
            ${(write.warnings ?? []).map(
        (warning) => html`<span class="caveat">
                  ${icon('alert', 11)}
                  <span>${warning}</span>
                </span>`,
      )}
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

  /**
   * New tokens, classes and rules, as CSS. Empty when the session authored none.
   *
   * Same order the write plan uses, and for its reason: the join order is the cascade
   * order, so this preview and the file have to agree about it.
   */
  #designSystemCSS(): string {
    return designSystemCSSText({
      tokens: this.editor.tokens.toCSS(),
      classes: this.editor.classes.toCSS(),
      rules: this.editor.rules.toCSS(),
    });
  }

  /**
   * How much of the design system to write.
   *
   * Drawn in both save steps, because it is the same question either way — a project write and
   * a single-file export both have to decide whether the whole vocabulary travels or only the
   * part this page speaks.
   *
   * The counts are the point. "Only what is used" is an easy thing to agree to and a hard thing
   * to picture, so each option says how many tokens and classes it means, and the difference
   * between the two numbers is the argument.
   */
  /**
   * Whether the block library travels with the page.
   *
   * Its own row rather than a fourth option on the extent radios, because it is a different
   * payload with a different destination. Tokens, classes and rules become CSS and can be sent
   * to a stylesheet; a block is markup plus props plus sometimes a module, and the only thing
   * that can carry one is a seed in the markup. So the question is not "how much" but "at all".
   *
   * Absent when the library holds nothing but presets — those are rebuilt by whatever loads the
   * page, so there would be nothing to write and no decision to offer.
   */
  #renderBlockLibrary(): TemplateResult | typeof nothing {
    const count = this.editor.blockLibrarySize();
    const carrying = this.editor.blockLibraryInPage();
    // Nothing to write and nothing already there to take out, so there is no question to ask.
    if (!count && !carrying) return nothing;
    const on = this.state.value.saveBlockLibrary;
    const removing = this.state.value.removeBlockLibrary;

    return html`<section class="pick">
      <div class="pickhead">
        <h3 id="heo-blocks">Block library</h3>
        ${this.#renderLibraryRemoval(carrying, removing)}
      </div>
      <p class="lead">
        The page carries the components you placed. It does not carry the templates they came
        from, so on the next load there is no way to make another one.
      </p>
      ${removing
        ? html`<p class="lead warn">
            ${icon('alert', 11)} The next save takes the library out of this page: the
            <code class="mono">&lt;script type="application/heo-seed"&gt;</code> goes, and so does
            every <code class="mono">data-heo-block</code> linking an element to a template. Undo
            brings both back.
          </p>`
        : nothing}
      ${count
        ? html`<div class="choices" role="group" aria-labelledby="heo-blocks">
        <label class=${`choice${on ? ' on' : ''}`}>
          <input
            type="checkbox"
            .checked=${on}
            @change=${(event: Event) =>
            this.editor.setSaveBlockLibrary((event.target as HTMLInputElement).checked)}
          />
          <span class="text">
            <span class="name">Write the library into the page</span>
            <span class="detail">
              ${count} block${count === 1 ? '' : 's'} · a
              <code class="mono">&lt;script type="application/heo-seed"&gt;</code> in the head
            </span>
            <span class="why">
              Persists the library in
              the page so the blocks can be reused later and implemented blocks can sync to the library
            </span>
          </span>
        </label>
      </div>`
        : nothing}
    </section>`;
  }

  /**
   * The way to stop the page carrying a library at all.
   *
   * On the section's own header rather than as a fourth choice, because it is not an answer to
   * "does the library travel this time" — it is an instruction about what is already in the file.
   * Unticking the box and removing the library read as the same thing and are not: one leaves the
   * seed exactly where it is, which is what makes an unticked save safe.
   *
   * Absent when the page carries nothing, so the action never offers to remove what is not there.
   */
  #renderLibraryRemoval(carrying: boolean, removing: boolean): TemplateResult | typeof nothing {
    if (!carrying) return nothing;
    if (removing) {
      return html`<button
        class="btn sm"
        type="button"
        title="Keep the library in the page after all"
        @click=${() => this.editor.undo()}
      >
        ${icon('undo', 11)} Keep it
      </button>`;
    }
    return html`<button
      class="btn sm danger"
      type="button"
      title="Take the seed script and every instance link out of this page on the next save"
      @click=${() =>
        this.editor.askToConfirm({
          title: 'Remove the block library from this page?',
          message:
            'The seed script goes, and so does every data-heo-block attribute tying an element to a template.',
          detail:
            'The elements themselves are untouched — they keep their markup and stop being components. The library stays in this session, so you can write it back by ticking the box again.',
          confirmLabel: 'Remove it',
          tone: 'danger',
          reversible: true,
          run: () => {
            this.editor.removeBlockLibraryFromPage();
          },
        })}
    >
      ${icon('trash', 11)} Remove block library
    </button>`;
  }

  /**
   * What is kept where, said plainly, before the controls that change it.
   *
   * "Is my design system persisted?" had no answer anywhere in this dialog. There were three
   * controls that decide it — the destination select, the extent radios and the library tick — and
   * between them they describe the *next* save, never the current state. So the seed read as the
   * only way to keep a design system, when for tokens, classes and rules it is the manual
   * fallback and a file is the normal answer.
   *
   * One row per part, each naming its destination. Parts with nothing in them are still listed:
   * "no rules yet" and "rules kept nowhere" are opposite facts and a missing row would read as
   * either.
   */
  #renderPersistence(): TemplateResult {
    const parts = this.editor.designSystemPersistence();
    const NOTE: Record<string, string> = {
      filed: 'kept in',
      unfiled: 'not kept anywhere —',
      empty: 'nothing yet',
      removing: 'being removed from',
    };

    return html`<div class="persist">
      ${parts.map((entry) => {
      const label = `${entry.count} ${entry.part === 'classes' && entry.count === 1
        ? 'class'
        : entry.part === 'library'
          ? `block${entry.count === 1 ? '' : 's'}`
          : entry.part.replace(/s$/, '') + (entry.count === 1 ? '' : 's')
        }`;
      return html`<span class=${`row ${entry.state}`}>
          <span class="what">${label}</span>
          <span class="sep">${NOTE[entry.state]}</span>
          ${entry.state === 'empty'
          ? nothing
          : html`<code class="mono">${entry.where}</code>`}
        </span>`;
    })}
      ${parts.some((entry) => entry.state === 'unfiled')
        ? html`<span class="row hintrow">
            Anything not kept in a file lives in this session only. Connect a folder to write it,
            or take the design system with you as a seed.
          </span>`
        : nothing}
    </div>`;
  }

  #renderDesignSystemScope(): TemplateResult | typeof nothing {
    const all = this.editor.designSystemExtent('all');
    // Nothing authored or imported, so there is no question to ask.
    if (!all.tokens && !all.classes && !all.rules) return nothing;
    const used = this.editor.designSystemExtent('used');
    const chosen = this.state.value.designSystemScope;

    const count = (extent: { tokens: number; classes: number; rules: number }): string => {
      const parts = [
        extent.tokens && `${extent.tokens} token${extent.tokens === 1 ? '' : 's'}`,
        extent.classes && `${extent.classes} class${extent.classes === 1 ? '' : 'es'}`,
        extent.rules && `${extent.rules} rule${extent.rules === 1 ? '' : 's'}`,
      ].filter((part): part is string => Boolean(part));
      return parts.length ? parts.join(', ') : 'nothing';
    };

    const options = [
      { value: 'all', label: 'All of it', detail: count(all) },
      { value: 'used', label: 'Only what this page uses', detail: count(used) },
      { value: 'none', label: 'Leave it out', detail: 'nothing' },
    ] as const;

    return html`<section class="pick">
      <h3 id="heo-ds-scope">Design system</h3>
      <p class="lead">
        The tokens, classes and rules this session owns, imported or authored. A page usually
        speaks a fraction of an imported system.
      </p>
      ${this.#renderPersistence()}
      <div class="choices" role="radiogroup" aria-labelledby="heo-ds-scope">
        ${options.map(
      (option) => html`<label class=${`choice${chosen === option.value ? ' on' : ''}`}>
            <input
              type="radio"
              name="heo-ds-scope"
              value=${option.value}
              .checked=${chosen === option.value}
              @change=${() => this.editor.setDesignSystemScope(option.value)}
            />
            <span class="text">
              <span class="name">${option.label}</span>
              <span class="detail">${option.detail}</span>
            </span>
          </label>`,
    )}
      </div>
    </section>`;
  }

  /**
   * The one button that commits, drawn the same wherever it appears.
   *
   * Its label is the answer to "what happens if I press this", which changes with the
   * connection: a project makes saving a write to named files, and calling that "Save
   * changes" would be the one place this dialog was coy about what it does.
   */
  #renderPrimary(known?: BundlePackaging): TemplateResult {
    const { saving, project, writePlan, planning } = this.state.value;
    const records = this.editor.records;
    const dropped = records.length - this.editor.handoffRecords.length;
    const nothingToDo = records.length === 0 || dropped === records.length;

    /*
     * No project: the save writes the page out, and it says so.
     *
     * Two steps, exactly as a project write has, because the reasons are the same. The
     * download is about to become someone's copy of this page, and the step in between is
     * where it says which files, how big, and what it could not reach — while it is still a
     * proposal. The label names the file it will write, which is the answer to "what happens
     * if I press this".
     */
    /*
     * On the Save-as-HTML step the primary writes the copy, connected or not.
     *
     * Checked before the project, because that step is now reachable with a folder attached —
     * and `save()` prefers the project, so it would have written to the files while the button
     * said it was writing an HTML copy. `writeBundle` is what the label promises, so it is what
     * gets called.
     */
    if (this.view === 'export') {
      const { bundling, bundlePlan } = this.state.value;
      const shape = known ?? this.editor.bundleShape();
      const name = bundlePlan?.fileName ?? bundleName(this.editor.exportFileName, shape);
      return html`<button
        class="btn primary"
        type="button"
        ?disabled=${saving || bundling || nothingToDo}
        title=${nothingToDo
          ? 'Nothing to write'
          : this.state.value.exportPrompt
            ? `Choose where to put ${name}, then write it`
            : `Write ${name} to your downloads folder`}
        @click=${() => void this.editor.writeBundle()}
      >
        ${icon('save', 12)} Save ${name}
      </button>`;
    }

    if (!project) {
      const { bundlePlan } = this.state.value;
      // The export step already worked the shape out from a survey it had in hand, so it
      // passes it in rather than have the footer reach a different answer to the same question.
      const shape = known ?? this.editor.bundleShape();
      const name = bundlePlan?.fileName ?? bundleName(this.editor.exportFileName, shape);

      /*
       * Connecting a folder is the primary offer wherever the browser can make it.
       *
       * It is the better answer by a distance: it changes the files this page is built from,
       * in place, so the edits are in the project rather than in a copy of the output. Saving
       * a standalone HTML is a real thing to want, but it is the fallback — and it used to be
       * the prominent one purely because it always works.
       */
      if (this.canPickFolder) {
        return html`<button
          class="btn primary"
          type="button"
          ?disabled=${saving}
          title="Hand over the folder holding this page. Saving then edits those files where they already are, so the changes land in your project instead of in a downloaded copy."
          @click=${async () => {
            if (await this.editor.connectProjectFolder()) this.view = 'files';
          }}
        >
          ${icon('folder', 12)} Connect folder to edit files ${icon('chevronRight', 11)}
        </button>`;
      }

      /*
       * No picker, so there is no folder to offer and this is the only thing that works.
       *
       * Firefox and Safari opening a page from disk, chiefly — where the browser will not hand
       * a folder to a page at all, and a copy of the output is the whole of what can be done.
       */
      return html`<button
        class="btn primary"
        type="button"
        ?disabled=${saving || nothingToDo}
        title=${records.length === 0
          ? 'Nothing has changed since the last save'
          : nothingToDo
            ? 'Every change is unchecked, so there is nothing to write'
            : `Choose what travels with ${name} and where it goes`}
        @click=${() => this.#openExport()}
      >
        ${icon('code', 12)} Save as HTML ${icon('chevronRight', 11)}
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

  /* ---------------------------------------------------------------------- */
  /* Writing the page out, when there is nowhere to write into             */
  /* ---------------------------------------------------------------------- */

  /**
   * How to write the page out, and what that will produce.
   *
   * The disconnected counterpart of the Files step, and it exists for the same reason: the
   * one thing worth doing before handing something over is saying what it contains.
   *
   * Two questions, in the order they depend on each other. **What to save** is per kind of
   * asset, and it is genuinely about saving — unticking fonts leaves their links pointing
   * where they always did rather than moving them somewhere else. **How to package it** then
   * asks what to do with what was saved, and appears only when there is something to
   * package: with nothing saved, or nothing readable, both answers produce the same lone
   * HTML file, and choosing between two identical outcomes is worse than not being asked.
   *
   * That conditional is also the guard. A single file that still points at files nobody has
   * is the combination that cannot work, and it is unreachable rather than prevented: the
   * archive is only ever offered when there is a file to put in it.
   */
  #renderExport(): TemplateResult {
    const { bundling, bundlePlan, bundleOptions } = this.state.value;
    /*
     * Surveyed once, then passed down.
     *
     * A survey clones and serializes the whole document, so it is the most expensive thing
     * this render does. It used to happen three times per render — once here, once inside
     * `bundleShape` and once inside `canArchiveBundle`, each of which falls back to a fresh
     * survey when there is no plan yet. Ticking a box clears the plan and causes several
     * renders in a row, so a click cost the better part of a dozen full document copies and
     * the page visibly froze.
     */
    const survey = this.editor.bundleSurvey();
    /*
     * A plan outlives the choices that made it, so which parts of it still apply matters.
     *
     * `shape` and the packaging offer come from the *current* choices once the plan is stale,
     * because those are what the footer promises and it must not promise a `.zip` for choices
     * that stopped producing one. The file list keeps showing the old plan, dimmed, because a
     * list that empties and refills is the flashing this replaced.
     */
    const stale = bundlePlan !== null && planIsStale(bundlePlan, bundleOptions);
    const settledPlan = bundlePlan && !stale ? bundlePlan : null;
    const refreshing = bundling || stale;
    const shape = settledPlan ? settledPlan.shape : bundleShape(survey, bundleOptions);
    const offerArchive = settledPlan
      ? planCanArchive(settledPlan, bundleOptions)
      : canArchive(survey, bundleOptions);
    const limit = localAssetLimit();

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
          <h2>Save as HTML</h2>
          <p>
            A copy of this page, with your edits in it. Choose what travels with it and how it is
            packaged — nothing is written until you press the button below.${this.canPickFolder
        ? ' To change the files this page is built from instead, go back and connect its folder.'
        : ''}
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

      <div class="content">
        <section class="pick">
          <h3 id="heo-export-what">Choose what to embed for offline use</h3>
          <p class="lead">
            Ticked means it travels with the page; unticked
            leaves external links exactly as they are.
          </p>
          <!--
            Fonts sit under Styles because that is where they come from.

            A webfont is named by an at-font-face rule, so embedding one means rewriting the CSS
            that points at it — which can only happen in a stylesheet being saved. Nested rather
            than merged, because the dependency is not absolute: a face declared in an inline
            style block travels whatever this row says, since that CSS is in the page already.
          -->
          <div class="choices" role="group" aria-labelledby="heo-export-what">
            ${this.#renderPlacement('style', 'Styles', survey)}
            ${this.#renderPlacement('font', 'Fonts', survey, { sub: true })}
            ${this.#renderPlacement('script', 'Scripts', survey)}
            ${this.#renderPlacement('image', 'Images', survey)}
          </div>
        </section>

        ${this.#renderDesignSystemScope()} ${this.#renderBlockLibrary()}
        ${this.#renderPackaging(offerArchive)} ${this.#renderNaming(shape)}

        ${limit
        ? html`<div class="access blocked">
              <span class="g">${icon('alert', 12)}</span>
              <p>
                ${limit} So a linked file cannot be folded in here, whatever is ticked. What is
                already written into the page travels with it as it always did — a page with its
                CSS and JS inline is self-contained already. Serving it, through the Vite plugin
                or any static server, makes the linked ones readable too.
              </p>
            </div>`
        : nothing}
        ${bundlePlan && !bundlePlan.patched
        ? html`<div class="access blocked">
              <span class="g">${icon('alert', 12)}</span>
              <p>
                The document is rebuilt from the page rather than patched, so quoting,
                self-closing tags and letter case are normalised throughout${bundlePlan.why[0]
            ? html` — ${bundlePlan.why[0]}`
            : ''}.
                Handing over the file this page was opened from keeps it as you wrote it.
              </p>
              <button
                class="btn sm"
                type="button"
                title="Pick the HTML file this page was opened from, so the export patches it instead"
                @click=${() => void this.editor.exportFromPickedFile()}
              >
                ${icon('upload', 12)} Use the original file
              </button>
            </div>`
        : nothing}

        <!--
          The list stays put while the next one builds.

          Swapping it for a progress line was four layouts per click and read as flashing.
          There is only one moment with nothing to show — the very first build — and after
          that a refresh is a dimmed list rather than an absent one.
        -->
        ${bundlePlan
        ? html`<div class=${`plan${refreshing ? ' refreshing' : ''}`} aria-busy=${refreshing}>
              ${this.#renderBundlePlan(bundlePlan)}
            </div>`
        : html`<div class="empty">
              ${bundling
            ? "Reading the page's files…"
            : shape === 'single'
              ? 'One file, once it has been built.'
              : 'The files, once they have been built.'}
            </div>`}
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
        <div class="actions">
          <button
            class="btn"
            type="button"
            title="Read the page's files again and rebuild the list"
            ?disabled=${bundling}
            @click=${() => void this.editor.previewBundle()}
          >
            ${icon('refresh', 12)} Recheck
          </button>
          ${this.#renderPrimary(shape)}
        </div>
      </footer>
    `;
  }

  /**
   * How what was saved is carried: one file, or a folder of them.
   *
   * Absent entirely when there is nothing to carry. With every kind unticked, or with none of
   * the ticked ones readable from here, both answers produce the same single HTML file — so
   * the question is not asked, and the archive, which is the half that can be wrong, is never
   * offered without something to put in it.
   *
   * Radios rather than a checkbox because these are alternatives, and large enough to read
   * because the difference between them is the difference between a file that opens anywhere
   * and a file that needs its folder.
   */
  #renderPackaging(offer: boolean): TemplateResult | typeof nothing {
    if (!offer) return nothing;
    const chosen = this.state.value.bundleOptions.packaging;

    const option = (
      value: 'single' | 'archive',
      glyph: string,
      name: string,
      detail: string,
    ): TemplateResult => html`
      <label class=${`package${chosen === value ? ' on' : ''}`}>
        <input
          type="radio"
          name="heo-packaging"
          value=${value}
          .checked=${chosen === value}
          @change=${() => this.editor.setBundleOptions({ packaging: value })}
        />
        <span class="body">
          <span class="name">${icon(glyph, 12)} ${name}</span>
          <span class="detail">${detail}</span>
        </span>
      </label>
    `;

    return html`
      <section class="pick">
        <h3 id="heo-export-how">Choose how to package it</h3>
        <div class="packages" role="radiogroup" aria-labelledby="heo-export-how">
          ${option(
      'single',
      'code',
      'One self-contained HTML file',
      'Everything the page needs is folded into the HTML, so it opens anywhere — from a ' +
      'download, an email attachment, a USB stick. Assets become data URIs, which costs ' +
      'about a third in size.',
    )}
          ${option(
      'archive',
      'folder',
      'A folder of files, as a .zip',
      'The page keeps its references, and the files they point at travel with it at the ' +
      'paths it already uses. Unzip it and the structure is the one you had.',
    )}
        </div>
      </section>
    `;
  }

  /**
   * What the file is called, and where it lands.
   *
   * The name is editable and the extension is not. The extension follows the shape — one
   * file is `.html`, files beside it can only travel as `.zip` — so offering it as text
   * would be offering someone the chance to name an archive `.html` and produce a file that
   * does not open. Shown rather than hidden, because the whole point of this step is that
   * nothing about the download is a surprise.
   *
   * Where it goes is a browser capability, not a preference, so the control only appears
   * where there is a choice to make. Chrome and Edge can ask; Firefox and Safari cannot, and
   * a switch that did nothing there would be worse than the plain sentence saying so.
   */
  #renderNaming(shape: 'single' | 'archive'): TemplateResult {
    const { exportName, exportPrompt } = this.state.value;
    const picker = this.editor.exportPickerAvailable();

    return html`
      <section class="pick">
        <h3 id="heo-export-where">Choose where to save it</h3>
        <div class="naming">
        <div class="row">
          <span class="field-label" id="heo-export-name-label">Name</span>
          <input
            type="text"
            .value=${exportName ?? ''}
            placeholder=${this.editor.exportDefaultName}
            aria-labelledby="heo-export-name-label"
            spellcheck="false"
            autocomplete="off"
            @input=${(event: Event) =>
        this.editor.setExportName((event.target as HTMLInputElement).value)}
          />
          <span class="ext">${shape === 'single' ? '.html' : '.zip'}</span>
        </div>

        ${picker
        ? html`<label class="to">
              <input
                type="checkbox"
                .checked=${exportPrompt}
                @change=${(event: Event) =>
            this.editor.setExportPrompt((event.target as HTMLInputElement).checked)}
              />
              <span>
                ${exportPrompt
            ? 'Ask where to put it. The folder you pick is remembered for next time.'
            : 'Send it straight to your downloads folder without asking.'}
              </span>
            </label>`
        : html`<span class="to">
              This browser cannot ask where to put a file, so it goes wherever downloads go.
              Chrome and Edge can offer the folder.
            </span>`}
        </div>
      </section>
    `;
  }

  /**
   * One category's inline-or-external choice.
   *
   * A checkbox rather than a pair of radios, because there is a default worth stating:
   * ticked means "bring it with me", which is what someone asking for a self-contained file
   * wants and the only thing that produces one. Unticking is the deliberate act.
   *
   * A category with nothing in it is shown and disabled rather than hidden. A page with no
   * scripts should say so — a missing row reads as an oversight, and the absence is
   * information about the page.
   *
   * The box shows the choice, and being disabled says the choice cannot be changed here.
   * Those are two different facts and it used to conflate them, clearing the box whenever it
   * disabled it — so a page whose assets could not be read reported "styles: not folded in"
   * while the export it produced had every inline block in place. What the row counts is
   * only what a choice can act on, which is the *external* references; anything already
   * written into the page travels regardless, and now says so.
   */
  #renderPlacement(
    kind: AssetKind,
    label: string,
    survey: BundleSurvey,
    shape: { sub?: boolean } = {},
  ): TemplateResult {
    const category = survey.categories.find((entry) => entry.kind === kind);
    const embedded = category?.embedded ?? 0;
    /*
     * What the build actually did, in preference to what the survey guessed.
     *
     * The survey resolves URLs without reading them, so it is wrong in two directions. It is
     * optimistic about whether a local file can be had — see `assetReach` — and it is blind
     * to anything a *linked* stylesheet refers to, because that text has to be fetched
     * before its `url()`s exist. A page with a dozen fonts in its CSS surveys as having
     * none, so counting from the survey put "no fonts in this page" above an export that
     * embedded twelve.
     *
     * Once a plan exists it has attempted every one of them: `placed` is what worked and
     * `omitted` is what did not, and together they are the count. Before then the guess is
     * all there is, which is fine — opening this step builds a plan straight away.
     */
    const plan = this.state.value.bundlePlan;
    const options = this.state.value.bundleOptions;
    const key = PLACEMENT_KEYS[kind];
    const saving = options[key];
    const archived = options.packaging === 'archive';
    /*
     * How many the page has comes from `found`, not from `placed`.
     *
     * `placed` is what travelled, which is a consequence of this very checkbox — so counting
     * from it let the row destroy the evidence for its own existence. Unticking a kind meant
     * nothing was carried, which read as "none in this page", which disabled the row, which
     * made it impossible to tick again. `found` is a fact about the page, so it holds still
     * across every choice, which is also why the row does not jump when one is made.
     *
     * Failures are only reported for a kind being saved. Nothing is attempted otherwise, so
     * there is nothing to have failed — and reading them off a plan built before the box was
     * unticked would put a stale warning under a row that is no longer trying.
     */
    const blocked = saving ? (plan?.omitted.filter((entry) => entry.kind === kind) ?? []) : [];
    const count = plan ? plan.found[kind] : (category?.count ?? 0);
    const readable = plan ? count - blocked.length : (category?.readable ?? 0);
    const reason = blocked[0]?.reason ?? (saving ? category?.reason : undefined);
    // Nothing to decide when there is nothing of this kind, or when none of it can be read.
    const settled = count === 0 || readable === 0;
    /*
     * Nothing found may mean nothing is there, or may mean nobody looked.
     *
     * An asset named only inside a linked stylesheet does not exist until that sheet has been
     * read, and a sheet that is not being saved is never read. So with Styles unticked, a page
     * whose every webfont lives in its CSS reported "none in this page" — which is not what
     * "we did not look" means, and left no clue that ticking Styles would reveal them.
     */
    const linkedStyles = plan ? plan.found.style : (survey.categories.find((e) => e.kind === 'style')?.count ?? 0);
    const hiddenByStyles =
      count === 0 &&
      embedded === 0 &&
      !options.styles &&
      linkedStyles > 0 &&
      (kind === 'font' || kind === 'image');

    /** What is already in the page, said the same way in every branch below. */
    const travels =
      embedded === 0
        ? ''
        : ` · ${embedded} already in the page${settled ? ', travelling either way' : ''}`;
    /*
     * Bytes rather than text, so folding them in means base64 and costs a third.
     *
     * Worth naming in the row rather than only in the lead-in: "folded into the HTML" says
     * nothing about size, and a font family encoded inline is where a small page turns into
     * a large one.
     */
    const binary = kind === 'image' || kind === 'font';

    /*
     * What saving this kind will actually do, which depends on the packaging.
     *
     * Said here rather than only in the packaging section because this is the row someone is
     * looking at when they decide. "Encoded as base64" in particular is where a small page
     * becomes a large one, and "folded into the HTML" says nothing about that.
     */
    const outcome = !saving
      ? 'left as links'
      : archived
        ? 'copied in beside the page'
        : binary
          ? 'encoded as base64'
          : 'folded into the HTML';

    return html`<label
      class=${`choice${settled ? ' settled' : ''}${shape.sub ? ' sub' : ''}`}
    >
      <input
        type="checkbox"
        .checked=${saving}
        ?disabled=${settled}
        @change=${(event: Event) =>
        this.editor.setBundleOptions({ [key]: (event.target as HTMLInputElement).checked })}
      />
      <span class="text">
        <span class="name">${label}</span>
        <span class="detail">
          ${hiddenByStyles
        ? html`named inside your stylesheets, which are not being saved`
        : count === 0
          ? embedded === 0
            ? html`none in this page`
            : html`nothing linked · ${embedded} already in the page`
          : readable === 0
            ? html`${count} linked, none readable from here${travels}`
            : html`${readable} ${outcome}${count > readable
              ? html` · ${count - readable} cannot be read`
              : ''}${travels}`}
        </span>
        ${hiddenByStyles
        ? html`<span class="why">
              Tick Styles to bring them in — a face is named by a rule, so it can only travel
              inside a stylesheet that travels.
            </span>`
        : reason && readable < count
          ? html`<span class="why">${reason}</span>`
          : nothing}
      </span>
    </label>`;
  }

  /**
   * The files the export will contain.
   *
   * Same job as `#renderPlan` does for a project write, and the same reason for existing:
   * the download is about to become someone's copy of this page, and naming what is in it
   * beforehand is the difference between a save and a surprise.
   */
  #renderBundlePlan(plan: BundlePlan): TemplateResult {
    return html`
      ${plan.files.map(
      (file) => html`<div class="write">
          <span class="glyph">${icon(BUNDLE_GLYPH[file.kind], 13)}</span>
          <span class="detail">
            <span class="path">${file.path}</span>
            <span class="why">
              ${file.kind === 'document'
          ? plan.patched
            ? 'your file, with this session patched into it'
            : `rebuilt from the page${plan.why[0] ? ` — ${plan.why[0]}` : ''}`
          : `${BUNDLE_NOUN[file.kind]}, kept beside the page`}
            </span>
          </span>
          <span class="size">${bytes(file.bytes.length)}</span>
        </div>`,
    )}
      ${plan.omitted.length
        ? html`<div class="stranded">
            <h3>${icon('alert', 12)} Stayed as references</h3>
            <ul>
              ${plan.omitted.map(
          (entry) => html`<li>
                  <code>${entry.label}</code>
                  <span class="tag">${entry.kind}</span>
                  — ${entry.reason}
                </li>`,
        )}
            </ul>
          </div>`
        : nothing}
    `;
  }

  /**
   * Show the export step, building the plan on the way in.
   *
   * The name is seeded with the page's own, so the field arrives filled in rather than empty
   * behind a placeholder. Almost every save is a copy of this page under this name, and
   * retyping it is work the step can do. Seeded into state rather than painted into the input,
   * because a value that only looks present cannot be selected, and one restored by the next
   * render fights anyone trying to clear it.
   */
  #openExport(): void {
    this.view = 'export';
    if (this.state.value.exportName === null) {
      this.editor.setExportName(this.editor.exportDefaultName);
    }
    if (!this.state.value.bundlePlan) void this.editor.previewBundle();
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
        <div class="actions">${this.#renderPrimary()}</div>
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
        <div class="actions">
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
          <!--
            The way to a standalone copy, wherever it is not already the primary.

            It used to download immediately with no say in what went into it. Now it leads to
            the same step the primary leads to when there is no folder route, so there is one
            place that answers "what goes in the file and where does it land" rather than two
            behaviours behind similar-looking buttons.
          -->
          ${this.canPickFolder || this.state.value.project
        ? html`<button
              class="btn"
              type="button"
              title="Write a copy of this page as HTML, with your edits in it. The original file is patched where it can be read, so only the lines you changed change."
              @click=${() => this.#openExport()}
            >
              ${icon('code', 12)} Save as HTML ${icon('chevronRight', 11)}
            </button>`
        : nothing}
          <button class="btn" type="button" @click=${() => void this.editor.copyPrompt()}>
            ${icon('copy', 12)} Copy prompt
          </button>
          ${this.#renderFilesEntry()}
          ${this.#renderPrimary()}
        </div>
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
      /*
       * Connected: name the folder, and put the way back out in the slot the way in
       * was in.
       *
       * Disconnecting used to live one step deeper, in the Files footer, which meant
       * the only route to it was to open a review of the files you had just decided not
       * to write. A connection is made from here, so it is unmade from here. The label
       * still says where the files are going, because that is the fact the button is
       * about — and the primary button beside it already leads to the Files step, so
       * this slot does not have to.
       */
      return html`
        <span class="where" title=${`Connected to ${project.label}`}>
          ${icon(project.kind === 'server' ? 'server' : 'folder', 11)}
          <code>${project.label}</code>
        </span>
        ${this.#renderDisconnect()}
      `;
    }

    /*
     * Unconnected, the offer is the primary button rather than this slot.
     *
     * Connecting a folder is the thing most people want and it used to sit in a secondary
     * position because saving a copy always works and this does not. Promoting it left nothing
     * for this slot to hold, and a second button doing the same thing beside it would be worse
     * than an empty one.
     */
    return nothing;
  }

  /**
   * Hand the folder back, drawn the same in both footers.
   *
   * Leaving the Files step on the way out is part of the action rather than a courtesy:
   * that step is a list of files in a project, and without the project there is no list
   * — staying there would leave the user looking at "could not read the project files"
   * as though something had gone wrong.
   */
  #renderDisconnect(): TemplateResult | typeof nothing {
    const project = this.state.value.project;
    if (!project) return nothing;

    return html`<button
      class="btn"
      type="button"
      title=${`Hand ${project.label} back. Saving goes back to producing a prompt.`}
      @click=${() => {
        this.view = 'review';
        void this.editor.disconnectProject();
      }}
    >
      ${icon('unlink', 12)} Disconnect
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

/** One glyph per kind of file the export produces. */
const BUNDLE_GLYPH: Record<BundleFile['kind'], string> = {
  document: 'code',
  style: 'droplet',
  script: 'play',
  image: 'image',
  font: 'text',
};

/** What to call each kind in a sentence about one file. */
const BUNDLE_NOUN: Record<AssetKind, string> = {
  style: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
};

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
