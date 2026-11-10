import { absolutizeCssUrls } from '../core/css-urls.js';
import {
  animationNamesIn,
  customPropertiesIn,
  filterRuleTree,
  fontFamiliesIn,
  fontFamiliesInDeclarations,
  pickDependencies,
  preferFontSource,
  serializeRuleTree,
  stripUserActionPseudos,
  styleNodesIn,
  unquote,
  type RuleNode,
} from './css-text.js';
import type { CaptureHost } from './host.js';

/**
 * The browser half of rule collection: which rules in the page could style the picked element.
 *
 * The answer is "any rule whose selector, with hover/focus and pseudo-elements taken out,
 * matches the element or something inside it" — wherever the rule lives: document sheets,
 * adopted sheets, and the sheets of every open shadow root in the subtree. Cross-origin sheets
 * cannot be read through the CSSOM, so they are fetched through the host and parsed here.
 */

/** The element and everything under it, into open shadow roots. */
export function* elementsIn(root: Element): Generator<Element> {
  yield root;
  for (const child of Array.from(root.children)) yield* elementsIn(child);
  if (root.shadowRoot) for (const child of Array.from(root.shadowRoot.children)) yield* elementsIn(child);
}

export function openShadowRoots(root: Element): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  for (const element of elementsIn(root)) if (element.shadowRoot) out.push(element.shadowRoot);
  return out;
}

function sheetsFor(root: Element): CSSStyleSheet[] {
  const doc = root.ownerDocument;
  const scopes: Array<Document | ShadowRoot> = [doc];
  const own = root.getRootNode();
  if (own instanceof ShadowRoot) scopes.push(own);
  scopes.push(...openShadowRoots(root));
  const out: CSSStyleSheet[] = [];
  for (const scope of scopes) {
    out.push(...Array.from(scope.styleSheets), ...(scope.adoptedStyleSheets ?? []));
  }
  return out.filter((sheet) => !sheet.disabled);
}

/** A sheet as a rule tree. A sheet whose rules cannot be read is added to `unreadable`. */
export function readSheetTree(sheet: CSSStyleSheet, base: string, unreadable: string[]): RuleNode[] {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    if (sheet.href) unreadable.push(sheet.href);
    return [];
  }
  const nodes = readRules(rules, sheet.href ?? base, unreadable);
  // A `<link media="print">` is a sheet-level condition; keep it as one.
  const media = sheet.media?.mediaText ?? '';
  return media && media !== 'all' ? [{ kind: 'group', prelude: `@media ${media}`, children: nodes }] : nodes;
}

function readRules(rules: CSSRuleList, base: string, unreadable: string[]): RuleNode[] {
  const out: RuleNode[] = [];
  const absolute = (text: string): string => absolutizeCssUrls(text, base);
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSImportRule) {
      if (rule.styleSheet) out.push(...readSheetTree(rule.styleSheet, rule.styleSheet.href ?? base, unreadable));
      continue;
    }
    if (rule instanceof CSSStyleRule) {
      out.push({ kind: 'style', selector: rule.selectorText, declarations: absolute(rule.style.cssText) });
      continue;
    }
    if (rule instanceof CSSKeyframesRule) {
      out.push({ kind: 'keyframes', name: rule.name, text: absolute(rule.cssText) });
      continue;
    }
    if (rule instanceof CSSFontFaceRule) {
      out.push({
        kind: 'font-face',
        family: unquote(rule.style.getPropertyValue('font-family')),
        text: preferFontSource(absolute(rule.cssText)),
      });
      continue;
    }
    const children = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
    if (children) {
      const text = rule.cssText;
      out.push({ kind: 'group', prelude: text.slice(0, text.indexOf('{')).trim(), children: readRules(children, base, unreadable) });
      continue;
    }
    out.push({ kind: 'other', text: absolute(rule.cssText) });
  }
  return out;
}

const IMPORT = /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?[^;]*;/gi;

/**
 * A stylesheet fetched as text, as a rule tree, its `@import`s followed up to three deep.
 *
 * `replaceSync` refuses `@import`, so they are taken out first and fetched in their own right,
 * ahead of the sheet's own rules, which is where the cascade puts them.
 */
