// QA regressions for C1 (cc70d6c), against a real browser (skipped, never silent, when none is
// installed). Text a user sees once they scroll must still be judged: "visually hidden" is the
// screen-reader-only patterns only. Scroll boxes and the root never hide text (scroll boxes only
// decide where it paints now, see overlap-clip-qa2.e2e.test.ts), hidden/clip axes do, and
// positioned text is clipped only by its containing-block chain (the cases below were QA
// findings 1 and 2, fixed in the follow-up round).

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { runCheck, type RunCheckResult } from '../../../src/service/check/engine.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const doc = (style: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>qa</title><style>body{margin:0;font:16px/1.5 sans-serif;color:#111;background:#fff}${style}</style></head><body>${body}</body></html>`;

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

const codesOn = (result: RunCheckResult, screen: string): string[] =>
  (result.report.render?.findings ?? []).filter((finding) => finding.screen === screen).map((finding) => finding.code);

test('opacity:0 text that would overlap a heading sits out the overlap verdict', async (t) => {
  // The span sticks out past the heading's line box (so the share rule would fire) and has no
  // opacity of its own on the backdrop chain, so only the hidden flag keeps it out.
  const result = await run(t, {
    opacity: doc(
      '',
      '<h1 style="margin:40px; font-size:20px; line-height:24px;">Heading</h1>' +
        '<div style="opacity:0;"><span style="position:absolute; left:60px; top:44px; font-size:16px; line-height:20px; white-space:nowrap; color:#eee;">Zero opacity text running well past the heading</span></div>',
    ),
  });
  const found = codesOn(result, 'opacity');
  assert.ok(!found.includes('text-overlap'), `no overlap from opacity:0 text, got ${found.join(', ')}`);
  // Control: the same markup without opacity:0 is judged, so the assertion above can fail.
  const control = await run(t, {
    shown: doc(
      '',
      '<h1 style="margin:40px; font-size:20px; line-height:24px;">Heading</h1>' +
        '<div><span style="position:absolute; left:60px; top:44px; font-size:16px; line-height:20px; white-space:nowrap; color:#eee;">Zero opacity text running well past the heading</span></div>',
    ),
  });
  assert.ok(codesOn(control, 'shown').includes('text-overlap'), 'the visible control overlaps');
});

const lowBelowFold = '<p style="margin:1500px 20px 0; color:#ccc;">Low contrast below the fold</p><p style="margin:0 20px 40px;">filler</p>';

test('text below the first screen is judged when html has overflow-x:hidden', async (t) => {
  const result = await run(t, { htmlx: doc('html{overflow-x:hidden}', lowBelowFold) });
  assert.ok(codesOn(result, 'htmlx').includes('contrast'));
});

test('text further down a scroll box is judged for contrast', async (t) => {
  const result = await run(t, {
    scrollbox: doc('', '<div style="height:100px; overflow-y:auto; margin:20px;"><p style="margin:300px 0 0; color:#ccc;">Low contrast further down a scroll box</p></div>'),
  });
  assert.ok(codesOn(result, 'scrollbox').includes('contrast'));
});

test('absolute text that escapes a static clipping box is judged', async (t) => {
  const result = await run(t, {
    escape: doc('', '<div style="position:relative; margin:20px;"><div style="overflow:hidden; height:20px; width:200px;"><span style="position:absolute; left:0; top:60px; color:#ccc;">Escapes a static clipping box</span></div></div>'),
  });
  assert.ok(codesOn(result, 'escape').includes('contrast'));
});

test('text in a sideways-scrolling table is judged for contrast', async (t) => {
  const result = await run(t, {
    sideway: doc(
      '',
      '<div style="overflow-x:auto; width:300px; margin:20px;"><table style="width:900px; border-collapse:collapse;"><tbody><tr>' +
        '<td style="width:400px; padding:8px;">First cell</td>' +
        '<td style="padding:8px; color:#ccc;">Low contrast cell scrolled out to the right</td>' +
        '</tr></tbody></table></div>',
    ),
  });
  assert.ok(codesOn(result, 'sideway').includes('contrast'));
});

test('overflow-x:clip with overflow-y:visible clips only the x axis', async (t) => {
  // Chrome keeps overflow-y visible here (clip does not force the other axis to auto). Text below
  // the box paints; text to the right of it does not. Distinct colours keep the two findings apart.
  const result = await run(t, {
    clipx: doc(
      '',
      '<div style="position:relative; overflow-x:clip; overflow-y:visible; width:200px; height:50px; margin:20px;">' +
        '<p style="position:absolute; left:250px; top:0; margin:0; color:#ccc;">Right of the clip box</p>' +
        '<p style="position:absolute; left:0; top:100px; margin:0; color:#ddd;">Below the clip box</p>' +
        '</div>',
    ),
  });
  const contrast = (result.report.render?.findings ?? []).filter((finding) => finding.screen === 'clipx' && finding.code === 'contrast');
  assert.deepEqual(contrast.map((finding) => finding.detail), ['Below the clip box'], 'only the text on the unclipped axis is judged');
});

test('fixed-position text is judged where it paints and hidden where it does not', async (t) => {
  const result = await run(t, {
    fixed: doc(
      '',
      // On-screen fixed text: judged. Distinct colours keep the findings apart (one per colour pair).
      '<p style="position:fixed; left:20px; top:20px; margin:0; color:#ccc;">On screen fixed low contrast</p>' +
        // Parked off-screen: the viewport contains it and it never scrolls into view, so it is hidden.
        '<p style="position:fixed; left:-9999px; top:20px; margin:0; color:#ddd;">Off screen fixed low contrast</p>' +
        // Contained by a transformed ancestor and clipped by its overflow:hidden: hidden.
        '<div style="transform:translateX(0); overflow:hidden; width:200px; height:100px; margin:20px;">' +
        '<p style="position:fixed; left:300px; top:50px; margin:0; color:#bbc;">Fixed inside a transformed clipping box</p>' +
        '</div>',
    ),
  });
  const contrast = (result.report.render?.findings ?? []).filter((finding) => finding.screen === 'fixed' && finding.code === 'contrast');
  assert.deepEqual(contrast.map((finding) => finding.detail), ['On screen fixed low contrast'], 'only the fixed text that paints is judged');
});
