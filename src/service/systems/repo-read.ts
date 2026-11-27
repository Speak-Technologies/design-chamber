// Reading a repo's system folder into memory (Phase 2.5 §5.10 steps 1 to 3, §7.4, AD-14, AD-18, AD-23).
// Shared by the snapshot refresh (`snapshot.ts`) and the repo re-sync scan (`extract.ts`, purpose
// `repo-resync`), so what a user reviews is read exactly like what an agent's stamp reads.
//
// Read-only on the repo: the folder is walked with discovery's walker (lstat-based, links never
// followed or listed, the §7.1 caps and deadline), secret names are never opened, and every file is
// read through `readProjectFile` (no link on the way, O_NOFOLLOW at the leaf). Nothing here opens a
// file for writing; the caller writes only under `_systems/<id>/`.
//
// A read is complete or refused: only contract paths are kept (`isSystemContractRel`), each checked
// like its internal counterpart (text: UTF-8, no NUL, its cap; binaries: `checkAsset`); a refused file
// is listed in `skipped` and left out. Over the file or byte cap nothing is kept (`too-large`). The
// kept files' size and mtime are compared before and after the read: moved → read once more, still
// moved → `being-changed`.

import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { RepoResyncReview } from '../../shared/types.ts';
import {
  SCAN_DEPTH_MAX,
  SCAN_ENTRIES_MAX,
  SCAN_TIME_MS,
  SNAPSHOT_SKIPPED_MAX,
  SYSTEM_BYTES_MAX,
  SYSTEM_EXAMPLE_MAX,
  SYSTEM_FILES_MAX,
  SYSTEM_JSON_MAX_BYTES,
  SYSTEM_NOTE_MAX,
  SYSTEM_OVERVIEW_MAX,
  TOKENS_CSS_MAX_BYTES,
} from '../../shared/limits.ts';
import { tokenValues } from '../../shared/system-copy.ts';
import { isSystemContractRel } from '../../shared/system-json.ts';
import { walk, withDeadline } from '../discovery.ts';
import { resolveInside, resolvePlainTarget, samePath } from '../paths.ts';
import { treeHashOf } from '../versions.ts';
import { checkAsset, type AssetKind } from './assets.ts';
import { isSecretName } from './extract-rules.ts';
import { ASSET_READ_MAX, readProjectFile } from './project-file.ts';

export type RepoProblemReason = 'missing' | 'not-a-folder' | 'unreadable' | 'folder-missing' | 'too-large' | 'being-changed';

/** A complete read of the folder: every kept file's bytes, keyed by contract-relative path. */
export type RepoRead = {
  kind: 'read';
  /** The repo's realpath. */
  directory: string;
  folder: string;
  files: Map<string, Buffer>;
  /** sha256 per kept file: the snapshot's `SNAPSHOT.json` `files`. */
  hashes: Record<string, string>;
  /** The content set's tree hash, as the store computes it over `snapshot/` once written. */
  treeHash: string;
  /** Non-contract files in the folder (not read). */
  ignored: number;
  /** Refused contract files (≤ `SNAPSHOT_SKIPPED_MAX`) and how many there were in all. */
  skipped: { path: string; reason: string }[];
  refused: number;
  livingPageFound: boolean;
};

export type RepoReadOutcome = RepoRead | { kind: 'problem'; reason: RepoProblemReason };

export type RepoReadInput = {
  /** The repo folder as the home (or the user's re-point) names it. */
  directory: string;
  folder: string;
  /** Repo-relative path of the committed living page. */
  livingPage: string;
  signal?: AbortSignal;
  now?: () => number;
  /** Test seam: runs between the two tree checks of each attempt (a test changes a file there). */
  betweenChecks?: (attempt: number) => Promise<void>;
};

const SKIP_SECRET = 'Its name looks like a secret, so it was not read.';
const SKIP_LINK = 'It is a link, so it was not read.';
const SKIP_UNREADABLE = "Design Chamber can't open it.";
const SKIP_NOT_TEXT = "It isn't plain UTF-8 text.";
const skipTooLarge = (rel: string): string => `${path.posix.basename(rel)} is too large.`;

