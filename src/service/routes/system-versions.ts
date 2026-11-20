// Phase 2.5 system history routes (documentation/specs/phase-2-5-technical.md §3.1, §5.2, AD-3):
// the design versions routes' answers, over `_systems/<id>/`. The router has already checked the
// bearer token and refused encoded separators in `:id`; the version ids are checked here, and the
// system store resolves the id (pattern, containment, no links) before any path is built.
// No body is read: restore takes none.

import type { RestoreVersionResponse, VersionDiffResponse, VersionListResponse } from '../../shared/api.ts';
import { VERSION_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { ensureSystemStore } from '../systems/store.ts';
import { ensureSystemVersions, restoreSystemVersion } from '../systems/versions.ts';

const parseVid = (vid: string): string => {
  if (!VERSION_ID_PATTERN.test(vid)) throw new ApiError('bad-request', 'That is not a version id.');
  return vid;
};

/**
 * Registers:
 * - 'GET /systems/:id/versions'
 * - 'GET /systems/:id/versions/:vid/diff'
 * - 'POST /systems/:id/versions/:vid/restore'
 */
export function registerSystemVersionsRoutes(router: Router, ctx: ServiceContext): void {
  // The service is created on the first request, so registration never reads the context.
  router.on('GET /systems/:id/versions', async ({ params }): Promise<VersionListResponse> => ensureSystemVersions(ctx).list(params.id));

  router.on('GET /systems/:id/versions/:vid/diff', async ({ params, query }): Promise<VersionDiffResponse> => {
    const against = query.get('against') ?? 'current';
    if (against !== 'current') parseVid(against);
    return ensureSystemVersions(ctx).diff(params.id, parseVid(params.vid), against);
  });

  router.on('POST /systems/:id/versions/:vid/restore', async ({ params }): Promise<RestoreVersionResponse> =>
    restoreSystemVersion(ensureSystemVersions(ctx), ensureSystemStore(ctx), params.id, parseVid(params.vid)),
  );
}
