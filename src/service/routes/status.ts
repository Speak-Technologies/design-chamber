// GET /status/designs (documentation/specs/phase-1-5-sdk-2-7.md §U5.3): the rows of the Work
// Status section, for the frame's project and chat.
//
// Seam stub: no rows, so the frame shows its empty state. The work-status branch (U5) fills it
// with `pickStatusDesigns` over `ctx.designIndex` and `ctx.activity`, in its own
// `src/service/status-designs.ts` (which keeps its own `hub.subscribe`, so compose.ts is untouched).

import type { StatusDesignsResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';

/**
 * Registers:
 * - 'GET /status/designs'
 */
export function registerStatusRoutes(router: Router, _ctx: ServiceContext): void {
  router.on('GET /status/designs', (): StatusDesignsResponse => ({ rows: [], total: 0 }));
}
