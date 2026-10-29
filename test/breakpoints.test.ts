/**
 * Unit tests for the viewport sizes and media-query parsing in `src/core/breakpoints.ts`.
 *
 * Plain Node, which is the point of the module having no DOM. Run with:
 *
 *     npm run test:breakpoints
 */
import assert from 'node:assert/strict';
import {
  breakpointOf,
  iconForWidth,
  isPseudoElement,
  isWidthQuery,
  mediaIcon,
  mediaShort,
  needsGeneratedContent,
  previewWidthFor,
  SIZE_SLOTS,
  slotForMedia,
  slotsWith,
  VIEWPORT_PRESETS,
  widthBound,
} from '../src/core/breakpoints.ts';

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
/* widthBound                                                                  */
/* -------------------------------------------------------------------------- */

test('the legacy min/max syntax is one bound, in px', () => {
  assert.deepEqual(widthBound('(max-width: 767px)'), { side: 'max', px: 767 });
  assert.deepEqual(widthBound('(min-width:768px)'), { side: 'min', px: 768 });
  assert.deepEqual(widthBound('  (MIN-WIDTH: 1024PX) '), { side: 'min', px: 1024 });
});

test('em and rem resolve against the initial 16px, as media queries do', () => {
  assert.deepEqual(widthBound('(min-width: 48em)'), { side: 'min', px: 768 });
  assert.deepEqual(widthBound('(max-width: 47.9375em)'), { side: 'max', px: 767 });
  assert.deepEqual(widthBound('(min-width: 64rem)'), { side: 'min', px: 1024 });
});

test('the range syntax is read in both directions', () => {
  assert.deepEqual(widthBound('(width >= 768px)'), { side: 'min', px: 768 });
  assert.deepEqual(widthBound('(width <= 767px)'), { side: 'max', px: 767 });
  assert.deepEqual(widthBound('(768px <= width)'), { side: 'min', px: 768 });
  assert.deepEqual(widthBound('(767px >= width)'), { side: 'max', px: 767 });
  // A strict bound sits just inside the number, the way `767.98px` does.
  const below = widthBound('(width < 768px)');
  assert.equal(below?.side, 'max');
  assert.ok(below && below.px < 768 && below.px > 767.9);
  const above = widthBound('(width > 767px)');
  assert.equal(above?.side, 'min');
  assert.ok(above && above.px > 767 && above.px < 767.1);
});

test('screen and, only screen and, all and are allowed before the bound', () => {
  assert.deepEqual(widthBound('screen and (max-width: 767px)'), { side: 'max', px: 767 });
  assert.deepEqual(widthBound('only screen and (min-width: 768px)'), { side: 'min', px: 768 });
  assert.deepEqual(widthBound('all and (min-width: 768px)'), { side: 'min', px: 768 });
});

test('two bounds, a list, or, not and other features are not one bound', () => {
  assert.equal(widthBound('(min-width: 400px) and (max-width: 900px)'), null);
  assert.equal(widthBound('(400px <= width <= 900px)'), null);
  assert.equal(widthBound('(max-width: 600px), print'), null);
  assert.equal(widthBound('(max-width: 600px) or (orientation: portrait)'), null);
  assert.equal(widthBound('not all and (min-width: 768px)'), null);
  assert.equal(widthBound('print and (max-width: 767px)'), null);
  assert.equal(widthBound('print'), null);
  assert.equal(widthBound('(prefers-color-scheme: dark)'), null);
  assert.equal(widthBound('(min-height: 600px)'), null);
  assert.equal(widthBound('(min-width: 50%)'), null);
});

/* -------------------------------------------------------------------------- */
/* Slots                                                                       */
/* -------------------------------------------------------------------------- */

const key = (media: string): string | null => slotForMedia(media, SIZE_SLOTS)?.key ?? null;

test('slot matching is tolerant of how frameworks spell the same breakpoint', () => {
  assert.equal(key('(max-width: 767px)'), 'phone');
  assert.equal(key('(max-width: 767.98px)'), 'phone');
  assert.equal(key('(width < 768px)'), 'phone');
  assert.equal(key('screen and (max-width: 47.9375em)'), 'phone');
  assert.equal(key('(min-width: 768px)'), 'tablet');
  assert.equal(key('(min-width: 48em)'), 'tablet');
  assert.equal(key('(width >= 768px)'), 'tablet');
  assert.equal(key('(min-width: 1024px)'), 'laptop');
  assert.equal(key('(min-width: 1440px)'), 'desktop');
});

test('a bound on no slot, and a query that is not a bound, have no slot', () => {
  assert.equal(key('(max-width: 600px)'), null);
  assert.equal(key('(min-width: 992px)'), null);
  assert.equal(key('print'), null);
});

