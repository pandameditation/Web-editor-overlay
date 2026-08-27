/**
 * Surgical edits to CSS *text*.
 *
 * The editor changes CSS through the CSSOM, because that is the only thing a page
 * can do: mutate `rule.style` and every element matching the rule updates on the
 * next frame. But the CSSOM is not the file. Reading a sheet back out of it —
 * `Array.from(sheet.cssRules).map((rule) => rule.cssText)` — returns the browser's
 * own re-serialization, which is a different document than the one on disk. A file
 * that reads
 *
 *     .card {
 *       padding: 16px;
 *       background: #fff;
 *     }
 *
 * comes back as `.card { padding: 16px; background: rgb(255, 255, 255); }`. Every
 * comment is gone, `#fff` has become `rgb(255, 255, 255)`, `margin: 0` has become
 * `margin: 0px`, and the author's line breaks have collapsed. Handing that back as
 * "the new contents of your stylesheet" reformats a file nobody asked to reformat,
 * and buries the one line that actually changed in a whole-file diff.
 *
 * So changes are replayed against the original text instead. A patch names a rule
 * and a property, and only that declaration's value is rewritten; every byte
 * outside it is left exactly as it was found. A one-line edit produces a one-line
 * diff.
 *
 * **Locating the rule.** By position first, by selector second. Position is exact:
 * the browser and this scanner walk the same file in the same order, so "the second
 * rule inside the fourth" identifies a rule without either side having to agree on
 * how a selector is spelled. Selector matching is the fallback, for when the file
 * has been edited since the session started and the indices no longer line up. Each
 * covers the other's failure mode, and a patch that satisfies neither is reported
 * rather than guessed at.
 *
 * **Scanning, not parsing.** Only two questions need answering — where does this
 * rule's body start and end, and where is this declaration's value inside it — and
 * both only require knowing what *cannot* be structure: comments, strings, and
 * anything inside parentheses. `content: "}"`, `background: url(a{b.png)` and
 * `/* } *\/` all defeat a naive brace count, and all three appear in real
 * stylesheets.
 */

/** One declaration to write, located by the rule that holds it. */
export interface DeclarationPatch {
  /**
   * Index chain from the sheet root: `[3]` is the fourth rule, `[3, 1]` the second
   * rule inside it.
   *
   * The precise locator, and the reason this module does not have to win an argument
   * about selector spelling. Verified against `selector` before it is trusted.
   */
  path?: number[];
  /** Selector of the rule, as the CSSOM reports it. Verifies `path`, and locates without it. */
  selector: string;
  /**
   * Enclosing at-rule preludes, outermost first: `['@media (min-width: 40em)']`.
   *
   * Used by the selector fallback. A selector is not unique on its own — `.card`
   * commonly appears once at the top level and again inside a media query, and
   * patching the wrong one is a change that only shows up at one viewport width.
   */
  context?: string[];
  /** Which rule with this selector, when a file has several. 0-based. */
  occurrence?: number;
  property: string;
  /** The new value. Empty removes the declaration. */
  value: string;
  /** `'important'` to write `!important`, anything else to drop it. */
  priority?: string;
}

export interface PatchFailure {
  patch: DeclarationPatch;
  reason: string;
}

