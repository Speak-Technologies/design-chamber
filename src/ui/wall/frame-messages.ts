// What the wall does with a message from a design frame. The messages were already validated by
// the frame channel (`guest/frame-channel.ts`: source window, artboard id and nonce checked);
// this module only decides what each one means for the wall.
//
// Saved page data: a `storage-batch` is forwarded only from a board whose main frame shows the live design. A frame on an old
// version runs with empty, unsaved storage and never posts one, and a forged one from it is dropped here as well.
//
// E1 (Phase 2): no message from a frame ever starts a write. The one thing a message can make this
// module read is a source file (the answer to `edit-probe`), through a store that is narrowed to
// `loadSource` by its type; the hand edit itself is made by the edit feature after a click on Save.

import { panBy, wheelZoom } from '../../guest/camera.ts';
import type { Store } from '../../guest/store.ts';
import type { StorageBatch } from '../../guest/bridge/storage-shim.ts';
import type { FrameToPageMessage } from '../../shared/bridge-protocol.ts';
import { frameWheelRoute } from '../model/wall-input.ts';
import { frameToScreen } from '../model/wall-model.ts';
import type { CameraController } from './camera-controller.ts';
import type { HitController } from './hit-controller.ts';
import type { PickLayer } from './pick-layer.ts';
import type { PopoverLayer } from './popover-layer.ts';
import type { WallContext } from './wall-context.ts';
import type { Board } from './wall-types.ts';

export type FrameMessageDeps = {
  camera: CameraController;
  hit: HitController;
  popovers: PopoverLayer;
  picks: PickLayer;
  /** Load a board's frame again (a play-mode navigation changed its screen). */
  load: (board: Board) => Promise<void>;
  /** A key a frame forwarded; returns whether the wall used it. */
  shortcut: (key: string, shift: boolean) => boolean;
  /** A write to `localStorage` from a frame that shows the live design (saved page data, feature 19). */
  storage: (board: Board, batch: StorageBatch) => void;
};

/** What the handler may do with the store: read a source. Nothing that writes (E1). */
export type FrameMessageStore = Pick<Store, 'loadSource'>;

export const createFrameMessageHandler = (ctx: WallContext, deps: FrameMessageDeps, store: FrameMessageStore): ((board: Board, message: FrameToPageMessage) => void) => {
  const { camera, hit, popovers, picks } = deps;
  const { options } = ctx;

  return (board, message) => {
    switch (message.type) {
      case 'ready':
        board.main.post({ type: 'set-mode', mode: ctx.frameMode() });
        return;
      case 'scroll':
        // The pin tracker repaints the pins; a card anchored to the old position closes.
        if (popovers.current()?.board === board) popovers.close();
        picks.notifyMoved();
        return;
      case 'hit':
        hit.onHit(board, message);
        return;
      case 'edit-probe-result':
        picks.onProbeResult(board, message, (screen) => store.loadSource(ctx.options.slug, screen));
        return;
      case 'navigate': {
        // E1/E2: only Play mode follows a link. In Edit mode the board keeps the screen the user sees, so a
        // pick (and the file it reads and writes) can never be pointed elsewhere by a design script or a forged message.
        if (ctx.frameMode() !== 'play') return;
        const target = ctx.screens().find((candidate) => candidate.file === message.href);
        if (!target) {
          options.onNotice('That link doesn’t lead to a screen of this design.');
          return;
        }
        board.screenId = target.id;
        board.scroll = { x: 0, y: 0 };
        void deps.load(board);
        return;
      }
      case 'storage-batch':
        if (ctx.version !== null && !ctx.compare) return; // the main frame shows an old version
        deps.storage(board, { clear: message.clear, changes: message.changes });
        return;
      case 'open-external':
        options.onExternal(message.url);
        return;
      case 'wheel': {
        // A plain wheel reaches us only from Edit mode: scroll the design, as over the wall.
        // On a page there is no zoom; a plain wheel scrolls the design, as in a browser tab.
        const route = frameWheelRoute({ pageMode: ctx.pageMode, ctrl: message.ctrl, mode: ctx.mode, readOnly: ctx.readOnly() });
        if (route === 'scroll-frame') board.main.post({ type: 'scroll-by', dx: message.deltaX, dy: message.deltaY });
        else if (route === 'zoom') camera.set(wheelZoom(camera.get(), message.deltaY, frameToScreen(camera.get(), board.art.rect, { x: message.x, y: message.y })), true);
        else if (route === 'pan') camera.set(panBy(camera.get(), -message.deltaX, -message.deltaY), true);
        return;
      }
      case 'key':
        // Space is a hold-to-pan key on the wall itself; a frame only sends key-down, so it would stick.
        if (message.key !== ' ') deps.shortcut(message.key, message.shift);
        return;
      default:
        // `size` and `anchors` feed the pin tracker.
        return;
    }
  };
};
