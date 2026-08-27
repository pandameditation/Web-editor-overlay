/**
 * Unit tests for the CSS text patcher.
 *
 * Runs in plain Node — the module touches no DOM, which is the point of keeping the
 * scanner separate from the CSSOM. Run with:
 *
 *     npm run test:css
 */
import assert from 'node:assert/strict';
import {
  diffCSS,
  normalizeSelector,
  patchCSS,
  upsertSection,
  type DeclarationPatch,
} from '../src/core/css-patch.ts';

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

const patch = (over: Partial<DeclarationPatch>): DeclarationPatch => ({
  selector: '.card',
  property: 'padding',
  value: '40px',
  ...over,
});

/* -------------------------------------------------------------------------- */
/* The headline promise: a one-line edit is a one-line diff                     */
/* -------------------------------------------------------------------------- */

const FIXTURE = `/* A comment that must survive. */
.card {
  padding: 16px;          /* trailing note */
  border-radius: 12px;
  background: #fff;
}

/* Another comment. */
.card h2 {
  margin: 0;
}
`;

test('replacing a value leaves every other byte alone', () => {
  const { css, applied, failed } = patchCSS(FIXTURE, [patch({})]);
  assert.equal(applied, 1);
  assert.deepEqual(failed, []);
  assert.equal(css, FIXTURE.replace('padding: 16px;', 'padding: 40px;'));
  // Spelled out, because these are the things a re-serialization destroys.
  assert.ok(css.includes('/* A comment that must survive. */'));
  assert.ok(css.includes('/* trailing note */'));
  assert.ok(css.includes('background: #fff;'), 'colour notation is untouched');
  assert.ok(css.includes('margin: 0;'), 'unitless zero is untouched');
});

test('a value with a var() reference is written verbatim', () => {
  const { css } = patchCSS(FIXTURE, [patch({ value: 'var(--space-xl)' })]);
  assert.ok(css.includes('padding: var(--space-xl);'));
});

test('adding a property matches the indentation already in the block', () => {
  const tabs = '.card {\n\tpadding: 16px;\n}\n';
  const { css } = patchCSS(tabs, [patch({ property: 'color', value: 'red' })]);
  assert.equal(css, '.card {\n\tpadding: 16px;\n\tcolor: red;\n}\n');
});

test('adding a property to an empty block opens the block up', () => {
  const { css } = patchCSS('.card {}\n', [patch({ property: 'color', value: 'red' })]);
  assert.equal(css, '.card {\n  color: red;\n}\n');
});

test('a final declaration with no semicolon gets one before anything follows it', () => {
  const { css } = patchCSS('.card {\n  padding: 16px\n}\n', [
    patch({ property: 'color', value: 'red' }),
  ]);
  assert.equal(css, '.card {\n  padding: 16px;\n  color: red;\n}\n');
});

test('an empty value removes the declaration and its line', () => {
  const { css } = patchCSS(FIXTURE, [patch({ property: 'border-radius', value: '' })]);
  assert.ok(!css.includes('border-radius'));
  assert.ok(!/\n\s*\n\s*background/.test(css), 'no orphaned blank line is left behind');
  assert.ok(css.includes('padding: 16px;'));
  assert.ok(css.includes('background: #fff;'));
});

test('removing a declaration takes its trailing comment with it', () => {
  const { css } = patchCSS(FIXTURE, [patch({ value: '' })]);
  assert.ok(!css.includes('padding'));
  assert.ok(!css.includes('trailing note'));
  assert.ok(css.includes('/* A comment that must survive. */'));
});

test('a rule the file does not have is appended rather than guessed at', () => {
  const { css, failed } = patchCSS(FIXTURE, [patch({ selector: '.brand-new', value: '8px' })]);
  assert.deepEqual(failed, []);
  assert.ok(css.startsWith(FIXTURE.trimEnd()));
  assert.ok(css.includes('.brand-new {\n  padding: 8px;\n}'));
});

test('removing a property from a rule that has neither is a no-op, not a failure', () => {
  const { css, failed } = patchCSS(FIXTURE, [patch({ selector: '.absent', value: '' })]);
  assert.equal(css, FIXTURE);
  assert.deepEqual(failed, []);
});

