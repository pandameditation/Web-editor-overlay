import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';
import { normalizeClassName } from '../../core/classes.js';
import { safeSelector } from '../../core/selectors.js';
import { ModalController } from '../../core/modal.js';
import {
  parsePastedCSS,
  pastedDeclarationCount,
  type ParsedCssPaste,
} from '../../core/css-paste.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { classSuggestions } from '../suggestions.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import '../controls/code-editor.js';
import '../controls/segmented.js';
import '../controls/selector-field.js';
import '../controls/value-field.js';

/**
 * A deliberate hand-off between pasted CSS and the place it should live.
 *
 * The editor can recognise a class rule, but recognition is not intent: the same text might
 * belong inline on one selected element, to a reusable class, to a shared selector, or to a
 * block's source file. This dialog makes that choice visible before any registry or stylesheet
 * changes happen, and keeps the actual paste native inside the code editor.
 */
@customElement('heo-css-paste-dialog')
export class HeoCssPasteDialog extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 31;
        display: block;
        background: oklch(12% 0.01 265 / 58%);
        backdrop-filter: blur(4px);
        pointer-events: auto;
      }
      .backdrop {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: 24px;
      }
      .dialog {
        display: flex;
        flex-direction: column;
        width: min(820px, 100%);
        max-height: min(90vh, 820px);
        border-radius: var(--heo-r-lg);
        overflow: hidden;
      }
      header {
        display: flex;
        align-items: flex-start;
        gap: 11px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--heo-line);
      }
      header .body {
        flex: 1 1 auto;
        min-width: 0;
      }
      h2 {
        margin: 0 0 4px;
        font-size: 14px;
        font-weight: 650;
      }
      header p {
        margin: 0;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.5;
      }
      .content {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1 1 auto;
        min-height: 0;
        padding: 14px 18px;
        overflow: auto;
      }
      .content heo-code-editor {
        flex: 0 0 auto;
        min-height: 230px;
      }
      .destination {
        display: grid;
        gap: 8px;
        padding: 10px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: linear-gradient(
          180deg,
          color-mix(in oklab, var(--heo-accent) 6%, var(--heo-raised)),
          var(--heo-raised)
        );
      }
      .eyebrow {
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 650;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .destination .target {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.4;
      }
      .target svg {
        flex: 0 0 auto;
        color: var(--heo-accent);
      }
      .target code,
      .source code {
        color: var(--heo-text);
        font-family: var(--heo-mono);
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
      }
      .field {
        display: grid;
        gap: 4px;
      }
      .field.full {
        grid-column: 1 / -1;
      }
      .field label {
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .input {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        padding: 7px 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font: inherit;
        font-size: 11px;
      }
      .input:focus {
        border-color: var(--heo-accent-line);
        outline: none;
      }
      .input.mono {
        font-family: var(--heo-mono);
      }
      .check {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
      }
      .check input {
        accent-color: var(--heo-accent);
      }
      .note {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        padding: 9px 11px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.5;
      }
      .note .g {
        flex: 0 0 auto;
        margin-top: 1px;
        color: var(--heo-text-faint);
      }
      .note.warn {
        border-color: color-mix(in oklab, var(--heo-warn) 70%, var(--heo-line));
      }
      .note.warn .g {
        color: var(--heo-warn);
      }
      .note.error {
        border-color: color-mix(in oklab, var(--heo-danger) 70%, var(--heo-line));
      }
      .note.error .g {
        color: var(--heo-danger);
      }
      .note code {
        color: var(--heo-text);
        font-family: var(--heo-mono);
      }
      .source {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .source .pill {
        max-width: 100%;
        overflow: hidden;
        padding: 3px 7px;
        border: 1px solid var(--heo-line);
        border-radius: 999px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .source button {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-accent);
        font: inherit;
        font-size: 10px;
        cursor: pointer;
      }
      .source button:hover {
        text-decoration: underline;
      }
      footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        padding: 11px 18px;
        border-top: 1px solid var(--heo-line);
      }
      footer .fine {
        flex: 1 1 260px;
        max-width: 480px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      footer .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .err {
        color: var(--heo-danger) !important;
      }
      @media (max-width: 560px) {
        .backdrop {
          padding: 10px;
        }
        .dialog {
          max-height: calc(100vh - 20px);
        }
        .content,
        header,
        footer {
          padding-left: 12px;
          padding-right: 12px;
        }
        .fields {
          grid-template-columns: minmax(0, 1fr);
        }
        .field.full {
          grid-column: auto;
        }
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.cssPaste] as const,
    shallowArrayEquals,
  );

  protected modal = new ModalController(this, { initialFocus: 'heo-code-editor' });

  override render(): TemplateResult | typeof nothing {
    const open = this.state.value.cssPaste;
    if (!open) return nothing;
    const parsed = parsePastedCSS(open.draft);
    const block = open.destination === 'block';
    const count = pastedDeclarationCount(parsed);
    const hasMultipleRules = parsed.mode === 'rules' && parsed.rules.length > 1;
    const ready = block ? Boolean(open.draft.trim()) : count > 0 && !hasMultipleRules;

    return html`<div
      class="backdrop"
      @pointerdown=${this.#stopBackdropInteraction}
      @click=${this.#stopBackdropInteraction}
    >
      <div
        class="dialog surface"
        role="dialog"
        aria-modal="true"
        aria-label="Paste CSS"
        @pointerdown=${(event: Event) => event.stopPropagation()}
      >
      <header>
        <div class="body">
          <h2>${block ? 'Add CSS to this block' : 'Paste CSS'}</h2>
          <p>
            Paste a declaration list or a complete CSS rule. Review the destination before applying
            it — the same CSS can be local to this element, reusable as a class, or shared by a
            selector.
          </p>
        </div>
        <button
          class="btn icon ghost"
          type="button"
          aria-label="Close"
          @click=${() => this.editor.cancelCssPaste()}
        >
          ${icon('close', 14)}
        </button>
      </header>

      <div class="content">
        <heo-code-editor
          fill
          language="css"
          rows="10"
          heading="CSS to paste"
          placeholder=${'.card {\n  padding: 1rem;\n  border-radius: 12px;\n}'}
          .value=${open.draft}
          .error=${open.error}
          @code-input=${(event: CustomEvent<{ value: string }>) =>
        this.editor.updateCssPaste({ draft: event.detail.value, error: '' })}
          @code-cancel=${() => this.editor.cancelCssPaste()}
          @code-submit=${() => this.#apply(open)}
        ></heo-code-editor>

        ${this.#renderRecognition(parsed, open)}
        ${block ? this.#renderBlockDestination(open) : this.#renderDestination(open)}
      </div>

      <footer>
        <span class=${`fine${open.error ? ' err' : ''}`}>
          ${open.error || this.#footerSummary(open, count, parsed)}
        </span>
        <div class="actions">
          <button class="btn" type="button" @click=${() => this.editor.cancelCssPaste()}>
            Cancel
          </button>
          <button
            class="btn primary"
            type="button"
            ?disabled=${!ready}
            @click=${() => this.#apply(open)}
          >
            ${icon('check', 12)} ${block ? 'Use this CSS' : 'Apply CSS'}
          </button>
        </div>
      </footer>
      </div>
    </div>`;
  }

  #renderRecognition(parsed: ParsedCssPaste, open: NonNullable<typeof this.state.value.cssPaste>): TemplateResult | typeof nothing {
    if (!open.draft.trim()) {
      return html`<div class="note">
        <span class="g">${icon('clipboard', 12)}</span>
        <span>Paste CSS here. You can decide where it belongs after the editor recognises it.</span>
      </div>`;
    }

    const selectors = parsed.rules.map((rule) => rule.selector);
    return html`
      ${parsed.mode === 'rules'
        ? html`<div class="source">
            ${icon('code', 12)} Found ${parsed.rules.length}
            ${parsed.rules.length === 1 ? 'rule' : 'rules'} with ${pastedDeclarationCount(parsed)}
            ${pastedDeclarationCount(parsed) === 1 ? 'declaration' : 'declarations'}.
            ${selectors.slice(0, 3).map((selector) => html`<span class="pill">${selector}</span>`)}
            ${selectors.length > 3 ? html`<span>and ${selectors.length - 3} more</span>` : nothing}
            ${this.#renderRuleSuggestions(parsed)}
          </div>`
        : html`<div class="source">${icon('code', 12)} Found ${pastedDeclarationCount(parsed)}
            ${pastedDeclarationCount(parsed) === 1 ? 'declaration' : 'declarations'}.</div>`}
      ${parsed.rules.length > 1 && open.destination !== 'block'
        ? html`<div class="note warn">
            <span class="g">${icon('alert', 12)}</span>
            <span>
              This paste contains ${parsed.rules.length} selectors. Inline, class, and CSS rule
              destinations accept one selector at a time; choose Block CSS to keep every rule.
            </span>
          </div>`
        : nothing}
      ${parsed.unsupportedRules && open.destination !== 'block'
        ? html`<div class="note warn">
            <span class="g">${icon('alert', 12)}</span>
            <span>
              This paste also contains ${parsed.unsupportedRules} conditional or special
              ${parsed.unsupportedRules === 1 ? 'rule' : 'rules'}. Selector and class destinations
              use only the top-level declarations; choose Block CSS to keep the full stylesheet.
            </span>
          </div>`
        : nothing}
      ${parsed.rejected.length
        ? html`<div class="note warn">
            <span class="g">${icon('alert', 12)}</span>
            <span>Skipped: ${parsed.rejected.join(' ')}</span>
          </div>`
        : nothing}
      ${parsed.advice.length
        ? html`<div class="note">
            <span class="g">${icon('info', 12)}</span>
            <span>${parsed.advice.join(' ')}</span>
          </div>`
        : nothing}
    `;
  }

  #renderRuleSuggestions(parsed: ParsedCssPaste): TemplateResult | typeof nothing {
    if (parsed.rules.length !== 1) return nothing;
    const selector = parsed.rules[0].selector;
    const simple = /^\.([A-Za-z_][\w-]*)$/.exec(selector.trim());
    const open = this.state.value.cssPaste;
    if (!open || open.destination === 'block') return nothing;
    return html`<button
      type="button"
      title="Use the selector from the pasted rule"
      @click=${() => {
        if (simple) {
          this.editor.updateCssPaste({
            destination: 'class',
            className: simple[1],
            selector,
          });
        } else {
          this.editor.updateCssPaste({ destination: 'rule', selector });
        }
      }}
    >
      ${simple ? `Use ${simple[1]} as a destination` : 'Use this selector'}
    </button>`;
  }

  #renderDestination(open: NonNullable<typeof this.state.value.cssPaste>): TemplateResult {
    const hasElement = Boolean(open.element?.isConnected);
    const options = [
      ...(hasElement ? [{ value: 'inline', label: open.context === 'inline' ? 'This element' : 'Inline style' }] : []),
      { value: 'class', label: open.currentClass ? `.${open.currentClass}` : 'Class' },
      { value: 'rule', label: open.currentSelector ? 'This rule' : 'CSS rule' },
    ];
    const destination = open.destination === 'inline' && !hasElement ? 'class' : open.destination;
    const normalizedClass = normalizeClassName(open.className);
    const existingClass = normalizedClass ? this.editor.classes.get(normalizedClass) : null;
    const normalizedSelector = safeSelector(open.selector);
    const existingRule = normalizedSelector ? this.editor.rules.get(normalizedSelector) : null;

    return html`<section class="destination">
      <span class="eyebrow">Where should it live?</span>
      <heo-segmented
        label="CSS destination"
        .options=${options}
        .value=${destination}
        @segment-change=${(event: CustomEvent<{ value: string }>) =>
        this.editor.updateCssPaste({ destination: event.detail.value as NonNullable<typeof open>['destination'] })}
      ></heo-segmented>
      ${destination === 'inline'
        ? html`<div class="target">${icon('cursor', 12)} This element only: <code>${this.#elementLabel(open)}</code></div>`
        : nothing}
      ${destination === 'class'
        ? html`<div class="fields">
              <div class="field full">
                <label>Class name</label>
                <heo-value-field
                  .value=${open.className}
                  .suggestions=${classSuggestions(this.editor, open.className)}
                  placeholder="find or create a class"
                  @value-input=${(event: CustomEvent<{ value: string }>) =>
            this.editor.updateCssPaste({ className: event.detail.value })}
                  @value-change=${(event: CustomEvent<{ value: string }>) =>
            this.editor.updateCssPaste({ className: event.detail.value })}
                ></heo-value-field>
              </div>
              <div class="target field full">
                ${icon('blocks', 12)}
                ${existingClass
            ? html`Upserts existing <code>.${normalizedClass}</code> (${Object.keys(existingClass.declarations).length} declarations).`
            : html`Creates new <code>.${normalizedClass || '…'}</code>; choose an existing suggestion to merge into one instead.`}
              </div>
              ${hasElement
            ? html`<label class="check field full">
                    <span>
                      <input
                        type="checkbox"
                        .checked=${open.applyClass}
                        @change=${(event: Event) =>
                this.editor.updateCssPaste({ applyClass: (event.target as HTMLInputElement).checked })}
                      />
                      Apply this class to <code>${this.#elementLabel(open)}</code> now
                    </span>
                  </label>`
            : html`<div class="target field full">${icon('blocks', 12)} The class will be created in Tokens; apply it to elements there.</div>`}
            </div>`
        : nothing}
      ${destination === 'rule'
        ? html`<div class="fields">
              <div class="field full">
                <label>Selector</label>
                <heo-selector-field
                  .value=${open.selector}
                  placeholder="choose or create a selector"
                  .declaredCountFor=${(selector: string) =>
            Object.values(this.editor.rules.get(selector)?.declarations ?? {})
              .filter((value) => value.trim()).length}
                  @selector-input=${(event: CustomEvent<{ value: string }>) =>
            this.editor.updateCssPaste({ selector: event.detail.value })}
                  @selector-submit=${(event: CustomEvent<{ value: string }>) =>
            this.editor.updateCssPaste({ selector: event.detail.value })}
                ></heo-selector-field>
              </div>
              <div class="target field full">
                ${icon('code', 12)}
                ${this.#isLiveRule(open)
            ? html`Edits the page's existing rule and records the source location for writeback.`
            : existingRule
              ? html`Upserts existing <code>${normalizedSelector}</code> (${Object.values(existingRule.declarations).filter((value) => value.trim()).length} declarations).`
              : html`Creates a new editor-owned rule for <code>${normalizedSelector || 'the selector you choose'}</code>.`}
              </div>
            </div>`
        : nothing}
    </section>`;
  }

  #renderBlockDestination(open: NonNullable<typeof this.state.value.cssPaste>): TemplateResult {
    return html`<section class="destination">
      <span class="eyebrow">Block CSS file</span>
      <heo-segmented
        label="What to do with the block CSS"
        .options=${[
        { value: 'append', label: 'Append to CSS' },
        { value: 'replace', label: 'Replace CSS' },
      ]}
        .value=${open.append ? 'append' : 'replace'}
        @segment-change=${(event: CustomEvent<{ value: string }>) =>
        this.editor.updateCssPaste({ append: event.detail.value !== 'replace' })}
      ></heo-segmented>
      <div class="target">${icon('file', 12)} The block keeps selectors and conditional rules exactly as pasted.</div>
    </section>`;
  }

  #footerSummary(
    open: NonNullable<typeof this.state.value.cssPaste>,
    count: number,
    parsed: ParsedCssPaste,
  ): string {
    if (!open.draft.trim()) return 'Nothing has been pasted yet.';
    if (open.destination === 'block') {
      return open.append
        ? 'The pasted text will be appended to this block’s CSS source.'
        : 'The current block CSS will be replaced by the pasted text.';
    }
    if (parsed.mode === 'rules' && parsed.rules.length > 1) {
      return 'Choose Block CSS to preserve every selector in this paste.';
    }
    if (!count) return 'No usable CSS declarations were found.';
    const destination = open.destination === 'inline'
      ? 'the selected element'
      : open.destination === 'class'
        ? `.${open.className || '…'}`
        : open.selector || 'the chosen selector';
    return `${count} ${count === 1 ? 'declaration' : 'declarations'} will upsert into ${destination}. Undo removes the whole paste.`;
  }

  #elementLabel(open: NonNullable<typeof this.state.value.cssPaste>): string {
    return open.element?.tagName ? open.element.tagName.toLowerCase() : 'the selected element';
  }

  #isLiveRule(open: NonNullable<typeof this.state.value.cssPaste>): boolean {
    return Boolean(
      open.liveRule &&
      open.selector.trim() &&
      safeSelector(open.liveRule.selectorText) === safeSelector(open.selector),
    );
  }

  #stopBackdropInteraction(event: Event): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
  }

  #apply(open: NonNullable<typeof this.state.value.cssPaste>): void {
    const current = this.editor.store.value.cssPaste;
    if (!current || current !== open) return;
    const parsed = parsePastedCSS(open.draft);

    if (open.destination === 'block') {
      const extraction = this.editor.store.value.extraction;
      if (!extraction || extraction.mode !== 'block') {
        this.editor.updateCssPaste({ error: 'The block editor is no longer open.' });
        return;
      }
      const incoming = open.draft.trim();
      const css = open.append && extraction.css.trim()
        ? `${extraction.css.trim()}\n\n${incoming}`
        : incoming;
      this.editor.updateExtraction({ css });
      this.editor.cancelCssPaste();
      this.editor.notify(open.append ? 'Appended CSS to the block.' : 'Replaced the block CSS.', 'success');
      return;
    }

    if (parsed.mode === 'rules' && parsed.rules.length > 1) {
      this.editor.updateCssPaste({
        error: 'This paste contains multiple CSS rules. Choose Block CSS to keep every selector.',
      });
      return;
    }
    if (!parsed.declarations || !pastedDeclarationCount(parsed)) {
      this.editor.updateCssPaste({ error: 'Paste a declaration list or a CSS rule with at least one usable declaration.' });
      return;
    }
    if (open.destination === 'inline') {
      if (!open.element?.isConnected) {
        this.editor.updateCssPaste({ error: 'The selected element is no longer in the page.' });
        return;
      }
      if (this.editor.applyCssPaste(parsed, { kind: 'inline', element: open.element })) {
        this.editor.cancelCssPaste();
        this.editor.notify(`Applied ${pastedDeclarationCount(parsed)} CSS ${pastedDeclarationCount(parsed) === 1 ? 'declaration' : 'declarations'} inline.`, 'success');
      }
      return;
    }
    if (open.destination === 'class') {
      const name = normalizeClassName(open.className);
      if (!name) {
        this.editor.updateCssPaste({ error: 'Use a class name beginning with a letter and containing only letters, numbers, hyphens, or underscores.' });
        return;
      }
      if (this.editor.applyCssPaste(parsed, {
        kind: 'class',
        name,
        element: open.element,
        applyToElement: open.applyClass && Boolean(open.element?.isConnected),
      })) {
        this.editor.cancelCssPaste();
        this.editor.notify(`Upserted CSS into .${name}.`, 'success');
      }
      return;
    }

    const selector = safeSelector(open.selector);
    if (!selector) {
      this.editor.updateCssPaste({ error: 'Use a CSS selector the browser accepts.' });
      return;
    }
    if (this.editor.applyCssPaste(parsed, {
      kind: 'rule',
      selector,
      liveRule: this.#isLiveRule(open) ? open.liveRule : null,
    })) {
      this.editor.cancelCssPaste();
      this.editor.notify(`Upserted CSS into ${selector}.`, 'success');
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-css-paste-dialog': HeoCssPasteDialog;
  }
}
