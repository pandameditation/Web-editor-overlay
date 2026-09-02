import {
  BLOCK_ATTR,
  HOST_TAG,
  INJECTED_ATTR,
  INSERTED_ATTR,
  MIRROR_ATTR,
  MODAL_ATTR,
  RENDERED_ATTR,
  SEED_SCRIPT_SELECTOR,
  SEED_SCRIPT_TYPE,
  SOURCE_ATTR,
} from './constants.js';
import { withoutProvenance } from './provenance.js';
import type { ClassRegistry } from './classes.js';
import { tokensInValue } from './css.js';
import { patchCSS, type DeclarationPatch } from './css-patch.js';
import { queryDeep } from './dom.js';
import type { BlockLibrary } from './library.js';
import type { RuleRegistry } from './rules.js';
import { safeSelector } from './selectors.js';
import type { TokenRegistry } from './tokens.js';
import type {
  DesignClass,
  DesignRule,
  DesignSystemDocument,
  DesignToken,
  LibraryBlock,
} from './types.js';

const SCHEMA = 'https://html-editor-overlay.dev/schema/design-system-1.json';

/**
 * Portable design systems.
 *
 * The point of exporting is that a session's vocabulary outlives the page it was
 * built on: tokens, reusable classes and blocks written while editing one project
 * can be imported into the next. The format is deliberately plain JSON with no
 * references between entries, so it stays diffable and hand-editable.
 */
/**
 * The four registries a design system is read from and written back into.
 *
 * Taken as one object rather than as positional arguments. There were three, a fourth
 * was added, and the next one should not mean editing every call site and getting the
 * order right — which is a real hazard when three of the four have the same shape.
 */
export interface DesignRegistries {
  tokens: TokenRegistry;
  classes: ClassRegistry;
  rules: RuleRegistry;
  library: BlockLibrary;
}

export function exportDesignSystem(
  registries: DesignRegistries,
  name = 'Design system',
): DesignSystemDocument {
  return {
    $schema: SCHEMA,
    name,
    version: 1,
    createdAt: new Date().toISOString(),
    tokens: registries.tokens.export(),
    classes: registries.classes.export(),
    rules: registries.rules.export(),
    blocks: registries.library.export(),
  };
}

/* -------------------------------------------------------------------------- */
/* How much of it to write                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How much of the design system a save should carry.
 *
 * An imported system is a vocabulary, and a page usually speaks a fraction of it. Writing the
 * whole thing into a single-file export means shipping a stylesheet for a design language
 * where two colours and one card class were used, which is the difference between a page and
 * a page plus somebody's whole theme.
 *
 * - **`all`** — everything the session owns. Right when the file *is* the design system's
 *   home, or when the point is to hand the vocabulary on.
 * - **`used`** — only what the page actually references, closed over what those references
 *   need in turn. Right for a page being handed to someone to look at.
 * - **`none`** — leave it out. Right when it lives somewhere else already.
 */
export type DesignSystemScope = 'all' | 'used' | 'none';

/** The three parts, kept separate so a plan can say which kinds a file will receive. */
export interface DesignSystemParts {
  tokens: string;
  classes: string;
  rules: string;
}

/** What `used` resolves to: the names that survive the pruning. */
export interface DesignSystemUsage {
  tokens: Set<string>;
  classes: Set<string>;
  rules: Set<string>;
}

/**
 * Which parts of the design system the page actually leans on.
 *
 * Three passes, in this order, because each one can pull more in:
 *
 * 1. **Classes** are settled by looking at elements. `ClassRegistry.usage` counts real
 *    `class` attributes, so this part is exact rather than inferred.
 * 2. **Rules** are settled by whether their selector matches anything.
 * 3. **Tokens** are whatever those two need, plus whatever the page's own CSS and inline
 *    styles reference — then closed over, because a token's value can name another token.
 *
 * `TokenRegistry.usage` is deliberately not used for step 3. It walks every stylesheet
 * including the generated ones, so a token referenced only by a class nobody applied comes
 * back as used — which for this purpose is exactly the thing being pruned away.
 */
