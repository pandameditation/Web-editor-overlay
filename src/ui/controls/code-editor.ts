import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { highlight, type CodeLanguage } from './highlight.js';
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
    `,
  ];

  @property({ type: String }) value = '';
  @property({ type: String }) language: CodeLanguage = 'html';
  @property({ type: Number }) rows = 12;
  @property({ type: String }) error = '';
  @property({ type: String }) placeholder = '';
  @property({ type: Boolean }) showStatus = true;

  @state() private draft = '';

  @query('textarea') private area!: HTMLTextAreaElement;
  @query('pre') private pre!: HTMLPreElement;
  @query('.gutter') private gutter!: HTMLElement;

  override willUpdate(changed: PropertyValues<this>): void {
    // Before the first render both `area` and `activeElement` are null, and
    // `null !== null` reads as "the textarea has focus" — which skipped the very
    // first sync and left the editor blank until some later update happened to
    // run. Ask the real question instead: is the textarea actually focused.
    const focused = this.area != null && this.shadowRoot?.activeElement === this.area;
    if (changed.has('value') && !focused) {
      this.draft = this.value;
    }
    if (changed.has('error')) this.toggleAttribute('data-invalid', Boolean(this.error));
  }

  /** Current buffer, whether or not it has been submitted. */
  get code(): string {
    return this.draft;
  }

  focusEditor(): void {
    this.area?.focus();
  }

  override render(): TemplateResult {
    const lines = this.draft.split('\n');
    // A definite height, from `rows` alone. Growing with content would make the
    // box scroll the panel instead of itself, which is what made scrolling feel
    // broken on a long block of markup.
    const height = `calc(${this.rows} * 1.65em + 18px)`;
    const numbers = Array.from({ length: Math.max(lines.length, 1) }, (_, i) => i + 1).join('\n');

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
      ${this.showStatus
        ? html`<div class="status">
            <span class=${this.error ? 'error' : ''}
              >${this.error || `${lines.length} line${lines.length === 1 ? '' : 's'}`}</span
            >
            <span>Tab indents · ${modKey()}+Enter applies</span>
          </div>`
        : null}
    `;
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
      this.#emit('code-submit');
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
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
