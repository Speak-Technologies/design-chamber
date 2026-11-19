// The systems routes over HTTP (documentation/specs/phase-2-5-technical.md §3.1): the bearer check,
// the id gate (traversal), body validation with sentences, and the list → create → get → patch →
// delete flow against a real system store in a temp designs root.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { CreateSystemResponse, DeleteSystemResponse, PatchSystemResponse, SystemListResponse } from '../../../src/shared/api.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'systems-routes-token-0123456789';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown, token: string | null = TOKEN) => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: (await answer.json()) as unknown };
  };
  return { tmp, call };
};

test('every systems route refuses a missing or wrong token with 401 and touches nothing', async (t) => {
  const { tmp, call } = await serve(t);
  const routes: [string, string, unknown?][] = [
    ['GET', '/systems'],
    ['POST', '/systems', { name: 'Acme' }],
    ['GET', '/systems/acme'],
    ['PATCH', '/systems/acme', { status: 'ready' }],
    ['DELETE', '/systems/acme'],
  ];
  for (const [method, url, body] of routes) {
    for (const token of [null, 'wrong-token']) {
      const answer = await call(method, url, body, token);
      assert.equal(answer.status, 401, `${method} ${url} ${String(token)}`);
    }
  }
  assert.equal(await tmp.read('_systems/acme/tokens.css').catch(() => null), null);
});

test('a traversal or invalid id is refused before the store builds a path', async (t) => {
  const { call } = await serve(t);
  for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b']) {
    const answer = await call('GET', `/systems/${hostile}`);
    assert.equal(answer.status, 400, hostile);
  }
  for (const bad of ['Acme', '_systems', '.chamber', 'C%3A', '...']) {
    const answer = await call('GET', `/systems/${bad}`);
    assert.equal(answer.status, 400, bad);
    assert.equal((answer.json as { error: string }).error, 'bad-slug', bad);
  }
});

test('the flow: empty list, create, get, review, ready, rename, delete', async (t) => {
  const { call } = await serve(t);
  let list = (await call('GET', '/systems')).json as SystemListResponse;
  assert.deepEqual(list, { systems: [], total: 0, max: 50 });

  const created = await call('POST', '/systems', { name: 'Acme', description: { text: 'Calm.', preset: null } });
  assert.equal(created.status, 200);
  const { id, system } = created.json as CreateSystemResponse;
  assert.equal(id, 'acme');
  assert.equal(system.name, 'Acme');

  list = (await call('GET', '/systems')).json as SystemListResponse;
  assert.deepEqual(list.systems.map((row) => [row.id, row.status, row.empty, row.home]), [['acme', 'draft', true, 'internal']]);

  const detail = (await call('GET', '/systems/acme')).json as SystemDetail;
  assert.equal(detail.revision, 1);
  assert.equal(detail.editable, true);

  const reviewed = await call('PATCH', '/systems/acme', { review: { section: 'overview', state: 'looks-good' } });
  assert.equal(reviewed.status, 200);
  const ready = (await call('PATCH', '/systems/acme', { status: 'ready' })).json as PatchSystemResponse;
  assert.deepEqual(ready.readyNote, { unreviewed: 11 });
  assert.equal(ready.system.status, 'ready');

  const renamed = (await call('PATCH', '/systems/acme', { name: 'Acme Brand' })).json as PatchSystemResponse;
  assert.equal(renamed.system.name, 'Acme Brand');

  const deleted = await call('DELETE', '/systems/acme');
  assert.equal(deleted.status, 200);
  assert.deepEqual((deleted.json as DeleteSystemResponse).clearedSettings, { default: false, pins: 0 });
  const gone = await call('GET', '/systems/acme');
  assert.equal(gone.status, 404);
  assert.deepEqual(gone.json, { error: 'not-found', message: 'That design system is no longer in your Designs folder.' });
});

test('bodies are validated with plain sentences', async (t) => {
  const { call } = await serve(t);
  const refusals: [string, string, unknown, number, string][] = [
    ['POST', '/systems', [], 400, 'The new design system request must be a JSON object.'],
    ['POST', '/systems', { name: '' }, 400, 'Give the design system a name.'],
    ['POST', '/systems', { name: 'A', description: { text: 'x'.repeat(2001), preset: null } }, 400, 'The description must be text of at most 2000 characters.'],
    ['POST', '/systems', { name: 'A', description: { text: 'x', preset: '../x' } }, 400, 'That is not a style preset id.'],
    ['POST', '/systems', { name: 'A', brand: false }, 400, 'brand must be true when brand files will follow.'],
    ['POST', '/systems', { name: 'A', code: { scanId: 'nope', assets: [] } }, 400, 'The code part of the request must name a scan and the files to copy.'],
  ];
  for (const [method, url, body, status, message] of refusals) {
    const answer = await call(method, url, body);
    assert.equal(answer.status, status, JSON.stringify(body));
    assert.equal((answer.json as { message: string }).message, message);
  }
  await call('POST', '/systems', { name: 'Acme' });
  const patches: [unknown, string][] = [
    [{}, 'Change one thing at a time: name, status, review, sessionId or livingPage.'],
    [{ name: 'a', status: 'ready' }, 'Change one thing at a time: name, status, review, sessionId or livingPage.'],
    [{ status: 'done' }, 'A design system is either a draft or ready.'],
    [{ review: { section: 'nope', state: 'looks-good' } }, "That isn't a section of a design system."],
    [{ review: { section: 'colours', state: 'great' } }, 'A review is looks-good, needs-work or not-reviewed.'],
    [{ sessionId: 5 }, 'That is not a chat session id.'],
    [{ livingPage: { embedFonts: 'yes' } }, 'livingPage takes { embedFonts: true or false }.'],
    [{ colour: 'red' }, 'Say what to change: name, status, review, sessionId or livingPage.'],
  ];
  for (const [body, message] of patches) {
    const answer = await call('PATCH', '/systems/acme', body);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.equal((answer.json as { message: string }).message, message);
  }
  const duplicate = await call('POST', '/systems', { name: 'acme' });
  assert.equal(duplicate.status, 409);
  assert.equal((duplicate.json as { message: string }).message, 'You already have a system called Acme.');
});

test('the living-page state is still T14 and answers not built yet', async (t) => {
  const { call } = await serve(t);
  const answer = await call('GET', '/systems/acme/living-page');
  assert.equal(answer.status, 500);
  assert.equal((answer.json as { message: string }).message, 'This part of Design Chamber (design systems) is not built yet.');
});
