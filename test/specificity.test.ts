/**
 * Unit tests for `src/core/specificity.ts`.
 *
 * Each expectation is what the browser decides, not what a quick count would say: the cases are
 * the ones the old `ids × 100 + classes × 10` number got wrong. Run with:
 *
 *     npm run test:specificity
 */
import assert from 'node:assert/strict';
import {
  compareSpecificity,
  specificityNumber,
  specificityOf,
} from '../src/core/specificity.ts';

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

const of = (selector: string): number[] => [...specificityOf(selector)];

test('ids, classes and types are counted separately', () => {
  assert.deepEqual(of('#main'), [1, 0, 0]);
  assert.deepEqual(of('.card'), [0, 1, 0]);
  assert.deepEqual(of('p'), [0, 0, 1]);
  assert.deepEqual(of('section p'), [0, 0, 2]);
  assert.deepEqual(of('.promo .card'), [0, 2, 0]);
  assert.deepEqual(of('.card.featured'), [0, 2, 0]);
  assert.deepEqual(of('#a .b > c + d ~ e'), [1, 1, 3]);
  assert.deepEqual(of('*'), [0, 0, 0]);
  assert.deepEqual(of('ul li a:hover'), [0, 1, 3]);
});

test('eleven classes still lose to one id', () => {
  // The bug in the old number: 11 × 10 = 110 beat 1 × 100.
  const classes = specificityOf('.a.b.c.d.e.f.g.h.i.j.k');
  assert.deepEqual([...classes], [0, 11, 0]);
  assert.ok(compareSpecificity(specificityOf('#x'), classes) > 0);
});

test(':is, :not and :has take their most specific argument', () => {
  assert.deepEqual(of(':is(#isx, .isy)'), [1, 0, 0]);
  assert.deepEqual(of(':not(.a, p)'), [0, 1, 0]);
  assert.deepEqual(of('a:has(> img, #hero)'), [1, 0, 1]);
  assert.ok(compareSpecificity(specificityOf(':is(#isx, .isy)'), specificityOf('.isy.isy')) > 0);
});

test(':where counts nothing', () => {
  assert.deepEqual(of(':where(.w) p'), [0, 0, 1]);
  assert.deepEqual(of(':where(#a, .b)'), [0, 0, 0]);
  assert.ok(compareSpecificity(specificityOf('.z p'), specificityOf(':where(.w) p')) > 0);
});

test('pseudo-elements count as types, in either spelling', () => {
  assert.deepEqual(of('.card::before'), [0, 1, 1]);
  assert.deepEqual(of('.card:before'), [0, 1, 1]);
  assert.deepEqual(of('p::first-line'), [0, 0, 2]);
  assert.deepEqual(of('li::marker'), [0, 0, 2]);
  assert.deepEqual(of('.card:hover::after'), [0, 2, 1]);
});

test('attribute selectors and pseudo-classes count as classes', () => {
  assert.deepEqual(of('[data-x]'), [0, 1, 0]);
  assert.deepEqual(of('a[href^="http"]'), [0, 1, 1]);
  assert.deepEqual(of('input[type="text"]:focus'), [0, 2, 1]);
  // A bracket or comma inside an attribute value is not structure.
  assert.deepEqual(of('[title="a, b"]'), [0, 1, 0]);
  assert.deepEqual(of('li:nth-child(2n + 1)'), [0, 1, 1]);
  assert.deepEqual(of('li:nth-child(2 of .x)'), [0, 2, 1]);
});

test('a list takes its most specific selector', () => {
  assert.deepEqual(of('h1, .card p, #x'), [1, 0, 0]);
  assert.deepEqual(of('h1, .card p'), [0, 1, 1]);
});

test('compareSpecificity orders field by field', () => {
  assert.ok(compareSpecificity([0, 1, 0], [0, 0, 9]) > 0);
  assert.ok(compareSpecificity([1, 0, 0], [0, 99, 99]) > 0);
  assert.equal(compareSpecificity([0, 2, 1], [0, 2, 1]), 0);
  assert.ok(compareSpecificity([0, 2, 0], [0, 2, 1]) < 0);
});

test('specificityNumber orders like the tuple', () => {
  assert.ok(specificityNumber([1, 0, 0]) > specificityNumber([0, 11, 0]));
  assert.ok(specificityNumber([0, 1, 0]) > specificityNumber([0, 0, 11]));
  assert.equal(specificityNumber([0, 2, 1]), 2001);
});

/* -------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`specificity: ${passed} passing`);
