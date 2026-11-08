// Content-addressed version snapshots (docs/SPEC.md §6.4, §4.9, §9.5).
//
//   .versions/index.json          { version:1, next, versions:[VersionEntry…] }  newest last
//   .versions/objects/<aa>/<sha>  raw file bytes, content-addressed
//
// Tracked set: every file under the design folder except `.versions/**`, `.chamber/**` and
// `.thumb.png`; `design.json` is stored with `comments` removed (comments live in state.json,
// which versions never touch). Snapshots: auto after a quiet period, on an agent turn, manual,
// and around restore (restore-point → write files → restored). Dedupe by tree hash; keep the
// newest VERSIONS_KEEP versions and GC unreferenced objects after pruning.
//
// Every mutation for one design runs on a per-slug promise chain: snapshot/restore interleave
// with each other and with the auto timer, never with themselves.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  mergeServiceFields,
  normalizeServiceState,
  serializeJson,
  stripForVersion,
  DESIGN_JSON_FILE,
} from '../shared/design-json.ts';
import type { VersionHistoryState } from '../shared/api.ts';
import {
  SHA256_PATTERN,
  SNAPSHOT_BYTES_MAX,
  SNAPSHOT_FILES_MAX,
  TURN_PROMOTE_AUTO_MS,
  TURN_SNAPSHOT_DEDUPE_MS,
  VERSION_ID_PATTERN,
  VERSION_LABEL_MAX,
  VERSIONS_KEEP,
  VERSION_QUIET_MS,
} from '../shared/limits.ts';
import type {
  JsonObject,
  VersionEntry,
  VersionFileChange,
  VersionIndex,
  VersionReason,
  VersionSummary,
} from '../shared/types.ts';
import { ApiError } from './http.ts';
import type { ChangeHub, DesignStore, Logger, ServiceContext } from './context.ts';
import { RefBlocked, type FileSource } from './bundle.ts';
import { resolveInside } from './paths.ts';
import {
  CHAMBER_DIR,
  DAMAGED_KEEP_MAX,
  DAMAGED_KEEP_MS,
  damagedFileName,
  hashesMentioned,
  highestVersionNumber,
  historyStateOf,
  INDEX_READ_MAX_BYTES,
  isSafeRel,
  isTracked,
  parseDamagedFileName,
  parseIndexText,
  VERSIONS_DIR,
  type DamageKind,
  type IndexHealth,
} from './versions-index.ts';

export { isTracked, VERSIONS_DIR };

const STATE_FILE = path.join(CHAMBER_DIR, 'state.json');

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** Tree hash of the empty tracked set (a design folder with no tracked files). */
export const EMPTY_TREE_HASH = sha256('');

// ---- tracked set ----

/**
 * Every tracked file under the design folder, `/`-separated and sorted.
 * Symlinks are skipped: their target may live outside the design and a snapshot must not
 * capture (or restore) escapes.
 */
