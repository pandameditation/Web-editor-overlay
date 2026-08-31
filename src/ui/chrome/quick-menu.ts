import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { isMutable, labelFor, selectorFor, visualBox } from '../../core/dom.js';
import { copyToClipboard } from '../../core/design-system.js';
import { hasComponentProps } from '../../core/props.js';
import { listen, unlisten } from '../../core/shield.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { modLabel } from './toolbar.js';

interface MenuItem {
  id: string;
  label: string;
  glyph: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

/**
 * The element menu, opened by clicking the drag thumb.
 *
 * Groups actions the way people think about them: change the content, change the
 * structure, move it, get rid of it. The wrap action opens a second view inside
 * the same popover rather than a nested submenu, because hover-based submenus are
 * fiddly at this size and the container list is short.
 */
@customElement('heo-quick-menu')
export class HeoQuickMenu extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    css`
      :host {
        position: fixed;
        z-index: 16;
        pointer-events: auto;
      }

      .menu {
        width: 232px;
        max-height: min(70vh, 460px);
        overflow-y: auto;
        padding: 5px;
        border-radius: var(--heo-r-md);
        animation: in var(--heo-fast);
      }
      @keyframes in {
        from {
          opacity: 0;
          transform: translateY(-4px) scale(0.985);
        }
      }

      .head {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 7px 7px;
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10.5px;
        border-bottom: 1px solid var(--heo-line);
        margin-bottom: 4px;
      }
      .head .name {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--heo-text);
      }
      .back {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
      }
      .back:hover {
        background: var(--heo-hover);
        color: var(--heo-text);
      }

      .group {
        padding: 6px 7px 3px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .item {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 6px 7px;
        border: 0;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .item:hover:not(:disabled) {
        background: var(--heo-hover);
      }
      .item:disabled {
        opacity: 0.38;
        cursor: not-allowed;
      }
      .item.danger {
        color: var(--heo-danger);
      }
      .item.danger:hover:not(:disabled) {
        background: color-mix(in oklab, var(--heo-danger) 15%, transparent);
      }
      .item .glyph {
        display: grid;
        place-items: center;
        width: 16px;
        color: var(--heo-text-faint);
      }
      .item.danger .glyph {
        color: var(--heo-danger);
      }
      .item .text {
        flex: 1 1 auto;
      }
      .item .hint {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .item .desc {
        display: block;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.35;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.quickMenuOpen, s.selected, s.geometry, s.canUndo, s.canRedo] as const,
    shallowArrayEquals,
  );

  @state() private view: 'root' | 'wrap' = 'root';

  #onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.state.value.quickMenuOpen) return;
    if (event.composedPath().includes(this)) return;
    // A click on the thumb toggles the menu itself; let that handler win.
    const onThumb = event
      .composedPath()
      .some((node) => node instanceof HTMLElement && node.classList.contains('thumb'));
    if (onThumb) return;
    this.editor.setQuickMenu(false);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    // `listen`, so the shield's `pointerdown` gate cannot stop this menu dismissing.
    listen(document, 'pointerdown', this.#onDocumentPointerDown, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    unlisten(document, 'pointerdown', this.#onDocumentPointerDown, true);
  }

  override render(): TemplateResult | typeof nothing {
    const state = this.state.value;
    if (!state.quickMenuOpen || !state.selected || !state.selected.isConnected) {
      if (this.view !== 'root') this.view = 'root';
      return nothing;
    }
    const el = state.selected;
    this.#place(el);

    return html`<div class="menu surface" role="menu">
      ${this.view === 'wrap' ? this.#renderWrap(el) : this.#renderRoot(el)}
    </div>`;
  }

  #renderRoot(el: HTMLElement): TemplateResult {
    const state = this.state.value;
    const mutable = isMutable(el);
    /*
     * Content the page renders gets a different first item, not a disabled one.
     *
     * "Edit text" greyed out answers a question nobody asked. The user wants this text
     * to say something else, and there is a way to make that happen — it is in a file
     * rather than on the page — so the menu offers that instead and the label says
     * where it goes.
     */
    const rendered = this.editor.provenanceOf(el);

    const content: MenuItem[] = [
      rendered
        ? {
          id: 'source',
          label: 'Edit the code that renders this',
          glyph: 'code',
          hint: '↵',
          run: () => {
            this.editor.setQuickMenu(false);
            void this.editor.openSourceEdit(el);
          },
        }
        : {
          id: 'text',
          label: 'Edit text',
          glyph: 'text',
          hint: '↵',
          run: () => {
            this.editor.beginTextEdit(el);
            this.editor.setQuickMenu(false);
          },
        },
      {
        id: 'html',
        label: 'Edit HTML',
        glyph: 'code',
        hint: 'H',
        run: () => {
          this.editor.setDockTab('code');
          this.editor.setQuickMenu(false);
        },
      },
      {
        id: 'props',
        label: hasComponentProps(el) ? 'Edit component props' : 'Edit attributes',
        glyph: 'sliders',
        hint: 'P',
        run: () => {
          this.editor.setDockTab('props');
          this.editor.setQuickMenu(false);
        },
      },
      {
        id: 'styles',
        label: 'Edit styles',
        glyph: 'styles',
        hint: 'S',
        run: () => {
          this.editor.setDockTab('styles');
          this.editor.setQuickMenu(false);
        },
      },
    ];

    const structure: MenuItem[] = [
      {
        id: 'duplicate',
        label: 'Duplicate',
        glyph: 'duplicate',
        hint: `${modLabel()}+D`,
        disabled: !mutable,
        run: () => {
          this.editor.duplicate(el);
          this.editor.setQuickMenu(false);
        },
      },
      {
        id: 'wrap',
        label: 'Wrap in a container…',
        glyph: 'wrap',
        disabled: !mutable,
        run: () => {
          this.view = 'wrap';
        },
      },
      {
        id: 'unwrap',
        label: 'Unwrap, keep children',
        glyph: 'unwrap',
        disabled: !mutable || el.children.length === 0,
        run: () => {
          this.editor.unwrap(el);
          this.editor.setQuickMenu(false);
        },
      },
      {
        id: 'extract',
        label: 'Extract styles into a class…',
        glyph: 'droplet',
        run: () => {
          this.editor.beginClassExtraction(el);
          this.editor.setQuickMenu(false);
        },
      },
      {
        id: 'save-block',
        label: 'Save as a reusable block…',
        glyph: 'blocks',
        run: () => {
          this.editor.beginBlockExtraction(el);
          this.editor.setQuickMenu(false);
        },
      },
    ];

    const movement: MenuItem[] = [
      {
        id: 'up',
        label: 'Move up',
        glyph: 'arrowUp',
        hint: '⇧↑',
        disabled: !mutable,
        run: () => this.editor.move('up', el),
      },
      {
        id: 'down',
        label: 'Move down',
        glyph: 'arrowDown',
        hint: '⇧↓',
        disabled: !mutable,
        run: () => this.editor.move('down', el),
      },
      {
        id: 'out',
        label: 'Move out of parent',
        glyph: 'moveOut',
        hint: '⇧←',
        disabled: !mutable,
        run: () => this.editor.move('out', el),
      },
      {
        id: 'in',
        label: 'Move into next element',
        glyph: 'moveIn',
        hint: '⇧→',
        disabled: !mutable,
        run: () => this.editor.move('in', el),
      },
    ];

    const rest: MenuItem[] = [
      {
        id: 'undo',
        label: 'Undo',
        glyph: 'undo',
        hint: `${modLabel()}+Z`,
        disabled: !state.canUndo,
        run: () => this.editor.undo(),
      },
      {
        id: 'redo',
        label: 'Redo',
        glyph: 'redo',
        hint: `⇧${modLabel()}+Z`,
        disabled: !state.canRedo,
        run: () => this.editor.redo(),
      },
      {
        id: 'copy',
        label: 'Copy CSS selector',
        glyph: 'copy',
        run: async () => {
          const ok = await copyToClipboard(selectorFor(el));
          this.editor.notify(ok ? 'Selector copied.' : 'Could not copy.', ok ? 'success' : 'error');
          this.editor.setQuickMenu(false);
        },
      },
      {
        id: 'delete',
        label: 'Delete',
        glyph: 'trash',
        hint: '⌫',
        danger: true,
        disabled: !mutable,
        run: () => {
          this.editor.remove(el);
          this.editor.setQuickMenu(false);
        },
      },
    ];

    return html`
      <div class="head">
        ${icon('cursor', 11)}<span class="name">${labelFor(el)}</span>
      </div>
      <div class="group">Content</div>
      ${content.map((item) => this.#renderItem(item))}
      <div class="group">Structure</div>
      ${structure.map((item) => this.#renderItem(item))}
      <div class="group">Position</div>
      ${movement.map((item) => this.#renderItem(item))}
      <div class="group">Other</div>
      ${rest.map((item) => this.#renderItem(item))}
    `;
  }

  #renderWrap(el: HTMLElement): TemplateResult {
    const containers = this.editor.library.list('container');
    return html`
      <div class="head">
        <button class="back" type="button" title="Back" @click=${() => {
        this.view = 'root';
      }}>
          ${icon('chevronLeft', 12)}
        </button>
        <span class="name">Wrap ${labelFor(el)} in…</span>
      </div>
      ${containers.map(
        (block) => html`<button
          class="item"
          type="button"
          @click=${() => this.#wrapWith(block.id, el)}
        >
          <span class="glyph">${icon(block.icon ?? 'wrap', 14)}</span>
          <span class="text">
            ${block.name}
            <span class="desc">${block.description ?? ''}</span>
          </span>
        </button>`,
      )}
    `;
  }

  async #wrapWith(blockId: string, el: HTMLElement): Promise<void> {
    const block = this.editor.library.get(blockId);
    if (!block) return;
    // Wrap with an empty shell: the element being wrapped is the content, so the
    // preset's placeholder children would be noise.
    const { nodes } = await this.editor.library.instantiate(block, {});
    const shell = nodes[0];
    if (!shell) return;
    shell.innerHTML = '';
    this.editor.wrap(shell.outerHTML, el);
    this.view = 'root';
    this.editor.setQuickMenu(false);
  }

  #renderItem(item: MenuItem): TemplateResult {
    return html`<button
      class=${`item${item.danger ? ' danger' : ''}`}
      type="button"
      role="menuitem"
      ?disabled=${item.disabled}
      @click=${item.run}
    >
      <span class="glyph">${icon(item.glyph, 14)}</span>
      <span class="text">${item.label}</span>
      ${item.hint ? html`<span class="hint">${item.hint}</span>` : nothing}
    </button>`;
  }

  /** Anchor beside the thumb, flipping when there is not enough room. */
  #place(el: HTMLElement): void {
    const box = visualBox(el);
    const width = 232;
    const height = Math.min(innerHeight * 0.7, 460);
    const preferredLeft = box.left - width - 34;
    const left =
      preferredLeft > 8 ? preferredLeft : Math.min(box.left + 8, innerWidth - width - 8);
    const top = Math.min(Math.max(8, box.top), Math.max(8, innerHeight - height - 8));
    this.style.left = `${Math.round(left)}px`;
    this.style.top = `${Math.round(top)}px`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-quick-menu': HeoQuickMenu;
  }
}
