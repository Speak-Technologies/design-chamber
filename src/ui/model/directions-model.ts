// View-model of the directions rows (Phase 2 feature 11, technical design §6.3): which screens form a row, which
// viewport the row shows, how each board is named, when "Keep this one" is on offer and why it is off, the request
// Keep sends, and the room the wall reserves for a row's header and for the second line of the rail's grid.
// No DOM, so the rules are tested without one. The service decides again at every write
// (`src/service/edits/ops-screens.ts`); everything here is advice that saves the user a try.

import { unionBoxes, artboardBox, type Box, type WallArtboard, type WallLayout, type WallRow, type WallScreen } from '../../guest/camera.ts';
import type { EditRequest, FileStamp } from '../../shared/api.ts';
import { directionGroups } from '../../shared/screen-ops.ts';
import type { Screen, Viewport } from '../../shared/types.ts';
import { screensBlock, type ScreenGate } from './screens-model.ts';

// ---- The rows ----

/** One direction row: the original ("Current"), its marked screens in letter order, and the viewport they are all shown at. */
export type DirectionRowPlan = {
  root: Screen;
  members: Screen[];
  /** The viewport every cell is shown at (the one the user chose, or the first of the original's). */
  viewport: Viewport;
  /** What "Show at" offers: the original's own viewports. */
  options: Viewport[];
};

export type DirectionPlan = {
  /** By the original's id. */
  rows: Map<string, DirectionRowPlan>;
  /** A member's id → the original's id. */
  memberOf: Map<string, string>;
};

/** The viewports the original is shown at: its own subset of the design's, or all of them. */
export const rowViewports = (root: Screen, viewports: readonly Viewport[]): Viewport[] => {
  const own = root.viewports === undefined ? viewports : viewports.filter((viewport) => root.viewports?.includes(viewport.id));
  return own.length > 0 ? [...own] : [...viewports];
};

/** The viewport a row shows: the chosen id when the original still has it, else the original's first. Null only for a design with no viewport. */
export const pickViewport = (options: readonly Viewport[], chosen: string | undefined): Viewport | null => options.find((viewport) => viewport.id === chosen) ?? options[0] ?? null;

/** The direction rows of a screen list. `chosen` answers the viewport saved for an original (unknown or none → the first). */
export const planDirections = (screens: readonly Screen[], viewports: readonly Viewport[], chosen: (of: string) => string | undefined): DirectionPlan => {
  const plan: DirectionPlan = { rows: new Map(), memberOf: new Map() };
  const byId = new Map(screens.map((screen) => [screen.id, screen] as const));
  for (const group of directionGroups(screens)) {
    const root = byId.get(group.of);
    if (root === undefined) continue;
    const options = rowViewports(root, viewports);
    const viewport = pickViewport(options, chosen(group.of));
    if (viewport === null) continue;
    plan.rows.set(root.id, { root, members: group.members, viewport, options });
    for (const member of group.members) plan.memberOf.set(member.id, root.id);
  }
  return plan;
};

const wallScreen = (screen: Screen): WallScreen => ({ id: screen.id, title: screen.title, ...(screen.viewports ? { viewports: screen.viewports } : {}) });

/** The wall's rows in list order: a direction row in its original's place, no row of its own for a member, a screen row for the rest. */
export const wallRows = (screens: readonly Screen[], plan: DirectionPlan): WallRow[] => {
  const rows: WallRow[] = [];
  for (const screen of screens) {
    if (plan.memberOf.has(screen.id)) continue;
    const row = plan.rows.get(screen.id);
    rows.push(row === undefined ? wallScreen(screen) : { group: { of: wallScreen(row.root), members: row.members.map(wallScreen) }, viewport: row.viewport });
  }
  return rows;
};

/** The rail lays a group out as a 2×2 grid so every direction is on screen at once; the full-screen page keeps one row. */
export const directionColumns = (compact: boolean): number | undefined => (compact ? 2 : undefined);

// ---- Names ----

/** "Pricing · 3 directions", "Pricing · 1 direction". */
export const rowTitle = (title: string, count: number): string => `${title} · ${count} ${count === 1 ? 'direction' : 'directions'}`;

export type DirectionBoardLabel = { name: string; detail: string; full: string };

