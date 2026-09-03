import { IGNORE_ATTR } from './constants.js';
import type { FileHost } from './file-host.js';
import { nextChangeId, type Command } from './history.js';
import { anchorFor } from './mutations.js';
import { DOCUMENT_TARGET } from './sheets.js';

/**
 * The page's JavaScript, as editable sources.
 *
 * The asymmetry with CSS is the whole design problem here. A stylesheet is live:
 * rewrite a rule and the page changes, so the CSS panel can be a true editor. A
 * script has already run. Rewriting its text changes nothing that is on screen,
 * because the functions it defined and the listeners it attached are already in
 * memory, and no amount of editing the `<script>` element reaches them.
 *
 * So this is an editor whose output is a change record, which is what the whole
 * product is for — it produces instructions rather than writing your source. The
 * text is updated so the exported document and the save prompt both carry it, and
 * re-running is a separate, explicit act with its own warning, because running a
 * script twice doubles every side effect it has.
 */

export type ScriptKind = 'inline' | 'module' | 'external' | 'json';

export interface ScriptSource {
  /** Stable id for list keying and selection across re-renders. */
  id: string;
  kind: ScriptKind;
  /** File name, or a positional label for an inline script. */
  label: string;
  /** Full URL when the script came from a file. */
  href?: string;
  /** `type` attribute, when it is something other than plain JavaScript. */
  type?: string;
  /** Line count of the source, or 0 when it has not been fetched. */
  lines: number;
  /** Whether the source can be written back. */
  readOnly?: string;
  /** Project-relative path, when a connected project can reach this file. */
  path?: string;
  /** True when the text has to be fetched before it can be shown. */
  remote?: boolean;
  element?: HTMLScriptElement;
  /** Deferred/async, worth knowing when reasoning about order. */
  loading?: 'defer' | 'async';
  /**
   * What a remote source was showing before the edit.
   *
   * Set by the panel once a fetch resolves, so an edit to a file the page cannot
   * write still records what it was changed from.
   */
  pendingBefore?: string;
}

/** Types that hold JavaScript rather than data. */
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);

/**
 * Every script in the document, in document order.
 *
 * The overlay's own scripts are skipped: the bundle that draws this panel is not
 * part of the page's code, and offering it for editing would be an invitation to
 * break the editor from inside itself.
 */
export function collectScriptSources(project?: FileHost | null): ScriptSource[] {
  const out: ScriptSource[] = [];
  let inlineCount = 0;
  let externalCount = 0;

  for (const element of Array.from(document.scripts)) {
    if (element.hasAttribute(IGNORE_ATTR)) continue;
    if (element.closest(`[${IGNORE_ATTR}]`)) continue;
    // The overlay's own bundle, however it was loaded.
    if (element.hasAttribute('data-heo') || /html-editor-overlay/.test(element.src)) continue;

    const type = (element.getAttribute('type') ?? '').trim().toLowerCase();
    const isData = Boolean(type) && !JS_TYPES.has(type);
    const src = element.getAttribute('src');

    if (src) {
      externalCount += 1;
      const sameOrigin = isSameOrigin(element.src);
      // A connected project can read the file straight off disk, which is the only way
      // this works at all over `file://` — there every file is its own opaque origin, so
      // a script sitting next to the page is "another origin" as far as fetch is
      // concerned.
      const path = project ? (project.resolve(element.src) ?? undefined) : undefined;
      out.push({
        id: `script-ext-${externalCount}`,
        kind: type === 'module' ? 'module' : isData ? 'json' : 'external',
        label: fileName(element.src) ?? `script ${externalCount}`,
        href: element.src,
        type: type || undefined,
        lines: 0,
        remote: true,
        element,
        path,
        loading: element.defer ? 'defer' : element.async ? 'async' : undefined,
        readOnly:
          sameOrigin || path
            ? undefined
            : 'Served from another origin, so its text cannot be read from this page.',
      });
      continue;
    }

    inlineCount += 1;
    const text = element.textContent ?? '';
    out.push({
      id: `script-inline-${inlineCount}`,
      kind: isData ? 'json' : type === 'module' ? 'module' : 'inline',
      label: `inline script ${inlineCount}`,
      type: type || undefined,
      lines: countLines(text),
      element,
    });
  }
  return out;
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function fileName(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).pathname.split('/').pop() || href;
  } catch {
    return href;
  }
}

function countLines(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split('\n').length : 0;
}

/** An inline script's text. External sources have to be fetched; see `fetchScriptSource`. */
export function readScriptSource(source: ScriptSource): string {
  if (source.remote) return '';
  return source.element?.textContent ?? '';
}

/**
 * Fetch an external script's text.
 *
 * Same-origin only, and by design: a cross-origin response is opaque, so asking for
 * it would produce an empty editor with no explanation. `collectScriptSources` has
 * already said so in `readOnly`.
 */