export interface PatchResult {
  css: string;
  /** How many patches changed the text. A patch the file already satisfied counts here. */
  applied: number;
  failed: PatchFailure[];
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Apply declaration patches to a stylesheet's text.
 *
 * Patches are applied one at a time, re-scanning between each. Batching them by
 * descending offset — the trick that keeps `instrument.ts` honest — does not work
 * here, because inserting a declaration changes the shape of the block the next
 * patch is measured against, and two patches to one rule are the common case rather
 * than the exception. Stylesheets are small and a session produces tens of patches,
 * so re-scanning is not worth optimising away.
 */
export function patchCSS(source: string, patches: DeclarationPatch[]): PatchResult {
  let css = source;
  let applied = 0;
  const failed: PatchFailure[] = [];

  for (const patch of patches) {
    const result = applyPatch(css, patch);
    if (result.reason) {
      failed.push({ patch, reason: result.reason });
      continue;
    }
    applied += 1;
    css = result.css;
  }

  return { css, applied, failed };
}

/**
 * Marker comments around CSS the editor owns inside a file it does not.
 *
 * New tokens and reusable classes have to go somewhere on the way to disk, and a
 * page that keeps its CSS in files does not want them in a `<style>` block in its
 * markup. Writing them into a real stylesheet needs a way to find them again on the
 * next save, or every session appends another copy of the same block.
 */
export const SECTION_START = '/* heo:design-system start — managed by html-editor-overlay */';
export const SECTION_END = '/* heo:design-system end */';

/**
 * Add, replace or remove the editor's managed section in a stylesheet.
 *
 * Idempotent by construction: the section is found by its markers and replaced
 * wholesale, so saving twice produces the same file rather than two blocks. Empty
 * CSS removes the section and closes the gap it leaves, which is what makes "undo
 * everything, then save" put the file back the way it started.
 */
export function upsertSection(source: string, css: string): string {
  const start = source.indexOf(SECTION_START);
  const end = source.indexOf(SECTION_END);
  const body = css.trim();
  const block = body ? `${SECTION_START}\n${body}\n${SECTION_END}` : '';

  if (start !== -1 && end > start) {
    const before = source.slice(0, start);
    const after = source.slice(end + SECTION_END.length);
    if (!block) {
      return `${before.replace(/\s*$/, '')}\n${after.replace(/^\s*\n/, '')}`.replace(
        /\n{3,}/g,
        '\n\n',
      );
    }
    return `${before}${block}${after}`;
  }

  if (!block) return source;
  const trimmed = source.replace(/\s*$/, '');
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

/** True when the section markers are already in the text. */
export function hasSection(source: string): boolean {
  return source.includes(SECTION_START);
}

/* -------------------------------------------------------------------------- */
/* Diffing two stylesheets                                                     */
/* -------------------------------------------------------------------------- */

/** One declaration, as written. */
export interface CssDeclaration {
  property: string;
  value: string;
}

/** What changed between two versions of a stylesheet. */
export type CssChange =
  | {
    kind: 'set';
    selector: string;
    context: string[];
    property: string;
    /** Absent when the declaration is new to the rule. */
    from?: string;
    to: string;
  }
  | { kind: 'remove'; selector: string; context: string[]; property: string; from: string }
  | { kind: 'add-rule'; selector: string; context: string[]; declarations: CssDeclaration[] }
  | { kind: 'remove-rule'; selector: string; context: string[]; declarations: CssDeclaration[] };

/**
 * What actually changed between two stylesheets, declaration by declaration.
 *
 * The CSS panel hands over a whole buffer, because that is what the user edited. That
 * makes it the right thing to *write* — it is literally the file they typed — and the
 * wrong thing to *describe*. "Replace the entire contents of theme.css" tells a reader
 * nothing about what changed and gives an agent no way to check its work, while the
 * truth is usually one declaration.
 *
 * So the two texts are compared structurally rather than as lines. Reformatting,
 * reordering declarations within a rule, and rewriting comments all produce no changes
 * here, which is the point: none of them change what the stylesheet does.
 *
 * Rules are matched by selector within their at-rule context, and by occurrence when a
 * selector appears more than once — the same locator the patcher uses, for the same
 * reason. A restructuring too large to express this way is better handed over as a
 * whole file, so the caller is left to decide that by looking at how much came back.
 */
export function diffCSS(before: string, after: string): CssChange[] {
  const old = flatten(before);
  const next = flatten(after);
  const changes: CssChange[] = [];

  for (const rule of [...next.values()].sort((a, b) => a.order - b.order)) {
    const previous = old.get(rule.key);

    if (!previous) {
      changes.push({
        kind: 'add-rule',
        selector: rule.selector,
        context: rule.context,
        declarations: [...rule.declarations.values()],
      });
      continue;
    }

    for (const [key, entry] of rule.declarations) {
      const was = previous.declarations.get(key);
      if (was && was.value === entry.value) continue;
      changes.push({
        kind: 'set',
        selector: rule.selector,
        context: rule.context,
        property: entry.property,
        ...(was ? { from: was.value } : {}),
        to: entry.value,
      });
    }

    for (const [key, entry] of previous.declarations) {
      if (rule.declarations.has(key)) continue;
      changes.push({
        kind: 'remove',
        selector: rule.selector,
        context: rule.context,
        property: entry.property,
        from: entry.value,
      });
    }
  }

  // Whole-rule deletions last: read as a list of things to take out, after everything
  // that is being changed or added.
  for (const rule of [...old.values()].sort((a, b) => a.order - b.order)) {
    if (next.has(rule.key)) continue;
    changes.push({
      kind: 'remove-rule',
      selector: rule.selector,
      context: rule.context,
      declarations: [...rule.declarations.values()],
    });
  }

  return changes;
}

interface FlatRule {
  key: string;
  selector: string;
  context: string[];
  /** Keyed the way `sameProperty` compares, valued as written. */
  declarations: Map<string, CssDeclaration>;
  order: number;
}

/**
 * Every rule in a stylesheet, flattened to a lookup.
 *
 * At-rule blocks become context on their children rather than entries of their own, so
 * adding a whole `@media` block reads as adding the rules inside it — which is what a
 * reader has to act on. Statement at-rules like `@import` have no children to carry
 * them, so they are recorded as rules with no declarations.
 */
function flatten(source: string): Map<string, FlatRule> {
  const rules = new Map<string, FlatRule>();
  const occurrences = new Map<string, number>();
  let order = 0;

  const record = (
    selector: string,
    context: string[],
    declarations: Map<string, CssDeclaration>,
  ): void => {
    const base = `${context.join(' > ')}||${selector}`;
    const seen = occurrences.get(base) ?? 0;
    occurrences.set(base, seen + 1);
    order += 1;
    const key = `${base}#${seen}`;
    rules.set(key, { key, selector, context, declarations, order });
  };

  const walk = (blocks: Block[], context: string[]): void => {
    for (const block of blocks) {
      if (block.atRule) {
        if (block.bodyStart === -1) record(block.prelude, context, new Map());
        else walk(block.children, [...context, block.prelude]);
        continue;
      }
      const declarations = new Map<string, CssDeclaration>();
      for (const entry of parseDeclarations(source, block.bodyStart, block.bodyEnd)) {
        declarations.set(propertyKey(entry.property), {
          property: entry.property,
          // Through `priorityEnd`, so `!important` is part of the value here: adding or
          // dropping it changes what the rule does and has to show up as a change.
          value: source.slice(entry.valueStart, entry.priorityEnd).trim(),
        });
      }
      record(block.prelude, context, declarations);
      // A nested rule is a rule, with its parent's selector as context.
      walk(block.children, [...context, block.prelude]);
    }
  };

  walk(scanBlocks(source, 0, source.length), []);
  return rules;
}

function propertyKey(property: string): string {
  return property.startsWith('--') ? property : property.toLowerCase();
}

/**
 * A selector in the shape the CSSOM would report it.
 *
 * Needed because the two sides of a match are written by different authors: the
 * patch carries `rule.selectorText` (`.a > .b, .c`) and the file carries whatever
 * was typed (`.a>.b,\n.c`). Normalising both makes them comparable without teaching
 * the scanner what a selector means.
 *
 * Combinators are only spaced at the top level. A `+` inside `:nth-child(2n+1)` is
 * arithmetic, not a sibling combinator, and spacing it would change what it matches.
 */
export function normalizeSelector(selector: string): string {
  const text = selector.trim();
  let out = '';
  let depth = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"' || ch === "'") {
      const end = skipString(text, i, text.length);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth += 1;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth -= 1;
      out += ch;
      i += 1;
      continue;
    }
    if (isSpace(ch)) {
      while (i < text.length && isSpace(text[i])) i += 1;
      // A combinator on the other side supplies its own spacing; a descendant
      // relationship is the space itself and has to survive.
      if (i < text.length && !(depth === 0 && isCombinator(text[i]))) out += ' ';
      continue;
    }
    if (depth === 0 && (ch === ',' || isCombinator(ch))) {
      out = out.replace(/\s$/, '');
      out += ch === ',' ? ', ' : ` ${ch} `;
      i += 1;
      while (i < text.length && isSpace(text[i])) i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }

  return out.trim();
}

/* -------------------------------------------------------------------------- */
/* Applying one patch                                                          */
/* -------------------------------------------------------------------------- */

function applyPatch(source: string, patch: DeclarationPatch): { css: string; reason?: string } {
  const blocks = scanBlocks(source, 0, source.length);
  const rule = locate(blocks, patch);

  if (!rule) {
    // Nothing to remove is not a failure: the file already reads the way the patch
    // wants it to.
    if (!patch.value.trim()) return { css: source };
    return appendRule(source, blocks, patch);
  }

  const declarations = parseDeclarations(source, rule.bodyStart, rule.bodyEnd);
  const existing = declarations.find((entry) => sameProperty(entry.property, patch.property));

  if (!patch.value.trim()) {
    if (!existing) return { css: source };
    return { css: removeDeclaration(source, existing) };
  }

  const text = withPriority(patch);

  if (existing) {
    return {
      css: source.slice(0, existing.valueStart) + text + source.slice(existing.priorityEnd),
    };
  }
  return { css: insertDeclaration(source, rule, declarations, patch.property, text) };
}

function withPriority(patch: DeclarationPatch): string {
  const value = patch.value.trim();
  return patch.priority === 'important' ? `${value} !important` : value;
}

/**
 * Add a rule the file does not have yet.
 *
 * Appended at the end of its context rather than merged into a neighbour: position
 * in a stylesheet is meaning, and the editor cannot know whether a rule belongs
 * beside another one. Guessing is how a cascade gets quietly reordered.
 */
function appendRule(
  source: string,
  blocks: Block[],
  patch: DeclarationPatch,
): { css: string; reason?: string } {
  const selector = normalizeSelector(patch.selector);
  const value = withPriority(patch);

  if (patch.context?.length) {
    const wrapper = findContext(blocks, patch.context);
    if (!wrapper) {
      return {
        css: source,
        reason: `there is no ${patch.context.join(' → ')} block to add ${selector} to`,
      };
    }
    const indent = indentOf(source, wrapper.preludeStart);
    const inner = `${indent}  `;
    const rule = `\n${inner}${selector} {\n${inner}  ${patch.property}: ${value};\n${inner}}\n${indent}`;
    const at = trimBack(source, wrapper.bodyStart, wrapper.bodyEnd);
    return { css: source.slice(0, at) + rule + source.slice(wrapper.bodyEnd) };
  }

  const trimmed = source.replace(/\s*$/, '');
  const rule = `${selector} {\n  ${patch.property}: ${value};\n}\n`;
  return { css: trimmed ? `${trimmed}\n\n${rule}` : rule };
}

/**
 * Insert a declaration into a rule that does not have it.
 *
 * Indentation is copied from a declaration already in the block rather than
 * assumed, so a file written with tabs or four spaces stays that way.
 */
function insertDeclaration(
  source: string,
  rule: Block,
  declarations: Declaration[],
  property: string,
  value: string,
): string {
  const last = declarations[declarations.length - 1];

  if (last) {
    const indent = indentOf(source, last.start);
    // A block whose final declaration has no semicolon needs one before anything
    // can follow it.
    const separator = last.terminated ? '' : ';';
    return (
      source.slice(0, last.end) +
      `${separator}\n${indent}${property}: ${value};` +
      source.slice(last.end)
    );
  }

  const closingIndent = indentOf(source, rule.preludeStart);
  const body = `\n${closingIndent}  ${property}: ${value};\n${closingIndent}`;
  return source.slice(0, rule.bodyStart) + body + source.slice(rule.bodyEnd);
}

/**
 * Take a declaration out, along with the line it was sitting on.
 *
 * Removing only the text leaves an orphaned line holding nothing but indentation,
 * which reads as an accident in a diff. A declaration sharing a line with others
 * keeps the line.
 */
function removeDeclaration(source: string, declaration: Declaration): string {
  const lineStart = source.lastIndexOf('\n', declaration.start) + 1;
  const alone = source.slice(lineStart, declaration.start).trim() === '';

  if (!alone) {
    return (
      source.slice(0, declaration.start) + source.slice(declaration.end).replace(/^[ \t]+/, '')
    );
  }

  let end = declaration.end;
  // A trailing comment on the same line described this declaration, so it goes too.
  const trailing = /^[ \t]*\/\*(?:(?!\*\/)[^\n])*\*\//.exec(source.slice(end));
  if (trailing) end += trailing[0].length;
  while (end < source.length && (source[end] === ' ' || source[end] === '\t')) end += 1;
  if (source[end] === '\r') end += 1;
  if (source[end] === '\n') end += 1;

  return source.slice(0, lineStart) + source.slice(end);
}

/* -------------------------------------------------------------------------- */
/* Locating a rule                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The rule a patch is about: by position when position still agrees, by selector
 * when it does not.
 *
 * The index chain is checked first and only trusted when the selector at that
 * position is the expected one. That verification is the whole value of carrying
 * both: an index alone silently patches the wrong rule when the file has moved on,
 * and a selector alone cannot tell two identical selectors apart.
 */
function locate(blocks: Block[], patch: DeclarationPatch): Block | null {
  const wanted = normalizeSelector(patch.selector);

  if (patch.path?.length) {
    const byPath = atPath(blocks, patch.path);
    if (byPath && !byPath.atRule && byPath.bodyStart !== -1 && byPath.prelude === wanted) {
      return byPath;
    }
  }

  const scope = patch.context?.length ? findContext(blocks, patch.context) : null;
  if (patch.context?.length && !scope) return null;
  const candidates = scope ? scope.children : blocks;

  const matches = candidates.filter(
    (block) => !block.atRule && block.bodyStart !== -1 && block.prelude === wanted,
  );
  if (!matches.length) return null;
  // Fewer matches than the recorded ordinal means the file has changed. The first
  // match is still the best available answer.
  return matches[patch.occurrence ?? 0] ?? matches[0];
}

function atPath(blocks: Block[], path: number[]): Block | null {
  let level = blocks;
  let found: Block | null = null;
  for (const index of path) {
    const next = level[index];
    if (!next) return null;
    found = next;
    level = next.children;
  }
  return found;
}

/**
 * Walk down a chain of at-rule preludes, e.g. `@media …` then `@supports …`.
 *
 * Matched with whitespace removed as well as collapsed. Unlike a selector, where a
 * space is the descendant combinator and cannot be discarded, nothing in an at-rule
 * prelude depends on spacing — so `@media(min-width:40em)` in the file and
 * `@media (min-width: 40em)` from the CSSOM are the same condition, and refusing to
 * match them would only mean failing to find a block that is right there.
 */
function findContext(blocks: Block[], context: string[]): Block | null {
  let level = blocks;
  let found: Block | null = null;
  for (const prelude of context) {
    const wanted = normalizePrelude(prelude);
    const loose = squeeze(wanted);
    const match =
      level.find((block) => block.atRule && block.prelude === wanted) ??
      level.find((block) => block.atRule && squeeze(block.prelude) === loose);
    if (!match) return null;
    found = match;
    level = match.children;
  }
  return found;
}

function squeeze(text: string): string {
  return text.replace(/\s+/g, '');
}

/* -------------------------------------------------------------------------- */
/* Scanning                                                                    */
/* -------------------------------------------------------------------------- */

interface Block {
  /** Normalized selector, or at-rule prelude including the `@name`. */
  prelude: string;
  atRule: boolean;
  /** Offset of the first character of the prelude. */
  preludeStart: number;
  /** Offset just after the opening brace, or -1 for a statement at-rule. */
  bodyStart: number;
  /** Offset of the matching closing brace, or -1 for a statement at-rule. */
  bodyEnd: number;
  children: Block[];
}

/**
 * Every rule at this level, in document order.
 *
 * Statement at-rules — `@import`, `@charset`, `@namespace` — are recorded even
 * though they have no body, because they are rules in `sheet.cssRules` too. Leaving
 * them out would shift every index after them and quietly break the position
 * locator on any file that starts with an `@import`.
 */
function scanBlocks(source: string, from: number, to: number): Block[] {
  const blocks: Block[] = [];
  let i = from;
  let preludeStart = -1;

  while (i < to) {
    const ch = source[i];

    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 || end >= to ? to : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(source, i, to);
      continue;
    }
    if (ch === '(') {
      i = skipParens(source, i, to);
      continue;
    }
    if (ch === '{') {
      const start = preludeStart === -1 ? i : preludeStart;
      const raw = source.slice(start, i);
      const bodyEnd = matchBrace(source, i, to);
      const atRule = raw.trimStart().startsWith('@');
      blocks.push({
        prelude: atRule ? normalizePrelude(raw) : normalizeSelector(raw),
        atRule,
        preludeStart: start,
        bodyStart: i + 1,
        bodyEnd,
        children: scanBlocks(source, i + 1, bodyEnd),
      });
      i = bodyEnd + 1;
      preludeStart = -1;
      continue;
    }
    if (ch === ';') {
      // `@import url(…);` is a rule with no block. A declaration is not, but
      // declarations do not appear at a level where rules are being counted.
      if (preludeStart !== -1 && source[preludeStart] === '@') {
        blocks.push({
          prelude: normalizePrelude(source.slice(preludeStart, i)),
          atRule: true,
          preludeStart,
          bodyStart: -1,
          bodyEnd: -1,
          children: [],
        });
      }
      i += 1;
      preludeStart = -1;
      continue;
    }
    if (ch === '}') {
      i += 1;
      preludeStart = -1;
      continue;
    }
    if (!isSpace(ch) && preludeStart === -1) preludeStart = i;
    i += 1;
  }

