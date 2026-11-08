// Minimal ZIP writer (docs/SPEC.md §9.5): local file headers + central directory + EOCD,
// UTF-8 name flag, no zip64. New code, no dependency: the sizes Design Chamber exports
// (≤ 100 MB designs, files far below 4 GB) never need zip64; anything that would is refused
// instead of corrupted.
//
// The archive is written to a file entry by entry (positional writes), so memory peaks at the
// largest single file, not the design. Nothing here blocks the service's only thread for long:
// the CRC runs in 8 MiB slices that yield to the event loop, and deflate is the async zlib
// call, which runs on the libuv threadpool.

import { open, type FileHandle } from 'node:fs/promises';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

/** One file of the archive. `name` uses `/` separators and is written as UTF-8. */
export type ZipSource = {
  name: string;
  /** What messages call the file when it differs from `name` (the design-relative path, not the archive path). */
  label?: string;
  /** The file's bytes, or `null` when it vanished (the entry is skipped). */
  read: () => Promise<Buffer | null>;
};

export type WriteZipOptions = {
  now?: Date;
  /** Per-entry size cap; default `ZIP_ENTRY_MAX_BYTES`. A test seam. */
  maxEntryBytes?: number;
};

/** The largest single file the writer accepts (it is held in memory once, then deflated). */
export const ZIP_ENTRY_MAX_BYTES = 512 * 1024 * 1024;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Version needed to extract: 2.0 (deflate). */
const VERSION_NEEDED = 20;
/** Version made by: 2.0, FAT/unknown host (0), which keeps `\` out of the semantics. */
const VERSION_MADE_BY = 20;
/** General purpose flag bit 11: names are UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const ZIP64_LIMIT = 0xffffffff;
/** The EOCD counts entries in 16 bits; more needs zip64. */
const MAX_ENTRIES = 0xffff;
const DEFLATE_LEVEL = 6;
const CRC_SLICE_BYTES = 8 * 1024 * 1024;

/** Formats the compressor cannot shrink: stored without trying (saves a threadpool round trip per file). */
const ALREADY_COMPRESSED = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'woff', 'woff2', 'mp4', 'webm', 'mp3', 'zip', 'gz', 'br']);

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** The table-driven CRC-32, kept for runtimes without `zlib.crc32` (and as the test oracle). `previous` continues a running value. */
export const crc32Portable = (data: Uint8Array, previous = 0): number => {
  let crc = ~previous;
  for (let i = 0; i < data.length; i += 1) crc = (crc >>> 8) ^ (crcTable[(crc ^ (data[i] ?? 0)) & 0xff] ?? 0);
  return ~crc >>> 0;
};

/**
 * CRC-32 (IEEE, as ZIP specifies) over `data`; pass the previous result as `previous` to continue
 * across slices. Native when the runtime has it (Node ≥ 22.2), chosen once at load.
 */
export const crc32: (data: Uint8Array, previous?: number) => number =
  typeof zlib.crc32 === 'function' ? (data, previous = 0) => zlib.crc32(data, previous) : crc32Portable;

const deflateRawAsync = promisify(zlib.deflateRaw);

/** MS-DOS time/date pair for a timestamp (ZIP has no timezone; local time is conventional). */
const dosDateTime = (date: Date): { time: number; day: number } => {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export const entryTooLargeSentence = (name: string, limitBytes: number = ZIP_ENTRY_MAX_BYTES): string =>
  `${name} is over ${Math.round(limitBytes / (1024 * 1024))} MB, which is too large to put in a ZIP. Move it out of the design folder and try again.`;

const TOO_LARGE_SENTENCE = 'This export is too large for a ZIP file.';

const isStoredByExtension = (name: string): boolean => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && ALREADY_COMPRESSED.has(name.slice(dot + 1).toLowerCase());
};

