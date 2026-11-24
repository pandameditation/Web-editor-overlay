import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { conditionContext, inactivePlaces, placeConditionKey, placeOutcome, type Place, type PlaceCondition } from '../../../core/cascade-places.js';
import type { ElementModel } from '../../../core/cascade.js';
import { normalizeClassName } from '../../../core/classes.js';
import { splitImportant } from '../../../core/declaration-list.js';
import { shortLabel } from '../../../core/save-plan.js';
import { buildSuggestions, valueKindFor } from '../../suggestions.js';
import { ladderStyles, renderLadder, renderResult } from './ladder.js';
import { renderPromote } from './promote.js';
import { conditionKey, conditionName } from './size-strip.js';
import { readRow, rowIdOf, rowPlace, scopeOfCondition, shownValue, submitNewClassName, type RowSpec } from './property-row.js';
import type { StylesHost, StylesUiState } from './types.js';

/**
 * The cascade menu of one row: the property's ladder (design J), strongest first.
 *
 * The answer to "why is it this value", and the place to decide where an edit goes: every place
 * that holds the property or could, with the one the element renders with marked "now". Picking a
 * rung makes the row (and its rich editor) edit that place, and opens the place's own value field
 * right under it, with `!important` and a line saying whether a value there applies, what it beats
 * or what hides it, and how many elements it changes. A property nothing declares says where its
 * value comes from first.
 */

type Popover = NonNullable<StylesUiState['popover']>;

/** The form field of the new-class rung's name. */
export const NEW_CLASS_FIELD = 'new-class';

/** The popover for a row: the row's element and model, and what the panel needs to place it. */
export function renderCascadePopover(
  state: Popover,
  host: StylesHost,
  element: HTMLElement,
  model: ElementModel,
): TemplateResult {
  const { scope, property, rowId } = state;
  const spec: RowSpec = { property, scope, element, model, listId: '' };
  const { list } = readRow(spec);
  const choice = rowPlace(spec, host, rowId);
  const { cond, picked } = choice;
  // The condition the row is read under: `≥768px`, `@media print`, `:hover`, `:hover ≥768px`.
  const ctx = scope.kind === 'state'
    ? conditionName(model, conditionKey(scope.slot ?? 'base', scope.state))
    : scope.kind === 'size'
      ? conditionName(model, scope.slot)
      : '';
  // The width the ladder is read at: the page's while its condition is on screen, else its slot's.
  const at = cond.media.startsWith('other:') ? null : conditionContext(model, cond).width ?? host.previewWidth;
  const inactive = inactivePlaces(model, property, cond);
  const all = [...list.applying, ...inactive];
  const notes = [
    all.some((one) => one.source.kind === 'rule' && one.source.entry.container)
      ? "Depends on its container; the editor can't tell."
      : '',
    all.some((one) => one.source.kind === 'rule' && one.source.entry.layered)
      ? 'In a cascade layer: order may differ.'
      : '',
  ].filter(Boolean);

  const pick = (key: string, keyboard: boolean): void => {
    host.engine.cancelPreview();
    const places = new Map(host.ui.places);
    places.set(rowId, key);
    host.patch({ places });
    // An arrow key moves along the group; a press goes to the value it opened.
    host.focusSelector(keyboard
      ? `.pop [role="radio"][data-place="${CSS.escape(key)}"], .pop [data-place="${CSS.escape(key)}"] [role="radio"]`
      : '.pop .open heo-value-field');
  };
  const draft = host.ui.newClass?.rowId === rowId ? host.ui.newClass.name : '';

  return html`<div
    class="pop"
    role="dialog"
    popover="manual"
    tabindex="-1"
    data-pop=${rowId}
    aria-label=${`Cascade for ${property}${ctx ? ` ${ctx}` : ''}`}
  >
    <div class="cap">
      <b>${property}${ctx ? html` <span class="ctx">${ctx}</span>` : nothing}</b>
      <span>${at !== null ? `at ${at}px` : ''}</span>
    </div>
    ${list.applying.length ? nothing : renderUndeclared(host, element, model, property, cond.media === 'base' && !cond.state)}
    ${renderLadder({
    property,
    label: 'Strongest first',
    places: choice.places,
    picked: picked.key,
    /*
     * An empty place, when something applies, keeps the focus on its radio: focused, its field
     * opened the suggestion list on every pick, and the eye followed it. The placeholder shows the
     * value that applies, the eyedropper writes it, and a click in the field types as before.
     */
    onPick: (place, keyboard) => pick(place.key, keyboard || (!place.declared && list.applying.length > 0)),
    open: (place) => renderOpen(place, host, spec, rowId, cond, list.applying[0]?.value),
    inactive,
    // A size not in effect here: the strip goes to it, and this menu with it, its rung now in effect.
    onPickInactive: (one) => {
      if (one.source.kind !== 'rule') return;
      const entry = one.source.entry;
      const key = conditionKey(model.slotOf(entry), entry.state);
      const next = scopeOfCondition(key);
      const id = rowIdOf(next, property, host.element);
      host.engine.cancelPreview();
      host.patch({ cond: key, popover: { scope: next, property, rowId: id } });
      host.focusSelector(`.pop [role="radio"][aria-checked="true"]`);
    },
    newClass: {
      draft,
      onDraft: (text) => host.patch({ newClass: { rowId, name: text } }),
      onSubmit: (text, rung) => {
        host.patch({ newClass: { rowId, name: text } });
        if (!host.newClassForm.submit()) return;
        pick(submitNewClassName(host, element, text, rung), false);
      },
      form: host.newClassForm,
      field: NEW_CLASS_FIELD,
    },
  })}
    ${notes.map((note) => html`<p class="note">${note}</p>`)}
  </div>`;
}

