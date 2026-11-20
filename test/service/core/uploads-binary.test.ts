// Binary uploads (documentation/specs/phase-2-5-technical.md §5.6, AD-8): `encoding: "base64"` checked and
// decoded per chunk, at most 2 open, 28 000 000 base64 characters each, and memory bounded by the decoded
// size (the base64 text is never kept). Text uploads keep their own limits.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';

import { ApiError } from '../../../src/service/http.ts';
import { createUploadStore, isBase64Chunk } from '../../../src/service/uploads.ts';
import { BINARY_UPLOAD_TOTAL_MAX, BINARY_UPLOADS_OPEN_MAX, UPLOAD_TTL_MS, UPLOADS_OPEN_MAX } from '../../../src/shared/limits.ts';

const errorOf = (run: () => unknown): ApiError => {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    return error;
  }
  throw new Error('expected a throw, none happened');
};

/** Send `bytes` as base64 in chunks of `size` characters (a multiple of 4, like the guest chunker). */
const send = (uploads: ReturnType<typeof createUploadStore>, bytes: Buffer, size = 60_000): string => {
  const text = bytes.toString('base64');
  const id = uploads.create(text.length, 'base64');
  for (let at = 0, index = 0; at < text.length; at += size, index += 1) uploads.put(id, index, text.slice(at, at + size));
  return id;
};

