// QA regressions for the third C1 round (9d250e5), against a real browser (skipped, never silent,
// when none is installed): scroll layouts designs use every day. Text scrolled out of a box never
// overlaps text outside it, keeps its contrast verdict, and two texts in the same scroll box are
// still compared inside it, whichever axis it scrolls on.

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { runCheck, type RunCheckResult } from '../../../src/service/check/engine.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const doc = (body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>qa</title><style>body{margin:0;font:16px/1.5 sans-serif;color:#111;background:#fff}</style></head><body>${body}</body></html>`;

const run = async (t: TestContext, screens: Record<string, string>): Promise<RunCheckResult> => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) throw new Error('skipped');
  const tmp = await useTmpRoot(t);
  const ids = Object.keys(screens);
  const files: Record<string, string | object> = {
    'design.json': {
      version: 1,
      kind: 'canvas',
      title: 'qa',
      created: '2026-11-11T10:00:00.000Z',
      updated: '2026-11-11T10:00:00.000Z',
      viewports: [{ id: 'laptop', label: 'Laptop', width: 1000, height: 700 }],
      screens: ids.map((id) => ({ id, title: id, file: `screens/${id}.html` })),
      designSystem: { confirmed: false },
    },
  };
  for (const [id, html] of Object.entries(screens)) files[`screens/${id}.html`] = html;
  const dir = await tmp.writeDesign('qa', files);
  return runCheck({
    designDir: dir,
    slug: 'qa',
    tool: 'cli',
    browserPath,
    probeSource: await probeSource(),
    platform: process.platform,
    isRoot: process.getuid?.() === 0,
    now: () => new Date(),
    budgets: { artboardMs: 15_000, runMs: 120_000 },
  });
};

const findingsOn = (result: RunCheckResult, screen: string, code: string): string[] =>
  (result.report.render?.findings ?? []).filter((finding) => finding.screen === screen && finding.code === code).map((finding) => finding.detail ?? '');

/** `count` rows; the row at `low` has low contrast. */
const rows = (count: number, low: number, label: string): string =>
  Array.from({ length: count }, (_, i) => `<p style="margin:0${i === low ? '; color:#ccc' : ''}">${label} number ${i}</p>`).join('');

test('everyday scroll layouts give no false overlap and keep contrast on rows scrolled out of view', async (t) => {
  const result = await run(t, {
    // A short list scrolling inside a taller scrolling panel, text under both.
    nested: doc(`<div style="height:300px; overflow-y:auto; width:400px"><div style="height:100px; overflow-y:auto">${rows(20, 14, 'Inner')}</div><p style="margin:0">Outer text under the inner list</p>${rows(30, -1, 'Outer')}</div><p style="margin:0">Page text</p>`),
    // Cards scrolling sideways, a paragraph under the strip.
    carousel: doc(`<div style="display:flex; overflow-x:auto; width:400px; gap:10px">${Array.from({ length: 8 }, (_, i) => `<div style="flex:none; width:180px"><h4 style="margin:0">Card ${i}</h4><p style="margin:0">Card body text ${i}</p></div>`).join('')}</div><p style="margin:0">Text under the carousel</p>`),
    // A chat thread that starts at the bottom: older messages scroll in from above.
    chat: doc(`<div style="height:120px; overflow-y:auto; width:400px; display:flex; flex-direction:column-reverse">${rows(20, 2, 'Message')}</div><p style="margin:0">Composer text</p>`),
    // A phone mock shrunk to half size with a scrolling screen inside, a caption under the frame.
    phone: doc(`<div style="transform:scale(.5); transform-origin:0 0; width:390px; height:600px; overflow:hidden; border:8px solid #000"><div style="height:600px; overflow-y:auto">${rows(60, 50, 'Row')}</div></div><p style="position:absolute; top:310px; left:0; margin:0">Caption under the phone</p>`),
    // A sticky header over a scrolling list.
    sticky: doc(`<div style="height:120px; overflow-y:auto; width:400px"><h3 style="position:sticky; top:0; margin:0; background:#fff">Sticky header</h3>${rows(20, -1, 'Row')}</div><p style="margin:0">Text under the list</p>`),
  });
  for (const screen of ['nested', 'carousel', 'chat', 'phone', 'sticky']) {
    assert.deepEqual(findingsOn(result, screen, 'text-overlap'), [], `${screen}: nothing paints over anything`);
  }
  assert.deepEqual(findingsOn(result, 'nested', 'contrast'), ['Inner number 14'], 'a row scrolled out of the inner list is still judged');
  assert.deepEqual(findingsOn(result, 'chat', 'contrast'), ['Message number 2'], 'an older message above the view is still judged');
  assert.deepEqual(findingsOn(result, 'phone', 'contrast'), ['Row number 50'], 'a row further down the shrunk phone is still judged');
});

test('two texts that overlap far along a sideways scroll box are found', async (t) => {
  const planted =
    '<div style="position:relative; height:60px">' +
    '<p style="position:absolute; left:0; top:0; margin:0; font-size:20px; line-height:30px">First planted line</p>' +
    '<p style="position:absolute; left:80px; top:5px; margin:0; font-size:20px; line-height:30px">Second planted line</p>' +
    '</div>';
  const result = await run(t, {
    sideways: doc(`<div style="overflow-x:auto; width:300px"><div style="width:1500px; position:relative; height:60px"><div style="position:absolute; left:900px; top:0; width:500px">${planted}</div></div></div><p>Text under the strip</p>`),
  });
  assert.deepEqual(findingsOn(result, 'sideways', 'text-overlap'), ['First planted line / Second planted line']);
});
