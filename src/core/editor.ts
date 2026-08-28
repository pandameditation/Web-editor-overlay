import {
  ClassRegistry,
  normalizeClassName,
  planClassMerge,
  prettifyClassName,
  suggestClassName,
  type ClassCollision,
  type ClassMergePlan,
} from './classes.js';
import {
  DRAGGING_ATTR,
  DRAG_TIMING,
  EDIT_DISCARDED_EVENT,
  HOST_TAG,
  IGNORE_ATTR,
  INSERTED_ATTR,
  VERSION,
} from './constants.js';
import { inlineDeclarations } from './css.js';
import { planDrag, samePlacement, type DropPlacement } from './drop-target.js';
import { captureRects, neighbourhood, playFlip, settleDrop } from './reflow.js';
import {
  acceptsChildren,
  firstSelectableChild,
  isMutable,
  isNativeInputEvent,
  isSelectable,
  labelFor,
  nearestSourceRef,
  nextInFlow,
  nextSibling,
  previousInFlow,
  previousSibling,
  selectableFromEvent,
  selectableParent,
  selectorFor,
  visualBox,
} from './dom.js';
import {
  copyToClipboard,
  downloadText,
  exportDesignSystem,
  exportHTML,
  importDesignSystem,
} from './design-system.js';
import { containTab } from './focus.js';
import { History, nextChangeId, type Command } from './history.js';
import { handleKeyDown, matchesShortcut } from './keymap.js';
import {
  applyBlockProps,
  BlockLibrary,
  blockFromSource,
  blockPropRows,
  normalizeCustomElementTag,
  type BlockPropRow,
} from './library.js';
import {
  cleanMarkup,
  duplicateElement,
  insertHTML,
  insertNodes,
  moveCommandFromOrigin,
  moveElement,
  removeElement,
  replaceElement,
  retagElement,
  setAttribute,
  setClassList,
  setInnerHTML,
  setStyleProperties,
  setStyleProperty,
  tidyStyleAttribute,
  unwrapElement,
  wrapElement,
  type InsertPosition,
} from './mutations.js';
import { buildPrompt } from './prompt.js';
import { formatHTML } from './sanitize.js';
import {
  connectDirectory,
  connectServer,
  hostAvailability,
  restoreDirectory,
  type FileHost,
  type FileHostKind,
  type HostAvailability,
} from './file-host.js';
import {
  sourceTargetOf,
  sourceWindow,
  writeSourceEdit,
  type SourceTarget,
  type SourceWindow,
} from './js-edit.js';
import { installStyleMirror, releaseStyleMirrors } from './mirror.js';
import { collectScriptSources, fetchScriptSource } from './scripts.js';
import {
  describeProvenance,
  establishBaseline,
  markObservedRevert,
  markUserOwned,
  onScriptWrite,
  observeRuntimeContent,
  provenanceOf,
  resetProvenance,
  watchEditDurability,
  withoutProvenance,
  type Provenance,
} from './provenance.js';
import {
  collectStyleSources,
  describeRule,
  DOCUMENT_TARGET,
  rememberStyleText,
  resetSheetIds,
} from './sheets.js';
import {
  applyWritePlan,
  buildWritePlan,
  inlineStyleEdits,
  type WritePlan,
  type WriteResult,
  type WriteSubject,
} from './writeback.js';
import { decodeSeed, decodeSeedSync, encodeSeed } from './seed.js';
import { Store } from './store.js';
import { TokenRegistry } from './tokens.js';
import type {
  BlockKind,
  ChangeRecord,
  DesignClass,
  DesignSystemDocument,
  DragState,
  EditorSnapshotState,
  LibraryBlock,
  MountOptions,
  PanelId,
  SavePayload,
  PropSpec,
} from './types.js';

export interface ToastMessage {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warn' | 'error';
  /** Optional action rendered as a button on the toast. */
  action?: { label: string; run: () => void };
}

export interface InsertAnchor {
  reference: HTMLElement;
  position: InsertPosition;
}

/**
 * A pending extraction, held in state while the user reviews it.
 *
 * Extraction used to happen silently with a generated name, which produced
 * classes like `.surface-a3f1` holding whatever happened to be on the element.
 * Naming and trimming the declaration set is the part that decides whether the
 * result is reusable, so it happens before anything is committed.
 */
export interface ClassExtraction {
  mode: 'class';
  element: HTMLElement;
  name: string;
  declarations: Record<string, string>;
  /** Which properties to include. Everything starts included. */
  include: Record<string, boolean>;
  /** Remove the absorbed declarations from the element's style attribute. */
  stripInline: boolean;
  /**
   * What to do when `name` already belongs to a class. Ignored when it does not.
   *
   * Naming an existing class is nearly always a request to add to it — "these two
   * declarations belong on `.card` too" — so merging is the default, and the
   * dialog spells out which of the class's values the merge would replace before
   * anything is committed. `replace` is the old, silent behaviour, kept because
   * "this class is now exactly these declarations" is occasionally what is meant.
   */
  collision: ClassCollision;
  error: string;
}

/**
 * A block being authored, wherever it came from.
 *
 * One shape for all three entry points — captured from an element, started empty
 * from the library, or opened to edit an existing block — because they were three
 * different forms for the same job, and the one reached from an element could not
 * express half of what a block can hold. What differs between them is only what this
 * starts out containing.
 */
export interface BlockExtraction {
  mode: 'block';
  /** The element it was captured from, or null when authored from scratch. */
  element: HTMLElement | null;
  /** The block being replaced, or null when this will be a new one. */
  id: string | null;
  name: string;
  kind: BlockKind;
  category: string;
  description: string;
  html: string;
  css: string;
  /** ES module source for a block that registers a custom element. */
  script: string;
  /** Custom element tag that `script` defines. */
  tag: string;
  /**
   * Which pane of the dialog is showing.
   *
   * `props` is only reachable when the markup has `{{placeholders}}`, so a block
   * without any is a single step and never mentions props at all.
   */
  step: 'source' | 'props';
  /** The props step's rows, built on the way into it. */
  props: BlockPropRow[];
  error: string;
}

export type Extraction = ClassExtraction | BlockExtraction;

/** Which language the Code panel is showing. */
export type CodeTab = 'html' | 'css' | 'js';

/** Everything a block draft starts as, before an entry point fills in what it knows. */
function emptyBlockDraft(): BlockExtraction {
  return {
    mode: 'block',
    element: null,
    id: null,
    name: '',
    kind: 'component',
    category: '',
    description: '',
    html: '',
    css: '',
    script: '',
    tag: '',
    step: 'source',
    props: [],
    error: '',
  };
}

export interface EditorState {
  editing: boolean;
  selected: HTMLElement | null;
  hovered: HTMLElement | null;
  textEditing: HTMLElement | null;
  dockOpen: boolean;
  dockTab: PanelId;
  toolbar: { x: number; y: number };
  dockWidth: number;
  /**
   * Set once the dock has been dragged away from its edge.
   *
   * `null` keeps it anchored to the right, stretched between the top and bottom
   * margins, which is the right default. Dragging switches it to an explicit box
   * so it can be parked anywhere, including over a wide layout's empty gutter.
   */
  dockFloat: { x: number; y: number; height: number } | null;
  drag: DragState | null;
  quickMenuOpen: boolean;
  insertAnchor: InsertAnchor | null;
  extraction: Extraction | null;
  /**
   * Which language the Code panel is showing, in the dock and expanded alike.
   *
   * One value for both, so expanding does not land you somewhere else and collapsing
   * brings you back to what you were reading. It lives here rather than in a panel
   * because the fullscreen view has to outlive the panel that opened it.
   */
  codeTab: CodeTab;
  /** Whether the fullscreen code view is open. */
  codeWorkspace: boolean;
  toast: ToastMessage | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  changeCount: number;
  /** Bumped whenever on-screen geometry may have changed. */
  geometry: number;
  /** Bumped whenever tokens, classes or blocks change. */
  registry: number;
  /** Bumped whenever the selected element's own attributes/content change. */
  revision: number;
  theme: 'dark' | 'light';
  accent: string;
  saving: boolean;
  savePreview: string | null;
  /** The connected project, when the editor can reach the page's files. */
  project: ProjectInfo | null;
  /** The files the next save would write, once it has been worked out. */
  writePlan: WritePlan | null;
  /** True while the plan is being built, which needs to read from disk. */
  planning: boolean;
  /**
   * Which step the save dialog should open on.
   *
   * Read once when the dialog mounts, so somewhere else in the UI can send the user
   * straight to the file plan — the CSS and JS panels do, when a file they cannot read
   * is exactly the thing the plan would explain.
   */
  saveView: 'review' | 'files';
  /** The open targeted-source edit, when one is open. */
  sourceEdit: SourceEdit | null;
}

/**
 * A targeted edit to the code that renders a piece of the page.
 *
 * Holds the whole file as well as the window, because the window is only meaningful
 * spliced back into it, and re-reading on commit would mean writing against a file
 * that may have moved on since it was shown.
 */
export interface SourceEdit {
  element: HTMLElement;
  provenance: Provenance;
  target: SourceTarget;
  /** The file as read. `null` while the read is in flight. */
  file: string | null;
  window: SourceWindow | null;
  /** The buffer, which starts as the window's own text. */
  draft: string;
  /** What the element showed, so the dialog can say what it went looking for. */
  text: string;
  error: string;
  /** Set once the edit has been recorded, so the dialog can say it landed. */
  recorded: boolean;
  /** True when the file was found by searching for the text rather than named outright. */
  searched: boolean;
  /** How many files the text was found in, when searching. */
  candidates: number;
}

/** What the UI needs to know about a connected project. */
export interface ProjectInfo {
  kind: FileHostKind;
  label: string;
}

const DEFAULT_TOOLBAR = { x: 24, y: 24 };

/**
 * The editor engine.
 *
 * Everything stateful lives here: what is selected, the undo stack, the design
 * system registries, and the page-level event listeners. The Lit components are
 * a pure projection of `store.value` plus calls back into these methods, which
 * keeps the UI replaceable and the behaviour testable without a DOM harness for
 * every panel.
 */
export class EditorEngine {
  readonly store: Store<EditorState>;
  readonly history = new History();
  readonly tokens = new TokenRegistry();
  readonly classes = new ClassRegistry();
  readonly library: BlockLibrary;
  readonly options: MountOptions;

  #listeners: Array<() => void> = [];
  #observers: Array<MutationObserver | ResizeObserver | IntersectionObserver> = [];
  #geometryFrame = 0;
  /** The reflow glide currently on screen, and the loop tracking it. */
  #glides = new Set<Animation>();
  #glideFrame = 0;
  #toastTimer = 0;
  #toastId = 0;
  #textEditSnapshot: string | null = null;
  #injectedElements = new Set<string>();
  #destroyed = false;
  /** Deferred seed and design-system loads, so `whenReady` has something to await. */
  #pending = new Set<Promise<unknown>>();

  /**
   * Which library block produced an element, and with what prop values.
   *
   * Keyed on the node rather than written into an attribute, so nothing leaks into
   * the exported HTML and the record survives moves, undo and redo — all of which
   * re-insert the very same node. A WeakMap also means a deleted element's entry
   * disappears with it.
   */
  #instances = new WeakMap<HTMLElement, { blockId: string; values: Record<string, string> }>();

  /**
   * The inline value a live preview is painting over.
   *
   * At most one at a time: a preview belongs to the field the user is currently in,
   * and moving to another field commits or abandons the last one.
   */
  #preview: { el: HTMLElement; property: string; before: string; priority: string } | null = null;
  /** Declarations a class had before its live preview started. */
  #classPreview: { name: string; declarations: Record<string, string> } | null = null;
  /** The rule declaration a live preview is painting over. */
  #rulePreview:
    | { rule: CSSStyleRule; property: string; before: string; priority: string }
    | null = null;

  /* Reorder bookkeeping. Timing, not UI state, so it stays out of the store. */
  #dragPending: { placement: DropPlacement; since: number } | null = null;
  #dragTimer: ReturnType<typeof setTimeout> | null = null;
  #dragSettledAt = 0;
  #dragSettledAtPointer = { x: 0, y: 0 };
  /** When the pointer left the current parent's frame, for the leave gesture. */
  #dragLeftHomeAt: number | null = null;
  /** The container the pointer is resting inside, for the nest gesture. */
  #dragDwell: { host: HTMLElement; since: number } | null = null;

