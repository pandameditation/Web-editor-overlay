import { fileNameOf, mimeOf } from './assets.js';
import { cssUrls, isRelativeUrl, rewriteCssUrls } from './css-urls.js';
import { normalizePath } from './file-host.js';
import { srcsetCandidates } from './srcset.js';
import type { DesignClass, DesignRule, DesignToken, LibraryBlock } from './types.js';

/**
 * The files a design system carries, and where each one lives.
 *
 * A font, a picture or a sound reaches the design system in one of two shapes. Embedded, as a
 * `data:` URL inside a token value, a class or rule declaration, or a block's CSS or markup: the
 * design system is then one self-contained thing, and it is as large as everything in it — a
 * captured block with its web fonts folded in easily weighs a megabyte. Or linked, by a relative
 * URL to a file beside the page: the design system stays small and the file has to travel with it.
 *
 * Neither is right in general, so this is the vocabulary for moving between them: find every file
 * reference, say which shape it is in, and rewrite references in bulk. The I/O — reading bytes,
 * writing files — is the engine's, because only the engine holds the project connection.
 *
 * Only what the design system *owns* is in scope. A token read out of the page's stylesheet
 * already lives in a file, and rewriting its value here would make the registry disagree with the
 * file it was read from; preset blocks are rebuilt on every load, so a rewrite would not stick.
 */

/** What a file is, by its media type. Decides the subfolder it is stored in and the filter. */
export type DesignFileKind = 'font' | 'image' | 'audio' | 'video' | 'other';

/**
 * Where a file lives.
 *
 * `embedded` is a `data:` URL; `linked` a URL relative to the page (or same-origin); `remote` a
 * URL on another origin. Remote files can be embedded only when that origin allows the read.
 */
export type DesignFilePlace = 'embedded' | 'linked' | 'remote';

/** One place a file is referenced from. */
export interface DesignFileUse {
  /**
   * `element` is the page's own markup: an image, a video, an inline style on an element.
   * `sheet` is one of the page's stylesheets, linked or inline: an `@font-face`, a token's value.
   */
  owner: 'token' | 'class' | 'rule' | 'block' | 'element' | 'sheet';
  /** The entry's identity in its registry: token name, class name, rule key, block id. */
  key: string;
  /** What to call the entry in the UI: `--hero-bg`, `.card`, `h1`, `Hero`. */
  label: string;
}

export interface DesignFile {
  /** The reference exactly as written, which is both its identity and what gets replaced. */
  ref: string;
  kind: DesignFileKind;
  place: DesignFilePlace;
  mime: string;
  /** Decoded size in bytes. Known for embedded files; for others, only once the page loaded it. */
  bytes: number | null;
  /** A file name to show and to store under: `inter.woff2`, `hero.jpg`. */
  name: string;
  uses: DesignFileUse[];
}

/** The four owned parts of a design system a file reference can sit in. */
export interface DesignFileSources {
  tokens: DesignToken[];
  classes: DesignClass[];
  rules: DesignRule[];
  blocks: LibraryBlock[];
}

export const FILE_KINDS: readonly DesignFileKind[] = ['font', 'image', 'audio', 'video', 'other'];

/**
 * Where each kind of file is stored, relative to the page, until the user says otherwise.
 *
 * One folder per kind, and each one the user's to choose: a project that already keeps its
 * pictures in `img/` should not have to grow an `assets/images/` beside it.
 */
export const DEFAULT_FILE_FOLDERS: Readonly<Record<DesignFileKind, string>> = Object.freeze({
  font: 'assets/fonts',
  image: 'assets/images',
  audio: 'assets/audio',
  video: 'assets/video',
  other: 'assets/files',
});

/** A folder per kind, cleaned; a kind missing or unusable falls back to its default. */
export function fileFoldersOf(input: unknown): Record<DesignFileKind, string> | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const out = { ...DEFAULT_FILE_FOLDERS };
  let any = false;
  for (const kind of FILE_KINDS) {
    const folder = typeof raw[kind] === 'string' ? normalizeFilesFolder(raw[kind] as string) : null;
    if (folder) {
      out[kind] = folder;
      any = true;
    }
  }
  return any ? Object.freeze(out) : null;
}

