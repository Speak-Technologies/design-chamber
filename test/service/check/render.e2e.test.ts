// The render engine against a real browser (skipped, never silent, when none is installed).
// One canvas design carries one screen per behaviour; the local TCP listener proves nothing
// the page tried to reach left the browser.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { formatCheckText } from '../../../src/service/check/report-text.ts';
import { CheckInterrupted, runCheck, type RunCheckResult } from '../../../src/service/check/engine.ts';
import { PNG_SIGNATURE_BYTES } from './png.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const head = (title: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{margin:0;font:16px/1.5 sans-serif;color:#111;background:#fff}</style>`;
const page = (title: string, body: string, extraHead = ''): string => `${head(title)}${extraHead}</head><body>${body}</body></html>`;

const listen = async (t: TestContext): Promise<{ port: number; hits: string[]; server: Server }> => {
  const hits: string[] = [];
  const server = createServer((socket) => {
    hits.push(`${socket.remoteAddress ?? '?'}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  return { port: typeof address === 'object' && address !== null ? address.port : 0, hits, server };
};

const designJson = (ids: string[], viewports = [{ id: 'laptop', label: 'Laptop', width: 800, height: 600 }]): Record<string, unknown> => ({
  version: 1,
  kind: 'canvas',
  title: 'E2E',
  created: '2026-11-08T10:00:00.000Z',
  updated: '2026-11-08T10:00:00.000Z',
  viewports,
  screens: ids.map((id) => ({ id, title: id, file: `screens/${id}.html` })),
  designSystem: { confirmed: false },
});

const run = async (t: TestContext, files: Record<string, string>, ids: string[], options: { viewports?: { id: string; label: string; width: number; height: number }[]; artboardMs?: number } = {}): Promise<{ result: RunCheckResult; dir: string; tmp: Awaited<ReturnType<typeof useTmpRoot>> }> => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) throw new Error('skipped');
  const tmp = await useTmpRoot(t);
  const designFiles: Record<string, string | object> = { 'design.json': designJson(ids, options.viewports) };
  for (const [name, text] of Object.entries(files)) designFiles[name] = text;
  const dir = await tmp.writeDesign('e2e', designFiles);
  const result = await runCheck({
    designDir: dir,
    slug: 'e2e',
    tool: 'cli',
    browserPath,
    probeSource: await probeSource(),
    platform: process.platform,
    isRoot: process.getuid?.() === 0,
    now: () => new Date(),
    budgets: { artboardMs: options.artboardMs ?? 15_000, runMs: 120_000 },
  });
  return { result, dir, tmp };
};

const codes = (result: RunCheckResult, screen: string | null = null): string[] =>
  (result.report.render?.findings ?? []).filter((finding) => screen === null || finding.screen === screen).map((finding) => finding.code);

test('measures overflow, contrast, alt text, labels and names, and saves real PNGs', async (t) => {
  const { result, dir } = await run(
    t,
    {
      'screens/wide.html': page('wide', '<div id="w" style="width:1200px;height:40px;background:#cde">wide</div>'),
      'screens/pale.html': page('pale', '<p id="p" style="color:#aaa">Pale text that fails AA</p><p style="color:#111">Dark text that passes</p>'),
      'screens/a11y.html': page('a11y', '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="><input id="f" type="text"><button class="x"></button><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">'),
      'screens/ok.html': page('ok', '<h1>Hello</h1><p>All good here.</p><label for="e">Email</label><input id="e" type="email"><button>Save</button>'),
    },
    ['wide', 'pale', 'a11y', 'ok'],
  );
  assert.ok(codes(result, 'wide').includes('overflow-x'));
  const overflow = result.report.render?.findings.find((finding) => finding.code === 'overflow-x');
  assert.equal(overflow?.params?.px, 1200);
  assert.equal(overflow?.selector, '#w');
  assert.ok(codes(result, 'pale').includes('contrast'));
  assert.equal(codes(result, 'pale').filter((code) => code === 'contrast').length, 1, 'the dark paragraph passes');
  assert.deepEqual(codes(result, 'a11y').filter((code) => code !== 'page-height').sort(), ['button-name', 'control-label', 'img-alt']);
  assert.deepEqual(codes(result, 'ok').filter((code) => code !== 'page-height'), []);
  assert.equal(result.report.render?.state, 'done');
  assert.equal(result.report.render?.artboards.length, 4);
  assert.equal(result.pngs.length, 4);
  for (const png of result.pngs) {
    const bytes = await readFile(png);
    assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE_BYTES);
    assert.equal(bytes.readUInt32BE(16), 800, 'the screenshot is the viewport wide');
    assert.ok(png.startsWith(path.join(dir, '.chamber', 'check')));
  }
  assert.ok((await readdir(path.join(dir, '.chamber'))).includes('check.json'));
  assert.deepEqual((await readdir(path.join(dir, '.chamber'))).filter((name) => name.startsWith('dc-check-')), [], 'the throwaway profile is removed');
});

test('a sandboxed script behaves as in the wall: localStorage and errors are console-errors', async (t) => {
  const { result } = await run(
    t,
    {
      'screens/ls.html': page('ls', '<p>storage</p><script>localStorage.setItem("a","b")</script>'),
      'screens/boom.html': page('boom', '<p>boom</p><script>setTimeout(function(){ throw new Error("deliberate failure") }, 10)</script>'),
      'screens/quiet.html': page('quiet', '<p>quiet</p><script>var n = 1 + 1;</script>'),
    },
    ['ls', 'boom', 'quiet'],
  );
  const ls = result.report.render?.findings.find((finding) => finding.code === 'console-error' && finding.screen === 'ls');
  assert.ok(ls, 'localStorage in an opaque origin throws');
  assert.match(ls.detail ?? '', /localStorage|storage|SecurityError/i);
  assert.match(result.report.render?.findings.find((finding) => finding.code === 'console-error' && finding.screen === 'boom')?.detail ?? '', /deliberate failure/);
  assert.ok(!codes(result, 'quiet').includes('console-error'));
});

test('a relative image outside the screen folder renders; a missing one is reported once, statically', async (t) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('e2e', {
    'design.json': designJson(['home']),
    'assets/pic.png': png,
    'screens/home.html': page('home', '<img id="i" alt="pic" src="../assets/pic.png"><script>window.onload=function(){ if (!document.getElementById("i").naturalWidth) console.error("image did not load") }</script>'),
  });
  const result = await runCheck({ designDir: dir, slug: 'e2e', tool: 'cli', browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0, now: () => new Date() });
  assert.ok(!codes(result).includes('console-error'), 'the image was inlined and loaded');
  assert.ok(!result.report.static.findings.some((finding) => finding.code === 'ref-missing'));
});

test('a remote font and image are blocked: reported statically, never fetched, not double-reported', async (t) => {
  const { result } = await run(
    t,
    {
      'screens/remote.html': page('remote', '<p style="font-family:Inter, sans-serif">Remote</p><img alt="x" src="https://example.com/a.png">', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'),
    },
    ['remote'],
  );
  const staticRemote = result.report.static.findings.filter((finding) => finding.code === 'remote-ref');
  assert.equal(staticRemote.length, 2);
  assert.ok(!codes(result).includes('request-blocked'), 'the static remote-ref already names them');
  assert.ok(!codes(result).includes('console-error'), 'a blocked remote file is not also a script error');
});

test('network: a fetch, an image, a WebSocket and a stylesheet to an IP literal never reach a listener', async (t) => {
  const { port, hits } = await listen(t);
  const base = `http://127.0.0.1:${port}`;
  const dynamic = `<script>
    fetch('${base}/api').catch(function(){});
    try { var ws = new WebSocket('ws://127.0.0.1:${port}/ws'); } catch (e) {}
    var i = new Image(); i.src = '${base}/dyn.png';
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '${base}/dyn.css'; document.head.appendChild(l);
    var x = new XMLHttpRequest(); x.open('GET', '${base}/xhr'); try { x.send(); } catch (e) {}
    navigator.sendBeacon && navigator.sendBeacon('${base}/beacon', 'x');
  </script>`;
  const { result } = await run(
    t,
    { 'screens/net.html': page('net', `<p>net</p><img alt="" src="${base}/img.png"><iframe src="${base}/frame" title="f"></iframe>${dynamic}`, `<link rel="stylesheet" href="${base}/x.css">`) },
    ['net'],
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(hits, [], 'no connection reached the local listener');
  assert.ok(result.report.render?.artboards[0]?.ok, 'the artboard still rendered');
});

test('alert() and confirm() are ignored by the sandbox as in the wall, noted once, and never block the run', async (t) => {
  const { result } = await run(t, { 'screens/dialog.html': page('dialog', '<p>dialog</p><script>alert("hi"); confirm("sure?"); document.title = "after dialogs";</script>') }, ['dialog']);
  assert.equal(result.report.render?.artboards[0]?.ok, true);
  assert.equal(codes(result).filter((code) => code === 'dialog-opened').length, 1);
  assert.ok(!codes(result).includes('console-error'), 'an ignored dialog is its own note, not a script error');
});

test('a script that never returns times out, and the next artboard still renders', async (t) => {
  const { result } = await run(
    t,
    {
      'screens/hang.html': page('hang', '<p>hang</p><script>while (true) {}</script>'),
      'screens/after.html': page('after', '<h1>Still here</h1>'),
    },
    ['hang', 'after'],
    { artboardMs: 2500 },
  );
  assert.ok(codes(result, 'hang').includes('render-timeout'));
  const after = result.report.render?.artboards.find((artboard) => artboard.screen === 'after');
  assert.equal(after?.ok, true, 'the browser recovered');
  assert.equal(result.report.render?.state, 'partial');
});

test('a page that reloads itself forever does not hang the run', async (t) => {
  const { result } = await run(
    t,
    {
      'screens/reload.html': page('reload', '<p>reload</p><script>setTimeout(function(){ location.reload() }, 20)</script>'),
      'screens/after.html': page('after', '<h1>Still here</h1>'),
    },
    ['reload', 'after'],
    { artboardMs: 4000 },
  );
  assert.equal(result.report.render?.artboards.find((artboard) => artboard.screen === 'after')?.ok, true);
});

test('a tall page is captured in slices and the page height is reported', async (t) => {
  const { result } = await run(t, { 'screens/tall.html': page('tall', '<div style="height:1700px;background:linear-gradient(#fff,#ccf)">tall</div>') }, ['tall']);
  const artboard = result.report.render?.artboards[0];
  assert.equal(artboard?.pngs.length, 3);
  assert.equal(artboard?.docHeight, 1700);
  assert.ok(artboard?.pngs[1]?.endsWith('tall@laptop-2.png'));
  assert.equal(codes(result).includes('page-height'), true);
});

test('a page at two viewports gets two artboards, and phone width catches a desktop-only layout', async (t) => {
  const { result } = await run(
    t,
    { 'screens/home.html': page('home', '<div style="width:700px">fixed width</div>') },
    ['home'],
    { viewports: [{ id: 'laptop', label: 'Laptop', width: 1000, height: 600 }, { id: 'phone', label: 'Phone', width: 390, height: 700 }] },
  );
  assert.equal(result.report.render?.artboards.length, 2);
  assert.ok((result.report.render?.findings ?? []).some((finding) => finding.code === 'overflow-x' && finding.viewport === 'phone'));
  assert.ok(!(result.report.render?.findings ?? []).some((finding) => finding.code === 'overflow-x' && finding.viewport === 'laptop'));
});

test('an interrupt frees the screen it is on at once, writes no report and leaves no run folder', async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('e2e', {
    'design.json': designJson(['hang', 'after']),
    'screens/hang.html': page('hang', '<p>hang</p><script>while (true) {}</script>'),
    'screens/after.html': page('after', '<h1>after</h1>'),
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 1500);
  const started = Date.now();
  await assert.rejects(
    async () =>
      runCheck({ designDir: dir, slug: 'e2e', tool: 'cli', browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0, now: () => new Date(), signal: controller.signal, budgets: { artboardMs: 30_000, runMs: 120_000 } }),
    (error: unknown) => error instanceof CheckInterrupted && error.message === 'The check was interrupted, so no report was saved.',
  );
  assert.ok(Date.now() - started < 8000, `the interrupt waited for the artboard timeout (${Date.now() - started} ms)`);
  const left = await readdir(path.join(dir, '.chamber')).catch((): string[] => []);
  assert.ok(!left.includes('check.json'), 'no report that could read as a clean result');
  assert.deepEqual(await readdir(path.join(dir, '.chamber', 'check')).catch((): string[] => []), [], 'no half-written run folder');
  assert.deepEqual(left.filter((name) => name.startsWith('dc-check-')), []);
});

test('screens past the 24-artboard limit are noted with that reason, and a spent time budget says so', async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  const ids = Array.from({ length: 26 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  const files: Record<string, string> = {};
  for (const id of ids) files[`screens/${id}.html`] = page(id, `<p>${id}</p>`);
  const dir = await tmp.writeDesign('e2e', { 'design.json': designJson(ids), ...files });
  const base = { designDir: dir, slug: 'e2e', tool: 'cli' as const, browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0, now: () => new Date() };
  const limited = await runCheck({ ...base, budgets: { artboardMs: 15_000, runMs: 120_000 } });
  const note = limited.report.render?.findings.find((finding) => finding.code === 'render-skipped');
  assert.deepEqual(note?.params, { count: 2, max: 24, reason: 'limit' });
  assert.equal(limited.report.render?.artboards.length, 24);
  assert.equal(limited.report.render?.skipped, 2);
  assert.equal(limited.report.render?.state, 'partial');

  const budget = await runCheck({ ...base, screens: ids.slice(0, 5), budgets: { artboardMs: 15_000, runMs: 1 } });
  const spent = budget.report.render?.findings.filter((finding) => finding.code === 'render-skipped');
  assert.equal(spent?.length, 1);
  assert.equal(spent?.[0]?.params?.reason, 'budget');
  assert.ok((spent?.[0]?.params?.count ?? 0) >= 1);
});

test('a tall screen that times out after saving a slice does not shift the picture list: every caption names its own file', async (t) => {
  const { result, dir } = await run(
    t,
    {
      // Slice 1 is captured at scroll 0; scrolling for slice 2 starts a script that never returns.
      'screens/stuck.html': page('stuck', '<div style="height:1700px;background:linear-gradient(#fff,#ccf)">tall</div><script>addEventListener("scroll", function(){ while (true) {} })</script>'),
      'screens/good.html': page('good', '<div style="height:1700px;background:linear-gradient(#fff,#cfc)">good</div>'),
    },
    ['stuck', 'good'],
    { artboardMs: 3000 },
  );
  const artboards = result.report.render?.artboards ?? [];
  assert.equal(artboards.find((artboard) => artboard.screen === 'stuck')?.ok, false);
  assert.deepEqual(artboards.find((artboard) => artboard.screen === 'stuck')?.pngs, []);
  const good = artboards.find((artboard) => artboard.screen === 'good');
  assert.equal(good?.pngs.length, 3);
  // The run list is exactly the good artboard's three files, in order, and they exist; the orphan slice is gone.
  assert.deepEqual(result.pngs, (good?.pngs ?? []).map((rel) => path.join(dir, ...rel.split('/'))));
  const runFolder = path.dirname(result.pngs[0] ?? '');
  assert.deepEqual((await readdir(runFolder)).sort(), ['good@laptop-2.png', 'good@laptop-3.png', 'good@laptop.png']);
  const text = formatCheckText({ report: result.report, design: result.design, pngs: result.pngs, reportPath: result.reportPath });
  const lines = text.split('\n').filter((line) => line.includes('.png'));
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? '', /good@laptop\.png {2}800x600, page 1700px tall \(3 images\)/);
});
