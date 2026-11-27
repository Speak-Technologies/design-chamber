// System screens on the living page (documentation/specs/system-builder-depth.md §4.6, §13 T14): one
// picture per viewport at the viewport's size and scale 1, under the screen's area with its title and
// viewport label, never the screen's markup, and the page still passes both safety scans.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { decodePng } from '../../../src/service/check/png-stitch.ts';
import { createLiveFileSource } from '../../../src/service/bundle.ts';
import { configureLivingExamples, exampleCacheKey, planScreenShot, renderExamplePngs, type ExampleDeps, type ExampleShot } from '../../../src/service/systems/living-examples.ts';
import { buildLivingPage, screenShotKey, type LivingExampleShot } from '../../../src/service/systems/living-html.ts';
import { livingPagesIdle, parseLivingRecord, picturesToDrop, regenerateLivingPage, toLivingShot } from '../../../src/service/systems/living-page.ts';
import { livingCssProblems, scanLivingPage } from '../../../src/service/systems/living-safe.ts';
import { refreshSnapshot } from '../../../src/service/systems/snapshot.ts';
import { resolveBrowser } from '../../../src/service/chrome.ts';
import { LIVING_EXAMPLE_GENERATOR_VERSION, LIVING_PAGE_GENERATOR_VERSION, SYSTEM_SCREEN_MAX } from '../../../src/shared/limits.ts';
import { buildSystemDetail, parseSystemState } from '../../../src/shared/system-json.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { createFakeBrowser, type FakeBrowser } from './fake-cdp.ts';
import { setupRepo, SYSTEM_JSON } from './repo-fixture.ts';

const NOW = '2026-11-27T10:00:00.000Z';
// Built from parts so no file in the repo holds a whole key shape.
const AWS_KEY = `${'AKIA'}${'QWERTYUI'}${'23456789'}`;

const TOKENS = ':root {\n  --brand: #1a73e8;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --brand: #8ab4f8; }\n}\n';

const screen = (mark: string, extra = ''): string =>
  `<!doctype html><html><head><link rel="stylesheet" href="../tokens.css"><style>html,body{margin:0;height:100%;background:var(--brand)}</style></head><body><h1 data-mark="${mark}">${mark}</h1>${extra}<script>document.body.innerHTML = "SCRIPTRAN"</script></body></html>`;

const SCREENS = [
  { id: 'home', title: 'Home <page>', kind: 'page' },
  { id: 'card', title: 'Social card', kind: 'marketing' },
];
const FILES: Record<string, string> = { 'tokens.css': TOKENS, 'screens/home.html': screen('SCREENMARK-home'), 'screens/card.html': screen('SCREENMARK-card') };

const detailOf = (json: Record<string, unknown>, files: Record<string, string> = FILES): SystemDetail =>
  buildSystemDetail({
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify(json),
    tokensCss: files['tokens.css'] ?? TOKENS,
    texts: {},
    files: Object.entries(files).map(([rel, text]) => ({ rel, bytes: Buffer.byteLength(text) })),
    build: null,
  });

type Rig = { ctx: FakeContext; systemDir: string; run: (detail: SystemDetail, deps: ExampleDeps) => Promise<ExampleShot[]> };

const rig = async (t: TestContext, files: Record<string, string> = FILES): Promise<Rig> => {
  const tmp = await useTmpRoot(t, 'dc-living-sc-');
  const systemDir = tmp.at('_systems/acme');
  for (const [rel, text] of Object.entries(files)) await tmp.write(`_systems/acme/${rel}`, text);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const run = (detail: SystemDetail, deps: ExampleDeps): Promise<ExampleShot[]> => {
    configureLivingExamples(ctx, { settleMs: 0, ...deps });
    return renderExamplePngs(ctx, detail, { schemes: ['light', 'dark'], signal: new AbortController().signal, source: createLiveFileSource(systemDir), id: 'acme', systemDir });
  };
  return { ctx, systemDir, run };
};

