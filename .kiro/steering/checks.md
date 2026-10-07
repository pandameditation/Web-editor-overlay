# Running checks

The full `npm run check` takes about 2 minutes (~105 s) and exits on its own with a summary line
(`all green` or `N failed:`) and a non-zero exit code on failure.

- Run it in the foreground with an explicit timeout (300 s, 600 s at most). Never run it in the
  background and wait with `sleep` or a polling loop.
- During implement / fix iterations, run `npm run check:fast` plus the targeted fixture(s):
  `node scripts/browser-check.mjs test/<file>.html <ms>`.
- Run the full `npm run check` once per task, at the end, diffed against the stored `baseline.log`.
  Reviewers read that log rather than re-running the suite.
- Record a new baseline only when the starting tree changed since the last stored one.
- `npm run check` does not include `typecheck`; run `npm run typecheck` with it.
- When writing workflow briefs, state these rules in the brief so step agents follow them.

Full verification procedure: `.kiro/skills/dev-flow/SKILL.md`, section 6.
