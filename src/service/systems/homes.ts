// Adoption and homes (documentation/specs/phase-2-5-technical.md §5.9, §2.10, AD-14, AD-15, AD-28).
//
// The agent writes `_systems/<id>/BUILD.json`; the service adopts it into state.json and follows it
// while the build is young. Subscribes to `system files` events that include BUILD.json (and `added`,
// and once per system at start, after the watcher's baseline). Per system, on the system's chain
// (`systems.withLock`, the same lock edits, versions and revision bumps use):
//
//   1. Read and parse BUILD.json (§2.13). Unreadable → buildProblem `unreadable`; stop.
//   2. Not adopted yet: a repo home needs an open ticket whose project folder contains the repo
//      (`verifyRepoHome`); an internal home needs no ticket, but without one the code folder the
//      agent names is never scanned. Adopt: home (realpath), build record (the ticket's project
//      folder copied so it outlives the consumed ticket, AD-28), name (a clash adopts "<name> 2"),
//      Draft, sources.code; consume the ticket; emit `system build`; then the code scan (T13's seam).
//   3. Adopted: a different ticket is `ticket-changed`; a different name is ignored (renames happen
//      in Design Chamber). Before the first `applied` stamp (build.appliedSeen null) a changed home,
//      repo folder, living-page path or code folder is re-verified exactly as step 2 against the
//      stored project folder and followed on a pass (the last good home stands on a fail); from the
//      first stamp on they are fixed (`home-changed`).
//   4. A newer `applied.at` is recorded as seen FIRST (so a failure never loops), then the repo home
//      refreshes its snapshot and an internal home with code rescans (T13's seams; a failure leaves
//      the last snapshot and a log line).
//
// Phase 2.6 (AD-11, §5.10): BUILD.json `existing` names the system the agent started from. At adoption
// and before the first stamp it must be a folder inside the ticket's project (`validateLocation`);
// otherwise it is ignored with `existing-outside-project` and the build is adopted anyway (a hint the
// parser refuses by shape, like an absolute path or `..`, gets the same problem, §19 item 5). When no
// code folder is named, the existing folder is the code source; the build scan fills what it holds.
//
// The service NEVER writes the repo: every path under `home.directory` is only validated, resolved
// and read (`validateScanFolder`, `resolveInside`, `lstat`, `readProjectFile`). Every write goes
// through the system store into `_systems/<id>/.chamber/state.json` (AD-18, §5.13).
//
// Seams the later tasks wire (their modules are stubs until then): `snapshots.refresh` (T13, wired to
// the stub, which fails loudly and is caught), `scans.build` (T13, the build scan → scan.json),
// `livingPages.drop` (T14, the staged and preview pages on a home change), `proposals.supersede`
// (T17, the current proposal on a home change). A home change also replaces a recovery snapshot with
// an empty one, version first (§5.10 rev 3) — T13's snapshot module owns that write.

import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

import { BUILD_PROBLEM_VALUE_MAX, SYSTEM_BUILD_JSON_MAX_BYTES, SYSTEM_NAME_MAX } from '../../shared/limits.ts';
import { parseBuildJson, type ParsedBuildJson } from '../../shared/system-json.ts';
import { repoHomeShapeProblem, type OtherRepoHome, type RepoHomeRequest } from '../../shared/systems.ts';
import type { BuildJson, BuildProblemReason, SystemState } from '../../shared/types.ts';
import type { ChangeHub, Logger, ServiceContext, SettingsStore } from '../context.ts';
import { SKIP_DIRS } from '../discovery.ts';
import { ApiError } from '../http.ts';
import { foldsCase, isInsideOrEqual, resolveInside, resolvePlainTarget, samePath } from '../paths.ts';
import { treeHashOf } from '../versions.ts';
import { ensureBuildTickets, type BuildTickets } from './builds.ts';
import { readProjectFile } from './extract.ts';
import { dropLivingPages } from './living-page.ts';
import { readLivingPageMark } from './living-safe.ts';
import { validateLocation, validateScanFolder } from './scan-folder.ts';
import { runBuildScan } from './drift.ts';
import { clearRecoverySnapshot, refreshSnapshot } from './snapshot.ts';
import { ensureProposals } from './proposals.ts';
import { ensureSystemStore, type SystemStore } from './store.ts';

