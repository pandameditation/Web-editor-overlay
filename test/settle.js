/**
 * An event-based settle for fixture pages: `await HeoSettle.quiet(ms)` instead of a plain
 * `setTimeout(ms)` sleep.
 *
 *   <script src="settle.js"></script>          // BEFORE the bundle, so its timers are seen
 *   <script src="../dist/html-editor-overlay.iife.js"></script>
 *   …
 *   const settle = (ms = 300) => HeoSettle.quiet(ms);
 *
 * Why: most of a large page's run was sleeping. A settle(300) after a click waits 300 ms even
 * when the editor finished re-rendering in two frames. quiet(ms) waits only while something in
 * the page could still change it within those ms, and returns as soon as nothing can.
 *
 * What it watches. At load this script wraps setTimeout / clearTimeout, setInterval /
 * clearInterval, requestAnimationFrame / cancelAnimationFrame and fetch, so it knows every timer
 * and its due time, every interval and its next tick, every pending frame callback and every fetch
 * in flight. A frame callback that asks for itself again from inside its own run is a loop (the
 * font picker re-places its list every frame, writing only when something moved): its next
 * frame does not count as pending, since whatever the loop changes is seen as a mutation; its
 * first frame, asked for from outside, does.
 *
 * quiet(ms) awaits two frames (a style change is computed, a transition has started), then sets
 * its deadline `ms` later, so it is never shorter than either old helper (`setTimeout(ms)` or
 * `frames(); wait(ms)`). Then, every frame, the page is busy if: a tracked timer or an
 * interval's next tick is due before the deadline; a frame callback other than a loop's next is
 * pending; a fetch is in flight; a running or pending animation in the document or any open
 * shadow root (walked recursively, `heo-art-` art loops excluded, as in test/a11y-contrast.js)
 * ends before the deadline; or the document or an open shadow root mutated (attributes,
 * childList, characterData, subtree) since the last check. Busy: wait for the earlier of the
 * next due timer (+1 ms) and the next frame, then check again. Not busy: wait one more frame,
 * and return if that frame was still not busy. At the deadline it returns regardless.
 *
 * Why this preserves what was tested: when nothing is scheduled before the deadline and the DOM
 * has been still for a frame, nothing in the page can change before the deadline without an
 * outside event, and the fixtures send none while they settle. Anything still scheduled makes it
 * wait exactly as long as the fixed wait did. An animation that ends after the deadline is like a
 * timer due after it: the fixed wait read it mid-flight too, so there is no settled state to wait
 * for (a status light's 7.2 s pulse and 1.2 s card transitions kept every settle to its deadline).
 *
 * Known limits. Not tracked: product clock comparisons without a timer (performance.now() < 400
 * in src/ui/panels/styles-panel.ts and src/ui/controls/font-picker.ts; the Date.now merge window
 * in src/core/history.ts; the source-index age in src/core/editor.ts), IndexedDB and file-system
 * promises, font loads. So every page that adopts quiet must keep its booleans identical to its
 * fixed-wait run, and a settle whose duration is itself the input (a held key or pointer, an
 * assertion that something does NOT happen over time) uses `HeoSettle.fixed(ms)`.
 *
 * Its own waits use the saved originals, so they never count as pending. `stats()` returns
 * `{ calls, early, toDeadline, savedMs }` for profiling; do not put it in a page's payload.
 *
 * Classic script, no imports, like test/sections.js.
 */
