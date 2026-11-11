// Phase 2 feature 19 (saved page data), the viewer's side. One controller per open design per surface
// (`src/guest/page-state.ts`: the one store every screen and viewport shares, the flush, the Clear that never comes back).
// This file gives it a place to stand:
//
//   - `createPageData` runs before the wall is built: it registers the design's saved data with the frame slot (so no live frame is
//     created before the data is read, or the 2 s wait is over) and starts the load;
//   - `mount` runs with the other features once the wall and the notices exist: it routes a live frame's `storage-batch` to the
//     controller, feeds it the change feed, and shows the notices it raises;
//   - the ⋯ menu's "Clear saved page data" asks here, behind a destructive confirm.
//
// Like every Phase 2 feature it starts no write from a message of a design frame beyond its own `localStorage` batches, which the
// service bounds (cap, one store per design). While an old version is on show nothing is read, written or cleared.

import { createPageStateController, type PageStateController } from '../../guest/page-state.ts';
import { banner, confirmDialog } from '../components/kit.ts';
import { errorText, h } from '../components/dom.ts';
import { client, feed } from '../guest.ts';
import { CLEAR_DIALOG_BODY, CLEAR_DIALOG_CONFIRM, clearDialogTitle, clearFailureText, pageDataEntry, pageDataNotice, type PageDataEntry, type PageDataNoticeKind } from '../model/page-state-model.ts';
import { setSlotStorage } from '../model/slot-seed.ts';
import type { NoticesHandle } from '../components/notices.ts';
import type { FeatureMount } from './view-context.ts';
import type { WallHandle } from './wall.ts';

export type PageDataOptions = {
  slug: string;
  /** The wall, read when a frame writes or the frames reload (it is built after this, so it is asked for late). */
  wall: () => WallHandle;
  /** Where the confirm dialog opens. */
  dialogHost: HTMLElement;
  /** The design's current title, for the dialog. */
  title: () => string;
  /** An old version is on show. */
  viewing: () => boolean;
};

export type PageData = {
  /** The ⋯ menu's entry state: hidden (nothing saved), enabled, or disabled with an old version on show. */
  entry: () => PageDataEntry;
  /** Open the confirm. Clear → the controller deletes the data, the frames reload empty, the notice says so. */
  confirmClear: () => void;
  /** Wire the wall's writes, the change feed and the notices. Mounted with the other features. */
  mount: FeatureMount;
  /** Flush what is unsaved and let go. Safe to call twice. */
  dispose: () => void;
};

export const createPageData = (options: PageDataOptions): PageData => {
  const { slug } = options;
  let notices: NoticesHandle | null = null;
  // The controller can speak (a failed load, after 2 s at most) before the view's notices exist: keep what it said.
  const waiting: PageDataNoticeKind[] = [];
  let disposed = false;

  const show = (kind: PageDataNoticeKind): void => {
    if (!notices) {
      waiting.push(kind);
      return;
    }
    const notice = pageDataNotice(kind);
    notices.setTransient('page-data', banner({ tone: notice.tone, title: notice.title, ...(notice.body ? { body: notice.body } : {}) }), notice.ttlMs);
  };

  const controller: PageStateController = createPageStateController({
    client,
    slug,
    onNotice: (notice) => show(notice.kind),
    syncFrames: (batch, exceptBoard) => options.wall().syncStorage(batch, exceptBoard),
    // Every live frame comes back through the frame slot, which reads the controller's data again (empty after a Clear).
    reloadFrames: () => options.wall().reload(),
  });
  // The frame slot waits for this (the controller answers within its own timeout either way) and seeds each live frame from it.
  const forget = setSlotStorage(slug, { ready: controller.load(), init: controller.init });

  const confirmClear = (): void => {
    if (options.viewing()) return;
    confirmDialog(options.dialogHost, {
      title: clearDialogTitle(options.title()),
      body: h('p', null, CLEAR_DIALOG_BODY),
      confirmLabel: CLEAR_DIALOG_CONFIRM,
      destructive: true,
      onConfirm: async () => {
        try {
          await controller.clear();
        } catch (error) {
          // The dialog stays open and shows this; nothing was cleared.
          throw new Error(clearFailureText(errorText(error)));
        }
        show('cleared');
      },
    });
  };

  return {
    entry: () => pageDataEntry({ chars: controller.chars(), persisting: controller.persisting(), viewing: options.viewing() }),
    confirmClear,
    mount: (ctx) => {
      notices = ctx.notices;
      for (const kind of waiting.splice(0)) show(kind);
      const stops = [ctx.wall.onStorageBatch((boardId, batch) => controller.apply(boardId, batch)), feed.subscribe((batch) => controller.applyChanges(batch))];
      return () => {
        for (const stop of stops) stop();
        notices = null;
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      forget();
      // Flushes the keys still unsaved; nothing to wait for here (the view is closing, and a hidden page flushes on its own).
      void controller.dispose();
    },
  };
};
