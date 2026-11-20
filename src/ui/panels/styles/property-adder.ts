import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { mediaLabel } from '../../../core/breakpoints.js';
import type { Place, placeOutcome } from '../../../core/cascade-places.js';
import type { Contribution } from '../../../core/cascade.js';
import { searchProperties } from '../../../core/css.js';
import { splitImportant } from '../../../core/declaration-list.js';
import { checkDeclaration, normalizeProperty } from '../../../core/declarations.js';
import { reachText, type AddDestination } from '../../../core/save-plan.js';
import type { HeoValueField, ValueSuggestion } from '../../controls/value-field.js';
import { framedBox } from '../../theme.js';
import { field } from '../../form-errors.js';
import { icon } from '../../icons.js';
import { buildSuggestions, valueKindFor } from '../../suggestions.js';
import type { ClassEditorHost } from '../class-editor.js';
import { renderLadder, renderResult, type LadderSpec } from './ladder.js';
import { renderPromote } from './promote.js';

/**
 * The one "add a property" control.
 *
 * Every surface that lists declarations ends with one: a class or a rule in Tokens, the style
 * dialog, the Styles panel's blocks and cards. Adding is the same interaction in all of them, and
 * it is a declaration row being written: the property's name, with a list of names, then its value
 * in the value field every row has. Nothing is written until the value is confirmed, with ✓ or
 * Enter, so a new property arrives as one undo entry with the value the user meant. A whole
 * declaration typed or pasted into the name (`color: blue`) is written at once.
 *
 * Where it goes is the value's question, not the name's. A card or a Tokens rule is its own
 * destination. The Styles panel's element adders (`places`) can write to several, and their value
 * step is the cascade ladder the rows' menus use, with the value field in the picked rung.
 */

/** What the adder needs from its host: the draft, where its errors go, and the element. */
export type AdderHost = Pick<
  ClassEditorHost,
  'engine' | 'element' | 'newProperty' | 'onNewProperty' | 'form'
>;

