import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { pickTextFile } from '../../core/design-system.js';
import { labelFor } from '../../core/dom.js';
import { TOKEN_GROUP_LABELS, TOKEN_GROUPS, prettifyTokenName } from '../../core/tokens.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { DesignClass, DesignToken, TokenGroup } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, swatchStyle } from '../theme.js';
import { ClassEditor, focusDeclaration } from './class-editor.js';
import '../controls/value-field.js';
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
        ? html`<p class="hint" style="margin:0">
            No classes yet. Style an element, then extract its declarations into a class to reuse
            them.
          </p>`
        : repeat(
          classes,
          (entry) => entry.name,
          (entry) => this.#renderClass(entry, usage.get(entry.name) ?? 0, el),
        )}
    </heo-section>`;
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

  #renderTransfer(): TemplateResult {
    const css_ = [this.editor.tokens.toCSS(), this.editor.classes.toCSS()]
      .filter(Boolean)
      .join('\n\n');
    return html`<heo-section
      heading="Import & export"
      glyph="download"
      ?open=${openGroups.has('transfer')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('transfer', event.detail.open)}
    >
      <p class="hint" style="margin:0 0 9px">
        A design system file carries tokens, classes and blocks between pages and projects.
      </p>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" type="button" @click=${() => this.editor.exportDesignSystemFile()}>
          ${icon('download', 12)} Export
        </button>
        <button class="btn" type="button" @click=${this.#import}>
          ${icon('upload', 12)} Import
        </button>
      </div>
      ${css_
        ? html`<span class="label" style="display:block;margin-bottom:5px">Generated CSS</span>
            <pre>${css_}</pre>`
        : html`<p class="hint" style="margin:0">
            Nothing generated yet. New tokens and classes appear here as CSS, ready to paste into
            the project's stylesheet.
          </p>`}
    </heo-section>`;
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
    const text = await pickTextFile();
    if (!text) return;
    this.editor.importDesignSystemText(text, false);
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
