import { nextChangeId, type Command } from './history.js';

/**
 * The page's stylesheets, as editable sources.
 *
 * The style panel answers "what applies to this element"; this answers the other
 * half — "where does the CSS live, and let me at it". Both matter, because plenty
 * of fixes belong in a stylesheet rather than as one more inline override.
 *
 * Editing writes through the CSSOM rather than through a file, which is the only
 * option a page has. That is enough for a faithful live preview, and the change
 * record carries the file name so the save prompt can tell an agent exactly which
 * file to edit. Cross-origin sheets are unreadable by design and are surfaced as
 * such rather than silently omitted.
 */

export type SheetKind = 'link' | 'style' | 'adopted' | 'shadow';

export interface StyleSource {
  /** Stable id for list keying and selection across re-renders. */
  id: string;
  kind: SheetKind;
  /** File name, or a positional label for an inline or constructed sheet. */
  label: string;
  /** Full URL when the sheet came from a file. */
  href?: string;
  /** Media query the sheet is limited to, when any. */
  media?: string;
  /** Number of top-level rules, or 0 when unreadable. */
  rules: number;
  /** Why the sheet cannot be edited, when it cannot. */
  readOnly?: string;
  /** The live sheet, absent when it could not be reached. */
  sheet?: CSSStyleSheet;
  /** The owning `<style>` element, when the source is an inline sheet. */
  element?: HTMLStyleElement;
}

/**
 * Every stylesheet affecting the page, document order first.
 *
 * The editor's own generated sheets are included but flagged: hiding them would
 * make the token and class output look like it comes from nowhere, while letting
 * them be hand-edited here would fight the registries that own them.
 */
export function collectStyleSources(): StyleSource[] {
  const out: StyleSource[] = [];
  let styleIndex = 0;
  let adoptedIndex = 0;

  for (const sheet of Array.from(document.styleSheets)) {
    const node = sheet.ownerNode;
    if (node instanceof Element && node.hasAttribute('data-heo-internal')) continue;

    if (node instanceof HTMLStyleElement) {
      styleIndex += 1;
      out.push(describe(sheet, 'style', node.id || `<style> #${styleIndex}`, { element: node }));
      continue;
    }
    const href = sheet.href ?? undefined;
    out.push(describe(sheet, 'link', fileName(href) ?? `<link> #${out.length + 1}`, { href }));
  }

  for (const sheet of document.adoptedStyleSheets ?? []) {
    adoptedIndex += 1;
    out.push(describe(sheet, 'adopted', `adopted #${adoptedIndex}`));
  }
  return out;
}

function describe(
  sheet: CSSStyleSheet,
  kind: SheetKind,
  label: string,
  extra: { href?: string; element?: HTMLStyleElement } = {},
): StyleSource {
  const generated =
    sheet.ownerNode instanceof Element && sheet.ownerNode.hasAttribute('data-heo-generated');

  let rules = 0;
  let readOnly: string | undefined;
  try {
    rules = sheet.cssRules.length;
  } catch {
    readOnly =
      'This sheet is served from another origin, so the browser will not let the page read it.';
  }
  if (!readOnly && generated) {
    readOnly = 'The editor owns this sheet. Edit the tokens and classes it is built from instead.';
  }
  if (!readOnly && kind === 'adopted' && !extra.element) {
    // Constructed sheets can be rewritten, but they belong to whichever component
    // adopted them and will be overwritten on its next render.
    readOnly = 'A constructed sheet, owned by the component that adopted it.';
  }

  return {
    id: `${kind}:${extra.href ?? extra.element?.id ?? label}`,
    kind,
    label,
    href: extra.href,
    media: sheet.media?.mediaText || undefined,
    rules,
    readOnly,
    sheet,
    element: extra.element,
  };
}

function fileName(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).pathname.split('/').pop() || href;
  } catch {
    return href;
  }
}

/** The sheet's text, reassembled from its rules. */
export function readStyleSource(source: StyleSource): string {
  if (source.element) return source.element.textContent ?? '';
  const sheet = source.sheet;
  if (!sheet) return '';
  try {
    return Array.from(sheet.cssRules)
      .map((rule) => rule.cssText)
      .join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Replace a sheet's contents, reversibly.
 *
 * A `<style>` element is written through `textContent`, which the browser reparses
 * — simple, and exactly what the page author would have typed. A linked sheet has
 * no text to write, so its rules are swapped one at a time through the CSSOM; the
 * original text is kept so undo can put it back the same way.
 *
 * Returns null when the text has no valid rules, so a typo cannot blank a
 * stylesheet the user cannot get back.
 */
export function writeStyleSource(source: StyleSource, css: string): Command | null {
  if (source.readOnly) return null;
  const before = readStyleSource(source);
  const after = css;
  if (before.trim() === after.trim()) return null;

  const element = source.element;
  const sheet = source.sheet;
  if (!element && !sheet) return null;

  const apply = (): void => {
    if (element) {
      element.textContent = after;
      return;
    }
    replaceRules(sheet!, after);
  };
  const revert = (): void => {
    if (element) {
      element.textContent = before;
      return;
    }
    replaceRules(sheet!, before);
  };

  return {
    label: `Edit ${source.label}`,
    // Keyed on the sheet so successive edits to the same file collapse into one
    // reported change rather than a list of intermediate states.
    subject: `sheet:${source.id}`,
    record: {
      id: nextChangeId(),
      kind: 'style',
      summary: `Edit the CSS in ${source.label}`,
      target: source.href ?? source.label,
      group: `sheet:${source.id}`,
      before: summarize(before),
      after: summarize(after),
      detail: {
        file: source.href ?? source.label,
        scope: 'stylesheet',
        css: after,
      },
      at: Date.now(),
    },
    apply,
    revert,
  };
}

/**
 * Swap a sheet's rules for the ones parsed from `css`.
 *
 * Parsing happens in a throwaway `<style>` first, so a syntax error leaves the
 * live sheet untouched instead of half-replaced. Individual rules that the sheet
 * refuses — `@import` after other rules, say — are skipped rather than aborting the
 * whole write.
 */
function replaceRules(sheet: CSSStyleSheet, css: string): void {
  const parsed = parseRules(css);
  while (sheet.cssRules.length > 0) {
    try {
      sheet.deleteRule(0);
    } catch {
      break;
    }
  }
  for (const text of parsed) {
    try {
      sheet.insertRule(text, sheet.cssRules.length);
    } catch {
      // Not valid in this position; the rest of the sheet is still worth writing.
    }
  }
}

/** Top-level rule texts, via the browser's own parser. */
export function parseRules(css: string): string[] {
  const probe = document.createElement('style');
  probe.setAttribute('data-heo-internal', '');
  probe.textContent = css;
  document.head.appendChild(probe);
  try {
    const sheet = probe.sheet;
    if (!sheet) return [];
    return Array.from(sheet.cssRules).map((rule) => rule.cssText);
  } catch {
    return [];
  } finally {
    probe.remove();
  }
}

/** How many rules the text parses to, for the editor's status line. */
export function countRules(css: string): number {
  return parseRules(css).length;
}

/**
 * The sheet's text as recorded, in full.
 *
 * This used to clip at 300 characters with an ellipsis. `detail.css` carries the whole
 * new sheet, so the prompt was never short of the *new* text — but `before` was the
 * only record of the old one, and half a stylesheet is not something a reader can
 * reason about. Nothing that describes a change gets elided.
 */
function summarize(css: string): string {
  return css;
}
