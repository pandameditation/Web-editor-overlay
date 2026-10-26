/**
 * Unit tests for the pure string helpers behind block CSS.
 *
 * The scoping itself uses the browser's CSS parser and is covered by `test/block-css-scope.html`.
 * These four take strings and return strings, so they are pinned here directly. Run with:
 *
 *     npm run test:blockcss
 */
import assert from 'node:assert/strict';
import { blockIdsReferencedByCSS, splitTopLevel } from '../src/core/block-css.ts';
import {
  BLOCK_STYLE_END,
  BLOCK_STYLE_START,
  STYLE_BLOCK_END,
  STYLE_BLOCK_START,
  stripBlockChunksFromDesignSystemRegion,
  upsertBlockStyleBlock,
} from '../src/core/html-patch.ts';

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}
const count = (text: string, needle: string): number => text.split(needle).length - 1;

/* -------------------------------------------------------------------------- */
/* splitTopLevel                                                               */
/* -------------------------------------------------------------------------- */

test('declarations with no selector are split from the rules', () => {
  // The parser drops a declaration that precedes a rule together with that rule.
  const split = splitTopLevel('color: red; p { background-color: blue; } margin: 0');
  assert.equal(split.declarations, 'color: red; margin: 0;');
  assert.equal(split.rules, 'p { background-color: blue; }');
  assert.equal(split.droppedCharset, false);
});

test('the user case: one bare declaration and nothing else', () => {
  const split = splitTopLevel('background-color: blue;');
  assert.equal(split.declarations, 'background-color: blue;');
  assert.equal(split.rules, '');
});

test('semicolons inside strings, parens, comments and blocks do not split', () => {
  const split = splitTopLevel(
    'content: "a;b"; background: url(x;y.png); /* c; d */ p { color: red; } @media (x) { p { color: blue; } }',
  );
  assert.equal(split.declarations, 'content: "a;b"; background: url(x;y.png);');
  assert.equal(split.rules, '/* c; d */ p { color: red; }\n@media (x) { p { color: blue; } }');
});

test('@charset, @import and @namespace are dropped and reported', () => {
  const split = splitTopLevel('@charset "utf-8"; @import url(x.css); @namespace svg url(y); p { color: red }');
  assert.equal(split.droppedCharset, true);
  assert.equal(split.droppedImports, true);
  assert.equal(split.rules, 'p { color: red }');
  assert.equal(split.declarations, '');
});

test('other at-rule statements stay with the rules', () => {
  const split = splitTopLevel('@layer base, theme; color: red;');
  assert.equal(split.rules, '@layer base, theme;');
  assert.equal(split.declarations, 'color: red;');
});

test('an unbalanced block keeps the tail as rules text, for the parser to drop', () => {
  const split = splitTopLevel('color: red; p { color: blue;');
  assert.equal(split.declarations, 'color: red;');
  assert.equal(split.rules, 'p { color: blue;');
});

/* -------------------------------------------------------------------------- */
/* blockIdsReferencedByCSS                                                     */
/* -------------------------------------------------------------------------- */

test('ids are read from block and part hooks, escapes undone', () => {
  const ids = blockIdsReferencedByCSS([
    'p:is([data-heo-block="card"], [data-heo-block-part="card"]) { color: red }',
    '[data-heo-block="we\\"ird\\\\id"] p { color: red }',
    ':is([data-heo-block], [data-heo-block-part]) { color: red }',
  ]);
  assert.deepEqual([...ids].sort(), ['card', 'we"ird\\id']);
});

/* -------------------------------------------------------------------------- */
/* upsertBlockStyleBlock                                                       */
/* -------------------------------------------------------------------------- */

const PAGE = '<!DOCTYPE html>\n<html>\n<head>\n  <title>x</title>\n</head>\n<body>\n  <p>x</p>\n</body>\n</html>\n';

