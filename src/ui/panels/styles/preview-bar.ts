import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { iconForWidth } from '../../../core/breakpoints.js';
import type { EditorEngine } from '../../../core/editor.js';
import type { Viewport } from '../../../core/viewports.js';
import { icon } from '../../icons.js';
import type { SegmentOption } from '../../controls/segmented.js';
import '../../controls/viewport-sizes.js';

/**
 * "Preview size": the page as it is, or the page at a device's width.
 *
 * Actual is the default and always one click away, because a preview is a way to look, not a mode
 * to live in. Previewing re-evaluates the page's media queries in place, so what the panel lists,
 * what the strips pick and where an edit offers to stay all follow the width. The line under the
 * bar says which of the two the panel is showing.
 *
 * The sizes are the presets, one per width media query the page writes, and the user's own
 * (`core/viewports.ts`). Its ⋮ opens the viewport sizes panel: which ones the bar shows, at which
 * width, and a way to add one. Picking a size is the bar's job alone; the panel is for editing.
 */

export interface PreviewBarSpec {
  engine: EditorEngine;
  previewWidth: number | null;
  /** Every size, shown or not, by width. */
  viewports: readonly Viewport[];
  menuOpen: boolean;
  onMenu(open: boolean): void;
  /** Place the layer again: its content rendered, or grew. */
  onLayout(): void;
  /** The selected element sits in a shadow root, whose sheets keep the real width. */
  inShadowRoot: boolean;
}

const MENU_ID = 'preview';

export function renderPreviewBar(spec: PreviewBarSpec): TemplateResult {
  const engine = spec.engine;
  const shown = spec.viewports.filter((one) => one.shown);
  const width = spec.previewWidth;
  const available = engine.viewport.available;
  // Past the four presets the device icons go, and the bar wraps: with icons a fifth size already
  // clipped "Actual" to "Actua". The numbers are what is read, and the name is in each one's title.
  const many = shown.length > 4;
  const options: SegmentOption[] = [
    { value: 'actual', icon: 'window', label: 'Actual', title: 'The page as it is on this screen' },
    ...shown.map((one) => ({
      value: String(one.width),
      icon: many ? undefined : one.icon,
      label: String(one.width),
      title: `${one.name}, ${one.width}px`,
      ariaLabel: `${one.name}, ${one.width}px`,
    })),
  ];
  // A width not in the bar (hidden since, or set from elsewhere): shown while it lasts.
  if (width !== null && !shown.some((one) => one.width === width)) {
    options.push({
      value: String(width),
      icon: iconForWidth(width),
      label: String(width),
      title: `Previewing ${width}px`,
      ariaLabel: `Previewing ${width}px`,
    });
  }
  return html`<div class="sizes">
    <div class="pvbar" data-menu-place=${MENU_ID}>
      <heo-segmented
        label="Preview size"
        ?wrap=${many}
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
        aria-label="Edit the viewport sizes"
        title="Viewport sizes: which ones the bar shows, and their widths"
        aria-haspopup="dialog"
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
      ? html`As it is: <b>${innerWidth}px</b>`
      : html`Previewing <b>${width}px</b>.`}
    </p>
  </div>
  ${spec.menuOpen ? renderViewportsLayer(spec) : nothing}`;
}

/**
 * The viewport sizes panel, as a layer under the bar. A dialog rather than a menu: it holds
 * fields and checkboxes. Every change is kept as it is made; Escape or a press outside closes it.
 */
function renderViewportsLayer(spec: PreviewBarSpec): TemplateResult {
  return html`<div
    class="menu vpmenu"
    role="dialog"
    popover="manual"
    data-menu=${MENU_ID}
    aria-label="Viewport sizes"
    @viewports-layout=${() => spec.onLayout()}
  >
    <p class="cap">Viewport sizes</p>
    <heo-viewport-sizes
      .engine=${spec.engine}
      limits
      ?in-shadow-root=${spec.inShadowRoot}
    ></heo-viewport-sizes>
  </div>`;
}

export const previewBarStyles: CSSResult = css`
  .sizes {
    padding: 8px 12px 9px;
    border-bottom: 1px solid var(--heo-line);
  }
  .sizes .pvbar {
    display: flex;
    align-items: flex-start;
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
  .menu.vpmenu {
    padding: 4px 10px 10px;
  }
  .menu.vpmenu .cap {
    padding-left: 2px;
  }
`;
