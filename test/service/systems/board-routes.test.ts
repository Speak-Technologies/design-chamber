// The specimen board over HTTP (documentation/specs/phase-2-5-technical.md §3.1, §5.7, AD-9): the bearer
// check, the id gate (traversal), the query checks, a real render of a system folder (examples bundled one
// by one with their remote refs reported, fonts and logos inlined as data: URLs, the bridge placeholder),
// chunks bound to their system, versions read from the version's own tree, and a link out of the system
// never followed. The e2e part loads the board in headless Chrome under the guest CSP, with no network,
// and checks that example scripts stay inert, example CSS stays scoped and dark values apply.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import type { RenderMeta } from '../../../src/shared/api.ts';
import { BRIDGE_PLACEHOLDER } from '../../../src/shared/bridge-protocol.ts';
import { createRouter, createServiceServer, listenLoopback } from '../../../src/service/http.ts';
import { registerSystemBoardRoutes } from '../../../src/service/routes/system-board.ts';
import { registerSystemsRoutes } from '../../../src/service/routes/systems.ts';
import { EAGER_SECTIONS_CSS } from '../../../src/service/systems/board-html.ts';
import { ensureSystemVersions } from '../../../src/service/systems/versions.ts';
import { chromeOrSkip, testBrowserFlags } from '../../helpers/chrome-or-skip.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const TOKEN = 'board-routes-token-0123456789';
const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'latin1'), randomBytes(64)]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10" fill="#1a73e8"/></svg>';

const TOKENS_CSS = `:root {
  --brand: #1a73e8;
  --space-2: 8px;
}
@media (prefers-color-scheme: dark) {
  :root { --brand: #8ab4f8; }
}
`;

const SYSTEM_JSON = {
  tokens: { '--brand': { group: 'brand' } },
  fonts: [{ file: 'assets/fonts/inter.woff2', family: 'Inter' }],
  logos: [
    { file: 'assets/logos/mark.svg', variant: 'mark' },
    { file: 'assets/logos/link.svg', variant: 'link' },
  ],
  components: [{ id: 'button', name: 'Button', example: 'components/button.html' }],
};

const EXAMPLE =
  '<!doctype html><html><head><link rel="stylesheet" href="button.css"></head><body>' +
  '<p class="dc-probe">Example</p><img src="https://remote.test/x.png" alt="">' +
  '<script>window.__exampleRan = true;</script></body></html>';

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
  const server = createServiceServer(router);
  await listenLoopback(server, 0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown, token: string | null = TOKEN): Promise<Answer> => {
    const answer = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: answer.status, text: await answer.text() };
  };
  for (const name of ['Acme', 'Other']) assert.equal((await call('POST', '/systems', { name, brand: true })).status, 200);
  const write = (rel: string, content: string | Uint8Array): Promise<string> => tmp.write(`_systems/acme/${rel}`, content);
  await write('tokens.css', TOKENS_CSS);
  await write('system.json', `${JSON.stringify(SYSTEM_JSON)}\n`);
  await write('assets/fonts/inter.woff2', WOFF2);
  await write('assets/logos/mark.svg', SVG);
  await write('components/button.html', EXAMPLE);
  await write('components/button.css', '.dc-probe { color: rgb(1, 2, 3); }');
  /** The whole board: meta, then every chunk. */
  const board = async (query = ''): Promise<{ meta: RenderMeta; html: string }> => {
    const answer = await call('GET', `/systems/acme/board${query}`);
    assert.equal(answer.status, 200, answer.text);
    const meta = JSON.parse(answer.text) as RenderMeta;
    let html = '';
    for (let n = 0; n < meta.chunks; n += 1) {
      const chunk = await call('GET', `/systems/acme/board/chunk?key=${meta.key}&n=${n}`);
      assert.equal(chunk.status, 200, chunk.text);
      html += chunk.text;
    }
    assert.equal(Buffer.byteLength(html, 'utf8'), meta.bytes);
    return { meta, html };
  };
  return { tmp, ctx, call, write, board };
};

const errorOf = (answer: Answer): string => (JSON.parse(answer.text) as { error: string }).error;

test('both routes refuse a missing or wrong token with 401', async (t) => {
  const { call } = await serve(t);
  for (const token of [null, 'wrong-token']) {
    assert.equal((await call('GET', '/systems/acme/board', undefined, token)).status, 401);
    assert.equal((await call('GET', `/systems/acme/board/chunk?key=${'0'.repeat(64)}&n=0`, undefined, token)).status, 401);
  }
});

