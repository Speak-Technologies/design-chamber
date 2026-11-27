// System screens in the system check, without a browser (documentation/specs/system-builder-depth.md
// §4.6, §13 T12b, §16): the screen plan (light, then dark twins; own viewports; problems and the cap),
// the dark twins' repeats, the left-out notes, the run through the render seam (two loops, the 70 / 40 s
// split, the design path for screens, the picture names, `--screen` alone, refusals before anything is
// written), the CLI and tool inputs, the checklist topics and the text the agent reads.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';

import { buildChildArgs, parseToolInput } from '../../../src/plugin/check-tool.ts';
import { CheckUsageError } from '../../../src/service/check/engine.ts';
import type { RenderDeps, RenderOutcome } from '../../../src/service/check/render.ts';
import { formatSystemCheckText, parseArgs, systemFindingsOf } from '../../../src/service/check/report-text.ts';
import { cliSystemStore, loadSystemScreen, runSystemCheck, SCREEN_WITH_AREA_SENTENCE, type SystemRenderInput } from '../../../src/service/check/system-run.ts';
import { createLiveFileSource } from '../../../src/service/bundle.ts';
import { darkViewportId, dedupeDarkScreenFindings, planScreenArtboards, screenSkippedFindings } from '../../../src/service/check/system-screens.ts';
import { BRIDGE_PLACEHOLDER } from '../../../src/shared/bridge-protocol.ts';
import { findingMessage } from '../../../src/shared/checks.ts';
import { CHECK_ARTBOARDS_MAX, SYSTEM_CHECK_RENDER_BUDGET_MS, SYSTEM_CHECK_SCREENS_BUDGET_MS, SYSTEM_SCREEN_MAX } from '../../../src/shared/limits.ts';
import { missingTopics, PHONE_VIEWPORT_MAX_WIDTH } from '../../../src/shared/system-checklist.ts';
import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import type { CheckFindingData, SystemDetail } from '../../../src/shared/types.ts';
import { useTmpRoot, type TmpRoot } from '../../helpers/tmp-root.ts';

const NOW = '2026-11-27T10:00:00.000Z';
const LAPTOP = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const PHONE = { id: 'phone', label: 'Phone', width: 390, height: 844 };

const detailOf = (json: Record<string, unknown>, files: string[] = [], tokensCss: string | null = null): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify(json),
    tokensCss,
    texts: {},
    files: files.map((rel) => ({ rel, bytes: 100 })),
    build: null,
  });