export function designSystemUsage(registries: DesignRegistries): DesignSystemUsage {
  const classUsage = registries.classes.usage();
  const classes = new Set(
    registries.classes
      .list()
      .filter((entry) => (classUsage.get(entry.name) ?? 0) > 0)
      .map((entry) => entry.name),
  );

  const ruleMatches = registries.rules.matches();
  const rules = new Set(
    registries.rules
      .list()
      .filter((entry) => (ruleMatches.get(entry.selector) ?? 0) > 0)
      .map((entry) => entry.selector),
  );

  /* ---- Tokens: seed from everything that survived, plus the page's own CSS ---- */

  const wanted = new Set<string>();
  const want = (value: string): void => {
    for (const name of tokensInValue(value)) wanted.add(name);
  };

  for (const entry of registries.classes.list()) {
    if (!classes.has(entry.name)) continue;
    for (const value of Object.values(entry.declarations)) want(value);
  }
  for (const entry of registries.rules.list()) {
    if (!rules.has(entry.selector)) continue;
    for (const value of Object.values(entry.declarations)) want(value);
  }
  for (const value of pageTokenReferences()) wanted.add(value);

  /*
   * Closure. A token's value can name another token, and that one another.
   *
   * Bounded by the registry size rather than by trusting the graph to be acyclic: a token
   * defined in terms of itself is valid CSS that renders as nothing, and it should not be able
   * to hang a save.
   */
  for (let pass = 0; pass <= registries.tokens.size; pass += 1) {
    const before = wanted.size;
    for (const name of [...wanted]) {
      const token = registries.tokens.get(name);
      if (token) want(token.value);
    }
    if (wanted.size === before) break;
  }

  // Only names the registry actually holds; a reference to a token nobody defined is the
  // page's business, not something to write out.
  const tokens = new Set([...wanted].filter((name) => registries.tokens.get(name)));
  return { tokens, classes, rules };
}

/**
 * Every token the page references from somewhere the editor does not own.
 *
 * The generated sheets are skipped on purpose: they are the design system rendering itself,
 * so counting them would make every token in the registry look referenced.
 */
function pageTokenReferences(): Set<string> {
  const names = new Set<string>();
  const visit = (container: CSSStyleSheet | CSSGroupingRule): void => {
    let list: CSSRuleList;
    try {
      list = container.cssRules;
    } catch {
      // A sheet the browser will not read. Its references are unknowable, which is a reason
      // to keep more rather than less — see the caller's `used` copy.
      return;
    }
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        for (const name of tokensInValue(rule.style.cssText)) names.add(name);
      } else if (rule instanceof CSSGroupingRule) {
        visit(rule);
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    const node = sheet.ownerNode;
    if (node instanceof Element && node.hasAttribute('data-heo-generated')) continue;
    visit(sheet);
  }
  for (const sheet of document.adoptedStyleSheets ?? []) visit(sheet);
  for (const el of queryDeep('[style]')) {
    for (const name of tokensInValue(el.getAttribute('style') ?? '')) names.add(name);
  }
  return names;
}

/** The design system as CSS, at the requested extent. */
export function designSystemParts(
  registries: DesignRegistries,
  scope: DesignSystemScope,
): DesignSystemParts {
  if (scope === 'none') return { tokens: '', classes: '', rules: '' };
  if (scope === 'all') {
    return {
      tokens: registries.tokens.toCSS(),
      classes: registries.classes.toCSS(),
      rules: registries.rules.toCSS(),
    };
  }
  const used = designSystemUsage(registries);
  return {
    tokens: registries.tokens.cssFor(used.tokens),
    classes: registries.classes.cssFor(used.classes),
    rules: registries.rules.cssFor(used.rules),
  };
}

/** How many entries each extent would write, for the UI to put numbers on the choice. */
export function designSystemExtent(
  registries: DesignRegistries,
  scope: DesignSystemScope,
): { tokens: number; classes: number; rules: number } {
  if (scope === 'none') return { tokens: 0, classes: 0, rules: 0 };
  const owned = <T extends { origin?: string }>(entries: T[]): T[] =>
    entries.filter((entry) => entry.origin !== 'stylesheet');
  if (scope === 'all') {
    return {
      tokens: owned(registries.tokens.list()).length,
      classes: owned(registries.classes.list()).length,
      rules: owned(registries.rules.list()).length,
    };
  }
  const used = designSystemUsage(registries);
  return {
    tokens: owned(registries.tokens.list()).filter((entry) => used.tokens.has(entry.name)).length,
    classes: owned(registries.classes.list()).filter((entry) => used.classes.has(entry.name))
      .length,
    rules: owned(registries.rules.list()).filter((entry) => used.rules.has(entry.selector)).length,
  };
}

