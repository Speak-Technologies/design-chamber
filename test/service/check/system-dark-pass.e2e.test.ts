// The builder-depth visual check against a real browser (documentation/specs/system-builder-depth.md D8,
// §4.5, §14; skipped, never silent, when none is installed): a system with dark values is drawn a third
// time, dark, at the wide width, for Foundations, Components and Patterns only; an oklch pair under its
// level is found only by measuring the painted board; a hex pair under its level is reported once, by
// the files; `--area components` pictures only Components and still lists every file finding; a system
// without dark values gets no dark pass.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cliSystemStore, runSystemCheck, type SystemRenderInput } from '../../../src/service/check/system-run.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

const DARK_TOKENS = `:root {
  --bg: #ffffff;
  --surface: #f6f6f4;
  --fg: #1b1b1b;
  --soft: oklch(0.75 0 0);
  --faint: #777777;
  --space-4: 16px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111111; --surface: #1b1b1b; --fg: #f2f2f2; }
}
`;

const files = (tokens: string): Record<string, string> => ({
  'tokens.css': tokens,
  'OVERVIEW.md': 'Calm.',
  'system.json': JSON.stringify({
    depth: 'core',
    tokens: { '--bg': { group: 'surface' }, '--surface': { group: 'surface' }, '--fg': { group: 'text' }, '--soft': { group: 'text' }, '--faint': { group: 'text' } },
    pairs: [
      { fg: '--soft', bg: '--bg', use: 'text', note: 'Hints.' },
      { fg: '--faint', bg: '--bg', use: 'text' },
      { fg: '--fg', bg: '--bg', use: 'text' },
    ],
    components: [{ id: 'button', name: 'Button', states: ['hover'], example: 'components/button.html' }],
    patterns: [{ id: 'nav', kind: 'navigation', title: 'Navigation', example: 'patterns/nav.html' }],
    brand: [{ id: 'hero', kind: 'marketing', title: 'Hero', example: 'brand/hero.html' }],
  }),
  '.chamber/state.json': JSON.stringify({ name: 'Acme', status: 'draft' }),
  'components/button.html': '<button data-dc-state="hover" style="padding:6px 12px;background:var(--surface);color:var(--fg)">Save</button><img alt="" src="https://example.com/b.png">',
  'patterns/nav.html': '<nav style="display:flex;gap:12px;color:var(--fg)"><a href="#">Home</a><a href="#">Settings</a><img alt="" src="https://example.com/n.png"></nav>',
  'brand/hero.html': '<section style="color:var(--fg)">Hero<img alt="" src="https://example.com/h.png"></section>',
});

const writeSystem = async (tmp: TmpRoot, tokens: string): Promise<void> => {
  for (const [rel, text] of Object.entries(files(tokens))) await tmp.write(`_systems/acme/${rel}`, text);
};

const check = async (tmp: TmpRoot, browserPath: string, over: Partial<SystemRenderInput> = {}) => {
  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    return await runSystemCheck(store, 'acme', {
      now: new Date(),
      tool: 'cli',
      render: { browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0, budgets: { boardMs: 30_000, runMs: 150_000 }, ...over },
    });
  } finally {
    await store.dispose();
  }
};

