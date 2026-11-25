/**
 * Tests the suite runner's own logic: the scheduling order and the timings cache.
 *
 * Plain Node, no browser: `scheduled()` and `loadTimings`/`saveTimings` are pure enough to drive
 * with made-up fixtures and a temporary file. Run with: npm run test:harness
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scheduled } from '../scripts/fixtures.mjs';
import { loadTimings, saveTimings } from '../scripts/timings.mjs';

const page = (name, extra = {}) => ({ page: `test/${name}.html`, budget: 1000, ...extra });
const order = (fixtures, times) => scheduled(fixtures, times).map((f) => f.page.slice(5, -5));

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
