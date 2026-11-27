// Board comments of a design system (documentation/specs/system-builder-depth.md §13 T20, decision 10):
// `_systems/<id>/.chamber/comments.json`, service-owned, under the designs root for every home. A
// repo-backed system's comments stay here too: nothing in this module ever names the repo.
//
// Safety rules this module holds:
// - The system folder comes from the system store (`SYSTEM_ID_PATTERN` → `resolveInside` → no link
//   on the way); `.chamber` and the file are resolved again under it, so a `.chamber` that is a link
//   refuses every write, and a `comments.json` that is a link or not a regular file reads as damaged.
//   Every target also passes `guardSystemWrite` (AD-18: never a write outside the designs root).
// - `.chamber` is made with a non-recursive mkdir inside a folder that exists: a system removed
//   meanwhile is never re-created.
// - The file is untrusted (anything that can write the folder can write it): size-capped before it
//   is read, every comment validated. Anything that does not validate makes the file `damaged`: it is
//   shown as such, never silently replaced. The next user write renames it aside to
//   `comments.damaged-<stamp>-<rand>.json` (never deleted), then writes the comments that did
//   validate plus the change.
// - Every read-modify-write runs on one queue per system folder, and the write is temp-then-rename,
//   so two windows writing at once both land and a crash never leaves half a file.
// - Comment bodies are the user's words: they never reach a log line.

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

import { COMMENT_BODY_MAX, COMMENT_ID_PATTERN, SYSTEM_COMMENTS_FILE_MAX_BYTES, SYSTEM_COMMENTS_MAX } from '../../shared/limits.ts';
import { isBoardEntryKey } from '../../shared/system-board.ts';
import type { CommentStatus, IsoDate, SystemComment } from '../../shared/types.ts';
import type { ChangeHub, Logger, ServiceContext, SettingsStore } from '../context.ts';
import { ApiError } from '../http.ts';
import { LINK_SENTENCE, resolveInside, resolvePlainTarget, samePath, writeFileAtomic } from '../paths.ts';
import { ensureSystemStore, guardSystemWrite, SYSTEM_GONE_MESSAGE, type SystemStore } from './store.ts';

export const SYSTEM_COMMENTS_SEGMENTS = ['.chamber', 'comments.json'] as const;

export const SYSTEM_COMMENTS_FULL = `This design system already has ${SYSTEM_COMMENTS_MAX} comments. Resolve or delete some before adding more.`;
export const SYSTEM_COMMENTS_FILE_FULL = 'The comments are too long to save. Shorten or delete some and try again.';
export const SYSTEM_COMMENT_GONE = "That comment isn't there any more.";

const COMMENT_STATUSES: readonly CommentStatus[] = ['open', 'sent', 'resolved'];

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIso = (value: unknown): value is IsoDate => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

/** A comment body the user may save: 1 to `COMMENT_BODY_MAX` characters, not only spaces. */
export const isCommentBody = (value: unknown): value is string => typeof value === 'string' && value.trim().length >= 1 && value.length <= COMMENT_BODY_MAX;

/** One stored comment, validated, or null. Unknown keys are dropped. */
export const parseSystemComment = (value: unknown): SystemComment | null => {
  if (!isObj(value)) return null;
  const { id, entry, body, status, created, sentAt } = value;
  if (typeof id !== 'string' || !COMMENT_ID_PATTERN.test(id)) return null;
  if (typeof entry !== 'string' || !isBoardEntryKey(entry)) return null;
  if (!isCommentBody(body)) return null;
  if (typeof status !== 'string' || !COMMENT_STATUSES.includes(status as CommentStatus)) return null;
  if (!isIso(created) || !(sentAt === null || isIso(sentAt))) return null;
  return { id, entry, body, status: status as CommentStatus, created, sentAt };
};

export type SystemCommentsRead =
  | { kind: 'absent' }
  | { kind: 'ok'; comments: SystemComment[] }
  /** `comments`: what validated (empty when the file isn't JSON); the file itself is kept until a user write sets it aside. */
  | { kind: 'damaged'; comments: SystemComment[] };

/** The file's text, parsed (pure). Anything off the shape, a bad comment, a repeated id or more than the cap is `damaged`. */
export const parseSystemCommentsText = (text: string): SystemCommentsRead => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { kind: 'damaged', comments: [] };
  }
  if (!isObj(value) || value.v !== 1 || !Array.isArray(value.comments)) return { kind: 'damaged', comments: [] };
  const comments: SystemComment[] = [];
  const seen = new Set<string>();
  let damaged = value.comments.length > SYSTEM_COMMENTS_MAX;
  for (const raw of value.comments.slice(0, SYSTEM_COMMENTS_MAX)) {
    const comment = parseSystemComment(raw);
    if (comment === null || seen.has(comment.id)) {
      damaged = true;
      continue;
    }
    seen.add(comment.id);
    comments.push(comment);
  }
  return damaged ? { kind: 'damaged', comments } : { kind: 'ok', comments };
};

