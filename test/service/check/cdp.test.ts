import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { CdpUnavailable, DEFAULT_LAUNCH_BUDGET_MS, checkBrowserArgs, createFrameParser, encodeMessage, openCdp } from '../../../src/service/check/cdp.ts';
import { CHECK_CSP, DOCUMENT_ORIGIN } from '../../../src/service/check/render.ts';
import { browserClassOf, planArtboards } from '../../../src/service/check/engine.ts';
import { parseDesignJsonText } from '../../../src/shared/design-json.ts';

const args = (over: Partial<Parameters<typeof checkBrowserArgs>[0]> = {}): string[] => checkBrowserArgs({ workDir: '/work', platform: 'linux', isRoot: false, join: path.posix.join, ...over });

test('the browser is started with the pipe, no debugging port, and every network cut', () => {
  const list = args();
  assert.ok(list.includes('--remote-debugging-pipe'));
  assert.ok(!list.some((arg) => arg.startsWith('--remote-debugging-port')), 'no listening socket another process could attach to');
  assert.ok(list.includes('--host-resolver-rules=MAP * ~NOTFOUND'), 'no name resolves');
  assert.ok(list.includes('--proxy-server=http://dc-check.invalid:1'), 'a dead proxy stops IP literals');
  assert.ok(list.includes('--proxy-bypass-list=<-loopback>'), 'loopback goes through the dead proxy too');
  assert.ok(list.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'));
  assert.ok(list.includes('--webrtc-ip-handling-policy=disable_non_proxied_udp'), 'the spelling Chrome 157 honours: STUN/TURN UDP stays in');
  assert.ok(list.includes('--headless=new'));
  assert.ok(list.includes('--user-data-dir=/work/profile'), 'a throwaway profile');
  assert.equal(list.at(-1), 'about:blank');
});

test('no argument weakens the browser: no web security off, no file access, no sandbox unless root on Linux', () => {
  for (const flag of ['--disable-web-security', '--allow-file-access-from-files', '--allow-running-insecure-content', '--disable-site-isolation-trials', '--no-sandbox']) {
    assert.ok(!args().includes(flag), flag);
  }
  assert.ok(args({ isRoot: true }).includes('--no-sandbox'));
  assert.ok(!args({ isRoot: true, platform: 'win32' }).includes('--no-sandbox'));
  assert.ok(!args({ isRoot: true, platform: 'darwin' }).includes('--no-sandbox'));
  assert.equal(args({ platform: 'win32', workDir: 'C:\\t\\w', join: path.win32.join }).find((arg) => arg.startsWith('--user-data-dir')), '--user-data-dir=C:\\t\\w\\profile');
});

test('documents are served from a synthetic origin under the guest frame policy, never from file://', () => {
  assert.equal(DOCUMENT_ORIGIN, 'https://design.invalid');
  assert.match(CHECK_CSP, /^sandbox allow-scripts;/);
  assert.ok(!/allow-same-origin/.test(CHECK_CSP));
  assert.ok(!/allow-(modals|popups|top-navigation|forms|downloads)/.test(CHECK_CSP));
  assert.ok(CHECK_CSP.includes("default-src 'none'"));
  assert.ok(CHECK_CSP.includes("connect-src 'none'"));
  assert.ok(CHECK_CSP.includes('img-src data: blob:'));
  assert.ok(!/https?:|\*/.test(CHECK_CSP), 'no remote source is allowed');
});

test('framing: messages end in a NUL; a message may arrive in pieces or several at once', () => {
  const seen: string[] = [];
  const feed = createFrameParser((text) => seen.push(text));
  const bytes = Buffer.concat([encodeMessage({ id: 1, result: {} }), encodeMessage({ id: 2, result: { a: 'é' } })]);
  feed(bytes.subarray(0, 5));
  assert.deepEqual(seen, []);
  feed(bytes.subarray(5, 30));
  feed(bytes.subarray(30));
  assert.deepEqual(seen.map((text) => JSON.parse(text)), [{ id: 1, result: {} }, { id: 2, result: { a: 'é' } }]);
  // A multi-byte character split across chunks survives.
  const chunk = encodeMessage({ text: 'né' });
  const split = chunk.indexOf(0xc3) + 1;
  const parts: string[] = [];
  const again = createFrameParser((text) => parts.push(text));
  again(chunk.subarray(0, split));
  again(chunk.subarray(split));
  assert.deepEqual(parts.map((text) => JSON.parse(text)), [{ text: 'né' }]);
});

test('browser class is the basename family, never a path', () => {
  assert.equal(browserClassOf('/usr/bin/google-chrome'), 'chrome');
  assert.equal(browserClassOf('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'), 'msedge');
  assert.equal(browserClassOf('/snap/bin/chromium'), 'chromium');
  assert.equal(browserClassOf('/usr/bin/brave-browser'), 'brave');
  assert.equal(browserClassOf('/home/sam/bin/mybrowser'), 'other');
});

test('the plan follows the wall: screens with a file, at their viewports; pages at every viewport', () => {
  const iso = new Date(0).toISOString();
  const canvas = parseDesignJsonText(
    JSON.stringify({
      version: 1,
      kind: 'canvas',
      viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }, { id: 'phone', label: 'Phone', width: 390, height: 844 }],
      screens: [
        { id: 'a', file: 'screens/a.html' },
        { id: 'b', file: 'screens/b.html', viewports: ['phone'] },
        { id: 'c', file: 'screens/c.html' },
      ],
    }),
    { fallbackTitle: 'x', fallbackTime: iso },
  ).design;
  const entries = [{ rel: 'screens/a.html', screen: 'a' }, { rel: 'screens/b.html', screen: 'b' }];
  assert.deepEqual(
    planArtboards({ design: canvas, entries }).map((item) => `${item.screen}@${item.viewport.id}`),
    ['a@laptop', 'a@phone', 'b@phone'],
  );
  assert.deepEqual(planArtboards({ design: canvas, entries, only: ['b'] }).map((item) => `${item.screen}@${item.viewport.id}`), ['b@phone']);
  const page = parseDesignJsonText(JSON.stringify({ version: 1, kind: 'page' }), { fallbackTitle: 'x', fallbackTime: iso }).design;
  assert.deepEqual(planArtboards({ design: page, entries: [{ rel: 'index.html', screen: null }] }).map((item) => `${item.file}@${item.viewport.id}`), ['index.html@laptop']);
  assert.deepEqual(planArtboards({ design: page, entries: [] }), []);
});