  constructor(options: MountOptions = {}) {
    this.options = options;
    this.library = new BlockLibrary({ presets: options.presets !== false });
    this.store = new Store<EditorState>({
      editing: Boolean(options.startInEditMode),
      selected: null,
      hovered: null,
      textEditing: null,
      dockOpen: false,
      dockTab: 'styles',
      toolbar: { ...DEFAULT_TOOLBAR },
      dockWidth: 340,
      dockFloat: null,
      drag: null,
      quickMenuOpen: false,
      insertAnchor: null,
      extraction: null,
      codeTab: 'html',
      codeWorkspace: false,
      toast: null,
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      changeCount: 0,
      geometry: 0,
      registry: 0,
      revision: 0,
      theme: options.theme === 'light' ? 'light' : 'dark',
      accent: options.accent ?? '#6366f1',
      saving: false,
      savePreview: null,
      project: null,
      writePlan: null,
      planning: false,
      saveView: 'review',
      sourceEdit: null,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                              */
  /* ---------------------------------------------------------------------- */

  start(): void {
    this.tokens.scanDocument();
    this.classes.scanDocument();
    this.#seedFromOptions();

    this.#listeners.push(
      this.history.onChange(() => {
        this.store.patch({
          canUndo: this.history.canUndo,
          canRedo: this.history.canRedo,
          undoLabel: this.history.undoLabel,
          changeCount: this.history.netSize,
        });
        this.options.onChange?.(this.history.records);
      }),
      this.tokens.onChange(() => this.#bumpRegistry()),
      this.classes.onChange(() => this.#bumpRegistry()),
      this.library.onChange(() => this.#bumpRegistry()),
    );

    this.#bindPageEvents();
    this.#observePage();
    /*
     * The floor under the two better provenance signals.
     *
     * Whatever the wrappers missed by being installed late, and whatever leaves no
     * usable stack, is still knowable from the fact that it appeared after the page
     * parsed. Registered here rather than at module load because it costs an observer
     * and only matters once there is an editor to refuse an edit.
     */
    if (this.options.detectScriptContent !== false) {
      this.#listeners.push(observeRuntimeContent());
      this.#listeners.push(
        onScriptWrite((url) => {
          this.#writingScripts.add(url);
        }),
      );
      // Tracked, because it is a fetch and because a test — or a user — asking "is this
      // text mine to edit" before it lands would get the wrong answer.
      this.track(this.establishContentBaseline());
    }

    /*
     * Look for a project without asking for one.
     *
     * A dev server that offered a write endpoint has already given consent on the
     * project's behalf — it only exists because someone added the plugin — so
     * connecting to it is not a decision to put to the user. A folder granted earlier
     * in this browser is the same grant, still live. Neither prompts, and both are
     * tracked so `whenReady()` covers them.
     *
     * The picker is the one thing that never happens on its own: it needs a gesture,
     * and a permission dialog nobody asked for is exactly the behaviour this project
     * has avoided everywhere else.
     */
    this.track(
      this.connectProjectServer().then(async (connected) => {
        if (!connected) await this.restoreProjectFolder();
      }),
    );
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.endTextEdit(true);
    // Unmounting mid-gesture has to put the page back: an abandoned drag would
    // otherwise leave the element translucent and, worse, permanently unclickable
    // through its inline `pointer-events: none`, on a page the editor no longer
    // owns. Cancelling also drops the pending dwell timer, which would fire
    // against a torn-down engine.
    this.cancelDrag();
    this.#clearDragTimer();
    for (const off of this.#listeners) off();
    this.#listeners = [];
    for (const observer of this.#observers) observer.disconnect();
    this.#observers = [];
    if (this.#geometryFrame) cancelAnimationFrame(this.#geometryFrame);
    if (this.#glideFrame) cancelAnimationFrame(this.#glideFrame);
    this.#glideFrame = 0;
    this.#glides.clear();
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.tokens.destroy();
    this.classes.destroy();
    this.library.destroy();
    // Every `<link>` the editor stood in for goes back to loading its own file. A page
    // the editor has left must not be rendering from a `<style>` the editor put there.
    releaseStyleMirrors();
    resetProvenance();
    // The sheet id table holds stylesheets strongly so a change record can name one.
    // Nothing should outlive the editor that handed the names out.
    resetSheetIds();
    this.#project = null;
  }

  #seedFromOptions(): void {
    const { options } = this;
    try {
      if (options.seed) this.#applySeed(options.seed);
      if (options.designSystem) {
        importDesignSystem(options.designSystem, this, { overwrite: true });
      }
      if (options.tokens) {
        this.tokens.import(parseArray(options.tokens), { overwrite: true });
      }
      if (options.classes) {
        this.classes.import(parseArray(options.classes), { overwrite: true });
      }
      if (options.blocks) {
        this.library.import(parseArray(options.blocks), { overwrite: true });
      }
    } catch (error) {
      console.error('[html-editor-overlay] failed to load the supplied design system', error);
      this.notify('Could not load the supplied design system.', 'error');
    }
  }

  /**
   * Apply a seed, synchronously when the format allows it.
   *
   * A plain seed and a JSON document both land before the first paint, which is
   * what a page seeded at mount time should look like. A compressed one cannot —
   * the platform's inflate is stream-shaped, so it arrives on the next tick. That
   * is registered as pending work rather than left to chance, so `whenReady()`
   * has something to wait for and a test does not have to guess a delay.
   */
  #applySeed(seed: string): void {
    const immediate = decodeSeedSync(seed);
    if (immediate) {
      importDesignSystem(immediate, this, { overwrite: true });
      return;
    }
    this.track(
      decodeSeed(seed).then((doc) => {
        if (this.#destroyed) return;
        importDesignSystem(doc, this, { overwrite: true });
        this.#bumpRevision();
      }),
    );
  }

  /**
   * Register work `whenReady()` should wait for.
   *
   * Seeds and design-system URLs both resolve after mounting, and until now there
   * was no way to know when — the script-tag test waits out a fixed 400ms for
   * exactly this reason. Failures are reported here rather than left to whoever
   * happens to await, so a page that never calls `whenReady()` still sees the
   * toast.
   */
  track(work: Promise<unknown>): void {
    const settled = work.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[html-editor-overlay] failed to load the supplied design system', error);
      if (!this.#destroyed) this.notify(`Could not load the design system: ${message}`, 'error');
    });
    this.#pending.add(settled);
    void settled.then(() => this.#pending.delete(settled));
  }

  /**
   * Resolves once every deferred seed and design-system load has been applied.
   *
   * Only compressed seeds and remote documents need this; everything else is in
   * place by the time `mount()` returns. Loops rather than awaiting once, because
   * one load can start another — a URL fetched after mounting, say. Awaiting is
   * always safe.
   */
  async whenReady(): Promise<void> {
    while (this.#pending.size) await Promise.all([...this.#pending]);
  }

  /* ---------------------------------------------------------------------- */
  /* Mode                                                                   */
  /* ---------------------------------------------------------------------- */

  get editing(): boolean {
    return this.store.value.editing;
  }

  setEditing(editing: boolean): void {
    if (this.store.value.editing === editing) return;
    if (!editing) {
      this.endTextEdit(true);
      this.cancelDrag();
    }
    this.store.patch({
      editing,
      hovered: null,
      selected: editing ? this.store.value.selected : null,
      quickMenuOpen: false,
      insertAnchor: null,
      dockOpen: editing ? this.store.value.dockOpen : false,
    });
  }

  toggleEditing(): void {
    this.setEditing(!this.store.value.editing);
  }

  setDock(open: boolean, tab?: PanelId): void {
    this.store.patch({ dockOpen: open, ...(tab ? { dockTab: tab } : {}) });
  }

  setDockTab(tab: PanelId): void {
    this.store.patch({ dockTab: tab, dockOpen: true });
  }

  setDockWidth(width: number): void {
    this.store.patch({ dockWidth: Math.max(300, Math.min(560, Math.round(width))) });
  }

  /** Park the dock at an explicit position. Clamped so it stays reachable. */
  setDockFloat(x: number, y: number, height: number): void {
    const width = this.store.value.dockWidth;
    this.store.patch({
      dockFloat: {
        x: Math.min(Math.max(8, Math.round(x)), Math.max(8, innerWidth - width - 8)),
        y: Math.min(Math.max(8, Math.round(y)), Math.max(8, innerHeight - 80)),
        height: Math.max(240, Math.min(Math.round(height), innerHeight - 16)),
      },
    });
  }

  /** Send the dock back to the right edge. */
  resetDockPosition(): void {
    this.store.patch({ dockFloat: null });
  }

  setToolbarPosition(x: number, y: number): void {
    this.store.patch({ toolbar: { x, y } });
  }

  /* ---------------------------------------------------------------------- */
  /* Selection                                                              */
  /* ---------------------------------------------------------------------- */

  get selected(): HTMLElement | null {
    return this.store.value.selected;
  }

  select(el: HTMLElement | null, options: { reveal?: boolean } = {}): void {
    const current = this.store.value.selected;
    if (current === el) return;
    // Whatever was being previewed belonged to the old selection's panel, and its
    // fields are about to be replaced; nothing would ever put the page back.
    this.cancelPreview();
    if (this.store.value.textEditing && this.store.value.textEditing !== el) {
      this.endTextEdit(true);
    }
    if (el && !isSelectable(el)) return;
    this.store.patch({
      selected: el,
      quickMenuOpen: false,
      insertAnchor: null,
      revision: this.store.value.revision + 1,
    });
    if (el && options.reveal !== false) this.#revealIfNeeded(el);
    this.#observeSelected(el);
  }

  hover(el: HTMLElement | null): void {
    if (this.store.value.drag) return;
    this.store.patch({ hovered: el });
  }

  /** Move the selection along the tree. Used by keyboard nav and the tree panel. */
  navigate(direction: 'parent' | 'child' | 'previous' | 'next' | 'up' | 'down'): void {
    const el = this.store.value.selected;
    if (!el) {
      const first = firstSelectableChild(document.body);
      if (first) this.select(first);
      return;
    }
    const target = (() => {
      switch (direction) {
        case 'parent':
          return selectableParent(el);
        case 'child':
          return firstSelectableChild(el);
        case 'previous':
          return previousSibling(el);
        case 'next':
          return nextSibling(el);
        case 'up':
          return previousInFlow(el);
        case 'down':
          return nextInFlow(el);
        default:
          return null;
      }
    })();
    if (target) this.select(target);
  }

  #revealIfNeeded(el: HTMLElement): void {
    const box = visualBox(el);
    const margin = 80;
    const offTop = box.top < margin;
    const offBottom = box.top + box.height > innerHeight - margin;
    if (offTop || offBottom) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Style, class and attribute edits                                       */
  /* ---------------------------------------------------------------------- */

  setStyle(property: string, value: string, el = this.store.value.selected): void {
    if (!el) return;
    this.#endPreview();
    this.#captureBaseline(el, property);
    this.history.commit(setStyleProperty(el, property, value));
    this.#bumpRevision();
  }

  /**
   * Show a value on the page without committing it.
   *
   * Editing a colour or a length is a search, not a decision: the whole point is
   * seeing the page respond while dragging in a picker or typing a number. Only the
   * committed value belongs on the undo stack, though, so this writes the DOM
   * directly and remembers what it painted over.
   *
   * Deliberately does not touch history, the change set, or the revision counter —
   * a re-render mid-keystroke would fight the field the user is typing in.
   */
  previewStyle(property: string, value: string, el = this.store.value.selected): void {
    if (!el) return;
    if (
      this.#preview &&
      (this.#preview.el !== el || this.#preview.property !== property)
    ) {
      this.#endPreview();
    }
    this.#preview ??= {
      el,
      property,
      before: el.style.getPropertyValue(property),
      priority: el.style.getPropertyPriority(property),
    };
    const next = value.trim();
    if (next) el.style.setProperty(property, next);
    else el.style.removeProperty(property);
  }

  /**
   * The inline value of a property, with any in-flight preview looked through.
   *
   * A preview is paint, not state: it exists so the page can answer "what would this
   * look like" while the user is still typing. Reading it back as though it were
   * declared makes the editor lose track of what the user actually has, and three
   * things break at once — a field can no longer tell that it holds an uncommitted
   * edit, committing looks like a no-op because the value "already" matches, and a
   * re-render mid-keystroke adopts the half-typed text as the new baseline.
   *
   * So every read of a declared value goes through here.
   */
  inlineStyle(property: string, el = this.store.value.selected): string {
    if (!el) return '';
    const preview = this.#preview;
    if (preview && preview.el === el && preview.property === property) return preview.before;
    return el.style.getPropertyValue(property);
  }

  /**
   * What an in-flight preview is painting over, for readers that build their own view
   * of the cascade and need to subtract the paint from it.
   */
  get previewTarget(): {
    el: HTMLElement;
    property: string;
    before: string;
    priority: string;
  } | null {
    const preview = this.#preview;
    return preview
      ? {
        el: preview.el,
        property: preview.property,
        before: preview.before,
        priority: preview.priority,
      }
      : null;
  }

  /**
   * The rule declaration an in-flight preview is painting over.
   *
   * The counterpart of `previewTarget` for a stylesheet rule, and needed for the same
   * reason: a preview writes straight into the live `CSSStyleRule`, so any panel that
   * reads its declarations back is reading the exploration rather than the state. A
   * row told that its own half-typed text is already committed cannot tell it holds an
   * uncommitted edit, and the commit that follows compares equal and does nothing —
   * after which looking away reverts the preview and the edit is simply lost.
   */
  get rulePreviewTarget(): {
    rule: CSSStyleRule;
    property: string;
    before: string;
    priority: string;
  } | null {
    const preview = this.#rulePreview;
    return preview
      ? {
        rule: preview.rule,
        property: preview.property,
        before: preview.before,
        priority: preview.priority,
      }
      : null;
  }

  /**
   * The declarations a class had before its live preview started.
   *
   * Same contract as `previewTarget`, for the third place a value can be previewed.
   * A class preview is written into the registry the editor reads from, so the whole
   * pre-preview map is handed back rather than one property: that is the shape the
   * declaration editor needs, and it keeps the substitution a single assignment.
   */
  get classPreviewTarget(): { name: string; declarations: Record<string, string> } | null {
    const preview = this.#classPreview;
    return preview ? { name: preview.name, declarations: { ...preview.declarations } } : null;
  }

  /**
   * Put back whatever the preview painted over.
   *
   * Called before every commit so the command records the value the property had
   * *before* the user started exploring, not the last frame of the exploration.
   */
  #endPreview(): void {
    const preview = this.#preview;
    this.#preview = null;
    if (!preview) return;
    if (preview.before) {
      preview.el.style.setProperty(preview.property, preview.before, preview.priority);
    } else {
      preview.el.style.removeProperty(preview.property);
    }
    tidyStyleAttribute(preview.el);
  }

  /**
   * Abandon every in-flight preview.
   *
   * Called when a field is left without committing and when the selection changes,
   * so an exploration that went nowhere leaves no trace — not even an inline
   * property that did not exist before it started.
   */
  /**
   * Let go of a selection the history just removed from the page.
   *
   * A command that swaps one node for another leaves the selection pointing at the
   * node that is now detached, and every panel then renders against something the
   * user cannot see. Clearing it is the honest outcome; callers that know what took
   * its place re-select deliberately.
   */
  #dropDetachedSelection(): void {
    const selected = this.store.value.selected;
    if (selected && !selected.isConnected) this.store.patch({ selected: null });
  }

  cancelPreview(): void {
    this.#endPreview();
    this.#endRulePreview();
    const classPreview = this.#classPreview;
    this.#classPreview = null;
    if (classPreview) {
      const entry = this.classes.get(classPreview.name);
      if (entry) this.classes.upsert({ ...entry, declarations: classPreview.declarations });
    }
  }

  /**
   * Live preview for a class declaration.
   *
   * Writes straight into the managed sheet rather than through the history-backed
   * setter, so a colour being dragged updates every element wearing the class. The
   * registry holds the authoritative value, so the next commit or a re-scan puts
   * things right; there is nothing to unwind.
   */
  previewClassDeclaration(name: string, property: string, value: string): void {
    const entry = this.classes.get(name);
    if (!entry) return;
    this.#classPreview ??= { name, declarations: { ...entry.declarations } };
    this.classes.setDeclaration(name, property, value);
  }

  setStyles(declarations: Record<string, string>, label?: string, el = this.store.value.selected): void {
    if (!el) return;
    for (const property of Object.keys(declarations)) this.#captureBaseline(el, property);
    this.history.commit(setStyleProperties(el, declarations, label));
    this.#bumpRevision();
  }

  /* ---------------------------------------------------------------------- */
  /* Per-property baselines                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * The value a property had before this session touched it.
   *
   * Recorded lazily, on the first write to each property, which is the only
   * moment at which the pre-session value is still knowable. `null` means the
   * property was not set at all; `undefined` means it has never been modified,
   * so there is nothing to reset to.
   */
  #styleBaseline = new WeakMap<HTMLElement, Map<string, string | null>>();

  #captureBaseline(el: HTMLElement, property: string): void {
    let map = this.#styleBaseline.get(el);
    if (!map) {
      map = new Map();
      this.#styleBaseline.set(el, map);
    }
    if (!map.has(property)) {
      map.set(property, el.style.getPropertyValue(property) || null);
    }
  }

  /** `undefined` when the property was never modified in this session. */
  styleBaseline(el: HTMLElement, property: string): string | null | undefined {
    return this.#styleBaseline.get(el)?.get(property);
  }

  /** True when the property has been modified and differs from its baseline. */
  canResetStyle(el: HTMLElement, property: string): boolean {
    const baseline = this.styleBaseline(el, property);
    if (baseline === undefined) return false;
    // Through the preview, so a value being typed does not flicker the reset affordance.
    return (this.inlineStyle(property, el) || '') !== (baseline ?? '');
  }

  /**
   * Put a property back to its pre-session value.
   *
   * Committed as a normal edit rather than an undo, so it is itself undoable —
   * and because the change set is reduced to net differences, resetting a
   * property removes it from the count entirely.
   */
  resetStyle(property: string, el = this.store.value.selected): void {
    if (!el) return;
    const baseline = this.styleBaseline(el, property);
    if (baseline === undefined) return;
    this.history.commit(setStyleProperty(el, property, baseline ?? ''));
    this.#bumpRevision();
  }

  setClasses(classes: string[], el = this.store.value.selected): void {
    if (!el) return;
    this.history.commit(setClassList(el, classes));
    this.#bumpRevision();
  }

  toggleClass(name: string, el = this.store.value.selected): void {
    if (!el) return;
    const normalized = normalizeClassName(name);
    if (!normalized) return;
    const current = Array.from(el.classList);
    const next = current.includes(normalized)
      ? current.filter((item) => item !== normalized)
      : [...current, normalized];
    this.setClasses(next, el);
  }

  setAttribute(name: string, value: string | null, el = this.store.value.selected): void {
    if (!el) return;
    this.history.commit(setAttribute(el, name, value));
    this.#bumpRevision();
  }

  /**
   * Change one declaration on a reusable class. An empty value removes it.
   *
   * Lives on the engine rather than in a panel because the class editor is reached
   * from two places now — the design system panel and the class chips in Styles —
   * and an undoable mutation should not exist twice.
   */
  setClassDeclaration(name: string, property: string, value: string): void {
    const live = this.classes.get(name);
    if (!live) return;
    // A live preview has already written into the registry, so the pre-edit state
    // has to come from the snapshot taken when the preview began — otherwise undo
    // would return to the last frame of the exploration rather than to the start.
    const preview = this.#classPreview?.name === name ? this.#classPreview : null;
    this.#classPreview = null;
    const before: DesignClass = preview ? { ...live, declarations: preview.declarations } : live;
    const snapshot: DesignClass = { ...before, declarations: { ...before.declarations } };
    this.history.commit({
      label: `Set ${property} on .${name}`,
      mergeKey: `class:${name}:${property}`,
      subject: `class-decl:${name}:${property}`,
      record: {
        id: nextChangeId(),
        kind: 'token-class',
        summary: `Set ${property} to ${value || '(removed)'} on .${name}`,
        target: `.${name}`,
        before: snapshot.declarations[property],
        after: value || undefined,
        detail: { class: name, property, value },
        at: Date.now(),
      },
      apply: () => {
        this.classes.setDeclaration(name, property, value);
      },
      revert: () => this.classes.upsert(snapshot),
    });
    this.#bumpRevision();
  }

  /** Drop a declaration from a class, name and all. */
  removeClassDeclaration(name: string, property: string): void {
    const entry = this.classes.get(name);
    if (!entry) return;
    this.#classPreview = null;
    const snapshot: DesignClass = { ...entry, declarations: { ...entry.declarations } };
    this.history.commit({
      label: `Remove ${property} from .${name}`,
      subject: `class-decl:${name}:${property}`,
      record: {
        id: nextChangeId(),
        kind: 'token-class',
        summary: `Remove ${property} from .${name}`,
        target: `.${name}`,
        before: snapshot.declarations[property],
        detail: { class: name, property },
        at: Date.now(),
      },
      apply: () => {
        this.classes.removeDeclaration(name, property);
      },
      revert: () => this.classes.upsert(snapshot),
    });
    this.#bumpRevision();
  }

  /** Delete a reusable class, keeping it on the undo stack. */
  removeClass(name: string): void {
    const entry = this.classes.get(name);
    if (!entry) return;
    const snapshot: DesignClass = { ...entry, declarations: { ...entry.declarations } };
    this.history.commit({
      label: `Delete .${name}`,
      record: {
        id: nextChangeId(),
        kind: 'token-class',
        summary: `Remove class .${name}`,
        target: `.${name}`,
        at: Date.now(),
      },
      apply: () => {
        this.classes.remove(name);
      },
      revert: () => this.classes.upsert(snapshot),
    });
    this.#bumpRevision();
  }

  /**
   * Edit a declaration on a live CSS rule.
   *
   * Distinct from `setStyle`, which writes an inline override on one element.
   * Editing the rule changes every element it matches, which is what the user
   * means when they adjust a value shown under a class selector — and it keeps
   * the change expressible as a stylesheet edit rather than a pile of inline
   * styles for the agent to clean up.
   */
  /**
   * Live preview for a stylesheet rule, without touching history.
   *
   * The counterpart of `previewStyle` for the cascade inspector: dragging a colour
   * on a `.card` rule should recolour every card as it moves.
   */
  previewRuleDeclaration(rule: CSSStyleRule, property: string, value: string): void {
    if (this.#rulePreview && this.#rulePreview.rule !== rule) this.#endRulePreview();
    this.#rulePreview ??= {
      rule,
      property,
      before: rule.style.getPropertyValue(property),
      priority: rule.style.getPropertyPriority(property),
    };
    const next = value.trim();
    if (next) rule.style.setProperty(property, next);
    else rule.style.removeProperty(property);
  }

  #endRulePreview(): void {
    const preview = this.#rulePreview;
    this.#rulePreview = null;
    if (!preview) return;
    if (preview.before) {
      preview.rule.style.setProperty(preview.property, preview.before, preview.priority);
    } else {
      preview.rule.style.removeProperty(preview.property);
    }
  }

  setRuleDeclaration(rule: CSSStyleRule, property: string, value: string): void {
    // Put the previewed value back first, so the command records the rule as it was
    // before the user started exploring.
    this.#endRulePreview();
    const before = rule.style.getPropertyValue(property);
    const beforePriority = rule.style.getPropertyPriority(property);
    const after = value.trim();
    const selector = rule.selectorText;
    const target = this.store.value.selected;

    /*
     * Where this rule lives, recorded now rather than worked out later.
     *
     * A CSSOM edit is invisible from outside the CSSOM: mutating `rule.style` changes
     * what renders but leaves the `<style>` element's text and the linked file
     * untouched, so this edit exists nowhere except in the change record. The
     * location is what lets it be replayed against the file's own text — and it has
     * to be captured while the rule is still where it was, because a later edit to
     * the same sheet can renumber everything after it.
     */
    const at = describeRule(rule);

    this.history.commit({
      label: `Set ${property} on ${selector}`,
      mergeKey: `rule:${selector}:${property}`,
      subject: `rule:${selector}:${property}`,
      record: {
        id: nextChangeId(),
        kind: 'style',
        summary: `Set ${property} to ${after || '(removed)'} in the ${selector} rule`,
        target: selector,
        group: `rule:${selector}`,
        before: before || undefined,
        after: after || undefined,
        detail: {
          property,
          value: after,
          selector,
          scope: 'stylesheet rule',
          priority: beforePriority,
          ...(at
            ? {
              file: at.label,
              writeTo: at.writeTo,
              sheet: at.sheetId,
              rulePath: at.path.join('.'),
              ruleContext: JSON.stringify(at.context),
            }
            : {}),
        },
        at: Date.now(),
      },
      apply: () => {
        if (after) rule.style.setProperty(property, after);
        else rule.style.removeProperty(property);
      },
      revert: () => {
        if (before) rule.style.setProperty(property, before, beforePriority);
        else rule.style.removeProperty(property);
      },
    });
    if (target) this.#bumpRevision();
  }

  /* ---------------------------------------------------------------------- */
  /* Extraction                                                             */
  /* ---------------------------------------------------------------------- */

  /** Open the extract-to-class dialog for the selected element. */
  beginClassExtraction(el = this.store.value.selected): void {
    if (!el) return;
    const inline = inlineDeclarations(el);
    const declarations = Object.keys(inline).length ? inline : this.tokens.tokenDeclarationsOf(el);
    if (!Object.keys(declarations).length) {
      this.notify('There are no declarations on this element to turn into a class.', 'error');
      return;
    }
    this.store.patch({
      extraction: {
        mode: 'class',
        element: el,
        name: suggestClassName(declarations),
        declarations,
        include: Object.fromEntries(Object.keys(declarations).map((key) => [key, true])),
        // Only meaningful when the values came from the style attribute; token
        // declarations inherited from a rule are not ours to remove.
        stripInline: Object.keys(inline).length > 0,
        collision: 'merge',
        error: '',
      },
    });
  }

  /** Open the block dialog on an element, pre-filled from what is on the page. */
  beginBlockExtraction(el = this.store.value.selected): void {
    if (!el) return;
    this.store.patch({
      extraction: {
        ...emptyBlockDraft(),
        element: el,
        name: suggestBlockName(el),
        kind: el.children.length > 0 ? 'container' : 'component',
        category: 'Extracted',
        description: `Captured from ${labelFor(el)}.`,
        html: formatHTML(cleanMarkup(el)),
        // Ship the classes the element relies on, so the block still looks right
        // in a project that does not have them yet.
        css: this.#cssForSubtree(el),
      },
    });
  }

  /**
   * Open the block dialog empty, for a block written rather than captured.
   *
   * `seed` is whatever the user was searching for when they gave up and decided to
   * build it, which is the best available guess at the name.
   */
  beginBlockDraft(seed = '', kind: BlockKind = 'component'): void {
    this.store.patch({
      extraction: { ...emptyBlockDraft(), name: seed.trim(), kind },
    });
  }

  /** Open the block dialog on a block already in the library. */
  beginBlockEdit(id: string): void {
    const block = this.library.get(id);
    if (!block) return;
    this.store.patch({
      extraction: {
        ...emptyBlockDraft(),
        id: block.id,
        name: block.name,
        kind: block.kind,
        category: block.category ?? '',
        description: block.description ?? '',
        html: block.html,
        css: block.css ?? '',
        script: block.element?.module ?? block.element?.script ?? '',
        tag: block.element?.tag ?? '',
      },
    });
  }

  updateExtraction(patch: Partial<ClassExtraction> & Partial<BlockExtraction>): void {
    const current = this.store.value.extraction;
    if (!current) return;
    this.store.patch({ extraction: { ...current, ...patch, error: '' } as Extraction });
  }

  cancelExtraction(): void {
    this.store.patch({ extraction: null });
  }

  /** Apply the pending extraction. Returns false and sets an error if invalid. */
  commitExtraction(): boolean {
    const pending = this.store.value.extraction;
    if (!pending) return false;

    if (pending.mode === 'class') {
      const name = normalizeClassName(pending.name);
      if (!name) {
        this.updateExtraction({ error: 'A class name must start with a letter and contain only letters, numbers, hyphens or underscores.' });
        return false;
      }
      const declarations = Object.fromEntries(
        Object.entries(pending.declarations).filter(
          ([property, value]) => pending.include[property] !== false && value.trim() !== '',
        ),
      );
      if (!Object.keys(declarations).length) {
        this.updateExtraction({ error: 'Keep at least one declaration.' });
        return false;
      }
      this.#commitClass(
        pending.element,
        name,
        declarations,
        pending.stripInline,
        pending.collision,
      );
      this.store.patch({ extraction: null });
      return true;
    }

    const name = pending.name.trim();
    const tag = normalizeCustomElementTag(pending.tag);
    const hasScript = Boolean(pending.script.trim());

    if (!name) {
      this.updateExtraction({ error: 'Give the block a name.' });
      return false;
    }
    if (hasScript && !tag) {
      this.updateExtraction({
        error:
          'A component with a module needs a custom element tag: lowercase letters, numbers and at least one hyphen.',
      });
      return false;
    }
    if (tag && !hasScript) {
      this.updateExtraction({
        error: `Add the module that defines <${tag}>, or clear the tag to save plain markup.`,
      });
      return false;
    }
    if (hasScript && !pending.script.includes('customElements.define')) {
      this.updateExtraction({
        error: `The module must call customElements.define('${tag}', …) for the tag to exist.`,
      });
      return false;
    }
    if (!hasScript && !pending.html.trim()) {
      this.updateExtraction({ error: 'The block has no markup.' });
      return false;
    }

    // The markup is settled, so if it declares props there is one thing left that only
    // the author knows: what each one is for. Asking here rather than on the way in
    // means the question arrives once the answer is knowable, and never at all for a
    // block without placeholders.
    if (pending.step === 'source') {
      const rows = blockPropRows(pending.html, this.#existingProps(pending.id));
      if (rows.length) {
        this.store.patch({
          extraction: { ...pending, step: 'props', props: rows, error: '' },
        });
        return false;
      }
    }

    const applied = applyBlockProps(pending.html, pending.props);
    if (applied.error) {
      this.updateExtraction({ error: applied.error });
      return false;
    }

    try {
      const existing = pending.id ? this.library.get(pending.id) : undefined;
      const built = blockFromSource({
        id: pending.id ?? this.library.uniqueId(name),
        name,
        kind: pending.kind,
        category: pending.category,
        description: pending.description,
        html: applied.html,
        css: pending.css,
        script: pending.script,
        tag,
      });
      // Props replace rather than merge: the review step is the whole truth about
      // them, so one deleted from the markup has to disappear with it.
      const block = this.library.upsert({
        ...existing,
        ...built,
        props: Object.keys(applied.props).length ? applied.props : undefined,
      });
      this.store.patch({ extraction: null });
      this.notify(
        pending.id ? `Updated ${block.name}.` : `Saved ${block.name} to the library.`,
        'success',
      );
      return true;
    } catch (error) {
      this.updateExtraction({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /** Props a block already declares, so editing one keeps its descriptions. */
  #existingProps(id: string | null): Record<string, PropSpec> | undefined {
    return id ? this.library.get(id)?.props : undefined;
  }

  /** Show a language, wherever the Code panel currently is. */
  setCodeTab(tab: CodeTab): void {
    if (this.store.value.codeTab !== tab) this.store.patch({ codeTab: tab });
  }

  /** Open the Code panel in the dock, on a given language. */
  openCode(tab: CodeTab = 'html'): void {
    this.store.patch({ codeTab: tab, dockTab: 'code', dockOpen: true });
  }

  /** Open the fullscreen code view. The language carries over both ways. */
  openCodeWorkspace(tab: CodeTab = this.store.value.codeTab): void {
    this.store.patch({ codeTab: tab, codeWorkspace: true, dockTab: 'code', dockOpen: true });
  }

  closeCodeWorkspace(): void {
    if (this.store.value.codeWorkspace) this.store.patch({ codeWorkspace: false });
  }

  /** Step back to the markup without losing the props reviewed so far. */
  backToBlockSource(): void {
    const pending = this.store.value.extraction;
    if (pending?.mode !== 'block') return;
    this.store.patch({ extraction: { ...pending, step: 'source', error: '' } });
  }

  /**
   * CSS for the registry classes used anywhere in a subtree.
   *
   * Makes an extracted block portable: the markup references classes, and this is
   * what those classes mean.
   */
  #cssForSubtree(el: HTMLElement): string {
    const names = new Set<string>();
    for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
      for (const name of Array.from(node.classList)) {
        if (!name.startsWith('heo-') && this.classes.get(name)) names.add(name);
      }
    }
    return [...names]
      .map((name) => {
        const entry = this.classes.get(name)!;
        const body = Object.entries(entry.declarations)
          .map(([property, value]) => `  ${property}: ${value};`)
          .join('\n');
        return `.${name} {\n${body}\n}`;
      })
      .join('\n\n');
  }

  /**
   * Promote the element's token-based declarations into a named class.
   *
   * This is the "groups of tokens used in a component become a class" path: it
   * reads the declarations that already reference tokens, registers them as a
   * class, applies that class, and strips the now-redundant inline styles.
   */
  extractClassFromSelection(name?: string, el = this.store.value.selected): string | null {
    if (!el) return null;
    const inline = inlineDeclarations(el);
    const declarations = Object.keys(inline).length ? inline : this.tokens.tokenDeclarationsOf(el);
    if (!Object.keys(declarations).length) {
      this.notify('There are no declarations on this element to turn into a class.', 'error');
      return null;
    }
    const className = normalizeClassName(name ?? suggestClassName(declarations));
    if (!className) {
      this.notify('That is not a valid class name.', 'error');
      return null;
    }
    this.#commitClass(el, className, declarations, Object.keys(inline).length > 0);
    return className;
  }

  /**
   * Register a class, apply it, and drop the declarations it absorbed.
   *
   * One command so undo restores the element's `class` and `style` attributes
   * together — leaving one of the two behind would be worse than not undoing at
   * all. The registry write is inside the command too, so undo also removes the
   * class definition.
   *
   * An existing name is folded into rather than overwritten, unless `collision`
   * says otherwise: the incoming declarations win where they clash and everything
   * else the class holds survives. The alternative — what this did before — quietly
   * discarded the rest of a shared class, which is a large change to make on the
   * strength of a name someone typed.
   */
  #commitClass(
    el: HTMLElement,
    className: string,
    declarations: Record<string, string>,
    stripInline: boolean,
    collision: ClassCollision = 'merge',
  ): void {
    const previousEntry = this.classes.get(className);
    const plan = planClassMerge(previousEntry, declarations, collision);
    const previousStyle = el.getAttribute('style');
    const previousClass = el.getAttribute('class');
    const nextClass = [...new Set([...Array.from(el.classList), className])].join(' ');
    const count = Object.keys(declarations).length;

    // Only remove the declarations the class now carries; anything the user chose
    // to leave behind stays on the element.
    const remaining = { ...inlineDeclarations(el) };
    for (const property of Object.keys(declarations)) delete remaining[property];
    const remainingCss = Object.entries(remaining)
      .map(([property, value]) => `${property}: ${value}`)
      .join('; ');

    const verb = !previousEntry ? 'Extract' : collision === 'replace' ? 'Replace' : 'Merge into';
    this.history.commit({
      label: `${verb} .${className}`,
      subject: `class-extract:${className}`,
      record: {
        id: nextChangeId(),
        kind: 'token-class',
        summary: previousEntry
          ? `${collision === 'replace' ? 'Replace' : 'Merge'} ${count} declarations from ${labelFor(el)} into the existing .${className}`
          : `Extract ${count} declarations from ${labelFor(el)} into .${className}`,
        target: selectorFor(el),
        source: nearestSourceRef(el),
        after: className,
        detail: Object.fromEntries(Object.entries(plan.result)),
        at: Date.now(),
      },
      apply: () => {
        // Spread the previous entry so a class that already had a label or a
        // description keeps them; only the declarations are being decided here.
        this.classes.upsert({
          ...previousEntry,
          name: className,
          declarations: plan.result,
          origin: 'user',
        });
        el.setAttribute('class', nextClass);
        if (!stripInline) return;
        if (remainingCss) el.setAttribute('style', remainingCss);
        else el.removeAttribute('style');
      },
      revert: () => {
        if (previousEntry) this.classes.upsert(previousEntry);
        else this.classes.remove(className);
        if (previousClass === null) el.removeAttribute('class');
        else el.setAttribute('class', previousClass);
        if (previousStyle === null) el.removeAttribute('style');
        else el.setAttribute('style', previousStyle);
      },
    });
    this.#bumpRevision();
    this.notify(this.#extractionToast(className, plan, collision), 'success', {
      label: 'Undo',
      run: () => this.undo(),
    });
  }

  /** What actually happened, in one line: created, merged, or replaced. */
  #extractionToast(
    className: string,
    plan: ClassMergePlan,
    collision: ClassCollision,
  ): string {
    if (!plan.existing) return `Created .${className} and applied it.`;
    if (collision === 'replace') {
      return `.${className} now holds only these ${Object.keys(plan.result).length} declarations.`;
    }
    const parts = [
      plan.added.length ? `added ${plan.added.length}` : '',
      plan.replaced.length ? `replaced ${plan.replaced.length}` : '',
    ].filter(Boolean);
    return parts.length
      ? `Merged into .${className}: ${parts.join(', ')}.`
      : `.${className} already set all of these, so only the class was applied.`;
  }

  /* ---------------------------------------------------------------------- */
  /* Un-extraction                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Pull a class's declarations back onto one element and take the class off it.
   *
   * The exact inverse of extract-to-class, and the honest answer to "I only want to
   * change this one". Sharing a class is the right default, but it is a commitment
   * made at extraction time, and until now there was no way out of it other than
   * retyping every declaration by hand and remembering to remove the class.
   *
   * The element's own inline values stay on top of what is copied down, because they
   * already beat the class in the cascade — inlining must not change how the element
   * looks. A definition the overlay owns and nothing else wears is dropped with it,
   * so the export does not carry a rule with no users.
   */
  inlineClass(name: string, el = this.store.value.selected): boolean {
    if (!el) return false;
    const entry = this.classes.get(name);
    if (!entry || !Object.keys(entry.declarations).length) {
      this.notify(
        `No readable rule defines .${name}, so there is nothing to bring onto this element.`,
        'error',
      );
      return false;
    }
    if (!el.classList.contains(entry.name)) {
      this.notify(`${labelFor(el)} does not have .${entry.name}.`, 'error');
      return false;
    }

    const className = entry.name;
    const count = Object.keys(entry.declarations).length;
    const previousClass = el.getAttribute('class');
    const previousStyle = el.getAttribute('style');
    const nextClass = Array.from(el.classList)
      .filter((item) => item !== className)
      .join(' ');
    const merged = { ...entry.declarations, ...inlineDeclarations(el) };
    const nextStyle = Object.entries(merged)
      .filter(([, value]) => value.trim() !== '')
      .map(([property, value]) => `${property}: ${value}`)
      .join('; ');
    // Counted before the command runs: applying it invalidates the usage cache, and
    // the answer that matters is how many elements wear the class right now.
    const orphaned =
      entry.origin !== 'stylesheet' && (this.classes.usage().get(className) ?? 0) <= 1;
    const snapshot: DesignClass = { ...entry, declarations: { ...entry.declarations } };

    this.history.commit({
      label: `Inline .${className}`,
      subject: `class-inline:${className}:${selectorFor(el)}`,
      record: {
        id: nextChangeId(),
        kind: 'token-class',
        summary: `Move ${count} declarations from .${className} onto ${labelFor(el)}${orphaned ? ', and drop the now-unused class' : ''}`,
        target: selectorFor(el),
        source: nearestSourceRef(el),
        before: className,
        detail: Object.fromEntries(Object.entries(entry.declarations)),
        at: Date.now(),
      },
      apply: () => {
        if (nextClass) el.setAttribute('class', nextClass);
        else el.removeAttribute('class');
        if (nextStyle) el.setAttribute('style', nextStyle);
        else el.removeAttribute('style');
        if (orphaned) this.classes.remove(className);
      },
      revert: () => {
        if (orphaned) this.classes.upsert(snapshot);
        if (previousClass === null) el.removeAttribute('class');
        else el.setAttribute('class', previousClass);
        if (previousStyle === null) el.removeAttribute('style');
        else el.setAttribute('style', previousStyle);
      },
    });
    this.#bumpRevision();
    this.notify(
      orphaned
        ? `Moved ${count} declarations onto ${labelFor(el)} and removed .${className}.`
        : `Moved ${count} declarations onto ${labelFor(el)}. .${className} still applies elsewhere.`,
      'success',
      { label: 'Undo', run: () => this.undo() },
    );
    return true;
  }

  /**
   * Copy a shared class under a new name and swap it in on one element.
   *
   * The other half of "stop sharing this". Inlining gives up the class entirely;
   * forking keeps a named, reusable rule but makes it this element's own, which is
   * what you want when the declarations are still a coherent thing — a variant —
   * rather than a handful of one-off values.
   *
   * Returns the new name so a panel showing the old one can follow it.
   */
  forkClass(name: string, el = this.store.value.selected, requested?: string): string | null {
    if (!el) return null;
    const entry = this.classes.get(name);
    if (!entry) {
      this.notify(`No readable rule defines .${name}, so there is nothing to copy.`, 'error');
      return null;
    }
    if (!el.classList.contains(entry.name)) {
      this.notify(`${labelFor(el)} does not have .${entry.name}.`, 'error');
      return null;
    }

    const className = entry.name;
    const asked = requested === undefined ? '' : normalizeClassName(requested);
    if (requested !== undefined && requested.trim() && !asked) {
      this.notify(`"${requested}" is not a valid class name.`, 'error');
      return null;
    }
    const forkName = asked || this.classes.uniqueName(className);
    if (forkName === className) {
      this.notify('The copy needs a different name.', 'error');
      return null;
    }
    if (this.classes.get(forkName)) {
      this.notify(`.${forkName} already exists. Pick another name.`, 'error');
      return null;
    }

    const previousClass = el.getAttribute('class');
    // In place of the original rather than appended, so the order of the element's
    // classes — and with it any specificity the author relied on — is preserved.
    const nextClass = Array.from(el.classList)
      .map((item) => (item === className ? forkName : item))
      .join(' ');
    const copy: DesignClass = {
      name: forkName,
      declarations: { ...entry.declarations },
      label: prettifyClassName(forkName),
      description: entry.description,
      origin: 'user',
    };
    const others = Math.max(0, (this.classes.usage().get(className) ?? 1) - 1);

    this.history.commit({
      label: `Fork .${className} as .${forkName}`,
      subject: `class-fork:${forkName}`,
      record: {
        id: nextChangeId(),
        kind: 'token-class',
        summary: `Copy .${className} to .${forkName} and use it on ${labelFor(el)} alone`,
        target: selectorFor(el),
        source: nearestSourceRef(el),
        before: className,
        after: forkName,
        detail: Object.fromEntries(Object.entries(copy.declarations)),
        at: Date.now(),
      },
      apply: () => {
        this.classes.upsert(copy);
        el.setAttribute('class', nextClass);
      },
      revert: () => {
        this.classes.remove(forkName);
        if (previousClass === null) el.removeAttribute('class');
        else el.setAttribute('class', previousClass);
      },
    });
    this.#bumpRevision();
    this.notify(
      others
        ? `Now on .${forkName}. Editing it no longer touches the ${others} other element${others === 1 ? '' : 's'} using .${className}.`
        : `Now on .${forkName}, a copy of .${className}.`,
      'success',
      { label: 'Undo', run: () => this.undo() },
    );
    return forkName;
  }

  /* ---------------------------------------------------------------------- */
  /* Structure                                                              */
  /* ---------------------------------------------------------------------- */

  duplicate(el = this.store.value.selected): void {
    if (!isMutable(el)) return;
    const result = duplicateElement(el);
    if (!result) return;
    this.history.commit(result.command);
    // A clone is a new node, so it needs its own instance record; without this the
    // copy of a configured block would lose its editable props.
    const instance = this.#instances.get(el);
    if (instance) this.#instances.set(result.node, { ...instance, values: { ...instance.values } });
    this.select(result.node);
    this.notify('Duplicated.', 'success');
  }

  remove(el = this.store.value.selected): void {
    if (!isMutable(el)) return;
    const next = nextSibling(el) ?? previousSibling(el) ?? selectableParent(el);
    const command = removeElement(el);
    if (!command) return;
    this.history.commit(command);
    this.select(next);
    this.notify(`Deleted ${labelFor(el)}.`, 'info', {
      label: 'Undo',
      run: () => this.undo(),
    });
  }

  wrap(wrapperHTML: string, el = this.store.value.selected): void {
    if (!isMutable(el)) return;
    const result = wrapElement(el, wrapperHTML);
    if (!result) {
      this.notify('That wrapper markup could not be used.', 'error');
      return;
    }
    this.history.commit(result.command);
    this.select(result.wrapper);
    this.notify('Wrapped in a new container.', 'success');
  }

  unwrap(el = this.store.value.selected): void {
    if (!isMutable(el)) return;
    const command = unwrapElement(el);
    if (!command) {
      this.notify('This element has no children to keep.', 'error');
      return;
    }
    const parent = selectableParent(el);
    this.history.commit(command);
    this.select(parent);
  }

  move(direction: 'up' | 'down' | 'out' | 'in', el = this.store.value.selected): void {
    if (!isMutable(el)) return;
    const command = this.#buildMove(el, direction);
    if (!command) {
      this.notify('There is nowhere to move this element.', 'info');
      return;
    }
    // Animate the reorder the same way dragging does. Holding ⇧↑ to walk an
    // element up a list is otherwise a series of jumps with nothing to show which
    // element actually moved.
    const rects = captureRects(neighbourhood(el.parentNode, el.parentNode?.parentNode));
    this.history.commit(command);
    // The selection outline has to ride the glide rather than jump to where the
    // element will end up, so the chrome is re-measured for its whole duration.
    this.#followReflow(playFlip(rects));
    this.#bumpGeometry();
  }

  #buildMove(el: HTMLElement, direction: 'up' | 'down' | 'out' | 'in'): Command | null {
    const parent = el.parentNode;
    if (!parent) return null;
    switch (direction) {
      case 'up': {
        const previous = el.previousElementSibling;
        return previous ? moveElement(el, parent, previous, 'Move up') : null;
      }
      case 'down': {
        const next = el.nextElementSibling;
        return next ? moveElement(el, parent, next.nextSibling, 'Move down') : null;
      }
      case 'out': {
        if (parent instanceof ShadowRoot) {
          const host = parent.host;
          return host.parentNode ? moveElement(el, host.parentNode, host, 'Move out') : null;
        }
        const grandparent = (parent as Element).parentNode;
        return grandparent ? moveElement(el, grandparent, parent as Element, 'Move out') : null;
      }
      case 'in': {
        const target = el.nextElementSibling ?? el.previousElementSibling;
        if (!(target instanceof HTMLElement) || !acceptsChildren(target)) return null;
        return moveElement(el, target, target.firstChild, 'Move into');
      }
      default:
        return null;
    }
  }

  async insertBlock(
    block: LibraryBlock,
    props: Record<string, unknown>,
    anchor?: InsertAnchor,
  ): Promise<HTMLElement | null> {
    const target = anchor ?? this.store.value.insertAnchor ?? this.#defaultAnchor();
    if (!target) {
      this.notify('Select an element first, then choose where to insert.', 'error');
      return null;
    }
    if (target.position === 'replace' && !isMutable(target.reference)) {
      this.notify(`${labelFor(target.reference)} cannot be replaced.`, 'error');
      return null;
    }
    try {
      const { nodes } = await this.library.instantiate(block, props);
      if (!nodes.length) {
        this.notify('That block produced no markup.', 'error');
        return null;
      }
      const replacing = target.position === 'replace' ? labelFor(target.reference) : null;
      const command = insertNodes(
        target.reference,
        target.position,
        nodes,
        replacing ? `Replace with ${block.name}` : `Insert ${block.name}`,
      );
      if (!command) return null;
      this.history.commit(command);
      if (block.element?.tag) this.#injectedElements.add(block.element.tag);
      // Remember what the block was configured with, so the props panel can offer
      // the same form again instead of leaving the values write-once.
      this.#rememberInstance(nodes[0], block, props);
      this.store.patch({ insertAnchor: null });
      this.select(nodes[0]);
      this.notify(
        replacing ? `Replaced ${replacing} with ${block.name}.` : `Inserted ${block.name}.`,
        'success',
        { label: 'Undo', run: () => this.undo() },
      );
      return nodes[0];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[html-editor-overlay] insert failed', error);
      this.notify(`Could not insert ${block.name}: ${message}`, 'error');
      return null;
    }
  }

  insertMarkup(html: string, anchor?: InsertAnchor): HTMLElement | null {
    const target = anchor ?? this.store.value.insertAnchor ?? this.#defaultAnchor();
    if (!target) return null;
    if (target.position === 'replace' && !isMutable(target.reference)) {
      this.notify(`${labelFor(target.reference)} cannot be replaced.`, 'error');
      return null;
    }
    const result = insertHTML(target.reference, target.position, html);
    if (!result) {
      this.notify('That markup could not be inserted.', 'error');
      return null;
    }
    this.history.commit(result.command);
    this.store.patch({ insertAnchor: null });
    this.select(result.nodes[0]);
    return result.nodes[0];
  }

  replaceMarkup(html: string, el = this.store.value.selected): boolean {
    if (!isMutable(el)) return false;
    const result = replaceElement(el, html);
    if (!result) {
      this.notify('That markup has no root element.', 'error');
      return false;
    }
    this.history.commit(result.command);
    this.select(result.node);
    this.notify('Markup replaced.', 'success');
    return true;
  }

  retag(tagName: string, el = this.store.value.selected): boolean {
    if (!isMutable(el)) return false;
    const result = retagElement(el, tagName);
    if (!result) {
      this.notify(`Cannot change this element to <${tagName}>.`, 'error');
      return false;
    }
    this.history.commit(result.command);
    this.select(result.node);
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Block instances                                                        */
  /* ---------------------------------------------------------------------- */

  #rememberInstance(
    el: HTMLElement,
    block: LibraryBlock,
    props: Record<string, unknown>,
  ): void {
    if (!block.props || !Object.keys(block.props).length) return;
    const values: Record<string, string> = {};
    for (const [name, spec] of Object.entries(block.props)) {
      values[name] = String(props[name] ?? spec.default ?? '');
    }
    this.#instances.set(el, { blockId: block.id, values });
  }

  /**
   * The block an element came from, with the props it was built with.
   *
   * Returns nothing for elements the editor did not insert, which is most of the
   * page — the props panel falls back to attributes there.
   */
  blockInstance(
    el: HTMLElement | null,
  ): { block: LibraryBlock; values: Record<string, string> } | null {
    if (!el) return null;
    const entry = this.#instances.get(el);
    if (!entry) return null;
    const block = this.library.get(entry.blockId);
    if (!block) return null;
    return { block, values: { ...entry.values } };
  }

  /**
   * Change a prop on an inserted block.
   *
   * Two very different mechanics behind one call. A block that registers a custom
   * element carries its props as attributes, so the element re-renders itself and
   * nothing structural happens. A template block has no such machinery: its props
   * were substituted into markup at insert time, so the only honest way to change
   * one is to re-render the template and swap the element out — which is why this
   * goes through the same replace command the code panel uses, and why the new node
   * inherits the instance record.
   */
  async setBlockProp(el: HTMLElement, name: string, value: string): Promise<void> {
    const entry = this.#instances.get(el);
    const instance = this.blockInstance(el);
    if (!entry || !instance) return;
    const { block } = instance;
    const values = { ...instance.values, [name]: value };

    if (block.element?.tag) {
      entry.values = values;
      this.setAttribute(name, value || null, el);
      return;
    }

    try {
      const { nodes } = await this.library.instantiate(block, values);
      const replacement = nodes[0];
      if (!replacement) return;
      const command = replaceElement(el, replacement.outerHTML);
      if (!command) return;
      this.history.commit(command.command);
      this.#instances.set(command.node, { blockId: block.id, values });
      this.select(command.node);
      this.#bumpRevision();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Could not update ${name}: ${message}`, 'error');
    }
  }

  #defaultAnchor(): InsertAnchor | null {
    const selected = this.store.value.selected;
    if (selected && isMutable(selected)) return { reference: selected, position: 'after' };
    return { reference: document.body, position: 'lastChild' };
  }

