import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  formatFamilies,
  GENERIC_FOR,
  hasLocalFont,
  isGenericFamily,
  pageFontFamilies,
  pageFontSources,
  parseFamilies,
  previewWebFont,
  SYSTEM_FONTS,
  WEB_FONTS,
  type FontCategory,
  type WebFont,
} from '../../core/fonts.js';
import { catalogueFont, type ProjectFont } from '../../core/project-fonts.js';
import { maybeEngine } from '../context.js';
import { namesAFont } from '../../core/tokens.js';
import './font-editor.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

const WEB_FONTS_KEY = 'heo:web-font-previews';
/** The generic families a chain can end with, in the order they are usually wanted. */
const FALLBACK_GENERICS = ['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive'];
const GENERIC_LABELS: Record<string, string> = {
  serif: 'any serif',
  'sans-serif': 'any sans-serif',
  monospace: 'any monospace',
  'system-ui': 'the system’s UI font',
  cursive: 'any handwriting',
};

interface Choice {
  name: string;
  tag: string;
  category?: FontCategory;
  web?: WebFont;
  /** One the page carries (added here): it has "Edit font". */
  project?: ProjectFont;
  /** A token's value: what its row is drawn in, rather than its name. */
  face?: string;
  /** What the row says, where it is not the name: `any serif`. */
  label?: string;
  /** A generic family: offered for a fallback only, as the last resort. */
  generic?: boolean;
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
    return namesAFont(value) ? [{ name: token.name, value }] : [];
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
      /* The stack: one slot per font, top first, each an autocomplete with its chevron. */
      .slots {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .slots[hidden] {
        display: none;
      }
      .slot {
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr) 20px;
        align-items: start;
        gap: 4px;
        min-width: 0;
      }
      .slot.over .vf {
        box-shadow: 0 -2px 0 var(--heo-accent);
      }
      .slot .g {
        display: grid;
        place-items: center;
        height: 30px;
        color: var(--heo-text-faint);
        cursor: grab;
      }
      .slot .g:focus-visible {
        outline: 2px solid var(--heo-accent);
        border-radius: 4px;
      }
      .slotbody {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .vf {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        min-width: 0;
        padding: 0 3px 0 8px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        cursor: pointer;
      }
      .vf.on {
        border-color: var(--heo-accent);
        box-shadow: 0 0 0 3px color-mix(in oklab, var(--heo-accent) 16%, transparent);
        cursor: text;
      }
      .vf input,
      .vf .v {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-size: 15px;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        outline: none;
        cursor: inherit;
      }
      .vf input::placeholder {
        color: var(--heo-text);
        opacity: 0.75;
      }
      .vf .role {
        flex: none;
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .vf .chev {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .vf .chev:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .vf .chev[aria-expanded='true'] {
        rotate: 180deg;
      }
      .slot .x {
        display: grid;
        place-items: center;
        width: 20px;
        height: 30px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .slot .x:hover {
        color: var(--heo-danger);
      }
      .then {
        padding-left: 26px;
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .slotfoot {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        padding-left: 18px;
      }
      .slotfoot .add {
        border-style: dashed;
      }
      /* The selected slot's list, under it, as an autocomplete's. */
      .list {
        display: grid;
        gap: 1px;
        max-height: 280px;
        overflow: auto;
        padding: 4px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-md);
        background: var(--heo-raised);
        box-shadow: var(--heo-shadow-md, 0 10px 24px -12px rgb(15 23 42 / 30%));
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 6px 0 2px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text-faint);
        font: inherit;
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-align: left;
        text-transform: uppercase;
        cursor: pointer;
      }
      .group::after {
        content: '';
        flex: 1;
        order: 2;
        border-top: 1px solid var(--heo-line);
      }
      .group .tw {
        display: grid;
        transition: rotate var(--heo-fast);
      }
      .group[aria-expanded='false'] .tw {
        rotate: -90deg;
      }
      .group .n {
        order: 3;
        font-weight: 500;
        letter-spacing: 0;
      }
      .webask {
        display: grid;
        justify-items: start;
        gap: 6px;
        padding: 0 8px 6px;
      }
      .webask .gnote {
        margin: 0;
      }
      .gnote {
        margin: 0 8px 4px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
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
      .note {
        margin: 0;
        color: var(--heo-text-hint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      /* Choosing a token's font: said above the list, with the way back. */
      .tokenbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-accent-soft);
        font-size: 11px;
      }
      .tokenbar .what {
        flex: 1;
        min-width: 0;
      }
      .tokenbar code {
        font-family: var(--heo-mono);
      }
    `,
  ];

  /** The `font-family` value as it is: the family, then its fallbacks. */
  @property({ type: String }) value = '';
  /**
   * The token this value belongs to, when the picker edits a token's own value (Tokens ›
   * Typography): left out of the tokens offered, since a token cannot be its own font.
   */
  @property({ type: String }) selfToken = '';
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

  /**
   * The typography token whose font is being chosen (its row's "Edit font"), or null for the
   * field's own value. While one is, the list and the fallback chain edit the token: what is
   * picked becomes its value, and every element that uses it follows.
   */
  @state() private tokenEdit: string | null = null;

  /** The stack the list and the chain are about: the token's, while one is edited, or the field's. */
  get #chainValue(): string {
    if (this.tokenEdit) return fontTokens().find((one) => one.name === this.tokenEdit)?.value ?? '';
    return this.value;
  }

  get #families(): string[] {
    return parseFamilies(this.#chainValue);
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
    const sources = pageFontSources();
    const own = pageFontFamilies()
      .filter((name) => name && !isGenericFamily(name))
      .map((name): Choice => ({ name, tag: sources.get(name) ?? 'Your stylesheet', pickable: true }));
    const page = take([...carried, ...own]);
    // Every typography token that names a font, as its own row: picking one writes `var(--…)`.
    const tokens = fontTokens()
      .filter((one) => one.name !== this.selfToken)
      .filter((one) => match(one.name) || match(one.value))
      .map((one): Choice => ({ name: `--${one.name}`, tag: parseFamilies(one.value)[0] ?? '', face: one.value, token: `var(--${one.name})`, pickable: true }));
    const system = take(
      SYSTEM_FONTS.filter((one) => hasLocalFont(one.name)).map((one): Choice => ({ name: one.name, tag: 'This machine', category: one.category, pickable: true })),
    );
    const web = this.web
      ? take(WEB_FONTS.map((one): Choice => ({ name: one.name, tag: one.category, category: one.category, web: one, pickable: false })))
      : [];
    const generic = FALLBACK_GENERICS.filter(match).map((name): Choice => ({ name, label: GENERIC_LABELS[name] ?? `any ${name}`, tag: 'Last resort', pickable: true, generic: true }));
    return [
      { group: 'In this page', items: page },
      { group: 'Typography tokens', items: tokens },
      { group: 'System · only where installed', items: system },
      { group: 'Google Fonts', items: web },
      { group: 'Generic families', items: generic },
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

  /*
   * The stack, as slots: the font, then each fallback, top first. One slot is selected, and the
   * list under it chooses what that slot holds — the font and a fallback are chosen the same way.
   * `+ Font` puts an empty slot under the selected one; it is written once something is picked.
   */
  @state() private sel = 0;
  /** Where an empty slot from `+ Font` sits, until it is filled or left. */
  @state() private pending: number | null = null;
  /** Whether the selected slot's list is open (its chevron). */
  @state() private listOpen = true;
  /** Sections folded away, by name. */
  @state() private collapsed = new Set<string>();

  get #slots(): string[] {
    const slots = [...this.#families];
    if (this.pending !== null) slots.splice(Math.min(this.pending, slots.length), 0, '');
    return slots;
  }

  /** The stack with the selected slot holding `value`, empty slots left out. */
  #withSlot(value: string, web?: WebFont): string {
    const slots = this.#slots;
    const at = Math.min(this.sel, Math.max(0, slots.length - 1));
    slots[at] = value;
    const families = slots.filter(Boolean);
    // A web font made the font with nothing after it gets its kind's generic family.
    if (at === 0 && families.length === 1 && web) families.push(GENERIC_FOR[web.category]);
    // The same family twice is read once: keep it where it was just put.
    const seen = new Set<string>();
    const unique = families.filter((one, index) => {
      const key = one.toLowerCase();
      if (seen.has(key) && index !== at) return false;
      seen.add(key);
      return true;
    });
    return formatFamilies(unique);
  }

  /** What a choice puts in a slot: a token's `var()`, or the family. */
  #valueOf(choice: Choice): string {
    return choice.token ?? choice.name;
  }

  #emit(type: 'font-preview' | 'font-change', detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /**
   * Show what picking this would give: the whole stack, with the hovered font in the selected
   * slot — a fallback previewed is the page as it will look where the font above it is missing.
   */
  #preview(choice: Choice | null): void {
    const name = choice ? `${this.sel}:${choice.name}` : null;
    if (name === this.#hovered) return;
    this.#hovered = name;
    if (choice?.web) void previewWebFont(choice.web);
    if (!choice) {
      this.#emit('font-preview', { value: null });
      return;
    }
    // A fallback is seen as what it is: the stack from that slot on, the fonts above it missing.
    const stack = this.#withSlot(this.#valueOf(choice), choice.web);
    const value = this.sel > 0 ? formatFamilies(parseFamilies(stack).slice(this.sel)) : stack;
    this.#emit('font-preview', { value });
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
    if (this.tokenEdit && choice.token) return;
    this.#put(this.#withSlot(this.#valueOf(choice), choice.web));
  }

  /** Write a stack: the slot just filled stays selected, its list closed. */
  #put(stack: string): void {
    this.#hovered = null;
    this.pending = null;
    this.query = '';
    this.listOpen = false;
    this.#setChain(parseFamilies(stack));
  }

  #select(index: number): void {
    if (this.pending !== null && index !== this.pending) {
      // Leaving an empty slot drops it, and what was under it moves up.
      const from = this.pending;
      this.pending = null;
      if (index > from) index -= 1;
    }
    if (index !== this.sel) this.#preview(null);
    this.sel = index;
    this.query = '';
    this.listOpen = true;
  }

  #addSlot(): void {
    const at = Math.min(this.sel + 1, this.#families.length);
    this.#preview(null);
    this.pending = at;
    this.sel = at;
    this.query = '';
    this.listOpen = true;
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>(`.slot[data-at="${at}"] input`)?.focus());
  }

  #removeSlot(index: number): void {
    if (index === this.pending) {
      this.pending = null;
      this.sel = Math.max(0, index - 1);
      return;
    }
    const families = this.#families.filter((_one, at) => at !== index);
    if (!families.length) return;
    this.sel = Math.min(this.sel, families.length - 1);
    this.#setChain(families);
  }

  /** Enter in a slot: the first match that can be picked, or what was typed as a family name. */
  #submitTyped(): void {
    const typed = this.query.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    if (!typed) return;
    const first = this.#visibleGroups().flatMap((group) => group.items).find((one) => one.pickable);
    if (first) this.#pick(first);
    else this.#put(this.#withSlot(typed));
  }

  /** A typography token's new font stack: written to the token, the element's preview taken back. */
  #writeToken(stack: string): void {
    const name = this.tokenEdit;
    if (!name) return;
    this.#preview(null);
    maybeEngine()?.setTokenValue(name, stack);
    this.#listKey = '';
    this.requestUpdate();
  }

  #editToken(name: string | null): void {
    this.#preview(null);
    this.tokenEdit = name;
    this.query = '';
    this.sel = 0;
    this.pending = null;
    this.listOpen = true;
    void this.updateComplete.then(() => {
      const target = name
        ? this.renderRoot.querySelector<HTMLElement>('.tokenbar button')
        : this.renderRoot.querySelector<HTMLElement>('.slot[data-at="0"] input');
      target?.focus();
    });
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

  #setChain(next: string[]): void {
    if (this.tokenEdit) {
      this.#writeToken(formatFamilies(next));
      return;
    }
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
    this.sel = to;
    this.#setChain(chain);
  }

  /** The chip to keep the focus on once the moved chain has rendered. */
  #refocus: number | null = null;

  override updated(): void {
    this.#loadWebNames();
    if (this.#refocus === null) return;
    const at = this.#refocus;
    this.#refocus = null;
    this.renderRoot.querySelector<HTMLElement>(`.slot[data-at="${at}"] .g`)?.focus();
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

  /** The list's sections, as the selected slot sees them. */
  #visibleGroups(): Array<{ group: string; items: Choice[] }> {
    return this.#choices()
      // A token is not a choice for a token's own font, and a generic family only for a fallback.
      .filter((group) => !(this.tokenEdit && group.items.some((one) => one.token)))
      .filter((group) => this.sel > 0 || !group.items.some((one) => one.generic));
  }

  override render(): TemplateResult {
    const slots = this.#slots;
    return html`
      ${this.tokenEdit && !this.draft
        ? html`<div class="tokenbar" data-token-edit=${this.tokenEdit} @keydown=${(event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            event.preventDefault();
            this.#editToken(null);
          }}>
            <span class="what">Font of <code>--${this.tokenEdit}</code>, for every element that uses it</span>
            <button class="btn sm" type="button" @click=${() => this.#editToken(null)}>Done</button>
          </div>`
        : nothing}
      <div class="slots" role="list" aria-label="The font, then its fallbacks, in order" ?hidden=${Boolean(this.draft)}>
        ${(slots.length ? slots : ['']).map((one, at) => this.#renderSlot(one, at, slots.length))}
        <div class="slotfoot">
          <button class="btn sm add" type="button" data-add-slot @click=${() => this.#addSlot()} ?disabled=${this.pending !== null || !this.#families.length}>${icon('plus', 11)} Font</button>
        </div>
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
              // "Add and use": once it is in the page, it is what the selected slot holds.
              if (event.detail.mode !== 'add') return;
              this.#put(this.#withSlot(event.detail.family, catalogueFont(event.detail.family)));
            }}
          ></heo-font-editor>`
        : nothing}
    `;
  }

  #renderSlot(family: string, at: number, count: number): TemplateResult {
    const selected = at === this.sel;
    const generic = isGenericFamily(family);
    const token = /^var\(\s*--([\w-]+)/i.exec(family)?.[1];
    const tokenValue = token ? fontTokens().find((one) => one.name === token)?.value : undefined;
    const face = !family
      ? 'inherit'
      : tokenValue ?? formatFamilies([family, generic ? family : 'serif']);
    const label = !family ? '' : token ? `--${token}` : generic ? GENERIC_LABELS[family] ?? `any ${family}` : family;
    const role = at === 0 ? 'Font' : generic && at === count - 1 ? 'Last resort' : `Fallback ${at}`;
    const on = this.#chipEvents(at);
    const movable = Boolean(family) && this.#families.length > 1;
    return html`${at ? html`<div class="then" aria-hidden="true">↓ if it is missing</div>` : nothing}
      <div
        class="slot"
        role="listitem"
        data-at=${at}
        data-family=${family}
        aria-current=${selected ? 'true' : 'false'}
        @dragover=${on.dragover}
        @dragleave=${on.dragleave}
        @drop=${on.drop}
      >
        <span
          class="g"
          aria-label=${movable ? `Move ${label}. Alt and an arrow move it.` : nothing}
          tabindex=${movable ? '0' : '-1'}
          draggable=${movable ? 'true' : 'false'}
          @dragstart=${on.dragstart}
          @dragend=${on.dragend}
          @keydown=${(event: KeyboardEvent) => this.#chipKey(event, at)}
        >${movable ? icon('grip', 10) : nothing}</span>
        <div class="slotbody">
          <div class=${selected ? 'vf on' : 'vf'} @click=${() => {
            if (!selected) this.#select(at);
          }}>
            ${selected
              ? html`<input
                  type="text"
                  aria-label=${`${role}: search fonts, or type a family`}
                  placeholder=${label || (at ? 'type or pick a fallback' : 'type or pick a font')}
                  style=${`font-family:${face.replace(/[;{}<>]/g, '')}`}
                  .value=${this.query}
                  @focus=${() => {
                    this.listOpen = true;
                  }}
                  @input=${(event: Event) => {
                    this.query = (event.target as HTMLInputElement).value;
                    this.listOpen = true;
                  }}
                  @keydown=${(event: KeyboardEvent) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      this.#submitTyped();
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      this.listOpen = true;
                      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.list [data-font]')?.focus());
                    }
                  }}
                />`
              : html`<button class="v" type="button" style=${`font-family:${face.replace(/[;{}<>]/g, '')}`} title=${`${role}: change it`}>${label || (at ? 'type or pick a fallback' : 'type or pick a font')}</button>`}
            <span class="role">${role}</span>
            <button
              class="chev"
              type="button"
              data-chevron
              aria-label=${`Show the fonts for ${role.toLowerCase()}`}
              aria-expanded=${selected && this.listOpen ? 'true' : 'false'}
              @click=${(event: Event) => {
                event.stopPropagation();
                if (!selected) this.#select(at);
                else this.listOpen = !this.listOpen;
              }}
            >${icon('chevronDown', 11)}</button>
          </div>
          ${selected && this.listOpen ? this.#renderList(family) : nothing}
        </div>
        ${at > 0
          ? html`<button class="x" type="button" aria-label=${`Remove ${label || 'this fallback'}`} title=${`Remove ${label || 'this fallback'}`} @click=${() => this.#removeSlot(at)}>${icon('close', 10)}</button>`
          : html`<span></span>`}
      </div>`;
  }

  #renderList(current: string): TemplateResult {
    const groups = this.#visibleGroups();
    const value = current.toLowerCase();
    return html`<div class="list" role="listbox" aria-label="Fonts" @pointerleave=${() => this.#preview(null)}>
      ${groups.map((group) => {
        const open = !this.collapsed.has(group.group);
        return html`<button
            class="group"
            type="button"
            data-group=${group.group}
            aria-expanded=${open ? 'true' : 'false'}
            @click=${() => {
              const next = new Set(this.collapsed);
              if (open) next.add(group.group);
              else next.delete(group.group);
              this.collapsed = next;
            }}
          ><span class="tw" aria-hidden="true">${icon('chevronDown', 9)}</span>${group.group}<span class="n">${group.items.length}</span></button>
          ${open && group.group === 'Google Fonts'
            ? html`<p class="gnote">Previewed from Google. Adding one keeps its files with the page, so visitors never ask Google for it.</p>`
            : nothing}
          ${open ? group.items.map((choice) => this.#renderRow(choice, value)) : nothing}`;
      })}
      ${!groups.length ? html`<p class="note">No font matches “${this.query}”. Enter uses it as typed.</p>` : nothing}
      ${this.web
        ? nothing
        : html`<div class="group" data-group="Google Fonts">Google Fonts</div>
          <div class="webask">
            <p class="gnote">Google fonts can be previewed here. Showing them asks Google for each font, which tells it this page's address.</p>
            <button class="btn sm" type="button" data-web-fonts @click=${() => {
              this.web = true;
              try {
                localStorage.setItem(WEB_FONTS_KEY, 'on');
              } catch {
                // No storage: on for this session.
              }
            }}>Show Google fonts</button>
          </div>`}
    </div>`;
  }

  #renderRow(choice: Choice, current: string): TemplateResult {
    const action = choice.token ? 'token' : choice.project ? 'edit' : !choice.pickable ? 'add' : null;
    const picked = this.#valueOf(choice).toLowerCase() === current;
    return html`<div class="frow" data-row=${choice.name} @pointermove=${(event: PointerEvent) => this.#hover(event, choice)}>
      <button
        class="font"
        type="button"
        role="option"
        data-font=${choice.name}
        data-pickable=${choice.pickable ? 'true' : 'false'}
        aria-current=${picked ? 'true' : 'false'}
        aria-selected=${picked ? 'true' : 'false'}
        title=${choice.pickable
          ? `${choice.label ?? choice.name}: hover to see it on the element, click to use it`
          : `${choice.name}: hover to see it on the element; add it to the page to use it`}
        @focus=${() => this.#preview(choice)}
        @blur=${() => this.#preview(null)}
        @click=${() => this.#pick(choice)}
        @keydown=${(event: KeyboardEvent) => this.#rowKey(event)}
      >
        <span class="nm" style=${`font-family:${choice.face ? choice.face.replace(/[;{}<>]/g, '') : formatFamilies([choice.name, choice.generic ? choice.name : choice.category ? GENERIC_FOR[choice.category] : 'sans-serif'])}`}>${choice.label ?? choice.name}</span>
        <span class=${choice.project?.place === 'embedded' ? 'tag pill emb' : choice.project || choice.tag.includes('.') ? 'tag pill' : 'tag'}>${choice.tag}</span>
      </button>
      ${action
        ? html`<button
            class="fact"
            type="button"
            data-font-action=${action}
            aria-label=${`${action === 'add' ? 'Add font' : 'Edit font'} ${choice.name}`}
            title=${action === 'token' ? `Choose the font ${choice.name} sets, for every element that uses it` : nothing}
            @focus=${() => this.#preview(choice)}
            @click=${() => (action === 'token' ? this.#editToken(choice.name.replace(/^--/, '')) : this.#openDraft(choice.name, action))}
          >${action === 'add' ? html`${icon('plus', 10)} Add font` : html`${icon('sliders', 10)} Edit font`}</button>`
        : nothing}
    </div>`;
  }

  /** Up and down through the list's rows; up from the first goes back to the slot's field. */
  #rowKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = Array.from(this.renderRoot.querySelectorAll<HTMLElement>('.list [data-font]'));
    const at = rows.indexOf(event.currentTarget as HTMLElement);
    const next = rows[at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (event.key === 'ArrowUp') this.renderRoot.querySelector<HTMLElement>('.slot[aria-current="true"] input')?.focus();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-font-picker': HeoFontPicker;
  }
}
