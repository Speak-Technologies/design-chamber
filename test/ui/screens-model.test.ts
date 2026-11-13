import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ASK_TEXT_MAX, SCREENS_MAX } from '../../src/shared/limits.ts';
import { directionsAsk, newScreenAsk } from '../../src/shared/agent/screen-asks.ts';
import type { MenuEntry } from '../../src/ui/components/kit.ts';
import { AGENT_WORKING_LINE } from '../../src/ui/model/edit-text-model.ts';
import {
  directionsRoom,
  dropTarget,
  ghostVisible,
  moveToGap,
  askNoteBox,
  newScreenRoom,
  revealPan,
  screenMenu,
  screensBlock,
  shiftOrder,
  SCREENS_CAP_MESSAGE,
  type DragRow,
  type ScreenMenuInput,
} from '../../src/ui/model/screens-model.ts';

type Action = Extract<MenuEntry, { id: string }>;
const entry = (menu: ReturnType<typeof screenMenu>, id: string): Action => {
  const found = menu.items.find((item): item is Action => 'id' in item && item.id === id);
  assert.ok(found, `entry ${id}`);
  return found;
};
const menuOf = (input: Partial<ScreenMenuInput> = {}) =>
  screenMenu({ viewing: false, designJson: 'ok', listInvalid: false, index: 1, count: 3, hasFile: true, agentWorking: false, ...input });

// ---- the menu ----

test('the menu is text only: Duplicate, Move up, Move down, Move to trash, a separator, Try 3 directions…', () => {
  const menu = menuOf();
  assert.deepEqual(menu.items.map((item) => ('id' in item ? item.label : '-')), ['Duplicate', 'Move up', 'Move down', 'Move to trash', '-', 'Try 3 directions…']);
  for (const item of menu.items) if ('id' in item) assert.deepEqual(Object.keys(item).sort(), ['id', 'label'], `${item.id} carries nothing but a label while it is usable`);
  assert.deepEqual(menu.notes, {});
});

test('Move up is off on the first screen and Move down on the last, each saying why inside the option', () => {
  assert.deepEqual(entry(menuOf({ index: 0 }), 'up'), { id: 'up', label: 'Move up', disabled: true, reason: 'This is the first screen.' });
  assert.equal(entry(menuOf({ index: 0 }), 'down').disabled, undefined);
  assert.deepEqual(entry(menuOf({ index: 2 }), 'down'), { id: 'down', label: 'Move down', disabled: true, reason: 'This is the last screen.' });
  assert.equal(entry(menuOf({ index: 2 }), 'up').disabled, undefined);
});

test('a canvas with one screen: both moves are off, with their own reasons', () => {
  const menu = menuOf({ index: 0, count: 1 });
  assert.equal(entry(menu, 'up').reason, 'This is the first screen.');
  assert.equal(entry(menu, 'down').reason, 'This is the last screen.');
});

test('Duplicate on a screen the agent has not written yet says so', () => {
  assert.equal(entry(menuOf({ hasFile: false }), 'duplicate').reason, 'Nothing to copy until the agent writes this screen.');
  // Move to trash needs no file: a screen that was never written can still go.
  assert.equal(entry(menuOf({ hasFile: false }), 'trash').disabled, undefined);
});

test('an old version turns every entry off with one sentence, ahead of any other reason', () => {
  const menu = menuOf({ viewing: true, designJson: 'missing', index: 0, hasFile: false });
  for (const id of ['duplicate', 'up', 'down', 'trash', 'directions']) {
    assert.equal(entry(menu, id).disabled, true, id);
    assert.equal(entry(menu, id).reason, "You're viewing an old version.", id);
  }
});

test('a design with no design.json, an unreadable one, or a screen list that is not a list: every entry says so', () => {
  assert.equal(entry(menuOf({ designJson: 'missing' }), 'trash').reason, "This design has no design.json yet, so its screens can't be changed here.");
  assert.equal(entry(menuOf({ designJson: 'invalid' }), 'up').reason, "design.json can't be read right now. Ask the agent to fix it.");
  assert.equal(entry(menuOf({ listInvalid: true }), 'duplicate').reason, "The screen list in design.json can't be read. Ask the agent to fix it.");
  assert.equal(screensBlock({ viewing: false, designJson: 'ok', listInvalid: false }), null);
});

