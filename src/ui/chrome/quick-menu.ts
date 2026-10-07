import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { isMutable, labelFor, selectorFor, visualBox } from '../../core/dom.js';
import { CANNOT_BE_REPLACED, NOT_ON_THE_BODY, NOTHING_TO_PASTE } from '../../core/editor.js';
import { deleteEligibility, outermost } from '../../core/group.js';
import { modalOpen } from '../../core/modal.js';
import { copyToClipboard } from '../../core/design-system.js';
import { hasComponentProps } from '../../core/props.js';
import { listen, unlisten } from '../../core/shield.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import { modLabel } from './toolbar.js';

interface MenuItemBase {
  id: string;
  label: string;
  glyph: string;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

/**
 * An item that can be disabled has to say why, so the type asks for a reason with `disabled`.
 *
 * The reason reaches people three ways: the `title` tooltip on hover, `aria-describedby` for
 * assistive technology, and the text itself. `reasonVisible: false` keeps that text visually
 * hidden (still described, and shown while the item has keyboard focus) for reasons that are
 * generic or already printed once elsewhere in the menu, so the single menu keeps its layout.
 */
type MenuItem = MenuItemBase &
  ({ disabled?: undefined } | { disabled: boolean; reason: string; reasonVisible?: boolean });

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
        color: var(--heo-text-dim);
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
      .item:hover:not([aria-disabled='true']) {
        background: var(--heo-hover);
      }
      .item.danger {
        color: var(--heo-danger);
      }
      /* Opaque, over the hover colour, so the tint's contrast does not depend on the page below. */
      .item.danger:hover:not([aria-disabled='true']) {
        background: color-mix(in oklab, var(--heo-danger) 14%, var(--heo-hover));
      }
      /*
       * The glyph and the hint in the dim ink, not the faint one. Faint read 2.5:1 on the glass,
       * under the 3:1 an icon needs, and a disabled glyph in the disabled ink would otherwise have
       * been more prominent than an enabled one.
       */
      .item .glyph {
        display: grid;
        place-items: center;
        width: 16px;
        color: var(--heo-text-dim);
      }
      .item.danger .glyph {
        color: var(--heo-danger);
      }
      .item .text {
        flex: 1 1 auto;
      }
      .item .hint {
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      .item .desc {
        display: block;
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.35;
      }
      /*
       * Disabled: readable, and told apart by the label leaving the full text ink, not by fading.
       * The old 38% opacity put the label at 2.2 to 3.3:1 and the reason at 1.4 to 1.6:1. Danger
       * items lose their red too, because a disabled Delete is not a threat.
       */
      .item[aria-disabled='true'],
      .item.danger[aria-disabled='true'] {
        color: var(--heo-text-disabled);
        cursor: not-allowed;
      }
      .item[aria-disabled='true'] .glyph,
      .item.danger[aria-disabled='true'] .glyph,
      .item[aria-disabled='true'] .hint,
      .item[aria-disabled='true'] .desc {
        color: var(--heo-text-disabled);
      }
      /*
       * A hidden reason shows while its disabled item has keyboard focus. The title tooltip
       * appears on pointer hover only, so without this a sighted keyboard user who Tabs onto a
       * disabled item would see no explanation at all. Undoes every property the sr class sets.
       */
      .item[aria-disabled='true']:focus-visible .desc.sr {
        position: static;
        width: auto;
        height: auto;
        margin: 0;
        overflow: visible;
        clip-path: none;
        white-space: normal;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) =>
      [
        s.quickMenuOpen,
        s.selected,
        s.geometry,
        s.canUndo,
        s.canRedo,
        s.selection,
        s.quickMenuAnchor,
        s.clipboardSize,
      ] as const,
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
    const actions = this.editor.groupActions(members);
    const reasonOf = (verdict: { ok: true } | { ok: false; reason: string }): string =>
      verdict.ok ? '' : verdict.reason;

    const structure: MenuItem[] = [
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

    return html`
      <div class="head">
        ${icon('cursor', 11)}<span class="name">${members.length} elements</span>
      </div>
      <div class="group">Structure</div>
      ${structure.map((item) => this.#renderItem(item))}
      <div class="group">Selection</div>
      ${this.#selectionItems(members).map((item) => this.#renderItem(item))}
      <div class="group">Other</div>
      ${this.#historyItems().map((item) => this.#renderItem(item))}
    `;
  }

  /** Undo and Redo, the same in both views. */
  #historyItems(): MenuItem[] {
    const state = this.state.value;
    return [
      {
        id: 'undo',
        label: 'Undo',
        glyph: 'undo',
        hint: `${modLabel()}+Z`,
        disabled: !state.canUndo,
        reason: 'Nothing to undo.',
        reasonVisible: false,
        run: () => this.editor.undo(),
      },
      {
        id: 'redo',
        label: 'Redo',
        glyph: 'redo',
        hint: `⇧${modLabel()}+Z`,
        disabled: !state.canRedo,
        reason: 'Nothing to redo.',
        reasonVisible: false,
        run: () => this.editor.redo(),
      },
    ];
  }