test('custom sizes become from-W slots, ordered by width, and a preset width adds nothing', () => {
  const slots = slotsWith([992, 768, 1200]);
  assert.deepEqual(
    slots.map((slot) => slot.key),
    ['phone', 'tablet', 'from-992', 'laptop', 'from-1200', 'desktop'],
  );
  const custom = slots.find((slot) => slot.key === 'from-992');
  assert.equal(custom?.media, '(min-width: 992px)');
  assert.equal(custom?.name, 'From 992px');
  assert.equal(custom?.icon, 'tablet');
  assert.equal(slotForMedia('(min-width: 992px)', slots)?.key, 'from-992');
});

/* -------------------------------------------------------------------------- */
/* Labels, icons, widths                                                       */
/* -------------------------------------------------------------------------- */

test('mediaShort gives a chip label', () => {
  assert.equal(mediaShort('(max-width: 767px)'), '≤767px');
  assert.equal(mediaShort('(max-width: 767.98px)'), '≤767px');
  assert.equal(mediaShort('(width < 768px)'), '≤767px');
  assert.equal(mediaShort('(min-width: 768px)'), '≥768px');
  assert.equal(mediaShort('(min-width: 48em)'), '≥768px');
  assert.equal(mediaShort('print'), 'print');
  assert.equal(mediaShort('(prefers-color-scheme: dark)'), 'prefers-color-scheme: dark');
});

test('breakpointOf is the width where the bound flips', () => {
  assert.equal(breakpointOf('(min-width: 768px)'), 768);
  assert.equal(breakpointOf('(max-width: 767px)'), 768);
  assert.equal(breakpointOf('(max-width: 767.98px)'), 768);
  assert.equal(breakpointOf('(width < 768px)'), 768);
  assert.equal(breakpointOf('(width > 767px)'), 768);
  assert.equal(breakpointOf('print'), null);
});

test('previewWidthFor picks the widest preset under a max and the narrowest over a min', () => {
  assert.equal(previewWidthFor('(max-width: 767px)', VIEWPORT_PRESETS), 320);
  assert.equal(previewWidthFor('(max-width: 1100px)', VIEWPORT_PRESETS), 1024);
  assert.equal(previewWidthFor('(min-width: 768px)', VIEWPORT_PRESETS), 768);
  assert.equal(previewWidthFor('(min-width: 900px)', VIEWPORT_PRESETS), 1024);
  // No preset inside the bound: the bound itself.
  assert.equal(previewWidthFor('(max-width: 300px)', VIEWPORT_PRESETS), 300);
  assert.equal(previewWidthFor('(min-width: 2000px)', VIEWPORT_PRESETS), 2000);
  assert.equal(previewWidthFor('print', VIEWPORT_PRESETS), null);
});

test('iconForWidth and mediaIcon name a device', () => {
  assert.equal(iconForWidth(320), 'phone');
  assert.equal(iconForWidth(599), 'phone');
  assert.equal(iconForWidth(600), 'tablet');
  assert.equal(iconForWidth(999), 'tablet');
  assert.equal(iconForWidth(1000), 'laptop');
  assert.equal(iconForWidth(1299), 'laptop');
  assert.equal(iconForWidth(1300), 'desktop');
  assert.equal(mediaIcon('(max-width: 1023px)'), 'phone');
  assert.equal(mediaIcon('(min-width: 768px)'), 'tablet');
  assert.equal(mediaIcon('(min-width: 1440px)'), 'desktop');
  assert.equal(mediaIcon('print'), 'print');
  assert.equal(mediaIcon('(prefers-reduced-motion: reduce)'), 'window');
});

test('isWidthQuery finds every viewport-size feature and nothing else', () => {
  assert.ok(isWidthQuery('(max-width: 767px)'));
  assert.ok(isWidthQuery('(width < 768px)'));
  assert.ok(isWidthQuery('(min-height: 600px)'));
  assert.ok(isWidthQuery('(min-aspect-ratio: 16/9)'));
  assert.ok(isWidthQuery('(orientation: portrait)'));
  assert.ok(isWidthQuery('(max-device-width: 480px)'));
  assert.ok(!isWidthQuery('print'));
  assert.ok(!isWidthQuery('(prefers-color-scheme: dark)'));
  assert.ok(!isWidthQuery('(hover: hover)'));
});

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

test('pseudo-elements are told apart from states, legacy spellings included', () => {
  assert.ok(isPseudoElement('::before'));
  assert.ok(isPseudoElement(':before'));
  assert.ok(isPseudoElement(':first-letter'));
  assert.ok(isPseudoElement(':hover::before'));
  assert.ok(!isPseudoElement(':hover'));
  assert.ok(!isPseudoElement(':focus-within'));
});

test('only before and after need generated content', () => {
  assert.ok(needsGeneratedContent('::before'));
  assert.ok(needsGeneratedContent(':after'));
  assert.ok(needsGeneratedContent(':hover::after'));
  assert.ok(!needsGeneratedContent('::marker'));
  assert.ok(!needsGeneratedContent('::placeholder'));
  assert.ok(!needsGeneratedContent(':hover'));
});

/* -------------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`breakpoints: ${passed} passing`);
