// The wall's input decisions as pure functions: which key does what, where a wheel turn goes,
// what a pointer press starts. The DOM side (`src/ui/wall/input-controller.ts`) reads the event,
// asks one of these, and acts on the answer. The rules are exactly the ones the wall always
// had; changing a shortcut or a gesture means changing it here, where a table test can see it.

import type { BridgeMode } from '../../shared/bridge-protocol.ts';
import { nudgeStep, type Point } from './wall-model.ts';

/** What a key does on the wall. `pan` carries the camera shift in screen px. */
export type WallKeyAction =
  | { type: 'zoom'; factor: number }
  | { type: 'zoom-reset' }
  | { type: 'fit' }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'toggle-pan-tool' }
  | { type: 'space-down' }
  | { type: 'escape' };

const ZOOM_KEY_FACTOR = 1.25;

/**
 * The shortcuts the wall shares with the frames: a key pressed inside a design frame reaches the
 * wall as `key` + `shift` only (no `code`), and the wall's own keydown hands its zoom/space/
 * Escape keys here too. Escape works on a page; zoom, fit and hold-to-pan belong to the wall.
 */
export const shortcutAction = (input: { key: string; shift: boolean; pageMode: boolean }): WallKeyAction | null => {
  const { key, shift } = input;
  if (key === 'Escape') return { type: 'escape' };
  if (input.pageMode) return null;
  if (key === '+' || key === '=') return { type: 'zoom', factor: ZOOM_KEY_FACTOR };
  if (key === '-' || key === '_') return { type: 'zoom', factor: 1 / ZOOM_KEY_FACTOR };
  if (key === '0' && shift) return { type: 'zoom-reset' };
  if (key === '1' && shift) return { type: 'fit' };
  if (key === ' ') return { type: 'space-down' };
  return null;
};

/**
 * A key pressed on the wall surface (not on a page, which uses `pageKeyAction`). Shift+0 and
 * Shift+1 match by `code` so they work on every keyboard layout; arrows pan by `nudgeStep`;
 * `h` (any case) toggles the pan tool; the rest is the shared shortcut table.
 */
export const wallKeyAction = (input: { key: string; code: string; shift: boolean; pageMode: boolean }): WallKeyAction | null => {
  const { key, code, shift } = input;
  if (input.pageMode) return shortcutAction(input);
  const step = nudgeStep(shift);
  if (code === 'Digit0' && shift) return { type: 'zoom-reset' };
  if (code === 'Digit1' && shift) return { type: 'fit' };
  if (key === 'ArrowLeft') return { type: 'pan', dx: step, dy: 0 };
  if (key === 'ArrowRight') return { type: 'pan', dx: -step, dy: 0 };
  if (key === 'ArrowUp') return { type: 'pan', dx: 0, dy: step };
  if (key === 'ArrowDown') return { type: 'pan', dx: 0, dy: -step };
  if (key.toLowerCase() === 'h') return { type: 'toggle-pan-tool' };
  if (key === ' ' || key === '+' || key === '=' || key === '-' || key === 'Escape') return shortcutAction(input);
  return null;
};

/** What a key does on a page: scroll the design like a browser tab, or close the open card. */
export type PageKeyAction = { type: 'scroll-by'; dx: number; dy: number } | { type: 'scroll-to'; x: number; y: number } | { type: 'escape' };

/**
 * Arrows, Page Up/Down, Home and End. A screenful is 90 % of the frame (at least 40 px); End asks
 * for a huge scroll and the frame clamps it to the end of the document.
 */
export const pageKeyAction = (input: { key: string; shift: boolean; frameHeight: number }): PageKeyAction | null => {
  const step = nudgeStep(input.shift);
  const screenful = Math.max(40, Math.round(input.frameHeight * 0.9));
  switch (input.key) {
    case 'Escape':
      return { type: 'escape' };
    case 'ArrowUp':
      return { type: 'scroll-by', dx: 0, dy: -step };
    case 'ArrowDown':
      return { type: 'scroll-by', dx: 0, dy: step };
    case 'ArrowLeft':
      return { type: 'scroll-by', dx: -step, dy: 0 };
    case 'ArrowRight':
      return { type: 'scroll-by', dx: step, dy: 0 };
    case 'PageUp':
      return { type: 'scroll-by', dx: 0, dy: -screenful };
    case 'PageDown':
      return { type: 'scroll-by', dx: 0, dy: screenful };
    case 'Home':
      return { type: 'scroll-to', x: 0, y: 0 };
    case 'End':
      return { type: 'scroll-by', dx: 0, dy: 1e7 };
    default:
      return null;
  }
};

