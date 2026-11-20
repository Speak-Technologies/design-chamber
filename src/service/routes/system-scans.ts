// Phase 2.5 Code scans (documentation/specs/phase-2-5-technical.md §3.1, §7.1, §7.3). The router has
// already checked the bearer token and refused encoded separators in `:scanId`; the body is
// validated here, and the folder itself through `validateScanFolder` (absolute, outside the Designs
// folder, compared as realpaths) inside the job registry before anything is read. The repo flavour
// (§7.4) is T13's.

import type { CreateSystemScanBody, CreateSystemScanResponse, OkResponse, SystemScanResponse } from '../../shared/api.ts';
import { SYSTEM_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { ensureScanJobs } from '../systems/extract.ts';

const isBodyRecord = (body: unknown): body is Record<string, unknown> => typeof body === 'object' && body !== null && !Array.isArray(body);

/** `POST /system-scans`: a folder path (checked fully by `validateScanFolder`) and an optional system to review against. */
export const validateCreateScan = (body: unknown): CreateSystemScanBody => {
  if (!isBodyRecord(body)) throw new ApiError('bad-request', 'Name the folder to scan.');
  if (typeof body.directory !== 'string' || body.directory.trim() === '') throw new ApiError('bad-request', 'Name the folder to scan.');
  if (body.systemId === undefined) return { directory: body.directory };
  if (typeof body.systemId !== 'string' || !SYSTEM_ID_PATTERN.test(body.systemId)) throw new ApiError('bad-request', 'That is not a design system id.');
  return { directory: body.directory, systemId: body.systemId };
};

/**
 * Registers:
 * - 'POST /system-scans'
 * - 'GET /system-scans/:scanId'
 * - 'DELETE /system-scans/:scanId'
 *
 * The registry is reached on the first request, never at registration.
 */
export function registerSystemScanRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /system-scans', async ({ body }): Promise<CreateSystemScanResponse> => ensureScanJobs(ctx).start(validateCreateScan(body)));

  router.on('GET /system-scans/:scanId', async ({ params }): Promise<SystemScanResponse> => ensureScanJobs(ctx).get(params.scanId));

  router.on('DELETE /system-scans/:scanId', async ({ params }): Promise<OkResponse> => {
    ensureScanJobs(ctx).cancel(params.scanId);
    return { ok: true };
  });
}
