// POST /mentions/search and POST /mentions/resolve (documentation/specs/phase-1-5-sdk-2-7.md §U6):
// the composer's `@` menu. OpenChamber posts both with the service bearer, which the router checks
// before any handler runs. The work is in `../mentions.ts`.

import type { MentionsResolveResponse, MentionsSearchResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { resolveMention, searchMentions } from '../mentions.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Registers:
 * - 'POST /mentions/search'
 * - 'POST /mentions/resolve'
 */
export function registerMentionsRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /mentions/search', async ({ body }): Promise<MentionsSearchResponse> => {
    if (!isRecord(body) || typeof body.query !== 'string') throw new ApiError('bad-request', 'Send the search as { query, directory }.');
    const { directory } = body;
    if (directory !== undefined && directory !== null && typeof directory !== 'string') throw new ApiError('bad-request', 'Send the search as { query, directory }.');
    return searchMentions(ctx, { query: body.query, directory: directory ?? null });
  });

  router.on('POST /mentions/resolve', async ({ body }): Promise<MentionsResolveResponse> => {
    if (!isRecord(body) || typeof body.id !== 'string') throw new ApiError('bad-request', 'Send the pick as { id }.');
    return resolveMention(ctx, body.id);
  });
}
