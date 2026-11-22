// Phase 2.6 "Register it as it is" (documentation/specs/phase-2-6-technical.md §3.1, §5.9, AD-10).
// The router checks the bearer token first; the body is validated here, and everything else (the scan
// job, the location inside the project, the repo home, the snapshot) is re-checked in `register.ts`.
// No body carries a path: the folder is the one the named location scan read.

import type { CreateSystemResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { parseRegisterBody, registerSystem } from '../systems/register.ts';

/**
 * Registers:
 * - 'POST /systems/register'
 */
export function registerSystemRegisterRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /systems/register', async ({ body }): Promise<CreateSystemResponse> => registerSystem(ctx, parseRegisterBody(body)));
}
