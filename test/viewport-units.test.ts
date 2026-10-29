/**
 * Unit tests for restating width units in `src/core/viewport-units.ts`.
 *
 * The text side only: which values carry a width unit and what they become at a previewed width.
 * The cascade side is the browser's, so it is pinned in `test/styles-preview.html`. Run with:
 *
 *     npm run test:viewport-units
 */
import assert from 'node:assert/strict';
import { hasWidthUnits, restateWidthUnits } from '../src/core/viewport-units.ts';

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
/* hasWidthUnits                                                               */
/* -------------------------------------------------------------------------- */

test('vw, vi, vmin, vmax and their s/l/d forms are width units', () => {
  for (const value of ['5vw', '1.5svw', '100dvw', '2lvw', '3vi', '4vmin', '4vmax', '-2vw', '.5vw']) {
    assert.ok(hasWidthUnits(value), value);
  }
});

test('height units are not: the frame is as tall as the window', () => {
  for (const value of ['100vh', '50dvh', '2vb', '10svh']) assert.ok(!hasWidthUnits(value), value);
});

test('a unit inside a string, a url() or an identifier is text, not a length', () => {
  for (const value of ['"5vw"', "'50vw'", 'url(5vw.png)', 'url("hero-10vw.jpg")', 'grid5vw', '--size-5vw', 'a-5vw']) {
    assert.ok(!hasWidthUnits(value), value);
  }
});

test('one unit among other tokens is found', () => {
  assert.ok(hasWidthUnits('clamp(1rem, 2.5vw + 1rem, 3rem)'));
  assert.ok(hasWidthUnits('url(a.png) 0 0 / 10vw auto'));
  assert.ok(hasWidthUnits('calc(100% - 4vw)'));
});

/* -------------------------------------------------------------------------- */
/* restateWidthUnits                                                           */
/* -------------------------------------------------------------------------- */

test('vw becomes px at the previewed width', () => {
  assert.equal(restateWidthUnits('50vw', 320), '160px');
  assert.equal(restateWidthUnits('100svw', 375), '375px');
  assert.equal(restateWidthUnits('-2vw', 320), '-6.4px');
});

test('a fluid clamp keeps its shape with the unit restated', () => {
  assert.equal(restateWidthUnits('clamp(1rem, 2.5vw + 1rem, 3rem)', 320), 'clamp(1rem, 8px + 1rem, 3rem)');
  assert.equal(restateWidthUnits('calc(100% - 4vw)', 1024), 'calc(100% - 40.96px)');
});

test('vmin and vmax keep the live window height', () => {
  assert.equal(restateWidthUnits('5vmin', 320), 'calc(5 * min(3.2px, 1vh))');
  // A negative factor stays a factor: `min(-16px, -5vh)` would pick the wrong side.
  assert.equal(restateWidthUnits('-5vmax', 320), 'calc(-5 * max(3.2px, 1vh))');
});

test('strings, urls, identifiers and height units are left exactly as written', () => {
  assert.equal(
    restateWidthUnits('url(5vw.png) 0 0 / 10vw 50vh', 320),
    'url(5vw.png) 0 0 / 32px 50vh',
  );
  assert.equal(restateWidthUnits('"5vw" 5vw', 320), '"5vw" 16px');
  assert.equal(restateWidthUnits('var(--size-5vw, 5vw)', 320), 'var(--size-5vw, 16px)');
});

test('a value with no width unit comes back untouched', () => {
  assert.equal(restateWidthUnits('12px 16px', 320), '12px 16px');
});

/* -------------------------------------------------------------------------- */
if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`viewport-units: ${passed} passing`);
