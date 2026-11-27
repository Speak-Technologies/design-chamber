// Comments on a design system's board (system-builder-depth T21): numbers, rows and gone entries, the send button and
// its result, where pins and cards sit, the drafts, and which change events read what again. Pure view-model tests; the
// DOM is walked in the visual harness (test/ui/visual/scenarios/system-comments.mjs).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SystemComment, SystemDetail, SystemToken } from '../../src/shared/types.ts';
import { COMMENT_BODY_MAX } from '../../src/shared/limits.ts';
import {
  GONE_ENTRY,
  MARK_FAILED,
  boardCommentCounts,
  boardCommentRows,
  boardComposerKey,
  boardPinGlyph,
  boardPinLabel,
  boardPinNumbers,
  boardPinSpots,
  boardSendResult,
  boardThreadKey,
  cardPlacement,
  commentBodyProblem,
  createDraftStore,
  entrySpot,
  sendAllState,
  sendOneProblem,
  splitRows,
  unsavedText,
} from '../../src/ui/model/board-comments-model.ts';
import { boardCommentsChanged, isBoardCommentsEvent, systemDetailChanged, systemsListShouldRefresh } from '../../src/ui/model/system-events-model.ts';
import { shouldRefetchSystem } from '../../src/ui/model/design-system-model.ts';

const token = (name: string): SystemToken => ({
  name,
  section: 'colours',
  group: null,
  light: { text: '#2f6f6a', editable: 'ok', problem: null },
  dark: null,
  note: '',
  breakpoint: false,
  alsoSet: [],
  fromCode: false,
  problem: null,
});

// Safe: the model reads only the lists named here; the rest of a detail is not looked at.
const detail = (): SystemDetail =>
  ({
    tokens: [token('--brand')],
    type: [],
    fonts: [],
    logos: [],
    icons: [],
    notes: [],
    patterns: [],
    brand: [],
    pairs: [],
    components: [{ id: 'button', name: 'Button' }],
  }) as unknown as SystemDetail;

const comment = (id: string, entry: string, status: SystemComment['status'], minute: number, body = `Body of ${id}`): SystemComment => ({
  id,
  entry,
  body,
  status,
  created: `2026-11-27T10:${String(minute).padStart(2, '0')}:00.000Z`,
  sentAt: status === 'sent' ? '2026-11-27T11:00:00.000Z' : null,
});

const SAMPLE = [
  comment('c_three', 'component:gone', 'sent', 30),
  comment('c_one', 'component:button', 'open', 10),
  comment('c_two', 'token:--brand', 'resolved', 20),
  comment('c_four', 'component:button', 'open', 40),
];

test('pins are numbered in the order the comments were made, whatever the list order', () => {
  const numbers = boardPinNumbers(SAMPLE);
  assert.deepEqual([...numbers.entries()], [['c_one', 1], ['c_two', 2], ['c_three', 3], ['c_four', 4]]);
  // Deleting an earlier one renumbers the rest from the creation order, never from the list order.
  assert.equal(boardPinNumbers(SAMPLE.filter((entry) => entry.id !== 'c_one')).get('c_four'), 3);
});

test('rows name their entry, and a comment on an entry the system no longer has is listed as gone, not drawn', () => {
  const rows = boardCommentRows(SAMPLE, detail());
  assert.deepEqual(rows.map((row) => [row.number, row.where, row.gone]), [[1, 'Button', false], [2, '--brand', false], [3, GONE_ENTRY, true], [4, 'Button', false]]);
  assert.equal(GONE_ENTRY, 'On an entry that’s gone');
  // Before the system has loaded nothing is called gone: the key stands in for the name.
  assert.deepEqual(boardCommentRows([SAMPLE[0] as SystemComment], null).map((row) => [row.where, row.gone]), [['component:gone', false]]);
  // A gone entry gets no pin spot, whatever box the board reports for it.
  const rects = new Map([['component:gone', { x: 0, y: 0, w: 100, h: 40 }]]);
  assert.deepEqual(boardPinSpots(rows, rects, { x: 0, y: 0 }, { width: 800, height: 600 }), []);
});

test('the list shows open, then sent; resolved ones wait behind their own toggle', () => {
  const split = splitRows(boardCommentRows(SAMPLE, detail()));
  assert.deepEqual(split.live.map((row) => row.comment.id), ['c_one', 'c_four', 'c_three']);
  assert.deepEqual(split.resolved.map((row) => row.comment.id), ['c_two']);
  assert.deepEqual(boardCommentCounts(SAMPLE), { open: 2, sent: 1, resolved: 1 });
});

