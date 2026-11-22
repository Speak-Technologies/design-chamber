// Manual folders (Phase 2.5 G1; documentation/specs/phase-2-5-technical.md §2.8, §3.3, §5.8, AD-10).
//
// The registry lives at `<root>/.chamber/folders.json` (schema `design-chamber/folders@1`), so it
// travels with the designs folder. A folder lists designs by slug AND the design's `created` time:
// a title rename changes neither, and a later design that reuses a slug is not in the folder.
// Grouping never touches a design's own folder on disk; this module writes one file only.
//
// Safety rules this module holds:
// - The path goes through `resolveInside` (for `.chamber`) and `resolvePlainTarget` (for the file),
//   so a `.chamber` link leading out of the root refuses every write, and a `folders.json` that is a
//   link or not a regular file reads as damaged.
// - `.chamber` is made with a non-recursive mkdir: a missing root is never re-created here.
// - The file is untrusted: size-capped before it is read, validated by `parseFoldersRegistry`; a
//   broken file reads as `damaged` and no write replaces it until the user acts. The first user
//   action renames it aside to `folders.damaged-<stamp>.json`, then writes fresh. A prune never does.
// - Every read-modify-write runs on one queue per root (set semantics: two windows adding the same
//   design end with one entry). There is no in-memory copy, so a root change reads the new root's
//   file fresh and never moves the old one.
// - Folder names are the user's words: they never reach a log line.

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FolderListResponse, FolderView } from '../shared/api.ts';
import { FOLDER_DESIGNS_MAX, FOLDER_ID_PATTERN, FOLDER_NAME_MAX, FOLDER_UNDO_MS, FOLDERS_MAX } from '../shared/limits.ts';
import { sameDirectory } from '../shared/path-compare.ts';
import type { DesignSummary, FolderRecord, IsoDate } from '../shared/types.ts';
import type { ChangeHub, DesignStore, Logger, SettingsStore } from './context.ts';
import { ApiError } from './http.ts';
import { isSlug, resolveInside, resolvePlainTarget, writeFileAtomic } from './paths.ts';

export const FOLDERS_FILE_SEGMENTS = ['.chamber', 'folders.json'] as const;
/** A registry larger than this reads as damaged (§2.8). */
export const FOLDERS_FILE_MAX_BYTES = 1_048_576;
/** Slugs per `add` or `remove` list of one request (§3.3). */
export const FOLDER_CHANGE_MAX = 200;

export const FOLDER_NAME_EMPTY = 'Give the folder a name.';
export const FOLDER_NAME_TOO_LONG = `Keep the folder name to ${FOLDER_NAME_MAX} characters or fewer.`;
export const FOLDER_NAME_CONTROL = "A folder name can't contain line breaks or tabs.";
export const FOLDERS_FULL = `You can have up to ${FOLDERS_MAX} folders.`;
export const FOLDER_GONE = "That folder isn't there any more.";
export const FOLDER_UNDELETE_GONE = "That folder can't be brought back any more.";
export const FOLDER_DESIGNS_FULL = `A folder can hold up to ${FOLDER_DESIGNS_MAX.toLocaleString('en-US')} designs.`;
export const folderNameTaken = (name: string): string => `You already have a folder called ${name}.`;

export type FoldersRegistry = { v: 1; rev: number; folders: FolderRecord[] };

/** What the disk holds: no file yet, a valid registry, or a file that could not be used. */
export type RegistryRead = { kind: 'absent' } | { kind: 'ok'; registry: FoldersRegistry } | { kind: 'damaged' };

/** slug → the live design's created time. */
export type LiveDesigns = ReadonlyMap<string, IsoDate>;

// ---- Pure parts (tested directly) ----

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIsoText = (value: unknown): value is IsoDate => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
// Control characters (C0, DEL, C1) plus the line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

