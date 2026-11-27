// Motion strips against a real browser (system-builder-depth T17; skipped, never silent, when none is
// installed). The Motion section's 200 ms demo chip is pictured in four frames whose chip moves right
// frame by frame, and with reduced motion stays put (the board's own reduced rule); a component element
// labelled data-dc-motion slides on hover and still moves with reduced motion (it has no reduced rule);
// one with no transition is one frame. Strips are stitched side by side within the stitch bounds, and the
// page is left as it was: the state cleared, the media back to no-preference.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { decodePng, PNG_STITCH_SIDE_MAX, SIDE_BY_SIDE_GAP, type DecodedPng } from '../../../src/service/check/png-stitch.ts';
import { cliSystemStore, runSystemCheck } from '../../../src/service/check/system-run.ts';
import { SYSTEM_MOTION_FRAMES, SYSTEM_MOTION_SHOTS_MAX } from '../../../src/shared/limits.ts';
import { chromeOrSkip } from '../../helpers/chrome-or-skip.ts';
import { probeSource } from '../../helpers/probe-source.ts';
import { useTmpRoot } from '../../helpers/tmp-root.ts';

const files: Record<string, string> = {
  'tokens.css': ':root {\n  --brand: #1a73e8;\n  --duration-fast: 200ms;\n}\n',
  'OVERVIEW.md': 'Calm.',
  'system.json': JSON.stringify({
    version: 1,
    components: [
      { id: 'slide', name: 'Slide', layout: 'compact', example: 'components/slide.html' },
      { id: 'still', name: 'Still', layout: 'compact', example: 'components/still.html' },
    ],
  }),
  '.chamber/state.json': JSON.stringify({ name: 'Acme', status: 'ready' }),
  'components/slide.html':
    '<style>.box{width:200px;height:40px;position:relative}.dot{position:absolute;left:0;top:10px;width:20px;height:20px;background:rgb(0,0,0);transition:left 300ms linear}.box:hover .dot{left:160px}</style><div class="box" data-dc-motion><div class="dot"></div></div>',
  'components/still.html': '<style>.b{width:60px;height:30px;background:rgb(0,0,0)}.b:hover{background:rgb(90,90,90)}</style><div class="b" data-dc-motion data-dc-state="hover"></div>',
};

/** The frames of a strip: equal widths, a gap between. */
const framesOf = (strip: DecodedPng, count: number): { left: number; width: number }[] => {
  const width = (strip.width - SIDE_BY_SIDE_GAP * (count - 1)) / count;
  assert.ok(Number.isInteger(width), `${strip.width} splits into ${count}`);
  return Array.from({ length: count }, (_, index) => ({ left: index * (width + SIDE_BY_SIDE_GAP), width }));
};

/** The leftmost dark pixel in a frame's row, or -1. */
const darkAt = (strip: DecodedPng, frame: { left: number; width: number }, y: number): number => {
  const row = strip.rows[y];
  if (row === undefined) return -1;
  for (let x = 0; x < frame.width; x += 1) {
    const at = (frame.left + x) * strip.channels;
    if ((row[at] ?? 255) + (row[at + 1] ?? 255) + (row[at + 2] ?? 255) < 150) return x;
  }
  return -1;
};

