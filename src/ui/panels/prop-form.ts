import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import type { EditorEngine } from '../../core/editor.js';
import type { PropSpec } from '../../core/types.js';
import { buildSuggestions } from '../suggestions.js';
import '../controls/value-field.js';
import type { ValueSuggestion } from '../controls/value-field.js';

/**
 * Renders a form from a `Record<string, PropSpec>`.
 *
 * Shared by the insert popover and the library panel rather than duplicated,
 * because a prop is a prop wherever it is being edited. Exposed as a plain
 * function plus a stylesheet instead of a component so the host can lay it out
 * however it likes without a nested shadow root per field.
 *
 * Token props reuse the same suggestion list as the style editor, which is what
 * keeps blocks inserting with the project's own values rather than the preset
 * defaults.
 */
export const PropForm = {
  styles: css`
    .pf-field {
      display: grid;
      gap: 4px;
      margin-bottom: 10px;
    }
    .pf-field:last-child {
      margin-bottom: 0;
    }
    .pf-label {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      color: var(--heo-text-dim);
      font-size: 11px;
    }
    .pf-label code {
      color: var(--heo-text-faint);
      font-family: var(--heo-mono);
      font-size: 9.5px;
    }
    /* Selectable on purpose. These descriptions carry the values themselves —
       "Any character or emoji: → • 🔥 ✅ 🌟" is a menu, not prose — and copying one
       out is the fastest way to use it. */
    .pf-desc {
      color: var(--heo-text-faint);
      font-size: 10.5px;
      line-height: 1.4;
      -webkit-user-select: text;
      user-select: text;
      cursor: text;
    }
    .pf-label code {
      -webkit-user-select: text;
      user-select: text;
    }
    .pf-check {
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--heo-text-dim);
      font-size: 11.5px;
      cursor: pointer;
    }
    .pf-check input {
      width: 14px;
      height: 14px;
      accent-color: var(--heo-accent);
      cursor: pointer;
    }
  ` as CSSResult,

  render(
    specs: Record<string, PropSpec>,
    values: Record<string, string>,
    onChange: (name: string, value: string) => void,
    editor?: EditorEngine,
  ): TemplateResult | typeof nothing {
    const entries = Object.entries(specs);
    if (!entries.length) return nothing;

    return html`${entries.map(([name, spec]) => {
      const value = values[name] ?? String(spec.default ?? '');
      const label = spec.label ?? name;

      if (spec.type === 'boolean') {
        return html`<div class="pf-field">
          <label class="pf-check">
            <input
              type="checkbox"
              .checked=${value === 'true'}
              @change=${(event: Event) =>
            onChange(name, (event.target as HTMLInputElement).checked ? 'true' : 'false')}
            />
            ${label}
          </label>
          ${spec.description ? html`<span class="pf-desc">${spec.description}</span>` : nothing}
        </div>`;
      }

      if (spec.type === 'select') {
        const options = (spec.options ?? []).map((option) =>
          typeof option === 'object'
            ? { label: option.label ?? option.value, value: option.value }
            : { label: option, value: option },
        );
        return html`<div class="pf-field">
          <span class="pf-label">${label}<code>${name}</code></span>
          <select
            class="input"
            .value=${value}
            @change=${(event: Event) => onChange(name, (event.target as HTMLSelectElement).value)}
          >
            ${options.map(
          (option) =>
            html`<option value=${option.value} ?selected=${option.value === value}>
                  ${option.label}
                </option>`,
        )}
          </select>
          ${spec.description ? html`<span class="pf-desc">${spec.description}</span>` : nothing}
        </div>`;
      }

      const suggestions = suggestionsFor(spec, editor);
      const kind =
        spec.type === 'color' ? 'color' : spec.type === 'number' ? 'number' : 'text';

      return html`<div class="pf-field">
        <span class="pf-label">${label}<code>${name}</code></span>
        <heo-value-field
          .value=${value}
          .kind=${kind}
          .suggestions=${suggestions}
          placeholder=${String(spec.default ?? '')}
          @value-change=${(event: CustomEvent<{ value: string }>) =>
          onChange(name, event.detail.value)}
        ></heo-value-field>
        ${spec.description ? html`<span class="pf-desc">${spec.description}</span>` : nothing}
      </div>`;
    })}`;
  },
};

function suggestionsFor(spec: PropSpec, editor?: EditorEngine): ValueSuggestion[] {
  if (!editor) return [];
  if (spec.type === 'token') {
    const group = spec.tokenGroup;
    // Reuse the style editor's ordering by borrowing a property in the same group.
    const proxy =
      group === 'color'
        ? 'color'
        : group === 'radius'
          ? 'border-radius'
          : group === 'space'
            ? 'gap'
            : group === 'shadow'
              ? 'box-shadow'
              : group === 'font'
                ? 'font-family'
                : 'width';
    return buildSuggestions(editor, proxy, editor.selected);
  }

  if (spec.type === 'color') return buildSuggestions(editor, 'color', editor.selected);
  return [];
}
