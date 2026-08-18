import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { labelFor, nearestSourceRef } from '../../core/dom.js';
import { describeProps, hasComponentProps, type PropDescriptor } from '../../core/props.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import '../controls/value-field.js';
import '../controls/section.js';

const openSections = new Set<string>(['component', 'attributes']);

const COMMON_TAGS = [
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'span',
  'a',
  'button',
  'ul',
  'ol',
  'li',
  'figure',
  'figcaption',
  'blockquote',
  'label',
];

/**
 * Element properties and attributes.
 *
 * For a custom element this reads the class's declared reactive properties, so a
 * Lit component's props are editable by name and type rather than as raw
 * attributes. For everything else it shows the attributes that actually matter
 * for that tag, plus the accessibility attributes, which is where they belong:
 * next to the element being changed, not in a separate audit step.
 */
@customElement('heo-props-panel')
export class HeoPropsPanel extends HeoElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        padding-bottom: 16px;
      }
      .top {
        display: grid;
        gap: 7px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .id {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .src {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rows {
        display: grid;
        gap: 7px;
      }
      .row {
        display: grid;
        grid-template-columns: 104px 1fr;
        align-items: center;
        gap: 6px;
      }
      .row .name {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .row .name .t {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row.set .name {
        color: var(--heo-text);
      }
      .row .dot {
        width: 5px;
        height: 5px;
        flex: 0 0 auto;
        border-radius: 999px;
        background: var(--heo-accent);
        opacity: 0;
      }
      .row.set .dot {
        opacity: 1;
      }
      .check {
        display: flex;
        align-items: center;
        gap: 7px;
        height: 28px;
        color: var(--heo-text-dim);
        font-size: 11.5px;
        cursor: pointer;
      }
      .check input {
        width: 14px;
        height: 14px;
        accent-color: var(--heo-accent);
        cursor: pointer;
      }
      .two {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.revision] as const,
    shallowArrayEquals,
  );

  @state() private tagDraft = '';
  @state() private version = 0;

  override render(): TemplateResult {
    const el = this.editor.selected;
    if (!el || !el.isConnected) {
      return html`<div class="empty">Select an element to edit its properties.</div>`;
    }

    const described = describeProps(el);
    const source = nearestSourceRef(el);
    const isComponent = hasComponentProps(el);

    return html`
      <div class="top">
        <div class="id">
          <span class="chip">${icon(isComponent ? 'component' : 'cursor', 11)} ${labelFor(el)}</span>
        </div>
        ${source
          ? html`<span class="src" title="Source location from the build-time instrumentation">
              ${source.file}:${source.line}:${source.column}
            </span>`
          : html`<span class="src">
              No source marker — add the Vite plugin for file and line references.
            </span>`}
        ${this.#renderTag(el)}
      </div>

      ${described.reactive.length
        ? html`<heo-section
            heading="Component props"
            glyph="component"
            badge=${String(described.reactive.length)}
            ?open=${openSections.has('component')}
            @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
              this.#remember('component', event.detail.open)}
          >
            <p class="hint" style="margin:0 0 9px">
              Declared by
              <code class="mono">&lt;${el.tagName.toLowerCase()}&gt;</code>. Changes are written as
              attributes, so the component re-renders the way it would in source.
            </p>
            <div class="rows">
              ${repeat(
                described.reactive,
                (prop) => prop.attribute,
                (prop) => this.#renderProp(el, prop),
              )}
            </div>
          </heo-section>`
        : nothing}

      <heo-section
        heading="Attributes"
        glyph="sliders"
        badge=${String(described.attributes.filter((prop) => !prop.unset).length)}
        ?open=${openSections.has('attributes')}
        @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
          this.#remember('attributes', event.detail.open)}
      >
        <div class="rows">
          ${repeat(
            described.attributes,
            (prop) => prop.attribute,
            (prop) => this.#renderProp(el, prop),
          )}
        </div>
      </heo-section>

      <heo-section
        heading="Accessibility"
        glyph="eye"
        badge=${String(described.aria.filter((prop) => !prop.unset).length)}
        ?open=${openSections.has('aria')}
        @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
          this.#remember('aria', event.detail.open)}
      >
        <p class="hint" style="margin:0 0 9px">
          ${accessibilityHint(el)}
        </p>
        <div class="rows">
          ${repeat(described.aria, (prop) => prop.attribute, (prop) => this.#renderProp(el, prop))}
        </div>
      </heo-section>

      ${this.#renderRaw(el)}
    `;
  }

  #renderTag(el: HTMLElement): TemplateResult {
    const current = el.tagName.toLowerCase();
    const isCustom = current.includes('-');
    if (isCustom) return html``;
    return html`<div class="two">
      <input
        class="input mono"
        type="text"
        list="heo-tag-list"
        placeholder=${current}
        .value=${this.tagDraft}
        spellcheck="false"
        aria-label="Tag name"
        @input=${(event: Event) => {
          this.tagDraft = (event.target as HTMLInputElement).value;
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Enter') this.#retag(current);
        }}
      />
      <datalist id="heo-tag-list">
        ${COMMON_TAGS.map((tag) => html`<option value=${tag}></option>`)}
      </datalist>
      <button
        class="btn"
        type="button"
        ?disabled=${!this.tagDraft.trim() || this.tagDraft.trim() === current}
        title="Change the tag, keeping attributes and children"
        @click=${() => this.#retag(current)}
      >
        Change tag
      </button>
    </div>`;
  }

  #retag(current: string): void {
    const next = this.tagDraft.trim().toLowerCase();
    if (!next || next === current) return;
    if (this.editor.retag(next)) this.tagDraft = '';
  }

  #renderProp(el: HTMLElement, prop: PropDescriptor): TemplateResult {
    if (prop.spec.type === 'boolean') {
      const on = el.hasAttribute(prop.attribute);
      return html`<div class=${`row${on ? ' set' : ''}`}>
        <span class="name"><span class="dot"></span><span class="t">${prop.label}</span></span>
        <label class="check">
          <input
            type="checkbox"
            .checked=${on}
            @change=${(event: Event) =>
              this.editor.setAttribute(
                prop.attribute,
                (event.target as HTMLInputElement).checked ? '' : null,
                el,
              )}
          />
          <code class="mono">${prop.attribute}</code>
        </label>
      </div>`;
    }

    if (prop.spec.type === 'select') {
      const options = (prop.spec.options ?? []).map((option) =>
        typeof option === 'object'
          ? { label: option.label ?? option.value, value: option.value }
          : { label: option || '(unset)', value: option },
      );
      return html`<div class=${`row${prop.unset ? '' : ' set'}`}>
        <span class="name"><span class="dot"></span><span class="t">${prop.label}</span></span>
        <select
          class="input"
          .value=${prop.value}
          aria-label=${prop.label}
          @change=${(event: Event) =>
            this.editor.setAttribute(
              prop.attribute,
              (event.target as HTMLSelectElement).value || null,
              el,
            )}
        >
          ${options.map(
            (option) => html`<option value=${option.value} ?selected=${option.value === prop.value}>
              ${option.label}
            </option>`,
          )}
        </select>
      </div>`;
    }

    return html`<div class=${`row${prop.unset ? '' : ' set'}`}>
      <span class="name" title=${prop.attribute}>
        <span class="dot"></span><span class="t">${prop.label}</span>
      </span>
      <heo-value-field
        .value=${prop.value}
        .kind=${prop.spec.type === 'number' ? 'number' : 'text'}
        .suggestions=${[]}
        placeholder=${prop.unset ? prop.attribute : ''}
        clearable
        @value-change=${(event: CustomEvent<{ value: string }>) =>
          this.editor.setAttribute(prop.attribute, event.detail.value || null, el)}
      ></heo-value-field>
    </div>`;
  }

  /** Everything else already on the element, so nothing is hidden from view. */
  #renderRaw(el: HTMLElement): TemplateResult {
    const known = new Set(
      [
        ...describeProps(el).reactive,
        ...describeProps(el).attributes,
        ...describeProps(el).aria,
      ].map((prop) => prop.attribute),
    );
    const extra = Array.from(el.attributes).filter(
      (attr) =>
        !known.has(attr.name) &&
        attr.name !== 'class' &&
        attr.name !== 'style' &&
        !attr.name.startsWith('data-heo-'),
    );
    if (!extra.length) return html``;

    return html`<heo-section
      heading="Other attributes"
      glyph="code"
      badge=${String(extra.length)}
      ?open=${openSections.has('other')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('other', event.detail.open)}
    >
      <div class="rows">
        ${repeat(
          extra,
          (attr) => attr.name,
          (attr) => html`<div class="row set">
            <span class="name" title=${attr.name}>
              <span class="dot"></span><span class="t mono">${attr.name}</span>
            </span>
            <heo-value-field
              .value=${attr.value}
              .suggestions=${[]}
              clearable
              @value-change=${(event: CustomEvent<{ value: string }>) =>
                this.editor.setAttribute(attr.name, event.detail.value || null, el)}
            ></heo-value-field>
          </div>`,
        )}
      </div>
    </heo-section>`;
  }

  #remember(id: string, open: boolean): void {
    if (open) openSections.add(id);
    else openSections.delete(id);
    this.version += 1;
  }
}

/** A short, specific note rather than generic advice. */
function accessibilityHint(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') {
    return el.hasAttribute('alt')
      ? 'This image has alt text. Leave it empty only when the image is purely decorative.'
      : 'This image has no alt attribute. Add one, or set it to an empty string if decorative.';
  }
  if (tag === 'button' || tag === 'a') {
    const text = el.textContent?.trim();
    return text
      ? 'This control has a visible label, so an aria-label is usually unnecessary.'
      : 'This control has no visible text, so it needs an aria-label.';
  }
  if (tag.includes('-')) {
    return 'Custom elements inherit no semantics. A role and an accessible name are usually needed.';
  }
  return 'Only set a role when the element does not already convey the right semantics.';
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-props-panel': HeoPropsPanel;
  }
}
