import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';
import type { DesignSystemDocument } from '../core/types.js';
import {
  describeDiscovery,
  discoverAiProviders,
  isIncomplete,
  publicProviderSets,
  type DiscoveredProvider,
} from './ai-env.js';
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
  /**
   * AI providers, and the credentials that reach them. **Nothing needs to be set here.**
   *
   * By default the plugin reads the environment — `.env`, through Vite's own loader, plus
   * anything already exported in the shell — and offers every provider it finds a key for. So
   * this is the whole setup:
   *
   * ```ini
   * # .env
   * ANTHROPIC_API_KEY=sk-ant-…
   * ```
   *
   * ```js
   * editorOverlay()
   * ```
   *
   * Any number of custom OpenAI-compatible endpoints work the same way, grouped by a name of
   * your choosing — `HEO_AI_WORK_API_KEY` with `HEO_AI_WORK_BASE_URL`. See `ai-env.ts` for the
   * full set of recognised variables.
   *
   * Whichever route the key arrives by, it stays on this side. That is the only reason this
   * option is a security property rather than a preference: an API key in the browser is
   * readable by every script sharing that page's JavaScript realm, and the overlay mounts *into*
   * pages it does not control. Nothing done in the browser fixes that — encrypting the key at
   * rest only hides it from something that could not run code, which in a browser is nothing.
   * The page sends a prompt and gets a stream back; it cannot name the destination and it cannot
   * read the credential, because neither ever crosses the boundary.
   *
   * Pass `false` to read nothing from the environment, or configure providers explicitly when
   * they come from somewhere Vite's env loader cannot see — a secret manager, say.
   */
  ai?: false | {
    /** Read providers from the environment. Default `true`. */
    env?: boolean;
    /** Providers configured by hand, offered before any the environment supplies. */
    providers?: Array<{
      /** Defaults to a slug of the label. Stable ids matter: the page stores settings against them. */
      id?: string;
      label?: string;
      provider: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
      apiKey: string | undefined;
      /** Defaults to the provider's own host. Set it for a gateway or a self-hosted server. */
      baseURL?: string;
      /** Models the page may ask for. Absent means any, which is the usual case for one's own key. */
      models?: string[];
      /** What the page starts with in its model field. */
      model?: string;
    }>;
    /** One provider inline, which is the shorthand for a `providers` array of length one. */
    provider?: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
    apiKey?: string | undefined;
    baseURL?: string;
    models?: string[];
    model?: string;
  };
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
   * Providers this server holds a key for, discovered in `configResolved`.
   *
   * Populated there and not later because `buildMountOptions` memoises on its first call and that
   * call happens in `load` — a list assembled after that point would never reach the page.
   */
  let providers: DiscoveredProvider[] = [];
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
      /*
       * The providers, with their credentials removed by `publicProviderSets`.
       *
       * Gated on `writable` because a proxied set reaches the server through the same endpoint
       * the file route uses. With no endpoint there is nothing for these sets to talk to, and
       * offering them would put a provider in the settings panel that fails on first use.
       *
       * This is what makes the feature zero-config: the page opens with the providers already
       * listed, named and pointed at a model, so there is nothing to type in and no key to paste.
       */
      ...(writable && usable(providers).length
        ? { aiProviders: publicProviderSets(usable(providers)) }
        : {}),
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
      /*
       * Read here because this is the first hook that knows where the env files are, and because
       * `buildMountOptions` caches on first use in `load` — later is too late.
       *
       * `''` as the prefix loads unprefixed names, which is the whole point: `ANTHROPIC_API_KEY`
       * is the name every other tool uses, and a `VITE_`-prefixed variable would be inlined into
       * client bundles, which for a credential is the one outcome to avoid.
       *
       * Two directories, because `envDir` follows the Vite root and the Vite root is often not
       * where a person keeps their `.env`. `root: 'demo'`, `root: 'src'` and any monorepo package
       * all put the config — and the `.env` beside it — a level up from the root Vite serves.
       * Looking only at `envDir` there means "just add a .env file" quietly does not work, which
       * is the whole promise this is making. The directory nearer the Vite root wins.
       */
      const files = [process.cwd(), config.envDir ?? config.root];
      providers = collectProviders(options.ai, {
        ...Object.assign({}, ...files.map((dir) => loadEnv(config.mode, dir, ''))),
        // The shell last: an exported variable is the most immediate statement of intent, and it
        // is also how CI and a secret manager hand one over.
        ...process.env,
      });
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

      /*
       * One route, two jobs, distinguished by `?ai=1`.
       *
       * Mounted together deliberately: they share the token, the origin check and the
       * no-CORS rule, and splitting them would mean two places for those to drift apart. The
       * page asks for the AI path by query rather than by a separate URL for the same reason —
       * one endpoint to advertise, one grant to hold.
       */
      /*
       * Announced rather than left to be discovered.
       *
       * Reading the ambient environment means a key exported months ago for another tool can turn
       * this on without anybody asking for it, so the log names each provider and the variable it
       * came from. That is the difference between a convenience and a surprise.
       */
      for (const line of describeDiscovery(providers)) {
        const complain = line.includes('was found but');
        const say = complain ? server.config.logger.warn : server.config.logger.info;
        say.call(server.config.logger, `[html-editor-overlay] ${line}`);
      }
      /*
       * A broken CA path, said now rather than on the first request.
       *
       * `NODE_EXTRA_CA_CERTS` must name a PEM file. Set to the directory holding one — an easy
       * mistake, and one nothing else complains about — Node silently loads no extra certificates
       * and every outbound HTTPS request from this server fails verification. The symptom arrives
       * much later and looks like a broken API key, so it is worth one line at startup.
       */
      if (usable(providers).length) {
        const extra = process.env.NODE_EXTRA_CA_CERTS;
        if (extra && !isReadableFile(extra)) {
          server.config.logger.warn(
            `[html-editor-overlay] NODE_EXTRA_CA_CERTS is set to ${extra}, which is not a readable ` +
            'file. Node will load no extra certificates, so proxied AI requests will fail TLS ' +
            'verification even though your browser succeeds. It must name the certificate file ' +
            'itself, not the folder containing it.',
          );
        }
      }

      server.middlewares.use(FS_ENDPOINT, (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.searchParams.has('ai')) {
          void handleAiRequest(request, response, { token, providers: usable(providers) });
          return;
        }
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
              /*
               * Marked as injected, so the export knows not to write it into the file.
               * The bootstrap URL already sits in Vite's virtual namespace and would be
               * recognised by that alone, but a tag this plugin controls should say what
               * it is rather than be inferred from the shape of its src.
               */
              attrs: { type: 'module', src: BOOTSTRAP_URL, 'data-heo-injected': '' },
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

/** Each provider's own host, so the common case needs no `baseURL`. */
const AI_HOSTS: Record<DiscoveredProvider['provider'], string> = {
  openai: 'https://api.openai.com/v1',
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
};

/**
 * The providers this server will act for: explicit configuration first, then the environment.
 *
 * Order is priority, and the page treats the first as its default — so something written into the
 * config wins over something found lying around, which is the order of deliberateness.
 */
function collectProviders(
  option: EditorOverlayPluginOptions['ai'],
  env: Record<string, string | undefined>,
): DiscoveredProvider[] {
  if (option === false) return [];
  const out: DiscoveredProvider[] = [];

  const explicit = [
    ...(option?.provider && option.apiKey
      ? [{
        provider: option.provider,
        apiKey: option.apiKey,
        baseURL: option.baseURL,
        models: option.models,
        model: option.model,
      }]
      : []),
    ...(option?.providers ?? []),
  ];
  for (const [index, one] of explicit.entries()) {
    if (!one.apiKey) continue;
    const label = one.label ?? labelFor(one.provider);
    out.push({
      id: one.id ?? `heo-config-${index === 0 ? one.provider : `${one.provider}-${index}`}`,
      label,
      provider: one.provider,
      apiKey: one.apiKey,
      ...(one.baseURL ? { baseURL: one.baseURL } : {}),
      ...(one.models?.length ? { models: one.models } : {}),
      model: one.model ?? one.models?.[0] ?? '',
      foundAt: 'the plugin config',
    });
  }

  if (option?.env !== false) {
    const seen = new Set(out.map((one) => one.id));
    for (const found of discoverAiProviders(env)) {
      if (!seen.has(found.id)) out.push(found);
    }
  }
  return out;
}

function labelFor(provider: DiscoveredProvider['provider']): string {
  switch (provider) {
    case 'anthropic': return 'Anthropic';
    case 'openai': return 'OpenAI';
    case 'google': return 'Google Gemini';
    default: return 'Custom provider';
  }
}

/** Providers that can actually be reached — a named group with no base URL is not one. */
function usable(providers: readonly DiscoveredProvider[]): DiscoveredProvider[] {
  return providers.filter((one) => !isIncomplete(one));
}

/**
 * Proxy one AI request, holding the credential here.
 *
 * The same check order as the file route, for the same reason: authenticate, confirm the request
 * came from this server's own page, then act. What differs is what is being protected — there the
 * concern is which files may be written, here it is that a credential must not travel outward and
 * must not be spendable by anything other than this page.
 *
 * Three things the page is deliberately not allowed to decide.
 *
 * **Where the request goes.** The destination comes from this server's own list, never from the
 * body. A page that could name the host could point the server at a host of its choosing and have
 * it authenticate to it — which is a credential leak wearing a proxy's clothes.
 *
 * **Which provider dialect is spoken.** Same reasoning: the server knows which credential it
 * holds, so it knows which API that credential is for.
 *
 * **Which model, when `models` is set.** Optional because one's own key on one's own machine has
 * no reason to be restricted, and useful the moment the key is shared with a team.
 *
 * What the page *may* choose is which of the configured providers to use, by the `set` id it was
 * given at mount. That is a handle into this table and not a description of anything: an id names
 * a provider the server already holds a key for and already told the page about, so the widest
 * possible abuse is picking a different one of the user's own models.
 *
 * The reply is streamed through untouched. The editor's client already knows how to read every
 * one of these providers' event streams, so translating here would be a second implementation of
 * something that exists — and the one place they would eventually disagree.
 */
async function handleAiRequest(
  request: FsRequest,
  response: FsResponse,
  context: { token: string; providers: readonly DiscoveredProvider[] },
): Promise<void> {
  /*
   * Refusals go out as JSON with a `message`.
   *
   * The editor's client digs that field out and shows it verbatim, so a misconfiguration explains
   * itself in the settings panel instead of arriving as a status code the user has to look up.
   */
  const refuse = (status: number, message: string): void => {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    // No CORS headers here either. Another origin may reach this; it must not read the answer.
    response.end(JSON.stringify({ error: { message } }));
  };

  if (header(request, 'x-heo-token') !== context.token) {
    refuse(403, 'Bad or missing editor token.');
    return;
  }
  const origin = header(request, 'origin');
  const host = header(request, 'host');
  if (origin && host && !originMatchesHost(origin, host)) {
    refuse(403, 'Cross-origin AI requests are not allowed.');
    return;
  }
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    refuse(405, 'AI requests are a POST.');
    return;
  }
  if (!context.providers.length) {
    refuse(
      501,
      'This dev server is not holding an AI key. Put one in .env — ANTHROPIC_API_KEY, ' +
      'OPENAI_API_KEY or GEMINI_API_KEY are all picked up automatically — and restart it. ' +
      'Or use a local model instead.',
    );
    return;
  }

  let asked: { model?: unknown; system?: unknown; prompt?: unknown; set?: unknown };
  try {
    asked = JSON.parse(await readBody(request)) as typeof asked;
  } catch {
    refuse(400, 'That request body was not readable.');
    return;
  }
  const model = String(asked.model ?? '').trim();
  const system = String(asked.system ?? '');
  const prompt = String(asked.prompt ?? '');
  if (!model || !prompt) {
    refuse(400, 'A model and a prompt are both needed.');
    return;
  }

  /*
   * Which provider, by the id the page was handed at mount.
   *
   * The fallback to the first is not laxity: a page holding a set from an earlier run of a server
   * that has since been reconfigured would otherwise be stuck, and the first provider is the one
   * the page would have been given as its default anyway. An id that is present but unknown is a
   * different matter and is refused, because silently spending a different provider's budget than
   * the one asked for is worse than a clear error.
   */
  const wanted = String(asked.set ?? '').trim();
  const proxy = wanted
    ? context.providers.find((one) => one.id === wanted)
    : context.providers[0];
  if (!proxy) {
    refuse(404, 'That provider is not configured on this dev server any more. Reload the page.');
    return;
  }
  if (proxy.models?.length && !proxy.models.includes(model)) {
    refuse(403, `${model} is not one of the models this server allows.`);
    return;
  }

  const base = (proxy.baseURL ?? AI_HOSTS[proxy.provider]).replace(/\/+$/, '');
  const upstream = new URL(aiPathFor(proxy.provider, base, model));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  switch (proxy.provider) {
    case 'anthropic':
      headers['x-api-key'] = proxy.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
    case 'google':
      headers['x-goog-api-key'] = proxy.apiKey;
      break;
    default:
      headers.authorization = `Bearer ${proxy.apiKey}`;
  }

  let answer: Response;
  try {
    answer = await fetch(upstream, {
      method: 'POST',
      headers,
      body: JSON.stringify(aiBodyFor(proxy.provider, model, system, prompt)),
    });
  } catch (error) {
    refuse(502, describeFetchFailure(error, upstream.host));
    return;
  }

  if (!answer.ok || !answer.body) {
    // Passed through as the provider's own words, which is what makes "your key is wrong" and
    // "that model does not exist" distinguishable from each other at the far end.
    const detail = await answer.text().catch(() => '');
    response.statusCode = answer.status;
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    response.end(detail || JSON.stringify({ error: { message: answer.statusText } }));
    return;
  }

  response.statusCode = 200;
  response.setHeader('content-type', 'text/event-stream');
  response.setHeader('cache-control', 'no-store');
  const reader = answer.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      writeChunk(response, decoder.decode(value, { stream: true }));
    }
  } catch {
    // The page closed the tab, or the provider hung up. Either way there is nobody to tell.
  } finally {
    reader.cancel().catch(() => { });
    response.end();
  }
}

