import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { covers, timeMs, type TransitionItem } from '../../core/transitions.js';
import { icon } from '../icons.js';
import { killStyles, renderKill } from '../kill.js';
import { baseStyles } from '../theme.js';
import './easing-editor.js';

/** One change a state makes to the element: what the property is now, and what it becomes. */
export interface TriggerChange {
  property: string;
  from: string;
  to: string;
}

/** A state the page's CSS gives the element, and what it changes. */
export interface TransitionTrigger {
  /** The condition key: `:hover`, `:hover on .nav`. */
  state: string;
  /** How it is said: `:hover`, `:hover on .nav`. */
  label: string;
  /** The other element whose state it is, for a state on another element; null for the element's own. */
  on: string | null;
  changes: TriggerChange[];
}

/** A duration token offered as a preset: `--motion-fast`, 150. */
export interface DurationToken {
  name: string;
  ms: number;
}

/** The properties offered after the trigger's own changes. */
const COMMON = ['all', 'opacity', 'color', 'background-color', 'transform', 'box-shadow', 'filter'];
/** The presets when the design system has no duration tokens. */
const PLAIN_DURATIONS = [150, 250, 400];

/** A transition of `item` plays a change to `changed`: the same property, a longhand of it, or `all`. */
const carries = (item: string, changed: string): boolean => covers(item, changed) || covers(changed, item);

const camel = (property: string): string => property.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());

/**
 * The Transition tab of the Motion section: what a state change does, on one clock.
 *
 * Top to bottom:
 * - the trigger: "When [state] starts", a menu of the states the page's own CSS gives the element
 *   (a state on another element said as such, `:hover on .nav`), and Try it, which plays the
 *   transitions on the element as the state would;
 * - the timeline: one row per transitioned property, in the order written — picked by clicking,
 *   moved by its grip (or Alt and an arrow), removed by its trash. Under the name, what the
 *   trigger changes it from and to; its bar is its delay and duration, dragged to move, its end
 *   dragged to lengthen;
 * - Add: first what the trigger changes and nothing transitions yet, tagged with the state, then
 *   `all` and the common ones, then any other property by name;
 * - the picked row's duration (the motion tokens as presets), delay and easing curve.
 *
 * Try it never writes: it plays the changes through `element.animate()`, there and back, as the
 * Animation editor's preview does. What a script changes (a class toggled) is not a state any
 * stylesheet shows; a transition for it is authored here all the same, it just cannot be played.
 *
 * Fires `transition-change` with `{ items }` when a change settles. Dragging a bar previews on the
 * timeline only, and writes on release.
 */