const picturesOf = (shots: readonly ExampleShot[]): Record<string, LivingExampleShot[]> => {
  const out: Record<string, LivingExampleShot[]> = {};
  for (const shot of shots) (out[shot.component] ??= []).push(toLivingShot(shot));
  return out;
};

const pageOf = (detail: SystemDetail, shots: readonly ExampleShot[]): string =>
  buildLivingPage(detail, { revision: 3, generatedAt: NOW, coverage: detail.coverage, redact: [], examples: picturesOf(shots) }).html;

const metricsSent = (fake: FakeBrowser): unknown[] => fake.sends.filter((send) => send.method === 'Emulation.setDeviceMetricsOverride').map((send) => send.params);
const section = (html: string, id: string): string => new RegExp(`<section class="dc-section" id="dc-section-${id}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';

test('two screens at two viewports are four pictures: light, at the viewport size and scale 1, with scripts off and nothing leaving', async (t) => {
  const files = { ...FILES, 'screens/home.html': screen('SCREENMARK-home', '<img src="https://example.com/track.png" alt="">') };
  const { run } = await rig(t, files);
  const fake = createFakeBrowser();
  const detail = detailOf({ screens: SCREENS }, files);
  const shots = await run(detail, { openBrowser: fake.open });
  assert.deepEqual(
    shots.map((shot) => [shot.component, shot.scheme, shot.width, shot.height, shot.scale, shot.reason]),
    [
      ['screen:home@laptop', 'light', 1280, 800, 1, null],
      ['screen:home@phone', 'light', 390, 844, 1, null],
      ['screen:card@laptop', 'light', 1280, 800, 1, null],
      ['screen:card@phone', 'light', 390, 844, 1, null],
    ],
  );
  assert.deepEqual(metricsSent(fake).slice(0, 2), [
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: false },
  ]);
  assert.ok(!fake.sends.some((send) => send.method === 'Page.getLayoutMetrics'), 'a screen is its viewport, not its content height');
  assert.ok(fake.sends.some((send) => send.method === 'Emulation.setScriptExecutionDisabled' && send.params.value === true));
  // The linked tokens travel inside the one document; the remote picture is asked for and refused.
  assert.ok(fake.served.every((doc) => doc.html.includes('--brand: #1a73e8')));
  assert.ok(fake.requests.some((request) => request.url === 'https://example.com/track.png' && request.answer === 'fail'));
  // A second run draws nothing: the pictures are cached.
  const again = createFakeBrowser();
  assert.equal((await run(detail, { openBrowser: again.open })).filter((shot) => shot.png !== null).length, 4);
  assert.equal(again.opened, 0);
});

test("a screen's own viewports replace the system's", async (t) => {
  const { run } = await rig(t);
  const detail = detailOf({ viewports: [{ id: 'wide', label: 'Wide', width: 1440, height: 900 }], screens: [SCREENS[0], { ...SCREENS[1], viewports: [{ id: 'og', label: 'Link card', width: 1200, height: 630 }] }] });
  const shots = await run(detail, { openBrowser: createFakeBrowser().open });
  assert.deepEqual(shots.map((shot) => [shot.component, shot.width, shot.height]), [['screen:home@wide', 1440, 900], ['screen:card@og', 1200, 630]]);
});

test('the page shows each picture under its area with the title and viewport; the screen markup is never in it', async (t) => {
  const { run } = await rig(t);
  const detail = detailOf({ screens: SCREENS });
  const html = pageOf(detail, await run(detail, { openBrowser: createFakeBrowser().open }));
  const patterns = section(html, 'patterns');
  const brand = section(html, 'brand');
  assert.ok(patterns.includes('<h3>Screens</h3>') && patterns.includes('<h4>Home &lt;page&gt;</h4>'), patterns);
  assert.ok(brand.includes('<h4>Social card</h4>') && !brand.includes('Home'), brand);
  assert.ok(!patterns.includes('No patterns or voice guidance yet.'));
  assert.equal(html.split('<img src="data:image/png;base64,').length - 1, 4);
  assert.ok(patterns.includes('alt="Home &lt;page&gt;, Laptop" width="1280" height="800"><figcaption>Laptop · 1280 × 800</figcaption>'), patterns);
  assert.ok(patterns.includes('width="390" height="844"><figcaption>Phone · 390 × 844</figcaption>'));
  for (const mark of ['SCREENMARK', 'SCRIPTRAN', '<iframe', '<script', 'data-dc-entry']) assert.ok(!html.includes(mark), mark);
  assert.deepEqual(scanLivingPage(html).reasons, []);
  for (const line of (/<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '').split('\n')) assert.deepEqual(livingCssProblems(line), [], line);
});

test('a screen that fails says so: a missing file, one over the cap, a link out of the system, and no browser', async (t) => {
  const files: Record<string, string> = { 'tokens.css': TOKENS, 'screens/long.html': 'x'.repeat(SYSTEM_SCREEN_MAX + 1), 'screens/out.html': screen('SCREENMARK-out', '<img src="../../../secret.png" alt="">') };
  const { run } = await rig(t, files);
  const detail = detailOf({ screens: [{ id: 'gone', title: 'Gone', kind: 'page' }, { id: 'long', title: 'Long', kind: 'page' }, { id: 'out', title: 'Out', kind: 'page' }] }, files);
  const fake = createFakeBrowser();
  const shots = await run(detail, { openBrowser: fake.open });
  assert.deepEqual(shots.filter((shot) => shot.component.startsWith('screen:gone') || shot.component.startsWith('screen:long')).map((shot) => [shot.png, shot.reason]), Array.from({ length: 4 }, () => [null, 'render-failed']));
  // The reference out of the system is not followed: nothing outside is read into the document.
  assert.ok(fake.served.every((doc) => !doc.html.includes('data:image/png')));
  const html = pageOf(detail, shots);
  assert.equal(section(html, 'patterns').split('<p class="dc-muted">This example couldn&#39;t be shown.</p><figcaption>').length - 1, 4);
  assert.deepEqual(scanLivingPage(html).reasons, []);

  const alone = detailOf({ screens: [SCREENS[0]] });
  const none = pageOf(alone, await (await rig(t)).run(alone, { openBrowser: null }));
  assert.ok(none.includes('<p class="dc-muted">This example couldn&#39;t be shown. Chrome or Edge isn&#39;t available.</p>'), section(none, 'patterns'));
});

test('a system without screens writes no screens block', () => {
  const html = pageOf(detailOf({}), []);
  assert.ok(!html.includes('lp-screen-shots">') && !html.includes('<h3>Screens</h3>'));
  assert.ok(section(html, 'patterns').includes('No patterns or voice guidance yet.'));
});

test('example cache keys are what they were; a screen key follows its width and height', () => {
  assert.equal(LIVING_EXAMPLE_GENERATOR_VERSION, 2);
  assert.equal(exampleCacheKey({ exampleHtml: '<b>x</b>', tokensCss: ':root{}', fontsCss: '', scheme: 'light' }), '50f13d7a504d6f9dcb73bae5563b67b2ca2d65c0759841b2b7b1e055676fa8b4');
  const key = (width: number, height: number): string => planScreenShot('screen:a@b', '<p>x</p>', { width, height }).key;
  assert.notEqual(key(390, 844), key(390, 845));
  assert.notEqual(key(390, 844), key(391, 844));
  // A screen at the example width is still not the example's picture (scale and height differ).
  assert.notEqual(key(720, 800), exampleCacheKey({ exampleHtml: '<p>x</p>', tokensCss: '', fontsCss: '', scheme: 'light' }));
  // Over the page bound, a screen picture can be dropped like any other: its key splits at the scheme.
  assert.deepEqual(picturesToDrop({ [screenShotKey('home', 'laptop')]: [{ scheme: 'light', png: { base64: 'AAAA', width: 1, height: 1 }, reason: null }] }, 1), ['screen:home@laptop:light']);
});

test('a repo system stages its screens as pictures, records the one that failed, and a secret shape in a title names the screen', async (t) => {
  assert.equal(LIVING_PAGE_GENERATOR_VERSION, 6, 'one bump for the wave (T10b); screens add no second one');
  const repo = await setupRepo(t);
  t.after(() => livingPagesIdle(repo.ctx));
  const json = JSON.parse(SYSTEM_JSON) as Record<string, unknown>;
  await repo.tmp.write('shop/design-system/screens/home.html', screen('SCREENMARK-home'));
  const write = (screens: unknown[]): Promise<string> => repo.tmp.write('shop/design-system/system.json', `${JSON.stringify({ ...json, screens })}\n`);
  await write([{ id: 'home', title: 'Home', kind: 'page' }, { id: 'gone', title: 'Gone', kind: 'page' }]);
  const id = await repo.repoSystem();
  const browser = createFakeBrowser();
  configureLivingExamples(repo.ctx, { openBrowser: browser.open, settleMs: 0 });
  assert.equal((await refreshSnapshot(repo.ctx, id, { by: 'agent' })).kind, 'refreshed');
  await livingPagesIdle(repo.ctx);
  const chamber = async (name: string): Promise<string> => readFile(path.join(await repo.systems.dir(id), '.chamber', name), 'utf8');
  const html = await chamber('living-page.html');
  assert.deepEqual(scanLivingPage(html).reasons, []);
  assert.ok(!html.includes('SCREENMARK'));
  assert.equal(html.split('alt="Home, ').length - 1, 2);
  const record = parseLivingRecord(await chamber('living-page.json'));
  assert.deepEqual(record?.secrets, []);
  assert.deepEqual(
    record?.omitted.filter((item) => item.name.startsWith('Gone')),
    [{ what: 'example', name: 'Gone (Laptop)', reason: 'render-failed' }, { what: 'example', name: 'Gone (Phone)', reason: 'render-failed' }],
  );

  await write([{ id: 'home', title: `Key ${AWS_KEY}`, kind: 'page' }]);
  assert.equal((await refreshSnapshot(repo.ctx, id, { by: 'agent' })).kind, 'refreshed');
  await livingPagesIdle(repo.ctx);
  await regenerateLivingPage(repo.ctx, id, { source: 'snapshot' });
  const blocked = parseLivingRecord(await chamber('living-page.json'));
  assert.ok((blocked?.secrets.length ?? 0) > 0);
  assert.ok(blocked?.secrets.every((hit) => hit.where === 'screen:home'), JSON.stringify(blocked?.secrets));
});

// ---- in Chrome ----

test('in Chrome: each screen is drawn at its viewport size with its linked tokens, and its script does not run', async (t) => {
  if (chromeOrSkip(t) === null) return;
  const files = {
    ...FILES,
    'screens/home.html':
      '<!doctype html><html><head><link rel="stylesheet" href="../tokens.css"><style>html,body{margin:0;height:100%;background:var(--brand)}</style></head><body><script>document.body.style.background = "red"</script></body></html>',
  };
  const { ctx, systemDir } = await rig(t, files);
  assert.ok(resolveBrowser(ctx.settings.read()).path !== null);
  const detail = detailOf({ viewports: [{ id: 'laptop', label: 'Laptop', width: 1280, height: 800 }, { id: 'phone', label: 'Phone', width: 390, height: 844 }], screens: [SCREENS[0]] }, files);
  const shots = await renderExamplePngs(ctx, detail, { schemes: ['light'], signal: new AbortController().signal, source: createLiveFileSource(systemDir), id: 'acme', systemDir });
  assert.deepEqual(shots.map((shot) => [shot.width, shot.height, shot.reason]), [[1280, 800, null], [390, 844, null]]);
  for (const shot of shots) {
    assert.ok(shot.png !== null);
    const image = decodePng(Buffer.from(shot.png));
    // The bottom right pixel: the whole viewport is painted with the token's light value.
    const row = image.rows[image.height - 1];
    const at = (image.width - 1) * image.channels;
    assert.deepEqual([row?.[at], row?.[at + 1], row?.[at + 2]], [0x1a, 0x73, 0xe8]);
  }
});
