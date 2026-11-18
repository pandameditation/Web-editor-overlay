import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { textStyleClass } from '../../core/text-styles.js';
import { baseStyles } from '../theme.js';

/** A text style, as the dialog offers it to replace. */
export interface DialogTextStyle {
  className: string;
  name: string;
  used: number;
  declarations: Record<string, string>;
}

/** A look as inline style, for a preview: only the typography, nothing that could reach outside. */
function lookStyle(declarations: Record<string, string>): string {
  return Object.entries(declarations)
    .filter(([property]) => !property.startsWith('--'))
    .map(([property, value]) => `${property}:${value.replace(/[;{}<>]/g, '')}`)
    .join(';');
}

/**
 * Saving an element's typography as a text style, in one modal.
 *
 * A name is proposed, and the list under it offers the existing styles, each drawn in its own
 * look: picking one replaces it, which the dialog says plainly — how many elements change, and the
 * style as it is beside what it becomes. Typing a new name makes a new style.
 *
 * Opened two ways. From "Save as text style…" (`mode="save"`): Cancel or Save. And on the way out of
 * unsaved edits, when another style is picked (`mode="leave"`): "Save your changes?", with Cancel,
 * Discard changes, or Save, after which the picked style is applied.
 *
 * A native modal dialog: it sits in the top layer above the dock, holds focus while it is open,
 * and Escape cancels it. Fires `style-save` with `{ name, replace }` (`replace` a class, or null),
 * `style-discard`, and `style-cancel`.
 */
