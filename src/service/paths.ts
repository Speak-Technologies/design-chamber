// The one path-containment module (docs/SPEC.md §9.1) plus the slug rules (§6.1) and the
// atomic-write helper every service write goes through.
//
// Every path that originates from a request, from design.json, or from a watched filename is
// resolved with `resolveInside` before any filesystem access. It rejects absolute segments,
// NUL, `..` segments, drive letters and UNC prefixes lexically, then defends against
// symlink/junction escapes with `fs.realpath` of the deepest existing ancestor, comparing
// against the realpath'd root (case-insensitively on win32 and darwin — see `foldsCase`).
//
// `PathModule`, `realpath` and the platform are injectable so the win32 and darwin rules are
// testable on any platform via `path.win32` / `path.posix` (SPEC §15.1).

import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync } from 'node:fs';
import { lstat as fsLstat, realpath as fsRealpath, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { SLUG_BASE_MAX, SLUG_FALLBACK, SLUG_PATTERN } from '../shared/limits.ts';
import {
  foldsCase as sharedFoldsCase,
  isEscaping,
  isInsideOrEqual as sharedIsInsideOrEqual,
  isStrictlyInside as sharedIsStrictlyInside,
  samePath as sharedSamePath,
  type PathModule,
} from '../shared/path-compare.ts';
import { ApiError } from './http.ts';

export type { PathModule };

export type ContainmentDeps = {
  /** Path flavour; defaults to the platform's `node:path`. */
  path?: PathModule;
  /** Resolves symlinks/junctions; defaults to `fs.promises.realpath`. */
  realpath?: (target: string) => Promise<string>;
  /** Case-insensitive containment comparison; defaults to `foldsCase(path, platform)`. */
  caseInsensitive?: boolean;
  /** Defaults to `process.platform`; only consulted for the case rule. */
  platform?: NodeJS.Platform;
};

const badPath = (message: string): ApiError => new ApiError('bad-path', message);

// The lexical rules live in src/shared/path-compare.ts (one implementation, also bundled into
// frames and the OpenCode plugin); here they get this platform's `node:path` and
// `process.platform` as defaults.

/** Whether path comparisons ignore case (see `src/shared/path-compare.ts`). */
export const foldsCase = (p: PathModule = path, platform: NodeJS.Platform = process.platform): boolean => sharedFoldsCase(p, platform);

/** Cross-platform absolute-dir equality for one path flavour (case rule per `foldsCase`). */
export const samePath = (a: string, b: string, p: PathModule = path, platform: NodeJS.Platform = process.platform): boolean => sharedSamePath(a, b, p, platform);

/** True when `dir` is `root` itself or a descendant of it (lexical, flavour-aware). */
export const isInsideOrEqual = (root: string, dir: string, p: PathModule = path, platform: NodeJS.Platform = process.platform): boolean =>
  sharedIsInsideOrEqual(root, dir, p, platform);

/**
 * True when `target` is strictly below `base` (lexical, flavour-aware; case rule per
 * `foldsCase`). The disk-free core of `resolveInside`, for callers that only classify a path
 * (the bundler's reference classifier); anything that reads or writes uses `resolveInside`.
 */
export const isStrictlyInside = (base: string, target: string, p: PathModule = path, platform: NodeJS.Platform = process.platform): boolean =>
  sharedIsStrictlyInside(base, target, p, platform);

const defaultRealpath = (target: string): Promise<string> => fsRealpath(target);

/**
 * `fs.realpath` of the deepest existing ancestor of `target`, rejoined with the missing tail.
 * ENOENT walks up; any other filesystem error is surfaced (loud in code).
 */
const realpathDeepestAncestor = async (target: string, p: PathModule, realpath: (t: string) => Promise<string>): Promise<string> => {
  let current = target;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return rest.length === 0 ? real : p.join(real, ...rest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = p.dirname(current);
    if (parent === current) throw badPath('The designs folder does not exist.');
    rest.unshift(p.basename(current));
    current = parent;
  }
};

/**
 * Resolve `segments` under `root`, refusing anything that could leave the root: absolute
 * segments, NUL, `..` segments (in either separator), drive letters (`C:\`, `C:foo`), UNC
 * prefixes (`\\server`, `//server`) — and, through the realpath comparison, symlinks or
 * junctions inside the root that point outside it. Answers the realpath'd absolute path.
 * The root itself must exist; the target below it may not (a file about to be created).
 */
export const resolveInside = async (root: string, segments: readonly string[], deps: ContainmentDeps = {}): Promise<string> => {
  const p = deps.path ?? path;
  const realpath = deps.realpath ?? defaultRealpath;
  const caseInsensitive = deps.caseInsensitive ?? foldsCase(p, deps.platform ?? process.platform);

  if (typeof root !== 'string' || root.trim() === '') throw badPath('The designs folder is not set.');
  if (root.includes('\0')) throw badPath('The designs folder path contains an invalid character.');

  for (const segment of segments) {
    if (typeof segment !== 'string' || segment === '') throw badPath('That path has an empty step, which is not allowed.');
    if (segment.includes('\0')) throw badPath('That path contains an invalid character.');
    if (p.isAbsolute(segment) || /^[A-Za-z]:/.test(segment) || segment.startsWith('\\\\') || segment.startsWith('//')) {
      throw badPath('Only paths inside the designs folder are allowed.');
    }
    // `..` in either separator flavour — a posix flavour must still refuse win32-style walks.
    if (segment.split(/[\\/]+/).some((part) => part === '..')) {
      throw badPath('Paths may not step up out of the designs folder.');
    }
  }

  const rootResolved = p.resolve(root);
  const target = p.resolve(rootResolved, ...segments);
  if (isEscaping(p.relative(rootResolved, target), p)) throw badPath('Only paths inside the designs folder are allowed.');

  let realRoot: string;
  try {
    realRoot = await realpath(rootResolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw badPath('The designs folder does not exist yet.');
    throw error;
  }
  const realTarget = await realpathDeepestAncestor(target, p, realpath);
  const realRelative = caseInsensitive ? p.relative(realRoot.toLowerCase(), realTarget.toLowerCase()) : p.relative(realRoot, realTarget);
  if (isEscaping(realRelative, p)) throw badPath('That path leaves the designs folder, so Design Chamber refuses it.');
  return realTarget;
};

// ---- Plain writable targets (Phase 2 §2.3) ----

/** The sentence every link refusal answers with, at the write and in the page's disabled reason. */
export const LINK_SENTENCE = "This file is a link, so Design Chamber can't edit it here. Ask the agent instead.";

/** The part of `fs.Stats` the plain-target check needs; injectable for tests. */
export type PlainStat = { isFile(): boolean };

export type PlainTargetDeps = ContainmentDeps & {
  /** Does not follow the final link; defaults to `fs.promises.lstat`. */
  lstat?: (target: string) => Promise<PlainStat>;
};

const defaultLstat = (target: string): Promise<PlainStat> => fsLstat(target);

/**
 * Resolve a file the service may write: containment first (`resolveInside`, which refuses
 * links out and answers the realpath), then the realpath compared with the lexical path —
 * that comparison is what catches a link **inside** the design (a leaf link, or a folder on
 * the way), whose realpath stays inside and whose target an `lstat` of the realpath would
 * see as a regular file. A link is refused even when it points inside, because a rename
 * would replace the link, not its target. Finally an `lstat` of the lexical path: a folder,
 * FIFO or device is not editable; an absent leaf is allowed only with `allowAbsent` (a
 * create, a move destination), and any other filesystem error propagates to the caller.
 * Answers the lexical path — what the name says, no link followed.
 */
export const resolvePlainTarget = async (
  base: string,
  segments: readonly string[],
  options: { allowAbsent?: boolean } = {},
  deps: PlainTargetDeps = {},
): Promise<string> => {
  const p = deps.path ?? path;
  const platform = deps.platform ?? process.platform;
  const real = await resolveInside(base, segments, deps);
  const lexical = p.resolve(base, ...segments);
  if (!samePath(real, lexical, p, platform)) throw new ApiError('invalid', LINK_SENTENCE);
  const lstat = deps.lstat ?? defaultLstat;
  let info: PlainStat;
  try {
    info = await lstat(lexical);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && options.allowAbsent === true) return lexical;
    throw error;
  }
  if (!info.isFile()) throw new ApiError('invalid', LINK_SENTENCE);
  return lexical;
};

/** `resolvePlainTarget` succeeded, as a boolean — `GET /source`'s `link` field (Phase 2 §2.2). */
export const isPlainTarget = async (base: string, segments: readonly string[], deps: PlainTargetDeps = {}): Promise<boolean> => {
  try {
    await resolvePlainTarget(base, segments, {}, deps);
    return true;
  } catch {
    return false;
  }
};

// ---- Slugs (§6.1, §9.1) ----

export const isSlug = (value: unknown): value is string => typeof value === 'string' && SLUG_PATTERN.test(value);

/** Throws `bad-slug` unless `value` is a design folder name. */
export const assertSlug = (value: unknown): string => {
  if (!isSlug(value)) throw new ApiError('bad-slug', 'That is not a design name.');
  return value;
};

/** Device names Windows reserves in every folder (`con`, `nul`, `com1`…): a design folder must never be one. */
export const isWindowsReservedName = (name: string): boolean => /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name);

