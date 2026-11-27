// QA attacks on `POST /pages/from-file` (native-extras §3.6) beyond the builder's own cases:
// encoded and nested traversal refs, service-owned names in other cases and depths, a symlinked
// folder of the picked file that leads into the designs root, and a body that tries to add keys.
// Scratch root only.

import assert from 'node:assert/strict';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import type { DesignSummary } from '../../../src/shared/types.ts';
import { createFilePageImporter } from '../../../src/service/file-page.ts';
import { ApiError } from '../../../src/service/http.ts';
import { createCore } from './harness.ts';

const filesUnder = async (dir: string, prefix = ''): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await filesUnder(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
};

const setup = async (t: TestContext) => {
  const core = await createCore(t);
  t.after(() => core.stop());
  const project = core.tmp.at('project');
  const outside = core.tmp.at('outside');
  await mkdir(project, { recursive: true });
  await mkdir(outside, { recursive: true });
  const summaries: readonly DesignSummary[] = [];
  const importer = createFilePageImporter({
    settings: core.ctx.settings,
    store: core.store,
    designIndex: { all: () => summaries, ready: async () => true },
    selfWrites: core.ctx.selfWrites,
    log: core.ctx.log,
  });
  return { core, project, outside, importer };
};

describe('QA: from-file attacks', () => {
  test('encoded and nested ../ refs never reach a file outside the folder', async (t) => {
    const { core, project, outside, importer } = await setup(t);
    await writeFile(path.join(outside, 'secret.png'), 'do-not-copy');
    await mkdir(path.join(project, 'assets'), { recursive: true });
    await writeFile(path.join(project, 'assets', 'ok.png'), 'ok');
    const html = [
      '<img src="%2e%2e/outside/secret.png">',
      '<img src="assets/..%2f..%2foutside%2fsecret.png">',
      '<img src="assets/../../outside/secret.png">',
      '<img src="..\\outside\\secret.png">',
      '<img src="/../outside/secret.png">',
      '<img src="assets/ok.png">',
    ].join('\n');
    await writeFile(path.join(project, 'p.html'), `<title>P</title>${html}`);
    const reply = await importer.open({ path: path.join(project, 'p.html'), directory: project });
    const design = await core.store.dir(reply.slug);
    const files = await filesUnder(design);
    for (const rel of files) {
      if (rel.startsWith('.chamber/') || rel === 'design.json' || rel === 'index.html') continue;
      assert.ok(!rel.includes('secret'), `copied ${rel}`);
    }
    assert.ok(files.includes('assets/ok.png'), files.join(','));
  });

  test('service-owned names in any case are never planted, at the top or under system/', async (t) => {
    const { core, project, importer } = await setup(t);
    for (const rel of ['DESIGN.JSON', 'Design.json', 'INDEX.HTML', 'System/x.css', 'SYSTEM/tokens.css', '.versions/1/index.html', 'a/.chamber/x.json']) {
      await mkdir(path.dirname(path.join(project, rel)), { recursive: true });
      await writeFile(path.join(project, rel), 'planted');
    }
    const refs = ['DESIGN.JSON', 'Design.json', 'INDEX.HTML', 'System/x.css', 'SYSTEM/tokens.css', '.versions/1/index.html', 'a/.chamber/x.json']
      .map((rel) => `<link rel="stylesheet" href="${rel}"><script src="${rel}"></script><iframe src="${rel}"></iframe>`)
      .join('');
    await writeFile(path.join(project, 'p.html'), `<title>P</title>${refs}`);
    const reply = await importer.open({ path: path.join(project, 'p.html'), directory: project });
    const design = await core.store.dir(reply.slug);
    const files = await filesUnder(design);
    const planted = files.filter((rel) => !rel.startsWith('.chamber/') && rel !== 'design.json' && rel !== 'index.html');
    assert.deepEqual(planted, [], `planted: ${planted.join(', ')}`);
  });

  test('a picked file reached through a folder link into the designs root opens that design, no copy', async (t) => {
    const { core, project, importer } = await setup(t);
    await core.tmp.write('designs/shop/design.json', JSON.stringify({ title: 'Shop', kind: 'page' }));
    await core.tmp.write('designs/shop/index.html', '<title>Shop</title>');
    const before = (await readdir(core.root)).sort();
    try {
      await symlink(core.tmp.at('designs/shop'), path.join(project, 'linked'), 'junction');
    } catch {
      t.skip('no symlinks');
      return;
    }
    const reply = await importer.open({ path: path.join(project, 'linked', 'index.html'), directory: project });
    assert.equal(reply.reused, true);
    assert.equal(reply.slug, 'shop');
    assert.deepEqual((await readdir(core.root)).sort(), before);
  });

  test('a body with __proto__ or a third key is refused', async () => {
    const importer = createFilePageImporter({
      settings: { root: () => '/nowhere' },
      store: { create: async () => assert.fail('create'), trash: async () => assert.fail('trash'), get: async () => assert.fail('get'), dir: async () => assert.fail('dir') },
      designIndex: { all: () => [], ready: async () => true },
      selfWrites: { record: () => undefined },
      log: { info() {}, warn() {}, error() {} } as never,
    });
    for (const text of ['{"path":"/p/a.html","directory":null,"__proto__":{"x":1}}', '{"path":"/p/a.html","directory":null,"constructor":1}']) {
      await assert.rejects(importer.open(JSON.parse(text)), (error: unknown) => error instanceof ApiError && error.code === 'bad-request');
    }
  });
});
