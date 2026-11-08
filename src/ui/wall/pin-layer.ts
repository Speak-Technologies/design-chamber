// Pins: the numbered markers over each artboard, and the count badges that stand in for pins that
// would overlap at the current zoom. This layer owns the pin DOM of every board; where a pin sits
// comes from the board's pin tracker (`board.placements`), what it says from `comments-model`.

import { isInFrameView } from '../../guest/anchoring.ts';
import { zoomAt } from '../../guest/camera.ts';
import { h } from '../components/dom.ts';
import { pinAriaLabel, pinGlyph } from '../model/comments-model.ts';
import { PIN_FAN_SCALE, clusterPins, fanOut, frameToScreen, separatingScale, type PinSpot, type Point } from '../model/wall-model.ts';
import type { CameraController } from './camera-controller.ts';
import { pinState, type PopoverLayer } from './popover-layer.ts';
import type { Late, WallContext } from './wall-context.ts';
import type { Board, BoardLookup } from './wall-types.ts';

export type PinLayer = {
  /** Repaint the pins and count badges of one artboard. */
  paint: (board: Board) => void;
  /** The comments changed: hand each tracker its comments, then repaint every artboard. */
  paintAll: () => void;
  /** The zoom changed: which pins fold into a count depends on it, so repaint when it differs from the last paint. */
  scaleChanged: (scale: number) => void;
};

const placePin = (el: HTMLElement, at: Point): void => {
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
};

export const createPinLayer = (ctx: WallContext, camera: CameraController, popovers: PopoverLayer, boards: Late<BoardLookup>): PinLayer => {
  let pinScale = camera.get().scale;

  /** Zoom in on a folded group of pins until they come apart (from 100 % they fan out instead). */
  const openCluster = (board: Board, spots: PinSpot[], anchor: Point): void => {
    const current = camera.get();
    const target = separatingScale(spots, current.scale, ctx.pinSize());
    camera.set(zoomAt(current, target, frameToScreen(current, board.art.rect, anchor)), true);
  };

  /**
   * Pins keep one screen size at every zoom, so neighbours collide when zoomed out. Pins closer
   * than a pin's width fold into one count badge (click: zoom in); from 100 % up, pins that still
   * share a spot fan out into a row. Pins scrolled out of the frame are hidden.
   */
  const paint = (board: Board): void => {
    const scale = camera.get().scale;
    const show = !ctx.readOnly() && (ctx.mode === 'edit' || ctx.showPins);
    board.overlay.dataset.pins = show ? 'shown' : 'hidden';
    const nums = ctx.numbers();
    const mine = ctx.commentsOf(board.art).sort((a, b) => (nums.get(a.id) ?? 0) - (nums.get(b.id) ?? 0));
    const keep = new Set(mine.map((comment) => comment.id));
    for (const [id, pin] of board.pins) {
      if (!keep.has(id)) {
        pin.remove();
        board.pins.delete(id);
      }
    }
    for (const cluster of board.clusters) cluster.remove();
    board.clusters = [];

    const frameSize = { width: board.art.rect.w, height: board.art.rect.h };
    const spots: PinSpot[] = [];
    for (const comment of mine) {
      let pin = board.pins.get(comment.id);
      if (!pin) {
        const created = h('button', { type: 'button', class: 'dc-pin' });
        created.addEventListener('pointerdown', (event) => event.stopPropagation());
        created.addEventListener('click', (event) => {
          event.stopPropagation();
          popovers.openThread(board, comment.id);
        });
        board.overlay.append(created);
        board.pins.set(comment.id, created);
        pin = created;
      }
      const number = nums.get(comment.id) ?? 0;
      const { point, anchorState } = pinState(board, comment);
      pin.textContent = pinGlyph(comment, number);
      pin.dataset.status = comment.status;
      pin.dataset.detached = anchorState === 'detached' ? 'true' : 'false';
      pin.setAttribute('aria-label', `${pinAriaLabel(comment, number)}${anchorState === 'detached' ? ', element not found' : ''}`);
      const inView = isInFrameView({ x: point.x + board.scroll.x, y: point.y + board.scroll.y }, board.scroll, frameSize);
      pin.hidden = !inView;
      pin.tabIndex = show ? 0 : -1;
      placePin(pin, point);
      if (inView) spots.push({ id: comment.id, x: point.x, y: point.y });
    }

    for (const group of clusterPins(spots, scale, ctx.pinSize())) {
      if (group.ids.length === 1) continue;
      const members = spots.filter((spot) => group.ids.includes(spot.id));
      // A page cannot zoom in on a folded group, so its pins always fan out.
      if (scale >= PIN_FAN_SCALE || ctx.pageMode) {
        for (const spot of fanOut(group, scale, ctx.pinSize())) {
          const pin = board.pins.get(spot.id);
          if (pin) placePin(pin, spot);
        }
        continue;
      }
      for (const id of group.ids) {
        const pin = board.pins.get(id);
        if (pin) pin.hidden = true;
      }
      const labels = group.ids.map((id) => nums.get(id) ?? 0).join(', ');
      const statuses = new Set(group.ids.map((id) => ctx.comments().find((comment) => comment.id === id)?.status));
      const cluster = h(
        'button',
        {
          type: 'button',
          class: 'dc-pin dc-pin-cluster',
          'data-status': statuses.has('open') ? 'open' : statuses.has('sent') ? 'sent' : 'resolved',
          'aria-label': `${group.ids.length} comments here (${labels}). Zoom in to see them.`,
          title: `Comments ${labels}. Click to zoom in`,
        },
        String(group.ids.length),
      );
      cluster.tabIndex = show ? 0 : -1;
      cluster.addEventListener('pointerdown', (event) => event.stopPropagation());
      cluster.addEventListener('click', (event) => {
        event.stopPropagation();
        openCluster(board, members, group);
      });
      placePin(cluster, group);
      board.overlay.append(cluster);
      board.clusters.push(cluster);
    }
  };

  return {
    paint,
    paintAll: () => {
      for (const board of boards().values()) {
        board.tracker.setComments(board.screenId === (board.art.screen?.id ?? null) ? ctx.commentsOf(board.art) : []);
        paint(board);
      }
    },
    scaleChanged: (scale) => {
      if (scale === pinScale) return;
      pinScale = scale;
      for (const board of boards().values()) paint(board);
    },
  };
};
