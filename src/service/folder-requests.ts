// The agent's filing request (documentation/specs/phase-2-6-technical.md §2.2, §5.4, AD-16): the
// agent writes design.json `folderRequest` (folder NAMES to add or remove, read from
// `<root>/.chamber/folders.json`); the service acts on it, the way it adopts `systemChoice`
// (systems/choice.ts). Agents cannot call the loopback routes, so this is their only filing path.
//
// What this module can do is bounded by construction (D11):
// - tag or untag one design in folders that already exist, matched by name ignoring case
//   (`FoldersService.changeByName`); it has no create, rename or delete path, never touches
//   `projects`, and never builds a path from a name;
// - act once per distinct request: the sha256 of the normalised request is recorded as
//   `folderRequestSeen` FIRST (state.json, never mirrored), so a failure never loops and a restart
//   or an echo of the same request does nothing;
// - `add` names no folder has are recorded as `folderRequestProblem` (a design warning); a clean
//   request clears it;
// - a damaged registry is never set aside here (only a user action may): the stamp is put back and
//   the request waits; the next design event or the next registry write (the user's folder action
//   that repairs it) retries it (KI-25). A failed write (busy, disk full, refused, the file cap)
//   waits the same way with its own warning (KI-30);
// - a request written while the service was down, or sitting in a designs folder the user switches
//   to, is picked up by one sweep after the watcher's baseline (KI-26);
// - every change to the design's warning is announced with a `comments` event, after the state.json
//   write, so the guests refetch the design. Nothing here, in `systems/choice.ts` or in the versions
//   service acts on `comments`, so the announcement cannot loop or make a version.
// An unparseable design.json never acts (the parser drops an invalid request with its own warning).

import { createHash } from 'node:crypto';

import type { FolderRequest, ServiceState } from '../shared/types.ts';
import type { ServiceContext } from './context.ts';
import { ensureFoldersService, FoldersDamagedError, type FoldersService } from './folders.ts';
import { ApiError } from './http.ts';

/** sha256 hex of the request's canonical JSON (fixed key order, absent lists as `[]`). */
export const folderRequestStamp = (request: FolderRequest): string =>
  createHash('sha256')
    .update(JSON.stringify({ add: request.add ?? [], remove: request.remove ?? [], at: request.at ?? null }), 'utf8')
    .digest('hex');

export type FolderRequestReconciler = {
  /** Act on the design's current `folderRequest` (the hub listener calls this; tests await it). */
  reconcile(slug: string): Promise<void>;
  /** Resolves when the current sweep and every queued reconcile have finished (tests, shutdown). */
  idle(): Promise<void>;
  stop(): void;
};

export type FolderRequestDeps = {
  ctx: ServiceContext;
  /** Test seam; the context's shared folders service otherwise. */
  folders?: Pick<FoldersService, 'changeByName'>;
  /**
   * The watcher's current baseline (`() => watcher.ready`). Given: every design is swept once after it
   * settles, and again after each root change. Absent (unit tests): only events drive the reconciler.
   */
  ready?: () => Promise<void>;
};

/** A code for the log, never the message: an fs error's message carries a file path (§10.6). */
const codeOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.code;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : 'internal';
};

const sameNames = (a: readonly string[] | undefined, b: readonly string[]): boolean => a !== undefined && a.length === b.length && a.every((name, at) => name === b[at]);

