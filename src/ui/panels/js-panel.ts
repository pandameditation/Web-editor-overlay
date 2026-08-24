import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { copyToClipboard } from '../../core/design-system.js';
import {
  collectScriptSources,
  fetchScriptSource,
  readScriptSource,
  runScriptSource,
  writeScriptSource,
  type ScriptSource,
} from '../../core/scripts.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import type { HeoCodeEditor } from '../controls/code-editor.js';
import '../controls/code-editor.js';

/**
 * The script editor.
 *
 * Deliberately shaped like the CSS panel — sources on top, one buffer below — because
 * they answer the same question about different material, and a second layout would
 * make the pair feel like two products.
 *
 * What differs is what "apply" can mean. CSS is live, so applying it changes the page.
 * A script has already run: its functions and listeners are in memory and no edit to a
 * `<script>` element reaches them. Applying therefore updates the source and records
 * the change — which is the product's whole output — and running it again is a
 * separate button that says what it will cost.
 */
@customElement('heo-js-panel')
export class HeoJsPanel extends HeoElement {
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
      .files {
        display: grid;
        gap: 3px;
        max-height: 168px;
        overflow-y: auto;
      }
      .file {
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
      .file:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .file[aria-selected='true'] {
        background: var(--heo-accent-soft);
        border-color: var(--heo-accent-line);
        color: var(--heo-text);
      }
      .file .g {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
      }
      .file[aria-selected='true'] .g {
        color: var(--heo-accent);
      }
      .file .name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        font-family: var(--heo-mono);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .file .count {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 9.5px;
      }
      .file .locked {
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
        line-height: 1.5;
        overflow-wrap: anywhere;
      }
      .note {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        padding: 9px 10px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        color: var(--heo-text-dim);
        font-size: 11px;
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
      .foot {
        display: flex;
        align-items: center;
        gap: 7px;
        flex: 0 0 auto;
        padding: 9px 12px;
        border-top: 1px solid var(--heo-line);
      }
      .foot .spacer {
        flex: 1 1 auto;
      }
      .empty {
        padding: 18px 14px;
        color: var(--heo-text-faint);
        font-size: 11.5px;
        line-height: 1.6;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.revision, s.changeCount] as const,
    shallowArrayEquals,
  );

  /**
   * True for the copy hosted inside the fullscreen code view.
   *
   * That copy is already as large as it gets, so it drops the expand affordance; the
   * one in the dock keeps it, since that is how the view is opened.
   */
  @property({ type: Boolean }) embedded = false;

  @state() private selectedId = '';
  @state() private draft = '';
  @state() private dirty = false;
  @state() private error = '';
  /** A fetch in flight, so the pane can say so rather than looking empty. */
  @state() private loading = false;

  /** The source the buffer was loaded from, so a re-render cannot clobber an edit. */
  #loadedId: string | null = null;
  /** History depth straight after applying, so Revert can offer to take it back. */
  #appliedAt: number | null = null;

  @query('heo-code-editor') private codeEditor?: HeoCodeEditor;

  override render(): TemplateResult {
    const sources = collectScriptSources();
    if (!sources.length) {
      return html`<div class="empty">
        This page has no scripts of its own. Anything the overlay loaded is excluded, since editing
        the editor from inside itself is not a useful thing to be offered.
      </div>`;
    }
    const current = sources.find((source) => source.id === this.selectedId) ?? sources[0];
    this.#syncBuffer(current);
    return html`
      <div class="top">
        <div class="meta">
          <span class="chip">
            ${icon('code', 11)} ${sources.length} ${sources.length === 1 ? 'script' : 'scripts'}
          </span>
          ${this.dirty
        ? html`<span class="chip" style="color:var(--heo-warn)">unapplied</span>`
        : nothing}
          <span class="spacer"></span>
          <button
            class="btn icon ghost sm"
            type="button"
            title="Copy this script"
            aria-label="Copy this script"
            @click=${this.#copy}
          >
            ${icon('copy', 12)}
          </button>
        </div>
        <div class="files" role="listbox" aria-label="Scripts">
          ${repeat(sources, (source) => source.id, (source) => this.#renderRow(source, current))}
        </div>
      </div>
      <div class="body">${this.#renderSource(current)}</div>
      <div class="foot">
        ${this.#renderRevert(current)}
        <span class="spacer"></span>
        ${current.readOnly || current.remote
        ? nothing
        : html`<button
              class="btn"
              type="button"
              title="Execute this source again. Anything it declares or attaches happens a second time."
              ?disabled=${Boolean(this.error)}
              @click=${() => this.#run(current)}
            >
              ${icon('play', 12)} Run
            </button>`}
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

  #renderRow(source: ScriptSource, current: ScriptSource): TemplateResult {
    return html`<button
      class="file"
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
      ${source.type ? html`<span class="count">${source.type}</span>` : nothing}
      ${source.loading ? html`<span class="count">${source.loading}</span>` : nothing}
      ${source.lines ? html`<span class="count">${source.lines} lines</span>` : nothing}
      ${source.readOnly
        ? html`<span class="locked" title=${source.readOnly}>${icon('lock', 11)}</span>`
        : nothing}
    </button>`;
  }

  #renderSource(source: ScriptSource): TemplateResult {
    if (source.readOnly) {
      return html`
        ${source.href ? html`<p class="where">${source.href}</p>` : nothing}
        <div class="note">
          <span class="g">${icon('lock', 12)}</span>
          <span>${source.readOnly}</span>
        </div>
      `;
    }
    return html`
      ${source.href
        ? html`<p class="where">
            ${source.href}${this.loading ? ' — loading…' : ''}
          </p>`
        : nothing}
      <!--
        The honest note. Editing a script that has already run cannot change what is on
        screen, and saying so up front is the difference between a tool that looks
        broken and one the user understands.
      -->
      <div class="note">
        <span class="g">${icon('sparkle', 12)}</span>
        <span>
          ${source.remote
        ? html`This file is not writable from the page. Applying records the change and the
              save prompt names the file, so it can be made in source.`
        : html`This script has already run, so applying updates its source and records the
              change — it does not re-execute. <strong>Run</strong> does that, deliberately.`}
        </span>
      </div>
      <heo-code-editor
        fill
        .expandable=${!this.embedded}
        expandTarget=${this.embedded ? '' : 'js'}
        @code-expand=${() => this.editor.openCodeWorkspace('js')}
                language="js"
        rows="16"
        heading=${`JS · ${source.label}`}
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
   * With unapplied edits it discards them and reloads. Straight after applying there is
   * nothing to discard, but the change is still the most recent thing that happened, so
   * the button undoes it. The offer lapses once anything else is committed, since
   * undoing then would take back somebody else's change.
   */
  #renderRevert(source: ScriptSource): TemplateResult {
    const canUndoApply =
      !this.dirty && this.#appliedAt !== null && this.editor.history.size === this.#appliedAt;
    return html`<button
      class="btn"
      type="button"
      ?disabled=${!this.dirty && !canUndoApply}
      title=${this.dirty ? 'Discard these edits and reload the script' : 'Undo the edit you just applied'}
      @click=${() => {
        if (this.dirty) this.#reset(source);
        else this.#undoApply(source);
      }}
    >
      ${icon('undo', 12)} ${this.dirty ? 'Revert' : 'Undo apply'}
    </button>`;
  }

  #undoApply(source: ScriptSource): void {
    this.#appliedAt = null;
    this.editor.undo();
    this.#loadedId = null;
    this.dirty = false;
    this.#syncBuffer(source);
    this.#refocus();
  }

  #refocus(): void {
    requestAnimationFrame(() => this.codeEditor?.focusEditor());
  }

