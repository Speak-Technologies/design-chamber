// Phase 2 feature mount (seam S9): screen management (feature 10). It listens to what the wall reports
// (a press on a screen's ⋯ button, on the "+ Screen" board, a label dropped in a new place) and turns it
// into one request: Duplicate, Move up, Move down, Move to trash and a drag are hand edits through
// `store.applyEdit`; "+ Screen" and Try 3 directions are asks to the linked chat, not writes. The rules
// (what is on offer, why an entry is off, the orders, the counter) are in `model/screens-model.ts`; this
// file wires them to the wall, the store, the notices and the ask flow.
//
// Like Edit text it is the only place that starts a write, and only from the user's own click or drop (E1):
// no message from a design frame reaches it. Every answer is spoken through the notices region (a live
// region): the service's label ("Moved Checkout above Pricing") on success, a sentence on failure.

import { phaseOf } from '../../guest/build-activity.ts';
import { directionsAsk, newScreenAsk } from '../../shared/agent/screen-asks.ts';
import type { EditRequest, EditResponse } from '../../shared/api.ts';
import { SCREENS_MAX } from '../../shared/limits.ts';
import { NO_DESIGN_JSON_MESSAGE } from '../../shared/screen-ops.ts';
import type { FileStatus } from '../../shared/types.ts';
import { toast } from '../components/actions.ts';
import { openAskPopover } from '../components/ask-popover.ts';
import { errorText } from '../components/dom.ts';
import { createEditNotice } from '../components/edit-notice.ts';
import { openMenu } from '../components/kit.ts';
import { flows, guestHost, store } from '../guest.ts';
import { askRequestToast, askTarget } from '../model/ask-bar-model.ts';
import { agentIsWorking } from '../model/edit-text-model.ts';
import { directionsOffReason, moveRowToGap, planDirections, type DirectionPlan } from '../model/directions-model.ts';
import { directionsRoom, newScreenRoom, screenMenu, shiftOrder, type ScreenGate } from '../model/screens-model.ts';
import { buildActivityFor } from './feature-build-strip.ts';
import { undoSlotFor } from './feature-undo.ts';
import type { FeatureMount } from './view-context.ts';
import type { ScreenMove } from './wall-types.ts';

/** A screen file's size and mtime as the service wants them back (it refuses the copy or the move when the file changed). */
const stampOf = (status: FileStatus | undefined): { size: number; mtime: FileStatus['mtime'] } | null => (status !== undefined && status.exists ? { size: status.size, mtime: status.mtime } : null);

const NEW_SCREEN_TITLE = 'What should the new screen show?';
const DIRECTIONS_TITLE = 'What should the directions explore? (optional)';

