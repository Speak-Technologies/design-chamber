// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.1, §5.2). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until T2 (system history; restore refused for a repo-backed system, AD-20) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'GET /systems/:id/versions',
  'GET /systems/:id/versions/:vid/diff',
  'POST /systems/:id/versions/:vid/restore',
];

/**
 * Registers:
 * - 'GET /systems/:id/versions'
 * - 'GET /systems/:id/versions/:vid/diff'
 * - 'POST /systems/:id/versions/:vid/restore'
 */
export function registerSystemVersionsRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
