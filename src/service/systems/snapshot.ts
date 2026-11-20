// Phase 2.5 (documentation/specs/phase-2-5-technical.md §5.10, §7.4, AD-14, AD-18, AD-33): a repo-backed
// system's `_systems/<id>/snapshot/`, read from the repo's system folder.
//
// The read is `repo-read.ts` (read-only on the repo, contract paths only, complete or refused). Here:
// the version first (`repo-read` for the agent's stamp and the first read, `resync` for a user's
// re-sync; never coalesced), a staged copy under `.chamber/snapshot-incoming-<rand>/` with
// `SNAPSHOT.json` written last, and the swap exactly as the copy swap (§5.4 step 6): the old folder to
// `.chamber/snapshot-replaced-<rand>/`, the staging into place, put back on failure. Self-writes are
// recorded before the first rename, so the watcher never reads the swap as tampering. Then
// `state.snapshot`, the revision (a service write needs no quiet wait), the living page and the drift.
//
// A repo re-sync (`POST /systems/:id/resync` on a repo home) applies what the scan job read, all or
// nothing, with no Undo (AD-33): no undo record is written, and Restore stays refused (AD-20).
//
// Every write here lands under `_systems/<id>/` (guarded, §5.13); nothing opens a repo file for writing.

import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { SystemResyncResponse } from '../../shared/api.ts';
import { SCAN_ID_PATTERN, SOURCE_TEXT_MAX, SYSTEM_ID_PATTERN } from '../../shared/limits.ts';
import { repoProblemText, SYSTEMS_DIR } from '../../shared/system-json.ts';
import type { SystemState, VersionEntry } from '../../shared/types.ts';
import type { Logger, ServiceContext } from '../context.ts';
import { ApiError } from '../http.ts';
import { LINK_SENTENCE, renameWithRetry, resolveInside, samePath, writeFileAtomic } from '../paths.ts';
import { toSummary, treeHashOf, type UserEditReason } from '../versions.ts';
import { systemSelfWritesKey } from '../watch.ts';
import { recomputeDrift } from './drift.ts';
import { resyncStaleMessage } from './edits.ts';
import { ensureScanJobs, RESYNC_ROOT_CHANGED_MESSAGE } from './extract.ts';
import { regenerateLivingPage } from './living-page.ts';
import { readRepoSystem, repoReviewCounts, type RepoProblemReason, type RepoReadOutcome } from './repo-read.ts';
import { ensureSystemStore, guardSystemWrite, repoLabelOf } from './store.ts';
import { ensureSystemVersions } from './versions.ts';

export const SNAPSHOT_DIR = 'snapshot';
export const SNAPSHOT_JSON = 'SNAPSHOT.json';
const STAGING_PREFIX = 'snapshot-incoming-';
const REPLACED_PREFIX = 'snapshot-replaced-';
/** SNAPSHOT.json lists ≤ 200 files and ≤ 50 skipped: far below this. */
const SNAPSHOT_JSON_MAX_BYTES = 1024 * 1024;
const SNAPSHOT_WALK_DEPTH_MAX = 6;

// ---- sentences ----

/** §5.10 tamper rule: what a link answers while the snapshot holds bytes Design Chamber didn't put there. */
export const snapshotTamperedMessage = (name: string): string => `${name}'s snapshot was changed outside Design Chamber. Re-sync it first.`;
const swapBusyMessage = (name: string): string => `Design Chamber couldn't replace ${name}'s snapshot because a file in it is in use. Close it and try again.`;
const notRepoMessage = (name: string): string => `${name} isn't read from a project folder, so there is nothing to re-sync from.`;
const REPO_RESYNC_BAD_MESSAGE = "Design Chamber couldn't read that re-sync. Scan again.";
const resyncedLabel = (name: string, repo: string, counts: { changed: number; added: number; removed: number }): string =>
  `Re-synced ${name} from ${repo}: ${counts.changed} changed, ${counts.added} added, ${counts.removed} removed.`;
const matchesLabel = (name: string, repo: string): string => `${name} already matches ${repo}.`;

