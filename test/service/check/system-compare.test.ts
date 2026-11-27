// Compare sheets (system-builder-depth T18) without a browser: the `screens[].source` reader and its path
// refusals, a link in sources/screens/ never read, the picture header reader, the side-by-side stitch, which
// artboards get a sheet, the sheets themselves over a fake transcode, the notes' sentences, the text, and
// that copy-on-link and the living page never carry a source.

import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { test } from 'node:test';

import { CAPTION_BAND, decodePng, encodePng, pictureSize, PngStitchError, SIDE_BY_SIDE_GAP, stitchPngs, stitchSideBySide } from '../../../src/service/check/png-stitch.ts';
import type { PlannedArtboard, RenderOutcome } from '../../../src/service/check/render.ts';
import { formatSystemCheckText } from '../../../src/service/check/report-text.ts';
import { compareBudgetNote, planCompares, sourceDocument, type CompareSource } from '../../../src/service/check/system-compare.ts';
import { cliSystemStore, makeCompareSheets, readCompareSources, sliceOverlaps } from '../../../src/service/check/system-run.ts';
import { systemCheckReport } from '../../../src/service/check/system-static.ts';
import { createLiveFileSource } from '../../../src/service/bundle.ts';
import { buildLivingPage } from '../../../src/service/systems/living-html.ts';
import { isCopyReference, planCopy } from '../../../src/service/systems/link.ts';
import { findingMessage } from '../../../src/shared/checks.ts';
import { SYSTEM_COMPARE_SHEETS_MAX, SYSTEM_IMAGE_MAX_BYTES } from '../../../src/shared/limits.ts';
import { buildSystemDetail, parseSystemState, SCREEN_SOURCE_SENTENCE, type SystemDetailSource } from '../../../src/shared/system-json.ts';
import type { ArtboardCheck, Viewport } from '../../../src/shared/types.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const NOW = '2026-11-27T10:00:00.000Z';
const LAPTOP: Viewport = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const PHONE: Viewport = { id: 'phone', label: 'Phone', width: 390, height: 844 };

const detailOf = (source: unknown, files: { rel: string; bytes: number }[] = [{ rel: 'sources/screens/home.png', bytes: 100 }]) => {
  const input: SystemDetailSource = {
    id: 'acme',
    dir: '/designs/_systems/acme',
    state: parseSystemState({ name: 'Acme', created: NOW, updated: NOW }, 'acme', NOW),
    systemJson: JSON.stringify({ version: 1, screens: [{ id: 'home', title: 'Home', kind: 'page', ...(source === undefined ? {} : { source }) }] }),
    tokensCss: null,
    texts: {},
    files: [{ rel: 'screens/home.html', bytes: 100 }, ...files],
    build: null,
  };
  return buildSystemDetail(input);
};

/** A solid PNG of `width`×`height` in one colour (real pixels, decodable). */
const solid = (width: number, height: number, rgb: [number, number, number]): Buffer =>
  encodePng({ width, height, channels: 3, rows: Array.from({ length: height }, () => Buffer.from(Array.from({ length: width }, () => rgb).flat())) });

/** A JPEG's first bytes up to its frame header: SOI, an APP0 segment, SOF0 with the size. Enough for the header reader. */
const jpegHeader = (width: number, height: number): Buffer =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);

// ---- the reader ----

