// The composed service (src/service/compose.ts) — the exact wiring main.ts serves: every route
// in the shared route table is registered, every lane module is real (no "not built yet"
// placeholder left), and the WP3 RULES.md hook runs on the real store.

import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { ROUTE_KEYS } from '../../../src/shared/api.ts';
import { composeService, type ComposedService } from '../../../src/service/compose.ts';
import type { Logger } from '../../../src/service/context.ts';
import { createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { livingPageChunk, renderLivingPage } from '../../../src/service/systems/living-page.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { QUIET_AFTER_MS } from '../../../src/shared/limits.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

type LogLine = { level: string; event: string };

type ComposedOptions = {
  /** Written into the designs root before the service starts. */
  designs?: Record<string, { sessionId: string; title: string; html: string }>;
  /** Extra environment (the host callback). */
  env?: Record<string, string>;
};

const useComposed = async (t: TestContext, options: ComposedOptions = {}): Promise<{ service: ComposedService; root: string; logs: LogLine[] }> => {
  const tmp = await useTmpRoot(t);
  const root = tmp.at('designs');
  await mkdir(root, { recursive: true });
  for (const [slug, design] of Object.entries(options.designs ?? {})) {
    const at = '2026-11-27T10:00:00.000Z';
    await mkdir(path.join(root, slug), { recursive: true });
    await writeFile(path.join(root, slug, 'index.html'), design.html, 'utf8');
    await writeFile(path.join(root, slug, 'design.json'), JSON.stringify({ version: 1, kind: 'page', title: design.title, created: at, updated: at, sessionId: design.sessionId }), 'utf8');
  }
  const settingsPath = tmp.at('settings.json');
  await writeFile(settingsPath, `${JSON.stringify({ version: 1, root })}\n`, 'utf8');
  const logs: LogLine[] = [];
  const log: Logger = {
    info: (event) => void logs.push({ level: 'info', event }),
    warn: (event) => void logs.push({ level: 'warn', event }),
    error: (event) => void logs.push({ level: 'error', event }),
  };
  const service = await composeService({
    token: 'compose-test-token',
    log,
    packageRoot: REPO_ROOT,
    version: '0.0.0-test',
    env: { DC_SETTINGS_PATH: settingsPath, ...options.env },
    homeDir: tmp.at('home'),
  });
  t.after(() => service.dispose());
  return { service, root, logs };
};

test('every route in the shared route table is registered on the composed router', async (t) => {
  const { service } = await useComposed(t);
  const registered = service.router.registered();
  const missing = ROUTE_KEYS.filter((key) => !registered.includes(key));
  assert.deepEqual(missing, [], `routes not served: ${missing.join(', ')}`);
  assert.equal(registered.length, ROUTE_KEYS.length, 'nothing registered outside the route table');
});

test('every lane module is the real one, and the RULES.md hook runs on the real store', async (t) => {
  const { service, root, logs } = await useComposed(t);
  const { ctx } = service;
  assert.equal(ctx.settings.root(), root);
  assert.equal(ctx.hub.epoch, ctx.epoch);
  // Placeholders throw "not built yet"; the real modules answer.
  assert.deepEqual(await ctx.store.list(), []);
  assert.equal(ctx.outbox.get(), null);
  assert.match(ctx.uploads.create(10), /^u_/);
  assert.ok(['unavailable', 'pending', 'ready'].includes(ctx.thumbnails.peek('nothing-here').state));
  await assert.rejects(ctx.renders.render('nothing-here', {}), (error: unknown) => (error as { code?: string }).code === 'not-found');

  const record = await ctx.store.create({ kind: 'canvas', title: 'Hook check', brief: '', preset: null, projectDirectory: null });
  await access(path.join(record.path, '.chamber', 'RULES.md'));
  assert.ok(!logs.some((line) => line.event === 'agent.rules-hook-unavailable'), 'the hook registered on the real store');
});

// ---- native extras: sidebar marks and quiet mode (documentation/specs/native-extras.md §4) ----

type MarkCall = { target: { sessionId: string }; mark: { icon: string; tone: string; text: string } | null };

const SERVICE_TOKEN = 'compose-service-token-for-host-calls';

/** Stands in for OpenChamber's service callback: records every `marks.set` that carries the service token. */
const useFakeHost = async (t: TestContext): Promise<{ env: Record<string, string>; marks: MarkCall[] }> => {
  const marks: MarkCall[] = [];
  const bodyOf = async (request: IncomingMessage): Promise<string> => {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    return text;
  };
  const server = createServer((request, response) => {
    void bodyOf(request).then((text) => {
      const call = JSON.parse(text) as { method: string; input: MarkCall };
      if (call.method === 'marks.set' && request.headers.authorization === `Bearer ${SERVICE_TOKEN}`) marks.push(call.input);
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"result":{}}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return { env: { OPENCHAMBER_HOST_CALLBACK_URL: `http://127.0.0.1:${port}`, OPENCHAMBER_SERVICE_TOKEN: SERVICE_TOKEN }, marks };
};

const until = async <T>(read: () => T | undefined, what: string, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('a linked chat gets its mark from the composed service; check errors and unsent comments turn it to warning; dispose ends it', async (t) => {
  const host = await useFakeHost(t);
  const { service } = await useComposed(t, {
    env: host.env,
    designs: {
      pricing: { sessionId: 'ses_pricing', title: 'Pricing', html: '<!doctype html><title>Pricing</title><h1>Plans</h1>' },
      broken: { sessionId: 'ses_broken', title: 'Broken', html: '<!doctype html><title>Broken</title><img src="assets/missing.png" alt="x">' },
    },
  });
  const last = (sessionId: string) => host.marks.filter((call) => call.target.sessionId === sessionId).at(-1)?.mark;

  const neutral = await until(() => last('ses_pricing') ?? undefined, 'the mark on the linked chat');
  assert.deepEqual(neutral, { icon: 'palette', tone: 'neutral', text: 'Pricing' });
  // The real check service is behind it: a missing picture is a check error.
  const warned = await until(() => (last('ses_broken')?.tone === 'warning' ? last('ses_broken') : undefined), 'the warning from a check error');
  assert.match(warned?.text ?? '', /^Broken: \d+ check errors?$/);

  const sentSoFar = host.marks.length;
  await service.ctx.store.addComment('pricing', {
    screen: null,
    viewport: 'laptop',
    anchor: { selector: 'h1', text: 'Plans', html: '<h1>', rect: { x: 1, y: 2, w: 3, h: 4 }, point: { x: 0.5, y: 0.5 } },
    body: 'Bigger',
  });
  // The index has the comment (300 ms), the marks' 2 s debounce has not run out: shutting down now must end it.
  await until(() => (service.ctx.designIndex.get('pricing')?.openComments === 1 ? true : undefined), 'the comment in the index', 1500);
  await service.dispose();
  await pause(3000);
  assert.deepEqual(host.marks.slice(sentSoFar), [], 'no mark is sent after the service is disposed');
});

test('with no host callback the service starts, and says unavailable once however often the marks change', async (t) => {
  const { service, logs } = await useComposed(t, {
    designs: { pricing: { sessionId: 'ses_pricing', title: 'Pricing', html: '<h1>Plans</h1>' } },
  });
  await pause(500);
  await service.ctx.store.patch('pricing', { title: 'Pricing plans' });
  await pause(3000);
  assert.equal(logs.filter((line) => line.event === 'host-calls.unavailable').length, 1);
  assert.deepEqual(logs.filter((line) => line.event.startsWith('session-marks.')), []);
});

test('quiet mode is wired: both render caches are dropped after 10 idle minutes, and GET /changes wakes it', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.now() });
  const { service, root, logs } = await useComposed(t, { designs: { pricing: { sessionId: 'ses_pricing', title: 'Pricing', html: '<h1>Plans</h1>' } } });
  const { ctx } = service;

  const systems = ensureSystemStore(ctx);
  const { id } = await systems.create({ name: 'Acme' });
  await systems.withLock(id, () =>
    systems.updateStateLocked(id, (state) => ({
      ...state,
      home: { kind: 'repo', directory: path.join(root, '..', 'repo'), folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: '2026-11-20T09:00:00.000Z' },
    })),
  );
  await mkdir(path.join(await systems.dir(id), '.chamber'), { recursive: true });
  await writeFile(path.join(await systems.dir(id), '.chamber', 'living-page.html'), '<!doctype html><title>Acme</title><p>living</p>', 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 800)); // the watcher's events for the new system pass first

  const design = await ctx.renders.render('pricing', {});
  const living = await renderLivingPage(ctx, id, { which: 'staged', scheme: 'light' });
  // No await between these and the tick, so nothing but quiet mode can drop the two documents.
  assert.ok(ctx.renders.chunk(design.key, 0).includes('Plans'));
  assert.ok(livingPageChunk(ctx, id, living.key, 0).includes('living'));
  t.mock.timers.tick(QUIET_AFTER_MS);
  assert.throws(() => ctx.renders.chunk(design.key, 0), { code: 'stale' });
  assert.throws(() => livingPageChunk(ctx, id, living.key, 0), { code: 'stale' });
  assert.equal(logs.filter((line) => line.event === 'pace.quiet').length, 1);

  const server = createServiceServer(service.router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const answer = await fetch(`http://127.0.0.1:${port}/changes?since=0&epoch=`, { headers: { authorization: 'Bearer compose-test-token' } });
  assert.equal(answer.status, 200);
  assert.equal(logs.filter((line) => line.event === 'pace.active').length, 1);
});
