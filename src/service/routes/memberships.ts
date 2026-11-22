// Phase 2.6 T0 stub (documentation/specs/phase-2-6-technical.md §4.7): F1 replaces this file's
// registration with the real batch membership route. The router checks the bearer token first.

import type { MembershipsResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

const NOT_BUILT = 'This part of Design Chamber (library and systems) is not built yet.';

/** Registers 'POST /memberships' (Phase 2.6 §3.1) until F1 lands. */
export function registerMembershipsRoutes(router: Router, _ctx: ServiceContext): void {
  router.on('POST /memberships', async (): Promise<MembershipsResponse> => {
    throw new ApiError('internal', NOT_BUILT);
  });
}