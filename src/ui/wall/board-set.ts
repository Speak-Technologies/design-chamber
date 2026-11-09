// The artboards: one `Board` per screen × viewport (a single board on a page). Owns the layout,
// each board's DOM (frame, placeholder, label, hover outline), the frame slots, loading and
// unloading frames by the live budget, and the saved-version compare frame.
//
// `paintLabel` is the one place an artboard's status (loading, not written, blocked files, the
// saved version on show) is rendered.

import { mountSpinner } from '@openchamber/sdk/ui';

import { trackPins } from '../../guest/anchoring.ts';
import { layoutWall, type Box, type WallArtboard } from '../../guest/camera.ts';
import { artboardIdOf, type FrameToPageMessage } from '../../shared/bridge-protocol.ts';
import { ARTBOARD_LABEL_HEIGHT, FRAME_UNLOAD_MARGIN, PAGE_FILL_VIEWPORT_ID, WALL_GAP } from '../../shared/limits.ts';
import type { Comment, Viewport } from '../../shared/types.ts';
import { append, h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import { btn, iconBtn } from '../components/kit.ts';
import { artboardLabel, viewportLabel } from '../model/format.ts';
import { boardAt, labelWidth, liveBoards, type Point } from '../model/wall-model.ts';
import type { CameraController } from './camera-controller.ts';
import { createFrameSlot, type FrameSlot } from './frame-slot.ts';
import type { PinLayer } from './pin-layer.ts';
import type { PopoverLayer } from './popover-layer.ts';
import type { WallContext } from './wall-context.ts';
import type { Artboard, Board, BoardLookup, Rect, WallLayout } from './wall-types.ts';

export type { Artboard, Board } from './wall-types.ts';

export type BoardSet = BoardLookup & {
  get: (id: string) => Board | undefined;
  /** The first board; a page has exactly one. */
  first: () => Board | undefined;
  /** The board a comment was made on. */
  forComment: (comment: Comment) => Board | undefined;
  /** The bounds of everything on the wall, world px. */
  bounds: () => Rect;
  /** Recompute the layout: add, resize and remove boards to match the design (or the page's stage). */
  rebuild: () => void;
  /** Load the board's frame (and its compare frame) for the version on show. Does nothing for a paused board. */
  load: (board: Board) => Promise<void>;
  /** Back to the board's own screen, scrolled to the top, and reload. */
  reset: (board: Board) => void;
  /** Repaint the board's placeholder and label. */
  paint: (board: Board) => void;
  /** Render the board's label row: its name and every status chip. */
  paintLabel: (board: Board) => void;
  /** Position every label for the current camera. */
  placeLabels: () => void;
  /**
   * Seam S5 (Phase 1, build strip): the sources (screen ids; null = the page) whose boards the
   * agent just wrote, or null for none. Today it only stores them; the build-strip branch makes
   * `paintLabel` and `sizeBoard` set `data-recent="true"` on those boards and clear the rest.
   */
  markRecent: (sources: ReadonlySet<string | null> | null) => void;
  /** The sources last passed to `markRecent`. */
  recent: () => ReadonlySet<string | null> | null;
  /** Load or pause frames by the live budget on the next animation frame. */
  queueSync: () => void;
  dispose: () => void;
};

export type BoardSetDeps = {
  camera: CameraController;
  pins: PinLayer;
  popovers: PopoverLayer;
  /** A frame sent a message; the wall's message handler decides what it means. */
  onFrameMessage: (board: Board, message: FrameToPageMessage) => void;
};

const toRect = (box: Box): Rect => ({ x: box.x, y: box.y, w: box.width, h: box.height });

export const createBoardSet = (ctx: WallContext, deps: BoardSetDeps): BoardSet => {
  const { options, pageMode } = ctx;
  const { camera, pins, popovers } = deps;
  const boards = new Map<string, Board>();
  let layout: WallLayout = { boards: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  let syncQueued = false;
  let recent: ReadonlySet<string | null> | null = null;

  const values = (): IterableIterator<Board> => boards.values();

  // ---------------------------------------------------------------- painting

  const placeLabel = (board: Board): void => {
    if (pageMode) {
      // A page has no label row; its state shows in the placeholder and the view's notices.
      board.label.hidden = true;
      return;
    }
    const current = camera.get();
    const { rect } = board.art;
    const x = current.x + rect.x * current.scale;
    const y = current.y + rect.y * current.scale;
    const width = rect.w * current.scale;
    const next = layout.boards.reduce<number | null>((nearest, other) => (other.rect.x > rect.x && (nearest === null || other.rect.x < nearest) ? other.rect.x : nearest), null);
    board.label.style.transform = `translate(${x}px, ${y - 26}px)`;
    // Never past the wall's right edge, so a long label ends in an ellipsis rather than a cut.
    board.label.style.width = `${Math.max(0, Math.min(labelWidth(rect, next, current.scale), Math.max(width, ctx.surfaceSize.w - x - 8)))}px`;
    // Labels sit in the gap above their row; below a 24 px gap only the top row keeps one.
    board.label.hidden = width < 32 || (board.art.cell.row > 0 && (ARTBOARD_LABEL_HEIGHT + WALL_GAP) * current.scale < 24);
  };

  const paintPlaceholder = (board: Board): void => {
    const state = board.main.state();
    const file = ctx.fileOf(board.screenId);
    board.placeholder.replaceChildren();
    board.placeholder.dataset.state = board.live ? state : 'idle';
    const inner = h('div', { class: 'dc-placeholder-inner' });
    if (!board.live || state === 'idle') {
      if (!board.live) append(inner, icon('layers', 20), h('p', { class: 'dc-placeholder-title' }, 'Paused'), h('p', { class: 'dc-placeholder-sub' }, 'Off screen. Pan here to load it.'));
      else mountSpinner(inner, { label: 'Loading…' });
    } else if (state === 'loading') {
      mountSpinner(inner, { label: `Loading ${board.art.screen?.title ?? 'page'}…` });
    } else if (state === 'missing') {
      append(
        inner,
        icon('layers', 20),
        h('p', { class: 'dc-placeholder-title' }, `${file} isn’t written yet`),
        h('p', { class: 'dc-placeholder-sub' }, 'It appears here the moment your agent saves it.'),
      );
    } else if (state === 'error') {
      const retry = btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => void load(board) });
      append(inner, icon('warning', 20), h('p', { class: 'dc-placeholder-title' }, 'This didn’t load'), h('p', { class: 'dc-placeholder-sub' }, board.main.error() ?? ''), retry.el);
    }
    board.placeholder.append(inner);
    board.root.dataset.state = board.live ? state : 'idle';
  };

  const paintLabel = (board: Board): void => {
    const { art } = board;
    const name = art.screen ? `${art.screen.title} · ${viewportLabel(art.viewport)}` : viewportLabel(art.viewport);
    const navigated = board.screenId !== (art.screen?.id ?? null);
    const shown = navigated ? (ctx.screens().find((s) => s.id === board.screenId)?.title ?? board.screenId ?? '') : (art.screen?.title ?? ctx.detail.design.title);
    const text = artboardLabel(shown, art.viewport);
    board.labelText.replaceChildren(h('span', { class: 'dc-label-name' }, text.name), h('span', { class: 'dc-label-sep', 'aria-hidden': 'true' }, '·'), h('span', { class: 'dc-label-dims' }, text.detail));
    board.labelText.title = text.full;
    board.labelStatus.replaceChildren();
    const state = board.main.state();
    if (state === 'loading' && board.live) append(board.labelStatus, h('span', { class: 'dc-status dc-status-spin', role: 'status', 'aria-label': 'Loading' }));
    if (state === 'missing') append(board.labelStatus, h('span', { class: 'dc-status', 'data-tone': 'warning' }, 'Not written yet'));
    if (state === 'error') append(board.labelStatus, h('span', { class: 'dc-status', 'data-tone': 'error' }, 'Didn’t load'));
    const meta = board.main.meta();
    const problems = meta ? [...meta.blocked, ...meta.missing] : [];
    if (problems.length > 0) {
      append(
        board.labelStatus,
        h('span', { class: 'dc-status', 'data-tone': 'warning', title: `Blocked or missing:\n${problems.join('\n')}`, tabindex: '0', role: 'img', 'aria-label': `${problems.length} references blocked or missing: ${problems.join(', ')}` }, `${problems.length} blocked`),
      );
    }
    if (meta && meta.external.length > 0) {
      append(board.labelStatus, h('span', { class: 'dc-status', 'data-tone': 'warning', title: `Remote files are blocked inside designs:\n${meta.external.join('\n')}`, tabindex: '0', role: 'img', 'aria-label': `${meta.external.length} remote files blocked` }, `${meta.external.length} remote`));
    }
    if (board.screenId !== (art.screen?.id ?? null)) {
      append(
        board.labelStatus,
        iconBtn({ icon: 'reset', label: `Reset ${name} to its first screen`, size: 'sm', onClick: () => reset(board) }),
      );
    }
    if (ctx.version !== null) append(board.labelStatus, h('span', { class: 'dc-status', 'data-tone': 'info' }, ctx.compare ? `v${ctx.version.slice(1)} | current` : ctx.version));
  };

  const paint = (board: Board): void => {
    paintPlaceholder(board);
    paintLabel(board);
  };

  // ---------------------------------------------------------------- boards

  const sizeBoard = (board: Board): void => {
    const { rect } = board.art;
    board.root.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    board.root.style.width = `${rect.w}px`;
    board.root.style.height = `${rect.h}px`;
    for (const slot of [board.main, board.compare]) {
      if (!slot) continue;
      slot.iframe.style.width = `${rect.w}px`;
      slot.iframe.style.height = `${rect.h}px`;
    }
    placeLabel(board);
  };

  const makeBoard = (art: Artboard): Board => {
    const labelText = h('span', { class: 'dc-label-text' });
    const labelStatus = h('span', { class: 'dc-label-status' });
    const label = h('div', { class: 'dc-label' }, labelText, labelStatus);
    const placeholder = h('div', { class: 'dc-placeholder' });
    const hoverTag = h('span', { class: 'dc-hover-tag' });
    const hover = h('div', { class: 'dc-hover', hidden: true }, hoverTag);
    const selected = h('div', { class: 'dc-selected', hidden: true });
    const overlayLayer = h('div', { class: 'dc-board-overlay' }, hover, selected);
    const root = h('div', { class: 'dc-board', 'data-board': art.id });
    let self: Board | null = null;
    const main = createFrameSlot({
      slug: options.slug,
      artboardId: art.id,
      title: art.viewport.id === PAGE_FILL_VIEWPORT_ID && pageMode ? `${ctx.detail.design.title}, full width` : `${art.screen?.title ?? ctx.detail.design.title} at ${viewportLabel(art.viewport)}`,
      mode: () => ctx.frameMode(),
      scroll: () => self?.scroll ?? { x: 0, y: 0 },
      onState: () => {
        if (self && !ctx.disposed) {
          paint(self);
          options.onStatus();
        }
      },
    });
    const tracker = trackPins(main.channel, ctx.commentsOf(art));
    const board: Board = {
      art,
      root,
      placeholder,
      overlay: overlayLayer,
      hover,
      hoverTag,
      selected,
      label,
      labelText,
      labelStatus,
      main,
      compare: null,
      screenId: art.screen?.id ?? null,
      scroll: { x: 0, y: 0 },
      tracker,
      placements: [],
      pins: new Map(),
      clusters: [],
      live: false,
    };
    self = board;
    tracker.subscribe((placements, scroll) => {
      board.placements = placements;
      board.scroll = scroll;
      pins.paint(board);
      options.onStatus();
    });
    main.channel.subscribe((message) => {
      if (!ctx.disposed) deps.onFrameMessage(board, message);
    });
    root.append(board.main.iframe, placeholder, overlayLayer);
    ctx.world.append(root);
    ctx.labels.append(label);
    sizeBoard(board);
    return board;
  };

  const ensureCompare = (board: Board): FrameSlot => {
    if (board.compare) return board.compare;
    const slot = createFrameSlot({
      slug: options.slug,
      artboardId: board.art.id,
      title: `${board.art.screen?.title ?? ctx.detail.design.title} (saved version)`,
      mode: () => 'play',
      scroll: () => board.scroll,
      onState: () => paint(board),
    });
    slot.iframe.classList.add('dc-frame-compare');
    board.compare = slot;
    board.root.insertBefore(slot.iframe, board.placeholder);
    sizeBoard(board);
    return slot;
  };

  const dropCompare = (board: Board): void => {
    board.compare?.dispose();
    board.compare = null;
  };

  const disposeBoard = (board: Board): void => {
    board.tracker.dispose();
    board.main.dispose();
    board.compare?.dispose();
    board.root.remove();
    board.label.remove();
  };

  // ---------------------------------------------------------------- layout

  /** The page's one frame: the chosen viewport's width (or the stage's), as tall as the stage. */
  const pageLayout = (): WallLayout => {
    const geometry = camera.pageGeometry();
    const chosen = ctx.pageViewport();
    const viewport: Viewport = chosen ?? { id: PAGE_FILL_VIEWPORT_ID, label: 'Full width', width: geometry.frameW, height: geometry.frameH };
    const frame = { x: 0, y: 0, width: geometry.frameW, height: geometry.frameH };
    const cell: WallArtboard = { id: artboardIdOf(null, viewport.id), screen: null, screenTitle: ctx.detail.design.title, viewport, row: 0, col: 0, frame, label: { x: 0, y: 0, width: frame.width, height: 0 } };
    return { boards: [{ id: cell.id, screen: null, viewport, rect: toRect(frame), cell }], bounds: toRect(frame) };
  };

  const rebuild = (): void => {
    const { design } = ctx.detail;
    if (pageMode) layout = pageLayout();
    else {
      const visible = design.viewports.filter((viewport) => !ctx.hidden.has(viewport.id));
      const rows = design.kind === 'page' ? [{ id: null, title: design.title }] : design.screens.map((screen) => ({ id: screen.id, title: screen.title, ...(screen.viewports ? { viewports: screen.viewports } : {}) }));
      const wall = layoutWall(rows, visible);
      layout = {
        boards: wall.artboards.map((cell) => ({
          id: cell.id,
          screen: cell.screen === null ? null : (design.screens.find((screen) => screen.id === cell.screen) ?? null),
          viewport: cell.viewport,
          rect: toRect(cell.frame),
          cell,
        })),
        bounds: wall.bounds ? toRect(wall.bounds) : { x: 0, y: 0, w: 0, h: 0 },
      };
    }
    const keep = new Set(layout.boards.map((art) => art.id));
    for (const [id, board] of boards) {
      if (!keep.has(id)) {
        if (popovers.current()?.board === board) popovers.close();
        disposeBoard(board);
        boards.delete(id);
      }
    }
    for (const art of layout.boards) {
      const existing = boards.get(art.id);
      if (existing) {
        const resized = existing.art.rect.w !== art.rect.w || existing.art.rect.h !== art.rect.h;
        existing.art = art;
        sizeBoard(existing);
        // A page frame just reflows at its new size, like a resized browser tab.
        if (resized && !pageMode) void load(existing);
      } else boards.set(art.id, makeBoard(art));
    }
    for (const board of boards.values()) paint(board);
  };

  // ---------------------------------------------------------------- loading

  async function load(board: Board): Promise<void> {
    if (!board.live) return;
    const file = ctx.fileOf(board.screenId);
    // Pins belong to the artboard's own screen: none while play mode shows another one.
    board.tracker.setComments(board.screenId === (board.art.screen?.id ?? null) ? ctx.commentsOf(board.art) : []);
    paint(board);
    const tasks = [board.main.load(board.screenId, ctx.compare ? null : ctx.version, file)];
    if (ctx.compare && ctx.version !== null) tasks.push(ensureCompare(board).load(board.screenId, ctx.version, file));
    else dropCompare(board);
    board.root.dataset.compare = ctx.compare && ctx.version !== null ? 'true' : 'false';
    await Promise.all(tasks);
    paint(board);
  }

  const syncLive = (): void => {
    syncQueued = false;
    if (ctx.disposed || ctx.surfaceSize.w === 0) return;
    const live = new Set(liveBoards([...boards.values()].map((board) => ({ id: board.art.id, rect: board.art.rect })), camera.get(), ctx.surfaceSize, ctx.liveBudget, FRAME_UNLOAD_MARGIN).map((entry) => entry.id));
    for (const board of boards.values()) {
      const shouldLive = live.has(board.art.id);
      if (shouldLive && !board.live) {
        board.live = true;
        paint(board);
        if (board.main.state() === 'idle') void load(board);
      } else if (!shouldLive && board.live) {
        board.live = false;
        board.main.unload();
        board.compare?.unload();
        board.placements = [];
        paint(board);
      }
    }
  };

  const reset = (board: Board): void => {
    board.screenId = board.art.screen?.id ?? null;
    board.scroll = { x: 0, y: 0 };
    void load(board);
  };

  return {
    values,
    at: (point: Point) => boardAt(camera.get(), [...boards.values()].map((entry) => ({ rect: entry.art.rect, board: entry })), point)?.board ?? null,
    get: (id) => boards.get(id),
    first: () => boards.values().next().value,
    forComment: (comment) =>
      layout.boards.map((art) => boards.get(art.id)).find((candidate) => candidate && candidate.art.screen?.id === (comment.screen ?? undefined) && candidate.art.viewport.id === comment.viewport) ??
      [...boards.values()].find((candidate) => comment.screen === null && candidate.art.viewport.id === comment.viewport),
    bounds: () => layout.bounds,
    rebuild,
    load,
    reset,
    paint,
    paintLabel,
    placeLabels: () => {
      for (const board of boards.values()) placeLabel(board);
    },
    markRecent: (sources) => {
      recent = sources;
    },
    recent: () => recent,
    queueSync: () => {
      if (syncQueued) return;
      syncQueued = true;
      requestAnimationFrame(syncLive);
    },
    dispose: () => {
      for (const board of boards.values()) disposeBoard(board);
      boards.clear();
    },
  };
};
