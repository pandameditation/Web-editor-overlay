import { BLOCK_STYLE_ID, CLASS_STYLE_ID, RULE_STYLE_ID, TOKEN_STYLE_ID } from './constants.js';
import { parseDeclarations, splitBoxValue } from './css.js';
import {
  fromRecord,
  shorthandChain,
  splitImportant,
  withValue,
  type Declaration,
} from './declaration-list.js';
import {
  breakpointOf,
  EDITABLE_STATES,
  isPseudoElement,
  slotForMedia,
  slotsWith,
  type SizeSlot,
} from './breakpoints.js';
import { styleMirrorFor } from './mirror.js';
import { designRuleKey } from './rules.js';
import { CONSTRUCTED_SHEET_REASON, ruleDeclarations } from './sheets.js';
import {
  compareSpecificity,
  specificityNumber,
  specificityOf,
  type Specificity,
} from './specificity.js';
import {
  authoredMediaText,
  authoredPrelude,
  beginMediaPass,
  effectiveWidth,
  mediaApplies,
} from './viewport.js';

/**
 * What reaches an element, from where, and what wins — at any width and in any state.
 *
 * One model per element, built from every style rule whose selector reaches it: every `@media`
 * whatever it evaluates to now, every state and pseudo-element, with real specificity tuples and
 * document order. The panel, the AI context, the engine's pinning and the tokens all read the
 * cascade from here, so they cannot disagree about which declaration is in effect.
 *
 * Two things this replaced were wrong in ways the page could show. Rules inside a media query that
 * did not match the window were never walked, so a preview at another width had nothing to show.
 * And the reader behind the panel let a plain inline value overwrite an `!important` rule's, so
 * the panel showed a colour the page was not using.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Where one declaration lives, which decides how an edit to it is written. */
export type WriteTarget =
  | { kind: 'inline'; element: HTMLElement }
  /** A readable page stylesheet rule, mirrors included: patched in place. */
  | { kind: 'live'; rule: CSSStyleRule }
  /** A ClassRegistry-owned, unconditional `.name` rule. */
  | { kind: 'class'; name: string }
  /** A RuleRegistry-owned rule, by its registry key. */
  | { kind: 'design-rule'; key: string }
  | { kind: 'readonly'; reason: string };

/** One style rule that reaches the element through one part of its selector list. */
export interface RuleEntry {
  rule: CSSStyleRule;
  /** `rule.selectorText`. */
  selector: string;
  /** The selector-list part that reached the element. */
  matched: string;
  /** `matched` with its state and pseudo-element peeled off: `.card`, `.promo .card`. */
  family: string;
  /** The peeled part: `:hover`, `::before`, `:hover::before`, or `''`. */
  state: string;
  /** The innermost media condition, authored, or null for none. */
  media: string | null;
  /** Every media condition the rule sits under (the sheet's own included), outermost first. */
  medias: string[];
  /** Every enclosing at-rule prelude, authored, outermost first. */
  conditions: string[];
  /** Every enclosing `@supports` passes. */
  supports: boolean;
  /** Inside `@container`: whether it applies depends on a container the editor cannot judge. */
  container: boolean;
  /** Inside `@layer`: the order shown may differ from the page's. */
  layered: boolean;
  specificity: Specificity;
  /** Document order: sheet index × 1e6 + depth-first rule index. Later wins a tie. */
  order: number;
  /** `site.css`, `embedded`, `adopted`, … */
  sheetLabel: string;
  /** What the rule declares as committed, with any in-flight preview subtracted. */
  declarations: Declaration[];
  target: WriteTarget;
}

export interface Contribution {
  property: string;
  /**
   * The value this contribution gives the property. For a box side supplied by its shorthand
   * (`padding-top` from `padding: 12px 16px`), that side; otherwise the declaration's text.
   */
  value: string;
  important: boolean;
  /** The shorthand that supplies this longhand, when it is not declared by name. */
  via?: string;
  /** Position inside its block: later wins inside one block. */
  index: number;
  source: { kind: 'inline' } | { kind: 'rule'; entry: RuleEntry };
}

/** `applying[0]` is the winner. `idle` names the property but does not apply here. */
export interface CascadeList {
  applying: Contribution[];
  idle: Contribution[];
}

/** `width: null` is the width the page renders at now (`effectiveWidth()`). */
export interface CascadeContext {
  width: number | null;
  state?: string;
}

/** The rules sharing one selector once states and pseudo-elements are peeled off. */
export interface Family {
  key: string;
  isClass: boolean;
  members: RuleEntry[];
  /** `order` of the first member, for document order between families. */
  first: number;
}

/** An in-flight inline preview, as a reader of the cascade needs to see it. */
export interface InlinePreview {
  property: string;
  before: string;
}

/** The engine's four in-flight previews, each subtracted from what the model reports. */
export interface ModelPreviews {
  inline?: (InlinePreview & { el: HTMLElement }) | null;
  rule?: { rule: CSSStyleRule; property: string; before: string; priority: string } | null;
  cls?: { name: string; declarations: Record<string, string> } | null;
  designRule?: { key: string; declarations: Record<string, string> } | null;
}

export interface ElementModelOptions {
  previews?: ModelPreviews;
  /** The user's own viewport sizes, which add `from-W` slots. */
  sizes?: readonly number[];
}

