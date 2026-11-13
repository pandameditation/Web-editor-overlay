/**
 * A `border` or `outline` value, as its three parts.
 *
 * The Border section edits a line as one thing: how thick, how drawn, what colour. CSS spells that
 * as one shorthand (`border: 1px solid #ddd`), and the editor writes it that way, so a block ends up
 * with one clean declaration rather than a shorthand and three longhands competing by order. These
 * are the two halves of that: reading a written value back into parts, and writing parts out again.
 */

export type LineKind = 'border' | 'outline';
export type LinePart = 'width' | 'style' | 'color';
export const LINE_PARTS: readonly LinePart[] = ['width', 'style', 'color'];

export interface LineParts {
  width: string;
  style: string;
  color: string;
}

/** Every keyword `border-style` takes; `outline-style` adds `auto`. */
export const LINE_STYLES = [
  'none',
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
  'hidden',
] as const;

const STYLE_RE = /^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset|auto)$/i;
const WIDTH_RE =
  /^(?:thin|medium|thick|0|-?[\d.]+(?:px|em|rem|ch|ex|vw|vh|vmin|vmax|svh|dvh|lvh|cm|mm|in|pt|pc|q)|(?:calc|min|max|clamp)\(.*\))$/i;

/** Top-level words of a value: `1px solid rgb(0 0 0 / 50%)` is three, not six. */
function words(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * A written value read as parts. `var()` is placed by its name (`--border-width` is a width) and
 * otherwise taken as the colour, which is what a token in a line most often is. A whole value that
 * is one token (`var(--border)`) is none of the three: `token` holds it, and the parts stay empty.
 */
export function parseLine(value: string): LineParts & { token: string } {
  const parts: LineParts & { token: string } = { width: '', style: '', color: '', token: '' };
  const list = words(value.replace(/!\s*important\s*$/i, ''));
  if (list.length === 1 && /^var\(/i.test(list[0]!) && !/width|style|colou?r/i.test(list[0]!)) {
    parts.token = list[0]!;
    return parts;
  }
  for (const word of list) {
    if (!parts.style && STYLE_RE.test(word)) parts.style = word;
    else if (!parts.width && (WIDTH_RE.test(word) || /^var\(\s*--[\w-]*(?:width|size|thick)/i.test(word))) parts.width = word;
    else if (!parts.style && /^var\(\s*--[\w-]*style/i.test(word)) parts.style = word;
    else if (!parts.color) parts.color = word;
  }
  return parts;
}

/**
 * The shorthand to write once one part changes, or '' to remove it.
 *
 * Starts from what is written now (`base`), so the other two parts are kept. Giving a line a width or
 * a colour while it has no style gives it `solid`: CSS draws nothing without a style, and an edit
 * that changes nothing on the page reads as a broken control. Picking `none` writes `none` alone,
 * which is the whole of what it means. Emptying every part removes the declaration.
 */
export function composeLine(base: LineParts, part: LinePart, value: string): string {
  const next: LineParts = { ...base, [part]: value.trim() };
  if (/^none$/i.test(next.style) && part === 'style') return 'none';
  const drawn = next.style && !/^(?:none|hidden)$/i.test(next.style);
  if (!drawn && part !== 'style' && (next.width || next.color)) {
    next.style = 'solid';
    // And a hairline where no width is written, not CSS's 3px `medium`: a colour picked for a line
    // that was not there is asking for the usual 1px rule.
    next.width ||= '1px';
  }
  return LINE_PARTS.map((one) => next[one]).filter(Boolean).join(' ');
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * What one side's edit writes, as the whole side family: `border-<side>` and its three longhands,
 * each to its new value or '' to remove it, so a side is never left with a shorthand and a longhand
 * competing by order.
 *
 * `own` is what the side declares for itself; `all` is what every side draws from the all-sides
 * border, or null when there is none. Against a border, only the parts that differ are written,
 * as longhands (`border-bottom-width: 4px`), so the side goes on following the shared colour and
 * style when those change; a part picked equal to the shared one stops being an override. With no
 * border to follow, the side is its own shorthand, drawn the way `composeLine` draws a new line.
 * Picking `none` writes `border-<side>: none`, which is the whole of what it means.
 */
export function composeEdge(
  side: Side,
  own: LineParts,
  all: LineParts | null,
  part: LinePart,
  value: string,
): Record<string, string> {
  const name = `border-${side}`;
  const out: Record<string, string> = { [name]: '' };
  for (const one of LINE_PARTS) out[`${name}-${one}`] = '';
  if (part === 'style' && /^none$/i.test(value.trim())) {
    out[name] = 'none';
    return out;
  }
  if (!all) {
    out[name] = composeLine(own, part, value);
    return out;
  }
  const next: LineParts = { ...own, [part]: value.trim() };
  // A width or colour for a side that was turned off turns it back on, in the shared style.
  if (part !== 'style' && /^(?:none|hidden)$/i.test(next.style)) next.style = '';
  for (const one of LINE_PARTS) {
    if (next[one] && next[one].toLowerCase() !== all[one].toLowerCase()) out[`${name}-${one}`] = next[one];
  }
  return out;
}
