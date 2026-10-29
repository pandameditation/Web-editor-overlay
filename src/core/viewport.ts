/**
 * Evaluating media queries at a width other than the window's.
 *
 * The cascade model has to answer "which rules apply at 320px" while the window is 756 wide, and
 * the top window's `matchMedia` can only answer for 756. An off-screen same-origin iframe sized to
 * the width in question can answer for any width, with the browser's own parser — every syntax,
 * `em` resolution and range form included — so nothing here re-implements media query evaluation.
 *
 * This module also owns the one meaning of a `null` width: the width the page is rendering at
 * right now, which is the preview width while previewing and `innerWidth` otherwise. Every reader
 * goes through `mediaApplies`, so none of them can read the real window by accident while a
 * preview is on.
 */

const WARNING = '[html-editor-overlay] viewport preview unavailable';

/** The top window's answer, for when no other width is being asked about. */
function topMatches(media: string): boolean {
  try {
    return matchMedia(media).matches;
  } catch {
    // The browser drops a query it cannot parse, so it applies to nothing.
    return false;
  }
}

/**
 * Media queries evaluated at any width, by an off-screen iframe.
 *
 * The iframe is created on first use, inside a closed shadow root on a `<span>` under the overlay
 * host, so page CSS cannot reach it and page scripts cannot find it. With no host (an engine
 * driven without `mount()`), the span goes under `<html>` marked `data-heo-internal`, which the
 * export strips and the journal ignores.
 *
 * Resizing the iframe is the expensive part (measured: 78 ms for 500 queries when resized per
 * query, 1.2 ms when resized once), so it is resized only when the size asked for changes, and
 * answers are cached until the next pass.
 */
export class MediaEvaluator {
  readonly #container: () => Element | null;
  #span: HTMLElement | null = null;
  #frame: HTMLIFrameElement | null = null;
  #size = '';
  #cache = new Map<string, boolean>();
  #available = true;

  constructor(container: () => Element | null) {
    this.#container = container;
  }

  /** False once the page has refused an iframe that can answer (sandboxed or CSP-locked). */
  get available(): boolean {
    return this.#available;
  }

  /** The iframe's own `innerWidth`, or null before it exists. For the fixtures. */
  get frameWidth(): number | null {
    return this.#frame?.contentWindow?.innerWidth ?? null;
  }

  /** Evaluate `media` (authored text) at `width` CSS px and the real window height. */
  matches(media: string, width: number): boolean {
    const key = `${width}x${innerHeight}|${media}`;
    const known = this.#cache.get(key);
    if (known !== undefined) return known;
    const win = this.#windowAt(width);
    let verdict: boolean;
    if (!win) verdict = topMatches(media);
    else {
      try {
        verdict = win.matchMedia(media).matches;
      } catch {
        verdict = false;
      }
    }
    this.#cache.set(key, verdict);
    return verdict;
  }

  /** Evaluate many queries at one width, with a single resize. */
  matchAll(medias: readonly string[], width: number): Map<string, boolean> {
    const out = new Map<string, boolean>();
    for (const media of medias) out.set(media, this.matches(media, width));
    return out;
  }

  /** Forget every cached answer, so preference changes are picked up on the next read. */
  beginPass(): void {
    this.#cache.clear();
  }

  destroy(): void {
    this.#span?.remove();
    this.#span = null;
    this.#frame = null;
    this.#size = '';
    this.#cache.clear();
  }

  /** The iframe's window, sized to `width`, or null when the page will not give us one. */
  #windowAt(width: number): Window | null {
    if (!this.#available) return null;
    const frame = this.#ensureFrame();
    const win = frame?.contentWindow ?? null;
    if (!frame || !win) {
      this.#refuse('no frame window');
      return null;
    }
    const size = `${width}x${innerHeight}`;
    if (size !== this.#size) {
      frame.style.width = `${width}px`;
      frame.style.height = `${innerHeight}px`;
      this.#size = size;
      // Reading the size flushes layout, so the frame's media queries see the new width.
      void win.innerWidth;
    }
    return win;
  }