// ---- helpers ----

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;
const messageOf = (error: unknown): string => (error instanceof Error ? error.name : 'error');

type RepoHome = Extract<NonNullable<SystemState['home']>, { kind: 'repo' }>;

/** `SNAPSHOT.json` (§5.10): what was read, from where, by whom. Service-written, never read back as content. */
type SnapshotRecord = {
  v: 1;
  directory: string;
  folder: string;
  at: string;
  by: 'agent' | 'user';
  files: Record<string, string>;
  treeHash: string;
  ignored: number;
  skipped: { path: string; reason: string }[];
};

/** `.chamber` of a system, made without recursion (a deleted system is never recreated). */
const chamberOf = async (systemDir: string): Promise<string> => {
  const chamber = path.join(systemDir, '.chamber');
  try {
    await mkdir(chamber);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') throw new ApiError('not-found', 'That design system is no longer in your Designs folder.');
    if (codeOf(error) !== 'EEXIST') throw error;
  }
  const info = await lstat(chamber);
  if (!info.isDirectory()) throw new ApiError('invalid', LINK_SENTENCE);
  return resolveInside(systemDir, ['.chamber']);
};

/** Every plain file under `dir`, relative, links never followed (the old snapshot's file list). */
const listFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    const entries = await readdir(rel === '' ? dir : path.join(dir, ...rel.split('/')), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory() && depth < SNAPSHOT_WALK_DEPTH_MAX) await walk(child, depth + 1);
      else if (entry.isFile()) out.push(child);
    }
  };
  await walk('', 0);
  return out;
};

/** What a link or a folder where `snapshot/` should be reads as: never swapped through. */
const liveKind = async (systemDir: string): Promise<'absent' | 'folder' | 'other'> => {
  const info = await lstat(path.join(systemDir, SNAPSHOT_DIR)).catch(() => null);
  if (info === null) return 'absent';
  return info.isDirectory() && !info.isSymbolicLink() ? 'folder' : 'other';
};

const readRecordIn = async (dir: string): Promise<SnapshotRecord | null> => {
  const file = path.join(dir, SNAPSHOT_JSON);
  const info = await lstat(file).catch(() => null);
  if (info === null || !info.isFile() || info.size > SNAPSHOT_JSON_MAX_BYTES) return null;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<SnapshotRecord> | null;
    if (parsed === null || typeof parsed !== 'object' || parsed.v !== 1 || typeof parsed.treeHash !== 'string' || parsed.files === null || typeof parsed.files !== 'object') return null;
    return parsed as SnapshotRecord;
  } catch {
    return null;
  }
};

/** A staging is complete when its SNAPSHOT.json parses and every file it lists is there. */
const isComplete = async (stagingDir: string): Promise<boolean> => {
  const record = await readRecordIn(stagingDir);
  if (record === null) return false;
  for (const rel of Object.keys(record.files)) {
    const info = await lstat(path.join(stagingDir, ...rel.split('/'))).catch(() => null);
    if (info === null || !info.isFile()) return false;
  }
  return true;
};

// ---- recovery (§5.10 step 5: mirrors `recoverCopy`) ----

/**
 * Finish or undo a snapshot swap a restart interrupted, so a system keeps its old snapshot or the
 * new one, never neither: with no `snapshot/`, a complete staging is renamed into place, else a
 * replaced snapshot is renamed back. Every other leftover is Design Chamber's own and is removed.
 */
export const recoverSnapshot = async (systemDir: string): Promise<void> => {
  const chamber = path.join(systemDir, '.chamber');
  const entries = await readdir(chamber, { withFileTypes: true }).catch(() => []);
  const staged = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(STAGING_PREFIX)).map((entry) => path.join(chamber, entry.name));
  const replaced = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(REPLACED_PREFIX)).map((entry) => path.join(chamber, entry.name));
  if (staged.length === 0 && replaced.length === 0) return;
  let used: string | null = null;
  if ((await liveKind(systemDir)) === 'absent') {
    for (const candidate of staged) {
      if (await isComplete(candidate)) {
        used = candidate;
        break;
      }
    }
    used ??= replaced[0] ?? null;
    if (used !== null) await renameWithRetry(used, path.join(systemDir, SNAPSHOT_DIR));
  }
  for (const leftover of [...staged, ...replaced]) if (leftover !== used) await rm(leftover, { recursive: true, force: true });
};

