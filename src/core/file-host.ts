/**
 * A writable view of the files behind the page.
 *
 * The overlay's whole design assumes it cannot reach your source, and for a page
 * that keeps its CSS and JS inline that assumption costs nothing: the document *is*
 * the project, so serializing it is saving it. The moment a page links out —
 * `<link rel="stylesheet" href="theme.css">`, `<script src="main.js">` — that stops
 * being true. Those edits live in the CSSOM and in change records, and the exported
 * HTML carries no trace of them, because they were never in the HTML.
 *
 * So the page needs a way to reach the files. Two exist, and they suit different
 * situations rather than ranking:
 *
 * - **A folder the user hands over.** `showDirectoryPicker()` returns a handle the
 *   page can read and write. No server, no build step, no configuration — which is
 *   exactly the situation heo was built for, a folder of HTML and CSS opened in a
 *   browser. Chromium-only, and gated behind a user gesture and an explicit grant.
 * - **A dev server that accepts writes.** The Vite plugin already knows the project
 *   root and already stamps project-relative paths onto elements, so it can serve a
 *   small read/write endpoint. Works in every browser, needs no picker, and the
 *   paths are exact rather than inferred.
 *
 * Both are reduced to the same three verbs — resolve a URL to a project path, read
 * that path, write it — so nothing above this file has to care which one is in play.
 *
 * Neither is ever the default. A visual editor that silently writes to disk is a
 * worse idea than one that cannot write at all, so a host has to be connected
 * deliberately, and the prompt hand-off stays exactly where it was for everyone who
 * does not.
 */

/* -------------------------------------------------------------------------- */
/* The interface                                                               */
/* -------------------------------------------------------------------------- */

export type FileHostKind = 'directory' | 'server';

export interface FileHost {
  readonly kind: FileHostKind;
  /** What to call this in the UI: a folder name, or the project root. */
  readonly label: string;
  /**
   * The project-relative path a URL corresponds to, or null when the URL is not
   * something this host can reach — a CDN stylesheet, or a file outside the folder
   * that was handed over.
   */
  resolve(url: string): string | null;
  /** The file's current text, or null when it is not there. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /**
   * True when writing will work right now.
   *
   * Separate from connecting because a directory grant does not survive a reload:
   * the handle does, but the permission drops back to "prompt", and asking for it
   * again needs a user gesture. So this is called from a click, not on mount.
   */
  ensureWritable(): Promise<boolean>;
  /** Forget this host, including anything persisted about it. */
  release(): Promise<void>;
}

/** What the current browser and page can offer, for the UI to explain. */
export interface HostAvailability {
  /** A dev server advertised a write endpoint. */
  server: boolean;
  /** This browser has the directory picker. */
  picker: boolean;
  /** Why there is nothing on offer, when there is nothing. */
  reason?: string;
}

/* -------------------------------------------------------------------------- */
/* Platform bits missing from lib.dom                                          */
/* -------------------------------------------------------------------------- */

/**
 * TypeScript ships the handle types but not the picker or the permission methods,
 * which are still specified outside the main DOM standard. Declared narrowly here
 * rather than pulled in as a dependency: three members is less to keep in step than
 * a whole ambient package.
 */
interface DirectoryPicker {
  showDirectoryPicker?(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string | FileSystemHandle;
  }): Promise<FileSystemDirectoryHandle>;
}

interface PermissionAwareHandle {
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A URL as a path, in the shape a project uses.
 *
 * Cross-origin URLs are rejected outright: whatever they point at, it is not in the
 * folder the user handed over, and writing a same-named local file instead would be
 * a quiet substitution.
 */
export function projectPathOf(url: string): string | null {
  try {
    const parsed = new URL(url, location.href);
    const local = parsed.origin === location.origin || parsed.protocol === 'file:';
    if (!local) return null;
    let path = decodeURIComponent(parsed.pathname);
    // A directory URL is served by its index; the file is what gets written.
    if (path.endsWith('/')) path += 'index.html';
    return normalizePath(path);
  } catch {
    return null;
  }
}

/** Collapse a path to POSIX segments with no leading slash, or null if it escapes. */
export function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split(/[\\/]+/)) {
    if (!part || part === '.') continue;
    // `..` is refused rather than resolved. A path that climbs is either a mistake
    // or an attempt to write outside the project, and neither deserves a best guess.
    if (part === '..') return null;
    parts.push(part);
  }
  return parts.join('/');
}

