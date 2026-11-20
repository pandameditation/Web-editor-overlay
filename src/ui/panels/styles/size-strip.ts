import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import {
  EDITABLE_STATES,
  isPseudoElement,
  isWidthQuery,
  mediaIcon,
  mediaShort,
  slotForMedia,
} from '../../../core/breakpoints.js';
import type { ElementModel, RuleEntry } from '../../../core/cascade.js';
import { countText } from '../../../core/save-plan.js';
import { mediaQueryIssues } from '../../../core/validation.js';
import { collectPageMedia, mediaApplies } from '../../../core/viewport.js';
import { field, type FormErrors } from '../../form-errors.js';
import { icon } from '../../icons.js';
import { HeoValueField } from '../../controls/value-field.js';
import { mediaQuerySuggestions } from '../../suggestions.js';
import type { ValueSuggestion } from '../../controls/value-field.js';
import type { SegmentOption } from '../../controls/segmented.js';
import '../../controls/segmented.js';
import { MAX_VIEWPORT, MIN_VIEWPORT, mediaQueryProblem, widthBound } from '../../../core/breakpoints.js';
import { ADD_MEDIA_TITLE, addMediaLabel } from '../../create-offer.js';
import { bestRow, renderSearchField, renderSearchPopover } from './search-popover.js';

/**
 * The conditions bar: "Always", then one button per condition that declares something here, and
 * "+" to add a state or a media query.
 *
 * A condition is a size (`≤767px`), another media query (`@media print`), a state (`:hover`), or a
 * state under a media query (`:hover ≥768px`). Picking one shows what is declared under it, read as
 * though it were in effect, so a rule nobody is previewing still shows its values; pressing it
 * again goes back to Always. A condition that declares nothing has no button: "+" offers the states
 * and the page's media queries not on the bar, then "Add a media query…" for any other (the sizes
 * first), and picking one puts it on the bar, where the "+" was, to be filled. On a source card
 * pseudo-elements are not conditions: they stay blocks under whichever condition is picked. On the
 * Styles panel's own strip they are (`{ pseudo: 'condition' }`): picking `::before` there makes every
 * card read and write the pseudo-element, the way picking `:hover` does.
 *
 * The panel's strip and every source card draw it, so picking looks and counts the same wherever it
 * is done. A media condition not in effect at the width the page renders at is drawn dashed, never
 * faded: it is still readable and still a choice.
 */

/** How pseudo-elements are counted: blocks under a condition (cards), or conditions (the panel). */
export interface ConditionOptions {
  pseudo?: 'block' | 'condition';
}

/*
 * Condition keys.
 *
 * `base` is Always. A media condition is a slot key (`phone`, `tablet`, …) or `other:<media>`. A
 * state is `state:<state>`, and a state under a media condition `state:<state>@<media key>`.
 */

/** The key for a media key (`base`, a slot, `other:…`) and a state (`''` for none). */
export function conditionKey(media: string, state: string): string {
  if (!state) return media;
  return media === 'base' ? `state:${state}` : `state:${state}@${media}`;
}

/** A key taken apart: its media key (`base` when it has none) and its state (`''` when none). */
export function conditionParts(key: string): { media: string; state: string } {
  if (!key.startsWith('state:')) return { media: key, state: '' };
  const rest = key.slice('state:'.length);
  const at = rest.indexOf('@');
  return at === -1 ? { media: 'base', state: rest } : { media: rest.slice(at + 1), state: rest.slice(0, at) };
}

/**
 * The condition a rule declares under. A pseudo-element's rule is a block under its media, unless
 * pseudo-elements are conditions (the panel's strip), where it is `state:::before` like a state.
 */
export function conditionOf(model: ElementModel, entry: RuleEntry, options: ConditionOptions = {}): string {
  const media = model.slotOf(entry);
  return isPseudoElement(entry.state) && options.pseudo !== 'condition' ? media : conditionKey(media, entry.state);
}

/** The media key a query lands on: its slot when it is one, else `other:<media>`. */
export function mediaKeyFor(model: ElementModel, media: string): string {
  return slotForMedia(media, model.slots())?.key ?? `other:${media}`;
}