test('a traversal or invalid id, scheme, version, key or chunk number is refused; an unknown system is 404', async (t) => {
  const { call } = await serve(t);
  for (const hostile of ['..%2F..%2Fetc', '..%5Cwindows', 'a%00b']) {
    for (const suffix of ['board', `board/chunk?key=${'0'.repeat(64)}&n=0`]) {
      const answer = await call('GET', `/systems/${hostile}/${suffix}`);
      assert.equal(answer.status, 400, `${hostile} ${suffix}`);
      assert.equal(errorOf(answer), 'bad-path');
    }
  }
  for (const bad of ['Acme', '_systems', '.chamber', 'C%3A']) assert.equal((await call('GET', `/systems/${bad}/board`)).status, 400, bad);
  assert.equal((await call('GET', '/systems/ghost/board')).status, 404);
  assert.equal((await call('GET', `/systems/ghost/board/chunk?key=${'0'.repeat(64)}&n=0`)).status, 404);
  for (const query of ['?scheme=sepia', '?scheme=', '?version=1', '?version=v0', '?version=..%2Fv1']) {
    assert.equal((await call('GET', `/systems/acme/board${query}`)).status, 400, query);
  }
  for (const query of ['?key=zz&n=0', `?key=${'0'.repeat(64)}&n=-1`, `?key=${'0'.repeat(64)}&n=x`]) {
    assert.equal((await call('GET', `/systems/acme/board/chunk${query}`)).status, 400, query);
  }
  assert.equal((await call('GET', '/systems/acme/board?version=v9')).status, 404);
  const stale = await call('GET', `/systems/acme/board/chunk?key=${'0'.repeat(64)}&n=0`);
  assert.equal(stale.status, 409);
  assert.equal(errorOf(stale), 'stale');
});

