/**
 * Unit tests for `src/core/text-styles.ts` and the font-stack helpers of `src/core/fonts.ts`. Run with:
 *
 *     npm run test:textstyles
 */
import assert from 'node:assert/strict';
import {
  isTextStyle,
  proposedTextStyleName,
  sortTextStyles,
  TEXT_STYLE_ORDER,
  textStyleOrder,
  storedTextStyle,
  textStyleClass,
  textStyleDeclarations,
  textStyleName,
  TEXT_STYLE_MARKER,
} from '../src/core/text-styles.ts';
import { formatFamilies, parseFamilies } from '../src/core/fonts.ts';

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

test('a text style is a class carrying the marker, its name in it', () => {
  const entry = { name: 'text-heading-1', declarations: { 'font-size': '36px', [TEXT_STYLE_MARKER]: '"Heading 1"' } };
  assert.ok(isTextStyle(entry));
  assert.ok(!isTextStyle({ declarations: { 'font-size': '36px' } }));
  assert.equal(textStyleName(entry), 'Heading 1');
  assert.deepEqual(textStyleDeclarations(entry), { 'font-size': '36px' });
});

test('stored: typography only, empties dropped, the marker last and quoted', () => {
  const stored = storedTextStyle('Lede "big"', { 'font-size': '20px', padding: '4px', color: ' ', 'letter-spacing': '0.05em' });
  assert.deepEqual(Object.keys(stored), ['font-size', 'letter-spacing', TEXT_STYLE_MARKER]);
  assert.equal(textStyleName({ name: 'x', declarations: stored }), 'Lede "big"');
});

test('a name becomes a class; a proposal is unique', () => {
  assert.equal(textStyleClass('Heading 1'), 'text-heading-1');
  assert.equal(textStyleClass('  Ünder Ström! '), 'text-under-strom');
  assert.equal(proposedTextStyleName('Heading 1', ['Heading 1']), 'Heading 1 alt');
  assert.equal(proposedTextStyleName('Heading 1', ['heading 1 ALT']), 'Heading 1 alt 2');
  assert.equal(proposedTextStyleName(null, []), 'Text style');
});

test('a font stack reads and writes, quoting what needs it', () => {
  assert.deepEqual(parseFamilies(`'Fraunces', "Times New Roman", Georgia, serif`), ['Fraunces', 'Times New Roman', 'Georgia', 'serif']);
  assert.equal(formatFamilies(['Fraunces', 'Times New Roman', 'serif']), 'Fraunces, "Times New Roman", serif');
  assert.equal(formatFamilies(['Source Serif 4', 'var(--x)']), '"Source Serif 4", var(--x)');
});

test('styles sort by their place, the unplaced after by name, and the place is not applied', () => {
  const style = (name: string, order?: string) => ({ entry: { name, declarations: { [TEXT_STYLE_MARKER]: `"${name}"`, ...(order ? { [TEXT_STYLE_ORDER]: order } : {}) } } });
  const sorted = sortTextStyles([style('text-b'), style('text-c', '2'), style('text-a'), style('text-d', '1')]);
  assert.deepEqual(sorted.map((one) => one.entry.name), ['text-d', 'text-c', 'text-a', 'text-b']);
  assert.equal(textStyleOrder(style('x', 'nope').entry), null);
  const stored = storedTextStyle('Body', { 'font-size': '16px' }, 3);
  assert.equal(stored[TEXT_STYLE_ORDER], '3');
  assert.deepEqual(textStyleDeclarations({ name: 'text-body', declarations: stored }), { 'font-size': '16px' });
  assert.equal(TEXT_STYLE_ORDER in storedTextStyle('Body', { 'font-size': '16px' }), false);
});
test('the outline is stored as its longhands', () => {
  const stored = storedTextStyle('Outlined', { '-webkit-text-stroke-width': '1px', '-webkit-text-stroke-color': 'red' });
  assert.equal(stored['-webkit-text-stroke-width'], '1px');
  assert.equal(stored['-webkit-text-stroke-color'], 'red');
});
if (failures.length) {
  console.error(`text-styles: ${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`text-styles: ${passed} passed`);
