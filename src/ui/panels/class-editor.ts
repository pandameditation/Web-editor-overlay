import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { propertyMeta, resolveValue } from '../../core/css.js';
import {
  displayOrder,
  fromRecord,
  shorthandGroups,
  splitImportant,
  type DisplayEntry,
} from '../../core/declaration-list.js';
import type { EditorEngine } from '../../core/editor.js';
import type { DesignClass } from '../../core/types.js';
import { icon } from '../icons.js';
import { killStyles, renderKill } from '../kill.js';
import { buildSuggestions, valueKindFor } from '../suggestions.js';
import '../controls/value-field.js';
import type { FormErrors } from '../form-errors.js';
import { adderRowStyles, renderAdder } from './styles/property-adder.js';
import { promoteStyles, renderPromote } from './styles/promote.js';

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
/**
 * Somewhere declarations live, and how to change them.
 *
 * The editor itself does not care whether it is pointed at a reusable class or at a
 * stylesheet rule — both are a name and a set of declarations — so the difference is
 * confined to this handful of functions.
 */
export interface DeclarationTarget {
  /** How to name it to the user: `.card`, `p::before`. Used in tooltips. */
  label: string;
  /** Unique among targets rendered together, for the datalist id. */
  id: string;
  declarations: Record<string, string>;
  /** Shown instead of the list when there is nothing in it. */
  empty: string;
  preview(property: string, value: string): void;
  commit(property: string, value: string): void;
  remove(property: string): void;
  /** Open the shared paste dialog with this target preselected. */
  paste?: () => void;
  /** Whether the declaration is `!important`: shown as the field's tag and the pressed toggle. */
  important(property: string): boolean;
  /** Add or remove `!important`, keeping the value: the promote toggle and the tag. */
  setImportance(property: string, important: boolean): void;
  /** The value a newly added property starts with. */
  seed(property: string): string;
  /** Why this target cannot be written, when it cannot. Disables the promote toggle with it. */
  readonly?: string;
  /** What the value comes to here, when that differs from what is written. */
  resolve?(property: string): string;
}

export interface ClassEditorHost {
  engine: EditorEngine;
  /** The element the class is being edited from, for token ranking and Apply. */
  element: HTMLElement | null;
  /** Draft in the "add a property" field, owned by the host so it survives renders. */
  newProperty: string;
  /** Where the add-a-property field reports what is wrong with a name. See `form-errors.ts`. */
  form: FormErrors;
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
   *
   * `scope` is the id of the declaration list that asked, and hosts should forward it:
   * one panel shows several lists that can each hold a row for the same property.
   */
  onFocus?: (property: string, scope?: string) => void;
}

/**
 * Focus the value field for `property`, once it exists.
 *
 * Exported so every host does this identically. Deferred to the next frame because the field is
 * created by the render that the new declaration schedules; querying for it any earlier finds
 * nothing.
 *
 * `scope` is the `DeclarationTarget.id` of the list that asked for the focus, and skipping it is
 * how focus used to land in the wrong place. The Styles panel shows the element's own declarations,
 * every class on it and every matching rule at once, and several of those can hold a row for the
 * same property — so a bare `querySelector` over the panel returned whichever came first in DOM
 * order. Adding `margin-left` to a CSS rule while a class declaring `margin-left` was expanded put
 * the caret in the class's field, because Classes renders above CSS rules.
 *
 * When the scope names a list that is on screen, only that list is searched. Otherwise `root` is,
 * which is what the callers that render one list at a time already narrow for themselves.
 */
export function focusDeclaration(root: ParentNode, property: string, scope?: string): void {
  requestAnimationFrame(() => {
    const within =
      (scope && root.querySelector(`[data-declarations="${CSS.escape(scope)}"]`)) || root;
    const field = within.querySelector(`heo-value-field[data-property="${CSS.escape(property)}"]`);
    // Preselected, because the seeded value is a stand-in the user is meant to
    // replace: typing should overwrite it, not append to it.
    (field as { focusInput?: (o: { select?: boolean }) => void } | null)?.focusInput?.({
      select: true,
    });
  });
}

