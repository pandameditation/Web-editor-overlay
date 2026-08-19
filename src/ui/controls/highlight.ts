/**
 * A very small syntax highlighter.
 *
 * The code panels need readable markup, not a full language service, so this
 * tokenises just enough to colour structure: tags, attributes, selectors,
 * properties, strings and comments. Everything is escaped before it becomes
 * HTML, so untrusted source text cannot break out of the highlight layer.
 */

export type CodeLanguage = 'html' | 'css' | 'js';

type TokenType =
  | 'plain'
  | 'comment'
  | 'tag'
  | 'attr'
  | 'value'
  | 'string'
  | 'keyword'
  | 'number'
  | 'property'
  | 'selector'
  | 'punct';

interface Token {
  type: TokenType;
  text: string;
}

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'class', 'extends', 'return', 'if', 'else', 'for', 'while',
  'new', 'this', 'super', 'import', 'export', 'from', 'default', 'async', 'await', 'static',
  'get', 'set', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'null', 'undefined',
  'true', 'false', 'of', 'in', 'do', 'switch', 'case', 'break', 'continue', 'yield', 'delete', 'void',
]);

export function highlight(source: string, language: CodeLanguage): string {
  const tokens =
    language === 'html' ? tokenizeHTML(source) : language === 'css' ? tokenizeCSS(source) : tokenizeJS(source);
  return tokens
    .map((token) =>
      token.type === 'plain' ? escapeHTML(token.text) : `<span class="t-${token.type}">${escapeHTML(token.text)}</span>`,
    )
    .join('');
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] as string);
}

/* -------------------------------------------------------------------------- */

function tokenizeHTML(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i);
      const stop = end === -1 ? source.length : end + 3;
      tokens.push({ type: 'comment', text: source.slice(i, stop) });
      i = stop;
      continue;
    }

    if (source[i] === '<') {
      const close = source.indexOf('>', i);
      const stop = close === -1 ? source.length : close + 1;
      tokens.push(...tokenizeTag(source.slice(i, stop)));
      i = stop;
      continue;
    }

    const next = source.indexOf('<', i);
    const stop = next === -1 ? source.length : next;
    tokens.push({ type: 'plain', text: source.slice(i, stop) });
    i = stop;
  }
  return tokens;
}

function tokenizeTag(tag: string): Token[] {
  const tokens: Token[] = [];
  // `<`, optional `/`, then the tag name.
  const nameMatch = /^<\/?\s*([a-zA-Z][\w:-]*)/.exec(tag);
  if (!nameMatch) return [{ type: 'punct', text: tag }];

  const nameEnd = nameMatch[0].length;
  tokens.push({ type: 'punct', text: tag.slice(0, nameEnd - nameMatch[1].length) });
  tokens.push({ type: 'tag', text: nameMatch[1] });

  let rest = tag.slice(nameEnd);
  const attrPattern = /([\w:@.-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(rest)) !== null) {
    if (match.index > cursor) tokens.push({ type: 'plain', text: rest.slice(cursor, match.index) });
    tokens.push({ type: 'attr', text: match[1] });
    if (match[2]) tokens.push({ type: 'punct', text: match[2] });
    if (match[3]) tokens.push({ type: 'value', text: match[3] });
    cursor = match.index + match[0].length;
  }

  if (cursor < rest.length) {
    rest = rest.slice(cursor);
    // Bare boolean attributes plus the closing bracket.
    const bare = /([\w:@.-]+)/g;
    let bareCursor = 0;
    let bareMatch: RegExpExecArray | null;
    while ((bareMatch = bare.exec(rest)) !== null) {
      if (bareMatch.index > bareCursor) {
        tokens.push({ type: 'punct', text: rest.slice(bareCursor, bareMatch.index) });
      }
      tokens.push({ type: 'attr', text: bareMatch[1] });
      bareCursor = bareMatch.index + bareMatch[0].length;
    }
    if (bareCursor < rest.length) tokens.push({ type: 'punct', text: rest.slice(bareCursor) });
  }
  return tokens;
}

function tokenizeCSS(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let inBlock = false;

  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i);
      const stop = end === -1 ? source.length : end + 2;
      tokens.push({ type: 'comment', text: source.slice(i, stop) });
      i = stop;
      continue;
    }

    const ch = source[i];
    if (ch === '{') {
      inBlock = true;
      tokens.push({ type: 'punct', text: ch });
      i += 1;
      continue;
    }
    if (ch === '}') {
      inBlock = false;
      tokens.push({ type: 'punct', text: ch });
      i += 1;
      continue;
    }

    if (!inBlock) {
      const stop = findNext(source, i, ['{', '}', '/*']);
      tokens.push({ type: 'selector', text: source.slice(i, stop) });
      i = stop;
      continue;
    }

    // Inside a block: `property: value;`
    const colon = source.indexOf(':', i);
    const semi = findNext(source, i, [';', '}', '/*']);
    if (colon !== -1 && colon < semi) {
      tokens.push({ type: 'property', text: source.slice(i, colon) });
      tokens.push({ type: 'punct', text: ':' });
      tokens.push({ type: 'value', text: source.slice(colon + 1, semi) });
      i = semi;
    } else {
      tokens.push({ type: 'plain', text: source.slice(i, semi) });
      i = semi;
    }
    if (source[i] === ';') {
      tokens.push({ type: 'punct', text: ';' });
      i += 1;
    }
  }
  return tokens;
}

function findNext(source: string, from: number, needles: string[]): number {
  let best = source.length;
  for (const needle of needles) {
    const at = source.indexOf(needle, from);
    if (at !== -1 && at < best) best = at;
  }
  return best === from ? from + 1 : best;
}

function tokenizeJS(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) tokens.push({ type: 'plain', text: source.slice(cursor, match.index) });
    if (match[1]) tokens.push({ type: 'comment', text: match[1] });
    else if (match[2]) tokens.push({ type: 'string', text: match[2] });
    else if (match[3]) tokens.push({ type: 'number', text: match[3] });
    else if (match[4]) {
      tokens.push({ type: JS_KEYWORDS.has(match[4]) ? 'keyword' : 'plain', text: match[4] });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) tokens.push({ type: 'plain', text: source.slice(cursor) });
  return tokens;
}
