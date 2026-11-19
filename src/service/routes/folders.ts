// Phase 2.5 routes (documentation/specs/phase-2-5-technical.md §3.3, §2.8). T0 stub: every route answers
// 500 "This part of Design Chamber (design systems) is not built yet." until G-a (the folder registry) replaces this file's
// registrations. The router checks the bearer token first; nothing here reads the request or a file.

import type { RouteKey } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { registerNotBuilt } from '../systems/not-built.ts';

const KEYS: readonly RouteKey[] = [
  'GET /folders',
  'POST /folders',
  'PATCH /folders/:folderId',
  'DELETE /folders/:folderId',
  'POST /folders/:folderId/undelete',
  'POST /folders/:folderId/designs',
];

/**
 * Registers:
 * - 'GET /folders'
 * - 'POST /folders'
 * - 'PATCH /folders/:folderId'
 * - 'DELETE /folders/:folderId'
 * - 'POST /folders/:folderId/undelete'
 * - 'POST /folders/:folderId/designs'
 */
export function registerFoldersRoutes(router: Router, _ctx: ServiceContext): void {
  registerNotBuilt(router, KEYS);
}
