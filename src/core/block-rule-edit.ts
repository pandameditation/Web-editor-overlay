import { scopeBlockCSS, splitTopLevel } from './block-css.js';

/**
 * Editing a block's CSS from the rule the page shows.
 *
 * A block's CSS is written once, scoped, into the managed block sheet: `.title { … }` becomes
 * `.title:is(:is([data-heo-block="card"], …), …) *):not(#heo-block-scope)… { … }`. The Styles panel
 * finds that scoped rule on the element, and until now could only say "edit it in the Library",
 * which is wrong twice: a pasted block that was never saved is not in the library at all, and
 * the rule is right there.
 *
 * So the edit goes to the block's source CSS, the text the scoped rule was made from. The scoped
 * rule is matched back to its source rule by position: the block's CSS is scoped again and parsed,
 * the rule with the same selector and the same enclosing at-rules is found (the n-th, when a block
 * repeats a rule), and its place in that parse is its place in the source, after the bare
 * declarations' rule and the dropped `@import`s are accounted for. Then the source rule is edited
 * through the CSSOM and the text written back, and the library re-scopes it.
 */

export interface BlockRuleLocator {
  blockId: string;
  /** The scoped rule's `selectorText`. */
  selector: string;
  /** Enclosing at-rule preludes, outermost first. */
  conditions: string[];
  /** Which of the block's rules with this selector and these conditions, from 0. */
  occurrence: number;
}

const BLOCK_ID = /\[data-heo-block(?:-part)?="((?:\\.|[^"\\])*)"\]/;

/** The block a scoped rule belongs to, read off its selector; null for any other rule. */
export function blockIdOf(selector: string): string | null {
  const match = BLOCK_ID.exec(selector);
  return match ? match[1].replace(/\\(.)/g, '$1') : null;
}

/**
 * An at-rule's prelude, read from its condition rather than its text.
 *
 * `cssText` of a grouping rule serialises every rule inside it, so reading a `@media` block's
 * prelude that way cost the whole block each time; on a large capture in Firefox it was most of
 * the Styles panel's render. Both sides of a comparison go through this, so they agree.
 */
function preludeOf(rule: CSSRule): string {
  if (rule instanceof CSSMediaRule) return `@media ${rule.media.mediaText}`;
  if (rule instanceof CSSSupportsRule) return `@supports ${rule.conditionText}`;
  if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
    return `@container ${rule.containerName} ${rule.containerQuery}`.replace(/\s+/g, ' ');
  }
  if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) return `@layer ${rule.name}`;
  if (rule instanceof CSSConditionRule) return `@${rule.constructor.name} ${rule.conditionText}`;
  const text = rule.cssText;
  const open = text.indexOf('{');
  return (open < 0 ? text : text.slice(0, open)).trim();
}

interface StyleRuleAt {
  rule: CSSStyleRule;
  path: number[];
  conditions: string[];
}

/** Every style rule under a rule list, with its index path and conditions. */
function styleRules(list: CSSRuleList, path: number[] = [], conditions: string[] = []): StyleRuleAt[] {
  const out: StyleRuleAt[] = [];
  Array.from(list).forEach((rule, index) => {
    if (rule instanceof CSSStyleRule) {
      out.push({ rule, path: [...path, index], conditions });
      return;
    }
    const children = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
    if (children) out.push(...styleRules(children, [...path, index], [...conditions, preludeOf(rule)]));
  });
  return out;
}

/** The key two rules share when they are the same rule of the same block at the same place. */
const keyOf = (selector: string, conditions: readonly string[], occurrence: number): string =>
  `${occurrence}\u0000${conditions.join('\u0001')}\u0000${selector}`;

/** Locators for every block rule of a sheet, by rule object; see `locateBlockRule`. */
const sheetIndex = new WeakMap<CSSStyleSheet, Map<CSSStyleRule, BlockRuleLocator>>();

