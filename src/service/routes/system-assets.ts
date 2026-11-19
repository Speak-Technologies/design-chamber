// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.1, §5.6). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until T5 (brand files, after SP-1) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'POST /systems/:id/assets',
  'POST /systems/:id/assets/from-folder',
];

/**
 * Registers:
 * - 'POST /systems/:id/assets'
 * - 'POST /systems/:id/assets/from-folder'
 */
export function registerSystemAssetRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
