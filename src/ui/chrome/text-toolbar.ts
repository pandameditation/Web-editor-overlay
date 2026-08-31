import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { visualBox } from '../../core/dom.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * Formatting bar for inline text editing.
 *
 * Appears above the element being edited and disappears with it, so formatting
 * lives where the text does rather than in a panel across the screen. Link
 * insertion expands the bar into a URL field in place, which keeps the caret and
 * the current selection intact — opening a dialog would lose both.
 */
@customElement('heo-text-toolbar')
export class HeoTextToolbar extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        z-index: 14;
        pointer-events: auto;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border-radius: var(--heo-r-md);
      }
      .sep {
        width: 1px;
        height: 18px;
        margin: 0 3px;
        background: var(--heo-line);
      }
      .link {
        display: flex;
        align-items: center;
        gap: 5px;
        padding-left: 4px;
      }
      .link input[type='url'] {
        width: 190px;
        height: 24px;
        padding: 0 7px;
        border: 1px solid var(--heo-line);
        border-radius: 6px;
        background: var(--heo-sunken);
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .link input[type='url']:focus {
        outline: none;
        border-color: var(--heo-accent-line);
      }
      .blank {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        white-space: nowrap;
        cursor: pointer;
      }
      .blank input {
        width: 13px;
        height: 13px;
        accent-color: var(--heo-accent);
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.textEditing, s.geometry] as const,
    shallowArrayEquals,
  );

  @state() private linkMode = false;
  @state() private href = '';
  @state() private newTab = false;

  @query('input[type="url"]') private urlInput?: HTMLInputElement;

  override updated(): void {
    if (this.linkMode && this.urlInput && this.shadowRoot?.activeElement !== this.urlInput) {
      this.urlInput.focus();
      this.urlInput.select();
    }
  }

  override render(): TemplateResult | typeof nothing {
    const el = this.state.value.textEditing;
    if (!el || !el.isConnected) {
      if (this.linkMode) this.linkMode = false;
      return nothing;
    }
    this.#place(el);

    return html`<div class="bar surface">
      ${this.linkMode ? this.#renderLink() : this.#renderFormat()}
    </div>`;
  }

  #renderFormat(): TemplateResult {
    const buttons: Array<[string, string, string]> = [
      ['bold', 'Bold', 'bold'],
      ['italic', 'Italic', 'italic'],
      ['underline', 'Underline', 'underline'],
      ['strikeThrough', 'Strikethrough', 'strike'],
    ];
    return html`
      ${buttons.map(
        ([command, title, glyph]) => html`<button
          class="btn icon ghost"
          type="button"
          title=${title}
          aria-label=${title}
          @pointerdown=${(event: Event) => event.preventDefault()}
          @click=${() => this.editor.formatText(command as 'bold')}
        >
          ${icon(glyph, 13)}
        </button>`,
      )}
      <span class="sep"></span>
      <button
        class="btn icon ghost"
        type="button"
        title="Insert or edit a link"
        aria-label="Insert link"
        @pointerdown=${(event: Event) => event.preventDefault()}
        @click=${this.#openLink}
      >
        ${icon('link', 13)}
      </button>
      <button
        class="btn icon ghost"
        type="button"
        title="Remove link"
        aria-label="Remove link"
        @pointerdown=${(event: Event) => event.preventDefault()}
        @click=${() => this.editor.insertLink('')}
      >
        ${icon('unlink', 13)}
      </button>
      <button
        class="btn icon ghost"
        type="button"
        title="Clear formatting"
        aria-label="Clear formatting"
        @pointerdown=${(event: Event) => event.preventDefault()}
        @click=${() => this.editor.formatText('removeFormat')}
      >
        ${icon('refresh', 13)}
      </button>
      <span class="sep"></span>
      <button class="btn sm primary" type="button" @click=${() => this.editor.endTextEdit(true)}>
        ${icon('check', 12)} Done
      </button>
    `;
  }

  #renderLink(): TemplateResult {
    return html`<div class="link">
      ${icon('link', 13)}
      <input
        type="url"
        placeholder="https://…"
        .value=${this.href}
        spellcheck="false"
        aria-label="Link URL"
        @input=${(event: Event) => {
          this.href = (event.target as HTMLInputElement).value;
        }}
        @keydown=${this.#onLinkKey}
      />
      <label class="blank">
        <input
          type="checkbox"
          .checked=${this.newTab}
          @change=${(event: Event) => {
            this.newTab = (event.target as HTMLInputElement).checked;
            // Written through as it is ticked, not on Apply, so cancelling still remembers it
            // and nothing depends on this component surviving until the link is applied.
            this.editor.linkOpensInNewTab = this.newTab;
          }}
        />
        New tab
      </label>
      <button class="btn sm primary" type="button" @click=${this.#applyLink}>Apply</button>
      <button
        class="btn sm ghost"
        type="button"
        @click=${() => {
          this.linkMode = false;
        }}
      >
        Cancel
      </button>
    </div>`;
  }

  /**
   * Capture the selection's existing link before showing the field.
   *
   * Prefilling with the current href turns "add a link" and "fix a link" into
   * the same interaction.
   */
  #openLink(): void {
    const selection = getSelection();
    let existing = '';
    const node = selection?.anchorNode;
    const start = node instanceof HTMLElement ? node : node?.parentElement;
    const anchor = start?.closest('a[href]');
    /*
     * An existing link answers for itself; a new one inherits the last choice made.
     *
     * The choice used to live in this component's own state, which is emptied whenever the
     * toolbar re-renders from scratch — it renders nothing between text edits — so "open in a
     * new tab" was forgotten between one link and the next. The engine holds it now.
     */
    if (anchor) {
      existing = anchor.getAttribute('href') ?? '';
      this.newTab = anchor.getAttribute('target') === '_blank';
    } else {
      this.newTab = this.editor.linkOpensInNewTab;
    }
    this.href = existing;
    this.linkMode = true;
  }

  #onLinkKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.#applyLink();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.linkMode = false;
    }
  }

  #applyLink(): void {
    this.editor.linkOpensInNewTab = this.newTab;
    this.editor.insertLink(this.href, this.newTab ? '_blank' : null);
    this.linkMode = false;
  }

  #place(el: HTMLElement): void {
    const box = visualBox(el);
    const width = this.offsetWidth || 280;
    const left = Math.min(Math.max(8, box.left), Math.max(8, innerWidth - width - 8));
    const above = box.top > 52;
    const top = above ? box.top - 44 : Math.min(box.top + box.height + 10, innerHeight - 50);
    this.style.left = `${Math.round(left)}px`;
    this.style.top = `${Math.round(top)}px`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-text-toolbar': HeoTextToolbar;
  }
}
