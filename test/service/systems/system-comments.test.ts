// The board comments file, pure parts (documentation/specs/system-builder-depth.md §13 T20): what reads
// as damaged, what is kept from a damaged file, and the mark that never marks twice.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SYSTEM_COMMENTS_MAX } from '../../../src/shared/limits.ts';
import type { SystemComment } from '../../../src/shared/types.ts';
import {
  mintSystemCommentId,
  parseSystemComment,
  parseSystemCommentsText,
  serializeSystemComments,
  withCommentAdded,
  withCommentsMarkedSent,
  SYSTEM_COMMENTS_FULL,
} from '../../../src/service/systems/comments.ts';

const one = (n: number, over: Partial<SystemComment> = {}): SystemComment => ({
  id: `c_${String(n).padStart(8, '0')}`,
  entry: 'overview',
  body: 'Shorter.',
  status: 'open',
  created: '2026-11-27T10:00:00.000Z',
  sentAt: null,
  ...over,
});

test('a sound file reads back exactly; unknown keys on a comment are dropped', () => {
  const comments = [one(1), one(2, { status: 'sent', sentAt: '2026-11-27T11:00:00.000Z' })];
  assert.deepEqual(parseSystemCommentsText(serializeSystemComments(comments)), { kind: 'ok', comments });
  assert.deepEqual(parseSystemComment({ ...one(1), html: '<b>' }), one(1));
});

test('anything off the shape is damaged; what validated is kept', () => {
  for (const text of ['', 'null', '[]', '{"v":2,"comments":[]}', '{"v":1}', '{"v":1,"comments":{}}']) {
    assert.deepEqual(parseSystemCommentsText(text), { kind: 'damaged', comments: [] }, text);
  }
  const bad: unknown[] = [
    { ...one(9), id: 'x' },
    { ...one(9), entry: '../tokens.css' },
    { ...one(9), entry: 'token:--a b' },
    { ...one(9), body: '  ' },
    { ...one(9), body: 'x'.repeat(2001) },
    { ...one(9), status: 'done' },
    { ...one(9), created: 'yesterday' },
    { ...one(9), sentAt: 3 },
    'c_00000009',
  ];
  for (const comment of bad) {
    const read = parseSystemCommentsText(JSON.stringify({ v: 1, comments: [one(1), comment] }));
    assert.deepEqual(read, { kind: 'damaged', comments: [one(1)] }, JSON.stringify(comment).slice(0, 60));
  }
  // A repeated id keeps the first.
  assert.deepEqual(parseSystemCommentsText(JSON.stringify({ v: 1, comments: [one(1), one(1, { body: 'Again.' })] })), { kind: 'damaged', comments: [one(1)] });
  // More than the cap: the first SYSTEM_COMMENTS_MAX are kept and the file is damaged.
  const many = Array.from({ length: SYSTEM_COMMENTS_MAX + 1 }, (_, n) => one(n));
  const read = parseSystemCommentsText(JSON.stringify({ v: 1, comments: many }));
  assert.equal(read.kind, 'damaged');
  assert.equal(read.kind === 'damaged' ? read.comments.length : 0, SYSTEM_COMMENTS_MAX);
});

test('the add refuses past the cap; ids are fresh and on the pattern', () => {
  const full = Array.from({ length: SYSTEM_COMMENTS_MAX }, (_, n) => one(n));
  assert.throws(() => withCommentAdded(full, { entry: 'overview', body: 'x' }, '2026-11-27T12:00:00.000Z'), { code: 'conflict', message: SYSTEM_COMMENTS_FULL });
  const ids = ['00000001', 'abcdef012345'];
  assert.equal(mintSystemCommentId(new Set(['c_00000001']), () => ids.shift() ?? 'zzzz'), 'c_abcdef012345');
  assert.throws(() => mintSystemCommentId(new Set(), () => 'NOT-HEX'), { code: 'conflict' });
});

test('mark-sent: open becomes sent once; a retry keeps the first sentAt; resolved and unknown are left alone', () => {
  const comments = [one(1), one(2, { status: 'resolved' })];
  const first = withCommentsMarkedSent(comments, ['c_00000001', 'c_00000002', 'c_99999999'], '2026-11-27T12:00:00.000Z');
  assert.equal(first.changed, true);
  assert.deepEqual(first.named, [one(1, { status: 'sent', sentAt: '2026-11-27T12:00:00.000Z' }), one(2, { status: 'resolved' })]);
  const retry = withCommentsMarkedSent(first.comments, ['c_00000001'], '2026-11-27T13:00:00.000Z');
  assert.equal(retry.changed, false);
  assert.deepEqual(retry.comments, first.comments);
  assert.equal(retry.named[0]?.sentAt, '2026-11-27T12:00:00.000Z');
});