  setInsertAnchor(anchor: InsertAnchor | null): void {
    this.store.patch({ insertAnchor: anchor });
  }

  setQuickMenu(open: boolean): void {
    this.store.patch({ quickMenuOpen: open });
  }

  /* ---------------------------------------------------------------------- */
  /* Inline text editing                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Start editing text in place.
   *
   * `caret` places the insertion point under the pointer instead of at the end,
   * which is what makes clicking into a paragraph behave the way it does in every
   * other editor: you land where you clicked.
   */
  beginTextEdit(el = this.store.value.selected, caret?: { x: number; y: number }): void {
    if (!el || this.store.value.textEditing === el) return;
    if (!acceptsChildren(el)) return;
    /*
     * Warned, and allowed anyway.
     *
     * This used to refuse, and refusing was the wrong trade. The evidence behind it is
     * good but not conclusive, and it cannot be made conclusive: a build step that
     * rewrites the HTML looks identical to hand-authored markup from inside the page,
     * and an attribute read back on the next interaction looks identical to text nobody
     * touches. So a block turns every wrong guess into a capability the user has lost,
     * with no way to overrule it — and the guesses that matter most are exactly the ones
     * nothing here can verify.
     *
     * Saying so and standing aside inverts the cost. A wrong warning is a sentence to
     * disregard; a right one arrives before the work is done rather than after it is
     * lost, and carries the edit that would actually hold. What the edit *does* is then
     * watched, which is how a guess becomes a fact.
     */
    if (this.options.detectScriptContent !== false) this.#warnScriptOwned(el);
    this.endTextEdit(true);
    this.#textEditSnapshot = el.innerHTML;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-heo-editing', '');
    el.setAttribute('spellcheck', 'true');
    this.store.patch({ textEditing: el, selected: el });

    // Focus on the next frame so the attribute has taken effect before the
    // caret is placed, otherwise Safari drops the selection.
    requestAnimationFrame(() => {
      if (this.store.value.textEditing !== el) return;
      el.focus({ preventScroll: true });
      const selection = getSelection();
      if (!selection) return;
      selection.removeAllRanges();

      const atPointer = caret ? rangeFromPoint(caret.x, caret.y) : null;
      if (atPointer && el.contains(atPointer.startContainer)) {
        selection.addRange(atPointer);
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.addRange(range);
    });
  }

  /**
   * Work out which content is not in the page's own HTML file.
   *
   * The signal that does not care when the editor arrived, and therefore the one that
   * catches the common case: a script in `<body>` that fills a container while the
   * document is still parsing has finished before any wrapper or observer could have
   * been installed. Comparing against the file is the only way back.
   *
   * Read through a connected project first and fetched otherwise, the same order the
   * stylesheets use and for the same reasons: over `file://` a fetch of the page is
   * refused, and behind a dev server a request can return something other than the
   * file. Silent when neither works — this sharpens the answer where it can and the
   * other tiers still stand on their own.
   */
  async establishContentBaseline(): Promise<number> {
    if (this.options.detectScriptContent === false) return 0;
    const source = await this.#readOwnDocument();
    if (source === null || this.#destroyed) return 0;
    const marked = establishBaseline(source);
    if (marked) this.#bumpRevision();
    return marked;
  }

  /** The page's own HTML as served, from disk when possible. */
  async #readOwnDocument(): Promise<string | null> {
    const host = this.#project;
    if (host) {
      const path = host.resolve(location.href);
      if (path) {
        const text = await host.read(path).catch(() => null);
        if (text !== null) return text;
      }
    }
    try {
      const response = await fetch(location.href, { credentials: 'same-origin' });
      return response.ok ? await response.text() : null;
    } catch {
      // An opaque origin, which is every local file opened directly. The folder is the
      // way through, and connecting one runs this again.
      return null;
    }
  }

  /**
   * What is known about who renders this element's content, if anything.
   *
   * `undefined` means the content was authored in the markup as far as the editor can
   * tell, which is the answer that lets it be edited in place.
   */
  provenanceOf(el = this.store.value.selected): Provenance | undefined {
    if (!el || this.options.detectScriptContent === false) return undefined;
    // Straight through: the overlay's own insertions and the user's own edits are
    // exempted inside `provenanceOf` itself, so there is nothing to filter here.
    return provenanceOf(el);
  }

  /**
   * Say what is known before the work is done, once per element per session.
   *
   * Once, because a warning that reappears on every click is a warning that gets
   * dismissed without reading — and the user has been told, and has chosen to continue,
   * which is their call to make. The action matters more than the sentence: the intent
   * was "change this text", so the useful reply is the edit that would hold rather than
   * an explanation with a dead end after it.
   *
   * Offered whenever there is anywhere to look, which is more often than there is a
   * recorded location: searching the page's scripts can find code that a comparison
   * against the HTML could only tell us exists. A dependency is the one case worth
   * declining — nobody wants to be sent into `node_modules`.
   */
  #warnScriptOwned(el: HTMLElement): void {
    if (this.#warnedAbout.has(el)) return;
    const provenance = provenanceOf(el);
    if (!provenance) return;
    this.#warnedAbout.add(el);
    this.notify(
      describeProvenance(provenance),
      provenance.confidence === 'certain' ? 'warn' : 'info',
      provenance.vendor
        ? undefined
        : { label: 'Edit the code', run: () => void this.openSourceEdit(el) },
    );
  }

  /** Elements already warned about, so the notice is information and not nagging. */
  #warnedAbout = new WeakSet<HTMLElement>();

  /**
   * Watch an edit, and speak up if the page takes it back.
   *
   * The one signal that is evidence rather than inference, and the only one that catches
   * code reading its own DOM back to re-render from an attribute or a data store. When
   * it fires, the guess is settled: the element is recorded at full confidence, the user
   * is told what happened in the past tense, and the code route is offered — this time
   * on the strength of something that actually occurred.
   */
  #watchEdit(el: HTMLElement, expected: string): void {
    if (this.options.detectScriptContent === false) return;
    this.#editWatchers.get(el)?.();
    const stop = watchEditDurability(el, expected, (found) => {
      this.#editWatchers.delete(el);
      if (this.#destroyed) return;
      const provenance = markObservedRevert(el);
      this.#warnedAbout.add(el);
      this.#bumpRevision();
      this.notify(
        found
          ? `The page replaced your edit with “${clip(found)}”. ${describeProvenance(provenance)}`
          : `The page rebuilt this element and your edit went with it. ${describeProvenance(provenance)}`,
        'warn',
        provenance.vendor
          ? undefined
          : { label: 'Edit the code', run: () => void this.openSourceEdit(el) },
      );
    });
    this.#editWatchers.set(el, stop);
    this.#listeners.push(stop);
  }

  #editWatchers = new Map<HTMLElement, () => void>();

  /* ---------------------------------------------------------------------- */
  /* Editing the code behind rendered content                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Open the code that renders this element, focused on the part that produces it.
   *
   * The dialog opens before the file has been read, holding what is already known —
   * which file, which element, what it says. A disk read is not instant and an empty
   * modal that fills in is far better than a button that appears to do nothing for a
   * beat and then produces a window.
   */
  async openSourceEdit(el = this.store.value.selected): Promise<boolean> {
    if (!el) return false;
    const provenance = provenanceOf(el);
    if (!provenance) {
      this.notify('This content is not rendered by the page’s code, so it can be edited in place.', 'info');
      return false;
    }
    const host = this.#project;
    const text = (el.textContent ?? '').trim();
    const fromProvenance = sourceTargetOf(provenance, (url) => host?.resolve(url) ?? null);

    this.store.patch({
      sourceEdit: {
        element: el,
        provenance,
        target: fromProvenance ?? { label: 'the page’s JavaScript' },
        file: null,
        window: null,
        draft: '',
        text,
        error: '',
        recorded: false,
        searched: false,
        candidates: 0,
      },
    });

    let target = fromProvenance;
    let file = target ? await this.#readSource(target) : null;
    /*
     * Whether the file was named by evidence or found by looking for the text, and how
     * many other files the text also appeared in. Both go to the dialog: a match that was
     * chosen from four is a different claim from one the build pointed at, and the reader
     * is the only one who can tell whether the pick is right.
     */
    let searched = false;
    let candidates = 0;

    /*
     * No location, so go and look for one.
     *
     * The baseline comparison knows content is generated without knowing what generated
     * it — it works by noticing an absence in the HTML, which names no script. But the
     * text on screen usually appears verbatim in whichever file builds it, so searching
     * the page's own scripts for it finds the file *and* the line, and does so however
     * long ago the render happened. This is what makes the offer real for a page that
     * had finished rendering before the editor loaded.
     */
    if (file === null) {
      const found = await this.#findTextInScripts(text, el);
      if (found) {
        target = found.target;
        file = found.file;
        candidates = found.candidates;
        searched = true;
      }
    }

    // Closed, or moved to another element, while the reads were in flight.
    const open = this.store.value.sourceEdit;
    if (!open || open.element !== el) return false;

    if (!target || file === null) {
      this.updateSourceEdit({
        error: host
          ? `Could not find the code that renders this in ${host.label}. Its text may be built from data, translated, or fetched.`
          : 'Connect the project folder so the page’s scripts can be read, and this can point at the code that renders it.',
      });
      return false;
    }

    const window = sourceWindow(file, text, target.line);
    this.updateSourceEdit({ target, file, window, draft: window.code, searched, candidates });
    return true;
  }

  /**
   * Find the page's text in one of the page's own scripts.
   *
   * First match wins, in document order, and only an exact literal counts — a script
   * that merely happens to be readable is not evidence of anything. The scripts are
   * read in parallel because they are small and a serial walk of half a dozen files is
   * a visible pause on a button press.
   */
  async #findTextInScripts(
    text: string,
    el: HTMLElement,
  ): Promise<{ target: SourceTarget; file: string; candidates: number } | null> {
    if (text.length < 4) return null;
    const sources = collectScriptSources(this.#project).filter(
      (source) => !source.readOnly && source.kind !== 'json',
    );
    if (!sources.length) return null;

    const read = await Promise.all(
      sources.map(async (source) => ({
        source,
        file: await fetchScriptSource(source, this.#project).catch(() => ''),
      })),
    );

    /*
     * Every file the string appears in, ranked — because "it appears here" is a
     * coincidence until something corroborates it.
     *
     * Taking the first match and calling it the source was the bug worth fixing: a
     * string can live in a copy of the data, a test, a translation table or a comment,
     * and the dialog then asserted the wrong file with total confidence. Scoring is what
     * turns that into a defensible pick, and the count is what lets the dialog admit
     * there were others.
     */
    const hits: Array<{ target: SourceTarget; file: string; score: number }> = [];
    const identifiers = [el.id, ...Array.from(el.classList)]
      .filter((name) => name && !name.startsWith('heo-'))
      .map((name) => name.toLowerCase());

    for (const { source, file } of read) {
      if (!file) continue;
      const window = sourceWindow(file, text);
      if (window.anchorKind !== 'literal') continue;

      let score = 1;
      const line = file.split('\n')[window.anchor - 1] ?? '';
      // A quoted occurrence is a value the code uses. An unquoted one is prose about it.
      if (/['"`]/.test(line)) score += 3;
      if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) score -= 3;
      // The file also talks about this element, which is the corroboration that matters.
      const haystack = file.toLowerCase();
      if (identifiers.some((name) => haystack.includes(name))) score += 4;
      // And we already caught this script writing to the page at some point.
      if (source.href && this.#writingScripts.has(source.href)) score += 6;

      hits.push({
        file,
        score,
        target: { path: source.path, url: source.href, label: source.label, line: window.anchor },
      });
    }

    if (!hits.length) return null;
    hits.sort((a, b) => b.score - a.score);
    return { ...hits[0], candidates: hits.length };
  }

  /**
   * Scripts seen writing to the page, by URL.
   *
   * Kept so a text search can prefer a file that has demonstrably rendered something
   * over one that merely mentions the string. Fed by the wrappers, which means it is
   * only populated when the overlay loaded early enough to install them — so it sharpens
   * the ranking when available and costs nothing when not.
   */
  #writingScripts = new Set<string>();

  /**
   * The file's text, from disk when a project is connected and from the network when
   * the page can reach it.
   *
   * Disk first, and for the same reason the stylesheets read that way: a dev server can
   * hand back a transformed copy, and whatever is shown here is what gets written back
   * over the source.
   */
  async #readSource(target: SourceTarget): Promise<string | null> {
    const host = this.#project;
    if (host && target.path) {
      const text = await host.read(target.path).catch(() => null);
      if (text !== null) return text;
    }
    if (!target.url) return null;
    try {
      const response = await fetch(target.url, { credentials: 'same-origin' });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  }

  updateSourceEdit(patch: Partial<SourceEdit>): void {
    const current = this.store.value.sourceEdit;
    if (!current) return;
    this.store.patch({ sourceEdit: { ...current, ...patch } });
  }

  closeSourceEdit(): void {
    if (this.store.value.sourceEdit) this.store.patch({ sourceEdit: null });
  }

  /**
   * Record the edit. Returns false and sets an error when there is nothing to record.
   *
   * Nothing happens to the page, and the dialog says so rather than pretending: the
   * file is what renders this content, so the screen keeps showing the old result until
   * the file is written and the page reloads. Recording it is what puts it in the save
   * plan and in the prompt, which is where it can actually take effect.
   */
  commitSourceEdit(): boolean {
    const pending = this.store.value.sourceEdit;
    if (!pending || !pending.file || !pending.window) return false;
    const command = writeSourceEdit(pending.target, pending.file, pending.window, pending.draft);
    if (!command) {
      this.updateSourceEdit({ error: 'Nothing has changed in this window yet.' });
      return false;
    }
    this.history.commit(command, { alreadyApplied: true });
    this.updateSourceEdit({ recorded: true, error: '' });
    this.notify(
      `Recorded an edit to ${pending.target.label}. It reaches the page when the file is saved.`,
      'success',
      { label: 'Undo', run: () => this.undo() },
    );
    return true;
  }

  /** Finish editing. `commit` false discards the edit. */
  endTextEdit(commit = true): void {
    const el = this.store.value.textEditing;
    if (!el) return;
    const before = this.#textEditSnapshot;
    this.#textEditSnapshot = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-heo-editing');
    el.removeAttribute('spellcheck');
    this.store.patch({ textEditing: null });

    if (before == null) return;
    const after = el.innerHTML;
    if (!commit) {
      // Not attributed: this is the editor putting the element back, not the page
      // rendering it, and counting it would make a discarded edit the last one allowed.
      withoutProvenance(() => {
        el.innerHTML = before;
      });
      return;
    }
    if (after === before) return;
    /*
     * Stamped before the element is claimed, because claiming it hides the answer.
     *
     * An edit to content the page renders has nowhere to go in the HTML: the element it
     * changes is not in that file, so writing the document cannot carry it and the next
     * render replaces it regardless. Recording *that* on the change is what lets the save
     * plan list it as unable to reach a file — which is honest — instead of quietly
     * folding it into the markup, which is how it used to be lost.
     *
     * Now that these edits are allowed rather than refused, this is the thing that keeps
     * the plan and the page from disagreeing about what a save will do.
     */
    const command = setInnerHTML(el, before, after);
    const rendered = this.provenanceOf(el);
    if (rendered) {
      command.record.detail = {
        ...command.record.detail,
        rendered: describeProvenance(rendered),
      };
    }

    // The user has taken this element over. Said once, here, so no later signal can
    // decide the page generates content the user has just written by hand.
    markUserOwned(el);
    this.history.commit(command, { alreadyApplied: true });
    // And now find out whether that was true. Every other signal predicts what will
    // happen to this edit; this one waits for it.
    this.#watchEdit(el, el.textContent ?? '');
    this.#bumpRevision();
  }

  /**
   * Apply a rich-text command inside the active text edit.
   *
   * `document.execCommand` is deprecated but remains the only cross-browser way
   * to apply formatting to a live selection while preserving the caret. The
   * alternative — hand-rolled range surgery — is far more code and breaks
   * undo inside the contenteditable region.
   */
  formatText(command: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'removeFormat'): void {
    if (!this.store.value.textEditing) return;
    document.execCommand(command);
  }

  /** Wrap the current selection in a link. Empty `href` unlinks. */
  insertLink(href: string, target?: '_blank' | null): void {
    const el = this.store.value.textEditing;
    if (!el) return;
    const url = href.trim();
    if (!url) {
      document.execCommand('unlink');
      return;
    }
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) return;
    if (selection.isCollapsed) {
      document.execCommand('insertHTML', false, `<a href="${escapeAttribute(url)}">${escapeAttribute(url)}</a>`);
    } else {
      document.execCommand('createLink', false, url);
    }
    if (target === '_blank') {
      for (const anchor of Array.from(el.querySelectorAll('a[href]'))) {
        if (anchor.getAttribute('href') !== url) continue;
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Drag reordering                                                        */
  /* ---------------------------------------------------------------------- */

  startDrag(el: HTMLElement, x: number, y: number): void {
    if (!isMutable(el) || !el.parentNode) return;
    // A gesture already in flight has to be resolved first. This is reachable
    // through the public engine, and starting a second drag without releasing the
    // first would leave that element translucent and unclickable for good.
    if (this.store.value.drag) this.cancelDrag();
    this.endTextEdit(true);
    this.#clearDragTimer();
    // The preview treatment lives in the page stylesheet, keyed on this attribute.
    el.setAttribute(DRAGGING_ATTR, '');
    el.style.setProperty('pointer-events', 'none', 'important');
    this.#dragPending = null;
    this.#dragLeftHomeAt = null;
    this.#dragDwell = null;
    this.#dragSettledAt = performance.now();
    this.#dragSettledAtPointer = { x, y };
    this.store.patch({
      drag: {
        element: el,
        origin: { parent: el.parentNode, nextSibling: el.nextSibling },
        pointer: { x, y },
        willCancel: false,
        hint: 'Drag to reorder',
        // A drag starts scoped to where the element already lives.
        home: el.parentNode,
        decision: null,
        waiting: null,
        pending: false,
      },
      hovered: null,
      quickMenuOpen: false,
      insertAnchor: null,
    });
  }

  /**
   * Update the in-flight drag.
   *
   * The dragged element is physically moved to the candidate position rather than
   * previewed with a placeholder line, so what the user sees during the drag is
   * the real layout they will get on release: neighbours shift to open the gap,
   * and the element itself renders translucent to say it is not committed yet.
   *
   * The gesture is scoped to one parent at a time — see `planDrag` — which is what
   * makes the preview stable: only the parent's own children can move, so the
   * ground under the pointer stays where it was. Three further guards keep the
   * reordering itself honest. A slot must persist for `dwell` before the DOM is
   * touched, so grazing a boundary announces the move without performing it. After
   * a move, `settle` ignores fresh candidates while the reflow animates, otherwise
   * the siblings that just shifted land under the pointer and propose moving
   * straight back. And the before/after choice is sticky around an element's
   * midpoint, so sub-pixel pointer noise cannot flip it.
   */
  updateDrag(x: number, y: number): void {
    const drag = this.store.value.drag;
    if (!drag) return;
    this.#clearDragTimer();

    const outside = x < 4 || y < 4 || x > innerWidth - 4 || y > innerHeight - 4;
    if (outside) {
      if (!drag.willCancel) this.#applyDrop(drag.origin.parent, drag.origin.nextSibling, drag.element);
      this.#dragPending = null;
      this.#dragLeftHomeAt = null;
      this.#dragDwell = null;
      this.store.patch({
        drag: {
          ...drag,
          pointer: { x, y },
          willCancel: true,
          hint: 'Release outside to cancel',
          // Back at the origin, so the last conclusion no longer describes
          // anything; keeping it would make the sticky band replay a decision
          // about an element the pointer has long since left.
          home: drag.origin.parent,
          decision: null,
          waiting: null,
          pending: false,
        },
      });
      return;
    }

    const now = performance.now();
    const plan = planDrag(
      drag.element,
      {
        home: drag.home,
        decision: drag.decision,
        leftHomeAt: this.#dragLeftHomeAt,
        dwell: this.#dragDwell,
      },
      x,
      y,
      now,
      DRAG_TIMING.reparent,
    );
    this.#dragLeftHomeAt = plan.leftHomeAt;
    this.#dragDwell = plan.dwell;

    const base = {
      ...drag,
      pointer: { x, y },
      willCancel: false,
      home: plan.home,
      hint: plan.hint,
      waiting: plan.waiting,
    };

    // A re-parent countdown owns the gesture, so reordering stops for its duration.
    // Two reasons, and the second is the one that matters: the pointer is aiming
    // into another container or out of this one, so shuffling siblings underneath
    // it is not what was asked — and doing it moves the target out from under the
    // pointer, which meant the hold could never finish. The countdown also has to
    // tick itself along, because holding still is the whole gesture.
    if (plan.waiting) {
      this.#dragPending = null;
      this.store.patch({ drag: { ...base, pending: false } });
      this.#scheduleDragTick(x, y, DRAG_TIMING.tick);
      return;
    }

    // Already in the proposed slot: nothing to schedule, but the decision is worth
    // recording so the next sample stays on this side of the midpoint.
    if (
      drag.element.parentNode === plan.placement.parent &&
      drag.element.nextSibling === plan.placement.before
    ) {
      this.#dragPending = null;
      this.store.patch({ drag: { ...base, decision: plan.decision, pending: false } });
      return;
    }

    const travelled = Math.hypot(x - this.#dragSettledAtPointer.x, y - this.#dragSettledAtPointer.y);
    const settling = now - this.#dragSettledAt < DRAG_TIMING.settle;
    if (settling && travelled < DRAG_TIMING.escape) {
      this.store.patch({ drag: { ...base, hint: drag.hint } });
      this.#scheduleDragTick(x, y, DRAG_TIMING.settle - (now - this.#dragSettledAt));
      return;
    }

    if (!this.#dragPending || !samePlacement(this.#dragPending.placement, plan.placement)) {
      this.#dragPending = { placement: plan.placement, since: now };
    }
    const waited = now - this.#dragPending.since;
    if (waited < DRAG_TIMING.dwell) {
      // Announce the destination now, move later. The chip is instant feedback;
      // the page only reflows once the intent has held.
      this.store.patch({ drag: { ...base, pending: true } });
      this.#scheduleDragTick(x, y, DRAG_TIMING.dwell - waited);
      return;
    }

    const moved = this.#applyDrop(plan.placement.parent, plan.placement.before, drag.element);
    this.#dragPending = null;
    this.store.patch({ drag: { ...base, decision: plan.decision, pending: false } });
    if (moved) {
      this.#dragSettledAt = performance.now();
      this.#dragSettledAtPointer = { x, y };
      this.#bumpGeometry();
    }
  }

  endDrag(): void {
    const drag = this.store.value.drag;
    if (!drag) return;
    this.#clearDragTimer();
    this.#dragPending = null;
    this.#dragLeftHomeAt = null;
    this.#dragDwell = null;
    drag.element.style.removeProperty('pointer-events');
    tidyStyleAttribute(drag.element);

    if (drag.willCancel) {
      this.#applyDrop(drag.origin.parent, drag.origin.nextSibling, drag.element);
      settleDrop(drag.element);
      this.store.patch({ drag: null });
      this.notify('Move cancelled.', 'info');
      this.#bumpGeometry();
      return;
    }

    const command = moveCommandFromOrigin(drag.element, drag.origin, 'Move');
    this.store.patch({ drag: null });
    // The element is already where it belongs — it went there as the preview — so
    // committing is only about turning that preview solid.
    settleDrop(drag.element);
    if (command) {
      this.history.commit(command, { alreadyApplied: true });
      this.notify('Moved.', 'success', { label: 'Undo', run: () => this.undo() });
    }
    this.#bumpGeometry();
  }

  cancelDrag(): void {
    const drag = this.store.value.drag;
    if (!drag) return;
    this.#clearDragTimer();
    this.#dragPending = null;
    this.#dragLeftHomeAt = null;
    this.#dragDwell = null;
    drag.element.style.removeProperty('pointer-events');
    tidyStyleAttribute(drag.element);
    this.#applyDrop(drag.origin.parent, drag.origin.nextSibling, drag.element);
    settleDrop(drag.element);
    this.store.patch({ drag: null });
    this.#bumpGeometry();
  }

  /**
   * Move the element, animating everything the move displaced.
   *
   * Measuring both parents before the insertion and replaying the difference
   * afterwards is what turns a hundred-pixel jump into a glide, and it is why the
   * neighbours appear to step aside to make room rather than teleport.
   */
  #applyDrop(parent: Node, before: Node | null, el: HTMLElement): boolean {
    if (el.parentNode === parent && el.nextSibling === before) return false;
    const rects = captureRects(neighbourhood(el.parentNode, parent));
    try {
      parent.insertBefore(el, before);
    } catch {
      // A node that cannot accept this element; leave the placement alone and
      // wait for the pointer to reach somewhere valid.
      return false;
    }
    this.#followReflow(playFlip(rects));
    return true;
  }

  /**
   * Re-evaluate at the last pointer position once a delay has elapsed.
   *
   * Both the dwell and settle windows are time-based, and the pointer may well
   * have stopped moving inside one of them. Without this the pending move would
   * sit there unapplied until the user jiggled the mouse.
   */
  #scheduleDragTick(x: number, y: number, delay: number): void {
    this.#clearDragTimer();
    this.#dragTimer = setTimeout(() => {
      this.#dragTimer = null;
      if (this.store.value.drag) this.updateDrag(x, y);
    }, Math.max(8, delay));
  }

  #clearDragTimer(): void {
    if (this.#dragTimer === null) return;
    clearTimeout(this.#dragTimer);
    this.#dragTimer = null;
  }

  /* ---------------------------------------------------------------------- */
  /* History                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Take back an edit that is still being typed, if there is one.
   *
   * This is the first thing undo and redo do, and when it finds something it is the
   * whole step — history is left alone. Both used to discard the preview *and* move
   * through history, which made one press change two things while the press back
   * could only restore one of them. Undo and redo have to be mirrors, so an
   * unfinished edit is a step of its own: one press, one thing.
   *
   * Returns true when a step was spent here.
   */
  #takeBackUnfinishedEdit(): boolean {
    if (!this.#preview && !this.#rulePreview && !this.#classPreview) return false;
    this.cancelPreview();
    // Let the field that owns the draft drop it, so its box agrees with the page.
    document.dispatchEvent(new CustomEvent(EDIT_DISCARDED_EVENT));
    this.notify('Discarded the unfinished edit', 'info');
    this.#bumpGeometry();
    this.#bumpRevision();
    return true;
  }

  undo(): void {
    this.endTextEdit(true);
    if (this.#takeBackUnfinishedEdit()) return;
    const command = this.history.undo();
    if (!command) return;
    this.#dropDetachedSelection();
    this.notify(`Undid: ${command.label}`, 'info');
    this.#bumpGeometry();
    this.#bumpRevision();
  }

  redo(): void {
    this.endTextEdit(true);
    if (this.#takeBackUnfinishedEdit()) return;
    const command = this.history.redo();
    if (!command) return;
    this.#dropDetachedSelection();
    this.notify(`Redid: ${command.label}`, 'info');
    this.#bumpGeometry();
    this.#bumpRevision();
  }

  resetAll(): void {
    this.endTextEdit(false);
    const selected = this.store.value.selected;
    this.history.reset();
    // The ids they referred to are gone; keeping them would silently exclude a later
    // change that happened to reuse one.
    this.#excludedChanges.clear();
    // Keep the selection if the element survived the revert; losing it after an
    // undo-all is disorienting and there is no reason for it.
    this.store.patch({
      selected: selected?.isConnected ? selected : null,
      hovered: null,
    });
    this.notify('All changes reverted.', 'info');
    this.#bumpGeometry();
  }

  get records(): ChangeRecord[] {
    return this.history.records;
  }

  /**
   * Changes the user has unchecked in the save dialog.
   *
   * Held here rather than in the dialog because three consumers have to agree about
   * it: the prompt preview, the clipboard copy and the payload handed to `onSave`.
   *
   * Unchecking leaves the edit on the page. That asymmetry is deliberate — reverting
   * one command from the middle of the stack is not safe, since the commands after it
   * hold live references to what it produced, and re-applying them without it would
   * quietly aim at a detached node. So this excludes the change from the hand-off and
   * says so; taking it off the page is what undo is for.
   */
  #excludedChanges = new Set<string>();

  get excludedChanges(): ReadonlySet<string> {
    return this.#excludedChanges;
  }

  /** The change set that will actually be handed off, in order. */
  get handoffRecords(): ChangeRecord[] {
    if (!this.#excludedChanges.size) return this.history.records;
    return this.history.records.filter((record) => !this.#excludedChanges.has(record.id));
  }

  setChangeIncluded(id: string, included: boolean): void {
    if (included) this.#excludedChanges.delete(id);
    else this.#excludedChanges.add(id);
    // The preview is the text that will be handed over, so it cannot lag behind the
    // checkbox that decides what goes into it.
    if (this.store.value.savePreview != null) {
      this.store.patch({ savePreview: this.buildSavePrompt() });
    }
    this.#bumpRegistry();
  }

  /** Put every change back in the hand-off. */
  includeAllChanges(): void {
    if (!this.#excludedChanges.size) return;
    this.#excludedChanges.clear();
    if (this.store.value.savePreview != null) {
      this.store.patch({ savePreview: this.buildSavePrompt() });
    }
    this.#bumpRegistry();
  }

  /* ---------------------------------------------------------------------- */
  /* The project: reaching the page's own files                              */
  /* ---------------------------------------------------------------------- */

  /**
   * A writable view of the files behind the page, when one has been connected.
   *
   * Null is the normal state and the default. The overlay was built on the premise
   * that it cannot reach your source, and that premise is worth keeping as the
   * default even now that it can: writing files is something the user asks for, once,
   * out loud, by handing over a folder or by running a dev server that offers to do
   * it. Everything else about saving stays exactly as it was.
   */
  #project: FileHost | null = null;

  get project(): FileHost | null {
    return this.#project;
  }

  /**
   * Where new tokens and reusable classes should be written.
   *
   * `'document'` leaves them in the `<style>` block the page already renders them
   * from, which is right for a single-file page and wrong for a project that keeps
   * its CSS in files — nobody wants their design tokens in the markup. So it is a
   * choice, defaulting to the page's first writable stylesheet when there is one.
   */
  #designSystemTarget: string | null = null;

  get designSystemTarget(): string {
    this.#designSystemTarget ??= this.styleTargets()[1]?.value ?? DOCUMENT_TARGET;
    return this.#designSystemTarget;
  }

  setDesignSystemTarget(target: string): void {
    if (this.#designSystemTarget === target) return;
    this.#designSystemTarget = target;
    // The plan named a file; it has to be rebuilt before it can name a different one.
    if (this.store.value.writePlan) void this.previewWritePlan();
    else this.#bumpRegistry();
  }

  /**
   * Places the design system could be written, the page itself included.
   *
   * Asked with the project in hand, so a stylesheet the browser refuses to read still
   * counts when its file can be reached — which on a page opened from disk is every
   * stylesheet it has.
   */
  styleTargets(): Array<{ value: string; label: string }> {
    const out = [{ value: DOCUMENT_TARGET, label: 'Keep in the page' }];
    for (const source of collectStyleSources(this.#project)) {
      if (source.kind !== 'link' || source.readOnly || !source.href) continue;
      out.push({ value: source.href, label: source.label });
    }
    return out;
  }

  /** What this browser and page can offer, for the UI to explain itself. */
  hostOptions(): Promise<HostAvailability> {
    return hostAvailability(this.options.sourceEndpoint, this.options.sourceToken);
  }

  /**
   * Ask the user for the folder holding this page. Must run from a user gesture.
   *
   * The picker is the grant, so there is nothing to configure and nothing to trust:
   * the page can reach exactly the folder it was handed, and only until the tab is
   * closed.
   */
  async connectProjectFolder(): Promise<boolean> {
    try {
      const host = await connectDirectory();
      // A cancelled picker is not a failure. It is also how someone backs out.
      if (!host) return false;
      return await this.attachProject(host);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : String(error), 'error');
      return false;
    }
  }

  /**
   * Connect to a dev server that offered to write files, if one did.
   *
   * Silent when there is none: this runs on mount, and a page served statically
   * should not report the absence of something it never asked for.
   */
  async connectProjectServer(): Promise<boolean> {
    const host = await connectServer(this.options.sourceEndpoint, this.options.sourceToken);
    return host ? this.attachProject(host, { quiet: true }) : false;
  }

  /**
   * Pick up a folder granted earlier in this browser, if the grant survived.
   *
   * Quiet for the same reason: a reload should not announce what it found, and a
   * grant that lapsed should leave the UI offering to reconnect rather than
   * explaining itself.
   */
  async restoreProjectFolder(): Promise<boolean> {
    const host = await restoreDirectory();
    return host ? this.attachProject(host, { quiet: true }) : false;
  }

  /**
   * Adopt any file host, including one the page brings itself.
   *
   * Public because the two built-in transports are not the only ones that make
   * sense — a project with its own dev server, or its own idea of where files live,
   * can implement `FileHost` and hand it over. It is also how this gets tested
   * without a file picker.
   */
  async attachProject(host: FileHost, options: { quiet?: boolean } = {}): Promise<boolean> {
    if (!(await host.ensureWritable())) {
      if (!options.quiet) {
        this.notify(`Cannot write to ${host.label}. The permission was refused.`, 'error');
      }
      return false;
    }
    this.#project = host;
    this.store.patch({ project: { kind: host.kind, label: host.label } });
    if (!options.quiet) {
      this.notify(`Connected to ${host.label}. Saving will write these files.`, 'success');
    }
    // Connecting changed what the editor can read, so what it has read is out of date.
    // Stylesheets the browser refused are now files on disk, and the design system in
    // them is the whole reason someone hands a folder over.
    await this.rescanStyles();
    // A plan already on screen is now answerable, so answer it.
    if (this.store.value.savePreview != null) void this.previewWritePlan();
    return true;
  }

  /**
   * Re-read the design system from every stylesheet the editor can reach.
   *
   * `scanDocument` covers the sheets the CSSOM exposes. It cannot cover the rest, and
   * "the rest" is not an edge case: open a page from disk and *every* linked
   * stylesheet is its own opaque origin, so the entire design system is invisible
   * until a folder is connected. Those files are then read here and scanned as text,
   * which is the step that was missing — the folder became readable and nothing went
   * back to look.
   *
   * Also the manual refresh in the tokens panel, so that button means the same thing
   * everywhere: re-read everything, from wherever it can be read.
   */
  async rescanStyles(): Promise<void> {
    const project = this.#project;
    if (project) await this.#mirrorUnreadableSheets(project);
    this.tokens.scanDocument();
    this.classes.scanDocument();
    /*
     * A folder makes the page's own HTML readable, and over `file://` that is the only
     * way it ever becomes readable — a fetch of the document is refused there for the
     * same origin reason the stylesheets hit. So the content baseline is worth another
     * go now: until this succeeds, script-rendered text on a page opened from disk looks
     * like ordinary text.
     */
    if (project) await this.establishContentBaseline();
  }

  /**
   * Give the page back its own CSS through a channel the editor can read.
   *
   * The files are read from disk and stood in for by `installStyleMirror`, after which
   * the sheets are ordinary readable ones: `appliedRules` finds `.sec h2`, the token
   * and class scans see the whole file, and an edit to any of it shows on screen. That
   * last part is why this is worth doing rather than just parsing the text on the side
   * — a scan can be done from text, a preview cannot.
   *
   * A sheet that could not be stood in for is still scanned from its text, so the
   * design system is picked up either way. It keeps `unpreviewable`, which is then a
   * true statement about that sheet rather than about the whole feature.
   */
  async #mirrorUnreadableSheets(project: FileHost): Promise<void> {
    // `unpreviewable` is precisely the condition worth a disk read: the CSSOM refused
    // this sheet *and* the connected project can resolve its href to a file.
    const wanted: Array<{ id: string; path: string; href: string }> = [];
    for (const source of collectStyleSources(project)) {
      if (source.unpreviewable && source.path && source.href) {
        wanted.push({ id: source.id, path: source.path, href: source.href });
      }
    }
    if (!wanted.length) return;

    // A failed read is one file the design system will not know about, not a reason to
    // abandon the others: a folder can be handed over with a stylesheet missing from it.
    const files = await Promise.all(
      wanted.map(async (file) => ({
        ...file,
        text: await project.read(file.path).catch(() => null),
      })),
    );
    // Unmounted while the reads were in flight. The text cache went with it.
    if (this.#destroyed) return;

    let changed = false;
    let unmirrored = 0;
    for (const file of files) {
      if (file.text === null) continue;
      rememberStyleText(file.id, file.text);
      changed = true;

      const link = linkElementFor(file.href);
      const mirror = link ? installStyleMirror(link, file.text) : null;
      if (mirror) continue;

      // No stand-in, so the registries have to read the text directly — there is no
      // readable sheet for `scanDocument` to walk.
      unmirrored += 1;
      this.tokens.scanCSS(file.text);
      this.classes.scanCSS(file.text);
    }

    if (unmirrored) {
      this.notify(
        `${unmirrored} stylesheet${unmirrored === 1 ? '' : 's'} could not be shown live. Edits to ` +
        `${unmirrored === 1 ? 'it' : 'them'} will still be written to file.`,
        'info',
      );
    }
    // The CSS panel's rule counts come off the remembered text, so it has to redraw
    // even when the files held no tokens or classes at all.
    if (changed) this.#bumpRegistry();
  }

  async disconnectProject(): Promise<void> {
    const host = this.#project;
    this.#project = null;
    this.store.patch({ project: null, writePlan: null });
    await host?.release();
    if (host) this.notify(`Disconnected from ${host.label}.`, 'info');
  }

  /**
   * Work out which files a save would write, without writing any of them.
   *
   * Reads from disk, so it is asynchronous and worth showing progress for. Doing it
   * as a separate step is the whole safety story: the user sees the list of files and
   * the size of each change while it is still a proposal.
   */
  async previewWritePlan(): Promise<WritePlan | null> {
    const host = this.#project;
    if (!host) return null;
    this.store.patch({ planning: true });
    try {
      const plan = await buildWritePlan(host, this.#writeSubject());
      this.store.patch({ writePlan: plan });
      return plan;
    } catch (error) {
      console.error('[html-editor-overlay] could not work out what to write', error);
      this.notify('Could not read the project files. See the console for details.', 'error');
      this.store.patch({ writePlan: null });
      return null;
    } finally {
      this.store.patch({ planning: false });
    }
  }

  #writeSubject(): WriteSubject {
    const target = this.designSystemTarget;
    return {
      records: this.handoffRecords,
      html: this.exportHTML(),
      fileName: this.options.fileName ?? 'edited-page.html',
      // Only the vocabulary this session authored. Tokens read out of the page's own
      // stylesheets are already in a file, and writing them back would turn a diff
      // into a copy of the theme.
      designSystemCSS: [this.tokens.toCSS(), this.classes.toCSS()].filter(Boolean).join('\n\n'),
      designSystemTarget: target,
      generatedElements: this.#generatedRegions().length,
    };
  }

  /**
   * How many elements on the page its own code built rather than the file declaring.
   *
   * Counted from the top of each generated region rather than per element: one write of
   * `innerHTML` produces a card, a heading and three spans, and reporting five would
   * describe the DOM rather than the thing about to be written into the markup. Only
   * regions the file comparison found — that signal comes from the file itself, which is
   * exactly the question being asked here, and it is the only one that does not depend on
   * having been watching when the render happened.
   */
  #generatedRegions(): HTMLElement[] {
    if (this.options.detectScriptContent === false) return [];
    const out: HTMLElement[] = [];
    for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
      if (!(el instanceof HTMLElement)) continue;
      const provenance = provenanceOf(el);
      if (provenance?.kind !== 'file' || !provenance.subtree) continue;
      // The outermost element of each region: a parent already listed covers this one.
      const parent = el.parentElement;
      if (parent && provenanceOf(parent)?.kind === 'file') continue;
      /*
       * Unless the user has put something inside it.
       *
       * Dropping the region would take their element with it, and an edit vanishing from the
       * file is a far worse outcome than some generated markup arriving in it. So the region
       * stays whole and the plan's warning covers it. A rare trade: it needs someone to have
       * inserted into a list the page renders.
       */
      if (el.querySelector(`[${INSERTED_ATTR}]`)) continue;
      out.push(el);
    }
    return out;
  }

  /**
   * Write the files. Returns null when there is no project to write to.
   *
   * Rebuilds the plan first rather than trusting the one on screen: between showing
   * it and pressing the button the user may have unticked a change, and the file that
   * gets written has to be the file that was described.
   */
  async writeToProject(): Promise<WriteResult | null> {
    const host = this.#project;
    if (!host) return null;
    if (!(await host.ensureWritable())) {
      this.notify(`Lost write access to ${host.label}. Connect it again.`, 'error');
      return null;
    }
    const plan = await this.previewWritePlan();
    if (!plan) return null;
    if (!plan.writes.length) {
      // Nothing to do, and nothing to correct: the files already say what the page
      // says, which is exactly the state a save is trying to reach.
      this.#markSaved();
      this.notify('Every change is already in the files.', 'info');
      return { written: [], failed: [], unplaced: [] };
    }

    const result = await applyWritePlan(host, plan);
    if (!result.failed.length) this.#markSaved();
    this.#reportWrite(result, plan);
    return result;
  }

  /**
   * The page and the files now agree, so the pending count starts again from here.
   *
   * Undo history is deliberately left alone. Writing a file is not a reason to lose
   * the ability to take it back — and taking it back is itself an unsaved change,
   * which is why the count is measured from this point rather than reset to a
   * permanent zero.
   *
   * Changes the plan could not file are folded in too. They are not on disk, but they
   * never can be — a cross-origin stylesheet does not become writable by being counted
   * forever — and the Files step names them every time it opens. Leaving them on the
   * counter would mean it never rests, which makes it useless as a signal.
   */
  #markSaved(): void {
    this.history.markSaved();
    // The ids these referred to are no longer in the pending set.
    this.#excludedChanges.clear();
    this.store.patch({ writePlan: null });
    if (this.store.value.savePreview != null) {
      this.store.patch({ savePreview: this.buildSavePrompt() });
    }
  }

  #reportWrite(result: WriteResult, plan: WritePlan): void {
    const wrote = result.written.length;
    if (result.failed.length) {
      const first = result.failed[0];
      this.notify(
        `Wrote ${wrote} of ${plan.writes.length} files. ${first.path} failed: ${first.reason}`,
        'error',
      );
      return;
    }
    // Named rather than counted when there is something left over, because "3 files
    // written" beside a change that was not is the sentence that gets misread.
    const leftOver = plan.unwritable.length + result.unplaced.length;
    if (leftOver) {
      this.notify(
        `Wrote ${wrote} file${wrote === 1 ? '' : 's'}. ${leftOver} change${leftOver === 1 ? '' : 's'
        } could not be filed and stayed in the prompt.`,
        'info',
      );
      return;
    }
    // A dev server watches what it serves, so writing the page is about to reload it.
    // Said out loud because the session is what disappears, and a reload nobody
    // predicted reads as a crash rather than as the save having worked.
    const reloads =
      this.#project?.kind === 'server' && plan.writes.some((entry) => entry.kind === 'document');
    this.notify(
      `Wrote ${wrote} file${wrote === 1 ? '' : 's'} to ${this.#project?.label ?? 'the project'}.${reloads ? ' The dev server will reload the page.' : ''
      }`,
      'success',
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Save and export                                                        */
  /* ---------------------------------------------------------------------- */

  buildSavePrompt(): string {
    return buildPrompt({
      records: this.handoffRecords,
      tokens: this.tokens.export(),
      classes: this.classes.export(),
      blocks: this.library.list(),
      tokenCSS: this.tokens.toCSS(),
      classCSS: this.classes.toCSS(),
      pageURL: location.href,
      injectedElements: [...this.#injectedElements],
    });
  }

  /**
   * Open the save dialog. Always opens, even with nothing to save.
   *
   * It used to refuse and show a toast instead, which was the wrong trade: the dialog
   * is not only a commit button. It is where the change list lives, where the design
   * system travels from, where the file plan and its destination control are, and where
   * you go to find out that a folder can be connected at all. Refusing to open it
   * because the count is zero withholds all of that to prevent a no-op, and a dialog
   * saying "nothing to save" is clearer than a toast saying the same thing anyway.
   */
  previewSave(view: EditorState['saveView'] = 'review'): void {
    this.endTextEdit(true);
    this.store.patch({ savePreview: this.buildSavePrompt(), saveView: view });
    // Work out the files while the user is reading the change list, so the primary
    // button can say how many it will write rather than finding out afterwards.
    if (this.#project) void this.previewWritePlan();
  }

  closeSavePreview(): void {
    this.store.patch({ savePreview: null });
  }

  /**
   * The page, serialized, with the overlay stripped and rule edits folded in.
   *
   * The only place `exportHTML` should be reached from. Editing a rule from the
   * cascade inspector changes the CSSOM and not the `<style>` element's text, so an
   * export that skips the reconciliation carries the value the page had before the
   * session while the screen shows the one after it. Routing every caller through
   * here is what stops that being something to remember.
   *
   * Built from what is *applied*, not from what is pending. A `<style>` element's text
   * is still the text the session started with however many times the page has been
   * saved, so the reconciliation has to replay every rule edit still in effect. Using
   * the pending set would make the first save after a rule edit write the file
   * correctly and the second one put the stale value back.
   */
  exportHTML(): string {
    return exportHTML(inlineStyleEdits(this.history.appliedRecords), this.#generatedRegions());
  }

  async save(): Promise<boolean> {
    const handoff = this.handoffRecords;
    if (!handoff.length) {
      this.notify(
        this.history.netSize
          ? 'Every change is unchecked, so there is nothing to hand off.'
          : 'Nothing has changed since the last save.',
        'info',
      );
      return false;
    }
    this.endTextEdit(true);
    this.store.patch({ saving: true });
    const payload: SavePayload = {
      prompt: this.buildSavePrompt(),
      records: handoff,
      designSystem: this.designSystem(),
      html: this.exportHTML(),
      fileName: this.options.fileName ?? 'edited-page.html',
    };

    try {
      /*
       * A connected project is what "save" means.
       *
       * It takes precedence over `onSave` deliberately, and the dialog says so —
       * its primary button reads "Write 3 files" rather than "Save changes" once a
       * project is attached. Two things have claimed to own persistence, and the one
       * the user chose in this session, by handing over a folder, is the more
       * specific answer than the one the page was configured with.
       */
      if (this.#project) {
        const result = await this.writeToProject();
        if (!result || result.failed.length) return false;
        this.store.patch({ savePreview: null, writePlan: null });
        return true;
      }

      if (this.options.onSave) {
        const result = await this.options.onSave(payload);
        if (result === false) {
          this.notify('Save was rejected by the host page.', 'error');
          return false;
        }
      } else {
        const copied = await copyToClipboard(payload.prompt);
        downloadText('apply-visual-edits.md', payload.prompt, 'text/markdown');
        this.notify(
          copied
            ? 'Prompt copied to the clipboard and downloaded.'
            : 'Prompt downloaded as apply-visual-edits.md.',
          'success',
        );
      }
      this.store.patch({ savePreview: null });
      return true;
    } catch (error) {
      console.error('[html-editor-overlay] save failed', error);
      this.notify('Save failed. See the console for details.', 'error');
      return false;
    } finally {
      this.store.patch({ saving: false });
    }
  }

  async copyPrompt(): Promise<void> {
    const ok = await copyToClipboard(this.buildSavePrompt());
    this.notify(ok ? 'Prompt copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error');
  }

  downloadPrompt(): void {
    downloadText('apply-visual-edits.md', this.buildSavePrompt(), 'text/markdown');
  }

  exportPageHTML(): void {
    downloadText(this.options.fileName ?? 'edited-page.html', this.exportHTML(), 'text/html');
    this.notify('Exported the page as HTML.', 'success');
  }

  designSystem(): DesignSystemDocument {
    return exportDesignSystem(this.tokens, this.classes, this.library, document.title || 'Design system');
  }

  exportDesignSystemFile(): void {
    const doc = this.designSystem();
    downloadText(
      `${slug(doc.name)}-design-system.json`,
      JSON.stringify(doc, null, 2),
      'application/json',
    );
    this.notify('Design system exported.', 'success');
  }

  /** This session's tokens, classes and blocks as one copy-pasteable string. */
  designSystemSeed(): Promise<string> {
    return encodeSeed(this.designSystem());
  }

  /**
   * Adopt a design system from anything the user might have in hand.
   *
   * One entry point for a seed, a JSON document and the contents of a file,
   * because from the user's side they are the same act — "use this system here" —
   * and asking them to know which one they are holding is a question with no
   * useful answer. `decodeSeed` sorts it out.
   */
  async importDesignSystemText(text: string, overwrite = false): Promise<boolean> {
    try {
      const doc = await decodeSeed(text);
      const result = importDesignSystem(doc, this, { overwrite });
      this.#bumpRevision();
      this.notify(
        `Imported ${result.tokens} tokens, ${result.classes} classes and ${result.blocks} blocks.`,
        'success',
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Import failed: ${message}`, 'error');
      return false;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Notifications                                                          */
  /* ---------------------------------------------------------------------- */

  notify(message: string, tone: ToastMessage['tone'] = 'info', action?: ToastMessage['action']): void {
    this.#toastId += 1;
    this.store.patch({ toast: { id: this.#toastId, message, tone, action } });
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#toastTimer = window.setTimeout(
      () => this.store.patch({ toast: null }),
      action ? 6000 : 3200,
    );
  }

  dismissToast(): void {
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.store.patch({ toast: null });
  }

  snapshot(): EditorSnapshotState {
    const state = this.store.value;
    return {
      mounted: !this.#destroyed,
      version: VERSION,
      editing: state.editing,
      dirty: this.history.netSize > 0,
      selected: state.selected
        ? {
          tag: state.selected.tagName.toLowerCase(),
          label: labelFor(state.selected),
          selector: selectorFor(state.selected),
        }
        : null,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      changes: this.history.netSize,
      dockOpen: state.dockOpen,
      dockTab: state.dockTab,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Page event wiring                                                      */
  /* ---------------------------------------------------------------------- */

  #bindPageEvents(): void {
    const on = <K extends keyof DocumentEventMap>(
      target: Document | Window,
      type: K,
      handler: (event: DocumentEventMap[K]) => void,
      capture = true,
    ): void => {
      const listener = handler as EventListener;
      target.addEventListener(type, listener, capture);
      this.#listeners.push(() => target.removeEventListener(type, listener, capture));
    };

    on(document, 'pointerover', (event) => {
      if (!this.editing || this.store.value.drag) return;
      this.hover(selectableFromEvent(event));
    });

    on(document, 'pointerdown', (event) => {
      if (!this.editing) return;
      /*
       * A pointerdown outside the active text edit ends it, matching how every other
       * inline editor behaves — and that includes a press inside the panel.
       *
       * Exempting the whole of the chrome, as this used to, left the page and the
       * panel both live: clicking into a code editor moved focus and the caret into
       * the textarea while the page element kept its `contenteditable` and the engine
       * kept treating a text edit as in progress, so Escape and Mod+Z went to the page
       * instead of to the editor under the cursor. Only the text toolbar is genuinely
       * part of the edit it acts on, so only the text toolbar is exempt.
       */
      const editing = this.store.value.textEditing;
      if (editing) {
        const path = event.composedPath();
        if (!path.includes(editing) && !path.some(isTextEditChrome)) this.endTextEdit(true);
      }
    });

    /**
     * One click selects; the next click on the same element starts editing.
     *
     * This replaces a separate double-click path. Two single clicks and a
     * double-click now do the same thing, which is what people expect, and it
     * removes the guesswork about which gesture the editor was waiting for. The
     * caret lands where the pointer was, not at the end of the text.
     */
    on(document, 'click', (event) => {
      if (!this.editing) return;
      if (isOverlayEvent(event)) return;
      const el = selectableFromEvent(event);
      if (!el) return;
      if (this.store.value.textEditing === el) return;

      const native = isNativeInputEvent(event);
      if (!native) {
        event.preventDefault();
        event.stopPropagation();
      }

      if (this.store.value.selected === el && !native) {
        this.beginTextEdit(el, { x: event.clientX, y: event.clientY });
        return;
      }
      this.select(el);
    });

    on(document, 'keydown', (event) => {
      // Tab first, and only while editing: it decides *where* the next keystroke
      // will land, which every other binding then depends on.
      if (this.store.value.editing && containTab(event)) return;
      handleKeyDown(this, event);
    });

    const geometry = (): void => this.#bumpGeometry();
    on(window, 'scroll', geometry as (event: Event) => void);
    on(window, 'resize', geometry as (event: Event) => void);

    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!this.history.netSize) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    this.#listeners.push(() => window.removeEventListener('beforeunload', beforeUnload));
  }

  /**
   * Watch the page for changes that invalidate what the overlay is showing.
   *
   * A framework re-render can replace the selected node entirely; without this
   * the outline would sit over a detached element. Geometry is also re-measured
   * on any layout-affecting mutation, since scroll and resize alone do not catch
   * an animation or a font finishing loading.
   */
  #observePage(): void {
    const mutation = new MutationObserver((records) => {
      if (!this.editing) return;

      // Ignore anything the overlay itself caused. Without this, a render that
      // writes to the page — even just the host's own style attribute — feeds
      // back into a store update and re-renders, forever. MutationObserver
      // callbacks are microtasks, so such a loop never yields and the tab locks
      // up rather than merely running hot.
      const relevant = records.filter((entry) => !isSelfInflicted(entry));
      if (!relevant.length) return;

      const selected = this.store.value.selected;
      if (selected && !selected.isConnected) {
        this.store.patch({ selected: null, hovered: null, textEditing: null });
        return;
      }
      const touchesSelection =
        selected != null &&
        relevant.some(
          (entry) =>
            entry.target === selected ||
            selected.contains(entry.target) ||
            entry.target.contains(selected),
        );
      if (touchesSelection) this.#bumpRevision();
      this.#bumpGeometry();
    });
    mutation.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['class', 'style', 'id', 'src', 'href', 'alt', 'hidden'],
    });
    this.#observers.push(mutation);

    if (typeof ResizeObserver !== 'undefined') {
      const resize = new ResizeObserver(() => this.#bumpGeometry());
      resize.observe(document.documentElement);
      this.#observers.push(resize);
      this.#selectionResize = new ResizeObserver(() => this.#bumpGeometry());
      this.#observers.push(this.#selectionResize);
    }
  }

  #selectionResize?: ResizeObserver;

  #observeSelected(el: HTMLElement | null): void {
    if (!this.#selectionResize) return;
    this.#selectionResize.disconnect();
    if (el) this.#selectionResize.observe(el);
  }

  /** Coalesce geometry invalidation to one store write per frame. */
  #bumpGeometry(): void {
    if (this.#geometryFrame) return;
    this.#geometryFrame = requestAnimationFrame(() => {
      this.#geometryFrame = 0;
      this.store.patch({ geometry: this.store.value.geometry + 1 });
    });
  }

  /**
   * Re-measure on every frame of a reflow glide.
   *
   * A structural edit is instant in the DOM but takes the length of a FLIP to
   * land on screen: the moved element is already in its new place, drawn back at
   * its old one under a transform that unwinds over ~190ms. Every piece of chrome
   * is positioned from `getBoundingClientRect`, which reports that transformed
   * box — so one invalidation after the edit measures the *start* of the glide and
   * pins the outline there. During a drag the pointer hid this, because each
   * pointer move re-rendered the layer anyway; on ⇧-arrow nothing else was moving,
   * so the outline stayed behind until an unrelated scroll or mouse twitch
   * happened to refresh it.
   *
   * Following the animations rather than a timer means the loop lasts exactly as
   * long as the motion, ends on the resting position, and stops dead when the page
   * is still. A second move mid-glide joins the loop already running instead of
   * starting a competing one.
   */
  #followReflow(animations: Animation[]): void {
    for (const animation of animations) this.#glides.add(animation);
    if (!this.#glides.size || this.#glideFrame) return;

    const tick = (): void => {
      // Animations are advanced before rAF callbacks run, so anything no longer
      // running has already painted its final frame. Cancelled ones — which is
      // what chaining moves does to the previous glide — report `idle` and drop
      // out here too.
      for (const animation of this.#glides) {
        if (animation.playState !== 'running') this.#glides.delete(animation);
      }
      this.store.patch({ geometry: this.store.value.geometry + 1 });
      this.#glideFrame = this.#glides.size ? requestAnimationFrame(tick) : 0;
    };
    this.#glideFrame = requestAnimationFrame(tick);
  }

  #bumpRevision(): void {
    this.store.patch({ revision: this.store.value.revision + 1 });
    this.#bumpGeometry();
  }

  #bumpRegistry(): void {
    this.store.patch({ registry: this.store.value.registry + 1 });
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The `<link>` that loaded a stylesheet, found by the URL it resolved to.
 *
 * Matched on `link.href` rather than the attribute, because that is the property the
 * browser resolved and the same value `sheet.href` reports — comparing the raw
 * attribute would miss `./theme.css` against the absolute URL the sheet carries.
 */
function linkElementFor(href: string): HTMLLinkElement | null {
  for (const link of Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))) {
    if (link instanceof HTMLLinkElement && link.href === href) return link;
  }
  return null;
}

/** Enough of a string to recognise in a sentence, and no more. */
function clip(value: string, limit = 48): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

function isOverlayChrome(node: EventTarget): boolean {
  return node instanceof Element && node.tagName.toLowerCase() === 'html-editor-overlay';
}

/**
 * True for the chrome that belongs to an inline text edit rather than sitting beside
 * it.
 *
 * The formatting toolbar operates on the live selection, so pressing Bold cannot be
 * allowed to end the edit it is formatting. Everything else in the overlay is a
 * different place to be working, and pressing there means the text edit is over.
 */
function isTextEditChrome(node: EventTarget): boolean {
  return node instanceof Element && node.tagName.toLowerCase() === 'heo-text-toolbar';
}

/**
 * True when a mutation record describes a change the overlay made to the page.
 *
 * Three sources: the overlay host and its subtree, the stylesheets the token and
 * class editors generate, and the `contenteditable` bookkeeping around inline
 * text editing.
 */
function isSelfInflicted(record: MutationRecord): boolean {
  if (isEditorOwned(record.target)) return true;
  if (record.type === 'attributes') {
    const name = record.attributeName ?? '';
    if (name.startsWith('data-heo-') || name === 'contenteditable') return true;
  }

  if (record.type === 'childList') {
    const touched = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    return touched.length > 0 && touched.every(isEditorOwned);
  }
  return false;
}

function isEditorOwned(node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element) {
      const tag = current.tagName.toLowerCase();
      if (tag === HOST_TAG) return true;
      if (current.hasAttribute(IGNORE_ATTR)) return true;
      if (current.hasAttribute('data-heo-generated')) return true;
      // The throwaway `<style>` the CSS parsing helpers put in the head and take back
      // out. It is in the document for less than a tick and belongs to the editor, so
      // counting it as a page change would invalidate geometry on every keystroke in
      // the CSS panel and on every stylesheet the design system reads.
      if (current.hasAttribute('data-heo-internal')) return true;
    }
    current = current.parentNode;
  }
  return false;
}

function isOverlayEvent(event: Event): boolean {
  return event.composedPath().some(isOverlayChrome);
}

function parseArray<T>(value: T[] | string): T[] {
  if (typeof value !== 'string') return Array.isArray(value) ? value : [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'design'
  );
}

/** Re-exported so consumers importing from the engine keep working. */
export { matchesShortcut };

/**
 * A block name derived from the element, so the dialog opens with something
 * recognisable rather than an empty field.
 */
function suggestBlockName(el: HTMLElement): string {
  const fromClass = Array.from(el.classList).find((name) => !name.startsWith('heo-'));
  const base = fromClass ?? el.id ?? el.tagName.toLowerCase();
  const words = base.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A collapsed range at a viewport point.
 *
 * Two APIs do this: the standard `caretPositionFromPoint` and the older
 * `caretRangeFromPoint`. Browsers are split, so both are attempted.
 */
function rangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  try {
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position?.offsetNode) {
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }
  } catch {
    /* fall through to the legacy API */
  }
  try {
    return doc.caretRangeFromPoint?.(x, y) ?? null;
  } catch {
    return null;
  }
}
