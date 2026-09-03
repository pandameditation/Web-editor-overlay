import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { enterModal, exitModal } from '../../core/modal.js';
import { highlight, type CodeLanguage } from './highlight.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import './search-field.js';

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

      /*
       * Fill the space the host gives, instead of standing a fixed number of rows tall.
       *
       * A fixed height made sense for a field inside a form. For the panels, whose whole
       * job is the buffer, it left a band of empty panel under a box the user had to
       * scroll — two scrollbars for one document. The host still decides: the row count
       * remains the default, so the block dialog's fields keep their deliberate size.
       */
      :host([fill]) {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }
      :host([fill]) .frame {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }
      :host([fill]) .shell {
        flex: 1 1 auto;
        min-height: 0;
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
        /*
         * Note the deliberate absence of a white-space declaration.
         *
         * Preserving whitespace belonged here when the gutter was one block of
         * newline-separated numbers. Now that it renders a row per line, preserving it
         * turns the newlines and indentation of the template itself into rendered blank
         * lines — which pushed the whole gutter two lines down and put every number and
         * fold control beside the wrong line.
         */
      }
      /* Translated to follow the textarea, so it is not itself a scroll container. */
      .gutter .nums {
        display: block;
        will-change: transform;
      }
      /* One row per visible line, exactly one line-height tall so the numbers stay
         registered against the code beside them. */
      .gutter .ln {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        height: 1.65em;
      }
      .gutter .n {
        font-variant-numeric: tabular-nums;
      }
      /* The fold control. Reserved space on every row rather than appearing on hover,
         because a gutter that changes width when the pointer enters it drags the code
         sideways under the caret. */
      .gutter .fold {
        display: grid;
        place-items: center;
        width: 11px;
        height: 11px;
        padding: 0;
        border: 0;
        border-radius: 3px;
        background: none;
        color: var(--heo-text-faint);
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--heo-fast);
      }
      .gutter .fold.on,
      .shell:hover .gutter .fold,
      .gutter .fold:focus-visible {
        opacity: 1;
      }
      .gutter .fold:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .gutter .fold.spacer {
        cursor: default;
        pointer-events: none;
      }
      /* The collapsed-range pill in the code itself. */
      .t-fold {
        padding: 0 5px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 999px;
        background: var(--heo-raised);
        color: var(--heo-text-faint);
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
      /* Translated to follow the textarea rather than scrolled; see syncScroll. */
      pre > code {
        display: block;
        will-change: transform;
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

      /*
       * Floated over the buffer's top-right, not stacked above it.
       *
       * A row in the frame's column looked tidier and cost the buffer its height: the panel
       * body is a column that deliberately does not scroll, so in a short dock a 36px bar left
       * the buffer four pixels tall. Out of flow it costs nothing at any panel height, and it
       * is where a find box already lives in the editors people use.
       */
      .findbar {
        position: absolute;
        z-index: 3;
        top: 5px;
        right: 5px;
        display: flex;
        align-items: center;
        gap: 4px;
        max-width: calc(100% - 10px);
        padding: 3px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        /* Opaque: it sits on top of code, and a translucent one made both unreadable. */
        background: var(--heo-bg);
        box-shadow: var(--heo-shadow-md);
      }
      .findbar heo-search-field {
        flex: 1 1 auto;
        min-width: 0;
        width: 172px;
      }

      /*
       * Every match tinted, the current one filled.
       *
       * Two levels because one is not enough to step with: a single colour tells you where the
       * matches are and never which one the arrows are on. The mark element brings its own browser
       * styling, so colour and background are both set here rather than inherited.
       */
      mark.hit {
        border-radius: 2px;
        background: color-mix(in oklab, var(--heo-warn) 30%, transparent);
        color: inherit;
        /* The layer is only a backdrop; the textarea above it takes every pointer event. */
        pointer-events: none;
      }
      mark.hit.on {
        background: var(--heo-warn);
        color: oklch(22% 0.02 265);
        box-shadow: 0 0 0 1px var(--heo-warn);
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
      /* Filling means the buffer is the point, so the status line gives back the space
         it does not need. It stays — a line count and the submit hint are worth a row —
         but it stops costing three. */
      :host([fill]) .status {
        flex: 0 0 auto;
        margin-top: 4px;
        font-size: 9.5px;
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
      /* Sibling buffers. Same shape as the panel's own tab strip, so expanding does
         not feel like arriving somewhere with different rules. */
      dialog.modal > header .tabs {
        display: flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      dialog.modal > header .tabs button {
        padding: 3px 9px;
        border: 0;
        border-radius: calc(var(--heo-r-sm) - 2px);
        background: transparent;
        color: var(--heo-text-faint);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      dialog.modal > header .tabs button:hover {
        color: var(--heo-text);
      }
      dialog.modal > header .tabs button[data-on] {
        background: var(--heo-accent);
        color: #fff;
      }
      dialog.modal > header .tabs button:focus-visible {
        outline: 2px solid var(--heo-accent);
        outline-offset: 1px;
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
  /**
   * Grow to the height available rather than to `rows`.
   *
   * Reflected, because the sizing is done in CSS against the host.
   */
  @property({ type: Boolean, reflect: true }) fill = false;
  /** Set `expandable="false"` to drop the fullscreen affordance. */
  @property({ type: Boolean }) expandable = true;
  /**
   * Hand expanding to the host instead of opening this editor's own modal.
   *
   * The three page languages share one fullscreen view, which has to outlive the panel
   * that opened it — a modal owned by the panel closed the moment you switched
   * language, since that destroys the panel. Set this and the button asks; leave it
   * empty and the editor expands itself, which is what the block dialog wants.
   */
  @property({ type: String }) expandTarget = '';
  /**
   * Sibling buffers this editor can switch to, shown as tabs once expanded.
   *
   * A component is three files that only make sense together, so expanding the
   * markup used to be a dead end: reaching its CSS meant collapsing, switching, and
   * expanding again. The host keeps owning the buffers — this only says which ones
   * exist and asks to be pointed at another.
   */
  @property({ attribute: false }) tabs: Array<{ id: string; label: string }> = [];
  /** Which of `tabs` is showing. Matched against each entry's `id`. */
  @property({ type: String }) activeTab = '';

  /**
   * Tag names to collapse as soon as a buffer loads.
   *
   * The full-document view sets `['style', 'script']`: a stylesheet inlined into a page
   * is frequently longer than the markup around it, so opening the document on it means
   * scrolling past someone else's CSS to reach your own HTML. Only applied on load, so
   * expanding one keeps it expanded.
   */
  @property({ attribute: false }) autoCollapse: string[] = [];

  /** The full buffer. What `code` returns, what the host sees, what gets applied. */
  @state() private draft = '';
  /**
   * The full buffer with each collapsed range replaced by one marker line.
   *
   * This is what the textarea and the highlight layer show. Identical to `draft`
   * whenever nothing is collapsed.
   */
  @state() private projection = '';
  @state() private expanded = false;

  /** What is being looked for in this buffer, and which match is current. */
  @state() private find = '';
  @state() private findAt = 0;

  @query('textarea') private area!: HTMLTextAreaElement;
  @query('pre') private pre!: HTMLPreElement;
  @query('.gutter') private gutter!: HTMLElement;

  /** Text behind each marker, in the order the markers appear in the projection. */
  #hidden: string[] = [];
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
      this.#loadBuffer(this.value);
    }
    // A new language means the host pointed this editor at a different buffer, so the
    // draft belongs to the old one. Nothing about focus can argue with that, and the
    // value may well be identical (two empty buffers) and so not register as changed.
    if (changed.has('language') && changed.get('language') !== undefined) {
      this.#loadBuffer(this.value);
      this.#lastEmitted = this.value;
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
    exitModal(this);
    this.#carry = null;
  }

  /** Current buffer, whether or not it has been submitted. */
  get code(): string {
    return this.draft;
  }

  /**
   * Ask the host to point this editor at another buffer.
   *
   * The pending draft goes out first. Switching tabs is not submitting, but losing
   * what was typed because the user looked at the CSS would be indefensible, and the
   * host is already storing every keystroke from `code-input`.
   */
  #selectTab(id: string): void {
    if (id === this.activeTab) return;
    if (this.draft !== this.value) this.#emit('code-input');
    this.dispatchEvent(
      new CustomEvent('tab-change', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  focusEditor(): void {
    this.area?.focus();
  }

  /* ---------------------------------------------------------------------- */
  /* Finding text                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Where every match of `query` starts, in what the editor is currently showing.
   *
   * The *projection*, not the full buffer, and that is the honest choice rather than a shortcut.
   * When a region is folded its text is not on screen, so reporting a match inside it would put a
   * number next to a search box and then have nothing to reveal when the user pressed next. The
   * rule a reader can hold is "it finds what you can see"; folding is opt-in per tag, so on most
   * buffers the two are the same text anyway.
   *
   * Case-insensitive, because a find box that made someone match the capitalisation of a tag name
   * would be answering a question nobody asked.
   */
  matchOffsets(query: string): number[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const hay = this.projection.toLowerCase();
    const out: number[] = [];
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
      out.push(at);
    }
    return out;
  }

  /**
   * Select the nth match and scroll it into view. Returns the index reached, or -1 for no match.
   *
   * The index wraps in both directions, so a host can hand it `current + 1` or `current - 1`
   * without bounds-checking and get the behaviour every find box in every editor has.
   *
   * Selecting rather than highlighting: the textarea is the real control here, and the browser's
   * own selection is the one thing guaranteed to be visible, themable and already understood. It
   * also leaves the caret on the match, so typing replaces it.
   */
  revealMatch(query: string, index: number, options: { focus?: boolean } = {}): number {
    const hits = this.matchOffsets(query);
    const area = this.area;
    if (!hits.length || !area) return -1;

    const wrapped = ((index % hits.length) + hits.length) % hits.length;
    const start = hits[wrapped];
    /*
     * Focus is not taken unless it is asked for, and by default it is not.
     *
     * Focusing here is what made the find box unusable: revealing runs on every keystroke, so each
     * character moved focus into the textarea and the next one went into the buffer instead of the
     * query. The caret belongs wherever the user put it; a find box that types into the document
     * it is searching is worse than no find box.
     */
    if (options.focus) area.focus();
    area.setSelectionRange(start, start + query.trim().length);

    /*
     * Centred by line rather than left to the browser.
     *
     * `setSelectionRange` does not scroll, and the alternatives are worse: `scrollIntoView` on a
     * textarea moves the whole panel, and reading `scrollHeight` mid-layout is how the two stacked
     * layers get out of step. A line number times the line height is arithmetic that cannot
     * disagree with itself.
     */
    const line = this.projection.slice(0, start).split('\n').length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight) || 18;
    area.scrollTop = Math.max(0, line * lineHeight - area.clientHeight / 2);
    this.#syncScroll();
    return wrapped;
  }

  override render(): TemplateResult {
    return this.expanded ? this.#renderExpanded() : this.#renderInline();
  }

  #renderInline(): TemplateResult {
    // A definite height, from `rows` alone. Growing with content would make the
    // box scroll the panel instead of itself, which is what made scrolling feel
    // broken on a long block of markup.
    const height = this.fill ? '100%' : `calc(${this.rows} * 1.65em + 18px)`;
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
          ${this.tabs.length > 1
        ? html`<div class="tabs" role="tablist" aria-label="Source files">
              ${this.tabs.map(
          (tab) => html`<button
                  type="button"
                  role="tab"
                  aria-selected=${tab.id === this.activeTab}
                  ?data-on=${tab.id === this.activeTab}
                  @click=${() => this.#selectTab(tab.id)}
                >
                  ${tab.label}
                </button>`,
        )}
            </div>`
        : html`<span class="lang">${this.#title()}</span>`}
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

  /**
   * Find in this buffer. Offered on the editors that fill their panel, not on every small field.
   *
   * Here rather than in each panel, which is the point: the editor owns the buffer, the projection,
   * the scrolling and the layer the matches are drawn on. Built in the Code panel first, it worked
   * only there — CSS and JS have exactly the same need and got nothing, and the expanded view only
   * inherited it by the accident of rendering the same panel. One bar in the control covers every
   * consumer, in both the inline and the expanded shapes.
   *
   * No create action: there is nothing in a buffer to create. Enter steps forward the way every
   * find box does, and the arrows make that discoverable without knowing it.
   */
  #renderFind(): TemplateResult | typeof nothing {
    if (!this.fill) return nothing;
    const total = this.matchOffsets(this.find).length;
    const stepping = Boolean(this.find.trim()) && total > 0;

    return html`<div class="findbar">
      <heo-search-field
        label=${`Find in the ${this.language.toUpperCase()}`}
        placeholder=${`Find in the ${this.language.toUpperCase()}…`}
        .value=${this.find}
        .count=${total}
        @search-input=${(event: CustomEvent<{ value: string }>) => this.#onFind(event.detail.value)}
        @search-submit=${() => this.#step(1)}
      ></heo-search-field>
      <button
        class="btn icon ghost sm"
        type="button"
        ?disabled=${!stepping}
        title="Previous match"
        aria-label="Previous match"
        @click=${() => this.#step(-1)}
      >
        ${icon('chevronUp', 12)}
      </button>
      <button
        class="btn icon ghost sm"
        type="button"
        ?disabled=${!stepping}
        title="Next match"
        aria-label="Next match"
        @click=${() => this.#step(1)}
      >
        ${icon('chevronDown', 12)}
      </button>
    </div>`;
  }

  /** A new query starts from the top, and shows its first match while it is being typed. */
  #onFind(next: string): void {
    this.find = next;
    this.findAt = 0;
    if (!next.trim()) return;
    // After the render that knows the new query, so the offsets are measured against it.
    void this.updateComplete.then(() => {
      this.findAt = this.revealMatch(next, 0);
    });
  }

  #step(delta: number): void {
    if (!this.find.trim()) return;
    this.findAt = this.revealMatch(this.find, this.findAt + delta);
  }

  #renderShell(height: string): TemplateResult {
    return html`
      <div class="shell" style=${this.fill ? nothing : `height:${height}`}>
        ${this.#renderFind()}
        <div class="gutter">${this.#renderGutter()}</div>
        <div class="area">
          <pre aria-hidden="true"><code>${unsafeHTML(this.#highlighted())}</code></pre>
          <textarea
            .value=${this.projection}
            placeholder=${this.placeholder}
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            wrap="off"
            aria-label=${`${this.language.toUpperCase()} source`}
            @input=${this.#onInput}
            @beforeinput=${this.#onBeforeInput}
            @click=${this.#onClick}
            @scroll=${this.#syncScroll}
            @keydown=${this.#onKeyDown}
          ></textarea>
        </div>
      </div>
    `;
  }

  /**
   * The highlighted projection, with marker lines drawn as pills.
   *
   * Substituted after highlighting rather than before: the marker is plain text as far
   * as the tokeniser is concerned, so it survives into the output untouched and can be
   * matched there. Safe to match on, because the sentinel cannot occur in the buffer —
   * `#onBeforeInput` refuses to let one be typed or pasted.
   */
  #highlighted(): string {
    const marked = new RegExp(`^(\\s*)(${FOLD_MARK} \\d+ lines? ${FOLD_MARK})$`, 'gm');
    const painted = highlight(`${this.projection}\n`, this.language).replace(
      marked,
      (_full, indent: string, pill: string) => `${indent}<span class="t-fold">${pill}</span>`,
    );
    /*
     * Matches are drawn here rather than left to the textarea's own selection.
     *
     * The textarea is transparent — every colour on screen comes from this layer behind it — so a
     * selection is a faint tint under invisible text, and only while the textarea has focus. Since
     * finding must not take focus, relying on it would mean marking nothing at all. Drawing the
     * matches into the layer that is actually visible shows all of them at once and lets the
     * current one be picked out from the rest, which is what makes stepping through legible.
     */
    return markMatches(painted, this.find.trim(), this.findAt);
  }

  /**
   * One gutter row per visible line, with a fold control where there is one to offer.
   *
   * Rows rather than a block of text, because a fold control has to sit on the line it
   * belongs to. Every row reserves the control's width whether or not it has one, so
   * the gutter never changes width and the code never shifts sideways under the caret.
   */
  #renderGutter(): TemplateResult {
    const lines = this.projection.split('\n');
    const openers = new Set(this.#ranges().map((range) => range.open));
    return html`<div class="nums">
      ${lines.map((_text, index) => {
      const collapsed = isMarkerLine(lines[index + 1] ?? '');
      const foldable = collapsed || openers.has(index);
      return html`<div class="ln">
          ${foldable
          ? html`<button
                class=${`fold${collapsed ? ' on' : ''}`}
                type="button"
                tabindex="-1"
                title=${collapsed ? 'Expand' : 'Collapse'}
                aria-label=${collapsed ? `Expand line ${index + 1}` : `Collapse line ${index + 1}`}
                @mousedown=${(event: MouseEvent) => event.preventDefault()}
                @click=${() => this.#toggleFold(index)}
              >
                ${icon(collapsed ? 'chevronRight' : 'chevronDown', 9)}
              </button>`
          : html`<span class="fold spacer"></span>`}
          <span class="n" aria-hidden="true">${index + 1}</span>
        </div>`;
    })}
    </div>`;
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
    if (this.expandTarget) {
      this.dispatchEvent(
        new CustomEvent('code-expand', {
          detail: { target: this.expandTarget },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    if (this.expanded) return;
    this.#remember();
    this.expanded = true;
    // Claimed imperatively rather than through `ModalController`: this component
    // stays connected either way, so its modal life is bounded by `expanded` and not
    // by its own lifecycle. `showModal` already contains focus; what it does not do
    // is stop the page scrolling behind the dialog.
    enterModal(this);
  }

  #collapse(): void {
    if (!this.expanded) return;
    this.#remember();
    const dialog = this.renderRoot.querySelector('dialog');
    if (dialog?.open) dialog.close();
    this.expanded = false;
    exitModal(this);
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
    this.projection = (event.target as HTMLTextAreaElement).value;
    this.draft = expandProjection(this.projection, this.#hidden);
    this.#emit('code-input');
  }

  /* ---- Folding ---- */

  /**
   * Take a buffer from the host, discarding any collapsed state.
   *
   * A new buffer is a new document: its line numbers have nothing to do with the old
   * one's, so keeping folds would hide arbitrary ranges of it.
   */
  #loadBuffer(next: string): void {
    this.draft = next;
    this.projection = next;
    this.#hidden = [];
    if (this.autoCollapse.length) this.#applyAutoCollapse();
  }

  /**
   * Collapse the ranges the host asked for by name, innermost-last.
   *
   * Folding back to front keeps every remaining range's line numbers valid, since a
   * fold only ever shortens the projection below the line it starts on.
   */
  #applyAutoCollapse(): void {
    const wanted = new Set(this.autoCollapse.map((tag) => tag.toLowerCase()));
    const ranges = foldRanges(this.projection, this.language)
      .filter((range) => wanted.has(range.label.toLowerCase()))
      .sort((a, b) => b.open - a.open);
    for (const range of ranges) this.#collapseRange(range, false);
  }

  /** Ranges of the *projection*, which is what the gutter is drawn against. */
  #ranges(): FoldRange[] {
    return foldRanges(this.projection, this.language);
  }

  /**
   * Replace a range's contents with a marker, keeping its opening and closing lines.
   *
   * Leaving both ends visible is what makes a collapsed range readable — `<style>` over
   * `</style>` says what is inside it, where a single opaque marker would not — and it
   * also gives the closing line back as an anchor for expanding again.
   */
  #collapseRange(range: FoldRange, emit = true): void {
    const lines = this.projection.split('\n');
    const body = lines.slice(range.open + 1, range.close);
    if (!body.length) return;
    const indent = /^\s*/.exec(lines[range.open])?.[0] ?? '';
    const marker = `${indent}  ${FOLD_MARK} ${body.length} line${body.length === 1 ? '' : 's'} ${FOLD_MARK}`;
    this.#hidden.splice(markersBefore(lines, range.open), 0, body.join('\n'));
    lines.splice(range.open + 1, body.length, marker);
    this.#setProjection(lines.join('\n'), emit);
  }

  /** Put a marker's text back where it came from. */
  #expandAt(line: number, emit = true): void {
    const lines = this.projection.split('\n');
    if (!isMarkerLine(lines[line] ?? '')) return;
    const [block] = this.#hidden.splice(markersBefore(lines, line), 1);
    lines.splice(line, 1, ...(block ?? '').split('\n'));
    this.#setProjection(lines.join('\n'), emit);
  }

  /**
   * Write a new projection.
   *
   * The full buffer is unchanged by folding, so `draft` is only recomputed as a
   * consistency check rather than as an edit — and no `code-input` is emitted for a
   * fold, because collapsing a range is a change to the view and not to the document.
   * Emitting would mark the host's buffer dirty for pressing a chevron.
   */
  #setProjection(next: string, emit: boolean): void {
    this.projection = next;
    const expanded = expandProjection(next, this.#hidden);
    if (emit) this.draft = expanded;
    this.requestUpdate();
  }

  /**
   * Clicking a collapsed range opens it.
   *
   * The pill is drawn in the highlight layer, which is underneath the textarea and
   * inert to the pointer, so it cannot be a real button — the click always lands on the
   * textarea. What it can do is read where the caret ended up: a click that put it on a
   * marker line was a click on the pill, and there is nothing else a caret would be
   * doing there, since typing on that line expands the range anyway.
   *
   * Ignored while a range is selected, so dragging a selection across a collapsed range
   * does not expand it on release.
   */
  #onClick(): void {
    const area = this.area;
    if (!area || area.selectionStart !== area.selectionEnd) return;
    const lines = this.projection.split('\n');
    let offset = 0;
    for (let line = 0; line < lines.length; line += 1) {
      const end = offset + lines[line].length;
      if (area.selectionStart <= end) {
        if (isMarkerLine(lines[line])) this.#expandAt(line, false);
        return;
      }
      offset = end + 1;
    }
  }

  #toggleFold(line: number): void {
    const lines = this.projection.split('\n');
    if (isMarkerLine(lines[line + 1] ?? '')) {
      this.#expandAt(line + 1, false);
      return;
    }
    const range = this.#ranges().find((candidate) => candidate.open === line);
    if (range) this.#collapseRange(range, false);
  }

  /**
   * Guard the markers against being edited.
   *
   * This is what lets the hidden text be stored beside the marker lines rather than
   * inside them. Two things are refused:
   *
   * - An edit whose range touches a marker line. Every marker it touches is expanded
   *   instead, and the keystroke is spent doing that — which is also the behaviour a
   *   code editor is expected to have when you type into a folded region.
   * - Inserted text containing the sentinel, which would otherwise fabricate a marker
   *   with no text behind it and shift every later marker onto the wrong block.
   */
  #onBeforeInput(event: InputEvent): void {
    const area = this.area;
    if (!area) return;
    const lines = this.projection.split('\n');
    if (!lines.some(isMarkerLine)) return;

    // Line spans, so the edit range can be compared against the marker lines.
    const spans: Array<{ line: number; start: number; end: number }> = [];
    let offset = 0;
    lines.forEach((text, line) => {
      spans.push({ line, start: offset, end: offset + text.length });
      offset += text.length + 1;
    });

    const from = area.selectionStart;
    const to = area.selectionEnd;
    const touched = spans.filter(
      (span) => isMarkerLine(lines[span.line]) && span.start <= to && span.end >= from,
    );
    if (touched.length) {
      event.preventDefault();
      // Back to front, so each expansion leaves the earlier lines where they were.
      for (const span of touched.reverse()) this.#expandAt(span.line, false);
      return;
    }
    if (event.data?.includes(FOLD_MARK)) event.preventDefault();
  }

  /**
   * Keep the highlight layer and the gutter aligned with the textarea.
   *
   * By translating their contents rather than scrolling them, which is the fix for a
   * misalignment that showed up as a selection highlight sliding off its own text.
   * The selection rectangle is painted by the textarea and the glyphs by the `<pre>`
   * underneath, so any disagreement about scroll offset separates the two.
   *
   * Assigning `scrollTop`/`scrollLeft` guaranteed that disagreement at the edges,
   * because a scroll offset is clamped to its own element's scrollable extent and the
   * two elements do not have the same one:
   *
   * - The textarea has `overflow: auto`, so a horizontal scrollbar eats into its
   *   client height and pushes its maximum `scrollTop` past the `<pre>`'s.
   * - Elastic overscroll returns offsets beyond the maximum entirely, which the
   *   `<pre>` silently clamps and the textarea does not.
   *
   * A transform is not clamped, so it tracks the textarea exactly — including past
   * either edge — and the fractional offsets stay fractional instead of being
   * rounded into a half-pixel drift.
   */
  #syncScroll(): void {
    const area = this.area;
    if (!area) return;
    const x = area.scrollLeft;
    const y = area.scrollTop;
    const code = this.pre?.firstElementChild as HTMLElement | null;
    if (code) code.style.transform = `translate(${-x}px, ${-y}px)`;
    const numbers = this.gutter?.firstElementChild as HTMLElement | null;
    if (numbers) numbers.style.transform = `translateY(${-y}px)`;
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

