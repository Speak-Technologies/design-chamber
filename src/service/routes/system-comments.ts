// Board comments routes (documentation/specs/system-builder-depth.md §13 T20). The router has already
// checked the bearer token and refused encoded separators and NUL in `:id` and `:commentId` before a
// handler runs.
//
// Wave 0 stub: every route answers "isn't ready yet" until T20 replaces the handlers with the comments
// store (`src/service/systems/comments.ts`: the id through the system store, `.chamber/comments.json`
// through `resolveInside`, atomic writes, one queue per system). Nothing here reads or writes a file.

import type { MarkSystemCommentsSentResponse, OkResponse, SystemCommentResponse, SystemCommentsResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

export const SYSTEM_COMMENTS_NOT_READY = "Board comments aren't ready yet.";

const notReady = (): never => {
  throw new ApiError('internal', SYSTEM_COMMENTS_NOT_READY);
};

/**
 * Registers:
 * - 'GET /systems/:id/comments'
 * - 'POST /systems/:id/comments'
 * - 'PATCH /systems/:id/comments/:commentId'
 * - 'DELETE /systems/:id/comments/:commentId'
 * - 'POST /systems/:id/comments/mark-sent'
 */
export function registerSystemCommentRoutes(router: Router, _ctx: ServiceContext): void {
  router.on('GET /systems/:id/comments', async (): Promise<SystemCommentsResponse> => notReady());
  router.on('POST /systems/:id/comments', async (): Promise<SystemCommentResponse> => notReady());
  router.on('PATCH /systems/:id/comments/:commentId', async (): Promise<SystemCommentResponse> => notReady());
  router.on('DELETE /systems/:id/comments/:commentId', async (): Promise<OkResponse> => notReady());
  router.on('POST /systems/:id/comments/mark-sent', async (): Promise<MarkSystemCommentsSentResponse> => notReady());
}
