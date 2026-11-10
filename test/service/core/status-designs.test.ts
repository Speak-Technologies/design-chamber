// Work Status rows (documentation/specs/phase-1-5-sdk-2-7.md §U5.3, §U5.4 1): the pure pick and
// agent state, the service over a fake hub / index / tracker / checks reader, and
// GET /status/designs over a real loopback router (token, odd input, a failing index).

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { ChecksResponse, StatusDesignsResponse } from '../../../src/shared/api.ts';
import { STATUS_RECENT_MS, STATUS_ROWS_MAX, WRITING_WINDOW_MS } from '../../../src/shared/limits.ts';
import type { ChangeEvent, DesignSummary } from '../../../src/shared/types.ts';
import { RESTORE_QUIET_MS } from '../../../src/guest/build-activity.ts';
import type { ActivityTracker, DesignIndex, SessionActivity } from '../../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerStatusRoutes } from '../../../src/service/routes/status.ts';
import { agentStateOf, createStatusDesigns, pickStatusDesigns, type StatusContext, type StatusDesignsDeps } from '../../../src/service/status-designs.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const summary = (slug: string, over: Partial<DesignSummary> = {}): DesignSummary => ({
  slug,
  kind: 'page',
  title: slug,
  created: iso(NOW - DAY),
  updated: iso(NOW - DAY),
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

const slugs = (designs: readonly DesignSummary[]): string[] => designs.map((design) => design.slug);
const pick = (designs: DesignSummary[], over: Partial<Parameters<typeof pickStatusDesigns>[1]> = {}) =>
  pickStatusDesigns(designs, { directory: null, sessionId: null, working: new Set(), now: NOW, ...over });

// ---- pickStatusDesigns ----

test('this chat\'s design comes first, then working ones, then the rest newest first', () => {
  const designs = [
    summary('new-idle', { updated: iso(NOW - 1000), projectDirectory: '/p' }),
    summary('old-working', { updated: iso(NOW - 3 * DAY), sessionId: 'ses_w', projectDirectory: '/p' }),
    summary('mine', { updated: iso(NOW - 5 * DAY), sessionId: 'ses_me', projectDirectory: '/p' }),
    summary('older-idle', { updated: iso(NOW - 2 * DAY), projectDirectory: '/p' }),
  ];
  const { picked, total } = pick(designs, { directory: '/p', sessionId: 'ses_me', working: new Set(['ses_w']) });
  assert.deepEqual(slugs(picked), ['mine', 'old-working', 'new-idle', 'older-idle']);
  assert.equal(total, 4);
});

test('with a project, other projects and designs naming no project are left out; this chat\'s design stays', () => {
  const designs = [
    summary('same', { projectDirectory: '/home/me/shop' }),
    summary('other', { projectDirectory: '/home/me/blog' }),
    summary('nameless', { projectDirectory: null }),
    summary('mine-elsewhere', { sessionId: 'ses_me', projectDirectory: '/home/me/blog' }),
  ];
  const { picked } = pick(designs, { directory: '/home/me/shop', sessionId: 'ses_me' });
  assert.deepEqual(slugs(picked), ['mine-elsewhere', 'same']);
});

test('a working agent elsewhere does not pull its design into another project\'s list', () => {
  const designs = [summary('far', { sessionId: 'ses_far', projectDirectory: '/other' })];
  assert.deepEqual(pick(designs, { directory: '/mine', working: new Set(['ses_far']) }).picked, []);
});

test('directory compare ignores slash style and trailing slash, and case on Windows drive paths', () => {
  const designs = [summary('win', { projectDirectory: 'C:\\Users\\Me\\Shop\\' })];
  assert.deepEqual(slugs(pick(designs, { directory: 'c:/users/me/shop' }).picked), ['win']);
  // POSIX paths stay case-sensitive.
  const posix = [summary('posix', { projectDirectory: '/home/me/Shop' })];
  assert.deepEqual(pick(posix, { directory: '/home/me/shop' }).picked, []);
});

test('without a project only the last 7 days count, anywhere; the edge day is in, the day after is out', () => {
  const designs = [
    summary('in', { updated: iso(NOW - STATUS_RECENT_MS), projectDirectory: '/a' }),
    summary('out', { updated: iso(NOW - STATUS_RECENT_MS - 1), projectDirectory: '/b' }),
    summary('nameless', { updated: iso(NOW - 1000) }),
    summary('bad-date', { updated: 'not a date' }),
  ];
  assert.deepEqual(slugs(pick(designs).picked).sort(), ['in', 'nameless']);
});

