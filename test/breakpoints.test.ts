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
  SIZE_SLOTS,
  slotForMedia,
  slotsWith,
  VIEWPORT_PRESETS,
  widthBound,
} from '../src/core/breakpoints.ts';
import { mediaQueryProblem } from '../src/core/breakpoints.ts';
import { pageViewportWidths, viewportEditsOf, viewportList, viewportSettingsOf } from '../src/core/viewports.ts';

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

test('a width media query becomes the size it switches at; other media queries give none', () => {
  assert.deepEqual(
    pageViewportWidths(['(max-width: 520px)', '(min-width: 48em)', 'print', '(prefers-reduced-motion: reduce)', '(max-width: 767.98px)', '(min-width: 600px) and (max-width: 900px)', '(max-width: 520px)']),
    [{ width: 520, media: '(max-width: 520px)' }, { width: 768, media: '(min-width: 48em)' }, { width: 767, media: '(max-width: 767.98px)' }],
  );
});

test('the list is presets, the user\'s sizes and the page\'s, by width, each width once', () => {
  const list = viewportList([1280], [], ['(max-width: 520px)', '(min-width: 768px)', '(min-width: 1280px)']);
  assert.deepEqual(list.map((one) => `${one.origin}:${one.width}`), ['preset:320', 'page:520', 'preset:768', 'preset:1024', 'custom:1280', 'preset:1440']);
  assert.equal(list.find((one) => one.origin === 'page')?.name, '≤520px');
  // The page's sizes are listed but not in the bar until asked for; the rest are.
  assert.deepEqual(list.filter((one) => !one.shown).map((one) => one.width), [520]);
  assert.equal(viewportList([], [{ base: 520, shown: true }], ['(max-width: 520px)']).find((one) => one.base === 520)?.shown, true);
});

test('edits move and hide sizes, and the list stays sorted by width', () => {
  const list = viewportList([], [{ base: 320, width: 1600 }, { base: 768, hidden: true }], []);
  assert.deepEqual(list.map((one) => `${one.base}>${one.width}${one.shown ? '' : ' hidden'}`), ['768>768 hidden', '1024>1024', '1440>1440', '320>1600']);
});

test('a list round-trips through its settings', () => {
  const list = viewportList([1280], [], ['(max-width: 520px)']).map((one) =>
    one.base === 520 ? { ...one, shown: true } : one.base === 1280 ? { ...one, width: 1300, shown: false } : one.base === 1024 ? { ...one, width: 1100 } : one);
  const settings = viewportSettingsOf(list);
  assert.deepEqual(settings, { viewportSizes: [1300], viewportEdits: [{ base: 520, shown: true }, { base: 1024, width: 1100 }, { base: 1300, hidden: true }] });
  const again = viewportList(settings.viewportSizes, settings.viewportEdits, ['(max-width: 520px)']);
  assert.deepEqual(again.map((one) => [one.origin, one.width, one.shown]), [['preset', 320, true], ['page', 520, true], ['preset', 768, true], ['preset', 1100, true], ['custom', 1300, false], ['preset', 1440, true]]);
});

test('edits from a seed are rebuilt: out of range, duplicate and no-op entries go', () => {
  assert.deepEqual(viewportEditsOf([{ base: 768, hidden: true }, { base: 768, width: 900 }, { base: 50, hidden: true }, { base: 1024, width: 1024 }, { base: 1440, width: 99999, hidden: 'yes' }, 'x']), [{ base: 768, hidden: true }]);
  assert.equal(viewportEditsOf('nope'), null);
});

test('media queries that can match pass', () => {
  for (const ok of ['print', 'screen', 'only screen and (min-width: 600px)', 'not print', '(max-width: 767px)',
    '(min-width: 48em)', '(width >= 600px)', '(400px <= width <= 700px)', '(hover)', '(hover: hover)',
    '(prefers-color-scheme: dark)', '(prefers-reduced-motion)', '((hover) or (pointer: fine))',
    'print, (max-width: 600px)', '(aspect-ratio: 16/9)', '(min-resolution: 2dppx)', '@media (orientation: portrait)',
    '(min-width: 600px) and (max-width: 900px)']) {
    assert.equal(mediaQueryProblem(ok), null, ok);
  }
});

test('media queries that cannot match say why', () => {
  assert.match(mediaQueryProblem('dark') ?? '', /Did you mean \(prefers-color-scheme: dark\)\?/);
  assert.match(mediaQueryProblem('hello') ?? '', /isn't a media type/);
  assert.match(mediaQueryProblem('tv') ?? '', /No browser matches the tv media type/);
  assert.match(mediaQueryProblem('(foo: bar)') ?? '', /foo isn't a media feature/);
  assert.match(mediaQueryProblem('(prefers-color-scheme: purple)') ?? '', /prefers-color-scheme is light or dark, not purple/);
  assert.match(mediaQueryProblem('(max-width: -5px)') ?? '', /goes from 1px to 10000px/);
  assert.match(mediaQueryProblem('(max-width: 99999px)') ?? '', /goes from 1px to 10000px/);
  assert.match(mediaQueryProblem('(max-width: 600)') ?? '', /needs a unit: 600px/);
  assert.match(mediaQueryProblem('(max-width: abc)') ?? '', /takes a length/);
  assert.match(mediaQueryProblem('(min-width: 800px) and (max-width: 600px)') ?? '', /never applies/);
  assert.match(mediaQueryProblem('(width > 900px) and (width < 500px)') ?? '', /never applies/);
  assert.match(mediaQueryProblem('(max-hover: none)') ?? '', /hover has no range/);
  assert.match(mediaQueryProblem('(orientation: sideways)') ?? '', /portrait or landscape/);
  assert.match(mediaQueryProblem('max-width: 600px') ?? '', /in parentheses/);
  // Under `or`, either side is a way in, so bounds do not add up across it.
  assert.equal(mediaQueryProblem('(min-width: 800px), (max-width: 600px)'), null);
});

if (failures.length) {
  console.error(`\n${failures.length} failing, ${passed} passing\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`breakpoints: ${passed} passing`);