export interface ElementModel {
  element: HTMLElement;
  /** The width the page renders at now. */
  width: number;
  /** The style attribute as committed, with importance. */
  inline: Declaration[];
  /** Every style rule reaching the element: every media, every state. */
  entries: RuleEntry[];
  cascade(property: string, ctx?: CascadeContext): CascadeList;
  /** Media at `width` (null: now), `@supports` passes, and not inside `@container`. */
  applies(entry: RuleEntry, width?: number | null): boolean;
  /** Names with an applying declaration now, as declared (not expanded), sorted. */
  appliedProperties(): string[];
  families(): { classes: Family[]; others: Family[]; unknownClasses: string[] };
  slots(): SizeSlot[];
  /** `'base'`, a slot key, or `other:<media>`. */
  slotOf(entry: RuleEntry): string;
  /** The widths where this element's rules change, sorted. */
  breakpoints(): number[];
  /** The states and pseudo-elements with at least one rule applying now. */
  groups(): { state: string; kind: 'state' | 'pseudo-element' }[];
  /** How many elements the family's selector matches. */
  reach(family: string): number;
  inheritedFrom(property: string): { element: HTMLElement; contribution: Contribution } | null;
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

function matches(el: HTMLElement, selectorText: string): boolean {
  // `:host`, `::part()` and friends throw on plain elements.
  try {
    return el.matches(selectorText);
  } catch {
    return false;
  }
}

/**
 * Pseudo-classes that describe a passing state rather than a place in the tree.
 *
 * The distinction is what makes a rule findable. `el.matches('a:hover')` answers
 * "is this link hovered *right now*", which is false every time a panel asks, so
 * the rule styling a link's hover was invisible to the editor. Structural
 * pseudo-classes are the opposite: `:first-child` and `:nth-of-type()` are facts
 * about the element, so they stay in the selector and keep matching honest.
 */
const STATE_PSEUDO_CLASSES = new Set([
  'active', 'autofill', 'checked', 'default', 'disabled', 'enabled', 'focus',
  'focus-visible', 'focus-within', 'fullscreen', 'hover', 'in-range',
  'indeterminate', 'invalid', 'link', 'open', 'optional', 'out-of-range',
  'placeholder-shown', 'read-only', 'read-write', 'required', 'target',
  'user-invalid', 'user-valid', 'valid', 'visited',
]);

/** Pseudo-elements, including the four that predate the double colon. */
const PSEUDO_ELEMENTS = new Set([
  'after', 'backdrop', 'before', 'details-content', 'file-selector-button',
  'first-letter', 'first-line', 'grammar-error', 'marker', 'placeholder',
  'selection', 'spelling-error', 'target-text',
]);

/** Split a selector list on top-level commas, so `:is(a, b)` survives intact. */
export function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of selectorText) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Peel the state and pseudo-element parts off one compound selector.
 *
 * Returns the selector that can still be tested against a live element, plus what
 * was removed, in source order — so `a:hover::before` reports `:hover::before` and
 * leaves `a` to match against.
 */
export function peelPseudos(part: string): { base: string; pseudo: string } {
  let base = '';
  let pseudo = '';
  let index = 0;
  let depth = 0;
  while (index < part.length) {
    const ch = part[index];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch !== ':' || depth > 0) {
      base += ch;
      index += 1;
      continue;
    }
    const double = part[index + 1] === ':';
    const start = index + (double ? 2 : 1);
    let end = start;
    while (end < part.length && /[\w-]/.test(part[end])) end += 1;
    const name = part.slice(start, end).toLowerCase();
    // Any argument travels with the pseudo it belongs to.
    let argument = '';
    if (part[end] === '(') {
      let inner = 1;
      let cursor = end + 1;
      while (cursor < part.length && inner > 0) {
        if (part[cursor] === '(') inner += 1;
        if (part[cursor] === ')') inner -= 1;
        cursor += 1;
      }
      argument = part.slice(end, cursor);
      end = cursor;
    }
    const token = `${double ? '::' : ':'}${name}${argument}`;
    const isPseudoElementName = double || PSEUDO_ELEMENTS.has(name);
    if (isPseudoElementName || STATE_PSEUDO_CLASSES.has(name)) pseudo += token;
    else base += token;
    index = end;
  }
  return { base: base.trim(), pseudo };
}

/**
 * How a rule reaches this element, if it does.
 *
 * The first part of the list that matches decides the state. Its specificity is the highest of
 * the parts that match in that same state, because that is the one the browser applies.
 */
function reachOf(
  el: HTMLElement,
  selectorText: string,
): { matched: string; base: string; state: string; specificity: Specificity } | null {
  let found: { matched: string; base: string; state: string; specificity: Specificity } | null = null;
  for (const part of splitSelectorList(selectorText)) {
    const { base, pseudo } = peelPseudos(part);
    // A bare `::selection` or `:hover` has no base left and applies to anything.
    if (!matches(el, base || '*')) continue;
    if (!found) {
      found = { matched: part, base, state: pseudo, specificity: specificityOf(part) };
      continue;
    }
    if (pseudo !== found.state) continue;
    const specificity = specificityOf(part);
    if (compareSpecificity(specificity, found.specificity) > 0) found.specificity = specificity;
  }
  return found;
}

/** The class name of a bare `.name` selector, or null for anything else. */
function simpleClassName(selector: string): string | null {
  const match = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(selector.trim());
  return match ? match[1] : null;
}

/* -------------------------------------------------------------------------- */
/* Walking the sheets                                                          */
/* -------------------------------------------------------------------------- */

interface LabelledSheet {
  sheet: CSSStyleSheet;
  label: string;
}

/**
 * Every sheet whose rules can reach the element, in cascade order.
 *
 * Shadow roots carry their own `styleSheets` and `adoptedStyleSheets` — the latter is where Lit's
 * `static styles` lands, and neither shows up in `document.styleSheets`. Missing them means missing
 * most of the CSS on a page built from web components.
 */