describe('binary uploads', () => {
  test('chunks decode to the exact bytes, taken once, for every padding length', () => {
    const uploads = createUploadStore();
    for (const length of [0, 1, 2, 3, 4, 5, 45_000, 45_001, 45_002, 100_003]) {
      const bytes = randomBytes(length);
      const id = send(uploads, bytes);
      assert.ok(uploads.takeBytes(id).equals(bytes), `length ${length}`);
      assert.equal(errorOf(() => uploads.takeBytes(id)).code, 'not-found');
    }
  });

  test('the base64 check: unpadded body chunks, padding only at the end, never 1 past a multiple of 4', () => {
    assert.equal(isBase64Chunk('QUJD', false), true);
    assert.equal(isBase64Chunk('QUI=', false), false, 'padding before the last chunk');
    assert.equal(isBase64Chunk('QUJ', false), false, 'a body chunk must be a multiple of 4');
    assert.equal(isBase64Chunk('QU J', false), false, 'white space');
    assert.equal(isBase64Chunk('QUI=', true), true);
    assert.equal(isBase64Chunk('QQ==', true), true);
    assert.equal(isBase64Chunk('QUI', true), true, 'unpadded last chunk');
    assert.equal(isBase64Chunk('QUJDR', true), false, '1 past a multiple of 4');
    assert.equal(isBase64Chunk('QU=', true), false, 'padding with a bad length');
    assert.equal(isBase64Chunk('Q===', true), false);
    assert.equal(isBase64Chunk('QUJD-_', true), false, 'base64url is not accepted');
  });

  test('a chunk that is not base64 is refused with a sentence and the upload is dropped (KI-22: it can never finish)', () => {
    const uploads = createUploadStore();
    const id = uploads.create(8, 'base64');
    const refused = errorOf(() => uploads.put(id, 0, 'QU*D'));
    assert.equal(refused.code, 'bad-request');
    assert.equal(refused.message, "This part of the file isn't valid base64. Send the file again.");
    assert.equal(errorOf(() => uploads.put(id, 0, 'QUJD')).code, 'not-found', 'gone: the guest sends the file again');
    const again = uploads.create(8, 'base64');
    assert.equal(errorOf(() => uploads.put(again, 0, 'QUI=')).code, 'bad-request', 'padding in a body chunk');
    assert.equal(uploads.heldBytes(), 0);
    const ok = uploads.create(8, 'base64');
    uploads.put(ok, 0, 'QUJD');
    uploads.put(ok, 1, 'REVG');
    assert.equal(uploads.takeBytes(ok).toString('latin1'), 'ABCDEF');
  });

  test('a refused chunk frees the slot at once: the next file can start without waiting for the expiry', () => {
    const uploads = createUploadStore();
    uploads.create(8, 'base64'); // another file still sending, holding the other slot
    const failing = uploads.create(8, 'base64');
    assert.equal(errorOf(() => uploads.create(8, 'base64')).code, 'conflict', 'both slots taken');
    uploads.put(failing, 0, 'QUJD');
    assert.equal(errorOf(() => uploads.put(failing, 1, 'QU*D')).code, 'bad-request');
    const overflow = uploads.create(4, 'base64'); // the not-base64 refusal freed its slot
    assert.equal(errorOf(() => uploads.put(overflow, 0, 'QUJDREVG')).code, 'too-large');
    assert.equal(errorOf(() => uploads.put(overflow, 0, 'QUJD')).code, 'not-found', 'an overflowing file is dropped too');
    assert.equal(typeof uploads.create(4, 'base64'), 'string', 'the over-total refusal freed its slot');
  });

  test('two discarded uploads leave room for a third; discarding an unknown id is fine', () => {
    const uploads = createUploadStore();
    const first = uploads.create(8, 'base64');
    const second = uploads.create(8, 'base64');
    uploads.put(first, 0, 'QUJD');
    assert.equal(errorOf(() => uploads.create(8, 'base64')).code, 'conflict');
    uploads.discard(first);
    uploads.discard(second);
    uploads.discard(first); // twice: nothing to do
    uploads.discard('u_neverexisted0');
    assert.equal(uploads.heldBytes(), 0, 'the decoded buffer is released with it');
    assert.equal(errorOf(() => uploads.put(first, 1, 'REVG')).code, 'not-found');
    const third = uploads.create(4, 'base64');
    uploads.put(third, 0, 'QUJD');
    assert.equal(uploads.takeBytes(third).toString('latin1'), 'ABC');
    assert.equal(typeof uploads.create(4, 'base64'), 'string');
  });

  test('text uploads keep waiting after an over-total chunk (only files are dropped)', () => {
    const uploads = createUploadStore();
    const id = uploads.create(4);
    assert.equal(errorOf(() => uploads.put(id, 0, 'hello')).code, 'too-large');
    uploads.put(id, 0, 'hell');
    assert.equal(uploads.take(id), 'hell');
  });

  test('at most BINARY_UPLOADS_OPEN_MAX binary uploads open; text uploads are counted apart', () => {
    const uploads = createUploadStore();
    const ids = Array.from({ length: BINARY_UPLOADS_OPEN_MAX }, () => uploads.create(4, 'base64'));
    const busy = errorOf(() => uploads.create(4, 'base64'));
    assert.equal(busy.code, 'conflict');
    assert.equal(busy.message, 'Another file is still uploading. Wait for it to finish.');
    for (let index = 0; index < UPLOADS_OPEN_MAX; index += 1) uploads.create(4);
    const first = ids[0];
    assert.ok(first !== undefined);
    uploads.put(first, 0, 'QUJD');
    uploads.takeBytes(first);
    assert.equal(typeof uploads.create(4, 'base64'), 'string', 'a finished file frees its place');
  });

  test('the size cap is BINARY_UPLOAD_TOTAL_MAX base64 characters (21 MB decoded)', () => {
    const uploads = createUploadStore();
    assert.equal(BINARY_UPLOAD_TOTAL_MAX, 28_000_000);
    const tooLarge = errorOf(() => uploads.create(BINARY_UPLOAD_TOTAL_MAX + 1, 'base64'));
    assert.equal(tooLarge.code, 'too-large');
    assert.equal(tooLarge.message, 'That file is larger than the 21 MB Design Chamber accepts.');
    assert.equal(typeof uploads.create(BINARY_UPLOAD_TOTAL_MAX, 'base64'), 'string');
  });

  test('memory is bounded by the decoded size: nothing is held before the first chunk, never the base64 text', () => {
    const uploads = createUploadStore();
    const bytes = randomBytes(450_000);
    const text = bytes.toString('base64'); // 600 000 characters
    const id = uploads.create(text.length, 'base64');
    assert.equal(uploads.heldBytes(), 0, 'announcing a 21 MB file allocates nothing');
    for (let at = 0, index = 0; at < text.length; at += 60_000, index += 1) {
      uploads.put(id, index, text.slice(at, at + 60_000));
      // One buffer of the decoded size: 450 000 bytes, against 1 200 000 for the UTF-16 text.
      assert.equal(uploads.heldBytes(), 450_000);
    }
    assert.ok(uploads.takeBytes(id).equals(bytes));
    assert.equal(uploads.heldBytes(), 0);
  });

  test('order, overflow and kind mismatches are refused', () => {
    const uploads = createUploadStore();
    const id = uploads.create(8, 'base64');
    assert.equal(errorOf(() => uploads.put(id, 1, 'QUJD')).code, 'conflict');
    uploads.put(id, 0, 'QUJD');
    assert.equal(errorOf(() => uploads.takeBytes(id)).code, 'conflict', 'incomplete');
    assert.equal(errorOf(() => uploads.take(id)).message, 'That upload is a file, not text.');
    assert.equal(errorOf(() => uploads.put(id, 1, 'QUJDREVG')).code, 'too-large');
    const textId = uploads.create(2);
    uploads.put(textId, 0, 'hi');
    assert.equal(errorOf(() => uploads.takeBytes(textId)).message, 'That upload is text, not a file.');
    assert.equal(uploads.take(textId), 'hi');
  });

  test('binary uploads expire after the TTL like text', () => {
    let clock = 1_000;
    const uploads = createUploadStore({ now: () => clock });
    const id = uploads.create(4, 'base64');
    clock += UPLOAD_TTL_MS + 1;
    assert.equal(errorOf(() => uploads.put(id, 0, 'QUJD')).code, 'not-found');
    assert.equal(uploads.heldBytes(), 0);
  });
});
