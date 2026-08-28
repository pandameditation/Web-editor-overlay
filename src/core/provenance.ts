import { HOST_TAG, IGNORE_ATTR, INSERTED_ATTR, SOURCE_ATTR } from './constants.js';

/**
 * Who wrote this part of the page: the markup, or the JavaScript.
 *
 * The editor's central promise is that what you change on the page is a change you
 * can save. For text that JavaScript renders, that promise cannot be kept — the
 * next render overwrites it — and the failure is silent and delayed, which is the
 * worst shape it could take. The user types a new heading, it looks right, and some
 * later interaction quietly puts the old one back. So the honest thing is to know
 * which content is JS-owned and say so *before* the edit, and then point at the code
 * that actually decides it.
 *
 * Three signals, in descending order of how much they can tell you.
 *
 * **The template that declared it.** A page built with the Vite plugin already
 * carries `data-heo-src` on every tag inside a tagged template literal, which is to
 * say on Lit render output — file, line and column of the template itself. When that
 * file is JavaScript rather than HTML, the element is rendered rather than authored,
 * and the marker points at the exact line worth editing. Nothing has to be detected
 * at runtime for this to work, and for component-rendered content it is the *only*
 * signal that is any use: the actual DOM writes come from inside the framework, so a
 * stack trace names lit-html and not the template anyone wants to change.
 *
 * **The call that wrote it.** For a page with no build step, the DOM write APIs are
 * wrapped and a stack is captured as the write happens. This has to be synchronous
 * with the call — a `MutationObserver` callback is a microtask, by which time the
 * stack that caused it is long gone — which is the whole reason this module patches
 * anything at all.
 *
 * **That it changed at all.** Whatever else fails, a node inserted or rewritten after
 * the document finished parsing was not in the file. That supports the warning but
 * not the offer to edit, so it is the floor rather than the goal.
 *
 * What this deliberately does not do is guess. A node with no signal is treated as
 * authored, because a false positive here blocks an edit that would have worked, and
 * an editor that refuses to edit is worse than one that occasionally lets a change be
 * overwritten.
 */

export type ProvenanceKind =
  /** An edit was made here and something on the page replaced it. Proof, not inference. */
  | 'observed'
  /** A tagged template literal in a JS or TS file — Lit render output. */
  | 'template'
  /** A DOM write, caught in the act, with the calling frame recorded. */
  | 'script'
  /** Not in the page's own HTML file, whenever and however it got here. */
  | 'file'
  /** An attribute on the element holds exactly its text, so that is the real source. */
  | 'mirrored'
  /** Changed after the document parsed, by something that left no trace. */
  | 'runtime';

/**
 * How much the evidence actually supports.
 *
 * The distinction exists because these signals are not remotely equal, and pretending
 * they are is what makes the feature untrustworthy. Having caught a write with the
 * calling frame on the stack is a fact. Having found the same string somewhere in a
 * script is a coincidence until corroborated. Both used to produce the same flat
 * sentence, in the same tone, with the same consequence.
 *
 * - `certain` — observed happening, or named by the build. Say so plainly.
 * - `likely` — provable structural difference from the file, but nothing says what did it.
 * - `possible` — a pattern consistent with generated content, and with other things too.
 */
export type Confidence = 'certain' | 'likely' | 'possible';

export interface Provenance {
  kind: ProvenanceKind;
  /** How far the evidence goes. Drives the wording and nothing else — never a block. */
  confidence: Confidence;
  /** The attribute holding the text, for `mirrored`. */
  attribute?: string;
  /**
   * True when this covers everything inside the element, not just the element.
   *
   * `container.innerHTML = …` is one write that produces a whole tree, and the text a
   * user reaches for is rarely the node the write landed on — it is a heading three
   * levels down. Marking only the named node leaves all of that editable, which is the
   * hole that made a list of rendered cards feel like ordinary text. So the record
   * covers the subtree and descendants inherit it, which is both correct and cheaper
   * than walking a tree at write time.
   */
  subtree?: boolean;
  /**
   * Project-relative path, from build-time instrumentation.
   *
   * Already in the shape a `FileHost` wants, so it needs no resolving.
   */
  file?: string;
  /** Absolute URL of the script, from a captured stack. Needs `host.resolve`. */
  url?: string;
  line?: number;
  column?: number;
  /** The DOM call responsible, named as it appears in code. */
  api?: string;
  /**
   * True when the frame landed in a dependency rather than the project's own code.
   *
   * Reported rather than hidden: "lit-html wrote this" is not somewhere to send
   * someone to make an edit, and saying so is better than opening the wrong file.
   */
  vendor?: boolean;
}

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

