// Board comments routes (documentation/specs/system-builder-depth.md §13 T20, decision 10). The router
// has already checked the bearer token and refused encoded separators and NUL in `:id` and
// `:commentId` before a handler runs. The id goes through the system store (`SYSTEM_ID_PATTERN`,
// `resolveInside`, no link); the file is `src/service/systems/comments.ts`'s, under the designs root
// for every home (a repo-backed system's comments never go to the repo).
//
// Every body is a closed set: unknown fields are refused, an entry key is pattern-checked and then
// checked against the system's current detail, a body is 1 to COMMENT_BODY_MAX characters. All of
// it happens before the queue, so nothing invalid ever reaches a write.

import type {
  CreateSystemCommentBody,
  MarkSystemCommentsSentBody,
  MarkSystemCommentsSentResponse,
  OkResponse,
  PatchSystemCommentBody,
  SystemCommentResponse,
  SystemCommentsResponse,
} from '../../shared/api.ts';
import { COMMENT_BODY_MAX, COMMENT_ID_PATTERN, SYSTEM_COMMENTS_MAX } from '../../shared/limits.ts';
import { parseEntryKey, sectionOfEntry } from '../../shared/system-board.ts';
import { buildSystemDetail } from '../../shared/system-json.ts';
import type { CommentStatus } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import {
  ensureSystemComments,
  isCommentBody,
  withCommentAdded,
  withCommentPatched,
  withCommentRemoved,
  withCommentsMarkedSent,
} from '../systems/comments.ts';
import { ensureSystemStore } from '../systems/store.ts';

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

const STATUSES: readonly CommentStatus[] = ['open', 'sent', 'resolved'];

export const COMMENT_BODY_SENTENCE = `Write the comment in 1 to ${COMMENT_BODY_MAX} characters.`;
export const COMMENT_FIELDS_SENTENCE = "The request has a field Design Chamber doesn't take.";
export const COMMENT_ENTRY_SENTENCE = 'That is not a board entry.';
export const COMMENT_ENTRY_GONE_SENTENCE = 'That entry is not in this design system.';
export const COMMENT_ID_SENTENCE = 'That is not a comment id.';

const onlyFields = (body: Rec, allowed: readonly string[]): void => {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new ApiError('bad-request', COMMENT_FIELDS_SENTENCE);
};

/** `POST /systems/:id/comments`: `{ entry, body }`, nothing else. The entry's presence in the system is the handler's check. */
export const parseCreateSystemComment = (body: unknown): CreateSystemCommentBody => {
  if (!isRec(body)) throw new ApiError('bad-request', 'Send the comment as a JSON object.');
  onlyFields(body, ['entry', 'body']);
  if (typeof body.entry !== 'string' || parseEntryKey(body.entry) === null) throw new ApiError('bad-request', COMMENT_ENTRY_SENTENCE);
  if (!isCommentBody(body.body)) throw new ApiError('bad-request', COMMENT_BODY_SENTENCE);
  return { entry: body.entry, body: body.body };
};

/** `PATCH /systems/:id/comments/:commentId`: `body` and/or `status`, nothing else. */
export const parsePatchSystemComment = (body: unknown): PatchSystemCommentBody => {
  if (!isRec(body)) throw new ApiError('bad-request', 'Send the change as a JSON object.');
  onlyFields(body, ['body', 'status']);
  const patch: PatchSystemCommentBody = {};
  if (body.body !== undefined) {
    if (!isCommentBody(body.body)) throw new ApiError('bad-request', COMMENT_BODY_SENTENCE);
    patch.body = body.body;
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !STATUSES.includes(body.status as CommentStatus)) throw new ApiError('bad-request', 'The status is "open", "sent" or "resolved".');
    patch.status = body.status as CommentStatus;
  }
  if (patch.body === undefined && patch.status === undefined) throw new ApiError('bad-request', 'Say what to change: "body", "status" or both.');
  return patch;
};

