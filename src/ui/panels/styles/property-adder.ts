import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { searchProperties } from '../../../core/css.js';
import { splitImportant } from '../../../core/declaration-list.js';
import { checkDeclaration } from '../../../core/declarations.js';
import type { AddDestination } from '../../../core/save-plan.js';
import type { HeoValueField, ValueSuggestion } from '../../controls/value-field.js';
import '../../controls/segmented.js';
import { framedBox } from '../../theme.js';
import { field } from '../../form-errors.js';
import { icon } from '../../icons.js';
import { buildSuggestions, valueKindFor } from '../../suggestions.js';
import type { ClassEditorHost } from '../class-editor.js';

/**
 * The one "add a property" control.
 *
 * Every surface that lists declarations ends with one: a class or a rule in Tokens, the style
 * dialog, the Styles panel's blocks and cards. Adding is the same interaction in all of them, and
 * it is a declaration row being written: the property's name, with a list of names, then its value
 * in the value field every row has. Nothing is written until the value is confirmed, so a new
 * property arrives as one undo entry with the value the user meant. A whole declaration typed or
 * pasted into the name (`color: blue`) is written at once.
 *
 * Where it goes is the value's question, not the name's. A card or a Tokens rule is its own
 * destination. Effective styles (`choose`) can write to several, and its value list opens with
 * them as a switch.
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
  /** The switch's own word for it, short: `Inline`, `.card`, `New class`. */
  short?: string;
  /** The line under the switch: what picking it does, in a few words. */
  explain?: string;
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
  /** Unique in the shadow root; also the `data-declarations` list the new row lands in. */
  id: string;
  /** At least one; the first is the default. */
  destinations: readonly AdderDestination[];
  /** The picked destination's key; the first destination when absent. */
  selected?: string;
  /**
   * Collapsed behind "+ Add property" until opened (the Styles panel), or always open (Tokens).
   * Always-open is today's Tokens row: no cancel, because the card it sits in is the destination.
   */
  disclosure: boolean;
  /** Whether a disclosure adder is open. Owned by the host, so only one is open at a time. */
  open?: boolean;
  /** Effective styles: the value's list offers the destinations as a switch. */
  choose?: boolean;
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
  // Keyed by what the user picks between: two destinations an adder offers never share a label,
  // since the switch could not tell them apart either.
  return {
    key: `${dest.kind}:${label}`,
    label,
    reach,
    short: shortDestination(dest, label),
    explain: explainDestination(dest, label, reach),
    dest,
    existing,
    ownerLabel,
  };
}

/** `inline style` → `Inline`, `a new class` → `New class`: the switch's words. */
function shortDestination(dest: AddDestination, label: string): string {
  if (dest.kind === 'target' && dest.target.kind === 'inline') return 'Inline';
  if (dest.kind === 'auto-class') return `New class${label.replace(/^a new class/, '')}`;
  return label;
}
/** The line under the switch, from what the destination is and how far it reaches. */
function explainDestination(dest: AddDestination, label: string, reach: string): string {
  if (dest.kind === 'target' && dest.target.kind === 'inline') return `Its style attribute · ${reach}`;
  if (dest.kind === 'auto-class') return 'Makes a class for this element only';
  if (dest.kind === 'new-rule') return `Adds a ${label} rule · ${reach}`;
  return `Edits ${label} · ${reach}`;
}

/**
 * The draft, as the host keeps it: the name being typed, or the name confirmed and the value step
 * open. One string, so every host that already stores the draft stores this too.
 */
