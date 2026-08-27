/**
 * Shared types for the editor overlay.
 *
 * Everything the host page can pass in, and everything the overlay hands back,
 * is declared here so the public surface stays in one readable place.
 */

import type { DropDecision } from './drop-target.js';

export type { DropDecision };

/** Which dock panel is showing. */
export type PanelId =
  | 'styles'
  | 'tokens'
  | 'tree'
  | 'library'
  | 'props'
  | 'media'
  | 'code'
  | 'seo';

/** A design token. `value` is the raw CSS value; `name` excludes the leading `--`. */
export interface DesignToken {
  name: string;
  value: string;
  group: TokenGroup;
  /** Human label shown in pickers. Defaults to a prettified `name`. */
  label?: string;
  /** Where the token came from, for provenance in the save prompt. */
  origin?: 'stylesheet' | 'user' | 'imported' | 'preset';
  description?: string;
}

export type TokenGroup =
  | 'color'
  | 'space'
  | 'size'
  | 'radius'
  | 'shadow'
  | 'font'
  | 'border'
  | 'motion'
  | 'other';

/** A reusable class: a named group of declarations, i.e. a utility/component class. */
export interface DesignClass {
  name: string;
  declarations: Record<string, string>;
  label?: string;
  description?: string;
  origin?: 'stylesheet' | 'user' | 'imported';
}

/** Declared prop on a library component. */
export interface PropSpec {
  type: 'text' | 'number' | 'color' | 'select' | 'url' | 'boolean' | 'token';
  label?: string;
  default?: string | number | boolean;
  options?: Array<string | { label: string; value: string }>;
  /** For `token` props, restrict the picker to one group. */
  tokenGroup?: TokenGroup;
  description?: string;
}

export type BlockKind = 'container' | 'component';

/**
 * A reusable block. `html` is a template; `{{prop}}` placeholders are replaced
 * with sanitized prop values at insert time.
 *
 * A block may additionally register a real custom element: supply `element`
 * with a tag name plus the source to evaluate. That is how a Lit/JS component
 * gets injected as `<my-widget>` into the page.
 */
export interface LibraryBlock {
  id: string;
  name: string;
  kind: BlockKind;
  html: string;
  description?: string;
  /** Group heading in the library panel. */
  category?: string;
  props?: Record<string, PropSpec>;
  /** CSS injected once when the block is first used. */
  css?: string;
  /** Inline SVG or emoji used as the card preview. */
  icon?: string;
  /** Register a custom element so the block can inject a real web component. */
  element?: {
    tag: string;
    /** ES module source. Evaluated once, in a blob module, at first insert. */
    module?: string;
    /** Bare class source for a non-Lit custom element. Ignored if `module` set. */
    script?: string;
  };

  /** Blocks that accept children get `+` affordances inside them. */
  slots?: boolean;
  origin?: 'preset' | 'user' | 'imported';
}

/** A portable design system: tokens, classes and blocks in one document. */
export interface DesignSystemDocument {
  $schema?: string;
  name: string;
  version: number;
  createdAt?: string;
  tokens: DesignToken[];
  classes: DesignClass[];
  blocks: LibraryBlock[];
}

/** Source location injected by the Vite plugin (or by hand) as `data-heo-src`. */
export interface SourceRef {
  file: string;
  line: number;
  column: number;
}

/** One semantic edit, recorded for the save prompt. */
export interface ChangeRecord {
  id: string;
  kind:
  | 'text'
  | 'style'
  | 'class'
  | 'attribute'
  | 'insert'
  | 'delete'
  | 'move'
  | 'wrap'
  | 'duplicate'
  | 'replace'
  | 'token'
  | 'token-class';
  /** Short human summary, e.g. `Set padding to var(--space-lg)`. */
  summary: string;
  /** CSS selector path to the target, resolved at record time. */
  target: string;
  /** Source location when the page was instrumented. */
  source?: SourceRef;
  /**
   * Opaque identity of the thing this change is about.
   *
   * Records sharing it describe successive edits to one element, stylesheet or
   * class, and the save prompt reports them as a single ordered unit. Without it,
   * duplicating a block and then moving the copy came out as two unrelated entries
   * that could sit pages apart — and `target` cannot stand in, because the
   * duplicate is recorded against the original's selector while the move is
   * recorded against the copy's.
   */
  group?: string;
  before?: string;
  after?: string;
  /**
   * Extra structured detail, read by the prompt and by the write plan.
   *
   * Most keys are prose the prompt interpolates. A few are a contract, because a
   * change that has to be written to a file needs to say which file and where in it:
   *
   * - `writeTo` — `'document'` when serializing the page already carries this
   *   change, or the URL of the file that has to be written on its own. Absent means
   *   `'document'`. This is the field that separates an edit the exported HTML
   *   captures from one it cannot.
   * - `scope` — what kind of thing was edited: `'stylesheet'`, `'stylesheet rule'`,
   *   `'inline script'`, `'external script'`, `'document head'`.
   * - `css` / `script` — the complete new contents, for a whole-file replacement.
   * - `rulePath` — a dotted index chain locating a rule in its sheet, e.g. `'4.1'`.
   *   Position rather than selector, so replaying an edit into a file does not
   *   depend on the file and the CSSOM spelling a selector the same way.
   * - `ruleContext` — JSON array of enclosing at-rule preludes, outermost first.
   * - `property`, `value`, `priority`, `selector` — one declaration, for a rule edit.
   *
   * Carried on the record rather than in a side table so an `onSave` handler gets
   * the same description the built-in write path works from.
   */
  detail?: Record<string, string>;
  at: number;
}