function collectSheets(el: HTMLElement | null): LabelledSheet[] {
  const out: LabelledSheet[] = [];
  const push = (sheet: CSSStyleSheet, fallback: string): void => {
    out.push({ sheet, label: sheetLabel(sheet, fallback) });
  };

  for (const sheet of Array.from(document.styleSheets)) {
    // The editor's own behavioural CSS is not part of the user's cascade.
    if (sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-internal')) {
      continue;
    }
    push(sheet, 'embedded');
  }

  for (const sheet of document.adoptedStyleSheets ?? []) push(sheet, 'adopted');

  const root = el?.getRootNode();
  if (root instanceof ShadowRoot) {
    for (const sheet of Array.from(root.styleSheets)) push(sheet, 'shadow');
    for (const sheet of root.adoptedStyleSheets ?? []) push(sheet, 'shadow (adopted)');
  }
  return out;
}

function sheetLabel(sheet: CSSStyleSheet, fallback: string): string {
  // A stand-in is a `<style>` with no href of its own, and reporting a rule's source
  // as "embedded" when it came out of `theme.css` would misdirect anyone reading the
  // cascade to find where a declaration lives.
  const href = styleMirrorFor(sheet)?.href ?? sheet.href;
  if (!href) return fallback;
  try {
    return new URL(href).pathname.split('/').pop() || fallback;
  } catch {
    return fallback;
  }
}

/** A rule as the walk finds it, before its declarations are read. */
type WalkedRule = Omit<RuleEntry, 'declarations' | 'target'>;

interface WalkScope {
  conditions: string[];
  medias: string[];
  supports: boolean;
  container: boolean;
  layered: boolean;
}

function supportsCondition(condition: string): boolean {
  try {
    return CSS.supports(condition);
  } catch {
    return true;
  }
}

/**
 * Every style rule reaching `el`, in every media and every state.
 *
 * Every `@media` is walked whatever it evaluates to now: whether it applies is a question asked
 * per width afterwards, which is what lets a preview at 320px show the phone rules on a wide
 * window. Grouping rules are matched by capability (`CSSGroupingRule`), so `@layer`, `@scope` and
 * whatever follows them are walked too; a rule the editor cannot see is one it will happily
 * contradict with an override. A style rule is not descended into: a nested rule is not a rule
 * that stands on its own.
 */
function walkRules(el: HTMLElement): WalkedRule[] {
  const out: WalkedRule[] = [];
  collectSheets(el).forEach(({ sheet, label }, sheetIndex) => {
    const counter = { n: 0 };
    const visit = (container: CSSStyleSheet | CSSGroupingRule, scope: WalkScope): void => {
      let list: CSSRuleList;
      try {
        list = container.cssRules;
      } catch {
        // Cross-origin stylesheet: unreadable by design.
        return;
      }
      for (const rule of Array.from(list)) {
        counter.n += 1;
        if (rule instanceof CSSStyleRule) {
          const reach = reachOf(el, rule.selectorText);
          if (!reach) continue;
          out.push({
            rule,
            selector: rule.selectorText,
            matched: reach.matched,
            family: reach.base || '*',
            state: reach.state,
            media: scope.medias.at(-1) ?? null,
            medias: scope.medias,
            conditions: scope.conditions,
            supports: scope.supports,
            container: scope.container,
            layered: scope.layered,
            specificity: reach.specificity,
            order: sheetIndex * 1e6 + counter.n,
            sheetLabel: label,
          });
          continue;
        }
        if (!(rule instanceof CSSGroupingRule)) continue;
        const prelude = authoredPrelude(rule);
        const next: WalkScope = { ...scope, conditions: [...scope.conditions, prelude] };
        if (rule instanceof CSSMediaRule) {
          next.medias = [...scope.medias, authoredMediaText(rule.media)];
        } else if (rule instanceof CSSSupportsRule) {
          next.supports = scope.supports && supportsCondition(rule.conditionText);
        } else if (/^@container\b/i.test(prelude)) {
          next.container = true;
        } else if (/^@layer\b/i.test(prelude)) {
          next.layered = true;
        }
        visit(rule, next);
      }
    };
    // A `<style media>` or `<link media>` gates every rule in the sheet.
    const own = sheet.media ? authoredMediaText(sheet.media).trim() : '';
    visit(sheet, {
      conditions: [],
      medias: own ? [own] : [],
      supports: true,
      container: false,
      layered: false,
    });
  });
  return out;
}

/** Media at `width`, and every enclosing `@supports` passes. */
function mediaAndSupports(entry: WalkedRule, width: number | null): boolean {
  return entry.supports && entry.medias.every((media) => mediaApplies(media, width));
}

/* -------------------------------------------------------------------------- */
/* Write targets and committed declarations                                    */
/* -------------------------------------------------------------------------- */

function ownerOf(rule: CSSRule): Element | null {
  const node = rule.parentStyleSheet?.ownerNode;
  return node instanceof Element ? node : null;
}

/**
 * The registry key of a rule in the managed rule sheet: its selector, at the media condition of
 * the `@media` block the registry emitted around it.
 */
function managedRuleKey(rule: CSSStyleRule): string {
  const parent = rule.parentRule;
  return designRuleKey(
    rule.selectorText,
    parent instanceof CSSMediaRule ? authoredMediaText(parent.media) : null,
  );
}

