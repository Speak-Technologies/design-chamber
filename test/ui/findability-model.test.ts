import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RestoreVersionResponse } from '../../src/shared/api.ts';
import type { VersionSummary } from '../../src/shared/types.ts';
import {
  commentsChip,
  dismissedTip,
  restoreFailedMessage,
  restoreNotice,
  shouldShowTip,
  undoFailedNotice,
  undoneNotice,
} from '../../src/ui/model/findability-model.ts';

const version = (n: number, treeHash: string): VersionSummary => ({ id: `v${n}`, n, created: '2026-11-08T10:00:00.000Z', reason: 'restored', sessionId: null, treeHash, bytes: 10, fileCount: 2 });
const answer = (over: Partial<RestoreVersionResponse>): RestoreVersionResponse => ({
  restorePoint: version(8, 'old'),
  restored: version(9, 'new'),
  before: version(8, 'old'),
  ...over,
});

test('the tip shows until a stored { dismissed: true } says otherwise', () => {
  assert.equal(shouldShowTip(undefined), true);
  assert.equal(shouldShowTip(null), true);
  assert.equal(shouldShowTip({ dismissed: true, at: '2026-11-08T10:00:00.000Z' }), false);
  assert.equal(shouldShowTip({ dismissed: true }), false);
});

test('storage holding garbage shows the tip again', () => {
  for (const stored of ['yes', 'true', 1, true, [], {}, { dismissed: 'true' }, { dismissed: false }, { dismissed: 1 }]) {
    assert.equal(shouldShowTip(stored), true, JSON.stringify(stored));
  }
});

test('"Got it" writes a value the tip check reads as dismissed', () => {
  const stored = dismissedTip(new Date('2026-11-08T10:00:00.000Z'));
  assert.deepEqual(stored, { dismissed: true, at: '2026-11-08T10:00:00.000Z' });
  assert.equal(shouldShowTip(stored), false);
});

test('the Comments chip is icon only at 0 and counts open comments from 1', () => {
  assert.deepEqual(commentsChip(0), { label: '', aria: 'Comments' });
  assert.deepEqual(commentsChip(1), { label: '1', aria: 'Comments, 1 open' });
  assert.deepEqual(commentsChip(12), { label: '12', aria: 'Comments, 12 open' });
});

test('a restore with a restore point names it and offers Undo to the version that holds the earlier state', () => {
  const notice = restoreNotice(answer({}), { n: 3 });
  assert.deepEqual(notice, { title: 'Restored v3', body: 'Your previous state is saved as v8.', undoTo: { id: 'v8', n: 8 } });
});

test('a restore with no restore point points at the newest version, which holds the earlier state', () => {
  const notice = restoreNotice(answer({ restorePoint: null, before: version(7, 'old') }), { n: 3 });
  assert.deepEqual(notice, { title: 'Restored v3', body: 'Your previous state is v7 in Versions.', undoTo: { id: 'v7', n: 7 } });
});

test('restoring a version that matches the current design says nothing changed and offers no Undo', () => {
  const notice = restoreNotice(answer({ restorePoint: null, before: version(3, 'same'), restored: version(3, 'same') }), { n: 3 });
  assert.deepEqual(notice, { title: 'v3 matches the current design', body: 'Nothing changed.', undoTo: null });
});

test('the title uses the version the user pressed, not the snapshot taken after the restore', () => {
  assert.equal(restoreNotice(answer({ restored: version(12, 'new') }), { n: 3 }).title, 'Restored v3');
});

test('an older service answer without `before` restores fine but offers no Undo', () => {
  const { before, ...older } = answer({});
  void before;
  // The type says `before` is there; an older service build sends none.
  const notice = restoreNotice(older as RestoreVersionResponse, { n: 3 });
  assert.equal(notice.undoTo, null);
  assert.equal(notice.title, 'Restored v3');
});

test('Undo reports the version it went back to and that the undone one stays in Versions', () => {
  assert.deepEqual(undoneNotice({ n: 8 }, { n: 3 }), { title: 'Back to v8', body: 'v3 is still in Versions.' });
});

test('a failed Undo says where the earlier state is', () => {
  assert.deepEqual(undoFailedNotice('The service is not running.', { n: 8 }), { title: 'Couldn’t undo', body: 'The service is not running. Your earlier state is saved as v8 in Versions.' });
});

test('a failed restore says nothing was changed', () => {
  assert.equal(restoreFailedMessage(3, 'The service is not running.'), 'Couldn’t restore v3. The service is not running. Nothing was changed.');
});
