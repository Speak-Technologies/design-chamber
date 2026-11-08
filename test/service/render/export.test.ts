import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';
import { createExportService, type ExportService } from '../../../src/service/export.ts';
import { ApiError } from '../../../src/service/http.ts';
import { pageDesign, canvasDesign, redPng } from './harness.ts';
import { readZip } from './zip-reader.ts';

const setup = async (t: TestContext, extra: { zipMaxEntryBytes?: number } = {}): Promise<{ tmp: TmpRoot; downloads: string; ctx: FakeContext; exports: ExportService; issued: string[] }> => {
  const tmp = await useTmpRoot(t);
  const downloadsTmp = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, settings: { downloadsDir: downloadsTmp.root } });
  t.after(() => ctx.dispose());
  const issued: string[] = [];
  const exports = createExportService({ store: ctx.store, settings: ctx.settings, log: ctx.log, issue: (p) => issued.push(p), ...extra });
  return { tmp, downloads: downloadsTmp.root, ctx, exports, issued };
};

describe('export service', () => {
  test('ZIP keeps the folder tree, excludes design.json/.chamber/.versions/.thumb.png', async (t) => {
    const { tmp, downloads, exports, issued } = await setup(t);
    await tmp.writeDesign(
      'cv',
      canvasDesign({
        'assets/pic.png': redPng(),
        'assets/deep/nested/data.json': { a: 1 },
        'DESIGN.md': '# design system',
        'tokens.css': ':root{--x:1}',
        '.chamber/state.json': '{}',
        '.versions/index.json': '{}',
        '.thumb.png': 'nope',
      }),
    );
    const result = await exports.export('cv', { format: 'zip' });
    assert.equal(result.format, 'zip');
    assert.equal(result.path, path.join(downloads, 'cv.zip'));
    assert.equal(result.bytes, (await readFile(result.path)).length);

    const zip = readZip(await readFile(result.path));
    assert.deepEqual(
      zip.map((entry) => entry.name).sort(),
      ['cv/DESIGN.md', 'cv/assets/deep/nested/data.json', 'cv/assets/pic.png', 'cv/screens/checkout.html', 'cv/screens/home.html', 'cv/tokens.css'],
    );
    const png = zip.find((entry) => entry.name === 'cv/assets/pic.png');
    assert.ok(png?.data.equals(Buffer.from(redPng())), 'binary content survives the round trip');
    assert.deepEqual(issued, [result.path], 'the path is issued for /reveal');
  });

  test('collisions get " (2)", " (3)"… names', async (t) => {
    const { tmp, downloads, exports } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    const first = await exports.export('art', { format: 'zip' });
    const second = await exports.export('art', { format: 'zip' });
    const third = await exports.export('art', { format: 'zip' });
    assert.equal(path.basename(first.path), 'art.zip');
    assert.equal(path.basename(second.path), 'art (2).zip');
    assert.equal(path.basename(third.path), 'art (3).zip');
    assert.equal(path.dirname(third.path), downloads);
  });

  test('single-file HTML inlines assets and names canvas exports after the screen', async (t) => {
    const { tmp, exports, issued } = await setup(t);
    await tmp.writeDesign('cv', canvasDesign({ 'assets/pic.png': redPng() }));
    await tmp.write('cv/screens/home.html', '<!doctype html><html><body><img src="../assets/pic.png"><img src="../assets/gone.png"></body></html>');
    const result = await exports.export('cv', { format: 'html', screen: 'home' });
    assert.equal(path.basename(result.path), 'cv-home.html');
    const html = await readFile(result.path, 'utf8');
    assert.ok(html.includes('data:image/png;base64,'), 'the asset is inlined');
    assert.ok(!html.includes('../assets/pic.png'), 'no relative refs to inlined assets survive');
    assert.ok(html.includes('../assets/gone.png'), 'a missing ref stays visible (fails closed)');
    assert.deepEqual(issued, [result.path]);
  });

  test('a design with nothing to export is refused with no-html, an unknown format with bad-request', async (t) => {
    const { tmp, exports } = await setup(t);
    // Only design.json exists → the tracked-minus-design.json set is empty.
    await tmp.write('bare/design.json', { version: 1, kind: 'page', title: 'B', created: '2026-10-26T10:00:00.000Z', updated: '2026-10-26T10:00:00.000Z' });
    await assert.rejects(exports.export('bare', { format: 'zip' }), (error: unknown) => error instanceof ApiError && error.code === 'no-html');
    await assert.rejects(exports.export('bare', { format: 'html' }), (error: unknown) => error instanceof ApiError && error.code === 'no-html');
    await tmp.writeDesign('art', pageDesign());
    await assert.rejects(
      exports.export('art', { format: 'pdf' as unknown as 'zip' }),
      (error: unknown) => error instanceof ApiError && error.code === 'bad-request',
    );
    await assert.rejects(exports.export('nope', { format: 'zip' }), (error: unknown) => error instanceof ApiError && error.code === 'not-found');
    await assert.rejects(exports.export('Bad Slug', { format: 'zip' }), (error: unknown) => error instanceof ApiError && error.code === 'bad-slug');
  });

  test('no temporary files are left behind in the destination folder', async (t) => {
    const { tmp, downloads, exports } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    await exports.export('art', { format: 'zip' });
    const left = await readdir(downloads);
    assert.deepEqual(left, ['art.zip']);
  });

  test('two exports of one design at the same moment get distinct names and both archives are valid', async (t) => {
    const { tmp, downloads, exports } = await setup(t);
    await tmp.writeDesign('art', pageDesign({ 'assets/notes.txt': 'n'.repeat(5000) }));
    const [a, b, c] = await Promise.all([exports.export('art', { format: 'zip' }), exports.export('art', { format: 'zip' }), exports.export('art', { format: 'zip' })]);
    assert.deepEqual([a.path, b.path, c.path].map((p) => path.basename(p)).sort(), ['art (2).zip', 'art (3).zip', 'art.zip']);
    for (const result of [a, b, c]) {
      const names = readZip(await readFile(result.path)).map((entry) => entry.name).sort();
      assert.deepEqual(names, ['art/assets/notes.txt', 'art/index.html']);
    }
    assert.deepEqual((await readdir(downloads)).sort(), ['art (2).zip', 'art (3).zip', 'art.zip']);
  });

  test('concurrent single-file HTML exports do not overwrite each other either', async (t) => {
    const { tmp, exports } = await setup(t);
    await tmp.writeDesign('art', pageDesign());
    const [a, b] = await Promise.all([exports.export('art', { format: 'html' }), exports.export('art', { format: 'html' })]);
    assert.notEqual(a.path, b.path);
  });

  test('a file over the per-file cap fails the ZIP with a too-large sentence naming it; no temporary file is left and the name is free again', async (t) => {
    const { tmp, downloads, exports } = await setup(t, { zipMaxEntryBytes: 1000 });
    await tmp.writeDesign('art', pageDesign({ 'assets/big.bin': randomBytes(5000) }));
    await assert.rejects(
      exports.export('art', { format: 'zip' }),
      (error: unknown) => error instanceof ApiError && error.code === 'too-large' && error.message.includes('assets/big.bin') && error.message.includes('too large to put in a ZIP'),
    );
    assert.deepEqual(await readdir(downloads), []);
    // The failed export released its name: the next one (after the file is gone) gets the plain name.
    await tmp.write('art/assets/big.bin', 'small');
    const ok = await exports.export('art', { format: 'zip' });
    assert.equal(path.basename(ok.path), 'art.zip');
  });

  test('★ a large ZIP export does not stall the event loop (no stall over 500 ms)', async (t) => {
    const { tmp, exports } = await setup(t);
    // 24 MB: 12 MB that compresses but makes deflate work hard (mostly "A" with 10% noise: the slow case for
    // level 9) and 12 MB that cannot be compressed at all.
    const files: Record<string, Uint8Array | string> = {};
    for (let i = 0; i < 3; i += 1) {
      const mostlyA = randomBytes(4 * 1024 * 1024);
      for (let at = 0; at < mostlyA.length; at += 1) if ((mostlyA[at] ?? 0) >= 26) mostlyA[at] = 65;
      files[`assets/text-${i}.txt`] = mostlyA;
    }
    for (let i = 0; i < 3; i += 1) files[`assets/noise-${i}.bin`] = randomBytes(4 * 1024 * 1024);
    await tmp.writeDesign('big', pageDesign(files));

    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    let result;
    try {
      result = await exports.export('big', { format: 'zip' });
    } finally {
      histogram.disable();
    }
    const worstStallMs = histogram.max / 1e6;
    const entries = readZip(await readFile(result.path));
    assert.equal(entries.length, 7);
    assert.ok(worstStallMs < 500, `the event loop stalled for ${Math.round(worstStallMs)} ms during the export`);
  });
});
