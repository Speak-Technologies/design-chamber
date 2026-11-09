// WP2 — GET /designs/:slug/checks, POST /designs/:slug/checks/run
// (documentation/specs/agent-render-and-check.md §3). The bearer check happens in the router
// before any handler; the slug goes through the store (pattern + containment). The run takes no
// input: its body must be empty or `{}`.

import type { ChecksResponse, ChecksRunResponse } from '../../shared/api.ts';
import { ensureChecksService } from '../check/service.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

/**
 * Registers:
 * - 'GET /designs/:slug/checks'
 * - 'POST /designs/:slug/checks/run'
 */
export function registerChecksRoutes(router: Router, ctx: ServiceContext): void {
  router.on('GET /designs/:slug/checks', async ({ params }): Promise<ChecksResponse> => ensureChecksService(ctx).get(params.slug));

  router.on('POST /designs/:slug/checks/run', async ({ params, body }): Promise<ChecksRunResponse> => {
    const empty = body === undefined || (typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).length === 0);
    if (!empty) throw new ApiError('bad-request', 'This request takes no input. Send an empty object.');
    return ensureChecksService(ctx).run(params.slug);
  });
}
