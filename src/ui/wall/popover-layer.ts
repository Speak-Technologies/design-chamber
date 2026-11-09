// The one card the wall floats over an artboard: the composer for a new comment, or the thread
// of an existing one. This layer builds the card (`comment-ui.ts`), places it next to its anchor
// inside the wall's overlay, and closes it. Saving, resolving and deleting go to `WallOptions`.

import { anchorFromHit, docToFrame } from '../../guest/anchoring.ts';
import type { HitElement } from '../../shared/bridge-protocol.ts';
import { PAGE_FILL_VIEWPORT_ID } from '../../shared/limits.ts';
import type { Comment } from '../../shared/types.ts';
import { h } from '../components/dom.ts';
import { frameToScreen, pinFramePoint, type Point } from '../model/wall-model.ts';
import { createComposer, createThread, type CardHandle } from './comment-ui.ts';
import type { CameraController } from './camera-controller.ts';
import type { WallContext } from './wall-context.ts';
import type { Board, Popover, Rect, WallSelectionEvent } from './wall-types.ts';

export type PopoverLayer = {
  /** Open the thread of a comment next to its pin (closes any open card first). */
  openThread: (board: Board, commentId: string) => void;
  /** Open the composer for a clicked element. */
  openComposer: (board: Board, element: HitElement, framePoint: Point) => void;
  close: () => void;
  /** The open card, if any. */
  current: () => Popover | null;
  /** Put a card in the overlay at a screen point, kept inside the wall. */
  placeCard: (card: HTMLElement, anchorScreen: Point, below: number) => void;
  /**
   * Seam S4: forget the selected element (the ask bar's chip was removed). A no-op until the ask
   * branch fills it in: it closes an open composer and emits `cleared`.
   */
  clearSelection: () => void;
};

export type PopoverDeps = {
  /**
   * Seam S4: announce a selection change to `WallHandle.onSelection` listeners. The ask branch calls
   * it with `selected` in `openComposer`, `commented` after `createComment` resolves, and `cleared`
   * from `close` when a composer was open. Nothing calls it yet.
   */
  emitSelection: (event: WallSelectionEvent) => void;
};

/** Where a comment's pin sits (frame px) and what its anchor resolved to, from the board's pin tracker. */
export const pinState = (board: Board, comment: Comment): { point: Point; anchorState: 'exact' | 'moved' | 'detached' | 'unknown' } => {
  const placement = board.placements.find((entry) => entry.commentId === comment.id);
  if (!placement) return { point: pinFramePoint(comment.anchor.rect, comment.anchor.point, board.scroll), anchorState: 'unknown' };
  return { point: docToFrame(placement.point, board.scroll), anchorState: placement.state === 'pending' ? 'unknown' : placement.state };
};

/** Size and place an overlay box (hover outline, selection) over an element rect, minus the frame's scroll. */
export const rectToBox = (board: Board, el: HTMLElement, rect: Rect): void => {
  el.style.left = `${rect.x - board.scroll.x}px`;
  el.style.top = `${rect.y - board.scroll.y}px`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
};

export const createPopoverLayer = (ctx: WallContext, camera: CameraController, _deps: PopoverDeps): PopoverLayer => {
  const { options } = ctx;
  let popover: Popover | null = null;

  const close = (): void => {
    if (!popover) return;
    const current = popover;
    popover = null;
    current.card.el.remove();
    current.board.selected.hidden = true;
    for (const pin of current.board.pins.values()) pin.removeAttribute('aria-expanded');
    document.querySelector('.dc-temp-pin')?.remove();
  };

  const placeCard = (card: HTMLElement, anchorScreen: Point, below: number): void => {
    ctx.overlay.append(card);
    const { w, h: surfaceHeight } = ctx.surfaceSize;
    const width = Math.min(card.offsetWidth, w - 16);
    const height = card.offsetHeight;
    let left = anchorScreen.x;
    let top = anchorScreen.y + below + 10;
    if (left + width > w - 8) left = w - width - 8;
    if (top + height > surfaceHeight - 8) top = Math.max(8, anchorScreen.y - height - 10);
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${Math.max(8, top)}px`;
  };

  /** Which view a page comment was made in: "Full width" or the viewport's name. */
  const pageWhere = (comment: Comment): string =>
    comment.viewport === PAGE_FILL_VIEWPORT_ID ? 'Made at full width' : `Made at ${ctx.detail.design.viewports.find((viewport) => viewport.id === comment.viewport)?.label ?? comment.viewport} size`;

  const open = (board: Board, card: CardHandle, commentId: string | null): void => {
    popover = { card, board, commentId };
  };

  const openThread = (board: Board, commentId: string): void => {
    const comment = ctx.comments().find((candidate) => candidate.id === commentId);
    if (!comment) return;
    close();
    const number = ctx.numbers().get(commentId) ?? 0;
    const { point, anchorState } = pinState(board, comment);
    const sendComment = options.onSendComment;
    const card = createThread({
      comment,
      number,
      where: ctx.pageMode ? pageWhere(comment) : `${board.art.screen?.title ?? 'Page'} · ${board.art.viewport.label}`,
      anchorState,
      readOnly: ctx.readOnly(),
      onSave: async (body) => {
        await options.updateComment(commentId, { body });
        close();
      },
      // Seam S6: the send-one-pin branch renders the button; the callback is only handed over when the view passed one.
      onSend: sendComment ? (body) => sendComment(commentId, body) : undefined,
      onStatus: async (status) => {
        await options.updateComment(commentId, { status });
        close();
      },
      onDelete: async () => {
        await options.deleteComment(commentId);
        close();
      },
      onClose: () => close(),
    });
    open(board, card, commentId);
    const screenPoint = frameToScreen(camera.get(), board.art.rect, point);
    placeCard(card.el, { x: screenPoint.x + 14, y: screenPoint.y - 10 }, 0);
    board.pins.get(commentId)?.setAttribute('aria-expanded', 'true');
    card.focus();
  };

  const openComposer = (board: Board, element: HitElement, framePoint: Point): void => {
    close();
    const anchor = anchorFromHit(element, framePoint, board.scroll);
    const { point } = anchor;
    rectToBox(board, board.selected, element.rect);
    board.selected.hidden = false;
    board.hover.hidden = true;
    const temp = h('span', { class: 'dc-pin dc-temp-pin', 'aria-hidden': 'true' }, '+');
    const pinAt = pinFramePoint(element.rect, point, board.scroll);
    temp.style.left = `${pinAt.x}px`;
    temp.style.top = `${pinAt.y}px`;
    board.overlay.append(temp);
    const card = createComposer({
      tag: element.tag,
      snippet: element.text.length > 80 ? `${element.text.slice(0, 77)}…` : element.text,
      onCancel: () => close(),
      onSubmit: async (body) => {
        await options.createComment({
          screen: board.art.screen?.id ?? null,
          viewport: board.art.viewport.id,
          anchor,
          body,
        });
        close();
      },
    });
    open(board, card, null);
    const base = frameToScreen(camera.get(), board.art.rect, { x: element.rect.x - board.scroll.x, y: element.rect.y - board.scroll.y });
    placeCard(card.el, base, element.rect.h * camera.get().scale);
    card.focus();
  };

  return { openThread, openComposer, close, current: () => popover, placeCard, clearSelection: () => undefined };
};