/**
 * A declaration list laid out as families, with the control that decides which side of each wins.
 *
 * Shared by every surface that lists declarations, which is the point: an element's own styles, a
 * reusable class and a stylesheet rule all have the same shorthand-versus-longhand problem, so they
 * get the same answer to it. Only the row itself differs — an element's row has a reset button and a
 * cascade origin, a class's has neither — and that is what `renderRow` is for.
 *
 * The side control is both a state and an action, because in CSS they are the same fact: the
 * declaration that wins is the one written last, so "winning" is not a flag stored anywhere, it is
 * a position. The pressed one is the side currently last in the block; pressing the other moves it
 * there. That is expressed as re-asserting the declaration, because that is all it is — every
 * write goes through the shared model, which moves the touched side last. No separate command
 * exists, so there is nothing here to keep in step.
 *
 * Its glyph points down, "move last": the up arrow is the `!important` toggle's, and the two used to
 * share it a few pixels apart while meaning different things.
 */
export function renderFamilies(
  entries: readonly DisplayEntry[],
  renderRow: (property: string) => TemplateResult,
  promote: (property: string) => void,
  label: string,
): TemplateResult {
  const control = (property: string, active: boolean, what: string): TemplateResult => html`<button
    class=${`side-win${active ? ' on' : ''}`}
    type="button"
    aria-pressed=${active}
    aria-label=${active ? `${what} wins in ${label}` : `Make ${what} win in ${label}`}
    title=${active
      ? `${what} comes last in this block, so it wins. Only one side can.`
      : `Move ${what} last in this block so it wins over the other side.`}
    ?disabled=${active}
    @click=${() => promote(property)}
  >
    ${icon('arrowDown', 10)}
  </button>`;

  return html`${repeat(
    entries,
    (entry) => (entry.kind === 'family' ? `family:${entry.group.shorthand}` : entry.property),
    (entry) => {
      if (entry.kind === 'row') return renderRow(entry.property);
      const { group } = entry;
      const sides = group.longhands.length === 1 ? group.longhands[0] : 'the individual sides';
      /*
       * Always the shorthand first and its sides after, whatever order the block has them in.
       *
       * The block's order is what decides the result, and it changes as the user works — so letting
       * the rows follow it would move the field under the caret and put a different property under
       * the pointer mid-drag. The control carries that information instead, which is the one thing
       * that should move.
       */
      return html`<div class="family">
        ${control(group.shorthand, group.winner === 'shorthand', group.shorthand)}
        <div class="fam-rows">${renderRow(group.shorthand)}</div>
        ${control(group.longhands[0], group.winner === 'longhands', sides)}
        <div class="fam-rows sides">
          ${repeat(group.longhands, (name) => name, (name) => renderRow(name))}
        </div>
      </div>`;
    },
  )}`;
}

/**
 * A card's collapsible header: chevron, session dot, name, file and counts.
 *
 * Shared by the Tokens class card and the Styles panel's source cards, so a class looks the same
 * wherever it is met. The file is there to answer "where is this written", which matters on demand
 * rather than at a glance, so it shows while the header is hovered or focused and the counts keep
 * the room otherwise.
 */
export function renderCardHeader(spec: {
  name: string;
  meta: string;
  file?: string;
  expanded: boolean;
  onToggle: () => void;
  /** The class was defined in this session rather than read from a stylesheet. */
  sessionDot: boolean;
  /** A name that is a label rather than a selector ("Inline style"), set in the text face. */
  plain?: boolean;
}): TemplateResult {
  return html`<header
    role="button"
    tabindex="0"
    aria-expanded=${spec.expanded}
    @click=${spec.onToggle}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      spec.onToggle();
    }}
  >
    ${icon(spec.expanded ? 'chevronDown' : 'chevronRight', 11)}
    ${spec.sessionDot ? html`<span class="dot" title="Defined in this session"></span>` : nothing}
    <span class=${spec.plain ? 'n plain' : 'n'} title=${spec.name}>${spec.name}</span>
    ${spec.file ? html`<span class="file">${spec.file}</span>` : nothing}
    <span class="meta">${spec.meta}</span>
  </header>`;
}

/**
 * One declaration row: name, value (with its `!important` tag), the `!important` toggle, trash.
 *
 * Keyed on the property by the caller, because these rows are not interchangeable. Rendered
 * positionally, a change in the order of the declarations re-labels every row from that point on
 * rather than moving it: the field the caret was in became a different property's field mid-edit,
 * and the next keystroke edited that one instead.
 *
 * The tag is a button here, because the row writes the very declaration it shows; removing the flag
 * from it is the same act as un-pressing the toggle beside it.
 */
