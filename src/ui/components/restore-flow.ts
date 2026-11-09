// Restore a version without a confirm dialog: do it, then say so in the notices region with an
// Undo for ten seconds. Restoring is safe to reverse because the service saves the state it
// replaces first (`before` in the answer), so Undo is one more restore, of that version.
// The decisions live in model/restore-core.ts; this file plugs in the service call and the DOM.
// The flow reports its own errors and never rejects.

import { store } from '../guest.ts';
import { createRestoreCore, type Version } from '../model/restore-core.ts';
import { toast } from './actions.ts';
import { errorText, h } from './dom.ts';
import { banner, bannerWithActions, btn, type BtnHandle } from './kit.ts';
import type { NoticesHandle } from './notices.ts';

export type RestoreFlowOptions = {
  slug: string;
  notices: NoticesHandle;
  /** A restore or undo went through and the design reloaded: leave version viewing, close the rail's Versions sheet. */
  onRestored: () => void;
  /** The busy version changed: repaint the Restore buttons. */
  onBusy: () => void;
  /** Where focus goes when the button that had it is gone. */
  focusWall: () => void;
  /** A restore failed and its Restore button was repainted: put focus back on it. */
  onFailed: (version: Version) => void;
};

export type RestoreFlow = {
  restore: (version: Version) => Promise<void>;
  /** The version being restored right now (an Undo counts), or null. Every Restore button is disabled meanwhile. */
  busyId: () => string | null;
  dispose: () => void;
};

export const createRestoreFlow = (options: RestoreFlowOptions): RestoreFlow => {
  const { slug, notices } = options;
  /** The buttons of the notice on show: disabled while a restore runs, so a stale Undo never does nothing silently. */
  let noticeButtons: BtnHandle[] = [];

  const showNotice = (tone: 'success' | 'error', title: string, body: string, buttons: BtnHandle[], ttlMs?: number): void => {
    noticeButtons = buttons;
    if (buttons.length === 0) {
      notices.setTransient('restore', banner({ tone, title, body }), ttlMs);
      return;
    }
    // data-actions="stack": in the rail the buttons get their own row under the text (styles.css).
    const wrap = h('div', { class: 'dc-banner dc-restore-notice', 'data-actions': 'stack' });
    wrap.append(...bannerWithActions(tone, title, [body], buttons.map((button) => button.el)));
    notices.setTransient('restore', wrap, ttlMs);
  };

  /** Focus falls to the page when the button that held it is repainted away. */
  const keepFocus = (): void => {
    const active = document.activeElement;
    if (!active || active === document.body) options.focusWall();
  };

  const core = createRestoreCore({
    restore: (id) => store.restoreVersion(slug, id),
    refresh: () => store.refreshOpenDesign(),
    describe: errorText,
    view: {
      busy: (id) => {
        for (const button of noticeButtons) button.set({ disabled: id !== null, title: id !== null ? 'Another restore is running.' : undefined });
        options.onBusy();
      },
      restoreFailed: (version, message) => {
        toast('error', message);
        options.onFailed(version);
      },
      reloaded: () => options.onRestored(),
      restored: (version, notice, ttlMs) => {
        const undoTo = notice.undoTo;
        if (!undoTo) {
          showNotice('success', notice.title, notice.body, [], ttlMs);
        } else {
          const undoButton = btn({ label: 'Undo', variant: 'outline', size: 'xs', onClick: () => {
            if (core.busyId() !== null) return;
            undoButton.set({ loading: true });
            void core.undo(undoTo, version);
          } });
          showNotice('success', notice.title, notice.body, [undoButton], ttlMs);
        }
        keepFocus();
      },
      undone: (notice, ttlMs) => {
        showNotice('success', notice.title, notice.body, [], ttlMs);
        options.focusWall();
      },
      undoFailed: (to, from, notice) => {
        const again = btn({ label: 'Try again', variant: 'outline', size: 'xs', onClick: () => {
          if (core.busyId() !== null) return;
          again.set({ loading: true });
          void core.undo(to, from);
        } });
        const dismiss = btn({ label: 'Dismiss', variant: 'ghost', size: 'xs', onClick: () => {
          noticeButtons = [];
          notices.setTransient('restore', null);
          options.focusWall();
        } });
        // No timer: the failure stays until it is dismissed or the view closes. The Undo that had focus is gone, so Try again takes it.
        showNotice('error', notice.title, notice.body, [again, dismiss]);
        again.el.focus();
      },
    },
  });

  return { restore: core.restore, busyId: core.busyId, dispose: core.dispose };
};
