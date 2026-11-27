// Motion strips (system-builder-depth T17) without a browser: the CDP animation answer and the probe's
// boundary, the pass over a fake InspectPage (frames and the reduced end stitched side by side, --area,
// the cap and the deadline), the board hook (wide light pass only), animationFrames over a fake CDP
// session (paused, sought to evenly spaced points, reduced motion with the full media list, put back),
// and the text.

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { sanitizeMotionProbe, type BoardMotionProbe, type BoardMotionTarget } from '../../../src/service/check/board-analyze.ts';
import type { CdpEvent, CdpSession } from '../../../src/service/check/cdp.ts';
import { decodePng, encodePng, SIDE_BY_SIDE_GAP } from '../../../src/service/check/png-stitch.ts';
import { animationEndOf, renderArtboards, renderMediaFeatures, type CaptureClip, type ElementPath, type InspectPage, type MotionFrames, type PlannedArtboard } from '../../../src/service/check/render.ts';
import { formatSystemCheckText } from '../../../src/service/check/report-text.ts';
import { cliSystemStore, pictureMotion, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { systemCheckReport } from '../../../src/service/check/system-static.ts';
import { findingMessage, parseFindingData } from '../../../src/shared/checks.ts';
import { SYSTEM_MOTION_FRAMES, SYSTEM_MOTION_SHOTS_MAX } from '../../../src/shared/limits.ts';
import type { ArtboardCheck } from '../../../src/shared/types.ts';
import { pngOfSize } from '../systems/fake-cdp.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const solid = (width: number, height: number): Buffer => encodePng({ width, height, channels: 3, rows: Array.from({ length: height }, () => Buffer.alloc(width * 3, 0x80)) });

const demo = (over: Partial<BoardMotionTarget> = {}): BoardMotionTarget => ({ entry: 'token:--duration-fast', kind: 'demo', host: null, element: 0, trigger: 'hover', box: { x: 100, y: 500, w: 300, h: 20 }, ...over });
const example = (over: Partial<BoardMotionTarget> = {}): BoardMotionTarget => ({ entry: 'component:slide', kind: 'example', host: 2, element: 3, trigger: 'focus-visible', box: { x: 40, y: 1200, w: 200, h: 40 }, ...over });

// ---- the boundary ----

test('an animation from CDP reads as its id and end; anything else is dropped', () => {
  assert.deepEqual(animationEndOf({ id: 'a1', source: { delay: 50, duration: 200 } }), { id: 'a1', end: 250 });
  assert.deepEqual(animationEndOf({ id: 'a2', source: { duration: 300 } }), { id: 'a2', end: 300 });
  assert.equal(animationEndOf({ id: 'a3', source: { delay: 0, duration: 0 } }), null, 'nothing to picture');
  assert.equal(animationEndOf({ source: { duration: 300 } }), null);
  assert.equal(animationEndOf({ id: 'a4', source: { duration: Number.POSITIVE_INFINITY } }), null);
  assert.equal(animationEndOf(null), null);
});

test('the probe motion list is checked: demos under tokens, example elements under components, patterns or brand', () => {
  const clean = sanitizeMotionProbe(
    {
      items: [
        demo(),
        example(),
        example({ entry: 'pattern:nav', host: 0 }),
        example({ entry: 'brand:hero', host: 1 }),
        demo({ entry: 'component:slide' }),
        example({ entry: 'token:--duration-fast' }),
        example({ entry: 'note:intro' }),
        { ...demo(), host: 3 },
        { ...example(), host: null },
        { ...example(), trigger: 'visited' },
        { ...example(), element: -1 },
        { ...example(), entry: 'component:Bad Key' },
        { ...example(), kind: 'other' },
      ],
      truncated: true,
    },
    SYSTEM_MOTION_SHOTS_MAX,
  );
  assert.deepEqual(clean.items.map((item) => item.entry), ['token:--duration-fast', 'component:slide', 'pattern:nav', 'brand:hero']);
  assert.equal(clean.truncated, true);
  assert.deepEqual(sanitizeMotionProbe({ items: Array.from({ length: SYSTEM_MOTION_SHOTS_MAX + 1 }, () => demo()) }, SYSTEM_MOTION_SHOTS_MAX), { items: [], truncated: false });
  assert.deepEqual(sanitizeMotionProbe('x', SYSTEM_MOTION_SHOTS_MAX), { items: [], truncated: false });
});

// ---- the pass ----

type Call = { path: string; trigger: string; clip: CaptureClip; frames: number };

const fakeMotionPage = (calls: Call[], answer: (path: ElementPath) => MotionFrames | null = () => ({ frames: Array.from({ length: SYSTEM_MOTION_FRAMES }, () => solid(30, 10)), moved: true, reduced: solid(30, 10), reducedMoves: false })) => {
  const saved: { label: string; bytes: Buffer }[] = [];
  return {
    saved,
    scrollTo: async () => undefined,
    animationFrames: async (path: ElementPath, trigger: string, clip: CaptureClip, frames: number) => {
      calls.push({ path: path.map((step) => `${step.selector}#${step.index}`).join(' > '), trigger, clip, frames });
      return answer(path);
    },
    save: async (label: string, _part: number, _parts: number, bytes: Buffer) => {
      saved.push({ label, bytes });
      return `.chamber/check/r-1/${label}@wide.png`;
    },
  };
};

test('each motion element gets one strip: its frames and the reduced end side by side, named <entry>-motion', async () => {
  const calls: Call[] = [];
  const page = fakeMotionPage(calls, (path) => (path.length === 2 ? { frames: [solid(30, 10)], moved: false, reduced: solid(30, 10), reducedMoves: false } : { frames: Array.from({ length: SYSTEM_MOTION_FRAMES }, () => solid(30, 10)), moved: true, reduced: solid(30, 10), reducedMoves: true }));
  const pass = await pictureMotion(page, { items: [demo(), example()], truncated: false }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY, area: null });
  assert.deepEqual(pass.results, [
    { entry: 'token:--duration-fast', trigger: 'hover', png: '.chamber/check/r-1/--duration-fast-motion@wide.png', frames: SYSTEM_MOTION_FRAMES, moved: true, reducedMoves: true },
    { entry: 'component:slide', trigger: 'focus-visible', png: '.chamber/check/r-1/slide-motion@wide.png', frames: 1, moved: false, reducedMoves: false },
  ]);
  assert.deepEqual(pass.findings, []);
  assert.deepEqual(calls.map((call) => [call.path, call.trigger, call.frames]), [
    ['.dc-motion-demo#0', 'hover', SYSTEM_MOTION_FRAMES],
    ['[data-dc-example-host]#2 > *#3', 'focus-visible', SYSTEM_MOTION_FRAMES],
  ]);
  assert.deepEqual(calls[0]?.clip, { x: 76, y: 476, width: 348, height: 68 }, 'the box with 24 px around it');
  const strip = decodePng(page.saved[0]?.bytes ?? assert.fail());
  assert.equal(strip.width, 30 * (SYSTEM_MOTION_FRAMES + 1) + SIDE_BY_SIDE_GAP * SYSTEM_MOTION_FRAMES);
  assert.equal(decodePng(page.saved[1]?.bytes ?? assert.fail()).width, 30 * 2 + SIDE_BY_SIDE_GAP, 'one frame and the reduced end');
});