describe('the screen plan', () => {
  const detail = detailOf(
    {
      screens: [
        { id: 'home', title: 'Home', kind: 'page' },
        { id: 'og', title: 'Social card', kind: 'marketing', viewports: [{ id: 'og', label: 'Open Graph', width: 1200, height: 630 }] },
        { id: 'gone', title: 'Not written', kind: 'state' },
      ],
    },
    ['screens/home.html', 'screens/og.html'],
  );

  test('one artboard per screen per viewport, its own sizes replacing the system ones; a screen with a problem is not drawn', () => {
    const { plan, overLimit } = planScreenArtboards(detail, { only: null, schemes: ['light'] });
    assert.deepEqual(plan.map((art) => [art.file, art.screen, art.viewport.id, art.viewport.width, art.scheme ?? 'light']), [
      ['screens/home.html', 'home', 'laptop', 1280, 'light'],
      ['screens/home.html', 'home', 'phone', 390, 'light'],
      ['screens/og.html', 'og', 'og', 1200, 'light'],
    ]);
    assert.deepEqual(overLimit, []);
  });

  test('dark twins come after every light artboard, named <viewport>-dark and labelled dark; --screen keeps those screens', () => {
    const { plan, viewports } = planScreenArtboards(detail, { only: null, schemes: ['light', 'dark'] });
    assert.deepEqual(plan.map((art) => `${art.screen}@${art.viewport.id}${art.scheme === 'dark' ? '*' : ''}`), ['home@laptop', 'home@phone', 'og@og', 'home@laptop-dark*', 'home@phone-dark*', 'og@og-dark*']);
    assert.deepEqual(viewports.find((viewport) => viewport.id === 'phone-dark'), { id: 'phone-dark', label: 'Phone, dark', width: 390, height: 844 });
    assert.deepEqual(planScreenArtboards(detail, { only: ['og'], schemes: ['dark'] }).plan.map((art) => art.viewport.id), ['og-dark']);
  });

  test(`past ${CHECK_ARTBOARDS_MAX} artboards the rest are left out, dark twins first`, () => {
    const screens = Array.from({ length: 13 }, (_, n) => ({ id: `s${n}`, title: `Screen ${n}`, kind: 'page' }));
    const many = detailOf({ screens }, screens.map((screen) => `screens/${screen.id}.html`));
    const { plan, overLimit } = planScreenArtboards(many, { only: null, schemes: ['light', 'dark'] });
    assert.equal(plan.length, CHECK_ARTBOARDS_MAX);
    assert.equal(overLimit.length, 13 * 2 * 2 - CHECK_ARTBOARDS_MAX);
    // 26 light artboards: the first 24 fill the cap, the last screen's two and every dark twin are left out.
    assert.ok(plan.every((art) => art.scheme === undefined));
    assert.deepEqual(overLimit.slice(0, 2).map((art) => `${art.screen}@${art.viewport.id}`), ['s12@laptop', 's12@phone']);
    assert.ok(overLimit.slice(2).every((art) => art.scheme === 'dark'));
  });

  test('a dark id stays a valid viewport id (41 characters at most)', () => {
    assert.equal(darkViewportId('phone'), 'phone-dark');
    const long = 'v'.repeat(41);
    assert.equal(darkViewportId(long).length, 41);
    assert.match(darkViewportId(long), /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/);
  });
});

describe('dark twins and left-out notes', () => {
  const detail = detailOf({ screens: [{ id: 'home', title: 'Home', kind: 'page' }] }, ['screens/home.html']);
  const { plan } = planScreenArtboards(detail, { only: null, schemes: ['light', 'dark'] });
  const at = (code: CheckFindingData['code'], viewport: string, extra: Partial<CheckFindingData> = {}): CheckFindingData => ({ code, file: 'screens/home.html', screen: 'home', viewport, ...extra });

  test("a dark twin's repeat of its light finding is dropped; its own colour findings stay", () => {
    const findings = [
      at('img-alt', 'phone', { selector: 'img.hero' }),
      at('img-alt', 'phone-dark', { selector: 'img.hero' }),
      at('contrast', 'phone-dark', { selector: 'p', detail: '1.4:1' }),
      at('img-alt', 'laptop-dark', { selector: 'img.logo' }),
    ];
    assert.deepEqual(dedupeDarkScreenFindings(findings, plan).map((finding) => `${finding.code}@${finding.viewport}`), ['img-alt@phone', 'contrast@phone-dark', 'img-alt@laptop-dark']);
  });

  test('left-out notes name the first screen, say why and how to check the rest', () => {
    const [budget] = screenSkippedFindings({ overLimit: [], notRendered: plan.slice(2), stoppedBy: 'budget' });
    assert.ok(budget !== undefined);
    assert.equal(budget.file, 'screens/home.html');
    assert.equal(budget.detail, 'home at Laptop, dark; home at Phone, dark');
    assert.equal(findingMessage(budget), '2 screen artboards were not drawn (the check ran out of time). Use --screen <id> to check the rest.');
    const [failures] = screenSkippedFindings({ overLimit: [], notRendered: plan.slice(3), stoppedBy: 'failures' });
    assert.ok(failures !== undefined);
    assert.equal(findingMessage(failures), '1 screen artboard was not drawn (the browser failed three times in a row). Use --screen <id> to check the rest.');
    const [limit] = screenSkippedFindings({ overLimit: plan.slice(1), notRendered: [], stoppedBy: null });
    assert.ok(limit !== undefined);
    assert.equal(findingMessage(limit), '3 screen artboards were not drawn (the limit is 24 per check). Use --screen <id> to check the rest.');
    assert.deepEqual(screenSkippedFindings({ overLimit: [], notRendered: plan, stoppedBy: 'aborted' }), []);
    // A design's own note (no file) keeps its sentence.
    assert.equal(findingMessage({ code: 'render-skipped', file: null, screen: null, viewport: null, params: { count: 2, max: 24, reason: 'limit' } }), '2 artboards were not rendered (the limit is 24 per run). Use --screen <id> to check the rest.');
  });
});

