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
import { icon } from '../icons.js';
import { killStyles, renderKill } from '../kill.js';
import { baseStyles } from '../theme.js';
import type { SegmentOption } from './segmented.js';
import type { ValueSuggestion } from './value-field.js';
import './easing-editor.js';
import './segmented.js';
import './value-field.js';

const GROUPS: Record<Category, string> = { reveal: 'Reveal', attention: 'Attention', scroll: 'Scroll-driven' };
const ICONS: Record<Category, string> = { reveal: 'eye', attention: 'sparkle', scroll: 'arrowDown' };

/** The presets as the list offers them: the 2026 picks first, under Common values, then by kind. */
const SUGGESTIONS: ValueSuggestion[] = [
  ...PRESETS.filter((one) => one.featured).map((one) => ({ value: one.label, label: one.label, hint: one.description, group: 'Common values', icon: ICONS[one.category] })),
  ...(['reveal', 'attention', 'scroll'] as Category[]).flatMap((category) =>
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
    `,
  ];

  /** The animation as read from the page, or null for none. */
  @property({ attribute: false }) value: AnimationConfig | null = null;
  /** The elements a preview plays on: the selection. */
  @property({ attribute: false }) targets: HTMLElement[] = [];
  /** The destination switch, at the head of the preset list. */
  @property({ attribute: false }) head: TemplateResult | null = null;

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
          .head=${this.head}
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

  /** A picked preset, keeping the trigger and timing chosen so far where they still apply. */
  #configFor(preset: AnimationPreset): AnimationConfig {
    const now = this.value;
    const next = defaultConfig(preset, now?.trigger);
    if (now && presetById(now.preset)?.category === preset.category) {
      return { ...next, easing: now.easing, duration: now.duration, delay: now.delay };
    }
    return next;
  }

  #renderControls(config: AnimationConfig, preset: AnimationPreset): TemplateResult {
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
