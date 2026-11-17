/**
 * Unit tests for `src/core/shadow.ts`: reading and writing box-shadow, text-shadow and the
 * drop-shadow() functions of filter. Run with:
 *
 *     npm run test:shadow
 */
import assert from 'node:assert/strict';
import {
  formatShadow,
  formatShadows,
  lengthParts,
  lostIn,
  parseDropShadow,
  parseShadows,
  withAlpha,
} from '../src/core/shadow.ts';

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

test('a box shadow list reads layer by layer, colour either side', () => {
  const list = parseShadows('0 1px 2px rgb(0 0 0 / 6%), inset 0 8px 24px -6px #0f172a, red 2px 2px', 'box')!;
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { x: '0', y: '1px', blur: '2px', spread: '0px', color: 'rgb(0 0 0 / 6%)', inset: false });
  assert.equal(list[1].inset, true);
  assert.equal(list[1].spread, '-6px');
  assert.equal(list[2].color, 'red');
});

test('none is an empty list; something else is null, not a guess', () => {
  assert.deepEqual(parseShadows('none', 'box'), []);
  assert.equal(parseShadows('var(--shadow-md)', 'box'), null);
  assert.equal(parseShadows('1px', 'box'), null);
  assert.equal(parseShadows('1px 2px 3px 4px 5px red', 'box'), null);
  // A colour between the lengths is not a shadow.
  assert.equal(parseShadows('1px red 2px', 'box'), null);
});

test('a text shadow has no spread and no inset', () => {
  assert.equal(parseShadows('1px 1px 2px 3px red', 'text'), null);
  assert.equal(parseShadows('inset 1px 1px red', 'text'), null);
  assert.deepEqual(parseShadows('0 1px 2px rgb(0 0 0 / .2)', 'text')![0].blur, '2px');
});

test('lengths as written: calc() and rem survive, only simple ones are draggable', () => {
  const [one] = parseShadows('calc(1px + 1rem) 0.5rem 1em red', 'box')!;
  assert.equal(one.x, 'calc(1px + 1rem)');
  assert.equal(lengthParts(one.x), null);
  assert.deepEqual(lengthParts('0.5rem'), { number: 0.5, unit: 'rem' });
  assert.deepEqual(lengthParts('0'), { number: 0, unit: 'px' });
  assert.equal(lengthParts('3'), null);
});

test('writing leaves out a zero blur and spread, and says inset', () => {
  const shadow = { x: '2px', y: '4px', blur: '0px', spread: '0px', color: '#000', inset: false };
  assert.equal(formatShadow(shadow, 'box'), '2px 4px #000');
  assert.equal(formatShadow({ ...shadow, spread: '3px' }, 'box'), '2px 4px 0px 3px #000');
  assert.equal(formatShadow({ ...shadow, inset: true }, 'box'), 'inset 2px 4px #000');
  assert.equal(formatShadows([], 'box'), 'none');
});

test('a drop shadow drops spread and inset, and says what it lost', () => {
  const shadow = { x: '0px', y: '8px', blur: '24px', spread: '-6px', color: 'red', inset: true };
  assert.equal(formatShadow(shadow, 'drop'), 'drop-shadow(0px 8px 24px red)');
  assert.deepEqual(lostIn(shadow, 'drop'), ['spread', 'inset']);
  assert.deepEqual(lostIn(shadow, 'box'), []);
});

test('a drop-shadow() function reads as one shadow, and nothing else does', () => {
  const one = parseDropShadow('drop-shadow(0 6px 10px rgb(67 56 202 / 45%))')!;
  assert.equal(one.y, '6px');
  assert.equal(one.color, 'rgb(67 56 202 / 45%)');
  assert.equal(parseDropShadow('drop-shadow(0 0 0 2px red)'), null);
  assert.equal(parseDropShadow('blur(2px)'), null);
});

test('opacity rewrites the colour and keeps its channels', () => {
  assert.equal(withAlpha('#0f172a', 0.18), 'rgb(15 23 42 / 18%)');
  assert.equal(withAlpha('rgb(15 23 42 / 18%)', 1), '#0f172a');
  assert.equal(withAlpha('var(--x)', 0.5), null);
});

if (failures.length) {
  console.error(`shadow: ${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`shadow: ${passed} passed`);
