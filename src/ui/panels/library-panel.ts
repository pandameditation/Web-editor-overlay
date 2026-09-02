import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { acceptsChildren, isMutable, labelFor } from '../../core/dom.js';
import { INSERT_POSITION_LABELS, type InsertPosition } from '../../core/mutations.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { BlockKind, LibraryBlock } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { baseStyles } from '../theme.js';
import { PropForm } from './prop-form.js';
import '../controls/section.js';
import '../controls/segmented.js';


/**
 * The block library.
 *
 * Containers and components in one place because the distinction only matters at
 * insert time: a container is something you put things inside, a component is
 * something you configure. Both insert relative to the current selection, and a
 * block with props opens a form first so what lands on the page is already
 * configured.
 *
 * The author form is the interesting half. Paste HTML for a static block, or give
 * a tag name plus a module and the block registers a real custom element and
 * inserts that tag — which is how a Lit component gets into a page that has no
 * build step.
 */
@customElement('heo-library-panel')
export class HeoLibraryPanel extends HeoElement {
  static override styles = [
    baseStyles,
    PropForm.styles,
    css`
      :host {
        display: block;
        padding-bottom: 16px;
      }

      .top {
        display: grid;
        gap: 7px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .search {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 8px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .search input {
        flex: 1 1 auto;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--heo-text);
      }
      .search input:focus {
        outline: none;
      }
      .target {
        color: var(--heo-text-faint);
        font-size: 10.5px;
        line-height: 1.45;
      }
      .target code {
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
      }

      .group {
        padding: 10px 12px 4px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
        gap: 7px;
        padding: 0 12px;
      }
      .card {
        display: grid;
        gap: 6px;
        padding: 9px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-raised);
        color: var(--heo-text);
        text-align: left;
        cursor: pointer;
        /* Anchors the usage badge in the corner. */
        position: relative;
        /*
         * The card measures itself, so its own labels can react to how much room it got.
         *
         * Card width comes from how many auto-fill columns fit, not from anything a media
         * query could see — two cards in a narrow dock and three in a wide one are both
         * "the same viewport". Only the card knows.
         */
        container-type: inline-size;
        transition:
          border-color var(--heo-fast),
          background var(--heo-fast),
          transform var(--heo-fast);
      }
      .card:hover {
        border-color: var(--heo-accent-line);
        background: var(--heo-hover);
        transform: translateY(-1px);
      }
      .card .glyph {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 1px solid var(--heo-line);
        border-radius: 8px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
      }
      .card .name {
        font-size: 11.5px;
        font-weight: 550;
        line-height: 1.3;
      }
      .card .desc {
        color: var(--heo-text-faint);
        font-size: 10px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .card .foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 5px;
      }
      .card .kind {
        flex: 0 1 auto;
        overflow: hidden;
        color: var(--heo-text-faint);
        font-size: 9px;
        letter-spacing: 0.05em;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-transform: uppercase;
      }
      /*
       * How many of this block are on the page.
       *
       * In the corner rather than in the footer, because the footer is the row that runs out
       * of room: it carries the kind label and up to three actions, and a count wedged in
       * between them was the thing that pushed the label into an ellipsis. Up here it is out
       * of the way of both, and it reads as a property of the card rather than another
       * control among the buttons.
       */
      .card .uses {
        position: absolute;
        top: 7px;
        right: 7px;
        padding: 1px 5px;
        border-radius: 999px;
        background: var(--heo-accent-soft);
        color: var(--heo-accent);
        font-family: var(--heo-mono);
        font-size: 9px;
        line-height: 1.5;
      }

      /*
       * Two spellings of the kind, and the card picks whichever fits.
       *
       * "web component" beside three action buttons does not fit a 150px card, and an
       * ellipsised "web compo…" tells you less than "wc" does. The short forms are the ones the
       * insert menu already uses, so the two surfaces agree on the vocabulary.
       *
       * Three breakpoints rather than one, because the label is not what runs out of room — the
       * *row* is, and how much of it is left depends on how many actions the card carries. A
       * preset has one button and can spell "container" out at any width worth rendering; a
       * block with copies in the page has three and cannot. One threshold for all of them either
       * abbreviated cards that had the space or ellipsised ones that did not, so the count comes
       * up from the template and each case gets its own.
       */
      /*
       * The widths below are content-box, which is what a container query measures — a 149px
       * card with 9px padding and a 1px border queries as 129. Reasoning in card widths is the
       * easy mistake here and it silently abbreviates everything, since every threshold ends up
       * about twenty pixels too generous.
       *
       * Each is the longest label plus the buttons beside it: roughly 80px for "web component",
       * and 23px per action for an 18px button and its gap.
       */
      .card .kind .short {
        display: none;
      }
      @container (max-width: 100px) {
        .card[data-actions='1'] .kind .long {
          display: none;
        }
        .card[data-actions='1'] .kind .short {
          display: inline;
        }
      }
      @container (max-width: 124px) {
        .card[data-actions='2'] .kind .long {
          display: none;
        }
        .card[data-actions='2'] .kind .short {
          display: inline;
        }
      }
      @container (max-width: 148px) {
        .card[data-actions='3'] .kind .long {
          display: none;
        }
        .card[data-actions='3'] .kind .short {
          display: inline;
        }
      }
      .card .kill {
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--heo-text-faint);
        cursor: pointer;
        padding: 0;
      }
      .card .kill:hover {
        color: var(--heo-danger);
        background: var(--heo-line-strong);
      }

      .configure {
        margin: 10px 12px 0;
        padding: 10px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-md);
        background: var(--heo-sunken);
      }
      .configure header {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 9px;
      }
      .configure header .n {
        flex: 1 1 auto;
        font-size: 12px;
        font-weight: 550;
      }
      .configure .actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 10px;
      }

      .author {
        display: grid;
        gap: 8px;
      }
      .author .two {
        display: grid;
        grid-template-columns: 1fr 108px;
        gap: 6px;
      }
      .tabs {
        display: flex;
        gap: 2px;
        margin-bottom: 2px;
      }
      .tabs button {
        height: 24px;
        padding: 0 9px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--heo-text-faint);
        font-size: 11px;
        cursor: pointer;
      }
      .tabs button:hover {
        color: var(--heo-text);
        background: var(--heo-hover);
      }
      .tabs button[aria-selected='true'] {
        background: var(--heo-accent-soft);
        color: var(--heo-text);
      }

      .editing-banner {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 6px 8px;
        border: 1px solid var(--heo-accent-line);
        border-radius: var(--heo-r-sm);
        background: var(--heo-accent-soft);
        color: var(--heo-text-dim);
        font-size: 11px;
      }
      .editing-banner span {
        flex: 1 1 auto;
      }
      .save-error {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 0;
        color: var(--heo-danger);
        font-size: 11px;
        line-height: 1.45;
      }
      .tagfix {
        margin: 0;
        color: var(--heo-warn);
      }
      .card .foot .kill + .kill {
        margin-left: 2px;
      }

      /* The same gutter as the cards above it, so the button lines up with their left edge
         instead of sitting against the panel wall. */
      .makerow {
        display: flex;
        padding: 12px 12px 0;
      }
    `,
  ];

