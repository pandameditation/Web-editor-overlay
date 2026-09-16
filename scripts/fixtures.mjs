/**
 * Every browser fixture in the suite, in one list.
 *
 * This used to live in the `check` script as a chain of forty `&&`s, half of them indirect
 * through a `check:*` alias. That made the suite impossible to do anything with except run it
 * end to end: nothing could sort it, group it, time it or split it across cores without first
 * parsing npm scripts. So the list is data now, and `check-all.mjs`, `check-timing.mjs` and the
 * fast tier all read it.
 *
 * The per-fixture `check:*` scripts stay, because they run one page with `browser-check.mjs` and
 * that is still the right tool for looking at a single failure or taking a screenshot.
 *
 * Fields:
 *
 * - `page`     the fixture, relative to the repo root.
 * - `budget`   how long to wait for `RESULTS:…:END` before calling it stuck. A ceiling, not a
 *              cost: the runner polls and moves on the moment a page reports, so a generous
 *              budget is free. Only raise one if a page legitimately needs the time.
 * - `strict`   needs a browser *without* `--allow-file-access-from-files`, so that each file is
 *              its own opaque origin and a sibling stylesheet is genuinely unreadable. These
 *              cannot share a browser with the rest, which is why the runner groups by it.
 * - `weight`   measured wall time in ms, used only to decide what to start first. Longest-first
 *              is what keeps one 30-second page from being picked up last and becoming the whole
 *              run's tail. Advisory: if it goes stale the packing gets slightly worse and
 *              nothing else changes, so it is not worth maintaining by hand.
 * - `fast`     part of the quick tier, chosen by signal per second: the cheap pages, one for each
 *              core contract — writing back, exporting, patching HTML, patching CSS, the write
 *              plan, tokens, the design system, the block library, save state. Ten of them run in
 *              about eight seconds.
 *
 *              The broad slow ones are deliberately *not* in it. `self-check` is the most
 *              thorough page in the suite and takes the better part of a minute on its own, so a
 *              tier containing it is a forty-second tier, which is not an inner loop. The tier is
 *              incomplete by construction, and that is the honest version of a quick check: the
 *              full suite is the gate, and at under a minute it is cheap enough to be one.
 */
import { readdirSync, readFileSync } from 'node:fs';

