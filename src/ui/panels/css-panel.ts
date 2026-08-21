import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { copyToClipboard } from '../../core/design-system.js';
import {
  collectStyleSources,
  countRules,
  readStyleSource,
  writeStyleSource,
  type StyleSource,
} from '../../core/sheets.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
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

      .body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 10px 12px;
      }
      .where {
        margin: 0 0 8px;
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
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.revision, s.registry] as const,
    shallowArrayEquals,
  );

  @state() private selectedId: string | null = null;
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
    const sources = collectStyleSources();
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
        ${this.draft
          ? html`<heo-code-editor
              style="margin-top:10px"
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
            ${source.href} — edits preview live here; the save prompt names this file so the change
            can be made in source.
          </p>`
        : nothing}
      <heo-code-editor
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

  /** Load the buffer when the selection changes, but never mid-edit. */
  #syncBuffer(source: StyleSource): void {
    if (this.#loadedId === source.id) return;
    this.#loadedId = source.id;
    this.draft = readStyleSource(source);
    this.dirty = false;
    this.error = '';
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
    this.#loadedId = null;
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
