/**
 * Tests the suite runner's own logic: the scheduling order, the timings cache, the section
 * filter pages use for `?only=`, the event-based settle pages use instead of fixed sleeps, and
 * the diff-based selection behind `--changed` with the coverage map it reads.
 *
 * Plain Node, no browser: `scheduled()`, `loadTimings`/`saveTimings`, `selectAffected`,
 * `srcFilesFromCoverage`, `srcImporters` and `saveCoverage` are pure enough to drive with made-up fixtures, a
 * hand-written bundle and source map, and a temporary file, and `test/sections.js` runs in a `node:vm` context
 * with a stub window, document and location. `test/settle.js` runs in one whose timers and frames
 * are on a fake clock the test advances. Run with: npm run test:harness
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import {
  loadCoverage,
  saveCoverage,
  selectAffected,
  srcFilesFromCoverage,
  srcImporters,
  unmappedBundles,
} from '../scripts/affected.mjs';
import { fixtureName, scheduled } from '../scripts/fixtures.mjs';
import { loadTimings, saveTimings } from '../scripts/timings.mjs';

const page = (name, extra = {}) => ({ page: `test/${name}.html`, budget: 1000, ...extra });
const order = (fixtures, times) => scheduled(fixtures, times).map((f) => f.page.slice(5, -5));

const SECTIONS_SOURCE = readFileSync(new URL('./sections.js', import.meta.url), 'utf8');
const SETTLE_SOURCE = readFileSync(new URL('./settle.js', import.meta.url), 'utf8');

/**
 * `HeoSections.create` for a page at `search`, loaded the way a page loads it. `progress` is the
 * stub `#progress` element, so a test can see what `run` wrote there.
 */
function sectionsAt(search) {
  const progress = { textContent: '' };
  const window = {};
  const context = createContext({
    window,
    document: { getElementById: (id) => (id === 'progress' ? progress : null) },
    location: { search },
    performance: { now: () => 0 },
    URLSearchParams,
  });
  runInContext(SECTIONS_SOURCE, context);
  return { create: (spec) => window.HeoSections.create(spec), progress };
}

const FRAME_MS = 16;

/**
 * `test/settle.js` loaded on a fake clock. `window` is the page's (wrapped) window; `at(ms, fn)`
 * runs `fn` at that time without going through the wrappers, as an outside event would; `mutate()`
 * reports a DOM mutation to every connected observer; `animate(ms, name)` starts a transition of
 * that length in the document; `timeOf(promise)` runs the clock until the
 * promise settles and returns the time it did. Frames fall every 16 ms.
 */
function settleOnAFakeClock() {
  let clock = 0;
  let seq = 0;
  const events = new Map();
  const schedule = (at, fn, period) => {
    const id = ++seq;
    events.set(id, { at, fn, period });
    return id;
  };
  const animations = [];
  /** A transition of `ms` starting now, finished once the clock passes its end. */
  const animate = (ms, name = '') => {
    const start = clock;
    animations.push({
      animationName: name,
      pending: false,
      playbackRate: 1,
      get currentTime() {
        return Math.min(clock - start, ms);
      },
      get playState() {
        return clock - start < ms ? 'running' : 'finished';
      },
      effect: { getComputedTiming: () => ({ endTime: ms }) },
    });
  };
  const observers = new Set();
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
    }
    observe() {
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
      this.records = [];
    }
    takeRecords() {
      const records = this.records;
      this.records = [];
      return records;
    }
  }
  const window = {
    performance: { now: () => clock },
    setTimeout: (fn, ms) => schedule(clock + Math.max(0, Number(ms) || 0), fn),
    clearTimeout: (id) => events.delete(id),
    setInterval: (fn, ms) => schedule(clock + ms, fn, ms),
    clearInterval: (id) => events.delete(id),
    requestAnimationFrame: (fn) => schedule((Math.floor(clock / FRAME_MS) + 1) * FRAME_MS, () => fn(clock)),
    cancelAnimationFrame: (id) => events.delete(id),
    document: { querySelectorAll: () => [], getAnimations: () => animations },
    MutationObserver,
  };
  runInContext(SETTLE_SOURCE, createContext({ window }));
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const timeOf = async (promise) => {
    let done = false;
    promise.then(() => {
      done = true;
    });
    await flush();
    while (!done) {
      let next = null;
      for (const [id, event] of events) if (!next || event.at < next[1].at) next = [id, event];
      if (!next || next[1].at > 60000) throw new Error('nothing left to run');
      const [id, event] = next;
      clock = event.at;
      if (event.period) event.at += event.period;
      else events.delete(id);
      event.fn();
      await flush();
    }
    return clock;
  };
  const mutate = () => {
    for (const observer of observers) {
      observer.records.push({ type: 'attributes' });
      Promise.resolve().then(() => {
        if (observer.records.length) observer.callback(observer.takeRecords(), observer);
      });
    }
  };
  return { window, settle: window.HeoSettle, at: (ms, fn) => schedule(ms, fn), mutate, animate, timeOf };
}