/* -------------------------------------------------------------------------- */
/* Priority                                                                    */
/* -------------------------------------------------------------------------- */

test('important is written as priority, not folded into the value', () => {
  const { css } = patchCSS('.card {\n  padding: 16px;\n}\n', [
    patch({ priority: 'important' }),
  ]);
  assert.equal(css, '.card {\n  padding: 40px !important;\n}\n');
});

test('replacing the value of an important declaration does not duplicate the bang', () => {
  const { css } = patchCSS('.card {\n  padding: 16px !important;\n}\n', [patch({})]);
  assert.equal(css, '.card {\n  padding: 40px;\n}\n');
});

test('important survives when it is asked for again', () => {
  const { css } = patchCSS('.card {\n  padding: 16px !important;\n}\n', [
    patch({ priority: 'important' }),
  ]);
  assert.equal(css, '.card {\n  padding: 40px !important;\n}\n');
});

/* -------------------------------------------------------------------------- */
/* Things that defeat a naive brace count                                      */
/* -------------------------------------------------------------------------- */

test('a brace inside a string is not structure', () => {
  const source = '.a::before {\n  content: "}";\n  color: red;\n}\n\n.card {\n  padding: 16px;\n}\n';
  const { css, failed } = patchCSS(source, [patch({})]);
  assert.deepEqual(failed, []);
  assert.ok(css.includes('padding: 40px;'));
  assert.ok(css.includes('content: "}";'));
});

test('a brace inside an unquoted url() is not structure', () => {
  const source = '.a {\n  background: url(a{b.png);\n}\n\n.card {\n  padding: 16px;\n}\n';
  const { css, failed } = patchCSS(source, [patch({})]);
  assert.deepEqual(failed, []);
  assert.ok(css.includes('padding: 40px;'));
  assert.ok(css.includes('url(a{b.png)'));
});

test('a brace inside a comment is not structure', () => {
  const source = '/* } */\n.card {\n  padding: 16px;\n}\n';
  const { css, failed } = patchCSS(source, [patch({})]);
  assert.deepEqual(failed, []);
  assert.ok(css.includes('padding: 40px;'));
});

test('a commented-out declaration is not the one that gets patched', () => {
  const source = '.card {\n  /* padding: 1px; */\n  padding: 16px;\n}\n';
  const { css } = patchCSS(source, [patch({})]);
  assert.equal(css, '.card {\n  /* padding: 1px; */\n  padding: 40px;\n}\n');
});

/* -------------------------------------------------------------------------- */
/* At-rules and context                                                        */
/* -------------------------------------------------------------------------- */

const MEDIA = `.card {
  padding: 16px;
}

@media (min-width: 40em) {
  .card {
    padding: 24px;
  }
}
`;

test('context picks the rule inside the media query, not the one outside it', () => {
  const { css } = patchCSS(MEDIA, [
    patch({ context: ['@media (min-width: 40em)'], value: '64px' }),
  ]);
  assert.ok(css.includes('padding: 16px;'), 'the top-level rule is untouched');
  assert.ok(css.includes('padding: 64px;'));
});

test('no context picks the top-level rule', () => {
  const { css } = patchCSS(MEDIA, [patch({ value: '64px' })]);
  assert.ok(css.includes('padding: 64px;'));
  assert.ok(css.includes('padding: 24px;'), 'the media query rule is untouched');
});

test('a rule added inside a media query is indented for its context', () => {
  const { css } = patchCSS(MEDIA, [
    patch({ selector: '.new', context: ['@media (min-width: 40em)'], value: '8px' }),
  ]);
  assert.ok(css.includes('  .new {\n    padding: 8px;\n  }'), css);
});

test('a missing context is reported rather than written to the wrong place', () => {
  const { css, applied, failed } = patchCSS(MEDIA, [
    patch({ selector: '.new', context: ['@media print'], value: '8px' }),
  ]);
  assert.equal(css, MEDIA);
  assert.equal(applied, 0);
  assert.equal(failed.length, 1);
  assert.match(failed[0].reason, /@media print/);
});

