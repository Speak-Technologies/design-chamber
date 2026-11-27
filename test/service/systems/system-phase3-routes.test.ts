// System builder depth Phase 3, Wave 0 (documentation/specs/system-builder-depth.md §13 T19, T20): the
// token export and board comments routes are registered as stubs behind the router's bearer check and
// path-parameter gate. T19 and T20 build them and move the "isn't ready yet" tests to their answers;
// the refusals stay.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import { ROUTE_KEYS, ROUTE_OWNERS, splitRouteKey, type RouteKey } from '../../../src/shared/api.ts';
import type { Logger, ServiceContext } from '../../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemExportRoutes, SYSTEM_EXPORT_NOT_READY } from '../../../src/service/routes/export.ts';
import { parseSystemPromptBody } from '../../../src/service/routes/system-chat.ts';
import { registerSystemCommentRoutes, SYSTEM_COMMENTS_NOT_READY } from '../../../src/service/routes/system-comments.ts';

const TOKEN = 'system-phase3-token-0123456789';
const SBD3 = ROUTE_KEYS.filter((key) => ROUTE_OWNERS[key] === 'SBD3');
const EXPORT_ROUTES: RouteKey[] = ['GET /systems/:id/export', 'POST /systems/:id/export'];

const serve = async (t: TestContext) => {
  const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const router = createRouter({ token: TOKEN, log: quiet });
  // Safe: the stubs never read the context.
  registerSystemExportRoutes(router, {} as ServiceContext);
  registerSystemCommentRoutes(router, {} as ServiceContext);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  assert.equal((server.address() as AddressInfo).address, '127.0.0.1');
  const call = (key: RouteKey, params: { id: string; commentId?: string }, token: string | null = TOKEN) => {
    const { method, pattern } = splitRouteKey(key);
    const url = pattern.replace(':id', params.id).replace(':commentId', params.commentId ?? 'c_abcd1234');
    const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
    const withBody = method === 'POST' || method === 'PATCH';
    return fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: withBody ? { ...headers, 'content-type': 'application/json' } : headers,
      ...(withBody ? { body: '{}' } : {}),
    });
  };
  return { router, call };
};

test('the two stub files register exactly the seven SBD3 routes', async (t) => {
  const { router } = await serve(t);
  assert.deepEqual([...router.registered()].sort(), [...SBD3].sort());
  assert.equal(SBD3.length, 7);
});

test('each Phase 3 route refuses a missing or wrong token with 401', async (t) => {
  const { call } = await serve(t);
  for (const key of SBD3) {
    for (const token of [null, 'wrong-token']) {
      const answer = await call(key, { id: 'acme' }, token);
      assert.equal(answer.status, 401, `${key} ${String(token)}`);
      assert.deepEqual(await answer.json(), { error: 'unauthorized', message: 'This request did not carry the service token.' });
    }
  }
});

test('each Phase 3 route refuses an encoded separator or NUL in :id or :commentId (traversal) with 400', async (t) => {
  const { call } = await serve(t);
  const hostiles = ['..%2F..%2Fetc', '..%5C..%5Cwindows', 'a%00b'];
  for (const key of SBD3) {
    for (const hostile of hostiles) {
      const answer = await call(key, { id: hostile });
      assert.equal(answer.status, 400, `${key} id ${hostile}`);
      assert.equal(((await answer.json()) as { error: string }).error, 'bad-path', `${key} id ${hostile}`);
    }
    if (!splitRouteKey(key).pattern.includes(':commentId')) continue;
    for (const hostile of hostiles) {
      const answer = await call(key, { id: 'acme', commentId: hostile });
      assert.equal(answer.status, 400, `${key} commentId ${hostile}`);
      assert.equal(((await answer.json()) as { error: string }).error, 'bad-path', `${key} commentId ${hostile}`);
    }
  }
});

test("with the token, each stub answers 500 \"isn't ready yet\" until T19 and T20", async (t) => {
  const { call } = await serve(t);
  for (const key of SBD3) {
    const answer = await call(key, { id: 'acme' });
    assert.equal(answer.status, 500, key);
    const message = EXPORT_ROUTES.includes(key) ? SYSTEM_EXPORT_NOT_READY : SYSTEM_COMMENTS_NOT_READY;
    assert.deepEqual(await answer.json(), { error: 'internal', message }, key);
  }
});

test("the comments prompt purpose isn't ready yet until T20; other purposes are unchanged", () => {
  assert.throws(() => parseSystemPromptBody({ purpose: 'comments' }), { code: 'internal', message: SYSTEM_COMMENTS_NOT_READY });
  assert.equal(parseSystemPromptBody({ purpose: 'continue' }).purpose, 'continue');
  assert.throws(() => parseSystemPromptBody({ purpose: 'nope' }), { code: 'bad-request' });
});
