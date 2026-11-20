// Exports of a design with a design-system copy (documentation/specs/phase-2-5-technical.md §2.6
// "Exports", RS S5): the ZIP keeps everything outside `system/` as before and, under `system/`, only
// the stylesheets, fonts and logos the pages use. The agent's reference (OVERVIEW.md, notes,
// patterns, brand, components, system.json) and COPY.json never leave the design.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test, type TestContext } from 'node:test';

import { createExportService, exportIncludes } from '../../../src/service/export.ts';
import { createFakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { canvasDesign, pageDesign } from '../render/harness.ts';
import { readZip } from '../render/zip-reader.ts';

const COPY = {
  'system/COPY.json': '{}',
  'system/system.css': '@import "fonts.css";\n@import "tokens.css";\n',
  'system/fonts.css': '@font-face { font-family: "Inter"; src: url("fonts/inter.woff2") format("woff2"); }\n',
  'system/tokens.css': ':root { --brand: #111; }\n',
  'system/fonts/inter.woff2': 'wOF2',
  'system/fonts/stray.woff2': 'wOF2-stray',
  'system/logos/acme.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'system/OVERVIEW.md': 'Acme.',
  'system/notes/history.md': 'Why.',
  'system/patterns/voice.md': 'Plain.',
  'system/brand/hero.md': 'One photo.',
  'system/components/button.html': '<button>Go</button>',
  'system/system.json': '{}',
};

const setup = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  const downloads = await useTmpRoot(t);
  const ctx = createFakeContext({ root: tmp.root, settings: { downloadsDir: downloads.root } });
  t.after(() => ctx.dispose());
  const exports = createExportService({ store: ctx.store, settings: ctx.settings, log: ctx.log, issue: () => undefined });
  return { tmp, exports };
};

describe('exportIncludes (pure)', () => {
  test('outside system/ everything stays; under it only referenced stylesheets, fonts and logos', () => {
    const referenced = new Set(['index.html', 'system/system.css', 'system/fonts.css', 'system/tokens.css', 'system/fonts/inter.woff2']);
    assert.equal(exportIncludes('index.html', referenced), true);
    assert.equal(exportIncludes('assets/pic.png', referenced), true);
    assert.equal(exportIncludes('DESIGN.md', referenced), true);
    for (const rel of ['system/system.css', 'system/fonts.css', 'system/tokens.css', 'system/fonts/inter.woff2']) assert.equal(exportIncludes(rel, referenced), true, rel);
    for (const rel of ['system/fonts/stray.woff2', 'system/logos/acme.svg']) assert.equal(exportIncludes(rel, referenced), false, rel);
    // Never, even when a page links them.
    const greedy = new Set(Object.keys(COPY));
    for (const rel of ['system/COPY.json', 'system/OVERVIEW.md', 'system/notes/history.md', 'system/patterns/voice.md', 'system/brand/hero.md', 'system/components/button.html', 'system/system.json']) {
      assert.equal(exportIncludes(rel, greedy), false, rel);
      assert.equal(exportIncludes(rel, null), false, rel);
    }
    // Pages that could not be bundled: the stylesheets, fonts and logos go in.
    assert.equal(exportIncludes('system/logos/acme.svg', null), true);
  });
});

describe('ZIP export with a copy', () => {
  test('a page: only what it uses from system/, never the reference', async (t) => {
    const { tmp, exports } = await setup(t);
    await tmp.writeDesign(
      'art',
      pageDesign({
        ...COPY,
        'index.html': '<!doctype html><html><head><link rel="stylesheet" href="system/system.css"></head><body><h1>hi</h1></body></html>',
      }),
    );
    const result = await exports.export('art', { format: 'zip' });
    const names = readZip(await readFile(result.path)).map((entry) => entry.name).sort();
    assert.deepEqual(names, ['art/index.html', 'art/system/fonts.css', 'art/system/fonts/inter.woff2', 'art/system/system.css', 'art/system/tokens.css']);
  });

  test('a canvas: the union of what its screens use (a logo one screen shows goes in)', async (t) => {
    const { tmp, exports } = await setup(t);
    await tmp.writeDesign(
      'cv',
      canvasDesign({
        ...COPY,
        'screens/home.html': '<!doctype html><html><head><link rel="stylesheet" href="../system/system.css"></head><body><h1>home</h1></body></html>',
        'screens/checkout.html': '<!doctype html><html><body><img src="../system/logos/acme.svg"></body></html>',
      }),
    );
    const result = await exports.export('cv', { format: 'zip' });
    const names = readZip(await readFile(result.path)).map((entry) => entry.name).sort();
    assert.deepEqual(names, [
      'cv/screens/checkout.html',
      'cv/screens/home.html',
      'cv/system/fonts.css',
      'cv/system/fonts/inter.woff2',
      'cv/system/logos/acme.svg',
      'cv/system/system.css',
      'cv/system/tokens.css',
    ]);
  });

  test('single-file HTML inlines the copy and carries none of the reference', async (t) => {
    const { tmp, exports } = await setup(t);
    await tmp.writeDesign('art', pageDesign({ ...COPY, 'index.html': '<!doctype html><html><head><link rel="stylesheet" href="system/system.css"></head><body><h1>hi</h1></body></html>' }));
    const result = await exports.export('art', { format: 'html' });
    const html = await readFile(result.path, 'utf8');
    assert.match(html, /--brand: #111/);
    assert.doesNotMatch(html, /Acme\.|One photo|<button>Go/);
  });
});
