import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { mediaIcon, mediaShort, type DeviceIcon } from '../../../core/breakpoints.js';
import type { ElementModel, RuleEntry } from '../../../core/cascade.js';
import { countText } from '../../../core/save-plan.js';
import { mediaQueryIssues } from '../../../core/validation.js';
import { mediaApplies } from '../../../core/viewport.js';
import { field, type FormErrors } from '../../form-errors.js';
import { icon } from '../../icons.js';
import { focusWhenOpened, renderMenu } from './menu.js';

/**
 * The one size strip: "All sizes", a button per breakpoint slot, and ⋮ for every other media query.
 *
 * Effective styles and every source card draw it, so picking a size looks and counts the same
 * wherever it is done. Each button says how many declarations sit at that size; a size with none
 * shows a plain "+", since picking it is how a first one gets added. A size not in effect at the
 * width the page renders at is drawn dashed, never faded: it is still readable and still a choice.
 */

export interface StripSlot {
  key: string;
  icon: DeviceIcon;
  name: string;
  count: number;
  notNow: boolean;
  title: string;
}

export interface StripOther {
  key: string;
  media: string;
  count: number;
  notNow: boolean;
}

export interface SizeStripSpec {
  /** `effective`, or a card's family key; ids and the menu derive from it. */
  owner: string;
  /** `base`, a slot key, or `other:<media>`. */
  picked: string;
  baseCount: number;
  baseTitle: string;
  /** Already narrowed to what is visible at the preview width. */
  slots: readonly StripSlot[];
  others: readonly StripOther[];
  /** The width the page renders at, for "not in effect at Npx". */
  width: number;
  menuOpen: boolean;
  /** The "Add a media query…" field's text, or null while it is closed. */
  mediaDraft: string | null;
  mediaForm: FormErrors;
  onPick(key: string): void;
  onMenu(open: boolean): void;
  onMediaDraft(text: string | null): void;
  onAddMedia(media: string): void;
}

/** The field name the strip's media field reports under. */
export const MEDIA_FIELD = 'media-query';

/**
 * A strip's buttons for a set of rules: one per slot visible at the preview width, then the other
 * media queries those rules (or the user, through "Add a media query…") use, each with its count.
 *
 * Effective styles passes the element's base rules, a card its family's visible members; the
 * counting, the visibility rule and the titles are the same for both, so they are written once.
 */
export function stripSizes(
  model: ElementModel,
  entries: readonly RuleEntry[],
  previewWidth: number | null,
  added: readonly string[] = [],
): { slots: StripSlot[]; others: StripOther[]; count(key: string): number } {
  const visible = (media: string): boolean => previewWidth === null || mediaApplies(media, previewWidth);
  const count = (key: string): number =>
    entries.filter((entry) => model.slotOf(entry) === key)
      .reduce((sum, entry) => sum + entry.declarations.length, 0);
  const slots = model.slots().filter((slot) => visible(slot.media)).map((slot) => {
    const n = count(slot.key);
    const notNow = !mediaApplies(slot.media, null);
    return {
      key: slot.key,
      icon: slot.icon,
      name: slot.name,
      count: n,
      notNow,
      title: `${slot.name}${n ? ` — ${countText(n, 'declaration')} at this size` : ' — none yet, click to add'}${notNow ? ` · not in effect at ${model.width}px` : ''}`,
    };
  });
  const media = new Set<string>();
  for (const entry of entries) {
    const key = model.slotOf(entry);
    if (key.startsWith('other:')) media.add(key.slice('other:'.length));
  }
  for (const one of added) media.add(one);
  const others = [...media].filter(visible).map((one) => ({
    key: `other:${one}`,
    media: one,
    count: count(`other:${one}`),
    notNow: !mediaApplies(one, null),
  }));
  return { slots, others, count };
}

/** The media query a strip key stands for: null for All sizes. */
export function slotMedia(model: ElementModel, key: string): string | null {
  if (key === 'base') return null;
  if (key.startsWith('other:')) return key.slice('other:'.length);
  return model.slots().find((one) => one.key === key)?.media ?? null;
}

