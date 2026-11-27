import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BridgeMode } from '../../src/shared/bridge-protocol.ts';
import {
  DRAG_THRESHOLD_PX,
  frameModeOf,
  frameWheelRoute,
  hitMatches,
  isDrag,
  pageKeyAction,
  pointerDownAction,
  shortcutAction,
  wallKeyAction,
  wheelRoute,
} from '../../src/ui/model/wall-input.ts';

const key = (k: string, extra: { code?: string; shift?: boolean; pageMode?: boolean } = {}) => wallKeyAction({ key: k, code: extra.code ?? '', shift: extra.shift ?? false, pageMode: extra.pageMode ?? false });

test('wallKeyAction: arrows pan by 60 px, 240 with Shift, in the camera direction the wall always used', () => {
  assert.deepEqual(key('ArrowLeft'), { type: 'pan', dx: 60, dy: 0 });
  assert.deepEqual(key('ArrowRight'), { type: 'pan', dx: -60, dy: 0 });
  assert.deepEqual(key('ArrowUp'), { type: 'pan', dx: 0, dy: 60 });
  assert.deepEqual(key('ArrowDown'), { type: 'pan', dx: 0, dy: -60 });
  assert.deepEqual(key('ArrowLeft', { shift: true }), { type: 'pan', dx: 240, dy: 0 });
  assert.deepEqual(key('ArrowDown', { shift: true }), { type: 'pan', dx: 0, dy: -240 });
});

test('wallKeyAction: zoom keys, the pan tool, Space and Escape', () => {
  assert.deepEqual(key('+'), { type: 'zoom', factor: 1.25 });
  assert.deepEqual(key('='), { type: 'zoom', factor: 1.25 });
  assert.deepEqual(key('-'), { type: 'zoom', factor: 1 / 1.25 });
  assert.deepEqual(key('h'), { type: 'toggle-pan-tool' });
  assert.deepEqual(key('H', { shift: true }), { type: 'toggle-pan-tool' }, 'h is case-insensitive');
  assert.deepEqual(key(' '), { type: 'space-down' });
  assert.deepEqual(key('Escape'), { type: 'escape' });
});

test('wallKeyAction: Shift+0 and Shift+1 match by code, so any keyboard layout works', () => {
  assert.deepEqual(key(')', { code: 'Digit0', shift: true }), { type: 'zoom-reset' });
  assert.deepEqual(key('!', { code: 'Digit1', shift: true }), { type: 'fit' });
  assert.equal(key('0', { code: 'Digit0' }), null, 'without Shift, 0 does nothing');
  assert.equal(key('1', { code: 'Digit1' }), null);
  assert.equal(key('0', { code: 'Numpad0', shift: true }), null, 'the key value alone does not reset on the wall itself');
});

test('wallKeyAction: keys the wall does not use, and the page presentation', () => {
  for (const unused of ['a', 'Tab', 'Enter', '_', 'PageDown']) assert.equal(key(unused), null, unused);
  assert.deepEqual(key('Escape', { pageMode: true }), { type: 'escape' });
  for (const k of ['+', '-', 'h', ' ', 'ArrowLeft']) assert.equal(key(k, { pageMode: true }), null, `${k} on a page`);
});

test('shortcutAction is what a key forwarded from a design frame does: key and shift only', () => {
  const s = (k: string, shift = false, pageMode = false) => shortcutAction({ key: k, shift, pageMode });
  assert.deepEqual(s('+'), { type: 'zoom', factor: 1.25 });
  assert.deepEqual(s('='), { type: 'zoom', factor: 1.25 });
  assert.deepEqual(s('-'), { type: 'zoom', factor: 1 / 1.25 });
  assert.deepEqual(s('_'), { type: 'zoom', factor: 1 / 1.25 });
  assert.deepEqual(s('0', true), { type: 'zoom-reset' });
  assert.deepEqual(s('1', true), { type: 'fit' });
  assert.equal(s('0'), null);
  assert.equal(s('1'), null);
  assert.deepEqual(s(' '), { type: 'space-down' });
  assert.deepEqual(s('Escape'), { type: 'escape' });
  assert.equal(s('ArrowLeft'), null, 'a frame cannot pan the wall with arrows');
  assert.equal(s('h'), null, 'a frame cannot toggle the pan tool');
  assert.deepEqual(s('Escape', false, true), { type: 'escape' });
  for (const k of ['+', '-', '0', '1', ' ']) assert.equal(s(k, true, true), null, `${k} on a page`);
});

