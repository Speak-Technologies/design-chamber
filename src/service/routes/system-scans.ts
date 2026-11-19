// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.1, §7). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until T4 (code scans; the repo flavour is T13) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'POST /system-scans',
  'GET /system-scans/:scanId',
  'DELETE /system-scans/:scanId',
];

/**
 * Registers:
 * - 'POST /system-scans'
 * - 'GET /system-scans/:scanId'
 * - 'DELETE /system-scans/:scanId'
 */
export function registerSystemScanRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
