// A folder outside the designs root that the service only reads (documentation/specs/phase-2-5-technical.md
// §7.1 `validateScanFolder`, used by §5.6 "Add from a folder…" and, once T4 lands, the code scan): a
// string of at most 4 096 characters, no control character, absolute, not a drive or filesystem root,
// a folder that `stat`s, and neither the designs root nor inside it (compared as realpaths, so a link
// into the Designs folder is caught). Answers the folder's realpath; throws `bad-path` with the sentence.

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { ApiError } from '../http.ts';
import { isInsideOrEqual } from '../paths.ts';

/** Characters of a folder path a request may carry (§7.1). */
export const SCAN_FOLDER_PATH_MAX = 4096;

export const SCAN_FOLDER_IN_ROOT = "Pick your app's folder, not the Designs folder.";

const unreadable = (folder: string, error: unknown): ApiError => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const reason =
    code === 'ENOENT'
      ? "It doesn't exist."
      : code === 'EACCES' || code === 'EPERM'
        ? "Design Chamber isn't allowed to open it."
        : code === 'ENOTDIR'
          ? "It isn't a folder."
          : "It can't be opened right now.";
  return new ApiError('bad-path', `Design Chamber can't read ${folder}. ${reason}`);
};

export type ScanFolderOptions = {
  /** The sentence for a folder that is the designs root or inside it (the brand-folder flow words it its own way). */
  insideRootSentence?: string;
};

export const validateScanFolder = async (raw: unknown, designsRoot: string, options: ScanFolderOptions = {}): Promise<string> => {
  if (typeof raw !== 'string' || raw.trim() === '') throw new ApiError('bad-path', 'Choose a folder.');
  const value = raw.trim();
  if (value.length > SCAN_FOLDER_PATH_MAX) throw new ApiError('bad-path', 'That folder path is too long.');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new ApiError('bad-path', 'That folder path contains an invalid character.');
  // A win32 drive-relative `C:foo` is not absolute; neither is `~/x` (the guest sends a full path).
  if (!path.isAbsolute(value)) throw new ApiError('bad-path', 'Choose a full folder path.');
  const lexical = path.resolve(value);
  if (path.parse(lexical).root === lexical) throw new ApiError('bad-path', 'A whole drive is too much to read. Pick a folder inside it.');
  let real: string;
  try {
    const info = await stat(lexical);
    if (!info.isDirectory()) throw Object.assign(new Error('not a folder'), { code: 'ENOTDIR' });
    real = await realpath(lexical);
  } catch (error) {
    throw unreadable(lexical, error);
  }
  if (path.parse(real).root === real) throw new ApiError('bad-path', 'A whole drive is too much to read. Pick a folder inside it.');
  const rootReal = await realpath(designsRoot).catch(() => path.resolve(designsRoot));
  if (isInsideOrEqual(rootReal, real) || isInsideOrEqual(path.resolve(designsRoot), lexical)) {
    throw new ApiError('bad-path', options.insideRootSentence ?? SCAN_FOLDER_IN_ROOT);
  }
  return real;
};
