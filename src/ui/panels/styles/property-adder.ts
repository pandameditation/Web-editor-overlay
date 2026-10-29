import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { EDITABLE_STATES } from '../../../core/breakpoints.js';
import { searchProperties } from '../../../core/css.js';
import { checkDeclaration } from '../../../core/declarations.js';
import type { AddDestination } from '../../../core/save-plan.js';
import { field } from '../../form-errors.js';
import { icon } from '../../icons.js';
import type { ClassEditorHost } from '../class-editor.js';
import { focusWhenOpened, renderMenu } from './menu.js';

/**
 * The one "add a property" control.
 *
 * Every surface that lists declarations ends with one: a class or a rule in Tokens, the style
 * dialog, the Styles panel's blocks and cards. Naming a property is the same interaction in all of
 * them (validate the name, seed a useful value, write it through the owner's normal path, put the
 * caret in the new value), so it is one function. Three editors with three copies used to disagree
 * about what could be added and where focus went afterwards.
 *
 * What differs is data: where the declaration can go (one destination or several), whether the row
 * waits behind a quiet "+ Add property" button, and what value a new property starts with.
 */

/** What the adder needs from its host: the draft, where its errors go, and how to focus a field. */
export type AdderHost = Pick<
  ClassEditorHost,
  'engine' | 'newProperty' | 'onNewProperty' | 'form' | 'onFocus'
>;

/** One place a new declaration can be written. */
export interface AdderDestination {
  /** Stable within one adder, and unique in it: what `selected` and `onPick` name. */
  key: string;
  /** Chip and menu text: `inline style`, `.card ≤767px`, `a new class`. */
  label: string;
  /** How far it reaches: `this element only, every size`, `4 elements`. */
  reach: string;
  /**
   * What `engine.addDeclaration` receives.
   *
   * Absent for Tokens, the rule editor and the style dialog: their card is the destination, and
   * their commit writes through the card's own target. Optional for exactly that reason, so no
   * placeholder destination ever has to be invented. Styles destinations are built with
   * `stylesDestination`, whose parameter is required.
   */
  dest?: AddDestination;
  /** Declarations already there, so a duplicate is refused with today's message. */
  existing: Record<string, string>;
  /** How validation messages name the owner: `this element`, `.card`. */
  ownerLabel: string;
}

export interface AdderSpec {
  /** Unique in the shadow root; also the `data-declarations` list the new field is focused in. */
  id: string;
  mode: 'property' | 'state';
  /** At least one; the first is the default. */
  destinations: readonly AdderDestination[];
  /** The picked destination's key; the first destination when absent. */
  selected?: string;
  /**
   * Collapsed behind "+ Add property" until opened (the Styles panel), or always open (Tokens).
   *
   * Always-open is today's Tokens row: no cancel and no destination line, because the card it sits
   * in is the destination.
   */
  disclosure: boolean;
  /** Whether a disclosure adder is open. Owned by the host, so only one is open at a time. */
  open?: boolean;
  /** Whether the destination menu is open. Owned by the host. */
  menuOpen?: boolean;
  onOpen?(): void;
  onCancel?(): void;
  onPick?(key: string): void;
  onMenu?(open: boolean): void;
  /** The value a new property starts with at this destination. */
  seed(property: string, dest: AdderDestination): string;
  /**
   * Write it. In state mode `property` is the state (`:hover`, `::before`) and `value` is empty: the
   * host decides what a new state block needs.
   */
  commit(property: string, value: string, dest: AdderDestination): void;
}

/**
 * A Styles destination. The only way the Styles panel builds one, so a destination without an
 * `AddDestination` cannot reach `engine.addDeclaration` from there.
 */
export function stylesDestination(
  label: string,
  reach: string,
  dest: AddDestination,
  existing: Record<string, string>,
  ownerLabel: string,
): AdderDestination {
  // Keyed by what the user picks between: two destinations an adder offers never share a label,
  // since the menu could not tell them apart either.
  return { key: `${dest.kind}:${label}`, label, reach, dest, existing, ownerLabel };
}

/** The state list offered while adding a state or pseudo-element. */
function knownState(text: string): string | null {
  const name = text.trim().startsWith(':') ? text.trim() : `:${text.trim()}`;
  return EDITABLE_STATES.some((state) => state.name === name) ? name : null;
}