function indexSheet(sheet: CSSStyleSheet): Map<CSSStyleRule, BlockRuleLocator> {
  const index = new Map<CSSStyleRule, BlockRuleLocator>();
  const seen = new Map<string, number>();
  for (const entry of styleRules(sheet.cssRules)) {
    const selector = entry.rule.selectorText;
    const blockId = blockIdOf(selector);
    if (!blockId) continue;
    const counted = `${blockId}\u0000${keyOf(selector, entry.conditions, 0)}`;
    const occurrence = seen.get(counted) ?? 0;
    seen.set(counted, occurrence + 1);
    index.set(entry.rule, { blockId, selector, conditions: entry.conditions, occurrence });
  }
  sheetIndex.set(sheet, index);
  return index;
}

/**
 * Where a scoped rule in the managed block sheet sits among its block's rules; null for others.
 *
 * From an index of the whole sheet, built once and rebuilt when a rule it has not seen is asked
 * about: writing the sheet replaces its rule objects, so a miss is what a new version looks like.
 * Walking the sheet per rule, as this first did, made reading one element's rules cost
 * (rules that match) x (rules in the sheet).
 */
export function locateBlockRule(rule: CSSStyleRule): BlockRuleLocator | null {
  const sheet = rule.parentStyleSheet;
  if (!sheet) return null;
  const known = sheetIndex.get(sheet)?.get(rule);
  if (known) return known;
  if (!blockIdOf(rule.selectorText)) return null;
  return indexSheet(sheet).get(rule) ?? null;
}

function parse(text: string): CSSStyleSheet | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return sheet;
  } catch {
    return null;
  }
}

/** Where each scoped rule of one version of a block's CSS comes from in its source. */
interface SourceMap {
  /** Locator key to source path; `null` is the bare declarations. */
  paths: Map<string, number[] | null>;
}

/**
 * The last few source versions' maps. Building one scopes and parses the whole block, which is
 * the expensive part of an edit; a live preview edits the same version keystroke after keystroke,
 * and a commit makes a new version that is mapped once.
 */
const sourceMaps = new Map<string, SourceMap>();
const SOURCE_MAP_LIMIT = 4;

function sourceMapFor(source: string, blockId: string, captured: boolean): SourceMap | null {
  const cacheKey = `${blockId}\u0000${captured ? 1 : 0}\u0000${source}`;
  const cached = sourceMaps.get(cacheKey);
  if (cached) {
    // Most recent last, so the oldest is the one dropped.
    sourceMaps.delete(cacheKey);
    sourceMaps.set(cacheKey, cached);
    return cached;
  }
  const scoped = parse(scopeBlockCSS(source, blockId, { captured }));
  if (!scoped) return null;
  const split = splitTopLevel(source);
  const bareRule = parse(`heo-bare { ${split.declarations} }`)?.cssRules[0];
  const hasBare = bareRule instanceof CSSStyleRule && bareRule.style.length > 0;
  const rules = parse(split.rules);
  if (!rules) return null;
  // The scoped list is the bare rule (when any) and then the source rules, minus the ones dropped.
  const kept = Array.from(rules.cssRules)
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !(rule instanceof CSSImportRule) &&
      !(typeof CSSNamespaceRule !== 'undefined' && rule instanceof CSSNamespaceRule));
  const paths = new Map<string, number[] | null>();
  const seen = new Map<string, number>();
  for (const entry of styleRules(scoped.cssRules)) {
    const counted = keyOf(entry.rule.selectorText, entry.conditions, 0);
    const occurrence = seen.get(counted) ?? 0;
    seen.set(counted, occurrence + 1);
    const key = keyOf(entry.rule.selectorText, entry.conditions, occurrence);
    if (hasBare && entry.path.length === 1 && entry.path[0] === 0) {
      paths.set(key, null);
      continue;
    }
    const top = kept[entry.path[0] - (hasBare ? 1 : 0)];
    if (top) paths.set(key, [top.index, ...entry.path.slice(1)]);
  }
  const map = { paths };
  sourceMaps.set(cacheKey, map);
  while (sourceMaps.size > SOURCE_MAP_LIMIT) sourceMaps.delete(sourceMaps.keys().next().value as string);
  return map;
}

