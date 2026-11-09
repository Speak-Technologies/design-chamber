// The decisions behind restore with Undo, with no DOM and no store: one restore at a time, Undo is
// one more restore of the version that held the earlier state (`before`), and how long each
// notice stays. `components/restore-flow.ts` plugs in the real service call and the notices.

import type { RestoreVersionResponse } from '../../shared/api.ts';
import { RESTORE_NOTICE_MS, restoreFailedMessage, restoreNotice, SHORT_NOTICE_MS, undoFailedNotice, undoneNotice, type RestoreNotice } from './findability-model.ts';

export type Version = { id: string; n: number };

/** What the core asks the screen to do. None of these may throw. */
export type RestoreView = {
  /** The version being restored right now (an Undo counts), or null. */
  busy: (id: string | null) => void;
  /** A restore failed; nothing was changed. */
  restoreFailed: (version: Version, message: string) => void;
  /** The design is back in the state of a restored version: leave version viewing, close what covers the notice. */
  reloaded: () => void;
  /** Tell the user; `notice.undoTo` is what Undo restores (null: no Undo). The notice stays `ttlMs`. */
  restored: (version: Version, notice: RestoreNotice, ttlMs: number) => void;
  /** Undo went through. */
  undone: (notice: { title: string; body: string }, ttlMs: number) => void;
  /** Undo failed: stay until dismissed; the screen offers Try again, which calls `core.undo(to, from)` again. */
  undoFailed: (to: Version, from: Version, notice: { title: string; body: string }) => void;
};

export type RestoreCoreDeps = {
  restore: (id: string) => Promise<RestoreVersionResponse>;
  /** Reload the design after a restore. A failure here is not a failed restore: the change feed catches up. */
  refresh: () => Promise<void>;
  view: RestoreView;
  /** The user-facing sentence for a thrown value. */
  describe: (error: unknown) => string;
};

export type RestoreCore = {
  restore: (version: Version) => Promise<void>;
  /** Restore `to` (the version that held the state before `from` was restored). Refused while another restore runs. */
  undo: (to: Version, from: Version) => Promise<void>;
  busyId: () => string | null;
  /** After this the view is never called again (the design view closed). */
  dispose: () => void;
};

export const createRestoreCore = (deps: RestoreCoreDeps): RestoreCore => {
  const { view } = deps;
  let busy: string | null = null;
  let disposed = false;

  const setBusy = (next: string | null): void => {
    busy = next;
    if (!disposed) view.busy(next);
  };

  const run = async (id: string): Promise<RestoreVersionResponse> => {
    const result = await deps.restore(id);
    await deps.refresh().catch(() => undefined);
    return result;
  };

  const undo: RestoreCore['undo'] = async (to, from) => {
    if (busy !== null || disposed) return;
    setBusy(to.id);
    try {
      await run(to.id);
    } catch (error) {
      setBusy(null);
      if (!disposed) view.undoFailed(to, from, undoFailedNotice(deps.describe(error), to));
      return;
    }
    setBusy(null);
    if (disposed) return;
    view.reloaded();
    view.undone(undoneNotice(to, from), SHORT_NOTICE_MS);
  };

  const restore: RestoreCore['restore'] = async (version) => {
    if (busy !== null || disposed) return;
    setBusy(version.id);
    let result: RestoreVersionResponse;
    try {
      result = await run(version.id);
    } catch (error) {
      setBusy(null);
      if (!disposed) view.restoreFailed(version, restoreFailedMessage(version.n, deps.describe(error)));
      return;
    }
    setBusy(null);
    if (disposed) return;
    view.reloaded();
    const notice = restoreNotice(result, version);
    view.restored(version, notice, notice.undoTo ? RESTORE_NOTICE_MS : SHORT_NOTICE_MS);
  };

  return {
    restore,
    undo,
    busyId: () => busy,
    dispose: () => {
      disposed = true;
    },
  };
};
