// QA regressions for the agent render and check branch: hostile launcher paths, and a design
// that uses WebRTC to reach the network from the check's browser.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { checkCommandFor } from '../../../src/shared/agent/check-command.ts';
import { quoteCmd, syncLaunchers } from '../../../src/service/check/launcher.ts';
import { runCheck } from '../../../src/service/check/engine.ts';
import { createLogger } from '../../../src/service/context.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const quiet = createLogger(() => undefined);

test('a root with $(), backticks, quotes, ; and % runs nothing: the agent command and the launcher pass it literally', { skip: process.platform === 'win32' }, async (t) => {
  const tmp = await useTmpRoot(t);
  const canary = path.join(tmp.root, 'pwned');
  const cli = await tmp.write('ext/dc.mjs', 'console.log(JSON.stringify(process.argv.slice(2)));');
  // Relative `touch pwned`: a folder name cannot hold a slash. The shell runs in tmp.root, so a hit lands on `canary`.
  const root = path.join(tmp.root, `D $(touch pwned) \`touch pwned\` 'q' "dq" ; touch pwned %PATH% !x \\b`);
  await mkdir(root);
  assert.equal(await syncLaunchers({ execPath: process.execPath, cliPath: cli, root, log: quiet, platform: 'linux' }), 'written');
  // The agent pastes the command into its shell: sh -c is what that shell does with it.
  const out = execFileSync('sh', ['-c', checkCommandFor({ root, slug: 'demo', platform: 'linux' })], { encoding: 'utf8', cwd: tmp.root });
  assert.deepEqual(JSON.parse(out), ['--root', root, 'check', 'demo']);
  assert.equal(existsSync(canary), false, 'nothing in the path was executed');
});

test('cmd quoting: % is doubled, everything else cmd treats specially stays inside the quotes', () => {
  assert.equal(quoteCmd('C:\\Users\\a%PATH%b\\D&E|F<G>H^I(J)K!L'), '"C:\\Users\\a%%PATH%%b\\D&E|F<G>H^I(J)K!L"');
  assert.equal(quoteCmd('C:\\Users\\`$(x)`'), '"C:\\Users\\`$(x)`"');
});

test('WebRTC: STUN and TURN to an IP literal never reach a UDP listener', async (t: TestContext) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const hits: string[] = [];
  const socket = createSocket('udp4');
  socket.on('message', (_message, remote) => hits.push(`${remote.address}:${remote.port}`));
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => socket.close(() => resolve())));
  const { port } = socket.address();
  const tmp = await useTmpRoot(t);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>rtc</title></head><body><p>rtc</p><script>
const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${port}' }, { urls: 'turn:127.0.0.1:${port}?transport=udp', username: 'a', credential: 'b' }] });
pc.createDataChannel('d'); pc.createOffer().then((offer) => pc.setLocalDescription(offer));
</script></body></html>`;
  const dir = await tmp.writeDesign('rtc', {
    'design.json': {
      version: 1,
      kind: 'canvas',
      title: 'rtc',
      created: '2026-11-08T10:00:00.000Z',
      updated: '2026-11-08T10:00:00.000Z',
      viewports: [{ id: 'laptop', label: 'Laptop', width: 800, height: 600 }],
      screens: [{ id: 'rtc', title: 'rtc', file: 'screens/rtc.html' }],
      designSystem: { confirmed: false },
    },
    'screens/rtc.html': html,
  });
  await runCheck({
    designDir: dir,
    slug: 'rtc',
    tool: 'cli',
    browserPath,
    probeSource: await probeSource(),
    platform: process.platform,
    isRoot: process.getuid?.() === 0,
    now: () => new Date(),
    budgets: { artboardMs: 15_000, runMs: 60_000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(hits, [], 'no UDP packet from the design left the browser');
});
