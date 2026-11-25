# Running checks

The full `npm run check` takes under 3 minutes (~165 s: ~150 s of fixtures, 108 pages, 6 at a time)
and exits on its own with a summary line (`all green` or `N failed:`) and a non-zero exit code on failure.

- Run it in the foreground with an explicit timeout (360 s, 600 s at most). Never run it in the
  background and wait with `sleep` or a polling loop.
- During implement / fix iterations, run `npm run check:fast` (~30 s, 31 cheap pages) plus the
  targeted fixture(s): `node scripts/browser-check.mjs test/<file>.html <ms> [--only <section>]`.
  `--only` runs part of a large page (background-editor, color-picker, border-editor, styles-sources,
  a11y-contrast-dark/-light); such a run reports `partialRun`, prints `PARTIAL RUN`, and never counts
  as a pass.
- `npm run check:changed` runs only the pages the diff against HEAD can reach (by the coverage map),
  for the inner loop, never the gate: a file the map cannot place selects the whole suite, and the
  run ends with a `CHANGED-ONLY` line. `npm run check:map` refreshes the map (~3 minutes); re-run it
  after adding src files or pages.
- Run the full `npm run check` once per task, at the end, diffed against the stored `baseline.log`.
  Reviewers read that log rather than re-running the suite.
- Record a new baseline only when the starting tree changed since the last stored one.
- `npm run check` does not include `typecheck`; run `npm run typecheck` with it.
- When writing workflow briefs, state these rules in the brief so step agents follow them.

Full verification procedure: `.kiro/skills/dev-flow/SKILL.md`, section 6.
