// Chunked uploads, guest → service (docs/SPEC.md §7, §8.2; Phase 2.5 §5.6 for binary files). The
// host caps one `serviceRequest` body at 64 000 chars (F7), so larger payloads (a big page HTML, an
// assistant message for "Open as page", a brand font or logo) arrive as ordered chunks of one
// upload: POST /uploads mints an id, PUT /uploads/:id/:index stores chunks strictly in order, and
// the consumer `take`s the joined text (or `takeBytes` the decoded file) exactly once. A guest
// whose chunk failed drops the upload with DELETE /uploads/:id, so it never holds a slot.
//
// Text: TTL 10 min, ≤ 8 open. Binary (`encoding: "base64"`, AD-8): ≤ 2 open, each ≤ 28 000 000
// base64 characters (21 MB decoded). Every base64 chunk is checked and decoded when it arrives and
// only its bytes are kept, so memory peaks at the decoded size, never at the base64 text.
// Purely in-memory: an upload never touches disk, and a service restart drops it (the guest
// chunker retries from scratch).

import { randomBytes } from 'node:crypto';

import { ApiError } from './http.ts';
import { BINARY_UPLOAD_TOTAL_MAX, BINARY_UPLOADS_OPEN_MAX, UPLOAD_TTL_MS, UPLOADS_OPEN_MAX, UPLOAD_TOTAL_MAX } from '../shared/limits.ts';
import type { PutUploadChunkResponse } from '../shared/api.ts';
import type { UploadStore } from './context.ts';

export type UploadStoreOptions = {
  /** Test seam for the TTL; defaults to `Date.now`. */
  now?: () => number;
  /** Test seam for id minting. */
  randomId?: () => string;
};

/** The store plus a read-only view of what it holds, for the memory-bound tests. */
export type UploadStoreWithStats = UploadStore & {
  /** Bytes held across every open upload: UTF-16 code units × 2 for text, the decoded-size buffer for binary. */
  heldBytes(): number;
};

type TextEntry = { kind: 'text'; id: string; total: number; chunks: string[]; received: number; created: number };
/** `bytes` is allocated at the first chunk at the largest decoded size the announced total allows; `filled` is how much holds data. */
type BinaryEntry = { kind: 'base64'; id: string; total: number; bytes: Buffer | null; filled: number; count: number; received: number; created: number };
type Entry = TextEntry | BinaryEntry;

const mintId = (): string => `u_${randomBytes(16).toString('base64url')}`;

const BASE64_BODY = /^[A-Za-z0-9+/]*$/;
const BASE64_LAST = /^[A-Za-z0-9+/]*={0,2}$/;
const NOT_BASE64 = "This part of the file isn't valid base64. Send the file again.";

/**
 * Is `data` a valid base64 chunk at this place in the upload? A chunk before the last carries no
 * padding and a multiple of 4 characters (so it decodes on its own); the last may end in one or
 * two `=` (then its length is a multiple of 4) or be unpadded (never 1 past a multiple of 4,
 * which no byte count encodes to).
 */
export const isBase64Chunk = (data: string, last: boolean): boolean => {
  if (!last) return data.length % 4 === 0 && BASE64_BODY.test(data);
  if (!BASE64_LAST.test(data)) return false;
  if (data.includes('=')) return data.length % 4 === 0;
  return data.length % 4 !== 1;
};

