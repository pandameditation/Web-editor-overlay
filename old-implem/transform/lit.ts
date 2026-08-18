import { relative } from 'path';

export function transformLit(code: string, id: string, root: string): { code: string; map?: null } | undefined {
  const relPath = relative(root, id);

  // Match html`...` templates, handling nested backticks via ${} tracking
  const injections: { offset: number; text: string }[] = [];
  const htmlTagRegex = /\bhtml`/g;
  let match: RegExpExecArray | null;

  while ((match = htmlTagRegex.exec(code)) !== null) {
    const templateStart = match.index + match[0].length;
    const templateEnd = findTemplateLiteralEnd(code, templateStart);
    if (templateEnd === -1) continue;

    const templateContent = code.substring(templateStart, templateEnd);
    // Mask out ${...} expression regions so nested html`` templates (handled by
    // their own iteration) are not double-processed as raw text here.
    const masked = maskExpressions(templateContent);
    // Find all opening tags in the template and inject data-live-src
    const tagRegex = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)(\/?)>/g;
    let tagMatch: RegExpExecArray | null;

    while ((tagMatch = tagRegex.exec(masked)) !== null) {
      // Calculate line number relative to the file
      const absoluteOffset = templateStart + tagMatch.index;
      const line = code.substring(0, absoluteOffset).split('\n').length;
      const lastNewline = code.lastIndexOf('\n', absoluteOffset - 1);
      const col = absoluteOffset - lastNewline;

      // Insert before the > (or />)
      const closingSlash = tagMatch[3];
      const insertOffset = templateStart + tagMatch.index + tagMatch[0].length - 1 - closingSlash.length;
      const attr = ` data-live-src="${relPath}:${line}:${col}"`;
      injections.push({ offset: insertOffset, text: attr });
    }
  }

  if (injections.length === 0) return undefined;

  // Apply in reverse order
  injections.sort((a, b) => b.offset - a.offset);
  let result = code;
  for (const inj of injections) {
    result = result.slice(0, inj.offset) + inj.text + result.slice(inj.offset);
  }

  return { code: result, map: null };
}

/**
 * Replace all ${...} expression regions with equal-length whitespace so that
 * tag-offset math stays valid while nested templates are excluded from scanning.
 */
function maskExpressions(template: string): string {
  const chars = template.split('');
  let i = 0;
  while (i < template.length) {
    if (template[i] === '\\') { i += 2; continue; }
    if (template[i] === '$' && template[i + 1] === '{') {
      const end = skipBracedExpression(template, i + 2);
      for (let j = i; j < end && j < template.length; j++) {
        if (chars[j] !== '\n') chars[j] = ' ';
      }
      i = end;
      continue;
    }
    i++;
  }
  return chars.join('');
}

/** Find the end of a template literal starting after the opening backtick */
function findTemplateLiteralEnd(code: string, start: number): number {
  let i = start;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '`') return i;
    if (ch === '\\') { i += 2; continue; }
    if (ch === '$' && code[i + 1] === '{') {
      // Skip the expression inside ${}
      i = skipBracedExpression(code, i + 2);
      continue;
    }
    i++;
  }
  return -1;
}

function skipBracedExpression(code: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '`') {
      // Nested template literal
      i = findTemplateLiteralEnd(code, i + 1) + 1;
      continue;
    } else if (ch === "'" || ch === '"') {
      i = skipString(code, i);
      continue;
    }
    i++;
  }
  return i;
}

function skipString(code: string, start: number): number {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue; }
    if (code[i] === quote) return i + 1;
    i++;
  }
  return i;
}
