// One file of a project folder the user picked, read without following a link (Phase 2.5 §7.1, §5.10).
// Shared by the Code scan's seed and re-sync (`extract.ts`, `edits.ts`), adoption (`homes.ts`) and the
// repo read (`repo-read.ts`). Read-only: nothing here opens a file for writing.

import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';

import { resolvePlainTarget } from '../paths.ts';

/** One project file, contained: no link anywhere on the way (`resolvePlainTarget`), no link at the leaf (O_NOFOLLOW), ≤ `maxBytes`. */
export const readProjectFile = async (directory: string, rel: string, maxBytes: number): Promise<Buffer | null> => {
  let file: string;
  try {
    file = await resolvePlainTarget(directory, rel.split('/'));
  } catch {
    return null;
  }
  const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => null);
  if (handle === null) return null;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const bytes = Buffer.alloc(info.size);
    let filled = 0;
    while (filled < bytes.length) {
      const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return bytes.subarray(0, filled);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
};

/** The biggest asset a system takes (a document); fonts and logos are checked against their own cap after the read. */
export const ASSET_READ_MAX = 20 * 1024 * 1024;
