// Stack PNG strips into one picture (documentation/specs/system-board-layout-and-visual-check.md §B.4,
// overviews). The visual system check captures each 900px band of a board area at a reduced scale in
// the browser; this joins the strips top to bottom into the area's overview image. Pure Node (zlib
// only), no dependency. It reads only what Chrome's encoder writes (8-bit RGB or RGBA, not
// interlaced) and refuses anything else, and every size is bounded before a buffer is allocated.

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The largest side a strip or the stitched picture may have (a 4 000px overview is far inside it). */
export const PNG_STITCH_SIDE_MAX = 16_384;
/** Raw pixels of the stitched picture, bounding the memory one overview takes (≤ 80 MB as RGBA; an overview is about 3 MP). */
export const PNG_STITCH_PIXELS_MAX = 20_000_000;

export class PngStitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngStitchError';
  }
}

export type DecodedPng = { width: number; height: number; channels: 3 | 4; rows: Buffer[] };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode one PNG into rows of raw pixels. Throws `PngStitchError` for anything outside the supported shape. */
export const decodePng = (png: Buffer): DecodedPng => {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) throw new PngStitchError('Not a PNG.');
  let at = 8;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 3;
  const data: Buffer[] = [];
  let sawHeader = false;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const start = at + 8;
    const end = start + length;
    if (end + 4 > png.length) throw new PngStitchError('A PNG chunk runs past the end of the file.');
    if (type === 'IHDR') {
      if (length !== 13) throw new PngStitchError('Bad PNG header.');
      width = png.readUInt32BE(start);
      height = png.readUInt32BE(start + 4);
      const depth = png[start + 8];
      const colour = png[start + 9];
      const interlace = png[start + 12];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new PngStitchError('Only 8-bit RGB or RGBA PNGs without interlacing are read.');
      if (width < 1 || height < 1 || width > PNG_STITCH_SIDE_MAX || height > PNG_STITCH_SIDE_MAX) throw new PngStitchError('The PNG is too large to read.');
      channels = colour === 6 ? 4 : 3;
      sawHeader = true;
    } else if (type === 'IDAT') {
      data.push(png.subarray(start, end));
    } else if (type === 'IEND') {
      break;
    }
    at = end + 4;
  }
  if (!sawHeader) throw new PngStitchError('Bad PNG header.');
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (width * height > PNG_STITCH_PIXELS_MAX) throw new PngStitchError('The PNG is too large to read.');
  let raw: Buffer;
  try {
    // Bounded: a deflate stream that would grow past the expected size stops there instead of filling memory.
    raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  } catch {
    throw new PngStitchError('The PNG data could not be read.');
  }
  if (raw.length !== expected) throw new PngStitchError('The PNG data has the wrong size.');
  const rows: Buffer[] = [];
  let previous: Buffer = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (stride + 1);
    const filter = raw[offset];
    const line = Buffer.from(raw.subarray(offset + 1, offset + 1 + stride));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0;
      const value = line[x] ?? 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          line[x] = (value + left) & 0xff;
          break;
        case 2:
          line[x] = (value + up) & 0xff;
          break;
        case 3:
          line[x] = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          line[x] = (value + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new PngStitchError('Unknown PNG row filter.');
      }
    }
    rows.push(line);
    previous = line;
  }
  return { width, height, channels, rows };
};