/** A list of comment ids (1 to SYSTEM_COMMENTS_MAX, each `COMMENT_ID_PATTERN`), once each, in order. */
export const parseCommentIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > SYSTEM_COMMENTS_MAX) throw new ApiError('bad-request', 'List the comment ids (at least one).');
  for (const id of value) if (typeof id !== 'string' || !COMMENT_ID_PATTERN.test(id)) throw new ApiError('bad-request', COMMENT_ID_SENTENCE);
  // Safe: every element was checked to be a string just above.
  return [...new Set(value as string[])];
};

/** `POST /systems/:id/comments/mark-sent`: `{ ids }`, nothing else. */
export const parseMarkSystemCommentsSent = (body: unknown): MarkSystemCommentsSentBody => {
  if (!isRec(body)) throw new ApiError('bad-request', 'Send the list as a JSON object.');
  onlyFields(body, ['ids']);
  return { ids: parseCommentIds(body.ids) };
};

const commentIdOf = (value: string): string => {
  if (!COMMENT_ID_PATTERN.test(value)) throw new ApiError('bad-request', COMMENT_ID_SENTENCE);
  return value;
};

/**
 * Registers:
 * - 'GET /systems/:id/comments'
 * - 'POST /systems/:id/comments'
 * - 'PATCH /systems/:id/comments/:commentId'
 * - 'DELETE /systems/:id/comments/:commentId'
 * - 'POST /systems/:id/comments/mark-sent'
 */
export function registerSystemCommentRoutes(router: Router, ctx: ServiceContext): void {
  const now = (): string => new Date().toISOString();

  router.on('GET /systems/:id/comments', async ({ params }): Promise<SystemCommentsResponse> => {
    const { comments, damaged } = await ensureSystemComments(ctx).list(params.id);
    return damaged ? { comments, damaged: true } : { comments };
  });

  router.on('POST /systems/:id/comments', async ({ params, body }): Promise<SystemCommentResponse> => {
    const input = parseCreateSystemComment(body);
    // The entry must be on the board now; once saved, a comment outlives its entry ("on an entry that's gone").
    const key = parseEntryKey(input.entry);
    const detail = buildSystemDetail(await ensureSystemStore(ctx).get(params.id));
    if (key === null || sectionOfEntry(key, detail) === null) throw new ApiError('bad-request', COMMENT_ENTRY_GONE_SENTENCE);
    const at = now();
    const comment = await ensureSystemComments(ctx).mutate(params.id, (comments) => {
      const added = withCommentAdded(comments, input, at);
      return { comments: added.comments, result: added.comment };
    });
    return { comment };
  });

  router.on('PATCH /systems/:id/comments/:commentId', async ({ params, body }): Promise<SystemCommentResponse> => {
    const commentId = commentIdOf(params.commentId);
    const patch = parsePatchSystemComment(body);
    const comment = await ensureSystemComments(ctx).mutate(params.id, (comments) => {
      const patched = withCommentPatched(comments, commentId, patch);
      return { comments: patched.comments, result: patched.comment };
    });
    return { comment };
  });

  router.on('DELETE /systems/:id/comments/:commentId', async ({ params }): Promise<OkResponse> => {
    const commentId = commentIdOf(params.commentId);
    await ensureSystemComments(ctx).mutate(params.id, (comments) => ({ comments: withCommentRemoved(comments, commentId), result: undefined }));
    return { ok: true };
  });

  router.on('POST /systems/:id/comments/mark-sent', async ({ params, body }): Promise<MarkSystemCommentsSentResponse> => {
    const { ids } = parseMarkSystemCommentsSent(body);
    const at = now();
    const named = await ensureSystemComments(ctx).mutate(params.id, (comments) => {
      const marked = withCommentsMarkedSent(comments, ids, at);
      // Nothing new to mark (a retry, or only resolved and unknown ids): the file is left as it is.
      return { comments: marked.comments, result: marked.named, write: marked.changed };
    });
    return { comments: named };
  });
}