test('pageKeyAction: arrows, Page Up/Down, Home, End and Escape', () => {
  const p = (k: string, shift = false, frameHeight = 800) => pageKeyAction({ key: k, shift, frameHeight });
  assert.deepEqual(p('ArrowUp'), { type: 'scroll-by', dx: 0, dy: -60 });
  assert.deepEqual(p('ArrowDown'), { type: 'scroll-by', dx: 0, dy: 60 });
  assert.deepEqual(p('ArrowLeft'), { type: 'scroll-by', dx: -60, dy: 0 });
  assert.deepEqual(p('ArrowRight', true), { type: 'scroll-by', dx: 240, dy: 0 });
  assert.deepEqual(p('PageDown'), { type: 'scroll-by', dx: 0, dy: 720 }, 'a screenful is 90 % of the frame');
  assert.deepEqual(p('PageUp'), { type: 'scroll-by', dx: 0, dy: -720 });
  assert.deepEqual(p('PageDown', false, 10), { type: 'scroll-by', dx: 0, dy: 40 }, 'never under 40 px');
  assert.deepEqual(p('PageDown', false, 555), { type: 'scroll-by', dx: 0, dy: 500 }, 'rounded');
  assert.deepEqual(p('Home'), { type: 'scroll-to', x: 0, y: 0 });
  assert.deepEqual(p('End'), { type: 'scroll-by', dx: 0, dy: 1e7 });
  assert.deepEqual(p('Escape'), { type: 'escape' });
  assert.equal(p('h'), null);
  assert.equal(p(' '), null);
  assert.equal(p('constructor'), null);
});

test('wheelRoute on the wall: Ctrl/Cmd zooms; a plain wheel pans everywhere, over an artboard too', () => {
  const base = { pageMode: false, ctrlOrMeta: false, overReadyBoard: true };
  assert.equal(wheelRoute(base), 'pan', 'Edit mode over a ready artboard pans the wall; the design does not scroll');
  assert.equal(wheelRoute({ ...base, overReadyBoard: false }), 'pan', 'empty wall or a frame still loading pans the same');
  assert.equal(wheelRoute({ ...base, ctrlOrMeta: true }), 'zoom');
  assert.equal(wheelRoute({ ...base, ctrlOrMeta: true, overReadyBoard: false }), 'zoom');
});

test('wheelRoute on a page: scrolls the design over the loaded frame, never zooms or pans', () => {
  const base = { pageMode: true, ctrlOrMeta: false, overReadyBoard: true };
  assert.equal(wheelRoute(base), 'scroll-frame');
  assert.equal(wheelRoute({ ...base, ctrlOrMeta: true }), 'none');
  assert.equal(wheelRoute({ ...base, overReadyBoard: false }), 'none');
});

test('frameWheelRoute: a forwarded wheel pans the wall in every mode, Ctrl zooms; a page only scrolls the design', () => {
  const wall = { pageMode: false, ctrl: false, mode: 'edit' as BridgeMode, readOnly: false };
  assert.equal(frameWheelRoute(wall), 'pan', 'Edit mode: a forwarded wheel pans, the design does not scroll');
  assert.equal(frameWheelRoute({ ...wall, mode: 'play' }), 'pan');
  assert.equal(frameWheelRoute({ ...wall, readOnly: true }), 'pan');
  assert.equal(frameWheelRoute({ ...wall, ctrl: true }), 'zoom');
  assert.equal(frameWheelRoute({ ...wall, ctrl: true, mode: 'play', readOnly: true }), 'zoom');
  const page = { ...wall, pageMode: true };
  assert.equal(frameWheelRoute(page), 'scroll-frame');
  assert.equal(frameWheelRoute({ ...page, ctrl: true }), 'none');
  assert.equal(frameWheelRoute({ ...page, mode: 'play' }), 'none');
  assert.equal(frameWheelRoute({ ...page, readOnly: true }), 'none');
});

