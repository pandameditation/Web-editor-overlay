/**
 * Unit tests for the save prompt.
 *
 * Runs in plain Node: the prompt builder takes records and returns a string, with no DOM
 * anywhere in it. Run with:
 *
 *     npm run test:prompt
 *
 * Pass `--print` to dump the rendered prompts instead of asserting, which is the quickest
 * way to read what a change to the format actually produces.
 */
import assert from 'node:assert/strict';
import { buildPrompt, type PromptInput } from '../src/core/prompt.ts';
import type { ChangeRecord } from '../src/core/types.ts';

let passed = 0;
const failures: string[] = [];
const printing = process.argv.includes('--print');

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

let sequence = 0;
function record(over: Partial<ChangeRecord> & Pick<ChangeRecord, 'kind' | 'target'>): ChangeRecord {
  sequence += 1;
  return { id: `c${sequence}`, summary: 'changed something', at: sequence, ...over };
}

function prompt(records: ChangeRecord[], over: Partial<PromptInput> = {}): string {
  return buildPrompt({
    records,
    tokens: [],
    classes: [],
    blocks: [],
    tokenCSS: '',
    classCSS: '',
    pageURL: 'http://localhost:5180/test-page.html',
    ...over,
  });
}

/* -------------------------------------------------------------------------- */
/* The shape                                                                   */
/* -------------------------------------------------------------------------- */

const COPY =
  'Press Cmd/Ctrl+E to turn on edit mode, then click any element. Text editing, drag reordering, tokens, classes, the block library and HTML editing all work here without a build step.';

/** The session from the brief: a text edit, a reorder, and a duplicate-move-retext. */
const SESSION: ChangeRecord[] = [
  record({
    kind: 'text',
    target: 'header > p:nth-of-type(2)',
    group: 'node:e1',
    summary: 'Edit text',
    before: 'Old copy.',
    after: COPY,
  }),
  record({
    kind: 'move',
    target: '#story-card > p:nth-of-type(2)',
    group: 'node:e2',
    summary: 'Move element',
    detail: { newParent: '#story-card', newIndex: '3', previousParent: '#story-card', previousIndex: '1' },
  }),
  record({
    kind: 'duplicate',
    target: '#story-card > p:nth-of-type(2)',
    group: 'node:e3',
    summary: 'Duplicate element',
    after: 'copy',
  }),
  record({
    kind: 'move',
    target: '#media-card > p:nth-of-type(2)',
    group: 'node:e3',
    summary: 'Move element',
    detail: { newParent: '#media-card', newIndex: '1', previousParent: '#story-card', previousIndex: '4' },
  }),
  record({
    kind: 'text',
    target: '#media-card > p:nth-of-type(2)',
    group: 'node:e3',
    summary: 'Edit text',
    before: 'Old.',
    after: 'Here it is my change',
  }),
];

if (printing) {
  console.log('=== the session from the brief ===\n');
  console.log(prompt(SESSION));
  console.log('\n\n=== with tokens, a stylesheet and a location ===\n');
}

test('the header counts the edits and names the file, in one bold line', () => {
  const first = prompt(SESSION).split('\n')[0];
  assert.equal(
    first,
    '**Apply these 5 edits to the source of `test-page.html`. No other changes.**',
  );
});

