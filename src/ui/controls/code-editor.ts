import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { highlight, type CodeLanguage } from './highlight.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

/**
 * A compact code editor.
 *
 * A transparent `<textarea>` sits over a highlighted `<pre>`, which is the only
 * way to get syntax colour without reimplementing text editing and losing native
 * caret behaviour, IME support, spellcheck control and accessibility. The two
 * layers share identical typography and scroll position, so they stay aligned
 * character for character.
 *
 * Editing niceties are deliberately limited to the ones that matter when editing
 * markup: indent and outdent with Tab, indentation-preserving Enter, and
 * bracket-aware auto-indent after an opening tag.
 *
 * A dozen lines in a 340px panel is fine for a tweak and hopeless for real work,
 * so the editor can expand into a near-fullscreen modal. It is one editing
 * surface moved between two containers rather than two surfaces kept in sync,
 * because two textareas over one buffer means two carets and no answer to which
 * one a keystroke belongs to.
 *
 * Fires `code-input` on every keystroke and `code-submit` on Cmd/Ctrl+Enter.
 */
@customElement('heo-code-editor')
export class HeoCodeEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .frame {
        position: relative;
      }

      .shell {
        position: relative;
        display: grid;
        grid-template-columns: auto 1fr;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-sunken);
        overflow: hidden;
        transition: border-color var(--heo-fast);
      }
      .shell:focus-within {
        border-color: var(--heo-accent-line);
      }
      :host([data-invalid]) .shell {
        border-color: color-mix(in oklab, var(--heo-danger) 60%, transparent);
      }

      .gutter {
        padding: 9px 8px 9px 10px;
        border-right: 1px solid var(--heo-line);
        background: color-mix(in oklab, var(--heo-bg) 60%, transparent);
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 11px;
        line-height: 1.65;
        text-align: right;
        user-select: none;
        overflow: hidden;
        white-space: pre;
      }

      .area {
        position: relative;
        overflow: hidden;
      }

      /* Both layers must share every metric that affects glyph position. */
      pre,
      textarea {
        margin: 0;
        padding: 9px 11px;
        border: 0;
        font-family: var(--heo-mono);
        font-size: 11px;
        line-height: 1.65;
        tab-size: 2;
        white-space: pre;
        word-break: normal;
        overflow-wrap: normal;
      }

      /* The two layers are stacked absolutely inside a fixed-height area so the
         textarea is the single scroll container and the highlight layer is
         scrolled to match. Sizing the textarea independently, as this used to do,
         left the layers disagreeing about how tall the content was. */
      pre {
        position: absolute;
        inset: 0;
        overflow: hidden;
        color: var(--heo-text-dim);
        pointer-events: none;
      }

      textarea {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
        background: transparent;
        color: transparent;
        caret-color: var(--heo-text);
        resize: none;
        overflow: auto;
      }
      textarea:focus {
        outline: none;
      }
      textarea::selection {
        background: var(--heo-accent-soft);
      }

      /* Token colours. Tuned for the dark chrome, with light-mode overrides. */
      .t-tag {
        color: oklch(76% 0.14 20);
      }
      .t-attr {
        color: oklch(82% 0.11 95);
      }
      .t-value,
      .t-string {
        color: oklch(80% 0.13 150);
      }
      .t-comment {
        color: var(--heo-text-faint);
        font-style: italic;
      }
      .t-punct {
        color: var(--heo-text-faint);
      }
      .t-selector {
        color: oklch(80% 0.13 85);
      }
      .t-property {
        color: oklch(78% 0.12 250);
      }
      .t-keyword {
        color: oklch(76% 0.15 300);
      }
      .t-number {
        color: oklch(80% 0.12 60);
      }

      :host-context([data-theme='light']) .t-tag {
        color: oklch(52% 0.17 20);
      }
      :host-context([data-theme='light']) .t-attr {
        color: oklch(52% 0.13 60);
      }
      :host-context([data-theme='light']) .t-value,
      :host-context([data-theme='light']) .t-string {
        color: oklch(45% 0.13 150);
      }
      :host-context([data-theme='light']) .t-property {
        color: oklch(48% 0.15 265);
      }
      :host-context([data-theme='light']) .t-keyword {
        color: oklch(48% 0.18 300);
      }

      .status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 6px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .status .error {
        color: var(--heo-danger);
      }

      /* ---- Expand ---- */

      /* Floats over the top-right corner of the code, where it overlaps only the
         indentation of the first line. Visible enough to be discovered, quiet
         enough not to compete with the code, and full strength on hover or focus. */
      .grow {
        position: absolute;
        top: 5px;
        right: 5px;
        z-index: 2;
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 1px solid var(--heo-line);
        border-radius: 6px;
        background: var(--heo-raised);
        color: var(--heo-text-faint);
        cursor: pointer;
        opacity: 0.65;
        transition:
          opacity var(--heo-fast),
          color var(--heo-fast),
          background var(--heo-fast);
      }
      .grow:hover,
      .grow:focus-visible,
      .frame:hover .grow {
        opacity: 1;
        color: var(--heo-text);
        background: var(--heo-hover);
      }

      /* Holds the panel's layout while the editor is in the modal, so nothing
         reflows underneath it and the way back is where the editor used to be. */
      .stand-in {
        display: grid;
        place-items: center;
        gap: 8px;
        align-content: center;
        border: 1px dashed var(--heo-line-strong);
        border-radius: var(--heo-r-md);
        background: var(--heo-sunken);
        color: var(--heo-text-faint);
        font-size: 11px;
        text-align: center;
      }

      /* A dialog rather than a positioned div: the top layer is the only reliable
         way out of the dock, which clips its descendants and is their containing
         block, and showModal brings the focus trap and Escape handling with it. */
      dialog.modal {
        width: min(1180px, 94vw);
        height: 92vh;
        max-width: none;
        max-height: none;
        padding: 0;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-lg);
        background: var(--heo-bg);
        color: var(--heo-text);
        overflow: hidden;
      }
      dialog.modal::backdrop {
        background: oklch(12% 0.01 265 / 62%);
        backdrop-filter: blur(3px);
      }
      dialog.modal[open] {
        display: flex;
        flex-direction: column;
        animation: grow var(--heo-med);
      }
      @keyframes grow {
        from {
          opacity: 0;
          transform: scale(0.985);
        }
      }
      dialog.modal > header {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        padding: 11px 13px;
        border-bottom: 1px solid var(--heo-line);
      }
      dialog.modal > header .lang {
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      dialog.modal > header .spacer {
        flex: 1 1 auto;
      }
      dialog.modal > .pane {
        flex: 1 1 auto;
        min-height: 0;
        padding: 12px 13px;
      }
      dialog.modal > .pane .shell {
        height: 100%;
        border-radius: var(--heo-r-sm);
      }
      dialog.modal > .pane pre,
      dialog.modal > .pane textarea {
        font-size: 12.5px;
      }
      dialog.modal > footer {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        padding: 10px 13px;
        border-top: 1px solid var(--heo-line);
        color: var(--heo-text-faint);
        font-size: 11px;
      }
      dialog.modal > footer .spacer {
        flex: 1 1 auto;
      }
      dialog.modal > footer .error {
        color: var(--heo-danger);
      }
    `,
  ];

  @property({ type: String }) value = '';
  @property({ type: String }) language: CodeLanguage = 'html';
  @property({ type: Number }) rows = 12;
  @property({ type: String }) error = '';
  @property({ type: String }) placeholder = '';
  @property({ type: Boolean }) showStatus = true;
  /** Human name for the buffer, shown in the expanded view's title. */
  @property({ type: String }) heading = '';
  /** Set `expandable="false"` to drop the fullscreen affordance. */
  @property({ type: Boolean }) expandable = true;

  @state() private draft = '';
  @state() private expanded = false;

  @query('textarea') private area!: HTMLTextAreaElement;
  @query('pre') private pre!: HTMLPreElement;
  @query('.gutter') private gutter!: HTMLElement;

  /** Caret and scroll carried across the move between containers. */
  #carry: { start: number; end: number; scrollTop: number } | null = null;
  /** The last buffer this editor emitted, to tell an echo from an external change. */
  #lastEmitted = '';

  override willUpdate(changed: PropertyValues<this>): void {
    // Before the first render both `area` and `activeElement` are null, and
    // `null !== null` reads as "the textarea has focus" — which skipped the very
    // first sync and left the editor blank until some later update happened to
    // run. Ask the real question instead: is the textarea actually focused.
    //
    // Focus is a tie-breaker, not a veto. A value this editor did not produce came
    // from somewhere else and has to win: that is what Revert is — the host reloads
    // the buffer from the DOM and hands focus back, and the old rule made the two
    // cancel out, so the button moved the caret and changed nothing.
    const focused = this.area != null && this.shadowRoot?.activeElement === this.area;
    if (changed.has('value') && (!focused || this.value !== this.#lastEmitted)) {
      this.draft = this.value;
    }
    if (changed.has('error')) this.toggleAttribute('data-invalid', Boolean(this.error));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // A modal removed while open leaves the top layer and the page's inertness in
    // an inconsistent state, so close it on the way out. Clearing the flag as well
    // matters because Lit reuses instances: a reconnected editor would otherwise
    // re-open the modal from `updated()` without anyone asking.
    const dialog = this.renderRoot?.querySelector('dialog');
    if (dialog?.open) dialog.close();
    this.expanded = false;
    this.#carry = null;
  }

  /** Current buffer, whether or not it has been submitted. */
  get code(): string {
    return this.draft;
  }

  focusEditor(): void {
    this.area?.focus();
  }

  override render(): TemplateResult {
    return this.expanded ? this.#renderExpanded() : this.#renderInline();
  }

  #renderInline(): TemplateResult {
    // A definite height, from `rows` alone. Growing with content would make the
    // box scroll the panel instead of itself, which is what made scrolling feel
    // broken on a long block of markup.
    const height = `calc(${this.rows} * 1.65em + 18px)`;
    return html`
      <div class="frame">
        ${this.#renderShell(height)}
        ${this.expandable
        ? html`<button
              class="grow"
              type="button"
              title=${`Edit ${this.#title()} in a larger view`}
              aria-label=${`Edit ${this.#title()} in a larger view`}
              @click=${this.#expand}
            >
              ${icon('expand', 12)}
            </button>`
        : nothing}
      </div>
      ${this.showStatus ? this.#renderStatus() : nothing}
    `;
  }

  #renderExpanded(): TemplateResult {
    const height = `calc(${this.rows} * 1.65em + 18px)`;
    const lines = this.#lineCount();
    return html`
      <div class="stand-in" style=${`height:${height}`}>
        <span>Editing ${this.#title()} in the expanded view</span>
        <button class="btn sm" type="button" @click=${this.#collapse}>
          ${icon('collapse', 12)} Back to the panel
        </button>
      </div>
      <dialog
        class="modal"
        aria-label=${`Edit ${this.#title()}`}
        @cancel=${(event: Event) => {
        // Keep Escape as "leave the big view", never as "discard the buffer".
        event.preventDefault();
        this.#collapse();
      }}
        @close=${() => {
        this.expanded = false;
      }}
      >
        <header>
          ${icon('code', 13)}
          <span class="lang">${this.#title()}</span>
          <span class="spacer"></span>
          <button
            class="btn sm"
            type="button"
            title="Back to the panel"
            @click=${this.#collapse}
          >
            ${icon('collapse', 12)} Collapse
          </button>
        </header>
        <div class="pane">${this.#renderShell('100%')}</div>
        <footer>
          <span class=${this.error ? 'error' : ''}
            >${this.error || `${lines} line${lines === 1 ? '' : 's'}`}</span
          >
          <span class="spacer"></span>
          <span>Tab indents · ${modKey()}+Enter applies · Esc collapses</span>
        </footer>
      </dialog>
    `;
  }

  #renderShell(height: string): TemplateResult {
    const numbers = Array.from({ length: this.#lineCount() }, (_, i) => i + 1).join('\n');
    return html`
      <div class="shell" style=${`height:${height}`}>
        <div class="gutter" aria-hidden="true">${numbers}</div>
        <div class="area">
          <pre aria-hidden="true"><code>${unsafeHTML(highlight(`${this.draft}\n`, this.language))}</code></pre>
          <textarea
            .value=${this.draft}
            placeholder=${this.placeholder}
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            wrap="off"
            aria-label=${`${this.language.toUpperCase()} source`}
            @input=${this.#onInput}
            @scroll=${this.#syncScroll}
            @keydown=${this.#onKeyDown}
          ></textarea>
        </div>
      </div>
    `;
  }

  #renderStatus(): TemplateResult {
    const lines = this.#lineCount();
    return html`<div class="status">
      <span class=${this.error ? 'error' : ''}
        >${this.error || `${lines} line${lines === 1 ? '' : 's'}`}</span
      >
      <span>Tab indents · ${modKey()}+Enter applies</span>
    </div>`;
  }

  #lineCount(): number {
    return Math.max(this.draft.split('\n').length, 1);
  }

  #title(): string {
    return this.heading || `${this.language.toUpperCase()} source`;
  }

  /* ---- Expanding ---- */

  #expand(): void {
    if (this.expanded) return;
    this.#remember();
    this.expanded = true;
  }

  #collapse(): void {
    if (!this.expanded) return;
    this.#remember();
    const dialog = this.renderRoot.querySelector('dialog');
    if (dialog?.open) dialog.close();
    this.expanded = false;
  }

  /** Note where the caret is, so the move between containers is not felt. */
  #remember(): void {
    if (!this.area) return;
    this.#carry = {
      start: this.area.selectionStart,
      end: this.area.selectionEnd,
      scrollTop: this.area.scrollTop,
    };
  }

  /**
   * Open or close the dialog to match `expanded`, then restore the caret.
   *
   * `showModal` has to be called imperatively — the `open` attribute alone gives a
   * non-modal dialog that is neither in the top layer nor focus-trapped, which
   * would leave it clipped inside the dock exactly like a plain div.
   */
  override updated(): void {
    const dialog = this.renderRoot.querySelector('dialog');
    if (this.expanded && dialog && !dialog.open) {
      dialog.showModal();
      this.#restore();
      return;
    }
    if (this.#carry) this.#restore();
  }

  #restore(): void {
    const carry = this.#carry;
    this.#carry = null;
    const area = this.area;
    if (!carry || !area) return;
    area.focus();
    area.setSelectionRange(carry.start, carry.end);
    area.scrollTop = carry.scrollTop;
    this.#syncScroll();
  }

  #onInput(event: Event): void {
    this.draft = (event.target as HTMLTextAreaElement).value;
    this.#emit('code-input');
  }

  #syncScroll(): void {
    if (!this.pre) return;
    this.pre.scrollTop = this.area.scrollTop;
    this.pre.scrollLeft = this.area.scrollLeft;
    if (this.gutter) this.gutter.scrollTop = this.area.scrollTop;
  }

  #onKeyDown(event: KeyboardEvent): void {
    const area = this.area;
    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key === 'Enter') {
      event.preventDefault();
      // Applying from the big view returns to the panel: the edit is done, and
      // leaving a fullscreen modal over the result is not what anyone wants next.
      if (this.expanded) this.#collapse();
      this.#emit('code-submit');
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (this.expanded) {
        event.preventDefault();
        this.#collapse();
        return;
      }
      this.#emit('code-cancel');
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = area;
      const multiline = value.slice(selectionStart, selectionEnd).includes('\n');

      if (!multiline && !event.shiftKey) {
        this.#replace(selectionStart, selectionEnd, '  ', selectionStart + 2);
        return;
      }
      // Indent or outdent whole lines.
      const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const end = value.indexOf('\n', selectionEnd);
      const stop = end === -1 ? value.length : end;
      const block = value.slice(start, stop);
      const next = event.shiftKey
        ? block.replace(/^ {1,2}/gm, '')
        : block.replace(/^/gm, '  ');
      this.#replace(start, stop, next, start + next.length);
      return;
    }

    if (event.key === 'Enter') {
      // Keep the current indentation, and add a level after an opening tag or brace.
      const { selectionStart, value } = area;
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const line = value.slice(lineStart, selectionStart);
      const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
      const opens = /<[a-zA-Z][^>]*>\s*$/.test(line) && !/\/>\s*$/.test(line);
      const brace = /[{[(]\s*$/.test(line);
      if (!opens && !brace) return;
      event.preventDefault();
      const insert = `\n${indent}  `;
      this.#replace(selectionStart, area.selectionEnd, insert, selectionStart + insert.length);
    }
  }

  /** Splice text in without losing native undo where the browser supports it. */
  #replace(start: number, end: number, text: string, caret: number): void {
    const area = this.area;
    area.setSelectionRange(start, end);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      area.value = area.value.slice(0, start) + text + area.value.slice(end);
    }
    area.setSelectionRange(caret, caret);
    this.draft = area.value;
    this.#emit('code-input');
  }

  #emit(type: 'code-input' | 'code-submit' | 'code-cancel'): void {
    this.#lastEmitted = this.draft;
    this.dispatchEvent(
      new CustomEvent(type, { detail: { value: this.draft }, bubbles: true, composed: true }),
    );
  }
}

function modKey(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-code-editor': HeoCodeEditor;
  }
}
