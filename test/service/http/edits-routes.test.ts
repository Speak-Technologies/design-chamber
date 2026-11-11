// The four hand-edit routes on the real service process, called the way the host proxy calls
// them (Phase 2 technical design §2.2, §17 "Route rejections"): bearer, slug, edit id, body
// bounds and the user's sentences, before any op runs. The op modules are stubs until T3 to T5,
// so a well-formed edit answers "not built yet" and nothing is written.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { ApiErrorBody, SourceResponse } from '../../../src/shared/api.ts';
import { useServiceProcess, type RunningService } from '../../helpers/service-process.ts';

const GONE = 'That design is no longer in your Designs folder.';
const NOT_BUILT = 'This part of Design Chamber (edits) is not built yet.';
const SHA = 'a'.repeat(64);

type Rig = { service: RunningService; root: string; outside: string };

const start = async (t: TestContext): Promise<Rig> => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dc-edits-routes-')));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));
  const root = path.join(dir, 'designs');
  const outside = path.join(dir, 'outside');
  await mkdir(path.join(root, 'demo', 'screens'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(
    path.join(root, 'demo', 'design.json'),
    JSON.stringify({ version: 1, kind: 'canvas', title: 'Demo', screens: [{ id: 'home', title: 'Home' }, { id: 'pricing', title: 'Pricing' }, { id: 'about', title: 'About' }] }),
  );
  await writeFile(path.join(root, 'demo', 'screens', 'pricing.html'), '<h1>Pricing</h1>');
  const settings = path.join(dir, 'settings.json');
  await writeFile(settings, JSON.stringify({ version: 1, root, downloadsDir: path.join(dir, 'downloads') }));
  const service = await useServiceProcess(t, { DC_SETTINGS_PATH: settings });
  return { service, root, outside };
};

const errorOf = async (response: Response): Promise<ApiErrorBody> => (await response.json()) as ApiErrorBody;

const textEdit = (screen: unknown = 'pricing') => ({
  op: 'text',
  screen,
  base: SHA,
  target: { tag: 'h1', id: null, text: 'Pricing', sameIndex: 0, sameCount: 1 },
  before: 'Pricing',
  after: 'Plans',
});

const calls: [string, { method?: string; body?: unknown }][] = [
  ['/designs/demo/edits', { method: 'POST', body: textEdit() }],
  ['/designs/demo/edits/e_abcdefgh1234/undo', { method: 'POST', body: {} }],
  ['/designs/demo/tokens', {}],
  ['/designs/demo/hand-edits/clear', { method: 'POST', body: { upTo: 1 } }],
];

describe('hand-edit routes on the real service', () => {
  test('bearer, slug pattern, gone design and body cap come first on every route', async (t) => {
    const { service } = await start(t);
    for (const [pathname, init] of calls) {
      for (const token of [null, 'wrong'] as const) {
        const answer = await service.request(pathname, { ...init, token });
        assert.equal(answer.status, 401, `${pathname} token=${String(token)}`);
      }
      const bad = await service.request(pathname.replace('/demo/', '/BAD%20SLUG/'), init);
      assert.equal(bad.status, 400, pathname);
      assert.equal((await errorOf(bad)).error, 'bad-slug');
      const gone = await service.request(pathname.replace('/demo/', '/no-such-design/'), init);
      assert.equal(gone.status, 404, pathname);
      assert.deepEqual(await errorOf(gone), { error: 'not-found', message: GONE });
    }
    for (const [pathname] of calls.filter(([, init]) => init.method === 'POST')) {
      const answer = await service.request(pathname, { method: 'POST', body: { op: 'text', filler: 'x'.repeat(81_000) } });
      assert.equal(answer.status, 413, pathname);
      assert.equal((await errorOf(answer)).error, 'too-large');
    }
    assert.doesNotMatch(service.output(), new RegExp(service.token), 'the token never reaches the log');
  });

  test('a malformed edit, a path in a screen id, a bad edit id or undo body, and a bad clear are 400', async (t) => {
    const { service } = await start(t);
    for (const body of [{ op: 'unknown' }, textEdit('../x'), textEdit('..\\x'), textEdit('/etc/passwd'), { ...textEdit(), base: 'not-a-hash' }, 'just text']) {
      const answer = await service.request('/designs/demo/edits', { method: 'POST', body });
      assert.equal(answer.status, 400, JSON.stringify(body));
      assert.equal((await errorOf(answer)).error, 'bad-request');
    }
    const badId = await service.request('/designs/demo/edits/not-an-id/undo', { method: 'POST', body: {} });
    assert.equal(badId.status, 400);
    const badUndo = await service.request('/designs/demo/edits/e_abcdefgh1234/undo', { method: 'POST', body: { force: true } });
    assert.equal(badUndo.status, 400);
    for (const body of [{}, { upTo: 0 }, { upTo: 1.5 }, { upTo: '1' }, { upTo: 1 }]) {
      const answer = await service.request('/designs/demo/hand-edits/clear', { method: 'POST', body });
      assert.equal(answer.status, 400, JSON.stringify(body));
    }
  });

  test('the op stubs and the tokens reader answer "not built yet"; an unknown undo id is 404; nothing is written', async (t) => {
    const { service, root } = await start(t);
    const edit = await service.request('/designs/demo/edits', { method: 'POST', body: textEdit() });
    assert.equal(edit.status, 500);
    assert.deepEqual(await errorOf(edit), { error: 'internal', message: NOT_BUILT });
    const tokens = await service.request('/designs/demo/tokens');
    assert.equal(tokens.status, 500);
    assert.equal((await errorOf(tokens)).message, NOT_BUILT);
    const undo = await service.request('/designs/demo/edits/e_abcdefgh1234/undo', { method: 'POST', body: {} });
    assert.equal(undo.status, 404);
    assert.deepEqual(await errorOf(undo), { error: 'not-found', message: "This edit can't be undone any more." });
    assert.equal(await readFile(path.join(root, 'demo', 'screens', 'pricing.html'), 'utf8'), '<h1>Pricing</h1>');
  });

  test('GET /source reports a screen file that is a link inside the design, or under a linked folder, as link: true', async (t) => {
    const { service, root, outside } = await start(t);
    const design = path.join(root, 'demo');
    await symlink(path.join(design, 'screens', 'pricing.html'), path.join(design, 'screens', 'home.html'));
    const inside = (await (await service.request('/designs/demo/source', { query: { screen: 'home' } })).json()) as SourceResponse;
    assert.equal(inside.link, true, 'judged on the lexical path: the realpath is a regular file inside the design');
    assert.equal(inside.utf8, true);
    const plain = (await (await service.request('/designs/demo/source', { query: { screen: 'pricing' } })).json()) as SourceResponse;
    assert.equal(plain.link, false);

    // A link out of the design is refused outright: its bytes are never served.
    await writeFile(path.join(outside, 'secret.html'), '<h1>outside</h1>');
    await symlink(path.join(outside, 'secret.html'), path.join(design, 'screens', 'about.html'));
    const out = await service.request('/designs/demo/source', { query: { screen: 'about' } });
    assert.notEqual(out.status, 200);
    assert.doesNotMatch(await out.text(), /outside/);

    // A `screens` folder that is a link to another folder inside the design.
    await rm(path.join(design, 'screens'), { recursive: true });
    await mkdir(path.join(design, 'pages'));
    await writeFile(path.join(design, 'pages', 'pricing.html'), '<h1>Pricing</h1>');
    await symlink(path.join(design, 'pages'), path.join(design, 'screens'), 'junction');
    const folder = (await (await service.request('/designs/demo/source', { query: { screen: 'pricing' } })).json()) as SourceResponse;
    assert.equal(folder.link, true);
  });
});
