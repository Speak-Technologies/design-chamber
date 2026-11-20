// The system hand-edit routes over HTTP (documentation/specs/phase-2-5-technical.md §3.1, §5.3,
// §6.2): the bearer check on every route, the id gate (traversal), body validation with
// sentences, and the flow save → GET /systems/:id (real token values, light and dark) → undo →
// clear, against a real system store and real system history in a temp designs root; a repo-backed
// system refuses the edit, the undo and the ledger clear with the read-only sentence (AD-20).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { CreateSystemResponse, SystemEditResponse } from '../../../src/shared/api.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemEditRoutes } from '../../../src/service/routes/system-edits.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'system-edits-routes-token-0123456789';
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  registerSystemEditRoutes(router, ctx);
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
  return { tmp, ctx, call };
};

test('every system edit route refuses a missing or wrong token with 401 and touches nothing', async (t) => {
  const { tmp, call } = await serve(t);
  const created = (await call('POST', '/systems', { name: 'Acme' })).json as CreateSystemResponse;
  const before = await tmp.read(`_systems/${created.id}/tokens.css`);
  const routes: [string, unknown][] = [
    [`/systems/${created.id}/edits`, { op: 'save', stamps: { tokens: sha(before) }, tokens: [{ kind: 'add', name: '--a', mode: 'light', value: '1px' }] }],
    [`/systems/${created.id}/edits/e_0123456789abcdef0123/undo`, {}],
    [`/systems/${created.id}/hand-edits/clear`, { upTo: 1 }],
    [`/systems/${created.id}/resync`, { scanId: 'x', stamp: 'y' }],
  ];
  for (const [url, body] of routes) {
    for (const token of [null, 'wrong-token']) {
      const answer = await call('POST', url, body, token);
      assert.equal(answer.status, 401, `${url} ${String(token)}`);
    }
  }
  assert.equal(await tmp.read(`_systems/${created.id}/tokens.css`), before);
});

test('a traversal or invalid id is refused before any path is built', async (t) => {
  const { call } = await serve(t);
  const body = { op: 'save', stamps: { tokens: null }, tokens: [{ kind: 'add', name: '--a', mode: 'light', value: '1px' }] };
  for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b']) {
    for (const url of [`/systems/${hostile}/edits`, `/systems/${hostile}/edits/e_0123456789abcdef0123/undo`, `/systems/${hostile}/hand-edits/clear`, `/systems/${hostile}/resync`]) {
      const answer = await call('POST', url, url.endsWith('/edits') ? body : url.endsWith('/clear') ? { upTo: 1 } : url.endsWith('/resync') ? { scanId: 'x', stamp: 'y' } : {});
      assert.equal(answer.status, 400, url);
    }
  }
  for (const bad of ['Acme', '_systems', '.chamber', 'C%3A', '...']) {
    const answer = await call('POST', `/systems/${bad}/edits`, body);
    assert.equal(answer.status, 400, bad);
    assert.equal((answer.json as { error: string }).error, 'bad-slug', bad);
  }
  const gone = await call('POST', '/systems/nobody/edits', body);
  assert.equal(gone.status, 404);
});

test('bodies are validated with a sentence; a bad edit id is 400; a malformed re-sync is 400', async (t) => {
  const { call } = await serve(t);
  const { id } = (await call('POST', '/systems', { name: 'Acme' })).json as CreateSystemResponse;
  for (const body of [undefined, [], { op: 'save' }, { op: 'save', stamps: {}, texts: [{ file: '../x.md', text: 'x' }] }]) {
    const answer = await call('POST', `/systems/${id}/edits`, body);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.equal(typeof (answer.json as { message: string }).message, 'string');
  }
  assert.equal((await call('POST', `/systems/${id}/edits/not-an-id/undo`, {})).status, 400);
  assert.equal((await call('POST', `/systems/${id}/edits/e_0123456789abcdef0123/undo`, { extra: 1 })).status, 400);
  assert.equal((await call('POST', `/systems/${id}/hand-edits/clear`, { upTo: 0 })).status, 400);
  const resync = await call('POST', `/systems/${id}/resync`, { scanId: 'x', stamp: 'y' });
  assert.deepEqual([resync.status, (resync.json as { error: string }).error], [400, 'bad-request']);
});