test('pointerDownAction on the wall: a press on an artboard in Edit mode may comment; otherwise it pans', () => {
  const base = { pageMode: false, button: 0, spaceDown: false, panTool: false, onBoard: true, mode: 'edit' as BridgeMode, readOnly: false };
  assert.equal(pointerDownAction(base), 'press');
  assert.equal(pointerDownAction({ ...base, button: 1 }), 'pan', 'middle button pans');
  assert.equal(pointerDownAction({ ...base, spaceDown: true }), 'pan');
  assert.equal(pointerDownAction({ ...base, panTool: true }), 'pan');
  assert.equal(pointerDownAction({ ...base, onBoard: false }), 'pan', 'empty wall pans');
  assert.equal(pointerDownAction({ ...base, mode: 'play' }), 'pan');
  assert.equal(pointerDownAction({ ...base, readOnly: true }), 'pan');
});

test('pointerDownAction ignores buttons the wall does not use, whatever else is true', () => {
  const pans = { pageMode: false, spaceDown: true, panTool: true, onBoard: false, mode: 'play' as BridgeMode, readOnly: true };
  for (const button of [2, 3, 4]) {
    assert.equal(pointerDownAction({ ...pans, button }), 'ignore', `button ${button} with every pan reason on`);
    assert.equal(pointerDownAction({ ...pans, button, pageMode: true }), 'ignore');
  }
  assert.equal(pointerDownAction({ ...pans, button: 0 }), 'pan');
  assert.equal(pointerDownAction({ ...pans, button: 1 }), 'pan');
});

test('pointerDownAction on a page: only the primary button, only a press on the frame in Edit mode comments', () => {
  const base = { pageMode: true, button: 0, spaceDown: false, panTool: false, onBoard: true, mode: 'edit' as BridgeMode, readOnly: false };
  assert.equal(pointerDownAction(base), 'press');
  assert.equal(pointerDownAction({ ...base, button: 1 }), 'ignore', 'a page never pans, middle button included');
  assert.equal(pointerDownAction({ ...base, spaceDown: true, panTool: true }), 'press', 'Space and the pan tool do nothing on a page');
  assert.equal(pointerDownAction({ ...base, onBoard: false }), 'dismiss');
  assert.equal(pointerDownAction({ ...base, mode: 'play' }), 'dismiss');
  assert.equal(pointerDownAction({ ...base, readOnly: true }), 'dismiss');
});

test('isDrag: more than 4 px in any direction', () => {
  assert.equal(DRAG_THRESHOLD_PX, 4);
  const from = { x: 100, y: 100 };
  assert.equal(isDrag(from, { x: 100, y: 100 }), false);
  assert.equal(isDrag(from, { x: 104, y: 100 }), false, 'exactly 4 px is still a click');
  assert.equal(isDrag(from, { x: 104.1, y: 100 }), true);
  assert.equal(isDrag(from, { x: 96, y: 100 }), false);
  assert.equal(isDrag(from, { x: 95, y: 100 }), true);
  assert.equal(isDrag(from, { x: 103, y: 103 }), true, 'diagonal 3,3 is 4.24 px');
  assert.equal(isDrag(from, { x: 102, y: 103 }), false);
});

