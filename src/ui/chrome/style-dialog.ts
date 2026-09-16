import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ModalController } from '../../core/modal.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles, surfaceStyles } from '../theme.js';
import {
  ClassEditor,
  focusDeclaration,
  type ClassEditorHost,
} from '../panels/class-editor.js';
import { RuleEditor, type RuleEditorHost } from '../panels/rule-editor.js';
import type { HeoValueField } from '../controls/value-field.js';

/**
 * One class or one CSS rule, on its own, in front of the user.
 *
 * This exists because of what the design system panel's two composers used to do on
 * submit: create the thing, say they had created it, and expand a card somewhere in the
 * list underneath. Three ways that fails, all of them routine:
 *
 * - **The panel's own search hides it.** The field at the top of the panel narrows all
 *   three registries, so typing `new` into the class composer while the panel is filtered
 *   to `art` produced "Created .new" over a list saying nothing matched. The class was
 *   real and correct and nowhere on screen.
 * - **So does the composer's own draft.** Each section's composer doubles as a filter for
 *   its list, and the submitted text is deliberately left in the box — so the two filters
 *   intersect, and usually to nothing.
 * - **Even unfiltered it is buried.** The card lands wherever the registry's order puts
 *   it. "p already has a rule — opening it" opens a card below every other rule whose
 *   selector or declarations happen to contain a `p`, which on a real page is most of them.
 *
 * A dialog answers all three at once: it cannot be filtered out, it needs no scrolling to
 * find, and it is already open at the property editor — which is the step the composer was
 * always a preamble to.
 *
 * The editing surface itself is not reimplemented here. It is `ClassEditor` and
 * `RuleEditor` rendered bare, the same two functions the panel uses, so a class means the
 * same thing and offers the same actions wherever it is opened from. What the dialog adds
 * is the part a card in a list cannot: a title that names what is being edited, and a
 * sentence saying whether it was just made or already existed.
 *
 * It sits *below* the CSS paste dialog on purpose. The declaration list offers "Paste CSS",
 * so that dialog can be opened from inside this one and has to land on top of it.
 */
@customElement('heo-style-dialog')
export class HeoStyleDialog extends HeoElement {
  static override styles = [
    baseStyles,
    surfaceStyles,
    ClassEditor.styles,
    RuleEditor.styles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 29;
        display: grid;
        place-items: center;
        padding: 24px;
        background: oklch(12% 0.01 265 / 55%);
        backdrop-filter: blur(3px);
        pointer-events: auto;
        animation: fade var(--heo-fast);
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
      }

      .dialog {
        display: flex;
        flex-direction: column;
        width: min(460px, 100%);
        max-height: min(86vh, 680px);
        border-radius: var(--heo-r-lg);
        overflow: hidden;
      }

