/**
 * Which fixtures a diff can affect: the selection behind `check-all.mjs --changed`.
 *
 * The full suite is the gate and stays the gate. This only shortens the inner loop, by running
 * the pages that can see the files you changed instead of all of them.
 *
 * **The src/ -> fixture map is inferred, not declared.** Fixtures load the built bundle
 * (`dist/*.js`), so nothing a page imports traces back to `src/`, and a hand-kept list of which
 * page covers which file, over a hundred-odd entries, would go stale without anyone noticing.
 * Instead `check-all.mjs --record-coverage` (npm run check:map) runs pages with V8 precise
 * coverage on and maps every function that ran back through the bundle's source map to the
 * `src/` file it came from. The map is measured, a recording run refreshes exactly the pages it
 * ran, and a core file (editor.ts, history.ts) correctly selects nearly everything.
 *
 * **Anything it cannot place selects the whole suite, and says why.** A `src/` file no fixture
 * is recorded as covering, no map at all, a test asset no page references, the harness or the
 * build config, a path the rules do not know. The selector's one harmful failure is silently
 * skipping a page that covers the change, and an unplaceable file is exactly where that would
 * happen; running everything once costs about one full suite, and the printed reason says how to
 * fix the map.
 *
 * A bundle that ran with no source map next to it (`dist/heo-capture.js` is built without one)
 * hides which `src/` files it executed, so a page that ran one is recorded with the bundle's path
 * as a marker and is selected for every `src/` change.
 *
 * The cache is `node_modules/.cache/heo-check/coverage.json`, beside the timings cache
 * (`scripts/timings.mjs`): ignored by git, per worktree, harmless to delete.
 * Format: `{ "version": 1, "recordedAt": "<ISO date>", "fixtures": { "<fixtureName>": ["src/…"] } }`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, fixtureName } from './fixtures.mjs';

export const COVERAGE_FILE = 'node_modules/.cache/heo-check/coverage.json';

/* -------------------------------------------------------------------------- */
/* The cache                                                                  */
/* -------------------------------------------------------------------------- */

const readCache = (file) => {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data?.version !== 1 || typeof data.fixtures !== 'object' || data.fixtures === null) return null;
  const fixtures = {};
  for (const [name, files] of Object.entries(data.fixtures)) {
    if (Array.isArray(files)) fixtures[name] = files.filter((f) => typeof f === 'string');
  }
  return { recordedAt: typeof data.recordedAt === 'string' ? data.recordedAt : null, fixtures };
};

/** The recorded map, or `null` when there is none (or none we can read): then every src/ change selects all. */
export function loadCoverage(file = COVERAGE_FILE) {
  try {
    return readCache(file);
  } catch {
    return null;
  }
}

/**
 * Merge a recording run's entries (`{ [fixtureName]: string[] }` or a Map of the same) into the
 * cache: the pages it ran are replaced, the others kept, names no longer in `fixtures` dropped.
 * Written through a temporary file and a rename. Never throws: a run must not fail over its cache.
 */
export function saveCoverage(entries, file = COVERAGE_FILE, fixtures = FIXTURES) {
  try {
    const names = new Set(fixtures.map(fixtureName));
    let existing = {};
    try {
      existing = readCache(file)?.fixtures ?? {};
    } catch {
      /* start a fresh map */
    }
    const merged = { ...existing, ...Object.fromEntries(entries instanceof Map ? entries : Object.entries(entries)) };
    const kept = Object.fromEntries(
      Object.entries(merged)
        .filter(([name]) => names.has(name))
        .map(([name, files]) => [name, [...new Set(files)].sort()]),
    );
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, recordedAt: new Date().toISOString(), fixtures: kept }, null, 1) + '\n');
    renameSync(tmp, file);
  } catch (error) {
    process.stderr.write(`coverage: could not save ${file}: ${error.message}\n`);
  }
}

/* -------------------------------------------------------------------------- */
/* The diff                                                                   */
/* -------------------------------------------------------------------------- */

