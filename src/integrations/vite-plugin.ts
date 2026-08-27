import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { DesignSystemDocument } from '../core/types.js';
import { instrumentHTML, instrumentTemplates } from './instrument.js';

const SOURCE_ATTR = 'data-heo-src';
const VIRTUAL_ID = 'virtual:html-editor-overlay/bootstrap';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Where the read/write endpoint is mounted on the dev server. */
const FS_ENDPOINT = '/__heo/fs';

/**
 * Extensions the endpoint will write.
 *
 * An allowlist rather than a denylist, because the editor only ever writes markup,
 * styles and scripts — so the set of files it needs is small and known, and every
 * file outside it is one this has no business touching. That includes the ones it
 * would be worst to touch: `.env`, lockfiles, certificates, anything in `.git`.
 */
const WRITABLE = new Set([
  '.html', '.htm', '.xhtml',
  '.css',
  '.js', '.mjs', '.cjs', '.jsx',
  '.ts', '.mts', '.cts', '.tsx',
  '.json',
  '.svg',
  '.md',
  '.vue', '.svelte', '.astro',
]);

/** Directories the endpoint refuses outright, whatever the extension. */
const FORBIDDEN = ['node_modules', '.git', '.svn', '.hg'];

const MAX_BODY_BYTES = 8 * 1024 * 1024;
/**
 * Browser-facing URL for the virtual module.
 *
 * Vite encodes the leading null byte of a resolved virtual id as `__x00__` in
 * URLs; requesting the raw `\0` form 404s.
 */
const BOOTSTRAP_URL = `/@id/__x00__${VIRTUAL_ID}`;

export interface EditorOverlayPluginOptions {
  /**
   * Which modes the plugin runs in. Defaults to `'serve'`: shipping a visual
   * editor to production is almost never what you want, and the source markers
   * add weight to every element.
   */
  apply?: 'serve' | 'build' | 'both';
  /** Add `data-heo-src` markers to HTML files. Default `true`. */
  markHTML?: boolean;
  /**
   * Add markers inside tagged template literals in JS/TS files, for Lit and
   * friends. Default `true`.
   */
  markTemplates?: boolean;
  /** Template tag names to scan. Default `['html', 'svg']`. */
  templateTags?: string[];
  /** Inject the overlay script into HTML entry points. Default `true`. */
  inject?: boolean;
  /** Start the overlay in edit mode. Default `false`. */
  startInEditMode?: boolean;
  /** Overlay chrome theme. */
  theme?: 'dark' | 'light';
  /** Accent colour for the overlay chrome. */
  accent?: string;
  /** Shortcut that toggles edit mode. Default `'mod+e'`. */
  toggleShortcut?: string;
  /**
   * The design system every page starts from: tokens, classes and blocks.
   *
   * Four things are accepted, because the useful one differs by where the system
   * came from. A seed string (`'heo1z.…'`, from the Tokens panel) is the one to
   * paste when it arrived in a message. A path — `'./design-system.json'` — is the
   * one to use when the document is checked in, and it is read at config time and
   * inlined, so the browser makes no request and the page is never briefly
   * un-themed. A JSON string and a plain object also work.
   */
  designSystem?: DesignSystemDocument | string;
  /** Extra file filter. Return false to skip a module. */
  filter?: (id: string) => boolean;
  /**
   * Let the editor write the project's files. Default `true` while serving.
   *
   * This is what turns "saving produces a prompt" into "saving edits your source".
   * It is on by default because that is what a visual editor in a dev server is for,
   * and because the plugin only runs in `serve` to begin with — but it is a real
   * capability, so it is announced in the startup log rather than left to be
   * discovered, and it can be switched off here.
   *
   * Three things keep it from being a hole. Writes are confined to the Vite root and
   * to a small set of text extensions. Every request needs a token generated at
   * startup and inlined into a same-origin module. And it refuses to run at all when
   * the dev server is bound to a non-loopback address, unless `allowRemote` says
   * otherwise.
   */
  write?: boolean;
  /**
   * Permit writes when the dev server is reachable from the network.
   *
   * Off by default. `vite --host` puts the server on every interface, and a
   * file-writing endpoint on a shared network is a different proposition from one on
   * localhost — the token still guards it, but the blast radius of a mistake is no
   * longer your own machine.
   */
  allowRemote?: boolean;
}

/**
 * Vite plugin for the editor overlay.
 *
 * Does two jobs. It injects the overlay into every HTML entry point, so there is
 * no script tag to add by hand, and it stamps source locations onto elements at
 * transform time, which is what lets the save prompt name exact files and lines.
 *
 * Options that need a function — `onSave` in particular — cannot travel through
 * plugin config, so configure those from the page:
 *
 * ```js
 * window.HtmlEditorOverlay.configure({ … });
 * ```
 */