test('an @import before the rules does not shift the position locator', () => {
  const source = "@import url('reset.css');\n\n.card {\n  padding: 16px;\n}\n";
  // `.card` is rule index 1, because the @import is a rule too.
  const { css, failed } = patchCSS(source, [patch({ path: [1] })]);
  assert.deepEqual(failed, []);
  assert.ok(css.includes('padding: 40px;'));
});

/* -------------------------------------------------------------------------- */
/* Duplicate selectors                                                         */
/* -------------------------------------------------------------------------- */

const TWICE = '.card {\n  padding: 1px;\n}\n\n.card {\n  padding: 2px;\n}\n';

test('the position locator tells two identical selectors apart', () => {
  const { css } = patchCSS(TWICE, [patch({ path: [1], value: '9px' })]);
  assert.equal(css, '.card {\n  padding: 1px;\n}\n\n.card {\n  padding: 9px;\n}\n');
});

test('occurrence tells them apart without a position', () => {
  const { css } = patchCSS(TWICE, [patch({ occurrence: 1, value: '9px' })]);
  assert.equal(css, '.card {\n  padding: 1px;\n}\n\n.card {\n  padding: 9px;\n}\n');
});

test('a position pointing at the wrong selector falls back to the selector', () => {
  // path [0] is `.other`, so the index is stale; the selector still finds `.card`.
  const source = '.other {\n  color: red;\n}\n\n.card {\n  padding: 16px;\n}\n';
  const { css, failed } = patchCSS(source, [patch({ path: [0] })]);
  assert.deepEqual(failed, []);
  assert.ok(css.includes('padding: 40px;'));
  assert.ok(css.includes('color: red;'), 'the rule at the stale index is not touched');
});

/* -------------------------------------------------------------------------- */
/* Selector spelling                                                           */
/* -------------------------------------------------------------------------- */

test('the file and the CSSOM can spell a selector differently', () => {
  const source = '.a>.b,\n.c {\n  padding: 16px;\n}\n';
  const { css, failed } = patchCSS(source, [patch({ selector: '.a > .b, .c' })]);
  assert.deepEqual(failed, []);
  assert.ok(css.includes('padding: 40px;'));
});

test('normalizeSelector matches what the CSSOM reports', () => {
  assert.equal(normalizeSelector('.a>.b'), '.a > .b');
  assert.equal(normalizeSelector('.a  .b'), '.a .b');
  assert.equal(normalizeSelector('.a,\n\t.b'), '.a, .b');
  assert.equal(normalizeSelector('  .a + .b  '), '.a + .b');
  assert.equal(normalizeSelector('li:nth-child(2n+1)'), 'li:nth-child(2n+1)');
  assert.equal(normalizeSelector('a[href~="x"]'), 'a[href~="x"]');
  assert.equal(normalizeSelector('a[ href ~= "x" ]'), 'a[ href ~= "x" ]');
});

test('a descendant selector is never collapsed into a compound one', () => {
  assert.notEqual(normalizeSelector('.a .b'), normalizeSelector('.a.b'));
});

/* -------------------------------------------------------------------------- */
/* Nesting                                                                     */
/* -------------------------------------------------------------------------- */

test('a nested rule is not mistaken for a declaration of its parent', () => {
  const source = '.card {\n  padding: 16px;\n\n  &:hover {\n    padding: 99px;\n  }\n}\n';
  const { css } = patchCSS(source, [patch({})]);
  assert.equal(css, '.card {\n  padding: 40px;\n\n  &:hover {\n    padding: 99px;\n  }\n}\n');
});

test('a declaration after a nested rule is still found', () => {
  const source = '.card {\n  &:hover {\n    color: red;\n  }\n\n  padding: 16px;\n}\n';
  const { css } = patchCSS(source, [patch({})]);
  assert.ok(css.includes('padding: 40px;'));
  assert.ok(css.includes('color: red;'));
});

/* -------------------------------------------------------------------------- */
/* Custom properties                                                           */
/* -------------------------------------------------------------------------- */

