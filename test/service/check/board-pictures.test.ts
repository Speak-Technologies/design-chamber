// The visual system check's picture plan (src/service/check/board-pictures.ts): every area gets an
// overview within the scale bounds, full-size tiles are paid from a pixel budget (finding bands
// first, then top to bottom), the PNG cap counts the overviews, and nexus-sized boards are whole.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { overviewScaleOf, pictureCoverage, planBoardPictures, type PicturePlanInput } from '../../../src/service/check/board-pictures.ts';
import {
  SYSTEM_CHECK_BOARD_WIDTHS,
  SYSTEM_CHECK_ENTRY_TILES_MAX,
  SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX,
  SYSTEM_CHECK_OVERVIEW_SCALE_MAX,
  SYSTEM_CHECK_OVERVIEW_SCALE_MIN,
  SYSTEM_CHECK_PNGS_MAX,
  SYSTEM_CHECK_TILE_PIXELS_MAX,
} from '../../../src/shared/limits.ts';

const perWidth = { tilePixels: SYSTEM_CHECK_TILE_PIXELS_MAX / 2, pngs: SYSTEM_CHECK_PNGS_MAX / 2 };

const input = (over: Partial<PicturePlanInput> = {}): PicturePlanInput => ({
  areas: [{ area: 'components', top: 100, height: 2000 }],
  flagged: [],
  viewportWidth: 1526,
  tileHeight: 900,
  ...perWidth,
  ...over,
});

test('bands: 900px from the area top, the last one short; numbered from 1', () => {
  const [plan] = planBoardPictures(input());
  assert.ok(plan);
  assert.deepEqual(
    plan.bands.map((band) => [band.index, band.y, band.height]),
    [
      [1, 100, 900],
      [2, 1000, 900],
      [3, 1900, 200],
    ],
  );
  assert.ok(plan.bands.every((band) => band.tile), 'a small board is tiled whole');
});

test('overview scale: half size for short areas, fit to the height limit, never below the floor (then it stops early)', () => {
  assert.equal(overviewScaleOf(2000), SYSTEM_CHECK_OVERVIEW_SCALE_MAX);
  assert.equal(overviewScaleOf(10_000), SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX / 10_000);
  assert.equal(overviewScaleOf(100_000), SYSTEM_CHECK_OVERVIEW_SCALE_MIN);
  // A scale rounded to three places never cuts an area that fits: 11 053px at 0.362 is 4 001px of overview, all of it shown.
  const [nexus] = planBoardPictures(input({ areas: [{ area: 'foundations', top: 0, height: 11_053 }] }));
  assert.equal(nexus?.coversPx, 11_053);
  assert.ok(nexus?.bands.every((band) => band.strip === band.height));
  const [short] = planBoardPictures(input());
  assert.equal(short?.coversPx, 2000);
  assert.ok(short?.bands.every((band) => band.strip === band.height));
  const [huge] = planBoardPictures(input({ areas: [{ area: 'foundations', top: 0, height: 30_000 }] }));
  assert.equal(huge?.scale, SYSTEM_CHECK_OVERVIEW_SCALE_MIN);
  assert.equal(huge?.coversPx, SYSTEM_CHECK_OVERVIEW_HEIGHT_MAX / SYSTEM_CHECK_OVERVIEW_SCALE_MIN);
  // Strips stop where the overview stops; the band that straddles it gives a partial strip.
  const covers = huge?.coversPx ?? 0;
  assert.ok(huge?.bands.every((band) => band.strip === Math.max(0, Math.min(band.height, covers - band.y))));
  assert.ok(huge?.bands.some((band) => band.strip === 0));
});

test('a nexus-sized board is pictured whole at both widths, within the PNG cap', () => {
  // Measured on nexus with hints: 1526px Foundations 11 179, Components 9 537, Patterns 4 000, Brand 1 500.
  for (const [width, scale] of [[SYSTEM_CHECK_BOARD_WIDTHS[0].width, 1], [SYSTEM_CHECK_BOARD_WIDTHS[1].width, 1.4]] as const) {
    const heights = [11_179, 9_537, 4_000, 1_500].map((height) => Math.round(height * scale));
    let top = 100;
    const areas = (['foundations', 'components', 'patterns', 'brand'] as const).map((area, index) => {
      const measured = { area, top, height: heights[index] ?? 0 };
      top += measured.height;
      return measured;
    });
    const plans = planBoardPictures(input({ areas, viewportWidth: width }));
    const bands = plans.flatMap((plan) => plan.bands);
    assert.ok(bands.every((band) => band.tile), `every band tiled at ${width}px`);
    assert.ok(bands.length + plans.length <= SYSTEM_CHECK_PNGS_MAX / 2, `${bands.length} tiles + ${plans.length} overviews at ${width}px`);
  }
});

