// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.1, §3.5). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until T1 (list, get, create, patch, delete) and T14 (the living-page state, the `livingPage` patch) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'GET /systems',
  'POST /systems',
  'GET /systems/:id',
  'PATCH /systems/:id',
  'DELETE /systems/:id',
  'GET /systems/:id/living-page',
];

/**
 * Registers:
 * - 'GET /systems'
 * - 'POST /systems'
 * - 'GET /systems/:id'
 * - 'PATCH /systems/:id'
 * - 'DELETE /systems/:id'
 * - 'GET /systems/:id/living-page'
 */
export function registerSystemsRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