/** Encode rows as an 8-bit RGB or RGBA PNG (the Up filter on every row: screenshots compress well with it). */
export const encodePng = (image: DecodedPng): Buffer => {
  const stride = image.width * image.channels;
  const raw = Buffer.alloc((stride + 1) * image.height);
  let previous: Buffer = Buffer.alloc(stride);
  image.rows.forEach((row, y) => {
    const offset = y * (stride + 1);
    raw[offset] = 2;
    for (let x = 0; x < stride; x += 1) raw[offset + 1 + x] = ((row[x] ?? 0) - (previous[x] ?? 0)) & 0xff;
    previous = row;
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = image.channels === 4 ? 6 : 2;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
};

/**
 * One picture from strips stacked top to bottom. Every strip is cut or padded (white) to the first
 * strip's width and turned into its channel count, so a strip one pixel narrower after rounding never
 * shifts the rows. Throws `PngStitchError` when a strip can't be read or the result would be too large.
 */
export const stitchPngs = (strips: readonly Buffer[]): Buffer => {
  if (strips.length === 0) throw new PngStitchError('No strips to stitch.');
  const decoded = strips.map(decodePng);
  const first = decoded[0];
  if (first === undefined) throw new PngStitchError('No strips to stitch.');
  const { width, channels } = first;
  const height = decoded.reduce((sum, strip) => sum + strip.height, 0);
  if (height > PNG_STITCH_SIDE_MAX || width * height > PNG_STITCH_PIXELS_MAX) throw new PngStitchError('The stitched picture would be too large.');
  const rows: Buffer[] = [];
  for (const strip of decoded) {
    for (const row of strip.rows) {
      const out = Buffer.alloc(width * channels, 0xff);
      const shared = Math.min(width, strip.width);
      for (let x = 0; x < shared; x += 1) {
        for (let c = 0; c < 3; c += 1) out[x * channels + c] = row[x * strip.channels + c] ?? 0xff;
        if (channels === 4) out[x * 4 + 3] = strip.channels === 4 ? (row[x * 4 + 3] ?? 0xff) : 0xff;
      }
      rows.push(out);
    }
  }
  return encodePng({ width, height, channels, rows });
};

/** The gap between pictures side by side, px, and its colour (a light grey that reads on white and on a dark screen). */
export const SIDE_BY_SIDE_GAP = 16;
const GAP_GREY = 0xd0;

/**
 * One picture from pictures laid left to right, top-aligned at their own size (system-builder-depth T17
 * frames, T18 compare sheets), with `gap` px of grey between them; a shorter one is padded white below.
 * Each is cut to `maxHeight` (default: as tall as the bounds allow), so a long page still makes a sheet;
 * the result is RGBA. Throws `PngStitchError` when a picture can't be read or the width alone is too large.
 */
export const stitchSideBySide = (pictures: readonly Buffer[], options: { gap?: number; maxHeight?: number } = {}): Buffer => {
  if (pictures.length === 0) throw new PngStitchError('No pictures to stitch.');
  const gap = Math.max(0, Math.floor(options.gap ?? SIDE_BY_SIDE_GAP));
  const decoded = pictures.map(decodePng);
  const width = decoded.reduce((sum, picture) => sum + picture.width, 0) + gap * (decoded.length - 1);
  if (width > PNG_STITCH_SIDE_MAX) throw new PngStitchError('The stitched picture would be too large.');
  const fits = Math.min(PNG_STITCH_SIDE_MAX, Math.floor(PNG_STITCH_PIXELS_MAX / width), Math.floor(options.maxHeight ?? PNG_STITCH_SIDE_MAX));
  const height = Math.min(fits, Math.max(...decoded.map((picture) => picture.height)));
  if (height < 1) throw new PngStitchError('The stitched picture would be too large.');
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const out = Buffer.alloc(width * 4, 0xff);
    let left = 0;
    decoded.forEach((picture, index) => {
      const row = y < picture.height ? picture.rows[y] : undefined;
      if (row !== undefined) {
        for (let x = 0; x < picture.width; x += 1) {
          const at = (left + x) * 4;
          for (let c = 0; c < 3; c += 1) out[at + c] = row[x * picture.channels + c] ?? 0xff;
          out[at + 3] = picture.channels === 4 ? (row[x * 4 + 3] ?? 0xff) : 0xff;
        }
      }
      left += picture.width;
      if (index < decoded.length - 1) {
        for (let x = 0; x < gap; x += 1) {
          const at = (left + x) * 4;
          out[at] = GAP_GREY;
          out[at + 1] = GAP_GREY;
          out[at + 2] = GAP_GREY;
        }
        left += gap;
      }
    });
    rows.push(out);
  }
  return encodePng({ width, height, channels: 4, rows });
};

/** A picture's kind and size from its header (PNG IHDR, JPEG SOF), or null when it is neither or broken. */
export const pictureSize = (bytes: Buffer): { type: 'png' | 'jpeg'; width: number; height: number } | null => {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(SIGNATURE) && bytes.toString('latin1', 12, 16) === 'IHDR') {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { type: 'png', width, height } : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  // Segments after SOI: each marker 0xFF xx, then a 2-byte length, until a start-of-frame names the size.
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or scan data before any frame header
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2) return null;
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) {
      if (at + 9 > bytes.length) return null;
      const height = bytes.readUInt16BE(at + 5);
      const width = bytes.readUInt16BE(at + 7);
      return width > 0 && height > 0 ? { type: 'jpeg', width, height } : null;
    }
    at += 2 + length;
  }
  return null;
};
