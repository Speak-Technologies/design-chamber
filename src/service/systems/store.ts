// The system store (documentation/specs/phase-2-5-technical.md §5.1, §2.1, §2.5, §2.10, AD-1,
// AD-2, AD-13, AD-14): list, get, detail, create, patch and trash of the design systems in
// `<root>/_systems/<id>/`, the in-memory systems index, and the revision counter.
//
// Containment: every system folder is reached through `dir(id)` (id pattern → `resolveInside`
// → the realpath equals the lexical path, so no link anywhere on the way → `_systems` and
// `<id>` are real folders); every file under it through `resolvePlainTarget`, which refuses a
// link. Content files are read bounded, so a huge agent file never fills memory.
//
// `_systems` starts with `_`, so it fails SLUG_PATTERN: the design store, the counts, mentions,
// Work Status and loose import never see it (AD-1). The ids `none` and `ask` are reserved: they
// are `systemChoice` values, so a system by either name could never be chosen (§2.7).
//
// Writes: only `.chamber/state.json` (service-owned, never versioned) after creation, and the
// seed files at creation, all atomic. A creation that fails part way moves the half-made folder
// to `.trash/system.<id>-<stamp>` so nothing half-written is left as a system. Delete moves the
// folder to the trash too and clears the settings that named it (default → ask, pins removed),
// queueing a one-time notice.
//
// Revision (AD-13): starts at 1 when the system is made; bumped when the content tree differs
// from the tree of the last revision, either at once (`settleRevision`, for a user's save,
// re-sync or restore) or after `SYSTEM_QUIET_MS` of quiet after the agent's changes. Bumps run
// under the system's lock, so two never race.
//
// Homes (AD-14, T12b): every content reader goes through `filesDir(id)`. An internal home answers
// `dir(id)`; a repo-backed one `dir(id)/snapshot` — a real folder, never a link. Without a snapshot
// yet the path reads as empty ("Being built in chat", §9.6); the snapshot's own `SNAPSHOT.json` is
// outside the content set, so an interview update never bumps a revision (§2.10).

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { CreateSystemBody, DeleteSystemResponse, PatchSystemBody, PatchSystemResponse } from '../../shared/api.ts';
import {
  DESIGN_INDEX_REFRESH_MS,
  SESSION_ID_MAX,
  SYSTEM_BUILD_JSON_MAX_BYTES,
  SYSTEM_ID_PATTERN,
  SYSTEM_JSON_MAX_BYTES,
  SYSTEM_NAME_MAX,
  SYSTEM_NOTE_MAX,
  SYSTEM_OVERVIEW_MAX,
  SYSTEM_QUIET_MS,
  SYSTEMS_MAX,
  TOKENS_CSS_MAX_BYTES,
} from '../../shared/limits.ts';
import {
  buildSystemDetail,
  isReservedSystemId,
  isSystemSection,
  parseBuildJson,
  parseSystemState,
  sectionFingerprints,
  deriveReview,
  AREA_OF_SECTION,
  SYSTEM_REVIEW_NOTE_MAX,
  SYSTEM_SECTIONS,
  SYSTEM_TOKEN_RULES,
  SYSTEM_UNREADABLE_PREFIX,
  SYSTEMS_DIR,
  type SystemDetailSource,
  type SystemTokenRules,
} from '../../shared/system-json.ts';
import type { BuildJson, DesignSummary, LivingPageState, SystemDetail, SystemState, SystemSummary } from '../../shared/types.ts';
import type { ChangeHub, DesignIndex, Logger, SelfWrites, ServiceContext, SettingsStore } from '../context.ts';
import { ApiError } from '../http.ts';
import { isAtomicTempName, isInsideOrEqual, LINK_SENTENCE, renameWithRetry, resolveInside, resolvePlainTarget, samePath, slugify, writeFileAtomic } from '../paths.ts';
import { folderErrorSentence, isDirectory } from '../root.ts';
import { treeHashOf } from '../versions.ts';
import { systemSelfWritesKey } from '../watch.ts';

// ---- sentences ----

export const SYSTEM_GONE_MESSAGE = 'That design system is no longer in your Designs folder.';
export const SYSTEMS_CAP_MESSAGE = `You have ${SYSTEMS_MAX} design systems. Delete one to make another.`;
export const SYSTEM_OVER_LIMIT_MESSAGE = `This folder is over the limit of ${SYSTEMS_MAX} design systems.`;
const NAME_EMPTY = 'Give the design system a name.';
const NAME_LONG = `A design system name can be up to ${SYSTEM_NAME_MAX} characters.`;
const NAME_CONTROL = "A design system name can't hold line breaks or control characters.";
const nameTaken = (existing: string): string => `You already have a system called ${existing}.`;
const reservedSentence = (id: string): string => `This folder is named ${id}, which Design Chamber keeps for itself. Rename the folder to use it.`;
const FOLDER_UNREADABLE = `${SYSTEM_UNREADABLE_PREFIX} Its folder can't be opened.`;

/** AD-20: the refusal for a system that lives in a project repo (edits, uploads; restore words it its own way). */
export const readOnlyMessage = (name: string, repo: string): string => `${name} lives in ${repo}. Change the values there, or ask the agent here.`;

/** The repo label of a home: the folder's base name, as the sentences name it ("shop"). */
export const repoLabelOf = (directory: string): string => path.basename(directory) || directory;

/** AD-20 (T12b): a repo-backed system is read-only here, refused before any stamp, version or write. */
export const refuseReadOnly = (state: SystemState): void => {
  if (state.home?.kind !== 'repo') return;
  throw new ApiError('read-only', readOnlyMessage(state.name, repoLabelOf(state.home.directory)));
};

