import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { formatFamilies, GENERIC_FOR } from '../../core/fonts.js';
import {
  catalogueFont,
  defaultStyles,
  isItalicStyle,
  OFFERED_SUBSETS,
  styleLabel,
  SUBSET_LABELS,
  type FontStyleKey,
} from '../../core/project-fonts.js';
import { maybeEngine } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';

/** The editor's state while it is open. */
interface FontDraft {
  mode: 'add' | 'edit';
  family: string;
  /** What Google offers it in; null while asking, `false` when it could not be reached. */
  offer: { styles: FontStyleKey[]; subsets: string[] } | null | false;
  styles: FontStyleKey[];
  subsets: string[];
  place: 'embedded' | 'stored';
  busy: boolean;
  error: string;
  confirmRemove: boolean;
}

/**
 * Add a web font to the page, or edit one it carries: its styles, its character sets, where its
 * files live (stored in the fonts folder or embedded), and removing it.
 *
 * One element for every place a font is managed from — the font picker's "Add font" and "Edit
 * font", and Tokens › Fonts — so the three cannot drift apart. It talks to the engine itself
 * (`saveProjectFont`, `removeProjectFont`), and says when it is done: `font-editor-done`, with the
 * family and `add`, `edit` or `remove`, or `font-editor-close` when it was left without a change.
 */
