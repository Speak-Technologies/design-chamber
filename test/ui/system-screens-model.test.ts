import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SystemScreen, Viewport } from '../../src/shared/types.ts';
import {
  SCREENS_EMPTY,
  SCREEN_KIND_LABEL,
  bestWrap,
  cellsOf,
  screenRowLabel,
  screenRowMeta,
  screenViewports,
  screenWall,
  screensTabShown,
  viewportText,
  zoomText,
} from '../../src/ui/model/system-page-model.ts';
import { liveBoards } from '../../src/ui/model/wall-model.ts';

const laptop: Viewport = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const phone: Viewport = { id: 'phone', label: 'Phone', width: 390, height: 844 };
const social: Viewport = { id: 'social', label: 'Social card', width: 1200, height: 630 };
const system = [laptop, phone];

const screen = (id: string, over: Partial<SystemScreen> = {}): SystemScreen => ({ id, title: id[0]?.toUpperCase() + id.slice(1), kind: 'page', viewports: null, problem: null, ...over });
const options = { gap: 96, labelHeight: 28 };

test('the Screens switch shows once a system has a screen, and stays while Screens is on show', () => {
  assert.equal(screensTabShown({ screens: [] }, 'board'), false);
  assert.equal(screensTabShown({ screens: [screen('home')] }, 'board'), true);
  // The agent removed the last screen while the user looked at them: the empty state needs the switch to get back.
  assert.equal(screensTabShown({ screens: [] }, 'screens'), true);
});

test('a screen’s own sizes replace the system’s; none or an empty list falls back to the system’s', () => {
  assert.deepEqual(screenViewports({ viewports: null }, system), system);
  assert.deepEqual(screenViewports({ viewports: [] }, system), system);
  assert.deepEqual(screenViewports({ viewports: [social] }, system), [social]);
});

test('rows read in words: kind and sizes, and an accessible name with every size', () => {
  assert.equal(screenRowMeta(screen('home'), system), 'Page template · Laptop, Phone');
  assert.equal(screenRowMeta(screen('card', { kind: 'marketing', viewports: [social] }), system), 'Marketing · Social card');
  assert.equal(screenRowLabel(screen('home'), system), 'Home, page template at Laptop 1280×800 and Phone 390×844');
  assert.equal(screenRowLabel(screen('empty', { kind: 'state', viewports: [phone] }), system), 'Empty, screen state at Phone 390×844');
  assert.equal(viewportText(social), 'Social card 1200×630');
  for (const label of Object.values(SCREEN_KIND_LABEL)) assert.doesNotMatch(label, /[—–]/);
  assert.doesNotMatch(SCREENS_EMPTY, /[—–]/);
});

test('the wall lays one row per screen, its sizes left to right, each row as tall as its tallest size', () => {
  const wall = screenWall([screen('home'), screen('card', { kind: 'marketing', viewports: [social] }), screen('empty', { kind: 'state', viewports: [phone] })], system, options);
  assert.deepEqual(wall.cells.map((cell) => cell.id), ['home@laptop', 'home@phone', 'card@social', 'empty@phone']);
  const [homeLaptop, homePhone, card, empty] = wall.cells;
  assert.ok(homeLaptop && homePhone && card && empty);
  assert.deepEqual(homeLaptop.frame, { x: 0, y: 28, w: 1280, h: 800 });
  assert.deepEqual(homePhone.frame, { x: 1280 + 96, y: 28, w: 390, h: 844 });
  // The first row is as tall as the phone (844), so the second starts under it plus the gap.
  const secondTop = 28 + 844 + 96;
  assert.deepEqual(card.label, { x: 0, y: secondTop, w: 1200, h: 28 });
  assert.deepEqual(card.frame, { x: 0, y: secondTop + 28, w: 1200, h: 630 });
  const thirdTop = secondTop + 28 + 630 + 96;
  assert.deepEqual(empty.frame, { x: 0, y: thirdTop + 28, w: 390, h: 844 });
  assert.deepEqual(empty.rect, { x: 0, y: thirdTop, w: 390, h: 28 + 844 });
  assert.deepEqual(wall.bounds, { x: 0, y: 0, width: 1280 + 96 + 390, height: thirdTop + 28 + 844 });
});

