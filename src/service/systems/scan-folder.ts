// A folder outside the designs root that the service only reads (documentation/specs/phase-2-5-technical.md
// §7.1 `validateScanFolder`, used by §5.6 "Add from a folder…" and, once T4 lands, the code scan): a
// string of at most 4 096 characters, no control character, absolute, not a drive or filesystem root,
// a folder that `stat`s, and neither the designs root nor inside it (compared as realpaths, so a link
// into the Designs folder is caught). Answers the folder's realpath; throws `bad-path` with the sentence.

//
// Phase 2.6 (documentation/specs/phase-2-6-technical.md §5.6, AD-8): `validateLocation`, the one
// resolver of a folder inside a project (an existing design system's location). The input may be
// relative to the project or absolute, either slash; it is refused as a web address before anything
// is touched, a UNC share is refused unless the project is one, and the folder must then pass
// `validateScanFolder` and lie inside the project compared as realpaths with `isInsideOrEqual`
// (case-folded on win32 and darwin), so a link inside the project that leads out is refused.

import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { foldsCase, type PathModule } from '../../shared/path-compare.ts';
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

// ---- a location inside a project (Phase 2.6 §5.6) ----

export const LOCATION_URL_SENTENCE = 'Use the folder on this machine, not a web address.';
export const LOCATION_GONE_SENTENCE = 'That folder is gone. Pick another location.';
export const pickInsideSentence = (projectReal: string, p: PathModule = path): string => `Pick a folder inside ${p.basename(projectReal) || projectReal}.`;

/** A web address, not a path: a scheme of two or more letters (so `C:/` stays a path), `www.` or `localhost`. */
export const looksLikeUrl = (raw: string): boolean => /^[a-z][a-z0-9+.-]+:\/\//i.test(raw) || /^www\./i.test(raw) || /^localhost(:\d+)?(\/|$)/i.test(raw);

const isUnc = (value: string): boolean => /^[\\/]{2}[^\\/]/.test(value);

/**
 * Steps 1 to 4 of §5.6, disk-free: the trimmed input checked and resolved against the project
 * (relative input) or on its own (absolute input). `p` is the path flavour (tests pass `path.win32`).
 */
export const lexicalLocation = (raw: unknown, projectReal: string, p: PathModule = path): string => {
  if (typeof raw !== 'string' || raw.trim() === '') throw new ApiError('bad-path', 'Choose a folder.');
  const value = raw.trim();
  if (value.length > SCAN_FOLDER_PATH_MAX) throw new ApiError('bad-path', 'That folder path is too long.');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new ApiError('bad-path', 'That folder path contains an invalid character.');
  if (looksLikeUrl(value)) throw new ApiError('bad-path', LOCATION_URL_SENTENCE);
  // A share is never reached from a local project (it is never stat'ed either).
  if (isUnc(value) && !isUnc(projectReal)) throw new ApiError('bad-path', pickInsideSentence(projectReal, p));
  return p.isAbsolute(value) ? p.resolve(value) : p.resolve(projectReal, ...value.split(/[\\/]+/).filter((part) => part !== ''));
};

/** Step 6 and 7, disk-free: the realpath inside the project, and its project-relative `/` form ('' = the root). */
export const locationInside = (projectReal: string, real: string, p: PathModule = path, platform: NodeJS.Platform = process.platform): string => {
  if (!isInsideOrEqual(projectReal, real, p, platform)) throw new ApiError('bad-path', pickInsideSentence(projectReal, p));
  // Inside under the case rule; the segments below the project keep the realpath's own spelling.
  const project = p.resolve(projectReal);
  const target = p.resolve(real);
  const relative = foldsCase(p, platform) ? p.relative(project.toLowerCase(), target.toLowerCase()) : p.relative(project, target);
  const depth = relative === '' ? 0 : relative.split(p.sep).length;
  const segments = target.split(p.sep).filter((part) => part !== '');
  return depth === 0 ? '' : segments.slice(segments.length - depth).join('/');
};

/**
 * §5.6: a folder inside the project (already a realpath from `validateScanFolder`), as its realpath
 * and its project-relative path. Throws `bad-path` with the sentence for the user.
 */
export const validateLocation = async (raw: unknown, projectReal: string, designsRoot: string): Promise<{ real: string; rel: string }> => {
  const lexical = lexicalLocation(raw, projectReal);
  const real = await validateScanFolder(lexical, designsRoot);
  return { real, rel: locationInside(projectReal, real) };
};

/**
 * A location checked again before it is used (Make, Register): a folder that no longer exists says
 * "That folder is gone."; any other refusal keeps its own sentence.
 */
export const recheckLocation = async (rel: string, projectReal: string, designsRoot: string): Promise<{ real: string; rel: string }> => {
  try {
    return await validateLocation(rel === '' ? projectReal : rel, projectReal, designsRoot);
  } catch (error) {
    const lexical = rel === '' ? projectReal : path.resolve(projectReal, ...rel.split('/'));
    const there = await lstat(lexical).then(() => true, () => false);
    if (!there) throw new ApiError('bad-path', LOCATION_GONE_SENTENCE);
    throw error;
  }
};