export interface ImportResult {
  tokens: number;
  classes: number;
  rules: number;
  blocks: number;
}

export function importDesignSystem(
  document_: unknown,
  registries: DesignRegistries,
  options: { overwrite?: boolean } = {},
): ImportResult {
  const parsed = parseDesignSystem(document_);
  return {
    tokens: registries.tokens.import(parsed.tokens, options),
    classes: registries.classes.import(parsed.classes, options),
    rules: registries.rules.import(parsed.rules ?? [], options),
    blocks: registries.library.import(parsed.blocks, options),
  };
}

/* -------------------------------------------------------------------------- */
/* Importing as something that can be taken back                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything the four registries hold, deep enough to put back.
 *
 * `import` is purely additive — it never deletes — so replaying an earlier export does not undo
 * one: every name the incoming system introduced would still be there. Restoring means removing
 * what arrived and then reinstating what was replaced, which needs both halves of the picture.
 *
 * Declarations are copied rather than referenced. `list()` hands back the live entries, and
 * `upsert` replaces the map slot with a fresh object but shares the nested declaration map — so a
 * snapshot that kept the reference would mutate along with the thing it was meant to preserve.
 * The same care `setClassDeclaration` takes for one class, taken here for all of them.
 */
export interface DesignSystemSnapshot {
  tokens: DesignToken[];
  classes: DesignClass[];
  rules: DesignRule[];
  blocks: LibraryBlock[];
}

export function snapshotDesignSystem(registries: DesignRegistries): DesignSystemSnapshot {
  return {
    tokens: registries.tokens.list().map((entry) => ({ ...entry })),
    classes: registries.classes
      .list()
      .map((entry) => ({ ...entry, declarations: { ...entry.declarations } })),
    rules: registries.rules
      .list()
      .map((entry) => ({ ...entry, declarations: { ...entry.declarations } })),
    // `list`, not `export`: the latter drops presets, and a seed that overwrote one has to be
    // able to put it back.
    blocks: registries.library.list().map((entry) => ({ ...entry })),
  };
}

/** Put the registries back exactly as the snapshot found them. */
export function restoreDesignSystem(
  registries: DesignRegistries,
  snapshot: DesignSystemSnapshot,
): void {
  const drop = <T>(
    live: readonly T[],
    kept: readonly T[],
    key: (entry: T) => string,
    remove: (name: string) => unknown,
  ): void => {
    const keep = new Set(kept.map(key));
    for (const entry of live) {
      if (!keep.has(key(entry))) remove(key(entry));
    }
  };

  drop(
    registries.tokens.list().map((entry) => ({ ...entry })),
    snapshot.tokens,
    (entry) => entry.name,
    (name) => registries.tokens.remove(name),
  );
  drop(
    registries.classes.list().map((entry) => ({ ...entry })),
    snapshot.classes,
    (entry) => entry.name,
    (name) => registries.classes.remove(name),
  );
  drop(
    registries.rules.list().map((entry) => ({ ...entry })),
    snapshot.rules,
    (entry) => entry.selector,
    (selector) => registries.rules.remove(selector),
  );
  drop(
    registries.library.list().map((entry) => ({ ...entry })),
    snapshot.blocks,
    (entry) => entry.id,
    (id) => registries.library.remove(id),
  );

  for (const entry of snapshot.tokens) registries.tokens.upsert(entry);
  for (const entry of snapshot.classes) registries.classes.upsert(entry);
  for (const entry of snapshot.rules) registries.rules.upsert(entry);
  registries.library.import(snapshot.blocks, { overwrite: true });
}