export const createFolderRequestReconciler = (deps: FolderRequestDeps): FolderRequestReconciler => {
  const { ctx } = deps;
  const folders = (): Pick<FoldersService, 'changeByName'> => deps.folders ?? ensureFoldersService(ctx);
  const chains = new Map<string, Promise<void>>();
  /** Designs whose request waits on a damaged registry: retried on the next registry write (KI-25). */
  const waiting = new Set<string>();
  let stopped = false;
  /** Bumped on each root change, so a sweep of the old folder stops queueing. */
  let generation = 0;
  let sweeping: Promise<void> = Promise.resolve();

  // state.json changed but design.json did not, so no watcher event tells the guests. `comments`
  // makes the guest store refetch the list and the open design; no reconciler acts on it and the
  // versions service does not count it as content, so it can neither loop nor make a version.
  const announce = (slug: string): void => {
    if (!stopped) ctx.hub.emit({ slug, kind: 'comments' });
  };

  const setProblem = async (slug: string, unknown: string[]): Promise<void> => {
    let changed = false;
    await ctx.store.updateSystemState(slug, (state) => {
      if (unknown.length === 0) {
        if (state.folderRequestProblem === undefined) return null;
        const next: ServiceState = { ...state };
        delete next.folderRequestProblem;
        changed = true;
        return next;
      }
      if (sameNames(state.folderRequestProblem?.unknown, unknown)) return null;
      changed = true;
      return { ...state, folderRequestProblem: { unknown } };
    });
    if (changed) announce(slug);
  };

  const reconcile = async (slug: string): Promise<void> => {
    const record = await ctx.store.get(slug);
    if (record.designJson !== 'ok') return; // an unparseable design.json never acts
    const request = record.design.folderRequest;
    if (request === undefined) {
      waiting.delete(slug);
      return;
    }
    const stamp = folderRequestStamp(request);
    const previous = record.state.folderRequestSeen;
    if (stamp === previous) return;
    // Seen first: whatever happens next, the same request is never acted on twice.
    await ctx.store.updateSystemState(slug, (state) => (state.folderRequestSeen === stamp ? null : { ...state, folderRequestSeen: stamp }));
    let unknown: string[];
    try {
      ({ unknown } = await folders().changeByName(slug, { add: request.add ?? [], remove: request.remove ?? [] }));
    } catch (error) {
      // Folders couldn't load, or the write failed (busy after its retries, disk full, refused, the
      // file cap): the request waits (the stamp goes back) for the next design event or the next
      // registry write (KI-25, KI-30). Only an event retries it, so a failure never loops.
      const damaged = error instanceof FoldersDamagedError;
      ctx.log.warn('folders.request-waiting', { slug, reason: damaged ? 'damaged' : codeOf(error) });
      waiting.add(slug);
      const wait: NonNullable<ServiceState['folderRequestProblem']> = damaged ? { unknown: [], waiting: true } : { unknown: [], waiting: true, reason: 'write' };
      let changed = false;
      await ctx.store.updateSystemState(slug, (state) => {
        if (state.folderRequestSeen !== stamp) return null;
        const problem = state.folderRequestProblem;
        changed = problem?.waiting !== true || problem.unknown.length > 0 || problem.reason !== wait.reason;
        const next: ServiceState = { ...state, folderRequestProblem: wait };
        if (previous === undefined) delete next.folderRequestSeen;
        else next.folderRequestSeen = previous;
        return next;
      });
      if (changed) announce(slug);
      return;
    }
    waiting.delete(slug);
    await setProblem(slug, unknown);
  };

  const enqueue = (slug: string): Promise<void> => {
    const prior = chains.get(slug) ?? Promise.resolve();
    const run = prior
      .then(() => reconcile(slug))
      .catch((error: unknown) => {
        // A design removed meanwhile is normal; anything else is worth a line (never a folder name).
        if (error instanceof ApiError && error.code === 'not-found') {
          waiting.delete(slug);
          return;
        }
        ctx.log.warn('folders.request-failed', { slug, error: codeOf(error) });
      });
    chains.set(slug, run);
    void run.then(() => {
      if (chains.get(slug) === run) chains.delete(slug);
    });
    return run;
  };

  /**
   * Once after the baseline and after each root change: a request written while the service was
   * down (or in the folder just switched to) is acted on now. One design at a time on the per-slug
   * chains; `reconcile` reads each and acts only where the request's hash differs from the seen one.
   */
  const sweep = async (ready: () => Promise<void>): Promise<void> => {
    const mine = generation;
    // The watcher replaces its baseline promise right after it emits `root`: read it a turn later.
    await Promise.resolve();
    await ready();
    if (stopped || mine !== generation) return;
    let designs: { slug: string }[];
    try {
      designs = await ctx.store.list();
    } catch (error) {
      ctx.log.warn('folders.request-sweep-failed', { error: codeOf(error) });
      return;
    }
    for (const { slug } of designs) {
      if (stopped || mine !== generation) return;
      await enqueue(slug);
    }
  };

  const startSweep = (): void => {
    const ready = deps.ready;
    if (ready === undefined) return;
    sweeping = sweep(ready).catch((error: unknown) => ctx.log.warn('folders.request-sweep-failed', { error: codeOf(error) }));
  };

  const unsubscribe = ctx.hub.subscribe((event) => {
    if (stopped) return;
    if (event.kind === 'root') {
      generation += 1;
      waiting.clear();
      startSweep();
      return;
    }
    // The registry was written (the user's folder action, which sets a damaged file aside): retry
    // what waited on it. The stamp check keeps this idempotent.
    if (event.kind === 'folders') {
      for (const slug of [...waiting]) void enqueue(slug);
      return;
    }
    if (event.slug === null) return;
    if (event.kind === 'removed') {
      waiting.delete(event.slug);
      return;
    }
    if (event.origin === 'user') return;
    if (event.kind !== 'design' && event.kind !== 'added') return;
    void enqueue(event.slug);
  });
  startSweep();

  return {
    reconcile: (slug) => enqueue(slug),
    async idle() {
      await sweeping;
      while (chains.size > 0) await Promise.all([...chains.values()]);
    },
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
};

/**
 * Subscribes to design and registry events now (the watcher's baseline seed emits none) and sweeps
 * every design once `ready` settles. Returns the stop, which waits for the queued reconciles. The
 * composition root calls this once.
 */
export const startFolderRequests = (ctx: ServiceContext, ready?: () => Promise<void>): (() => Promise<void>) => {
  const reconciler = createFolderRequestReconciler({ ctx, ...(ready !== undefined ? { ready } : {}) });
  return async () => {
    reconciler.stop();
    await reconciler.idle();
  };
};
