// BUILD.json adoption after a root change (Phase 2.5 §5.9): the pass that runs once per system must
// wait for the NEW root's watcher baseline. The watcher emits `root` and only then swaps in the new
// baseline promise (watch.ts), so a pass that reads `ready()` while `root` is being emitted would run
// against the old, already settled baseline. A pass started for an older root stops before listing.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Logger } from '../../../src/service/context.ts';
import { createChangeHub } from '../../../src/service/changes.ts';
import { createHomes, type HomesDeps } from '../../../src/service/systems/homes.ts';

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const quiet = (): void => {};
const LOG: Logger = { info: quiet, warn: quiet, error: quiet };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const rig = (initial: Promise<void>) => {
  let root = '/designs/a';
  let current = initial;
  /** The root each pass listed the systems of. */
  const listed: string[] = [];
  const hub = createChangeHub('epoch');
  // Only `list` is reached before a system is reconciled, and it answers no systems.
  const systems = {
    list: async () => {
      listed.push(root);
      return [];
    },
  } as unknown as HomesDeps['systems'];
  const homes = createHomes({ systems, tickets: {} as HomesDeps['tickets'], settings: { root: () => root }, hub, log: LOG, ready: () => current });
  return {
    homes,
    listed,
    /** What watch.ts does on a root change: emit `root`, then (same turn) start the new baseline. */
    switchRoot(next: string, baseline: Promise<void>): void {
      root = next;
      hub.emit({ slug: null, kind: 'root' });
      current = baseline;
    },
  };
};

test('a root change sweeps after the new baseline, never against the old one', async (t) => {
  const r = rig(Promise.resolve());
  t.after(() => r.homes.stop());
  await sleep(10);
  assert.deepEqual(r.listed, ['/designs/a']);

  const next = deferred();
  r.switchRoot('/designs/b', next.promise);
  await sleep(30);
  assert.deepEqual(r.listed, ['/designs/a'], 'nothing is listed before the new baseline is seeded');
  next.resolve();
  await sleep(10);
  assert.deepEqual(r.listed, ['/designs/a', '/designs/b']);
});

test('a pass still waiting for the old baseline stops when the root changes', async (t) => {
  const old = deferred();
  const r = rig(old.promise);
  t.after(() => r.homes.stop());
  const next = deferred();
  r.switchRoot('/designs/b', next.promise);
  old.resolve();
  await sleep(30);
  assert.deepEqual(r.listed, [], 'the old pass never lists');
  next.resolve();
  await sleep(10);
  assert.deepEqual(r.listed, ['/designs/b']);
});
