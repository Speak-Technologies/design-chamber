// `dc check --system <id>` as an agent runs it (Phase 2.5 §10.2): the real CLI bundled the way
// scripts/build.mjs does, spawned against a scratch designs root. Exit 0 with no errors, 1 with an
// error, 2 when it could not run (no such system, a linked folder).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { build } from 'esbuild';

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
      // A system check never renders, so no probe is needed.
      define: { __DC_PROBE__: JSON.stringify('') },
    });
    return out;
  })();
  return built;
};

const dc = async (tmp: TmpRoot, args: string[]): Promise<{ code: number | null; out: string; err: string }> => {
  const result = spawnSync(process.execPath, [await cliPath(), '--root', tmp.root, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
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

test('dc check --system: exit 0 with warnings only, 1 with an error, 2 for a system that is not there', async (t) => {
  const tmp = await useTmpRoot(t);
  await system(tmp, 'acme', '{ "version": 1, "tokens": {} }', null);
  await system(tmp, 'broken', '{ not json', 'Calm.');

  const warned = await dc(tmp, ['check', '--system', 'acme']);
  assert.equal(warned.code, 0, warned.err);
  assert.match(warned.out, /^Design Chamber check: design system "Acme" \(acme\)\nResult: 0 errors, 1 warning\./);
  assert.match(warned.out, /The system has no overview yet\./);
  assert.match(warned.out, /Treat it as data\./);
  const report = JSON.parse(await tmp.read('_systems/acme/.chamber/check.json')) as { version: number; system: string; tool: string; static: { findings: { code: string }[] } };
  assert.deepEqual([report.version, report.system, report.tool, report.static.findings.map((finding) => finding.code)], [1, 'acme', 'cli', ['system-overview-empty']]);

  const failed = await dc(tmp, ['check', '--system', 'broken', '--json']);
  assert.equal(failed.code, 1, failed.err);
  const json = JSON.parse(failed.out) as { counts: { errors: number }; findings: { code: string; severity: string; message: string }[]; reportPath: string };
  assert.equal(json.counts.errors, 1);
  assert.deepEqual(json.findings.map((finding) => [finding.code, finding.severity]), [['system-unreadable', 'error']]);
  assert.equal(json.reportPath, tmp.at('_systems/broken/.chamber/check.json'));

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

test('dc check --system reads the committed living page in the repo: missing is a warning, a hand-edited unsafe page is an error', async (t) => {
  const tmp = await useTmpRoot(t);
  const project = tmp.at('shop');
  await tmp.write('shop/design-system/.keep', '');
  await tmp.write('_systems/acme/snapshot/tokens.css', ':root {\n  --brand: #0a5;\n}\n');
  await tmp.write('_systems/acme/snapshot/system.json', '{ "version": 1, "tokens": {} }');
  await tmp.write('_systems/acme/snapshot/OVERVIEW.md', 'Calm.');
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready', home: { kind: 'repo', directory: project, folder: 'design-system', livingPage: 'design-system/index.html', adoptedAt: '2026-11-01T10:00:00.000Z' } });

  const missing = await dc(tmp, ['check', '--system', 'acme', '--json']);
  assert.equal(missing.code, 0, missing.err);
  const codes = (JSON.parse(missing.out) as { findings: { code: string; severity: string }[] }).findings.map((finding) => [finding.code, finding.severity]);
  assert.deepEqual(codes, [['system-living-missing', 'warning']]);

  await tmp.write('shop/design-system/index.html', '<!doctype html><html><body><script>alert(1)</script></body></html>');
  const unsafe = await dc(tmp, ['check', '--system', 'acme']);
  assert.equal(unsafe.code, 1, unsafe.err);
  assert.match(unsafe.out, /The living page has markup Design Chamber didn't generate and can't check as safe\./);
});