/* -------------------------------------------------------------------------- */
/* Kinds and names                                                             */
/* -------------------------------------------------------------------------- */

export function fileKindOf(mime: string): DesignFileKind {
  const type = mime.toLowerCase();
  if (
    type.startsWith('font/') ||
    type === 'application/vnd.ms-fontobject' ||
    type.startsWith('application/font-') ||
    type.startsWith('application/x-font')
  ) {
    return 'font';
  }
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  return 'other';
}

/**
 * Extensions by media type, for naming a file that never had a name.
 *
 * `mimeOf` goes the other way and covers what a page usually links to; these are the types an
 * embedded file is declared as. Anything unlisted keeps its subtype as the extension, which is
 * right for most of them (`image/png` → `png`) and harmless for the rest.
 */
const EXTENSIONS: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'application/x-font-ttf': 'ttf',
  'application/x-font-otf': 'otf',
  'application/vnd.ms-fontobject': 'eot',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'video/quicktime': 'mov',
  'application/octet-stream': 'bin',
};

export function extensionFor(mime: string): string {
  const type = mime.toLowerCase();
  if (EXTENSIONS[type]) return EXTENSIONS[type];
  const sub = type.split('/')[1]?.replace(/^x-/, '').replace(/[^a-z0-9]/g, '') ?? '';
  return sub.slice(0, 8) || 'bin';
}

/** Lower-case, dash-separated, safe in a path on every file system. */
export function fileStem(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'file'
  );
}

/* -------------------------------------------------------------------------- */
/* Data URLs                                                                   */
/* -------------------------------------------------------------------------- */

const DATA_URL = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,/i;

/** The media type a `data:` URL declares, or null when it is not one. */
export function dataUrlMime(ref: string): string | null {
  const match = DATA_URL.exec(ref.trim());
  if (!match) return null;
  return (match[1] || 'text/plain').toLowerCase();
}

/** Decoded size of a `data:` URL's payload, without decoding it. */
function dataUrlSize(ref: string): number {
  const value = ref.trim();
  const match = DATA_URL.exec(value);
  if (!match) return 0;
  const payload = value.slice(match[0].length);
  if (match[3]) {
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.replace(/\s+/g, '').length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).length;
  } catch {
    return payload.length;
  }
}

