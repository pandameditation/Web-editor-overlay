import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { iconForWidth } from '../../core/breakpoints.js';
import type { EditorEngine } from '../../core/editor.js';
import type { Viewport } from '../../core/viewports.js';
import { icon } from '../icons.js';
import { tip, tipId } from '../controls/tip.js';
import { renderMenu, type MenuItem } from '../panels/styles/menu.js';
import '../controls/viewport-sizes.js';

/**
 * The preview size, in the toolbar: one dropdown and its ⋮.
 *
 * It lived at the top of the Styles panel as a row of segments, which grew with every size the
 * user added (a fifth size already clipped "Actual") and was out of reach whenever another tab
 * was showing, although the width is the page's and not the element's. In the bar it is one
 * button that names the current size, a menu of the sizes, and the same viewport sizes editor
 * behind the ⋮ (`controls/viewport-sizes.ts`, unchanged).
 *
 * Actual is always first and one pick away: a preview is a way to look, not a mode to live in.
 */

export type ViewportLayer = 'viewport' | 'sizes';

export interface ViewportControlsSpec {
  engine: EditorEngine;
  previewWidth: number | null;
  /** Pinned: Actual is the room between the panels rather than the window. */
  docked: boolean;
  /** Which of the two layers is open, if either. */
  open: ViewportLayer | null;
  /** Open one layer (closing the other), or close it; closing by a pick hands focus back. */
  onOpen(layer: ViewportLayer | null, refocus?: boolean): void;
  /** Place the open layer again: its content rendered, or grew. */
  onLayout(): void;
  /** Draw again: something the store does not hold changed (the fit switch). */
  refresh(): void;
  /** The selected element sits in a shadow root, whose sheets keep the real width. */
  inShadowRoot: boolean;
}

/**
 * Actual's width: the window's, or, pinned, the room the page is laid out in between the panels
 * (the window's again if the page refused the room render).
 */
function actualWidth(spec: ViewportControlsSpec): number {
  const viewport = spec.engine.viewport;
  return spec.docked && viewport.renderWidth !== null ? viewport.room : innerWidth;
}

/** What the button says: the current size's name and width, and the icon it is drawn with. */
function current(width: number | null, all: readonly Viewport[], actual: number): { name: string; width: number; icon: string } {
  if (width === null) return { name: 'Actual', width: actual, icon: 'window' };
  const known = all.find((one) => one.shown && one.width === width) ?? all.find((one) => one.width === width);
  return known
    ? { name: known.name, width, icon: known.icon }
    : { name: 'Custom', width, icon: iconForWidth(width) };
}

export function renderViewportControls(spec: ViewportControlsSpec): TemplateResult {
  const engine = spec.engine;
  const available = engine.viewport.available;
  const all = engine.viewports();
  const now = current(spec.previewWidth, all, actualWidth(spec));
  const menuOpen = spec.open === 'viewport';
  const sizesOpen = spec.open === 'sizes';
  return html`<div class="vp" data-menu-place="sizes">
    <button
      class="vpbtn"
      type="button"
      data-menu-anchor="viewport"
      aria-haspopup="menu"
      aria-expanded=${menuOpen ? 'true' : 'false'}
      aria-label=${`Preview size: ${now.name}, ${now.width}px`}
      aria-describedby=${tipId('Preview size')}
      ?data-previewing=${spec.previewWidth !== null}
      ?disabled=${!available}
      @click=${() => spec.onOpen(menuOpen ? null : 'viewport')}
    >
      ${icon(now.icon, 13)}<span class="vn">${now.name}</span><span class="vw">${now.width}</span>${icon('chevronDown', 11)}
      ${tip('Preview size', '', available
        ? 'The page at another width. Actual is the page as it is.'
        : "This page doesn't allow a viewport preview.")}
    </button>
    <button
      class="btn icon ghost"
      type="button"
      data-menu-anchor="sizes"
      aria-label="Edit the viewport sizes"
      aria-haspopup="dialog"
      aria-expanded=${sizesOpen ? 'true' : 'false'}
      aria-describedby=${tipId('Viewport sizes')}
      ?disabled=${!available}
      @click=${() => spec.onOpen(sizesOpen ? null : 'sizes')}
    >
      ${icon('dots', 13)}
      ${tip('Viewport sizes', '', 'Which ones the list shows, and their widths')}
    </button>
  </div>
  ${menuOpen ? renderViewportMenu(spec, all) : nothing}
  ${sizesOpen ? renderViewportsLayer(spec) : nothing}`;
}