/** Every system under the root with swap leftovers, recovered (service start). Never throws. */
export const recoverAllSnapshots = async (root: string, log: Logger): Promise<void> => {
  const systemsDir = path.join(root, SYSTEMS_DIR);
  const info = await lstat(systemsDir).catch(() => null);
  if (info === null || !info.isDirectory()) return;
  const entries = await readdir(systemsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !SYSTEM_ID_PATTERN.test(entry.name)) continue;
    try {
      await recoverSnapshot(await resolveInside(root, [SYSTEMS_DIR, entry.name]));
    } catch (error) {
      log.warn('systems.snapshot-recover-failed', { system: entry.name, error: messageOf(error) });
    }
  }
};

// ---- the swap ----

type SwapDeps = { rename?: typeof renameWithRetry };

/** Test seam (swap failure): the rename the swap uses. */
const swapSeams = new WeakMap<ServiceContext, SwapDeps>();
export const setSnapshotSwapSeam = (ctx: ServiceContext, deps: SwapDeps): void => {
  swapSeams.set(ctx, deps);
};

/**
 * Stage `files` (and `record`, last), then swap them in for `snapshot/`. `files` null removes the
 * snapshot instead (a home change before the first stamp, §5.10 rev 3). Answers the system-relative
 * paths that changed (for the `system files` event).
 */
