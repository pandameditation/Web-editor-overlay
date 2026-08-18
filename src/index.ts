import { HOST_TAG, IGNORE_ATTR, VERSION } from './core/constants.js';
import { exportHTML as serializePage } from './core/design-system.js';
import { EditorEngine } from './core/editor.js';
import { ManagedStyleSheet } from './core/stylesheet.js';
import { publishLit } from './core/lit-bridge.js';
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
export { VERSION };

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
}
`;

interface Instance {
  engine: EditorEngine;
  host: HTMLElement;
  sheet: ManagedStyleSheet;
  api: OverlayAPI;
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
  exportDesignSystem(): DesignSystemDocument;
  importDesignSystem(document: DesignSystemDocument | string, overwrite?: boolean): void;
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
  // page stylesheet lands.
  host.style.cssText =
    'all:initial;position:fixed!important;inset:0!important;pointer-events:none!important;';

  const sheet = new ManagedStyleSheet('heo-page-styles', { internal: true });
  sheet.write(PAGE_CSS);

  const engine = new EditorEngine(options);
  setEngine(engine);

  const root = document.createElement('heo-overlay');
  root.setAttribute(IGNORE_ATTR, '');
  host.appendChild(root);
  container.appendChild(host);

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
    exportHTML: () => serializePage(),
    exportDesignSystem: () => engine.designSystem(),
    importDesignSystem: (document_, overwrite = false) => {
      engine.importDesignSystemText(
        typeof document_ === 'string' ? document_ : JSON.stringify(document_),
        overwrite,
      );
    },
    configure: (next) => configure(next),
  };

  instance = { engine, host, sheet, api };
  return api;
}

export function unmount(): void {
  if (!instance) return;
  const { engine, host, sheet } = instance;
  instance = null;
  engine.destroy();
  setEngine(null);
  host.remove();
  sheet.destroy();
  document.documentElement.removeAttribute('data-heo-edit');
}

/** Merge new options into a mounted overlay. */
export function configure(next: Partial<MountOptions>): void {
  if (!instance) return;
  const { engine } = instance;
  Object.assign(engine.options, next);

  if (next.tokens) engine.tokens.import(asArray<DesignToken>(next.tokens), { overwrite: true });
  if (next.classes) engine.classes.import(asArray<DesignClass>(next.classes), { overwrite: true });
  if (next.blocks) engine.library.import(asArray<LibraryBlock>(next.blocks), { overwrite: true });
  if (next.designSystem) {
    engine.importDesignSystemText(
      typeof next.designSystem === 'string' ? next.designSystem : JSON.stringify(next.designSystem),
      true,
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
}

const globalAPI: HtmlEditorOverlayGlobal = {
  version: VERSION,
  mount,
  unmount,
  configure,
  getInstance,
};

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).HtmlEditorOverlay = globalAPI;
}

export default globalAPI;
