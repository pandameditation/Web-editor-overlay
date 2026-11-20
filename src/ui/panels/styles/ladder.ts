import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { leanBlockSelector } from '../../../core/block-rule-edit.js';
import { mediaLabel } from '../../../core/breakpoints.js';
import type { Place } from '../../../core/cascade-places.js';
import type { Contribution } from '../../../core/cascade.js';
import { shortLabel } from '../../../core/save-plan.js';
import { field, type FormErrors } from '../../form-errors.js';
import { renderUses } from '../class-editor.js';
import '../../controls/value-field.js';

/** How long a place's name may be where it is shown inline; the full name is in its tooltip. */
export const SOURCE_NAME_MAX = 32;

/**
 * A place's name short enough for a rung, a line or a menu.
 *
 * A block's scoped selector is named as its author wrote it (`.title`, not the hooks repeated six
 * times), and anything still longer is cut in the middle: the start says where the rule is, the
 * end is the element it styles, and both matter more than the part between.
 */
export function displayName(name: string, max = SOURCE_NAME_MAX): string {
  const lean = leanBlockSelector(name).replace(/\s+/g, ' ').trim();
  if (lean.length <= max) return lean;
  const head = Math.ceil((max - 1) * 0.4);
  const tail = max - 1 - head;
  return `${lean.slice(0, head).trimEnd()}…${lean.slice(lean.length - tail).trimStart()}`;
}

/**
 * The cascade ladder (design J): every place one property can be written for the element, strongest
 * first, as one radio group.
 *
 * The order is the cascade's: a rung above beats every rung below it. Each rung is a place, set or
 * empty, with how many elements it styles and the value it holds; the one the element renders with
 * now carries the "now" badge whatever is picked, and a value a stronger rung hides is struck
 * through. Picking a rung opens it: the caller's value field, `!important` and the result line sit
 * right under the picked rung, so what is being edited and where are read together. The last rung
 * is a class of the element's own, named here or automatically; naming a class that exists picks
 * that class's own rung instead. The same control, name field included, is the cascade menu of a
 * row and the adder's "where it goes", so the two never disagree.
 */
export interface LadderSpec {
  property: string;
  /** The caption over the rungs: `Strongest first`. */
  label: string;
  places: readonly Place[];
  /** The picked place's key. */
  picked: string;
  /** A rung was picked: by a press, or by an arrow key (`keyboard`), which moves focus with it. */
  onPick(place: Place, keyboard: boolean): void;
  /** What opens under the picked rung: its value field, its `!important`, its result line. */
  open(place: Place): TemplateResult;
  /** Declarations whose media does not apply under the condition, listed under the rungs. */
  inactive: readonly Contribution[];
  /** The new class's name field, on the last rung. Empty draft: the editor names it. */
  newClass?: {
    draft: string;
    onDraft(text: string): void;
    /** Enter in the name field, on the rung `place`: picks a rung for that name once it is valid. */
    onSubmit(text: string, place: Place): void;
    form: FormErrors;
    /** The form's field name for the name field. */
    field: string;
  };
}

const isNewClass = (place: Place): boolean => place.key.startsWith('new-class|');

/** A rung's current value: the declaration's text and its `!`, or a dash for an empty place. */
function currentValue(place: Place): TemplateResult {
  const one = place.declared;
  if (!one) return html`<span class="cv vacant">—</span>`;
  return html`<span class="cv" title=${`${one.value}${one.important ? ' !important' : ''}`}>${one.value}${one.important
    ? html` <span class="imp" aria-label="!important">!</span>`
    : nothing}</span>`;
}

