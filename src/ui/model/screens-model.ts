// View-model of screen management (Phase 2 feature 10, technical design §5.4): what the screen
// menu offers and why an entry is off, whether the "+ Screen" board shows, the order a move or a
// drag produces, where a drag would drop, and the room the "+ Screen" box has for the user's words.
// No DOM, so the rules are tested without one. The service decides again at every write
// (`src/service/edits/ops-screens.ts`); everything here is advice that saves the user a try.

import type { MenuEntry, MenuNotes } from '../components/kit.ts';
import { ASK_TEXT_MAX, SCREENS_MAX } from '../../shared/limits.ts';
import { directionsAsk, newScreenAsk } from '../../shared/agent/screen-asks.ts';
import { DESIGN_JSON_UNREADABLE_MESSAGE, NO_DESIGN_JSON_MESSAGE, SCREEN_LIST_UNREADABLE_MESSAGE, SCREENS_CAP_MESSAGE } from '../../shared/screen-ops.ts';
import { AGENT_WORKING_LINE } from './edit-text-model.ts';

export { SCREENS_CAP_MESSAGE };

export type DesignJsonState = 'ok' | 'missing' | 'invalid';

export const VIEWING_REASON = "You're viewing an old version.";
export const FIRST_SCREEN_REASON = 'This is the first screen.';
export const LAST_SCREEN_REASON = 'This is the last screen.';
export const NO_FILE_REASON = 'Nothing to copy until the agent writes this screen.';

// ---- Whether screens can be changed at all ----

export type ScreenGate = {
  /** An old version is on show (E12). */
  viewing: boolean;
  /** `DesignDetailResponse.designJson`. */
  designJson: DesignJsonState;
  /** design.json's `screens` is not a list (the `invalid-screens` warning). */
  listInvalid: boolean;
};

/** The sentence that turns every screen action off, or null. An old version first: it is the thing the user can undo by looking away. */
export const screensBlock = (gate: ScreenGate): string | null => {
  if (gate.viewing) return VIEWING_REASON;
  if (gate.designJson === 'missing') return NO_DESIGN_JSON_MESSAGE;
  if (gate.designJson === 'invalid') return DESIGN_JSON_UNREADABLE_MESSAGE;
  if (gate.listInvalid) return SCREEN_LIST_UNREADABLE_MESSAGE;
  return null;
};

// ---- The screen menu ----

export type ScreenMenuInput = ScreenGate & {
  /** The screen's place in the wall's list (0-based) and the list's length. */
  index: number;
  count: number;
  /** The screen's file is on disk (Duplicate copies it). */
  hasFile: boolean;
  /** The build strip says the linked agent is working. */
  agentWorking: boolean;
  /**
   * The screen's place among the wall's rows and their number, when they differ from `index` and `count` (a direction is not a
   * row of its own, so a row's neighbours skip them). Move up and Move down read these; the cap still counts every screen.
   */
  rowIndex?: number;
  rowCount?: number;
  /** Why Try 3 directions is off for this screen (it has directions, or is one), or null/absent when it is on offer (`directionsOffReason`). */
  directionsOff?: string | null;
};

export type ScreenMenuId = 'duplicate' | 'up' | 'down' | 'trash' | 'directions';

export type ScreenMenu = { items: MenuEntry[]; notes: MenuNotes };

/** Fewer free slots than this and Try 3 directions is off (§5.4). */
const DIRECTIONS_MIN_FREE = 2;

type Action = Extract<MenuEntry, { id: string }>;
type Gate = Pick<Action, 'disabled' | 'reason' | 'explainedBy'>;

/**
 * Duplicate, Move up, Move down, Move to trash, then Try 3 directions…. Text only. A disabled entry says why inside
 * itself; the one cap sentence is the foot note, said once, and the two entries it turns off point at it.
 */
export const screenMenu = (input: ScreenMenuInput): ScreenMenu => {
  const block = screensBlock(input);
  const off = (reason: string): Gate => ({ disabled: true, reason });
  const capped: Gate = { disabled: true, explainedBy: 'foot' };
  const free = Math.max(0, SCREENS_MAX - input.count);

  const duplicate: Gate = block !== null ? off(block) : !input.hasFile ? off(NO_FILE_REASON) : free === 0 ? capped : {};
  const rowIndex = input.rowIndex ?? input.index;
  const rowCount = input.rowCount ?? input.count;
  const up: Gate = block !== null ? off(block) : rowIndex <= 0 ? off(FIRST_SCREEN_REASON) : {};
  const down: Gate = block !== null ? off(block) : rowIndex >= rowCount - 1 ? off(LAST_SCREEN_REASON) : {};
  const trash: Gate = block !== null ? off(block) : {};
  const directions: Gate = block !== null ? off(block) : input.directionsOff ? off(input.directionsOff) : free < DIRECTIONS_MIN_FREE ? capped : {};

  const items: MenuEntry[] = [
    { id: 'duplicate', label: 'Duplicate', ...duplicate },
    { id: 'up', label: 'Move up', ...up },
    { id: 'down', label: 'Move down', ...down },
    { id: 'trash', label: 'Move to trash', ...trash },
    { separator: true },
    { id: 'directions', label: 'Try 3 directions…', ...directions },
  ];
  const explainsCap = items.some((item) => 'id' in item && item.explainedBy === 'foot');
  return { items, notes: { ...(input.agentWorking ? { lead: AGENT_WORKING_LINE } : {}), ...(explainsCap ? { foot: SCREENS_CAP_MESSAGE } : {}) } };
};

