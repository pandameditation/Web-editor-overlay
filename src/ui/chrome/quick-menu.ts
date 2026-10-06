import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { isMutable, labelFor, selectorFor, visualBox } from '../../core/dom.js';
import { modalOpen } from '../../core/modal.js';
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
  /** Why it is disabled, shown as text inside the item so it is part of its accessible name. */
  reason?: string;
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
    (s) =>
      [s.quickMenuOpen, s.selected, s.geometry, s.canUndo, s.canRedo, s.selection, s.quickMenuAnchor] as const,
    shallowArrayEquals,
  );

  @state() private view: 'root' | 'wrap' = 'root';

  #onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.state.value.quickMenuOpen) return;
    if (modalOpen()) return;
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
    const members = state.selection.filter((member) => member.isConnected);
    /*
     * Beside the thumb that was clicked, not the primary's. With a group every member has a
     * thumb, and a menu that opened by the first member when the third was clicked sat a
     * screen away from the pointer. An anchor that is no longer a member falls back.
     */
    const anchor =
      state.quickMenuAnchor && members.includes(state.quickMenuAnchor) ? state.quickMenuAnchor : el;
    this.#place(anchor);

    // A group gets only the actions that have one unambiguous meaning for all of it (DP-6).
    if (members.length > 1) {
      return html`<div class="menu surface" role="menu">
        ${this.view === 'wrap' ? this.#renderWrap(members) : this.#renderGroup(members)}
      </div>`;
    }
    return html`<div class="menu surface" role="menu">
      ${this.view === 'wrap' ? this.#renderWrap(el) : this.#renderRoot(el)}
    </div>`;
  }

  #renderGroup(members: readonly HTMLElement[]): TemplateResult {
    const state = this.state.value;
    const actions = this.editor.groupActions(members);
    const reasonOf = (verdict: { ok: boolean; reason?: string }): string | undefined =>
      verdict.ok ? undefined : verdict.reason;

    const selection: MenuItem[] = [
      {
        id: 'group-wrap',
        label: 'Wrap in a container…',
        glyph: 'wrap',
        disabled: !actions.wrap.ok,
        reason: reasonOf(actions.wrap),
        run: () => {
          this.view = 'wrap';
        },
      },
      {
        id: 'group-save-block',
        label: 'Save as a reusable block…',
        glyph: 'blocks',
        disabled: !actions.saveBlock.ok,
        reason: reasonOf(actions.saveBlock),
        run: () => {
          this.editor.beginGroupBlockExtraction(members);
          this.editor.setQuickMenu(false);
        },
      },
      {
        id: 'group-merge',
        label: 'Merge',
        glyph: 'unwrap',
        disabled: !actions.merge.ok,
        reason: reasonOf(actions.merge),
        run: () => {
          this.editor.mergeSelection(members);
          this.editor.setQuickMenu(false);
        },
      },
      {
        id: 'group-delete',
        label: 'Delete',
        glyph: 'trash',
        hint: '⌫',
        danger: true,
        disabled: !actions.delete.ok,
        reason: reasonOf(actions.delete),
        run: () => {
          this.editor.removeSelection(members);
          this.editor.setQuickMenu(false);
        },
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
    ];

    return html`
      <div class="head">
        ${icon('cursor', 11)}<span class="name">${members.length} elements</span>
      </div>
      <div class="group">Selection</div>
      ${selection.map((item) => this.#renderItem(item))}
      <div class="group">Other</div>
      ${rest.map((item) => this.#renderItem(item))}
    `;
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
      {
        id: 'turn-into',
        label: 'Turn into',
        glyph: 'blocks',
        hint: '›',
        disabled: !mutable,
        // The block picker, in a mode that carries this element's content into what is picked.
        run: () => {
          this.editor.setQuickMenu(false);
          this.editor.setInsertAnchor({ reference: el, position: 'replace', mode: 'turn' });
        },
      },
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
        /*
         * Anything inside counts, and text is inside.
         *
         * `el.children` is element children only, so every element holding nothing but words —
         * a `<b>`, a `<span>`, a `<strong>`, a `<p>` — looked empty and the item sat greyed
         * out. Those are the common case rather than an edge one: turning
         * `<p><b>bold</b> text</p>` into `<p>bold text</p>` is what unwrapping an inline tag
         * is for, and it was the one shape the action refused.
         *
         * `childNodes` rather than a rule invented here, because that is precisely what
         * `unwrapElement` declines on. The two have to ask the same question: a stricter gate
         * hides a command that would have worked, and a looser one offers a click that answers
         * with an error toast.
         */
        disabled: !mutable || el.childNodes.length === 0,
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

  #renderWrap(target: HTMLElement | readonly HTMLElement[]): TemplateResult {
    const containers = this.editor.library.list('container');
    const title =
      target instanceof HTMLElement ? `Wrap ${labelFor(target)} in…` : `Wrap ${target.length} elements in…`;
    /*
     * The Plain container row comes first, and is not a library preset: every preset brings
     * layout of its own, and wrapping a few elements just to keep them together needs a
     * container that changes nothing. Hard-coded, so the library, its panel and every preset
     * count stay as they are.
     */
    return html`
      <div class="head">
        <button class="back" type="button" title="Back" @click=${() => {
        this.view = 'root';
      }}>
          ${icon('chevronLeft', 12)}
        </button>
        <span class="name">${title}</span>
      </div>
      <button
        class="item"
        type="button"
        data-id="wrap-plain"
        @click=${() => this.#wrap('<div></div>', target)}
      >
        <span class="glyph">${icon('wrap', 14)}</span>
        <span class="text">
          Plain container
          <span class="desc">A div with no styles of its own</span>
        </span>
      </button>
      ${containers.map(
        (block) => html`<button
          class="item"
          type="button"
          data-id=${`wrap-${block.id}`}
          @click=${() => this.#wrapWith(block.id, target)}
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

  async #wrapWith(blockId: string, target: HTMLElement | readonly HTMLElement[]): Promise<void> {
    const block = this.editor.library.get(blockId);
    if (!block) return;
    // Wrap with an empty shell: the element being wrapped is the content, so the
    // preset's placeholder children would be noise.
    const { nodes } = await this.editor.library.instantiate(block, {});
    const shell = nodes[0];
    if (!shell) return;
    shell.innerHTML = '';
    this.#wrap(shell.outerHTML, target);
  }

  /** One element goes through the single wrap; several through the group wrap. */
  #wrap(wrapperHTML: string, target: HTMLElement | readonly HTMLElement[]): void {
    if (target instanceof HTMLElement) this.editor.wrap(wrapperHTML, target);
    else this.editor.wrapSelection(wrapperHTML, target);
    this.view = 'root';
    this.editor.setQuickMenu(false);
  }

  #renderItem(item: MenuItem): TemplateResult {
    return html`<button
      class=${`item${item.danger ? ' danger' : ''}`}
      type="button"
      role="menuitem"
      data-id=${item.id}
      ?disabled=${item.disabled}
      @click=${item.run}
    >
      <span class="glyph">${icon(item.glyph, 14)}</span>
      <span class="text">${item.label}${item.disabled && item.reason
        ? html`<span class="desc">${item.reason}</span>`
        : nothing}</span>
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