test('at the cap Duplicate and Try 3 directions are off without a reason of their own and point at the one foot note', () => {
  const menu = menuOf({ count: SCREENS_MAX, index: 5 });
  assert.deepEqual(entry(menu, 'duplicate'), { id: 'duplicate', label: 'Duplicate', disabled: true, explainedBy: 'foot' });
  assert.deepEqual(entry(menu, 'directions'), { id: 'directions', label: 'Try 3 directions…', disabled: true, explainedBy: 'foot' });
  assert.equal(menu.notes.foot, 'A canvas holds up to 40 screens.');
  assert.equal(SCREENS_CAP_MESSAGE, 'A canvas holds up to 40 screens.');
});

test('one slot short of the cap: Duplicate works, Try 3 directions needs two free slots, and the foot note says why', () => {
  const menu = menuOf({ count: SCREENS_MAX - 1, index: 5 });
  assert.equal(entry(menu, 'duplicate').disabled, undefined);
  assert.equal(entry(menu, 'directions').disabled, true);
  assert.equal(menu.notes.foot, 'A canvas holds up to 40 screens.');
  const roomy = menuOf({ count: SCREENS_MAX - 2, index: 5 });
  assert.equal(entry(roomy, 'directions').disabled, undefined);
  assert.equal(roomy.notes.foot, undefined);
});

test('the foot note is only there when the cap explains a row (a blocked menu says its own sentence in each row)', () => {
  assert.equal(menuOf({ count: SCREENS_MAX, viewing: true }).notes.foot, undefined);
  assert.equal(menuOf({ count: 3 }).notes.foot, undefined);
});

test('the agent-working hint is the lead line, the same sentence as the text editor', () => {
  assert.equal(menuOf({ agentWorking: true }).notes.lead, AGENT_WORKING_LINE);
  assert.equal(menuOf({ agentWorking: false }).notes.lead, undefined);
});

// ---- the ghost board ----

test('"+ Screen" shows on a canvas in Edit mode on a live design with room, and nowhere else', () => {
  const base = { kind: 'canvas', mode: 'edit', viewing: false, count: 3 } as const;
  assert.equal(ghostVisible(base), true);
  assert.equal(ghostVisible({ ...base, count: 0 }), true, 'an empty canvas keeps it');
  assert.equal(ghostVisible({ ...base, count: SCREENS_MAX - 1 }), true);
  assert.equal(ghostVisible({ ...base, count: SCREENS_MAX }), false, 'hidden at the cap');
  assert.equal(ghostVisible({ ...base, mode: 'play' }), false);
  assert.equal(ghostVisible({ ...base, viewing: true }), false);
  assert.equal(ghostVisible({ ...base, kind: 'page' }), false);
});

// ---- orders ----

test('shiftOrder swaps with the neighbour and refuses at the edges', () => {
  const order = ['home', 'pricing', 'checkout'];
  assert.deepEqual(shiftOrder(order, 'checkout', 'up'), ['home', 'checkout', 'pricing']);
  assert.deepEqual(shiftOrder(order, 'home', 'down'), ['pricing', 'home', 'checkout']);
  assert.equal(shiftOrder(order, 'home', 'up'), null);
  assert.equal(shiftOrder(order, 'checkout', 'down'), null);
  assert.equal(shiftOrder(order, 'nope', 'up'), null);
  assert.deepEqual(order, ['home', 'pricing', 'checkout'], 'the input is not changed');
});

