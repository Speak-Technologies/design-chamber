// Phase 2 — saved page data: GET/PATCH/DELETE /designs/:slug/page-state (technical design §8.2).
//
// Every route is behind the router's bearer check and the 80 kB body cap; the slug goes through
// `store.dir` (pattern, containment, design folder) inside the service before any file is
// touched, and the file itself through `resolvePlainTarget` (`src/service/page-state.ts`). The
// body is validated here: `gen` of the form `<epoch>:<n>`, then either an inline delta or the id
// of an upload holding it (a delta too big for one request, §8.4). Errors are sentences and never
// quote the data.

import type { PageStateClearResponse, PageStatePatchResponse, PageStateResponse } from '../../shared/api.ts';
import { UPLOAD_ID_PATTERN } from '../../shared/limits.ts';
import { parseGen, parsePageStateDelta, type PageStateDelta } from '../../shared/page-state.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { ensurePageStateService, pageStateDirOf } from '../page-state.ts';

const BAD_BODY = 'Saved page data is sent as { "gen": "<from the last answer>", "clear": true|false, "changes": [["key", "value" or null], ...] }.';
const BAD_GEN = 'This page data request has no valid gen. Reload the design and try again.';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The validated `{ gen, delta }` of a PATCH body; the upload is taken (once) when the body names one. */
export const readPatchBody = (body: unknown, takeUpload: (id: string) => string): { gen: string; delta: PageStateDelta } => {
  if (!isRecord(body)) throw new ApiError('bad-request', BAD_BODY);
  if (parseGen(body.gen) === null) throw new ApiError('bad-request', BAD_GEN);
  // Safe: parseGen accepted it, so it is a string.
  const gen = body.gen as string;

  let source: Record<string, unknown> = body;
  if (body.uploadId !== undefined) {
    if (typeof body.uploadId !== 'string' || !UPLOAD_ID_PATTERN.test(body.uploadId)) throw new ApiError('bad-request', 'That is not an upload id.');
    if (body.clear !== undefined || body.changes !== undefined) throw new ApiError('bad-request', BAD_BODY);
    let uploaded: unknown;
    try {
      uploaded = JSON.parse(takeUpload(body.uploadId));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('bad-request', 'The uploaded page data is not valid JSON.');
    }
    if (!isRecord(uploaded)) throw new ApiError('bad-request', BAD_BODY);
    if (uploaded.gen !== undefined && uploaded.gen !== gen) throw new ApiError('bad-request', BAD_GEN);
    source = uploaded;
  }

  const delta = parsePageStateDelta(source.clear, source.changes);
  if (delta === null) throw new ApiError('bad-request', BAD_BODY);
  return { gen, delta };
};

/**
 * Registers:
 * - 'GET /designs/:slug/page-state'
 * - 'PATCH /designs/:slug/page-state'
 * - 'DELETE /designs/:slug/page-state'
 */
export function registerPageStateRoutes(router: Router, ctx: ServiceContext): void {
  // Eager, so shutdown flushes pending writes even when no request came in this run.
  const pageState = ensurePageStateService(ctx);

  router.on('GET /designs/:slug/page-state', ({ params }): Promise<PageStateResponse> => pageState.read(params.slug));

  router.on('PATCH /designs/:slug/page-state', async ({ params, body }): Promise<PageStatePatchResponse> => {
    // The slug is checked before the body, so a bad name answers its own sentence first.
    await pageStateDirOf(ctx.store, params.slug);
    const { gen, delta } = readPatchBody(body, (id) => ctx.uploads.take(id));
    return pageState.patch(params.slug, gen, delta);
  });

  router.on('DELETE /designs/:slug/page-state', ({ params }): Promise<PageStateClearResponse> => pageState.clear(params.slug));
}
