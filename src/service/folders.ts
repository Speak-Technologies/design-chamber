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
//
// Phase 2.6 (documentation/specs/phase-2-6-technical.md §2.1, §5.1, AD-1, AD-2, AD-6): the same
// file also holds `projects[]`, the designs the user filed by hand under a project. That is
// organisation only: a design's own `projectDirectory` (its derived project) still decides its
// rules and its pinned system, and nothing here is read by those modules. A project's id is its
// directory string, compared with `sameDirectory`; it is a stored string, never opened or stat'ed.
// A 0.4.0 file (no `projects`) reads as `projects: []`; the first write adds the key.

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FolderListResponse, FolderView, MembershipResult, MembershipsResponse, MembershipTarget, ProjectMembersView } from '../shared/api.ts';
import {
  FOLDER_DESIGNS_MAX,
  FOLDER_ID_PATTERN,
  FOLDER_NAME_MAX,
  FOLDER_UNDO_MS,
  FOLDERS_MAX,
  MEMBERSHIP_CHANGES_MAX,
  MEMBERSHIP_SLUGS_TOTAL_MAX,
  PROJECT_DIRECTORY_MAX,
  PROJECT_ENTRIES_MAX,
} from '../shared/limits.ts';
import { sameDirectory } from '../shared/path-compare.ts';
import type { DesignSummary, FolderRecord, IsoDate, ProjectMembersRecord } from '../shared/types.ts';
import type { ChangeHub, DesignStore, Logger, SettingsStore } from './context.ts';
import { ApiError } from './http.ts';
import { isInsideOrEqual, isSlug, resolveInside, resolvePlainTarget, writeFileAtomic } from './paths.ts';

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
export const PROJECT_UNUSABLE = "That project folder can't be used.";
export const PROJECTS_FULL = `You can file designs under up to ${PROJECT_ENTRIES_MAX} projects.`;
export const PROJECT_DESIGNS_FULL = `A project can hold up to ${FOLDER_DESIGNS_MAX.toLocaleString('en-US')} filed designs.`;
/** A write whose file would pass the size cap (§13): refused, nothing written. */
export const FOLDERS_FILE_FULL = 'Folders are full. Take some designs out of folders, then try again.';

export type FoldersRegistry = { v: 1; rev: number; folders: FolderRecord[]; projects: ProjectMembersRecord[] };

/** What the disk holds: no file yet, a valid registry, or a file that could not be used. */
export type RegistryRead = { kind: 'absent' } | { kind: 'ok'; registry: FoldersRegistry } | { kind: 'damaged' };

/** A live design as membership needs it: its created time (the key with the slug) and its derived project. */
export type LiveDesign = { created: IsoDate; projectDirectory: string | null };
/** slug → the live design. */
export type LiveDesigns = ReadonlyMap<string, LiveDesign>;

/** One membership change after the route boundary: lists are slug-filtered and capped. */
export type MembershipChangeInput = { target: MembershipTarget; add: string[]; remove: string[] };

/** The registry could not be read, and the caller (an agent request) may not set it aside. */
export class FoldersDamagedError extends Error {
  constructor() {
    super("Folders couldn't load, so the agent's request wasn't applied.");
    this.name = 'FoldersDamagedError';
  }
}

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

const isAbsoluteAnywhere = (value: string): boolean => path.isAbsolute(value) || path.win32.isAbsolute(value);

/**
 * A project directory as the registry stores it (§2.1), or null when it can't be one: text of at
 * most `PROJECT_DIRECTORY_MAX`, absolute in either flavour, no control character (NUL included),
 * and not the designs root or inside it (lexical, no stat: the string is never opened). Trailing
 * separators are trimmed unless that would leave a bare drive or an empty string.
 */
export const normalizeProjectDirectory = (value: unknown, root: string): string | null => {
  if (typeof value !== 'string' || value.length === 0 || value.length > PROJECT_DIRECTORY_MAX) return null;
  if (CONTROL.test(value)) return null;
  if (!isAbsoluteAnywhere(value)) return null;
  const trimmed = value.replace(/[\\/]+$/, '');
  const stored = isAbsoluteAnywhere(trimmed) ? trimmed : value;
  // Only a path absolute on this platform can sit under the root; a Windows path on POSIX cannot.
  if (path.isAbsolute(stored) && isInsideOrEqual(root, stored)) return null;
  return stored;
};