test('moveToGap puts the screen in the gap, counted before the move; its own place is no change', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveToGap(order, 'c', 1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveToGap(order, 'a', 3), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveToGap(order, 'a', 4), ['b', 'c', 'd', 'a'], 'the last gap puts it at the end');
  assert.deepEqual(moveToGap(order, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.equal(moveToGap(order, 'b', 1), null, 'the gap above itself');
  assert.equal(moveToGap(order, 'b', 2), null, 'the gap below itself');
  assert.equal(moveToGap(order, 'b', 9), null);
  assert.equal(moveToGap(order, 'zzz', 0), null);
});

// ---- dragging ----

// Three rows 800 px tall with 96 px gaps and 28 px label strips, as the wall lays them out.
const ROWS: DragRow[] = [
  { id: 'home', top: 0, bottom: 828 },
  { id: 'pricing', top: 924, bottom: 1752 },
  { id: 'checkout', top: 1848, bottom: 2676 },
];

test('dropTarget picks the gap by row midpoints and draws the line in the middle of it', () => {
  assert.deepEqual(dropTarget(ROWS, 100, 'checkout'), { gap: 0, y: -24, noop: false }, 'above the first row, the line sits above it');
  assert.deepEqual(dropTarget(ROWS, 700, 'checkout'), { gap: 1, y: 876, noop: false }, 'past home\'s middle: between home and pricing');
  assert.deepEqual(dropTarget(ROWS, 1500, 'home'), { gap: 2, y: 1800, noop: false });
  assert.deepEqual(dropTarget(ROWS, 9000, 'home'), { gap: 3, y: 2700, noop: false }, 'past the last row: the line sits below it');
});

test('dropTarget says no-op for the moved row\'s own place and for an unknown row', () => {
  assert.equal(dropTarget(ROWS, 1300, 'pricing')?.noop, true, 'inside its own row');
  assert.equal(dropTarget(ROWS, 1100, 'pricing')?.noop, true, 'the gap above');
  assert.equal(dropTarget(ROWS, 1800, 'pricing')?.noop, true, 'the gap below');
  assert.equal(dropTarget(ROWS, 100, 'ghost-row')?.noop, true);
  assert.equal(dropTarget([], 100, 'home'), null);
});

test('a drop that is not a no-op always yields a new order through moveToGap', () => {
  const ids = ROWS.map((row) => row.id);
  const target = dropTarget(ROWS, 700, 'checkout');
  assert.ok(target && !target.noop);
  assert.deepEqual(moveToGap(ids, 'checkout', target.gap), ['home', 'checkout', 'pricing']);
});

// ---- keeping a moved screen in view ----

test('revealPan does nothing for a box that is already inside, and moves the least otherwise', () => {
  const stage = { w: 800, h: 600 };
  assert.deepEqual(revealPan({ x: 100, y: 100, w: 300, h: 200 }, stage, 16), { dx: 0, dy: 0 });
  assert.deepEqual(revealPan({ x: 100, y: 700, w: 300, h: 200 }, stage, 16), { dx: 0, dy: -316 }, 'below the stage: up until its bottom is a margin from the edge');
  assert.deepEqual(revealPan({ x: -200, y: 100, w: 300, h: 200 }, stage, 16), { dx: 216, dy: 0 }, 'off to the left: right until its left edge is a margin in');
  assert.deepEqual(revealPan({ x: 700, y: -50, w: 300, h: 200 }, stage, 16), { dx: -216, dy: 66 });
});

test('revealPan aligns a box taller than the stage to its top, so the screen\'s label shows', () => {
  assert.deepEqual(revealPan({ x: 100, y: 900, w: 300, h: 2000 }, { w: 800, h: 600 }, 16), { dx: 0, dy: -884 });
});

// ---- the "+ Screen" box ----

test('the room for the user\'s words is the ask limit minus the fixed text; a note of exactly that room fits', () => {
  const input = { title: 'Tidepool site', after: 'Checkout', free: 5 };
  const room = newScreenRoom(input);
  assert.ok(room > ASK_TEXT_MAX - 400 && room < ASK_TEXT_MAX, `room ${room}`);
  const note = `${'a'.repeat(room - 1)}z`;
  assert.ok(newScreenAsk({ ...input, note }).length <= ASK_TEXT_MAX, 'the full text fits the ask limit');
  assert.ok(newScreenAsk({ ...input, note: `${note}z` }).length > ASK_TEXT_MAX, 'one more character does not');
});

test('the room for what the directions should explore follows the same rule', () => {
  const input = { title: 'Pricing', id: 'pricing', free: 4 };
  const room = directionsRoom(input);
  assert.ok(room > ASK_TEXT_MAX - 600 && room < ASK_TEXT_MAX, `room ${room}`);
  assert.ok(directionsAsk({ ...input, note: 'a'.repeat(room) }).length <= ASK_TEXT_MAX);
  assert.ok(directionsAsk({ ...input, note: 'a'.repeat(room + 1) }).length > ASK_TEXT_MAX);
});

test('the counter stays quiet until 200 characters are left, then counts down, then says how far over', () => {
  const room = 1000;
  assert.equal(askNoteBox({ typed: 'a'.repeat(500), room, sending: false }).counter, null);
  assert.equal(askNoteBox({ typed: 'a'.repeat(800), room, sending: false }).counter, '200 left');
  assert.equal(askNoteBox({ typed: 'a'.repeat(1000), room, sending: false }).counter, '0 left');
  const over = askNoteBox({ typed: 'a'.repeat(1012), room, sending: false });
  assert.equal(over.counter, '12 over');
  assert.equal(over.over, true);
  assert.equal(over.canSend, false);
});

test('Ask the agent is on while the words fit and no request is running; surrounding whitespace is not counted', () => {
  assert.equal(askNoteBox({ typed: '', room: 100, sending: false }).canSend, true, 'an empty box asks for a screen with no brief');
  assert.equal(askNoteBox({ typed: 'hello', room: 100, sending: true }).canSend, false);
  assert.equal(askNoteBox({ typed: `  ${'a'.repeat(100)}  `, room: 100, sending: false }).canSend, true);
});

// ---- directions (Phase 2 feature 11) ----

test('Try 3 directions says why inside the option when the screen already has directions, or is one', () => {
  const has = entry(menuOf({ directionsOff: 'This screen already has directions. Keep one first.' }), 'directions');
  assert.equal(has.disabled, true);
  assert.equal(has.reason, 'This screen already has directions. Keep one first.');
  assert.equal(entry(menuOf({ directionsOff: null }), 'directions').disabled, undefined, 'on offer when nothing is said against it');
});

test('a direction is not a row: Move up and Move down read the screen\'s place among the rows, the cap still counts every screen', () => {
  // Five screens, the last two are directions of the third: the third is the last row.
  const last = menuOf({ index: 2, count: 5, rowIndex: 2, rowCount: 3 });
  assert.equal(entry(last, 'down').disabled, true);
  assert.equal(entry(last, 'down').reason, 'This is the last screen.');
  assert.equal(entry(menuOf({ index: 2, count: 5 }), 'down').disabled, undefined, 'without the row numbers the list is the rows');
  const capped = menuOf({ index: 0, count: 40, rowIndex: 0, rowCount: 30 });
  assert.equal(entry(capped, 'duplicate').explainedBy, 'foot');
});

test('Move up reads the row place, not the list place: directions listed before their original leave it the first row (Q3)', () => {
  // design.json lists home-a and home-b (directions of home) before home: home is list index 2 but the first row on the wall.
  const first = menuOf({ index: 2, count: 4, rowIndex: 0, rowCount: 2 });
  assert.equal(entry(first, 'up').disabled, true);
  assert.equal(entry(first, 'up').reason, 'This is the first screen.');
  // pricing after them is list index 3 but row 1 of 2: Move up on, Move down off.
  const second = menuOf({ index: 3, count: 4, rowIndex: 1, rowCount: 2 });
  assert.equal(entry(second, 'up').disabled, undefined);
  assert.equal(entry(second, 'down').reason, 'This is the last screen.');
});

test('an old version still wins over the directions reason', () => {
  const viewing = entry(menuOf({ viewing: true, directionsOff: 'This screen already has directions. Keep one first.' }), 'directions');
  assert.equal(viewing.reason, "You're viewing an old version.");
});
