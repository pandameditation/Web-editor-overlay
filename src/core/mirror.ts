import { HOST_TAG, MIRROR_ATTR } from './constants.js';
import { absolutizeCssUrls } from './css-urls.js';

/**
 * Stand-ins for stylesheets the browser refuses to expose.
 *
 * A page opened from disk gets one opaque origin per file, so `sheet.cssRules`
 * throws on every `<link>` it has. Everything the editor does with CSS goes through
 * the CSSOM — which rules reach this element, which tokens exist, what a rule edit
 * changes — so all of it silently reported nothing. The rules were there, applying,
 * visibly styling the page, and unreadable.
 *
 * A connected project can read the file's text, and text is same-origin wherever the
 * file came from. So the fix is to hand the page back its own CSS through a channel
 * it is allowed to read: an editor-owned `<style>` holding the file's text, inserted
 * immediately after the `<link>`, with the `<link>` disabled. From that point the
 * sheet is readable *and* writable, which is the whole difference between an editor
 * that can describe a change and one that can show it.
 *
 * Three things make this safe enough to do to a page the editor does not own.
 *
 * The position. The stand-in goes exactly where the `<link>` was, so the cascade is
 * unchanged — an inline `<style>` further down the head still wins the ties it won
 * before. Adopting a constructed sheet instead would have been less code and wrong:
 * `document.adoptedStyleSheets` cascades *after* every sheet in the document, so a
 * mirrored `:root` would have started overriding the editor's own token sheet.
 *
 * The URLs. A `<link>` resolves `url(dot.svg)` against the stylesheet; a `<style>`
 * resolves it against the document. For a stylesheet in a subfolder those are
 * different places, so the text is rewritten to absolute URLs on the way in. The
 * file's own text is never touched — it lives in `sheets.ts`'s cache and is what gets
 * written back.
 *
 * The check. After installing, every element's computed style is compared against
 * what it was a moment earlier, and a mirror that changed anything is removed again.
 * `getComputedStyle().backgroundImage` reports the *resolved* URL, so a botched
 * rewrite is caught by the same comparison that catches a cascade mistake. The page
 * either renders identically or it is left alone.
 */

export interface StyleMirror {
  /** The `<link>` this stands in for. Disabled while the mirror is live. */
  link: HTMLLinkElement;
  /** The stand-in the page renders from. */
  element: HTMLStyleElement;
  /** Absolute URL of the file, so a change record still names the right one. */
  href: string;
}

/*
 * Three ways in, because three different callers hold three different handles: a
 * rule knows its `parentStyleSheet`, a source walk has the `ownerNode`, and the
 * export has the `<link>`.
 */
const bySheet = new WeakMap<CSSStyleSheet, StyleMirror>();
const byElement = new WeakMap<HTMLStyleElement, StyleMirror>();
const byLink = new WeakMap<HTMLLinkElement, StyleMirror>();
const installed = new Set<StyleMirror>();

/**
 * Properties compared before and after installing, to prove nothing moved.
 *
 * Chosen to be cheap and to fail loudly. Layout and paint cover a cascade mistake;
 * the four `url()`-bearing properties cover a rewrite mistake, because a computed
 * image is the absolute URL the browser resolved and so a wrong base shows up as a
 * different string rather than as a missing file nobody notices.
 */
const WITNESS = [
  'display', 'position', 'width', 'height', 'margin-top', 'margin-left',
  'padding-top', 'padding-left', 'border-top-width', 'border-left-width',
  'color', 'background-color', 'background-image', 'border-image-source',
  'list-style-image', 'mask-image', 'font-family', 'font-size', 'font-weight',
  'line-height', 'letter-spacing', 'text-align', 'opacity', 'visibility',
  'flex-direction', 'justify-content', 'align-items', 'gap', 'grid-template-columns',
  'transform', 'box-shadow', 'z-index',
] as const;

/** The mirror standing in for a sheet, when the sheet is one. */
export function styleMirrorFor(sheet: CSSStyleSheet | null | undefined): StyleMirror | undefined {
  return sheet ? bySheet.get(sheet) : undefined;
}

/** The mirror owning an element, when the element is a stand-in. */
export function styleMirrorOfNode(node: Node | null | undefined): StyleMirror | undefined {
  return node instanceof HTMLStyleElement ? byElement.get(node) : undefined;
}

/** True when this `<link>` has been stood in for and is therefore disabled by us. */
export function isMirroredLink(node: Node | null | undefined): boolean {
  return node instanceof HTMLLinkElement && byLink.has(node);
}

/** Every mirror currently in the page. */
export function styleMirrors(): StyleMirror[] {
  return [...installed];
}

/**
 * Put the file's text in front of the page as a readable sheet.
 *
 * Returns the mirror, or null when it could not be installed faithfully — no
 * stylesheet parsed out of the text, or the page did not render identically
 * afterwards. A null is not an error to report: it means the editor stays exactly
 * as capable as it was before, which is the honest fallback.
 */
