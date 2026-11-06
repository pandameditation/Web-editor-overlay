import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { field, type FormErrors } from '../../form-errors.js';
import { HeoValueField, type ValueSuggestion } from '../../controls/value-field.js';

/**
 * A search and its list in one popover: what the conditions bar's "+" and "+ Add pseudo-element"
 * open, so the two look and behave as one thing.
 *
 * The field has focus and its list is showing as it appears, like the header's class finder; the
 * list narrows by words as it is typed, a pick or Enter answers it, and Escape steps back or
 * closes. The box keeps one height whatever the list holds, so it does not jump as it narrows, and
 * a screen that replaces the search (the custom width panel) fills the same box.
 *
 * Placed by the panel like its menus: `data-menu` on the popover, `data-menu-anchor` on what opened
 * it and, optionally, `data-menu-place` on what it should span.
 */

export interface SearchPopoverSpec {
  /** The menu id, unique in the panel. */
  id: string;
  label: string;
  /** Extra classes, for a popover's own screens (`condpop`). */
  kind?: string;
  /** Escape: step back a screen, or close. */
  onEscape(): void;
}

export function renderSearchPopover(spec: SearchPopoverSpec, content: TemplateResult): TemplateResult {
  return html`<div
    class=${`menu searchpop${spec.kind ? ` ${spec.kind}` : ''}`}
    role="dialog"
    popover="manual"
    data-menu=${spec.id}
    aria-label=${spec.label}
    @keydown=${{
    // Caught on the way down: a field would take Escape as "revert" and swallow it.
    capture: true,
    handleEvent: (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      spec.onEscape();
    },
  }}
  >
    ${content}
  </div>`;
}

export interface SearchFieldSpec {
  form: FormErrors;
  /** The field's name in `form`, which its errors are reported under. */
  name: string;
  fieldLabel: string;
  placeholder: string;
  suggestions: readonly ValueSuggestion[];
  /** What the list says when nothing matches and there is nothing to create. */
  emptyText?: string;
  /** The offer when nothing matches: `Add "…"`. Without it, `emptyText`. */
  createLabel?: string;
  createTitle?: string;
  onInput?(text: string): void;
  /** Enter, a pick, or the create offer: what was typed or picked. */
  onSubmit(text: string, field: HeoValueField): void;
}

/**
 * The search field. Its value is never fed back from the host: the field narrows its list only
 * while what is typed differs from its value, so a host that wrote each keystroke back into it
 * left the list unfiltered (the pseudo-element adder did, and typing "mar" still showed all nine).
 */
export function renderSearchField(spec: SearchFieldSpec): TemplateResult {
  return html`<heo-value-field
      ${field(spec.form, spec.name, { required: true })}
      class="mono"
      inline-list
      fuzzy
      leading-icon="search"
      action=${spec.fieldLabel}
      action-hidden
      field-label=${spec.fieldLabel}
      create-label=${spec.createLabel ?? nothing}
      create-title=${spec.createTitle ?? nothing}
      empty-text=${spec.emptyText ?? nothing}
      placeholder=${spec.placeholder}
      .suggestions=${spec.suggestions}
      .value=${''}
      ${ref(openSearchField)}
      @value-input=${(event: CustomEvent<{ value: string }>) => {
    spec.form.reset();
    spec.onInput?.(event.detail.value);
  }}
      @value-submit=${(event: CustomEvent<{ value: string }>) =>
    spec.onSubmit(event.detail.value, event.target as HeoValueField)}
    ></heo-value-field>
    ${spec.form.error(spec.name)}`;
}

/**
 * The row a search was looking for: the first the list shows for what is typed. None for an empty
 * search, where nothing was looked for: Enter there used to add whatever row came first.
 */
export function bestRow(text: string, field: HeoValueField | null): ValueSuggestion | undefined {
  return text.trim() ? field?.listMatches.find((one) => !one.info) : undefined;
}

/** Focus the search as it appears, with its list showing. */
function openSearchField(el?: Element): void {
  if (!(el instanceof HeoValueField)) return;
  void el.updateComplete.then(() => requestAnimationFrame(() => {
    el.focusInput({ select: true });
    el.openList();
  }));
}

export const searchPopoverStyles: CSSResult = css`
  /*
   * One box for every screen, its height kept as the list narrows. A height rather than a minimum,
   * so the placement's room still caps it in a short window. minmax-like zero minimums: a long
   * option would otherwise widen the field, and anything after it, past the edge.
   */
  .menu.searchpop {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 318px;
    padding: 8px;
  }
  .menu.searchpop heo-value-field,
  .menu.searchpop heo-segmented {
    flex: 0 0 auto;
    min-width: 0;
  }
`;
