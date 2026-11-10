// The turn-event worker and the activity tracker (documentation/specs/phase-1-5-sdk-2-7.md §U4.2,
// §U4.3 3 to 6, §3.4): subagents and unlinked sessions never reach the disk, one snapshot at a
// time, a bounded queue that drops the oldest with one warning, the index wait with the
// `versions.turn` fallback on a cold start, and real turn versions on linked designs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACTIVITY_SESSIONS_MAX, ACTIVITY_WORKING_EXPIRY_MS, DESIGN_INDEX_TURN_WAIT_MS, TURN_EVENT_QUEUE_MAX, TURN_SNAPSHOT_DEDUPE_MS } from '../../../src/shared/limits.ts';
import type { ChangeKind } from '../../../src/shared/types.ts';
import { createActivityTracker } from '../../../src/service/activity.ts';
import type { DesignIndex, DesignStore, Logger, TurnEventType } from '../../../src/service/context.ts';
import { createDesignIndex } from '../../../src/service/design-index.ts';
import { createTurnEvents, type SessionEvent, type TurnEvent, type TurnEventsDeps } from '../../../src/service/turn-events.ts';
import { createVersionsService } from '../../../src/service/versions.ts';
import { createCore } from './harness.ts';

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void; // Safe: assigned synchronously by the Promise executor below.
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const event = (type: TurnEventType, sessionId = 'ses_linked_0001', over: Partial<Omit<SessionEvent, 'type'>> = {}): TurnEvent => ({
  id: `evt_${Math.random().toString(36).slice(2)}`,
  type,
  at: Date.now(),
  session: { id: sessionId, parentId: null },
  project: { directory: '/home/you/shop' },
  linked: [],
  ...over,
});

type LogLine = { level: string; event: string; fields?: Readonly<Record<string, unknown>> };

/** Fake deps: an index whose `ready` and `bySession` the test sets, a versions service that records (and can hold) each call. */
const fakes = (options: { ready?: (timeoutMs: number) => Promise<boolean>; links?: Record<string, string[]>; indexWaitMs?: number } = {}) => {
  const logs: LogLine[] = [];
  const log: Logger = {
    info: (name, fields) => void logs.push({ level: 'info', event: name, fields }),
    warn: (name, fields) => void logs.push({ level: 'warn', event: name, fields }),
    error: (name, fields) => void logs.push({ level: 'error', event: name, fields }),
  };
  const readyCalls: number[] = [];
  const bySessionCalls: string[] = [];
  const index: DesignIndex = {
    all: () => [],
    get: () => null,
    bySession: (id) => {
      bySessionCalls.push(id);
      return options.links?.[id] ?? [];
    },
    ready: (timeoutMs) => {
      readyCalls.push(timeoutMs);
      return options.ready ? options.ready(timeoutMs) : Promise.resolve(true);
    },
    dispose: async () => undefined,
  };
  const turnCalls: string[] = [];
  let running = 0;
  let maxRunning = 0;
  let hold: Promise<void> | null = null;
  let failNext = false;
  const versions: TurnEventsDeps['versions'] = {
    turn: async (sessionId) => {
      turnCalls.push(sessionId);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      try {
        if (hold) await hold;
        if (failNext) {
          failNext = false;
          throw new Error('disk said no');
        }
        return (options.links?.[sessionId] ?? []).map((slug) => ({ slug, id: 'v1' }));
      } finally {
        running -= 1;
      }
    },
  };
  const emitted: { slug: string | null; kind: ChangeKind }[] = [];
  const hub: TurnEventsDeps['hub'] = {
    emit: (change) => {
      emitted.push({ slug: change.slug, kind: change.kind });
      return { seq: emitted.length, slug: change.slug, kind: change.kind, at: new Date().toISOString() };
    },
  };
  const activity = createActivityTracker();
  const turnEvents = createTurnEvents({ index, versions, activity, hub, log, ...(options.indexWaitMs !== undefined ? { indexWaitMs: options.indexWaitMs } : {}) });
  return {
    turnEvents,
    activity,
    logs,
    readyCalls,
    bySessionCalls,
    turnCalls,
    emitted,
    maxRunning: () => maxRunning,
    holdTurns(): () => void {
      const gate = deferred<void>();
      hold = gate.promise;
      return () => {
        hold = null;
        gate.resolve();
      };
    },
    failNextTurn: () => {
      failNext = true;
    },
  };
};

