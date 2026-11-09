import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import type { RestoreVersionResponse } from '../../src/shared/api.ts';
import type { VersionSummary } from '../../src/shared/types.ts';
import { RESTORE_NOTICE_MS, SHORT_NOTICE_MS } from '../../src/ui/model/findability-model.ts';
import { createHoldableTimer } from '../../src/ui/model/holdable-timer.ts';
import { createRestoreCore, type RestoreView } from '../../src/ui/model/restore-core.ts';

const version = (n: number, treeHash: string): VersionSummary => ({ id: `v${n}`, n, created: '2026-11-08T10:00:00.000Z', reason: 'restored', sessionId: null, treeHash, bytes: 10, fileCount: 2 });
const answer = (over: Partial<RestoreVersionResponse> = {}): RestoreVersionResponse => ({ restorePoint: version(8, 'old'), restored: version(9, 'new'), before: version(8, 'old'), ...over });

type Call = [string, ...unknown[]];

/** A core wired to a fake service: every `restore(id)` waits for the test to answer it. */
const harness = () => {
  const calls: Call[] = [];
  const asked: string[] = [];
  const pending: Array<{ id: string; resolve: (value: RestoreVersionResponse) => void; reject: (error: Error) => void }> = [];
  let refreshFails = false;
  const view: RestoreView = {
    busy: (id) => calls.push(['busy', id]),
    restoreFailed: (v, message) => calls.push(['restoreFailed', v.id, message]),
    reloaded: () => calls.push(['reloaded']),
    restored: (v, notice, ttlMs) => calls.push(['restored', v.id, notice, ttlMs]),
    undone: (notice, ttlMs) => calls.push(['undone', notice, ttlMs]),
    undoFailed: (to, from, notice) => calls.push(['undoFailed', to.id, from.id, notice]),
  };
  const core = createRestoreCore({
    restore: (id) => {
      asked.push(id);
      return new Promise((resolve, reject) => pending.push({ id, resolve, reject }));
    },
    refresh: () => (refreshFails ? Promise.reject(new Error('feed down')) : Promise.resolve()),
    describe: (error) => (error instanceof Error ? error.message : 'unknown'),
    view,
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return {
    core,
    calls,
    asked,
    failRefresh: () => void (refreshFails = true),
    answerNext: async (value: RestoreVersionResponse) => {
      pending.shift()?.resolve(value);
      await settle();
    },
    failNext: async (message: string) => {
      pending.shift()?.reject(new Error(message));
      await settle();
    },
    kinds: () => calls.map((call) => call[0]),
  };
};

const three = { id: 'v3', n: 3 };

test('the notice durations are 10 s with an Undo and 5 s without', () => {
  assert.equal(RESTORE_NOTICE_MS, 10_000);
  assert.equal(SHORT_NOTICE_MS, 5_000);
});

test('a restore with something to undo asks for a 10 s notice; one that changed nothing asks for 5 s', async () => {
  const withUndo = harness();
  const first = withUndo.core.restore(three);
  await withUndo.answerNext(answer());
  await first;
  const shown = withUndo.calls.find((call) => call[0] === 'restored');
  assert.equal(shown?.[3], 10_000);
  assert.deepEqual((shown?.[2] as { undoTo: unknown }).undoTo, { id: 'v8', n: 8 });

  const same = harness();
  const second = same.core.restore(three);
  await same.answerNext(answer({ restorePoint: null, before: version(3, 'same'), restored: version(3, 'same') }));
  await second;
  const nothing = same.calls.find((call) => call[0] === 'restored');
  assert.equal(nothing?.[3], 5_000);
  assert.equal((nothing?.[2] as { undoTo: unknown }).undoTo, null);
});

test('the restore notice is alive just before 10 s, gone after, and paused while held', (t: TestContext) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let gone = false;
  const timer = createHoldableTimer(10_000, () => (gone = true));
  timer.start();
  t.mock.timers.tick(9_999);
  assert.equal(gone, false, 'alive at 9.999 s');
  t.mock.timers.tick(1);
  assert.equal(gone, true, 'gone at 10 s');

  gone = false;
  const held = createHoldableTimer(10_000, () => (gone = true));
  held.start();
  t.mock.timers.tick(6_000);
  held.setHeld('hover', true);
  t.mock.timers.tick(60_000);
  assert.equal(gone, false, 'held: stays');
  held.setHeld('hover', false);
  t.mock.timers.tick(3_999);
  assert.equal(gone, false, '4 s were left');
  t.mock.timers.tick(1);
  assert.equal(gone, true);
});

test('Undo restores `before`, not the restore point of the Undo or the version first restored', async () => {
  const h = harness();
  const first = h.core.restore(three);
  await h.answerNext(answer({ before: version(7, 'old') }));
  await first;
  const undoTo = (h.calls.find((call) => call[0] === 'restored')?.[2] as { undoTo: { id: string; n: number } }).undoTo;
  const undoing = h.core.undo(undoTo, three);
  assert.deepEqual(h.asked, ['v3', 'v7']);
  await h.answerNext(answer());
  await undoing;
  const done = h.calls.find((call) => call[0] === 'undone');
  assert.deepEqual(done?.[1], { title: 'Back to v7', body: 'v3 is still in Versions.' });
  assert.equal(done?.[2], 5_000, 'the Undo notice stays 5 s and offers no Undo of its own');
});

test('a second restore, or an Undo, while one runs is refused and asks the service for nothing', async () => {
  const h = harness();
  const first = h.core.restore(three);
  assert.equal(h.core.busyId(), 'v3');
  // Not awaited: a refused call returns at once, and a missing guard must fail the assertion, not hang the test.
  void h.core.restore({ id: 'v5', n: 5 });
  void h.core.undo({ id: 'v8', n: 8 }, three);
  await h.answerNext(answer());
  await first;
  assert.deepEqual(h.asked, ['v3'], 'only the first reached the service');
  assert.equal(h.core.busyId(), null);
});

test('the busy version is reported while a restore runs and cleared before the notice', async () => {
  const h = harness();
  const run = h.core.restore(three);
  await h.answerNext(answer());
  await run;
  assert.deepEqual(h.kinds(), ['busy', 'busy', 'reloaded', 'restored']);
  assert.deepEqual(h.calls.filter((call) => call[0] === 'busy').map((call) => call[1]), ['v3', null]);
});

test('a failed restore reports one sentence, frees the busy flag and shows no notice', async () => {
  const h = harness();
  const run = h.core.restore(three);
  await h.failNext('The local service stopped answering.');
  await run;
  assert.deepEqual(h.calls.find((call) => call[0] === 'restoreFailed'), ['restoreFailed', 'v3', 'Couldn’t restore v3. The local service stopped answering. Nothing was changed.']);
  assert.equal(h.core.busyId(), null);
  assert.equal(h.kinds().includes('restored'), false);
});

test('a failed Undo names where the earlier state is, and Try again can run it again', async () => {
  const h = harness();
  const undoing = h.core.undo({ id: 'v8', n: 8 }, three);
  await h.failNext('The local service stopped answering.');
  await undoing;
  const failed = h.calls.find((call) => call[0] === 'undoFailed');
  assert.deepEqual(failed?.[3], { title: 'Couldn’t undo', body: 'The local service stopped answering. Your earlier state is saved as v8 in Versions.' });
  const again = h.core.undo({ id: 'v8', n: 8 }, three);
  assert.equal(h.core.busyId(), 'v8');
  await h.answerNext(answer());
  await again;
  assert.equal(h.kinds().includes('undone'), true);
});

test('a reload that fails does not make the restore fail', async () => {
  const h = harness();
  h.failRefresh();
  const run = h.core.restore(three);
  await h.answerNext(answer());
  await run;
  assert.equal(h.kinds().includes('restored'), true);
  assert.equal(h.kinds().includes('restoreFailed'), false);
});

test('once disposed the screen is never called again, even when the service answers later', async () => {
  const h = harness();
  const run = h.core.restore(three);
  const before = h.calls.length;
  h.core.dispose();
  await h.answerNext(answer());
  await run;
  assert.equal(h.calls.length, before);
});