test('a region is inserted in <head> holding the adoptable style', () => {
  const out = upsertBlockStyleBlock(PAGE, 'p { color: red; }');
  assert.equal(count(out, BLOCK_STYLE_START), 1);
  assert.ok(out.includes('<style id="heo-block-styles">'));
  assert.ok(out.indexOf(BLOCK_STYLE_END) < out.indexOf('</head>'));
  // The second write of the same CSS produces the same bytes.
  assert.equal(upsertBlockStyleBlock(out, 'p { color: red; }'), out);
});

test('the region is replaced, and dropped when the CSS is empty', () => {
  const first = upsertBlockStyleBlock(PAGE, 'p { color: red; }');
  const second = upsertBlockStyleBlock(first, 'p { color: blue; }');
  assert.equal(count(second, BLOCK_STYLE_START), 1);
  assert.ok(second.includes('color: blue') && !second.includes('color: red'));
  assert.equal(upsertBlockStyleBlock(second, ''), PAGE);
});

test('an unmarked copy from an export is replaced in place', () => {
  const exported = PAGE.replace('</head>', '  <style id="heo-block-styles">old</style>\n</head>');
  const out = upsertBlockStyleBlock(exported, 'p { color: red; }');
  assert.equal(count(out, 'id="heo-block-styles"'), 1);
  assert.equal(count(out, BLOCK_STYLE_START), 1);
  assert.ok(!out.includes('old'));
});

test('a stray copy beside the markers goes, and both go on an empty write', () => {
  const marked = upsertBlockStyleBlock(PAGE, 'p { color: red; }');
  const stray = marked.replace('</head>', "  <style id='heo-block-styles'>stray</style>\n</head>");
  const out = upsertBlockStyleBlock(stray, 'p { color: blue; }');
  assert.equal(count(out, 'heo-block-styles'), 1);
  assert.ok(!out.includes('stray'));
  const emptied = upsertBlockStyleBlock(stray, '');
  assert.equal(emptied, PAGE);
});

test('a tag spelled out in a comment or a script is not a copy', () => {
  const page = PAGE.replace(
    '</head>',
    '  <!-- <style id="heo-block-styles">c</style> -->\n  <script>const t = \'<style id="heo-block-styles">s</style>\';</script>\n</head>',
  );
  const out = upsertBlockStyleBlock(page, 'p { color: red; }');
  assert.ok(out.includes('<style id="heo-block-styles">c</style>'));
  assert.ok(out.includes('<style id="heo-block-styles">s</style>'));
  assert.equal(count(out, BLOCK_STYLE_START), 1);
});

/* -------------------------------------------------------------------------- */
/* stripBlockChunksFromDesignSystemRegion                                      */
/* -------------------------------------------------------------------------- */

const designRegion = (css: string): string =>
  PAGE.replace(
    '</head>',
    `  ${STYLE_BLOCK_START}\n  <style>\n${css.split('\n').map((line) => `    ${line}`).join('\n')}\n  </style>\n  ${STYLE_BLOCK_END}\n</head>`,
  );

test('stripBlockChunksLeavesTokenCssIntact', () => {
  const page = designRegion(':root {\n  --gap: 8px;\n}\n\n/* block: card */\np:is([data-heo-block="card"]) { color: red; }');
  const out = stripBlockChunksFromDesignSystemRegion(page);
  assert.ok(out.includes('--gap: 8px;'));
  assert.ok(!out.includes('data-heo-block'));
  assert.equal(out, designRegion(':root {\n  --gap: 8px;\n}'));
});

test('a design-system region holding only block CSS is dropped', () => {
  const page = designRegion('/* block: card */\np:is([data-heo-block="card"]) { color: red; }');
  assert.equal(stripBlockChunksFromDesignSystemRegion(page), PAGE);
});

test('a page with no region, or a region with no block chunk, is left alone', () => {
  assert.equal(stripBlockChunksFromDesignSystemRegion(PAGE), PAGE);
  const tokensOnly = designRegion(':root { --gap: 8px; }');
  assert.equal(stripBlockChunksFromDesignSystemRegion(tokensOnly), tokensOnly);
});

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`block-css: ${passed} passing`);
