// Phase 2 — saved page data: GET/PATCH/DELETE /designs/:slug/page-state (technical design §8.2).
//
// T0 seam stub: every route answers 500 "not built yet" until T8 fills the page-state service
// (the Phase 1.5 PR 1 pattern). The slug check already runs at the boundary.

import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

const notBuilt = (): never => {
  throw new ApiError('internal', 'This part of Design Chamber (page-state) is not built yet.');
};

/**
 * Registers:
 * - 'GET /designs/:slug/page-state'
 * - 'PATCH /designs/:slug/page-state'
 * - 'DELETE /designs/:slug/page-state'
 */
export function registerPageStateRoutes(router: Router, ctx: ServiceContext): void {
  router.on('GET /designs/:slug/page-state', async ({ params }) => {
    await ctx.store.dir(params.slug);
    return notBuilt();
  });

  router.on('PATCH /designs/:slug/page-state', async ({ params }) => {
    await ctx.store.dir(params.slug);
    return notBuilt();
  });

  router.on('DELETE /designs/:slug/page-state', async ({ params }) => {
    await ctx.store.dir(params.slug);
    return notBuilt();
  });
}