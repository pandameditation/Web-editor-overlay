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
 * that is still the right tool for looking at a single failure or taking a screenshot. The large
 * editor pages also declare sections (`test/sections.js`), so `browser-check.mjs … --only <name>`
 * runs part of one; a filtered run reports `partialRun` and never counts as a pass. A page too
 * long to pack well that splits cleanly is split instead (a11y-contrast, by theme).
 *
 * Fields:
 *
 * - `page`     the fixture, relative to the repo root.
 * - `budget`   how long to wait for `RESULTS:…:END` before calling it stuck. A ceiling, not a
 *              cost: the runner polls and moves on the moment a page reports, so a generous
 *              budget is free. Only raise one if a page legitimately needs the time.
 * - `strict`   needs a browser *without* `--allow-file-access-from-files`, so that each file is
 *              its own opaque origin and a sibling stylesheet is genuinely unreadable. These
 *              cannot share a browser with the rest, so the runner opens them in a second
 *              browser (fed from the same queue).
 * - `weight`   wall time in ms, measured in a full run, used only to decide what to start first.
 *              It is the seed: the runner schedules by the times it saved last run (the timings
 *              cache, `scripts/timings.mjs`) and falls back to `weight` only for a page the cache
 *              has no entry for, as in a fresh worktree or after a clean install. Refresh it from
 *              a run's `=== name (Xs) ===` lines or from `check-timing.mjs --weights`. A page with
 *              neither a cached time nor a weight runs first, since its cost is unknown.
 * - `fast`     part of the quick tier. A member must measure <= 5 s in the full suite, so the
 *              tier's fixture phase stays within about 15 s at 6 jobs. It still has one cheap page
 *              for each core contract: writing back, exporting, patching HTML, patching CSS, the
 *              write plan, tokens, the design system, the block library, save state.
 *
 *              The slow pages are deliberately *not* in it, however central: a tier holding a
 *              30-second page is a 30-second tier, which is not an inner loop. When iterating on
 *              one big editor page, run that page alone with its `--only` section filter instead.
 *              The tier is incomplete by construction; the full suite is the gate.
 */
import { readdirSync, readFileSync } from 'node:fs';

