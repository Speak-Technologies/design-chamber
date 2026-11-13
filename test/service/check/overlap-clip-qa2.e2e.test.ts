// QA regressions for the C1 fix rounds (ec7124e and the round after it), against a real browser
// (skipped, never silent, when none is installed). Two things are kept apart here: where text
// paints now (scroll boxes cut it, so text scrolled out of a box never overlaps text outside it)
// and whether anyone can see it at all (scrolling never hides text, so it keeps its contrast
// verdict). Only text parked outside a box that never shows it is hidden.

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

const panelLines = Array.from({ length: 20 }, (_, i) => `<p style="margin:0">Scroll panel line number ${i}</p>`).join('');

const planted =
  '<div style="position:relative; height:60px;">' +
  '<p style="position:absolute; left:0; top:0; margin:0; font-size:20px; line-height:30px;">First planted line of text</p>' +
  '<p style="position:absolute; left:80px; top:5px; margin:0; font-size:20px; line-height:30px;">Second planted line of text</p>' +
  '</div>';
const overlapsOn = (result: RunCheckResult, screen: string): string[] =>
  (result.report.render?.findings ?? []).filter((finding) => finding.screen === screen && finding.code === 'text-overlap').map((finding) => finding.detail ?? '');
const contrastOn = (result: RunCheckResult, screen: string): string[] =>
  (result.report.render?.findings ?? []).filter((finding) => finding.screen === screen && finding.code === 'contrast').map((finding) => finding.detail ?? '');

test('text further down a scroll panel never overlaps text outside the panel', async (t) => {
  const footer = '<p style="margin:0; width:400px">Footer text right under the scroll panel</p>';
  const result = await run(t, {
    panel: doc('', `<div style="height:100px; overflow-y:auto; width:400px">${panelLines}</div>${footer}`),
    // The same with the text straight in the scroll box: its own box cuts its own lines.
    direct: doc('', `<div style="height:100px; overflow-y:auto; width:400px">${'Scroll panel text that wraps over many lines. '.repeat(20)}</div>${footer}`),
  });
  assert.deepEqual(overlapsOn(result, 'panel'), [], 'the panel content and the footer never paint over each other');
  assert.deepEqual(overlapsOn(result, 'direct'), [], 'text straight in the panel never paints over the footer');
});

test('text scrolled out of a scroll panel keeps its contrast verdict and still overlaps nothing outside', async (t) => {
  const lines = Array.from({ length: 20 }, (_, i) => `<p style="margin:0${i === 15 ? '; color:#ccc' : ''}">Scroll panel line number ${i}</p>`).join('');
  const result = await run(t, {
    low: doc('', `<div style="height:100px; overflow-y:auto; width:400px">${lines}</div><p style="margin:0; width:400px">Footer text right under the scroll panel</p>`),
    // A rounded card that hides its overflow around a scrolling list: the card cuts the list
    // box, never the rows the list scrolls into view.
    card: doc('', `<div style="overflow:hidden; border-radius:12px; width:400px"><div style="height:100px; overflow-y:auto">${lines}</div></div>`),
  });
  assert.deepEqual(contrastOn(result, 'low'), ['Scroll panel line number 15'], 'the user scrolls to it, so it is judged');
  assert.deepEqual(overlapsOn(result, 'low'), []);
  assert.deepEqual(contrastOn(result, 'card'), ['Scroll panel line number 15'], 'a clipping card around the list does not hide its rows');
});

test('a box with nothing to scroll to hides what sticks out of it, like overflow:hidden', async (t) => {
  const lines = Array.from({ length: 20 }, (_, i) => `<p style="margin:0${i === 15 ? '; color:#ccc' : ''}">Collapsed section line ${i}</p>`).join('');
  const seen = '<p style="margin:20px; color:#ddd">Visible low contrast text</p>';
  const result = await run(t, {
    // A "show more" section cut at 60px. The inner wrapper has overflow-x:auto (so overflow-y
    // computes to auto too) but nothing to scroll to: no scrolling brings line 15 into view.
    collapsed: doc('', `<div style="max-height:60px; overflow:hidden; width:400px"><div style="overflow-x:auto">${lines}</div></div>${seen}`),
    // Text parked to the left of an overflow:auto box: the box cannot scroll there.
    parked: doc('', `<div style="position:relative; overflow:auto; width:300px; height:40px"><span style="position:absolute; left:-9999px; top:0; color:#ccc">Parked outside a box that cannot scroll</span></div>${seen}`),
  });
  assert.deepEqual(contrastOn(result, 'collapsed'), ['Visible low contrast text'], 'the cut-off lines are never seen');
  assert.deepEqual(contrastOn(result, 'parked'), ['Visible low contrast text'], 'the parked text is never seen');
});

