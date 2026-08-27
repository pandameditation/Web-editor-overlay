import type { ChangeRecord, DesignClass, DesignToken, LibraryBlock } from './types.js';

/**
 * Turns an editing session into instructions a coding agent can execute.
 *
 * The overlay edits a rendered page, not source files. Rather than guess at a
 * source transformation, it describes exactly what changed and where, then hands
 * that to whoever owns the codebase.
 *
 * Three things shape the output, all of them lessons from watching models fail on
 * it:
 *
 * - **One element, one entry.** Records are grouped by what they are about, so
 *   duplicating a block and then moving the copy reads as two ordered steps in one
 *   place instead of two entries that could sit pages apart. Split up, a model
 *   applied the duplicate, lost track, and moved the original.
 * - **`from X to Y`, never `Before:`/`After:`.** Labelled fields were read as
 *   two independent facts often enough to matter; a single directional sentence
 *   cannot be.
 * - **Payloads live in addressable blocks.** Markup and whole-file contents are not
 *   nested inside list items — cheaper models mangle indented fences — and are not
 *   truncated. Each block has a number the step refers to.
 *
 * Prose is kept to a minimum for the same reason. Every sentence that is not an
 * instruction is a sentence that can be mistaken for one.
 */

export interface PromptInput {
  records: ChangeRecord[];
  tokens: DesignToken[];
  classes: DesignClass[];
  blocks: LibraryBlock[];
  tokenCSS: string;
  classCSS: string;
  pageURL: string;
  /** Blocks whose custom elements were injected during the session. */
  injectedElements?: string[];
}

const KIND_LABEL: Record<ChangeRecord['kind'], string> = {
  text: 'text',
  style: 'style',
  class: 'class',
  attribute: 'attribute',
  insert: 'insert',
  delete: 'delete',
  move: 'move',
  wrap: 'wrap',
  duplicate: 'duplicate',
  replace: 'markup',
  token: 'design token',
  'token-class': 'reusable class',
};

/** A payload too large for a sentence, given a number the steps can point at. */
interface Attachment {
  id: number;
  kind: 'markup' | 'text' | 'file';
  language: string;
  title: string;
  body: string;
}

export function buildPrompt(input: PromptInput): string {
  const { records } = input;
  if (!records.length) return 'No changes were made in this editing session.';

  const attachments: Attachment[] = [];
  const groups = groupRecords(records);
  const sections: string[] = [
    header(input),
    rules(input, records),
  ];

  const tokenSection = tokenChanges(input);
  if (tokenSection) sections.push(tokenSection);

  const classSection = classChanges(input);
  if (classSection) sections.push(classSection);

  // Built before the attachment sections, because rendering a step is what
  // registers the attachment it refers to.
  sections.push(editSection(groups, attachments));

  const markup = attachments.filter((item) => item.kind === 'markup');
  if (markup.length) sections.push(attachmentSection('Markup', markup));

  const texts = attachments.filter((item) => item.kind === 'text');
  if (texts.length) sections.push(attachmentSection('Text', texts));

  const files = attachments.filter((item) => item.kind === 'file');
  if (files.length) sections.push(attachmentSection('Full file contents', files));

  const componentSection = injectedComponents(input);
  if (componentSection) sections.push(componentSection);

  sections.push(checklist(records));

  return sections.filter(Boolean).join('\n\n');
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                    */
/* -------------------------------------------------------------------------- */

interface EditGroup {
  records: ChangeRecord[];
  /** First source location any record in the group carries. */
  source: ChangeRecord['source'];
}

/**
 * One group per thing edited, in the order each was first touched.
 *
 * `group` is the record's own identity for what it is about; `target` is the
 * fallback for records minted before that field existed or by paths that have no
 * element. Chronological order within a group is what makes the steps replayable —
 * a move after a duplicate has to be read second or it moves the wrong node.
 */
function groupRecords(records: ChangeRecord[]): EditGroup[] {
  const byKey = new Map<string, EditGroup>();
  for (const record of records) {
    const key = record.group ?? record.target;
    const existing = byKey.get(key);
    if (existing) {
      existing.records.push(record);
      existing.source ??= record.source;
    } else {
      byKey.set(key, { records: [record], source: record.source });
    }
  }

  // File and line order, so the agent walks each file once. Groups with no source
  // location come last; among equals, the order they were edited in.
  const groups = [...byKey.values()];
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const fileA = a.group.source?.file ?? '\uffff';
      const fileB = b.group.source?.file ?? '\uffff';
      if (fileA !== fileB) return fileA.localeCompare(fileB);
      const lineA = a.group.source?.line ?? 0;
      const lineB = b.group.source?.line ?? 0;
      if (lineA !== lineB) return lineA - lineB;
      const columnA = a.group.source?.column ?? 0;
      const columnB = b.group.source?.column ?? 0;
      if (columnA !== columnB) return columnA - columnB;
      return a.index - b.index;
    })
    .map((entry) => entry.group);
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

