// Every route that takes a design system id (or a second id after it) refuses a value off its pattern
// with 400 before any path is built (documentation/specs/phase-2-5-technical.md §11). The router's own
// separator check (`/`, `\`, NUL) refuses traversal first, so these values carry none: an encoded drive
// colon (`C%3A` → `C:`), upper case, a reserved or dot name, a leading hyphen, one character too long.
// Loosening SYSTEM_ID_PATTERN (or any second-id pattern) turns these red: a loosened id would reach the
// store and come back 404 (or a body error), never 400 bad-slug.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemAssetRoutes } from '../../../src/service/routes/system-assets.ts';
import { registerSystemBoardRoutes } from '../../../src/service/routes/system-board.ts';
import { registerSystemBuildRoutes } from '../../../src/service/routes/system-build.ts';
import { registerSystemChatRoutes } from '../../../src/service/routes/system-chat.ts';
import { registerSystemChecksRoutes } from '../../../src/service/routes/system-checks.ts';
import { registerSystemEditRoutes } from '../../../src/service/routes/system-edits.ts';
import { registerSystemScanRoutes } from '../../../src/service/routes/system-scans.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { registerSystemVersionsRoutes } from '../../../src/service/routes/system-versions.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'system-id-refusal-token-0123456789ab';

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t, 'dc-id-refusal-');
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  registerSystemBoardRoutes(router, ctx);
  registerSystemBuildRoutes(router, ctx);
  registerSystemEditRoutes(router, ctx);
  registerSystemScanRoutes(router, ctx);
  registerSystemAssetRoutes(router, ctx);
  registerSystemChatRoutes(router, ctx);
  registerSystemChecksRoutes(router, ctx);
  registerSystemVersionsRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown) => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, json: (await answer.json()) as { error?: string } };
  };
  return { tmp, ctx, call };
};

/** Off-pattern system ids with no separator in them, so only the route's own id check can refuse them. */
const BAD_SYSTEM_IDS = ['C%3A', 'Acme', '_systems', '.chamber', '...', '-acme', 'a'.repeat(64), 'acme%3Ax', 'acme.'];

/** Every route with a system id, `{id}` where it goes, with a body it would otherwise accept. */
const SYSTEM_ROUTES: [method: string, url: string, body?: unknown][] = [
  ['GET', '/systems/{id}'],
  ['PATCH', '/systems/{id}', { name: 'Beacon' }],
  ['DELETE', '/systems/{id}'],
  ['GET', '/systems/{id}/living-page'],
  ['GET', '/systems/{id}/board?scheme=light'],
  ['GET', '/systems/{id}/board/chunk?scheme=light&index=0'],
  ['POST', '/systems/{id}/build/stop', { proposalId: null }],
  ['GET', '/systems/{id}/proposals/p_k3m9q2x7'],
  ['GET', '/systems/{id}/living-page/render?which=preview&scheme=light'],
  ['GET', '/systems/{id}/living-page/render/chunk?which=preview&scheme=light&index=0'],
  ['POST', '/systems/{id}/edits', { kind: 'note', text: 'x' }],
  ['POST', '/systems/{id}/edits/e_k3m9q2x7/undo', {}],
  ['POST', '/systems/{id}/hand-edits/clear', {}],
  ['POST', '/systems/{id}/resync', { scanId: 'sc_k3m9q2x7k3m9q2x7k3m9q2x7', stamp: 'none' }],
  ['POST', '/systems/{id}/assets', { uploadId: 'u_k3m9q2x7', name: 'a.svg', kind: 'logo' }],
  ['POST', '/systems/{id}/assets/from-folder', { directory: '/tmp/x' }],
  ['POST', '/systems/{id}/prompt', { purpose: 'reconcile' }],
  ['GET', '/systems/{id}/checks'],
  ['GET', '/systems/{id}/versions'],
  ['GET', '/systems/{id}/versions/v1/diff'],
  ['POST', '/systems/{id}/versions/v1/restore', {}],
];

test('every system-id route refuses an encoded drive colon and a wrongly shaped id with 400 bad-slug, writing nothing', async (t) => {
  const { tmp, call } = await serve(t);
  for (const [method, template, body] of SYSTEM_ROUTES) {
    for (const bad of BAD_SYSTEM_IDS) {
      const url = template.replace('{id}', bad);
      const answer = await call(method, url, body);
      assert.equal(answer.status, 400, `${method} ${url}: ${JSON.stringify(answer.json)}`);
      assert.equal(answer.json.error, 'bad-slug', `${method} ${url}`);
    }
  }
  assert.deepEqual(await readdir(tmp.root), []);
});

/** Second ids after a real system: the edit, the proposal, the version, and the stop's undo id. */
const SECOND_ID_ROUTES: [method: string, template: string, bad: string[], body?: unknown][] = [
  ['POST', '/systems/acme/edits/{x}/undo', ['C%3A', 'E_K3M9Q2X7', 'e_short', 'e_k3m9q2x7%3A', 'e_', `e_${'a'.repeat(25)}`], {}],
  ['GET', '/systems/acme/proposals/{x}', ['C%3A', 'P_K3M9Q2X7', 'p_short', 'p_k3m9q2x7%3A', `p_${'a'.repeat(17)}`]],
  ['GET', '/systems/acme/versions/{x}/diff', ['C%3A', 'V1', 'v0', 'v1a', 'v01', `v${'1'.repeat(10)}`]],
  ['POST', '/systems/acme/versions/{x}/restore', ['C%3A', 'V1', 'v0', 'v1a', 'v01', `v${'1'.repeat(10)}`], {}],
  ['POST', '/system-stops/{x}/undo', ['C%3A', 'SU_K3M9Q2X7A1BC', 'su_short', 'su_k3m9q2x7a1bc%3A', 'su_k3m9q2x7a1bcd'], {}],
];

test('a second id off its pattern is refused with 400 on a system that exists, writing nothing new', async (t) => {
  const { tmp, ctx, call } = await serve(t);
  await ensureSystemStore(ctx).create({ name: 'Acme' });
  const before = await readdir(tmp.at('_systems/acme'));
  for (const [method, template, bads, body] of SECOND_ID_ROUTES) {
    for (const bad of bads) {
      const url = template.replace('{x}', bad);
      const answer = await call(method, url, body);
      assert.equal(answer.status, 400, `${method} ${url}: ${JSON.stringify(answer.json)}`);
      assert.equal(answer.json.error, 'bad-request', `${method} ${url}`);
    }
  }
  assert.deepEqual(await readdir(tmp.at('_systems/acme')), before);
});