const CHAIN = {
  names: ['layout', 'gradient', 'stops', 'radial', 'read', 'typing'],
  needs: { stops: ['gradient'], radial: ['stops'] },
  always: ['layout'],
};

/** The names `run` lets through, asked in declared order as a page does. */
const ranOf = (sections) => CHAIN.names.filter((name) => sections.run(name));

/* A made-up suite for selectAffected: b runs shared and strict, c has no coverage entry yet. */
const AFFECTED = [page('a'), page('b'), page('b', { strict: true }), page('c')];
const COVERAGE = {
  recordedAt: '2026-11-25T00:00:00.000Z',
  fixtures: {
    a: ['src/core/x.ts'],
    b: ['src/core/x.ts', 'src/ui/y.ts'],
    'b (strict)': ['src/ui/y.ts'],
  },
};
const PAGES = {
  'test/a.html': '<script src="sections.js"></script>',
  'test/b.html': '<script src="sections.js"></script><script>fetch("./nested/theme.css")</script>',
  'test/c.html': '<p>no helpers</p>',
};
/** `selectAffected` over the made-up suite; `fixtures` defaults to the ones with an entry. */
const affected = (changed, { fixtures = AFFECTED.slice(0, 3), coverage = COVERAGE } = {}) =>
  selectAffected({ changed, fixtures, coverage, readPage: (p) => PAGES[p] ?? '' });
const names = (selection) => selection.selected.map(fixtureName);

