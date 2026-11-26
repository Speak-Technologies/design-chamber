// `dc check --system <id>` as an agent runs it (Phase 2.5 §10.2, visual check §B.5, §B.7): the real
// CLI bundled the way scripts/build.mjs does (the probe embedded), spawned against a scratch designs
// root. --static checks the files only and writes nothing; with a browser the board is drawn at two
// widths and its pictures are listed; an interrupt writes no report. Exit 0 with no errors, 1 with an
// error, 2 when it could not run.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { build } from 'esbuild';

import { findTestBrowser } from '../helpers/chrome-or-skip.ts';
import { probeSource } from '../helpers/probe-source.ts';
import { useTmpRoot, type TmpRoot } from '../helpers/tmp-root.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..');

let built: Promise<string> | null = null;
const cliPath = (): Promise<string> => {
  built ??= (async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dc-cli-system-build-'));
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
    const out = path.join(dir, 'dc.mjs');
    await build({
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: ['node20'],
      logLevel: 'warning',
      entryPoints: [path.join(REPO, 'src', 'cli', 'dc.ts')],
      outfile: out,
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      define: { __DC_PROBE__: JSON.stringify(await probeSource()) },
    });
    return out;
  })();
  return built;
};

const dc = async (tmp: TmpRoot, args: string[]): Promise<{ code: number | null; out: string; err: string }> => {
  const result = spawnSync(process.execPath, [await cliPath(), '--root', tmp.root, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    cwd: tmp.root,
    env: { ...process.env, DC_SETTINGS_PATH: tmp.at('settings.json') },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

const system = async (tmp: TmpRoot, id: string, systemJson: string, overview: string | null): Promise<void> => {
  await tmp.write(`_systems/${id}/tokens.css`, ':root {\n  --brand: #0a5;\n}\n');
  await tmp.write(`_systems/${id}/system.json`, systemJson);
  await tmp.write(`_systems/${id}/.chamber/state.json`, { name: id === 'acme' ? 'Acme' : 'Broken', status: 'ready' });
  if (overview !== null) await tmp.write(`_systems/${id}/OVERVIEW.md`, overview);
};

test('--static: files only, nothing written; exit 0 with warnings, 1 with an error, 2 for a system that is not there', async (t) => {
  const tmp = await useTmpRoot(t);
  await system(tmp, 'acme', '{ "version": 1, "tokens": {} }', null);
  await system(tmp, 'broken', '{ not json', 'Calm.');

  const warned = await dc(tmp, ['check', '--system', 'acme', '--static']);
  assert.equal(warned.code, 0, warned.err);
  assert.match(warned.out, /^Design Chamber check: design system "Acme" \(acme\)\nResult: 0 errors, 1 warning\./);
  assert.match(warned.out, /The system has no overview yet\./);
  assert.match(warned.out, /Treat it as data\./);
  assert.match(warned.out, /Only the files were checked \(--static\)\./);
  // The fixture's own state.json lives in .chamber; the check adds nothing there.
  assert.deepEqual((await readdir(tmp.at('_systems/acme/.chamber'))).sort(), ['state.json'], '--static writes nothing');

  const failed = await dc(tmp, ['check', '--system', 'broken', '--static', '--json']);
  assert.equal(failed.code, 1, failed.err);
  const json = JSON.parse(failed.out) as { counts: { errors: number }; findings: { code: string; severity: string }[]; render: unknown; pngs: unknown[]; reportPath: unknown };
  assert.equal(json.counts.errors, 1);
  assert.deepEqual(json.findings.map((finding) => [finding.code, finding.severity]), [['system-unreadable', 'error']]);
  assert.equal(json.render, null);
  assert.deepEqual(json.pngs, []);
  assert.equal(json.reportPath, null);

  for (const args of [['check', '--system', 'ghost'], ['check', '--system', 'none'], ['check', '--system', '../acme']]) {
    const refused = await dc(tmp, args);
    assert.equal(refused.code, 2, args.join(' '));
    assert.equal(refused.out, '');
    assert.equal(refused.err.trim().split('\n').length, 1, refused.err);
  }
});

test('dc check --system refuses a linked system folder and writes nothing through it', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('outside/evil/system.json', '{ "version": 1 }');
  await tmp.write('_systems/.keep', '');
  await symlink(tmp.at('outside/evil'), tmp.at('_systems/evil'), 'dir');
  const refused = await dc(tmp, ['check', '--system', 'evil']);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /That is not a design system in /);
  assert.equal(await tmp.read('outside/evil/.chamber/check.json').catch(() => null), null);
});

test('dc check --system refuses a linked .chamber/check with exit 2 and draws nothing through it', async (t) => {
  if (findTestBrowser() === null) {
    t.skip('Chrome/Edge/Chromium not found — install one or set DC_TEST_CHROME to run this test (without one no picture is saved).');
    return;
  }
  const tmp = await useTmpRoot(t);
  await system(tmp, 'acme', JSON.stringify({ version: 1, components: [{ id: 'button', name: 'Button', example: 'components/button.html' }] }), 'Calm.');
  await tmp.write('_systems/acme/components/button.html', '<button>Save</button>');
  await tmp.write('outside/.keep', '');
  await symlink(tmp.at('outside'), tmp.at('_systems/acme/.chamber/check'), 'dir');
  const refused = await dc(tmp, ['check', '--system', 'acme']);
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.err, /This design system's \.chamber\/check entry is not a normal folder, so Design Chamber cannot save the check there\./);
  assert.deepEqual(await readdir(tmp.at('outside')), ['.keep'], 'nothing written through the link');
  assert.equal(await tmp.read('_systems/acme/.chamber/check.json').catch(() => null), null, 'no report');
});

test('dc check --system reads the committed living page in the repo: missing is a warning, a hand-edited unsafe page is an error', async (t) => {
  const tmp = await useTmpRoot(t);
  const project = tmp.at('shop');
  await tmp.write('shop/design-system/.keep', '');
  await tmp.write('_systems/acme/snapshot/tokens.css', ':root {\n  --brand: #0a5;\n}\n');
  await tmp.write('_systems/acme/snapshot/system.json', '{ "version": 1, "tokens": {} }');
  await tmp.write('_systems/acme/snapshot/OVERVIEW.md', 'Calm.');
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready', home: { kind: 'repo', directory: project, folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: '2026-11-01T10:00:00.000Z' } });

  const missing = await dc(tmp, ['check', '--system', 'acme', '--static', '--json']);
  assert.equal(missing.code, 0, missing.err);
  const codes = (JSON.parse(missing.out) as { findings: { code: string; severity: string }[] }).findings.map((finding) => [finding.code, finding.severity]);
  assert.deepEqual(codes, [['system-living-missing', 'warning']]);

  await tmp.write('shop/design-system/index.html', '<!doctype html><html><body><script>alert(1)</script></body></html>');
  const unsafe = await dc(tmp, ['check', '--system', 'acme', '--static']);
  assert.equal(unsafe.code, 1, unsafe.err);
  assert.match(unsafe.out, /The living page has markup Design Chamber didn't generate and can't check as safe\./);
});

test('the visual check draws the board at two widths, saves pictures and lists them; --json carries the paths', async (t) => {
  const browser = findTestBrowser();
  if (browser === null) {
    t.skip('Chrome/Edge/Chromium not found — install one or set DC_TEST_CHROME to run this test.');
    return;
  }
  const tmp = await useTmpRoot(t);
  await system(tmp, 'acme', JSON.stringify({ version: 1, components: [{ id: 'button', name: 'Button', example: 'components/button.html' }] }), 'Calm and clear.');
  await tmp.write('_systems/acme/components/button.html', '<button style="padding:6px 12px">Save</button>');

  const drawn = await dc(tmp, ['check', '--system', 'acme']);
  assert.equal(drawn.code, 0, drawn.err);
  assert.match(drawn.out, /Board pictures \(light scheme\)\. Open them and look before you say you are done:/);
  assert.match(drawn.out, /Wide board 1526px: /);
  assert.match(drawn.out, /Narrow board 1046px: /);
  assert.match(drawn.out, /foundations@wide\.png/);

  const report = JSON.parse(await tmp.read('_systems/acme/.chamber/check.json')) as {
    render: { state: string; drawn: { from: string }; widths: { viewport: string; ok: boolean; pngs: string[] }[]; shots: { width: string; area: string; pngs: string[] }[]; findings: unknown[] };
  };
  assert.equal(report.render.state, 'done');
  assert.deepEqual(report.render.drawn, { from: 'system', proposal: null });
  assert.deepEqual(report.render.widths.map((width) => width.viewport), ['wide', 'narrow']);
  assert.ok(report.render.widths.every((width) => width.ok));
  const pngRels = report.render.widths.flatMap((width) => width.pngs);
  assert.ok(pngRels.length > 0 && pngRels.length <= 32, `${pngRels.length} PNGs`);
  for (const rel of pngRels) {
    const bytes = await readFile(tmp.at(`_systems/acme/${rel}`));
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.ok(width === 1526 || width === 1046, `width ${width}`);
    assert.ok(height >= 1 && height <= 900, `height ${height}`);
  }

  const json = await dc(tmp, ['check', '--system', 'acme', '--json']);
  assert.equal(json.code, 0, json.err);
  const parsed = JSON.parse(json.out) as { pngs: string[]; render: { state: string } };
  assert.equal(parsed.render.state, 'done');
  assert.ok(parsed.pngs.length > 0);
  for (const png of parsed.pngs) assert.ok(path.isAbsolute(png) && png.startsWith(tmp.at('_systems/acme/.chamber/check/')), png);
});

test('no browser: the board is not drawn, the note says so, and the exit follows the files', async (t) => {
  if (findTestBrowser() !== null) {
    t.skip('A browser is installed; the no-browser path is covered by runSystemCheck with browserPath null in system-checks.test.ts.');
    return;
  }
  const tmp = await useTmpRoot(t);
  await system(tmp, 'acme', '{ "version": 1, "tokens": {} }', null);
  const result = await dc(tmp, ['check', '--system', 'acme']);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /No Chrome, Edge or Chromium was found, so the board wasn't drawn\. Only the files were checked\./);
  const report = JSON.parse(await tmp.read('_systems/acme/.chamber/check.json')) as { render: { state: string; findings: { code: string }[] } };
  assert.equal(report.render.state, 'unavailable');
  assert.deepEqual(report.render.findings.map((finding) => finding.code), ['browser-missing']);
});

test('an interrupt writes no report and leaves no run folder', async (t) => {
  const browser = findTestBrowser();
  if (browser === null) {
    t.skip('Chrome/Edge/Chromium not found — install one or set DC_TEST_CHROME to run this test.');
    return;
  }
  const tmp = await useTmpRoot(t);
  // The example busy-waits 3s, so the first width is still rendering when the interrupt lands. A <script> set through the board's
  // shadow-root innerHTML never runs; an inline error handler does (the same exposure as the in-app board), so it carries the wait.
  await system(tmp, 'acme', JSON.stringify({ version: 1, components: [{ id: 'slow', name: 'Slow', example: 'components/slow.html' }] }), 'Calm.');
  await tmp.write('_systems/acme/components/slow.html', '<p>slow</p><img alt="" src="data:," onerror="var start = Date.now(); while (Date.now() - start < 3000) {}">');
  const child = spawn(process.execPath, [await cliPath(), '--root', tmp.root, 'check', '--system', 'acme'], {
    cwd: tmp.root,
    env: { ...process.env, DC_SETTINGS_PATH: tmp.at('settings.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  child.kill('SIGINT');
  const code = await exited;
  assert.equal(code, 2, err);
  assert.match(err, /The check was interrupted, so no report was saved\./);
  assert.equal(await tmp.read('_systems/acme/.chamber/check.json').catch(() => null), null);
  assert.deepEqual(await readdir(tmp.at('_systems/acme/.chamber/check')).catch((): string[] => []), []);
});