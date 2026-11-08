// What the wall does with a message from a design frame. The messages were already validated by
// the frame channel (`guest/frame-channel.ts`: source window, artboard id and nonce checked);
// this module only decides what each one means for the wall.

import { panBy, wheelZoom } from '../../guest/camera.ts';
import type { FrameToPageMessage } from '../../shared/bridge-protocol.ts';
import { frameWheelRoute } from '../model/wall-input.ts';
import { frameToScreen } from '../model/wall-model.ts';
import type { CameraController } from './camera-controller.ts';
import type { HitController } from './hit-controller.ts';
import type { PopoverLayer } from './popover-layer.ts';
import type { WallContext } from './wall-context.ts';
import type { Board } from './wall-types.ts';

export type FrameMessageDeps = {
  camera: CameraController;
  hit: HitController;
  popovers: PopoverLayer;
  /** Load a board's frame again (a play-mode navigation changed its screen). */
  load: (board: Board) => Promise<void>;
  /** A key a frame forwarded; returns whether the wall used it. */
  shortcut: (key: string, shift: boolean) => boolean;
};

export const createFrameMessageHandler = (ctx: WallContext, deps: FrameMessageDeps): ((board: Board, message: FrameToPageMessage) => void) => {
  const { camera, hit, popovers } = deps;
  const { options } = ctx;

  return (board, message) => {
    switch (message.type) {
      case 'ready':
        board.main.post({ type: 'set-mode', mode: ctx.frameMode() });
        return;
      case 'scroll':
        // The pin tracker repaints the pins; a card anchored to the old position closes.
        if (popovers.current()?.board === board) popovers.close();
        return;
      case 'hit':
        hit.onHit(board, message);
        return;
      case 'navigate': {
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