@customElement('heo-transition-editor')
export class HeoTransitionEditor extends LitElement {
  static override styles = [
    baseStyles,
    killStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        font-size: 11.5px;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
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
      .trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .trigger .w {
        color: var(--heo-text-dim);
      }
      .trigger select {
        min-width: 0;
        max-width: 60%;
        height: 26px;
        padding: 0 4px;
        border: 1px solid var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .trigger .try {
        margin-left: auto;
      }
      .note {
        margin: 0;
        color: var(--heo-text-hint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .note b {
        color: var(--heo-text-dim);
        font-weight: 600;
      }
      .tl {
        display: grid;
        gap: 2px;
      }
      .trow {
        display: grid;
        grid-template-columns: minmax(0, 138px) minmax(0, 1fr) auto;
        align-items: center;
        gap: 6px;
        padding: 3px 4px;
        border: 1px solid transparent;
        border-radius: var(--heo-r-sm);
        cursor: pointer;
      }
      .trow:hover {
        background: var(--heo-hover);
      }
      .trow[aria-current='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
      }
      .trow.over {
        box-shadow: inset 0 2px 0 var(--heo-accent);
      }
      .trow:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      /* The grip and the name: one handle to move the row by. The track beside it is the timing's. */
      .handle {
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr);
        align-items: center;
        gap: 6px;
        min-width: 0;
        cursor: grab;
      }
      .handle:active {
        cursor: grabbing;
      }
      .grip {
        display: grid;
        place-items: center;
        color: var(--heo-text-faint);
      }
      .what {
        min-width: 0;
        font-family: var(--heo-mono);
        font-size: 10.5px;
        color: var(--heo-text);
      }
      .what span,
      .what small {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .what small {
        color: var(--heo-text-faint);
        font-size: 9.5px;
      }
      .what small.none {
        color: var(--heo-warn);
      }
      .track {
        position: relative;
        height: 18px;
        border: 1px solid var(--heo-line);
        border-radius: 4px;
        background:
          repeating-linear-gradient(90deg, var(--heo-line) 0 1px, transparent 1px 25%),
          var(--heo-sunken);
        touch-action: none;
      }
      .bar {
        position: absolute;
        top: 2px;
        height: 12px;
        min-width: 4px;
        border-radius: 3px;
        background: var(--heo-accent);
        cursor: grab;
      }
      .bar:active {
        cursor: grabbing;
      }
      /*
       * The hit areas are larger than what is drawn: a 12px bar and a 4px end were hard to land on.
       * The bar is grabbed over the row's height, the end over 20px across it.
       */
      .bar::before {
        content: '';
        position: absolute;
        inset: -8px 0;
      }
      .bar.idle {
        background: color-mix(in oklab, var(--heo-accent) 40%, var(--heo-line-strong));
      }
      /* The end: drawn 4px wide, grabbed over 20px, most of it past the bar so a short bar keeps a body. */
      .bar .end {
        position: absolute;
        z-index: 1;
        right: -14px;
        top: -8px;
        bottom: -8px;
        width: 20px;
        cursor: ew-resize;
      }
      .bar .end::after {
        content: '';
        position: absolute;
        right: 14px;
        top: 8px;
        bottom: 8px;
        width: 4px;
        border-radius: 0 3px 3px 0;
        background: rgb(255 255 255 / 55%);
      }
      .bar .end:hover::after {
        background: #fff;
      }
      .playhead {
        position: absolute;
        top: -3px;
        bottom: -3px;
        left: 0;
        width: 2px;
        background: var(--heo-danger);
        opacity: 0;
        pointer-events: none;
      }
      .scale {
        display: grid;
        grid-template-columns: minmax(0, 138px) minmax(0, 1fr) 18px;
        gap: 6px;
        padding: 0 5px;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 9.5px;
      }
      .scale div {
        display: flex;
        justify-content: space-between;
      }
      .empty {
        margin: 0;
        padding: 10px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        color: var(--heo-text-faint);
        font-size: 11px;
        line-height: 1.5;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 8px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: 999px;
        background: transparent;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        cursor: pointer;
      }
      .add:hover {
        border-color: var(--heo-accent-line);
        color: var(--heo-text);
      }
      .add.changed {
        border-color: var(--heo-accent-line);
        color: var(--heo-text);
      }
      .add .tag {
        color: var(--heo-accent);
      }
      .add:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .other {
        display: inline-flex;
        align-items: center;
        height: 22px;
        padding: 0 8px;
        border: 1px solid var(--heo-accent-line);
        border-radius: 999px;
        background: var(--heo-sunken);
      }
      .other input {
        width: 120px;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        outline: none;
      }
      .ed {
        display: grid;
        gap: 8px;
        min-width: 0;
        padding: 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .row {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .row.top {
        align-items: start;
      }
      .lbl {
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 11px;
      }
      .pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 6px;
        min-width: 0;
      }
      .num {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        height: 28px;
        padding: 0 7px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        overflow: hidden;
      }
      .num:focus-within {
        border-color: var(--heo-accent-line);
      }
      .num input {
        flex: 1 1 auto;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
        font-family: var(--heo-mono);
        font-size: 11.5px;
        outline: none;
      }
      .num span {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
        white-space: nowrap;
      }
      .num .tok {
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--heo-accent);
      }
      .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        min-width: 0;
      }
      .presets button {
        padding: 3px 6px;
        border: 1px solid var(--heo-line);
        border-radius: 5px;
        background: var(--heo-raised);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10px;
        cursor: pointer;
      }
      .presets button[aria-pressed='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }
    `,
  ];

  /** The transitions as the element has them. */
  @property({ attribute: false }) items: readonly TransitionItem[] = [];
  /** The states that change the element, most useful first. */
  @property({ attribute: false }) triggers: readonly TransitionTrigger[] = [];
  /** The design system's duration tokens, as presets. */
  @property({ attribute: false }) durations: readonly DurationToken[] = [];
  /** The element Try it plays on. */
  @property({ attribute: false }) target: HTMLElement | null = null;
  /** Reads a custom property where the element is, for a duration written as a token. */
  @property({ attribute: false }) resolve: (name: string) => string = () => '';

  @state() private picked = 0;
  @state() private trigger = '';
  /** The list while a bar is dragged, ahead of the host. */
  @state() private draft: TransitionItem[] | null = null;
  @state() private adding = false;
  #previews: Animation[] = [];

  override willUpdate(changed: Map<string, unknown>): void {
    /*
     * Only when the list itself is another: the panel hands a new array on every render, and one
     * mid-drag (a press re-renders it) threw the dragged bar's draft away.
     */
    const before = changed.get('items') as readonly TransitionItem[] | undefined;
    if (changed.has('items') && JSON.stringify(before ?? null) !== JSON.stringify(this.items)) {
      this.draft = null;
      if (this.picked >= this.items.length) this.picked = Math.max(0, this.items.length - 1);
    }
    if (changed.has('triggers') && !this.triggers.some((one) => one.state === this.trigger)) {
      this.trigger = this.triggers[0]?.state ?? '';
    }
  }

  /*
   * A row to focus once the host has written the change and handed the new list back. Focused
   * straight away, the row added (or moved to) was not drawn yet, and the button pressed was gone:
   * focus dropped on nothing.
   */
  #focusAfter: number | null = null;

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has('items') || this.#focusAfter === null) return;
    const index = this.#focusAfter;
    this.#focusAfter = null;
    (this.#row(index) ?? this.renderRoot.querySelector<HTMLElement>('.add'))?.focus({ preventScroll: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stop();
  }

  get #list(): readonly TransitionItem[] {
    return this.draft ?? this.items;
  }

  get #current(): TransitionTrigger | undefined {
    return this.triggers.find((one) => one.state === this.trigger);
  }

  #ms(text: string): number {
    return timeMs(text, this.resolve) ?? 0;
  }

  /** The clock's length: 600ms, or longer to fit the longest transition. */
  get #span(): number {
    const longest = Math.max(0, ...this.#list.map((one) => this.#ms(one.delay) + this.#ms(one.duration)));
    return Math.max(600, Math.ceil((longest * 1.2) / 200) * 200);
  }

  #emit(items: TransitionItem[]): void {
    this.dispatchEvent(new CustomEvent('transition-change', { detail: { items }, bubbles: true, composed: true }));
  }

  #set(index: number, patch: Partial<TransitionItem>): void {
    const items = this.#list.map((one, at) => (at === index ? { ...one, ...patch } : { ...one }));
    this.#emit(items);
  }

  #add(property: string): void {
    const name = property.trim().toLowerCase();
    if (!name) return;
    const base = this.durations.find((one) => /base|normal|medium|default/i.test(one.name)) ?? this.durations[0];
    const items = [...this.#list.map((one) => ({ ...one })), {
      property: name,
      duration: base ? `var(${base.name})` : '250ms',
      delay: '',
      easing: '',
      behavior: '',
    }];
    this.picked = items.length - 1;
    this.adding = false;
    this.#focusAfter = this.picked;
    this.#emit(items);
  }

  #remove(index: number): void {
    const items = this.#list.filter((_one, at) => at !== index).map((one) => ({ ...one }));
    if (this.picked >= index && this.picked > 0) this.picked -= 1;
    this.#focusAfter = Math.min(index, items.length - 1);
    this.#emit(items);
  }

  #move(from: number, to: number): void {
    const list = this.#list;
    if (from === to || to < 0 || to >= list.length) return;
    const items = list.map((one) => ({ ...one }));
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    this.picked = to;
    this.#focusAfter = to;
    this.#emit(items);
  }

  #row(index: number): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`.trow[data-row="${index}"]`);
  }

  override render(): TemplateResult {
    const list = this.#list;
    const picked = list[this.picked];
    return html`
      ${this.#renderTrigger()}
      ${list.length
        ? this.#renderTimeline(list)
        : html`<p class="empty">
            Nothing transitions yet: every change ${this.#current ? html`<b>${this.#current.label}</b> makes` : 'is'} instant. Add a property below.
          </p>`}
      ${this.#renderAdd(list)}
      ${picked ? this.#renderPicked(picked, this.picked) : nothing}
    `;
  }

  #renderTrigger(): TemplateResult {
    const current = this.#current;
    const playable = Boolean(current?.changes.some((change) => this.#list.some((one) => carries(one.property, change.property))));
    return html`
      <div class="trigger">
        <span class="w">When</span>
        ${this.triggers.length
          ? html`<select
              aria-label="Trigger"
              .value=${this.trigger}
              @change=${(event: Event) => {
                this.trigger = (event.target as HTMLSelectElement).value;
              }}
            >${this.triggers.map((one) => html`<option value=${one.state} ?selected=${one.state === this.trigger}>${one.label}</option>`)}</select>
            <span class="w">starts</span>`
          : html`<select aria-label="Trigger" disabled><option>no state in the page's CSS</option></select>`}
        <button
          class="btn primary sm try"
          type="button"
          ?disabled=${!playable}
          title=${playable
            ? `Play the transitions as ${current!.label} would, there and back. Nothing is written.`
            : this.triggers.length
              ? `Nothing here transitions a change ${current?.label ?? ''} makes.`
              : 'Nothing to play between: no state rule reaches this element.'}
          @click=${() => this.play()}
        >${icon('play', 11)} Try it</button>
      </div>
      ${current?.on
        ? html`<p class="note"><b>${current.label}</b>: the state is on <b>${current.on}</b>, an element around this one. Try it plays what it changes here.</p>`
        : nothing}
      ${!this.triggers.length
        ? html`<p class="note">
            No rule in the page's CSS changes this element in a state. A transition here still plays for
            changes a script makes (a class added, a style set).
          </p>`
        : nothing}
    `;
  }

  #renderTimeline(list: readonly TransitionItem[]): TemplateResult {
    const span = this.#span;
    const changes = this.#current?.changes ?? [];
    const quarter = (n: number): string => `${Math.round((span * n) / 4)}`;
    return html`<div class="tl" role="list" aria-label="Transitions, in the order written">
      ${list.map((one, index) => {
        const change = one.property === 'all'
          ? (changes.length ? { from: 'every change', to: `${changes.length} propert${changes.length === 1 ? 'y' : 'ies'}` } : null)
          : changes.find((c) => carries(one.property, c.property));
        const delay = this.#ms(one.delay);
        const duration = this.#ms(one.duration);
        return html`<div
          class="trow"
          role="listitem"
          tabindex="0"
          data-row=${index}
          aria-current=${index === this.picked ? 'true' : 'false'}
          aria-label=${`${one.property}: ${duration}ms after ${delay}ms. Alt and an arrow move it.`}
          @click=${() => {
            this.picked = index;
          }}
          @keydown=${(event: KeyboardEvent) => this.#rowKey(event, index)}
          @dragover=${(event: DragEvent) => this.#dragOver(event)}
          @dragleave=${(event: DragEvent) => (event.currentTarget as HTMLElement).classList.remove('over')}
          @drop=${(event: DragEvent) => this.#drop(event, index)}
          @dragend=${() => {
            this.#dragFrom = null;
          }}
        >
          <span
            class="handle"
            draggable="true"
            title="Drag to reorder"
            @dragstart=${(event: DragEvent) => this.#dragStart(event, index)}
          ><span class="grip">${icon('grip', 12)}</span><span class="what">
            <span>${one.property}</span>
            ${change
              ? html`<small title=${`${change.from} → ${change.to}`}>${change.from} → ${change.to}</small>`
              : html`<small class="none">${this.#current ? `${this.#current.label} does not change it` : 'no state changes it'}</small>`}
          </span></span>
          <span class="track">
            <span
              class=${change ? 'bar' : 'bar idle'}
              data-bar=${index}
              style=${`left:${(delay / span) * 100}%;width:${(duration / span) * 100}%`}
              title=${`${duration}ms after ${delay}ms. Drag to delay it.`}
              @pointerdown=${(event: PointerEvent) => this.#dragBar(event, index)}
            ><span class="end" title="Drag to lengthen or shorten it"></span></span>
            <span class="playhead"></span>
          </span>
          <span @click=${(event: Event) => event.stopPropagation()}>${renderKill({
            label: `Stop transitioning ${one.property}`,
            tight: true,
            onClick: () => this.#remove(index),
          })}</span>
        </div>`;
      })}
      <div class="scale" aria-hidden="true"><span></span>
        <div><span>0</span><span>${quarter(1)}</span><span>${quarter(2)}</span><span>${quarter(3)}</span><span>${span}ms</span></div><span></span></div>
    </div>`;
  }

  #renderAdd(list: readonly TransitionItem[]): TemplateResult {
    const has = (property: string): boolean => list.some((one) => one.property === property);
    const current = this.#current;
    const fromTrigger = (current?.changes ?? []).filter((change) => !list.some((one) => carries(one.property, change.property)));
    const rest = COMMON.filter((property) => !has(property) && !fromTrigger.some((change) => change.property === property));
    return html`<div>
      <div class="group" style="margin-bottom:6px">Add</div>
      <div class="chips" role="group" aria-label="Properties to transition">
        ${fromTrigger.map((change) => html`<button
          class="add changed"
          type="button"
          data-add=${change.property}
          title=${`${current!.label} changes it: ${change.from} → ${change.to}`}
          @click=${() => this.#add(change.property)}
        >+ ${change.property} <span class="tag">${current!.label}</span></button>`)}
        ${rest.map((property) => html`<button class="add" type="button" data-add=${property} @click=${() => this.#add(property)}>+ ${property}</button>`)}
        ${this.adding
          ? html`<span class="other"><input
              aria-label="Property to transition"
              placeholder="property name"
              @keydown=${(event: KeyboardEvent) => {
                const input = event.target as HTMLInputElement;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (this.#known(input.value)) this.#add(input.value);
                  else input.setCustomValidity('Not a CSS property');
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  this.adding = false;
                  void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.add[data-add="other"]')?.focus());
                }
              }}
              @blur=${(event: Event) => {
                const value = (event.target as HTMLInputElement).value;
                if (this.#known(value)) this.#add(value);
                else this.adding = false;
              }}
            /></span>`
          : html`<button
              class="add"
              type="button"
              data-add="other"
              @click=${() => {
                this.adding = true;
                void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('.other input')?.focus());
              }}
            >+ other…</button>`}
      </div>
    </div>`;
  }

  #known(name: string): boolean {
    const property = name.trim().toLowerCase();
    if (!property) return false;
    if (property === 'all' || property.startsWith('--')) return true;
    try {
      return CSS.supports(property, 'initial');
    } catch {
      return false;
    }
  }

  #renderPicked(one: TransitionItem, index: number): TemplateResult {
    const ms = this.#ms(one.duration);
    const token = /^var\(\s*(--[\w-]+)/i.exec(one.duration)?.[1] ?? null;
    const presets: Array<{ label: string; value: string; ms: number }> = this.durations.length
      ? this.durations.map((t) => ({ label: t.name.replace(/^--(?:motion|duration|transition|time)-?/i, '') || t.name, value: `var(${t.name})`, ms: t.ms }))
      : PLAIN_DURATIONS.map((n) => ({ label: String(n), value: `${n}ms`, ms: n }));
    const number = (key: 'duration' | 'delay', label: string, value: number, unit: string, extra: TemplateResult | typeof nothing = nothing): TemplateResult =>
      html`<label class="num">
        <input
          aria-label=${label}
          inputmode="numeric"
          .value=${String(value)}
          @change=${(event: Event) => {
            const n = Number.parseFloat((event.target as HTMLInputElement).value);
            if (!Number.isFinite(n) || n < 0) return;
            this.#set(index, { [key]: key === 'delay' && n === 0 ? '' : `${Math.round(n)}ms` });
          }}
        /><span>${unit}</span>${extra}
      </label>`;
    return html`<div class="ed">
      <div class="group">${one.property}</div>
      <div class="row">
        <span class="lbl">duration</span>
        <div class="pair">
          ${number('duration', token ? `Duration, milliseconds (${token})` : 'Duration, milliseconds', ms, 'ms')}
          ${number('delay', 'Delay, milliseconds', this.#ms(one.delay), 'delay')}
        </div>
      </div>
      <div class="row">
        <span class="lbl"></span>
        <div class="presets" role="group" aria-label="Duration presets">
          ${presets.map((preset) => html`<button
            type="button"
            aria-pressed=${one.duration === preset.value ? 'true' : 'false'}
            title=${preset.value}
            @click=${() => this.#set(index, { duration: preset.value })}
          >${preset.label} ${preset.ms}</button>`)}
        </div>
      </div>
      <div class="row top">
        <span class="lbl">easing</span>
        <heo-easing-editor
          .value=${one.easing || 'ease'}
          @easing-input=${(event: Event) => event.stopPropagation()}
          @easing-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#set(index, { easing: /^ease$/i.test(event.detail.value) ? '' : event.detail.value });
          }}
        ></heo-easing-editor>
      </div>
    </div>`;
  }

  #rowKey(event: KeyboardEvent, index: number): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.picked = index;
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.#move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
    }
  }

  #dragFrom: number | null = null;

  /*
   * The grip and the name move a row; the track does not. The whole row used to be draggable, and
   * a press on the bar's end — meant to lengthen it — started moving the row instead: the drag
   * event names the row, not the bar under the pointer, so the check that was meant to stop it
   * never saw the bar. The track is the timing's alone now.
   */
  #dragStart(event: DragEvent, index: number): void {
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.trow');
    if (row) event.dataTransfer?.setDragImage(row, 12, row.offsetHeight / 2);
    this.#dragFrom = index;
    event.dataTransfer?.setData('text/plain', `transition:${index}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  #dragOver(event: DragEvent): void {
    if (this.#dragFrom === null) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).classList.add('over');
  }

  #drop(event: DragEvent, index: number): void {
    (event.currentTarget as HTMLElement).classList.remove('over');
    const from = this.#dragFrom;
    this.#dragFrom = null;
    if (from === null || from === index) return;
    event.preventDefault();
    this.#move(from, index);
  }

  /** Drag a bar to move its delay, its end to lengthen it: on the timeline as it goes, written on release. */
  #dragBar(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const bar = event.currentTarget as HTMLElement;
    const track = bar.parentElement!.getBoundingClientRect();
    const stretch = Boolean((event.composedPath()[0] as HTMLElement).closest?.('.end'));
    const span = this.#span;
    const one = this.#list[index];
    const start = { x: event.clientX, delay: this.#ms(one.delay), duration: this.#ms(one.duration) };
    this.picked = index;
    try {
      bar.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer: the listeners below still follow it.
    }
    let moved = false;
    const at = (x: number): Partial<TransitionItem> => {
      const ms = Math.round((((x - start.x) / Math.max(1, track.width)) * span) / 10) * 10;
      if (stretch) return { duration: `${Math.max(10, start.duration + ms)}ms` };
      const delay = Math.max(0, start.delay + ms);
      return { delay: delay ? `${delay}ms` : '' };
    };
    const move = (e: PointerEvent): void => {
      if (Math.abs(e.clientX - start.x) < 2 && !moved) return;
      moved = true;
      const patch = at(e.clientX);
      this.draft = this.#list.map((item, i) => (i === index ? { ...item, ...patch } : item));
    };
    const up = (e: PointerEvent): void => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      if (!moved) return;
      const patch = at(e.clientX);
      const items = this.items.map((item, i) => (i === index ? { ...item, ...patch } : { ...item }));
      this.#emit(items);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  }

  /**
   * Play the transitions as the picked trigger would: each change it makes that a transition
   * carries, from what the element shows now to the state's value and back, with that
   * transition's duration, delay and easing. Through `element.animate()`: nothing is written, and
   * the element is as it was once it ends. Returns how many animations it started.
   */
  play(): number {
    this.#stop();
    const el = this.target;
    const current = this.#current;
    if (!el?.isConnected || typeof el.animate !== 'function' || !current) return 0;
    const shown = getComputedStyle(el);
    let longest = 0;
    const runs: Array<{ key: string; from: string; to: string; options: KeyframeAnimationOptions }> = [];
    for (const change of current.changes) {
      const item = [...this.#list].reverse().find((one) => carries(one.property, change.property));
      if (!item) continue;
      const duration = this.#ms(item.duration);
      const delay = this.#ms(item.delay);
      // An easing CSS accepts and the animation API does not (a token) plays as ease.
      let easing = item.easing || 'ease';
      if (/^var\(/i.test(easing)) easing = 'ease';
      longest = Math.max(longest, duration + delay);
      runs.push({
        key: camel(change.property),
        from: shown.getPropertyValue(change.property) || change.from,
        to: change.to,
        options: { duration: Math.max(1, duration), delay, easing, fill: 'both' },
      });
    }
    if (!runs.length) return 0;
    const start = (frames: Array<Record<string, string>>, options: KeyframeAnimationOptions): void => {
      try {
        this.#previews.push(el.animate(frames, options));
      } catch {
        // A value the browser will not animate: that one snaps.
      }
    };
    for (const run of runs) start([{ [run.key]: run.from }, { [run.key]: run.to }], run.options);
    this.#playhead(longest, false);
    const hold = 500;
    const back = window.setTimeout(() => {
      this.#stop(false);
      for (const run of runs) start([{ [run.key]: run.to }, { [run.key]: run.from }], run.options);
      this.#playhead(longest, true);
      this.#timers.push(window.setTimeout(() => this.#stop(), longest + 60));
    }, longest + hold);
    this.#timers.push(back);
    return this.#previews.length;
  }

  #timers: number[] = [];

  #playhead(ms: number, back: boolean): void {
    const span = this.#span;
    for (const head of Array.from(this.renderRoot.querySelectorAll<HTMLElement>('.playhead'))) {
      try {
        this.#previews.push(head.animate(
          [{ left: '0%', opacity: 1 }, { left: `${Math.min(100, (ms / span) * 100)}%`, opacity: 1 }],
          { duration: Math.max(1, ms), fill: 'forwards', direction: back ? 'reverse' : 'normal' },
        ));
      } catch {
        // No playhead: the preview still plays.
      }
    }
  }

  #stop(timers = true): void {
    for (const one of this.#previews) one.cancel();
    this.#previews = [];
    if (timers) {
      for (const id of this.#timers) clearTimeout(id);
      this.#timers = [];
    }
  }

  /** Whether a preview is playing on the element now: for the host, and for the fixture. */
  get previewing(): number {
    return this.#previews.filter((one) => one.playState === 'running' && (one.effect as KeyframeEffect | null)?.target === this.target).length;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-transition-editor': HeoTransitionEditor;
  }
}