/** Where a wheel turn goes: zoom the wall, scroll the design in the frame, pan the wall, or nothing. */
export type WheelRoute = 'zoom' | 'scroll-frame' | 'pan' | 'none';

/**
 * A wheel turn over the wall surface. A page never zooms or pans: the wheel scrolls the design
 * when it is over the loaded frame and does nothing otherwise. On the wall Ctrl/Cmd zooms; a
 * plain wheel scrolls the design under the pointer in Edit mode (when it is loaded, and neither
 * Space nor the pan tool is active) and pans the wall everywhere else.
 */
export const wheelRoute = (input: {
  pageMode: boolean;
  ctrlOrMeta: boolean;
  mode: BridgeMode;
  readOnly: boolean;
  overReadyBoard: boolean;
  spaceDown: boolean;
  panTool: boolean;
}): WheelRoute => {
  if (input.pageMode) return !input.ctrlOrMeta && input.overReadyBoard ? 'scroll-frame' : 'none';
  if (input.ctrlOrMeta) return 'zoom';
  if (input.mode === 'edit' && !input.readOnly && input.overReadyBoard && !input.spaceDown && !input.panTool) return 'scroll-frame';
  return 'pan';
};

/**
 * A wheel turn a design frame forwarded (it only forwards what it did not use itself). On the
 * wall Ctrl zooms, and a plain wheel scrolls the design in Edit mode or pans the wall in Play
 * mode and on a saved version. A page only scrolls the design, and only in Edit mode.
 */
export const frameWheelRoute = (input: { pageMode: boolean; ctrl: boolean; mode: BridgeMode; readOnly: boolean }): WheelRoute => {
  const scrolls = input.mode === 'edit' && !input.readOnly;
  if (input.pageMode) return !input.ctrl && scrolls ? 'scroll-frame' : 'none';
  if (input.ctrl) return 'zoom';
  return scrolls ? 'scroll-frame' : 'pan';
};

/**
 * What a pointer press on the surface starts.
 * - `pan`: grab the wall (middle button, Space, the pan tool, empty wall, Play mode, a saved version).
 * - `press`: a possible comment (a click) that turns into a pan if it drags.
 * - `dismiss`: a page's primary press that cannot comment: close the open card, start nothing.
 * - `ignore`: not a button the wall uses (right button, back/forward).
 */
export type PointerDownAction = 'pan' | 'press' | 'dismiss' | 'ignore';

export const pointerDownAction = (input: {
  pageMode: boolean;
  button: number;
  spaceDown: boolean;
  panTool: boolean;
  onBoard: boolean;
  mode: BridgeMode;
  readOnly: boolean;
}): PointerDownAction => {
  if (input.pageMode) {
    // A page never pans: a press on the frame in Edit mode may become a comment, nothing else does anything.
    if (input.button !== 0) return 'ignore';
    return input.onBoard && input.mode === 'edit' && !input.readOnly ? 'press' : 'dismiss';
  }
  const wantsPan = input.button === 1 || input.spaceDown || input.panTool || !input.onBoard || input.mode === 'play' || input.readOnly;
  if (input.button !== 0 && input.button !== 1) return 'ignore';
  return wantsPan ? 'pan' : 'press';
};

/** A press that moved more than this many screen px is a drag, not a click. */
export const DRAG_THRESHOLD_PX = 4;

export const isDrag = (from: Point, to: Point): boolean => Math.hypot(to.x - from.x, to.y - from.y) > DRAG_THRESHOLD_PX;

/**
 * Whether a frame's answer to `hit-test` belongs to the request still waiting: same artboard
 * and the same frame point. A stale answer (the pointer moved on) is dropped.
 */
export const hitMatches = <B>(pending: { board: B; frame: Point } | null, board: B, x: number, y: number): boolean =>
  pending !== null && pending.board === board && pending.frame.x === x && pending.frame.y === y;

/** The mode a frame is told to run in: a saved version is always read only (Play). */
export const frameModeOf = (mode: BridgeMode, readOnly: boolean): BridgeMode => (readOnly ? 'play' : mode);
