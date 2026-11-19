// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.2, §5.4). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until T7 (a design's system: copy-on-link, preview, set and update) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'GET /designs/:slug/system',
  'GET /designs/:slug/system/preview',
  'POST /designs/:slug/system',
];

/**
 * Registers:
 * - 'GET /designs/:slug/system'
 * - 'GET /designs/:slug/system/preview'
 * - 'POST /designs/:slug/system'
 */
export function registerDesignSystemRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