const records = new WeakMap<Node, Provenance>();

/**
 * Elements the user has edited through the editor.
 *
 * These are exempt from every signal, and the baseline comparison is why they have to
 * be. It works by finding differences between the page and its file, and a committed
 * edit *is* such a difference — so without this, editing a paragraph would be what made
 * the editor decide the paragraph was generated, and the second edit would be refused
 * on the strength of the first.
 */
const userOwned = new WeakSet<Element>();

/** Take an element out of every provenance signal, permanently. */
export function markUserOwned(el: Element): void {
  userOwned.add(el);
}

/**
 * Whether writes are being attributed right now.
 *
 * The overlay changes the page constantly — inserting a block, committing a text
 * edit, undoing either — and every one of those goes through the DOM APIs this
 * module wraps. Recording them would make the editor's own work look like the
 * page's, so an element would become uneditable the moment it was edited. The
 * engine turns attribution off around anything it applies itself.
 */
let depth = 0;

/**
 * A ceiling on how much is remembered.
 *
 * Capturing a stack costs a few microseconds, which is nothing per call and adds up
 * on a page that builds a thousand rows in a loop. Past the cap the wrappers stop
 * capturing and fall back to the "it changed" signal, so a busy page degrades to a
 * warning without a source location instead of getting slow.
 */
const BUDGET = 20_000;
let captured = 0;

/**
 * Run `fn` without attributing anything it writes to the page.
 *
 * The flag comes down on a microtask rather than in a `finally`, and that detail is
 * load-bearing. The wrappers see a write synchronously, but the observer that backs
 * them up is notified in a microtask queued *during* the write — so a flag lowered
 * synchronously is already down by the time the observer asks, and every edit the
 * editor applied came back as the page rendering it. The reset is queued after the
 * observer's notification, so both see the same answer.
 *
 * Staying suppressed slightly too long is the safe direction to be wrong in: a missed
 * detection lets an edit through that might be overwritten, while a false one refuses
 * an edit that would have worked.
 */
export function withoutProvenance<T>(fn: () => T): T {
  depth += 1;
  try {
    return fn();
  } finally {
    queueMicrotask(() => {
      depth -= 1;
    });
  }
}

/**
 * What is known about where this node's content came from.
 *
 * Elements are asked about far more often than text nodes, so the answer for an
 * element folds in its own direct text: a `<h2>` whose text node was rewritten by
 * `node.data = …` is, for every purpose the editor has, JS-owned.
 */
export function provenanceOf(node: Node): Provenance | undefined {
  if (node instanceof Element && userOwned.has(node)) return undefined;
  const own = records.get(node);
  if (own) return own;

  if (node instanceof HTMLElement) {
    // A template marker naming a JS or TS file means the element is rendered, not
    // authored. Checked after the recorded writes because a real write site is more
    // specific than the template that contains it.
    const fromTemplate = templateProvenance(node);
    if (fromTemplate) return fromTemplate;

    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const text = records.get(child);
      if (text) return text;
    }
  }

  if (node instanceof HTMLElement) {
    const mirrored = mirroredTextAttribute(node);
    if (mirrored) return { kind: 'mirrored', confidence: 'possible', attribute: mirrored };
  }

  /*
   * Inherited from whichever ancestor's content was written as a whole.
   *
   * Bounded to records that claim the subtree, so a write to one element cannot make
   * the entire page uneditable, and stopped at `<body>` so the walk is short. The
   * nearest such ancestor wins: it is the most specific statement about this node.
   */
  let current = node.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    // An element the user has taken over stops the walk: whatever it sits inside, its
    // contents are the user's now.
    if (userOwned.has(current)) return undefined;
    const inherited = records.get(current);
    if (inherited?.subtree) return inherited;
    current = current.parentElement;
  }
  return undefined;
}

/**
 * True when editing this element's text in place would be thrown away.
 *
 * The overlay's own insertions are excluded outright. They carry `data-heo-inserted`,
 * they exist because the user asked for them, and they live in the exported HTML —
 * so whatever wrote them, they are the user's to edit.
 */