/* -------------------------------------------------------------------------- */
/* Folding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Folding over a `<textarea>`.
 *
 * The textarea holds text, not a tree, so there is nothing to hide: collapsing has
 * to mean *rewriting what the textarea contains*. So the editor keeps two strings —
 * the full buffer, which is what `code` returns and what the host ever sees, and a
 * projection of it with each collapsed range replaced by one marker line, which is
 * what the textarea and the highlight layer show.
 *
 * That makes the marker lines load-bearing: the hidden text is stored beside them,
 * in the order they appear, so a marker that vanished without the editor knowing
 * would silently take a block of the document with it. `#onBeforeInput` is what
 * makes that impossible — an edit that would touch a marker expands it first, and
 * the sentinel character cannot be typed or pasted in.
 */
const FOLD_MARK = '⋯';

/** A marker line, and nothing else, so a coincidental match is not possible. */
const MARKER_RE = new RegExp(`^\\s*${FOLD_MARK} \\d+ lines? ${FOLD_MARK}$`);

/** Tags with no closing tag, which therefore never open a foldable range. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Tags whose content is not markup, so tag scanning has to stop at them. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/** A range that can be collapsed: line indices are 0-based and inclusive. */
export interface FoldRange {
  /** The line holding the opening tag or brace. */
  open: number;
  /**
   * The line holding the close, always at least two below `open`.
   *
   * A close on the very next line leaves nothing between the two to hide, so it is not
   * a range — offering a control there gives the user a chevron that does nothing.
   */
  close: number;
  /** What is being folded, for the tooltip: a tag name, or `{…}`. */
  label: string;
}

