// Types shared by the wall's modules. A leaf: it imports nothing from the other wall files, so
// every module can use `Board`, `Artboard` and `WallOptions` without a circular import.

import type { PinPlacement, PinTracker } from '../../guest/anchoring.ts';
import type { Camera, WallArtboard } from '../../guest/camera.ts';
import type { CreateCommentBody, PatchCommentBody } from '../../shared/api.ts';
import type { Screen, Viewport } from '../../shared/types.ts';
import type { Point } from '../model/wall-model.ts';
import type { CardHandle } from './comment-ui.ts';
import type { FrameSlot } from './frame-slot.ts';

export type Rect = { x: number; y: number; w: number; h: number };

/** One artboard as the wall draws it: the guest layout cell plus its screen and frame rect. */
export type Artboard = { id: string; screen: Screen | null; viewport: Viewport; rect: Rect; cell: WallArtboard };
export type WallLayout = { boards: Artboard[]; bounds: Rect };

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

/** What the controllers built before the board set need from it (a narrow view, so they do not import it). */
export type BoardLookup = {
  values: () => IterableIterator<Board>;
  /** The artboard under a point of the wall surface (screen px), if any. */
  at: (point: Point) => Board | null;
};

/** The one open card (a composer or a comment thread) and the artboard it floats over. */
export type Popover = { card: CardHandle; board: Board; commentId: string | null };
