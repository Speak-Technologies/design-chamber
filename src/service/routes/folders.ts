// Phase 2.5 G1 folders (documentation/specs/phase-2-5-technical.md §3.3, §2.8): the folder list,
// create, rename, soft delete, undelete, and membership. The router checks the bearer token and
// refuses encoded separators in `:folderId` first; the id is matched to `FOLDER_ID_PATTERN` here,
// and the only file touched is `<root>/.chamber/folders.json`, through `folders.ts`.
// Phase 2.6 (§3.2): `GET /folders` also answers the manual project members; `DELETE` answers
// `onlyHere`.

import type { DeleteFolderResponse, FolderListResponse, FolderResponse } from '../../shared/api.ts';
import { FOLDER_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { assertFolderId, ensureFoldersService, FOLDER_NAME_EMPTY, FOLDER_UNDELETE_GONE, parseFolderChange } from '../folders.ts';

const nameOf = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError('bad-request', FOLDER_NAME_EMPTY);
  return (body as Record<string, unknown>).name;
};

/**
 * Registers:
 * - 'GET /folders'
 * - 'POST /folders'
 * - 'PATCH /folders/:folderId'
 * - 'DELETE /folders/:folderId'
 * - 'POST /folders/:folderId/undelete'
 * - 'POST /folders/:folderId/designs'
 * The service is made on first use, so registration never touches the context.
 */
export function registerFoldersRoutes(router: Router, ctx: ServiceContext): void {
  const folders = () => ensureFoldersService(ctx);

  router.on('GET /folders', (): Promise<FolderListResponse> => folders().list());

  router.on('POST /folders', async ({ body }): Promise<FolderResponse> => ({ folder: await folders().create(nameOf(body)) }));

  router.on('PATCH /folders/:folderId', async ({ params, body }): Promise<FolderResponse> => {
    const id = assertFolderId(params.folderId);
    return { folder: await folders().rename(id, nameOf(body)) };
  });

  router.on('DELETE /folders/:folderId', async ({ params }): Promise<DeleteFolderResponse> => {
    const id = assertFolderId(params.folderId);
    // AD-6: `onlyHere` (designs that lose their LAST folder) is counted in the same queued write
    // that deletes, so a membership change a moment earlier is reported truthfully.
    const { designs, onlyHere } = await folders().remove(id);
    return { ok: true, designs, onlyHere };
  });

  router.on('POST /folders/:folderId/undelete', async ({ params }): Promise<FolderResponse> => {
    if (!FOLDER_ID_PATTERN.test(params.folderId)) throw new ApiError('not-found', FOLDER_UNDELETE_GONE);
    return { folder: await folders().undelete(params.folderId) };
  });

  router.on('POST /folders/:folderId/designs', async ({ params, body }): Promise<FolderResponse> => {
    const id = assertFolderId(params.folderId);
    return { folder: await folders().change(id, parseFolderChange(body)) };
  });
}