/** A `data:` URL's bytes and media type, or null when it does not decode. */
export function decodeDataUrl(ref: string): { bytes: Uint8Array<ArrayBuffer>; mime: string } | null {
  const value = ref.trim();
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const mime = (match[1] || 'text/plain').toLowerCase();
  const payload = value.slice(match[0].length);
  try {
    if (match[3]) {
      const binary = atob(payload.replace(/\s+/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
      return { bytes, mime };
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mime };
  } catch {
    return null;
  }
}

/**
 * Twelve hex digits from the content: the same bytes always get the same name.
 *
 * Synchronous rather than SHA-256 through `crypto.subtle`, because the seed needs it too: a seed
 * that leaves a font out links it at the path storing it would write, and the seed is built
 * synchronously. Two independent 53-bit mixes (cyrb53) are plenty to tell files apart by name;
 * this is naming, not integrity.
 */
export function contentHash(bytes: Uint8Array): string {
  const mix = (seed: number): number => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let at = 0; at < bytes.length; at += 1) {
      const byte = bytes[at];
      h1 = Math.imul(h1 ^ byte, 2654435761);
      h2 = Math.imul(h2 ^ byte, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };
  return (mix(0).toString(16).slice(-6).padStart(6, '0') + mix(1).toString(16).slice(-6).padStart(6, '0'));
}

/* -------------------------------------------------------------------------- */
/* Folders and paths                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The files folder as typed, cleaned, or null when it cannot be one.
 *
 * Relative to the page and inside its directory: no scheme, no leading slash, no `..`. A folder
 * that climbed out of the page's directory could not be reached through the connected project
 * folder, and an absolute one would stop resolving the moment the page moved.
 */
export function normalizeFilesFolder(input: string): string | null {
  const value = input.trim().replace(/\\/g, '/');
  if (!value || value.length > 120) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/')) return null;
  if (value.split('/').some((part) => part === '..')) return null;
  if (/[<>:"|?*\u0000-\u001f]/.test(value)) return null;
  const clean = normalizePath(value);
  return clean || null;
}

/** Where a stored file goes, relative to the page: `assets/fonts/inter-3fa2c1d0e9b7.woff2`. */
export function storedPath(file: Pick<DesignFile, 'name'>, folder: string, hash: string): string {
  const dot = file.name.lastIndexOf('.');
  const stem = fileStem(dot > 0 ? file.name.slice(0, dot) : file.name);
  const extension = dot > 0 ? file.name.slice(dot + 1) : 'bin';
  return `${folder}/${stem}-${hash}.${extension}`;
}

/** The folder a linked reference sits in, relative to the page, or null when it is not written as one. */
export function folderOf(ref: string): string | null {
  const path = pagePathOf(ref);
  if (!path || !path.includes('/')) return null;
  return path.slice(0, path.lastIndexOf('/'));
}

/**
 * A linked reference as a path relative to the page, when it is written as one.
 *
 * `./assets/a.png` and `assets/a.png` are the same file; `../shared/a.png` and anything with a
 * query or a fragment are left alone, because moving them would mean guessing.
 */
export function pagePathOf(ref: string): string | null {
  const value = ref.trim();
  if (!isRelativeUrl(value) || value.startsWith('/') || /[?#]/.test(value)) return null;
  let decoded: string;
  try {
    decoded = decodeURI(value);
  } catch {
    return null;
  }
  return normalizePath(decoded);
}

/**
 * True when a linked reference points inside one of the Files folders.
 *
 * The only place the editor will delete a file. A font the page linked from `fonts/` before the
 * Files folders existed is the author's, not something the editor stored, so it is never offered.
 */
export function inFilesFolder(ref: string, folders: Readonly<Record<DesignFileKind, string>>): boolean {
  const path = pagePathOf(ref);
  if (!path) return false;
  return Object.values(folders).some((folder) => path.startsWith(`${folder}/`));
}

/** The reference with its path moved from one files folder to another, or null when not inside it. */
export function movedRef(ref: string, from: string, to: string): string | null {
  const path = pagePathOf(ref);
  if (!path || !path.startsWith(`${from}/`)) return null;
  return encodeURI(`${to}/${path.slice(from.length + 1)}`);
}

/* -------------------------------------------------------------------------- */
/* Finding the references                                                      */
/* -------------------------------------------------------------------------- */

/** Attributes in block markup that hold one file URL. `a[href]` is a link, not a file. */
const SINGLE_URL = [
  'img[src]',
  'source[src]',
  'audio[src]',
  'video[src]',
  'track[src]',
  'embed[src]',
  'input[type="image"][src]',
];

function placeOf(ref: string): DesignFilePlace | null {
  const value = ref.trim();
  if (/^data:/i.test(value)) return 'embedded';
  if (isRelativeUrl(value)) return 'linked';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin === location.origin ? 'linked' : 'remote';
  } catch {
    return null;
  }
}

/** Data URLs that are text rather than files: a stylesheet or a script is not what this moves. */
const NOT_A_FILE = /^(?:text\/(?:css|javascript|html|plain)|application\/(?:javascript|json))$/;

/** The font family each `url()` inside an `@font-face` belongs to, for naming the font. */
function fontFamilies(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = match[1];
    const family = /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;]+))/i.exec(body);
    const name = (family?.[1] ?? family?.[2] ?? family?.[3] ?? '').trim();
    if (!name) continue;
    const weight = /font-weight\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim().split(/\s+/)[0];
    const italic = /font-style\s*:\s*italic/i.test(body);
    const label = [name, weight && weight !== '400' && weight !== 'normal' ? weight : '', italic ? 'italic' : '']
      .filter(Boolean)
      .join(' ');
    for (const url of cssUrls(body)) if (!out.has(url)) out.set(url, label);
  }
  return out;
}

/** The custom property each `url()` is the value of, for naming a texture after `--clay-tex`. */
function customProperties(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/--([\w-]+)\s*:/g)) {
    // To the first ; or } outside parentheses: a data URL's own `;base64` is inside its url().
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < css.length; end += 1) {
      const ch = css[end];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if ((ch === ';' || ch === '}') && depth === 0) break;
    }
    for (const url of cssUrls(css.slice(match.index + match[0].length, end))) {
      if (!out.has(url)) out.set(url, match[1]);
    }
  }
  return out;
}

