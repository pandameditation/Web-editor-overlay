import { parseDeclarations } from './css.js';
import { isBookkeepingAttribute, isEditorOwned, TreeView, type DomOp } from './dom-journal.js';
import { inexpressibleAt } from './content-model.js';
import { editOpenTag, type OpenTagEdit } from './html-patch.js';

/**
 * Writing the page's DOM changes into its HTML file, by identity rather than by search.
 *
 * Every earlier version of this looked elements up in the file — by id, by build marker, by
 * text, by position among similar siblings — and gave up when the lookup was ambiguous. A file
 * and a page diverge in too many ways for that to be reliable, so each new arrangement of edits
 * found a new way to fail, and failing meant rewriting the whole file.
 *
 * This works the other way round, in four steps.
 *
 * 1. **Source identity.** The file is tokenized, and a copy of it with every tag, text run and
 *    comment labelled with its byte range is parsed by the browser's own parser. That produces
 *    exactly the tree the browser built for the page, with every node knowing where it came from.
 * 2. **Binding.** That tree is matched against the live page as the file describes it — the live
 *    tree with the editor's journaled operations taken back. Both trees came out of the same parser
 *    and the same text, so they line up node for node; what does not line up is the page's own
 *    rendering, which the file does not hold.
 * 3. **Emission.** The journal names exactly which attributes, text nodes and child lists the
 *    user changed. Those, and only those, are written: an attribute inside its own tag, a text node
 *    over its own bytes, a child list over the span between the neighbours that did not change.
 *    Anything that did not change is copied byte for byte — including whatever moved, because a
 *    moved node still knows which bytes are its own.
 * 4. **Verification.** The result is parsed again and compared, node for node, with what it is
 *    meant to contain. A write that would not read back as intended is refused with the reason,
 *    instead of being written or replaced by a serialization of the page.
 */

/** One command's operations, the save-dialog rows it is reported under, and whether it was saved. */
export interface JournalRow {
  ops: readonly DomOp[];
  changeIds: readonly string[];
  saved: boolean;
}

export interface SourceJournal {
  /** Commands that fell off the undo stack, oldest first. Still applied. */
  retired: readonly JournalRow[];
  /** The undo stack, oldest first. */
  applied: readonly JournalRow[];
  /** Commands saved and since undone, which the file still holds unless the rollback is ticked. */
  rolledBack?: readonly JournalRow[];
  /** What this file already received from an earlier save in this session. */
  written?: { text: string; ops: readonly (readonly DomOp[])[] } | null;
}

export interface SourcePatchInput {
  source: string;
  journal: SourceJournal;
  /** Pending changes to leave out of this write: unticked, or with nowhere in the file to go. */
  excluded: ReadonlySet<string>;
  /**
   * The rows that describe markup. A command's other rows — a CSS rule it also wrote — do not
   * decide whether its DOM operations are written. Absent means every row counts.
   */
  markupRows?: ReadonlySet<string>;
  /** CSS rule edits to replay into an inline `<style>`'s text. */
  styleEdits?: ReadonlyMap<Element, (css: string) => string>;
  /** `data-heo-*` attributes that are content for this write rather than bookkeeping. */
  keep?: readonly string[];
}

export type SourcePatchResult =
  | {
    ok: true;
    html: string;
    ops: (readonly DomOp[])[];
    /** Ticked changes that only touched nodes this write leaves out of the file. */
    stranded: Set<string>;
    /** Changes left out because they touch content the file does not hold. */
    unplaced: Set<string>;
  }
  | { ok: false; why: string[] };

/* -------------------------------------------------------------------------- */
/* 1. Tokens                                                                   */
/* -------------------------------------------------------------------------- */

type TokenKind = 'start' | 'end' | 'text' | 'comment' | 'doctype' | 'raw';

interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  name?: string;
  nameEnd?: number;
}

const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'textarea', 'title']);
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr', 'basefont', 'bgsound', 'frame', 'keygen',
]);
const LEADING_NEWLINE_DROPPED = new Set(['pre', 'listing']);
const PRESERVES_SPACE = new Set(['pre', 'textarea', 'listing', 'plaintext', 'xmp']);
const LETTER = /[A-Za-z]/;
const SPACE = /[\t\n\f\r ]/;

function commentEnd(html: string, at: number): number {
  if (html.startsWith('<!-->', at)) return at + 5;
  if (html.startsWith('<!--->', at)) return at + 6;
  const a = html.indexOf('-->', at + 4);
  const b = html.indexOf('--!>', at + 4);
  if (a === -1 && b === -1) return html.length;
  if (b === -1 || (a !== -1 && a < b)) return a + 3;
  return b + 4;
}

/** Past the `>` of a tag whose name starts at `from`, honouring quoted attribute values. */
function scanTag(html: string, from: number): { name: string; nameEnd: number; end: number } {
  const n = html.length;
  let j = from;
  while (j < n && !SPACE.test(html[j]) && html[j] !== '/' && html[j] !== '>') j += 1;
  const name = html.slice(from, j).toLowerCase();
  const nameEnd = j;
  while (j < n) {
    const ch = html[j];
    if (ch === '>') return { name, nameEnd, end: j + 1 };
    if (SPACE.test(ch) || ch === '/') {
      j += 1;
      continue;
    }
    j += 1;
    while (j < n && !SPACE.test(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') j += 1;
    while (j < n && SPACE.test(html[j])) j += 1;
    if (html[j] !== '=') continue;
    j += 1;
    while (j < n && SPACE.test(html[j])) j += 1;
    const quote = html[j];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, j + 1);
      j = close === -1 ? n : close + 1;
    } else {
      while (j < n && !SPACE.test(html[j]) && html[j] !== '>') j += 1;
    }
  }
  return { name, nameEnd, end: n };
}

function rawClose(html: string, from: number, name: string): number {
  const lower = html.toLowerCase();
  const needle = `</${name}`;
  let at = from;
  for (; ;) {
    const found = lower.indexOf(needle, at);
    if (found === -1) return html.length;
    const after = html[found + needle.length];
    if (after === undefined || SPACE.test(after) || after === '/' || after === '>') return found;
    at = found + 1;
  }
}

/** The HTML tokenizer's view of where every tag, text run and comment starts and ends. */
function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const n = html.length;
  let i = 0;
  let textStart = -1;
  const flush = (end: number): void => {
    if (textStart !== -1 && end > textStart) out.push({ kind: 'text', start: textStart, end });
    textStart = -1;
  };
  const bogus = (from: number): void => {
    flush(from);
    const gt = html.indexOf('>', from + 1);
    const end = gt === -1 ? n : gt + 1;
    out.push({ kind: 'comment', start: from, end });
    i = end;
  };

  while (i < n) {
    if (html[i] !== '<') {
      if (textStart === -1) textStart = i;
      const lt = html.indexOf('<', i);
      i = lt === -1 ? n : lt;
      continue;
    }
    const next = html[i + 1];
    if (html.startsWith('<!--', i)) {
      flush(i);
      const end = commentEnd(html, i);
      out.push({ kind: 'comment', start: i, end });
      i = end;
      continue;
    }
    if (next === '!') {
      if (/^<!doctype/i.test(html.slice(i, i + 9))) {
        flush(i);
        const gt = html.indexOf('>', i);
        const end = gt === -1 ? n : gt + 1;
        out.push({ kind: 'doctype', start: i, end });
        i = end;
      } else {
        bogus(i);
      }
      continue;
    }
    if (next === '?') {
      bogus(i);
      continue;
    }
    if (next === '/') {
      const after = html[i + 2];
      if (after !== undefined && LETTER.test(after)) {
        flush(i);
        const tag = scanTag(html, i + 2);
        out.push({ kind: 'end', name: tag.name, start: i, end: tag.end });
        i = tag.end;
        continue;
      }
      if (after === '>') {
        flush(i);
        i += 3;
        continue;
      }
      if (after === undefined) {
        if (textStart === -1) textStart = i;
        i = n;
        continue;
      }
      bogus(i);
      continue;
    }
    if (next !== undefined && LETTER.test(next)) {
      flush(i);
      const tag = scanTag(html, i + 1);
      out.push({ kind: 'start', name: tag.name, start: i, end: tag.end, nameEnd: tag.nameEnd });
      i = tag.end;
      if (RAW_TEXT.has(tag.name)) {
        const close = rawClose(html, i, tag.name);
        if (close > i) out.push({ kind: 'raw', start: i, end: close });
        i = close;
      } else if (tag.name === 'plaintext') {
        if (n > i) out.push({ kind: 'raw', start: i, end: n });
        i = n;
      }
      continue;
    }
    if (textStart === -1) textStart = i;
    i += 1;
  }
  flush(n);
  return out;
}

