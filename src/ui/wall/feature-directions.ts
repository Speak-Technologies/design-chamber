// Phase 2 feature mount (seam S9): keeping one direction (feature 11, technical design §6.2, §6.3). The wall draws a direction
// row (board-set.ts: Current and the agent's A, B, C, each with "Keep this one", a header with Show at) and reports a press on
// Keep; this file turns that press into one request, `keep-direction` through `store.applyEdit`, and says what happened.
//
// Like the screens feature it is the only place that starts the write, and only from the user's own click (E1): no message
// from a design frame reaches it. The service moves the others to the trash (so nothing is lost), puts the kept screen's
// file in the original's place and answers a label the notice shows with Undo. The wall goes back to a normal row once the
// refreshed design no longer has the marks. Asking for directions ("Try 3 directions…") lives in feature-screens.ts.

import { errorText } from '../components/dom.ts';
import { createEditNotice } from '../components/edit-notice.ts';
import { store } from '../guest.ts';
import { keepRequest, keptNotice, planDirections } from '../model/directions-model.ts';
import { NO_DESIGN_JSON_MESSAGE } from '../../shared/screen-ops.ts';
import { undoSlotFor } from './feature-undo.ts';
import type { FeatureMount } from './view-context.ts';
import type { DirectionKeepPress } from './wall-types.ts';

/** The sentence when the row the user pressed on is no longer a row (the agent changed the marks since the wall drew it). */
const ROW_CHANGED_MESSAGE = 'The directions changed while you were looking. Nothing was changed.';

export const mount: FeatureMount = (ctx) => {
  // A page has no screens, so no directions.
  if (ctx.isPage) return () => undefined;
  const { wall, slug } = ctx;
  let disposed = false;
  const undoSlot = undoSlotFor(wall);

  const notice = createEditNotice({
    notices: ctx.notices,
    undo: async (editId) => {
      await store.undoEdit(slug, editId);
    },
    onNoticeUndo: undoSlot.noticeUndo,
    focusWall: () => wall.focus(),
    viewing: () => ctx.viewing() !== null,
    onViewing: ctx.onViewing,
  });

  /** Bring the wall up to date now rather than when the service's event arrives; a failure here is not the user's to handle. */
  const refresh = async (): Promise<void> => {
    try {
      await store.refreshOpenDesign();
    } catch {
      // The service's change event refreshes it a moment later.
    }
  };

  const keep = async (press: DirectionKeepPress): Promise<void> => {
    // An old version is on show: the buttons are hidden, and a press that still got here sends nothing (E12).
    if (ctx.viewing() !== null) return;
    const detail = ctx.detail();
    const row = planDirections(detail.design.screens, detail.design.viewports, () => undefined).rows.get(press.of);
    const kept = row === undefined ? undefined : [row.root, ...row.members].find((screen) => screen.id === press.keep);
    const failTitle = kept?.direction ? `Couldn’t keep direction ${kept.direction.letter}` : 'Couldn’t keep the current screen';
    if (detail.screensStamp === null) {
      notice.failed(failTitle, NO_DESIGN_JSON_MESSAGE);
      return;
    }
    if (row === undefined || kept === undefined) {
      notice.failed(failTitle, ROW_CHANGED_MESSAGE);
      void refresh();
      return;
    }
    // The pressed board's label spins and every other Keep and menu go off until the answer is back.
    wall.setScreensBusy({ id: press.keep });
    try {
      const response = await store.applyEdit(slug, keepRequest({ stamp: detail.screensStamp, row, keep: press.keep, files: detail.files.screens }));
      if (disposed) return;
      if (response.edit.undoable) undoSlot.edited(response.edit.id);
      notice.saved(keptNotice(response.edit));
      await refresh();
      if (!disposed) wall.focus();
    } catch (error) {
      if (disposed) return;
      notice.failed(failTitle, errorText(error));
      // A refusal because a direction was written or the list changed means the wall is behind: show what is true now.
      void refresh();
    } finally {
      if (!disposed) wall.setScreensBusy(null);
    }
  };

  const offKeep = ctx.onKeepDirection((press) => void keep(press));

  return () => {
    disposed = true;
    offKeep();
    notice.dispose();
  };
};
