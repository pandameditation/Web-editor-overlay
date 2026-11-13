/**
 * Unit tests for `src/core/animations.ts`: the ready-made animations, written as declarations and
 * read back. Run with:
 *
 *     npm run test:animations
 */
import assert from 'node:assert/strict';
import {
  animationLibraryCss,
  animationNamesIn,
  composeAnimation,
  defaultConfig,
  parseBezier,
  PRESETS,
  presetById,
  previewFrames,
  readAnimation,
  resolveVars,
  springEasing,
  type AnimationConfig,
} from '../src/core/animations.ts';

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
const roundTrip = (config: AnimationConfig): AnimationConfig | null => {
  const written = composeAnimation(config);
  return readAnimation((property) => written[property] ?? '', config.trigger === 'hover');
};

test('every preset, on every trigger it takes, reads back as written', () => {
  for (const preset of PRESETS) {
    for (const trigger of preset.triggers) {
      const config = defaultConfig(preset, trigger);
      const back = roundTrip(config);
      assert.ok(back, `${preset.id} on ${trigger}`);
      assert.equal(back!.preset, preset.id);
      assert.equal(back!.trigger, trigger, `${preset.id} on ${trigger}`);
      assert.deepEqual(back!.params, config.params, `${preset.id} params`);
      assert.equal(back!.easing, config.easing);
    }
  }
});

test('a direction and a distance survive the trip', () => {
  const slide = { ...defaultConfig(presetById('slide')!), params: { direction: 'right', distance: '40px', fade: 'no' } };
  const written = composeAnimation(slide);
  assert.equal(written['--heo-x'], '-40px');
  assert.equal(written['--heo-y'], '0px');
  assert.equal(written['--heo-opacity'], '1');
  assert.deepEqual(roundTrip(slide)!.params, slide.params);
  const wipe = { ...defaultConfig(presetById('wipe')!), params: { direction: 'left' } };
  assert.deepEqual(roundTrip(wipe)!.params, { direction: 'left' });
});

test('defaults are not written: the keyframes hold them as fallbacks', () => {
  const written = composeAnimation(defaultConfig(presetById('slide')!));
  assert.equal(Object.keys(written).some((key) => key.startsWith('--')), false);
});

test('longhands, never the shorthand, so the timeline is never reset', () => {
  const written = composeAnimation(defaultConfig(presetById('blur-in')!, 'in-view'));
  assert.equal(written.animation, undefined);
  assert.equal(written['animation-name'], 'heo-blur-in');
  assert.equal(written['animation-timeline'], 'view()');
  assert.equal(written['animation-range'], 'entry 0% cover 40%');
  assert.equal(written['animation-duration'], 'auto');
  assert.equal(written['animation-fill-mode'], 'both');
});

test('on load is timed, with its delay and repeat', () => {
  const config = { ...defaultConfig(presetById('glow')!), delay: 200 };
  const written = composeAnimation(config);
  assert.equal(written['animation-duration'], '2400ms');
  assert.equal(written['animation-delay'], '200ms');
  assert.equal(written['animation-iteration-count'], 'infinite');
  assert.equal(written['animation-timeline'], undefined);
  assert.equal(roundTrip(config)!.delay, 200);
});

test('scroll progress follows the root scroller, parallax the element', () => {
  assert.equal(composeAnimation(defaultConfig(presetById('progress')!))['animation-timeline'], 'scroll(root)');
  const parallax = composeAnimation(defaultConfig(presetById('parallax')!));
  assert.equal(parallax['animation-timeline'], 'view()');
  assert.equal(parallax['animation-range'], 'cover 0% cover 100%');
});

test('an animation not from the library is not one of these', () => {
  assert.equal(readAnimation((property) => (property === 'animation-name' ? 'spin' : '')), null);
  assert.equal(readAnimation(() => ''), null);
  // The shorthand is read for its name, so a Common values pick shows in the editor.
  assert.equal(readAnimation((property) => (property === 'animation' ? 'heo-glow 2.4s ease-in-out infinite' : ''))!.preset, 'glow');
});

test('the library is valid-looking CSS, one block a preset', () => {
  const css = animationLibraryCss();
  assert.equal((css.match(/@keyframes heo-/g) ?? []).length, PRESETS.length);
  assert.equal(animationLibraryCss(new Set(['heo-fade'])).trim().startsWith('@keyframes heo-fade {'), true);
});

test('names are found in CSS text, and only the library’s', () => {
  assert.deepEqual(animationNamesIn('animation-name: heo-slide; --x: heo-nothing; animation: heo-glow 2s'), ['heo-slide', 'heo-glow']);
});

test('variables are put in, with fallbacks where unset', () => {
  assert.equal(resolveVars('0 var(--heo-y, 24px)', {}), '0 24px');
  assert.equal(resolveVars('calc(-1 * var(--heo-y, 8px))', { '--heo-y': '12px' }), 'calc(-1 * 12px)');
  assert.equal(resolveVars('rotate3d(var(--heo-axis, 1, 0), 0, 70deg)', {}), 'rotate3d(1, 0, 0, 70deg)');
});

test('a preview has concrete frames in order', () => {
  const preview = previewFrames({ ...defaultConfig(presetById('bounce')!), params: { distance: '20px' } })!;
  assert.deepEqual(preview.frames.map((frame) => frame.offset), [0, 0.4, 0.6, 0.75, 1]);
  assert.equal(preview.frames[1]!.translate, '0 calc(-1 * 20px)');
  assert.equal(preview.frames[0]!.easing, 'cubic-bezier(0.3, 0, 0.7, 1)');
});

test('a spring overshoots and settles at 1', () => {
  const values = /^linear\((.*)\)$/.exec(springEasing(220, 11))![1]!.split(',').map(Number);
  assert.equal(values[0], 0);
  assert.equal(values[values.length - 1], 1);
  assert.ok(Math.max(...values) > 1.05, 'it overshoots');
});

test('Bézier keywords and functions are read', () => {
  assert.deepEqual(parseBezier('ease'), [0.25, 0.1, 0.25, 1]);
  assert.deepEqual(parseBezier('cubic-bezier(0.22, 1, 0.36, 1)'), [0.22, 1, 0.36, 1]);
  assert.equal(parseBezier('linear(0, 1)'), null);
});

if (failures.length) {
  console.error(`animations: ${failures.length} failed, ${passed} passed\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`animations: ${passed} passed`);
