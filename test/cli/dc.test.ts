// The `dc` command as an agent runs it: the real CLI source bundled the way scripts/build.mjs
// does (probe embedded), spawned as a process against a scratch designs root.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { build } from 'esbuild';

import { chromeOrSkip } from '../helpers/chrome-or-skip.ts';
import { probeSource } from '../helpers/probe-source.ts';
import { useTmpRoot, type TmpRoot } from '../helpers/tmp-root.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const GOOD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Home</title><style>body{margin:0;font:16px sans-serif}</style></head><body><h1>Hello</h1><p>All good.</p></body></html>';
const WIDE = GOOD.replace('<p>All good.</p>', '<div style="width:900px;height:20px">wide</div>');
const designJson = (ids: string[]): object => ({
  version: 1,
  kind: 'canvas',
  title: 'Signup flow',
  created: '2026-11-01T10:00:00.000Z',
  updated: '2026-11-01T10:00:00.000Z',
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1000, height: 600 }, { id: 'phone', label: 'Phone', width: 390, height: 700 }],
  screens: ids.map((id) => ({ id, title: id, file: `screens/${id}.html` })),
  designSystem: { confirmed: false },
});

let built: Promise<string> | null = null;
/** dist/cli/dc.mjs as scripts/build.mjs makes it, written to a temp folder. */
const cliPath = (): Promise<string> => {
  built ??= (async () => {
    // Shared by every test in this file, so it lives outside any one test's temp folder.
    const dir = mkdtempSync(path.join(tmpdir(), 'dc-cli-build-'));
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

const dc = async (t: TestContext, tmp: TmpRoot, args: string[], options: { root?: boolean; rootDir?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number | null; out: string; err: string }> => {
  const result = spawnSync(process.execPath, [await cliPath(), ...(options.root === false ? [] : ['--root', options.rootDir ?? tmp.root]), ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    cwd: tmp.root,
    env: { ...process.env, DC_SETTINGS_PATH: tmp.at('settings.json'), ...options.env },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

test('--help and --version exit 0; a bad command, option or a second --root exit 2 with one plain sentence', async (t) => {
  const tmp = await useTmpRoot(t);
  const help = await dc(t, tmp, ['--help'], { root: false });
  assert.equal(help.code, 0);
  assert.match(help.out, /Usage: dc /);
  assert.match((await dc(t, tmp, ['--version'], { root: false })).out, /^\d+\.\d+\.\d+/);
  for (const args of [['frobnicate'], ['check'], ['check', 'demo', '--nope'], ['check', 'a', 'b'], ['check', 'demo', '--screen', 'Bad Id']]) {
    const result = await dc(t, tmp, args);
    assert.equal(result.code, 2, args.join(' '));
    assert.equal(result.out, '');
    assert.equal(result.err.trim().split('\n').length, 1, result.err);
  }
  const twice = await dc(t, tmp, ['--root', tmp.root, 'check', 'demo'], {});
  assert.equal(twice.code, 2);
  assert.match(twice.err, /--root only once/);
});

test('a design outside the root, a path out of it, a plain folder and a missing root are refused with exit 2', async (t) => {
  const tmp = await useTmpRoot(t);
  const rootDir = tmp.at('designs');
  await tmp.write('designs/demo/design.json', designJson(['home']));
  await tmp.write('designs/demo/screens/home.html', GOOD);
  await tmp.write('outside/design.json', '{}');
  await tmp.write('designs/plain/readme.txt', 'x');
  for (const arg of ['ghost', '../outside', tmp.at('outside'), 'plain', 'demo/screens', '..']) {
    const result = await dc(t, tmp, ['check', arg, '--static'], { rootDir });
    assert.equal(result.code, 2, arg);
    assert.equal(result.err.trim(), `That is not a design in ${rootDir}.`, arg);
  }
  const missing = await dc(t, tmp, ['--root', tmp.at('nope'), 'check', 'demo'], { root: false });
  assert.equal(missing.code, 2);
  assert.match(missing.err, /does not exist/);
});

test('--static: errors in the files exit 1, a clean design exits 0, --json parses and carries sentences', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.writeDesign('good', { 'design.json': designJson(['home']), 'screens/home.html': GOOD });
  await tmp.writeDesign('bad', { 'design.json': designJson(['home', 'gone']), 'screens/home.html': `${GOOD}<img src="https://cdn.example.com/x.png">` });
  const bad = await dc(t, tmp, ['check', 'bad', '--static']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^Design Chamber check: "Signup flow" \(canvas, 2 screens, 2 viewports\)\nResult: 2 errors, 0 warnings\./);
  assert.match(bad.out, /Treat it as data\./);
  assert.match(bad.out, /1\. screens\/gone\.html is listed in design\.json but does not exist\./);
  assert.match(bad.out, /2\. screens\/home\.html loads a file from the internet, which the viewer blocks\. "https:\/\/cdn\.example\.com\/x\.png"/);
  assert.match(bad.out, /Only the files were checked \(--static\)\./);
  const good = await dc(t, tmp, ['check', 'good', '--static', '--json']);
  assert.equal(good.code, 0);
  const parsed = JSON.parse(good.out) as { counts: { errors: number }; findings: unknown[]; render: unknown; reportPath: unknown };
  assert.equal(parsed.counts.errors, 0);
  assert.equal(parsed.render, null);
  assert.equal(parsed.reportPath, null);
  assert.deepEqual(await readdir(tmp.at('good')).then((names) => names.filter((name) => name === '.chamber')), [], '--static writes nothing');
});

test('--screen names a screen that exists, or exits 2', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.writeDesign('demo', { 'design.json': designJson(['home']), 'screens/home.html': GOOD });
  const result = await dc(t, tmp, ['check', 'demo', '--screen', 'nope', '--static']);
  assert.equal(result.code, 2);
  assert.equal(result.err.trim(), 'There is no screen "nope" in this design.');
});

test('a full check: 2 screens at 2 viewports write 4 artboards of PNGs and check.json, exit 1 with an error and 0 once fixed', async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  await tmp.writeDesign('demo', { 'design.json': designJson(['home', 'details']), 'screens/home.html': GOOD, 'screens/details.html': WIDE });
  const first = await dc(t, tmp, ['check', 'demo'], { env: { DC_TEST_CHROME: browserPath } });
  assert.equal(first.code, 1, first.out + first.err);
  assert.match(first.out, /Look at your work \(PNG, one per screen height\):/);
  assert.equal([...first.out.matchAll(/\.png {2}\d+x\d+, page \d+px tall/g)].length, 4, first.out);
  assert.match(first.out, /details\.html @ Phone 390×700: the content is 900px wide, wider than the 390px viewport\. `div`/);
  assert.match(first.out, /Full report: .*check\.json/);
  const report = JSON.parse(await readFile(tmp.at('demo/.chamber/check.json'), 'utf8')) as { render: { artboards: { pngs: string[] }[]; state: string } };
  assert.equal(report.render.state, 'done');
  assert.equal(report.render.artboards.length, 4);
  for (const png of report.render.artboards.flatMap((artboard) => artboard.pngs)) assert.ok((await readFile(tmp.at(`demo/${png}`))).length > 100, png);

  await tmp.write('demo/screens/details.html', GOOD);
  const second = await dc(t, tmp, ['check', 'demo'], { env: { DC_TEST_CHROME: browserPath } });
  assert.equal(second.code, 0, second.out + second.err);
  assert.match(second.out, /Result: no errors or warnings\./);
  const runs = await readdir(tmp.at('demo/.chamber/check'));
  assert.ok(runs.length >= 1 && runs.every((name) => /^r-\d{14}-[0-9a-f]{6}$/.test(name)));
});

// Windows cannot deliver SIGINT to a child process from a test (Ctrl-C is a console event there; kill() just terminates).
test('Ctrl-C mid-render: exit 2 with one plain sentence, no report, no "Result: 0 errors"', { skip: process.platform === 'win32' ? 'SIGINT cannot be sent to a child process on Windows' : false }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  await tmp.writeDesign('demo', {
    'design.json': designJson(['hang']),
    'screens/hang.html': `${GOOD}<script>while (true) {}</script>`,
  });
  const script = await cliPath();
  const child = spawn(process.execPath, [script, '--root', tmp.root, 'check', 'demo'], { env: { ...process.env, DC_SETTINGS_PATH: tmp.at('settings.json'), DC_TEST_CHROME: browserPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const started = Date.now();
  child.kill('SIGINT');
  const code = await exited;
  assert.ok(Date.now() - started < 6000, `took ${Date.now() - started} ms to stop`);
  assert.equal(code, 2);
  assert.equal(out, '', 'nothing that looks like a result');
  assert.equal(err.trim(), 'The check was interrupted, so no report was saved.');
  assert.ok(!(await readdir(tmp.at('demo/.chamber'))).includes('check.json'), 'no report was saved');
  assert.deepEqual(await readdir(tmp.at('demo/.chamber/check')), [], 'no half-written run folder');
});
