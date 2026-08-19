import { ClassRegistry, normalizeClassName, suggestClassName } from './classes.js';
import { HOST_TAG, IGNORE_ATTR, VERSION } from './constants.js';
import { inlineDeclarations } from './css.js';
import { findDropTarget } from './drop-target.js';
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
import { History, nextChangeId, type Command } from './history.js';
import { handleKeyDown, matchesShortcut } from './keymap.js';
import { BlockLibrary, blockFromSource } from './library.js';
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
import { Store } from './store.js';
import { TokenRegistry } from './tokens.js';
import type {
  BlockKind,
  ChangeRecord,
  DesignSystemDocument,
  DragState,
  EditorSnapshotState,
  LibraryBlock,
  MountOptions,
  PanelId,
  SavePayload,
} from './types.js';

export interface ToastMessage {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
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
  error: string;
}

export interface BlockExtraction {
  mode: 'block';
  element: HTMLElement;
  name: string;
  kind: BlockKind;
  category: string;
  description: string;
  html: string;
  css: string;
  error: string;
}

export type Extraction = ClassExtraction | BlockExtraction;

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
  #toastTimer = 0;
  #toastId = 0;
  #textEditSnapshot: string | null = null;
  #injectedElements = new Set<string>();
  #destroyed = false;

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
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.endTextEdit(true);
    for (const off of this.#listeners) off();
    this.#listeners = [];
    for (const observer of this.#observers) observer.disconnect();
    this.#observers = [];
    if (this.#geometryFrame) cancelAnimationFrame(this.#geometryFrame);
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.tokens.destroy();
    this.classes.destroy();
    this.library.destroy();
  }

  #seedFromOptions(): void {
    const { options } = this;
    try {
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
    this.#captureBaseline(el, property);
    this.history.commit(setStyleProperty(el, property, value));
    this.#bumpRevision();
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
    return (el.style.getPropertyValue(property) || '') !== (baseline ?? '');
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
   * Edit a declaration on a live CSS rule.
   *
   * Distinct from `setStyle`, which writes an inline override on one element.
   * Editing the rule changes every element it matches, which is what the user
   * means when they adjust a value shown under a class selector — and it keeps
   * the change expressible as a stylesheet edit rather than a pile of inline
   * styles for the agent to clean up.
   */
  setRuleDeclaration(rule: CSSStyleRule, property: string, value: string): void {
    const before = rule.style.getPropertyValue(property);
    const beforePriority = rule.style.getPropertyPriority(property);
    const after = value.trim();
    const selector = rule.selectorText;
    const target = this.store.value.selected;

    this.history.commit({
      label: `Set ${property} on ${selector}`,
      mergeKey: `rule:${selector}:${property}`,
      subject: `rule:${selector}:${property}`,
      record: {
        id: nextChangeId(),
        kind: 'style',
        summary: `Set ${property} to ${after || '(removed)'} in the ${selector} rule`,
        target: selector,
        before: before || undefined,
        after: after || undefined,
        detail: { property, value: after, selector, scope: 'stylesheet rule' },
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
        error: '',
      },
    });
  }

  /** Open the extract-to-block dialog for the selected element. */
  beginBlockExtraction(el = this.store.value.selected): void {
    if (!el) return;
    this.store.patch({
      extraction: {
        mode: 'block',
        element: el,
        name: suggestBlockName(el),
        kind: el.children.length > 0 ? 'container' : 'component',
        category: 'Extracted',
        description: `Captured from ${labelFor(el)}.`,
        html: formatHTML(cleanMarkup(el)),
        // Ship the classes the element relies on, so the block still looks right
        // in a project that does not have them yet.
        css: this.#cssForSubtree(el),
        error: '',
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
      this.#commitClass(pending.element, name, declarations, pending.stripInline);
      this.store.patch({ extraction: null });
      return true;
    }

    const name = pending.name.trim();
    if (!name) {
      this.updateExtraction({ error: 'Give the block a name.' });
      return false;
    }
    if (!pending.html.trim()) {
      this.updateExtraction({ error: 'The block has no markup.' });
      return false;
    }
    try {
      const block = this.library.upsert(
        blockFromSource({
          id: this.library.uniqueId(name),
          name,
          kind: pending.kind,
          category: pending.category,
          description: pending.description,
          html: pending.html,
          css: pending.css,
        }),
      );
      this.store.patch({ extraction: null });
      this.notify(`Saved ${block.name} to the library.`, 'success');
      return true;
    } catch (error) {
      this.updateExtraction({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
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
   */
  #commitClass(
    el: HTMLElement,
    className: string,
    declarations: Record<string, string>,
    stripInline: boolean,
  ): void {
    const previousEntry = this.classes.get(className);
    const previousStyle = el.getAttribute('style');
    const previousClass = el.getAttribute('class');
    const nextClass = [...new Set([...Array.from(el.classList), className])].join(' ');

    // Only remove the declarations the class now carries; anything the user chose
    // to leave behind stays on the element.
    const remaining = { ...inlineDeclarations(el) };
    for (const property of Object.keys(declarations)) delete remaining[property];
    const remainingCss = Object.entries(remaining)
      .map(([property, value]) => `${property}: ${value}`)
      .join('; ');

    this.history.commit({
      label: `Extract .${className}`,
      subject: `class-extract:${className}`,
      record: {
        id: nextChangeId(),
        kind: 'token-class',
        summary: `Extract ${Object.keys(declarations).length} declarations from ${labelFor(el)} into .${className}`,
        target: selectorFor(el),
        source: nearestSourceRef(el),
        after: className,
        detail: Object.fromEntries(Object.entries(declarations)),
        at: Date.now(),
      },
      apply: () => {
        this.classes.upsert({ name: className, declarations, origin: 'user' });
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
    this.notify(`Created .${className} and applied it.`, 'success');
  }

  /* ---------------------------------------------------------------------- */
  /* Structure                                                              */
  /* ---------------------------------------------------------------------- */

  duplicate(el = this.store.value.selected): void {
    if (!isMutable(el)) return;
    const result = duplicateElement(el);
    if (!result) return;
    this.history.commit(result.command);
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
    this.history.commit(command);
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
    try {
      const { nodes } = await this.library.instantiate(block, props);
      if (!nodes.length) {
        this.notify('That block produced no markup.', 'error');
        return null;
      }
      const command = insertNodes(target.reference, target.position, nodes, `Insert ${block.name}`);
      if (!command) return null;
      this.history.commit(command);
      if (block.element?.tag) this.#injectedElements.add(block.element.tag);
      this.store.patch({ insertAnchor: null });
      this.select(nodes[0]);
      this.notify(`Inserted ${block.name}.`, 'success');
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
      el.innerHTML = before;
      return;
    }
    if (after === before) return;
    this.history.commit(setInnerHTML(el, before, after), { alreadyApplied: true });
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
    this.endTextEdit(true);
    el.style.setProperty('pointer-events', 'none', 'important');
    this.store.patch({
      drag: {
        element: el,
        origin: { parent: el.parentNode, nextSibling: el.nextSibling },
        pointer: { x, y },
        willCancel: false,
        hint: 'Drag to a new position',
      },
      hovered: null,
      quickMenuOpen: false,
      insertAnchor: null,
    });
  }

  /**
   * Update the in-flight drag.
   *
   * The dragged element is physically moved to the candidate position rather
   * than previewed with a placeholder line, so what the user sees during the
   * drag is the real layout they will get on release. The move only happens when
   * the target actually changes, which keeps reflow cost proportional to
   * meaningful movement instead of to pointer events.
   */
  updateDrag(x: number, y: number): void {
    const drag = this.store.value.drag;
    if (!drag) return;

    const outside = x < 4 || y < 4 || x > innerWidth - 4 || y > innerHeight - 4;
    if (outside) {
      if (!drag.willCancel) {
        drag.origin.parent.insertBefore(drag.element, drag.origin.nextSibling);
      }
      this.store.patch({
        drag: { ...drag, pointer: { x, y }, willCancel: true, hint: 'Release outside to cancel' },
      });
      return;
    }

    const drop = findDropTarget(drag.element, x, y);
    if (!drop) {
      this.store.patch({ drag: { ...drag, pointer: { x, y }, willCancel: false } });
      return;
    }

    const needsMove =
      drag.element.parentNode !== drop.parent || drag.element.nextSibling !== drop.before;
    if (needsMove) {
      try {
        drop.parent.insertBefore(drag.element, drop.before);
      } catch {
        // Inserting into a node that cannot accept the element; ignore and wait
        // for the pointer to move somewhere valid.
      }
    }
    this.store.patch({
      drag: { ...drag, pointer: { x, y }, willCancel: false, hint: drop.hint },
    });
    if (needsMove) this.#bumpGeometry();
  }

  endDrag(): void {
    const drag = this.store.value.drag;
    if (!drag) return;
    drag.element.style.removeProperty('pointer-events');
    tidyStyleAttribute(drag.element);

    if (drag.willCancel) {
      drag.origin.parent.insertBefore(drag.element, drag.origin.nextSibling);
      this.store.patch({ drag: null });
      this.notify('Move cancelled.', 'info');
      this.#bumpGeometry();
      return;
    }

    const command = moveCommandFromOrigin(drag.element, drag.origin, 'Move');
    this.store.patch({ drag: null });
    if (command) {
      this.history.commit(command, { alreadyApplied: true });
      this.notify('Moved.', 'success', { label: 'Undo', run: () => this.undo() });
    }
    this.#bumpGeometry();
  }

  cancelDrag(): void {
    const drag = this.store.value.drag;
    if (!drag) return;
    drag.element.style.removeProperty('pointer-events');
    tidyStyleAttribute(drag.element);
    drag.origin.parent.insertBefore(drag.element, drag.origin.nextSibling);
    this.store.patch({ drag: null });
    this.#bumpGeometry();
  }

  /* ---------------------------------------------------------------------- */
  /* History                                                                */
  /* ---------------------------------------------------------------------- */

  undo(): void {
    this.endTextEdit(true);
    const command = this.history.undo();
    if (!command) return;
    this.notify(`Undid: ${command.label}`, 'info');
    this.#bumpGeometry();
    this.#bumpRevision();
  }

  redo(): void {
    this.endTextEdit(true);
    const command = this.history.redo();
    if (!command) return;
    this.notify(`Redid: ${command.label}`, 'info');
    this.#bumpGeometry();
    this.#bumpRevision();
  }

  resetAll(): void {
    this.endTextEdit(false);
    const selected = this.store.value.selected;
    this.history.reset();
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

  /* ---------------------------------------------------------------------- */
  /* Save and export                                                        */
  /* ---------------------------------------------------------------------- */

  buildSavePrompt(): string {
    return buildPrompt({
      records: this.history.records,
      tokens: this.tokens.export(),
      classes: this.classes.export(),
      blocks: this.library.list(),
      tokenCSS: this.tokens.toCSS(),
      classCSS: this.classes.toCSS(),
      pageURL: location.href,
      injectedElements: [...this.#injectedElements],
    });
  }

  previewSave(): void {
    // Net size, not stack depth: a page whose edits all cancelled out has nothing
    // worth handing off even though undo history is not empty.
    if (!this.history.netSize) {
      this.notify('Nothing has changed yet.', 'info');
      return;
    }
    this.endTextEdit(true);
    this.store.patch({ savePreview: this.buildSavePrompt() });
  }

  closeSavePreview(): void {
    this.store.patch({ savePreview: null });
  }

  async save(): Promise<boolean> {
    if (!this.history.netSize) {
      this.notify('Nothing has changed yet.', 'info');
      return false;
    }
    this.endTextEdit(true);
    this.store.patch({ saving: true });
    const payload: SavePayload = {
      prompt: this.buildSavePrompt(),
      records: this.history.records,
      designSystem: this.designSystem(),
      html: exportHTML(),
      fileName: this.options.fileName ?? 'edited-page.html',
    };

    try {
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
    downloadText(this.options.fileName ?? 'edited-page.html', exportHTML(), 'text/html');
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

  importDesignSystemText(text: string, overwrite = false): void {
    try {
      const result = importDesignSystem(text, this, { overwrite });
      this.notify(
        `Imported ${result.tokens} tokens, ${result.classes} classes and ${result.blocks} blocks.`,
        'success',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(`Import failed: ${message}`, 'error');
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
      // A pointerdown outside the active text edit ends it, matching how every
      // other inline editor behaves.
      const editing = this.store.value.textEditing;
      if (editing) {
        const path = event.composedPath();
        if (!path.includes(editing) && !path.some(isOverlayChrome)) this.endTextEdit(true);
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

    on(document, 'keydown', (event) => handleKeyDown(this, event));

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

function isOverlayChrome(node: EventTarget): boolean {
  return node instanceof Element && node.tagName.toLowerCase() === 'html-editor-overlay';
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
