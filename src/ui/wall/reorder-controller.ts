// Drag a screen into a new place (Phase 2 technical design §5.4, 10-6): pointer down on a row's first
// label, then a move past the drag threshold starts the drag. A chip with the screen's name follows the
// pointer, a line between rows shows where it would land, Escape cancels (nothing is sent), and letting go
// reports the new order through `onDrop`. The controller never writes: the screens feature decides what the
// drop means and talks to the store. The keyboard alternative is the screen menu's Move up and Move down.
//
// Full-screen page only: labels in the rail's fit-all view are too small to hit. A press that does not move
// past the threshold is a click, so the label's double-click (focus this artboard) still works.

import { h } from '../components/dom.ts';
import { dropTarget, moveToGap, type DropTarget } from '../model/screens-model.ts';
import { isDrag } from '../model/wall-input.ts';
import { screenToWorld, type Point } from '../model/wall-model.ts';
import type { BoardSet } from './board-set.ts';
import type { CameraController } from './camera-controller.ts';
import type { WallContext } from './wall-context.ts';
import type { Board, ScreenMove } from './wall-types.ts';

export type ReorderController = {
  /** A press on a label. Starts tracking when dragging is allowed here; otherwise does nothing. */
  begin: (board: Board, event: PointerEvent) => void;
  /** A drag has started (the wall leaves hover outlines and comments alone meanwhile). */
  active: () => boolean;
  dispose: () => void;
};

export type ReorderDeps = {
  camera: CameraController;
  boards: BoardSet;
  /** The screen was dropped in a new place. */
  onDrop: (move: ScreenMove) => void;
};

type Press = {
  id: string;
  pointerId: number;
  /** Where the press started, and where the pointer is now (surface px). */
  from: Point;
  at: Point;
  chip: HTMLElement | null;
  line: HTMLElement | null;
  target: DropTarget | null;
  cleanup: () => void;
};

export const createReorderController = (ctx: WallContext, deps: ReorderDeps): ReorderController => {
  let press: Press | null = null;

  /** Edit mode on a canvas, on the full-screen page, with nothing else going on. */
  const allowed = (): boolean => !ctx.pageMode && !ctx.options.compact && ctx.mode === 'edit' && !ctx.readOnly() && ctx.screensBusy === null && !ctx.editing;

  const place = (current: Press, at: Point): void => {
    if (current.chip) current.chip.style.transform = `translate(${Math.round(at.x + 14)}px, ${Math.round(at.y + 10)}px)`;
    const world = screenToWorld(deps.camera.get(), at);
    current.target = dropTarget(deps.boards.rows(), world.y, current.id);
    const { line, target } = current;
    if (!line) return;
    // Dropping where it already is changes nothing, so no line.
    line.hidden = target === null || target.noop;
    if (target === null) return;
    const bounds = deps.boards.bounds();
    line.style.left = `${bounds.x}px`;
    line.style.width = `${bounds.w}px`;
    line.style.top = `${target.y}px`;
  };

  const markDragging = (id: string, on: boolean): void => {
    for (const board of deps.boards.values()) {
      if (board.art.screen?.id !== id) continue;
      for (const part of [board.root, board.label]) {
        if (on) part.dataset.dragging = 'true';
        else delete part.dataset.dragging;
      }
    }
  };

  const finish = (current: Press, drop: boolean): void => {
    if (press !== current) return;
    press = null;
    const target = current.target;
    current.cleanup();
    if (!drop || target === null || target.noop) return;
    const order = moveToGap(
      ctx.screens().map((screen) => screen.id),
      current.id,
      target.gap,
    );
    if (order !== null) deps.onDrop({ id: current.id, order });
  };

  const startDrag = (current: Press, board: Board): void => {
    const screen = board.art.screen;
    current.chip = h('div', { class: 'dc-drag-chip', 'aria-hidden': 'true' }, h('strong', null, screen?.title ?? ''), h('span', null, board.art.viewport.label));
    current.line = h('div', { class: 'dc-drop', 'aria-hidden': 'true', hidden: true });
    ctx.overlay.append(current.chip);
    ctx.world.append(current.line);
    ctx.surface.dataset.reordering = 'true';
    markDragging(current.id, true);
  };

  const begin = (board: Board, event: PointerEvent): void => {
    const screen = board.art.screen;
    if (press || screen === null || event.button !== 0 || !allowed() || !deps.boards.isFirstOfRow(board)) return;
    const label = board.label;
    const from = ctx.local(event);
    const current: Press = { id: screen.id, pointerId: event.pointerId, from, at: from, chip: null, line: null, target: null, cleanup: () => undefined };
    let dragging = false;

    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== current.pointerId) return;
      const at = ctx.local(move);
      current.at = at;
      if (!dragging) {
        if (!isDrag(current.from, at)) return;
        dragging = true;
        startDrag(current, board);
      }
      place(current, at);
    };
    const onUp = (up: PointerEvent): void => {
      if (up.pointerId === current.pointerId) finish(current, dragging);
    };
    const onCancel = (): void => finish(current, false);
    const onKey = (key: KeyboardEvent): void => {
      if (key.key !== 'Escape' || !dragging) return;
      key.preventDefault();
      key.stopPropagation();
      finish(current, false);
    };
    // The wheel keeps panning during a drag, so the line is placed again for the new camera.
    const onWheel = (): void => {
      if (dragging) place(current, current.at);
    };

    label.addEventListener('pointermove', onMove);
    label.addEventListener('pointerup', onUp);
    label.addEventListener('pointercancel', onCancel);
    label.addEventListener('lostpointercapture', onCancel);
    document.addEventListener('keydown', onKey, true);
    ctx.surface.addEventListener('wheel', onWheel);
    try {
      label.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (a touch that ended): the press simply never becomes a drag.
    }
    current.cleanup = () => {
      label.removeEventListener('pointermove', onMove);
      label.removeEventListener('pointerup', onUp);
      label.removeEventListener('pointercancel', onCancel);
      label.removeEventListener('lostpointercapture', onCancel);
      document.removeEventListener('keydown', onKey, true);
      ctx.surface.removeEventListener('wheel', onWheel);
      if (label.hasPointerCapture(current.pointerId)) label.releasePointerCapture(current.pointerId);
      current.chip?.remove();
      current.line?.remove();
      delete ctx.surface.dataset.reordering;
      markDragging(current.id, false);
    };
    press = current;
  };

  return {
    begin,
    active: () => press !== null && press.chip !== null,
    dispose: () => {
      if (press) finish(press, false);
    },
  };
};
