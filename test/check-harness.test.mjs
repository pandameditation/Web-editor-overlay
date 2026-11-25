/**
 * Tests the suite runner's own logic: the scheduling order, the timings cache and the section
 * filter pages use for `?only=`.
 *
 * Plain Node, no browser: `scheduled()` and `loadTimings`/`saveTimings` are pure enough to drive
 * with made-up fixtures and a temporary file, and `test/sections.js` runs in a `node:vm` context
 * with a stub window, document and location. Run with: npm run test:harness
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