function header(input: PromptInput): string {
  const total = input.records.length;
  return [
    `# Apply ${total} visual edit${total === 1 ? '' : 's'} to the source code`,
    '',
    `A designer made these edits directly in the rendered page at \`${input.pageURL}\`.`,
    'The page was not saved, so this document is the only record of them.',
    'Apply every edit in the "Edits" section to the source code. Apply nothing else.',
    '',
    `Summary: ${summarise(input.records)}.`,
  ].join('\n');
}

function summarise(records: ChangeRecord[]): string {
  const counts = new Map<ChangeRecord['kind'], number>();
  for (const record of records) counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${KIND_LABEL[kind]}`)
    .join(', ');
}

/**
 * The rules, as numbered imperatives.
 *
 * Only rules that apply to this session are included: a page with no instrumented
 * records must not be told how to read line numbers, and a session that defined no
 * tokens must not be told to prefer them. An inapplicable rule is noise, and noise
 * is what small models spend their attention on.
 */
function rules(input: PromptInput, records: ChangeRecord[]): string {
  const items = [
    'Edit the existing files that render this page. Do not add a CSS framework, a component library, or a new styling approach.',
    'Copy every value exactly as written. A value written as `var(--name)` must stay `var(--name)`; do not replace it with the colour or size it resolves to.',
    'Put each declaration where this project already puts them. If a stylesheet rule or a class styles the element, change that rule. Add an inline `style` attribute only where the element already has one.',
    'Change only what is listed below. Do not reformat code, reorder imports, rename anything, or alter nearby code.',
  ];

  if (records.some((record) => record.source)) {
    items.push(
      'A `line` and `column` locate the element in the file as it was during the session. Use them to find it, then confirm it by its tag name and attributes before editing. If they disagree, trust the tag name and attributes.',
    );
  }
  if (records.some((record) => !record.source)) {
    items.push(
      'Where an edit gives only a CSS selector, find the code that renders that element — including loops, partials and components — and edit that source, not one copy of its output.',
    );
  }
  if (input.tokens.some((token) => token.origin && token.origin !== 'stylesheet')) {
    items.push(
      'Add the tokens in "Design tokens" before applying edits that reference them.',
    );
  }

  return [
    '## Rules',
    '',
    items.map((item, index) => `${index + 1}. ${item}`).join('\n'),
  ].join('\n');
}

function tokenChanges(input: PromptInput): string | null {
  const authored = input.tokens.filter((token) => token.origin && token.origin !== 'stylesheet');
  if (!authored.length) return null;

  return [
    '## Design tokens',
    '',
    `Add ${authored.length === 1 ? 'this custom property' : `these ${authored.length} custom properties`} wherever this project declares its tokens — a theme file, a \`:root\` block, or a token module. Do not add them to the page itself.`,
    '',
    '```css',
    input.tokenCSS.trim() || renderTokenCSS(authored),
    '```',
  ].join('\n');
}

function renderTokenCSS(tokens: DesignToken[]): string {
  return [':root {', ...tokens.map((token) => `  --${token.name}: ${token.value};`), '}'].join('\n');
}

function classChanges(input: PromptInput): string | null {
  const authored = input.classes.filter((entry) => entry.origin && entry.origin !== 'stylesheet');
  if (!authored.length) return null;

  return [
    '## Reusable classes',
    '',
    `Add ${authored.length === 1 ? 'this class' : `these ${authored.length} classes`} to this project's stylesheet. The edits below say which elements use ${authored.length === 1 ? 'it' : 'them'}.`,
    '',
    '```css',
    input.classCSS.trim() || renderClassCSS(authored),
    '```',
  ].join('\n');
}

