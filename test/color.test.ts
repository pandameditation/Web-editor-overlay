/**
 * Unit tests for `src/core/color.ts`: reading colours, converting them, and WCAG 2 contrast.
 * Reference values from the WCAG definition and from oklch.com. Run with:
 *
 *     npm run test:color
 */
import assert from 'node:assert/strict';
import {
  contrastLevels,
  contrastRatio,
  hsvToRgb,
  inGamut,
  oklchToRgb,
  parseColor,
  parseOklch,
  rgbToHsv,
  rgbToOklch,
  toHex,
  toOklchString,
  worstContrast,
} from '../src/core/color.ts';

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
const near = (actual: number, expected: number, within = 0.01): void =>
  assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);
const hex = (value: string): string => toHex(parseColor(value)!);

test('hex in every length', () => {
  assert.equal(hex('#fff'), '#ffffff');
  assert.equal(hex('#0f08'), '#00ff0088');
  assert.equal(hex('#6366F1'), '#6366f1');
  assert.equal(hex('#00000080'), '#00000080');
});

test('rgb in both syntaxes, alpha included', () => {
  assert.equal(hex('rgb(99, 102, 241)'), '#6366f1');
  assert.equal(hex('rgba(0, 0, 0, 0.5)'), '#00000080');
  assert.equal(hex('rgb(0 0 0 / 50%)'), '#00000080');
  assert.equal(hex('rgb(100% 0% 0%)'), '#ff0000');
});

test('oklch and oklab land on the colours they name', () => {
  assert.equal(hex('oklch(62.8% 0.2577 29.23)'), '#ff0000');
  assert.equal(hex('oklch(100% 0 0)'), '#ffffff');
  assert.equal(hex('oklch(0 0 0)'), '#000000');
  assert.equal(hex('oklab(0.628 0.2249 0.1258)'), '#ff0000');
  assert.equal(hex('color(srgb 1 0 0 / 0.5)'), '#ff000080');
});

test('what it does not read is null, for the browser to resolve', () => {
  for (const value of ['red', 'hsl(0 100% 50%)', 'var(--brand)', 'currentColor', 'color-mix(in oklab, red, blue)', '#ggg']) {
    assert.equal(parseColor(value), null, value);
  }
});

test('sRGB to OKLCH and back', () => {
  const red = rgbToOklch(parseColor('#ff0000')!);
  near(red.l, 0.628, 0.001);
  near(red.c, 0.2577, 0.001);
  near(red.h, 29.23, 0.05);
  assert.equal(toHex(oklchToRgb(red)), '#ff0000');
  assert.equal(toOklchString(red), 'oklch(62.8% 0.2577 29.23)');
  assert.equal(toOklchString({ ...rgbToOklch(parseColor('#808080')!), a: 0.5 }), 'oklch(59.99% 0 0 / 50%)');
});

test('an oklch value is read exactly, gamut or not', () => {
  const wide = parseOklch('oklch(70% 0.35 145 / 40%)')!;
  assert.deepEqual(wide, { l: 0.7, c: 0.35, h: 145, a: 0.4 });
  assert.equal(inGamut(oklchToRgb(wide)), false);
  assert.equal(inGamut(parseColor('#6366f1')!), true);
});

test('HSV round trip, and a grey keeps the hue it is given', () => {
  const hsv = rgbToHsv(parseColor('#6366f1')!);
  assert.equal(toHex(hsvToRgb(hsv)), '#6366f1');
  assert.equal(rgbToHsv(parseColor('#777')!, 210).h, 210);
});

test('contrast ratios match WCAG', () => {
  near(contrastRatio(parseColor('#000')!, parseColor('#fff')!), 21);
  near(contrastRatio(parseColor('#fff')!, parseColor('#fff')!), 1);
  near(contrastRatio(parseColor('#767676')!, parseColor('#fff')!), 4.54);
  // A translucent text colour is laid over its background before it is measured: 50% black on
  // white is #7f7f7f (alpha 0x80 is 0.502).
  near(contrastRatio(parseColor('#00000080')!, parseColor('#fff')!), contrastRatio(parseColor('#7f7f7f')!, parseColor('#fff')!), 0.02);
});

test('the worst background is the one that counts', () => {
  const worst = worstContrast(parseColor('#fff')!, [parseColor('#000')!, parseColor('#ff0')!, parseColor('#00f')!]);
  near(worst.ratio, 1.07);
  assert.equal(toHex(worst.against!), '#ffff00');
});

test('levels for text, large text and the rest', () => {
  assert.deepEqual(contrastLevels(4.6, 'text'), { aa: true, aaa: false, needed: 4.5 });
  assert.deepEqual(contrastLevels(3.2, 'large-text'), { aa: true, aaa: false, needed: 3 });
  assert.deepEqual(contrastLevels(2.9, 'non-text'), { aa: false, aaa: false, needed: 3 });
});

if (failures.length) {
  console.error(`color: ${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`color: ${passed} passed`);