// ---- The "+ Screen" board ----

/** Edit mode, a live design, a canvas, and room for one more screen. Hidden in Play, on an old version and at the cap. */
export const ghostVisible = (input: { kind: 'canvas' | 'page'; mode: 'edit' | 'play'; viewing: boolean; count: number }): boolean =>
  input.kind === 'canvas' && input.mode === 'edit' && !input.viewing && input.count < SCREENS_MAX;

/** The ghost board's height in world px (its width is the first viewport's). */
export const GHOST_HEIGHT = 240;

// ---- Orders ----

/** The ids in `order` with `id` one place up or down, or null at the edge (the menu already says so). */
export const shiftOrder = (order: readonly string[], id: string, direction: 'up' | 'down'): string[] | null => {
  const at = order.indexOf(id);
  const to = direction === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= order.length) return null;
  const next = [...order];
  const other = next[to];
  const self = next[at];
  if (other === undefined || self === undefined) return null;
  next[to] = self;
  next[at] = other;
  return next;
};

/** `id` moved to sit in gap `gap` (0 = before the first row, `order.length` = after the last). Null when that is where it already is. */
export const moveToGap = (order: readonly string[], id: string, gap: number): string[] | null => {
  const at = order.indexOf(id);
  if (at < 0 || gap < 0 || gap > order.length) return null;
  if (gap === at || gap === at + 1) return null;
  const rest = order.filter((entry) => entry !== id);
  const insertAt = gap > at ? gap - 1 : gap;
  return [...rest.slice(0, insertAt), id, ...rest.slice(insertAt)];
};

// ---- Dragging ----

/** One row of the wall in world px: its label's top and its lowest frame edge. */
export type DragRow = { id: string; top: number; bottom: number };

export type DropTarget = {
  /** The gap the screen would land in (`moveToGap`). */
  gap: number;
  /** Where the indicator line sits, world y: the middle of that gap. */
  y: number;
  /** Dropping here changes nothing (the screen's own place). */
  noop: boolean;
};

/**
 * Where a drag would drop: the gap nearest the pointer's world y, between row midpoints. The indicator is the
 * middle of the gap between two rows, or `edge` below the last and above the first.
 */
export const dropTarget = (rows: readonly DragRow[], worldY: number, movedId: string, edge = 24): DropTarget | null => {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) return null;
  let gap = 0;
  for (const row of rows) {
    if (worldY > (row.top + row.bottom) / 2) gap += 1;
  }
  const before = rows[gap - 1];
  const after = rows[gap];
  const y = before !== undefined && after !== undefined ? (before.bottom + after.top) / 2 : after !== undefined ? first.top - edge : last.bottom + edge;
  const at = rows.findIndex((row) => row.id === movedId);
  return { gap, y, noop: at < 0 || gap === at || gap === at + 1 };
};

// ---- Keeping a moved or copied screen in view ----

/**
 * The smallest pan (screen px) that brings `box` fully into a `stage` with `margin` around it; no zoom change. A box
 * bigger than the stage on an axis is aligned to its start there, so the screen's top and its label show.
 */
export const revealPan = (box: { x: number; y: number; w: number; h: number }, stage: { w: number; h: number }, margin: number): { dx: number; dy: number } => {
  const axis = (start: number, size: number, room: number): number => {
    if (size + 2 * margin > room) return margin - start;
    if (start < margin) return margin - start;
    if (start + size > room - margin) return room - margin - (start + size);
    return 0;
  };
  return { dx: axis(box.x, box.w, stage.w), dy: axis(box.y, box.h, stage.h) };
};

// ---- The box that takes the user's words for an ask ("+ Screen", Try 3 directions) ----

/** The counter appears once this few characters are left. */
export const ASK_NOTE_COUNTER_FROM = 200;

/** How many characters the user's words may take: the ask limit minus the fixed text around them. */
export const newScreenRoom = (input: { title: string; after: string | null; free: number }): number => {
  // One character of note shows the template's punctuation and joiner, so the fixed part is the rest.
  const withOne = newScreenAsk({ ...input, note: 'x' }).length;
  return Math.max(0, ASK_TEXT_MAX - (withOne - 1));
};

/** The same for Try 3 directions: the screen's title and id and the free slots fix the text around the user's words. */
export const directionsRoom = (input: { title: string; id: string; free: number }): number => Math.max(0, ASK_TEXT_MAX - (directionsAsk({ ...input, note: 'x' }).length - 1));

export type AskNoteBox = {
  /** Characters left, negative past the limit. */
  left: number;
  /** "180 left", "12 over", or null while it is not worth a line. */
  counter: string | null;
  over: boolean;
  /** The ask may be sent (a request is not running and the words fit). */
  canSend: boolean;
};

export const askNoteBox = (input: { typed: string; room: number; sending: boolean }): AskNoteBox => {
  const left = input.room - input.typed.trim().length;
  const over = left < 0;
  const counter = over ? `${(-left).toLocaleString()} over` : left <= ASK_NOTE_COUNTER_FROM ? `${left.toLocaleString()} left` : null;
  return { left, counter, over, canSend: !over && !input.sending };
};
