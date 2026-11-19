// Phase 2.5 brand-file routes (documentation/specs/phase-2-5-technical.md §3.1, §5.6, AD-8). The router
// has already checked the bearer token and refused encoded separators in `:id`; every body is validated
// here before `systems/assets.ts` sees it. `name` is only a suggestion for the file name (made safe
// there, never used as a path); `directory` is the one path a body carries, a folder outside the
// designs root that is only read (validated like a scan folder, §7.1).

import type { AddSystemAssetBody, AddSystemAssetResponse, AssetsFromFolderBody, AssetsFromFolderResponse } from '../../shared/api.ts';
import { UPLOAD_ID_PATTERN } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { addAssetsFromFolder, addSystemAsset } from '../systems/assets.ts';

/** Characters of a file name the guest may suggest (a browser `File.name`). */
const ASSET_NAME_MAX = 255;

const isBodyRecord = (body: unknown): body is Record<string, unknown> => typeof body === 'object' && body !== null && !Array.isArray(body);

export const validateAddAsset = (body: unknown): AddSystemAssetBody => {
  if (!isBodyRecord(body)) throw new ApiError('bad-request', 'Name the upload, the file name and its kind.');
  const { uploadId, name, kind } = body;
  if (typeof uploadId !== 'string' || !UPLOAD_ID_PATTERN.test(uploadId)) throw new ApiError('bad-request', 'That is not an upload id.');
  if (typeof name !== 'string' || name.trim() === '' || name.length > ASSET_NAME_MAX || name.includes('\u0000')) {
    throw new ApiError('bad-request', `A file name is 1 to ${ASSET_NAME_MAX} characters.`);
  }
  if (kind !== 'font' && kind !== 'logo' && kind !== 'source') throw new ApiError('bad-request', 'A brand file is a font, a logo or a source.');
  return { uploadId, name, kind };
};

export const validateAssetsFromFolder = (body: unknown): AssetsFromFolderBody => {
  // The length and every other path rule are `validateScanFolder`'s, so the sentence names what is wrong.
  if (!isBodyRecord(body) || typeof body.directory !== 'string') {
    throw new ApiError('bad-request', 'Name the folder to add brand files from.');
  }
  return { directory: body.directory };
};

/**
 * Registers:
 * - 'POST /systems/:id/assets'
 * - 'POST /systems/:id/assets/from-folder'
 */
export function registerSystemAssetRoutes(router: Router, ctx: ServiceContext): void {
  router.on('POST /systems/:id/assets', ({ params, body }): Promise<AddSystemAssetResponse> => addSystemAsset(ctx, params.id, validateAddAsset(body)));
  router.on('POST /systems/:id/assets/from-folder', ({ params, body }): Promise<AssetsFromFolderResponse> =>
    addAssetsFromFolder(ctx, params.id, validateAssetsFromFolder(body).directory),
  );
}
