import {
  archivePath,
  assetUrl,
  collectDocumentAssets,
  fetchAsset,
  fileNameOf,
  localAssetLimit,
  relativeAssetPath,
  toDataUrl,
  type AssetKind,
  type AssetRef,
} from './assets.js';
import { rewriteCssUrls } from './css-urls.js';
import type { FileHost } from './file-host.js';
import { makeZip, type ZipEntry } from './zip.js';

/**
 * Writing the edited page out as something a person can open.
 *
 * The overlay's other save routes both assume a codebase on the other side: a connected
 * folder gets its files patched, and everything else got a prompt describing the changes
 * for someone to apply. Neither is what a person editing a page they *have* wants. They
 * want the page — the file they opened, with their edits in it, ready to open again or hand
 * to somebody.
 *
 * Two shapes, and which one you get follows from one decision made three times rather than
 * being a third question. Styles, scripts and images are each either folded into the HTML
 * or left as references:
 *
 * - **Everything folded in** is one self-contained `.html`. Stylesheets become `<style>`,
 *   scripts become inline `<script>`, images become `data:` URIs. It opens anywhere,
 *   including from an email attachment, and it is larger — base64 costs a third.
 * - **Anything left as a reference** needs those files to exist beside the HTML, which a
 *   browser can only hand over as an archive. So the output becomes a `.zip` holding the
 *   page and its assets at the paths the page already uses.
 *
 * Deriving the shape rather than asking for it removes the one combination that cannot
 * work: a single file that still points at files nobody has.
 *
 * **What limits this is not the code, it is the origin.** A page opened from disk cannot
 * read the files beside it — see `assets.ts` — so on `file://` with no folder connected
 * there is nothing to fold in and the honest output is the HTML alone. Every asset that
 * could not be read is reported rather than skipped quietly, because "self-contained" that
 * silently is not would be the worst thing this could produce.
 */

/** Whether a category travels inside the HTML or stays a reference beside it. */
export type AssetPlacement = 'inline' | 'external';

export interface BundleOptions {
  styles: AssetPlacement;
  scripts: AssetPlacement;
  images: AssetPlacement;
}

export const DEFAULT_BUNDLE_OPTIONS: BundleOptions = {
  styles: 'inline',
  scripts: 'inline',
  images: 'inline',
};

/** One file the export will produce. */
export interface BundleFile {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** What this is, for the UI to group and count. */
  kind: AssetKind | 'document';
}

/** An asset that was meant to travel and could not. */
export interface BundleOmission {
  kind: AssetKind;
  url: string;
  /** File name, for a list a person reads. */
  label: string;
  reason: string;
}

export interface BundlePlan {
  /** `single` when everything is folded in, `archive` when files sit beside the HTML. */
  shape: 'single' | 'archive';
  /** Suggested download name, with the right extension for the shape. */
  fileName: string;
  files: BundleFile[];
  /** Assets that stayed external because their bytes could not be read. */
  omitted: BundleOmission[];
  /** Total bytes the download will be. */
  size: number;
  /**
   * Whether the HTML came from patching the page's own file.
   *
   * The same distinction `exportPageHTML` reports, and it matters as much here: a patched
   * document keeps the author's formatting and changes only the lines that changed, while a
   * serialized one is the DOM rewritten. Carried so the UI can say which happened.
   */
  patched: boolean;
  /** Why the document had to be serialized, when it did. */
  why: string[];
}

/** What the bundler needs, without reaching into the engine. */
export interface BundleSubject {
  /** The edited document, patched from source where that was possible. */
  html: string;
  patched: boolean;
  why: string[];
  /** Name to suggest, before the extension is settled. */
  fileName: string;
  project?: FileHost | null;
}

/* -------------------------------------------------------------------------- */
/* What is on offer here                                                       */
/* -------------------------------------------------------------------------- */

/** Whether a category has anything to decide about, and whether inlining can work. */
export interface CategoryReport {
  kind: AssetKind;
  /** How many external references of this kind the document has. */
  count: number;
  /** How many of those could actually be read. */
  readable: number;
  /** Why the unreadable ones cannot be had. Empty when everything is readable. */
  reason?: string;
}

export interface BundleSurvey {
  categories: CategoryReport[];
  /** Every reference found, for a caller that wants the detail. */
  assets: AssetRef[];
}

