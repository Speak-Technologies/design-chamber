// POST /session-events (documentation/specs/phase-1-5-sdk-2-7.md §U4.2, §U4.3 1, 2, 6): behind
// the bearer like every route, read with the SDK reader (400 on anything else), exactly
// `{ ok: true }` for our events and for events we do not act on, and the answer goes out
// before any work, even when the snapshot takes seconds or the index never loads.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { ActivityTracker, DesignIndex, Logger, ServiceContext } from '../../../src/service/context.ts';
import { createActivityTracker } from '../../../src/service/activity.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSessionEventsRoutes } from '../../../src/service/routes/session-events.ts';
import { createTurnEvents, type TurnEvents } from '../../../src/service/turn-events.ts';

const TOKEN = 'session-events-test-token';
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

type Deferred = { promise: Promise<void>; resolve(): void };
const deferred = (): Deferred => {
  let resolve!: () => void; // Safe: assigned synchronously by the Promise executor below.
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sessionEvent = (type: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  requestId: 'req_1',
  event: { id: 'evt_1', type, at: Date.now(), session: { id: 'ses_linked_0001', parentId: null }, project: { directory: '/home/you/shop' }, linked: [], ...over },
});

const indexOf = (ready: (timeoutMs: number) => Promise<boolean>, links: Record<string, string[]>): DesignIndex => ({
  all: () => [],
  get: () => null,
  bySession: (id) => links[id] ?? [],
  ready,
  dispose: async () => undefined,
});

/** Serve only this route over loopback, as the host proxy calls it. */
const serve = async (t: TestContext, turnEvents: TurnEvents) => {
  const router = createRouter({ token: TOKEN, log: silent });
  // The route reads nothing from the context; the queue it hands events to is what the test watches.
  registerSessionEventsRoutes(router, {} as ServiceContext, turnEvents);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return async (body: unknown, init: { token?: string | null; raw?: string } = {}) => {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/session-events`, {
      method: 'POST',
      headers: init.token === null ? {} : { authorization: `Bearer ${init.token ?? TOKEN}` },
      ...(init.raw !== undefined ? { body: init.raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, text, ms: performance.now() - started };
  };
};

/** A worker whose snapshot is held until the test lets it go. */
const slowWorker = (t: TestContext, options: { ready?: (timeoutMs: number) => Promise<boolean>; indexWaitMs?: number } = {}) => {
  const gate = deferred();
  const turnCalls: string[] = [];
  const activity: ActivityTracker = createActivityTracker();
  const turnEvents = createTurnEvents({
    index: indexOf(options.ready ?? (async () => true), { ses_linked_0001: ['pricing', 'checkout'] }),
    versions: {
      turn: async (sessionId) => {
        turnCalls.push(sessionId);
        await gate.promise;
        return [];
      },
    },
    activity,
    hub: { emit: (change) => ({ seq: 1, slug: change.slug, kind: change.kind, at: new Date().toISOString() }) },
    log: silent,
    ...(options.indexWaitMs !== undefined ? { indexWaitMs: options.indexWaitMs } : {}),
  });
  t.after(async () => {
    gate.resolve();
    turnEvents.dispose();
    await turnEvents.idle();
  });
  return { turnEvents, turnCalls, activity, release: () => gate.resolve() };
};

const waitFor = async (check: () => boolean, ms = 2000): Promise<void> => {
  for (let waited = 0; !check() && waited < ms; waited += 10) await sleep(10);
};

test('a valid event is answered exactly { ok: true } in under 50 ms while the snapshot is still running', { timeout: 5000 }, async (t) => {
  const worker = slowWorker(t);
  const call = await serve(t, worker.turnEvents);
  await call(sessionEvent('turn-started')); // warm the connection; the timing below is the route, not the first socket
  const reply = await call(sessionEvent('turn-finished'));
  assert.equal(reply.status, 200);
  assert.equal(reply.text, '{"ok":true}', 'the exact body: extra keys fail the host delivery');
  assert.ok(reply.ms < 50, `answered in ${reply.ms.toFixed(1)} ms`);
  await waitFor(() => worker.turnCalls.length > 0);
  assert.deepEqual(worker.turnCalls, ['ses_linked_0001'], 'the work happens after the answer');
  assert.equal(worker.activity.of('ses_linked_0001')?.state, 'done');
  worker.release();
  await worker.turnEvents.idle();
});

test('cold start: the answer goes out first, and the turn version follows once the index wait passes', { timeout: 5000 }, async (t) => {
  const worker = slowWorker(t, { ready: () => new Promise<boolean>(() => undefined), indexWaitMs: 100 });
  worker.release();
  const call = await serve(t, worker.turnEvents);
  const reply = await call(sessionEvent('turn-finished'));
  assert.equal(reply.text, '{"ok":true}');
  assert.deepEqual(worker.turnCalls, [], 'nothing ran before the answer');
  await waitFor(() => worker.turnCalls.length > 0);
  assert.deepEqual(worker.turnCalls, ['ses_linked_0001']);
});

test('a body that is not a session event is 400; an event of another type, or an id we would not keep, is { ok: true } and no work', async (t) => {
  const taken: string[] = [];
  const spy: TurnEvents = { take: (event) => void taken.push(event.type), idle: async () => undefined, dispose: () => undefined };
  const call = await serve(t, spy);
  for (const type of ['session-created', 'permission-asked', 'question-asked', 'session-deleted']) {
    const reply = await call(sessionEvent(type));
    assert.equal(reply.status, 200, type);
    assert.equal(reply.text, '{"ok":true}', type);
  }
  for (const id of ['x'.repeat(200), 'ses\nfake', 'ses\u0000nul', 'ses\u007fdel']) {
    assert.equal((await call(sessionEvent('turn-finished', { session: { id, parentId: null } }))).text, '{"ok":true}');
  }
  assert.deepEqual(taken, [], 'nothing queued');
  for (const body of [{}, [], 'turn-finished', sessionEvent('turn-exploded'), { ...sessionEvent('turn-finished'), v: 2 }, { ...sessionEvent('turn-finished'), requestId: '' }]) {
    const reply = await call(body);
    assert.equal(reply.status, 400, JSON.stringify(body));
  }
  assert.equal((await call(undefined)).status, 400, 'an empty body');
  assert.equal((await call(undefined, { raw: '{"v":1,' })).status, 400, 'broken JSON');
  assert.deepEqual(taken, []);
  await call(sessionEvent('turn-failed'));
  assert.deepEqual(taken, ['turn-failed']);
});

test('no bearer or a wrong one: 401 and nothing queued', async (t) => {
  const taken: string[] = [];
  const spy: TurnEvents = { take: (event) => void taken.push(event.type), idle: async () => undefined, dispose: () => undefined };
  const call = await serve(t, spy);
  assert.equal((await call(sessionEvent('turn-finished'), { token: null })).status, 401);
  assert.equal((await call(sessionEvent('turn-finished'), { token: 'not-the-token' })).status, 401);
  assert.deepEqual(taken, []);
});

test('a session id shaped like a path is only a lookup key: no design is touched', async (t) => {
  const worker = slowWorker(t);
  worker.release();
  const call = await serve(t, worker.turnEvents);
  for (const id of ['../../etc/passwd', '..\\..\\Windows', 'C:\\Users', '%2e%2e%2f']) {
    assert.equal((await call(sessionEvent('turn-finished', { session: { id, parentId: null } }))).text, '{"ok":true}');
  }
  await worker.turnEvents.idle();
  assert.deepEqual(worker.turnCalls, [], 'not linked to any design, so no snapshot and no disk walk');
});
