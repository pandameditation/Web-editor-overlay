/**
 * A zip file, written from the browser.
 *
 * Needed for one reason: a page whose assets stay external cannot be handed over as a
 * single download. `index.html` plus `css/theme.css` plus `img/hero.png` is a directory,
 * and the only shape a browser can hand a directory to someone in is an archive.
 *
 * Written here rather than taken as a dependency because the part of the format this
 * needs is small and completely specified, while a zip library is a large amount of code
 * for the half of it that reads archives — which nothing here does. What follows is the
 * subset PKWARE's APPNOTE calls a "basic" archive: one local header per member, a central
 * directory, and an end-of-central-directory record. No zip64, no encryption, no
 * multi-disk, no data descriptors.
 *
 * Compression is the platform's, through the same `deflate-raw` transform `seed.ts` uses
 * for design-system seeds — method 8 in the format is exactly raw deflate, so there is
 * nothing to adapt. Where the platform does not offer it, members are stored uncompressed
 * (method 0), which every unzip tool in existence reads. A bigger file is a worse outcome
 * than a smaller one and a far better outcome than no file.
 */

/**
 * Bytes backed by a plain `ArrayBuffer`.
 *
 * The same alias `seed.ts` uses, for the same reason: `Uint8Array` defaults to
 * `ArrayBufferLike`, which admits a `SharedArrayBuffer`, and the stream APIs will not take
 * one. Naming the narrower type here is cheaper than casting at every boundary.
 */
type Bytes = Uint8Array<ArrayBuffer>;

/** One member of the archive. */
export interface ZipEntry {
  /** Path inside the archive, POSIX-separated and relative: `css/theme.css`. */
  path: string;
  bytes: Bytes;
  /**
   * Modification time to stamp, defaulting to now.
   *
   * Worth accepting rather than hardcoding: a caller writing a deterministic archive for
   * a test wants the same bytes twice, and the timestamp is the only thing that would
   * otherwise vary.
   */
  modified?: Date;
}

/**
 * Build the archive.
 *
 * Every member is deflated where the platform can, and stored where it cannot — decided
 * per member, because the result is per member: a compressed payload larger than its
 * input is kept as the input, which happens with anything already compressed. A PNG
 * deflates to slightly more than itself, and paying that on every image in a page adds up.
 */
export async function makeZip(entries: readonly ZipEntry[]): Promise<Blob> {
  const locals: Bytes[] = [];
  const central: Bytes[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encodeName(entry.path);
    const crc = crc32(entry.bytes);
    const stamp = dosStamp(entry.modified ?? new Date());

    const deflated = await deflate(entry.bytes);
    // Only worth it when it is actually smaller. Already-compressed bytes deflate to
    // slightly more than themselves, and storing those is both faster and smaller.
    const compress = deflated !== null && deflated.length < entry.bytes.length;
    const payload = compress ? (deflated as Bytes) : entry.bytes;
    const method = compress ? 8 : 0;

    const header = new Uint8Array(30 + name.length);
    const head = new DataView(header.buffer);
    head.setUint32(0, 0x04034b50, true); // local file header signature
    head.setUint16(4, 20, true); // version needed: 2.0, the floor for deflate
    head.setUint16(6, 0x0800, true); // flags: bit 11, names are UTF-8
    head.setUint16(8, method, true);
    head.setUint16(10, stamp.time, true);
    head.setUint16(12, stamp.date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, payload.length, true);
    head.setUint32(22, entry.bytes.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true); // extra field length
    header.set(name, 30);

    locals.push(header, payload);

    const record = new Uint8Array(46 + name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true); // central directory header signature
    view.setUint16(4, 20, true); // version made by
    view.setUint16(6, 20, true); // version needed
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, method, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, payload.length, true);
    view.setUint32(24, entry.bytes.length, true);
    view.setUint16(28, name.length, true);
    view.setUint16(30, 0, true); // extra
    view.setUint16(32, 0, true); // comment
    view.setUint16(34, 0, true); // disk number
    view.setUint16(36, 0, true); // internal attributes
    // External attributes: `0o644 << 16` marks it a regular readable file on unix, which
    // is what stops an extracted asset arriving without read permission on some tools.
    view.setUint32(38, 0o644 << 16, true);
    view.setUint32(42, offset, true);
    record.set(name, 46);
    central.push(record);

    offset += header.length + payload.length;
  }

  const directory = concat(central);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true); // end of central directory signature
  tail.setUint16(4, 0, true); // this disk
  tail.setUint16(6, 0, true); // disk with the directory
  tail.setUint16(8, entries.length, true);
  tail.setUint16(10, entries.length, true);
  tail.setUint32(12, directory.length, true);
  tail.setUint32(16, offset, true);
  tail.setUint16(20, 0, true); // comment length

  return new Blob([concat(locals), directory, end], { type: 'application/zip' });
}

