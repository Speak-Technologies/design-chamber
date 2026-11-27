// The one card the wall floats over an artboard: the composer for a new comment, or the thread
// of an existing one. This layer builds the card (`comment-ui.ts`), places it next to its anchor
// inside the wall's overlay, and closes it. Saving, resolving and deleting go to `WallOptions`.
// Unsaved text is never dropped by closing: `model/comment-drafts.ts` keeps it for the same card.

import { anchorFromHit, docToFrame } from '../../guest/anchoring.ts';
import type { HitElement } from '../../shared/bridge-protocol.ts';
import { PAGE_FILL_VIEWPORT_ID } from '../../shared/limits.ts';
import type { Comment } from '../../shared/types.ts';
import { h } from '../components/dom.ts';
import { composerDraftKey, createDraftStore, threadDraftKey } from '../model/comment-drafts.ts';
import { viewportOf } from '../model/comments-model.ts';
import { frameToScreen, pinFramePoint, type Point } from '../model/wall-model.ts';
import { createComposer, createThread, type CardHandle } from './comment-ui.ts';
import type { CameraController } from './camera-controller.ts';
import type { WallContext } from './wall-context.ts';
import type { Board, Popover, Rect, WallSelection, WallSelectionEvent } from './wall-types.ts';

export type PopoverLayer = {
  /** Open the thread of a comment next to its pin (closes any open card first). */
  openThread: (board: Board, commentId: string) => void;
  /** Open the composer for a clicked element; returns the selection it announced. */
  openComposer: (board: Board, element: HitElement, framePoint: Point) => WallSelection;
  /** What a click on this element selects (key, where it is, the anchor the comment would carry), without opening anything. */
  selectionFor: (board: Board, element: HitElement, framePoint: Point) => WallSelection;
  /** Close the card; unsaved text is kept for the next time it opens. */
  close: () => void;
  /**
   * The wall or the design under the card moved (pan, zoom, scroll, or the press that starts a drag):
   * an empty card closes, one holding text stays. `scrolled`: the design moved inside its frame, so
   * the outline of the picked element no longer sits on it.
   */
  closeForMove: (scrolled?: boolean) => void;
  /** The open card, if any. */
  current: () => Popover | null;
  /** Put a card in the overlay at a screen point, kept inside the wall. */
  placeCard: (card: HTMLElement, anchorScreen: Point, below: number) => void;
  /** Seam S4: forget the selected element (the ask bar's chip was removed): closes an open composer, unless it holds text the user typed. */
  clearSelection: () => void;
  /** The comments changed: an open thread card follows its comment's status. */
  refresh: () => void;
};

