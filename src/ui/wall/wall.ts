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
//   board-set.ts          artboards: layout, frames, placeholders, labels (status), live budget
//   frame-messages.ts     what a message from a design frame does
//   input-controller.ts   keyboard, wheel, pointer; decisions come from ../model/wall-input.ts

import type { Camera } from '../../guest/camera.ts';
import { anchorStatesOf } from '../../guest/anchoring.ts';
import type { DesignDetailResponse } from '../../shared/api.ts';
import type { AnchorState } from '../../shared/types.ts';
import type { BridgeMode, FrameToPageMessage } from '../../shared/bridge-protocol.ts';
import { createBoardSet } from './board-set.ts';
import { createCameraController, type CameraHooks } from './camera-controller.ts';
import { createFrameMessageHandler } from './frame-messages.ts';
import { createHitController } from './hit-controller.ts';
import { createInputController, type InputController } from './input-controller.ts';
import { createPinLayer } from './pin-layer.ts';
import { createPopoverLayer } from './popover-layer.ts';
import { createListeners } from '../model/listeners.ts';
import { createWallContext, late } from './wall-context.ts';
import type { Board, BoardLookup, WallOptions, WallSelectionEvent } from './wall-types.ts';

export type { WallOptions, WallSelection, WallSelectionEvent } from './wall-types.ts';

export type WallHandle = {
  el: HTMLElement;
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
  /** Seam S5 (build strip): highlight the boards of these sources (screen ids; null = the page); null clears. */
  markRecent: (sources: ReadonlySet<string | null> | null) => void;
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
  const pins = createPinLayer(ctx, camera, popovers, boardLookup);
  const hit = createHitController(ctx, { camera, popovers, boards: boardLookup, isPanning: () => input().isPanning() });
  const boards = createBoardSet(ctx, { camera, pins, popovers, onFrameMessage: (board, message) => frameMessage()(board, message) });
  boardLookup.bind(boards);
  hooks.bind({
    closePopover: popovers.close,
    clearHover: hit.clearHover,
    bounds: boards.bounds,
    rebuildLayout: boards.rebuild,
    placeLabels: boards.placeLabels,
    scaleChanged: pins.scaleChanged,
    queueSync: boards.queueSync,
  });
  const inputController = createInputController(ctx, { camera, boards, popovers, hit });
  input.bind(inputController);
  frameMessage.bind(createFrameMessageHandler(ctx, { camera, hit, popovers, load: boards.load, shortcut: inputController.shortcut }));

  boards.rebuild();
  camera.apply();

  return {
    el: surface,
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
    clearSelection: () => popovers.clearSelection(),
    markRecent: (sources) => boards.markRecent(sources),
    dispose: () => {
      ctx.disposed = true;
      popovers.close();
      camera.dispose();
      hit.dispose();
      ctx.scope.dispose();
      boards.dispose();
      surface.remove();
    },
  };
};
