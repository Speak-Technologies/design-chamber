// Phase 2 — hand edits: POST /designs/:slug/edits, POST /designs/:slug/edits/:id/undo,
// GET /designs/:slug/tokens, POST /designs/:slug/hand-edits/clear (technical design §2.2).
//
// T0 seam stub: every route answers 500 "not built yet" until T2b fills the dispatch (the
// Phase 1.5 PR 1 pattern). The slug and edit-id checks already run at the boundary, so a
// forged name is refused exactly as it will be once the pipeline lands.

import { EDIT_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

const notBuilt = (): never => {
  throw new ApiError('internal', 'This part of Design Chamber (edits) is not built yet.');
};

/**
 * Registers:
 * - 'POST /designs/:slug/edits'
 * - 'POST /designs/:slug/edits/:id/undo'
 * - 'GET /designs/:slug/tokens'
 * - 'POST /designs/:slug/hand-edits/clear'
 */
export function registerEditRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /designs/:slug/edits', async ({ params }) => {
    await ctx.store.dir(params.slug);
    return notBuilt();
  });

  router.on('POST /designs/:slug/edits/:id/undo', async ({ params }) => {
    await ctx.store.dir(params.slug);
    if (!EDIT_ID_PATTERN.test(params.id)) throw new ApiError('bad-request', 'That is not an edit id.');
    return notBuilt();
  });

  router.on('GET /designs/:slug/tokens', async ({ params }) => {
    await ctx.store.dir(params.slug);
    return notBuilt();
  });

  router.on('POST /designs/:slug/hand-edits/clear', async ({ params }) => {
    await ctx.store.dir(params.slug);
    return notBuilt();
  });
}