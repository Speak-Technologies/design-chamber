// GET /status/designs (documentation/specs/phase-1-5-sdk-2-7.md §U5.3): the rows of the Work
// Status section, for the frame's project and chat. The picking and the per-row state live in
// `../status-designs.ts`, which keeps its own `hub.subscribe` so compose.ts is untouched.
// `directory` and `session` are compared with what the design index holds and never reach the disk.

import type { StatusDesignsResponse } from '../../shared/api.ts';
import { ensureChecksService } from '../check/service.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { createStatusDesigns } from '../status-designs.ts';

/**
 * Registers:
 * - 'GET /status/designs'
 */
export function registerStatusRoutes(router: Router, ctx: ServiceContext): void {
  const status = createStatusDesigns(ctx, { checksFor: (slug) => ensureChecksService(ctx).get(slug) });
  router.on('GET /status/designs', ({ query }): Promise<StatusDesignsResponse> => {
    const directory = query.get('directory');
    const session = query.get('session');
    return status.answer({ ...(directory === null ? {} : { directory }), ...(session === null ? {} : { session }) });
  });
}
