// PUT /view on the real service process, called the way the host proxy calls it (use-the-project
// spec §2.4, T6): bearer, body shape and caps, the slug's containment, the screen and viewport the
// design must have, then what lands in view.json beside settings.json. The write rate (a held
// changed report, an unchanged one that only moves `at`) runs in-process on a fake clock.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { ApiErrorBody, OkResponse } from '../../../src/shared/api.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerViewRoutes } from '../../../src/service/routes/view.ts';
import { VIEW_AT_REFRESH_MS, VIEW_FILE, VIEW_SELECTION_TEXT_MAX, VIEW_SELECTOR_MAX, VIEW_WRITE_MIN_GAP_MS, type ViewFile } from '../../../src/shared/view.ts';
import { createCore } from '../core/harness.ts';
import { useServiceProcess, type RunningService } from '../../helpers/service-process.ts';

type Rig = { service: RunningService; dir: string; root: string; outside: string; viewFile: string };

const start = async (t: TestContext): Promise<Rig> => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dc-view-route-')));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));
  const root = path.join(dir, 'designs');
  const outside = path.join(dir, 'outside');
  await mkdir(path.join(root, 'demo', 'screens'), { recursive: true });
  await mkdir(path.join(root, 'checklist'), { recursive: true });
  await mkdir(path.join(outside, 'sneaky'), { recursive: true });
  await writeFile(
    path.join(root, 'demo', 'design.json'),
    JSON.stringify({
      version: 1,
      kind: 'canvas',
      title: 'Demo board',
      viewports: [{ id: 'laptop', name: 'Laptop', width: 1280, height: 800 }],
      screens: [{ id: 'home', title: 'Home' }, { id: 'pricing', title: 'Pricing' }],
    }),
  );
  await writeFile(path.join(root, 'checklist', 'design.json'), JSON.stringify({ version: 1, kind: 'page', title: 'Checklist' }));
  await writeFile(path.join(root, 'checklist', 'index.html'), '<p>Checklist</p>');
  await writeFile(path.join(outside, 'sneaky', 'design.json'), JSON.stringify({ version: 1, kind: 'page', title: 'Not yours' }));
  const settings = path.join(dir, 'settings.json');
  await writeFile(settings, JSON.stringify({ version: 1, root, downloadsDir: path.join(dir, 'downloads') }));
  const service = await useServiceProcess(t, { DC_SETTINGS_PATH: settings });
  return { service, dir, root, outside, viewFile: path.join(dir, VIEW_FILE) };
};

const errorOf = async (response: Response): Promise<ApiErrorBody> => (await response.json()) as ApiErrorBody;
const put = (service: RunningService, body: unknown, token?: string | null): Promise<Response> => service.request('/view', { method: 'PUT', body, ...(token !== undefined ? { token } : {}) });
const viewOf = async (file: string): Promise<ViewFile | null> => {
  const text = await readFile(file, 'utf8').catch(() => null);
  return text === null ? null : (JSON.parse(text) as ViewFile);
};
const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

const waitFor = async (check: () => Promise<boolean>): Promise<void> => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('the held report was never written');
};

const GOOD = { surface: 'page', slug: 'demo', screen: 'home', viewport: 'laptop', mode: 'edit', selection: { selector: 'main > h1', text: 'Ship faster' } };