/** The path of the document itself, which is the one file guaranteed to exist. */
export function documentPath(): string | null {
  return projectPathOf(location.href);
}

/* -------------------------------------------------------------------------- */
/* A folder the user handed over                                               */
/* -------------------------------------------------------------------------- */

/** True when this browser can offer a folder at all. */
export function directoryPickerAvailable(): boolean {
  return typeof (window as unknown as DirectoryPicker).showDirectoryPicker === 'function';
}

class DirectoryHost implements FileHost {
  readonly kind = 'directory' as const;
  #handle: FileSystemDirectoryHandle;
  /**
   * The URL path prefix the chosen folder stands in for.
   *
   * The user picks a folder without being asked how it relates to the URL, because
   * that is not a question anyone should have to answer. It is worked out instead,
   * by looking for the document's own file inside the folder: if `/shop/css/a.html`
   * is found at `css/a.html`, the folder covers everything under `/shop/`, and every
   * other URL is resolved by trimming the same prefix. Inferring it once from a file
   * known to exist is what lets a file that does *not* exist yet still be placed.
   */
  #base = '';

  constructor(handle: FileSystemDirectoryHandle) {
    this.#handle = handle;
  }

  get label(): string {
    return this.#handle.name || 'project folder';
  }

  get handle(): FileSystemDirectoryHandle {
    return this.#handle;
  }