(() => {
  const original = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    fetch: typeof window.fetch === 'function' ? window.fetch.bind(window) : null,
  };
  const now = () => window.performance.now();

  /** Timer id -> due time; interval id -> next tick; frame id -> is a loop's; fetches in flight. */
  const timers = new Map();
  const intervals = new Map();
  const frames = new Map();
  let fetches = 0;
  /** The frame callback running now, so one that asks for itself again is known as a loop. */
  let running = null;

  window.setTimeout = function setTimeout(handler, ms, ...args) {
    // A string handler is not used by this code base; pass it through untracked.
    if (typeof handler !== 'function') return original.setTimeout(handler, ms, ...args);
    const delay = Math.max(0, Number(ms) || 0);
    const id = original.setTimeout(() => {
      timers.delete(id);
      handler.apply(window, args);
    }, delay);
    timers.set(id, now() + delay);
    return id;
  };
  window.setInterval = function setInterval(handler, ms, ...args) {
    if (typeof handler !== 'function') return original.setInterval(handler, ms, ...args);
    const period = Math.max(0, Number(ms) || 0);
    const id = original.setInterval(() => {
      intervals.set(id, now() + period);
      handler.apply(window, args);
    }, period);
    intervals.set(id, now() + period);
    return id;
  };
  // Browsers let either clear function clear either kind of id.
  const clear = (id) => {
    timers.delete(id);
    intervals.delete(id);
  };
  window.clearTimeout = function clearTimeout(id) {
    clear(id);
    original.clearTimeout(id);
  };
  window.clearInterval = function clearInterval(id) {
    clear(id);
    original.clearInterval(id);
  };
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    const loop = running === callback;
    const id = original.requestAnimationFrame((time) => {
      frames.delete(id);
      const outer = running;
      running = callback;
      try {
        callback(time);
      } finally {
        running = outer;
      }
    });
    frames.set(id, loop);
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    frames.delete(id);
    original.cancelAnimationFrame(id);
  };
  if (original.fetch) {
    window.fetch = function fetch(...args) {
      fetches++;
      let pending;
      try {
        pending = original.fetch(...args);
      } catch (error) {
        fetches--;
        throw error;
      }
      return Promise.resolve(pending).finally(() => {
        fetches--;
      });
    };
  }

  /** Every open shadow root under the document, recursively. */
  const shadowRoots = () => {
    const out = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          out.push(el.shadowRoot);
          visit(el.shadowRoot);
        }
      }
    };
    visit(window.document);
    return out;
  };
  /**
   * When a running or pending finite animation ends, from now, or Infinity for one that will not
   * end on its own (infinite, paused, scroll-driven: its time is not a number of milliseconds).
   */
  const endsIn = (a) => {
    if (!(a.playState === 'running' || a.pending)) return Infinity;
    const end = a.effect?.getComputedTiming?.().endTime;
    const rate = a.playbackRate ?? 1;
    const current = a.currentTime ?? 0;
    if (!Number.isFinite(end) || typeof current !== 'number' || rate === 0) return Infinity;
    return rate > 0 ? (end - current) / rate : current / -rate;
  };
  /** Whether an animation in these roots ends by `deadline` (`heo-art-` art loops excluded). */
  const animating = (roots, deadline) => {
    const left = deadline - now();
    return roots.some((root) =>
      (root.getAnimations ? root.getAnimations() : []).some(
        (a) => endsIn(a) <= left && !(a.animationName ?? '').startsWith('heo-art-'),
      ),
    );
  };

  /** The next frame, or `ms` from now if that comes first (a hidden page gets no frames). */
  const step = (ms) =>
    new Promise((resolve) => {
      let timer = null;
      const frame = original.requestAnimationFrame(() => {
        if (timer !== null) original.clearTimeout(timer);
        resolve();
      });
      timer = original.setTimeout(() => {
        original.cancelAnimationFrame(frame);
        resolve();
      }, Math.max(0, ms));
    });

  const stats = { calls: 0, early: 0, toDeadline: 0, savedMs: 0 };
  const OBSERVE = { attributes: true, childList: true, characterData: true, subtree: true };

  const quiet = async (ms = 300) => {
    stats.calls++;
    const started = now();
    let mutated = false;
    const observer = new window.MutationObserver(() => {
      mutated = true;
    });
    const observed = new Set();
    const roots = () => {
      const all = [window.document, ...shadowRoots()];
      // Roots mounted since the last check are observed from now on.
      for (const root of all) {
        if (observed.has(root)) continue;
        observed.add(root);
        observer.observe(root, OBSERVE);
      }
      return all;
    };
    roots();
    try {
      await step(ms);
      await step(ms);
      const deadline = now() + ms;
      /** The next due time to wake for, null when only a frame will do, false when not busy. */
      const busy = () => {
        const all = roots();
        const changed = mutated || observer.takeRecords().length > 0;
        mutated = false;
        let due = Infinity;
        for (const at of timers.values()) if (at <= deadline && at < due) due = at;
        for (const at of intervals.values()) if (at <= deadline && at < due) due = at;
        if (due !== Infinity) return due;
        let framePending = false;
        for (const loop of frames.values()) if (!loop) framePending = true;
        if (changed || framePending || fetches > 0 || animating(all, deadline)) return null;
        return false;
      };
      let stillFrames = 0;
      while (now() < deadline) {
        const due = busy();
        const left = deadline - now();
        if (due === false) {
          if (stillFrames >= 1) {
            stats.early++;
            stats.savedMs += Math.max(0, Math.round(started + ms - now()));
            return;
          }
          stillFrames++;
          await step(left);
        } else {
          stillFrames = 0;
          await step(due === null ? left : Math.min(left, Math.max(0, due - now()) + 1));
        }
      }
      stats.toDeadline++;
    } finally {
      observer.disconnect();
    }
  };

  /** A plain wait that does not end early: for a hold, or for asserting that nothing happens. */
  const fixed = (ms) => new Promise((resolve) => original.setTimeout(resolve, ms));

  window.HeoSettle = { quiet, fixed, stats: () => ({ ...stats }) };
})();
