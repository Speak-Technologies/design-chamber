// The wall: an infinite pan/zoom surface of artboards (screens × viewports), each a sandboxed
// design frame. Used by the full-screen canvas page (P2), the page viewer (P6) and the compact
// rail viewer (R2). This file is only the wiring: it builds the controllers below in dependency
// order and exposes them as the `WallHandle`.
//
// `presentation: 'page'` is the same machinery with one frame shown like a browser tab: no pan,
// no zoom, no label row. The frame fills the stage (Full width) or sits at a viewport's width,
// shrunk to fit and centred; the camera comes from `pageCamera`. Pins work the same way.
//
// Modules (all in this folder unless noted; imports point one way, later wiring uses `late`):
//   wall-types.ts         Board, Artboard, WallOptions: the types everything shares
//   wall-context.ts       shared state (design, mode, version, page view…) and read-only getters
//   camera-controller.ts  pan/zoom state, fit, page layout, surface size, covered insets
//   popover-layer.ts      the open composer or thread card
//   pin-layer.ts          pins and count badges
//   hit-controller.ts     hover outlines and click-to-comment hit tests
//   pick-layer.ts         a picked element: what the frame and the file say about editing its text
//   board-set.ts          artboards: layout, frames, placeholders, labels (status), live budget
//   frame-messages.ts     what a message from a design frame does
//   input-controller.ts   keyboard, wheel, pointer; decisions come from ../model/wall-input.ts

import type { Camera } from '../../guest/camera.ts';
import { anchorStatesOf } from '../../guest/anchoring.ts';
import { createSourceCache } from '../../guest/source-cache.ts';
import type { DesignDetailResponse } from '../../shared/api.ts';
import type { AnchorState } from '../../shared/types.ts';
import type { BridgeMode, FrameToPageMessage, TokenVar } from '../../shared/bridge-protocol.ts';
import { createBoardSet } from './board-set.ts';
import { createCameraController, type CameraHooks } from './camera-controller.ts';
import { createFrameMessageHandler } from './frame-messages.ts';
import { setSlotTokens, slotTokens } from './frame-slot.ts';
import { createHitController } from './hit-controller.ts';
import { createInputController, type InputController } from './input-controller.ts';
import { createPickLayer } from './pick-layer.ts';
import { createPinLayer } from './pin-layer.ts';
import { createPopoverLayer } from './popover-layer.ts';
import { createReorderController } from './reorder-controller.ts';
import { createListeners } from '../model/listeners.ts';
import { panBy } from '../../guest/camera.ts';
import { revealPan } from '../model/screens-model.ts';
import { feed, store } from '../guest.ts';
import { createWallContext, late } from './wall-context.ts';
import type { Rect, Board, BoardLookup, ScreenMenuPress, ScreenMove, WallOptions, WallPick, WallSelectionEvent } from './wall-types.ts';
import type { PickCheck } from '../model/edit-text-model.ts';

export type { ScreenMenuPress, ScreenMove, WallOptions, WallPick, WallSelection, WallSelectionEvent } from './wall-types.ts';

