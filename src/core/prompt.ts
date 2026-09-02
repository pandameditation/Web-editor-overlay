import { diffCSS, type CssChange } from './css-patch.js';
import type {
  ChangeRecord,
  DesignClass,
  DesignRule,
  DesignToken,
  LibraryBlock,
} from './types.js';

/**
 * Turns an editing session into an edit log a coding agent can execute.
 *
 * The overlay edits a rendered page, not source files. Rather than guess at a source
 * transformation, it says exactly what to change and where, and leaves the rest to
 * whoever owns the codebase.
 *
 * The format is deliberately blunt, and every part of that is a lesson from watching
 * models work from earlier versions of it:
 *
 * - **State the destination, never the journey.** `from X to Y` was still two facts
 *   where one would do, and the first one — the old value — is a thing the reader can
 *   see for themselves in the file. Every step now says only what the result must be.
 * - **The selector leads.** An entry is useless until you have found the element, so
 *   the first thing on the line is what to look for. Locations, when known, follow it.
 * - **One target, one entry.** Duplicating a block and then moving the copy reads as
 *   two ordered sub-steps in one place, not two entries that could sit pages apart.
 *   Split up, a model applied the duplicate, lost track, and moved the original.
 * - **Payloads live in numbered blocks.** Anything with a line break in it goes below,
 *   referenced by number, because a fenced block indented inside a numbered list item
 *   is the single most reliably mangled construct in a Markdown document.
 * - **No headings, no prose.** Bold labels and lists. Every sentence that is not an
 *   instruction is a sentence that can be mistaken for one.
 */

export interface PromptInput {
  records: ChangeRecord[];
  tokens: DesignToken[];
  classes: DesignClass[];
  /** CSS rules the editor owns, as opposed to rules edited in the page's own sheets. */
  cssRules: DesignRule[];
  blocks: LibraryBlock[];
  tokenCSS: string;
  classCSS: string;
  cssRuleCSS: string;
  pageURL: string;
  /** Blocks whose custom elements were injected during the session. */
  injectedElements?: string[];
}

/** A payload too big for a sentence, given a number the steps can point at. */
interface Block {
  id: number;
  language: string;
  title: string;
  body: string;
}

/**
 * Above this many declaration changes to one stylesheet, replacing the file is clearer.
 *
 * Not a performance limit. Forty edits to one file is a rewrite described as a diff, and
 * checking it against the result is harder than reading the file it should end up as.
 */
const MAX_CSS_STEPS = 20;

export function buildPrompt(input: PromptInput): string {
  const { records } = input;
  if (!records.length) return 'No changes were made in this editing session.';

  const blocks: Block[] = [];
  const groups = groupRecords(records);

  // Built first: rendering a step is what registers the blocks it refers to, and what
  // reveals which files are involved.
  const edits = editSection(groups, blocks);

  const sections = [header(input, groups), rules(groups), edits];

  const tokens = designSection(
    'New tokens',
    input.tokenCSS,
    input.tokens,
    'Add these wherever this project declares its tokens. Not to the page.',
  );
  if (tokens) sections.push(tokens);

  const classes = designSection(
    'New classes',
    input.classCSS,
    input.classes,
    "Add these to this project's stylesheet.",
  );
  if (classes) sections.push(classes);

  /*
   * Rules after classes, and the note says what a class's note cannot.
   *
   * A class is inert until something wears it, so pasting one in is safe. A rule applies
   * the moment it lands, to everything its selector matches — so the instruction has to
   * be "keep these in this order", because two rules of equal specificity are decided by
   * which comes last and reordering them changes the page.
   */
  const cssRules = designSection(
    'New CSS rules',
    input.cssRuleCSS,
    input.cssRules,
    "Add these to this project's stylesheet, in this order — they were written to apply in it.",
  );
  if (cssRules) sections.push(cssRules);

  if (blocks.length) sections.push(blockSection(blocks));

  const components = componentSection(input);
  if (components) sections.push(components);

  sections.push(checklist(records));
  return sections.join('\n\n');
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
 * `group` is the record's own identity for what it is about; `target` is the fallback
 * for records minted by paths that have no element. Chronological order within a group
 * is what makes the steps replayable — a move after a duplicate has to be read second
 * or it moves the wrong node.
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

  // File and line order, so the agent walks each file once. Groups with no location come
  // last; among equals, the order they were edited in.
  return [...byKey.values()]
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const fileA = a.group.source?.file ?? '\uffff';
      const fileB = b.group.source?.file ?? '\uffff';
      if (fileA !== fileB) return fileA.localeCompare(fileB);
      const lineA = a.group.source?.line ?? 0;
      const lineB = b.group.source?.line ?? 0;
      if (lineA !== lineB) return lineA - lineB;
      return a.index - b.index;
    })
    .map((entry) => entry.group);
}

