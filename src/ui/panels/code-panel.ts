import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { labelFor, nearestSourceRef } from '../../core/dom.js';
import { copyToClipboard } from '../../core/design-system.js';
import { formatHTML, sanitizeFragment } from '../../core/sanitize.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import type { HeoCodeEditor } from '../controls/code-editor.js';
import '../controls/code-editor.js';
import '../controls/segmented.js';

/**
 * The HTML editor.
 *
 * Editing markup by hand is the escape hatch for everything the panels do not
 * cover, so it has to be trustworthy. Three things make it so: the buffer is
 * validated as you type and reports exactly what is wrong, applying is explicit
 * rather than live, and the result goes through the same sanitiser as every other
 * insertion so a paste cannot smuggle in a script.
 *
 * Outer mode replaces the element, inner mode replaces its children — the
 * distinction matters when the element itself is what a framework owns.
 */
@customElement('heo-code-panel')
export class HeoCodePanel extends HeoElement {
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
      .src {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .body {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 10px 12px;
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
      .warn {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        margin-top: 9px;
        padding: 8px 9px;
        border: 1px solid color-mix(in oklab, var(--heo-warn) 40%, transparent);
        border-radius: var(--heo-r-sm);
        background: color-mix(in oklab, var(--heo-warn) 8%, transparent);
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .warn .g {
        color: var(--heo-warn);
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.revision] as const,
    shallowArrayEquals,
  );

  @state() private mode: 'outer' | 'inner' = 'outer';
  @state() private draft = '';
  @state() private error = '';
  @state() private dirty = false;
  @state() private stripped: string[] = [];
  /** Which element the buffer belongs to, so a new selection reloads it. */
  #loadedFor: HTMLElement | null = null;
  #loadedMode: 'outer' | 'inner' = 'outer';
  /** The raw markup the buffer was built from, to notice it changing underneath. */
  #loadedSource = '';
  /**
   * Undo depth right after this panel applied something.
   *
   * Lets Revert offer to take that apply back, and stop offering once anything else
   * has been committed on top of it.
   */
  #appliedAt: number | null = null;
  /** The element an apply replaced, so undoing it can put the selection back. */
  #appliedTo: HTMLElement | null = null;

  @query('heo-code-editor') private codeEditor?: HeoCodeEditor;

  /**
   * Load the buffer before rendering, not during it.
   *
   * Writing reactive state inside `render()` schedules a second update and means
   * the first frame is built from stale state. `willUpdate` is the hook for
   * deriving state from other state.
   */
  override willUpdate(): void {
    const el = this.editor.selected;
    if (!el || !el.isConnected) {
      this.#loadedFor = null;
      return;
    }
    this.#syncBuffer(el);
  }

  override render(): TemplateResult {
    const el = this.editor.selected;
    if (!el || !el.isConnected) {
      return html`<div class="empty">Select an element to edit its markup.</div>`;
    }
    const source = nearestSourceRef(el);

    return html`
      <div class="top">
        <div class="meta">
          <span class="chip">${icon('code', 11)} ${labelFor(el)}</span>
          ${this.dirty ? html`<span class="chip" style="color:var(--heo-warn)">unapplied</span>` : nothing}
          <span class="spacer"></span>
          <button
            class="btn icon ghost sm"
            type="button"
            title="Copy markup"
            aria-label="Copy markup"
            @click=${this.#copy}
          >
            ${icon('copy', 12)}
          </button>
          <button
            class="btn icon ghost sm"
            type="button"
            title="Reformat"
            aria-label="Reformat"
            @click=${this.#format}
          >
            ${icon('sparkle', 12)}
          </button>
        </div>
        <heo-segmented
          .options=${[
        { value: 'outer', label: 'Whole element' },
        { value: 'inner', label: 'Contents only' },
      ]}
          .value=${this.mode}
          label="Edit scope"
          @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.mode = (event.detail.value || 'outer') as 'outer' | 'inner';
        this.#loadedFor = null;
      }}
        ></heo-segmented>
        ${source
        ? html`<span class="src">${source.file}:${source.line}:${source.column}</span>`
        : nothing}
      </div>

      <div class="body">
        <heo-code-editor
          language="html"
          rows="16"
          heading=${`HTML · ${labelFor(el)} · ${this.mode === 'outer' ? 'whole element' : 'contents only'}`}
          .value=${this.draft}
          .error=${this.error}
          @code-input=${(event: CustomEvent<{ value: string }>) => this.#onInput(event.detail.value)}
          @code-submit=${() => this.#apply(el)}
          @code-cancel=${() => this.#reset(el)}
        ></heo-code-editor>

        ${this.stripped.length
        ? html`<div class="warn">
              <span class="g">${icon('lock', 12)}</span>
              <span>
                Removed on parse: ${this.stripped.join(', ')}. Scripts and inline event handlers
                cannot be added from here — add them in source instead.
              </span>
            </div>`
        : nothing}
      </div>

      <div class="foot">${this.#renderRevert(el)}
        <span class="spacer"></span>
        <button
          class="btn primary"
          type="button"
          ?disabled=${!this.dirty || Boolean(this.error)}
          @click=${() => this.#apply(el)}
        >
          ${icon('check', 12)} Apply
        </button>
      </div>
    `;
  }

  /**
   * Revert, meaning whichever "put it back" is available.
   *
   * Two states, one intent. With unapplied edits it discards them and reloads the
   * buffer from the DOM. Straight after applying there is nothing to discard, but the
   * change is still the most recent thing that happened — so the button undoes it,
   * which is what the user reaches for when an apply turns out wrong. Splitting these
   * into two controls would be truer to the machinery and worse to use.
   *
   * The undo offer lapses as soon as anything else is committed: undoing then would
   * take back somebody else's change.
   */
  #renderRevert(el: HTMLElement): TemplateResult {
    const canUndoApply =
      !this.dirty && this.#appliedAt !== null && this.editor.history.size === this.#appliedAt;
    return html`<button
      class="btn"
      type="button"
      ?disabled=${!this.dirty && !canUndoApply}
      title=${this.dirty
        ? 'Discard these edits and reload the markup'
        : 'Undo the markup you just applied'}
      @click=${() => {
        if (this.dirty) this.#reset(el);
        else this.#undoApply();
      }}
    >
      ${icon('undo', 12)} ${this.dirty ? 'Revert' : 'Undo apply'}
    </button>`;
  }

  #undoApply(): void {
    const target = this.#appliedTo;
    this.#appliedAt = null;
    this.#appliedTo = null;
    this.editor.undo();
    // Whole-element mode swaps the node out, so undoing puts a *different* object
    // back and the selection would otherwise be left pointing at the detached
    // replacement — which reads as the panel emptying itself.
    if (target?.isConnected) this.editor.select(target);
    this.#loadedFor = null;
    this.dirty = false;
    this.#refocus();
  }

