import assert from 'node:assert/strict';
import { test } from 'node:test';

import { layoutWall } from '../../src/guest/camera.ts';
import type { Screen, Viewport } from '../../src/shared/types.ts';
import {
  boardLabel,
  DIRECTION_HEAD_ROOM,
  DIRECTION_LINE_ROOM,
  directionColumns,
  directionsOffReason,
  keepLabel,
  keepRequest,
  keepState,
  keptNotice,
  moveRowToGap,
  pickViewport,
  planDirections,
  readDirectionViewports,
  rowTitle,
  rowViewports,
  spaceDirectionRows,
  wallRows,
  type KeepInput,
} from '../../src/ui/model/directions-model.ts';

const LAPTOP: Viewport = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
const PHONE: Viewport = { id: 'phone', label: 'Phone', width: 390, height: 844 };
const VIEWPORTS = [LAPTOP, PHONE];

const screen = (id: string, over: Partial<Screen> = {}): Screen => ({ id, title: id[0]?.toUpperCase() + id.slice(1), file: `screens/${id}.html`, ...over });
const member = (id: string, of: string, letter: 'A' | 'B' | 'C' | 'D', name: string): Screen => screen(id, { direction: { of, letter, name } });

const home = screen('home');
const pricing = screen('pricing');
const checkout = screen('checkout');
const pricingA = member('pricing-a', 'pricing', 'A', 'Bold');
const pricingB = member('pricing-b', 'pricing', 'B', 'Editorial');
const pricingC = member('pricing-c', 'pricing', 'C', 'Cards');
const LIST = [home, pricing, checkout, pricingA, pricingB, pricingC];

const planOf = (screens: readonly Screen[], chosen: Record<string, string> = {}) => planDirections(screens, VIEWPORTS, (of) => chosen[of]);

// ---- the rows ----

test('a marked screen is part of its original\'s row, the original comes first, members in letter order', () => {
  const plan = planOf([home, pricing, pricingC, pricingA, checkout]);
  const row = plan.rows.get('pricing');
  assert.ok(row);
  assert.deepEqual(row.members.map((one) => one.id), ['pricing-a', 'pricing-c']);
  assert.equal(plan.memberOf.get('pricing-a'), 'pricing');
  assert.equal(plan.memberOf.get('pricing'), undefined, 'the original is not a member');
});

test('a screen list with no marks has no rows and the wall rows are the screens', () => {
  const plan = planOf([home, pricing]);
  assert.equal(plan.rows.size, 0);
  assert.deepEqual(wallRows([home, pricing], plan), [
    { id: 'home', title: 'Home' },
    { id: 'pricing', title: 'Pricing' },
  ]);
});

test('wallRows puts a direction row where its original is and gives a member no row of its own', () => {
  const rows = wallRows(LIST, planOf(LIST));
  assert.equal(rows.length, 3);
  const second = rows[1];
  assert.ok(second && 'group' in second);
  assert.equal(second.group.of.id, 'pricing');
  assert.deepEqual(second.group.members.map((one) => one.id), ['pricing-a', 'pricing-b', 'pricing-c']);
  assert.equal(second.viewport.id, 'laptop');
});

test('the row shows the first of the original\'s viewports, or the one the user chose', () => {
  assert.equal(planOf(LIST).rows.get('pricing')?.viewport.id, 'laptop');
  assert.equal(planOf(LIST, { pricing: 'phone' }).rows.get('pricing')?.viewport.id, 'phone');
  assert.equal(planOf(LIST, { pricing: 'tv' }).rows.get('pricing')?.viewport.id, 'laptop', 'an unknown id shows the first');
});

test('Show at offers the original\'s own viewports; a choice it does not have shows the first', () => {
  const phoneOnly = screen('pricing', { viewports: ['phone'] });
  assert.deepEqual(rowViewports(phoneOnly, VIEWPORTS).map((one) => one.id), ['phone']);
  assert.deepEqual(rowViewports(screen('x', { viewports: ['gone'] }), VIEWPORTS).map((one) => one.id), ['laptop', 'phone'], 'a subset that matches nothing falls back to all');
  const plan = planOf([phoneOnly, member('pricing-a', 'pricing', 'A', 'Bold')], { pricing: 'laptop' });
  assert.equal(plan.rows.get('pricing')?.viewport.id, 'phone');
  assert.equal(pickViewport([], 'laptop'), null);
});

