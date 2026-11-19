import assert from 'node:assert/strict';
import { test } from 'node:test';

import { API_ERROR_STATUS, isApiErrorCode, RAW_TEXT_ROUTES, ROUTE_KEYS, ROUTE_OWNERS, routePath, splitRouteKey } from '../../src/shared/api.ts';

test('the route table lists every §7 route once, each with an owner lane', () => {
  // 39 routes of Phase 1, minus POST /agent/skill, plus the six of Phase 1.5 and the seven of
  // Phase 2 (documentation/specs/phase-2-technical.md §10.2): 51. Phase 2.5 adds 38
  // (documentation/specs/phase-2-5-technical.md §3: 30 base, 3 for S8, 5 for rev 3): 89.
  assert.equal(ROUTE_KEYS.length, 89);
  assert.equal(new Set(ROUTE_KEYS).size, ROUTE_KEYS.length);
  for (const key of ROUTE_KEYS) {
    const { method, pattern } = splitRouteKey(key);
    assert.match(method, /^(GET|POST|PUT|PATCH|DELETE)$/);
    assert.match(pattern, /^\/[a-z/:-]*$/i, key);
    assert.ok(ROUTE_OWNERS[key]);
  }
  for (const key of RAW_TEXT_ROUTES) assert.ok(ROUTE_KEYS.includes(key));
});

test('Phase 2.5 routes: 38, all owned by P25, each new param named as the spec names it', () => {
  const p25 = ROUTE_KEYS.filter((key) => ROUTE_OWNERS[key] === 'P25');
  assert.equal(p25.length, 38);
  assert.equal(ROUTE_KEYS.length - p25.length, 51, 'no earlier route changed owner');
  const params = new Set(p25.flatMap((key) => splitRouteKey(key).pattern.split('/').filter((part) => part.startsWith(':'))));
  assert.deepEqual([...params].sort(), [':eid', ':folderId', ':id', ':proposalId', ':scanId', ':slug', ':ticket', ':undoId', ':vid']);
  for (const key of ['GET /systems/:id/board/chunk', 'GET /systems/:id/living-page/render/chunk'] as const) {
    assert.ok(RAW_TEXT_ROUTES.has(key), `${key} answers raw text like the design render chunk`);
  }
  // The S8 and rev 3 additions (§3.5).
  for (const key of [
    'POST /systems/chip',
    'GET /system-builds/:ticket',
    'GET /systems/:id/living-page',
    'GET /systems/:id/proposals/:proposalId',
    'GET /systems/:id/living-page/render',
    'GET /systems/:id/living-page/render/chunk',
    'POST /systems/:id/build/stop',
    'POST /system-stops/:undoId/undo',
  ] as const) {
    assert.equal(ROUTE_OWNERS[key], 'P25', key);
  }
});

test('a read-only refusal is a 422 (Phase 2.5 AD-20)', () => {
  assert.equal(API_ERROR_STATUS['read-only'], 422);
  assert.equal(isApiErrorCode('read-only'), true);
});

test('routePath fills and percent-encodes params', () => {
  assert.equal(routePath('GET /designs/:slug', { slug: 'checkout' }), '/designs/checkout');
  assert.equal(routePath('PATCH /designs/:slug/comments/:id', { slug: 'a', id: 'c_1' }), '/designs/a/comments/c_1');
  assert.equal(routePath('GET /designs/:slug', { slug: '../x/y' }), '/designs/..%2Fx%2Fy');
  assert.equal(routePath('GET /health', {}), '/health');
  assert.throws(() => routePath('GET /designs/:slug', { slug: '' }), /Missing path parameter "slug"/);
});

test('error codes map to the §7 statuses', () => {
  assert.equal(API_ERROR_STATUS['bad-slug'], 400);
  assert.equal(API_ERROR_STATUS.stale, 409);
  assert.equal(API_ERROR_STATUS['too-large'], 413);
  assert.equal(API_ERROR_STATUS['no-html'], 422);
  assert.equal(isApiErrorCode('conflict'), true);
  assert.equal(isApiErrorCode('constructor'), false);
});
