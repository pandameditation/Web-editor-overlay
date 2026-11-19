import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { normalizeClassName } from '../../core/classes.js';
import { designRuleKey } from '../../core/rules.js';
import { labelFor } from '../../core/dom.js';
import { type SeedTarget } from '../../core/seed.js';
import { TOKEN_GROUP_LABELS, TOKEN_GROUPS, prettifyTokenName } from '../../core/tokens.js';
import { shallowArrayEquals, StoreController } from '../../core/store.js';
import type { DesignClass, DesignRule, DesignToken, TokenGroup } from '../../core/types.js';
import { HeoElement } from '../context.js';
import { icon } from '../icons.js';
import { classSuggestions, shadowSwatches } from '../suggestions.js';
import { killStyles, renderKill } from '../kill.js';
import { baseStyles } from '../theme.js';
import { ClassEditor, renderCardHeader } from './class-editor.js';
import { pageFontFamilies, WEB_FONTS } from '../../core/fonts.js';
import { catalogueFont, styleLabel, type ProjectFont } from '../../core/project-fonts.js';
import '../controls/font-editor.js';
import {
  CREATE_DESIGN_CLASS_TITLE,
  CREATE_ICON,
  CREATE_RULE_TITLE,
  CREATE_TEXT_STYLE_TITLE,
  createClassLabel,
  createRuleLabel,
  createTextStyleLabel,
} from '../create-offer.js';
import { RuleEditor, type RuleEditorHost } from './rule-editor.js';
import { DesignTransfer, type DesignTransferHost } from './design-transfer.js';
import '../controls/section.js';
import '../controls/value-field.js';
import { buildSuggestions, valueKindFor } from '../suggestions.js';
import { shownTypographyRows } from './styles/typography.js';
import { textStyleDeclarations, textStyleMarker, TEXT_STYLE_MARKER } from '../../core/text-styles.js';
import '../controls/search-field.js';
import '../controls/segmented.js';
import { classNameIssues, selectorIssues, type FieldIssue } from '../../core/validation.js';
import { field, fieldLabel, FormErrors } from '../form-errors.js';

/** Which of the three registries the panel's search is scoped to. */
type Facet = 'all' | 'tokens' | 'classes' | 'rules';

const DIMENSIONAL_GROUPS = new Set<TokenGroup>(['space', 'size', 'radius']);

const openGroups = new Set<string>(['component', 'color', 'space', 'classes', 'rules']);

/**
 * The design system panel: tokens, reusable classes and CSS rules.
 *
 * Ordered by what the user is most likely to act on, and then by how far each thing
 * reaches. Tokens the selected component already uses come first, so a session naturally
 * converges on the existing vocabulary. Below that is the full palette by group, then the
 * class registry, then the rule registry, then import and export — because the whole
 * point of defining a system here is being able to carry it to the next page.
 *
 * Rules sit after classes rather than beside them because they are the widest-reaching
 * thing in the panel. A token changes what references it; a class changes what wears it;
 * a rule changes whatever its selector happens to match, which is a set the user has to
 * be shown rather than told. That is why the rule section is the only one that reports
 * live match counts.
 *
 * All three write into managed stylesheets, so changing a value updates the page
 * immediately.
 */
@customElement('heo-tokens-panel')
export class HeoTokensPanel extends HeoElement {
  static override styles = [
    baseStyles,
    killStyles,
    ClassEditor.styles,
    RuleEditor.styles,
    css`
      /* Text styles: each drawn in its own look, then the picked one's rows. */
      .tstyles {
        display: grid;
        gap: 2px;
      }
      .tslot {
        display: grid;
        grid-template-columns: 16px minmax(0, 1fr);
        align-items: center;
        border-radius: var(--heo-r-sm);
      }
      .tslot.over {
        box-shadow: 0 -2px 0 var(--heo-accent);
      }
      .tslot .grip {
        display: grid;
        place-items: center;
        height: 100%;
        color: var(--heo-text-faint);
        cursor: grab;
      }
      .tslot .grip:hover {
        color: var(--heo-text);
      }
      .tstyle {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 30px;
        padding: 4px 8px;
        border: 1px solid transparent;
        border-radius: var(--heo-r-sm);
        background: transparent;
        color: var(--heo-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .tstyle:hover {
        background: var(--heo-hover);
      }
      .tstyle[aria-current='true'] {
        border-color: var(--heo-accent-line);
        background: var(--heo-accent-soft);
      }
      .tstyle .p {
        overflow: hidden;
        max-height: 28px;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tstyle .m {
        color: var(--heo-text-faint);
        font-family: var(--heo-mono);
        font-size: 10px;
      }
      /* A class's card, as Reusable classes and CSS rules draw theirs: the same frame and footer. */
      .tstyle-card {
        margin: 10px 0 0;
      }
      .tstyle-ed {
        display: grid;
        gap: 6px;
        padding: 7px 8px;
      }
      .font-body {
        display: grid;
        gap: 8px;
        padding: 8px;
      }
      .font-body .faces {
        display: grid;
        gap: 2px;
      }
      .font-body .face {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 24px;
      }
      .font-body .fs {
        overflow: hidden;
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .font-body .loc {
        max-width: 170px;
        overflow: hidden;
        padding: 1px 7px;
        border: 1px solid var(--heo-line-strong);
        border-radius: 999px;
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .font-body .loc.emb {
        border-color: var(--heo-accent-line);
        color: var(--heo-accent);
        font-family: inherit;
      }
      .font-body .used {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        color: var(--heo-text-faint);
        font-size: 10.5px;
      }
      .font-body .used span {
        padding: 1px 6px;
        border-radius: 999px;
        background: var(--heo-sunken);
        color: var(--heo-text-dim);
        font-family: var(--heo-mono);
      }
      .font-body .apply {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      /* Nothing matches: what the Library panel shows, a line and the offer to make it. */
      .empty.create {
        display: grid;
        justify-items: center;
        gap: 9px;
        padding: 14px 12px;
      }
      .empty.create p {
        margin: 0;
      }
      .trow {
        display: grid;
        grid-template-columns: 8px 92px minmax(0, 1fr) 18px;
        align-items: center;
        gap: 6px;
      }
      .trow .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--heo-accent);
      }
      .trow .dot.off {
        background: transparent;
      }
      .trow .tname {
        overflow: hidden;
        color: var(--heo-text);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .trow.sub .tname {
        padding-left: 10px;
        color: var(--heo-text-dim);
      }
      .trow heo-value-field,
      .trow heo-segmented {
        min-width: 0;
      }
      :host {
        display: block;
        padding-bottom: 16px;
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }
      .bar .spacer {
        flex: 1 1 auto;
      }

      /* The search and its scope, directly under the counts bar and above everything it
         narrows, so the thing doing the filtering sits over the thing being filtered. */
      .find {
        display: grid;
        gap: 7px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--heo-line);
      }

      .rows {
        display: grid;
        gap: 5px;
      }

      .token {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 6px;
      }
      /* A colour field draws its own swatch and a length field its own gauge, so for those the
         preview column would only repeat what is already there -- and take the width the field
         needs for the handle. */
      .token.no-preview {
        grid-template-columns: minmax(0, 1fr) auto auto;
      }
      .token .preview {
        display: grid;
        place-items: center;
        width: 22px;
        height: 24px;
        flex: 0 0 auto;
        border: 1px solid var(--heo-line);
        border-radius: 5px;
        background: var(--heo-sunken);
        overflow: hidden;
      }
      .token .preview .fill {
        width: 100%;
        height: 100%;
      }
      .token .preview .glyph {
        color: var(--heo-text-faint);
      }
      .token .used {
        min-width: 20px;
        color: var(--heo-text-faint);
        font-size: 9.5px;
        text-align: right;
      }

      .create {
        display: grid;
        gap: 6px;
        padding: 9px;
        border: 1px dashed var(--heo-line-strong);
        border-radius: var(--heo-r-sm);
        background: var(--heo-sunken);
      }
      .create .grid {
        display: grid;
        grid-template-columns: 1fr 96px;
        align-items: start;
        gap: 6px;
      }

      /* The "write a new rule" surface. Raised rather than sunken like the token
         creator, because it is the one composer in this panel with a live readout
         attached to it — the selector field draws on the page while it is focused, and
         a surface that sits above the list says the two are connected. */
      .compose {
        display: grid;
        /* See the note on the rule card's retarget row: an auto track sized from its
           items' minimums overflows rather than clamping. */
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
        padding: 10px;
        border: 1px solid var(--heo-line);
        border-radius: var(--heo-r-md);
        background: linear-gradient(
          180deg,
          color-mix(in oklab, var(--heo-accent) 6%, var(--heo-raised)),
          var(--heo-raised)
        );
        box-shadow: var(--heo-inset);
      }
      .compose > .head {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--heo-text-dim);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .compose .seed {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      /* The mark used on rule cards written this session, shown inline in the sentence
         that explains it so the legend and the thing it describes are the same shape. */
      .legend-dot {
        display: inline-block;
        width: 5px;
        height: 5px;
        vertical-align: 1px;
        border-radius: 999px;
        background: var(--heo-accent);
      }
    `,
    DesignTransfer.styles,
  ];

