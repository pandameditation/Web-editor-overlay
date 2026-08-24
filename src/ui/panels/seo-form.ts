import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  HEAD_FIELDS,
  hostOf,
  lengthState,
  readHead,
  resolvePreviews,
  setHeadField,
  type HeadField,
  type HeadGroup,
  type HeadValues,
  type SocialPreview,
} from '../../core/head.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import '../controls/section.js';

/**
 * The document head, as a form with the previews its values are for.
 *
 * Editing a head as markup asks the author to hold three notations and half a dozen
 * fallback chains in their head at once, and gives no feedback until a link is shared
 * somewhere public. The form removes the notations; the previews remove the delay.
 *
 * Every card is rendered from resolved values rather than raw ones, because that is
 * the difference between "og:title is empty" and "this will show the page title" —
 * and it is why a page can look complete on one platform and bare on another.
 */
const GROUPS: Array<{ id: HeadGroup; label: string; glyph: string; note: string }> = [
  {
    id: 'basics',
    label: 'Page',
    glyph: 'code',
    note: 'What search engines read, and what the browser tab shows.',
  },
  {
    id: 'open-graph',
    label: 'Open Graph',
    glyph: 'image',
    note: 'Used by Facebook, LinkedIn, Slack, iMessage and most other unfurlers.',
  },
  {
    id: 'twitter',
    label: 'X / Twitter',
    glyph: 'sparkle',
    note: 'Only needed where it should differ from Open Graph.',
  },
];