const parseMembers = (designs: unknown): { slug: string; created: IsoDate }[] | null => {
  if (!Array.isArray(designs) || designs.length > FOLDER_DESIGNS_MAX) return null;
  const entries: { slug: string; created: IsoDate }[] = [];
  for (const entry of designs) {
    if (!isRecord(entry) || !isSlug(entry.slug) || !isIsoText(entry.created)) return null;
    entries.push({ slug: entry.slug, created: entry.created });
  }
  return entries;
};

const parseProject = (value: unknown, root: string): ProjectMembersRecord | null => {
  if (!isRecord(value)) return null;
  const directory = normalizeProjectDirectory(value.directory, root);
  if (directory === null || directory !== value.directory) return null;
  const designs = parseMembers(value.designs);
  return designs === null ? null : { directory, designs };
};

/**
 * Validate the registry text; null when anything about it is wrong (the caller reads that as
 * damaged). `root` is the designs root the file lives in: a project entry at or inside it is
 * corruption. An absent `projects` (a 0.4.0 file) reads as `[]`.
 */
export const parseFoldersRegistry = (text: string, root: string): FoldersRegistry | null => {
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
  // Absent (a 0.4.0 file) reads as none; any other non-list (null included) is damage.
  const rawProjects = raw.projects === undefined ? [] : raw.projects;
  if (!Array.isArray(rawProjects) || rawProjects.length > PROJECT_ENTRIES_MAX) return null;
  const projects: ProjectMembersRecord[] = [];
  for (const value of rawProjects) {
    const project = parseProject(value, root);
    if (project === null || projects.some((seen) => sameDirectory(seen.directory, project.directory))) return null;
    projects.push(project);
  }
  return { v: 1, rev: raw.rev, folders, projects };
};

export const isLiveMember = (entry: { slug: string; created: IsoDate }, live: LiveDesigns): boolean => live.get(entry.slug)?.created === entry.created;

/** The design's derived project is this directory: a manual entry there would only shadow it. */
const isDerivedMember = (slug: string, directory: string, live: LiveDesigns): boolean => {
  const own = live.get(slug)?.projectDirectory ?? null;
  return own !== null && sameDirectory(own, directory);
};

/** The folder as the list answers it: live members only, each slug once. */
export const folderView = (folder: FolderRecord, live: LiveDesigns): FolderView => ({
  id: folder.id,
  name: folder.name,
  created: folder.created,
  slugs: [...new Set(folder.designs.filter((entry) => isLiveMember(entry, live)).map((entry) => entry.slug))],
});

/** A project's manual members as the list answers them: live, not derived there, each slug once. Null when none is left. */
export const projectView = (project: ProjectMembersRecord, live: LiveDesigns): ProjectMembersView | null => {
  const slugs = [
    ...new Set(project.designs.filter((entry) => isLiveMember(entry, live) && !isDerivedMember(entry.slug, project.directory, live)).map((entry) => entry.slug)),
  ];
  return slugs.length === 0 ? null : { directory: project.directory, slugs };
};

/** The list answer: deleted folders hidden, members filtered against the live designs. */
export const listView = (read: RegistryRead, live: LiveDesigns): FolderListResponse => {
  if (read.kind === 'damaged') return { folders: [], projects: [], damaged: true };
  if (read.kind === 'absent') return { folders: [], projects: [] };
  return {
    folders: read.registry.folders.filter((folder) => folder.deleted === null).map((folder) => folderView(folder, live)),
    projects: read.registry.projects.map((project) => projectView(project, live)).filter((view): view is ProjectMembersView => view !== null),
  };
};