/** Every foldable range in `text`, outermost first. */
export function foldRanges(text: string, language: CodeLanguage): FoldRange[] {
  return language === 'html' ? htmlFoldRanges(text) : braceFoldRanges(text);
}

/**
 * Ranges from matching tags, comments and raw-text elements.
 *
 * One pass with three states, because the three cannot be layered. Two things go wrong
 * as soon as you try, and this file has hit both:
 *
 * - A comment is prose, and prose mentions tags. A fixture in this repository opens
 *   with a comment containing the words "a plain `<script>` tag"; read as an element,
 *   the scanner went looking for the matching close, found the page's last one, and
 *   swallowed every fold in between — the whole document ended up with one fold
 *   control, on a comment.
 * - Script and style bodies are not markup either, and `<!--` inside one is not a
 *   comment. Masking comments *before* scanning tags gets this exactly backwards: a
 *   script containing the string `'<!--'` opened a comment that never closed, and
 *   everything after it stopped being scanned at all.
 *
 * So comments and raw text are recognised in the same walk as tags, each state
 * consuming its own terminator and nothing else. A tag opens a range only when its
 * close is at least two lines below it, which is the "contains something" test: a tag
 * whose content fits on one line has nothing worth hiding.
 */
function htmlFoldRanges(text: string): FoldRange[] {
  const out: FoldRange[] = [];
  const stack: Array<{ tag: string; line: number }> = [];
  // Matched against a lowercased copy so tag names and terminators are case-insensitive
  // without per-comparison allocation. Same length, so offsets are interchangeable.
  const lower = text.toLowerCase();
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/y;

  let index = 0;
  let line = 0;
  let mode: 'normal' | 'comment' | 'raw' = 'normal';
  let openLine = 0;
  let rawTag = '';

  const advance = (length: number): void => {
    for (let i = index; i < index + length; i += 1) if (text[i] === '\n') line += 1;
    index += length;
  };

  while (index < text.length) {
    if (mode === 'comment') {
      if (lower.startsWith('-->', index)) {
        if (line > openLine + 1) out.push({ open: openLine, close: line, label: 'comment' });
        mode = 'normal';
        advance(3);
        continue;
      }
      advance(1);
      continue;
    }

    if (mode === 'raw') {
      if (lower.startsWith(`</${rawTag}`, index)) {
        if (line > openLine + 1) out.push({ open: openLine, close: line, label: rawTag });
        mode = 'normal';
        advance(rawTag.length + 2);
        continue;
      }
      advance(1);
      continue;
    }

    if (text[index] !== '<') {
      advance(1);
      continue;
    }
    if (lower.startsWith('<!--', index)) {
      openLine = line;
      mode = 'comment';
      advance(4);
      continue;
    }

    tagRe.lastIndex = index;
    const match = tagRe.exec(text);
    if (!match) {
      advance(1);
      continue;
    }
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const selfClosing = match[4] === '/' || VOID_TAGS.has(tag);
    const startedAt = line;
    advance(match[0].length);

    if (selfClosing) continue;
    if (!closing) {
      if (RAW_TEXT_TAGS.has(tag)) {
        openLine = startedAt;
        rawTag = tag;
        mode = 'raw';
        continue;
      }
      stack.push({ tag, line: startedAt });
      continue;
    }
    for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
      if (stack[depth].tag !== tag) continue;
      const open = stack[depth].line;
      stack.length = depth;
      if (startedAt > open + 1) out.push({ open, close: startedAt, label: tag });
      break;
    }
  }
  return out.sort((a, b) => a.open - b.open);
}