test('two texts that overlap inside the same scroll panel are found, in view or scrolled out', async (t) => {
  const result = await run(t, {
    inview: doc('', `<div style="height:100px; overflow-y:auto; width:500px">${planted}<div style="height:600px"></div></div>`),
    scrolledout: doc('', `<div style="height:100px; overflow-y:auto; width:500px"><div style="height:600px"></div>${planted}</div><p style="margin:0">Text under the panel</p>`),
    // The page pattern `html, body { height:100%; overflow-x:hidden }` makes the body the scroll
    // box: the document is one screen tall and everything below scrolls inside the body.
    bodyscrolls: doc('html,body{height:100%; overflow-x:hidden}', `<div style="height:1500px"></div>${planted}`),
  });
  for (const screen of ['inview', 'scrolledout', 'bodyscrolls']) {
    assert.deepEqual(overlapsOn(result, screen), ['First planted line of text / Second planted line of text'], `${screen}: exactly the planted overlap`);
  }
});

test('table cells scrolled out sideways never overlap the text beside the table', async (t) => {
  const result = await run(t, {
    sideways: doc(
      '',
      '<div style="display:flex; gap:20px; margin:20px">' +
        '<div style="overflow-x:auto; width:300px; flex:none"><table style="width:900px; border-collapse:collapse"><tbody><tr>' +
        '<td style="width:300px; padding:0">First cell</td><td style="width:300px; padding:0">Second cell</td><td style="padding:0">Third cell</td>' +
        '</tr></tbody></table></div>' +
        '<p style="margin:0; white-space:nowrap">Aside text beside the table</p>' +
        '</div>',
    ),
  });
  assert.deepEqual(overlapsOn(result, 'sideways'), [], 'the second cell paints only once the table is scrolled, never over the aside');
});

test('overflow on a box it does not apply to clips nothing: display:contents, inline boxes and table rows', async (t) => {
  const result = await run(t, {
    // No box at all, so an empty client box: clipping to it would hide everything inside.
    contents: doc('', '<div style="display:contents; overflow:hidden"><p style="color:#ccc; margin:20px">Low contrast inside a contents box</p></div>'),
    // overflow does not apply to a non-replaced inline box (its client box is empty too).
    inline: doc('', '<p style="margin:20px">Before <span style="overflow:hidden"><b style="position:relative; left:300px; color:#ccc">Low contrast inside an inline box</b></span></p>'),
    // A table row has a client box and still clips nothing: text moved out of the row shows.
    row: doc('', '<table style="border-collapse:collapse"><tbody><tr style="overflow:hidden"><td style="padding:0; width:100px"><div style="position:relative; left:400px; width:300px; color:#ccc">Low contrast moved out of its row</div></td></tr></tbody></table>'),
  });
  assert.deepEqual(contrastOn(result, 'contents'), ['Low contrast inside a contents box'], 'the text paints, so its contrast is judged');
  assert.deepEqual(contrastOn(result, 'inline'), ['Low contrast inside an inline box'], 'the text paints, so its contrast is judged');
  assert.deepEqual(contrastOn(result, 'row'), ['Low contrast moved out of its row'], 'the text paints, so its contrast is judged');
});