/**
 * Why a request from Node failed, in words that name the fix.
 *
 * Node's `fetch` throws `TypeError: fetch failed` for every network-layer problem and puts the
 * actual reason in `error.cause`. Reporting only `error.message` therefore produced
 * "Could not reach api.openai.com: fetch failed" for DNS failures, refused connections, timeouts
 * and certificate problems alike — the same sentence for four unrelated causes, none of which it
 * described. It cost a debugging session, which is what this function is for.
 *
 * The certificate case gets the longest answer because it is the one with a genuinely confusing
 * symptom: the same key and URL work from the editor's "In this page" tier and fail here. That is
 * not a contradiction, it is the difference between the two runtimes. A browser validates against
 * the operating system's trust store, so a corporate TLS proxy or a local interception CA that has
 * been installed there is trusted automatically. Node does not consult the OS store at all — it
 * carries its own list, and the only way to add to it is `NODE_EXTRA_CA_CERTS`, which must name a
 * PEM *file*. Pointed at the directory containing one, Node loads nothing and every HTTPS request
 * it makes fails verification.
 */
function describeFetchFailure(error: unknown, host: string): string {
  const cause = (error as { cause?: { code?: string; message?: string } } | undefined)?.cause;
  const code = cause?.code ?? '';
  const detail = cause?.message || (error instanceof Error ? error.message : String(error));
  const lead = `Could not reach ${host}: ${detail}`;

  const CERTIFICATE = new Set([
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_UNTRUSTED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ]);
  if (CERTIFICATE.has(code)) {
    const extra = process.env.NODE_EXTRA_CA_CERTS;
    const pointsAtAFile = Boolean(extra) && isReadableFile(extra as string);
    return (
      `${lead}. This is a certificate problem on this machine, not a problem with your key — ` +
      'something is intercepting TLS, and the dev server does not trust it. Your browser does, ' +
      'because it uses the operating system trust store and Node does not, which is why the ' +
      'in-page tier works and this does not. Point NODE_EXTRA_CA_CERTS at the PEM file holding ' +
      'your proxy\'s root certificate and restart the dev server' +
      (extra
        ? pointsAtAFile
          ? `. It is currently set to ${extra}, which is readable, so that file may not contain the right certificate.`
          : `. It is currently set to ${extra}, which is not a readable file — it must name the certificate file itself, not the folder containing it.`
        : '. It is not currently set.')
    );
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `${lead}. The name did not resolve, so check the base URL and this machine's DNS.`;
  }
  if (code === 'ECONNREFUSED') {
    return `${lead}. Nothing is listening there — for a local model, check it is running.`;
  }
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    return (
      `${lead}. If this machine reaches the internet through a proxy, note that Node ignores ` +
      'HTTP_PROXY and HTTPS_PROXY unless it is configured to use them, so the dev server may have ' +
      'no route even though your browser does.'
    );
  }
  return code ? `${lead} (${code}).` : `${lead}.`;
}

