import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { copyToClipboard } from '../../core/design-system.js';
import {
  collectStyleSources,
  countRules,
  fetchStyleSource,
  readStyleSource,
  rememberStyleText,
  writeStyleSource,
  type StyleSource,
} from '../../core/sheets.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { canOfferFolder, fileAccessStyles, renderFileAccess } from './file-access.js';
import type { HeoCodeEditor } from '../controls/code-editor.js';
import '../controls/code-editor.js';

/**
 * The stylesheet editor.
 *
 * The Styles panel is element-first: it answers what applies here and lets it be
 * overridden. This is the other half — the CSS itself, by file, so a fix can land
 * in the rule that every element shares instead of as one more inline override on
 * one of them.
 *
 * Editing writes through the CSSOM, since a page cannot write to a file. The
 * preview is faithful and undoable, and the change record carries the file name so
 * the save prompt tells an agent exactly which file to open. Sheets that cannot be
 * touched — cross-origin, or owned by the editor's own registries — say so rather
 * than silently failing.
 */
@customElement('heo-css-panel')
export class HeoCssPanel extends HeoElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .top {
        display: grid;
        gap: 7px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
      }
      .meta .spacer {
        flex: 1 1 auto;
      }

      .sheets {
        display: grid;
        gap: 3px;
        max-height: 168px;
        overflow-y: auto;
      }
      .sheet {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        padding: 5px 7px;
        border: 1px solid transparent;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text-dim);
        text-align: left;
        cursor: pointer;
      }
      .sheet:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .sheet[aria-selected='true'] {
        background: var(--heo-accent-soft);
        border-color: var(--heo-accent-line);
        color: var(--heo-text);
      }
      .sheet .g {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
      }
      .sheet[aria-selected='true'] .g {
        color: var(--heo-accent);
      }
      .sheet .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        font-family: var(--heo-mono);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sheet .count {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 9.5px;
      }
      .sheet .locked {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
      }

      /* A column, not a scroller: the editor inside does its own scrolling, and the
         action row below stays put. Two scrollbars for one document was the problem. */
      .body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1 1 auto;
        min-height: 0;
        padding: 10px 12px;
      }
      /* The fixed matter above the buffer — a path, a note — keeps its own height. */
      .body > .where,
      .body > .note {
        flex: 0 0 auto;
      }
      .body > heo-code-editor {
        flex: 1 1 auto;
        min-height: 0;
      }
      .where {
        margin: 0;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        overflow-wrap: anywhere;
        -webkit-user-select: text;
        user-select: text;
      }
      .note {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        padding: 9px 10px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .note .g {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
      }

      .foot {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 12px;
        border-top: 1px solid var(--heo-line);
      }
      .foot .spacer {
        flex: 1 1 auto;
      }
    `,
    fileAccessStyles,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    // `project` is in here because connecting a folder changes which sheets are
    // readable: a file the browser refused becomes editable the moment its folder is
    // handed over, and the list has to redraw to say so.
    (s) => [s.revision, s.registry, s.project] as const,
    shallowArrayEquals,
  );

  @state() private selectedId: string | null = null;
  /** Whether this browser can offer a folder, for the unreadable-file notice. */
  @state() private canPickFolder = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void canOfferFolder(this.editor).then((can) => {
      this.canPickFolder = can;
    });
  }
  /**
   * True for the copy hosted inside the fullscreen code view.
   *
   * That copy is already as large as it gets, so it drops the expand affordance; the
   * one in the dock keeps it, since that is how the view is opened.
   */
  @property({ type: Boolean }) embedded = false;

  @state() private draft = '';
  @state() private dirty = false;
  @state() private error = '';
  /** Which source the buffer belongs to, so switching sheets reloads it. */
  #loadedId: string | null = null;
  /**
   * Undo depth right after this panel applied something.
   *
   * Lets Revert offer to take that apply back, and stop offering once anything else
   * has been committed on top of it.
   */
  #appliedAt: number | null = null;

  @query('heo-code-editor') private codeEditor?: HeoCodeEditor;

  override render(): TemplateResult {
    const sources = collectStyleSources(this.editor.project);
    if (!sources.length) {
      return html`<div class="empty">This page has no stylesheets the editor can see.</div>`;
    }

    const current = sources.find((source) => source.id === this.selectedId) ?? sources[0];
    this.#syncBuffer(current);

    return html`
      <div class="top">
        <div class="meta">
          <span class="chip">
            ${icon('styles', 11)} ${sources.length}
            ${sources.length === 1 ? 'stylesheet' : 'stylesheets'}
          </span>
          ${this.dirty ? html`<span class="chip" style="color:var(--heo-warn)">unapplied</span>` : nothing}
          <span class="spacer"></span>
          <button
            class="btn icon ghost sm"
            type="button"
            title="Copy this stylesheet"
            aria-label="Copy this stylesheet"
            @click=${this.#copy}
          >
            ${icon('copy', 12)}
          </button>
        </div>
        <div class="sheets" role="listbox" aria-label="Stylesheets">
          ${repeat(sources, (source) => source.id, (source) => this.#renderRow(source, current))}
        </div>
      </div>

      <div class="body">${this.#renderSource(current)}</div>

      <div class="foot">
        ${this.#renderRevert(current)}
        <span class="spacer"></span>
        <button
          class="btn primary"
          type="button"
          ?disabled=${!this.dirty || Boolean(current.readOnly) || Boolean(this.error)}
          @click=${() => this.#apply(current)}
        >
          ${icon('check', 12)} Apply
        </button>
      </div>
    `;
  }

  #renderRow(source: StyleSource, current: StyleSource): TemplateResult {
    return html`<button
      class="sheet"
      type="button"
      role="option"
      aria-selected=${source.id === current.id}
      title=${source.href ?? source.label}
      @click=${() => {
        this.selectedId = source.id;
      }}
    >
      <span class="g">${icon(glyphFor(source), 12)}</span>
      <span class="name">${source.label}</span>
      ${source.media ? html`<span class="count">${source.media}</span>` : nothing}
      <span class="count">${source.rules} rules</span>
      ${source.readOnly
        ? html`<span class="locked" title=${source.readOnly}>${icon('lock', 11)}</span>`
        : nothing}
    </button>`;
  }

  #renderSource(source: StyleSource): TemplateResult {
    if (source.readOnly) {
      return html`
        ${source.href ? html`<p class="where">${source.href}</p>` : nothing}
        <div class="note">
          <span class="g">${icon('lock', 12)}</span>
          <span>${source.readOnly}</span>
        </div>
        ${source.href
          ? renderFileAccess(
            {
              engine: this.editor,
              what: 'stylesheet',
              reason: source.readOnly,
              // The sheet is readable now, so drop the buffer and let it reload.
              onConnected: () => {
                this.#loadedId = null;
              },
            },
            this.canPickFolder,
          )
          : nothing}
        ${this.draft
          ? html`<heo-code-editor
              fill
        .expandable=${!this.embedded}
        expandTarget=${this.embedded ? '' : 'css'}
        @code-expand=${() => this.editor.openCodeWorkspace('css')}
                            language="css"
              rows="14"
              heading=${`CSS · ${source.label} (read only)`}
              .value=${this.draft}
              .showStatus=${true}
            ></heo-code-editor>`
          : nothing}
      `;
    }

    return html`
      ${source.href
        ? html`<p class="where">
            ${source.path
            ? html`${source.path} — read from ${this.state.value.project?.label}, and written
                back there when you save.`
            : html`${source.href} — edits preview live here; the save prompt names this file so
                the change can be made in source.`}
          </p>`
        : nothing}
      <!--
        The one case a connected folder creates: editable, but not previewable. The
        browser is withholding the CSSOM, which is what a live preview needs, while the
        file itself is perfectly readable from disk. Saying so is the difference between
        an editor that looks broken and one whose limits are understood.
      -->
      ${source.unpreviewable
        ? html`<div class="note">
            <span class="g">${icon('eye', 12)}</span>
            <span>${source.unpreviewable}</span>
          </div>`
        : nothing}
      <heo-code-editor
        fill
        .expandable=${!this.embedded}
        expandTarget=${this.embedded ? '' : 'css'}
        @code-expand=${() => this.editor.openCodeWorkspace('css')}
        language="css"
        rows="16"
        heading=${`CSS · ${source.label}`}
        .value=${this.draft}
        .error=${this.error}
        @code-input=${(event: CustomEvent<{ value: string }>) => this.#onInput(event.detail.value)}
        @code-submit=${() => this.#apply(source)}
        @code-cancel=${() => this.#reset(source)}
      ></heo-code-editor>
    `;
  }

  /**
   * Revert, meaning whichever "put it back" is available.
   *
   * With unapplied edits it discards them and reloads from the sheet. Straight after
   * applying there is nothing to discard, but the change is still the most recent
   * thing that happened — so the button undoes it, which is what the user reaches for
   * when an apply turns out wrong. The offer lapses as soon as anything else is
   * committed, since undoing then would take back somebody else's change.
   */
  #renderRevert(source: StyleSource): TemplateResult {
    const canUndoApply =
      !this.dirty && this.#appliedAt !== null && this.editor.history.size === this.#appliedAt;
    return html`<button
      class="btn"
      type="button"
      ?disabled=${!this.dirty && !canUndoApply}
      title=${this.dirty
        ? 'Discard these edits and reload the stylesheet'
        : 'Undo the CSS you just applied'}
      @click=${() => {
        if (this.dirty) this.#reset(source);
        else this.#undoApply(source);
      }}
    >
      ${icon('undo', 12)} ${this.dirty ? 'Revert' : 'Undo apply'}
    </button>`;
  }

  #undoApply(source: StyleSource): void {
    this.#appliedAt = null;
    this.editor.undo();
    this.#loadedId = null;
    this.dirty = false;
    this.#syncBuffer(source);
    this.#refocus();
  }

  /** Put the caret back in the editor, after the render that follows an action. */
  #refocus(): void {
    requestAnimationFrame(() => this.codeEditor?.focusEditor());
  }

  /**
   * Load the buffer when the selection changes, but never mid-edit.
   *
   * The CSSOM's version of the sheet goes in immediately so the editor is never
   * blank, then the file's own text replaces it once it arrives. The two differ in
   * ways that matter here: the file has the author's comments, colour notation and
   * line breaks, and the CSSOM has none of them. Whatever is in this buffer becomes
   * the new contents of the file when applied, so it had better have started as the
   * file.
   */
  #syncBuffer(source: StyleSource): void {
    if (this.#loadedId === source.id) return;
    this.#loadedId = source.id;
    this.draft = readStyleSource(source);
    this.dirty = false;
    this.error = '';

    if (!source.href || source.readOnly) {
      source.pendingBefore = this.draft;
      return;
    }

    /*
     * Already known, so do not go back to disk for it.
     *
     * The remembered text is this sheet's text as it stands: read from the file when
     * the folder was connected, and replaced by whatever an Apply put there since.
     * Re-fetching would hand back the copy on disk, which after an unsaved edit is the
     * version *before* it — silently reverting the buffer to what the user had already
     * changed away from.
     */
    if (source.pendingBefore !== undefined) {
      this.draft = source.pendingBefore;
      return;
    }
    void fetchStyleSource(source, this.editor.project).then((text) => {
      // Kept where the next render can find it. A `StyleSource` is rebuilt from
      // scratch every render, so a field on this one is gone by the time an Apply
      // needs it — and for a sheet the CSSOM refuses, this text is also the only
      // thing the rule count can be taken from.
      rememberStyleText(source.id, text);
      // Only replace the buffer while the user is still looking at this sheet and has
      // not started typing: doing it under a caret loses work.
      if (this.#loadedId !== source.id || this.dirty) return;
      source.pendingBefore = text;
      this.draft = text;
    });
  }

  #onInput(value: string): void {
    this.draft = value;
    this.dirty = true;
    // Parsed by the browser itself, so the check is exactly what the sheet will do.
    const text = value.trim();
    this.error = text && countRules(text) === 0 ? 'No rule in this text parses.' : '';
  }

  #apply(source: StyleSource): void {
    if (source.readOnly) return;
    const command = writeStyleSource(source, this.draft);
    if (!command) {
      this.dirty = false;
      return;
    }
    this.editor.history.commit(command);
    this.dirty = false;
    // The buffer is already exactly what was applied, so there is nothing to reload.
    // Dropping it here used to re-read the sheet, which for a file-backed one meant
    // fetching the pre-edit copy off disk and overwriting the edit that just landed.
    this.#appliedAt = this.editor.history.size;
    this.#refocus();
    this.editor.notify(`Applied ${source.label}.`, 'success', {
      label: 'Undo',
      run: () => this.editor.undo(),
    });
  }

  #reset(source: StyleSource): void {
    this.#loadedId = null;
    this.#syncBuffer(source);
    // After the render, not before: focusing first put the caret in the textarea, and
    // the editor then refused the reloaded buffer because it was focused.
    this.#refocus();
  }

  async #copy(): Promise<void> {
    const ok = await copyToClipboard(this.draft);
    this.editor.notify(ok ? 'CSS copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error');
  }
}

function glyphFor(source: StyleSource): string {
  switch (source.kind) {
    case 'link':
      return 'link';
    case 'style':
      return 'code';
    default:
      return 'blocks';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-css-panel': HeoCssPanel;
  }
}