test('turn-finished for a linked session: activity done, one activity change per slug, one versions.turn', async () => {
  const f = fakes({ links: { ses_linked_0001: ['pricing', 'checkout'] } });
  f.turnEvents.take(event('turn-finished'));
  await f.turnEvents.idle();
  assert.deepEqual(f.turnCalls, ['ses_linked_0001']);
  assert.deepEqual(f.emitted, [
    { slug: 'pricing', kind: 'activity' },
    { slug: 'checkout', kind: 'activity' },
  ]);
  assert.equal(f.activity.of('ses_linked_0001')?.state, 'done');
  assert.equal(f.activity.of('ses_linked_0001')?.directory, '/home/you/shop');
  assert.deepEqual(f.readyCalls, [DESIGN_INDEX_TURN_WAIT_MS], 'the worker waits for the index with the spec wait');
});

test('turn-failed snapshots too; turn-started only records and refreshes', async () => {
  const f = fakes({ links: { ses_linked_0001: ['pricing'] } });
  f.turnEvents.take(event('turn-started'));
  await f.turnEvents.idle();
  assert.equal(f.activity.of('ses_linked_0001')?.state, 'working');
  assert.deepEqual(f.turnCalls, [], 'a started turn takes no snapshot');
  assert.deepEqual(f.emitted, [{ slug: 'pricing', kind: 'activity' }]);
  f.turnEvents.take(event('turn-failed'));
  await f.turnEvents.idle();
  assert.equal(f.activity.of('ses_linked_0001')?.state, 'failed');
  assert.deepEqual(f.turnCalls, ['ses_linked_0001'], 'a failed turn is snapshotted (restore needs it most then)');
});

test('a subagent event does nothing at all', async () => {
  const f = fakes({ links: { ses_child_0001: ['pricing'] } });
  f.turnEvents.take(event('turn-finished', 'ses_child_0001', { session: { id: 'ses_child_0001', parentId: 'ses_linked_0001' } }));
  await f.turnEvents.idle();
  assert.deepEqual(f.turnCalls, []);
  assert.deepEqual(f.emitted, []);
  assert.deepEqual(f.readyCalls, []);
  assert.deepEqual(f.bySessionCalls, []);
  assert.equal(f.activity.of('ses_child_0001'), null);
});

test('an unknown session with a loaded index: no snapshot, no change event', async () => {
  const f = fakes({ links: {} });
  f.turnEvents.take(event('turn-finished', 'ses_stranger_01'));
  await f.turnEvents.idle();
  assert.deepEqual(f.bySessionCalls, ['ses_stranger_01']);
  assert.deepEqual(f.turnCalls, []);
  assert.deepEqual(f.emitted, []);
});

test('events for one pending session coalesce; a finished turn is kept even when the next turn already started', async () => {
  const f = fakes({ links: { ses_busy_00001: ['pricing'], ses_linked_0001: ['other'] } });
  const release = f.holdTurns();
  f.turnEvents.take(event('turn-finished', 'ses_linked_0001')); // occupies the worker
  await sleep(10);
  f.turnEvents.take(event('turn-finished', 'ses_busy_00001'));
  f.turnEvents.take(event('turn-started', 'ses_busy_00001'));
  release();
  await f.turnEvents.idle();
  assert.deepEqual(f.turnCalls, ['ses_linked_0001', 'ses_busy_00001'], 'one snapshot for the coalesced session, not lost to the newer start');
  assert.equal(f.activity.of('ses_busy_00001')?.state, 'working', 'the newest event decides the state');
});

test('100 events in a burst: one snapshot at a time, the queue never past TURN_EVENT_QUEUE_MAX, the oldest dropped with one warning', async () => {
  const links: Record<string, string[]> = {};
  for (let i = 0; i < 100; i += 1) links[`ses_burst_${String(i).padStart(4, '0')}`] = [`design-${i}`];
  const f = fakes({ links });
  const release = f.holdTurns();
  for (let i = 0; i < 100; i += 1) f.turnEvents.take(event('turn-finished', `ses_burst_${String(i).padStart(4, '0')}`));
  await sleep(20);
  assert.deepEqual(f.turnCalls, ['ses_burst_0000'], 'only the first runs while it is held');
  release();
  await f.turnEvents.idle();
  assert.equal(f.maxRunning(), 1, 'never two snapshots at once');
  // The first left the queue when it started; of the 99 that waited, only the newest 64 stayed.
  assert.equal(f.turnCalls.length, 1 + TURN_EVENT_QUEUE_MAX);
  assert.deepEqual(f.turnCalls.slice(1), Object.keys(links).slice(100 - TURN_EVENT_QUEUE_MAX));
  const warnings = f.logs.filter((line) => line.level === 'warn' && line.event === 'turn-events.queue-full');
  assert.equal(warnings.length, 1, 'one warning for the overflow, not one per dropped event');
});

