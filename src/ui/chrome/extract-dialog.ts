import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { labelFor } from '../../core/dom.js';
import type { BlockExtraction, ClassExtraction } from '../../core/editor.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { BlockKind } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { buildSuggestions, valueKindFor } from '../suggestions.js';
import '../controls/value-field.js';
import '../controls/code-editor.js';

/**
 * Review step for extracting a class or a block.
 *
 * Both extractions turn something concrete into something reusable, and in both
 * cases the reusable version is only worth having if it is named well and trimmed
 * to what actually belongs in it. Doing that after the fact means editing a class
 * you have already applied in several places, so it happens here first.
 */
@customElement('heo-extract-dialog')
export class HeoExtractDialog extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 28;
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
        width: min(560px, 100%);
        max-height: min(86vh, 720px);
        border-radius: var(--heo-r-lg);
        overflow: hidden;
      }

      header {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 15px 16px;
        border-bottom: 1px solid var(--heo-line);
      }
      header .body {
        flex: 1 1 auto;
      }
      h2 {
        margin: 0 0 2px;
        font-size: 14px;
        font-weight: 600;
      }
      header p {
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.5;
      }

      .body-scroll {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 14px 16px;
        background: var(--heo-sunken);
        display: grid;
        gap: 12px;
      }

      .two {
        display: grid;
        grid-template-columns: 1fr 128px;
        gap: 7px;
      }

      .decl {
        display: grid;
        grid-template-columns: auto 92px minmax(0, 1fr);
        align-items: center;
        gap: 7px;
      }
      .decl input[type='checkbox'] {
        width: 14px;
        height: 14px;
        accent-color: var(--heo-accent);
        cursor: pointer;
      }
      .decl .p {
        overflow: hidden;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .decl.off .p,
      .decl.off heo-value-field {
        opacity: 0.4;
      }

      .preview {
        margin: 0;
        padding: 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-bg);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        line-height: 1.6;
        white-space: pre;
        overflow: auto;
        max-height: 150px;
      }

      .check {
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--heo-text-dim);
        font-size: 11.5px;
        cursor: pointer;
      }
      .check input {
        width: 14px;
        height: 14px;
        accent-color: var(--heo-accent);
      }

      footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 11px 16px;
        border-top: 1px solid var(--heo-line);
      }
      footer .spacer {
        flex: 1 1 auto;
      }
      .error {
        color: var(--heo-danger);
        font-size: 11px;
        line-height: 1.45;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.extraction] as const,
    shallowArrayEquals,
  );

  @query('.name-input') private nameInput?: HTMLInputElement;

  override updated(): void {
    // Naming is the point of this dialog, so the name field takes focus.
    if (this.nameInput && this.shadowRoot?.activeElement !== this.nameInput) {
      if (!this.nameInput.dataset.touched) {
        this.nameInput.dataset.touched = 'yes';
        this.nameInput.focus();
        this.nameInput.select();
      }
    }
  }

  override render(): TemplateResult | typeof nothing {
    const pending = this.state.value.extraction;
    if (!pending) return nothing;

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-label=${pending.mode === 'class' ? 'Extract a class' : 'Save as a block'}
      @keydown=${this.#onKeyDown}
    >
      ${pending.mode === 'class' ? this.#renderClass(pending) : this.#renderBlock(pending)}
    </div>`;
  }

  #renderClass(pending: ClassExtraction): TemplateResult {
    const properties = Object.keys(pending.declarations);
    const kept = properties.filter((property) => pending.include[property] !== false);

    return html`
      <header>
        <div class="body">
          <h2>Extract a class</h2>
          <p>
            ${properties.length} declaration${properties.length === 1 ? '' : 's'} from
            <code class="mono">${labelFor(pending.element)}</code>. Name it for what it is, and keep
            only what belongs in every use.
          </p>
        </div>
        ${this.#closeButton()}
      </header>

      <div class="body-scroll">
        <div class="field">
          <span class="label">Class name</span>
          <input
            class="input mono name-input"
            type="text"
            .value=${pending.name}
            spellcheck="false"
            autocomplete="off"
            aria-label="Class name"
            @input=${(event: Event) =>
              this.editor.updateExtraction({ name: (event.target as HTMLInputElement).value })}
          />
        </div>

        <div class="field">
          <span class="label">Declarations (${kept.length} of ${properties.length})</span>
          ${repeat(
            properties,
            (property) => property,
            (property) => {
              const on = pending.include[property] !== false;
              return html`<div class=${`decl${on ? '' : ' off'}`}>
                <input
                  type="checkbox"
                  .checked=${on}
                  aria-label=${`Include ${property}`}
                  @change=${(event: Event) =>
                    this.editor.updateExtraction({
                      include: {
                        ...pending.include,
                        [property]: (event.target as HTMLInputElement).checked,
                      },
                    })}
                />
                <span class="p" title=${property}>${property}</span>
                <heo-value-field
                  .value=${pending.declarations[property]}
                  .kind=${valueKindFor(property)}
                  .property=${property}
                  .suggestions=${buildSuggestions(this.editor, property, pending.element)}
                  @value-change=${(event: CustomEvent<{ value: string }>) =>
                    this.editor.updateExtraction({
                      declarations: {
                        ...pending.declarations,
                        [property]: event.detail.value,
                      },
                    })}
                ></heo-value-field>
              </div>`;
            },
          )}
        </div>

        <label class="check">
          <input
            type="checkbox"
            .checked=${pending.stripInline}
            @change=${(event: Event) =>
              this.editor.updateExtraction({
                stripInline: (event.target as HTMLInputElement).checked,
              })}
          />
          Remove these declarations from the element's style attribute
        </label>

        <div class="field">
          <span class="label">Result</span>
          <pre class="preview">${this.#classPreview(pending)}</pre>
        </div>
      </div>

      ${this.#footer(pending.error, 'Create class')}
    `;
  }

  #classPreview(pending: ClassExtraction): string {
    const name = pending.name.trim() || 'unnamed';
    const body = Object.entries(pending.declarations)
      .filter(([property]) => pending.include[property] !== false)
      .map(([property, value]) => `  ${property}: ${value};`)
      .join('\n');
    return `.${name} {\n${body || '  /* nothing selected */'}\n}`;
  }

  #renderBlock(pending: BlockExtraction): TemplateResult {
    return html`
      <header>
        <div class="body">
          <h2>Save as a block</h2>
          <p>
            Captures <code class="mono">${labelFor(pending.element)}</code> and the classes it uses,
            so it can be inserted again from the Library.
          </p>
        </div>
        ${this.#closeButton()}
      </header>

      <div class="body-scroll">
        <div class="two">
          <div class="field">
            <span class="label">Name</span>
            <input
              class="input name-input"
              type="text"
              .value=${pending.name}
              aria-label="Block name"
              @input=${(event: Event) =>
                this.editor.updateExtraction({ name: (event.target as HTMLInputElement).value })}
            />
          </div>
          <div class="field">
            <span class="label">Kind</span>
            <select
              class="input"
              .value=${pending.kind}
              aria-label="Block kind"
              @change=${(event: Event) =>
                this.editor.updateExtraction({
                  kind: (event.target as HTMLSelectElement).value as BlockKind,
                })}
            >
              <option value="component" ?selected=${pending.kind === 'component'}>Component</option>
              <option value="container" ?selected=${pending.kind === 'container'}>Container</option>
            </select>
          </div>
        </div>

        <div class="field">
          <span class="label">Description</span>
          <input
            class="input"
            type="text"
            .value=${pending.description}
            aria-label="Description"
            @input=${(event: Event) =>
              this.editor.updateExtraction({
                description: (event.target as HTMLInputElement).value,
              })}
          />
        </div>

        <div class="field">
          <span class="label">Markup</span>
          <heo-code-editor
            language="html"
            rows="9"
            heading="Block markup"
            .value=${pending.html}
            @code-input=${(event: CustomEvent<{ value: string }>) =>
              this.editor.updateExtraction({ html: event.detail.value })}
          ></heo-code-editor>
        </div>

        <div class="field">
          <span class="label">CSS carried with the block</span>
          <heo-code-editor
            language="css"
            rows="6"
            heading="CSS carried with the block"
            .value=${pending.css}
            placeholder="No classes from the design system are used here."
            @code-input=${(event: CustomEvent<{ value: string }>) =>
              this.editor.updateExtraction({ css: event.detail.value })}
          ></heo-code-editor>
        </div>
      </div>

      ${this.#footer(pending.error, 'Save block')}
    `;
  }

  #closeButton(): TemplateResult {
    return html`<button
      class="btn icon ghost"
      type="button"
      aria-label="Cancel"
      @click=${() => this.editor.cancelExtraction()}
    >
      ${icon('close', 14)}
    </button>`;
  }

  #footer(error: string, confirmLabel: string): TemplateResult {
    return html`<footer>
      ${error ? html`<span class="error">${icon('close', 11)} ${error}</span>` : nothing}
      <span class="spacer"></span>
      <button class="btn" type="button" @click=${() => this.editor.cancelExtraction()}>
        Cancel
      </button>
      <button class="btn primary" type="button" @click=${() => this.editor.commitExtraction()}>
        ${icon('check', 12)} ${confirmLabel}
      </button>
    </footer>`;
  }

  #onKeyDown(event: KeyboardEvent): void {
    // Stop the page-level keymap from acting on anything typed in here.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.editor.cancelExtraction();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.editor.commitExtraction();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-extract-dialog': HeoExtractDialog;
  }
}