test('a screen source is exactly sources/screens/<name>.png or .jpg; anything else is an entry problem and the screen still draws', () => {
  assert.equal(detailOf('sources/screens/home.png').screens[0]?.source, 'sources/screens/home.png');
  assert.equal(detailOf('sources/screens/Home_1.JPG', [{ rel: 'sources/screens/Home_1.JPG', bytes: 9 }]).screens[0]?.source, 'sources/screens/Home_1.JPG');
  assert.equal(detailOf('sources/screens/a.jpeg', [{ rel: 'sources/screens/a.jpeg', bytes: 9 }]).screens[0]?.source, 'sources/screens/a.jpeg');
  assert.equal(detailOf(undefined).screens[0]?.source, null);
  assert.equal(detailOf(null).screens[0]?.source, null);
  for (const bad of [
    '../home.png',
    'sources/screens/../home.png',
    'sources/screens/..home.png',
    'sources\\screens\\home.png',
    'sources/screens\\home.png',
    'C:/sources/screens/home.png',
    'C:sources/screens/home.png',
    '/sources/screens/home.png',
    '//host/sources/screens/home.png',
    'sources/screens/sub/home.png',
    'sources/home.png',
    'assets/logos/home.png',
    'sources/screens/home.gif',
    'sources/screens/home.png ',
    'sources/screens/%2e%2e.png',
    'sources/screens/.hidden.png',
    'SOURCES/screens/home.png',
    42,
    { file: 'sources/screens/home.png' },
  ]) {
    const detail = detailOf(bad, [{ rel: typeof bad === 'string' ? bad : 'x', bytes: 9 }]);
    assert.equal(detail.screens[0]?.source, null, String(bad));
    assert.equal(detail.screens[0]?.problem, null, `${String(bad)}: the screen still draws`);
    assert.ok(detail.problems.some((problem) => problem.entry === 'screens.home' && problem.message === SCREEN_SOURCE_SENTENCE), `${String(bad)}: ${JSON.stringify(detail.problems)}`);
  }
  const missing = detailOf('sources/screens/home.png', []);
  assert.equal(missing.screens[0]?.source, null);
  assert.ok(missing.problems.some((problem) => problem.message === 'sources/screens/home.png is missing.'), JSON.stringify(missing.problems));
  const huge = detailOf('sources/screens/home.png', [{ rel: 'sources/screens/home.png', bytes: SYSTEM_IMAGE_MAX_BYTES + 1 }]);
  assert.equal(huge.screens[0]?.source, null);
  assert.ok(huge.problems.some((problem) => /too large/.test(problem.message)));
});

test('a link in sources/screens/ is never read: the store does not list it, so the source reads as missing', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/system.json', JSON.stringify({ version: 1, screens: [{ id: 'home', title: 'Home', kind: 'page', source: 'sources/screens/home.png' }] }));
  await tmp.write('_systems/acme/screens/home.html', '<p>Home</p>');
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready' });
  await mkdir(tmp.at('outside'), { recursive: true });
  await writeFile(tmp.at('outside/secret.png'), solid(10, 10, [1, 2, 3]));
  await mkdir(tmp.at('_systems/acme/sources/screens'), { recursive: true });
  await symlink(tmp.at('outside/secret.png'), tmp.at('_systems/acme/sources/screens/home.png'));
  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const detail = buildSystemDetail(await store.get('acme'));
    assert.equal(detail.screens[0]?.source, null);
    assert.ok(detail.problems.some((problem) => problem.message === 'sources/screens/home.png is missing.'), JSON.stringify(detail.problems));
    // Even handed the path, the contained file source refuses to read through the link.
    const read = await readCompareSources(createLiveFileSource(await store.filesDir('acme')), { screens: [{ ...detail.screens[0], id: 'home', title: 'Home', kind: 'page', viewports: null, problem: null, source: 'sources/screens/home.png' }] }, [
      { file: 'screens/home.html', screen: 'home', viewport: LAPTOP },
    ]);
    assert.deepEqual(read, []);
  } finally {
    await store.dispose();
  }
});

test('readCompareSources checks the bytes against the name: a PNG named .jpg is unreadable, a real one has its size', async (t) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/sources/screens/good.png', solid(1280, 20, [9, 9, 9]));
  await tmp.write('_systems/acme/sources/screens/fake.jpg', solid(390, 20, [9, 9, 9]));
  await tmp.write('_systems/acme/sources/screens/real.jpg', jpegHeader(390, 700));
  const screens = [
    { id: 'a', title: 'A', kind: 'page' as const, viewports: null, problem: null, source: 'sources/screens/good.png' },
    { id: 'b', title: 'B', kind: 'page' as const, viewports: null, problem: null, source: 'sources/screens/fake.jpg' },
    { id: 'c', title: 'C', kind: 'page' as const, viewports: null, problem: null, source: 'sources/screens/real.jpg' },
    { id: 'd', title: 'D', kind: 'page' as const, viewports: null, problem: null, source: 'sources/screens/good.png' },
  ];
  const plan: PlannedArtboard[] = ['a', 'b', 'c'].map((id) => ({ file: `screens/${id}.html`, screen: id, viewport: LAPTOP }));
  const read = await readCompareSources(createLiveFileSource(tmp.at('_systems/acme')), { screens }, plan);
  assert.deepEqual(read.map((one) => (one.ok ? [one.screen, one.type, one.width, one.height] : [one.screen, 'unreadable'])), [
    ['a', 'png', 1280, 20],
    ['b', 'unreadable'],
    ['c', 'jpeg', 390, 700],
  ], 'd is not drawn, so it is not read');
});