const swapSnapshot = async (ctx: ServiceContext, id: string, name: string, systemDir: string, files: ReadonlyMap<string, Buffer> | null, record: Buffer | null): Promise<string[]> => {
  const rename = swapSeams.get(ctx)?.rename ?? renameWithRetry;
  const { log, selfWrites } = ctx;
  const root = ctx.settings.root();
  const kind = await liveKind(systemDir);
  if (kind === 'other') throw new ApiError('invalid', LINK_SENTENCE);
  const chamber = await chamberOf(systemDir);
  const live = path.join(systemDir, SNAPSHOT_DIR);
  const token = randomBytes(6).toString('hex');
  const now: Record<string, { sha: string; size: number }> = {};
  let staging: string | null = null;
  if (files !== null && record !== null) {
    staging = path.join(chamber, `${STAGING_PREFIX}${token}`);
    await guardSystemWrite(root, staging, id, log);
    await mkdir(staging);
    try {
      for (const [rel, bytes] of files) {
        const target = await resolveInside(staging, rel.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFileAtomic(target, bytes, { createDirs: false });
        now[rel] = { sha: sha256(bytes), size: bytes.length };
      }
      // SNAPSHOT.json last: a staging without it is incomplete, so recovery never publishes half a snapshot.
      await writeFileAtomic(path.join(staging, SNAPSHOT_JSON), record, { createDirs: false });
      now[SNAPSHOT_JSON] = { sha: sha256(record), size: record.length };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  // The watcher must see these as Design Chamber's own writes (no tamper): recorded first. A file
  // over the self-write size cap is recorded without a size, so it is matched by its hash.
  const old = kind === 'folder' ? await listFiles(live) : [];
  const key = systemSelfWritesKey(id);
  for (const rel of old) if (now[rel] === undefined) selfWrites.record(key, `${SNAPSHOT_DIR}/${rel}`, null, null);
  for (const [rel, file] of Object.entries(now)) selfWrites.record(key, `${SNAPSHOT_DIR}/${rel}`, file.sha, file.size > SOURCE_TEXT_MAX ? null : file.size);

  let replaced: string | null = null;
  if (kind === 'folder') {
    replaced = path.join(chamber, `${REPLACED_PREFIX}${token}`);
    try {
      await rename(live, replaced);
    } catch (error) {
      if (staging !== null) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      log.warn('systems.snapshot-swap-busy', { system: id, step: 'move-old', code: codeOf(error) ?? 'error' });
      throw new ApiError('conflict', swapBusyMessage(name));
    }
  }
  if (staging !== null) {
    try {
      await rename(staging, live);
    } catch (error) {
      // Put the old snapshot back, so the system keeps what it had.
      if (replaced !== null) await renameWithRetry(replaced, live).catch((back: unknown) => log.error('systems.snapshot-restore-failed', { system: id, code: codeOf(back) ?? 'error' }));
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      log.warn('systems.snapshot-swap-busy', { system: id, step: 'publish', code: codeOf(error) ?? 'error' });
      throw new ApiError('conflict', swapBusyMessage(name));
    }
  }
  // The version taken first holds the old snapshot's bytes; this folder is Design Chamber's own.
  if (replaced !== null) await rm(replaced, { recursive: true, force: true }).catch((error: unknown) => log.warn('systems.snapshot-cleanup-failed', { system: id, error: messageOf(error) }));
  return [...new Set([...old, ...Object.keys(now)])].sort().map((rel) => `${SNAPSHOT_DIR}/${rel}`);
};

// ---- the refresh (§5.10) ----

export type RefreshOptions = {
  by: 'agent' | 'user';
  /** A user's repo re-sync: the bytes come from that scan job's memory (what was reviewed). */
  scanId?: string;
  /** The stamp the user's sheet was made against: the snapshot's treeHash, or `"none"`. */
  stamp?: string;
  /** A re-point: read from here (already through `validateScanFolder` in the scan job). */
  directory?: string;
};

export type RefreshOutcome =
  | { kind: 'refreshed'; version: VersionEntry | null; files: string[]; directory: string; directoryChanged: boolean }
  | { kind: 'unchanged'; directory: string; directoryChanged: boolean }
  | { kind: 'problem'; reason: RepoProblemReason }
  | { kind: 'skipped' };

/** A precheck that finds nothing to replace: no version, no revision (§5.10 step 4). */
class Unchanged extends Error {}

type Source = { read: RepoReadOutcome; root: string; directory: string; directoryChanged: boolean; jobStamp: string | null };

const sourceOf = async (ctx: ServiceContext, id: string, home: RepoHome, options: RefreshOptions): Promise<Source> => {
  if (options.scanId !== undefined) {
    const job = ensureScanJobs(ctx).repoResyncSource(options.scanId, id); // 404 expired, 409 running / other system / other root
    return {
      read: job.read ?? { kind: 'problem', reason: 'folder-missing' },
      root: job.root,
      directory: job.directory,
      directoryChanged: job.directoryChanged,
      jobStamp: job.stamp,
    };
  }
  const root = ctx.settings.root();
  const directory = options.directory ?? home.directory;
  const abort = new AbortController();
  const unsubscribe = ctx.settings.onRootChange(() => abort.abort());
  try {
    const read = await readRepoSystem({ directory, folder: home.folder, livingPage: home.livingPage, signal: abort.signal });
    const real = read.kind === 'read' ? read.directory : directory;
    return { read, root, directory: real, directoryChanged: !samePath(real, home.directory), jobStamp: null };
  } finally {
    unsubscribe();
  }
};

const emitState = (ctx: ServiceContext, id: string): void => {
  ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'state' });
};

/** After a refresh landed: the living page (T14) and the code drift (§5.12); each failure is logged only. */
const afterRefresh = async (ctx: ServiceContext, id: string, regenerate: boolean): Promise<void> => {
  // try/await, not `.catch`: a seam may throw before it returns a promise.
  if (regenerate) {
    try {
      await regenerateLivingPage(ctx, id, { source: 'snapshot' });
    } catch (error) {
      ctx.log.warn('systems.snapshot.living-page-failed', { system: id, error: messageOf(error) });
    }
  }
  try {
    await recomputeDrift(ctx, id);
  } catch (error) {
    ctx.log.warn('systems.snapshot.drift-failed', { system: id, error: messageOf(error) });
  }
};

/**
 * §5.10: read the repo's system folder and replace `snapshot/` with it, or record the problem that
 * stopped it (the last snapshot stands). An agent's refresh answers the problem; a user's re-sync
 * throws its sentence. Never call it inside `systems.withLock` (the version takes that lock).
 */
export const refreshSnapshot = async (ctx: ServiceContext, id: string, options: RefreshOptions): Promise<RefreshOutcome> => {
  const systems = ensureSystemStore(ctx);
  const versions = ensureSystemVersions(ctx);
  const state = await systems.readState(id);
  const home = state.home;
  if (home?.kind !== 'repo') {
    if (options.by === 'user') throw new ApiError('invalid', notRepoMessage(state.name));
    return { kind: 'skipped' };
  }
  const source = await sourceOf(ctx, id, home, options);
  const read = source.read;
  if (read.kind === 'problem') {
    // A re-point that fails says so and leaves the home's own state alone.
    if (!source.directoryChanged) {
      const at = new Date().toISOString();
      await systems.withLock(id, () => systems.updateStateLocked(id, (current) => (current.home?.kind === 'repo' ? { ...current, repoProblem: { reason: read.reason, at } } : null)));
      emitState(ctx, id);
    }
    ctx.log.warn('systems.snapshot.problem', { system: id, reason: read.reason, by: options.by });
    if (options.by === 'user') throw new ApiError(read.reason === 'being-changed' ? 'conflict' : 'invalid', repoProblemText(read.reason, source.directory, home.folder));
    return { kind: 'problem', reason: read.reason };
  }

  const reason: UserEditReason = options.by === 'user' && state.snapshot != null ? 'resync' : 'repo-read';
  const staleMessage = resyncStaleMessage(state.name);
  const checkStamp = (current: SystemState): void => {
    if (options.stamp === undefined) return;
    const currentStamp = current.snapshot?.treeHash ?? 'none';
    if (options.stamp !== currentStamp || (source.jobStamp !== null && source.jobStamp !== currentStamp)) throw new ApiError('stale', resyncStaleMessage(current.name));
  };
  let outcome: RefreshOutcome;
  try {
    const result = await versions.userEdit(id, reason, {
      staleMessage,
      precheck: async () => {
        // Inside the chain: the root, the system and its state as they are now.
        if (!samePath(ctx.settings.root(), source.root)) throw new ApiError('conflict', RESYNC_ROOT_CHANGED_MESSAGE);
        const dir = await systems.dir(id);
        const current = await systems.readState(id);
        if (current.home?.kind !== 'repo') throw new ApiError('invalid', notRepoMessage(current.name));
        checkStamp(current);
        const snapshot = current.snapshot;
        if (snapshot != null && snapshot.treeHash === read.treeHash && !snapshot.tampered) throw new Unchanged();
        return { dir, current };
      },
      apply: async ({ dir, current }) => {
        const at = new Date().toISOString();
        const record: SnapshotRecord = {
          v: 1,
          directory: read.directory,
          folder: read.folder,
          at,
          by: options.by,
          files: read.hashes,
          treeHash: read.treeHash,
          ignored: read.ignored,
          skipped: read.skipped,
        };
        const files = await swapSnapshot(ctx, id, current.name, dir, read.files, Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8'));
        // On the chain already (the system's lock): `updateStateLocked` takes no lock of its own.
        await systems.updateStateLocked(id, (now) => {
          const nowHome = now.home;
          if (nowHome?.kind !== 'repo') return null;
          return {
            ...now,
            home: source.directoryChanged ? { ...nowHome, directory: read.directory } : nowHome,
            snapshot: { at, by: options.by, treeHash: read.treeHash, tampered: false },
            repoProblem: null,
            revision: { n: now.revision.n + 1, treeHash: read.treeHash, at },
          };
        });
        return { response: files, written: [] };
      },
    });
    outcome = { kind: 'refreshed', version: result.version, files: result.response, directory: read.directory, directoryChanged: source.directoryChanged };
  } catch (error) {
    if (!(error instanceof Unchanged)) throw error;
    // §5.10 step 4: only the time (and a re-point's directory) move; no version, no revision.
    await systems.withLock(id, async () => {
      const current = await systems.readState(id);
      checkStamp(current);
      await systems.updateStateLocked(id, (now) => {
        const nowHome = now.home;
        if (nowHome?.kind !== 'repo' || now.snapshot == null) return null;
        return {
          ...now,
          home: source.directoryChanged ? { ...nowHome, directory: read.directory } : nowHome,
          snapshot: { ...now.snapshot, at: new Date().toISOString() },
          repoProblem: null,
        };
      });
    });
    emitState(ctx, id);
    ctx.log.info('systems.snapshot.unchanged', { system: id, by: options.by });
    await afterRefresh(ctx, id, source.directoryChanged);
    return { kind: 'unchanged', directory: read.directory, directoryChanged: source.directoryChanged };
  }
  if (outcome.files.length > 0) ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'files', files: outcome.files, ...(options.by === 'user' ? { origin: 'user' as const } : {}) });
  emitState(ctx, id);
  ctx.log.info('systems.snapshot.refreshed', { system: id, by: options.by, files: read.files.size, skipped: read.refused, ignored: read.ignored });
  await afterRefresh(ctx, id, true);
  return outcome;
};