/** Actual, the shown sizes, the one being previewed if it is not among them, and the fit switch. */
function renderViewportMenu(spec: ViewportControlsSpec, all: readonly Viewport[]): TemplateResult {
  const engine = spec.engine;
  const width = spec.previewWidth;
  const shown = all.filter((one) => one.shown);
  const pick = (next: number | null): void => {
    engine.setPreviewWidth(next);
    spec.onOpen(null, true);
  };
  const sizes: MenuItem[] = shown.map((one) => ({
    key: String(one.width),
    label: one.name,
    icon: one.icon,
    note: one.origin === 'page' ? `page, ${one.width}px` : `${one.width}px`,
    checked: width === one.width,
    onSelect: () => pick(one.width),
  }));
  // A width not in the list (hidden since, or set from elsewhere): shown while it lasts.
  if (width !== null && !shown.some((one) => one.width === width)) {
    const known = all.find((one) => one.width === width);
    sizes.push({
      key: String(width),
      label: known?.name ?? 'Custom',
      icon: iconForWidth(width),
      note: `${width}px`,
      checked: true,
      onSelect: () => pick(width),
    });
  }
  return renderMenu({
    id: 'viewport',
    label: 'Preview size',
    onClose: () => spec.onOpen(null, true),
    groups: [
      {
        caption: 'Preview size',
        items: [{
          key: 'actual',
          label: 'Actual',
          icon: 'window',
          note: spec.docked ? `between the panels, ${actualWidth(spec)}px` : `this window, ${innerWidth}px`,
          checked: width === null,
          onSelect: () => pick(null),
        }],
      },
      { items: sizes },
      {
        items: [{
          key: 'fit',
          kind: 'check',
          label: 'Fit wider sizes to the window',
          icon: 'fit',
          checked: engine.viewport.fit,
          disabled: !engine.viewport.canFit,
          title: engine.viewport.canFit ? undefined : "This browser can't scale the page to fit.",
          // Kept open: the tick is the answer, and the user may pick a size next.
          onSelect: () => {
            engine.setPreviewFit(!engine.viewport.fit);
            spec.refresh();
          },
        }],
      },
    ],
  });
}

/**
 * The viewport sizes editor, as a layer under the ⋮. A dialog rather than a menu: it holds
 * fields and checkboxes. Every change is kept as it is made; Escape or a press outside closes it.
 */
function renderViewportsLayer(spec: ViewportControlsSpec): TemplateResult {
  return html`<div
    class="menu vpmenu"
    role="dialog"
    popover="manual"
    data-menu="sizes"
    aria-label="Viewport sizes"
    @viewports-layout=${() => spec.onLayout()}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // No further: the global keymap reads Escape as "deselect".
      event.preventDefault();
      event.stopPropagation();
      spec.onOpen(null, true);
    }}
  >
    <p class="cap">Viewport sizes</p>
    <heo-viewport-sizes
      .engine=${spec.engine}
      limits
      ?in-shadow-root=${spec.inShadowRoot}
    ></heo-viewport-sizes>
  </div>`;
}

export const viewportMenuStyles: CSSResult = css`
  .vp {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 auto;
  }
  .vpbtn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 7px 0 9px;
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-md);
    background: var(--heo-sunken);
    color: var(--heo-text);
    font: inherit;
    font-size: 11.5px;
    white-space: nowrap;
    cursor: pointer;
  }
  .vpbtn:hover:not(:disabled) {
    border-color: var(--heo-line-strong);
  }
  .vpbtn[aria-expanded='true'] {
    border-color: var(--heo-accent);
  }
  .vpbtn[data-previewing] {
    background: var(--heo-accent-soft);
    border-color: var(--heo-accent);
  }
  .vpbtn:disabled {
    color: var(--heo-text-disabled);
    cursor: not-allowed;
  }
  .vpbtn:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  .vpbtn > svg {
    flex: 0 0 auto;
    color: var(--heo-text-dim);
  }
  .vpbtn .vw {
    color: var(--heo-text-dim);
    font-family: var(--heo-mono);
    font-size: 10.5px;
  }
  .menu.vpmenu {
    padding: 4px 10px 10px;
  }
  .menu.vpmenu .cap {
    padding-left: 2px;
  }
`;