  protected state = new StoreController(
    this,
    this.editor.store,
    // `revision` as well as `registry`: the instance counts on the cards move when the page
    // changes, not when the library does, so without it a block inserted or deleted left its
    // card claiming the old number.
    (s) => [s.selected, s.registry, s.insertAnchor, s.revision] as const,
    shallowArrayEquals,
  );

  @state() private query = '';
  @state() private kind: BlockKind | 'all' = 'all';
  @state() private position: InsertPosition = 'after';
  @state() private configuring: LibraryBlock | null = null;
  @state() private props: Record<string, string> = {};

  /**
   * How many of each block are in the page, for the run of cards about to be drawn.
   *
   * Filled at the top of `render` and read by `#renderCard`. Not `@state`: it is derived from
   * the page on the way past, so setting it must not schedule another render.
   */
  #usage = new Map<string, number>();

  override render(): TemplateResult {
    const selected = this.editor.selected;
    const blocks = this.#visibleBlocks();
    const groups = groupBy(blocks);
    // Counted once for the whole library rather than once per card: this method runs on every
    // page revision, and a query per block would scale with the library for no reason.
    this.#usage = this.editor.blockUsage();

    return html`
      <div class="top">
        <div class="search">
          ${icon('search', 13)}
          <input
            type="text"
            placeholder="Search blocks…"
            .value=${this.query}
            spellcheck="false"
            aria-label="Search blocks"
            @input=${(event: Event) => {
        this.query = (event.target as HTMLInputElement).value;
      }}
          />
        </div>
        <heo-segmented
          .options=${[
        { value: 'all', label: 'All' },
        { value: 'container', label: 'Containers' },
        { value: 'component', label: 'Components' },
      ]}
          .value=${this.kind}
          label="Block kind"
          @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.kind = (event.detail.value || 'all') as BlockKind | 'all';
      }}
        ></heo-segmented>
        ${this.#renderTarget(selected)}
      </div>

      ${this.configuring ? this.#renderConfigure(this.configuring) : nothing}

      ${groups.length === 0
        ? html`<div class="empty">
            <p style="margin:0 0 9px">
              ${this.query.trim()
            ? html`Nothing matches <strong>${this.query}</strong>.`
            : html`No block here yet.`}
            </p>
            ${this.#renderCreateButton()}
          </div>`
        : html`${groups.map(
          (group) => html`
                <div class="group">${group.name}</div>
                <div class="cards">
                  ${repeat(
            group.blocks,
            (block) => block.id,
            (block) => this.#renderCard(block),
          )}
                </div>
              `,
        )}
            <!-- After the last card as well as on an empty result: looking through the
                 library and not finding the thing is exactly when someone decides to
                 build it. -->
            <div class="makerow">${this.#renderCreateButton()}</div>`}
    `;
  }

  /* ---------------------------------------------------------------------- */

  #renderTarget(selected: HTMLElement | null): TemplateResult {
    if (!selected) {
      return html`<p class="target">
        Nothing selected, so blocks are appended to the end of <code>body</code>.
      </p>`;
    }
    const canNest = acceptsChildren(selected);
    const canReplace = isMutable(selected);
    // A position that no longer applies to the new selection would silently insert
    // somewhere unexpected, so fall back rather than keep it.
    if (this.position === 'lastChild' && !canNest) this.position = 'after';
    if (this.position === 'replace' && !canReplace) this.position = 'after';

    return html`
      <heo-segmented
        .options=${[
        { value: 'before', label: 'Before' },
        { value: 'after', label: 'After' },
        ...(canNest ? [{ value: 'lastChild', label: 'Inside' }] : []),
        ...(canReplace ? [{ value: 'replace', label: 'Replace' }] : []),
      ]}
        .value=${this.position}
        label="Insert position"
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.position = (event.detail.value || 'after') as InsertPosition;
      }}
      ></heo-segmented>
      <p class="target">
        ${this.position === 'replace'
        ? html`Replacing <code>${labelFor(selected)}</code> and everything inside it`
        : html`Inserting ${INSERT_POSITION_LABELS[this.position]}
            <code>${labelFor(selected)}</code>`}
      </p>
    `;
  }

  #renderCard(block: LibraryBlock): TemplateResult {
    const removable = block.origin !== 'preset';
    /*
     * Counted, never drift-tested.
     *
     * Drift is a clone-and-serialize per instance, which across a library of twenty blocks
     * would be a markup diff of the whole page to decide whether to draw a badge — on every
     * revision. So the card offers the action whenever there is anything at all to act on, and
     * the action itself is what reports having found nothing out of date.
     */
    const placed = this.#usage.get(block.id) ?? 0;
    // Edit always; update only when there is something to update; delete only when it is not a
    // preset. How many of them there are decides how much room the kind label has, which the
    // stylesheet reads back off this attribute.
    const actions = 1 + (placed ? 1 : 0) + (removable ? 1 : 0);
    return html`<button
      class="card"
      type="button"
      data-actions=${String(actions)}
      title=${block.description ?? block.name}
      @click=${() => this.#pick(block)}
    >
      <span class="glyph">${icon(block.icon ?? (block.kind === 'container' ? 'wrap' : 'blocks'), 15)}</span>
      ${placed
        ? html`<span class="uses" title=${`${placed} in the page`}>${placed}×</span>`
        : nothing}
      <span class="name">${block.name}</span>
      <span class="desc">${block.description ?? ''}</span>
      <span class="foot">
        <span class="kind" title=${kindOf(block).long}>
          <span class="long">${kindOf(block).long}</span>
          <span class="short">${kindOf(block).short}</span>
        </span>
        ${placed
        ? html`<span
              class="kill"
              role="button"
              tabindex="0"
              aria-label=${`Update every ${block.name} in the page`}
              title=${`Update the markup of the ${placed === 1 ? 'copy' : `${placed} copies`} in the page, keeping the text in each`}
              @click=${(event: Event) => {
            event.stopPropagation();
            this.#syncAll(block, placed);
          }}
              @keydown=${(event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.stopPropagation();
            this.#syncAll(block, placed);
          }}
              >${icon('refresh', 11)}</span
            >`
        : nothing}
        <span
          class="kill"
          role="button"
          tabindex="0"
          aria-label=${`Edit ${block.name}`}
          title="Inspect and edit this block"
          @click=${(event: Event) => {
        event.stopPropagation();
        this.editor.beginBlockEdit(block.id);
      }}
          @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        event.stopPropagation();
        this.editor.beginBlockEdit(block.id);
      }}
          >${icon('sliders', 11)}</span
        >
        ${removable
        ? html`<span
              class="kill"
              role="button"
              tabindex="0"
              aria-label=${`Delete ${block.name}`}
              @click=${(event: Event) => {
            event.stopPropagation();
            this.#remove(block);
          }}
              @keydown=${(event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.stopPropagation();
            this.#remove(block);
          }}
              >${icon('trash', 11)}</span
            >`
        : nothing}
      </span>
    </button>`;
  }

  #renderConfigure(block: LibraryBlock): TemplateResult {
    return html`<div class="configure">
      <header>
        ${icon(block.icon ?? 'blocks', 14)}
        <span class="n">${block.name}</span>
        <button
          class="btn icon ghost sm"
          type="button"
          aria-label="Cancel"
          @click=${() => {
        this.configuring = null;
      }}
        >
          ${icon('close', 12)}
        </button>
      </header>
      ${PropForm.render(
        block.props ?? {},
        this.props,
        (name, value) => {
          this.props = { ...this.props, [name]: value };
        },
        this.editor,
        // As in the insert popover: Insert must see what is on screen, not what was
        // last committed by a blur.
        {
          onInput: (name, value) => {
            this.props = { ...this.props, [name]: value };
          },
        },
      )}
      <div class="actions">
        <button
          class="btn"
          type="button"
          @click=${() => {
        this.configuring = null;
      }}
        >
          Cancel
        </button>
        <button class="btn primary" type="button" @click=${() => void this.#insert(block)}>
          ${icon('plus', 12)} Insert
        </button>
      </div>
    </div>`;
  }

  /**
   * Start a block from the list, seeded with whatever was being searched for.
   *
   * The panel used to carry its own copy of the authoring form in a collapsible
   * section, so there were two forms for one job — and the one reached from an element
   * could not express half of what a block can hold. There is one dialog now, and both
   * this and a card's edit action are ways into it.
   */
  #renderCreateButton(): TemplateResult {
    const seed = this.query.trim();
    return html`<button
      class="btn sm"
      type="button"
      title="Author a new block"
      @click=${() => this.editor.beginBlockDraft(seed, this.kind === 'all' ? 'component' : this.kind)}
    >
      ${icon('plus', 12)} ${seed ? `Create "${seed}"` : 'Create a block'}
    </button>`;
  }

  #visibleBlocks(): LibraryBlock[] {
    const found = this.editor.library.search(this.query);
    return this.kind === 'all' ? found : found.filter((block) => block.kind === this.kind);
  }

  #pick(block: LibraryBlock): void {
    if (block.props && Object.keys(block.props).length) {
      this.props = this.editor.library.defaultProps(block);
      this.configuring = block;
      return;
    }
    void this.#insert(block);
  }

  async #insert(block: LibraryBlock): Promise<void> {
    const selected = this.editor.selected;
    const anchor = selected
      ? { reference: selected, position: this.position }
      : { reference: document.body, position: 'lastChild' as InsertPosition };
    await this.editor.insertBlock(block, this.props, anchor);
    this.configuring = null;
  }

  /**
   * Update every copy in the page, once the user has seen the number.
   *
   * The one action here that reaches out and rewrites parts of the page the user is not looking
   * at. It is undoable in one step, so this is not a safety net — it is the count. "Update the
   * blocks in the page" is a different proposition at one copy and at fourteen, and the button
   * cannot say which it is until it is asked.
   */
  #syncAll(block: LibraryBlock, placed: number): void {
    this.editor.askToConfirm({
      title: `Update ${placed === 1 ? 'one copy' : `all ${placed} copies`} of ${block.name}?`,
      message:
        'Each copy takes this template’s markup — its tags, classes and any element added to it — and keeps the text written into it.',
      detail:
        placed === 1
          ? 'Styling and attributes set on that copy are replaced by the template’s.'
          : `Styling and attributes set on any of the ${placed} are replaced by the template’s.`,
      confirmLabel: placed === 1 ? 'Update it' : `Update ${placed}`,
      tone: 'warn',
      reversible: true,
      run: () => void this.editor.syncBlockInstances(block.id),
    });
  }

  /**
   * Delete a block, once the user has seen what it would cost.
   *
   * Undoable now, which is the bigger half of the fix — but still worth asking about, because a
   * block is the most expensive thing in this panel to recreate and the button that deletes one
   * sits two pixels from the button that edits it. The copies already in the page are the part
   * people assume is at stake, so the dialog says outright that they are not.
   */
  #remove(block: LibraryBlock): void {
    const placed = this.#usage.get(block.id) ?? 0;
    this.editor.askToConfirm({
      title: `Delete the ${block.name} block?`,
      message:
        'It goes out of the library, so it cannot be inserted again or used to update anything.',
      detail: placed
        ? `The ${placed === 1 ? 'copy' : `${placed} copies`} already in the page ${placed === 1 ? 'stays' : 'stay'} exactly as ${placed === 1 ? 'it is' : 'they are'} — ${placed === 1 ? 'it' : 'they'} just ${placed === 1 ? 'stops' : 'stop'} being linked to a template.`
        : undefined,
      confirmLabel: 'Delete it',
      tone: 'danger',
      reversible: true,
      run: () => {
        this.editor.removeBlock(block.id);
      },
    });
  }

}

/**
 * What kind of thing a block is, spelled out and abbreviated.
 *
 * Both, because the card cannot know in advance which one will fit — a container query picks
 * at layout time. The short forms are the insert menu's own (`insert-menu.ts` labels its rows
 * `box` and `cmp`), so the two places a block is described do not invent separate vocabularies
 * for the same distinction.
 */
function kindOf(block: LibraryBlock): { long: string; short: string } {
  if (block.element) return { long: 'web component', short: 'wc' };
  return block.kind === 'container'
    ? { long: 'container', short: 'box' }
    : { long: 'component', short: 'cmp' };
}

function groupBy(blocks: LibraryBlock[]): Array<{ name: string; blocks: LibraryBlock[] }> {
  const groups: Array<{ name: string; blocks: LibraryBlock[] }> = [];
  for (const block of blocks) {
    const name = block.category ?? (block.kind === 'container' ? 'Layout' : 'Components');
    const existing = groups.find((group) => group.name === name);
    if (existing) existing.blocks.push(block);
    else groups.push({ name, blocks: [block] });
  }
  return groups;
}

declare global {
  interface HTMLElementTagNameMap {
    'heo-library-panel': HeoLibraryPanel;
  }
}