/**
 * Ranges from matching braces, for CSS and JavaScript.
 *
 * Braces inside strings and comments are not excluded, so a range can occasionally be
 * off. Worth the simplicity: folding only changes what is displayed, an odd range is
 * visible immediately, and expanding it restores the text exactly.
 */
function braceFoldRanges(text: string): FoldRange[] {
  const lines = text.split('\n');
  const out: FoldRange[] = [];
  const stack: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const char of lines[i]) {
      if (char === '{') stack.push(i);
      else if (char === '}') {
        const open = stack.pop();
        if (open !== undefined && i > open + 1) out.push({ open, close: i, label: '{…}' });
      }
    }
  }
  return out.sort((a, b) => a.open - b.open);
}

/** True when this line is a collapsed-range marker. */
export function isMarkerLine(line: string): boolean {
  return MARKER_RE.test(line);
}

/** How many markers appear before `line`, which is that line's index into the store. */
function markersBefore(lines: readonly string[], line: number): number {
  let count = 0;
  for (let i = 0; i < line && i < lines.length; i += 1) if (isMarkerLine(lines[i])) count += 1;
  return count;
}

/** The full text a projection stands for, with every marker put back. */
export function expandProjection(projection: string, hidden: readonly string[]): string {
  let index = 0;
  const out: string[] = [];
  for (const line of projection.split('\n')) {
    if (!isMarkerLine(line)) {
      out.push(line);
      continue;
    }
    const block = hidden[index];
    index += 1;
    if (block !== undefined) out.push(...block.split('\n'));
  }
  return out.join('\n');
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-code-editor': HeoCodeEditor;
  }
}