test('the page keeps one row, the rail a grid of two columns', () => {
  assert.equal(directionColumns(false), undefined);
  assert.equal(directionColumns(true), 2);
});

// ---- names ----

test('the row title counts the directions and says one in the singular', () => {
  assert.equal(rowTitle('Pricing', 3), 'Pricing · 3 directions');
  assert.equal(rowTitle('Pricing', 1), 'Pricing · 1 direction');
});

test('Current carries its viewport, a direction its letter and the agent\'s short name', () => {
  assert.deepEqual(boardLabel(pricing, LAPTOP), { name: 'Current', detail: 'Laptop 1280×800', full: 'Current · Laptop 1280×800' });
  assert.deepEqual(boardLabel(pricingB, LAPTOP), { name: 'B', detail: 'Editorial', full: 'B · Editorial' });
});

test('the Keep button\'s accessible name starts with its visible words', () => {
  assert.equal(keepLabel(pricing, 'Pricing'), 'Keep this one: the current Pricing');
  assert.equal(keepLabel(pricingA, 'Pricing'), 'Keep this one: direction A, Bold');
});

// ---- Keep this one ----

const keepInput = (over: Partial<KeepInput> = {}): KeepInput => ({ viewing: false, designJson: 'ok', listInvalid: false, editing: true, busy: false, written: true, ...over });

test('Keep is on for a written board in Edit mode', () => {
  assert.deepEqual(keepState(keepInput()), { shown: true, disabled: false, reason: null });
});

test('a board that is not written yet cannot be kept, and says so', () => {
  assert.deepEqual(keepState(keepInput({ written: false })), { shown: true, disabled: true, reason: 'Not written yet.' });
});

test('an old version on show and Play mode hide Keep; the row keeps its layout', () => {
  assert.equal(keepState(keepInput({ viewing: true })).shown, false);
  assert.equal(keepState(keepInput({ editing: false })).shown, false);
});

test('a running request turns every Keep off without a reason of its own (the pressed board spins)', () => {
  assert.deepEqual(keepState(keepInput({ busy: true })), { shown: true, disabled: true, reason: null });
});

test('a design.json that cannot be changed turns Keep off with the sentence the screen menu uses', () => {
  const missing = keepState(keepInput({ designJson: 'missing' }));
  assert.equal(missing.disabled, true);
  assert.match(missing.reason ?? '', /no design\.json/);
  assert.equal(keepState(keepInput({ designJson: 'invalid' })).disabled, true);
  assert.equal(keepState(keepInput({ listInvalid: true })).disabled, true);
});

test('Try 3 directions is off for an original that has directions and for a direction', () => {
  const plan = planOf(LIST);
  const titleOf = (id: string): string => LIST.find((one) => one.id === id)?.title ?? id;
  assert.equal(directionsOffReason('pricing', plan, titleOf), 'This screen already has directions. Keep one first.');
  assert.equal(directionsOffReason('pricing-b', plan, titleOf), 'This is a direction of Pricing. Keep one first.');
  assert.equal(directionsOffReason('home', plan, titleOf), null);
});

test('the Keep request names the original and every direction with the file the wall shows of it', () => {
  const plan = planOf(LIST);
  const row = plan.rows.get('pricing');
  assert.ok(row);
  const request = keepRequest({
    stamp: 'sha-1',
    row,
    keep: 'pricing-b',
    files: {
      pricing: { exists: true, size: 10, mtime: '2026-11-01T00:00:00.000Z' },
      'pricing-a': { exists: true, size: 20, mtime: '2026-11-01T00:00:01.000Z' },
      'pricing-b': { exists: true, size: 30, mtime: '2026-11-01T00:00:02.000Z' },
      'pricing-c': { exists: false, size: 0, mtime: null },
    },
  });
  assert.deepEqual(request, {
    op: 'keep-direction',
    screens: 'sha-1',
    of: 'pricing',
    keep: 'pricing-b',
    files: [
      { id: 'pricing', file: { size: 10, mtime: '2026-11-01T00:00:00.000Z' } },
      { id: 'pricing-a', file: { size: 20, mtime: '2026-11-01T00:00:01.000Z' } },
      { id: 'pricing-b', file: { size: 30, mtime: '2026-11-01T00:00:02.000Z' } },
      { id: 'pricing-c', file: null },
    ],
  });
});