test('cold start: an index that never loads still gets its turn version through versions.turn once the wait passes', { timeout: 5000 }, async () => {
  const f = fakes({ ready: () => new Promise<boolean>(() => undefined), links: { ses_linked_0001: ['pricing'] }, indexWaitMs: 80 });
  const started = Date.now();
  f.turnEvents.take(event('turn-finished'));
  await sleep(30);
  assert.deepEqual(f.turnCalls, [], 'still waiting for the index');
  await f.turnEvents.idle();
  assert.ok(Date.now() - started >= 75, 'waited for the index first');
  assert.deepEqual(f.turnCalls, ['ses_linked_0001']);
  assert.deepEqual(f.bySessionCalls, [], 'no slugs from an index that did not load');
  assert.deepEqual(f.emitted, [], 'no activity changes without known slugs');
  assert.equal(f.activity.of('ses_linked_0001')?.state, 'done');
});

test('cold start: a started turn takes no snapshot and no disk walk', async () => {
  const f = fakes({ ready: async () => false, links: { ses_linked_0001: ['pricing'] } });
  f.turnEvents.take(event('turn-started'));
  await f.turnEvents.idle();
  assert.deepEqual(f.turnCalls, []);
  assert.deepEqual(f.emitted, []);
});

test('a failed snapshot is logged without the session id and the queue carries on', async () => {
  const f = fakes({ links: { ses_linked_0001: ['pricing'], ses_linked_0002: ['other'] } });
  f.failNextTurn();
  f.turnEvents.take(event('turn-finished', 'ses_linked_0001'));
  f.turnEvents.take(event('turn-finished', 'ses_linked_0002'));
  await f.turnEvents.idle();
  assert.deepEqual(f.turnCalls, ['ses_linked_0001', 'ses_linked_0002']);
  const failed = f.logs.find((line) => line.event === 'turn-events.snapshot-failed');
  assert.ok(failed, 'the failure is logged');
  assert.equal(failed.fields?.sessionPrefix, 'ses_link');
  assert.ok(!JSON.stringify(f.logs).includes('ses_linked_0001'), 'the full session id never reaches the log');
});

test('dispose drops pending work and stops taking events', async () => {
  const f = fakes({ links: { ses_linked_0001: ['a'], ses_linked_0002: ['b'] } });
  const release = f.holdTurns();
  f.turnEvents.take(event('turn-finished', 'ses_linked_0001'));
  await sleep(10);
  f.turnEvents.take(event('turn-finished', 'ses_linked_0002'));
  f.turnEvents.dispose();
  release();
  await f.turnEvents.idle();
  f.turnEvents.take(event('turn-finished', 'ses_linked_0002'));
  await f.turnEvents.idle();
  assert.deepEqual(f.turnCalls, ['ses_linked_0001']);
});

// ---- Real store, index and versions (§U4.3 3, 4) ----

const useReal = async (t: Parameters<typeof createCore>[0]) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  let storeReads = 0;
  // Every store method that reads a design folder counts; the index lists through the same spy.
  const store: DesignStore = new Proxy(core.store, {
    get: (target, property, receiver) => {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (property === 'list' || property === 'get' || property === 'dir') storeReads += 1;
        // Safe: forwarding the original method with its own arguments.
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const versions = createVersionsService({ store, hub: core.ctx.hub, log: core.ctx.log, onDispose: core.ctx.onDispose, quietMs: 60_000 });
  const index = createDesignIndex({ store, hub: core.ctx.hub, log: core.ctx.log, refreshMs: 20 });
  t.after(() => index.dispose());
  const activity = createActivityTracker();
  const turnEvents = createTurnEvents({ index, versions, activity, hub: core.ctx.hub, log: core.ctx.log });
  t.after(() => turnEvents.dispose());
  const linked = async (title: string, sessionId: string | null) => (await core.store.create({ kind: 'page', title, sessionId, html: `<h1>${title}</h1>` })).slug;
  const turnVersions = async (slug: string) => (await versions.list(slug)).versions.filter((version) => version.reason === 'turn').length;
  return { core, versions, index, turnEvents, linked, turnVersions, storeReads: () => storeReads };
};

test('turn-finished on a session linked to two designs: one turn version each; repeated or unchanged, none more', async (t) => {
  const real = await useReal(t);
  const pricing = await real.linked('Pricing', 'ses_linked_0001');
  const checkout = await real.linked('Checkout', 'ses_linked_0001');
  const other = await real.linked('Unlinked', null);
  for (let i = 0; i < 100 && real.index.bySession('ses_linked_0001').length < 2; i += 1) await sleep(20);

  real.turnEvents.take(event('turn-finished'));
  await real.turnEvents.idle();
  assert.equal(await real.turnVersions(pricing), 1);
  assert.equal(await real.turnVersions(checkout), 1);
  assert.equal(await real.turnVersions(other), 0, 'a design no chat is linked to gets no turn version');

  real.turnEvents.take(event('turn-finished'));
  await real.turnEvents.idle();
  assert.equal(await real.turnVersions(pricing), 1, 'the same turn twice within the dedupe window');

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + TURN_SNAPSHOT_DEDUPE_MS + 100 });
  real.turnEvents.take(event('turn-finished'));
  await real.turnEvents.idle();
  t.mock.timers.reset();
  assert.equal(await real.turnVersions(pricing), 1, 'an unchanged tree after the window');
  assert.equal(await real.turnVersions(checkout), 1);
});

