// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.1, §5.3, §6). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until T3 (hand edits and undo) and T4/T13 (re-sync) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'POST /systems/:id/edits',
  'POST /systems/:id/edits/:eid/undo',
  'POST /systems/:id/hand-edits/clear',
  'POST /systems/:id/resync',
];

/**
 * Registers:
 * - 'POST /systems/:id/edits'
 * - 'POST /systems/:id/edits/:eid/undo'
 * - 'POST /systems/:id/hand-edits/clear'
 * - 'POST /systems/:id/resync'
 */
export function registerSystemEditRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