/* -------------------------------------------------------------------------- */
/* Header and rules                                                            */
/* -------------------------------------------------------------------------- */

function header(input: PromptInput, groups: EditGroup[]): string {
  const count = input.records.length;
  const files = [
    ...new Set(
      groups.flatMap((group) => {
        const file = group.source?.file ?? group.records[0].detail?.file;
        return file ? [file] : [];
      }),
    ),
  ];

  // Named when the list is short enough to be useful. Past that it is a wall of paths
  // between the reader and the instructions, and every entry names its own file anyway.
  const where =
    files.length === 0
      ? `the source of ${code(fileNameOf(input.pageURL))}`
      : files.length <= 3
        ? `the source of ${files.map(code).join(', ')}`
        : 'the source files listed below';

  return `**Apply these ${count} edit${count === 1 ? '' : 's'} to ${where}. No other changes.**`;
}

function rules(groups: EditGroup[]): string {
  const items = [
    'Edit only existing files.',
    'Copy values exactly (e.g. `var(--name)` stays as-is).',
    "Use the project's existing styling patterns.",
    'Change only what the Edits section lists.',
  ];

  // Both notes can apply at once, on a page that is only partly instrumented.
  if (groups.some((group) => !group.source)) {
    items.push('Selectors describe rendered output; edit the source that produces it.');
  }
  if (groups.some((group) => group.source)) {
    items.push('Locations are from this session; confirm each by tag name and attributes.');
  }

  return `**Rules:**\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/* -------------------------------------------------------------------------- */
/* Edits                                                                       */
/* -------------------------------------------------------------------------- */

function editSection(groups: EditGroup[], blocks: Block[]): string {
  const lines = ['**Edits:**', ''];

  groups.forEach((group, index) => {
    const steps = group.records.flatMap((record) => stepsFor(record, blocks));
    const head = `${index + 1}. ${groupTitle(group)}`;

    if (steps.length === 1) {
      lines.push(`${head}: ${steps[0]}`);
      return;
    }
    // Several operations on one target. Nested so the order is unmissable — applied out
    // of order, a move after a duplicate moves the wrong node.
    lines.push(`${head}:`);
    for (const step of steps) lines.push(`    - ${step}`);
  });

  return lines.join('\n');
}

/**
 * What to look for, first thing on the line.
 *
 * The last record's target rather than the first: after a duplicate the group is about
 * the copy, and the copy's selector is the one recorded last. The step that created it
 * names the original, so nothing is lost.
 */
function groupTitle(group: EditGroup): string {
  const first = group.records[0];
  const last = group.records[group.records.length - 1];
  const detail = first.detail ?? {};

  switch (detail.scope) {
    case 'stylesheet':
    case 'external script':
    case 'inline script':
      return code(detail.file ?? first.target);
    case 'stylesheet rule':
      return detail.file
        ? `${code(detail.selector ?? first.target)} in ${code(detail.file)}`
        : `${code(detail.selector ?? first.target)} rule`;
    case 'document head':
      return 'document `<head>`';
    default:
      break;
  }
  if (first.kind === 'token' || first.kind === 'token-class' || first.kind === 'token-rule') {
    return 'design system';
  }
  // Its own heading rather than "design system", because the answer to a block change is a
  // component in the codebase, not a line of CSS — a reader sent to the design system section
  // would find nothing there that explains it.
  if (first.kind === 'block') return 'block library';

  const at = group.source ? ` (${group.source.file}:${group.source.line})` : '';
  return `${code(last.target)}${at}`;
}

/* -------------------------------------------------------------------------- */
/* One record as one instruction                                               */
/* -------------------------------------------------------------------------- */

/**
 * A record as one or more imperatives, each naming only the result.
 *
 * No step says what the value used to be. That was two facts where one would do, and the
 * old value is the one the reader can already see in the file they have open.
 */
function stepsFor(record: ChangeRecord, blocks: Block[]): string[] {
  const detail = record.detail ?? {};
  const scope = detail.scope;

  if (scope === 'stylesheet' && detail.css) return stylesheetSteps(record, detail, blocks);

  if ((scope === 'external script' || scope === 'inline script') && detail.script) {
    const ref = block(blocks, 'js', detail.file ?? record.target, detail.script);
    return [
      scope === 'external script'
        ? `Replace the file with ${ref}. It was never executed, so it is unverified.`
        : `Replace the script with ${ref}.`,
    ];
  }

  switch (record.kind) {
    case 'style':
      return [styleStep(record, detail)];

    case 'text': {
      const text = record.after ?? '';
      return [text.trim() ? `Set text to ${valueOf(text, blocks, record)}.` : 'Remove all text.'];
    }

    case 'class':
      return [
        record.after
          ? `Set \`class\` to ${code(record.after)}.`
          : 'Remove the `class` attribute.',
      ];

    case 'attribute': {
      if (scope === 'document head') {
        const tag = detail.tag ?? record.target;
        return [
          record.after
            ? `Set ${code(tag)} to ${valueOf(record.after, blocks, record)}.`
            : `Remove ${code(tag)}.`,
        ];
      }
      const name = attributeName(record);
      return [
        record.after
          ? `Set ${code(name)} to ${valueOf(record.after, blocks, record)}.`
          : `Remove ${code(name)}.`,
      ];
    }

    case 'insert': {
      const ref = detail.html ? block(blocks, 'html', 'inserted markup', detail.html) : 'new markup';
      // The entry already leads with the element this is positioned against, so the step
      // points back at it rather than naming it twice.
      const where = POSITION_PHRASE[detail.position ?? 'lastChild'] ?? 'inside it';
      return [where === 'REPLACE' ? `Replace it with ${ref}.` : `Insert ${ref} ${where}.`];
    }

    case 'delete':
      return [
        'Delete this element and its contents, plus any styles, assets, handlers or imports nothing else uses.',
      ];

    case 'duplicate':
      return [`Duplicate ${code(record.target)} (no \`id\` on the copy). Later steps apply to the copy.`];

    case 'move':
      return [moveStep(record, detail)];

    case 'wrap': {
      const ref = detail.wrapper
        ? block(blocks, 'html', `wrapper for ${record.target}`, detail.wrapper)
        : 'a new parent';
      return [`Wrap in ${ref}, unchanged inside and in the same position among its siblings.`];
    }

    case 'replace': {
      if (detail.html) {
        return [`Replace with ${block(blocks, 'html', `replaces ${record.target}`, detail.html)}.`];
      }
      // A tag swap: both sides are bare tag names, so they cannot be markup.
      if (record.after && !/[<>\s]/.test(record.after)) {
        return [`Change the tag to \`<${record.after}>\`, keeping every attribute and child.`];
      }
      return [
        record.after
          ? `Replace markup with ${valueOf(record.after, blocks, record)}.`
          : `${sentence(record.summary)}.`,
      ];
    }

    case 'token':
      return [`Set \`--${detail.name ?? record.target}\` to ${code(record.after ?? '')}.`];

    case 'token-class':
      return [`${sentence(record.summary)}. See New classes.`];

    /*
     * A rule is named by its selector, in code, because that is the thing to go and find.
     *
     * The summary already reads as a sentence — "Set color to #333 on h2 > p" — so the
     * only thing worth adding is where it lives, and pointing at the design system CSS is
     * what stops an agent hunting for an element to put an inline style on.
     */
    case 'token-rule':
      return [
        `${sentence(record.summary)}. This is a CSS rule for ${code(detail.selector ?? record.target)}; see New CSS rules.`,
      ];

    /*
     * A block is a component, and saying so is the whole value of the step.
     *
     * The markup is in `detail.html` rather than in the sentence: it is a template with
     * `{{prop}}` placeholders, which is exactly the shape a component's parameters take, and
     * an agent reading "a reusable block called Card" without seeing it has nothing to build.
     */
    case 'block': {
      const template = detail.html
        ? block(blocks, 'html', `${detail.block ?? record.target} template`, detail.html)
        : null;
      const props = detail.props ? `, taking ${detail.props}` : '';
      return [
        `${sentence(record.summary)}${props}.`,
        ...(template
          ? [
            `Its markup is ${template}. In a codebase this belongs as a component rather than as repeated markup; the ${code('{{name}}')} placeholders are its parameters.`,
          ]
          : []),
      ];
    }

    default:
      return [`${sentence(record.summary)}.`];
  }
}

