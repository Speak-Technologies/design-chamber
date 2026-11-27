// Compare sheets against a real browser (system-builder-depth T18; skipped, never silent, when none is
// installed). A screen with a PNG of the real app at its laptop width gets compare-home@laptop.png (the
// screen left, the picture right, stitched in Node); a JPEG at a phone width goes through the browser once
// and gets compare-mobile@phone.png; a picture 1440 px wide matches no viewport and is one note. The
// screens' own pictures and findings are as before, and the whole run stays inside its time.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkBrowserArgs, launchOpenOptions, openCdp } from '../../../src/service/check/cdp.ts';
import { CAPTION_BAND, decodePng, encodePng, SIDE_BY_SIDE_GAP } from '../../../src/service/check/png-stitch.ts';
import { cliSystemStore, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const solid = (width: number, height: number, rgb: [number, number, number]): Buffer =>
  encodePng({ width, height, channels: 3, rows: Array.from({ length: height }, () => Buffer.from(Array.from({ length: width }, () => rgb).flat())) });

/** A real JPEG, 390×500 in one green, made by the browser itself (Node has no JPEG encoder). */
const makeJpeg = async (browserPath: string): Promise<Buffer> => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'dc-jpeg-'));
  const session = await openCdp(browserPath, checkBrowserArgs({ workDir, platform: process.platform, isRoot: process.getuid?.() === 0, join: path.join }), launchOpenOptions(undefined, 20_000));
  try {
    const { targetId } = await session.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await session.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    await session.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 500, deviceScaleFactor: 1, mobile: false }, { sessionId });
    await session.send('Page.navigate', { url: 'data:text/html,<body style="margin:0;background:rgb(0,160,0)"></body>' }, { sessionId });
    await session.send('Runtime.evaluate', { expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))', awaitPromise: true }, { sessionId });
    const shot = await session.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 90 }, { sessionId });
    return Buffer.from(shot.data, 'base64');
  } finally {
    await session.close();
    await rm(workDir, { recursive: true, force: true });
  }
};

