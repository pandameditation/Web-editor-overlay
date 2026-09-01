import {
  archivePath,
  assetKindOf,
  assetUrl,
  collectDocumentAssets,
  countEmbeddedAssets,
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

/**
 * What happens to one asset.
 *
 * Three outcomes, from two questions asked separately — whether to save it at all, and how
 * the output is packaged:
 *
 * - **`inline`**: its bytes go into the HTML. Text as text, images and fonts as base64.
 * - **`beside`**: its bytes go into the archive, at the path the page already uses, and the
 *   reference is rewritten if that path moved.
 * - **`leave`**: nothing is fetched and nothing is copied. The reference stays exactly as
 *   written and points wherever it always did — right for a CDN font or an image the page
 *   loads from somewhere that will still be there.
 */
export type AssetPlacement = 'inline' | 'beside' | 'leave';

/** How the output is packaged: one file, or a folder of them. */
export type BundlePackaging = 'single' | 'archive';

/** Which categories to save, keyed as the UI names them. */
export type IncludeKey = 'styles' | 'scripts' | 'images' | 'fonts';

/**
 * The two decisions, kept separate because they are separate.
 *
 * They used to be one: each category was "inline" or "external", and the packaging was
 * derived from whether anything had been left out. That conflated *what to save* with *how
 * to carry it*, so there was no way to say "bring the images but not the webfonts, and put
 * it all in one file" — unticking a box moved it into a zip rather than leaving it alone.
 *
 * Splitting them costs one guard, which the UI enforces by only offering the archive when
 * the choices above make one possible: a single file that still points at files nobody has
 * is the combination that cannot work, and it is now unreachable rather than prevented.
 */
export interface BundleOptions {
  /** Stylesheets the page links to. */
  styles: boolean;
  /** Scripts the page links to. */
  scripts: boolean;
  /** Pictures, from the HTML and from `url()` in CSS. */
  images: boolean;
  /**
   * Fonts, separately from images.
   *
   * They were the same choice once, and that was wrong in a way people noticed: fonts come
   * in through `url()` in CSS, so folding a stylesheet in brings a family of them into the
   * document, where the *picture* checkbox then decided their fate. Base64 costs a third,
   * and a font family is far larger than the pictures on most pages.
   */
  fonts: boolean;
  packaging: BundlePackaging;
}

export const DEFAULT_BUNDLE_OPTIONS: BundleOptions = {
  styles: true,
  scripts: true,
  images: true,
  fonts: true,
  // One file is the useful default: it is the thing a zip cannot be, which is openable by
  // double-clicking it.
  packaging: 'single',
};

/** The option each kind of asset is governed by. */
export const PLACEMENT_KEYS: Record<AssetKind, IncludeKey> = {
  style: 'styles',
  script: 'scripts',
  image: 'images',
  font: 'fonts',
};

export const INCLUDE_KINDS: AssetKind[] = ['style', 'script', 'image', 'font'];

/** What the current choices mean for one kind of asset. */
export function placementFor(kind: AssetKind, options: BundleOptions): AssetPlacement {
  if (!options[PLACEMENT_KEYS[kind]]) return 'leave';
  return options.packaging === 'archive' ? 'beside' : 'inline';
}

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
  /**
   * How many distinct assets of each kind the build actually carried.
   *
   * The survey cannot know this and it is not a detail. References inside a *linked*
   * stylesheet are invisible until that sheet has been fetched, so a page with twelve fonts
   * in its CSS surveys as having none — and a row reading "no fonts in this page" above an
   * export that embedded twelve of them is indistinguishable from a lie. Once the build has
   * run it knows, and this is how it says.
   */
  placed: Record<AssetKind, number>;
  /**
   * How many distinct assets of each kind the build *encountered*, whatever it did with them.
   *
   * Separate from `placed` because how many a page has is a fact about the page, and how many
   * travelled is a consequence of the choices. Counting the page from `placed` made a
   * checkbox destroy the evidence for its own existence: unticking a kind meant nothing was
   * carried, which read as "none in this page", which disabled the row — so it could not be
   * ticked again.
   */
  found: Record<AssetKind, number>;
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
  /**
   * How much of this kind is already inside the document and needs no decision.
   *
   * Not part of `count`, because the choices cannot act on it — a `<style>` block travels
   * whatever the styles checkbox says. Carried so the UI can stop implying the opposite: a
   * page written with inline CSS and JS is self-contained already, and a row reading "none
   * in this page" or "none readable from here" beside an export that plainly contains them
   * is how someone concludes the count is lying.
   */
  embedded: number;
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
  const embedded = countEmbeddedAssets(doc);
  const kinds: AssetKind[] = ['style', 'script', 'image', 'font'];

  const categories = kinds.map((kind) => {
    const mine = assets.filter((asset) => asset.kind === kind);
    const readable = mine.filter((asset) => asset.reachable);
    const blocked = mine.find((asset) => !asset.reachable);
    return {
      kind,
      count: mine.length,
      readable: readable.length,
      embedded: embedded[kind],
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
  /** Distinct URLs successfully carried, per kind, so the UI can report what happened. */
  const handled: Record<AssetKind, Set<string>> = {
    style: new Set(),
    script: new Set(),
    image: new Set(),
    font: new Set(),
  };
  /** Every distinct URL met, per kind, whatever was then done with it. */
  const found: Record<AssetKind, Set<string>> = {
    style: new Set(),
    script: new Set(),
    image: new Set(),
    font: new Set(),
  };

  const omit = (kind: AssetKind, url: string, reason: string): void => {
    if (omitted.some((entry) => entry.url === url)) return;
    omitted.push({ kind, url, label: fileNameOf(url), reason });
  };

  /**
   * Place one asset: a `data:` URI when it is travelling inline, an archive path when it
   * travels beside, or null to leave the reference exactly as written.
   */
  const place = async (
    url: string,
    fallback: AssetKind,
    /** Which option governs it, resolved from the file rather than from where it sits. */
    governedBy: (kind: AssetKind) => AssetPlacement,
  ): Promise<string | null> => {
    // A `url()` in a stylesheet may be a picture or a font, and the two are different
    // decisions, so the file decides which checkbox it answers to.
    const kind = fallback === 'image' ? assetKindOf(url) : fallback;
    const placement = governedBy(kind);
    // Recorded before anything is decided: that the page refers to this is true regardless of
    // what the choices then do about it.
    found[kind].add(url);

    // Not saving it means not touching it. Nothing is fetched, so nothing can fail, and it
    // is not reported as left behind — it was never coming.
    if (placement === 'leave') return null;

    if (placement === 'beside') {
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
      handled[kind].add(url);
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
    handled[kind].add(url);
    return toDataUrl(bytes);
  };

  /** The option a kind answers to, read fresh so every call agrees. */
  const governedBy = (kind: AssetKind): AssetPlacement => placementFor(kind, options);

  /* ---- Stylesheets ---- */

  const stylePlacement = placementFor('style', options);
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const raw = link.getAttribute('href') ?? '';
    const url = assetUrl(raw);
    if (!url) continue;

    found.style.add(url);
    // Not saving the styles means not reading them, which also means the assets they refer
    // to stay unknown. That is consistent: those references are not being touched either.
    if (stylePlacement === 'leave') continue;

    const asset = await fetchAsset(url, project);
    if (!asset) {
      omit('style', url, unreadable(url, 'style', project));
      continue;
    }
    // Counted here as well as in `place`, which this path does not go through: a stylesheet
    // saved is one the row has to report, or it reads as a page with no stylesheets.
    handled.style.add(url);
    const text = new TextDecoder().decode(asset.bytes);

    if (stylePlacement === 'beside') {
      /*
       * A sheet copied verbatim is a sheet whose own references have to be copied too.
       *
       * This is the half that was missing: the bytes went into the archive and nothing ever
       * looked inside them, so a zip arrived holding the CSS and none of the fonts or
       * background images it names. Unzipping it produced a page with no typeface.
       *
       * The references resolve against the *sheet*, not the document, and each one keeps its
       * own path under the page directory — so `css/theme.css` asking for `../img/a.png`
       * finds `img/a.png` in the archive, because both kept their places. Only a reference
       * whose path had to move needs the text rewritten.
       */
      const moved = new Map<string, string>();
      for (const reference of cssReferences(text)) {
        const resolved = assetUrl(reference, url);
        if (!resolved) continue;
        const next = await place(resolved, 'image', governedBy);
        if (next) moved.set(reference, next);
      }
      const bytes = moved.size
        ? new TextEncoder().encode(
          rewriteCssUrls(text, (reference) => moved.get(reference.trim()) ?? null),
        )
        : asset.bytes;

      const path = archivePath(url, taken);
      archived.set(url, path);
      files.push({ path, bytes, kind: 'style' });
      if (path !== relativeAssetPath(url)) link.setAttribute('href', path);
      continue;
    }

    /*
     * Inlined: the text is moving from a `<link>`, which resolves relative URLs against
     * itself, to a `<style>`, which resolves them against the document. Rewriting them is
     * not a nicety — a stylesheet in `css/` referring to `../img/hero.png` would otherwise
     * point one directory too high the moment it was inlined.
     */
    const css = rewriteCssUrls(text, (reference) => {
      const resolved = assetUrl(reference, url);
      return resolved && resolved !== reference ? resolved : null;
    });
    const style = doc.createElement('style');
    style.textContent = css;
    // The media query was part of when the sheet applied, so it comes along.
    const media = link.getAttribute('media');
    if (media) style.setAttribute('media', media);
    link.replaceWith(style);
  }

  /* ---- Scripts ---- */

  const scriptPlacement = placementFor('script', options);
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const raw = script.getAttribute('src') ?? '';
    const url = assetUrl(raw);
    if (!url) continue;

    if (scriptPlacement !== 'inline') {
      // `place` records it as met on the way through, including when it leaves it alone.
      const path = await place(url, 'script', () => scriptPlacement);
      if (path) script.setAttribute('src', path);
      continue;
    }
    found.script.add(url);


    const asset = await fetchAsset(url, project);
    if (!asset) {
      omit('script', url, unreadable(url, 'script', project));
      continue;
    }
    handled.script.add(url);
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
      const next = await place(url, 'image', governedBy);
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
        const next = await place(url, 'image', governedBy);
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
      const next = await place(url, 'image', governedBy);
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
    placed: {
      style: handled.style.size,
      script: handled.script.size,
      image: handled.image.size,
      font: handled.font.size,
    },
    found: {
      style: found.style.size,
      script: found.script.size,
      image: found.image.size,
      font: found.font.size,
    },
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
export function bundleShape(survey: BundleSurvey, options: BundleOptions): BundlePackaging {
  return options.packaging === 'archive' && canArchive(survey, options) ? 'archive' : 'single';
}

/**
 * Whether an archive is worth offering at all.
 *
 * A zip earns its place only when something would sit beside the page in it. With every
 * category unticked, or with nothing of the ticked ones readable from here, both packagings
 * produce the same lone HTML file — and asking someone to choose between two identical
 * outcomes is worse than not asking.
 *
 * The UI hides the choice when this is false, which is also how the one broken combination
 * stays unreachable: an archive is only ever offered when there is a file to put in it.
 */
export function canArchive(survey: BundleSurvey, options: BundleOptions): boolean {
  return INCLUDE_KINDS.some((kind) => {
    if (!options[PLACEMENT_KEYS[kind]]) return false;
    const category = survey.categories.find((entry) => entry.kind === kind);
    return (category?.readable ?? 0) > 0;
  });
}

/**
 * The same question asked of a built plan, which knows rather than guesses.
 *
 * The survey cannot see inside a linked stylesheet, so a page whose only external assets
 * are fonts in its CSS surveys as having nothing to archive. Once the build has run, what
 * it placed is the answer.
 */
export function planCanArchive(plan: BundlePlan, options: BundleOptions): boolean {
  return INCLUDE_KINDS.some(
    (kind) => options[PLACEMENT_KEYS[kind]] && plan.placed[kind] > 0,
  );
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