/** The label of a board in a row: "Current" with its viewport, or the direction's letter with the agent's short name. */
export const boardLabel = (screen: Screen, viewport: Viewport): DirectionBoardLabel => {
  if (screen.direction === undefined) {
    const detail = `${viewport.label} ${viewport.width}×${viewport.height}`;
    return { name: 'Current', detail, full: `Current · ${detail}` };
  }
  const { letter, name } = screen.direction;
  return { name: letter, detail: name, full: `${letter} · ${name}` };
};

/** What a screen reader hears for a board's Keep button: the visible words first, then which board. */
export const keepLabel = (screen: Screen, originalTitle: string): string =>
  screen.direction === undefined ? `Keep this one: the current ${originalTitle}` : `Keep this one: direction ${screen.direction.letter}, ${screen.direction.name}`;

// ---- Keep this one ----

export const KEEP_NOT_WRITTEN_REASON = 'Not written yet.';

export type KeepInput = ScreenGate & {
  /** Edit mode (Play uses the design like a prototype). */
  editing: boolean;
  /** A screen action is running. */
  busy: boolean;
  /** The board's file is on disk. */
  written: boolean;
};

export type KeepState = {
  /** Drawn at all: Edit mode, the current design. An old version keeps the row's layout and hides the buttons. */
  shown: boolean;
  disabled: boolean;
  /** Why it is off, as a sentence (null while it is on, or off only because a request is running). */
  reason: string | null;
};

export const keepState = (input: KeepInput): KeepState => {
  if (input.viewing || !input.editing) return { shown: false, disabled: true, reason: null };
  const block = screensBlock(input);
  if (block !== null) return { shown: true, disabled: true, reason: block };
  if (!input.written) return { shown: true, disabled: true, reason: KEEP_NOT_WRITTEN_REASON };
  return { shown: true, disabled: input.busy, reason: null };
};

/** Try 3 directions is off while the screen is a row's original or one of its directions (§6.3). Null when it is on offer. */
export const directionsOffReason = (screenId: string, plan: DirectionPlan, titleOf: (id: string) => string): string | null => {
  if (plan.rows.has(screenId)) return 'This screen already has directions. Keep one first.';
  const original = plan.memberOf.get(screenId);
  return original === undefined ? null : `This is a direction of ${titleOf(original)}. Keep one first.`;
};

/** What the file looked like to the wall: size and mtime, or null when it is not there. */
export type ScreenFileStatus = { exists: boolean; size: number; mtime: FileStamp['mtime'] };

export const stampOfFile = (status: ScreenFileStatus | undefined): FileStamp | null => (status !== undefined && status.exists ? { size: status.size, mtime: status.mtime } : null);

/** The request for "Keep this one": `files` names the original and every direction with what the wall shows of it (§6.2). */
export const keepRequest = (input: { stamp: string; row: DirectionRowPlan; keep: string; files: Readonly<Record<string, ScreenFileStatus>> }): Extract<EditRequest, { op: 'keep-direction' }> => ({
  op: 'keep-direction',
  screens: input.stamp,
  of: input.row.root.id,
  keep: input.keep,
  files: [input.row.root, ...input.row.members].map((screen) => ({ id: screen.id, file: stampOfFile(input.files[screen.id]) })),
});

/** The notice's title: the service's label and its detail as one sentence ("Kept B for Pricing. The others are in the trash."). */
export const keptNotice = (edit: { id: string; label: string; detail?: string; undoable: boolean }): { id: string; label: string; undoable: boolean } => ({
  id: edit.id,
  label: edit.detail ? `${edit.label}. ${edit.detail}` : edit.label,
  undoable: edit.undoable,
});

// ---- Moving a row ----

/**
 * The screen list with a row dropped into gap `gap` of the visible rows (`rowIds`, top to bottom; 0 = above the first). A row that
 * has directions takes them along (`moving` is the original and its directions): they follow it, so the list stays one row's
 * entries together. Screens that have no row (a viewport subset the wall hides) keep their places. Null when nothing would change.
 */
