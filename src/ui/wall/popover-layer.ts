// The one card the wall floats over an artboard: the composer for a new comment, or the thread
// of an existing one. This layer builds the card (`comment-ui.ts`), keeps it beside its element or
// pin as the wall moves (`model/card-place-model.ts`, which places the selection toolbar with it so
// neither covers the other), and closes it. Saving, resolving and deleting go to `WallOptions`.
// Unsaved text is never dropped by closing: `model/comment-drafts.ts` keeps it for the same card.

import { anchorFromHit, docToFrame } from '../../guest/anchoring.ts';
import type { HitElement } from '../../shared/bridge-protocol.ts';
import { PAGE_FILL_VIEWPORT_ID } from '../../shared/limits.ts';
import type { Comment } from '../../shared/types.ts';
import { h } from '../components/dom.ts';
import { placeCardAndToolbar, type Box } from '../model/card-place-model.ts';
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
   * an empty card closes, one holding text stays and follows its element (`follow`).
   */
  closeForMove: () => void;
  /** Put the open card (and the toolbar with it) where its element is now. */
  follow: () => void;
  /** The selection toolbar shown with the card, to be placed clear of it; null when it goes. */
  setCompanion: (toolbar: HTMLElement | null) => void;
  /** The open card, if any. */
  current: () => Popover | null;
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
  /** Where the open card's element is, surface px at the current camera and frame scroll. */
  let anchorBox: (() => Box) | null = null;
  let companion: HTMLElement | null = null;
  // The card grows (an error line, a dragged textarea) and so does the toolbar (the Edit text reason): place them again.
  const resized = new ResizeObserver(() => follow());
  ctx.scope.add(() => resized.disconnect());

  const follow = (): void => {
    if (!popover || !anchorBox || ctx.surfaceSize.w === 0) return;
    const card = popover.card.el;
    const covered = camera.coveredInsets();
    const place = placeCardAndToolbar({
      box: anchorBox(),
      card: { w: card.offsetWidth, h: card.offsetHeight },
      toolbar: companion ? { w: companion.offsetWidth, h: companion.offsetHeight } : null,
      stage: { w: ctx.surfaceSize.w - covered.right, h: ctx.surfaceSize.h - covered.bottom },
    });
    card.style.left = `${Math.round(place.card.left)}px`;
    card.style.top = `${Math.round(place.card.top)}px`;
    if (!companion) return;
    // `visibility`, not `hidden`: it keeps its size for the next placement, and cannot be pressed or focused meanwhile.
    companion.style.visibility = place.toolbar ? '' : 'hidden';
    if (!place.toolbar) return;
    companion.style.left = `${Math.round(place.toolbar.left)}px`;
    companion.style.top = `${Math.round(place.toolbar.top)}px`;
    companion.dataset.below = String(place.toolbar.below);
  };

  const setCompanion = (toolbar: HTMLElement | null): void => {
    if (companion && companion !== toolbar) resized.unobserve(companion);
    companion = toolbar;
    if (toolbar) resized.observe(toolbar);
    follow();
  };

  const close = (): void => {
    if (!popover) return;
    const current = popover;
    popover = null;
    anchorBox = null;
    resized.unobserve(current.card.el);
    drafts.keep(current.draftKey, current.card.draft());
    current.card.el.remove();
    current.board.selected.hidden = true;
    for (const pin of current.board.pins.values()) pin.removeAttribute('aria-expanded');
    document.querySelector('.dc-temp-pin')?.remove();
    // A composer is a selection in progress; a thread is not.
    if (current.commentId === null) deps.emitSelection({ type: 'cleared' });
  };

  const closeForMove = (): void => {
    if (popover && popover.card.draft() === null) close();
  };

  /** The card's text was saved or thrown away: forget it, and close the card if it is still the open one. */
  const settle = (card: CardHandle | null, draftKey: string): void => {
    if (card && popover?.card === card) {
      popover = { ...popover, card: { ...card, draft: () => null } };
      close();
    }
    drafts.drop(draftKey);
  };

  /** Which view a page comment was made in: "Full width" or the viewport's name. */
  const pageWhere = (comment: Comment): string =>
    comment.viewport === PAGE_FILL_VIEWPORT_ID ? 'Made at full width' : `Made at ${ctx.detail.design.viewports.find((viewport) => viewport.id === comment.viewport)?.label ?? comment.viewport} size`;

  const open = (board: Board, card: CardHandle, commentId: string | null, draftKey: string, box: () => Box): void => {
    popover = { card, board, commentId, draftKey };
    anchorBox = box;
    ctx.overlay.append(card.el);
    resized.observe(card.el);
    follow();
  };

  const openThread = (board: Board, commentId: string): void => {
    const comment = ctx.comments().find((candidate) => candidate.id === commentId);
    if (!comment) return;
    close();
    const number = ctx.numbers().get(commentId) ?? 0;
    const { anchorState } = pinState(board, comment);
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
    // The card sits beside the pin: a little right of it, level with it.
    open(board, card, commentId, draftKey, () => {
      const pin = frameToScreen(camera.get(), board.art.rect, pinState(board, comment).point);
      return { x: pin.x + 14, y: pin.y - 10, w: 0, h: 0 };
    });
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
    board.selected.hidden = false;
    board.hover.hidden = true;
    const temp = h('span', { class: 'dc-pin dc-temp-pin', 'aria-hidden': 'true' }, '+');
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
    open(board, card, null, draftKey, () => {
      // The outline and the "+" pin follow the design's scroll with the card; the wall's own moves carry them already.
      rectToBox(board, board.selected, element.rect);
      const pinAt = pinFramePoint(element.rect, point, board.scroll);
      temp.style.left = `${pinAt.x}px`;
      temp.style.top = `${pinAt.y}px`;
      const view = camera.get();
      const at = frameToScreen(view, board.art.rect, { x: element.rect.x - board.scroll.x, y: element.rect.y - board.scroll.y });
      return { x: at.x, y: at.y, w: element.rect.w * view.scale, h: element.rect.h * view.scale };
    });
    deps.emitSelection({ type: 'selected', selection });
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

  return { openThread, openComposer, selectionFor, close, closeForMove, follow, setCompanion, current: () => popover, clearSelection, refresh };
};