/** CRC in slices, yielding to the event loop between them so a big file never holds the thread. */
const crc32Sliced = async (data: Uint8Array): Promise<number> => {
  let crc = 0;
  for (let start = 0; start < data.length; start += CRC_SLICE_BYTES) {
    crc = crc32(data.subarray(start, Math.min(start + CRC_SLICE_BYTES, data.length)), crc);
    if (start + CRC_SLICE_BYTES < data.length) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return crc;
};

/** Positional write of the whole buffer (FileHandle.write may write less than asked). */
const writeAt = async (handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> => {
  let done = 0;
  while (done < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, done, bytes.length - done, position + done);
    done += bytesWritten;
  }
};

/**
 * Write the archive to `target` (created with `wx`: an existing file is never overwritten),
 * entries in the given order. A duplicate or empty name, an oversized file or anything needing
 * zip64 throws `ZipError` before that entry is written; on any error the handle is closed and
 * the error rethrown, and the caller removes the partial file.
 */
export const writeZipFile = async (
  target: string,
  sources: readonly ZipSource[],
  options: WriteZipOptions = {},
): Promise<{ bytes: number; entries: number }> => {
  const { time, day } = dosDateTime(options.now ?? new Date());
  const maxEntryBytes = options.maxEntryBytes ?? ZIP_ENTRY_MAX_BYTES;
  const handle = await open(target, 'wx');
  try {
    const centrals: Buffer[] = [];
    const seen = new Set<string>();
    let position = 0;

    for (const source of sources) {
      if (source.name.length === 0 || seen.has(source.name)) throw new ZipError(`Bad or duplicate ZIP entry name: "${source.name}".`);
      seen.add(source.name);
      const data = await source.read();
      if (data === null) continue;
      if (data.length > maxEntryBytes) throw new ZipError(entryTooLargeSentence(source.label ?? source.name, maxEntryBytes));

      const crc = await crc32Sliced(data);
      let payload: Buffer = data;
      let method = METHOD_STORE;
      if (data.length > 0 && !isStoredByExtension(source.name)) {
        const deflated = await deflateRawAsync(data, { level: DEFLATE_LEVEL });
        if (deflated.length < data.length) {
          payload = deflated;
          method = METHOD_DEFLATE;
        }
      }
      if (payload.length > ZIP64_LIMIT || data.length > ZIP64_LIMIT || position > ZIP64_LIMIT || centrals.length >= MAX_ENTRIES) {
        throw new ZipError(TOO_LARGE_SENTENCE);
      }

      const name = Buffer.from(source.name, 'utf8');
      const local = Buffer.alloc(30 + name.length);
      local.writeUInt32LE(LOCAL_SIG, 0);
      local.writeUInt16LE(VERSION_NEEDED, 4);
      local.writeUInt16LE(FLAG_UTF8, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(day, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(payload.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      name.copy(local, 30);

      const central = Buffer.alloc(46 + name.length);
      central.writeUInt32LE(CENTRAL_SIG, 0);
      central.writeUInt16LE(VERSION_MADE_BY, 4);
      central.writeUInt16LE(VERSION_NEEDED, 6);
      central.writeUInt16LE(FLAG_UTF8, 8);
      central.writeUInt16LE(method, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(day, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(payload.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(name.length, 28);
      // extra (30), comment (32), disk (34), internal attrs (36), external attrs (38) stay 0.
      central.writeUInt32LE(position, 42);
      name.copy(central, 46);

      await writeAt(handle, local, position);
      await writeAt(handle, payload, position + local.length);
      position += local.length + payload.length;
      centrals.push(central); // each record carries its name, so the entry count is the array length
    }

    const centralBuffer = Buffer.concat(centrals);
    if (centralBuffer.length > ZIP64_LIMIT || position + centralBuffer.length > ZIP64_LIMIT) throw new ZipError(TOO_LARGE_SENTENCE);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    // disk numbers (4, 6) stay 0.
    eocd.writeUInt16LE(centrals.length, 8);
    eocd.writeUInt16LE(centrals.length, 10);
    eocd.writeUInt32LE(centralBuffer.length, 12);
    eocd.writeUInt32LE(position, 16);
    eocd.writeUInt16LE(0, 20);
    await writeAt(handle, centralBuffer, position);
    await writeAt(handle, eocd, position + centralBuffer.length);
    return { bytes: position + centralBuffer.length + eocd.length, entries: centrals.length };
  } finally {
    await handle.close();
  }
};