test('--area keeps its own entries; past the cap or the deadline one note; an element gone is skipped', async () => {
  const calls: Call[] = [];
  await pictureMotion(fakeMotionPage(calls), { items: [demo(), example(), example({ entry: 'pattern:nav' })], truncated: false }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY, area: 'components' });
  assert.deepEqual(calls.map((call) => call.path), ['[data-dc-example-host]#2 > *#3']);

  const capped = await pictureMotion(fakeMotionPage([]), { items: [demo()], truncated: true }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY, area: null });
  assert.deepEqual(capped.findings, [{ code: 'system-board-partial', file: 'board.html', screen: null, viewport: 'wide', params: { pictured: 'motion', count: 1, max: SYSTEM_MOTION_SHOTS_MAX } }]);
  assert.equal(findingMessage(capped.findings[0] ?? assert.fail()), 'Only the first motion strip was taken; the other moving elements were not pictured.');
  const parsed = parseFindingData({ ...capped.findings[0], params: { pictured: 'motion', count: 0, max: 24 } });
  assert.equal(findingMessage(parsed ?? assert.fail()), 'No motion strip was taken: the check ran out of time for them.');

  let now = 0;
  const late = await pictureMotion(fakeMotionPage([]), { items: [demo(), demo({ element: 1 }), demo({ element: 2 })], truncated: false }, { viewportWidth: 1526, deadline: 2, area: null, clock: () => now++ });
  assert.equal(late.results.length, 2);
  assert.equal(late.findings.length, 1);

  const gone = await pictureMotion(fakeMotionPage([], () => null), { items: [demo()], truncated: false }, { viewportWidth: 1526, deadline: Number.POSITIVE_INFINITY, area: null });
  assert.deepEqual(gone, { results: [], pngs: [], findings: [] });
});