/** The name as stored: NFKC, trimmed, 1..FOLDER_NAME_MAX, no control character. Throws `bad-request` with the sentence to show. */
export const normalizeFolderName = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new ApiError('bad-request', FOLDER_NAME_EMPTY);
  const name = raw.normalize('NFKC').trim();
  if (name.length === 0) throw new ApiError('bad-request', FOLDER_NAME_EMPTY);
  if (CONTROL.test(name)) throw new ApiError('bad-request', FOLDER_NAME_CONTROL);
  if (name.length > FOLDER_NAME_MAX) throw new ApiError('bad-request', FOLDER_NAME_TOO_LONG);
  return name;
};

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const parseFolder = (value: unknown): FolderRecord | null => {
  if (!isRecord(value)) return null;
  const { id, name, created, deleted, designs } = value;
  if (typeof id !== 'string' || !FOLDER_ID_PATTERN.test(id)) return null;
  if (typeof name !== 'string') return null;
  let normalized: string;
  try {
    normalized = normalizeFolderName(name);
  } catch {
    return null;
  }
  if (!isIsoText(created)) return null;
  if (deleted !== null && !isIsoText(deleted)) return null;
  if (!Array.isArray(designs) || designs.length > FOLDER_DESIGNS_MAX) return null;
  const entries: FolderRecord['designs'] = [];
  for (const entry of designs) {
    if (!isRecord(entry) || !isSlug(entry.slug) || !isIsoText(entry.created)) return null;
    entries.push({ slug: entry.slug, created: entry.created });
  }
  return { id, name: normalized, created, deleted, designs: entries };
};

/** Validate the registry text; null when anything about it is wrong (the caller reads that as damaged). */
export const parseFoldersRegistry = (text: string): FoldersRegistry | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (typeof raw.rev !== 'number' || !Number.isSafeInteger(raw.rev) || raw.rev < 0) return null;
  if (!Array.isArray(raw.folders)) return null;
  const folders: FolderRecord[] = [];
  const ids = new Set<string>();
  for (const value of raw.folders) {
    const folder = parseFolder(value);
    if (folder === null || ids.has(folder.id)) return null;
    ids.add(folder.id);
    folders.push(folder);
  }
  if (folders.filter((folder) => folder.deleted === null).length > FOLDERS_MAX) return null;
  return { v: 1, rev: raw.rev, folders };
};

export const isLiveMember = (entry: { slug: string; created: IsoDate }, live: LiveDesigns): boolean => live.get(entry.slug) === entry.created;

/** The folder as the list answers it: live members only, each slug once. */
export const folderView = (folder: FolderRecord, live: LiveDesigns): FolderView => ({
  id: folder.id,
  name: folder.name,
  created: folder.created,
  slugs: [...new Set(folder.designs.filter((entry) => isLiveMember(entry, live)).map((entry) => entry.slug))],
});

/** The list answer: deleted folders hidden, members filtered against the live designs. */
export const listView = (read: RegistryRead, live: LiveDesigns): FolderListResponse => {
  // T0 placeholder; F1 answers the registry's manual project members (AD-1).
  if (read.kind === 'damaged') return { folders: [], projects: [], damaged: true };
  if (read.kind === 'absent') return { folders: [], projects: [] };
  return { folders: read.registry.folders.filter((folder) => folder.deleted === null).map((folder) => folderView(folder, live)), projects: [] };
};

/**
 * What every write does first (§2.8): drop folders deleted longer than the undo window ago, and
 * design entries that no longer match a live design (by slug and created). Pure; `changed` says
 * whether anything was dropped.
 */
export const cleanRegistry = (registry: FoldersRegistry, live: LiveDesigns, now: number): { registry: FoldersRegistry; changed: boolean } => {
  let changed = false;
  const folders: FolderRecord[] = [];
  for (const folder of registry.folders) {
    if (folder.deleted !== null && now - Date.parse(folder.deleted) > FOLDER_UNDO_MS) {
      changed = true;
      continue;
    }
    const seen = new Set<string>();
    const designs = folder.designs.filter((entry) => {
      const keep = isLiveMember(entry, live) && !seen.has(entry.slug);
      seen.add(entry.slug);
      return keep;
    });
    if (designs.length !== folder.designs.length) changed = true;
    folders.push({ ...folder, designs });
  }
  return { registry: { ...registry, folders }, changed };
};

/** Set semantics: each added live slug ends present once with its current created; removed slugs end absent. Unknown slugs are skipped. */
export const applyMembership = (folder: FolderRecord, change: { add: readonly string[]; remove: readonly string[] }, live: LiveDesigns): FolderRecord => {
  const drop = new Set(change.remove);
  let designs = folder.designs.filter((entry) => !drop.has(entry.slug));
  for (const slug of change.add) {
    const created = live.get(slug);
    if (created === undefined || drop.has(slug)) continue;
    if (designs.some((entry) => entry.slug === slug && entry.created === created)) continue;
    designs = [...designs.filter((entry) => entry.slug !== slug), { slug, created }];
  }
  if (designs.length > FOLDER_DESIGNS_MAX) throw new ApiError('conflict', FOLDER_DESIGNS_FULL);
  return { ...folder, designs };
};

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** `f_` and ten characters of `[a-z0-9]` (`FOLDER_ID_PATTERN`). */
export const mintFolderId = (): string => `f_${[...randomBytes(10)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('')}`;