export const listTracked = async (designDir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (relDir: string): Promise<void> => {
    const fsDir = relDir === '' ? designDir : path.join(designDir, ...relDir.split('/'));
    const entries = await readdir(fsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (!isTracked(rel)) continue;
      if (entry.isDirectory()) await walk(rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  await walk('');
  return out.sort();
};

export type VersionTree = {
  /** Tracked rel path → sha256 of the bytes stored for it (design.json: comments stripped). */
  files: Record<string, string>;
  /** design.json's stored bytes when they differ from the live file (comments stripped). */
  transformed: Map<string, Buffer>;
  bytes: number;
  treeHash: string;
};

const parseJsonObject = (text: string): JsonObject | null => {
  try {
    const value: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
  } catch {
    return null;
  }
};

/** Hash (and prepare the stored bytes of) every tracked file. */
export const computeTree = async (designDir: string): Promise<VersionTree> => {
  const rels = await listTracked(designDir);
  const files: Record<string, string> = {};
  const transformed = new Map<string, Buffer>();
  let bytes = 0;
  const lines: string[] = [];
  for (const rel of rels) {
    const raw = await readFile(path.join(designDir, ...rel.split('/'))).catch(() => null);
    if (raw === null) continue; // vanished mid-walk: not part of the tree
    let content = raw;
    if (rel === DESIGN_JSON_FILE) {
      const parsed = parseJsonObject(raw.toString('utf8'));
      if (parsed !== null) content = Buffer.from(serializeJson(stripForVersion(parsed)), 'utf8');
      // Unparseable design.json (agent mid-write): stored verbatim, never transformed.
      transformed.set(rel, content);
    }
    const hash = sha256(content);
    files[rel] = hash;
    bytes += content.length;
    lines.push(`${rel}\u0000${hash}\n`);
  }
  return { files, transformed, bytes, treeHash: sha256(lines.join('')) };
};

// ---- index and objects ----

/** Shown to the user as the service `message` (phase-0 spec, 0a). */
const READ_FAILED = "Design Chamber could not read this design's version history right now. Try again in a moment.";
const UNSUPPORTED = "This design's version history was saved by a newer version of Design Chamber. Update the extension to save or restore versions here.";
const SET_ASIDE_FAILED = 'Design Chamber could not set the damaged version list aside, so it saved nothing. Try again in a moment.';
const RESTORE_WOULD_DROP_COMMENTS = "This version's design.json is damaged, so restoring it would lose your comments. Nothing was changed.";

const INDEX_NAME = 'index.json';
const BACKUP_NAME = 'index.bak.json';

const errorCode = (error: unknown): string | undefined => (error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The contained `.versions` folder: a `.versions` link that leaves the design is refused (`bad-path`). */
const versionsDirOf = (designDir: string): Promise<string> => resolveInside(designDir, [VERSIONS_DIR]);

const objectPath = (versionsDir: string, hash: string): string => path.join(versionsDir, 'objects', hash.slice(0, 2), hash);

type CappedRead = { kind: 'missing' } | { kind: 'oversize' } | { kind: 'bytes'; bytes: Buffer };

/** Reads a small regular file. ENOENT is `missing`; every other failure (EBUSY, EISDIR, EIO…) throws. */
const readCapped = async (file: string): Promise<CappedRead> => {
  const info = await stat(file).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  });
  if (info === null) return { kind: 'missing' };
  if (!info.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
  if (info.size > INDEX_READ_MAX_BYTES) return { kind: 'oversize' };
  try {
    return { kind: 'bytes', bytes: await readFile(file) };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { kind: 'missing' }; // removed between stat and read
    throw error;
  }
};

export type LoadedIndex = {
  index: VersionIndex;
  health: IndexHealth;
  /** Set when the next commit must keep the old index.json aside first; cleared once it has. */
  setAside: DamageKind | null;
  /** `reset` from a missing index: every object found, written into the note. */
  orphans: string[] | null;
  damaged: { name: string; at: number; kind: DamageKind }[];
};

const emptyIndex = (next = 1): VersionIndex => ({ version: 1, next, versions: [] });

const listObjectHashes = async (versionsDir: string): Promise<string[]> => {
  const hashes: string[] = [];
  const buckets = await readdir(path.join(versionsDir, 'objects'), { withFileTypes: true }).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  });
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    for (const name of await readdir(path.join(versionsDir, 'objects', bucket.name))) if (SHA256_PATTERN.test(name)) hashes.push(name);
  }
  return hashes;
};

const listDamaged = async (versionsDir: string): Promise<LoadedIndex['damaged']> => {
  const names = await readdir(versionsDir).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  });
  const out: LoadedIndex['damaged'] = [];
  for (const name of names) {
    const parsed = parseDamagedFileName(name);
    if (parsed !== null) out.push({ name, ...parsed });
  }
  return out;
};

/**
 * Read-only: reports what is on disk and what the next commit must do about it. A missing index
 * is a new design; a damaged one is repaired from the backup or reset, never silently emptied;
 * a read error other than "missing" is an error, not an empty list.
 */