/** Live entries only, each slug once; `drop` names entries to leave out as well. */
const liveMembers = (
  designs: readonly { slug: string; created: IsoDate }[],
  live: LiveDesigns,
  drop: (slug: string) => boolean = () => false,
): { slug: string; created: IsoDate }[] => {
  const seen = new Set<string>();
  return designs.filter((entry) => {
    const keep = isLiveMember(entry, live) && !seen.has(entry.slug) && !drop(entry.slug);
    seen.add(entry.slug);
    return keep;
  });
};

/**
 * What every write does first (§2.8, P26 §2.1): drop folders deleted longer than the undo window
 * ago, design entries that no longer match a live design (by slug and created), manual project
 * members that are now that project's derived members, and project entries left with no member.
 * Pure; `changed` says whether anything was dropped.
 */
export const cleanRegistry = (registry: FoldersRegistry, live: LiveDesigns, now: number): { registry: FoldersRegistry; changed: boolean } => {
  let changed = false;
  const folders: FolderRecord[] = [];
  for (const folder of registry.folders) {
    if (folder.deleted !== null && now - Date.parse(folder.deleted) > FOLDER_UNDO_MS) {
      changed = true;
      continue;
    }
    const designs = liveMembers(folder.designs, live);
    if (designs.length !== folder.designs.length) changed = true;
    folders.push({ ...folder, designs });
  }
  const projects: ProjectMembersRecord[] = [];
  for (const project of registry.projects) {
    const designs = liveMembers(project.designs, live, (slug) => isDerivedMember(slug, project.directory, live));
    if (designs.length !== project.designs.length) changed = true;
    if (designs.length === 0) {
      changed = true;
      continue;
    }
    projects.push({ ...project, designs });
  }
  return { registry: { ...registry, folders, projects }, changed };
};

/** Set semantics: each added live slug ends present once with its current created; removed slugs end absent. Unknown slugs are skipped. */
export const applyMembership = (folder: FolderRecord, change: { add: readonly string[]; remove: readonly string[] }, live: LiveDesigns): FolderRecord => {
  const drop = new Set(change.remove);
  let designs = folder.designs.filter((entry) => !drop.has(entry.slug));
  designs = addMembers(designs, change.add, drop, live, () => false);
  if (designs.length > FOLDER_DESIGNS_MAX) throw new ApiError('conflict', FOLDER_DESIGNS_FULL);
  return { ...folder, designs };
};

/** Set-semantic adds: a live slug ends present once with its current created; `skip` leaves a slug out. */
const addMembers = (
  start: { slug: string; created: IsoDate }[],
  add: readonly string[],
  drop: ReadonlySet<string>,
  live: LiveDesigns,
  skip: (slug: string) => boolean,
): { slug: string; created: IsoDate }[] => {
  let designs = start;
  for (const slug of add) {
    const created = live.get(slug)?.created;
    if (created === undefined || drop.has(slug) || skip(slug)) continue;
    if (designs.some((entry) => entry.slug === slug && entry.created === created)) continue;
    designs = [...designs.filter((entry) => entry.slug !== slug), { slug, created }];
  }
  return designs;
};

/** One failed change, returned (never thrown) to `applyChanges`; an atomic batch turns it into an `ApiError`. */
type ChangeFailure = { code: 'gone' | 'full' | 'invalid'; message: string };

const failureStatus = { gone: 'not-found', full: 'conflict', invalid: 'bad-request' } as const;

const applyProjectChange = (
  registry: FoldersRegistry,
  directoryRaw: string,
  change: { add: readonly string[]; remove: readonly string[] },
  live: LiveDesigns,
  root: string,
): FoldersRegistry | ChangeFailure => {
  const directory = normalizeProjectDirectory(directoryRaw, root);
  if (directory === null) return { code: 'invalid', message: PROJECT_UNUSABLE };
  const index = registry.projects.findIndex((project) => sameDirectory(project.directory, directory));
  const existing = index === -1 ? undefined : registry.projects[index];
  const drop = new Set(change.remove);
  const kept = (existing?.designs ?? []).filter((entry) => !drop.has(entry.slug));
  // Membership never shadows the derived project: such an add is a quiet no-op.
  const designs = addMembers(kept, change.add, drop, live, (slug) => isDerivedMember(slug, directory, live));
  if (designs.length > FOLDER_DESIGNS_MAX) return { code: 'full', message: PROJECT_DESIGNS_FULL };
  if (existing === undefined) {
    if (designs.length === 0) return registry;
    if (registry.projects.length >= PROJECT_ENTRIES_MAX) return { code: 'full', message: PROJECTS_FULL };
    return { ...registry, projects: [...registry.projects, { directory, designs }] };
  }
  const projects = designs.length === 0 ? registry.projects.filter((_project, at) => at !== index) : registry.projects.map((project, at) => (at === index ? { ...project, designs } : project));
  return { ...registry, projects };
};