// ---- the launch handshake against a fake browser process ----

type FakeChild = EventEmitter & { stdio: (PassThrough | null)[]; pid: number | undefined; kill: (signal?: string) => boolean; killed?: boolean };

/**
 * A `spawn` fake: a browser process that stays alive but only answers `Browser.getVersion` after
 * `delayMs` (a cold first start). `exitAt` makes it die at that age instead. It plays just enough of
 * a ChildProcess for `openCdp` (stdio pipes 3/4, `on`, `kill`, `pid`); `pid` is undefined so the
 * kill falls back to `child.kill` and no real process group is signalled.
 */
const fakeBrowserSpawn = (delayMs: number, exitAt?: number, spawned?: FakeChild[]): typeof import('node:child_process').spawn => {
  const impl = (): FakeChild => {
    const toBrowser = new PassThrough();
    const fromBrowser = new PassThrough();
    const child = new EventEmitter() as FakeChild;
    child.stdio = [null, null, null, toBrowser, fromBrowser];
    child.pid = undefined;
    child.kill = () => {
      child.killed = true;
      child.emit('exit', 0, null);
      return true;
    };
    spawned?.push(child);
    let ready = false;
    let lastVersionId: number | null = null;
    const answer = (id: number, result: object): void => {
      if (!fromBrowser.destroyed) fromBrowser.write(encodeMessage({ id, result }));
    };
    toBrowser.on('data', createFrameParser((text) => {
      const msg = JSON.parse(text) as { id?: number; method?: string };
      if (typeof msg.id !== 'number') return;
      if (msg.method === 'Browser.getVersion') {
        lastVersionId = msg.id;
        if (ready) answer(msg.id, { product: 'FakeChrome/158.0', protocolVersion: '1.3' });
      } else if (msg.method === 'Browser.close') {
        answer(msg.id, {});
        child.emit('exit', 0, null);
      }
    }));
    const readyTimer = setTimeout(() => {
      ready = true;
      if (lastVersionId !== null) answer(lastVersionId, { product: 'FakeChrome/158.0', protocolVersion: '1.3' });
    }, delayMs);
    readyTimer.unref?.();
    if (exitAt !== undefined) {
      const exitTimer = setTimeout(() => child.emit('exit', 1, null), exitAt);
      exitTimer.unref?.();
    }
    return child;
  };
  // Safe: openCdp only reads stdio[3]/[4], `on`, `kill` and `pid`, all of which the fake provides.
  return impl as unknown as typeof import('node:child_process').spawn;
};

test('a slow first answer from a live browser is a slow launch, not "can\'t be driven"', async () => {
  // The first answer lands well after one wait window: the old single-window handshake gave up here
  // and called the browser unavailable; a live browser must be waited for.
  const started = Date.now();
  const session = await openCdp('/fake/chrome', [], { timeoutMs: 40, spawnImpl: fakeBrowserSpawn(150) });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 150, `waited for the live browser to answer (${elapsed} ms)`);
  assert.equal(session.exited, false);
  await session.close();
});

