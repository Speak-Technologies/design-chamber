// System screens over HTTP (documentation/specs/system-builder-depth.md §4.6, §10, §13 T12a): the bearer
// check on both routes, the id gate (traversal), the `screen` query refused before any read, a listed
// screen only, links never followed, the character cap, a real render (bundled from the system's files
// with the bridge placeholder, a reference out of the folder blocked), chunks bound to their system and
// kind, the cache dropped on a `system` event, the scheme keying the render, and a version's own tree.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import { ROUTE_KEYS, ROUTE_OWNERS, type RenderMeta } from '../../../src/shared/api.ts';
import { BRIDGE_PLACEHOLDER } from '../../../src/shared/bridge-protocol.ts';
import { RENDER_CHUNK_MAX_BYTES, SYSTEM_EXAMPLE_MAX, SYSTEM_SCREEN_MAX, SYSTEM_SCREENS_MAX } from '../../../src/shared/limits.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemBoardRoutes } from '../../../src/service/routes/system-board.ts';
import { registerSystemScreenRoutes } from '../../../src/service/routes/system-screens.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { SCREEN_NOT_LISTED_MESSAGE, SCREEN_STALE_MESSAGE } from '../../../src/service/systems/board.ts';
import { readRepoSystem } from '../../../src/service/systems/repo-read.ts';
import { ensureSystemStore } from '../../../src/service/systems/store.ts';
import { ensureSystemVersions } from '../../../src/service/systems/versions.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { setupRepo } from './repo-fixture.ts';

const TOKEN = 'system-screens-token-0123456789';
const SBD = ROUTE_KEYS.filter((key) => ROUTE_OWNERS[key] === 'SBD');
const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'latin1'), randomBytes(64)]);
const ZERO_KEY = '0'.repeat(64);

const TOKENS_CSS = ':root {\n  --brand: #1a73e8;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --brand: #8ab4f8; }\n}\n';

const HOME =
  '<!doctype html><html><head><link rel="stylesheet" href="../tokens.css">' +
  '<style>@font-face { font-family: Inter; src: url("../assets/fonts/inter.woff2"); }</style></head>' +
  '<body><h1 style="color: var(--brand)">HOME-SCREEN</h1>' +
  '<img src="https://remote.test/hero.png" alt="">' +
  '<link rel="stylesheet" href="../../other/tokens.css"></body></html>';

const SYSTEM_JSON = {
  screens: [
    { id: 'home', title: 'Home page', kind: 'page' },
    { id: 'og-card', title: 'Social card', kind: 'marketing', viewports: [{ id: 'og', label: 'Open Graph', width: 1200, height: 630 }] },
    { id: 'gone', title: 'Not written yet', kind: 'state' },
  ],
};

type Answer = { status: number; text: string };

