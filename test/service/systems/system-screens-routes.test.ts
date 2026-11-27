// System builder depth Phase 2, Wave 0 (documentation/specs/system-builder-depth.md §13 T12a): the two
// system screens routes are registered as stubs behind the router's bearer check and path-parameter
// gate. T12a builds them and moves the "not built yet" test to its answers; the refusals stay.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import { ROUTE_KEYS, ROUTE_OWNERS, splitRouteKey, type RouteKey } from '../../../src/shared/api.ts';
import type { Logger, ServiceContext } from '../../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemScreenRoutes, SYSTEM_SCREENS_NOT_BUILT } from '../../../src/service/routes/system-screens.ts';

const TOKEN = 'system-screens-token-0123456789';
const SBD = ROUTE_KEYS.filter((key) => ROUTE_OWNERS[key] === 'SBD');

const serve = async (t: TestContext) => {
  const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const router = createRouter({ token: TOKEN, log: quiet });
  // Safe: the stubs never read the context.
  registerSystemScreenRoutes(router, {} as ServiceContext);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  assert.equal((server.address() as AddressInfo).address, '127.0.0.1');
  const call = (key: RouteKey, id: string, token: string | null = TOKEN) => {
    const url = splitRouteKey(key).pattern.replace(':id', id);
    return fetch(`http://127.0.0.1:${port}${url}?screen=home`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });
  };
  return { router, call };
};

test('the screens file registers exactly the two SBD routes', async (t) => {
  const { router } = await serve(t);
  assert.deepEqual([...router.registered()].sort(), [...SBD].sort());
  assert.equal(SBD.length, 2);
});

test('each screens route refuses a missing or wrong token with 401', async (t) => {
  const { call } = await serve(t);
  for (const key of SBD) {
    for (const token of [null, 'wrong-token']) {
      const answer = await call(key, 'acme', token);
      assert.equal(answer.status, 401, `${key} ${String(token)}`);
      assert.deepEqual(await answer.json(), { error: 'unauthorized', message: 'This request did not carry the service token.' });
    }
  }
});

test('each screens route refuses an encoded separator or NUL in :id (traversal) with 400', async (t) => {
  const { call } = await serve(t);
  for (const key of SBD) {
    for (const hostile of ['..%2F..%2Fetc', '..%5C..%5Cwindows', 'a%00b']) {
      const answer = await call(key, hostile);
      assert.equal(answer.status, 400, `${key} ${hostile}`);
      assert.equal(((await answer.json()) as { error: string }).error, 'bad-path', `${key} ${hostile}`);
    }
  }
});

test('with the token, each stub answers 500 "not built yet" until T12a', async (t) => {
  const { call } = await serve(t);
  for (const key of SBD) {
    const answer = await call(key, 'acme');
    assert.equal(answer.status, 500, key);
    assert.deepEqual(await answer.json(), { error: 'internal', message: SYSTEM_SCREENS_NOT_BUILT });
  }
});
