import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  formatFamilies,
  GENERIC_FOR,
  hasLocalFont,
  isGenericFamily,
  pageFontFamilies,
  parseFamilies,
  previewWebFont,
  SYSTEM_FONTS,
  WEB_FONTS,
  webFontCss,
  type FontCategory,
  type WebFont,
} from '../../core/fonts.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

const WEB_FONTS_KEY = 'heo:web-font-previews';
const FALLBACK_CHOICES = ['Georgia', 'Times New Roman', 'Helvetica', 'Arial', 'system-ui', 'serif', 'sans-serif', 'monospace', 'cursive'];

interface Choice {
  name: string;
  tag: string;
  category?: FontCategory;
  web?: WebFont;
}

/**
 * The font picker, in the dialog a font field opens.
 *
 * Every family is drawn in its own face. Hovering one previews it on the element (`font-preview`,
 * with the stack it would write), leaving the list puts the element back (`font-preview` with
 * null), and clicking picks it (`font-change`). The fallbacks are under the list, as a chain, since
 * they only matter for a family.
 *
 * Three sources: the page's own fonts (its `@font-face`s and its font tokens), this machine's
 * system fonts that are installed, and a set of Google Fonts. The last are off until asked for,
 * because showing them means asking Google for each one: the list says so before it does. A web
 * font is loaded for a preview into the document's font set, never into the page; picking one also
 * fires `font-web` with its stylesheet, for the host to link into the page.
 */
