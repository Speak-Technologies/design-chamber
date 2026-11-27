// The wall's input decisions as pure functions: which key does what, where a wheel turn goes,
// what a pointer press starts, what two fingers do. The DOM side (`src/ui/wall/input-controller.ts`)
// reads the event, asks one of these, and acts on the answer. Mouse and keyboard rules are exactly
// the ones the wall always had; changing a shortcut or a gesture means changing it here, where a
// table test can see it.

import { panBy, zoomBy, type Camera } from '../../guest/camera.ts';
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
  | { type: 'escape' }
  /** Ctrl/⌘+Z: undo the one hand edit this view made last (`nextUndoSlot`). */
  | { type: 'undo-edit' };

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
export const wallKeyAction = (input: { key: string; code: string; shift: boolean; pageMode: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean; inField?: boolean }): WallKeyAction | null => {
  const { key, code, shift } = input;
  if (isUndoEditKey({ key, shift, ctrl: input.ctrl ?? false, meta: input.meta ?? false, alt: input.alt ?? false, inField: input.inField ?? false })) return { type: 'undo-edit' };
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

/**
 * Ctrl or ⌘ with Z, no Shift or Alt, and focus not in a field (a field keeps its own undo).
 * Only the wall's own keydown asks: a key forwarded from a frame carries no modifiers.
 */
export const isUndoEditKey = (input: { key: string; shift: boolean; ctrl: boolean; meta: boolean; alt: boolean; inField: boolean }): boolean =>
  !input.inField && (input.ctrl || input.meta) && !input.shift && !input.alt && input.key.toLowerCase() === 'z';

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
 * when it is over the loaded frame and does nothing otherwise. On the wall a plain wheel pans
 * everywhere, over artboards and empty wall alike (an Edit-mode frame takes no pointer input,
 * so the wheel never reaches the design); Ctrl/Cmd zooms around the cursor.
 */
export const wheelRoute = (input: { pageMode: boolean; ctrlOrMeta: boolean; overReadyBoard: boolean }): WheelRoute => {
  if (input.pageMode) return !input.ctrlOrMeta && input.overReadyBoard ? 'scroll-frame' : 'none';
  return input.ctrlOrMeta ? 'zoom' : 'pan';
};

/**
 * A wheel turn a design frame forwarded (Ctrl/Meta in any mode, a plain wheel only in Edit mode).
 * On the wall it pans, or zooms with Ctrl: the same answer the surface gives, so a forwarded
 * wheel never scrolls the design in Edit mode. A page only scrolls the design, and only in
 * Edit mode.
 */
export const frameWheelRoute = (input: { pageMode: boolean; ctrl: boolean; mode: BridgeMode; readOnly: boolean }): WheelRoute => {
  if (input.pageMode) return !input.ctrl && input.mode === 'edit' && !input.readOnly ? 'scroll-frame' : 'none';
  return input.ctrl ? 'zoom' : 'pan';
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
/** A finger wobbles more than a mouse: a tap may move this far and still be a tap. */
export const TOUCH_DRAG_THRESHOLD_PX = 10;

/** The drag threshold for a pointer, by `PointerEvent.pointerType`. Only touch differs. */
export const dragThreshold = (pointerType: string): number => (pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX);

export const isDrag = (from: Point, to: Point, threshold: number = DRAG_THRESHOLD_PX): boolean => Math.hypot(to.x - from.x, to.y - from.y) > threshold;

// ---- Touch (native extras §2.2). A mouse and a trackpad never reach these. ----

/** Where two fingers are, surface px. */
export type TouchPair = readonly [Point, Point];

/** Fingers closer than this give no usable distance to take a ratio of. */
const PINCH_MIN_DISTANCE = 1;

const middle = ([a, b]: TouchPair): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const apart = ([a, b]: TouchPair): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * One move of a pinch: how much to zoom (`factor`), around which point (`at`, the fingers' new
 * midpoint), and how far the midpoint travelled (`dx`, `dy`: two fingers also pan).
 */
export const pinchStep = (prev: TouchPair, next: TouchPair): { factor: number; at: Point; dx: number; dy: number } => {
  const before = apart(prev);
  const after = apart(next);
  const from = middle(prev);
  const at = middle(next);
  const factor = before < PINCH_MIN_DISTANCE || after < PINCH_MIN_DISTANCE ? 1 : after / before;
  return { factor, at, dx: at.x - from.x, dy: at.y - from.y };
};

/** The camera after one move of a pinch: what was under the fingers stays under them; zoom keeps the wall's 5 % to 400 %. */
export const pinchCamera = (camera: Camera, prev: TouchPair, next: TouchPair): Camera => {
  const step = pinchStep(prev, next);
  return zoomBy(panBy(camera, step.dx, step.dy), step.factor, step.at);
};

/**
 * A finger dragging a page in Edit mode (its frame takes no input there): how far to scroll the
 * design so it follows the finger. `scale` is the frame's size on screen against its own px.
 */
export const touchScrollDelta = (from: Point, to: Point, scale: number): { dx: number; dy: number } => {
  const by = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { dx: (from.x - to.x) / by, dy: (from.y - to.y) / by };
};

/**
 * Whether a frame's answer to `hit-test` belongs to the request still waiting: same artboard
 * and the same frame point. A stale answer (the pointer moved on) is dropped.
 */
export const hitMatches = <B>(pending: { board: B; frame: Point } | null, board: B, x: number, y: number): boolean =>
  pending !== null && pending.board === board && pending.frame.x === x && pending.frame.y === y;

/** The mode a frame is told to run in: a saved version is always read only (Play). */
export const frameModeOf = (mode: BridgeMode, readOnly: boolean): BridgeMode => (readOnly ? 'play' : mode);

/** What happened to the view's one undo slot (§2.7). */
export type UndoSlotEvent =
  /** A hand edit made by this view went through (`id` is the edit's id). */
  | { type: 'edited'; id: string }
  /** Ctrl/⌘+Z on the wall. */
  | { type: 'undo-key' }
  /** Undo was pressed on the notice of edit `id`. */
  | { type: 'notice-undo'; id: string };

/** E12: what an Undo refused because an old version is on show says. */
export const UNDO_VIEWING_TEXT = "You're viewing an old version.";

/**
 * One slot, the id of the last hand edit this mount made. A new edit replaces it; the key sends
 * that undo and empties the slot whatever the answer; Undo on the slot's own notice empties it too;
 * with an empty slot the key does nothing, so it never reaches further back. An edit made on the
 * other surface never reaches this reducer. `undo` is the edit id to send, or null.
 *
 * E12: while an old version is on show (`viewing`) an undo would change the current design behind the
 * user's back, so both undo events are refused: nothing is sent, the slot is kept (Undo works again once
 * the current design is back) and `refusal` carries the sentence to show. Recording an edit is not
 * an undo and always goes through.
 */
export const nextUndoSlot = (
  slot: string | null,
  event: UndoSlotEvent,
  viewing = false,
): { slot: string | null; undo: string | null; refusal: string | null } => {
  if (event.type === 'edited') return { slot: event.id, undo: null, refusal: null };
  if (viewing) return { slot, undo: null, refusal: UNDO_VIEWING_TEXT };
  switch (event.type) {
    case 'undo-key':
      return { slot: null, undo: slot, refusal: null };
    case 'notice-undo':
      return { slot: slot === event.id ? null : slot, undo: null, refusal: null };
  }
};
