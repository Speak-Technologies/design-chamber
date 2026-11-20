// Build tickets and Stop (documentation/specs/phase-2-5-technical.md §2.12, §5.9, AD-15, AD-16, AD-29).
//
// A ticket is issued for a user gesture (`/design-system`, Build with the agent…) and records the chat's
// project folder and session, so the repo a built system may live in is tied to the folder the user's own
// command ran in (adoption, T12b, checks it). Files: `<root>/.chamber/system-builds/<ticket>.json`
// (schema `design-chamber/system-build-ticket@1`) and `<ticket>.md` (the builder rules for that chat).
//
// Containment: the folder is reached through `resolveInside(root, ['.chamber', 'system-builds'])` after
// non-recursive mkdirs (a missing root is made once, as a system create does); each file through
// `resolvePlainTarget`, which refuses a link. Only file names this module mints (`sb_<12>.json|md`) are
// ever read or removed, and only when they are plain files, so nothing the service did not write is
// touched. Every ticket operation runs on one queue.
//
// Expiry and the cap: at most SYSTEM_BUILDS_MAX open tickets (a 21st drops the oldest), each for
// SYSTEM_BUILD_TTL_MS. Expired, unreadable and over-the-cap tickets are removed on the next issue and at
// service start. A root change forgets the in-memory maps; the old root's ticket files stay there and
// expire there.
//
// Stop (rev 3): a Draft built in chat that never had an `applied` stamp acted on goes to `.trash`
// exactly as DELETE /systems/:id (settings cleared the same way, under the system's lock), and an undo
// id is kept in memory for SYSTEM_STOP_UNDO_MS. A restart forgets it; the folder stays in the trash.

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

import { chipMarkerOf } from '../../shared/agent/chip.ts';
import type { StopBuildResponse, SystemBuildTicketResponse } from '../../shared/api.ts';
import {
  SESSION_ID_MAX,
  SYSTEM_BUILD_TICKET_PATTERN,
  SYSTEM_BUILD_TTL_MS,
  SYSTEM_BUILDS_MAX,
  SYSTEM_ID_PATTERN,
  SYSTEM_STOP_UNDO_MS,
  SYSTEMS_MAX,
} from '../../shared/limits.ts';
import { isReservedSystemId, SYSTEMS_DIR } from '../../shared/system-json.ts';
import type { SystemState } from '../../shared/types.ts';
import type { ChangeHub, Logger, ServiceContext, SettingsStore } from '../context.ts';
import { ApiError } from '../http.ts';
import { renameWithRetry, resolveInside, resolvePlainTarget, samePath, writeFileAtomic } from '../paths.ts';
import { folderErrorSentence } from '../root.ts';
import { ensureProposals } from './proposals.ts';
import { ensureSystemStore, SYSTEMS_CAP_MESSAGE, type SystemStore } from './store.ts';

export type BuildTicket = { v: 1; ticket: string; created: string; projectDirectory: string | null; sessionId: string | null };

export const BUILDS_SEGMENTS = ['.chamber', 'system-builds'] as const;
/** A ticket file is a few hundred bytes; anything larger is not ours. */
const TICKET_FILE_MAX_BYTES = 16_384;
const PATH_MAX = 4096;
const TICKET_FILE_PATTERN = /^(sb_[a-z0-9]{12})\.(json|md)$/;

export const STOP_UNDO_GONE_MESSAGE = "That build can't be brought back any more.";
export const NOT_A_TICKET_MESSAGE = 'That is not a design system build ticket.';
export const NOT_AN_UNDO_MESSAGE = 'That is not a stopped build.';
const notBuiltInChat = (name: string): string => `${name} wasn't started from a chat build, so it can't be stopped here. Delete it from the system page instead.`;
const alreadyApplied = (name: string, where: string): string =>
  `${name} already has files in ${where}, so it can't be removed here. Delete it from the system page; ${where} isn't changed.`;
const nameBack = (name: string): string => `A design system called ${name} exists again, so this one can't come back.`;

/** `issue`'s answer: the ticket and its rules file (`<ticket>.md`, absolute). */
export type IssuedTicket = { ticket: BuildTicket; rulesFile: string };