@customElement('heo-text-style-dialog')
export class HeoTextStyleDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      dialog {
        width: min(440px, calc(100vw - 32px));
        max-height: calc(100vh - 32px);
        padding: 16px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 14px;
        background: var(--heo-raised);
        color: var(--heo-text);
        box-shadow: var(--heo-shadow-lg);
        font: 12px/1.4 var(--heo-font, system-ui);
      }
      dialog::backdrop {
        background: rgb(15 23 42 / 30%);
        backdrop-filter: blur(3px);
      }
      form {
        display: grid;
        gap: 10px;
        margin: 0;
      }
      h2 {
        margin: 0;
        font-size: 14px;
      }
      .lede {
        margin: 0;
        color: var(--heo-text-dim);
      }
      .name {
        display: flex;
        align-items: center;
        height: 30px;
        padding: 0 8px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .name:focus-within {
        border-color: var(--heo-accent-line);
        box-shadow: 0 0 0 3px var(--heo-accent-soft);
      }
      .name input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font: inherit;
        font-size: 12.5px;
        outline: none;
      }
      .list {
        display: grid;
        gap: 1px;
        max-height: 220px;
        overflow: auto;
        padding: 3px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
      }
      .opt {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        padding: 5px 8px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
      }
      .opt:hover,
      .opt[aria-selected='true'] {
        background: var(--heo-hover);
      }
      .opt .p {
        overflow: hidden;
        max-height: 26px;
        font-size: 16px;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .opt .m {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .opt.new .p {
        color: var(--heo-accent-text);
        font-size: 12px;
      }
      .note {
        margin: 0;
        color: var(--heo-text-hint);
        font-size: 11px;
      }
      .note b {
        color: var(--heo-text-dim);
      }
      .warn {
        display: grid;
        gap: 6px;
        padding: 8px;
        border: 1px solid color-mix(in oklab, var(--heo-warn) 40%, transparent);
        border-radius: var(--heo-r-sm);
        background: color-mix(in oklab, var(--heo-warn) 8%, transparent);
      }
      .warn p {
        margin: 0;
        color: var(--heo-warn);
        font-size: 11px;
      }
      .cmp {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 6px;
      }
      .cmp div {
        overflow: hidden;
        padding: 8px;
        border: 1px solid var(--heo-line);
        border-radius: 8px;
        background: #fffdf8;
        color: #1c1917;
      }
      .cmp .s {
        display: block;
        overflow: hidden;
        max-height: 40px;
        font-size: 17px !important;
        line-height: 1.15 !important;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cmp small {
        display: block;
        margin-top: 4px;
        color: #78716c;
        font: 9.5px var(--heo-mono);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
      }
      .btn.discard {
        border-color: color-mix(in oklab, var(--heo-danger) 45%, transparent);
        color: var(--heo-danger);
      }
      /* Replacing a style changes every element using it: the button is the warning's colour. */
      .btn.replace {
        border-color: var(--heo-danger);
        background: var(--heo-danger);
        color: #fff;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: String }) mode: 'save' | 'leave' = 'save';
  @property({ attribute: false }) styles: readonly DialogTextStyle[] = [];
  /** The style the edits started from, if any. */
  @property({ type: String }) from = '';
  /** In `leave` mode: the style picked, applied once this is settled. */
  @property({ type: String }) target = '';
  /** The element's typography as it is now. */
  @property({ attribute: false }) look: Record<string, string> = {};
  @property({ type: Number }) changes = 0;
  @property({ type: String }) sample = '';
  @property({ type: String }) proposed = '';

  @state() private name = '';
  @query('dialog') private dialog!: HTMLDialogElement;

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return;
    if (this.open && !this.dialog.open) {
      this.name = this.proposed;
      this.dialog.showModal();
      void this.updateComplete.then(() => {
        const input = this.renderRoot.querySelector<HTMLInputElement>('input');
        input?.focus();
        input?.select();
      });
    } else if (!this.open && this.dialog.open) {
      this.dialog.close();
    }
  }

  #fire(type: 'style-save' | 'style-discard' | 'style-cancel', detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  get #match(): DialogTextStyle | undefined {
    const typed = this.name.trim().toLowerCase();
    return typed ? this.styles.find((one) => one.name.toLowerCase() === typed) : undefined;
  }

  #save(): void {
    const name = this.name.trim();
    if (!name) return;
    this.#fire('style-save', { name: this.#match?.name ?? name, replace: this.#match?.className ?? null });
  }

  override render(): TemplateResult {
    const typed = this.name.trim();
    const hit = this.#match;
    const sample = this.sample.trim().slice(0, 40) || 'The quick brown fox';
    const leave = this.mode === 'leave';
    return html`<dialog
      aria-labelledby="title"
      @cancel=${(event: Event) => {
        event.preventDefault();
        this.#fire('style-cancel');
      }}
      @keydown=${(event: KeyboardEvent) => event.stopPropagation()}
    >
      <form method="dialog" @submit=${(event: Event) => {
        event.preventDefault();
        this.#save();
      }}>
        <h2 id="title">${leave ? 'Save your changes?' : 'Save as text style'}</h2>
        <p class="lede">
          ${leave
            ? html`This text has ${this.changes === 1 ? 'a change' : `${this.changes} changes`}${this.from ? html` from <b>${this.from}</b>` : nothing}, not saved as a text style. Save them before switching to <b>${this.target}</b>, or discard them.`
            : html`Name it, or pick a text style to replace with this look.`}
        </p>
        <label class="name">
          <input
            type="text"
            aria-label="Text style name"
            placeholder="A new name, or one to replace"
            autocomplete="off"
            .value=${this.name}
            @input=${(event: Event) => {
              this.name = (event.target as HTMLInputElement).value;
            }}
          />
        </label>
        <div class="list" role="listbox" aria-label="Text styles">
          ${typed && !hit
            ? html`<button class="opt new" type="button" role="option" aria-selected="true" @click=${() => this.#save()}>
                <span class="p">+ New: “${typed}”</span><span class="m">.${textStyleClass(typed)}</span>
              </button>`
            : nothing}
          ${this.styles.map((one) => html`<button
            class="opt"
            type="button"
            role="option"
            data-style=${one.className}
            aria-selected=${hit?.className === one.className ? 'true' : 'false'}
            @click=${() => {
              this.name = one.name;
            }}
          >
            <span class="p" style=${`${lookStyle(one.declarations)};font-size:min(17px, ${one.declarations['font-size'] ?? '16px'})`}>${one.name}</span>
            <span class="m">replace · ${one.used}×</span>
          </button>`)}
        </div>
        ${hit
          ? html`<div class="warn" role="alert">
              <p><b>${hit.name}</b> is used by <b>${hit.used} ${hit.used === 1 ? 'element' : 'elements'}</b>. Saving replaces it: ${hit.used === 1 ? 'it changes' : `all ${hit.used} change`} to this look.</p>
              <div class="cmp">
                <div><span class="s" style=${lookStyle(hit.declarations)}>${sample}</span><small>${hit.name} now</small></div>
                <div><span class="s" style=${lookStyle(this.look)}>${sample}</span><small>after saving</small></div>
              </div>
            </div>`
          : html`<p class="note">A new text style, <b>.${textStyleClass(typed || 'style')}</b>, in the design system.${leave ? html` This text uses it, then switches to <b>${this.target}</b>.` : ' This text uses it.'}</p>`}
        <div class="actions">
          <button class="btn" type="button" @click=${() => this.#fire('style-cancel')}>Cancel</button>
          ${leave
            ? html`<button class="btn discard" type="button" @click=${() => this.#fire('style-discard')}>Discard changes</button>`
            : nothing}
          <button class=${hit ? 'btn replace' : 'btn primary'} type="submit" ?disabled=${!typed}>${hit ? `Replace ${hit.name}` : 'Save'}</button>
        </div>
      </form>
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-text-style-dialog': HeoTextStyleDialog;
  }
}
