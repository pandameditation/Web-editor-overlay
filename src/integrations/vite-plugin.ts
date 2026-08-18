import { relative } from 'node:path';
import type { Plugin } from 'vite';
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

  const mountOptions = JSON.stringify({
    startInEditMode: options.startInEditMode ?? false,
    theme: options.theme,
    accent: options.accent,
    toggleShortcut: options.toggleShortcut,
  });

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
        `const api = mount(${mountOptions});`,
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

export { editorOverlay };
export type { Plugin };