  /** Put the caret back in the editor, after the render that follows an action. */
  #refocus(): void {
    requestAnimationFrame(() => this.codeEditor?.focusEditor());
  }

  /**
   * Reload the buffer when it no longer describes the element — but never mid-edit.
   *
   * Three triggers: a different element, a different scope, or the markup having
   * changed underneath. That third one matters more than it sounds: styling from the
   * Styles panel, a drag, an undo, all rewrite the element, and a buffer keyed only on
   * identity went on showing whatever it loaded the first time. Reverting then
   * "restored" markup that no longer existed.
   *
   * Unapplied edits still win — they are the one thing that cannot be recovered — and
   * the raw source is compared before reformatting, so an unchanged element costs a
   * string comparison rather than a re-pretty-print on every revision bump.
   */
  #syncBuffer(el: HTMLElement): void {
    const source = this.mode === 'outer' ? el.outerHTML : el.innerHTML;
    const sameTarget = this.#loadedFor === el && this.#loadedMode === this.mode;
    if (sameTarget && (this.dirty || source === this.#loadedSource)) return;
    this.#loadedFor = el;
    this.#loadedMode = this.mode;
    this.#loadedSource = source;
    this.draft = formatHTML(source);
    this.error = '';
    this.dirty = false;
    this.stripped = [];
  }

  #onInput(value: string): void {
    this.draft = value;
    this.dirty = true;
    this.#validate();
  }

  /**
   * Validate against the browser's own parser.
   *
   * Comparing the sanitised output to the input is also what surfaces silently
   * dropped content, so the user is told when a `<script>` or an `onclick` was
   * removed rather than wondering why it did not work.
   */
  #validate(): void {
    const text = this.draft.trim();
    this.stripped = [];
    if (!text) {
      this.error = this.mode === 'outer' ? 'The element markup cannot be empty.' : '';
      return;
    }

    const removed: string[] = [];
    if (/<script\b/i.test(text)) removed.push('<script> tags');
    if (/\son[a-z]+\s*=/i.test(text)) removed.push('inline event handlers');
    if (/(?:href|src)\s*=\s*["']?\s*javascript:/i.test(text)) removed.push('javascript: URLs');
    this.stripped = removed;

    if (this.mode === 'inner') {
      this.error = '';
      return;
    }

    const fragment = sanitizeFragment(text);
    const elements = Array.from(fragment.children);
    if (elements.length === 0) {
      this.error = 'No element found. The whole-element view needs a single root tag.';
      return;
    }
    if (elements.length > 1) {
      this.error = `Found ${elements.length} root elements. Wrap them in one, or switch to "Contents only".`;
      return;
    }
    this.error = '';
  }

  #apply(el: HTMLElement): void {
    this.#validate();
    if (this.error) return;

    if (this.mode === 'outer') {
      if (this.editor.replaceMarkup(this.draft, el)) {
        this.#loadedFor = null;
        this.dirty = false;
        // Remembered so Revert can offer to undo this, and only while it is still the
        // most recent change.
        this.#appliedAt = this.editor.history.size;
        this.#appliedTo = el;
        this.#refocus();
      }
      return;
    }

    const before = el.innerHTML;
    const holder = document.createElement('div');
    holder.append(sanitizeFragment(this.draft));
    const after = holder.innerHTML;
    if (after === before) {
      this.dirty = false;
      return;
    }
    this.editor.history.commit({
      label: `Edit contents of ${labelFor(el)}`,
      record: {
        id: `h${Date.now().toString(36)}`,
        kind: 'replace',
        summary: `Rewrite the contents of ${labelFor(el)}`,
        target: labelFor(el),
        source: nearestSourceRef(el),
        detail: { html: after },
        at: Date.now(),
      },
      apply: () => {
        el.innerHTML = after;
      },
      revert: () => {
        el.innerHTML = before;
      },
    });
    this.dirty = false;
    this.#loadedFor = null;
    this.#appliedAt = this.editor.history.size;
    this.#appliedTo = el;
    this.#refocus();
    this.editor.notify('Contents replaced.', 'success');
  }

  #reset(el: HTMLElement): void {
    this.#loadedFor = null;
    this.#syncBuffer(el);
    // After the render, not before: focusing first put the caret in the textarea, and
    // the editor then refused the reloaded buffer because it was focused.
    this.#refocus();
  }

  #format(): void {
    this.draft = formatHTML(this.draft.replace(/\n\s*/g, ''));
    this.dirty = true;
    this.#validate();
  }

  async #copy(): Promise<void> {
    const ok = await copyToClipboard(this.draft);
    this.editor.notify(ok ? 'Markup copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-code-panel': HeoCodePanel;
  }
}