const applyFolderChange = (registry: FoldersRegistry, id: string, change: { add: readonly string[]; remove: readonly string[] }, live: LiveDesigns): FoldersRegistry | ChangeFailure => {
  if (!FOLDER_ID_PATTERN.test(id)) return { code: 'invalid', message: FOLDER_GONE };
  const folder = registry.folders.find((candidate) => candidate.id === id && candidate.deleted === null);
  if (folder === undefined) return { code: 'gone', message: FOLDER_GONE };
  let next: FolderRecord;
  try {
    next = applyMembership(folder, change, live);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'conflict') return { code: 'full', message: error.message };
    throw error;
  }
  return { ...registry, folders: registry.folders.map((candidate) => (candidate === folder ? next : candidate)) };
};

/**
 * A batch of membership changes, in order, over one registry (pure; AD-2). Best effort: each change
 * answers its own result, and a failed change leaves the registry as it was before that change.
 * `atomic`: the first failure throws its `ApiError` (`not-found` gone, `conflict` full,
 * `bad-request` invalid), so the caller writes nothing.
 */
export const applyChanges = (
  registry: FoldersRegistry,
  changes: readonly MembershipChangeInput[],
  live: LiveDesigns,
  options: { atomic: boolean; root: string },
): { registry: FoldersRegistry; results: MembershipResult[] } => {
  let current = registry;
  const results: MembershipResult[] = [];
  for (const { target, add, remove } of changes) {
    const outcome = target.kind === 'folder' ? applyFolderChange(current, target.id, { add, remove }, live) : applyProjectChange(current, target.directory, { add, remove }, live, options.root);
    if ('code' in outcome) {
      if (options.atomic) throw new ApiError(failureStatus[outcome.code], outcome.message);
      results.push({ target, ok: false, code: outcome.code, message: outcome.message });
      continue;
    }
    current = outcome;
    results.push({ target, ok: true });
  }
  return { registry: current, results };
};

/** Live members of this folder that are in no other live folder (the delete confirm's second number, AD-6). */
export const onlyHereCount = (registry: FoldersRegistry, folder: FolderRecord, live: LiveDesigns): number => {
  const elsewhere = new Set(registry.folders.filter((other) => other.id !== folder.id && other.deleted === null).flatMap((other) => folderView(other, live).slugs));
  return folderView(folder, live).slugs.filter((slug) => !elsewhere.has(slug)).length;
};

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** `f_` and ten characters of `[a-z0-9]` (`FOLDER_ID_PATTERN`). */
export const mintFolderId = (): string => `f_${[...randomBytes(10)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('')}`;

/** Same content: the membership helpers rebuild records, so identity says nothing; both come from the same cleaned base, so key order matches. */
const sameRegistry = (a: FoldersRegistry, b: FoldersRegistry): boolean => JSON.stringify(a) === JSON.stringify(b);

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

const MEMBERSHIPS_UNREADABLE = "Design Chamber couldn't read that folder change. Nothing was changed.";

/**
 * A target's shape (P26 §3.1). Only the shape is checked here: a folder id that does not match
 * the pattern or a project folder that can't be used answers that change's own result
 * (`invalid`), so a best-effort batch still applies the rest.
 */
export const parseMembershipTarget = (value: unknown): MembershipTarget => {
  if (!isRecord(value)) throw new ApiError('bad-request', MEMBERSHIPS_UNREADABLE);
  if (value.kind === 'folder' && typeof value.id === 'string' && value.id.length <= 64) return { kind: 'folder', id: value.id };
  if (value.kind === 'project' && typeof value.directory === 'string' && value.directory.length <= PROJECT_DIRECTORY_MAX) return { kind: 'project', directory: value.directory };
  throw new ApiError('bad-request', MEMBERSHIPS_UNREADABLE);
};