/** AD-18 (§5.13): the sentence for a write the guard below stopped (a bug, never the user's doing). */
export const WRITE_OUTSIDE_ROOT_MESSAGE = 'Design Chamber stopped a write outside your Designs folder. Nothing was changed.';

/**
 * AD-18 (§5.13): every systems write lands under the designs root (the repo is never written). A
 * target outside it is refused with 500 and logged with the system id only (no path in the log).
 */
export const guardSystemWrite = async (root: string, target: string, id: string, log: Pick<Logger, 'error'>): Promise<void> => {
  const rootReal = await realpath(root).catch(() => path.resolve(root));
  if (isInsideOrEqual(rootReal, target) || isInsideOrEqual(path.resolve(root), target)) return;
  log.error('systems.write-outside-root', { system: id });
  throw new ApiError('internal', WRITE_OUTSIDE_ROOT_MESSAGE);
};

// ---- content walk bounds ----

/** Entries the content walk of one system looks at (assets and sources are capped at 200 files by policy). */
const CONTENT_ENTRIES_MAX = 2000;
/** Folder levels the content walk goes down (`assets/fonts/x` is level 2). */
const CONTENT_DEPTH_MAX = 6;
/** Files larger than this are not hashed (counted by size and time instead); no system file the service reads is this large. */
const HASH_MAX_BYTES = 32 * 1024 * 1024;
/** Top-level names that are not part of the content set (§2.10): the agent's records, the S8 staging
 * folders, and the snapshot's own record (under `filesDir` = `snapshot/`, `SNAPSHOT.json` is top-level). */
const NOT_CONTENT = new Set(['BUILD.json', 'PROPOSAL.json', 'proposal', 'snapshot', 'SNAPSHOT.json']);
/** A body or overview is read up to 4 bytes per character of its cap: more is certainly over the cap. */
const BYTES_PER_CHAR_MAX = 4;

const SEED_TOKENS_CSS = ':root {\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n  }\n}\n';
const SEED_SYSTEM_JSON = '{\n  "version": 1,\n  "tokens": {}\n}\n';

const CREATE_LOCK = '\0systems';

// ---- the store ----

export type SystemStoreDeps = {
  settings: SettingsStore;
  hub: ChangeHub;
  log: Logger;
  selfWrites: SelfWrites;
  /** The design summaries, for `usedBy` (a design's copy names the system, T7). Absent → 0. */
  designs?: Pick<DesignIndex, 'all'>;
  /** Test seams. */
  now?: () => Date;
  quietMs?: number;
  indexRefreshMs?: number;
  rules?: SystemTokenRules;
};

/**
 * What a new system is made from beyond its name (§7.2), built by `extract.ts`. `write` runs inside
 * the create lock on the new, empty folder and must leave tokens.css and system.json there; any
 * throw moves the half-made folder to the trash like every failed create.
 */
export type SystemSeed = {
  write(systemDir: string): Promise<void>;
  /** The Code scan's source line and provenance for state.json (re-sync, §7.3). */
  code?: { source: NonNullable<SystemState['sources']['code']>; provenance: SystemState['provenance'] };
};

export type SystemStore = {
  /** Every system folder in the current root, over-limit and unusable ones with their sentence; newest first. */
  list(): Promise<SystemSummary[]>;
  /** `_systems/<id>` after the pattern, containment and lstat checks; 404 sentence otherwise. */
  dir(id: string): Promise<string>;
  /** `dir(id)` for an internal home, `dir(id)/snapshot` for a repo-backed one (AD-14). */
  filesDir(id: string): Promise<string>;
  get(id: string): Promise<SystemDetailSource>;
  detail(id: string): Promise<SystemDetail>;
  /** With a seed (a Code scan or a preset, §7.2) its files replace the empty tokens.css and system.json. */
  create(input: CreateSystemBody, seed?: SystemSeed): Promise<{ id: string; system: SystemDetail }>;
  patch(id: string, body: PatchSystemBody): Promise<PatchSystemResponse>;
  trash(id: string, options?: TrashOptions): Promise<DeleteSystemResponse>;
  /** The systems index (§5.1): the last good list, refreshed after `system` and `root` events. */
  index(): readonly SystemSummary[];
  /** Run `fn` on the system's chain (its lock): revision bumps, and later edits and restores. */
  withLock<T>(id: string, fn: () => Promise<T>): Promise<T>;
  /** state.json as read now (provisional when missing or damaged); 404 sentence when the system is gone. */
  readState(id: string): Promise<SystemState>;
  /**
   * Inside `withLock(id)` only (it takes no lock itself, so it never waits on its own chain): read
   * state.json, apply `mutate` and write the result atomically with `updated` set; `null` writes nothing.
   */
  updateStateLocked(id: string, mutate: (state: SystemState) => SystemState | null): Promise<void>;
  /** Bump the revision now when the content tree changed (a user's save, re-sync or restore landed). */
  settleRevision(id: string): Promise<void>;
  /**
   * §5.4 "settled": no change other than the user's own reached the system for `SYSTEM_QUIET_MS`
   * (the agent may be mid-write otherwise, so a link would copy half a system).
   */
  isSettled(id: string): boolean;
  /** Settings notices queued by deletes and adoption, answered once (`GET /settings`). */
  takeNotices(): string[];
  /**
   * T14 attaches the committed living page's state (`living-page.ts` imports this store, so it plugs
   * in rather than being imported). Until then, and for an internal home, the line is null.
   */
  attachLivingPages(reader: LivingPageReader): void;
  /** Queue a one-time page notice (an adopted build's name clash, §5.9). */
  queueNotice(text: string): void;
  dispose(): Promise<void>;
};

