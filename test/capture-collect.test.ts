/**
 * Unit tests for the capture's pure CSS-text helpers (src/capture/css-text.ts).
 *
 * The browser half (reading sheets, matching, cloning) is covered by test/capture-roundtrip.html.
 * These take strings and return strings, so they are pinned here directly. Run with:
 *
 *     npm run test:capturecollect
 */
import assert from 'node:assert/strict';
import {
  animationNamesIn,
  customPropertiesIn,
  escapeTemplateBraces,
  filterRuleTree,
  fontFamiliesIn,
  hasContainerGroup,
  pickDependencies,
  preferFontSource,
  serializeRuleTree,
  stripUserActionPseudos,
  waapiToCss,
  type RuleNode,
} from '../src/capture/css-text.ts';

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

/* -------------------------------------------------------------------------- */
/* stripUserActionPseudos                                                      */
/* -------------------------------------------------------------------------- */

test('a hover rule is asked about the element it will style', () => {
  assert.equal(stripUserActionPseudos('a:hover'), 'a');
  assert.equal(stripUserActionPseudos('.btn:focus-visible:active'), '.btn');
});
test('pseudo-elements, both spellings, go too', () => {
  assert.equal(stripUserActionPseudos('.x::before'), '.x');
  assert.equal(stripUserActionPseudos('.x:after'), '.x');
  assert.equal(stripUserActionPseudos('input::placeholder'), 'input');
});
test('an emptied compound becomes a universal one, keeping the combinator meaning', () => {
  assert.equal(stripUserActionPseudos('.card :hover'), '.card *');
  assert.equal(stripUserActionPseudos(':focus-within > .x'), '* > .x');
});
test('inside :is() the argument list is stripped too', () => {
  assert.equal(stripUserActionPseudos(':is(a:hover, b)'), ':is(a, b)');
});
test('quoted and attribute text is left alone', () => {
  assert.equal(stripUserActionPseudos('[data-x=":hover"]'), '[data-x=":hover"]');
  assert.equal(stripUserActionPseudos('[title=":focus"]:hover'), '[title=":focus"]');
});
test('structural pseudo-classes stay', () => {
  assert.equal(stripUserActionPseudos('li:nth-child(2n+1):not(.x)'), 'li:nth-child(2n+1):not(.x)');
});

/* -------------------------------------------------------------------------- */
/* filterRuleTree / serializeRuleTree                                          */
/* -------------------------------------------------------------------------- */

const tree: RuleNode[] = [
  { kind: 'style', selector: '.a', declarations: 'color: red;' },
  { kind: 'keyframes', name: 'fade', text: '@keyframes fade { from { opacity: 0; } }' },
  {
    kind: 'group',
    prelude: '@media (max-width: 600px)',
    children: [
      { kind: 'style', selector: '.b', declarations: 'color: blue;' },
      { kind: 'style', selector: '.a', declarations: 'color: green;' },
    ],
  },
  { kind: 'group', prelude: '@supports (display: grid)', children: [{ kind: 'style', selector: '.b', declarations: 'x: 1;' }] },
  {
    kind: 'group',
    prelude: '@container (min-width: 300px)',
    children: [{ kind: 'group', prelude: '@layer x', children: [{ kind: 'style', selector: '.a', declarations: 'y: 2;' }] }],
  },
  { kind: 'style', selector: '.a:hover', declarations: 'color: pink;' },
];

test('groups with kept rules keep their prelude, empty ones disappear, order holds', () => {
  const kept = filterRuleTree(tree, (selector) => stripUserActionPseudos(selector) === '.a');
  assert.equal(
    serializeRuleTree(kept),
    [
      '.a { color: red; }',
      '@media (max-width: 600px) {\n.a { color: green; }\n}',
      '@container (min-width: 300px) {\n@layer x {\n.a { y: 2; }\n}\n}',
      '.a:hover { color: pink; }',
    ].join('\n'),
  );
});
test('a nested @container is found', () => {
  const kept = filterRuleTree(tree, (selector) => selector === '.a');
  assert.equal(hasContainerGroup(kept), true);
  assert.equal(hasContainerGroup(filterRuleTree(tree, (selector) => selector === '.b')), false);
});

/* -------------------------------------------------------------------------- */
/* Dependencies                                                                */
/* -------------------------------------------------------------------------- */