function renderClassCSS(classes: DesignClass[]): string {
  return classes
    .map(
      (entry) =>
        `.${entry.name} {\n${Object.entries(entry.declarations)
          .map(([property, value]) => `  ${property}: ${value};`)
          .join('\n')}\n}`,
    )
    .join('\n\n');
}

function editSection(groups: EditGroup[], attachments: Attachment[]): string {
  const lines = ['## Edits'];

  groups.forEach((group, index) => {
    const steps = group.records.flatMap((record) => stepsFor(record, attachments));
    lines.push('', `### Edit ${index + 1} — ${groupTitle(group)}`, '');
    lines.push(locationLine(group));
    if (steps.length > 1) {
      lines.push(
        `${steps.length} operations on the same target. Apply them in this order.`,
      );
    }
    lines.push('');
    lines.push(steps.map((step, position) => `${position + 1}. ${step}`).join('\n'));
  });

  return lines.join('\n');
}

/**
 * What this group of records is about, named the way the agent has to find it.
 *
 * The last record's target rather than the first: after a duplicate the group is
 * about the copy, and the copy's selector is the one recorded last. Where the two
 * disagree the original is named too, because "the second `.card`" is only findable
 * if you know which one it was copied from.
 */
function groupTitle(group: EditGroup): string {
  const first = group.records[0];
  const last = group.records[group.records.length - 1];
  const scope = first.detail?.scope;

  if (scope === 'stylesheet') return `the stylesheet ${code(first.target)}`;
  if (scope === 'external script' || scope === 'inline script') {
    return `the script ${code(first.target)}`;
  }
  if (scope === 'stylesheet rule') return `the CSS rule ${code(first.target)}`;
  if (scope === 'document head') return 'the document head';
  if (first.kind === 'token' || first.kind === 'token-class') {
    return `the design system (${code(first.target)})`;
  }

  if (last.target !== first.target) {
    return `${code(last.target)} (created from ${code(first.target)})`;
  }
  return code(last.target);
}

function locationLine(group: EditGroup): string {
  const source = group.source;
  if (source) {
    return `File: \`${source.file}\` — line ${source.line}, column ${source.column}`;
  }
  const first = group.records[0];
  if (first.detail?.file) return `File: \`${first.detail.file}\``;
  return `No source location was recorded. Find this by its selector: ${code(first.target)}`;
}

/* -------------------------------------------------------------------------- */
/* One record as one instruction                                               */
/* -------------------------------------------------------------------------- */

/**
 * A record as one or more imperative sentences.
 *
 * Directional throughout: `from X to Y`, never a `Before:` line beside an `After:`
 * line. The two-field form was read as two separate states to produce as often as
 * it was read as a transition.
 */
