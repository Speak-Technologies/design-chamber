// System screens in the system check, against a real browser (documentation/specs/system-builder-depth.md
// §4.6, §13 T12b; skipped, never silent, when none is installed). A screen linking the system's tokens is
// drawn at its viewports with the design checks: a phone overflow is found with the screen's file; the
// dark pass emulates `prefers-color-scheme: dark`, so the tokens' dark values apply (a dark-only contrast
// failure is found on the dark twin alone); the pictures are named per screen and viewport and on disk.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { cliSystemStore, runSystemCheck, type SystemRenderInput } from '../../../src/service/check/system-run.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

// Light: near-black on white. Dark: dark grey on near-black, well under 4.5:1, so only the dark twin fails.
const TOKENS = ':root {\n  --bg: #ffffff;\n  --fg: #111111;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --bg: #111111; --fg: #333333; }\n}\n';

const HOME =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="../tokens.css">' +
  '<style>html, body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 sans-serif; } .wide { width: 600px; height: 40px; }</style></head>' +
  '<body><p>Plain words to read on the page.</p><div class="wide"></div></body></html>';

const writeSystem = async (tmp: TmpRoot): Promise<void> => {
  await tmp.write('_systems/acme/.chamber/state.json', JSON.stringify({ name: 'Acme', status: 'draft' }));
  await tmp.write('_systems/acme/tokens.css', TOKENS);
  await tmp.write('_systems/acme/OVERVIEW.md', 'Calm.');
  await tmp.write(
    '_systems/acme/system.json',
    JSON.stringify({ tokens: { '--bg': { group: 'surface' }, '--fg': { group: 'text' } }, screens: [{ id: 'home', title: 'Home', kind: 'page', viewports: [{ id: 'phone', label: 'Phone', width: 390, height: 844 }] }] }),
  );
  await tmp.write('_systems/acme/screens/home.html', HOME);
};

const check = async (tmp: TmpRoot, browserPath: string, over: Partial<SystemRenderInput>) => {
  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    return await runSystemCheck(store, 'acme', {
      now: new Date(),
      tool: 'cli',
      render: { browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0, ...over },
    });
  } finally {
    await store.dispose();
  }
};

test('a screen at its phone viewport: overflow found, the dark pass applies the dark tokens, pictures named per viewport', { timeout: 120_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  await writeSystem(tmp);

  const { report, pngs } = await check(tmp, browserPath, { screens: ['home'] });
  const render = report.render;
  assert.ok(render !== null && render.screens !== undefined);
  assert.equal(render.state, 'done', JSON.stringify(render.findings));
  assert.deepEqual(render.screens.artboards.map((artboard) => [artboard.viewport, artboard.ok]), [['phone', true], ['phone-dark', true]]);

  const screenFindings = render.findings.filter((finding) => finding.file === 'screens/home.html');
  const overflow = screenFindings.filter((finding) => finding.code === 'overflow-x');
  // The phone overflow on the light artboard; the dark twin's repeat is dropped.
  assert.deepEqual(overflow.map((finding) => finding.viewport), ['phone'], JSON.stringify(screenFindings));
  // Contrast fails on the dark twin only: the browser applied `prefers-color-scheme: dark` to the screen.
  const contrast = screenFindings.filter((finding) => finding.code === 'contrast');
  assert.ok(contrast.length > 0, JSON.stringify(screenFindings));
  assert.ok(contrast.every((finding) => finding.viewport === 'phone-dark'), JSON.stringify(contrast));

  const names = pngs.map((png) => path.basename(png));
  assert.ok(names.includes('screen-home@phone.png'), names.join(' '));
  assert.ok(names.includes('screen-home@phone-dark.png'), names.join(' '));
  for (const png of pngs) assert.ok(existsSync(png), png);
});

test('a full check draws the board, then the screens, in one run folder', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  await writeSystem(tmp);

  const { report, pngs } = await check(tmp, browserPath, { budgets: { boardMs: 30_000 } });
  const render = report.render;
  assert.ok(render !== null && render.screens !== undefined);
  assert.equal(render.state, 'done', JSON.stringify(render.findings));
  assert.deepEqual(render.widths.map((width) => width.viewport), ['wide', 'narrow', 'wide-dark']);
  assert.deepEqual(render.screens.artboards.map((artboard) => artboard.viewport), ['phone', 'phone-dark']);
  assert.equal(new Set(pngs.map((png) => path.dirname(png))).size, 1);
  assert.ok(pngs.some((png) => path.basename(png) === 'screen-home@phone.png'));
});

test('--scheme light: the same screen has no dark twin and no contrast failure', { timeout: 120_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  await writeSystem(tmp);

  const { report } = await check(tmp, browserPath, { screens: ['home'], scheme: 'light' });
  const render = report.render;
  assert.ok(render !== null && render.screens !== undefined);
  assert.deepEqual(render.screens.artboards.map((artboard) => artboard.viewport), ['phone']);
  assert.deepEqual(render.findings.filter((finding) => finding.code === 'contrast'), []);
});