export async function parseFetchedSheet(
  text: string,
  base: string,
  host: CaptureHost,
  depth = 0,
): Promise<RuleNode[]> {
  const imports: string[] = [];
  const body = text.replace(IMPORT, (_whole, _quote, href: string) => {
    try {
      imports.push(new URL(href, base).href);
    } catch {
      /* an unparseable URL imports nothing */
    }
    return '';
  });
  const out: RuleNode[] = [];
  if (depth < 3) {
    for (const href of imports) {
      const fetched = await host.fetchText(href);
      if (fetched && 'text' in fetched) out.push(...(await parseFetchedSheet(fetched.text, href, host, depth + 1)));
    }
  }
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(body);
  } catch {
    return out;
  }
  out.push(...readRules(sheet.cssRules, base, []));
  return out;
}

/** True when the selector, user-action pseudos removed, matches the root or anything in it. */
export function matcherFor(root: Element): (selector: string) => boolean {
  const shadows = openShadowRoots(root);
  return (selector) => {
    const stripped = stripUserActionPseudos(selector);
    try {
      return root.matches(stripped) || root.querySelector(stripped) !== null ||
        shadows.some((shadow) => shadow.querySelector(stripped) !== null);
    } catch {
      return false;
    }
  };
}

export interface CollectedRules {
  /** Style rules that apply, inside their groups. */
  kept: RuleNode[];
  /** The keyframes and font faces they use. */
  dependencies: RuleNode[];
  /** `--x: value` for every custom property used, resolved at the root. */
  variables: string[];
  /** Cross-origin sheets that could not be fetched either. */
  unreadable: string[];
  needsHostPermission: boolean;
}

export async function collectRules(root: Element, host: CaptureHost): Promise<CollectedRules> {
  const doc = root.ownerDocument;
  const unreadable: string[] = [];
  const all: RuleNode[] = [];
  for (const sheet of sheetsFor(root)) all.push(...readSheetTree(sheet, doc.baseURI, unreadable));
  const failed: string[] = [];
  let needsHostPermission = false;
  for (const href of new Set(unreadable)) {
    const fetched = await host.fetchText(href);
    if (fetched && 'text' in fetched) {
      all.push(...(await parseFetchedSheet(fetched.text, href, host)));
    } else {
      failed.push(href);
      if (fetched?.error === 'needs-permission') needsHostPermission = true;
    }
  }
  const kept = filterRuleTree(all, matcherFor(root));
  const declarations = styleNodesIn(kept).map((node) => node.declarations).join('; ');

  const animations = new Set(animationNamesIn(declarations));
  const families = new Set(fontFamiliesInDeclarations(declarations));
  const view = doc.defaultView ?? window;
  const styleAttributes: string[] = [];
  for (const element of elementsIn(root)) {
    const style = view.getComputedStyle(element);
    for (const name of style.animationName.split(',')) {
      const trimmed = name.trim();
      if (trimmed && trimmed !== 'none') animations.add(unquote(trimmed));
    }
    for (const family of fontFamiliesIn(style.fontFamily)) families.add(family);
    for (const pseudo of ['::before', '::after']) {
      const generated = view.getComputedStyle(element, pseudo);
      if (generated.content && generated.content !== 'none') {
        for (const family of fontFamiliesIn(generated.fontFamily)) families.add(family);
      }
    }
    const inline = element.getAttribute('style');
    if (inline) styleAttributes.push(inline);
  }
  const dependencies = pickDependencies(all, { animationNames: animations, fontFamilies: families });

  // Custom properties defined above the root: resolved there and carried as bare declarations.
  const used = customPropertiesIn(
    [serializeRuleTree(kept), serializeRuleTree(dependencies), ...styleAttributes].join('\n'),
  );
  const rootStyle = view.getComputedStyle(root);
  const variables = used
    .map((name) => [name, rootStyle.getPropertyValue(name).trim()] as const)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`);
  return { kept, dependencies, variables, unreadable: failed, needsHostPermission };
}
