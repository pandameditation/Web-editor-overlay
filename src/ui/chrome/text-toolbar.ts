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
  type TextEffect,
} from '../../core/text-effects.js';
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
      .dot:focus-visible,
      .tile:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 3px;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 10px 2px 6px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 650;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .group::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--heo-line);
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      /* A tile is a scrap of page: paper-coloured in both themes, so each effect reads as it will. */
      .tile {
        display: grid;
        justify-items: center;
        align-content: center;
        gap: 4px;
        min-width: 0;
        height: 66px;
        padding: 4px;
        border: 1px solid var(--heo-line);
        border-radius: 10px;
        background: #f4f2ec;
        color: #1f2330;
        cursor: pointer;
        transition:
          border-color var(--heo-fast),
          translate var(--heo-fast),
          box-shadow var(--heo-fast);
      }
      .tile:hover {
        border-color: var(--heo-accent-line);
        translate: 0 -1px;
      }
      .tile[aria-pressed='true'] {
        border-color: var(--heo-accent);
        box-shadow: 0 0 0 3px var(--heo-accent-soft);
      }
      .tile .w {
        font: 800 21px/1.1 system-ui, sans-serif;
        letter-spacing: -0.01em;
      }
      .tile mark.w {
        background-color: transparent;
      }
      .tile .n {
        max-width: 100%;
        overflow: hidden;
        color: #4b5263;
        font-size: 9.5px;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .foot {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--heo-line);
      }
      .foot .primary {
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
    this.fxTop = null;
    this.#fxEscape = pushEscapeLayer(() => this.#closeEffects(true));
    listen(document, 'selectionchange', this.#onSelection);
    // Opened from the keyboard, the focus goes in, to the first tile; by the pointer, it stays in the text.
    // Twice: the menu is drawn hidden, measured, then placed and shown, and a hidden tile takes no focus.
    if (byKeyboard) {
      void this.updateComplete
        .then(() => this.updateComplete)
        .then(() => this.renderRoot.querySelector<HTMLElement>('.fxmenu .tile')?.focus());
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

  #renderEffects(): TemplateResult {
    const current = this.editor.textEffectAtSelection();
    const effect = current ? textEffectById(current.effect) : undefined;
    const styles = this.editor.textEffectStyles();
    const savedName = current?.style ? styles.find((one) => one.entry.name === current.style)?.name : null;
    const color = effectColorById(this.#color);
    const tile = (one: TextEffect): TemplateResult => {
      const on = current?.effect === one.id && !current.style;
      const declarations = one.declarations(color);
      return html`<button
        type="button"
        class="tile"
        data-effect=${one.id}
        aria-pressed=${on ? 'true' : 'false'}
        title=${on ? `${one.about}. Press again to take it off` : one.about}
        @click=${() => this.#apply(one.id)}
      >${one.mark
        ? html`<mark class="w" style=${styleMap(declarations)}>Aa</mark>`
        : html`<span class="w" style=${styleMap(declarations)}>Aa</span>`}<span class="n">${one.label}</span></button>`;
    };
    const selection = getSelection();
    const hint = current
      ? html`On <code>&lt;${current.el.tagName.toLowerCase()}&gt;</code>${savedName ? html` as <b>${savedName}</b>` : nothing}. Fine-tune it in Styles.`
      : selection?.isCollapsed
        ? 'Nothing selected: what you type next gets the effect.'
        : 'Applies to the selected text.';
    return html`<div
      class="fxmenu surface"
      role="dialog"
      aria-label="Text effects"
      style=${`top:${this.fxTop ?? 44}px;${this.fxTop === null ? 'visibility:hidden' : ''}`}
      @pointerdown=${(event: Event) => {
        // A press in the menu keeps the text's selection, as the bar's buttons do; the name field takes the focus.
        if (!(event.composedPath()[0] as HTMLElement).closest?.('input')) event.preventDefault();
      }}
      @keydown=${this.#onEffectsKey}
    >
      <div class="mhead">
        Text effects
        <span class="on">${effect ? `· ${savedName ?? effect.label}` : nothing}</span>
        <button class="btn icon ghost sm" type="button" aria-label="Close" title="Close" @click=${() => this.#closeEffects(true)}>${icon('close', 11)}</button>
      </div>
      <div class="colors" role="radiogroup" aria-label="Effect colour">
        <span class="lab">Colour</span>
        ${EFFECT_COLORS.map((one) => html`<button
          type="button"
          class="dot"
          role="radio"
          data-color=${one.id}
          aria-checked=${one.id === this.#color ? 'true' : 'false'}
          aria-label=${one.label}
          title=${one.label}
          style=${`background:linear-gradient(135deg, ${one.a}, ${one.b})`}
          @click=${() => {
            fxColor = one.id;
            this.editor.recolorTextEffect(one.id);
            this.requestUpdate();
          }}
        ></button>`)}
      </div>
      ${EFFECT_GROUPS.map((group) => html`<div class="group">${group}</div>
        <div class="tiles" role="group" aria-label=${group}>${TEXT_EFFECTS.filter((one) => one.group === group).map(tile)}</div>`)}
      ${styles.length
        ? html`<div class="group">Your text styles</div>
          <div class="tiles" role="group" aria-label="Your text styles">
            ${styles.map((one) => {
              const on = current?.style === one.entry.name;
              const look = Object.fromEntries(Object.entries(one.entry.declarations).filter(([property]) => !property.startsWith('--heo-')));
              const mark = textEffectById(one.effect)?.mark;
              return html`<button
                type="button"
                class="tile"
                data-style=${one.entry.name}
                aria-pressed=${on ? 'true' : 'false'}
                title=${`${one.name}: .${one.entry.name}${on ? '. Press again to take it off' : ''}`}
                @click=${() => {
                  this.editor.applyTextEffectStyle(one.entry.name);
                  this.requestUpdate();
                }}
              >${mark
                ? html`<mark class="w" style=${styleMap(look)}>Aa</mark>`
                : html`<span class="w" style=${styleMap(look)}>Aa</span>`}<span class="n">${one.name}</span></button>`;
            })}
          </div>`
        : nothing}
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
        <button
          class="btn sm"
          type="button"
          data-remove
          ?disabled=${!current}
          title=${current ? 'Take the effect off this text' : 'No effect here'}
          @click=${() => {
            this.editor.removeTextEffect();
            this.requestUpdate();
          }}
        >${icon('close', 11)} Remove</button>
        <button
          class="btn sm primary"
          type="button"
          data-save
          ?disabled=${!current || Boolean(current.style)}
          title=${!current ? 'Apply an effect first' : current.style ? 'Already a text style' : 'Turn this effect into a text style you can reuse'}
          @click=${() => {
            this.fxSaving = true;
            this.fxName = effect ? `${effect.label} ${EFFECT_COLORS.find((one) => one.id === this.#color)?.label ?? ''}`.trim() : '';
            void this.updateComplete.then(() => {
              const input = this.renderRoot.querySelector<HTMLInputElement>('.save input');
              input?.focus();
              input?.select();
            });
          }}
        >${icon('plus', 11)} Save as text style</button>
      </div>
      <p class="fxhint">${hint}</p>
    </div>`;
  }

  #apply(id: string): void {
    this.editor.applyTextEffect(id, this.#color);
    this.fxSaving = false;
    this.requestUpdate();
  }

  #save(event: Event): void {
    event.preventDefault();
    if (!this.fxName.trim()) return;
    this.editor.saveTextEffectStyle(this.fxName);
    this.fxSaving = false;
    this.fxName = '';
  }

  /** The arrows move through the tiles, four to a row, and along the colours. */
  #onEffectsKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.#closeEffects(true);
      return;
    }
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 } as Record<string, number>)[event.key];
    const target = event.composedPath()[0] as HTMLElement;
    if (!step || !target.matches?.('.tile, .dot')) return;
    const dots = target.matches('.dot');
    const items = Array.from(this.renderRoot.querySelectorAll<HTMLElement>(dots ? '.fxmenu .dot' : '.fxmenu .tile'));
    const at = items.indexOf(target);
    const next = items[Math.max(0, Math.min(items.length - 1, at + (dots ? Math.sign(step) : step)))];
    event.preventDefault();
    next?.focus();
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