const loadIndex = async (designDir: string, log: Logger): Promise<LoadedIndex> => {
  const versionsDir = await versionsDirOf(designDir);
  const fail = (error: unknown): never => {
    log.warn('versions.read-failed', { design: designDir, error: messageOf(error) });
    throw new ApiError('internal', READ_FAILED);
  };
  const read = (name: string): Promise<CappedRead> => readCapped(path.join(versionsDir, name)).catch(fail);
  const damaged = await listDamaged(versionsDir).catch(fail);
  const loaded = (index: VersionIndex, health: IndexHealth, setAside: DamageKind | null = null, orphans: string[] | null = null): LoadedIndex => ({ index, health, setAside, orphans, damaged });

  const current = await read(INDEX_NAME);
  let damagedText = '';
  if (current.kind === 'bytes') {
    damagedText = current.bytes.toString('utf8');
    const parsed = parseIndexText(damagedText);
    if (parsed.kind === 'unsupported') return loaded(emptyIndex(), 'unsupported');
    if (parsed.kind === 'ok') {
      if (parsed.dropped === 0) return loaded(parsed.index, 'ok');
      log.warn('versions.index-entries-dropped', { design: designDir, dropped: parsed.dropped });
      return loaded(parsed.index, 'repaired', 'entries');
    }
  }
  // index.json is missing, unreadable or too large to read: the backup is the way back.
  const backup = await read(BACKUP_NAME);
  const backupParse = backup.kind === 'bytes' ? parseIndexText(backup.bytes.toString('utf8')) : null;
  if (backupParse?.kind === 'unsupported') return loaded(emptyIndex(), 'unsupported');
  if (backupParse?.kind === 'ok') {
    // Ids never repeat old ones (comments record `sentInVersion` numbers).
    const next = Math.max(backupParse.index.next, highestVersionNumber(damagedText) + 1);
    log.warn('versions.index-recovered', { design: designDir });
    return loaded({ ...backupParse.index, next }, 'recovered', 'recovered');
  }
  if (current.kind === 'missing') {
    const orphans = await listObjectHashes(versionsDir).catch(fail);
    if (orphans.length === 0) return loaded(emptyIndex(), 'ok'); // a new design
    log.warn('versions.index-reset', { design: designDir, objects: orphans.length });
    return loaded(emptyIndex(), 'reset', 'reset', orphans);
  }
  log.warn('versions.index-reset', { design: designDir });
  return loaded(emptyIndex(Math.max(1, highestVersionNumber(damagedText) + 1)), 'reset', 'reset');
};

const writeAtomic = async (target: string, bytes: Uint8Array | string): Promise<void> => {
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
};

type Env = { log: Logger; now: () => number };

/**
 * Moves the damaged index.json to `index.damaged-…` (or writes a note when there is none), so
 * no write ever replaces bytes the service did not create. A Windows lock on the rename falls
 * back to a copy. Both failing aborts the commit before anything else is written.
 */
const setAsideDamaged = async (versionsDir: string, loaded: LoadedIndex, env: Env): Promise<void> => {
  const kind = loaded.setAside;
  if (kind === null) return;
  const source = path.join(versionsDir, INDEX_NAME);
  const target = path.join(versionsDir, damagedFileName(new Date(env.now()), kind, randomBytes(2).toString('hex')));
  try {
    await rename(source, target).catch(async (error: unknown) => {
      const code = errorCode(error);
      if (code === 'ENOENT') {
        await writeAtomic(target, kind === 'reset' ? `${JSON.stringify({ orphans: loaded.orphans ?? [] })}\n` : '{}\n');
      } else if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
        const copy = await readCapped(source);
        if (copy.kind !== 'bytes') throw error;
        await writeAtomic(target, copy.bytes);
      } else {
        throw error;
      }
    });
  } catch (error) {
    env.log.warn('versions.set-aside-failed', { design: path.dirname(versionsDir), error: messageOf(error) });
    throw new ApiError('internal', SET_ASIDE_FAILED);
  }
  loaded.setAside = null; // a second commit in the same operation does not repeat it
};

/** Chain only: every index write goes through here. Damaged bytes are set aside first, the backup follows the index. */
const commitIndex = async (designDir: string, loaded: LoadedIndex, index: VersionIndex, env: Env): Promise<void> => {
  if (loaded.health === 'unsupported') throw new ApiError('invalid', UNSUPPORTED);
  const versionsDir = await versionsDirOf(designDir);
  await mkdir(versionsDir, { recursive: true });
  await setAsideDamaged(versionsDir, loaded, env);
  const bytes = serializeJson(index as unknown as JsonObject); // Safe: VersionIndex is plain JSON.
  await writeAtomic(path.join(versionsDir, INDEX_NAME), bytes);
  await writeAtomic(path.join(versionsDir, BACKUP_NAME), bytes).catch((error: unknown) => env.log.warn('versions.backup-failed', { design: designDir, error: messageOf(error) }));
};

const putObject = async (versionsDir: string, hash: string, bytes: Buffer): Promise<void> => {
  const target = objectPath(versionsDir, hash);
  const existing = await stat(target).catch(() => null);
  if (existing?.isFile()) return; // content-addressed and immutable
  await mkdir(path.dirname(target), { recursive: true });
  await writeAtomic(target, bytes);
};