/** An existing system folder (Phase 2.6 AD-11): its realpath, project-relative path and the project's realpath. */
type Existing = { real: string; rel: string; project: string };

/** The living page's mark sits in the head; this much of an existing file is read to find it. */
const LIVING_MARK_READ_MAX = 65_536;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const problemValue = (value: string): string => value.slice(0, BUILD_PROBLEM_VALUE_MAX);
/** Names compare ignoring case (§2.5: NFKC, lower). */
const foldName = (name: string): string => name.normalize('NFKC').toLowerCase();
/** A path as the filesystem resolves it; a path that does not exist (yet) compares lexically. */
const realOrResolved = (value: string): Promise<string> => realpath(value).catch(() => path.resolve(value));

// ---- verifyRepoHome (the I/O half; the pure half is repoHomeShapeProblem) ----

export type RepoHomeVerification = { problem: { reason: BuildProblemReason; value: string } | null; repoReal: string | null };

/**
 * §5.9 step 2's repo home check, in full: the directory passes `validateScanFolder` and lies inside
 * the project folder the ticket recorded; the folder and living page resolve inside the repo; the
 * resolved folder is not the designs root, inside it or containing it; no other system overlaps; an
 * existing living page must carry this system's mark. Read-only on the repo throughout.
 * `id` is the system being verified (excluded from the overlap rule).
 */
export const verifyRepoHome = async (
  request: RepoHomeRequest,
  projectDirectory: string,
  context: { root: string; systems: Pick<SystemStore, 'list' | 'readState'>; id: string },
): Promise<RepoHomeVerification> => {
  const { root, systems, id } = context;
  const refused = (reason: BuildProblemReason, value: string): RepoHomeVerification => ({ problem: { reason, value: problemValue(value) }, repoReal: null });
  let repoReal: string;
  try {
    repoReal = await validateScanFolder(request.directory, root);
  } catch {
    // Not absolute, a drive root, gone, not a folder, the designs root or inside it: the repo is not
    // a place this build may live (§5.9; the closed list has one reason for it).
    return refused('repo-outside-project', request.directory);
  }
  const rootReal = await realpath(root).catch(() => path.resolve(root));
  const others: OtherRepoHome[] = [];
  for (const row of await systems.list()) {
    if (row.id === id || row.home === 'internal') continue;
    const state = await systems.readState(row.id).catch(() => null);
    if (state?.home?.kind !== 'repo') continue;
    others.push({ id: row.id, name: row.name, directory: state.home.directory, folder: state.home.folder, livingPage: state.home.livingPage });
  }
  const shape = repoHomeShapeProblem(request, { repoReal, projectDirectory, designsRoot: rootReal, others, foldsCase: foldsCase(), skipDirs: SKIP_DIRS });
  if (shape !== null) return { problem: shape, repoReal: null };

  // Resolve inside the repo: a link leading out is refused (a link inside is caught by the mark check
  // below, which lstats the lexical path and never reads through a link).
  let folderAbs: string;
  try {
    folderAbs = await resolveInside(repoReal, request.folder.split('/'));
  } catch {
    return refused('repo-outside-project', request.folder);
  }
  try {
    await resolveInside(repoReal, request.livingPage.split('/'));
  } catch {
    return refused('repo-outside-project', request.livingPage);
  }
  // The designs-root rule again, against the resolved paths (§5.9).
  if (isInsideOrEqual(rootReal, folderAbs) || isInsideOrEqual(folderAbs, rootReal)) return refused('repo-outside-project', folderAbs);

  // An existing living page must be this system's own generated page, never a user's file.
  const pageLexical = path.resolve(repoReal, ...request.livingPage.split('/'));
  const info = await lstat(pageLexical).catch(() => null);
  if (info !== null) {
    let own = false;
    if (info.isFile()) {
      const bytes = await readProjectFile(repoReal, request.livingPage, LIVING_MARK_READ_MAX).catch(() => null);
      const mark = bytes === null ? null : readLivingPageMark(bytes.toString('utf8'));
      own = mark !== null && mark.system === id;
    }
    if (!own) return refused('living-page-exists', request.livingPage);
  }
  return { problem: null, repoReal };
};

