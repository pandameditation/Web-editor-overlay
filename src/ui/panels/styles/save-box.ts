import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { plural, type SaveContext, type SaveOption } from '../../../core/save-plan.js';
import { framedBox } from '../../theme.js';
import type { PendingSave, StylesHost } from './types.js';

/**
 * "Save p: v to…": where a viewport-dependent value should stay, asked after it is entered.
 *
 * After, never before: the value is the thing the user came to change, and the question of where
 * it lives only makes sense once there is something to place. So the row keeps the entered value
 * in a pending style, the page shows the highlighted option live, and nothing is committed until
 * Save. Cancelling restores the page exactly, with no history entry.
 *
 * The box owns this whole lifecycle (begin, pick, save, cancel), so a row, a box-editor batch and
 * a preview change all end a pending save the same way.
 */

/** Open the box for a value just entered: plan the options and preview the default one. */
export function beginSave(
  host: StylesHost,
  rowId: string,
  label: string,
  ctx: SaveContext,
  focus: boolean,
): void {
  const engine = host.engine;
  engine.cancelPreview();
  const plan = engine.planViewportSave(ctx);
  const option = plan.options[0];
  if (!option) return;
  engine.previewSaveOption(ctx, option);
  host.patch({ pending: { rowId, label, ctx, plan, selected: option.kind }, popover: null });
  if (focus) host.focusSelector('.savebox [role="radio"][aria-checked="true"]');
}

/** Put the page back as it was before the value was entered. */
export function cancelSave(host: StylesHost, refocus = false): void {
  const pending = host.ui.pending;
  if (!pending) return;
  host.engine.previewSaveOption(pending.ctx, null);
  host.patch({ pending: null });
  if (refocus) host.focusSelector(fieldOf(pending));
}

function optionOf(pending: PendingSave, kind = pending.selected): SaveOption | undefined {
  return pending.plan.options.find((one) => one.kind === kind);
}

/** Highlight another option, and show it on the page. */
function pick(host: StylesHost, pending: PendingSave, kind: SaveOption['kind']): void {
  const option = optionOf(pending, kind);
  if (!option) return;
  host.engine.previewSaveOption(pending.ctx, option);
  host.patch({ pending: { ...pending, selected: kind } });
}

function save(host: StylesHost, pending: PendingSave): void {
  const option = optionOf(pending);
  if (!option) return;
  host.patch({ pending: null });
  host.engine.saveViewportEdit(pending.ctx, option);
  host.focusSelector(fieldOf(pending));
}

/** The row's own field, for focus to go back to once the box closes. */
function fieldOf(pending: PendingSave): string {
  return pending.rowId.startsWith('box:')
    ? 'heo-box-editor'
    : `.row[data-row="${CSS.escape(pending.rowId)}"] heo-value-field`;
}

/** ↑/↓ (and ←/→) move and wrap, previewing as they go; Enter saves; Escape cancels and goes no further. */
export function saveBoxKeydown(event: KeyboardEvent, host: StylesHost): void {
  const pending = host.ui.pending;
  if (!pending) return;
  const kinds = pending.plan.options.map((one) => one.kind);
  const at = kinds.indexOf(pending.selected);
  const step = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    ? 1
    : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
      ? -1
      : 0;
  if (step) {
    event.preventDefault();
    pick(host, pending, kinds[(at + step + kinds.length) % kinds.length]);
    host.focusSelector('.savebox [role="radio"][aria-checked="true"]');
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancelSave(host, true);
    return;
  }
  // Enter on Save or Cancel is that button's own click.
  if (event.key === 'Enter' && !(event.target as HTMLElement).classList.contains('btn')) {
    event.preventDefault();
    save(host, pending);
  }
}

/** The option's title with its selector in mono: "The rule <b>.card ≥768px</b>". */
function titled(title: string): TemplateResult {
  const match = /(\.[\w-]+(?:[.:][\w-]+)*(?: [≤≥]\d+(?:\.\d+)?px)?)/.exec(title);
  if (!match) return html`${title}`;
  const at = match.index;
  return html`${title.slice(0, at)}<b>${match[1]}</b>${title.slice(at + match[1].length)}`;
}