const STEP = '\u0000';
function readDraft(draft: string): { property: string | null; text: string } {
  if (!draft.startsWith(STEP)) return { property: null, text: draft };
  const [property = '', text = ''] = draft.slice(1).split(STEP);
  return { property, text };
}
/** The host draft for the value step of `property`, opening with `value` (the seed when empty). */
export function valueStepDraft(property: string, value = ''): string {
  return `${STEP}${property}${STEP}${value}`;
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

/** Value fields Enter was pressed in, so a commit of the untouched seed is a confirmation. */
const entered = new WeakSet<Element>();
/** A field focuses (and the value step seeds) once per mount: later renders leave it alone. */
const mounted = new WeakSet<Element>();
/** Focus the name field the moment it appears, with what it opened with selected. */
function focusNameField(el?: Element): void {
  if (!el || mounted.has(el)) return;
  mounted.add(el);
  requestAnimationFrame(() => (el as HeoValueField).focusInput?.({ select: true }));
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

  const dest =
    spec.destinations.find((one) => one.key === spec.selected) ?? spec.destinations[0];
  const name = `prop-add-${spec.id}`;
  const valueName = `prop-value-${spec.id}`;
  const draft = readDraft(host.newProperty);

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
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      const fieldEl = (event.currentTarget as Element).querySelector('heo-value-field');
      if (fieldEl) entered.add(fieldEl);
      return;
    }
    if (event.key !== 'Escape') return;
    const fieldEl = (event.currentTarget as Element).querySelector<HeoValueField>('heo-value-field');
    if (fieldEl?.listIsOpen) return;
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
    const verdict = checkDeclaration({ property: typed, existing: dest.existing, label: dest.ownerLabel });
    if (verdict.refusal || !verdict.property) {
      // Kept in the field, so the name can be corrected rather than retyped.
      host.form.fail(name, verdict.refusal ?? 'That is not a property name.', { focus: !left });
      return null;
    }
    if (verdict.advice) host.engine.notify(verdict.advice, 'warn');
    return verdict.property;
  };
  const write = (property: string, value: string, from: Element): void => {
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
    if (whole && whole.value && acceptsValue(property, whole.value)) {
      write(property, whole.value, from);
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
      @keydown=${{ capture: true, handleEvent: onEscape }}
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
  const seed = draft.text || spec.seed(property, dest);
  const several = Boolean(spec.choose) && spec.destinations.length > 1;
  const pick = (key: string): void => {
    spec.revert?.();
    spec.onPick?.(key);
  };
  const head = several
    ? html`<heo-segmented
        .options=${spec.destinations.map((one) => ({ value: one.key, label: one.short ?? one.label, title: one.explain ?? one.reach }))}
        .value=${dest.key}
        label="Where it goes"
        wrap
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        if (event.detail.value) pick(event.detail.value);
      }}
      ></heo-segmented>
      <p class="explain">${dest.explain ?? dest.reach}</p>`
    : null;
  const commitValue = (text: string, from: Element): void => {
    const value = text.trim();
    // Looking away from an untouched seed is not a confirmation: the property waits, unwritten.
    // Enter is, and a value the user typed is kept the way every row keeps one, by leaving it.
    const confirmed = entered.delete(from);
    if (!confirmed && value === seed.trim()) return;
    if (!value) {
      host.form.fail(valueName, `Type a value for ${property}.`);
      return;
    }
    if (!acceptsValue(property, value)) {
      host.form.fail(valueName, `${splitImportant(value).value} is not a value for ${property}.`);
      return;
    }
    write(property, value, from);
  };
  return html`<div
    class="decl property-adder ${spec.disclosure ? 'framed' : ''} value-step"
    data-heo-part="adder"
    data-adder=${spec.id}
    data-step="value"
    @keydown=${{ capture: true, handleEvent: onEscape }}
  >
    <button
      class="p rename"
      type="button"
      title="Change the property"
      @pointerdown=${(event: Event) => event.preventDefault()}
      @click=${() => {
      spec.revert?.();
      host.onNewProperty(property);
    }}
    >${property}</button>
    <heo-value-field
      ${field(host.form, valueName)}
      ${ref((el?: Element) => {
      if (!el || mounted.has(el)) return;
      mounted.add(el);
      const fieldEl = el as HeoValueField;
      // After it connects: connecting adopts the bound value, which would wipe a seed set now.
      void fieldEl.updateComplete.then(() => {
        fieldEl.seedDraft(seed);
        requestAnimationFrame(() => fieldEl.focusInput({ select: true }));
      });
    })}
      data-property=${property}
      field-label=${`Value of the new ${property}`}
      .value=${''}
      placeholder=${spec.seed(property, dest) || 'value'}
      .kind=${valueKindFor(property)}
      .property=${property}
      .computed=${spec.computed?.(property) ?? ''}
      .suggestions=${buildSuggestions(host.engine, property, host.element)}
      .head=${head}
      @head-step=${(event: CustomEvent<{ delta: number }>) => {
      const keys = spec.destinations.map((one) => one.key);
      const at = keys.indexOf(dest.key);
      pick(keys[(at + event.detail.delta + keys.length) % keys.length]);
    }}
      @value-input=${(event: CustomEvent<{ value: string }>) => spec.preview?.(property, event.detail.value, dest)}
      @value-revert=${() => spec.revert?.()}
      @value-change=${(event: CustomEvent<{ value: string }>) =>
      commitValue(event.detail.value, event.currentTarget as Element)}
    ></heo-value-field>
    ${trash(property)}
    ${host.form.error(valueName)}
  </div>`;
}

/**
 * The adder's look. Unscoped, so it works inside a card and on its own under a block.
 *
 * A draft row looks like the rows it will join: the name in the name column, the value in the value
 * field, the trash where every row's trash is.
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
    grid-template-columns: 92px minmax(0, 1fr) 18px;
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
  .property-adder .rename:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
`;