/** The media query a key's media part stands for: null for none. */
export function slotMedia(model: ElementModel, key: string): string | null {
  const media = conditionParts(key).media;
  if (media === 'base') return null;
  if (media.startsWith('other:')) return media.slice('other:'.length);
  return model.slots().find((one) => one.key === media)?.media ?? null;
}

/** How a key's media part is named in text: `≤767px`, `@media print`, or nothing for none. */
export function slotName(model: ElementModel, key: string): string {
  const media = slotMedia(model, key);
  if (media === null) return '';
  return conditionParts(key).media.startsWith('other:') ? `@media ${media}` : mediaShort(media);
}

/** A key as one label: `≤767px`, `@media print`, `:hover`, `:hover ≥768px`, or `Always`. */
export function conditionName(model: ElementModel, key: string): string {
  if (key === 'base') return 'Always';
  const { state } = conditionParts(key);
  const media = slotName(model, key);
  return [state, media].filter(Boolean).join(' ');
}

/** One button on the bar. */
export interface BarChip {
  key: string;
  /** The media query it is under, or null for a state at no media. */
  media: string | null;
  /** A device or media icon; null for a state at no media. */
  icon: string | null;
  /** Visible text beside the icon: a state's name, a media query's short text, or nothing. */
  label: string;
  count: number;
  /** A media condition not in effect at the width the page renders at. */
  notNow: boolean;
  title: string;
}

/**
 * The bar for a set of rules: one button per condition they declare under, plus `extra` (picked
 * from ⋮, or a state added and not written yet) while it is empty. While a width is previewed, a
 * media condition not in effect there is left out, as its rules are, unless `offWidth` is `dim`:
 * the panel's strip keeps it, drawn as not in effect, since it is where a value for that size goes.
 */
export function barConditions(
  model: ElementModel,
  entries: readonly RuleEntry[],
  previewWidth: number | null,
  extra: readonly string[] = [],
  options: ConditionOptions & { offWidth?: 'hide' | 'dim' } = {},
): { chips: BarChip[]; count(key: string): number } {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = conditionOf(model, entry, options);
    counts.set(key, (counts.get(key) ?? 0) + entry.declarations.length);
  }
  const count = (key: string): number => counts.get(key) ?? 0;
  const keys = new Set<string>();
  for (const [key, n] of counts) if (key !== 'base' && n > 0) keys.add(key);
  for (const key of extra) if (key !== 'base') keys.add(key);
  const visible = (key: string): boolean => {
    const media = slotMedia(model, key);
    return media === null || previewWidth === null || options.offWidth === 'dim' || mediaApplies(media, previewWidth);
  };
  // Sizes in slot order, then other media, then states in the state list's order.
  const slotOrder = model.slots().map((one) => one.key);
  const stateOrder = (state: string): number => {
    const at = EDITABLE_STATES.findIndex((one) => one.name === state);
    return at === -1 ? EDITABLE_STATES.length : at;
  };
  const rank = (key: string): [number, number, string] => {
    const { media, state } = conditionParts(key);
    const slot = slotOrder.indexOf(media);
    const mediaRank = media === 'base' ? -1 : slot === -1 ? slotOrder.length : slot;
    return state ? [2, stateOrder(state) * 100 + mediaRank, key] : [mediaRank === slotOrder.length ? 1 : 0, mediaRank, key];
  };
  const sorted = [...keys].filter(visible).sort((a, b) => {
    const [x1, y1, z1] = rank(a);
    const [x2, y2, z2] = rank(b);
    return x1 - x2 || y1 - y2 || z1.localeCompare(z2);
  });
  const chips = sorted.map((key): BarChip => {
    const { media: mediaKey, state } = conditionParts(key);
    const media = slotMedia(model, key);
    const slot = model.slots().find((one) => one.key === mediaKey) ?? null;
    const n = count(key);
    const notNow = media !== null && !mediaApplies(media, null);
    const name = conditionName(model, key);
    return {
      key,
      media,
      icon: media === null ? null : slot ? slot.icon : mediaIcon(media),
      label: state || (slot ? '' : media === null ? '' : mediaShort(media)),
      count: n,
      notNow,
      title: `${slot && !state ? slot.name : name}${n ? ` — ${countText(n, 'declaration')}` : ' — none yet'}` +
        (notNow ? ` · not in effect ${isWidthQuery(media ?? '') ? `at ${model.width}px` : 'now'}` : ''),
    };
  });
  return { chips, count };
}