test('a direction missing from the wall\'s file list is named with a null stamp, never left out', () => {
  const row = planOf(LIST).rows.get('pricing');
  assert.ok(row);
  const request = keepRequest({ stamp: 's', row, keep: 'pricing', files: { pricing: { exists: true, size: 1, mtime: null } } });
  assert.deepEqual(request.files.map((entry) => entry.id), ['pricing', 'pricing-a', 'pricing-b', 'pricing-c']);
  assert.equal(request.files[1]?.file, null);
});

test('the notice reads as one sentence from the service\'s label and detail', () => {
  assert.deepEqual(keptNotice({ id: 'e1', label: 'Kept B for "Pricing"', detail: 'The others are in the trash.', undoable: true }), { id: 'e1', label: 'Kept B for "Pricing". The others are in the trash.', undoable: true });
  assert.equal(keptNotice({ id: 'e2', label: 'Kept the current "Pricing"', undoable: false }).label, 'Kept the current "Pricing"');
});

// ---- saved view settings ----

test('the saved viewport choices keep only text values', () => {
  assert.deepEqual(readDirectionViewports({ pricing: 'phone', bad: 3, other: null }), { pricing: 'phone' });
  assert.deepEqual(readDirectionViewports(['phone']), {});
  assert.deepEqual(readDirectionViewports(undefined), {});
});

// ---- room on the wall ----

const laidOut = (screens: readonly Screen[], columns?: number) => {
  const plan = planOf(screens);
  const placed = layoutWall(wallRows(screens, plan), VIEWPORTS, columns === undefined ? {} : { directionColumns: columns });
  return { plan, placed, spaced: spaceDirectionRows(placed, plan) };
};

test('without a direction row the layout is returned as it is', () => {
  const { placed, spaced } = laidOut([home, checkout]);
  assert.equal(spaced.layout, placed);
  assert.equal(spaced.heads.size, 0);
});

test('a row\'s header gets room above it, and the rows below it move down by that room', () => {
  const { placed, spaced } = laidOut(LIST);
  const before = (id: string) => placed.artboards.find((cell) => cell.screen === id && cell.viewport.id === 'laptop');
  const after = (id: string) => spaced.layout.artboards.find((cell) => cell.screen === id && cell.viewport.id === 'laptop');
  assert.equal(after('home')?.frame.y, before('home')?.frame.y, 'the row above is where it was');
  assert.equal(after('pricing')?.frame.y, (before('pricing')?.frame.y ?? 0) + DIRECTION_HEAD_ROOM);
  assert.equal(after('checkout')?.frame.y, (before('checkout')?.frame.y ?? 0) + DIRECTION_HEAD_ROOM, 'the row below moved by the same room');
  const head = spaced.heads.get('pricing');
  assert.ok(head);
  assert.equal(head.height, DIRECTION_HEAD_ROOM);
  assert.equal(head.y + head.height, after('pricing')?.label.y, 'the header strip ends where the first label begins');
});

test('on the page the cells share one line; in the rail\'s grid the second line gets room of its own', () => {
  const page = laidOut(LIST).spaced.layout.artboards.filter((cell) => cell.screen?.startsWith('pricing') && cell.viewport.id === 'laptop');
  assert.equal(new Set(page.map((cell) => cell.frame.y)).size, 1);
  const rail = laidOut(LIST, 2);
  const cells = rail.spaced.layout.artboards.filter((cell) => cell.screen?.startsWith('pricing') && cell.viewport.id === 'laptop');
  const lineOf = (id: string) => rail.placed.artboards.find((cell) => cell.screen === id && cell.viewport.id === 'laptop');
  const byId = (id: string) => cells.find((cell) => cell.screen === id);
  assert.equal(byId('pricing')?.frame.y, byId('pricing-a')?.frame.y, 'Current and A share the first line');
  assert.equal((byId('pricing-b')?.frame.y ?? 0) - (byId('pricing')?.frame.y ?? 0), (lineOf('pricing-b')?.frame.y ?? 0) - (lineOf('pricing')?.frame.y ?? 0) + DIRECTION_LINE_ROOM);
});