/** Options accepted by `mount()`. */
export interface MountOptions {
  /** Start with edit mode already on. Default `false`. */
  startInEditMode?: boolean;
  /** File name suggested when exporting HTML. */
  fileName?: string;
  /** Seed blocks, merged with the built-in presets unless `presets: false`. */
  blocks?: LibraryBlock[] | string;
  /** Seed tokens. Merged with tokens scanned from the page's stylesheets. */
  tokens?: DesignToken[] | string;
  /** Seed classes. */
  classes?: DesignClass[] | string;
  /** Load a whole design system in one object, or as JSON text. */
  designSystem?: DesignSystemDocument | string;
  /**
   * A design system as a single copy-pasteable string.
   *
   * What `designSystem` is for a file, this is for a message: the same tokens,
   * classes and blocks compacted and compressed into one URL-safe token that goes
   * anywhere a string goes. Produced by the Tokens panel or `api.exportSeed()`.
   *
   * A compressed seed decodes a tick after mounting, so `whenReady()` is the way
   * to wait for one; a page is usable before its vocabulary lands.
   */
  seed?: string;
  /** Include the built-in container/component presets. Default `true`. */
  presets?: boolean;
  /** Element the overlay attaches to. Defaults to `document.body`. */
  container?: HTMLElement;
  /**
   * Called when the user saves. Receives the generated prompt plus the full
   * change set. Return `false` (or a rejecting promise) to signal failure.
   */
  onSave?: (payload: SavePayload) => boolean | void | Promise<boolean | void>;
  /** Called on every committed change. */
  onChange?: (records: ChangeRecord[]) => void;
  /** Keyboard shortcut that toggles edit mode. Default `'mod+e'`. */
  toggleShortcut?: string;
  /** Override the accent colour of the overlay chrome. */
  accent?: string;
  /** `'dark'` (default) or `'light'` overlay chrome. */
  theme?: 'dark' | 'light';
  /**
   * URL of a dev-server endpoint that can read and write the project's files.
   *
   * Set by the Vite plugin, which knows the project root and can therefore offer
   * this safely; it is confined to that root on the server side, because a page is
   * not in a position to decide where it may write. Given one, the editor connects on
   * mount and saving writes files instead of producing a prompt.
   *
   * Without it — and without a folder handed over through the picker — nothing is
   * ever written, which is the default and the historical behaviour.
   *
   * The endpoint answers `GET` with `{ ok, root, base }`, `GET ?path=` with a file's
   * text, and `PUT ?path=` by writing the body to that file.
   */
  sourceEndpoint?: string;
  /**
   * Shared secret for `sourceEndpoint`, sent as `x-heo-token` on every request.
   *
   * A dev server is sometimes reachable from the network, and a `PUT` carrying a
   * plain-text body is a request a browser will send cross-origin without asking
   * first — so an endpoint that writes files cannot be left open to whoever finds it.
   * The token is generated per server start and inlined into a same-origin module,
   * which is somewhere another origin cannot read from. Requiring it in a header
   * rather than the URL also makes such a request non-simple, so it is stopped by the
   * preflight before it reaches the handler.
   */
  sourceToken?: string;
}

export interface SavePayload {
  /** Ready-to-paste instructions for an agent working in the codebase. */
  prompt: string;
  /** The change set the prompt was generated from. */
  records: ChangeRecord[];
  /** Current design system, so tokens/classes/blocks travel with the change. */
  designSystem: DesignSystemDocument;
  /** Full serialized document with the overlay stripped out. */
  html: string;
  fileName: string;
}

/** Live drag state while a reorder is in flight. */
export interface DragState {
  element: HTMLElement;
  /** Where the element started, so cancelling can put it back exactly. */
  origin: { parent: Node; nextSibling: Node | null };
  pointer: { x: number; y: number };
  /** Set when the pointer has left the viewport: release cancels. */
  willCancel: boolean;
  /** Human description of the pending drop, shown in the drag chip. */
  hint: string;
  /**
   * The parent whose children are being reordered.
   *
   * A drag only ever moves the element among this parent's children; becoming a
   * child of something else is a separate, dwell-gated gesture that changes this.
   */
  home: Node;
  /**
   * The hit test's last conclusion, fed back in on the next one so the
   * before/after choice stays stable around an element's midpoint.
   */
  decision: DropDecision | null;
  /** A re-parent being counted down: the chip says so, the DOM waits. */
  waiting: 'nest' | 'leave' | null;
  /**
   * True while a new position has been announced but not yet applied.
   *
   * The chip says where the element is heading immediately; the DOM waits out the
   * dwell delay. That split is what makes the gesture feel responsive without
   * letting a graze reflow the page.
   */
  pending: boolean;
}

export interface EditorSnapshotState {
  mounted: boolean;
  version: string;
  editing: boolean;
  dirty: boolean;
  selected: { tag: string; label: string; selector: string } | null;
  canUndo: boolean;
  canRedo: boolean;
  changes: number;
  dockOpen: boolean;
  dockTab: PanelId;
}