test('hitMatches: the answer must come from the same board at the same point', () => {
  const a = { id: 'a' };
  const b = { id: 'a' };
  const pending = { board: a, frame: { x: 10, y: 20 } };
  assert.equal(hitMatches(pending, a, 10, 20), true);
  assert.equal(hitMatches(pending, a, 11, 20), false);
  assert.equal(hitMatches(pending, a, 10, 21), false);
  assert.equal(hitMatches(pending, b, 10, 20), false, 'a different board object with the same id is not the same board');
  assert.equal(hitMatches(null, a, 10, 20), false);
});

test('frameModeOf: a saved version is always Play', () => {
  assert.equal(frameModeOf('edit', false), 'edit');
  assert.equal(frameModeOf('play', false), 'play');
  assert.equal(frameModeOf('edit', true), 'play');
  assert.equal(frameModeOf('play', true), 'play');
});

// ---- Phase 2: Ctrl/⌘+Z and the one undo slot (technical design §2.7) ----

import { UNDO_VIEWING_TEXT, isUndoEditKey, nextUndoSlot } from '../../src/ui/model/wall-input.ts';

const undoKey = (over: { key?: string; shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean; inField?: boolean } = {}) =>
  isUndoEditKey({ key: 'z', shift: false, ctrl: true, meta: false, alt: false, inField: false, ...over });

test('undo-edit: Ctrl or ⌘ with Z, no Shift or Alt, outside a field', () => {
  assert.equal(undoKey(), true);
  assert.equal(undoKey({ ctrl: false, meta: true }), true);
  assert.equal(undoKey({ key: 'Z' }), true);
  assert.equal(undoKey({ ctrl: false }), false, 'a plain z is not the shortcut');
  assert.equal(undoKey({ shift: true }), false, 'Ctrl+Shift+Z is redo, which the wall does not have');
  assert.equal(undoKey({ alt: true }), false);
  assert.equal(undoKey({ inField: true }), false, 'a field keeps its own undo');
  assert.equal(undoKey({ key: 'y' }), false);
});

test('wallKeyAction answers undo-edit on the wall and on a page, and nothing else changes with the new inputs', () => {
  const base = { code: 'KeyZ', shift: false, ctrl: true };
  assert.deepEqual(wallKeyAction({ ...base, key: 'z', pageMode: false }), { type: 'undo-edit' });
  assert.deepEqual(wallKeyAction({ ...base, key: 'z', pageMode: true }), { type: 'undo-edit' });
  assert.equal(wallKeyAction({ ...base, key: 'z', pageMode: false, inField: true }), null);
  assert.deepEqual(wallKeyAction({ key: '+', code: '', shift: false, pageMode: false }), { type: 'zoom', factor: 1.25 });
});

test('nextUndoSlot: an edit fills the slot, Ctrl+Z sends that undo and empties it, a second Ctrl+Z does nothing', () => {
  let slot: string | null = null;
  slot = nextUndoSlot(slot, { type: 'edited', id: 'e_one' }).slot;
  assert.equal(slot, 'e_one');
  const first = nextUndoSlot(slot, { type: 'undo-key' });
  assert.deepEqual(first, { slot: null, undo: 'e_one', refusal: null });
  assert.deepEqual(nextUndoSlot(first.slot, { type: 'undo-key' }), { slot: null, undo: null, refusal: null });
});

test('nextUndoSlot: two edits then Ctrl+Z twice undoes only the second, never reaching further back', () => {
  let slot: string | null = null;
  slot = nextUndoSlot(slot, { type: 'edited', id: 'e_one' }).slot;
  slot = nextUndoSlot(slot, { type: 'edited', id: 'e_two' }).slot;
  const first = nextUndoSlot(slot, { type: 'undo-key' });
  const second = nextUndoSlot(first.slot, { type: 'undo-key' });
  assert.equal(first.undo, 'e_two');
  assert.equal(second.undo, null);
});