      /* Scoped to the dialog's own child so the borrowed card stylesheets, which both
         style a header of their own, are left alone. */
      .dialog > header {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        flex: 0 0 auto;
        padding: 14px 16px;
        border-bottom: 1px solid var(--heo-line);
      }
      .g {
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        width: 26px;
        height: 26px;
        border-radius: 999px;
        background: var(--heo-accent-soft);
        color: var(--heo-accent);
      }
      .who {
        flex: 1 1 auto;
        min-width: 0;
      }
      .title {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
      }
      h2 {
        margin: 0;
        overflow: hidden;
        font-family: var(--heo-mono);
        font-size: 13px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* How far the thing reaches, which is the fact that decides whether an edit here is
         safe: a class used by nine elements and a rule matching none are both worth
         knowing before typing a value, and neither is visible from the name. */
      .tally {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
        height: 18px;
        padding: 0 7px;
        border-radius: 999px;
        background: var(--heo-hover);
        color: var(--heo-text-dim);
        font-size: 9.5px;
        font-variant-numeric: tabular-nums;
      }
      .tally.live {
        background: color-mix(in oklab, var(--heo-success) 20%, transparent);
        color: color-mix(in oklab, var(--heo-success) 78%, var(--heo-text));
      }
      .tally.idle {
        background: color-mix(in oklab, var(--heo-warn) 18%, transparent);
        color: color-mix(in oklab, var(--heo-warn) 80%, var(--heo-text));
      }
      .dialog > header p {
        margin: 3px 0 0;
        color: var(--heo-text-dim);
        font-size: 11px;
        line-height: 1.5;
      }

      .pane {
        flex: 1 1 auto;
        min-height: 0;
        padding: 12px 16px;
        overflow-y: auto;
        background: var(--heo-sunken);
      }
      /* The borrowed card already sits inside this pane's box, so it does not need one of
         its own. Same neutralising the rule card does to the class card it wraps. */
      .pane > .cls,
      .pane > .rule {
        margin: 0;
      }

      footer {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        padding: 11px 16px 13px;
        border-top: 1px solid var(--heo-line);
      }
      footer .spacer {
        flex: 1 1 auto;
      }
      footer .hint {
        min-width: 0;
        font-size: 10.5px;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    /*
     * The registry counter is in here because this dialog is an editor, not a snapshot:
     * every committed declaration bumps it, and without it the card would keep rendering
     * the declarations the dialog opened with.
     */
    (s) => [s.styleEdit, s.registry, s.revision, s.selected] as const,
    shallowArrayEquals,
  );

  /**
   * Focus lands in the add-a-property field.
   *
   * The dialog exists because a composer's submit is a preamble to naming a property, so
   * that is where the caret belongs. Landing on the close button instead would make the
   * user's next act a click on something they can already see.
   */
  protected modal = new ModalController(this, { initialFocus: '.property-adder .input' });

  /**
   * The add-a-property draft, owned here rather than shared with the panel.
   *
   * The panel keeps its own card for the same class expanded underneath, and a shared
   * buffer would mirror every keystroke into it — two boxes filling in together, one of
   * them behind a backdrop.
   */
  @state() private newProperty = '';
  /** Set while a rule's selector is being rewritten from inside the dialog. */
  @state() private editingSelector: string | null = null;

  override render(): TemplateResult | typeof nothing {
    const open = this.state.value.styleEdit;
    if (!open) return nothing;
    const isClass = open.kind === 'class';

    return html`<div
      class="dialog surface"
      role="dialog"
      aria-modal="true"
      aria-labelledby="heo-style-dialog-title"
      @pointerdown=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: KeyboardEvent) => {
        /*
         * Held here for the reason the confirmation dialog documents: the page keymap is
         * behind an inert layer, but the engine's own capture handlers are not, and Escape
         * there deselects rather than closing this.
         *
         * A field that is doing something with Escape has already stopped it — the value
         * field swallows it to close its suggestion list and then to drop its draft — so
         * this only ever sees the press that really meant "I am finished here".
         */
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.#close();
      }}
    >
      <header>
        <span class="g">${icon(isClass ? 'blocks' : 'code', 14)}</span>
        <div class="who">
          <div class="title">
            <h2 id="heo-style-dialog-title" title=${isClass ? `.${open.name}` : open.name}>
              ${isClass ? `.${open.name}` : open.name}
            </h2>
            ${this.#renderTally(open.kind, open.name)}
          </div>
          <p>${this.#lede(open.kind, open.name, open.created)}</p>
        </div>
        <button
          class="btn icon ghost sm"
          type="button"
          aria-label="Close"
          title="Close"
          @click=${() => this.#close()}
        >
          ${icon('close', 12)}
        </button>
      </header>

      <div class="pane">${isClass ? this.#renderClass(open.name) : this.#renderRule(open.name)}</div>

      <footer>
        <p class="hint">
          ${isClass
        ? 'Changes apply to the page as you type, and undo takes them back.'
        : 'The rule applies to everything its selector matches, as you type.'}
        </p>
        <span class="spacer"></span>
        <button class="btn sm primary done" type="button" @click=${() => this.#close()}>
          ${icon('check', 12)} Done
        </button>
      </footer>
    </div>`;
  }

  /* ---------------------------------------------------------------------- */

  #renderClass(name: string): TemplateResult {
    const host = this.#classHost();
    const entry = this.editor.classes.get(name);
    // Undo can take the class away while its dialog is open. `renderUnknown` is already the
    // body for "nothing readable defines this", and it offers to define it again — which is
    // exactly the way back from an undo the user did not mean.
    if (!entry) return ClassEditor.renderUnknown(name, host);
    return ClassEditor.render(entry, {
      expanded: true,
      uses: this.editor.classes.usage().get(name) ?? 0,
      // Never called while bare, since the header that would call it is not rendered. Wired
      // to the close path anyway, so the card cannot end up collapsed with no way to reopen.
      onToggle: () => this.#close(),
      host,
      bare: true,
    });
  }