  /** Where the add-a-property fields say what is wrong with a name; checks run on commit. */
  protected propertyForm = new FormErrors(this, () => []);

  /** The import field's errors, in the design-system hand-off. */
  protected transferForm = new FormErrors(this, () => []);

  protected state = new StoreController(
    this,
    this.editor.store,
    (s) => [s.selected, s.registry, s.revision] as const,
    shallowArrayEquals,
  );

  /** What the panel is being searched for. Empty shows everything. */
  @state() private query = '';
  /** Which registry the search and its action are about. */
  @state() private facet: Facet = 'all';
  @state() private newName = '';
  @state() private newValue = '';

  /*
   * Four small forms share this panel, each with its own errors: submitting one never reveals
   * another's. See `form-errors.ts`.
   */
  /** The search box's add action: a class or a rule straight from what was typed. */
  protected queryForm = new FormErrors(this, () => {
    const seed = this.query.trim();
    if (this.facet === 'classes') return classNameIssues('tokens-query', seed);
    if (this.facet === 'rules' && seed) return selectorIssues('tokens-query', seed);
    return [];
  });

  protected tokenForm = new FormErrors(this, () => this.#tokenIssues());

  protected classForm = new FormErrors(this, () => classNameIssues('class-create', this.classDraft));

  protected ruleForm = new FormErrors(this, () => selectorIssues('rule-create', this.ruleDraft));
  @state() private newGroup: TokenGroup = 'color';
  @state() private expandedClass: string | null = null;
  /** The text style being edited in Text styles, by class. */
  @state() private textStyle: string | null = null;
  /** What is typed in Text styles' "find or create" field. */
  @state() private textStyleDraft = '';
  /** What is typed in Fonts' "find or add" field. */
  @state() private fontDraft = '';
  /** The font card that is open, and the font being added or edited in it. */
  @state() private openFont: string | null = null;
  @state() private fontEditing: { family: string; mode: 'add' | 'edit' } | null = null;
  @state() private newClassProperty = '';
  @state() private version = 0;
  @state() private classDraft = '';

  /* ---- CSS rules ---- */

  @state() private expandedRule: string | null = null;
  /**
   * The add-property draft for rules, kept apart from the class one.
   *
   * A shared buffer would put whatever was half-typed into a class's add field into
   * every rule's as well, since both are rendered at once in this panel.
   */
  @state() private newRuleProperty = '';
  /** The rule whose selector is being rewritten, if any. */
  @state() private editingRuleSelector: string | null = null;
  /** Live draft of the new-rule selector field, so the create button can reflect it. */
  @state() private ruleDraft = '';

  /**
   * What the shared Share & import surface reads back from its host.
   *
   * The seed itself is not here: encoding compresses the whole design system, so it
   * is cached once for the overlay rather than once per surface — the save dialog
   * would otherwise re-do work this panel just finished.
   */
  @state() private seedTarget: SeedTarget | null = null;
  @state() private incoming = '';
  @state() private overwrite = false;

  override render(): TemplateResult {
    const el = this.editor.selected;
    const usage = this.editor.tokens.usage();

    return html`
      <div class="bar">
        <span class="chip">${icon('droplet', 11)} ${this.editor.tokens.size} tokens</span>
        <span class="chip">${icon('blocks', 11)} ${this.editor.classes.size} classes</span>
        ${this.editor.rules.size
        ? html`<span class="chip">${icon('code', 11)} ${this.editor.rules.size} rules</span>`
        : nothing}
        <span class="spacer"></span>
        <button
          class="btn sm"
          type="button"
          title="Re-read tokens and classes from the page's stylesheets"
          @click=${() => void this.#rescan()}
        >
          ${icon('refresh', 12)}
        </button>
      </div>

      ${this.#renderFind()}
      ${this.#shows('tokens') && el ? this.#renderComponentTokens(el, usage) : nothing}
      ${this.#shows('tokens') && !this.query ? this.#renderCreate() : nothing}
      ${this.#shows('tokens')
        ? TOKEN_GROUPS.map((group) => this.#renderGroup(group, usage)).filter(Boolean)
        : nothing}
      ${this.#shows('classes') ? this.#renderTextStyles() : nothing}
      ${this.#shows('classes') ? this.#renderFonts() : nothing}
      ${this.#shows('classes') ? this.#renderClassList(el) : nothing}
      ${this.#shows('rules') ? this.#renderRules(el) : nothing}
      ${this.query ? this.#renderNoMatches() : nothing}
      ${this.#renderTransfer()}
    `;
  }

  /* ---------------------------------------------------------------------- */

  /**
   * One box for the whole panel, and one strip saying which registry it is asking about.
   *
   * This panel holds three registries and had no way to look anything up in any of them. On a page
   * with a real design system that is a hundred-odd tokens, every class and every rule the page
   * declares, all rendered at once and reachable only by scrolling — while the panel's own three
   * "add" forms sat at three different depths. So: one field, and a strip that scopes it.
   *
   * The facet does double duty. It narrows what is searched, and it decides what the field's action
   * makes — asking for a token, a class and a rule are three different acts and the button says
   * which one it is about to perform, rather than offering a generic plus that has to guess.
   */
  #renderFind(): TemplateResult {
    const counts = this.#counts();
    const total =
      (this.#shows('tokens') ? counts.tokens : 0) +
      (this.#shows('classes') ? counts.classes : 0) +
      (this.#shows('rules') ? counts.rules : 0);

    return html`<div class="find">
      <heo-search-field
        ${field(this.queryForm, 'tokens-query')}
        label="Search the design system"
        placeholder="Search tokens, classes and rules…"
        .value=${this.query}
        .count=${total}
        action=${this.#addLabel()}
        action-icon="plus"
        action-compact
        @search-input=${(event: CustomEvent<{ value: string }>) => {
        this.query = event.detail.value;
      }}
        @search-submit=${() => this.#addFromQuery()}
      ></heo-search-field>
      ${this.queryForm.error('tokens-query')}
      <heo-segmented
        .options=${[
        { value: 'all', label: 'All' },
        { value: 'tokens', label: `Tokens${counts.tokens ? ` ${counts.tokens}` : ''}` },
        { value: 'classes', label: `Classes${counts.classes ? ` ${counts.classes}` : ''}` },
        { value: 'rules', label: `Rules${counts.rules ? ` ${counts.rules}` : ''}` },
      ]}
        .value=${this.facet}
        label="What to search"
        @segment-change=${(event: CustomEvent<{ value: string }>) => {
        this.facet = (event.detail.value || 'all') as Facet;
      }}
      ></heo-segmented>
    </div>`;
  }

  /** Whether a family of things is on screen, given the facet. */
  #shows(family: 'tokens' | 'classes' | 'rules'): boolean {
    return this.facet === 'all' || this.facet === family;
  }

  /** How many of each family match the query, for the strip and the field's count. */
  #counts(): { tokens: number; classes: number; rules: number } {
    return {
      tokens: this.#matchTokens(this.editor.tokens.list()).length,
      classes: this.#matchClasses(this.editor.classes.list()).length,
      rules: this.#matchRules(this.editor.rules.list()).length,
    };
  }

  /*
   * The three matchers.
   *
   * Name and value both, because half of looking for a token is looking for a colour you can
   * remember but cannot name. Kept as three small functions rather than one generic one: the field
   * worth matching differs per registry, and a single predicate over "the interesting string" is
   * how a search starts quietly missing things.
   */
  #matchTokens(tokens: readonly DesignToken[]): DesignToken[] {
    const needle = this.query.trim().toLowerCase();
    if (!needle) return [...tokens];
    return tokens.filter(
      (token) =>
        token.name.toLowerCase().includes(needle) ||
        token.value.toLowerCase().includes(needle) ||
        (token.label ?? '').toLowerCase().includes(needle),
    );
  }

