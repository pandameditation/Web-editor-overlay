import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { visualBox } from '../../core/dom.js';
import { pushEscapeLayer } from '../../core/keymap.js';
import { listen, unlisten } from '../../core/shield.js';
import {
  EFFECT_COLORS,
  EFFECT_GROUPS,
  effectColorById,
  TEXT_EFFECTS,
  textEffectById,
} from '../../core/text-effects.js';
import { TEXT_EFFECT_MARKER } from '../../core/text-styles.js';

/** A row of the effects menu: a text style (a class) or an effect (inline styles). */
interface FxChoice {
  kind: 'style' | 'effect';
  id: string;
  label: string;
  hint: string;
  mark: boolean;
  look: Record<string, string>;
}
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

      /* Text effects: the button after Strikethrough, and its menu of swatches. */
      .btn.fxbtn {
        width: auto;
        gap: 1px;
        padding: 0 4px 0 6px;
      }
      .btn.fxbtn[aria-expanded='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-accent-text);
      }
      .fxmenu {
        position: absolute;
        left: 0;
        z-index: 1;
        width: 340px;
        padding: 10px;
        overflow: auto;
        overscroll-behavior: contain;
        color: var(--heo-text);
        animation: heo-fx-drop 180ms var(--heo-ease);
      }
      @keyframes heo-fx-drop {
        from {
          opacity: 0;
          translate: 0 -6px;
          scale: 0.98;
        }
      }
      .mhead {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 2px 8px;
        font-size: 11.5px;
        font-weight: 650;
      }
      .mhead .on {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        font-weight: 400;
      }
      .mhead .btn {
        margin-left: auto;
      }
      .colors {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px;
      }
      .colors .lab {
        margin-right: 2px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .dot {
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px rgb(0 0 0 / 20%);
        cursor: pointer;
      }
      .dot[aria-checked='true'] {
        box-shadow: 0 0 0 2px var(--heo-bg), 0 0 0 4px var(--heo-accent);
      }
      .dot:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 3px;
      }
      /* Named as every list in the editor names its groups: the value field's group head. */
      .group {
        padding: 6px 8px 3px;
        color: var(--heo-text-faint);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .fxfind {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        margin: 0 0 8px;
        padding: 0 9px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-faint);
      }
      .fxfind:focus-within {
        border-color: var(--heo-accent-line);
      }
      .fxfind input {
        flex: 1;
        min-width: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-size: 12px;
        outline: none;
      }
      .fxlist {
        display: grid;
        max-height: 320px;
        margin-top: 6px;
        overflow: auto;
        overscroll-behavior: contain;
      }
      /* A row as the value field's option: its look on a scrap of page, its name, what it does. */
      .option {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr) 14px;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 4px 8px 4px 4px;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
      }
      .option:hover,
      .option:focus-visible {
        background: var(--heo-hover);
        outline: none;
      }
      .option:focus-visible {
        box-shadow: inset 0 0 0 2px var(--heo-focus-ring);
      }
      .option[aria-selected='true'] .tx b {
        color: var(--heo-accent-text);
      }
      .option .pv {
        display: grid;
        place-items: center;
        height: 34px;
        overflow: hidden;
        border-radius: 6px;
        background: #f4f2ec;
        color: #1f2330;
        font: 800 17px/1.1 system-ui, sans-serif;
        white-space: nowrap;
      }
      .option .pv mark {
        background-color: transparent;
      }
      .option .tx {
        display: grid;
        min-width: 0;
      }
      .option .tx b {
        overflow: hidden;
        font-size: 11.5px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option .tx small {
        overflow: hidden;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option .ck {
        display: grid;
        color: var(--heo-accent-text);
      }
      .foot {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--heo-line);
      }
      .foot .btn {
        margin-left: auto;
      }
      .save {
        display: flex;
        gap: 6px;
        margin-top: 10px;
      }
      .save input {
        flex: 1;
        min-width: 0;
        height: 28px;
        padding: 0 8px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font-size: 11.5px;
        outline: none;
      }
      .fxhint {
        margin: 8px 2px 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.4;
      }
      .fxhint code {
        font-family: var(--heo-mono);
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
  /** The effects menu, and its "Save as text style" name field. */
  @state() private fxOpen = false;
  @state() private fxSaving = false;
  @state() private fxName = '';
  /** What is typed in the menu's search, and the row the list's arrows are on (`kind:id`). */
  @state() private fxQuery = '';
  @state() private fxActive = '';
  /** Where the menu goes, worked out from the boxes once it has drawn: `top` in px from the bar. */
  @state() private fxTop: number | null = null;

  @query('input[type="url"]') private urlInput?: HTMLInputElement;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#closeEffects(false);
  }

  override updated(): void {
    if (this.fxOpen) this.#placeEffects();
    if (this.linkMode && this.urlInput && this.shadowRoot?.activeElement !== this.urlInput) {
      this.urlInput.focus();
      this.urlInput.select();
    }
  }

  override render(): TemplateResult | typeof nothing {
    const el = this.state.value.textEditing;
    if (!el || !el.isConnected) {
      if (this.linkMode) this.linkMode = false;
      if (this.fxOpen) this.#closeEffects(false);
      return nothing;
    }
    this.#place(el);

    return html`<div class="bar surface">
      ${this.linkMode ? this.#renderLink() : this.#renderFormat()}
    </div>
    ${this.fxOpen && !this.linkMode ? this.#renderEffects() : nothing}`;
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
      <button
        class="btn icon ghost fxbtn"
        type="button"
        title="Text effects: gradient, glow, hand-drawn underline, highlight"
        aria-label="Text effects"
        aria-haspopup="dialog"
        aria-expanded=${this.fxOpen ? 'true' : 'false'}
        @pointerdown=${(event: Event) => event.preventDefault()}
        @click=${(event: MouseEvent) => this.#toggleEffects(event.detail === 0)}
      >
        ${icon('textFx', 14)}${icon('chevronDown', 9)}
      </button>
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
   * Open the link editor for the current text selection.
   *
   * The page keymap uses this same path for Mod+K, so the shortcut preserves the
   * toolbar's saved-range and existing-link behavior instead of creating a second
   * link interaction.
   */
  openLinkEditor(): void {
    this.#openLink();
  }

  /**
   * Capture the selection's existing link before showing the field.
   *
   * Prefilling with the current href turns "add a link" and "fix a link" into
   * the same interaction.
   */
  #openLink(): void {
    let existing = '';
    const anchor = this.editor.linkAtSelection();
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

  /* ---------------------------------------------------------------------- */
  /* Text effects                                                           */
  /* ---------------------------------------------------------------------- */

  /** Unregisters the menu from the page's Escape, while it is open. */
  #fxEscape: (() => void) | null = null;
  /** Following the caret while the menu is open, so its tiles say what the text under it wears. */
  #onSelection = (): void => {
    if (this.fxOpen) this.requestUpdate();
  };

  #toggleEffects(byKeyboard: boolean): void {
    if (this.fxOpen) {
      this.#closeEffects(true);
      return;
    }
    this.fxOpen = true;
    this.fxSaving = false;
    this.fxQuery = '';
    this.fxActive = '';
    this.fxTop = null;
    this.#fxEscape = pushEscapeLayer(() => this.#closeEffects(true));
    listen(document, 'selectionchange', this.#onSelection);
    // Opened from the keyboard, the focus goes in, to the first tile; by the pointer, it stays in the text.
    // Twice: the menu is drawn hidden, measured, then placed and shown, and a hidden tile takes no focus.
    if (byKeyboard) {
      void this.updateComplete
        .then(() => this.updateComplete)
        .then(() => this.renderRoot.querySelector<HTMLElement>('.fxmenu [data-fx-find]')?.focus());
    }
  }

  #closeEffects(refocus: boolean): void {
    if (!this.fxOpen && !this.#fxEscape) return;
    this.fxOpen = false;
    this.fxSaving = false;
    this.#fxEscape?.();
    this.#fxEscape = null;
    unlisten(document, 'selectionchange', this.#onSelection);
    if (refocus && this.shadowRoot?.activeElement) {
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.fxbtn')?.focus());
    }
  }

  /**
   * Where the menu goes: under the bar, unless that covers the text being edited, which is what the
   * effect is being judged on; then above the bar, or under the text. Under the bar as a last resort.
   */
  #placeEffects(): void {
    const menu = this.renderRoot.querySelector<HTMLElement>('.fxmenu');
    const el = this.editor.store.value.textEditing;
    if (!menu || !el) return;
    const bar = this.getBoundingClientRect();
    const box = visualBox(el);
    // Its full height, not the height a cap left it at the last placement.
    menu.style.maxHeight = '';
    const height = menu.offsetHeight;
    const overlaps = (top: number, tall = height): boolean => top < box.top + box.height && top + tall > box.top;
    const fits = (top: number): boolean => top >= 8 && top + height <= innerHeight - 8;
    let top = [bar.bottom + 6, bar.top - 6 - height, box.top + box.height + 8, box.top - 8 - height].find((one) => fits(one) && !overlaps(one));
    let cap: number | null = null;
    if (top === undefined) {
      /*
       * Too tall for anywhere clear of the text: the side with the most room, capped to it and
       * scrolling, still clear of the text. Only with no room on either side does it cover it.
       */
      const below = innerHeight - 8 - (Math.max(bar.bottom, box.top + box.height) + 8);
      const above = Math.min(bar.top, box.top) - 8 - 8;
      if (Math.max(below, above) >= 180) {
        cap = Math.max(below, above);
        top = below >= above ? Math.max(bar.bottom, box.top + box.height) + 8 : 8;
      } else {
        top = bar.bottom + 6;
      }
    }
    menu.style.maxHeight = cap === null ? '' : `${Math.floor(cap)}px`;
    const next = Math.round(top - bar.top);
    if (next !== this.fxTop) this.fxTop = next;
    const left = Math.min(0, innerWidth - 8 - (bar.left + menu.offsetWidth));
    menu.style.left = `${Math.round(Math.max(8 - bar.left, left))}px`;
  }

  /** The colour the menu paints with: kept for the session, so the next effect is in the same one. */
  get #color(): string {
    return fxColor;
  }

  /**
   * The menu's choices, in its sections, filtered by what is typed: the page's text styles first
   * (put on as a class), then the effects by kind (put on as inline styles). Sections are named as
   * every other list in the editor names its groups ("Accepted keywords", "Common values").
   */
  #fxSections(): Array<{ name: string; items: FxChoice[] }> {
    const needle = this.fxQuery.trim().toLowerCase();
    const hit = (...texts: string[]): boolean => !needle || texts.some((text) => text.toLowerCase().includes(needle));
    const color = effectColorById(this.#color);
    const styles: FxChoice[] = this.editor.textStyles()
      .filter((one) => hit(one.name, one.entry.name))
      .map((one) => ({
        kind: 'style',
        id: one.entry.name,
        label: one.name,
        hint: `.${one.entry.name}`,
        mark: textEffectById(one.entry.declarations[TEXT_EFFECT_MARKER]?.trim() ?? '')?.mark ?? false,
        look: Object.fromEntries(Object.entries(one.entry.declarations)
          .filter(([property, value]) => !property.startsWith('--heo-') && value.trim())
          .map(([property, value]) => [property, property === 'font-size' ? `min(17px, ${value})` : value])),
      }));
    const sections: Array<{ name: string; items: FxChoice[] }> = [{ name: 'Text styles', items: styles }];
    for (const group of EFFECT_GROUPS) {
      sections.push({
        name: group,
        items: TEXT_EFFECTS.filter((one) => one.group === group && hit(one.label, one.about, group)).map((one) => ({
          kind: 'effect',
          id: one.id,
          label: one.label,
          hint: one.about,
          mark: Boolean(one.mark),
          look: one.declarations(color),
        })),
      });
    }
    return sections.filter((one) => one.items.length);
  }

  #renderEffects(): TemplateResult {
    const current = this.editor.textEffectAtSelection();
    const effect = current ? textEffectById(current.effect) : undefined;
    const styles = this.editor.textStyles();
    const styleName = current?.style ? styles.find((one) => one.entry.name === current.style)?.name ?? current.style : null;
    const sections = this.#fxSections();
    const flat = sections.flatMap((one) => one.items);
    const isOn = (one: FxChoice): boolean => one.kind === 'style' ? current?.style === one.id : current?.effect === one.id && !current.style;
    // One tab stop for the list: the row the arrows were last on, else the one applied, else the first.
    const focusId = flat.some((one) => `${one.kind}:${one.id}` === this.fxActive)
      ? this.fxActive
      : (() => { const on = flat.find(isOn); return on ? `${on.kind}:${on.id}` : flat[0] ? `${flat[0].kind}:${flat[0].id}` : ''; })();
    const selection = getSelection();
    const hint = current
      ? html`On <code>&lt;${current.el.tagName.toLowerCase()}&gt;</code>${styleName ? html` as <b>${styleName}</b>` : nothing}. Undo takes it back.`
      : selection?.isCollapsed
        ? 'Nothing selected: what you type next gets it.'
        : 'Applies to the selected words.';
    const row = (one: FxChoice): TemplateResult => {
      const key = `${one.kind}:${one.id}`;
      const on = isOn(one);
      return html`<button
        type="button"
        class="option"
        role="option"
        data-fx-kind=${one.kind}
        data-effect=${one.kind === 'effect' ? one.id : nothing}
        data-style=${one.kind === 'style' ? one.id : nothing}
        tabindex=${key === focusId ? '0' : '-1'}
        aria-selected=${on ? 'true' : 'false'}
        title=${on ? `${one.label}: on these words. Press again to take it off` : one.hint}
        @focus=${() => { this.fxActive = key; }}
        @click=${() => this.#pick(one)}
      >
        <span class="pv">${one.mark
          ? html`<mark style=${styleMap(one.look)}>Pottery</mark>`
          : html`<span style=${styleMap(one.look)}>Pottery</span>`}</span>
        <span class="tx"><b>${one.label}</b><small>${one.hint}</small></span>
        <span class="ck" aria-hidden="true">${on ? icon('check', 12) : nothing}</span>
      </button>`;
    };
    return html`<div
      class="fxmenu surface"
      role="dialog"
      aria-label="Text effects and text styles"
      style=${`top:${this.fxTop ?? 44}px;${this.fxTop === null ? 'visibility:hidden' : ''}`}
      @pointerdown=${(event: Event) => {
        // A press in the menu keeps the text's selection, as the bar's buttons do; a field takes the focus.
        if (!(event.composedPath()[0] as HTMLElement).closest?.('input')) event.preventDefault();
      }}
      @keydown=${this.#onEffectsKey}
    >
      <div class="mhead">
        Text effects
        <span class="on">${current ? `· ${styleName ?? effect?.label ?? ''}` : nothing}</span>
        <button class="btn icon ghost sm" type="button" tabindex="-1" aria-label="Close" title="Close (Esc)" @click=${() => this.#closeEffects(true)}>${icon('close', 11)}</button>
      </div>
      <label class="fxfind">
        ${icon('search', 12)}
        <input
          type="text"
          data-fx-find
          placeholder="Find a text style or an effect"
          aria-label="Find a text style or an effect"
          aria-controls="fx-list"
          autocomplete="off"
          spellcheck="false"
          .value=${this.fxQuery}
          @input=${(event: Event) => {
            this.fxQuery = (event.target as HTMLInputElement).value;
            this.fxActive = '';
          }}
        />
      </label>
      <div class="colors" role="radiogroup" aria-label="Effect colour">
        <span class="lab">Colour</span>
        ${EFFECT_COLORS.map((one) => html`<button
          type="button"
          class="dot"
          role="radio"
          data-color=${one.id}
          tabindex=${one.id === this.#color ? '0' : '-1'}
          aria-checked=${one.id === this.#color ? 'true' : 'false'}
          aria-label=${one.label}
          title=${`${one.label}: the colour of the effects below${current && !current.style ? ', and of the one on these words' : ''}`}
          style=${`background:linear-gradient(135deg, ${one.a}, ${one.b})`}
          @click=${() => this.#setColor(one.id)}
        ></button>`)}
      </div>
      <div class="fxlist" id="fx-list" role="listbox" aria-label="Text styles and effects">
        ${sections.map((one) => html`<div class="group" role="presentation">${one.name}</div>${one.items.map(row)}`)}
        ${!flat.length ? html`<p class="fxhint" style="margin:6px 8px">Nothing matches “${this.fxQuery}”.</p>` : nothing}
      </div>
      ${this.fxSaving
        ? html`<form class="save" @submit=${this.#save}>
            <input
              type="text"
              placeholder="Style name, e.g. Hero underline"
              aria-label="Text style name"
              autocomplete="off"
              .value=${this.fxName}
              @input=${(event: Event) => { this.fxName = (event.target as HTMLInputElement).value; }}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                this.fxSaving = false;
              }}
            />
            <button class="btn sm primary" type="submit" ?disabled=${!this.fxName.trim()}>Save</button>
          </form>`
        : nothing}
      <div class="foot">
        ${current?.style
          ? html`<button
              class="btn sm"
              type="button"
              data-edit-style
              title=${`Edit ${styleName} in Tokens › Text styles: every word in it follows`}
              @click=${() => {
                const name = current.style!;
                this.#closeEffects(false);
                this.editor.editTextStyle(name);
              }}
            >${icon('sliders', 11)} Edit ${styleName} in Tokens</button>`
          : html`<button
              class="btn sm primary"
              type="button"
              data-save
              ?disabled=${!current}
              title=${current ? 'Turn this effect into a text style you can reuse' : 'Apply an effect first'}
              @click=${() => {
                this.fxSaving = true;
                this.fxName = effect ? `${effect.label} ${EFFECT_COLORS.find((one) => one.id === this.#color)?.label ?? ''}`.trim() : '';
                void this.updateComplete.then(() => {
                  const input = this.renderRoot.querySelector<HTMLInputElement>('.save input');
                  input?.focus();
                  input?.select();
                });
              }}
            >${icon('plus', 11)} Save as text style</button>`}
      </div>
      <p class="fxhint">${hint}</p>
    </div>`;
  }

  #pick(one: FxChoice): void {
    if (one.kind === 'style') this.editor.applyTextEffectStyle(one.id);
    else this.editor.applyTextEffect(one.id, this.#color);
    this.fxActive = `${one.kind}:${one.id}`;
    this.fxSaving = false;
    this.requestUpdate();
  }

  #setColor(id: string): void {
    fxColor = id;
    this.editor.recolorTextEffect(id);
    this.requestUpdate();
  }

  #save(event: Event): void {
    event.preventDefault();
    if (!this.fxName.trim()) return;
    this.editor.saveTextEffectStyle(this.fxName);
    this.fxSaving = false;
    this.fxName = '';
  }

  /**
   * Three stops for Tab, as a toolbar's groups have: the search, the colours, the list. Inside the
   * colours the arrows choose one (a radio group); inside the list they move through the rows, and
   * Enter or Space puts the row's style or effect on. Down from the search goes into the list.
   */
  #onEffectsKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.#closeEffects(true);
      return;
    }
    const target = event.composedPath()[0] as HTMLElement;
    const rows = (): HTMLElement[] => Array.from(this.renderRoot.querySelectorAll<HTMLElement>('.fxlist .option'));
    const focusRow = (row: HTMLElement | undefined): void => {
      if (!row) return;
      row.focus();
      row.scrollIntoView({ block: 'nearest' });
    };
    if (target.matches?.('[data-fx-find]')) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusRow(rows()[0]);
      } else if (event.key === 'Enter') {
        // Enter in the search: the first match, as an autocomplete takes it.
        event.preventDefault();
        rows()[0]?.click();
      }
      return;
    }
    if (target.matches?.('.dot')) {
      const step = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[event.key];
      if (!step) return;
      event.preventDefault();
      const at = EFFECT_COLORS.findIndex((one) => one.id === this.#color);
      const next = EFFECT_COLORS[(at + step + EFFECT_COLORS.length) % EFFECT_COLORS.length]!;
      this.#setColor(next.id);
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`.dot[data-color="${next.id}"]`)?.focus());
      return;
    }
    if (target.matches?.('.option')) {
      const list = rows();
      const at = list.indexOf(target);
      const next = event.key === 'ArrowDown' ? list[Math.min(list.length - 1, at + 1)]
        : event.key === 'ArrowUp' ? (at === 0 ? undefined : list[at - 1])
          : event.key === 'Home' ? list[0]
            : event.key === 'End' ? list.at(-1)
              : null;
      if (next === null) return;
      event.preventDefault();
      // Up from the first row goes back to the search, where Down came from.
      if (next === undefined) this.renderRoot.querySelector<HTMLElement>('[data-fx-find]')?.focus();
      else focusRow(next);
    }
  };

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

/** The colour the effects menu paints with, kept for the session across text edits. */
let fxColor = EFFECT_COLORS[0]!.id;

declare global {
  interface HTMLElementTagNameMap {
    'heo-text-toolbar': HeoTextToolbar;
  }
}