/**
 * Title → slug base: NFKD, fold diacritics to ASCII, kebab-case, ≤ `SLUG_BASE_MAX` cut at a word
 * boundary (a hard cut only when the first word alone is that long), fallback `design`; a
 * Windows device name gets `-design`.
 */
export const slugify = (title: string): string => {
  const folded = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const kebab = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let base = kebab;
  if (kebab.length > SLUG_BASE_MAX) {
    const cut = kebab.slice(0, SLUG_BASE_MAX + 1);
    const lastDash = cut.lastIndexOf('-');
    base = (lastDash > 0 ? cut.slice(0, lastDash) : cut.slice(0, SLUG_BASE_MAX)).replace(/-+$/g, '');
  }
  if (!isSlug(base)) return SLUG_FALLBACK;
  return isWindowsReservedName(base) ? `${base}-design` : base;
};

/** First free slug: `base`, then `base-2`, `base-3`, … (SPEC §6.1). */
export const uniqueSlug = async (base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> => {
  const start = isSlug(base) && !isWindowsReservedName(base) ? base : SLUG_FALLBACK;
  if (!(await isTaken(start))) return start;
  for (let suffix = 2; suffix <= 1000; suffix += 1) {
    const candidate = `${start}-${suffix}`;
    if (!isSlug(candidate)) break; // beyond the 63-char slug pattern
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new ApiError('conflict', 'Too many designs share this name. Choose a different title.');
};

// ---- Atomic writes ----

/** Rename tries before a Windows refusal is final: pauses of 40, 80, 120, 160 ms (400 ms in all). */
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 40;

/** The codes Windows answers a rename with while another handle has the target open for a moment. */
const isTransientRenameRefusal = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
};

/**
 * Rename `from` to `to`, retrying a few times when Windows refuses because another handle has
 * the target (or the fresh source: an antivirus scan) open for a moment. A refusal that outlasts
 * the retries, and any other error, is thrown.
 */
export const renameWithRetry = async (from: string, to: string): Promise<void> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !isTransientRenameRefusal(error)) throw error;
      await delay(RENAME_RETRY_MS * attempt);
    }
  }
};