// ---- pictures ----

test('pictureSize reads PNG and JPEG headers and nothing else', () => {
  assert.deepEqual(pictureSize(solid(12, 7, [0, 0, 0])), { type: 'png', width: 12, height: 7 });
  assert.deepEqual(pictureSize(jpegHeader(1440, 3200)), { type: 'jpeg', width: 1440, height: 3200 });
  assert.equal(pictureSize(Buffer.from('GIF89a......')), null);
  assert.equal(pictureSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null, 'a JPEG with no frame');
  assert.equal(pictureSize(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00])), null, 'broken markers');
  assert.equal(pictureSize(Buffer.alloc(0)), null);
});

test('stitchSideBySide lays pictures left to right at their size, a grey gap between, the shorter padded white', () => {
  const sheet = decodePng(stitchSideBySide([solid(4, 3, [255, 0, 0]), solid(2, 5, [0, 0, 255])]));
  assert.equal(sheet.width, 4 + SIDE_BY_SIDE_GAP + 2);
  assert.equal(sheet.height, 5);
  assert.equal(sheet.channels, 4);
  const pixel = (x: number, y: number): number[] => [...(sheet.rows[y]?.subarray(x * 4, x * 4 + 4) ?? [])];
  assert.deepEqual(pixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(3, 2), [255, 0, 0, 255]);
  assert.deepEqual(pixel(0, 4), [255, 255, 255, 255], 'padded below the shorter one');
  assert.deepEqual(pixel(4, 0), [0xd0, 0xd0, 0xd0, 255], 'the gap');
  assert.deepEqual(pixel(4 + SIDE_BY_SIDE_GAP, 4), [0, 0, 255, 255]);
  assert.equal(decodePng(stitchSideBySide([solid(4, 30, [1, 1, 1]), solid(4, 10, [1, 1, 1])], { maxHeight: 12, gap: 0 })).height, 12, 'cut to maxHeight');
  assert.throws(() => stitchSideBySide([]), PngStitchError);
  assert.throws(() => stitchSideBySide([Buffer.from('not a png')]), PngStitchError);
  assert.throws(() => stitchSideBySide([solid(9000, 1, [0, 0, 0]), solid(9000, 1, [0, 0, 0])]), PngStitchError, 'too wide');
});

// ---- which sheets ----

const okSource = (screen: string, width: number, over: Partial<Extract<CompareSource, { ok: true }>> = {}): CompareSource => ({ screen, source: `sources/screens/${screen}.png`, ok: true, type: 'png', width, height: 600, bytes: solid(width, 4, [0, 0, 0]), ...over });

