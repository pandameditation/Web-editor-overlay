import { prettifyClassName } from './classes.js';
import { parseDesignSystem } from './design-system.js';
import { prettifyTokenName } from './tokens.js';
import type {
  DesignClass,
  DesignRule,
  DesignSystemDocument,
  DesignToken,
  LibraryBlock,
} from './types.js';

/**
 * Design systems as a single copy-pasteable string.
 *
 * A design system file is the right thing to keep in a repository and the wrong
 * thing to move between pages: it means finding a place to host it, a URL that
 * resolves from wherever the editor is running, and a fetch that can fail. The
 * common case is far smaller than that — "give this page the same tokens, classes
 * and components as that one" — and it wants an answer you can paste.
 *
 * A seed is that answer: the whole document, compacted and compressed, as one
 * URL-safe token. It goes anywhere a string goes — a `data-` attribute, a Vite
 * config, a `mount()` call, a chat message — and carries no dependency on a file
 * still being there when the page loads.
 *
 * Format: `heo1` + a codec letter + `.` + base64url.
 *
 *   heo1z.<base64url>   raw DEFLATE, then base64url
 *   heo1p.<base64url>   base64url of the JSON, for platforms without CompressionStream
 *
 * The version leads so the prefix can be matched before anything is decoded, and
 * so a future format is a different prefix rather than a guess. base64url — no
 * `+`, `/` or `=` — because the string has to survive an HTML attribute, a query
 * parameter and a JSON literal without escaping, and because it stays one
 * double-clickable word in an editor.
 */

export const SEED_VERSION = 'heo1';

/** Compressed and plain codecs, in the order the encoder prefers them. */
const DEFLATE_PREFIX = `${SEED_VERSION}z.`;
const PLAIN_PREFIX = `${SEED_VERSION}p.`;

/** True when the text looks like a seed rather than JSON or a path. */
export function isSeed(text: string): boolean {
  return /^heo\d+[a-z]\./.test(text.trim());
}

/**
 * Everything the target page cannot work out for itself, and nothing else.
 *
 * Three kinds of weight come off here. Provenance (`origin`) is about where the
 * data came from in *this* session, which is not true of the page importing it —
 * and dropping it is not only smaller but more correct, since the import marks
 * everything `imported`. Labels are derived from names, so any label that matches
 * what the target would generate anyway is noise. And `createdAt`/`$schema` are
 * rebuilt on the way in.
 *
 * Dropping `origin: 'stylesheet'` has a second, deliberate effect: those tokens
 * arrive as ones the overlay owns, so the target page emits them as real CSS. A
 * seed has to stand on its own — the page receiving it may not have the
 * stylesheet the tokens were read from.
 */
export function compactDesignSystem(doc: DesignSystemDocument): DesignSystemDocument {
  const tokens = doc.tokens.map((token) => {
    const next: DesignToken = { name: token.name, value: token.value, group: token.group };
    if (token.label && token.label !== prettifyTokenName(token.name)) next.label = token.label;
    if (token.description) next.description = token.description;
    return next;
  });

  const classes = doc.classes.map((entry) => {
    const next: DesignClass = { name: entry.name, declarations: entry.declarations };
    if (entry.label && entry.label !== prettifyClassName(entry.name)) next.label = entry.label;
    if (entry.description) next.description = entry.description;
    return next;
  });

  /*
   * Rules keep their order, and their order is the only thing about them that is not
   * self-evident from the selector.
   *
   * `map` rather than anything that sorts or dedupes: two rules of equal specificity are
   * decided by which comes last, so a seed that reordered them would land a page looking
   * different from the one it was taken from. No label is derived from a selector, so
   * unlike the two above there is nothing to strip as redundant.
   */
  const rules = (doc.rules ?? []).map((entry) => {
    const next: DesignRule = { selector: entry.selector, declarations: entry.declarations };
    if (entry.label) next.label = entry.label;
    if (entry.description) next.description = entry.description;
    return next;
  });

  // Blocks are the bulk of any real seed, so every optional field is dropped when
  // it is empty rather than carried as `null`.
  const blocks = doc.blocks.map((block) => {
    const next = { id: block.id, name: block.name, kind: block.kind, html: block.html } as LibraryBlock;
    if (block.description) next.description = block.description;
    if (block.category) next.category = block.category;
    if (block.props && Object.keys(block.props).length) next.props = block.props;
    if (block.css) next.css = block.css;
    if (block.icon) next.icon = block.icon;
    if (block.slots) next.slots = block.slots;
    if (block.element?.tag) {
      next.element = {
        tag: block.element.tag,
        ...(block.element.module ? { module: block.element.module } : {}),
        ...(!block.element.module && block.element.script ? { script: block.element.script } : {}),
      };
    }
    return next;
  });

  // `rules` is omitted entirely when there are none, rather than carried as `[]`. Every
  // page without a rule would otherwise pay four characters for saying so, and the
  // parser already defaults a missing key.
  return {
    name: doc.name,
    version: doc.version,
    tokens,
    classes,
    blocks,
    ...(rules.length ? { rules } : {}),
  };
}