export type PopoverDeps = {
  /**
   * Seam S4: announce a selection change to `WallHandle.onSelection` listeners: `selected` in
   * `openComposer`, `commented` after `createComment` resolves, `cleared` from `close` when a
   * composer was open.
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

/** One store for every wall, so leaving a design and coming back keeps what was typed. */
const drafts = createDraftStore();

export const createPopoverLayer = (ctx: WallContext, camera: CameraController, deps: PopoverDeps): PopoverLayer => {
  const { options } = ctx;
  let popover: Popover | null = null;

  const close = (): void => {
    if (!popover) return;
    const current = popover;
    popover = null;
    drafts.keep(current.draftKey, current.card.draft());
    current.card.el.remove();
    current.board.selected.hidden = true;
    for (const pin of current.board.pins.values()) pin.removeAttribute('aria-expanded');
    document.querySelector('.dc-temp-pin')?.remove();
    // A composer is a selection in progress; a thread is not.
    if (current.commentId === null) deps.emitSelection({ type: 'cleared' });
  };

  const hideMarks = (board: Board): void => {
    board.selected.hidden = true;
    document.querySelector('.dc-temp-pin')?.remove();
  };

  const closeForMove = (scrolled = false): void => {
    if (!popover) return;
    if (popover.card.draft() === null) close();
    else if (scrolled) hideMarks(popover.board);
  };

  /** The card's text was saved or thrown away: forget it, and close the card if it is still the open one. */
  const settle = (card: CardHandle | null, draftKey: string): void => {
    if (card && popover?.card === card) {
      popover = { ...popover, card: { ...card, draft: () => null } };
      close();
    }
    drafts.drop(draftKey);
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

  const open = (board: Board, card: CardHandle, commentId: string | null, draftKey: string): void => {
    popover = { card, board, commentId, draftKey };
  };

  const openThread = (board: Board, commentId: string): void => {
    const comment = ctx.comments().find((candidate) => candidate.id === commentId);
    if (!comment) return;
    close();
    const number = ctx.numbers().get(commentId) ?? 0;
    const { point, anchorState } = pinState(board, comment);
    const sendComment = options.onSendComment;
    const draftKey = threadDraftKey(options.slug, commentId);
    const card: CardHandle = createThread({
      draft: drafts.get(draftKey),
      comment,
      number,
      where: ctx.pageMode ? pageWhere(comment) : `${board.art.screen?.title ?? 'Page'} · ${board.art.viewport.label}`,
      anchorState,
      readOnly: ctx.readOnly(),
      onSave: async (body) => {
        await options.updateComment(commentId, { body });
        settle(card, draftKey);
      },
      // Seam S6: the card shows "Send this" only when the view passed a sender.
      onSend: sendComment
        ? async (body) => {
            await sendComment(commentId, body);
            settle(card, draftKey);
          }
        : undefined,
      onStatus: async (status) => {
        await options.updateComment(commentId, { status });
        close();
      },
      onDelete: async () => {
        await options.deleteComment(commentId);
        settle(card, draftKey);
      },
      onClose: () => close(),
    });
    open(board, card, commentId, draftKey);
    const screenPoint = frameToScreen(camera.get(), board.art.rect, point);
    placeCard(card.el, { x: screenPoint.x + 14, y: screenPoint.y - 10 }, 0);
    board.pins.get(commentId)?.setAttribute('aria-expanded', 'true');
    card.focus();
  };

  const selectionFor = (board: Board, element: HitElement, framePoint: Point): WallSelection => {
    const anchor = anchorFromHit(element, framePoint, board.scroll);
    const target = { screen: board.art.screen?.id ?? null, viewport: board.art.viewport.id };
    // The same place name the thread card shows, so the ask bar's chip reads like the composer.
    const where = ctx.pageMode ? viewportOf(ctx.detail.design.viewports, target.viewport) : `${board.art.screen?.title ?? 'Page'} · ${board.art.viewport.label}`;
    return { key: `${board.art.id}:${anchor.selector}`, element: { ...target, anchor }, tag: element.tag, where };
  };

  const openComposer = (board: Board, element: HitElement, framePoint: Point): WallSelection => {
    close();
    const selection = selectionFor(board, element, framePoint);
    const { anchor, ...target } = selection.element;
    const { point } = anchor;
    rectToBox(board, board.selected, element.rect);
    board.selected.hidden = false;
    board.hover.hidden = true;
    const temp = h('span', { class: 'dc-pin dc-temp-pin', 'aria-hidden': 'true' }, '+');
    const pinAt = pinFramePoint(element.rect, point, board.scroll);
    temp.style.left = `${pinAt.x}px`;
    temp.style.top = `${pinAt.y}px`;
    board.overlay.append(temp);
    const draftKey = composerDraftKey({ slug: options.slug, screen: target.screen, artboard: board.art.id, selector: anchor.selector, pageMode: ctx.pageMode });
    const card: CardHandle = createComposer({
      tag: element.tag,
      snippet: element.text.length > 80 ? `${element.text.slice(0, 77)}…` : element.text,
      draft: drafts.get(draftKey),
      onCancel: () => settle(card, draftKey),
      onDismiss: () => close(),
      onSubmit: async (body) => {
        await options.createComment({ ...target, anchor, body });
        deps.emitSelection({ type: 'commented', key: selection.key });
        settle(card, draftKey);
      },
    });
    open(board, card, null, draftKey);
    deps.emitSelection({ type: 'selected', selection });
    const base = frameToScreen(camera.get(), board.art.rect, { x: element.rect.x - board.scroll.x, y: element.rect.y - board.scroll.y });
    placeCard(card.el, base, element.rect.h * camera.get().scale);
    card.focus();
    return selection;
  };

  const clearSelection = (): void => {
    // A half-written comment is the user's work; removing the chip must not throw it away.
    if (popover?.commentId === null && popover.card.draft() === null) close();
  };

  const refresh = (): void => {
    if (popover?.commentId == null) return;
    const id = popover.commentId;
    const comment = ctx.comments().find((candidate) => candidate.id === id);
    if (comment) popover.card.setStatus?.(comment.status);
  };

  return { openThread, openComposer, selectionFor, close, closeForMove, current: () => popover, placeCard, clearSelection, refresh };
};
