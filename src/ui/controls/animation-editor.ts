import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  defaultConfig,
  presetById,
  PRESETS,
  previewFrames,
  TRIGGER_LABELS,
  type AnimationConfig,
  type AnimationPreset,
  type Category,
  type ParamSpec,
} from '../../core/animations.js';
import {
  MAX_TEXTS,
  typewriterParams,
  typewriterSettings,
  type TypewriterCaret,
  type TypewriterSettings,
} from '../../core/typewriter.js';
import { icon } from '../icons.js';
import { killStyles, renderKill } from '../kill.js';
import { baseStyles } from '../theme.js';
import type { SegmentOption } from './segmented.js';
import type { ValueSuggestion } from './value-field.js';
import './easing-editor.js';
import './segmented.js';
import './value-field.js';

const GROUPS: Record<Category, string> = { reveal: 'Reveal', attention: 'Attention', text: 'Text', scroll: 'Scroll-driven' };
const ICONS: Record<Category, string> = { reveal: 'eye', attention: 'sparkle', text: 'text', scroll: 'arrowDown' };

/** The presets as the list offers them: the 2026 picks first, under Common values, then by kind. */
const SUGGESTIONS: ValueSuggestion[] = [
  ...PRESETS.filter((one) => one.featured).map((one) => ({ value: one.label, label: one.label, hint: one.description, group: 'Common values', icon: ICONS[one.category] })),
  ...(['reveal', 'attention', 'text', 'scroll'] as Category[]).flatMap((category) =>
    PRESETS.filter((one) => one.category === category).map((one) => ({ value: one.label, label: one.label, hint: one.description, group: GROUPS[category], icon: ICONS[category] }))),
];

const DIRECTION_ICONS: Record<string, string> = { up: 'arrowUp', down: 'arrowDown', left: 'arrowLeft', right: 'arrowRight' };

/** A preset by what is typed or picked: its name, or its id. */
export function presetFor(text: string): AnimationPreset | undefined {
  const wanted = text.trim().toLowerCase();
  return PRESETS.find((one) => one.label.toLowerCase() === wanted || one.id === wanted);
}

/**
 * The Animation section's editor: a ready-made animation picked from a list, its trigger, its
 * own controls (a direction, a distance, a colour) and its timing, easing curve included.
 *
 * Hovering a name in the list plays it on the selected elements, and so does every change and the
 * play button: a preview through `element.animate()`, which writes nothing and leaves the page's
 * own animation as it was once it ends.
 *
 * Fires `animation-change` with `{ value }`, the whole configuration or null to take the animation
 * away. The host decides where it is written.
 */
@customElement('heo-animation-editor')
export class HeoAnimationEditor extends LitElement {
  static override styles = [
    baseStyles,
    killStyles,
    css`
      :host {
        display: grid;
        gap: 8px;
      }
      .pick {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: 4px;
        align-items: center;
      }
      .play {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-raised);
        color: var(--heo-text-dim);
        cursor: pointer;
      }
      .play:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }
      .play:focus-visible {
        outline: 2px solid var(--heo-focus-ring);
        outline-offset: 1px;
      }
      .row {
        display: grid;
        grid-template-columns: 70px minmax(0, 1fr);
        gap: 8px;
        align-items: center;
      }
      .row > .lbl {
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 6px;
      }
      .unit {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 4px;
        align-items: center;
        color: var(--heo-text-faint);
        font-size: 10px;
      }
      .group {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
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
      .note {
        margin: 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.4;
      }
      .empty {
        margin: 0;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }

      /* Typewriter: its texts, one a row, the first the element's own. */
      .texts {
        display: grid;
        gap: 4px;
      }
      .text {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) auto 18px;
        gap: 6px;
        align-items: center;
      }
      .text .n {
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 5px;
        background: var(--heo-hover);
        color: var(--heo-text-dim);
        font: 700 9.5px var(--heo-mono);
      }
      .text .own {
        overflow: hidden;
        min-width: 0;
        height: 26px;
        padding: 0 7px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        color: var(--heo-text);
        font: 11px/24px var(--heo-mono);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .badge {
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--heo-hover);
        color: var(--heo-text-dim);
        font-size: 9.5px;
        white-space: nowrap;
      }
      .badge.real {
        background: color-mix(in oklab, var(--heo-success) 16%, transparent);
        color: var(--heo-success-text);
        font-weight: 600;
      }
      .text.off {
        opacity: 0.5;
      }
      .add {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 24px;
        padding: 0 7px;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-accent-text);
        font-size: 11px;
        cursor: pointer;
      }
      .add:hover {
        background: var(--heo-hover);
      }
      .add:disabled {
        color: var(--heo-text-faint);
        cursor: default;
      }
      .carets {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 5px;
      }
      .carets button {
        display: grid;
        justify-items: center;
        gap: 4px;
        padding: 7px 4px 5px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-size: 10px;
        cursor: pointer;
      }
      .carets button[aria-pressed='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }
      .carets i {
        display: flex;
        align-items: flex-end;
        gap: 1px;
        height: 16px;
        color: var(--heo-text);
        font: 700 13px var(--heo-mono);
        font-style: normal;
      }
      .carets i::after {
        content: '';
        display: block;
        background: var(--heo-accent-text);
      }
      .carets .bar i::after { width: 2px; height: 15px; }
      .carets .block i::after { width: 8px; height: 15px; opacity: 0.6; }
      .carets .under i::after { width: 8px; height: 2px; }
      .carets .none i::after { display: none; }
      .check {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .warn {
        color: var(--heo-warn-text);
      }
      .link {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--heo-accent-text);
        font: inherit;
        cursor: pointer;
      }
    `,
  ];

