// The wall surface's input: keyboard, wheel, pointer, label double-click and a double-click on an
// element (edit its text). This module reads
// the event, asks `model/wall-input.ts` what it means, and acts on the answer. It owns the
// gesture state: a pan in progress, the Space key, the pan tool and the press that may become a
// comment.

import { panBy, wheelZoom } from '../../guest/camera.ts';
import { isDrag, pageKeyAction, pointerDownAction, shortcutAction, wallKeyAction, wheelRoute, type WallKeyAction } from '../model/wall-input.ts';
import { screenToFrame, type Point } from '../model/wall-model.ts';
import type { BoardSet } from './board-set.ts';
import type { CameraController } from './camera-controller.ts';
import type { HitController } from './hit-controller.ts';
import type { PopoverLayer } from './popover-layer.ts';
import type { WallContext } from './wall-context.ts';
import type { Board } from './wall-types.ts';

export type InputController = {
  /** A wall-wide shortcut (also what a key forwarded from a frame does); returns whether it was used. */
  shortcut: (key: string, shift: boolean) => boolean;
  /** Whether the user is dragging the wall. */
  isPanning: () => boolean;
};

export type InputDeps = {
  camera: CameraController;
  boards: BoardSet;
  popovers: PopoverLayer;
  hit: HitController;
  /** Ctrl/⌘+Z on the wall: the edit feature decides whether there is anything to undo. */
  onUndoEdit: () => void;
};