export const moveRowToGap = (order: readonly string[], rowIds: readonly string[], movedId: string, moving: ReadonlySet<string>, gap: number): string[] | null => {
  const at = rowIds.indexOf(movedId);
  if (at < 0 || gap < 0 || gap > rowIds.length || gap === at || gap === at + 1) return null;
  const rest = order.filter((id) => !moving.has(id));
  const taken = order.filter((id) => moving.has(id) && id !== movedId);
  // The row that will sit right below the dropped one (the moved row itself does not count).
  const below = rowIds.slice(gap).find((id) => id !== movedId);
  const index = below === undefined ? rest.length : rest.indexOf(below);
  if (index < 0 || !order.includes(movedId)) return null;
  const next = [...rest.slice(0, index), movedId, ...taken, ...rest.slice(index)];
  return next.every((id, position) => id === order[position]) ? null : next;
};

// ---- The viewport a row is shown at, kept per design ----

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `directionViewport` of the saved view settings: an object of original id → viewport id; anything else is dropped. */
export const readDirectionViewports = (raw: unknown): Record<string, string> => {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [of, id] of Object.entries(raw)) if (typeof id === 'string') out[of] = id;
  return out;
};

// ---- Room on the wall ----

/**
 * World px reserved above a row for its header ("Pricing · 3 directions", Show at). The header and the label under it are screen px
 * (about 62 of them, 88 when a narrow rail wraps the select under the title), so the room has to cover that at the zoom Fit gives:
 * about 0.17 on the full-screen page, 0.11 on the rail, whose grid is two boards wide.
 */
export const DIRECTION_HEAD_ROOM = 360;
export const DIRECTION_HEAD_ROOM_RAIL = 780;
/** World px added between the lines of the rail's grid, so the second line's labels have room at the rail's small zoom. */
export const DIRECTION_LINE_ROOM = 160;

export type SpacedLayout = {
  layout: WallLayout;
  /** Each row's header strip, world px, by the original's id. */
  heads: Map<string, Box>;
};

const shiftBox = (box: Box, dy: number): Box => ({ ...box, y: box.y + dy });

/**
 * The layout with room for every row's header above it and between the lines of a grid. `layoutWall` places the cells; this
 * moves them down (a row's cells by what the rows above reserved plus its own header, its second line by one more line of
 * room) and answers where each header goes. Rows without a direction group move only by what the rows above them reserved.
 */
export const spaceDirectionRows = (layout: WallLayout, plan: DirectionPlan, headRoom: number = DIRECTION_HEAD_ROOM, lineRoom: number = DIRECTION_LINE_ROOM): SpacedLayout => {
  if (plan.rows.size === 0) return { layout, heads: new Map() };
  const isDirection = (cell: WallArtboard): boolean => cell.screen !== null && (plan.rows.has(cell.screen) || plan.memberOf.has(cell.screen));
  const lines = new Map<number, number>();
  for (const cell of layout.artboards) if (isDirection(cell)) lines.set(cell.row, Math.max(lines.get(cell.row) ?? 1, (cell.line ?? 0) + 1));
  /** What the rows above row `row` reserved. */
  const before = (row: number): number => {
    let total = 0;
    for (const [directionRow, count] of lines) if (directionRow < row) total += headRoom + (count - 1) * lineRoom;
    return total;
  };
  const heads = new Map<string, Box>();
  const artboards = layout.artboards.map((cell): WallArtboard => {
    const dy = isDirection(cell) ? before(cell.row) + headRoom + (cell.line ?? 0) * lineRoom : before(cell.row);
    if (dy === 0) return cell;
    return { ...cell, label: shiftBox(cell.label, dy), frame: shiftBox(cell.frame, dy) };
  });
  for (const cell of artboards) {
    if (cell.screen === null || !plan.rows.has(cell.screen)) continue;
    // The original sits first on line 0 of its row: its label's top is the row's top.
    heads.set(cell.screen, { x: cell.label.x, y: cell.label.y - headRoom, width: cell.label.width, height: headRoom });
  }
  const ghost = layout.ghost === undefined ? undefined : { ...layout.ghost, box: shiftBox(layout.ghost.box, before(layout.ghost.row)) };
  const boxes = [...artboards.map(artboardBox), ...heads.values(), ...(ghost ? [ghost.box] : [])];
  const bounds = unionBoxes(boxes);
  return { layout: { artboards, ...(ghost ? { ghost } : {}), bounds }, heads };
};
