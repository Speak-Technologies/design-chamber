// Ownership marker of the files Design Chamber writes for agents (the guide `<root>/AGENTS.md`
// and the `design-chamber` OpenCode skill; documentation/specs/agent-guidance-and-pages.md §3.3).
//
// A file is ours when it carries our marker, and unedited when the marker's hash still matches:
// the hash is sha256 of the whole text with the 64-hex value replaced by 64 zeros. Any edit,
// even one character, breaks the hash, so the service never rewrites a file the user touched.
//
// This module is in `src/shared`, which the browser guests bundle too, so it cannot use
// `node:crypto`; SHA-256 is implemented here (sync, UTF-8 via TextEncoder). The tests check it
// against `node:crypto`.

/** The hash value a builder writes before `withOwnershipHash` fills it in. */
export const OWNERSHIP_PLACEHOLDER = '0'.repeat(64);

/** Line 1 of the guide. The hex is the only variable part. */
export const guideMarkerLine = (hex: string = OWNERSHIP_PLACEHOLDER): string => `<!-- design-chamber:guide v1 sha256:${hex} -->`;

// ---- SHA-256 (FIPS 180-4) ----

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

/** Lower-case hex SHA-256 of the UTF-8 bytes of `text`. */
export const sha256Hex = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  // Message + 0x80 + zero padding + 64-bit big-endian length, to a multiple of 64 bytes.
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(total - 4, bitLength >>> 0);

  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] as number; // Safe: i - 15 is within 1..48.
      const b = w[i - 2] as number; // Safe: i - 2 is within 14..61.
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as unknown as [number, number, number, number, number, number, number, number]; // Safe: hash has exactly 8 entries.
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i += 1) hash[i] = ((hash[i] as number) + (next[i] as number)) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
};

// ---- Markers ----

/**
 * Where a file's ownership marker is.
 * - `valid`: a well-formed marker; `index` is where its 64-hex value starts.
 * - `damaged`: our marker is there but its hash value is not 64 lower-case hex (an edit).
 * - `none`: no marker at all (a file Design Chamber did not write).
 */
export type OwnershipMarker = { kind: 'valid'; hex: string; index: number } | { kind: 'damaged' } | { kind: 'none' };

const GUIDE_MARKER = /^<!-- design-chamber:guide v1 sha256:([0-9a-f]{64}) -->(?:\r?\n|$)/;
const GUIDE_MARKER_START = /^<!-- design-chamber:guide\b/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SKILL_GENERATOR = /^[ \t]+generator:[ \t]*["']?design-chamber["']?[ \t]*$/m;
const SKILL_HASH = /^([ \t]+sha256:[ \t]*")([0-9a-f]{64})"[ \t]*$/m;

/** Find the guide marker (line 1) or the skill marker (frontmatter `metadata.generator` + `sha256`). */
export const findOwnershipMarker = (text: string): OwnershipMarker => {
  const guide = GUIDE_MARKER.exec(text);
  if (guide?.[1] !== undefined) return { kind: 'valid', hex: guide[1], index: text.indexOf('sha256:') + 'sha256:'.length };
  if (GUIDE_MARKER_START.test(text)) return { kind: 'damaged' };

  const frontmatter = FRONTMATTER.exec(text);
  const body = frontmatter?.[1];
  if (body === undefined || !SKILL_GENERATOR.test(body)) return { kind: 'none' };
  const hash = SKILL_HASH.exec(body);
  if (hash?.[1] === undefined || hash[2] === undefined) return { kind: 'damaged' };
  // The frontmatter body starts right after the opening `---` line.
  const bodyStart = text.indexOf('\n') + 1;
  return { kind: 'valid', hex: hash[2], index: bodyStart + hash.index + hash[1].length };
};

/** sha256 of `text` with its marker's hash value replaced by zeros (the text itself when it has no valid marker). */
export const ownershipHash = (text: string): string => {
  const marker = findOwnershipMarker(text);
  if (marker.kind !== 'valid') return sha256Hex(text);
  return sha256Hex(`${text.slice(0, marker.index)}${OWNERSHIP_PLACEHOLDER}${text.slice(marker.index + 64)}`);
};

/** `text` with its marker's hash value filled in. Throws when the text has no well-formed marker (a builder bug). */
export const withOwnershipHash = (text: string): string => {
  const marker = findOwnershipMarker(text);
  if (marker.kind !== 'valid') throw new Error('withOwnershipHash: the text has no ownership marker.');
  return `${text.slice(0, marker.index)}${ownershipHash(text)}${text.slice(marker.index + 64)}`;
};

/** True when the text carries a valid marker whose hash matches its content (ours and unedited). */
export const ownershipVerifies = (text: string): boolean => {
  const marker = findOwnershipMarker(text);
  return marker.kind === 'valid' && marker.hex === ownershipHash(text);
};