// ---- the run, through the render seam ----

const TOKENS = ':root {\n  --bg: #ffffff;\n  --fg: #111111;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --bg: #111111; --fg: #f2f2f2; }\n}\n';
const HOME = '<!doctype html><html><head><link rel="stylesheet" href="../tokens.css"></head><body style="background:var(--bg);color:var(--fg)"><h1>HOME</h1></body></html>';

const writeSystem = async (tmp: TmpRoot, json: Record<string, unknown>, tokens = TOKENS): Promise<void> => {
  await tmp.write('_systems/acme/.chamber/state.json', { v: 1, id: 'acme', name: 'Acme', status: 'draft' });
  await tmp.write('_systems/acme/tokens.css', tokens);
  await tmp.write('_systems/acme/system.json', JSON.stringify({ tokens: { '--bg': { group: 'surface' }, '--fg': { group: 'text' } }, ...json }));
  await tmp.write('_systems/acme/screens/home.html', HOME);
  await tmp.write('_systems/acme/screens/og.html', '<!doctype html><p>OG</p>');
};

type Call = { plan: RenderDeps['plan']; runBudgetMs: number | undefined; artboardTimeoutMs: number | undefined; inspect: boolean; kind: string; docs: Record<string, string>; saved: string[] };

/** A render seam that loads every document, saves one PNG per artboard, reports all ok, and records what it was handed. */
const seam = (calls: Call[], options: { cutScreensAfter?: number; findings?: (deps: RenderDeps) => CheckFindingData[] } = {}) =>
  async (deps: RenderDeps): Promise<RenderOutcome> => {
    const call: Call = { plan: deps.plan, runBudgetMs: deps.runBudgetMs, artboardTimeoutMs: deps.artboardTimeoutMs, inspect: deps.inspect !== undefined, kind: deps.kind, docs: {}, saved: [] };
    calls.push(call);
    const screens = deps.inspect === undefined;
    const drawn = screens && options.cutScreensAfter !== undefined ? deps.plan.slice(0, options.cutScreensAfter) : deps.plan;
    const artboards = [];
    for (const art of drawn) {
      const loaded = await deps.loadDocument(art.file);
      if (loaded.ok) call.docs[art.file] = loaded.html;
      const rel = screens ? await deps.savePng(art, 1, 1, Buffer.from('png')) : null;
      if (rel !== null) call.saved.push(rel);
      artboards.push({ screen: art.screen, viewport: art.viewport.id, width: art.viewport.width, height: art.viewport.height, docHeight: 900, pngs: rel === null ? [] : [rel], ok: true, ms: 1 });
    }
    const notRendered = deps.plan.length - drawn.length;
    return { artboards, findings: options.findings?.(deps) ?? [], notRendered, stoppedBy: notRendered > 0 ? 'budget' : null, unavailable: false };
  };

const run = async (t: TestContext, json: Record<string, unknown>, over: Partial<SystemRenderInput> = {}, seamOptions: Parameters<typeof seam>[1] = {}) => {
  const tmp = await useTmpRoot(t);
  await writeSystem(tmp, json);
  const calls: Call[] = [];
  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const result = await runSystemCheck(store, 'acme', {
      now: new Date(NOW),
      tool: 'cli',
      render: { browserPath: '/no/browser/needed', probeSource: '', platform: process.platform, isRoot: false, renderLoop: seam(calls, seamOptions), ...over },
    });
    return { ...result, calls, tmp };
  } finally {
    await store.dispose();
  }
};

const SCREENS = { screens: [{ id: 'home', title: 'Home', kind: 'page' }, { id: 'og', title: 'Social card', kind: 'marketing', viewports: [{ id: 'og', label: 'Open Graph', width: 1200, height: 630 }] }] };

