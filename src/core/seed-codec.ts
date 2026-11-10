/**
 * The seed's byte codec, on its own so a bundle can encode a seed without the design-system parser.
 *
 * `seed.ts` owns the format and the document handling; this is only DEFLATE and base64url. The
 * capture bundle injected by the browser extension builds its one-block document itself and
 * needs nothing else from `seed.ts`, whose parser pulls in most of the CSS engine.
 */

export const SEED_VERSION = 'heo1';
export const DEFLATE_PREFIX = `${SEED_VERSION}z.`;
export const PLAIN_PREFIX = `${SEED_VERSION}p.`;

/** A document's JSON as a seed: compressed where the platform can, plain otherwise. */
export async function encodeSeedJson(json: string): Promise<string> {
  const bytes = new TextEncoder().encode(json);
  const deflated = await deflate(bytes);
  return deflated ? `${DEFLATE_PREFIX}${toBase64Url(deflated)}` : `${PLAIN_PREFIX}${toBase64Url(bytes)}`;
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
export type Bytes = Uint8Array<ArrayBuffer>;

export async function deflate(bytes: Bytes): Promise<Bytes | null> {
  const Stream = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (typeof Stream !== 'function') return null;
  try {
    return await pump(new Stream('deflate-raw'), bytes);
  } catch {
    return null;
  }
}

export async function inflate(bytes: Bytes): Promise<Bytes | null> {
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

export function toBase64Url(bytes: Bytes): string {
  let binary = '';
  // In chunks, because spreading a large array into `apply` overflows the stack.
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Bytes {
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
