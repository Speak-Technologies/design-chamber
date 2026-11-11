// The notice after a hand edit (Phase 2 technical design §2.7): "<what changed>" with **Undo** for
// ten seconds, in the notices region next to the restore and export notices. Undo is one request;
// it ends as "Undone" (five seconds, there is no undo of the undo) or as the service's refusal
// sentence in an error notice that stays until it is dismissed (the refusal is final, so no retry).
// Shared by every hand edit (text now; tweaks and screens use it as they land); the flow reports
// its own errors and never rejects.

import { USER_EDIT_NOTICE_MS } from '../../shared/limits.ts';
import { UNDONE_TEXT } from '../model/edit-text-model.ts';
import { UNDO_VIEWING_TEXT } from '../model/wall-input.ts';
import { errorText, h } from './dom.ts';
import { banner, bannerWithActions, btn } from './kit.ts';
import type { NoticesHandle } from './notices.ts';

/** "Undone" stays this long. */
export const UNDONE_NOTICE_MS = 5000;

export type EditNoticeOptions = {
  notices: NoticesHandle;
  /** Send the undo (`store.undoEdit`); rejects with the service's sentence. */
  undo: (editId: string) => Promise<void>;
  /** Undo was pressed on a notice's own button for this edit (the view's undo slot empties). */
  onNoticeUndo: (editId: string) => void;
  /** Where focus goes when the button that had it is gone. */
  focusWall: () => void;
  /** E12: an old version is on show; the notice's Undo is off while it is, and says why. */
  viewing: () => boolean;
  /** Called when `viewing` may have changed; returns the unsubscribe function. */
  onViewing: (listener: () => void) => () => void;
};

export type EditNotice = {
  /** A hand edit went through: its title, and Undo when the service kept an undo record. */
  saved: (edit: { id: string; label: string; undoable: boolean }) => void;
  /** Undo from the keyboard: the same notices as the button, without a button to spin. */
  undo: (editId: string) => Promise<void>;
  /** The keyboard Undo was refused (an old version is on show): `sentence` says so for a few seconds. The edit stays undoable. */
  refused: (sentence: string) => void;
  dispose: () => void;
};

export const createEditNotice = (options: EditNoticeOptions): EditNotice => {
  const { notices } = options;
  let disposed = false;
  // The Undo button of the notice on show follows the viewing state until the notice is replaced or the view closes.
  let offViewing: (() => void) | null = null;

  const keepFocus = (): void => {
    const active = document.activeElement;
    if (!active || active === document.body) options.focusWall();
  };

  const run = async (editId: string, spinner: { set: (next: { loading: boolean }) => void } | null): Promise<void> => {
    spinner?.set({ loading: true });
    try {
      await options.undo(editId);
      if (disposed) return;
      notices.setTransient('edit', banner({ tone: 'success', title: UNDONE_TEXT }), UNDONE_NOTICE_MS);
      options.focusWall();
    } catch (error) {
      if (disposed) return;
      const dismiss = btn({
        label: 'Dismiss',
        variant: 'ghost',
        size: 'xs',
        onClick: () => {
          notices.setTransient('edit', null);
          options.focusWall();
        },
      });
      const wrap = h('div', { class: 'dc-banner dc-edit-notice', 'data-actions': 'stack' });
      wrap.append(...bannerWithActions('error', 'Couldn’t undo that edit', [errorText(error)], [dismiss.el]));
      // No timer: the sentence stays until it is dismissed. The Undo that had focus is gone, so Dismiss takes it.
      notices.setTransient('edit', wrap);
      dismiss.el.focus();
    }
  };

  return {
    saved: (edit) => {
      const wrap = h('div', { class: 'dc-banner dc-edit-notice', 'data-actions': 'stack' });
      const buttons: HTMLElement[] = [];
      if (edit.undoable) {
        const undoButton = btn({
          label: 'Undo',
          variant: 'outline',
          size: 'xs',
          title: 'Undo this edit',
          onClick: () => {
            options.onNoticeUndo(edit.id);
            void run(edit.id, undoButton);
          },
        });
        buttons.push(undoButton.el);
        // E12: an old version on show turns Undo off and says why (the keyboard is refused in the wall's undo decision).
        offViewing?.();
        const sync = (): void => {
          const viewing = options.viewing();
          undoButton.set({ disabled: viewing, title: viewing ? UNDO_VIEWING_TEXT : 'Undo this edit' });
          const body = wrap.querySelector<HTMLElement>('.oc-sdk-banner-body');
          if (!body) return;
          body.textContent = viewing ? UNDO_VIEWING_TEXT : '';
          body.hidden = !viewing;
        };
        offViewing = options.onViewing(sync);
      }
      wrap.append(...bannerWithActions('success', edit.label, [], buttons));
      notices.setTransient('edit', wrap, USER_EDIT_NOTICE_MS);
      keepFocus();
    },
    undo: (editId) => run(editId, null),
    refused: (sentence) => {
      notices.setTransient('edit', banner({ tone: 'warning', title: sentence }), UNDONE_NOTICE_MS);
      keepFocus();
    },
    dispose: () => {
      disposed = true;
      offViewing?.();
    },
  };
};
