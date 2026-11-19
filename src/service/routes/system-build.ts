// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.5, §5.9, §5.14). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until T12a (tickets, the command, stop and undo) and T17 (proposals and the preview render) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'POST /systems/chip',
  'GET /system-builds/:ticket',
  'GET /systems/:id/proposals/:proposalId',
  'GET /systems/:id/living-page/render',
  'GET /systems/:id/living-page/render/chunk',
  'POST /systems/:id/build/stop',
  'POST /system-stops/:undoId/undo',
];

/**
 * Registers:
 * - 'POST /systems/chip'
 * - 'GET /system-builds/:ticket'
 * - 'GET /systems/:id/proposals/:proposalId'
 * - 'GET /systems/:id/living-page/render'
 * - 'GET /systems/:id/living-page/render/chunk'
 * - 'POST /systems/:id/build/stop'
 * - 'POST /system-stops/:undoId/undo'
 */
export function registerSystemBuildRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