export default function editorOverlay(options: EditorOverlayPluginOptions = {}): Plugin {
  const {
    apply = 'serve',
    markHTML = true,
    markTemplates = true,
    templateTags = ['html', 'svg'],
    inject = true,
    write = true,
    allowRemote = false,
    filter,
  } = options;

  let root = process.cwd();
  let base = '/';
  /**
   * Regenerated every time the server starts, so a token that leaked into a log or a
   * stale tab stops working the moment the process restarts.
   */
  const token = randomUUID();
  /**
   * Set by `configureServer` once the endpoint is actually mounted.
   *
   * Starts false rather than following `write`, so the page is never told about an
   * endpoint that does not exist — which is what would happen in `build` mode, where
   * there is no dev server to mount anything on.
   */
  let writable = false;

  const shouldTransform = (id: string): boolean => {
    if (id.includes('node_modules')) return false;
    if (id.includes('\0')) return false;
    if (filter && !filter(id)) return false;
    return true;
  };

  const relativeTo = (id: string): string => {
    const clean = id.split('?')[0];
    const rel = relative(root, clean);
    // Keep POSIX separators so the marker looks the same on every platform.
    return rel.split('\\').join('/');
  };

  /**
   * Built on demand rather than up front, because a design-system path is resolved
   * against the project root and the root is not known until `configResolved`.
   * Memoised after the first call: `load` runs once per page reload.
   */
  let mountOptions: string | null = null;
  const buildMountOptions = (): string => {
    if (mountOptions !== null) return mountOptions;
    mountOptions = JSON.stringify({
      startInEditMode: options.startInEditMode ?? false,
      theme: options.theme,
      accent: options.accent,
      toggleShortcut: options.toggleShortcut,
      // Inlined into the virtual module rather than fetched or put in an attribute:
      // a same-origin ES module is somewhere another origin cannot read from, which
      // is the whole reason the token is worth anything.
      ...(writable ? { sourceEndpoint: FS_ENDPOINT, sourceToken: token } : {}),
      ...resolveDesignSystem(options.designSystem, root),
    });
    return mountOptions;
  };

  return {
    name: 'html-editor-overlay',
    apply: apply === 'both' ? undefined : apply,
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      base = config.base || '/';
    },

    /**
     * Mount the read/write endpoint.
     *
     * Runs before `load` builds the mount options, which is what lets a refusal here
     * — a non-loopback bind, say — reach the page as "no endpoint" rather than as an
     * endpoint that answers 403 to everything.
     */
    configureServer(server) {
      if (!write) return;

      if (isRemote(server) && !allowRemote) {
        server.config.logger.warn(
          '[html-editor-overlay] file writing is off: the dev server is bound to a ' +
          'non-loopback address. Pass allowRemote: true to enable it anyway.',
        );
        return;
      }

      writable = true;
      server.config.logger.info(
        `[html-editor-overlay] editing writes to ${root} (set write: false to turn this off)`,
      );
      server.middlewares.use(FS_ENDPOINT, (request, response) => {
        void handleFileRequest(request, response, { root, base, token });
      });
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },

    /**
     * The bootstrap is a virtual module rather than an inline script so the
     * overlay is resolved and pre-bundled by Vite like any other dependency,
     * and so a page CSP that forbids inline scripts still works.
     */
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return [
        `import { mount } from 'html-editor-overlay';`,
        `const api = mount(${buildMountOptions()});`,
        `if (import.meta.hot) {`,
        `  import.meta.hot.dispose(() => api.unmount());`,
        `}`,
        `export default api;`,
      ].join('\n');
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const marked =
          markHTML && ctx.filename && shouldTransform(ctx.filename)
            ? instrumentHTML(html, relativeTo(ctx.filename), SOURCE_ATTR)
            : html;

        if (!inject) return marked;
        return {
          html: marked,
          tags: [
            {
              tag: 'script',
              attrs: { type: 'module', src: BOOTSTRAP_URL },
              injectTo: 'body',
            },
          ],
        };
      },
    },

    transform(code, id) {
      if (!markTemplates || !shouldTransform(id)) return null;
      if (!/\.(?:[jt]sx?|mjs|mts)$/.test(id.split('?')[0])) return null;
      // Cheap pre-check: most files have no tagged templates at all.
      if (!templateTags.some((tag) => code.includes(`${tag}\``))) return null;

      const next = instrumentTemplates(code, relativeTo(id), SOURCE_ATTR, templateTags);
      if (next === code) return null;
      // Attribute insertion shifts columns on the lines it touches. Returning a
      // null map tells Vite to fall back to the original mapping, which is
      // accurate to the line and is what stack traces need.
      return { code: next, map: null };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The read/write endpoint                                                     */
/* -------------------------------------------------------------------------- */

/** Node's request and response, structurally, so `node:http` need not be imported. */
interface FsRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'end' | 'error', listener: (error?: Error) => void): void;
  destroy(): void;
}

interface FsResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

interface FsContext {
  root: string;
  base: string;
  token: string;
}