/** True when a path names a file this process can actually read. */
function isReadableFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The upstream path for one provider, mirroring the client's own `endpointFor`. */
function aiPathFor(provider: DiscoveredProvider['provider'], base: string, model: string): string {
  switch (provider) {
    case 'anthropic':
      return `${base}/v1/messages`;
    case 'google':
      return `${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    default:
      return `${base}/chat/completions`;
  }
}

/** The upstream body for one provider, mirroring the client's own `bodyFor`. */
function aiBodyFor(
  provider: DiscoveredProvider['provider'],
  model: string,
  system: string,
  prompt: string,
): unknown {
  switch (provider) {
    case 'anthropic':
      return {
        model,
        max_tokens: 4096,
        stream: true,
        system,
        messages: [{ role: 'user', content: prompt }],
      };
    case 'google':
      return {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      };
    default:
      return {
        model,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      };
  }
}

/**
 * A chunk on its way to the page.
 *
 * `FsResponse` is the narrow shape this plugin declares rather than Node's own, because three
 * members were all the file route needed. Streaming needs one more, so it is reached through a
 * widened view here rather than by loosening the interface every other handler is checked
 * against.
 */
function writeChunk(response: FsResponse, text: string): void {
  if (!text) return;
  (response as FsResponse & { write?(chunk: string): void }).write?.(text);
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