/** The committed living page's state for the detail and the list row; null when it can't be had. */
export type LivingPageReader = (id: string) => Promise<{ state: LivingPageState; sentence: string } | null>;

/** `trash` options: `guard` runs on the state under the system's lock, before the move; a throw refuses it (a build Stop, §5.9). */
export type TrashOptions = { guard?: (state: SystemState) => void };

const isRealDirectory = async (target: string): Promise<boolean> => {
  try {
    const info = await lstat(target);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
};

const timestampOf = (date: Date): string => {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
};

/** Names compare ignoring case (§2.5: NFKC, lower). */
const foldName = (name: string): string => name.normalize('NFKC').toLowerCase();

/** The user's name for a system: NFKC, trimmed, 1..60 characters, no control character. Throws the sentence. */
export const checkSystemName = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new ApiError('bad-request', NAME_EMPTY);
  const name = raw.normalize('NFKC').trim();
  if (name === '') throw new ApiError('bad-request', NAME_EMPTY);
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) throw new ApiError('bad-request', NAME_CONTROL);
  if (name.length > SYSTEM_NAME_MAX) throw new ApiError('bad-request', NAME_LONG);
  return name;
};

/**
 * The id minted from a name: its slug (a name with no Latin letter or digit gives `system`), then
 * `-2` … `-99` until it is not taken. `taken` compares ignoring case, because on Windows and macOS
 * `Acme` and `acme` are one folder; `none` and `ask` count as taken (reserved).
 */
export const mintSystemId = (name: string, taken: ReadonlySet<string>): string => {
  const base = /[a-z0-9]/i.test(name.normalize('NFKD')) ? slugify(name) : 'system';
  const free = (candidate: string): boolean => SYSTEM_ID_PATTERN.test(candidate) && !taken.has(candidate) && !isReservedSystemId(candidate);
  if (free(base)) return base;
  for (let n = 2; n <= 99; n += 1) {
    const candidate = `${base.slice(0, 60)}-${n}`;
    if (free(candidate)) return candidate;
  }
  throw new ApiError('conflict', 'Too many design systems share this name. Choose a different name.');
};

/** Up to `max + 1` bytes of a file (one more than the cap tells "over" apart from "exactly at it"). */
const readBounded = async (file: string, max: number): Promise<{ bytes: Buffer; over: boolean }> => {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(max + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return { bytes: buffer.subarray(0, Math.min(filled, max)), over: filled > max };
  } finally {
    await handle.close();
  }
};

const sha256OfFile = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });

/** One system's content files as the walk found them. */
type Content = {
  files: { rel: string; bytes: number }[];
  /** rel → sha256 of the raw bytes (files over HASH_MAX_BYTES are left out). */
  hashes: Record<string, string>;
  /** The content set's tree hash (`rel\0hash` lines; an unhashed file counts by size and time). */
  treeHash: string;
};