const serve = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const ctx = createFakeContext({
    root: tmp.root,
    overrides: { designIndex: { all: () => [], get: () => null, bySession: () => [], ready: async () => true, dispose: async () => undefined } },
  });
  t.after(() => ctx.dispose());
  const router = createRouter({ token: TOKEN, log: ctx.log });
  registerSystemsRoutes(router, ctx);
  registerSystemBoardRoutes(router, ctx);
  registerSystemScreenRoutes(router, ctx);
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as AddressInfo;
  assert.equal(address.address, '127.0.0.1');
  const call = async (method: string, url: string, body?: unknown, token: string | null = TOKEN): Promise<Answer> => {
    const answer = await fetch(`http://127.0.0.1:${address.port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, text: await answer.text() };
  };
  for (const name of ['Acme', 'Other']) assert.equal((await call('POST', '/systems', { name, brand: true })).status, 200);
  const write = (rel: string, content: string | Uint8Array, system = 'acme'): Promise<string> => tmp.write(`_systems/${system}/${rel}`, content);
  const writeJson = (value: unknown, system = 'acme'): Promise<string> => write('system.json', `${JSON.stringify(value)}\n`, system);
  await write('tokens.css', TOKENS_CSS);
  await writeJson(SYSTEM_JSON);
  await write('assets/fonts/inter.woff2', WOFF2);
  await write('screens/home.html', HOME);
  await write('screens/og-card.html', '<!doctype html><html><body><p>OG-CARD</p></body></html>');
  // Something the screen points at outside the system folder, which must never be inlined.
  await tmp.write('_systems/other/tokens.css', ':root { --leak: OTHER-SYSTEM-SECRET; }');

  /** The whole screen: meta, then every chunk through the screens chunk route. */
  const screen = async (query: string, system = 'acme'): Promise<{ meta: RenderMeta; html: string }> => {
    const answer = await call('GET', `/systems/${system}/screens/render?${query}`);
    assert.equal(answer.status, 200, answer.text);
    const meta = JSON.parse(answer.text) as RenderMeta;
    let html = '';
    for (let n = 0; n < meta.chunks; n += 1) {
      const chunk = await call('GET', `/systems/${system}/screens/render/chunk?key=${meta.key}&n=${n}`);
      assert.equal(chunk.status, 200, chunk.text);
      html += chunk.text;
    }
    assert.equal(Buffer.byteLength(html, 'utf8'), meta.bytes);
    return { meta, html };
  };
  return { tmp, ctx, call, write, writeJson, screen };
};

const bodyOf = (answer: Answer): { error: string; message: string } => JSON.parse(answer.text) as { error: string; message: string };

test('the screens file registers exactly the two SBD routes', () => {
  const router = createRouter({ token: TOKEN, log: { info: () => undefined, warn: () => undefined, error: () => undefined } });
  // Safe: registration never reads the context (the board service is made on the first request).
  registerSystemScreenRoutes(router, {} as Parameters<typeof registerSystemScreenRoutes>[1]);
  assert.deepEqual([...router.registered()].sort(), [...SBD].sort());
  assert.equal(SBD.length, 2);
});

test('both screens routes refuse a missing or wrong token with 401, before reading anything', async (t) => {
  const { call } = await serve(t);
  for (const token of [null, 'wrong-token', `${TOKEN}x`]) {
    for (const url of ['/systems/acme/screens/render?screen=home', `/systems/acme/screens/render/chunk?key=${ZERO_KEY}&n=0`]) {
      const answer = await call('GET', url, undefined, token);
      assert.equal(answer.status, 401, `${url} ${String(token)}`);
      assert.deepEqual(bodyOf(answer), { error: 'unauthorized', message: 'This request did not carry the service token.' });
    }
  }
});

test('a traversal or invalid system id is refused on both routes; an unknown system is 404', async (t) => {
  const { call } = await serve(t);
  for (const hostile of ['..%2F..%2Fetc', '..%5C..%5Cwindows', 'a%00b']) {
    for (const suffix of ['screens/render?screen=home', `screens/render/chunk?key=${ZERO_KEY}&n=0`]) {
      const answer = await call('GET', `/systems/${hostile}/${suffix}`);
      assert.equal(answer.status, 400, `${hostile} ${suffix}`);
      assert.equal(bodyOf(answer).error, 'bad-path');
    }
  }
  for (const bad of ['Acme', '_systems', '.chamber', 'C%3A', 'a..b']) assert.equal((await call('GET', `/systems/${bad}/screens/render?screen=home`)).status, 400, bad);
  assert.equal((await call('GET', '/systems/ghost/screens/render?screen=home')).status, 404);
  assert.equal((await call('GET', `/systems/ghost/screens/render/chunk?key=${ZERO_KEY}&n=0`)).status, 404);
});

test('a screen id with .., a separator, a drive letter, an encoded separator or upper case is refused before any read', async (t) => {
  const { call } = await serve(t);
  const hostile = [
    '', '..', '..%2F..%2Fsystem', '../home', 'screens%2Fhome', 'a%5Cb', 'a\\b', '%2E%2E', 'C:home', 'C%3A%5Chome',
    'Home', 'HOME', 'home.html', '-home', 'home%00', '%2Fetc%2Fpasswd', 'x'.repeat(41),
  ];
  for (const raw of hostile) {
    // The system does not exist: a 400 (not a 404) shows the query was refused before the store looked.
    for (const system of ['acme', 'ghost']) {
      const answer = await call('GET', `/systems/${system}/screens/render?screen=${raw}`);
      assert.equal(answer.status, 400, `${system} ${raw}`);
      assert.deepEqual(bodyOf(answer), { error: 'bad-request', message: 'That is not a screen id.' }, raw);
    }
  }
  assert.equal((await call('GET', '/systems/ghost/screens/render')).status, 400, 'no screen at all');
  for (const query of ['scheme=sepia', 'scheme=', 'version=1', 'version=..%2Fv1', 'proposal=x', 'proposal=p_k3m9q2x7&version=v1']) {
    assert.equal((await call('GET', `/systems/ghost/screens/render?screen=home&${query}`)).status, 400, query);
  }
  for (const query of ['key=zz&n=0', `key=${ZERO_KEY}&n=-1`, `key=${ZERO_KEY}&n=x`, `key=${ZERO_KEY}`]) {
    assert.equal((await call('GET', `/systems/acme/screens/render/chunk?${query}`)).status, 400, query);
  }
});

test('only a listed screen renders: unlisted is 404, a listed screen without its file is 422 with its sentence', async (t) => {
  const { call, write } = await serve(t);
  // A file in screens/ that system.json does not list is never served.
  await write('screens/secret.html', '<p>UNLISTED</p>');
  const unlisted = await call('GET', '/systems/acme/screens/render?screen=secret');
  assert.equal(unlisted.status, 404);
  assert.deepEqual(bodyOf(unlisted), { error: 'not-found', message: SCREEN_NOT_LISTED_MESSAGE });
  const missing = await call('GET', '/systems/acme/screens/render?screen=gone');
  assert.equal(missing.status, 422);
  assert.deepEqual(bodyOf(missing), { error: 'no-html', message: 'screens/gone.html is missing.' });
  // Acme's screen through another system's id: that system lists none.
  const other = await call('GET', '/systems/other/screens/render?screen=home');
  assert.equal(other.status, 404);
});

test('a screen render: bundled from the system files, bridge placeholder, a reference out of the folder blocked', async (t) => {
  const { call, screen } = await serve(t);
  const { meta, html } = await screen('screen=home');
  assert.equal(meta.title, 'Acme: Home page');
  assert.ok(html.includes(BRIDGE_PLACEHOLDER));
  assert.ok(html.includes('HOME-SCREEN'));
  // ../tokens.css is the system's own, inlined; the font is a data: URL.
  assert.ok(html.includes('--brand: #1a73e8;'));
  assert.ok(/url\("?data:font\/woff2;base64,/.test(html));
  assert.ok(!html.includes('../tokens.css') && !html.includes('../assets/fonts/'));
  // ../../other/tokens.css leaves the system folder: blocked by the bundler, never inlined.
  assert.deepEqual(meta.blocked, ['../../other/tokens.css']);
  assert.ok(!html.includes('OTHER-SYSTEM-SECRET'));
  assert.deepEqual(meta.external, ['https://remote.test/hero.png']);

  // The same screen again comes from the cache; dark is another render of the same document.
  const again = JSON.parse((await call('GET', '/systems/acme/screens/render?screen=home&scheme=light')).text) as RenderMeta;
  assert.equal(again.key, meta.key);
  const dark = await screen('screen=home&scheme=dark');
  assert.notEqual(dark.meta.key, meta.key);
  assert.equal(dark.html, html);

  // A chunk is bound to its system and its kind: another id's route, and the board's chunk route, can't read it.
  const cross = await call('GET', `/systems/other/screens/render/chunk?key=${meta.key}&n=0`);
  assert.equal(cross.status, 409);
  assert.deepEqual(bodyOf(cross), { error: 'stale', message: SCREEN_STALE_MESSAGE });
  assert.equal((await call('GET', `/systems/acme/board/chunk?key=${meta.key}&n=0`)).status, 409);
  const board = JSON.parse((await call('GET', '/systems/acme/board')).text) as RenderMeta;
  assert.equal((await call('GET', `/systems/acme/screens/render/chunk?key=${board.key}&n=0`)).status, 409);
  assert.equal((await call('GET', `/systems/acme/screens/render/chunk?key=${meta.key}&n=${meta.chunks}`)).status, 400);
});

test('a screen larger than one chunk comes back in order, in several chunks', async (t) => {
  const { write, screen } = await serve(t);
  // Incompressible text, so the bundle stays over one chunk: under the character cap with the font inlined.
  const filler = randomBytes(Math.floor(SYSTEM_SCREEN_MAX / 2) - 200).toString('hex').slice(0, SYSTEM_SCREEN_MAX - 400);
  await write('screens/home.html', `<!doctype html><html><head><style>@font-face { font-family: X; src: url("../assets/fonts/big.woff2"); }</style></head><body><p>${filler}</p><p>THE-END</p></body></html>`);
  await write('assets/fonts/big.woff2', Buffer.concat([Buffer.from('wOF2', 'latin1'), randomBytes(RENDER_CHUNK_MAX_BYTES * 2)]));
  const { meta, html } = await screen('screen=home');
  assert.ok(meta.chunks >= 3, `chunks: ${meta.chunks}`);
  assert.ok(html.indexOf(filler) < html.indexOf('THE-END'));
  assert.ok(html.trimEnd().endsWith('</html>'));
});

test('the character cap: at 60 000 a screen renders, one over is refused, and characters are counted, not bytes', async (t) => {
  const { call, write, ctx } = await serve(t);
  const page = (body: string): string => {
    const shell = '<!doctype html><html><body><p></p></body></html>';
    return shell.replace('<p></p>', `<p>${body}</p>`);
  };
  const shellLength = page('').length;
  await write('screens/home.html', page('a'.repeat(SYSTEM_SCREEN_MAX - shellLength)));
  assert.equal((await call('GET', '/systems/acme/screens/render?screen=home')).status, 200);

  await write('screens/home.html', page('a'.repeat(SYSTEM_SCREEN_MAX - shellLength + 1)));
  const over = await call('GET', '/systems/acme/screens/render?screen=home');
  assert.equal(over.status, 413);
  assert.deepEqual(bodyOf(over), { error: 'too-large', message: 'screens/home.html is longer than 60 000 characters.' });
  const detail = await ensureSystemStore(ctx).detail('acme');
  assert.equal(detail.screens.find((entry) => entry.id === 'home')?.problem, 'screens/home.html is longer than 60 000 characters.');

  // Two bytes a character: well over 60 000 bytes, still within 60 000 characters.
  await write('screens/home.html', page('é'.repeat(SYSTEM_SCREEN_MAX - shellLength)));
  assert.equal((await call('GET', '/systems/acme/screens/render?screen=home')).status, 200);
  assert.equal((await ensureSystemStore(ctx).detail('acme')).screens.find((entry) => entry.id === 'home')?.problem, null);
});

test('a 25th screen is a problem and is never served', async (t) => {
  const { call, write, writeJson, ctx } = await serve(t);
  const screens = Array.from({ length: SYSTEM_SCREENS_MAX + 1 }, (_, n) => ({ id: `s${n}`, title: `Screen ${n}`, kind: 'page' }));
  for (const entry of screens) await write(`screens/${entry.id}.html`, `<p>${entry.id}</p>`);
  await writeJson({ screens });
  const detail = await ensureSystemStore(ctx).detail('acme');
  assert.equal(detail.screens.length, SYSTEM_SCREENS_MAX);
  assert.deepEqual(detail.problems.filter((problem) => problem.entry === `screens.s${SYSTEM_SCREENS_MAX}`), [{ entry: `screens.s${SYSTEM_SCREENS_MAX}`, message: 'Design systems hold up to 24 screens.' }]);
  assert.equal((await call('GET', `/systems/acme/screens/render?screen=s${SYSTEM_SCREENS_MAX - 1}`)).status, 200);
  assert.equal((await call('GET', `/systems/acme/screens/render?screen=s${SYSTEM_SCREENS_MAX}`)).status, 404);
});

test('a screen file, the screens folder or an asset that is a link out of the system is never followed', async (t) => {
  const { tmp, call, write } = await serve(t);
  const outside = await useTmpRoot(t, 'dc-outside-');
  const secretPage = await outside.write('page.html', '<p>OUTSIDE-SECRET-PAGE</p>');
  const secretPng = await outside.write('leak.png', 'OUTSIDE-SECRET-PNG');

  // The screen file itself is a link: the store does not see it, so it reads as missing.
  await symlink(secretPage, tmp.at('_systems/acme/screens/og-card-link.html'));
  await tmp.write('_systems/acme/system.json', `${JSON.stringify({ screens: [...SYSTEM_JSON.screens, { id: 'og-card-link', title: 'Linked', kind: 'page' }] })}\n`);
  const linked = await call('GET', '/systems/acme/screens/render?screen=og-card-link');
  assert.equal(linked.status, 422, linked.text);
  assert.ok(!linked.text.includes('OUTSIDE-SECRET'));

  // An asset the screen points at is a link out: not inlined, the secret bytes never appear.
  await symlink(secretPng, tmp.at('_systems/acme/assets/leak.png'));
  await write('screens/home.html', '<!doctype html><html><body><img src="../assets/leak.png" alt=""></body></html>');
  const answer = await call('GET', '/systems/acme/screens/render?screen=home');
  assert.equal(answer.status, 200, answer.text);
  const meta = JSON.parse(answer.text) as RenderMeta;
  assert.deepEqual([...meta.missing, ...meta.blocked], ['../assets/leak.png']);
  const chunk = await call('GET', `/systems/acme/screens/render/chunk?key=${meta.key}&n=0`);
  assert.ok(!chunk.text.includes(Buffer.from('OUTSIDE-SECRET-PNG').toString('base64')));

  // The whole screens/ folder is a link out: nothing in it is served.
  const elsewhere = await useTmpRoot(t, 'dc-elsewhere-');
  await elsewhere.write('home.html', '<p>OUTSIDE-SECRET-FOLDER</p>');
  await tmp.write('_systems/other/system.json', `${JSON.stringify({ screens: [{ id: 'home', title: 'Home', kind: 'page' }] })}\n`);
  await symlink(elsewhere.root, tmp.at('_systems/other/screens'));
  const folder = await call('GET', '/systems/other/screens/render?screen=home');
  assert.equal(folder.status, 422, folder.text);
  assert.ok(!folder.text.includes('OUTSIDE-SECRET'));
});

test('a system event drops that system screens from the cache; another system event does not', async (t) => {
  const { ctx, call, write, screen } = await serve(t);
  await write('screens/home.html', '<p>ACME-HOME</p>');
  await write('system.json', `${JSON.stringify({ screens: [{ id: 'home', title: 'Home', kind: 'page' }] })}\n`, 'other');
  await write('screens/home.html', '<p>OTHER-HOME</p>', 'other');
  const acme = await screen('screen=home');
  const other = await screen('screen=home', 'other');
  const chunkOf = (system: string, key: string) => call('GET', `/systems/${system}/screens/render/chunk?key=${key}&n=0`);

  ctx.hub.emit({ slug: null, kind: 'system', system: 'other', systemChange: 'files' });
  assert.equal((await chunkOf('acme', acme.meta.key)).status, 200, 'an event for another system keeps this one');
  assert.equal((await chunkOf('other', other.meta.key)).status, 409);

  ctx.hub.emit({ slug: null, kind: 'system', system: 'acme', systemChange: 'files', files: ['screens/home.html'] });
  const dropped = await chunkOf('acme', acme.meta.key);
  assert.equal(dropped.status, 409);
  assert.deepEqual(bodyOf(dropped), { error: 'stale', message: SCREEN_STALE_MESSAGE });

  // Loading again builds it again, with the new text.
  await write('screens/home.html', '<p>ACME-HOME-2</p>');
  const fresh = await screen('screen=home');
  assert.notEqual(fresh.meta.key, acme.meta.key);
  assert.ok(fresh.html.includes('ACME-HOME-2'));

  // A root change drops everything.
  ctx.hub.emit({ slug: null, kind: 'root' });
  assert.equal((await chunkOf('acme', fresh.meta.key)).status, 409);
});

test('a version renders its own screen; a version or proposal it does not have is refused', async (t) => {
  const { ctx, call, write, screen } = await serve(t);
  await write('screens/home.html', '<p>VERSION-ONE</p>');
  const snapshot = await ensureSystemVersions(ctx).create('acme', 'manual');
  assert.ok(snapshot);
  await write('screens/home.html', '<p>VERSION-TWO</p>');
  assert.ok((await screen('screen=home')).html.includes('VERSION-TWO'));
  const old = await screen(`screen=home&version=${snapshot.id}`);
  assert.ok(old.html.includes('VERSION-ONE') && !old.html.includes('VERSION-TWO'));
  assert.equal((await call('GET', '/systems/acme/screens/render?screen=home&version=v9')).status, 404);
  // An internal system has no proposal waiting.
  assert.equal((await call('GET', '/systems/acme/screens/render?screen=home&proposal=p_k3m9q2x7')).status, 404);

  // A version holding an over-long screen refuses it with the same sentence.
  await write('screens/home.html', `<p>${'a'.repeat(SYSTEM_SCREEN_MAX)}</p>`);
  const big = await ensureSystemVersions(ctx).create('acme', 'manual');
  assert.ok(big);
  const refused = await call('GET', `/systems/acme/screens/render?screen=home&version=${big.id}`);
  assert.equal(refused.status, 413);
  assert.deepEqual(bodyOf(refused), { error: 'too-large', message: 'screens/home.html is longer than 60 000 characters.' });
});

test('a repo snapshot reads screens/<id>.html with the screen cap, not the example cap', async (t) => {
  const rig = await setupRepo(t);
  const within = `<!doctype html><p>${'a'.repeat(SYSTEM_EXAMPLE_MAX * 4)}</p>`; // over the example cap, within the screen cap
  await mkdir(rig.repo('design-system/screens'), { recursive: true });
  await writeFile(rig.repo('design-system/screens/home.html'), within);
  await writeFile(rig.repo('design-system/screens/huge.html'), 'a'.repeat(SYSTEM_SCREEN_MAX * 4 + 1));
  await writeFile(rig.repo('design-system/screens/Upper.html'), '<p>not a contract path</p>');
  const read = await readRepoSystem({ directory: rig.project, folder: 'design-system', livingPage: 'design-system/index.html' });
  assert.equal(read.kind, 'read');
  if (read.kind !== 'read') return;
  assert.equal(read.files.get('screens/home.html')?.toString('utf8'), within);
  assert.equal(read.files.has('screens/huge.html'), false);
  assert.deepEqual(read.skipped.filter((entry) => entry.path.startsWith('screens/')), [{ path: 'screens/huge.html', reason: 'huge.html is too large.' }]);
  assert.equal(read.files.has('screens/Upper.html'), false);
});