export type WallHandle = {
  el: HTMLElement;
  /** The layer over the wall where cards float (surface px); the edit feature puts its toolbar and editor here. */
  overlay: HTMLElement;
  /** The surface's size in CSS px. */
  size: () => { width: number; height: number };
  setDetail: (detail: DesignDetailResponse) => void;
  setMode: (mode: BridgeMode) => void;
  setHiddenViewports: (ids: readonly string[]) => void;
  /** Page presentation: show Full width (`PAGE_FILL_VIEWPORT_ID`) or one viewport's width. */
  setPageView: (id: string) => void;
  /** Ids of comments whose element was not found in the current document. */
  detachedIds: () => ReadonlySet<string>;
  /** Anchor state of every pin a loaded artboard has placed, for the revision prompt. */
  anchorStates: () => Record<string, AnchorState>;
  /** Remote URLs the loaded documents referenced (blocked inside designs). */
  externalRefs: () => string[];
  /** Show a saved version (read only); `compare` splits each artboard: version left, current right. */
  setVersion: (version: string | null, compare: boolean) => void;
  setShowPins: (show: boolean) => void;
  /** Reload the artboards of these sources (screen ids; null = the page); all when omitted. Unwritten or failed artboards always retry. */
  reload: (sources?: ReadonlySet<string | null>) => void;
  zoomStep: (factor: number) => void;
  zoomReset: () => void;
  fit: () => void;
  /** Fit again unless the user moved the camera (the covered area changed). */
  refit: () => void;
  getCamera: () => Camera;
  /** Bring a comment's pin into view and open its thread. */
  focusComment: (id: string) => void;
  focus: () => void;
  /**
   * Seam S4 (ask bar): the element selection changed (`selected`, `commented`, `cleared`). The
   * listener list is live now; the events start firing when the ask branch fills in `popover-layer`.
   * Returns the unsubscribe function.
   */
  onSelection: (listener: (event: WallSelectionEvent) => void) => () => void;
  /** Seam S4: forget the selected element (the ask bar's chip was removed). */
  clearSelection: () => void;
  /**
   * Edit text (Phase 2 §3.5), read-only seams: an element was picked (click, or double-click for `edit`).
   * The wall asks the frame and reads the file; nothing here writes.
   */
  onPick: (listener: (pick: WallPick) => void) => () => void;
  /** The camera or a frame's scroll moved: anchored chrome follows (or closes). */
  onMoved: (listener: () => void) => () => void;
  /** Ctrl/⌘+Z was pressed on the wall. */
  onUndoEdit: (listener: () => void) => () => void;
  /** The picked element's box in surface px at the current camera. */
  pickBox: (pick: WallPick) => Rect;
  /** Ask the frame and the file again at the pick's point (after a stale refusal). */
  recheckPick: (pick: WallPick) => Promise<PickCheck>;
  /** Outline the picked element, or hide the outline with `null`. */
  ringPick: (pick: WallPick | null) => void;
  /** Open the comment composer for a pick, or focus it when it is already open. */
  openComment: (pick: WallPick) => void;
  /** The open comment card, if any (the toolbar sits next to it). */
  cardEl: () => HTMLElement | null;
  /** Close the open comment card unless it holds text the user typed. */
  closeEmptyCard: () => void;
  /** Close the open card whatever it holds. */
  closeCard: () => void;
  /** The inline editor opened or closed: while it is open the wall ignores presses and hover. */
  setEditing: (editing: boolean) => void;
  /**
   * Tweaks preview (Phase 2 §4.4): wear these custom properties on every frame, on top of tokens.css, without a reload;
   * `[]` clears. Posts once per animation frame however fast a slider moves; a frame that loads later reads it too.
   */
  setTokenPreview: (vars: readonly TokenVar[]) => void;
  /** Seam S5 (build strip): highlight the boards of these sources (screen ids; null = the page); null clears. */
  markRecent: (sources: ReadonlySet<string | null> | null) => void;
  /**
   * Screen management (Phase 2 §5.4), read-only seams like `onPick`: the wall reports a press on a screen's ⋯ button, on the
   * "+ Screen" board, and a label dropped in a new place; the screens feature turns them into requests.
   */
  onScreenMenu: (listener: (press: ScreenMenuPress) => void) => () => void;
  onGhost: (listener: (anchor: HTMLElement) => void) => () => void;
  onReorder: (listener: (move: ScreenMove) => void) => () => void;
  /** A screen action is running: the ⋯ buttons and dragging are off, and the screen it is about (if any) shows progress. */
  setScreensBusy: (busy: { id: string | null } | null) => void;
  /** Pan the least that shows a screen's whole row (a moved or copied one); no zoom change. */
  revealScreen: (id: string) => void;
  dispose: () => void;
};

