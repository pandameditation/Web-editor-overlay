import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { copyToClipboard, pickTextFile } from '../../core/design-system.js';
import { normalizeClassName } from '../../core/classes.js';
import { labelFor } from '../../core/dom.js';
import {
  compactDesignSystem,
  recommendedTarget,
  seedSnippets,
  seedStats,
  type SeedTarget,
} from '../../core/seed.js';
import { TOKEN_GROUP_LABELS, TOKEN_GROUPS, prettifyTokenName } from '../../core/tokens.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { DesignClass, DesignToken, TokenGroup } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { classSuggestions } from '../suggestions.js';
import { baseStyles, swatchStyle } from '../theme.js';
import { ClassEditor, focusDeclaration } from './class-editor.js';
import { type HeoValueField } from '../controls/value-field.js';
import '../controls/section.js';

const openGroups = new Set<string>(['component', 'color', 'space', 'classes']);

/**
 * The design system panel: tokens and reusable classes.
 *
 * Ordered by what the user is most likely to act on. Tokens the selected
 * component already uses come first, so a session naturally converges on the
 * existing vocabulary. Below that is the full palette by group, then the class
 * registry, then import and export — because the whole point of defining a system
 * here is being able to carry it to the next page or project.
 *
 * Token edits are written into a managed stylesheet, so changing a value updates
 * everything that references it immediately.
 */