test('a scaled clipping box cuts text at the size it paints, not at its layout size', async (t) => {
  const result = await run(t, {
    // Zoomed to 1.5: both texts sit outside the box's layout size and inside what paints, one
    // past its right edge and one past its bottom edge. Distinct colours keep the findings apart.
    zoomed: doc('', '<div style="margin:100px 200px"><div style="transform:scale(1.5); overflow:hidden; width:200px; height:100px"><p style="margin:0; text-align:right; color:#ccc">Edge</p><p style="margin:50px 0 0; color:#ddd">Low contrast bottom</p></div></div>'),
    // A mock screen shrunk to half size: its content past the frame is cut where the frame
    // paints (160px tall), so the caption under the frame overlaps nothing.
    shrunk: doc(
      '',
      '<div style="transform:scale(.5); transform-origin:0 0; overflow:hidden; width:400px; height:300px; border:10px solid #000">' +
        '<p style="margin:0">Top of the mock screen</p><div style="height:320px"></div><p style="margin:0; white-space:nowrap">Mock text below the frame edge</p></div>' +
        '<p style="position:absolute; left:40px; top:172px; margin:0; white-space:nowrap">Caption under the small mock frame</p>',
    ),
  });
  assert.deepEqual(contrastOn(result, 'zoomed'), ['Edge', 'Low contrast bottom'], 'both texts paint, so their contrast is judged');
  assert.deepEqual(overlapsOn(result, 'shrunk'), [], 'the frame cuts its own text before the caption');
});

test('fixed text inside a box moved with translate, rotate or scale is judged where it paints', async (t) => {
  const fixedIn = (style: string): string => doc('', `<div style="margin-top:1500px; height:100px; ${style}"><p style="position:fixed; top:0; left:0; margin:0; color:#ccc">Fixed in a moved box</p></div>`);
  const result = await run(t, {
    translate: fixedIn('translate:0 0'),
    rotate: fixedIn('rotate:0deg'),
    scale: fixedIn('scale:1'),
    willchange: fixedIn('will-change:translate'),
  });
  for (const screen of ['translate', 'rotate', 'scale', 'willchange']) {
    assert.ok(codesOn(result, screen).includes('contrast'), `${screen}: the box contains the fixed text, so it scrolls into view`);
  }
});

test('text cut by its own overflow:hidden box is judged only where it paints', async (t) => {
  const result = await run(t, {
    own: doc('', '<div style="position:relative; width:200px; margin:20px"><div style="overflow:hidden; height:24px; line-height:24px">First line shown here and second line clipped away</div><span style="position:absolute; left:0; top:28px; white-space:nowrap; line-height:20px">Over the clipped line</span></div>'),
    // Image replacement: the text is pushed out of its own clipping box, so nobody sees it.
    replaced: doc('', '<div style="overflow:hidden; text-indent:-9999px; width:120px; height:30px; margin:20px; color:#ccc">Logo text replaced by an image</div><p style="margin:20px; color:#ddd">Visible low contrast text</p>'),
  });
  assert.ok(!codesOn(result, 'own').includes('text-overlap'), 'the second line never paints, so nothing overlaps it');
  assert.deepEqual(contrastOn(result, 'replaced'), ['Visible low contrast text'], 'text parked outside its own clipping box is hidden');
});

const lowBelowFold = '<p style="margin:1500px 20px 0; color:#ccc;">Low contrast below the fold</p>';

test('the root never clips: text below the first screen is judged whatever overflow html has', async (t) => {
  // The root's client box is one emulated screen tall, and its overflow belongs to the viewport,
  // which the check scrolls. Treating the root like any clipping box hides the rest of the page.
  const result = await run(t, {
    roothidden: doc('html{overflow:hidden}', `${lowBelowFold}${planted}`),
    rootscroll: doc('html{overflow-y:scroll}', `${lowBelowFold}${planted}`),
  });
  for (const screen of ['roothidden', 'rootscroll']) {
    assert.deepEqual(contrastOn(result, screen), ['Low contrast below the fold'], `${screen}: contrast below the fold`);
    assert.deepEqual(overlapsOn(result, screen), ['First planted line of text / Second planted line of text'], `${screen}: the overlap below the fold`);
  }
});

test('a body whose overflow goes to the viewport clips nothing; a body that keeps its overflow does', async (t) => {
  const outside = '<p style="margin:20px 0 0 400px; width:300px; color:#ccc;">Outside the narrow body box</p>';
  const result = await run(t, {
    // html is visible, so the body's overflow-x:hidden applies to the viewport, not the body box.
    propagates: doc('body{width:300px; overflow-x:hidden}', outside),
    // html has its own overflow, so the body keeps overflow:hidden and cuts what sticks out.
    keeps: doc('html{overflow-x:hidden} body{width:300px; overflow:hidden}', outside),
  });
  assert.deepEqual(contrastOn(result, 'propagates'), ['Outside the narrow body box'], 'the text paints beside the body box');
  assert.deepEqual(contrastOn(result, 'keeps'), [], 'the body box cuts it away');
});