export function renderDeclarationRow(
  target: DeclarationTarget,
  property: string,
  host: ClassEditorHost,
  options: { promote: boolean },
): TemplateResult {
  const { engine, element } = host;
  // Shown without the flag, which the tag carries. Typed into the field, `!important` still arrives
  // with the value and is written; retyping a value without it keeps what the declaration had.
  const value = splitImportant(target.declarations[property] ?? '').value;
  const important = target.important(property);
  return html`<div
    class=${`decl${options.promote ? ' promotable' : ''}`}
  >
    <span class="p" title=${property}>${property}</span>
    <heo-value-field
      data-property=${property}
      .computed=${target.resolve?.(property) ?? resolvedValue(value, element)}
      .value=${value}
      .kind=${valueKindFor(property)}
      .property=${property}
      .suggestions=${buildSuggestions(engine, property, element)}
      .important=${important}
      .importantRemovable=${!target.readonly}
      .importantTitle=${target.readonly ?? ''}
      clearable
      @value-input=${(event: CustomEvent<{ value: string }>) =>
      target.preview(property, event.detail.value)}
      @value-revert=${() => engine.cancelPreview()}
      @value-change=${(event: CustomEvent<{ value: string }>) =>
      target.commit(property, event.detail.value)}
      @important-change=${(event: CustomEvent<{ important: boolean }>) =>
      target.setImportance(property, event.detail.important)}
    ></heo-value-field>
    ${options.promote
      ? renderPromote({
        property,
        source: target.label,
        important,
        onToggle: (next) => target.setImportance(property, next),
        disabled: target.readonly,
      })
      : nothing}
    ${renderKill({
        label: `Remove ${property} from ${target.label}`,
        tight: true,
        size: 11,
        onClick: () => target.remove(property),
      })}
  </div>`;
}

