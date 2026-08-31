import { DRAGGING_ATTR, HOST_TAG, IGNORE_ATTR, VERSION, Z_BASE } from './core/constants.js';
import { normalizeCustomElementTag } from './core/library.js';
import { EditorEngine, type ProjectInfo } from './core/editor.js';
import type { FileHost } from './core/file-host.js';
import type { PlannedWrite, WritePlan, WriteResult } from './core/writeback.js';
import { releaseModals } from './core/modal.js';
import { installProvenance } from './core/provenance.js';
import { installEventShield, shieldOverlayEvents } from './core/shield.js';
import { ManagedStyleSheet } from './core/stylesheet.js';
import { publishLit } from './core/lit-bridge.js';
import { autoMountFromScriptTag } from './integrations/script-tag.js';
import { setEngine } from './ui/context.js';
import './ui/overlay-root.js';

import type {
  ChangeRecord,
  DesignClass,
  DesignSystemDocument,
  DesignToken,
  EditorSnapshotState,
  LibraryBlock,
  MountOptions,
  PanelId,
  SavePayload,
} from './core/types.js';

export type {
  ChangeRecord,
  DesignClass,
  DesignSystemDocument,
  DesignToken,
  EditorSnapshotState,
  LibraryBlock,
  MountOptions,
  PanelId,
  SavePayload,
};
/**
 * The write-back surface.
 *
 * `FileHost` is exported because the two built-in transports — a folder from the
 * picker, a dev-server endpoint — are not the only ones that make sense. A project
 * with its own idea of where files live can implement the interface and hand it to
 * `api.engine.attachProject()`.
 */
export type { FileHost, PlannedWrite, ProjectInfo, WritePlan, WriteResult };
export { VERSION };

/**
 * Coerce a string into a valid custom element name.
 *
 * Exported because anyone assembling blocks in configuration needs the same
 * correction the authoring form applies, rather than discovering the problem when
 * the element fails to register.
 */
export { normalizeCustomElementTag };

/**
 * Also exported in lower case so the IIFE global reads the same as the module.
 *
 * The bundler assigns the whole module namespace to `window.HtmlEditorOverlay`,
 * which would otherwise shadow the object assigned at the bottom of this file and
 * leave `HtmlEditorOverlay.version` undefined.
 */
export const version = VERSION;

/**
 * Page-level styles.
 *
 * The overlay's own UI is fully encapsulated, but two things have to affect the
 * host page: suppressing accidental text selection while clicking around in edit
 * mode, and letting the element being edited behave like a text field. Kept as a
 * single managed sheet so unmount leaves no trace.
 */
const PAGE_CSS = `
/* user-select inherits, so one declaration on body covers the whole page and a
   handful of exceptions bring it back where typing has to work. Doing this with
   a universal :not() chain instead would make every style recalculation during
   edit mode measurably slower. */
html[data-heo-edit] body {
  -webkit-user-select: none;
  user-select: none;
}
html[data-heo-edit] input,
html[data-heo-edit] textarea,
html[data-heo-edit] select,
html[data-heo-edit] [contenteditable],
html[data-heo-edit] [data-heo-editing] {
  -webkit-user-select: text;
  user-select: text;
}
html[data-heo-edit] [data-heo-editing] {
  outline: none;
  cursor: text;
}
html[data-heo-edit] ${HOST_TAG} {
  all: initial;
  position: fixed !important;
  inset: 0 !important;
  pointer-events: none !important;
  /* Declared after the reset above, which would otherwise set it back to auto.
     See the note where this is also applied inline, at mount. */
  z-index: ${Z_BASE} !important;
}

/* The element being reordered. It really sits in the candidate slot — its
   neighbours have already moved aside — so rendering it as a translucent dashed
   shape is what separates "this is where it will land" from "this is done".
   !important because the element's own styles are frequently more specific. */
html[data-heo-edit] [${DRAGGING_ATTR}] {
  opacity: 0.45 !important;
  outline: 1.5px dashed var(--heo-drag-accent, #6366f1) !important;
  outline-offset: 2px !important;
  cursor: grabbing !important;
  /* Its own transitions would fight the reflow animation. */
  transition: none !important;
}
html[data-heo-edit] [${DRAGGING_ATTR}] * {
  pointer-events: none !important;
}
`;

interface Instance {
  engine: EditorEngine;
  host: HTMLElement;
  sheet: ManagedStyleSheet;
  api: OverlayAPI;
  /** Takes the host's event shield back off, so unmounting leaves the page untouched. */
  releaseShield: (() => void) | null;
}

let instance: Instance | null = null;

export interface OverlayAPI {
  readonly version: string;
  unmount(): void;
  getState(): EditorSnapshotState;
  setEditing(editing: boolean): void;
  toggleEditing(): void;
  select(element: HTMLElement | null): void;
  openPanel(panel: PanelId): void;
  closePanel(): void;
  undo(): void;
  redo(): void;
  reset(): void;
  save(): Promise<boolean>;
  /** The prompt that `save()` would hand over, without saving. */
  getPrompt(): string;
  getChanges(): ChangeRecord[];
  exportHTML(): string;