export const FIXTURES = [
  /* The big one. 3676 lines over two phases, about 45 s in the suite: its longest page but two. */
  { page: 'test/self-check.html', budget: 60000, weight: 43900 },

  /* Genuinely slow: drives pointer gestures through real rAF-driven acceleration. */
  { page: 'test/edge-scroll.html', budget: 150000, weight: 31700 },
  { page: 'test/library-drag.html', budget: 60000, weight: 7100 },
  { page: 'test/popover-settle.html', budget: 60000, weight: 12800 },
  { page: 'test/reveal.html', budget: 60000, weight: 12400 },
  { page: 'test/arrow-nav.html', budget: 30000, weight: 7200 },
  { page: 'test/dimensional.html', budget: 60000, weight: 13300 },
  { page: 'test/search-field.html', budget: 60000, weight: 11500 },

  { page: 'test/bundle.html', budget: 45000, weight: 7200 },
  { page: 'test/file-access.html', budget: 45000, strict: true, weight: 4200 },
  { page: 'test/chrome-tracking.html', budget: 45000, weight: 6200 },
  { page: 'test/transform-move.html', budget: 90000, weight: 3900 },
  { page: 'test/mirror.html', budget: 45000, strict: true, weight: 2800 },
  { page: 'test/position-pin.html', budget: 90000, weight: 2700 },
  { page: 'test/advisory.html', budget: 45000, weight: 1800 },
  { page: 'test/paste-html.html', budget: 45000, weight: 2700 },
  { page: 'test/plus-create-block.html', budget: 45000, weight: 8000 },
  { page: 'test/block-css-scope.html', budget: 90000, weight: 16000 },
  { page: 'test/multi-select.html', budget: 60000, weight: 8100 },
  { page: 'test/multi-clipboard.html', budget: 60000, weight: 7900 },
  /*
   * Some 820 rows, each settled, over two themes and two page colours: 122 s as one page, so it
   * is split by theme over one harness (test/a11y-contrast.js), each page one theme's two passes
   * and about 46-51 s in the suite (30 s alone).
   */
  { page: 'test/a11y-contrast-dark.html', budget: 120000, weight: 61000 },
  { page: 'test/a11y-contrast-light.html', budget: 120000, weight: 45800 },
  { page: 'test/css-paste.html', budget: 45000, weight: 20100 },
  { page: 'test/capture-paste.html', budget: 60000, weight: 3700, fast: true },
  { page: 'test/capture-roundtrip.html', budget: 60000, weight: 2000 },
  { page: 'test/capture-fidelity.html', budget: 60000, weight: 1400 },
  { page: 'test/capture-lean.html', budget: 90000, weight: 1200 },
  { page: 'test/block-rule-edit.html', budget: 60000, weight: 2300, fast: true },
  { page: 'test/block-css-perf.html', budget: 90000, weight: 1600 },
  { page: 'test/opaque-origin.html', budget: 45000, strict: true, weight: 1900 },
  { page: 'test/link-newtab.html', budget: 45000, weight: 5800 },
  { page: 'test/element-clipboard.html', budget: 45000, weight: 1200 },
  { page: 'test/escape-commits.html', budget: 45000, weight: 1300 },
  { page: 'test/panel-shortcuts.html', budget: 45000, weight: 2900 },
  { page: 'test/toolbar-layout.html', budget: 60000, weight: 14500 },
  { page: 'test/line-break-split.html', budget: 60000, weight: 2000 },
  { page: 'test/line-break-split-seed.html', budget: 45000, weight: 1500 },
  { page: 'test/block-props.html', budget: 45000, weight: 2800 },
  { page: 'test/turn-into.html', budget: 60000, weight: 3500 },
  { page: 'test/form-errors.html', budget: 60000, weight: 2000 },
  { page: 'test/settings-draft.html', budget: 60000, weight: 5900 },
  { page: 'test/design-files.html', budget: 45000, weight: 2600, fast: true },
  { page: 'test/shadow-editor.html', budget: 60000, weight: 17100 },
  { page: 'test/filter-editor.html', budget: 60000, weight: 9500 },
  { page: 'test/motion-section.html', budget: 60000, weight: 10100 },
  { page: 'test/typography.html', budget: 60000, weight: 21100 },
  { page: 'test/project-fonts.html', budget: 60000, weight: 19800 },
  { page: 'test/font-autocomplete.html', budget: 90000, weight: 30200 },
  { page: 'test/split-save-modes.html', budget: 45000, weight: 2600, fast: true },
  { page: 'test/shield.html', budget: 45000, weight: 1500 },
  { page: 'test/bundle.html', budget: 45000, strict: true, weight: 1400 },
  { page: 'test/css-rules.html', budget: 45000, weight: 1600, fast: true },
  { page: 'test/styles-cascade.html', budget: 60000, weight: 10800 },
  { page: 'test/styles-ladder.html', budget: 60000, weight: 10000 },
  { page: 'test/styles-cards.html', budget: 60000, weight: 13800 },
  { page: 'test/styles-save.html', budget: 90000, weight: 3100 },
  { page: 'test/styles-preview.html', budget: 60000, weight: 6800 },
  { page: 'test/styles-sources.html', budget: 90000, weight: 58900 },
  { page: 'test/shorthand-families.html', budget: 30000, weight: 23700 },
  { page: 'test/border-editor.html', budget: 60000, weight: 13700 },
  { page: 'test/background-editor.html', budget: 120000, weight: 19600 },
  { page: 'test/color-picker.html', budget: 90000, weight: 12000 },
  { page: 'test/animation-editor.html', budget: 90000, weight: 7900 },
  { page: 'test/typewriter.html', budget: 60000, weight: 4000 },
  { page: 'test/box-sides.html', budget: 60000, weight: 15900 },
  { page: 'test/rule-authoring.html', budget: 90000, weight: 22900 },
  { page: 'test/style-dialog.html', budget: 45000, weight: 3700, fast: true },
  { page: 'test/html-patch.html', budget: 45000, weight: 2200, fast: true },
  { page: 'test/duplicate-identity.html', budget: 60000, weight: 1000, fast: true },
  { page: 'test/unwrap-text.html', budget: 60000, weight: 1900, fast: true },
  { page: 'test/structural-journal.html', budget: 60000, weight: 1200, fast: true },
  { page: 'test/journal-review.html', budget: 60000, weight: 2900, fast: true },
  /* Thirty random edit sequences, each step undone and redone, every save verified. */
  { page: 'test/journal-fuzz.html', budget: 180000, weight: 26400 },
  /* The same on a long article, with real drags into other elements. */
  { page: 'test/journal-fuzz-article.html', budget: 300000, weight: 57000 },
  { page: 'test/content-model.html', budget: 60000, weight: 2200, fast: true },
  { page: 'test/render-risk.html', budget: 60000, weight: 800, fast: true },
  { page: 'test/token-merge.html', budget: 60000, weight: 800, fast: true },
  { page: 'test/ornament-divider.html', budget: 60000, weight: 1500 },
  { page: 'test/provenance.html', budget: 45000, weight: 1000 },
  { page: 'test/inline-edit-fidelity.html', budget: 45000, weight: 3300, fast: true },
  { page: 'test/undo-identity.html', budget: 60000, weight: 7400 },
  { page: 'test/rewrite-warning.html', budget: 45000, weight: 6000 },
  { page: 'test/stale-marker.html', budget: 45000, weight: 2500, fast: true },
  { page: 'test/seo-writeback.html', budget: 45000, weight: 3700, fast: true },
  { page: 'test/token-target.html', budget: 45000, weight: 900, fast: true },
  { page: 'test/text-drag.html', budget: 45000, weight: 1000 },
  { page: 'test/patch-fidelity.html', budget: 60000, weight: 1500, fast: true },
  { page: 'test/move-across-parents.html', budget: 90000, weight: 2500, fast: true },
  { page: 'test/ai-scope.html', budget: 60000, weight: 1000, fast: true },
  { page: 'test/ai-run.html', budget: 90000, weight: 8900 },
  { page: 'test/ai-keys.html', budget: 60000, weight: 1400, fast: true },
  { page: 'test/seed-parts.html', budget: 60000, weight: 3200, fast: true },
  { page: 'test/ai-ui.html', budget: 60000, weight: 4700, fast: true },
  { page: 'test/design-scope.html', budget: 45000, weight: 1500, fast: true },
  { page: 'test/links.html', budget: 45000, weight: 1400 },
  { page: 'test/text-format.html', budget: 45000, weight: 1500 },
  { page: 'test/text-effects.html', budget: 60000, weight: 2200, fast: true },
  { page: 'test/text-sweep-out.html', budget: 45000, weight: 1300 },
  { page: 'test/block-roundtrip.html', budget: 60000, weight: 1100, fast: true },
  { page: 'test/plan-honesty.html', budget: 45000, weight: 1100, fast: true },
  { page: 'test/late-mount.html', budget: 45000, weight: 1300 },
  { page: 'test/script-tag-manual.html', budget: 45000, weight: 1800 },
  { page: 'test/script-tag.html', budget: 45000, weight: 500 },
  { page: 'test/save-status.html', budget: 60000, weight: 1400, fast: true },
  { page: 'test/download.html', budget: 45000, weight: 900 },
  { page: 'test/writeback.html', budget: 60000, weight: 500, fast: true },
  { page: 'test/selector-reuse.html', budget: 60000, weight: 1200, fast: true },
  { page: 'test/seed-block.html', budget: 45000, weight: 900 },
  { page: 'test/export.html', budget: 45000, weight: 900, fast: true },
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
  'test/styles-shots.html':
    'A page to look at. Sets one panel state from its query string and reports ready.',
  'test/toolbar-shots.html':
    'A page to look at. Sets the floating or docked layout and the theme from its query string, reports ready.',
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

/**
 * The order to start fixtures in.
 *
 * Longest first, so no long page gets picked up last and becomes the run's tail. A page's length
 * is its last measured time (`times`, from the timings cache), else its `weight`. A page with
 * neither runs before all of them, in manifest order: it may be the longest of all, and starting
 * it early is what keeps it from becoming the tail.
 */
export function scheduled(fixtures, times = new Map()) {
  const known = (f) => times.get(fixtureName(f)) ?? f.weight;
  const unknown = fixtures.filter((f) => known(f) === undefined);
  const measured = fixtures.filter((f) => known(f) !== undefined).sort((a, b) => known(b) - known(a));
  return [...unknown, ...measured];
}