test('dark values: a dark pass for three areas, the oklch pair measured, the hex pair reported once', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  await writeSystem(tmp, DARK_TOKENS);

  const { report } = await check(tmp, browserPath);
  const render = report.render;
  assert.ok(render !== null);
  assert.equal(render.state, 'done', JSON.stringify(render.findings));
  assert.deepEqual(render.widths.map((width) => width.viewport), ['wide', 'narrow', 'wide-dark']);
  assert.deepEqual(render.schemes, ['light', 'dark']);

  const pngs = render.widths.flatMap((width) => width.pngs).map((rel) => rel.slice(rel.lastIndexOf('/') + 1));
  for (const area of ['foundations', 'components', 'patterns']) {
    assert.ok(pngs.includes(`${area}-overview@wide-dark.png`), `${area} dark overview: ${pngs.join(', ')}`);
    assert.ok(pngs.some((name) => new RegExp(`^${area}@wide-dark(-\\d+)?\\.png$`).test(name)), `${area} dark tiles`);
  }
  assert.ok(!pngs.some((name) => name.startsWith('brand') && name.includes('@wide-dark')), 'brand is left to the light passes');
  assert.ok(pngs.includes('brand-overview@wide.png'));
  assert.deepEqual(render.shots.filter((shot) => shot.width === 'wide-dark').map((shot) => shot.area), ['foundations', 'components', 'patterns']);

  // One contrast finding per scheme: the hex pair judged from the files and the oklch pair only the painted board can
  // judge are merged (the hex pair is not measured again). --faint has no dark value, so the dark ground shows it on the dark --bg.
  assert.ok(!render.findings.some((finding) => finding.code === 'system-contrast-low'), 'merged into the file findings');
  const contrast = report.static.findings.filter((finding) => finding.code === 'system-contrast-low');
  assert.deepEqual(contrast.map((finding) => [finding.params?.scheme, finding.params?.count]), [['light', 2], ['dark', 1]], JSON.stringify(contrast));
  assert.match(contrast[0]?.detail ?? '', /^--faint on --bg 4\.47:1 \(light\); --soft on --bg 2\.\d\d:1 \(light\)$/);
  assert.equal(contrast[1]?.detail, '--faint on --bg 4.21:1 (dark)');
  // Written pairs on a core system: warnings, never the old-system note.
  assert.ok(contrast.every((finding) => finding.params?.pairs === undefined));

  // The pattern example is drawn on the board like a component's, in both passes.
  assert.ok(!render.findings.some((finding) => finding.code === 'render-failed' || finding.code === 'render-skipped'), JSON.stringify(render.findings));
  // KI-39: a remote image in a component, a pattern and a brand example is one error each, and the blocked request is not reported again.
  assert.deepEqual(
    report.static.findings.filter((finding) => finding.code === 'system-example-remote').map((finding) => [finding.file, finding.detail]),
    [['components/button.html', 'https://example.com/b.png'], ['patterns/nav.html', 'https://example.com/n.png'], ['brand/hero.html', 'https://example.com/h.png']],
  );
  assert.ok(!render.findings.some((finding) => finding.code === 'request-blocked'), JSON.stringify(render.findings));
});

test('--area components pictures only Components and still lists every file finding', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  await writeSystem(tmp, DARK_TOKENS);

  const { report } = await check(tmp, browserPath, { area: 'components' });
  const render = report.render;
  assert.ok(render !== null);
  assert.deepEqual(render.areas, ['components']);
  const pngs = render.widths.flatMap((width) => width.pngs).map((rel) => rel.slice(rel.lastIndexOf('/') + 1));
  assert.ok(pngs.length > 0);
  // Area pictures are Components only; the forced state pictures (T16) belong to Components too, from the wide light pass.
  const statePngs = new Set((render.states ?? []).flatMap((one) => (one.png === null ? [] : [one.png.slice(one.png.lastIndexOf('/') + 1)])));
  assert.ok(pngs.every((name) => name.startsWith('components') || (statePngs.has(name) && name.endsWith('@wide.png'))), pngs.join(', '));
  assert.ok(render.shots.every((shot) => shot.area === 'components'));
  // Pairs live under Foundations: not measured when only Components is checked.
  assert.ok(!render.findings.some((finding) => finding.code === 'system-contrast-low'));
  // The file checks cover the whole system: the foundations gap and the hex pair are still there.
  const codes = report.static.findings.map((finding) => finding.code);
  assert.ok(codes.includes('system-contrast-low'), codes.join(', '));
  assert.ok(report.static.findings.some((finding) => finding.code === 'system-coverage-gap' && finding.params?.area === 'foundations'), codes.join(', '));
});

test('no dark values: no dark pass', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  await writeSystem(tmp, DARK_TOKENS.replace(/@media[\s\S]*$/, ''));
  const { report } = await check(tmp, browserPath);
  assert.deepEqual(report.render?.widths.map((width) => width.viewport), ['wide', 'narrow']);
  assert.deepEqual(report.render?.schemes, ['light']);
  assert.ok(!(report.render?.widths ?? []).flatMap((width) => width.pngs).some((rel) => rel.includes('@wide-dark')));
});