  /**
   * Hand over the folder holding this page, so saving writes its files.
   *
   * Opens the browser's directory picker, so it has to be called from a user gesture.
   * Resolves false when the user cancels, which is not an error.
   *
   * With the Vite plugin this is unnecessary: the dev server offers a write endpoint
   * and the editor connects to it on mount.
   */
  connectProject(): Promise<boolean>;
  disconnectProject(): Promise<void>;
  /** The connected project, or null when saving still produces a prompt. */
  getProject(): ProjectInfo | null;
  /** Which files a save would write, and which changes have nowhere to go. */
  previewWrites(): Promise<WritePlan | null>;
  exportDesignSystem(): DesignSystemDocument;
  /** The whole design system as one copy-pasteable seed string. */
  exportSeed(): Promise<string>;
  /** Accepts a seed, a design system document, or either as text. */
  importDesignSystem(
    document: DesignSystemDocument | string,
    overwrite?: boolean,
  ): Promise<boolean>;
  /**
   * Resolves once a seed or design-system URL given at mount time has landed.
   *
   * Everything else is applied before `mount()` returns; only a compressed seed
   * and a remote document arrive later. Awaiting is always safe.
   */
  whenReady(): Promise<void>;
  configure(options: Partial<MountOptions>): void;
  /** Escape hatch for advanced integrations. Not covered by semver. */
  readonly engine: EditorEngine;
}

/**
 * Mount the editor overlay.
 *
 * Never mounts itself: a visual editor that appears unbidden in production is a
 * liability, so the host page decides. Calling twice returns the existing
 * instance rather than stacking overlays.
 */
export function mount(options: MountOptions = {}): OverlayAPI {
  if (instance) return instance.api;
  if (typeof document === 'undefined') {
    throw new Error('The editor overlay needs a browser document.');
  }

  publishLit();

  const container = options.container ?? document.body ?? document.documentElement;
  const host = document.createElement(HOST_TAG);
  host.setAttribute(IGNORE_ATTR, '');
  host.setAttribute('data-heo-version', VERSION);
  host.setAttribute('aria-label', 'Visual editor');
  // Inline the essentials so the overlay is positioned correctly even before the
  // page stylesheet lands. `z-index` has to be here, on the host: `position: fixed`
  // makes this element a stacking context, which traps every z-index inside it. The
  // chrome asking for 2147482000 was therefore competing with its own siblings while
  // the host itself sat at `auto`, and any page element with a z-index at all — a
  // sticky header at 100 was the report — painted straight over the toolbar.
  // Declared after `all: initial`, which would otherwise reset it back to `auto`.
  host.style.cssText =
    `all:initial;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:${Z_BASE}!important;`;

  const sheet = new ManagedStyleSheet('heo-page-styles', { internal: true });
  sheet.write(PAGE_CSS);

  const engine = new EditorEngine(options);
  setEngine(engine);

  const root = document.createElement('heo-overlay');
  root.setAttribute(IGNORE_ATTR, '');
  host.appendChild(root);
  container.appendChild(host);
  raiseToTopLayer(host);

  engine.start();

  const api: OverlayAPI = {
    version: VERSION,
    engine,
    unmount,
    getState: () => engine.snapshot(),
    setEditing: (editing) => engine.setEditing(editing),
    toggleEditing: () => engine.toggleEditing(),
    select: (element) => engine.select(element),
    openPanel: (panel) => engine.setDockTab(panel),
    closePanel: () => engine.setDock(false),
    undo: () => engine.undo(),
    redo: () => engine.redo(),
    reset: () => engine.resetAll(),
    save: () => engine.save(),
    getPrompt: () => engine.buildSavePrompt(),
    getChanges: () => engine.records,
    exportHTML: () => engine.exportHTML(),
    connectProject: () => engine.connectProjectFolder(),
    disconnectProject: () => engine.disconnectProject(),
    getProject: () => engine.store.value.project,
    previewWrites: () => engine.previewWritePlan(),
    exportDesignSystem: () => engine.designSystem(),
    exportSeed: () => engine.designSystemSeed(),
    importDesignSystem: (document_, overwrite = false) =>
      engine.importDesignSystemText(
        typeof document_ === 'string' ? document_ : JSON.stringify(document_),
        overwrite,
      ),
    whenReady: () => engine.whenReady(),
    configure: (next) => configure(next),
  };

  /*
   * Nothing that happens inside the chrome continues out into the page.
   *
   * Bound here rather than in the engine because it belongs to the host element, which is
   * this function's to own. Bubble phase, so the overlay's own controls have had the event
   * first and only its onward journey to `<body>`, `document` and `window` is cut off.
   */
  const releaseShield =
    options.shieldPageEvents === false ? null : shieldOverlayEvents(host);

  instance = { engine, host, sheet, api, releaseShield };
  return api;
}