export const mount: FeatureMount = (ctx) => {
  // A page has no screens (10-5).
  if (ctx.isPage) return () => undefined;
  const { wall, slug } = ctx;
  let disposed = false;
  let askBox: { close: () => void } | null = null;
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

  const agentWorking = (): boolean => {
    const watcher = buildActivityFor(wall);
    return watcher !== undefined && agentIsWorking(phaseOf(watcher.get(), Date.now()));
  };

  const gate = (): ScreenGate => {
    const detail = ctx.detail();
    return { viewing: ctx.viewing() !== null, designJson: detail.designJson, listInvalid: detail.warnings.some((warning) => warning.code === 'invalid-screens') };
  };

  /** Bring the wall up to date now rather than when the service's event arrives; a failure here is not the user's to handle. */
  const refresh = async (): Promise<void> => {
    try {
      await store.refreshOpenDesign();
    } catch {
      // The service's change event refreshes it a moment later.
    }
  };

  // ---------------------------------------------------------------- hand edits

  type Action = { request: EditRequest; failTitle: string; reveal: (response: EditResponse) => string | null };

  /** One request at a time; the row it is about shows progress and the wall refuses menus and drags until it is done. */
  const run = async (screenId: string, action: Action): Promise<void> => {
    if (ctx.viewing() !== null) return;
    wall.setScreensBusy({ id: screenId });
    try {
      const response = await store.applyEdit(slug, action.request);
      if (disposed) return;
      if (response.edit.undoable) undoSlot.edited(response.edit.id);
      notice.saved(response.edit);
      await refresh();
      if (disposed) return;
      const reveal = action.reveal(response);
      if (reveal === null) wall.focus();
      else wall.revealScreen(reveal);
    } catch (error) {
      if (disposed) return;
      notice.failed(action.failTitle, errorText(error));
      // A refusal because the list changed means the wall is behind: show what is true now.
      void refresh();
    } finally {
      if (!disposed) wall.setScreensBusy(null);
    }
  };

  const stampOrNotice = (failTitle: string): string | null => {
    const stamp = ctx.detail().screensStamp;
    if (stamp === null) notice.failed(failTitle, NO_DESIGN_JSON_MESSAGE);
    return stamp;
  };

  const titleOf = (id: string): string => ctx.detail().design.screens.find((screen) => screen.id === id)?.title ?? id;

  const reorder = (move: ScreenMove, failTitle: string): void => {
    const stamp = stampOrNotice(failTitle);
    if (stamp === null) return;
    void run(move.id, { request: { op: 'reorder', screens: stamp, order: move.order }, failTitle, reveal: () => move.id });
  };

  /** The direction rows of the current list: a direction is not a row of its own (§6.3), so a row's neighbours skip them. */
  const directionPlan = (): DirectionPlan => {
    const { design } = ctx.detail();
    return planDirections(design.screens, design.viewports, () => undefined);
  };

  const shift = (id: string, direction: 'up' | 'down'): void => {
    const { screens } = ctx.detail().design;
    const ids = screens.map((screen) => screen.id);
    const plan = directionPlan();
    let order: string[] | null;
    if (plan.rows.size === 0) order = shiftOrder(ids, id, direction);
    else {
      // A row that has directions takes them along, and a move passes over other rows' directions.
      const rowIds = ids.filter((one) => !plan.memberOf.has(one));
      const at = rowIds.indexOf(id);
      const moving = new Set([id, ...(plan.rows.get(id)?.members.map((member) => member.id) ?? [])]);
      order = at < 0 ? null : moveRowToGap(ids, rowIds, id, moving, direction === 'up' ? at - 1 : at + 2);
    }
    if (order !== null) reorder({ id, order }, `Couldn’t move ${titleOf(id)}`);
  };

  const duplicate = (id: string): void => {
    const failTitle = `Couldn’t duplicate ${titleOf(id)}`;
    const stamp = stampOrNotice(failTitle);
    const file = stampOf(ctx.detail().files.screens[id]);
    if (stamp === null) return;
    // The menu already says "Nothing to copy until the agent writes this screen." This is for a file that went since.
    if (file === null) {
      notice.failed(failTitle, 'Nothing to copy until the agent writes this screen.');
      return;
    }
    void run(id, { request: { op: 'duplicate', screens: stamp, id, file }, failTitle, reveal: (response) => response.created?.id ?? id });
  };

  const trash = (id: string): void => {
    const failTitle = `Couldn’t move ${titleOf(id)} to trash`;
    const stamp = stampOrNotice(failTitle);
    if (stamp === null) return;
    void run(id, { request: { op: 'trash-screen', screens: stamp, id, file: stampOf(ctx.detail().files.screens[id]) }, failTitle, reveal: () => null });
  };

  // ---------------------------------------------------------------- asks

  const target = (): string => {
    const session = guestHost.session.get();
    return askTarget({ sessionId: ctx.detail().design.sessionId, selectedId: session?.id ?? null, selectedTitle: session?.title ?? null });
  };

  const closeAskBox = (): void => {
    askBox?.close();
    askBox = null;
  };

  const sent = (outcome: Parameters<typeof askRequestToast>[0]): void => {
    const said = askRequestToast(outcome);
    if (said !== null) toast('success', said);
  };

  const askForScreen = (anchor: HTMLElement): void => {
    closeAskBox();
    const facts = () => {
      const { design } = ctx.detail();
      const last = design.screens[design.screens.length - 1];
      return { title: design.title, after: last?.title ?? null, free: Math.max(0, SCREENS_MAX - design.screens.length) };
    };
    const box = openAskPopover({
      host: ctx.actions.host,
      anchor,
      title: NEW_SCREEN_TITLE,
      placeholder: 'For example, a thank-you page after checkout.',
      room: newScreenRoom(facts()),
      target: target(),
      send: async (note) => (await flows.ask(slug, { text: newScreenAsk({ ...facts(), note }) })).outcome,
      onSent: sent,
      onClose: () => void (askBox = null),
    });
    askBox = box;
  };

  const askForDirections = (id: string, anchor: HTMLElement): void => {
    closeAskBox();
    const facts = () => ({ title: titleOf(id), id, free: Math.max(0, SCREENS_MAX - ctx.detail().design.screens.length) });
    askBox = openAskPopover({
      host: ctx.actions.host,
      anchor,
      title: DIRECTIONS_TITLE,
      placeholder: 'For example, one denser, one with more imagery.',
      room: directionsRoom(facts()),
      target: target(),
      send: async (note) => (await flows.ask(slug, { text: directionsAsk({ ...facts(), note }) })).outcome,
      onSent: sent,
      onClose: () => void (askBox = null),
    });
  };

  // ---------------------------------------------------------------- wall events

  const offMenu = wall.onScreenMenu(({ screenId, anchor }) => {
    const detail = ctx.detail();
    const screens = detail.design.screens;
    const index = screens.findIndex((screen) => screen.id === screenId);
    if (index < 0) return;
    const plan = directionPlan();
    const rowIds = screens.filter((screen) => !plan.memberOf.has(screen.id)).map((screen) => screen.id);
    const menu = screenMenu({
      ...gate(),
      index,
      count: screens.length,
      rowIndex: rowIds.indexOf(screenId),
      rowCount: rowIds.length,
      hasFile: detail.files.screens[screenId]?.exists === true,
      agentWorking: agentWorking(),
      directionsOff: directionsOffReason(screenId, plan, titleOf),
    });
    openMenu(
      anchor,
      menu.items,
      (id) => {
        if (id === 'duplicate') duplicate(screenId);
        else if (id === 'up' || id === 'down') shift(screenId, id);
        else if (id === 'trash') trash(screenId);
        else if (id === 'directions') askForDirections(screenId, anchor);
      },
      menu.notes,
    );
  });

  const offGhost = wall.onGhost((anchor) => askForScreen(anchor));
  const offReorder = wall.onReorder((move) => reorder(move, `Couldn’t move ${titleOf(move.id)}`));

  // An old version on show: asking the agent about the current screens is off, so the box goes.
  const offViewing = ctx.onViewing(() => {
    if (ctx.viewing() !== null) closeAskBox();
  });

  return () => {
    disposed = true;
    offMenu();
    offGhost();
    offReorder();
    offViewing();
    closeAskBox();
    notice.dispose();
  };
};