test('a sheet for each light artboard within 2 px of the picture; another width, an unreadable picture and the cap are notes', () => {
  const plan: PlannedArtboard[] = [
    { file: 'screens/home.html', screen: 'home', viewport: LAPTOP },
    { file: 'screens/home.html', screen: 'home', viewport: PHONE },
    { file: 'screens/home.html', screen: 'home', viewport: { ...LAPTOP, id: 'laptop-dark' }, scheme: 'dark' },
    { file: 'screens/wide.html', screen: 'wide', viewport: LAPTOP },
    { file: 'screens/bad.html', screen: 'bad', viewport: LAPTOP },
  ];
  const { targets, findings } = planCompares([okSource('home', 1282), okSource('wide', 1440), { screen: 'bad', source: 'sources/screens/bad.png', ok: false }, okSource('gone', 1280)], plan);
  assert.deepEqual(targets.map((target) => [target.screen, target.viewport.id]), [['home', 'laptop']], 'the dark twin and the phone are not compared');
  assert.deepEqual(findings, [
    { code: 'system-compare-skipped', file: 'screens/wide.html', screen: 'wide', viewport: null, params: { px: 1440 }, detail: 'wide: sources/screens/wide.png' },
    { code: 'system-compare-skipped', file: 'screens/bad.html', screen: 'bad', viewport: null, detail: 'bad: sources/screens/bad.png' },
  ]);
  assert.equal(findingMessage(findings[0] ?? assert.fail()), 'The source picture is 1440 px wide; no viewport of this screen matches. Save a screenshot as wide as one of its viewports.');
  assert.equal(findingMessage(findings[1] ?? assert.fail()), "The source picture can't be read as a PNG or JPEG, so no compare sheet was made.");
  assert.equal(planCompares([okSource('home', 1277)], plan).targets.length, 0, '3 px off is another width');

  const many = Array.from({ length: SYSTEM_COMPARE_SHEETS_MAX + 2 }, (_, index) => `s${index}`);
  const capped = planCompares(many.map((id) => okSource(id, 390)), many.map((id) => ({ file: `screens/${id}.html`, screen: id, viewport: PHONE })));
  assert.equal(capped.targets.length, SYSTEM_COMPARE_SHEETS_MAX);
  assert.deepEqual(capped.findings.map((finding) => [finding.screen, finding.params]), [['s24', { reason: 'limit', count: 2, max: SYSTEM_COMPARE_SHEETS_MAX }]]);
  assert.equal(findingMessage(capped.findings[0] ?? assert.fail()), '2 compare sheets were not made (the limit is 24 per check). Use --screen <id> to compare the rest.');
  assert.equal(findingMessage(compareBudgetNote(capped.targets.slice(0, 1))[0] ?? assert.fail()), '1 compare sheet was not made (the check ran out of time). Use --screen <id> to compare the rest.');
  assert.match(sourceDocument(okSource('home', 1280) as Extract<CompareSource, { ok: true }>), /<img alt="" src="data:image\/png;base64,/);
});

// ---- making the sheets ----

const artboard = (screen: string, viewport: Viewport, pngs: number, ok = true): ArtboardCheck => ({ screen, viewport: viewport.id, width: viewport.width, height: viewport.height, docHeight: viewport.height * pngs, pngs: Array.from({ length: pngs }, (_, i) => `screen-${screen}@${viewport.id}${i > 0 ? `-${i + 1}` : ''}.png`), ok, ms: 1 });
const NO_DRAW: RenderOutcome = { artboards: [], findings: [], notRendered: 0, stoppedBy: null, unavailable: false };

test('a PNG Node reads is stitched beside the screen without the browser; slices are stacked first; the sheet is named compare-<id>', async () => {
  const saved: { label: string | undefined; bytes: Buffer; viewport: string }[] = [];
  let transcoded = 0;
  const result = await makeCompareSheets({
    targets: [{ screen: 'home', viewport: PHONE, source: okSource('home', 390, { bytes: solid(390, 50, [0, 128, 0]), height: 50 }) as Extract<CompareSource, { ok: true }> }],
    artboards: [artboard('home', PHONE, 2)],
    slices: new Map([['home|phone', [solid(390, 844, [200, 0, 0]), solid(390, 100, [0, 0, 200])]]]),
    budgetMs: 10_000,
    savePng: async (art, _slice, _slices, bytes, label) => {
      saved.push({ label, bytes, viewport: art.viewport.id });
      return `.chamber/check/r-1/${label}@${art.viewport.id}.png`;
    },
    transcode: async () => {
      transcoded += 1;
      return NO_DRAW;
    },
  });
  assert.equal(transcoded, 0);
  assert.deepEqual(result, { sheets: [{ screen: 'home', viewport: 'phone', source: 'sources/screens/home.png', png: '.chamber/check/r-1/compare-home@phone.png' }], findings: [] });
  const sheet = decodePng(saved[0]?.bytes ?? assert.fail());
  assert.equal(sheet.width, 390 + SIDE_BY_SIDE_GAP + 390);
  assert.equal(sheet.height, CAPTION_BAND + 944, 'both slices stacked, under the captions');
  assert.deepEqual([...(sheet.rows[CAPTION_BAND + 900]?.subarray(0, 3) ?? [])], [0, 0, 200], 'the second slice under the first');
  assert.deepEqual([...(sheet.rows[CAPTION_BAND + 10]?.subarray((390 + SIDE_BY_SIDE_GAP) * 4, (390 + SIDE_BY_SIDE_GAP) * 4 + 3) ?? [])], [0, 128, 0], 'the source on the right');
});

test('a JPEG goes through the browser once, in bands; short of time it is a note; an artboard not drawn whole gets nothing', async () => {
  const jpeg = okSource('home', 390, { type: 'jpeg', height: 1000, bytes: jpegHeader(390, 1000) }) as Extract<CompareSource, { ok: true }>;
  const captures: { y: number; height: number }[] = [];
  let plans: PlannedArtboard[] = [];
  const result = await makeCompareSheets({
    targets: [{ screen: 'home', viewport: PHONE, source: jpeg }, { screen: 'other', viewport: PHONE, source: { ...jpeg, screen: 'other', source: 'sources/screens/other.png' } }],
    artboards: [artboard('home', PHONE, 1), artboard('other', PHONE, 1, false)],
    slices: new Map([['home|phone', [solid(390, 844, [1, 1, 1])]], ['other|phone', [solid(390, 844, [1, 1, 1])]]]),
    budgetMs: 10_000,
    savePng: async (art, _a, _b, _bytes, label) => `${label}@${art.viewport.id}.png`,
    transcode: async (plan, inspect) => {
      plans = plan;
      for (const art of plan) {
        await inspect(
          {
            evaluate: async () => null,
            scrollTo: async () => undefined,
            capture: async (clip) => {
              captures.push({ y: clip.y, height: clip.height });
              return solid(390, clip.height, [5, 5, 5]);
            },
            save: async () => 'x',
            forceState: async () => false,
            computedStyle: async () => null,
            animationFrames: async () => null,
          },
          art,
        );
      }
      return NO_DRAW;
    },
  });
  assert.deepEqual(plans.map((art) => [art.file, art.screen, art.viewport.width, art.viewport.height]), [['sources/screens/home.png', 'home', 390, 900]]);
  assert.deepEqual(captures, [{ y: 0, height: 900 }, { y: 900, height: 100 }]);
  assert.deepEqual(result.sheets.map((sheet) => sheet.png), ['compare-home@phone.png']);
  assert.deepEqual(result.findings, []);

  const late = await makeCompareSheets({
    targets: [{ screen: 'home', viewport: PHONE, source: jpeg }],
    artboards: [artboard('home', PHONE, 1)],
    slices: new Map([['home|phone', [solid(390, 844, [1, 1, 1])]]]),
    budgetMs: 2000,
    savePng: async () => 'x.png',
    transcode: async () => assert.fail('no time for the browser'),
  });
  assert.deepEqual(late.sheets, []);
  assert.deepEqual(late.findings.map((finding) => [finding.code, finding.params]), [['system-compare-skipped', { reason: 'budget', count: 1 }]]);

  // The browser drew it but nothing came back: unreadable, once per screen.
  const failed = await makeCompareSheets({
    targets: [{ screen: 'home', viewport: PHONE, source: jpeg }],
    artboards: [artboard('home', PHONE, 1)],
    slices: new Map([['home|phone', [solid(390, 844, [1, 1, 1])]]]),
    budgetMs: 10_000,
    savePng: async () => 'x.png',
    transcode: async () => NO_DRAW,
  });
  assert.deepEqual(failed.findings.map((finding) => [finding.code, finding.params, finding.detail]), [['system-compare-skipped', undefined, 'home: sources/screens/home.png']]);
});

// ---- the text, copy-on-link, the living page ----

test('the text lists each compare sheet with the screen, its size and the source', () => {
  const report = systemCheckReport({
    id: 'acme',
    findings: [],
    now: new Date(NOW),
    tool: 'cli',
    render: {
      state: 'done',
      browser: 'chrome',
      drawn: { from: 'system', proposal: null },
      widths: [],
      shots: [],
      entryShots: [],
      findings: [],
      screens: { artboards: [artboard('home', PHONE, 1)], viewports: [{ ...PHONE, screen: 'home' }] },
      compares: [{ screen: 'home', viewport: 'phone', source: 'sources/screens/home.png', png: '.chamber/check/r-1/compare-home@phone.png' }],
    },
  });
  const text = formatSystemCheckText({ report, name: 'Acme', reportPath: null });
  assert.match(text, /Compare sheets: "Design" on the left is the screen as drawn, "Your app" on the right is the screenshot, both at full size and top-aligned\. Look for what differs:\n {2}compare-home@phone\.png {2}home at Phone 390x844 beside sources\/screens\/home\.png/);
  assert.ok(!text.includes('\u2014'));
});

test('copy-on-link never carries a source picture', () => {
  assert.equal(isCopyReference('sources/screens/home.png'), false);
  const detail = detailOf('sources/screens/home.png');
  const plan = planCopy(['system.json', 'screens/home.html', 'sources/screens/home.png', 'tokens.css'], detail);
  assert.ok(!JSON.stringify(plan).includes('sources/'), JSON.stringify(plan));
});

test('the living page never names or shows a source picture', () => {
  const detail = detailOf('sources/screens/home.png');
  assert.equal(detail.screens[0]?.source, 'sources/screens/home.png');
  const html = buildLivingPage(detail, { revision: 1, generatedAt: NOW, coverage: ['patterns'], redact: [] }).html;
  assert.ok(html.includes('Home'), 'the screen is on the page');
  assert.ok(!html.includes('sources/screens'), 'its source is not');
});

// ---- a screen taller than its viewport ----

/** A slice whose row r is green r % 256, red `tag`: each row says which slice and which row it came from. */
const taggedSlice = (width: number, height: number, tag: number): Buffer =>
  encodePng({ width, height, channels: 3, rows: Array.from({ length: height }, (_, r) => Buffer.from(Array.from({ length: width }, () => [tag, r % 256, 0]).flat())) });

test('the last slice of a page that ends mid-screen adds only what the one above does not show', async () => {
  // An 1840 px page at Phone 844: slices at 0, 844, then the browser stops at 996 (1840 - 844), not 1688.
  assert.deepEqual(sliceOverlaps(3, 844, 1840), [0, 0, 692]);
  assert.deepEqual(sliceOverlaps(3, 844, 2532), [0, 0, 0], 'whole screens: no overlap');
  assert.deepEqual(sliceOverlaps(1, 844, 500), [0]);
  assert.deepEqual(sliceOverlaps(2, 844, 900), [0, 788]);
  assert.equal(decodePng(stitchPngs([taggedSlice(4, 10, 1), taggedSlice(4, 10, 2)], { skipTop: [0, 6] })).height, 14);

  const saved: Buffer[] = [];
  await makeCompareSheets({
    targets: [{ screen: 'home', viewport: PHONE, source: okSource('home', 390, { bytes: solid(390, 50, [0, 128, 0]), height: 50 }) as Extract<CompareSource, { ok: true }> }],
    artboards: [{ ...artboard('home', PHONE, 3), docHeight: 1840 }],
    slices: new Map([['home|phone', [taggedSlice(390, 844, 10), taggedSlice(390, 844, 20), taggedSlice(390, 844, 30)]]]),
    budgetMs: 10_000,
    savePng: async (_art, _a, _b, bytes) => {
      saved.push(bytes);
      return 'compare-home@phone.png';
    },
    transcode: async () => NO_DRAW,
  });
  const sheet = decodePng(saved[0] ?? assert.fail());
  assert.equal(sheet.height, CAPTION_BAND + 1840, 'the page once, not 2532 px with rows repeated');
  const pixel = (y: number): number[] => [...(sheet.rows[CAPTION_BAND + y]?.subarray(0, 2) ?? [])];
  assert.deepEqual(pixel(1687), [20, 843 % 256], 'the second slice ends at 1688');
  assert.deepEqual(pixel(1688), [30, 692 % 256], 'the third goes on from its row 692 (page row 1688)');
  assert.deepEqual(pixel(1839), [30, 843 % 256], 'and ends at the page bottom');
});
