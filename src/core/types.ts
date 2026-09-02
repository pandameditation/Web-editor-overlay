import type { ElementAnchor } from './html-patch.js';
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

/**
 * A CSS rule the editor owns: a selector and the declarations it sets.
 *
 * The third kind of vocabulary, and the one the other two cannot express. A token
 * names a value and a class names a group of declarations you have to go and put on
 * an element; neither can say "every `h2` in this page is this size" or "a `p`
 * directly inside `.prose` gets this measure". That is a rule, and until now the only
 * way to write one was to open the CSS panel and type it.
 *
 * Keyed on the selector, because that is what identifies it — two rules with the same
 * selector are one rule with the declarations merged, which is also how a stylesheet
 * behaves. Complex selectors are the point rather than an edge case: `h2 > p`,
 * `.card .title`, `a:hover` and `p::first-line` are all ordinary values here.
 */
export interface DesignRule {
  /** The selector as written, whitespace normalised: `h2`, `h2 > p`, `a:hover`. */
  selector: string;
  declarations: Record<string, string>;
  /** Human label shown in lists. Defaults to the selector itself. */
  label?: string;
  description?: string;
  /**
   * Where the rule came from.
   *
   * `'stylesheet'` means it was read out of the page's own CSS rather than written here,
   * and it is the origin that decides whether the rule is emitted: a scanned rule is
   * already in a file, so re-emitting it would turn a diff into a copy of the theme. The
   * moment one is edited it becomes `'user'` and is emitted as an override — the same
   * arrangement tokens and reusable classes have, for the same reason.
   */
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

/** A portable design system: tokens, classes, rules and blocks in one document. */
export interface DesignSystemDocument {
  $schema?: string;
  name: string;
  version: number;
  createdAt?: string;
  tokens: DesignToken[];
  classes: DesignClass[];
  blocks: LibraryBlock[];
  /**
   * Optional so a document written before rules existed still type-checks, and so a
   * caller handing one in by hand does not have to supply an empty array. Everything
   * the editor produces sets it.
   */
  rules?: DesignRule[];
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
  | 'token-class'
  | 'token-rule'
  /**
   * A block added to, changed in, or removed from the library.
   *
   * Its own kind rather than folded into `token`, because it is the one part of the design
   * system that is not CSS: a block is markup plus props plus, sometimes, a module, so it
   * reaches a file as a seed rather than as a rule. Sharing a kind with tokens would have the
   * write plan offer it to a stylesheet, which cannot hold one.
   */
  | 'block';
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
  /**
   * How to find this change's element in the HTML file.
   *
   * Captured when the edit is made, because by save time the DOM has moved on and nothing
   * positional means what it meant. Absent when the element offered nothing durable to
   * anchor to, which is what makes the save fall back to writing the whole file.
   */
  anchor?: ElementAnchor;
  /**
   * Key of the element this change was made to.
   *
   * For reading the finished value back out of the page at save time: a style record holds one
   * declaration rather than the whole `style` attribute, so the element has to be consulted.
   * A key rather than the node, because records are copied and serialized as plain data.
   */
  elementRef?: string;
  /**
   * The element's markup either side of a text edit, tags and all.
   *
   * `before` and `after` carry the *text*, because that is what the change list and the prompt
   * show, and tags in there would be noise. But it means a change that only alters markup —
   * wrapping a word in a link is the plain example — reads as identical either side, and the
   * step that discards changes whose net effect is nothing then discarded it: the link appeared
   * on screen and no record of it existed, so nothing carried it to a file. This is what that
   * comparison uses instead.
   */
  markupBefore?: string;
  markupAfter?: string;
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

  /**
   * Keep the page's own event listeners out of the editor's interactions. Defaults on.
   *
   * The overlay is a second application layered over the page, and the page is still
   * listening: a `wheel` handler that hijacks scrolling fires while a dock panel is being
   * scrolled, and arrow keys bound to a carousel fire while the caret is being moved
   * through a paragraph. Neither page is misbehaving — it has no way to know the editor
   * exists — so the editor is what has to draw the line.
   *
   * Two things are suppressed, and only for the page's handlers on `window`, `document`,
   * `<html>` and `<body>`: events that happened inside the overlay's own chrome, and
   * events belonging to a gesture the editor owns — a live text edit, a reorder in
   * flight, an open modal. Lifecycle and navigation events always get through.
   *
   * Worth turning off in one situation: a page whose own behaviour is the thing being
   * edited and has to keep running exactly as it does normally. Doing so brings back the
   * interference, which is the trade.
   */
  shieldPageEvents?: boolean;

  /**
   * Whether to work out which content the page's JavaScript renders. Defaults on.
   *
   * When it does, inline text editing is refused on that content and the code
   * responsible is offered instead — because an edit there is thrown away by the next
   * render, silently and much later, which is the least helpful moment to find out.
   *
   * Worth turning off in one situation: a page whose JavaScript rebuilds the DOM
   * constantly, where the extra `MutationObserver` is measurable and the answer would
   * be "all of it" anyway.
   */
  detectScriptContent?: boolean;
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
