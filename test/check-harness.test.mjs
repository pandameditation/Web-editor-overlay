/**
 * Tests the suite runner's own logic: the scheduling order, the timings cache, the section
 * filter pages use for `?only=` and the event-based settle pages use instead of fixed sleeps.
 *
 * Plain Node, no browser: `scheduled()` and `loadTimings`/`saveTimings` are pure enough to drive
 * with made-up fixtures and a temporary file, and `test/sections.js` runs in a `node:vm` context
 * with a stub window, document and location. `test/settle.js` runs in one whose timers and frames
 * are on a fake clock the test advances. Run with: npm run test:harness
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { scheduled } from '../scripts/fixtures.mjs';
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
    window.setTimeout(() => {}, 1000);
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
    other.window.clearInterval(other.window.setInterval(() => {}, 50));
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
