import type { MountOptions } from '../core/types.js';

/**
 * Mounting from a script tag's own attributes.
 *
 * The overlay deliberately never appears unbidden, but requiring a JavaScript
 * block to say so put a build-shaped obstacle in front of the simplest case:
 * dropping the editor onto a page that has no build at all. The attribute is the
 * consent instead. A bare `<script src>` still does nothing; add `data-heo` and
 * the page needs no JavaScript of its own.
 *
 * Everything here is a scalar, because attributes are. Callbacks stay in `mount()`
 * where they belong. Design systems have three ways in, in order of how much they
 * weigh: `data-seed` for one that fits in an attribute, a
 * `<script type="application/heo-seed">` block for one that does not, and
 * `data-design-system` for a URL when the document lives in the project.
 */

/** The subset of `mount()` that this module needs, passed in to avoid a cycle. */
export interface ScriptTagHost {
  mount(options?: MountOptions): {
    engine: {
      notify(message: string, tone?: 'info' | 'success' | 'error'): void;
      track(work: Promise<unknown>): void;
    };
  };
  configure(options: Partial<MountOptions>): void;
  getInstance(): unknown;
}

/** Attribute values meaning "no". Everything else present means "yes". */
const NEGATIVE = new Set(['false', 'off', '0', 'no']);

/**
 * A seed too long for an attribute, in a block of its own.
 *
 * An unknown `type` is markup the browser will not execute, so this is inert to
 * everything but us. It exists because a design system with components runs to
 * several thousand characters, and while an attribute will technically hold that,
 * nobody can read or edit the file afterwards. A block wraps.
 */
const SEED_BLOCK = 'script[type="application/heo-seed"]';

/**
 * The tag that loaded this bundle.
 *
 * `document.currentScript` is the accurate answer, and it works for a tag the page
 * wrote as well as one a bookmarklet injected. It is null inside a module, though,
 * and null once the script has finished evaluating, so a marked tag anywhere in the
 * document is the fallback. That also covers a bundle the page inlined.
 */
function loaderTag(): HTMLElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLElement && current.hasAttribute('data-heo')) return current;
  return document.querySelector<HTMLElement>('script[data-heo]');
}

/** Read `mount()` options off the tag. Absent attributes are left to the defaults. */
export function optionsFromAttributes(tag: HTMLElement): MountOptions {
  const options: MountOptions = {};
  const read = (name: string): string | null => tag.getAttribute(name);

  // `data-heo` doubles as the switch and as the initial mode, so the common
  // "let me start editing straight away" needs no second attribute.
  const mode = (read('data-heo') ?? '').trim().toLowerCase();
  if (mode === 'edit' || mode === 'editing' || mode === 'on') options.startInEditMode = true;

  const theme = read('data-theme');
  if (theme) options.theme = theme.trim().toLowerCase() === 'light' ? 'light' : 'dark';

  const accent = read('data-accent');
  if (accent) options.accent = accent.trim();

  const fileName = read('data-file-name');
  if (fileName) options.fileName = fileName.trim();

  const shortcut = read('data-shortcut');
  if (shortcut) options.toggleShortcut = shortcut.trim();

  const presets = read('data-presets');
  if (presets !== null) options.presets = !NEGATIVE.has(presets.trim().toLowerCase());

  // A whole design system, inline. The attribute wins over the block when both are
  // present: it is on the tag doing the mounting, so it is the more specific answer.
  const seed = read('data-seed') ?? seedFromBlock();
  if (seed) options.seed = seed;

  // A selector rather than an element, since an attribute cannot hold a reference.
  const container = read('data-container');
  if (container) {
    const found = document.querySelector<HTMLElement>(container);
    if (found) options.container = found;
    else console.warn(`[html-editor-overlay] data-container matched nothing: ${container}`);
  }

  return options;
}

/** The seed in a `<script type="application/heo-seed">` block, if the page has one. */
function seedFromBlock(): string | null {
  const block = document.querySelector(SEED_BLOCK);
  const text = block?.textContent?.trim();
  return text ? text : null;
}

/**
 * Mount from the loader tag, if it asked to be mounted.
 *
 * Waits for the document when it is still parsing, so a tag in `<head>` does not
 * mount before there is a `<body>` to mount into. Runs immediately when the
 * document is already parsed, which is the case a bookmarklet lands in.
 */
export function autoMountFromScriptTag(host: ScriptTagHost): void {
  if (typeof document === 'undefined') return;
  const tag = loaderTag();
  if (!tag) return;
  const options = optionsFromAttributes(tag);
  const designSystemUrl = tag.getAttribute('data-design-system');

  const start = (): void => {
    // A page that calls `mount()` itself has already said what it wants, in more
    // detail than attributes can. Leave it alone rather than racing it.
    if (host.getInstance()) return;
    const api = host.mount(options);
    // Registered with the engine so `whenReady()` covers the fetch too, which is
    // what lets a test await the load instead of guessing how long it takes.
    if (designSystemUrl) api.engine.track(loadDesignSystem(host, api, designSystemUrl));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

/**
 * Fetch a design system after mounting rather than before it.
 *
 * Blocking the mount on a network round trip would mean the page sits there
 * looking broken; the editor is useful before its tokens arrive, and the panels
 * re-render when they do.
 */
async function loadDesignSystem(
  host: ScriptTagHost,
  api: ReturnType<ScriptTagHost['mount']>,
  url: string,
): Promise<void> {
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    host.configure({ designSystem: await response.text() });
    api.engine.notify('Design system loaded.', 'success');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[html-editor-overlay] could not load ${url}: ${reason}`);
    api.engine.notify(`Could not load the design system: ${reason}`, 'error');
  }
}