function stepsFor(record: ChangeRecord, attachments: Attachment[]): string[] {
  const detail = record.detail ?? {};
  const scope = detail.scope;

  // Whole-file replacements: the text is the instruction, so it goes in a block.
  if (scope === 'stylesheet' && detail.css) {
    const ref = attach(attachments, 'file', 'css', `\`${detail.file ?? record.target}\``, detail.css);
    return [
      `Replace the entire contents of \`${detail.file ?? record.target}\` with ${ref}. Keep the file's existing comments and formatting where the new contents match the old.`,
    ];
  }
  if ((scope === 'external script' || scope === 'inline script') && detail.script) {
    const ref = attach(attachments, 'file', 'js', `\`${detail.file ?? record.target}\``, detail.script);
    const note =
      scope === 'external script'
        ? ' This was never executed in the page, so it has not been verified at runtime.'
        : '';
    return [`Replace the entire contents of \`${detail.file ?? record.target}\` with ${ref}.${note}`];
  }

  switch (record.kind) {
    case 'style':
      return [styleStep(record, detail, attachments)];

    case 'text': {
      const to = record.after ?? '';
      if (!to.trim()) {
        return [
          `Remove the text content of this element, leaving it empty${record.before ? `. It was ${valueOf(record.before, attachments, `previous text of ${code(record.target)}`)}` : ''}.`,
        ];
      }
      const after = valueOf(to, attachments, `new text for ${code(record.target)}`);
      return [
        record.before
          ? `Change the text content from ${valueOf(record.before, attachments, `previous text of ${code(record.target)}`)} to ${after}.`
          : `Set the text content to ${after}.`,
      ];
    }

    case 'class':
      return [
        `Change the \`class\` attribute from ${valueOf(record.before ?? '', attachments, 'previous class attribute')} to ${valueOf(record.after ?? '', attachments, 'new class attribute')}.`,
      ];

    case 'attribute': {
      if (scope === 'document head') {
        const tag = detail.tag ?? record.target;
        const was = record.before
          ? ` It was ${valueOf(record.before, attachments, `previous ${tag}`)}.`
          : '';
        return [
          record.after
            ? `In the document \`<head>\`, set \`${tag}\` to ${valueOf(record.after, attachments, `new ${tag}`)}.${was}`
            : `Remove \`${tag}\` from the document \`<head>\`.${was}`,
        ];
      }
      const name = attributeName(record);
      const was = record.before
        ? ` It was ${valueOf(record.before, attachments, `previous ${name} value`)}.`
        : '';
      if (!record.after) return [`Remove the \`${name}\` attribute.${was}`];
      const to = valueOf(record.after, attachments, `new ${name} value`);
      return [
        record.before
          ? `Change the \`${name}\` attribute from ${valueOf(record.before, attachments, `previous ${name} value`)} to ${to}.`
          : `Add the \`${name}\` attribute with the value ${to}.`,
      ];
    }

    case 'insert': {
      const where = POSITION_PHRASE[detail.position ?? 'lastChild'] ?? 'inside';
      const ref = detail.html
        ? attach(attachments, 'markup', 'html', `inserted ${where} ${code(record.target)}`, detail.html)
        : null;
      return [`Insert new markup ${where} ${code(record.target)}${ref ? `. The markup is ${ref}` : ''}.`];
    }

    case 'delete': {
      // Recorded through `valueOf`, not as Markup. The Markup section means "produce
      // this"; a deleted element's markup is the opposite — it is there so the agent
      // can recognise what to take out, and filing it under an instruction to
      // reproduce it inverted the edit.
      const was = record.before
        ? ` It was ${valueOf(record.before, attachments, `deleted from ${code(record.target)}`)}.`
        : '';
      return [
        `Delete this element and its contents.${was} Also remove any styles, assets, handlers or imports that nothing else uses once it is gone.`,
      ];
    }

    case 'duplicate':
      return [
        `Add a second copy of ${code(record.target)} immediately after it, identical except that it must not repeat the \`id\`. Every step below applies to the copy, not to the original.`,
      ];

    case 'move':
      return [moveStep(record, detail)];

    case 'wrap': {
      const ref = detail.wrapper
        ? attach(attachments, 'markup', 'html', `wrapper for ${code(record.target)}`, detail.wrapper)
        : null;
      return [
        `Wrap this element in a new parent${ref ? `, shown in ${ref}` : ''}. Keep this element and its contents unchanged inside it, in the same position among its siblings.`,
      ];
    }

    case 'replace': {
      if (detail.html) {
        const ref = attach(attachments, 'markup', 'html', `replaces ${code(record.target)}`, detail.html);
        return [`Replace this element with the markup in ${ref}.`];
      }
      // A tag swap: both sides are bare tag names, so they cannot be markup.
      if (record.before && record.after && !/[<>\s]/.test(record.before + record.after)) {
        return [
          `Change the tag from \`<${record.before}>\` to \`<${record.after}>\`, keeping every attribute and child unchanged.`,
        ];
      }
      if (record.before) {
        const was = valueOf(record.before, attachments, `previous markup of ${code(record.target)}`);
        const to = record.after
          ? valueOf(record.after, attachments, `new markup of ${code(record.target)}`)
          : null;
        return [
          to
            ? `Change this element's markup from ${was} to ${to}.`
            : `${sentence(record.summary)}. It was ${was}.`,
        ];
      }
      return [`${sentence(record.summary)}.`];
    }

    case 'token':
      return [
        record.before
          ? `Change the \`--${detail.name ?? record.target}\` token from ${valueOf(record.before, attachments, 'previous token value')} to ${valueOf(record.after ?? '', attachments, 'new token value')}.`
          : `${sentence(record.summary)}. See "Design tokens" above.`,
      ];

    case 'token-class':
      return [`${sentence(record.summary)}. See "Reusable classes" above.`];

    default:
      return [`${sentence(record.summary)}.`];
  }
}

