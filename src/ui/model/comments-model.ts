// View-model of the comments drawer (P3) and the pins on the wall.

import type { Comment, CommentStatus, Screen, Viewport } from '../../shared/types.ts';
import { PAGE_FILL_VIEWPORT_ID } from '../../shared/limits.ts';
import { MESSAGES, type SendCommentsResult } from '../../guest/flows.ts';
import { plural, viewportLabel } from './format.ts';

export type CommentFilter = CommentStatus;

export const COMMENT_FILTERS: ReadonlyArray<{ id: CommentFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'sent', label: 'Sent' },
  { id: 'resolved', label: 'Resolved' },
];

export const statusLabel = (status: CommentStatus): string => (status === 'open' ? 'Open' : status === 'sent' ? 'Sent to chat' : 'Resolved');

/**
 * Pin numbers: 1.. in creation order across the whole design, stable when other comments
 * are resolved or deleted later than this one. Ties keep array order.
 */
export const pinNumbers = (comments: readonly Comment[]): Map<string, number> => {
  const ordered = comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => Date.parse(a.comment.created) - Date.parse(b.comment.created) || a.index - b.index);
  const numbers = new Map<string, number>();
  ordered.forEach(({ comment }, position) => numbers.set(comment.id, position + 1));
  return numbers;
};

/** `removed`: the screen is not in the design any more (moved to trash, or dropped by the agent); its pins are not drawn. */
export type CommentGroup = { key: string; title: string; comments: Comment[]; removed?: true };

/** The title of a group of comments on a screen that is gone: its id, since the title went with the entry. */
export const removedGroupTitle = (screenId: string): string => `${screenId} · Screen removed`;

/**
 * Drawer groups: one per screen in wall order, then one per screen that is gone (in the order its comments first
 * appear), each "<id> · Screen removed". A page has one group, titled with the page's name.
 */
export const groupComments = (comments: readonly Comment[], screens: readonly Screen[], pageTitle: string): CommentGroup[] => {
  const groups: CommentGroup[] = [];
  const known = new Set<string>();
  const onPage = comments.filter((comment) => comment.screen === null);
  if (onPage.length > 0) groups.push({ key: 'page', title: pageTitle, comments: onPage });
  for (const screen of screens) {
    known.add(screen.id);
    const mine = comments.filter((comment) => comment.screen === screen.id);
    if (mine.length > 0) groups.push({ key: screen.id, title: screen.title, comments: mine });
  }
  const gone = new Map<string, Comment[]>();
  for (const comment of comments) {
    if (comment.screen === null || known.has(comment.screen)) continue;
    const list = gone.get(comment.screen);
    if (list) list.push(comment);
    else gone.set(comment.screen, [comment]);
  }
  for (const [screen, list] of gone) groups.push({ key: `__removed:${screen}`, title: removedGroupTitle(screen), comments: list, removed: true });
  return groups;
};

export const countByStatus = (comments: readonly Comment[]): Record<CommentStatus, number> => ({
  open: comments.filter((comment) => comment.status === 'open').length,
  sent: comments.filter((comment) => comment.status === 'sent').length,
  resolved: comments.filter((comment) => comment.status === 'resolved').length,
});

/** Where a comment was made: "Laptop 1280×800", or "Full width" for a page's fill view (a design viewport of that id wins). */
export const viewportOf = (viewports: readonly Viewport[], id: string): string => {
  const viewport = viewports.find((candidate) => candidate.id === id);
  if (viewport) return viewportLabel(viewport);
  return id === PAGE_FILL_VIEWPORT_ID ? 'Full width' : id;
};

export type SendState = { enabled: boolean; label: string; reason: string | null };

/** The drawer footer button: what it says, and why when it is disabled. */
export const sendState = (comments: readonly Comment[], linked: boolean): SendState => {
  const open = comments.filter((comment) => comment.status === 'open').length;
  if (open === 0) return { enabled: false, label: 'Send comments to chat', reason: 'Add a comment first, or reopen a resolved one.' };
  const noun = open === 1 ? 'comment' : 'comments';
  return { enabled: true, label: `Send ${open} ${noun} to chat`, reason: linked ? null : 'No chat is linked yet, so a new chat will start.' };
};

/** Pin glyph: the number while the comment is live, a check once resolved. */
export const pinGlyph = (comment: Comment, number: number): string => (comment.status === 'resolved' ? '✓' : String(number));

/** Pin accessible name: "Comment 3: Make this shorter (open)". */
export const pinAriaLabel = (comment: Comment, number: number): string => {
  const body = comment.body.length > 60 ? `${comment.body.slice(0, 57)}…` : comment.body;
  return `Comment ${number}: ${body} (${statusLabel(comment.status).toLowerCase()})`;
};

export type SendCopy = { kind: 'info' | 'success'; message: string };

/**
 * The toast after comments were sent, or null when the flow already told the user (a busy agent:
 * the revision is in the composer). One comment is named by its pin number when that is known.
 */
export const sendResultCopy = (result: Pick<SendCommentsResult, 'outcome' | 'commentIds' | 'omitted' | 'markFailed'>, pinNumber: number | null): SendCopy | null => {
  const sent = result.commentIds.length;
  if (result.outcome === 'nothing') return { kind: 'info', message: 'There are no open comments to send.' };
  if (result.markFailed) return { kind: 'info', message: MESSAGES.markFailed };
  if (result.omitted.length > 0) return { kind: 'info', message: `${sent} of ${sent + result.omitted.length} comments sent. Send again for the rest.` };
  const named = sent === 1 && pinNumber !== null;
  if (result.outcome === 'new-session') return { kind: 'success', message: `Started a new chat with ${named ? `comment ${pinNumber}` : plural(sent, 'comment')}.` };
  if (result.outcome === 'composed') return null;
  return { kind: 'success', message: named ? `Comment ${pinNumber} sent to the chat.` : `${plural(sent, 'comment')} sent to the chat.` };
};

/**
 * Why "Send this" must not send, or null when it may. A thread card can be older than its comment:
 * the comment may have been sent from the list, resolved, or deleted since the card was built.
 */
export const sendThisProblem = (comment: Pick<Comment, 'status'> | undefined): string | null => {
  if (comment === undefined) return 'That comment is gone, so there is nothing to send.';
  if (comment.status === 'sent') return 'That comment was already sent to the chat.';
  if (comment.status === 'resolved') return 'That comment is resolved, so it was not sent. Reopen it first.';
  return null;
};
