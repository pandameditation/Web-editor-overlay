/**
 * Selector specificity, as the tuple the cascade actually compares.
 *
 * It used to be one number, `ids × 100 + classes × 10 + types`, which is wrong as soon as a count
 * passes nine: eleven classes outscored one id, and the browser disagrees (measured). It also
 * treated `:where()` like any pseudo-class and `:is()` as one class, so the panel's winner was not
 * the page's winner. A tuple compared field by field is the definition, so that is what this is.
 *
 * Pure, so `npm run test:specificity` runs it in plain Node.
 */

/** `[ids, classes + attributes + pseudo-classes, types + pseudo-elements]`. */
export type Specificity = readonly [number, number, number];

const ZERO: Specificity = [0, 0, 0];

/** Pseudo-elements that may still be written with one colon. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

/** Pseudo-classes whose specificity is that of their most specific argument. */
const MAX_OF_ARGUMENTS = new Set(['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any']);

/** Pseudo-classes that count as one class plus their `of S` selector, if any. */
const NTH_OF = new Set(['nth-child', 'nth-last-child']);

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * One number that orders like the tuple, for the readers that still report a number (the legacy
 * `AppliedRule.specificity`, the AI context). Exact while every count stays under a thousand.
 */
export function specificityNumber(s: Specificity): number {
  return s[0] * 1e6 + s[1] * 1e3 + s[2];
}

/**
 * The specificity of a selector, or of the most specific selector in a list.
 *
 * `:is()`, `:not()` and `:has()` take their most specific argument, `:where()` counts nothing,
 * `::before` and the legacy `:before` count as a type, attribute selectors as a class.
 */
export function specificityOf(selector: string): Specificity {
  let best = ZERO;
  for (const part of splitList(selector)) {
    const one = complexSpecificity(part);
    if (compareSpecificity(one, best) > 0) best = one;
  }
  return best;
}

/** Split on top-level commas, so `:is(a, b)` stays one part. */
function splitList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[index + 1] ?? '';
        index += 1;
      } else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\\') {
      current += ch + (text[index + 1] ?? '');
      index += 1;
      continue;
    } else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** True for a character that can continue a CSS identifier. */
function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && (/[\w-]/.test(ch) || ch.charCodeAt(0) > 0x7f);
}

/** Read an identifier starting at `start`, escapes included; returns its end. */
function readName(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (!isNameChar(text[index])) break;
    index += 1;
  }
  return index;
}

/** The index just past the bracket that closes the one at `start`, skipping strings. */
function closeOf(text: string, start: number): number {
  const open = text[start];
  const close = open === '(' ? ')' : ']';
  let depth = 0;
  let quote = '';
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      if (ch === '\\') index += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\\') index += 1;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

/** One complex selector (compounds and combinators, no top-level comma). */
function complexSpecificity(text: string): Specificity {
  let a = 0;
  let b = 0;
  let c = 0;
  const add = (s: Specificity): void => {
    a += s[0];
    b += s[1];
    c += s[2];
  };
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '#') {
      a += 1;
      index = readName(text, index + 1);
      continue;
    }
    if (ch === '.') {
      b += 1;
      index = readName(text, index + 1);
      continue;
    }
    if (ch === '[') {
      b += 1;
      index = closeOf(text, index);
      continue;
    }
    if (ch === ':') {
      const double = text[index + 1] === ':';
      const nameStart = index + (double ? 2 : 1);
      const nameEnd = readName(text, nameStart);
      const name = text.slice(nameStart, nameEnd).toLowerCase();
      let argument: string | null = null;
      let end = nameEnd;
      if (text[nameEnd] === '(') {
        end = closeOf(text, nameEnd);
        argument = text.slice(nameEnd + 1, end - 1);
      }
      index = end;
      if (double || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        c += 1;
        continue;
      }
      if (name === 'where') continue;
      if (MAX_OF_ARGUMENTS.has(name)) {
        if (argument !== null) add(specificityOf(argument));
        continue;
      }
      b += 1;
      if (NTH_OF.has(name) && argument !== null) {
        const of = /\bof\s+(.+)$/is.exec(argument);
        if (of) add(specificityOf(of[1]));
      }
      continue;
    }
    if (ch === '*') {
      index += 1;
      continue;
    }
    if (ch === '\\' || isNameChar(ch)) {
      // A type selector. A namespace prefix (`svg|rect`) is part of the same type.
      const end = readName(text, index);
      if (text[end] === '|' && text[end + 1] !== '=') {
        index = end + 1;
        continue;
      }
      c += 1;
      index = end;
      continue;
    }
    // Combinators, whitespace, `&` and `|`: no weight of their own.
    index += 1;
  }
  return [a, b, c];
}