/**
 * Lift the host into the top layer, so no page z-index can reach it.
 *
 * A number, however large, is still a number the page can match — 2147483647 is
 * available to everyone, and a stacking context anywhere above the host would cap
 * it long before that. The top layer sidesteps the whole contest: it paints above
 * the document regardless of z-index, stacking contexts, `overflow` clipping or
 * `filter` on an ancestor.
 *
 * `manual` because this is not a dismissable popup: nothing about clicking the page
 * should close the editor, and manual popovers do not light-dismiss or force other
 * popovers shut — which matters because the value fields open popovers of their own
 * inside this one.
 *
 * The z-index remains as the fallback for browsers without the top layer, so the
 * attribute is removed again if anything here refuses; a `popover` that never gets
 * shown is `display: none`, and an invisible editor is worse than a covered one.
 */
function raiseToTopLayer(host: HTMLElement): void {
  if (typeof host.showPopover !== 'function') return;
  try {
    host.setAttribute('popover', 'manual');
    host.showPopover();
  } catch {
    host.removeAttribute('popover');
  }
}

export function unmount(): void {
  if (!instance) return;
  const { engine, host, sheet, releaseShield } = instance;
  instance = null;
  // Order matters. `destroy()` cancels an in-flight drag, which patches the store
  // and can queue one last render; removing the host next disconnects everything
  // before the engine reference is dropped, so that render cannot ask a component
  // for an engine that no longer exists.
  engine.destroy();
  releaseShield?.();
  host.remove();
  setEngine(null);
  sheet.destroy();
  // Any dialog open at unmount never gets its own teardown, so the page would be
  // left locked with nothing on screen to explain why.
  releaseModals();
  document.documentElement.removeAttribute('data-heo-edit');
  document.documentElement.style.removeProperty('--heo-drag-accent');
}

/** Merge new options into a mounted overlay. */
export function configure(next: Partial<MountOptions>): void {
  if (!instance) return;
  const { engine } = instance;
  Object.assign(engine.options, next);

  if (next.tokens) engine.tokens.import(asArray<DesignToken>(next.tokens), { overwrite: true });
  if (next.classes) engine.classes.import(asArray<DesignClass>(next.classes), { overwrite: true });
  if (next.blocks) engine.library.import(asArray<LibraryBlock>(next.blocks), { overwrite: true });
  // Registered with the engine rather than left floating, so `whenReady()` covers a
  // system configured after mounting — which is how the script tag loads a URL.
  if (next.seed) engine.track(engine.importDesignSystemText(next.seed, true));
  if (next.designSystem) {
    engine.track(
      engine.importDesignSystemText(
        typeof next.designSystem === 'string'
          ? next.designSystem
          : JSON.stringify(next.designSystem),
        true,
      ),
    );
  }

  if (next.theme) engine.store.patch({ theme: next.theme === 'light' ? 'light' : 'dark' });
  if (next.accent) engine.store.patch({ accent: next.accent });
}

export function getInstance(): OverlayAPI | null {
  return instance?.api ?? null;
}

function asArray<T>(value: T[] | string): T[] {
  if (typeof value !== 'string') return Array.isArray(value) ? value : [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Global for script-tag usage                                                 */
/* -------------------------------------------------------------------------- */

export interface HtmlEditorOverlayGlobal {
  version: string;
  mount: typeof mount;
  unmount: typeof unmount;
  configure: typeof configure;
  getInstance: typeof getInstance;
  normalizeCustomElementTag: typeof normalizeCustomElementTag;
}

const globalAPI: HtmlEditorOverlayGlobal = {
  version: VERSION,
  mount,
  unmount,
  configure,
  getInstance,
  normalizeCustomElementTag,
};

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).HtmlEditorOverlay = globalAPI;
}

/*
 * Let a script tag mount the overlay on its own.
 *
 * Still not unbidden: this does nothing unless the tag that loaded the bundle
 * carries `data-heo`. What it removes is the JavaScript block, which was the only
 * thing standing between "a page with no build step" and "a page with an editor".
 *
 * Harmless for module consumers — `document.currentScript` is null inside a module,
 * and a bundled app has no marked tag to find.
 */
/*
 * Start watching DOM writes before the page makes them, if there is still time.
 *
 * At module evaluation, which is the earliest moment the overlay has, and deliberately
 * ahead of `autoMountFromScriptTag` — that waits for `DOMContentLoaded`, by which point
 * every classic and deferred script has already run and rendered. Anything missed here
 * is still caught as runtime content once the engine mounts; what is gained by being
 * early is the *location* of the code responsible, which is only knowable while the
 * call that made the write is still on the stack.
 *
 * So load order is a real setup consideration rather than an implementation detail: a
 * plain `<script src>` in `<head>` sees everything the page does, and a bundle loaded
 * at the end of `<body>` sees only what happens after it.
 */
installProvenance();

/*
 * And the gate that keeps the page's listeners out of the editor's interactions.
 *
 * Installed at module evaluation, alongside the provenance patches, for a reason that is
 * the same in kind but stricter: a listener registered before this runs is registered as
 * itself and can never be gated. Being early is what determines how much of the page's
 * wiring is covered at all.
 *
 * Installing the patch is not the same as acting on it. It has no opinion until an engine
 * mounts and hands it one, and none again once that engine is gone — so a page that never
 * mounts the editor is left exactly as it was.
 */
installEventShield();

autoMountFromScriptTag(globalAPI);

export default globalAPI;