/**
 * The block's source CSS with one rule's declarations changed by `mutate`, or null when the rule
 * cannot be found in it (the source changed since, or the chunk was scoped elsewhere).
 *
 * Only the source is parsed per call (it is a fraction of the scoped text); where the rule sits in
 * it comes from the cached map of this version.
 */
export function editBlockCSS(
  source: string,
  locator: BlockRuleLocator,
  captured: boolean,
  mutate: (style: CSSStyleDeclaration) => void,
): string | null {
  const map = sourceMapFor(source, locator.blockId, captured);
  if (!map) return null;
  const key = keyOf(locator.selector, locator.conditions, locator.occurrence);
  if (!map.paths.has(key)) return null;
  const path = map.paths.get(key) ?? null;

  const split = splitTopLevel(source);
  const bareRule = parse(`heo-bare { ${split.declarations} }`)?.cssRules[0];
  const bareStyle = bareRule instanceof CSSStyleRule ? bareRule.style : null;
  const rules = parse(split.rules);
  if (!rules) return null;
  if (path === null) {
    if (!bareStyle) return null;
    mutate(bareStyle);
    return join(bareStyle.cssText, rules);
  }
  let target: CSSRule | undefined = rules.cssRules[path[0]];
  for (const index of path.slice(1)) {
    target = (target as CSSRule & { cssRules?: CSSRuleList })?.cssRules?.[index];
  }
  if (!(target instanceof CSSStyleRule)) return null;
  mutate(target.style);
  return join(bareStyle && bareStyle.length ? bareStyle.cssText : '', rules);
}

function join(bare: string, rules: CSSStyleSheet): string {
  const body = Array.from(rules.cssRules).map((rule) => rule.cssText).join('\n');
  return [bare.trim(), body].filter(Boolean).join('\n');
}

/**
 * A scoped block selector as its author wrote it: `.title`, or `:scope` for the block root.
 *
 * What the Styles panel names the rule by. The scoped form carries the block id six times over
 * and says nothing a reader can use.
 */
export function leanBlockSelector(selector: string): string {
  const known = leanNames.get(selector);
  if (known !== undefined) return known;
  const blockId = blockIdOf(selector);
  if (!blockId) return selector;
  const lean = leanOf(selector, blockId);
  // Rows ask for the same names on every render; a bounded memo keeps that a lookup.
  if (leanNames.size > 2000) leanNames.clear();
  leanNames.set(selector, lean);
  return lean;
}

const leanNames = new Map<string, string>();

function leanOf(selector: string, blockId: string): string {
  const { term, bare } = probesFor(blockId);
  return splitList(selector)
    .map((part) => {
      const text = part.trim();
      if (bare && text === bare) return ':scope';
      if (term && text.includes(term)) return text.replace(term, '').trim() || ':scope';
      return text;
    })
    .join(', ');
}

const probes = new Map<string, { term: string; bare: string }>();

/** The scope term and the bare-rule selector for a block, as the CSSOM writes them back. */
function probesFor(blockId: string): { term: string; bare: string } {
  const known = probes.get(blockId);
  if (known) return known;
  // Built the way scopeBlockCSS builds them, then read back, so they compare like the sheet's text.
  const style = parse(scopeBlockCSS('heo-lean-probe { color: red }', blockId))?.cssRules[0];
  const bareRule = parse(scopeBlockCSS('color: red', blockId))?.cssRules[0];
  const out = {
    term: style instanceof CSSStyleRule ? style.selectorText.replace(/^heo-lean-probe/, '') : '',
    bare: bareRule instanceof CSSStyleRule ? bareRule.selectorText : '',
  };
  probes.set(blockId, out);
  return out;
}

/** A selector list split on its top-level commas. */
function splitList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const ch = selector[index];
    if (quote) {
      if (ch === '\\') index += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(selector.slice(start, index));
      start = index + 1;
    }
  }
  out.push(selector.slice(start));
  return out;
}