/** A scratch directory for one test, removed afterwards. */
async function inTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), 'heo-harness-'));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tests = {
  async unknownFixturesRunFirstInManifestOrder() {
    const fixtures = [page('a', { weight: 9000 }), page('b'), page('c', { weight: 100 }), page('d')];
    assert.deepEqual(order(fixtures, new Map()), ['b', 'd', 'a', 'c']);
  },

  async aCachedTimeOverridesTheWeight() {
    const fixtures = [page('a', { weight: 9000 }), page('b', { weight: 100 })];
    assert.deepEqual(order(fixtures, new Map([['b', 20000]])), ['b', 'a']);
    // A cached time also makes a page without a weight known.
    assert.deepEqual(order([page('a', { weight: 50 }), page('c')], new Map([['c', 10]])), ['a', 'c']);
  },

  async knownFixturesRunLongestFirst() {
    const fixtures = [
      page('short', { weight: 1000 }),
      page('long', { weight: 30000 }),
      page('mid', { weight: 5000 }),
      page('mid', { strict: true, weight: 7000 }),
    ];
    const times = new Map([['mid (strict)', 2000]]);
    assert.deepEqual(
      scheduled(fixtures, times).map((f) => `${f.page.slice(5, -5)}${f.strict ? '!' : ''}`),
      ['long', 'mid', 'mid!', 'short'],
    );
  },

  async saveRecordsOnlyFinishedPages() {
    await inTemp((dir) => {
      const file = join(dir, 'timings.json');
      const fixtures = [page('done'), page('failing'), page('stuck')];
      saveTimings(
        [
          { name: 'done', ms: 1200, ok: true },
          // Reached :END with a false assertion: still a real time.
          { name: 'failing', ms: 800, ok: true, payload: '{"failed":["x"]}' },
          { name: 'stuck', ms: 60000, ok: false, reason: 'did not finish' },
        ],
        fixtures,
        file,
      );
      assert.deepEqual([...loadTimings(file)].sort(), [['done', 1200], ['failing', 800]]);
    });
  },

  async savePrunesFixturesNoLongerInTheManifest() {
    await inTemp((dir) => {
      const file = join(dir, 'timings.json');
      saveTimings([{ name: 'gone', ms: 5, ok: true }, { name: 'kept', ms: 6, ok: true }], [page('gone'), page('kept')], file);
      saveTimings([{ name: 'new', ms: 7, ok: true }], [page('kept'), page('new')], file);
      assert.deepEqual([...loadTimings(file)].sort(), [['kept', 6], ['new', 7]]);
    });
  },

  async timingsRoundTripThroughAFile() {
    await inTemp((dir) => {
      // A directory that does not exist yet: saving creates it.
      const file = join(dir, 'nested', 'cache', 'timings.json');
      saveTimings(
        [{ name: 'a', ms: 1500, ok: true }, { name: 'a (strict)', ms: 900, ok: true }],
        [page('a'), page('a', { strict: true })],
        file,
      );
      const data = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(data.version, 1);
      assert.equal(data.fixtures.a.ms, 1500);
      assert.ok(!Number.isNaN(Date.parse(data.fixtures.a.at)));
      assert.deepEqual(loadTimings(file), new Map([['a', 1500], ['a (strict)', 900]]));
    });
  },

  async aMalformedFileLoadsAsEmpty() {
    await inTemp((dir) => {
      const file = join(dir, 'timings.json');
      assert.equal(loadTimings(join(dir, 'absent.json')).size, 0);
      writeFileSync(file, '{"version": 1, "fixtures": {');
      assert.equal(loadTimings(file).size, 0);
      writeFileSync(file, '{"version": 2, "fixtures": {"a": {"ms": 1}}}');
      assert.equal(loadTimings(file).size, 0);
      // Saving over a malformed file starts a fresh cache rather than failing.
      writeFileSync(file, 'not json');
      saveTimings([{ name: 'a', ms: 3, ok: true }], [page('a')], file);
      assert.deepEqual(loadTimings(file), new Map([['a', 3]]));
    });
  },
  async anUnfilteredRunRunsEverySection() {
    const { create, progress } = sectionsAt('');
    const sections = create(CHAIN);
    assert.equal(sections.filtered, false);
    assert.deepEqual(ranOf(sections), CHAIN.names);
    assert.equal(progress.textContent, 'typing');
    const results = sections.report({});
    assert.equal('partialRun' in results, false);
    assert.deepEqual(Object.keys(results.__sectionMs), CHAIN.names);
    // Another query parameter is not a filter.
    assert.equal(sectionsAt('?debug=1').create(CHAIN).filtered, false);
  },
  async onlyRunsTheSectionItsNeedsAndAlways() {
    const sections = sectionsAt('?only=radial').create(CHAIN);
    assert.equal(sections.filtered, true);
    assert.equal(sections.wants('typing'), false);
    // radial needs stops, which needs gradient; layout always runs.
    assert.deepEqual(ranOf(sections), ['layout', 'gradient', 'stops', 'radial']);
    assert.deepEqual(ranOf(sectionsAt('?only= typing , read').create(CHAIN)), ['layout', 'read', 'typing']);
    assert.throws(() => sections.run('nope'), /not a declared section/);
  },
  async anUnknownSectionThrows() {
    const { create } = sectionsAt('?only=typing,nope');
    assert.throws(
      () => create(CHAIN),
      (error) =>
        error.message === '?only= names unknown section(s) "nope"; this page has: layout, gradient, stops, radial, read, typing',
    );
  },
  async quietReturnsAfterItsFramesWhenNothingIsPending() {
    const { settle, timeOf } = settleOnAFakeClock();
    // Two frames, a still check, one more frame: 48 ms of a 300 ms settle.
    assert.equal(await timeOf(settle.quiet(300)), 3 * FRAME_MS);
    assert.deepEqual({ ...settle.stats() }, { calls: 1, early: 1, toDeadline: 0, savedMs: 300 - 3 * FRAME_MS });
  },
  async quietWaitsForATimerDueInsideItsWindow() {
    const { window, settle, timeOf } = settleOnAFakeClock();
    let firedAt = null;
    window.setTimeout(() => {
      firedAt = window.performance.now();
    }, 120);
    const doneAt = await timeOf(settle.quiet(300));
    assert.equal(firedAt, 120);
    assert.ok(doneAt > 120 && doneAt < 300, `returned at ${doneAt}`);
  },
  async quietIgnoresATimerDueAfterItsDeadline() {
    const { window, settle, timeOf } = settleOnAFakeClock();
    window.setTimeout(() => { }, 1000);
    assert.equal(await timeOf(settle.quiet(300)), 3 * FRAME_MS);
  },
  async quietWaitsThroughAShorterIntervalToItsLastTick() {
    const { window, settle, timeOf } = settleOnAFakeClock();
    const ticks = [];
    window.setInterval(() => ticks.push(window.performance.now()), 50);
    // The deadline is 300 ms after the two frames (332): every tick before it runs, as in a
    // fixed wait, and it ends after the last one (300) because the next (350) is past it.
    const doneAt = await timeOf(settle.quiet(300));
    assert.deepEqual(ticks, [50, 100, 150, 200, 250, 300]);
    assert.ok(doneAt > 300 && doneAt < 2 * FRAME_MS + 300, `returned at ${doneAt}`);
    // A cleared interval no longer holds it.
    const other = settleOnAFakeClock();
    other.window.clearInterval(other.window.setInterval(() => { }, 50));
    assert.equal(await other.timeOf(other.settle.quiet(300)), 3 * FRAME_MS);
  },
  async quietFollowsAChainOfTimers() {
    const { window, settle, timeOf } = settleOnAFakeClock();
    let secondAt = null;
    window.setTimeout(() => {
      window.setTimeout(() => {
        secondAt = window.performance.now();
      }, 100);
    }, 100);
    const doneAt = await timeOf(settle.quiet(300));
    assert.equal(secondAt, 200);
    assert.ok(doneAt > 200 && doneAt < 300, `returned at ${doneAt}`);
  },
  async aMutationDuringTheLastFrameKeepsItWaiting() {
    const { settle, at, mutate, timeOf } = settleOnAFakeClock();
    // Between the still check at 32 and the frame at 48 that would end it.
    at(40, mutate);
    assert.equal(await timeOf(settle.quiet(300)), 5 * FRAME_MS);
  },
  async aFrameLoopCountsOnlyThroughWhatItChanges() {
    // A loop that asks for itself every frame and changes nothing: still, after its first frame.
    const idle = settleOnAFakeClock();
    const still = () => idle.window.requestAnimationFrame(still);
    idle.window.requestAnimationFrame(still);
    assert.equal(await idle.timeOf(idle.settle.quiet(300)), 3 * FRAME_MS);
    // The same loop writing every frame keeps it busy to the deadline.
    const busy = settleOnAFakeClock();
    const writing = () => {
      busy.mutate();
      busy.window.requestAnimationFrame(writing);
    };
    busy.window.requestAnimationFrame(writing);
    assert.ok((await busy.timeOf(busy.settle.quiet(300))) >= 2 * FRAME_MS + 300);
    // A one-off frame asked for from inside another frame's callback still counts.
    const chained = settleOnAFakeClock();
    let ranAt = null;
    chained.window.requestAnimationFrame(() =>
      chained.window.requestAnimationFrame(() => chained.window.requestAnimationFrame(() => {
        ranAt = chained.window.performance.now();
      })));
    const doneAt = await chained.timeOf(chained.settle.quiet(300));
    assert.equal(ranAt, 3 * FRAME_MS);
    assert.ok(doneAt > ranAt, `returned at ${doneAt}`);
  },
  async quietWaitsForAnAnimationThatEndsInsideItsWindow() {
    const { settle, animate, timeOf } = settleOnAFakeClock();
    animate(200);
    const doneAt = await timeOf(settle.quiet(300));
    assert.ok(doneAt >= 200 && doneAt < 300, `returned at ${doneAt}`);
    // One that ends after the deadline, like a timer due after it, does not hold it; nor does an
    // art loop, whatever its length.
    const late = settleOnAFakeClock();
    late.animate(7200);
    late.animate(200, 'heo-art-slide');
    assert.equal(await late.timeOf(late.settle.quiet(300)), 3 * FRAME_MS);
  },
  async quietsOwnWaitsNeverCountAsPending() {
    const { window, settle, timeOf } = settleOnAFakeClock();
    // Two quiets and a fixed wait at once: neither quiet sees the other's frames or the fixed timer.
    const times = [];
    const timed = (promise) => promise.then(() => times.push(window.performance.now()));
    await timeOf(Promise.all([timed(settle.quiet(300)), timed(settle.fixed(100)), timed(settle.quiet(300))]));
    assert.deepEqual(times, [3 * FRAME_MS, 3 * FRAME_MS, 100]);
    assert.deepEqual({ ...settle.stats() }, { calls: 2, early: 2, toDeadline: 0, savedMs: 2 * (300 - 3 * FRAME_MS) });
  },
  async aMappedSrcFileSelectsExactlyItsFixtures() {
    const selection = affected(['src/ui/y.ts']);
    assert.equal(selection.all, null);
    assert.deepEqual(names(selection), ['b', 'b (strict)']);
    assert.equal(selection.why.get('b'), 'covers src/ui/y.ts');
    assert.deepEqual(names(affected(['src/core/x.ts'])), ['a', 'b']);
  },
  async aSrcFileAlsoSelectsThePagesOfFilesThatReadItsValues() {
    // x.ts is covered by a and b only; y.ts imports one of x's constants, and b (strict) covers y.
    const importers = { 'src/core/x.ts': ['src/ui/y.ts'] };
    const selection = selectAffected({
      changed: ['src/core/x.ts'],
      fixtures: AFFECTED.slice(0, 3),
      coverage: COVERAGE,
      readPage: () => '',
      importers,
    });
    assert.equal(selection.all, null);
    assert.deepEqual(names(selection), ['a', 'b', 'b (strict)']);
    assert.equal(selection.why.get('b (strict)'), 'covers src/ui/y.ts, which imports src/core/x.ts');
    assert.equal(selection.why.get('b'), 'covers src/core/x.ts; covers src/ui/y.ts, which imports src/core/x.ts');
    // An importer's pages never stand in for the file's own entry.
    const unmapped = selectAffected({
      changed: ['src/new.ts'],
      fixtures: AFFECTED.slice(0, 3),
      coverage: COVERAGE,
      readPage: () => '',
      importers: { 'src/new.ts': ['src/ui/y.ts'] },
    });
    assert.equal(unmapped.all, 'src/new.ts is not in the coverage map (run npm run check:map)');
  },
  async importersCountOnlyStatementsThatReadAValue() {
    const files = {
      'src/core/x.ts': [
        "export const SIDES = ['top'];",
        'export function parse(v: string) { return v; }',
        'export const compose = (a: string): string => a;',
        'export type Side = string;',
      ].join('\n'),
      'src/core/index.ts': 'export const ROOT = 1;',
      // A constant (with a function beside it), across lines: counts.
      'src/ui/value.ts': "import {\n  parse,\n  SIDES,\n  type Side,\n} from '../core/x.js';",
      // Functions only, types only, a type-only statement, a side-effect import: none count.
      'src/ui/calls.ts': "import { parse, compose as c } from '../core/x.js';",
      'src/ui/types.ts': "import { type Side } from '../core/x.js';\nimport type { Side as S } from '../core/x.js';",
      'src/ui/loads.ts': "import '../core/x.js';\nimport { html } from 'lit';",
      // The module as a whole: a namespace, a re-export of everything, a dynamic import.
      'src/ui/ns.ts': "import * as border from '../core/x.js';",
      'src/ui/again.ts': "export * from '../core/x.js';",
      'src/ui/later.ts': "const load = () => import('../core/x.js');",
      // A directory import resolves to its index.
      'src/ui/dir.ts': "import { ROOT } from '../core';",
    };
    assert.deepEqual(srcImporters('/repo', files), {
      'src/core/x.ts': ['src/ui/again.ts', 'src/ui/later.ts', 'src/ui/ns.ts', 'src/ui/value.ts'],
      'src/core/index.ts': ['src/ui/dir.ts'],
    });
  },
  async aSrcFileInNoEntrySelectsAll() {
    const selection = affected(['src/ui/y.ts', 'src/new.ts']);
    assert.equal(selection.all, 'src/new.ts is not in the coverage map (run npm run check:map)');
    assert.deepEqual(names(selection), ['a', 'b', 'b (strict)']);
  },
  async noCoverageMapSelectsAll() {
    const selection = affected(['src/ui/y.ts'], { coverage: null });
    assert.equal(selection.all, 'src/ui/y.ts is not in the coverage map (run npm run check:map)');
    assert.equal(selection.selected.length, 3);
  },
  async aFixtureWithoutAnEntryRunsForSrcChangesOnly() {
    const forSrc = affected(['src/ui/y.ts'], { fixtures: AFFECTED });
    assert.deepEqual(names(forSrc), ['b', 'b (strict)', 'c']);
    assert.equal(forSrc.why.get('c'), 'no coverage entry yet');
    assert.deepEqual(names(affected(['test/a.html'], { fixtures: AFFECTED })), ['a']);
  },
  async anUnmappedBundleRunsForEverySrcChange() {
    const coverage = { ...COVERAGE, fixtures: { ...COVERAGE.fixtures, c: ['dist/heo-capture.js'] } };
    const selection = affected(['src/ui/y.ts'], { fixtures: AFFECTED, coverage });
    assert.deepEqual(names(selection), ['b', 'b (strict)', 'c']);
    assert.equal(selection.why.get('c'), 'runs dist/heo-capture.js, which has no source map');
    assert.deepEqual(names(affected(['test/a.html'], { fixtures: AFFECTED, coverage })), ['a']);
  },
  async aChangedPageSelectsBothItsVariants() {
    const selection = affected(['test/b.html']);
    assert.deepEqual(names(selection), ['b', 'b (strict)']);
    assert.equal(selection.why.get('b (strict)'), 'its page changed');
  },
  async aHelperSelectsEveryPageThatNamesIt() {
    assert.deepEqual(names(affected(['test/sections.js'])), ['a', 'b', 'b (strict)']);
    // A fetched asset counts too, by its path relative to test/.
    assert.deepEqual(names(affected(['test/nested/theme.css'])), ['b', 'b (strict)']);
  },
  async anUnreferencedTestAssetSelectsAll() {
    const selection = affected(['test/unused.css']);
    assert.equal(selection.all, 'test/unused.css is used by no fixture page that the scan can see');
    assert.equal(selection.selected.length, 3);
  },
  async theHarnessSelectsAll() {
    const selection = affected(['scripts/check-all.mjs']);
    assert.equal(selection.all, 'scripts/check-all.mjs affects the harness or the build');
    assert.equal(selection.selected.length, 3);
    assert.equal(affected(['package.json', 'src/ui/y.ts']).selected.length, 3);
  },
  async docsAndNodeSuitesSelectNothing() {
    const selection = affected(['README.md', '.kiro/x.md', 'test/color.test.ts', 'demo/a.html']);
    assert.equal(selection.all, null);
    assert.deepEqual(names(selection), []);
    assert.deepEqual(selection.ignored, [
      'README.md (docs)',
      '.kiro/x.md (docs)',
      'test/color.test.ts (node suite, run its npm script)',
      'demo/a.html (not part of the suite)',
    ]);
  },
  async coverageMapsCalledFunctionsToTheirSourceAndSkipsTheWrapper() {
    await inTemp((dir) => {
      mkdirSync(join(dir, 'dist'));
      // A bundle of three modules: index (the wrapper's own line), a and b, one line each, and
      // after b a bundler helper with no mapping of its own, which runs at load.
      const text = 'var X=function(){\nfunction a(){return 1}\nfunction b(){return 2}var h=()=>0;\nreturn h(),a()}();\n';
      writeFileSync(join(dir, 'dist', 'app.js'), text);
      writeFileSync(
        join(dir, 'dist', 'app.js.map'),
        JSON.stringify({
          version: 3,
          file: 'app.js',
          sources: ['../src/index.ts', '../src/a.ts', '../src/b.ts'],
          names: [],
          mappings: 'AAAA;ACAA;ACAA;AFAA',
        }),
      );
      writeFileSync(join(dir, 'dist', 'raw.js'), 'function r(){}r();\n');
      const fn = (start, end, count) => ({ functionName: '', isBlockCoverage: false, ranges: [{ startOffset: start, endOffset: end, count }] });
      const lineA = text.indexOf('function a');
      const lineB = text.indexOf('function b');
      const helper = text.indexOf('()=>0');
      const coverage = [
        {
          url: pathToFileURL(join(dir, 'dist', 'app.js')).href,
          functions: [
            fn(0, text.length, 1), // the script's top level
            fn(text.indexOf('function()'), text.length - 4, 1), // the bundle wrapper, mapped to src/index.ts
            fn(lineA, lineA + 22, 1),
            fn(lineB, lineB + 22, 0),
            fn(helper, helper + 5, 1), // nearest mapping is src/b.ts, but not its own: skipped
          ],
        },
        { url: pathToFileURL(join(dir, 'dist', 'raw.js')).href, functions: [fn(0, 19, 1), fn(0, 14, 1), fn(13, 14, 1)] },
        { url: pathToFileURL(join(dir, 'test', 'page.js')).href, functions: [fn(5, 9, 1)] },
      ];
      assert.deepEqual(srcFilesFromCoverage(coverage, dir), ['src/a.ts']);
      assert.deepEqual(unmappedBundles(coverage, dir), ['dist/raw.js']);
    });
  },
  async saveCoverageMergesAndPrunes() {
    await inTemp((dir) => {
      const file = join(dir, 'cache', 'coverage.json');
      assert.equal(loadCoverage(file), null);
      saveCoverage({ a: ['src/b.ts', 'src/a.ts'], gone: ['src/a.ts'] }, file, [page('a'), page('gone'), page('b')]);
      saveCoverage(new Map([['b', ['src/c.ts']]]), file, [page('a'), page('b')]);
      const loaded = loadCoverage(file);
      assert.deepEqual(loaded.fixtures, { a: ['src/a.ts', 'src/b.ts'], b: ['src/c.ts'] });
      assert.ok(!Number.isNaN(Date.parse(loaded.recordedAt)));
      writeFileSync(file, '{"version": 2, "fixtures": {}}');
      assert.equal(loadCoverage(file), null);
    });
  },
  async reportListsRanAndSkippedInDeclaredOrder() {
    const sections = sectionsAt('?only=typing,stops').create(CHAIN);
    ranOf(sections);
    const results = sections.report({ typing: { works: true } });
    // Through JSON: the object comes from the vm's realm, whose arrays have another prototype.
    assert.deepEqual(JSON.parse(JSON.stringify(results.partialRun)), {
      aFullRun: false,
      only: ['typing', 'stops'],
      ran: ['layout', 'gradient', 'stops', 'typing'],
      skipped: ['radial', 'read'],
    });
    assert.deepEqual(Object.keys(results.__sectionMs), ['layout', 'gradient', 'stops', 'typing']);
    // The only boolean the filter adds is the false one that makes the roll-up fail.
    const booleans = JSON.stringify({ p: results.partialRun, s: results.__sectionMs }).match(/true|false/g);
    assert.deepEqual(booleans, ['false']);
  },
};

let passed = 0;
const failures = [];
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    passed++;
    console.log(`  ok ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}\n    ${error.message}`);
  }
}
console.log(`check-harness: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