export function renderSaveBox(pending: PendingSave, host: StylesHost): TemplateResult {
  const entries = Object.entries(pending.ctx.declarations);
  const what = entries.length === 1 ? `${entries[0][0]}: ${entries[0][1]}` : pending.label;
  const selected = optionOf(pending);
  // Where the value would show: the slot's own width, so the note can say what to preview.
  const shownAt = host.model.slots().find((slot) => slot.key === pending.ctx.slot)?.at ?? null;
  return html`<div
    class="savebox"
    role="group"
    aria-label=${`Where to save ${pending.label}`}
    @keydown=${(event: KeyboardEvent) => saveBoxKeydown(event, host)}
  >
    <p class="q">Save <b>${what}</b> to…</p>
    <div class="opts" role="radiogroup" aria-label="Where to save">
      ${pending.plan.options.map((option) => {
    const checked = option.kind === pending.selected;
    const verdict = option.verdict.wins
      ? html`<span class="win">applies</span>`
      : option.verdict.by === 'unknown'
        ? html`<span class="lose">can't tell</span>`
        : html`<span class="lose">won't show: ${option.verdict.by} wins</span>`;
    return html`<button
          class="opt"
          type="button"
          role="radio"
          aria-checked=${checked ? 'true' : 'false'}
          tabindex=${checked ? '0' : '-1'}
          data-kind=${option.kind}
          @click=${() => pick(host, pending, option.kind)}
          @dblclick=${() => save(host, { ...pending, selected: option.kind })}
        >
          <span class="radio" aria-hidden="true"></span>
          <span class="t">${titled(option.title)}</span>
          <span class="r"><b>${option.reach}</b> ${plural(option.reach, 'element')}</span>
          <span class="s">${option.sub} · ${verdict}</span>
        </button>`;
  })}
    </div>
    ${selected && !selected.visibleNow
      ? html`<p class="notnow">
          Not visible at ${host.model.width}px.${shownAt ? ` Preview ${shownAt} to see it.` : ''}
        </p>`
      : nothing}
    <div class="foot">
      <button class="btn sm primary" type="button" @click=${() => save(host, pending)}>Save</button>
      <button class="btn sm" type="button" @click=${() => cancelSave(host, true)}>Cancel</button>
      <span class="spacer"></span>
      <span class="hint">Enter saves · Esc cancels</span>
    </div>
  </div>`;
}

export const saveBoxStyles: CSSResult = css`
  .savebox {
    display: grid;
    gap: 4px;
    margin: 5px 0 3px;
    padding: 8px;
    ${framedBox}
  }
  .savebox .q {
    margin: 0 0 2px;
    color: var(--heo-text-dim);
    font-size: 11px;
  }
  .savebox .q b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-weight: 400;
  }
  .savebox .opts {
    display: grid;
    gap: 2px;
  }
  .savebox .opt {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr) auto;
    gap: 2px 8px;
    align-items: start;
    width: 100%;
    padding: 6px 7px;
    border: 1px solid transparent;
    border-radius: var(--heo-r-sm);
    background: transparent;
    color: var(--heo-text);
    font-size: 11.5px;
    text-align: left;
    cursor: pointer;
  }
  .savebox .opt:hover {
    background: var(--heo-hover);
  }
  .savebox .opt[aria-checked='true'] {
    border-color: var(--heo-line-strong);
    background: var(--heo-raised);
  }
  .savebox .opt:focus-visible {
    outline: 2px solid var(--heo-focus-ring);
    outline-offset: 1px;
  }
  .savebox .radio {
    width: 12px;
    height: 12px;
    margin-top: 2px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1.5px var(--heo-text-dim);
  }
  .savebox .opt[aria-checked='true'] .radio {
    box-shadow:
      inset 0 0 0 1.5px var(--heo-accent),
      inset 0 0 0 3.5px var(--heo-raised),
      inset 0 0 0 6px var(--heo-accent);
  }
  .savebox .t b {
    font-family: var(--heo-mono);
    font-size: 11px;
    font-weight: 400;
  }
  .savebox .r {
    color: var(--heo-text-dim);
    font-size: 10.5px;
    white-space: nowrap;
  }
  .savebox .r b {
    color: var(--heo-text);
    font-family: var(--heo-mono);
    font-weight: 600;
  }
  .savebox .s {
    grid-column: 2 / -1;
    color: var(--heo-text-dim);
    font-size: 10.5px;
    line-height: 1.45;
  }
  .savebox .win {
    color: var(--heo-success-text);
  }
  .savebox .lose {
    color: var(--heo-warn-text);
  }
  .savebox .notnow {
    margin: 0;
    color: var(--heo-warn-text);
    font-size: 10.5px;
  }
  .savebox .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
  }
  .savebox .foot .spacer {
    flex: 1 1 auto;
  }
  .savebox .foot .hint {
    margin: 0;
    color: var(--heo-text-dim);
    font-size: 10px;
  }
`;
