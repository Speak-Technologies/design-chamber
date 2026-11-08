// The wall's camera: the current pan/zoom, whether the user has moved it, the surface size (a
// ResizeObserver keeps it current), the fit rules and the page layout. It writes the transform
// and the zoom CSS variables, and tells the rest of the wall (through `hooks`) when the view
// changed. Page presentation has a fixed camera computed from the stage size instead.

import { DEFAULT_CAMERA, fitArea, fitBox, focusArtboard, zoomAt, type Camera } from '../../guest/camera.ts';
import { debounce } from '../components/dom.ts';
import { PAGE_GUTTER, PAGE_GUTTER_COMPACT, pageCamera } from '../model/wall-model.ts';
import type { Late, WallContext } from './wall-context.ts';
import type { Board, Rect } from './wall-types.ts';

/** What the camera asks of the controllers built after it. */
export type CameraHooks = {
  /** The user moved the view: a card or hover outline anchored to the old one goes. */
  closePopover: () => void;
  clearHover: () => void;
  /** The bounds of everything on the wall, world px. */
  bounds: () => Rect;
  /** Page presentation: size the one frame for the new stage. */
  rebuildLayout: () => void;
  placeLabels: () => void;
  /** Which pins fold into a count depends on the zoom. */
  scaleChanged: (scale: number) => void;
  queueSync: () => void;
};

/** Screen px of the wall that something covers: a drawer on the right today, an ask bar below in Phase 1. */
export type CoveredInsets = { right: number; bottom: number };

export type CameraController = {
  get: () => Camera;
  /** Replace the camera and apply it; `user` marks it as moved by the user (closes cards, stops auto-fit). */
  set: (next: Camera, user: boolean) => void;
  /** Write the current camera to the DOM and tell the host. */
  apply: () => void;
  /** The camera that fits everything (the fixed camera on a page). */
  fitView: () => Camera;
  /** Fit again unless the user moved the camera; says whether it did. Does not apply. */
  quietFit: () => boolean;
  /** Fit everything and forget that the user moved the camera. */
  fit: () => void;
  /** Page presentation: size the frame and place it for the current stage and view. */
  layoutPage: () => void;
  zoomAtCentre: (factor: number) => void;
  zoomReset: () => void;
  /** Centre an artboard in the wall. */
  focusBoard: (board: Board) => void;
  coveredInsets: () => CoveredInsets;
  /** Page presentation: the frame box and camera for the stage size, minus what covers it. */
  pageGeometry: () => ReturnType<typeof pageCamera>;
  dispose: () => void;
};

const SETTLE_MS = 400;
const PAGE_RELAYOUT_MS = 100;

export const createCameraController = (ctx: WallContext, hooks: Late<CameraHooks>): CameraController => {
  const { options, pageMode } = ctx;
  let camera: Camera = options.initialCamera ?? { ...DEFAULT_CAMERA };
  let userMoved = options.initialCamera !== null;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const pageGutter = options.compact ? PAGE_GUTTER_COMPACT : PAGE_GUTTER;

  const coveredInsets = (): CoveredInsets => ({ right: options.coveredRight?.() ?? 0, bottom: 0 });

  const pageGeometry = (): ReturnType<typeof pageCamera> => {
    const insets = coveredInsets();
    return pageCamera({ stageW: ctx.surfaceSize.w - insets.right, stageH: ctx.surfaceSize.h - insets.bottom, frameW: ctx.pageViewport()?.width ?? null, gutter: pageGutter });
  };

  const apply = (): void => {
    const { surface } = ctx;
    ctx.world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    surface.style.setProperty('--dc-inv', String(1 / camera.scale));
    surface.style.setProperty('--dc-scale', String(camera.scale));
    surface.style.setProperty('--dc-grid', `${Math.max(8, 24 * camera.scale)}px`);
    surface.style.setProperty('--dc-grid-x', `${camera.x}px`);
    surface.style.setProperty('--dc-grid-y', `${camera.y}px`);
    surface.dataset.dense = camera.scale < 0.3 ? 'true' : 'false';
    hooks().placeLabels();
    hooks().scaleChanged(camera.scale);
    options.onScale(camera.scale);
    clearTimeout(settleTimer);
    // A page's camera follows the stage size, so there is nothing to remember.
    if (!pageMode) settleTimer = setTimeout(() => options.onCameraSettled(camera), SETTLE_MS);
    hooks().queueSync();
  };

  const set = (next: Camera, user: boolean): void => {
    camera = next;
    if (user) {
      userMoved = true;
      hooks().closePopover();
      hooks().clearHover();
    }
    apply();
  };

  /** Fit everything on the wall; a page takes its fixed camera from the stage size. */
  const fitView = (): Camera => {
    if (pageMode) return pageGeometry().camera;
    const bounds = hooks().bounds();
    const insets = coveredInsets();
    const area = fitArea({ width: ctx.surfaceSize.w, height: ctx.surfaceSize.h - insets.bottom }, insets.right);
    const padding = options.compact ? 16 : area.padding;
    return bounds.w > 0 && bounds.h > 0 ? fitBox({ x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h }, area, { padding }) : { ...DEFAULT_CAMERA };
  };

  const layoutPage = (): void => {
    hooks().rebuildLayout();
    camera = fitView();
    apply();
  };

  const centre = (): { x: number; y: number } => ({ x: ctx.surfaceSize.w / 2, y: ctx.surfaceSize.h / 2 });

  // A page lays out at once on its first real size, then follows resizes after they settle.
  let pageSized = false;
  const layoutPageSoon = debounce(() => {
    if (!ctx.disposed) layoutPage();
  }, PAGE_RELAYOUT_MS);
  const observer = new ResizeObserver(() => {
    const rect = ctx.surfaceRect();
    ctx.surfaceSize = { w: Math.round(rect.width), h: Math.round(rect.height) };
    if (ctx.surfaceSize.w === 0 || ctx.surfaceSize.h === 0) return;
    if (pageMode) {
      if (pageSized) layoutPageSoon();
      else {
        pageSized = true;
        layoutPage();
      }
      return;
    }
    if (!userMoved) camera = fitView();
    apply();
  });
  observer.observe(ctx.surface);
  ctx.scope.add(() => observer.disconnect());

  return {
    get: () => camera,
    set,
    apply,
    fitView,
    quietFit: () => {
      if (userMoved) return false;
      camera = fitView();
      return true;
    },
    fit: () => {
      userMoved = false;
      hooks().closePopover();
      camera = fitView();
      apply();
    },
    layoutPage,
    zoomAtCentre: (factor) => set(zoomAt(camera, camera.scale * factor, centre()), true),
    zoomReset: () => set(zoomAt(camera, 1, centre()), true),
    focusBoard: (board) => set(focusArtboard(board.art.cell, ctx.size(), { padding: options.compact ? 12 : 64 }), true),
    coveredInsets,
    pageGeometry,
    dispose: () => clearTimeout(settleTimer),
  };
};
