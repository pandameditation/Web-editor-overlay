import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { labelFor } from '../../core/dom.js';
import { normalizeCustomElementTag, PROP_TYPES, type BlockPropRow } from '../../core/library.js';
import type { BlockExtraction, ClassExtraction } from '../../core/editor.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { BlockKind, PropSpec } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { buildSuggestions, valueKindFor } from '../suggestions.js';
import '../controls/value-field.js';
import { type CodeLanguage } from '../controls/highlight.js';
import '../controls/code-editor.js';

/**
 * Review step for extracting a class or a block.
 *
 * Both extractions turn something concrete into something reusable, and in both
 * cases the reusable version is only worth having if it is named well and trimmed
 * to what actually belongs in it. Doing that after the fact means editing a class
 * you have already applied in several places, so it happens here first.
 */
/**
 * The three buffers a block is authored from, described once.
 *
 * One table rather than three near-identical template branches, because the editor
 * is now a single instance the tab merely re-points — and because the expanded view
 * builds its own tab strip from the same list, so a fourth buffer would arrive in
 * both places at once.
 */
const SOURCE_TABS = {
  html: {
    label: 'HTML',
    language: 'html' as const,
    heading: 'Block HTML',
    field: 'html' as const,
    placeholder: '<div class="my-block">…</div>  ·  use {{propName}} for props',
  },
  css: {
    label: 'CSS',
    language: 'css' as const,
    heading: 'Block CSS',
    field: 'css' as const,
    placeholder: '.my-block { display: grid; gap: var(--space-md, 16px); }',
  },
  js: {
    label: 'JS / Lit',
    language: 'js' as const,
    heading: 'Component module',
    field: 'script' as const,
    placeholder:
      "import { LitElement, html, css } from 'lit';\n\nclass MyWidget extends LitElement { … }\ncustomElements.define('my-widget', MyWidget);",
  },
} satisfies Record<
  string,
  {
    label: string;
    language: CodeLanguage;
    heading: string;
    field: 'html' | 'css' | 'script';
    placeholder: string;
  }
>;

type SourceTab = keyof typeof SOURCE_TABS;