export type BuildTickets = {
  /**
   * Issue a ticket and write `<ticket>.md` (the text `rulesFor` builds for it) and `<ticket>.json`.
   * Sweeps first, so a 21st open ticket drops the oldest. The 50-system cap is the caller's (checked earlier).
   */
  issue(input: { projectDirectory: string | null; sessionId: string | null; rulesFor: (ticket: BuildTicket) => string }): Promise<IssuedTicket>;
  /** GET /system-builds/:ticket: waiting (with the project's label), made (id and name) or expired. */
  get(ticket: string): Promise<SystemBuildTicketResponse>;
  /** The open (valid, unexpired, unconsumed) ticket, or null; adoption (T12b) reads it. */
  open(ticket: string): Promise<BuildTicket | null>;
  /**
   * Record the chat a build chip is on, only while the ticket has none and only for the ticket the chip
   * was made for (`marker` = the chip URL's marker, which is the ticket's created time).
   */
  linkSession(ticket: string, sessionId: string, marker: string): Promise<'linked' | 'unchanged'>;
  /** Adoption: remove both files and remember the system for GET. */
  consume(ticket: string, systemId: string): Promise<void>;
  /** Remove expired, unreadable and over-the-cap tickets (and orphaned rules files). */
  sweep(): Promise<void>;
  stop(id: string, input: { proposalId: string | null }): Promise<StopBuildResponse>;
  undoStop(undoId: string): Promise<{ id: string }>;
  dispose(): void;
};

export type BuildTicketsDeps = {
  settings: Pick<SettingsStore, 'root'>;
  hub: Pick<ChangeHub, 'emit' | 'subscribe'>;
  log: Logger;
  systems: Pick<SystemStore, 'list' | 'index' | 'readState' | 'trash' | 'withLock'>;
  /** T17: Stop declines the proposal it was clicked on (§5.14), inside the system's lock. */
  proposals?: () => { declineLocked(id: string, proposalId: string | null): Promise<void> };
  /** Test seams. */
  now?: () => Date;
  undoMs?: number;
};

const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** 12 characters of [a-z0-9] from crypto randomness (rejection sampling keeps them uniform). */
const randomSuffix = (length = 12): string => {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 252) continue; // 252 = 7 × 36: the bytes above would favour the first letters
      out += RANDOM_ALPHABET[byte % 36];
      if (out.length === length) break;
    }
  }
  return out;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasControl = (text: string): boolean => /[\u0000-\u001f\u007f]/.test(text);

/** A ticket file read back: the schema, the name it is stored under, the rules of §2.12. Anything else is null. */
export const parseTicket = (raw: unknown, expected: string): BuildTicket | null => {
  if (!isRecord(raw) || raw.v !== 1 || raw.ticket !== expected || !SYSTEM_BUILD_TICKET_PATTERN.test(expected)) return null;
  const { created, projectDirectory, sessionId } = raw;
  if (typeof created !== 'string' || !Number.isFinite(Date.parse(created))) return null;
  if (projectDirectory !== null && (typeof projectDirectory !== 'string' || projectDirectory.length > PATH_MAX || hasControl(projectDirectory) || !path.isAbsolute(projectDirectory))) {
    return null;
  }
  if (sessionId !== null && (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > SESSION_ID_MAX || hasControl(sessionId))) return null;
  return { v: 1, ticket: expected, created, projectDirectory, sessionId };
};

const isPlainFile = async (file: string): Promise<boolean> => {
  try {
    const info = await lstat(file);
    return info.isFile();
  } catch {
    return false;
  }
};

