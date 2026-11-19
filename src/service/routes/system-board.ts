// Phase 2.5 board routes (documentation/specs/phase-2-5-technical.md §3.1, §5.7). The router has
// already checked the bearer token and refused encoded separators in `:id`; the query is validated
// here, and the board service resolves the id through the system store (pattern, containment, no
// links) before it reads anything. Nothing here writes a file.

import type { RenderChunkResponse, RenderMeta } from '../../shared/api.ts';
import { SHA256_PATTERN, VERSION_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { ensureBoardService } from '../systems/board.ts';
import { ensureSystemStore } from '../systems/store.ts';

/** `scheme`: `light` (default) or `dark`; anything else is refused. */
export const parseBoardScheme = (raw: string | null): 'light' | 'dark' => {
  if (raw === null || raw === 'light') return 'light';
  if (raw === 'dark') return 'dark';
  throw new ApiError('bad-request', 'The colour scheme must be light or dark.');
};

/**
 * Registers:
 * - 'GET /systems/:id/board'
 * - 'GET /systems/:id/board/chunk'
 */
export function registerSystemBoardRoutes(router: Router, ctx: ServiceContext): void {
  router.on('GET /systems/:id/board', async ({ params, query }): Promise<RenderMeta> => {
    const version = query.get('version') ?? undefined;
    if (version !== undefined && !VERSION_ID_PATTERN.test(version)) throw new ApiError('bad-request', 'That is not a version id.');
    const scheme = parseBoardScheme(query.get('scheme'));
    return ensureBoardService(ctx).render(params.id, { ...(version !== undefined ? { version } : {}), scheme });
  });

  router.on('GET /systems/:id/board/chunk', async ({ params, query }): Promise<RenderChunkResponse> => {
    // The id is resolved even though the key addresses the cache: one system's board is never
    // readable through another id's route.
    await ensureSystemStore(ctx).dir(params.id);
    const key = query.get('key') ?? '';
    if (!SHA256_PATTERN.test(key)) throw new ApiError('bad-request', 'That is not a board key.');
    const rawN = query.get('n') ?? '';
    if (!/^[0-9]{1,9}$/.test(rawN)) throw new ApiError('bad-request', 'That is not a chunk number.');
    return ensureBoardService(ctx).chunk(params.id, key, Number(rawN));
  });
}