@customElement('heo-font-editor')
export class HeoFontEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .fpop {
        display: grid;
        box-shadow: var(--heo-shadow-lg);
        gap: 10px;
        padding: 10px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-md);
        background: color-mix(in oklab, var(--heo-accent) 4%, var(--heo-raised));
      }
      .fhead {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }
      .fhead .fam {
        overflow: hidden;
        font-size: 20px;
        line-height: 1.2;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fhead .fsub {
        flex: 1;
        min-width: 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .fhead .fsub b {
        color: var(--heo-text-dim);
      }
      .fhead .x {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .fhead .x:hover {
        background: var(--heo-hover);
      }
      .field {
        display: grid;
        gap: 5px;
      }
      .field .lbl {
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .ch {
        display: inline-flex;
        align-items: center;
        height: 24px;
        padding: 0 9px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 999px;
        background: var(--heo-raised);
        color: var(--heo-text);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .ch[aria-pressed='true'] {
        border-color: var(--heo-accent);
        background: var(--heo-accent-soft);
        font-weight: 600;
      }
      .where {
        display: grid;
        gap: 4px;
      }
      .opt {
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr);
        gap: 7px;
        padding: 7px 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        color: var(--heo-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .opt[aria-checked='true'] {
        border-color: var(--heo-accent);
        box-shadow: inset 0 0 0 1px var(--heo-accent);
      }
      .opt[aria-disabled='true'] {
        opacity: 0.6;
        cursor: default;
      }
      .opt .r {
        width: 12px;
        height: 12px;
        margin-top: 2px;
        border: 1.5px solid var(--heo-line-strong);
        border-radius: 50%;
      }
      .opt[aria-checked='true'] .r {
        border: 4px solid var(--heo-accent);
      }
      .opt .tt {
        display: block;
        font-size: 12px;
        font-weight: 600;
      }
      .opt .dd {
        display: block;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.4;
      }
      .opt code {
        font-family: var(--heo-mono);
        font-size: 10.5px;
      }
      .used {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .used span {
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
      }
      .foot {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .foot .sp {
        flex: 1;
      }
      .confirm {
        display: grid;
        gap: 8px;
        padding: 9px;
        border: 1px solid color-mix(in oklab, var(--heo-danger) 35%, transparent);
        border-radius: var(--heo-r-sm);
        background: color-mix(in oklab, var(--heo-danger) 5%, var(--heo-raised));
        font-size: 11.5px;
        line-height: 1.45;
      }
      .note.err {
        color: var(--heo-danger);
      }
    `,
  ];

  @property({ type: String }) family = '';
  @property({ type: String }) mode: 'add' | 'edit' = 'add';
  @state() private draft: FontDraft | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('family') || changed.has('mode')) this.#open();
  }

  override firstUpdated(): void {
    this.renderRoot.querySelector<HTMLElement>('[data-first], .x')?.focus();
  }

  #open(): void {
    const engine = maybeEngine();
    const font = catalogueFont(this.family);
    if (!engine || !font) {
      this.draft = null;
      return;
    }
    const existing = engine.fonts.get(font.name);
    this.draft = {
      mode: this.mode,
      family: font.name,
      offer: null,
      styles: existing?.styles ?? [],
      subsets: existing?.subsets ?? ['latin'],
      place: existing?.place ?? (engine.canStoreFiles() ? 'stored' : 'embedded'),
      busy: false,
      error: '',
      confirmRemove: false,
    };
    void engine.fontOffer(font.name).then((offer) => {
      const draft = this.draft;
      if (!draft || draft.family !== font.name) return;
      this.draft = {
        ...draft,
        offer: offer ?? false,
        styles: draft.styles.length ? draft.styles : defaultStyles(offer?.styles ?? []),
        error: offer ? '' : `Google Fonts could not be reached for ${font.name}.`,
      };
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('[data-first]')?.focus());
    });
  }

  #close(): void {
    this.dispatchEvent(new CustomEvent('font-editor-close', { bubbles: true, composed: true }));
  }

  #done(family: string, mode: 'add' | 'edit' | 'remove'): void {
    this.dispatchEvent(new CustomEvent('font-editor-done', { detail: { family, mode }, bubbles: true, composed: true }));
  }

  override render(): TemplateResult | typeof nothing {
    return this.draft ? this.#renderDraft(this.draft) : nothing;
  }

  async #saveDraft(): Promise<void> {
    const draft = this.draft;
    const engine = maybeEngine();
    if (!draft || !engine || draft.busy || !draft.styles.length || !draft.subsets.length) return;
    this.draft = { ...draft, busy: true, error: '' };
    const error = await engine.saveProjectFont({ family: draft.family, styles: draft.styles, subsets: draft.subsets, place: draft.place });
    if (!this.draft || this.draft.family !== draft.family) return;
    if (error) {
      this.draft = { ...this.draft, busy: false, error };
      return;
    }
    this.draft = null;
    this.#done(draft.family, draft.mode);
  }

  #removeDraft(): void {
    const draft = this.draft;
    if (!draft) return;
    maybeEngine()?.removeProjectFont(draft.family);
    this.draft = null;
    this.#done(draft.family, 'remove');
  }

  #toggle(list: readonly string[], one: string): string[] {
    return list.includes(one) ? list.filter((item) => item !== one) : [...list, one];
  }

  #renderDraft(draft: FontDraft): TemplateResult {
    const engine = maybeEngine();
    const font = catalogueFont(draft.family);
    const offer = draft.offer || null;
    const styles = offer?.styles ?? draft.styles;
    const subsets = OFFERED_SUBSETS.filter((one) => (offer?.subsets ?? draft.subsets).includes(one));
    // Not `engine?.storeFilesBlocker() ?? …`: null is its "nothing in the way", and that read as a blocker.
    const blocker = engine ? engine.storeFilesBlocker() : 'No editor.';
    const folder = engine?.fileFolders.font ?? 'assets/fonts';
    const existing = engine?.fonts.get(draft.family);
    const changed = draft.mode === 'add' || !existing ||
      existing.place !== draft.place ||
      [...existing.styles].sort().join() !== [...draft.styles].sort().join() ||
      [...existing.subsets].sort().join() !== [...draft.subsets].sort().join();
    const files = draft.styles.length * draft.subsets.length;
    const users = draft.mode === 'edit' ? (engine?.fontUsers(draft.family) ?? []) : [];
    const face = `font-family:${formatFamilies([draft.family, font ? GENERIC_FOR[font.category] : 'serif'])}`;
    const option = (place: 'stored' | 'embedded', title: string, description: TemplateResult | string, disabled: boolean) => html`<button
      class="opt"
      type="button"
      role="radio"
      data-place=${place}
      aria-checked=${draft.place === place ? 'true' : 'false'}
      aria-disabled=${disabled ? 'true' : 'false'}
      @click=${() => {
        if (!disabled && !draft.busy) this.draft = { ...draft, place };
      }}
    ><span class="r" aria-hidden="true"></span><span><span class="tt">${title}</span><span class="dd">${description}</span></span></button>`;
    return html`<div
      class="fpop"
      role="dialog"
      aria-label=${`${draft.mode === 'add' ? 'Add' : 'Edit'} ${draft.family}`}
      data-font-draft=${draft.family}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        // Claimed: the dialog this sits in closes on Escape too, and this is the inner layer.
        event.stopPropagation();
        event.preventDefault();
        this.#close();
      }}
    >
      <div class="fhead">
        <span class="fam" style=${face}>${draft.family}</span>
        <span class="fsub"><b>${draft.mode === 'add' ? 'Add font' : 'Edit font'}</b> · Google Fonts · ${font?.category ?? ''}</span>
        <button class="x" type="button" aria-label="Close" title="Close" @click=${() => this.#close()}>${icon('close', 11)}</button>
      </div>
      ${draft.offer === null
        ? html`<p class="note">Asking Google Fonts what ${draft.family} comes in…</p>`
        : html`
          <div class="field">
            <div class="lbl">Styles</div>
            <div class="chips" role="group" aria-label="Styles">
              ${styles.map((style, index) => html`<button
                class="ch"
                type="button"
                data-style=${style}
                ?data-first=${index === 0}
                aria-pressed=${draft.styles.includes(style) ? 'true' : 'false'}
                @click=${() => {
                  this.draft = { ...draft, styles: this.#toggle(draft.styles, style) };
                }}
              ><span style=${`${face};${isItalicStyle(style) ? 'font-style:italic;' : ''}${/^\d/.test(style) ? `font-weight:${parseInt(style, 10)};` : ''}`}>${styleLabel(style)}</span></button>`)}
            </div>
          </div>
          <div class="field">
            <div class="lbl">Characters</div>
            <div class="chips" role="group" aria-label="Characters">
              ${subsets.map((subset) => html`<button
                class="ch"
                type="button"
                data-subset=${subset}
                aria-pressed=${draft.subsets.includes(subset) ? 'true' : 'false'}
                @click=${() => {
                  this.draft = { ...draft, subsets: this.#toggle(draft.subsets, subset) };
                }}
              >${SUBSET_LABELS[subset] ?? subset}</button>`)}
            </div>
          </div>`}
      <div class="field">
        <div class="lbl">Where</div>
        <div class="where" role="radiogroup" aria-label="Where its files live">
          ${option('stored', 'Store in a file', blocker
            ? blocker
            : html`In <code>${folder}/</code> beside the page. The design system stays small; the folder travels with the page.`, Boolean(blocker))}
          ${option('embedded', 'Embed', 'Inside the design system as a data URL: one self-contained file, a third heavier.', false)}
        </div>
        <p class="note">Also in Tokens › Fonts, with every font of the page.</p>
      </div>
      ${draft.mode === 'edit'
        ? html`<div class="used">Used by ${users.length ? users.map((one) => html`<span>${one}</span>`) : 'nothing yet'}</div>`
        : nothing}
      ${draft.error ? html`<p class="note err" role="alert">${draft.error}</p>` : nothing}
      ${draft.confirmRemove
        ? html`<div class="confirm" role="alert">
            <span><b>Remove ${draft.family} from the page?</b> ${users.length
              ? `${users.join(' and ')} use it, and will show the next font of their chain.`
              : 'Nothing uses it.'}</span>
            <span class="foot"><span class="sp"></span>
              <button class="btn sm" type="button" @click=${() => {
                this.draft = { ...draft, confirmRemove: false };
              }}>Keep it</button>
              <button class="btn sm danger" type="button" data-font-remove-confirm @click=${() => this.#removeDraft()}>Remove</button>
            </span>
          </div>`
        : html`<div class="foot">
            <span>${files} file${files === 1 ? '' : 's'}</span>
            <span class="sp"></span>
            ${draft.mode === 'edit'
              ? html`<button class="btn sm danger" type="button" data-font-remove @click=${() => {
                  this.draft = { ...draft, confirmRemove: true };
                }}>${icon('trash', 11)} Remove font</button>`
              : nothing}
            <button class="btn sm" type="button" @click=${() => this.#close()}>Cancel</button>
            <button
              class="btn sm primary"
              type="button"
              data-font-save
              ?disabled=${draft.busy || !changed || !draft.styles.length || !draft.subsets.length || draft.offer === null}
              @click=${() => void this.#saveDraft()}
            >${draft.busy ? (draft.mode === 'add' ? 'Adding…' : 'Saving…') : draft.mode === 'add' ? 'Add and use' : 'Save'}</button>
          </div>`}
    </div>`;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'heo-font-editor': HeoFontEditor;
  }
}
