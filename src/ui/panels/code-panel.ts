import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { HOST_TAG } from '../../core/constants.js';
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
import './seo-form.js';

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
      /* A column, not a scroller: the editor inside does its own scrolling, and the
         action row below stays put. Two scrollbars for one document was the problem. */
      .body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1 1 auto;
        min-height: 0;
        padding: 10px 12px;
      }
      /* The fixed matter above the buffer — a path, a note — keeps its own height. */
      .body > .where,
      .body > .note {
        flex: 0 0 auto;
      }
      .body > heo-code-editor {
        flex: 1 1 auto;
        min-height: 0;
      }
      /* The head form is a document, not a buffer: it scrolls. */
      .body.scrolls {
        display: block;
        overflow-y: auto;
      }
      .where {
        margin: 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
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
  /**
   * True for the copy hosted inside the fullscreen code view.
   *
   * That copy is already as large as it gets, so it drops the expand affordance; the
   * one in the dock keeps it, since that is how the view is opened.
   */
  @property({ type: Boolean }) embedded = false;

  /**
   * Which half of the document view is showing, when nothing is selected.
   *
   * Head by default: it is the part of a page no click can reach.
   */
  @state() private docTab: 'head' | 'body' = 'head';
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
    const el = this.#target();
    if (!el || !el.isConnected) {
      this.#loadedFor = null;
      return;
    }
    this.#syncBuffer(el);
  }

  /**
   * The element this panel is editing.
   *
   * With nothing selected it is the document body, so the panel has something to show
   * instead of an instruction to go and click something. That is also the only way to
   * reach the parts of a page no element selection can cover — the body's own
   * attributes, and everything in the head, which the other tab handles.
   */
  #target(): HTMLElement | null {
    const selected = this.editor.selected;
    if (selected?.isConnected) return selected;
    return this.docTab === 'body' ? document.body : null;
  }

  override render(): TemplateResult {
    const selected = this.editor.selected;
    // Nothing selected means the document itself is the subject, which is two very
    // different jobs: the head is a form, the body is markup.
    if (!selected?.isConnected) return this.#renderDocument();
    return this.#renderElement(selected);
  }

  /**
   * The document view: head as a form, body as markup.
   *
   * Head first, because it is the part with no other way in — every element in the
   * body can be reached by clicking it, and nothing in the head can be reached at all.
   */
  #renderDocument(): TemplateResult {
    const onHead = this.docTab === 'head';
    return html`
      <div class="top">
        <div class="meta">
          <span class="chip">${icon('code', 11)} ${documentLabel()}</span>
          ${this.dirty && !onHead
        ? html`<span class="chip" style="color:var(--heo-warn)">unapplied</span>`
        : nothing}
          <span class="spacer"></span>
          <span class="src">nothing selected — editing the document</span>
        </div>
        <heo-segmented
          .options=${[
        { value: 'head', label: 'Head & SEO' },
        { value: 'body', label: 'Body markup' },
      ]}
          .value=${this.docTab}
          label="Document scope"
          @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.docTab = (event.detail.value || 'head') as 'head' | 'body';
        this.#loadedFor = null;
      }}
        ></heo-segmented>
      </div>
      ${onHead
        ? html`<div class="body scrolls"><heo-seo-form></heo-seo-form></div>`
        : this.#renderBodyMarkup()}
    `;
  }

  #renderBodyMarkup(): TemplateResult {
    const el = document.body;
    return html`
      <div class="body">
        <p class="where">
          The whole body, overlay excluded. Applying replaces its contents.
        </p>
        <heo-code-editor
          fill
          .expandable=${!this.embedded}
          expandTarget=${this.embedded ? '' : 'html'}
          @code-expand=${() => this.editor.openCodeWorkspace('html')}
          language="html"
          heading="HTML · body"
          .value=${this.draft}
          .error=${this.error}
          @code-input=${(event: CustomEvent<{ value: string }>) => this.#onInput(event.detail.value)}
          @code-submit=${() => this.#apply(el)}
          @code-cancel=${() => this.#reset(el)}
        ></heo-code-editor>
      </div>
      <div class="foot">
        ${this.#renderRevert(el)}
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

  #renderElement(el: HTMLElement): TemplateResult {
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
        fill
        .expandable=${!this.embedded}
        expandTarget=${this.embedded ? '' : 'html'}
        @code-expand=${() => this.editor.openCodeWorkspace('html')}
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
    const source = isBody(el) ? bodyMarkup() : this.mode === 'outer' ? el.outerHTML : el.innerHTML;
    const sameTarget =
      this.#loadedFor === el && (isBody(el) || this.#loadedMode === this.mode);
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

    if (isBody(el)) {
      this.#applyBody();
      return;
    }

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

  /**
   * Replace the body's contents while leaving the overlay standing.
   *
   * The overlay mounts into the body, so a plain `innerHTML =` would delete the editor
   * doing the deleting — the panel would vanish mid-edit and the page would be left
   * with no way back. The host is set aside and put back on both apply and revert.
   */
  #applyBody(): void {
    const body = document.body;
    const host = body.querySelector(HOST_TAG);
    const before = bodyMarkup();
    const holder = document.createElement('div');
    holder.append(sanitizeFragment(this.draft));
    const after = holder.innerHTML;
    if (after.trim() === before.trim()) {
      this.dirty = false;
      return;
    }
    const write = (markup: string): void => {
      body.innerHTML = markup;
      if (host) body.appendChild(host);
    };
    this.editor.history.commit({
      label: 'Edit the body markup',
      subject: 'markup:body',
      record: {
        id: `h${Date.now().toString(36)}`,
        kind: 'replace',
        summary: 'Rewrite the contents of <body>',
        target: 'body',
        detail: { html: after, scope: 'document body' },
        at: Date.now(),
      },
      apply: () => write(after),
      revert: () => write(before),
    });
    this.dirty = false;
    this.#loadedFor = null;
    this.#appliedAt = this.editor.history.size;
    this.#appliedTo = null;
    this.#refocus();
    this.editor.notify('Body markup replaced.', 'success', {
      label: 'Undo',
      run: () => this.editor.undo(),
    });
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

/** `example.com/pricing`, or just the host on a root page. */
function documentLabel(): string {
  const path = location.pathname === '/' ? '' : location.pathname;
  return `${location.host}${path}`;
}

function isBody(el: HTMLElement): boolean {
  return el === document.body;
}

/**
 * The body's markup, with the editor's own nodes left out.
 *
 * Showing the overlay host in a buffer the user is about to rewrite would be an
 * invitation to delete it, and it is not part of their page in the first place.
 */
function bodyMarkup(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const host of Array.from(clone.querySelectorAll(HOST_TAG))) host.remove();
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.startsWith('data-heo-') || attribute.name === 'contenteditable') {
        node.removeAttribute(attribute.name);
      }
    }
  }
  return clone.innerHTML;
}