test('custom properties are matched case-sensitively', () => {
  const source = ':root {\n  --Accent: red;\n  --accent: blue;\n}\n';
  const { css } = patchCSS(source, [
    patch({ selector: ':root', property: '--accent', value: 'green' }),
  ]);
  assert.equal(css, ':root {\n  --Accent: red;\n  --accent: green;\n}\n');
});

test('ordinary properties are matched case-insensitively', () => {
  const { css } = patchCSS('.card {\n  PADDING: 16px;\n}\n', [patch({})]);
  assert.equal(css, '.card {\n  PADDING: 40px;\n}\n');
});

/* -------------------------------------------------------------------------- */
/* Several patches at once                                                     */
/* -------------------------------------------------------------------------- */

test('two patches to one rule both land', () => {
  const { css, applied } = patchCSS(FIXTURE, [
    patch({}),
    patch({ property: 'color', value: 'red' }),
  ]);
  assert.equal(applied, 2);
  assert.ok(css.includes('padding: 40px;'));
  assert.ok(css.includes('color: red;'));
  assert.ok(css.includes('/* trailing note */'));
});

test('patches to different rules do not disturb each other', () => {
  const { css, applied } = patchCSS(FIXTURE, [
    patch({}),
    patch({ selector: '.card h2', property: 'margin', value: '8px' }),
  ]);
  assert.equal(applied, 2);
  assert.ok(css.includes('padding: 40px;'));
  assert.ok(css.includes('margin: 8px;'));
});

/* -------------------------------------------------------------------------- */
/* The managed section                                                         */
/* -------------------------------------------------------------------------- */

test('a section is appended once and replaced thereafter', () => {
  const once = upsertSection(FIXTURE, ':root { --new: 1px; }');
  assert.ok(once.includes('--new: 1px;'));
  assert.ok(once.startsWith(FIXTURE.trimEnd()));

  const twice = upsertSection(once, ':root { --new: 2px; }');
  assert.ok(twice.includes('--new: 2px;'));
  assert.ok(!twice.includes('--new: 1px;'));
  assert.equal(
    twice.split('heo:design-system start').length - 1,
    1,
    'saving twice must not stack two sections',
  );
});

test('an emptied section leaves the file as it started', () => {
  const once = upsertSection(FIXTURE, ':root { --new: 1px; }');
  const back = upsertSection(once, '');
  assert.ok(!back.includes('heo:design-system'));
  assert.equal(back.trimEnd(), FIXTURE.trimEnd());
});

test('a section written into an empty file does not start with blank lines', () => {
  assert.ok(!upsertSection('', ':root { --a: 1px; }').startsWith('\n'));
});

/* -------------------------------------------------------------------------- */
/* Diffing, which is what the save prompt describes                            */
/* -------------------------------------------------------------------------- */

test('a changed value is one change, directionally', () => {
  const changes = diffCSS('.card {\n  padding: 16px;\n}\n', '.card {\n  padding: 40px;\n}\n');
  assert.deepEqual(changes, [
    { kind: 'set', selector: '.card', context: [], property: 'padding', from: '16px', to: '40px' },
  ]);
});

test('an added declaration reports no previous value', () => {
  const changes = diffCSS('.card {\n  padding: 16px;\n}\n', '.card {\n  padding: 16px;\n  color: red;\n}\n');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'set');
  assert.ok(!('from' in changes[0]), 'a new declaration has nothing to change from');
});

test('a removed declaration is reported with what it held', () => {
  const changes = diffCSS('.card {\n  padding: 16px;\n  color: red;\n}\n', '.card {\n  padding: 16px;\n}\n');
  assert.deepEqual(changes, [
    { kind: 'remove', selector: '.card', context: [], property: 'color', from: 'red' },
  ]);
});

test('reformatting is not a change', () => {
  const before = '/* a note */\n.card {\n  padding: 16px;\n  color: red;\n}\n';
  const after = '.card{padding:16px;color:red}';
  assert.deepEqual(diffCSS(before, after), []);
});

test('rewriting a comment is not a change', () => {
  const before = '/* old note */\n.card { padding: 16px; }\n';
  const after = '/* a completely different note */\n.card { padding: 16px; }\n';
  assert.deepEqual(diffCSS(before, after), []);
});