/** What "+" offers, by kind. `pseudos` only where pseudo-elements are conditions. */
export interface RemainingConditions {
  media: Array<{ key: string; icon: string; label: string; note: string }>;
  states: Array<{ key: string; label: string; note: string }>;
  pseudos?: Array<{ key: string; label: string; note: string }>;
}

/**
 * What "+" offers: every condition not on the bar. Sizes not in effect at a previewed width are left
 * out, as they are from the bar (kept with `offWidth: 'dim'`, as the panel's strip keeps them).
 * States are offered under the picked condition's media, so a state added while a size is picked is
 * that size's state, as it was from the adder; pseudo-elements likewise, where they are conditions.
 */
export function remainingConditions(
  model: ElementModel,
  onBar: readonly string[],
  previewWidth: number | null,
  picked = 'base',
  options: ConditionOptions & { offWidth?: 'hide' | 'dim' } = {},
): RemainingConditions {
  const taken = new Set(onBar);
  const fits = (media: string): boolean =>
    previewWidth === null || options.offWidth === 'dim' || mediaApplies(media, previewWidth);
  const media = collectPageMedia()
    .map((one) => ({ one, key: mediaKeyFor(model, one.media) }))
    .filter(({ one, key }) => key.startsWith('other:') && !taken.has(key) && fits(one.media))
    .map(({ one, key }) => ({ key, icon: mediaIcon(one.media), label: `@media ${one.media}`, note: countText(one.rules, 'rule') }));
  const under = conditionParts(picked).media;
  const at = under === 'base' ? '' : slotName(model, under);
  const states = EDITABLE_STATES
    .filter((one) => one.kind === 'state' && !taken.has(conditionKey(under, one.name)))
    .map((one) => ({ key: conditionKey(under, one.name), label: one.name, note: at }));
  if (options.pseudo !== 'condition') return { media, states };
  const pseudos = EDITABLE_STATES
    .filter((one) => one.kind === 'pseudo-element' && !taken.has(conditionKey(under, one.name)))
    .map((one) => ({ key: conditionKey(under, one.name), label: one.name, note: at }));
  return { media, states, pseudos };
}

export interface ConditionBarSpec {
  /** `panel`, or a card's family key; ids and the menu derive from it. */
  owner: string;
  /** `base` or a condition key. */
  picked: string;
  /** The first button's name: `Always` on a card, `Element` on the panel's strip. */
  alwaysLabel?: string;
  alwaysCount: number;
  alwaysTitle: string;
  chips: readonly BarChip[];
  /** With `pseudos`, "+" offers pseudo-elements too, and says so. */
  remaining: RemainingConditions;
  menuOpen: boolean;
  /** The search field's text, or null before anything is typed. */
  mediaDraft: string | null;
  /** The custom width panel's side and text, or null while the search shows. */
  widthDraft: { side: 'max' | 'min'; text: string } | null;
  onWidthDraft(next: { side: 'max' | 'min'; text: string } | null): void;
  /** The bar's viewport sizes, the width panel's quick picks. */
  viewports: ReadonlyArray<{ width: number; icon: string }>;
  mediaForm: FormErrors;
  onPick(key: string): void;
  /** `refocus` false: closed because something it added takes focus (a state's adder). */
  onMenu(open: boolean, refocus?: boolean): void;
  onMediaDraft(text: string | null): void;
  /** A condition picked from "+", or a media query typed there: put it on the bar and pick it. */
  onAdd(key: string): void;
  /** The picked condition's ×: take it off the bar, and what is written under it. */
  onRemove(key: string): void;
  /** The media key a typed query lands on. */
  keyForMedia(media: string): string;
}

/** The field names the bar's popover reports under. */
export const MEDIA_FIELD = 'media-query';
export const WIDTH_FIELD = 'media-width';

/** The search list's row that opens the custom width panel; never a media query itself. */
const CUSTOM_WIDTH = '@custom-width';

