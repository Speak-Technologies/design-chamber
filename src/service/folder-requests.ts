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
// - a damaged registry is never set aside here (only a user action may): the stamp is put back so
//   the next design event retries, and the request waits.
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
  /** Resolves when every queued reconcile has finished (tests). */
  idle(): Promise<void>;
  stop(): void;
};

export type FolderRequestDeps = {
  ctx: ServiceContext;
  /** Test seam; the context's shared folders service otherwise. */
  folders?: Pick<FoldersService, 'changeByName'>;
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
  let stopped = false;

  const setProblem = (slug: string, unknown: string[]): Promise<ServiceState> =>
    ctx.store.updateSystemState(slug, (state) => {
      if (unknown.length === 0) {
        if (state.folderRequestProblem === undefined) return null;
        const next: ServiceState = { ...state };
        delete next.folderRequestProblem;
        return next;
      }
      return sameNames(state.folderRequestProblem?.unknown, unknown) ? null : { ...state, folderRequestProblem: { unknown } };
    });

  const reconcile = async (slug: string): Promise<void> => {
    const record = await ctx.store.get(slug);
    if (record.designJson !== 'ok') return; // an unparseable design.json never acts
    const request = record.design.folderRequest;
    if (request === undefined) return;
    const stamp = folderRequestStamp(request);
    const previous = record.state.folderRequestSeen;
    if (stamp === previous) return;
    // Seen first: whatever happens next, the same request is never acted on twice.
    await ctx.store.updateSystemState(slug, (state) => (state.folderRequestSeen === stamp ? null : { ...state, folderRequestSeen: stamp }));
    let unknown: string[];
    try {
      ({ unknown } = await folders().changeByName(slug, { add: request.add ?? [], remove: request.remove ?? [] }));
    } catch (error) {
      if (!(error instanceof FoldersDamagedError)) throw error;
      // Folders couldn't load: the request waits for the next design event (the stamp goes back).
      ctx.log.warn('folders.request-waiting', { slug, reason: 'damaged' });
      await ctx.store.updateSystemState(slug, (state) => {
        if (state.folderRequestSeen !== stamp) return null;
        const next: ServiceState = { ...state };
        if (previous === undefined) delete next.folderRequestSeen;
        else next.folderRequestSeen = previous;
        return next;
      });
      return;
    }
    await setProblem(slug, unknown);
  };

  const enqueue = (slug: string): Promise<void> => {
    const prior = chains.get(slug) ?? Promise.resolve();
    const run = prior
      .then(() => reconcile(slug))
      .catch((error: unknown) => {
        // A design removed meanwhile is normal; anything else is worth a line (never a folder name).
        if (error instanceof ApiError && error.code === 'not-found') return;
        ctx.log.warn('folders.request-failed', { slug, error: codeOf(error) });
      });
    chains.set(slug, run);
    void run.then(() => {
      if (chains.get(slug) === run) chains.delete(slug);
    });
    return run;
  };

  const unsubscribe = ctx.hub.subscribe((event) => {
    if (stopped || event.slug === null || event.origin === 'user') return;
    if (event.kind !== 'design' && event.kind !== 'added') return;
    void enqueue(event.slug);
  });

  return {
    reconcile: (slug) => enqueue(slug),
    async idle() {
      while (chains.size > 0) await Promise.all([...chains.values()]);
    },
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
};

/** Subscribes to design events; returns the stop. The composition root calls this once. */
export const startFolderRequests = (ctx: ServiceContext): (() => void) => {
  const reconciler = createFolderRequestReconciler({ ctx });
  return () => reconciler.stop();
};