test('a pin reads its number, a check once resolved, and says what it is on for a screen reader', () => {
  const [one, two] = boardCommentRows(SAMPLE, detail());
  assert.ok(one && two);
  assert.equal(boardPinGlyph(one), '1');
  assert.equal(boardPinGlyph(two), '✓');
  assert.equal(boardPinLabel(one), 'Comment 1 on Button: Body of c_one (open)');
  const long = { ...one, comment: { ...one.comment, body: 'x'.repeat(80) } };
  assert.equal(boardPinLabel(long), `Comment 1 on Button: ${'x'.repeat(57)}… (open)`);
});

test('Send comments (N) counts the open ones and says why it can’t send', () => {
  assert.deepEqual(sendAllState(SAMPLE, true, null), { enabled: true, label: 'Send comments (2)', reason: null });
  assert.equal(sendAllState(SAMPLE, false, null).reason, 'No chat is linked yet, so a new chat will start.');
  const none = sendAllState(SAMPLE.map((entry) => ({ ...entry, status: 'resolved' as const })), true, null);
  assert.deepEqual(none, { enabled: false, label: 'Send comments', reason: 'Every comment has been sent or resolved. Reopen one to send it again.' });
  assert.deepEqual(sendAllState([], true, null), { enabled: false, label: 'Send comments', reason: null });
  // An old version on show: the reason is the lock's own sentence.
  assert.deepEqual(sendAllState(SAMPLE, true, 'You’re looking at an old version.'), { enabled: false, label: 'Send comments (2)', reason: 'You’re looking at an old version.' });
});

test('the toast after a send says what went, names one comment by number, and never claims a mark it couldn’t make', () => {
  assert.deepEqual(boardSendResult({ outcome: 'sent', sent: 2, omitted: 0, number: null }), { kind: 'success', message: '2 comments sent to the chat.' });
  assert.deepEqual(boardSendResult({ outcome: 'sent', sent: 1, omitted: 0, number: 4 }), { kind: 'success', message: 'Comment 4 sent to the chat.' });
  assert.deepEqual(boardSendResult({ outcome: 'new-session', sent: 1, omitted: 0, number: 4 }), { kind: 'success', message: 'Started a new chat with comment 4.' });
  assert.deepEqual(boardSendResult({ outcome: 'composed', sent: 3, omitted: 0, number: null }), { kind: 'info', message: 'The agent is busy, so 3 comments are waiting in the composer.' });
  assert.deepEqual(boardSendResult({ outcome: 'outbox', sent: 1, omitted: 0, number: 2 }), { kind: 'success', message: 'Opening the system’s chat with comment 2.' });
  assert.deepEqual(boardSendResult({ outcome: 'sent', sent: 3, omitted: 2, number: null }), { kind: 'info', message: '3 of 5 comments sent. Send again for the rest.' });
  assert.deepEqual(boardSendResult({ outcome: 'sent', sent: 2, omitted: 0, number: null, markFailed: true }), { kind: 'info', message: MARK_FAILED });
  assert.deepEqual(boardSendResult({ outcome: 'sent', sent: 0, omitted: 0, number: null }), { kind: 'info', message: 'There are no open comments to send.' });
});

test('"Send this" refuses a comment that was sent, resolved or deleted since the card opened', () => {
  assert.equal(sendOneProblem({ status: 'open' }), null);
  assert.equal(sendOneProblem({ status: 'sent' }), 'That comment was already sent to the chat.');
  assert.equal(sendOneProblem({ status: 'resolved' }), 'That comment is resolved, so it was not sent. Reopen it first.');
  assert.equal(sendOneProblem(undefined), 'That comment is gone, so there is nothing to send.');
});

test('a comment needs words, and no more than the service takes', () => {
  assert.equal(commentBodyProblem('   '), 'Write what should change, then add the comment.');
  assert.equal(commentBodyProblem('Rounder'), null);
  assert.equal(commentBodyProblem('x'.repeat(COMMENT_BODY_MAX)), null);
  assert.equal(commentBodyProblem('x'.repeat(COMMENT_BODY_MAX + 1)), `Keep a comment under ${COMMENT_BODY_MAX} characters.`);
});