test('motion is pictured frame by frame from Node over CDP, and once more with reduced motion', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  for (const [rel, body] of Object.entries(files)) await tmp.write(`_systems/acme/${rel}`, body);
  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const started = Date.now();
    const result = await runSystemCheck(store, 'acme', {
      now: new Date(),
      tool: 'cli',
      render: { browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0 },
    });
    const elapsed = Date.now() - started;
    const render = result.report.render;
    assert.ok(render !== null);
    assert.equal(render.state, 'done', JSON.stringify(render.findings));
    const motion = render.motion ?? [];
    const byEntry = (entry: string) => motion.find((one) => one.entry === entry);

    // The demo chip of the 200 ms token: four frames, the chip further right each time, and put back with reduced motion.
    const demo = byEntry('token:--duration-fast');
    assert.ok(demo !== undefined, JSON.stringify(motion));
    assert.equal(demo.moved, true);
    assert.equal(demo.frames, SYSTEM_MOTION_FRAMES);
    assert.equal(demo.reducedMoves, false, 'the board has a reduced rule for its demos');
    assert.match(demo.png, /--duration-fast-motion@wide\.png$/);
    const demoStrip = decodePng(await readFile(tmp.at(`_systems/acme/${demo.png}`)));
    assert.ok(demoStrip.width <= PNG_STITCH_SIDE_MAX);
    const demoFrames = framesOf(demoStrip, SYSTEM_MOTION_FRAMES + 1);
    const middle = Math.floor(demoStrip.height / 2);
    const chipX = demoFrames.map((frame) => darkAt(demoStrip, frame, middle));
    assert.ok(chipX.every((x) => x >= 0), `a chip in every frame: ${chipX.join(', ')}`);
    for (let index = 1; index < SYSTEM_MOTION_FRAMES; index += 1) assert.ok((chipX[index] ?? 0) > (chipX[index - 1] ?? 0), `the chip moves right: ${chipX.join(', ')}`);
    assert.equal(chipX[SYSTEM_MOTION_FRAMES], chipX[0], `with reduced motion the chip stays at the start: ${chipX.join(', ')}`);

    // The component's dot: 300 ms of slide, still moving with reduced motion (its CSS has no reduced rule).
    const slide = byEntry('component:slide');
    assert.ok(slide !== undefined, JSON.stringify(motion));
    assert.deepEqual([slide.moved, slide.frames, slide.reducedMoves, slide.trigger], [true, SYSTEM_MOTION_FRAMES, true, 'hover']);
    const slideStrip = decodePng(await readFile(tmp.at(`_systems/acme/${slide.png}`)));
    const slideFrames = framesOf(slideStrip, SYSTEM_MOTION_FRAMES + 1);
    const dotY = 24 + 20;
    const dotX = slideFrames.map((frame) => darkAt(slideStrip, frame, dotY));
    assert.ok(dotX.every((x) => x >= 0), dotX.join(', '));
    for (let index = 1; index < SYSTEM_MOTION_FRAMES; index += 1) assert.ok((dotX[index] ?? 0) > (dotX[index - 1] ?? 0), dotX.join(', '));
    assert.equal(dotX[SYSTEM_MOTION_FRAMES], dotX[SYSTEM_MOTION_FRAMES - 1], `the reduced end is the end: ${dotX.join(', ')}`);

    // No transition: one frame, and the reduced end beside it.
    const still = byEntry('component:still');
    assert.ok(still !== undefined, JSON.stringify(motion));
    assert.deepEqual([still.moved, still.frames, still.reducedMoves], [false, 1, false]);
    framesOf(decodePng(await readFile(tmp.at(`_systems/acme/${still.png}`))), 2);

    for (const one of motion) assert.ok(result.pngs.some((png) => png.endsWith(one.png.slice(one.png.lastIndexOf('/') + 1))), `${one.png} is kept`);
    assert.ok(!render.findings.some((finding) => finding.code === 'system-board-partial'), JSON.stringify(render.findings));
    // The board's time holds with the motion strips in it.
    assert.ok(elapsed < 70_000, `${elapsed} ms`);
  } finally {
    await store.dispose();
  }
});

test('example strips claim the 24-strip cap before the Motion section demo chips', { timeout: 180_000 }, async (t) => {
  const browserPath = chromeOrSkip(t);
  if (browserPath === null) return;
  const tmp = await useTmpRoot(t);
  // Thirty time tokens draw thirty demo chips, above the components on the board.
  const tokens = `:root {\n  --brand: #1a73e8;\n${Array.from({ length: 30 }, (_, i) => `  --duration-${i + 1}: ${100 + i * 10}ms;`).join('\n')}\n}\n`;
  for (const [rel, body] of Object.entries({ ...files, 'tokens.css': tokens })) await tmp.write(`_systems/acme/${rel}`, body);
  const store = cliSystemStore(tmp.root, { version: 1 });
  try {
    const result = await runSystemCheck(store, 'acme', {
      now: new Date(),
      tool: 'cli',
      render: { browserPath, probeSource: await probeSource(), platform: process.platform, isRoot: process.getuid?.() === 0, scheme: 'light' },
    });
    const render = result.report.render;
    assert.ok(render !== null);
    const motion = render.motion ?? [];
    assert.equal(motion.length, SYSTEM_MOTION_SHOTS_MAX, JSON.stringify(motion.map((one) => one.entry)));
    assert.deepEqual(motion.slice(0, 2).map((one) => one.entry), ['component:slide', 'component:still'], 'the examples first');
    assert.ok(motion.slice(2).every((one) => one.entry.startsWith('token:--duration-')), 'then the chips with what is left');
    const partial = render.findings.filter((finding) => finding.code === 'system-board-partial' && finding.params?.pictured === 'motion');
    assert.deepEqual(partial.map((finding) => finding.params?.count), [SYSTEM_MOTION_SHOTS_MAX]);
  } finally {
    await store.dispose();
  }
});