test('with a project, designs older than 7 days are left out unless this chat\'s or being worked on', () => {
  const old = iso(NOW - 30 * DAY);
  const designs = [
    summary('stale', { updated: old, projectDirectory: '/p' }),
    summary('mine', { updated: old, sessionId: 'ses_me', projectDirectory: '/p' }),
    summary('busy', { updated: old, sessionId: 'ses_w', projectDirectory: '/p' }),
  ];
  assert.deepEqual(slugs(pick(designs, { directory: '/p', sessionId: 'ses_me', working: new Set(['ses_w']) }).picked), ['mine', 'busy']);
});

test('rows are cut at STATUS_ROWS_MAX while total counts every match', () => {
  const designs = Array.from({ length: STATUS_ROWS_MAX + 4 }, (_, index) => summary(`d${index}`, { updated: iso(NOW - index * 1000) }));
  const { picked, total } = pick(designs);
  assert.equal(picked.length, STATUS_ROWS_MAX);
  assert.equal(total, STATUS_ROWS_MAX + 4);
  assert.deepEqual(slugs(picked), ['d0', 'd1', 'd2', 'd3', 'd4']);
});

test('the order does not depend on the input order, and ties break on the slug', () => {
  const same = iso(NOW - 1000);
  const designs = [summary('b', { updated: same }), summary('a', { updated: same }), summary('c', { updated: iso(NOW - 10) })];
  assert.deepEqual(slugs(pick(designs).picked), ['c', 'a', 'b']);
  assert.deepEqual(slugs(pick([...designs].reverse()).picked), ['c', 'a', 'b']);
});

// ---- agentStateOf ----

test('agent state follows the pill words: writing inside the window, else working, failed, or nothing', () => {
  const file = { file: 'pricing.html', at: NOW - 1000 };
  assert.deepEqual(agentStateOf({ state: 'working' }, file, NOW), { agent: 'writing', lastFile: 'pricing.html' });
  assert.deepEqual(agentStateOf({ state: 'working' }, { ...file, at: NOW - WRITING_WINDOW_MS }, NOW), { agent: 'working', lastFile: null });
  assert.deepEqual(agentStateOf({ state: 'working' }, null, NOW), { agent: 'working', lastFile: null });
  assert.deepEqual(agentStateOf({ state: 'failed' }, file, NOW), { agent: 'failed', lastFile: null });
  assert.deepEqual(agentStateOf({ state: 'done' }, file, NOW), { agent: null, lastFile: null });
  assert.deepEqual(agentStateOf(null, file, NOW), { agent: null, lastFile: null });
});

// ---- createStatusDesigns over fakes ----

const checksResponse = (over: Partial<ChecksResponse['counts']> = {}, state: ChecksResponse['render']['state'] = 'fresh'): ChecksResponse => ({
  static: { findings: [], partial: false, at: iso(NOW) },
  render: { state, at: null, artboards: 0, skipped: 0, findings: [] },
  counts: { errors: 0, warnings: 0, notes: 0, ...over },
  canRun: true,
  browser: true,
});

type Rig = {
  status: ReturnType<typeof createStatusDesigns>;
  emit(slug: string | null, kind: ChangeEvent['kind'], files?: string[]): void;
  listeners: Set<(event: ChangeEvent) => void>;
  disposers: (() => void)[];
  clock: { now: number };
  logs: string[];
  setIndex(designs: DesignSummary[]): void;
  activity: Map<string, SessionActivity>;
};

