/**
 * Unit tests for `src/core/filter.ts`: reading and writing filter and backdrop-filter as a list of
 * functions. Run with:
 *
 *     npm run test:filter
 */
import assert from 'node:assert/strict';
import {
  filterAmount,
  filterPreview,
  formatFilter,
  neutralPart,
  parseFilter,
  urlPart,
  urlTarget,
  withAmount,
} from '../src/core/filter.ts';

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

test('a filter reads as its functions, in order, each as written', () => {
  const parts = parseFilter('sepia(0.6) drop-shadow(0 2px 4px rgb(0 0 0 / 30%)) url(#grain) contrast(120%)');
  assert.deepEqual(parts.map((one) => one.name), ['sepia', 'drop-shadow', 'url', 'contrast']);
  assert.equal(parts[1].text, 'drop-shadow(0 2px 4px rgb(0 0 0 / 30%))');
  assert.equal(formatFilter(parts), 'sepia(0.6) drop-shadow(0 2px 4px rgb(0 0 0 / 30%)) url(#grain) contrast(120%)');
});

test('none and empty are no functions; written back, nothing is none', () => {
  assert.deepEqual(parseFilter('none'), []);
  assert.deepEqual(parseFilter(''), []);
  assert.equal(formatFilter([]), 'none');
});

test('what it cannot model is kept, as written, in place', () => {
  const parts = parseFilter('blur(2px) var(--glass) wobble(3)');
  assert.deepEqual(parts.map((one) => one.name), ['blur', null, null]);
  assert.equal(formatFilter(parts), 'blur(2px) var(--glass) wobble(3)');
});

test('amounts read in the editor unit, and remember a plain number', () => {
  assert.deepEqual(filterAmount({ name: 'sepia', text: 'sepia(0.6)' }), { value: 60, plain: true });
  assert.deepEqual(filterAmount({ name: 'contrast', text: 'contrast(120%)' }), { value: 120, plain: false });
  // An empty amount function is 100%; an empty blur or hue-rotate is nothing.
  assert.deepEqual(filterAmount({ name: 'grayscale', text: 'grayscale()' }), { value: 100, plain: false });
  assert.deepEqual(filterAmount({ name: 'blur', text: 'blur()' }), { value: 0, plain: false });
  assert.deepEqual(filterAmount({ name: 'blur', text: 'blur(4px)' }), { value: 4, plain: false });
  assert.deepEqual(filterAmount({ name: 'hue-rotate', text: 'hue-rotate(0.5turn)' }), { value: 180, plain: false });
  // Not draggable as it is: rem, calc(), a var(), a bare angle that is not zero.
  assert.equal(filterAmount({ name: 'blur', text: 'blur(1rem)' }), null);
  assert.equal(filterAmount({ name: 'brightness', text: 'brightness(calc(1 + 0.2))' }), null);
  assert.equal(filterAmount({ name: 'hue-rotate', text: 'hue-rotate(90)' }), null);
});

test('an edit is written in the form it was in; a new one as a percentage', () => {
  assert.equal(withAmount('sepia', 45, true).text, 'sepia(0.45)');
  assert.equal(withAmount('sepia', 45).text, 'sepia(45%)');
  assert.equal(withAmount('blur', 2.5).text, 'blur(2.5px)');
  assert.equal(withAmount('hue-rotate', 270).text, 'hue-rotate(270deg)');
  // Past 100% grayscale draws nothing new; brightness keeps going.
  assert.equal(withAmount('grayscale', 150).text, 'grayscale(100%)');
  assert.equal(withAmount('brightness', 450).text, 'brightness(450%)');
});

test('a function is added at the value that changes nothing', () => {
  assert.equal(neutralPart('brightness').text, 'brightness(100%)');
  assert.equal(neutralPart('saturate').text, 'saturate(100%)');
  assert.equal(neutralPart('opacity').text, 'opacity(100%)');
  assert.equal(neutralPart('grayscale').text, 'grayscale(0%)');
  assert.equal(neutralPart('blur').text, 'blur(0px)');
});

test('an empty url() is kept by the editor but never written: it would void the value', () => {
  const parts = [...parseFilter('blur(2px)'), neutralPart('url')];
  assert.equal(formatFilter(parts), 'blur(2px)');
  assert.equal(formatFilter([neutralPart('url')]), 'none');
  assert.equal(urlPart('#grain').text, 'url(#grain)');
  assert.equal(urlPart('my filters.svg#a').text, 'url("my filters.svg#a")');
  assert.equal(urlTarget({ name: 'url', text: "url('f.svg#a')" }), 'f.svg#a');
});

test('the opener draws what it can, smaller', () => {
  assert.equal(filterPreview('blur(8px) url(#grain) sepia(0.6) drop-shadow(0 2px 4px red)', 4), 'blur(2px) sepia(0.6)');
  assert.equal(filterPreview('none', 4), 'none');
});

if (failures.length) {
  console.error(`filter: ${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`filter: ${passed} passed`);
