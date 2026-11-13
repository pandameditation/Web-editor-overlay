/**
 * Unit tests for `src/core/background.ts`: reading a background into layers and writing it back.
 *
 * The editor round-trips what it reads, so the property that matters most is that a value read and
 * written again says the same thing, and that what the editor cannot take apart survives as text.
 * Run with:
 *
 *     npm run test:background
 */
import assert from 'node:assert/strict';
import {
  applyLonghand,
  composeBackground,
  composeBlend,
  gradientCss,
  layerCss,
  parseBackground,
  parseGradient,
  positionPercent,
  splitTop,
} from '../src/core/background.ts';

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
const roundTrip = (value: string): string => composeBackground(parseBackground(value));

test('splitTop keeps functions whole', () => {
  assert.deepEqual(splitTop('linear-gradient(red, blue), url("a,b.png")', ','), ['linear-gradient(red, blue)', 'url("a,b.png")']);
  assert.deepEqual(splitTop('  1px  solid rgb(0 0 0 / 50%) ', ' '), ['1px', 'solid', 'rgb(0 0 0 / 50%)']);
  assert.deepEqual(splitTop('', ','), []);
});

test('a colour alone is the colour, not a layer', () => {
  const bg = parseBackground('#fff');
  assert.equal(bg.color, '#fff');
  assert.equal(bg.layers.length, 0);
  assert.equal(roundTrip('#fff'), '#fff');
  assert.equal(parseBackground('var(--surface)').color, 'var(--surface)');
});

test('a layer reads its image and placement', () => {
  const bg = parseBackground('url(hero.jpg) center / cover no-repeat fixed content-box #000');
  const [layer] = bg.layers;
  assert.equal(layer!.kind, 'image');
  assert.equal(layer!.url, 'hero.jpg');
  assert.equal(layer!.position, 'center');
  assert.equal(layer!.size, 'cover');
  assert.equal(layer!.repeat, 'no-repeat');
  assert.equal(layer!.attachment, 'fixed');
  assert.equal(layer!.origin, 'content-box');
  assert.equal(layer!.clip, 'content-box');
  assert.equal(bg.color, '#000');
});

test('a slash with no spaces still splits position from size', () => {
  const [layer] = parseBackground('url(a.png) 50% 20%/40px auto').layers;
  assert.equal(layer!.position, '50% 20%');
  assert.equal(layer!.size, '40px auto');
});

test('writing leaves the defaults out', () => {
  assert.equal(roundTrip('url(a.png) 0% 0% / auto repeat scroll padding-box border-box red'), 'url("a.png") red');
});

test('a size alone gets the position the grammar needs', () => {
  const bg = parseBackground('url(a.png)');
  bg.layers[0]!.size = 'cover';
  assert.equal(layerCss(bg.layers[0]!), 'url("a.png") 0 0 / cover');
});

test('two boxes are origin then clip, one box sets both', () => {
  const bg = parseBackground('url(a.png) border-box content-box');
  assert.equal(bg.layers[0]!.origin, 'border-box');
  assert.equal(bg.layers[0]!.clip, 'content-box');
  assert.equal(composeBackground(bg), 'url("a.png") border-box content-box');
  bg.layers[0]!.clip = 'border-box';
  assert.equal(composeBackground(bg), 'url("a.png") border-box');
  bg.layers[0]!.origin = '';
  bg.layers[0]!.clip = 'content-box';
  assert.equal(composeBackground(bg), 'url("a.png") padding-box content-box');
});

test('layers keep their order, the colour goes last', () => {
  const value = 'linear-gradient(160deg, #6366f1 0%, #ec4899 55%, #f59e0b 100%), url("m.svg") center / cover no-repeat #0f172a';
  assert.equal(roundTrip(value), value);
});

test('a linear gradient reads its direction', () => {
  assert.equal(parseGradient('linear-gradient(to right, red, blue)')!.angle, 90);
  assert.equal(parseGradient('linear-gradient(red, blue)')!.angle, 180);
  assert.equal(parseGradient('linear-gradient(0.25turn, red, blue)')!.angle, 90);
  assert.equal(parseGradient('linear-gradient(to top left, red, blue)')!.angle, 315);
});