/** Where an edit to this rule goes. Only the model knows which sheet a rule lives in. */
export function targetFor(rule: CSSStyleRule): WriteTarget {
  const owner = ownerOf(rule);
  // A constructed or adopted sheet: it belongs to whichever component adopted it.
  if (!owner) return { kind: 'readonly', reason: CONSTRUCTED_SHEET_REASON };
  if (owner.id === CLASS_STYLE_ID) {
    const name = rule.parentRule === null ? simpleClassName(rule.selectorText) : null;
    if (name) return { kind: 'class', name };
  }
  if (owner.id === RULE_STYLE_ID) return { kind: 'design-rule', key: managedRuleKey(rule) };
  if (owner.hasAttribute('data-heo-generated')) {
    return {
      kind: 'readonly',
      reason:
        owner.id === BLOCK_STYLE_ID
          ? 'Block CSS: edit it in the Library.'
          : owner.id === TOKEN_STYLE_ID
            ? 'The editor generates this from Tokens.'
            : 'The editor generates this sheet. Edit it in Tokens.',
    };
  }
  return { kind: 'live', rule };
}

/**
 * What a rule declares as committed, with any in-flight preview taken back out.
 *
 * A preview writes the value being typed straight into the live rule or the registry, so reading
 * the rule back mid-edit describes the exploration rather than the state. A field told its own
 * half-typed text is already committed cannot tell it holds an edit, and the commit that follows
 * compares equal and does nothing. One function, so every surface subtracts the same way.
 */
function committedDeclarations(rule: CSSStyleRule, previews: ModelPreviews): Declaration[] {
  const owner = ownerOf(rule);
  const cls = previews.cls;
  if (cls && owner?.id === CLASS_STYLE_ID && rule.parentRule === null) {
    if (simpleClassName(rule.selectorText) === cls.name) return fromRecord(cls.declarations);
  }
  const design = previews.designRule;
  if (design && owner?.id === RULE_STYLE_ID && managedRuleKey(rule) === design.key) {
    return fromRecord(design.declarations);
  }
  const list = ruleDeclarations(rule);
  const live = previews.rule;
  if (live && live.rule === rule) {
    const { value, important } = splitImportant(live.before);
    return withValue(list, live.property, value, important ?? live.priority === 'important');
  }
  return list;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

interface Rank {
  important: boolean;
  inline: boolean;
  specificity: Specificity;
  order: number;
  index: number;
}

function rankOf(contribution: Contribution): Rank {
  const { source } = contribution;
  return source.kind === 'inline'
    ? { important: contribution.important, inline: true, specificity: [0, 0, 0], order: 0, index: contribution.index }
    : {
      important: contribution.important,
      inline: false,
      specificity: source.entry.specificity,
      order: source.entry.order,
      index: contribution.index,
    };
}

/**
 * Winner first: importance, then inline before any rule (for normal and important alike), then
 * specificity, then document order, then position inside the block. `@layer` reversal is out of
 * scope and flagged on the entry instead.
 */
function compareRanks(a: Rank, b: Rank): number {
  if (a.important !== b.important) return a.important ? -1 : 1;
  if (a.inline !== b.inline) return a.inline ? -1 : 1;
  if (!a.inline) {
    const bySpecificity = compareSpecificity(b.specificity, a.specificity);
    if (bySpecificity) return bySpecificity;
    if (a.order !== b.order) return b.order - a.order;
  }
  return b.index - a.index;
}

const compareContributions = (a: Contribution, b: Contribution): number =>
  compareRanks(rankOf(a), rankOf(b));

const BOX_SIDES: Record<string, readonly string[]> = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ],
};

/** The value a shorthand gives one of its longhands, where that can be read off the text. */
function viaValue(property: string, shorthand: string, value: string): string {
  const sides = BOX_SIDES[shorthand];
  const at = sides?.indexOf(property) ?? -1;
  // An elliptical radius (`8px / 4px`) has no single per-corner reading.
  if (at < 0 || value.includes('/')) return value;
  return splitBoxValue(value)[at];
}