export function renderLadder(spec: LadderSpec): TemplateResult {
  const { places, picked } = spec;
  const pickedKey = places.some((one) => one.key === picked) ? picked : places[0]?.key;

  /** Up and Down move the pick, as in any radio group; Home and End go to the ends. */
  const onKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target?.matches?.('[role="radio"]')) return;
    const at = places.findIndex((one) => one.key === pickedKey);
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? at + 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? at - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? places.length - 1
            : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    const place = places[(next + places.length) % places.length];
    if (place) spec.onPick(place, true);
  };

  const rung = (place: Place): TemplateResult => {
    const on = place.key === pickedKey;
    const tone = place.winner ? 'win' : place.declared ? 'hid' : '';
    const size = place.media ? html`<span class="sz">${mediaLabel(place.media)}</span>` : nothing;
    const now = place.winner
      ? html`<span class="now" title="What the element renders with now">now</span>`
      : html`<span class="nowgap"></span>`;
    if (isNewClass(place)) {
      const form = spec.newClass;
      return html`<div class="lr new ${on ? 'on' : ''}" data-place=${place.key}>
          <button
            type="button"
            role="radio"
            class="pick"
            aria-checked=${on ? 'true' : 'false'}
            tabindex=${on ? '0' : '-1'}
            aria-label=${`A new class of this element's own${place.state ? ` ${place.state}` : ''}${place.media ? ` at ${mediaLabel(place.media)}` : ''}`}
            @click=${() => spec.onPick(place, false)}
          ><span class="rd"></span><span class="nm"><span class="pl">new class</span>${size}${renderUses(1)}</span></button>
          ${form
          ? html`<heo-value-field
              ${field(form.form, form.field)}
              class="ncname"
              field-label="New class name"
              placeholder="name it, or leave it to the editor"
              chevron-hidden
              .value=${form.draft}
              .suggestions=${[]}
              @value-input=${(event: CustomEvent<{ value: string }>) => form.onDraft(event.detail.value)}
              @value-change=${(event: CustomEvent<{ value: string }>) => form.onDraft(event.detail.value)}
              @value-submit=${(event: CustomEvent<{ value: string }>) => form.onSubmit(event.detail.value, place)}
            ></heo-value-field>`
          : nothing}
        </div>
        ${form ? form.form.error(form.field) : nothing}
        ${on ? html`<div class="open">${spec.open(place)}</div>` : nothing}`;
    }
    return html`<button
        type="button"
        role="radio"
        class=${`lr ${tone}`}
        data-place=${place.key}
        aria-checked=${on ? 'true' : 'false'}
        tabindex=${on ? '0' : '-1'}
        title=${place.declared && !place.winner ? 'Set here, and hidden by a stronger place above' : ''}
        @click=${() => spec.onPick(place, false)}
      >
        <span class="rd"></span>
        <span class="nm"><span class="pl" title=${place.label}>${displayName(place.label, 30)}</span>${size}${renderUses(place.reach)}</span>
        ${currentValue(place)}
        ${now}
      </button>
      ${on ? html`<div class="open">${spec.open(place)}</div>` : nothing}`;
  };

  return html`<div class="orderhint"><span>${spec.label}</span><span>applies</span></div>
    <div class="ladder" role="radiogroup" aria-label=${`${spec.label}: where ${spec.property} is written`} @keydown=${onKeydown}>
      ${places.map(rung)}
    </div>
    ${spec.inactive.length
      ? html`<p class="idle">Not active at this width: ${spec.inactive.map((one, at) => html`${at ? ', ' : ''}<code>${displayName(shortLabel(one), 40)} ${one.value}</code>`)}</p>`
      : nothing}`;
}

/** The line under a picked rung: what a value there does, and how far it reaches. */
export interface ResultSpec {
  place: Place;
  /** Whether a value there applies, as the place is now (with its importance). */
  outcome: { applies: boolean; over: Contribution | null; by: Contribution | null };
  /** Whether it would apply with `!important`: offered as a fix only then. */
  wouldApplyImportant: boolean;
  important: boolean;
  onMakeImportant(): void;
}

export function renderResult(spec: ResultSpec): TemplateResult {
  const { place, outcome } = spec;
  const name = (one: Contribution): string => displayName(shortLabel(one), 32);
  const reach = place.reach > 1
    ? html` · changes <b>${place.reach}</b> elements`
    : html` · only this element`;
  const fix = !outcome.applies && !spec.important && spec.wouldApplyImportant
    ? html` <button type="button" class="link make-important" @click=${() => spec.onMakeImportant()}>Make it !important</button>`
    : nothing;
  const over = outcome.over ? html`, over <b>${name(outcome.over)}</b>` : nothing;
  const set = Boolean(place.declared);
  const body = outcome.applies
    ? html`<span class="ok">${set ? 'Applies' : 'A value here will apply'}</span>${over}${reach}`
    : html`<span class="ko">${set ? 'Hidden by' : 'A value here will be hidden by'} <b>${outcome.by ? name(outcome.by) : ''}</b></span>${reach}.${fix}`;
  return html`<p class="res" role="status">${body}</p>`;
}

export const ladderStyles: CSSResult = css`
  .orderhint {
    display: flex;
    justify-content: space-between;
    margin: 2px 0 0;
    color: var(--heo-text-dim);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .ladder {
    display: grid;
    gap: 3px;
  }
  /* A rung: radio, place (its size and reach), its value, and the now badge or its room. */
  .lr {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-height: 30px;
    padding: 4px 7px;
    border: 0;
    border-radius: var(--heo-r-sm);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--heo-line);
    color: var(--heo-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .lr:hover {
    background: var(--heo-hover);
  }
  .lr:focus-visible,
  .lr.new .pick:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  .lr .rd {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--heo-text-dim);
  }
  .lr[aria-checked='true'],
  .lr.new.on {
    border-radius: var(--heo-r-sm) var(--heo-r-sm) 0 0;
    background: var(--heo-accent-soft);
    box-shadow: inset 0 0 0 1px var(--heo-accent-line);
  }
  .lr[aria-checked='true'] .rd,
  .lr.new.on .rd {
    box-shadow: inset 0 0 0 3.5px var(--heo-accent-text);
  }
  .lr .nm {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-family: var(--heo-mono);
    font-size: 11px;
  }
  .lr .nm .pl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The size a rung is written at: the dim ink (no green size ink in the token set). */
  .lr .nm .sz {
    flex: 0 0 auto;
    color: var(--heo-text-dim);
    font-family: var(--heo-mono);
    font-size: 9.5px;
  }
  .lr .cv {
    max-width: 92px;
    overflow: hidden;
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /*
   * Not the class "empty": theme.ts gives that one the panel's empty-state padding (28px), which
   * made an empty rung three lines tall.
   */
  .lr .cv.vacant {
    color: var(--heo-text-dim);
    font-family: var(--heo-font, inherit);
  }
  /* Set here, and hidden by a rung above: struck through, in the dim ink (still readable). */
  .lr.hid .cv {
    color: var(--heo-text-dim);
    text-decoration: line-through;
  }
  .lr .imp {
    color: var(--heo-warn-text);
    font-weight: 600;
  }
  /* What renders now: the tinted success pill of the reach chip, not a solid fill (no ink for it). */
  .lr .now {
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--heo-success) 20%, transparent);
    color: var(--heo-success-text);
    font-size: 9.5px;
    font-weight: 600;
    line-height: 15px;
    white-space: nowrap;
  }
  .lr .nowgap {
    width: 30px;
  }
  /*
   * On a picked rung's accent tint, a pill keeps the popover's own surface under its tint: over the
   * blue its green ink fell to 4.3:1 (a11y-contrast styles.nowBadge, styles.ladderReach).
   */
  .lr .now,
  .lr .uses.one {
    background: color-mix(in oklab, var(--heo-success) 20%, var(--heo-raised));
  }
  .lr .uses.none {
    background: color-mix(in oklab, var(--heo-text-dim) 16%, var(--heo-raised));
  }
  .lr .uses.many {
    background: color-mix(in oklab, var(--heo-shared) 20%, var(--heo-raised));
  }
  .lr.win {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--heo-success) 45%, transparent);
  }
  .lr.win[aria-checked='true'] {
    box-shadow: inset 0 0 0 1px var(--heo-accent-line), inset 3px 0 0 var(--heo-success);
  }
  /* The last rung: its radio and the name field for the class it makes. */
  .lr.new {
    grid-template-columns: auto minmax(0, 1fr);
    cursor: default;
  }
  .lr.new .pick {
    display: grid;
    grid-template-columns: 14px auto;
    align-items: center;
    gap: 7px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--heo-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .lr.new .ncname {
    min-width: 0;
  }
  /* The picked rung's editor, joined to it. */
  .open {
    display: grid;
    gap: 6px;
    margin: -3px 0 2px;
    padding: 7px 8px 8px 28px;
    border-radius: 0 0 var(--heo-r-sm) var(--heo-r-sm);
    background: color-mix(in oklab, var(--heo-accent) 9%, var(--heo-sunken));
    box-shadow: inset 0 0 0 1px var(--heo-accent-line);
  }
  .open .vrow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 5px;
  }
  .res {
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.45;
  }
  .res .ok {
    color: var(--heo-success-text);
  }
  .res .ko {
    color: var(--heo-warn-text);
  }
  .res b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10.5px;
    font-weight: 500;
  }
  .res .link {
    font-size: 10.5px;
  }
  .idle {
    margin: 3px 0 0;
    padding-top: 6px;
    border-top: 1px solid var(--heo-line);
    color: var(--heo-text-dim);
    font-size: 10px;
    line-height: 1.6;
  }
  .idle code {
    color: var(--heo-text-dim);
    font-family: var(--heo-mono);
    font-size: 10px;
  }
`;