test('the bounds include the header, so Fit shows it', () => {
  const { spaced } = laidOut(LIST);
  const head = spaced.heads.get('pricing');
  assert.ok(head && spaced.layout.bounds);
  assert.ok(spaced.layout.bounds.y <= head.y);
  assert.ok(spaced.layout.bounds.y + spaced.layout.bounds.height >= head.y + head.height);
});

test('a direction row first on the wall puts its header above the wall\'s top', () => {
  const screens = [pricing, pricingA];
  const { spaced } = laidOut(screens);
  assert.equal(spaced.heads.get('pricing')?.y, 0);
  assert.equal(spaced.layout.bounds?.y, 0);
});

test('the ghost row moves down with everything above it', () => {
  const plan = planOf(LIST);
  const placed = layoutWall(wallRows(LIST, plan), VIEWPORTS, { ghost: { width: 1280, height: 240 } });
  const spaced = spaceDirectionRows(placed, plan);
  assert.ok(placed.ghost && spaced.layout.ghost);
  assert.equal(spaced.layout.ghost.box.y, placed.ghost.box.y + DIRECTION_HEAD_ROOM);
});

test('two direction rows each reserve their own header', () => {
  const screens = [pricing, pricingA, home, member('home-a', 'home', 'A', 'Quiet')];
  const { spaced } = laidOut(screens);
  const first = spaced.heads.get('pricing');
  const second = spaced.heads.get('home');
  assert.ok(first && second);
  assert.ok(second.y >= first.y + first.height, 'the second header is below the first row');
});

// ---- moving a row ----

test('a row dropped between two others goes there, with its directions right after it', () => {
  const order = LIST.map((one) => one.id); // home, pricing, checkout, pricing-a, pricing-b, pricing-c
  const rowIds = ['home', 'pricing', 'checkout'];
  assert.deepEqual(moveRowToGap(order, rowIds, 'pricing', new Set(['pricing', 'pricing-a', 'pricing-b', 'pricing-c']), 3), ['home', 'checkout', 'pricing', 'pricing-a', 'pricing-b', 'pricing-c']);
  assert.deepEqual(moveRowToGap(order, rowIds, 'checkout', new Set(['checkout']), 1), ['home', 'checkout', 'pricing', 'pricing-a', 'pricing-b', 'pricing-c']);
});

test('dropping a row where it already is changes nothing', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(moveRowToGap(order, order, 'b', new Set(['b']), 1), null);
  assert.equal(moveRowToGap(order, order, 'b', new Set(['b']), 2), null);
  assert.equal(moveRowToGap(order, order, 'b', new Set(['b']), 9), null);
  assert.equal(moveRowToGap(order, order, 'zzz', new Set(['zzz']), 0), null);
});

test('for a list with no directions it agrees with moving one screen', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveRowToGap(order, order, 'd', new Set(['d']), 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveRowToGap(order, order, 'a', new Set(['a']), 4), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moveRowToGap(order, order, 'b', new Set(['b']), 3), ['a', 'c', 'b', 'd']);
});

test('a screen with no row on the wall keeps its place in the list', () => {
  // "hidden" has no row (its viewports are all hidden), so it is not counted in the gaps.
  const order = ['a', 'hidden', 'b', 'c'];
  assert.deepEqual(moveRowToGap(order, ['a', 'b', 'c'], 'c', new Set(['c']), 1), ['a', 'hidden', 'c', 'b']);
});

test('a direction listed before its original still travels with it', () => {
  const order = ['pricing-a', 'home', 'pricing'];
  const moved = moveRowToGap(order, ['home', 'pricing'], 'pricing', new Set(['pricing', 'pricing-a']), 0);
  assert.deepEqual(moved, ['pricing', 'pricing-a', 'home']);
});
