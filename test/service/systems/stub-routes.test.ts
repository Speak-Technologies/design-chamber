// Phase 2.5 T0 (documentation/specs/phase-2-5-technical.md §18): every new route is registered as a
// stub that answers the "not built yet" sentence, behind the same bearer check and path-parameter
// gate as every other route. Each task that fills a route keeps these refusals.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import { ROUTE_KEYS, ROUTE_OWNERS, splitRouteKey, type RouteKey } from '../../../src/shared/api.ts';
import type { Logger, ServiceContext } from '../../../src/service/context.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerDesignSystemRoutes } from '../../../src/service/routes/design-system.ts';
import { registerFoldersRoutes } from '../../../src/service/routes/folders.ts';
import { registerSystemAssetRoutes } from '../../../src/service/routes/system-assets.ts';
import { registerSystemBoardRoutes } from '../../../src/service/routes/system-board.ts';
import { registerSystemBuildRoutes } from '../../../src/service/routes/system-build.ts';
import { registerSystemChatRoutes } from '../../../src/service/routes/system-chat.ts';
import { registerSystemChecksRoutes } from '../../../src/service/routes/system-checks.ts';
import { registerSystemEditRoutes } from '../../../src/service/routes/system-edits.ts';
import { registerSystemScanRoutes } from '../../../src/service/routes/system-scans.ts';
import { registerSystemVersionsRoutes } from '../../../src/service/routes/system-versions.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { SYSTEMS_NOT_BUILT_MESSAGE } from '../../../src/service/systems/not-built.ts';

const TOKEN = 'stub-routes-token-0123456789';
const P25 = ROUTE_KEYS.filter((key) => ROUTE_OWNERS[key] === 'P25');

const serve = async (t: TestContext) => {
  const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const router = createRouter({ token: TOKEN, log: quiet });
  // Safe: no route reads the context at registration and the stubs never read it; the built routes
  // are only called here without a token or with a refused path parameter (rejected before the handler).
  const ctx = {} as ServiceContext;
  for (const register of [
    registerSystemsRoutes,
    registerSystemVersionsRoutes,
    registerSystemEditRoutes,
    registerSystemScanRoutes,
    registerSystemAssetRoutes,
    registerSystemBoardRoutes,
    registerSystemChatRoutes,
    registerSystemChecksRoutes,
    registerDesignSystemRoutes,
    registerFoldersRoutes,
    registerSystemBuildRoutes,
  ]) {
    register(router, ctx);
  }
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = (key: RouteKey, param: (name: string) => string, token: string | null = TOKEN) => {
    const { method, pattern } = splitRouteKey(key);
    const url = pattern.replace(/:([A-Za-z]+)/g, (_match, name: string) => param(name));
    return fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
    });
  };
  return { router, call };
};

const SAMPLE: Readonly<Record<string, string>> = {
  id: 'acme',
  slug: 'checkout',
  vid: 'v3',
  eid: 'e_1',
  scanId: 'sc_abcdefghijklmnop',
  folderId: 'f_k3m9q2x7a1',
  ticket: 'sb_k3m9q2x7a1bc',
  proposalId: 'p_k3m9q2x7',
  undoId: 'su_k3m9q2x7a1bc',
};
const sample = (name: string): string => SAMPLE[name] ?? 'x';

test('the stub files register exactly the 38 Phase 2.5 routes', async (t) => {
  const { router } = await serve(t);
  assert.deepEqual([...router.registered()].sort(), [...P25].sort());
});

test('every Phase 2.5 route refuses a missing or wrong token with 401', async (t) => {
  const { call } = await serve(t);
  for (const key of P25) {
    for (const token of [null, 'wrong-token']) {
      const answer = await call(key, sample, token);
      assert.equal(answer.status, 401, `${key} ${String(token)}`);
      assert.deepEqual(await answer.json(), { error: 'unauthorized', message: 'This request did not carry the service token.' });
    }
  }
});

test('every Phase 2.5 route with a path parameter refuses an encoded separator (traversal) with 400', async (t) => {
  const { call } = await serve(t);
  const withParams = P25.filter((key) => key.includes(':'));
  assert.ok(withParams.length > 0);
  for (const key of withParams) {
    for (const hostile of ['..%2F..%2Fetc', '..%5C..%5Cwindows', 'a%00b']) {
      const answer = await call(key, () => hostile);
      assert.equal(answer.status, 400, `${key} ${hostile}`);
      assert.equal(((await answer.json()) as { error: string }).error, 'bad-path', `${key} ${hostile}`);
    }
  }
});

// Routes a task has built since T0; their own tests cover their answers (folders: test/service/core/folders*.test.ts;
// systems, T1: test/service/systems/systems-routes.test.ts; system versions, T2: test/service/systems/versions.test.ts).
const BUILT: ReadonlySet<RouteKey> = new Set<RouteKey>([
  'GET /systems/:id/versions',
  'GET /systems/:id/versions/:vid/diff',
  'POST /systems/:id/versions/:vid/restore',
  'GET /systems',
  'POST /systems',
  'GET /systems/:id',
  'PATCH /systems/:id',
  'DELETE /systems/:id',
  // T5: test/service/systems/assets-routes.test.ts.
  'POST /systems/:id/assets',
  'POST /systems/:id/assets/from-folder',
  // T6: test/service/systems/board-routes.test.ts.
  'GET /systems/:id/board',
  'GET /systems/:id/board/chunk',
  // T3: test/service/systems/system-edits-routes.test.ts (re-sync stays a stub until T4/T13).
  'POST /systems/:id/edits',
  'POST /systems/:id/edits/:eid/undo',
  'POST /systems/:id/hand-edits/clear',
  // T4: test/service/systems/extract-routes.test.ts.
  'POST /system-scans',
  'GET /system-scans/:scanId',
  'DELETE /system-scans/:scanId',
  // T7: test/service/systems/link-routes.test.ts.
  'GET /designs/:slug/system',
  'GET /designs/:slug/system/preview',
  'POST /designs/:slug/system',
  'GET /folders',
  'POST /folders',
  'PATCH /folders/:folderId',
  'DELETE /folders/:folderId',
  'POST /folders/:folderId/undelete',
  'POST /folders/:folderId/designs',
]);

test('with the token, every stub answers 500 with the not-built sentence and nothing else', async (t) => {
  const { call } = await serve(t);
  for (const key of P25.filter((candidate) => !BUILT.has(candidate))) {
    const answer = await call(key, sample);
    assert.equal(answer.status, 500, key);
    assert.deepEqual(await answer.json(), { error: 'internal', message: SYSTEMS_NOT_BUILT_MESSAGE }, key);
  }
  assert.equal(SYSTEMS_NOT_BUILT_MESSAGE, 'This part of Design Chamber (design systems) is not built yet.');
});
