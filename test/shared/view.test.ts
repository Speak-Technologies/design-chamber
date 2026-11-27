import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clipViewText, flattenViewText, isViewFresh, VIEW_STALE_MS } from '../../src/shared/view.ts';

test('flattenViewText makes one line out of whitespace and control characters', () => {
  assert.equal(flattenViewText('  Ship\tfaster\n\n today\u0000now !  '), 'Ship faster today now !');
  assert.equal(flattenViewText('\u0001\u0002'), '');
});

test('clipViewText cuts to the cap with an ellipsis and leaves a short line alone', () => {
  assert.equal(clipViewText('short', 10), 'short');
  assert.equal(clipViewText('a'.repeat(10), 10), 'a'.repeat(10));
  const clipped = clipViewText('a'.repeat(11), 10);
  assert.equal(clipped.length, 10);
  assert.equal(clipped, `${'a'.repeat(9)}…`);
});

test('isViewFresh: recent is fresh, older than three minutes or unreadable is not, a far future clock is not', () => {
  const now = Date.UTC(2026, 10, 27, 12, 0, 0);
  const at = (offsetMs: number): { at: string } => ({ at: new Date(now + offsetMs).toISOString() });
  assert.equal(isViewFresh(at(0), now), true);
  assert.equal(isViewFresh(at(-VIEW_STALE_MS), now), true);
  assert.equal(isViewFresh(at(-VIEW_STALE_MS - 1), now), false);
  assert.equal(isViewFresh(at(VIEW_STALE_MS + 1), now), false);
  assert.equal(isViewFresh({ at: 'yesterday' }, now), false);
  assert.equal(isViewFresh({ at: '' }, now), false);
});