/* -------------------------------------------------------------------------- */
/* 1b. The file as a tree that knows its own bytes                             */
/* -------------------------------------------------------------------------- */

interface Range {
  start: number;
  /** End of the opening tag; equal to `start` when the tag was implied. */
  openEnd: number;
  /** Start of the closing tag; equal to `closeEnd` when it was implied. */
  closeStart: number;
  /** End of what this node owns. Text after a closing tag (`</body>\n`) is not included. */
  closeEnd: number;
  explicitStart: boolean;
  explicitClose: boolean;
}

interface SourceTree {
  doc: Document;
  ranges: Map<Node, Range>;
  /** Text nodes that live after their parent's closing tag, such as the newline after `</body>`. */
  tails: Set<Node>;
}

const MARKER = /^heo-([tc]):(\d+)$/;
const OFFSET_ATTR = 'data-heo-o';

function parseSource(html: string): SourceTree {
  const tokens = tokenize(html);
  let instrumented = '';
  let cursor = 0;
  tokens.forEach((token, index) => {
    instrumented += html.slice(cursor, token.start);
    const text = html.slice(token.start, token.end);
    if (token.kind === 'start') {
      instrumented += `${html.slice(token.start, token.nameEnd!)} ${OFFSET_ATTR}="${index}"${html.slice(token.nameEnd!, token.end)}`;
    } else if (token.kind === 'text') {
      // The parser drops a newline straight after `<pre>`, but only straight after it.
      const previous = tokens[index - 1];
      const lead =
        previous?.kind === 'start' && LEADING_NEWLINE_DROPPED.has(previous.name!)
          ? (/^\r?\n/.exec(text)?.[0] ?? '')
          : '';
      if (lead) token.start += lead.length;
      instrumented += `${lead}<!--heo-t:${index}-->${text.slice(lead.length)}`;
    } else if (token.kind === 'comment') {
      instrumented += `<!--heo-c:${index}-->${text}`;
    } else {
      instrumented += text;
    }
    cursor = token.end;
  });
  instrumented += html.slice(cursor);

  const doc = new DOMParser().parseFromString(instrumented, 'text/html');
  const tokenOf = new Map<Node, number>();
  const elementAt = new Map<number, Element[]>();
  const markers: Comment[] = [];

  const walk = (node: Node): void => {
    for (const child of Array.from(kidsOf(node))) {
      if (child instanceof Element) {
        const raw = child.getAttribute(OFFSET_ATTR);
        if (raw !== null) {
          child.removeAttribute(OFFSET_ATTR);
          const index = Number(raw);
          const list = elementAt.get(index) ?? [];
          list.push(child);
          elementAt.set(index, list);
          tokenOf.set(child, index);
        }
        walk(child);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        const match = MARKER.exec((child as Comment).data);
        if (match) {
          markers.push(child as Comment);
          const next = child.nextSibling;
          const wanted = match[1] === 't' ? Node.TEXT_NODE : Node.COMMENT_NODE;
          if (next && next.nodeType === wanted && !tokenOf.has(next)) tokenOf.set(next, Number(match[2]));
        }
      }
    }
  };
  walk(doc);
  for (const marker of markers) marker.remove();

  // Text that the markers kept apart and the parser would have joined, joined again.
  const joinTexts = (node: Node): void => {
    let previous: Node | null = null;
    for (const child of Array.from(kidsOf(node))) {
      if (child.nodeType === Node.TEXT_NODE && previous?.nodeType === Node.TEXT_NODE) {
        const first = previous as Text;
        first.data += (child as Text).data;
        const a = tokenOf.get(first);
        const b = tokenOf.get(child);
        if (a !== undefined && b !== undefined) {
          tokens[a] = { ...tokens[a], end: tokens[b].end };
        } else {
          tokenOf.delete(first);
        }
        child.remove();
        continue;
      }
      if (child instanceof Element) joinTexts(child);
      previous = child;
    }
  };
  joinTexts(doc);

  const startTokens = new Set<number>();
  for (const [index, list] of elementAt) if (list.length === 1) startTokens.add(index);

  const ranges = new Map<Node, Range>();
  const tails = new Set<Node>();
  const nodeAtToken = new Map<number, Node>();
  for (const [node, index] of tokenOf) nodeAtToken.set(index, node);

  const measure = (node: Node): void => {
    for (const child of Array.from(kidsOf(node))) measure(child);
    const index = tokenOf.get(node);
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
      let token = index !== undefined ? tokens[index] : undefined;
      // A raw-text element's body has no marker; it is the token after the opening tag.
      if (!token && node.nodeType === Node.TEXT_NODE && node.parentNode instanceof Element) {
        const parentToken = tokenOf.get(node.parentNode);
        const after = parentToken !== undefined ? tokens[parentToken + 1] : undefined;
        if (after?.kind === 'raw' && node.parentNode.firstChild === node) token = after;
      }
      if (token) {
        ranges.set(node, {
          start: token.start,
          openEnd: token.start,
          closeStart: token.end,
          closeEnd: token.end,
          explicitStart: true,
          explicitClose: true,
        });
      }
      return;
    }
    if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
      const doctype = tokens.find((token) => token.kind === 'doctype');
      if (doctype) {
        ranges.set(node, {
          start: doctype.start,
          openEnd: doctype.start,
          closeStart: doctype.end,
          closeEnd: doctype.end,
          explicitStart: true,
          explicitClose: true,
        });
      }
      return;
    }
    if (!(node instanceof Element)) return;
    const explicitStart = index !== undefined && startTokens.has(index);
    const open = explicitStart ? tokens[index!] : undefined;
    let first = open ? open.start : Number.POSITIVE_INFINITY;
    let last = open ? open.end : -1;
    for (const child of Array.from(kidsOf(node))) {
      const range = ranges.get(child);
      if (!range) continue;
      first = Math.min(first, range.start);
      last = Math.max(last, range.closeEnd);
    }
    if (!Number.isFinite(first) || last < 0) return;
    if (!open && index !== undefined) return;

    const name = node.localName;
    let closeToken: Token | undefined;
    if (open && !VOID.has(name)) {
      const ancestors = new Set<string>();
      for (let at = node.parentElement; at; at = at.parentElement) ancestors.add(at.localName);
      let depth = 0;
      for (let k = index! + 1; k < tokens.length; k += 1) {
        const token = tokens[k];
        if (token.kind === 'start') {
          const owner = nodeAtToken.get(k);
          if (owner && !node.contains(owner) && owner !== node) break;
          if (token.name === name) depth += 1;
        } else if (token.kind === 'end') {
          if (token.name === name) {
            if (depth === 0) {
              closeToken = token;
              break;
            }
            depth -= 1;
          } else if (ancestors.has(token.name!)) {
            break;
          }
        } else if (token.kind === 'text' || token.kind === 'comment') {
          const owner = nodeAtToken.get(k);
          if (owner && !node.contains(owner)) break;
        }
      }
    }
    if (closeToken) {
      // Content past the closing tag can only be trailing space, like the newline after `</body>`.
      let consistent = true;
      for (const child of Array.from(kidsOf(node))) {
        const range = ranges.get(child);
        if (!range || range.start < closeToken.start) continue;
        if (child.nodeType === Node.TEXT_NODE && !(child as Text).data.trim()) tails.add(child);
        else consistent = false;
      }
      if (!consistent) closeToken = undefined;
    }
    if (closeToken) {
      ranges.set(node, {
        start: open ? open.start : first,
        openEnd: open ? open.end : first,
        closeStart: closeToken.start,
        closeEnd: closeToken.end,
        explicitStart: Boolean(open),
        explicitClose: true,
      });
      return;
    }
    ranges.set(node, {
      start: open ? open.start : first,
      openEnd: open ? open.end : first,
      closeStart: last,
      closeEnd: last,
      explicitStart: Boolean(open),
      explicitClose: false,
    });
  };
  measure(doc);
  ranges.set(doc, {
    start: 0,
    openEnd: 0,
    closeStart: html.length,
    closeEnd: html.length,
    explicitStart: false,
    explicitClose: false,
  });
  return { doc, ranges, tails };
}

