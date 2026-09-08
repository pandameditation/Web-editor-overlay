import { splitCssPriority, type PastedCssRule } from './css-paste.js';
import { formatHTML, sanitizeFragment } from './sanitize.js';
import { withParsedSheet } from './sheets.js';

/**
 * Apply pasted selector rules to the in-memory markup of a block.
 *
 * The block author is editing a template, not a live page element, so the ordinary
 * CSS-paste inline destination cannot be used here. Matching is done against the
 * sanitised fragment and the result is written back as template HTML.
 */
export function blockMatchRoot(source: string): DocumentFragment {
  return sanitizeFragment(source);
}

export function applyBlockInlineRules(
  source: string,
  rules: readonly PastedCssRule[],
): { html: string; matched: number } {
  const fragment = blockMatchRoot(source);
  const roots = blockRoots(fragment);
  const elements = blockElements(fragment, roots);
  let matched = 0;

  for (const rule of rules) {
    const selected = elements.filter((element) => {
      if (rule.selector.trim() === ':scope') return roots.includes(element);
      try {
        return element.matches(rule.selector);
      } catch {
        return false;
      }
    });
    if (!selected.length) continue;
    matched += selected.length;
    for (const element of selected) {
      for (const [property, rawValue] of Object.entries(rule.declarations)) {
        const { value, priority } = splitCssPriority(rawValue);
        element.style.setProperty(property, value, priority);
      }
    }
  }

  return { html: serialiseFragment(fragment), matched };
}

/** Add a global class to every root element in a block template. */
export function addClassToBlockRoots(
  source: string,
  name: string,
): { html: string; roots: number } {
  const fragment = sanitizeFragment(source);
  const roots = Array.from(fragment.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  for (const root of roots) root.classList.add(name);
  return { html: serialiseFragment(fragment), roots: roots.length };
}

/**
 * Scope element and structural selectors to the block root while leaving class-rooted
 * selectors global. A block's classes are design-system assets: `.pouet` must keep
 * working anywhere in the page, while `p`, `#title`, `:hover`, and `p.pouet` must
 * only affect this block's instance.
 */
export function scopeBlockCSS(source: string, blockId: string): string {
  const text = String(source ?? '').trim();
  if (!text || !blockId) return text;

  const escapedId = blockId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const root = `[data-heo-block="${escapedId}"]`;
  return withParsedSheet(text, (sheet) =>
    Array.from(sheet.cssRules)
      .map((rule) => rewriteRule(rule, root))
      .join('\n\n'),
  ) ?? text;
}

function rewriteRule(rule: CSSRule, root: string): string {
  if (rule instanceof CSSStyleRule) {
    const selector = splitSelectorList(rule.selectorText)
      .map((part) => scopeSelector(part, root))
      .join(', ');
    return `${selector} { ${rule.style.cssText} }`;
  }

  const nested = 'cssRules' in rule
    ? (rule as CSSRule & { cssRules: CSSRuleList }).cssRules
    : null;
  if (!nested?.length) return rule.cssText;

  const source = rule.cssText;
  const open = source.indexOf('{');
  const close = source.lastIndexOf('}');
  if (open < 0 || close <= open) return source;

  const prelude = source.slice(0, open).trim();
  const body = Array.from(nested)
    .map((child) => indent(rewriteRule(child, root)))
    .join('\n');
  return `${prelude} {\n${body}\n}`;
}

function scopeSelector(selector: string, root: string): string {
  const trimmed = selector.trim();
  if (!trimmed || classRooted(trimmed)) return trimmed;
  return `${root} ${trimmed}`;
}

function classRooted(selector: string): boolean {
  return /^\.[A-Za-z_][\w-]*(?=$|[.#:[\s>+~])/.test(selector);
}

function splitSelectorList(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let brackets = 0;
  let parentheses = 0;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[') brackets += 1;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
    else if (ch === '(') parentheses += 1;
    else if (ch === ')') parentheses = Math.max(0, parentheses - 1);
    else if (ch === ',' && brackets === 0 && parentheses === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.filter((part) => part.trim());
}

function blockElements(fragment: DocumentFragment, roots = blockRoots(fragment)): HTMLElement[] {
  const descendants = Array.from(fragment.querySelectorAll<HTMLElement>('*'));
  return [...roots, ...descendants];
}

function blockRoots(fragment: DocumentFragment): HTMLElement[] {
  return Array.from(fragment.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

function serialiseFragment(fragment: DocumentFragment): string {
  const holder = document.createElement('div');
  holder.append(fragment);
  return formatHTML(holder.innerHTML);
}

function indent(source: string): string {
  return source
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
