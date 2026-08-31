import { css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { summarizeRule } from '../../core/rules.js';
import type { DesignRule } from '../../core/types.js';
import { icon } from '../icons.js';
import { ClassEditor, type ClassEditorHost } from './class-editor.js';
import '../controls/selector-field.js';

/**
 * The CSS rule editor: one card per rule.
 *
 * Deliberately the same shape as `ClassEditor`, and deliberately borrowing its
 * declaration list rather than reimplementing one. A rule and a class are the same thing
 * from the property editor's point of view — somewhere declarations live — and
 * `renderDeclarations` already exists for exactly that. Everything the user touches
 * inside an expanded card is therefore identical to a class, which is the point: the
 * brief was "the same experience as for classes", and shared code is the only version of
 * that which stays true.
 *
 * What is different is above the declarations, and all of it comes from one fact: a class
 * is inert until an element wears it, while **a rule applies the moment it exists**. So
 * the card leads with what the rule currently hits, the selector is editable in place
 * rather than fixed, and a rule matching nothing says so where it cannot be missed.
 *
 * A plain object with a stylesheet rather than a component, matching `ClassEditor` and
 * `PropForm`: the host already has a shadow root, and a nested one per rule would buy
 * nothing while letting the two views drift apart.
 */

export interface RuleEditorHost extends ClassEditorHost {
  /** The rule whose selector is being rewritten, if any. */
  editingSelector: string | null;
  onEditSelector: (selector: string | null) => void;
  /**
   * A rule's selector changed, so anything the host keyed on the old one has moved.
   *
   * Which is the expanded card, and it is not optional in practice: the selector *is*
   * the identity here, so a rename with nothing listening collapses the card the user is
   * working in the moment they retarget it.
   */
  onRenamed?: (from: string, to: string) => void;
}

export const RuleEditor = {
  styles: css`
    .rule {
      border: 1px solid var(--heo-line);
      border-radius: var(--heo-r-md);
      margin-bottom: 7px;
      background: var(--heo-raised);
      overflow: hidden;
      transition: border-color var(--heo-fast);
    }
    .rule:hover {
      border-color: var(--heo-line-strong);
    }
    .rule[data-open] {
      border-color: var(--heo-accent-line);
    }

    .rule > header {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 7px 8px;
      background: var(--heo-sunken);
      cursor: pointer;
    }
    .rule > header:hover {
      background: var(--heo-hover);
    }

    /* The selector, in code, because that is what the user will look for in a file. */
    .rule .sel {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--heo-text);
      font-family: var(--heo-mono);
      font-size: 11.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rule .props {
      flex: 0 0 auto;
      max-width: 42%;
      overflow: hidden;
      color: var(--heo-text-faint);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* How many elements this rule is styling right now. The one number worth having on
       a collapsed row: a rule matching nothing is the commonest way a selector is
       wrong, and it is invisible from the selector itself. */
    .rule .hits {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      height: 19px;
      padding: 0 7px;
      border-radius: 999px;
      background: var(--heo-hover);
      color: var(--heo-text-dim);
      font-size: 9.5px;
      font-variant-numeric: tabular-nums;
    }
    .rule .hits.live {
      background: color-mix(in oklab, var(--heo-success) 20%, transparent);
      color: color-mix(in oklab, var(--heo-success) 78%, var(--heo-text));
    }
    .rule .hits.idle {
      background: color-mix(in oklab, var(--heo-warn) 18%, transparent);
      color: color-mix(in oklab, var(--heo-warn) 80%, var(--heo-text));
    }

    /* minmax(0, 1fr) rather than the default auto track: an auto track takes its base
       size from what its items say they need at minimum, so a wide child pushes the
       track — and everything in it — past the card's edge instead of being made to fit. */
    .rule .retarget {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
      padding: 8px;
      border-bottom: 1px solid var(--heo-line);
      background: var(--heo-sunken);
    }
    .rule .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      padding: 0 8px 8px;
    }
    .rule .warn {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 7px 8px;
      border-bottom: 1px solid var(--heo-line);
      color: color-mix(in oklab, var(--heo-warn) 78%, var(--heo-text));
      font-size: 10.5px;
      line-height: 1.45;
    }
    .rule .warn svg {
      flex: 0 0 auto;
      margin-top: 1px;
    }

    /*
     * The declaration rows arrive from ClassEditor, whose layout is scoped to the
     * container the class card puts around them. Wrapping in one of those is how this
     * card gets the identical grid instead of a lookalike that drifts.
     *
     * Unscoping those rules instead was the obvious alternative and is wrong: the Styles
     * panel deliberately restyles the same rows to two columns for its cascade list, and
     * a global rule would take that over. So the container comes along, and its own box
     * is neutralised here — this card is already providing one.
     */
    .rule .cls {
      border: 0;
      border-radius: 0;
      margin: 0;
      overflow: visible;
    }
  ` as CSSResult,

  /**
   * One collapsible rule.
   *
   * `expanded` and the drafts live in the host so that re-rendering after an edit — which
   * every keystroke in a value field causes — does not collapse what the user opened.
   */
  render(
    entry: DesignRule,
    options: {
      expanded: boolean;
      matches: number;
      onToggle: () => void;
      host: RuleEditorHost;
    },
  ): TemplateResult {
    const { expanded, matches, onToggle, host } = options;
    const editingSelector = host.editingSelector === entry.selector;

    return html`<div class="rule" ?data-open=${expanded}>
      <header
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
        <span class="sel" title=${entry.selector}>${entry.selector}</span>
        ${expanded ? nothing : html`<span class="props">${summarizeRule(entry)}</span>`}
        <span
          class=${`hits ${matches > 0 ? 'live' : 'idle'}`}
          title=${matches > 0
        ? `Styling ${matches} element${matches === 1 ? '' : 's'} on this page`
        : 'Nothing on this page matches this selector'}
        >
          ${matches > 0 ? `${matches}×` : '0×'}
        </span>
      </header>

      ${expanded
        ? html`
            ${matches === 0 ? RuleEditor.renderMiss() : nothing}
            ${editingSelector ? RuleEditor.renderRetarget(entry, host) : nothing}
            ${RuleEditor.renderBody(entry, host)}
            <div class="actions">
              <button
                class="btn sm"
                type="button"
                aria-pressed=${editingSelector}
                title="Point this rule at a different selector"
                @click=${() => host.onEditSelector(editingSelector ? null : entry.selector)}
              >
                ${icon('search', 12)}
                ${editingSelector ? 'Keep this selector' : 'Change selector'}
              </button>
              <button
                class="btn sm danger"
                type="button"
                @click=${() => {
            host.engine.removeDesignRule(entry.selector);
            host.onRemoved?.(entry.selector);
          }}
              >
                ${icon('trash', 12)} Delete
              </button>
            </div>
          `
        : nothing}
    </div>`;
  },

  /**
   * Said once, at the top of the card, when the rule selects nothing.
   *
   * The failure this feature is most likely to produce, and the one hardest to see: the
   * declarations are all correct, the rule is really in the stylesheet, and nothing
   * changes on screen. Naming it next to the button that fixes it is the whole remedy.
   */
  renderMiss(): TemplateResult {
    return html`<p class="warn">
      ${icon('alert', 12)}
      <span>
        Nothing on this page matches this selector, so these declarations are not showing
        anywhere. They are still saved and still exported — change the selector if that was not
        the intention.
      </span>
    </p>`;
  },

  /** The selector field, shown while the user is retargeting the rule. */
  renderRetarget(entry: DesignRule, host: RuleEditorHost): TemplateResult {
    return html`<div class="retarget">
      <heo-selector-field
        .value=${entry.selector}
        action="Retarget this rule"
        @selector-submit=${(event: CustomEvent<{ value: string }>) => {
        const next = host.engine.renameDesignRule(entry.selector, event.detail.value);
        if (!next) return;
        host.onEditSelector(null);
        host.onRenamed?.(entry.selector, next);
      }}
        @selector-cancel=${() => host.onEditSelector(null)}
      ></heo-selector-field>
      <p class="hint" style="margin:0">
        The declarations stay where they are; only what they apply to changes.
      </p>
    </div>`;
  },

  /**
   * The declaration list, through the class editor's own renderer.
   *
   * The `DeclarationTarget` is the entire adaptation layer: where the values live and how
   * to write them. Everything the user sees and touches comes from `ClassEditor`.
   */
  renderBody(entry: DesignRule, host: RuleEditorHost): TemplateResult {
    const { engine } = host;
    // Read the declarations as they were before any in-flight preview, for the same
    // reason the class editor does: a preview is written into the registry this came
    // from, so reading it back would tell the field its own draft was already
    // committed — after which committing compares equal and does nothing.
    const preview = engine.designRulePreviewTarget;
    const declarations =
      preview && preview.selector === entry.selector ? preview.declarations : entry.declarations;

    return html`<div class="cls">
      ${ClassEditor.renderDeclarations(
      {
        label: entry.selector,
        // Namespaced and flattened: a selector is not an id. Two rules could otherwise
        // produce the same datalist id, and `h2 > p` is not a valid one at all.
        id: `rule-${entry.selector.replace(/[^\w-]+/g, '_')}`,
        declarations,
        empty: 'No declarations yet. Add a property below to give this rule something to do.',
        preview: (property, value) =>
          engine.previewDesignRuleDeclaration(entry.selector, property, value),
        commit: (property, value) =>
          engine.setDesignRuleDeclaration(entry.selector, property, value),
        remove: (property) => engine.removeDesignRuleDeclaration(entry.selector, property),
      },
      host,
    )}
    </div>`;
  },
};
