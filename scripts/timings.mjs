/**
 * The timings cache: each fixture's last measured wall time, saved by the runners.
 *
 * `scheduled()` orders a run longest first, and the static `weight` in the manifest goes stale as
 * pages grow (some had doubled before anyone noticed). So every run writes what it measured here
 * and the next run schedules by that, keeping `weight` only as the seed for a tree with no cache.
 *
 * Under `node_modules/.cache/`: already ignored by git, the conventional place for tool caches,
 * and per worktree, so each tree schedules by its own times. Deleting it is harmless.
 *
 * Format: `{ "version": 1, "fixtures": { "<fixtureName>": { "ms": 1234, "at": "<ISO date>" } } }`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fixtureName } from './fixtures.mjs';

export const TIMINGS_FILE = 'node_modules/.cache/heo-check/timings.json';

/** Read the cache as `Map<fixtureName, ms>`. A missing or malformed file is an empty cache. */
export function loadTimings(file = TIMINGS_FILE) {
  const times = new Map();
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data?.version !== 1 || typeof data.fixtures !== 'object' || data.fixtures === null) return times;
    for (const [name, entry] of Object.entries(data.fixtures)) {
      if (Number.isFinite(entry?.ms)) times.set(name, entry.ms);
    }
  } catch {
    /* no cache yet, or not one we can read: schedule by weight */
  }
  return times;
}

/**
 * Merge a run's times into the cache.
 *
 * Only pages that reached `:END` are recorded (`ok === true`), whatever their assertions said:
 * a failing assertion still took a real time, but a timeout or a wedge measured the budget, not
 * the page. Names no longer in `fixtures` are dropped. Written through a temporary file and a
 * rename so an interrupted write never leaves half a file. Never throws: the cache is an
 * optimisation, and a run must not fail over it.
 */
export function saveTimings(results, fixtures, file = TIMINGS_FILE) {
  try {
    const names = new Set(fixtures.map(fixtureName));
    let entries = {};
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data?.version === 1 && typeof data.fixtures === 'object' && data.fixtures !== null) entries = data.fixtures;
    } catch {
      /* start a fresh cache */
    }
    const at = new Date().toISOString();
    for (const result of results) {
      if (result.ok === true && Number.isFinite(result.ms)) entries[result.name] = { ms: result.ms, at };
    }
    const kept = Object.fromEntries(Object.entries(entries).filter(([name]) => names.has(name)));
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, fixtures: kept }, null, 1) + '\n');
    renameSync(tmp, file);
  } catch (error) {
    process.stderr.write(`timings: could not save ${file}: ${error.message}\n`);
  }
}
