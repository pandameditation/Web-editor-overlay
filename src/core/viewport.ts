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

import { breakpointOf, isWidthQuery, MAX_VIEWPORT, MIN_VIEWPORT, widthBound } from './breakpoints.js';
import { isEditorOwned } from './dom-journal.js';
import { listen, unlisten } from './shield.js';
import { ManagedStyleSheet } from './stylesheet.js';
import {
  collectBlocks,
  collectInline,
  rereadBlock,
  UNITS_SHEET_ID,
  unitsCss,
  type BlockIndex,
} from './viewport-units.js';

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
 * Run a synchronous `fn` with every rewritten `MediaList` back to its authored text, then re-apply.
 *
 * Synchronous only (L9): an async function would run its awaited half with the rewrite back on.
 * Its one caller is `readStyleSource`, which reassembles a linked sheet from `rule.cssText`, and
 * `cssText` reads `@media not all` while a preview is on. With no preview this is `fn()`.
 */
export function withAuthoredMedia<T>(fn: () => T): T {
  return active ? active.withAuthored(fn) : fn();
}

/** Called by every path that re-parses a stylesheet, so a preview can re-apply. No-op without one. */
export function noteSheetsChanged(): void {
  active?.reconcile();
}

/**
 * Called after a live CSSOM write to a rule's declarations, which re-parses nothing and fires no
 * mutation: a preview restating viewport units reads that rule again. No-op without a preview.
 */
export function noteRuleEdited(rule: CSSRule): void {
  active?.refreshRule(rule);
}

/* -------------------------------------------------------------------------- */
/* The preview                                                                 */
/* -------------------------------------------------------------------------- */

/** The preview that is on, if any: what the module-level hooks above talk to. */
let active: ViewportPreview | null = null;

export interface ViewportPreviewOptions {
  /** After every apply, relayout and restore: the engine re-measures its chrome. */
  onChange: () => void;
  /** The dock's footprint, read fresh on every layout. */
  dock: () => { open: boolean; width: number; floating: boolean };
}

/** What the internal frame sheet is called. Skipped by the rewrite walk, like every internal sheet. */
const FRAME_SHEET_ID = 'heo-viewport-frame';

/** The gap the docked panel keeps from the window edge, which the frame also leaves free. */
const DOCK_GUTTER = 28;

/**
 * Preview the page at a width the window is not.
 *
 * Every width-dependent `MediaList` in the page's sheets is evaluated at the preview width by the
 * evaluator, then rewritten in place to `all` or `not all`; the root is narrowed to the width by an
 * internal sheet. Rule objects keep their identity and index, so live edits, rule locations and the
 * registries' origin maps keep working, and nothing is written to the DOM text, the files, history
 * or the change set. "Actual" puts every list back and removes the sheet.
 *
 * A re-parse (a managed sheet write, a `<style>` edit, a mirror repaint) brings back new rule
 * objects with their real media, so the engine's own writers call `noteSheetsChanged()` and a
 * `MutationObserver` plus a capture-phase `load` listener catch the rest.
 *
 * Width units (`vw`, `vmin`, `clamp(…, 5vw, …)`) would still follow the real window, so every walk
 * also restates them at the preview width in one more internal sheet (`viewport-units.ts`). Live
 * rule writes, which fire no mutation, call `noteRuleEdited()`; inline `style` changes reach the
 * observer. Measured limits (page scripts, fixed elements, cross-origin sheets, `@keyframes`) are
 * the menu's to state.
 */