export function renderConditionBar(spec: ConditionBarSpec): TemplateResult {
  const menuId = `strip-${spec.owner}`;
  return html`<div
    class="slots"
    role="group"
    aria-label="Conditions"
    data-heo-part="strip"
    data-strip=${spec.owner}
    data-menu-place=${menuId}
  >
    <button
      class="base"
      type="button"
      aria-pressed=${spec.picked === 'base' ? 'true' : 'false'}
      title=${spec.alwaysTitle}
      @click=${() => spec.onPick('base')}
    >
      ${spec.alwaysLabel ?? 'Always'} <span class="c">${spec.alwaysCount}</span>
    </button>
    ${spec.chips.map((chip) => {
    const on = spec.picked === chip.key;
    const name = chip.title.split(' — ')[0];
    const pick = html`<button
        class=${`${chip.count ? '' : 'empty'}${chip.notNow ? ' notnow' : ''}${chip.label ? ' named' : ''}`}
        type="button"
        data-cond=${chip.key}
        data-slot=${chip.key}
        aria-pressed=${on ? 'true' : 'false'}
        aria-label=${`${name}, ${countText(chip.count, 'declaration')}${on ? '. Press again for Always' : ''}`}
        title=${on ? `${chip.title}. Press again for Always` : chip.title}
        @click=${() => spec.onPick(on ? 'base' : chip.key)}
      >
        ${chip.icon ? icon(chip.icon, 12) : nothing}${chip.label ? html`<span class="n">${chip.label}</span>` : nothing}${chip.count ? html`<span class="c">+${chip.count}</span>` : nothing}
      </button>`;
    // The picked one carries its ×, as a class chip in the header does: the condition being read
    // is the one it would take off.
    return on
      ? html`<span class="cchip-on">${pick}<button
            class="ckill"
            type="button"
            aria-label=${`Remove ${name}`}
            title=${chip.count ? `Remove ${name} and its ${countText(chip.count, 'declaration')}` : `Remove ${name} from the bar`}
            @click=${() => spec.onRemove(chip.key)}
          >
            ${icon('close', 9)}
          </button></span>`
      : pick;
  })}
    <!-- After the conditions, as "+" is after the classes in the header: what it adds lands here. -->
    <button
      class="add"
      type="button"
      aria-label=${addConditionLabel(spec)}
      title=${addConditionLabel(spec)}
      aria-haspopup="dialog"
      aria-expanded=${spec.menuOpen ? 'true' : 'false'}
      data-menu-anchor=${menuId}
      @click=${() => spec.onMenu(!spec.menuOpen)}
    >
      ${icon('plus', 11)}
    </button>
  </div>
  ${spec.menuOpen ? renderAddCondition(spec, menuId) : nothing}`;
}

/** What "+" is called: it names pseudo-elements where it offers them. */
function addConditionLabel(spec: ConditionBarSpec): string {
  return spec.remaining.pseudos ? 'Add a state, size or pseudo-element' : 'Add a state or media query';
}

/**
 * What "+" opens: one popover, the same box for both of its screens.
 *
 * First a search, open on its list as it appears, like the header's class finder: the page's own
 * media queries, then widths ("Custom width…", and one read out of "max 600" as it is typed), then
 * states, then the common queries that are not sizes, matched by words. One pick adds it, and what
 * is typed is checked before it is added. "Custom width…" turns the same box into the width
 * panel. Escape steps back a screen, then closes.
 */
function renderAddCondition(spec: ConditionBarSpec, menuId: string): TemplateResult {
  const width = spec.widthDraft;
  return renderSearchPopover({
    id: menuId,
    kind: 'condpop',
    label: width ? 'Add a custom width' : addConditionLabel(spec),
    onEscape: () => {
      spec.mediaForm.reset();
      if (spec.widthDraft) spec.onWidthDraft(null);
      else spec.onMenu(false);
    },
  }, width ? renderWidthScreen(spec, width) : renderSearchScreen(spec));
}

