// Types shared by the wall's modules. A leaf: it imports nothing from the other wall files, so
// every module can use `Board`, `Artboard` and `WallOptions` without a circular import.

import type { PinPlacement, PinTracker } from '../../guest/anchoring.ts';
import type { Camera, WallArtboard } from '../../guest/camera.ts';
import type { AskElement, CreateCommentBody, PatchCommentBody } from '../../shared/api.ts';
import type { HitElement } from '../../shared/bridge-protocol.ts';
import type { Screen, Viewport } from '../../shared/types.ts';
import type { PickCheck } from '../model/edit-text-model.ts';
import type { Point } from '../model/wall-model.ts';
import type { CardHandle } from './comment-ui.ts';
import type { FrameSlot } from './frame-slot.ts';

export type Rect = { x: number; y: number; w: number; h: number };

/** One artboard as the wall draws it: the guest layout cell plus its screen and frame rect. */
export type Artboard = { id: string; screen: Screen | null; viewport: Viewport; rect: Rect; cell: WallArtboard };
/** `ghost`: the "+ Screen" board's box in world px, or null while it is not shown (Play, an old version, the cap, a page). */
export type WallLayout = { boards: Artboard[]; ghost: Rect | null; bounds: Rect };

export type WallOptions = {
  slug: string;
  compact: boolean;
  /** `wall`: the pan/zoom canvas. `page`: one frame shown like a browser tab (a page design). */
  presentation: 'wall' | 'page';
  /** Page presentation: `PAGE_FILL_VIEWPORT_ID` (Full width) or a viewport id. */
  initialPageView?: string;
  /** Screen px of the wall's right edge a drawer currently covers (laid over it on narrow pages). */
  coveredRight?: () => number;
  initialCamera: Camera | null;
  onScale: (scale: number) => void;
  onCameraSettled: (camera: Camera) => void;
  createComment: (body: CreateCommentBody) => Promise<void>;
  updateComment: (id: string, patch: PatchCommentBody) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  /** Play mode asked to open an external URL; the page confirms with the user. */
  onExternal: (url: string) => void;
  onNotice: (message: string) => void;
  /** Anchor resolution finished or a frame changed state: detached pins and remote references may have changed. */
  onStatus: () => void;
  /**
   * Seam S6 (Phase 1, send one pin): send one open comment to the chat, saving `body` first when it was edited.
   * Nobody passes it yet; when set, `popover-layer.openThread` hands it to the thread card as `onSend`.
   */
  onSendComment?: (id: string, body: string) => Promise<void>;
};

/**
 * Seam S4 (Phase 1, ask bar): the element the user clicked to comment on. `key` is
 * `${artboardId}:${anchor.selector}`; `where` is the composer's own location label.
 */
export type WallSelection = { key: string; element: AskElement; tag: string; where: string };
export type WallSelectionEvent =
  | { type: 'selected'; selection: WallSelection }
  /** A comment was added on the selected element (same `key`): the element has a comment now. */
  | { type: 'commented'; key: string }
  | { type: 'cleared' };

/**
 * Phase 2 (Edit text): an element the user picked in Edit mode, with what the frame and the file say
 * about editing it. `check` settles once both answered (it never rejects); `purpose` is `edit` for a
 * double-click. Only the wall creates picks; the edit feature reads them and never writes through the wall.
 */
export type WallPick = {
  id: number;
  purpose: 'click' | 'edit';
  selection: WallSelection;
  board: Board;
  element: HitElement;
  /** Where the user clicked, in frame px (the probe is asked at the same point). */
  framePoint: Point;
  /** The screen the element is in (null on a page). */
  screen: string | null;
  check: Promise<PickCheck>;
};

export type Board = {
  art: Artboard;
  root: HTMLElement;
  placeholder: HTMLElement;
  overlay: HTMLElement;
  hover: HTMLElement;
  hoverTag: HTMLElement;
  selected: HTMLElement;
  label: HTMLElement;
  labelText: HTMLElement;
  labelStatus: HTMLElement;
  /** The ⋯ button of the screen menu: shown on a canvas row's first label in Edit mode (board-set decides). */
  menu: HTMLButtonElement;
  main: FrameSlot;
  compare: FrameSlot | null;
  /** Screen the frame currently shows; differs from `art.screen` after play-mode navigation. */
  screenId: string | null;
  scroll: Point;
  tracker: PinTracker;
  placements: PinPlacement[];
  pins: Map<string, HTMLButtonElement>;
  /** Count badges standing in for pins that would overlap at this zoom. */
  clusters: HTMLButtonElement[];
  live: boolean;
};

/** The user opened a screen's ⋯ menu; the screens feature draws it (the wall only reports the press). */
export type ScreenMenuPress = { screenId: string; anchor: HTMLElement };

/** A screen dropped into a new place by dragging its label: the whole new order, ids as the design lists them. */
export type ScreenMove = { id: string; order: string[] };

/** What the controllers built before the board set need from it (a narrow view, so they do not import it). */
export type BoardLookup = {
  values: () => IterableIterator<Board>;
  /** The artboard under a point of the wall surface (screen px), if any. */
  at: (point: Point) => Board | null;
};

/** The one open card (a composer or a comment thread) and the artboard it floats over. */
export type Popover = { card: CardHandle; board: Board; commentId: string | null };