  /** The animation as read from the page, or null for none. */
  @property({ attribute: false }) value: AnimationConfig | null = null;
  /** The elements a preview plays on: the selection. */
  @property({ attribute: false }) targets: HTMLElement[] = [];

  /** The easing being dragged, ahead of the host. */
  @state() private easingDraft: string | null = null;
  #previews: Animation[] = [];

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('value')) this.easingDraft = null;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stopPreview();
  }

  override render(): TemplateResult {
    const config = this.value;
    const preset = config ? presetById(config.preset) : undefined;
    return html`
      <div class="pick">
        <heo-value-field
          data-property="animation-preset"
          field-label="Animation"
          placeholder="Pick an animation…"
          .value=${preset?.label ?? ''}
          .suggestions=${SUGGESTIONS}
          fuzzy
          @suggestion-hover=${(event: CustomEvent<{ value: string | null }>) => {
            event.stopPropagation();
            const hovered = event.detail.value ? presetFor(event.detail.value) : undefined;
            if (hovered) this.#play(this.#configFor(hovered));
            else this.#stopPreview();
          }}
          @value-input=${(event: Event) => event.stopPropagation()}
          @value-revert=${(event: Event) => event.stopPropagation()}
          @value-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            const text = event.detail.value.trim();
            if (!text) {
              this.#change(null);
              return;
            }
            const picked = presetFor(text);
            if (picked) this.#change(this.#configFor(picked));
          }}
        ></heo-value-field>
        <button type="button" class="play" title="Play it" aria-label="Play the animation" ?disabled=${!config} @click=${() => config && this.#play(config)}>
          ${icon('play', 12)}
        </button>
        ${config
        ? renderKill({ label: 'Remove the animation', onClick: () => this.#change(null) })
        : html`<span></span>`}
      </div>
      ${config && preset ? this.#renderControls(config, preset) : html`<p class="empty">Hover a name in the list to see it on the selected elements.</p>`}
    `;
  }

  /** The text the element itself holds: the typewriter's text 1, the one it keeps for real. */
  get #ownText(): string {
    return (this.targets[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** A picked preset, keeping the trigger and timing chosen so far where they still apply. */
  #configFor(preset: AnimationPreset): AnimationConfig {
    const now = this.value;
    const next = defaultConfig(preset, now?.trigger);
    if (preset.id === 'typewriter') {
      // Text 1 is the element's own text: it types what is already there, and more texts are added.
      return { ...next, params: typewriterParams({ ...typewriterSettings(next.params), texts: [this.#ownText] }) };
    }
    if (now && presetById(now.preset)?.category === preset.category) {
      return { ...next, easing: now.easing, duration: now.duration, delay: now.delay };
    }
    return next;
  }

  #renderControls(config: AnimationConfig, preset: AnimationPreset): TemplateResult {
    if (preset.id === 'typewriter') return this.#renderTypewriter(config, preset);
    const driven = config.trigger === 'in-view' || config.trigger === 'scroll';
    const set = (patch: Partial<AnimationConfig>): void => this.#change({ ...config, ...patch });
    const setParam = (key: string, value: string): void => set({ params: { ...config.params, [key]: value } });
    const triggers: SegmentOption[] = preset.triggers.map((one) => ({ value: one, label: TRIGGER_LABELS[one] }));
    return html`
      <div class="row">
        <span class="lbl">trigger</span>
        <heo-segmented
          label="Trigger"
          .options=${triggers}
          .value=${config.trigger}
          @segment-change=${(event: CustomEvent<{ value: string }>) => event.detail.value && set({ trigger: event.detail.value as AnimationConfig['trigger'] })}
        ></heo-segmented>
      </div>
      ${config.trigger === 'in-view'
        ? html`<div class="row">
            <span class="lbl">plays over</span>
            <heo-segmented
              label="Plays over"
              .options=${[{ value: 'enter', label: 'Its entry' }, { value: 'relaxed', label: 'Entry and more' }]}
              .value=${config.range}
              @segment-change=${(event: CustomEvent<{ value: string }>) => event.detail.value && set({ range: event.detail.value as AnimationConfig['range'] })}
            ></heo-segmented>
          </div>`
        : nothing}
      ${preset.params.length ? html`<div class="group">${preset.label}</div>` : nothing}
      ${preset.params.map((spec) => this.#renderParam(spec, config.params[spec.key] ?? spec.default, (value) => setParam(spec.key, value)))}
      <div class="group">Timing</div>
      ${driven
        ? html`<p class="note">${config.trigger === 'scroll'
          ? 'Follows the scroll: it plays as the page moves, at the screen’s refresh rate, off the main thread.'
          : 'Plays as it scrolls into view, and runs backwards when scrolled back out.'}</p>`
        : html`<div class="row">
            <span class="lbl">duration</span>
            <div class="pair">
              <label class="unit">${this.#number('animation-duration', 'Duration, milliseconds', String(config.duration), (value) => set({ duration: value }))}ms</label>
              <label class="unit">${this.#number('animation-delay', 'Delay, milliseconds', String(config.delay), (value) => set({ delay: value }))}delay</label>
            </div>
          </div>
          <div class="row">
            <span class="lbl">repeat</span>
            <heo-segmented
              label="Repeat"
              .options=${[{ value: '1', label: 'Once' }, { value: '2', label: '2×' }, { value: '3', label: '3×' }, { value: 'infinite', label: '∞', ariaLabel: 'Forever' }]}
              .value=${config.iterations}
              @segment-change=${(event: CustomEvent<{ value: string }>) => event.detail.value && set({ iterations: event.detail.value })}
            ></heo-segmented>
          </div>`}
      <div class="row">
        <span class="lbl">direction</span>
        <heo-segmented
          label="Play direction"
          .options=${[{ value: 'normal', label: 'Forward' }, { value: 'reverse', label: 'Reverse' }, { value: 'alternate', label: 'Back & forth' }]}
          .value=${config.direction === 'alternate-reverse' ? 'alternate' : config.direction}
          @segment-change=${(event: CustomEvent<{ value: string }>) => event.detail.value && set({ direction: event.detail.value as AnimationConfig['direction'] })}
        ></heo-segmented>
      </div>
      <div class="row" style="align-items:start">
        <span class="lbl">easing</span>
        <heo-value-field
          data-property="animation-timing-function"
          field-label="Easing"
          .value=${config.easing}
          .suggestions=${[]}
          @value-input=${(event: Event) => event.stopPropagation()}
          @value-revert=${(event: Event) => event.stopPropagation()}
          @value-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (event.detail.value.trim()) set({ easing: event.detail.value.trim() });
          }}
        ></heo-value-field>
      </div>
      <heo-easing-editor
        .value=${this.easingDraft ?? config.easing}
        @easing-input=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.easingDraft = event.detail.value;
        }}
        @easing-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.easingDraft = null;
          set({ easing: event.detail.value });
        }}
      ></heo-easing-editor>
    `;
  }

  /**
   * The Typewriter's settings, in the order it plays: its texts, how it types and what comes after,
   * the caret. One line, drawn over the element's own text (typewriter.ts).
   */
  #renderTypewriter(config: AnimationConfig, preset: AnimationPreset): TemplateResult {
    const settings = typewriterSettings(config.params);
    const write = (patch: Partial<TypewriterSettings>, iterations = config.iterations): void =>
      this.#change({ ...config, iterations, params: typewriterParams({ ...settings, ...patch }) });
    const own = this.#ownText;
    const texts = [settings.texts[0] ?? own, ...settings.texts.slice(1)];
    const stale = Boolean(own) && texts[0] !== own;
    const setText = (index: number, text: string): void => {
      const next = [...texts];
      next[index] = text;
      write({ texts: next });
    };
    const triggers: SegmentOption[] = preset.triggers.map((one) => ({ value: one, label: TRIGGER_LABELS[one] }));
    const ms = (property: string, label: string, value: number, apply: (n: number) => void): TemplateResult =>
      html`<label class="unit">${this.#number(property, label, String(value), (n) => n > 0 && apply(Math.round(n)))}ms</label>`;
    const caret = (value: TypewriterCaret, label: string): TemplateResult => html`<button
      type="button"
      class=${value}
      data-caret=${value}
      aria-pressed=${String(settings.caret === value)}
      @click=${() => write({ caret: value })}
    ><i aria-hidden="true">A</i>${label}</button>`;
    return html`
      <div class="row">
        <span class="lbl">trigger</span>
        <heo-segmented
          label="Trigger"
          .options=${triggers}
          .value=${config.trigger}
          @segment-change=${(event: CustomEvent<{ value: string }>) => event.detail.value && this.#change({ ...config, trigger: event.detail.value as AnimationConfig['trigger'] })}
        ></heo-segmented>
      </div>
      <div class="group">Texts</div>
      <div class="texts" data-texts>
        <div class="text" data-text="0">
          <span class="n">1</span>
          <span class="own" title=${`${texts[0]}: the element's own text. Edit it on the page.`}>${texts[0] || '(no text)'}</span>
          <span class="badge real" title="The element's own text: selectable, indexed, read by screen readers">real text</span>
          <span></span>
        </div>
        ${texts.slice(1).map((text, k) => {
      const index = k + 1;
      const off = settings.after === 'keep';
      return html`<div class=${off ? 'text off' : 'text'} data-text=${index}>
            <span class="n">${index + 1}</span>
            <heo-value-field
              data-property="typewriter-text"
              field-label=${`Text ${index + 1}`}
              .value=${text}
              .suggestions=${[]}
              placeholder="Text to type next"
              @value-input=${(event: Event) => event.stopPropagation()}
              @value-revert=${(event: Event) => event.stopPropagation()}
              @value-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            setText(index, event.detail.value);
          }}
            ></heo-value-field>
            <span class="badge" title="Drawn by CSS on its loop: not selectable or indexed, and not read by screen readers">${off ? 'not played' : 'drawn'}</span>
            ${renderKill({ label: `Remove text ${index + 1}`, tight: true, onClick: () => write({ texts: texts.filter((_, at) => at !== index) }) })}
          </div>`;
    })}
      </div>
      <button type="button" class="add" data-act="add-text" ?disabled=${texts.length >= MAX_TEXTS}
        @click=${() => write({ texts: [...texts, 'and one more thing.'] })}>${icon('plus', 11)} Add a text</button>
      ${stale
        ? html`<p class="note warn" data-stale>Text 1 is no longer the element’s text. <button type="button" class="link" @click=${() => setText(0, own)}>Use “${own}”</button></p>`
        : html`<p class="note">Typed in order, then again from the first. Text 1 is the element’s own text, the others are drawn over it.</p>`}
      <div class="group">Typing</div>
      <div class="row"><span class="lbl">speed</span>${ms('typewriter-speed', 'Milliseconds a character, typing', settings.speed, (speed) => write({ speed }))}</div>
      <div class="row"><span class="lbl">hold</span>${ms('typewriter-hold', 'Milliseconds a text is held', settings.hold, (hold) => write({ hold }))}</div>
      <div class="row">
        <span class="lbl">then</span>
        <heo-segmented
          label="After typing"
          .options=${[{ value: 'backspace', label: 'Backspace' }, { value: 'clear', label: 'Clear' }, { value: 'keep', label: 'Keep it' }]}
          .value=${settings.after}
          @segment-change=${(event: CustomEvent<{ value: string }>) => event.detail.value && write({ after: event.detail.value as TypewriterSettings['after'] })}
        ></heo-segmented>
      </div>
      ${settings.after === 'backspace'
        ? html`<div class="row"><span class="lbl">delete</span>${ms('typewriter-remove', 'Milliseconds a character, deleting', settings.remove, (remove) => write({ remove }))}</div>`
        : nothing}
      ${settings.after === 'keep'
        ? html`<p class="note">Keep it types text 1 once and stays: the other texts are not played.</p>`
        : html`<div class="row">
            <span class="lbl">loops</span>
            <heo-segmented
              label="Loops"
              .options=${[{ value: '1', label: 'Once' }, { value: '3', label: '3×' }, { value: 'infinite', label: 'Forever' }]}
              .value=${config.iterations}
              @segment-change=${(event: CustomEvent<{ value: string }>) => event.detail.value && write({}, event.detail.value)}
            ></heo-segmented>
          </div>`}
      <div class="group">Caret</div>
      <div class="carets" role="group" aria-label="Caret">
        ${caret('bar', 'Bar')}${caret('block', 'Block')}${caret('under', 'Underscore')}${caret('none', 'None')}
      </div>
      <label class="check"><input type="checkbox" data-blink .checked=${settings.blink} ?disabled=${settings.caret === 'none'}
        @change=${(event: Event) => write({ blink: (event.target as HTMLInputElement).checked })}> Blinks</label>
      <p class="note">One line, in CSS only: each step is one character’s share of the line, so it types most evenly in a monospace font.</p>
    `;
  }

  #renderParam(spec: ParamSpec, value: string, write: (value: string) => void): TemplateResult {
    if (spec.kind === 'direction' || spec.kind === 'select') {
      const options: SegmentOption[] = (spec.options ?? []).map((one) => spec.kind === 'direction'
        ? { value: one.value, icon: DIRECTION_ICONS[one.value], title: one.label, ariaLabel: one.label }
        : { value: one.value, label: one.label });
      return html`<div class="row">
        <span class="lbl">${spec.label.toLowerCase()}</span>
        <heo-segmented
          label=${spec.label}
          data-param=${spec.key}
          .options=${options}
          .value=${value}
          @segment-change=${(event: CustomEvent<{ value: string }>) => event.detail.value && write(event.detail.value)}
        ></heo-segmented>
      </div>`;
    }
    const kind = spec.kind === 'color' ? 'color' : spec.kind === 'number' ? 'number' : 'length';
    return html`<div class="row">
      <span class="lbl">${spec.label.toLowerCase()}</span>
      <heo-value-field
        data-param=${spec.key}
        field-label=${spec.label}
        .kind=${kind}
        .value=${value}
        .suggestions=${[]}
        placeholder=${spec.default}
        @value-input=${(event: Event) => event.stopPropagation()}
        @value-revert=${(event: Event) => event.stopPropagation()}
        @value-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          write(event.detail.value.trim() || spec.default);
        }}
      ></heo-value-field>
    </div>`;
  }

  #number(property: string, label: string, value: string, write: (value: number) => void): TemplateResult {
    return html`<heo-value-field
      data-property=${property}
      field-label=${label}
      kind="number"
      .value=${value}
      .suggestions=${[]}
      @value-input=${(event: Event) => event.stopPropagation()}
      @value-revert=${(event: Event) => event.stopPropagation()}
      @value-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        const n = parseFloat(event.detail.value);
        if (Number.isFinite(n) && n >= 0) write(n);
      }}
    ></heo-value-field>`;
  }

  #change(next: AnimationConfig | null): void {
    if (next) this.#play(next);
    else this.#stopPreview();
    this.dispatchEvent(new CustomEvent('animation-change', { detail: { value: next }, bubbles: true, composed: true }));
  }

  /** Play an animation on the targets, without writing anything. */
  #play(config: AnimationConfig): void {
    this.#stopPreview();
    const preview = previewFrames(config);
    if (!preview) return;
    for (const el of this.targets) {
      if (!el.isConnected || typeof el.animate !== 'function') continue;
      try {
        this.#previews.push(el.animate(preview.frames as Keyframe[], preview.options));
      } catch {
        // A frame the browser will not animate: nothing to preview on this one.
      }
    }
  }

  #stopPreview(): void {
    for (const one of this.#previews) one.cancel();
    this.#previews = [];
  }

  /** Whether a preview is playing now: for a host, and for the fixture. */
  get previewing(): number {
    return this.#previews.filter((one) => one.playState === 'running').length;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-animation-editor': HeoAnimationEditor;
  }
}
