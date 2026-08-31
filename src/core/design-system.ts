import {
  HOST_TAG,
  INJECTED_ATTR,
  INSERTED_ATTR,
  MIRROR_ATTR,
  MODAL_ATTR,
  RENDERED_ATTR,
  SOURCE_ATTR,
} from './constants.js';
import { withoutProvenance } from './provenance.js';
import type { ClassRegistry } from './classes.js';
import { patchCSS, type DeclarationPatch } from './css-patch.js';
import type { BlockLibrary } from './library.js';
import type { RuleRegistry } from './rules.js';
import { safeSelector } from './selectors.js';
import type { TokenRegistry } from './tokens.js';
import type { DesignSystemDocument } from './types.js';

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
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
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
  for (const generated of Array.from(clone.querySelectorAll('[data-heo-generated]'))) {
    if (!designSystemInDocument) {
      generated.remove();
      continue;
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
