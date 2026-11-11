// Picks: the read-only side of "Edit text" on the wall (Phase 2 technical design §3.1, §3.5). When
// the user clicks or double-clicks an element in Edit mode the wall asks the frame what it is
// (`edit-probe`) and the file what it says (`GET /source`, cached), and settles both into one
// `PickCheck` the toolbar shows. Nothing here writes: the frame's answer is advice (E1), the
// source read goes through the store the frame-message handler was given, and the write belongs to
// the edit feature alone.

import type { EditProbe, HitElement } from '../../shared/bridge-protocol.ts';
import type { SourceResponse } from '../../shared/api.ts';
import { answerSource, checkPick, type PickCheck } from '../model/edit-text-model.ts';
import { createListeners } from '../model/listeners.ts';
import { frameToScreen, type Point } from '../model/wall-model.ts';
import type { CameraController } from './camera-controller.ts';
import { rectToBox } from './popover-layer.ts';
import type { WallContext } from './wall-context.ts';
import type { Board, Rect, WallPick, WallSelection } from './wall-types.ts';

/** How long the frame has to answer an `edit-probe` before the pick says it could not tell. */
export const PROBE_TIMEOUT_MS = 4000;

/** Reads one source (the page, or a canvas screen); the handler's store, through the view's cache. */
export type SourceReader = (screen: string | null) => Promise<SourceResponse>;

export type PickLayer = {
  /** A click or double-click picked an element: ask the frame, warm the source, tell the listeners. */
  begin: (board: Board, element: HitElement, framePoint: Point, selection: WallSelection, purpose: WallPick['purpose']) => WallPick;
  /** The frame answered an `edit-probe`; `read` fetches the source for the pick that asked. */
  onProbeResult: (board: Board, message: { x: number; y: number; probe: EditProbe | null }, read: SourceReader) => void;
  /** Ask the frame and the file again at the same point (after a stale refusal); the cache is dropped first. */
  recheck: (pick: WallPick) => Promise<PickCheck>;
  /** The element's box in surface px, at the current camera and frame scroll. */
  box: (pick: WallPick) => Rect;
  /** Outline the picked element (the selection ring) or hide it. */
  ring: (pick: WallPick | null) => void;
  onPick: (listener: (pick: WallPick) => void) => () => void;
  /** The camera or a frame's scroll moved: anything anchored to an element box must follow. */
  onMoved: (listener: () => void) => () => void;
  notifyMoved: () => void;
  dispose: () => void;
};

export type PickDeps = {
  camera: CameraController;
  /** Start reading a source so the probe's answer finds it cached. Failures are the pick's to report. */
  warm: (screen: string | null) => void;
  /** Forget every cached source (a stale refusal asks for fresh bytes). */
  dropSources: () => void;
};

type Pending = { board: Board; point: Point; finish: (probe: EditProbe | null, read: SourceReader | null) => void };

export const createPickLayer = (ctx: WallContext, deps: PickDeps): PickLayer => {
  const { camera } = deps;
  const picks = createListeners<[WallPick]>();
  const moved = createListeners();
  const pending = new Set<Pending>();
  let seq = 0;
  let ringed: Board | null = null;

  // The screen the board shows, not the one it was laid out for: the edit must write the file the user is looking at.
  const screenOf = (board: Board): string | null => board.screenId;

  /** One probe in flight for this point; settles to a check when the frame and the file have both answered, or the frame does not. */
  const ask = (board: Board, point: Point, screen: string | null): Promise<PickCheck> =>
    new Promise((resolve) => {
      let done = false;
      const entry: Pending = {
        board,
        point,
        finish: (probe, read) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          pending.delete(entry);
          if (probe === null || read === null) {
            resolve(checkPick({ viewing: ctx.readOnly(), probe: null, source: { ok: false, kind: 'failed', message: 'The design didn’t answer. Click the element again.' } }));
            return;
          }
          void answerSource(() => read(screen)).then((source) => resolve(checkPick({ viewing: ctx.readOnly(), probe, source })));
        },
      };
      const timer = setTimeout(() => entry.finish(null, null), PROBE_TIMEOUT_MS);
      pending.add(entry);
      board.main.post({ type: 'edit-probe', x: point.x, y: point.y });
    });

  const box = (pick: WallPick): Rect => {
    const { board, element } = pick;
    const view = camera.get();
    const at = frameToScreen(view, board.art.rect, { x: element.rect.x - board.scroll.x, y: element.rect.y - board.scroll.y });
    return { x: at.x, y: at.y, w: element.rect.w * view.scale, h: element.rect.h * view.scale };
  };

  return {
    begin: (board, element, framePoint, selection, purpose) => {
      seq += 1;
      const screen = screenOf(board);
      deps.warm(screen);
      const pick: WallPick = { id: seq, purpose, selection, board, element, framePoint, screen, check: ask(board, framePoint, screen) };
      picks.emit(pick);
      return pick;
    },
    onProbeResult: (board, message, read) => {
      for (const entry of [...pending]) {
        if (entry.board === board && entry.point.x === message.x && entry.point.y === message.y) entry.finish(message.probe, read);
      }
    },
    recheck: (pick) => {
      deps.dropSources();
      return ask(pick.board, pick.framePoint, pick.screen);
    },
    box,
    ring: (pick) => {
      if (ringed) ringed.selected.hidden = true;
      ringed = null;
      if (!pick) return;
      rectToBox(pick.board, pick.board.selected, pick.element.rect);
      pick.board.selected.hidden = false;
      ringed = pick.board;
    },
    onPick: picks.add,
    onMoved: moved.add,
    notifyMoved: () => moved.emit(),
    dispose: () => {
      for (const entry of [...pending]) entry.finish(null, null);
      if (ringed) ringed.selected.hidden = true;
    },
  };
};