/** The file's text for a list of comments (pure). */
export const serializeSystemComments = (comments: readonly SystemComment[]): string => `${JSON.stringify({ v: 1, comments }, null, 2)}\n`;

/** A fresh comment id, unique in the list (`COMMENT_ID_PATTERN`). */
export const mintSystemCommentId = (taken: ReadonlySet<string>, random: () => string = () => randomBytes(6).toString('hex')): string => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = `c_${random()}`;
    if (COMMENT_ID_PATTERN.test(id) && !taken.has(id)) return id;
  }
  // Unreachable in practice: 10 collisions in a 2^48 id space means a broken RNG.
  throw new ApiError('conflict', "The comment couldn't be saved. Try again.");
};

// ---- the pure changes (the routes' validated input in, the next list out) ----

export const withCommentAdded = (comments: readonly SystemComment[], input: { entry: string; body: string }, at: IsoDate, mint: (taken: ReadonlySet<string>) => string = mintSystemCommentId): { comments: SystemComment[]; comment: SystemComment } => {
  if (comments.length >= SYSTEM_COMMENTS_MAX) throw new ApiError('conflict', SYSTEM_COMMENTS_FULL);
  const comment: SystemComment = { id: mint(new Set(comments.map((entry) => entry.id))), entry: input.entry, body: input.body, status: 'open', created: at, sentAt: null };
  return { comments: [...comments, comment], comment };
};

export const withCommentPatched = (comments: readonly SystemComment[], id: string, patch: { body?: string; status?: CommentStatus }): { comments: SystemComment[]; comment: SystemComment } => {
  const current = comments.find((comment) => comment.id === id);
  if (current === undefined) throw new ApiError('not-found', SYSTEM_COMMENT_GONE);
  const comment: SystemComment = { ...current, ...(patch.body !== undefined ? { body: patch.body } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) };
  return { comments: comments.map((entry) => (entry.id === id ? comment : entry)), comment };
};

export const withCommentRemoved = (comments: readonly SystemComment[], id: string): SystemComment[] => {
  const next = comments.filter((comment) => comment.id !== id);
  if (next.length === comments.length) throw new ApiError('not-found', SYSTEM_COMMENT_GONE);
  return next;
};

/**
 * Open comments named in `ids` become sent at `at`. A comment already sent keeps its first `sentAt`
 * (a retried mark never marks twice); a resolved one stays resolved; unknown ids are skipped.
 * `named`: every named comment that exists, as it is after the mark.
 */
export const withCommentsMarkedSent = (comments: readonly SystemComment[], ids: readonly string[], at: IsoDate): { comments: SystemComment[]; named: SystemComment[]; changed: boolean } => {
  const wanted = new Set(ids);
  let changed = false;
  const next = comments.map((comment) => {
    if (!wanted.has(comment.id) || comment.status !== 'open') return comment;
    changed = true;
    return { ...comment, status: 'sent' as const, sentAt: at };
  });
  return { comments: next, named: next.filter((comment) => wanted.has(comment.id)), changed };
};

// ---- the store ----

export type SystemCommentsStore = {
  /** The validated comments; `damaged` when the file couldn't be read whole (it is left as it is). */
  list(id: string): Promise<{ comments: SystemComment[]; damaged: boolean }>;
  /**
   * One read-modify-write on the system's queue. `apply` sees the comments as they are inside the
   * queue (what validated, when damaged) and answers the next list, or `write: false` to leave the
   * file exactly as it is. A damaged file is set aside before the write, never overwritten.
   */
  mutate<T>(id: string, apply: (comments: SystemComment[]) => { comments: SystemComment[]; result: T; write?: boolean }): Promise<T>;
};

export type SystemCommentsDeps = {
  systems: Pick<SystemStore, 'dir'>;
  settings: Pick<SettingsStore, 'root'>;
  log: Logger;
  /** Every write that lands sends `{ kind: 'system', system, systemChange: 'comments', origin: 'user' }`. */
  hub: Pick<ChangeHub, 'emit'>;
  /** Test seam. */
  now?: () => Date;
};

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;
const stampOf = (date: Date): string => date.toISOString().replace(/[-:T]/g, '').slice(0, 14);