test('over the pixel budget: finding bands first, then top to bottom; the budget is never passed', () => {
  // 10 bands of 900 at 1000px wide = 9 MP; a 5 MP budget takes 5 bands.
  const areas = [{ area: 'components' as const, top: 0, height: 9000 }];
  const flagged = [{ top: 8200, bottom: 8300 }];
  const [plan] = planBoardPictures(input({ areas, flagged, viewportWidth: 1000, tilePixels: 5 * 900 * 1000 }));
  assert.ok(plan);
  const tiled = plan.bands.filter((band) => band.tile).map((band) => band.index);
  assert.deepEqual(tiled, [1, 2, 3, 4, 10], 'the finding band (10) is taken first, then 1 to 4');
  assert.equal(plan.bands.find((band) => band.index === 10)?.priority, true);
});

test('a tall flagged entry reserves only its top bands', () => {
  const areas = [{ area: 'components' as const, top: 0, height: 9000 }];
  const [plan] = planBoardPictures(input({ areas, flagged: [{ top: 0, bottom: 9000 }], tilePixels: 0 }));
  assert.equal(plan?.bands.filter((band) => band.priority).length, SYSTEM_CHECK_ENTRY_TILES_MAX);
  assert.equal(plan?.bands.filter((band) => band.tile).length, 0, 'no budget, no tiles, priority or not');
});

test('the PNG cap counts the overviews first', () => {
  const areas = [
    { area: 'foundations' as const, top: 0, height: 9000 },
    { area: 'components' as const, top: 9000, height: 9000 },
  ];
  const plans = planBoardPictures(input({ areas, pngs: 5 }));
  assert.equal(plans.flatMap((plan) => plan.bands).filter((band) => band.tile).length, 3, '5 PNGs - 2 overviews');
});

test('an empty area has no bands and no overview cost', () => {
  const plans = planBoardPictures(input({ areas: [{ area: 'brand', top: 500, height: 0 }, { area: 'components', top: 500, height: 900 }], pngs: 2 }));
  assert.deepEqual(plans.map((plan) => plan.bands.length), [0, 1]);
  assert.equal(plans[1]?.bands[0]?.tile, true, 'one overview + one tile fit two PNGs');
});

// ---- what the pictures cover, for the one honest note ----

test('pictureCoverage: one kind per area, the gaps exact', () => {
  const tiles = (count: number, from = 0) => Array.from({ length: count }, (_, index) => ({ y: (from + index) * 900, height: 900 }));
  assert.deepEqual(pictureCoverage({ heightPx: 2700, overview: { coversPx: 2700 }, tiles: tiles(3) }), { kind: 'whole', gaps: [] });
  assert.deepEqual(pictureCoverage({ heightPx: 2700, overview: { coversPx: 2700 }, tiles: tiles(1) }), { kind: 'tiles', gaps: [] });
  assert.deepEqual(pictureCoverage({ heightPx: 2700, overview: { coversPx: 900 }, tiles: tiles(3) }), { kind: 'overview', gaps: [] });
  assert.deepEqual(pictureCoverage({ heightPx: 2700, overview: null, tiles: tiles(3) }), { kind: 'no-overview', gaps: [] });
  // No overview and the tiles stop: the end is in no picture.
  assert.deepEqual(pictureCoverage({ heightPx: 2700, overview: null, tiles: tiles(2) }), { kind: 'gap', gaps: [[1800, 2700]] });
  // Overview to 900, tiles for the last band only: the middle is in no picture.
  assert.deepEqual(pictureCoverage({ heightPx: 2700, overview: { coversPx: 900 }, tiles: tiles(1, 2) }), { kind: 'gap', gaps: [[900, 1800]] });
  // A last band shorter than 900 still counts as covered to the end.
  assert.deepEqual(pictureCoverage({ heightPx: 2000, overview: null, tiles: [{ y: 0, height: 900 }, { y: 900, height: 900 }, { y: 1800, height: 200 }] }), { kind: 'no-overview', gaps: [] });
});

test('an area past the overview reach whose tile budget runs out is a gap, from where the pictures stop to its end', () => {
  // 40 000px at 1526px: the overview reaches 20 000px; a 10-tile budget reaches 9 000px.
  const [plan] = planBoardPictures(input({ areas: [{ area: 'foundations', top: 0, height: 40_000 }], tilePixels: 10 * 900 * 1526 }));
  assert.ok(plan);
  assert.equal(plan.coversPx, 20_000);
  const tiles = plan.bands.filter((band) => band.tile).map((band) => ({ y: band.y - plan.top, height: band.height }));
  assert.equal(tiles.length, 10);
  assert.deepEqual(pictureCoverage({ heightPx: plan.height, overview: { coversPx: plan.coversPx }, tiles }), { kind: 'gap', gaps: [[20_000, 40_000]] });
});
