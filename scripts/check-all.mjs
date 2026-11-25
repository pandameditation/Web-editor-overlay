/**
 * Runs the browser suite in one browser per flag group, several pages at a time.
 *
 * The suite used to be forty `&&`-chained invocations of `browser-check.mjs`, each spawning its
 * own Chrome against its own temporary profile. Measuring it showed what that cost: a third of
 * the total wall time was browsers starting up, and the thirty-odd quick fixtures spent about
 * seventy percent of their time on it rather than on testing. Nothing about the fixtures needed
 * to change to get that back — only the thing that was launching them.
 *
 * Two decisions carry the design.
 *
 * **One browser, but a browser context per page.** Reusing a single browser is the whole saving,
 * and it would be unsafe done naively: `--allow-file-access-from-files` puts every `file://`
 * document on one shared origin, and the editor persists a directory handle in IndexedDB, so
 * concurrent fixtures would be reading and writing one store. A browser context is the isolation
 * boundary that fixes it — its own storage, its own cookies — while still costing one process.
 * Pages that run in parallel are therefore as separate as they were when each had its own Chrome,
 * without paying for a Chrome each.
 *
 * **Two browsers, one queue.** The `strict` fixtures need Chrome *without*
 * `--allow-file-access-from-files`, because what they test is the behaviour when a file cannot
 * read its own siblings. A flag is per-process, so they get their own browser. Both start up
 * front and one pool of slots feeds both, each page opened in the browser its flag needs, so the
 * strict pages fill gaps instead of running as a tail after the rest. Thirty-eight spawns become two.
 *
 * **Scheduled by measured time.** Each run saves every finished page's time to the timings cache
 * (`scripts/timings.mjs`, under `node_modules/.cache/`), and the next run starts the longest
 * first by those times, falling back to the manifest's `weight`; a page with neither starts
 * first. Delete the cache to fall back to `weight` alone. With it, the full suite's fixture phase
 * is about 150 s for 108 pages; the fast tier's about 12 s for 31.
 *
 * The suite always runs whole pages. A payload carrying `partialRun` (a page run with an
 * `?only=` section filter, `test/sections.js`) fails, so a filtered page can never pass here.
 *
 * `browser-check.mjs` is untouched and still the right tool for one page: it takes screenshots,
 * it pauses a stuck renderer to print the call stack, and a single failure is much easier to read
 * on its own. This runner points you back to it when something fails.
 *
 * Usage:
 *   node scripts/check-all.mjs                 the whole suite
 *   node scripts/check-all.mjs --fast          the quick tier only
 *   node scripts/check-all.mjs --jobs 4        cap the pages in flight
 *   node scripts/check-all.mjs --serial        one at a time, for comparing against the old shape
 *   node scripts/check-all.mjs --changed       only the fixtures the diff against HEAD can affect
 *   node scripts/check-all.mjs --changed --base main   ... against another ref
 *   node scripts/check-all.mjs --changed --list        print that selection and its reasons, run nothing
 *   node scripts/check-all.mjs --record-coverage       record which src/ files each page runs
 *
 * Every form reads and then updates node_modules/.cache/heo-check/timings.json, except a
 * recording run: coverage slows pages down, and its times would skew the scheduling.
 *
 * `--changed` (npm run check:changed) is for the inner loop and never the gate: it picks pages by
 * the coverage map (`scripts/affected.mjs`, recorded by npm run check:map into
 * node_modules/.cache/heo-check/coverage.json), runs the whole suite when a changed file cannot
 * be placed, saying why, and ends with a CHANGED-ONLY line, then `nothing selected` in place of
 * `all green` when it picked no page. It combines with `--fast` as the
 * intersection. `--record-coverage` refreshes the map for the pages it ran, so it combines with
 * `--fast` or `--changed` too.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  changedFiles,
  loadCoverage,
  saveCoverage,
  selectAffected,
  srcFilesFromCoverage,
  srcImporters,
  unmappedBundles,
} from './affected.mjs';
import { FIXTURES, fixtureName, scheduled, unaccountedPages } from './fixtures.mjs';
import { loadTimings, saveTimings } from './timings.mjs';
import { answerKeys, KEYS_BINDING } from './trusted-keys.mjs';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] ? Number(argv[at + 1]) : fallback;
};
const textOption = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at > -1 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};

const onlyFast = flag('fast');
const onlyChanged = flag('changed');
const listOnly = flag('list');
const recording = flag('record-coverage');
const base = textOption('base', 'HEAD');
if ((listOnly || argv.includes('--base')) && !onlyChanged) {
  console.error('--list and --base go with --changed.');
  process.exit(2);
}
/*
 * Six by default, and not `availableParallelism()`.
 *
 * Each page in flight is a renderer doing real layout work, and past about six they start
 * competing for cores rather than filling idle ones — which lengthens the timing-sensitive
 * fixtures, the ones that measure gesture acceleration against the clock. Six is where the wall
 * time stopped improving here.
 */