function styleStep(
  record: ChangeRecord,
  detail: Record<string, string>,
  attachments: Attachment[],
): string {
  const property = detail.property;
  const inRule =
    detail.scope === 'stylesheet rule' && detail.selector
      ? `In the \`${detail.selector}\` rule, `
      : '';

  if (!property) {
    // A multi-property edit (the box editor). The summary names the group; before and
    // after carry the declaration lists.
    return record.before
      ? `${inRule}${sentence(record.summary)}: from ${valueOf(record.before, attachments, 'previous declarations')} to ${valueOf(record.after ?? '', attachments, 'new declarations')}.`
      : `${inRule}${sentence(record.summary)}: set to ${valueOf(record.after ?? '', attachments, 'new declarations')}.`;
  }

  const next = detail.value || record.after || '';
  if (!next) {
    return `${inRule}Remove the \`${property}\` declaration${record.before ? `. It was \`${property}: ${record.before}\`` : ''}.`;
  }
  if (record.before) {
    return `${inRule}Change \`${property}\` from ${valueOf(record.before, attachments, `previous ${property} value`)} to ${valueOf(next, attachments, `new ${property} value`)}.`;
  }
  return `${inRule}Add the declaration \`${property}: ${next}\`.`;
}

/**
 * A move, stated as two positions in plain words.
 *
 * Indices count element children from zero, and that has to be said rather than
 * implied: the recorded position deliberately ignores text nodes, because the reader
 * is looking at source where the whitespace between tags is invisible.
 */
function moveStep(record: ChangeRecord, detail: Record<string, string>): string {
  const parent = detail.newParent;
  const index = detail.newIndex;
  const rule = 'Change its position in the markup. Do not reposition it with CSS.';

  if (parent && index !== undefined) {
    const wasIn = detail.previousParent;
    const wasAt = detail.previousIndex;
    const from =
      wasIn && wasAt !== undefined
        ? wasIn === parent
          ? ` It was at position ${wasAt} in the same parent.`
          : ` It was at position ${wasAt} inside \`${wasIn}\`.`
        : '';
    return `Move this element to position ${index} inside \`${parent}\`, counting element children from 0 and ignoring whitespace.${from} ${rule}`;
  }
  return `Move this element from \`${record.before ?? 'its original position'}\` to \`${record.after ?? 'its new position'}\`. ${rule}`;
}

/** The attribute an `attribute` record is about, dug out of its summary. */
function attributeName(record: ChangeRecord): string {
  return record.detail?.name ?? /Set (\S+?)=/.exec(record.summary)?.[1] ?? 'attribute';
}

const POSITION_PHRASE: Record<string, string> = {
  before: 'immediately before',
  after: 'immediately after',
  firstChild: 'as the first child of',
  lastChild: 'as the last child of',
  replace: 'in place of',
};

/* -------------------------------------------------------------------------- */
/* Attachments                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Register a payload and return the reference a step should cite.
 *
 * Deliberately not inlined into the step. A fenced block indented inside a
 * numbered list item is the single most reliably mangled construct in this
 * document, and truncating the payload instead — which is what used to happen at
 * 240 characters — silently handed over a stylesheet with its middle missing.
 */
function attach(
  attachments: Attachment[],
  kind: Attachment['kind'],
  language: string,
  title: string,
  body: string,
  options: { trim?: boolean } = {},
): string {
  // Markup and file contents are trimmed because their surrounding blank lines are an
  // artefact of how they were read. A text value is not: leading and trailing
  // whitespace is part of what the user typed, and a fenced block is the only place it
  // survives at all.
  const content = options.trim === false ? body : body.trim();
  const existing = attachments.find((item) => item.kind === kind && item.body === content);
  if (existing) return `${label(kind)} ${existing.id}`;
  const id = attachments.filter((item) => item.kind === kind).length + 1;
  attachments.push({ id, kind, language, title, body: content });
  return `${label(kind)} ${id}`;
}

