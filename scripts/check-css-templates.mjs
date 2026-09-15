/**
 * Catch a backtick that closes a Lit `css` template early.
 *
 * A backtick inside a css`` literal ends it. What follows is then parsed as TypeScript, so the
 * error surfaces dozens of lines below the real mistake — and because the build fails *after*
 * writing nothing, a glance at the tail of the log plus a stale `dist/` makes it look as though
 * the change simply had no effect. That sequence has cost real time three times in this
 * codebase, which is why it is now a check rather than a habit.
 *
 * How it decides, rather than guessing: it finds each css`` opener, walks forward honouring
 * escapes and `${…}` interpolation to find the literal's true end, and then asks whether the
 * braces inside balance. A stray backtick always truncates the literal mid-rule, so the content
 * is left with an unclosed `{` — a signal with no false positives from legitimate nested
 * templates or interpolated values.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

/** The index just past the template literal opening at `from`, and the text between. */
function readTemplate(source, from) {
  let depth = 0;
  for (let at = from; at < source.length; at += 1) {
    const ch = source[at];
    if (ch === '\\') {
      at += 1;
      continue;
    }
    if (ch === '$' && source[at + 1] === '{') {
      depth += 1;
      at += 1;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth -= 1;
      continue;
    }
    // Only a backtick outside an interpolation can end the literal.
    if (ch === '`' && depth === 0) return { body: source.slice(from, at), end: at };
  }
  return { body: source.slice(from), end: source.length };
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

const offences = [];

for await (const path of walk(root)) {
  const source = await readFile(path, 'utf8');
  const opener = /(^|[\s([=,:])css`/g;
  let match;
  while ((match = opener.exec(source)) !== null) {
    const from = match.index + match[0].length;
    const { body, end } = readTemplate(source, from);
    const opened = (body.match(/\{/g) ?? []).length;
    const closed = (body.match(/\}/g) ?? []).length;
    if (opened === closed) {
      opener.lastIndex = end;
      continue;
    }
    /*
     * Unbalanced, so the literal ended somewhere it should not have. The useful line to report is
     * the last one in the body, because that is where the stray backtick sits.
     */
    const bodyLines = body.split('\n');
    offences.push({
      file: relative(process.cwd(), path),
      opened: lineOf(source, match.index),
      at: lineOf(source, match.index) + bodyLines.length - 1,
      text: (bodyLines.at(-1) ?? '').trim().slice(0, 96),
      braces: `${opened} open, ${closed} closed`,
    });
    opener.lastIndex = end;
  }
}

if (offences.length) {
  console.error(
    `css-templates: ${offences.length} css\`\` template${offences.length === 1 ? '' : 's'} ` +
    'ended early. A backtick inside one closes it — use plain text in CSS comments.\n',
  );
  for (const one of offences) {
    console.error(`  ${one.file}:${one.at}  (css\`\` opened at line ${one.opened}, ${one.braces})`);
    console.error(`    ${one.text}`);
  }
  process.exit(1);
}

console.log('css-templates: every css`` template closes where it should');