/**
 * What the page is made of, before anything is built.
 *
 * Cheap — it parses the export and resolves URLs, and reads nothing — so the dialog can
 * run it on every render to keep the checkboxes honest about what they would do. The
 * expensive half, actually fetching the bytes, happens in `buildBundle`.
 */
export function surveyBundle(subject: BundleSubject): BundleSurvey {
  const doc = new DOMParser().parseFromString(subject.html, 'text/html');
  const assets = collectDocumentAssets(doc, { project: subject.project });
  const kinds: AssetKind[] = ['style', 'script', 'image'];

  const categories = kinds.map((kind) => {
    const mine = assets.filter((asset) => asset.kind === kind);
    const readable = mine.filter((asset) => asset.reachable);
    const blocked = mine.find((asset) => !asset.reachable);
    return {
      kind,
      count: mine.length,
      readable: readable.length,
      reason: blocked?.reason,
    };
  });

  return { categories, assets };
}

/* -------------------------------------------------------------------------- */
/* Building it                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the export.
 *
 * Order matters in one place: stylesheets are handled before images, because inlining a
 * stylesheet brings its own `url()` references into the document, and those are images
 * that then have to be dealt with too. Doing it the other way round would inline every
 * image the HTML mentions and none of the ones the CSS does.
 */
export async function buildBundle(
  subject: BundleSubject,
  options: BundleOptions,
): Promise<BundlePlan> {
  const doc = new DOMParser().parseFromString(subject.html, 'text/html');
  const project = subject.project ?? null;
  const omitted: BundleOmission[] = [];
  const files: BundleFile[] = [];
  const taken = new Set<string>();
  /** Assets already written into the archive, so two references share one file. */
  const archived = new Map<string, string>();

  const omit = (kind: AssetKind, url: string, reason: string): void => {
    if (omitted.some((entry) => entry.url === url)) return;
    omitted.push({ kind, url, label: fileNameOf(url), reason });
  };

  /**
   * Place one asset: a `data:` URI when it is travelling inline, an archive path when it
   * is not, or null to leave the reference exactly as written.
   */
  const place = async (
    url: string,
    kind: AssetKind,
    placement: AssetPlacement,
  ): Promise<string | null> => {
    if (placement === 'external') {
      const existing = archived.get(url);
      if (existing) return existing;
      const bytes = await fetchAsset(url, project);
      // Unreadable and staying external is not a failure — the reference still points
      // where it always did, and the archive is simply missing a copy. Said out loud
      // because "download the zip and it works" would otherwise be untrue.
      if (!bytes) {
        omit(kind, url, unreadable(url, kind, project));
        return null;
      }
      const path = archivePath(url, taken);
      archived.set(url, path);
      files.push({ path, bytes: bytes.bytes, kind });
      // Only rewritten when the archive path differs from what the document already
      // says, so a page whose assets are already relative keeps its own references.
      return path === relativeAssetPath(url) ? null : path;
    }

    const bytes = await fetchAsset(url, project);
    if (!bytes) {
      omit(kind, url, unreadable(url, kind, project));
      return null;
    }
    return toDataUrl(bytes);
  };

  /* ---- Stylesheets ---- */

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const raw = link.getAttribute('href') ?? '';
    const url = assetUrl(raw);
    if (!url) continue;

    if (options.styles === 'external') {
      const path = await place(url, 'style', 'external');
      if (path) link.setAttribute('href', path);
      continue;
    }

    const asset = await fetchAsset(url, project);
    if (!asset) {
      omit('style', url, unreadable(url, 'style', project));
      continue;
    }
    /*
     * The text is moving from a `<link>`, which resolves relative URLs against itself, to
     * a `<style>`, which resolves them against the document. Rewriting them is not a
     * nicety: a stylesheet in `css/` referring to `../img/hero.png` would otherwise point
     * one directory too high the moment it was inlined.
     */
    const css = rewriteCssUrls(new TextDecoder().decode(asset.bytes), (raw2) => {
      const resolved = assetUrl(raw2, url);
      return resolved && resolved !== raw2 ? resolved : null;
    });
    const style = doc.createElement('style');
    style.textContent = css;
    // The media query was part of when the sheet applied, so it comes along.
    const media = link.getAttribute('media');
    if (media) style.setAttribute('media', media);
    link.replaceWith(style);
  }

  /* ---- Scripts ---- */

  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const raw = script.getAttribute('src') ?? '';
    const url = assetUrl(raw);
    if (!url) continue;

    if (options.scripts === 'external') {
      const path = await place(url, 'script', 'external');
      if (path) script.setAttribute('src', path);
      continue;
    }

    const asset = await fetchAsset(url, project);
    if (!asset) {
      omit('script', url, unreadable(url, 'script', project));
      continue;
    }
    /*
     * `src` goes and the text arrives, and every other attribute stays.
     *
     * `type="module"` in particular: a module's semantics — deferred, strict, its own
     * scope — are not the same as a classic script's, and dropping the attribute would
     * change what the code means. `defer` is left alone too, harmless on an inline
     * classic script and meaningful on nothing else.
     */
    script.removeAttribute('src');
    script.textContent = new TextDecoder().decode(asset.bytes);
  }

  /* ---- Images, including the ones the CSS just brought in ---- */

  for (const el of Array.from(doc.querySelectorAll('[src], [poster], [href], [srcset]'))) {
    for (const attribute of ['src', 'poster', 'href'] as const) {
      if (!el.hasAttribute(attribute)) continue;
      if (attribute === 'href' && !isImageHref(el)) continue;
      if (attribute === 'src' && el.tagName.toLowerCase() === 'script') continue;
      const url = assetUrl(el.getAttribute(attribute) ?? '');
      if (!url) continue;
      const next = await place(url, 'image', options.images);
      if (next) el.setAttribute(attribute, next);
    }

    if (el.hasAttribute('srcset')) {
      const rewritten: string[] = [];
      for (const entry of (el.getAttribute('srcset') ?? '').split(',')) {
        const parts = entry.trim().split(/\s+/);
        const candidate = parts.shift() ?? '';
        const url = assetUrl(candidate);
        if (!url) {
          rewritten.push(entry.trim());
          continue;
        }
        const next = await place(url, 'image', options.images);
        rewritten.push([next ?? candidate, ...parts].join(' '));
      }
      if (rewritten.length) el.setAttribute('srcset', rewritten.join(', '));
    }
  }

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const css = style.textContent ?? '';
    if (!css) continue;
    // Collected first, then replaced, because the placement is asynchronous and the
    // rewriter is not — so the map is built up front and applied in one pass.
    const map = new Map<string, string>();
    for (const raw of cssReferences(css)) {
      const url = assetUrl(raw);
      if (!url) continue;
      const next = await place(url, 'image', options.images);
      if (next) map.set(raw, next);
    }
    if (!map.size) continue;
    style.textContent = rewriteCssUrls(css, (raw) => map.get(raw.trim()) ?? null);
  }

  /* ---- Out it comes ---- */

  const shape: BundlePlan['shape'] = files.length ? 'archive' : 'single';
  const base = exportBase(subject.fileName);
  const html = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`;
  const document_: BundleFile = {
    path: `${base}.html`,
    bytes: new TextEncoder().encode(html),
    kind: 'document',
  };

  const all = [document_, ...files];
  return {
    shape,
    fileName: shape === 'single' ? `${base}.html` : `${base}.zip`,
    files: all,
    omitted,
    size: all.reduce((total, file) => total + file.bytes.length, 0),
    patched: subject.patched,
    why: subject.why,
  };
}

/**
 * The plan as the bytes that will be written.
 *
 * One file is itself; more than one can only travel as an archive. Split from the
 * download because the same bytes now have two possible destinations — a handle the user
 * picked, or the browser's download folder — and which one it is should not change what
 * gets written.
 */
export async function bundleBlob(plan: BundlePlan): Promise<Blob> {
  if (plan.shape === 'single') {
    return new Blob([plan.files[0].bytes], { type: 'text/html;charset=utf-8' });
  }
  const entries: ZipEntry[] = plan.files.map((file) => ({ path: file.path, bytes: file.bytes }));
  return makeZip(entries);
}

/**
 * The same export under a different name.
 *
 * Renaming is not rebuilding. The name has no bearing on a single byte of what the export
 * contains, and rebuilding to change it would re-read every asset the page refers to — so
 * a field someone is typing into would either lag behind them or hammer the network. This
 * moves the two places the name appears: the download's own name, and the document's path,
 * which inside an archive is a real entry someone will see when they unzip it.
 */
export function renameBundle(plan: BundlePlan, fileName: string): BundlePlan {
  const base = exportBase(fileName);
  return {
    ...plan,
    fileName: bundleName(base, plan.shape),
    files: plan.files.map((file) =>
      file.kind === 'document' ? { ...file, path: `${base}.html` } : file,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Why an asset's bytes could not be had, in a sentence naming the file.
 *
 * `assets.ts` answers this before anything is attempted, and this is the answer after —
 * for the cases a survey cannot predict, chiefly a file that is simply not there. Kept
 * separate so a 404 does not get explained as an origin problem.
 */
function unreadable(url: string, kind: AssetKind, project?: FileHost | null): string {
  const limit = localAssetLimit();
  if (limit && !project?.resolve(url)) return limit;
  const name = fileNameOf(url);
  try {
    if (new URL(url).origin !== location.origin && location.protocol !== 'file:') {
      return `${name} is served from another origin, so this page cannot read its bytes.`;
    }
  } catch {
    /* not a URL worth explaining; the generic answer is below */
  }
  return `${name} could not be read — the ${kind} may have moved or failed to load.`;
}

/** Every `url()` and `@import` reference in a stylesheet, as written. */
function cssReferences(css: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  rewriteCssUrls(css, (raw) => {
    const value = raw.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      found.push(value);
    }
    return null;
  });
  return found;
}

/**
 * True when an element's `href` points at an image rather than a document.
 *
 * `href` is mostly navigation, and rewriting a link to a data URI would be a page that no
 * longer goes anywhere. Two exceptions matter: a favicon, and an SVG `<use>` pointing into
 * a sprite sheet.
 */
function isImageHref(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'use') return true;
  if (tag !== 'link') return false;
  const rel = (el.getAttribute('rel') ?? '').toLowerCase();
  return rel.split(/\s+/).some((token) => token === 'icon' || token === 'apple-touch-icon');
}

/**
 * The shape the current choices will produce, without building anything.
 *
 * The dialog needs it on every render — the primary button says whether it is about to
 * write an `.html` or a `.zip` — and building the whole export to find out would mean
 * fetching every asset on every keystroke. Derived from the same rule `buildBundle`
 * applies: anything staying external means files beside the HTML, and files beside the
 * HTML mean an archive.
 */
export function bundleShape(
  survey: BundleSurvey,
  options: BundleOptions,
): 'single' | 'archive' {
  const external: Array<[AssetKind, AssetPlacement]> = [
    ['style', options.styles],
    ['script', options.scripts],
    ['image', options.images],
  ];
  for (const [kind, placement] of external) {
    if (placement !== 'external') continue;
    const category = survey.categories.find((entry) => entry.kind === kind);
    // Only a category that actually has readable assets can produce a file, so a page
    // with no images does not become a zip by having images set to external.
    if (category && category.readable > 0) return 'archive';
  }
  return 'single';
}

/** What the download's name will be, before anything is built. */
export function bundleName(fileName: string, shape: 'single' | 'archive'): string {
  const base = exportBase(fileName);
  return shape === 'single' ? `${base}.html` : `${base}.zip`;
}

/**
 * A file name reduced to something safe to write, without the extension.
 *
 * This is user input now — someone types the name in the export step — and it ends up as
 * a real file on a real disk and as a path inside an archive. So it is narrowed rather
 * than trusted:
 *
 * - **Any directory part is dropped.** Where the file goes is the picker's business, and a
 *   name containing `../` is either a mistake or an attempt to write somewhere else.
 * - **Characters that are illegal or ambiguous somewhere are removed** — the Windows set
 *   plus control characters, since an export is meant to travel between machines.
 * - **Leading dots go**, because a page saved as a hidden file looks like a save that
 *   silently failed.
 *
 * Idempotent, so it can be applied on every keystroke and again at write time.
 */
export function exportBase(fileName: string): string {
  const last = fileName.split(/[\\/]+/).pop() ?? '';
  const base = last
    .replace(/\.(html?|zip)$/i, '')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    // Well under any filesystem's limit, with room for the extension.
    .slice(0, 100)
    .trim();
  return base || 'edited-page';
}

/**
 * A file's extension, lowercased, for comparing two names.
 *
 * Exists because the one place it is used is a correctness check rather than a display
 * detail: what a save picker was told the file would be, against what the build turned out
 * to be. Writing zip bytes to a name ending `.html` produces a file that does not open.
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}