export const ClassEditor = {
  styles: [
    killStyles,
    adderRowStyles,
    promoteStyles,
    css`
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
    .cls .n.plain {
      font-family: var(--heo-font);
    }
    /* Dim, not faint: the reach is what a card is read for (R31). */
    .cls .meta {
      flex: 0 0 auto;
      color: var(--heo-text-dim);
      font-size: 9.5px;
    }
    /* Where the card is written: on demand, while the header is hovered or focused. */
    .cls > header .file {
      display: none;
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--heo-text-dim);
      font-family: var(--heo-mono);
      font-size: 9.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cls > header:hover .file,
    .cls > header:focus-within .file {
      display: inline;
    }
    .cls .decls {
      display: grid;
      gap: 5px;
      padding: 7px 8px;
    }
    .cls .decl-tools {
      display: flex;
      justify-content: flex-end;
      padding-bottom: 2px;
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
    /* A fourth column for the !important toggle, between the value and the trash. */
    .cls .decl.promotable {
      grid-template-columns: 92px minmax(0, 1fr) 18px 18px;
    }
    /* A shorthand and its own sides, shown as one thing.

       The grouping is the explanation: these rows compete, and CSS settles it by which comes
       last. Two columns — a narrow gutter for the side control, and the rows themselves —
       so one control can sit beside a whole group of sides rather than repeating per row. */
    .family {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      align-items: start;
      gap: 4px 4px;
      margin: 1px 0;
      padding: 4px 5px 4px 3px;
      border: 1px solid var(--heo-line);
      border-radius: var(--heo-r-sm);
      background: color-mix(in oklab, var(--heo-sunken) 55%, transparent);
    }
    /* Both groups reserve the same rule width, so nothing shifts when the winner changes. */
    .family .fam-rows {
      display: grid;
      gap: 5px;
      min-width: 0;
      padding-left: 3px;
      border-left: 2px solid transparent;
    }
    /* Indented and ruled, so the sides read as belonging under the shorthand above them. */
    .family .fam-rows.sides {
      padding-left: 7px;
      border-left: 2px solid var(--heo-line);
    }
    /* The one control that says which side is in charge. Pressed means "this one wins"; the
       other is the button you can press. Aligned to the first row of its group.

       Full contrast at every state. It used to rest in the faint ink at 55% opacity until the
       family was hovered, which read well under 3:1, and the losing side's rows were faded the
       same way, so the declarations a user had to read were the hardest ones to read. */
    .family .side-win {
      display: grid;
      place-items: center;
      width: 16px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--heo-text-dim);
      cursor: pointer;
    }
    .family .side-win:hover:not(:disabled) {
      background: var(--heo-hover);
      color: var(--heo-text);
    }
    /* The focus-ring ink is the accent's readable tint in dark and the accent in light. */
    .family .side-win.on {
      color: var(--heo-focus-ring);
      cursor: default;
    }
    .family .side-win:focus-visible {
      outline: 2px solid var(--heo-focus-ring);
      outline-offset: 1px;
    }
    /* The losing side, marked by a dashed rule rather than a fade: it is not wrong, just not in
       effect, and its text stays as readable as the winner's. The title says what beats it. */
    .family .side-win:not(.on) + .fam-rows {
      border-left-style: dashed;
      border-left-color: var(--heo-line-strong);
    }
    .cls .decl .p {
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
  `,
  ] as CSSResult[],

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
        : renderCardHeader({
          name: `.${entry.name}`,
          meta: `${properties.length} rules${uses ? ` · ${uses}×` : ''}`,
          expanded,
          onToggle,
          sessionDot: entry.origin !== 'stylesheet',
        })}
      ${expanded ? ClassEditor.renderBody(entry, host) : nothing}
    </div>`;
  },

  /** The declaration list, the add-property field and, optionally, the actions. */
  renderBody(entry: DesignClass, host: ClassEditorHost): TemplateResult {
    const { engine, element } = host;
    const applied = element?.classList.contains(entry.name) ?? false;
    // Read the declarations as they were before any in-flight preview. A class preview
    // is written into the registry `entry` came from, so reading it back would tell the
    // field its own draft was already committed — after which committing compares equal
    // and does nothing, and looking away reverts the preview, losing the edit.
    const preview = engine.classPreviewTarget;
    const declarations =
      preview && preview.name === entry.name ? preview.declarations : entry.declarations;

    return html`
      ${ClassEditor.renderDeclarations(
      {
        label: `.${entry.name}`,
        id: `class-${entry.name}`,
        declarations,
        empty: 'No declarations yet. Add a property below to give this class something to do.',
        preview: (property, value) =>
          engine.previewClassDeclaration(entry.name, property, value),
        commit: (property, value) => engine.setClassDeclaration(entry.name, property, value),
        remove: (property) => engine.removeClassDeclaration(entry.name, property),
        // The registry keeps importance inside the value text.
        important: (property) => splitImportant(declarations[property] ?? '').important === true,
        setImportance: (property, important) =>
          engine.setImportance({ kind: 'class', name: entry.name }, property, important),
        seed: initialValueFor,
        paste: () =>
          engine.beginCssPaste({
            context: 'class',
            element,
            className: entry.name,
          }),
      },
      host,
    )}
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
   * The declaration list and the add-property field, for anything that holds
   * declarations.
   *
   * Split out from the class body so a stylesheet rule gets the same editor rather
   * than a lookalike. The two used to be genuinely different experiences — a rule's
   * declarations were a read-only-ish list with no way to add a property — and
   * keeping them as one function is what stops them drifting apart again. The
   * target supplies where the values live and how to write them; everything the
   * user touches is identical.
   */
  renderDeclarations(target: DeclarationTarget, host: ClassEditorHost): TemplateResult {
    const list = fromRecord(target.declarations);
    const groups = shorthandGroups(list);
    const rows = displayOrder(list, groups);

    return html`
      <!-- Named so the focus helper can tell this list's rows from an identically named row in
           another list on the same screen. -->
      <div class="decls" data-declarations=${target.id}>
        ${target.paste
        ? html`<div class="decl-tools">
              <button
                class="btn sm"
                type="button"
                title=${`Paste CSS into ${target.label}`}
                @click=${target.paste}
              >
                ${icon('clipboard', 11)} Paste CSS
              </button>
            </div>`
        : nothing}
        ${rows.length === 0 ? html`<p class="hint" style="margin:0">${target.empty}</p>` : nothing}
        ${renderFamilies(
          rows,
          (property) => renderDeclarationRow(target, property, host, { promote: true }),
          (property) => target.commit(property, target.declarations[property] ?? ''),
          target.label,
        )}
        ${renderAdder(
          {
            id: target.id,
            mode: 'property',
            // Always open, with no destination line: the card it sits in is the destination.
            disclosure: false,
            destinations: [
              {
                key: target.id,
                label: target.label,
                reach: '',
                existing: target.declarations,
                ownerLabel: target.label,
              },
            ],
            seed: (property) => target.seed(property),
            commit: (property, value) => target.commit(property, value),
          },
          host,
        )}
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
    return html`<div class="cls">${ClassEditor.renderUnknownBody(name, host)}</div>`;
  },

  /** The same note and offer, for a host that draws its own card around them. */
  renderUnknownBody(name: string, host: ClassEditorHost): TemplateResult {
    return html`<div class="undefined-note">
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