  /*
   * The SELECTION section: Duplicate, Copy, Cut, Paste below and Paste to replace, one list for
   * both views, with the same ids, so a fixture or a future change reads one place.
   *
   * One element passes itself explicitly to the engine and a group passes its members, never
   * "whatever is selected". Every item closes the menu: copying changes nothing on the page, so
   * without the explicit close the menu stayed open after Copy.
   */
  #selectionItems(target: HTMLElement | readonly HTMLElement[]): MenuItem[] {
    const single = target instanceof HTMLElement;
    const members: readonly HTMLElement[] = single ? [target] : target;
    const roots = outermost(members);
    const allMutable = roots.every((el) => isMutable(el));
    const isPage = (el: HTMLElement): boolean =>
      el === document.body || el === document.documentElement;
    const nothingCopied = this.state.value.clipboardSize === 0;
    const cut = single
      ? { ok: isMutable(target), reason: NOT_ON_THE_BODY }
      : (() => {
        const verdict = deleteEligibility(roots);
        return verdict.ok ? { ok: true, reason: '' } : { ok: false, reason: verdict.reason };
      })();
    const close = (): void => this.editor.setQuickMenu(false);
    const mod = modLabel();
    return [
      {
        id: 'duplicate',
        label: 'Duplicate',
        glyph: 'duplicate',
        hint: `${mod}+D`,
        disabled: !allMutable,
        reason: single ? NOT_ON_THE_BODY : 'One of the selected elements cannot be duplicated.',
        reasonVisible: !single,
        run: () => {
          if (single) this.editor.duplicate(target);
          else this.editor.duplicateSelection(members);
          close();
        },
      },
      {
        id: 'copy-element',
        label: 'Copy',
        glyph: 'copy',
        hint: `${mod}+C`,
        disabled: roots.every(isPage),
        reason: 'The page itself cannot be copied.',
        reasonVisible: false,
        run: () => {
          if (single) this.editor.copyElement(target);
          else this.editor.copySelection(members);
          close();
        },
      },
      {
        id: 'cut',
        label: 'Cut',
        glyph: 'scissors',
        hint: `${mod}+X`,
        disabled: !cut.ok,
        reason: cut.reason,
        reasonVisible: !single,
        run: () => {
          this.editor.cutSelection(members);
          close();
        },
      },
      {
        id: 'paste-below',
        label: 'Paste below',
        glyph: 'pasteBelow',
        hint: `${mod}+V`,
        disabled: nothingCopied,
        // Shown here, once; Paste to replace carries the same reason hidden.
        reason: NOTHING_TO_PASTE,
        run: () => {
          this.editor.pasteBelow(members);
          close();
        },
      },
      {
        id: 'paste-replace',
        label: 'Paste to replace',
        glyph: 'replace',
        hint: `⇧${mod}+R`,
        // The body refusal first, as the engine checks it: copying does not make it replaceable.
        disabled: !allMutable || nothingCopied,
        reason: !allMutable ? CANNOT_BE_REPLACED : NOTHING_TO_PASTE,
        reasonVisible: false,
        run: () => {
          this.editor.pasteReplace(members);
          close();
        },
      },
    ];
  }

  #renderRoot(el: HTMLElement): TemplateResult {
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
        reason: NOT_ON_THE_BODY,
        reasonVisible: false,
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
        id: 'wrap',
        label: 'Wrap in a container…',
        glyph: 'wrap',
        disabled: !mutable,
        reason: NOT_ON_THE_BODY,
        reasonVisible: false,
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
        reason: !mutable ? NOT_ON_THE_BODY : 'This element is empty, so there is nothing to keep.',
        reasonVisible: false,
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
        reason: NOT_ON_THE_BODY,
        reasonVisible: false,
        run: () => this.editor.move('up', el),
      },
      {
        id: 'down',
        label: 'Move down',
        glyph: 'arrowDown',
        hint: '⇧↓',
        disabled: !mutable,
        reason: NOT_ON_THE_BODY,
        reasonVisible: false,
        run: () => this.editor.move('down', el),
      },
      {
        id: 'out',
        label: 'Move out of parent',
        glyph: 'moveOut',
        hint: '⇧←',
        disabled: !mutable,
        reason: NOT_ON_THE_BODY,
        reasonVisible: false,
        run: () => this.editor.move('out', el),
      },
      {
        id: 'in',
        label: 'Move into next element',
        glyph: 'moveIn',
        hint: '⇧→',
        disabled: !mutable,
        reason: NOT_ON_THE_BODY,
        reasonVisible: false,
        run: () => this.editor.move('in', el),
      },
    ];

    const rest: MenuItem[] = [
      ...this.#historyItems(),
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
        reason: NOT_ON_THE_BODY,
        reasonVisible: false,
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
      <div class="group">Selection</div>
      ${this.#selectionItems(el).map((item) => this.#renderItem(item))}
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

  /*
   * A disabled item stays focusable: aria-disabled rather than the disabled attribute, which
   * would drop it from the Tab order and leave assistive technology no way to reach the reason.
   * Activation is ignored instead. The accessible name is the label alone (aria-label), and the
   * reason is its description, so it is not read twice as part of the name.
   *
   * The reason span renders only while the item is disabled. Rendered hidden on enabled items,
   * it leaked into the item's text, which other code reads ("Turn intoNot available…").
   */
  #renderItem(item: MenuItem): TemplateResult {
    const disabled = item.disabled === true;
    const reasonId = `reason-${item.id}`;
    const reason = disabled ? item.reason : '';
    const hidden = disabled && item.reasonVisible === false;
    return html`<button
      class=${`item${item.danger ? ' danger' : ''}`}
      type="button"
      role="menuitem"
      data-id=${item.id}
      aria-label=${item.label}
      aria-disabled=${disabled ? 'true' : nothing}
      aria-describedby=${disabled ? reasonId : nothing}
      title=${disabled ? reason : nothing}
      @click=${disabled ? (event: Event) => event.preventDefault() : item.run}
    >
      <span class="glyph">${icon(item.glyph, 14)}</span>
      <span class="text">${item.label}${disabled
        ? html`<span class=${hidden ? 'desc sr' : 'desc'} id=${reasonId}>${reason}</span>`
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