  #ensureFrame(): HTMLIFrameElement | null {
    if (this.#frame?.isConnected) return this.#frame;
    this.#span?.remove();
    const host = this.#container();
    const span = document.createElement('span');
    if (!host) span.setAttribute('data-heo-internal', '');
    const root = span.attachShadow({ mode: 'closed' });
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText =
      'position:fixed;left:-100000px;top:0;border:0;visibility:hidden;pointer-events:none;';
    root.appendChild(frame);
    (host ?? document.documentElement).appendChild(span);
    this.#span = span;
    this.#frame = frame;
    this.#size = '';
    try {
      if (typeof frame.contentWindow?.matchMedia !== 'function') throw new Error('no matchMedia');
      frame.contentWindow.matchMedia('all');
    } catch (error) {
      this.#refuse(error instanceof Error ? error.message : String(error));
      return null;
    }
    return frame;
  }

  #refuse(reason: string): void {
    if (!this.#available) return;
    this.#available = false;
    console.warn(WARNING, reason);
    this.#span?.remove();
    this.#span = null;
    this.#frame = null;
  }
}

/* -------------------------------------------------------------------------- */
/* The bound evaluator                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The engine's evaluator and its preview width, bound at module level.
 *
 * Bound rather than passed, so the cascade model and the legacy readers can ask without importing
 * the engine, which imports them. With nothing bound, every answer is the top window's.
 */
let bound: { evaluator: MediaEvaluator; previewWidth: () => number | null } | null = null;

export function bindViewport(evaluator: MediaEvaluator, previewWidth: () => number | null): void {
  bound = { evaluator, previewWidth };
}

/** Unbind, if `evaluator` is still the bound one: a second engine must not be unbound by the first. */
export function unbindViewport(evaluator: MediaEvaluator): void {
  if (bound?.evaluator === evaluator) bound = null;
}

/** The width the page is rendering at: the preview width while previewing, else `innerWidth`. */
export function effectiveWidth(): number {
  return bound?.previewWidth() ?? innerWidth;
}

/** Start a fresh read of the page's media, as a model build does. */
export function beginMediaPass(): void {
  bound?.evaluator.beginPass();
}

/**
 * Whether `media` applies at `width`.
 *
 * `null` media (no condition) always applies. `null` width means the effective width. The top
 * window answers only when nothing is previewed and the width asked about is the window's own;
 * any other width is the iframe's to answer, so a reader cannot get the real window's answer
 * while a preview is on.
 */
export function mediaApplies(media: string | null, width: number | null): boolean {
  if (media === null || !media.trim()) return true;
  const preview = bound?.previewWidth() ?? null;
  const at = width ?? preview;
  if (at === null || (preview === null && at === innerWidth)) return topMatches(media);
  if (!bound || !bound.evaluator.available) return topMatches(media);
  return bound.evaluator.matches(media, at);
}

/* -------------------------------------------------------------------------- */
/* Authored media text                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every `MediaList` a preview has rewritten, with the text the author wrote.
 *
 * Empty until the preview controller exists to fill it. Readers ask through the accessors below
 * from the start, so the preview can never leak `all` / `not all` into a rule location, a save
 * patch or a label.
 */
const authored = new WeakMap<MediaList, string>();

/** A `MediaList`'s text as authored, through any preview rewrite. */
export function authoredMediaText(list: MediaList): string {
  return authored.get(list) ?? list.mediaText;
}

/** An at-rule's prelude as authored, e.g. `@media (max-width: 767px)`. */
export function authoredPrelude(rule: CSSRule): string {
  if (rule instanceof CSSMediaRule) {
    const text = authored.get(rule.media);
    if (text !== undefined) return `@media ${text}`;
  }
  let css = '';
  try {
    css = rule.cssText ?? '';
  } catch {
    return '';
  }
  const brace = css.indexOf('{');
  return (brace === -1 ? css : css.slice(0, brace)).trim();
}

/**
 * Run a synchronous `fn` with every rewritten `MediaList` back to its authored text.
 *
 * Synchronous only: an async function would run its awaited half with the rewrite back on. With
 * no preview there is nothing to restore, so this is `fn()`.
 */
export function withAuthoredMedia<T>(fn: () => T): T {
  return fn();
}

/** Called by every path that re-parses a stylesheet, so a preview can re-apply. No-op without one. */
export function noteSheetsChanged(): void {
  // Nothing is previewed yet, so a re-parse has nothing to undo.
}