/**
 * Delete objects nothing keeps any more (run after pruning, inside the slug's chain). "Kept" is
 * the live index, the backup, and every damaged copy still within its time and count limit; the
 * copies are scanned for hashes as plain text, so a truncated file still protects what it names.
 * A kept file that cannot be read, or is too large to read, skips the run: nothing is deleted on a guess.
 */
const collectGarbage = async (designDir: string, versionsDir: string, index: VersionIndex, env: Env): Promise<void> => {
  const { log } = env;
  const damaged = (await listDamaged(versionsDir).catch(() => [])).sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
  const kept: string[] = [];
  const now = env.now();
  for (const [position, item] of damaged.entries()) {
    if (position < DAMAGED_KEEP_MAX && now - item.at < DAMAGED_KEEP_MS) kept.push(item.name);
    else await unlink(path.join(versionsDir, item.name)).catch((error: unknown) => log.warn('versions.gc-failed', { object: item.name, error: messageOf(error) }));
  }

  const protectedHashes = new Set<string>();
  for (const entry of index.versions) for (const hash of Object.values(entry.files)) protectedHashes.add(hash);
  for (const name of [BACKUP_NAME, ...kept]) {
    let read: CappedRead;
    try {
      read = await readCapped(path.join(versionsDir, name));
    } catch (error) {
      log.warn('versions.gc-skipped', { design: designDir, file: name, error: messageOf(error) });
      return;
    }
    if (read.kind === 'oversize') {
      log.warn('versions.gc-skipped', { design: designDir, file: name, error: 'too large to scan' });
      return;
    }
    if (read.kind === 'bytes') for (const hash of hashesMentioned(read.bytes.toString('utf8'))) protectedHashes.add(hash);
  }

  const objectsDir = path.join(versionsDir, 'objects');
  const buckets = await readdir(objectsDir, { withFileTypes: true }).catch(() => []);
  for (const bucket of buckets) {
    if (!bucket.isDirectory() || !/^[0-9a-f]{2}$/.test(bucket.name)) continue;
    const bucketDir = path.join(objectsDir, bucket.name);
    const names = await readdir(bucketDir).catch(() => []);
    for (const name of names) {
      if (!SHA256_PATTERN.test(name)) continue; // never delete a file we cannot identify
      if (protectedHashes.has(name)) continue;
      await unlink(path.join(bucketDir, name)).catch((error: unknown) => log.warn('versions.gc-failed', { object: name, error: messageOf(error) }));
    }
    const left = await readdir(bucketDir).catch(() => []);
    if (left.length === 0) await rm(bucketDir, { recursive: true, force: true });
  }
};

// ---- summaries ----

export const toSummary = (entry: VersionEntry): VersionSummary => {
  const { files, ...rest } = entry;
  return { ...rest, fileCount: Object.keys(files).length };
};

// ---- version file source (render reads a snapshot through it) ----

const validateRel = (rel: string): void => {
  if (!isSafeRel(rel)) throw new RefBlocked(rel);
};

export const createVersionFileSource = (designDir: string, files: Record<string, string>): FileSource => ({
  root: designDir,
  async read(rel) {
    validateRel(rel);
    const hash = files[rel];
    if (hash === undefined || !SHA256_PATTERN.test(hash)) return null;
    const bytes = await readFile(objectPath(await versionsDirOf(designDir), hash)).catch(() => null);
    if (bytes === null) return null;
    return { bytes, size: bytes.length, mtimeMs: 0 };
  },
  async stat(rel) {
    validateRel(rel);
    const hash = files[rel];
    if (hash === undefined || !SHA256_PATTERN.test(hash)) return null;
    const info = await stat(objectPath(await versionsDirOf(designDir), hash)).catch(() => null);
    return info === null ? null : { size: info.size, mtimeMs: info.mtimeMs };
  },
});

// ---- the service ----

export type SnapshotOptions = { sessionId?: string | null; label?: string };