const git = (args, cwd) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(run.stderr || run.error?.message || '').trim()}`);
  return run.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
};

/**
 * Repo-relative paths changed against `base`: tracked changes (staged or not, including
 * deletions) plus untracked files git does not ignore. `cwd` is the repository root.
 */
export function changedFiles(base = 'HEAD', cwd = process.cwd()) {
  const tracked = git(['diff', '--name-only', base, '--'], cwd);
  const untracked = git(['ls-files', '--others', '--exclude-standard'], cwd);
  return [...new Set([...tracked, ...untracked])].sort();
}

/* -------------------------------------------------------------------------- */
/* Coverage -> src/ files                                                     */
/* -------------------------------------------------------------------------- */

/** Per bundle, its map and line starts, kept while the file is unchanged. */
const bundles = new Map();

function bundleAt(path) {
  const map = `${path}.map`;
  if (!existsSync(path) || !existsSync(map)) return null;
  const stamp = `${statSync(path).mtimeMs}:${statSync(map).mtimeMs}`;
  const cached = bundles.get(path);
  if (cached?.stamp === stamp) return cached;
  const payload = JSON.parse(readFileSync(map, 'utf8'));
  const text = readFileSync(path, 'utf8');
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const bundle = {
    stamp,
    length: text.length,
    lineStarts,
    sourceMap: new SourceMap(payload),
    root: resolve(dirname(map), payload.sourceRoot ?? ''),
    sources: new Map(),
  };
  bundles.set(path, bundle);
  return bundle;
}

/** A character offset as the 0-based (line, column) a source map is keyed by. */
function position(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return [low, offset - lineStarts[low]];
}

/** `file:///<repo>/dist/<name>.js` as `<repo>/dist/<name>.js`, anything else as null. */
function distPath(url, repoRoot) {
  if (!url?.startsWith('file:')) return null;
  let path;
  try {
    path = fileURLToPath(url.replace(/[?#].*$/, ''));
  } catch {
    return null;
  }
  const rel = relative(repoRoot, path).split(sep).join('/');
  return /^dist\/[^/]+\.js$/.test(rel) ? { path, rel } : null;
}

/** Did any function of this script other than the script itself or the bundle wrapper run? */
const ranFunctions = (script, length) =>
  script.functions.filter((fn) => {
    const range = fn.ranges?.[0];
    if (!range || !(range.count > 0)) return false;
    return range.startOffset !== 0 && range.endOffset - range.startOffset <= length / 2;
  });

/**
 * The `src/` files a page executed, from `Profiler.takePreciseCoverage`'s `result`: every function
 * that ran in a `dist/<name>.js` with a map beside it, mapped by its start to its original file.
 *
 * Skipped: the script's own top level and the bundle wrapper, since they span every module; and
 * any function whose start has no mapping of its own. Those are the bundler's helpers
 * (`__decorateClass`, the private-field checks), emitted once per module and run when the module
 * loads, which the nearest earlier mapping would otherwise credit to that module on every page:
 * measured, they made every decorated component look covered by every fixture.
 */
export function srcFilesFromCoverage(scriptCoverages, repoRoot) {
  const files = new Set();
  for (const script of scriptCoverages ?? []) {
    const dist = distPath(script.url, repoRoot);
    if (!dist) continue;
    const bundle = bundleAt(dist.path);
    if (!bundle) continue;
    for (const fn of ranFunctions(script, bundle.length)) {
      const [line, column] = position(bundle.lineStarts, fn.ranges[0].startOffset);
      const entry = bundle.sourceMap.findEntry(line, column);
      const source = entry?.originalSource;
      if (!source || entry.generatedLine !== line || entry.generatedColumn !== column) continue;
      let file = bundle.sources.get(source);
      if (file === undefined) {
        const absolute = source.startsWith('file:') ? fileURLToPath(source) : resolve(bundle.root, source);
        file = relative(repoRoot, absolute).split(sep).join('/');
        bundle.sources.set(source, file);
      }
      if (file.startsWith('src/')) files.add(file);
    }
  }
  return [...files].sort();
}

/** `dist/<name>.js` bundles that ran code but have no map, so what they ran is unknown. */
export function unmappedBundles(scriptCoverages, repoRoot) {
  const found = new Set();
  for (const script of scriptCoverages ?? []) {
    const dist = distPath(script.url, repoRoot);
    if (!dist || existsSync(`${dist.path}.map`)) continue;
    const length = existsSync(dist.path) ? statSync(dist.path).size : Infinity;
    if (ranFunctions(script, length).length) found.add(dist.rel);
  }
  return [...found].sort();
}

/* -------------------------------------------------------------------------- */
/* The selection                                                              */
/* -------------------------------------------------------------------------- */

const NODE_SUITE = /^test\/[^/]+\.test\.(ts|mjs)$/;
const NOT_IN_THE_SUITE = /^(\.kiro|\.agents|demo)\//;

/** At most two reasons in full, then a count. */
const summarise = (reasons) =>
  reasons.length <= 2 ? reasons.join('; ') : `${reasons.slice(0, 2).join('; ')} (+${reasons.length - 2} more)`;

/**
 * The fixtures a list of changed paths can affect.
 *
 * Each path goes through the first rule that claims it:
 *  - `*.md` anywhere, `.kiro/`, `.agents/`, `demo/`: ignored.
 *  - `src/…`: the fixtures recorded as covering it; none, or no map, selects all. Any src/ change
 *    also selects every fixture with no entry yet, and every one that ran an unmapped bundle.
 *  - a FIXTURES page: every fixture on that page (the shared and the strict variant).
 *  - a node suite `test/*.test.ts|mjs`: ignored, it has its own npm script.
 *  - anything else under `test/`: the fixtures whose page text names its path relative to
 *    `test/` (a script tag, a stylesheet link, a fetch string); none selects all.
 *  - anything else (scripts/, package.json, configs, unknown): selects all.
 *
 * `readPage(page)` returns a fixture page's HTML. Returns `{ selected, why, all, ignored }`:
 * `why` maps a selected fixture's name to its reasons, `all` is why the whole suite was chosen
 * (null when it was not), `ignored` lists the paths no rule needs a fixture for, with the note.
 */
export function selectAffected({ changed, fixtures, coverage, readPage }) {
  const reasons = new Map();
  const add = (fixture, reason) => {
    const name = fixtureName(fixture);
    if (!reasons.has(name)) reasons.set(name, []);
    if (!reasons.get(name).includes(reason)) reasons.get(name).push(reason);
  };
  const alls = [];
  const ignored = [];
  const pages = new Map();
  const textOf = (page) => {
    if (!pages.has(page)) {
      let text = '';
      try {
        text = readPage(page) ?? '';
      } catch {
        /* an unreadable page references nothing */
      }
      pages.set(page, text);
    }
    return pages.get(page);
  };
  const entries = coverage?.fixtures ?? null;
  let srcChanged = false;

  for (const path of [...new Set(changed)]) {
    if (path.endsWith('.md')) {
      ignored.push(`${path} (docs)`);
    } else if (NOT_IN_THE_SUITE.test(path)) {
      ignored.push(`${path} (not part of the suite)`);
    } else if (path.startsWith('src/')) {
      srcChanged = true;
      const covering = entries ? fixtures.filter((f) => entries[fixtureName(f)]?.includes(path)) : [];
      if (!covering.length) alls.push(`${path} is not in the coverage map (run npm run check:map)`);
      for (const fixture of covering) add(fixture, `covers ${path}`);
    } else if (fixtures.some((f) => f.page === path)) {
      for (const fixture of fixtures.filter((f) => f.page === path)) add(fixture, 'its page changed');
    } else if (NODE_SUITE.test(path)) {
      ignored.push(`${path} (node suite, run its npm script)`);
    } else if (path.startsWith('test/')) {
      const asset = path.slice('test/'.length);
      const users = fixtures.filter((f) => textOf(f.page).includes(asset));
      if (!users.length) alls.push(`${path} is used by no fixture page that the scan can see`);
      for (const fixture of users) add(fixture, `uses ${path}`);
    } else {
      alls.push(`${path} affects the harness or the build`);
    }
  }

  if (srcChanged) {
    for (const fixture of fixtures) {
      const entry = entries?.[fixtureName(fixture)];
      if (!entry) add(fixture, 'no coverage entry yet');
      else for (const bundle of entry.filter((f) => f.startsWith('dist/'))) add(fixture, `runs ${bundle}, which has no source map`);
    }
  }

  const all = alls.length ? (alls.length === 1 ? alls[0] : `${alls[0]} (+${alls.length - 1} more)`) : null;
  const selected = all ? [...fixtures] : fixtures.filter((f) => reasons.has(fixtureName(f)));
  const why = new Map(selected.map((f) => [fixtureName(f), all ?? summarise(reasons.get(fixtureName(f)))]));
  return { selected, why, all, ignored };
}
