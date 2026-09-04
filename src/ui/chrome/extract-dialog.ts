import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { normalizeClassName, planClassMerge, type ClassMergePlan } from '../../core/classes.js';
import { labelFor } from '../../core/dom.js';
import { normalizeCustomElementTag, PROP_TYPES, type BlockPropRow } from '../../core/library.js';
import type { BlockExtraction, ClassExtraction } from '../../core/editor.js';
import { ModalController } from '../../core/modal.js';
import { listen, unlisten } from '../../core/shield.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { BlockKind, PropSpec } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { anchoredStyle } from '../place.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { buildSuggestions, classSuggestions, valueKindFor } from '../suggestions.js';
import type { ValueSuggestion } from '../controls/value-field.js';
import '../controls/value-field.js';
import { type CodeLanguage } from '../controls/highlight.js';
import '../controls/code-editor.js';
import '../controls/segmented.js';

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
        background: var(--heo-raised);
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
      /* One line per declaration so the diff can be shown where the result is,
         rather than as a second list the user has to reconcile with it. */
      .preview .line {
        display: block;
      }
      .preview .line .mark {
        display: inline-block;
        width: 1ch;
        color: var(--heo-text-faint);
      }
      .preview .line.added {
        color: var(--heo-accent);
      }
      .preview .line.added .mark {
        color: var(--heo-accent);
      }
      .preview .line.replaced {
        color: var(--heo-text);
      }
      .preview .line.replaced .mark,
      .preview .line.replaced .was {
        color: var(--heo-warn);
      }
      .preview .line.replaced .was {
        text-decoration: line-through;
        opacity: 0.8;
      }
      .preview .line.kept {
        opacity: 0.62;
      }

      /* ---- Naming, with the project's classes one keystroke away ---- */

      .combo {
        position: relative;
        display: flex;
      }
      .combo .input {
        padding-right: 26px;
      }
      .combo .chev {
        position: absolute;
        top: 0;
        right: 0;
        display: grid;
        place-items: center;
        width: 24px;
        height: 28px;
        border: 0;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .combo .chev:hover {
        color: var(--heo-text);
      }

      /* In the top layer, because the field sits in a scrolling body and an
         absolutely positioned list would be clipped by it. */
      .options {
        position: fixed;
        z-index: 30;
        margin: 0;
        padding: 4px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-lg);
        overflow-y: auto;
        inset: auto;
      }
      .options .group {
        padding: 5px 7px 3px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .options .option {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 5px 7px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text);
        font: inherit;
        font-size: 11.5px;
        text-align: left;
        cursor: pointer;
      }
      .options .option:hover,
      .options .option[aria-selected='true'] {
        background: var(--heo-hover);
      }
      .options .option .n {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        font-family: var(--heo-mono);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .options .option .meta {
        flex: 0 0 auto;
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .options .none {
        padding: 7px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }

      /* ---- What merging into an existing class would do ---- */

      .merge {
        display: grid;
        gap: 8px;
        padding: 10px 11px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-accent-soft);
      }
      .merge .mhead {
        display: flex;
        align-items: baseline;
        gap: 6px;
        font-size: 11.5px;
      }
      .merge .mhead b {
        font-family: var(--heo-mono);
        font-weight: 600;
      }
      .merge .mhead .spacer {
        flex: 1 1 auto;
      }
      .merge .mhead .meta {
        color: var(--heo-text-dim);
        font-size: 10px;
      }
      .merge .tally {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 6px;
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 10.5px;
      }
      .merge .tally .t {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .merge .tally .t b {
        color: var(--heo-text);
        font-weight: 600;
      }
      .merge .warn {
        display: grid;
        gap: 5px;
        padding: 8px 9px;
        border-radius: var(--heo-r-sm);
        background: var(--heo-bg);
      }
      .merge .warn > p {
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .merge .warn ul {
        display: grid;
        gap: 3px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      /* Property, old, arrow, new — as a grid so the arrows line up down the list,
         with the old value only as wide as it needs so the pair reads as one move. */
      .merge .warn li {
        display: grid;
        grid-template-columns: minmax(0, 88px) minmax(0, max-content) auto minmax(0, 1fr);
        align-items: baseline;
        gap: 6px;
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }
      .merge .warn li .p {
        overflow: hidden;
        color: var(--heo-text-dim);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .merge .warn li .from {
        overflow: hidden;
        color: var(--heo-text-faint);
        text-decoration: line-through;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .merge .warn li .to {
        overflow: hidden;
        color: var(--heo-accent);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .merge .note {
        margin: 0;
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
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 11px 16px;
        border-top: 1px solid var(--heo-line);
      }
      footer .spacer {
        flex: 1 1 auto;
      }
      /* Beside the save button rather than up in the form: it is a decision about what
         saving does, so it belongs where saving is. */
      footer .apply {
        flex: 0 1 auto;
        min-width: 0;
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

  /** Whether the class-name list is showing, and which row the keyboard is on. */
  @state() private nameOpen = false;
  @state() private nameHighlight = -1;
  @state() private namePopupStyle = '';
  /**
   * Whether the list narrows to what is in the field.
   *
   * Typing filters, as an autocomplete must. Opening the list deliberately does not:
   * the field arrives pre-filled with a suggested name that matches nothing, so
   * filtering by it would make the chevron look broken.
   */
  @state() private nameFilter = false;

  @query('.name-input') private nameInput?: HTMLInputElement;

  /** The rows the list is currently offering, so key handling and render agree. */
  #nameOptions: ValueSuggestion[] = [];
  /**
   * Naming is the point of this dialog, so the name field takes the opening focus,
   * with its suggested value selected for typing over.
   */
  protected modal = new ModalController(this, {
    initialFocus: '.name-input',
    initialSelect: true,
  });
  /**
   * Keep the list under its field when the page moves beneath it.
   *
   * The list is a popover in the top layer, positioned in viewport coordinates, so
   * nothing repositions it automatically: a resize re-centres the dialog and would
   * leave the list stranded where the field used to be.
   */
  #reposition = (): void => {
    if (this.nameOpen) this.#placeNameOptions();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    // `listen`, because `scroll` is a type the event shield suppresses for the page and
    // this dialog is one of the things it is protecting.
    listen(window, 'resize', this.#reposition);
    listen(window, 'scroll', this.#reposition, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(window, 'resize', this.#reposition);
    unlisten(window, 'scroll', this.#reposition, true);
  }

  override updated(): void {
    this.#placeNameOptions();
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
      @pointerdown=${this.#onPointerDown}
    >
      ${pending.mode === 'class' ? this.#renderClass(pending) : this.#renderBlock(pending)}
    </div>`;
  }

  #renderClass(pending: ClassExtraction): TemplateResult {
    const properties = Object.keys(pending.declarations);
    const kept = properties.filter((property) => pending.include[property] !== false);
    const plan = this.#mergePlan(pending);
    this.#nameOptions = classSuggestions(this.editor, this.nameFilter ? pending.name : '');

    return html`
      <header>
        <div class="body">
          <h2>${plan.existing ? 'Add to a class' : 'Extract a class'}</h2>
          <p>
            ${properties.length} declaration${properties.length === 1 ? '' : 's'} from
            <code class="mono">${labelFor(pending.element)}</code>.
            ${plan.existing
        ? html`Naming a class that already exists folds them into it, so check what that
              replaces before committing.`
        : html`Name it for what it is, and keep only what belongs in every use.`}
          </p>
        </div>
        ${this.#closeButton()}
      </header>

      <div class="body-scroll">
        <div class="field">
          <span class="label">Class name</span>
          <div class="combo">
            <input
              class="input mono name-input"
              type="text"
              role="combobox"
              aria-expanded=${this.nameOpen}
              aria-autocomplete="list"
              aria-controls="heo-class-options"
              .value=${pending.name}
              spellcheck="false"
              autocomplete="off"
              aria-label="Class name"
              placeholder="new name, or an existing class to add to"
              @input=${this.#onNameInput}
              @keydown=${this.#onNameKeyDown}
              @focus=${() => {
        // The opening focus belongs to the dialog, not to the user. Clicking into
        // the field should offer the project's classes; a list thrown over a name
        // that was suggested for you buries what you came here to read. The first
        // focus is consumed rather than timed, which is what makes it reliable
        // whichever pass the modal controller lands on.
        const input = this.nameInput;
        if (input && !input.dataset.touched) {
          input.dataset.touched = 'yes';
          return;
        }
        this.nameOpen = true;
        this.nameFilter = false;
        this.nameHighlight = -1;
      }}
              @blur=${this.#onNameBlur}
            />
            <button
              class="chev"
              type="button"
              tabindex="-1"
              title="Show the project's classes"
              aria-label="Show the project's classes"
              @pointerdown=${(event: Event) => event.preventDefault()}
              @click=${this.#toggleNameOptions}
            >
              ${icon('chevronDown', 12)}
            </button>
          </div>
          ${this.nameOpen ? this.#renderNameOptions(pending) : nothing}
        </div>

        ${plan.existing ? this.#renderMerge(pending, plan) : nothing}

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
          <pre class="preview">${this.#classPreview(pending, plan)}</pre>
        </div>
      </div>

      ${this.#footer(pending.error, this.#confirmLabel(pending, plan))}
    `;
  }

  /* ---------------------------------------------------------------------- */
  /* Naming: the project's classes, and what reusing one would do           */
  /* ---------------------------------------------------------------------- */

  /**
   * What committing would do to the class the name points at.
   *
   * Built from the same function the command uses, on the declarations as trimmed
   * by the checkboxes, so the review and the result cannot disagree.
   */
  #mergePlan(pending: ClassExtraction): ClassMergePlan {
    const declarations = Object.fromEntries(
      Object.entries(pending.declarations).filter(
        ([property, value]) => pending.include[property] !== false && value.trim() !== '',
      ),
    );
    const name = normalizeClassName(pending.name);
    return planClassMerge(
      name ? this.editor.classes.get(name) : undefined,
      declarations,
      pending.collision,
    );
  }

  #confirmLabel(pending: ClassExtraction, plan: ClassMergePlan): string {
    if (!plan.existing) return 'Create class';
    return pending.collision === 'replace'
      ? `Replace .${plan.existing.name}`
      : `Merge into .${plan.existing.name}`;
  }

  /**
   * The project's classes, ranked, as a listbox under the field.
   *
   * The name field used to be a blank box, which made reusing a class something you
   * had to already know the name of — and the whole reason a group of declarations
   * is worth extracting is often that a class for it already exists.
   */
  #renderNameOptions(pending: ClassExtraction): TemplateResult {
    const options = this.#nameOptions;
    const typed = normalizeClassName(pending.name);
    if (!options.length) {
      return html`<div
        class="options"
        id="heo-class-options"
        popover="manual"
        style=${this.namePopupStyle}
      >
        <div class="none">
          ${this.nameFilter && typed
          ? html`No class matches — <code class="mono">.${typed}</code> will be a new one.`
          : 'This project has no classes to add to yet.'}
        </div>
      </div>`;
    }

    // Grouped in the order the groups first appear, matching the value field's list.
    const groups: Array<{ name: string; items: ValueSuggestion[] }> = [];
    for (const item of options) {
      const group = groups.find((one) => one.name === item.group);
      if (group) group.items.push(item);
      else groups.push({ name: item.group, items: [item] });
    }

    let index = -1;
    return html`<div
      class="options"
      id="heo-class-options"
      popover="manual"
      style=${this.namePopupStyle}
      role="listbox"
      aria-label="Project classes"
    >
      ${repeat(
      groups,
      (group) => group.name,
      (group) => html`
          <div class="group">${group.name}</div>
          ${repeat(
        group.items,
        (item) => item.value,
        (item) => {
          index += 1;
          const current = index;
          return html`<button
                class="option"
                type="button"
                role="option"
                aria-selected=${current === this.nameHighlight}
                title=${`Add these declarations to .${item.value}`}
                @pointerdown=${(event: Event) => event.preventDefault()}
                @pointerenter=${() => {
              this.nameHighlight = current;
            }}
                @click=${() => this.#chooseName(item.value)}
              >
                <span class="n">.${item.value}</span>
                ${item.hint ? html`<span class="meta">${item.hint}</span>` : nothing}
              </button>`;
        },
      )}
        `,
    )}
    </div>`;
  }

  /**
   * The existing class, and every value the merge would overwrite.
   *
   * Listing the overrides is the point. Merging into a class used by a dozen
   * elements changes all of them, and "which of its values am I about to move" is
   * the one question the user cannot answer from anywhere else in this dialog.
   */
  #renderMerge(pending: ClassExtraction, plan: ClassMergePlan): TemplateResult {
    const entry = plan.existing!;
    const held = Object.keys(entry.declarations).length;
    const uses = this.editor.classes.usage().get(entry.name) ?? 0;
    const replacing = pending.collision === 'replace';
    const dropped = replacing
      ? Object.keys(entry.declarations).filter(
        (property) => plan.result[property] === undefined,
      )
      : [];

    return html`<div class="merge">
      <div class="mhead">
        ${icon('blocks', 12)}
        <b class="mono">.${entry.name}</b>
        <span class="meta">
          ${held} declaration${held === 1 ? '' : 's'}${uses
        ? ` · on ${uses} element${uses === 1 ? '' : 's'}`
        : ' · not applied anywhere yet'}${entry.origin === 'stylesheet'
          ? ' · from a stylesheet'
          : ''}
        </span>
      </div>

      <heo-segmented
        label="What to do with the existing class"
        .value=${pending.collision}
        .options=${[
        {
          value: 'merge',
          label: 'Merge',
          title: 'Add these declarations and keep everything else the class holds',
        },
        {
          value: 'replace',
          label: 'Replace',
          title: 'The class becomes exactly these declarations',
        },
      ]}
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        if (!event.detail.value) return;
        this.editor.updateExtraction({
          collision: event.detail.value === 'replace' ? 'replace' : 'merge',
        });
      }}
      ></heo-segmented>

      <p class="tally">
        ${plan.added.length
        ? html`<span class="t">${icon('plus', 10)} <b>${plan.added.length}</b> added</span>`
        : nothing}
        ${plan.replaced.length
        ? html`<span class="t"
              >${icon('refresh', 10)} <b>${plan.replaced.length}</b> replaced</span
            >`
        : nothing}
        ${plan.unchanged.length
        ? html`<span class="t"
              >${icon('check', 10)} <b>${plan.unchanged.length}</b> already the same</span
            >`
        : nothing}
        ${plan.kept.length
        ? html`<span class="t"
              >${icon('lock', 10)} <b>${plan.kept.length}</b> left untouched</span
            >`
        : nothing}
        ${dropped.length
        ? html`<span class="t"
              >${icon('trash', 10)} <b>${dropped.length}</b> dropped</span
            >`
        : nothing}
      </p>

      ${plan.replaced.length
        ? html`<div class="warn">
            <p>
              ${uses > 1
            ? html`These values change on all ${uses} elements using
                  <code class="mono">.${entry.name}</code>:`
            : html`These values change on <code class="mono">.${entry.name}</code>:`}
            </p>
            <ul>
              ${plan.replaced.map(
              (change) => html`<li title=${`${change.property}: ${change.from} → ${change.to}`}>
                    <span class="p">${change.property}</span>
                    <span class="from">${change.from}</span>
                    <span aria-hidden="true">→</span>
                    <span class="to">${change.to}</span>
                  </li>`,
            )}
            </ul>
          </div>`
        : nothing}

      ${dropped.length
        ? html`<div class="warn">
            <p>
              Replacing removes what the class held besides these:
              <code class="mono">${dropped.join(', ')}</code>. Undo puts it back.
            </p>
          </div>`
        : nothing}

      ${plan.noop
        ? html`<p class="hint note">
            <code class="mono">.${entry.name}</code> already sets all of these, so committing only
            applies the class to this element.
          </p>`
        : nothing}
    </div>`;
  }

  /**
   * The rule as it will end up, with each line marked for what happened to it.
   *
   * A diff in the place the result is shown, rather than a separate list to
   * reconcile against it: `+` is new to the class, `~` replaces a value, and a
   * dimmed line is one the merge leaves alone.
   */
  #classPreview(pending: ClassExtraction, plan: ClassMergePlan): TemplateResult {
    const name = normalizeClassName(pending.name) || pending.name.trim() || 'unnamed';
    const entries = Object.entries(plan.result);
    const replaced = new Map(plan.replaced.map((change) => [change.property, change.from]));
    const added = new Set(plan.added);

    return html`<span class="line">.${name} {</span>${entries.length
      ? entries.map(([property, value]) => {
        const was = replaced.get(property);
        // Everything is "added" when the class is new, so the marks only earn
        // their keep against an existing one.
        const kind = !plan.existing
          ? 'new'
          : was !== undefined
            ? 'replaced'
            : added.has(property)
              ? 'added'
              : 'kept';
        const mark = kind === 'replaced' ? '~' : kind === 'added' ? '+' : ' ';
        return html`<span class=${`line ${kind}`}
            ><span class="mark">${mark}</span> ${property}: ${value};${was === undefined
            ? nothing
            : html` <span class="was">/* was ${was} */</span>`}</span
          >`;
      })
      : html`<span class="line">  /* nothing selected */</span>`}<span class="line">}</span>`;
  }

  #onNameInput(event: Event): void {
    this.editor.updateExtraction({ name: (event.target as HTMLInputElement).value });
    this.nameOpen = true;
    this.nameFilter = true;
    this.nameHighlight = -1;
  }

  /**
   * Arrow keys walk the list, Enter takes the highlighted row.
   *
   * Only a deliberate highlight counts: with nothing selected Enter falls through to
   * the dialog, where it does nothing, rather than silently turning a half-typed name
   * into the first guess. Escape closes the list before the dialog sees it, so the
   * first press dismisses the popover and the second cancels.
   */
  #onNameKeyDown(event: KeyboardEvent): void {
    const options = this.#nameOptions;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!this.nameOpen) {
        this.nameOpen = true;
        this.nameHighlight = direction === 1 ? 0 : options.length - 1;
        return;
      }
      const next = this.nameHighlight + direction;
      this.nameHighlight = next < 0 ? options.length - 1 : next >= options.length ? 0 : next;
      return;
    }

    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      if (!this.nameOpen || this.nameHighlight < 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.#chooseName(options[this.nameHighlight].value);
      return;
    }

    if (event.key === 'Escape' && this.nameOpen) {
      event.preventDefault();
      event.stopPropagation();
      this.#closeNameOptions();
    }
  }

  /**
   * Tabbing away takes the list with it.
   *
   * Deferred, because at blur time the incoming element is not focused yet — and a
   * press on a row deliberately keeps the caret in the input, so an immediate answer
   * would tear the list down mid-click.
   */
  #onNameBlur(): void {
    setTimeout(() => {
      if (!this.isConnected) return;
      if (this.shadowRoot?.activeElement === this.nameInput) return;
      this.#closeNameOptions();
    }, 130);
  }

  #chooseName(name: string): void {
    this.editor.updateExtraction({ name });
    this.#closeNameOptions();
    this.nameInput?.focus();
  }

  #toggleNameOptions(): void {
    if (this.nameOpen) {
      this.#closeNameOptions();
      return;
    }
    this.nameOpen = true;
    this.nameFilter = false;
    this.nameHighlight = -1;
    this.nameInput?.focus();
  }

  #closeNameOptions(): void {
    if (!this.nameOpen) return;
    this.nameOpen = false;
    this.nameHighlight = -1;
  }

  /** A press anywhere but the field or its list dismisses the list. */
  #onPointerDown(event: PointerEvent): void {
    if (!this.nameOpen) return;
    const inside = event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement &&
          (node.classList.contains('combo') || node.classList.contains('options')),
      );
    if (!inside) this.#closeNameOptions();
  }

  /**
   * Promote the list into the top layer and place it under the field.
   *
   * The field sits in a scrolling body, so an absolutely positioned list would be
   * clipped by it; a popover is painted above everything and positioned in viewport
   * coordinates instead. Measured after the render that created it, which is why
   * this runs from `updated`.
   */
  #placeNameOptions(): void {
    const popup = this.renderRoot.querySelector<HTMLElement>('.options');
    if (!popup || !this.nameInput) return;
    if (typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
      try {
        popup.showPopover();
      } catch {
        // Already open, or popovers are unsupported: the list still renders, it
        // just stays in the normal painting order.
      }
    }
    const style = anchoredStyle({
      anchor: this.nameInput.getBoundingClientRect(),
      popup: popup.getBoundingClientRect(),
      estimate: 220,
      // This list is as wide as the field it belongs to, which is already generous here.
      minWidth: 0,
    });
    // Guarded, or setting the state property from `updated` would loop.
    if (style !== this.namePopupStyle) this.namePopupStyle = style;
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
    /*
     * How many of these are already in the page, which is the whole question the option
     * answers. Counted, not tested for drift: the count is a selector, drift is a markup
     * comparison per element, and this runs on every keystroke in the dialog.
     */
    const placed = editing && pending.id ? this.editor.blockInstances(pending.id).length : 0;
    return html`<footer>
      ${pending.error
        ? html`<span class="error">${icon('close', 11)} ${pending.error}</span>`
        : nothing}
      ${placed
        ? html`<label
            class="check apply"
            title="Bring this markup to the copies already placed in the page. The text written into each of them is kept."
          >
            <input
              type="checkbox"
              .checked=${pending.applyToInstances}
              @change=${(event: Event) =>
            this.editor.updateExtraction({
              applyToInstances: (event.target as HTMLInputElement).checked,
            })}
            />
            ${placed === 1
            ? 'Apply to the 1 in the page'
            : `Apply to all ${placed} in the page`}
          </label>`
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