export function isScriptOwned(el: HTMLElement): boolean {
  if (el.hasAttribute(INSERTED_ATTR)) return false;
  return provenanceOf(el) !== undefined;
}

/**
 * A sentence naming what controls this element, for the UI to show as-is.
 *
 * Written so the reader can tell how much is known. Only `certain` states an outcome;
 * the rest hedge, and hedge specifically — naming the evidence rather than saying
 * "maybe", so someone who knows their own page can judge it in a second. A build step
 * that rewrites the HTML is invisible from in here, and so is an attribute read back on
 * the next interaction, which is why none of this is ever phrased as a verdict.
 */
export function describeProvenance(provenance: Provenance): string {
  const where = locationLabel(provenance);
  switch (provenance.kind) {
    case 'observed':
      return `An edit here was replaced by the page a moment ago, so this text is set by code — ${where === 'the page’s JavaScript' ? 'somewhere in the page’s scripts' : where}. Editing the code is what will hold.`;
    case 'template':
      return `This content is rendered by ${where}, so an edit here is undone by the next render.`;
    case 'script':
      return provenance.vendor
        ? `A dependency wrote this content (${where}), so an edit here is undone the next time it runs.`
        : `This content was written by ${where}, so an edit here is undone the next time that code runs.`;
    case 'file':
      return 'This content is not in the page’s HTML file, so something on the page builds it. An edit here will most likely be replaced, and saving would write the generated markup into your HTML.';
    case 'mirrored':
      return `This element’s text is also in its ${provenance.attribute} attribute, which usually means the attribute is what renders it — if so, an edit here is replaced the next time that code runs.`;
    default:
      return 'This content changed after the page loaded, so something on the page may be generating it. An edit here may not survive.';
  }
}

/** `file:line`, or the bare file, or a stand-in when neither is known. */
export function locationLabel(provenance: Provenance): string {
  const name = provenance.file ?? fileNameOf(provenance.url);
  if (!name) return 'the page’s JavaScript';
  return provenance.line ? `${name}:${provenance.line}` : name;
}

function fileNameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname.split('/').pop() || url;
  } catch {
    return url;
  }
}

/**
 * An attribute holding exactly this element's text.
 *
 * The tell for a pattern no amount of file comparison can catch:
 *
 *     var text = el.getAttribute('data-text');
 *     if (text === null) { text = el.textContent; el.setAttribute('data-text', text); }
 *
 * The text starts in the HTML, so every structural signal correctly says authored — and
 * an edit to it is still lost, because the attribute is what gets read back and
 * re-rendered later. What gives it away is the duplication: an attribute whose value is
 * character-for-character the element's own text is not a coincidence, it is a cache.
 *
 * Only attributes that could plausibly carry copy, and only when the text is long
 * enough to be worth caching — otherwise `title="OK"` on a button reading "OK" would
 * report the button as generated, which is the sort of noise that makes a warning
 * something people learn to ignore.
 */
const TEXT_ATTRIBUTES = /^(?:data-|aria-label$|title$|alt$|placeholder$|value$)/;