test('the event and the open page snapshotting the same turn at once make one version', async (t) => {
  const real = await useReal(t);
  const pricing = await real.linked('Pricing', 'ses_linked_0001');
  for (let i = 0; i < 100 && real.index.bySession('ses_linked_0001').length < 1; i += 1) await sleep(20);
  // The guest's POST /versions/turn reaches the same service while the event is queued.
  const guest = real.versions.turn('ses_linked_0001');
  real.turnEvents.take(event('turn-finished'));
  await Promise.all([guest, real.turnEvents.idle()]);
  assert.equal(await real.turnVersions(pricing), 1);
});

test('with a loaded index, an unknown session and a subagent read no design folder', async (t) => {
  const real = await useReal(t);
  await real.linked('Pricing', 'ses_linked_0001');
  for (let i = 0; i < 100 && real.index.bySession('ses_linked_0001').length < 1; i += 1) await sleep(20);
  await sleep(60); // let the index's own refresh after the create settle
  const before = real.storeReads();
  real.turnEvents.take(event('turn-finished', 'ses_stranger_01'));
  real.turnEvents.take(event('turn-finished', 'ses_child_00001', { session: { id: 'ses_child_00001', parentId: 'ses_linked_0001' } }));
  await real.turnEvents.idle();
  assert.equal(real.storeReads(), before);
});

// ---- Activity tracker (§3.4) ----

test('activity: newest event wins, an older one arriving late is ignored', () => {
  const activity = createActivityTracker({ now: () => 10_000 });
  activity.record({ sessionId: 's1', type: 'turn-started', at: 9_000, directory: '/p' });
  activity.record({ sessionId: 's1', type: 'turn-finished', at: 9_500, directory: '/p' });
  activity.record({ sessionId: 's1', type: 'turn-started', at: 9_200, directory: '/p' });
  assert.deepEqual(activity.of('s1'), { sessionId: 's1', state: 'done', at: 9_500, directory: '/p' });
  assert.deepEqual(activity.working(), []);
});

test('activity: a working entry silent past the expiry reads as unknown', () => {
  let now = 0;
  const activity = createActivityTracker({ now: () => now });
  activity.record({ sessionId: 's1', type: 'turn-started', at: 0, directory: null });
  activity.record({ sessionId: 's2', type: 'turn-finished', at: 0, directory: null });
  now = ACTIVITY_WORKING_EXPIRY_MS;
  assert.equal(activity.of('s1')?.state, 'working');
  assert.deepEqual(activity.working().map((entry) => entry.sessionId), ['s1']);
  now = ACTIVITY_WORKING_EXPIRY_MS + 1;
  assert.equal(activity.of('s1'), null);
  assert.deepEqual(activity.working(), []);
  assert.equal(activity.of('s2')?.state, 'done', 'a finished turn does not expire');
});

test('activity: at most ACTIVITY_SESSIONS_MAX sessions, the oldest at dropped', () => {
  const activity = createActivityTracker({ now: () => 1_000_000 });
  // s0 is recorded last but carries the oldest `at`.
  for (let i = 1; i <= ACTIVITY_SESSIONS_MAX; i += 1) activity.record({ sessionId: `s${i}`, type: 'turn-started', at: 1_000 + i, directory: null });
  activity.record({ sessionId: 's0', type: 'turn-started', at: 500, directory: null });
  assert.equal(activity.of('s0')?.state, 'working', 'the newcomer is kept');
  assert.equal(activity.of('s1'), null, 'the oldest at is gone');
  assert.equal(activity.of('s2')?.state, 'working');
});

test('activity: a directory longer than any path is not kept', () => {
  const activity = createActivityTracker({ now: () => 0 });
  activity.record({ sessionId: 's1', type: 'turn-started', at: 0, directory: `/${'x'.repeat(5000)}` });
  assert.equal(activity.of('s1')?.directory, null);
});