test('there are no markdown headings anywhere', () => {
  assert.ok(!/^#/m.test(prompt(SESSION)), 'bold labels, not headings');
});

test('the sections are bold labels in a fixed order', () => {
  const labels = [...prompt(SESSION).matchAll(/^\*\*([A-Z][^*:]*):\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(labels, ['Rules', 'Edits', 'Check']);
});

test('a single-operation edit is one line, selector first', () => {
  const lines = prompt(SESSION).split('\n');
  assert.ok(
    lines.includes(`1. \`header > p:nth-of-type(2)\`: Set text to \`${COPY}\`.`),
    lines.filter((line) => line.startsWith('1. ')).join('\n'),
  );
});

test('a reorder within one parent does not repeat the parent', () => {
  assert.ok(
    prompt(SESSION).includes(
      '2. `#story-card > p:nth-of-type(2)`: Move to position 3 (0-based, ignoring whitespace).',
    ),
  );
});

test('several operations on one target nest under it, in order', () => {
  const text = prompt(SESSION);
  const start = text.indexOf('3. `#media-card > p:nth-of-type(2)`:');
  assert.notEqual(start, -1, text);
  const body = text.slice(start).split('\n').slice(0, 4);
  assert.deepEqual(body, [
    '3. `#media-card > p:nth-of-type(2)`:',
    '    - Duplicate `#story-card > p:nth-of-type(2)` (no `id` on the copy). Later steps apply to the copy.',
    '    - Move to position 1 in `#media-card` (0-based, ignoring whitespace).',
    '    - Set text to `Here it is my change`.',
  ]);
});

test('no step mentions the value it replaced', () => {
  const text = prompt(SESSION);
  assert.ok(!text.includes('Old copy.'), 'the previous text is not in the prompt');
  assert.ok(!/\bfrom `/.test(text), 'no from/to phrasing');
  assert.ok(!/It was /.test(text), 'no "it was" asides');
});

test('the check list is terse checkboxes', () => {
  const text = prompt(SESSION);
  const at = text.indexOf('**Check:**');
  assert.notEqual(at, -1);
  assert.deepEqual(text.slice(at).split('\n').slice(2), [
    '- [ ] All edits applied, no extra changes.',
    '- [ ] `var(--token)` values untouched.',
    '- [ ] Moves are in markup, not CSS.',
    "- [ ] Text is in the project's copy or i18n catalogue.",
    '- [ ] Build, types and lint pass.',
  ]);
});

test('a selector-only session says selectors describe rendered output', () => {
  const text = prompt(SESSION);
  assert.ok(text.includes('- Selectors describe rendered output; edit the source that produces it.'));
  assert.ok(!text.includes('Locations are from this session'));
});

/* -------------------------------------------------------------------------- */
/* Locations                                                                   */
/* -------------------------------------------------------------------------- */

test('an instrumented edit carries file and line beside the selector', () => {
  const text = prompt([
    record({
      kind: 'text',
      target: '.hero h1',
      group: 'node:e1',
      after: 'Hello',
      source: { file: 'src/index.html', line: 12, column: 5 },
    }),
  ]);
  assert.ok(text.includes('1. `.hero h1` (src/index.html:12): Set text to `Hello`.'), text);
  assert.ok(text.includes('**Apply these 1 edit to the source of `src/index.html`.'), text);
  assert.ok(text.includes('- Locations are from this session'));
});

test('more than three files are not listed in the header', () => {
  const many = ['a', 'b', 'c', 'd'].map((name) =>
    record({
      kind: 'text',
      target: `.${name}`,
      group: `node:${name}`,
      after: name,
      source: { file: `${name}.html`, line: 1, column: 1 },
    }),
  );
  assert.match(prompt(many).split('\n')[0], /the source files listed below/);
});

/* -------------------------------------------------------------------------- */
/* Payloads                                                                    */
/* -------------------------------------------------------------------------- */

test('a single-line value stays inline however long', () => {
  const long = 'x'.repeat(500);
  const text = prompt([record({ kind: 'text', target: 'p', group: 'g', after: long })]);
  assert.ok(text.includes(`Set text to \`${long}\`.`));
  assert.ok(!text.includes('**Code'), 'no block is created for a long single line');
});

/*
 * Nothing is ever elided, and this is the test that says so.
 *
 * An earlier version of this module clipped values at 300 characters and appended an
 * ellipsis, which left the agent to invent the rest of a paragraph or a stylesheet. Worse,
 * an ellipsis is a legal character in copy, so its presence could not even be relied on as
 * a marker that something had been removed. Every value appears in full, whatever it is
 * and however long.
 */
const LONG_PROSE =
  'Press Cmd/Ctrl+E to turn on edit mode, then click any element. Text editing, drag ' +
  'reordering, tokens, classes, the block library and HTML editing all work here without ' +
  'a build step. Even this sentence, which exists only to push the value past any limit a ' +
  'previous version of this module might have had, has to survive intact — including the ' +
  'em dash, the "quotes", the 100% and the trailing period.';

test('a long value survives byte for byte, with no ellipsis', () => {
  const text = prompt([record({ kind: 'text', target: 'p', group: 'g', after: LONG_PROSE })]);
  assert.ok(text.includes(LONG_PROSE), 'the whole value is present');
  assert.ok(!text.includes('\u2026'), 'no ellipsis character anywhere');
  assert.ok(!text.includes('...'), 'no three-dot ellipsis either');
});

test('no record kind produces an ellipsis, whatever it carries', () => {
  const css = `.card {\n  padding: ${'1px '.repeat(60).trim()};\n}\n`;
  const html = `<section>\n  <p>${LONG_PROSE}</p>\n</section>`;
  const text = prompt([
    record({ kind: 'text', target: 'p', group: 'a', after: LONG_PROSE }),
    record({ kind: 'attribute', target: 'img', group: 'b', after: LONG_PROSE, detail: { name: 'alt' } }),
    record({ kind: 'class', target: 'div', group: 'c', after: 'a b c d e f g h i j k l m n o p' }),
    record({ kind: 'insert', target: '#x', group: 'd', detail: { html, position: 'lastChild' } }),
    record({ kind: 'replace', target: '#y', group: 'e', after: html, detail: { html } }),
    record({
      kind: 'style',
      target: '#z',
      group: 'f',
      after: LONG_PROSE,
      detail: { property: 'font-family', value: LONG_PROSE },
    }),
    record({
      kind: 'style',
      target: 'theme.css',
      group: 'g',
      before: '.card {\n  padding: 0;\n}\n',
      after: css,
      detail: { scope: 'stylesheet', css, file: 'theme.css' },
    }),
    record({
      kind: 'attribute',
      target: 'main.js',
      group: 'h',
      before: 'a',
      after: LONG_PROSE,
      detail: { scope: 'external script', script: LONG_PROSE, file: 'main.js' },
    }),
  ]);

  assert.ok(!text.includes('\u2026'), 'no ellipsis character anywhere');
  // Every payload is reproducible from the prompt alone.
  assert.ok(text.includes(LONG_PROSE), 'the prose survives');
  assert.ok(text.includes(html), 'the markup survives');
  // The stylesheet is one changed declaration, so it is described rather than attached —
  // but the value it changed to still appears in full.
  assert.ok(text.includes('1px '.repeat(60).trim()), 'the declaration value survives');
});

test('a stylesheet large enough to be attached is attached in full', () => {
  const before = Array.from({ length: 30 }, (_, i) => `.r${i} { padding: ${i}px; }`).join('\n');
  const after = Array.from({ length: 30 }, (_, i) => `.r${i} { padding: ${i + 1}px; }`).join('\n');
  const text = prompt([
    record({
      kind: 'style',
      target: 'theme.css',
      group: 'g',
      before,
      after,
      detail: { scope: 'stylesheet', css: after, file: 'theme.css' },
    }),
  ]);
  assert.ok(text.includes(after), 'the whole file is in the prompt');
  assert.ok(!text.includes('\u2026'), 'and not a character of it is elided');
});

test('a value that is itself backticked code cannot break out of its span', () => {
  const tricky = 'calc(100% - `var(--x)`)';
  const text = prompt([record({ kind: 'text', target: 'p', group: 'g', after: tricky })]);
  assert.ok(text.includes(tricky), 'present in full');
  // The fence has to be longer than the longest backtick run inside the value.
  assert.match(text, /``+ ?calc\(100% - `var\(--x\)`\) ?``+/);
});

test('a value with a line break becomes a numbered block', () => {
  const text = prompt([
    record({ kind: 'text', target: 'p', group: 'g', after: 'line one\nline two' }),
  ]);
  assert.ok(text.includes('Set text to Code 1.'), text);
  assert.ok(text.includes('**Code 1** — for p'));
  assert.ok(text.includes('line one\nline two'));
});

test('the same payload twice gets one number', () => {
  const html = '<div>\n  <span>x</span>\n</div>';
  const text = prompt([
    record({ kind: 'insert', target: '#a', group: 'a', detail: { html, position: 'firstChild' } }),
    record({ kind: 'insert', target: '#b', group: 'b', detail: { html, position: 'lastChild' } }),
  ]);
  assert.equal((text.match(/\*\*Code \d\*\*/g) ?? []).length, 1);
  assert.equal((text.match(/Code 1/g) ?? []).length, 3, 'cited twice, defined once');
});

/* -------------------------------------------------------------------------- */
/* Styles and stylesheets                                                      */
/* -------------------------------------------------------------------------- */

test('an inline style edit names only the destination', () => {
  const text = prompt([
    record({
      kind: 'style',
      target: '#c2',
      group: 'style:c2',
      before: '8px',
      after: 'var(--space-xl)',
      detail: { property: 'padding', value: 'var(--space-xl)' },
    }),
  ]);
  assert.ok(text.includes('1. `#c2`: Set `padding` to `var(--space-xl)`.'), text);
});

test('a rule edit leads with the rule and its file', () => {
  const text = prompt([
    record({
      kind: 'style',
      target: '.card',
      group: 'rule:.card',
      after: '4px',
      detail: { property: 'padding', value: '4px', selector: '.card', scope: 'stylesheet rule', file: 'theme.css' },
    }),
  ]);
  assert.ok(text.includes('1. `.card` in `theme.css`: Set `padding` to `4px`.'), text);
});

test('a whole-buffer stylesheet edit is described as the declarations that changed', () => {
  const before = '/* keep */\n.card {\n  padding: 16px;\n  color: red;\n}\n';
  const after = '/* keep */\n.card {\n  padding: 40px;\n  color: red;\n}\n';
  const text = prompt([
    record({
      kind: 'style',
      target: 'theme.css',
      group: 'sheet:1',
      before,
      after,
      detail: { scope: 'stylesheet', css: after, file: 'theme.css' },
    }),
  ]);
  assert.ok(text.includes('1. `theme.css`: Set `padding` to `40px` in the `.card` rule.'), text);
  assert.ok(!text.includes('**Code'), 'the file is not attached when a diff will do');
});

test('a stylesheet rewrite too large to list falls back to the file', () => {
  const before = Array.from({ length: 30 }, (_, i) => `.r${i} { padding: ${i}px; }`).join('\n');
  const after = Array.from({ length: 30 }, (_, i) => `.r${i} { padding: ${i + 1}px; }`).join('\n');
  const text = prompt([
    record({
      kind: 'style',
      target: 'theme.css',
      group: 'sheet:1',
      before,
      after,
      detail: { scope: 'stylesheet', css: after, file: 'theme.css' },
    }),
  ]);
  assert.ok(text.includes('Replace the file with Code 1'), text);
});

/* -------------------------------------------------------------------------- */
/* The design system                                                           */
/* -------------------------------------------------------------------------- */

test('authored tokens are handed over as CSS, scanned ones are not', () => {
  const records = [record({ kind: 'token', target: 'brand', group: 'token:brand', after: '#ff0055', detail: { name: 'brand' } })];
  const withAuthored = prompt(records, {
    tokens: [{ name: 'brand', value: '#ff0055', group: 'color', origin: 'user' }],
    tokenCSS: ':root {\n  --brand: #ff0055;\n}',
  });
  assert.ok(withAuthored.includes('**New tokens:** Add these wherever this project declares its tokens.'));
  assert.ok(withAuthored.includes('--brand: #ff0055;'));

  const scannedOnly = prompt(records, {
    tokens: [{ name: 'brand', value: '#ff0055', group: 'color', origin: 'stylesheet' }],
    tokenCSS: ':root {\n  --brand: #ff0055;\n}',
  });
  assert.ok(!scannedOnly.includes('**New tokens'), 'nothing new to add');
});

/* -------------------------------------------------------------------------- */
/* Empty                                                                       */
/* -------------------------------------------------------------------------- */

test('no records is one plain sentence', () => {
  assert.equal(prompt([]), 'No changes were made in this editing session.');
});

/* -------------------------------------------------------------------------- */

if (printing) {
  console.log(
    prompt(
      [
        record({
          kind: 'style',
          target: '.card',
          group: 'rule:.card',
          after: '4px',
          detail: { property: 'padding', value: '4px', selector: '.card', scope: 'stylesheet rule', file: 'theme.css' },
        }),
        record({
          kind: 'insert',
          target: '#grid',
          group: 'ins',
          detail: { html: '<article class="card">\n  <h3>New</h3>\n</article>', position: 'lastChild' },
          source: { file: 'src/page.html', line: 40, column: 3 },
        }),
        record({ kind: 'delete', target: '#old', group: 'del' }),
      ],
      {
        tokens: [{ name: 'brand', value: '#ff0055', group: 'color', origin: 'user' }],
        tokenCSS: ':root {\n  --brand: #ff0055;\n}',
      },
    ),
  );
  process.exit(0);
}

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`prompt: ${passed} passing`);