// ---- the hook ----

const hooked = async (t: TestContext) => {
  const tmp = await useTmpRoot(t);
  await tmp.write('_systems/acme/tokens.css', ':root {\n  --ink: #111;\n  --duration-fast: 200ms;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --ink: #eee;\n  }\n}\n');
  await tmp.write('_systems/acme/system.json', '{ "version": 1 }');
  await tmp.write('_systems/acme/OVERVIEW.md', 'Calm.');
  await tmp.write('_systems/acme/.chamber/state.json', { name: 'Acme', status: 'ready' });
  const store = cliSystemStore(tmp.root, { version: 1 });
  t.after(() => store.dispose());
  return store;
};

test('the motion pass runs on the wide light board only, and its strips are kept with that pass', async (t) => {
  const store = await hooked(t);
  const asked: string[] = [];
  const result = await runSystemCheck(store, 'acme', {
    now: new Date('2026-11-27T10:00:00.000Z'),
    tool: 'cli',
    render: {
      browserPath: '/never-started',
      probeSource: '',
      platform: process.platform,
      isRoot: false,
      scheme: 'both',
      renderLoop: async (deps) => {
        const inspect = deps.inspect;
        assert.ok(inspect !== undefined);
        const artboards: ArtboardCheck[] = [];
        for (const art of deps.plan) {
          const page: InspectPage = {
            evaluate: async (expression) => {
              if (expression.includes('collectMotion')) {
                asked.push(art.viewport.id);
                assert.match(expression, new RegExp(`collectMotion\\(${SYSTEM_MOTION_SHOTS_MAX}\\)$`));
                return { items: [demo()], truncated: false };
              }
              return { innerWidth: art.viewport.width, scrollWidth: art.viewport.width, scrollHeight: 900, areas: [{ area: 'foundations', top: 0, height: 900 }], items: [], truncated: false, pairs: [] };
            },
            scrollTo: async () => undefined,
            capture: async (clip) => pngOfSize(clip.width ?? art.viewport.width, clip.height),
            save: (label, part, parts, bytes) => deps.savePng(art, part, parts, bytes, label),
            forceState: async () => false,
            computedStyle: async () => null,
            animationFrames: async () => ({ frames: [solid(20, 10), solid(20, 10)], moved: true, reduced: solid(20, 10), reducedMoves: false }),
          };
          const done = await inspect(page, art);
          assert.ok(done !== null);
          artboards.push({ screen: null, viewport: art.viewport.id, width: art.viewport.width, height: art.viewport.height, docHeight: 900, pngs: done.pngs, ok: true, ms: 1 });
        }
        return { artboards, findings: [], notRendered: 0, stoppedBy: null, unavailable: false };
      },
    },
  });
  assert.deepEqual(asked, ['wide']);
  const render = result.report.render;
  assert.ok(render !== null);
  assert.deepEqual(render.widths.map((width) => width.viewport), ['wide', 'narrow', 'wide-dark']);
  assert.equal(render.motion?.length, 1);
  assert.ok(render.widths[0]?.pngs.includes(render.motion?.[0]?.png ?? ''));
});

