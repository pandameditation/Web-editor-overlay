import { cssUrls } from './css-urls.js';
import type { FileHost } from './file-host.js';
import { documentPath, normalizePath } from './file-host.js';

/**
 * The files a page is made of, and whether this page can read them.
 *
 * Exporting an edited page as something a person can open elsewhere means dealing with
 * everything the HTML points at: the stylesheets, the scripts, the images. Two shapes are
 * useful — one self-contained file with the lot folded in, or a directory of files with
 * the references intact — and both need the same two questions answered first. Where does
 * each reference point, and can the bytes actually be had?
 *
 * **The second question is the hard one, and the answer is often no.**
 *
 * A page opened straight from disk is its own opaque origin, and so is every file beside
 * it. `fetch` of a sibling is refused, a linked stylesheet's `cssRules` throws, and an
 * image drawn to a canvas taints it so `toDataURL` throws too. There is no way round it
 * from inside the page — which means "inline everything" is impossible in exactly the
 * situation where a single self-contained file would be most useful.
 *
 * So reachability is reported rather than discovered by failing. Every reference says
 * whether its bytes can be had and, when they cannot, why — so the export can offer what
 * it can do instead of attempting what it cannot, and the user is told which it was.
 */

export type AssetKind = 'style' | 'script' | 'image';

/** One thing the document points at. */
export interface AssetRef {
  kind: AssetKind;
  /** The URL exactly as the document writes it, which is what has to be replaced. */
  raw: string;
  /** Resolved against the document, for fetching and for comparing. */
  url: string;
  /**
   * Where this would sit in an archive: a path relative to the page's own directory.
   *
   * Null when the asset is not under it — another origin, or a parent directory. Those
   * cannot keep their structure, so an archive gives them a place of its own.
   */
  path: string | null;
  /** True when this page could read the bytes. */
  reachable: boolean;
  /** Why the bytes cannot be had, when they cannot. One sentence, for the UI. */
  reason?: string;
}

/* -------------------------------------------------------------------------- */
/* Where a reference points                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A reference resolved, or null when there is nothing to resolve.
 *
 * The nulls are the interesting part. A `data:` URI already carries its bytes, a bare
 * `#fragment` names something in this document, and `about:`/`blob:` are not files. Each is
 * left alone, and treating any of them as an asset would produce a reference to nothing.
 */
export function assetUrl(raw: string, base = document.baseURI): string | null {
  const value = raw.trim();
  if (!value || value.startsWith('#')) return null;
  if (/^(?:data|about|javascript|mailto|tel):/i.test(value)) return null;
  try {
    const parsed = new URL(value, base);
    return parsed.protocol === 'blob:' ? null : parsed.href;
  } catch {
    return null;
  }
}

/**
 * The asset's path relative to the page's own directory, or null.
 *
 * This is what makes an archive worth having: `css/theme.css` beside the page stays
 * `css/theme.css` beside the exported one, so the structure a person opens is the
 * structure they had. A reference that climbs out of the page's directory has no such
 * place, and rather than inventing one by flattening `../shared/a.css` into the same
 * folder as everything else — where it would collide with the next `a.css` — it is
 * declined here and given a home by `archivePath`.
 */
export function relativeAssetPath(url: string): string | null {
  const page = documentPath();
  if (!page) return null;
  const directory = page.split('/').slice(0, -1).join('/');
  let target: string | null;
  try {
    const parsed = new URL(url);
    const local = parsed.origin === location.origin || parsed.protocol === 'file:';
    if (!local) return null;
    target = normalizePath(decodeURIComponent(parsed.pathname));
  } catch {
    return null;
  }
  if (target === null) return null;
  if (!directory) return target;
  return target.startsWith(`${directory}/`) ? target.slice(directory.length + 1) : null;
}

/**
 * Where an asset goes inside the archive, with collisions resolved.
 *
 * Anything under the page keeps its own path, which is the whole point. Anything else —
 * a parent directory, another origin — goes under `assets/`, named after its own file
 * name, because a flat folder of borrowed files is honest about being one. A name already
 * taken gets a numeric suffix rather than silently overwriting: two different files called
 * `logo.svg` is the normal case for a page assembled from parts.
 */
