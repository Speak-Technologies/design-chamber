// C1 against a real browser (skipped, never silent, when none is installed): the false overlap
// warnings are gone, hidden text sits out the visual verdicts, and real overlaps are still found.
// The review-page fixture is a byte copy of the design the false warnings were found on; it lives
// in the repo, never read from the user's Designs folder.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { runCheck, type RunCheckResult } from '../../../src/service/check/engine.ts';
import type { CheckFindingData } from '../../../src/shared/types.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const head = (title: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{margin:0;font:16px/1.5 sans-serif;color:#111;background:#fff}</style>`;
const page = (title: string, body: string): string => `${head(title)}</head><body>${body}</body></html>`;

const fixtureDir = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'design-chamber-review');
const reviewHtml = await readFile(path.join(fixtureDir, 'index.html'), 'utf8');
const reviewTokens = await readFile(path.join(fixtureDir, 'tokens.css'), 'utf8');

const designJson = (ids: string[]): Record<string, unknown> => ({
  version: 1,
  kind: 'canvas',
  title: 'C1',
  created: '2026-11-11T10:00:00.000Z',
  updated: '2026-11-11T10:00:00.000Z',
  viewports: [{ id: 'laptop', label: 'Laptop', width: 1000, height: 700 }],
  screens: ids.map((id) => ({ id, title: id, file: `screens/${id}.html` })),
  designSystem: { confirmed: false },
});

const run = async (t: TestContext, files: Record<string, string>, ids: string[]): Promise<RunCheckResult> => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) throw new Error('skipped');
  const tmp = await useTmpRoot(t);
  const designFiles: Record<string, string | object> = { 'design.json': designJson(ids) };
  for (const [name, text] of Object.entries(files)) designFiles[name] = text;
  const dir = await tmp.writeDesign('c1', designFiles);
  return runCheck({
    designDir: dir,
    slug: 'c1',
    tool: 'cli',
    browserPath,
    probeSource: await probeSource(),
    platform: process.platform,
    isRoot: process.getuid?.() === 0,
    now: () => new Date(),
    budgets: { artboardMs: 15_000, runMs: 120_000 },
  });
};

const runFixture = async (t: TestContext, html: string): Promise<RunCheckResult> => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) throw new Error('skipped');
  const tmp = await useTmpRoot(t);
  const dir = await tmp.writeDesign('review', {
    'design.json': {
      version: 1,
      kind: 'page',
      title: 'Design Chamber review',
      created: '2026-11-08T12:00:00.000Z',
      updated: '2026-11-10T21:30:00.000Z',
      entry: 'index.html',
      viewports: [
        { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
        { id: 'phone', label: 'Phone', width: 390, height: 844 },
      ],
      designSystem: { confirmed: true },
    },
    'index.html': html,
    'tokens.css': reviewTokens,
  });
  return runCheck({
    designDir: dir,
    slug: 'review',
    tool: 'cli',
    browserPath,
    probeSource: await probeSource(),
    platform: process.platform,
    isRoot: process.getuid?.() === 0,
    now: () => new Date(),
    budgets: { artboardMs: 20_000, runMs: 120_000 },
  });
};

const codes = (result: RunCheckResult, screen: string | null = null): string[] =>
  (result.report.render?.findings ?? []).filter((finding) => screen === null || finding.screen === screen).map((finding) => finding.code);
const overlapFindings = (result: RunCheckResult, where: { screen?: string; viewport?: string }) =>
  (result.report.render?.findings ?? []).filter(
    (finding) => finding.code === 'text-overlap' && (where.screen === undefined || finding.screen === where.screen) && (where.viewport === undefined || finding.viewport === where.viewport),
  );