/** `<name>.<12 hex>.tmp`, with or without the leading dot: the temp names of the service's atomic writers (older builds left no dot). */
const ATOMIC_TEMP_PATTERN = /\.[0-9a-f]{12}\.tmp$/;

/** True for a file name the service's atomic writers use for a half-written file: never a design file. */
export const isAtomicTempName = (name: string): boolean => ATOMIC_TEMP_PATTERN.test(name);

/**
 * A temp path in the same folder as `target` (so the rename stays on one volume and is atomic),
 * dot-prefixed so the watcher and the tracked-file rules skip it: `.index.html.2bba59ef828e.tmp`.
 */
export const atomicTempPath = (target: string): string =>
  path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`);

/**
 * Write a file via tmp + rename in its own folder (a partial write is never visible, and the
 * tmp name is dot-prefixed so the watcher ignores it — SPEC §9.4). Creates parent folders
 * unless `createDirs` is false.
 *
 * Windows refuses to rename over a file another handle has open (EPERM/EBUSY/EACCES): a list
 * refresh reading state.json, an agent or an antivirus scan. The rename is retried a few
 * times (`renameWithRetry`), so that moment does not fail the caller — a failed watcher reconcile
 * is not run again until the agent's next change, which would leave a design provisional.
 * Replacing the file with the same bytes is idempotent, so the retry is safe.
 */
export const writeFileAtomic = async (file: string, data: string | Uint8Array, options: { createDirs?: boolean } = {}): Promise<void> => {
  const dir = path.dirname(file);
  // `createDirs: false` is for a writer into a folder somebody else may delete meanwhile (a design the user
  // removed): a missing folder then fails with ENOENT instead of being recreated as a partial design.
  if (options.createDirs !== false) await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await writeFile(tmp, data);
    await renameWithRetry(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
};

/**
 * Atomic write that replaces `file` only while it still holds `expected` (`null` = absent);
 * false when another writer changed it first or holds it locked, and nothing is written. The final
 * compare + rename runs synchronously, so the window another writer can slip into shrinks to
 * the rename itself (the two-writer merge of design.json, §6.3).
 */
export const replaceFileIfUnchanged = async (file: string, expected: string | null, data: string): Promise<boolean> => {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await writeFile(tmp, data);
  try {
    let current: string | null | undefined;
    try {
      current = readFileSync(file, 'utf8');
    } catch (error) {
      // Unreadable right now (e.g. EBUSY while the other writer holds it): treated as changed.
      current = (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
    }
    if (current !== expected) {
      await rm(tmp, { force: true });
      return false;
    }
    try {
      renameSync(tmp, file);
    } catch (error) {
      // Windows refuses to replace a file another process is reading this instant: not
      // replaced yet, the caller retries.
      if (!isTransientRenameRefusal(error)) throw error;
      await rm(tmp, { force: true });
      return false;
    }
    return true;
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
};