/** What one block contributes to `property`: by name, or through a shorthand of it. */
function contributionsOf(
  list: readonly Declaration[],
  property: string,
  source: Contribution['source'],
): Contribution[] {
  const chain = shorthandChain(property);
  const out: Contribution[] = [];
  list.forEach((declaration, index) => {
    const name = declaration.property.toLowerCase();
    if (name === property) {
      out.push({ property, value: declaration.value, important: declaration.important, index, source });
    } else if (chain.includes(name)) {
      out.push({
        property,
        value: viaValue(property, name, declaration.value),
        important: declaration.important,
        via: declaration.property,
        index,
        source,
      });
    }
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* Inheritance                                                                 */
/* -------------------------------------------------------------------------- */

/** Properties an element takes from its parent when nothing declares them. */
export const INHERITED_PROPERTIES: ReadonlySet<string> = new Set([
  'color', 'font', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
  'font-stretch', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent',
  'text-transform', 'text-shadow', 'white-space', 'word-break', 'overflow-wrap', 'hyphens',
  'direction', 'writing-mode', 'visibility', 'cursor', 'list-style', 'list-style-type',
  'list-style-position', 'list-style-image', 'quotes', 'tab-size', 'border-collapse',
  'border-spacing', 'caption-side', 'empty-cells',
]);

/* -------------------------------------------------------------------------- */
/* The model                                                                   */
/* -------------------------------------------------------------------------- */

/** Build the model of one element. Cheap enough to build once per render (≈1.5 ms per 1000 rules). */
export function buildElementModel(el: HTMLElement, options: ElementModelOptions = {}): ElementModel {
  beginMediaPass();
  const previews = options.previews ?? {};
  const inlinePreview = previews.inline && previews.inline.el === el ? previews.inline : null;
  const inline = fromRecord(authoredInline(el, inlinePreview));
  const entries: RuleEntry[] = walkRules(el).map((walked) => ({
    ...walked,
    declarations: committedDeclarations(walked.rule, previews),
    target: targetFor(walked.rule),
  }));
  const width = effectiveWidth();
  const slots = slotsWith(options.sizes ?? []);
  const lists = new Map<string, CascadeList>();
  const reaches = new Map<string, number>();
  let families: ReturnType<ElementModel['families']> | null = null;

  const applies = (entry: RuleEntry, at: number | null = null): boolean =>
    !entry.container && mediaAndSupports(entry, at);

  const fromEntries = (list: readonly RuleEntry[], property: string): Contribution[] =>
    list.flatMap((entry) =>
      contributionsOf(entry.declarations, property, { kind: 'rule', entry }));

  const cascade = (name: string, ctx: CascadeContext = { width: null }): CascadeList => {
    const property = name.trim().toLowerCase();
    const state = ctx.state ?? '';
    const key = `${property}|${ctx.width ?? ''}|${state}`;
    const known = lists.get(key);
    if (known) return known;

    const base = entries.filter((entry) => entry.state === '');
    const baseApplying = (): Contribution[] => [
      ...contributionsOf(inline, property, { kind: 'inline' }),
      ...fromEntries(base.filter((entry) => applies(entry, ctx.width)), property),
    ];
    let applying: Contribution[];
    let idle: Contribution[];
    if (!state) {
      applying = baseApplying();
      idle = fromEntries(
        entries.filter((entry) =>
          entry.state === ''
            ? !applies(entry, ctx.width)
            : !isPseudoElement(entry.state)),
        property,
      );
    } else {
      const own = entries.filter((entry) => entry.state === state);
      const ownApplying = own.filter((entry) => applies(entry, ctx.width));
      // A state competes with the element's own declarations; a pseudo-element only with its rules.
      applying = [
        ...fromEntries(ownApplying, property),
        ...(isPseudoElement(state) ? [] : baseApplying()),
      ];
      idle = fromEntries(own.filter((entry) => !ownApplying.includes(entry)), property);
    }
    const result = {
      applying: applying.sort(compareContributions),
      idle: idle.sort(compareContributions),
    };
    lists.set(key, result);
    return result;
  };

  const model: ElementModel = {
    element: el,
    width,
    inline,
    entries,
    cascade,
    applies,
    appliedProperties() {
      const names = new Set(inline.map((one) => one.property.toLowerCase()));
      for (const entry of entries) {
        if (entry.state !== '' || !applies(entry)) continue;
        for (const one of entry.declarations) names.add(one.property.toLowerCase());
      }
      return [...names].sort();
    },
    families() {
      if (families) return families;
      const byKey = new Map<string, Family>();
      for (const entry of entries) {
        let family = byKey.get(entry.family);
        if (!family) {
          family = {
            key: entry.family,
            isClass: simpleClassName(entry.family) !== null,
            members: [],
            first: entry.order,
          };
          byKey.set(entry.family, family);
        }
        family.members.push(entry);
      }
      const classes: Family[] = [];
      const unknownClasses: string[] = [];
      for (const name of Array.from(el.classList)) {
        if (name.startsWith('heo-')) continue;
        const family = byKey.get(`.${name}`);
        if (family) classes.push(family);
        else unknownClasses.push(name);
      }
      const others = [...byKey.values()]
        .filter((family) => !classes.includes(family))
        .sort((a, b) => a.first - b.first);
      families = { classes, others, unknownClasses };
      return families;
    },
    slots: () => slots,
    slotOf(entry) {
      if (entry.media === null) return 'base';
      return slotForMedia(entry.media, slots)?.key ?? `other:${entry.media}`;
    },
    breakpoints() {
      const out = new Set<number>();
      for (const entry of entries) {
        for (const media of entry.medias) {
          const at = breakpointOf(media);
          if (at !== null) out.add(at);
        }
      }
      return [...out].sort((a, b) => a - b);
    },
    groups() {
      const seen: string[] = [];
      for (const entry of entries) {
        if (entry.state && !seen.includes(entry.state) && applies(entry)) seen.push(entry.state);
      }
      const known = EDITABLE_STATES.map((one) => one.name).filter((name) => seen.includes(name));
      const rest = seen.filter((name) => !known.includes(name));
      return [...known, ...rest].map((state) => ({
        state,
        kind: isPseudoElement(state) ? ('pseudo-element' as const) : ('state' as const),
      }));
    },
    reach(family) {
      const known = reaches.get(family);
      if (known !== undefined) return known;
      const root = el.getRootNode();
      let count = 0;
      try {
        count = (root instanceof ShadowRoot ? root : document).querySelectorAll(family).length;
      } catch {
        count = 0;
      }
      reaches.set(family, count);
      return count;
    },
    inheritedFrom(name) {
      const property = name.trim().toLowerCase();
      if (!INHERITED_PROPERTIES.has(property)) return null;
      for (let at = el.parentElement; at; at = at.parentElement) {
        const winner = buildElementModel(at, options).cascade(property).applying[0];
        if (winner) return { element: at, contribution: winner };
      }
      return null;
    },
  };
  return model;
}

/* -------------------------------------------------------------------------- */
/* Simulation                                                                  */
/* -------------------------------------------------------------------------- */

/** A declaration that does not exist yet, to ask whether it would win. */
export interface Hypothetical {
  property: string;
  value: string;
  important: boolean;
  as:
    | { kind: 'inline' }
    | { kind: 'replace'; entry: RuleEntry }
    | { kind: 'new-rule'; selector: string; media: string | null; state: string; sheetOrder: number };
}

/**
 * Whether a hypothetical declaration would win, and what beats it when it would not.
 *
 * A pure function over the model, so the save options can each carry a verdict without touching
 * the page. A new rule is ranked by its selector's specificity and the order it would be written at
 * (`managedOrder`).
 */
export function winnerWith(
  model: ElementModel,
  h: Hypothetical,
  ctx: CascadeContext,
): { wins: boolean; by?: Contribution } {
  const property = h.property.trim().toLowerCase();
  const applying = model.cascade(property, ctx).applying;
  let rest = applying;
  let rank: Rank;
  if (h.as.kind === 'inline') {
    rest = applying.filter((one) => one.source.kind !== 'inline');
    rank = { important: h.important, inline: true, specificity: [0, 0, 0], order: 0, index: model.inline.length };
  } else if (h.as.kind === 'replace') {
    const entry = h.as.entry;
    rest = applying.filter((one) => one.source.kind !== 'rule' || one.source.entry !== entry);
    if (!model.applies(entry, ctx.width) || !inContext(entry.state, ctx)) {
      return { wins: false, by: rest[0] };
    }
    const at = entry.declarations.findIndex((one) => one.property.toLowerCase() === property);
    rank = {
      important: h.important,
      inline: false,
      specificity: entry.specificity,
      order: entry.order,
      index: at >= 0 ? at : entry.declarations.length,
    };
  } else {
    const { selector, media, state, sheetOrder } = h.as;
    if (!mediaApplies(media, ctx.width) || !inContext(state, ctx)) return { wins: false, by: rest[0] };
    rank = { important: h.important, inline: false, specificity: specificityOf(selector), order: sheetOrder, index: 0 };
  }
  const by = rest.find((one) => compareRanks(rankOf(one), rank) < 0);
  return by ? { wins: false, by } : { wins: true };
}

/** A rule in `state` takes part in a cascade read in `ctx`. */
function inContext(state: string, ctx: CascadeContext): boolean {
  const asked = ctx.state ?? '';
  if (state === asked) return true;
  // The element's own rules compete in a state's cascade, never in a pseudo-element's.
  return state === '' && asked !== '' && !isPseudoElement(asked);
}

/** Depth-first rule count, the same way the walk numbers rules. */
function countRules(container: CSSStyleSheet | CSSGroupingRule): number {
  let list: CSSRuleList;
  try {
    list = container.cssRules;
  } catch {
    return 0;
  }
  let count = 0;
  for (const rule of Array.from(list)) {
    count += 1;
    if (rule instanceof CSSGroupingRule && !(rule instanceof CSSStyleRule)) count += countRules(rule);
  }
  return count;
}

/**
 * The `order` a rule appended to the managed `<style id>` would get, without writing anything.
 *
 * When the sheet exists, after its last rule. When it does not (the registry is empty, so the
 * element was removed), where `ManagedStyleSheet.write` would put it: appended to `<head>`, so after
 * every head sheet and before every body or adopted one.
 */
export function managedOrder(id: string): number {
  const sheets = collectSheets(null).map((one) => one.sheet);
  const at = sheets.findIndex((sheet) => sheet.ownerNode instanceof Element && sheet.ownerNode.id === id);
  if (at >= 0) return at * 1e6 + countRules(sheets[at]) + 1;
  let lastHead = -1;
  sheets.forEach((sheet, index) => {
    if (sheet.ownerNode && document.head?.contains(sheet.ownerNode)) lastHead = index;
  });
  return (lastHead + 0.5) * 1e6;
}

/* -------------------------------------------------------------------------- */
/* A class and everything written for it                                       */
/* -------------------------------------------------------------------------- */

/**
 * A class's declarations everywhere they are written: the unconditional base, and one member per
 * state or media rule.
 *
 * What detaching a class has to carry. A selector list is split per part, so
 * `.card:hover, .card:focus { … }` is two members and the copy writes two rules; a part that is not
 * the class plus a state (`.other`) is left out of the copy, and the rule itself is untouched.
 */
export function classFamily(name: string): {
  base: Declaration[];
  members: Array<{ rule: CSSStyleRule; state: string; media: string | null; declarations: Declaration[] }>;
} {
  let base: Declaration[] = [];
  const members: Array<{
    rule: CSSStyleRule;
    state: string;
    media: string | null;
    declarations: Declaration[];
  }> = [];
  const visit = (container: CSSStyleSheet | CSSGroupingRule, media: string | null): void => {
    let list: CSSRuleList;
    try {
      list = container.cssRules;
    } catch {
      return;
    }
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        const states = new Set<string>();
        for (const part of splitSelectorList(rule.selectorText)) {
          const { base: peeled, pseudo } = peelPseudos(part);
          if (simpleClassName(peeled) === name) states.add(pseudo);
        }
        if (!states.size) continue;
        const declarations = ruleDeclarations(rule);
        for (const state of states) {
          if (!state && media === null) {
            for (const one of declarations) {
              base = withValue(base, one.property, one.value, one.important);
            }
          } else {
            members.push({ rule, state, media, declarations });
          }
        }
        continue;
      }
      if (rule instanceof CSSGroupingRule) {
        visit(rule, rule instanceof CSSMediaRule ? authoredMediaText(rule.media) : media);
      }
    }
  };
  for (const { sheet } of collectSheets(null)) {
    const own = sheet.media ? authoredMediaText(sheet.media).trim() : '';
    visit(sheet, own || null);
  }
  return { base, members };
}

/* -------------------------------------------------------------------------- */
/* Legacy readers                                                              */
/* -------------------------------------------------------------------------- */

export interface AppliedDeclaration {
  property: string;
  value: string;
  important: boolean;
}

export interface AppliedRule {
  /** `inline` for the style attribute, otherwise the selector text. */
  selector: string;
  origin: 'inline' | 'stylesheet';
  /** File name or `embedded` / `adopted`. */
  source: string;
  /** `specificityNumber` of the tuple; the style attribute outranks every selector. */
  specificity: number;
  declarations: AppliedDeclaration[];
  /** The live rule, so the tokens panel can write back into it. */
  rule?: CSSStyleRule;
  /** The innermost at-rule prelude this rule sits inside, authored, when any. */
  condition?: string;
  /**
   * The part of a selector list that actually matched.
   *
   * `h1, .card p` tells the user very little about why it applies here; the one
   * compound that matched tells them everything.
   */
  matchedSelector?: string;
  /**
   * The state or pseudo-element this rule targets, e.g. `:hover`, `::before`.
   *
   * Only set for rules found by `stateRules`. Empty means the rule applies to the
   * element as it is right now, which is the only kind the cascade may consider.
   */
  pseudo?: string;
}

/**
 * Rules applying now, least to most winning: specificity, then document order.
 *
 * There used to be a `+1` for any rule inside a condition, on the theory that a media rule should
 * win a tie. It should not, and it does not on the page: a later plain rule of equal specificity
 * beats an earlier media rule (measured). Order decides, so order is what sorts.
 *
 * `@container` rules are kept here, as they always were: these readers cannot ask the container,
 * and dropping them would hide values the page may well be using.
 */
function legacyRules(el: HTMLElement, wantState: boolean): AppliedRule[] {
  return walkRules(el)
    .filter((entry) => Boolean(entry.state) === wantState && mediaAndSupports(entry, null))
    .sort((a, b) => compareSpecificity(a.specificity, b.specificity) || a.order - b.order)
    .map((entry) => ({
      selector: entry.selector,
      origin: 'stylesheet' as const,
      source: entry.sheetLabel,
      specificity: specificityNumber(entry.specificity),
      declarations: readDeclarations(entry.rule.style),
      rule: entry.rule,
      condition: entry.conditions.at(-1),
      matchedSelector: entry.matched,
      pseudo: entry.state || undefined,
    }));
}

/**
 * Every rule that applies to the element now, most winning last, with the style attribute after
 * them all.
 *
 * "Now" is the width the page renders at, which is the preview width while previewing: the AI
 * context, the engine's pinning and the tokens all see the rules the page is using.
 */
export function appliedRules(el: HTMLElement): AppliedRule[] {
  const rules = legacyRules(el, false);
  if (el.style.length > 0) {
    rules.push({
      selector: 'style attribute',
      origin: 'inline',
      source: 'inline',
      specificity: Number.MAX_SAFE_INTEGER,
      /*
       * From the attribute, so this agrees with `inlineDeclarations`.
       *
       * Reading the CSSOM here and the attribute there meant one declaration written with a
       * legacy name appeared twice in the panel, once under the name the author used and once
       * under the name the browser prefers -- as though the element declared both.
       */
      declarations: toAppliedDeclarations(inlineDeclarations(el)),
    });
  }
  return rules;
}

/**
 * Rules that target this element in a state it is not currently in, or through a
 * pseudo-element.
 *
 * Deliberately separate from `appliedRules`: these do not apply right now, so
 * letting them into the cascade would report a hover colour as the element's
 * current value. The panel shows them as their own, editable, group.
 */
export function stateRules(el: HTMLElement): AppliedRule[] {
  return legacyRules(el, true);
}

/**
 * A rule's declarations, as they were authored.
 *
 * Parsed from `cssText` rather than read by index, because indexing expands every
 * shorthand and drops any it cannot: `overflow: hidden` enumerates as `overflow-x`
 * and `overflow-y` with no `overflow` at all, so a panel row for `overflow` found
 * nothing and showed the property as unset. `width: min(980px, calc(...))` fares
 * worse still — a var-bearing value is stored as a pending substitution that does
 * not enumerate.
 *
 * Longhands are still available where they matter: the style panel expands box
 * shorthands itself for the per-side editor.
 */
function readDeclarations(style: CSSStyleDeclaration): AppliedDeclaration[] {
  return toAppliedDeclarations(parseDeclarations(style.cssText));
}

/** The same shape, from declarations already parsed out of authored text. */
function toAppliedDeclarations(declarations: Record<string, string>): AppliedDeclaration[] {
  return fromRecord(declarations);
}

/**
 * The declarations that actually win, property by property, after the cascade.
 * Later rules in `appliedRules` order override earlier ones; a normal declaration never replaces
 * an important one.
 */
export function cascadedDeclarations(rules: AppliedRule[]): Map<string, AppliedDeclaration & { from: AppliedRule }> {
  const winner = new Map<string, AppliedDeclaration & { from: AppliedRule }>();
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      const current = winner.get(declaration.property);
      if (current?.important && !declaration.important) continue;
      winner.set(declaration.property, { ...declaration, from: rule });
    }
  }
  return winner;
}