/** `POST /memberships` (P26 §3.1, §5.1): 1..64 changes, ≤ 200 slugs per list, ≤ 400 across the batch. */
export const parseMembershipsBody = (body: unknown): { changes: MembershipChangeInput[]; atomic: boolean } => {
  if (!isRecord(body)) throw new ApiError('bad-request', MEMBERSHIPS_UNREADABLE);
  const { changes, atomic } = body;
  if (atomic !== undefined && typeof atomic !== 'boolean') throw new ApiError('bad-request', MEMBERSHIPS_UNREADABLE);
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MEMBERSHIP_CHANGES_MAX) {
    throw new ApiError('bad-request', `Send between 1 and ${MEMBERSHIP_CHANGES_MAX} folder changes at once.`);
  }
  let total = 0;
  const parsed = changes.map((change): MembershipChangeInput => {
    if (!isRecord(change)) throw new ApiError('bad-request', MEMBERSHIPS_UNREADABLE);
    const target = parseMembershipTarget(change.target);
    const { add, remove } = parseFolderChange(change);
    total += add.length + remove.length;
    return { target, add, remove };
  });
  if (total > MEMBERSHIP_SLUGS_TOTAL_MAX) throw new ApiError('bad-request', `A folder change can include at most ${MEMBERSHIP_SLUGS_TOTAL_MAX} designs.`);
  return { changes: parsed, atomic: atomic === true };
};

// ---- The service ----