test('nextUndoSlot: Undo pressed on the edit’s own notice empties the slot, so Ctrl+Z then does nothing', () => {
  const slot = nextUndoSlot(null, { type: 'edited', id: 'e_one' }).slot;
  const afterNotice = nextUndoSlot(slot, { type: 'notice-undo', id: 'e_one' });
  assert.deepEqual(afterNotice, { slot: null, undo: null, refusal: null });
  assert.equal(nextUndoSlot(afterNotice.slot, { type: 'undo-key' }).undo, null);
});

test('nextUndoSlot: Undo on an older notice leaves the newer edit in the slot', () => {
  const slot = nextUndoSlot(null, { type: 'edited', id: 'e_two' }).slot;
  assert.equal(nextUndoSlot(slot, { type: 'notice-undo', id: 'e_one' }).slot, 'e_two');
});

test('nextUndoSlot: the key empties the slot whatever the service answers (a refused undo is not tried again)', () => {
  // The reducer has already returned the id and an empty slot before the request goes out; the answer never reaches it.
  const slot = nextUndoSlot(null, { type: 'edited', id: 'e_one' }).slot;
  const sent = nextUndoSlot(slot, { type: 'undo-key' });
  assert.equal(sent.slot, null);
});

// E12: nothing that writes works while an old version is on show, Undo included.

test('nextUndoSlot E12: Ctrl+Z while viewing sends nothing, keeps the slot and says why', () => {
  const slot = nextUndoSlot(null, { type: 'edited', id: 'e_one' }).slot;
  const refused = nextUndoSlot(slot, { type: 'undo-key' }, true);
  assert.deepEqual(refused, { slot: 'e_one', undo: null, refusal: "You're viewing an old version." });
  assert.equal(refused.refusal, UNDO_VIEWING_TEXT);
  // Back on the current design the same edit can still be undone, once.
  assert.deepEqual(nextUndoSlot(refused.slot, { type: 'undo-key' }, false), { slot: null, undo: 'e_one', refusal: null });
});

test('nextUndoSlot E12: Undo on the notice while viewing is refused and leaves the slot alone', () => {
  const slot = nextUndoSlot(null, { type: 'edited', id: 'e_one' }).slot;
  assert.deepEqual(nextUndoSlot(slot, { type: 'notice-undo', id: 'e_one' }, true), { slot: 'e_one', undo: null, refusal: UNDO_VIEWING_TEXT });
});

test('nextUndoSlot E12: refused with an empty slot still says why, and recording an edit is never refused', () => {
  assert.equal(nextUndoSlot(null, { type: 'undo-key' }, true).refusal, UNDO_VIEWING_TEXT);
  assert.deepEqual(nextUndoSlot('e_old', { type: 'edited', id: 'e_new' }, true), { slot: 'e_new', undo: null, refusal: null });
});

// ---- Touch (documentation/specs/native-extras.md §2.2): pinch, finger taps, dragging a page ----

import { CAMERA_SCALE_MAX, CAMERA_SCALE_MIN } from '../../src/shared/limits.ts';
import { screenToWorld, worldToScreen } from '../../src/guest/camera.ts';
import { TOUCH_DRAG_THRESHOLD_PX, dragThreshold, pinchCamera, pinchStep, touchScrollDelta } from '../../src/ui/model/wall-input.ts';

