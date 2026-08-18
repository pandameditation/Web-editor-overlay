import type { ChangeRecord, DesignClass, DesignToken, LibraryBlock } from './types.js';

/**
 * Turns an editing session into instructions a coding agent can execute.
 *
 * The overlay edits a rendered page, not source files. Rather than guess at a
 * source transformation, it describes exactly what changed and where, then hands
 * that to whoever owns the codebase. Two things make the output actionable:
 * changes are grouped by source file when the page was instrumented, and the
 * design system travels with them so new values land as tokens instead of
 * hard-coded literals.
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
  text: 'Text',
  style: 'Style',
  class: 'Classes',
  attribute: 'Attribute',
  insert: 'Insert',
  delete: 'Delete',
  move: 'Move',
  wrap: 'Wrap',
  duplicate: 'Duplicate',
  replace: 'Markup',
  token: 'Design token',
  'token-class': 'Reusable class',
};

export function buildPrompt(input: PromptInput): string {
  const { records } = input;
  if (!records.length) {
    return 'No changes were made in this editing session.';
  }

  const instrumented = records.filter((record) => record.source);
  const anonymous = records.filter((record) => !record.source);
  const sections: string[] = [];

  sections.push(header(input, instrumented.length, anonymous.length));
  sections.push(groundRules(input, instrumented.length > 0));

  const tokenSection = tokenChanges(input);
  if (tokenSection) sections.push(tokenSection);

  const classSection = classChanges(input);
  if (classSection) sections.push(classSection);

  if (instrumented.length) sections.push(byFile(instrumented));
  if (anonymous.length) sections.push(bySelector(anonymous, instrumented.length > 0));

  const markupSection = newMarkup(records);
  if (markupSection) sections.push(markupSection);

  const componentSection = injectedComponents(input);
  if (componentSection) sections.push(componentSection);

  sections.push(checklist(input));

  return sections.filter(Boolean).join('\n\n');
}

/* -------------------------------------------------------------------------- */

function header(input: PromptInput, located: number, unlocated: number): string {
  const total = input.records.length;
  const counts = summarise(input.records);
  return [
    '# Apply visual edits from an editor-overlay session',
    '',
    `A designer made ${total} change${total === 1 ? '' : 's'} directly in the rendered page at \`${input.pageURL}\`.`,
    'Reproduce those changes in the source code. The page itself was not saved; this document is the source of truth.',
    '',
    `**What changed:** ${counts}`,
    located && unlocated
      ? `**Locations:** ${located} change${located === 1 ? '' : 's'} carry an exact source location; ${unlocated} must be matched by CSS selector.`
      : located
        ? '**Locations:** every change carries an exact source location (file, line, column).'
        : '**Locations:** the page was not instrumented, so changes are identified by CSS selector.',
  ].join('\n');
}