export function installStyleMirror(link: HTMLLinkElement, css: string): StyleMirror | null {
  const existing = byLink.get(link);
  if (existing) {
    paintStyleMirror(existing, css);
    return existing;
  }
  if (!link.href || !css.trim()) return null;

  const witness = takeWitness();

  const element = document.createElement('style');
  // The marker carries the href it stands for. Everything that acts on this attribute
  // only asks whether it is present, and naming the file makes the stand-in
  // self-describing — which is what lets a registry say where a rule it scanned lives
  // instead of reporting an anonymous inline block.
  element.setAttribute(MIRROR_ATTR, link.href);
  // The `<link>`'s own media query is part of when its rules apply, so it has to
  // come along; without it a print-only sheet would start applying on screen.
  if (link.media) element.media = link.media;
  element.textContent = absolutizeUrls(css, link.href);
  link.after(element);

  /*
   * Checked while the original is still enabled, and that order is the point.
   *
   * Both sheets apply for the length of this check and the stand-in sits immediately
   * after, so it wins every tie: anything it gets *wrong* — a `url()` resolved against
   * the wrong base, a value that does not match, a rule the file does not really have —
   * changes the page here, where backing out is removing one `<style>` and nothing
   * else. Re-enabling a `<link>` is not free: the browser reloads the sheet, and it is
   * gone from `document.styleSheets` until that finishes. Never having to is worth more
   * than the one frame this costs.
   */
  if (!element.sheet || drifted(witness)) {
    element.remove();
    return null;
  }

  link.disabled = true;

  /*
   * Now the only way the page can have moved is if the stand-in is *missing* something
   * the browser loaded — a file edited since the page opened, or a folder that resolved
   * to a different one. Rare, and the recovery is the expensive path: hand the sheet
   * back and let the reload land.
   */
  if (drifted(witness)) {
    link.disabled = false;
    link.removeAttribute('disabled');
    element.remove();
    return null;
  }

  const mirror: StyleMirror = { link, element, href: link.href };
  byLink.set(link, mirror);
  byElement.set(element, mirror);
  if (element.sheet) bySheet.set(element.sheet, mirror);
  installed.add(mirror);
  return mirror;
}

/**
 * Replace a mirror's contents.
 *
 * Through `textContent` rather than the CSSOM, so the browser reparses the whole
 * sheet from text the way it would a file — which is what makes an edit that removes
 * a rule show up on screen, rather than only the ones that add or change.
 */
export function paintStyleMirror(mirror: StyleMirror, css: string): void {
  const next = absolutizeUrls(css, mirror.href);
  if (mirror.element.textContent === next) return;
  mirror.element.textContent = next;
  // Reparsing produces a new `CSSStyleSheet`, so the lookup table has to follow it.
  const sheet = mirror.element.sheet;
  if (sheet) bySheet.set(sheet, mirror);
}

/**
 * Hand every mirrored sheet back to the page.
 *
 * Called on unmount. The `<link>` goes back to loading its own file and the stand-in
 * disappears, so a page the editor is no longer on does not depend on it.
 */
export function releaseStyleMirrors(): void {
  for (const mirror of installed) {
    mirror.element.remove();
    mirror.link.disabled = false;
    // `disabled` reflects to a content attribute, so clearing the property is not
    // enough to leave the markup as it was found.
    mirror.link.removeAttribute('disabled');
    byLink.delete(mirror.link);
    byElement.delete(mirror.element);
  }
  installed.clear();
}

/* -------------------------------------------------------------------------- */
/* Making relative URLs survive the move                                       */
/* -------------------------------------------------------------------------- */

/**
 * Rewrite every relative URL in the text so it still points where it did.
 *
 * The text is about to be read by a `<style>`, which resolves against the document,
 * having been written for a `<link>`, which resolves against itself. Anything already
 * absolute, and anything that is not a fetch at all — `data:`, a bare fragment — is
 * left exactly as written.
 *
 * The scan itself lives in `css-urls.ts`, because the bundle exporter needs the same one
 * to point references at data URLs or at paths inside an archive. Kept as a named
 * re-export rather than replaced at the call sites: this is the mirror's own vocabulary,
 * and the sentence above is what it means here.
 */
export function absolutizeUrls(css: string, base: string): string {
  return absolutizeCssUrls(css, base);
}

/* -------------------------------------------------------------------------- */
/* Proving the page did not move                                               */
/* -------------------------------------------------------------------------- */

function takeWitness(): Map<Element, string> {
  const out = new Map<Element, string>();
  for (const el of document.querySelectorAll('*')) {
    if (skipWitness(el)) continue;
    out.set(el, witnessOf(el));
  }
  return out;
}

/**
 * True when anything the witness covered renders differently now.
 *
 * Only elements present in both readings are compared: installing a mirror adds a
 * `<style>` to the document, and an element that appeared or vanished in between is
 * the page's own doing rather than the mirror's.
 */
function drifted(witness: Map<Element, string>): boolean {
  for (const [el, before] of witness) {
    if (!el.isConnected) continue;
    if (witnessOf(el) !== before) return true;
  }
  return false;
}

function witnessOf(el: Element): string {
  const computed = getComputedStyle(el);
  let row = '';
  for (const property of WITNESS) row += `${computed.getPropertyValue(property)}\u0001`;
  return row;
}

/**
 * The editor's own chrome, and the elements that never render.
 *
 * The overlay host is skipped because its styles are its own business, and `<style>`,
 * `<link>` and `<script>` because comparing the computed style of something with
 * `display: none` proves nothing about the page.
 */
function skipWitness(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === HOST_TAG) return true;
  return tag === 'style' || tag === 'link' || tag === 'script' || tag === 'meta' || tag === 'title';
}