/** One place a new declaration can be written. */
export interface AdderDestination {
  /** Stable within one adder, and unique in it: what `selected` and `onPick` name. */
  key: string;
  /** Validation and notices name it so: `inline style`, `.card ≤767px`, `a new class`. */
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

/**
 * The Styles panel's element adders: every place the property can go, as the cascade ladder lists
 * them for the property being added (`cascade-places.ts`), and what a value at each would do.
 */
export interface AdderPlaces {
  /** Strongest first, as `placesFor` returns them. */
  list: readonly Place[];
  /** Declarations whose media does not apply under the condition, listed under the rungs. */
  inactive: readonly Contribution[];
  /** The card the property shows in once written (`Typography`), for the hint beside its name. */
  owner?: string;
  /** The rung picked until another is: the default place for a new declaration (decision 8). */
  fallback: string;
  outcome(place: Place, important: boolean): ReturnType<typeof placeOutcome>;
}

export interface AdderSpec {
  /** Unique in the shadow root; also the `data-declarations` list the new row lands in. */
  id: string;
  /** A single-destination adder's one destination (the first is used); empty with `places`. */
  destinations: readonly AdderDestination[];
  /** The picked destination's key (a place key with `places`); the default when absent. */
  selected?: string;
  /**
   * Collapsed behind "+ Add property" until opened (the Styles panel), or always open (Tokens).
   * Always-open is today's Tokens row: no cancel, because the card it sits in is the destination.
   */
  disclosure: boolean;
  /** Whether a disclosure adder is open. Owned by the host, so only one is open at a time. */
  open?: boolean;
  /**
   * The places for a property, when the adder can write to several: its value step is the ladder,
   * and `destinations` is not read.
   */
  places?(property: string): AdderPlaces;
  /** The ladder's new-class name field, the cascade menu's own (with `places`). */
  newClass?: LadderSpec['newClass'];
  /** `!important` asked for in the ladder's picked rung, before the value is written. */
  important?: boolean;
  onImportant?(next: boolean): void;
  onOpen?(): void;
  onCancel?(): void;
  onPick?(key: string): void;
  /** The value a new property starts with at this destination. */
  seed(property: string, dest: AdderDestination): string;
  /** Write it. */
  commit(property: string, value: string, dest: AdderDestination): void;
  /** Paint a value being typed, and take it back. */
  preview?(property: string, value: string, dest: AdderDestination): void;
  revert?(): void;
  /** What the browser resolves the property to on the element, for the value list's first row. */
  computed?(property: string): string;
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
  // Keyed by what the user picks between: two destinations an adder offers never share a label.
  return { key: `${dest.kind}:${label}`, label, reach, dest, existing, ownerLabel };
}

/** A ladder rung as the destination the commit, the preview and the duplicate check read. */
function placeDestination(place: Place): AdderDestination {
  const inline = place.key === 'inline';
  const label = inline ? 'inline style' : `${place.label}${place.media ? ` ${mediaLabel(place.media)}` : ''}`;
  return {
    key: place.key,
    label,
    reach: reachText(place.reach),
    dest: place.dest,
    existing: place.existing,
    ownerLabel: inline ? 'this element' : label,
  };
}

/**
 * The draft, as the host keeps it: the name being typed, or the name confirmed and the value step
 * open, with the value it opened with and what has been typed since. One string, so every host
 * that already stores the draft stores this too.
 */
const STEP = '\u0000';
function readDraft(draft: string): { property: string | null; text: string; typed: string | null } {
  if (!draft.startsWith(STEP)) return { property: null, text: draft, typed: null };
  const [property = '', text = '', typed] = draft.slice(1).split(STEP);
  return { property, text, typed: typed ?? null };
}
/** The host draft for the value step of `property`, opening with `value` (the seed when empty). */
export function valueStepDraft(property: string, value = ''): string {
  return `${STEP}${property}${STEP}${value}`;
}
/** The value step with `typed` in its field: what ✓ writes, and what a re-opened field shows. */
function typedDraft(property: string, opened: string, typed: string): string {
  return `${valueStepDraft(property, opened)}${STEP}${typed}`;
}

/** `color: blue;`, `color:blue !important`: a name and a value, or null when it is only a name. */
function splitDeclaration(text: string): { property: string; value: string } | null {
  const match = /^\s*([^:;]+?)\s*:\s*([^;]*?)\s*;?\s*$/.exec(text);
  return match ? { property: match[1], value: match[2] } : null;
}

/** Whether the browser takes `value` for `property`, a token reference or `!important` included. */
function acceptsValue(property: string, value: string): boolean {
  const bare = splitImportant(value).value;
  if (!bare) return false;
  if (bare.includes('var(--')) return true;
  try {
    // A property this browser does not know is still written (the name check said so out loud):
    // its values cannot be checked here either.
    if (!CSS.supports(property, 'initial')) return true;
    return CSS.supports(property, bare);
  } catch {
    return false;
  }
}

/** The name list: property names matching what is typed, each with what it styles. */
function nameSuggestions(text: string): ValueSuggestion[] {
  const typed = text.trim().toLowerCase();
  // The name typed in full first: `border` before `border-radius`.
  const found = searchProperties(text, 30).sort((a, b) => Number(b.name === typed) - Number(a.name === typed));
  return found.map((meta) => ({
    value: meta.name,
    label: meta.name,
    hint: meta.group,
    group: 'Properties',
  }));
}

/** Value fields Enter was pressed in, so the commit that follows is a confirmation. */
const entered = new WeakSet<Element>();
/** Value fields being confirmed because their surface is closing (`flushAdderField`). */
const flushing = new WeakSet<Element>();
/** A field focuses (and the value step seeds) once per mount: later renders leave it alone. */
const mounted = new WeakSet<Element>();
/** Adders whose rung was just moved by an arrow key: focus stays on the rung, not the new field. */
const keyboardPicked = new Set<string>();
/** Where the last key pressed in an adder was, so an arrow-key pick can put focus back there. */
let keyRoot: ParentNode | null = null;
/** Focus the name field the moment it appears, with what it opened with selected. */
function focusNameField(el?: Element): void {
  if (!el || mounted.has(el)) return;
  mounted.add(el);
  requestAnimationFrame(() => (el as HeoValueField).focusInput?.({ select: true }));
}
/** The value field an event came from, through the shadow roots it crossed. */
function fieldOf(event: Event): HeoValueField | null {
  const found = event.composedPath().find((node) => node instanceof Element && node.localName === 'heo-value-field');
  return (found as HeoValueField | undefined) ?? null;
}

/**
 * Confirm what an adder's value field holds, for a surface about to take it away (the style
 * dialog's Done): a value the user gave is written as ✓ would write it, an untouched starting
 * value is not. Any other field is flushed as it always was.
 */
export function flushAdderField(fieldEl: HeoValueField): void {
  if (!fieldEl.matches('.property-adder heo-value-field.new-value')) {
    fieldEl.commitNow();
    return;
  }
  flushing.add(fieldEl);
  entered.add(fieldEl);
  fieldEl.commitNow();
  if (entered.has(fieldEl)) fieldEl.dispatchEvent(new CustomEvent('adder-confirm'));
  entered.delete(fieldEl);
  flushing.delete(fieldEl);
}

export function renderAdder(spec: AdderSpec, host: AdderHost): TemplateResult {
  if (spec.disclosure && !spec.open) {
    return html`<button
      class="add-prop"
      type="button"
      data-heo-part="adder"
      data-adder=${spec.id}
      @click=${() => spec.onOpen?.()}
    >
      ${icon('plus', 12)} Add property
    </button>`;
  }

  const name = `prop-add-${spec.id}`;
  const valueName = `prop-value-${spec.id}`;
  const draft = readDraft(host.newProperty);
  /** The ladder's rungs for a property and the one picked: the hand pick, else the default. */
  const ladderFor = (property: string): { places: AdderPlaces; picked: Place | undefined } | null => {
    const places = spec.places?.(property);
    if (!places) return null;
    const picked =
      places.list.find((one) => one.key === spec.selected) ??
      places.list.find((one) => one.key === places.fallback) ??
      places.list[0];
    return { places, picked };
  };
  /** Where a value for `property` goes now: the picked rung, or the adder's one destination. */
  const destFor = (property: string): AdderDestination | undefined => {
    if (!spec.places) return spec.destinations.find((one) => one.key === spec.selected) ?? spec.destinations[0];
    const picked = ladderFor(property)?.picked;
    return picked ? placeDestination(picked) : undefined;
  };

  const cancel = (): void => {
    spec.revert?.();
    host.form.reset();
    host.onNewProperty('');
    spec.onCancel?.();
  };
  /**
   * Escape backs out of the adder, before the field takes it, unless the field's list is open (it
   * closes that first). And it goes no further: the global keymap would take it as "deselect".
   * In an always-open adder it only empties the draft.
   */
  const onKey = (event: KeyboardEvent): void => {
    keyRoot = (event.currentTarget as Element).getRootNode() as ParentNode;
    const fieldEl = fieldOf(event);
    if (event.key === 'Enter') {
      if (!fieldEl?.classList.contains('new-value')) return;
      entered.add(fieldEl);
      /*
       * A value the field holds already (typed and looked away from, or picked from its list) is
       * not committed again by the field, so Enter would do nothing: confirm it once the field has
       * had its turn, unless its own commit took the Enter.
       */
      queueMicrotask(() => {
        if (entered.has(fieldEl) && fieldEl.isConnected) fieldEl.dispatchEvent(new CustomEvent('adder-confirm'));
      });
      return;
    }
    if (event.key !== 'Escape') return;
    if ((fieldEl ?? (event.currentTarget as Element).querySelector<HeoValueField>('heo-value-field'))?.listIsOpen) return;
    event.preventDefault();
    event.stopPropagation();
    if (spec.disclosure) {
      cancel();
      return;
    }
    spec.revert?.();
    host.form.reset();
    host.onNewProperty('');
  };
  /** The name, checked: the canonical property, or null with the message shown under the field. */
  const checkName = (typed: string, left: boolean): string | null => {
    if (!typed.trim()) {
      if (!left) host.form.fail(name, 'Type the property to add.');
      return null;
    }
    // Refused as a duplicate where it would go: the default place for that property.
    const dest = destFor(normalizeProperty(typed));
    if (!dest) {
      host.form.fail(name, 'Nothing here can hold a declaration.', { focus: !left });
      return null;
    }
    const verdict = checkDeclaration({ property: typed, existing: dest.existing, label: dest.ownerLabel });
    if (verdict.refusal || !verdict.property) {
      // Kept in the field, so the name can be corrected rather than retyped.
      host.form.fail(name, verdict.refusal ?? 'That is not a property name.', { focus: !left });
      return null;
    }
    if (verdict.advice) host.engine.notify(verdict.advice, 'warn');
    return verdict.property;
  };
  const write = (property: string, value: string, from: Element, dest: AdderDestination): void => {
    const root = from.getRootNode() as ParentNode;
    host.form.reset();
    host.onNewProperty('');
    spec.commit(property, value, dest);
    // Back to "+ Add property" (or the name field, in an always-open adder), ready for the next
    // one: the property is written with the value the user meant, so nothing is left to finish.
    // As soon as the commit has rendered, before a panel puts a lost focus back on what opened it.
    const host2 = (root as ShadowRoot).host as (Element & { updateComplete?: Promise<unknown> }) | undefined;
    void (host2?.updateComplete ?? Promise.resolve()).then(() => {
      // Only if focus went nowhere: the field it was in is gone. Anywhere else, the user moved it.
      const active = (root as ShadowRoot).activeElement;
      if (active && active.isConnected && active !== from) return;
      const again = root.querySelector<HTMLElement>(`[data-adder="${CSS.escape(spec.id)}"]`);
      if (again instanceof HTMLButtonElement) again.focus({ preventScroll: true });
      else again?.querySelector<HeoValueField>('heo-value-field.name-field')?.focusInput();
    });
  };
  /** The name step's Enter, Tab or pick: a whole declaration is written, a name opens its value. */
  const submitName = (text: string, from: Element): void => {
    const whole = splitDeclaration(text);
    const property = checkName(whole ? whole.property : text, false);
    if (!property) return;
    const dest = destFor(property);
    if (dest && whole && whole.value && acceptsValue(property, whole.value)) {
      write(property, whole.value, from, dest);
      return;
    }
    host.form.reset();
    host.onNewProperty(valueStepDraft(property, whole?.value ?? ''));
  };
  const trash = (what: string): TemplateResult => html`<button
    class="kill tight cancel"
    type="button"
    title="Cancel"
    aria-label=${`Cancel adding ${what}`}
    @pointerdown=${(event: Event) => event.preventDefault()}
    @click=${cancel}
  >
    ${icon('trash', 11)}
  </button>`;

  if (draft.property === null) {
    const typed = draft.text;
    return html`<div
      class="decl property-adder ${spec.disclosure ? 'framed' : ''}"
      data-heo-part="adder"
      data-adder=${spec.id}
      data-step="name"
      @keydown=${{ capture: true, handleEvent: onKey }}
    >
      <heo-value-field
        ${field(host.form, name)}
        ${spec.disclosure ? ref(focusNameField) : nothing}
        class="name-field"
        field-label="New property"
        placeholder=${spec.disclosure ? 'property, or property: value' : 'add a property'}
        action="Next: its value"
        action-icon="arrowRight"
        chevron-hidden
        empty-text="No property by that name. Enter checks what you typed."
        .value=${typed}
        .suggestions=${nameSuggestions(typed)}
        @value-input=${(event: CustomEvent<{ value: string }>) => host.onNewProperty(event.detail.value)}
        @value-submit=${(event: CustomEvent<{ value: string }>) =>
        submitName(event.detail.value, event.currentTarget as Element)}
        @keydown=${(event: KeyboardEvent) => {
        // Tab means "done here", so go on to the value rather than discarding the name.
        if (event.key === 'Tab' && !event.shiftKey && host.newProperty.trim()) {
          event.preventDefault();
          submitName(host.newProperty, event.currentTarget as Element);
        }
      }}
      ></heo-value-field>
      ${spec.disclosure ? trash('a property') : nothing}
      ${host.form.error(name)}
    </div>`;
  }

  /* ---- The value step: a declaration row whose value is not written yet ---- */
  const property = draft.property;
  const ladder = ladderFor(property);
  const dest = ladder ? (ladder.picked ? placeDestination(ladder.picked) : undefined) : destFor(property);
  const seed = dest ? draft.text || spec.seed(property, dest) : draft.text;
  // What the field holds: what was typed, else what it opened with. Only a value the user gave
  // (typed, picked, or handed over with the name) makes ✓ available; the starting value is the
  // element's own, and writing it changes nothing.
  const shown = draft.typed ?? seed;
  const given = (draft.typed ?? draft.text).trim();
  const important = Boolean(ladder && spec.important);
  const remember = (text: string): void => host.onNewProperty(typedDraft(property, draft.text, text));
  /**
   * Write what the field holds, when that is a confirmation: Enter or ✓. A value the field
   * commits by itself (the user looked away, picked from the list, stepped it with an arrow) is
   * only remembered, so nothing is written before it is confirmed, and picking another rung after
   * typing moves the value rather than writing it where it was first typed.
   */
  const commitValue = (text: string, from: Element, confirmed: boolean): void => {
    const value = text.trim();
    if (!confirmed) {
      remember(text);
      return;
    }
    if (!dest) return;
    if (!value) {
      host.form.fail(valueName, `Type a value for ${property}.`);
      return;
    }
    if (!acceptsValue(property, value)) {
      host.form.fail(valueName, `${splitImportant(value).value} is not a value for ${property}.`);
      return;
    }
    const written = important && splitImportant(value).important === null ? `${value} !important` : value;
    write(property, written, from, dest);
  };
  const confirmFrom = (button: Element): void => {
    const fieldEl = button.closest('.property-adder')?.querySelector('heo-value-field.new-value');
    if (fieldEl) commitValue(shown, fieldEl, true);
  };
  const valueField = (label: string): TemplateResult => html`<heo-value-field
      ${field(host.form, valueName)}
      ${ref((el?: Element) => {
    if (!el || mounted.has(el)) return;
    mounted.add(el);
    const fieldEl = el as HeoValueField;
    // After it connects: connecting adopts the bound value, which would wipe a seed set now.
    void fieldEl.updateComplete.then(() => {
      fieldEl.seedDraft(shown);
      requestAnimationFrame(() => {
        if (keyboardPicked.delete(spec.id)) return;
        fieldEl.focusInput({ select: true });
      });
    });
  })}
      class="new-value"
      data-property=${property}
      field-label=${label}
      .value=${''}
      placeholder=${(dest && spec.seed(property, dest)) || 'value'}
      .kind=${valueKindFor(property)}
      .property=${property}
      .computed=${spec.computed?.(property) ?? ''}
      .suggestions=${buildSuggestions(host.engine, property, host.element)}
      @value-input=${(event: CustomEvent<{ value: string }>) => {
      remember(event.detail.value);
      if (dest) spec.preview?.(property, event.detail.value, dest);
    }}
      @value-revert=${() => spec.revert?.()}
      @value-change=${(event: CustomEvent<{ value: string }>) => {
      const from = event.currentTarget as Element;
      const confirmed = entered.delete(from);
      // Closing is a confirmation of a value the user gave, never of the starting one.
      if (confirmed && flushing.has(from) && !draft.text && event.detail.value.trim() === seed.trim()) return;
      commitValue(event.detail.value, from, confirmed);
    }}
      @adder-confirm=${(event: Event) => {
      const from = event.currentTarget as Element;
      if (!entered.delete(from)) return;
      if (flushing.has(from) && !given) return;
      commitValue(shown, from, true);
    }}
    ></heo-value-field>`;
  const confirm = html`<button
    class="confirm"
    type="button"
    title=${`Add ${property} (Enter)`}
    aria-label=${`Add ${property}`}
    ?disabled=${!given}
    @pointerdown=${(event: Event) => event.preventDefault()}
    @click=${(event: Event) => confirmFrom(event.currentTarget as Element)}
  >
    ${icon('check', 11)}
  </button>`;
  const rename = html`<button
      class="p rename"
      type="button"
      title="Change the property"
      @pointerdown=${(event: Event) => event.preventDefault()}
      @click=${() => {
      spec.revert?.();
      host.onNewProperty(property);
    }}
    >${property}</button>`;

  if (!ladder) {
    return html`<div
      class="decl property-adder ${spec.disclosure ? 'framed' : ''} value-step"
      data-heo-part="adder"
      data-adder=${spec.id}
      data-step="value"
      @keydown=${{ capture: true, handleEvent: onKey }}
    >
      ${rename}
      ${valueField(`Value of the new ${property}`)}
      ${confirm}
      ${trash(property)}
      ${host.form.error(valueName)}
    </div>`;
  }

  /* ---- Several places: the ladder, with the value, !important and ✓ in the picked rung ---- */
  const { places, picked } = ladder;
  const pick = (place: Place, keyboard: boolean): void => {
    spec.revert?.();
    const root = keyboard ? keyRoot : null;
    if (root) keyboardPicked.add(spec.id);
    else keyboardPicked.delete(spec.id);
    spec.onPick?.(place.key);
    if (!root) return;
    // The rung buttons are kept by position, so focus follows the pick to its rung by hand.
    const panel = (root as ShadowRoot).host as (Element & { updateComplete?: Promise<unknown> }) | undefined;
    void (panel?.updateComplete ?? Promise.resolve()).then(() => {
      const at = `[data-adder="${CSS.escape(spec.id)}"] [data-place="${CSS.escape(place.key)}"]`;
      root.querySelector<HTMLElement>(`${at}[role="radio"], ${at} [role="radio"]`)?.focus();
    });
  };
  const open = (place: Place): TemplateResult => {
    if (place.target?.kind === 'readonly') {
      return html`<p class="note">Read-only here: ${place.target.reason}</p>`;
    }
    const outcome = places.outcome(place, important);
    return html`<div class="vrow withok">
        ${valueField(`Value of the new ${property} in ${placeDestination(place).label}`)}
        ${renderPromote({
      property,
      source: place.label,
      important,
      onToggle: (next) => spec.onImportant?.(next),
    })}
        ${confirm}
      </div>
      ${renderResult({
      place,
      outcome,
      wouldApplyImportant: places.outcome(place, true).applies,
      important,
      onMakeImportant: () => spec.onImportant?.(true),
    })}`;
  };
  return html`<div
    class="decl property-adder framed value-step laddered"
    data-heo-part="adder"
    data-adder=${spec.id}
    data-step="value"
    @keydown=${{ capture: true, handleEvent: onKey }}
  >
    <div class="ahead">
      ${rename}
      ${places.owner ? html`<span class="owner">shows in ${places.owner}</span>` : nothing}
      ${trash(property)}
    </div>
    ${renderLadder({
    property,
    label: 'Where it goes',
    places: places.list,
    picked: picked?.key ?? '',
    onPick: pick,
    open,
    inactive: places.inactive,
    ...(spec.newClass ? { newClass: spec.newClass } : {}),
  })}
    ${host.form.error(valueName)}
  </div>`;
}

/**
 * The adder's look. Unscoped, so it works inside a card and on its own under a block.
 *
 * A draft row looks like the rows it will join: the name in the name column, the value in the value
 * field, then ✓ and the trash where every row's trash is.
 */
export const adderRowStyles: CSSResult = css`
  .decl.property-adder {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 5px 6px;
  }
  .decl.property-adder.framed {
    grid-template-columns: minmax(0, 1fr) 18px;
  }
  .decl.property-adder.value-step {
    grid-template-columns: 92px minmax(0, 1fr) 18px 18px;
  }
  /* With the ladder: one column, the name line over the rungs. */
  .decl.property-adder.value-step.laddered {
    grid-template-columns: minmax(0, 1fr);
  }
  .property-adder .field-error {
    grid-column: 1 / -1;
  }
  /* Opened from "+ Add property": a framed box, wherever it sits. Three classes so it wins over a
     card's name-and-value row grid. */
  .decl.property-adder.framed {
    margin-top: 2px;
    padding: 6px;
    ${framedBox}
  }
  .property-adder .rename {
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10.5px;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: text;
  }
  .property-adder .rename:hover {
    color: var(--heo-accent-text);
  }
  /* The ladder's name line: the property, the card it will show in, the trash at the end. */
  .property-adder .ahead {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .property-adder .ahead .rename {
    flex: 0 1 auto;
    min-width: 0;
  }
  .property-adder .ahead .owner {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .property-adder .ahead .cancel {
    margin-left: auto;
  }
  .property-adder .vrow.withok {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  /* ✓: the promote toggle's size and its pressed accent, quiet until there is a value to add. */
  .property-adder .confirm {
    display: grid;
    place-items: center;
    width: 18px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--heo-accent-line);
    border-radius: 5px;
    background: var(--heo-accent-soft);
    color: var(--heo-accent-text);
    cursor: pointer;
  }
  .property-adder .confirm:disabled {
    border-color: transparent;
    background: transparent;
    color: var(--heo-text-dim);
    opacity: 0.55;
    cursor: not-allowed;
  }
  /* Collapsed: a quiet text button after the block it adds to. */
  .add-prop {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 6px;
    margin-left: -6px;
    border: 0;
    border-radius: var(--heo-r-sm);
    background: transparent;
    color: var(--heo-text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .add-prop:hover {
    background: var(--heo-hover);
    color: var(--heo-text);
  }
  .add-prop:focus-visible,
  .property-adder .rename:focus-visible,
  .property-adder .confirm:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
`;