  resolve(url: string): string | null {
    const path = projectPathOf(url);
    if (path === null) return null;
    if (!this.#base) return path;
    if (path === this.#base) return '';
    return path.startsWith(`${this.#base}/`) ? path.slice(this.#base.length + 1) : null;
  }

  async read(path: string): Promise<string | null> {
    const at = await this.#locate(path, false);
    if (!at) return null;
    try {
      const handle = await at.dir.getFileHandle(at.name);
      return await (await handle.getFile()).text();
    } catch {
      return null;
    }
  }

  async write(path: string, text: string): Promise<void> {
    const at = await this.#locate(path, true);
    if (!at) throw new Error(`Could not open ${path} inside ${this.label}.`);
    const handle = await at.dir.getFileHandle(at.name, { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(text);
    } finally {
      // Closing is what commits the write, so it happens even when writing threw —
      // otherwise the file is left truncated with the temporary swap file behind it.
      await stream.close();
    }
  }

  async ensureWritable(): Promise<boolean> {
    const handle = this.#handle as FileSystemDirectoryHandle & PermissionAwareHandle;
    const descriptor = { mode: 'readwrite' } as const;
    try {
      if (typeof handle.queryPermission === 'function') {
        if ((await handle.queryPermission(descriptor)) === 'granted') return true;
      }
      if (typeof handle.requestPermission === 'function') {
        return (await handle.requestPermission(descriptor)) === 'granted';
      }
      // No permission API to consult. Trying is the only way to find out, and a
      // failed write reports itself.
      return true;
    } catch {
      return false;
    }
  }

  async release(): Promise<void> {
    await forgetHandle();
  }

  /** Work out which URL prefix this folder covers. False when it covers none. */
  async calibrate(): Promise<boolean> {
    const target = documentPath();
    if (target === null) return false;
    const segments = target.split('/');

    // Longest suffix first: a folder that contains `css/site.html` should be read as
    // covering `css/`, not as coincidentally containing a `site.html`.
    for (let drop = 0; drop < segments.length; drop += 1) {
      const candidate = segments.slice(drop).join('/');
      if (await this.#exists(candidate)) {
        this.#base = segments.slice(0, drop).join('/');
        return true;
      }
    }
    return false;
  }

  async #exists(path: string): Promise<boolean> {
    const at = await this.#locate(path, false);
    if (!at) return false;
    try {
      await at.dir.getFileHandle(at.name);
      return true;
    } catch {
      return false;
    }
  }

  async #locate(
    path: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
    const clean = normalizePath(path);
    if (!clean) return null;
    const parts = clean.split('/');
    const name = parts.pop();
    if (!name) return null;

    let dir = this.#handle;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }
    return { dir, name };
  }
}

/**
 * Ask for a folder. Must be called from a user gesture.
 *
 * Returns null when the user cancels, which is not an error and should not be
 * reported as one — the picker is also how someone changes their mind.
 */
export async function connectDirectory(): Promise<FileHost | null> {
  const picker = window as unknown as DirectoryPicker;
  if (typeof picker.showDirectoryPicker !== 'function') return null;

  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker.showDirectoryPicker({
      id: 'heo-project',
      mode: 'readwrite',
      // Reopening lands where they were last time, which for a folder that has to
      // match the page is most of the work of finding it again.
      startIn: 'documents',
    });
  } catch {
    return null;
  }

  const host = new DirectoryHost(handle);
  if (!(await host.ensureWritable())) return null;
  if (!(await host.calibrate())) {
    throw new Error(
      `That folder does not contain this page. Pick the folder holding ${documentPath()?.split('/').pop() ?? 'this page'
      }, or one of its parents.`,
    );
  }
  await rememberHandle(handle);
  return host;
}

/**
 * Pick up a folder granted in an earlier session, if the permission survived.
 *
 * Deliberately silent when it did not. The handle persists but the grant does not,
 * and re-requesting needs a gesture — so a page that reloads mid-session comes back
 * showing "reconnect" rather than a permission prompt nobody asked for.
 */
export async function restoreDirectory(): Promise<FileHost | null> {
  if (!directoryPickerAvailable()) return null;
  const handle = await recallHandle();
  if (!handle) return null;

  const permission = handle as FileSystemDirectoryHandle & PermissionAwareHandle;
  try {
    if (typeof permission.queryPermission === 'function') {
      if ((await permission.queryPermission({ mode: 'readwrite' })) !== 'granted') return null;
    }
  } catch {
    return null;
  }

  const host = new DirectoryHost(handle);
  return (await host.calibrate()) ? host : null;
}

/* -------------------------------------------------------------------------- */
/* A dev server that accepts writes                                            */
/* -------------------------------------------------------------------------- */

/**
 * The read/write endpoint's contract, which the Vite plugin implements:
 *
 * - `GET  {endpoint}` → `{ ok, root, base }`, the probe.
 * - `GET  {endpoint}?path=rel` → the file as text, or 404.
 * - `PUT  {endpoint}?path=rel` → body is the new text; `{ ok, bytes }` or an error.
 *
 * Paths are project-relative and resolved against the server's root, which refuses
 * anything that climbs out of it. That check belongs on the server: a page is not
 * in a position to enforce where it may write.
 */
class ServerHost implements FileHost {
  readonly kind = 'server' as const;
  #endpoint: string;
  #root: string;
  /** The server's URL base, so a project served under a sub-path still resolves. */
  #base: string;
  #token: string;

  constructor(endpoint: string, root: string, base: string, token: string) {
    this.#endpoint = endpoint;
    this.#root = root;
    this.#base = normalizePath(base) ?? '';
    this.#token = token;
  }

  /**
   * Every request carries the token, in a header rather than the URL.
   *
   * Two things follow from that. The token is unguessable, so a page on another
   * origin cannot write to this project even though a `PUT` with a text body is a
   * request the browser will happily send cross-origin without asking. And a custom
   * header makes such a request non-simple, so it needs a preflight the endpoint
   * never approves — the attempt does not reach the handler at all.
   */
  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'x-heo-token': this.#token, ...extra };
  }

  get label(): string {
    return this.#root.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
  }

  get root(): string {
    return this.#root;
  }