/**
 * §5.10 rev 3: a home change before the agent's first stamp replaces a recovery snapshot (the user's
 * read of the old folder) with an empty one, a version first, so the old folder's values never stand
 * for the new one. Nothing happens when there is no snapshot or the agent has stamped.
 */
export const clearRecoverySnapshot = async (ctx: ServiceContext, id: string): Promise<void> => {
  const systems = ensureSystemStore(ctx);
  const state = await systems.readState(id);
  if (state.home?.kind !== 'repo' || state.snapshot == null || (state.build?.appliedSeen ?? null) !== null) return;
  try {
    await ensureSystemVersions(ctx).userEdit(id, 'repo-read', {
      staleMessage: resyncStaleMessage(state.name),
      precheck: async () => {
        const dir = await systems.dir(id);
        const current = await systems.readState(id);
        if (current.home?.kind !== 'repo' || current.snapshot == null || (current.build?.appliedSeen ?? null) !== null) throw new Unchanged();
        return { dir, current };
      },
      apply: async ({ dir, current }) => {
        const files = await swapSnapshot(ctx, id, current.name, dir, null, null);
        const at = new Date().toISOString();
        await systems.updateStateLocked(id, (now) => ({ ...now, snapshot: null, revision: { n: now.revision.n + 1, treeHash: treeHashOf({}), at } }));
        return { response: files, written: [] };
      },
    }).then((result) => {
      if (result.response.length > 0) ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'files', files: result.response });
    });
  } catch (error) {
    if (error instanceof Unchanged) return;
    throw error;
  }
  emitState(ctx, id);
  ctx.log.info('systems.snapshot.cleared', { system: id });
};

