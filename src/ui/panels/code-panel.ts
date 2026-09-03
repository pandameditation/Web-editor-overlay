import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { HOST_TAG } from '../../core/constants.js';
import { labelFor, nearestSourceRef } from '../../core/dom.js';
import { setInnerHTML } from '../../core/mutations.js';
import { copyToClipboard } from '../../core/design-system.js';
import { formatHTML, sanitizeFragment, scrubElement } from '../../core/sanitize.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import type { HeoCodeEditor } from '../controls/code-editor.js';
import '../controls/code-editor.js';
import '../controls/segmented.js';

/**
 * The HTML editor.
 *
 * With an element selected, this edits that element's markup — outer or inner,
 * validated as you type, applied explicitly. With nothing selected, there is no
 * "select an element" dead end any more: it shows the whole file, doctype to
 * closing `</html>`, and applying rewrites the live document.
 *
 * That second mode is the one worth being careful about. It touches `<head>` and
 * `<body>` in one commit, so four things it must never do by accident: delete the
 * overlay along with the body it lives in, orphan the token/class/block
 * stylesheets the rest of the editor writes through, drop the attribute that makes
 * edit-mode CSS apply, or delete a script that was already running because it
 * happened to be caught inside a much smaller edit. All four are guarded
 * explicitly rather than left to chance — see `#applyDocument`.
 *
 * Editing markup by hand is the escape hatch for everything the panels do not
 * cover, so it has to be trustworthy. The buffer is validated as you type and
 * reports exactly what is wrong, applying is explicit rather than live, and the
 * result goes through the same sanitiser as every other insertion so a paste
 * cannot smuggle in a script — the JS panel is where a script actually belongs.
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
      .body > heo-code-editor {
        flex: 1 1 auto;
        min-height: 0;
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
    this.#syncBuffer(this.#target());
  }

  /**
   * The element this panel is editing.
   *
   * With nothing selected it is the whole document, so the panel always has
   * something real to show instead of an instruction to go and click something —
   * and it is the only way to reach the parts of a page no element selection can
   * cover, such as `<head>` and the attributes on `<html>` and `<body>`.
   */
  #target(): HTMLElement {
    const selected = this.editor.selected;
    return selected?.isConnected ? selected : document.documentElement;
  }

  override render(): TemplateResult {
    return this.#renderTarget(this.#target());
  }

  #renderTarget(el: HTMLElement): TemplateResult {
    const isDoc = isWholeDocument(el);
    const source = isDoc ? null : nearestSourceRef(el);

    return html`
      <div class="top">
        <div class="meta">
          <span class="chip">
            ${icon('code', 11)} ${isDoc ? `Whole document · ${documentLabel()}` : labelFor(el)}
          </span>
          ${this.dirty
        ? html`<span class="chip" style="color:var(--heo-warn)">unapplied</span>`
        : nothing}
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
        ${isDoc
        ? html`<span class="src"
            >Nothing selected — this is the whole file. Click an element on the page to edit it
            directly instead.</span
          >`
        : html`<heo-segmented
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
            ></heo-segmented>`}
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
          .autoCollapse=${isDoc ? DOCUMENT_AUTO_COLLAPSE : NO_AUTO_COLLAPSE}
          heading=${isDoc
        ? 'HTML · full document'
        : `HTML · ${labelFor(el)} · ${this.mode === 'outer' ? 'whole element' : 'contents only'}`}
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
                cannot be added from here — edit a running script from the JS panel instead.
              </span>
            </div>`
        : nothing}
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
   * Reload the buffer when it no longer describes the target — but never mid-edit.
   *
   * Three triggers: a different element, a different scope, or the markup having
   * changed underneath. That third one matters more than it sounds: styling from the
   * Styles panel, a drag, an undo, all rewrite the element, and a buffer keyed only on
   * identity went on showing whatever it loaded the first time. Reverting then
   * "restored" markup that no longer existed.
   *
   * Unapplied edits still win — they are the one thing that cannot be recovered — and
   * the raw source is compared before reformatting, so an unchanged target costs a
   * string comparison rather than a re-pretty-print on every revision bump.
   */
  #syncBuffer(el: HTMLElement): void {
    const doc = isWholeDocument(el);
    const source = doc ? wholeDocumentMarkup() : this.mode === 'outer' ? el.outerHTML : el.innerHTML;
    const sameTarget = this.#loadedFor === el && (doc || this.#loadedMode === this.mode);
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

    const removed: string[] = [];
    if (/\son[a-z]+\s*=/i.test(text)) removed.push('inline event handlers');
    if (/(?:href|src)\s*=\s*["']?\s*javascript:/i.test(text)) removed.push('javascript: URLs');

    if (this.#loadedFor && isWholeDocument(this.#loadedFor)) {
      // Scripts here are shown, but Apply carries the page's existing ones over
      // unchanged rather than risking deletion — see `#applyDocument`. That means an
      // edit made *inside* a `<script>` tag in this buffer has nowhere to go, which
      // is worth disclosing precisely rather than folding into "removed", since
      // nothing is actually being removed.
      if (/<script\b/i.test(text)) removed.push("edits inside <script> tags won't apply — use the JS panel");
      this.stripped = removed;
      // Emptying the buffer here would wipe the entire live page in one apply — the
      // one mistake worth blocking outright rather than warning about after the fact.
      this.error = text ? '' : 'The document cannot be emptied from here.';
      return;
    }

    if (/<script\b/i.test(text)) removed.push('<script> tags');
    this.stripped = removed;

    if (!text) {
      this.error = this.mode === 'outer' ? 'The element markup cannot be empty.' : '';
      return;
    }

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

    if (isWholeDocument(el)) {
      this.#applyDocument();
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
    /*
     * Through `setInnerHTML`, not a hand-built record, and that is the fix for a real bug.
     *
     * This used to commit a `kind: 'replace'` record assembled here. Two things were wrong with
     * it, and together they forced a whole-file rewrite for an edit the patcher handles natively.
     * `'replace'` is a *structural* kind — it means the element node was swapped, so the save
     * rebuilds the container's children in file order — and rebuilding needs the container's
     * anchor, which a record built by hand does not have. So every Apply here reported "no
     * container was recorded for Rewrite the contents of …" and serialized the page, while the
     * same edit made directly on the page patched one line.
     *
     * Rewriting an element's contents is not structural at all: nothing moves, no sibling is
     * touched, and `html-patch` has a primitive for exactly it. `setInnerHTML` records it as
     * `kind: 'text'` with a full anchor, which is the same shape inline text editing produces.
     */
    const command = setInnerHTML(el, before, after);
    command.label = `Edit contents of ${labelFor(el)}`;
    command.record.summary = `Rewrite the contents of ${labelFor(el)}`;
    this.editor.history.commit(command);
    this.dirty = false;
    this.#loadedFor = null;
    this.#appliedAt = this.editor.history.size;
    this.#appliedTo = el;
    this.#refocus();
    this.editor.notify('Contents replaced.', 'success');
  }

  /**
   * Rewrite the live document from the buffer, in one undoable step.
   *
   * `<head>` and `<body>` are replaced by content, `<html>` and `<body>` keep
   * their attributes in sync too — but four things are never left to whatever the
   * user's buffer happened to say, because losing any of them breaks the page or
   * the editor rather than doing what the user meant:
   *
   * - The overlay host. It lives inside `<body>`, so a plain `innerHTML =` would
   *   delete the editor doing the deleting.
   * - The token, class and block stylesheets. They are managed elsewhere and
   *   written through their own API; this view shows their *effect*, not their
   *   markup, so they are left out of the buffer entirely and reattached after.
   * - `data-heo-edit`. The page-level CSS that makes edit mode behave — cursors,
   *   text selection, the drag preview — is keyed off this attribute on `<html>`.
   * - Every existing `<script>`. This is the one that matters most: a script has
   *   already run, and this view is a document editor, not the disclosed,
   *   run-it-again place that scripts get — the JS panel. Sanitizing them out of
   *   *new* markup, the way every insertion elsewhere in the editor does, is right
   *   for markup being typed fresh. Applying that same rule to the whole document
   *   would mean pressing Apply after fixing a typo in the title also deletes
   *   every script already running on the page, silently, with no way to notice
   *   before it happens. So existing scripts are carried over exactly as they
   *   were, in their original position, whatever the buffer says about them.
   *
   * All four are captured before the buffer is parsed and restored after, in both
   * directions, so undo is exactly as safe as the apply.
   */
  #applyDocument(): void {
    const doc = document;
    const host = doc.querySelector(HOST_TAG);
    const managed = Array.from(doc.head.querySelectorAll('[data-heo-generated]'));
    const editingAttr = doc.documentElement.getAttribute('data-heo-edit');
    // Cloned rather than moved: the live nodes stay exactly where they are and keep
    // running. Which parent held each one is kept too, since "in the head" versus
    // "in the body" is the one part of a script's position worth being exact about;
    // where it fell relative to content the buffer just rewrote has no stable
    // meaning any more; each clone is appended at the end of its original parent.
    const scripts = Array.from(doc.querySelectorAll('script')).map((script) => ({
      clone: script.cloneNode(true) as HTMLScriptElement,
      inHead: script.closest('head') === doc.head,
    }));

    // A full document, not a fragment: DOMParser gives it a real head/body the way
    // `<template>` fragment parsing does not, and — like every parser-inserted
    // script — nothing it contains executes.
    const incoming = new DOMParser().parseFromString(this.draft, 'text/html');
    for (const script of Array.from(incoming.querySelectorAll('script'))) script.remove();
    scrubElement(incoming.documentElement);

    const before = {
      htmlAttrs: attributeMap(doc.documentElement),
      headHTML: headMarkupExcludingManagedAndScripts(),
      bodyAttrs: attributeMap(doc.body),
      bodyHTML: bodyMarkup(),
    };
    const after = {
      htmlAttrs: attributeMap(incoming.documentElement),
      headHTML: incoming.head.innerHTML,
      bodyAttrs: attributeMap(incoming.body),
      bodyHTML: incoming.body.innerHTML,
    };
    if (JSON.stringify(before) === JSON.stringify(after)) {
      this.dirty = false;
      return;
    }

    const write = (state: typeof before): void => {
      applyAttributeMap(doc.documentElement, state.htmlAttrs);
      if (editingAttr !== null) doc.documentElement.setAttribute('data-heo-edit', editingAttr);
      else doc.documentElement.removeAttribute('data-heo-edit');
      doc.head.innerHTML = state.headHTML;
      for (const el of managed) doc.head.appendChild(el);
      applyAttributeMap(doc.body, state.bodyAttrs);
      doc.body.innerHTML = state.bodyHTML;
      if (host) doc.body.appendChild(host);
      // Scripts are excluded from both `state.headHTML` and `state.bodyHTML`
      // (`headMarkupExcludingManagedAndScripts` / `bodyMarkup`), so this is the one
      // and only place they land — appended, in their original order, to whichever
      // parent held them. `innerHTML =` above never executed anything anyway; this
      // is the same "no re-run" contract the JS panel documents.
      for (const { clone, inHead } of scripts) (inHead ? doc.head : doc.body).appendChild(clone);
    };

    this.editor.history.commit({
      label: 'Edit the full document',
      subject: 'markup:document',
      record: {
        id: `h${Date.now().toString(36)}`,
        kind: 'replace',
        summary: 'Rewrite the HTML document',
        target: 'document',
        detail: { html: this.draft, scope: 'document' },
        at: Date.now(),
      },
      apply: () => write(after),
      revert: () => write(before),
    });
    this.dirty = false;
    this.#loadedFor = null;
    // Nothing to re-select afterwards: "the document" is not a node undo can hand
    // back, unlike an element that whole-mode swapped out.
    this.#appliedAt = this.editor.history.size;
    this.#appliedTo = null;
    this.#refocus();
    this.editor.notify('Document updated.', 'success', {
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

/**
 * Collapsed on sight in the whole-document view.
 *
 * An inlined stylesheet is often longer than the markup around it, so opening the
 * document on it means scrolling past someone else's CSS to reach your own HTML —
 * and neither of these is editable from this tab anyway: CSS has its own tab, and
 * scripts are carried through a document apply untouched.
 *
 * Constants rather than inline arrays: a fresh array on every render would look like
 * a changed property to Lit and reload the buffer, discarding whatever was expanded.
 */
const DOCUMENT_AUTO_COLLAPSE = ['style', 'script'];
const NO_AUTO_COLLAPSE: string[] = [];

/** `example.com/pricing`, or just the host on a root page. */
function documentLabel(): string {
  const path = location.pathname === '/' ? '' : location.pathname;
  return `${location.host}${path}`;
}

function isWholeDocument(el: HTMLElement): boolean {
  return el === document.documentElement;
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
  // Excluded here for the whole-document view for the same reason as the head:
  // `#applyDocument` carries every existing script over untouched and reattaches
  // it separately, rather than risking one being silently dropped by an edit that
  // had nothing to do with it. `#apply`'s per-element path never reaches a
  // `<script>` in the first place, so this has no effect there.
  for (const script of Array.from(clone.querySelectorAll('script'))) script.remove();
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.startsWith('data-heo-') || attribute.name === 'contenteditable') {
        node.removeAttribute(attribute.name);
      }
    }
  }
  return clone.innerHTML;
}

/**
 * `<head>`'s markup, with the editor's own generated stylesheets and every
 * `<script>` left out.
 *
 * The stylesheets hold the live output of the Tokens and Classes panels, not
 * something meant to be hand-edited here. Scripts are excluded for the reason
 * `#applyDocument` explains: they are carried over and reattached separately so a
 * document apply can never delete a script that was already running. Since that
 * reattachment always happens afterward, leaving text copies of either in this
 * string would only leave behind an inert duplicate every time the document is
 * saved.
 */
function headMarkupExcludingManagedAndScripts(): string {
  const clone = document.head.cloneNode(true) as HTMLElement;
  for (const generated of Array.from(clone.querySelectorAll('[data-heo-generated]'))) {
    generated.remove();
  }
  for (const script of Array.from(clone.querySelectorAll('script'))) script.remove();
  return clone.innerHTML;
}

/**
 * The whole file, doctype included, as something safe to show and re-parse.
 *
 * Everything the live page did not author is left out — the overlay itself, its
 * generated stylesheets, and the `data-heo-*` bookkeeping attributes it leaves on
 * elements — the same standard `bodyMarkup` holds `<body>` to, extended to the
 * whole tree.
 */
function wholeDocumentMarkup(): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  for (const host of Array.from(clone.querySelectorAll(HOST_TAG))) host.remove();
  for (const generated of Array.from(clone.querySelectorAll('[data-heo-generated]'))) {
    generated.remove();
  }
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.startsWith('data-heo-') || attribute.name === 'contenteditable') {
        node.removeAttribute(attribute.name);
      }
    }
  }
  const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '<!DOCTYPE html>';
  return `${doctype}\n${clone.outerHTML}`;
}

function attributeMap(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attribute of Array.from(el.attributes)) out[attribute.name] = attribute.value;
  return out;
}

/** Make `el`'s attributes match `attrs` exactly: added, changed and removed alike. */
function applyAttributeMap(el: Element, attrs: Record<string, string>): void {
  for (const name of Array.from(el.attributes, (attribute) => attribute.name)) {
    if (!(name in attrs)) el.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
}
