// System history (documentation/specs/phase-2-5-technical.md §5.2, AD-3): the versions machinery of
// `versions.ts`, reused through its `VersionTarget` seam, over `_systems/<id>/` instead of a design.
// Index safety, caps (1 000 files / 100 MB, newest 100), GC and restore are the design ones (§6.4),
// not a copy. The tracked set is the same (everything but `.versions/**`, `.chamber/**`), so a
// restore never touches the system's `.chamber/` (state, edits ledger, checks). A system has no
// design.json, so the comment graft never runs (`liveState` is null).
//
// Chain: the system store's lock (`withLock`), so snapshots, restores and later hand edits never
// interleave with a revision bump. Nothing on the chain takes that lock again: the revision is
// settled after the restore's chain step, through `afterRestore` (a restore is not the user's hand
// edit, so changed sections read Not reviewed, derived by the store).
//
// AD-20 (T12b): a repo-backed system refuses Restore with 422 `read-only` before anything is read or
// written, in `restoreSystemVersion` below, the one entry the route uses. A repo re-sync has no Undo
// (AD-33, rev 3), so there is no exception. Its history stays viewable.

import type { RestoreVersionResponse } from '../../shared/api.ts';
import type { ChangeHub, ServiceContext } from '../context.ts';
import { createVersionsService, type VersionsService, type VersionTarget } from '../versions.ts';
import { ensureSystemStore, refuseReadOnly, type SystemStore } from './store.ts';

/** The system's linked chat, from its state.json; null when it has none or cannot be read. */
const sessionOf = async (systems: SystemStore, id: string): Promise<string | null> => (await systems.get(id).catch(() => null))?.state.sessionId ?? null;

/** The system target: `system` events in, `system versions` / `system files` events out. */
export const systemVersionTarget = (systems: SystemStore, hub: ChangeHub): VersionTarget => ({
  kind: 'system',
  dir: (id) => systems.dir(id),
  // Over-limit and unreadable systems take no turn snapshot: they offer no actions but Reveal (§5.1).
  // The linked chat lives in state.json only (the summary does not carry it).
  list: async () => {
    const out: { key: string; sessionId: string | null }[] = [];
    for (const row of await systems.list()) {
      if (row.unreadable !== null) continue;
      out.push({ key: row.id, sessionId: await sessionOf(systems, row.id) });
    }
    return out;
  },
  sessionId: (id) => sessionOf(systems, id),
  liveState: async () => null,
  emit: (id, change) => {
    hub.emit({ slug: null, kind: 'system', system: id, systemChange: change });
  },
  onContentChange: (listener) =>
    hub.subscribe((event) => {
      if (event.kind === 'root') return listener({ type: 'reset' });
      if (event.kind !== 'system' || event.system === undefined) return;
      if (event.systemChange === 'files' || event.systemChange === 'added') listener({ type: 'content', key: event.system });
      else if (event.systemChange === 'removed') listener({ type: 'removed', key: event.system });
    }),
  chain: (id, fn) => systems.withLock(id, fn),
  afterRestore: (id) => systems.settleRevision(id),
});

const instances = new WeakMap<ServiceContext, VersionsService>();

/** The second `createVersionsService` instance, over systems instead of designs; one per composed service. */
export const ensureSystemVersions = (ctx: ServiceContext): VersionsService => {
  const existing = instances.get(ctx);
  if (existing !== undefined) return existing;
  const created = createVersionsService({ target: systemVersionTarget(ensureSystemStore(ctx), ctx.hub), hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose });
  instances.set(ctx, created);
  return created;
};

/**
 * Restore a system version: the route's one entry. A repo-backed system answers 422 `read-only`
 * (AD-20) before the versions service reads or writes anything.
 */
export const restoreSystemVersion = async (versions: VersionsService, systems: Pick<SystemStore, 'readState'>, id: string, vid: string): Promise<RestoreVersionResponse> => {
  refuseReadOnly(await systems.readState(id));
  return versions.restore(id, vid);
};
