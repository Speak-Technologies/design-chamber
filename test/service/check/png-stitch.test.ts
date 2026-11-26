// The overview stitcher (src/service/check/png-stitch.ts): PNGs written with each of the five row
// filters decode to the same pixels, strips stack top to bottom at the first strip's width, and
// anything outside Chrome's shape (16-bit, palette, interlaced, truncated, oversized) is refused.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { decodePng, encodePng, PNG_STITCH_PIXELS_MAX, PNG_STITCH_SIDE_MAX, PngStitchError, stitchPngs, type DecodedPng } from '../../../src/service/check/png-stitch.ts';

const image = (width: number, height: number, channels: 3 | 4, seed: number): DecodedPng => ({
  width,
  height,
  channels,
  rows: Array.from({ length: height }, (_, y) => Buffer.from(Array.from({ length: width * channels }, (_, x) => (x * 7 + y * 13 + seed * 31) & 0xff))),
});

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** A PNG whose rows use `filter` (0 to 4), built independently of the encoder under test. */
const pngWithFilter = (source: DecodedPng, filter: number, header: { depth?: number; colour?: number; interlace?: number } = {}): Buffer => {
  const stride = source.width * source.channels;
  const raw: number[] = [];
  let previous: Buffer = Buffer.alloc(stride);
  for (const row of source.rows) {
    raw.push(filter);
    for (let x = 0; x < stride; x += 1) {
      const value = row[x] ?? 0;
      const left = x >= source.channels ? (row[x - source.channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= source.channels ? (previous[x - source.channels] ?? 0) : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter] ?? 0;
      raw.push((value - predicted) & 0xff);
    }
    previous = row;
  }
  const encoded = encodePng(source);
  // Swap the encoder's IDAT for this one, and optionally patch the header fields.
  const ihdr = Buffer.from(encoded.subarray(8, 8 + 25));
  if (header.depth !== undefined) ihdr[8 + 8] = header.depth;
  if (header.colour !== undefined) ihdr[8 + 9] = header.colour;
  if (header.interlace !== undefined) ihdr[8 + 12] = header.interlace;
  const data = deflateSync(Buffer.from(raw));
  const idatHead = Buffer.alloc(8);
  idatHead.writeUInt32BE(data.length, 0);
  idatHead.write('IDAT', 4, 'latin1');
  return Buffer.concat([encoded.subarray(0, 8), ihdr, idatHead, data, Buffer.alloc(4), Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
};

test('every row filter decodes to the same pixels, RGB and RGBA', () => {
  for (const channels of [3, 4] as const) {
    const source = image(9, 6, channels, channels);
    for (const filter of [0, 1, 2, 3, 4]) {
      const decoded = decodePng(pngWithFilter(source, filter));
      assert.equal(decoded.width, 9);
      assert.equal(decoded.height, 6);
      assert.equal(decoded.channels, channels);
      assert.deepEqual(decoded.rows, source.rows, `filter ${filter}, ${channels} channels`);
    }
  }
});

test('encode then decode is lossless', () => {
  const source = image(17, 5, 3, 2);
  assert.deepEqual(decodePng(encodePng(source)).rows, source.rows);
});

test('strips stack top to bottom at the first width; a narrower strip is padded white, a wider one cut', () => {
  const a = image(10, 3, 3, 1);
  const b = image(8, 2, 3, 2);
  const c = image(12, 4, 3, 3);
  const out = decodePng(stitchPngs([encodePng(a), encodePng(b), encodePng(c)]));
  assert.equal(out.width, 10);
  assert.equal(out.height, 9);
  assert.deepEqual(out.rows.slice(0, 3), a.rows);
  assert.deepEqual(out.rows[3]?.subarray(0, 24), b.rows[0]);
  assert.deepEqual([...(out.rows[3]?.subarray(24) ?? [])], [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  assert.deepEqual(out.rows[5], c.rows[0]?.subarray(0, 30));
});

test('an RGBA strip after an RGB one becomes RGB; an RGB strip under an RGBA one gets an opaque alpha', () => {
  const rgb = image(4, 1, 3, 1);
  const rgba = image(4, 1, 4, 2);
  const asRgb = decodePng(stitchPngs([encodePng(rgb), encodePng(rgba)]));
  assert.equal(asRgb.channels, 3);
  assert.deepEqual([...(asRgb.rows[1] ?? [])], [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14].map((i) => rgba.rows[0]?.[i]));
  const asRgba = decodePng(stitchPngs([encodePng(rgba), encodePng(rgb)]));
  assert.deepEqual([...(asRgba.rows[1] ?? [])].filter((_, i) => i % 4 === 3), [0xff, 0xff, 0xff, 0xff]);
});

test('refused: not a PNG, 16-bit, palette, interlaced, truncated, too tall, nothing to stitch', () => {
  const source = image(3, 2, 3, 1);
  const refuses = (bytes: Buffer, what: string): void => assert.throws(() => decodePng(bytes), PngStitchError, what);
  refuses(Buffer.from('not a png at all, just some text here'), 'not a PNG');
  refuses(pngWithFilter(source, 0, { depth: 16 }), '16-bit');
  refuses(pngWithFilter(source, 0, { colour: 3 }), 'palette');
  refuses(pngWithFilter(source, 0, { interlace: 1 }), 'interlaced');
  const good = encodePng(source);
  refuses(good.subarray(0, good.length - 20), 'truncated');
  const tall = Buffer.from(good);
  tall.writeUInt32BE(PNG_STITCH_SIDE_MAX + 1, 20);
  assert.throws(() => decodePng(tall), /too large to read/, 'too tall is refused before anything is inflated');
  assert.throws(() => stitchPngs([]), PngStitchError);
  // Many strips whose total height passes the side limit.
  const strip = encodePng(image(2, 4000, 3, 1));
  assert.throws(() => stitchPngs([strip, strip, strip, strip, strip]), PngStitchError);
});

test('a deflate stream that inflates past the expected size is refused, not read into memory', () => {
  const source = image(2, 2, 3, 1);
  const good = encodePng(source);
  const bomb = deflateSync(Buffer.alloc(10_000_000));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(bomb.length, 0);
  head.write('IDAT', 4, 'latin1');
  const bytes = Buffer.concat([good.subarray(0, 33), head, bomb, Buffer.alloc(4), Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
  // The inflate itself stops at the expected size (not a full inflate followed by a size check).
  assert.throws(() => decodePng(bytes), (error: unknown) => error instanceof PngStitchError && /could not be read/.test(error.message));
});

test('a header inside the side limit but over the pixel limit is refused before anything is inflated', () => {
  const good = encodePng(image(2, 2, 3, 1));
  const wide = Buffer.from(good);
  // 16 384 × 2 000 = 32.8 MP: each side passes PNG_STITCH_SIDE_MAX, the product passes PNG_STITCH_PIXELS_MAX.
  wide.writeUInt32BE(PNG_STITCH_SIDE_MAX, 16);
  wide.writeUInt32BE(2000, 20);
  assert.ok(PNG_STITCH_SIDE_MAX * 2000 > PNG_STITCH_PIXELS_MAX);
  assert.throws(() => decodePng(wide), (error: unknown) => error instanceof PngStitchError && /too large to read/.test(error.message));
});