export function archivePath(url: string, taken: Set<string>): string {
  const relative = relativeAssetPath(url);
  const candidate = relative ?? `assets/${fileNameOf(url)}`;
  if (!taken.has(candidate)) {
    taken.add(candidate);
    return candidate;
  }
  const dot = candidate.lastIndexOf('.');
  const stem = dot === -1 ? candidate : candidate.slice(0, dot);
  const extension = dot === -1 ? '' : candidate.slice(dot);
  for (let n = 2; n < 1000; n += 1) {
    const next = `${stem}-${n}${extension}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
  const fallback = `${stem}-${Date.now().toString(36)}${extension}`;
  taken.add(fallback);
  return fallback;
}

/** The last path segment of a URL, or a stand-in when it has none. */
export function fileNameOf(url: string): string {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).pop();
    return name || 'asset';
  } catch {
    return url.split('/').filter(Boolean).pop() || 'asset';
  }
}

/* -------------------------------------------------------------------------- */
/* Whether the bytes can be had                                               */
/* -------------------------------------------------------------------------- */

/**
 * Why this page cannot read its own siblings, when it cannot.
 *
 * One sentence, and it is the same fact `file-access.ts` explains at greater length to
 * someone trying to edit a stylesheet. Null means the bytes are obtainable — which for a
 * served page they are, since the browser already downloaded them to render the page and
 * a same-origin fetch is a cache hit.
 */
export function localAssetLimit(): string | null {
  if (location.protocol !== 'file:') return null;
  return (
    'This page was opened from disk, so every file beside it is its own origin and the ' +
    'browser will not let the page read one.'
  );
}

/**
 * Whether a reference's bytes can be had, and why not when they cannot.
 *
 * A connected project settles it in the affirmative for anything inside the folder: the
 * file is read from disk, which sidesteps the origin question entirely. Otherwise it comes
 * down to the two ways a fetch is refused — a `file://` sibling and another origin — and
 * they are worth distinguishing because only one of them has a remedy the user can apply.
 */
export function assetReach(url: string, project?: FileHost | null): { ok: boolean; reason?: string } {
  if (project && project.resolve(url)) return { ok: true };

  /*
   * The `file://` limit is deliberately *not* decided here.
   *
   * It is a prediction, and predictions about this are wrong often enough to matter: a
   * browser run with local file access allowed reads its siblings quite happily, and so
   * does the same page once it is served. Refusing up front would disable the choices in
   * a situation where they work, and the two answers would then disagree — the survey
   * saying nothing can be inlined while the build inlined it.
   *
   * So the survey stays optimistic about local files and the build finds out. What comes
   * back from an attempt is the truth, and `localAssetLimit` remains what it should
   * always have been: something to warn with, not something to decide by.
   */
  try {
    const parsed = new URL(url);
    const local = parsed.origin === location.origin || parsed.protocol === 'file:';
    if (!local) {
      return {
        ok: false,
        reason: `${fileNameOf(url)} is served from another origin, so this page cannot read its bytes.`,
      };
    }
  } catch {
    return { ok: false, reason: 'That reference is not a URL this page can resolve.' };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Reading them                                                                */
/* -------------------------------------------------------------------------- */

type Bytes = Uint8Array<ArrayBuffer>;

export interface AssetBytes {
  bytes: Bytes;
  /** Content type as the server gave it, or guessed from the extension. */
  mime: string;
}

/**
 * An asset's bytes, from disk when a project can reach it and over the network otherwise.
 *
 * Disk first for the same reason `fetchStyleSource` prefers it: a dev server can hand back
 * a transformed copy, and a transform is not what belongs in an export of the page's own
 * files. Returns null on any failure rather than throwing — a missing asset is a thing to
 * report alongside the others, not a reason for the whole export to fail.
 */
export async function fetchAsset(
  url: string,
  project?: FileHost | null,
): Promise<AssetBytes | null> {
  const path = project?.resolve(url) ?? null;
  if (path && project) {
    const text = await project.read(path).catch(() => null);
    /*
     * A `FileHost` reads text, which is right for the files it exists to edit and wrong
     * for a PNG. So disk is used for anything textual and the network for the rest —
     * and when there is no network to fall back to, an image simply cannot be had.
     */
    if (text !== null && isTextual(mimeOf(url))) {
      return { bytes: new TextEncoder().encode(text), mime: mimeOf(url) };
    }
  }
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return {
      bytes: new Uint8Array(buffer),
      mime: response.headers.get('content-type')?.split(';')[0]?.trim() || mimeOf(url),
    };
  } catch {
    return null;
  }
}

/** The bytes as a `data:` URI, which is how an asset travels inside one HTML file. */
export function toDataUrl(asset: AssetBytes): string {
  return `data:${asset.mime};base64,${toBase64(asset.bytes)}`;
}

function toBase64(bytes: Bytes): string {
  let binary = '';
  // In chunks: spreading a large array into `apply` overflows the stack, and an image is
  // always large enough to do it.
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step));
  }
  return btoa(binary);
}

