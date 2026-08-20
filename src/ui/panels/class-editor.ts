import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { propertyMeta, searchProperties } from '../../core/css.js';
import type { EditorEngine } from '../../core/editor.js';
import type { DesignClass } from '../../core/types.js';
import { icon } from '../icons.js';
import { buildSuggestions, valueKindFor } from '../suggestions.js';
import '../controls/value-field.js';

/**
 * The reusable-class editor.
 *
 * A class is a named group of declarations, and editing one changes every element
 * wearing it — which is exactly why it has to be reachable from wherever the user
 * meets the class, not only from the design system panel. The Styles panel shows
 * an element's classes as chips; clicking one opens this, in place.
 *
 * Exposed as a plain function plus a stylesheet rather than a component, matching
 * `PropForm`: both hosts already have a shadow root, and a nested one per class
 * would buy nothing while making the two views drift apart.
 */
export interface ClassEditorHost {
  engine: EditorEngine;
  /** The element the class is being edited from, for token ranking and Apply. */
  element: HTMLElement | null;
  /** Draft in the "add a property" field, owned by the host so it survives renders. */
  newProperty: string;
  onNewProperty: (value: string) => void;
  /** Called after a structural change so the host can drop its expanded state. */
  onRemoved?: (name: string) => void;
}

export const ClassEditor = {
  styles: css`
    .cls {
      border: 1px solid var(--heo-line);
      border-radius: var(--heo-r-sm);
      margin-bottom: 6px;
      overflow: hidden;
    }
    .cls > header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--heo-sunken);
      cursor: pointer;
    }
    .cls > header:hover {
      background: var(--heo-hover);
    }
    .cls .dot {
      width: 5px;
      height: 5px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: var(--heo-accent);
    }
    .cls .n {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      font-family: var(--heo-mono);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cls .meta {
      flex: 0 0 auto;
      color: var(--heo-text-faint);
      font-size: 9.5px;
    }
    .cls .decls {
      display: grid;
      gap: 5px;
      padding: 7px 8px;
    }
    .cls .undefined-note {
      padding: 8px;
      color: var(--heo-text-faint);
      font-size: 10.5px;
      line-height: 1.5;
    }
    .decl {
      display: grid;
      grid-template-columns: 92px 1fr;
      align-items: center;
      gap: 6px;
    }
    .decl .p {
      overflow: hidden;
      color: var(--heo-text-dim);
      font-family: var(--heo-mono);
      font-size: 10.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cls .apply {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 0 8px 8px;
    }
  ` as CSSResult,

  /**
   * One collapsible class.
   *
   * `expanded` and the add-property draft live in the host so that switching
   * panels, or re-rendering after an edit, does not collapse what the user opened.
   */
  render(
    entry: DesignClass,
    options: {
      expanded: boolean;
      uses: number;
      onToggle: () => void;
      host: ClassEditorHost;
      /** Hide the header when the host already shows the class name elsewhere. */
      bare?: boolean;
    },
  ): TemplateResult {
    const { expanded, uses, onToggle, host } = options;
    const properties = Object.keys(entry.declarations);

    return html`<div class="cls">
      ${options.bare
        ? nothing
        : html`<header
            role="button"
            tabindex="0"
            aria-expanded=${expanded}
            @click=${onToggle}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onToggle();
            }}
          >
            ${icon(expanded ? 'chevronDown' : 'chevronRight', 11)}
            ${entry.origin !== 'stylesheet'
              ? html`<span class="dot" title="Defined in this session"></span>`
              : nothing}
            <span class="n">.${entry.name}</span>
            <span class="meta">${properties.length} rules${uses ? ` · ${uses}×` : ''}</span>
          </header>`}
      ${expanded ? ClassEditor.renderBody(entry, host) : nothing}
    </div>`;
  },

  /** The declaration list, the add-property field and the apply/delete actions. */
  renderBody(entry: DesignClass, host: ClassEditorHost): TemplateResult {
    const { engine, element } = host;
    const properties = Object.keys(entry.declarations);
    const applied = element?.classList.contains(entry.name) ?? false;
    const listId = `heo-props-${entry.name}`;

    return html`
      <div class="decls">
        ${properties.length === 0
          ? html`<p class="hint" style="margin:0">
              No declarations yet. Add a property below to give this class something to do.
            </p>`
          : nothing}
        ${properties.map(
          (property) => html`<div class="decl">
            <span class="p" title=${property}>${property}</span>
            <heo-value-field
              .value=${entry.declarations[property]}
              .kind=${valueKindFor(property)}
              .property=${property}
              .suggestions=${buildSuggestions(engine, property, element)}
              clearable
              @value-change=${(event: CustomEvent<{ value: string }>) =>
                engine.setClassDeclaration(entry.name, property, event.detail.value)}
            ></heo-value-field>
          </div>`,
        )}
        <div class="decl">
          <span class="p">add</span>
          <input
            class="input mono"
            type="text"
            list=${listId}
            placeholder="property"
            .value=${host.newProperty}
            spellcheck="false"
            aria-label="New property"
            @input=${(event: Event) =>
              host.onNewProperty((event.target as HTMLInputElement).value)}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const property = host.newProperty.trim();
              if (!property) return;
              engine.setClassDeclaration(entry.name, property, initialValueFor(property));
              host.onNewProperty('');
            }}
          />
          <datalist id=${listId}>
            ${searchProperties(host.newProperty, 20).map(
              (meta) => html`<option value=${meta.name}></option>`,
            )}
          </datalist>
        </div>
      </div>
      <div class="apply">
        ${element
          ? html`<button
              class="btn sm"
              type="button"
              aria-pressed=${applied}
              title=${applied
                ? `Remove .${entry.name} from this element`
                : `Add .${entry.name} to this element`}
              @click=${() => engine.toggleClass(entry.name, element)}
            >
              ${icon(applied ? 'check' : 'plus', 12)}
              ${applied ? 'Applied here' : 'Apply to selection'}
            </button>`
          : nothing}
        <button
          class="btn sm danger"
          type="button"
          @click=${() => {
            engine.removeClass(entry.name);
            host.onRemoved?.(entry.name);
          }}
        >
          ${icon('trash', 12)} Delete
        </button>
      </div>
    `;
  },

  /**
   * The body for a class name that no stylesheet the editor can read defines.
   *
   * Common on real pages: a utility class from a framework, or a class whose rule
   * lives in a cross-origin sheet. Saying so, and offering to define it here, is
   * more useful than an empty editor that looks broken.
   */
  renderUnknown(name: string, host: ClassEditorHost): TemplateResult {
    return html`<div class="cls">
      <div class="undefined-note">
        No rule for <code class="mono">.${name}</code> is readable from this page — it may come from
        a framework, a cross-origin stylesheet, or nowhere at all. Defining it here adds a rule the
        editor owns and exports.
      </div>
      <div class="apply">
        <button
          class="btn sm"
          type="button"
          @click=${() => {
            host.engine.classes.upsert({ name, declarations: {}, origin: 'user' });
            host.engine.notify(`Now editing .${name}.`, 'info');
          }}
        >
          ${icon('plus', 12)} Define .${name}
        </button>
      </div>
    </div>`;
  },
};

/** A sensible starting value so a freshly added property is immediately visible. */
export function initialValueFor(property: string): string {
  const meta = propertyMeta(property);
  switch (meta.control) {
    case 'length':
      return '0px';
    case 'number':
      return '1';
    case 'color':
      return 'currentColor';
    case 'keyword':
      return meta.keywords?.[0] ?? 'initial';
    default:
      return 'initial';
  }
}