const ATTACHMENT_LABEL: Record<Attachment['kind'], string> = {
  markup: 'Markup',
  text: 'Text',
  file: 'File',
};

function label(kind: Attachment['kind']): string {
  return ATTACHMENT_LABEL[kind];
}

function attachmentSection(heading: string, items: Attachment[]): string {
  const lines = [`## ${heading}`];
  if (heading === 'Markup') {
    lines.push(
      '',
      'This markup was generated by the editor. Reproduce what it renders, using this project\'s own components and conventions: extract repeated structure into a component, and move inline styles into the stylesheet or token system where this project keeps them.',
    );
  }
  for (const item of items) {
    lines.push(
      '',
      `### ${label(item.kind)} ${item.id} — ${item.title}`,
      '',
      `\`\`\`${item.language}`,
      item.body,
      '```',
    );
  }
  return lines.join('\n');
}

function injectedComponents(input: PromptInput): string | null {
  const blocks = input.blocks.filter((block) => block.element?.tag);
  const injected = input.injectedElements ?? [];
  const used = blocks.filter((block) => injected.includes(block.element!.tag));
  if (!used.length) return null;

  const lines = [
    '## Web components',
    '',
    'These custom elements were inserted into the page. Add each one to the codebase as a real component file and import it where the markup that uses it is rendered.',
  ];
  for (const block of used) {
    lines.push('', `### \`<${block.element!.tag}>\` — ${block.name}`);
    if (block.description) lines.push('', block.description);
    lines.push('', '```js', (block.element!.module ?? block.element!.script ?? '').trim(), '```');
    if (block.css) lines.push('', '```css', block.css.trim(), '```');
  }
  return lines.join('\n');
}

function checklist(records: ChangeRecord[]): string {
  const items = [
    'Every edit above is applied, and no other file changed.',
    'Every `var(--token)` value is still a token reference, not a resolved value.',
  ];
  if (records.some((record) => record.kind === 'move')) {
    items.push('Moved elements changed position in the markup, not via CSS `order` or `flex-direction`.');
  }
  if (records.some((record) => record.kind === 'text')) {
    items.push('Text went into wherever this project keeps copy, including any i18n catalogue.');
  }
  if (records.some((record) => record.kind === 'delete')) {
    items.push('Nothing still references the deleted elements.');
  }
  items.push('The build, type check and linter pass.');

  return [
    '## Check before you finish',
    '',
    items.map((item) => `- [ ] ${item}`).join('\n'),
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A literal as inline code: a selector, a property name, a file name.
 *
 * The fence grows past the longest run of backticks inside, so a value that is
 * itself code — a `calc()` expression, a snippet of markup — cannot break out of it
 * and turn the rest of the line into prose.
 *
 * Never truncates, and never collapses whitespace. For anything that came out of a
 * record, go through `valueOf` instead: it is the one that knows a multi-line value
 * cannot live in an inline span.
 */
function code(text: string): string {
  if (!text) return '`` ``';
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * A recorded value, rendered so it can be copied exactly.
 *
 * Nothing is elided. An earlier version clipped at 300 characters and appended an
 * ellipsis, which left the agent to invent the rest of a paragraph or a stylesheet —
 * and an ellipsis is a legal character in copy, so it could not even be relied on as
 * a marker of "there was more here". Every value now appears in full.
 *
 * Single-line values go inline at any length; an inline code span has no length
 * limit. A value holding a line break becomes a numbered block, because a span cannot
 * carry a newline and collapsing the whitespace to fit would change the value being
 * asked for.
 */
function valueOf(raw: string, attachments: Attachment[], title: string): string {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.includes('\n')) return code(text);
  const isMarkup = /^\s*<[a-zA-Z!/]/.test(text);
  const ref = attach(attachments, 'text', isMarkup ? 'html' : 'text', title, text, { trim: false });
  return `exactly ${isMarkup ? 'the markup' : 'the text'} in ${ref}`;
}

/** A summary reused as a sentence: capitalised, with any trailing stop removed. */
function sentence(summary: string): string {
  const text = summary.trim().replace(/[.\s]+$/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