const stampOf = (date: Date): string => date.toISOString().replace(/[-:T]/g, '').slice(0, 14);

// ---- Request validation (the route boundary) ----

const slugList = (value: unknown, label: 'add' | 'remove'): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > FOLDER_CHANGE_MAX || !value.every((slug) => typeof slug === 'string' && slug.length <= 200)) {
    throw new ApiError('bad-request', `"${label}" must be a list of at most ${FOLDER_CHANGE_MAX} design names.`);
  }
  // A string that cannot be a slug names no design: skipped like any unknown slug (set semantics).
  return value.filter(isSlug);
};

export const parseFolderChange = (body: unknown): { add: string[]; remove: string[] } => {
  if (!isRecord(body)) throw new ApiError('bad-request', 'The folder change must be a JSON object.');
  const add = slugList(body.add, 'add');
  const remove = slugList(body.remove, 'remove');
  if (add.some((slug) => remove.includes(slug))) throw new ApiError('bad-request', 'A design cannot be added to a folder and removed from it at once.');
  return { add, remove };
};

export const assertFolderId = (value: string): string => {
  if (!FOLDER_ID_PATTERN.test(value)) throw new ApiError('not-found', FOLDER_GONE);
  return value;
};

// ---- The service ----

export type FoldersService = {
  list(): Promise<FolderListResponse>;
  create(name: unknown): Promise<FolderView>;
  rename(id: string, name: unknown): Promise<FolderView>;
  /** Soft delete; answers how many designs were in it. Deleting a deleted folder again answers the same. */
  remove(id: string): Promise<number>;
  undelete(id: string): Promise<FolderView>;
  change(id: string, change: { add: readonly string[]; remove: readonly string[] }): Promise<FolderView>;
  /** Drop entries of designs that are gone (one write, only when something changed; never over a damaged file). */
  prune(): Promise<void>;
  /** Stop listening; settles once queued writes have finished. */
  dispose(): Promise<void>;
};

export type FoldersDeps = {
  settings: SettingsStore;
  hub: ChangeHub;
  store: DesignStore;
  log: Logger;
  now?: () => Date;
  mintId?: () => string;
};

