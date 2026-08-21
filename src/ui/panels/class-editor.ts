import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { propertyMeta, resolveValue, searchProperties } from '../../core/css.js';
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
  /**
   * Which actions the host wants offered.
   *
   * The design system panel is where a class is managed, so it gets Apply and
   * Delete. Reached from an element's own chips in Styles, both are wrong: the
   * class is applied here by definition, and deleting a shared rule from a
   * single element's panel is a much larger action than it looks.
   */
  actions?: 'all' | 'none';
  /**
   * Called with a property whose value field should take focus.
   *
   * The field does not exist yet at call time — it appears on the render the new
   * declaration triggers — so the host has to do the focusing after that update.
   */
  onFocus?: (property: string) => void;
}

/**
 * Focus the value field for `property`, once it exists.
 *
 * Exported so both hosts do this identically. Deferred to the next frame because
 * the field is created by the render that the new declaration schedules; querying
 * for it any earlier finds nothing.
 */
export function focusDeclaration(root: ParentNode, property: string): void {
  requestAnimationFrame(() => {
    const field = root.querySelector(`heo-value-field[data-property="${CSS.escape(property)}"]`);
    // Preselected, because the seeded value is a stand-in the user is meant to
    // replace: typing should overwrite it, not append to it.
    (field as { focusInput?: (o: { select?: boolean }) => void } | null)?.focusInput?.({
      select: true,
    });
  });
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
    /* Name, value, and an explicit way out. The third column exists because
       clearing the value no longer removes the property — emptying a field is how
       you retype it, so removal had to become something you ask for. */
    .cls .decl {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr) 18px;
      align-items: center;
      gap: 6px;
    }
    .cls .decl .drop {
      display: grid;
      place-items: center;
      width: 18px;
      height: 18px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--heo-text-faint);
      cursor: pointer;
      padding: 0;
      opacity: 0;
      transition: opacity var(--heo-fast);
    }
    .cls .decl:hover .drop,
    .cls .decl .drop:focus-visible {
      opacity: 1;
    }
    .cls .decl .drop:hover {
      background: color-mix(in oklab, var(--heo-danger) 18%, transparent);
      color: var(--heo-danger);
    }
    .cls .decl .p {
      overflow: hidden;
      color: var(--heo-text-dim);
      font-family: var(--heo-mono);
      font-size: 10.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Property name plus its confirm button, sharing one field's worth of width. */
    .cls .decl .pair {
      display: flex;
      gap: 4px;
      min-width: 0;
    }
    .cls .decl .pair .input {
      flex: 1 1 auto;
      min-width: 0;
    }
    .cls .decl .confirm {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 28px;
      border: 1px solid var(--heo-accent-line);
      border-radius: var(--heo-r-sm);
      background: var(--heo-accent-soft);
      color: var(--heo-accent);
      cursor: pointer;
      padding: 0;
      transition:
        background var(--heo-fast),
        color var(--heo-fast);
    }
    .cls .decl .confirm:hover:not(:disabled) {
      background: var(--heo-accent);
      color: var(--heo-accent-ink);
    }
    .cls .decl .confirm:disabled {
      border-color: var(--heo-line);
      background: transparent;
      color: var(--heo-text-faint);
      cursor: not-allowed;
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

  /** The declaration list, the add-property field and, optionally, the actions. */
  renderBody(entry: DesignClass, host: ClassEditorHost): TemplateResult {
    const { engine, element } = host;
    const properties = Object.keys(entry.declarations);
    const applied = element?.classList.contains(entry.name) ?? false;
    const listId = `heo-props-${entry.name}`;

    /*
     * Turn the typed property name into a declaration.
     *
     * Shared by the confirm button, Enter, and leaving the field, because all three
     * mean the same thing: that is the property I want. Seeding a starting value
     * matters — an empty declaration would neither render nor tell the user what
     * kind of value the new field expects.
     */
    const commitProperty = (): void => {
      const property = host.newProperty.trim().toLowerCase().replace(/:+$/, '');
      if (!property) return;
      host.onNewProperty('');
      if (entry.declarations[property] !== undefined) {
        engine.notify(`.${entry.name} already sets ${property}.`, 'info');
      } else {
        engine.setClassDeclaration(entry.name, property, initialValueFor(property));
      }
      // Naming a property is never the goal; giving it a value is. Hand the caret to
      // the field that was just created, with its own autocomplete already loaded.
      host.onFocus?.(property);
    };

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
              data-property=${property}
              .computed=${resolvedValue(entry.declarations[property], element)}
              .value=${entry.declarations[property]}
              .kind=${valueKindFor(property)}
              .property=${property}
              .suggestions=${buildSuggestions(engine, property, element)}
              clearable
              @value-input=${(event: CustomEvent<{ value: string }>) =>
              engine.previewClassDeclaration(entry.name, property, event.detail.value)}
              @value-revert=${() => engine.cancelPreview()}
              @value-change=${(event: CustomEvent<{ value: string }>) =>
              engine.setClassDeclaration(entry.name, property, event.detail.value)}
            ></heo-value-field>
            <button
              class="drop"
              type="button"
              title=${`Remove ${property} from .${entry.name}`}
              aria-label=${`Remove ${property} from .${entry.name}`}
              @click=${() => engine.removeClassDeclaration(entry.name, property)}
            >
              ${icon('close', 10)}
            </button>
          </div>`,
        )}
        <div class="decl">
          <span class="p">add</span>
          <div class="pair">
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
        if (event.key === 'Enter') {
          event.preventDefault();
          commitProperty();
          return;
        }
        // Tab means "done here", so confirm on the way out rather than
        // discarding what was typed.
        if (event.key === 'Tab' && !event.shiftKey && host.newProperty.trim()) {
          event.preventDefault();
          commitProperty();
        }
      }}
              @blur=${() => {
        if (host.newProperty.trim()) commitProperty();
      }}
            />
            <button
              class="confirm"
              type="button"
              title="Add this property"
              aria-label="Add this property"
              ?disabled=${!host.newProperty.trim()}
              @pointerdown=${(event: Event) => event.preventDefault()}
              @click=${commitProperty}
            >
              ${icon('check', 12)}
            </button>
          </div>
          <datalist id=${listId}>
            ${searchProperties(host.newProperty, 20).map(
        (meta) => html`<option value=${meta.name}></option>`,
      )}
          </datalist>
        </div>
      </div>
      ${host.actions === 'none'
        ? nothing
        : html`<div class="apply">
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
          </div>`}
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

/**
 * What a declaration's value comes to, when that differs from what is written.
 *
 * Resolved against the selected element, since a token's value depends on where it
 * is read from. Returns nothing when there is no expression to expand, which is the
 * signal the value field uses to leave the Computed row out.
 */
function resolvedValue(value: string, element: HTMLElement | null): string {
  if (!value || !element) return '';
  const resolved = resolveValue(element, value);
  return resolved === value ? '' : resolved;
}

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
