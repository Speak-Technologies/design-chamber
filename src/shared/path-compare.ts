// Disk-free path comparisons (documentation/specs/phase-1-5-sdk-2-7.md §3.7): the one
// implementation of the lexical containment rules. The service's containment module
// (`src/service/paths.ts`) re-exports these with the platform's defaults and builds
// `resolveInside` on top; the guest and the OpenCode plugin import them here, so their bundles
// need no `node:path` (the path module is always passed in, and its type is a type-only import).

import type { PlatformPath } from 'node:path';

/** The subset of a node:path flavour these rules use (`path`, `path.win32` or `path.posix`). */
export type PathModule = Pick<PlatformPath, 'resolve' | 'relative' | 'isAbsolute' | 'join' | 'dirname' | 'basename' | 'parse' | 'sep'>;

/**
 * Whether path comparisons ignore case: the win32 flavour always (NTFS), and darwin, whose
 * default APFS/HFS+ volumes are case-insensitive — `/Users/me/documents` IS `~/Documents`
 * there, so an exact comparison would let a re-cased path slip past "inside home" and
 * "same root" checks. Linux filesystems are case-sensitive: exact. (A darwin user on an
 * opt-in case-sensitive volume gets the folded rule: a symlink to a sibling whose name
 * differs from the root only by case would count as inside — accepted, see
 * docs/testing/PLATFORMS.md.)
 */
export const foldsCase = (p: PathModule, platform: NodeJS.Platform): boolean => p.sep === '\\' || platform === 'darwin';

/** True when a `path.relative` result means "outside": a leading `..` or an absolute path. */
export const isEscaping = (relative: string, p: PathModule): boolean =>
  relative === '..' || relative.startsWith(`..${p.sep}`) || p.isAbsolute(relative);

/** `path.relative` of two resolved paths under the platform's case rule. */
const relativeFolded = (from: string, to: string, p: PathModule, platform: NodeJS.Platform): string => {
  const left = p.resolve(from);
  const right = p.resolve(to);
  return foldsCase(p, platform) ? p.relative(left.toLowerCase(), right.toLowerCase()) : p.relative(left, right);
};

/** Cross-platform absolute-dir equality for one path flavour (case rule per `foldsCase`). */
export const samePath = (a: string, b: string, p: PathModule, platform: NodeJS.Platform): boolean => {
  const left = p.resolve(a);
  const right = p.resolve(b);
  return foldsCase(p, platform) ? left.toLowerCase() === right.toLowerCase() : left === right;
};

/** True when `dir` is `root` itself or a descendant of it (lexical, flavour-aware). */
export const isInsideOrEqual = (root: string, dir: string, p: PathModule, platform: NodeJS.Platform): boolean => {
  const relative = relativeFolded(root, dir, p, platform);
  return relative === '' || !isEscaping(relative, p);
};

/**
 * True when `target` is strictly below `base` (lexical, flavour-aware; case rule per
 * `foldsCase`). The disk-free core of `resolveInside`, for callers that only classify a path
 * (the bundler's reference classifier, the plugin's install check); anything that reads or
 * writes uses `resolveInside`.
 */
export const isStrictlyInside = (base: string, target: string, p: PathModule, platform: NodeJS.Platform): boolean => {
  const relative = relativeFolded(base, target, p, platform);
  return relative !== '' && !isEscaping(relative, p);
};

/**
 * Folder paths from the host and from design.json, compared the way the OS would: either slash,
 * no trailing separator, and case-insensitive when either side carries a Windows drive letter.
 * String-only (no path module), so frames can use it.
 */
export const sameDirectory = (a: string, b: string): boolean => {
  const norm = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const left = norm(a);
  const right = norm(b);
  const windows = /^[A-Za-z]:\//.test(left) || /^[A-Za-z]:\//.test(right);
  return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
};