/**
 * Under the picked rung: the place's own value field, its `!important`, and the result line. A set
 * place edits its declaration where it is; an empty one writes the first value there (creating the
 * rule or the class), with `!important` when that was asked for first. An empty place shows the
 * value that applies as its placeholder, and its eyedropper writes that same value here.
 */
function renderOpen(
  place: Place,
  host: StylesHost,
  spec: RowSpec,
  rowId: string,
  cond: PlaceCondition,
  winnerValue: string | undefined,
): TemplateResult {
  const engine = host.engine;
  const { property, element, model } = spec;
  const target = place.target;
  if (target?.kind === 'readonly') {
    return html`<p class="note">Read-only here: ${target.reason}</p>`;
  }
  const declared = place.declared;
  const pendingKey = `${rowId}|${place.key}`;
  const pending = host.ui.pendingImportant.has(pendingKey);
  const important = declared ? declared.important : pending;
  // A longhand supplied by a shorthand is not declared by that name, so there is nothing to toggle.
  const via = declared?.via ? `Declared through ${declared.via}` : undefined;
  const setPending = (next: boolean): void => {
    const set = new Set(host.ui.pendingImportant);
    if (next) set.add(pendingKey);
    else set.delete(pendingKey);
    host.patch({ pendingImportant: set });
  };
  const toggle = (next: boolean): void => {
    if (declared && target) engine.setImportance(target, declared.via ?? property, next);
    else setPending(next);
  };
  const preview = (text: string): void => {
    if (target?.kind === 'inline') engine.previewStyle(property, text, element);
    else if (target) engine.previewDeclaration(target, property, text);
  };
  const commit = (text: string): void => {
    engine.cancelPreview();
    const typed = splitImportant(text);
    if (declared && target) {
      if (!typed.value) return;
      engine.setDeclaration(target, property, text);
      return;
    }
    if (!typed.value) return;
    const written = pending && typed.important === null ? `${typed.value} !important` : text;
    if (pending) setPending(false);
    if (place.key.startsWith('new-class|')) {
      // The class exists once written: the row edits it from then on, under its own key.
      const places = new Map(host.ui.places);
      const name = place.dest.kind === 'auto-class' && place.dest.name ? normalizeClassName(place.dest.name) : '';
      if (name) places.set(rowId, `.${CSS.escape(name)}|${placeConditionKey(cond)}`);
      else places.delete(rowId);
      host.patch({ places, newClass: null });
    }
    const { hint } = engine.writeDeclarationTo(place.dest, property, written);
    if (hint) engine.notify(hint, 'info');
  };
  // Judged under the ladder's condition: a rule at rest read under a hover competes with the hover.
  const outcome = placeOutcome(model, property, cond, place, important);
  const withImportant = placeOutcome(model, property, cond, place, true);
  return html`<div class="vrow">
      <heo-value-field
        data-property=${property}
        field-label=${`${property} in ${place.label}`}
        .value=${declared ? shownValue(declared) : ''}
        ?important=${Boolean(declared?.important)}
        ?important-removable=${Boolean(declared) && !via}
        .kind=${valueKindFor(property)}
        .property=${property}
        .suggestions=${buildSuggestions(engine, property, element)}
        placeholder=${winnerValue ?? getComputedStyle(element).getPropertyValue(property).trim()}
        .sample=${declared ? '' : winnerValue ?? ''}
        @value-input=${(event: CustomEvent<{ value: string }>) => preview(event.detail.value)}
        @value-revert=${() => engine.cancelPreview()}
        @value-change=${(event: CustomEvent<{ value: string }>) => commit(event.detail.value)}
        @important-change=${() => toggle(false)}
      ></heo-value-field>
      ${renderPromote({
    property,
    source: place.label,
    important,
    disabled: via,
    onToggle: toggle,
  })}
    </div>
    ${renderResult({
    place,
    outcome,
    wouldApplyImportant: withImportant.applies,
    important,
    onMakeImportant: () => toggle(true),
  })}`;
}