/* -------------------------------------------------------------------------- */
/* What an element sets, and where each value came from                        */
/* -------------------------------------------------------------------------- */

/** Where a declaration came from, so a reader can say so. */
export interface DeclarationOrigin {
  kind: 'inline' | 'rule';
  /** Selector of the winning rule; `style attribute` when inline. */
  selector: string;
}

/**
 * The element's inline declarations, as authored.
 *
 * Read from the `style` *attribute* rather than from `style.cssText`. The two are usually the
 * same string, and where they differ the attribute is the honest one: `cssText` is serialised
 * back out of the CSSOM, which canonicalises a family of legacy property names on the way in --
 * `word-wrap` to `overflow-wrap`, `grid-gap` to `gap`, `-webkit-transform` to `transform`,
 * `font-stretch` to `font-width` in recent builds. Reading the attribute is what lets a panel
 * show, and an extracted class carry, the name the author actually wrote.
 *
 * Parsed as text rather than indexed either way, because indexing into `style` misses shorthands
 * whose value contains `var()`: the browser stores those as a pending-substitution value that
 * does not enumerate as its longhands, so `padding: var(--space-lg)` is invisible to an index
 * walk.
 */
export function inlineDeclarations(el: HTMLElement): Record<string, string> {
  return parseDeclarations(el.getAttribute('style') ?? '');
}