const pair = (ax: number, ay: number, bx: number, by: number) => [{ x: ax, y: ay }, { x: bx, y: by }] as const;
const close = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} ${actual} ≠ ${expected}`);

test('dragThreshold: a finger gets more room than a mouse; mouse and pen are as before', () => {
  assert.equal(dragThreshold('mouse'), DRAG_THRESHOLD_PX);
  assert.equal(dragThreshold('pen'), DRAG_THRESHOLD_PX);
  assert.equal(dragThreshold(''), DRAG_THRESHOLD_PX);
  assert.equal(dragThreshold('touch'), TOUCH_DRAG_THRESHOLD_PX);
  assert.equal(TOUCH_DRAG_THRESHOLD_PX, 10);
  const from = { x: 0, y: 0 };
  assert.equal(isDrag(from, { x: 8, y: 0 }, dragThreshold('touch')), false, 'a finger that wobbles 8 px is still a tap');
  assert.equal(isDrag(from, { x: 8, y: 0 }, dragThreshold('mouse')), true);
  assert.equal(isDrag(from, { x: 10.1, y: 0 }, dragThreshold('touch')), true);
});

test('pinchStep: the factor is the change in finger distance, around the new midpoint, with the midpoint’s travel', () => {
  assert.deepEqual(pinchStep(pair(100, 100, 200, 100), pair(50, 100, 250, 100)), { factor: 2, at: { x: 150, y: 100 }, dx: 0, dy: 0 });
  assert.deepEqual(pinchStep(pair(0, 0, 100, 0), pair(25, 0, 75, 0)), { factor: 0.5, at: { x: 50, y: 0 }, dx: 0, dy: 0 });
  assert.deepEqual(pinchStep(pair(0, 0, 100, 0), pair(30, 20, 130, 20)), { factor: 1, at: { x: 80, y: 20 }, dx: 30, dy: 20 }, 'two fingers moving together only pan');
});

test('pinchStep: fingers on top of each other never produce a zero, infinite or NaN factor', () => {
  for (const [prev, next] of [
    [pair(5, 5, 5, 5), pair(0, 0, 100, 0)],
    [pair(0, 0, 100, 0), pair(5, 5, 5, 5)],
    [pair(5, 5, 5, 5), pair(5, 5, 5, 5)],
  ] as const) assert.equal(pinchStep(prev, next).factor, 1);
});

test('pinchCamera: what was under the fingers stays under them', () => {
  const camera = { x: 40, y: -20, scale: 0.5 };
  const prev = pair(100, 200, 200, 200);
  const next = pair(90, 230, 290, 230);
  const after = pinchCamera(camera, prev, next);
  close(after.scale, 1, 'scale doubles');
  const held = screenToWorld(camera, { x: 150, y: 200 });
  const shown = worldToScreen(after, held);
  close(shown.x, 190, 'midpoint x');
  close(shown.y, 230, 'midpoint y');
});

test('pinchCamera: zoom stops at 5 % and 400 %, still anchored under the fingers', () => {
  assert.equal(CAMERA_SCALE_MIN, 0.05);
  assert.equal(CAMERA_SCALE_MAX, 4);
  const out = pinchCamera({ x: 0, y: 0, scale: 0.1 }, pair(0, 100, 400, 100), pair(190, 100, 210, 100));
  assert.equal(out.scale, CAMERA_SCALE_MIN);
  const camera = { x: 10, y: 10, scale: 3 };
  const inwards = pinchCamera(camera, pair(190, 100, 210, 100), pair(0, 100, 400, 100));
  assert.equal(inwards.scale, CAMERA_SCALE_MAX);
  const shown = worldToScreen(inwards, screenToWorld(camera, { x: 200, y: 100 }));
  close(shown.x, 200);
  close(shown.y, 100);
  // At the limit a further spread changes nothing but the pan.
  assert.deepEqual(pinchCamera(inwards, pair(150, 100, 250, 100), pair(100, 100, 300, 100)), inwards);
});

test('touchScrollDelta: the design follows the finger, in the frame’s own pixels', () => {
  assert.deepEqual(touchScrollDelta({ x: 10, y: 100 }, { x: 10, y: 60 }, 1), { dx: 0, dy: 40 }, 'finger up scrolls down');
  assert.deepEqual(touchScrollDelta({ x: 50, y: 0 }, { x: 20, y: 30 }, 0.5), { dx: 60, dy: -60 }, 'a shrunk frame scrolls further per screen px');
  for (const scale of [0, -1, Number.NaN]) assert.deepEqual(touchScrollDelta({ x: 0, y: 10 }, { x: 0, y: 0 }, scale), { dx: 0, dy: 10 }, `scale ${scale} reads as 1`);
});