export function renderAdder(spec: AdderSpec, host: AdderHost): TemplateResult {
  const state = spec.mode === 'state';
  const label = state ? 'Add state or pseudo-element' : 'Add property';
  if (spec.disclosure && !spec.open) {
    return html`<button
      class="add-prop"
      type="button"
      data-heo-part="adder"
      data-adder=${spec.id}
      @click=${() => spec.onOpen?.()}
    >
      ${icon('plus', 12)} ${label}
    </button>`;
  }

  const dest =
    spec.destinations.find((one) => one.key === spec.selected) ?? spec.destinations[0];
  const listId = `heo-${state ? 'states' : 'props'}-${spec.id}`;
  const name = `prop-add-${spec.id}`;

  const cancel = (): void => {
    host.onNewProperty('');
    spec.onCancel?.();
  };

  /**
   * Add it. `left` is a commit made by leaving the field, which reports a problem without pulling
   * focus back into it; Enter and the button do take the user there.
   */
  const commit = (left = false): void => {
    const typed = host.newProperty.trim();
    if (state) {
      if (!typed) {
        if (!left) host.form.fail(name, 'Type a state like :hover or a pseudo-element like ::before.');
        return;
      }
      const known = knownState(typed);
      if (!known) {
        const shown = typed.startsWith(':') ? typed : `:${typed}`;
        host.form.fail(name, `${shown} is not a state or pseudo-element the editor knows.`, {
          focus: !left,
        });
        return;
      }
      host.onNewProperty('');
      spec.commit(known, '', dest);
      return;
    }
    if (!typed) {
      if (!left) host.form.fail(name, 'Type the property to add.');
      return;
    }
    const verdict = checkDeclaration({
      property: host.newProperty,
      existing: dest.existing,
      label: dest.ownerLabel,
    });
    if (verdict.refusal || !verdict.property) {
      // Kept in the field, so the name can be corrected rather than retyped.
      host.form.fail(name, verdict.refusal ?? 'That is not a property name.', { focus: !left });
      return;
    }
    host.onNewProperty('');
    if (verdict.advice) host.engine.notify(verdict.advice, 'warn');
    spec.commit(verdict.property, spec.seed(verdict.property, dest), dest);
    // The new field appears on the render scheduled by the commit, in this list rather than in
    // whichever other list on screen happens to declare the same property.
    host.onFocus?.(verdict.property, spec.id);
  };

  const several = spec.destinations.length > 1;
  // Opened from "+ Add property", the adder is its own framed box with the field across it, the
  // same under an Effective group as inside a card. The "add" label only fills a card's name
  // column in the always-open Tokens row; outside a card it rendered as a stray line of text.
  return html`
    <div
      class="decl property-adder ${spec.disclosure ? 'framed' : ''}"
      data-heo-part="adder"
      data-adder=${spec.id}
    >
      ${spec.disclosure ? nothing : html`<span class="p">add</span>`}
      <div class="pair">
        <input
          ${field(host.form, name)}
          ${spec.disclosure ? ref(focusWhenOpened) : nothing}
          class="input mono"
          type="text"
          list=${listId}
          placeholder=${state ? ':hover, ::before…' : 'property'}
          .value=${host.newProperty}
          spellcheck="false"
          aria-label=${state ? 'New state or pseudo-element' : 'New property'}
          @input=${(event: Event) => host.onNewProperty((event.target as HTMLInputElement).value)}
          @keydown=${(event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
        return;
      }
      // Escape backs out of an adder that can be closed, and goes no further: the global
      // keymap would otherwise take it as "deselect".
      if (event.key === 'Escape' && spec.disclosure) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      // Tab means "done here", so confirm on the way out rather than discarding the draft.
      if (event.key === 'Tab' && !event.shiftKey && host.newProperty.trim()) {
        event.preventDefault();
        commit();
      }
    }}
          @blur=${() => {
      if (host.newProperty.trim()) commit(true);
    }}
        />
        <button
          class="confirm"
          type="button"
          title=${state ? 'Add this state or pseudo-element' : 'Add this property'}
          aria-label=${state ? 'Add this state or pseudo-element' : 'Add this property'}
          @pointerdown=${(event: Event) => event.preventDefault()}
          @click=${() => commit()}
        >
          ${icon('check', 12)}
        </button>
        ${spec.disclosure
      ? html`<button
              class="cancel"
              type="button"
              title="Cancel"
              aria-label="Cancel"
              @pointerdown=${(event: Event) => event.preventDefault()}
              @click=${cancel}
            >
              ${icon('close', 11)}
            </button>`
      : nothing}
      </div>
      ${host.form.error(name)}
      ${spec.disclosure
      ? html`<p class="dest">
            in
            ${several
          ? html`<button
                  class="chip"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded=${spec.menuOpen ? 'true' : 'false'}
                  data-menu-anchor=${`dest-${spec.id}`}
                  title="Choose where to write it"
                  @pointerdown=${(event: Event) => event.preventDefault()}
                  @click=${() => spec.onMenu?.(!spec.menuOpen)}
                >
                  ${dest.label} ${icon('chevronDown', 10)}
                </button>`
          : html`<span class="chip fixed">${dest.label}</span>`}
            ${dest.reach ? html`<span class="reach">· ${dest.reach}</span>` : nothing}
          </p>`
      : nothing}
      ${several && spec.menuOpen
      ? renderMenu({
        id: `dest-${spec.id}`,
        label: 'Write it in',
        groups: [{
          caption: 'Write it in',
          items: spec.destinations.map((one) => ({
            key: one.key,
            label: one.label,
            note: one.reach,
            checked: one.key === dest.key,
            onSelect: () => {
              spec.onPick?.(one.key);
              spec.onMenu?.(false);
            },
          })),
        }],
        onClose: () => spec.onMenu?.(false),
      })
      : nothing}
      <datalist id=${listId}>
        ${state
      ? EDITABLE_STATES.map(
        (one) => html`<option value=${one.name}>${one.kind === 'state' ? 'state' : 'pseudo-element'}</option>`,
      )
      : searchProperties(host.newProperty, 20).map(
        (meta) => html`<option value=${meta.name}></option>`,
      )}
      </datalist>
    </div>
  `;
}