/** Every file URL in a block's markup. Parsed inertly: a template does not load anything. */
function htmlUrls(html: string): string[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const found: string[] = [];
  for (const selector of SINGLE_URL) {
    for (const el of Array.from(root.querySelectorAll(selector))) found.push(el.getAttribute('src') ?? '');
  }
  for (const el of Array.from(root.querySelectorAll('video[poster]'))) found.push(el.getAttribute('poster') ?? '');
  for (const el of Array.from(root.querySelectorAll('[srcset]'))) {
    for (const candidate of srcsetCandidates(el.getAttribute('srcset') ?? '')) found.push(candidate.url);
  }
  for (const el of Array.from(root.querySelectorAll('[style]'))) found.push(...cssUrls(el.getAttribute('style') ?? ''));
  for (const el of Array.from(root.querySelectorAll('style'))) found.push(...cssUrls(el.textContent ?? ''));
  return found;
}

/* -------------------------------------------------------------------------- */
/* The page's own markup                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One of the page's own stylesheets, as text.
 *
 * Where a font face and a texture token usually live — `@font-face { src: url(data:font/woff2…) }`
 * and `--clay-tex: url(data:image/jpeg…)` in the page's CSS file — and the first version looked
 * only at the design system and the markup, so neither was found.
 */
export interface PageSheetText {
  key: string;
  label: string;
  text: string;
}

/** One attribute on a page element that can hold a file URL. */
export interface PageFileAttribute {
  el: Element;
  attribute: string;
  /** What to call the element in the UI: `img.hero`. */
  label: string;
}

/** The page attributes that hold files, by selector. `a[href]` is a link, so it is not here. */
const PAGE_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [
  ...SINGLE_URL.map((selector) => [selector, 'src'] as const),
  ['video[poster]', 'poster'],
  ['[srcset]', 'srcset'],
  ['[style]', 'style'],
  ['link[rel~="icon"][href]', 'href'],
];

/**
 * Every attribute in the page that refers to a file, outside what the editor itself put there.
 *
 * An `<img src="data:image/jpeg;base64,…">` written into the page is as much an embedded file as
 * one inside a block, and leaving it out made the list miss exactly the files people paste in.
 * `skip` is the editor's own boundary — its host element and anything marked as injected.
 */
export function pageFileAttributes(
  doc: Document,
  skip: (el: Element) => boolean,
  label: (el: Element) => string,
): PageFileAttribute[] {
  const out: PageFileAttribute[] = [];
  for (const [selector, attribute] of PAGE_ATTRIBUTES) {
    for (const el of Array.from(doc.querySelectorAll(selector))) {
      if (skip(el)) continue;
      if (!attributeUrls(attribute, el.getAttribute(attribute) ?? '').length) continue;
      out.push({ el, attribute, label: label(el) });
    }
  }
  return out;
}

