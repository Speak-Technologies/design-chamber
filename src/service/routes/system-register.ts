// Phase 2.6 T0 stub (documentation/specs/phase-2-6-technical.md §4.7): E1 replaces this file's
// registration with the real "Register it as it is" route. The router checks the bearer token first.

import type { CreateSystemResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

const NOT_BUILT = 'This part of Design Chamber (library and systems) is not built yet.';

/** Registers 'POST /systems/register' (Phase 2.6 §3.1) until E1 lands. */
export function registerSystemRegisterRoutes(router: Router, _ctx: ServiceContext): void {
  router.on('POST /systems/register', async (): Promise<CreateSystemResponse> => {
    throw new ApiError('internal', NOT_BUILT);
  });
}