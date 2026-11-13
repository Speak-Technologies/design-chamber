import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  artboardBox,
  clampCamera,
  FIT_MIN_WIDTH,
  fitAll,
  fitArea,
  focusArtboard,
  isBoxVisible,
  layoutWall,
  panBy,
  screenToWorld,
  wheelZoom,
  worldToScreen,
  zoomAt,
  zoomBy,
  type Camera,
  type WallScreen,
} from '../../src/guest/camera.ts';
import { ARTBOARD_LABEL_HEIGHT, CAMERA_SCALE_MAX, CAMERA_SCALE_MIN, WALL_GAP } from '../../src/shared/limits.ts';
import type { Viewport } from '../../src/shared/types.ts';

const close = (actual: number, expected: number, message?: string): void =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} expected ${expected}, got ${actual}`);

const LAPTOP: Viewport = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const PHONE: Viewport = { id: 'phone', label: 'Phone', width: 390, height: 844 };

test('zoom around a point keeps that point fixed on screen', () => {
  const cameras: Camera[] = [
    { x: 0, y: 0, scale: 1 },
    { x: -340, y: 125, scale: 0.37 },
    { x: 900, y: -2000, scale: 2.5 },
  ];
  const points = [
    { x: 0, y: 0 },
    { x: 412, y: 300 },
    { x: 1600, y: 1000 },
  ];
  for (const camera of cameras) {
    for (const point of points) {
      for (const scale of [0.1, 0.5, 1, 3.2]) {
        const before = screenToWorld(camera, point);
        const next = zoomAt(camera, scale, point);
        const after = worldToScreen(next, before);
        close(after.x, point.x, 'x');
        close(after.y, point.y, 'y');
        close(next.scale, scale, 'scale');
      }
    }
  }
});

test('wheel zoom: scale *= exp(-deltaY × 0.005) around the cursor; zoomBy multiplies', () => {
  const camera: Camera = { x: 10, y: 20, scale: 1 };
  const point = { x: 300, y: 200 };
  const zoomed = wheelZoom(camera, -100, point);
  close(zoomed.scale, Math.exp(0.5));
  const world = screenToWorld(camera, point);
  const screen = worldToScreen(zoomed, world);
  close(screen.x, point.x);
  close(screen.y, point.y);
  close(zoomBy(camera, 1.25, point).scale, 1.25);
  assert.deepEqual(wheelZoom(camera, Number.NaN, point), camera);
});

test('scale clamps to 5–400 % and pan to ±1e6', () => {
  const camera: Camera = { x: 0, y: 0, scale: 1 };
  assert.equal(zoomAt(camera, 100, { x: 0, y: 0 }).scale, CAMERA_SCALE_MAX);
  assert.equal(zoomAt(camera, 0.0001, { x: 0, y: 0 }).scale, CAMERA_SCALE_MIN);
  assert.equal(CAMERA_SCALE_MIN, 0.05);
  assert.equal(CAMERA_SCALE_MAX, 4);
  // Repeated wheel zoom never leaves the range.
  let cam = camera;
  for (let i = 0; i < 200; i += 1) cam = wheelZoom(cam, -120, { x: 50, y: 50 });
  assert.equal(cam.scale, CAMERA_SCALE_MAX);
  assert.deepEqual(clampCamera({ x: 5e6, y: -5e6, scale: Number.NaN }), { x: 1e6, y: -1e6, scale: 1 });
  assert.deepEqual(panBy({ x: 999_990, y: 0, scale: 1 }, 100, -30), { x: 1e6, y: -30, scale: 1 });
  assert.deepEqual(panBy(camera, Number.POSITIVE_INFINITY, 0), camera);
});

test('layoutWall: rows = screens, columns = viewports, gap 96, label 28', () => {
  const layout = layoutWall(
    [
      { id: 'home', title: 'Home' },
      { id: 'pricing', title: 'Pricing' },
    ],
    [LAPTOP, PHONE],
  );
  assert.equal(layout.artboards.length, 4);
  const at = (screen: string, viewport: string) => {
    const found = layout.artboards.find((artboard) => artboard.screen === screen && artboard.viewport.id === viewport);
    assert.ok(found, `${screen}@${viewport}`);
    return found;
  };
  const homeLaptop = at('home', 'laptop');
  assert.equal(homeLaptop.id, 'home@laptop');
  assert.deepEqual(homeLaptop.label, { x: 0, y: 0, width: 1280, height: ARTBOARD_LABEL_HEIGHT });
  assert.deepEqual(homeLaptop.frame, { x: 0, y: 28, width: 1280, height: 800 });
  // Column 2 starts after the laptop column + gap.
  assert.deepEqual(at('home', 'phone').frame, { x: 1280 + WALL_GAP, y: 28, width: 390, height: 844 });
  // Row 2 starts after the tallest viewport of row 1 (phone 844) + label + gap.
  const rowTwo = ARTBOARD_LABEL_HEIGHT + 844 + WALL_GAP;
  assert.deepEqual(at('pricing', 'laptop').label, { x: 0, y: rowTwo, width: 1280, height: 28 });
  assert.equal(at('pricing', 'phone').row, 1);
  assert.equal(at('pricing', 'phone').col, 1);
  assert.deepEqual(layout.bounds, { x: 0, y: 0, width: 1280 + WALL_GAP + 390, height: rowTwo + 28 + 844 });
});

test('layoutWall: per-screen viewport subsets leave cells empty; empty rows drop; artifact row', () => {
  const layout = layoutWall(
    [
      { id: 'home', title: 'Home', viewports: ['phone'] },
      { id: 'gone', title: 'Gone', viewports: ['tablet'] },
      { id: 'about', title: 'About' },
    ],
    [LAPTOP, PHONE],
  );
  assert.deepEqual(
    layout.artboards.map((artboard) => [artboard.id, artboard.row, artboard.col, artboard.frame.x, artboard.frame.y]),
    [
      ['home@phone', 0, 1, 1280 + WALL_GAP, 28],
      ['about@laptop', 1, 0, 0, 28 + 844 + WALL_GAP + 28],
      ['about@phone', 1, 1, 1280 + WALL_GAP, 28 + 844 + WALL_GAP + 28],
    ],
  );
  const artifact = layoutWall([{ id: null, title: 'Launch' }], [LAPTOP]);
  assert.equal(artifact.artboards[0]?.id, 'page@laptop');
  assert.equal(layoutWall([], [LAPTOP]).bounds, null);
});

test('fitArea: a drawer over the wall leaves the uncovered part to fit into, never a sliver (KI-4)', () => {
  const layout = layoutWall([{ id: 'home', title: 'Home' }, { id: 'pricing', title: 'Pricing' }], [LAPTOP, PHONE]);
  const boxes = layout.artboards.map(artboardBox);
  // The smoke layout: a ~580 px page with the 360 px drawer squeezing the wall used to fit to ~6 %.
  const squeezed = fitAll(boxes, { width: 100, height: 700 }, { padding: 56 });
  assert.equal(squeezed.scale, CAMERA_SCALE_MIN);
  // Now the drawer lies over the right half (50 %): fit aims at the 290 px left uncovered.
  const area = fitArea({ width: 580, height: 700 }, 290);
  assert.deepEqual(area, { width: 290, height: 700, padding: 24 });
  const camera = fitAll(boxes, area, { padding: area.padding });
  assert.ok(camera.scale > squeezed.scale * 2, `fit ${camera.scale}`);
  const right = worldToScreen(camera, { x: (layout.bounds?.x ?? 0) + (layout.bounds?.width ?? 0), y: 0 }).x;
  assert.ok(right <= 290 - 24 + 1e-6, 'nothing fitted under the drawer');
  // Less than FIT_MIN_WIDTH uncovered: fit uses the whole wall instead.
  assert.equal(fitArea({ width: 400, height: 700 }, 400 - FIT_MIN_WIDTH + 1).width, 400);
  assert.equal(fitArea({ width: 1200, height: 700 }, 0).width, 1200);
  assert.equal(fitArea({ width: 1200, height: 700 }, 0).padding, 56);
});

test('fitAll shows every artboard centred, never above 100 %; focusArtboard fits one', () => {
  const layout = layoutWall([{ id: 'home', title: 'Home' }, { id: 'pricing', title: 'Pricing' }], [LAPTOP, PHONE]);
  const viewport = { width: 1200, height: 700 };
  const camera = fitAll(layout.artboards.map(artboardBox), viewport, { padding: 40 });
  const bounds = layout.bounds;
  assert.ok(bounds);
  const topLeft = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const bottomRight = worldToScreen(camera, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
  assert.ok(topLeft.x >= 40 - 1e-6 && topLeft.y >= 40 - 1e-6, 'inside padding');
  assert.ok(bottomRight.x <= 1160 + 1e-6 && bottomRight.y <= 660 + 1e-6, 'inside padding');
  // Centred on the binding axis and on the other.
  close((topLeft.x + bottomRight.x) / 2, 600);
  close((topLeft.y + bottomRight.y) / 2, 350);
  // Tiny content is not blown up.
  assert.equal(fitAll([{ x: 0, y: 0, width: 10, height: 10 }], viewport).scale, 1);
  assert.deepEqual(fitAll([], viewport), { x: 0, y: 0, scale: 1 });

  const phone = layout.artboards.find((artboard) => artboard.id === 'pricing@phone');
  assert.ok(phone);
  const focused = focusArtboard(phone, viewport, { padding: 0 });
  close(focused.scale, 700 / (28 + 844));
  const centre = worldToScreen(focused, { x: phone.frame.x + 195, y: phone.label.y + (28 + 844) / 2 });
  close(centre.x, 600);
  close(centre.y, 350);
});

test('isBoxVisible honours the unload margin', () => {
  const camera: Camera = { x: 0, y: 0, scale: 1 };
  const viewport = { width: 1000, height: 800 };
  assert.equal(isBoxVisible(camera, { x: 100, y: 100, width: 10, height: 10 }, viewport), true);
  assert.equal(isBoxVisible(camera, { x: 1200, y: 100, width: 10, height: 10 }, viewport), false);
  assert.equal(isBoxVisible(camera, { x: 1200, y: 100, width: 10, height: 10 }, viewport, 0.5), true);
  assert.equal(isBoxVisible(camera, { x: -700, y: 100, width: 10, height: 10 }, viewport, 0.5), false);
});

// ---- Phase 2 wall layout: ghost row and direction rows (T11c) ----

const SCREENS: WallScreen[] = [
  { id: 'home', title: 'Home' },
  { id: 'pricing', title: 'Pricing' },
];
/** One screen row's advance with both viewports: label + the tallest (phone 844) + gap. */
const ROW_STEP = ARTBOARD_LABEL_HEIGHT + 844 + WALL_GAP;

const directionMembers = (count: number): WallScreen[] =>
  ['a', 'b', 'c', 'd'].slice(0, count).map((letter) => ({ id: `home-${letter}`, title: `Home, ${letter}` }));

test('layoutWall: ghost row sits after the last row, in the first column, and joins the bounds', () => {
  const ghost = { width: 1280, height: 240 };
  const layout = layoutWall(SCREENS, [LAPTOP, PHONE], { ghost });
  assert.deepEqual(layout.ghost, { kind: 'ghost', row: 2, box: { x: 0, y: ROW_STEP * 2, width: 1280, height: 240 } });
  // The ghost is part of the wall: fit-all must show it.
  assert.deepEqual(layout.bounds, { x: 0, y: 0, width: 1280 + WALL_GAP + 390, height: ROW_STEP * 2 + 240 });
  // The frames themselves do not move when a ghost is added.
  const plain = layoutWall(SCREENS, [LAPTOP, PHONE]);
  assert.deepEqual(layout.artboards, plain.artboards);
  assert.equal('ghost' in plain, false);

  // The last screen was trashed: the wall is only the ghost.
  const empty = layoutWall([], [LAPTOP], { ghost });
  assert.deepEqual(empty.artboards, []);
  assert.deepEqual(empty.ghost, { kind: 'ghost', row: 0, box: { x: 0, y: 0, width: 1280, height: 240 } });
  assert.deepEqual(empty.bounds, { x: 0, y: 0, width: 1280, height: 240 });
  // No viewports at all: the ghost still gets the first column (x 0) at the size passed.
  const noViewports = layoutWall([], [], { ghost: { width: 390, height: 240 } });
  assert.deepEqual(noViewports.bounds, { x: 0, y: 0, width: 390, height: 240 });
});

test('layoutWall: direction row on the page is one row, Current first, all at the chosen viewport', () => {
  const layout = layoutWall(
    [
      {
        group: {
          of: { id: 'home', title: 'Home' },
          members: [
            { id: 'home-a', title: 'Home, bold' },
            // A member's own viewport subset never hides it: directions are compared at one size.
            { id: 'home-b', title: 'Home, editorial', viewports: ['phone'] },
            { id: 'home-c', title: 'Home, quiet' },
          ],
        },
        viewport: LAPTOP,
      },
      { id: 'pricing', title: 'Pricing' },
    ],
    [LAPTOP, PHONE],
  );
  const cells = layout.artboards.filter((artboard) => artboard.row === 0);
  assert.deepEqual(
    cells.map((artboard) => [artboard.id, artboard.screenTitle, artboard.col, artboard.line, artboard.frame.x, artboard.frame.y]),
    [
      ['home@laptop', 'Home', 0, 0, 0, ARTBOARD_LABEL_HEIGHT],
      ['home-a@laptop', 'Home, bold', 1, 0, 1280 + WALL_GAP, ARTBOARD_LABEL_HEIGHT],
      ['home-b@laptop', 'Home, editorial', 2, 0, (1280 + WALL_GAP) * 2, ARTBOARD_LABEL_HEIGHT],
      ['home-c@laptop', 'Home, quiet', 3, 0, (1280 + WALL_GAP) * 3, ARTBOARD_LABEL_HEIGHT],
    ],
  );
  for (const cell of cells) {
    assert.equal(cell.screen, cell.id.split('@')[0]);
    assert.deepEqual(cell.viewport, LAPTOP);
    assert.deepEqual(cell.label, { x: cell.frame.x, y: 0, width: 1280, height: ARTBOARD_LABEL_HEIGHT });
    assert.deepEqual(cell.frame, { x: cell.frame.x, y: ARTBOARD_LABEL_HEIGHT, width: 1280, height: 800 });
  }
  // The next screen row starts after the group's one line (label + 800), not after a phone-tall row.
  const groupStep = ARTBOARD_LABEL_HEIGHT + 800 + WALL_GAP;
  const pricing = layout.artboards.find((artboard) => artboard.id === 'pricing@laptop');
  assert.ok(pricing);
  assert.equal(pricing.row, 1);
  assert.equal(pricing.label.y, groupStep);
  assert.deepEqual(layout.bounds, {
    x: 0,
    y: 0,
    width: (1280 + WALL_GAP) * 3 + 1280,
    height: groupStep + ARTBOARD_LABEL_HEIGHT + 844,
  });
});

test('layoutWall: direction rows flow 1 to 4 members at columns 2 (rail grid) and unlimited (page row)', () => {
  const cellStep = 390 + WALL_GAP;
  const lineStep = ARTBOARD_LABEL_HEIGHT + 844 + WALL_GAP;
  for (const columns of [2, undefined]) {
    for (const count of [1, 2, 3, 4]) {
      const members = directionMembers(count);
      const layout = layoutWall(
        [{ group: { of: { id: 'home', title: 'Home' }, members }, viewport: PHONE }, { id: 'next', title: 'Next' }],
        [LAPTOP, PHONE],
        { directionColumns: columns },
      );
      const cellCount = count + 1;
      const lines = columns === undefined ? 1 : Math.ceil(cellCount / columns);
      const ids = ['home', ...members.map((member) => member.id)];
      const cells = layout.artboards.filter((artboard) => artboard.row === 0);
      assert.equal(cells.length, cellCount, `columns ${columns}, members ${count}`);
      cells.forEach((cell, index) => {
        const line = columns === undefined ? 0 : Math.floor(index / columns);
        const col = columns === undefined ? index : index % columns;
        assert.equal(cell.id, `${ids[index]}@phone`, `cell ${index} id`);
        assert.equal(cell.line, line, `cell ${index} line`);
        assert.equal(cell.col, col, `cell ${index} col`);
        assert.deepEqual(cell.label, { x: col * cellStep, y: line * lineStep, width: 390, height: ARTBOARD_LABEL_HEIGHT });
        assert.deepEqual(cell.frame, { x: col * cellStep, y: line * lineStep + ARTBOARD_LABEL_HEIGHT, width: 390, height: 844 });
      });
      // The y cursor advances by the group's whole grid, then the next screen row follows.
      const next = layout.artboards.find((artboard) => artboard.id === 'next@laptop');
      assert.ok(next);
      assert.equal(next.row, 1);
      assert.equal(next.label.y, lines * lineStep);
      const groupWidth = Math.min(cellCount, columns ?? cellCount) * cellStep - WALL_GAP;
      assert.deepEqual(layout.bounds, {
        x: 0,
        y: 0,
        width: Math.max(groupWidth, 1280 + WALL_GAP + 390),
        height: lines * lineStep + ARTBOARD_LABEL_HEIGHT + 844,
      });
    }
  }
  // Three cells leave the second line's right cell empty; a fourth member starts a third line.
  const three = layoutWall([{ group: { of: { id: 'home', title: 'Home' }, members: directionMembers(2) }, viewport: PHONE }], [LAPTOP, PHONE], { directionColumns: 2 });
  assert.deepEqual(three.artboards.map((artboard) => [artboard.id, artboard.line, artboard.col]), [
    ['home@phone', 0, 0],
    ['home-a@phone', 0, 1],
    ['home-b@phone', 1, 0],
  ]);
  const four = layoutWall([{ group: { of: { id: 'home', title: 'Home' }, members: directionMembers(4) }, viewport: PHONE }], [LAPTOP, PHONE], { directionColumns: 2 });
  assert.deepEqual(four.artboards[4] && [four.artboards[4].id, four.artboards[4].line, four.artboards[4].col], ['home-d@phone', 2, 0]);
});

test('layoutWall: screen rows, direction rows and the ghost share one row counter and y cursor', () => {
  const layout = layoutWall(
    [
      { id: 'home', title: 'Home' },
      {
        group: {
          of: { id: 'checkout', title: 'Checkout' },
          members: [
            { id: 'checkout-a', title: 'Checkout, a' },
            { id: 'checkout-b', title: 'Checkout, b' },
          ],
        },
        viewport: LAPTOP,
      },
      { id: 'pricing', title: 'Pricing' },
    ],
    [LAPTOP, PHONE],
    { directionColumns: 2, ghost: { width: 1280, height: 240 } },
  );
  // Row 0: home (phone-tall). Row 1: the group, a 2-line grid at laptop height. Row 2: pricing.
  const groupTop = ROW_STEP;
  const groupLineStep = ARTBOARD_LABEL_HEIGHT + 800 + WALL_GAP;
  const groupCells = layout.artboards.filter((artboard) => artboard.row === 1);
  assert.deepEqual(
    groupCells.map((artboard) => [artboard.id, artboard.line, artboard.col, artboard.frame.x, artboard.frame.y]),
    [
      ['checkout@laptop', 0, 0, 0, groupTop + ARTBOARD_LABEL_HEIGHT],
      ['checkout-a@laptop', 0, 1, 1280 + WALL_GAP, groupTop + ARTBOARD_LABEL_HEIGHT],
      ['checkout-b@laptop', 1, 0, 0, groupTop + groupLineStep + ARTBOARD_LABEL_HEIGHT],
    ],
  );
  const pricing = layout.artboards.find((artboard) => artboard.id === 'pricing@phone');
  assert.ok(pricing);
  assert.equal(pricing.row, 2);
  assert.equal(pricing.label.y, groupTop + groupLineStep * 2);
  assert.deepEqual(layout.ghost, {
    kind: 'ghost',
    row: 3,
    box: { x: 0, y: groupTop + groupLineStep * 2 + ROW_STEP, width: 1280, height: 240 },
  });
  assert.deepEqual(layout.bounds, {
    x: 0,
    y: 0,
    width: (1280 + WALL_GAP) + 1280,
    height: groupTop + groupLineStep * 2 + ROW_STEP + 240,
  });
});

test('layoutWall: today\'s layouts are unchanged without directions or a ghost; every screen cell sits on line 0', () => {
  const plain = layoutWall(SCREENS, [LAPTOP, PHONE]);
  // directionColumns only affects direction rows; ghost: undefined is the same as absent.
  assert.deepEqual(layoutWall(SCREENS, [LAPTOP, PHONE], { directionColumns: 2 }), plain);
  assert.deepEqual(layoutWall(SCREENS, [LAPTOP, PHONE], { ghost: undefined }), plain);
  for (const artboard of plain.artboards) assert.equal(artboard.line, 0);
  // The geometry the wall has always drawn (same expectations as the Phase 1 tests above).
  assert.deepEqual(plain.artboards.map((artboard) => [artboard.id, artboard.row, artboard.col, artboard.frame.x, artboard.frame.y]), [
    ['home@laptop', 0, 0, 0, ARTBOARD_LABEL_HEIGHT],
    ['home@phone', 0, 1, 1280 + WALL_GAP, ARTBOARD_LABEL_HEIGHT],
    ['pricing@laptop', 1, 0, 0, ROW_STEP + ARTBOARD_LABEL_HEIGHT],
    ['pricing@phone', 1, 1, 1280 + WALL_GAP, ROW_STEP + ARTBOARD_LABEL_HEIGHT],
  ]);
  assert.deepEqual(plain.bounds, { x: 0, y: 0, width: 1280 + WALL_GAP + 390, height: ROW_STEP + ARTBOARD_LABEL_HEIGHT + 844 });
});

test('layoutWall: directionColumns below 1 clamps to one cell per line; a non-number keeps one row', () => {
  const rows = [{ group: { of: { id: 'home', title: 'Home' }, members: directionMembers(2) }, viewport: PHONE }];
  const lineStep = ARTBOARD_LABEL_HEIGHT + 844 + WALL_GAP;
  for (const columns of [0, -2, 1.9]) {
    const layout = layoutWall(rows, [LAPTOP, PHONE], { directionColumns: columns });
    assert.deepEqual(layout.artboards.map((artboard) => [artboard.line, artboard.col, artboard.frame.y]), [
      [0, 0, ARTBOARD_LABEL_HEIGHT],
      [1, 0, lineStep + ARTBOARD_LABEL_HEIGHT],
      [2, 0, lineStep * 2 + ARTBOARD_LABEL_HEIGHT],
    ], `columns ${columns}`);
  }
  const nan = layoutWall(rows, [LAPTOP, PHONE], { directionColumns: Number.NaN });
  assert.deepEqual(nan.artboards.map((artboard) => [artboard.line, artboard.col]), [[0, 0], [0, 1], [0, 2]]);
});