// ---- animationFrames over CDP ----

type Sent = { method: string; params: Record<string, unknown> };

const animationSession = (sent: Sent[], options: { reducedStarts: boolean }): CdpSession => {
  const listeners = new Map<string, Set<(event: CdpEvent) => void>>();
  const emit = (event: CdpEvent): void => {
    for (const listener of [...(listeners.get(event.method) ?? [])]) listener(event);
  };
  let reduced = false;
  return {
    exited: false,
    on(method, listener) {
      let set = listeners.get(method);
      if (set === undefined) listeners.set(method, (set = new Set()));
      set.add(listener);
      return () => set.delete(listener);
    },
    onExit: () => () => undefined,
    close: async () => undefined,
    async send<T>(method: string, params: object = {}): Promise<T> {
      const p = params as Record<string, unknown>;
      sent.push({ method, params: p });
      const reply = (value: object): T => value as T;
      switch (method) {
        case 'Target.createTarget':
          return reply({ targetId: 't1' });
        case 'Target.attachToTarget':
          return reply({ sessionId: 's1' });
        case 'Page.navigate':
          setImmediate(() => emit({ method: 'Fetch.requestPaused', sessionId: 's1', params: { requestId: 'r1', request: { url: p.url } } }));
          return reply({ frameId: 'f1' });
        case 'Fetch.fulfillRequest':
          setImmediate(() => emit({ method: 'Page.loadEventFired', sessionId: 's1', params: {} }));
          return reply({});
        case 'Page.createIsolatedWorld':
          return reply({ executionContextId: 7 });
        case 'Runtime.evaluate':
          return reply({ result: { value: true } });
        case 'DOM.getDocument':
          return reply({ root: { nodeId: 1 } });
        case 'DOM.querySelectorAll':
          return reply({ nodeIds: [10] });
        case 'Emulation.setEmulatedMedia':
          reduced = (p.features as { name: string; value: string }[]).some((feature) => feature.name === 'prefers-reduced-motion' && feature.value === 'reduce');
          return reply({});
        case 'CSS.forcePseudoState':
          if ((p.forcedPseudoClasses as string[]).length > 0 && (!reduced || options.reducedStarts)) {
            emit({ method: 'Animation.animationStarted', sessionId: 's1', params: { animation: { id: reduced ? 'r1' : 'a1', source: { delay: 0, duration: 300 } } } });
            emit({ method: 'Animation.animationStarted', sessionId: 'other', params: { animation: { id: 'x', source: { delay: 0, duration: 9000 } } } });
          }
          return reply({});
        case 'Page.captureScreenshot': {
          const clip = p.clip as { width: number; height: number };
          return reply({ data: pngOfSize(clip.width, clip.height).toString('base64') });
        }
        default:
          return reply({});
      }
    },
  };
};

const runFrames = async (sent: Sent[], reducedStarts: boolean): Promise<{ shot: MotionFrames | null; mark: number }> => {
  const ART: PlannedArtboard = { file: 'board.html', screen: null, viewport: { id: 'wide', label: 'Wide board', width: 1526, height: 900 } };
  let shot: MotionFrames | null = null;
  let mark = 0;
  await renderArtboards({
    openBrowser: async () => animationSession(sent, { reducedStarts }),
    plan: [ART],
    kind: 'page',
    loadDocument: async () => ({ ok: true, html: '<p>board</p>' }),
    probeSource: '',
    knownExternal: new Set(),
    savePng: async () => 'x.png',
    inspect: async (page) => {
      mark = sent.length;
      shot = await page.animationFrames([{ selector: '.dc-motion-demo', index: 0 }], 'hover', { x: 10, y: 20, width: 300, height: 60 }, SYSTEM_MOTION_FRAMES);
      return { findings: [], docHeight: 900, pngs: [] };
    },
  });
  return { shot, mark };
};

