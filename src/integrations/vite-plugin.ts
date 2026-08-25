import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { DesignSystemDocument } from '../core/types.js';
import { instrumentHTML, instrumentTemplates } from './instrument.js';

const SOURCE_ATTR = 'data-heo-src';
const VIRTUAL_ID = 'virtual:html-editor-overlay/bootstrap';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
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
    filter,
  } = options;

  let root = process.cwd();

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
