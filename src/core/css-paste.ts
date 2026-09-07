import { checkDeclaration } from './declarations.js';
import { parseDeclarations } from './css.js';
import { withParsedSheet } from './sheets.js';

/** A stylesheet rule recognised from pasted CSS. */
export interface PastedCssRule {
  selector: string;
  declarations: Record<string, string>;
}

/**
 * The useful part of a pasted CSS buffer.
 *
 * Rules are flattened into `declarations` for destinations that have one owner (an
 * element, class, or selector). The original rule list remains available to explain
 * what the dialog recognised, while block CSS keeps the original text untouched.
 */
export interface ParsedCssPaste {
  mode: 'empty' | 'declarations' | 'rules';
  declarations: Record<string, string>;
  rules: PastedCssRule[];
  /** Declaration fragments refused because they could not be stored safely. */
  rejected: string[];
  /** Advice from the shared declaration validator, kept for the decision dialog. */
  advice: string[];
  /** Top-level at-rules or other constructs that a selector-only destination cannot own. */
  unsupportedRules: number;
}

/** Where a non-block paste will be written. */
export type CssPasteDestination =
  | {
    kind: 'inline';
    element: HTMLElement;
  }
  | {
    kind: 'class';
    name: string;
    element: HTMLElement | null;
    applyToElement: boolean;
  }
  | {
    kind: 'rule';
    selector: string;
    /** Present when the user is editing the page rule itself from Styles. */
    liveRule?: CSSStyleRule | null;
  };

/**
 * Parse either a declaration list or the top-level style rules in a stylesheet.
 *
 * The browser parses selectors, comments, strings, escapes, and at-rules more reliably
 * than a hand-written stylesheet parser, so complete rules go through a temporary sheet.
 * A bare declaration list is parsed separately because it is not a valid stylesheet until
 * it has a selector wrapped around it. The declaration parser intentionally preserves the
 * authored value text, including shorthands and custom properties.
 */
export function parsePastedCSS(source: string): ParsedCssPaste {
  const text = String(source ?? '').trim();
  if (!text) {
    return {
      mode: 'empty',
      declarations: {},
      rules: [],
      rejected: [],
      advice: [],
      unsupportedRules: 0,
    };
  }

  const stylesheet = withParsedSheet(text, (sheet) => {
    const rules: PastedCssRule[] = [];
    let unsupportedRules = 0;
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule) {
        const declarations = checkedDeclarations(parseDeclarations(rule.style.cssText));
        if (Object.keys(declarations.declarations).length) {
          rules.push({ selector: rule.selectorText, declarations: declarations.declarations });
        }
        continue;
      }
      unsupportedRules += 1;
    }
    return { rules, unsupportedRules };
  });

  if (stylesheet?.rules.length) {
    const declarations: Record<string, string> = {};
    const rejected: string[] = [];
    const advice: string[] = [];
    for (const rule of stylesheet.rules) {
      Object.assign(declarations, rule.declarations);
    }
    // The CSSOM path has already validated names through its stylesheet parser. Re-run the
    // aggregate through the shared validator so the dialog can explain forward-looking or
    // deprecated properties consistently with manual declaration entry.
    const checked = checkedDeclarations(declarations);
    rejected.push(...checked.rejected);
    advice.push(...checked.advice);
    return {
      mode: 'rules',
      declarations: checked.declarations,
      rules: stylesheet.rules,
      rejected,
      advice,
      unsupportedRules: stylesheet.unsupportedRules,
    };
  }

  const checked = checkedDeclarations(parseDeclarationList(text));
  return {
    mode: Object.keys(checked.declarations).length ? 'declarations' : 'empty',
    declarations: checked.declarations,
    rules: [],
    rejected: checked.rejected,
    advice: checked.advice,
    unsupportedRules: stylesheet?.unsupportedRules ?? 0,
  };
}

/** Parse declaration text while respecting strings, functions, and comments. */
function parseDeclarationList(text: string): Record<string, string> {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  let comment = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const next = text[index + 1];

    if (comment) {
      if (ch === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && ch === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  const out: Record<string, string> = {};
  for (const part of parts) {
    let colon = -1;
    depth = 0;
    quote = '';
    escaped = false;
    for (let index = 0; index < part.length; index += 1) {
      const ch = part[index];
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
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ':' && depth === 0) {
        colon = index;
        break;
      }
    }
    if (colon < 1) continue;
    const property = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (property && value) out[property] = value;
  }
  return out;
}

function checkedDeclarations(raw: Record<string, string>): {
  declarations: Record<string, string>;
  rejected: string[];
  advice: string[];
} {
  const declarations: Record<string, string> = {};
  const rejected: string[] = [];
  const advice: string[] = [];
  for (const [property, value] of Object.entries(raw)) {
    const verdict = checkDeclaration({ property, value });
    if (verdict.refusal) {
      rejected.push(verdict.refusal);
      continue;
    }
    if (!verdict.property) continue;
    declarations[verdict.property] = value.trim();
    if (verdict.advice && !advice.includes(verdict.advice)) advice.push(verdict.advice);
  }
  return { declarations, rejected, advice };
}

/** Split CSS priority from a declaration value before writing through CSSOM. */
export function splitCssPriority(raw: string): { value: string; priority: '' | 'important' } {
  const text = String(raw ?? '').trim();
  const important = /!\s*important\s*$/i.exec(text);
  if (!important) return { value: text, priority: '' };
  return {
    value: text.slice(0, important.index).trim(),
    priority: 'important',
  };
}

/** How many declarations the dialog will write, for labels and accessible summaries. */
export function pastedDeclarationCount(parsed: ParsedCssPaste): number {
  return Object.keys(parsed.declarations).length;
}