/** Child nodes, with a template's content standing in for its (empty) children. */
function kidsOf(node: Node): NodeListOf<ChildNode> {
  return node instanceof HTMLTemplateElement ? node.content.childNodes : node.childNodes;
}

/* -------------------------------------------------------------------------- */
/* 2. Binding the file to the page                                             */
/* -------------------------------------------------------------------------- */

function relevant(node: Node): boolean {
  const type = node.nodeType;
  return (
    type === Node.ELEMENT_NODE ||
    type === Node.TEXT_NODE ||
    type === Node.COMMENT_NODE ||
    type === Node.DOCUMENT_TYPE_NODE
  );
}

function liveKids(view: TreeView, node: Node): Node[] {
  if (node instanceof HTMLTemplateElement) return [];
  return view.children(node).filter((child) => relevant(child) && !isEditorOwned(child));
}

function keyOf(node: Node, id: string | null): string {
  if (node instanceof Element) return `${node.namespaceURI}|${node.localName}|${id ?? ''}`;
  return `#${node.nodeType}`;
}

/** Longest common subsequence of two key lists, as index pairs. */
function align(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const pairs: Array<[number, number]> = [];
  if (!n || !m) return pairs;
  if (n * m > 4_000_000) {
    let j = 0;
    for (let i = 0; i < n && j < m; i += 1) {
      const limit = Math.min(m, j + 64);
      for (let k = j; k < limit; k += 1) {
        if (a[i] === b[k]) {
          pairs.push([i, k]);
          j = k + 1;
          break;
        }
      }
    }
    return pairs;
  }
  const table = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number): number => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[at(i, j)] =
        a[i] === b[j]
          ? table[at(i + 1, j + 1)] + 1
          : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

interface Binding {
  toSource: Map<Node, Node>;
  toLive: Map<Node, Node>;
  /**
   * Live nodes matched only by tag among siblings that do not pair up one for one — the page's
   * own code added or removed some of them. Their counterpart in the file is a guess, so nothing
   * is written over them.
   */
  uncertain: Set<Node>;
}

const TEXT_SAMPLE = 160;

/**
 * A short, whitespace-insensitive sample of the text inside a node, for telling siblings apart.
 */
function textSampler(
  kids: (node: Node) => readonly Node[],
  data: (node: CharacterData) => string,
): (node: Node) => string {
  const memo = new Map<Node, string>();
  const sample = (node: Node): string => {
    const known = memo.get(node);
    if (known !== undefined) return known;
    let out = '';
    if (node.nodeType === Node.TEXT_NODE) {
      out = data(node as CharacterData);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      for (const kid of kids(node)) {
        if (out.length > TEXT_SAMPLE * 2) break;
        if (kid.nodeType === Node.TEXT_NODE || kid.nodeType === Node.ELEMENT_NODE) out += ` ${sample(kid)}`;
      }
    }
    out = out.replace(/\s+/g, ' ').trim().slice(0, TEXT_SAMPLE);
    memo.set(node, out);
    return out;
  };
  return sample;
}

function classesOf(value: string | null): string {
  return (value ?? '').split(/\s+/).filter(Boolean).sort().join(' ');
}

function bind(tree: SourceTree, view: TreeView, root: Document): Binding {
  const toSource = new Map<Node, Node>();
  const toLive = new Map<Node, Node>();
  const uncertain = new Set<Node>();
  const sourceSample = textSampler(
    (node) => Array.from(kidsOf(node)),
    (node) => node.data,
  );
  const liveSample = textSampler(
    (node) => liveKids(view, node),
    (node) => view.data(node),
  );
  const strongKey = (node: Node, live: boolean): string => {
    const sample = live ? liveSample(node) : sourceSample(node);
    if (node instanceof Element) {
      const attr = (name: string): string | null =>
        live ? view.attribute(node, name) : node.getAttribute(name);
      return `${keyOf(node, attr('id'))}|${classesOf(attr('class'))}|${sample}`;
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      return `#8|${live ? view.data(node as Comment) : (node as Comment).data}`;
    }
    return `${keyOf(node, null)}|${sample}`;
  };
  const weakKey = (node: Node, live: boolean): string =>
    keyOf(node, node instanceof Element ? (live ? view.attribute(node, 'id') : node.getAttribute('id')) : null);
  const middleKey = (node: Node, live: boolean): string =>
    node instanceof Element
      ? `${weakKey(node, live)}|${classesOf(live ? view.attribute(node, 'class') : node.getAttribute('class'))}`
      : weakKey(node, live);
  const blank = (node: Node, live: boolean): boolean =>
    node.nodeType === Node.TEXT_NODE &&
    !(live ? view.data(node as Text) : (node as Text).data).trim();

  const visit = (source: Node, live: Node, unsure: boolean): void => {
    toSource.set(live, source);
    toLive.set(source, live);
    if (unsure) uncertain.add(live);
    if (source instanceof HTMLTemplateElement || live instanceof HTMLTemplateElement) return;
    const sourceKids = Array.from(kidsOf(source)).filter(relevant);
    const kids = liveKids(view, live);

    /*
     * Three passes, each only inside the gaps the one before left.
     *
     * Content first: siblings that still say what the file says pair up on that. Then tag, id and
     * classes, then tag and id alone. A pair from either of the later passes is trusted only when
     * that stretch holds the same number of that key on both sides; otherwise the page's own code
     * has added or removed some of them and which is which is a guess. Space between tags is too
     * alike to anchor anything, so it only ever pairs in the last pass.
     */
    const masked = (key: (node: Node, live: boolean) => string) => ({
      source: sourceKids.map((node, index) => (blank(node, false) ? `\u0000s${index}` : key(node, false))),
      live: kids.map((node, index) => (blank(node, true) ? `\u0000l${index}` : key(node, true))),
    });
    const tiers = [
      masked(strongKey),
      masked(middleKey),
      { source: sourceKids.map((node) => weakKey(node, false)), live: kids.map((node) => weakKey(node, true)) },
    ];
    const pairs: Array<[number, number, 'content' | 'sure' | 'doubt']> = [];
    const count = (keys: readonly string[]): Map<string, number> => {
      const out = new Map<string, number>();
      for (const key of keys) out.set(key, (out.get(key) ?? 0) + 1);
      return out;
    };
    const pass = (tier: number, i0: number, i1: number, j0: number, j1: number): void => {
      if (tier >= tiers.length || i0 >= i1 || j0 >= j1) return;
      const left = tiers[tier].source.slice(i0, i1);
      const right = tiers[tier].live.slice(j0, j1);
      const leftCount = count(left);
      const rightCount = count(right);
      let i = i0;
      let j = j0;
      for (const [a, b] of align(left, right)) {
        pass(tier + 1, i, i0 + a, j, j0 + b);
        const key = left[a];
        pairs.push([
          i0 + a,
          j0 + b,
          tier === 0 ? 'content' : leftCount.get(key) === rightCount.get(key) ? 'sure' : 'doubt',
        ]);
        i = i0 + a + 1;
        j = j0 + b + 1;
      }
      pass(tier + 1, i, i1, j, j1);
    };
    pass(0, 0, sourceKids.length, 0, kids.length);
    // A pair is doubtful in itself, or because its parent was and its own content does not vouch.
    for (const [si, lj, how] of pairs) {
      visit(sourceKids[si], kids[lj], how === 'doubt' || (unsure && how !== 'content'));
    }
  };
  visit(tree.doc, root, false);
  return { toSource, toLive, uncertain };
}