// ---- the repo re-sync apply (§7.4, AD-33) ----

const STAMP_PATTERN = /^([0-9a-f]{64}|none)$/;

/** `POST /systems/:id/resync` on a repo-backed system: `{ scanId, stamp }` only, or 400. */
export const parseRepoResyncRequest = (body: unknown): { scanId: string; stamp: string } => {
  const bad = (): never => {
    throw new ApiError('bad-request', REPO_RESYNC_BAD_MESSAGE);
  };
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad();
  const record = body as Record<string, unknown>;
  // No ticks: Apply takes the repo as it is.
  if (Object.keys(record).some((key) => key !== 'scanId' && key !== 'stamp')) return bad();
  const { scanId, stamp } = record;
  if (typeof scanId !== 'string' || !SCAN_ID_PATTERN.test(scanId)) return bad();
  if (typeof stamp !== 'string' || !STAMP_PATTERN.test(stamp)) return bad();
  return { scanId, stamp };
};

const newEditId = (): string => `e_${randomBytes(10).toString('hex')}`;

/**
 * Apply a reviewed repo re-sync: all or nothing, no Undo (AD-33), so `undoable` is false and no undo
 * record is written. A stale stamp answers 409 with **Scan again**; a re-point folder without the
 * system's folder is refused before anything is read or written.
 */
