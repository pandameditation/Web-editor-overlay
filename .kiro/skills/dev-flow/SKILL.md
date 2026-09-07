---
name: dev-flow
description: The development process used in this repo — investigate before editing, probe the browser for facts instead of guessing, pin every behaviour change with named fixture assertions, verify against a stored baseline, and clean up after yourself. Use when implementing a feature, fixing a bug, or changing shared UI controls in this codebase.
---

# Development flow

This is the process that works in this repo. It is written from what actually happened, including the
mistakes, because the mistakes are the parts most worth avoiding.

The repo is an in-page visual HTML editor overlay (Lit + TypeScript). Its tests are **browser
fixtures**: HTML pages that mount the overlay, drive it, and print a JSON verdict. There is no unit
test runner for UI behaviour. That shapes everything below.

---

## 0. Mindset, in one line each

- **Check, do not guess.** If you have not read the file, run the command, or measured the value, you
  do not know it. Say so when you don't.
- **Reproduce before fixing.** A fix for a bug you cannot demonstrate is a guess wearing a diff.
- **Root cause over symptom.** Three complaints often share one architectural cause. Find it.
- **Correct the user, with evidence.** They are frequently right about the symptom and wrong about
  the mechanism. Say which, and show what you measured.
- **Report what you could not verify.** "I could not reproduce this" is a result. Claiming a fix you
  did not verify is worse than admitting the gap.
- **Fix what you break, and what you find.** Pre-existing bugs that your feature depends on get
  fixed, and get said out loud.
- **Surface design conflicts, do not silently pick.** If two coherent designs exist and the user has
  stated a preference, follow it and say what you chose against.

---

## 1. Understand before you touch anything

**Never propose or write a change to code you have not read.**

Two tools, two purposes:

- **`context-gatherer` subagent** for anything unfamiliar or spread across files. Give it a *specific*
  prompt: name the files you suspect, the symbols you need, and what you are trying to accomplish.
  Ask for line numbers and real code excerpts. Trust its output as your file reads — do not re-read
  what it returned.
- **Direct `grep`/`read`** for targeted lookups: one function, one call site, one constant.

**Before changing anything shared, enumerate every call site.** This is not optional. Real examples
from this repo:

- Changing popover placement meant finding all six implementations (`value-field`, `search-field`,
  `selector-field`, two adder popups, `extract-dialog`) — they had been written by copying each other
  and shared the same three defects.
- Changing `setAttribute` semantics meant grepping every caller to find which ones relied on the old
  empty-string behaviour. Two did, and both were bugs.
- Adding a batch command meant checking how records reach the **save/writeback** path, which turned
  out to require one record per attribute rather than one per batch. Trace consequences beyond the
  immediate feature.

**Expect the premise to be wrong.** Twice in this session the stated location of a feature was wrong:
the drag-to-scrub was not in the Tokens panel (it was in `heo-value-field`, reached only because
Tokens passes a `label`), and a "crash" turned out to be a popup opening with no focus so keystrokes
went to the document. Verify the premise first; say plainly when it does not hold.

---

## 2. Segment the work, then order it by dependency

Use `todo_list` for anything beyond a couple of steps. Order matters more than granularity:

1. **Core/shared primitives first**, then the places that use them. `src/core/declarations.ts` before
   wiring three panels; `src/ui/place.ts` before the six call sites; the shared `adderStyles` bundle
   before the second panel needed it.
2. **Root cause before surface.** All three code-panel complaints came from the find bar living in the
   panel instead of the editor control. Fixing that fixed all three.
3. **The bug that blocks the feature, first.** Boolean attributes could not be written at all, so the
   attribute adder was fixed only after `setAttribute` was.
4. **Verification last, and as its own task.** It always takes longer than expected.

Mark tasks complete as you finish them, and record the *findings* in the context update, not just
"done" — future-you reads that after compaction.

---

## 3. Probe the browser for facts before designing

This is the highest-leverage habit in this repo. When behaviour depends on what a browser actually
does, **write a throwaway probe and measure it.** Do not reason from memory about CSS or the CSSOM.