/* -------------------------------------------------------------------------- */
/* 3. Emission                                                                 */
/* -------------------------------------------------------------------------- */

/** What a stretch of output is meant to parse back into. */
type Expected =
  | { k: 'node'; node: Node }
  | {
    k: 'el';
    name: string;
    ns: string | null;
    attrs: Map<string, string>;
    kids: Expected[];
    ws: boolean;
    template?: string;
    /** The page's node this stands for, so a failed check can say where. */
    live?: Node;
  }
  | { k: 'text'; data: string }
  | { k: 'comment'; data: string };

interface Rendered {
  text: string;
  exp: Expected[];
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\u00a0/g, '&nbsp;');
}

const RAW_PARENT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

let probeDocument: Document | null = null;

/** The attributes an opening tag's text parses to. */
function parseOpenTag(raw: string): Map<string, string> {
  probeDocument ??= document.implementation.createHTMLDocument('');
  const body = probeDocument.body;
  body.innerHTML = `${raw.replace(/^<[^\s/>]+/, '<heo-probe')}</heo-probe>`;
  const el = body.firstElementChild;
  const out = new Map<string, string>();
  if (el) for (const attr of Array.from(el.attributes)) out.set(attr.name, attr.value);
  body.textContent = '';
  return out;
}

function sourceAttributes(el: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const attr of Array.from(el.attributes)) out.set(attr.name, attr.value);
  return out;
}

function tokensOf(value: string | null): string[] {
  return (value ?? '').split(/\s+/).filter(Boolean);
}

class Emitter {
  readonly why: string[] = [];
  #strict = false;
  readonly #source: string;
  readonly #tree: SourceTree;
  readonly #binding: Binding;
  readonly #file: TreeView;
  readonly #target: TreeView;
  readonly #dirty: Dirty;
  readonly #keep: ReadonlySet<string>;
  readonly #styleEdits: ReadonlyMap<Element, (css: string) => string>;
  readonly #eol: string;
  readonly #forced: ReadonlyMap<Node, 'all' | 'pure'>;

  constructor(options: {
    source: string;
    tree: SourceTree;
    binding: Binding;
    file: TreeView;
    target: TreeView;
    dirty: Dirty;
    keep: ReadonlySet<string>;
    styleEdits: ReadonlyMap<Element, (css: string) => string>;
    eol: string;
    forced: ReadonlyMap<Node, 'all' | 'pure'>;
    strict: boolean;
  }) {
    this.#source = options.source;
    this.#tree = options.tree;
    this.#binding = options.binding;
    this.#file = options.file;
    this.#target = options.target;
    this.#dirty = options.dirty;
    this.#keep = options.keep;
    this.#styleEdits = options.styleEdits;
    this.#eol = options.eol;
    this.#forced = options.forced;
    this.#strict = options.strict;
  }

  run(root: Document): { text: string; exp: Expected } {
    const range = this.#tree.ranges.get(this.#tree.doc)!;
    const content = this.#content(root, this.#tree.doc, range);
    return {
      text: content.text,
      exp: { k: 'el', name: '#document', ns: null, attrs: new Map(), kids: content.exp, ws: false, live: root },
    };
  }

