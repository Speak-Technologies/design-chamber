// QA regression (feat/build-strip, documentation/specs/phase-1-review-loop.md §2.8 "User restore"):
// the build strip must not read a user's restore as the agent writing. The restore's own event
// has no file list, but the folder watcher re-reports the files the restore wrote, temp names
// included (versions.ts writeAtomic names them `<file>.<hex>.tmp`, not dot-prefixed).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { batchAgentFiles, initialTrack, phaseOf, reduceBuild, type BuildTrack } from '../../../src/guest/build-activity.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { startWatcher } from '../../../src/service/watch.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { pageDesign } from '../render/harness.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('a restore never reaches the build strip as agent files', async (t) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 60_000 });
  await tmp.writeDesign('art', pageDesign({ 'index.html': '<p>one</p>' }));
  const v1 = await versions.create('art', 'manual');
  assert.ok(v1);
  await tmp.write('art/index.html', '<p>two</p>');
  await versions.create('art', 'manual');
  const watcher = startWatcher({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, debounceMs: 50 });
  t.after(() => watcher.stop());
  await watcher.ready;
  await sleep(300);
  const start = ctx.events.length;
  await versions.restore('art', v1.id);
  await sleep(800);
  // What the guest does with the real events, one batch per event, a few ms apart (the service
  // itself still reports the restore's temp files; the guest rule is what keeps them off the strip).
  const at = Date.now();
  let track: BuildTrack = initialTrack(at);
  ctx.events.slice(start).forEach((event, index) => {
    const batch = batchAgentFiles([event], 'art');
    if (batch.restored) track = reduceBuild(track, { kind: 'restore', at: at + index * 10 });
    if (batch.files.length > 0 || batch.created) track = reduceBuild(track, { kind: 'files', at: at + index * 10, files: batch.files, created: batch.created });
  });
  assert.equal(track.lastFile, null, `events seen: ${JSON.stringify(ctx.events.slice(start))}`);
  assert.equal(phaseOf(track, at + 1000), 'hidden');
});

test('a restore reports no service temp names in the change feed', async (t) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const versions = createVersionsService({ store: ctx.store, hub: ctx.hub, log: ctx.log, onDispose: ctx.onDispose, quietMs: 60_000 });
  await tmp.writeDesign('art', pageDesign({ 'index.html': '<p>one</p>' }));
  const v1 = await versions.create('art', 'manual');
  assert.ok(v1);
  await tmp.write('art/index.html', '<p>two</p>');
  await versions.create('art', 'manual');
  const watcher = startWatcher({ settings: ctx.settings, hub: ctx.hub, log: ctx.log, debounceMs: 50 });
  t.after(() => watcher.stop());
  await watcher.ready;
  await sleep(300);
  const start = ctx.events.length;
  await versions.restore('art', v1.id);
  await sleep(800);
  const names = ctx.events.slice(start).flatMap((event) => event.files ?? []);
  assert.ok(names.includes('index.html'), `the restore itself must still be reported: ${JSON.stringify(names)}`);
  assert.deepEqual(names.filter((name) => name.endsWith('.tmp')), []);
});
