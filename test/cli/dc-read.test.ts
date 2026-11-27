// `dc list` and `dc read` as an agent runs them (documentation/specs/use-the-project-and-native-agent.md
// §2.3): the real CLI source bundled the way scripts/build.mjs does, spawned against a scratch root.
// Exit 0 when answered, 2 when it could not run; no browser needed; nothing in the root changes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { build } from 'esbuild';

import { useTmpRoot, type TmpRoot } from '../helpers/tmp-root.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..');

let built: Promise<string> | null = null;
const cliPath = (): Promise<string> => {
  built ??= (async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dc-read-build-'));
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
      // No probe: list and read never render.
      define: { __DC_PROBE__: 'undefined' },
    });
    return out;
  })();
  return built;
};

const dc = async (tmp: TmpRoot, args: string[]): Promise<{ code: number | null; out: string; err: string }> => {
  const result = spawnSync(process.execPath, [await cliPath(), ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: tmp.root,
    // No browser anywhere: the commands must not look for one.
    env: { PATH: process.env.PATH ?? '', HOME: tmp.root, TZ: 'UTC', DC_SETTINGS_PATH: tmp.at('data/settings.json'), DC_TEST_CHROME: tmp.at('no-chrome') },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

/** Every path under `dir` with its size and mtime: proof that a read wrote nothing. */
const snapshot = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const info = await stat(full);
      out.push(`${path.relative(dir, full)} ${info.size} ${info.mtimeMs}`);
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dir);
  return out.sort();
};

const DESIGN = {
  version: 1,
  kind: 'page',
  title: 'Pricing',
  created: '2026-11-01T10:00:00.000Z',
  updated: '2026-11-27T10:02:00.000Z',
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }],
  designSystem: { confirmed: false },
};

test('dc list and dc read answer with exit 0, write nothing and need no browser', async (t) => {
  const tmp = await useTmpRoot(t, 'dc-read-cli-');
  const root = tmp.at('designs');
  await tmp.writeDesign('designs/pricing-page', { 'design.json': DESIGN, 'index.html': '<!doctype html><h1>Hi</h1>' });
  await tmp.write('designs/pricing-page/.chamber/edits.json', { v: 1, seq: 1, dropped: 0, undo: [], ledger: [{ seq: 1, at: '2026-11-27T09:40:00.000Z', editId: 'e_abcdefgh01', kind: 'text', file: 'index.html', screen: null, before: 'Hi', after: 'Hello' }] });
  const before = await snapshot(tmp.root);

  const listed = await dc(tmp, ['--root', root, 'list']);
  assert.equal(listed.code, 0, listed.err);
  assert.equal(listed.err, '');
  assert.equal(listed.out.split('\n')[0], `Designs folder: ${root}`);
  assert.match(listed.out, /^- pricing-page · page · "Pricing" · updated 2026-11-27 10:02$/m);

  const one = await dc(tmp, ['--root', root, 'read', 'pricing-page']);
  assert.equal(one.code, 0, one.err);
  assert.match(one.out, /^"Pricing" \(pricing-page\), a page\. Folder: /);
  assert.match(one.out, /Hand edits since the last message: 1 \(text on index\.html\)\./);
  assert.match(one.out, /Last check: not checked yet\. Run design_check\./);

  const json = await dc(tmp, ['--root', root, 'read', 'pricing-page', '--json']);
  assert.equal(json.code, 0);
  assert.equal((JSON.parse(json.out) as { slug: string }).slug, 'pricing-page');
  assert.equal((JSON.parse((await dc(tmp, ['--root', root, 'list', '--json'])).out) as { designs: unknown[] }).designs.length, 1);

  assert.deepEqual(await snapshot(tmp.root), before, 'nothing under the scratch folder changed');
});

test('a path, an unknown design or a missing root exits 2 with one plain sentence and no answer', async (t) => {
  const tmp = await useTmpRoot(t, 'dc-read-cli-');
  const root = tmp.at('designs');
  await tmp.writeDesign('designs/pricing-page', { 'design.json': DESIGN, 'index.html': '<h1>x</h1>' });
  await tmp.write('outside/design.json', DESIGN);
  for (const slug of ['../outside', 'C:\\x', 'a/b', tmp.at('outside')]) {
    const result = await dc(tmp, ['--root', root, 'read', slug]);
    assert.equal(result.code, 2, slug);
    assert.equal(result.out, '');
    assert.equal(result.err.trim(), 'That is not a design folder name. Use the name of a folder in the Designs folder, such as pricing-page.', slug);
  }
  const ghost = await dc(tmp, ['--root', root, 'read', 'ghost']);
  assert.equal(ghost.code, 2);
  assert.equal(ghost.err.trim(), `That is not a design in ${root}.`);
  for (const args of [['--root', tmp.at('nope'), 'list'], ['--root', tmp.at('nope'), 'read', 'pricing-page']]) {
    const missing = await dc(tmp, args);
    assert.equal(missing.code, 2);
    assert.match(missing.err, /does not exist/);
  }
  for (const args of [['list', '--project', 'relative'], ['list', '--kind', 'x'], ['read'], ['list', '--nope']]) {
    const bad = await dc(tmp, ['--root', root, ...args]);
    assert.equal(bad.code, 2, args.join(' '));
    assert.equal(bad.err.trim().split('\n').length, 1);
  }
});

test('dc list finds view.json beside the settings file named by DC_SETTINGS_PATH', async (t) => {
  const tmp = await useTmpRoot(t, 'dc-read-cli-');
  const root = tmp.at('designs');
  await tmp.writeDesign('designs/pricing-page', { 'design.json': DESIGN, 'index.html': '<h1>x</h1>' });
  await tmp.write('data/view.json', { v: 1, at: new Date().toISOString(), surface: 'rail', slug: 'pricing-page', title: 'Pricing', screen: null, viewport: 'laptop', mode: 'edit', selection: null });
  const listed = await dc(tmp, ['--root', root, 'list']);
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /^Open now: "Pricing" \(pricing-page\), at Laptop 1280×800, in the side panel, just now$/m);
});

test('--help names list and read', async (t) => {
  const tmp = await useTmpRoot(t, 'dc-read-cli-');
  const help = await dc(tmp, ['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /dc \[--root <designs folder>\] list /);
  assert.match(help.out, /dc \[--root <designs folder>\] read <design folder name>/);
});