test('rows can sit further apart than columns', () => {
  const wall = screenWall([screen('a', { viewports: [phone] }), screen('b', { viewports: [phone] })], system, { gap: 96, rowGap: 160, labelHeight: 28 });
  assert.equal(wall.cells[1]?.label.y, 28 + 844 + 160);
  assert.deepEqual(wall.bounds, { x: 0, y: 0, width: 390, height: 2 * (28 + 844) + 160 });
});

test('a screen the reader refused keeps its cells with the sentence, so the wall can say why it is blank', () => {
  const wall = screenWall([screen('checkout', { problem: 'screens/checkout.html is missing.' })], system, options);
  assert.equal(wall.cells.length, 2);
  assert.ok(wall.cells.every((cell) => cell.problem === 'screens/checkout.html is missing.'));
});

test('past `wrap` the next screen starts a new line; under it screens share one', () => {
  const screens = [screen('a', { viewports: [phone] }), screen('b', { viewports: [phone] }), screen('c', { viewports: [phone] })];
  const wide = screenWall(screens, system, { ...options, wrap: 390 * 2 + 96 });
  assert.deepEqual(wide.cells.map((cell) => [cell.id, cell.frame.x, cell.frame.y]), [['a@phone', 0, 28], ['b@phone', 486, 28], ['c@phone', 0, 28 + 844 + 96 + 28]]);
  // A screen wider than `wrap` still gets its own line rather than vanishing.
  assert.equal(screenWall([screen('big')], system, { ...options, wrap: 10 }).cells.length, 2);
});

test('the best line width is the one that draws the whole wall largest in the stage', () => {
  const screens = ['a', 'b', 'c', 'd'].map((id) => screen(id, { viewports: [phone] }));
  // A wide, short stage: four phones in a row beat a column.
  const wideStage = bestWrap(screens, system, options, { w: 1600, h: 400 });
  assert.equal(screenWall(screens, system, { ...options, wrap: wideStage }).cells.every((cell) => cell.frame.y === 28), true);
  // A tall, narrow stage: one per line.
  assert.equal(bestWrap(screens, system, options, { w: 300, h: 2000 }), 0);
  // A square stage: two by two.
  const square = screenWall(screens, system, { ...options, wrap: bestWrap(screens, system, options, { w: 1000, h: 1000 }) });
  assert.deepEqual(new Set(square.cells.map((cell) => cell.frame.y)).size, 2);
  assert.equal(bestWrap(screens, system, options, { w: 0, h: 0 }), 0);
  assert.equal(bestWrap([], system, options, { w: 800, h: 600 }), 0);
});

test('no screens lay out nothing', () => {
  assert.deepEqual(screenWall([], system, options), { cells: [], bounds: null });
});

test('the rail shows one screen at a time; the page every cell', () => {
  const wall = screenWall([screen('home'), screen('about')], system, options);
  assert.deepEqual(cellsOf(wall, 'about').map((cell) => cell.id), ['about@laptop', 'about@phone']);
  assert.equal(cellsOf(wall, null).length, 4);
  assert.deepEqual(cellsOf(wall, 'gone'), []);
});

test('the live-frame budget keeps the screens nearest the centre (the wall’s own rule, fed these cells)', () => {
  const wall = screenWall([screen('a'), screen('b'), screen('c')], system, options);
  // At 100% from the top-left of a 1000×700 surface the two laptops down the left edge are nearest its middle; the phones,
  // off to the right, wait. A budget of 2 keeps those two.
  const live = liveBoards(wall.cells, { x: 0, y: 0, scale: 1 }, { w: 1000, h: 700 }, 2, 0.5).map((cell) => cell.id);
  assert.deepEqual(live, ['a@laptop', 'b@laptop']);
  // Far off screen, nothing is live (the budget never loads what can't be seen).
  assert.deepEqual(liveBoards(wall.cells, { x: -90_000, y: 0, scale: 1 }, { w: 1000, h: 700 }, 2, 0.5), []);
});

test('the zoom reads as a whole percentage', () => {
  assert.equal(zoomText(1), '100%');
  assert.equal(zoomText(0.4567), '46%');
});