export class ViewportPreview {
  readonly #evaluator: MediaEvaluator;
  readonly #options: ViewportPreviewOptions;
  #width: number | null = null;
  /** Strong references to every list rewritten in the last walk, so Actual can put each back. */
  #touched: MediaList[] = [];
  #frame: ManagedStyleSheet | null = null;
  #observer: MutationObserver | null = null;
  #height = 0;
  /** Re-entrancy guard: writing the frame sheet is itself a sheet change. */
  #busy = false;
  #frameLeft = 0;
  #unreadable = 0;
  /** The sheet restating width units, last in the document; null when nothing uses one. */
  #units: HTMLStyleElement | null = null;
  #blocks: ReturnType<typeof collectBlocks> = [];
  #inline: ReturnType<typeof collectInline> = [];
  readonly #index: BlockIndex = new Map();
  readonly #onLoad = (event: Event): void => {
    if (event.target instanceof HTMLLinkElement) this.reconcile();
  };

  constructor(evaluator: MediaEvaluator, options: ViewportPreviewOptions) {
    this.#evaluator = evaluator;
    this.#options = options;
  }

  /** The previewed width, or null at Actual. */
  get width(): number | null {
    return this.#width;
  }

  /** The frame's left edge in CSS px; 0 at Actual. */
  get frameLeft(): number {
    return this.#frameLeft;
  }

  /** The evaluator iframe's own `innerWidth`, for the fixtures. */
  get evaluatorWidth(): number | null {
    return this.#evaluator.frameWidth;
  }

  /** Cross-origin sheets the last walk could not rewrite, for the menu. */
  get unreadableSheets(): number {
    return this.#unreadable;
  }

  /** False when the page refuses an evaluator. */
  get available(): boolean {
    return this.#evaluator.available;
  }

  /**
   * Preview `width`, or go back to Actual with null.
   *
   * False when the preview is unavailable or the width is out of range; a no-op when unchanged.
   */
  set(width: number | null): boolean {
    if (width === this.#width) return true;
    if (width === null) {
      this.#restore();
      this.#options.onChange();
      return true;
    }
    if (!Number.isInteger(width) || width < MIN_VIEWPORT || width > MAX_VIEWPORT) return false;
    // Sized once for the whole pass: resizing per query is what costs (§1.1).
    this.#evaluator.beginPass();
    this.#evaluator.matches('(min-width: 0px)', width);
    if (!this.#evaluator.available) return false;
    this.#width = width;
    active = this;
    this.#walk();
    this.#writeFrame();
    this.#connect();
    this.#options.onChange();
    return true;
  }

  /** Re-apply after a sheet change; one walk, and lists already at their verdict are left alone. */
  reconcile(): void {
    if (this.#width === null || this.#busy) return;
    this.#walk();
  }

  /** Recompute the frame's position and rewrite only the frame sheet. No media walk. */
  relayout(): void {
    if (this.#width === null) return;
    this.#writeFrame();
    this.#options.onChange();
  }

  /**
   * The engine's window `resize` handler.
   *
   * Height and orientation queries depend on the window's height, so a height change re-walks;
   * the frame depends on the width and the dock, so it is always relaid out. At Actual this is the
   * geometry bump the handler always was.
   */
  onWindowResize(): void {
    this.#evaluator.beginPass();
    if (this.#width === null) {
      this.#options.onChange();
      return;
    }
    if (innerHeight !== this.#height) this.reconcile();
    this.relayout();
  }

  /** The sheet restating width units, for the fixtures; null at Actual or when nothing needs it. */
  get unitsSheet(): CSSStyleSheet | null {
    return this.#units?.sheet ?? null;
  }

  /** Read one live-edited rule again and restate the units; a full read when it is unknown. */
  refreshRule(rule: CSSRule): void {
    if (this.#width === null) return;
    if (!rereadBlock(rule, this.#index)) this.#blocks = collectBlocks(this.#unitSheets(), this.#index);
    this.#writeUnits();
  }

  /** Run `fn` with every rewritten list at its authored text, then re-apply. */
  withAuthored<T>(fn: () => T): T {
    if (this.#width === null) return fn();
    this.#busy = true;
    try {
      for (const list of this.#touched) setMedia(list, authored.get(list) ?? list.mediaText);
      return fn();
    } finally {
      this.#busy = false;
      this.#walk();
    }
  }

  destroy(): void {
    this.#restore();
    this.#frame?.destroy();
    this.#frame = null;
  }

  /* ---------------------------------------------------------------------- */

  #walk(): void {
    const width = this.#width;
    if (width === null) return;
    this.#busy = true;
    this.#height = innerHeight;
    this.#unreadable = 0;
    const touched: MediaList[] = [];
    const rewrite = (list: MediaList | null | undefined): void => {
      if (!list) return;
      const text = authored.get(list) ?? list.mediaText;
      if (!text.trim() || !isWidthQuery(text)) return;
      authored.set(list, text);
      touched.push(list);
      setMedia(list, this.#evaluator.matches(text, width) ? 'all' : 'not all');
    };
    const visit = (container: CSSStyleSheet | CSSGroupingRule): void => {
      let rules: CSSRuleList;
      try {
        rules = container.cssRules;
      } catch {
        if (container instanceof CSSStyleSheet) this.#unreadable += 1;
        return;
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSImportRule) {
          rewrite(rule.media);
          if (rule.styleSheet) visit(rule.styleSheet);
        } else if (rule instanceof CSSMediaRule) {
          rewrite(rule.media);
          visit(rule);
        } else if (rule instanceof CSSGroupingRule) {
          // `@supports`, `@layer`, `@container`, and a style rule's nested rules.
          visit(rule);
        }
      }
    };
    try {
      for (const sheet of pageSheets()) {
        rewrite(sheet.media);
        visit(sheet);
      }
    } finally {
      this.#touched = touched;
      this.#busy = false;
    }
    // After the media rewrite, so the restatement reads which conditions apply at this width.
    this.#blocks = collectBlocks(this.#unitSheets(), this.#index);
    this.#inline = collectInline();
    this.#writeUnits();
  }

  /**
   * Every document sheet in cascade order, the editor's internal ones included.
   *
   * Included because they style the page too: a save-preview rule has to keep beating the rule it
   * would override. Adopted sheets are left out: they cascade after the units sheet whatever it says.
   *
   * The frame sheet is left out as well. It is rewritten after the walk on every width change, with
   * the walk blocked, so a twin of it would keep the previous width: going from 320 to 768 left
   * `html { width: 320px !important }` restated last, beating the new frame, and the page stayed
   * phone-sized until Actual cleared it. Its declarations are `!important` on the root, so they
   * win over the twins without being restated.
   */
  #unitSheets(): CSSStyleSheet[] {
    return Array.from(document.styleSheets).filter((sheet) => {
      const owner = sheet.ownerNode;
      return owner !== this.#units && !(owner instanceof Element && owner.id === FRAME_SHEET_ID);
    });
  }

  /** Write the units sheet, or remove it when nothing uses a width unit. */
  #writeUnits(): void {
    const width = this.#width;
    const css = width === null ? '' : unitsCss(this.#blocks, this.#inline, width);
    if (!css) {
      this.#units?.remove();
      this.#units = null;
      return;
    }
    if (!this.#units) {
      const style = document.createElement('style');
      style.id = UNITS_SHEET_ID;
      style.setAttribute('data-heo-generated', '');
      style.setAttribute('data-heo-internal', '');
      this.#units = style;
    }
    if (this.#units.textContent !== css) this.#units.textContent = css;
    // Last in the document, after any `<style>` in the body, so the twins come after what they restate.
    const root = document.documentElement;
    if (root.lastElementChild !== this.#units) root.appendChild(this.#units);
  }

  #writeFrame(): void {
    const width = this.#width;
    if (width === null) return;
    const dock = this.#options.dock();
    const available = innerWidth - (dock.open && !dock.floating ? dock.width + DOCK_GUTTER : 0);
    // Centred in the space the docked panel leaves; flush left when the frame is wider than that.
    this.#frameLeft = Math.max(0, Math.floor((available - width) / 2));
    this.#frame ??= new ManagedStyleSheet(FRAME_SHEET_ID, { internal: true });
    this.#busy = true;
    try {
      this.#frame.write(
        `html { width: ${width}px !important; min-width: 0 !important; max-width: none !important; ` +
        `margin-left: ${this.#frameLeft}px !important; margin-right: 0 !important; ` +
        'box-sizing: border-box !important; }',
      );
    } finally {
      this.#busy = false;
    }
  }

  #connect(): void {
    if (this.#observer) return;
    this.#observer = new MutationObserver((records) => {
      if (records.some(touchesPageCss)) this.reconcile();
      // An inline value, or an element moved: inline twins are keyed by position.
      else if (this.#width !== null && records.some((record) => !isEditorOwned(record.target))) {
        this.#inline = collectInline();
        this.#writeUnits();
      }
    });
    this.#observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    listen(document, 'load', this.#onLoad, true);
  }

  #restore(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    unlisten(document, 'load', this.#onLoad, true);
    // A list from a sheet re-parsed since is detached, and writing it back is harmless.
    for (const list of this.#touched) {
      const text = authored.get(list);
      if (text !== undefined) setMedia(list, text);
      authored.delete(list);
    }
    this.#touched = [];
    this.#units?.remove();
    this.#units = null;
    this.#blocks = [];
    this.#inline = [];
    this.#index.clear();
    this.#frame?.write('');
    this.#frameLeft = 0;
    this.#width = null;
    if (active === this) active = null;
  }
}

/** Set a list's text when it differs; a setter that throws leaves that list as it was. */
function setMedia(list: MediaList, text: string): void {
  if (list.mediaText === text) return;
  try {
    list.mediaText = text;
  } catch {
    // Counted as nothing: the list keeps the value it had.
  }
}

/** The page's sheets in cascade order, the editor's internal ones left out. */
function pageSheets(): CSSStyleSheet[] {
  return [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])].filter(
    (sheet) => !(sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-internal')),
  );
}

/** A mutation that can change which page CSS exists: a `<style>`/stylesheet `<link>`, or a `<style>`'s text. */
function touchesPageCss(record: MutationRecord): boolean {
  const isSheet = (node: Node): boolean =>
    node instanceof HTMLStyleElement ||
    (node instanceof HTMLLinkElement && /\bstylesheet\b/i.test(node.rel));
  const ours = (node: Node): boolean =>
    node instanceof Element &&
    (node.hasAttribute('data-heo-internal') || node.hasAttribute('data-heo-generated'));
  if (record.type === 'characterData') {
    const parent = record.target.parentNode;
    return parent instanceof HTMLStyleElement && !ours(parent);
  }
  if (record.target instanceof HTMLStyleElement) return !ours(record.target);
  return [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(
    (node) => isSheet(node) && !ours(node),
  );
}

/* -------------------------------------------------------------------------- */
/* The page's media queries                                                    */
/* -------------------------------------------------------------------------- */

export interface PageMedia {
  /** The condition as authored. */
  media: string;
  /** Style rules under it, nested ones included. */
  rules: number;
}

/**
 * Every distinct media condition in the page's readable sheets, ordered by breakpoint.
 *
 * A max bound sorts just below its width (`max-width: 767px` before `min-width: 768px`), and
 * conditions that are not a single width bound go last, in the order they were first seen.
 */
export function collectPageMedia(): PageMedia[] {
  const counts = new Map<string, number>();
  const styleRules = (container: CSSStyleSheet | CSSGroupingRule): number => {
    let rules: CSSRuleList;
    try {
      rules = container.cssRules;
    } catch {
      return 0;
    }
    let count = 0;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) count += 1;
      if (rule instanceof CSSGroupingRule) count += styleRules(rule);
    }
    return count;
  };
  const note = (media: string, rules: number): void => {
    const text = media.trim();
    if (text) counts.set(text, (counts.get(text) ?? 0) + rules);
  };
  const visit = (container: CSSStyleSheet | CSSGroupingRule): void => {
    let rules: CSSRuleList;
    try {
      rules = container.cssRules;
    } catch {
      return;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule) note(authoredMediaText(rule.media), styleRules(rule));
      if (rule instanceof CSSGroupingRule && !(rule instanceof CSSStyleRule)) visit(rule);
    }
  };
  for (const sheet of pageSheets()) {
    if (sheet.media?.length) note(authoredMediaText(sheet.media), styleRules(sheet));
    visit(sheet);
  }
  // By breakpoint, an upper bound just before the lower bound that starts there: `767.98px` and
  // `767px` both sort as 767.5, ahead of `min-width: 768px`. The raw bound put 767.98 after 768.
  const rank = (media: string): number => {
    const bound = widthBound(media);
    const at = breakpointOf(media);
    if (!bound || at === null) return Number.POSITIVE_INFINITY;
    return bound.side === 'max' ? at - 0.5 : at;
  };
  return [...counts.entries()]
    .map(([media, rules]) => ({ media, rules }))
    .sort((a, b) => rank(a.media) - rank(b.media));
}