export const createFoldersService = (deps: FoldersDeps): FoldersService => {
  const { settings, hub, store, log } = deps;
  const now = deps.now ?? (() => new Date());
  const mintId = deps.mintId ?? mintFolderId;
  const queues = new Map<string, Promise<unknown>>();

  /** One read-modify-write at a time per root. */
  const queued = <T>(root: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(root) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.catch(() => undefined);
    queues.set(root, settled);
    void settled.then(() => {
      if (queues.get(root) === settled) queues.delete(root);
    });
    return run;
  };

  const liveDesigns = async (): Promise<Map<string, IsoDate>> => {
    const designs = await store.list();
    return new Map(designs.map((design) => [design.slug, design.created]));
  };

  const readRegistry = async (root: string): Promise<RegistryRead> => {
    // A missing root has no folders (and nothing here creates it).
    try {
      await stat(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
      throw error;
    }
    let file: string;
    try {
      file = await resolvePlainTarget(root, FOLDERS_FILE_SEGMENTS, { allowAbsent: true });
    } catch (error) {
      // A link (inside or out of the root) or a non-file at the registry's place is unusable.
      if (error instanceof ApiError) return { kind: 'damaged' };
      throw error;
    }
    let size: number;
    try {
      size = (await lstat(file)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
      throw error;
    }
    if (size > FOLDERS_FILE_MAX_BYTES) return { kind: 'damaged' };
    const registry = parseFoldersRegistry(await readFile(file, 'utf8'));
    return registry === null ? { kind: 'damaged' } : { kind: 'ok', registry };
  };

  /** `<root>/.chamber`, contained and made (non-recursively) when missing. */
  const chamberDir = async (root: string): Promise<string> => {
    const dir = await resolveInside(root, ['.chamber']);
    try {
      await mkdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    // Contained again after the mkdir: a link put there meanwhile is refused here.
    return resolveInside(root, ['.chamber']);
  };

  const writeRegistry = async (root: string, registry: FoldersRegistry): Promise<void> => {
    await chamberDir(root);
    const file = await resolvePlainTarget(root, FOLDERS_FILE_SEGMENTS, { allowAbsent: true });
    await writeFileAtomic(file, `${JSON.stringify(registry, null, 2)}\n`, { createDirs: false });
    hub.emit({ slug: null, kind: 'folders' });
  };

  /** The user acted on a damaged registry: move it aside (never deleted) and start fresh. */
  const setAside = async (root: string): Promise<void> => {
    const dir = await chamberDir(root);
    const aside = path.join(dir, `folders.damaged-${stampOf(now())}.json`);
    await rename(path.join(dir, 'folders.json'), aside);
    log.warn('folders.damaged-set-aside', { file: path.basename(aside) });
  };

  /** A user action: read (setting a damaged file aside), clean, apply, write with rev + 1. */
  const mutate = <T>(apply: (registry: FoldersRegistry, live: LiveDesigns, at: Date) => { registry: FoldersRegistry; result: T }): Promise<T> => {
    const root = settings.root();
    return queued(root, async () => {
      const read = await readRegistry(root);
      if (read.kind === 'damaged') await setAside(root);
      const base: FoldersRegistry = read.kind === 'ok' ? read.registry : { v: 1, rev: 0, folders: [] };
      const live = await liveDesigns();
      const at = now();
      const cleaned = cleanRegistry(base, live, at.getTime()).registry;
      const { registry, result } = apply(cleaned, live, at);
      await writeRegistry(root, { ...registry, rev: base.rev + 1 });
      return result;
    });
  };

  const findLive = (registry: FoldersRegistry, id: string): FolderRecord => {
    const folder = registry.folders.find((candidate) => candidate.id === id && candidate.deleted === null);
    if (folder === undefined) throw new ApiError('not-found', FOLDER_GONE);
    return folder;
  };

  const replace = (registry: FoldersRegistry, folder: FolderRecord): FoldersRegistry => ({
    ...registry,
    folders: registry.folders.map((candidate) => (candidate.id === folder.id ? folder : candidate)),
  });

  const assertNameFree = (registry: FoldersRegistry, name: string, exceptId: string | null): void => {
    const taken = registry.folders.find((folder) => folder.deleted === null && folder.id !== exceptId && sameName(folder.name, name));
    if (taken !== undefined) throw new ApiError('conflict', folderNameTaken(taken.name));
  };

  const prune = (): Promise<void> => {
    const root = settings.root();
    return queued(root, async () => {
      const read = await readRegistry(root);
      if (read.kind !== 'ok') return;
      const { registry, changed } = cleanRegistry(read.registry, await liveDesigns(), now().getTime());
      if (!changed) return;
      await writeRegistry(root, { ...registry, rev: read.registry.rev + 1 });
    });
  };

  const unsubscribe = hub.subscribe((event) => {
    if (event.kind !== 'removed') return;
    prune().catch((error: unknown) => log.warn('folders.prune-failed', { error: error instanceof Error ? error.message : String(error) }));
  });

  return {
    async list() {
      const root = settings.root();
      const [read, live] = await Promise.all([readRegistry(root), liveDesigns()]);
      return listView(read, live);
    },

    create(rawName) {
      const name = normalizeFolderName(rawName);
      return mutate((registry, live, at) => {
        assertNameFree(registry, name, null);
        if (registry.folders.filter((folder) => folder.deleted === null).length >= FOLDERS_MAX) throw new ApiError('conflict', FOLDERS_FULL);
        let id = mintId();
        while (registry.folders.some((folder) => folder.id === id)) id = mintId();
        const folder: FolderRecord = { id, name, created: at.toISOString(), deleted: null, designs: [] };
        return { registry: { ...registry, folders: [...registry.folders, folder] }, result: folderView(folder, live) };
      });
    },

    rename(id, rawName) {
      const name = normalizeFolderName(rawName);
      return mutate((registry, live) => {
        const folder = { ...findLive(registry, id), name };
        assertNameFree(registry, name, id);
        return { registry: replace(registry, folder), result: folderView(folder, live) };
      });
    },

    remove(id) {
      return mutate((registry, live, at) => {
        const existing = registry.folders.find((folder) => folder.id === id);
        if (existing === undefined) throw new ApiError('not-found', FOLDER_GONE);
        const count = folderView(existing, live).slugs.length;
        if (existing.deleted !== null) return { registry, result: count };
        return { registry: replace(registry, { ...existing, deleted: at.toISOString() }), result: count };
      });
    },

    undelete(id) {
      return mutate((registry, live) => {
        // Folders past the undo window were dropped by the clean step, so they are not found here.
        const existing = registry.folders.find((folder) => folder.id === id);
        if (existing === undefined) throw new ApiError('not-found', FOLDER_UNDELETE_GONE);
        if (existing.deleted === null) return { registry, result: folderView(existing, live) };
        assertNameFree(registry, existing.name, id);
        if (registry.folders.filter((folder) => folder.deleted === null).length >= FOLDERS_MAX) throw new ApiError('conflict', FOLDERS_FULL);
        const folder = { ...existing, deleted: null };
        return { registry: replace(registry, folder), result: folderView(folder, live) };
      });
    },

    change(id, change) {
      return mutate((registry, live) => {
        const folder = applyMembership(findLive(registry, id), change, live);
        return { registry: replace(registry, folder), result: folderView(folder, live) };
      });
    },

    prune,

    async dispose() {
      unsubscribe();
      await Promise.all([...queues.values()]);
    },
  };
};

// ---- Project folders for GET /designs (§3.2) ----

/** Distinct project folders the list may show at most. */
export const PROJECT_FOLDERS_MAX = 100;
export const PROJECT_FOLDER_STAT_TTL_MS = 60_000;

export type ProjectFolderStats = (designs: readonly DesignSummary[]) => Promise<{ directory: string; exists: boolean }[]>;

/**
 * ≤ 100 distinct `projectDirectory` values (compared with `sameDirectory`), in list order, each
 * stat'ed and cached for a minute so the list can say "Folder not found". The values come from
 * design.json (agent-written): a relative path is reported missing without a stat, and a UNC
 * path (`\\server\share`, `//server/share`) is never touched, so a design file cannot make the
 * service reach out to a network share; it is reported as present (no claim either way).
 */
export const createProjectFolderStats = (options: { now?: () => number; isDirectory?: (directory: string) => Promise<boolean> } = {}): ProjectFolderStats => {
  const now = options.now ?? Date.now;
  const isDirectory =
    options.isDirectory ??
    (async (directory: string): Promise<boolean> => {
      try {
        return (await stat(directory)).isDirectory();
      } catch {
        return false;
      }
    });
  const cache = new Map<string, { exists: boolean; at: number }>();

  const existsOf = async (directory: string): Promise<boolean> => {
    if (/^[\\/]{2}/.test(directory)) return true;
    if (!path.isAbsolute(directory) && !path.win32.isAbsolute(directory)) return false;
    const hit = cache.get(directory);
    if (hit !== undefined && now() - hit.at < PROJECT_FOLDER_STAT_TTL_MS) return hit.exists;
    const exists = await isDirectory(directory);
    if (cache.size >= PROJECT_FOLDERS_MAX * 4) cache.clear();
    cache.set(directory, { exists, at: now() });
    return exists;
  };

  return async (designs) => {
    const directories: string[] = [];
    for (const design of designs) {
      const directory = design.projectDirectory;
      if (directory === null || directory.trim() === '') continue;
      if (directories.some((seen) => sameDirectory(seen, directory))) continue;
      directories.push(directory);
      if (directories.length >= PROJECT_FOLDERS_MAX) break;
    }
    return Promise.all(directories.map(async (directory) => ({ directory, exists: await existsOf(directory) })));
  };
};

// ---- wiring (routes and shutdown share one instance per context) ----

const instances = new WeakMap<object, FoldersService>();

/** One folders service per context, created on first use and disposed with the context. */
export const ensureFoldersService = (ctx: { settings: SettingsStore; hub: ChangeHub; store: DesignStore; log: Logger; onDispose(fn: () => void | Promise<void>): void }): FoldersService => {
  const existing = instances.get(ctx);
  if (existing) return existing;
  const created = createFoldersService({ settings: ctx.settings, hub: ctx.hub, store: ctx.store, log: ctx.log });
  instances.set(ctx, created);
  ctx.onDispose(() => created.dispose());
  return created;
};