/**
 * Serve one file request.
 *
 * The order of the checks is the security model, so it is worth reading as one:
 * authenticate, confirm the request came from this server's own page, then decide
 * whether the path is one this endpoint is allowed to touch — and only then do any
 * I/O. Nothing about the path is trusted before it has been resolved and found to be
 * inside the root.
 */
async function handleFileRequest(
  request: FsRequest,
  response: FsResponse,
  context: FsContext,
): Promise<void> {
  const send = (status: number, body: string, type = 'text/plain;charset=utf-8'): void => {
    response.statusCode = status;
    response.setHeader('content-type', type);
    // No CORS headers, ever. Another origin may be able to send a request here; it
    // must never be able to read the answer.
    response.setHeader('cache-control', 'no-store');
    response.end(body);
  };

  if (header(request, 'x-heo-token') !== context.token) {
    send(403, 'Bad or missing editor token.');
    return;
  }

  // A browser sends `Origin` on every non-GET request. One that disagrees with the
  // host it was sent to is not this project's page, whatever token it managed to
  // present.
  const origin = header(request, 'origin');
  const host = header(request, 'host');
  if (origin && host && !originMatchesHost(origin, host)) {
    send(403, 'Cross-origin writes are not allowed.');
    return;
  }

  const url = new URL(request.url ?? '/', 'http://localhost');
  const requested = url.searchParams.get('path');
  const method = (request.method ?? 'GET').toUpperCase();

  // The probe. Says where the project is, so the page can turn URLs into paths.
  if (!requested) {
    if (method !== 'GET') {
      send(405, 'The probe is a GET.');
      return;
    }
    send(200, JSON.stringify({ ok: true, root: context.root, base: context.base }), 'application/json');
    return;
  }

  const target = safeResolve(context.root, requested);
  if (!target) {
    send(403, `${requested} is not a file this endpoint will touch.`);
    return;
  }

  if (method === 'GET') {
    try {
      send(200, await readFile(target, 'utf8'));
    } catch {
      send(404, 'No such file.');
    }
    return;
  }

  if (method !== 'PUT') {
    send(405, 'Use GET to read and PUT to write.');
    return;
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    send(413, error instanceof Error ? error.message : 'Body too large.');
    return;
  }

  try {
    // Directories are created on the way, so writing a file into a folder that does
    // not exist yet works. Nothing outside the root is reachable to create.
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, 'utf8');
    send(200, JSON.stringify({ ok: true, bytes: Buffer.byteLength(body) }), 'application/json');
  } catch (error) {
    send(500, error instanceof Error ? error.message : 'Write failed.');
  }
}

/**
 * A requested path as an absolute one inside the root, or null.
 *
 * Three ways to be refused. Resolving out of the root — whether by `..` or by handing
 * over an absolute path, which `resolve` would otherwise honour outright. Living in a
 * directory this has no business in. And having an extension outside the small set the
 * editor actually writes.
 */
function safeResolve(root: string, requested: string): string | null {
  const target = resolve(root, requested);
  if (target !== root && !target.startsWith(root + sep)) return null;

  const inside = relative(root, target).split(/[\\/]/);
  if (inside.some((part) => FORBIDDEN.includes(part))) return null;

  const dot = target.lastIndexOf('.');
  const slash = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
  if (dot <= slash) return null;
  return WRITABLE.has(target.slice(dot).toLowerCase()) ? target : null;
}

function readBody(request: FsRequest): Promise<string> {
  return new Promise((fulfil, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error('That file is larger than this endpoint will write.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => fulfil(Buffer.concat(chunks).toString('utf8')));
    request.on('error', (error) => reject(error ?? new Error('Request failed.')));
  });
}

function header(request: FsRequest, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function originMatchesHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** True when the dev server is listening on something other than loopback. */
function isRemote(server: ViteDevServer): boolean {
  const host = server.config.server.host;
  if (host === undefined || host === false) return false;
  if (host === true) return true;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

/**
 * Work out which kind of design system was configured, and hand back the mount
 * option it belongs in.
 *
 * A path is read here, at config time, rather than fetched by the browser. That is
 * the whole reason to prefer it: the system is inlined into the bootstrap module,
 * so there is no request to fail and no moment where the page is mounted but not
 * yet themed. A file that is missing or malformed is a config error worth failing
 * loudly on — silently serving pages without their design system is the outcome
 * nobody wants to debug.
 */
function resolveDesignSystem(
  input: DesignSystemDocument | string | undefined,
  root: string,
): { seed?: string; designSystem?: DesignSystemDocument | string } {
  if (!input) return {};
  if (typeof input !== 'string') return { designSystem: input };

  const text = input.trim();
  if (/^heo\d+[a-z]\./.test(text)) return { seed: text };
  if (text.startsWith('{')) return { designSystem: text };

  const path = isAbsolute(text) ? text : resolve(root, text);
  try {
    return { designSystem: readFileSync(path, 'utf8') };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[html-editor-overlay] could not read the design system at ${path}: ${reason}`,
    );
  }
}

export { editorOverlay };
export type { Plugin };
