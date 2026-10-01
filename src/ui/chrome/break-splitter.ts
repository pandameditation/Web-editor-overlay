import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { visualBox } from '../../core/dom.js';
import type { BreakRun } from '../../core/line-breaks.js';
import { listen, unlisten } from '../../core/shield.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';

/**
 * A divider across every blank line made of two line breaks, with a button to split there.
 *
 * Shown for the element being edited — so it appears the moment a second Enter makes a blank line
 * — and for the selected element, so a blank line already in the page can be found and split
 * without typing anything. The chevron beside the button opens the one setting that makes the
 * button unnecessary: splitting automatically.
 *
 * Pressing it never takes the caret away. Every control cancels `pointerdown`, the way the text
 * toolbar does, and the engine treats this component as part of the edit it acts on.
 */
@customElement('heo-break-splitter')
export class HeoBreakSplitter extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 13;
        pointer-events: none;
      }
      .divider {
        position: fixed;
        height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .divider::before {
        content: '';
        position: absolute;
        inset: 0;
        border-top: 1px dashed var(--heo-accent-line);
      }
      .group {
        position: relative;
        display: inline-flex;
        align-items: stretch;
        pointer-events: auto;
        border-radius: 999px;
        box-shadow: 0 2px 8px rgb(0 0 0 / 0.18);
      }
      .group button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        border: 1px solid var(--heo-accent-line);
        background: var(--heo-raised);
        color: var(--heo-text);
        font: 600 10.5px/1 var(--heo-font, system-ui);
        cursor: pointer;
      }
      .group button:hover {
        background: var(--heo-accent-soft, var(--heo-sunken));
      }
      .split {
        padding: 0 8px 0 7px;
        border-radius: 999px 0 0 999px;
      }
      .more {
        padding: 0 5px;
        border-left: none !important;
        border-radius: 0 999px 999px 0;
      }
      .menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        min-width: 210px;
        padding: 4px;
        border-radius: var(--heo-r-md);
        pointer-events: auto;
      }
      .menu button {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 8px;
        border: none;
        border-radius: var(--heo-r-sm);
        background: none;
        color: var(--heo-text);
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .menu button:hover {
        background: var(--heo-sunken);
      }
      .tick {
        display: inline-grid;
        place-items: center;
        width: 14px;
        height: 14px;
        border: 1px solid var(--heo-line);
        border-radius: 4px;
        color: var(--heo-accent);
      }
      .menu .hint {
        padding: 2px 8px 6px 30px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.4;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) =>
      [
        s.editing,
        s.textEditing,
        s.selected,
        s.geometry,
        s.revision,
        s.splitDoubleBreaks,
        s.drag,
        s.transform,
      ] as const,
    shallowArrayEquals,
  );

  /** Which divider's menu is open, by the first break of its run. */
  @state() private menuFor: HTMLBRElement | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // Typing does not touch the store, so the dividers follow it directly.
    listen(document, 'input', this.#refresh, true);
    listen(document, 'pointerdown', this.#outside, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(document, 'input', this.#refresh, true);
    unlisten(document, 'pointerdown', this.#outside, true);
  }

  #refresh = (): void => {
    this.requestUpdate();
  };

  #outside = (event: Event): void => {
    if (this.menuFor && !event.composedPath().includes(this)) this.menuFor = null;
  };

  override render(): TemplateResult | typeof nothing {
    const s = this.editor.store.value;
    if (!s.editing || s.drag || s.transform) return nothing;
    const target = s.textEditing ?? s.selected;
    if (!target?.isConnected) return nothing;
    const runs = this.editor.breakRuns(target, { allowTrailing: Boolean(s.textEditing) });
    if (this.menuFor && !runs.some((run) => run.breaks[0] === this.menuFor)) this.menuFor = null;
    return html`${runs.map((run) => this.#renderDivider(run))}`;
  }

  #renderDivider(run: BreakRun): TemplateResult | typeof nothing {
    const place = placement(run);
    if (!place) return nothing;
    const key = run.breaks[0];
    const open = this.menuFor === key;
    const auto = this.editor.store.value.splitDoubleBreaks;
    const stop = (event: Event): void => event.preventDefault();
    return html`<div
      class="divider"
      style=${`top:${place.y}px;left:${place.left}px;width:${place.width}px`}
    >
      <div class="group">
        <button
          class="split"
          type="button"
          title="Split into two elements here"
          @pointerdown=${stop}
          @click=${() => {
            this.menuFor = null;
            this.editor.splitAtBreak(key);
          }}
        >
          ${icon('split', 12)} Split
        </button>
        <button
          class="more"
          type="button"
          aria-label="Split options"
          aria-haspopup="menu"
          aria-expanded=${open ? 'true' : 'false'}
          @pointerdown=${stop}
          @click=${() => {
            this.menuFor = open ? null : key;
          }}
        >
          ${icon('chevronDown', 11)}
        </button>
        ${open
          ? html`<div class="menu surface" role="menu">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked=${auto ? 'true' : 'false'}
                @pointerdown=${stop}
                @click=${() => {
                  this.menuFor = null;
                  this.editor.setSplitDoubleBreaks(!auto);
                }}
              >
                <span class="tick">${auto ? icon('check', 11) : nothing}</span>
                Split automatically
              </button>
              <div class="hint">
                Every double line break in the page becomes two elements. Saved with the page.
              </div>
            </div>`
          : nothing}
      </div>
    </div>`;
  }
}

/**
 * Where a run's divider goes: across its block, through the middle of the blank line.
 *
 * A `<br>` reports the box of the line it ends, so every break after the first sits on a blank
 * line. Their span is the gap, wherever the text around it wraps.
 */
function placement(run: BreakRun): { y: number; left: number; width: number } | null {
  const blank = run.breaks.slice(1);
  const top = blank[0].getBoundingClientRect();
  const bottom = blank[blank.length - 1].getBoundingClientRect();
  if (!top.height && !bottom.height) return null;
  const y = Math.round((top.top + bottom.bottom) / 2);
  if (y < 0 || y > innerHeight) return null;
  const box = visualBox(run.block);
  return { y, left: Math.round(box.left), width: Math.round(box.width) };
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-break-splitter': HeoBreakSplitter;
  }
}