  /** Load the buffer when the selection changes, but never mid-edit. */
  #syncBuffer(source: ScriptSource): void {
    if (this.#loadedId === source.id) return;
    this.#loadedId = source.id;
    this.error = '';
    this.dirty = false;
    if (!source.remote || source.readOnly) {
      this.draft = readScriptSource(source);
      this.loading = false;
      return;
    }
    // An external file has to be fetched. Blank the buffer first so the previous
    // script's text is never shown under this one's name.
    this.draft = '';
    this.loading = true;
    void fetchScriptSource(source)
      .then((text) => {
        // Only if the user is still looking at this source, and has not started typing.
        if (this.#loadedId !== source.id || this.dirty) return;
        this.draft = text;
        source.pendingBefore = text;
        this.loading = false;
      })
      .catch((error: unknown) => {
        if (this.#loadedId !== source.id) return;
        this.loading = false;
        this.error = `Could not read ${source.label}: ${
          error instanceof Error ? error.message : String(error)
        }`;
      });
  }

  #onInput(value: string): void {
    this.draft = value;
    this.dirty = true;
    this.error = syntaxErrorIn(value);
  }

  #apply(source: ScriptSource): void {
    if (source.readOnly) return;
    const command = writeScriptSource(source, this.draft);
    if (!command) {
      this.dirty = false;
      return;
    }
    this.editor.history.commit(command);
    this.dirty = false;
    this.#loadedId = null;
    this.#appliedAt = this.editor.history.size;
    this.#refocus();
    this.editor.notify(
      source.remote
        ? `Recorded the change to ${source.label}.`
        : `Applied ${source.label}. Run it to execute the new source.`,
      'success',
      { label: 'Undo', run: () => this.editor.undo() },
    );
  }

  #run(source: ScriptSource): void {
    const failure = runScriptSource(source, this.draft);
    if (failure) {
      this.error = failure;
      this.editor.notify(`${source.label} threw: ${failure}`, 'error');
      return;
    }
    this.editor.notify(`Ran ${source.label}.`, 'success');
  }

  #reset(source: ScriptSource): void {
    this.#loadedId = null;
    this.#syncBuffer(source);
    this.#refocus();
  }

  async #copy(): Promise<void> {
    const ok = await copyToClipboard(this.draft);
    this.editor.notify(
      ok ? 'Script copied.' : 'Could not access the clipboard.',
      ok ? 'success' : 'error',
    );
  }
}

/**
 * Check the source the way the engine will.
 *
 * `new Function` parses without running, so this is the browser's own verdict rather
 * than a guess — and it catches the typo before Apply records it. A module is not
 * parseable this way (`import` is illegal in a function body), so those are left
 * alone rather than reported as broken.
 */
function syntaxErrorIn(code: string): string {
  const text = code.trim();
  if (!text) return '';
  if (/^\s*(import|export)\b/m.test(text)) return '';
  try {
    new Function(text);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function glyphFor(source: ScriptSource): string {
  switch (source.kind) {
    case 'external':
    case 'module':
      return 'link';
    case 'json':
      return 'blocks';
    default:
      return 'code';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-js-panel': HeoJsPanel;
  }
}