/** A body is read up to 4 bytes per character of its cap (as the store does). */
const BYTES_PER_CHAR_MAX = 4;

/** The cap of a text contract file; null for a binary one (fonts, logos, sources). */
const textCapOf = (rel: string): number | null => {
  if (rel === 'system.json') return SYSTEM_JSON_MAX_BYTES;
  if (rel === 'tokens.css') return TOKENS_CSS_MAX_BYTES;
  if (rel === 'OVERVIEW.md') return SYSTEM_OVERVIEW_MAX * BYTES_PER_CHAR_MAX;
  // Live examples, components' and (system-builder-depth D4) pattern and brand entries': the example cap.
  if (/^(components|patterns|brand)\/[^/]+\.html$/.test(rel)) return SYSTEM_EXAMPLE_MAX * BYTES_PER_CHAR_MAX;
  if (/^(notes|patterns|brand)\//.test(rel)) return SYSTEM_NOTE_MAX * BYTES_PER_CHAR_MAX;
  if (rel.startsWith('components/')) return SYSTEM_EXAMPLE_MAX * BYTES_PER_CHAR_MAX;
  return null;
};

const kindOf = (rel: string): AssetKind => (rel.startsWith('assets/fonts/') ? 'font' : rel.startsWith('assets/logos/') ? 'logo' : 'source');

const isPlainText = (bytes: Buffer): boolean => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

class ReadStopped extends Error {}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The repo's realpath and the folder's absolute path, or the §5.10 step 1 problem. */
const locate = async (input: RepoReadInput): Promise<{ repoReal: string; folderAbs: string } | { problem: RepoProblemReason }> => {
  if (!path.isAbsolute(input.directory)) return { problem: 'missing' };
  // The home stores a realpath and a re-point passed `validateScanFolder`; resolved again here, read-only.
  let repoReal: string;
  try {
    repoReal = await realpath(input.directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { problem: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable' };
  }
  const info = await lstat(repoReal).catch((error: unknown) => (error as NodeJS.ErrnoException).code ?? 'error');
  if (info === 'ENOENT' || info === 'ENOTDIR') return { problem: 'missing' };
  if (typeof info === 'string') return { problem: 'unreadable' };
  if (!info.isDirectory()) return { problem: 'not-a-folder' };
  // A real folder, reached without a link on the way (a link is never read through).
  const segments = input.folder.split('/');
  const folderAbs = path.resolve(repoReal, ...segments);
  const folderReal = await resolveInside(repoReal, segments).catch(() => null);
  if (folderReal === null || !samePath(folderReal, folderAbs)) return { problem: 'folder-missing' };
  const folderInfo = await lstat(folderAbs).catch(() => null);
  if (folderInfo === null || !folderInfo.isDirectory()) return { problem: 'folder-missing' };
  const listable = await readdir(folderAbs).then(() => true, () => false);
  if (!listable) return { problem: 'unreadable' };
  return { repoReal, folderAbs };
};

type Attempt = RepoRead | { kind: 'problem'; reason: RepoProblemReason } | { kind: 'moved' };

/** Size and mtime of each listed file (the §5.10 step 3 tree check), and their total size. */
const treeOf = async (folderAbs: string, rels: readonly string[]): Promise<{ tree: string; bytes: number }> => {
  const parts: string[] = [];
  let bytes = 0;
  for (const rel of rels) {
    const info = await lstat(path.join(folderAbs, ...rel.split('/'))).catch(() => null);
    if (info !== null) bytes += info.size;
    parts.push(`${rel}\0${info === null ? 'gone' : `${info.isFile() ? 'f' : 'x'}:${info.size}:${info.mtimeMs}`}`);
  }
  return { tree: parts.join('\n'), bytes };
};

const attemptRead = async (input: RepoReadInput, repoReal: string, folderAbs: string, attempt: number): Promise<Attempt> => {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const left = (): number => Math.max(0, SCAN_TIME_MS - (now() - startedAt));
  const stopIfAborted = (): void => {
    if (input.signal?.aborted === true) throw new ReadStopped();
  };
  const links: string[] = [];
  const walked = await walk(folderAbs, {
    depth: SCAN_DEPTH_MAX,
    entries: SCAN_ENTRIES_MAX,
    expired: () => input.signal?.aborted === true || left() <= 0,
    list: async (abs): Promise<Dirent[] | null> => {
      const listed = await withDeadline(readdir(abs, { withFileTypes: true }).catch(() => null), left(), null);
      if (listed !== null) {
        const relDir = path.relative(folderAbs, abs).split(path.sep).filter((part) => part !== '').join('/');
        for (const entry of listed) if (entry.isSymbolicLink()) links.push(relDir === '' ? entry.name : `${relDir}/${entry.name}`);
      }
      return listed;
    },
  });
  stopIfAborted();
  // A walk cut short would make a partial snapshot: there are none.
  if (walked.truncated) return { kind: 'problem', reason: 'too-large' };

  const folderPrefix = `${input.folder}/`;
  const livingInside = input.livingPage.startsWith(folderPrefix) ? input.livingPage.slice(folderPrefix.length) : null;
  const skipped: { path: string; reason: string }[] = [];
  let ignored = 0;
  const candidates: string[] = [];
  for (const rel of walked.files) {
    if (rel === livingInside) continue; // the committed living page is the service's own output
    if (!isSystemContractRel(rel)) {
      ignored += 1;
      continue;
    }
    if (isSecretName(rel)) {
      skipped.push({ path: rel, reason: SKIP_SECRET });
      continue;
    }
    candidates.push(rel);
  }
  for (const rel of links) {
    if (isSystemContractRel(rel)) skipped.push({ path: rel, reason: SKIP_LINK });
    else ignored += 1;
  }
  candidates.sort();
  if (candidates.length > SYSTEM_FILES_MAX) return { kind: 'problem', reason: 'too-large' };

  const before = await treeOf(folderAbs, candidates);
  if (before.bytes > SYSTEM_BYTES_MAX) return { kind: 'problem', reason: 'too-large' };

  const files = new Map<string, Buffer>();
  const hashes: Record<string, string> = {};
  for (const rel of candidates) {
    stopIfAborted();
    if (left() <= 0) return { kind: 'problem', reason: 'too-large' };
    const textCap = textCapOf(rel);
    const cap = textCap ?? ASSET_READ_MAX;
    const info = await lstat(path.join(folderAbs, ...rel.split('/'))).catch(() => null);
    if (info === null || !info.isFile()) {
      skipped.push({ path: rel, reason: SKIP_UNREADABLE });
      continue;
    }
    if (info.size > cap) {
      skipped.push({ path: rel, reason: skipTooLarge(rel) });
      continue;
    }
    const bytes = await withDeadline(readProjectFile(folderAbs, rel, cap), left(), null);
    if (bytes === null) {
      skipped.push({ path: rel, reason: SKIP_UNREADABLE });
      continue;
    }
    if (textCap !== null) {
      if (!isPlainText(bytes)) {
        skipped.push({ path: rel, reason: SKIP_NOT_TEXT });
        continue;
      }
    } else {
      const check = checkAsset(path.posix.basename(rel), kindOf(rel), bytes);
      if (!check.ok) {
        skipped.push({ path: rel, reason: check.reason });
        continue;
      }
    }
    files.set(rel, bytes);
    hashes[rel] = sha256Of(bytes);
  }
  await input.betweenChecks?.(attempt);
  const after = await treeOf(folderAbs, candidates);
  if (after.tree !== before.tree) return { kind: 'moved' };

  const livingPageFound = await resolvePlainTarget(repoReal, input.livingPage.split('/'))
    .then(async (file) => (await lstat(file)).isFile())
    .catch(() => false);
  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    kind: 'read',
    directory: repoReal,
    folder: input.folder,
    files,
    hashes,
    treeHash: treeHashOf(hashes),
    ignored,
    skipped: skipped.slice(0, SNAPSHOT_SKIPPED_MAX),
    refused: skipped.length,
    livingPageFound,
  };
};

/**
 * The repo's system folder, read whole into memory (§5.10 steps 1 to 3), or the problem that stopped
 * it. Throws `RepoReadStopped` when `signal` aborts (a root change or a cancelled scan).
 */
export const readRepoSystem = async (input: RepoReadInput): Promise<RepoReadOutcome> => {
  const located = await locate(input);
  if ('problem' in located) return { kind: 'problem', reason: located.problem };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await attemptRead(input, located.repoReal, located.folderAbs, attempt);
    if (outcome.kind !== 'moved') return outcome;
  }
  return { kind: 'problem', reason: 'being-changed' };
};

export { ReadStopped as RepoReadStopped };

// ---- the repo re-sync review (pure, §7.4) ----

const REVIEW_TOKENS_MAX = 200;
const REVIEW_FILES_MAX = 50;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The snapshot as it stands (null = none yet: everything in the read is New). */
export type CurrentSnapshot = { hashes: Record<string, string>; tokensCss: string | null } | null;

/**
 * `RepoResyncReview` (§4.3): token changes per mode, added and removed tokens, changed, added and
 * removed content files (not `tokens.css`). No provenance and no conflicts: the repo is the authority.
 */
export const repoResyncReview = (current: CurrentSnapshot, read: RepoRead | null, facts: { directory: string; directoryChanged: boolean; folderFound: boolean; livingPageFound: boolean }): RepoResyncReview => {
  const oldTokens = tokenValues(current?.tokensCss ?? null);
  const newCss = read?.files.get('tokens.css');
  const newTokens = tokenValues(newCss === undefined ? null : newCss.toString('utf8'));
  const changed: RepoResyncReview['tokens']['changed'] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const name of [...newTokens.keys()].sort(byText)) {
    const before = oldTokens.get(name);
    const after = newTokens.get(name);
    if (after === undefined) continue;
    if (before === undefined) {
      added.push(name);
      continue;
    }
    for (const mode of ['light', 'dark'] as const) {
      if (before[mode] !== after[mode]) changed.push({ name, mode, from: before[mode] ?? '', to: after[mode] ?? '' });
    }
  }
  for (const name of [...oldTokens.keys()].sort(byText)) if (!newTokens.has(name)) removed.push(name);

  const oldFiles = current?.hashes ?? {};
  const newFiles = read?.hashes ?? {};
  const files: RepoResyncReview['files'] = { changed: [], added: [], removed: [] };
  for (const rel of Object.keys(newFiles).sort(byText)) {
    if (rel === 'tokens.css') continue;
    const before = oldFiles[rel];
    if (before === undefined) files.added.push(rel);
    else if (before !== newFiles[rel]) files.changed.push(rel);
  }
  for (const rel of Object.keys(oldFiles).sort(byText)) if (rel !== 'tokens.css' && newFiles[rel] === undefined) files.removed.push(rel);

  return {
    kind: 'repo',
    directory: facts.directory,
    directoryChanged: facts.directoryChanged,
    folderFound: facts.folderFound,
    tokens: {
      changed: changed.slice(0, REVIEW_TOKENS_MAX),
      added: added.slice(0, REVIEW_TOKENS_MAX),
      removed: removed.slice(0, REVIEW_TOKENS_MAX),
      totals: { changed: changed.length, added: added.length, removed: removed.length },
    },
    files: { changed: files.changed.slice(0, REVIEW_FILES_MAX), added: files.added.slice(0, REVIEW_FILES_MAX), removed: files.removed.slice(0, REVIEW_FILES_MAX) },
    livingPageFound: facts.livingPageFound,
    refused: read?.refused ?? 0,
    skipped: read?.skipped ?? [],
  };
};

/** The apply's counts and whether the review lists anything at all (nothing → "Acme already matches shop."). */
export const repoReviewCounts = (review: RepoResyncReview): { changed: number; added: number; removed: number } => ({
  changed: review.tokens.totals.changed + review.files.changed.length,
  added: review.tokens.totals.added + review.files.added.length,
  removed: review.tokens.totals.removed + review.files.removed.length,
});