export const applyRepoResync = async (ctx: ServiceContext, id: string, request: { scanId: string; stamp: string }): Promise<SystemResyncResponse> => {
  const systems = ensureSystemStore(ctx);
  const state = await systems.readState(id);
  const home = state.home;
  if (home?.kind !== 'repo') throw new ApiError('invalid', notRepoMessage(state.name));
  const job = ensureScanJobs(ctx).repoResyncSource(request.scanId, id);
  if (request.stamp !== job.stamp) throw new ApiError('stale', resyncStaleMessage(state.name));
  if (job.read === null) throw new ApiError('invalid', repoProblemText('folder-missing', job.directory, home.folder));
  const outcome = await refreshSnapshot(ctx, id, { by: 'user', scanId: request.scanId, stamp: request.stamp });
  const repo = repoLabelOf(job.directory);
  const counts = outcome.kind === 'refreshed' ? repoReviewCounts(job.review) : { changed: 0, added: 0, removed: 0 };
  const label = outcome.kind === 'refreshed' ? resyncedLabel(state.name, repo, counts) : matchesLabel(state.name, repo);
  const version = outcome.kind === 'refreshed' && outcome.version !== null ? toSummary(outcome.version) : null;
  ctx.log.info('systems.repo-resync-applied', { system: id, ...counts, repointed: job.directoryChanged });
  return {
    edit: { id: newEditId(), label, files: outcome.kind === 'refreshed' ? outcome.files : [], undoable: false },
    version,
    coalesced: false,
    stamps: {},
    counts,
    ...(job.directoryChanged ? { directoryChanged: true } : {}),
  };
};

// ---- the tamper rule (§5.10) ----

/**
 * A `snapshot/**` change that is not a self-write marks the snapshot tampered (only a successful
 * refresh clears it). The watcher already dropped the service's own echoes; the content is also
 * compared with the recorded tree hash, so a stray late event from a swap never reads as tampering.
 */
const checkTamper = async (ctx: ServiceContext, id: string): Promise<void> => {
  const systems = ensureSystemStore(ctx);
  const marked = await systems.withLock(id, async (): Promise<boolean> => {
    const state = await systems.readState(id);
    if (state.home?.kind !== 'repo' || state.snapshot == null || state.snapshot.tampered) return false;
    const source = await systems.get(id);
    const record = await readRecordIn(await systems.filesDir(id));
    const intact = treeHashOf(source.hashes ?? {}) === state.snapshot.treeHash && record !== null && record.treeHash === state.snapshot.treeHash;
    if (intact) return false;
    await systems.updateStateLocked(id, (current) => (current.snapshot == null ? null : { ...current, snapshot: { ...current.snapshot, tampered: true } }));
    return true;
  });
  if (!marked) return;
  emitState(ctx, id);
  ctx.log.warn('systems.snapshot.tampered', { system: id });
};

/**
 * Service start: recover interrupted swaps in every system, then watch for tampering. Returns the
 * stop function (it waits for the recovery and any tamper check under way).
 */
export const startSnapshots = (ctx: ServiceContext): (() => Promise<void>) => {
  const pending = new Set<Promise<void>>();
  const track = (work: Promise<void>): void => {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  track(recoverAllSnapshots(ctx.settings.root(), ctx.log));
  const unsubscribe = ctx.hub.subscribe((event) => {
    if (event.kind !== 'system' || event.systemChange !== 'files' || typeof event.system !== 'string') return;
    if (!(event.files ?? []).some((file) => file.startsWith(`${SNAPSHOT_DIR}/`))) return;
    const id = event.system;
    track(
      checkTamper(ctx, id).catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'not-found') return;
        ctx.log.warn('systems.snapshot.tamper-check-failed', { system: id, error: messageOf(error) });
      }),
    );
  });
  return async () => {
    unsubscribe();
    await Promise.allSettled([...pending]);
  };
};