function styleStep(record: ChangeRecord, detail: Record<string, string>): string {
  const property = detail.property;
  if (!property) {
    // A multi-property edit, from the box editor. `after` is the declaration list.
    return record.after ? `Set ${code(record.after)}.` : `${sentence(record.summary)}.`;
  }
  const value = detail.value || record.after || '';
  const bang = detail.priority === 'important' ? ' !important' : '';
  return value ? `Set ${code(property)} to ${code(value + bang)}.` : `Remove ${code(property)}.`;
}

/**
 * A stylesheet edited as text, described as the declarations that changed.
 *
 * The CSS panel hands over a whole buffer, which is the right thing to write to a file
 * and the wrong thing to describe: "replace the entire contents of theme.css" says
 * nothing and cannot be checked. The whole file is still the fallback for a rewrite too
 * large to read as a list.
 */
function stylesheetSteps(
  record: ChangeRecord,
  detail: Record<string, string>,
  blocks: Block[],
): string[] {
  const changes = record.before === undefined ? [] : diffCSS(record.before, detail.css ?? '');
  if (changes.length && changes.length <= MAX_CSS_STEPS) return changes.map(cssStep);
  const ref = block(blocks, 'css', detail.file ?? record.target, detail.css ?? '');
  return [`Replace the file with ${ref}, keeping its comments and formatting where unchanged.`];
}

