// System screens routes (documentation/specs/system-builder-depth.md §4.6, §13 T12a). The router has
// already checked the bearer token and refused encoded separators in `:id` before a handler runs.
// Every query value is checked here before anything is read: `screen` against
// `SYSTEM_ENTRY_ID_PATTERN` (so `..`, a slash, a backslash, a drive letter or an upper-case id never
// reaches a path), then the board service resolves the id through the system store (pattern,
// containment, no links) and reads `screens/<id>.html` through a source that resolves every path with
// `resolveInside`. Nothing here writes a file.

import type { RenderChunkResponse, RenderMeta } from '../../shared/api.ts';
import { SHA256_PATTERN, SYSTEM_ENTRY_ID_PATTERN, SYSTEM_PROPOSAL_ID_PATTERN, VERSION_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { ensureBoardService, NOT_A_SCREEN_ID_MESSAGE } from '../systems/board.ts';
import { ensureSystemStore } from '../systems/store.ts';
import { parseBoardScheme } from './system-board.ts';

/**
 * Registers:
 * - 'GET /systems/:id/screens/render'
 * - 'GET /systems/:id/screens/render/chunk'
 */
export function registerSystemScreenRoutes(router: Router, ctx: ServiceContext): void {
  router.on('GET /systems/:id/screens/render', async ({ params, query }): Promise<RenderMeta> => {
    const screen = query.get('screen');
    if (screen === null || !SYSTEM_ENTRY_ID_PATTERN.test(screen)) throw new ApiError('bad-request', NOT_A_SCREEN_ID_MESSAGE);
    const version = query.get('version') ?? undefined;
    if (version !== undefined && !VERSION_ID_PATTERN.test(version)) throw new ApiError('bad-request', 'That is not a version id.');
    const proposal = query.get('proposal') ?? undefined;
    if (proposal !== undefined && !SYSTEM_PROPOSAL_ID_PATTERN.test(proposal)) throw new ApiError('bad-request', 'That is not a proposal id.');
    if (proposal !== undefined && version !== undefined) throw new ApiError('bad-request', 'Ask for a version or a proposal, not both.');
    const scheme = parseBoardScheme(query.get('scheme'));
    return ensureBoardService(ctx).renderScreen(params.id, {
      screen,
      ...(version !== undefined ? { version } : {}),
      ...(proposal !== undefined ? { proposal } : {}),
      scheme,
    });
  });

  router.on('GET /systems/:id/screens/render/chunk', async ({ params, query }): Promise<RenderChunkResponse> => {
    // The id is resolved even though the key addresses the cache: one system's screen is never
    // readable through another id's route, and a board's chunks are never served here.
    await ensureSystemStore(ctx).dir(params.id);
    const key = query.get('key') ?? '';
    if (!SHA256_PATTERN.test(key)) throw new ApiError('bad-request', 'That is not a screen key.');
    const rawN = query.get('n') ?? '';
    if (!/^[0-9]{1,9}$/.test(rawN)) throw new ApiError('bad-request', 'That is not a chunk number.');
    return ensureBoardService(ctx).chunk(params.id, key, Number(rawN), 'screen');
  });
}
