// The Phase 1.5 seams on the composed service (documentation/specs/phase-1-5-sdk-2-7.md §3.5,
// §10.1, §12.1): every new route is served behind the bearer (401 without it or with a wrong
// one), each stub answers its graceful shape, `POST /session-events` reads its body with the
// SDK reader at the boundary, and the design index is wired to the real store and hub.

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { composeService, type ComposedService } from '../../../src/service/compose.ts';
import type { Logger } from '../../../src/service/context.ts';
import { createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const TOKEN = 'seam-routes-test-token';

type Reply = { status: number; json: unknown };

const useServed = async (t: TestContext): Promise<{ service: ComposedService; root: string; call: (route: string, init?: { method?: string; body?: unknown; token?: string | null }) => Promise<Reply> }> => {
  const tmp = await useTmpRoot(t);
  const root = tmp.at('designs');
  await mkdir(root, { recursive: true });
  const settingsPath = tmp.at('settings.json');
  await writeFile(settingsPath, `${JSON.stringify({ version: 1, root })}\n`, 'utf8');
  const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const service = await composeService({ token: TOKEN, log, packageRoot: REPO_ROOT, version: '0.0.0-test', env: { DC_SETTINGS_PATH: settingsPath }, homeDir: tmp.at('home') });
  const server = createServiceServer(service.router);
  await listenLoopback(server, 0);
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.dispose();
  });
  const { port } = server.address() as AddressInfo;
  const call = async (route: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<Reply> => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.token === null ? {} : { authorization: `Bearer ${init.token ?? TOKEN}` },
      ...(init.body !== undefined ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) } : {}),
    });
    return { status: response.status, json: await response.json() };
  };
  return { service, root, call };
};

const sessionEvent = (type: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  requestId: 'req_1',
  event: { id: 'evt_1', type, at: Date.now(), session: { id: 'ses_abcdefgh1234', parentId: null }, project: { directory: '/home/you/shop' }, linked: [], ...over },
});

const NEW_ROUTES: [string, { method?: string; body?: unknown }][] = [
  ['/session-events', { body: sessionEvent('turn-finished') }],
  ['/mentions/search', { body: { query: 'pri', directory: null } }],
  ['/mentions/resolve', { body: { id: 'pricing' } }],
  ['/status/designs?directory=%2Fhome%2Fyou%2Fshop&session=ses_1', {}],
  ['/open-request', { body: { slug: 'pricing' } }],
  ['/agent/skill', { method: 'DELETE' }],
];

test('every new route refuses a missing or wrong token with 401', async (t) => {
  const { call } = await useServed(t);
  for (const [route, init] of NEW_ROUTES) {
    for (const token of [null, 'wrong-token', '']) {
      const reply = await call(route, { ...init, token });
      assert.equal(reply.status, 401, `${init.method ?? (init.body === undefined ? 'GET' : 'POST')} ${route} token=${String(token)}`);
    }
  }
});

test('the stubs answer their graceful shapes', async (t) => {
  const { call } = await useServed(t);
  assert.deepEqual(await call('/status/designs?directory=%2Fhome%2Fyou%2Fshop&session=ses_1'), { status: 200, json: { rows: [], total: 0 } });
  assert.deepEqual(await call('/status/designs'), { status: 200, json: { rows: [], total: 0 } });
  assert.deepEqual(await call('/mentions/search', { body: { query: '', directory: null } }), { status: 200, json: { items: [] } });
  const resolve = await call('/mentions/resolve', { body: { id: 'pricing' } });
  assert.equal(resolve.status, 404);
  for (const id of ['../x', '/abs', 'C:\\x', 'a/b', '']) assert.equal((await call('/mentions/resolve', { body: { id } })).status, 400, id);
  const skill = await call('/agent/skill', { method: 'DELETE' });
  assert.equal(skill.status, 200);
  assert.equal((skill.json as { skill: { state: string } }).skill.state, 'not-installed');
  assert.equal((await call('/agent/skill', { method: 'POST', body: {} })).status, 404, 'POST /agent/skill is gone');
});

test('POST /session-events: exactly { ok: true } for our events and for events we do not act on; 400 for a body that is not one', async (t) => {
  const { call } = await useServed(t);
  for (const type of ['turn-started', 'turn-finished', 'turn-failed', 'session-created', 'permission-asked']) {
    assert.deepEqual(await call('/session-events', { body: sessionEvent(type) }), { status: 200, json: { ok: true } }, type);
  }
  // A session id we would not store is dropped, not an error (an error makes the host back off).
  assert.deepEqual(await call('/session-events', { body: sessionEvent('turn-finished', { session: { id: 'x'.repeat(200), parentId: null } }) }), { status: 200, json: { ok: true } });
  assert.deepEqual(await call('/session-events', { body: sessionEvent('turn-finished', { session: { id: 'ses\nfake', parentId: null } }) }), { status: 200, json: { ok: true } });
  for (const body of [{}, { v: 2, requestId: 'r', event: sessionEvent('turn-finished').event }, sessionEvent('turn-exploded'), { ...sessionEvent('turn-finished'), requestId: '' }, [], 'turn-finished']) {
    const reply = await call('/session-events', { body });
    assert.equal(reply.status, 400, JSON.stringify(body));
    assert.equal((reply.json as { error: string }).error, 'bad-request');
  }
  assert.equal((await call('/session-events', { method: 'POST' })).status, 400, 'an empty body');
});

test('the design index on the composed service follows the real store and hub', async (t) => {
  const { service } = await useServed(t);
  const { ctx } = service;
  assert.equal(await ctx.designIndex.ready(2000), true);
  assert.deepEqual(ctx.designIndex.all(), []);
  const record = await ctx.store.create({ kind: 'page', title: 'Indexed page', brief: '', preset: null, projectDirectory: null, sessionId: 'ses_linked' });
  for (let i = 0; i < 100 && ctx.designIndex.get(record.slug) === null; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(ctx.designIndex.get(record.slug)?.title, 'Indexed page');
  assert.equal(ctx.designIndex.get(record.slug)?.projectDirectory, null);
  assert.deepEqual(ctx.designIndex.bySession('ses_linked'), [record.slug]);
  assert.equal(await ctx.hostCalls.setInstructions('x'), 'unavailable', 'no host callback in tests');
  assert.equal(ctx.activity.of('ses_linked'), null);
});