/** The file URLs one attribute value holds: a whole `src`, `srcset` candidates, `url()`s in a style. */
export function attributeUrls(attribute: string, value: string): string[] {
  const name = attribute.toLowerCase();
  if (name === 'srcset') return srcsetCandidates(value).map((one) => one.url);
  if (name === 'style') return cssUrls(value);
  return value.trim() ? [value.trim()] : [];
}

/** An attribute value with its file URLs replaced, or null when none of them is being replaced. */
export function rewriteAttributeValue(
  attribute: string,
  value: string,
  swap: (raw: string) => string | null,
): string | null {
  const name = attribute.toLowerCase();
  if (name === 'srcset') {
    const candidates = srcsetCandidates(value);
    if (!candidates.some((one) => swap(one.url) !== null)) return null;
    return candidates
      .map((one) => [swap(one.url) ?? one.url, one.descriptor].filter(Boolean).join(' '))
      .join(', ');
  }
  if (name === 'style') {
    const rewritten = rewriteCssUrls(value, swap);
    return rewritten === value ? null : rewritten;
  }
  return swap(value);
}

/**
 * Every file the design system's own entries refer to, one row per distinct reference.
 *
 * `sizeOf` answers for linked files, from what the page has already downloaded; an embedded
 * file's size comes from its own payload.
 */
