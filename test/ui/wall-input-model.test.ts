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

const modes: BridgeMode[] = ['edit', 'play'];

test('wheelRoute on the wall: Ctrl/Cmd zooms; Edit scrolls the design under the pointer; everything else pans', () => {
  const base = { pageMode: false, ctrlOrMeta: false, mode: 'edit' as BridgeMode, readOnly: false, overReadyBoard: true, spaceDown: false, panTool: false };
  assert.equal(wheelRoute(base), 'scroll-frame');
  assert.equal(wheelRoute({ ...base, ctrlOrMeta: true }), 'zoom');
  assert.equal(wheelRoute({ ...base, ctrlOrMeta: true, mode: 'play' }), 'zoom');
  assert.equal(wheelRoute({ ...base, ctrlOrMeta: true, readOnly: true, overReadyBoard: false }), 'zoom');
  assert.equal(wheelRoute({ ...base, mode: 'play' }), 'pan', 'Play mode pans');
  assert.equal(wheelRoute({ ...base, readOnly: true }), 'pan', 'a saved version pans');
  assert.equal(wheelRoute({ ...base, overReadyBoard: false }), 'pan', 'empty wall or a frame still loading pans');
  assert.equal(wheelRoute({ ...base, spaceDown: true }), 'pan');
  assert.equal(wheelRoute({ ...base, panTool: true }), 'pan');
});

test('wheelRoute on a page: scrolls the design over the loaded frame, never zooms or pans', () => {
  const base = { pageMode: true, ctrlOrMeta: false, mode: 'edit' as BridgeMode, readOnly: false, overReadyBoard: true, spaceDown: false, panTool: false };
  assert.equal(wheelRoute(base), 'scroll-frame');
  assert.equal(wheelRoute({ ...base, ctrlOrMeta: true }), 'none');
  assert.equal(wheelRoute({ ...base, overReadyBoard: false }), 'none');
  for (const mode of modes) for (const readOnly of [false, true]) assert.equal(wheelRoute({ ...base, mode, readOnly }), 'scroll-frame', `${mode} readOnly=${readOnly}: the page wheel ignores the mode`);
  assert.equal(wheelRoute({ ...base, spaceDown: true, panTool: true }), 'scroll-frame');
});

test('frameWheelRoute: what a design frame forwards', () => {
  const wall = { pageMode: false, ctrl: false, mode: 'edit' as BridgeMode, readOnly: false };
  assert.equal(frameWheelRoute(wall), 'scroll-frame');
  assert.equal(frameWheelRoute({ ...wall, ctrl: true }), 'zoom');
  assert.equal(frameWheelRoute({ ...wall, mode: 'play' }), 'pan');
  assert.equal(frameWheelRoute({ ...wall, readOnly: true }), 'pan');
  assert.equal(frameWheelRoute({ ...wall, ctrl: true, readOnly: true }), 'zoom');
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