test('a browser that exits at once is still "can\'t be driven", without waiting out the launch budget', async () => {
  const started = Date.now();
  await assert.rejects(
    openCdp('/fake/chrome', [], { timeoutMs: 5000, launchBudgetMs: 60_000, spawnImpl: fakeBrowserSpawn(60_000, 10) }),
    (error: unknown) => error instanceof CdpUnavailable,
  );
  assert.ok(Date.now() - started < 1000, 'a dead browser fails fast, not after the whole launch budget');
});

test('a browser alive but silent for the whole launch budget is "can\'t be driven"', async () => {
  const started = Date.now();
  await assert.rejects(
    openCdp('/fake/chrome', [], { timeoutMs: 30, launchBudgetMs: 120, spawnImpl: fakeBrowserSpawn(60_000) }),
    (error: unknown) => error instanceof CdpUnavailable,
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 120 && elapsed < 1000, `gave up at the launch budget (${elapsed} ms)`);
});

test('a live browser that answers the handshake with an error is "can\'t be driven" at once, not asked again', async () => {
  // Only "no answer yet" means "still starting". An answer that is an error is final: re-asking it
  // would spin until the launch budget ran out.
  let asked = 0;
  const spawnImpl = ((): FakeChild => {
    const toBrowser = new PassThrough();
    const fromBrowser = new PassThrough();
    const child = new EventEmitter() as FakeChild;
    child.stdio = [null, null, null, toBrowser, fromBrowser];
    child.pid = undefined;
    child.kill = () => {
      child.emit('exit', 0, null);
      return true;
    };
    toBrowser.on('data', createFrameParser((text) => {
      const msg = JSON.parse(text) as { id?: number; method?: string };
      if (typeof msg.id !== 'number') return;
      if (msg.method === 'Browser.getVersion') {
        asked += 1;
        if (!fromBrowser.destroyed) fromBrowser.write(encodeMessage({ id: msg.id, error: { message: 'not allowed' } }));
      } else if (msg.method === 'Browser.close') {
        child.emit('exit', 0, null);
      }
    }));
    return child;
    // Safe: openCdp only reads stdio[3]/[4], `on`, `kill` and `pid`, all of which the fake provides.
  }) as unknown as typeof import('node:child_process').spawn;
  const started = Date.now();
  await assert.rejects(
    openCdp('/fake/chrome', [], { timeoutMs: 5000, launchBudgetMs: 60_000, spawnImpl }),
    (error: unknown) => error instanceof CdpUnavailable && /not allowed/.test(error.message),
  );
  assert.equal(asked, 1, 'asked once');
  assert.ok(Date.now() - started < 1000, 'failed at once');
});

test('the default launch budget for a live-but-silent browser is 60 s', () => {
  assert.equal(DEFAULT_LAUNCH_BUDGET_MS, 60_000);
});

test('a launch budget shorter than one wait window clips that window (the restart launch gets only what is left)', async () => {
  // timeoutMs alone would wait 5 s; the clip to the remaining budget ends it at 120 ms.
  const started = Date.now();
  await assert.rejects(
    openCdp('/fake/chrome', [], { timeoutMs: 5000, launchBudgetMs: 120, spawnImpl: fakeBrowserSpawn(60_000) }),
    (error: unknown) => error instanceof CdpUnavailable,
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 100 && elapsed < 1500, `gave up at the budget, not the wait window (${elapsed} ms)`);
});

test('aborting a silent launch kills the browser and rejects at once, not after the launch budget', async () => {
  const spawned: FakeChild[] = [];
  const controller = new AbortController();
  const started = Date.now();
  const opening = openCdp('/fake/chrome', [], { timeoutMs: 5000, launchBudgetMs: 60_000, signal: controller.signal, spawnImpl: fakeBrowserSpawn(60_000, undefined, spawned) });
  setTimeout(() => {
    controller.abort();
    assert.equal(spawned[0]?.killed, true, 'killed in the abort itself, not after the handshake unwinds');
  }, 30);
  await assert.rejects(opening, (error: unknown) => error instanceof CdpUnavailable && /cancelled/.test(error.message));
  assert.ok(Date.now() - started < 1000, 'rejected at once');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0]?.killed, true, 'the browser process was killed');
});

test('a launch whose signal is already aborted never starts a browser', async () => {
  const spawned: FakeChild[] = [];
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    openCdp('/fake/chrome', [], { timeoutMs: 5000, signal: controller.signal, spawnImpl: fakeBrowserSpawn(10, undefined, spawned) }),
    (error: unknown) => error instanceof CdpUnavailable,
  );
  assert.equal(spawned.length, 0);
});

test('aborting after the launch is the caller\'s business: the abort listener is gone and the session stays up', async () => {
  const spawned: FakeChild[] = [];
  const controller = new AbortController();
  const session = await openCdp('/fake/chrome', [], { timeoutMs: 40, signal: controller.signal, spawnImpl: fakeBrowserSpawn(10, undefined, spawned) });
  controller.abort();
  assert.equal(session.exited, false);
  assert.notEqual(spawned[0]?.killed, true);
  await session.close();
});