export function scanDesignFiles(
  sources: DesignFileSources,
  sizeOf: (url: string) => number | null = () => null,
  page: readonly PageFileAttribute[] = [],
  sheets: readonly PageSheetText[] = [],
): DesignFile[] {
  const files = new Map<string, DesignFile>();
  const hints = new Map<string, string>();

  const add = (raw: string, use: DesignFileUse, hint?: string): void => {
    const ref = raw.trim();
    const place = ref ? placeOf(ref) : null;
    if (!place) return;
    const existing = files.get(ref);
    if (existing) {
      if (!existing.uses.some((one) => one.owner === use.owner && one.key === use.key)) existing.uses.push(use);
      return;
    }
    let mime: string;
    if (place === 'embedded') {
      mime = dataUrlMime(ref) ?? 'application/octet-stream';
      if (NOT_A_FILE.test(mime)) return;
    } else {
      mime = mimeOf(ref.split(/[?#]/)[0]);
      // A stylesheet, a script or a page linked from a design system is not a file this moves.
      if (/^(?:text\/|application\/(?:json|javascript))/.test(mime)) return;
    }
    const kind = fileKindOf(mime);
    if (hint) hints.set(ref, hint);
    files.set(ref, {
      ref,
      kind,
      place,
      mime,
      bytes: place === 'embedded' ? dataUrlSize(ref) : sizeOf(absolute(ref)),
      name: '',
      uses: [use],
    });
  };

  for (const token of sources.tokens) {
    const use: DesignFileUse = { owner: 'token', key: token.name, label: `--${token.name}` };
    for (const url of cssUrls(token.value)) add(url, use);
  }
  for (const entry of sources.classes) {
    const use: DesignFileUse = { owner: 'class', key: entry.name, label: `.${entry.name}` };
    for (const value of Object.values(entry.declarations)) for (const url of cssUrls(value)) add(url, use);
  }
  for (const entry of sources.rules) {
    const key = entry.media ? `${entry.selector}@${entry.media}` : entry.selector;
    const use: DesignFileUse = { owner: 'rule', key, label: entry.selector };
    for (const value of Object.values(entry.declarations)) for (const url of cssUrls(value)) add(url, use);
  }
  for (const block of sources.blocks) {
    const use: DesignFileUse = { owner: 'block', key: block.id, label: block.name || block.id };
    const families = fontFamilies(block.css ?? '');
    for (const url of cssUrls(block.css ?? '')) add(url, use, families.get(url));
    for (const url of htmlUrls(block.html ?? '')) add(url, use);
  }
  for (const sheet of sheets) {
    const use: DesignFileUse = { owner: 'sheet', key: sheet.key, label: sheet.label };
    const families = fontFamilies(sheet.text);
    const properties = customProperties(sheet.text);
    for (const url of cssUrls(sheet.text)) add(url, use, families.get(url) ?? properties.get(url));
  }
  page.forEach((entry, index) => {
    const use: DesignFileUse = { owner: 'element', key: String(index), label: entry.label };
    for (const url of attributeUrls(entry.attribute, entry.el.getAttribute(entry.attribute) ?? '')) add(url, use);
  });

  /*
   * Names last, once every use is known, so two different files never share one.
   *
   * A linked file has its own name. An embedded one has none, so it is named after what holds it:
   * the font family for a font face, otherwise the first entry using it. The kind is the fallback
   * of the fallback, so a name is never empty.
   */
  const taken = new Map<string, number>();
  for (const file of files.values()) {
    let name: string;
    if (file.place === 'embedded') {
      const stem = fileStem(hints.get(file.ref) ?? file.uses[0]?.label.replace(/^[-.]+/, '') ?? file.kind);
      name = `${stem}.${extensionFor(file.mime)}`;
    } else {
      name = decodeName(fileNameOf(absolute(file.ref)));
    }
    const seen = taken.get(name) ?? 0;
    taken.set(name, seen + 1);
    if (seen && file.place === 'embedded') {
      const dot = name.lastIndexOf('.');
      name = `${name.slice(0, dot)}-${seen + 1}${name.slice(dot)}`;
    }
    file.name = name;
  }
  return [...files.values()];
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** A reference resolved against the page, the way the browser resolves it. */
export function absolute(ref: string): string {
  try {
    return new URL(ref.trim(), document.baseURI).href;
  } catch {
    return ref;
  }
}

/* -------------------------------------------------------------------------- */
/* Rewriting them                                                              */
/* -------------------------------------------------------------------------- */

/** The entries that change when references are replaced, as fresh copies. Unchanged ones are left out. */
export function rewriteDesignFiles(
  sources: DesignFileSources,
  replacements: ReadonlyMap<string, string>,
): DesignFileSources {
  const css = (text: string): string =>
    rewriteCssUrls(text, (raw) => replacements.get(raw.trim()) ?? null);
  const declarations = (map: Record<string, string>): Record<string, string> | null => {
    let changed = false;
    const next: Record<string, string> = {};
    for (const [property, value] of Object.entries(map)) {
      next[property] = css(value);
      if (next[property] !== value) changed = true;
    }
    return changed ? next : null;
  };

  const out: DesignFileSources = { tokens: [], classes: [], rules: [], blocks: [] };
  for (const token of sources.tokens) {
    const value = css(token.value);
    if (value !== token.value) out.tokens.push({ ...token, value });
  }
  for (const entry of sources.classes) {
    const next = declarations(entry.declarations);
    if (next) out.classes.push({ ...entry, declarations: next });
  }
  for (const entry of sources.rules) {
    const next = declarations(entry.declarations);
    if (next) out.rules.push({ ...entry, declarations: next });
  }
  for (const block of sources.blocks) {
    const nextCss = block.css ? css(block.css) : block.css;
    const nextHtml = rewriteHtmlUrls(block.html ?? '', replacements);
    if (nextCss !== block.css || nextHtml !== block.html) {
      out.blocks.push({ ...block, html: nextHtml, ...(block.css !== undefined ? { css: nextCss } : {}) });
    }
  }
  return out;
}

/**
 * Replace file URLs in markup, textually, so the rest of the markup stays exactly as written.
 *
 * Re-serialising a parsed template would have been simpler and would have reformatted every
 * block it touched — quotes, entities, attribute order — turning a URL change into a rewrite of
 * the author's markup. So attributes are matched in the text: `src` and `poster` as a whole
 * value (never `href`, which on an `a` is a link to the file rather than a use of it), `srcset` candidate by candidate, `style` as CSS. `<style>` elements are CSS too.
 */
export function rewriteHtmlUrls(html: string, replacements: ReadonlyMap<string, string>): string {
  const swap = (raw: string): string | null => replacements.get(raw.trim()) ?? null;
  const withStyles = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_whole, open: string, body: string, close: string) => `${open}${rewriteCssUrls(body, swap)}${close}`,
  );
  return withStyles.replace(
    /(\s)(src|poster|srcset|style)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi,
    (whole, space: string, name: string, equals: string, dq: string | undefined, sq: string | undefined) => {
      const quote = dq !== undefined ? '"' : "'";
      const written = (dq ?? sq ?? '');
      const value = unescapeAttribute(written);
      const next = rewriteAttributeValue(name, value, swap);
      if (next === null) return whole;
      return `${space}${name}${equals}${quote}${escapeAttribute(next, quote)}${quote}`;
    },
  );
}

function unescapeAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function escapeAttribute(value: string, quote: string): string {
  const amp = value.replace(/&/g, '&amp;');
  return quote === '"' ? amp.replace(/"/g, '&quot;') : amp.replace(/'/g, '&#39;');
}

/* -------------------------------------------------------------------------- */
/* What the engine is asked to do                                              */
/* -------------------------------------------------------------------------- */

/** One change to the files, by reference: applied at once, as one undo step. */
export interface DesignFilePlan {
  /** Embedded files to write into their kind's folder and link. */
  store?: readonly string[];
  /** Linked or remote files to fold in as data URLs. */
  embed?: readonly string[];
  /** Folders to use from now on, by kind. Files already in a kind's old folder move with it. */
  folders?: Partial<Record<DesignFileKind, string>>;
}

export interface DesignFileOutcome {
  stored: number;
  embedded: number;
  moved: number;
  /** One sentence per file that could not be handled. Its references were left alone. */
  failed: string[];
  /**
   * Files embedded back that are still on disk, with nothing on this page linking them any more.
   * `path` is the project path to delete; `ref` the page-relative path to show.
   */
  leftovers?: Array<{
    name: string;
    ref: string;
    path: string;
    /** False when the file sits outside every Files folder, which is where the editor never deletes. */
    deletable: boolean;
  }>;
}

/* -------------------------------------------------------------------------- */
/* Leaving embedded files out of a seed                                        */
/* -------------------------------------------------------------------------- */

/**
 * The entries with every embedded file of the given kinds swapped for the path storing it would use.
 *
 * What "leave the fonts out of the seed" means. Dropping the reference would break the font face
 * or the image outright; swapping in an empty data URL would keep a placeholder nobody can act on.
 * The stored path is the useful answer: the seed stays small, and once the files are stored from
 * Settings › Files — which writes exactly these names, since a name is derived from the content —
 * the links resolve.
 */
export function withoutEmbedded(
  sources: DesignFileSources,
  kinds: ReadonlySet<DesignFileKind>,
  folders: Readonly<Record<DesignFileKind, string>>,
): DesignFileSources {
  if (!kinds.size) return sources;
  const replacements = new Map<string, string>();
  for (const file of scanDesignFiles(sources)) {
    if (file.place !== 'embedded' || !kinds.has(file.kind)) continue;
    const decoded = decodeDataUrl(file.ref);
    if (!decoded) continue;
    replacements.set(file.ref, storedPath(file, folders[file.kind], contentHash(decoded.bytes)));
  }
  if (!replacements.size) return sources;
  const changed = rewriteDesignFiles(sources, replacements);
  const swap = <T>(list: T[], next: T[], key: (entry: T) => string): T[] => {
    const byKey = new Map(next.map((entry) => [key(entry), entry]));
    return list.map((entry) => byKey.get(key(entry)) ?? entry);
  };
  return {
    tokens: swap(sources.tokens, changed.tokens, (entry) => entry.name),
    classes: swap(sources.classes, changed.classes, (entry) => entry.name),
    rules: swap(sources.rules, changed.rules, (entry) => `${entry.selector}@${entry.media ?? ''}`),
    blocks: swap(sources.blocks, changed.blocks, (entry) => entry.id),
  };
}