export type VersionsService = {
  /** Brand so `ensureVersionsService` recognises an already-wired instance. */
  __dcVersionsService?: true;
  /** `history` is set when the version list was repaired, recovered, reset or written by a newer build. */
  list(slug: string): Promise<{ versions: VersionSummary[]; currentTreeHash: string; dirty: boolean; history?: VersionHistoryState }>;
  /** `reason` is already validated ('turn' | 'manual'). `null` = nothing changed. */
  create(slug: string, reason: 'turn' | 'manual', options?: SnapshotOptions): Promise<VersionSummary | null>;
  snapshot(slug: string, reason: VersionReason, options?: SnapshotOptions): Promise<VersionEntry | null>;
  turn(sessionId: string): Promise<{ slug: string; id: string }[]>;
  diff(slug: string, vid: string, against: string): Promise<{ files: { path: string; change: VersionFileChange }[] }>;
  restore(slug: string, vid: string): Promise<{ restorePoint: VersionSummary | null; restored: VersionSummary }>;
  /** The snapshot's entry and a FileSource over its objects (the render service reads versions through it). */
  readTree(slug: string, vid: string): Promise<{ entry: VersionEntry; source: FileSource }>;
  /** True when an auto-snapshot timer is pending (tests). */
  autoPending(slug: string): boolean;
};

export type VersionsDeps = {
  store: DesignStore;
  hub: ChangeHub;
  log: Logger;
  onDispose: (fn: () => void | Promise<void>) => void;
  /** Auto-snapshot quiet period; `VERSION_QUIET_MS` outside tests. */
  quietMs?: number;
  /** Clock for damaged-copy names and expiry (test seam); `Date.now` outside tests. */
  now?: () => number;
};