// ---- the homes service ----

export type HomesDeps = {
  systems: Pick<SystemStore, 'dir' | 'get' | 'list' | 'readState' | 'updateStateLocked' | 'withLock' | 'queueNotice'>;
  tickets: Pick<BuildTickets, 'open' | 'consume'>;
  settings: Pick<SettingsStore, 'root'>;
  hub: Pick<ChangeHub, 'emit' | 'subscribe'>;
  log: Logger;
  /** T13's snapshot refresh (§5.10); a failure leaves the last snapshot. */
  snapshots?: {
    refresh(id: string, options: { by: 'agent' }): Promise<void>;
    /** §5.10 rev 3: a home change before the first stamp empties a recovery snapshot (version first). */
    clear?(id: string): Promise<void>;
  };
  /** T13's build scan (§7.4: the code scan whose summary becomes `.chamber/scan.json`). */
  scans?: { build(id: string, directory: string): Promise<void> };
  /** T14: drop the staged and preview living pages (a home change makes them the old home's). */
  livingPages?: { drop(id: string): Promise<void> };
  /**
   * T17: mark the current proposal superseded (a proposal for the old home is never approvable); the
   * approval a stamp claims (inside the lock); what landed against it (after the refresh).
   */
  proposals?: {
    supersede(id: string): Promise<void>;
    approveLocked?(id: string, proposal: string | null, parts: readonly string[]): Promise<{ approved: boolean }>;
    compareLanded?(id: string): Promise<void>;
  };
  /** The watcher's current baseline (it changes with the root); each full pass runs after it. */
  ready?: () => Promise<void>;
  now?: () => Date;
};

export type Homes = {
  /** Act on the system's current BUILD.json (the hub listener calls this; tests await it). */
  reconcile(id: string): Promise<void>;
  /** Resolves once every queued reconcile has finished (tests). */
  idle(): Promise<void>;
  stop(): void;
};

/** What runs after the chain step, outside the system's lock (the seams take their own chains). */
type Post = { refresh?: boolean; clearSnapshot?: boolean; scan?: string; dropLivingPages?: boolean; supersedeProposal?: boolean; compareLanded?: boolean };

type BuildRead = { kind: 'absent' } | { kind: 'unreadable' } | { kind: 'read'; parsed: ParsedBuildJson };

/** BUILD.json, bounded; a link, an over-cap file or a broken parse is unreadable (§5.9 step 1). */
const readBuildJson = async (dir: string): Promise<BuildRead> => {
  let file: string;
  try {
    file = await resolvePlainTarget(dir, ['BUILD.json'], { allowAbsent: true });
  } catch {
    return { kind: 'unreadable' }; // a link or a folder where the record should be
  }
  const handle = await open(file, 'r').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (handle === null) return { kind: 'absent' };
  let bytes: Buffer;
  try {
    const buffer = Buffer.alloc(SYSTEM_BUILD_JSON_MAX_BYTES + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled > SYSTEM_BUILD_JSON_MAX_BYTES) return { kind: 'unreadable' };
    bytes = buffer.subarray(0, filled);
  } finally {
    await handle.close();
  }
  const parsed = parseBuildJson(bytes.toString('utf8'));
  return parsed.build === null || parsed.unreadable !== null ? { kind: 'unreadable' } : { kind: 'read', parsed };
};

