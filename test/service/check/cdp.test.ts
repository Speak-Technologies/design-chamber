import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { checkBrowserArgs, createFrameParser, encodeMessage } from '../../../src/service/check/cdp.ts';
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