describe('a run with screens', () => {
  test('no screens: one board loop with the whole budget, and no screens part in the report', async (t) => {
    const { calls, report } = await run(t, {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.inspect, true);
    assert.equal(calls[0]?.runBudgetMs, SYSTEM_CHECK_RENDER_BUDGET_MS);
    assert.ok(report.render !== null && !('screens' in report.render));
  });

  test('the board keeps 70 s, then the screens get 40 s on the design path, light then dark, pictures named per screen and viewport', async (t) => {
    const { calls, report, pngs } = await run(t, SCREENS);
    assert.equal(calls.length, 2);
    const [board, screens] = calls;
    assert.ok(board !== undefined && screens !== undefined);
    assert.equal(board.runBudgetMs, SYSTEM_CHECK_RENDER_BUDGET_MS - SYSTEM_CHECK_SCREENS_BUDGET_MS);
    assert.equal(board.runBudgetMs, 70_000);
    assert.equal(screens.runBudgetMs, 40_000);
    assert.equal(screens.inspect, false, 'screens take the design probe and analyze.ts');
    assert.equal(screens.kind, 'page');
    assert.deepEqual(screens.plan.map((art) => `${art.screen}@${art.viewport.id}${art.scheme === 'dark' ? ' dark' : ''}`), ['home@laptop', 'home@phone', 'og@og', 'home@laptop-dark dark', 'home@phone-dark dark', 'og@og-dark dark']);
    // Bundled from the system's files in export mode: tokens inlined, no bridge placeholder.
    const home = screens.docs['screens/home.html'] ?? '';
    assert.ok(home.includes('--fg: #111111;') && home.includes('HOME'));
    assert.ok(!home.includes(BRIDGE_PLACEHOLDER) && !home.includes('../tokens.css'));
    assert.deepEqual(screens.saved.map((rel) => path.posix.basename(rel)), ['screen-home@laptop.png', 'screen-home@phone.png', 'screen-og@og.png', 'screen-home@laptop-dark.png', 'screen-home@phone-dark.png', 'screen-og@og-dark.png']);
    for (const file of pngs.filter((png) => png.includes('screen-'))) assert.ok(existsSync(file), file);
    assert.equal(pngs.filter((png) => path.basename(png).startsWith('screen-')).length, 6);
    const render = report.render;
    assert.ok(render !== null && render.screens !== undefined);
    assert.equal(render.state, 'done');
    assert.deepEqual(render.screens.artboards.map((artboard) => artboard.viewport), ['laptop', 'phone', 'og', 'laptop-dark', 'phone-dark', 'og-dark']);
  });

  test('--scheme light draws no dark twins; --area draws no screens', async (t) => {
    const light = await run(t, SCREENS, { scheme: 'light' });
    assert.deepEqual(light.calls[1]?.plan.map((art) => art.viewport.id), ['laptop', 'phone', 'og']);
    const area = await run(t, SCREENS, { area: 'components' });
    assert.equal(area.calls.length, 1);
    assert.equal(area.calls[0]?.runBudgetMs, SYSTEM_CHECK_RENDER_BUDGET_MS);
  });

  test('--screen draws only those screens, skips the board and gets the whole budget', async (t) => {
    const { calls, report } = await run(t, SCREENS, { screens: ['og', 'og'] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.inspect, false);
    assert.equal(calls[0]?.runBudgetMs, SYSTEM_CHECK_RENDER_BUDGET_MS);
    assert.deepEqual(calls[0]?.plan.map((art) => art.viewport.id), ['og', 'og-dark']);
    assert.deepEqual(report.render?.widths, []);
    assert.deepEqual(report.render?.areas, []);
  });

  test('an unknown --screen id, or --screen with --area, is refused before anything is drawn or written', async (t) => {
    for (const over of [{ screens: ['nope'] }, { screens: ['home'], area: 'patterns' as const }]) {
      const tmp = await useTmpRoot(t);
      await writeSystem(tmp, SCREENS);
      const calls: Call[] = [];
      const store = cliSystemStore(tmp.root, { version: 1 });
      try {
        await assert.rejects(
          runSystemCheck(store, 'acme', { now: new Date(NOW), tool: 'cli', render: { browserPath: '/x', probeSource: '', platform: process.platform, isRoot: false, renderLoop: seam(calls), ...over } }),
          (error: unknown) => error instanceof CheckUsageError && (over.area === undefined ? /There is no screen "nope" in this design system/.test(error.message) : error.message === SCREEN_WITH_AREA_SENTENCE),
        );
      } finally {
        await store.dispose();
      }
      assert.equal(calls.length, 0);
      assert.equal(existsSync(tmp.at('_systems/acme/.chamber/check.json')), false);
      assert.equal(existsSync(tmp.at('_systems/acme/.chamber/check')), false);
    }
  });

  test('screens the time cut are said, with how to check the rest; the run is partial', async (t) => {
    const { report } = await run(t, SCREENS, {}, { cutScreensAfter: 2 });
    const render = report.render;
    assert.ok(render !== null);
    assert.equal(render.state, 'partial');
    const skipped = render.findings.filter((finding) => finding.code === 'render-skipped');
    assert.equal(skipped.length, 1);
    assert.equal(findingMessage(skipped[0] as CheckFindingData), '4 screen artboards were not drawn (the check ran out of time). Use --screen <id> to check the rest.');
    assert.equal(skipped[0]?.file, 'screens/og.html');
  });

  test('a screen finding names its file and viewport, and the text lists the screen pictures', async (t) => {
    const overflow = (deps: RenderDeps): CheckFindingData[] =>
      deps.inspect !== undefined ? [] : [{ code: 'overflow-x', file: 'screens/home.html', screen: 'home', viewport: 'phone', params: { px: 600, width: 390 } }];
    const { report, pngs } = await run(t, SCREENS, {}, { findings: overflow });
    const found = systemFindingsOf(report).find((finding) => finding.code === 'overflow-x');
    assert.equal(found?.message, 'screens/home.html @ Phone 390×844: the content is 600px wide, wider than the 390px viewport.');
    const firstPng = pngs[0] ?? '';
    const text = formatSystemCheckText({ report, name: 'Acme', reportPath: null, pngs, runDir: path.dirname(firstPng) });
    assert.match(text, /Screen pictures in \S+, one per screen and viewport\./);
    assert.match(text, /  screen-home@phone\.png  home at Phone 390x844, page 900px tall/);
    assert.match(text, /  screen-og@og-dark\.png  og at Open Graph, dark 1200x630/);
  });
});

describe('loading a screen for the check', () => {
  test('read through the contained source: a reference or a link out of the system is never inlined; over the cap is not drawn', async (t) => {
    const tmp = await useTmpRoot(t);
    const outside = await useTmpRoot(t, 'dc-outside-');
    const secret = await outside.write('secret.css', 'p { color: OUTSIDE-SECRET; }');
    await tmp.write('_systems/other/tokens.css', ':root { --leak: OTHER-SYSTEM-SECRET; }');
    await tmp.write('_systems/acme/screens/home.html', '<link rel="stylesheet" href="../../other/tokens.css"><link rel="stylesheet" href="../linked.css"><p>HOME</p>');
    await symlink(secret, tmp.at('_systems/acme/linked.css'));
    await symlink(secret, tmp.at('_systems/acme/screens/link.html'));
    await tmp.write('_systems/acme/screens/big.html', 'a'.repeat(SYSTEM_SCREEN_MAX + 1));
    const source = createLiveFileSource(tmp.at('_systems/acme'));
    const home = await loadSystemScreen(source, 'screens/home.html');
    assert.ok(home.ok);
    assert.ok(home.html.includes('HOME') && !home.html.includes('SECRET'));
    assert.deepEqual(await loadSystemScreen(source, 'screens/link.html'), { ok: false, reason: 'missing' });
    assert.deepEqual(await loadSystemScreen(source, 'screens/big.html'), { ok: false, reason: 'missing' });
    assert.deepEqual(await loadSystemScreen(source, 'screens/none.html'), { ok: false, reason: 'missing' });
  });
});

describe('inputs', () => {
  test('dc: --screen goes with --system (repeatable), never with --area or --static, ids as system.json writes them', () => {
    const command = parseArgs(['check', '--system', 'acme', '--screen', 'home', '--screen=og']);
    assert.equal(command.kind, 'check-system');
    assert.deepEqual(command.kind === 'check-system' ? command.screens : null, ['home', 'og']);
    assert.match((parseArgs(['check', '--system', 'acme', '--screen', 'home', '--area', 'brand']) as { message: string }).message, /can't be combined with --area/);
    assert.match((parseArgs(['check', '--system', 'acme', '--screen', 'home', '--static']) as { message: string }).message, /leave out --static/);
    for (const bad of ['Home', '../x', 'a'.repeat(41)]) assert.equal(parseArgs(['check', '--system', 'acme', '--screen', bad]).kind, 'error', bad);
  });

  test('design_check: a system takes screens (ids, de-duplicated, at most 16, not with area or static); the child gets --screen', () => {
    assert.deepEqual(parseToolInput({ system: 'acme', screens: ['home', 'og', 'home'] }), { ok: true, system: 'acme', static: false, screens: ['home', 'og'] });
    assert.deepEqual(parseToolInput({ system: 'acme', screens: 'home, og' }), { ok: true, system: 'acme', static: false, screens: ['home', 'og'] });
    assert.deepEqual(parseToolInput({ system: 'acme', screens: [] }), { ok: true, system: 'acme', static: false });
    for (const input of [
      { system: 'acme', screens: ['../x'] },
      { system: 'acme', screens: ['Home'] },
      { system: 'acme', screens: [7] },
      { system: 'acme', screens: ['home'], area: 'brand' },
      { system: 'acme', screens: ['home'], static: true },
      { system: 'acme', screens: Array.from({ length: 17 }, (_, n) => `s${n}`) },
    ]) {
      assert.equal(parseToolInput(input).ok, false, JSON.stringify(input));
    }
    assert.deepEqual(buildChildArgs('/x/dc.mjs', { system: 'acme', static: false, screens: ['home', 'og'] }), ['/x/dc.mjs', 'check', '--system', 'acme', '--screen', 'home', '--screen', 'og']);
  });
});

describe('the checklist', () => {
  const full = (json: Record<string, unknown>, files: string[]) => detailOf({ depth: 'full', coverage: ['patterns', 'brand'], ...json }, files);
  const screen = (kind: string, viewports?: { id: string; width: number; height: number }[]) => ({ id: 'one', title: 'One', kind, ...(viewports ? { viewports } : {}) });

  test(`responsive: a page screen with a viewport at most ${PHONE_VIEWPORT_MAX_WIDTH}px wide`, () => {
    const files = ['screens/one.html'];
    assert.ok(!missingTopics(full({ screens: [screen('page')] }, files), 'patterns').includes('responsive'), 'the default Phone is 390');
    assert.ok(!missingTopics(full({ screens: [screen('page', [{ id: 'p', width: PHONE_VIEWPORT_MAX_WIDTH, height: 900 }])] }, files), 'patterns').includes('responsive'));
    assert.ok(missingTopics(full({ screens: [screen('page', [{ id: 'p', width: PHONE_VIEWPORT_MAX_WIDTH + 1, height: 900 }])] }, files), 'patterns').includes('responsive'));
    assert.ok(missingTopics(full({ screens: [screen('pattern')] }, files), 'patterns').includes('responsive'), 'a pattern screen does not count');
    assert.ok(missingTopics(full({}, []), 'patterns').includes('responsive'));
  });

  test('marketing: a marketing screen counts', () => {
    assert.ok(!missingTopics(full({ screens: [screen('marketing', [{ id: 'og', width: 1200, height: 630 }])] }, ['screens/one.html']), 'brand').includes('marketing'));
    assert.ok(missingTopics(full({ screens: [screen('page')] }, ['screens/one.html']), 'brand').includes('marketing'));
  });
});