function cssStep(change: CssChange): string {
  const where = change.context.length ? ` inside ${code(change.context.join(' '))}` : '';
  const rule = `the ${code(change.selector)} rule${where}`;

  switch (change.kind) {
    case 'set':
      return `Set ${code(change.property)} to ${code(change.to)} in ${rule}.`;
    case 'remove':
      return `Remove ${code(change.property)} from ${rule}.`;
    case 'add-rule':
      return change.declarations.length
        ? `Add ${rule} with ${code(declarationList(change.declarations))}.`
        : `Add ${code(change.selector)}${where}.`;
    case 'remove-rule':
      return `Remove ${rule}.`;
  }
}

function declarationList(declarations: Array<{ property: string; value: string }>): string {
  return declarations.map((entry) => `${entry.property}: ${entry.value}`).join('; ');
}

/**
 * A move, as one position.
 *
 * Indices count element children from zero, and that has to be said rather than implied:
 * the recorded position ignores text nodes, because the reader is looking at source where
 * the whitespace between tags is invisible. The parent is named only when it changed —
 * repeating it for a reorder within one parent is noise.
 */
function moveStep(record: ChangeRecord, detail: Record<string, string>): string {
  const index = detail.newIndex;
  if (index === undefined) return `Move to ${code(record.after ?? 'its new position')}.`;
  const parent = detail.newParent;
  const moved = parent && parent !== detail.previousParent ? ` in ${code(parent)}` : '';
  // "In the markup, not with CSS" used to be appended here. It is in the Check list, and
  // repeating it on every move was the kind of line a reader learns to skip.
  return `Move to position ${index}${moved} (0-based, ignoring whitespace).`;
}

/** The attribute an `attribute` record is about, dug out of its summary. */
function attributeName(record: ChangeRecord): string {
  return record.detail?.name ?? /Set (\S+?)=/.exec(record.summary)?.[1] ?? 'attribute';
}

/**
 * Where an insert goes, phrased against the element the entry already named.
 *
 * `replace` is a sentinel rather than a phrase: "insert X in place of it" is a clumsy way
 * to say "replace it with X", and the reader has to be sure which of the two is meant.
 */
