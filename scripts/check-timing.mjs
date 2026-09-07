/**
 * Times every fixture one at a time, and says how much of the suite is not testing.
 *
 * The instrument for any decision about how the suite runs. It answers three questions the
 * aggregate wall time cannot: which pages are actually slow, how much of each page's time is the
 * fixed cost of starting a browser, and whether a page's time is real work or a `wait()` someone
 * left in. Every one of those pointed somewhere different the first time this was run — a single
 * fixture was a quarter of the suite, and a third of the total was Chrome starting up.
 *
 * Deliberately sequential and one browser per page: this measures the *old* shape, which is the
 * baseline any improvement is judged against. `check-all.mjs` reports its own timings for the new
 * shape, so the two together give a before and after.
 *
 * Usage:
 *   node scripts/check-timing.mjs              time every fixture
 *   node scripts/check-timing.mjs --fast       only the quick tier
 *   node scripts/check-timing.mjs --weights    print manifest lines with fresh weights
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { FIXTURES, fixtureName } from './fixtures.mjs';

const onlyFast = process.argv.includes('--fast');
const emitWeights = process.argv.includes('--weights');
const fixtures = onlyFast ? FIXTURES.filter((f) => f.fast) : FIXTURES;

const run = (command) =>
  new Promise((done) => {
    const started = Date.now();
    const child = spawn('zsh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => done({ ms: Date.now() - started, code, output }));
  });

const invoke = (fixture) =>
  run(
    `${fixture.strict ? 'HEO_FILE_ACCESS=strict ' : ''}` +
    `node scripts/browser-check.mjs ${fixture.page} ${fixture.budget}`,
  );

/*
 * The floor: a page that reports before it has done anything.
 *
 * Whatever this costs is spawning a browser, waiting for its debugging port, opening a target and
 * tearing the profile down again — paid once per fixture in the sequential shape. Measuring it
 * rather than guessing is what turned "the suite feels slow" into a number worth acting on.
 */
const FLOOR_PAGE = 'test/tmp-timing-floor.html';
writeFileSync(
  FLOOR_PAGE,
  '<html><body><pre id="progress">floor</pre>' +
  '<pre id="out">RESULTS:{"ok":true}:END</pre></body></html>',
);
let floor;
try {
  floor = await run(`node scripts/browser-check.mjs ${FLOOR_PAGE} 20000`);
} finally {
  rmSync(FLOOR_PAGE, { force: true });
}

const rows = [];
for (const fixture of fixtures) {
  const result = await invoke(fixture);
  rows.push({ name: fixtureName(fixture), page: fixture.page, ...fixture, ms: result.ms, code: result.code });
  process.stderr.write(`${fixtureName(fixture)} ${result.ms}ms${result.code === 0 ? '' : ` EXIT=${result.code}`}\n`);
}

if (emitWeights) {
  console.log('\n/* fresh weights, paste into scripts/fixtures.mjs */');
  for (const row of [...rows].sort((a, b) => b.ms - a.ms)) {
    console.log(
      `  { page: '${row.page}', budget: ${row.budget}` +
      `${row.strict ? ', strict: true' : ''}, weight: ${Math.round(row.ms / 100) * 100}` +
      `${row.fast ? ', fast: true' : ''} },`,
    );
  }
}

rows.sort((a, b) => b.ms - a.ms);
const total = rows.reduce((sum, row) => sum + row.ms, 0);
const overhead = floor.ms * rows.length;
const failures = rows.filter((row) => row.code !== 0);

console.log(`\nfixtures                     ${rows.length}`);
console.log(`floor, one empty page        ${floor.ms}ms`);
console.log(`sum of wall time             ${(total / 1000).toFixed(1)}s`);
console.log(
  `startup, paid ${rows.length}x            ${(overhead / 1000).toFixed(1)}s` +
  `  (${Math.round((overhead / total) * 100)}% of the total)`,
);
console.log(`\n${'fixture'.padEnd(28)}${'wall'.padStart(8)}${'work'.padStart(8)}${'budget'.padStart(9)}`);
for (const row of rows) {
  console.log(
    row.name.padEnd(28) +
    `${(row.ms / 1000).toFixed(1)}s`.padStart(8) +
    // Wall minus the floor: what the page itself spent, with the browser's cost taken out.
    `${Math.max(0, (row.ms - floor.ms) / 1000).toFixed(1)}s`.padStart(8) +
    `${(row.budget / 1000).toFixed(0)}s`.padStart(9) +
    (row.code === 0 ? '' : `  EXIT=${row.code}`),
  );
}

if (failures.length) {
  console.log(`\n${failures.length} fixture(s) exited non-zero: ${failures.map((f) => f.name).join(', ')}`);
  process.exitCode = 1;
}