  #renderRule(selector: string): TemplateResult {
    const host = this.#ruleHost();
    const entry = this.editor.rules.get(selector);
    if (!entry) {
      return html`<p class="hint" style="margin:0">
        <code class="mono">${selector}</code> is no longer in the registry — an undo, or another
        surface, has removed it. Close this and create it again if that was not the intention.
      </p>`;
    }
    return RuleEditor.render(entry, {
      expanded: true,
      matches: this.editor.rules.matches().get(entry.selector) ?? 0,
      onToggle: () => this.#close(),
      host,
      bare: true,
    });
  }

  #classHost(): ClassEditorHost {
    return {
      engine: this.editor,
      // For token ranking and for Apply. Null is a valid answer: a class can be created with
      // nothing selected, and the editor drops both affordances rather than inventing a target.
      element: this.editor.selected,
      newProperty: this.newProperty,
      onNewProperty: (value) => {
        this.newProperty = value;
      },
      // Deleted from inside its own dialog, so there is nothing left for the dialog to edit.
      onRemoved: () => this.editor.closeStyleEditor(),
      onFocus: (property) => focusDeclaration(this.renderRoot, property),
    };
  }

  #ruleHost(): RuleEditorHost {
    return {
      engine: this.editor,
      element: this.editor.selected,
      newProperty: this.newProperty,
      onNewProperty: (value) => {
        this.newProperty = value;
      },
      onRemoved: () => this.editor.closeStyleEditor(),
      onFocus: (property) => focusDeclaration(this.renderRoot, property),
      editingSelector: this.editingSelector,
      onEditSelector: (next) => {
        this.editingSelector = next;
      },
      // The selector is the rule's identity, so a retarget moves what this dialog is about.
      // Without this the dialog would be left holding a name the registry no longer has.
      onRenamed: (_from, to) => {
        this.editingSelector = null;
        this.editor.retargetStyleEditor(to);
      },
      /*
       * No Apply and no Delete from inside the declaration list, matching the panel:
       * `RuleEditor` renders its own action row because "apply to selection" is meaningless
       * for a rule, which applies by matching rather than by being put on something.
       */
      actions: 'none',
    };
  }

  /** How far the thing reaches, for the chip beside the title. */
  #renderTally(kind: 'class' | 'rule', name: string): TemplateResult | typeof nothing {
    if (kind === 'rule') {
      const matches = this.editor.rules.matches().get(name) ?? 0;
      return html`<span
        class=${`tally ${matches > 0 ? 'live' : 'idle'}`}
        title=${matches > 0
          ? `Styling ${matches} element${matches === 1 ? '' : 's'} on this page`
          : 'Nothing on this page matches this selector'}
        >${matches > 0 ? `${matches}×` : '0×'}</span
      >`;
    }
    const uses = this.editor.classes.usage().get(name) ?? 0;
    if (!uses) return nothing;
    return html`<span
      class="tally"
      title=${`Worn by ${uses} element${uses === 1 ? '' : 's'} on this page`}
      >${uses}×</span
    >`;
  }

  /**
   * The one sentence under the title.
   *
   * It carries the fact the old toast carried — made, or already there — because that is the
   * difference between "add the first property" and "you are about to change something other
   * elements are already using", and the two want different care from the reader.
   */
  #lede(kind: 'class' | 'rule', name: string, created: boolean): string {
    if (kind === 'class') {
      if (created) {
        return 'Created in this session, and empty. Give it a property below, then apply it wherever you want it.';
      }
      const uses = this.editor.classes.usage().get(name) ?? 0;
      return uses > 1
        ? `Already in the design system. Editing it changes all ${uses} elements wearing it.`
        : 'Already in the design system, opened here rather than found in the list.';
    }
    if (created) {
      return 'A new rule. It starts applying the moment it declares something, to everything its selector matches.';
    }
    return 'This selector already had a rule, so this is that one rather than a second copy of it.';
  }

  /**
   * The way out, for the button, the close icon and Escape alike.
   *
   * Every value field in here commits 120ms after focus leaves it, and unmounting the dialog
   * cancels that timer — so typing a value and then pressing Done wrote it into the field's
   * draft and threw it away with the field. Flushing first is what makes the primary button
   * mean what it says.
   */
  #close(): void {
    for (const field of this.renderRoot.querySelectorAll<HeoValueField>('heo-value-field')) {
      field.commitNow();
    }
    this.editor.closeStyleEditor();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-style-dialog': HeoStyleDialog;
  }
}