test('screens with a real-app picture get a compare sheet per matching viewport; another width is a note', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  const jpeg = await makeJpeg(browserPath);
  assert.deepEqual([...jpeg.subarray(0, 2)], [0xff, 0xd8], 'a JPEG');
  const files: Record<string, string | Buffer> = {
    'tokens.css': ':root {\n  --brand: #1a73e8;\n}\n',
    'OVERVIEW.md': 'Calm.',
    'system.json': JSON.stringify({
      version: 1,
      screens: [
        { id: 'home', title: 'Home', kind: 'page', source: 'sources/screens/home.png' },
        { id: 'mobile', title: 'Mobile', kind: 'page', viewports: [{ id: 'phone', label: 'Phone', width: 390, height: 844 }], source: 'sources/screens/mobile.jpg' },
        { id: 'wide', title: 'Wide', kind: 'page', source: 'sources/screens/wide.png' },
        { id: 'long', title: 'Long', kind: 'page', viewports: [{ id: 'phone', label: 'Phone', width: 390, height: 844 }], source: 'sources/screens/long.png' },
      ],
    }),
    '.chamber/state.json': JSON.stringify({ name: 'Acme', status: 'ready' }),
    'screens/home.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Home</title></head><body style="margin:0;background:rgb(200,0,0)"><h1>Home</h1></body></html>',
    'screens/mobile.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mobile</title></head><body style="margin:0"><h1>Mobile</h1></body></html>',
    'screens/wide.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Wide</title></head><body><h1>Wide</h1></body></html>',
    'sources/screens/home.png': solid(1280, 600, [0, 0, 220]),
    'sources/screens/mobile.jpg': jpeg,
    'sources/screens/wide.png': solid(1440, 300, [9, 9, 9]),
    // 1840 px: twenty 92 px rows, each its own shade, so a row shown twice is seen.
    'screens/long.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Long</title></head><body style="margin:0">${Array.from({ length: 20 }, (_, i) => `<div style="height:92px;background:rgb(${i * 12},0,0)"></div>`).join('')}</body></html>`,
    'sources/screens/long.png': solid(390, 400, [0, 0, 99]),
  };
  for (const [rel, body] of Object.entries(files)) await tmp.write(`_systems/acme/${rel}`, body);

  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const started = Date.now();
    const result = await runSystemCheck(store, 'acme', {
      now: new Date(),
      tool: 'cli',
      render: { browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0 },
    });
    const elapsed = Date.now() - started;
    const render = result.report.render;
    assert.ok(render !== null);
    assert.ok(render.screens !== undefined);
    assert.ok(render.screens.artboards.every((artboard) => artboard.ok), JSON.stringify(render.findings));

    const sheets = render.compares ?? [];
    assert.deepEqual(sheets.map((sheet) => [sheet.screen, sheet.viewport, sheet.source]), [
      ['home', 'laptop', 'sources/screens/home.png'],
      ['mobile', 'phone', 'sources/screens/mobile.jpg'],
      ['long', 'phone', 'sources/screens/long.png'],
    ]);
    for (const sheet of sheets) {
      assert.match(sheet.png, new RegExp(`compare-${sheet.screen}@${sheet.viewport}\\.png$`));
      assert.ok(result.pngs.some((png) => png.endsWith(path.basename(sheet.png))), `${sheet.png} is kept`);
    }
    const home = decodePng(await readFile(tmp.at(`_systems/acme/${sheets[0]?.png ?? ''}`)));
    assert.equal(home.width, 1280 + SIDE_BY_SIDE_GAP + 1280);
    assert.equal(home.height, CAPTION_BAND + 800, 'the screen is a viewport tall, the picture shorter, under the captions');
    const at = (image: typeof home, x: number, y: number): number[] => [...(image.rows[CAPTION_BAND + y]?.subarray(x * image.channels, x * image.channels + 3) ?? [])];
    assert.deepEqual(at(home, 1000, 400), [200, 0, 0], 'the drawn screen on the left');
    assert.deepEqual(at(home, 1280 + SIDE_BY_SIDE_GAP + 100, 100), [0, 0, 220], 'the real app on the right');
    assert.deepEqual(at(home, 1280 + SIDE_BY_SIDE_GAP + 100, 700), [255, 255, 255], 'padded below the shorter picture');

    const mobile = decodePng(await readFile(tmp.at(`_systems/acme/${sheets[1]?.png ?? ''}`)));
    assert.equal(mobile.width, 390 + SIDE_BY_SIDE_GAP + 390);
    const [r, g, b] = at(mobile, 390 + SIDE_BY_SIDE_GAP + 200, 250);
    assert.ok(Math.abs((r ?? 0) - 0) < 12 && Math.abs((g ?? 0) - 160) < 12 && Math.abs((b ?? 0) - 0) < 12, `the JPEG drawn by the browser: ${r},${g},${b}`);

    // The long page once: 1840 px, each 92 px row in its own shade, top to bottom, none repeated.
    const long = decodePng(await readFile(tmp.at(`_systems/acme/${sheets[2]?.png ?? ''}`)));
    assert.equal(long.height, CAPTION_BAND + 1840);
    for (let row = 0; row < 20; row += 1) assert.deepEqual(at(long, 100, row * 92 + 46), [row * 12, 0, 0], `row ${row + 1} where it belongs`);

    const notes = render.findings.filter((finding) => finding.code === 'system-compare-skipped');
    assert.deepEqual(notes.map((finding) => [finding.screen, finding.params]), [['wide', { px: 1440 }]]);
    // The screens' budget (40 s of the 110 s) holds with the sheets in it, and so does the whole run.
    assert.ok(elapsed < 110_000, `${elapsed} ms`);
  } finally {
    await store.dispose();
  }
});
