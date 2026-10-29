import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { isPseudoElement, mediaShort } from '../../../core/breakpoints.js';
import type { Contribution, ElementModel } from '../../../core/cascade.js';
import { buildSuggestions, valueKindFor } from '../../suggestions.js';
import { icon } from '../../icons.js';
import { renderPromote } from './promote.js';
import {
  reachText,
  readRow,
  shortLabel,
  shownValue,
  slotWidth,
  sourceLabel,
  targetOf,
  type RowSpec,
} from './property-row.js';
import type { StylesHost, StylesUiState } from './types.js';

/**
 * Everything that declares one property for this element, winner first.
 *
 * The answer to "why is it this value", and the place to change any of the answers: each line
 * edits the declaration it shows, in the rule it lives in, so fixing the shared rule is as close
 * at hand as overriding it on this element. Losers are struck, idle ones (another size, a state)
 * are listed apart, and a property nothing declares says where its value comes from instead.
 */

type Popover = NonNullable<StylesUiState['popover']>;

/** The popover for a row: the row's element and model, and what the panel needs to place it. */
export function renderCascadePopover(
  state: Popover,
  host: StylesHost,
  element: HTMLElement,
  model: ElementModel,
): TemplateResult {
  const { scope, property } = state;
  const spec: RowSpec = { property, scope, element, model, listId: '' };
  const { list } = readRow(spec);
  const ctx = scope.kind === 'state'
    ? scope.state
    : scope.kind === 'size'
      ? (() => {
        const slot = model.slots().find((one) => one.key === scope.slot);
        return slot ? mediaShort(slot.media) : '';
      })()
      : '';
  const at = scope.kind === 'size' ? slotWidth(model, scope.slot) : host.previewWidth;

  /*
   * Not in effect now, but declared: other sizes and states at Actual, other states while
   * previewing (a rule for another width is hidden then, like everywhere else). Element rows only:
   * a size or state group already is one of those.
   */
  const elementScope = scope.kind === 'element' || scope.kind === 'section' || scope.kind === 'parent';
  const idle = elementScope
    ? list.idle.filter((one) => {
      if (one.source.kind !== 'rule') return false;
      const entry = one.source.entry;
      if (isPseudoElement(entry.state)) return false;
      return host.previewWidth === null || (entry.state !== '' && model.applies(entry));
    })
    : [];
  const all = [...list.applying, ...idle];
  const notes = [
    all.some((one) => one.source.kind === 'rule' && one.source.entry.container)
      ? "Depends on its container; the editor can't tell."
      : '',
    all.some((one) => one.source.kind === 'rule' && one.source.entry.layered)
      ? 'In a cascade layer: order may differ.'
      : '',
    host.previewWidth !== null && all.some((one) => /\dvw\b/.test(one.value))
      ? 'Values in vw follow the real window, not the preview.'
      : '',
  ].filter(Boolean);

  return html`<div
    class="pop"
    role="dialog"
    popover="manual"
    tabindex="-1"
    data-pop=${state.rowId}
    aria-label=${`Cascade for ${property}${ctx ? ` ${ctx}` : ''}`}
  >
    <div class="cap">
      <b>${property}${ctx ? html` <span class="ctx">${ctx}</span>` : nothing}</b>
      <span>winner first${at !== null ? ` · at ${at}px` : ''}</span>
    </div>
    <div class="lines" role="list">
      ${list.applying.map((one, index) => renderLine(one, index === 0 ? 'win' : 'lost', host, element, model, property))}
    </div>
    ${list.applying.length ? nothing : renderUndeclared(host, element, model, property)}
    ${idle.length
      ? html`<p class="sub">${host.previewWidth === null ? 'At other sizes or states' : 'In other states'}</p>
          <div class="lines" role="list">
            ${idle.map((one) => renderLine(one, 'idle', host, element, model, property))}
          </div>`
      : nothing}
    ${notes.map((note) => html`<p class="note">${note}</p>`)}
  </div>`;
}