test('a board render: bundled, with the bridge placeholder, data: assets and example remote refs reported', async (t) => {
  const { call, board, tmp } = await serve(t);
  // A logo that is a link out of the system is never followed.
  const outside = await useTmpRoot(t, 'dc-outside-');
  const secret = await outside.write('secret.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>OUTSIDE-SECRET</text></svg>');
  await symlink(secret, tmp.at('_systems/acme/assets/logos/link.svg'));

  const { meta, html } = await board();
  assert.equal(meta.title, 'Acme: specimen board');
  assert.ok(html.includes(BRIDGE_PLACEHOLDER));
  assert.deepEqual(meta.external, ['https://remote.test/x.png']);
  assert.deepEqual(meta.blocked, []);
  // Font and logo inlined; the SVG only as an <img> data URL, never inline markup.
  assert.ok(/src: url\("?data:font\/woff2;base64,/.test(html));
  assert.ok(/<img class="dc-logo" src="data:image\/svg\+xml;base64,[^"]+" alt="mark">/.test(html));
  assert.ok(!/<svg/i.test(html));
  assert.ok(!html.includes('assets/logos/'));
  assert.ok(!html.includes(Buffer.from('OUTSIDE-SECRET').toString('base64').slice(0, 12)) && !html.includes('OUTSIDE-SECRET'));
  // The example: its stylesheet inlined (relative to components/), the whole of it inert template text.
  const template = /<template data-dc-example="button">([\s\S]*?)<\/template>/.exec(html);
  assert.ok(template);
  assert.ok(template[1]?.includes('rgb(1, 2, 3)'));
  assert.ok(!template[1]?.includes('<'));
  assert.equal((html.match(/<script\b/gi) ?? []).length, 1);
  // The page's board leaves off-screen sections to content-visibility: the eager override is the visual check's only.
  assert.ok(html.includes('content-visibility: auto'));
  assert.ok(!html.includes(EAGER_SECTIONS_CSS), 'the page board is not drawn eager');

  // The same board again comes from the cache; dark is another render.
  const again = JSON.parse((await call('GET', '/systems/acme/board?scheme=light')).text) as RenderMeta;
  assert.equal(again.key, meta.key);
  const dark = await board('?scheme=dark');
  assert.notEqual(dark.meta.key, meta.key);
  assert.ok(dark.html.includes('color-scheme: dark'));

  // A chunk is bound to its system: another id's route can't read it.
  const cross = await call('GET', `/systems/other/board/chunk?key=${meta.key}&n=0`);
  assert.equal(cross.status, 409);
  const outOfRange = await call('GET', `/systems/acme/board/chunk?key=${meta.key}&n=${meta.chunks}`);
  assert.equal(outOfRange.status, 400);
});

test('a refused font file is named and not loaded; a version renders its own tree', async (t) => {
  const { ctx, write, board } = await serve(t);
  const before = await board();
  const snapshot = await ensureSystemVersions(ctx).create('acme', 'manual');
  assert.ok(snapshot);
  await write('tokens.css', TOKENS_CSS.replace('#1a73e8', '#00aa00'));
  await write('assets/fonts/inter.woff2', 'not a font at all');

  const live = await board();
  assert.notEqual(live.meta.key, before.meta.key);
  assert.ok(live.html.includes('--brand: #00aa00;'));
  assert.ok(live.html.includes('This font file can&#39;t be used.'));
  assert.ok(!live.html.includes('@font-face'));

  const old = await board(`?version=${snapshot.id}`);
  assert.ok(old.html.includes('--brand: #1a73e8;'));
  assert.ok(/data:font\/woff2;base64,/.test(old.html));
});

// ---- e2e: the board in headless Chrome under the guest CSP, offline ----

const guestFramePolicy = (): string =>
  [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' 'self' data: blob:",
    "style-src 'unsafe-inline' 'self' data: blob:",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "frame-src 'self' data: blob:",
    "connect-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ');

const REPORTER = `<script>
addEventListener('load', function () {
  setTimeout(function () {
    var hosts = document.querySelectorAll('[data-dc-example-host]');
    var probe = hosts[0] && hosts[0].shadowRoot ? hosts[0].shadowRoot.querySelector('.dc-probe') : null;
    var light = document.querySelector('[data-dc-entry="token:--brand"] .dc-ground.dc-light .dc-swatch');
    var dark = document.querySelector('[data-dc-entry="token:--brand"] .dc-ground.dc-dark .dc-swatch');
    var logo = document.querySelector('img.dc-logo');
    var outsideP = document.querySelector('.dc-board-sub');
    parent.postMessage({ e2e: true, results: {
      exampleRan: window.__exampleRan === true,
      shadowRoots: Array.prototype.filter.call(hosts, function (h) { return !!h.shadowRoot; }).length,
      probeColor: probe ? getComputedStyle(probe).color : null,
      boardColor: getComputedStyle(outsideP).color,
      light: light ? getComputedStyle(light).backgroundColor : null,
      dark: dark ? getComputedStyle(dark).backgroundColor : null,
      logo: logo ? logo.complete && logo.naturalWidth > 0 : null
    } }, '*');
  }, 300);
});
</script>`;

const TOP = `<!doctype html><html><body>
<iframe sandbox="allow-scripts" src="/guest/board.html" style="width:1200px;height:900px"></iframe>
<script>
addEventListener('message', (e) => { if (e.data && e.data.e2e) fetch('/result', { method: 'POST', body: JSON.stringify(e.data.results) }); });
</script></body></html>`;

type E2eResults = { exampleRan: boolean; shadowRoots: number; probeColor: string | null; boardColor: string; light: string | null; dark: string | null; logo: boolean | null };

const loadInChrome = async (browser: string, boardHtml: string): Promise<{ results: E2eResults; requests: string[] }> => {
  const requests: string[] = [];
  let resolveResult: (value: E2eResults) => void = () => undefined;
  const result = new Promise<E2eResults>((resolve) => (resolveResult = resolve));
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url === '/top.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(TOP);
    } else if (req.url === '/guest/board.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `${guestFramePolicy()}; sandbox allow-scripts` });
      res.end(boardHtml);
    } else if (req.url === '/result' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        res.writeHead(204);
        res.end();
        resolveResult(JSON.parse(body) as E2eResults);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-e2e-board-'));
  const child = spawn(
    browser,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', ...testBrowserFlags(), `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/top.html`],
    { stdio: 'ignore' },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      result,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('board e2e: no result within 45 s')), 45_000);
      }),
    ]);
    return { results, requests };
  } finally {
    clearTimeout(timer);
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
    server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
};

test('board e2e: offline in a sandboxed frame, example scripts inert, example CSS scoped, dark values applied', { timeout: 60_000 }, async (t) => {
  const browser = chromeOrSkip(t);
  if (!browser) return;
  const { board } = await serve(t);
  const { html } = await board();
  const page = html.replace('</body></html>', `${REPORTER}</body></html>`);
  assert.notEqual(page, html);
  const { results, requests } = await loadInChrome(browser, page);
  assert.deepEqual(results, {
    exampleRan: false,
    shadowRoots: 2,
    probeColor: 'rgb(1, 2, 3)',
    boardColor: results.boardColor,
    light: 'rgb(26, 115, 232)',
    dark: 'rgb(138, 180, 248)',
    logo: true,
  });
  assert.notEqual(results.boardColor, 'rgb(1, 2, 3)');
  // Nothing beyond the harness was asked for: every board file was inlined.
  assert.deepEqual(
    requests.filter((url) => url !== '/favicon.ico'),
    ['/top.html', '/guest/board.html', '/result'],
  );
});