export const createSystemStore = (deps: SystemStoreDeps): SystemStore => {
  const { settings, hub, log, selfWrites } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const quietMs = deps.quietMs ?? SYSTEM_QUIET_MS;
  const indexRefreshMs = deps.indexRefreshMs ?? DESIGN_INDEX_REFRESH_MS;
  const rules = deps.rules ?? SYSTEM_TOKEN_RULES;

  const locks = new Map<string, Promise<unknown>>();
  const hashCache = new Map<string, { key: string; sha256: string }>();
  const quietTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** When a change that was not the user's last reached each system (for `isSettled`). */
  const lastOtherChange = new Map<string, number>();
  const notices: string[] = [];
  let summaries: readonly SystemSummary[] = [];
  let indexTimer: ReturnType<typeof setTimeout> | null = null;
  let indexInFlight: Promise<void> | null = null;
  let indexDirty = false;
  let disposed = false;
  /** Settles the systems found on the first index load (a restart after the agent changed them). */
  let firstLoad = true;

  const withLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = locks.get(key) ?? Promise.resolve();
    // Assigned synchronously by the Promise constructor below, before the first await.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => gate);
    locks.set(key, chain);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === chain) locks.delete(key);
    }
  };

  const gone = (): ApiError => new ApiError('not-found', SYSTEM_GONE_MESSAGE);

  /**
   * The designs root with its links resolved: every path below it is built from this, because the
   * containment checks compare realpaths (a root that is itself a link, like macOS `/var` or a linked
   * Documents folder, would otherwise read as a link inside it). A root that does not exist yet answers as set.
   */
  const realRootOf = async (): Promise<string> => {
    const root = settings.root();
    return realpath(root).catch(() => root);
  };

  /** `<root>/_systems`, when it is a real folder; null otherwise (no systems). */
  const systemsDirOf = async (root: string): Promise<string | null> => {
    const dir = path.join(root, SYSTEMS_DIR);
    return (await isRealDirectory(dir)) ? dir : null;
  };

  /** The system folder names in the root (pattern-passing real folders), sorted. */
  const systemIds = async (root: string): Promise<string[]> => {
    const systemsDir = await systemsDirOf(root);
    if (systemsDir === null) return [];
    const entries = await readdir(systemsDir, { withFileTypes: true });
    // A Dirent of a link is never isDirectory(): a linked system folder is not a system.
    return entries.filter((entry) => entry.isDirectory() && SYSTEM_ID_PATTERN.test(entry.name)).map((entry) => entry.name).sort();
  };

  const dir = async (id: string): Promise<string> => {
    if (typeof id !== 'string' || !SYSTEM_ID_PATTERN.test(id)) throw new ApiError('bad-slug', 'That is not a design system id.');
    const root = settings.root();
    if (!(await isDirectory(root))) throw gone();
    const lexical = path.join(await realpath(root), SYSTEMS_DIR, id);
    // `_systems` and `<id>` must be real folders: a link there is not a system, wherever it points.
    if (!(await isRealDirectory(path.dirname(lexical))) || !(await isRealDirectory(lexical))) throw gone();
    // Containment as for every path, and the realpath equals the lexical path only when no step is a link.
    const real = await resolveInside(root, [SYSTEMS_DIR, id]);
    if (!samePath(real, lexical)) throw gone();
    return lexical;
  };

  const readStateOf = async (systemDir: string, id: string): Promise<{ state: SystemState; fromDisk: boolean }> => {
    const nowIso = now().toISOString();
    let file: string;
    try {
      file = await resolvePlainTarget(systemDir, ['.chamber', 'state.json'], { allowAbsent: true });
    } catch (error) {
      // `.chamber` or state.json is a link or a folder: never read through it; the state is provisional.
      if (error instanceof ApiError) {
        log.warn('systems.state-not-plain', { id, message: 'state.json is not a plain file; the system reads as provisional.' });
        return { state: parseSystemState(null, id, nowIso), fromDisk: false };
      }
      throw error;
    }
    const read = await readBounded(file, SYSTEM_JSON_MAX_BYTES).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (read === null) return { state: parseSystemState(null, id, nowIso), fromDisk: false };
    let raw: unknown = null;
    try {
      raw = read.over ? null : JSON.parse(read.bytes.toString('utf8'));
    } catch {
      raw = null;
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      log.warn('systems.state-unparseable', { id, message: 'state.json is damaged; the system reads as provisional until the next service write.' });
      return { state: parseSystemState(null, id, nowIso), fromDisk: false };
    }
    return { state: parseSystemState(raw, id, nowIso), fromDisk: true };
  };

  /** state.json, atomically; `.chamber` made without recursion, so a deleted system folder is never recreated. */
  const writeStateOf = async (systemDir: string, state: SystemState): Promise<void> => {
    try {
      await mkdir(path.join(systemDir, '.chamber'));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw gone();
      if (code !== 'EEXIST') throw error;
    }
    const file = await resolvePlainTarget(systemDir, ['.chamber', 'state.json'], { allowAbsent: true });
    await guardSystemWrite(settings.root(), file, state.id, log);
    try {
      await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`, { createDirs: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !(await isRealDirectory(systemDir))) throw gone();
      throw error;
    }
  };

  const filesDirOf = async (systemDir: string, state: SystemState): Promise<string> => {
    if (state.home?.kind !== 'repo') return systemDir;
    // `snapshot/` must be a real folder: containment first, then the realpath equal to the lexical
    // path (a link anywhere on the way is refused, even one pointing inside), then an lstat.
    const lexical = path.join(systemDir, 'snapshot');
    const real = await resolveInside(systemDir, ['snapshot']);
    if (!samePath(real, lexical)) throw new ApiError('invalid', LINK_SENTENCE);
    const info = await lstat(lexical).catch(() => null);
    // No snapshot yet: the path reads as empty ("Being built in chat", §2.10). A file or a link
    // where the snapshot folder should be is never read through.
    if (info === null) return lexical;
    if (!info.isDirectory()) throw new ApiError('invalid', LINK_SENTENCE);
    return lexical;
  };

  /** Hash a file, reusing the last hash while its size and time are unchanged. */
  const hashOf = async (file: string, info: { size: number; mtimeMs: number }): Promise<string | null> => {
    if (info.size > HASH_MAX_BYTES) return null;
    const key = `${info.size}:${info.mtimeMs}`;
    const cached = hashCache.get(file);
    if (cached !== undefined && cached.key === key) return cached.sha256;
    const sha256 = await sha256OfFile(file);
    hashCache.set(file, { key, sha256 });
    return sha256;
  };

  /**
   * The content set under `filesDir` (§2.10): every regular file except dot names, temp names,
   * `.chamber/`, `.versions/`, `BUILD.json`, `PROPOSAL.json`, `proposal/` and `snapshot/`. Links are
   * never followed; the walk is bounded.
   */
  const readContent = async (filesDir: string): Promise<Content> => {
    const files: Content['files'] = [];
    const hashes: Record<string, string> = {};
    const tree: Record<string, string> = {};
    let budget = CONTENT_ENTRIES_MAX;
    const walk = async (relDir: string, depth: number): Promise<void> => {
      const absDir = relDir === '' ? filesDir : path.join(filesDir, ...relDir.split('/'));
      const entries = (await readdir(absDir, { withFileTypes: true }).catch(() => [])).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (budget <= 0) return;
        if (entry.name.startsWith('.') || isAtomicTempName(entry.name)) continue;
        if (relDir === '' && NOT_CONTENT.has(entry.name)) continue;
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
        budget -= 1;
        if (entry.isDirectory()) {
          if (depth < CONTENT_DEPTH_MAX) await walk(rel, depth + 1);
        } else if (entry.isFile()) {
          const abs = path.join(absDir, entry.name);
          const info = await stat(abs).catch(() => null);
          if (info === null) continue; // vanished mid-walk
          files.push({ rel, bytes: info.size });
          const hash = await hashOf(abs, info).catch(() => null);
          if (hash !== null) hashes[rel] = hash;
          tree[rel] = hash ?? `unhashed:${info.size}:${info.mtimeMs}`;
        }
      }
    };
    await walk('', 0);
    return { files, hashes, treeHash: treeHashOf(tree) };
  };

  /** A content text file, bounded; null when absent or not a plain file. `over` when beyond the cap. */
  const readText = async (filesDir: string, rel: string, maxBytes: number): Promise<{ text: string; over: boolean } | null> => {
    let file: string;
    try {
      file = await resolvePlainTarget(filesDir, rel.split('/'));
    } catch {
      return null; // absent, a link or a folder: not readable as this file
    }
    try {
      const read = await readBounded(file, maxBytes);
      return { text: read.bytes.toString('utf8'), over: read.over };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };

  /** BUILD.json (§2.13), the agent's interview record: parsed, bounded; null when absent, a link or over the cap. */
  const readBuild = async (systemDir: string): Promise<BuildJson | null> => {
    let file: string;
    try {
      file = await resolvePlainTarget(systemDir, ['BUILD.json'], { allowAbsent: true });
    } catch (error) {
      if (error instanceof ApiError) return null; // a link or a folder: never read through
      throw error;
    }
    const read = await readBounded(file, SYSTEM_BUILD_JSON_MAX_BYTES).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (read === null || read.over) return null;
    return parseBuildJson(read.bytes.toString('utf8')).build;
  };

  const get = async (id: string): Promise<SystemDetailSource> => {
    const systemDir = await dir(id);
    const { state } = await readStateOf(systemDir, id);
    const filesDir = await filesDirOf(systemDir, state);
    const content = await readContent(filesDir);
    const tooLarge: string[] = [];
    const systemJson = await readText(filesDir, 'system.json', SYSTEM_JSON_MAX_BYTES);
    if (systemJson?.over === true) tooLarge.push('system.json');
    const tokensCss = await readText(filesDir, 'tokens.css', TOKENS_CSS_MAX_BYTES);
    if (tokensCss?.over === true) tooLarge.push('tokens.css');
    const texts: Record<string, string> = {};
    const overview = await readText(filesDir, 'OVERVIEW.md', SYSTEM_OVERVIEW_MAX * BYTES_PER_CHAR_MAX);
    if (overview !== null) texts['OVERVIEW.md'] = overview.text;
    for (const file of content.files) {
      if (!/^(notes|patterns|brand)\/[^/]+\.md$/.test(file.rel)) continue;
      const body = await readText(filesDir, file.rel, SYSTEM_NOTE_MAX * BYTES_PER_CHAR_MAX);
      if (body !== null) texts[file.rel] = body.text;
    }
    return {
      id,
      dir: systemDir,
      filesDir,
      state,
      systemJson: systemJson === null || systemJson.over ? null : systemJson.text,
      tokensCss: tokensCss === null || tokensCss.over ? null : tokensCss.text,
      texts,
      files: content.files,
      treeHash: content.treeHash,
      build: await readBuild(systemDir),
      hashes: content.hashes,
      tooLarge,
    };
  };

  const designsOf = (): readonly DesignSummary[] => deps.designs?.all() ?? [];

  const settingsFacts = (id: string): { isDefault: boolean; pinnedFor: string[] } => {
    const file = settings.read();
    return {
      isDefault: file.systemDefault?.choice === 'system' && file.systemDefault.id === id,
      pinnedFor: (file.systemPins ?? []).filter((pin) => pin.choice === 'system' && pin.id === id).map((pin) => pin.directory),
    };
  };

  let livingPageReader: LivingPageReader | null = null;

  const detailOf = async (id: string): Promise<SystemDetail> => {
    const detail = buildSystemDetail(await get(id), rules);
    const livingPage = detail.home.kind === 'repo' && livingPageReader !== null ? ((await livingPageReader(id)) ?? detail.livingPage) : detail.livingPage;
    return { ...detail, usedBy: designsOf().filter((design) => design.system?.id === id).length, ...settingsFacts(id), livingPage };
  };

  const summaryOf = (detail: SystemDetail): SystemSummary => ({
    id: detail.id,
    name: detail.name,
    status: detail.status,
    changesToReview: detail.changesToReview,
    sources: detail.sources,
    usedBy: detail.usedBy,
    isDefault: detail.isDefault,
    pinnedFor: detail.pinnedFor,
    updated: detail.updated,
    revision: detail.revision,
    empty: detail.empty,
    unreadable: detail.unreadable,
    home: detail.home.kind === 'internal' ? 'internal' : { repo: detail.home.label, directory: detail.home.directory },
    building: (detail.build !== null && detail.build.round !== 'done') || (detail.home.kind === 'repo' && detail.snapshot === null),
    sharedRepoWith: null,
    livingPage: detail.livingPage?.state ?? null,
    // T17 (proposals) fills this.
    proposalWaiting: false,
  });

  /** A row that has no detail: an unusable folder, one over the cap, or one that can't be read. */
  const blankSummary = async (root: string, id: string, unreadable: string): Promise<SystemSummary> => {
    const systemDir = path.join(root, SYSTEMS_DIR, id); // id passed SYSTEM_ID_PATTERN; only the bounded state read below
    const { state } = await readStateOf(systemDir, id).catch(() => ({ state: parseSystemState(null, id, now().toISOString()) }));
    return {
      id,
      name: state.name,
      status: state.status,
      changesToReview: false,
      sources: { code: null, brand: 0, description: false },
      usedBy: 0,
      isDefault: false,
      pinnedFor: [],
      updated: state.updated,
      revision: state.revision.n,
      empty: false,
      unreadable,
      home: 'internal',
      building: false,
      sharedRepoWith: null,
      livingPage: null,
      proposalWaiting: false,
    };
  };

  const list = async (): Promise<SystemSummary[]> => {
    const root = await realRootOf();
    let ids: string[];
    try {
      ids = await systemIds(root);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') throw new ApiError('bad-path', folderErrorSentence(error, path.join(root, SYSTEMS_DIR)));
      throw error;
    }
    const rows: SystemSummary[] = [];
    let usable = 0;
    for (const id of ids) {
      if (isReservedSystemId(id)) {
        rows.push(await blankSummary(root, id, reservedSentence(id)));
        continue;
      }
      usable += 1;
      if (usable > SYSTEMS_MAX) {
        rows.push(await blankSummary(root, id, SYSTEM_OVER_LIMIT_MESSAGE));
        continue;
      }
      try {
        rows.push(summaryOf(await detailOf(id)));
      } catch (error) {
        // One broken system must not blank the whole list (loud in the log, graceful on screen).
        log.warn('systems.list-entry-failed', { id, error: error instanceof Error ? error.message : String(error) });
        rows.push(await blankSummary(root, id, FOLDER_UNREADABLE));
      }
    }
    for (const row of rows) {
      if (row.home === 'internal') continue;
      const home = row.home;
      const other = rows.find((candidate) => candidate !== row && candidate.home !== 'internal' && samePath(candidate.home.directory, home.directory));
      row.sharedRepoWith = other?.name ?? null;
    }
    return rows.sort((a, b) => (a.updated === b.updated ? a.id.localeCompare(b.id) : b.updated.localeCompare(a.updated)));
  };

  // ---- revision (AD-13) ----

  const settleRevision = async (id: string): Promise<void> => {
    const bumped = await withLock(id, async () => {
      let systemDir: string;
      try {
        systemDir = await dir(id);
      } catch (error) {
        if (error instanceof ApiError) return false; // deleted or moved meanwhile: nothing to settle
        throw error;
      }
      const { state } = await readStateOf(systemDir, id);
      // A repo-backed revision follows its snapshot: the refresh bumps it at once (§5.10 step 6, T13);
      // a quiet settle never does (BUILD.json is outside the content set, and a hand-changed snapshot
      // is tamper, not a revision).
      if (state.home?.kind === 'repo') return false;
      const content = await readContent(await filesDirOf(systemDir, state));
      if (content.treeHash === state.revision.treeHash) return false;
      const at = now().toISOString();
      await writeStateOf(systemDir, { ...state, revision: { n: state.revision.n + 1, treeHash: content.treeHash, at }, updated: at });
      return true;
    });
    if (bumped) hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'state' });
  };

  const scheduleQuiet = (id: string): void => {
    if (disposed) return;
    const existing = quietTimers.get(id);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      quietTimers.delete(id);
      settleRevision(id).catch((error) => log.warn('systems.revision-failed', { id, error: error instanceof Error ? error.message : String(error) }));
    }, quietMs);
    timer.unref?.();
    quietTimers.set(id, timer);
  };

  // ---- the index ----

  const refreshIndex = (): void => {
    if (disposed) return;
    if (indexInFlight !== null) {
      indexDirty = true;
      return;
    }
    indexInFlight = list()
      .then(
        (rows) => {
          summaries = rows;
          if (firstLoad) {
            firstLoad = false;
            for (const row of rows) if (row.unreadable === null) scheduleQuiet(row.id);
          }
        },
        (error: unknown) => log.warn('systems.index-refresh-failed', { error: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => {
        indexInFlight = null;
        if (indexDirty) {
          indexDirty = false;
          scheduleIndex();
        }
      });
  };

  const scheduleIndex = (): void => {
    if (disposed || indexTimer !== null) return;
    indexTimer = setTimeout(() => {
      indexTimer = null;
      refreshIndex();
    }, indexRefreshMs);
    indexTimer.unref?.();
  };

  const clearQuiet = (id: string): void => {
    const timer = quietTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    quietTimers.delete(id);
  };

  const unsubscribe = hub.subscribe((event) => {
    if (event.kind === 'root') {
      for (const id of [...quietTimers.keys()]) clearQuiet(id);
      lastOtherChange.clear();
      hashCache.clear();
      firstLoad = true;
      scheduleIndex();
      return;
    }
    if (event.kind !== 'system' || event.system === undefined) return;
    const id = event.system;
    if (event.systemChange === 'removed') {
      clearQuiet(id);
      lastOtherChange.delete(id);
      selfWrites.forgetDesign(systemSelfWritesKey(id));
    } else if ((event.systemChange === 'files' || event.systemChange === 'added') && event.origin !== 'user') {
      // The agent's (or a hand-made folder's) change: a new revision once it has been quiet for a while.
      lastOtherChange.set(id, now().getTime());
      scheduleQuiet(id);
    }
    scheduleIndex();
  });
  refreshIndex();

  // ---- mutations ----

  const ensureSystemsDir = async (root: string): Promise<string> => {
    const systemsDir = path.join(root, SYSTEMS_DIR);
    try {
      await mkdir(systemsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ApiError('bad-path', folderErrorSentence(error, systemsDir));
    }
    // A file or a link named `_systems` is never written through.
    if (!(await isRealDirectory(systemsDir))) throw new ApiError('conflict', `${systemsDir} isn't a folder, so Design Chamber can't keep design systems there. Move it away and try again.`);
    await resolveInside(root, [SYSTEMS_DIR]);
    return systemsDir;
  };

  /** `.trash/system.<id>-<stamp>[-n]` (§2.1: a dot never occurs in a slug, so this never clashes with a design's trash name). */
  const moveToTrash = async (root: string, id: string, systemDir: string): Promise<string> => {
    const trashRoot = await resolveInside(root, ['.trash']);
    await mkdir(trashRoot, { recursive: true });
    const stamp = timestampOf(now());
    let target = path.join(trashRoot, `system.${id}-${stamp}`);
    for (let suffix = 2; await lstat(target).then(() => true, () => false); suffix += 1) target = path.join(trashRoot, `system.${id}-${stamp}-${suffix}`);
    await renameWithRetry(systemDir, target);
    return target;
  };

  const create = async (input: CreateSystemBody, seed?: SystemSeed): Promise<{ id: string; system: SystemDetail }> => {
    // A Code scan's values travel only through the seed (`extract.ts` reads them from the job's memory).
    if (input.code !== undefined && seed?.code === undefined) throw new ApiError('bad-request', 'That scan is no longer available. Scan the folder again.');
    const name = checkSystemName(input.name);
    try {
      await mkdir(settings.root(), { recursive: true });
    } catch (error) {
      throw new ApiError('bad-path', folderErrorSentence(error, settings.root()));
    }
    const id = await withLock(CREATE_LOCK, async () => {
      const root = await realRootOf();
      const systemsDir = await ensureSystemsDir(root);
      const entries = await readdir(systemsDir, { withFileTypes: true });
      const ids = entries.filter((entry) => entry.isDirectory() && SYSTEM_ID_PATTERN.test(entry.name)).map((entry) => entry.name);
      if (ids.filter((one) => !isReservedSystemId(one)).length >= SYSTEMS_MAX) throw new ApiError('conflict', SYSTEMS_CAP_MESSAGE);
      for (const other of ids) {
        const { state } = await readStateOf(path.join(systemsDir, other), other);
        if (foldName(state.name) === foldName(name)) throw new ApiError('conflict', nameTaken(state.name));
      }
      const minted = mintSystemId(name, new Set(entries.map((entry) => entry.name.toLowerCase())));
      const systemDir = path.join(systemsDir, minted);
      try {
        await mkdir(systemDir); // not recursive: an existing folder is never taken over
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiError('conflict', 'A design system with that name appeared while this one was being made. Try again.');
        throw new ApiError('bad-path', folderErrorSentence(error, systemDir));
      }
      try {
        if (seed === undefined) {
          await writeFileAtomic(await resolvePlainTarget(systemDir, ['tokens.css'], { allowAbsent: true }), SEED_TOKENS_CSS, { createDirs: false });
          await writeFileAtomic(await resolvePlainTarget(systemDir, ['system.json'], { allowAbsent: true }), SEED_SYSTEM_JSON, { createDirs: false });
        } else {
          await seed.write(systemDir);
        }
        const at = now().toISOString();
        const content = await readContent(systemDir);
        const state: SystemState = {
          ...parseSystemState(null, minted, at),
          name,
          revision: { n: 1, treeHash: content.treeHash, at },
          provenance: seed?.code?.provenance ?? {},
          sources: {
            code: seed?.code?.source ?? null,
            brand: input.brand === true ? { files: [] } : null,
            description: input.description === undefined ? null : { text: input.description.text, preset: input.description.preset },
          },
          home: { kind: 'internal' },
        };
        await writeStateOf(systemDir, state);
      } catch (error) {
        // Never leave a half-made system: the folder goes to the trash and the user hears why.
        await moveToTrash(root, minted, systemDir).catch((trashError: unknown) =>
          log.error('systems.create-cleanup-failed', { id: minted, error: trashError instanceof Error ? trashError.message : String(trashError) }),
        );
        log.warn('systems.create-failed', { id: minted, error: error instanceof Error ? error.message : String(error) });
        if (error instanceof ApiError) throw error; // a seed's own sentence (a link where a folder should be, …)
        throw new ApiError('bad-path', folderErrorSentence(error, systemDir));
      }
      return minted;
    });
    // T8 writes `.chamber/RULES.md` (the system contract for the agent) here.
    // `origin: 'user'`: the revision is already recorded, so this is not the agent's change to settle.
    hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'added', origin: 'user' });
    return { id, system: await detailOf(id) };
  };

  const patch = async (id: string, body: PatchSystemBody): Promise<PatchSystemResponse> => {
    let readyNote: PatchSystemResponse['readyNote'];
    const changed = await withLock(id, async () => {
      const systemDir = await dir(id);
      const { state } = await readStateOf(systemDir, id);
      const at = now().toISOString();
      let next: SystemState = state;
      if ('name' in body) {
        const name = checkSystemName(body.name);
        if (name === state.name) return false;
        const others = (await systemIds(await realRootOf())).filter((other) => other !== id);
        for (const other of others) {
          const { state: otherState } = await readStateOf(path.join(path.dirname(systemDir), other), other);
          if (foldName(otherState.name) === foldName(name)) throw new ApiError('conflict', nameTaken(otherState.name));
        }
        next = { ...state, name };
      } else if ('status' in body) {
        if (body.status === 'draft') next = { ...state, status: 'draft', readyFingerprints: null };
        else {
          const source = await get(id);
          const detail = buildSystemDetail(source, rules);
          const fingerprints = sectionFingerprints(detail, source.hashes ?? {});
          const derived = deriveReview(state, fingerprints);
          const covered = new Set(detail.coverage);
          readyNote = { unreviewed: SYSTEM_SECTIONS.filter((section) => covered.has(AREA_OF_SECTION[section]) && derived.review[section].state !== 'looks-good').length };
          next = { ...state, status: 'ready', readyFingerprints: fingerprints };
        }
      } else if ('review' in body) {
        const { section, state: reviewState, note } = body.review;
        if (!isSystemSection(section)) throw new ApiError('bad-request', "That isn't a section of a design system.");
        const source = await get(id);
        const detail = buildSystemDetail(source, rules);
        if (!detail.coverage.includes(AREA_OF_SECTION[section])) throw new ApiError('invalid', 'This system does not cover that section, so it has nothing to review.');
        const review = { ...state.review };
        if (reviewState === 'not-reviewed') delete review[section];
        else {
          if (note !== undefined && (typeof note !== 'string' || note.length > SYSTEM_REVIEW_NOTE_MAX)) throw new ApiError('bad-request', `A review note can be up to ${SYSTEM_REVIEW_NOTE_MAX} characters.`);
          const fingerprint = sectionFingerprints(detail, source.hashes ?? {})[section];
          review[section] = { state: reviewState, fingerprint, at, ...(note !== undefined && note !== '' ? { note } : {}) };
        }
        next = { ...state, review };
      } else if ('sessionId' in body) {
        const sessionId = body.sessionId;
        if (sessionId !== null && (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > SESSION_ID_MAX)) throw new ApiError('bad-request', 'That is not a chat session id.');
        if (sessionId === state.sessionId) return false;
        next = { ...state, sessionId };
      } else if ('livingPage' in body) {
        if (state.home?.kind !== 'repo') throw new ApiError('invalid', 'Only a design system kept in a project repo has a living page.');
        // AD-32: the user's switch only; the route regenerates the staged page once it lands.
        const embedFonts = body.livingPage.embedFonts;
        if ((state.livingPage?.embedFonts === true) === embedFonts) return false;
        next = { ...state, livingPage: { embedFonts } };
      } else {
        throw new ApiError('bad-request', 'Say what to change: name, status, review, sessionId or livingPage.');
      }
      await writeStateOf(systemDir, { ...next, updated: at });
      return true;
    });
    if (changed) hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'state' });
    const system = summaryOf(await detailOf(id));
    return readyNote === undefined ? { system } : { system, readyNote };
  };

  const trash = async (id: string, options: TrashOptions = {}): Promise<DeleteSystemResponse> => {
    const { trashedTo, name, repo } = await withLock(id, async () => {
      const systemDir = await dir(id);
      const { state } = await readStateOf(systemDir, id);
      // Under the same lock as the move, so nothing (an `applied` stamp seen meanwhile) lands between the check and the move.
      options.guard?.(state);
      const target = await moveToTrash(await realRootOf(), id, systemDir);
      return { trashedTo: target, name: state.name, repo: state.home?.kind === 'repo' };
    });
    clearQuiet(id);
    selfWrites.forgetDesign(systemSelfWritesKey(id));
    hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'removed' });

    // Clear what names it: the default goes back to ask, the pins are removed (§5.1), each said once.
    const file = settings.read();
    const clearDefault = file.systemDefault?.choice === 'system' && file.systemDefault.id === id;
    const pins = file.systemPins ?? [];
    const removedPins = pins.filter((pin) => pin.choice === 'system' && pin.id === id);
    let clearedSettings = { default: false, pins: 0 };
    if (clearDefault || removedPins.length > 0) {
      try {
        await settings.update({
          ...(clearDefault ? { systemDefault: { choice: 'ask' as const } } : {}),
          ...(removedPins.length > 0 ? { systemPins: pins.filter((pin) => !removedPins.includes(pin)) } : {}),
        });
        clearedSettings = { default: clearDefault, pins: removedPins.length };
        if (clearDefault) notices.push(`${name} was deleted, so it is no longer your default.`);
        for (const pin of removedPins) notices.push(`${name} was deleted, so it is no longer pinned for ${path.basename(pin.directory) || pin.directory}.`);
      } catch (error) {
        // The system is in the trash either way; a setting naming it reads as missing until the next save (§3.4).
        log.warn('systems.settings-clear-failed', { id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    // T8 re-syncs the per-project instructions of the removed pins (§8.6).
    return repo ? { trashedTo, clearedSettings, repoUntouched: true } : { trashedTo, clearedSettings };
  };

  return {
    list,
    dir,
    async filesDir(id) {
      const systemDir = await dir(id);
      return filesDirOf(systemDir, (await readStateOf(systemDir, id)).state);
    },
    get,
    detail: detailOf,
    create,
    patch,
    trash,
    index: () => summaries,
    withLock,
    async readState(id) {
      return (await readStateOf(await dir(id), id)).state;
    },
    async updateStateLocked(id, mutate) {
      const systemDir = await dir(id);
      const next = mutate((await readStateOf(systemDir, id)).state);
      if (next !== null) await writeStateOf(systemDir, { ...next, updated: now().toISOString() });
    },
    settleRevision,
    isSettled(id) {
      const last = lastOtherChange.get(id);
      return last === undefined || now().getTime() - last >= quietMs;
    },
    takeNotices: () => notices.splice(0, notices.length),
    queueNotice: (text) => void notices.push(text),
    attachLivingPages(reader) {
      livingPageReader = reader;
    },
    async dispose() {
      disposed = true;
      unsubscribe();
      if (indexTimer !== null) clearTimeout(indexTimer);
      indexTimer = null;
      for (const id of [...quietTimers.keys()]) clearQuiet(id);
      await indexInFlight;
    },
  };
};

// ---- the context accessor (the `ensureVersionsService` pattern, §5) ----

const instances = new WeakMap<ServiceContext, SystemStore>();

/** The one system store of a composed service; created on first use and disposed with the service. */
export const ensureSystemStore = (ctx: ServiceContext): SystemStore => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createSystemStore({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, selfWrites: ctx.selfWrites, designs: ctx.designIndex });
  instances.set(ctx, created);
  ctx.onDispose(() => created.dispose());
  return created;
};