test('reordering declarations within a rule is not a change', () => {
  const before = '.card { padding: 1px; color: red; }';
  const after = '.card { color: red; padding: 1px; }';
  assert.deepEqual(diffCSS(before, after), []);
});

test('a new rule arrives with its declarations', () => {
  const changes = diffCSS('.a { color: red; }', '.a { color: red; }\n.b { padding: 2px; margin: 0; }');
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0], {
    kind: 'add-rule',
    selector: '.b',
    context: [],
    declarations: [
      { property: 'padding', value: '2px' },
      { property: 'margin', value: '0' },
    ],
  });
});

test('a deleted rule is reported last, with what it held', () => {
  const changes = diffCSS('.a { color: red; }\n.b { padding: 2px; }', '.a { color: blue; }');
  assert.equal(changes.length, 2);
  assert.equal(changes[0].kind, 'set', 'changes come before deletions');
  assert.equal(changes[1].kind, 'remove-rule');
});

test('a rule inside a media query carries it as context', () => {
  const before = '@media (min-width: 40em) {\n  .card { padding: 24px; }\n}\n';
  const after = '@media (min-width: 40em) {\n  .card { padding: 48px; }\n}\n';
  const changes = diffCSS(before, after);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].context, ['@media (min-width: 40em)']);
});

test('the same selector inside and outside a media query is not confused', () => {
  const before = '.card { padding: 1px; }\n@media print {\n  .card { padding: 2px; }\n}\n';
  const after = '.card { padding: 1px; }\n@media print {\n  .card { padding: 9px; }\n}\n';
  const changes = diffCSS(before, after);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].context, ['@media print']);
  assert.equal(changes[0].kind === 'set' && changes[0].from, '2px');
});

test('two rules with the same selector are told apart by position', () => {
  const before = '.card { padding: 1px; }\n.card { padding: 2px; }';
  const after = '.card { padding: 1px; }\n.card { padding: 9px; }';
  const changes = diffCSS(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind === 'set' && changes[0].from, '2px');
});

test('a nested rule carries its parent as context', () => {
  const before = '.card {\n  padding: 1px;\n  &:hover { color: red; }\n}\n';
  const after = '.card {\n  padding: 1px;\n  &:hover { color: blue; }\n}\n';
  const changes = diffCSS(before, after);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].context, ['.card']);
});

test('adding a whole media block reads as adding the rules inside it', () => {
  const changes = diffCSS('.a { color: red; }', '.a { color: red; }\n@media print {\n  .a { color: black; }\n}\n');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'add-rule');
  assert.deepEqual(changes[0].context, ['@media print']);
});

test('an @import is tracked even though it has no declarations', () => {
  const changes = diffCSS('.a { color: red; }', "@import url('reset.css');\n.a { color: red; }");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'add-rule');
  assert.match(changes[0].selector, /@import/);
});

test('gaining or losing !important is a change', () => {
  const gained = diffCSS('.a { color: red; }', '.a { color: red !important; }');
  assert.equal(gained.length, 1);
  assert.equal(gained[0].kind === 'set' && gained[0].to, 'red !important');
  assert.deepEqual(diffCSS('.a { color: red !important; }', '.a { color: red !important; }'), []);
});

test('custom properties are compared case-sensitively, others are not', () => {
  assert.deepEqual(diffCSS('.a { COLOR: red; }', '.a { color: red; }'), []);
  assert.equal(diffCSS(':root { --a: 1px; }', ':root { --A: 1px; }').length, 2);
});

test('an unchanged file yields nothing', () => {
  assert.deepEqual(diffCSS(FIXTURE, FIXTURE), []);
});

test('a whole-file rewrite still comes back as a diff, however long', () => {
  const before = Array.from({ length: 30 }, (_, i) => `.r${i} { padding: ${i}px; }`).join('\n');
  const after = Array.from({ length: 30 }, (_, i) => `.r${i} { padding: ${i + 1}px; }`).join('\n');
  // Deciding that 30 changes is too many to read belongs to the prompt, not here.
  assert.equal(diffCSS(before, after).length, 30);
});

/* -------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`css-patch: ${passed} passing`);
