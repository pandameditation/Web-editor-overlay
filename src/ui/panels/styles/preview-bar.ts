import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import {
  iconForWidth,
  mediaIcon,
  mediaShort,
  previewWidthFor,
  slotsWith,
  VIEWPORT_PRESETS,
  type ViewportPreset,
} from '../../../core/breakpoints.js';
import type { EditorEngine } from '../../../core/editor.js';
import { countText } from '../../../core/save-plan.js';
import { collectPageMedia } from '../../../core/viewport.js';
import { field, type FormErrors } from '../../form-errors.js';
import { icon } from '../../icons.js';
import { focusWhenOpened, renderMenu, type MenuItem } from './menu.js';
import type { SegmentOption } from '../../controls/segmented.js';

/**
 * "Preview size": the page as it is, or the page at a device's width.
 *
 * Actual is the default and always one click away, because a preview is a way to look, not a mode
 * to live in. Previewing re-evaluates the page's media queries in place, so what the panel lists,
 * what the strips pick and where an edit offers to stay all follow the width. The line under the
 * bar says which of the two the panel is showing, and where this element's styles change.
 *
 * Its ⋮ menu lists the page's own media queries (any width one can be previewed), the sizes
 * offered (the user can add one), and what a preview cannot change, measured rather than guessed.
 */

export interface PreviewBarSpec {
  engine: EditorEngine;
  previewWidth: number | null;
  /** The widths this element's rules change at. */
  breakpoints: readonly number[];
  /** The user's own sizes. */
  customSizes: readonly number[];
  menuOpen: boolean;
  onMenu(open: boolean): void;
  /** "Add a viewport size…" field text, or null while it is closed. */
  sizeDraft: string | null;
  sizeForm: FormErrors;
  onSizeDraft(text: string | null): void;
  /** The selected element sits in a shadow root, whose sheets keep the real width. */
  inShadowRoot: boolean;
}

export const SIZE_FIELD = 'viewport-size';
const MENU_ID = 'preview';

/** The presets, then the user's own sizes, by width. */
export function previewPresets(customSizes: readonly number[]): ViewportPreset[] {
  return [
    ...VIEWPORT_PRESETS,
    ...customSizes
      .filter((width) => !VIEWPORT_PRESETS.some((preset) => preset.width === width))
      .map((width) => ({ width, icon: iconForWidth(width), name: 'Custom', custom: true })),
  ].sort((a, b) => a.width - b.width);
}

export function renderPreviewBar(spec: PreviewBarSpec): TemplateResult {
  const engine = spec.engine;
  const presets = previewPresets(spec.customSizes);
  const width = spec.previewWidth;
  const available = engine.viewport.available;
  const options: SegmentOption[] = [
    { value: 'actual', icon: 'window', label: 'Actual', title: 'The page as it is on this screen' },
    ...presets.map((preset) => ({
      value: String(preset.width),
      icon: preset.icon,
      label: String(preset.width),
      title: `${preset.name}, ${preset.width}px`,
      ariaLabel: `${preset.name}, ${preset.width}px`,
    })),
  ];
  // A width picked from the page's media queries that is not one of the sizes: shown while it lasts.
  if (width !== null && !presets.some((preset) => preset.width === width)) {
    options.push({
      value: String(width),
      icon: iconForWidth(width),
      label: String(width),
      title: `Previewing ${width}px`,
      ariaLabel: `Previewing ${width}px`,
    });
  }
  const changes = spec.breakpoints.length
    ? html` Styles change at ${spec.breakpoints.map(
      (at, index) => html`${index ? ', ' : ''}<b>${at}px</b>`,
    )}.`
    : nothing;

  return html`<div class="sizes">
    <div class="pvbar" data-menu-place=${MENU_ID}>
      <heo-segmented
        label="Preview size"
        .options=${options}
        .value=${width === null ? 'actual' : String(width)}
        ?disabled=${!available}
        title=${available ? '' : "This page doesn't allow a viewport preview."}
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
      const next = event.detail.value;
      engine.setPreviewWidth(next === 'actual' || !next ? null : Number(next));
    }}
      ></heo-segmented>
      <button
        class="more"
        type="button"
        aria-label="Media queries and viewport sizes"
        title="Media queries on this page, and viewport sizes"
        aria-haspopup="menu"
        aria-expanded=${spec.menuOpen ? 'true' : 'false'}
        data-menu-anchor=${MENU_ID}
        ?disabled=${!available}
        @click=${() => spec.onMenu(!spec.menuOpen)}
      >
        ${icon('dots', 13)}
      </button>
    </div>
    <p class="bp">
      ${width === null
      ? html`As it is: <b>${innerWidth}px</b>. Every size and state is shown.`
      : html`Previewing <b>${width}px</b>. Only what applies at this width is shown, and edits offer to stay at this size.`}${changes}
    </p>
  </div>
  ${spec.menuOpen ? renderPreviewMenu(spec, presets) : nothing}`;
}

