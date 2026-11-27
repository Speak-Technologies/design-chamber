// View-model of the comments on a design system's board (system-builder-depth T21). A board comment is anchored to an
// entry key (`token:--brand`, `component:button`), not to a selector, so it survives the board being drawn again; where
// its pin sits comes from the entry's box as the board frame reports it. Pure: no DOM, no service.

import type { CommentStatus, SystemComment, SystemDetail } from '../../shared/types.ts';
import { COMMENT_BODY_MAX } from '../../shared/limits.ts';
import type { Rect } from '../../shared/types.ts';
import { plural } from './format.ts';
import { entryLabel, sectionOfHit } from './system-page-model.ts';

// ---------------------------------------------------------------- numbers and rows

/** Pin numbers: 1.. in creation order, stable when later comments are resolved or deleted. Ties keep list order. */
export const boardPinNumbers = (comments: readonly SystemComment[]): Map<string, number> => {
  const ordered = comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => Date.parse(a.comment.created) - Date.parse(b.comment.created) || a.index - b.index);
  return new Map(ordered.map(({ comment }, position) => [comment.id, position + 1]));
};

/** The entry is in the system as it is now (a token, a component, a pair it still has). */
export const entryInSystem = (detail: SystemDetail, entry: string): boolean => sectionOfHit(detail, entry) !== null;

export const GONE_ENTRY = 'On an entry that’s gone';

export type BoardCommentRow = {
  comment: SystemComment;
  number: number;
  /** What the comment is on: "Button", "--brand", or `GONE_ENTRY`. */
  where: string;
  /** The entry is no longer in the system: listed, never drawn. */
  gone: boolean;
};

/** Every comment as a list row, in pin-number order. */
export const boardCommentRows = (comments: readonly SystemComment[], detail: SystemDetail | null): BoardCommentRow[] => {
  const numbers = boardPinNumbers(comments);
  return comments
    .map((comment) => {
      const gone = detail !== null && !entryInSystem(detail, comment.entry);
      const label = detail === null || gone ? null : entryLabel(detail, comment.entry).text;
      return { comment, number: numbers.get(comment.id) ?? 0, where: gone ? GONE_ENTRY : label || comment.entry, gone };
    })
    .sort((a, b) => a.number - b.number);
};

export type CommentCounts = Record<CommentStatus, number>;

export const boardCommentCounts = (comments: readonly SystemComment[]): CommentCounts => ({
  open: comments.filter((comment) => comment.status === 'open').length,
  sent: comments.filter((comment) => comment.status === 'sent').length,
  resolved: comments.filter((comment) => comment.status === 'resolved').length,
});

/** The rows the list shows before "Show resolved": open first, then sent, each in number order. Resolved ones come after. */
export const splitRows = (rows: readonly BoardCommentRow[]): { live: BoardCommentRow[]; resolved: BoardCommentRow[] } => ({
  live: [...rows.filter((row) => row.comment.status === 'open'), ...rows.filter((row) => row.comment.status === 'sent')],
  resolved: rows.filter((row) => row.comment.status === 'resolved'),
});

export const commentStatusLabel = (status: CommentStatus): string => (status === 'open' ? 'Open' : status === 'sent' ? 'Sent to chat' : 'Resolved');

/** A pin's accessible name: "Comment 3 on Button: Make it rounder (open)". */
export const boardPinLabel = (row: Pick<BoardCommentRow, 'comment' | 'number' | 'where'>): string => {
  const body = row.comment.body.length > 60 ? `${row.comment.body.slice(0, 57)}…` : row.comment.body;
  return `Comment ${row.number} on ${row.where}: ${body} (${commentStatusLabel(row.comment.status).toLowerCase()})`;
};

/** A pin's glyph: its number, a check once resolved. */
export const boardPinGlyph = (row: Pick<BoardCommentRow, 'comment' | 'number'>): string => (row.comment.status === 'resolved' ? '✓' : String(row.number));

// ---------------------------------------------------------------- the send

export type SendAllState = { enabled: boolean; label: string; reason: string | null };

/** "Send comments (N)": what it says, and why when there is nothing to send or no chat yet. */
export const sendAllState = (comments: readonly SystemComment[], linked: boolean, locked: string | null): SendAllState => {
  const open = boardCommentCounts(comments).open;
  const label = open > 0 ? `Send comments (${open})` : 'Send comments';
  if (locked !== null) return { enabled: false, label, reason: locked };
  if (open === 0) return { enabled: false, label, reason: comments.length === 0 ? null : 'Every comment has been sent or resolved. Reopen one to send it again.' };
  return { enabled: true, label, reason: linked ? null : 'No chat is linked yet, so a new chat will start.' };
};

export type BoardSendOutcome = 'sent' | 'composed' | 'outbox' | 'new-session';

export const MARK_FAILED = 'Sent, but the comments could not be marked as sent. Resolve them by hand so they are not sent again.';

/** The toast after a send. One comment is named by its number. */
export const boardSendResult = (input: { outcome: BoardSendOutcome; sent: number; omitted: number; number: number | null; markFailed?: boolean }): { kind: 'success' | 'info'; message: string } => {
  const { outcome, sent, omitted, number } = input;
  if (sent === 0) return { kind: 'info', message: 'There are no open comments to send.' };
  if (input.markFailed === true) return { kind: 'info', message: MARK_FAILED };
  if (omitted > 0) return { kind: 'info', message: `${sent} of ${sent + omitted} comments sent. Send again for the rest.` };
  const what = sent === 1 && number !== null ? `comment ${number}` : plural(sent, 'comment');
  if (outcome === 'new-session') return { kind: 'success', message: `Started a new chat with ${what}.` };
  if (outcome === 'composed') return { kind: 'info', message: `The agent is busy, so ${what} ${sent === 1 ? 'is' : 'are'} waiting in the composer.` };
  if (outcome === 'outbox') return { kind: 'success', message: `Opening the system’s chat with ${what}.` };
  return { kind: 'success', message: `${what.charAt(0).toUpperCase()}${what.slice(1)} sent to the chat.` };
};

