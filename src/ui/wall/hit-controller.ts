// Hover outlines, click-to-comment and double-click-to-edit. All ask the frame "what element is at
// this point?" (`hit-test`) and act on the answer: a hover paints the outline, a click opens the
// composer, and both a click and a double-click start a pick (the toolbar's Edit text check, in
// pick-layer.ts). One request is in flight at a time; the answer is matched to it by artboard and point.

import type { FrameToPageMessage } from '../../shared/bridge-protocol.ts';
import { hitMatches } from '../model/wall-input.ts';
import { screenToFrame, type Point } from '../model/wall-model.ts';
import type { CameraController } from './camera-controller.ts';
import type { PickLayer } from './pick-layer.ts';
import { rectToBox, type PopoverLayer } from './popover-layer.ts';
import type { Late, WallContext } from './wall-context.ts';
import type { Board, BoardLookup } from './wall-types.ts';

/** The fastest the hover asks a frame, ms: a moving pointer would otherwise flood it. */
const HOVER_MIN_INTERVAL = 40;

/** `edit`: a double-click, which opens the text editor directly when the element allows it. */
export type HitPurpose = 'hover' | 'click' | 'edit';

export type HitController = {
  /** Ask a loaded frame what is at a frame point; ignored while the frame is not ready. */
  requestHit: (board: Board, frame: Point, purpose: HitPurpose) => void;
  /** A frame answered a `hit-test`. */
  onHit: (board: Board, message: Extract<FrameToPageMessage, { type: 'hit' }>) => void;
  /** Update the hover outline on the next animation frame (throttled). */
  scheduleHover: () => void;
  clearHover: () => void;
  /** The pointer's last position over the surface, or null once it left. */
  setPointer: (point: Point | null) => void;
  dispose: () => void;
};

export type HitDeps = {
  camera: CameraController;
  popovers: PopoverLayer;
  picks: PickLayer;
  boards: Late<BoardLookup>;
  /** The hover pauses while the user pans the wall. */
  isPanning: () => boolean;
};

export const createHitController = (ctx: WallContext, deps: HitDeps): HitController => {
  const { camera, popovers, picks, boards } = deps;
  let pointer: Point | null = null;
  let hoverTimer = 0;
  let lastHitAt = 0;
  let pendingHit: { board: Board; frame: Point; purpose: HitPurpose } | null = null;
  let hoveredBoard: Board | null = null;

  const requestHit = (board: Board, frame: Point, purpose: HitPurpose): void => {
    if (board.main.state() !== 'ready') return;
    pendingHit = { board, frame, purpose };
    board.main.post({ type: 'hit-test', x: frame.x, y: frame.y });
  };

  const onHit = (board: Board, message: Extract<FrameToPageMessage, { type: 'hit' }>): void => {
    const request = pendingHit;
    if (!request || !hitMatches(request, board, message.x, message.y)) return;
    if (request.purpose === 'click') {
      pendingHit = null;
      if (message.element) {
        const selection = popovers.openComposer(board, message.element, request.frame);
        picks.begin(board, message.element, request.frame, selection, 'click');
      } else ctx.options.onNotice('There is no element there to comment on.');
      return;
    }
    if (request.purpose === 'edit') {
      pendingHit = null;
      // The click that came first already told the user when there is nothing there.
      if (message.element) picks.begin(board, message.element, request.frame, popovers.selectionFor(board, message.element, request.frame), 'edit');
      return;
    }
    if (hoveredBoard !== board || popovers.current()) return;
    if (!message.element) {
      board.hover.hidden = true;
      return;
    }
    rectToBox(board, board.hover, message.element.rect);
    board.hoverTag.textContent = message.element.tag;
    board.hover.hidden = false;
  };

  const clearHover = (): void => {
    for (const board of boards().values()) board.hover.hidden = true;
    hoveredBoard = null;
  };

  const scheduleHover = (): void => {
    if (hoverTimer) return;
    hoverTimer = requestAnimationFrame(() => {
      hoverTimer = 0;
      if (!pointer || ctx.mode !== 'edit' || ctx.readOnly() || ctx.editing || popovers.current() || deps.isPanning()) return;
      const now = performance.now();
      if (now - lastHitAt < HOVER_MIN_INTERVAL) return scheduleHover();
      lastHitAt = now;
      const board = boards().at(pointer);
      if (hoveredBoard && hoveredBoard !== board) hoveredBoard.hover.hidden = true;
      hoveredBoard = board;
      if (board) requestHit(board, screenToFrame(camera.get(), board.art.rect, pointer), 'hover');
    });
  };

  return {
    requestHit,
    onHit,
    scheduleHover,
    clearHover,
    setPointer: (point) => {
      pointer = point;
    },
    dispose: () => cancelAnimationFrame(hoverTimer),
  };
};
