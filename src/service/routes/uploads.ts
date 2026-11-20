// WP1 — POST /uploads, PUT /uploads/:id/:index (docs/SPEC.md §7): the chunked door for payloads
// bigger than one host serviceRequest (F7), text or (Phase 2.5 §5.6) a base64 file. Chunk bounds
// are enforced here (chars after JSON.stringify and UTF-8 bytes) so the host transport limits can
// never be exceeded; the store checks and decodes base64 chunks.

import type { CreateUploadResponse, OkResponse, PutUploadChunkResponse } from '../../shared/api.ts';
import { UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_MAX_CHARS, UPLOAD_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

const isBodyRecord = (body: unknown): body is Record<string, unknown> =>
  typeof body === 'object' && body !== null && !Array.isArray(body);

/**
 * Registers:
 * - 'POST /uploads'
 * - 'PUT /uploads/:id/:index'
 * - 'DELETE /uploads/:id'
 */
export function registerUploadsRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /uploads', ({ body }): CreateUploadResponse => {
    if (!isBodyRecord(body) || !Number.isInteger(body.total)) {
      throw new ApiError('bad-request', 'Announce the upload with { "total": <character count> }.');
    }
    const encoding = body.encoding ?? 'text';
    if (encoding !== 'text' && encoding !== 'base64') throw new ApiError('bad-request', 'An upload is sent as "text" or "base64".');
    return { uploadId: ctx.uploads.create(body.total as number, encoding) }; // Safe: isInteger checked above.
  });

  router.on('PUT /uploads/:id/:index', ({ params, body }): PutUploadChunkResponse => {
    if (!UPLOAD_ID_PATTERN.test(params.id)) throw new ApiError('not-found', 'That upload is gone or has expired. Send the text again.');
    const index = Number(params.index);
    if (!Number.isInteger(index) || index < 0) throw new ApiError('bad-request', 'The chunk number must be a whole number starting at 0.');
    if (!isBodyRecord(body) || typeof body.data !== 'string') throw new ApiError('bad-request', 'An upload chunk is { "data": "<text>" }.');
    const data: string = body.data;
    if (JSON.stringify(data).length > UPLOAD_CHUNK_MAX_CHARS) {
      throw new ApiError('too-large', `One upload chunk must stay under ${UPLOAD_CHUNK_MAX_CHARS.toLocaleString('en-US')} characters.`);
    }
    if (Buffer.byteLength(data, 'utf8') > UPLOAD_CHUNK_MAX_BYTES) {
      throw new ApiError('too-large', 'One upload chunk is too big. Send it in smaller pieces.');
    }
    return ctx.uploads.put(params.id, index, data);
  });

  // Idempotent: the guest calls it after a failed chunk and ignores the answer, so a gone upload is fine.
  router.on('DELETE /uploads/:id', ({ params }): OkResponse => {
    if (!UPLOAD_ID_PATTERN.test(params.id)) throw new ApiError('bad-request', 'That is not an upload id.');
    ctx.uploads.discard(params.id);
    return { ok: true };
  });
}
