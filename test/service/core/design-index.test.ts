// The design index (documentation/specs/phase-1-5-sdk-2-7.md §3.1): one store list at creation,
// a coalesced refresh after content events, never two lists in flight, the last good list kept
// when a refresh fails, `bySession`, and `ready` with a timeout.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChangeEvent, ChangeKind, DesignSummary } from '../../../src/shared/types.ts';
import type { Logger } from '../../../src/service/context.ts';
import { createDesignIndex } from '../../../src/service/design-index.ts';

const summary = (slug: string, over: Partial<DesignSummary> = {}): DesignSummary => ({
  slug,
  kind: 'canvas',
  title: slug,
  created: '2026-11-01T10:00:00.000Z',
  updated: '2026-11-01T10:00:00.000Z',
  pending: false,
  screenCount: 1,
  viewports: [],
  sessionId: null,
  projectDirectory: null,
  openComments: 0,
  thumb: { state: 'unavailable', key: null },
  warnings: [],
  ...over,
});

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void; // Safe: assigned synchronously by the Promise executor below.
  let reject!: (error: unknown) => void; // Safe: as above.
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const setup = (refreshMs = 20) => {
  const lists: Deferred<DesignSummary[]>[] = [];
  const listeners = new Set<(event: ChangeEvent) => void>();
  const logs: { level: string; event: string }[] = [];
  const log: Logger = {
    info: (event) => void logs.push({ level: 'info', event }),
    warn: (event) => void logs.push({ level: 'warn', event }),
    error: (event) => void logs.push({ level: 'error', event }),
  };
  let seq = 0;
  const store = {
    list: (): Promise<DesignSummary[]> => {
      const next = deferred<DesignSummary[]>();
      lists.push(next);
      return next.promise;
    },
  };
  const hub = {
    subscribe: (listener: (event: ChangeEvent) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const index = createDesignIndex({ store, hub, log, refreshMs });
  const emit = (kind: ChangeKind, slug: string | null = 'a'): void => {
    seq += 1;
    for (const listener of [...listeners]) listener({ seq, slug, kind });
  };
  /** Settle every list still pending, then dispose (a test that fails early must not hang). */
  const close = async (): Promise<void> => {
    for (const list of lists) list.resolve([]);
    await index.dispose();
  };
  return { index, lists, emit, logs, listeners, close };
};

test('loads once at creation; all() is newest first, get() and bySession() answer from memory', async (t) => {
  const s = setup();
  t.after(() => s.close());
  assert.equal(s.lists.length, 1, 'one list at creation');
  assert.deepEqual(s.index.all(), []);
  assert.equal(s.index.get('a'), null);
  s.lists[0]?.resolve([
    summary('old', { updated: '2026-10-01T10:00:00.000Z', sessionId: 'ses_1' }),
    summary('new', { updated: '2026-11-09T10:00:00.000Z', sessionId: 'ses_1' }),
    summary('mid', { updated: '2026-11-01T10:00:00.000Z', sessionId: 'ses_2' }),
  ]);
  assert.equal(await s.index.ready(1000), true);
  assert.deepEqual(s.index.all().map((design) => design.slug), ['new', 'mid', 'old']);
  assert.equal(s.index.get('mid')?.sessionId, 'ses_2');
  assert.deepEqual([...s.index.bySession('ses_1')].sort(), ['new', 'old']);
  assert.deepEqual(s.index.bySession('ses_none'), []);
});

test('ready() answers false at its timeout while the first list is still loading', async (t) => {
  const s = setup();
  t.after(() => s.close());
  const started = Date.now();
  assert.equal(await s.index.ready(30), false);
  assert.ok(Date.now() - started >= 25, 'waited for the timeout');
});

test('content events coalesce into one refresh; other kinds do not refresh', async (t) => {
  const s = setup(20);
  t.after(() => s.close());
  s.lists[0]?.resolve([summary('a')]);
  await s.index.ready(1000);
  for (const kind of ['thumb', 'versions', 'checks', 'loose', 'open', 'activity'] as const) s.emit(kind);
  await sleep(50);
  assert.equal(s.lists.length, 1, 'no refresh for non-content kinds');

  s.emit('files');
  s.emit('design');
  s.emit('comments');
  await sleep(50);
  assert.equal(s.lists.length, 2, 'three events, one refresh');
  s.lists[1]?.resolve([summary('a'), summary('b', { updated: '2026-11-05T10:00:00.000Z' })]);
  await sleep(0);
  assert.deepEqual(s.index.all().map((design) => design.slug), ['b', 'a']);

  for (const kind of ['added', 'removed', 'root'] as const) {
    s.emit(kind);
    await sleep(40);
  }
  assert.equal(s.lists.length, 3, 'a refresh in flight is never joined by a second list');
  s.lists[2]?.resolve([summary('a')]);
  await sleep(40);
  assert.equal(s.lists.length, 4, 'events seen during the list refresh once more after it');
  s.lists[3]?.resolve([summary('a')]);
});

test('a failed refresh keeps the last good list and logs design-index.refresh-failed', async (t) => {
  const s = setup(10);
  t.after(() => s.close());
  s.lists[0]?.resolve([summary('kept')]);
  await s.index.ready(1000);
  s.emit('files');
  await sleep(30);
  s.lists[1]?.reject(new Error('EACCES'));
  await sleep(0);
  assert.deepEqual(s.index.all().map((design) => design.slug), ['kept']);
  assert.ok(s.logs.some((line) => line.level === 'warn' && line.event === 'design-index.refresh-failed'));
  // The next event tries again.
  s.emit('files');
  await sleep(30);
  assert.equal(s.lists.length, 3);
  s.lists[2]?.resolve([summary('fresh')]);
  await sleep(0);
  assert.deepEqual(s.index.all().map((design) => design.slug), ['fresh']);
});

test('a failed first load leaves the index not ready until a later event loads it', async (t) => {
  const s = setup(10);
  t.after(() => s.close());
  s.lists[0]?.reject(new Error('EIO'));
  assert.equal(await s.index.ready(30), false);
  s.emit('added');
  await sleep(30);
  s.lists[1]?.resolve([summary('a')]);
  assert.equal(await s.index.ready(1000), true);
});

test('dispose stops listening and waits for a list in flight', async () => {
  const s = setup(10);
  let disposed = false;
  const done = s.index.dispose().then(() => {
    disposed = true;
  });
  await sleep(0);
  assert.equal(disposed, false, 'waits for the first list');
  assert.equal(s.listeners.size, 0, 'unsubscribed at once');
  s.lists[0]?.resolve([summary('a')]);
  await done;
  s.emit('files');
  await sleep(30);
  assert.equal(s.lists.length, 1, 'no refresh after dispose');
});

test('a store that throws synchronously is a failed list, not a crash', async () => {
  const lines: string[] = [];
  const log: Logger = { info: () => undefined, warn: (event) => void lines.push(event), error: () => undefined };
  const index = createDesignIndex({
    store: {
      list: () => {
        throw new Error('not built yet');
      },
    },
    hub: { subscribe: () => () => undefined },
    log,
  });
  assert.equal(await index.ready(20), false);
  assert.deepEqual(lines, ['design-index.refresh-failed']);
  await index.dispose();
});
