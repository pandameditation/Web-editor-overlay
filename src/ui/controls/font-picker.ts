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
  type FontCategory,
  type WebFont,
} from '../../core/fonts.js';
import { catalogueFont, type ProjectFont } from '../../core/project-fonts.js';
import { maybeEngine } from '../context.js';
import { looksFontFamily } from '../../core/tokens.js';
import './font-editor.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

const WEB_FONTS_KEY = 'heo:web-font-previews';
const FALLBACK_CHOICES = ['Georgia', 'Times New Roman', 'Helvetica', 'Arial', 'system-ui', 'serif', 'sans-serif', 'monospace', 'cursive'];

interface Choice {
  name: string;
  tag: string;
  category?: FontCategory;
  web?: WebFont;
  /** One the page carries (added here): it has "Edit font". */
  project?: ProjectFont;
  /** A token's value: what its row is drawn in, rather than its name. */
  face?: string;
  /** For a token, what picking it writes: `var(--font-display)`. */
  token?: string;
  /**
   * Whether clicking picks it. Only a font the page has, or one of this machine's: a Google font
   * is added first ("Add font"), so the page is never saved with a font it does not carry.
   */
  pickable: boolean;
}



/**
 * The font picker, in the dialog a font field opens.
 *
 * Every family is drawn in its own face. Hovering one previews it on the element (`font-preview`,
 * with the stack it would write), leaving the list puts the element back (`font-preview` with
 * null), and clicking picks it (`font-change`). The fallbacks are under the list, as a chain, since
 * they only matter for a family.
 *
 * Three sources: the fonts in this page (the ones it carries, its own `@font-face`s and its font
 * tokens), this machine's installed system fonts, and a set of Google Fonts. The last are off until
 * asked for, because showing them means asking Google for each one: the list says so before it
 * does. Hovering a Google font previews it (loaded into the document's font set, never the page);
 * it cannot be picked until it is added, which its row offers: "Add font" opens the font popover,
 * which downloads its files and keeps them with the page (project-fonts.ts). A font added here has
 * "Edit font" instead, the same popover, to change its styles, its character sets, where its files
 * live, or to remove it. The engine is reached directly, so every host of a font field — the
 * Styles panel, Tokens' text styles — gets the same picker.
 */
/**
 * The typography tokens that name a font: their value, resolved through any `var()`, reads as a
 * family stack. Not the others in the group — `--text-lg: 20px` and `--leading: 1.4` are type too.
 */
function fontTokens(): Array<{ name: string; value: string }> {
  const engine = maybeEngine();
  if (!engine) return [];
  const root = getComputedStyle(document.documentElement);
  return engine.tokens.list('font').flatMap((token) => {
    const value = (root.getPropertyValue(`--${token.name}`).trim() || token.value).trim();
    const words = /^(?:normal|bold|bolder|lighter|italic|oblique|inherit|initial|unset|revert|auto|none)$/i;
    const family = looksFontFamily(value) || (!/^-?[\d.]/.test(value) && !words.test(value) && parseFamilies(value).length > 0);
    return family ? [{ name: token.name, value }] : [];
  });
}