  return blocks;
}

interface Declaration {
  property: string;
  /** Offset of the first character of the property name. */
  start: number;
  /** Offset of the first character of the value. */
  valueStart: number;
  /** Offset just past the value, before any `!important`. */
  valueEnd: number;
  /** Offset just past `!important` when present, else equal to `valueEnd`. */
  priorityEnd: number;
  /** Offset just past the declaration, including its semicolon when it has one. */
  end: number;
  terminated: boolean;
}

/**
 * The declarations directly inside a rule body.
 *
 * Nested rules are stepped over rather than descended into: with CSS nesting a body
 * holds both declarations and rules, and `&:hover` looks exactly like the start of a
 * declaration until the `{` arrives.
 */
function parseDeclarations(source: string, bodyStart: number, bodyEnd: number): Declaration[] {
  const out: Declaration[] = [];
  let i = bodyStart;
  let start = -1;
  let colon = -1;

  while (i < bodyEnd) {
    const ch = source[i];

    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 || end >= bodyEnd ? bodyEnd : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(source, i, bodyEnd);
      continue;
    }
    if (ch === '(') {
      i = skipParens(source, i, bodyEnd);
      continue;
    }
    if (ch === '{') {
      // A nested rule. What looked like a property name was its selector.
      i = matchBrace(source, i, bodyEnd) + 1;
      start = -1;
      colon = -1;
      continue;
    }
    if (ch === ':' && colon === -1 && start !== -1) {
      colon = i;
      i += 1;
      continue;
    }
    if (ch === ';') {
      if (start !== -1 && colon !== -1) out.push(declaration(source, start, colon, i, i + 1, true));
      start = -1;
      colon = -1;
      i += 1;
      continue;
    }
    if (!isSpace(ch) && start === -1) start = i;
    i += 1;
  }

  // A final declaration with no semicolon is legal, and common in hand-written CSS.
  if (start !== -1 && colon !== -1) {
    out.push(declaration(source, start, colon, bodyEnd, bodyEnd, false));
  }
  return out;
}