describe('PUT /view: refusals before anything is written', () => {
  test('a missing or wrong token is 401 and nothing is written', async (t) => {
    const { service, viewFile } = await start(t);
    for (const token of [null, 'wrong', ''] as const) {
      const answer = await put(service, GOOD, token);
      assert.equal(answer.status, 401, `token=${String(token)}`);
      assert.equal((await errorOf(answer)).error, 'unauthorized');
    }
    assert.equal(await exists(viewFile), false);
  });

  test('a bad shape is 400 bad-request and nothing is written', async (t) => {
    const { service, viewFile } = await start(t);
    const bad: [string, unknown][] = [
      ['no body', undefined],
      ['an array', []],
      ['a string', 'demo'],
      ['no surface', { slug: 'demo' }],
      ['an unknown surface', { surface: 'tab', slug: 'demo' }],
      ['no slug', { surface: 'rail' }],
      ['a numeric slug', { surface: 'rail', slug: 7 }],
      ['a numeric screen', { surface: 'rail', slug: 'demo', screen: 3 }],
      ['a numeric viewport', { surface: 'rail', slug: 'demo', viewport: 3 }],
      ['an unknown mode', { surface: 'rail', slug: 'demo', mode: 'draw' }],
      ['file content riding in', { surface: 'rail', slug: 'demo', html: '<h1>secret</h1>' }],
      ['a selection that is a string', { surface: 'rail', slug: 'demo', selection: 'h1' }],
      ['a selection with no selector', { surface: 'rail', slug: 'demo', selection: { text: 'x' } }],
      ['a blank selector', { surface: 'rail', slug: 'demo', selection: { selector: ' \n ', text: 'x' } }],
      ['a selection with a third field', { surface: 'rail', slug: 'demo', selection: { selector: 'h1', text: 'x', html: '<h1>' } }],
      ['a selector over the cap', { surface: 'rail', slug: 'demo', selection: { selector: 'a'.repeat(VIEW_SELECTOR_MAX + 1), text: 'x' } }],
      ['a selection text over the cap', { surface: 'rail', slug: 'demo', selection: { selector: 'h1', text: 'a'.repeat(VIEW_SELECTION_TEXT_MAX + 1) } }],
      ['a screen with no design open', { surface: 'rail', slug: null, screen: 'home' }],
      ['a selection with no design open', { surface: 'rail', slug: null, selection: { selector: 'h1', text: '' } }],
    ];
    for (const [name, body] of bad) {
      const answer = await put(service, body);
      assert.equal(answer.status, 400, name);
      assert.equal((await errorOf(answer)).error, 'bad-request', name);
    }
    assert.equal(await exists(viewFile), false);
  });

  test('a body over the service cap is 413 and nothing is written', async (t) => {
    const { service, viewFile } = await start(t);
    const answer = await put(service, { ...GOOD, selection: { selector: 'h1', text: 'x'.repeat(90_000) } });
    assert.equal(answer.status, 413);
    assert.equal(await exists(viewFile), false);
  });

  test('a traversal in the slug is refused and nothing is written', async (t) => {
    const { service, viewFile, outside } = await start(t);
    const slugs = ['../outside/sneaky', '..', '.', '../', '/etc', '/etc/passwd', 'demo/../checklist', 'demo/screens', 'a\\b', '..\\outside', 'C:\\Windows', 'C:/Windows', '%2e%2e%2foutside', '..%2foutside', ' demo', 'DEMO', '.chamber', '.trash', '', 'x'.repeat(200), 'demo\0'];
    for (const slug of slugs) {
      const answer = await put(service, { surface: 'rail', slug });
      assert.equal(answer.status, 400, JSON.stringify(slug));
      assert.equal((await errorOf(answer)).error, 'bad-slug', JSON.stringify(slug));
    }
    assert.equal(await exists(viewFile), false);
    assert.deepEqual(await readdir(path.join(outside, 'sneaky')), ['design.json']);
  });

  test('a design folder that is a link out of the root is refused and nothing is written', async (t) => {
    const { service, viewFile, root, outside } = await start(t);
    try {
      await symlink(path.join(outside, 'sneaky'), path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`symlinks unavailable on this platform/account: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const answer = await put(service, { surface: 'rail', slug: 'escape' });
    assert.ok(answer.status === 400 || answer.status === 404, `status ${answer.status}`);
    assert.equal(await exists(viewFile), false);
  });

  test('an unknown design is 404 and nothing is written', async (t) => {
    const { service, viewFile } = await start(t);
    const answer = await put(service, { surface: 'page', slug: 'no-such-design' });
    assert.equal(answer.status, 404);
    assert.equal((await errorOf(answer)).error, 'not-found');
    assert.equal(await exists(viewFile), false);
  });

  test('a screen or viewport the design lacks is 400 and nothing is written', async (t) => {
    const { service, viewFile } = await start(t);
    for (const body of [
      { surface: 'page', slug: 'demo', screen: 'checkout' },
      { surface: 'page', slug: 'demo', viewport: 'watch' },
      // A page has no screens at all.
      { surface: 'page', slug: 'checklist', screen: 'home' },
    ]) {
      const answer = await put(service, body);
      assert.equal(answer.status, 400, JSON.stringify(body));
      assert.equal((await errorOf(answer)).error, 'bad-request');
    }
    assert.equal(await exists(viewFile), false);
  });
});

describe('PUT /view: what is written', () => {
  test('a good report round-trips into view.json beside settings.json, outside the designs root', async (t) => {
    const { service, dir, root, viewFile } = await start(t);
    const answer = await put(service, { ...GOOD, selection: { selector: 'main\n > h1', text: '  Ship\tfaster\n today ' } });
    assert.equal(answer.status, 200);
    assert.deepEqual((await answer.json()) as OkResponse, { ok: true });
    const view = await viewOf(viewFile);
    assert.ok(view);
    const { at, ...rest } = view;
    assert.deepEqual(rest, {
      v: 1,
      surface: 'page',
      slug: 'demo',
      title: 'Demo board',
      screen: 'home',
      viewport: 'laptop',
      mode: 'edit',
      selection: { selector: 'main > h1', text: 'Ship faster today' },
    });
    assert.ok(Math.abs(Date.now() - Date.parse(at)) < 60_000, `at is now: ${at}`);
    // Beside settings.json, never in the designs root, and no temp file left behind.
    const names = await readdir(dir);
    assert.ok(names.includes(VIEW_FILE));
    assert.deepEqual(names.filter((name) => name.startsWith('.')), [], 'no temp file left behind');
    assert.equal(await exists(path.join(root, VIEW_FILE)), false);
  });

  test('the full-width view, a page and the list are all reportable', async (t) => {
    const { service, viewFile } = await start(t);
    assert.equal((await put(service, { surface: 'page', slug: 'checklist', viewport: 'fill', mode: 'play' })).status, 200);
    assert.deepEqual(
      { ...(await viewOf(viewFile)), at: '' },
      { v: 1, at: '', surface: 'page', slug: 'checklist', title: 'Checklist', screen: null, viewport: 'fill', mode: 'play', selection: null },
    );
    // Straight after a write, a changed report is held for a moment (the write rate); wait for it.
    assert.equal((await put(service, { surface: 'rail', slug: null })).status, 200);
    await waitFor(async () => (await viewOf(viewFile))?.slug === null);
    assert.deepEqual(
      { ...(await viewOf(viewFile)), at: '' },
      { v: 1, at: '', surface: 'rail', slug: null, title: null, screen: null, viewport: null, mode: null, selection: null },
    );
  });

  test('the file holds no field a report did not name', async (t) => {
    const { service, viewFile } = await start(t);
    await put(service, GOOD);
    assert.deepEqual(Object.keys((await viewOf(viewFile)) ?? {}).sort(), ['at', 'mode', 'screen', 'selection', 'slug', 'surface', 'title', 'v', 'viewport']);
  });
});

describe('PUT /view: the write rate, on a fake clock', () => {
  type Served = { request: (body: unknown) => Promise<Response>; viewFile: string; clock: { now: number }; designs: string };

  const serve = async (t: TestContext): Promise<Served> => {
    const core = await createCore(t);
    t.after(() => core.stop());
    await mkdir(path.join(core.root, 'demo'), { recursive: true });
    await writeFile(
      path.join(core.root, 'demo', 'design.json'),
      JSON.stringify({ version: 1, kind: 'canvas', title: 'Demo board', screens: [{ id: 'home', title: 'Home' }, { id: 'pricing', title: 'Pricing' }] }),
    );
    const viewFile = path.join(core.tmp.at('app-data'), VIEW_FILE);
    const clock = { now: Date.UTC(2026, 10, 27, 12, 0, 0) };
    const router = createRouter({ token: 'view-test-token', log: core.ctx.log });
    registerViewRoutes(router, core.ctx, { file: viewFile, now: () => clock.now });
    const server = createServiceServer(router);
    await listenLoopback(server, 0);
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const { port } = server.address() as AddressInfo;
    const request = (body: unknown): Promise<Response> =>
      fetch(`http://127.0.0.1:${port}/view`, { method: 'PUT', headers: { authorization: 'Bearer view-test-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { request, viewFile, clock, designs: core.root };
  };

  const report = (screen: string) => ({ surface: 'rail', slug: 'demo', screen, viewport: null, mode: 'edit', selection: null });
  test('an unchanged report moves only `at`, and not more often than every few seconds', async (t) => {
    const { request, viewFile, clock } = await serve(t);
    assert.equal((await request(report('home'))).status, 200);
    const first = await viewOf(viewFile);
    assert.ok(first);

    // Too soon: skipped, the file is untouched.
    clock.now += VIEW_AT_REFRESH_MS - 1000;
    assert.equal((await request(report('home'))).status, 200);
    assert.deepEqual(await viewOf(viewFile), first);

    // Past the refresh gap: rewritten, and only `at` differs.
    clock.now += 1000;
    assert.equal((await request(report('home'))).status, 200);
    const second = await viewOf(viewFile);
    assert.ok(second);
    assert.notEqual(second.at, first.at);
    assert.equal(Date.parse(second.at) - Date.parse(first.at), VIEW_AT_REFRESH_MS);
    assert.deepEqual({ ...second, at: '' }, { ...first, at: '' });
  });

  test('the file is replaced by a rename, never rewritten in place', { skip: process.platform === 'win32' ? 'inode numbers are not stable on Windows' : false }, async (t) => {
    const { request, viewFile, clock } = await serve(t);
    assert.equal((await request(report('home'))).status, 200);
    const before = (await stat(viewFile)).ino;
    clock.now += VIEW_AT_REFRESH_MS;
    assert.equal((await request(report('home'))).status, 200);
    assert.notEqual((await stat(viewFile)).ino, before);
  });

  test('a changed report inside the minimum gap is held, then written, and the newest wins', async (t) => {
    const { request, viewFile, clock } = await serve(t);
    assert.equal((await request(report('home'))).status, 200);

    clock.now += 10;
    assert.equal((await request(report('pricing'))).status, 200);
    // Held: the file still says the first report right after the answer.
    assert.equal((await viewOf(viewFile))?.screen, 'home');

    // A third, still inside the gap, replaces the held one.
    clock.now += 10;
    assert.equal((await request({ ...report('home'), mode: 'play' })).status, 200);

    await waitFor(async () => (await viewOf(viewFile))?.mode === 'play');
    assert.equal((await viewOf(viewFile))?.screen, 'home');
  });

  test('a changed report after the gap is written before the answer', async (t) => {
    const { request, viewFile, clock } = await serve(t);
    assert.equal((await request(report('home'))).status, 200);
    clock.now += VIEW_WRITE_MIN_GAP_MS;
    assert.equal((await request(report('pricing'))).status, 200);
    assert.equal((await viewOf(viewFile))?.screen, 'pricing');
  });
});