const jobs = flag('serial') ? 1 : Math.max(1, Math.min(option('jobs', 6), availableParallelism()));

let chosen = onlyFast ? FIXTURES.filter((f) => f.fast) : FIXTURES;
let selection = null;
if (onlyChanged) {
  let changed;
  try {
    changed = changedFiles(base);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  selection = selectAffected({
    changed,
    fixtures: FIXTURES,
    coverage: loadCoverage(),
    readPage: (page) => readFileSync(page, 'utf8'),
    importers: srcImporters(),
  });
  const picked = new Set(selection.selected);
  chosen = chosen.filter((f) => picked.has(f));
  selection.changed = changed;
}
const missing = chosen.filter((f) => !existsSync(f.page));
if (missing.length) {
  console.error(`Missing fixture file(s):\n${missing.map((f) => `  ${f.page}`).join('\n')}`);
  process.exit(2);
}

/*
 * Refuse to run a suite that is quietly incomplete.
 *
 * Checked on the full run and a changed-only one (which may well select the whole suite): the
 * fast tier is meant to be a subset, so a page missing from it is the design rather than a mistake.
 */
if (!onlyFast || onlyChanged) {
  const unaccounted = unaccountedPages();
  if (unaccounted.length) {
    console.error(
      'These pages report results but are in neither the suite nor the manual list:\n' +
      unaccounted.map((page) => `  ${page}`).join('\n') +
      '\n\nAdd them to FIXTURES, or to MANUAL_PAGES with the reason, in scripts/fixtures.mjs.',
    );
    process.exit(2);
  }
}

/* What a changed-only run picked and why, before anything starts. */
if (selection) {
  const lines = [`\nchanged against ${base}: ${selection.changed.length} file(s)`];
  for (const path of selection.changed) lines.push(`  ${path}`);
  if (selection.all) lines.push(`selected all ${chosen.length} of ${FIXTURES.length} fixtures: ${selection.all}`);
  else {
    lines.push(`selected ${chosen.length} of ${FIXTURES.length} fixtures${onlyFast ? ' (within the fast tier)' : ''}:`);
    for (const f of chosen) lines.push(`  ${fixtureName(f).padEnd(28)}${selection.why.get(fixtureName(f))}`);
  }
  if (selection.ignored.length) lines.push(`ignored: ${selection.ignored.join(', ')}`);
  process.stderr.write(`${lines.join('\n')}\n`);
  if (listOnly) process.exit(0);
}

const binary = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!binary) {
  console.error(`No Chrome-family browser found. Checked:\n${CHROME_CANDIDATES.join('\n')}`);
  process.exit(3);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* -------------------------------------------------------------------------- */
/* One browser, many sessions                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A Chrome process with a browser-level protocol connection.
 *
 * Browser-level rather than page-level, which is what makes the rest possible: creating contexts
 * and targets are browser commands, and `flatten: true` then multiplexes every page's session
 * down the same socket, keyed by `sessionId`.
 */
class Browser {
  #process;
  #socket;
  #nextId = 1;
  #pending = new Map();
  #logsBySession = new Map();
  #stderr = '';

  static async launch({ allowFileAccess }) {
    const browser = new Browser();
    await browser.#start({ allowFileAccess });
    return browser;
  }

  async #start({ allowFileAccess }) {
    const port = 9500 + Math.floor(Math.random() * 400);
    this.profile = mkdtempSync(join(tmpdir(), 'heo-suite-'));
    this.#process = spawn(
      binary,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-component-update',
        '--disable-background-networking',
        '--disable-sync',
        // Kept awake: a backgrounded renderer has its timers throttled, and a suite of pages
        // that all wait on `setTimeout` would crawl or time out with nothing wrong with it.
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        ...(allowFileAccess ? ['--allow-file-access-from-files'] : []),
        `--user-data-dir=${this.profile}`,
        `--remote-debugging-port=${port}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    this.#process.stderr.on('data', (chunk) => (this.#stderr += String(chunk)));

    const version = await this.#waitForDevTools(port);
    this.#socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      this.#socket.addEventListener('open', done, { once: true });
      this.#socket.addEventListener('error', () => fail(new Error('DevTools socket failed')), { once: true });
    });
    this.#socket.addEventListener('message', (event) => this.#receive(JSON.parse(event.data)));
  }

  async #waitForDevTools(port) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) return await response.json();
      } catch {
        /* not up yet */
      }
      await sleep(120);
    }
    throw new Error(`DevTools did not come up on port ${port}.\n${this.#stderr.slice(-1500)}`);
  }

  #receive(message) {
    if (message.id && this.#pending.has(message.id)) {
      const { done, fail } = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message));
      else done(message.result);
      return;
    }
    const session = message.sessionId;
    if (!session) return;
    const logs = this.#logsBySession.get(session);
    if (!logs) return;
    if (message.method === 'Runtime.bindingCalled' && message.params.name === KEYS_BINDING) {
      answerKeys(message.params.payload, (method, args) => this.send(method, args, session)).catch(() => { });
      return;
    }
    /*
     * Recorded in the same shapes `browser-check.mjs` prints.
     *
     * The suite's output is read by eye and by grep — a run is compared against a stored
     * baseline by counting these lines — so the wording is part of the contract, not cosmetic.
     */
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = (message.params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(' ');
      logs.push(`${message.params.type}: ${text}`);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      logs.push(
        `exception: ${details.exception?.description ?? details.text} ` +
        `(${details.url ?? ''}:${details.lineNumber ?? '?'})`,
      );
    }
    if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry;
      if (entry.level === 'error' || entry.level === 'warning') logs.push(`${entry.level}: ${entry.text}`);
    }
    if (message.method === 'Inspector.targetCrashed') logs.push('inspector: the renderer crashed');
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    return new Promise((done, fail) => {
      this.#pending.set(id, { done, fail });
      this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /**
   * An isolated page: its own storage, its own cookies, its own session. With `coverage`, V8
   * precise coverage runs from before the page's first script, for `--record-coverage`.
   */
  async openIsolated(url, { coverage = false } = {}) {
    const { browserContextId } = await this.send('Target.createBrowserContext', {
      disposeOnDetach: false,
    });
    // Blank first, then navigated: the trusted-keys binding has to exist before the page's scripts run.
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.#logsBySession.set(sessionId, []);
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Log.enable', {}, sessionId);
    await this.send('Runtime.addBinding', { name: KEYS_BINDING }, sessionId).catch(() => { });
    await this.send('Page.enable', {}, sessionId);
    if (coverage) {
      await this.send('Profiler.enable', {}, sessionId);
      await this.send('Profiler.startPreciseCoverage', { callCount: false, detailed: false }, sessionId);
    }
    await this.send('Page.navigate', { url }, sessionId);
    return { browserContextId, targetId, sessionId };
  }

  logsFor(sessionId) {
    return this.#logsBySession.get(sessionId) ?? [];
  }

  async closeIsolated({ browserContextId, targetId, sessionId }) {
    this.#logsBySession.delete(sessionId);
    await this.send('Target.closeTarget', { targetId }).catch(() => { });
    await this.send('Target.disposeBrowserContext', { browserContextId }).catch(() => { });
  }

  destroy() {
    try {
      this.#socket?.close();
    } catch {
      /* already gone */
    }
    try {
      this.#process.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    // Chrome's helper processes can hold its stderr pipe open for a minute or more after the
    // browser is killed, and an open pipe keeps this script alive after the summary has printed.
    this.#process?.stderr?.destroy();
    this.#process?.unref();
    try {
      rmSync(this.profile, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Running one fixture                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The src/ files a finished page ran (plus any unmapped `dist/` bundle it ran), or null if the
 * coverage could not be read in time: then the page simply gets no entry this run.
 */
async function takeCoverage(browser, sessionId) {
  const taken = await Promise.race([
    browser.send('Profiler.takePreciseCoverage', {}, sessionId).catch(() => null),
    sleep(30000).then(() => null),
  ]);
  if (!taken?.result) return null;
  const root = process.cwd();
  return [...srcFilesFromCoverage(taken.result, root), ...unmappedBundles(taken.result, root)];
}

/**
 * Open a fixture, wait for it to report, and hand back what it said.
 *
 * The completion contract is the fixtures' own and unchanged: they write
 * `RESULTS:<json>:END` into `#out`, and the current phase into `#progress` so a page that never
 * finishes can still say where it got to.
 */
async function runFixture(browser, fixture) {
  const url = pathToFileURL(resolve(process.cwd(), fixture.page)).href;
  const started = Date.now();
  const handle = await browser.openIsolated(url, { coverage: recording });
  let lastProgress = '(none)';

  /*
   * Every read gets its own deadline, because a page stuck in a synchronous loop never answers.
   * Distinguishing "still working" from "wedged" is the difference between a useful failure and
   * a fixture that sits there until the budget runs out.
   */
  const read = async (id) => {
    const result = await Promise.race([
      browser.send(
        'Runtime.evaluate',
        {
          expression: `(() => { const el = document.getElementById('${id}'); return el ? el.textContent : ''; })()`,
          returnByValue: true,
        },
        handle.sessionId,
      ).catch(() => ({ result: { value: '' } })),
      sleep(5000).then(() => 'WEDGED'),
    ]);
    return result === 'WEDGED' ? 'WEDGED' : String(result.result?.value ?? '');
  };

  try {
    const deadline = Date.now() + fixture.budget;
    while (Date.now() < deadline) {
      const text = await read('out');
      if (text === 'WEDGED') {
        return {
          name: fixtureName(fixture),
          ms: Date.now() - started,
          ok: false,
          reason: `stopped responding after "${lastProgress}"`,
          payload: null,
          logs: browser.logsFor(handle.sessionId),
        };
      }
      if (text.includes(':END')) {
        return {
          name: fixtureName(fixture),
          ms: Date.now() - started,
          ok: true,
          payload: text.slice(text.indexOf('RESULTS:') + 8, text.lastIndexOf(':END')),
          logs: browser.logsFor(handle.sessionId),
          ...(recording ? { coverage: await takeCoverage(browser, handle.sessionId) } : {}),
        };
      }
      const progress = await read('progress');
      if (progress && progress !== 'WEDGED') lastProgress = progress;
      await sleep(120);
    }
    return {
      name: fixtureName(fixture),
      ms: Date.now() - started,
      ok: false,
      reason: `did not finish within ${fixture.budget}ms, last step "${lastProgress}"`,
      payload: null,
      logs: browser.logsFor(handle.sessionId),
    };
  } finally {
    await browser.closeIsolated(handle);
  }
}

/**
 * Run a list through `limit` slots, in `scheduled` order, each page in the browser for its flag.
 *
 * One queue over both browsers: a slot that frees up takes the next page whichever browser it
 * needs, so the pages in flight never exceed `limit` and no group waits for another to finish.
 */
async function runAll(browsers, fixtures, limit, times) {
  const queue = scheduled(fixtures, times);
  const results = [];
  let next = 0;
  const worker = async () => {
    for (; ;) {
      const index = next++;
      if (index >= queue.length) return;
      const fixture = queue[index];
      const browser = fixture.strict ? browsers.strict : browsers.shared;
      const result = await runFixture(browser, fixture).catch((error) => ({
        name: fixtureName(fixture),
        ms: 0,
        ok: false,
        reason: `the runner could not open it: ${error.message}`,
        payload: null,
        logs: [],
      }));
      results.push(result);
      process.stderr.write(
        `${result.ok ? '  ok  ' : ' FAIL '}${result.name.padEnd(26)}${(result.ms / 1000).toFixed(1)}s\n`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return results;
}

/* -------------------------------------------------------------------------- */

/** A page that ran with an `?only=` filter (test/sections.js) checked part of itself. */
const isPartial = (payload) => payload !== null && payload.includes('"partialRun"');

/** A payload reports failure if it says so, or if it never got to say anything. */
function payloadFailed(payload) {
  if (payload === null) return true;
  // A partial run is never a pass, whatever its assertions said. The suite never filters, so this
  // only fires if a page filters by default.
  if (isPartial(payload)) return true;
  // Read as text rather than parsed: a fixture that produced malformed JSON has failed too, and
  // saying so beats throwing inside the reporter.
  if (/"ok"\s*:\s*false/.test(payload)) return true;
  return /"failed"\s*:\s*\[\s*"/.test(payload);
}

const startedAll = Date.now();
const times = loadTimings();
// The shared-origin browser, and the strict one only when a chosen page needs it.
const needs = {
  shared: chosen.some((f) => !f.strict),
  strict: chosen.some((f) => f.strict),
};
const launches = [
  needs.shared ? Browser.launch({ allowFileAccess: true }) : null,
  needs.strict ? Browser.launch({ allowFileAccess: false }) : null,
];
const browserCount = launches.filter(Boolean).length;
process.stderr.write(
  `\n--- ${chosen.length} fixture(s), ${Math.min(jobs, chosen.length)} at a time, ${browserCount} browser(s) ---\n`,
);

const browsers = {};
const all = [];
// Settled rather than `all`, so a browser that did start is still destroyed when the other fails.
const settled = await Promise.allSettled(launches);
[browsers.shared, browsers.strict] = settled.map((s) => (s.status === 'fulfilled' ? s.value : null));
try {
  const failedLaunch = settled.find((s) => s.status === 'rejected');
  if (failedLaunch) throw failedLaunch.reason;
  all.push(...(await runAll(browsers, chosen, jobs, times)));
} finally {
  browsers.shared?.destroy();
  browsers.strict?.destroy();
}
if (recording) {
  const entries = new Map(all.filter((r) => r.ok && r.coverage).map((r) => [r.name, r.coverage]));
  saveCoverage(entries);
  process.stderr.write(`coverage: recorded ${entries.size} of ${all.length} fixture(s)\n`);
} else {
  saveTimings(all, FIXTURES);
}

/*
 * Printed one payload after another, in the shapes the single-page harness used.
 *
 * A run gets compared against a stored baseline by counting lines in it, so keeping the output
 * greppable matters as much as keeping it readable.
 */
const failures = [];
for (const result of all) {
  console.log(`\n=== ${result.name} (${(result.ms / 1000).toFixed(1)}s) ===`);
  if (result.payload !== null) console.log(result.payload);
  else console.log(`(no results: ${result.reason})`);
  if (result.logs.length) {
    console.log('\n--- browser log ---');
    console.log(result.logs.join('\n'));
  }
  if (!result.ok || payloadFailed(result.payload)) {
    const reason = isPartial(result.payload) ? 'ran only part of the page (an ?only= filter)' : 'reported a failing assertion';
    failures.push({ name: result.name, reason: result.reason ?? reason });
  }
}

const elapsed = (Date.now() - startedAll) / 1000;
console.log(`\n${'='.repeat(58)}`);
console.log(`${all.length} fixtures in ${elapsed.toFixed(1)}s, ${jobs} at a time`);
if (onlyChanged) {
  console.log(
    `CHANGED-ONLY: ${all.length} of ${FIXTURES.length} fixtures for the diff against ${base}. ` +
    'Not the gate: run npm run check before finishing.',
  );
}
if (failures.length) {
  console.log(`\n${failures.length} failed:`);
  for (const failure of failures) console.log(`  ${failure.name} — ${failure.reason}`);
  const page = failures[0].name.replace(/ \(strict\)$/, '');
  console.log(
    `\nTo look at one on its own, with a screenshot and a stack if it wedged:\n` +
    `  node scripts/browser-check.mjs test/${page}.html 60000 --shot /tmp/${page}.png`,
  );
  process.exitCode = 1;
} else if (onlyChanged && !all.length) {
  // Not 'all green': nothing ran, and that line is what a reader greps for as the pass.
  console.log('nothing selected');
} else {
  console.log('all green');
}