/* -------------------------------------------------------------------------- */
/* The pieces                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Names are UTF-8, and flag bit 11 says so.
 *
 * Without the flag the name is interpreted as IBM code page 437, which mangles anything
 * outside ASCII — a file called `café.css` extracts as `cafÃ©.css`. Backslashes are
 * normalised because the format wants forward ones, and a leading slash is dropped: an
 * absolute path in an archive is what makes some tools refuse to extract it.
 */
function encodeName(path: string): Bytes {
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return new TextEncoder().encode(clean);
}

/**
 * CRC-32, the checksum the format requires.
 *
 * There is no platform primitive for this, so it is the one piece of algorithm here. The
 * table is built once on first use rather than at module load — a page that never exports
 * an archive should not pay for it.
 */
let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  const next = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    next[n] = value >>> 0;
  }
  table = next;
  return next;
}

export function crc32(bytes: Bytes): number {
  const lookup = crcTable();
  let crc = 0xffffffff;
  for (let at = 0; at < bytes.length; at += 1) {
    crc = lookup[(crc ^ bytes[at]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date and time, which is what the format stores.
 *
 * Two-second resolution and an epoch of 1980, both inherent to the format rather than a
 * simplification. Anything earlier is clamped, since the fields cannot express it.
 */
function dosStamp(when: Date): { date: number; time: number } {
  const year = Math.max(1980, when.getFullYear());
  const date =
    (((year - 1980) & 0x7f) << 9) | (((when.getMonth() + 1) & 0x0f) << 5) | (when.getDate() & 0x1f);
  const time =
    ((when.getHours() & 0x1f) << 11) |
    ((when.getMinutes() & 0x3f) << 5) |
    ((when.getSeconds() >> 1) & 0x1f);
  return { date, time };
}

function concat(parts: readonly Bytes[]): Bytes {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Raw deflate, or null when the platform has no such thing.
 *
 * The same transform `seed.ts` compresses design systems with, and the same reason for
 * the null: `CompressionStream` is widely available but not universal, and an export that
 * throws where it could have produced a larger file is the wrong trade.
 */
async function deflate(bytes: Bytes): Promise<Bytes | null> {
  const Stream = (globalThis as { CompressionStream?: typeof CompressionStream })
    .CompressionStream;
  if (typeof Stream !== 'function') return null;
  try {
    return await pump(new Stream('deflate-raw'), bytes);
  } catch {
    return null;
  }
}

/**
 * Push one buffer through a transform stream and collect the result.
 *
 * Lifted from `seed.ts`, including the detail that makes it work: the write is not awaited
 * before reading starts. A transform stream's writable side can block until its readable
 * side is drained, so awaiting the write first deadlocks on any payload larger than the
 * internal queue — which for an image is every payload.
 */
async function pump(
  stream: { readable: ReadableStream<Bytes>; writable: WritableStream<BufferSource> },
  bytes: Bytes,
): Promise<Bytes> {
  const writer = stream.writable.getWriter();
  const written = writer.write(bytes).then(() => writer.close());
  const chunks: Bytes[] = [];
  const reader = stream.readable.getReader();
  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await written;
  return concat(chunks);
}