/** The search screen's list, in its order: the page's media queries, widths, states, the rest. */
function conditionSuggestions(spec: ConditionBarSpec): ValueSuggestion[] {
  const page: ValueSuggestion[] = spec.remaining.media.map((one) => ({
    value: one.key.slice('other:'.length),
    label: one.label,
    hint: one.note,
    icon: one.icon,
    group: 'Media queries on this page',
  }));
  const taken = [
    ...spec.chips.flatMap((one) => (one.media ? [one.media] : [])),
    ...spec.remaining.media.map((one) => one.key.slice('other:'.length)),
  ];
  const rest = mediaQuerySuggestions(taken, { typed: spec.mediaDraft ?? '' })
    .map((one) => ({ ...one, icon: mediaIcon(one.value) }));
  const custom: ValueSuggestion = {
    value: CUSTOM_WIDTH,
    label: 'Custom width…',
    hint: 'max- or min-width',
    icon: 'plus',
    group: 'Width',
  };
  const states: ValueSuggestion[] = spec.remaining.states.map((one) => ({
    value: one.label,
    label: one.label,
    // Under its group's name already; only the size it lands at is worth saying.
    hint: one.note ? `at ${one.note}` : undefined,
    icon: 'cursor',
    group: 'States',
  }));
  const pseudos = spec.remaining.pseudos;
  if (!pseudos) {
    return [
      ...page,
      ...rest.filter((one) => one.group === 'Width'),
      custom,
      ...states,
      ...rest.filter((one) => one.group !== 'Width'),
    ];
  }
  /*
   * The panel's strip: the three kinds it holds, each under its own caption, in the order the
   * strip draws them (states, sizes, pseudo-elements), then the other common media queries.
   */
  const sizes = [...page, ...rest.filter((one) => one.group === 'Width'), custom].map((one) => ({ ...one, group: 'Sizes' }));
  const parts: ValueSuggestion[] = pseudos.map((one) => ({
    value: one.label,
    label: one.label,
    hint: EDITABLE_STATES.find((state) => state.name === one.label)?.hint ?? (one.note ? `at ${one.note}` : undefined),
    icon: 'pseudo',
    group: 'Pseudo-elements',
  }));
  return [...states, ...sizes, ...parts, ...rest.filter((one) => one.group !== 'Width')];
}