const POSITION_PHRASE: Record<string, string> = {
  before: 'immediately before it',
  after: 'immediately after it',
  firstChild: 'as its first child',
  lastChild: 'as its last child',
  replace: 'REPLACE',
};

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Register a payload and return the reference a step should cite.
 *
 * Identical bodies collapse onto one number, so inserting the same markup twice does not
 * print it twice.
 */
function block(blocks: Block[], language: string, title: string, body: string): string {
  const content = body.replace(/\r\n/g, '\n');
  const existing = blocks.find((item) => item.body === content);
  if (existing) return `Code ${existing.id}`;
  blocks.push({ id: blocks.length + 1, language, title, body: content });
  return `Code ${blocks.length}`;
}

function blockSection(blocks: Block[]): string {
  const lines: string[] = [];
  for (const item of blocks) {
    lines.push(
      `**Code ${item.id}** — ${item.title}`,
      '',
      `\`\`\`${item.language}`,
      item.body,
      '```',
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

/* -------------------------------------------------------------------------- */
/* The design system                                                           */
/* -------------------------------------------------------------------------- */

function designSection(
  label: string,
  css: string,
  entries: Array<{ origin?: string }>,
  note: string,
): string | null {
  // Only what this session authored. Anything read out of the page's own stylesheets is
  // already in a file, and repeating it turns a diff into a copy of the theme.
  const authored = entries.filter((entry) => entry.origin && entry.origin !== 'stylesheet');
  if (!authored.length || !css.trim()) return null;
  return [`**${label}:** ${note}`, '', '```css', css.trim(), '```'].join('\n');
}

function componentSection(input: PromptInput): string | null {
  const injected = input.injectedElements ?? [];
  const used = input.blocks.filter(
    (item) => item.element?.tag && injected.includes(item.element.tag),
  );
  if (!used.length) return null;

  const lines = [
    '**New components:** add each as a real component file and import it where it is used.',
  ];
  for (const item of used) {
    const tag = item.element!.tag;
    lines.push('', `\`<${tag}>\` — ${item.name}`, '', '```js');
    lines.push((item.element!.module ?? item.element!.script ?? '').trim(), '```');
    if (item.css) lines.push('', '```css', item.css.trim(), '```');
  }
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Check                                                                       */
/* -------------------------------------------------------------------------- */

function checklist(records: ChangeRecord[]): string {
  const items = ['All edits applied, no extra changes.', '`var(--token)` values untouched.'];
  if (records.some((record) => record.kind === 'move')) {
    items.push('Moves are in markup, not CSS.');
  }
  if (records.some((record) => record.kind === 'text')) {
    items.push("Text is in the project's copy or i18n catalogue.");
  }
  if (records.some((record) => record.kind === 'delete')) {
    items.push('Nothing still references the deleted elements.');
  }
  items.push('Build, types and lint pass.');

  return `**Check:**\n\n${items.map((item) => `- [ ] ${item}`).join('\n')}`;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A literal as inline code: a selector, a property name, a value, a file name.
 *
 * The fence grows past the longest run of backticks inside, so a value that is itself
 * code — a `calc()` expression, a snippet of markup — cannot break out of it and turn the
 * rest of the line into prose. Never truncates, never collapses whitespace.
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
 * Nothing is elided. An earlier version clipped at 300 characters, which left the agent
 * to invent the rest of a paragraph — and an ellipsis is a legal character in copy, so it
 * could not even be relied on as a marker of "there was more here".
 *
 * Single-line values go inline at any length; an inline span has no length limit. A value
 * holding a line break becomes a numbered block, because a span cannot carry a newline
 * and collapsing the whitespace would change the value being asked for.
 */
function valueOf(raw: string, blocks: Block[], record: ChangeRecord): string {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.includes('\n')) return code(text);
  const markup = /^\s*<[a-zA-Z!/]/.test(text);
  return block(blocks, markup ? 'html' : 'text', `for ${record.target}`, text);
}

/** A summary reused as a sentence: capitalised, with any trailing stop removed. */
function sentence(summary: string): string {
  const text = summary.trim().replace(/[.\s]+$/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The file name from a URL, for a header with nothing better to name. */
function fileNameOf(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}