function declaration(
  source: string,
  start: number,
  colon: number,
  valueLimit: number,
  end: number,
  terminated: boolean,
): Declaration {
  const raw = source.slice(colon + 1, valueLimit);
  const leading = raw.length - raw.trimStart().length;
  const valueStart = colon + 1 + leading;
  const priorityEnd = trimBack(source, valueStart, valueLimit);

  // `!important` is priority, not value. Kept out of the value span so replacing a
  // value cannot accidentally drop or duplicate it.
  let valueEnd = priorityEnd;
  const bang = /!\s*important\s*$/i.exec(source.slice(valueStart, priorityEnd));
  if (bang) valueEnd = trimBack(source, valueStart, valueStart + bang.index);

  return {
    property: source.slice(start, colon).trim(),
    start,
    valueStart,
    valueEnd,
    priorityEnd,
    // Without a semicolon the declaration ends where its value does, not where the
    // body does. Reaching to the closing brace would swallow the line break before
    // it, and anything inserted afterwards would land on the `}`.
    end: terminated ? end : priorityEnd,
    terminated,
  };
}

/* -------------------------------------------------------------------------- */
/* Scanner primitives                                                          */
/* -------------------------------------------------------------------------- */

function skipString(source: string, i: number, to: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < to) {
    if (source[j] === '\\') {
      j += 2;
      continue;
    }
    if (source[j] === quote) return j + 1;
    j += 1;
  }
  return to;
}