/** Nothing declares it: say where the value comes from, and what typing one would do. */
function renderUndeclared(
  host: StylesHost,
  element: HTMLElement,
  model: ElementModel,
  property: string,
  inline: boolean,
): TemplateResult {
  const resolved = getComputedStyle(element).getPropertyValue(property).trim();
  const from = model.inheritedFrom(property);
  const tag = from
    ? `${from.element.localName}${Array.from(from.element.classList)
      .filter((name) => !name.startsWith('heo-'))
      .map((name) => `.${name}`)
      .join('')}`
    : '';
  return html`<p class="none">
    Nothing declares it for this element${host.previewWidth !== null ? ` at ${host.previewWidth}px` : ''}.
    It resolves to <code>${resolved || 'nothing'}</code>,
    ${from
      ? html`inherited from <code>${tag}</code> (${shortLabel(from.contribution)})`
      : html`the browser's default`}.
    ${inline ? 'Typing a value adds it inline.' : nothing}
  </p>`;
}

export const popoverStyles: CSSResult[] = [ladderStyles, css`
  .pop {
    position: fixed;
    inset: auto;
    margin: 0;
    display: grid;
    gap: 5px;
    min-width: 280px;
    overflow-y: auto;
    padding: 8px 10px 9px;
    border: 1px solid var(--heo-line-strong);
    border-radius: var(--heo-r-md);
    background: var(--heo-raised);
    box-shadow: var(--heo-shadow-lg);
    color: var(--heo-text);
  }
  .pop:focus {
    outline: none;
  }
  .pop .cap {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 1px;
    color: var(--heo-text-dim);
    font-size: 10px;
  }
  .pop .cap b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10.5px;
    font-weight: 400;
  }
  .pop .cap .ctx {
    color: var(--heo-text-dim);
  }
  .pop .none,
  .pop .note {
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.5;
  }
  .pop .none code {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-size: 10.5px;
  }
`];