test('pins sit on the top right corner of their entry, follow the scroll, and line up leftwards on a shared entry', () => {
  const rows = boardCommentRows(SAMPLE, detail());
  const rects = new Map([
    ['component:button', { x: 100, y: 200, w: 300, h: 80 }],
    ['token:--brand', { x: 20, y: 40, w: 110, h: 90 }],
  ]);
  const view = { width: 800, height: 600 };
  const spots = boardPinSpots(rows, rects, { x: 0, y: 0 }, view);
  assert.deepEqual(spots.map((spot) => [spot.id, spot.x, spot.y, spot.inView]), [
    ['c_one', 396, 204, true],
    ['c_two', 126, 44, true],
    ['c_four', 368, 204, true],
  ]);
  // Scrolled down 100: the same pins, 100 px higher; scrolled past, out of view (not shown).
  assert.deepEqual(boardPinSpots(rows, rects, { x: 0, y: 100 }, view).map((spot) => spot.y), [104, -56, 104]);
  assert.deepEqual(boardPinSpots(rows, rects, { x: 0, y: 100 }, view).map((spot) => spot.inView), [true, false, true]);
  // An entry the board doesn't draw (yet) has no spot; its comment is still in the rows.
  assert.equal(boardPinSpots(rows, new Map(), { x: 0, y: 0 }, view).length, 0);
  // Never left of the entry's own box, however many share it.
  assert.equal(entrySpot({ x: 10, y: 0, w: 30, h: 20 }, { x: 0, y: 0 }, 5).x, 14);
});

test('a card sits right of and below its point, flips near an edge, and stays inside the board', () => {
  const card = { width: 300, height: 180 };
  const box = { width: 900, height: 600 };
  assert.deepEqual(cardPlacement({ x: 100, y: 100 }, card, box), { left: 114, top: 88 });
  assert.deepEqual(cardPlacement({ x: 800, y: 100 }, card, box), { left: 486, top: 88 });
  assert.deepEqual(cardPlacement({ x: 100, y: 550 }, card, box), { left: 114, top: 382 });
  // The rail at 320: a card wider and taller than the room it has is pinned to the top left.
  assert.deepEqual(cardPlacement({ x: 150, y: 40 }, card, { width: 290, height: 220 }), { left: 8, top: 8 });
});

test('drafts keep what differs from the saved words, per card, until thrown away', () => {
  assert.equal(unsavedText('  '), null);
  assert.equal(unsavedText('Rounder'), 'Rounder');
  assert.equal(unsavedText('Same words ', 'Same words'), null);
  assert.equal(unsavedText('New words', 'Old words'), 'New words');
  const drafts = createDraftStore();
  const onButton = boardComposerKey('harbor', 'component:button');
  assert.notEqual(onButton, boardComposerKey('tidepool', 'component:button'));
  assert.notEqual(onButton, boardThreadKey('harbor', 'component:button'));
  drafts.keep(onButton, 'Half typed');
  assert.equal(drafts.get(onButton), 'Half typed');
  drafts.keep(onButton, null);
  assert.equal(drafts.get(onButton), null);
  drafts.keep(onButton, 'Again');
  drafts.drop(onButton);
  assert.equal(drafts.get(onButton), null);
});

test('a comment event reads only the comments again: not the system, its board, the systems list or a design’s system', () => {
  const comments = { slug: null, kind: 'system', system: 'harbor', systemChange: 'comments' };
  const files = { slug: null, kind: 'system', system: 'harbor', systemChange: 'files' };
  const one = (event: typeof comments, reset = false) => ({ reset, events: [event] });
  assert.equal(isBoardCommentsEvent(comments), true);
  assert.equal(isBoardCommentsEvent(files), false);
  assert.equal(boardCommentsChanged(one(comments), 'harbor'), true);
  assert.equal(boardCommentsChanged(one(comments), 'tidepool'), false);
  assert.equal(boardCommentsChanged(one(files), 'harbor'), false);
  assert.equal(systemDetailChanged(one(comments), 'harbor'), false);
  assert.equal(systemDetailChanged(one(files), 'harbor'), true);
  assert.equal(systemDetailChanged(one(files), 'tidepool'), false);
  assert.equal(systemsListShouldRefresh(one(comments)), false);
  assert.equal(systemsListShouldRefresh(one(files)), true);
  assert.equal(systemsListShouldRefresh({ reset: false, events: [{ kind: 'root' }] }), true);
  assert.equal(shouldRefetchSystem(one(comments), 'a'), false);
  assert.equal(shouldRefetchSystem(one(files), 'a'), true);
  // A comment next to a real change in one batch still reads the rest again.
  assert.equal(systemsListShouldRefresh({ reset: false, events: [comments, files] }), true);
  // A feed restart reads everything again.
  assert.equal(boardCommentsChanged(one(comments, true), 'tidepool'), true);
  assert.equal(systemsListShouldRefresh(one(comments, true)), true);
});