/** Validate and normalise an untrusted design system document. */
export function parseDesignSystem(input: unknown): DesignSystemDocument {
  const raw: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('A design system must be a JSON object.');
  }
  const doc = raw as Partial<DesignSystemDocument>;
  const arrays: Array<keyof DesignSystemDocument> = ['tokens', 'classes', 'rules', 'blocks'];
  for (const key of arrays) {
    const value = doc[key];
    if (value != null && !Array.isArray(value)) {
      throw new TypeError(`"${key}" must be an array.`);
    }
  }
  return {
    $schema: SCHEMA,
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : 'Imported system',
    version: Number.isFinite(doc.version) ? Number(doc.version) : 1,
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : undefined,
    tokens: (doc.tokens ?? []).filter(
      (token) => token && typeof token.name === 'string' && typeof token.value === 'string',
    ),
    classes: (doc.classes ?? []).filter(
      (entry) => entry && typeof entry.name === 'string' && entry.declarations && typeof entry.declarations === 'object',
    ),
    /*
     * A rule's selector is checked here, not just shaped.
     *
     * Everything else in this function is a shape check, because a token with a silly
     * name is inert. A selector is not inert: an unparseable one throws from inside
     * `insertRule`, and the registry would be holding a rule that can never render. An
     * imported document is untrusted input, so the one gate that matters runs on the way
     * in rather than being left to whatever calls this next.
     */
    rules: (doc.rules ?? []).filter(
      (entry) =>
        entry &&
        typeof entry.selector === 'string' &&
        Boolean(safeSelector(entry.selector)) &&
        entry.declarations &&
        typeof entry.declarations === 'object',
    ),
    blocks: (doc.blocks ?? []).filter(
      (block) => block && typeof block.name === 'string' && typeof block.html === 'string',
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* File helpers                                                                */
/* -------------------------------------------------------------------------- */

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/**
 * Hand a blob to the user as a download.
 *
 * Split out from `downloadText` because that one appends `;charset=utf-8` to the type,
 * which is right for every text format it is used for and wrong for an archive: a zip is
 * bytes, and declaring a character set for it is a claim about content it does not have.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker and resolve with the file's text, or null if cancelled. */
export function pickTextFile(accept = 'application/json,.json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then(resolve)
        .catch(() => resolve(null));
    });
    // Safari needs the input in the document for `change` to fire reliably.
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60_000);
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and permission; fall back to a
    // hidden textarea, which still works from a user gesture.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* HTML export                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Serialize the page with every trace of the editor removed.
 *
 * Works on a clone so the live document is untouched: the overlay host, the
 * instrumentation attributes and the editor's own generated stylesheets all come
 * out, leaving markup that stands on its own.
 */
/** A `<style>` element whose text has to catch up with edits made through the CSSOM. */
export interface InlineStyleReconciliation {
  element: HTMLStyleElement;
  patches: DeclarationPatch[];
}

export interface ExportOptions {
  /** Regions the page's own code built, which the file never declared. */
  generated?: readonly HTMLElement[];
  /**
   * Whether the design system's own CSS belongs in this file.
   *
   * True when the save is leaving tokens and classes in the page. False when they are going
   * to a stylesheet, in which case the generated blocks are a live preview of a change that
   * is being written somewhere else, and keeping them would write it twice.
   */
  designSystemInDocument?: boolean;
  /**
   * Replacement CSS for the generated blocks, keyed by element id.
   *
   * How the extent choice reaches the export. The blocks in the live page always hold the
   * whole design system, because that is what is rendering — so writing out a subset means
   * substituting the text on the way past. An empty string removes the block.
   *
   * Absent means leave them exactly as they are, which is what `all` wants and keeps the
   * common path byte-identical to what it was.
   */
  designSystemBlocks?: Record<string, string>;
  /**
   * The block library as a seed, to be written into `<head>` as a data script.
   *
   * The one part of a session that serializing the page cannot capture, because it is not in the
   * page: a block is a definition the editor holds, and what the DOM shows is the *instances* of
   * it. Without this an exported file carries nine cards and no way to make a tenth.
   *
   * Absent or empty writes nothing, which is what an unticked box means.
   */
  seedScript?: string;
}