function summarise(records: ChangeRecord[]): string {
  const counts = new Map<ChangeRecord['kind'], number>();
  for (const record of records) counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${KIND_LABEL[kind].toLowerCase()}`)
    .join(', ');
}

function groundRules(input: PromptInput, instrumented: boolean): string {
  const rules = [
    'Keep the existing architecture. Edit the components and stylesheets that already render this markup; do not introduce a new styling approach, CSS framework or component library.',
    'Prefer design tokens over literals. Where a change below uses a `var(--token)` value, keep it as a token reference. Where it uses a raw value that matches an existing token, substitute the token.',
    'Put declarations where the project already puts them. If the element is styled by a class in a stylesheet, update that rule rather than adding an inline `style` attribute.',
    'Do not reformat surrounding code, reorder imports, or make changes beyond the ones listed.',
    'Preserve accessibility attributes and semantics. If a change alters an interactive element, keep its label, role and keyboard behaviour intact.',
  ];
  if (instrumented) {
    rules.push(
      'Line and column numbers refer to the state of the file at the time of the session. Treat them as a starting point and confirm the element identity by tag name and nearby attributes before editing.',
    );
  } else {
    rules.push(
      'Each change gives a CSS selector. Search the codebase for the markup that produces it — including template loops and component props — and edit the source of truth rather than a duplicate.',
    );
  }
  if (input.tokens.length) {
    rules.push(
      'The design tokens listed below are the project vocabulary for this session. Reuse them; only add a new token when no existing one fits.',
    );
  }
  return ['## Ground rules', '', rules.map((rule) => `- ${rule}`).join('\n')].join('\n');
}

function tokenChanges(input: PromptInput): string | null {
  const authored = input.tokens.filter((token) => token.origin && token.origin !== 'stylesheet');
  if (!authored.length && !input.tokenCSS.trim()) return null;

  const lines = ['## Design tokens', ''];
  if (authored.length) {
    lines.push(
      `${authored.length} token${authored.length === 1 ? ' was' : 's were'} added or changed during the session. Add ${authored.length === 1 ? 'it' : 'them'} to wherever the project declares its custom properties (a theme file, \`:root\` block or design-token module) rather than to the page:`,
      '',
      '```css',
      input.tokenCSS.trim() || renderTokenCSS(authored),
      '```',
      '',
    );
    lines.push('| Token | Value | Group | Origin |', '| --- | --- | --- | --- |');
    for (const token of authored) {
      lines.push(
        `| \`--${token.name}\` | \`${token.value}\` | ${token.group} | ${token.origin ?? 'user'} |`,
      );
    }
  }

  const existing = input.tokens.filter((token) => token.origin === 'stylesheet');
  if (existing.length) {
    lines.push(
      '',
      `The project already defines ${existing.length} token${existing.length === 1 ? '' : 's'}. Reuse ${existing.length === 1 ? 'it' : 'these'} instead of inventing new values:`,
      '',
      existing
        .slice(0, 40)
        .map((token) => `- \`--${token.name}\`: \`${token.value}\``)
        .join('\n'),
    );
    if (existing.length > 40) lines.push(`- …and ${existing.length - 40} more.`);
  }
  return lines.join('\n');
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
    `${authored.length} class${authored.length === 1 ? '' : 'es'} ${authored.length === 1 ? 'was' : 'were'} defined during the session, each grouping declarations that were repeated across elements. Add ${authored.length === 1 ? 'it' : 'them'} to the project's stylesheet and apply the class where the changes below say so:`,
    '',
    '```css',
    input.classCSS.trim() ||
      authored
        .map(
          (entry) =>
            `.${entry.name} {\n${Object.entries(entry.declarations)
              .map(([property, value]) => `  ${property}: ${value};`)
              .join('\n')}\n}`,
        )
        .join('\n\n'),
    '```',
  ].join('\n');
}

function byFile(records: ChangeRecord[]): string {
  const files = new Map<string, ChangeRecord[]>();
  for (const record of records) {
    const file = record.source!.file;
    const bucket = files.get(file);
    if (bucket) bucket.push(record);
    else files.set(file, [record]);
  }

  const lines = ['## Changes by source file'];
  for (const [file, entries] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push('', `### \`${file}\``, '');
    entries.sort((a, b) => (a.source!.line - b.source!.line) || (a.source!.column - b.source!.column));
    for (const record of entries) {
      const { line, column } = record.source!;
      lines.push(...describeChange(record, `line ${line}, column ${column}`));
    }
  }
  return lines.join('\n');
}

function bySelector(records: ChangeRecord[], hasInstrumented: boolean): string {
  const lines = [
    hasInstrumented ? '## Changes without a source location' : '## Changes',
    '',
  ];
  if (hasInstrumented) {
    lines.push(
      'These elements had no source marker, most likely because they were created during the session or rendered at runtime. Locate them by selector.',
      '',
    );
  }
  const groups = new Map<string, ChangeRecord[]>();
  for (const record of records) {
    const bucket = groups.get(record.target);
    if (bucket) bucket.push(record);
    else groups.set(record.target, [record]);
  }
  for (const [target, entries] of groups) {
    lines.push(`### \`${target}\``, '');
    for (const record of entries) lines.push(...describeChange(record, null));
  }
  return lines.join('\n');
}

