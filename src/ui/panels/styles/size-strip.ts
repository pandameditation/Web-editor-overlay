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
import { renderMenu, type MenuItem } from './menu.js';
import { HeoValueField } from '../../controls/value-field.js';
import { mediaQuerySuggestions } from '../../suggestions.js';

/**
 * The conditions bar: "Always", then one button per condition that declares something here, and ⋮
 * for the rest.
 *
 * A condition is a size (`≤767px`), another media query (`@media print`), a state (`:hover`), or a
 * state under a media query (`:hover ≥768px`). Picking one shows what is declared under it, read as
 * though it were in effect, so a rule nobody is previewing still shows its values; pressing it
 * again goes back to Always. A condition that declares nothing has no button: ⋮ lists every one not
 * on the bar, and picking one there puts it on the bar to be filled. Pseudo-elements are not
 * conditions: they stay blocks under whichever condition is picked.
 *
 * Effective styles and every source card draw it, so picking looks and counts the same wherever it
 * is done. A media condition not in effect at the width the page renders at is drawn dashed, never
 * faded: it is still readable and still a choice.
 */

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

/** The condition a rule declares under. A pseudo-element's rule is a block under its media. */
export function conditionOf(model: ElementModel, entry: RuleEntry): string {
  const media = model.slotOf(entry);
  return isPseudoElement(entry.state) ? media : conditionKey(media, entry.state);
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
 * media condition not in effect there is left out, as its rules are.
 */
export function barConditions(
  model: ElementModel,
  entries: readonly RuleEntry[],
  previewWidth: number | null,
  extra: readonly string[] = [],
): { chips: BarChip[]; count(key: string): number } {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = conditionOf(model, entry);
    counts.set(key, (counts.get(key) ?? 0) + entry.declarations.length);
  }
  const count = (key: string): number => counts.get(key) ?? 0;
  const keys = new Set<string>();
  for (const [key, n] of counts) if (key !== 'base' && n > 0) keys.add(key);
  for (const key of extra) if (key !== 'base') keys.add(key);
  const visible = (key: string): boolean => {
    const media = slotMedia(model, key);
    return media === null || previewWidth === null || mediaApplies(media, previewWidth);
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

/**
 * What ⋮ offers: every condition not on the bar. Sizes not in effect at a previewed width are left
 * out, as they are from the bar.
 */
export function remainingConditions(
  model: ElementModel,
  onBar: readonly string[],
  previewWidth: number | null,
): { sizes: Array<{ key: string; icon: string; label: string }>; media: Array<{ key: string; icon: string; label: string; note: string }>; states: Array<{ key: string; label: string }> } {
  const taken = new Set(onBar);
  const fits = (media: string): boolean => previewWidth === null || mediaApplies(media, previewWidth);
  const sizes = model.slots()
    .filter((slot) => !taken.has(slot.key) && fits(slot.media))
    .map((slot) => ({ key: slot.key, icon: slot.icon, label: slot.name }));
  const media = collectPageMedia()
    .map((one) => ({ one, key: mediaKeyFor(model, one.media) }))
    .filter(({ one, key }) => key.startsWith('other:') && !taken.has(key) && fits(one.media))
    .map(({ one, key }) => ({ key, icon: mediaIcon(one.media), label: `@media ${one.media}`, note: countText(one.rules, 'rule') }));
  const states = EDITABLE_STATES
    .filter((one) => one.kind === 'state' && !taken.has(conditionKey('base', one.name)))
    .map((one) => ({ key: conditionKey('base', one.name), label: one.name }));
  return { sizes, media, states };
}

export interface ConditionBarSpec {
  /** `effective`, or a card's family key; ids and the menu derive from it. */
  owner: string;
  /** `base` or a condition key. */
  picked: string;
  alwaysCount: number;
  alwaysTitle: string;
  chips: readonly BarChip[];
  remaining: ReturnType<typeof remainingConditions>;
  menuOpen: boolean;
  /** The "Add a media query…" field's text, or null while it is closed. */
  mediaDraft: string | null;
  mediaForm: FormErrors;
  onPick(key: string): void;
  onMenu(open: boolean): void;
  onMediaDraft(text: string | null): void;
  /** A condition picked from ⋮, or a media query typed there: put it on the bar and pick it. */
  onAdd(key: string): void;
  /** The media key a typed query lands on. */
  keyForMedia(media: string): string;
}

/** The field name the bar's media field reports under. */
export const MEDIA_FIELD = 'media-query';

export function renderConditionBar(spec: ConditionBarSpec): TemplateResult {
  const menuId = `strip-${spec.owner}`;
  const close = (): void => spec.onMenu(false);
  const pick = (key: string): void => {
    spec.onAdd(key);
    close();
  };
  const remaining = spec.remaining;
  const groups = [
    {
      caption: 'Sizes',
      items: remaining.sizes.map((one): MenuItem => ({ key: one.key, icon: one.icon, label: one.label, onSelect: () => pick(one.key) })),
    },
    {
      caption: 'Media queries on this page',
      items: remaining.media.map((one): MenuItem => ({ key: one.key, icon: one.icon, label: one.label, note: one.note, onSelect: () => pick(one.key) })),
    },
    {
      caption: 'States',
      items: remaining.states.map((one): MenuItem => ({ key: one.key, icon: 'cursor', label: one.label, onSelect: () => pick(one.key) })),
    },
  ].filter((group) => group.items.length);
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
      Always <span class="c">${spec.alwaysCount}</span>
    </button>
    ${spec.chips.map((chip) => {
    const on = spec.picked === chip.key;
    return html`<button
        class=${`${chip.count ? '' : 'empty'}${chip.notNow ? ' notnow' : ''}${chip.label ? ' named' : ''}`}
        type="button"
        data-cond=${chip.key}
        data-slot=${chip.key}
        aria-pressed=${on ? 'true' : 'false'}
        aria-label=${`${chip.title.split(' — ')[0]}, ${countText(chip.count, 'declaration')}${on ? '. Press again for Always' : ''}`}
        title=${on ? `${chip.title}. Press again for Always` : chip.title}
        @click=${() => spec.onPick(on ? 'base' : chip.key)}
      >
        ${chip.icon ? icon(chip.icon, 12) : nothing}${chip.label ? html`<span class="n">${chip.label}</span>` : nothing}<span class="c">${chip.count ? `+${chip.count}` : '+'}</span>
      </button>`;
  })}
    <button
      class="more"
      type="button"
      aria-label="More conditions"
      title="More sizes, media queries and states"
      aria-haspopup="menu"
      aria-expanded=${spec.menuOpen ? 'true' : 'false'}
      data-menu-anchor=${menuId}
      @click=${() => spec.onMenu(!spec.menuOpen)}
    >
      ${icon('dots', 13)}
    </button>
  </div>
  ${spec.menuOpen
      ? renderMenu({
        id: menuId,
        label: 'More conditions',
        onClose: close,
        groups: [
          ...groups,
          {
            items: spec.mediaDraft === null
              ? [{
                key: 'add-media',
                icon: 'plus',
                label: 'Add a media query…',
                note: 'print, prefers-…',
                onSelect: () => spec.onMediaDraft(''),
              }]
              : [],
            after: spec.mediaDraft === null ? undefined : renderMediaField(spec),
          },
        ],
      })
      : nothing}`;
}

/**
 * "Add a media query…" as an inline field: the page's own conditions and the common queries that
 * are not sizes are offered as it opens and narrowed as it is typed; Enter or a pick adds it as a
 * slot, Escape puts the item back. The same submit field as the header's class finder.
 */
function renderMediaField(spec: ConditionBarSpec): TemplateResult {
  const submit = (text: string): void => {
    spec.onMediaDraft(text);
    if (!spec.mediaForm.submit()) return;
    const media = text.trim().replace(/^@media\s+/i, '');
    spec.onMediaDraft(null);
    spec.onAdd(spec.keyForMedia(media));
    spec.onMenu(false);
  };
  return html`<div
    class="mfield"
    @keydown=${{
    // Caught on the way down, as the class finder does: the field would take Escape as "revert"
    // and swallow it, leaving the field open and the next Escape to the menu.
    capture: true,
    handleEvent: (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      spec.mediaForm.reset();
      spec.onMediaDraft(null);
    },
  }}
  >
    <heo-value-field
      ${field(spec.mediaForm, MEDIA_FIELD, { required: true })}
      class="mono"
      action="Add media query"
      action-icon="plus"
      placeholder="print, (prefers-color-scheme: dark)"
      .suggestions=${mediaQuerySuggestions(spec.chips.flatMap((one) => (one.media ? [one.media] : [])))}
      .value=${''}
      ${ref(openMediaField)}
      @value-input=${(event: CustomEvent<{ value: string }>) => spec.onMediaDraft(event.detail.value)}
      @value-change=${(event: CustomEvent<{ value: string }>) => spec.onMediaDraft(event.detail.value)}
      @value-submit=${(event: CustomEvent<{ value: string }>) => submit(event.detail.value)}
    ></heo-value-field>
    ${spec.mediaForm.error(MEDIA_FIELD)}
  </div>`;
}

/** Focus the media field as it appears, with its suggestions showing. */
function openMediaField(el?: Element): void {
  if (!(el instanceof HeoValueField)) return;
  void el.updateComplete.then(() => requestAnimationFrame(() => {
    el.focusInput({ select: true });
    el.openList();
  }));
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
  .slots .more {
    margin-left: auto;
    width: 24px;
    padding: 0;
  }
  .slots .badge {
    margin-left: -2px;
    color: var(--heo-accent-text);
    font-size: 9px;
  }
  .menu .mfield {
    display: grid;
    gap: 4px;
    padding: 4px 6px 6px;
  }
`;
