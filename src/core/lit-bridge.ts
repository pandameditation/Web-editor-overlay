import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

/**
 * Lets user-supplied component source run against the Lit the overlay already
 * bundles.
 *
 * A page that loads the overlay from a plain `<script>` tag has no module
 * resolver, so a pasted Lit component's `import { LitElement } from 'lit'`
 * cannot resolve. Rather than asking the user to bundle first, the bundled Lit
 * is published on `globalThis` and bare `lit` specifiers are rewritten to point
 * at a tiny shim module that re-exports it.
 */

const GLOBAL_KEY = '__HEO_LIT__';

interface LitGlobal {
  LitElement: typeof LitElement;
  html: typeof html;
  css: typeof css;
  svg: typeof svg;
  nothing: typeof nothing;
  customElement: typeof customElement;
  property: typeof property;
  state: typeof state;
  classMap: typeof classMap;
  styleMap: typeof styleMap;
  repeat: typeof repeat;
}

function publishLit(): LitGlobal {
  const scope = globalThis as unknown as Record<string, LitGlobal>;
  scope[GLOBAL_KEY] ??= {
    LitElement,
    html,
    css,
    svg,
    nothing,
    customElement,
    property,
    state,
    classMap,
    styleMap,
    repeat,
  };
  return scope[GLOBAL_KEY];
}

const SHIM_SOURCE = `const lit = globalThis.${GLOBAL_KEY};
export const LitElement = lit.LitElement;
export const html = lit.html;
export const css = lit.css;
export const svg = lit.svg;
export const nothing = lit.nothing;
export const customElement = lit.customElement;
export const property = lit.property;
export const state = lit.state;
export const classMap = lit.classMap;
export const styleMap = lit.styleMap;
export const repeat = lit.repeat;
export default lit;
`;

let shimURL: string | null = null;

function litShimURL(): string {
  publishLit();
  shimURL ??= URL.createObjectURL(new Blob([SHIM_SOURCE], { type: 'text/javascript' }));
  return shimURL;
}

/** Point every bare `lit` / `lit/...` specifier at the in-page shim. */
export function rewriteLitImports(source: string): string {
  const url = litShimURL();
  return source.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(['"])(lit(?:\/[\w./-]*)?)\2/g,
    (_match, prefix: string, quote: string) => `${prefix}${quote}${url}${quote}`,
  );
}

/**
 * Dynamic import that survives bundling.
 *
 * A literal `import(url)` gets rewritten by bundlers into their own module
 * loader, which cannot handle a blob URL created at runtime. Building the
 * import through `Function` keeps it a genuine, untouched dynamic import.
 */
const dynamicImport: (url: string) => Promise<unknown> = (() => {
  try {
    return new Function('url', 'return import(url);') as (url: string) => Promise<unknown>;
  } catch {
    return () =>
      Promise.reject(
        new Error(
          'Dynamic import is blocked on this page (likely a Content-Security-Policy). ' +
            'Custom component modules cannot be evaluated.',
        ),
      );
  }
})();

/** Evaluate an ES module from source text. Used to register custom elements. */
export async function evaluateModule(source: string): Promise<void> {
  const rewritten = rewriteLitImports(source);
  const url = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
  try {
    await dynamicImport(url);
  } finally {
    // Revoke on a macrotask so the module graph has finished resolving.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Evaluate a classic script in module scope, for non-Lit custom elements. */
export async function evaluateScript(source: string): Promise<void> {
  await evaluateModule(source);
}

export { publishLit };