export type FoldersService = {
  list(): Promise<FolderListResponse>;
  create(name: unknown): Promise<FolderView>;
  rename(id: string, name: unknown): Promise<FolderView>;
  /**
   * Soft delete; answers how many designs were in it and how many of those are in no other live
   * folder, both counted in the same write. Deleting a deleted folder again answers the same.
   */
  remove(id: string): Promise<{ designs: number; onlyHere: number }>;
  undelete(id: string): Promise<FolderView>;
  change(id: string, change: { add: readonly string[]; remove: readonly string[] }): Promise<FolderView>;
  /**
   * A batch of folder and project membership changes in one queued write (P26 AD-2). `atomic`: all
   * or nothing (the first failure throws its sentence). Best effort: per-change results. A batch
   * where every change failed, or that changes nothing, writes nothing (no rev bump, no event).
   */
  changeMany(changes: readonly MembershipChangeInput[], options: { atomic: boolean }): Promise<MembershipsResponse>;
  /**
   * The agent's `folderRequest` (P26 AD-16): tag or untag one design in EXISTING live folders,
   * matched by name ignoring case. Never creates, renames or deletes a folder; never touches
   * projects. Answers the `add` names no folder has. A damaged registry is never set aside here:
   * it throws `FoldersDamagedError`. Nothing to change writes nothing.
   */
  changeByName(slug: string, request: { add: readonly string[]; remove: readonly string[] }): Promise<{ unknown: string[] }>;
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

  const liveDesigns = async (): Promise<Map<string, LiveDesign>> => {
    const designs = await store.list();
    return new Map(designs.map((design) => [design.slug, { created: design.created, projectDirectory: design.projectDirectory }]));
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
    const registry = parseFoldersRegistry(await readFile(file, 'utf8'), root);
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
    const text = `${JSON.stringify(registry, null, 2)}\n`;
    // A file past the read cap would read back as damaged: refuse the write instead (§13).
    if (Buffer.byteLength(text, 'utf8') > FOLDERS_FILE_MAX_BYTES) throw new ApiError('conflict', FOLDERS_FILE_FULL);
    await chamberDir(root);
    const file = await resolvePlainTarget(root, FOLDERS_FILE_SEGMENTS, { allowAbsent: true });
    await writeFileAtomic(file, text, { createDirs: false });
    hub.emit({ slug: null, kind: 'folders' });
  };

  /** The user acted on a damaged registry: move it aside (never deleted) and start fresh. */
  const setAside = async (root: string): Promise<void> => {
    const dir = await chamberDir(root);
    const aside = path.join(dir, `folders.damaged-${stampOf(now())}.json`);
    await rename(path.join(dir, 'folders.json'), aside);
    log.warn('folders.damaged-set-aside', { file: path.basename(aside) });
  };

  /**
   * Read (a user action sets a damaged file aside; `onDamaged: 'refuse'` throws
   * `FoldersDamagedError` and leaves it), clean, apply, write with rev + 1. `apply` may answer
   * `write: false` to leave the file exactly as it is (no rev bump, no event).
   */
  const mutate = <T>(
    apply: (registry: FoldersRegistry, live: LiveDesigns, at: Date, root: string) => { registry: FoldersRegistry; result: T; write?: boolean },
    options: { onDamaged: 'set-aside' | 'refuse' } = { onDamaged: 'set-aside' },
  ): Promise<T> => {
    const root = settings.root();
    return queued(root, async () => {
      const read = await readRegistry(root);
      if (read.kind === 'damaged') {
        if (options.onDamaged === 'refuse') throw new FoldersDamagedError();
        await setAside(root);
      }
      const base: FoldersRegistry = read.kind === 'ok' ? read.registry : { v: 1, rev: 0, folders: [], projects: [] };
      const live = await liveDesigns();
      const at = now();
      const cleaned = cleanRegistry(base, live, at.getTime()).registry;
      const { registry, result, write } = apply(cleaned, live, at, root);
      if (write === false) return result;
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
        // Counted on the queue, in the write that deletes, so the notice reports what happened (AD-6).
        const result = { designs: folderView(existing, live).slugs.length, onlyHere: onlyHereCount(registry, existing, live) };
        if (existing.deleted !== null) return { registry, result };
        return { registry: replace(registry, { ...existing, deleted: at.toISOString() }), result };
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

    changeMany(changes, options) {
      return mutate((registry, live, _at, root) => {
        const applied = applyChanges(registry, changes, live, { atomic: options.atomic, root });
        const failed = applied.results.filter((result) => !result.ok).length;
        log.info('folders.memberships', { changes: changes.length, failed, atomic: options.atomic });
        // Every change failed, or none changed anything (re-adding a member, removing a non-member):
        // the registry is unchanged, so nothing is written (no rev bump, no event).
        const write = failed < applied.results.length && !sameRegistry(applied.registry, registry);
        return { registry: applied.registry, write, result: { results: applied.results, list: listView({ kind: 'ok', registry: applied.registry }, live) } };
      });
    },

    changeByName(slug, request) {
      return mutate(
        (registry, live, _at, root) => {
          const byName = (name: string): FolderRecord | undefined => {
            let wanted: string;
            try {
              wanted = normalizeFolderName(name);
            } catch {
              return undefined;
            }
            return registry.folders.find((folder) => folder.deleted === null && sameName(folder.name, wanted));
          };
          const unknown: string[] = [];
          const changes: MembershipChangeInput[] = [];
          for (const name of request.add) {
            const folder = byName(name);
            if (folder === undefined) unknown.push(name);
            else changes.push({ target: { kind: 'folder', id: folder.id }, add: [slug], remove: [] });
          }
          // An unknown name to remove is already true (the design is in no such folder): nothing to report.
          for (const name of request.remove) {
            const folder = byName(name);
            if (folder !== undefined) changes.push({ target: { kind: 'folder', id: folder.id }, add: [], remove: [slug] });
          }
          if (changes.length === 0) return { registry, write: false, result: { unknown } };
          // Best effort: a full folder is skipped (counted in the log), the others still land.
          const applied = applyChanges(registry, changes, live, { atomic: false, root });
          const failed = applied.results.filter((result) => !result.ok).length;
          if (failed > 0) log.warn('folders.request-partly-applied', { changes: changes.length, failed });
          return { registry: applied.registry, write: failed < changes.length && !sameRegistry(applied.registry, registry), result: { unknown } };
        },
        { onDamaged: 'refuse' },
      );
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