Name probes `test/tmp-<topic>.html` so they are identifiable as disposable.

Probes that changed the design in this session:

- `CSS.supports(name, 'initial')` is a reliable *property-name* oracle and accepts deprecated names
  (`font-stretch`, `word-wrap`, `grid-gap`) — which settled how validation should work.
- `setAttribute(name, '')` **removed** the attribute, proving two pre-existing bugs.
- `font-stretch` only moves glyphs when the font has width variation — measured by comparing rendered
  span widths across seven font families. The editor was correct; the font had no `wdth` axis.
- The CSSOM renames `grid-gap` → `gap`, confirming why inline styles must be read from the `style`
  attribute rather than `el.style.cssText`.

**Measure, do not look.** Screenshots in this repo lie: `browser-check.mjs --shot` applies a
device-metrics override *after* the page reports done, which reflows the panel while `position: fixed`
popovers stay where they were placed. That artifact produced two false bug reports. When a screenshot
suggests a layout bug, confirm with `getBoundingClientRect()` before believing it.

**A failed hypothesis is progress — say so and drop it.** The multi-value-computed-string theory for
the Firefox hang was tested and disproved; Firefox collapses those values too.

**Build a harness if you need one.** A Firefox-only bug needed a Firefox harness, so
`scripts/firefox-check.mjs` (WebDriver BiDi) and `scripts/firefox-poke.mjs` (trusted input via
`input.performActions`) were written. Synthetic `dispatchEvent` was not enough: untrusted events do
not focus and do not grant pointer capture, so the gesture silently did nothing.

---

## 4. The fixture method

Every behaviour change gets assertions in a browser fixture. Follow the existing contract.

### The contract

- The page writes `RESULTS:{ ...json... }:END` into `#out` **once, at the end**.
- Progress goes into `#progress`, which the harness watches to report where a hang occurred.
- Run with `node scripts/browser-check.mjs test/<file>.html <timeoutMs>`.

A probe that wrote a full `RESULTS:…:END` on every progress step made the harness read the first
partial payload and stop. Progress and verdict are different channels.

### Assertion style

Name assertions as **sentences describing the intent**, not as labels:

```js
results.styles = {
  keepsTheAuthoredName: ...,
  andNotAlsoTheCanonicalOne: ...,
  laterSpellingWins: ...,
};
```

Compute the roll-up **from the groups**, so a group added later cannot be silently left out:

```js
const failed = Object.entries(results)
  .filter(([, group]) => group && typeof group === 'object')
  .filter(([, group]) => Object.values(group).some((value) => value === false))
  .map(([name]) => name);
```

Put the *reason* in a comment above the assertion, naming the bug it prevents. That is the house
style for code comments too: explain why, referencing what went wrong without it.

### Make assertions discriminating

An assertion that passes for the wrong reason is worse than none. Prove the test exercises the broken
case:

- `rowIsNearTheFold: true` alongside `aLowAnchorStaysOnScreen`, so the placement test is known to
  anchor near the viewport edge.
- `writes: 0` on a `MutationObserver` watching a popover's `style`, which detects an oscillating
  reposition rather than merely a final position.
- After finding `oneUndoEntry` passed because two commits *merged*, wait out the 2.5s merge window so
  the assertion measures what it claims.

### When a fixture fails, suspect the fixture first

In this session the fixture was wrong more often than the product. Real instances:

- Matched `/add declaration/i` against a button reading "Add **2** declarations".
- Asserted against `#para` while a previous block had left `main` selected.
- Measured `engine.records.length` (the save change set) when the claim was about the undo stack.
- Held element references while the panel re-rendered on every preview — **re-query, never hold**.
- Captured a row that moved sections when the property became set, so the reference went stale.
- Used `.mini:last-of-type`, which matches the last *button* that also has the class, not the last
  `.mini`. Target by `aria-label`.
- Clicked a toggle that was already open, closing it.

Add a diagnostic field, print the real state, then fix the assertion. Delete the diagnostic or promote
it to a real assertion before finishing.