test('inline code, b, strong, em, a and padded spans inside a paragraph, list item or table cell never overlap', async (t) => {
  const result = await run(
    t,
    {
      'screens/inline.html': page(
        'inline',
        '<p style="width:420px;">Plain paragraph text with <code style="padding:2px 6px; background:#eee; border:1px solid #ccc; border-radius:4px;">inline code</code> and <b>bold text</b> and <a href="#inline" style="padding:2px 4px; background:#def;">a link</a> inside it.</p>' +
          '<p style="width:420px;">Text with <sup>superscript</sup> and <sub>subscript</sub> inside it.</p>' +
          '<ul style="padding-left:20px;"><li>List item with <span style="padding:2px 6px; background:#eee; border:1px solid #ccc;">a padded span</span> inside.</li></ul>' +
          '<table><tbody><tr><td style="padding:8px;">Cell with <em style="padding:2px 4px; background:#ffe;">emphasis</em> and <strong>strong</strong> text.</td></tr></tbody></table>',
      ),
    },
    ['inline'],
  );
  assert.deepEqual(overlapFindings(result, {}), []);
});

test('an inline element that wraps over several lines does not overlap its paragraph or its siblings', async (t) => {
  const result = await run(
    t,
    {
      'screens/wrapped.html': page(
        'wrapped',
        '<p style="width:220px;">Before <code style="background:#eee; padding:2px 4px; overflow-wrap:anywhere;">a-long-inline-code-that-wraps-over-several-lines</code> after it.</p>' +
          '<p style="width:220px;"><span>Short sibling</span> <span style="background:#eee; padding:2px 4px;">a sibling span that wraps onto two lines</span></p>',
      ),
    },
    ['wrapped'],
  );
  assert.deepEqual(overlapFindings(result, {}), []);
});

test('screen-reader-only text sits out overlap, clipped text and contrast; visible text is still judged', async (t) => {
  const result = await run(
    t,
    {
      'screens/hidden.html': page(
        'hidden',
        // Every hidden span sits right over the heading and would overlap it if judged.
        '<h1 style="margin:40px; font-size:32px; line-height:40px;">Visible heading</h1>' +
          '<span style="position:absolute; left:40px; top:40px; width:1px; height:1px; overflow:hidden; white-space:nowrap; color:#eee;">Screen reader text long enough to overlap the heading</span>' +
          '<span style="position:absolute; left:40px; top:40px; clip:rect(0 0 0 0); color:#eee;">Text hidden by a zero-area clip rect</span>' +
          '<span style="position:absolute; left:40px; top:40px; clip-path:inset(50%); color:#eee;">Text hidden by clip path inset</span>' +
          '<div style="position:relative; overflow:hidden; width:300px; height:40px; margin:0 40px;"><span style="position:absolute; left:-9999px; top:0; color:#eee;">Text parked outside a clipping ancestor</span></div>' +
          '<span style="position:absolute; left:40px; top:40px; opacity:0; color:#eee;">Text hidden by zero opacity</span>' +
          '<p style="margin:40px; color:#ccc;">Visible low contrast control</p>',
      ),
    },
    ['hidden'],
  );
  assert.deepEqual(codes(result, 'hidden').filter((code) => code !== 'page-height'), ['contrast'], 'only the visible control is judged');
  assert.equal(result.report.render?.findings.find((finding) => finding.code === 'contrast')?.detail, 'Visible low contrast control');
});

test('a visible child of a visibility:hidden parent, and visible aria-hidden text, are still judged', async (t) => {
  const result = await run(
    t,
    {
      'screens/visibility.html': page(
        'visibility',
        '<div style="visibility:hidden;">' +
          '<p style="visibility:visible; margin:20px; color:#ccc;">Visible child of a hidden parent</p>' +
          '<p style="margin:20px; color:#ccc;">Hidden sibling text</p>' +
          '</div>' +
          '<p aria-hidden="true" style="margin:20px; color:#ccc;">Aria hidden but visible on screen</p>',
      ),
    },
    ['visibility'],
  );
  const contrast = (result.report.render?.findings ?? []).filter((finding) => finding.code === 'contrast');
  assert.deepEqual(contrast.map((finding) => finding.detail).sort(), ['Aria hidden but visible on screen', 'Visible child of a hidden parent']);
});

test('text in a clipping container is judged only where it paints', async (t) => {
  const result = await run(
    t,
    {
      'screens/scroll.html': page(
        'scroll',
        '<div style="position:relative; overflow:hidden; width:200px; margin:20px;">' +
          '<p style="white-space:nowrap; margin:0;">Long text that runs past the clipping box to the right</p>' +
          '<p style="position:absolute; left:300px; top:10px; margin:0;">Over the clipped part</p>' +
          '<p style="position:absolute; left:50px; top:10px; margin:0;">Over the visible part</p>' +
          '</div>',
      ),
    },
    ['scroll'],
  );
  const found = overlapFindings(result, {});
  assert.equal(found.length, 1, 'only the text over the painted part overlaps');
  assert.match(found[0]?.detail ?? '', /Over the visible part/);
});

