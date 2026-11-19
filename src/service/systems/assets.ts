// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.6). T0 stub: T5 fills it.
// Brand files: base64 uploads checked by type and size, and Add from a folder; 422 `read-only` for a repo-backed system.

import type { AddSystemAssetResponse, AssetsFromFolderResponse } from '../../shared/api.ts';
import type { ServiceContext } from '../context.ts';
import { notBuilt } from './not-built.ts';

export const addSystemAsset = (ctx: ServiceContext, id: string, input: { uploadId: string; name: string; kind: 'font' | 'logo' | 'source' }): Promise<AddSystemAssetResponse> =>
  notBuilt();

export const addAssetsFromFolder = (ctx: ServiceContext, id: string, directory: string): Promise<AssetsFromFolderResponse> => notBuilt();