const SOURCE_TAB_ORDER = ['html', 'css', 'js'] as const satisfies readonly SourceTab[];

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
      /* Both halves equal, for description + category where neither is secondary. */
      .two.even {
        grid-template-columns: 1fr 1fr;
      }

      /* ---- The two-step wizard ---- */

      .steps {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        padding: 9px 16px;
        border-bottom: 1px solid var(--heo-line);
      }
      .steps .step {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--heo-text-faint);
        font-size: 11px;
      }
      .steps .step b {
        display: grid;
        place-items: center;
        width: 15px;
        height: 15px;
        border: 1px solid currentColor;
        border-radius: 50%;
        font-size: 9px;
        font-weight: 600;
      }
      .steps .step[data-on] {
        color: var(--heo-text);
      }
      .steps .step[data-on] b {
        border-color: var(--heo-accent);
        background: var(--heo-accent);
        color: #fff;
      }
      .steps .step[data-done] {
        color: var(--heo-accent);
      }
      .steps .step[data-muted] {
        opacity: 0.55;
      }
      .steps .bar {
        flex: 0 0 26px;
        height: 1px;
        background: var(--heo-line);
      }

      .tabs {
        display: flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
      }
      .tabs button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        flex: 1 1 auto;
        justify-content: center;
        padding: 4px 9px;
        border: 0;
        border-radius: calc(var(--heo-r-sm) - 2px);
        background: transparent;
        color: var(--heo-text-faint);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .tabs button:hover {
        color: var(--heo-text);
      }
      .tabs button[data-on] {
        background: var(--heo-accent);
        color: #fff;
      }
      /* Which buffers have something in them, so a component's parts are visible
         without clicking through all three. */
      .tabs .dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentColor;
        opacity: 0.7;
      }

      .lede {
        margin: 0;
        color: var(--heo-text-faint);
        font-size: 11px;
      }
      .note {
        margin: 5px 0 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.5;
      }

      /* One prop per card, one field per line. Five controls on a row left every one
         of them too narrow to read, which is the whole reason this moved to a modal. */
      .propcard {
        display: grid;
        gap: 8px;
        padding: 11px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-surface);
      }
      .propcard > header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0;
        border: 0;
        background: none;
      }
      .propcard > header code {
        color: var(--heo-accent);
        font-size: 11px;
      }
      .propcard .renamed {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--heo-text-faint);
        font-size: 10px;
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

  /** Which source buffer is showing. View state, so it lives here. */
  @state() private sourceTab: SourceTab = 'html';

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
    const editing = pending.id !== null;
    const onProps = pending.step === 'props';
    const captured = pending.element;
    const tag = normalizeCustomElementTag(pending.tag);
    const tagCorrected = Boolean(pending.tag.trim()) && tag !== pending.tag.trim();

    return html`
      <header>
        <div class="body">
          <h2>${editing ? `Edit ${pending.name || 'block'}` : 'New block'}</h2>
          <p>
            ${captured
        ? html`Captures <code class="mono">${labelFor(captured)}</code> and the classes it uses, so
                it can be inserted again from the Library.`
        : html`Markup, styles and — for a real web component — a module, saved to the Library
                for reuse.`}
          </p>
        </div>
        ${this.#closeButton()}
      </header>

      <!--
        Two steps rather than one long form, and the second only exists when the markup
        has placeholders. That keeps the common case a single screen while giving props
        the room to be readable, which they never had crammed beside the code.
      -->
      <nav class="steps" aria-label="Progress">
        <span class="step" ?data-on=${!onProps} ?data-done=${onProps}>
          ${onProps ? icon('check', 10) : html`<b>1</b>`} Source
        </span>
        <span class="bar"></span>
        <span class="step" ?data-on=${onProps} ?data-muted=${!onProps}>
          <b>2</b> Props
        </span>
      </nav>

      <div class="body-scroll">
        ${onProps ? this.#renderBlockProps(pending) : this.#renderBlockSource(pending, tag, tagCorrected)}
      </div>
      ${this.#blockFooter(pending)}
    `;
  }

  /** Step one: what the block is, and the three buffers it is made of. */
  #renderBlockSource(
    pending: BlockExtraction,
    tag: string,
    tagCorrected: boolean,
  ): TemplateResult {
    const active = SOURCE_TABS[this.sourceTab];
    const isElement = Boolean(tag && pending.script.trim());
    return html`
      <div class="two">
        <div class="field">
          <span class="label">Name</span>
          <input
            class="input name-input"
            type="text"
            .value=${pending.name}
            aria-label="Block name"
            placeholder="Pricing table"
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

      <div class="two even">
        <div class="field">
          <span class="label">Description</span>
          <input
            class="input"
            type="text"
            .value=${pending.description}
            aria-label="Description"
            placeholder="What it is for"
            @input=${(event: Event) =>
        this.editor.updateExtraction({
          description: (event.target as HTMLInputElement).value,
        })}
          />
        </div>
        <div class="field">
          <span class="label">Category</span>
          <input
            class="input"
            type="text"
            list="heo-extract-categories"
            .value=${pending.category}
            aria-label="Category"
            placeholder=${pending.kind === 'container' ? 'Layout' : 'Components'}
            title="Which group this block appears under in the Library"
            @input=${(event: Event) =>
        this.editor.updateExtraction({ category: (event.target as HTMLInputElement).value })}
          />
          <datalist id="heo-extract-categories">
            ${this.#categories().map((name) => html`<option value=${name}></option>`)}
          </datalist>
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="Source files">
        ${SOURCE_TAB_ORDER.map(
          (id) => html`<button
            type="button"
            role="tab"
            aria-selected=${this.sourceTab === id}
            ?data-on=${this.sourceTab === id}
            @click=${() => {
              this.sourceTab = id;
            }}
          >
            ${SOURCE_TABS[id].label}
            ${pending[SOURCE_TABS[id].field].trim()
              ? html`<span class="dot" title="Has content"></span>`
              : nothing}
          </button>`,
        )}
      </div>

      ${this.sourceTab === 'js'
        ? html`<div class="field">
              <span class="label">Custom element tag</span>
              <input
                class="input mono"
                type="text"
                placeholder="my-widget"
                .value=${pending.tag}
                aria-label="Custom element tag"
                @input=${(event: Event) =>
            this.editor.updateExtraction({ tag: (event.target as HTMLInputElement).value })}
                @blur=${() => this.editor.updateExtraction({ tag })}
              />
              ${tagCorrected
            ? html`<p class="note">
                    ${icon('sparkle', 11)} Will be used as
                    <code class="mono">${tag || '(unusable — needs a letter)'}</code>. Custom
                    element names are lowercase and need a hyphen.
                  </p>`
            : nothing}
            </div>`
        : nothing}

      <div class="field">
        <span class="label">${active.heading}</span>
        <heo-code-editor
          language=${active.language}
          rows=${this.sourceTab === 'js' ? 12 : 9}
          heading=${active.heading}
          .value=${pending[active.field]}
          .tabs=${SOURCE_TAB_ORDER.map((id) => ({ id, label: SOURCE_TABS[id].label }))}
          activeTab=${this.sourceTab}
          placeholder=${this.sourceTab === 'html' && isElement
        ? 'Ignored: this block inserts its custom element tag instead.'
        : active.placeholder}
          @tab-change=${(event: CustomEvent<{ id: string }>) => {
        this.sourceTab = event.detail.id as SourceTab;
      }}
          @code-input=${(event: CustomEvent<{ value: string }>) =>
        this.editor.updateExtraction({ [active.field]: event.detail.value })}
        ></heo-code-editor>
        ${this.sourceTab === 'js'
        ? html`<p class="note">
              Imports of <code class="mono">lit</code> resolve to the copy the overlay already
              loads, so a component pasted here runs without a build step. The module has to call
              <code class="mono">customElements.define</code> with the tag above.
            </p>`
        : nothing}
      </div>
    `;
  }

  /**
   * Step two: one prop per card, one field per line.
   *
   * The previous layout put five controls on a row, which at panel width left every
   * one of them too narrow to read. Stacking them costs vertical space that a modal
   * has and a side panel does not.
   */
  #renderBlockProps(pending: BlockExtraction): TemplateResult {
    const rows = pending.props;
    return html`
      <p class="lede">
        ${rows.length} ${rows.length === 1 ? 'prop' : 'props'} found in the markup. Renaming one
        rewrites its placeholder; the description is what the insert form shows.
      </p>
      ${rows.map(
      (row, index) => html`<section class="propcard">
          <header>
            <code class="mono">{{${row.placeholder}}}</code>
            ${row.name !== row.placeholder
          ? html`<span class="renamed">${icon('sparkle', 10)} renames to {{${row.name}}}</span>`
          : nothing}
          </header>
          <div class="field">
            <span class="label">Name</span>
            <input
              class="input mono"
              type="text"
              .value=${row.name}
              placeholder="propName"
              aria-label=${`Name for ${row.placeholder}`}
              @input=${(event: Event) =>
          this.#editProp(index, { name: (event.target as HTMLInputElement).value })}
            />
          </div>
          <div class="field">
            <span class="label">Type</span>
            <select
              class="input"
              aria-label=${`Type for ${row.name}`}
              @change=${(event: Event) =>
          this.#editProp(index, {
            type: (event.target as HTMLSelectElement).value as PropSpec['type'],
          })}
            >
              ${PROP_TYPES.map(
            (type) => html`<option value=${type} ?selected=${row.type === type}>${type}</option>`,
          )}
            </select>
          </div>
          <div class="field">
            <span class="label">Description</span>
            <input
              class="input"
              type="text"
              .value=${row.description}
              placeholder="What belongs here"
              aria-label=${`Description for ${row.name}`}
              @input=${(event: Event) =>
          this.#editProp(index, { description: (event.target as HTMLInputElement).value })}
            />
          </div>
          <div class="field">
            <span class="label">Default</span>
            <input
              class="input"
              type="text"
              .value=${row.default}
              placeholder="Used until the user changes it"
              aria-label=${`Default value for ${row.name}`}
              @input=${(event: Event) =>
          this.#editProp(index, { default: (event.target as HTMLInputElement).value })}
            />
          </div>
        </section>`,
    )}
    `;
  }

  #editProp(index: number, patch: Partial<BlockPropRow>): void {
    const pending = this.state.value.extraction;
    if (pending?.mode !== 'block') return;
    const props = [...pending.props];
    props[index] = { ...props[index], ...patch };
    this.editor.updateExtraction({ props });
  }

  /** Category names in use, plus the conventional set so an empty library still helps. */
  #categories(): string[] {
    const found = new Set<string>([
      'Layout', 'Components', 'Marketing', 'Media', 'Actions', 'Extracted',
    ]);
    for (const block of this.editor.library.list()) {
      if (block.category) found.add(block.category);
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  }

  /** Confirm advances a step or saves, so one button means "continue" throughout. */
  #blockFooter(pending: BlockExtraction): TemplateResult {
    const onProps = pending.step === 'props';
    const editing = pending.id !== null;
    const label = onProps ? (editing ? 'Update block' : 'Save block') : 'Continue';
    return html`<footer>
      ${pending.error
        ? html`<span class="error">${icon('close', 11)} ${pending.error}</span>`
        : nothing}
      <span class="spacer"></span>
      ${onProps
        ? html`<button class="btn" type="button" @click=${() => this.editor.backToBlockSource()}>
            ${icon('chevronLeft', 12)} Back
          </button>`
        : html`<button class="btn" type="button" @click=${() => this.editor.cancelExtraction()}>
            Cancel
          </button>`}
      <button class="btn primary" type="button" @click=${() => this.editor.commitExtraction()}>
        ${icon(onProps ? 'check' : 'chevronRight', 12)} ${label}
      </button>
    </footer>`;
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
