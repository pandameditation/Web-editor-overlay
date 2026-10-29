import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { icon } from '../../icons.js';
import { anchoredStyle } from '../../place.js';

/**
 * The Styles panel's menus: one look, one keyboard, one placement.
 *
 * Every "pick one of these" in the panel (where an added property is written, the preview's media
 * queries and sizes, a strip's other media queries) is the same thing, so it is drawn and driven by
 * one function. They used to be written per use, and the copies disagreed about which keys moved,
 * whether Tab closed them and where focus went afterwards.
 *
 * A menu lives in the top layer, placed against the control that opened it. The dock clips its
 * descendants and carries a backdrop filter, so anything painted in place is cut off by the panel.
 */

export interface MenuItem {
  key: string;
  label: string;
  /** Quiet text on the right: a reach, a count. */
  note?: string;
  icon?: string;
  /** For a choice among items: rendered as a radio with a tick. */
  checked?: boolean;
  title?: string;
  disabled?: boolean;
  onSelect(): void;
}

export interface MenuGroup {
  caption?: string;
  items: readonly MenuItem[];
  /** Static content after the items, such as an inline field or a list of limits. */
  after?: TemplateResult;
}

export interface MenuSpec {
  /** Unique in the shadow root; the control that opens it carries `data-menu-anchor` with it. */
  id: string;
  label: string;
  groups: readonly MenuGroup[];
  onClose(): void;
}

export function renderMenu(spec: MenuSpec): TemplateResult {
  const radio = spec.groups.some((group) => group.items.some((item) => item.checked !== undefined));
  return html`<div
    class="menu"
    role="menu"
    popover="manual"
    data-menu=${spec.id}
    aria-label=${spec.label}
    @keydown=${(event: KeyboardEvent) => menuKeydown(event, spec.onClose)}
  >
    ${spec.groups.map(
    (group, index) => html`${index ? html`<hr />` : nothing}
        ${group.caption ? html`<p class="cap" aria-hidden="true">${group.caption}</p>` : nothing}
        ${group.items.map(
      (item) => html`<button
            class="mi"
            type="button"
            role=${radio ? 'menuitemradio' : 'menuitem'}
            aria-checked=${radio ? (item.checked ? 'true' : 'false') : nothing}
            title=${item.title ?? nothing}
            ?disabled=${Boolean(item.disabled)}
            data-key=${item.key}
            @pointerdown=${(event: Event) => event.preventDefault()}
            @click=${() => item.onSelect()}
          >
            <span class="l">
              ${radio ? html`<span class="tick">${item.checked ? icon('check', 11) : nothing}</span>` : nothing}
              ${item.icon ? icon(item.icon, 12) : nothing}
              <span class="lbl">${item.label}</span>
            </span>
            ${item.note ? html`<small>${item.note}</small>` : nothing}
          </button>`,
    )}
        ${group.after ?? nothing}`,
  )}
  </div>`;
}

/**
 * The menu keyboard: ↑/↓ and Home/End move, Enter/Space activate (a button's own behaviour), Tab
 * and Escape close. Escape goes no further, or the global keymap would read it as "deselect".
 */
export function menuKeydown(event: KeyboardEvent, onClose: () => void): void {
  const menu = event.currentTarget as HTMLElement;
  // A field inside the menu (Add a viewport size…) keeps its own keys.
  if ((event.target as HTMLElement).localName === 'input' && event.key !== 'Escape') return;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.mi:not([disabled])'));
  const at = items.indexOf(event.target as HTMLButtonElement);
  const move = (to: number): void => {
    event.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  };
  switch (event.key) {
    case 'ArrowDown':
      move(at + 1);
      return;
    case 'ArrowUp':
      move(at < 0 ? items.length - 1 : at - 1);
      return;
    case 'Home':
      move(0);
      return;
    case 'End':
      move(items.length - 1);
      return;
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    case 'Tab':
      onClose();
  }
}

/**
 * Put a top-layer element under its anchor, and keep it there.
 *
 * Written straight to the element rather than through a render: the placement depends on the
 * rendered size, so a state property here would be a render loop. Only written when it changes.
 */
export function placeLayer(
  layer: HTMLElement | null,
  anchor: Element | null,
  options: { minWidth?: number; gap?: number } = {},
): void {
  if (!layer || !anchor) return;
  if (typeof layer.showPopover === 'function' && !layer.matches(':popover-open')) {
    try {
      layer.showPopover();
    } catch {
      /* already open, or popovers are unsupported: it still renders in place */
    }
  }
  const next = anchoredStyle({
    anchor: anchor.getBoundingClientRect(),
    popup: layer.getBoundingClientRect(),
    content: layer.scrollHeight,
    minWidth: options.minWidth ?? 220,
    gap: options.gap ?? 4,
  });
  if (layer.getAttribute('style') !== next) layer.setAttribute('style', next);
}

export const menuStyles: CSSResult = css`
  .menu {
    position: fixed;
    inset: auto;
    margin: 0;
    display: grid;
    gap: 1px;
    min-width: 200px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--heo-line-strong);
    border-radius: var(--heo-r-md);
    background: var(--heo-raised);
    box-shadow: var(--heo-shadow-lg);
    color: var(--heo-text);
  }
  .menu .cap {
    margin: 0;
    padding: 5px 8px 3px;
    color: var(--heo-text-dim);
    font-size: 10px;
  }
  .menu hr {
    width: 100%;
    margin: 3px 0;
    border: 0;
    border-top: 1px solid var(--heo-line);
  }
  .menu .mi {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--heo-r-sm);
    background: transparent;
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .menu .mi:hover:not(:disabled) {
    background: var(--heo-hover);
  }
  .menu .mi:disabled {
    color: var(--heo-text-disabled);
    cursor: not-allowed;
  }
  .menu .mi .l {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }
  .menu .mi .l svg {
    flex: 0 0 auto;
    color: var(--heo-text-dim);
  }
  .menu .mi .lbl {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .menu .mi .tick {
    display: inline-grid;
    place-items: center;
    width: 12px;
  }
  .menu .mi small {
    color: var(--heo-text-dim);
    font-family: var(--heo-font);
    font-size: 10px;
    white-space: nowrap;
  }
  .menu .mi:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: -1px;
  }
`;
