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

function preludeOf(rule: CSSRule): string {
  const text = rule.cssText;
  const open = text.indexOf('{');
  return (open < 0 ? text : text.slice(0, open)).trim();
}

function conditionsOf(rule: CSSRule): string[] {
  const out: string[] = [];
  for (let parent = rule.parentRule; parent; parent = parent.parentRule) out.unshift(preludeOf(parent));
  return out;
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Every style rule under a rule list, with its index path and conditions. */
function styleRules(list: CSSRuleList, path: number[] = [], conditions: string[] = []): Array<{
  rule: CSSStyleRule;
  path: number[];
  conditions: string[];
}> {
  const out: Array<{ rule: CSSStyleRule; path: number[]; conditions: string[] }> = [];
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

/** Where a scoped rule in the managed block sheet sits among its block's rules; null for others. */
export function locateBlockRule(rule: CSSStyleRule): BlockRuleLocator | null {
  const blockId = blockIdOf(rule.selectorText);
  const sheet = rule.parentStyleSheet;
  if (!blockId || !sheet) return null;
  const conditions = conditionsOf(rule);
  let occurrence = 0;
  for (const entry of styleRules(sheet.cssRules)) {
    if (entry.rule === rule) return { blockId, selector: rule.selectorText, conditions, occurrence };
    if (entry.rule.selectorText === rule.selectorText && same(entry.conditions, conditions) &&
      blockIdOf(entry.rule.selectorText) === blockId) {
      occurrence += 1;
    }
  }
  return null;
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

/**
 * The block's source CSS with one rule's declarations changed by `mutate`, or null when the rule
 * cannot be found in it (the source changed since, or the chunk was scoped elsewhere).
 */
export function editBlockCSS(
  source: string,
  locator: BlockRuleLocator,
  captured: boolean,
  mutate: (style: CSSStyleDeclaration) => void,
): string | null {
  const scoped = parse(scopeBlockCSS(source, locator.blockId, { captured }));
  if (!scoped) return null;
  const matches = styleRules(scoped.cssRules)
    .filter((entry) => entry.rule.selectorText === locator.selector && same(entry.conditions, locator.conditions));
  const found = matches[locator.occurrence];
  if (!found) return null;

  const split = splitTopLevel(source);
  const bare = parse(`heo-bare { ${split.declarations} }`);
  const bareRule = bare?.cssRules[0];
  const hasBare = bareRule instanceof CSSStyleRule && bareRule.style.length > 0;
  const rules = parse(split.rules);
  if (!rules) return null;

  if (hasBare && found.path.length === 1 && found.path[0] === 0) {
    mutate((bareRule as CSSStyleRule).style);
    return join((bareRule as CSSStyleRule).style.cssText, rules);
  }
  // The scoped list is the bare rule (when any) and then the source rules, minus the ones dropped.
  const kept = Array.from(rules.cssRules)
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !(rule instanceof CSSImportRule) &&
      !(typeof CSSNamespaceRule !== 'undefined' && rule instanceof CSSNamespaceRule));
  const top = kept[found.path[0] - (hasBare ? 1 : 0)];
  if (!top) return null;
  let target: CSSRule | undefined = top.rule;
  for (const index of found.path.slice(1)) {
    target = (target as CSSRule & { cssRules?: CSSRuleList })?.cssRules?.[index];
  }
  if (!(target instanceof CSSStyleRule)) return null;
  mutate(target.style);
  return join(hasBare ? (bareRule as CSSStyleRule).style.cssText : '', rules);
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
  const blockId = blockIdOf(selector);
  if (!blockId) return selector;
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