---

## 5. Editing discipline (all of these cost real time here)

- **Never put a backtick inside a comment in a Lit `css` or `html` tagged template.** It closes the
  literal and produces a `TS1005` or `Property 'x' does not exist on type 'CSSResult'` pointing
  somewhere unrelated. Hit **six** times. Write "the popup class", not `` `.popup` ``.
- **Never put a file edit and a command that reads that file in the same tool batch.** They race, and
  you will read the pre-edit file and draw a wrong conclusion. Hit twice.
- **Assert your match count before replacing.** `s.index()` silently matches the *first* occurrence,
  and `str.replace` silently does nothing on a miss. A `/* ---- clamp composer ---- */` string that
  existed as both a CSS comment and a method marker matched the wrong one and deleted ~500 lines
  including `render()`. Use a helper:

  ```python
  def once(old, new, tag):
      assert s.count(old) == 1, (tag, s.count(old))
      return s.replace(old, new)
  ```

- **Prefer `python3` heredoc edits with assertions** over blind replacements on large files, and match
  indentation exactly — this repo mixes 6- and 8-space nesting inside template literals.
- **If a write appears not to apply, re-check with `grep -c` before redoing it.** `read_file` can
  return a stale view.
- **If you corrupt a file, restore from `HEAD` and redo in one clean pass.** Do not patch wreckage.
  Check `git show HEAD:<path>` first to confirm what the restore will give you.

---

## 6. Verify, in this order, every time

1. `npm run typecheck`
2. `npm run build` (or `build:lib` for a quick loop)
3. The targeted fixture: `node scripts/browser-check.mjs test/<file>.html <ms>`
4. The full suite: `npm run check` — ~7–8 minutes, so run it in a background process and poll.

**Compare against a stored baseline.** This is the single most useful verification trick here. Keep a
known-good log and diff the set of failing assertions:

```bash
diff <(grep -oE '"[a-zA-Z]+": false' /tmp/baseline.log | sort | uniq -c) \
     <(grep -oE '"[a-zA-Z]+": false' /tmp/new.log       | sort | uniq -c)
```

An empty diff means no regression. Also check, and state, the counts:

- `grep -c '"ok": false'` → must be 0
- `grep -c '"failed": \[\]'` → fixture count, should grow when you add one
- `grep -c 'THREW'` and `grep -c 'exception:'` → must match baseline

**Know your baseline noise.** This repo has one pre-existing `THREW`, two known exceptions from
`test/cached.js` and `test/stories.js`, and a timing flake (`acceleratesWhileHeld`) that flips between
runs. Distinguish those from regressions instead of re-investigating them each time.

**A command exiting 0 is not evidence the feature works.** Only the assertions are.

---

## 7. Clean up, and prove you did

- Delete every `tmp-*` probe once its findings are covered by permanent assertions.
- **Promote before deleting.** If a probe's finding is worth keeping, turn it into a real assertion or
  a permanent fixture first. `test/popover-settle.html` and the Firefox harness came out of throwaway
  probes this way, wired into `package.json` as `check:popover` and `check:firefox`.
- Remove diagnostics you added to fixtures, or convert them to assertions.
- Finish with `git status --short` and confirm only intended files appear. Say what changed.
- Register new fixtures in `package.json` `scripts.check` so they actually run.

---

## 8. Reporting

Lead with the outcome and the verification numbers. Then, per change, **one sentence of mechanism**:
what was wrong, why it was wrong, what it is now. Name the defect, not the diff.

Always include:

- Anything you **could not** verify, plainly.
- Pre-existing bugs found, and whether you fixed them.
- Security consequences, unprompted. Letting a user type arbitrary attributes opened an `on*` handler
  path into a page that gets serialised to disk; that got flagged and closed without being asked.
- Design decisions you made on the user's behalf, and the alternative you rejected.
- Known limitations of the fix, stated as limitations rather than buried.

Do not narrate the journey. The failed hypotheses are worth one line if they change what the user
should believe, and zero lines otherwise.