const isRealDirectory = async (dir: string): Promise<boolean> => {
  try {
    const info = await lstat(dir);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
};

const readSmall = async (file: string): Promise<string | null> => {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(TICKET_FILE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead > TICKET_FILE_MAX_BYTES ? null : buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type Undo = { id: string; name: string; trashedTo: string; root: string; until: number };

export const createBuildTickets = (deps: BuildTicketsDeps): BuildTickets => {
  const { settings, hub, log, systems } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const undoMs = deps.undoMs ?? SYSTEM_STOP_UNDO_MS;
  /** Tickets consumed this run → the system adopted from them. */
  const made = new Map<string, string>();
  const undos = new Map<string, Undo>();
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;

  /** Every ticket operation, one at a time. */
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  const unsubscribe = hub.subscribe((event) => {
    if (event.kind !== 'root') return;
    // The old root's ticket files are its own: they stay there and expire there.
    made.clear();
    undos.clear();
    void run(() => sweepNow(SYSTEM_BUILDS_MAX)).catch((error: unknown) => log.warn('system-builds.sweep-failed', { error: errorText(error) }));
  });

  /** The builds folder when it exists as a real folder inside the root, else null (nothing to read). */
  const existingDir = async (): Promise<string | null> => {
    const root = settings.root();
    try {
      const dir = await resolveInside(root, BUILDS_SEGMENTS);
      // A link anywhere on the way (`.chamber` or `system-builds`) makes the realpath differ from the lexical path.
      return samePath(dir, path.resolve(await resolveInside(root, []), ...BUILDS_SEGMENTS)) && (await isRealDirectory(dir)) ? dir : null;
    } catch (error) {
      if (error instanceof ApiError) return null; // no root yet, or a link leading out: no tickets here
      throw error;
    }
  };

  /** `<root>/.chamber/system-builds`, made non-recursively below an existing root; links are refused. */
  const ensureDir = async (): Promise<void> => {
    const root = settings.root();
    try {
      await mkdir(root, { recursive: true });
    } catch (error) {
      throw new ApiError('bad-path', folderErrorSentence(error, root));
    }
    const realRoot = await resolveInside(root, []);
    for (let depth = 1; depth <= BUILDS_SEGMENTS.length; depth += 1) {
      const segments = BUILDS_SEGMENTS.slice(0, depth);
      // The lexical path under the real root: a link on the way makes the contained realpath differ from it.
      const lexical = path.resolve(realRoot, ...segments);
      await resolveInside(root, segments);
      try {
        await mkdir(lexical);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ApiError('bad-path', folderErrorSentence(error, lexical));
      }
      // Contained again after the mkdir: a link put there meanwhile is refused.
      if (!samePath(await resolveInside(root, segments), lexical) || !(await isRealDirectory(lexical))) {
        throw new ApiError('conflict', `${lexical} isn't a folder, so Design Chamber can't keep design system builds there. Move it away and try again.`);
      }
    }
  };

  /**
   * A ticket file under the root's realpath (a root that is itself a link, like macOS `/var`, would
   * otherwise read as a link); `resolvePlainTarget` refuses any link below it.
   */
  const fileOf = async (ticket: string, ext: 'json' | 'md', allowAbsent: boolean): Promise<string> => {
    const root = settings.root();
    const realRoot = await realpath(root).catch(() => root);
    return resolvePlainTarget(realRoot, [...BUILDS_SEGMENTS, `${ticket}.${ext}`], { allowAbsent });
  };

  const isExpired = (ticket: BuildTicket): boolean => Date.parse(ticket.created) + SYSTEM_BUILD_TTL_MS <= now().getTime();

  /** The ticket file as stored, or null (absent, a link, too large, damaged). */
  const readTicket = async (ticket: string): Promise<BuildTicket | null> => {
    if ((await existingDir()) === null) return null;
    let file: string;
    try {
      file = await fileOf(ticket, 'json', false);
    } catch {
      return null; // absent, a link or not a plain file
    }
    const text = await readSmall(file).catch(() => null);
    if (text === null) return null;
    try {
      return parseTicket(JSON.parse(text), ticket);
    } catch {
      return null;
    }
  };

  const writeTicket = async (ticket: BuildTicket): Promise<void> => {
    await writeFileAtomic(await fileOf(ticket.ticket, 'json', true), `${JSON.stringify(ticket, null, 2)}\n`, { createDirs: false });
  };

  /** Remove our own plain files of one ticket; a missing one is fine, a link is left alone. */
  const removeTicketFiles = async (ticket: string): Promise<void> => {
    for (const ext of ['json', 'md'] as const) {
      let file: string;
      try {
        file = await fileOf(ticket, ext, true);
      } catch {
        continue; // a link or a folder under our name: not ours to remove
      }
      if (!(await isPlainFile(file))) continue;
      await unlink(file).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  };

  /** Keep at most `keep` open tickets: expired, unreadable and the oldest beyond `keep` are removed. */
  const sweepNow = async (keep: number): Promise<void> => {
    const dir = await existingDir();
    if (dir === null) return;
    const entries = await readdir(dir, { withFileTypes: true });
    const names = new Map<string, Set<string>>();
    for (const entry of entries) {
      const match = TICKET_FILE_PATTERN.exec(entry.name);
      if (match === null || !entry.isFile()) continue;
      const [, ticket = '', ext = ''] = match;
      names.set(ticket, (names.get(ticket) ?? new Set<string>()).add(ext));
    }
    const live: BuildTicket[] = [];
    for (const [ticket, exts] of names) {
      const parsed = exts.has('json') ? await readTicket(ticket) : null;
      if (parsed === null || isExpired(parsed)) {
        await removeTicketFiles(ticket);
        continue;
      }
      live.push(parsed);
    }
    live.sort((a, b) => Date.parse(a.created) - Date.parse(b.created) || a.ticket.localeCompare(b.ticket));
    const over = live.length - Math.max(0, keep);
    for (const ticket of live.slice(0, Math.max(0, over))) await removeTicketFiles(ticket.ticket);
    if (names.size - live.length + Math.max(0, over) > 0) log.info('system-builds.swept', { removed: names.size - live.length + Math.max(0, over) });
  };

  const assertTicket = (ticket: string): void => {
    if (typeof ticket !== 'string' || !SYSTEM_BUILD_TICKET_PATTERN.test(ticket)) throw new ApiError('bad-request', NOT_A_TICKET_MESSAGE);
  };

  const openNow = async (ticket: string): Promise<BuildTicket | null> => {
    if (made.has(ticket)) return null;
    const parsed = await readTicket(ticket);
    return parsed === null || isExpired(parsed) ? null : parsed;
  };

  const nameOf = async (id: string): Promise<string> => {
    const row = systems.index().find((one) => one.id === id);
    if (row !== undefined) return row.name;
    return (await systems.readState(id).catch(() => null))?.name ?? id;
  };

  /** A ticket consumed before a restart: the system whose state recorded it (≤ SYSTEMS_MAX reads). */
  const adoptedFrom = async (ticket: string): Promise<{ id: string; name: string } | null> => {
    for (const row of systems.index()) {
      const state = await systems.readState(row.id).catch(() => null);
      if (state?.build?.ticket === ticket) return { id: row.id, name: state.name };
    }
    return null;
  };

  /** Where a system's files already are, for the refused Stop: the repo's or the project's folder name. */
  const whereOf = (state: SystemState): string => {
    const directory = state.home?.kind === 'repo' ? state.home.directory : (state.build?.projectDirectory ?? null);
    return directory === null ? 'your project' : path.basename(directory) || directory;
  };

  const pruneUndos = (): void => {
    const at = now().getTime();
    for (const [undoId, undo] of undos) if (undo.until <= at) undos.delete(undoId);
  };

  return {
    issue: ({ projectDirectory, sessionId, rulesFor }) =>
      run(async () => {
        if (disposed) throw new ApiError('internal', 'Design Chamber is shutting down. Try again in a moment.');
        await ensureDir();
        // Room for this one: a 21st open ticket drops the oldest.
        await sweepNow(SYSTEM_BUILDS_MAX - 1);
        let id = `sb_${randomSuffix()}`;
        while ((await fileOf(id, 'json', true).then(isPlainFile)) || made.has(id)) id = `sb_${randomSuffix()}`;
        const ticket: BuildTicket = { v: 1, ticket: id, created: now().toISOString(), projectDirectory, sessionId };
        const text = rulesFor(ticket);
        const rulesFile = await fileOf(id, 'md', true);
        // The rules file first: a ticket without its rules would send the agent to a missing file. A rules
        // file left alone by a failed ticket write is swept as an orphan.
        await writeFileAtomic(rulesFile, text, { createDirs: false });
        await writeTicket(ticket);
        log.info('system-builds.issued', { ticket: id, project: projectDirectory !== null, session: sessionId !== null });
        return { ticket, rulesFile };
      }),

    get: async (ticket) => {
      assertTicket(ticket);
      const id = made.get(ticket);
      if (id !== undefined) return { state: 'made', id, name: await nameOf(id) };
      const open = await run(() => openNow(ticket));
      if (open !== null) {
        // The project's label only, never the path (§3.5 rev 3); the host's project name is not known to the service.
        const label = open.projectDirectory === null ? null : path.basename(open.projectDirectory) || open.projectDirectory;
        return { state: 'waiting', project: label === null ? null : { label } };
      }
      const adopted = await adoptedFrom(ticket);
      if (adopted !== null) {
        made.set(ticket, adopted.id);
        return { state: 'made', id: adopted.id, name: adopted.name };
      }
      return { state: 'expired' };
    },

    open: (ticket) => {
      assertTicket(ticket);
      return run(() => openNow(ticket));
    },

    linkSession: (ticket, sessionId, marker) =>
      run(async () => {
        if (!SYSTEM_BUILD_TICKET_PATTERN.test(ticket)) return 'unchanged';
        const open = await openNow(ticket);
        // Only the ticket the chip was made for, and only while it has no chat: never moved to another one.
        if (open === null || open.sessionId !== null || chipMarkerOf(open.created) !== marker) return 'unchanged';
        await writeTicket({ ...open, sessionId });
        log.info('system-builds.session-linked', { ticket, sessionPrefix: sessionId.slice(0, 8) });
        return 'linked';
      }),

    consume: (ticket, systemId) =>
      run(async () => {
        assertTicket(ticket);
        if (!SYSTEM_ID_PATTERN.test(systemId)) throw new ApiError('bad-slug', 'That is not a design system id.');
        await removeTicketFiles(ticket);
        made.set(ticket, systemId);
        log.info('system-builds.consumed', { ticket, system: systemId });
      }),

    sweep: () => run(() => sweepNow(SYSTEM_BUILDS_MAX)),

    stop: async (id, { proposalId }) => {
      // The decline goes first, so the record goes to the trash with the folder (and comes back with Undo).
      // It changes only a proposal still waiting; a stop that is then refused leaves the user's no standing.
      const proposals = deps.proposals?.();
      if (proposals !== undefined) await systems.withLock(id, () => proposals.declineLocked(id, proposalId));
      let name = id;
      const deleted = await systems.trash(id, {
        guard: (state) => {
          name = state.name;
          // A sheet-made system has no build: it is deleted from its page.
          if (state.build === undefined || state.build === null) throw new ApiError('conflict', notBuiltInChat(state.name));
          if (state.build.appliedSeen !== null) throw new ApiError('conflict', alreadyApplied(state.name, whereOf(state)));
        },
      });
      pruneUndos();
      const undoId = `su_${randomSuffix()}`;
      const until = now().getTime() + undoMs;
      undos.set(undoId, { id, name, trashedTo: deleted.trashedTo, root: settings.root(), until });
      log.info('system-builds.stopped', { system: id, proposal: proposalId });
      return { undoId, until: new Date(until).toISOString() };
    },

    undoStop: async (undoId) => {
      pruneUndos();
      const undo = undos.get(undoId);
      if (undo === undefined) throw new ApiError('not-found', STOP_UNDO_GONE_MESSAGE);
      return systems.withLock(undo.id, async () => {
        const root = settings.root();
        if (!samePath(root, undo.root)) {
          undos.delete(undoId);
          throw new ApiError('not-found', STOP_UNDO_GONE_MESSAGE);
        }
        // The trashed folder must still be the real folder this run moved into `<root>/.trash`.
        const trashed = await resolveInside(root, ['.trash', path.basename(undo.trashedTo)]).catch(() => null);
        if (trashed === null || !samePath(trashed, undo.trashedTo) || !(await isRealDirectory(undo.trashedTo))) {
          undos.delete(undoId);
          throw new ApiError('not-found', STOP_UNDO_GONE_MESSAGE);
        }
        // Its id and its name must both be free again, and the cap must have room (read now: the index may lag a removal).
        const rows = await systems.list();
        const folded = (name: string): string => name.normalize('NFKC').toLowerCase();
        const taken = rows.some((row) => row.id.toLowerCase() === undo.id || folded(row.name) === folded(undo.name));
        const target = path.resolve(await resolveInside(root, []), SYSTEMS_DIR, undo.id);
        if (taken || (await lstat(target).then(() => true, () => false))) throw new ApiError('conflict', nameBack(undo.name));
        if (rows.filter((row) => !isReservedSystemId(row.id)).length >= SYSTEMS_MAX) throw new ApiError('conflict', SYSTEMS_CAP_MESSAGE);
        const systemsDir = path.dirname(target);
        try {
          await mkdir(systemsDir);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ApiError('bad-path', folderErrorSentence(error, systemsDir));
        }
        if (!(await isRealDirectory(systemsDir)) || !samePath(await resolveInside(root, [SYSTEMS_DIR, undo.id]), target)) {
          throw new ApiError('conflict', nameBack(undo.name));
        }
        await renameWithRetry(undo.trashedTo, target);
        undos.delete(undoId);
        hub.emit({ slug: null, kind: 'system', system: undo.id, systemChange: 'added', origin: 'user' });
        log.info('system-builds.stop-undone', { system: undo.id });
        return { id: undo.id };
      });
    },

    dispose() {
      disposed = true;
      unsubscribe();
      made.clear();
      undos.clear();
    },
  };
};

// ---- the context accessor (the `ensureSystemStore` pattern) ----

const instances = new WeakMap<ServiceContext, BuildTickets>();

/** The one ticket service of a composed service; its first sweep runs at once (service start). */
export const ensureBuildTickets = (ctx: ServiceContext): BuildTickets => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createBuildTickets({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, systems: ensureSystemStore(ctx), proposals: () => ensureProposals(ctx) });
  instances.set(ctx, created);
  ctx.onDispose(() => created.dispose());
  created.sweep().catch((error: unknown) => ctx.log.warn('system-builds.sweep-failed', { error: errorText(error) }));
  return created;
};