/** One change as a numbered instruction with before/after detail. */
function describeChange(record: ChangeRecord, location: string | null): string[] {
  const lines: string[] = [];
  const where = location ? ` _(${location})_` : '';
  lines.push(`- **${KIND_LABEL[record.kind]}** — ${record.summary}${where}`);
  lines.push(`  - Element: \`${record.target}\``);

  if (record.kind === 'style' && record.detail?.property) {
    lines.push(
      `  - Declaration: \`${record.detail.property}: ${record.detail.value || 'unset'};\``,
      record.detail.value?.includes('var(--')
        ? '  - Keep the token reference exactly as written.'
        : '  - If a token already carries this value, use the token instead.',
    );
  }
  if (record.before != null && record.before !== '') lines.push(`  - Before: \`${clip(record.before)}\``);
  if (record.after != null && record.after !== '') lines.push(`  - After: \`${clip(record.after)}\``);

  if (record.detail) {
    for (const [key, value] of Object.entries(record.detail)) {
      if (key === 'property' || key === 'value' || key === 'html' || key === 'wrapper') continue;
      lines.push(`  - ${prettifyKey(key)}: \`${clip(String(value))}\``);
    }
  }
  lines.push('');
  return lines;
}

function newMarkup(records: ChangeRecord[]): string | null {
  const withMarkup = records.filter(
    (record) => record.detail?.html || record.detail?.wrapper,
  );
  if (!withMarkup.length) return null;

  const lines = [
    '## Markup to add',
    '',
    'The overlay generated the following markup. Adapt it to the project\'s component conventions — extract repeated structure into a component, and move inline styles into the stylesheet or token system where the project would normally put them.',
  ];
  for (const record of withMarkup) {
    lines.push('', `### ${record.summary}`, '', `Target: \`${record.target}\``, '', '```html', (record.detail!.html ?? record.detail!.wrapper ?? '').trim(), '```');
  }
  return lines.join('\n');
}

function injectedComponents(input: PromptInput): string | null {
  const blocks = input.blocks.filter((block) => block.element?.tag);
  const injected = input.injectedElements ?? [];
  const used = blocks.filter((block) => injected.includes(block.element!.tag));
  if (!used.length) return null;

  const lines = [
    '## Web components used',
    '',
    'These custom elements were inserted into the page. Add each one to the codebase as a real component file and import it where the markup above is rendered.',
  ];
  for (const block of used) {
    lines.push(
      '',
      `### \`<${block.element!.tag}>\` — ${block.name}`,
      '',
      block.description ?? '',
      '',
      '```js',
      (block.element!.module ?? block.element!.script ?? '').trim(),
      '```',
    );
    if (block.css) lines.push('', '```css', block.css.trim(), '```');
  }
  return lines.join('\n');
}

function checklist(input: PromptInput): string {
  const items = [
    'Every change above is reflected in source, and none of them remain as one-off inline styles unless the project already styles that element inline.',
    'New values reuse existing design tokens where one matched; genuinely new values were added as tokens.',
    'The page renders identically to the description above at desktop and mobile widths.',
    'No unrelated files changed, and the build, type check and linter all pass.',
  ];
  if (input.records.some((record) => record.kind === 'delete')) {
    items.push('Deleted elements are gone from the source, along with any now-unused styles, assets or handlers they owned.');
  }
  if (input.records.some((record) => record.kind === 'move')) {
    items.push('Reordered elements keep their DOM order in source rather than being repositioned with CSS `order` or `flex-direction`.');
  }
  if (input.records.some((record) => record.kind === 'text')) {
    items.push('Text changes went into the same place the project stores copy, including any i18n catalogue.');
  }
  return ['## Before you finish', '', items.map((item) => `- [ ] ${item}`).join('\n')].join('\n');
}

function clip(value: string, max = 240): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function prettifyKey(key: string): string {
  const text = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
