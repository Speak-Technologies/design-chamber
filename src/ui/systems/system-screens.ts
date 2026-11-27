// The Screens view of one design system (system-builder-depth T13): every screen in `system.json` `screens`, at each
// of its sizes, on a wall you pan and zoom like a canvas. Each artboard is the same sandboxed frame a design screen
// uses (`createFrameSlot`, `sandbox="allow-scripts"`, never `allow-same-origin`), fed by the system screens route; the
// wall's own pan and zoom maths (`guest/camera.ts`) and key table (`wallKeyAction`) drive the camera. The canvas wall
// itself (`createWall`) is not reused: it is bound to a design's detail, comments and edits.
//
// The frames take no pointer input (the wall's `.dc-frame` rule): a drag anywhere pans, a plain wheel pans, Ctrl or Cmd
// with the wheel zooms. In the rail the view starts as a list of screens; a row shows that one screen at its sizes.
// Nothing here writes a file.

import { mountSpinner } from '@openchamber/sdk/ui';

import { artboardIdOf } from '../../shared/bridge-protocol.ts';
import { ARTBOARD_LABEL_HEIGHT, FRAME_UNLOAD_MARGIN, PAGE_LIVE_FRAMES_MAX, RAIL_LIVE_FRAMES_MAX, WALL_GAP } from '../../shared/limits.ts';
import type { SystemDetail } from '../../shared/types.ts';
import { DEFAULT_CAMERA, ZOOM_STEP, fitBox, panBy, wheelZoom, zoomAt, type Camera } from '../../guest/camera.ts';
import { append, h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import { btn, iconBtn } from '../components/kit.ts';
import { client, host } from '../guest.ts';
import { wallKeyAction } from '../model/wall-input.ts';
import { liveBoards } from '../model/wall-model.ts';
import {
  SCREENS_EMPTY,
  SCREENS_RAIL_HINT,
  SCREEN_GONE,
  SCREEN_KIND_LABEL,
  bestWrap,
  boardScheme,
  cellsOf,
  screenRowLabel,
  screenRowMeta,
  screenWall,
  viewportText,
  zoomText,
  type ScreenCell,
  type ScreenWall,
} from '../model/system-page-model.ts';
import { createFrameSlot, type FrameSlot } from '../wall/frame-slot.ts';

export type ScreensHandle = {
  el: HTMLElement;
  /** The system as it loaded last (`null` while it loads). A change to the list of screens lays the wall out again. */
  setDetail: (detail: SystemDetail | null) => void;
  /** Draw every loaded screen again (an agent turn changed the files, a restore). */
  reload: () => void;
  /** Show an old version of the system (read only), or the live one with `null`. */
  setVersion: (versionId: string | null) => void;
  /** The view is on screen (`true`) or the board is (`false`, every frame is let go). */
  setActive: (active: boolean) => void;
  focus: () => void;
  dispose: () => void;
};

export type ScreensOptions = {
  id: string;
  compact: boolean;
  /** "Back to the board" in the empty state. */
  onBoard: () => void;
};

type Cell = {
  art: ScreenCell;
  root: HTMLElement;
  label: HTMLElement;
  placeholder: HTMLElement;
  slot: FrameSlot | null;
  live: boolean;
};

/** Screen px from the label's bottom edge to the frame's top. */
const LABEL_LIFT = 4;
/** A row's label hides when the gap above it is narrower than this on screen (the first row's always stays). */
const LABEL_ROOM_MIN = 20;
const SYNC_MS = 120;
/**
 * Room between rows, world px. Wider than a canvas's gap: a system's screens are fitted many rows at once on the page, and
 * at that zoom a canvas gap leaves no room for the next row's label (four rows in a 600 px stage keep about 27 px).
 */
const ROW_GAP = 160;
const FIT_PADDING_PAGE = 48;
/** Screen px under which a placeholder drops its sentences. */
const TINY_WIDTH = 150;
const FIT_PADDING_RAIL = 12;

const structureOf = (detail: SystemDetail | null): string =>
  detail === null ? '' : JSON.stringify([detail.screens.map((screen) => [screen.id, screen.title, screen.kind, screen.viewports, screen.problem]), detail.viewports]);

export const mountSystemScreens = (options: ScreensOptions): ScreensHandle => {
  const { id, compact } = options;
  let detail: SystemDetail | null = null;
  let structure = '';
  let wall: ScreenWall = { cells: [], bounds: null };
  /** The line width the page's wall flows at (`bestWrap` for the stage's shape); the rail shows one screen, so 0. */
  let wrap = 0;
  let cells: Cell[] = [];
  let camera: Camera = { ...DEFAULT_CAMERA };
  let userMoved = false;
  let size = { w: 0, h: 0 };
  let version: string | null = null;
  let scheme = boardScheme(host.snapshot()?.theme.mode);
  let active = false;
  /** The rail shows one screen at a time; `null` is its list. The page always shows every screen. */
  let picked: string | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let drag: { pointer: number; x: number; y: number } | null = null;
  let disposed = false;

  const count = h('span', { class: 'dc-sysscr-count dc-muted' });
  const zoomLabel = btn({ label: '100%', variant: 'ghost', size: 'xs', title: 'Reset zoom to 100% (Shift+0)', onClick: () => setCamera(zoomAt(camera, 1, centre()), true) });
  zoomLabel.el.classList.add('dc-zoom-label');
  const zoomGroup = h(
    'div',
    { class: 'dc-group', role: 'group', 'aria-label': 'Zoom' },
    iconBtn({ icon: 'minus', label: 'Zoom out', size: 'sm', onClick: () => zoomStep(1 / ZOOM_STEP) }),
    zoomLabel.el,
    iconBtn({ icon: 'plus', label: 'Zoom in', size: 'sm', onClick: () => zoomStep(ZOOM_STEP) }),
    // The rail is short of width: Fit keeps its icon and tooltip, so the screen's name has the room.
    compact ? iconBtn({ icon: 'fit', label: 'Fit the screen (Shift+1)', size: 'sm', onClick: () => fit() }) : btn({ label: 'Fit', variant: 'ghost', size: 'xs', icon: 'fit', title: 'Fit every screen (Shift+1)', onClick: () => fit() }).el,
  );
  const back = btn({ label: 'All screens', variant: 'ghost', size: 'xs', icon: 'back', onClick: () => pick(null) });
  const bar = h('div', { class: 'dc-sysscr-bar' }, back.el, count, zoomGroup);

  const world = h('div', { class: 'dc-wall-world' });
  const labels = h('div', { class: 'dc-wall-labels' });
  const surface = h(
    'div',
    {
      class: 'dc-wall dc-sysscr-wall',
      tabindex: '0',
      role: 'application',
      'aria-roledescription': 'screens wall',
      'aria-label': 'Screens of this design system. Arrow keys pan, plus and minus zoom, Shift+1 fits every screen.',
    },
    world,
    labels,
  );
  const list = h('ul', { class: 'dc-sysscr-list', role: 'list', 'aria-label': 'Screens' });
  const listWrap = h('div', { class: 'dc-sysscr-listwrap' }, list, h('p', { class: 'dc-muted dc-sysscr-hint' }, SCREENS_RAIL_HINT));
  const message = h('div', { class: 'dc-sysscr-message' });
  const el = h('div', { class: 'dc-sysscr', 'data-surface': compact ? 'panel' : 'page', 'data-state': 'loading', hidden: true }, bar, surface, listWrap, message);

  // ------------------------------------------------------------ camera
  const centre = (): { x: number; y: number } => ({ x: size.w / 2, y: size.h / 2 });
  const shown = (): ScreenCell[] => cellsOf(wall, compact ? picked : null);
  const boundsOf = (arts: readonly ScreenCell[]): { x: number; y: number; width: number; height: number } | null => {
    if (arts.length === 0) return null;
    const left = Math.min(...arts.map((art) => art.rect.x));
    const top = Math.min(...arts.map((art) => art.rect.y));
    const right = Math.max(...arts.map((art) => art.rect.x + art.rect.w));
    const bottom = Math.max(...arts.map((art) => art.rect.y + art.rect.h));
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const fitView = (): Camera => {
    const bounds = boundsOf(shown());
    if (bounds === null || size.w === 0 || size.h === 0) return { ...DEFAULT_CAMERA };
    return fitBox(bounds, { width: size.w, height: size.h }, { padding: compact ? FIT_PADDING_RAIL : FIT_PADDING_PAGE });
  };

  const placeLabels = (): void => {
    for (const cell of cells) {
      const { frame } = cell.art;
      const x = camera.x + frame.x * camera.scale;
      const y = camera.y + frame.y * camera.scale;
      const crowded = frame.y > ARTBOARD_LABEL_HEIGHT && (ARTBOARD_LABEL_HEIGHT + ROW_GAP) * camera.scale < LABEL_ROOM_MIN;
      cell.label.hidden = crowded || cell.root.hidden;
      cell.label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - LABEL_LIFT - 22)}px)`;
      cell.label.style.width = `${Math.max(0, Math.min(frame.w * camera.scale, size.w - x - 8))}px`;
      // Too small on screen for a sentence: the placeholder keeps its icon (and Try again), the label and tooltip the words.
      cell.root.dataset.tiny = String(frame.w * camera.scale < TINY_WIDTH);
    }
  };

  const apply = (): void => {
    world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    surface.style.setProperty('--dc-inv', String(1 / camera.scale));
    surface.style.setProperty('--dc-scale', String(camera.scale));
    surface.style.setProperty('--dc-grid', `${Math.max(8, 24 * camera.scale)}px`);
    surface.style.setProperty('--dc-grid-x', `${camera.x}px`);
    surface.style.setProperty('--dc-grid-y', `${camera.y}px`);
    surface.dataset.dense = camera.scale < 0.3 ? 'true' : 'false';
    zoomLabel.set({ label: zoomText(camera.scale) });
    placeLabels();
    queueSync();
  };

  function setCamera(next: Camera, user: boolean): void {
    camera = next;
    if (user) userMoved = true;
    apply();
  }
  function zoomStep(factor: number): void {
    setCamera(zoomAt(camera, camera.scale * factor, centre()), true);
  }
  function fit(): void {
    userMoved = false;
    camera = fitView();
    apply();
  }

  // ------------------------------------------------------------ layout
  const layoutOptions = { gap: WALL_GAP, rowGap: ROW_GAP, labelHeight: ARTBOARD_LABEL_HEIGHT };
  const wrapFor = (): number => (compact || detail === null ? 0 : bestWrap(detail.screens, detail.viewports, layoutOptions, size));
  const layOut = (): void => {
    wall = detail === null ? { cells: [], bounds: null } : screenWall(detail.screens, detail.viewports, { ...layoutOptions, wrap });
  };
  /** The stage changed shape and the user hasn't moved the camera: flow the screens for the new shape, frames kept. */
  const reflow = (): void => {
    const next = wrapFor();
    if (next === wrap) return;
    wrap = next;
    layOut();
    const byId = new Map(wall.cells.map((art) => [art.id, art]));
    for (const cell of cells) {
      const art = byId.get(cell.art.id);
      if (!art) continue;
      cell.art = art;
      cell.root.style.transform = `translate(${art.frame.x}px, ${art.frame.y}px)`;
    }
  };

  // ------------------------------------------------------------ frames
  const paintPlaceholder = (cell: Cell): void => {
    const state = cell.art.problem !== null ? 'problem' : !cell.live ? 'paused' : (cell.slot?.state() ?? 'idle');
    cell.root.dataset.state = state === 'ready' ? 'ready' : state === 'problem' || state === 'paused' ? 'idle' : state;
    cell.placeholder.replaceChildren();
    const inner = h('div', { class: 'dc-placeholder-inner' });
    const retry = (): HTMLElement => btn({ label: 'Try again', variant: 'outline', size: 'sm', onClick: () => void loadCell(cell) }).el;
    if (state === 'problem') {
      append(inner, icon('warning', 20), h('p', { class: 'dc-placeholder-title' }, 'This screen can’t be shown'), h('p', { class: 'dc-placeholder-sub' }, `${cell.art.problem ?? ''} Ask the agent to fix it.`));
    } else if (state === 'paused') {
      append(inner, icon('layers', 20), h('p', { class: 'dc-placeholder-title' }, 'Paused'), h('p', { class: 'dc-placeholder-sub' }, 'Not loaded. Pan here to load it.'));
    } else if (state === 'idle' || state === 'loading') {
      mountSpinner(inner, { label: `Loading ${cell.art.title}…` });
    } else if (state === 'missing') {
      append(inner, icon('layers', 20), h('p', { class: 'dc-placeholder-title' }, SCREEN_GONE), h('p', { class: 'dc-placeholder-sub' }, cell.slot?.error() ?? ''), retry());
    } else if (state === 'error') {
      append(inner, icon('warning', 20), h('p', { class: 'dc-placeholder-title' }, 'This screen didn’t load'), h('p', { class: 'dc-placeholder-sub' }, cell.slot?.error() ?? 'Try again in a moment.'), retry());
    }
    cell.placeholder.append(inner);
  };

  const slotFor = (cell: Cell): FrameSlot => {
    if (cell.slot) return cell.slot;
    const slot = createFrameSlot({
      // No token preview and no saved page data: a system screen wears only its own tokens.css.
      slug: `system-screen:${id}`,
      loadDoc: (_screen, versionId) => client.systemScreen(id, cell.art.screen, { version: versionId, scheme }),
      artboardId: artboardIdOf(cell.art.screen, cell.art.viewport.id),
      title: `${cell.art.title} at ${viewportText(cell.art.viewport)}`,
      mode: () => 'edit',
      scroll: () => ({ x: 0, y: 0 }),
      onState: () => paintPlaceholder(cell),
    });
    // The design frame CSS pins a light scheme; a system screen follows the host's, so its own dark values answer.
    slot.iframe.style.colorScheme = scheme;
    cell.root.prepend(slot.iframe);
    cell.slot = slot;
    return slot;
  };

  async function loadCell(cell: Cell): Promise<void> {
    if (cell.art.problem !== null || !cell.live) return;
    await slotFor(cell).load(cell.art.screen, version, `screens/${cell.art.screen}.html`);
  }

  const sync = (): void => {
    syncTimer = null;
    if (disposed || !active || size.w === 0) return;
    const visible = new Set(cellsOf(wall, compact ? picked : null).map((art) => art.id));
    const candidates = cells.filter((cell) => visible.has(cell.art.id) && cell.art.problem === null).map((cell) => ({ cell, id: cell.art.id, rect: cell.art.rect }));
    const live = new Set(liveBoards(candidates, camera, size, compact ? RAIL_LIVE_FRAMES_MAX : PAGE_LIVE_FRAMES_MAX, FRAME_UNLOAD_MARGIN).map((entry) => entry.id));
    for (const cell of cells) {
      const next = live.has(cell.art.id);
      if (next === cell.live) continue;
      cell.live = next;
      if (next) void loadCell(cell);
      else {
        cell.slot?.unload();
        paintPlaceholder(cell);
      }
    }
  };
  function queueSync(): void {
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, SYNC_MS);
  }

  const dropCells = (): void => {
    for (const cell of cells) {
      cell.slot?.dispose();
      cell.root.remove();
      cell.label.remove();
    }
    cells = [];
  };

  const buildCells = (): void => {
    dropCells();
    for (const art of wall.cells) {
      const placeholder = h('div', { class: 'dc-placeholder' });
      const root = h('div', { class: 'dc-board dc-sysscr-board', 'data-board': art.id, 'data-state': 'idle' }, placeholder);
      root.style.transform = `translate(${art.frame.x}px, ${art.frame.y}px)`;
      root.style.width = `${art.frame.w}px`;
      root.style.height = `${art.frame.h}px`;
      root.style.colorScheme = scheme;
      const label = h(
        'div',
        { class: 'dc-label', title: `${art.title} · ${SCREEN_KIND_LABEL[art.kind]} · ${viewportText(art.viewport)}` },
        h('span', { class: 'dc-label-text' }, h('span', { class: 'dc-label-name' }, art.title), h('span', { class: 'dc-label-sep', 'aria-hidden': 'true' }, '·'), h('span', { class: 'dc-label-dims' }, viewportText(art.viewport))),
      );
      const cell: Cell = { art, root, label, placeholder, slot: null, live: false };
      world.append(root);
      labels.append(label);
      cells.push(cell);
      paintPlaceholder(cell);
    }
  };

  // ------------------------------------------------------------ the list (rail) and the states
  const paintList = (): void => {
    list.replaceChildren();
    if (!detail) return;
    for (const screen of detail.screens) {
      list.append(
        h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'dc-sysscr-row', 'data-screen': screen.id, 'aria-label': screenRowLabel(screen, detail.viewports), onClick: () => pick(screen.id) },
            h('span', { class: 'dc-sysscr-row-name' }, screen.title),
            h('span', { class: 'dc-sysscr-row-meta dc-muted' }, screen.problem === null ? screenRowMeta(screen, detail.viewports) : screen.problem),
            screen.problem === null ? null : h('span', { class: 'dc-sysscr-row-flag' }, icon('warning', 14)),
          ),
        ),
      );
    }
  };

  const paint = (): void => {
    const screens = detail?.screens ?? [];
    const state = detail === null ? 'loading' : screens.length === 0 ? 'empty' : 'ready';
    el.dataset.state = state;
    const listing = compact && picked === null && state === 'ready';
    el.dataset.view = listing ? 'list' : 'wall';
    message.replaceChildren();
    if (state === 'loading') mountSpinner(message, { label: 'Loading the screens…' });
    else if (state === 'empty') {
      message.append(h('p', { class: 'dc-sys-board-message' }, SCREENS_EMPTY), btn({ label: 'Back to the board', variant: 'outline', size: 'sm', onClick: () => options.onBoard() }).el);
    }
    const pickedScreen = picked === null ? null : screens.find((screen) => screen.id === picked);
    back.el.hidden = !compact || picked === null;
    count.textContent = pickedScreen ? pickedScreen.title : screens.length === 1 ? '1 screen' : `${screens.length} screens`;
    bar.hidden = state !== 'ready' || listing;
    for (const cell of cells) cell.root.hidden = compact && cell.art.screen !== picked;
  };

  function pick(screen: string | null): void {
    picked = screen;
    paint();
    if (screen !== null) {
      userMoved = false;
      requestAnimationFrame(() => {
        if (disposed) return;
        measure();
        fit();
        surface.focus();
      });
    } else {
      for (const cell of cells) {
        cell.live = false;
        cell.slot?.unload();
        paintPlaceholder(cell);
      }
      list.querySelector<HTMLElement>('.dc-sysscr-row')?.focus();
    }
  }

  // ------------------------------------------------------------ input
  surface.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    // A placeholder's Try again is a real button: capturing the pointer would send its click to the wall instead.
    if (event.target instanceof Element && event.target.closest('button') !== null) return;
    surface.focus();
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
    surface.setPointerCapture(event.pointerId);
    surface.dataset.panning = 'true';
  });
  surface.addEventListener('pointermove', (event) => {
    if (drag === null || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag = { ...drag, x: event.clientX, y: event.clientY };
    setCamera(panBy(camera, dx, dy), true);
  });
  const endDrag = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointer) return;
    drag = null;
    delete surface.dataset.panning;
  };
  surface.addEventListener('pointerup', endDrag);
  surface.addEventListener('pointercancel', endDrag);
  surface.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) setCamera(wheelZoom(camera, event.deltaY, { x: event.clientX - rect.left, y: event.clientY - rect.top }), true);
      else setCamera(panBy(camera, -event.deltaX, -event.deltaY), true);
    },
    { passive: false },
  );
  surface.addEventListener('keydown', (event) => {
    const action = wallKeyAction({ key: event.key, code: event.code, shift: event.shiftKey, pageMode: false, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey });
    if (action === null) return;
    if (action.type === 'zoom') zoomStep(action.factor);
    else if (action.type === 'zoom-reset') setCamera(zoomAt(camera, 1, centre()), true);
    else if (action.type === 'fit') fit();
    else if (action.type === 'pan') setCamera(panBy(camera, action.dx, action.dy), true);
    else if (action.type === 'escape' && compact && picked !== null) pick(null);
    else return;
    event.preventDefault();
  });

  const measure = (): void => {
    const rect = surface.getBoundingClientRect();
    size = { w: Math.round(rect.width), h: Math.round(rect.height) };
  };
  const observer = new ResizeObserver(() => {
    measure();
    if (size.w === 0 || size.h === 0) return;
    if (!userMoved) {
      reflow();
      camera = fitView();
    }
    apply();
  });
  observer.observe(surface);

  // The scheme follows the host: a switch draws every loaded screen again in the other one.
  const stopReady = host.onReady((context) => {
    const next = boardScheme(context.theme.mode);
    if (next === scheme) return;
    scheme = next;
    for (const cell of cells) {
      cell.root.style.colorScheme = scheme;
      if (cell.slot) cell.slot.iframe.style.colorScheme = scheme;
      if (cell.live) void loadCell(cell);
    }
  });

  const reloadLive = (): void => {
    for (const cell of cells) if (cell.live) void loadCell(cell);
  };

  paint();

  return {
    el,
    setDetail: (next) => {
      detail = next;
      const nextStructure = structureOf(next);
      if (nextStructure !== structure) {
        structure = nextStructure;
        wrap = wrapFor();
        layOut();
        if (picked !== null && !(next?.screens.some((screen) => screen.id === picked) ?? false)) picked = null;
        buildCells();
        if (!userMoved) camera = fitView();
        paintList();
        paint();
        apply();
      } else {
        paintList();
        paint();
      }
    },
    reload: reloadLive,
    setVersion: (next) => {
      if (next === version) return;
      version = next;
      reloadLive();
    },
    setActive: (next) => {
      if (next === active) return;
      active = next;
      el.hidden = !next;
      if (next) {
        requestAnimationFrame(() => {
          if (disposed) return;
          measure();
          if (!userMoved) {
            reflow();
            camera = fitView();
          }
          apply();
        });
        return;
      }
      for (const cell of cells) {
        cell.live = false;
        cell.slot?.unload();
        paintPlaceholder(cell);
      }
    },
    focus: () => (el.dataset.view === 'list' ? list.querySelector<HTMLElement>('.dc-sysscr-row') : surface)?.focus(),
    dispose: () => {
      disposed = true;
      if (syncTimer !== null) clearTimeout(syncTimer);
      observer.disconnect();
      stopReady();
      dropCells();
      el.remove();
    },
  };
};