  /** A node the page's own code built: not in the file, and not the user's to write. */
  #generated(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) return false;
    return !this.#binding.toSource.has(node) && this.#file.connected(node);
  }

  #kids(node: Node): Node[] {
    return liveKids(this.#target, node).filter((kid) => !this.#generated(kid));
  }

  #needsRender(node: Node): boolean {
    return this.#dirty.touched.has(node);
  }

  #slice(range: Range): string {
    return this.#source.slice(range.start, range.closeEnd);
  }

  render(node: Node, moved: boolean): Rendered {
    const source = this.#binding.toSource.get(node);
    const range = source ? this.#tree.ranges.get(source) : undefined;

    if (node.nodeType === Node.TEXT_NODE) {
      const data = this.#target.data(node as Text);
      if (range && source && !this.#dirty.text.has(node)) {
        return { text: this.#slice(range), exp: [{ k: 'node', node: source }] };
      }
      const parent = this.#target.parent(node);
      const raw = parent instanceof Element && RAW_PARENT.has(parent.localName);
      return { text: raw ? data : escapeText(data), exp: [{ k: 'text', data }] };
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      const data = this.#target.data(node as Comment);
      if (range && source && !this.#dirty.text.has(node)) {
        return { text: this.#slice(range), exp: [{ k: 'node', node: source }] };
      }
      return { text: `<!--${data}-->`, exp: [{ k: 'comment', data }] };
    }
    if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
      if (range && source) return { text: this.#slice(range), exp: [{ k: 'node', node: source }] };
      return { text: `<!DOCTYPE ${(node as DocumentType).name}>`, exp: [] };
    }
    if (!(node instanceof Element)) return { text: '', exp: [] };

    if (!range || !source) return this.#serialize(node, moved);
    if (moved && this.#binding.uncertain.has(node)) {
      this.why.push(`the moved ${describe(node)} cannot be matched to the file for certain`);
    }

    const name = node.localName;
    // Moved, the end the file left implied would be decided by whatever now follows it.
    const closeMissing = moved && !range.explicitClose && !VOID.has(name);
    if (!this.#needsRender(node)) {
      return {
        text: this.#slice(range) + (closeMissing ? `</${name}>` : ''),
        exp: [{ k: 'node', node: source }],
      };
    }

    const edits = this.#attributeEdits(node, source as Element);
    let open: string;
    let attrs: Map<string, string>;
    if (range.explicitStart) {
      const openRaw = this.#source.slice(range.start, range.openEnd);
      open = edits.length ? editOpenTag(openRaw, edits) : openRaw;
      attrs = edits.length ? parseOpenTag(open) : sourceAttributes(source as Element);
    } else if (edits.length) {
      // The file implied this tag. Attributes need somewhere to go, so it is written out.
      open = `<${name}`;
      attrs = new Map();
      for (const attr of this.#target.attributeNames(node)) {
        if (isBookkeepingAttribute(attr) && !this.#keep.has(attr)) continue;
        const value = this.#target.attribute(node, attr) ?? '';
        attrs.set(attr, value);
        open += ` ${attr}="${escapeAttribute(value)}"`;
      }
      open += '>';
    } else {
      open = '';
      attrs = sourceAttributes(source as Element);
    }

    let inner: Rendered & { ws: boolean };
    if (VOID.has(name)) {
      if (this.#kids(node).length) this.why.push(`the page puts content inside a <${name}>, which HTML cannot express`);
      inner = { text: '', exp: [], ws: false };
    } else {
      const css = this.#styleEdits.get(node);
      if (css) {
        const text = css(this.#source.slice(range.openEnd, range.closeStart));
        inner = { text, exp: text ? [{ k: 'text', data: text }] : [], ws: false };
      } else {
        inner = this.#content(node, source, range);
      }
    }
    const close = range.explicitClose
      ? this.#source.slice(range.closeStart, range.closeEnd)
      : closeMissing
        ? `</${name}>`
        : '';
    const tail = Array.from(kidsOf(source))
      .filter((kid) => this.#tree.tails.has(kid))
      .map((kid): Expected => ({ k: 'node', node: kid }));
    return {
      text: open + inner.text + close,
      exp: [
        {
          k: 'el',
          name,
          ns: node.namespaceURI,
          attrs,
          kids: [...inner.exp, ...tail],
          ws: inner.ws,
          live: node,
          ...(node instanceof HTMLTemplateElement ? { template: (source as HTMLTemplateElement).innerHTML } : {}),
        },
      ],
    };
  }

  /** An element the file has never seen, written out with whatever inside it the file has. */
  #serialize(el: Element, _moved: boolean, pure = false): Rendered {
    const name = el.localName;
    const attrs = new Map<string, string>();
    let text = `<${name}`;
    for (const attr of this.#target.attributeNames(el)) {
      if (isBookkeepingAttribute(attr) && !this.#keep.has(attr)) continue;
      const value = this.#target.attribute(el, attr) ?? '';
      attrs.set(attr, value);
      text += ` ${attr}="${escapeAttribute(value)}"`;
    }
    text += '>';
    if (VOID.has(name)) {
      if (this.#kids(el).length) this.why.push(`the page puts content inside a <${name}>, which HTML cannot express`);
      return { text, exp: [{ k: 'el', name, ns: el.namespaceURI, attrs, kids: [], ws: false, live: el }] };
    }
    if (el instanceof HTMLTemplateElement) {
      const html = el.innerHTML;
      return {
        text: `${text}${html}</${name}>`,
        exp: [{ k: 'el', name, ns: el.namespaceURI, attrs, kids: [], ws: false, template: html, live: el }],
      };
    }
    const kids: Expected[] = [];
    for (const kid of this.#kids(el)) {
      const rendered = pure ? this.#pure(kid) : this.render(kid, true);
      text += rendered.text;
      kids.push(...rendered.exp);
    }
    text += `</${name}>`;
    return { text, exp: [{ k: 'el', name, ns: el.namespaceURI, attrs, kids, ws: false, live: el }] };
  }

  /**
   * A node written from the page alone, the way a serializer would, with no bytes from the file.
   *
   * The last resort for one container whose minimal patch did not read back: still only that
   * container's content, and still verified.
   */
  #pure(node: Node): Rendered {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = this.#target.data(node as Text);
      const parent = this.#target.parent(node);
      const raw = parent instanceof Element && RAW_PARENT.has(parent.localName);
      return { text: raw ? data : escapeText(data), exp: [{ k: 'text', data }] };
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      const data = this.#target.data(node as Comment);
      return { text: `<!--${data}-->`, exp: [{ k: 'comment', data }] };
    }
    if (!(node instanceof Element)) return { text: '', exp: [] };
    return this.#serialize(node, true, true);
  }

  /** The tag edits that carry the user's attribute changes, and nothing the page did. */
  #attributeEdits(el: Element, source: Element): OpenTagEdit[] {
    const names = this.#dirty.attrs.get(el);
    if (!names) return [];
    const edits: OpenTagEdit[] = [];
    for (const name of names) {
      const before = this.#file.attribute(el, name);
      const after = this.#target.attribute(el, name);
      if (name === 'style' && before !== null && after !== null) {
        const was = parseDeclarations(before);
        const now = parseDeclarations(after);
        const declarations: Record<string, string | null> = {};
        for (const property of new Set([...Object.keys(was), ...Object.keys(now)])) {
          if (was[property] !== now[property]) declarations[property] = now[property] ?? null;
        }
        if (Object.keys(declarations).length) edits.push({ name: 'style', declarations });
        continue;
      }
      if (name === 'class' && before !== null && after !== null) {
        const was = new Set(tokensOf(before));
        const now = new Set(tokensOf(after));
        const kept = tokensOf(source.getAttribute('class')).filter((token) => !was.has(token) || now.has(token));
        for (const token of now) if (!was.has(token) && !kept.includes(token)) kept.push(token);
        edits.push({ name, value: kept.length ? kept.join(' ') : null });
        continue;
      }
      edits.push({ name, value: after });
    }
    return edits;
  }

  /**
   * An element's content with the user's changes in it.
   *
   * Children that kept their place at either end are left exactly where they are, patched in
   * place if something inside them changed. Only the stretch between them is written fresh.
   */
  #content(live: Node, source: Node, range: Range): Rendered & { ws: boolean } {
    const contentStart = range.openEnd;
    const contentEnd = range.closeStart;
    const original = this.#source.slice(contentStart, contentEnd);
    const sourceAll = Array.from(kidsOf(source)).filter((kid) => relevant(kid) && !this.#tree.tails.has(kid));
    const tailLive = new Set(
      Array.from(kidsOf(source))
        .filter((kid) => this.#tree.tails.has(kid))
        .map((kid) => this.#binding.toLive.get(kid))
        .filter((kid): kid is Node => Boolean(kid)),
    );
    const liveAll = this.#kids(live).filter((kid) => !tailLive.has(kid));

    const isSpace = (node: Node, data: string): boolean => node.nodeType === Node.TEXT_NODE && !data.trim();
    const sourceSpace = (node: Node): boolean => isSpace(node, (node as CharacterData).data ?? '');
    const liveSpace = (node: Node): boolean =>
      isSpace(node, node.nodeType === Node.TEXT_NODE ? this.#target.data(node as Text) : 'x');

    const block =
      live.nodeType === Node.ELEMENT_NODE &&
      /\n/.test(original) &&
      !this.#preservesSpace(live as Element) &&
      !liveAll.some((kid) => kid.nodeType === Node.TEXT_NODE && !liveSpace(kid)) &&
      !sourceAll.some((kid) => kid.nodeType === Node.TEXT_NODE && !sourceSpace(kid));

    const level = this.#forced.get(live);
    if (level === 'pure') {
      // Everything between the tags written from the page; what follows the closing tag stays.
      const parts = liveAll.map((kid) => this.#pure(kid));
      return {
        text: parts.map((part) => part.text).join(''),
        exp: parts.flatMap((part) => part.exp),
        ws: false,
      };
    }

    const sourceItems = block ? sourceAll.filter((kid) => !sourceSpace(kid)) : sourceAll;
    const liveItems = block ? liveAll.filter((kid) => !liveSpace(kid)) : liveAll;
    const sourceOnly = (node: Node): boolean => !this.#binding.toLive.has(node);
    const matches = (s: Node, l: Node): boolean =>
      this.#binding.toSource.get(l) === s && Boolean(this.#tree.ranges.get(s));

    let i = 0;
    let j = 0;
    const kept: Array<[Node, Node]> = [];
    // Forced: nothing is kept in place, every child is written again in order.
    const keepEnds = level !== 'all';
    while (keepEnds && i < sourceItems.length && j < liveItems.length) {
      if (sourceOnly(sourceItems[i]) && this.#tree.ranges.has(sourceItems[i])) {
        i += 1;
        continue;
      }
      if (!matches(sourceItems[i], liveItems[j])) break;
      kept.push([sourceItems[i], liveItems[j]]);
      i += 1;
      j += 1;
    }
    let si = sourceItems.length;
    let lj = liveItems.length;
    while (keepEnds && si > i && lj > j) {
      if (sourceOnly(sourceItems[si - 1]) && this.#tree.ranges.has(sourceItems[si - 1])) {
        si -= 1;
        continue;
      }
      if (!matches(sourceItems[si - 1], liveItems[lj - 1])) break;
      kept.push([sourceItems[si - 1], liveItems[lj - 1]]);
      si -= 1;
      lj -= 1;
    }
    // Source-only nodes at the edges of the gap stay outside it, untouched.
    while (i < si && sourceOnly(sourceItems[i]) && this.#tree.ranges.has(sourceItems[i])) i += 1;
    while (si > i && sourceOnly(sourceItems[si - 1]) && this.#tree.ranges.has(sourceItems[si - 1])) si -= 1;

    const sourceGap = sourceItems.slice(i, si);
    const liveGap = liveItems.slice(j, lj);
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const renderedFor = new Map<Node, Expected[]>();

    for (const [s, l] of kept) {
      const own = this.#tree.ranges.get(s)!;
      const needs =
        l.nodeType === Node.TEXT_NODE || l.nodeType === Node.COMMENT_NODE
          ? this.#dirty.text.has(l)
          : this.#needsRender(l);
      if (!needs) continue;
      const rendered = this.render(l, false);
      edits.push({ start: own.start, end: own.closeEnd, text: rendered.text });
      renderedFor.set(s, rendered.exp);
    }

    const gapExp: Expected[] = [];
    let gapStart = -1;
    let gapEnd = -1;
    if (sourceGap.length || liveGap.length) {
      gapStart = i > 0 ? this.#tree.ranges.get(sourceItems[i - 1])?.closeEnd ?? -1 : contentStart;
      gapEnd = si < sourceItems.length ? this.#tree.ranges.get(sourceItems[si])?.start ?? -1 : contentEnd;
      if (gapStart < 0 || gapEnd < 0 || gapStart > gapEnd) {
        this.why.push(`the file's ${describe(live)} could not be split around the change`);
        return { text: original, exp: [], ws: false };
      }

      // What goes in the gap: the page's children, with anything only the file has kept in order.
      const sequence: Array<{ node: Node; from: 'live' | 'source' }> = [];
      const pendingSource = sourceGap.filter(sourceOnly);
      for (const kid of liveGap) {
        const counterpart = this.#binding.toSource.get(kid);
        if (counterpart) {
          while (pendingSource.length && precedes(pendingSource[0], counterpart)) {
            sequence.push({ node: pendingSource.shift()!, from: 'source' });
          }
        }
        sequence.push({ node: kid, from: 'live' });
      }
      for (const node of pendingSource) sequence.push({ node, from: 'source' });

      const pieces: string[] = [];
      for (const item of sequence) {
        if (item.from === 'source') {
          const own = this.#tree.ranges.get(item.node);
          if (!own) continue;
          pieces.push(this.#slice(own));
          gapExp.push({ k: 'node', node: item.node });
          continue;
        }
        const rendered = this.render(item.node, true);
        pieces.push(rendered.text);
        gapExp.push(...rendered.exp);
      }

      /*
       * Content placed straight after an element whose closing tag the file left implied would be
       * read as part of it: `<li>one` followed by new text is still the first item. That element's
       * own trailing text already ends the line, so nothing is added in front of the first piece,
       * and on the strict pass its closing tag is written out.
       */
      const before = i > 0 ? sourceItems[i - 1] : null;
      const beforeRange = before ? this.#tree.ranges.get(before) : undefined;
      const openEnded =
        before instanceof Element &&
        beforeRange !== undefined &&
        !beforeRange.explicitClose &&
        !VOID.has(before.localName);
      const closer =
        openEnded && (this.#strict || pieces.length) ? `</${(before as Element).localName}>` : '';

      let text: string;
      if (block) {
        const region = this.#source.slice(gapStart, gapEnd);
        const lastSource = sourceGap.at(-1);
        const trail = lastSource
          ? this.#source.slice(this.#tree.ranges.get(lastSource)?.closeEnd ?? gapEnd, gapEnd)
          : region;
        const indent = this.#childIndent(sourceAll, range, region);
        text =
          closer +
          pieces.map((piece, k) => (k === 0 && openEnded ? piece : `${this.#eol}${indent}${piece}`)).join('') +
          // Space left behind an open element would become its text; it already ends the line.
          (openEnded && !closer && !pieces.length ? '' : trail);
      } else {
        text = closer + pieces.join('');
      }
      edits.push({ start: gapStart, end: gapEnd, text });
    }

    edits.sort((a, b) => b.start - a.start);
    let text = original;
    let previous = Number.POSITIVE_INFINITY;
    for (const edit of edits) {
      if (edit.end > previous) {
        this.why.push(`two changes inside ${describe(live)} overlap`);
        return { text: original, exp: [], ws: false };
      }
      text = text.slice(0, edit.start - contentStart) + edit.text + text.slice(edit.end - contentStart);
      previous = edit.start;
    }

    // What this content should read back as, in order: the kept head, the gap, the kept tail.
    const exp: Expected[] = [];
    const push = (kid: Node): void => {
      exp.push(...(renderedFor.get(kid) ?? [{ k: 'node', node: kid }]));
    };
    if (gapStart < 0) {
      for (const kid of sourceAll) push(kid);
    } else {
      const headEnd = i < sourceItems.length ? sourceAll.indexOf(sourceItems[i]) : sourceAll.length;
      const tailStart = si < sourceItems.length ? sourceAll.indexOf(sourceItems[si]) : sourceAll.length;
      const lastKept = i > 0 ? sourceAll.indexOf(sourceItems[i - 1]) : -1;
      for (let k = 0; k <= lastKept; k += 1) push(sourceAll[k]);
      for (let k = lastKept + 1; k < Math.min(headEnd, tailStart); k += 1) {
        // Between the last kept child and the gap: only space can sit here, and it is rewritten.
        if (!block) push(sourceAll[k]);
      }
      exp.push(...gapExp);
      for (let k = tailStart; k < sourceAll.length; k += 1) push(sourceAll[k]);
    }
    return { text, exp, ws: block };
  }

  #preservesSpace(el: Element): boolean {
    if (PRESERVES_SPACE.has(el.localName) || RAW_PARENT.has(el.localName)) return true;
    try {
      const space = getComputedStyle(el).whiteSpace;
      return space.startsWith('pre') || space === 'break-spaces';
    } catch {
      return false;
    }
  }

  /** The indentation the file's own children use, for a child that joins them. */
  #childIndent(sourceKids: readonly Node[], range: Range, region: string): string {
    for (const kid of sourceKids) {
      if (kid.nodeType === Node.TEXT_NODE) continue;
      const own = this.#tree.ranges.get(kid);
      if (!own) continue;
      const lineStart = this.#source.lastIndexOf('\n', own.start - 1) + 1;
      const lead = this.#source.slice(lineStart, own.start);
      if (!lead.trim()) return lead;
    }
    const fromRegion = /\n([ \t]*)[^\n]*$/.exec(region.trimEnd() ? region : '');
    if (fromRegion) return fromRegion[1];
    const lineStart = this.#source.lastIndexOf('\n', range.start - 1) + 1;
    const lead = this.#source.slice(lineStart, range.start);
    return `${lead.trim() ? '' : lead}  `;
  }
}

function precedes(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function describe(node: Node): string {
  return node instanceof Element ? `<${node.localName}>` : 'document';
}

/* -------------------------------------------------------------------------- */
/* What changed                                                                */
/* -------------------------------------------------------------------------- */

interface Dirty {
  attrs: Map<Element, Set<string>>;
  text: Set<Node>;
  kids: Set<Node>;
  /** Every node that changed, or holds something that did, in the target tree. */
  touched: Set<Node>;
}

function collectDirty(ops: readonly DomOp[], file: TreeView, target: TreeView): Dirty {
  const attrs = new Map<Element, Set<string>>();
  const text = new Set<Node>();
  const kids = new Set<Node>();
  const touched = new Set<Node>();
  const filtered = (view: TreeView, node: Node): Node[] => liveKids(view, node);

  for (const op of ops) {
    if (op.type === 'attr') {
      if (file.attribute(op.target, op.name) === target.attribute(op.target, op.name)) continue;
      const names = attrs.get(op.target) ?? new Set<string>();
      names.add(op.name);
      attrs.set(op.target, names);
    } else if (op.type === 'text') {
      if (file.data(op.target) !== target.data(op.target)) text.add(op.target);
    } else if (!kids.has(op.target)) {
      const was = filtered(file, op.target);
      const now = filtered(target, op.target);
      if (was.length !== now.length || was.some((node, index) => node !== now[index])) kids.add(op.target);
    }
  }
  return { attrs, text, kids, touched };
}

/** Mark every changed node and everything above it, so the emitter knows where to descend. */
function markTouched(dirty: Dirty, target: TreeView, styleEdits: ReadonlyMap<Element, unknown>): void {
  const mark = (node: Node): void => {
    for (let at: Node | null = node; at && !dirty.touched.has(at); at = target.parent(at)) {
      dirty.touched.add(at);
    }
  };
  for (const el of dirty.attrs.keys()) if (target.connected(el)) mark(el);
  for (const node of dirty.text) if (target.connected(node)) mark(node);
  for (const node of dirty.kids) if (target.connected(node)) mark(node);
  for (const el of styleEdits.keys()) mark(el);
}

/* -------------------------------------------------------------------------- */
/* 4. Verification                                                             */
/* -------------------------------------------------------------------------- */

interface Shape {
  type: 'el' | 'text' | 'comment' | 'doctype';
  name?: string;
  ns?: string | null;
  attrs?: Map<string, string>;
  data?: string;
  template?: string;
  ws?: boolean;
  kids?: () => Shape[];
  /** The page's node this stands for, when there is one. */
  live?: Node | null;
}

interface Mismatch {
  message: string;
  /** The page's node whose children did not read back. */
  parent: Node | null;
  /** The child of it where they first parted, when that is known. */
  child: Node | null;
}

function fromNode(node: Node, toLive?: ReadonlyMap<Node, Node>): Shape | null {
  const live = toLive?.get(node) ?? null;
  if (node.nodeType === Node.TEXT_NODE) return { type: 'text', data: (node as Text).data, live };
  if (node.nodeType === Node.COMMENT_NODE) return { type: 'comment', data: (node as Comment).data, live };
  if (node.nodeType === Node.DOCUMENT_TYPE_NODE) return { type: 'doctype', live };
  const childrenOf = (of: Node): Shape[] =>
    Array.from(of.childNodes)
      .map((kid) => fromNode(kid, toLive))
      .filter((x): x is Shape => Boolean(x));
  if (node.nodeType === Node.DOCUMENT_NODE) {
    return { type: 'el', name: '#document', ns: null, attrs: new Map(), kids: () => childrenOf(node), live };
  }
  if (!(node instanceof Element)) return null;
  const attrs = new Map<string, string>();
  for (const attr of Array.from(node.attributes)) attrs.set(attr.name, attr.value);
  return {
    type: 'el',
    name: node.localName,
    ns: node.namespaceURI,
    attrs,
    template: node instanceof HTMLTemplateElement ? node.innerHTML : undefined,
    kids: () => (node instanceof HTMLTemplateElement ? [] : childrenOf(node)),
    live,
  };
}

function fromExpected(exp: Expected, toLive: ReadonlyMap<Node, Node>): Shape | null {
  if (exp.k === 'node') return fromNode(exp.node, toLive);
  if (exp.k === 'text') return { type: 'text', data: exp.data };
  if (exp.k === 'comment') return { type: 'comment', data: exp.data };
  return {
    type: 'el',
    name: exp.name,
    ns: exp.ns,
    attrs: exp.attrs,
    template: exp.template,
    ws: exp.ws,
    kids: () => exp.kids.map((kid) => fromExpected(kid, toLive)).filter((x): x is Shape => Boolean(x)),
    live: exp.live ?? null,
  };
}

function normalize(kids: Shape[], ws: boolean): Shape[] {
  const out: Shape[] = [];
  for (const kid of kids) {
    const last = out.at(-1);
    if (kid.type === 'text' && last?.type === 'text') {
      out[out.length - 1] = { type: 'text', data: last.data! + kid.data!, live: last.live ?? kid.live };
      continue;
    }
    out.push(kid);
  }
  return ws ? out.filter((kid) => kid.type !== 'text' || kid.data!.trim() !== '') : out;
}

function sameShape(actual: Shape, wanted: Shape, path: string, parent: Node | null): Mismatch | null {
  const miss = (message: string, child: Node | null = wanted.live ?? null): Mismatch => ({
    message,
    parent,
    child,
  });
  if (actual.type !== wanted.type) return miss(`${path}: found ${actual.type}, expected ${wanted.type}`);
  if (actual.type === 'text' || actual.type === 'comment') {
    return actual.data === wanted.data ? null : miss(`${path}: ${actual.type} differs`);
  }
  if (actual.type === 'doctype') return null;
  if (actual.name !== wanted.name || actual.ns !== wanted.ns) {
    return miss(`${path}: found <${actual.name}>, expected <${wanted.name}>`);
  }
  const a = actual.attrs!;
  const b = wanted.attrs!;
  if (a.size !== b.size || [...a].some(([name, value]) => b.get(name) !== value)) {
    return miss(`${path}/<${actual.name}>: attributes differ`);
  }
  if ((actual.template ?? null) !== (wanted.template ?? null)) {
    return miss(`${path}/<${actual.name}>: template differs`);
  }
  const ws = Boolean(wanted.ws || actual.ws);
  const left = normalize(actual.kids!(), ws);
  const right = normalize(wanted.kids!(), ws);
  const here = `${path}/<${actual.name}>`;
  const self = wanted.live ?? null;
  if (left.length !== right.length) {
    let k = 0;
    while (
      k < Math.min(left.length, right.length) &&
      left[k].type === right[k].type &&
      left[k].name === right[k].name &&
      (left[k].type !== 'text' || left[k].data === right[k].data)
    ) {
      k += 1;
    }
    return {
      message: `${here}: ${left.length} children, expected ${right.length}`,
      parent: self,
      child: right[k]?.live ?? null,
    };
  }
  for (let k = 0; k < left.length; k += 1) {
    const mismatch = sameShape(left[k], right[k], here, self);
    if (mismatch) return mismatch;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Putting it together                                                         */
/* -------------------------------------------------------------------------- */

/** Changes whose every operation landed on something on the page that this write leaves out. */
function strandedChanges(entries: readonly JournalRow[], target: TreeView): Set<string> {
  const out = new Set<string>();
  const live = new Set<string>();
  for (const entry of entries) {
    if (!entry.changeIds.length || !entry.ops.length) continue;
    const reaches = entry.ops.some((op) => target.connected(op.target) || inShadowTree(op.target));
    // Left out only if what it changed is still on the page; a later deletion simply supersedes it.
    const onPage = entry.ops.some((op) => op.target.isConnected);
    for (const id of entry.changeIds) {
      if (reaches || !onPage) live.add(id);
      else out.add(id);
    }
  }
  for (const id of live) out.delete(id);
  return out;
}

function inShadowTree(node: Node): boolean {
  return node.getRootNode() instanceof ShadowRoot;
}

/**
 * Write the journaled changes into the file's text, or say exactly why they cannot be.
 */
export function patchSourceFromJournal(input: SourcePatchInput): SourcePatchResult {
  const { source, journal } = input;
  const root = document;
  const styleEdits = input.styleEdits ?? new Map<Element, (css: string) => string>();

  const onPage = [...journal.retired, ...journal.applied];
  const allOps = onPage.map((entry) => entry.ops);
  const base = new TreeView();
  for (let i = allOps.length - 1; i >= 0; i -= 1) {
    const ops = allOps[i];
    for (let j = ops.length - 1; j >= 0; j -= 1) base.revert(ops[j]);
  }

  const fileOps = journal.written?.ops ?? [];
  const file = base.fork();
  for (const ops of fileOps) for (const op of ops) file.replay(op);

  let tree: SourceTree;
  try {
    tree = parseSource(source);
  } catch (error) {
    return { ok: false, why: [`the file could not be read as HTML (${String(error)})`] };
  }
  const binding = bind(tree, file, root);

  /*
   * The page the file should describe: everything applied, minus what is left out.
   *
   * Built twice at most. A change that touches content the file does not hold — something the
   * page's own code built — cannot be written, and writing only part of it would be worse than
   * not writing it: a move out of authored markup into rendered markup would delete the element
   * from the file. So such a change is left out whole, and the target is built again without it.
   */
  const excluded = new Set(input.excluded);
  const unplaced = new Set<string>();
  const writtenOps = journal.written?.ops ?? [];
  const written = new Set(writtenOps);
  const applied = new Set(onPage.map((entry) => entry.ops));
  const rollbackRows = new Map((journal.rolledBack ?? []).map((entry) => [entry.ops, entry.changeIds]));
  const rowsOut = (all: readonly string[]): 'in' | 'out' | 'split' => {
    const ids = input.markupRows ? all.filter((id) => input.markupRows!.has(id)) : all;
    const left = ids.filter((id) => excluded.has(id)).length;
    if (left === 0) return 'in';
    return left === ids.length ? 'out' : 'split';
  };
  const split = ['one edit is listed as several changes, and only some of them are ticked; they can only be written together'];

  /*
   * The page the file should describe, as a sequence of operations from the base.
   *
   * First what the file already holds, in the order it was written: kept while it is still on the
   * page, and for what has since been undone, kept only while its rollback is unticked — or when a
   * save already settled that, so it has no row any more. Then everything on the page the file
   * does not hold yet, unless it is unticked, or was saved without being written: a change that
   * was unticked when it was saved stays out of every later save rather than slipping into one.
   */
  type Planned = { ops: readonly DomOp[]; row: JournalRow | null };
  let wanted: Planned[] = [];
  let target = new TreeView();
  for (let pass = 0; pass < 3; pass += 1) {
    const sequence: Planned[] = [];
    for (const ops of writtenOps) {
      if (applied.has(ops)) {
        sequence.push({ ops, row: null });
        continue;
      }
      const ids = rollbackRows.get(ops);
      if (!ids || !ids.length) {
        sequence.push({ ops, row: null });
        continue;
      }
      const decision = rowsOut(ids);
      if (decision === 'split') return { ok: false, why: split };
      if (decision === 'out') sequence.push({ ops, row: null });
    }
    for (const entry of onPage) {
      if (written.has(entry.ops)) continue;
      if (entry.saved) continue;
      if (!entry.ops.length) continue;
      const decision = entry.changeIds.length ? rowsOut(entry.changeIds) : 'in';
      if (decision === 'split') return { ok: false, why: split };
      if (decision === 'in') sequence.push({ ops: entry.ops, row: entry });
    }
    const everything =
      sequence.length === onPage.filter((entry) => entry.ops.length).length &&
      sequence.every((item) => applied.has(item.ops)) &&
      onPage.every((entry) => !entry.ops.length || sequence.some((item) => item.ops === entry.ops));
    target = everything ? new TreeView() : base.fork();
    if (!everything) {
      for (const item of sequence) for (const op of item.ops) target.replay(op);
      if (target.conflicts.length) {
        return {
          ok: false,
          why: ['a change being written builds on one that is not, so it cannot be written without it'],
        };
      }
    }
    wanted = sequence;
    const created = (node: Node): boolean => !binding.toSource.has(node) && !file.connected(node);
    const reachesFile = (node: Node): boolean => {
      if (inShadowTree(node)) return false;
      for (let at: Node | null = node; at; at = target.parent(at)) {
        if (binding.toSource.has(at)) return true;
        if (at.nodeType === Node.TEXT_NODE) continue;
        if (!created(at)) return false;
      }
      return false;
    };
    let found = false;
    for (const item of wanted) {
      const row = item.row;
      if (!row || !row.changeIds.length || row.changeIds.some((id) => unplaced.has(id))) continue;
      const lands = item.ops.every(
        (op) => (!target.connected(op.target) && !inShadowTree(op.target)) || reachesFile(op.target),
      );
      if (lands) continue;
      for (const id of row.changeIds) {
        unplaced.add(id);
        excluded.add(id);
      }
      found = true;
    }
    if (!found) break;
  }
  const targetOps = wanted.map((item) => item.ops);

  const touchedOps = [...allOps.flat(), ...fileOps.flat()];
  const dirty = collectDirty(touchedOps, file, target);

  // A change has to land on something the file has, or inside something the editor created.
  const why: string[] = [];
  for (const el of styleEdits.keys()) {
    const range = binding.toSource.get(el) ? tree.ranges.get(binding.toSource.get(el)!) : undefined;
    if (!range?.explicitClose) why.push('an edited <style> block could not be found in the file');
  }
  const escalate = (node: Node): void => {
    for (let at = target.parent(node); at; at = target.parent(at)) {
      const source = binding.toSource.get(at);
      const range = source ? tree.ranges.get(source) : undefined;
      if (range && (at.nodeType === Node.DOCUMENT_NODE || range.explicitStart)) {
        dirty.kids.add(at);
        return;
      }
    }
  };
  for (const el of [...dirty.attrs.keys()]) {
    if (!target.connected(el)) continue;
    const source = binding.toSource.get(el);
    const range = source ? tree.ranges.get(source) : undefined;
    if (!source) {
      if (file.connected(el)) dirty.attrs.delete(el);
      continue;
    }
    if (!range?.explicitStart) escalate(el);
  }
  for (const node of [...dirty.text]) {
    if (!target.connected(node)) continue;
    const source = binding.toSource.get(node);
    if (!source || !tree.ranges.get(source)) escalate(node);
  }
  for (const node of [...dirty.kids]) {
    if (!target.connected(node)) continue;
    const source = binding.toSource.get(node);
    const range = source ? tree.ranges.get(source) : undefined;
    if (!source) continue;
    if (!range || (node.nodeType === Node.ELEMENT_NODE && !range.explicitStart)) escalate(node);
  }
  if (why.length) return { ok: false, why };
  markTouched(dirty, target, styleEdits);
  for (const node of dirty.touched) {
    if (!binding.uncertain.has(node)) continue;
    return {
      ok: false,
      why: [
        `the page's own code has changed the ${describe(node)} being edited and its neighbours, so where it is in the file cannot be told for certain`,
      ],
    };
  }

  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const keep = new Set(input.keep ?? []);
  /*
   * Emit, read back, and when that does not match, find out why before trying again.
   *
   * Either the page holds something HTML cannot express — a block inside a paragraph, a link
   * inside a link — and no file can hold it, which is said in those words. Or the minimal patch of
   * one container did not come out right, and only that container is written again: first every
   * child in order, then from the page alone. Never more than the container that failed, and the
   * result is checked again every time.
   */
  const forced = new Map<Node, 'all' | 'pure'>();
  let failure = 'the result did not read back as the page shows it';
  for (let attempt = 0; attempt < 16; attempt += 1) {
    for (const node of forced.keys()) {
      for (let at: Node | null = node; at && !dirty.touched.has(at); at = target.parent(at)) dirty.touched.add(at);
    }
    const emitter = new Emitter({
      source, tree, binding, file, target, dirty, keep, styleEdits, eol, forced,
      strict: attempt > 0,
    });
    const { text, exp } = emitter.run(root);
    if (emitter.why.length) return { ok: false, why: emitter.why };
    const parsed = new DOMParser().parseFromString(text, 'text/html');
    const mismatch = sameShape(fromNode(parsed)!, fromExpected(exp, binding.toLive)!, '', null);
    if (!mismatch) {
      return {
        ok: true,
        html: text,
        ops: targetOps,
        stranded: strandedChanges(
          wanted.flatMap((item) => (item.row ? [item.row] : [])),
          target,
        ),
        unplaced,
      };
    }
    failure = `the edited markup would not read back as the page shows it (${mismatch.message})`;

    /*
     * Ask the parser about every child of the container that did not read back, not only the one
     * the comparison stopped at: a paragraph holding a block is reported one level up, as the
     * container having more children than it should.
     */
    const where = mismatch.parent;
    if (where instanceof Element && where.isConnected) {
      const suspects = mismatch.child ? [mismatch.child, ...liveKids(target, where)] : liveKids(target, where);
      for (const kid of suspects) {
        if (kid.nodeType === Node.TEXT_NODE && !(kid as Text).data.trim()) continue;
        const offender = inexpressibleAt(where, kid);
        if (offender) return { ok: false, why: [offender.message] };
      }
    }
    let container: Node | null = where;
    while (container && !binding.toSource.has(container)) container = target.parent(container);
    if (!container) break;
    const level = forced.get(container);
    const top = container.nodeType === Node.DOCUMENT_NODE || (container as Element).localName === 'html';
    if (!level) {
      forced.set(container, 'all');
    } else if (level === 'all' && !top) {
      forced.set(container, 'pure');
    } else {
      const up = target.parent(container);
      if (!up || up.nodeType === Node.DOCUMENT_NODE) break;
      if (!forced.has(up)) forced.set(up, 'all');
      else if (forced.get(up) === 'all' && (up as Element).localName !== 'html') forced.set(up, 'pure');
      else break;
    }
  }
  return { ok: false, why: [failure] };
}
