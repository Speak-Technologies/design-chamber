// Board comment writes and the change feed (documentation/specs/system-builder-depth.md §13 T20): every
// write that lands sends one `system` event with `systemChange: 'comments'`; a refused write or a mark
// with nothing to mark sends none. Nothing drawn changed, so the board and screen documents the
// service cached stay served, and the system's state, review fingerprints and tree are unchanged.

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import type { RenderMeta, SystemCommentResponse } from '../../../src/shared/api.ts';
import type { ChangeEvent } from '../../../src/shared/types.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemBoardRoutes } from '../../../src/service/routes/system-board.ts';
import { registerSystemCommentRoutes } from '../../../src/service/routes/system-comments.ts';
import { registerSystemScreenRoutes } from '../../../src/service/routes/system-screens.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'system-comments-events-token-0123456789';

type Answer = { status: number; text: string };

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemCommentRoutes(router, ctx);
  registerSystemBoardRoutes(router, ctx);
  registerSystemScreenRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown): Promise<Answer> => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, text: await answer.text() };
  };
  const systems = ensureSystemStore(ctx);
  const { id } = await systems.create({ name: 'Acme' });
  await tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --brand-500: #1a73e8;\n}\n');
  await tmp.write(`_systems/${id}/OVERVIEW.md`, 'Acme.\n');
  await tmp.write(`_systems/${id}/system.json`, `${JSON.stringify({ version: 1, screens: [{ id: 'home', title: 'Home', kind: 'page' }] })}\n`);
  await tmp.write(`_systems/${id}/screens/home.html`, '<!doctype html><html><body><h1>HOME</h1></body></html>');
  return { ctx, call, systems, id };
};

/** Board or screen meta, then every chunk: 200 for each while the document is cached. */
const chunksServed = async (call: (method: string, url: string) => Promise<Answer>, base: string, meta: RenderMeta): Promise<boolean> => {
  for (let n = 0; n < meta.chunks; n += 1) {
    if ((await call('GET', `${base}/chunk?key=${meta.key}&n=${n}`)).status !== 200) return false;
  }
  return true;
};

test("every comment write sends one { kind: 'system', systemChange: 'comments' } event; the board and screen caches stay", async (t) => {
  const { ctx, call, systems, id } = await serve(t);
  const boardAnswer = await call('GET', `/systems/${id}/board?scheme=light`);
  assert.equal(boardAnswer.status, 200, boardAnswer.text);
  const board = JSON.parse(boardAnswer.text) as RenderMeta;
  const screenAnswer = await call('GET', `/systems/${id}/screens/render?screen=home&scheme=light`);
  assert.equal(screenAnswer.status, 200, screenAnswer.text);
  const screen = JSON.parse(screenAnswer.text) as RenderMeta;
  const stateBefore = await systems.readState(id);
  const treeBefore = (await systems.get(id)).treeHash;

  const commentEvents = (): Omit<ChangeEvent, 'seq'>[] =>
    ctx.events.filter((event) => event.kind === 'system' && event.systemChange === 'comments').map(({ seq: _seq, ...rest }) => rest);
  const shape = { slug: null, kind: 'system', system: id, systemChange: 'comments', origin: 'user' };

  const { comment } = JSON.parse((await call('POST', `/systems/${id}/comments`, { entry: 'token:--brand-500', body: 'Darker.' })).text) as SystemCommentResponse;
  assert.deepEqual(commentEvents(), [shape], 'create');
  assert.equal((await call('PATCH', `/systems/${id}/comments/${comment.id}`, { body: 'Much darker.' })).status, 200);
  assert.equal(commentEvents().length, 2, 'patch');
  assert.equal((await call('POST', `/systems/${id}/comments/mark-sent`, { ids: [comment.id] })).status, 200);
  assert.equal(commentEvents().length, 3, 'mark-sent');

  // Nothing landed: no event.
  assert.equal((await call('POST', `/systems/${id}/comments/mark-sent`, { ids: [comment.id] })).status, 200);
  assert.equal((await call('POST', `/systems/${id}/comments`, { entry: 'token:--nope', body: 'x' })).status, 400);
  assert.equal((await call('PATCH', `/systems/${id}/comments/c_zzzz9999`, { body: 'x' })).status, 404);
  assert.equal(commentEvents().length, 3, 'a retried mark, a refusal and a miss send nothing');

  assert.equal((await call('DELETE', `/systems/${id}/comments/${comment.id}`)).status, 200);
  assert.deepEqual(commentEvents(), [shape, shape, shape, shape], 'delete; every event the same shape');

  assert.ok(await chunksServed(call, `/systems/${id}/board`, board), 'the board document is still cached');
  assert.ok(await chunksServed(call, `/systems/${id}/screens/render`, screen), 'the screen document is still cached');
  assert.deepEqual(await systems.readState(id), stateBefore, 'state, revision and review fingerprints unchanged');
  assert.equal((await systems.get(id)).treeHash, treeBefore);

  // Control: any other system change still drops them, so the checks above can fail.
  ctx.hub.emit({ slug: null, kind: 'system', system: id, systemChange: 'state' });
  assert.equal(await chunksServed(call, `/systems/${id}/board`, board), false);
  assert.equal(await chunksServed(call, `/systems/${id}/screens/render`, screen), false);
});