  resolve(url: string): string | null {
    const path = projectPathOf(url);
    if (path === null) return null;
    if (!this.#base) return path;
    if (path === this.#base) return '';
    return path.startsWith(`${this.#base}/`) ? path.slice(this.#base.length + 1) : null;
  }

  async read(path: string): Promise<string | null> {
    const clean = normalizePath(path);
    if (!clean) return null;
    try {
      const response = await fetch(this.#url(clean), {
        credentials: 'same-origin',
        headers: this.#headers(),
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }

  async write(path: string, text: string): Promise<void> {
    const clean = normalizePath(path);
    if (!clean) throw new Error(`${path} is not a path inside the project.`);
    const response = await fetch(this.#url(clean), {
      method: 'PUT',
      credentials: 'same-origin',
      headers: this.#headers({ 'content-type': 'text/plain;charset=utf-8' }),
      body: text,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${response.status} writing ${clean}${detail ? `: ${detail}` : ''}`);
    }
  }

  async ensureWritable(): Promise<boolean> {
    return (await probeServer(this.#endpoint, this.#token)) !== null;
  }

  async release(): Promise<void> {
    // Nothing is held: the endpoint is the grant, and it belongs to the dev server.
  }

  #url(path: string): string {
    const separator = this.#endpoint.includes('?') ? '&' : '?';
    return `${this.#endpoint}${separator}path=${encodeURIComponent(path)}`;
  }
}

interface ServerProbe {
  root: string;
  base: string;
}

async function probeServer(endpoint: string, token: string): Promise<ServerProbe | null> {
  try {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      headers: { 'x-heo-token': token },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; root?: string; base?: string };
    if (!body?.ok || typeof body.root !== 'string') return null;
    return { root: body.root, base: typeof body.base === 'string' ? body.base : '' };
  } catch {
    return null;
  }
}

/**
 * Connect to a dev-server endpoint, when one is actually there.
 *
 * Probed rather than assumed. The endpoint is configured by the plugin, but the same
 * page can be opened from a static server later, and a write that 404s after the user
 * pressed Save is the worst moment to discover that.
 */
export async function connectServer(
  endpoint: string | undefined,
  token: string | undefined,
): Promise<FileHost | null> {
  if (!endpoint || !token) return null;
  const probe = await probeServer(endpoint, token);
  if (!probe) return null;
  return new ServerHost(endpoint, probe.root, probe.base, token);
}

/* -------------------------------------------------------------------------- */
/* What is on offer                                                            */
/* -------------------------------------------------------------------------- */

export async function hostAvailability(
  endpoint: string | undefined,
  token: string | undefined,
): Promise<HostAvailability> {
  const picker = directoryPickerAvailable();
  const server = endpoint && token ? (await probeServer(endpoint, token)) !== null : false;
  if (picker || server) return { picker, server };

  return {
    picker,
    server,
    reason: isSecureContext
      ? 'This browser cannot hand a folder to a page, and no dev server offered to write files. Chrome, Edge or the Vite plugin can.'
      : 'Writing files needs a secure context. Serve this page over https or localhost.',
  };
}

/* -------------------------------------------------------------------------- */
/* Remembering a folder across reloads                                         */
/* -------------------------------------------------------------------------- */

/**
 * Directory handles are structured-cloneable, so IndexedDB can hold one across a
 * reload. The permission cannot travel with it, which is the point of storing it
 * anyway: coming back to "reconnect this folder" is one click, while coming back to
 * an empty picker means finding the project again by hand.
 *
 * Keyed by the document's own directory rather than by origin, because `localhost`
 * is every project's origin and handing one project's folder to another would be
 * both wrong and hard to notice.
 */
const DB_NAME = 'html-editor-overlay';
const STORE = 'project-handles';

function handleKey(): string {
  const path = documentPath() ?? '';
  const directory = path.split('/').slice(0, -1).join('/');
  return `${location.origin}/${directory}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    // Private browsing and blocked storage both land here. Persistence is a
    // convenience, so failing to get it is not worth reporting.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const request = run(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => {
            resolve(request.result);
            db.close();
          };
          request.onerror = () => {
            resolve(null);
            db.close();
          };
        } catch {
          resolve(null);
          db.close();
        }
      }),
  );
}

async function rememberHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await transact('readwrite', (store) => store.put(handle, handleKey()));
}

async function recallHandle(): Promise<FileSystemDirectoryHandle | null> {
  const value = await transact<unknown>('readonly', (store) => store.get(handleKey()));
  // `instanceof` rather than a duck-type check: anything else in this slot is stale
  // data from an older version of the format, and using it would fail later and
  // further away.
  return value instanceof FileSystemDirectoryHandle ? value : null;
}

async function forgetHandle(): Promise<void> {
  await transact('readwrite', (store) => store.delete(handleKey()));
}