export async function fetchScriptSource(
  source: ScriptSource,
  project?: FileHost | null,
): Promise<string> {
  // Disk first, for the same two reasons the stylesheets have: over `file://` it is the
  // only thing that works, and behind a dev server a request can return a transformed
  // copy of a file this buffer will later be written back over.
  if (source.path && project) {
    const text = await project.read(source.path);
    if (text !== null) return text;
  }
  if (!source.href || source.readOnly) return '';
  const response = await fetch(source.href, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

/**
 * Record an edit to a script, reversibly.
 *
 * For an inline script the element's text is rewritten, so the exported document and
 * anything reading the DOM see the new source. For an external one there is nothing
 * in the page to write, so the change exists only as a record — which is still the
 * useful outcome, because the prompt then names the file and carries the new source
 * for whoever owns the repository.
 *
 * Neither case executes anything. `runScriptSource` is how that happens, when asked.
 */
export function writeScriptSource(source: ScriptSource, code: string): Command | null {
  if (source.readOnly) return null;
  const element = source.element;
  const before = source.remote ? (source.pendingBefore ?? '') : readScriptSource(source);
  const after = code;
  if (before.trim() === after.trim()) return null;

  const apply = (): void => {
    if (element && !source.remote) element.textContent = after;
  };
  const revert = (): void => {
    if (element && !source.remote) element.textContent = before;
  };

  return {
    label: `Edit ${source.label}`,
    // Keyed on the source so successive edits to one file collapse into a single
    // reported change rather than a list of intermediate states.
    subject: `script:${source.id}`,
    record: {
      id: nextChangeId(),
      /*
       * An inline script is a text edit, an external one is not.
       *
       * The distinction decides whether the save can patch the file, and getting it wrong cost
       * every inline script edit a whole-file rewrite. An inline `<script>` *is* in the HTML: its
       * body is the text between two tags, which is precisely what the patcher's text edit
       * replaces. Recording it as `'attribute'` sent it down a path that then asked which
       * attribute had changed, found no answer and no anchor, and gave up on the file.
       *
       * An external script has no text in the page at all — its record is a courier for a
       * separate file, handled before the document is ever considered — so it keeps the shape it
       * had, and the kind it is given is never used to patch anything.
       */
      kind: source.remote ? 'attribute' : 'text',
      summary: source.remote
        ? `Edit the JavaScript in ${source.label} (not applied to the running page)`
        : `Edit the JavaScript in ${source.label}`,
      target: source.href ?? source.label,
      group: `script:${source.id}`,
      before: summarize(before),
      after: summarize(after),
      /*
       * How to find the tag again in the file.
       *
       * The other half of the same bug: with no anchor the patcher cannot say which `<script>`
       * this is, so it declined and the page was serialized. `anchorFor` gives it the id when the
       * tag has one and its position inside a findable container when it does not — and for a
       * text edit the old body can stand in as well, which for a script is about as distinctive
       * as an anchor gets.
       */
      ...(element && !source.remote ? { anchor: anchorFor(element) } : {}),
      detail: {
        file: source.href ?? source.label,
        scope: source.remote ? 'external script' : 'inline script',
        script: after,
        // An inline script's text was rewritten in the DOM, so serializing the page
        // carries it. An external one has a file of its own, and nothing in the page
        // to carry it at all.
        writeTo: source.remote ? (source.href ?? DOCUMENT_TARGET) : DOCUMENT_TARGET,
      },
      at: Date.now(),
    },
    apply,
    revert,
  };
}

/**
 * Run an edited script, deliberately.
 *
 * Separate from saving the text because they are different acts with different
 * consequences. Editing a script is safe; running it again re-declares whatever it
 * declared and re-attaches whatever it attached, which on a second pass can throw on
 * a duplicate `const` or bind a listener twice. The panel says so before offering it.
 *
 * A fresh element rather than the original: re-inserting the same node does not
 * re-execute it, because the browser marks a script "already started" for life.
 */
export function runScriptSource(source: ScriptSource, code: string): string | null {
  const original = source.element;
  const script = document.createElement('script');
  script.setAttribute(IGNORE_ATTR, '');
  if (source.type) script.type = source.type;
  script.textContent = code;
  let failure: string | null = null;
  const onError = (event: ErrorEvent): void => {
    failure = event.message;
  };
  addEventListener('error', onError);
  try {
    (original?.parentNode ?? document.body).appendChild(script);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    removeEventListener('error', onError);
    // The work is done the moment it executes, and leaving it behind would double
    // every script in the document each time the button is pressed.
    script.remove();
  }
  return failure;
}

/**
 * The script's text as recorded, in full.
 *
 * This used to keep the first 90 characters and the last 50 with an ellipsis between
 * them, which is the worst shape a truncation can take: the result looks like valid
 * code and is not, so a reader cannot tell that the middle is missing. The whole
 * source is recorded and the prompt emits it as a block.
 */
function summarize(text: string): string {
  return text;
}