export const createSystemCommentsStore = (deps: SystemCommentsDeps): SystemCommentsStore => {
  const { systems, settings, log, hub } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const queues = new Map<string, Promise<unknown>>();

  /** One read-modify-write at a time per system folder (the folder, so a root change is a new queue). */
  const queued = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
  };

  const read = async (id: string, dir: string): Promise<SystemCommentsRead> => {
    let file: string;
    try {
      file = await resolvePlainTarget(dir, SYSTEM_COMMENTS_SEGMENTS, { allowAbsent: true });
    } catch (error) {
      // A link (`.chamber` or the file) or a folder at the file's place: unusable, never followed.
      if (error instanceof ApiError) {
        log.warn('systems.comments-damaged', { system: id, code: 'link' });
        return { kind: 'damaged', comments: [] };
      }
      if (codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR') return { kind: 'absent' };
      throw error;
    }
    let size: number;
    try {
      size = (await lstat(file)).size;
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return { kind: 'absent' };
      throw error;
    }
    if (size > SYSTEM_COMMENTS_FILE_MAX_BYTES) {
      log.warn('systems.comments-damaged', { system: id, code: 'too-large' });
      return { kind: 'damaged', comments: [] };
    }
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return { kind: 'absent' };
      throw error;
    }
    const parsed = parseSystemCommentsText(text);
    if (parsed.kind === 'damaged') log.warn('systems.comments-damaged', { system: id, code: 'invalid', kept: parsed.comments.length });
    return parsed;
  };

  /** `<system>/.chamber`, made when missing (not recursive) and refused when it is a link. */
  const chamberDir = async (dir: string): Promise<string> => {
    const lexical = path.join(dir, '.chamber');
    try {
      await mkdir(lexical);
    } catch (error) {
      if (codeOf(error) === 'ENOENT') throw new ApiError('not-found', SYSTEM_GONE_MESSAGE);
      if (codeOf(error) !== 'EEXIST') throw error;
    }
    const real = await resolveInside(dir, ['.chamber']);
    if (!samePath(real, lexical)) throw new ApiError('invalid', LINK_SENTENCE);
    return lexical;
  };

  /** The user wrote over a damaged file: move it aside in `.chamber` (never deleted). A link is moved, not followed. */
  const setAside = async (id: string, dir: string): Promise<void> => {
    const chamber = await chamberDir(dir);
    const name = `comments.damaged-${stampOf(now())}-${randomBytes(3).toString('hex')}.json`;
    const aside = await resolveInside(dir, ['.chamber', name]);
    await guardSystemWrite(settings.root(), aside, id, log);
    try {
      await rename(path.join(chamber, 'comments.json'), aside);
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') throw error;
    }
    log.warn('systems.comments-set-aside', { system: id, file: name });
  };

  const write = async (id: string, dir: string, text: string): Promise<void> => {
    await chamberDir(dir);
    // Resolved after the mkdir and the set-aside, so a link put there meanwhile is refused, never written through.
    const target = await resolvePlainTarget(dir, SYSTEM_COMMENTS_SEGMENTS, { allowAbsent: true });
    await guardSystemWrite(settings.root(), target, id, log);
    await writeFileAtomic(target, text, { createDirs: false });
  };

  return {
    async list(id) {
      const dir = await systems.dir(id);
      const got = await read(id, dir);
      return got.kind === 'absent' ? { comments: [], damaged: false } : { comments: got.comments, damaged: got.kind === 'damaged' };
    },

    async mutate(id, apply) {
      const dir = await systems.dir(id);
      return queued(dir, async () => {
        const got = await read(id, dir);
        const { comments, result, write: shouldWrite } = apply(got.kind === 'absent' ? [] : got.comments);
        if (shouldWrite === false) return result;
        const text = serializeSystemComments(comments);
        // A file past the read cap would read back as damaged: refuse before anything moves.
        if (Buffer.byteLength(text, 'utf8') > SYSTEM_COMMENTS_FILE_MAX_BYTES) throw new ApiError('conflict', SYSTEM_COMMENTS_FILE_FULL);
        if (got.kind === 'damaged') await setAside(id, dir);
        await write(id, dir, text);
        // After the rename only: a refused or failed write, or `write: false`, sends nothing.
        hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'comments', origin: 'user' });
        return result;
      });
    },
  };
};

// ---- wiring (the routes share one instance, so one queue, per context) ----

const instances = new WeakMap<ServiceContext, SystemCommentsStore>();

export const ensureSystemComments = (ctx: ServiceContext): SystemCommentsStore => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createSystemCommentsStore({ systems: ensureSystemStore(ctx), settings: ctx.settings, log: ctx.log, hub: ctx.hub });
  instances.set(ctx, created);
  return created;
};
