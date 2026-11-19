// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.1, §10.3, §10.4). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until T10 (static system findings; S8 findings are T16) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'GET /systems/:id/checks',
];

/**
 * Registers:
 * - 'GET /systems/:id/checks'
 */
export function registerSystemChecksRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