export const createWall = (options: WallOptions, initialDetail: DesignDetailResponse): WallHandle => {
  const ctx = createWallContext(options, initialDetail);
  const { pageMode, surface } = ctx;

  // Wiring order: context → camera → popovers → pins → hit → boards → input → frame messages.
  // These four are the only forward references; each is bound below, before the first use.
  const hooks = late<CameraHooks>('the camera hooks');
  const boardLookup = late<BoardLookup>('the board set');
  const input = late<InputController>('the input controller');
  const frameMessage = late<(board: Board, message: FrameToPageMessage) => void>('the frame message handler');

  const camera = createCameraController(ctx, hooks);
  const selection = createListeners<[WallSelectionEvent]>();
  const popovers = createPopoverLayer(ctx, camera, { emitSelection: selection.emit });
  // The source behind an Edit text check: one fetch per selection burst, dropped when the file changes (guest/source-cache.ts).
  const sources = createSourceCache({ load: (slug, screen) => store.loadSource(slug, screen) });
  ctx.scope.add(feed.subscribe((batch) => sources.applyChanges(batch)));
  ctx.scope.add(sources.clear);
  const picks = createPickLayer(ctx, {
    camera,
    warm: (screen) => void sources.get(options.slug, screen).catch(() => undefined),
    dropSources: sources.clear,
  });
  const undoEdit = createListeners();
  const screenMenu = createListeners<[ScreenMenuPress]>();
  const ghostPress = createListeners<[HTMLElement]>();
  const reorders = createListeners<[ScreenMove]>();
  const pins = createPinLayer(ctx, camera, popovers, boardLookup);
  const hit = createHitController(ctx, { camera, popovers, picks, boards: boardLookup, isPanning: () => input().isPanning() });
  const boards = createBoardSet(ctx, {
    camera,
    pins,
    popovers,
    onFrameMessage: (board, message) => frameMessage()(board, message),
    onScreenMenu: screenMenu.emit,
    onGhost: ghostPress.emit,
  });
  boardLookup.bind(boards);
  const reorder = createReorderController(ctx, { camera, boards, onDrop: reorders.emit });
  hooks.bind({
    closePopover: () => {
      popovers.close();
      picks.notifyMoved();
    },
    clearHover: hit.clearHover,
    bounds: boards.bounds,
    rebuildLayout: boards.rebuild,
    placeLabels: boards.placeLabels,
    scaleChanged: pins.scaleChanged,
    queueSync: boards.queueSync,
  });
  const inputController = createInputController(ctx, { camera, boards, popovers, hit, onUndoEdit: undoEdit.emit, reorder });
  input.bind(inputController);
  // The handler reads sources through the view's cache and can reach nothing that writes (E1, see frame-messages.ts).
  frameMessage.bind(
    createFrameMessageHandler(ctx, { camera, hit, popovers, picks, load: boards.load, shortcut: inputController.shortcut }, { loadSource: (slug, screen) => sources.get(slug, screen ?? null) }),
  );

  boards.rebuild();
  camera.apply();

  let previewFrame = 0;

  return {
    el: surface,
    overlay: ctx.overlay,
    size: ctx.size,
    setDetail: (next) => {
      const structureChanged =
        JSON.stringify(next.design.screens) !== JSON.stringify(ctx.detail.design.screens) ||
        JSON.stringify(next.design.viewports) !== JSON.stringify(ctx.detail.design.viewports) ||
        next.design.kind !== ctx.detail.design.kind;
      ctx.detail = next;
      if (structureChanged) {
        boards.rebuild();
        if (ctx.surfaceSize.w > 0) camera.quietFit();
        camera.apply();
      }
      pins.paintAll();
      for (const board of boards.values()) boards.paintLabel(board);
      popovers.refresh();
    },
    setMode: (next) => {
      if (next === ctx.mode) return;
      ctx.mode = next;
      surface.dataset.mode = ctx.mode;
      popovers.close();
      hit.clearHover();
      for (const board of boards.values()) {
        if (ctx.mode === 'edit' && board.screenId !== (board.art.screen?.id ?? null)) boards.reset(board);
        board.main.post({ type: 'set-mode', mode: ctx.frameMode() });
        pins.paint(board);
      }
      // The "+ Screen" board and the screens' ⋯ buttons are Edit mode's (the camera stays where it is).
      boards.rebuild();
    },
    setHiddenViewports: (ids) => {
      if (pageMode) return;
      ctx.hidden = new Set(ids);
      boards.rebuild();
      camera.quietFit();
      camera.apply();
    },
    setVersion: (next, nextCompare) => {
      ctx.version = next;
      ctx.compare = nextCompare && next !== null;
      surface.dataset.readonly = ctx.readOnly() ? 'true' : 'false';
      popovers.close();
      for (const board of boards.values()) {
        board.screenId = board.art.screen?.id ?? null;
        board.scroll = { x: 0, y: 0 };
        if (board.live) void boards.load(board);
        pins.paint(board);
      }
      // An old version has no "+ Screen" board, and its screen menus say so.
      boards.rebuild();
    },
    setPageView: (id) => {
      if (!pageMode || id === ctx.pageView) return;
      ctx.pageView = id;
      popovers.close();
      hit.clearHover();
      if (ctx.surfaceSize.w > 0) camera.layoutPage();
    },
    externalRefs: () => [...new Set([...boards.values()].flatMap((board) => board.main.meta()?.external ?? []))],
    detachedIds: () => {
      const ids = new Set<string>();
      for (const board of boards.values()) if (board.live) for (const placement of board.placements) if (placement.state === 'detached') ids.add(placement.commentId);
      return ids;
    },
    anchorStates: () => anchorStatesOf([...boards.values()].filter((board) => board.live).flatMap((board) => board.placements)),
    setShowPins: (show) => {
      ctx.showPins = show;
      for (const board of boards.values()) pins.paint(board);
    },
    reload: (sources) => {
      for (const board of boards.values()) {
        const state = board.main.state();
        const affected = sources === undefined || sources.has(board.art.screen?.id ?? null) || state === 'missing' || state === 'error';
        if (affected && board.live) void boards.load(board);
      }
    },
    zoomStep: (factor) => {
      if (!pageMode) camera.zoomAtCentre(factor);
    },
    zoomReset: () => {
      if (!pageMode) camera.zoomReset();
    },
    fit: () => {
      if (!pageMode) camera.fit();
      else if (ctx.surfaceSize.w > 0) camera.layoutPage();
    },
    refit: () => {
      if (ctx.surfaceSize.w === 0) return;
      // A drawer opened or closed over the page: the frame makes room for it.
      if (pageMode) camera.layoutPage();
      else if (camera.quietFit()) camera.apply();
    },
    getCamera: () => camera.get(),
    focusComment: (id) => {
      const comment = ctx.comments().find((candidate) => candidate.id === id);
      if (!comment) return;
      if (pageMode) {
        const page = boards.first();
        if (!page) return;
        // Scroll the pinned element to the upper third of the frame, then open its thread.
        const placement = page.placements.find((entry) => entry.commentId === id);
        if (placement && page.main.state() === 'ready') page.main.post({ type: 'scroll-to', x: page.scroll.x, y: Math.max(0, placement.point.y - page.art.rect.h / 3) });
        setTimeout(() => {
          if (!ctx.disposed && boards.get(page.art.id) === page) popovers.openThread(page, id);
        }, 200);
        return;
      }
      const board = boards.forComment(comment);
      if (!board) return;
      camera.focusBoard(board);
      setTimeout(() => {
        if (!ctx.disposed) popovers.openThread(board, id);
      }, 120);
    },
    focus: () => surface.focus({ preventScroll: true }),
    onSelection: selection.add,
    onPick: picks.onPick,
    onMoved: picks.onMoved,
    onUndoEdit: undoEdit.add,
    pickBox: picks.box,
    recheckPick: picks.recheck,
    ringPick: picks.ring,
    openComment: (pick) => {
      const open = popovers.current();
      if (open?.commentId === null) open.card.focus();
      else popovers.openComposer(pick.board, pick.element, pick.framePoint);
    },
    cardEl: () => popovers.current()?.card.el ?? null,
    closeEmptyCard: () => popovers.clearSelection(),
    closeCard: () => popovers.close(),
    setEditing: (editing) => {
      ctx.editing = editing;
      if (editing) hit.clearHover();
    },
    clearSelection: () => popovers.clearSelection(),
    markRecent: (sources) => boards.markRecent(sources),
    setTokenPreview: (vars) => {
      setSlotTokens(options.slug, vars);
      if (previewFrame !== 0) return;
      previewFrame = requestAnimationFrame(() => {
        previewFrame = 0;
        if (ctx.disposed) return;
        const latest = [...slotTokens(options.slug)];
        for (const board of boards.values()) board.main.post({ type: 'set-tokens', vars: latest });
      });
    },
    onScreenMenu: screenMenu.add,
    onGhost: ghostPress.add,
    onReorder: reorders.add,
    setScreensBusy: (busy) => {
      ctx.screensBusy = busy;
      for (const board of boards.values()) boards.paintLabel(board);
    },
    revealScreen: (id) => {
      const box = boards.rowBox(id);
      if (!box || ctx.surfaceSize.w === 0) return;
      const current = camera.get();
      const covered = camera.coveredInsets();
      const pan = revealPan(
        { x: current.x + box.x * current.scale, y: current.y + box.y * current.scale, w: box.w * current.scale, h: box.h * current.scale },
        { w: ctx.surfaceSize.w - covered.right, h: ctx.surfaceSize.h - covered.bottom },
        options.compact ? 12 : 32,
      );
      if (pan.dx !== 0 || pan.dy !== 0) camera.set(panBy(current, pan.dx, pan.dy), true);
    },
    dispose: () => {
      ctx.disposed = true;
      cancelAnimationFrame(previewFrame);
      setSlotTokens(options.slug, []);
      reorder.dispose();
      popovers.close();
      picks.dispose();
      camera.dispose();
      hit.dispose();
      ctx.scope.dispose();
      boards.dispose();
      surface.remove();
    },
  };
};