test('a system whose tokens.css sets real tokens reads through GET /systems/:id (the T1 reader with the T3 rules)', async (t) => {
  const { tmp, call } = await serve(t);
  const { id } = (await call('POST', '/systems', { name: 'Acme' })).json as CreateSystemResponse;
  // As the agent writes it: light, dark, a formula, an !important and a component override.
  await tmp.write(
    `_systems/${id}/tokens.css`,
    ':root {\n  --brand-500: #1a73e8;\n  --space-4: 16px;\n  --radius-2: 8px;\n  --accent: var(--brand-500);\n  --odd: 1px !important;\n}\n.card { --brand-500: red; }\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand-500: #8ab4f8;\n  }\n}\n',
  );
  const answer = await call('GET', `/systems/${id}`);
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  const detail = answer.json as SystemDetail;
  const byName = new Map(detail.tokens.map((token) => [token.name, token]));
  assert.deepEqual(
    [byName.get('--brand-500')?.section, byName.get('--brand-500')?.light?.text, byName.get('--brand-500')?.dark?.text, byName.get('--brand-500')?.alsoSet],
    ['colours', '#1a73e8', '#8ab4f8', ['.card']],
  );
  assert.equal(byName.get('--space-4')?.section, 'spacing');
  assert.equal(byName.get('--radius-2')?.section, 'radius');
  assert.equal(byName.get('--accent')?.light?.editable, 'formula');
  assert.equal(byName.get('--odd')?.light?.editable, 'unreadable');
});

test('the flow: save over HTTP, read it back, undo, clear', async (t) => {
  const { tmp, call } = await serve(t);
  const { id, system } = (await call('POST', '/systems', { name: 'Acme' })).json as CreateSystemResponse;
  const saved = await call('POST', `/systems/${id}/edits`, {
    op: 'save',
    stamps: { tokens: system.stamps.tokens },
    tokens: [
      { kind: 'add', name: '--brand-500', mode: 'light', value: '#1a73e8' },
      { kind: 'add', name: '--brand-500', mode: 'dark', value: '#8ab4f8' },
    ],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const edit = saved.json as SystemEditResponse;
  assert.equal(edit.edit.undoable, true);
  const detail = (await call('GET', `/systems/${id}`)).json as SystemDetail;
  const brand = detail.tokens.find((token) => token.name === '--brand-500');
  assert.deepEqual([brand?.light?.text, brand?.dark?.text], ['#1a73e8', '#8ab4f8']);
  assert.equal(detail.stamps.tokens, edit.stamps.tokens);

  const stale = await call('POST', `/systems/${id}/edits`, { op: 'save', stamps: { tokens: system.stamps.tokens }, tokens: [{ kind: 'remove', name: '--brand-500', mode: 'both' }] });
  assert.deepEqual([stale.status, (stale.json as { message: string }).message], [409, 'Acme changed while you were editing. Nothing was saved.']);

  const undone = await call('POST', `/systems/${id}/edits/${edit.edit.id}/undo`, {});
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  assert.equal(await tmp.read(`_systems/${id}/tokens.css`), ':root {\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n  }\n}\n');
  const cleared = await call('POST', `/systems/${id}/hand-edits/clear`, { upTo: 1 });
  assert.deepEqual([cleared.status, cleared.json], [200, { ok: true }]);
});

test('a repo-backed system refuses an edit, its undo and a ledger clear with 422 read-only, writing nothing', async (t) => {
  const { tmp, ctx, call } = await serve(t);
  const { id, system } = (await call('POST', '/systems', { name: 'Acme' })).json as CreateSystemResponse;
  // A real edit first, so the undo and the clear have something they would otherwise act on.
  const saved = await call('POST', `/systems/${id}/edits`, { op: 'save', stamps: { tokens: system.stamps.tokens }, tokens: [{ kind: 'add', name: '--a', mode: 'light', value: '1px' }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const edit = saved.json as SystemEditResponse;
  const systems = ensureSystemStore(ctx);
  await systems.withLock(id, () =>
    systems.updateStateLocked(id, (state) => ({
      ...state,
      home: { kind: 'repo', directory: path.join(tmp.root, '..', 'shop'), folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: '2026-11-20T09:00:00.000Z' },
    })),
  );
  const files = ['tokens.css', '.chamber/edits.json'];
  const before = await Promise.all(files.map((file) => tmp.read(`_systems/${id}/${file}`)));
  const versionsBefore = await readdir(tmp.at(`_systems/${id}/.versions`)).catch(() => []);
  const sentence = 'Acme lives in shop. Change the values there, or ask the agent here.';
  const attempts: [string, unknown][] = [
    [`/systems/${id}/edits`, { op: 'save', stamps: { tokens: edit.stamps.tokens }, tokens: [{ kind: 'add', name: '--b', mode: 'light', value: '2px' }] }],
    [`/systems/${id}/edits/${edit.edit.id}/undo`, {}],
    [`/systems/${id}/hand-edits/clear`, { upTo: 1 }],
  ];
  for (const [url, body] of attempts) {
    const answer = await call('POST', url, body);
    assert.equal(answer.status, 422, `${url}: ${JSON.stringify(answer.json)}`);
    assert.deepEqual(answer.json, { error: 'read-only', message: sentence }, url);
  }
  assert.deepEqual(await Promise.all(files.map((file) => tmp.read(`_systems/${id}/${file}`))), before);
  assert.deepEqual(await readdir(tmp.at(`_systems/${id}/.versions`)).catch(() => []), versionsBefore);
});
