/**
 * Unit tests for `src/core/transitions.ts` (the transition list) and for the state attribution in
 * `src/core/cascade.ts` (`:hover on .nav`). Run with:
 *
 *     npm run test:transitions
 */
import assert from 'node:assert/strict';
import { covers, formatTransitions, readTransitions, timeMs } from '../src/core/transitions.ts';
import { peelStates, stateTrigger, withState } from '../src/core/cascade.ts';

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
const from = (declared: Record<string, string>) => readTransitions((property) => declared[property] ?? '');

test('the shorthand reads one transition per property, times and tokens as written', () => {
  const items = from({ transition: 'background-color var(--motion-fast) ease-out, transform 250ms cubic-bezier(.34,1.56,.64,1) 50ms' })!;
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { property: 'background-color', duration: 'var(--motion-fast)', delay: '', easing: 'ease-out', behavior: '' });
  assert.equal(items[1].delay, '50ms');
  assert.equal(items[1].easing, 'cubic-bezier(.34,1.56,.64,1)');
});

test('an easing token is an easing, a motion token a time', () => {
  const [one] = from({ transition: 'opacity var(--motion-base) var(--ease-out)' })!;
  assert.equal(one.duration, 'var(--motion-base)');
  assert.equal(one.easing, 'var(--ease-out)');
});

test('a bare time is all; none and nothing are no transition; a whole var() is unreadable', () => {
  assert.equal(from({ transition: '.2s' })![0].property, 'all');
  assert.deepEqual(from({ transition: 'none' }), []);
  assert.deepEqual(from({}), []);
  assert.equal(from({ transition: 'var(--fade) var(--slow) var(--x)' }), null);
});

test('longhands lay over the shorthand, a short list repeating', () => {
  const items = from({ 'transition-property': 'opacity, transform', 'transition-duration': '200ms' })!;
  assert.deepEqual(items.map((one) => `${one.property} ${one.duration}`), ['opacity 200ms', 'transform 200ms']);
  const over = from({ transition: 'all 1s', 'transition-delay': '0.1s' })!;
  assert.equal(over[0].delay, '0.1s');
});

test('written back as the shorthand, only what each says', () => {
  const items = from({ transition: 'opacity 150ms ease 0s, transform .3s ease-in-out 40ms allow-discrete' })!;
  assert.equal(formatTransitions(items), 'opacity 150ms, transform .3s ease-in-out 40ms allow-discrete');
  assert.equal(formatTransitions([]), 'none');
});

test('times in milliseconds, a token through its value', () => {
  assert.equal(timeMs('.2s'), 200);
  assert.equal(timeMs('150ms'), 150);
  assert.equal(timeMs('var(--motion-fast)', (name) => (name === '--motion-fast' ? '120ms' : '')), 120);
  assert.equal(timeMs('var(--nope)'), null);
  assert.equal(timeMs('var(--nope, 300ms)'), 300);
});

test('a transition covers its property, its longhands, and all of them for all', () => {
  assert.ok(covers('all', 'transform'));
  assert.ok(covers('border', 'border-top-color'));
  assert.ok(covers('outline', 'outline-color'));
  assert.ok(!covers('color', 'background-color'));
  assert.ok(!covers('all', '--x'));
});

test('not by the name: outline-offset is not part of outline', () => {
  assert.ok(!covers('outline', 'outline-offset'));
  assert.ok(!covers('border', 'border-radius'));
  assert.ok(!covers('outline-offset', 'outline'));
});

test('a state on another element is that element’s, and written back where it was', () => {
  assert.deepEqual(peelStates('.nav:hover a'), { base: '.nav a', pseudo: ':hover on .nav' });
  assert.deepEqual(stateTrigger(':hover on .nav'), { pseudo: ':hover', on: '.nav' });
  assert.equal(withState('.nav a', ':hover on .nav'), '.nav:hover a');
  assert.equal(withState('.nav > li a', ':focus-within on .nav'), '.nav:focus-within > li a');
  // A family without that element has no such rule.
  assert.equal(withState('.link', ':hover on .nav'), null);
});

test('the element’s own state is what it always was', () => {
  assert.deepEqual(peelStates('.card:hover'), { base: '.card', pseudo: ':hover' });
  assert.deepEqual(peelStates('a:hover::before'), { base: 'a', pseudo: ':hover::before' });
  assert.equal(withState('.card', ':hover'), '.card:hover');
  // Structural pseudo-classes stay in the selector.
  assert.deepEqual(peelStates('ul li:first-child a'), { base: 'ul li:first-child a', pseudo: '' });
  // Two states on two elements, or one on each: the old reading, not a guess.
  assert.equal(peelStates('.a:hover .b:focus .c').pseudo, ':hover:focus');
  assert.equal(peelStates('.nav:hover a:focus').pseudo, ':hover:focus');
});

if (failures.length) {
  console.error(`transitions: ${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`transitions: ${passed} passed`);