test('real overlaps are still found: a caption over a heading, negative margins, and a transform', async (t) => {
  const result = await run(
    t,
    {
      'screens/caption.html': page(
        'caption',
        '<div style="position:relative; margin:40px; width:600px; height:100px;">' +
          '<h1 style="margin:0; font-size:20px; line-height:24px;">The heading text that the caption sits over</h1>' +
          '<p style="position:absolute; left:100px; top:-10px; margin:0; font-size:32px; line-height:40px;">Caption over the heading</p>' +
          '</div>',
      ),
      'screens/grid.html': page(
        'grid',
        '<div style="display:grid; grid-template-columns:200px 200px; margin:40px; width:400px;">' +
          '<p style="margin:0;">First grid item text</p>' +
          '<p style="margin:0 0 0 -150px;">Second grid item text</p>' +
          '</div>',
      ),
      'screens/flex.html': page(
        'flex',
        '<div style="display:flex; margin:40px;">' +
          '<p style="margin:0; width:200px;">First flex item text</p>' +
          '<p style="margin:0 0 0 -150px; width:200px;">Second flex item text</p>' +
          '</div>',
      ),
      'screens/transform.html': page(
        'transform',
        '<div style="margin:40px;">' +
          '<p style="margin:0; width:300px;">Base paragraph text</p>' +
          '<p style="margin:0; width:300px; transform:translateY(-20px);">Moved up onto the base</p>' +
          '</div>',
      ),
    },
    ['caption', 'grid', 'flex', 'transform'],
  );
  for (const screen of ['caption', 'grid', 'flex', 'transform']) {
    const found = overlapFindings(result, { screen });
    assert.equal(found.length, 1, `${screen}: exactly one overlap`);
  }
  assert.match(overlapFindings(result, { screen: 'caption' })[0]?.detail ?? '', /Caption over the heading/);
  assert.match(overlapFindings(result, { screen: 'grid' })[0]?.detail ?? '', /Second grid item text/);
  assert.match(overlapFindings(result, { screen: 'flex' })[0]?.detail ?? '', /Second flex item text/);
  assert.match(overlapFindings(result, { screen: 'transform' })[0]?.detail ?? '', /Moved up onto the base/);
});

test('the review-page fixture gives no overlap or clipped-text warnings at either viewport', async (t) => {
  const result = await runFixture(t, reviewHtml);
  assert.equal(result.report.render?.state, 'done');
  assert.equal(result.report.render?.artboards.length, 2);
  for (const viewport of ['laptop', 'phone']) {
    assert.deepEqual(overlapFindings(result, { viewport }), [], `no false overlap at ${viewport}`);
    const clipped: CheckFindingData[] = (result.report.render?.findings ?? []).filter((finding) => finding.code === 'text-clipped' && finding.viewport === viewport);
    assert.deepEqual(clipped, [], `the screen-reader-only table header is not cut-off text at ${viewport}`);
  }
});

test('the review page with one planted overlap gives exactly one warning per viewport', async (t) => {
  const plant =
    '<div style="position:relative; height:60px; margin:24px;">' +
    '<p style="position:absolute; left:0; top:0; margin:0; font-size:20px; line-height:30px; color:#1f1c17;">First planted line of text</p>' +
    '<p style="position:absolute; left:80px; top:5px; margin:0; font-size:20px; line-height:30px; color:#1f1c17;">Second planted line of text</p>' +
    '</div>';
  const result = await runFixture(t, reviewHtml.replace('<body>', `<body>${plant}`));
  assert.equal(result.report.render?.state, 'done');
  for (const viewport of ['laptop', 'phone']) {
    const found = overlapFindings(result, { viewport });
    assert.equal(found.length, 1, `exactly the planted overlap at ${viewport}`);
    assert.match(found[0]?.detail ?? '', /First planted line of text \/ Second planted line of text/);
  }
});