/**
 * Encode a document as a seed.
 *
 * Async because compression is: `CompressionStream` is the platform's deflate and
 * it is stream-shaped. Worth the await — the payload is repetitive CSS and markup,
 * which deflates several times over, and the difference decides whether the result
 * is something you would paste into a file by hand.
 */
export async function encodeSeed(doc: DesignSystemDocument): Promise<string> {
  const json = JSON.stringify(compactDesignSystem(doc));
  const bytes = new TextEncoder().encode(json);
  const deflated = await deflate(bytes);
  return deflated
    ? `${DEFLATE_PREFIX}${toBase64Url(deflated)}`
    : `${PLAIN_PREFIX}${toBase64Url(bytes)}`;
}

/**
 * Decode a seed, or plain JSON, without waiting.
 *
 * Returns null when the input is a compressed seed, which cannot be decoded
 * synchronously — the caller then has the choice between awaiting `decodeSeed`
 * and doing something else first. Having both shapes matters because the seed is
 * applied during mount: a plain seed or a JSON document lands before the first
 * paint, and only the compressed case has to arrive a tick later.
 *
 * Throws on malformed input, like `parseDesignSystem` does. An unreadable seed is
 * a mistake worth reporting, not something to swallow.
 */
export function decodeSeedSync(text: string): DesignSystemDocument | null {
  const raw = text.trim();
  if (!isSeed(raw)) return parseDesignSystem(raw);
  if (raw.startsWith(PLAIN_PREFIX)) {
    return parseDesignSystem(new TextDecoder().decode(fromBase64Url(raw.slice(PLAIN_PREFIX.length))));
  }
  if (raw.startsWith(DEFLATE_PREFIX)) return null;
  throw new TypeError(
    `Unknown seed format "${raw.slice(0, raw.indexOf('.') + 1)}". This seed was made by a newer version of the editor.`,
  );
}

/** Decode a seed or plain JSON, decompressing when it has to. */
export async function decodeSeed(text: string): Promise<DesignSystemDocument> {
  const raw = text.trim();
  const immediate = decodeSeedSync(raw);
  if (immediate) return immediate;

  const bytes = fromBase64Url(raw.slice(DEFLATE_PREFIX.length));
  const inflated = await inflate(bytes);
  if (!inflated) {
    throw new TypeError(
      'This seed is compressed and this browser cannot decompress it. Export it again as a design system file.',
    );
  }
  return parseDesignSystem(new TextDecoder().decode(inflated));
}

/* -------------------------------------------------------------------------- */
/* What is in a seed, for the UI that hands it over                            */
/* -------------------------------------------------------------------------- */

export interface SeedStats {
  tokens: number;
  classes: number;
  rules: number;
  blocks: number;
  /** Characters in the seed, which is what a paste target has to hold. */
  length: number;
  /** `1.2 kB`, for a line of copy. */
  size: string;
  /** How much smaller than the pretty-printed file it replaces. */
  saved: string;
  /** True once the seed is long enough that an attribute is the wrong home. */
  bulky: boolean;
}

/** An attribute past this is unreadable in a hand-edited file, so stop suggesting one. */
const ATTRIBUTE_BUDGET = 1600;

export function seedStats(doc: DesignSystemDocument, seed: string): SeedStats {
  const file = JSON.stringify(doc, null, 2).length;
  const ratio = file > 0 ? 1 - seed.length / file : 0;
  return {
    tokens: doc.tokens.length,
    classes: doc.classes.length,
    rules: doc.rules?.length ?? 0,
    blocks: doc.blocks.length,
    length: seed.length,
    size: formatBytes(seed.length),
    saved: ratio > 0.05 ? `${Math.round(ratio * 100)}% smaller than the file` : '',
    bulky: seed.length > ATTRIBUTE_BUDGET,
  };
}