/**
 * The element's inline declarations, as authored rather than as painted.
 *
 * A preview writes the value being typed straight onto the style attribute, so
 * reading the attribute back mid-edit describes the exploration instead of what the
 * user has: a half-deleted value, or — once the field is empty — no declaration at
 * all, which is what used to make the row vanish out from under the caret. The
 * property the preview owns is put back to the value it had when the edit started,
 * or dropped if the edit started from nothing.
 */
export function authoredInline(
  el: HTMLElement,
  preview: InlinePreview | null,
): Record<string, string> {
  const inline = inlineDeclarations(el);
  if (!preview) return inline;
  if (preview.before) {
    // `before` is the authored text, so any `!important` is already in it.
    inline[preview.property] = preview.before;
  } else {
    delete inline[preview.property];
  }
  return inline;
}

/**
 * Every property this element sets, and which selector set it.
 *
 * The cascade's winners, with inline values over them where inline wins. Longhands are expanded
 * from box shorthands so a per-side editor can show a value that was written as
 * `padding: 8px 12px` — into `values` only. `origins` keys are the declarations that
 * genuinely exist, which is what makes `origins.has(property)` a usable filter.
 *
 * This is the definition of "set" that the Styles panel draws its blue dot from, and it
 * lives here rather than in the panel because it is now also the definition the AI
 * context bundle reports to a model. Two copies of this predicate would drift, and the
 * drift would be invisible in the worst way: the panel would show a dot for a
 * declaration the model was never told about, and the model would be blamed for
 * ignoring it.
 */