export const createVersionsService = (deps: VersionsDeps): VersionsService => {
  const { store, hub, log } = deps;
  const quietMs = deps.quietMs ?? VERSION_QUIET_MS;
  const env: Env = { log, now: deps.now ?? Date.now };

  // A newer build's index is logged once per design per run, not on every auto snapshot or turn.
  const unsupportedLogged = new Set<string>();
  const warnFailure = (event: string, slug: string, error: unknown): void => {
    if (error instanceof ApiError && error.message === UNSUPPORTED) {
      if (unsupportedLogged.has(slug)) return;
      unsupportedLogged.add(slug);
      log.warn('versions.unsupported', { slug });
      return;
    }
    log.warn(event, { slug, error: messageOf(error) });
  };

  /** The index for a read that cannot continue on a newer build's index (diff, readTree, restore). */
  const readableIndex = async (designDir: string): Promise<LoadedIndex> => {
    const loaded = await loadIndex(designDir, log);
    if (loaded.health === 'unsupported') throw new ApiError('invalid', UNSUPPORTED);
    return loaded;
  };

  // Per-slug mutation chain.
  const chains = new Map<string, Promise<unknown>>();
  const chained = <T>(slug: string, fn: () => Promise<T>): Promise<T> => {
    const previous = chains.get(slug) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    chains.set(slug, run.then(
      () => undefined,
      () => undefined,
    ));
    return run;
  };

  // Tree cache: fingerprint = rel → size+mtime (stat only), so repeated lists/diffs are cheap.
  const treeCache = new Map<string, { fingerprint: string; tree: VersionTree }>();
  const treeOf = async (slug: string, designDir: string): Promise<VersionTree> => {
    const rels = await listTracked(designDir);
    const stats: string[] = [];
    for (const rel of rels) {
      const info = await stat(path.join(designDir, ...rel.split('/'))).catch(() => null);
      stats.push(`${rel}:${info?.size ?? -1}:${info?.mtimeMs ?? -1}`);
    }
    const fingerprint = stats.join('|');
    const cached = treeCache.get(slug);
    if (cached && cached.fingerprint === fingerprint) return cached.tree;
    const tree = await computeTree(designDir);
    treeCache.set(slug, { fingerprint, tree });
    return tree;
  };

  const readState = async (designDir: string): Promise<ReturnType<typeof normalizeServiceState>> => {
    const text = await readFile(path.join(designDir, STATE_FILE), 'utf8').catch(() => null);
    if (text === null) return null;
    const parsed: unknown = parseJsonObject(text);
    return parsed === null ? null : normalizeServiceState(parsed);
  };

  /**
   * `keep`: a version id pruning must skip (the target of a running restore, so its objects
   * survive GC). `required`: an over-cap tree throws instead of being skipped (a restore
   * point that cannot be stored must stop the restore).
   */
  const snapshotNow = async (
    slug: string,
    reason: VersionReason,
    options: SnapshotOptions & { keep?: string; required?: boolean },
  ): Promise<VersionEntry | null> => {
    const designDir = await store.dir(slug);
    // Before any object is written: a newer build's index, a read error or a link out of the
    // design refuses the snapshot while nothing has changed on disk.
    const loaded = await readableIndex(designDir);
    const versionsDir = await versionsDirOf(designDir);
    // Two attempts: a file rewritten between hashing and storing its object would corrupt the
    // snapshot, so every object is hash-verified and the whole snapshot redone on a mismatch.
    let tree: VersionTree | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      tree = await treeOf(slug, designDir);
      const fileCount = Object.keys(tree.files).length;
      if (fileCount > SNAPSHOT_FILES_MAX || tree.bytes > SNAPSHOT_BYTES_MAX) {
        log.warn('versions.snapshot-skipped', { slug, reason, fileCount, bytes: tree.bytes });
        if (options.required === true) {
          throw new ApiError(
            'invalid',
            `This design is too large to keep a restore point (more than ${SNAPSHOT_FILES_MAX.toLocaleString('en-US')} files or ${Math.round(SNAPSHOT_BYTES_MAX / (1024 * 1024))} MB), so restoring now would lose your current files. Nothing was changed. Remove files you no longer need, or copy the design folder somewhere safe, then try again.`,
          );
        }
        return null;
      }
      let torn = false;
      for (const [rel, hash] of Object.entries(tree.files)) {
        const content = tree.transformed.get(rel) ?? (await readFile(path.join(designDir, ...rel.split('/'))).catch(() => null));
        if (content === null || sha256(content) !== hash) {
          torn = true;
          break;
        }
        await putObject(versionsDir, hash, content);
      }
      if (!torn) break;
      treeCache.delete(slug);
      tree = null;
    }
    if (tree === null) throw new ApiError('conflict', 'The design changed while Design Chamber was saving it. Try again.');

    const index = loaded.index;
    const latest = index.versions[index.versions.length - 1];
    if (latest && latest.treeHash === tree.treeHash) {
      // The quiet-period auto snapshot often lands before the turn ends with the same files:
      // that version is the turn's result, so it becomes the "After agent turn" version.
      const recent = Date.now() - Date.parse(latest.created) <= TURN_PROMOTE_AUTO_MS;
      if (reason !== 'turn' || latest.reason !== 'auto' || !recent) return null; // dedupe by tree hash
      latest.reason = 'turn';
      latest.sessionId = options.sessionId ?? latest.sessionId;
      await commitIndex(designDir, loaded, index, env);
      hub.emit({ slug, kind: 'versions' });
      return latest;
    }

    const record = await store.get(slug).catch(() => null);
    const sessionId = options.sessionId ?? record?.design.sessionId ?? null;

    const n = Math.max(index.next, (latest?.n ?? 0) + 1);
    const entry: VersionEntry = {
      id: `v${n}`,
      n,
      created: new Date().toISOString(),
      reason,
      sessionId,
      treeHash: tree.treeHash,
      files: tree.files,
      bytes: tree.bytes,
      ...(options.label !== undefined ? { label: options.label.slice(0, VERSION_LABEL_MAX) } : {}),
    };
    index.versions.push(entry);
    index.next = n + 1;
    for (let excess = index.versions.length - VERSIONS_KEEP; excess > 0; excess -= 1) {
      const oldest = index.versions.findIndex((candidate) => candidate.id !== options.keep);
      if (oldest === -1) break;
      index.versions.splice(oldest, 1);
    }
    await commitIndex(designDir, loaded, index, env);
    await collectGarbage(designDir, versionsDir, index, env);
    treeCache.delete(slug);
    hub.emit({ slug, kind: 'versions' });
    return entry;
  };

  const findEntry = (index: VersionIndex, vid: string): VersionEntry => {
    const entry = index.versions.find((candidate) => candidate.id === vid);
    if (!entry) throw new ApiError('not-found', 'That version does not exist any more.');
    return entry;
  };

  const restoreNow = async (slug: string, vid: string): Promise<{ restorePoint: VersionSummary | null; restored: VersionSummary }> => {
    if (!VERSION_ID_PATTERN.test(vid)) throw new ApiError('bad-request', 'That is not a version id.');
    const designDir = await store.dir(slug);
    const { index } = await readableIndex(designDir);
    const versionsDir = await versionsDirOf(designDir);
    const target = findEntry(index, vid);

    // Every object must exist before anything is written.
    for (const hash of Object.values(target.files)) {
      const info = await stat(objectPath(versionsDir, hash)).catch(() => null);
      if (!info?.isFile()) throw new ApiError('invalid', 'This version is damaged (a stored file is gone) and cannot be restored.');
    }

    // Prepare design.json in memory, before the restore point and every write, so a refusal
    // changes nothing. The store's state is the resolved one (state.json, or rebuilt from the
    // live design.json when state.json is missing or damaged), so comments are never lost.
    const liveState = (await store.get(slug)).state;
    const stateOnDisk = (await readState(designDir)) !== null;
    let designBytes: Buffer | null = null;
    const designHash = target.files[DESIGN_JSON_FILE];
    if (designHash !== undefined) {
      const stored = await readFile(objectPath(versionsDir, designHash));
      const parsed = parseJsonObject(stored.toString('utf8'));
      if (parsed !== null) {
        // Keep the CURRENT service-owned fields and comments (§6.4: restore never touches
        // comments or sessionId). `updated` is not bumped: the tree hash must stay the
        // version's, so no phantom "dirty" state after restore.
        if (stateOnDisk) designBytes = Buffer.from(serializeJson(mergeServiceFields(parsed, liveState)), 'utf8');
        // No state.json (an agent-made design): the live comments live only in design.json, so
        // graft just those. A full merge would append fields the version never had and change its tree hash.
        else if (liveState.comments.length > 0) designBytes = Buffer.from(serializeJson({ ...parsed, comments: mergeServiceFields({}, liveState).comments ?? [] }), 'utf8');
        else designBytes = stored;
      } else if (!stateOnDisk && liveState.comments.length > 0) {
        throw new ApiError('invalid', RESTORE_WOULD_DROP_COMMENTS);
      } else {
        designBytes = stored; // state.json (if any) keeps the comments and the store re-mirrors them
      }
    }

    const current = await treeOf(slug, designDir);
    const latest = index.versions[index.versions.length - 1];
    let restorePoint: VersionEntry | null = null;
    if (!latest || latest.treeHash !== current.treeHash) {
      // `keep`: with a full history the restore point would otherwise prune (and GC) the very
      // version being restored. `required`: no restore point → refuse before writing anything.
      restorePoint = await snapshotNow(slug, 'restore-point', { keep: target.id, required: true });
    }

    for (const [rel, hash] of Object.entries(target.files)) {
      const bytes = rel === DESIGN_JSON_FILE && designBytes !== null ? designBytes : await readFile(objectPath(versionsDir, hash));
      const destination = await resolveInside(designDir, rel.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeAtomic(destination, bytes);
    }
    // Delete tracked files the version does not have (restore removes what was added since).
    for (const rel of Object.keys(current.files)) {
      if (target.files[rel] !== undefined) continue;
      await rm(await resolveInside(designDir, rel.split('/')), { force: true });
    }
    treeCache.delete(slug);
    hub.emit({ slug, kind: 'files' });

    // The restore itself is done; a torn 'restored' snapshot must not fail the route (the
    // auto timer records it seconds later).
    const restored =
      (await snapshotNow(slug, 'restored', {}).catch((error: unknown) => {
        log.warn('versions.restored-snapshot-failed', { slug, error: messageOf(error) });
        return null;
      })) ?? (await loadIndex(designDir, log)).index.versions.at(-1);
    if (!restored) throw new ApiError('internal', 'The version was restored, but Design Chamber could not record the snapshot.');
    return { restorePoint: restorePoint ? toSummary(restorePoint) : null, restored: toSummary(restored) };
  };

  // Turn-snapshot dedupe across frames (§10.6): one run per session per TURN_SNAPSHOT_DEDUPE_MS.
  const turnCache = new Map<string, { at: number; result: { slug: string; id: string }[] }>();

  // Auto snapshots: hub content events restart a quiet-period timer per slug.
  const autoTimers = new Map<string, NodeJS.Timeout>();
  const cancelAuto = (slug: string): void => {
    const timer = autoTimers.get(slug);
    if (timer) clearTimeout(timer);
    autoTimers.delete(slug);
  };
  const scheduleAuto = (slug: string): void => {
    cancelAuto(slug);
    autoTimers.set(
      slug,
      setTimeout(() => {
        autoTimers.delete(slug);
        void service.snapshot(slug, 'auto').catch((error: unknown) => {
          // A design removed mid-quiet-period is normal; anything else is worth a log line.
          if (error instanceof ApiError && error.code === 'not-found') return;
          warnFailure('versions.auto-failed', slug, error);
        });
      }, quietMs),
    );
  };
  const unsubscribe = hub.subscribe((event) => {
    if (event.kind === 'root') {
      for (const slug of [...autoTimers.keys()]) cancelAuto(slug);
      treeCache.clear();
      return;
    }
    if (event.slug === null) return;
    if (event.kind === 'files' || event.kind === 'design' || event.kind === 'added') scheduleAuto(event.slug);
    else if (event.kind === 'removed') {
      cancelAuto(event.slug);
      treeCache.delete(event.slug);
    }
  });
  deps.onDispose(() => {
    unsubscribe();
    for (const slug of [...autoTimers.keys()]) cancelAuto(slug);
  });

  const service: VersionsService = {
    __dcVersionsService: true,

    async list(slug) {
      const designDir = await store.dir(slug);
      const { index, health, damaged } = await loadIndex(designDir, log);
      const tree = await treeOf(slug, designDir);
      const latest = index.versions[index.versions.length - 1];
      const dirty = latest ? latest.treeHash !== tree.treeHash : tree.treeHash !== EMPTY_TREE_HASH;
      // Expired copies stay on disk until the next snapshot's cleanup; they no longer count.
      const history = historyStateOf(health, damaged.filter((item) => env.now() - item.at < DAMAGED_KEEP_MS));
      return {
        versions: [...index.versions].reverse().map(toSummary),
        currentTreeHash: tree.treeHash,
        dirty,
        ...(history !== null ? { history } : {}),
      };
    },

    create: (slug, reason, options) => chained(slug, async () => toSummaryOrNull(await snapshotNow(slug, reason, options ?? {}))),

    snapshot: (slug, reason, options) => chained(slug, () => snapshotNow(slug, reason, options ?? {})),

    async turn(sessionId) {
      const now = Date.now();
      const cached = turnCache.get(sessionId);
      if (cached && now - cached.at < TURN_SNAPSHOT_DEDUPE_MS) return cached.result;
      const designs = await store.list();
      const created: { slug: string; id: string }[] = [];
      for (const design of designs) {
        if (design.sessionId !== sessionId) continue;
        const entry = await service.snapshot(design.slug, 'turn', { sessionId }).catch((error: unknown) => {
          warnFailure('versions.turn-failed', design.slug, error);
          return null;
        });
        if (entry) created.push({ slug: design.slug, id: entry.id });
      }
      if (turnCache.size > 1000) turnCache.clear(); // bounded; sessions are few
      turnCache.set(sessionId, { at: now, result: created });
      return created;
    },

    async diff(slug, vid, against) {
      if (!VERSION_ID_PATTERN.test(vid)) throw new ApiError('bad-request', 'That is not a version id.');
      const designDir = await store.dir(slug);
      const { index } = await readableIndex(designDir);
      const a = findEntry(index, vid).files;
      let b: Record<string, string>;
      if (against === 'current') b = (await treeOf(slug, designDir)).files;
      else {
        if (!VERSION_ID_PATTERN.test(against)) throw new ApiError('bad-request', 'That is not a version id.');
        b = findEntry(index, against).files;
      }
      const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      const files: { path: string; change: VersionFileChange }[] = [];
      for (const p of paths) {
        const left = a[p];
        const right = b[p];
        if (left === undefined && right !== undefined) files.push({ path: p, change: 'added' });
        else if (left !== undefined && right === undefined) files.push({ path: p, change: 'removed' });
        else if (left !== right) files.push({ path: p, change: 'modified' });
      }
      return { files };
    },

    restore: (slug, vid) => chained(slug, () => restoreNow(slug, vid)),

    async readTree(slug, vid) {
      if (!VERSION_ID_PATTERN.test(vid)) throw new ApiError('bad-request', 'That is not a version id.');
      const designDir = await store.dir(slug);
      const { index } = await readableIndex(designDir);
      const entry = findEntry(index, vid);
      return { entry, source: createVersionFileSource(designDir, entry.files) };
    },

    autoPending: (slug) => autoTimers.has(slug),
  };
  return service;
};

const toSummaryOrNull = (entry: VersionEntry | null): VersionSummary | null => (entry === null ? null : toSummary(entry));

// ---- wiring (routes and main.ts share one instance per context) ----

const instances = new WeakMap<ServiceContext, VersionsService>();

export const ensureVersionsService = (ctx: ServiceContext): VersionsService => {
  const existing = instances.get(ctx);
  if (existing) return existing;
  const created = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose });
  instances.set(ctx, created);
  return created;
};