@customElement('heo-font-picker')
export class HeoFontPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        position: relative;
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
      /* Where a font the page carries lives, as the Files table says it. */
      .font .tag.pill {
        max-width: 130px;
        overflow: hidden;
        padding: 1px 6px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 999px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .font .tag.pill.emb {
        border-color: var(--heo-accent-line);
        color: var(--heo-accent);
        font-family: inherit;
      }
      /*
       * A row and its action: Add font or Edit font, over the tag while the row is hovered or
       * focused. A sibling of the row's button, not inside it, so each is its own control.
       */
      .frow {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
      }
      .frow .fact {
        position: absolute;
        top: 50%;
        right: 6px;
        display: none;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 8px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        color: var(--heo-text);
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        translate: 0 -50%;
      }
      .frow .fact:hover {
        border-color: var(--heo-accent-line);
      }
      .frow:hover .fact,
      .frow:focus-within .fact {
        display: inline-flex;
      }
      .frow:has(.fact):hover .tag,
      .frow:has(.fact):focus-within .tag {
        visibility: hidden;
      }
      .font[data-pickable='false'] .nm {
        color: var(--heo-text-dim);
      }
      /*
       * The add / edit popover takes the list's place while it is open, and the list is hidden
       * rather than covered: laid over it, the popover was cut off by the dialog's own height.
       */
      .search[hidden],
      .list[hidden],
      .below[hidden] {
        display: none;
      }
      .below {
        display: grid;
        gap: 8px;
        min-width: 0;
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
  /** The add / edit popover, when it is open. */
  @state() private draft: { family: string; mode: 'add' | 'edit' } | null = null;
  /** Bumped when the page's fonts change, which is part of the list's key. */
  @state() private fontsRevision = 0;
  #unlisten: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unlisten = maybeEngine()?.fonts.onChange(() => {
      this.fontsRevision += 1;
    }) ?? null;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unlisten?.();
    this.#unlisten = null;
  }
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
    // The tokens by content, not by registry revision: a preview bumps that on every hover.
    const key = `${this.query}|${this.web}|${fontTokens().map((one) => `${one.name}=${one.value}`).join(';')}|${this.fontsRevision}`;
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
    const fonts = maybeEngine()?.fonts;
    const carried = (fonts?.list() ?? []).map((font): Choice => ({
      name: font.family,
      tag: font.place === 'embedded' ? 'Embedded' : `${maybeEngine()?.fileFolders.font ?? 'assets/fonts'}/`,
      category: font.category,
      web: catalogueFont(font.family),
      project: font,
      pickable: true,
    }));
    const own = pageFontFamilies()
      .filter((name) => name && !isGenericFamily(name))
      .map((name): Choice => ({ name, tag: 'Your stylesheet', pickable: true }));
    const page = take([...carried, ...own]);
    // Every typography token that names a font, as its own row: picking one writes `var(--…)`.
    const tokens = fontTokens()
      .filter((one) => match(one.name) || match(one.value))
      .map((one): Choice => ({ name: `--${one.name}`, tag: parseFamilies(one.value)[0] ?? '', face: one.value, token: `var(--${one.name})`, pickable: true }));
    const system = take(
      SYSTEM_FONTS.filter((one) => hasLocalFont(one.name)).map((one): Choice => ({ name: one.name, tag: 'This machine', category: one.category, pickable: true })),
    );
    const web = this.web
      ? take(WEB_FONTS.map((one): Choice => ({ name: one.name, tag: one.category, category: one.category, web: one, pickable: false })))
      : [];
    return [
      { group: 'In this page', items: page },
      { group: 'Typography tokens', items: tokens },
      { group: 'System · only where installed', items: system },
      { group: 'Google Fonts', items: web },
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

  #emit(type: 'font-preview' | 'font-change', detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #preview(choice: Choice | null): void {
    const name = choice?.name ?? null;
    if (name === this.#hovered) return;
    this.#hovered = name;
    if (choice?.web) void previewWebFont(choice.web);
    this.#emit('font-preview', { value: choice ? (choice.token ?? this.#stack(choice.name, choice.web)) : null });
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
    // A font the page does not carry is added first: its row's click is "Add font".
    if (!choice.pickable) {
      this.#openDraft(choice.name, 'add');
      return;
    }
    this.#hovered = null;
    this.#emit('font-change', { value: choice.token ?? this.#stack(choice.name, choice.web) });
  }

  /* ---------------------------------------------------------------------- */
  /* Add font / Edit font                                                    */
  /* ---------------------------------------------------------------------- */

  #openDraft(family: string, mode: 'add' | 'edit'): void {
    const font = catalogueFont(family);
    if (!font || !maybeEngine()) return;
    this.draft = { family: font.name, mode };
    // Adding shows the font on the element while it is decided on, as hovering it did.
    if (mode === 'add') {
      this.#hovered = null;
      this.#preview({ name: font.name, tag: '', category: font.category, web: font, pickable: false });
    }
  }

  #closeDraft(): void {
    const draft = this.draft;
    this.draft = null;
    if (draft?.mode === 'add') this.#preview(null);
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(`[data-font="${CSS.escape(draft?.family ?? '')}"]`)?.focus());
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
      <label class="search" ?hidden=${Boolean(this.draft)}>
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
      <div class="list" role="listbox" aria-label="Fonts" ?hidden=${Boolean(this.draft)} @pointerleave=${() => {
        if (!this.draft) this.#preview(null);
      }}>
        ${groups.map((group) => html`
          <div class="group">${group.group}</div>
          ${group.items.map((choice) => {
            const action = choice.project ? 'edit' : !choice.pickable ? 'add' : null;
            return html`<div class="frow" data-row=${choice.name} @pointermove=${(event: PointerEvent) => this.#hover(event, choice)}>
              <button
                class="font"
                type="button"
                role="option"
                data-font=${choice.name}
                data-pickable=${choice.pickable ? 'true' : 'false'}
                aria-current=${(choice.token ?? choice.name).toLowerCase() === current ? 'true' : 'false'}
                aria-selected=${(choice.token ?? choice.name).toLowerCase() === current ? 'true' : 'false'}
                title=${choice.pickable
                  ? `${choice.name}: hover to see it on the element, click to use it`
                  : `${choice.name}: hover to see it on the element; add it to the page to use it`}
                @focus=${() => this.#preview(choice)}
                @blur=${() => this.#preview(null)}
                @click=${() => this.#pick(choice)}
              >
                <span class="nm" style=${`font-family:${choice.face ? choice.face.replace(/[;{}<>]/g, '') : formatFamilies([choice.name, choice.category ? GENERIC_FOR[choice.category] : 'sans-serif'])}`}>${choice.name}</span>
                <span class=${choice.project?.place === 'embedded' ? 'tag pill emb' : choice.project ? 'tag pill' : 'tag'}>${choice.tag}</span>
              </button>
              ${action
                ? html`<button
                    class="fact"
                    type="button"
                    data-font-action=${action}
                    aria-label=${`${action === 'add' ? 'Add font' : 'Edit font'} ${choice.name}`}
                    @focus=${() => this.#preview(choice)}
                    @click=${() => this.#openDraft(choice.name, action)}
                  >${action === 'add' ? html`${icon('plus', 10)} Add font` : html`${icon('sliders', 10)} Edit font`}</button>`
                : nothing}
            </div>`;
          })}
        `)}
        ${!groups.length ? html`<p class="note">No font matches “${this.query}”.</p>` : nothing}
      </div>
      ${this.draft
        ? html`<heo-font-editor
            .family=${this.draft.family}
            .mode=${this.draft.mode}
            @font-editor-close=${(event: Event) => {
              event.stopPropagation();
              this.#closeDraft();
            }}
            @font-editor-done=${(event: CustomEvent<{ family: string; mode: 'add' | 'edit' }>) => {
              event.stopPropagation();
              this.draft = null;
              this.#hovered = null;
              // "Add and use": once it is in the page, it is the font.
              if (event.detail.mode === 'add') this.#emit('font-change', { value: this.#stack(event.detail.family, catalogueFont(event.detail.family)) });
            }}
          ></heo-font-editor>`
        : nothing}
      <div class="below" ?hidden=${Boolean(this.draft)}>
      ${this.web
        ? html`<p class="note">Google fonts are previewed from Google. Adding one keeps its files with the page, so visitors never ask Google for it.</p>`
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
      ${this.#families.length && !/^var\(/i.test(this.#families[0]) ? this.#renderFallbacks() : nothing}
      </div>
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