export function declaredMap(
  cascade: Map<string, { property: string; value: string; important: boolean; from: AppliedRule }>,
  inline: Record<string, string>,
): { values: Map<string, string>; origins: Map<string, DeclarationOrigin> } {
  const out = new Map<string, string>();
  const origins = new Map<string, DeclarationOrigin>();

  for (const [property, entry] of cascade) {
    out.set(property, entry.value);
    origins.set(property, {
      kind: entry.from.origin === 'inline' ? 'inline' : 'rule',
      selector: entry.from.selector,
    });
  }
  /*
   * Inline values over the cascade, but only where inline actually wins.
   *
   * Parsed from the attribute so a shorthand holding a var() — which does not enumerate as its
   * longhands, and so has no cascade winner — is still shown as set on this element. That is
   * what this loop exists for. It used to overwrite unconditionally, which also replaced an
   * `!important` rule's value with the plain inline one it beats: `.promo .card { color: … !important }`
   * rendered indigo while the panel and the AI context both said red (F1).
   */
  for (const [property, value] of Object.entries(inline)) {
    const winner = cascade.get(property);
    const important = splitImportant(value).important === true;
    if (winner && winner.from.origin !== 'inline' && winner.important && !important) continue;
    out.set(property, value);
    origins.set(property, { kind: 'inline', selector: 'style attribute' });
  }

  /*
   * Box shorthands are expanded into `values`, and deliberately NOT into `origins`.
   *
   * `origins` is the answer to "which declaration is this, and where does editing it go" —
   * so it holds only names something actually declares. A side split out of `padding: 8px`
   * is a reading of that one declaration, not a fifth declaration, and giving it the
   * shorthand's origin made it indistinguishable from a real `padding-bottom`. Every caller
   * that lists declarations tests `origins.has(property)` to weed these out; while the
   * origin was copied across, that test was a no-op and the four phantom sides were listed
   * as though the element set them.
   *
   * In the Styles panel that was actively destructive rather than merely noisy. A phantom
   * row has nothing in the style attribute, so a preview of it starts from an empty `before`
   * — and the render that subtracts the preview from the cascade dropped the row on the
   * first pointermove, out from under the gesture holding it. Committing then created the
   * declaration for real, which changed where the row sorted, so the value landed on a row
   * that had moved. Dragging `padding-bottom` on an inserted `<th>` deleted its own row.
   *
   * Consumers that want the per-side value still read it from `values`, which is what the
   * box editor does.
   */
  for (const group of ['margin', 'padding', 'border-radius'] as const) {
    const shorthand = out.get(group);
    if (!shorthand) continue;
    const sides = splitBoxValue(shorthand);
    BOX_SIDES[group].forEach((name, index) => {
      if (out.has(name)) return;
      out.set(name, sides[index]);
    });
  }
  return { values: out, origins };
}

/**
 * True when a declaration arrived from one of the element's own classes.
 *
 * Only a bare single-class selector counts, because that is exactly the shape the
 * Classes section can show and edit — and the shape the AI broker will accept for a
 * class upsert. A compound or descendant selector like `.card .title` is not a class
 * you can take off an element, so its declarations belong to the rule instead.
 */
export function fromElementClass(selector: string, el: HTMLElement): boolean {
  return selector.split(',').some((part) => {
    const match = /^\s*\.([A-Za-z_][\w-]*)\s*$/.exec(part);
    return match ? el.classList.contains(match[1]) : false;
  });
}

/**
 * What an element declares, as opposed to what it computes to.
 *
 * The distinction is the whole point when explaining why a size is not applying:
 * every laid-out element has a computed `width` in pixels, so only the declared
 * value tells you whether an author actually asked for one.
 */
export function declaredValues(el: HTMLElement): Map<string, { value: string; from: string }> {
  const out = new Map<string, { value: string; from: string }>();
  for (const [property, entry] of cascadedDeclarations(appliedRules(el))) {
    out.set(property, { value: entry.value, from: entry.from.selector });
  }
  return out;
}
