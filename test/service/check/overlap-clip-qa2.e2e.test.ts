// QA regressions for the C1 fix round (ec7124e), against a real browser (skipped, never silent,
// when none is installed). Each todo is a confirmed finding: drop the todo when it is fixed.

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

test(
  'text further down a scroll panel never overlaps text outside the panel',
  { todo: 'QA ec7124e: auto/scroll boxes no longer clip, so content below the fold overlaps the text under the panel' },
  async (t) => {
    const result = await run(t, {
      panel: doc('', `<div style="height:100px; overflow-y:auto; width:400px">${panelLines}</div><p style="margin:0; width:400px">Footer text right under the scroll panel</p>`),
    });
    assert.ok(!codesOn(result, 'panel').includes('text-overlap'), 'the panel content and the footer never paint over each other');
  },
);

test(
  'an overflow:hidden box with display:contents clips nothing',
  { todo: 'QA ec7124e: a display:contents box has no client box, so the probe clips its text to nothing' },
  async (t) => {
    const result = await run(t, {
      contents: doc('', '<div style="display:contents; overflow:hidden"><p style="color:#ccc; margin:20px">Low contrast inside a contents box</p></div>'),
    });
    assert.ok(codesOn(result, 'contents').includes('contrast'), 'the text paints, so its contrast is judged');
  },
);

test(
  'fixed text inside an element with the translate property is judged where it paints',
  { todo: 'QA ec7124e (KI-15): establishesContainingBlock ignores translate/rotate/scale' },
  async (t) => {
    const result = await run(t, {
      translate: doc('', '<div style="margin-top:1500px; height:100px; translate:0 0"><p style="position:fixed; top:0; left:0; margin:0; color:#ccc">Fixed in a translated box</p></div>'),
    });
    assert.ok(codesOn(result, 'translate').includes('contrast'));
  },
);

test(
  "text cut by its own overflow:hidden box is judged only where it paints",
  { todo: 'QA ec7124e (KI-16): paintedLines starts at the parent, so a text element never clips its own lines' },
  async (t) => {
    const result = await run(t, {
      own: doc('', '<div style="position:relative; width:200px; margin:20px"><div style="overflow:hidden; height:24px; line-height:24px">First line shown here and second line clipped away</div><span style="position:absolute; left:0; top:28px; white-space:nowrap; line-height:20px">Over the clipped line</span></div>'),
    });
    assert.ok(!codesOn(result, 'own').includes('text-overlap'), 'the second line never paints, so nothing overlaps it');
  },
);
