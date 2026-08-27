/**
 * Unit tests for build-time source marking.
 *
 * Runs in plain Node: the instrumentation is string-in, string-out by design, which is
 * what makes it testable without a bundler. Run with:
 *
 *     npm run test:instrument
 */
import assert from 'node:assert/strict';
import {
  instrumentHTML,
  instrumentTemplates,
  positionAt,
  scanOpeningTags,
} from '../src/integrations/instrument.ts';

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

const ATTR = 'data-heo-src';

/* -------------------------------------------------------------------------- */
/* HTML                                                                       */
/* -------------------------------------------------------------------------- */

test('every opening tag gets a marker with its own position', () => {
  const out = instrumentHTML('<div>\n  <p>hi</p>\n</div>\n', 'page.html', ATTR);
  assert.match(out, /<div data-heo-src="page\.html:1:1">/);
  assert.match(out, /<p data-heo-src="page\.html:2:3">/);
  assert.ok(!out.includes('</p data-heo-src'), 'closing tags are left alone');
});

test('a tag that already carries a marker is not marked twice', () => {
  const once = instrumentHTML('<div>x</div>', 'page.html', ATTR);
  assert.equal(instrumentHTML(once, 'page.html', ATTR), once);
});

test('a self-closing tag keeps its slash', () => {
  const out = instrumentHTML('<img src="a.png" />', 'p.html', ATTR);
  assert.match(out, /data-heo-src="p\.html:1:1"\/>$/);
  assert.match(out, /^<img src="a\.png"/);
});

test('structural and void tags are skipped', () => {
  const out = instrumentHTML('<head><meta charset="utf-8"><title>t</title></head>', 'p.html', ATTR);
  assert.ok(!out.includes(ATTR));
});

test('a comment is not markup', () => {
  const out = instrumentHTML('<!-- <div> -->\n<p>x</p>', 'p.html', ATTR);
  assert.equal((out.match(/data-heo-src/g) ?? []).length, 1);
  assert.match(out, /<p data-heo-src="p\.html:2:1">/);
});

test('a > inside an attribute value does not end the tag', () => {
  const out = instrumentHTML('<a title="a > b">x</a>', 'p.html', ATTR);
  assert.equal((out.match(/data-heo-src/g) ?? []).length, 1);
  assert.match(out, /<a title="a > b" data-heo-src=/);
});

test('script and style bodies are not scanned', () => {
  const out = instrumentHTML(
    '<script>if (a<b) {}</script>\n<style>.a{color:red}</style>\n<p>x</p>',
    'p.html',
    ATTR,
  );
  assert.equal((out.match(/data-heo-src/g) ?? []).length, 1);
});

test('positions are 1-based and survive CRLF', () => {
  assert.deepEqual(positionAt('ab\ncd', 3), { line: 2, column: 1 });
  assert.deepEqual(positionAt('ab\r\ncd', 4), { line: 2, column: 1 });
});

test('scanOpeningTags reports where an attribute belongs', () => {
  const tags = scanOpeningTags('<div class="a">', ATTR);
  assert.equal(tags.length, 1);
  assert.equal(tags[0].name, 'div');
  assert.equal(tags[0].insertAt, 14, 'just before the closing angle bracket');
});

/* -------------------------------------------------------------------------- */
/* Tagged templates                                                           */
/* -------------------------------------------------------------------------- */

test('tags inside an html template are marked, at their real position', () => {
  const out = instrumentTemplates('render() {\n  return html`<p>hi</p>`;\n}', 'c.ts', ATTR);
  // Column 15: two spaces, `return `, `html\``, then the `<`.
  assert.match(out, /<p data-heo-src="c\.ts:2:15">/);
});

test('interpolations are invisible to the scanner but survive the transform', () => {
  const out = instrumentTemplates('html`<p>${a > b ? c : d}</p>`', 'c.ts', ATTR);
  assert.ok(out.includes('${a > b ? c : d}'), 'the interpolation is untouched');
  assert.equal((out.match(/data-heo-src/g) ?? []).length, 1);
  assert.match(out, /<p data-heo-src=/);
});

test('a nested template is still found', () => {
  const out = instrumentTemplates('html`<ul>${items.map(() => html`<li>x</li>`)}</ul>`', 'c.ts', ATTR);
  assert.match(out, /<ul data-heo-src=/);
  assert.match(out, /<li data-heo-src=/);
});

test('svg templates are covered too', () => {
  assert.match(instrumentTemplates('svg`<circle r="2"/>`', 'c.ts', ATTR), /<circle r="2" data-heo-src=/);
});

test('a file with no templates comes back byte for byte', () => {
  const source = 'export const a = 1;\n';
  assert.equal(instrumentTemplates(source, 'c.ts', ATTR), source);
});

/*
 * The false positive that broke the dev server.
 *
 * `html` at the end of a longer word, most often a file extension, is not a tagged
 * template. Reading it as one made the rest of the file look like template content and
 * injected attributes into the middle of the TypeScript.
 */
test('a file extension in a comment is not a tagged template', () => {
  const source = '// see `styles/site.html` for the markup\nexport const a = 1;\n';
  assert.equal(instrumentTemplates(source, 'c.ts', ATTR), source);
});

test('a file extension in a template literal is not a tagged template', () => {
  const source = 'const p = `a/b.html`;\nconst q = `<div>not markup</div>`;\n';
  assert.equal(instrumentTemplates(source, 'c.ts', ATTR), source);
});

test('property access is not a tagged template', () => {
  const source = 'const s = lit.html`<p>x</p>`;\n';
  // `lit.html` is a member expression, not the bare tag this transform is looking for.
  assert.equal(instrumentTemplates(source, 'c.ts', ATTR), source);
});

test('a longer identifier ending in the tag name is not a tagged template', () => {
  for (const source of ['xhtml`<p>x</p>`', 'myHtml`<p>x</p>`', 'a_html`<p>x</p>`']) {
    assert.equal(instrumentTemplates(source, 'c.ts', ATTR), source, source);
  }
});

test('the real thing still matches after every kind of punctuation', () => {
  for (const source of [
    'html`<p>x</p>`',
    'return html`<p>x</p>`',
    'f(html`<p>x</p>`)',
    '[html`<p>x</p>`]',
    'const a = html`<p>x</p>`',
    '{ a: html`<p>x</p>` }',
    'x ? html`<p>x</p>` : y',
  ]) {
    assert.match(instrumentTemplates(source, 'c.ts', ATTR), /<p data-heo-src=/, source);
  }
});

/* -------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`instrument: ${passed} passing`);