  #matchClasses(classes: readonly DesignClass[], query = this.query): DesignClass[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...classes];
    return classes.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        Object.entries(entry.declarations).some(([property, value]) =>
          `${property}: ${value}`.toLowerCase().includes(needle),
        ),
    );
  }

  #matchRules(rules: readonly DesignRule[], query = this.query): DesignRule[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...rules];
    return rules.filter(
      (entry) =>
        entry.selector.toLowerCase().includes(needle) ||
        Object.entries(entry.declarations).some(([property, value]) =>
          `${property}: ${value}`.toLowerCase().includes(needle),
        ),
    );
  }

  /** What the action would make, named after the facet so the button never has to guess. */
  #addLabel(): string {
    const seed = this.query.trim();
    switch (this.facet) {
      case 'classes':
        return seed ? `Create the .${normalizeClassName(seed) || seed} class` : 'Create a class';
      case 'rules':
        return seed ? `Create a rule for ${seed}` : 'Create a rule';
      default:
        return seed ? `Create the --${seed.replace(/^--/, '')} token` : 'Create a token';
    }
  }

  /**
   * Create whatever the facet is about, seeded with what was typed.
   *
   * A class and a rule can be made from a name alone, so they are made. A token cannot — it needs a
   * value — so this opens the New token form with the name filled in and puts the caret where the
   * missing half goes, rather than inventing a value or refusing outright.
   */
  #addFromQuery(): void {
    if (!this.queryForm.submit()) return;
    const seed = this.query.trim();
    if (this.facet === 'classes') {
      this.#createClass(seed);
      return;
    }
    if (this.facet === 'rules') {
      if (!seed) {
        openGroups.add('rules');
        this.version += 1;
        return;
      }
      this.#createRule(seed);
      return;
    }
    this.newName = seed.replace(/^--/, '');
    this.query = '';
    openGroups.add('create');
    this.version += 1;
  }

  /**
   * Said once, at the bottom, rather than per empty section.
   *
   * With a query on, a section with no matches renders nothing at all, so three empty registries
   * would leave the panel looking broken instead of looking searched.
   */
  #renderNoMatches(): TemplateResult | typeof nothing {
    const counts = this.#counts();
    const total =
      (this.#shows('tokens') ? counts.tokens : 0) +
      (this.#shows('classes') ? counts.classes : 0) +
      (this.#shows('rules') ? counts.rules : 0);
    if (total > 0) return nothing;
    return html`<div class="empty">Nothing matches “${this.query.trim()}”.</div>`;
  }

  #renderComponentTokens(el: HTMLElement, usage: Map<string, number>): TemplateResult {
    const tokens = this.editor.tokens.usedBy(el);
    const declarations = this.editor.tokens.tokenDeclarationsOf(el);
    const count = Object.keys(declarations).length;

    return html`<heo-section
      heading="Used by this component"
      glyph="cursor"
      badge=${tokens.length ? String(tokens.length) : ''}
      ?open=${openGroups.has('component')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('component', event.detail.open)}
    >
      ${tokens.length === 0
        ? html`<p class="hint" style="margin:0">
            ${labelFor(el)} does not reference any design token yet. Values picked from a token in
            the Styles panel show up here.
          </p>`
        : html`<p class="hint" style="margin:0 0 8px">
              These are re-proposed first everywhere you pick a value, so siblings stay consistent.
            </p>
            <div class="rows">
              ${repeat(tokens, (token) => token.name, (token) => this.#renderToken(token, usage))}
            </div>`}
      ${count > 0
        ? html`<button
            class="btn sm"
            type="button"
            style="margin-top:9px"
            title="Group these declarations into a reusable class"
            @click=${() => this.editor.beginClassExtraction()}
          >
            ${icon('blocks', 12)} Save ${count} declaration${count === 1 ? '' : 's'} as a class
          </button>`
        : nothing}
    </heo-section>`;
  }

  #renderGroup(group: TokenGroup, usage: Map<string, number>): TemplateResult | typeof nothing {
    const tokens = this.#matchTokens(this.editor.tokens.list(group));
    if (!tokens.length) return nothing;
    return html`<heo-section
      heading=${TOKEN_GROUP_LABELS[group]}
      glyph=${glyphForGroup(group)}
      badge=${String(tokens.length)}
      ?open=${openGroups.has(group)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember(group, event.detail.open)}
    >
      <div class="rows">
        ${repeat(tokens, (token) => token.name, (token) => this.#renderToken(token, usage))}
      </div>
    </heo-section>`;
  }

  /*
   * Which groups are lengths, and therefore draggable.
   *
   * `space` was the only one listed, so a size or radius token drew the bar preview -- which is a
   * length readout -- while its field was a plain text box that could not be scrubbed or stepped.
   * The preview and the control disagreed about what kind of value it was.
   */
  #renderToken(token: DesignToken, usage: Map<string, number>): TemplateResult {
    const count = usage.get(token.name) ?? 0;
    const isColor = token.group === 'color';
    /*
     * The value field draws its own leading affordance for a colour or a length, so the well beside
     * it would be a second copy of the same reading -- and worse than redundant, since it takes
     * 28px off the field that now has a drag handle of its own to fit. The rule was already here
     * for colours; a length is the same situation, arrived at later.
     *
     * What is left in the well is what the field cannot show: a shadow, and a glyph naming the
     * group for everything else.
     */
    // A shadow's field draws the shadow at its head and opens the shadow editor, as Styles does.
    const isShadow = token.group === 'shadow';
    const ownsItsPreview = isColor || isShadow || DIMENSIONAL_GROUPS.has(token.group);
    return html`<div class=${`token${ownsItsPreview ? ' no-preview' : ''}`}>
      ${ownsItsPreview
        ? nothing
        : html`<span class="preview" title=${token.value}>${this.#preview(token)}</span>`}
      <heo-value-field
        label=${token.name}
        .value=${token.value}
        .kind=${isColor ? 'color' : isShadow ? 'shadow' : DIMENSIONAL_GROUPS.has(token.group) ? 'length' : 'text'}
        .property=${isShadow ? 'box-shadow' : ''}
        .computed=${isShadow ? token.value : ''}
        .shadowTokens=${isShadow ? shadowSwatches(this.editor).filter((one) => one.value !== `var(--${token.name})`) : []}
        .suggestions=${[]}
        @value-change=${(event: CustomEvent<{ value: string }>) =>
        this.#setToken(token, event.detail.value)}
      ></heo-value-field>
      <span class="used" title=${count ? `Referenced ${count} times` : 'Not referenced yet'}>
        ${count ? `${count}×` : ''}
      </span>
      ${renderKill({
      label: `Delete --${token.name}`,
      title: count
        ? `Used ${count} times. Deleting will fall back to each var()'s default.`
        : `Delete --${token.name}`,
      onClick: () => this.#removeToken(token),
    })}
    </div>`;
  }

  /**
   * What goes in the well, for the groups that still have one.
   *
   * Colour and length are absent by design rather than by omission: their fields draw a swatch and
   * a gauge respectively, so `#renderToken` skips the well entirely for them. Both branches used to
   * live here and neither could be reached -- the colour one had already been dead for as long as
   * `no-preview` has existed.
   */
  #preview(token: DesignToken): TemplateResult {
    if (token.group === 'shadow') {
      return html`<span
        class="fill"
        style=${`box-shadow:${token.value};background:var(--heo-raised);border-radius:3px;transform:scale(.62)`}
      ></span>`;
    }
    return html`<span class="glyph">${icon(glyphForGroup(token.group), 12)}</span>`;
  }

  #renderCreate(): TemplateResult {
    return html`<heo-section
      heading="New token"
      glyph="plus"
      ?open=${openGroups.has('create')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('create', event.detail.open)}
    >
      <div class="create">
        <div class="grid">
          <div class="field">
            ${fieldLabel('Name', { required: true })}
            <input
              ${field(this.tokenForm, 'token-name', { required: true })}
              class="input mono"
              type="text"
              placeholder="token-name"
              .value=${this.newName}
              spellcheck="false"
              aria-label="Token name"
              @input=${(event: Event) => {
        this.newName = (event.target as HTMLInputElement).value;
      }}
            />
            ${this.tokenForm.error('token-name')}
          </div>
          <div class="field">
          ${fieldLabel('Group')}
          <select
            class="input"
            .value=${this.newGroup}
            aria-label="Token group"
            @change=${(event: Event) => {
        this.newGroup = (event.target as HTMLSelectElement).value as TokenGroup;
      }}
          >
            ${TOKEN_GROUPS.map(
        (group) => html`<option value=${group} ?selected=${group === this.newGroup}>
                ${TOKEN_GROUP_LABELS[group]}
              </option>`,
      )}
          </select>
          </div>
        </div>
        <div class="field">
        ${fieldLabel('Value', { required: true })}
        <heo-value-field
          ${field(this.tokenForm, 'token-value', { required: true })}
          .value=${this.newValue}
          .kind=${this.newGroup === 'color'
        ? 'color'
        : this.newGroup === 'shadow'
          ? 'shadow'
          : DIMENSIONAL_GROUPS.has(this.newGroup)
            ? 'length'
            : 'text'}
          .property=${this.newGroup === 'shadow' ? 'box-shadow' : ''}
          .shadowTokens=${this.newGroup === 'shadow' ? shadowSwatches(this.editor) : []}
          .suggestions=${[]}
          placeholder="value"
          @value-input=${(event: CustomEvent<{ value: string }>) => {
        this.newValue = event.detail.value;
      }}
          @value-change=${(event: CustomEvent<{ value: string }>) => {
        this.newValue = event.detail.value;
      }}
        ></heo-value-field>
        ${this.tokenForm.error('token-value')}
        </div>
        <button
          class="btn"
          type="button"
          @click=${this.#createToken}
        >
          ${icon('plus', 12)} Add
          ${this.newName.trim() ? html`<code class="mono">--${this.newName.trim()}</code>` : nothing}
        </button>
      </div>
    </heo-section>`;
  }

  /**
   * Text styles: the design system's classes marked as one (core/text-styles.ts), each drawn in its
   * own look. Picking one edits it with the Typography section's rows — the same names, order and
   * controls — writing to the class, so every element wearing it follows.
   */
  #renderTextStyles(): TemplateResult | typeof nothing {
    const needle = this.query.trim().toLowerCase();
    const draft = this.textStyleDraft.trim().toLowerCase();
    const matches = (one: { name: string; entry: DesignClass }, text: string): boolean =>
      !text || one.name.toLowerCase().includes(text) || one.entry.name.includes(text);
    const all = this.editor.textStyles();
    const inPanel = all.filter((one) => matches(one, needle));
    if (needle && !inPanel.length && !draft) return nothing;
    const styles = inPanel.filter((one) => matches(one, draft));
    // Reordering a filtered list would move styles past ones it hides: only the whole list drags.
    const movable = !needle && !draft && all.length > 1;
    const picked = styles.find((one) => one.entry.name === this.textStyle) ?? null;
    const look = (decl: Record<string, string>): string => Object.entries(decl)
      .filter(([property]) => !property.startsWith('--') && property !== 'line-height')
      .map(([property, value]) => `${property}:${property === 'font-size' ? `min(20px, ${value})` : value.replace(/[;{}<>]/g, '')}`)
      .join(';');
    return html`<heo-section
      heading="Text styles"
      glyph="text"
      badge=${String(styles.length)}
      ?open=${openGroups.has('text-styles') || Boolean(needle)}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#remember('text-styles', event.detail.open)}
    >
      <heo-value-field
        data-text-style-create
        style="margin-bottom:8px"
        field-label="Find or create a text style"
        leading-icon="search"
        clearable
        chevron-hidden
        action="Create text style"
        action-icon="plus"
        placeholder="find or create a text style"
        .value=${this.textStyleDraft}
        @value-input=${(event: CustomEvent<{ value: string }>) => {
          this.textStyleDraft = event.detail.value;
        }}
        @value-change=${(event: CustomEvent<{ value: string }>) => {
          this.textStyleDraft = event.detail.value;
        }}
        @value-submit=${(event: CustomEvent<{ value: string }>) => this.#createTextStyle(event.detail.value)}
      ></heo-value-field>
      ${styles.length
        ? html`<div class="tstyles" role="list" aria-label="Text styles, in order">
            ${repeat(styles, (one) => one.entry.name, (one, index) => html`<div
              class="tslot"
              role="listitem"
              data-text-style-slot=${one.entry.name}
              @dragover=${(event: DragEvent) => {
                if (this.#styleDragFrom === null) return;
                event.preventDefault();
                (event.currentTarget as HTMLElement).classList.add('over');
              }}
              @dragleave=${(event: DragEvent) => (event.currentTarget as HTMLElement).classList.remove('over')}
              @drop=${(event: DragEvent) => {
                (event.currentTarget as HTMLElement).classList.remove('over');
                const from = this.#styleDragFrom;
                this.#styleDragFrom = null;
                if (from === null || from === index) return;
                event.preventDefault();
                this.#moveTextStyle(from, index);
              }}
            >
              ${movable
                ? html`<span
                    class="grip"
                    draggable="true"
                    title="Drag to reorder. The Styles panel lists them in this order."
                    aria-hidden="true"
                    @dragstart=${(event: DragEvent) => {
                      this.#styleDragFrom = index;
                      event.dataTransfer?.setData('text/plain', `text-style:${one.entry.name}`);
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                    }}
                    @dragend=${() => {
                      this.#styleDragFrom = null;
                    }}
                  >${icon('grip', 12)}</span>`
                : html`<span></span>`}
              <button
                class="tstyle"
                type="button"
                data-text-style=${one.entry.name}
                aria-current=${picked?.entry.name === one.entry.name ? 'true' : 'false'}
                aria-keyshortcuts=${movable ? 'Alt+ArrowUp Alt+ArrowDown' : nothing}
                title=${movable ? `Edit ${one.name}. Alt and an arrow move it.` : `Edit ${one.name}`}
                @click=${() => {
                  this.textStyle = picked?.entry.name === one.entry.name ? null : one.entry.name;
                }}
                @keydown=${(event: KeyboardEvent) => {
                  if (!movable || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                  event.preventDefault();
                  const to = Math.max(0, Math.min(styles.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
                  if (to === index) return;
                  this.#moveTextStyle(index, to);
                  void this.updateComplete.then(() =>
                    this.renderRoot.querySelector<HTMLElement>(`[data-text-style="${CSS.escape(one.entry.name)}"]`)?.focus());
                }}
              >
                <span class="p" style=${look(textStyleDeclarations(one.entry))}>${one.name}</span>
                <span class="m">.${one.entry.name} · ${one.used}×</span>
              </button>
            </div>`)}
          </div>`
        : draft
          ? this.#renderCreateOffer(
              this.textStyleDraft,
              createTextStyleLabel(this.textStyleDraft),
              CREATE_TEXT_STYLE_TITLE,
              () => this.#createTextStyle(this.textStyleDraft),
            )
          : html`<p class="hint" style="margin:0">No text styles yet. Create one above, or style a text in Styles and save it from Typography.</p>`}
      ${picked ? this.#renderTextStyleEditor(picked.entry, picked.name, picked.used) : nothing}
    </heo-section>`;
  }

  #styleDragFrom: number | null = null;

  /**
   * The fonts the page carries: one card per family, its files and where each lives, what uses it,
   * and the font editor the picker opens (Add font / Edit font), so both manage fonts the same way.
   * The page's own `@font-face` families are listed after, as its own, and left alone.
   */
  #renderFonts(): TemplateResult | typeof nothing {
    const engine = this.editor;
    const needle = (this.query || this.fontDraft).trim().toLowerCase();
    const carried = engine.fonts.list();
    const shown = carried.filter((one) => !needle || one.family.toLowerCase().includes(needle));
    const own = pageFontFamilies()
      .filter((name) => !engine.fonts.has(name))
      .filter((name) => !needle || name.toLowerCase().includes(needle))
      .sort();
    if (this.query.trim() && !shown.length && !own.length) return nothing;
    // A catalogue font that matches what is typed and is not in the page yet: offered to add.
    const typed = this.fontDraft.trim();
    const addable = typed
      ? WEB_FONTS.filter((one) => one.name.toLowerCase().includes(typed.toLowerCase()) && !engine.fonts.has(one.name)).slice(0, 4)
      : [];
    const size = (font: ProjectFont): number => font.faces.reduce((sum, face) => sum + (face.src.startsWith('data:') ? Math.round((face.src.length * 3) / 4) : 0), 0);
    return html`<heo-section
      heading="Fonts"
      glyph="font"
      badge=${String(carried.length)}
      ?open=${openGroups.has('fonts') || Boolean(this.query.trim())}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) => this.#remember('fonts', event.detail.open)}
    >
      <heo-value-field
        data-font-find
        style="margin-bottom:8px"
        field-label="Find a font, or add one from Google"
        leading-icon="search"
        clearable
        chevron-hidden
        action-hidden
        placeholder="find a font, or add one from Google…"
        .value=${this.fontDraft}
        @value-input=${(event: CustomEvent<{ value: string }>) => {
          this.fontDraft = event.detail.value;
        }}
        @value-change=${(event: CustomEvent<{ value: string }>) => {
          this.fontDraft = event.detail.value;
        }}
        @value-submit=${(event: CustomEvent<{ value: string }>) => {
          const font = catalogueFont(event.detail.value) ?? addable[0];
          if (font && !engine.fonts.has(font.name)) this.fontEditing = { family: font.name, mode: 'add' };
        }}
      ></heo-value-field>
      ${this.fontEditing?.mode === 'add' ? this.#renderFontEditor(this.fontEditing.family, 'add') : nothing}
      ${addable.length && !this.fontEditing
        ? html`<div class="empty create" data-create-offer>
            ${shown.length ? nothing : html`<p>Nothing in the page matches <strong>${typed}</strong>.</p>`}
            ${addable.map((font) => html`<button class="btn sm" type="button" data-font-add=${font.name} title="Add it to the page: its files are kept with it" @click=${() => {
              this.fontEditing = { family: font.name, mode: 'add' };
            }}>${icon('plus', 12)} Add "${font.name}"</button>`)}
          </div>`
        : nothing}
      ${shown.map((font) => {
        const open = this.openFont === font.family;
        const users = open ? engine.fontUsers(font.family) : [];
        return html`<div class="cls" data-project-font=${font.family}>
          ${renderCardHeader({
            name: font.family,
            plain: true,
            meta: `${font.styles.length} style${font.styles.length === 1 ? '' : 's'} · ${font.place === 'embedded' ? `embedded${size(font) ? `, ${Math.round(size(font) / 1000)} kB` : ''}` : `${engine.fileFolders.font}/`}`,
            expanded: open,
            sessionDot: false,
            onToggle: () => {
              this.openFont = open ? null : font.family;
              if (open && this.fontEditing?.family === font.family) this.fontEditing = null;
            },
          })}
          ${open
            ? html`<div class="font-body">
                <div class="faces">
                  ${font.faces.map((face) => html`<div class="face">
                    <span class="fs" style=${`font-family:"${font.family}";font-style:${face.fontStyle}`}>${styleLabel(face.style)} <span class="hint">${face.subset}</span></span>
                    <span class=${face.src.startsWith('data:') ? 'loc emb' : 'loc'} title=${face.src.startsWith('data:') ? 'Inside the design system, as a data URL' : face.src}>${face.src.startsWith('data:') ? 'Embedded' : face.src.split('/').pop()}</span>
                  </div>`)}
                </div>
                <div class="used">Used by ${users.length ? users.map((one) => html`<span>${one}</span>`) : 'nothing yet'}</div>
                ${this.fontEditing?.family === font.family && this.fontEditing.mode === 'edit'
                  ? this.#renderFontEditor(font.family, 'edit')
                  : html`<div class="apply">
                      <button class="btn sm" type="button" data-font-edit=${font.family} @click=${() => {
                        this.fontEditing = { family: font.family, mode: 'edit' };
                      }}>${icon('sliders', 12)} Edit font</button>
                      <button class="btn sm danger" type="button" data-font-delete=${font.family} @click=${() => {
                        engine.removeProjectFont(font.family);
                        this.openFont = null;
                      }}>${icon('trash', 12)} Remove</button>
                    </div>`}
              </div>`
            : nothing}
        </div>`;
      })}
      ${own.map((name) => html`<div class="cls" data-page-font=${name}>
        <header class="card-head" style="cursor:default">
          <span class="n plain" style=${`font-family:"${name}"`}>${name}</span>
          <span class="meta">Your stylesheet</span>
        </header>
      </div>`)}
      ${!carried.length && !own.length && !typed
        ? html`<p class="hint" style="margin:0">No fonts in the page yet. Find a Google font above, or add one from the font picker in Styles.</p>`
        : nothing}
    </heo-section>`;
  }

  #renderFontEditor(family: string, mode: 'add' | 'edit'): TemplateResult {
    return html`<heo-font-editor
      style="margin-bottom:8px"
      .family=${family}
      .mode=${mode}
      @font-editor-close=${() => {
        this.fontEditing = null;
      }}
      @font-editor-done=${(event: CustomEvent<{ family: string; mode: string }>) => {
        this.fontEditing = null;
        if (event.detail.mode === 'add') {
          this.fontDraft = '';
          this.openFont = event.detail.family;
          openGroups.add('fonts');
        }
        if (event.detail.mode === 'remove') this.openFont = null;
      }}
    ></heo-font-editor>`;
  }

  /**
   * A finder that found nothing: the Library panel's empty state, the line saying so and a button
   * to make what was typed. Each section's field also makes it on Enter or +; the button is there
   * because a list that just goes quiet does not say that is the next step.
   */
  #renderCreateOffer(typed: string, label: string, title: string, create: () => void): TemplateResult {
    return html`<div class="empty create" data-create-offer>
      <p>Nothing matches <strong>${typed.trim()}</strong>.</p>
      <button class="btn sm" type="button" title=${title} @click=${create}>
        ${icon(CREATE_ICON, 12)} ${label}
      </button>
    </div>`;
  }

  /** Move a style in the whole list (only the unfiltered list moves), as one undo step. */
  #moveTextStyle(from: number, to: number): void {
    const order = this.editor.textStyles().map((one) => one.entry.name);
    const [one] = order.splice(from, 1);
    if (!one) return;
    order.splice(to, 0, one);
    this.editor.reorderTextStyles(order);
  }

  /** "Find or create": an exact name opens that style; anything else new is created and opened. */
  #createTextStyle(raw: string): void {
    const name = raw.trim();
    if (!name) return;
    const existing = this.editor.textStyles().find((one) => one.name.toLowerCase() === name.toLowerCase());
    const className = existing?.entry.name ?? this.editor.createTextStyle(name);
    if (!className) return;
    if (!existing) this.editor.notify(`Created the text style ${name}.`, 'success');
    this.textStyleDraft = '';
    this.textStyle = className;
    openGroups.add('text-styles');
  }

  /** A text style's rows: its name, then Typography's rows, writing to the class. */
  #renderTextStyleEditor(entry: DesignClass, name: string, used: number): TemplateResult {
    const engine = this.editor;
    /*
     * As the class editor reads them: from before any preview in flight. A preview is written into
     * the registry this reads, so the font field was handed the font being hovered as its value —
     * its own preview echoed back as though it had been picked — where the Styles panel's field
     * keeps the value it had. The two fields now see the same thing.
     */
    const preview = engine.classPreviewTarget;
    const decl = preview && preview.name === entry.name ? preview.declarations : entry.declarations;
    const write = (property: string, value: string): void => {
      if (value.trim()) engine.setClassDeclaration(entry.name, property, value);
      else if (property in decl) engine.removeClassDeclaration(entry.name, property);
    };
    const rows = shownTypographyRows(decl['text-decoration-line'] ?? '');
    const el = engine.selected;
    const worn = el ? engine.textStyleOf(el)?.name === entry.name : false;
    return html`<div class="cls tstyle-card"><div
      class="tstyle-ed"
      data-text-style-editor=${entry.name}
    >
      <div class="trow">
        <span class="dot off"></span>
        <span class="tname">Name</span>
        <heo-value-field
          field-label="Text style name"
          .value=${name}
          action-hidden
          chevron-hidden
          @value-change=${(event: CustomEvent<{ value: string }>) => {
            const next = event.detail.value.trim();
            if (next && next !== name) engine.setClassDeclaration(entry.name, TEXT_STYLE_MARKER, textStyleMarker(next), undefined, `Rename text style to ${next}`);
          }}
        ></heo-value-field>
        <span></span>
      </div>
      ${rows.map((row) => {
        const value = decl[row.property] ?? '';
        const set = Boolean(value);
        return html`<div class=${row.sub ? 'trow sub' : 'trow'} data-property=${row.property}>
          <span class=${set ? 'dot' : 'dot off'}></span>
          <span class="tname" title=${row.property}>${row.label}</span>
          ${row.segments
            ? html`<heo-segmented
                .options=${row.segments}
                .value=${value}
                clearable
                label=${row.label}
                @segment-change=${(event: CustomEvent<{ value: string }>) => write(row.property, event.detail.value)}
              ></heo-segmented>`
            : html`<heo-value-field
                data-property=${row.property}
                field-label=${row.label}
                .kind=${valueKindFor(row.property)}
                .property=${row.property}
                .value=${value}
                .suggestions=${buildSuggestions(engine, row.property, null)}
                .shadowTokens=${row.property === 'text-shadow' ? shadowSwatches(engine) : []}
                @value-input=${(event: CustomEvent<{ value: string }>) => {
                  if (event.detail.value.trim()) engine.previewClassDeclaration(entry.name, row.property, event.detail.value);
                }}
                @value-revert=${() => engine.cancelPreview()}
                @value-change=${(event: CustomEvent<{ value: string }>) => write(row.property, event.detail.value)}
              ></heo-value-field>`}
          ${set
            ? renderKill({ label: `Remove ${row.label} from ${name}`, tight: true, onClick: () => engine.removeClassDeclaration(entry.name, row.property) })
            : html`<span></span>`}
        </div>`;
      })}
      <p class="hint" style="margin:0">The rows the Styles panel's Typography has. Here they change ${name} itself: ${used === 1 ? 'the element using it follows' : `the ${used} elements using it follow`}.</p>
    </div>
    <!-- The class card's footer (class-editor.ts), so a text style is put on and deleted the same way. -->
    <div class="apply">
      ${el
        ? html`<button
            class="btn sm"
            type="button"
            aria-pressed=${worn}
            title=${worn ? `Take ${labelFor(el)} out of ${name}` : `Put ${labelFor(el)} in ${name}`}
            @click=${() => engine.applyTextStyle(worn ? null : entry.name, el)}
          >
            ${icon(worn ? 'check' : 'plus', 12)} ${worn ? 'Applied here' : 'Apply to selection'}
          </button>`
        : nothing}
      <button
        class="btn sm danger"
        type="button"
        data-text-style-delete
        title=${used ? `Delete ${name}: ${used === 1 ? 'the element using it loses it' : `the ${used} elements using it lose it`}` : `Delete ${name}`}
        @click=${() => {
          engine.removeClass(entry.name);
          this.textStyle = null;
        }}
      >
        ${icon('trash', 12)} Delete
      </button>
    </div></div>`;
  }

  #renderClassList(el: HTMLElement | null): TemplateResult | typeof nothing {
    const globalClasses = this.#matchClasses(this.editor.classes.list());
    const localQuery = this.classDraft.trim();
    const classes = this.#matchClasses(globalClasses, localQuery);
    // Keep the section alive while its own composer is being used, even when nothing matches yet.
    if (this.query.trim() && !globalClasses.length && !localQuery) return nothing;
    const usage = this.editor.classes.usage();

    return html`<heo-section
      heading="Reusable classes"
      glyph="blocks"
      badge=${String(classes.length)}
      ?open=${openGroups.has('classes')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('classes', event.detail.open)}
    >
      <heo-value-field
        ${field(this.classForm, 'class-create')}
        style="margin-bottom:8px"
        leading-icon="search"
        clearable
        action="Create class"
        action-icon="plus"
        create-label=${createClassLabel(normalizeClassName(this.classDraft) || this.classDraft)}
        create-title=${CREATE_DESIGN_CLASS_TITLE}
        .suggestions=${classSuggestions(this.editor, this.classDraft)}
        placeholder="find or create a class"
        @value-input=${(event: CustomEvent<{ value: string }>) => {
        this.classDraft = event.detail.value;
      }}
        @value-change=${(event: CustomEvent<{ value: string }>) => {
        this.classDraft = event.detail.value;
      }}
        @value-submit=${(event: CustomEvent<{ value: string }>) => {
        this.classDraft = event.detail.value;
        if (this.classForm.submit()) this.#createClass(event.detail.value);
      }}
      ></heo-value-field>
      ${this.classForm.error('class-create')}
      <p class="hint" style="margin:0 0 8px">
        Search existing classes or type a new name, then press Enter or +.
      </p>
      ${el
        ? html`<button
            class="btn sm"
            type="button"
            style="margin-bottom:8px"
            title="Turn this element's inline styles into a class"
            @click=${() => this.editor.beginClassExtraction(el)}
          >
            ${icon('droplet', 12)} Extract from ${labelFor(el)}
          </button>`
        : nothing}
      <button
        class="btn sm"
        type="button"
        style="margin-bottom:8px"
        title="Paste CSS and choose a class, rule, or inline destination"
        @click=${() => this.editor.beginCssPaste({ context: 'class', element: el })}
      >
        ${icon('clipboard', 12)} Paste CSS…
      </button>
      ${classes.length === 0 && localQuery && !this.editor.classes.get(normalizeClassName(localQuery) ?? '')
        ? this.#renderCreateOffer(localQuery, createClassLabel(normalizeClassName(localQuery) || localQuery), CREATE_DESIGN_CLASS_TITLE, () => {
            if (this.classForm.submit()) this.#createClass(this.classDraft);
          })
        : classes.length === 0
        ? html`<p class="hint" style="margin:0 0 8px">
            ${globalClasses.length || localQuery
            ? 'No reusable classes match the current filters.'
            : "No classes yet. Extract one from an element's inline styles, or create one above and add its properties by hand."}
          </p>`
        : repeat(
          classes,
          (entry) => entry.name,
          (entry) => this.#renderClass(entry, usage.get(entry.name) ?? 0, el),
        )}
    </heo-section>`;
  }

  /**
   * Create an empty class and open it in a dialog, ready for its first property.
   *
   * Empty on purpose: there is no element to take declarations from here, so the
   * useful next step is the property editor.
   *
   * That step used to be an expanded card in the list below, and the list is the wrong
   * place for it. Two filters narrow that list — the panel's search field and this
   * composer's own draft, which is deliberately left in the box — so submitting a name
   * while either is set created the class, announced it, and showed nothing. Unfiltered
   * it was merely buried at whatever depth the registry's order put it. So the thing that
   * was just asked for is put in front of the user; see `StyleEdit`.
   *
   * The card is still expanded underneath, which costs nothing and means closing the
   * dialog leaves the list showing what was worked on rather than a collapsed row.
   */
  #createClass(raw: string): void {
    // Checked by the form that called this; see `classForm` and `queryForm`.
    const name = normalizeClassName(raw);
    if (!name) return;
    const existing = this.editor.classes.get(name);
    if (existing) {
      this.editor.notify(`.${name} already exists — opening it.`, 'info');
    } else {
      this.editor.classes.upsert({ name, declarations: {}, origin: 'user' });
      this.editor.notify(`Created .${name}.`, 'success');
    }
    this.expandedClass = name;
    openGroups.add('classes');
    this.version += 1;
    // Keep the submitted name in the field so the new card remains easy to find in the list.
    this.editor.openStyleEditor('class', name, !existing);
  }

  /* ---------------------------------------------------------------------- */
  /* CSS rules                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * The rule registry: write a selector, then give it properties.
   *
   * The composer leads rather than trailing the list, which is the opposite of the class
   * section and deliberate. A class section is usually visited to adjust something that
   * exists — the list is the subject. This section is almost always opened to *add* a
   * rule, because rules are how you reach the things the Styles panel cannot select at
   * all: every heading at once, a hover state, a pseudo-element.
   *
   * The list under it holds the page's own rules as well as this session's, read in on
   * mount the same way tokens and classes are. That is what makes this a manager rather
   * than a scratchpad: the rules already in the file are the ones most likely to need
   * changing, and a rule written last session is in the file now.
   */
  #renderRules(el: HTMLElement | null): TemplateResult | typeof nothing {
    const globalRules = this.#matchRules(this.editor.rules.list());
    const localQuery = this.ruleDraft.trim();
    const rules = this.#matchRules(globalRules, localQuery);
    // Keep the section alive while its own composer is being used, even when nothing matches yet.
    if (this.query.trim() && !globalRules.length && !localQuery) return nothing;
    const matches = this.editor.rules.matches();
    const authored = rules.filter((entry) =>
      // By key: a scanned `.card` is not authored because a managed `.card` at ≤767px is.
      this.editor.rules.authored().some((own) => designRuleKey(own) === designRuleKey(entry)),
    ).length;
    const fromPage = rules.length - authored;

    return html`<heo-section
      heading="CSS rules"
      glyph="code"
      badge=${String(rules.length)}
      ?open=${openGroups.has('rules')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('rules', event.detail.open)}
    >
      <button
        class="btn sm"
        type="button"
        style="margin-bottom:8px"
        title="Paste CSS and choose a shared selector or another destination"
        @click=${() => this.editor.beginCssPaste({ context: 'rule', element: el })}
      >
        ${icon('clipboard', 12)} Paste CSS…
      </button>
      ${this.#renderRuleComposer(el)}
      ${rules.length === 0 && localQuery
        ? this.#renderCreateOffer(localQuery, createRuleLabel(localQuery), CREATE_RULE_TITLE, () => {
            if (this.ruleForm.submit()) this.#createRule(this.ruleDraft);
          })
        : rules.length === 0
        ? html`<p class="hint" style="margin:10px 0 0">
            ${globalRules.length || localQuery
            ? 'No CSS rules match the current filters.'
            : html`A rule styles everything its selector matches, so it reaches what selecting a
                  single element cannot: every heading at once, a link on hover, a list marker.
                  Tokens and classes still apply — a rule can use both.`}
          </p>`
        : html`
            <!--
              What the list is made of, before it is scrolled. The two halves behave
              differently — a page rule is edited in the file it came from and cannot be
              deleted from here — so saying which is which up front is worth one line.
            -->
            <p class="hint" style="margin:10px 0 8px">
              ${fromPage
            ? html`${fromPage} read from this page's stylesheets${authored
              ? html`, ${authored} written here (marked
                      <span class="legend-dot"></span>)`
              : ''}.
                  Editing a page rule changes it in the file it came from; only the ones
                  written here are deleted from here.`
            : html`${authored} written in this session.`}
              ${this.editor.rules.truncated
            ? html`<br />This page has more rules than are listed — the scan stops once
                  the list would stop being usable.`
            : nothing}
            </p>
            <div>
              ${repeat(
              rules,
              (entry) => designRuleKey(entry),
              (entry) => this.#renderRule(entry, matches.get(designRuleKey(entry)) ?? 0, el),
            )}
            </div>
          `}
    </heo-section>`;
  }

  /**
   * The selector field, plus one-tap seeds from the current selection.
   *
   * The seeds matter more than they look. Typing a selector from nothing needs you to
   * already know what the page is made of; "style every `h2`" or "style `.card`" is the
   * request behind most rules, and offering it as a button skips the part where the user
   * has to guess at the vocabulary. `suggestedRuleSelector` deliberately describes a set
   * rather than picking one element out of one.
   */
  #renderRuleComposer(el: HTMLElement | null): TemplateResult {
    const seed = el ? this.editor.suggestedRuleSelector(el) : '';
    const tag = el?.tagName.toLowerCase() ?? '';
    const seeds = [...new Set([seed, tag].filter((value) => value && !this.editor.rules.has(value)))];

    return html`<div class="compose">
      <div class="head">${icon('plus', 12)} New rule</div>
      <heo-selector-field
        ${field(this.ruleForm, 'rule-create')}
        placeholder="h2 > p, a:hover, .card .title"
        action="Create rule"
        action-icon="plus"
        clearable
        .declaredCountFor=${(selector: string) => this.#declaredRuleCount(selector)}
        @selector-input=${(event: CustomEvent<{ value: string }>) => {
        this.ruleDraft = event.detail.value;
      }}
        @selector-submit=${(event: CustomEvent<{ value: string }>) => {
        this.ruleDraft = event.detail.value;
        if (this.ruleForm.submit()) this.#createRule(event.detail.value);
      }}
      ></heo-selector-field>
      ${this.ruleForm.error('rule-create')}
      ${seeds.length
        ? html`<div class="seed">
            ${seeds.map(
          (value) => html`<button
              class="btn sm"
              type="button"
              title=${`Start a rule for ${value}`}
              @click=${() => this.#createRule(value)}
            >
              ${icon('cursor', 11)} <code class="mono">${value}</code>
            </button>`,
        )}
          </div>`
        : nothing}
      <p class="hint" style="margin:0">
        ${this.#draftAlreadyExists()
        ? html`${icon('alert', 11)} A rule for
            <code class="mono">${this.ruleDraft.trim()}</code> already exists — this will open it
            rather than adding a second one.`
        : html`Combinators and pseudo-classes are fine. Matches are outlined on the page while
            the field has focus.`}
      </p>
    </div>`;
  }

  #declaredRuleCount(selector: string): number {
    const entry = this.editor.rules.get(selector);
    if (!entry) return 0;
    return Object.values(entry.declarations).filter((value) => value.trim()).length;
  }

  /**
   * True when what is being typed already has a rule.
   *
   * Worth saying before the button is pressed rather than after. Two rules for one
   * selector cannot exist — the registry is keyed on it — so submitting a duplicate opens
   * the original, and a user who expected a second, independent rule would otherwise
   * conclude the button had not worked.
   */
  #draftAlreadyExists(): boolean {
    const draft = this.ruleDraft.trim();
    return Boolean(draft) && this.editor.rules.has(draft);
  }

  /**
   * Create a rule and open it in a dialog, ready for its first property.
   *
   * Empty on purpose, the same as `#createClass`, and opened in a dialog for the same
   * reason — more sharply here, because a selector is a much better filter match than a
   * class name is. "p already has a rule — opening it" opened a card below every other
   * rule whose selector or declarations contain a `p`, which on a real page is most of
   * them, and the panel's search field could remove it from the list altogether.
   *
   * Whether it was created is read from the registry's size rather than asked for, since
   * `createDesignRule` returns the canonical selector either way and normalising the raw
   * text a second time here is how the two would come to disagree.
   */
  #createRule(rawSelector: string): void {
    const before = this.editor.rules.size;
    const selector = this.editor.createDesignRule(rawSelector);
    // Null means the engine refused it and has already said why.
    if (!selector) return;
    this.expandedRule = selector;
    this.editingRuleSelector = null;
    openGroups.add('rules');
    this.version += 1;
    // Keep the submitted selector in the field so the new rule remains easy to find in the list.
    this.editor.openStyleEditor('rule', selector, this.editor.rules.size > before);
  }

  #renderRule(entry: DesignRule, matches: number, el: HTMLElement | null): TemplateResult {
    const key = designRuleKey(entry);
    return RuleEditor.render(entry, {
      expanded: this.expandedRule === key,
      matches,
      onToggle: () => {
        this.expandedRule = this.expandedRule === key ? null : key;
        // Retargeting belongs to an open card. Left set, reopening the card would land
        // straight back in the selector field the user had already stepped away from.
        this.editingRuleSelector = null;
      },
      host: this.#ruleHost(el),
    });
  }

  /** What the rule editor reads back from this panel. */
  #ruleHost(el: HTMLElement | null): RuleEditorHost {
    return {
      engine: this.editor,
      element: el,
      form: this.propertyForm,
      newProperty: this.newRuleProperty,
      onNewProperty: (value) => {
        this.newRuleProperty = value;
      },
      onRemoved: (removed) => {
        if (this.expandedRule === removed) this.expandedRule = null;
        if (this.editingRuleSelector === removed) this.editingRuleSelector = null;
      },
      // The selector is the identity, so a rename moves the card. Without this the card
      // the user is working in collapses the moment they retarget it.
      onRenamed: (from, to) => {
        if (this.expandedRule === from) this.expandedRule = to;
      },
      editingKey: this.editingRuleSelector,
      onEditSelector: (next) => {
        this.editingRuleSelector = next;
        if (next) this.expandedRule = next;
      },
      /*
       * No Apply, and no Delete from inside the declaration list.
       *
       * `RuleEditor` renders its own action row, and it has to: "apply to selection" is
       * meaningless for a rule, which applies by matching rather than by being put on
       * something. Set explicitly so the shared host type states what this surface offers
       * rather than leaving it to a default.
       */
      actions: 'none',
    };
  }

  #renderClass(entry: DesignClass, uses: number, el: HTMLElement | null): TemplateResult {
    return ClassEditor.render(entry, {
      expanded: this.expandedClass === entry.name,
      uses,
      onToggle: () => {
        this.expandedClass = this.expandedClass === entry.name ? null : entry.name;
      },
      host: {
        engine: this.editor,
        element: el,
        form: this.propertyForm,
        newProperty: this.newClassProperty,
        onNewProperty: (value) => {
          this.newClassProperty = value;
        },
        onRemoved: (name) => {
          if (this.expandedClass === name) this.expandedClass = null;
        },
      },
    });
  }

  /**
   * Handing this design system to another page, and taking one in.
   *
   * The section used to offer a file download and a file picker, which is the right
   * pair for archiving a system and the wrong one for reusing it: a file has to be
   * hosted somewhere the other page can reach, and the answer to "make this page
   * look like that one" should not involve deployment. So the seed leads — the whole
   * system as one string — and the file stays underneath for when a document
   * belongs in the repository.
   *
   * The seed alone is still only half an answer, since knowing the string does not
   * tell you whether it goes in an attribute, a config object or a script block.
   * Hence a snippet per integration rather than a bare value to copy.
   */
  #renderTransfer(): TemplateResult {
    return html`<heo-section
      heading="Share & import"
      glyph="download"
      ?open=${openGroups.has('transfer')}
      @section-toggle=${(event: CustomEvent<{ open: boolean }>) =>
        this.#remember('transfer', event.detail.open)}
    >
      ${DesignTransfer.render(this.#transfer())}
    </heo-section>`;
  }

  /** The state the shared surface reads and writes, owned by this panel. */
  #transfer(): DesignTransferHost {
    return {
      engine: this.editor,
      target: this.seedTarget,
      onTarget: (target) => {
        this.seedTarget = target;
      },
      form: this.transferForm,
      incoming: this.incoming,
      onIncoming: (text) => {
        this.incoming = text;
      },
      overwrite: this.overwrite,
      onOverwrite: (value) => {
        this.overwrite = value;
      },
      onSeed: () => {
        this.version += 1;
      },
    };
  }

  /* ---------------------------------------------------------------------- */

  async #rescan(): Promise<void> {
    // Through the engine rather than straight at the registries: a connected folder
    // makes some stylesheets readable only from disk, and that read is asynchronous.
    await this.editor.rescanStyles();
    this.editor.notify('Re-read the page stylesheets.', 'success');
  }

  /**
   * Token edits are recorded as undoable commands like any other change, so a
   * mistaken value can be walked back with the same shortcut as everything else.
   */
  #setToken(token: DesignToken, value: string): void {
    if (!value.trim() || value === token.value) return;

    /*
     * A token the project already declares is edited where it is declared.
     *
     * The alternative — and what this used to do unconditionally — is to treat every edit as a new
     * declaration the editor owns, emit it into the managed block, and let the save append that
     * block to the end of the target stylesheet. For a token the editor invented that is right.
     * For one the file already has it is not: the file ends up declaring `--brand` twice, the
     * original left behind with the old value, and the reader has to know about cascade order to
     * work out which one is in effect.
     *
     * `setRuleDeclaration` is the path that already does this correctly for every other
     * declaration in the page — it captures the rule's position at edit time, patches that one
     * line on save, and has its own undo handling. Reusing it means a token edit and a colour
     * edit reach a stylesheet the same way, rather than by two mechanisms that agree until they
     * do not.
     */
    const rule = this.editor.tokens.originRule(token.name);
    if (rule) {
      this.editor.setRuleDeclaration(rule, `--${token.name}`, value);
      return;
    }

    const previous = { ...token };
    this.editor.history.commit({
      label: `Set --${token.name}`,
      mergeKey: `token:${token.name}`,
      subject: `token:${token.name}`,
      record: {
        id: `t${Date.now().toString(36)}`,
        kind: 'token',
        summary: `Set --${token.name} to ${value}`,
        target: ':root',
        before: token.value,
        after: value,
        detail: { token: `--${token.name}`, group: token.group },
        at: Date.now(),
      },
      /*
       * `origin: 'user'`, and that word is doing the work here.
       *
       * A token read out of the page's stylesheets is `'stylesheet'`, and `toCSS()`
       * leaves those out of the generated sheet on purpose — emitting the page's whole
       * theme back at it would turn a diff into a copy. But that filter also meant a
       * token the user *changed* was left out, so the map held the new colour, the row
       * showed the new colour, and the page went on rendering the old one.
       *
       * Once it has been edited it is this session's value, not the file's, so it is
       * emitted, exported, counted as new and offered in the save prompt — which is
       * what every other `origin` check in the codebase is asking about. Undo restores
       * `previous` verbatim, origin included, so taking the edit back also takes the
       * declaration out of the generated sheet and lets the file's own value show
       * through again.
       */
      apply: () => this.editor.tokens.upsert({ ...token, value, origin: 'user' }),
      revert: () => this.editor.tokens.upsert(previous),
    });
  }

  #tokenIssues(): FieldIssue[] {
    const issues: FieldIssue[] = [];
    const name = this.newName.trim().replace(/^--/, '');
    if (!name) issues.push({ field: 'token-name', message: 'Type a name for the token.' });
    else if (!/^[A-Za-z_][\w-]*$/.test(name)) {
      issues.push({
        field: 'token-name',
        message: 'A token name starts with a letter or _ and uses only letters, numbers, - or _.',
      });
    } else if (this.editor.tokens.get(name)) {
      issues.push({ field: 'token-name', message: `--${name} already exists. Choose another name, or edit it in the list.` });
    }
    if (!this.newValue.trim()) issues.push({ field: 'token-value', message: 'Give the token a value.' });
    return issues;
  }

  #createToken(): void {
    if (!this.tokenForm.submit()) return;
    const name = this.newName.trim().replace(/^--/, '');
    const value = this.newValue.trim();
    const token: DesignToken = {
      name,
      value,
      group: this.newGroup,
      label: prettifyTokenName(name),
      origin: 'user',
    };
    this.editor.history.commit({
      label: `Add --${name}`,
      record: {
        id: `t${Date.now().toString(36)}`,
        kind: 'token',
        summary: `Add design token --${name}: ${value}`,
        target: ':root',
        after: value,
        detail: { token: `--${name}`, group: this.newGroup },
        at: Date.now(),
      },
      apply: () => this.editor.tokens.upsert(token),
      revert: () => {
        this.editor.tokens.remove(name);
      },
    });
    this.newName = '';
    this.newValue = '';
    this.editor.notify(`Added --${name}.`, 'success');
  }

  #removeToken(token: DesignToken): void {
    /*
     * A token the project declares is deleted where it is declared.
     *
     * Dropping it from this registry only removes the editor's own copy, and for a token read out
     * of a stylesheet there was never a copy to remove — the declaration is in the file, and the
     * file goes on declaring it. So the save had nothing of its own to write and reported the
     * deletion as impossible: "Nothing of the editor's design system is left to write, and
     * styles.css has no block of it to clear." The token came back on the next reload.
     *
     * Removing the declaration from the rule that holds it *is* the deletion, and it is the same
     * path `#setToken` takes to change one — so editing a token and deleting it reach a file the
     * same way rather than by two mechanisms that agree until they do not.
     */
    const rule = this.editor.tokens.originRule(token.name);
    if (rule) {
      this.editor.setRuleDeclaration(rule, `--${token.name}`, '');
      return;
    }

    this.editor.history.commit({
      label: `Delete --${token.name}`,
      record: {
        id: `t${Date.now().toString(36)}`,
        kind: 'token',
        summary: `Remove design token --${token.name}`,
        target: ':root',
        before: token.value,
        detail: { token: `--${token.name}` },
        at: Date.now(),
      },
      apply: () => {
        this.editor.tokens.remove(token.name);
      },
      revert: () => this.editor.tokens.upsert(token),
    });
  }

  #remember(id: string, open: boolean): void {
    if (open) openGroups.add(id);
    else openGroups.delete(id);
    this.version += 1;
  }
}

function glyphForGroup(group: TokenGroup): string {
  switch (group) {
    case 'color':
      return 'droplet';
    case 'space':
      return 'wrap';
    case 'size':
      return 'sliders';
    case 'radius':
      return 'card';
    case 'shadow':
      return 'sparkle';
    case 'font':
      return 'text';
    case 'border':
      return 'panel';
    case 'motion':
      return 'refresh';
    default:
      return 'blocks';
  }
}

/** A sensible starting value so a newly added property is immediately visible. */
declare global {
  interface HTMLElementTagNameMap {
    'heo-tokens-panel': HeoTokensPanel;
  }
}