/**
 * Wrap every occurrence of `needle` in already-highlighted HTML, leaving the markup alone.
 *
 * The highlighting has to happen first — it is context-sensitive, so splitting the source around
 * matches and tokenising the pieces would mis-colour anything straddling a boundary. That means
 * marking has to be done on the output, which is HTML, so the walk tracks whether it is inside a
 * tag and only ever touches text.
 *
 * Two known limits, both benign. A match split across a syntax span is not marked, because half of
 * it is on either side of a tag. And a needle containing a character the highlighter escapes — a
 * bare `<` or `&` — will not be found here even though the buffer contains it, since the text at
 * this point says `&lt;`. Both are cases where the mark is missing, never wrong or misplaced.
 */
function markMatches(html: string, needle: string, current: number): string {
  const wanted = needle.toLowerCase();
  if (!wanted) return html;

  let out = '';
  let cursor = 0;
  let hit = 0;

  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    const text = lt === -1 ? html.slice(cursor) : html.slice(cursor, lt);

    let at = 0;
    const lower = text.toLowerCase();
    for (; ;) {
      const found = lower.indexOf(wanted, at);
      if (found === -1) break;
      out += text.slice(at, found);
      out += `<mark class="hit${hit === current ? ' on' : ''}">`;
      out += text.slice(found, found + needle.length);
      out += '</mark>';
      at = found + needle.length;
      hit += 1;
    }
    out += text.slice(at);

    if (lt === -1) break;
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    out += html.slice(lt, gt + 1);
    cursor = gt + 1;
  }

  return out;
}