const rig = (initial: DesignSummary[], over: { ready?: boolean; checksFor?: StatusDesignsDeps['checksFor']; index?: Partial<DesignIndex>; activity?: Partial<ActivityTracker> } = {}): Rig => {
  let designs = initial;
  const listeners = new Set<(event: ChangeEvent) => void>();
  const disposers: (() => void)[] = [];
  const activity = new Map<string, SessionActivity>();
  const logs: string[] = [];
  const clock = { now: NOW };
  let seq = 0;
  const ctx: StatusContext = {
    hub: {
      epoch: 'e',
      seq: () => seq,
      emit: (event) => ({ seq: ++seq, ...event }),
      waitFor: () => Promise.reject(new Error('not used')),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    designIndex: {
      all: () => designs,
      get: (slug) => designs.find((design) => design.slug === slug) ?? null,
      bySession: () => [],
      ready: () => Promise.resolve(over.ready ?? true),
      dispose: () => Promise.resolve(),
      ...over.index,
    },
    activity: {
      record: () => undefined,
      of: (sessionId) => activity.get(sessionId) ?? null,
      working: () => [...activity.values()].filter((entry) => entry.state === 'working'),
      ...over.activity,
    },
    log: { info: () => undefined, warn: (event) => void logs.push(event), error: (event) => void logs.push(event) },
    onDispose: (fn) => void disposers.push(() => void fn()),
  };
  const status = createStatusDesigns(ctx, { checksFor: over.checksFor ?? (() => Promise.resolve(checksResponse())), now: () => clock.now, indexWaitMs: 20, checkReadMs: 30 });
  return {
    status,
    emit: (slug, kind, files) => {
      seq += 1;
      for (const listener of [...listeners]) listener({ seq, slug, kind, ...(files ? { files } : {}) });
    },
    listeners,
    disposers,
    clock,
    logs,
    setIndex: (next) => void (designs = next),
    activity,
  };
};

const working = (sessionId: string): SessionActivity => ({ sessionId, state: 'working', at: NOW, directory: null });

test('a row carries the counts, render state, comments and linked flag from memory', async () => {
  const r = rig([summary('pricing', { sessionId: 'ses_me', openComments: 2, projectDirectory: '/p' })], {
    checksFor: () => Promise.resolve(checksResponse({ errors: 1, warnings: 2 }, 'stale')),
  });
  const answer = await r.status.answer({ directory: '/p', session: 'ses_me' });
  assert.deepEqual(answer, {
    total: 1,
    rows: [
      {
        slug: 'pricing',
        title: 'pricing',
        kind: 'page',
        here: true,
        agent: null,
        lastFile: null,
        checks: { counts: { errors: 1, warnings: 2, notes: 0 }, render: { state: 'stale' }, canRun: true, browser: true },
        pending: false,
        openComments: 2,
      },
    ],
  });
});

test('Writing: a file event for a working agent names its base name; it fades after the window', async () => {
  const r = rig([summary('pricing', { sessionId: 'ses_me' })]);
  r.activity.set('ses_me', working('ses_me'));
  r.emit('pricing', 'files', ['assets/img.png', 'pages/pricing.html', 'design.json', '.versions/v1/x.html', 'pricing.html.ab12.tmp']);
  const live = (await r.status.answer({ session: 'ses_me' })).rows[0];
  assert.equal(live?.agent, 'writing');
  assert.equal(live?.lastFile, 'pricing.html');
  r.clock.now += WRITING_WINDOW_MS + 1;
  const quiet = (await r.status.answer({ session: 'ses_me' })).rows[0];
  assert.equal(quiet?.agent, 'working');
  assert.equal(quiet?.lastFile, null);
});

test('files the agent did not write (design.json, service folders, temp names) never become the last file', async () => {
  const r = rig([summary('d', { sessionId: 's' })]);
  r.activity.set('s', working('s'));
  r.emit('d', 'files', ['design.json', '.chamber/check.json', '.versions/v2/index.html', 'index.html.9f.tmp']);
  assert.equal((await r.status.answer({})).rows[0]?.agent, 'working');
});

test('a restore (a files event with no list) and its echo are not the agent writing; later writes are', async () => {
  const r = rig([summary('d', { sessionId: 's' })]);
  r.activity.set('s', working('s'));
  r.emit('d', 'files', ['index.html']);
  r.emit('d', 'files');
  r.clock.now += 10;
  r.emit('d', 'files', ['index.html']);
  assert.equal((await r.status.answer({})).rows[0]?.agent, 'working');
  r.clock.now += RESTORE_QUIET_MS;
  r.emit('d', 'files', ['about.html']);
  const after = (await r.status.answer({})).rows[0];
  assert.equal(after?.agent, 'writing');
  assert.equal(after?.lastFile, 'about.html');
});

test('a removed design forgets its last file, and a root change forgets all of them', async () => {
  const r = rig([summary('a', { sessionId: 'sa' }), summary('b', { sessionId: 'sb' })]);
  r.activity.set('sa', working('sa'));
  r.activity.set('sb', working('sb'));
  r.emit('a', 'files', ['a.html']);
  r.emit('b', 'files', ['b.html']);
  r.emit('a', 'removed');
  const byAgent = async (): Promise<Record<string, string | null | undefined>> =>
    Object.fromEntries((await r.status.answer({})).rows.map((row) => [row.slug, row.agent]));
  assert.deepEqual(await byAgent(), { a: 'working', b: 'writing' });
  r.emit(null, 'root');
  assert.deepEqual(await byAgent(), { a: 'working', b: 'working' });
});

test('events for other kinds and root-wide events without a slug are ignored', async () => {
  const r = rig([summary('d', { sessionId: 's' })]);
  r.activity.set('s', working('s'));
  r.emit('d', 'comments');
  r.emit(null, 'loose');
  r.emit('d', 'checks');
  assert.equal((await r.status.answer({})).rows[0]?.agent, 'working');
});

test('a failed last turn says failed; a finished one says nothing', async () => {
  const r = rig([summary('f', { sessionId: 'sf' }), summary('d', { sessionId: 'sd' })]);
  r.activity.set('sf', { sessionId: 'sf', state: 'failed', at: NOW, directory: null });
  r.activity.set('sd', { sessionId: 'sd', state: 'done', at: NOW, directory: null });
  const rows = (await r.status.answer({})).rows;
  assert.equal(rows.find((row) => row.slug === 'f')?.agent, 'failed');
  assert.equal(rows.find((row) => row.slug === 'd')?.agent, null);
});

test('a design linked to no chat, or to a chat the tracker never saw, has no agent state', async () => {
  const r = rig([summary('solo'), summary('unseen', { sessionId: 'ses_x' })]);
  for (const row of (await r.status.answer({})).rows) assert.equal(row.agent, null, row.slug);
});

test('a slow check read leaves that row without a check part and does not delay the others', async () => {
  const r = rig([summary('slow'), summary('fast')], {
    checksFor: (slug) => (slug === 'slow' ? new Promise<ChecksResponse>(() => undefined) : Promise.resolve(checksResponse({ errors: 3 }))),
  });
  const started = Date.now();
  const rows = (await r.status.answer({})).rows;
  assert.ok(Date.now() - started < 1000, 'answered within the read budget, not the slow read');
  assert.equal(rows.find((row) => row.slug === 'slow')?.checks, null);
  assert.equal(rows.find((row) => row.slug === 'fast')?.checks?.counts.errors, 3);
});

test('a failing check read (the design vanished, the folder broke) gives checks: null, never an error', async () => {
  const r = rig([summary('gone')], { checksFor: () => Promise.reject(new Error('That design does not exist.')) });
  const answer = await r.status.answer({});
  assert.equal(answer.total, 1);
  assert.equal(answer.rows[0]?.checks, null);
});

test('a design with nothing written yet is listed as pending and its checks are not read', async () => {
  let reads = 0;
  const r = rig([summary('empty', { pending: true })], { checksFor: () => (reads++, Promise.resolve(checksResponse())) });
  const row = (await r.status.answer({})).rows[0];
  assert.equal(row?.pending, true);
  assert.equal(row?.checks, null);
  assert.equal(reads, 0);
});

test('check reads are made only for the listed rows, at most STATUS_ROWS_MAX', async () => {
  const seen = new Set<string>();
  const designs = Array.from({ length: STATUS_ROWS_MAX + 3 }, (_, index) => summary(`d${index}`, { updated: iso(NOW - index * 1000) }));
  const r = rig(designs, { checksFor: (slug) => (seen.add(slug), Promise.resolve(checksResponse())) });
  const answer = await r.status.answer({});
  assert.equal(answer.rows.length, STATUS_ROWS_MAX);
  assert.equal(answer.total, STATUS_ROWS_MAX + 3);
  assert.equal(seen.size, STATUS_ROWS_MAX);
});

test('a cold index that never loads answers an empty list within the wait', async () => {
  const r = rig([summary('d')], { ready: false });
  assert.deepEqual(await r.status.answer({}), { rows: [], total: 0 });
});

test('an index or tracker that throws answers an empty list and logs, never rejects', async () => {
  const brokenIndex = rig([], { index: { all: () => { throw new Error('index exploded'); } } });
  assert.deepEqual(await brokenIndex.status.answer({}), { rows: [], total: 0 });
  assert.deepEqual(brokenIndex.logs, ['status.designs-failed']);
  const brokenTracker = rig([summary('d')], { activity: { working: () => { throw new Error('tracker exploded'); } } });
  assert.deepEqual(await brokenTracker.status.answer({}), { rows: [], total: 0 });
});

test('empty query strings mean "not given": no project filter, no linked chat', async () => {
  const r = rig([summary('a', { projectDirectory: '/x', sessionId: '' })]);
  const answer = await r.status.answer({ directory: '', session: '' });
  assert.equal(answer.rows.length, 1);
  assert.equal(answer.rows[0]?.here, false);
});

test('the hub listener is removed on dispose', () => {
  const r = rig([]);
  assert.equal(r.listeners.size, 1);
  for (const dispose of r.disposers) dispose();
  assert.equal(r.listeners.size, 0);
});

// ---- GET /status/designs over a real router ----

const TOKEN = 'status-test-token';

const serve = async (t: TestContext, overrides: Parameters<typeof createFakeContext>[0]['overrides']) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerStatusRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    ctx,
    get: (query: string, token: string | null = TOKEN) =>
      fetch(`http://127.0.0.1:${port}/status/designs${query}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } }),
  };
};

const fakeIndex = (designs: DesignSummary[]): DesignIndex => ({
  all: () => designs,
  get: () => null,
  bySession: () => [],
  ready: () => Promise.resolve(true),
  dispose: () => Promise.resolve(),
});

test('GET /status/designs refuses a missing or wrong token with 401 and reads nothing', async (t) => {
  let reads = 0;
  const index = fakeIndex([summary('d')]);
  const s = await serve(t, { designIndex: { ...index, all: () => (reads++, index.all()) } });
  for (const token of [null, '', 'wrong', `${TOKEN}x`]) {
    const answer = await s.get('', token);
    assert.equal(answer.status, 401, String(token));
    assert.equal(((await answer.json()) as { error: string }).error, 'unauthorized');
  }
  assert.equal(reads, 0);
});

test('GET /status/designs answers rows for the project and chat in the query', async (t) => {
  const designs = [
    summary('mine', { sessionId: 'ses_me', projectDirectory: '/home/me/shop', updated: iso(Date.now() - 1000) }),
    summary('other', { projectDirectory: '/home/me/blog', updated: iso(Date.now() - 1000) }),
  ];
  const s = await serve(t, { designIndex: fakeIndex(designs) });
  const answer = await s.get(`?directory=${encodeURIComponent('/home/me/shop')}&session=ses_me`);
  assert.equal(answer.status, 200);
  const body = (await answer.json()) as StatusDesignsResponse;
  assert.deepEqual(body.rows.map((row) => [row.slug, row.here]), [['mine', true]]);
  assert.equal(body.total, 1);
});

test('GET /status/designs treats traversal-looking, encoded and oversized input as plain text that matches nothing, never as a path', async (t) => {
  const s = await serve(t, { designIndex: fakeIndex([summary('d', { projectDirectory: '/home/me/shop', updated: iso(Date.now()) })]) });
  const hostile = ['../../etc', '..%2F..%2Fetc', '%2e%2e%5c%2e%2e', 'C:%5CWindows%5CSystem32', '%00', '/home/me/shop/../../..', 'x'.repeat(4000)];
  for (const value of hostile) {
    for (const key of ['directory', 'session']) {
      const answer = await s.get(`?${key}=${value}`);
      assert.equal(answer.status, 200, `${key}=${value.slice(0, 40)}`);
      const body = (await answer.json()) as StatusDesignsResponse;
      if (key === 'directory') assert.deepEqual(body, { rows: [], total: 0 }, value.slice(0, 40));
      else assert.ok(body.rows.every((row) => !row.here));
    }
  }
});

test('GET /status/designs answers an empty list, not a 500, when the index fails', async (t) => {
  const s = await serve(t, { designIndex: { ...fakeIndex([]), all: () => { throw new Error('boom'); } } });
  const answer = await s.get('');
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { rows: [], total: 0 });
  assert.ok(s.ctx.logs.some((line) => line.event === 'status.designs-failed'));
});