test('animationFrames pauses, seeks the started animations to four even points, then the end with reduced motion, and puts the page back', async () => {
  const sent: Sent[] = [];
  const { shot, mark } = await runFrames(sent, true);
  assert.ok(shot !== null);
  const result: MotionFrames = shot;
  assert.equal(result.frames.length, SYSTEM_MOTION_FRAMES);
  assert.equal(result.moved, true);
  assert.equal(result.reducedMoves, true);
  const during = sent.slice(mark);
  const seeks = during.filter((entry) => entry.method === 'Animation.seekAnimations').map((entry) => [entry.params.animations, entry.params.currentTime]);
  // Only this page's animation; the other session's 9 s one doesn't stretch the frames.
  assert.deepEqual(seeks, [[['a1'], 0], [['a1'], 100], [['a1'], 200], [['a1'], 300], [['r1'], 300]]);
  const media = during.filter((entry) => entry.method === 'Emulation.setEmulatedMedia').map((entry) => entry.params.features);
  assert.deepEqual(media, [renderMediaFeatures('light', 'reduce'), renderMediaFeatures('light')], 'the full list both times, back to no-preference');
  const rates = during.filter((entry) => entry.method === 'Animation.setPlaybackRate').map((entry) => entry.params.playbackRate);
  assert.equal(rates[0], 0, 'paused before the trigger');
  assert.equal(rates.at(-2), 1, 'normal speed at the end');
  const forced = during.filter((entry) => entry.method === 'CSS.forcePseudoState').map((entry) => entry.params.forcedPseudoClasses);
  assert.deepEqual(forced, [['hover'], [], ['hover'], []], 'cleared before reduced motion and at the end');
  assert.deepEqual(during.filter((entry) => entry.method === 'Page.captureScreenshot').map((entry) => entry.params.clip), Array.from({ length: SYSTEM_MOTION_FRAMES + 1 }, () => ({ x: 10, y: 20, width: 300, height: 60, scale: 1 })));
  for (const entry of during.filter((one) => one.method === 'Runtime.evaluate')) assert.equal(entry.params.contextId, 7, 'only frame waits, in the isolated world');

  const still: Sent[] = [];
  const reducedStill = await runFrames(still, false);
  assert.equal(reducedStill.shot?.reducedMoves, false, 'nothing started with reduced motion');
});

// ---- the text ----

test('the text lists the motion strips, says when nothing moved, and marks one that moves with reduced motion', () => {
  const report = systemCheckReport({
    id: 'acme',
    findings: [],
    now: new Date('2026-11-27T10:00:00.000Z'),
    tool: 'cli',
    render: {
      state: 'done',
      browser: 'chrome',
      drawn: { from: 'system', proposal: null },
      widths: [{ screen: null, viewport: 'wide', width: 1526, height: 900, docHeight: 900, pngs: [], ok: true, ms: 1 }],
      shots: [],
      entryShots: [],
      findings: [],
      motion: [
        { entry: 'token:--duration-fast', trigger: 'hover', png: '.chamber/check/r-1/--duration-fast-motion@wide.png', frames: 4, moved: true, reducedMoves: false },
        { entry: 'component:slide', trigger: 'hover', png: '.chamber/check/r-1/slide-motion@wide.png', frames: 4, moved: true, reducedMoves: true },
        { entry: 'component:still', trigger: 'focus', png: '.chamber/check/r-1/still-motion@wide.png', frames: 1, moved: false, reducedMoves: false },
      ],
    },
  });
  const text = formatSystemCheckText({ report, name: 'Acme', reportPath: null });
  assert.match(
    text,
    /Motion strips \(wide board\): frames from start to end, left to right, and last the end with reduced motion\.\n {2}--duration-fast-motion@wide\.png {2}--duration-fast: 4 frames on hover\n {2}slide-motion@wide\.png {2}slide: 4 frames on hover; it still moves with reduced motion\n {2}still-motion@wide\.png {2}still: nothing moved on focus, so one frame/,
  );
  assert.ok(!text.includes('—'));
});