function renderSearchScreen(spec: ConditionBarSpec): TemplateResult {
  const stateKey = (text: string): string | null => {
    const bare = text.trim().replace(/^:+/, '');
    const name = `:${bare}`;
    return spec.remaining.states.find((one) => one.label === name)?.key ??
      spec.remaining.pseudos?.find((one) => one.label === `::${bare.toLowerCase()}`)?.key ?? null;
  };
  const add = (key: string): void => {
    spec.onMenu(false, !conditionParts(key).state);
    spec.onAdd(key);
  };
  /*
   * What Enter or a pick adds: a row's value, or what was typed. Typed text is checked first, so a
   * query that could never match ("dark", "(max-width: 600)") is refused with the reason, and the
   * best row is offered in its place only when the text was a search for it.
   */
  const submit = (text: string, field: HeoValueField | null): void => {
    const typed = text.trim();
    if (typed === CUSTOM_WIDTH) {
      spec.mediaForm.reset();
      spec.onWidthDraft({ side: 'max', text: '' });
      return;
    }
    const state = stateKey(typed);
    if (state) {
      add(state);
      return;
    }
    spec.onMediaDraft(typed);
    const looksLikeAQuery = /[(:]/.test(typed) || /^(?:only|not)\s/i.test(typed);
    const best = looksLikeAQuery ? undefined : bestRow(typed, field);
    if (best) {
      submit(best.value, null);
      return;
    }
    if (!spec.mediaForm.submit()) return;
    spec.onMediaDraft(null);
    add(spec.keyForMedia(typed.replace(/^@media\s+/i, '')));
  };
  return renderSearchField({
    form: spec.mediaForm,
    name: MEDIA_FIELD,
    fieldLabel: spec.remaining.pseudos ? 'Search states, sizes and pseudo-elements' : 'Search media queries and states',
    placeholder: spec.remaining.pseudos ? 'hover, max 600, print, before…' : 'print, max 600, dark, hover…',
    suggestions: conditionSuggestions(spec),
    createLabel: addMediaLabel(spec.mediaDraft ?? ''),
    createTitle: ADD_MEDIA_TITLE,
    onInput: (text) => spec.onMediaDraft(text),
    onSubmit: submit,
  });
}

/** `(max-width: 600px)` for a side and a typed width (`600`, `600px`). */
function widthQuery(side: 'max' | 'min', text: string): string {
  const raw = text.trim();
  return `(${side}-width: ${/^\d+(?:\.\d+)?$/.test(raw) ? `${raw}px` : raw || '…'})`;
}

/**
 * "Custom width…": a side (Max. or Min.), a width in px (one of the bar's viewport sizes, picked
 * as in the preview bar, or typed, its gauge dragged like a spacing) and the exact query it makes.
 * Add checks it like any typed query and puts it on the bar; Cancel goes back to the search.
 */
function renderWidthScreen(spec: ConditionBarSpec, width: { side: 'max' | 'min'; text: string }): TemplateResult {
  const set = (next: Partial<typeof width>): void => {
    spec.mediaForm.reset();
    spec.onWidthDraft({ ...width, ...next });
  };
  const query = widthQuery(width.side, width.text);
  const cancel = (): void => {
    spec.mediaForm.reset();
    spec.onWidthDraft(null);
  };
  const submit = (text = width.text): void => {
    const made = widthQuery(width.side, text);
    const problem = text.trim() ? mediaQueryProblem(made) : 'Pick a viewport size or type a width.';
    if (problem) {
      spec.mediaForm.fail(WIDTH_FIELD, problem);
      return;
    }
    spec.onWidthDraft(null);
    spec.onMenu(false);
    spec.onAdd(spec.keyForMedia(made));
  };
  const px = Number.parseFloat(width.text);
  const sizes: SegmentOption[] = spec.viewports.map((one) => ({
    value: String(one.width),
    icon: one.icon,
    label: String(one.width),
    title: `${one.width}px`,
  }));
  return html`
    <p class="chead">Custom width</p>
    <heo-segmented
      label="Max-width or min-width"
      .options=${[
      { value: 'max', label: 'Max.', title: 'max-width: at this width and narrower' },
      { value: 'min', label: 'Min.', title: 'min-width: at this width and wider' },
    ]}
      .value=${width.side}
      @segment-change=${(event: CustomEvent<{ value: string }>) =>
      event.detail.value && set({ side: event.detail.value as 'max' | 'min' })}
    ></heo-segmented>
    <heo-value-field
      ${field(spec.mediaForm, WIDTH_FIELD, { required: true })}
      kind="length"
      fixed-unit="px"
      field-label="Width in pixels"
      placeholder="600px"
      .value=${width.text}
      .computed=${width.text}
      ${ref(focusWidthField)}
      @value-input=${(event: CustomEvent<{ value: string }>) => set({ text: event.detail.value })}
      @value-change=${(event: CustomEvent<{ value: string }>) => set({ text: event.detail.value })}
      @keydown=${(event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      // The field has committed its text by now: Enter is Add.
      event.preventDefault();
      submit(((event.composedPath()[0] as HTMLInputElement).value ?? width.text));
    }}
    ></heo-value-field>
    ${spec.mediaForm.error(WIDTH_FIELD)}
    <p class="ccap">Viewport sizes</p>
    <heo-segmented
      label="Use a viewport size"
      .options=${sizes}
      .value=${sizes.some((one) => Number(one.value) === px) ? String(px) : ''}
      ?wrap=${sizes.length > 4}
      @segment-change=${(event: CustomEvent<{ value: string }>) => set({ text: event.detail.value ? `${event.detail.value}px` : '' })}
    ></heo-segmented>
    <p class="cwill" aria-live="polite">
      <code>@media ${query}</code>
      ${width.side === 'max' ? 'at this width and narrower' : 'at this width and wider'}
    </p>
    <footer class="cfoot">
      <button class="btn sm" type="button" @click=${cancel}>Cancel</button>
      <button class="btn sm primary" type="button" data-act="add-width" @click=${() => submit()}>
        ${icon('plus', 12)} Add
      </button>
    </footer>`;
}

/** Focus the width field as the width panel appears. */
function focusWidthField(el?: Element): void {
  if (!(el instanceof HeoValueField) || el.dataset.focused) return;
  el.dataset.focused = '1';
  void el.updateComplete.then(() => requestAnimationFrame(() => el.focusInput()));
}

/**
 * Where a media condition just added can be seen: `here` at the current preview, else the width to
 * preview (one inside its bound), or null for Actual when no previewable width has it in effect.
 *
 * The bar leaves out what is not in effect at the previewed width, so a `(max-width: 320px)` added
 * while previewing 768px used to land and vanish in the same moment.
 */
export function previewToShow(media: string, previewWidth: number | null): number | null | 'here' {
  if (previewWidth === null || mediaApplies(media, previewWidth)) return 'here';
  const bound = widthBound(media);
  if (bound) {
    const at = bound.side === 'max' ? Math.floor(bound.px) : Math.ceil(bound.px);
    if (at >= MIN_VIEWPORT && at <= MAX_VIEWPORT && mediaApplies(media, at)) return at;
  }
  return null;
}

/** The issues the strip's media field is checked against. */
export function stripMediaIssues(draft: string | null): ReturnType<typeof mediaQueryIssues> {
  return draft === null ? [] : mediaQueryIssues(MEDIA_FIELD, draft);
}

export const sizeStripStyles: CSSResult = css`
  .slots {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin: 0 0 8px;
    padding: 2px;
    border: 1px solid var(--heo-line);
    border-radius: var(--heo-r-md);
    background: var(--heo-sunken);
  }
  .slots button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--heo-r-sm);
    background: transparent;
    color: var(--heo-text-dim);
    font-family: var(--heo-mono);
    font-size: 10px;
    white-space: nowrap;
    cursor: pointer;
  }
  .slots button:hover {
    background: var(--heo-hover);
    color: var(--heo-text);
  }
  .slots button[aria-pressed='true'] {
    background: var(--heo-raised);
    box-shadow: var(--heo-shadow-sm);
    color: var(--heo-text);
  }
  .slots button:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  .slots .base {
    font-family: var(--heo-font);
    font-size: 10.5px;
  }
  .slots .c {
    color: var(--heo-accent-text);
  }
  .slots .empty .c,
  .slots .base .c {
    color: var(--heo-text-dim);
  }
  /* Not in effect at this width: dashed, with the ink kept (no fade). */
  .slots .notnow:not([aria-pressed='true']) {
    border-style: dashed;
    border-color: var(--heo-line-strong);
  }
  /* A state or a media query that is not a size reads by name; long ones are cut, the title has all. */
  .slots .n {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .slots .named .c {
    margin-left: 1px;
  }
  /* The picked condition and its ×, as a class chip and its cross in the header. */
  .slots .cchip-on {
    display: inline-flex;
    align-items: center;
    border-radius: var(--heo-r-sm);
    background: var(--heo-raised);
    box-shadow: var(--heo-shadow-sm);
  }
  .slots .cchip-on > button[aria-pressed='true'] {
    box-shadow: none;
    padding-right: 3px;
  }
  .slots .ckill {
    width: 16px;
    height: 16px;
    margin-right: 3px;
    padding: 0;
    border-radius: 999px;
    color: var(--heo-text-dim);
  }
  .slots .ckill:hover {
    background: var(--heo-line-strong);
    color: var(--heo-text);
  }
  /* The "+": a round outlined chip, as the header's "+" after the classes is. */
  .slots .add {
    width: 22px;
    padding: 0;
    border-color: var(--heo-line-strong);
    border-radius: 999px;
    color: var(--heo-text-dim);
  }
  .slots .add[aria-expanded='true'] {
    border-color: var(--heo-accent-line);
    color: var(--heo-text);
  }
  /* The custom width panel, in the "+" popover's box (search-popover.ts). */
  .menu.condpop .chead {
    margin: 0;
    color: var(--heo-text);
    font-size: 11px;
    font-weight: 600;
  }
  /* The same caption as a group in the search screen's list. */
  .menu.condpop .ccap {
    margin: 2px 0 -2px;
    color: var(--heo-text-faint);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .menu.condpop .cwill {
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.5;
  }
  .menu.condpop .cwill code {
    color: var(--heo-text);
    font-family: var(--heo-mono);
  }
  /* Cancel and Add at the foot, as every form of the overlay ends. */
  .menu.condpop .cfoot {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: auto;
    padding-top: 4px;
  }
`;