/**
 * Content type from the file extension.
 *
 * A fallback for the cases where nothing said: a disk read has no headers, and a `file://`
 * fetch that somehow succeeds reports nothing useful. Wrong types matter here — a data URI
 * declaring the wrong one is an image that does not render — so the list covers what a page
 * actually references and everything else becomes a byte stream, which browsers sniff.
 */
export function mimeOf(url: string): string {
  const extension = fileNameOf(url).split('.').pop()?.toLowerCase() ?? '';
  return MIME[extension] ?? 'application/octet-stream';
}

const MIME: Record<string, string> = {
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

function isTextual(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'image/svg+xml';
}

/* -------------------------------------------------------------------------- */
/* Finding them in a document                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Attributes that hold one URL, by tag.
 *
 * `srcset` is handled separately because it holds a list, and a list needs parsing rather
 * than resolving.
 */
const SINGLE: Array<{ selector: string; attribute: string; kind: AssetKind }> = [
  { selector: 'link[rel~="stylesheet"][href]', attribute: 'href', kind: 'style' },
  { selector: 'script[src]', attribute: 'src', kind: 'script' },
  { selector: 'img[src]', attribute: 'src', kind: 'image' },
  { selector: 'source[src]', attribute: 'src', kind: 'image' },
  { selector: 'video[poster]', attribute: 'poster', kind: 'image' },
  { selector: 'input[type="image"][src]', attribute: 'src', kind: 'image' },
  { selector: 'link[rel~="icon"][href]', attribute: 'href', kind: 'image' },
  { selector: 'use[href]', attribute: 'href', kind: 'image' },
];

/**
 * Every asset the document refers to, deduplicated by URL.
 *
 * Walks a parsed copy of the export rather than the live page, because the export is what
 * is being rewritten — a reference the editor removed on the way out is not an asset this
 * has to account for.
 *
 * CSS references are found too, from the text of inline `<style>` blocks, since a
 * background image is as much a file the page needs as an `<img>` is. References inside a
 * *linked* stylesheet are not visible here — the text has to be fetched first — so the
 * bundler adds those as it goes.
 */
export function collectDocumentAssets(
  doc: Document,
  options: { base?: string; project?: FileHost | null } = {},
): AssetRef[] {
  const base = options.base ?? document.baseURI;
  const out: AssetRef[] = [];
  const seen = new Set<string>();

  const add = (raw: string, kind: AssetKind): void => {
    const url = assetUrl(raw, base);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const reach = assetReach(url, options.project);
    out.push({
      kind,
      raw,
      url,
      path: relativeAssetPath(url),
      reachable: reach.ok,
      reason: reach.reason,
    });
  };

  for (const entry of SINGLE) {
    for (const el of Array.from(doc.querySelectorAll(entry.selector))) {
      add(el.getAttribute(entry.attribute) ?? '', entry.kind);
    }
  }

  for (const el of Array.from(doc.querySelectorAll('[srcset]'))) {
    for (const candidate of parseSrcset(el.getAttribute('srcset') ?? '')) {
      add(candidate, 'image');
    }
  }

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    for (const url of cssUrls(style.textContent ?? '')) add(url, 'image');
  }

  return out;
}

/**
 * The URLs out of a `srcset`, ignoring the descriptors.
 *
 * Split on commas and take the first whitespace-separated token of each candidate, which
 * is the same shape `sanitize.ts` relies on. Not a full parse — a URL containing a comma
 * would defeat it — and that is the same limit every implementation of this in a page has.
 */
export function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean);
}
