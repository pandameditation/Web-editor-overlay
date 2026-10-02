import { normalizeClassName } from './classes.js';
import { isMutable } from './dom.js';
import type { BlockExtraction, ClassExtraction, HtmlPaste, SourceEdit } from './editor.js';
import { previewMarkup } from './sanitize.js';
import { selectorProblem } from './selectors.js';
import { normalizeCustomElementTag, propNameProblem, suggestPropName, type BlockPropRow } from './library.js';

/**
 * What is wrong with a form's values, field by field.
 *
 * Declared here, beside the engine, rather than in the dialogs, so the engine refuses exactly what
 * the dialogs point at: a caller using the public API gets the same answer a person gets, and the
 * two cannot drift apart. `field` is the name the dialog wires its input with.
 */
export interface FieldIssue {
  field: string;
  message: string;
}

export function classExtractionIssues(pending: ClassExtraction): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!pending.name.trim()) {
    issues.push({ field: 'class-name', message: 'Type a name for the class.' });
  } else if (!normalizeClassName(pending.name)) {
    issues.push({
      field: 'class-name',
      message: 'A class name starts with a letter and uses only letters, numbers, - or _.',
    });
  }
  const kept = Object.entries(pending.declarations).filter(
    ([property, value]) => pending.include[property] !== false && value.trim() !== '',
  );
  if (!kept.length) {
    issues.push({ field: 'declarations', message: 'Keep at least one declaration, or the class would be empty.' });
  }
  return issues;
}

/** The first step of a block: what it is called and what it is made of. */
export function blockSourceIssues(pending: BlockExtraction): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const tag = normalizeCustomElementTag(pending.tag);
  const hasScript = Boolean(pending.script.trim());
  if (!pending.name.trim()) {
    issues.push({ field: 'block-name', message: 'Type a name for this block. It is how you will find it in the Library.' });
  }
  if (!hasScript && !pending.html.trim()) {
    issues.push({ field: 'block-html', message: 'Write the markup the block inserts.' });
  }
  if (hasScript && !tag) {
    issues.push({
      field: 'block-tag',
      message: 'A component with a module needs a custom element tag: lowercase letters, numbers and at least one hyphen.',
    });
  }
  if (tag && !hasScript) {
    issues.push({
      field: 'block-script',
      message: `Add the module that defines <${tag}>, or clear the tag to save plain markup.`,
    });
  } else if (hasScript && tag && !pending.script.includes('customElements.define')) {
    issues.push({
      field: 'block-script',
      message: `The module has to call customElements.define('${tag}', …) for the tag to exist.`,
    });
  }
  return issues;
}

/** The second step: one name per prop, each usable and unique. */
export function blockPropIssues(rows: readonly BlockPropRow[]): FieldIssue[] {
  const names = rows.map((row) => row.name.trim());
  const issues: FieldIssue[] = [];
  rows.forEach((row, index) => {
    const problem = propNameProblem(row.name, names.filter((_, other) => other !== index));
    if (problem) issues.push({ field: blockPropField(index), message: problem });
  });
  return issues;
}

/** The field name of a prop's name input, shared by the dialog and `blockPropIssues`. */
export function blockPropField(index: number): string {
  return `prop-name-${index}`;
}

/** A one-click fix for a prop name, when there is a usable one nobody else has. */
export function blockPropSuggestion(rows: readonly BlockPropRow[], index: number): string | null {
  const row = rows[index];
  if (!row) return null;
  const suggestion = suggestPropName(row.name);
  if (!suggestion || suggestion === row.name.trim()) return null;
  const others = rows.map((one) => one.name.trim()).filter((_, other) => other !== index);
  return propNameProblem(suggestion, others) ? null : suggestion;
}

/** Pasting markup into the page: something to insert, made of elements, somewhere it can go. */
export function htmlPasteIssues(open: HtmlPaste): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const draft = open.draft.trim();
  if (!draft) {
    issues.push({ field: 'html-draft', message: 'Write or paste the markup to insert.' });
  } else {
    const preview = previewMarkup(draft);
    if (!preview.elements) {
      issues.push({
        field: 'html-draft',
        message: preview.looseText
          ? 'That is text with no element around it. Wrap it in a tag — a <p>, say — and it can be placed.'
          : 'No element in that markup. A paste has to start with a tag.',
      });
    }
  }
  if (open.anchor.position === 'replace' && !isMutable(open.anchor.reference)) {
    issues.push({ field: 'html-where', message: 'This element cannot be replaced. Choose where else the markup goes.' });
  }
  return issues;
}

/** Editing the code behind rendered content: there has to be an edit to record. */
export function sourceEditIssues(open: SourceEdit): FieldIssue[] {
  if (!open.window) return [];
  return open.draft === open.window.code
    ? [{ field: 'source-draft', message: 'Change the code before recording it — this is still what the file says.' }]
    : [];
}

/** A selector typed into a form: present, and one the browser accepts. */
export function selectorIssues(field: string, raw: string): FieldIssue[] {
  if (!raw.trim()) return [{ field, message: 'Type or choose a selector.' }];
  const problem = selectorProblem(raw);
  return problem ? [{ field, message: problem }] : [];
}

/** A class name typed into a form: present, and one CSS can use. */
export function classNameIssues(field: string, raw: string): FieldIssue[] {
  if (!raw.trim().replace(/^\./, '')) return [{ field, message: 'Type a class name.' }];
  return normalizeClassName(raw)
    ? []
    : [{ field, message: 'A class name starts with a letter and uses only letters, numbers, - or _.' }];
}

/**
 * A name for a copy of a class. Optional — left empty the editor picks a free one — but when given
 * it has to be usable, new, and not the class being copied.
 */
export function forkNameIssues(
  field: string,
  requested: string,
  original: string,
  exists: (name: string) => boolean,
): FieldIssue[] {
  if (!requested.trim()) return [];
  const name = normalizeClassName(requested);
  if (!name) return [{ field, message: 'A class name starts with a letter and uses only letters, numbers, - or _.' }];
  if (name === original) return [{ field, message: 'The copy needs a name of its own.' }];
  if (exists(name)) return [{ field, message: `.${name} already exists. Choose another name.` }];
  return [];
}
