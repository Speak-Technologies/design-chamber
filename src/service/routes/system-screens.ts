// System screens routes (documentation/specs/system-builder-depth.md §4.6, §13 T12a). The router has
// already checked the bearer token and refused encoded separators in `:id` before a handler runs.
//
// Wave 0 stub: both routes answer "not built yet" until T12a replaces this file's handlers with the
// screen render (query validated here, the id resolved through the system store, the file read
// through `resolveInside`, `bundleDocument` in render mode) and its chunk read. Nothing here reads
// or writes a file.

import type { RenderChunkResponse, RenderMeta } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';

export const SYSTEM_SCREENS_NOT_BUILT = 'This part of Design Chamber (system screens) is not built yet.';

const notBuilt = (): never => {
  throw new ApiError('internal', SYSTEM_SCREENS_NOT_BUILT);
};

/**
 * Registers:
 * - 'GET /systems/:id/screens/render'
 * - 'GET /systems/:id/screens/render/chunk'
 */
export function registerSystemScreenRoutes(router: Router, _ctx: ServiceContext): void {
  router.on('GET /systems/:id/screens/render', async (): Promise<RenderMeta> => notBuilt());
  router.on('GET /systems/:id/screens/render/chunk', async (): Promise<RenderChunkResponse> => notBuilt());
}