/**
 * The adder's look. Unscoped, so it works inside a card and on its own under a block.
 *
 * The confirm button keeps the accent look every adder in the overlay has; the destination line is
 * plain text with the destination as a chip, so where the declaration goes is read before it is
 * written.
 */
export const adderRowStyles: CSSResult = css`
  .property-adder .pair {
    display: flex;
    grid-column: 2 / -1;
    gap: 4px;
    min-width: 0;
  }
  .property-adder .pair .input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .property-adder .field-error,
  .property-adder .dest {
    grid-column: 1 / -1;
  }
  /* Opened from "+ Add property": one column in a framed box, wherever it sits. Three classes so
     it wins over a card's name-and-value row grid. */
  .decl.property-adder.framed {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 5px;
    margin-top: 2px;
    padding: 7px;
    border: 1px solid var(--heo-accent-line);
    border-radius: var(--heo-r-md);
    background: color-mix(in oklab, var(--heo-accent) 6%, var(--heo-sunken));
  }
  .property-adder.framed .pair {
    grid-column: 1 / -1;
  }
  .property-adder .confirm {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 28px;
    border: 1px solid var(--heo-accent-line);
    border-radius: var(--heo-r-sm);
    background: var(--heo-accent-soft);
    color: var(--heo-accent);
    cursor: pointer;
    padding: 0;
    transition:
      background var(--heo-fast),
      color var(--heo-fast);
  }
  .property-adder .confirm:hover:not(:disabled) {
    background: var(--heo-accent);
    color: var(--heo-accent-ink);
  }
  .property-adder .confirm:disabled {
    border-color: var(--heo-line);
    background: transparent;
    color: var(--heo-text-disabled);
    cursor: not-allowed;
  }
  .property-adder .cancel,
  .add-prop,
  .property-adder .chip {
    border: 0;
    background: transparent;
    color: var(--heo-text-dim);
    cursor: pointer;
  }
  .property-adder .cancel {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 26px;
    padding: 0;
    border-radius: var(--heo-r-sm);
  }
  .property-adder .cancel:hover,
  .add-prop:hover {
    background: var(--heo-hover);
    color: var(--heo-text);
  }
  /* Collapsed: a quiet text button after the block it adds to. */
  .add-prop {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 6px;
    margin-left: -6px;
    border-radius: var(--heo-r-sm);
    font-size: 11px;
  }
  .property-adder .dest {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 10.5px;
  }
  .property-adder .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    padding: 0 4px 0 7px;
    border: 1px solid var(--heo-line-strong);
    border-radius: 999px;
    background: var(--heo-raised);
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10.5px;
  }
  .property-adder .chip:hover {
    border-color: var(--heo-accent-line);
  }
  .property-adder .chip.fixed {
    padding-right: 7px;
    background: transparent;
    cursor: default;
  }
  .add-prop:focus-visible,
  .property-adder .cancel:focus-visible,
  .property-adder .confirm:focus-visible,
  .property-adder .chip:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
`;
