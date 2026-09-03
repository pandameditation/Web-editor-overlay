import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  ATTRIBUTE_GROUP_LABELS,
  attributeHint,
  attributeMeta,
  attributeRefusal,
  isDataAttribute,
  isValidAttributeName,
  searchAttributes,
} from '../../core/attributes.js';
import { labelFor, nearestSourceRef } from '../../core/dom.js';
import type { BlockInstance } from '../../core/editor.js';
import { describeProps, hasComponentProps, type PropDescriptor } from '../../core/props.js';
import { listen, unlisten } from '../../core/shield.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { PropSpec } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { adderStyles } from './adder.js';
import { PropForm } from './prop-form.js';
import '../controls/value-field.js';
import '../controls/search-field.js';
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
    PropForm.styles,
    adderStyles,
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
      /* Chip and search box share the line, as they do in Styles. The chip keeps its width and
         the field takes the rest, so a long selector cannot squeeze the search out of reach. */
      .id {
        display: flex;
        align-items: center;
        gap: 6px;
        /* A grid item's automatic minimum is its content, so without this the search field's own
           minimum pushes the row wider than the panel and the add button falls off the edge. */
        min-width: 0;
      }
      .id > .chip {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
      }
      .id > heo-search-field {
        flex: 1 1 auto;
        min-width: 0;
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

      /* Provenance line above each group in the Component section, so it is never
         ambiguous whether a field came from the block that was inserted or from the
         custom element's own class. */
      .sub {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 5px;
      }
      .sub .g {
        flex: 0 0 auto;
        color: var(--heo-accent);
      }
      .sub .who {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        color: var(--heo-text-dim);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sub .who b {
        color: var(--heo-text);
        font-weight: 550;
      }
      /* Never squeezed: the block's name can ellipsise, the way back cannot. */
      .sub .sync {
        flex: 0 0 auto;
        gap: 4px;
        padding: 2px 7px;
        font-size: 10.5px;
      }
      /* Says "already matched" rather than "unavailable", so it reads as a state and not
         as something switched off. */
      .sub .sync:disabled {
        opacity: 1;
        border-color: transparent;
        background: transparent;
        color: var(--heo-text-faint);
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
  /** What the panel is being filtered by. Empty shows every section. */
  @state() private filter = '';
  /** Whether the add-attributes popup is up. */
  @state() private adderOpen = false;
  /** Where it is placed, measured against the field that opened it. */
  @state() private adderStyle = '';
  /**
   * The attributes being written, one row each.
   *
   * A list rather than a single pair, for the reason the styles adder is: the useful unit is
   * rarely one attribute. Making a div into a tab means `role`, `aria-selected` and `tabindex`
   * together, and three trips through a one-shot form is three undo entries for one decision.
   */
  @state() private draftRows: Array<{ name: string; value: string }> = [];

  override render(): TemplateResult {
    const el = this.editor.selected;
    if (!el || !el.isConnected) {
      return html`<div class="empty">Select an element to edit its properties.</div>`;
    }

    const described = describeProps(el);
    const source = nearestSourceRef(el);
    const isComponent = hasComponentProps(el);
    const filtering = Boolean(this.filter.trim());

    const attributes = described.attributes.filter((prop) => this.#matches(prop));
    const aria = described.aria.filter((prop) => this.#matches(prop));
    const extra = this.#extraAttributes(el).filter(
      (attr) => this.#hit(attr.name, attr.value),
    );
    const found = filtering
      ? attributes.length +
      aria.length +
      extra.length +
      described.reactive.filter((prop) => this.#matches(prop)).length
      : -1;

    return html`
      <div class="top">
        <div class="id">
          <span class="chip">${icon(isComponent ? 'component' : 'cursor', 11)} ${labelFor(el)}</span>
          <!--
            The same field, in the same place, as the one in Styles.

            An element can carry any attribute at all, and until now the panel could only edit the
            ones already on it — every other name was reachable only by hand-editing the markup in
            the Code panel. So this box does both jobs: it narrows what is on screen, and its
            action adds what is not there yet.
          -->
          <heo-search-field
            label="Search in element"
            placeholder="Search in element…"
            .value=${this.filter}
            .count=${found}
            action=${this.#addLabel()}
            action-icon="plus"
            action-compact
            @search-input=${(event: CustomEvent<{ value: string }>) => {
        this.filter = event.detail.value;
      }}
            @search-submit=${() => this.#openAdder(this.filter.trim())}
          ></heo-search-field>
        </div>
        ${filtering
        ? nothing
        : source
          ? html`<span class="src" title="Source location from the build-time instrumentation">
                ${source.file}:${source.line}:${source.column}
              </span>`
          : html`<span class="src">
                No source marker — add the Vite plugin for file and line references.
              </span>`}
        ${filtering ? nothing : this.#renderTag(el)}
      </div>

      ${this.#renderComponent(el, described.reactive)}
      ${this.#renderGroup(el, 'attributes', 'Attributes', 'sliders', attributes)}
      ${this.#renderGroup(el, 'aria', 'Accessibility', 'eye', aria, accessibilityHint(el))}
      ${this.#renderRaw(el, extra)}
      <!-- Withheld while the popup is up: the user has acted on these completions, and leaving
           them behind the popup restates a question that has been answered. -->
      ${found === 0 && !this.adderOpen ? this.#renderNoMatch(el) : nothing}
      ${this.adderOpen ? this.#renderAddPopup(el) : nothing}
    `;
  }

  /**
   * One section of attribute rows.
   *
   * Attributes and Accessibility were two near-identical blocks of markup that had to be edited in
   * lockstep; folding them into one method is what let the filter apply to both without saying it
   * twice. While filtering the section is forced open and disappears when nothing in it matches,
   * because a column of empty headings is not a search result.
   */
  #renderGroup(
    el: HTMLElement,
    id: string,
    heading: string,
    glyph: string,
    props: PropDescriptor[],
    hint?: string,
  ): TemplateResult | typeof nothing {
    const filtering = Boolean(this.filter.trim());
    if (filtering && !props.length) return nothing;

    return html`<heo-section
      heading=${heading}
      glyph=${glyph}
      badge=${String(props.filter((prop) => !prop.unset).length)}
      ?open=${filtering ? true : openSections.has(id)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember(id, event.detail.open)}
    >
      ${hint && !filtering ? html`<p class="hint" style="margin:0 0 9px">${hint}</p>` : nothing}
      <div class="rows">
        ${repeat(props, (prop) => prop.attribute, (prop) => this.#renderProp(el, prop))}
      </div>
    </heo-section>`;
  }

  /**
   * The COMPONENT section: what this element is, as opposed to what it has.
   *
   * Two sources of truth can apply, and both belong here. A block inserted from the
   * library was configured with prop values, and those values are the vocabulary the
   * user chose it with — "bullet: ✅" means far more than the resulting markup. A
   * custom element additionally declares reactive properties on its class. When both
   * exist, the block form comes first, because that is the level the user was
   * working at.
   *
   * Present for every block instance, including one with no props at all. It used to appear
   * only when there was a form to put in it, which quietly made "which component is this?" a
   * question the editor could answer and refused to — and left the block's own identity
   * invisible for exactly the blocks that have nothing else to show.
   */
  #renderComponent(el: HTMLElement, allReactive: PropDescriptor[]): TemplateResult | typeof nothing {
    const instance = this.editor.blockInstance(el);
    if (!instance && !allReactive.length) return html``;

    const filtering = Boolean(this.filter.trim());
    const reactive = filtering
      ? allReactive.filter((prop) => this.#matches(prop))
      : allReactive;
    // While filtering, the block form is not a row the query can be about — it is a form keyed by
    // the block's own prop names, which are matched through the reactive descriptors instead.
    if (filtering && !reactive.length) return nothing;

    const specs = instance?.block.props ?? {};
    const count = Object.keys(specs).length + reactive.length;

    return html`<heo-section
      heading="Component"
      glyph="component"
      badge=${String(count)}
      ?open=${filtering ? true : openSections.has('component')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('component', event.detail.open)}
    >
      ${instance && !filtering ? this.#renderInstance(el, instance, specs) : nothing}
      ${reactive.length
        ? html`
            ${instance && !filtering
          ? html`<div class="divider" style="margin:12px 0 10px"></div>`
          : nothing}
            <div class="sub">
              <span class="g">${icon('component', 11)}</span>
              <span class="who">
                Declared by <code class="mono">&lt;${el.tagName.toLowerCase()}&gt;</code>
              </span>
            </div>
            <p class="hint" style="margin:0 0 9px">
              Written as attributes, so the component re-renders the way it would in source.
            </p>
            <div class="rows">
              ${repeat(
          reactive,
          (prop) => prop.attribute,
          (prop) => this.#renderProp(el, prop),
        )}
            </div>
          `
        : nothing}
    </heo-section>`;
  }

  /**
   * Which block this element is, whether it still matches it, and the way back.
   *
   * The sync control is always here, drift or none, props or none. A control that appears only
   * when it would do something is a control you cannot learn: you find it once, by accident,
   * at the moment you needed it earlier. So it is always in the same place, and it says which
   * of its two states it is in — which is also the answer to "did my library edit reach this?"
   * without pressing anything.
   *
   * Drift is read live rather than remembered. It is one markup comparison for one element and
   * the panel already re-renders on every revision, so a stale answer would cost more than the
   * check does.
   */
  #renderInstance(
    el: HTMLElement,
    instance: BlockInstance,
    specs: Record<string, PropSpec>,
  ): TemplateResult {
    const drifted = this.editor.blockDrift(el);
    const isElement = Boolean(instance.block.element?.tag);

    return html`<div class="block">
      <div class="sub">
        <span class="g">${icon('blocks', 11)}</span>
        <span class="who">
          ${instance.placed ? 'Inserted as' : 'Saved as'} <b>${instance.block.name}</b>
        </span>
        <button
          class=${`btn sm sync${drifted ? ' primary' : ''}`}
          type="button"
          ?disabled=${!drifted}
          title=${drifted
        ? `Update this element's markup from ${instance.block.name} as the library now holds it, keeping the text written here.`
        : `Nothing to bring across: this already matches ${instance.block.name}.`}
          @click=${() => void this.editor.syncBlockInstance(el)}
        >
          ${icon('refresh', 11)} ${drifted ? 'Update' : 'In sync'}
        </button>
      </div>
      <p class="hint" style="margin:0 0 9px">
        ${drifted
        ? html`The block has changed in the library. Updating brings its markup across and
            keeps the text written here.`
        : isElement
          ? 'Values are written as attributes, so the component re-renders itself.'
          : 'Changing a value re-renders the block from its template, replacing this element.'}
      </p>
      ${PropForm.render(specs, instance.values, (name, value) => {
            void this.editor.setBlockProp(el, name, value);
          }, this.editor)}
    </div>`;
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
        .suggestions=${valueSuggestions(prop.attribute)}
        placeholder=${prop.unset ? prop.attribute : ''}
        clearable
        @value-change=${(event: CustomEvent<{ value: string }>) =>
        this.#write(el, prop.attribute, event.detail.value)}
      ></heo-value-field>
    </div>`;
  }

  /**
   * Attributes on the element that no descriptor covers.
   *
   * Split out from the section that draws them so the filter and the count can read the same list.
   * `class` and `style` are left out because they have panels of their own, and `data-heo-*` is the
   * editor's own bookkeeping — showing it would invite someone to edit the overlay's state.
   */
  #extraAttributes(el: HTMLElement): Attr[] {
    const described = describeProps(el);
    const known = new Set(
      [...described.reactive, ...described.attributes, ...described.aria].map(
        (prop) => prop.attribute,
      ),
    );
    return Array.from(el.attributes).filter(
      (attr) =>
        !known.has(attr.name) &&
        attr.name !== 'class' &&
        attr.name !== 'style' &&
        !attr.name.startsWith('data-heo-'),
    );
  }

  /** Everything else already on the element, so nothing is hidden from view. */
  #renderRaw(el: HTMLElement, extra: Attr[]): TemplateResult | typeof nothing {
    if (!extra.length) return nothing;
    const filtering = Boolean(this.filter.trim());

    return html`<heo-section
      heading="Other attributes"
      glyph="code"
      badge=${String(extra.length)}
      ?open=${filtering ? true : openSections.has('other')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('other', event.detail.open)}
    >
      <div class="rows">
        ${repeat(
          extra,
          (attr) => attr.name,
          (attr) => html`<div class="row set">
            <span class="name" title=${`${attr.name} — ${attributeHint(attr.name) || 'not a standard attribute'}`}>
              <span class="dot"></span><span class="t mono">${attr.name}</span>
            </span>
            <heo-value-field
              .value=${attr.value}
              .suggestions=${valueSuggestions(attr.name)}
              clearable
              @value-change=${(event: CustomEvent<{ value: string }>) =>
              this.#write(el, attr.name, event.detail.value)}
            ></heo-value-field>
          </div>`,
        )}
      </div>
    </heo-section>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Finding an attribute, and adding one                                   */
  /* ---------------------------------------------------------------------- */

  /** Whether any of these strings contains what is being searched for. */
  #hit(...texts: Array<string | undefined>): boolean {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) return true;
    return texts.some((text) => text?.toLowerCase().includes(needle));
  }

  /**
   * Whether a row survives the filter.
   *
   * Three things are searchable per row, because three are how people refer to an attribute: the
   * attribute name, the friendly label the panel shows instead of it, and the value. Searching
   * "alt" and "Alt text" have to find the same row, and so does searching what is written in it.
   */
  #matches(prop: PropDescriptor): boolean {
    return this.#hit(prop.attribute, prop.label, prop.unset ? undefined : prop.value);
  }

  /** What the add action would do, named after what has been typed. */
  #addLabel(): string {
    const seed = this.filter.trim();
    return seed ? `Add ${seed}` : 'Add an attribute';
  }

  /**
   * The one write path, so every guard is unavoidable.
   *
   * `editor.setAttribute` validates nothing — it never had to, because until now the only names
   * reaching it came from a hardcoded table. Arbitrary names are the whole point of this feature,
   * so the screening has to live somewhere, and somewhere is here rather than in each of the four
   * call sites that might forget it.
   */
  #write(el: HTMLElement, name: string, value: string): boolean {
    const refusal = attributeRefusal(name, value, el.tagName);
    if (refusal) {
      this.editor.notify(refusal, 'error');
      return false;
    }
    this.editor.setAttribute(name, value || null, el);
    return true;
  }

  /**
   * What to show once the panel below has run out of rows.
   *
   * The same idea as the Styles panel's, with one difference that matters: CSS can be asked whether
   * a property exists, and HTML cannot. Any syntactically legal name is a legal attribute, so the
   * verdict here has three outcomes rather than two — known to the catalogue, legal but not
   * standard, or not a legal name at all. Saying "invalid" for the middle case would be false, and
   * that case is the one `data-*` exists for.
   */
  #renderNoMatch(el: HTMLElement): TemplateResult {
    const seed = this.filter.trim();
    const tag = el.tagName.toLowerCase();
    const near = searchAttributes(seed, tag, 12).filter((meta) => meta.name !== seed);
    const known = Boolean(attributeMeta(seed));
    const custom = isDataAttribute(seed);
    const legal = isValidAttributeName(seed);
    const refusal = seed ? attributeRefusal(seed, '', el.tagName) : null;

    return html`<div class="nomatch">
      <p class="lede">
        Nothing on <b>${labelFor(el)}</b> matches “${seed}”.
      </p>

      ${refusal && !legal
        ? html`<p class="verdict stop">
            ${icon('alert', 11)}<span>${refusal}</span>
          </p>`
        : refusal
          ? html`<p class="verdict stop">${icon('lock', 11)}<span>${refusal}</span></p>`
          : known
            ? html`<p class="verdict yes">
                ${icon('check', 11)}
                <span>
                  <code class="mono">${seed}</code> is an HTML attribute. It is just not set here.
                </span>
              </p>`
            : custom
              ? html`<p class="verdict yes">
                  ${icon('check', 11)}
                  <span>
                    <code class="mono">${seed}</code> is a custom data attribute, which may be
                    named anything.
                  </span>
                </p>`
              : html`<p class="verdict no">
                  ${icon('alert', 11)}
                  <span>
                    <code class="mono">${seed}</code> is not a standard attribute. It can still be
                    written as-is, though
                    <code class="mono">data-${seed}</code> is the name HTML reserves for your own.
                  </span>
                </p>`}

      ${near.length && !refusal
        ? html`<div class="offer" role="list">
            ${near.map(
          (meta) => html`<button
                class="option"
                type="button"
                role="listitem"
                title=${`Add ${meta.name} to this ${tag}`}
                @click=${() => this.#openAdder(meta.name)}
              >
                <span class="name">${meta.name}</span>
                <span class="meta">
                  ${meta.tags && !meta.tags.includes(tag)
              ? `${ATTRIBUTE_GROUP_LABELS[meta.group]} · <${meta.tags[0]}>`
              : ATTRIBUTE_GROUP_LABELS[meta.group]}
                </span>
              </button>`,
        )}
          </div>`
        : nothing}

      <!--
        Offered for any legal name the editor is willing to write, standard or not: HTML has no
        equivalent of CSS.supports, so "not in the catalogue" is not evidence of a mistake. What is
        withheld is a name the editor refuses outright, where inviting the user in would only lead
        to the same refusal from the popup.
      -->
      ${legal && !refusal
        ? html`<button class="btn sm primary" type="button" @click=${() => this.#openAdder(seed)}>
            ${icon('plus', 12)} ${this.#addLabel()}
          </button>`
        : nothing}
    </div>`;
  }

  /**
   * Open the popup, seeded with whatever was being looked for.
   *
   * Searching for an attribute and not finding it is the most common way somebody arrives at
   * wanting to add one, so the query carries over rather than being typed a second time.
   */
  #openAdder(seed = ''): void {
    this.draftRows = [{ name: seed, value: '' }];
    // Measured before it opens: the anchor is on screen, the popup is not, so there is nothing to
    // wait for — and placing it afterwards paints one frame at the element's static position.
    this.#positionAdder();
    this.adderOpen = true;
    void this.updateComplete.then(() => {
      // Re-measured now it exists, since its height decides whether it flips above the field.
      this.#positionAdder();
      const popup = this.renderRoot.querySelector<HTMLElement>('.addpop');
      if (popup && typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
        try {
          popup.showPopover();
        } catch {
          /* already open, or popovers are unsupported: it still renders in place */
        }
      }
      this.renderRoot.querySelector<HTMLElement>('.poprow heo-value-field input')?.focus();
    });
  }

  #closeAdder(): void {
    this.adderOpen = false;
    this.draftRows = [];
  }

  /*
   * Dismissed by a press anywhere else, through `listen`.
   *
   * `listen` and not `addEventListener`: the event shield suppresses `pointerdown` for the page, so
   * a plain listener never hears the press that should close this.
   */
  #onOutsidePress = (event: Event): void => {
    if (!this.adderOpen) return;
    const path = event.composedPath();
    if (
      path.some((node) => node instanceof HTMLElement && node.classList?.contains('addpop'))
    ) {
      return;
    }
    if (path.includes(this.renderRoot.querySelector('.top') as EventTarget)) return;
    this.#closeAdder();
  };

  /* A fixed popup is placed once against a rect that scrolling, dragging or resizing invalidates. */
  #onViewportChange = (): void => {
    if (this.adderOpen) this.#positionAdder();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    listen(document, 'pointerdown', this.#onOutsidePress, true);
    listen(window, 'scroll', this.#onViewportChange, true);
    listen(window, 'resize', this.#onViewportChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(document, 'pointerdown', this.#onOutsidePress, true);
    unlisten(window, 'scroll', this.#onViewportChange, true);
    unlisten(window, 'resize', this.#onViewportChange);
  }

  /** Placed against the field that opened it, in the top layer, flipping up when short of room. */
  #positionAdder(): void {
    const field =
      this.renderRoot.querySelector('.id heo-search-field') ?? this.renderRoot.querySelector('.top');
    const anchor = field?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(Math.max(anchor.width, 320), Math.max(320, innerWidth - 16));
    // Absent on the first pass, which is what the estimate is for: the popup does not exist yet.
    const height = this.renderRoot.querySelector('.addpop')?.getBoundingClientRect().height || 240;
    const spaceBelow = innerHeight - anchor.bottom;
    const above = spaceBelow < height + 12 && anchor.top > spaceBelow;
    const top = above ? Math.max(8, anchor.top - height - 6) : anchor.bottom + 6;
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, innerWidth - width - 8));
    this.adderStyle = `top:${Math.round(top)}px;left:${Math.round(left)}px;width:${Math.round(width)}px`;
  }

  /** The popup: a name and its value side by side, as many times as needed. */
  #renderAddPopup(el: HTMLElement): TemplateResult {
    // A value is not required. `hidden`, `disabled` and `required` are present-or-absent, so
    // demanding one would make the popup unable to add the simplest attributes there are.
    const ready = this.draftRows.filter((row) => row.name.trim()).length;

    return html`<div
      class="addpop"
      popover="manual"
      style=${this.adderStyle}
      role="dialog"
      aria-label="Add attributes"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        // Not allowed to bubble: the global keymap reads Escape as "deselect", and closing a
        // popup is not a request to change what is selected.
        event.stopPropagation();
        this.#closeAdder();
      }}
    >
      <div class="pophead">
        <span>Add attributes to <code class="mono">${labelFor(el)}</code></span>
        <button
          class="btn icon ghost sm"
          type="button"
          aria-label="Close"
          @click=${() => this.#closeAdder()}
        >
          ${icon('close', 11)}
        </button>
      </div>

      <div class="poprows">
        ${this.draftRows.map((row, index) => this.#renderDraftRow(el, row, index))}
      </div>

      <div class="popfoot">
        <button
          class="btn sm"
          type="button"
          title="Add another attribute to this batch"
          @click=${() => {
        this.draftRows = [...this.draftRows, { name: '', value: '' }];
      }}
        >
          ${icon('plus', 12)} Another
        </button>
        <span class="spacer"></span>
        <button
          class="btn sm primary"
          type="button"
          ?disabled=${ready === 0}
          @click=${() => this.#commitRows(el)}
        >
          ${icon('check', 12)}
          ${ready > 1 ? `Add ${ready} attributes` : 'Add attribute'}
        </button>
      </div>
    </div>`;
  }

  #renderDraftRow(
    el: HTMLElement,
    row: { name: string; value: string },
    index: number,
  ): TemplateResult {
    const tag = el.tagName.toLowerCase();
    const matches = searchAttributes(row.name, tag, 14).map((meta) => ({
      value: meta.name,
      hint: ATTRIBUTE_GROUP_LABELS[meta.group],
      // Drawn as present-but-elsewhere rather than hidden: the spec says `srcset` is for an image,
      // and the editor is not the place to argue with somebody who wants it on a div.
      dead: Boolean(meta.tags && !meta.tags.includes(tag)),
    }));
    const update = (next: Partial<{ name: string; value: string }>): void => {
      this.draftRows = this.draftRows.map((entry, at) =>
        at === index ? { ...entry, ...next } : entry,
      );
    };
    const meta = attributeMeta(row.name);

    return html`<div class="poprow">
      <heo-search-field
        mode="suggest"
        label="Attribute name"
        placeholder="attribute"
        .value=${row.name}
        .suggestions=${matches}
        @search-input=${(event: CustomEvent<{ value: string }>) =>
        update({ name: event.detail.value })}
      ></heo-search-field>
      <heo-value-field
        .value=${row.value}
        .suggestions=${valueSuggestions(row.name)}
        placeholder=${meta?.boolean ? 'no value needed' : (meta?.hint ?? 'value')}
        @value-input=${(event: CustomEvent<{ value: string }>) =>
        update({ value: event.detail.value })}
        @value-change=${(event: CustomEvent<{ value: string }>) =>
        update({ value: event.detail.value })}
      ></heo-value-field>
      <button
        class="btn icon ghost sm"
        type="button"
        ?disabled=${this.draftRows.length < 2}
        title="Remove this row"
        aria-label="Remove this row"
        @click=${() => {
        this.draftRows = this.draftRows.filter((_entry, at) => at !== index);
      }}
      >
        ${icon('close', 11)}
      </button>
    </div>`;
  }

  /**
   * Write every named row, as one change.
   *
   * A row with no name is somebody having changed their mind, so it is skipped rather than
   * reported. A row the editor refuses is reported and stops the batch: writing two of three
   * attributes and complaining about the third would leave the user guessing which landed.
   */
  #commitRows(el: HTMLElement): void {
    const values: Record<string, string> = {};
    for (const row of this.draftRows) {
      const name = row.name.trim();
      if (!name) continue;
      const value = row.value.trim();
      const refusal = attributeRefusal(name, value, el.tagName);
      if (refusal) {
        this.editor.notify(refusal, 'error');
        return;
      }
      // Empty is a real value, not an omission: `hidden`, `disabled` and `required` are written as
      // the empty string, which is exactly what makes `hasAttribute` true for them.
      values[name] = value;
    }
    const names = Object.keys(values);
    if (!names.length) return;

    this.editor.setAttributes(
      values,
      names.length === 1 ? `Add ${names[0]}` : `Add ${names.length} attributes`,
      el,
    );

    this.editor.notify(
      names.length === 1
        ? `Added ${names[0]} to ${labelFor(el)}.`
        : `Added ${names.length} attributes to ${labelFor(el)}.`,
      'success',
    );
    this.#closeAdder();
  }

  #remember(id: string, open: boolean): void {
    if (open) openSections.add(id);
    else openSections.delete(id);
    this.version += 1;
  }
}

/**
 * The values an attribute accepts, when the catalogue knows them.
 *
 * Worth wiring up because most of the useful attributes are closed sets — `loading` is lazy or
 * eager, `aria-live` is off, polite or assertive — and typing those from memory is where the
 * mistakes are. Every field in this panel used to be handed an empty list.
 */
function valueSuggestions(name: string): Array<{ value: string; hint?: string }> {
  const meta = attributeMeta(name);
  if (!meta?.values) return [];
  return meta.values.map((value) => ({ value }));
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