/** How a strip key is named in text: `≤767px`, `@media print`, or nothing for All sizes. */
export function slotName(model: ElementModel, key: string): string {
  const media = slotMedia(model, key);
  if (media === null) return '';
  return key.startsWith('other:') ? `@media ${media}` : mediaShort(media);
}

export function renderSizeStrip(spec: SizeStripSpec): TemplateResult {
  const menuId = `strip-${spec.owner}`;
  const otherPicked = spec.picked.startsWith('other:');
  const visibleOthers = spec.others.length;
  return html`<div
    class="slots"
    role="group"
    aria-label="Sizes"
    data-heo-part="strip"
    data-strip=${spec.owner}
    data-menu-place=${menuId}
  >
    <button
      class="base"
      type="button"
      aria-pressed=${spec.picked === 'base' ? 'true' : 'false'}
      title=${spec.baseTitle}
      @click=${() => spec.onPick('base')}
    >
      All sizes <span class="c">${spec.baseCount}</span>
    </button>
    ${spec.slots.map(
    (slot) => html`<button
        class=${`${slot.count ? '' : 'empty'}${slot.notNow ? ' notnow' : ''}`}
        type="button"
        data-slot=${slot.key}
        aria-pressed=${spec.picked === slot.key ? 'true' : 'false'}
        aria-label=${`${slot.name}, ${slot.count} declarations`}
        title=${slot.title}
        @click=${() => spec.onPick(slot.key)}
      >
        ${icon(slot.icon, 12)}<span class="c">${slot.count ? `+${slot.count}` : '+'}</span>
      </button>`,
  )}
    <button
      class="more"
      type="button"
      aria-label="Other media queries"
      title=${`Other media queries${visibleOthers ? ` (${visibleOthers})` : ''}`}
      aria-haspopup="menu"
      aria-expanded=${spec.menuOpen ? 'true' : 'false'}
      aria-pressed=${otherPicked ? 'true' : 'false'}
      data-menu-anchor=${menuId}
      @click=${() => spec.onMenu(!spec.menuOpen)}
    >
      ${icon('dots', 13)}${visibleOthers ? html`<span class="badge">${visibleOthers}</span>` : nothing}
    </button>
  </div>
  ${spec.menuOpen
      ? renderMenu({
        id: menuId,
        label: 'Other media queries',
        onClose: () => spec.onMenu(false),
        groups: [
          {
            caption: 'Other media queries',
            items: spec.others.map((other) => ({
              key: other.key,
              icon: mediaIcon(other.media),
              label: `@media ${other.media}`,
              note: `${other.count} decl.${other.notNow ? ' · not now' : ''}`,
              onSelect: () => {
                spec.onPick(other.key);
                spec.onMenu(false);
              },
            })),
            after: spec.others.length ? undefined : html`<p class="cap">None yet.</p>`,
          },
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

/** "Add a media query…" as an inline field: Enter picks it as a slot, Escape puts the item back. */
function renderMediaField(spec: SizeStripSpec): TemplateResult {
  const submit = (): void => {
    if (!spec.mediaForm.submit()) return;
    const media = (spec.mediaDraft ?? '').trim().replace(/^@media\s+/i, '');
    spec.onMediaDraft(null);
    spec.onAddMedia(media);
    spec.onMenu(false);
  };
  return html`<div class="mfield">
    <input
      ${field(spec.mediaForm, MEDIA_FIELD, { required: true })}
      class="input mono"
      type="text"
      aria-label="Media query"
      placeholder="print, (prefers-color-scheme: dark)"
      spellcheck="false"
      autocomplete="off"
      .value=${spec.mediaDraft ?? ''}
      ${ref(focusWhenOpened)}
      @input=${(event: Event) => spec.onMediaDraft((event.target as HTMLInputElement).value)}
      @keydown=${(event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        spec.mediaForm.reset();
        spec.onMediaDraft(null);
      }
    }}
    />
    ${spec.mediaForm.error(MEDIA_FIELD)}
  </div>`;
}

/** The issues the strip's media field is checked against. */
export function stripMediaIssues(draft: string | null): ReturnType<typeof mediaQueryIssues> {
  return draft === null ? [] : mediaQueryIssues(MEDIA_FIELD, draft);
}

export const sizeStripStyles: CSSResult = css`
  .slots {
    display: flex;
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