export const FIXTURES = [
  /* The big one. 3676 lines over two phases, and on its own a quarter of the old suite. */
  { page: 'test/self-check.html', budget: 60000, weight: 55800 },

  /* Genuinely slow: drives pointer gestures through real rAF-driven acceleration. */
  { page: 'test/edge-scroll.html', budget: 150000, weight: 28500 },
  { page: 'test/popover-settle.html', budget: 60000, weight: 16800 },
  { page: 'test/reveal.html', budget: 60000, weight: 13800 },
  { page: 'test/dimensional.html', budget: 60000, weight: 13200 },
  { page: 'test/search-field.html', budget: 60000, weight: 8800 },

  { page: 'test/bundle.html', budget: 45000, weight: 5300 },
  { page: 'test/file-access.html', budget: 45000, strict: true, weight: 5300 },
  { page: 'test/chrome-tracking.html', budget: 45000, weight: 5000 },
  { page: 'test/transform-move.html', budget: 90000, weight: 3800 },
  { page: 'test/mirror.html', budget: 45000, strict: true, weight: 3300 },
  { page: 'test/position-pin.html', budget: 90000, weight: 3200 },
  { page: 'test/advisory.html', budget: 45000, weight: 3200 },
  { page: 'test/paste-html.html', budget: 45000, weight: 3000 },
  { page: 'test/css-paste.html', budget: 45000, weight: 2800, fast: true },
  { page: 'test/opaque-origin.html', budget: 45000, strict: true, weight: 3000 },
  { page: 'test/link-newtab.html', budget: 45000, weight: 3000 },
  { page: 'test/shield.html', budget: 45000, weight: 2900 },
  { page: 'test/bundle.html', budget: 45000, strict: true, weight: 2800 },
  { page: 'test/css-rules.html', budget: 45000, weight: 2400, fast: true },
  { page: 'test/html-patch.html', budget: 45000, weight: 2300, fast: true },
  { page: 'test/duplicate-identity.html', budget: 60000, weight: 2300, fast: true },
  { page: 'test/unwrap-text.html', budget: 60000, weight: 2200, fast: true },
  { page: 'test/ornament-divider.html', budget: 60000, weight: 2300 },
  { page: 'test/provenance.html', budget: 45000, weight: 2300 },
  { page: 'test/inline-edit-fidelity.html', budget: 45000, weight: 5500, fast: true },
  { page: 'test/undo-identity.html', budget: 60000, weight: 9000, fast: true },
  { page: 'test/rewrite-warning.html', budget: 45000, weight: 6500, fast: true },
  { page: 'test/seo-writeback.html', budget: 45000, weight: 4000, fast: true },
  { page: 'test/token-target.html', budget: 45000, weight: 2200, fast: true },
  { page: 'test/text-drag.html', budget: 45000, weight: 2100 },
  { page: 'test/patch-fidelity.html', budget: 60000, weight: 2100, fast: true },
  { page: 'test/move-across-parents.html', budget: 90000, weight: 7000, fast: true },
  { page: 'test/ai-scope.html', budget: 60000, weight: 2000, fast: true },
  { page: 'test/ai-run.html', budget: 90000, weight: 12000, fast: true },
  { page: 'test/ai-keys.html', budget: 60000, weight: 2000, fast: true },
  { page: 'test/seed-parts.html', budget: 60000, weight: 2500, fast: true },
  { page: 'test/ai-ui.html', budget: 60000, weight: 4000, fast: true },
  { page: 'test/design-scope.html', budget: 45000, weight: 2100, fast: true },
  { page: 'test/links.html', budget: 45000, weight: 2100 },
  { page: 'test/text-format.html', budget: 45000, weight: 2000 },
  { page: 'test/text-sweep-out.html', budget: 45000, weight: 2000 },
  { page: 'test/block-roundtrip.html', budget: 60000, weight: 2000, fast: true },
  { page: 'test/plan-honesty.html', budget: 45000, weight: 2000, fast: true },
  { page: 'test/late-mount.html', budget: 45000, weight: 2000 },
  { page: 'test/script-tag-manual.html', budget: 45000, weight: 2000 },
  { page: 'test/script-tag.html', budget: 45000, weight: 2000 },
  { page: 'test/save-status.html', budget: 60000, weight: 1900, fast: true },
  { page: 'test/download.html', budget: 45000, weight: 1900 },
  { page: 'test/writeback.html', budget: 60000, weight: 1900, fast: true },
  { page: 'test/selector-reuse.html', budget: 60000, weight: 1900, fast: true },
  { page: 'test/seed-block.html', budget: 45000, weight: 1900 },
  { page: 'test/export.html', budget: 45000, weight: 1800, fast: true },
];

/**
 * Pages under `test/` that look like fixtures but are deliberately not in the suite.
 *
 * Declared rather than merely absent, because "absent" is also what a fixture someone forgot to
 * register looks like, and a fixture that exists but never runs is the worst outcome available —
 * it reads as coverage and provides none. Two of these were found that way: they emit a
 * `RESULTS:…:END` marker, so they look automated, and they had never been in the chain.
 *
 * The reason is the point of the entry. If one of these ever grows real assertions, move it into
 * `FIXTURES` and delete the line.
 */
export const MANUAL_PAGES = {
  'test/visual.html':
    'A page to look at. Reports "ready" only so a screenshot can be taken once it has settled.',
  'test/css-rules-visual.html':
    'Reports measured panel widths for eyeballing layout. No pass or fail in it.',
  'test/popover-gestures.html':
    'Poked by hand through scripts/firefox-poke.mjs. Emits no results at all.',
};

/**
 * Pages that assert something but are in neither list.
 *
 * The guard against silent coverage loss: adding a fixture and forgetting to register it should be
 * noisy, so the runner refuses to start until the page is either in the suite or explained above.
 * Judged by whether the page emits the completion marker, since that is what makes a page
 * automatable in the first place.
 */
export function unaccountedPages() {
  const registered = new Set(FIXTURES.map((fixture) => fixture.page));
  return readdirSync('test')
    .filter((name) => name.endsWith('.html'))
    .map((name) => `test/${name}`)
    .filter((page) => !registered.has(page) && !(page in MANUAL_PAGES))
    .filter((page) => readFileSync(page, 'utf8').includes('RESULTS:'));
}

/** A stable name for a fixture, since one page appears twice under different flags. */
export function fixtureName(fixture) {
  const base = fixture.page.replace(/^test\//, '').replace(/\.html$/, '');
  return fixture.strict ? `${base} (strict)` : base;
}

/** Longest first, so no long page gets picked up last and becomes the run's tail. */
export function scheduled(fixtures) {
  return [...fixtures].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
}
