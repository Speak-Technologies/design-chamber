// The visual system check against a real browser (skipped, never silent, when none is installed):
// a fixture system whose examples misbehave in the ways the board findings name. A 1800px table is
// preview-wide once (at the wide width), a fixed-position example is preview-outside even as the last
// component of a 5000px board (content-visibility forced layout), a compact button is clean, a 700px
// compact example is hint-small at wide, and an http:// image never reaches the network. The PNG tiles
// are named by area and width, bounded in count and size.

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { test, type TestContext } from 'node:test';

import { cliSystemStore, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

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

// Eighty colours put the Components area well below the first 900px, where `content-visibility: auto` would leave a section at
// its placeholder height and unpainted if the check did not lay every section out.
const TOKENS = `:root {\n  --brand: #1a73e8;\n  --space-2: 8px;\n${Array.from({ length: 80 }, (_, i) => `  --c-${i}: #${(0x102030 + i * 0x020304).toString(16).padStart(6, '0')};`).join('\n')}\n}\n`;

/** Distinct bytes in a PNG's inflated image data: a blank tile has a handful (filter types and one colour), a drawn one hundreds. */
const distinctImageBytes = (png: Buffer): number => {
  const parts: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return new Set(inflateSync(Buffer.concat(parts))).size;
};

const fixture = (port: number): Record<string, string> => ({
  'tokens.css': TOKENS,
  'OVERVIEW.md': 'Calm and clear.',
  'system.json': JSON.stringify({
    version: 1,
    components: [
      { id: 'table', name: 'Table', layout: 'full', example: 'components/table.html' },
      { id: 'fixed', name: 'Fixed', example: 'components/fixed.html' },
      { id: 'tall', name: 'Tall', example: 'components/tall.html' },
      { id: 'last', name: 'Last', example: 'components/last.html' },
      { id: 'button', name: 'Button', layout: 'compact', example: 'components/button.html' },
      { id: 'compact-wide', name: 'Wide compact', layout: 'compact', example: 'components/compact-wide.html' },
      { id: 'remote', name: 'Remote', example: 'components/remote.html' },
    ],
  }),
  '.chamber/state.json': JSON.stringify({ name: 'Acme', status: 'ready' }),
  'components/table.html': '<div style="overflow:auto"><div style="width:1800px;height:40px;background:#ccc">Wide table</div></div>',
  'components/fixed.html': '<div style="position:fixed;left:-60px;top:0;width:100px;height:20px;background:#c00">escapes</div><p>Normal text.</p>',
  // About 4500px of numbered rows: tall, and every tile it covers has something drawn on it.
  'components/tall.html': `<ol style="margin:0">${Array.from({ length: 200 }, (_, i) => `<li style="height:22px">Row ${i + 1}</li>`).join('')}</ol>`,
  'components/last.html': '<div style="position:fixed;left:-60px;top:0;width:100px;height:20px;background:#c00">escapes</div><p>Normal text.</p>',
  'components/button.html': '<button style="padding:6px 12px">Save</button>',
  'components/compact-wide.html': '<div style="width:700px;height:30px;background:#ccc">700px</div>',
  'components/remote.html': `<img alt="x" src="http://127.0.0.1:${port}/x.png">`,
});

test('the board check finds the wide, escaping and small-hint examples, pictures the areas, and never reaches the network', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const { port, hits } = await listen(t);
  const tmp = await useTmpRoot(t);
  for (const [rel, text] of Object.entries(fixture(port))) await tmp.write(`_systems/acme/${rel}`, text);

  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const result = await runSystemCheck(store, 'acme', {
      now: new Date(),
      tool: 'cli',
      render: { browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0, budgets: { boardMs: 30_000, runMs: 120_000 } },
    });
    const render = result.report.render;
    assert.ok(render !== null);
    assert.equal(render.state, 'done', JSON.stringify(render.findings));
    assert.deepEqual(render.widths.map((width) => width.viewport), ['wide', 'narrow']);
    assert.ok(render.widths.every((width) => width.ok));

    const found = (code: string, detail?: string) => render.findings.filter((finding) => finding.code === code && (detail === undefined || finding.detail === detail));

    // (a) The 1800px table: preview-wide, reported once, at the wide width (dedupe keeps the widest).
    const wide = found('system-board-preview-wide', 'component:table');
    assert.equal(wide.length, 1, JSON.stringify(render.findings));
    assert.equal(wide[0]?.viewport, 'wide');
    assert.equal(wide[0]?.file, 'components/table.html');
    assert.equal(wide[0]?.params?.px, 1800);

    // (b) and (c): the fixed examples escape their cards, even the last one below the fold of a 5000px board.
    for (const entry of ['component:fixed', 'component:last']) {
      const outside = found('system-board-preview-outside', entry);
      assert.ok(outside.length >= 1, `${entry}: ${JSON.stringify(render.findings)}`);
      assert.ok((outside[0]?.params?.px ?? 0) > 1);
    }

    // (d) The compact button: nothing.
    for (const code of ['system-board-preview-wide', 'system-board-preview-outside', 'system-board-text-outside', 'system-board-hint-small']) {
      assert.equal(found(code, 'component:button').length, 0, code);
    }

    // (e) The 700px compact example needed the full width: hint-small at wide only.
    const hint = found('system-board-hint-small', 'component:compact-wide');
    assert.equal(hint.length, 1, JSON.stringify(render.findings));
    assert.equal(hint[0]?.viewport, 'wide');
    assert.deepEqual(hint[0]?.params, { layout: 'compact' });

    // The tall components area is pictured to 3600px and measured in full: a partial note.
    const partial = found('system-board-partial').filter((finding) => finding.params?.area === 'components');
    assert.ok(partial.length >= 1, JSON.stringify(render.findings));
    assert.equal(partial[0]?.params?.max, 3600);

    // (f) The http:// image: no connection reached the listener, and no request-blocked duplicate.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(hits, [], 'no connection reached the local listener');
    assert.ok(!render.findings.some((finding) => finding.code === 'request-blocked'), JSON.stringify(render.findings));

    // The tiles: named by area and width, bounded, and the right size.
    const pngRels = render.widths.flatMap((width) => width.pngs);
    assert.ok(pngRels.length > 0 && pngRels.length <= 32, `${pngRels.length} PNGs`);
    assert.ok(pngRels.some((rel) => rel.endsWith('foundations@wide.png')), pngRels.join(', '));
    assert.ok(pngRels.some((rel) => rel.endsWith('components@wide.png')));
    assert.ok(pngRels.some((rel) => rel.endsWith('components@wide-2.png')), 'the tall area tiles');
    assert.ok(pngRels.some((rel) => rel.endsWith('components@narrow.png')));
    assert.equal(render.shots.length > 0, true);
    for (const rel of pngRels) {
      const bytes = await readFile(tmp.at(`_systems/acme/${rel}`));
      assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      assert.ok(width === 1526 || width === 1046, `width ${width} of ${rel}`);
      assert.ok(height >= 1 && height <= 900, `height ${height} of ${rel}`);
      assert.ok(distinctImageBytes(bytes) > 32, `${rel} is drawn, not blank (${distinctImageBytes(bytes)} distinct bytes)`);
    }
    // The Components area starts below the first screen and is still pictured in full tiles: its first tile is a whole 900px.
    for (const width of ['wide', 'narrow']) {
      const first = pngRels.find((rel) => rel.endsWith(`components@${width}.png`));
      assert.ok(first, `components@${width}.png`);
      assert.equal((await readFile(tmp.at(`_systems/acme/${first}`))).readUInt32BE(20), 900, `components@${width}.png is a full tile`);
    }
    // The report names exactly the files that exist, and the run folder is the only one kept.
    assert.deepEqual(result.pngs.map((png) => path.relative(tmp.at('_systems/acme'), png).split(path.sep).join('/')), pngRels);
  } finally {
    await store.dispose();
  }
});