export const createUploadStore = (options: UploadStoreOptions = {}): UploadStoreWithStats => {
  const now = options.now ?? Date.now;
  const newId = options.randomId ?? mintId;
  const open = new Map<string, Entry>();

  /** Drop expired uploads (lazy sweep on every operation — no timers to leak). */
  const sweep = (): void => {
    const cutoff = now() - UPLOAD_TTL_MS;
    for (const [id, entry] of open) if (entry.created < cutoff) open.delete(id);
  };

  const need = (id: string): Entry => {
    sweep();
    const entry = open.get(id);
    if (entry === undefined) throw new ApiError('not-found', 'That upload is gone or has expired. Send the text again.');
    return entry;
  };

  const openOf = (kind: Entry['kind']): number => {
    let count = 0;
    for (const entry of open.values()) if (entry.kind === kind) count += 1;
    return count;
  };

  const incomplete = (entry: Entry): ApiError =>
    new ApiError('conflict', `The upload is not complete yet (${entry.received} of ${entry.total} characters).`);

  return {
    create(total: number, encoding: 'text' | 'base64' = 'text'): string {
      sweep();
      if (!Number.isInteger(total) || total < 0) throw new ApiError('bad-request', 'The upload size must be a whole number of characters.');
      if (encoding === 'base64') {
        if (total > BINARY_UPLOAD_TOTAL_MAX) throw new ApiError('too-large', 'That file is larger than the 21 MB Design Chamber accepts.');
        if (openOf('base64') >= BINARY_UPLOADS_OPEN_MAX) throw new ApiError('conflict', 'Another file is still uploading. Wait for it to finish.');
        const id = newId();
        open.set(id, { kind: 'base64', id, total, bytes: null, filled: 0, count: 0, received: 0, created: now() });
        return id;
      }
      if (total > UPLOAD_TOTAL_MAX) {
        throw new ApiError('too-large', `That text is larger than the ${UPLOAD_TOTAL_MAX.toLocaleString('en-US')} characters Design Chamber accepts.`);
      }
      if (openOf('text') >= UPLOADS_OPEN_MAX) {
        throw new ApiError('conflict', 'Too many uploads are open right now. Finish one, or wait a few minutes for the old ones to expire.');
      }
      const id = newId();
      open.set(id, { kind: 'text', id, total, chunks: [], received: 0, created: now() });
      return id;
    },
    put(id: string, index: number, data: string): PutUploadChunkResponse {
      const entry = need(id);
      if (!Number.isInteger(index) || index < 0) throw new ApiError('bad-request', 'The chunk number must be a whole number starting at 0.');
      if (typeof data !== 'string') throw new ApiError('bad-request', 'An upload chunk must be text.');
      const expected = entry.kind === 'text' ? entry.chunks.length : entry.count;
      if (index !== expected) {
        throw new ApiError('conflict', `Chunks must arrive in order: this upload waits for chunk ${expected}, not ${index}.`);
      }
      if (entry.received + data.length > entry.total) {
        // A file that overflows can never complete: its slot and buffer are freed at once (KI-22).
        if (entry.kind === 'base64') open.delete(id);
        throw new ApiError('too-large', 'This upload has received more text than it announced.');
      }
      if (entry.kind === 'text') {
        entry.chunks.push(data);
      } else {
        const last = entry.received + data.length === entry.total;
        if (!isBase64Chunk(data, last)) {
          // The guest sends the file again from the start ("Send the file again."), so this one is dropped.
          open.delete(id);
          throw new ApiError('bad-request', NOT_BASE64);
        }
        // Decoded now into one buffer of the decoded size: the base64 text is dropped with the request,
        // and taking the file needs no second copy.
        entry.bytes ??= Buffer.allocUnsafe(Math.ceil(entry.total / 4) * 3);
        entry.filled += entry.bytes.write(data, entry.filled, 'base64');
        entry.count += 1;
      }
      entry.received += data.length;
      return { received: entry.received, complete: entry.received === entry.total };
    },
    take(id: string): string {
      const entry = need(id);
      if (entry.kind !== 'text') throw new ApiError('conflict', 'That upload is a file, not text.');
      if (entry.received !== entry.total) throw incomplete(entry);
      open.delete(id);
      return entry.chunks.join('');
    },
    takeBytes(id: string): Buffer {
      const entry = need(id);
      if (entry.kind !== 'base64') throw new ApiError('conflict', 'That upload is text, not a file.');
      if (entry.received !== entry.total) throw incomplete(entry);
      open.delete(id);
      return entry.bytes === null ? Buffer.alloc(0) : entry.bytes.subarray(0, entry.filled);
    },
    discard(id: string): void {
      sweep();
      open.delete(id);
    },
    heldBytes(): number {
      let bytes = 0;
      for (const entry of open.values()) {
        if (entry.kind === 'text') for (const chunk of entry.chunks) bytes += chunk.length * 2;
        else bytes += entry.bytes?.length ?? 0;
      }
      return bytes;
    },
  };
};