export const createInputController = (ctx: WallContext, deps: InputDeps): InputController => {
  const { camera, boards, popovers, hit } = deps;
  const { surface, scope, pageMode } = ctx;
  let panning: { id: number; last: Point } | null = null;
  let spaceDown = false;
  let panTool = false;
  /** A primary press that may become a comment click (or a pan, if it drags). */
  let downAt: { point: Point; board: Board | null } | null = null;

  const setTool = (): void => {
    surface.dataset.tool = spaceDown || panTool ? 'pan' : 'none';
  };

  /** Run a key action; says whether the wall used the key. Escape counts only when a card was open. */
  const run = (action: WallKeyAction): boolean => {
    switch (action.type) {
      case 'escape':
        if (!popovers.current()) return false;
        popovers.close();
        return true;
      case 'zoom':
        camera.zoomAtCentre(action.factor);
        return true;
      case 'zoom-reset':
        camera.zoomReset();
        return true;
      case 'fit':
        camera.fit();
        return true;
      case 'pan':
        camera.set(panBy(camera.get(), action.dx, action.dy), true);
        return true;
      case 'toggle-pan-tool':
        panTool = !panTool;
        setTool();
        return true;
      case 'space-down':
        spaceDown = true;
        return true;
      case 'undo-edit':
        deps.onUndoEdit();
        return true;
    }
  };

  const shortcut = (key: string, shift: boolean): boolean => {
    const action = shortcutAction({ key, shift, pageMode });
    if (!action) return false;
    const used = run(action);
    // Escape reports its own result and leaves the tool alone.
    if (used && action.type !== 'escape') setTool();
    return used;
  };

  /** The page's frame once it has loaded; null before, or on the wall. */
  const readyPageBoard = (): Board | null => {
    if (!pageMode) return null;
    const board = boards.first();
    return board && board.main.state() === 'ready' ? board : null;
  };

  /** Page keys scroll the design like a browser tab: arrows, Page Up/Down, Home and End. */
  const pageKey = (event: KeyboardEvent): boolean => {
    const board = readyPageBoard();
    const action = pageKeyAction({ key: event.key, shift: event.shiftKey, frameHeight: board?.art.rect.h ?? 0 });
    if (!action) return false;
    if (action.type === 'escape') return shortcut('Escape', false);
    if (!board) return false;
    board.main.post(action.type === 'scroll-by' ? { type: 'scroll-by', dx: action.dx, dy: action.dy } : { type: 'scroll-to', x: action.x, y: action.y });
    return true;
  };

  scope.listen<KeyboardEvent>(surface, 'keydown', (event) => {
    const inField = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement || (event.target instanceof HTMLElement && event.target.isContentEditable);
    if (inField) return;
    if (event.metaKey || event.ctrlKey || event.altKey) {
      // The one modified key the wall uses: Ctrl/⌘+Z undoes the last hand edit (the decision is in model/wall-input.ts).
      const undo = wallKeyAction({ key: event.key, code: event.code, shift: event.shiftKey, pageMode, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, inField });
      if (undo?.type === 'undo-edit' && run(undo)) event.preventDefault();
      return;
    }
    if (pageMode) {
      if (pageKey(event)) event.preventDefault();
      return;
    }
    const action = wallKeyAction({ key: event.key, code: event.code, shift: event.shiftKey, pageMode });
    if (!action) return;
    const handled = run(action);
    // Space and the zoom keys share the shortcut table, which also refreshes the pan cursor.
    if (handled && (action.type === 'space-down' || action.type === 'zoom')) setTool();
    if (handled) event.preventDefault();
  });
  scope.listen<KeyboardEvent>(surface, 'keyup', (event) => {
    if (event.key === ' ') {
      spaceDown = false;
      surface.dataset.tool = panTool ? 'pan' : 'none';
    }
  });

  scope.listen<WheelEvent>(
    surface,
    'wheel',
    (event) => {
      const at = ctx.local(event);
      const board = boards.at(at);
      const route = wheelRoute({
        pageMode,
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        mode: ctx.mode,
        readOnly: ctx.readOnly(),
        overReadyBoard: board !== null && board.main.state() === 'ready',
        spaceDown,
        panTool,
      });
      // Every route owns the wheel: the surface never lets the page behind it scroll.
      event.preventDefault();
      if (route === 'zoom') camera.set(wheelZoom(camera.get(), event.deltaY, at), true);
      else if (route === 'scroll-frame') board?.main.post({ type: 'scroll-by', dx: event.deltaX, dy: event.deltaY });
      else if (route === 'pan') camera.set(panBy(camera.get(), -event.deltaX, -event.deltaY), true);
    },
    { passive: false },
  );

  scope.listen<PointerEvent>(surface, 'pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('.dc-pop, .dc-label, .dc-pin, .dc-seltoolbar, .dc-editor')) return;
    // The text editor is open: it handles a press outside itself (click-away), the wall does nothing.
    if (ctx.editing) return;
    surface.focus({ preventScroll: true });
    const at = ctx.local(event);
    const board = boards.at(at);
    const action = pointerDownAction({ pageMode, button: event.button, spaceDown, panTool, onBoard: board !== null, mode: ctx.mode, readOnly: ctx.readOnly() });
    if (action === 'ignore') return;
    if (popovers.current()) popovers.close();
    if (action === 'pan') {
      panning = { id: event.pointerId, last: at };
      surface.setPointerCapture(event.pointerId);
      surface.dataset.panning = 'true';
      event.preventDefault();
    } else downAt = action === 'press' ? { point: at, board } : null;
  });

  scope.listen<PointerEvent>(surface, 'pointermove', (event) => {
    const at = ctx.local(event);
    hit.setPointer(at);
    if (panning && panning.id === event.pointerId) {
      camera.set(panBy(camera.get(), at.x - panning.last.x, at.y - panning.last.y), true);
      panning.last = at;
      return;
    }
    if (downAt && isDrag(downAt.point, at)) {
      if (pageMode) {
        // A drag on a page is not a click: no comment, and no pan either.
        downAt = null;
      } else {
        // A drag that started on an artboard in Edit mode pans the wall instead of commenting.
        panning = { id: event.pointerId, last: downAt.point };
        downAt = null;
        surface.setPointerCapture(event.pointerId);
        surface.dataset.panning = 'true';
        hit.clearHover();
        return;
      }
    }
    hit.scheduleHover();
  });

  const endPointer = (event: PointerEvent): void => {
    if (panning && panning.id === event.pointerId) {
      panning = null;
      delete surface.dataset.panning;
      return;
    }
    const press = downAt;
    downAt = null;
    if (press && press.board && event.type === 'pointerup' && ctx.mode === 'edit' && !ctx.readOnly()) {
      hit.requestHit(press.board, screenToFrame(camera.get(), press.board.art.rect, press.point), 'click');
    }
  };
  scope.listen<PointerEvent>(surface, 'pointerup', endPointer);
  scope.listen<PointerEvent>(surface, 'pointercancel', endPointer);
  scope.listen<PointerEvent>(surface, 'pointerleave', () => {
    hit.setPointer(null);
    hit.clearHover();
  });

  // Double-click on an element: edit its text (08). A label keeps its "focus this artboard"; Play mode and saved versions leave the design alone.
  scope.listen<MouseEvent>(surface, 'dblclick', (event) => {
    if (ctx.mode !== 'edit' || ctx.readOnly() || ctx.editing) return;
    if (event.target instanceof Element && event.target.closest('.dc-pop, .dc-label, .dc-pin, .dc-seltoolbar, .dc-editor')) return;
    const at = ctx.local(event);
    const board = boards.at(at);
    if (board) hit.requestHit(board, screenToFrame(camera.get(), board.art.rect, at), 'edit');
  });

  scope.listen<MouseEvent>(ctx.labels, 'dblclick', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.dc-label') : null;
    if (!target) return;
    for (const board of boards.values()) {
      if (board.label === target) camera.focusBoard(board);
    }
  });

  return { shortcut, isPanning: () => panning !== null };
};