export function formatBytes(count: number): string {
  if (count < 1000) return `${count} B`;
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)} kB`;
}

/* -------------------------------------------------------------------------- */
/* Paste-ready snippets                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Where a seed is going, which is what decides how it should be written.
 *
 * A seed on its own is only half an answer: knowing the string does not tell you
 * whether it belongs in an attribute, a config object or a script block, and
 * getting that wrong is the most likely way to lose ten minutes. Each target
 * therefore hands back the exact line to paste.
 */
export type SeedTarget = 'attribute' | 'block' | 'vite' | 'mount';

export interface SeedSnippet {
  id: SeedTarget;
  label: string;
  language: 'html' | 'js';
  /** One line on what this is for, shown under the picker. */
  note: string;
  code: string;
}

export interface SnippetOptions {
  /** Path the page would load the bundle from, for the script-tag snippets. */
  bundle?: string;
}

export function seedSnippets(seed: string, options: SnippetOptions = {}): SeedSnippet[] {
  const bundle = options.bundle ?? './html-editor-overlay.iife.js';
  return [
    {
      id: 'attribute',
      label: 'Script tag',
      language: 'html',
      note: 'One tag, no build step. The whole system rides along in the attribute.',
      code: `<script src="${bundle}" data-heo data-seed="${seed}"></script>`,
    },
    {
      id: 'block',
      label: 'Seed block',
      language: 'html',
      note: 'Same thing for a longer seed: a block wraps and stays readable where an attribute would not.',
      code: [
        `<script type="application/heo-seed">`,
        seed,
        `</script>`,
        `<script src="${bundle}" data-heo></script>`,
      ].join('\n'),
    },
    {
      id: 'vite',
      label: 'Vite plugin',
      language: 'js',
      note: 'Every page the dev server builds starts from this system.',
      code: [
        `import editorOverlay from 'html-editor-overlay/vite';`,
        ``,
        `export default {`,
        `  plugins: [`,
        `    editorOverlay({`,
        `      designSystem: '${seed}',`,
        `    }),`,
        `  ],`,
        `};`,
      ].join('\n'),
    },
    {
      id: 'mount',
      label: 'mount()',
      language: 'js',
      note: 'For an app that mounts the overlay itself.',
      code: [
        `import { mount } from 'html-editor-overlay';`,
        ``,
        `mount({`,
        `  seed: '${seed}',`,
        `});`,
      ].join('\n'),
    },
  ];
}

/** Which snippet to open on: an attribute, until the seed outgrows one. */
export function recommendedTarget(stats: SeedStats): SeedTarget {
  return stats.bulky ? 'block' : 'attribute';
}

/* -------------------------------------------------------------------------- */
/* Codec plumbing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Raw DEFLATE, or null where the platform has no `CompressionStream`.
 *
 * `deflate-raw` rather than `deflate` or `gzip`: the seed carries its own version
 * prefix, so a zlib header or a gzip envelope would be bytes spent restating what
 * the prefix already says.
 */
/**
 * Bytes backed by a plain `ArrayBuffer`.
 *
 * Spelt out because the stream APIs will not take the `SharedArrayBuffer` case
 * that a bare `Uint8Array` now admits, and every buffer here is one we allocated.
 */
type Bytes = Uint8Array<ArrayBuffer>;

async function deflate(bytes: Bytes): Promise<Bytes | null> {
  const Stream = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (typeof Stream !== 'function') return null;
  try {
    return await pump(new Stream('deflate-raw'), bytes);
  } catch {
    return null;
  }
}

async function inflate(bytes: Bytes): Promise<Bytes | null> {
  const Stream = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (typeof Stream !== 'function') return null;
  return pump(new Stream('deflate-raw'), bytes);
}

/** Push one buffer through a transform stream and collect the result. */
async function pump(
  stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
  bytes: Bytes,
): Promise<Bytes> {
  const writer = stream.writable.getWriter();
  // Not awaited before reading: a transform stream's writable side can block
  // until the readable side is drained, so awaiting the write first deadlocks on
  // any payload larger than the internal queue.
  const written = writer.write(bytes).then(() => writer.close());
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.readable.getReader();
  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function toBase64Url(bytes: Bytes): string {
  let binary = '';
  // In chunks, because spreading a large array into `apply` overflows the stack.
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Bytes {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  } catch {
    throw new TypeError('This seed is damaged — it is not valid base64. Copy it again in full.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}