function renderLine(
  one: Contribution,
  kind: 'win' | 'lost' | 'idle',
  host: StylesHost,
  element: HTMLElement,
  model: ElementModel,
  property: string,
): TemplateResult {
  const engine = host.engine;
  const target = targetOf(one, element);
  const entry = one.source.kind === 'rule' ? one.source.entry : null;
  const label = sourceLabel(one);
  const reach = entry ? model.reach(entry.family) : 1;
  const why = entry && kind === 'idle'
    ? entry.state
      ? ` (only on ${entry.state})`
      : entry.media
        ? ` (only at ${mediaShort(entry.media)})`
        : ''
    : '';
  // A longhand supplied by a shorthand is not declared by that name, so there is nothing to toggle.
  const readonly = target.kind === 'readonly'
    ? target.reason
    : one.via
      ? `Declared through ${one.via}`
      : undefined;
  return html`<div class="pl" role="listitem">
    <div class=${`c-line ${kind}`}>
      <span
        class="cdot"
        aria-hidden="true"
        title=${kind === 'win' ? 'Applies' : kind === 'lost' ? 'Overridden' : why.trim()}
      ></span>
      ${entry
      ? html`<button
            class="src"
            type="button"
            title=${`Edit ${label}${why}`}
            @click=${() => host.openSource(property, entry)}
          >
            <span>${shortLabel(one)}</span>${icon('arrowRight', 10)}
          </button>`
      : html`<span class="src"><span>inline style</span></span>`}
      <heo-value-field
        data-property=${property}
        .value=${shownValue(one)}
        ?important=${one.important}
        ?important-removable=${!readonly}
        .kind=${valueKindFor(property)}
        .property=${property}
        .suggestions=${buildSuggestions(engine, property, element)}
        @value-input=${(event: CustomEvent<{ value: string }>) =>
      engine.previewDeclaration(target, property, event.detail.value)}
        @value-revert=${() => engine.cancelPreview()}
        @value-change=${(event: CustomEvent<{ value: string }>) =>
      engine.setDeclaration(target, property, event.detail.value)}
        @important-change=${() => engine.setImportance(target, property, false)}
      ></heo-value-field>
      ${renderPromote({
        property,
        source: label,
        important: one.important,
        disabled: readonly,
        onToggle: (next) => engine.setImportance(target, property, next),
      })}
    </div>
    <span class="where">
      Edits <b>${label}</b> · ${entry ? reachText(reach) : 'this element only'}${entry?.media
      ? `, at ${mediaShort(entry.media)}`
      : ''}
    </span>
  </div>`;
}

/** Nothing declares it: say where the value comes from, and what typing one would do. */
function renderUndeclared(
  host: StylesHost,
  element: HTMLElement,
  model: ElementModel,
  property: string,
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
    Typing a value adds it inline.
  </p>`;
}

export const popoverStyles: CSSResult = css`
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
    --ring: var(--heo-raised);
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
  .pop .lines {
    display: grid;
    gap: 5px;
  }
  .pop .sub {
    margin: 4px 0 0;
    padding-top: 6px;
    border-top: 1px solid var(--heo-line);
    color: var(--heo-text-dim);
    font-size: 10px;
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
  .c-line {
    display: grid;
    grid-template-columns: 6px minmax(0, 0.9fr) minmax(0, 1.6fr) 18px;
    gap: 3px 7px;
    align-items: center;
  }
  .c-line .cdot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--heo-accent);
  }
  .c-line.lost .cdot {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--heo-accent);
  }
  .c-line.idle .cdot {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--heo-text-dim);
  }
  .c-line .src {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--heo-text-dim);
    font-family: var(--heo-mono);
    font-size: 10.5px;
    text-align: left;
    white-space: nowrap;
  }
  .c-line .src span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .c-line button.src {
    border-radius: 4px;
    cursor: pointer;
  }
  .c-line button.src:hover {
    color: var(--heo-text);
  }
  .c-line button.src:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  /* Overridden: struck through, in the dim ink (never fainter, so it stays readable). */
  .c-line.lost .src span {
    text-decoration: line-through;
  }
  .c-line.idle .src span {
    font-style: italic;
  }
  .pop .pl > .where {
    display: none;
    padding-left: 13px;
    color: var(--heo-text-dim);
    font-size: 10px;
  }
  .pop .pl:focus-within > .where {
    display: block;
  }
  .pop .pl > .where b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-weight: 400;
  }
`;