@customElement('heo-font-picker')
export class HeoFontPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
        width: 100%;
        min-width: 0;
        font-size: 11.5px;
      }
      .search {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 8px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-faint);
      }
      .search input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font: inherit;
        outline: none;
      }
      .list {
        display: grid;
        gap: 1px;
        max-height: 260px;
        overflow: auto;
        margin: 0 -4px;
        padding: 0 4px;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 6px 0 2px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .group::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--heo-line);
      }
      /*
       * One height for every row, whatever its face. Each name is drawn in its own font, and a face
       * with taller glyphs made its row taller: the list moved under a still pointer, which hovered
       * the next font, which moved it again — the picker flickered.
       */
      .font {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        height: 32px;
        padding: 0 8px;
        overflow: hidden;
        border: 1px solid transparent;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
      }
      .font:hover,
      .font:focus-visible {
        background: var(--heo-hover);
        outline: none;
      }
      .font[aria-current='true'] {
        border-color: var(--heo-accent-line);
      }
      .font .nm {
        display: block;
        overflow: hidden;
        height: 22px;
        font-size: 17px;
        line-height: 22px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .font .tag {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
      }
      .note {
        margin: 0;
        color: var(--heo-text-hint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .webask {
        display: grid;
        gap: 6px;
        padding: 8px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
      }
      .webask .btn {
        justify-self: start;
      }
      .fallbacks {
        display: grid;
        gap: 6px;
        padding: 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .chain {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        color: var(--heo-text-faint);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 3px 0 7px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 999px;
        background: var(--heo-raised);
        color: var(--heo-text);
        font-size: 12px;
      }
      .chip[draggable='true'] {
        cursor: grab;
      }
      .chip .g {
        display: grid;
        margin-left: -3px;
        color: var(--heo-text-faint);
      }
      .chip.over {
        box-shadow: -2px 0 0 var(--heo-accent);
      }
      .chip:focus-visible {
        outline: 2px solid var(--heo-accent);
        outline-offset: 1px;
      }
      .chip.first {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        font-weight: 600;
      }
      .chip.generic {
        border-style: dashed;
      }
      .chip button {
        display: grid;
        place-items: center;
        width: 16px;
        height: 16px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--heo-text-dim);
        cursor: pointer;
      }
      .chip button:hover {
        color: var(--heo-danger);
      }
      .chain select {
        height: 22px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: 999px;
        background: transparent;
        color: var(--heo-text-faint);
        font: inherit;
        font-size: 11px;
      }
    `,
  ];

  /** The `font-family` value as it is: the family, then its fallbacks. */
  @property({ type: String }) value = '';
  /** The page's font tokens' families, offered with its `@font-face` ones. */
  @property({ attribute: false }) tokenFamilies: readonly string[] = [];

  @state() private query = '';
  @state() private web = (() => {
    try {
      return localStorage.getItem(WEB_FONTS_KEY) === 'on';
    } catch {
      return false;
    }
  })();
  /** Web fonts whose name glyphs have loaded, so they draw in their own face. */
  @state() private ready = new Set<string>();
  #hovered: string | null = null;

  get #families(): string[] {
    return parseFamilies(this.value);
  }

  get #fallbacks(): string[] {
    return this.#families.slice(1);
  }

  /*
   * The list, worked out once per search and per web-font switch, not on every render. A render
   * comes with every preview (the host repaints the element), and a list read afresh each time
   * could change under the pointer — fonts appearing as they loaded — which hovered something else.
   */
  #listKey = '';
  #list: Array<{ group: string; items: Choice[] }> = [];

  #choices(): Array<{ group: string; items: Choice[] }> {
    const key = `${this.query}|${this.web}|${this.tokenFamilies.join(',')}`;
    if (key === this.#listKey) return this.#list;
    this.#listKey = key;
    this.#list = this.#readChoices();
    return this.#list;
  }

  #readChoices(): Array<{ group: string; items: Choice[] }> {
    const needle = this.query.trim().toLowerCase();
    const match = (name: string): boolean => !needle || name.toLowerCase().includes(needle);
    const seen = new Set<string>();
    const take = (items: Choice[]): Choice[] =>
      items.filter((one) => {
        const key = one.name.toLowerCase();
        if (seen.has(key) || !match(one.name)) return false;
        seen.add(key);
        return true;
      });
    const pageNames = [...pageFontFamilies(), ...this.tokenFamilies].filter((name) => name && !isGenericFamily(name));
    const page = take(pageNames.map((name) => ({ name, tag: 'In this page' })));
    const system = take(
      SYSTEM_FONTS.filter((one) => hasLocalFont(one.name)).map((one) => ({ name: one.name, tag: 'System', category: one.category })),
    );
    const web = this.web
      ? take(WEB_FONTS.map((one) => ({ name: one.name, tag: `Google · ${one.category}`, category: one.category, web: one })))
      : [];
    return [
      { group: 'In this page', items: page },
      { group: 'System', items: system },
      { group: 'Web fonts', items: web },
    ].filter((one) => one.items.length);
  }

  #loadWebNames(): void {
    if (!this.web) return;
    // Each web font's name, in its own face: only those glyphs are asked for.
    for (const font of WEB_FONTS) {
      if (this.ready.has(font.name)) continue;
      void previewWebFont(font, font.name).then((ok) => {
        if (ok && !this.ready.has(font.name)) this.ready = new Set([...this.ready, font.name]);
      });
    }
  }

  #stack(family: string, web?: WebFont): string {
    const rest = this.#fallbacks.filter((one) => one.toLowerCase() !== family.toLowerCase());
    // A web font picked with no fallbacks of its own gets its kind's generic family.
    const fallbacks = rest.length ? rest : web ? [GENERIC_FOR[web.category]] : [];
    return formatFamilies([family, ...fallbacks]);
  }

  #emit(type: 'font-preview' | 'font-change' | 'font-web', detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #preview(choice: Choice | null): void {
    const name = choice?.name ?? null;
    if (name === this.#hovered) return;
    this.#hovered = name;
    if (choice?.web) void previewWebFont(choice.web);
    this.#emit('font-preview', { value: choice ? this.#stack(choice.name, choice.web) : null });
  }

  #pointer: { x: number; y: number } | null = null;

  /**
   * Preview the font under the pointer, once the pointer has moved. Not on entering a row: a row
   * also "enters" under a pointer that is standing still when the list moves, and that is no
   * choice of the user's.
   */
  #hover(event: PointerEvent, choice: Choice): void {
    const at = { x: event.clientX, y: event.clientY };
    const moved = !this.#pointer || this.#pointer.x !== at.x || this.#pointer.y !== at.y;
    this.#pointer = at;
    if (moved) this.#preview(choice);
  }

  #pick(choice: Choice): void {
    this.#hovered = null;
    if (choice.web) {
      void previewWebFont(choice.web);
      this.#emit('font-web', { href: webFontCss(choice.web), family: choice.name });
    }
    this.#emit('font-change', { value: this.#stack(choice.name, choice.web) });
  }

  #setFallbacks(next: string[]): void {
    const first = this.#families[0];
    if (!first) return;
    this.#setChain([first, ...next]);
  }

  #setChain(next: string[]): void {
    this.#emit('font-change', { value: formatFamilies(next) });
  }

  /*
   * The chain reorders as the filter editor's chips do: drag a chip onto another, or Alt and an
   * arrow on a focused one. The family itself moves too: a fallback dragged to the front becomes the
   * family, since the order is all a stack is.
   */
  #dragFrom: number | null = null;

  #move(from: number, to: number): void {
    const chain = [...this.#families];
    if (from === to || from < 0 || to < 0 || from >= chain.length || to >= chain.length) return;
    const [one] = chain.splice(from, 1);
    chain.splice(to, 0, one);
    this.#refocus = to;
    this.#setChain(chain);
  }

  /** The chip to keep the focus on once the moved chain has rendered. */
  #refocus: number | null = null;

  override updated(): void {
    this.#loadWebNames();
    if (this.#refocus === null) return;
    const at = this.#refocus;
    this.#refocus = null;
    this.renderRoot.querySelector<HTMLElement>(`.chip[data-at="${at}"]`)?.focus();
  }

  #chipKey(event: KeyboardEvent, index: number): void {
    if (!event.altKey) return;
    const step = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[event.key];
    if (!step) return;
    event.preventDefault();
    this.#move(index, Math.max(0, Math.min(this.#families.length - 1, index + step)));
  }

  #chipEvents(index: number) {
    return {
      dragstart: (event: DragEvent) => {
        // A drag from the cross is a press of the cross.
        if ((event.composedPath()[0] as HTMLElement).closest?.('button')) {
          event.preventDefault();
          return;
        }
        this.#dragFrom = index;
        event.dataTransfer?.setData('text/plain', `font:${index}`);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      },
      dragover: (event: DragEvent) => {
        if (this.#dragFrom === null) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).classList.add('over');
      },
      dragleave: (event: DragEvent) => (event.currentTarget as HTMLElement).classList.remove('over'),
      drop: (event: DragEvent) => {
        (event.currentTarget as HTMLElement).classList.remove('over');
        const from = this.#dragFrom;
        this.#dragFrom = null;
        if (from === null || from === index) return;
        event.preventDefault();
        this.#move(from, index);
      },
      dragend: () => {
        this.#dragFrom = null;
      },
    };
  }

  override render(): TemplateResult {
    const current = (this.#families[0] ?? '').toLowerCase();
    const groups = this.#choices();
    return html`
      <label class="search">
        ${icon('search', 12)}
        <input
          type="text"
          placeholder="Search fonts"
          aria-label="Search fonts"
          .value=${this.query}
          @input=${(event: Event) => {
            this.query = (event.target as HTMLInputElement).value;
          }}
        />
      </label>
      <div class="list" role="listbox" aria-label="Fonts" @pointerleave=${() => this.#preview(null)}>
        ${groups.map((group) => html`
          <div class="group">${group.group}</div>
          ${group.items.map((choice) => html`<button
            class="font"
            type="button"
            role="option"
            data-font=${choice.name}
            aria-current=${choice.name.toLowerCase() === current ? 'true' : 'false'}
            aria-selected=${choice.name.toLowerCase() === current ? 'true' : 'false'}
            title=${`${choice.name}: hover to see it on the element, click to use it`}
            @pointermove=${(event: PointerEvent) => this.#hover(event, choice)}
            @focus=${() => this.#preview(choice)}
            @blur=${() => this.#preview(null)}
            @click=${() => this.#pick(choice)}
          >
            <span class="nm" style=${`font-family:${formatFamilies([choice.name, choice.category ? GENERIC_FOR[choice.category] : 'sans-serif'])}`}>${choice.name}</span>
            <span class="tag">${choice.tag}</span>
          </button>`)}
        `)}
        ${!groups.length ? html`<p class="note">No font matches “${this.query}”.</p>` : nothing}
      </div>
      ${this.web
        ? html`<p class="note">Web fonts are previewed from Google Fonts. Picking one links its stylesheet into the page.</p>`
        : html`<div class="webask">
            <p class="note">Web fonts from Google Fonts can be previewed here. Showing them asks Google for each font, which tells it this page's address.</p>
            <button class="btn sm" type="button" @click=${() => {
              this.web = true;
              try {
                localStorage.setItem(WEB_FONTS_KEY, 'on');
              } catch {
                // No storage: on for this session.
              }
            }}>Show web fonts</button>
          </div>`}
      ${this.#families.length ? this.#renderFallbacks() : nothing}
    `;
  }

  #renderFallbacks(): TemplateResult {
    const [first, ...rest] = this.#families;
    const missing = FALLBACK_CHOICES.filter((one) => !rest.some((r) => r.toLowerCase() === one.toLowerCase()) && one.toLowerCase() !== first.toLowerCase());
    return html`<div class="fallbacks">
      <div class="group" style="margin:0">If ${first} is not there</div>
      <div class="chain" role="list" aria-label="Fallback fonts, in order">
        ${this.#families.map((one, at) => {
          const on = this.#chipEvents(at);
          const name = isGenericFamily(one) ? `any ${one}` : one;
          const movable = this.#families.length > 1;
          return html`${at ? '→' : nothing}<span
            class=${at === 0 ? 'chip first' : isGenericFamily(one) ? 'chip generic' : 'chip'}
            role="listitem"
            data-at=${at}
            data-family=${one}
            draggable=${movable ? 'true' : 'false'}
            tabindex=${movable ? '0' : '-1'}
            aria-label=${`${name}, ${at + 1} of ${this.#families.length}${movable ? '. Alt and an arrow move it.' : ''}`}
            title=${movable ? (at === 0 ? `${one}. Drag to reorder: what is first is the font.` : `${name}. Drag to reorder; Alt and an arrow move it.`) : one}
            style=${`font-family:${formatFamilies(at === 0 ? [one, 'serif'] : [one])}`}
            @keydown=${(event: KeyboardEvent) => this.#chipKey(event, at)}
            @dragstart=${on.dragstart}
            @dragover=${on.dragover}
            @dragleave=${on.dragleave}
            @drop=${on.drop}
            @dragend=${on.dragend}
          >
            ${movable ? html`<span class="g" aria-hidden="true">${icon('grip', 10)}</span>` : nothing}
            ${name}
            ${at > 0
              ? html`<button type="button" aria-label=${`Remove ${one}`} title=${`Remove ${one}`} @click=${() => this.#setFallbacks(rest.filter((_x, index) => index !== at - 1))}>${icon('close', 9)}</button>`
              : nothing}
          </span>`;
        })}
        ${missing.length
          ? html`<select aria-label="Add a fallback" @change=${(event: Event) => {
              const select = event.target as HTMLSelectElement;
              if (select.value) this.#setFallbacks([...rest, select.value]);
              select.value = '';
            }}>
              <option value="">+ add</option>
              ${missing.map((one) => html`<option value=${one}>${isGenericFamily(one) ? `any ${one}` : one}</option>`)}
            </select>`
          : nothing}
      </div>
      <p class="note">What visitors see while ${first} loads, or if it never does.</p>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-font-picker': HeoFontPicker;
  }
}