export function exportHTML(
  styleEdits: readonly InlineStyleReconciliation[] = [],
  options: ExportOptions = {},
): string {
  const generated = options.generated ?? [];
  const designSystemInDocument = options.designSystemInDocument ?? true;
  /*
   * Content the page built is marked before the clone is taken, and unmarked after.
   *
   * The alternative is pairing two trees up after the fact, which is exactly the kind of
   * index arithmetic that goes wrong the first time a browser inserts an implied `<tbody>`.
   * An attribute travels with `cloneNode` for free, and the live page carries it for less
   * than one synchronous block — no render, no observer notification, nothing else can see
   * it. Attribution is suspended anyway, because an attribute written onto the page is
   * precisely the kind of thing this editor otherwise pays attention to.
   */
  const marked: HTMLElement[] = [];
  withoutProvenance(() => {
    for (const el of generated) {
      if (!el.isConnected) continue;
      el.setAttribute(RENDERED_ATTR, '');
      marked.push(el);
    }
  });
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  withoutProvenance(() => {
    for (const el of marked) el.removeAttribute(RENDERED_ATTR);
  });

  /*
   * And out it comes.
   *
   * This is the whole reason the export can be trusted as a file: what is on screen is the
   * page's own code having run, and writing that back turns a container the file declares
   * empty into a list of hand-written elements — which the code then overwrites on the next
   * load, having grown the file by however much it renders. Only the outermost element of
   * each region is passed in, so removing it takes the region with it.
   */
  for (const el of Array.from(clone.querySelectorAll(`[${RENDERED_ATTR}]`))) el.remove();

  reconcileInlineStyles(clone, styleEdits);

  for (const host of Array.from(clone.querySelectorAll(HOST_TAG))) host.remove();

  /*
   * The editor's own machinery goes; the user's design system stays.
   *
   * Both are `[data-heo-generated]` style elements, and the difference is exactly
   * what `internal` means on a managed sheet: the tokens, classes and block CSS
   * written during a session are the point of the export, while the rules that make
   * edit mode work — the selection reset, the drag preview, the modal scroll lock —
   * describe an editor that will not be there. They used to be exported too, which
   * put `html[data-heo-edit]` rules into a file that has no editor.
   */
  for (const internal of Array.from(clone.querySelectorAll('[data-heo-internal]'))) {
    internal.remove();
  }

  /*
   * The stand-ins go, and the `<link>`s they stood in for come back.
   *
   * A mirror is a copy of a file the exported page still links to, so leaving it in
   * would inline the stylesheet twice — and leaving the `<link>` disabled would ship a
   * page whose CSS never loads. Edits made through a mirror belong to the `.css` file
   * and reach it through the write plan, not through this HTML.
   */
  for (const mirror of Array.from(clone.querySelectorAll(`[${MIRROR_ATTR}]`))) mirror.remove();
  for (const link of Array.from(clone.querySelectorAll('link[disabled]'))) {
    link.removeAttribute('disabled');
  }
  /*
   * The design system goes wherever it was told to go, and to one place only.
   *
   * These blocks are how a token edit shows on screen before it is saved — the registries
   * render into them so `--clay` changes colour the moment it is typed. That makes them a
   * preview, not a location. When the save is sending the design system to a stylesheet,
   * keeping them here writes every token into the page as well, so one edit lands in two
   * files and the two then disagree the moment either is touched.
   *
   * When the document *is* the chosen target, this block is the only home the tokens have,
   * so the CSS stays and only the editor's marker goes.
   */
  const blocks = options.designSystemBlocks;
  for (const generated of Array.from(clone.querySelectorAll('[data-heo-generated]'))) {
    if (!designSystemInDocument) {
      generated.remove();
      continue;
    }
    /*
     * Substituted before the id goes, since the id is what identifies which block this is.
     *
     * A block whose replacement is empty is dropped rather than left as an empty `<style>`:
     * "none" should leave no trace, not a pair of tags where the theme used to be.
     */
    if (blocks) {
      const replacement = blocks[generated.id];
      if (replacement !== undefined) {
        if (!replacement.trim()) {
          generated.remove();
          continue;
        }
        generated.textContent = replacement;
      }
    }
    generated.removeAttribute('data-heo-generated');
    generated.removeAttribute('id');
  }

  for (const el of Array.from(clone.querySelectorAll(`[${SOURCE_ATTR}]`))) {
    el.removeAttribute(SOURCE_ATTR);
  }

  for (const el of Array.from(clone.querySelectorAll(`[${INSERTED_ATTR}]`))) {
    el.removeAttribute(INSERTED_ATTR);
  }

  /*
   * Which library block an element came from, kept only when the library is coming too.
   *
   * This used to go unconditionally, on the reasoning that the link means nothing once the
   * editor is off the page. That was right while the library could not travel: an attribute
   * naming a template nothing has a copy of is a dangling reference in someone's markup.
   *
   * Writing the library into the page as a seed changes the answer, because now the template
   * *is* in the file. Stripping the link then produced the confusing half-restore the seed was
   * supposed to prevent — the blocks came back on the next load, and not one element in the page
   * knew it was an instance of any of them, so the Components section was gone from things that
   * plainly were components. The two halves are one feature and they travel together.
   */
  if (!options.seedScript?.trim()) {
    for (const el of Array.from(clone.querySelectorAll(`[${BLOCK_ATTR}]`))) {
      el.removeAttribute(BLOCK_ATTR);
    }
  }

  for (const el of Array.from(clone.querySelectorAll('[contenteditable]'))) {
    el.removeAttribute('contenteditable');
  }

  for (const el of Array.from(clone.querySelectorAll('[data-heo-editing]'))) {
    el.removeAttribute('data-heo-editing');
  }

  /*
   * Tags the tooling put in the page, which were never in the file.
   *
   * A dev server rewrites the HTML on its way to the browser — Vite adds its HMR client,
   * a framework plugin adds its refresh runtime, and this project's own plugin adds the
   * overlay bootstrap. All of it is in the DOM, and the export serializes the DOM, so
   * every one of them used to be written into the source file. The next request then
   * injected them again on top of the copies now in the file, which is why a page
   * accumulated one `<script src="/@vite/client">` per save.
   *
   * Two ways of spotting them, because only one is available. Anything this project
   * injects says so outright. Anything a dev server injects cannot be marked, so it is
   * recognised by living in the virtual namespace servers reserve for themselves — a
   * path segment starting `@`, which a real file on disk cannot have.
   */
  for (const injected of Array.from(clone.querySelectorAll(`[${INJECTED_ATTR}]`))) {
    injected.remove();
  }
  for (const el of Array.from(clone.querySelectorAll('script[src], link[href]'))) {
    const attribute = el.hasAttribute('src') ? 'src' : 'href';
    const url = el.getAttribute(attribute) ?? '';
    if (isToolingURL(url)) {
      el.remove();
      continue;
    }
    /*
     * A dev server rewrites the URLs it serves, and the file said something shorter.
     *
     * Hot reloading works by re-requesting a module with a fresh query, so a `<script
     * src="stories.js">` becomes `src="stories.js?t=1787928538048"` in the live page the
     * moment it is edited. Serializing that writes the timestamp into the file, where it is
     * pinned forever: the browser then keeps fetching that one URL, so the file has quietly
     * been made uncacheable and the next reload of a changed script serves the old one.
     */
    const cleaned = withoutTransientQuery(url);
    if (cleaned !== url) el.setAttribute(attribute, cleaned);
  }

  /*
   * The three things the editor writes onto `<html>` itself.
   *
   * `<html>` is what was cloned, so none of them are reachable through
   * `querySelectorAll` — every one has to be named here, and forgetting one is invisible
   * until it turns up in a diff. `data-heo-edit` and the drag accent are set on every
   * render while edit mode is on, which is to say always, whenever an export happens.
   *
   * The accent is removed as a property rather than by dropping the attribute, because a
   * page is entitled to its own inline styles on `<html>`; the attribute only goes if
   * taking the accent out left it empty.
   */
  clone.removeAttribute(MODAL_ATTR);
  clone.removeAttribute('data-heo-edit');
  clone.style.removeProperty('--heo-drag-accent');
  if (!clone.getAttribute('style')?.trim()) clone.removeAttribute('style');

  writeSeedScript(clone, options.seedScript ?? '');

  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}>\n`
    : '<!DOCTYPE html>\n';
  return `${doctype}${clone.outerHTML}\n`;
}

/**
 * True for a URL that belongs to a dev server rather than to the project.
 *
 * Vite serves its own machinery from a reserved namespace — `/@vite/client`,
 * `/@react-refresh`, `/@id/…` for virtual modules, `/@fs/…` for files outside the root —
 * and nothing on disk can occupy it, because a path segment cannot begin with `@` and
 * still be resolved as a file. Matched anywhere in the path rather than only at the start,
 * so a project served under a base path is covered too.
 */
function isToolingURL(url: string): boolean {
  return /(?:^|\/)@(?:vite|id|fs|react-refresh)(?:\/|$)/.test(url);
}

/**
 * Put the block library into the clone as a data script, or leave whatever is there.
 *
 * The counterpart of `upsertSeedBlock` for the serializing route. Reusing that function is not
 * an option and the difference is instructive: it works on text, matching comment markers, and
 * here there is no text yet — this runs against a DOM tree on its way to being one. Same
 * outcome, same tag, and `script-tag.ts` reads either.
 *
 * An empty seed leaves an existing block alone rather than removing it, matching the text
 * route: unticking the box means "do not maintain this", which is not the same as "delete the
 * library already in this file".
 */
function writeSeedScript(clone: HTMLElement, seed: string): void {
  const payload = seed.trim();
  if (!payload) return;

  const existing = clone.querySelector(SEED_SCRIPT_SELECTOR);
  if (existing) {
    existing.textContent = payload;
    return;
  }
  const script = clone.ownerDocument.createElement('script');
  script.setAttribute('type', SEED_SCRIPT_TYPE);
  script.textContent = payload;
  // `<head>` for preference, so it is parsed before anything that might read it. A document
  // with no head is legal, and a script is honoured wherever it sits.
  (clone.querySelector('head') ?? clone).prepend(script);
}

/**
 * Query parameters a dev server added, which the file never had.
 *
 * Only the ones no author writes by hand, because getting this wrong means editing a URL
 * someone meant. `t=` followed by an epoch in milliseconds is a reload stamp — thirteen
 * digits of wall clock is not something a person types into a `src`. The bare flags are
 * Vite's own transform switches and are meaningless in markup. Anything else is left
 * exactly as it is, including a hand-written `?v=2`, which is why that is not on the list.
 *
 * Other parameters on the same URL survive: only the transient ones are lifted out, so
 * `theme.css?brand=dark&t=1787928538048` keeps the half that was authored.
 */
const TRANSIENT_PARAM = /^(?:t=\d{10,14}|import|direct|used|inline|raw|url|worker|html-proxy)$/;

function withoutTransientQuery(url: string): string {
  const query = url.indexOf('?');
  if (query === -1) return url;
  const [path, rest] = [url.slice(0, query), url.slice(query + 1)];
  const hash = rest.indexOf('#');
  const search = hash === -1 ? rest : rest.slice(0, hash);
  const fragment = hash === -1 ? '' : rest.slice(hash);

  const kept = search
    .split('&')
    .filter((param) => param !== '' && !TRANSIENT_PARAM.test(param));
  return `${path}${kept.length ? `?${kept.join('&')}` : ''}${fragment}`;
}

/**
 * Bring inline `<style>` text up to date with edits made through the CSSOM.
 *
 * Editing a rule from the cascade inspector mutates `rule.style`, which changes what
 * the page renders and changes nothing else: the `<style>` element's `textContent`
 * still holds the CSS the author wrote. Serializing the document therefore used to
 * export the *old* value while the screen showed the new one — an edit made, visibly
 * applied, and silently absent from the file.
 *
 * The declarations are replayed against the element's own text rather than the sheet
 * being re-serialized, so the author's comments and formatting come through and the
 * diff is the line that changed.
 *
 * Elements are paired by position between the live tree and the clone. Identity is
 * not available across a `cloneNode`, and this runs before anything is removed, so
 * the two `<style>` lists are the same list.
 */
function reconcileInlineStyles(
  clone: HTMLElement,
  edits: readonly InlineStyleReconciliation[],
): void {
  if (!edits.length) return;
  const live = Array.from(document.documentElement.querySelectorAll('style'));
  const copies = Array.from(clone.querySelectorAll('style'));

  for (const edit of edits) {
    const index = live.indexOf(edit.element);
    const copy = index === -1 ? null : copies[index];
    if (!copy) continue;
    const result = patchCSS(copy.textContent ?? '', edit.patches);
    copy.textContent = result.css;
  }
}
