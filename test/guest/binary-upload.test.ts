import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UPLOAD_CHUNK_MAX_CHARS } from '../../src/shared/limits.ts';
import { isBase64Chunk } from '../../src/service/uploads.ts';
import { BASE64_CHUNK_BYTES, createServiceClient, encodeBase64Chunks } from '../../src/guest/service-client.ts';

const bytesOf = (length: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(length);
  for (let n = 0; n < length; n += 1) bytes[n] = (n * 7 + 13) % 256;
  return bytes;
};

test('base64 chunks join to the file’s own base64 for sizes around every boundary', () => {
  for (const length of [0, 1, 2, 3, 4, 8189, 8190, 8191, BASE64_CHUNK_BYTES - 1, BASE64_CHUNK_BYTES, BASE64_CHUNK_BYTES + 1, 2 * BASE64_CHUNK_BYTES, 100_003]) {
    const bytes = bytesOf(length);
    assert.equal(encodeBase64Chunks(bytes).join(''), Buffer.from(bytes).toString('base64'), `${length} bytes`);
  }
});

test('every chunk fits one request as a JSON string and is whole base64 the service accepts (only the last may be padded)', () => {
  const chunks = encodeBase64Chunks(bytesOf(3 * BASE64_CHUNK_BYTES + 2));
  assert.equal(chunks.length, 4);
  for (const [index, chunk] of chunks.entries()) {
    assert.ok(JSON.stringify(chunk).length <= UPLOAD_CHUNK_MAX_CHARS, `chunk ${index} is ${JSON.stringify(chunk).length} characters as JSON`);
    assert.equal(isBase64Chunk(chunk, index === chunks.length - 1), true, `chunk ${index}`);
  }
  assert.ok(!chunks.slice(0, -1).some((chunk) => chunk.includes('=')), 'no padding before the last chunk');
});

test('an empty file has no chunks', () => {
  assert.deepEqual(encodeBase64Chunks(new Uint8Array(0)), []);
});

test('uploadBinary announces the base64 size, sends the chunks in order and reports progress to 1', async () => {
  const calls: Array<{ method: string; path: string; body: string | undefined }> = [];
  const client = createServiceClient({
    serviceRequest: async (request) => {
      calls.push({ method: request.method, path: request.path, body: request.body });
      if (request.path === '/uploads') return { status: 200, body: JSON.stringify({ uploadId: 'u_testupload1' }) };
      return { status: 200, body: JSON.stringify({ received: 0, complete: false }) };
    },
  });
  const file = new Blob([bytesOf(BASE64_CHUNK_BYTES + 10)]);
  const progress: number[] = [];
  const id = await client.uploadBinary(file, (fraction) => progress.push(fraction));
  assert.equal(id, 'u_testupload1');
  const expectedTotal = Buffer.from(bytesOf(BASE64_CHUNK_BYTES + 10)).toString('base64').length;
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { total: expectedTotal, encoding: 'base64' });
  assert.deepEqual(calls.slice(1).map((call) => call.path), ['/uploads/u_testupload1/0', '/uploads/u_testupload1/1']);
  assert.equal(progress.length, 2);
  assert.equal(progress[1], 1);
  assert.ok((progress[0] ?? 0) > 0 && (progress[0] ?? 0) < 1);
});

test('a file whose base64 is over the service’s limit is refused here, before anything is sent', async () => {
  let sent = 0;
  const client = createServiceClient({
    serviceRequest: async () => {
      sent += 1;
      return { status: 200, body: '{}' };
    },
  });
  // 21 000 001 bytes encode to more than 28 000 000 characters.
  const huge = new Blob([new Uint8Array(21_000_001)]);
  await assert.rejects(() => client.uploadBinary(huge), /larger than the 21 MB/);
  assert.equal(sent, 0);
});
