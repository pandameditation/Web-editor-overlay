/**
 * Runs part of a large fixture page: `?only=<section>[,<section>]`.
 *
 * A page declares its sections once and asks before each one whether to run it:
 *
 *   const sections = HeoSections.create({
 *     names: ['layout', 'gradient', 'stops'],
 *     needs: { stops: ['gradient'] }, // stops builds on what gradient left behind
 *     always: ['layout'],             // defines what every later section uses
 *   });
 *   if (sections.run('gradient')) { … }
 *   …
 *   sections.report(results);         // just before the page's `failed` roll-up
 *
 * Without `only`, `run` returns true for every declared name, so the page behaves exactly as it
 * did before it had sections. With it, the named sections run, plus their `needs` (transitively)
 * and the `always` ones. An unknown name throws, so a typo never yields an empty pass.
 *
 * `run(name)` also writes the name into `#progress` (what the runners print when a page stalls)
 * and times the section. `wants(name)` answers the same question without either side effect.
 * `report(results)` always adds `results.__sectionMs = { name: ms }`, and on a filtered run adds
 * `results.partialRun = { aFullRun: false, only, ran, skipped }`. That group holds a false
 * assertion, so the page's own roll-up lists it in `failed`: a filtered run can never count as a
 * pass. `scripts/browser-check.mjs` prints a PARTIAL RUN line for it and `scripts/check-all.mjs`
 * fails any payload that carries it.
 *
 * Classic script, no imports: it loads with `<script src="sections.js">` after the bundle, so it
 * works under strict file access too.
 */
(() => {
  const create = (spec, search = location.search) => {
    const names = [...spec.names];
    const needs = spec.needs ?? {};
    const always = spec.always ?? [];
    const declared = new Set(names);
    const only = (new URLSearchParams(search).get('only') ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const unknown = only.filter((name) => !declared.has(name));
    if (unknown.length) {
      throw new Error(
        `?only= names unknown section(s) ${unknown.map((name) => `"${name}"`).join(', ')}; this page has: ${names.join(', ')}`,
      );
    }
    const filtered = only.length > 0;
    const chosen = new Set();
    const add = (name) => {
      if (chosen.has(name)) return;
      chosen.add(name);
      for (const need of needs[name] ?? []) add(need);
    };
    if (filtered) [...only, ...always].forEach(add);
    const wants = (name) => !filtered || chosen.has(name);

    const sectionMs = {};
    let current = null;
    let startedAt = 0;
    const close = () => {
      if (current !== null) sectionMs[current] = Math.round(performance.now() - startedAt);
      current = null;
    };
    const run = (name) => {
      if (!declared.has(name)) throw new Error(`sections.run("${name}"): not a declared section`);
      close();
      if (!wants(name)) return false;
      const progress = document.getElementById('progress');
      if (progress) progress.textContent = name;
      current = name;
      startedAt = performance.now();
      return true;
    };
    const report = (results) => {
      close();
      results.__sectionMs = { ...sectionMs };
      if (filtered) {
        results.partialRun = {
          aFullRun: false,
          only: [...only],
          ran: names.filter(wants),
          skipped: names.filter((name) => !wants(name)),
        };
      }
      return results;
    };
    return { filtered, wants, run, report };
  };
  window.HeoSections = { create };
})();