function renderPreviewMenu(spec: PreviewBarSpec, presets: readonly ViewportPreset[]): TemplateResult {
  const engine = spec.engine;
  const close = (): void => spec.onMenu(false);
  const preview = (width: number | null): void => {
    engine.setPreviewWidth(width);
    close();
  };
  const slots = slotsWith(spec.customSizes);
  const media: MenuItem[] = collectPageMedia().map((one) => {
    const at = previewWidthFor(one.media, presets);
    return {
      key: `media:${one.media}`,
      icon: mediaIcon(one.media),
      label: mediaShort(one.media),
      note: `${countText(one.rules, 'rule')}${at !== null ? ` · preview ${at}` : ''}`,
      title: at !== null ? `Preview at ${at}px` : 'Not a width: shown at Actual',
      onSelect: () => preview(at),
    };
  });
  const sizes: MenuItem[] = presets.map((preset) => {
    const slot = slots.find((one) => one.at === preset.width);
    return {
      key: `size:${preset.width}`,
      icon: preset.icon,
      label: `${preset.width}px`,
      note: `${preset.name}${slot ? ` · ${mediaShort(slot.media)}` : ''}`,
      onSelect: () => preview(preset.width),
      remove: preset.custom
        ? { label: 'Remove this size', onRemove: () => engine.removeViewportSize(preset.width) }
        : undefined,
    };
  });
  if (spec.sizeDraft === null) {
    sizes.push({
      key: 'add-size',
      icon: 'plus',
      label: 'Add a viewport size…',
      note: 'preview + breakpoint',
      onSelect: () => spec.onSizeDraft(''),
    });
  }
  const unreadable = engine.viewport.unreadableSheets;
  return renderMenu({
    id: MENU_ID,
    label: 'Media queries and viewport sizes',
    onClose: close,
    groups: [
      { caption: 'Media queries on this page', items: media },
      {
        caption: 'Viewport sizes',
        items: sizes,
        after: spec.sizeDraft === null ? undefined : renderSizeField(spec),
      },
      {
        caption: "What a preview can't change",
        items: [],
        after: html`<ul class="limits">
          <li>Animations (@keyframes) keep vw at the real window's width.</li>
          <li>Page scripts see the real window: matchMedia, innerWidth, resize.</li>
          <li>Fixed elements still span the whole window.</li>
          <li>Print and preference queries can't be previewed.</li>
          <li>Images picked by &lt;picture&gt; or srcset don't change.</li>
          ${unreadable
          ? html`<li>${countText(unreadable, 'stylesheet')} from another origin can't be previewed.</li>`
          : nothing}
          ${spec.inShadowRoot
          ? html`<li>Styles inside this component's shadow root keep the real width.</li>`
          : nothing}
        </ul>`,
      },
    ],
  });
}

/** "Add a viewport size…" as an inline field: Enter adds and previews it, Escape puts the item back. */
function renderSizeField(spec: PreviewBarSpec): TemplateResult {
  const submit = (): void => {
    if (!spec.sizeForm.submit()) return;
    const width = Number((spec.sizeDraft ?? '').trim().replace(/px$/i, ''));
    spec.onSizeDraft(null);
    spec.engine.addViewportSize(width);
    spec.engine.setPreviewWidth(width);
    spec.onMenu(false);
  };
  return html`<div class="mfield">
    <input
      ${field(spec.sizeForm, SIZE_FIELD, { required: true })}
      ${ref(focusWhenOpened)}
      class="input mono"
      type="text"
      inputmode="numeric"
      aria-label="Viewport width in pixels"
      placeholder="1280"
      autocomplete="off"
      .value=${spec.sizeDraft ?? ''}
      @input=${(event: Event) => spec.onSizeDraft((event.target as HTMLInputElement).value)}
      @keydown=${(event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        spec.sizeForm.reset();
        spec.onSizeDraft(null);
      }
    }}
    />
    ${spec.sizeForm.error(SIZE_FIELD)}
  </div>`;
}

export const previewBarStyles: CSSResult = css`
  .sizes {
    padding: 8px 12px 9px;
    border-bottom: 1px solid var(--heo-line);
  }
  .sizes .pvbar {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sizes heo-segmented {
    flex: 1 1 auto;
    min-width: 0;
  }
  .sizes .more {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-sm);
    background: var(--heo-sunken);
    color: var(--heo-text-dim);
    cursor: pointer;
  }
  .sizes .more:hover:not(:disabled),
  .sizes .more[aria-expanded='true'] {
    background: var(--heo-hover);
    color: var(--heo-text);
  }
  .sizes .more:disabled {
    color: var(--heo-text-disabled);
    cursor: not-allowed;
  }
  .sizes .more:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  .sizes .bp {
    margin: 7px 0 0;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.5;
  }
  .sizes .bp b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-weight: 400;
  }
  .menu .limits {
    margin: 0;
    padding: 2px 8px 6px 22px;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.5;
  }
`;