function mirroredTextAttribute(el: HTMLElement): string | undefined {
  const text = directTextOf(el);
  if (text.length < 8) return undefined;
  for (const attribute of Array.from(el.attributes)) {
    if (attribute.name.startsWith('data-heo-')) continue;
    if (!TEXT_ATTRIBUTES.test(attribute.name)) continue;
    if (attribute.value.replace(/\s+/g, ' ').trim() === text) return attribute.name;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Tier 1: the template that declared it                                       */
/* -------------------------------------------------------------------------- */

/** Extensions the build-time marker uses for code rather than for markup. */
const CODE_FILE = /\.(?:m?[jt]sx?|c[jt]s|svelte|vue)$/i;

function templateProvenance(el: HTMLElement): Provenance | undefined {
  const raw = el.getAttribute(SOURCE_ATTR);
  if (!raw) return undefined;
  const parts = raw.split(':');
  const column = Number.parseInt(parts.pop() ?? '', 10);
  const line = Number.parseInt(parts.pop() ?? '', 10);
  const file = parts.join(':');
  if (!file || !CODE_FILE.test(file)) return undefined;
  return {
    kind: 'template',
    confidence: 'certain',
    file,
    line: Number.isFinite(line) ? line : undefined,
    column: Number.isFinite(column) ? column : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Tier 2: the call that wrote it                                              */
/* -------------------------------------------------------------------------- */

let installed = false;

/**
 * Wrap the DOM writes that put content on a page.
 *
 * Called as early as the overlay is evaluated, and that timing is the limit of what
 * this tier can see: a write that happened before the wrappers were in place leaves
 * no record, and tier 3 covers it instead. Idempotent, so a second mount changes
 * nothing.
 *
 * Only the APIs that put *content* on the page are wrapped. Attribute and style
 * writes are left alone — the editor already handles those as declarations with their
 * own provenance, and wrapping `setAttribute` would mean a stack capture on nearly
 * every framework update for no gain here.
 */
export function installProvenance(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  patchSetter(Element.prototype, 'innerHTML', (target) => markSubtree(target, 'innerHTML'));
  patchSetter(Node.prototype, 'textContent', (target) => mark(target, 'textContent'));
  patchSetter(CharacterData.prototype, 'data', (target) => markText(target, 'data'));
  patchSetter(Node.prototype, 'nodeValue', (target) => markText(target, 'nodeValue'));

  patchInserter(Node.prototype, 'appendChild');
  patchInserter(Node.prototype, 'insertBefore');
  patchInserter(Node.prototype, 'replaceChild');
  patchInserter(Element.prototype, 'append');
  patchInserter(Element.prototype, 'prepend');
  patchInserter(Element.prototype, 'replaceChildren');
  patchInserter(Element.prototype, 'after');
  patchInserter(Element.prototype, 'before');
  patchInserter(Element.prototype, 'replaceWith');

  patchMethod(Element.prototype, 'insertAdjacentHTML', (target) =>
    markSubtree(target.parentElement ?? target, 'insertAdjacentHTML'),
  );
}

/**
 * Wrap a property setter, recording the caller and then doing what it would have done.
 *
 * The original setter is called first: attribution is a side effect and must never
 * change what the page ends up with, including when the write throws.
 */
function patchSetter(
  proto: object,
  property: string,
  record: (target: Node, provenance: Provenance) => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, property);
  const original = descriptor?.set;
  if (!descriptor || !original || !descriptor.configurable) return;

  Object.defineProperty(proto, property, {
    ...descriptor,
    set(this: Node, value: unknown) {
      original.call(this, value);
      if (!attributable(this)) return;
      const provenance = capture(property);
      if (provenance) record(this, provenance);
    },
  });
}

function patchMethod(
  proto: object,
  name: string,
  record: (target: Element, provenance: Provenance) => void,
): void {
  const original = (proto as Record<string, unknown>)[name];
  if (typeof original !== 'function') return;
  (proto as Record<string, unknown>)[name] = function (this: Element, ...args: unknown[]) {
    const result = (original as (...a: unknown[]) => unknown).apply(this, args);
    if (attributable(this)) {
      const provenance = capture(name);
      if (provenance) record(this, provenance);
    }
    return result;
  };
}

/**
 * Wrap an insertion method, attributing only the nodes it actually brings in.
 *
 * Connectedness is checked *before* the call and is what separates creating from
 * moving. Re-ordering an element the HTML declared does not make its text
 * JavaScript's — only the position is, and position is not what this gate is about.
 */
function patchInserter(proto: object, name: string): void {
  const original = (proto as Record<string, unknown>)[name];
  if (typeof original !== 'function') return;

  (proto as Record<string, unknown>)[name] = function (this: Node, ...args: unknown[]) {
    const fresh =
      depth === 0 && captured < BUDGET
        ? args.filter((arg): arg is Node => arg instanceof Node && !arg.isConnected)
        : [];
    const result = (original as (...a: unknown[]) => unknown).apply(this, args);
    if (fresh.length && attributable(this)) {
      const provenance = capture(name);
      if (provenance) {
        for (const node of fresh) {
          if (node.isConnected) markSubtree(node, name, provenance);
        }
      }
    }
    return result;
  };
}

function mark(target: Node, api: string, provenance?: Provenance): void {
  const entry = provenance ?? capture(api);
  if (entry) records.set(target, entry);
}

/** Text writes are recorded on the node and read through its element. */
function markText(target: Node, api: string): void {
  const provenance = capture(api);
  if (!provenance) return;
  records.set(target, provenance);
  const parent = target.parentElement;
  if (parent && !records.has(parent)) records.set(parent, provenance);
}

/**
 * Attribute a node and, by inheritance, everything under it.
 *
 * One record with `subtree` set rather than a record per descendant: the tree may not
 * be built yet when the write is seen, it may grow afterwards, and walking it here
 * would put a full traversal inside every `innerHTML` assignment on the page.
 */
function markSubtree(target: Node, api: string, provenance?: Provenance): void {
  const entry = provenance ?? capture(api);
  if (!entry) return;
  records.set(target, { ...entry, subtree: true });
}

/**
 * True when a write to this node is worth attributing at all.
 *
 * The overlay's own chrome is not the page, and neither is anything the page marked
 * as off limits. Detached nodes are skipped too: a document fragment being built up
 * before insertion produces a write per node, and the insertion itself is what
 * carries the useful attribution.
 */
function attributable(node: Node): boolean {
  if (depth > 0 || captured >= BUDGET) return false;
  if (!node.isConnected) return false;
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element) {
      if (current.tagName.toLowerCase() === HOST_TAG) return false;
      if (current.hasAttribute(IGNORE_ATTR)) return false;
      /*
       * The element being typed into, and everything under it.
       *
       * A live text edit is a stream of DOM changes the browser makes on the user's
       * behalf — no JavaScript frame is involved, so `withoutProvenance` cannot cover
       * it and only the observer sees it. Attributing those would mark an element as
       * script-rendered *because* it was edited, which would let it be edited exactly
       * once. This is the same protection `isSelfInflicted` gives the geometry
       * observer, for the same reason.
       */
      if (current.hasAttribute('data-heo-editing')) return false;
    }
    current = current.parentNode;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Reading a stack                                                             */
/* -------------------------------------------------------------------------- */

/** The overlay's own bundle, however it was loaded. */
const OVERLAY_FILE = /html-editor-overlay|\/src\/(?:core|ui|integrations)\//;

/** Dependency code: somewhere to name, never somewhere to send an edit. */
const VENDOR_FILE = /node_modules|\/@(?:fs|id|vite)\/|\/deps\/|\.vendor\.|cdn\.|unpkg\.|jsdelivr\./;

const writeListeners = new Set<(url: string) => void>();

/**
 * Be told which files are seen writing to the page.
 *
 * Corroboration for the weakest signal there is. Finding a string in a script proves
 * only that the string is in the script; knowing that the same script has actually
 * rendered something is the difference between a guess and a ranked answer.
 */
export function onScriptWrite(listener: (url: string) => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

function capture(api: string): Provenance | undefined {
  if (depth > 0 || captured >= BUDGET) return undefined;
  const stack = new Error().stack;
  if (!stack) return undefined;
  captured += 1;

  const frames = parseFrames(stack);
  if (!frames.length) return undefined;

  // Everything below the overlay is the page. If nothing is, the write was ours.
  const page = frames.filter((frame) => !OVERLAY_FILE.test(frame.url));
  if (!page.length) return undefined;

  const authored = page.find((frame) => !VENDOR_FILE.test(frame.url));
  const frame = authored ?? page[0];
  // Remembered as a file that renders, which later lets a text search prefer a script
  // known to write to the page over one that merely contains the same string.
  for (const listener of writeListeners) {
    try {
      listener(frame.url);
    } catch {
      /* a listener's problem, not this write's */
    }
  }
  return {
    kind: 'script',
    confidence: 'certain',
    url: frame.url,
    line: frame.line,
    column: frame.column,
    api,
    vendor: authored ? undefined : true,
  };
}

interface Frame {
  url: string;
  line: number;
  column: number;
}

/**
 * Pull `url:line:column` out of each stack line.
 *
 * Written against the two shapes V8 produces — `at name (url:line:col)` and a bare
 * `at url:line:col` — and tolerant of anything else, because a stack is a debugging
 * aid with no specification and a parser for one should never throw.
 */
function parseFrames(stack: string): Frame[] {
  const out: Frame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    const match = /((?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s()]+?):(\d+):(\d+)\)?$/i.exec(line);
    if (!match) continue;
    out.push({
      url: match[1],
      line: Number.parseInt(match[2], 10),
      column: Number.parseInt(match[3], 10),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Tier 3: it changed after the page parsed                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mark whatever changes from here on as runtime content.
 *
 * The floor under the other two tiers, and the only one that cannot miss: a node
 * inserted or rewritten after this point was not in the file, whatever wrote it and
 * whenever the wrappers went in. It carries no location, so it warns and does not
 * offer to edit.
 *
 * Returns a teardown function. Records already made are kept — the observer is how
 * they were noticed, not where they live.
 */
export function observeRuntimeContent(): () => void {
  if (typeof MutationObserver === 'undefined') return () => { };

  const observer = new MutationObserver((entries) => {
    if (depth > 0) return;
    for (const entry of entries) {
      if (entry.type === 'characterData') {
        const parent = entry.target.parentElement;
        if (parent && attributable(parent) && !records.has(parent)) {
          records.set(entry.target, { kind: 'runtime', confidence: 'possible' });
          records.set(parent, { kind: 'runtime', confidence: 'possible' });
        }
        continue;
      }
      for (const node of Array.from(entry.addedNodes)) {
        if (!attributable(node)) continue;
        if (node instanceof Element && node.hasAttribute(INSERTED_ATTR)) continue;
        if (records.has(node)) continue;
        // Covering the subtree, for the same reason the wrappers do: an inserted card
        // is not the text anyone clicks on, and its heading arrives with it.
        records.set(node, { kind: 'runtime', confidence: 'possible', subtree: true });
      }
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  return () => observer.disconnect();
}

/* -------------------------------------------------------------------------- */
/* Tier 0: it is not in the page's own file                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compare the page against the HTML it was served, and mark the difference.
 *
 * The only signal here that does not depend on having been watching at the right
 * moment — and that turns out to be the case that matters most. A script in `<body>`
 * that fills a container while the document is still parsing has finished before any
 * editor could have installed anything: the wrappers were not there, the observer had
 * nothing to observe, and a bookmarklet arrives later still. Every timing-based tier
 * reports nothing, and the rendered list reads as ordinary editable text right up until
 * the save is overwritten by the next render.
 *
 * The file settles it. `<section id="all-stories"></section>` is empty in the HTML and
 * full on screen, so its contents came from somewhere else, whenever that happened.
 *
 * Matching is by signature rather than by position, so a script may append, prepend or
 * interleave and the authored children are still recognised. An `id` present in the
 * file is stronger still: it survives the element being moved, which nothing
 * positional can. Where a match is found but its direct text differs, the text alone
 * is marked — the element is the author's, its words are not.
 *
 * Returns how many nodes it accounted for, so a caller can say whether it learned
 * anything.
 */
export function establishBaseline(sourceHTML: string): number {
  let parsed: Document | null = null;
  try {
    parsed = new DOMParser().parseFromString(sourceHTML, 'text/html');
  } catch {
    return 0;
  }
  if (!parsed?.body) return 0;

  let marked = 0;
  const mark = (node: Node, provenance: Provenance): void => {
    if (records.has(node)) return;
    records.set(node, provenance);
    marked += 1;
  };

  const walk = (live: Element, source: Element): void => {
    const pool = new Map<string, Element[]>();
    for (const child of comparableChildren(source)) {
      const key = signatureOf(child);
      const bucket = pool.get(key);
      if (bucket) bucket.push(child);
      else pool.set(key, [child]);
    }

    for (const child of comparableChildren(live)) {
      // Neither marked nor descended into. A difference under here is the user's edit,
      // not the page's code, and the file has no opinion worth taking on it.
      if (userOwned.has(child)) continue;
      const byId = child.id ? parsed.getElementById(child.id) : null;
      const match = byId ?? pool.get(signatureOf(child))?.shift() ?? null;
      if (!match) {
        mark(child, { kind: 'file', confidence: 'likely', subtree: true });
        continue;
      }
      // Same element, different words: whatever rewrote them will do it again.
      if (directTextOf(child) !== directTextOf(match)) {
        mark(child, { kind: 'file', confidence: 'likely' });
      }
      walk(child, match);
    }
  };

  walk(document.body, parsed.body);
  return marked;
}

/**
 * Children worth lining up between the two trees.
 *
 * The editor's own nodes are not in the file and never will be, and comparing
 * `<script>`, `<style>` and `<link>` positions is noise — one injected stylesheet would
 * otherwise shift every sibling past it out of alignment. Excluded from both sides, so
 * the two lists stay comparable.
 */
function comparableChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === HOST_TAG || tag === 'script' || tag === 'style' || tag === 'link') continue;
    if (child.hasAttribute(IGNORE_ATTR)) continue;
    if (child.hasAttribute(INSERTED_ATTR)) continue;
    if (child.hasAttribute('data-heo-generated') || child.hasAttribute('data-heo-internal')) {
      continue;
    }
    out.push(child);
  }
  return out;
}

/**
 * Enough of an element to recognise it again in the other tree.
 *
 * Tag, id and classes are what an author writes and a script tends to reproduce.
 * Direct text is in there too, which is what makes a rewritten label fail to match
 * rather than pass as the element it replaced.
 */
function signatureOf(el: Element): string {
  const classes = Array.from(el.classList)
    .filter((name) => !name.startsWith('heo-'))
    .sort()
    .join('.');
  return `${el.tagName.toLowerCase()}#${el.id}.${classes}|${directTextOf(el)}`;
}

/** Text belonging to the element itself, whitespace collapsed. */
function directTextOf(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Proof: watch whether the edit survives                                      */
/* -------------------------------------------------------------------------- */

/**
 * Watch an element the user has just edited, and report if the page overwrites it.
 *
 * Every other signal in this file is inference: it looks at where content came from and
 * reasons about what will happen to an edit. This one waits and finds out. That makes it
 * the only signal that can catch code which reads its own DOM back and re-renders from
 * somewhere else —
 *
 *     var text = el.getAttribute('data-text');
 *
 * — where the text is genuinely in the HTML, every structural check correctly says
 * authored, and the edit is lost anyway on the next interaction. No amount of looking
 * at files would ever have predicted it. Being overwritten, on the other hand, is not a
 * prediction at all.
 *
 * It fires once and then stops. The point is to learn the fact and say it, not to
 * narrate every subsequent render.
 */
export function watchEditDurability(
  el: HTMLElement,
  expected: string,
  onReplaced: (found: string) => void,
): () => void {
  if (typeof MutationObserver === 'undefined') return () => { };
  const wanted = expected.replace(/\s+/g, ' ').trim();
  let done = false;

  const observer = new MutationObserver(() => {
    // The editor's own writes are not the page taking the edit back — undo, redo and a
    // second edit all land here. `depth` survives into the microtask this runs in.
    if (done || depth > 0) return;
    if (!el.isConnected) {
      // Replaced wholesale rather than rewritten, which is the same news.
      done = true;
      observer.disconnect();
      onReplaced('');
      return;
    }
    const now = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (now === wanted) return;
    done = true;
    observer.disconnect();
    onReplaced(now);
  });

  observer.observe(el, { subtree: true, childList: true, characterData: true });
  // The parent too, so an element swapped out entirely is noticed rather than watched
  // in silence after it has been detached.
  if (el.parentNode) observer.observe(el.parentNode, { childList: true });
  return () => {
    done = true;
    observer.disconnect();
  };
}

/**
 * Record, as fact, that the page took an edit back.
 *
 * Promoted to `certain` and given the subtree, and it deliberately overwrites whatever
 * was there before: an inference has just been settled by an observation, and the
 * observation wins. Anything already known about *where* the code lives is carried
 * across, since that part was never in doubt.
 */
export function markObservedRevert(el: HTMLElement): Provenance {
  const known = records.get(el);
  const provenance: Provenance = {
    ...known,
    kind: 'observed',
    confidence: 'certain',
    subtree: true,
  };
  records.set(el, provenance);
  // The user's earlier edit made this exempt. It has now earned its way back.
  userOwned.delete(el);
  return provenance;
}

/**
 * Drop what was attributed to one element, so it can be judged again from scratch.
 *
 * The way back out of `markObservedRevert`. One observation is enough to conclude the page
 * owns an element, and has to be — but it is not enough to conclude it forever, because the
 * observation cannot tell a re-render apart from the editor's own second write. Editing the
 * element again is the user contradicting the verdict, and this is what makes that possible
 * instead of leaving them with an element they can edit and never save.
 */
export function forgetProvenance(el: Element): void {
  records.delete(el);
}

/** Forget everything attributed so far. Called on unmount. */
export function resetProvenance(): void {
  captured = 0;
}