test('unplaced stops are spread as CSS spreads them', () => {
  const g = parseGradient('linear-gradient(red, lime, blue 80%, black)')!;
  assert.deepEqual(g.stops.map((stop) => stop.at), [0, 40, 80, 100]);
});

test('stop colours may be functions and tokens', () => {
  const g = parseGradient('linear-gradient(90deg, rgb(0 0 0 / 50%) 10%, var(--brand) 90%)')!;
  assert.deepEqual(g.stops, [{ color: 'rgb(0 0 0 / 50%)', at: 10 }, { color: 'var(--brand)', at: 90 }]);
});

test('a radial gradient reads its shape and centre', () => {
  const g = parseGradient('radial-gradient(circle at right top, #fde68a, #7c2d12)')!;
  assert.equal(g.kind, 'radial');
  assert.equal(g.shape, 'circle');
  assert.equal(g.at, 'right top');
  assert.equal(gradientCss(g), 'radial-gradient(circle at right top, #fde68a 0%, #7c2d12 100%)');
  assert.equal(gradientCss(parseGradient('radial-gradient(red, blue)')!), 'radial-gradient(red 0%, blue 100%)');
});

test('what the editor cannot take apart is kept as written', () => {
  for (const image of [
    'repeating-linear-gradient(45deg, red 0 10px, blue 10px 20px)',
    'conic-gradient(red, blue)',
    'linear-gradient(red 20px, blue)',
    'linear-gradient(red, 30%, blue)',
    'radial-gradient(closest-side, red, blue)',
    'image-set("a.png" 1x, "b.png" 2x)',
  ]) {
    const bg = parseBackground(`${image} center`);
    assert.equal(bg.layers[0]!.kind, 'raw', image);
    assert.equal(composeBackground(bg), `${image} center`, image);
  }
});

test('a one-colour gradient is a solid layer, and is written as one', () => {
  const bg = parseBackground('linear-gradient(#fff3, #fff3), url(a.png)');
  assert.equal(bg.layers[0]!.kind, 'solid');
  assert.equal(bg.layers[0]!.color, '#fff3');
  assert.equal(composeBackground(bg), 'linear-gradient(#fff3, #fff3), url("a.png")');
});

test('an image waiting for its address is not written', () => {
  const bg = parseBackground('url(a.png) red');
  bg.layers.unshift({ ...bg.layers[0]!, kind: 'image', url: '' });
  assert.equal(composeBackground(bg), 'url("a.png") red');
});

test('nothing at all writes nothing', () => {
  assert.equal(composeBackground({ layers: [], color: '' }), '');
  assert.equal(roundTrip('none'), '');
});

test('longhands are laid over the layers, lists repeating', () => {
  let bg = parseBackground('url(a.png), url(b.png)');
  bg = applyLonghand(bg, 'background-size', 'cover');
  bg = applyLonghand(bg, 'background-repeat', 'no-repeat, repeat-x');
  bg = applyLonghand(bg, 'background-color', 'blue');
  assert.deepEqual(bg.layers.map((layer) => layer.size), ['cover', 'cover']);
  assert.deepEqual(bg.layers.map((layer) => layer.repeat), ['no-repeat', 'repeat-x']);
  assert.equal(bg.color, 'blue');
  bg = applyLonghand(bg, 'background-image', 'linear-gradient(red, blue)');
  assert.equal(bg.layers.length, 1);
  assert.equal(bg.layers[0]!.kind, 'gradient');
  assert.equal(bg.layers[0]!.size, 'cover');
});

test('the blend list is written only when a layer blends', () => {
  const bg = parseBackground('url(a.png), url(b.png)');
  assert.equal(composeBlend(bg), '');
  bg.layers[0]!.blend = 'multiply';
  assert.equal(composeBlend(bg), 'multiply, normal');
});

test('positions as percentages, keywords in either order', () => {
  assert.deepEqual(positionPercent('right top'), [100, 0]);
  assert.deepEqual(positionPercent('top right'), [100, 0]);
  assert.deepEqual(positionPercent('center'), [50, 50]);
  assert.deepEqual(positionPercent('bottom'), [50, 100]);
  assert.deepEqual(positionPercent('25% 75%'), [25, 75]);
  assert.deepEqual(positionPercent(''), [0, 0]);
  assert.equal(positionPercent('20px 30%'), null);
});

if (failures.length) {
  console.error(`background: ${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`background: ${passed} passed`);