@customElement('heo-tokens-panel')
export class HeoTokensPanel extends HeoElement {
  static override styles = [
    baseStyles,
    ClassEditor.styles,
    css`
      :host {
        display: block;
        padding-bottom: 16px;
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .bar .spacer {
        flex: 1 1 auto;
      }

      .rows {
        display: grid;
        gap: 5px;
      }

      .token {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 6px;
      }
      /* A colour field already draws its own swatch, so the preview column would
         only repeat it. */
      .token.no-preview {
        grid-template-columns: minmax(0, 1fr) auto auto;
      }
      .token .preview {
        display: grid;
        place-items: center;
        width: 22px;
        height: 24px;
        flex: 0 0 auto;
        border: 1px solid var(--heo-line);
        border-radius: 5px;
        background: var(--heo-sunken);
        overflow: hidden;
      }
      .token .preview .fill {
        width: 100%;
        height: 100%;
      }
      .token .preview .bar-fill {
        height: 4px;
        border-radius: 2px;
        background: var(--heo-accent);
      }
      .token .preview .glyph {
        color: var(--heo-text-faint);
      }
      .token .kill {
        display: grid;
        place-items: center;
        width: 22px;
        height: 24px;
        border: 1px solid transparent;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .token .kill:hover {
        border-color: var(--heo-line);
        color: var(--heo-danger);
      }
      .token .used {
        min-width: 20px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        text-align: right;
      }

      .create {
        display: grid;
        gap: 6px;
        padding: 9px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .create .grid {
        display: grid;
        grid-template-columns: 1fr 96px;
        gap: 6px;
      }

      pre {
        margin: 0;
        max-height: 230px;
        overflow: auto;
        padding: 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        line-height: 1.6;
        white-space: pre;
      }

      /* ---- Handing the system to another page ---- */

      .tally {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 8px;
        margin: 0 0 9px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
      }
      .tally b {
        color: var(--heo-text);
        font-weight: 600;
      }
      .tally .sep {
        color: var(--heo-text-faint);
      }
      .tally .spacer {
        flex: 1 1 auto;
      }
      .tally .size {
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--heo-accent-soft);
        color: var(--heo-accent);
        font-family: var(--heo-mono);
        font-size: 10px;
      }

      /* Which integration the snippet is written for. A row of small tabs rather
         than a select, because the whole point is seeing that there are four
         answers and that one of them is yours. */
      .targets {
        display: flex;
        gap: 2px;
        margin-bottom: 7px;
        padding: 2px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .targets button {
        flex: 1 1 0;
        min-width: 0;
        height: 22px;
        padding: 0 5px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        font: inherit;
        font-size: 10.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        transition:
          background var(--heo-fast),
          color var(--heo-fast);
      }
      .targets button:hover {
        color: var(--heo-text);
      }
      .targets button[aria-pressed='true'] {
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-sm);
        color: var(--heo-text);
      }
      .targets button .star {
        color: var(--heo-accent);
      }

      .snippet {
        position: relative;
      }
      /* Wraps, unlike the CSS block above it: a seed is one very long word, and a
         snippet you have to scroll sideways through cannot be checked by eye. */
      .snippet pre {
        max-height: 132px;
        padding-right: 34px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: var(--heo-text);
      }
      .snippet .copy {
        position: absolute;
        top: 5px;
        right: 5px;
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border: 1px solid var(--heo-line);
        border-radius: 5px;
        background: var(--heo-raised);
        color: var(--heo-text-dim);
        cursor: pointer;
      }
      .snippet .copy:hover {
        border-color: var(--heo-accent-line);
        color: var(--heo-accent);
      }

      .note {
        margin: 6px 0 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.5;
      }

      .divide {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 13px 0 9px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .divide::after {
        content: '';
        flex: 1 1 auto;
        height: 1px;
        background: var(--heo-line);
      }

      textarea.paste {
        width: 100%;
        min-height: 54px;
        padding: 7px 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        line-height: 1.5;
        resize: vertical;
        overflow-wrap: anywhere;
      }
      textarea.paste:focus {
        outline: none;
        border-color: var(--heo-accent-line);
        background: var(--heo-bg);
      }
      textarea.paste::placeholder {
        color: var(--heo-text-faint);
        font-family: var(--heo-font);
      }

      .check {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        cursor: pointer;
      }
      .check input {
        width: 13px;
        height: 13px;
        accent-color: var(--heo-accent);
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.registry, s.revision] as const,
    shallowArrayEquals,
  );

  @state() private newName = '';
  @state() private newValue = '';
  @state() private newGroup: TokenGroup = 'color';
  @state() private expandedClass: string | null = null;
  @state() private newClassProperty = '';
  @state() private version = 0;
  @state() private classDraft = '';

  /**
   * The seed for the system as it stands, and what it was built from.
   *
   * Held rather than computed in `render` because encoding is async — compression
   * is a stream — and because it must not be recomputed on every keystroke
   * elsewhere in the panel. `#seedFor` is the document it describes, so a stale
   * seed can be told from a current one without deep-comparing anything.
   */
  @state() private seed = '';
  @state() private seedTarget: SeedTarget | null = null;
  #seedFor = '';
  /** Pasted seed or JSON waiting to be loaded, and whether it replaces or merges. */
  @state() private incoming = '';
  @state() private overwrite = false;

  override render(): TemplateResult {
    const el = this.editor.selected;
    const usage = this.editor.tokens.usage();

    return html`
      <div class="bar">
        <span class="chip">${icon('droplet', 11)} ${this.editor.tokens.size} tokens</span>
        <span class="chip">${icon('blocks', 11)} ${this.editor.classes.size} classes</span>
        <span class="spacer"></span>
        <button
          class="btn sm"
          type="button"
          title="Re-read tokens and classes from the page's stylesheets"
          @click=${this.#rescan}
        >
          ${icon('refresh', 12)}
        </button>
      </div>

      ${el ? this.#renderComponentTokens(el, usage) : nothing}
      ${this.#renderCreate()}
      ${TOKEN_GROUPS.map((group) => this.#renderGroup(group, usage)).filter(Boolean)}
      ${this.#renderClasses(el)}
      ${this.#renderTransfer()}
    `;
  }

  /* ---------------------------------------------------------------------- */

  #renderComponentTokens(el: HTMLElement, usage: Map<string, number>): TemplateResult {
    const tokens = this.editor.tokens.usedBy(el);
    const declarations = this.editor.tokens.tokenDeclarationsOf(el);
    const count = Object.keys(declarations).length;

    return html`<heo-section
      heading="Used by this component"
      glyph="cursor"
      badge=${tokens.length ? String(tokens.length) : ''}
      ?open=${openGroups.has('component')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('component', event.detail.open)}
    >
      ${tokens.length === 0
        ? html`<p class="hint" style="margin:0">
            ${labelFor(el)} does not reference any design token yet. Values picked from a token in
            the Styles panel show up here.
          </p>`
        : html`<p class="hint" style="margin:0 0 8px">
              These are re-proposed first everywhere you pick a value, so siblings stay consistent.
            </p>
            <div class="rows">
              ${repeat(tokens, (token) => token.name, (token) => this.#renderToken(token, usage))}
            </div>`}
      ${count > 0
        ? html`<button
            class="btn sm"
            type="button"
            style="margin-top:9px"
            title="Group these declarations into a reusable class"
            @click=${() => this.editor.beginClassExtraction()}
          >
            ${icon('blocks', 12)} Save ${count} declaration${count === 1 ? '' : 's'} as a class
          </button>`
        : nothing}
    </heo-section>`;
  }

  #renderGroup(group: TokenGroup, usage: Map<string, number>): TemplateResult | typeof nothing {
    const tokens = this.editor.tokens.list(group);
    if (!tokens.length) return nothing;
    return html`<heo-section
      heading=${TOKEN_GROUP_LABELS[group]}
      glyph=${glyphForGroup(group)}
      badge=${String(tokens.length)}
      ?open=${openGroups.has(group)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember(group, event.detail.open)}
    >
      <div class="rows">
        ${repeat(tokens, (token) => token.name, (token) => this.#renderToken(token, usage))}
      </div>
    </heo-section>`;
  }

  #renderToken(token: DesignToken, usage: Map<string, number>): TemplateResult {
    const count = usage.get(token.name) ?? 0;
    const isColor = token.group === 'color';
    return html`<div class=${`token${isColor ? ' no-preview' : ''}`}>
      ${isColor
        ? nothing
        : html`<span class="preview" title=${token.value}>${this.#preview(token)}</span>`}
      <heo-value-field
        label=${token.name}
        .value=${token.value}
        .kind=${isColor ? 'color' : token.group === 'space' ? 'length' : 'text'}
        .suggestions=${[]}
        @value-change=${(event: CustomEvent<{ value: string }>) =>
        this.#setToken(token, event.detail.value)}
      ></heo-value-field>
      <span class="used" title=${count ? `Referenced ${count} times` : 'Not referenced yet'}>
        ${count ? `${count}×` : ''}
      </span>
      <button
        class="kill"
        type="button"
        aria-label=${`Delete --${token.name}`}
        title=${count
        ? `Used ${count} times. Deleting will fall back to each var()'s default.`
        : `Delete --${token.name}`}
        @click=${() => this.#removeToken(token)}
      >
        ${icon('trash', 12)}
      </button>
    </div>`;
  }

  #preview(token: DesignToken): TemplateResult {
    if (token.group === 'color') {
      return html`<span class="fill swatch" style=${swatchStyle(token.value)}></span>`;
    }
    if (token.group === 'space' || token.group === 'size' || token.group === 'radius') {
      return html`<span class="bar-fill" style=${`width:min(18px, max(2px, ${token.value}))`}></span>`;
    }
    if (token.group === 'shadow') {
      return html`<span
        class="fill"
        style=${`box-shadow:${token.value};background:var(--heo-raised);border-radius:3px;transform:scale(.62)`}
      ></span>`;
    }
    return html`<span class="glyph">${icon(glyphForGroup(token.group), 12)}</span>`;
  }

  #renderCreate(): TemplateResult {
    return html`<heo-section
      heading="New token"
      glyph="plus"
      ?open=${openGroups.has('create')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('create', event.detail.open)}
    >
      <div class="create">
        <div class="grid">
          <input
            class="input mono"
            type="text"
            placeholder="token-name"
            .value=${this.newName}
            spellcheck="false"
            aria-label="Token name"
            @input=${(event: Event) => {
        this.newName = (event.target as HTMLInputElement).value;
      }}
          />
          <select
            class="input"
            .value=${this.newGroup}
            aria-label="Token group"
            @change=${(event: Event) => {
        this.newGroup = (event.target as HTMLSelectElement).value as TokenGroup;
      }}
          >
            ${TOKEN_GROUPS.map(
        (group) => html`<option value=${group} ?selected=${group === this.newGroup}>
                ${TOKEN_GROUP_LABELS[group]}
              </option>`,
      )}
          </select>
        </div>
        <heo-value-field
          .value=${this.newValue}
          .kind=${this.newGroup === 'color' ? 'color' : this.newGroup === 'space' ? 'length' : 'text'}
          .suggestions=${[]}
          placeholder="value"
          @value-change=${(event: CustomEvent<{ value: string }>) => {
        this.newValue = event.detail.value;
      }}
        ></heo-value-field>
        <button
          class="btn"
          type="button"
          ?disabled=${!this.newName.trim() || !this.newValue.trim()}
          @click=${this.#createToken}
        >
          ${icon('plus', 12)} Add
          ${this.newName.trim() ? html`<code class="mono">--${this.newName.trim()}</code>` : nothing}
        </button>
      </div>
    </heo-section>`;
  }

  #renderClasses(el: HTMLElement | null): TemplateResult {
    const classes = this.editor.classes.list();
    const usage = this.editor.classes.usage();

    return html`<heo-section
      heading="Reusable classes"
      glyph="blocks"
      badge=${String(classes.length)}
      ?open=${openGroups.has('classes')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('classes', event.detail.open)}
    >
      ${el
        ? html`<button
            class="btn sm"
            type="button"
            style="margin-bottom:8px"
            title="Turn this element's inline styles into a class"
            @click=${() => this.editor.beginClassExtraction(el)}
          >
            ${icon('droplet', 12)} Extract from ${labelFor(el)}
          </button>`
        : nothing}
      ${classes.length === 0
        ? html`<p class="hint" style="margin:0 0 8px">
            No classes yet. Extract one from an element's inline styles, or name a new one below and
            add its properties by hand.
          </p>`
        : repeat(
          classes,
          (entry) => entry.name,
          (entry) => this.#renderClass(entry, usage.get(entry.name) ?? 0, el),
        )}
      <!--
        The same field Styles uses to add a class, and deliberately so: this panel is
        where classes are managed, yet the only way to make one was to extract it from
        an element that already had the styles inline. A class with no element to
        extract from had nowhere to start.
      -->
      <heo-value-field
        style="margin-top:8px"
        label="class"
        action="Create this class"
        action-icon="plus"
        .suggestions=${classSuggestions(this.editor, this.classDraft)}
        placeholder="name a new class"
        @value-input=${(event: CustomEvent<{ value: string }>) => {
        this.classDraft = event.detail.value;
      }}
        @value-submit=${(event: CustomEvent<{ value: string }>) =>
        this.#createClass(event.detail.value, event.target as HeoValueField)}
      ></heo-value-field>
      <p class="hint" style="margin:6px 0 0">
        Enter, or the add button, creates it empty and opens it for editing.
      </p>
    </heo-section>`;
  }

  /**
   * Create an empty class and open it, ready for its first property.
   *
   * Empty on purpose: there is no element to take declarations from here, so the
   * useful next step is the property editor, which is why this expands it rather than
   * leaving the user to find it in the list.
   */
  #createClass(raw: string, field?: HeoValueField): void {
    const name = normalizeClassName(raw);
    if (!name) {
      if (raw.trim()) this.editor.notify(`"${raw}" is not a valid class name.`, 'error');
      return;
    }
    const existing = this.editor.classes.get(name);
    if (existing) {
      this.editor.notify(`.${name} already exists — opening it.`, 'info');
    } else {
      this.editor.classes.upsert({ name, declarations: {}, origin: 'user' });
      this.editor.notify(`Created .${name}.`, 'success');
    }
    this.expandedClass = name;
    this.classDraft = '';
    openGroups.add('classes');
    this.version += 1;
    // Through the field's own API: while focused it ignores external writes to
    // `value`, so assigning to the draft alone would leave the text on screen.
    field?.reset('');
  }

  #renderClass(entry: DesignClass, uses: number, el: HTMLElement | null): TemplateResult {
    return ClassEditor.render(entry, {
      expanded: this.expandedClass === entry.name,
      uses,
      onToggle: () => {
        this.expandedClass = this.expandedClass === entry.name ? null : entry.name;
      },
      host: {
        engine: this.editor,
        element: el,
        newProperty: this.newClassProperty,
        onNewProperty: (value) => {
          this.newClassProperty = value;
        },
        onRemoved: (name) => {
          if (this.expandedClass === name) this.expandedClass = null;
        },
        onFocus: (property) => focusDeclaration(this.renderRoot, property),
      },
    });
  }

  /**
   * Handing this design system to another page, and taking one in.
   *
   * The section used to offer a file download and a file picker, which is the right
   * pair for archiving a system and the wrong one for reusing it: a file has to be
   * hosted somewhere the other page can reach, and the answer to "make this page
   * look like that one" should not involve deployment. So the seed leads — the whole
   * system as one string — and the file stays underneath for when a document
   * belongs in the repository.
   *
   * The seed alone is still only half an answer, since knowing the string does not
   * tell you whether it goes in an attribute, a config object or a script block.
   * Hence a snippet per integration rather than a bare value to copy.
   */
  #renderTransfer(): TemplateResult {
    const doc = this.editor.designSystem();
    const css_ = [this.editor.tokens.toCSS(), this.editor.classes.toCSS()]
      .filter(Boolean)
      .join('\n\n');
    // Encoding is async, so a first render has nothing to show; asking for it here
    // means the seed is ready by the time the section has finished opening. The
    // compacted document is the fingerprint as well as the payload: it is exact,
    // and unlike `doc` it carries no timestamp, so an unchanged system compares
    // equal across renders.
    const key = JSON.stringify(compactDesignSystem(doc));
    if (key !== this.#seedFor) void this.#refreshSeed(key);
    const stats = this.seed ? seedStats(doc, this.seed) : null;
    const target = this.seedTarget ?? (stats ? recommendedTarget(stats) : 'attribute');
    const snippets = this.seed ? seedSnippets(this.seed) : [];
    const active = snippets.find((one) => one.id === target) ?? snippets[0];
    const best = stats ? recommendedTarget(stats) : 'attribute';

    return html`<heo-section
      heading="Share & import"
      glyph="download"
      ?open=${openGroups.has('transfer')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('transfer', event.detail.open)}
    >
      <p class="hint" style="margin:0 0 9px">
        A seed carries this whole system — tokens, classes and blocks — as one string. Paste it into
        any page and that page rebuilds the same vocabulary, with nothing to host and nothing to
        fetch.
      </p>

      ${stats
        ? html`<p class="tally">
              <span><b>${stats.tokens}</b> token${stats.tokens === 1 ? '' : 's'}</span>
              <span class="sep">·</span>
              <span><b>${stats.classes}</b> class${stats.classes === 1 ? '' : 'es'}</span>
              <span class="sep">·</span>
              <span><b>${stats.blocks}</b> block${stats.blocks === 1 ? '' : 's'}</span>
              <span class="spacer"></span>
              <span class="size" title=${stats.saved || 'Length of the seed'}>${stats.size}</span>
            </p>

            <div class="targets" role="group" aria-label="Where the seed is going">
              ${snippets.map(
          (one) => html`<button
                  type="button"
                  aria-pressed=${one.id === target}
                  title=${one.id === best ? `${one.note} Recommended for this size.` : one.note}
                  @click=${() => {
              this.seedTarget = one.id;
            }}
                >
                  ${one.label}${one.id === best
              ? html` <span class="star" aria-label="Recommended">*</span>`
              : nothing}
                </button>`,
        )}
            </div>

            <div class="snippet">
              <pre>${active?.code ?? ''}</pre>
              <button
                class="copy"
                type="button"
                title="Copy this snippet"
                aria-label="Copy this snippet"
                @click=${() => this.#copySnippet(active?.code ?? '')}
              >
                ${icon('copy', 12)}
              </button>
            </div>
            <p class="note">
              ${active?.note}
              ${stats.bulky && target === 'attribute'
            ? html`<br />This seed is ${stats.size} — long for an attribute. The seed block keeps
                  the file readable.`
            : nothing}
            </p>

            <div class="row" style="margin-top:10px">
              <button
                class="btn"
                type="button"
                title="Copy the seed on its own, without any surrounding code"
                @click=${this.#copySeed}
              >
                ${icon('copy', 12)} Copy seed
              </button>
              <button
                class="btn"
                type="button"
                title="Download the system as a JSON file for the repository"
                @click=${() => this.editor.exportDesignSystemFile()}
              >
                ${icon('download', 12)} JSON file
              </button>
            </div>`
        : html`<p class="hint" style="margin:0 0 9px">Building the seed…</p>`}

      <p class="divide">Bring one in</p>
      <div class="field">
        <textarea
          class="paste"
          .value=${this.incoming}
          spellcheck="false"
          aria-label="Seed or design system JSON"
          placeholder="Paste a seed (heo1z.…) or design system JSON here"
          @input=${(event: Event) => {
        this.incoming = (event.target as HTMLTextAreaElement).value;
      }}
          @keydown=${(event: KeyboardEvent) => {
        // Enter alone would be a newline in a textarea, so the commit key is the
        // one that means "done" everywhere else in the overlay.
        if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        void this.#load();
      }}
        ></textarea>
      </div>
      <div class="row" style="margin-top:7px">
        <button
          class="btn primary"
          type="button"
          ?disabled=${!this.incoming.trim()}
          @click=${this.#load}
        >
          ${icon('check', 12)} Load
        </button>
        <button class="btn" type="button" @click=${this.#import}>
          ${icon('upload', 12)} Open a file…
        </button>
        <span class="spacer" style="flex:1 1 auto"></span>
        <label class="check" title="Replace tokens, classes and blocks that already exist here">
          <input
            type="checkbox"
            .checked=${this.overwrite}
            @change=${(event: Event) => {
        this.overwrite = (event.target as HTMLInputElement).checked;
      }}
          />
          Overwrite
        </label>
      </div>

      <p class="divide">Generated CSS</p>
      ${css_
        ? html`<pre>${css_}</pre>`
        : html`<p class="hint" style="margin:0">
            Nothing generated yet. New tokens and classes appear here as CSS, ready to paste into
            the project's stylesheet.
          </p>`}
    </heo-section>`;
  }

  /**
   * Re-encode the seed for the system as it stands.
   *
   * Keyed on a cheap fingerprint rather than the document itself: the section
   * re-renders on every token edit, and compressing a design system on each one
   * would be work nobody asked for. Recorded before awaiting so two renders in the
   * same frame do not both encode.
   */
  async #refreshSeed(key: string): Promise<void> {
    this.#seedFor = key;
    try {
      const seed = await this.editor.designSystemSeed();
      // A later edit already superseded this one; its own pass will land.
      if (this.#seedFor !== key) return;
      this.seed = seed;
    } catch (error) {
      console.error('[html-editor-overlay] could not build the seed', error);
      this.#seedFor = '';
    }
  }

  async #copySnippet(code: string): Promise<void> {
    if (!code) return;
    const ok = await copyToClipboard(code);
    this.editor.notify(
      ok ? 'Snippet copied — paste it into the other page.' : 'Could not access the clipboard.',
      ok ? 'success' : 'error',
    );
  }

  async #copySeed(): Promise<void> {
    if (!this.seed) return;
    const ok = await copyToClipboard(this.seed);
    this.editor.notify(
      ok ? 'Seed copied.' : 'Could not access the clipboard.',
      ok ? 'success' : 'error',
    );
  }

  /** Load whatever was pasted: a seed and raw JSON are the same act from here. */
  async #load(): Promise<void> {
    const text = this.incoming.trim();
    if (!text) return;
    if (await this.editor.importDesignSystemText(text, this.overwrite)) this.incoming = '';
  }

  /* ---------------------------------------------------------------------- */

  #rescan(): void {
    this.editor.tokens.scanDocument();
    this.editor.classes.scanDocument();
    this.editor.notify('Re-read the page stylesheets.', 'success');
  }

  /**
   * Token edits are recorded as undoable commands like any other change, so a
   * mistaken value can be walked back with the same shortcut as everything else.
   */
  #setToken(token: DesignToken, value: string): void {
    if (!value.trim() || value === token.value) return;
    const previous = { ...token };
    this.editor.history.commit({
      label: `Set --${token.name}`,
      mergeKey: `token:${token.name}`,
      subject: `token:${token.name}`,
      record: {
        id: `t${Date.now().toString(36)}`,
        kind: 'token',
        summary: `Set --${token.name} to ${value}`,
        target: ':root',
        before: token.value,
        after: value,
        detail: { token: `--${token.name}`, group: token.group },
        at: Date.now(),
      },
      apply: () => this.editor.tokens.upsert({ ...token, value }),
      revert: () => this.editor.tokens.upsert(previous),
    });
  }

  #createToken(): void {
    const name = this.newName.trim().replace(/^--/, '');
    const value = this.newValue.trim();
    if (!name || !value) return;
    if (!/^[A-Za-z_][\w-]*$/.test(name)) {
      this.editor.notify(`"--${name}" is not a valid custom property name.`, 'error');
      return;
    }
    if (this.editor.tokens.get(name)) {
      this.editor.notify(`--${name} already exists.`, 'error');
      return;
    }
    const token: DesignToken = {
      name,
      value,
      group: this.newGroup,
      label: prettifyTokenName(name),
      origin: 'user',
    };
    this.editor.history.commit({
      label: `Add --${name}`,
      record: {
        id: `t${Date.now().toString(36)}`,
        kind: 'token',
        summary: `Add design token --${name}: ${value}`,
        target: ':root',
        after: value,
        detail: { token: `--${name}`, group: this.newGroup },
        at: Date.now(),
      },
      apply: () => this.editor.tokens.upsert(token),
      revert: () => {
        this.editor.tokens.remove(name);
      },
    });
    this.newName = '';
    this.newValue = '';
    this.editor.notify(`Added --${name}.`, 'success');
  }

  #removeToken(token: DesignToken): void {
    this.editor.history.commit({
      label: `Delete --${token.name}`,
      record: {
        id: `t${Date.now().toString(36)}`,
        kind: 'token',
        summary: `Remove design token --${token.name}`,
        target: ':root',
        before: token.value,
        detail: { token: `--${token.name}` },
        at: Date.now(),
      },
      apply: () => {
        this.editor.tokens.remove(token.name);
      },
      revert: () => this.editor.tokens.upsert(token),
    });
  }


  async #import(): Promise<void> {
    const text = await pickTextFile('application/json,.json,.txt,text/plain');
    if (!text) return;
    await this.editor.importDesignSystemText(text, this.overwrite);
  }

  #remember(id: string, open: boolean): void {
    if (open) openGroups.add(id);
    else openGroups.delete(id);
    this.version += 1;
  }
}

function glyphForGroup(group: TokenGroup): string {
  switch (group) {
    case 'color':
      return 'droplet';
    case 'space':
      return 'wrap';
    case 'size':
      return 'sliders';
    case 'radius':
      return 'card';
    case 'shadow':
      return 'sparkle';
    case 'font':
      return 'text';
    case 'border':
      return 'panel';
    case 'motion':
      return 'refresh';
    default:
      return 'blocks';
  }
}

/** A sensible starting value so a newly added property is immediately visible. */
declare global {
  interface HTMLElementTagNameMap {
    'heo-tokens-panel': HeoTokensPanel;
  }
}