/** Why "Send this" must not send: the card can be older than the comment (sent or resolved from the list meanwhile). */
export const sendOneProblem = (comment: Pick<SystemComment, 'status'> | undefined): string | null => {
  if (comment === undefined) return 'That comment is gone, so there is nothing to send.';
  if (comment.status === 'sent') return 'That comment was already sent to the chat.';
  if (comment.status === 'resolved') return 'That comment is resolved, so it was not sent. Reopen it first.';
  return null;
};

/** The comment text, checked as the service will: the problem in words, or null. */
export const commentBodyProblem = (body: string): string | null => {
  if (body.trim() === '') return 'Write what should change, then add the comment.';
  if (body.trim().length > COMMENT_BODY_MAX) return `Keep a comment under ${COMMENT_BODY_MAX} characters.`;
  return null;
};

export const DAMAGED_TITLE = 'Some comments couldn’t be read';
export const DAMAGED_BODY = 'The comments file was damaged. These are the comments that could be read. The next comment you add or change saves them in a new file and keeps the old one aside.';

export const EMPTY_COMMENTS = 'No comments yet. Turn on Comment and click an entry on the board to pin a note to it.';

// ---------------------------------------------------------------- pins on the board

export type PinSpot = { id: string; x: number; y: number; inView: boolean };

/** How far a pin's centre sits inside its entry's top right corner: it reads as a badge on the corner, off the entry's label. */
const CORNER_INSET = 4;

/** The spot of the `index`th pin on an entry's box (document pixels), in frame pixels after `scroll`. */
export const entrySpot = (rect: Rect, scroll: { x: number; y: number }, index = 0, pin = 24): { x: number; y: number } => ({
  x: Math.max(rect.x + CORNER_INSET, rect.x + rect.w - CORNER_INSET - index * (pin + 4)) - scroll.x,
  y: rect.y + CORNER_INSET - scroll.y,
});

/**
 * Where each drawn pin sits, in board-frame pixels: on the top right corner of its entry's box, with
 * several comments on one entry in a row leftwards. `rects` are document pixels (the frame's own), `scroll` its scroll
 * position, `view` the frame's size. A pin whose spot is outside the view is not shown.
 */
export const boardPinSpots = (
  rows: readonly Pick<BoardCommentRow, 'comment' | 'gone'>[],
  rects: ReadonlyMap<string, Rect>,
  scroll: { x: number; y: number },
  view: { width: number; height: number },
  pin = 24,
): PinSpot[] => {
  const perEntry = new Map<string, number>();
  const spots: PinSpot[] = [];
  for (const row of rows) {
    if (row.gone) continue;
    const rect = rects.get(row.comment.entry);
    if (rect === undefined) continue;
    const index = perEntry.get(row.comment.entry) ?? 0;
    perEntry.set(row.comment.entry, index + 1);
    const { x, y } = entrySpot(rect, scroll, index, pin);
    const inView = x >= 0 && y >= 0 && x <= view.width && y <= view.height;
    spots.push({ id: row.comment.id, x, y, inView });
  }
  return spots;
};

/** Where a card floats next to a point in a box: right of and below it when it fits, else flipped, always inside. */
export const cardPlacement = (at: { x: number; y: number }, card: { width: number; height: number }, box: { width: number; height: number }, gap = 14): { left: number; top: number } => {
  const fitsRight = at.x + gap + card.width <= box.width - 8;
  const left = fitsRight ? at.x + gap : at.x - gap - card.width;
  const fitsBelow = at.y + card.height <= box.height - 8;
  const top = fitsBelow ? at.y - 12 : at.y - card.height + 12;
  return { left: Math.round(Math.min(Math.max(8, left), Math.max(8, box.width - card.width - 8))), top: Math.round(Math.min(Math.max(8, top), Math.max(8, box.height - card.height - 8))) };
};

// ---------------------------------------------------------------- drafts

// The same behaviour as the wall's comment drafts (native-extras `comment-drafts`): the words typed into a card and not
// saved are kept for as long as Design Chamber is open, and the same card shows them again. Only a save, a send, a delete
// or emptying the box throws them away.

/** The text worth keeping: what differs from the saved words (`''` for a new comment), as typed. Null: nothing to lose. */
export const unsavedText = (value: string, saved = ''): string | null => (value.trim() === '' || value.trim() === saved.trim() ? null : value);

/** The new-comment card on one entry of one system. */
export const boardComposerKey = (systemId: string, entry: string): string => JSON.stringify(['board-new', systemId, entry]);

/** The card of one existing board comment. */
export const boardThreadKey = (systemId: string, commentId: string): string => JSON.stringify(['board-thread', systemId, commentId]);

export type DraftStore = {
  get: (key: string) => string | null;
  /** What a card holds now; null forgets anything older. */
  keep: (key: string, text: string | null) => void;
  drop: (key: string) => void;
};

export const createDraftStore = (): DraftStore => {
  const drafts = new Map<string, string>();
  return {
    get: (key) => drafts.get(key) ?? null,
    keep: (key, text) => void (text === null ? drafts.delete(key) : drafts.set(key, text)),
    drop: (key) => void drafts.delete(key),
  };
};