test('animation names come from the shorthand and the longhand, keywords skipped', () => {
  assert.deepEqual(
    animationNamesIn('animation: 1s ease-in infinite slide-in, fade 2s; animation-name: spin, none'),
    ['spin', 'slide-in', 'fade'],
  );
  assert.deepEqual(animationNamesIn('animation: none'), []);
  assert.deepEqual(animationNamesIn('animation: 1s cubic-bezier(0.1, 0.7, 1, 0.1) pulse'), ['pulse']);
});
test('font families are unquoted and generics dropped', () => {
  assert.deepEqual(fontFamiliesIn('"Inter Var", Inter, system-ui, sans-serif'), ['Inter Var', 'Inter']);
});
test('only the keyframes and faces in use are picked, from inside groups too', () => {
  const nodes: RuleNode[] = [
    { kind: 'keyframes', name: 'fade', text: '@keyframes fade {}' },
    { kind: 'keyframes', name: 'unused', text: '@keyframes unused {}' },
    { kind: 'font-face', family: 'Inter', text: '@font-face { font-family: Inter; }' },
    { kind: 'font-face', family: 'Other', text: '@font-face { font-family: Other; }' },
    { kind: 'group', prelude: '@media print', children: [{ kind: 'keyframes', name: 'spin', text: '@keyframes spin {}' }] },
  ];
  const picked = pickDependencies(nodes, { animationNames: ['fade', 'spin'], fontFamilies: ['inter'] });
  assert.deepEqual(picked.map((node) => ('name' in node ? node.name : 'family' in node ? node.family : '')), ['fade', 'Inter', 'spin']);
});
test('the later of two keyframes with one name is the one kept', () => {
  const nodes: RuleNode[] = [
    { kind: 'keyframes', name: 'fade', text: 'first' },
    { kind: 'keyframes', name: 'fade', text: 'second' },
  ];
  const picked = pickDependencies(nodes, { animationNames: ['fade'], fontFamilies: [] });
  assert.deepEqual(picked.map((node) => ('text' in node ? node.text : '')), ['second']);
});
test('var() names are found, nested fallbacks included', () => {
  assert.deepEqual(
    customPropertiesIn('.a { color: var(--fg, var(--fallback-fg)); padding: var( --gap ); }'),
    ['--fg', '--fallback-fg', '--gap'],
  );
});
test('a font face keeps only its woff2 source, and no local()', () => {
  assert.equal(
    preferFontSource('@font-face { font-family: X; src: local("X"), url("a.woff") format("woff"), url("a.woff2") format("woff2"); }'),
    '@font-face { font-family: X; src: url("a.woff2") format("woff2"); }',
  );
  assert.equal(
    preferFontSource('@font-face { src: url(a.ttf); }'),
    '@font-face { src: url(a.ttf); }',
  );
});

/* -------------------------------------------------------------------------- */
/* WAAPI and markup                                                            */
/* -------------------------------------------------------------------------- */

test('a script animation becomes keyframes and an animation value', () => {
  const out = waapiToCss(
    'heo-waapi-1',
    [
      { offset: null, computedOffset: 0, easing: 'linear', composite: 'auto', opacity: '0', transform: 'translateY(10px)' },
      { offset: null, computedOffset: 1, easing: 'linear', composite: 'auto', opacity: '1', cssFloat: 'left', backgroundColor: 'red' },
    ],
    { duration: 600, delay: 50, iterations: Infinity, direction: 'alternate', fill: 'forwards', easing: 'ease-out' },
  );
  assert.equal(
    out.keyframes,
    '@keyframes heo-waapi-1 {\n  0% { opacity: 0; transform: translateY(10px); }\n  100% { opacity: 1; float: left; background-color: red; }\n}',
  );
  assert.equal(out.animation, 'heo-waapi-1 600ms ease-out 50ms infinite alternate forwards');
});
test('offsets are spaced evenly when none were given', () => {
  const out = waapiToCss('n', [{ opacity: '0' }, { opacity: '0.5' }, { opacity: '1' }], { duration: 100 });
  assert.match(out.keyframes, /0% \{ opacity: 0; \}\n {2}50% \{ opacity: 0\.5; \}\n {2}100% \{ opacity: 1; \}/);
  assert.equal(out.animation, 'n 100ms linear 0ms 1 normal none');
});
test('{{ in page text is escaped so it cannot become a block prop', () => {
  assert.equal(escapeTemplateBraces('<p>{{ price }}</p>'), '<p>&#123;&#123; price }}</p>');
  assert.equal(escapeTemplateBraces('<p>{a} {{{x}}}</p>'), '<p>{a} &#123;&#123;&#123;x}}}</p>');
});

if (failures.length) {
  console.error(`capture-collect: ${failures.length} failed, ${passed} passed\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`capture-collect: ${passed} passing`);
