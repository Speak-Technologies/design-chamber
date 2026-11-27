// What a check reports doesn't follow the machine's own settings. A Windows machine with animations
// off (CI's Windows Server runner is one) has Chrome report `prefers-reduced-motion: reduce`, and high
// contrast forces colours; the check sets the media features itself. Chrome's
// `--force-prefers-reduced-motion` and `--force-high-contrast` stand in for such a machine.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkBrowserArgs, launchOpenOptions, openCdp } from '../../../src/service/check/cdp.ts';
import { renderArtboards, type PlannedArtboard } from '../../../src/service/check/render.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';

// Readable as written; unreadable only for whoever asks for reduced motion or more contrast.
const DOCUMENT =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Media</title><style>body{margin:0;font:16px/1.5 sans-serif;background:#fff}p{color:#111}@media (prefers-reduced-motion: reduce), (prefers-contrast: more), (forced-colors: active){p{color:#ddd;forced-color-adjust:none}}</style></head><body><main><h1>Plans</h1><p>Everything you need to compare the plans.</p></main></body></html>';

const VIEWPORT = { id: 'laptop', label: 'Laptop', width: 800, height: 600 };
const PLAN: PlannedArtboard[] = [
  { file: 'index.html', screen: null, viewport: VIEWPORT },
  // The dark twin changes the emulation mid-run; the other features must stay as they were set.
  { file: 'index.html', screen: null, viewport: { ...VIEWPORT, id: 'laptop-dark' }, scheme: 'dark' },
];

test('in Chrome: a machine set to reduced motion and high contrast gets the same findings, light and dark', async (t) => {
  const chrome = chromeOrSkip(t);
  if (chrome === null) return;
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'dc-media-'));
  t.after(() => rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const args = checkBrowserArgs({ workDir, platform: process.platform, isRoot: process.getuid?.() === 0, join: path.join });
  const outcome = await renderArtboards({
    openBrowser: (launch) => openCdp(chrome, ['--force-prefers-reduced-motion', '--force-high-contrast', ...args], launchOpenOptions(launch, 20_000)),
    plan: PLAN,
    kind: 'page',
    loadDocument: async () => ({ ok: true, html: DOCUMENT }),
    probeSource: await probeSource(),
    knownExternal: new Set(),
    savePng: async (artboard) => `${artboard.viewport.id}.png`,
  });
  assert.deepEqual(outcome.artboards.map((artboard) => artboard.ok), [true, true]);
  assert.deepEqual(outcome.findings.filter((finding) => finding.code.includes('contrast')), []);
});