/** Past the matching `)`. Covers `url(a{b.png)` and `:is(a, b)` alike. */
function skipParens(source: string, i: number, to: number): number {
  let depth = 0;
  let j = i;
  while (j < to) {
    const ch = source[j];
    if (ch === '"' || ch === "'") {
      j = skipString(source, j, to);
      continue;
    }
    if (ch === '/' && source[j + 1] === '*') {
      const end = source.indexOf('*/', j + 2);
      j = end === -1 || end >= to ? to : end + 2;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      j += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      j += 1;
      if (depth === 0) return j;
      continue;
    }
    j += 1;
  }
  return to;
}

/** Offset of the `}` matching the `{` at `open`, or `to` when the file is unbalanced. */
function matchBrace(source: string, open: number, to: number): number {
  let depth = 0;
  let j = open;
  while (j < to) {
    const ch = source[j];
    if (ch === '"' || ch === "'") {
      j = skipString(source, j, to);
      continue;
    }
    if (ch === '/' && source[j + 1] === '*') {
      const end = source.indexOf('*/', j + 2);
      j = end === -1 || end >= to ? to : end + 2;
      continue;
    }
    if (ch === '(') {
      j = skipParens(source, j, to);
      continue;
    }
    if (ch === '{') {
      depth += 1;
      j += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      j += 1;
      if (depth === 0) return j - 1;
      continue;
    }
    j += 1;
  }
  return to;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function isCombinator(ch: string): boolean {
  return ch === '>' || ch === '+' || ch === '~';
}

/** Custom properties are case-sensitive; every other property is not. */
function sameProperty(a: string, b: string): boolean {
  if (a.startsWith('--') || b.startsWith('--')) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

function normalizePrelude(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function indentOf(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart, offset))?.[0] ?? '';
}

/** The last non-space offset in a range, for appending before a closing brace. */
function trimBack(source: string, from: number, to: number): number {
  let end = to;
  while (end > from && isSpace(source[end - 1])) end -= 1;
  return end;
}