@customElement('heo-seo-form')
export class HeoSeoForm extends HeoElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .lede {
        margin: 0 0 10px;
        color: var(--heo-text-faint);
        font-size: 11px;
        line-height: 1.55;
      }

      /* ---- Previews ---- */

      .cards {
        display: grid;
        gap: 9px;
        margin-bottom: 11px;
      }
      @container (min-width: 620px) {
        .cards {
          grid-template-columns: 1fr 1fr;
        }
      }
      .card {
        display: grid;
        gap: 7px;
        padding: 10px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-raised);
      }
      .card > .who {
        display: flex;
        align-items: center;
        gap: 5px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      /* A search result. Deliberately close to the real thing: the point is to judge
         the copy at the width and order it will be read in. */
      .serp .url {
        color: var(--heo-text-dim);
        font-size: 10.5px;
      }
      .serp .headline {
        color: #8ab4f8;
        font-size: 14px;
        line-height: 1.3;
      }
      :host([data-theme='light']) .serp .headline {
        color: #1a0dab;
      }
      .serp .snippet {
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.5;
      }

      /* An unfurled link. */
      .unfurl {
        display: grid;
        gap: 0;
        overflow: hidden;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
      }
      .unfurl .shot {
        display: grid;
        place-items: center;
        aspect-ratio: 1200 / 630;
        background: var(--heo-sunken);
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .unfurl .shot img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .unfurl.small {
        grid-template-columns: 88px 1fr;
      }
      .unfurl.small .shot {
        aspect-ratio: 1;
      }
      .unfurl .copy {
        display: grid;
        gap: 3px;
        padding: 8px 9px;
        background: var(--heo-sunken);
        min-width: 0;
      }
      .unfurl .site {
        color: var(--heo-text-faint);
        font-size: 9.5px;
        text-transform: lowercase;
      }
      .unfurl .t {
        color: var(--heo-text);
        font-size: 11.5px;
        font-weight: 600;
        line-height: 1.35;
      }
      .unfurl .d {
        color: var(--heo-text-dim);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .clamp2 {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }
      .missing {
        color: var(--heo-text-faint);
        font-style: italic;
      }

      /* ---- Fields ---- */

      .field {
        display: grid;
        gap: 4px;
        margin-bottom: 9px;
      }
      .field:last-child {
        margin-bottom: 0;
      }
      .head {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .head .label {
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .head .tag {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* The length budget. A count is only useful next to the number that matters. */
      .head .count {
        flex: 0 0 auto;
        font-family: var(--heo-mono);
        font-size: 9.5px;
        font-variant-numeric: tabular-nums;
      }
      .head .count[data-state='good'] {
        color: var(--heo-success);
      }
      .head .count[data-state='long'] {
        color: var(--heo-warn);
      }
      .head .count[data-state='empty'] {
        color: var(--heo-text-faint);
      }
      .head .flag {
        flex: 0 0 auto;
        color: var(--heo-warn);
      }
      textarea.input {
        min-height: 52px;
        resize: vertical;
        line-height: 1.5;
      }
      .swatchrow {
        display: grid;
        grid-template-columns: 1fr 28px;
        gap: 5px;
      }
      .swatchrow input[type='color'] {
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: none;
        cursor: pointer;
      }
      .hint {
        margin: 0;
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.45;
      }
      .note {
        margin: 0 0 8px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.revision, s.changeCount, s.theme] as const,
    shallowArrayEquals,
  );

  /**
   * Buffers for the field being typed in.
   *
   * Committing every keystroke to history would make undo per-character and rewrite
   * the head sixty times a sentence. The draft is committed when the field is left or
   * Enter is pressed, which is also when the previews settle.
   */
  @state() private drafts: Partial<Record<string, string>> = {};

  override render(): TemplateResult {
    const values = readHead();
    const shown = { ...values, ...this.drafts } as HeadValues;
    const previews = resolvePreviews(shown);
    this.dataset.theme = this.state.value.theme;
    return html`
      <p class="lede">
        The tags in <code class="mono">&lt;head&gt;</code>, and what they will look like where they
        are read. Nothing here is on the page itself.
      </p>
      <div class="cards">
        ${this.#renderSerp(previews.google)}
        ${this.#renderUnfurl('Facebook · LinkedIn · Slack', previews.facebook)}
        ${this.#renderUnfurl('X / Twitter', previews.twitter)}
      </div>
      ${GROUPS.map(
      (group) => html`<heo-section
          heading=${group.label}
          glyph=${group.glyph}
          badge=${String(
        HEAD_FIELDS.filter((field) => field.group === group.id && shown[field.id]).length,
      )}
          ?open=${group.id === 'basics'}
        >
          <p class="note">${group.note}</p>
          ${HEAD_FIELDS.filter((field) => field.group === group.id).map((field) =>
        this.#renderField(field, shown[field.id]),
      )}
        </heo-section>`,
    )}
    `;
  }

  #renderSerp(preview: SocialPreview): TemplateResult {
    return html`<div class="card serp">
      <span class="who">${icon('search', 10)} Search result</span>
      <span class="url">${hostOf(preview.url)} › ${pathOf(preview.url)}</span>
      <span class="headline clamp2">
        ${preview.title || html`<span class="missing">Untitled page</span>`}
      </span>
      <span class="snippet clamp2">
        ${preview.description ||
      html`<span class="missing"
            >No description — the engine will quote whatever text it finds.</span
          >`}
      </span>
    </div>`;
  }

  #renderUnfurl(who: string, preview: SocialPreview): TemplateResult {
    return html`<div class="card">
      <span class="who">${icon('image', 10)} ${who}</span>
      <div class=${`unfurl${preview.large ? '' : ' small'}`}>
        <div class="shot">
          ${preview.image
        ? html`<img src=${preview.image} alt="" loading="lazy" />`
        : html`no image`}
        </div>
        <div class="copy">
          <span class="site">${preview.siteName}</span>
          <span class="t clamp2">
            ${preview.title || html`<span class="missing">Untitled</span>`}
          </span>
          <span class="d clamp2">
            ${preview.description || html`<span class="missing">No description</span>`}
          </span>
        </div>
      </div>
    </div>`;
  }

  #renderField(field: HeadField, value: string): TemplateResult {
    const state = lengthState(value, field.limit);
    const missing = field.important && !value.trim();
    return html`<div class="field">
      <div class="head">
        <span class="label">${field.label}</span>
        <code class="tag" title=${field.tag}>${field.tag}</code>
        ${missing
        ? html`<span class="flag" title="Worth filling in on any page"
              >${icon('close', 10)}</span
            >`
        : nothing}
        ${field.limit
        ? html`<span class="count" data-state=${state}>
              ${value.trim().length}/${field.limit}
            </span>`
        : nothing}
      </div>
      ${this.#renderControl(field, value)}
      ${field.hint ? html`<p class="hint">${field.hint}</p>` : nothing}
    </div>`;
  }

  #renderControl(field: HeadField, value: string): TemplateResult {
    const commit = (next: string): void => this.#commit(field, next);
    const onInput = (event: Event): void => {
      this.drafts = {
        ...this.drafts,
        [field.id]: (event.target as HTMLInputElement | HTMLTextAreaElement).value,
      };
    };

    if (field.kind === 'select') {
      return html`<select
        class="input"
        aria-label=${field.label}
        @change=${(event: Event) => commit((event.target as HTMLSelectElement).value)}
      >
        ${(field.options ?? []).map(
        (option) => html`<option value=${option} ?selected=${option === value}>
            ${option || '(default)'}
          </option>`,
      )}
      </select>`;
    }

    if (field.kind === 'multiline') {
      return html`<textarea
        class="input"
        rows="3"
        spellcheck="true"
        aria-label=${field.label}
        .value=${value}
        @input=${onInput}
        @blur=${(event: Event) => commit((event.target as HTMLTextAreaElement).value)}
      ></textarea>`;
    }

    if (field.kind === 'color') {
      return html`<div class="swatchrow">
        <input
          class="input mono"
          type="text"
          placeholder="#0b1220"
          aria-label=${field.label}
          .value=${value}
          @input=${onInput}
          @blur=${(event: Event) => commit((event.target as HTMLInputElement).value)}
          @keydown=${(event: KeyboardEvent) => this.#onKeyDown(event, field)}
        />
        <input
          type="color"
          aria-label=${`${field.label} picker`}
          .value=${/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          @change=${(event: Event) => commit((event.target as HTMLInputElement).value)}
        />
      </div>`;
    }

    return html`<input
      class=${field.kind === 'url' ? 'input mono' : 'input'}
      type="text"
      inputmode=${field.kind === 'url' ? 'url' : 'text'}
      spellcheck=${field.kind === 'url' ? 'false' : 'true'}
      placeholder=${field.kind === 'url' ? 'https://…' : ''}
      aria-label=${field.label}
      .value=${value}
      @input=${onInput}
      @blur=${(event: Event) => commit((event.target as HTMLInputElement).value)}
      @keydown=${(event: KeyboardEvent) => this.#onKeyDown(event, field)}
    />`;
  }

  #onKeyDown(event: KeyboardEvent, field: HeadField): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.#commit(field, (event.target as HTMLInputElement).value);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      const { [field.id]: _dropped, ...rest } = this.drafts;
      this.drafts = rest;
    }
  }

  #commit(field: HeadField, next: string): void {
    const { [field.id]: _dropped, ...rest } = this.drafts;
    this.drafts = rest;
    const command = setHeadField(field.id, next);
    if (!command) return;
    this.editor.history.commit(command);
    this.editor.notify(command.record.summary, 'success', {
      label: 'Undo',
      run: () => this.editor.undo(),
    });
  }
}

function pathOf(url: string): string {
  try {
    const path = new URL(url, location.href).pathname;
    return path === '/' ? '' : path.replace(/^\//, '').split('/').join(' › ');
  } catch {
    return '';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-seo-form': HeoSeoForm;
  }
}
