import { HOST_TAG, INSERTED_ATTR, MODAL_ATTR, SOURCE_ATTR } from './constants.js';
import type { ClassRegistry } from './classes.js';
import type { BlockLibrary } from './library.js';
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
export function exportDesignSystem(
  tokens: TokenRegistry,
  classes: ClassRegistry,
  library: BlockLibrary,
  name = 'Design system',
): DesignSystemDocument {
  return {
    $schema: SCHEMA,
    name,
    version: 1,
    createdAt: new Date().toISOString(),
    tokens: tokens.export(),
    classes: classes.export(),
    blocks: library.export(),
  };
}

export interface ImportResult {
  tokens: number;
  classes: number;
  blocks: number;
}

export function importDesignSystem(
  document_: unknown,
  registries: { tokens: TokenRegistry; classes: ClassRegistry; library: BlockLibrary },
  options: { overwrite?: boolean } = {},
): ImportResult {
  const parsed = parseDesignSystem(document_);
  return {
    tokens: registries.tokens.import(parsed.tokens, options),
    classes: registries.classes.import(parsed.classes, options),
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
  const arrays: Array<keyof DesignSystemDocument> = ['tokens', 'classes', 'blocks'];
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
export function exportHTML(): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;

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
  for (const generated of Array.from(clone.querySelectorAll('[data-heo-generated]'))) {
    // Keep the CSS, drop the marker: the exported page should still look right.
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

  // The scroll lock, which is on `<html>` itself — and `<html>` is what was cloned,
  // so it is not reachable by `querySelectorAll`. Exporting from the save dialog's
  // own footer happens with a modal open by definition, which is exactly when this
  // is set.
  clone.removeAttribute(MODAL_ATTR);

  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}>\n`
    : '<!DOCTYPE html>\n';
  return `${doctype}${clone.outerHTML}\n`;
}
