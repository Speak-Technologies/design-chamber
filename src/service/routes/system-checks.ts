// A design system's checks (documentation/specs/phase-2-5-technical.md §10.3): the static findings
// over what the system store reads now, with severity and sentence from `src/shared/checks.ts`.
// The router checks the bearer token first; the id is checked and contained by the store
// (`SYSTEM_ID_PATTERN`, `resolveInside`, no link). Nothing is written. The S8 findings are T16's.

import type { SystemChecksResponse } from '../../shared/api.ts';
import { countFindings, sortFindings, withMessage } from '../../shared/checks.ts';
import type { ServiceContext } from '../context.ts';
import type { Router } from '../http.ts';
import { runSystemCheck } from '../check/system-run.ts';
import { ensureSystemStore } from '../systems/store.ts';

/**
 * Registers:
 * - 'GET /systems/:id/checks'
 */
export function registerSystemChecksRoutes(router: Router, ctx: ServiceContext): void {
  router.on('GET /systems/:id/checks', async ({ params }): Promise<SystemChecksResponse> => {
    const now = new Date();
    const { report } = await runSystemCheck(ensureSystemStore(ctx), params.id, { now, tool: 'service' });
    const findings = sortFindings(report.static.findings.map((finding) => withMessage(finding)));
    return { findings, counts: countFindings(findings), at: now.toISOString() };
  });
}
