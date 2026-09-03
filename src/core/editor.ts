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
  BLOCK_ATTR,
  CLASS_STYLE_ID,
  DRAGGING_ATTR,
  DRAG_TIMING,
  EDIT_DISCARDED_EVENT,
  HOST_TAG,
  IGNORE_ATTR,
  INSERTED_ATTR,
  RULE_STYLE_ID,
  SEED_SCRIPT_SELECTOR,
  TOKEN_STYLE_ID,
  VERSION,
} from './constants.js';
import { appliedRules, cascadedDeclarations, inlineDeclarations } from './css.js';
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
  designSystemExtent,
  designSystemParts,
  downloadBlob,
  downloadText,
  exportDesignSystem,
  exportHTML,
  importDesignSystem,
  pickTextFile,
  restoreDesignSystem,
  snapshotDesignSystem,
  type DesignSystemParts,
  type DesignSystemScope,
  type ImportResult,
} from './design-system.js';
import { containTab } from './focus.js';
import { History, nextChangeId, type Command } from './history.js';
import { handleKeyDown, matchesShortcut } from './keymap.js';
import {
  applyBlockProps,
  BlockLibrary,
  blockFromSource,
  blockPropRows,
  mergeInstanceText,
  normalizeCustomElementTag,
  type BlockPropRow,
} from './library.js';
import {
  cleanMarkup,
  duplicateElement,
  insertHTML,
  insertNodes,
  INSERT_POSITION_LABELS,
  moveCommandFromOrigin,
  moveElement,
  removeElement,
  replaceElement,
  retagElement,
  sameStructure,
  setAttribute,
  setClassList,
  setInnerHTML,
  setStyleProperties,
  setStyleProperty,
  tidyStyleAttribute,
  unwrapElement,
  wrapElement,
  type InsertPosition,
  elementKey,
} from './mutations.js';
import { buildPrompt } from './prompt.js';
import { formatHTML, previewMarkup, sanitizeFragment } from './sanitize.js';
import {
  connectDirectory,
  connectServer,
  hostAvailability,
  pickSaveTarget,
  restoreDirectory,
  savePickerAvailable,
  writeSaveTarget,
  type FileHost,
  type FileHostKind,
  type HostAvailability,
  type SaveChoice,
  documentPath,
} from './file-host.js';
import {
  sourceTargetOf,
  sourceWindow,
  writeSourceEdit,
  type SourceTarget,
  type SourceWindow,
} from './js-edit.js';
import {
  angleOf,
  declaredRotation,
  linearOf,
  originOf,
  pinnedOffsets,
  readSnapshot,
  resolvesOffsets,
  stepFor,
  untransformedBox,
  TRANSFORM_LABEL,
  type Box,
  type Linear,
  type Point,
  type ResizeHandle,
  type TransformMode,
  type TransformSnapshot,
} from './transform.js';
import { installStyleMirror, releaseStyleMirrors } from './mirror.js';
import { modalOpen } from './modal.js';
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
  forgetProvenance,
} from './provenance.js';
import { startEdgeScroll } from './autoscroll.js';
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
  patchDocumentSource,
} from './writeback.js';
import {
  buildBundle,
  bundleBlob,
  bundleName,
  canArchive,
  DEFAULT_BUNDLE_OPTIONS,
  exportBase,
  extensionOf,
  planCanArchive,
  planIsStale,
  renameBundle,
  surveyBundle,
  type BundleOptions,
  type BundlePackaging,
  type BundlePlan,
  type BundleSubject,
  type BundleSurvey,
} from './bundle.js';
import { RuleRegistry } from './rules.js';
import { decodeSeed, decodeSeedSync, encodeSeed, encodeSeedSync } from './seed.js';
import {
  claimEvent,
  listen,
  setShieldPolicy,
  shieldOwnedEvents,
  unlisten,
  type EventFamily,
} from './shield.js';
import { ruleSelectorFor, safeSelector } from './selectors.js';
import { Store } from './store.js';
import { TokenRegistry } from './tokens.js';
import type {
  BlockKind,
  ChangeRecord,
  DesignClass,
  DesignRule,
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
 * Arbitrary markup on its way into the page.
 *
 * The library offers assembled patterns and the catalogue offers bare tags; between them sits
 * everything else — a snippet from a component library, a block of markup from somewhere else
 * in the project, an embed someone was given. This is that route, and it is the same insert
 * underneath: sanitised, positioned, recorded, undoable.
 */
export interface HtmlPaste {
  /** Where it lands. Changeable from inside the dialog. */
  anchor: InsertAnchor;
  /** What the user has written so far. */
  draft: string;
  /** Why it cannot be inserted yet, when it cannot. */
  error: string;
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
  /**
   * Whether saving should also rebuild the copies already placed in the page.
   *
   * Off by default, and that default is a judgement rather than laziness. A placed block is
   * content: it has been written into, restyled, had things added to it. Rebuilding it from
   * the template is exactly the right thing to want and exactly the wrong thing to do without
   * being asked, because everything done to it since goes. So the dialog offers it with the
   * count in view, and leaving it off is answered by a toast that offers it again — which
   * means declining here is not a dead end.
   *
   * Only ever consulted when editing an existing block. A block being created for the first
   * time has nothing in the page to apply to.
   */
  applyToInstances: boolean;
  error: string;
}

export type Extraction = ClassExtraction | BlockExtraction;

/**
 * A question that has to be answered before something irreversible happens.
 *
 * Deliberately not a `window.confirm`, and deliberately not per-feature. The editor already
 * owns a modal layer and a visual language, and a native dialog would be the one surface in
 * the product that looks like 1997 and cannot say which nine elements are about to change.
 *
 * Held on the store like every other dialog, so the same rules apply for free: the page goes
 * inert behind it, Escape cancels, and only one can be open.
 *
 * The bar for using it is narrow on purpose. Almost everything here is undoable, and an undo
 * stack is a better answer than a prompt — a prompt in front of a reversible action is a tax
 * on the ninety-nine times the user meant it. It is for the cases where the cost of being
 * wrong is high enough that the user should look at the number first.
 */
export interface ConfirmRequest {
  title: string;
  /** The consequence, in a sentence. */
  message: string;
  /** What is at stake, when a count or a list makes it concrete. */
  detail?: string;
  /** Names the action rather than saying "OK", so the button is the answer to the title. */
  confirmLabel: string;
  /** `danger` for something that destroys, `warn` for something that overwrites. */
  tone: 'danger' | 'warn';
  /** Whether undo will get it back, which is the most useful thing the dialog can say. */
  reversible?: boolean;
  run: () => void;
}

/**
 * A handle drag in progress, as the chrome needs to see it.
 *
 * Deliberately not a share of `drag`. That slice means "a reorder is happening", and a great deal
 * hangs off it: the element goes translucent and unclickable, the layer dashes its outline and
 * hides its own controls, a chip follows the pointer, hover is suppressed, Escape cancels a
 * reorder. A resize is none of those things — the element stays solid and where it is, and what
 * the user needs to see is the number they are producing.
 */
/**
 * Where one part of the design system is kept, for the save dialog's status.
 *
 * `state` is deliberately four values rather than a boolean. "Nothing to keep" and "kept nowhere"
 * look the same in a checkbox and mean opposite things to the person reading it: one is fine and
 * the other is work about to be lost.
 */
export interface DesignSystemPart {
  part: 'tokens' | 'classes' | 'rules' | 'library';
  count: number;
  /** A project-relative path, a stylesheet label, or `'this page'`. */
  where: string;
  state: 'filed' | 'unfiled' | 'empty' | 'removing';
}

export interface TransformState {
  element: HTMLElement;
  mode: TransformMode;
  /** Which handle, for a resize. Null for a move or a rotate. */
  handle: ResizeHandle | null;
  /** The values being written, live, for the badge to show while the pointer moves. */
  readout: string;
  /** What a held modifier would do, so the shortcut is discoverable mid-gesture. */
  hint: string;
}

/** An element, and the library block it is an instance of. */
export interface BlockInstance {
  block: LibraryBlock;
  /** The props it was built with, or the block's defaults when the values were lost. */
  values: Record<string, string>;
  /**
   * True when the overlay put this element in the page, rather than the page having
   * come with it and the user having saved it as a block afterwards.
   *
   * Only ever wording: "Inserted as" against "Saved as". Both are instances and both
   * sync the same way.
   */
  placed: boolean;
}

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
    applyToInstances: false,
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
  /**
   * A blob of HTML being pasted in, held while the user writes it.
   *
   * Deliberately not part of `insertAnchor`. The insert menu exists only while that is set,
   * and committing clears it — so a dialog owned by the menu would be torn down by its own
   * success. This holds its own copy of where the markup is going, which also lets the
   * position be changed from inside the dialog without reopening anything.
   */
  htmlPaste: HtmlPaste | null;
  /**
   * How much of the design system a save writes.
   *
   * Separate from where it goes. An imported system is a vocabulary and a page usually speaks
   * a fraction of it, so writing the lot into a single-file export ships somebody's whole
   * theme alongside a page that used two colours of it.
   */
  designSystemScope: DesignSystemScope;
  /**
   * Whether a saved page carries the block library with it.
   *
   * Separate from `designSystemScope`, which is about CSS: tokens, classes and rules reach a
   * file as stylesheet text, and blocks cannot — a block is markup plus props plus, sometimes,
   * a module, so the only thing that can carry one is the seed format. Different payload,
   * different destination, different question.
   *
   * Off by default. Ticking it adds a script tag to somebody's HTML, which is a visible
   * addition to a file they own and not something to do on their behalf.
   */
  saveBlockLibrary: boolean;
  /**
   * Take the library out of the page on the next save, rather than leaving or updating it.
   *
   * The third state the tick cannot hold. Unticking says "do not update it this time", which has
   * to leave a library already in the file alone — otherwise every save with the box clear would
   * quietly delete work. So getting rid of it is a separate, deliberate act, and this is how it
   * is remembered between asking for it and the save that carries it out.
   */
  removeBlockLibrary: boolean;
  extraction: Extraction | null;
  /** A destructive action waiting to be confirmed. */
  confirm: ConfirmRequest | null;
  /** A resize, move or rotate being dragged out on the page. */
  transform: TransformState | null;
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
  /**
   * How the page should be written out when there is no project to write into.
   *
   * Two decisions: which kinds of asset to save, and whether the result is one self-contained
   * file or a folder of them. Held in the store rather than in the dialog so it survives the
   * dialog being closed and reopened — someone who chose not to bring their webfonts once
   * meant it.
   */
  bundleOptions: BundleOptions;
  /** The export the current choices would produce, once it has been built. */
  bundlePlan: BundlePlan | null;
  /** True while it is being built, which means reading every asset. */
  bundling: boolean;
  /**
   * What to call the file, without its extension, when the page's own name is not it.
   *
   * Null means the name comes from `options.fileName`, which is normally the file the page
   * was opened from — the right default, since the usual intent is to write back a copy of
   * the same page. Someone keeping the original alongside a variant needs to say otherwise,
   * and that is what this holds. The extension is not theirs to choose: it follows the
   * shape, and a `.zip` named `.html` would be a file that does not open.
   */
  exportName: string | null;
  /**
   * Whether to ask where the file goes rather than sending it to the download folder.
   *
   * Only meaningful where the browser has a save picker. On by default there, because
   * "where did that go" is a worse first experience than one extra dialog, and because a
   * picker is also the only way to overwrite the file the page was opened from.
   */
  exportPrompt: boolean;
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
  /**
   * CSS rules the editor owns: a selector and the declarations it sets.
   *
   * The vocabulary neither of the other two can express. A class has to be put on an
   * element by hand, so "every `h2` on this page" or "a `p` directly inside `.prose`"
   * had nowhere to live except the CSS panel's raw text.
   */
  readonly rules = new RuleRegistry();
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
  /** The edited element's text as the edit began, for `restorePlainSpaces`. */
  #textEditText: string | null = null;
  /**
   * The element pasted into, and its text a moment before, held until the paste lands.
   *
   * A paste is the one edit that arrives as a block, so it is also the one worth cleaning
   * up on its own rather than waiting for the commit: the region it touched is known
   * exactly, which is the narrowest the whitespace fix can ever be scoped.
   */
  #pastedInto: { el: HTMLElement; text: string } | null = null;
  /**
   * Whether the press now in progress landed inside a live text edit.
   *
   * Which is to say: whether a sweep through some words is underway. Recorded on
   * `pointerdown` because that is the only moment it is knowable — by the time the release
   * arrives the pointer may be anywhere, and often is, since selecting to the end of a
   * paragraph means dragging past its edge.
   */
  #pressBeganInTextEdit = false;
  #injectedElements = new Set<string>();
  #destroyed = false;
  /** Which export build is the current one, so an overtaken one stays quiet. */
  #bundleRun = 0;
  /** The pending rebuild after an option change, so a burst of clicks builds once. */
  #bundleTimer: ReturnType<typeof setTimeout> | null = null;
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
  /**
   * Declarations a registry rule had before its live preview started.
   *
   * Its own field rather than a share of `#rulePreview`, which is about a live
   * `CSSStyleRule` in one of the page's sheets. These two are different objects reached
   * from different panels, and a single slot would let the cascade inspector's
   * exploration be reverted by the tokens panel's — putting a value back onto the wrong
   * rule.
   */
  #designRulePreview: { selector: string; declarations: Record<string, string> } | null = null;
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
      htmlPaste: null,
      // Everything, by default: leaving something out is the deliberate act, and a save that
      // quietly dropped part of the vocabulary would be the worse surprise.
      designSystemScope: 'all',
      // Unlike the design system's extent, off: this one adds a tag to the markup rather than
      // deciding how much CSS an existing block carries.
      saveBlockLibrary: false,
      removeBlockLibrary: false,
      extraction: null,
      confirm: null,
      transform: null,
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
      bundleOptions: { ...DEFAULT_BUNDLE_OPTIONS },
      bundlePlan: null,
      bundling: false,
      exportName: null,
      // Nothing to ask with means nothing to ask, and a switch that does nothing is worse
      // than no switch: the dialog reads this to decide whether to offer the choice at all.
      exportPrompt: savePickerAvailable(),
      sourceEdit: null,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                              */
  /* ---------------------------------------------------------------------- */

  start(): void {
    this.tokens.scanDocument();
    this.classes.scanDocument();
    this.rules.scanDocument();
    /*
     * The page's own seed first, then whatever this mount was configured with.
     *
     * That order keeps configuration the more specific answer — a `data-seed` attribute or a
     * `designSystem` plugin option still wins a collision — while a library saved into the page
     * survives, because a seed carrying only blocks cannot be overwritten by options carrying
     * only tokens.
     */
    const carriesSeed = this.#seedFromDocument();
    this.#seedFromOptions();
    /*
     * A page that already carries its library keeps carrying it.
     *
     * The tick defaults off because writing a script into someone's markup should be asked for.
     * But once it is in the file the asking is done, and leaving the default off meant the next
     * save silently stopped updating it: add a block, save, and the file still held the previous
     * library with no indication that the new one had been left behind. Opting in is a decision
     * about this page, so the page is where it is remembered.
     */
    if (carriesSeed) this.store.patch({ saveBlockLibrary: true });

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
      this.rules.onChange(() => this.#bumpRegistry()),
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
    // A scheduled export rebuild would otherwise fire against a torn-down engine.
    if (this.#bundleTimer !== null) {
      clearTimeout(this.#bundleTimer);
      this.#bundleTimer = null;
    }
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
    this.rules.destroy();
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

  /**
   * Apply the seed the page carries in its own markup, if it has one.
   *
   * This is what makes "write the library into the page" mean anything: the save puts a
   * `<script type="application/heo-seed">` into the file, and this reads it back on the next
   * load. Without it the tag sat in the file being ignored, so a library authored in one session
   * still died with it — the save worked and looked like it worked, and the reload silently
   * dropped everything.
   *
   * It belongs to the engine rather than to the script-tag integration, and that is the actual
   * bug being fixed. Reading it there made it conditional on how the overlay was mounted: the
   * loader-tag path found it, while the Vite plugin — which mounts from a virtual module, with no
   * loader tag anywhere — never looked. A seed in the document is a fact about the document, and
   * every mount path shares the document.
   *
   * Reported rather than swallowed. A seed that will not parse is usually one that has been
   * hand-edited, and silence would leave someone staring at a file that plainly contains their
   * library, wondering why it is not there.
   */
  #seedFromDocument(): boolean {
    const block = document.querySelector(SEED_SCRIPT_SELECTOR);
    const text = block?.textContent?.trim();
    if (!text) return false;
    try {
      this.#applySeed(text);
      return true;
    } catch (error) {
      console.error('[html-editor-overlay] could not read the seed in this page', error);
      this.notify('This page carries a design system the editor could not read.', 'error');
      return false;
    }
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
    const start = box.top;
    const end = box.top + box.height;
    const band = innerHeight - margin * 2;

    /*
     * An element too big to fit on screen is left where it is once enough of it is on screen.
     *
     * The test below asks whether the element's *end* is past the fold, which is true of every
     * element taller than the window — so selecting a `<main>` or a section wrapper always
     * counted as off screen, and the answer, centring, means scrolling to the middle of it.
     * Clicking a wrapper around what you were reading therefore threw you into the middle of
     * the page, and arrowing up to a parent did the same. Neither had anything to reveal.
     *
     * Half a screenful is the bar for "enough". Something has to be, because an element can
     * technically intersect the viewport by a single pixel of its final line, and that is a
     * case where scrolling really does help; sitting inside a tall element, which is what this
     * is here for, clears the bar by a wide margin.
     */
    if (box.height > band) {
      const onScreen = Math.min(end, innerHeight) - Math.max(start, 0);
      if (onScreen >= innerHeight / 2) return;
    }

    const offTop = start < margin;
    const offBottom = end > innerHeight - margin;
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

    /*
     * Taking an element out of flow keeps it where it is.
     *
     * Measured before the declaration lands, because afterwards the element has already moved and
     * there is nothing left to measure. Committed as one entry with the position itself, so undo
     * puts back the whole conversion rather than unpinning it and leaving it somewhere new.
     */
    const pin = property === 'position' ? this.#pinOffsets(el, value) : null;
    if (pin) {
      for (const pinned of Object.keys(pin)) this.#captureBaseline(el, pinned);
      this.history.commit(
        setStyleProperties(el, { [property]: value, ...pin }, `Position ${labelFor(el)}`),
      );
    } else {
      this.history.commit(setStyleProperty(el, property, value));
    }
    this.#bumpRevision();
  }

  /**
   * The offsets to write alongside a switch to `absolute` or `fixed`, if any are needed.
   *
   * Only on the way out of the flow the element is currently in. Re-picking the position it
   * already has changes nothing and should not rewrite its offsets, and `static`, `relative` and
   * `sticky` all leave the element where the flow put it, so none of them need pinning.
   */
  #pinOffsets(el: HTMLElement, value: string): Record<string, string> | null {
    const scheme = value.trim();
    if (scheme !== 'absolute' && scheme !== 'fixed') return null;
    if (getComputedStyle(el).position === scheme) return null;

    const cascade = cascadedDeclarations(appliedRules(el));
    const pin = pinnedOffsets(
      el,
      scheme,
      (property) => this.inlineStyle(property, el) || cascade.get(property)?.value || '',
    );
    return Object.keys(pin).length ? pin : null;
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
    const rulePreview = this.#designRulePreview;
    this.#designRulePreview = null;
    if (rulePreview) {
      const entry = this.rules.get(rulePreview.selector);
      if (entry) this.rules.upsert({ ...entry, declarations: rulePreview.declarations });
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

  /* ---------------------------------------------------------------------- */
  /* CSS rules the editor owns                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * The declarations a registry rule had before its live preview started.
   *
   * Same contract as `classPreviewTarget`, and needed for the same reason: a preview is
   * written into the registry the editor renders from, so a field reading the registry
   * back would be told its own draft had already been committed — after which
   * committing compares equal and does nothing, and looking away reverts the preview,
   * losing the edit.
   */
  get designRulePreviewTarget(): { selector: string; declarations: Record<string, string> } | null {
    const preview = this.#designRulePreview;
    return preview
      ? { selector: preview.selector, declarations: { ...preview.declarations } }
      : null;
  }

  /**
   * Create a rule, or open the one that already has this selector.
   *
   * Created empty. There is nothing to take declarations from — the point of a rule is
   * that it is written rather than extracted — so the useful next step is the property
   * editor, and the caller expands it.
   *
   * Returns the selector as stored, which is not always the selector passed in:
   * whitespace is normalised so `h2   >  p` and `h2 > p` are one rule. Returns null when
   * the selector is not one the browser accepts, having said so.
   */
  createDesignRule(rawSelector: string, declarations: Record<string, string> = {}): string | null {
    const selector = safeSelector(rawSelector);
    if (!selector) {
      const shown = String(rawSelector ?? '').trim();
      this.notify(
        shown ? `"${shown}" is not a CSS selector the browser accepts.` : 'Type a selector first.',
        'error',
      );
      return null;
    }
    if (this.rules.has(selector)) {
      this.notify(`${selector} already has a rule — opening it.`, 'info');
      return selector;
    }

    const entry: DesignRule = { selector, declarations: { ...declarations }, origin: 'user' };
    this.history.commit({
      label: `Add rule ${selector}`,
      record: {
        id: nextChangeId(),
        kind: 'token-rule',
        summary: `Add CSS rule ${selector}`,
        target: selector,
        after: Object.entries(entry.declarations)
          .map(([property, value]) => `${property}: ${value}`)
          .join('; '),
        detail: { selector },
        at: Date.now(),
      },
      apply: () => this.rules.upsert(entry),
      revert: () => {
        this.rules.remove(selector);
      },
    });
    this.#bumpRevision();
    return selector;
  }

  /**
   * Live preview for a rule declaration.
   *
   * Writes straight into the managed sheet rather than through the history-backed
   * setter, so dragging a colour on `h2` recolours every heading as it moves. The
   * registry holds the authoritative value, so the next commit or a cancel puts things
   * right; there is nothing to unwind.
   */
  previewDesignRuleDeclaration(selector: string, property: string, value: string): void {
    const entry = this.rules.get(selector);
    if (!entry) return;
    this.#designRulePreview ??= {
      selector: entry.selector,
      declarations: { ...entry.declarations },
    };
    this.rules.setDeclaration(entry.selector, property, value);
  }

  /** Change one declaration on a rule. An empty value keeps the row and drops the CSS. */
  setDesignRuleDeclaration(selector: string, property: string, value: string): void {
    const live = this.rules.get(selector);
    if (!live) return;
    const key = live.selector;
    // A live preview has already written into the registry, so the pre-edit state has to
    // come from the snapshot taken when the preview began — otherwise undo would return
    // to the last frame of the exploration rather than to the start.
    const preview = this.#designRulePreview?.selector === key ? this.#designRulePreview : null;
    this.#designRulePreview = null;
    const before: DesignRule = preview ? { ...live, declarations: preview.declarations } : live;
    const snapshot: DesignRule = { ...before, declarations: { ...before.declarations } };

    this.history.commit({
      label: `Set ${property} on ${key}`,
      mergeKey: `rule:${key}:${property}`,
      subject: `rule-decl:${key}:${property}`,
      record: {
        id: nextChangeId(),
        kind: 'token-rule',
        summary: `Set ${property} to ${value || '(removed)'} on ${key}`,
        target: key,
        before: snapshot.declarations[property],
        after: value || undefined,
        detail: { selector: key, property, value },
        at: Date.now(),
      },
      apply: () => {
        this.rules.setDeclaration(key, property, value);
      },
      revert: () => this.rules.upsert(snapshot),
    });
    this.#bumpRevision();
  }

  /** Drop a declaration from a rule, name and all. */
  removeDesignRuleDeclaration(selector: string, property: string): void {
    const entry = this.rules.get(selector);
    if (!entry) return;
    const key = entry.selector;
    this.#designRulePreview = null;
    const snapshot: DesignRule = { ...entry, declarations: { ...entry.declarations } };
    this.history.commit({
      label: `Remove ${property} from ${key}`,
      subject: `rule-decl:${key}:${property}`,
      record: {
        id: nextChangeId(),
        kind: 'token-rule',
        summary: `Remove ${property} from ${key}`,
        target: key,
        before: snapshot.declarations[property],
        detail: { selector: key, property },
        at: Date.now(),
      },
      apply: () => {
        this.rules.removeDeclaration(key, property);
      },
      revert: () => this.rules.upsert(snapshot),
    });
    this.#bumpRevision();
  }

  /**
   * Point a rule at a different selector, keeping its declarations.
   *
   * Its own operation rather than delete-plus-create, because that pair would move the
   * rule to the end of the sheet and silently change which of two equally specific rules
   * wins. Returns the stored selector, or null when the rename was refused.
   */
  renameDesignRule(from: string, to: string): string | null {
    const entry = this.rules.get(from);
    if (!entry) return null;
    const previous = entry.selector;
    const next = safeSelector(to);
    if (!next) {
      this.notify(`"${String(to ?? '').trim()}" is not a CSS selector the browser accepts.`, 'error');
      return null;
    }
    if (next === previous) return previous;
    if (this.rules.has(next)) {
      this.notify(`${next} already has a rule.`, 'error');
      return null;
    }
    /*
     * A rule that came out of the page's own CSS cannot be retargeted from here.
     *
     * Editing its declarations produces an override, which is a coherent thing to write.
     * Changing its selector is not: the rule in the file would go on applying and the new
     * selector would apply as well, so one move would leave two rules. Said plainly rather
     * than refused silently, and the way to actually do it is named.
     */
    if (entry.origin === 'stylesheet') {
      this.notify(
        `${previous} comes from ${this.rules.sourceOf(previous) ?? 'the page’s CSS'}, so its ` +
        'selector cannot be changed from here — the original would keep applying. Edit that ' +
        'rule in the Styles panel, or add a new rule for the selector you want.',
        'warn',
      );
      return null;
    }

    this.#designRulePreview = null;
    this.history.commit({
      label: `Retarget ${previous}`,
      subject: `rule-selector:${previous}`,
      record: {
        id: nextChangeId(),
        kind: 'token-rule',
        summary: `Change the selector ${previous} to ${next}`,
        target: next,
        before: previous,
        after: next,
        detail: { selector: next, previousSelector: previous },
        at: Date.now(),
      },
      apply: () => {
        this.rules.rename(previous, next);
      },
      revert: () => {
        this.rules.rename(next, previous);
      },
    });
    this.#bumpRevision();
    return next;
  }

  /** Delete a rule, keeping it on the undo stack. */
  removeDesignRule(selector: string): void {
    const entry = this.rules.get(selector);
    if (!entry) return;
    const key = entry.selector;
    /*
     * Only rules this session owns can be deleted, and that is not a limitation to hide.
     *
     * Taking a scanned rule out of the registry would not take it out of the stylesheet it
     * was read from — it would come straight back on the next scan, and meanwhile the page
     * would look unchanged. A button whose effect is "forget this for a moment" is worse
     * than no button, so the panel does not offer one and this is the backstop.
     */
    if (entry.origin === 'stylesheet') {
      this.notify(
        `${key} is declared in ${this.rules.sourceOf(key) ?? 'the page’s CSS'}, so it cannot be ` +
        'deleted from here. Remove it from that stylesheet, or override what it sets.',
        'warn',
      );
      return;
    }
    const snapshot: DesignRule = { ...entry, declarations: { ...entry.declarations } };
    /*
     * Position is not restored, and that is a knowing trade.
     *
     * `upsert` puts the rule back at the end of the sheet rather than where it was, so
     * undoing a deletion can change which of two equally specific rules wins. Preserving
     * it would mean the registry carrying an index through every command; deleting a
     * rule and taking it straight back is rare, and two rules of identical specificity
     * fighting over the same property is rarer still.
     */
    this.history.commit({
      label: `Delete rule ${key}`,
      record: {
        id: nextChangeId(),
        kind: 'token-rule',
        summary: `Remove CSS rule ${key}`,
        target: key,
        before: Object.entries(snapshot.declarations)
          .filter(([, value]) => value.trim())
          .map(([property, value]) => `${property}: ${value}`)
          .join('; '),
        detail: { selector: key },
        at: Date.now(),
      },
      apply: () => {
        this.rules.remove(key);
      },
      revert: () => this.rules.upsert(snapshot),
    });
    this.#bumpRevision();
  }

  /**
   * A selector describing the current selection, for seeding a new rule.
   *
   * Deliberately not `selectorFor`, which builds a unique path with `:nth-child` in it.
   * A rule wants to describe a set — `.card`, `h2` — rather than pick one element out
   * of one, so a unique path is the one shape that is always wrong here.
   */
  suggestedRuleSelector(el = this.store.value.selected): string {
    return el ? ruleSelectorFor(el) : '';
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

  /* ---------------------------------------------------------------------- */
  /* Asking first                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Hold an action until the user says yes.
   *
   * The callback is kept rather than the arguments, so the caller states its intent once and
   * this has no opinion about what is being confirmed. A second request replaces the first:
   * two questions at once is a stack of modals, and the answer to the buried one would be
   * given blind.
   */
  askToConfirm(request: ConfirmRequest): void {
    this.endTextEdit(true);
    this.store.patch({ confirm: request });
  }

  /** Answer yes. Clears the question first, so the action runs against a settled UI. */
  resolveConfirm(): void {
    const pending = this.store.value.confirm;
    if (!pending) return;
    this.store.patch({ confirm: null });
    pending.run();
  }

  cancelConfirm(): void {
    if (!this.store.value.confirm) return;
    this.store.patch({ confirm: null });
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
      //
      // Through `upsertBlock` rather than straight into the library, so authoring a block is a
      // change like any other: undoable, and visible to a save.
      const block = this.upsertBlock({
        ...existing,
        ...built,
        props: Object.keys(applied.props).length ? applied.props : undefined,
      });
      this.store.patch({ extraction: null });

      /*
       * The element it was captured from is now one of these.
       *
       * "Save as a reusable block" used to be a one-way trip: it read the element, wrote a
       * library entry, and left the two strangers. So the thing the user had just turned into a
       * component did not know it was one — no Component section when it was selected again,
       * and nothing to sync it back to. It is the first instance of what it produced, and
       * saying so is what closes that loop.
       *
       * Values come from the block's own defaults, which is the honest answer: the placeholders
       * were typed into the dialog by hand, so nothing here knows which part of the element
       * each one stood for. Where they disagree, `blockDrift` reports the element as differing
       * from its template, which is true and is the user's to resolve.
       */
      if (pending.element?.isConnected) this.#linkCaptured(pending.element, block);

      // Counted rather than checked for drift: an instance count is a selector, while drift is
      // a markup comparison per element, and this runs on the way out of a dialog.
      const placed = pending.id ? this.blockInstances(block.id).length : 0;
      if (!pending.id) {
        this.notify(`Saved ${block.name} to the library.`, 'success');
      } else if (!placed) {
        this.notify(`Updated ${block.name}.`, 'success');
      } else if (pending.applyToInstances) {
        // It reports what it did, including having found nothing to do.
        void this.syncBlockInstances(block.id);
      } else {
        this.notify(
          `Updated ${block.name}. ${placed === 1 ? 'One copy is' : `${placed} copies are`} in the page, still on the old version.`,
          'info',
          { label: placed === 1 ? 'Update it' : 'Update them', run: () => void this.syncBlockInstances(block.id) },
        );
      }
      return true;
    } catch (error) {
      this.updateExtraction({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * Link the element a block was captured from, as a change rather than a side effect.
   *
   * The link has to be *recorded*, not merely set, and that is the difference between the
   * component surviving a save and quietly not. An element captured from the page is already in
   * the file, so the patch path copies its bytes across verbatim — it only serializes children
   * the file has never seen. Setting `data-heo-block` on the live node produced no record, so
   * there was nothing for the patcher to place, and the attribute never reached the file. The
   * library came back on the next load with nothing in the page claiming to be an instance of
   * it, and the only way to get the link written was to sync the block by hand, because a sync
   * replaces the element and *that* makes it new markup.
   *
   * Skipped for an element the user just inserted: it is not in the file yet, so its container's
   * rebuild serializes it whole and carries the attribute with it.
   */
  #linkCaptured(el: HTMLElement, block: LibraryBlock): void {
    const fresh = el.closest(`[${INSERTED_ATTR}]`);
    if (!fresh && el.getAttribute(BLOCK_ATTR) !== block.id) {
      this.history.commit(setAttribute(el, BLOCK_ATTR, block.id));
    }
    this.#linkInstance(el, block);
  }

  /** Props a block already declares, so editing one keeps its descriptions. */
  #existingProps(id: string | null): Record<string, PropSpec> | undefined {
    return id ? this.library.get(id)?.props : undefined;
  }

  /* ---------------------------------------------------------------------- */
  /* The library, as changes rather than as side effects                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Add a block, or replace the one that has its id, undoably.
   *
   * Authoring a block used to be the one thing in the editor that simply happened. It wrote
   * into the library and returned, which cost two separate things:
   *
   * Undo could not reach it. Half an hour of work on a template, one wrong Save, and the
   * previous version was gone — while every trivial nudge to a margin was on the stack.
   *
   * And a save could not see it. The write plan is built from records, so a change that
   * produced none was invisible to it; the library existed for exactly as long as the tab did.
   * That is the half this shares with `importDesignSystemText`, which had the same problem and
   * the same fix.
   *
   * Validation stays outside the command. `library.upsert` throws on a block with no id and no
   * name, and a throw from inside `apply` would leave the stack holding a command that did
   * nothing — so the caller checks first and this trusts what it is given.
   */
  upsertBlock(block: LibraryBlock): LibraryBlock {
    const id = block.id;
    /*
     * Deep enough to put back.
     *
     * `props` and `element` are nested objects, and `upsert` replaces the map slot while sharing
     * them — so a snapshot holding the references would be mutated by the very edit it exists to
     * undo. The same care `setClassDeclaration` takes over one class's declarations.
     */
    const live = id ? this.library.get(id) : undefined;
    const previous: LibraryBlock | undefined = live
      ? {
        ...live,
        props: live.props ? { ...live.props } : undefined,
        element: live.element ? { ...live.element } : undefined,
      }
      : undefined;
    const next: LibraryBlock = { ...block };
    let stored = next;

    this.history.commit({
      label: previous ? `Edit ${next.name}` : `Add ${next.name}`,
      /*
       * Keyed on the block, so a template edited four times in a row is one pending change
       * reading "as it was before" to "as it is now" rather than four.
       */
      subject: `block:${id || next.name}`,
      record: {
        id: nextChangeId(),
        kind: 'block',
        summary: previous
          ? `Update the ${next.name} block in the library`
          : `Add a reusable ${next.name} block to the library`,
        target: next.name,
        before: previous?.html,
        after: next.html,
        detail: {
          block: next.name,
          html: next.html,
          ...(next.props ? { props: Object.keys(next.props).join(', ') } : {}),
          ...(next.element?.tag ? { tag: next.element.tag } : {}),
        },
        at: Date.now(),
      },
      apply: () => {
        stored = this.library.upsert(next);
      },
      revert: () => {
        if (previous) this.library.upsert(previous);
        else this.library.remove(stored.id);
      },
    });
    this.#bumpRevision();
    return stored;
  }

  /**
   * Take a block out of the library, undoably.
   *
   * Deleting one used to be immediate and final. What makes that worse than it sounds is that a
   * block is the most expensive thing in here to recreate — markup, props, CSS and possibly a
   * module — and the button that did it sat two pixels from the one that edits it.
   *
   * The instances stay. They are markup in the page and deleting a template is not a statement
   * about the copies already placed; what they lose is the Component section, because nothing
   * answers for their `data-heo-block` any more. Undo brings that back with the block.
   */
  removeBlock(id: string): LibraryBlock | undefined {
    const live = this.library.get(id);
    if (!live) return undefined;
    const snapshot: LibraryBlock = {
      ...live,
      props: live.props ? { ...live.props } : undefined,
      element: live.element ? { ...live.element } : undefined,
    };

    this.history.commit({
      label: `Delete ${snapshot.name}`,
      subject: `block:${id}`,
      record: {
        id: nextChangeId(),
        kind: 'block',
        summary: `Remove the ${snapshot.name} block from the library`,
        target: snapshot.name,
        before: snapshot.html,
        detail: { block: snapshot.name },
        at: Date.now(),
      },
      apply: () => {
        this.library.remove(id);
      },
      revert: () => {
        this.library.upsert(snapshot);
      },
    });
    this.#bumpRevision();
    this.notify(`Removed ${snapshot.name} from the library.`, 'info', {
      label: 'Undo',
      run: () => this.undo(),
    });
    return snapshot;
  }

  /**
   * The library as a seed, or empty when it is not travelling with this save.
   *
   * Read by both save routes so what the plan describes and what gets written cannot disagree.
   * Empty when the box is unticked, and empty when there is nothing to carry — a page whose
   * library is entirely presets has nothing the next load could not rebuild for itself.
   */
  blockLibrarySeed(): string {
    if (!this.store.value.saveBlockLibrary) return '';
    const blocks = this.library.export();
    if (!blocks.length) return '';
    /*
     * Only the blocks, deliberately.
     *
     * Tokens, classes and rules have their own route and their own extent choice, and putting
     * them in here as well would write the design system twice over — once as CSS where the user
     * sent it, once as a seed nobody asked for.
     */
    return encodeSeedSync({
      name: 'Block library',
      version: 1,
      tokens: [],
      classes: [],
      blocks,
    });
  }

  /** How many blocks a save would carry, for the tick to put a number on itself. */
  blockLibrarySize(): number {
    return this.library.export().length;
  }

  setSaveBlockLibrary(save: boolean): void {
    if (this.store.value.saveBlockLibrary === save) return;
    // Ticking it back on cancels a pending removal: the two are opposite answers to one question,
    // and leaving both set would write the library and then delete it.
    this.store.patch({ saveBlockLibrary: save, removeBlockLibrary: save ? false : this.store.value.removeBlockLibrary });
    // Both routes describe what they will write before writing it, so both descriptions are now
    // out of date.
    this.#replanSave();
  }

  /**
   * Whether a save should take the library out of the page.
   *
   * Asked for outright, or implied. The implied case is deleting the last custom block with the
   * box still ticked: there is nothing left to write, so the seed would have been left exactly as
   * the previous save wrote it — the library gone from the session and still in the markup, which
   * is the one outcome nobody chose.
   */
  #removingLibrary(): boolean {
    if (this.store.value.removeBlockLibrary) return true;
    return (
      this.store.value.saveBlockLibrary &&
      this.blockLibrarySize() === 0 &&
      this.blockLibraryInPage()
    );
  }

  /** Whether the page is carrying a library that could be taken out of it. */
  blockLibraryInPage(): boolean {
    return (
      Boolean(document.querySelector(SEED_SCRIPT_SELECTOR)) ||
      Boolean(document.querySelector(`[${BLOCK_ATTR}]`))
    );
  }

  /**
   * Take the block library out of the page, as a change like any other.
   *
   * Distinct from unticking, and the distinction is the whole reason this exists. Unticking means
   * "do not update it this time", which must leave a library already in the file where it is —
   * otherwise a save with the box clear would silently delete it. Getting rid of it is a separate
   * intention and it needs a separate action.
   *
   * Both halves go, because either on its own is worse than neither. A seed with no links is a
   * library nothing in the page claims to use; links with no seed name a template that is not
   * there. So the instance attributes are removed here as real recorded changes — which is what
   * lets the patch path write them into the file, and what makes the whole thing undoable — and
   * the flag tells the save to delete the seed region as well.
   */
  removeBlockLibraryFromPage(): number {
    const links = Array.from(document.querySelectorAll(`[${BLOCK_ATTR}]`)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && !node.closest(`[${IGNORE_ATTR}]`),
    );
    const seeds = Array.from(document.querySelectorAll(SEED_SCRIPT_SELECTOR));
    if (!links.length && !seeds.length) {
      this.notify('This page is not carrying a block library.', 'info');
      return 0;
    }

    const commands = links.map((el) => setAttribute(el, BLOCK_ATTR, null));
    /*
     * The seed tag is put back by `revert` rather than recorded as a deletion.
     *
     * A `<script>` in `<head>` is not an element the structural patcher should be asked to place,
     * and it does not need to be: the file's copy is removed by the marker-region delete, and the
     * live node only has to stop being serialized. Restoring it on undo keeps the page and the
     * file agreeing about what the next save would write.
     */
    const parents = seeds.map((tag) => ({ tag, parent: tag.parentNode, next: tag.nextSibling }));

    this.history.commit({
      label: 'Remove the block library from the page',
      record: {
        id: nextChangeId(),
        kind: 'block',
        summary: `Remove the block library from the page${links.length ? ` and its ${links.length} instance link${links.length === 1 ? '' : 's'}` : ''}`,
        target: 'block library',
        detail: { block: 'library' },
        at: Date.now(),
      },
      extraRecords: commands.map((command) => command.record),
      apply: () => {
        for (const command of commands) command.apply();
        for (const { tag } of parents) tag.remove();
        this.store.patch({ removeBlockLibrary: true, saveBlockLibrary: false });
      },
      revert: () => {
        for (const { tag, parent, next } of parents) parent?.insertBefore(tag, next);
        for (const command of [...commands].reverse()) command.revert();
        this.store.patch({ removeBlockLibrary: false });
      },
    });

    this.#bumpRevision();
    this.#replanSave();
    this.notify(
      `The block library will be removed from the page on the next save.`,
      'info',
      { label: 'Undo', run: () => this.undo() },
    );
    return links.length;
  }

  /** Rebuild whichever save description is currently on screen. */
  #replanSave(): void {
    if (this.store.value.writePlan) void this.previewWritePlan();
    if (this.store.value.bundlePlan) void this.previewBundle();
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
    // A clone is a new node, so it needs its own values; without this the copy of a
    // configured block would lose its editable props. The block *identity* needs no help —
    // it is an attribute, so `cloneNode` brought it along.
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
      // the same form again instead of leaving the values write-once — and so this
      // element can be found again when the template it came from changes.
      this.#linkInstance(nodes[0], block, props);
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

  /**
   * Tie an element to the block it came from.
   *
   * Two halves, in two places, for two different reasons. The block's *identity* goes into
   * the markup, because it has to be findable — both across the page, so every instance of a
   * template can be updated at once, and across a node being replaced, so selecting the
   * element again still knows what it is. The prop *values* stay in a `WeakMap`, because they
   * are the editor's private notes about this one node and nobody's markup should carry them.
   *
   * Unconditional, which it did not used to be. This returned early for a block that declared
   * no props, on the reasonable-looking grounds that there was nothing to remember — but the
   * record is what makes an element *a block* as far as the rest of the editor is concerned,
   * so a block with no props was inserted and then immediately forgotten. Its Component
   * section never appeared, and there was nothing to sync it back to. An instance with no
   * values is a perfectly ordinary thing; it is `{}`, not absent.
   */
  #linkInstance(
    el: HTMLElement,
    block: LibraryBlock,
    props: Record<string, unknown> = {},
  ): void {
    const values: Record<string, string> = {};
    for (const [name, spec] of Object.entries(block.props ?? {})) {
      values[name] = String(props[name] ?? spec.default ?? '');
    }
    el.setAttribute(BLOCK_ATTR, block.id);
    this.#instances.set(el, { blockId: block.id, values });
  }

  /**
   * The block an element came from, with the props it was built with.
   *
   * Returns nothing for elements that never came from one, which is most of the page — the
   * props panel falls back to attributes there.
   *
   * The attribute is consulted when the map has nothing, and that is what makes the answer
   * durable rather than merely usual. Rewriting an ancestor's markup reparses this element
   * into a new node, and a map keyed on the old one has no idea; the attribute rode along in
   * the markup. What is lost in that case is the values, so they fall back to the block's own
   * defaults — the honest answer, and the same one the insert form would have offered.
   */
  blockInstance(el: HTMLElement | null): BlockInstance | null {
    if (!el) return null;
    const entry = this.#instances.get(el);
    const id = entry?.blockId ?? el.getAttribute(BLOCK_ATTR);
    if (!id) return null;
    const block = this.library.get(id);
    if (!block) return null;
    return {
      block,
      values: entry ? { ...entry.values } : this.library.defaultProps(block),
      // How it got here, which is the difference between "Inserted as" and "Saved as". Read
      // off the insertion marker rather than remembered separately, so it survives everything
      // the marker survives.
      placed: el.hasAttribute(INSERTED_ATTR),
    };
  }

  /**
   * Every element in the page that came from this block.
   *
   * The whole reason the link lives in the markup. A `WeakMap` can answer "what is this
   * element?" and can never answer "where are all of them?", and the second question is the
   * one that has to be answerable for a template edit to reach the page.
   *
   * Regions the editor was told to leave alone are left alone here too — an instance inside
   * one is not the editor's to update.
   */
  blockInstances(blockId: string): HTMLElement[] {
    if (!blockId) return [];
    const selector = `[${BLOCK_ATTR}="${CSS.escape(blockId)}"]`;
    return Array.from(document.querySelectorAll(selector)).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.isConnected && !node.closest(`[${IGNORE_ATTR}]`),
    );
  }

  /**
   * How many instances of each block are in the page, in one pass.
   *
   * For the library panel, which draws a count on every card. Asking `blockInstances` per card
   * would be a DOM query per block per render — and the panel redraws on every page revision,
   * which is every style nudge and every frame of a drag. One query answers for the whole
   * library however large it grows.
   */
  blockUsage(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const node of Array.from(document.querySelectorAll(`[${BLOCK_ATTR}]`))) {
      if (!(node instanceof HTMLElement) || node.closest(`[${IGNORE_ATTR}]`)) continue;
      const id = node.getAttribute(BLOCK_ATTR);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * What this element would become if it were updated from its block, without updating it.
   *
   * The template as it now stands, with this copy's own words carried into it. Used for the
   * update itself and for deciding whether to offer one, which is what keeps those two from
   * ever disagreeing.
   *
   * Synchronous, so a render pass can ask: `library.expand` renders the template without
   * registering elements or writing stylesheets, which `instantiate` would do as a side effect
   * of merely looking.
   */
  #mergedInstance(
    el: HTMLElement,
    block: LibraryBlock,
    values: Record<string, string>,
  ): HTMLElement | null {
    const rendered = sanitizeFragment(this.library.expand(block, values)).firstElementChild;
    if (!(rendered instanceof HTMLElement)) return null;
    return mergeInstanceText(rendered, el);
  }

  /**
   * Whether updating this instance from its block would actually change it.
   *
   * Phrased that way deliberately, because the button says "Update" and a button that says
   * Update has to mean it. The obvious reading — "does this element differ from the template?"
   * — is the wrong one now that an update keeps the words already here: every copy differs from
   * the template the moment somebody types into it, so every copy would sit there offering an
   * update that would do nothing at all.
   *
   * So the comparison is against the merge, not against the template. If the two are the same
   * there is nothing to bring across, and the control says so instead.
   *
   * The two mechanics `setBlockProp` splits on split here too. A template block *is* its
   * markup, so markup is compared, both sides through the same clone-and-strip so attribute
   * order and quoting cannot manufacture a difference. A block that registers a custom element
   * is not its markup — the tag renders itself — so its tag and prop attributes are what is
   * compared; serializing an upgraded element would compare against whatever it rendered into
   * itself and report every one of them as stale.
   */
  blockDrift(el: HTMLElement | null): boolean {
    const instance = this.blockInstance(el);
    if (!el || !instance) return false;
    const { block, values } = instance;

    const tag = block.element?.tag;
    if (tag) {
      if (el.tagName.toLowerCase() !== tag) return true;
      return Object.entries(values).some(
        ([name, value]) => (el.getAttribute(name) ?? '') !== value,
      );
    }

    const merged = this.#mergedInstance(el, block, values);
    // Nothing to compare against. Reported as "nothing to do" rather than as stale, because
    // the alternative is offering an update that would replace the element with nothing.
    if (!merged) return false;
    return !sameStructure(cleanMarkup(el), cleanMarkup(merged));
  }

  /**
   * Bring one instance's markup up to date with its block, keeping what is written in it.
   *
   * The other half of the library round trip. Inserting a block copies a template into the
   * page and the two then have nothing more to do with each other — which is right, because a
   * placed block is content and content gets edited. But it left the template edit with
   * nowhere to go: fixing a card's markup in the library changed what the *next* card would
   * look like and nothing about the nine already on the page.
   */
  syncBlockInstance(el = this.store.value.selected): Promise<number> {
    const instance = this.blockInstance(el);
    if (!el || !instance) return Promise.resolve(0);
    return this.syncBlockInstances(instance.block.id, [el]);
  }

  /**
   * Bring instances of a block up to date with its template, as one undoable step.
   *
   * Structure only. Every copy keeps the words that were written into it — see
   * `mergeInstanceText`, which is the whole reason this is usable on more than one element at
   * a time. Rebuilding from the template outright would arrive as nine identical placeholders.
   *
   * One step, and that is the part worth the machinery. Twenty elements change, so twenty
   * records are needed — a record carries one anchor, which is one place in one file, so
   * twenty of them is the only way a save can write twenty elements. But the user did one
   * thing, and one thing has to come back with one undo. So the per-element commands are
   * built with the same builder an insert uses, then composed: one command, one label, one
   * step, carrying every record.
   *
   * `only` narrows it to the instances the caller means, which is how the per-instance button
   * shares this code path rather than approximating it.
   */
  async syncBlockInstances(
    blockId: string,
    only?: readonly HTMLElement[],
  ): Promise<number> {
    const block = this.library.get(blockId);
    if (!block) return 0;

    const candidates = (only ?? this.blockInstances(blockId)).filter(
      (el) => el.isConnected && isMutable(el) && this.blockDrift(el),
    );
    /*
     * An instance inside another instance is left to its parent.
     *
     * Blocks nest — a card template can contain a button block — and replacing the outer one
     * detaches the inner one mid-operation, so the inner command would be swapping nodes that
     * are no longer in the page. The outer rebuild carries it anyway, from the template.
     */
    const targets = candidates.filter(
      (el) => !candidates.some((other) => other !== el && other.contains(el)),
    );
    if (!targets.length) {
      const one = only?.[0];
      this.notify(
        one
          ? `${labelFor(one)} already matches ${block.name}.`
          : `Every ${block.name} in the page already matches the library.`,
        'info',
      );
      return 0;
    }

    const parts: Array<{
      command: Command;
      node: HTMLElement;
      replaced: HTMLElement;
      values: Record<string, string>;
    }> = [];

    for (const el of targets) {
      const instance = this.blockInstance(el);
      if (!instance) continue;
      let nodes: HTMLElement[];
      try {
        ({ nodes } = await this.library.instantiate(block, instance.values));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.notify(`Could not rebuild ${block.name}: ${message}`, 'error');
        return 0;
      }
      // Awaiting let the page move on. An element deleted while the template was rendering is
      // no longer anything this operation is about.
      if (!nodes[0] || !el.isConnected) continue;

      if (block.element?.tag) {
        /*
         * An element block's props are attributes rather than substitutions, so they go onto
         * the fresh tag the way `setBlockProp` puts them onto a live one. Without this the
         * update would hand back a bare tag and read as "it cleared all my values".
         */
        for (const [name, value] of Object.entries(instance.values)) {
          if (value) nodes[0].setAttribute(name, value);
        }
      } else {
        /*
         * The template's markup, this copy's words.
         *
         * Instantiating gives the template as the library now holds it, which is the structure
         * that has to arrive — and, on its own, the placeholder text that has to not. The merge
         * is what separates those: tags, classes and newly added elements come from the
         * template, while everything written into this copy stays written.
         *
         * `instantiate` rather than `expand` even though the merge only needs markup, because
         * it is also what injects the block's CSS and registers its element. A structural
         * update that arrived without the stylesheet it depends on would look like a broken one.
         */
        nodes[0] = mergeInstanceText(nodes[0], el);
      }

      const root = nodes[0];
      root.setAttribute(BLOCK_ATTR, block.id);
      // After the merge, so the insertion marker lands on the node that is actually going in.
      const command = insertNodes(el, 'replace', nodes, `Update ${block.name}`);
      if (!command) continue;
      parts.push({ command, node: root, replaced: el, values: instance.values });
    }
    if (!parts.length) return 0;

    const selected = this.store.value.selected;
    const reselect = parts.find((part) => part.replaced === selected)?.node ?? null;

    this.history.commit({
      label: parts.length === 1 ? `Update ${block.name}` : `Update ${parts.length} × ${block.name}`,
      /*
       * A subject only when there is one element to have one.
       *
       * It is what lets successive edits to the same thing collapse to their net difference,
       * which is right for one element synced twice and wrong for a fan-out — there the
       * reduction would report the first element and drop the rest.
       */
      subject: parts.length === 1 ? parts[0].command.subject : undefined,
      record: parts[0].command.record,
      extraRecords: parts.length > 1 ? parts.slice(1).map((part) => part.command.record) : undefined,
      apply: () => {
        for (const part of parts) part.command.apply();
      },
      revert: () => {
        /*
         * Newest first, and each one guarded.
         *
         * `History.undo` logs a throw and advances the stack regardless, so an element that
         * cannot be put back — its parent has since been deleted, say — must not take the rest
         * of the batch down with it and leave half the page updated with no way back.
         */
        for (const part of [...parts].reverse()) {
          try {
            part.command.revert();
          } catch (error) {
            console.error('[html-editor-overlay] block sync could not be reverted', error);
          }
        }
      },
    });

    for (const part of parts) {
      this.#instances.set(part.node, { blockId: block.id, values: { ...part.values } });
    }
    if (block.element?.tag) this.#injectedElements.add(block.element.tag);
    if (reselect) this.select(reselect);
    this.#bumpRevision();

    this.notify(this.#syncToast(block, parts.length), 'success', {
      label: 'Undo',
      run: () => this.undo(),
    });
    return parts.length;
  }

  /**
   * What a sync actually did, and the one thing it could not do.
   *
   * A custom element can be defined once per page and no more, so a block whose module
   * changed has a new template and an old class, and the markup swap this just performed
   * cannot bridge that. Saying so is the difference between a feature with a documented
   * limit and one that appears to work.
   */
  #syncToast(block: LibraryBlock, count: number): string {
    const what = count === 1 ? `1 ${block.name}` : `${count} × ${block.name}`;
    const tag = block.element?.tag;
    if (tag && this.#injectedElements.has(tag)) {
      return `Updated ${what}. <${tag}> is already registered, so a changed module only takes effect after a reload.`;
    }
    return `Updated ${what} from the library.`;
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
    const instance = this.blockInstance(el);
    if (!instance) return;
    const { block } = instance;
    const values = { ...instance.values, [name]: value };

    if (block.element?.tag) {
      // Written back through the link rather than onto a map entry that may not exist: an
      // element whose node was replaced under it resolves through the attribute, and reaching
      // for `#instances.get` there found nothing and silently dropped the edit.
      this.#instances.set(el, { blockId: block.id, values });
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

  /* ---------------------------------------------------------------------- */
  /* Pasting arbitrary markup                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Open the paste route for a blob of HTML.
   *
   * Takes its own copy of the anchor and closes the insert menu, because the menu is only
   * alive while `insertAnchor` is set and this dialog has to outlive it.
   *
   * `seed` is what the user had already typed into the menu's search box when it looked like
   * markup. Carrying it over means typing `<figure>` and reaching for this route does not
   * throw the typing away.
   */
  beginHtmlPaste(anchor?: InsertAnchor, seed = ''): boolean {
    const target = anchor ?? this.store.value.insertAnchor ?? this.#defaultAnchor();
    if (!target) return false;
    this.endTextEdit(true);
    this.store.patch({
      htmlPaste: { anchor: target, draft: seed, error: '' },
      insertAnchor: null,
      quickMenuOpen: false,
    });
    return true;
  }

  updateHtmlPaste(patch: Partial<Omit<HtmlPaste, 'anchor'>> & { anchor?: InsertAnchor }): void {
    const open = this.store.value.htmlPaste;
    if (!open) return;
    this.store.patch({ htmlPaste: { ...open, ...patch } });
  }

  cancelHtmlPaste(): void {
    if (!this.store.value.htmlPaste) return;
    this.store.patch({ htmlPaste: null });
  }

  /**
   * Insert what was written, and say what became of it.
   *
   * Refuses ahead of the insert rather than after, because `insertHTML` returning null covers
   * two very different situations — nothing was written, and what was written had no element
   * at its root — and "that markup could not be inserted" is unhelpful for either. Text with
   * no tags around it is the common mistake and gets its own sentence.
   *
   * The toast names what was stripped. A pasted `onclick` that silently vanishes is a button
   * that silently does nothing, and the report exists so that is never the outcome.
   */
  commitHtmlPaste(): HTMLElement | null {
    const open = this.store.value.htmlPaste;
    if (!open) return null;

    const draft = open.draft.trim();
    if (!draft) {
      this.updateHtmlPaste({ error: 'Nothing to insert yet.' });
      return null;
    }

    const preview = previewMarkup(draft);
    if (!preview.elements) {
      this.updateHtmlPaste({
        error: preview.looseText
          ? 'That is text with no element around it. Wrap it in a tag — a <p>, say — and it can be placed.'
          : 'No element in that markup. A paste has to start with a tag.',
      });
      return null;
    }
    if (open.anchor.position === 'replace' && !isMutable(open.anchor.reference)) {
      this.updateHtmlPaste({
        error: `${labelFor(open.anchor.reference)} cannot be replaced.`,
      });
      return null;
    }
    if (!open.anchor.reference.isConnected) {
      this.updateHtmlPaste({
        error: 'The element this was going next to is no longer in the page.',
      });
      return null;
    }

    const inserted = this.insertMarkup(draft, open.anchor);
    if (!inserted) {
      this.updateHtmlPaste({ error: 'That markup could not be inserted.' });
      return null;
    }

    this.store.patch({ htmlPaste: null });

    const { report } = preview;
    const stripped = [
      report.scripts && `${report.scripts} script${report.scripts === 1 ? '' : 's'}`,
      report.handlers &&
      `${report.handlers} event handler${report.handlers === 1 ? '' : 's'}`,
      report.urls && `${report.urls} unsafe URL${report.urls === 1 ? '' : 's'}`,
      report.styles && `${report.styles} inline style${report.styles === 1 ? '' : 's'}`,
    ].filter((entry): entry is string => Boolean(entry));

    const what =
      preview.elements === 1
        ? `<${preview.tags[0]}>`
        : `${preview.elements} elements`;
    const where = `${INSERT_POSITION_LABELS[open.anchor.position]} ${labelFor(open.anchor.reference)}`;

    if (stripped.length) {
      this.notify(
        `Inserted ${what} ${where}, without ${stripped.join(', ')} — the page cannot run code the editor put in it.`,
        'warn',
        { label: 'Undo', run: () => this.undo() },
      );
    } else {
      this.notify(`Inserted ${what} ${where}.`, 'success', {
        label: 'Undo',
        run: () => this.undo(),
      });
    }
    return inserted;
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
   *
   * `'leave-selection'` is for the case where the browser is already doing that job: editing
   * began on `pointerdown`, so by the time this runs the user may be mid-sweep through the
   * text. Placing a caret then would wipe what they are selecting.
   */
  beginTextEdit(
    el = this.store.value.selected,
    caret?: { x: number; y: number } | 'leave-selection',
  ): void {
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
    /*
     * Stop watching this element for as long as the user is the one changing it.
     *
     * The durability watcher left armed by the previous commit cannot tell typing from a
     * re-render — both arrive as character-data mutations it did not make — so editing the
     * same text a second time was reported as the page having replaced the first edit. The
     * `depth` guard does not help here: nothing wraps a keystroke.
     *
     * It is re-armed by `endTextEdit` against the text the user ends up with, which is the
     * only value worth watching anyway.
     */
    this.#editWatchers.get(el)?.();
    this.#editWatchers.delete(el);
    this.#textEditSnapshot = el.innerHTML;
    // The same moment, as characters rather than markup. What the editing spaces are
    // measured against — see `restorePlainSpaces`.
    this.#textEditText = el.textContent ?? '';
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-heo-editing', '');
    el.setAttribute('spellcheck', 'true');
    this.store.patch({ textEditing: el, selected: el });

    // Focus on the next frame so the attribute has taken effect before the
    // caret is placed, otherwise Safari drops the selection.
    requestAnimationFrame(() => {
      if (this.store.value.textEditing !== el) return;
      /*
       * Nothing to place: the gesture that started this is placing it.
       *
       * A press on an already-selected element turns editing on straight away so that the
       * browser's own selection drag can run, and the browser has had the element as editable
       * since before `mousedown`. Reaching in a frame later to clear the ranges and re-place a
       * caret would undo the sweep in progress, which is the whole point of starting early.
       */
      if (caret === 'leave-selection') return;
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
    const beforeText = this.#textEditText;
    this.#textEditSnapshot = null;
    this.#textEditText = null;
    // Belongs to the edit that is ending, and there is nothing left to tidy up in it.
    this.#pastedInto = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-heo-editing');
    el.removeAttribute('spellcheck');
    // Belongs to the edit that is ending; keeping it would let a later command act on a range
    // into text that has since been replaced.
    this.#textEditRange = null;
    this.store.patch({ textEditing: null });

    if (before == null) return;
    if (!commit) {
      // Not attributed: this is the editor putting the element back, not the page
      // rendering it, and counting it would make a discarded edit the last one allowed.
      withoutProvenance(() => {
        el.innerHTML = before;
      });
      return;
    }
    /*
     * The browser's editing spaces go back to being spaces before the markup is read.
     *
     * Last chance to do it: the next line serialises the element, and `innerHTML` writes
     * U+00A0 out as `&nbsp;` — so anything still in the DOM at this point is in the file
     * from here on. Typing a space at the end of a paragraph is enough to produce one,
     * which is how `&nbsp;` was turning up in markup nobody had asked to change.
     */
    restorePlainSpaces(el, beforeText ?? el.textContent ?? '');
    const after = el.innerHTML;
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
    /*
     * A revert observed earlier does not get to outlive being contradicted.
     *
     * `markObservedRevert` promotes a guess to `certain` and takes the element's user-owned
     * exemption away, and from then on every edit to it is listed as unable to reach a file.
     * That is the right answer when the page really does re-render — and an inescapable dead
     * end when it does not, which is what a single observation cannot distinguish. So editing
     * the same text again clears the verdict and lets the watcher settle it afresh: if the page
     * does take this edit back, the observation repeats within moments and the mark returns; if
     * it does not, the element goes back to being writable, as it should always have been.
     */
    if (provenanceOf(el)?.kind === 'observed') {
      forgetProvenance(el);
      this.#clearRenderedNotes(el);
    }
    const rendered = this.provenanceOf(el);
    /*
     * Only evidence stops a change reaching a file. A guess says so and stands aside.
     *
     * `possible` is the confidence for "this content changed after the page loaded" and for a
     * value that happens to match an attribute — inferences about what *might* be going on,
     * and the same inferences the editor's own activity can provoke. Stamping the note for
     * those made the plan refuse to write an ordinary paragraph on a suspicion, with no way for
     * the user to overrule it: the element stayed editable and stopped being saveable, which is
     * the worst of both. `certain` and `likely` are different — a template, a script literal, a
     * revert that was watched happening, or content absent from the served HTML — and those
     * still keep the change out of a file it genuinely cannot reach.
     *
     * The warning is unchanged either way. What changes is that a warning is all a guess gets.
     */
    if (rendered && rendered.confidence !== 'possible') {
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
   * Drop the "cannot reach a file" note from changes already recorded for this element.
   *
   * Clearing the verdict is not enough on its own. The note is stamped onto each record when it
   * is made, and the save plan reads it from there — so a change recorded while the wrong
   * verdict stood went on being listed as unwritable no matter what was learned afterwards.
   * That is the state the user hit: an element they could edit freely and never save.
   *
   * Only ever called just after the verdict behind those notes has been withdrawn.
   */
  #clearRenderedNotes(el: HTMLElement): void {
    const key = elementKey(el);
    for (const record of this.history.records) {
      if (record.elementRef !== key || !record.detail?.rendered) continue;
      const { rendered: _dropped, ...rest } = record.detail;
      record.detail = rest;
    }
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
    this.#restoreTextSelection();
    document.execCommand(command);
  }

  /**
   * Put the caret back where the user left it in the page before running a command.
   *
   * `execCommand` acts on whatever is selected right now, and the toolbar's own controls can
   * take that away. The format buttons dodge it by cancelling `pointerdown` so focus never
   * moves — but the link field cannot: it is an input, it has to be focused to be typed into,
   * and focusing it collapses the page selection. By the time Apply was pressed there was
   * nothing selected in the page, so `createLink` had nothing to wrap and the button looked
   * broken. Restoring the remembered range is what gives it something to act on.
   */
  #restoreTextSelection(): void {
    const el = this.store.value.textEditing;
    const range = this.#textEditRange;
    if (!el) return;
    const selection = getSelection();
    if (!selection) return;

    // Already in the right place: leave it exactly as it is rather than re-anchoring it.
    const current = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (current && el.contains(current.commonAncestorContainer)) {
      el.focus({ preventScroll: true });
      return;
    }
    if (!range || !el.contains(range.commonAncestorContainer)) return;
    el.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * The last selection the user made inside the element being edited.
   *
   * Tracked continuously rather than captured by whoever needs it, so any control can act on
   * the selection without each one having to remember to save it first.
   */
  #textEditRange: Range | null = null;

  /** Wrap the current selection in a link. Empty `href` unlinks. */
  insertLink(href: string, target?: '_blank' | null): void {
    const el = this.store.value.textEditing;
    if (!el) return;
    // The URL field had the focus a moment ago, so the page's selection has to come back first.
    this.#restoreTextSelection();
    const url = href.trim();

    /*
     * Read before the command runs, because running it destroys the answer.
     */
    const carried = new Map<string, string>();
    for (const anchor of selectedAnchors(el)) {
      for (const attribute of Array.from(anchor.attributes)) {
        if (attribute.name === 'href' || attribute.name === 'target') continue;
        if (attribute.name === 'rel') {
          const kept = withRel(attribute.value, false);
          if (kept) carried.set('rel', kept);
          continue;
        }
        carried.set(attribute.name, attribute.value);
      }
    }

    if (!url) {
      document.execCommand('unlink');
      this.#bumpRevision();
      return;
    }
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0) return;
    if (selection.isCollapsed) {
      document.execCommand('insertHTML', false, `<a href="${escapeAttribute(url)}">${escapeAttribute(url)}</a>`);
    } else {
      document.execCommand('createLink', false, url);
    }
    /*
     * Set or cleared on the links the selection actually produced, and always both ways.
     *
     * Two things were wrong with matching `a[href]` against the URL string instead. Nothing
     * ever *removed* `target`, so unticking New tab on a link that already had it was ignored
     * — and `execCommand` does not always keep the href verbatim, so a URL typed without a
     * scheme could match nothing and the choice was silently dropped. Locating them through
     * the selection asks the question that was meant: which links did this just make.
     */
    for (const anchor of selectedAnchors(el, url)) {
      // `execCommand` rebuilds an anchor it relinks, dropping everything it was carrying. An
      // author's `rel="nofollow"`, an id, a class: none of that is this feature's to discard.
      for (const [name, value] of carried) {
        if (!anchor.hasAttribute(name)) anchor.setAttribute(name, value);
      }
      if (target === '_blank') {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', withRel(anchor.getAttribute('rel'), true));
      } else {
        anchor.removeAttribute('target');
        const rel = withRel(anchor.getAttribute('rel'), false);
        if (rel) anchor.setAttribute('rel', rel);
        else anchor.removeAttribute('rel');
      }
    }
    this.#bumpRevision();
  }

  /**
   * Whether a new link should open in a new tab, remembered between links.
   *
   * Held here rather than on the toolbar because the toolbar comes and goes: it renders nothing
   * between text edits, and anything kept in its own state is one re-render away from being
   * forgotten. The preference belongs to the session, so the session holds it.
   */
  linkOpensInNewTab = false;

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

    /*
     * The pointer is holding something, so it cannot also reach for a scrollbar: pushing towards
     * the edge of the screen is how the rest of the page is reached during a drag.
     *
     * Fed from the store rather than from pointer events, because the whole point is that it
     * keeps working while the pointer is held still — and `moved` replays the last known pointer
     * through `updateDrag` so the drop target follows the content sliding underneath it.
     */
    this.#stopEdgeScroll?.();
    this.#stopEdgeScroll = startEdgeScroll({
      pointer: () => this.store.value.drag?.pointer ?? null,
      moved: (at) => {
        if (this.store.value.drag) this.updateDrag(at.x, at.y);
      },
      // Held, not stopped: coming back inside the window resumes the drag, so it must also be
      // able to resume scrolling.
      suspended: () => this.store.value.drag?.willCancel === true,
    });
  }

  /** Cancels the edge-scroll loop belonging to the drag in flight. */
  #stopEdgeScroll: (() => void) | null = null;

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

    /*
     * Outside means outside, now that the edge is where scrolling is asked for.
     *
     * This used to count the outer four pixels of the viewport as having left it. That was
     * harmless while the edge meant nothing, and wrong the moment it became the way to reach the
     * rest of the page: pushing right up to the edge to keep scrolling — which is exactly what
     * the last stretch of the band invites — announced the move was about to be abandoned.
     * Pointer capture reports coordinates beyond the window, so the real thing is detectable.
     */
    const outside = x < 0 || y < 0 || x > innerWidth || y > innerHeight;
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
    // The gesture is over, so nothing should still be scrolling on its behalf.
    this.#stopEdgeScroll?.();
    this.#stopEdgeScroll = null;
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
    // The gesture is over, so nothing should still be scrolling on its behalf.
    this.#stopEdgeScroll?.();
    this.#stopEdgeScroll = null;
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
  /* Resizing, moving and rotating by hand                                  */
  /* ---------------------------------------------------------------------- */

  #transform: TransformSnapshot | null = null;
  #stopTransformScroll: (() => void) | null = null;
  #transformPointer: Point | null = null;
  #transformModifiers = { shift: false, alt: false };
  /** The furthest the pointer has been from where it started, for the autoscroll gate. */
  #transformTravel = 0;

  /**
   * Begin a handle drag. Returns false when this element cannot be manipulated that way.
   *
   * The Offsets panel and these handles are two ways into the same four properties, which is the
   * point: a number is right when you know the number, and a corner is right when what you know
   * is "a bit further left". Neither is a substitute for the other and both write the same CSS.
   */
  startTransform(
    el: HTMLElement,
    mode: TransformMode,
    handle: ResizeHandle | null,
    x: number,
    y: number,
  ): boolean {
    if (!el.isConnected || this.store.value.drag) return false;
    if (this.store.value.transform) this.cancelTransform();
    // A live text edit and a handle drag both want the pointer, and the text edit was there
    // first — so it is committed rather than fought with.
    this.endTextEdit(true);

    /*
     * Two readings of the same properties, and the gesture needs both.
     *
     * `inline` is what to put back, and goes through the preview so a value someone is halfway
     * through typing in the panel is not adopted as the state this gesture started from.
     * `authored` is what the cascade actually settled on, as written — which is where the unit and
     * the starting number come from.
     */
    const cascade = cascadedDeclarations(appliedRules(el));
    const gesture = readSnapshot(el, mode, handle, x, y, {
      inline: (property) => this.inlineStyle(property, el),
      authored: (property) =>
        this.inlineStyle(property, el) || cascade.get(property)?.value || '',
    });
    if (!gesture) return false;
    this.#transform = gesture;
    this.#transformPointer = { x, y };
    this.#transformModifiers = { shift: false, alt: false };
    this.#transformTravel = 0;

    this.store.patch({
      transform: { element: el, mode, handle, readout: '', hint: '' },
      hovered: null,
      quickMenuOpen: false,
      insertAnchor: null,
    });

    /*
     * The pointer is holding a handle, so it cannot also reach for a scrollbar — pushing towards
     * the edge is how the rest of the page is reached. The same loop the reorder drag uses, fed
     * from the last known pointer so it keeps working while the hand is held still.
     */
    this.#stopTransformScroll?.();
    this.#stopTransformScroll = startEdgeScroll({
      pointer: () => this.#transformPointer,
      moved: (at) => {
        if (this.#transform) this.updateTransform(at.x, at.y, this.#transformModifiers);
      },
      /*
       * Held until the gesture has actually gone somewhere.
       *
       * A handle sits *on* the element's edge, so an element near the top of the page has its
       * north handle inside the edge-scroll band before the pointer has moved at all. Engaging
       * immediately would scroll the page out from under a user who only wanted to nudge a border
       * by two pixels — the affordance would fight the very adjustment it is for. A deliberate
       * drag towards the edge travels much further than this, so nothing is lost.
       */
      suspended: () => this.#transformTravel < TRANSFORM_SCROLL_TRAVEL,
    });
    return true;
  }

  /**
   * Follow the pointer.
   *
   * Written straight onto the style attribute rather than through `previewStyle`, which holds one
   * property at a time — and a corner drag writes four. The snapshot taken at the start is what
   * makes that safe to do repeatedly: whatever this paints, `#restoreTransform` puts back
   * exactly, which is what lets the release record one honest before-and-after.
   */
  updateTransform(x: number, y: number, modifiers: { shift: boolean; alt: boolean }): void {
    const gesture = this.#transform;
    if (!gesture) return;
    this.#transformPointer = { x, y };
    this.#transformModifiers = modifiers;
    this.#transformTravel = Math.max(
      this.#transformTravel,
      Math.hypot(x - gesture.start.x, y - gesture.start.y),
    );

    const step = stepFor(gesture, x, y, modifiers);
    gesture.written = step.declarations;
    for (const [property, value] of Object.entries(step.declarations)) {
      if (value) gesture.el.style.setProperty(property, value);
      else gesture.el.style.removeProperty(property);
    }

    const state = this.store.value.transform;
    if (state && (state.readout !== step.readout || state.hint !== step.hint)) {
      this.store.patch({ transform: { ...state, readout: step.readout, hint: step.hint } });
    }
    // Geometry only: `#bumpRevision` would re-render the styles panel on every frame, and the
    // panel is not what the user is looking at.
    this.#bumpGeometry();
  }

  /**
   * Put the element back exactly as the gesture found it.
   *
   * Run before committing, not instead of it. The command records the element's `before` at the
   * moment it is built, so building it while the drag's own paint is still on the attribute would
   * record the last frame of the gesture as the state to undo to — and undo would then appear to
   * do nothing at all.
   */
  #restoreTransform(gesture: TransformSnapshot): void {
    for (const [property, value] of Object.entries(gesture.inline)) {
      if (value) gesture.el.style.setProperty(property, value);
      else gesture.el.style.removeProperty(property);
    }
    tidyStyleAttribute(gesture.el);
  }

  #releaseTransform(): TransformSnapshot | null {
    const gesture = this.#transform;
    this.#transform = null;
    this.#stopTransformScroll?.();
    this.#stopTransformScroll = null;
    this.#transformPointer = null;
    if (gesture) this.store.patch({ transform: null });
    return gesture;
  }

  /** Land the gesture as one undoable change. */
  endTransform(): void {
    const gesture = this.#releaseTransform();
    if (!gesture) return;

    /*
     * A press that never travelled is not an edit.
     *
     * Without this, every accidental click on a handle would put a no-op on the undo stack and in
     * the change set — and a change set that lists edits nobody made is one nobody reads.
     */
    const changed = Object.entries(gesture.written).some(
      ([property, value]) => (value || '') !== (gesture.inline[property] || ''),
    );
    this.#restoreTransform(gesture);
    if (!changed) {
      this.#bumpGeometry();
      return;
    }

    this.setStyles(gesture.written, TRANSFORM_LABEL[gesture.mode], gesture.el);
    this.#bumpGeometry();
    this.notify(`${TRANSFORM_LABEL[gesture.mode]} ${labelFor(gesture.el)}.`, 'success', {
      label: 'Undo',
      run: () => this.undo(),
    });
  }

  /**
   * Where the pointer was last seen during a gesture, or null when none is running.
   *
   * Exposed so a modifier key can re-evaluate the gesture at the position it is already at. Shift
   * and Alt change what the same pointer means, and a user who has stopped moving before pressing
   * one expects it to take effect where their hand is — not on the next twitch.
   */
  get transformPointer(): Point | null {
    return this.#transform ? this.#transformPointer : null;
  }

  /** Abandon the gesture, leaving the element as it was. */
  cancelTransform(): void {
    const gesture = this.#releaseTransform();
    if (!gesture) return;
    this.#restoreTransform(gesture);
    this.#bumpGeometry();
  }

  /**
   * Arm a move on a positioned element, and start it if the pointer travels.
   *
   * Returns true once the press has been claimed, which is the signal for the page handler to
   * stand down. Claimed on the press rather than on the first move, because the alternative is
   * letting `beginTextEdit` run and then trying to take the gesture back off the browser's own
   * selection machinery mid-sweep, which cannot be done cleanly.
   *
   * Nothing is written until the threshold is crossed. A press that never travels leaves no
   * gesture, no history entry and no trace — and the click that follows it still lands, so a
   * plain click on a positioned element goes on selecting and editing exactly as before.
   */
  #startMoveGesture(el: HTMLElement, event: PointerEvent): boolean {
    if (getComputedStyle(el).position === 'static') return false;

    const from = { x: event.clientX, y: event.clientY };
    let started = false;
    const modifiers = (source: PointerEvent | KeyboardEvent): { shift: boolean; alt: boolean } => ({
      shift: source.shiftKey,
      alt: source.altKey,
    });

    const move = (moveEvent: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(moveEvent.clientX - from.x, moveEvent.clientY - from.y) < MOVE_THRESHOLD) {
          return;
        }
        // From the original press, so the element does not jump by the threshold on the first frame.
        started = this.startTransform(el, 'move', null, from.x, from.y);
        if (!started) {
          stop();
          return;
        }
      }
      this.updateTransform(moveEvent.clientX, moveEvent.clientY, modifiers(moveEvent));
    };
    const up = (upEvent: PointerEvent): void => {
      stop();
      if (!started) return;
      this.endTransform();
      /*
       * The click that follows a completed drag is not a click on anything.
       *
       * Same problem the text sweep has, and the same answer: suppressing it here stops the
       * release from being read as "select whatever is under the pointer", which after a move
       * across the page is something else entirely.
       */
      this.#pressBeganInTextEdit = true;
      upEvent.preventDefault();
    };
    const cancel = (): void => {
      stop();
      if (started) this.cancelTransform();
    };
    const key = (keyEvent: KeyboardEvent): void => {
      if (!started) return;
      // Held modifiers change what the same pointer position means, so the gesture has to be
      // re-evaluated when one goes down or comes up rather than waiting for the next movement.
      const at = this.#transformPointer;
      if (at) this.updateTransform(at.x, at.y, modifiers(keyEvent));
    };
    const stop = (): void => {
      unlisten(document, 'pointermove', move as EventListener, true);
      unlisten(document, 'pointerup', up as EventListener, true);
      unlisten(document, 'pointercancel', cancel as EventListener, true);
      unlisten(document, 'keydown', key as EventListener, true);
      unlisten(document, 'keyup', key as EventListener, true);
    };

    // Through `listen`, so the shield cannot gate the editor's own gesture wiring.
    listen(document, 'pointermove', move as EventListener, true);
    listen(document, 'pointerup', up as EventListener, true);
    listen(document, 'pointercancel', cancel as EventListener, true);
    listen(document, 'keydown', key as EventListener, true);
    listen(document, 'keyup', key as EventListener, true);
    return true;
  }

  /**
   * Which handles this element should offer, and the geometry to draw them on.
   *
   * Answered here rather than in the layer so the decision and the arithmetic behind it stay
   * together — and because the layer asks on every render, which makes it the wrong place to be
   * re-deriving a transform matrix.
   *
   * Null means no handles at all: an inline element has no box worth grabbing, and `<body>` is
   * not something to resize.
   */
  transformAffordances(el: HTMLElement | null): {
    resize: boolean;
    angle: number;
    box: Box;
    linear: Linear;
    origin: Point;
  } | null {
    if (!el || !el.isConnected) return null;
    if (el === document.body || el === document.documentElement) return null;
    const computed = getComputedStyle(el);
    if (computed.display === 'inline' || computed.display === 'none') return null;
    const linear = linearOf(computed.transform);
    const box = untransformedBox(el, linear, computed);
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      /*
       * The resize and move handles are the page-side half of the panel's Offsets section, so they
       * appear on exactly the elements that section appears for. An element in normal flow is
       * sized and placed by its neighbours: dragging it is the reorder gesture, which lives on the
       * thumb, and its offsets would be ignored if the handles wrote any.
       */
      resize: resolvesOffsets(computed),
      angle: declaredRotation(computed.transform) ?? angleOf(linear),
      box,
      linear,
      origin: originOf(computed, box),
    };
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
    if (
      !this.#preview &&
      !this.#rulePreview &&
      !this.#classPreview &&
      !this.#designRulePreview
    ) {
      return false;
    }
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
   *
   * Null means nobody has chosen, not "the document". The difference matters: the default
   * depends on whether a project is attached, and attaching one is something that happens
   * after this is first read.
   */
  #designSystemTarget: string | null = null;

  get designSystemTarget(): string {
    return this.#designSystemTarget ?? this.#defaultDesignSystemTarget();
  }

  /**
   * Where the design system goes when nobody has said.
   *
   * **A stylesheet is only offered when something can write one.** This used to default to
   * the page's first readable stylesheet regardless, and that quietly destroyed imported
   * design systems: `exportHTML` removes the generated `<style>` block whenever the target is
   * not the document, on the grounds that the CSS is being written to a file instead — but
   * only `planWrites` writes stylesheets, and that needs a `FileHost`. With a readable
   * stylesheet and no folder connected, the tokens were addressed to a file nothing would
   * ever write and deleted from the one place they were.
   *
   * Not memoised, so connecting a folder re-evaluates it. An explicit choice is remembered;
   * an assumption is not the same thing as a choice.
   */
  #defaultDesignSystemTarget(): string {
    if (!this.#project) return DOCUMENT_TARGET;
    return this.styleTargets()[1]?.value ?? DOCUMENT_TARGET;
  }

  setDesignSystemTarget(target: string): void {
    if (this.#designSystemTarget === target) return;
    this.#designSystemTarget = target;
    // The plan named a file; it has to be rebuilt before it can name a different one.
    if (this.store.value.writePlan) void this.previewWritePlan();
    else this.#bumpRegistry();
  }

  /** How much of the design system a save writes: everything, only what is used, or none. */
  setDesignSystemScope(scope: DesignSystemScope): void {
    if (this.store.value.designSystemScope === scope) return;
    this.store.patch({ designSystemScope: scope });
    // Both routes describe what they will write before writing it, so both descriptions are
    // now out of date.
    if (this.store.value.writePlan) void this.previewWritePlan();
    if (this.store.value.bundlePlan) void this.previewBundle();
  }

  /**
   * The design system as CSS, at the extent the user chose.
   *
   * One source for both save routes and the dialog's preview, so what is described and what is
   * written cannot disagree about how much of it there is.
   */
  designSystemParts(): DesignSystemParts {
    return designSystemParts(this, this.store.value.designSystemScope);
  }

  /**
   * Where each part of the design system is kept, part by part.
   *
   * The status the save dialog was missing. "Is my design system persisted, and where" is not a
   * question the dialog could answer: it offered a destination `<select>` and an extent choice and
   * a library tick, three controls describing one thing, and nothing said what the current answer
   * was. So the seed looked like the only way to keep a design system, when for three of its four
   * parts it is the manual fallback.
   *
   * Facts only — counts, a destination and whether that destination is a file a save can write.
   * The sentences belong to the dialog, which is where the reader is.
   *
   * Read from the same getters the save uses, so this cannot describe a destination the save
   * would not use. That consistency is the point of putting it here rather than in the UI.
   */
  designSystemPersistence(): DesignSystemPart[] {
    const extent = this.designSystemExtent(this.store.value.designSystemScope);
    const target = this.designSystemTarget;
    const inDocument = target === DOCUMENT_TARGET;
    const connected = Boolean(this.store.value.project);
    const label = this.styleTargets().find((entry) => entry.value === target)?.label ?? target;

    /*
     * The document is a file too, and forgetting that is what made the old UI read as though
     * "Keep in the page" meant "not saved". It is saved — by the write that saves the page.
     */
    const cssWhere = inDocument ? 'this page' : label;
    const cssFiled = inDocument || connected;
    const css = (count: number): DesignSystemPart['state'] =>
      count === 0 ? 'empty' : cssFiled ? 'filed' : 'unfiled';

    const carrying = this.blockLibraryInPage();
    const blocks = this.blockLibrarySize();
    const willWrite = this.store.value.saveBlockLibrary && !this.#removingLibrary();

    return [
      { part: 'tokens', count: extent.tokens, where: cssWhere, state: css(extent.tokens) },
      { part: 'classes', count: extent.classes, where: cssWhere, state: css(extent.classes) },
      { part: 'rules', count: extent.rules, where: cssWhere, state: css(extent.rules) },
      {
        part: 'library',
        count: blocks,
        // Its only possible home, so there is no destination to name — only whether it has one.
        where: 'this page',
        state:
          blocks === 0 && !carrying
            ? 'empty'
            : this.#removingLibrary()
              ? 'removing'
              : willWrite || carrying
                ? 'filed'
                : 'unfiled',
      },
    ];
  }

  /** How many entries each extent would write, for putting numbers on the choice. */
  designSystemExtent(scope: DesignSystemScope): {
    tokens: number;
    classes: number;
    rules: number;
  } {
    return designSystemExtent(this, scope);
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
    this.rules.scanDocument();
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
      this.rules.scanCSS(file.text, file.path);
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
      //
      //
      // Handed over as three parts rather than one block: the plan uses them to say
      // which kinds a file is about to receive, and joining them is its decision because
      // the join order is the cascade order.
      designSystemCSS: this.designSystemParts(),
      designSystemTarget: target,
      blockLibrarySeed: this.blockLibrarySeed(),
      removeBlockLibrary: this.#removingLibrary(),
      generatedRegions: this.#generatedRegions(),
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
       * Unless the user's own element is the region, is inside it, or contains it.
       *
       * Dropping the region would take their element with it, and an edit vanishing from the
       * file is a far worse outcome than some generated markup arriving in it. So the region
       * stays whole and the plan's warning covers it.
       *
       * `closest` as well as `querySelector`, because an element the user just inserted looks
       * exactly like one a script built — it has no build marker and it appeared after load.
       * Testing descendants alone left the inserted element itself classified as generated, and
       * it was then left out of its container's rebuild: the insert reached the file only for
       * as long as the file was being rewritten wholesale, which hid it.
       */
      if (el.closest(`[${INSERTED_ATTR}]`) || el.querySelector(`[${INSERTED_ATTR}]`)) continue;
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
  /* Writing the page out, with no project to write into                    */
  /* ---------------------------------------------------------------------- */

  /**
   * What the page is made of, for the choices in the export step.
   *
   * Cheap enough to call on every render — it parses the export and resolves URLs, and
   * reads nothing — which is what lets the checkboxes say how many assets each of them
   * covers and whether inlining them is possible here at all.
   */
  bundleSurvey(): BundleSurvey {
    return surveyBundle(this.#bundleSubject(null));
  }

  /**
   * The shape the current choices would produce: one file, or an archive.
   *
   * A built plan wins over the prediction, and the two really can differ. The prediction
   * resolves URLs without reading them, so for a local file it has to be optimistic — see
   * `assetReach` — and a page whose assets all turn out to be unreadable produces no files
   * to put beside the HTML however they were marked. Without this the button offered a
   * `.zip` and the download was an `.html`.
   */
  bundleShape(): BundlePackaging {
    const plan = this.store.value.bundlePlan;
    // Only while it still describes the current choices. A plan is now kept on screen after
    // a box is ticked, so trusting it blindly would offer a `.zip` for choices that no longer
    // produce one — and that offer becomes the extension in the save picker.
    if (plan && !planIsStale(plan, this.store.value.bundleOptions)) return plan.shape;
    /*
     * No plan, so the choice is taken at its word.
     *
     * Deliberately not surveyed. Answering properly means cloning and serializing the whole
     * document to find out whether an archive could hold anything, and this is read from the
     * footer on every render of every step — so the accurate answer cost a full document copy
     * per keystroke, and the page froze. Callers that already hold a survey can have the
     * accurate answer from `bundleShape(survey, options)`; everyone else gets the intent,
     * which a built plan then corrects.
     */
    return this.store.value.bundleOptions.packaging;
  }

  /**
   * Change what gets saved, and how.
   *
   * The plan on screen is deliberately *not* cleared. It was, and one click then produced four
   * layouts in a row — the file list, an empty placeholder, a progress line, then the new list
   * — which read as the panel flashing. It stays put instead, marked stale through
   * `planIsStale`, until the replacement is ready.
   *
   * The rebuild is also debounced. Ticking three boxes is one intention, and each rebuild
   * reads every asset the page refers to, so running one per click means two wasted passes
   * over the network and two intermediate states nobody wanted to see.
   */
  setBundleOptions(next: Partial<BundleOptions>): void {
    this.store.patch({ bundleOptions: { ...this.store.value.bundleOptions, ...next } });
    if (this.#bundleTimer !== null) clearTimeout(this.#bundleTimer);
    this.#bundleTimer = setTimeout(() => {
      this.#bundleTimer = null;
      void this.previewBundle();
    }, 140);
  }

  /**
   * Rename the export.
   *
   * Applied to the plan in place rather than rebuilding it. The name has no bearing on the
   * bytes, and re-reading every asset on each keystroke would make a text field feel like a
   * network operation.
   *
   * Stored as typed, and narrowed only where it becomes a file name — `exportBase` runs in
   * `bundleName`, `renameBundle` and `buildBundle`. Sanitising on the way in instead would
   * mean a field that rewrites itself under the caret every time someone types a character
   * it does not like. Empty goes back to the page's own name rather than becoming a file
   * called nothing.
   */
  setExportName(name: string | null): void {
    const next = name === null || name.trim() === '' ? null : name;
    const plan = this.store.value.bundlePlan;
    this.store.patch({
      exportName: next,
      bundlePlan: plan ? renameBundle(plan, next ?? this.#pageFileName) : null,
    });
  }

  /** Whether pressing Write asks where the file goes. */
  setExportPrompt(on: boolean): void {
    // Refused rather than stored where there is no picker, so the state cannot claim an
    // ability the browser does not have.
    this.store.patch({ exportPrompt: on && savePickerAvailable() });
  }

  /** True when this browser can ask where to put a file. */
  exportPickerAvailable(): boolean {
    return savePickerAvailable();
  }

  /**
   * Whether an archive is worth offering, given what is set to be saved.
   *
   * The packaging choice appears only when this is true, which is what keeps the one broken
   * combination out of reach: a zip is offered only when there is a file to put beside the
   * page. A built plan answers from what it placed, which is the only way to know about
   * assets that live inside a linked stylesheet.
   */
  canArchiveBundle(): boolean {
    const plan = this.store.value.bundlePlan;
    const options = this.store.value.bundleOptions;
    return plan ? planCanArchive(plan, options) : canArchive(this.bundleSurvey(), options);
  }

  /**
   * Build the export without handing it over.
   *
   * The counterpart to `previewWritePlan`, and a step for the same reason: this is the one
   * place the overlay can say what a download will actually contain — which files, how
   * big, and which assets it could not reach — while it is still a proposal. Reading every
   * asset is what makes that answer real rather than a guess, and also what makes it slow
   * enough to be worth a progress state.
   */
  async previewBundle(): Promise<BundlePlan | null> {
    /*
     * Only the newest build gets to speak.
     *
     * Ticking a checkbox starts one, so a few quick clicks put several in flight at once,
     * each reading the options as they were when it started. Without this the slowest one
     * lands last and the panel ends up describing a set of choices nobody has selected —
     * and the footer would offer to write it.
     */
    const run = (this.#bundleRun += 1);
    const stale = (): boolean => this.#destroyed || run !== this.#bundleRun;
    // A build asked for directly supersedes one merely scheduled, so pressing Write or Recheck
    // does not get followed by a second pass a moment later.
    if (this.#bundleTimer !== null) {
      clearTimeout(this.#bundleTimer);
      this.#bundleTimer = null;
    }

    const source = await this.#readOwnDocument();
    if (stale()) return null;
    this.store.patch({ bundling: true });
    try {
      const plan = await buildBundle(
        this.#bundleSubject(source),
        this.store.value.bundleOptions,
      );
      if (stale()) return null;
      this.store.patch({ bundlePlan: plan });
      return plan;
    } catch (error) {
      if (stale()) return null;
      console.error('[html-editor-overlay] could not build the export', error);
      this.notify('Could not build the export. See the console for details.', 'error');
      this.store.patch({ bundlePlan: null });
      return null;
    } finally {
      // Left alone when a newer build owns it, or the spinner would stop while one is
      // still running.
      if (!stale()) this.store.patch({ bundling: false });
    }
  }

  /**
   * Write the page out and hand it over.
   *
   * Rebuilds rather than trusting the plan on screen, for the same reason the project
   * write does: between showing it and pressing the button a checkbox may have moved, and
   * what gets downloaded has to be what was described.
   *
   * **Where it goes is asked first, and that ordering is not a preference.** A save picker
   * needs transient activation, which expires a few seconds after the click, and building
   * the export means reading every asset the page refers to. Ask afterwards and the picker
   * is refused on any page with more than a handful of images. So the destination is settled
   * while the click is still warm, and the extension offered comes from the plan already on
   * screen — which is why changing a checkbox rebuilds it rather than leaving it empty.
   *
   * Counts as a save. The page's own file is what changed, so the pending count starts
   * again from here — the same thing writing to a project means, reached a different way.
   * That is the whole point of this route existing: a download is not a lesser save.
   */
  async writeBundle(): Promise<BundlePlan | null> {
    const target = this.store.value.exportPrompt
      ? await pickSaveTarget(bundleName(this.exportFileName, this.bundleShape()))
      : ({ kind: 'unavailable' } as const);
    // Backing out of the picker is backing out of the save. Writing to the download folder
    // instead would put the file exactly where they declined to put it.
    if (target.kind === 'cancelled') return null;

    const plan = await this.previewBundle();
    if (!plan) return null;

    const name = await this.#handOver(plan, target);
    if (name === null) return null;
    this.#markSaved();
    this.store.patch({ savePreview: null });

    const files = plan.files.length;
    const detail =
      plan.shape === 'single'
        ? plan.patched
          ? 'patched from your file, so only the lines you changed changed'
          : 'rebuilt from the page, so quoting and formatting are normalised'
        : `${files} file${files === 1 ? '' : 's'}, at the paths the page already uses`;
    /*
     * Anything that could not travel is named, not counted.
     *
     * A self-contained file that quietly is not self-contained is the worst thing this
     * could produce, so the assets left behind are the headline when there are any — with
     * the reason, which on a page opened from disk is the same for all of them.
     */
    if (plan.omitted.length) {
      const first = plan.omitted[0];
      const rest = plan.omitted.length - 1;
      this.notify(
        `Wrote ${name}. ${first.label}${rest ? ` and ${rest} other asset${rest === 1 ? '' : 's'}` : ''} ` +
        `stayed as ${rest ? 'references' : 'a reference'}: ${first.reason}`,
        'warn',
      );
      return plan;
    }
    this.notify(`Wrote ${name} — ${detail}.`, 'success');
    return plan;
  }

  /**
   * Put the bytes where the user said.
   *
   * A chosen handle wins, with one guard: the extension the picker was offered came from
   * the shape predicted before the build, and the build is what settles it. When the two
   * disagree — a page whose assets all turned out unreadable produces one file where an
   * archive was expected — writing zip bytes into a `.html`, or the reverse, would hand over
   * a file that does not open. So the handle is dropped in favour of a plain download under
   * the right name, and the reason is said out loud rather than silently swallowed.
   *
   * Returns the name written, or null when nothing was.
   */
  async #handOver(plan: BundlePlan, target: SaveChoice): Promise<string | null> {
    const blob = await bundleBlob(plan);

    if (target.kind === 'chosen') {
      if (extensionOf(target.name) === extensionOf(plan.fileName)) {
        try {
          await writeSaveTarget(target.handle, blob);
          return target.name;
        } catch (error) {
          console.error('[html-editor-overlay] could not write the chosen file', error);
          this.notify(
            `Could not write ${target.name}. The file may be open elsewhere, or permission was withdrawn.`,
            'error',
          );
          return null;
        }
      }
      this.notify(
        `Saved as ${plan.fileName} instead of ${target.name}: reading the page's files ` +
        `turned out ${plan.shape === 'single' ? 'one file' : 'more than one file'}, so the ` +
        'extension changed.',
        'warn',
      );
    }

    downloadBlob(plan.fileName, blob);
    return plan.fileName;
  }

  /**
   * The name a download is offered under, before its extension is settled.
   *
   * The typed name wins over the page's own, and the page's own is the default rather than
   * something generic: writing back a copy of the file you opened is the common case, and
   * having to retype its name every time would be the tax on it.
   */
  get exportFileName(): string {
    return this.store.value.exportName ?? this.#pageFileName;
  }

  /**
   * The name the page itself suggests, with nothing typed over it and no extension.
   *
   * What the name field shows as its placeholder, so an empty field still says what
   * pressing Write would produce.
   */
  get exportDefaultName(): string {
    return exportBase(this.#pageFileName);
  }

  /** The name the page itself suggests, ignoring anything typed over it. */
  get #pageFileName(): string {
    return this.options.fileName ?? 'edited-page.html';
  }

  /**
   * What the bundler needs, with the document patched from source where it could be.
   *
   * The design system is forced into the HTML here, because this route cannot put it anywhere
   * else. Writing a stylesheet is `planWrites`' job and needs a connected project; a bundle is
   * a copy of the page plus whatever assets travel with it, and there is no third place for
   * tokens to live. Left to the stylesheet target, an imported design system was removed from
   * the export and written nowhere.
   */
  #bundleSubject(source: string | null): BundleSubject {
    const result = this.exportPatchedHTML(source, { designSystemInDocument: true });
    return {
      html: result.html,
      patched: result.patched,
      why: result.why,
      fileName: this.exportFileName,
      project: this.#project,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Save and export                                                        */
  /* ---------------------------------------------------------------------- */

  buildSavePrompt(): string {
    return buildPrompt({
      records: this.handoffRecords,
      tokens: this.tokens.export(),
      classes: this.classes.export(),
      cssRules: this.rules.export(),
      blocks: this.library.list(),
      tokenCSS: this.tokens.toCSS(),
      classCSS: this.classes.toCSS(),
      cssRuleCSS: this.rules.toCSS(),
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
  /**
   * @param options.designSystemInDocument Overrides where the design system is assumed to be
   *   going. The bundle export passes true because it has no way to write a stylesheet, so
   *   the HTML is the only place the design system can travel.
   */
  exportHTML(options: { designSystemInDocument?: boolean } = {}): string {
    return exportHTML(inlineStyleEdits(this.history.appliedRecords), {
      generated: this.#generatedRegions(),
      // The one thing the target decides: whether the tokens and classes live in this file
      // or in the stylesheet the save is about to write them to.
      designSystemInDocument:
        options.designSystemInDocument ?? this.designSystemTarget === DOCUMENT_TARGET,
      designSystemBlocks: this.#designSystemBlocks(),
      // The library, when it was asked to travel. Serializing the page cannot pick this up on
      // its own: the seed describes the library, and the library is not in the DOM.
      seedScript: this.blockLibrarySeed(),
      removeBlockLibrary: this.#removingLibrary(),
    });
  }

  /**
   * The generated blocks' contents at the chosen extent, or nothing to leave them alone.
   *
   * The live blocks hold the whole design system because that is what the page renders from,
   * so narrowing what gets written means substituting their text as the export goes past.
   * `all` returns undefined rather than the same CSS it already has, which keeps that path
   * producing exactly the bytes it did before this existed.
   */
  #designSystemBlocks(): Record<string, string> | undefined {
    const scope = this.store.value.designSystemScope;
    if (scope === 'all') return undefined;
    const parts = this.designSystemParts();
    return {
      [TOKEN_STYLE_ID]: parts.tokens,
      [CLASS_STYLE_ID]: parts.classes,
      [RULE_STYLE_ID]: parts.rules,
    };
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
        this.store.patch({ savePreview: null });
        return true;
      }

      /*
       * With nowhere to write, a save writes the page out.
       *
       * It used to produce a prompt — instructions for someone else to apply the changes to
       * a codebase — and that is the right answer only when there *is* a codebase. Someone
       * editing a page they opened from disk has the file; what they want back is the file,
       * with their edits in it. Handing them a Markdown description of their own edits was
       * an answer to a question they had not asked.
       *
       * The prompt has not gone anywhere: it is a tab in the review step and a button
       * beside this one, because on a page that *is* part of a project it remains the more
       * useful of the two. It is no longer what pressing Save does.
       */
      const plan = await this.writeBundle();
      return plan !== null;
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

  /**
   * The download, patched from the file when the file can be had.
   *
   * A download is the save route for a page with no folder behind it — every local file opened
   * straight from disk in a browser without the directory picker. It used to be the one path
   * that always serialized, which is the destructive outcome the whole patching effort exists
   * to avoid: the user opens the downloaded file expecting three changed attributes and finds
   * every quote, void tag and letter case in the document rewritten around them.
   *
   * So the same patch pipeline runs here, against whatever copy of the source can be reached.
   * When none can, the export still happens — a button that sometimes produces nothing is
   * worse than one that explains what it produced — and the offer to do better comes with it.
   */
  async exportPageHTML(): Promise<void> {
    const name = this.options.fileName ?? 'edited-page.html';
    const source = await this.#readOwnDocument();
    const result = this.exportPatchedHTML(source);
    downloadText(name, result.html, 'text/html');

    if (result.patched) {
      this.notify(`Exported ${name}, patched in place. The rest of the file is untouched.`, 'success');
      return;
    }
    /*
     * Rewritten, and the reason decides whether there is anything to offer.
     *
     * No source at all is worth an offer: the file is on the user's disk and they can hand it
     * over. A source that was read but could not be patched is not — the offer would fail the
     * same way a second time, so the honest thing is to name the cause.
     */
    if (source === null) {
      this.notify(
        'Exported the page as HTML, rewritten from the DOM, so quoting and formatting are ' +
        'normalised throughout. Hand over the original file and the export keeps it.',
        'warn',
        { label: 'Use the original file', run: () => void this.exportFromPickedFile() },
      );
      return;
    }
    this.notify(
      `Exported the page as HTML, rewritten because ${result.why[0] ?? 'a change could not be placed in the file'}.`,
      'warn',
    );
  }

  /**
   * Export again, this time from a file the user hands over.
   *
   * The picker is the only way to read the page's own source on a `file://` URL: its origin is
   * opaque, so fetching itself is refused, and Firefox has no directory picker to offer
   * instead. A file the user chooses in a dialog arrives with none of that in the way.
   */
  async exportFromPickedFile(): Promise<void> {
    const picked = await pickTextFile('text/html,.html,.htm');
    if (picked === null) return;

    const name = this.options.fileName ?? 'edited-page.html';
    const expected = documentPath()?.split('/').pop();
    if (!/<html|<body|<!doctype/i.test(picked)) {
      this.notify('That file is not an HTML document, so there is nothing to patch in it.', 'error');
      return;
    }

    /*
     * Whether it is *this* page's file is settled by the patch attempt, not guessed at here.
     *
     * Every change has to resolve to an element in the text or the attempt fails as a whole, so
     * the wrong file is refused by the same rule that refuses one which has moved on since. That
     * is a stronger check than comparing names — a renamed copy passes and a same-named stranger
     * does not — and it needs no second heuristic kept in step with the first.
     */

    const result = this.exportPatchedHTML(picked);
    if (!result.patched) {
      this.notify(
        `That file could not be patched: ${result.why[0] ?? 'no change could be placed in it'}. ` +
        `${expected ? `Is it the ${expected} this page was opened from?` : ''}`,
        'error',
      );
      return;
    }
    downloadText(name, result.html, 'text/html');
    this.notify(`Exported ${name} from your file, patched in place.`, 'success');
  }

  /**
   * The export's text: the source with this session's edits patched into it, or the DOM.
   *
   * Split out from the download so the decision is testable without a file dialog in the way.
   */
  /**
   * @param options.designSystemInDocument Forces the design system into this HTML rather than
   *   letting the chosen stylesheet target decide. Both routes out of here have to honour it —
   *   the patched one through the write subject's target, since `isDocumentChange` reads that
   *   to decide whether a token edit belongs in the document at all.
   */
  exportPatchedHTML(
    source: string | null,
    options: { designSystemInDocument?: boolean } = {},
  ): { html: string; patched: boolean; why: string[] } {
    const path = documentPath();
    const inDocument = options.designSystemInDocument;
    const serialized = (): string => this.exportHTML({ designSystemInDocument: inDocument });

    if (source !== null && path) {
      const subject =
        inDocument === true
          ? { ...this.#writeSubject(), designSystemTarget: DOCUMENT_TARGET }
          : this.#writeSubject();
      const attempt = patchDocumentSource(source, subject, path);
      if ('html' in attempt) return { html: attempt.html, patched: true, why: [] };
      return { html: serialized(), patched: false, why: attempt.why };
    }
    return {
      html: serialized(),
      patched: false,
      why: [path ? 'the page could not read its own file' : 'this page has no file path'],
    };
  }

  designSystem(): DesignSystemDocument {
    return exportDesignSystem(
      { tokens: this.tokens, classes: this.classes, rules: this.rules, library: this.library },
      document.title || 'Design system',
    );
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
  /**
   * Bring a design system in, as a change like any other.
   *
   * Committed to history rather than applied straight to the registries, for two reasons that
   * turn out to be the same reason. It is undoable, which someone who has just imported the
   * wrong system very much wants. And it is a *record*, which is what makes a save notice it at
   * all: the write plan builds the document write from records, so an import that left none was
   * invisible to it — the tokens rendered on screen, the save reported success, and the file it
   * wrote had no design system in it.
   *
   * Mount-time seeds are deliberately not routed through here. A seed given as an option is the
   * page's configuration, not something the user did, and making it a change would open every
   * session dirty with an edit nobody made.
   */
  async importDesignSystemText(text: string, overwrite = false): Promise<boolean> {
    try {
      const doc = await decodeSeed(text);
      const before = snapshotDesignSystem(this);
      let result: ImportResult = { tokens: 0, classes: 0, rules: 0, blocks: 0 };
      const name = doc.name?.trim() || 'design system';

      this.history.commit({
        label: `Import ${name}`,
        record: {
          id: nextChangeId(),
          kind: 'token',
          summary: `Import ${name}`,
          target: 'design system',
          detail: { imported: name },
          at: Date.now(),
        },
        apply: () => {
          result = importDesignSystem(doc, this, { overwrite });
        },
        revert: () => restoreDesignSystem(this, before),
      });

      this.#bumpRevision();
      this.notify(
        `Imported ${result.tokens} tokens, ${result.classes} classes and ${result.blocks} blocks.`,
        'success',
        { label: 'Undo', run: () => this.undo() },
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
    /*
     * Through `listen`, not `addEventListener`, and that is load-bearing.
     *
     * The event shield gates page handlers on `document` and `window` for exactly the
     * types this method registers. `listen` reaches the saved native method, so the
     * editor's own wiring is never a candidate for gating — otherwise opening a modal
     * would suppress the editor's own `pointerdown` and `keydown` along with the page's.
     */
    const on = <K extends keyof DocumentEventMap>(
      target: Document | Window,
      type: K,
      handler: (event: DocumentEventMap[K]) => void,
      capture = true,
    ): void => {
      const listener = handler as EventListener;
      listen(target, type, listener, capture);
      this.#listeners.push(() => unlisten(target, type, listener, capture));
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
      /*
       * Every press decides afresh whether a text sweep is starting under it.
       *
       * Cleared here rather than only where it is read, so the flag describes the press that
       * is happening now and can never be left over from one whose release went somewhere
       * this handler does not see.
       */
      this.#pressBeganInTextEdit = false;

      const editing = this.store.value.textEditing;
      if (editing) {
        const path = event.composedPath();
        if (!path.includes(editing) && !path.some(isTextEditChrome)) this.endTextEdit(true);
        // A press inside the live edit is the start of a sweep through its words.
        else if (path.includes(editing)) this.#pressBeganInTextEdit = true;
        return;
      }

      /*
       * Pressing on an element that is already selected starts editing it now, not on release.
       *
       * Selecting text is a press-move-release gesture, and the browser only performs it on an
       * element that is editable when the press lands. Waiting for the `click` meant the sweep
       * happened over a non-editable element — nothing was selected — and editing then began at
       * the release point with a bare caret. The words the user had just swept over were the one
       * thing they had asked for, and they were gone. So the element becomes editable during
       * `pointerdown`, before `mousedown`, and the browser does the rest.
       *
       * A plain click through this same path lands the caret where it was clicked, which is what
       * it did before, so the click handler no longer has to place one: it sees the element is
       * already being edited and stands down.
       *
       * Only the primary button, and only the element that is already selected — pressing on
       * anything else is how the selection moves, and that has to keep working.
       */
      if (event.button !== 0) return;
      if (isOverlayEvent(event) || isNativeInputEvent(event)) return;
      const el = selectableFromEvent(event);
      if (!el || el !== this.store.value.selected) return;

      /*
       * A positioned element is dragged, not swept.
       *
       * This is the one place the two gestures genuinely compete, and the tie has to be broken
       * somewhere. An element with `position: absolute` sits where its offsets put it, and the
       * expected thing to do with it — in this editor and in every design tool — is to pick it up
       * and move it. An element in normal flow cannot be moved that way at all, so there it stays
       * a text sweep and nothing changes.
       *
       * A threshold decides, not the press: below it nothing has happened, the handler below still
       * runs on the release, and clicking into a positioned element to edit its words works
       * exactly as it did. Past it, the press was a drag all along. What is given up is sweeping
       * text in one motion on a *freshly selected* positioned element — click once to enter the
       * text edit and the sweep is available again, because from then on the press lands inside a
       * live edit and takes the branch above.
       */
      if (this.#startMoveGesture(el, event)) return;

      this.#pressBeganInTextEdit = true;
      this.beginTextEdit(el, 'leave-selection');
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
      /*
       * Read and cleared first, before any early return can strand it.
       *
       * A sweep that releases over the overlay's chrome, or after edit mode has been turned
       * off, still has to leave this flag describing nothing — otherwise the next ordinary
       * click on the page would be mistaken for the tail of that gesture and swallowed.
       */
      const endedASweep = this.#pressBeganInTextEdit;
      this.#pressBeganInTextEdit = false;

      if (!this.editing) return;
      if (isOverlayEvent(event)) return;

      /*
       * In edit mode a link is content, so it never navigates. Settled before anything else.
       *
       * The rest of this handler is about selecting and text editing, and it returns early once
       * the element is already being edited — which is exactly when clicking inside a link took
       * the user off the page. So the first click was safe, and every click after it, made while
       * placing the caret to edit the link's words, followed the href. Placing this above the
       * early returns is the whole fix: navigation is off for as long as edit mode is on,
       * whatever is selected and whatever is being edited.
       */
      const anchor = eventAnchor(event);
      if (anchor) event.preventDefault();

      const native = isNativeInputEvent(event);

      /*
       * The release that ends a text sweep is not a click on whatever is under the pointer.
       *
       * Selecting to the end of a paragraph means dragging past its last line, and reaching
       * its final word means dragging past its right edge — so the pointer leaving the box
       * mid-sweep is the normal case, not an edge one. When it does, the release lands on
       * something else and the browser reports the click against the nearest common ancestor,
       * which is usually `<body>`.
       *
       * Read as a fresh click, that ended the edit and selected `<body>`, and removing
       * `contenteditable` collapsed the selection — so the words the user had just swept
       * disappeared at the exact moment they let go. Which reads as "moving outside the box
       * cancels my selection", because letting go is when it becomes visible.
       *
       * The press is what says which gesture this is. It began inside the element being
       * edited, so this click belongs to that element however far the pointer travelled. The
       * default is still suppressed — in edit mode the page does not act on clicks — but
       * nothing about the selection or the edit changes.
       */
      if (endedASweep) {
        if (!native) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      const el = selectableFromEvent(event);
      if (!el) return;
      if (this.store.value.textEditing === el) return;

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

    /*
     * Dragging from inside a link selects its text rather than picking the link up.
     *
     * Anchors are draggable by default, so a press-and-sweep over a link's words — the ordinary
     * way anyone selects text — started a native link drag instead, and the words could not be
     * selected at all. Cancelling the drag at `dragstart` hands the gesture back to the
     * selection, which is what it was for.
     *
     * Scoped to links, and to edit mode. A drag that begins anywhere else is left alone.
     */
    on(document, 'dragstart', (event) => {
      if (!this.editing) return;
      if (isOverlayEvent(event)) return;
      if (eventAnchor(event)) event.preventDefault();
    });

    /*
     * A paste is measured on the way in, and tidied up on the way out.
     *
     * What arrives from a clipboard is full of U+00A0 — the source page's own hard spaces,
     * plus the ones the browser substitutes wherever a plain space would collapse — and
     * `innerHTML` serialises every one of them as `&nbsp;`. Left alone, copying a sentence
     * from one page into another turns every gap between its words into an entity in the
     * user's source file, which is not what anyone pasting text is asking for.
     *
     * The paste is not intercepted. Cancelling it and re-inserting the clipboard by hand
     * would mean reimplementing what the browser does with a fragment — merging, caret
     * placement, its own undo stack — and getting any of that subtly wrong costs more than
     * the entity does. Instead the text is noted here, before the DOM changes, and compared
     * against afterwards; the difference is the pasted region, and only that region is
     * touched. Everything the author wrote around it, `10&nbsp;km` included, is untouched
     * because it is outside the span that changed.
     */
    on(document, 'paste', (event) => {
      const el = this.store.value.textEditing;
      if (!el) return;
      if (!event.composedPath().includes(el)) return;
      this.#pastedInto = { el, text: el.textContent ?? '' };
    });

    /*
     * The paste has landed by the time an `input` fires, so this is where it gets cleaned.
     *
     * Keyed off the note rather than off `inputType`, because browsers disagree about how
     * many events one paste is: Chrome sends a single `insertFromPaste`, others split the
     * replaced selection into a delete and an insert. Whichever it is, the first `input`
     * after the paste is the one that follows the DOM change, and one pass over the region
     * is all it takes.
     */
    on(document, 'input', (event) => {
      const pending = this.#pastedInto;
      if (!pending) return;
      if (!event.composedPath().includes(pending.el)) return;
      this.#pastedInto = null;
      if (pending.el !== this.store.value.textEditing || !pending.el.isConnected) return;
      restorePlainSpaces(pending.el, pending.text);
    });

    // Remembered as it happens, because the toolbar's link field destroys it when focused.
    on(document, 'selectionchange', () => {
      const el = this.store.value.textEditing;
      if (!el) return;
      const selection = getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;
      this.#textEditRange = range.cloneRange();
    });

    on(document, 'keydown', (event) => {
      /*
       * Whether the editor consumed this keystroke, measured rather than assumed.
       *
       * The keymap says so by calling `preventDefault`, and that is the set the page must
       * not also act on — an arrow that moved the selected element should not additionally
       * advance the page's carousel. Compared before and after because the page may have
       * prevented the default itself, in a capture handler that ran first, and one page
       * handler silencing another would be a bug this feature invented.
       */
      const prevented = event.defaultPrevented;
      // Tab first, and only while editing: it decides *where* the next keystroke
      // will land, which every other binding then depends on.
      if (this.store.value.editing && containTab(event)) {
        this.#claimKey(event, prevented);
        return;
      }
      handleKeyDown(this, event);
      this.#claimKey(event, prevented);
    });

    const geometry = (): void => this.#bumpGeometry();
    on(window, 'scroll', geometry as (event: Event) => void);
    on(window, 'resize', geometry as (event: Event) => void);

    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!this.history.netSize) return;
      event.preventDefault();
      event.returnValue = '';
    };
    listen(window, 'beforeunload', beforeUnload as EventListener);
    this.#listeners.push(() => unlisten(window, 'beforeunload', beforeUnload as EventListener));

    /*
     * And the page stops hearing about interactions the editor owns.
     *
     * Installed here rather than at mount so it is torn down with everything else: the
     * patch itself stays, but the policy is what gives it an opinion, and an unmounted
     * editor has none.
     */
    if (this.options.shieldPageEvents !== false) {
      setShieldPolicy(this.#ownsInteraction);
      this.#listeners.push(() => setShieldPolicy(null));
      // The layer that covers page-targeted events during a gesture the editor owns —
      // an arrow key inside a `contenteditable` being the case that needed it.
      this.#listeners.push(shieldOwnedEvents());
    }
  }

  /**
   * Record that the keymap consumed this keystroke, and stop it there.
   *
   * `preventDefault` is how the keymap says it acted, so comparing before and after is how
   * that is measured — and comparing rather than reading is what stops a page handler that
   * cancelled the default itself from being mistaken for the editor.
   *
   * Then it stops propagating. An arrow that moved the selected element should not also
   * advance the page's carousel, and this is the only layer that can say so: the keystroke
   * targets a page element, so nothing about its path identifies it as the editor's.
   * Because this runs in the capture phase on `document`, stopping here skips every page
   * handler below and every bubble handler above, while leaving the editor's own
   * same-target listeners untouched.
   *
   * Overlay-origin keys are left alone deliberately. They are layer 2's job — stopped on
   * the way *out*, once the control they were aimed at has had them — and stopping one here
   * would take it away from that control.
   */
  #claimKey(event: KeyboardEvent, preventedBefore: boolean): void {
    if (preventedBefore || !event.defaultPrevented) return;
    claimEvent(event);
    if (this.options.shieldPageEvents === false) return;
    if (!isOverlayEvent(event)) event.stopPropagation();
  }

  /**
   * Whether the editor owns the interaction an event belongs to.
   *
   * The second half of the event shield: the first half is geometric — anything that
   * happened inside the overlay is the overlay's — and this is the half that has to reason
   * about state, because the interactions that matter most happen on *page* elements.
   * Typing into a paragraph and dragging an element to reorder it both target the page and
   * never pass through the overlay at all.
   *
   * Deliberately narrow. Edit mode on its own is not ownership: the user still clicks
   * around a page that is still a page, and a wholesale block would break the very site
   * they are editing. What counts is a gesture in flight — a live text edit, a reorder, an
   * open modal — where a second listener acting on the same input can only interfere.
   */
  #ownsInteraction = (_event: Event, family: EventFamily): boolean => {
    /*
     * A modal owns everything, which is what the word means.
     *
     * `modalOpen` already locks page scrolling through CSS for the same reason; this is
     * the other half of it. The user's own example lives here: a wheel over a full-screen
     * dialog is not a request to scroll whatever the page does with wheels.
     */
    if (modalOpen()) return true;

    const state = this.store.value;

    /*
     * A live text edit owns the keys, the caret and the sweep that selects with it.
     *
     * `wheel` is left out on purpose. Scrolling while the caret is somewhere is an
     * ordinary thing to do, and the page moving its own furniture in response is not
     * interference — it is the page working. The keys are the opposite: an arrow inside a
     * paragraph is the caret's, and nothing else's.
     */
    if (state.textEditing) {
      return (
        family === 'keyboard' ||
        family === 'text' ||
        family === 'selection' ||
        family === 'pointer' ||
        family === 'drag'
      );
    }

    /*
     * A reorder in flight owns the pointer, and Escape, which cancels it.
     *
     * The gesture moves the real element as the pointer travels, so the page sees a stream
     * of pointer events over content that is rearranging itself — the worst possible input
     * for a handler that assumes the layout is standing still.
     */
    if (state.drag) {
      return family === 'pointer' || family === 'keyboard' || family === 'drag';
    }

    /*
     * A handle drag owns the same three, for the same reasons and one more.
     *
     * The element's own geometry is changing under the pointer, so any page handler watching for
     * pointer movement is being fed a layout that will not hold still. `keyboard` matters here in
     * its own right: Shift and Alt are part of the gesture — they lock the ratio and move the
     * anchor — so those keystrokes belong to the drag and not to whatever the page binds them to.
     */
    if (state.transform) {
      return family === 'pointer' || family === 'keyboard' || family === 'drag';
    }

    return false;
  };

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

/**
 * How far the pointer has to travel before a press on a positioned element becomes a move.
 *
 * The same four pixels the drag thumb uses, and for the same reason: a deliberate click must
 * never be read as a drag, and a fast drag must never be read as a click. Distance rather than
 * time, because time makes a slow, careful click into a gesture the user did not ask for.
 */
const MOVE_THRESHOLD = 4;

/** How far a handle drag must travel before it is allowed to scroll the page towards an edge. */
const TRANSFORM_SCROLL_TRAVEL = 28;

/** The editing space: a real character in the DOM, and `&nbsp;` once serialised. */
const NBSP = '\u00a0';

/**
 * Turn the browser's editing spaces back into plain ones, where the two mean the same thing.
 *
 * A `contenteditable` region does not hold the characters you typed. Wherever a plain space
 * would collapse to nothing — beside another space, or at the edge of the content — the
 * browser stores U+00A0 instead, because that is the only way HTML can keep the gap on
 * screen. `innerHTML` then serialises U+00A0 as `&nbsp;`, so every one of them that survives
 * the edit is an entity in the user's source file. Pasting a sentence copied from another
 * page is the loudest case: the clipboard carries the source page's own hard spaces, so
 * every gap between its words arrives as one.
 *
 * Two conditions, and both are necessary.
 *
 * **It must render identically.** A lone hard space with real characters either side takes
 * exactly the width a plain space would, so swapping it changes nothing anyone can see. Every
 * other position is load-bearing: in `one<nbsp> two` or `one two<nbsp>` the hard space *is*
 * the second space and the trailing space, and turning those into plain ones would collapse
 * them away. Multiple spaces are something a user is entitled to type, and this must never be
 * what takes them back out. Whitespace-preserving elements are the exception in the other
 * direction — under `pre` a plain space run survives on its own, so there every hard space is
 * interchangeable.
 *
 * **It must be part of what changed.** A hard space an author wrote deliberately, in
 * `10&nbsp;km` or `Mr.&nbsp;Smith`, is indistinguishable from one the browser invented — the
 * only thing separating them is that the author's was already there. So the text is compared
 * against how it started and only the span between the first and last difference is
 * considered. Everything either side keeps exactly what it had.
 *
 * The substitution is one character for one character, which is what makes it safe to run
 * under a live caret: every offset in every text node still means what it meant, so the
 * insertion point does not move and no selection is lost.
 *
 * Unattributed, because writing to a text node goes through a setter `provenance` watches,
 * and an element marked script-rendered for having had its spaces tidied is an element the
 * editor then refuses to trust.
 */
function restorePlainSpaces(el: HTMLElement, before: string): boolean {
  const after = el.textContent ?? '';
  if (!after.includes(NBSP)) return false;

  const span = changedSpan(before, after);
  if (!span) return false;

  return withoutProvenance(() => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const preserving = new Map<Element, boolean>();
    let changed = false;
    let offset = 0;

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = node.nodeValue ?? '';
      // The walker visits text nodes in the order `textContent` concatenates them, so a
      // running count lines the node up with the offsets `changedSpan` reported.
      const start = offset;
      offset += data.length;
      if (!data.includes(NBSP)) continue;

      const parent = node.parentElement;
      const keepsRuns = parent != null && preservesSpaceRuns(parent, preserving);
      let next = '';

      for (let i = 0; i < data.length; i += 1) {
        const character = data[i];
        const at = start + i;
        const swappable =
          character === NBSP &&
          at >= span.start &&
          at < span.end &&
          (keepsRuns || standsForASpace(after, at));
        next += swappable ? ' ' : character;
      }

      if (next === data) continue;
      node.nodeValue = next;
      changed = true;
    }
    return changed;
  });
}

/**
 * Whether a plain space at this offset would render the way the hard space there does.
 *
 * True only for a hard space with a non-space character on each side. Anything else is
 * holding a gap open that a plain space cannot hold: a neighbouring space means this one is
 * the second of a run, and a missing neighbour means it is at the edge of the content, where
 * plain whitespace is dropped.
 *
 * `\s` covers U+00A0 in JavaScript, so a run of hard spaces stops itself — which is the
 * conservative answer and the right one. Rewriting one of a pair would happen to preserve
 * the width, but only until the next pass looked at the other.
 */
function standsForASpace(text: string, at: number): boolean {
  const before = text[at - 1];
  const after = text[at + 1];
  if (before === undefined || after === undefined) return false;
  return !/\s/.test(before) && !/\s/.test(after);
}

/**
 * Whether this element renders a run of plain spaces as a run.
 *
 * Inside one, the hard space has no job to do — `pre` and its relatives keep every space
 * that is written — so all of them can go back to being spaces. Read from the computed
 * style because the mode inherits, and cached per element because a paste into a list of
 * `<code>` spans would otherwise ask the same question of each of them.
 *
 * `pre-line` is deliberately absent: it keeps newlines and collapses spaces, so a run there
 * still needs the hard spaces to survive.
 */
function preservesSpaceRuns(el: Element, cache: Map<Element, boolean>): boolean {
  const known = cache.get(el);
  if (known !== undefined) return known;
  const mode = getComputedStyle(el).whiteSpace;
  const preserved = mode === 'pre' || mode === 'pre-wrap' || mode === 'break-spaces';
  cache.set(el, preserved);
  return preserved;
}

/**
 * The span of `after` that `before` does not account for, or null when nothing was added.
 *
 * A common prefix and a common suffix, which is all that is needed: an edit is a contiguous
 * replacement, so whatever sits between the first and the last difference is what arrived.
 * Cheap enough to run on every paste and every commit, and it needs no diff algorithm to be
 * right about the case it is used for.
 */
function changedSpan(before: string, after: string): { start: number; end: number } | null {
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before[start] === after[start]) start += 1;

  let tail = 0;
  while (
    tail < shortest - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  const end = after.length - tail;
  return end > start ? { start, end } : null;
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

/**
 * The link an event happened inside, if any.
 *
 * Read from the composed path rather than with `closest` on the target, because a click can land
 * on a text node or inside a shadow tree, and the path is the one list that crosses both.
 */
function eventAnchor(event: Event): HTMLAnchorElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) return node;
  }
  return null;
}

function parseArray<T>(value: T[] | string): T[] {
  if (typeof value !== 'string') return Array.isArray(value) ? value : [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/**
 * The links the current selection sits in, or failing that the ones matching a URL.
 *
 * `intersectsNode` rather than a string comparison, so a link counts because the selection is
 * in it and not because its href happens to read the same as what was typed. The URL fallback
 * covers the collapsed case, where a link was inserted at a caret and there is no span to test.
 */
function selectedAnchors(el: HTMLElement, url?: string): HTMLAnchorElement[] {
  const anchors = Array.from(el.querySelectorAll('a[href]')).filter(
    (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
  );
  const selection = getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range && !range.collapsed) {
    const touched = anchors.filter((anchor) => range.intersectsNode(anchor));
    if (touched.length) return touched;
  }
  return url === undefined ? [] : anchors.filter((anchor) => anchor.getAttribute('href') === url);
}

/** `rel` with the new-tab tokens added or removed, leaving the author's own tokens in place. */
function withRel(rel: string | null, newTab: boolean): string {
  const ours = new Set(['noopener', 'noreferrer']);
  const tokens = (rel ?? '').split(/\s+/).filter((token) => token && !ours.has(token.toLowerCase()));
  if (newTab) tokens.push('noopener', 'noreferrer');
  return tokens.join(' ');
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
