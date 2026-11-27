// The fake context keeps tests off the user's desktop: with no `downloadsDir` of its own, an export
// lands inside the tmp root, never in the real Downloads; /reveal records the file-manager launch
// instead of spawning it.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';

import type { SystemExportResponse } from '../../src/shared/api.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../src/service/http.ts';
import { isInsideOrEqual } from '../../src/service/paths.ts';
import { registerExportRoutes } from '../../src/service/routes/export.ts';
import { ensureSystemStore } from '../../src/service/systems/store.ts';
import { createFakeContext } from './fake-context.ts';
import { useTmpRoot } from './tmp-root.ts';

const TOKEN = 'fake-context-token-0123456789';

test('the default downloadsDir is inside the tmp root; a test may still name its own', async (t) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const downloads = ctx.settings.read().downloadsDir;
  assert.ok(downloads !== undefined && isInsideOrEqual(tmp.root, downloads), String(downloads));
  const own = createFakeContext({ root: tmp.root, settings: { downloadsDir: '/elsewhere' } });
  t.after(() => own.dispose());
  assert.equal(own.settings.read().downloadsDir, '/elsewhere');
});

test('an export with no downloadsDir set lands in the tmp root, and /reveal records the launch instead of spawning it', async (t) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } } });
  t.after(() => ctx.dispose());
  // Safety before any write: a mutation that drops the default fails here, not in ~/Downloads.
  assert.ok(isInsideOrEqual(tmp.root, ctx.settings.read().downloadsDir ?? '/'), 'the default must be in the tmp root');
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerExportRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (url: string, body: unknown): Promise<{ status: number; json: unknown }> => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: answer.status, json: await answer.json() };
  };
  await ensureSystemStore(ctx).create({ name: 'Acme' });
  await tmp.write('_systems/acme/tokens.css', ':root {\n  --brand-500: #1a73e8;\n}\n');

  const exported = await call('/systems/acme/export', {});
  assert.equal(exported.status, 200, JSON.stringify(exported.json));
  const { path: written } = exported.json as SystemExportResponse;
  assert.ok(isInsideOrEqual(tmp.root, written), written);
  assert.deepEqual(await readdir(path.dirname(written)), ['acme-tokens.zip']);

  const revealed = await call('/reveal', { path: written });
  assert.equal(revealed.status, 200, JSON.stringify(revealed.json));
  assert.ok(ctx.reveals.length >= 1, 'the launch was recorded');
  assert.ok(ctx.reveals.some((step) => step.args.some((arg) => arg.includes('acme-tokens.zip') || arg.includes(path.dirname(written)))), JSON.stringify(ctx.reveals));
});
