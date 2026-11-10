// POST /mentions/search and POST /mentions/resolve (documentation/specs/phase-1-5-sdk-2-7.md §U6):
// the composer's `@` menu. OpenChamber posts both with the service bearer.
//
// Seam stub: search lists nothing, so no row can be picked and resolve is never reached from the
// menu; resolve still validates its id and answers that the design is not there. The
// design-mentions branch (U6) fills both from `ctx.designIndex` and the store.

import type { MentionsResolveResponse, MentionsSearchResponse } from '../../shared/api.ts';
import { SLUG_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Registers:
 * - 'POST /mentions/search'
 * - 'POST /mentions/resolve'
 */
export function registerMentionsRoutes(router: Router, _ctx: ServiceContext): void {
  router.on('POST /mentions/search', ({ body }): MentionsSearchResponse => {
    if (!isRecord(body) || typeof body.query !== 'string') throw new ApiError('bad-request', 'Send the search as { query, directory }.');
    return { items: [] };
  });

  router.on('POST /mentions/resolve', ({ body }): MentionsResolveResponse => {
    if (!isRecord(body) || typeof body.id !== 'string' || !SLUG_PATTERN.test(body.id)) throw new ApiError('bad-request', 'That is not a design folder name.');
    throw new ApiError('not-found', 'That design is no longer in your Designs folder.');
  });
}