export const createHomes = (deps: HomesDeps): Homes => {
  const { systems, tickets, settings, hub, log } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const chains = new Map<string, Promise<void>>();
  let stopped = false;

  const emitBuild = (id: string): void => {
    hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'build' });
  };

  /** Record a problem (once: the same reason and value write nothing). Answers whether it changed. */
  const setProblem = async (id: string, reason: BuildProblemReason, value: string): Promise<boolean> => {
    let changed = false;
    await systems.updateStateLocked(id, (state) => {
      const current = state.buildProblem;
      if (current !== undefined && current !== null && current.reason === reason && current.value === value) return null;
      changed = true;
      return { ...state, buildProblem: { reason, value: problemValue(value) } };
    });
    return changed;
  };

  const clearProblem = async (id: string): Promise<boolean> => {
    let changed = false;
    await systems.updateStateLocked(id, (state) => {
      if (state.buildProblem === undefined || state.buildProblem === null) return null;
      changed = true;
      return { ...state, buildProblem: null };
    });
    return changed;
  };

  /** The code folder a build may name: only inside the project folder the ticket recorded (§5.9). */
  const codeWithin = async (directory: string, projectDirectory: string): Promise<string | null> => {
    if (!path.isAbsolute(directory)) return null;
    const real = await realOrResolved(directory);
    return isInsideOrEqual(projectDirectory, real) ? real : null;
  };

  /**
   * Phase 2.6 AD-11: the existing system folder BUILD.json names, resolved with `validateLocation`
   * inside the ticket's project folder (realpaths; the designs root refused). Null when there is no
   * project or the folder is not a usable one inside it.
   */
  const existingWithin = async (folder: string, projectDirectory: string | null): Promise<Existing | null> => {
    if (projectDirectory === null) return null;
    const project = await realpath(projectDirectory).catch(() => null);
    if (project === null) return null;
    try {
      const located = await validateLocation(folder, project, settings.root());
      return { ...located, project };
    } catch {
      return null;
    }
  };

  /**
   * The `existing-outside-project` value, or null: the hint's folder when it did not resolve inside
   * the project, or the raw text of a hint the parser refused by shape (§19 item 5).
   */
  const existingProblemOf = (build: BuildJson, existing: Existing | null, refused: string | null): string | null => {
    if (build.existing != null) return existing === null ? build.existing.folder : null;
    return refused;
  };

  /** The code source a build asks for: its code folder, else the existing system's folder (AD-11). */
  const codeSourceOf = (codeDir: string | null, existing: Existing | null, at: string): NonNullable<SystemState['sources']['code']> | null => {
    const directory = codeDir ?? existing?.real ?? null;
    if (directory === null) return null;
    return {
      directory,
      lastScan: at,
      partial: false,
      scanned: [],
      ...(existing === null ? {} : { project: existing.project, existing: { location: existing.rel, marks: [], read: { page: [], docs: [], components: [] } } }),
    };
  };

  /** Step 2: adopt an unadopted build. Runs on the system's chain; null when a problem stopped it. */
  const adopt = async (
    id: string,
    state: SystemState,
    build: BuildJson,
    ticket: { ticket: string; projectDirectory: string | null; sessionId: string | null } | null,
    existingRefused: string | null,
  ): Promise<Post | null> => {
    // Over the cap, reserved or unreadable folders are not adopted (the list shows their sentence).
    const rows = await systems.list();
    const row = rows.find((one) => one.id === id);
    if (row === undefined || row.unreadable !== null) {
      log.info('systems.homes.not-adopted', { system: id, reason: 'unusable' });
      return null;
    }
    const projectDirectory = ticket?.projectDirectory ?? null;
    let repoReal: string | null = null;
    if (build.home === 'repo') {
      if (ticket === null || projectDirectory === null) {
        if (await setProblem(id, 'ticket-needed', build.ticket ?? '')) emitBuild(id);
        return null;
      }
      // Safe: parseBuildJson guarantees repo for a repo home.
      const verified = await verifyRepoHome(build.repo as RepoHomeRequest, projectDirectory, { root: settings.root(), systems, id });
      if (verified.problem !== null) {
        if (await setProblem(id, verified.problem.reason, verified.problem.value)) emitBuild(id);
        return null;
      }
      repoReal = verified.repoReal;
    }
    let codeDir: string | null = null;
    if (build.code !== null && projectDirectory !== null) {
      codeDir = await codeWithin(build.code.directory, projectDirectory);
      if (codeDir === null) {
        if (await setProblem(id, 'code-outside-project', build.code.directory)) emitBuild(id);
        return null;
      }
    }
    // An existing system outside the project, or a hint whose shape the parser refused (§19 item 5),
    // is ignored with a problem; it never stops the adoption.
    const existing = build.existing == null ? null : await existingWithin(build.existing.folder, projectDirectory);
    const existingProblem = existingProblemOf(build, existing, existingRefused);

    // A name clash ignoring case adopts "<name> 2" (then 3…) and says so in the page notice.
    const others = rows.filter((one) => one.id !== id);
    let name = build.name;
    if (others.some((one) => foldName(one.name) === foldName(name))) {
      for (let n = 2; n <= 99; n += 1) {
        const suffix = ` ${n}`;
        const candidate = `${build.name.slice(0, SYSTEM_NAME_MAX - suffix.length)}${suffix}`;
        if (!others.some((one) => foldName(one.name) === foldName(candidate))) {
          name = candidate;
          break;
        }
      }
      systems.queueNotice(`Another system is called ${build.name}, so this one was named ${name}.`);
    }

    const at = now().toISOString();
    // The content set's tree hash: an internal home's files as they are now; a repo home has no
    // snapshot yet (the service writes it only on a refresh), so its content set is empty.
    const treeHash = build.home === 'repo' ? treeHashOf({}) : ((await systems.get(id)).treeHash ?? treeHashOf({}));
    const home: SystemState['home'] =
      build.home === 'repo' && repoReal !== null && build.repo !== null
        ? { kind: 'repo', directory: repoReal, folder: build.repo.folder, livingPage: build.repo.livingPage, adoptedAt: at }
        : { kind: 'internal' };
    const code = codeSourceOf(codeDir, existing, at);
    await systems.updateStateLocked(id, (current) => ({
      ...current,
      name,
      status: 'draft',
      sessionId: ticket?.sessionId ?? current.sessionId,
      home,
      build: { ticket: build.ticket, adoptedAt: at, appliedSeen: null, projectDirectory },
      sources: { ...current.sources, code },
      revision: { n: Math.max(1, current.revision.n), treeHash, at },
      buildProblem: existingProblem === null ? null : { reason: 'existing-outside-project', value: problemValue(existingProblem) },
    }));
    if (ticket !== null) await tickets.consume(ticket.ticket, id);
    emitBuild(id);
    log.info('systems.homes.adopted', { system: id, home: build.home, ticket: ticket !== null, code: code !== null, existing: existing !== null });
    return code === null ? {} : { scan: code.directory };
  };

  /** Step 3: follow an adopted build (rev 3, AD-28). Null when a problem stopped it (the adopted values stand). */
  const follow = async (id: string, state: SystemState, build: BuildJson, existingRefused: string | null): Promise<Post | null> => {
    const record = state.build;
    // Safe: follow is called only when state.build exists.
    if (record === undefined) return null;
    if (build.ticket !== record.ticket) {
      if (await setProblem(id, 'ticket-changed', build.ticket ?? '')) emitBuild(id);
      return null;
    }
    const projectDirectory = record.projectDirectory ?? null;
    const currentHome = state.home ?? { kind: 'internal' };
    // The stored paths are realpaths; the agent's may be a link or carry a trailing slash, so both
    // compare resolved (an unchanged BUILD.json never reads as a move).
    const homeDiffers =
      build.home !== currentHome.kind ||
      (build.home === 'repo' &&
        build.repo !== null &&
        currentHome.kind === 'repo' &&
        (!samePath(await realOrResolved(build.repo.directory), currentHome.directory) || build.repo.folder !== currentHome.folder || build.repo.livingPage !== currentHome.livingPage));
    // Phase 2.6 AD-11: the existing system folder, checked like the code folder; outside the project it is ignored.
    const existing = build.existing == null ? null : await existingWithin(build.existing.folder, projectDirectory);
    const existingProblem = existingProblemOf(build, existing, existingRefused);
    const existingDiffers = (existing?.rel ?? null) !== (state.sources.code?.existing?.location ?? null);
    /** No other problem: the existing folder's own, or none. */
    const settleProblem = async (): Promise<void> => {
      const changed = existingProblem === null ? await clearProblem(id) : await setProblem(id, 'existing-outside-project', existingProblem);
      if (changed) emitBuild(id);
    };
    const codeAsked = build.code !== null && projectDirectory !== null ? build.code.directory : (existing?.real ?? null);
    const codeCurrent = state.sources.code?.directory ?? null;
    const codeDiffers = codeAsked === null || codeCurrent === null ? codeAsked !== codeCurrent : !samePath(await realOrResolved(codeAsked), codeCurrent);

    if (record.appliedSeen !== null) {
      // From the first stamp on the home is fixed: the repo already holds this system's files.
      if (homeDiffers || codeDiffers) {
        const value = build.repo?.directory ?? build.code?.directory ?? 'internal';
        if (await setProblem(id, 'home-changed', value)) emitBuild(id);
        return null;
      }
      await settleProblem();
      return {};
    }

    if (!homeDiffers && !codeDiffers && !existingDiffers) {
      await settleProblem();
      return {};
    }
    // Only the existing system folder changed (the code folder, if named, is the same; when none is
    // named the existing folder is the code source): no home change, so the pages and proposal stand.
    const existingInvolved = build.existing != null || state.sources.code?.existing !== undefined;
    if (!homeDiffers && existingInvolved && (!codeDiffers || build.code === null)) {
      const at = now().toISOString();
      const code = codeSourceOf(build.code === null ? null : (state.sources.code?.directory ?? null), existing, at);
      await systems.updateStateLocked(id, (current) => ({
        ...current,
        sources: { ...current.sources, code },
        buildProblem: existingProblem === null ? null : { reason: 'existing-outside-project', value: problemValue(existingProblem) },
      }));
      emitBuild(id);
      log.info('systems.homes.existing-followed', { system: id, existing: existing !== null });
      return code === null ? {} : { scan: code.directory };
    }

    // Before the first stamp: re-verify exactly as step 2, the stored project folder standing in
    // for the consumed ticket's. A fail leaves the last good home; a pass replaces it.
    let repoReal: string | null = null;
    if (build.home === 'repo') {
      if (projectDirectory === null) {
        if (await setProblem(id, 'ticket-needed', build.ticket ?? '')) emitBuild(id);
        return null;
      }
      // Safe: parseBuildJson guarantees repo for a repo home.
      const verified = await verifyRepoHome(build.repo as RepoHomeRequest, projectDirectory, { root: settings.root(), systems, id });
      if (verified.problem !== null) {
        if (await setProblem(id, verified.problem.reason, verified.problem.value)) emitBuild(id);
        return null;
      }
      repoReal = verified.repoReal;
    }
    // The code folder BUILD.json names (the existing folder, when it stands in, is already checked).
    const codeFolder = build.code !== null && projectDirectory !== null ? build.code.directory : null;
    let codeDir: string | null = null;
    if (codeFolder !== null && projectDirectory !== null) {
      codeDir = await codeWithin(codeFolder, projectDirectory);
      if (codeDir === null) {
        if (await setProblem(id, 'code-outside-project', codeFolder)) emitBuild(id);
        return null;
      }
    }
    const at = now().toISOString();
    const home: SystemState['home'] =
      build.home === 'repo' && repoReal !== null && build.repo !== null
        ? { kind: 'repo', directory: repoReal, folder: build.repo.folder, livingPage: build.repo.livingPage, adoptedAt: record.adoptedAt }
        : { kind: 'internal' };
    const code = codeSourceOf(codeDir, existing, at);
    await systems.updateStateLocked(id, (current) => ({
      ...current,
      home,
      sources: { ...current.sources, code },
      buildProblem: existingProblem === null ? null : { reason: 'existing-outside-project', value: problemValue(existingProblem) },
    }));
    emitBuild(id);
    log.info('systems.homes.home-followed', { system: id, home: build.home, code: codeDir !== null, existing: existing !== null });
    // A proposal for the old home is never approvable; the staged pages are the old home's.
    // A recovery snapshot (the user's read of the old folder) is emptied, version first (§5.10 rev 3).
    return {
      dropLivingPages: true,
      supersedeProposal: true,
      ...(homeDiffers && state.snapshot != null ? { clearSnapshot: true } : {}),
      ...((codeDiffers || existingDiffers) && code !== null ? { scan: code.directory } : {}),
    };
  };

  /** Step 4: a newer applied stamp, recorded as seen before anything that can fail runs. */
  const stampSeen = async (id: string, state: SystemState, build: BuildJson): Promise<Post> => {
    const record = state.build;
    if (record === undefined || build.applied === null) return {};
    if (record.appliedSeen !== null && Date.parse(build.applied.at) <= Date.parse(record.appliedSeen)) return {};
    const seen = build.applied.at;
    await systems.updateStateLocked(id, (current) =>
      current.build === undefined ? null : { ...current, build: { ...current.build, appliedSeen: seen } },
    );
    emitBuild(id);
    log.info('systems.homes.applied-seen', { system: id });
    // §5.14 step 5: the stamp's proposal must be the one recorded as shown, bytes unchanged. Anything
    // else is a problem, and the snapshot is still read, because the repo is what it is.
    let approved = false;
    if (deps.proposals?.approveLocked !== undefined) {
      approved = (await deps.proposals.approveLocked(id, build.proposal, build.applied.parts)).approved;
      if (!approved && (await setProblem(id, 'applied-unknown-proposal', build.proposal ?? ''))) emitBuild(id);
    }
    const home = state.home ?? { kind: 'internal' };
    if (home.kind === 'repo') return approved ? { refresh: true, compareLanded: true } : { refresh: true };
    const code = state.sources.code?.directory ?? null;
    return code === null ? {} : { scan: code };
  };

  const reconcile = async (id: string): Promise<void> => {
    const post = await systems.withLock(id, async (): Promise<Post> => {
      let dir: string;
      try {
        dir = await systems.dir(id);
      } catch (error) {
        if (error instanceof ApiError) return {}; // deleted or moved meanwhile
        throw error;
      }
      const read = await readBuildJson(dir);
      if (read.kind === 'absent') return {}; // a sheet-made system, or the record removed
      if (read.kind === 'unreadable') {
        if (await setProblem(id, 'unreadable', '')) emitBuild(id);
        return {};
      }
      const build = read.parsed.build;
      // Safe: readBuildJson answers `read` only when build is non-null.
      if (build === null) return {};
      const state = await systems.readState(id);
      let followed: Post | null;
      if (state.build === undefined) {
        let ticket: { ticket: string; projectDirectory: string | null; sessionId: string | null } | null = null;
        if (build.ticket !== null) {
          const open = await tickets.open(build.ticket);
          if (open === null && build.home === 'repo') {
            if (await setProblem(id, 'ticket-unknown', build.ticket)) emitBuild(id);
            return {};
          }
          ticket = open;
        }
        followed = await adopt(id, state, build, ticket, read.parsed.existingRefused ?? null);
      } else {
        followed = await follow(id, state, build, read.parsed.existingRefused ?? null);
      }
      // A problem stops the step: the adopted values stand, and a stamp in the same write is not
      // acted on. Otherwise the stamp acts on the home as it stands now (a home change and a stamp
      // may arrive in one write; a first BUILD.json may already carry one after a restart).
      if (followed === null) return {};
      const after = await systems.readState(id);
      if (after.build === undefined) return followed;
      const stamped = await stampSeen(id, after, build);
      return { ...followed, ...stamped };
    });

    // Outside the system's lock: each seam runs on its own chain (the snapshot refresh takes the
    // same lock; nesting it would deadlock). A failure is logged and leaves the last good state.
    if (post.dropLivingPages === true) {
      if (deps.livingPages !== undefined) await deps.livingPages.drop(id).catch((error: unknown) => log.warn('systems.homes.living-page-drop-failed', { system: id, error: errorText(error) }));
    }
    if (post.supersedeProposal === true) {
      if (deps.proposals !== undefined) await deps.proposals.supersede(id).catch((error: unknown) => log.warn('systems.homes.proposal-supersede-failed', { system: id, error: errorText(error) }));
    }
    if (post.clearSnapshot === true && deps.snapshots?.clear !== undefined) {
      await deps.snapshots.clear(id).catch((error: unknown) => log.warn('systems.homes.snapshot-clear-failed', { system: id, error: errorText(error) }));
    }
    if (post.refresh === true) {
      if (deps.snapshots !== undefined) {
        await deps.snapshots.refresh(id, { by: 'agent' }).catch((error: unknown) => log.warn('systems.homes.refresh-failed', { system: id, error: errorText(error) }));
      }
    }
    if (post.compareLanded === true && deps.proposals?.compareLanded !== undefined) {
      await deps.proposals.compareLanded(id).catch((error: unknown) => log.warn('systems.homes.landed-failed', { system: id, error: errorText(error) }));
    }
    if (post.scan !== undefined) {
      if (deps.scans !== undefined) {
        await deps.scans.build(id, post.scan).catch((error: unknown) => log.warn('systems.homes.scan-failed', { system: id, error: errorText(error) }));
      } else {
        log.warn('systems.homes.scan-not-built', { system: id });
      }
    }
  };

  const enqueue = (id: string, task: () => Promise<void>): Promise<void> => {
    const previous = chains.get(id) ?? Promise.resolve();
    const run = previous.then(task).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'not-found') return;
      log.warn('systems.homes.reconcile-failed', { system: id, error: errorText(error) });
    });
    chains.set(id, run);
    void run.then(() => {
      if (chains.get(id) === run) chains.delete(id);
    });
    return run;
  };

  /** Once per system at start (and after a root change), after the watcher's baseline. */
  const initial = async (): Promise<void> => {
    await deps.ready?.();
    if (stopped) return;
    const rows = await systems.list().catch((error: unknown) => {
      log.warn('systems.homes.start-failed', { error: errorText(error) });
      return [];
    });
    for (const row of rows) if (row.unreadable === null) void enqueue(row.id, () => reconcile(row.id));
  };

  const unsubscribe = hub.subscribe((event) => {
    if (stopped) return;
    if (event.kind === 'root') {
      void initial();
      return;
    }
    if (event.kind !== 'system' || event.system === undefined) return;
    const id = event.system;
    if (event.systemChange === 'added' || (event.systemChange === 'files' && event.files?.includes('BUILD.json') === true)) {
      void enqueue(id, () => reconcile(id));
    }
  });
  void initial();

  return {
    reconcile: (id) => enqueue(id, () => reconcile(id)),
    async idle() {
      while (chains.size > 0) await Promise.all([...chains.values()]);
    },
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
};

// ---- wiring (the `startChoiceReconciler` pattern) ----

/** Subscribes to BUILD.json changes and runs once per system at start; returns the unsubscribe. */
export const startHomes = (ctx: ServiceContext, ready?: () => Promise<void>): (() => void) => {
  const homes = createHomes({
    systems: ensureSystemStore(ctx),
    tickets: ensureBuildTickets(ctx),
    settings: ctx.settings,
    hub: ctx.hub,
    log: ctx.log,
    // A failure is caught and logged (the stamp is already seen, so it never loops).
    snapshots: {
      refresh: async (id, options) => void (await refreshSnapshot(ctx, id, options)),
      clear: (id) => clearRecoverySnapshot(ctx, id),
    },
    scans: { build: (id, directory) => runBuildScan(ctx, id, directory) },
    livingPages: { drop: (id) => dropLivingPages(ctx, id) },
    proposals: ensureProposals(ctx),
    ...(ready !== undefined ? { ready } : {}),
  });
  return () => homes.stop();
};
