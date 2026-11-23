/**
 * Unit tests for `src/core/animations.ts`: the ready-made animations, written as declarations and
 * read back. Run with:
 *
 *     npm run test:animations
 */
import assert from 'node:assert/strict';
import {
  cssString,
  cssUnquote,
  parseTypewriterName,
  typewriterKeyframes,
  typewriterParams,
  typewriterSettings,
} from '../src/core/typewriter.ts';
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
      const base = defaultConfig(preset, trigger);
      // A typewriter with no text writes nothing; it reads back once it has one.
      const config = preset.id === 'typewriter'
        ? { ...base, params: typewriterParams({ ...typewriterSettings(base.params), texts: ['Hello'] }) }
        : base;
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
  assert.equal((css.match(/@keyframes heo-/g) ?? []).length, PRESETS.filter((one) => one.keyframes.length).length);
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

test('flicker dips to its dimmest and is steady between', () => {
  const preset = presetById('flicker')!;
  const config = { ...defaultConfig(preset), params: { opacity: '0.4' } };
  assert.equal(composeAnimation(config)['--heo-opacity'], '0.4');
  // The default is the keyframes' fallback, so it is not written.
  assert.equal(composeAnimation(defaultConfig(preset))['--heo-opacity'], undefined);
  const frames = previewFrames(config)!.frames;
  assert.deepEqual(frames.map((one) => one.offset), [...frames.map((one) => one.offset)].sort((a, b) => a - b));
  assert.ok(frames.some((one) => one.opacity === '0.4') && frames.some((one) => one.opacity === '1'));
  assert.ok(frames.every((one) => !String(one.opacity).includes('var(')));
});
const typed = (texts: string[], patch: Record<string, string> = {}): AnimationConfig => {
  const base = defaultConfig(presetById('typewriter')!);
  return { ...base, params: { ...typewriterParams({ ...typewriterSettings(base.params), texts }), ...patch } };
};

test('a typewriter is named by its timing and the length of each text', () => {
  const written = composeAnimation(typed(['design faster.', 'ship sooner.']));
  assert.equal(written['animation-name'], 'heo-typewriter-b-70-1600-35-14-12, heo-caret-blink');
  assert.equal(written['--heo-t1'], '"design faster."');
  assert.equal(written['--heo-t2'], '"ship sooner."');
  assert.equal(written['-webkit-text-fill-color'], 'transparent');
  // 250 gap + 14×70 + 1600 + 14×35, then the same for 12 characters.
  assert.equal(written['animation-duration'], `${250 + 980 + 1600 + 490 + 250 + 840 + 1600 + 420}ms, 1000ms`);
  assert.deepEqual(parseTypewriterName('heo-typewriter-c-50-900-35-3'), { after: 'clear', speed: 50, hold: 900, remove: 35, lengths: [3] });
  assert.equal(parseTypewriterName('heo-typewriter-x-1-1-1-1'), null);
});

test('its keyframes count up, hold, count down, and switch text at a count of 0', () => {
  const css = typewriterKeyframes('heo-typewriter-b-100-1000-50-4-2');
  const frames = [...css.matchAll(/([\d.]+)% \{ --heo-text: var\(--heo-t(\d), ""\); --heo-n: (\d+); --heo-c: (\d+); \}/g)]
    .map((m) => ({ at: Number(m[1]), text: Number(m[2]), c: Number(m[4]) }));
  assert.ok(frames.length >= 10);
  assert.deepEqual(frames.map((one) => one.at), [...frames.map((one) => one.at)].sort((a, b) => a - b));
  assert.equal(new Set(frames.map((one) => one.at)).size, frames.length, 'no two frames share an offset');
  assert.equal(frames.at(-1)!.at, 100);
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.text !== frames[i - 1]!.text) assert.equal(frames[i - 1]!.c + frames[i]!.c, 0, 'switch only at 0');
  }
  assert.ok(frames.some((one) => one.text === 1 && one.c === 4) && frames.some((one) => one.text === 2 && one.c === 2));
});

test('kept, it types once and stays; with no caret, no blink', () => {
  const written = composeAnimation(typed(['Hello', 'not played'], { after: 'keep', caret: 'none' }));
  assert.equal(written['animation-name'], 'heo-typewriter-k-70-1600-35-5');
  assert.equal(written['animation-iteration-count'], '1');
  assert.equal(written['animation-fill-mode'], 'forwards');
  assert.equal(written['--heo-t2'], undefined);
  assert.equal(written['--heo-caret-w'], '0px');
});

test('a typewriter reads back as written', () => {
  const config = typed(['Ship "it"', 'now'], { speed: '90', hold: '700', after: 'clear', caret: 'block', blink: 'no' });
  const written = composeAnimation(config);
  const back = readAnimation((property) => written[property] ?? '');
  assert.equal(back?.preset, 'typewriter');
  assert.deepEqual(typewriterSettings(back!.params), typewriterSettings(config.params));
});

test('a text is a safe CSS string, and reads back', () => {
  const nasty = 'a "b" \\ </style><script>';
  const quoted = cssString(nasty);
  assert.ok(!quoted.includes('</'));
  assert.equal(cssUnquote(quoted), nasty);
});

test('the library writes a typewriter only when it is named, with its registered count', () => {
  const name = 'heo-typewriter-b-70-1600-35-5';
  assert.equal(animationLibraryCss().includes('heo-typewriter'), false);
  const css = animationLibraryCss(new Set([name, 'heo-caret-blink']));
  assert.ok(css.includes('@property --heo-c') && css.includes(`@keyframes ${name} {`) && css.includes('@keyframes heo-caret-blink'));
  assert.deepEqual(animationNamesIn(`animation-name: ${name}, heo-caret-blink;`), [name, 'heo-caret-blink']);
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
