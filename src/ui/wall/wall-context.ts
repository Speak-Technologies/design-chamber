// The wall's shared state and read-only helpers. Every controller in `src/ui/wall/` receives one
// `WallContext`: the DOM roots, the options, the design data and the view flags (mode, version,
// pins shown, page view), plus small getters derived from them. The context holds state;
// controllers hold behaviour and never reach into each other's fields.
//
// Also here: `late`, the one-slot hook that lets `createWall` hand a controller something that is
// built after it (the wiring has a few such cycles; module imports never do).

import { commentsForArtboard } from '../../guest/anchoring.ts';
import type { DesignDetailResponse } from '../../shared/api.ts';
import type { BridgeMode } from '../../shared/bridge-protocol.ts';
import { PAGE_FILL_VIEWPORT_ID, PAGE_LIVE_FRAMES_MAX, RAIL_LIVE_FRAMES_MAX } from '../../shared/limits.ts';
import type { Comment, Screen, Viewport } from '../../shared/types.ts';
import { createScope, h, type Scope } from '../components/dom.ts';
import { pinNumbers } from '../model/comments-model.ts';
import { pageComments, type Point } from '../model/wall-model.ts';
import { frameModeOf } from '../model/wall-input.ts';
import type { Artboard, WallOptions } from './wall-types.ts';

export type WallContext = {
  readonly options: WallOptions;
  readonly pageMode: boolean;
  /** How many artboards may hold a loaded frame at once. */
  readonly liveBudget: number;
  readonly scope: Scope;
  readonly surface: HTMLElement;
  readonly world: HTMLElement;
  readonly labels: HTMLElement;
  readonly overlay: HTMLElement;

  // Mutable view state. Controllers read it freely; the wall handle and the owning controller write it.
  detail: DesignDetailResponse;
  mode: BridgeMode;
  hidden: Set<string>;
  pageView: string;
  /** The saved version on show (read only), or null for the current design. */
  version: string | null;
  /** Split each artboard: the saved version left, the current design right. */
  compare: boolean;
  showPins: boolean;
  /** The inline text editor is open: the wall ignores presses and hover until it closes (the editor handles click-away itself). */
  editing: boolean;
  disposed: boolean;
  /** The surface's size in CSS px; the camera controller keeps it current. */
  surfaceSize: { w: number; h: number };

  readOnly: () => boolean;
  /** The mode a frame runs in: a saved version is always Play. */
  frameMode: () => BridgeMode;
  comments: () => readonly Comment[];
  numbers: () => Map<string, number>;
  commentsOf: (art: Artboard) => Comment[];
  screens: () => readonly Screen[];
  fileOf: (screenId: string | null) => string;
  /** The viewport a page view shows; null for Full width or a viewport the design no longer has. */
  pageViewport: () => Viewport | null;
  size: () => { width: number; height: number };
  surfaceRect: () => DOMRect;
  /** A pointer event's position in surface px. */
  local: (event: { clientX: number; clientY: number }) => Point;
  /** A pin's diameter on screen (CSS `--dc-pin`); it stays the same at every zoom. */
  pinSize: () => number;
};

export const createWallContext = (options: WallOptions, initialDetail: DesignDetailResponse): WallContext => {
  const pageMode = options.presentation === 'page';
  const mode: BridgeMode = 'edit';
  const world = h('div', { class: 'dc-wall-world' });
  const labels = h('div', { class: 'dc-wall-labels' });
  const overlay = h('div', { class: 'dc-wall-overlay' });
  const surface = h(
    'div',
    {
      class: 'dc-wall',
      tabindex: '0',
      role: 'application',
      'aria-roledescription': pageMode ? 'page preview' : 'canvas wall',
      'aria-label': pageMode ? 'Page preview. Arrow keys, Page Up and Page Down scroll the page.' : 'Design wall. Arrow keys pan, plus and minus zoom, Shift+1 fits everything. Hold Space and drag to pan.',
      'data-mode': mode,
      'data-presentation': options.presentation,
    },
    world,
    labels,
    overlay,
  );

  const ctx: WallContext = {
    options,
    pageMode,
    liveBudget: options.compact ? RAIL_LIVE_FRAMES_MAX : PAGE_LIVE_FRAMES_MAX,
    scope: createScope(),
    surface,
    world,
    labels,
    overlay,
    detail: initialDetail,
    mode,
    hidden: new Set<string>(),
    pageView: options.initialPageView ?? PAGE_FILL_VIEWPORT_ID,
    version: null,
    compare: false,
    showPins: true,
    editing: false,
    disposed: false,
    surfaceSize: { w: 0, h: 0 },

    readOnly: () => ctx.version !== null,
    frameMode: () => frameModeOf(ctx.mode, ctx.readOnly()),
    comments: () => ctx.detail.design.comments,
    numbers: () => pinNumbers(ctx.comments()),
    // A page shows every comment in every view: the bridge re-finds each element in the current layout.
    commentsOf: (art) => (pageMode ? pageComments(ctx.comments()) : commentsForArtboard(ctx.comments(), art.screen?.id ?? null, art.viewport.id)),
    screens: () => ctx.detail.design.screens,
    fileOf: (screenId) =>
      screenId === null ? (ctx.detail.design.entry ?? 'index.html') : (ctx.screens().find((s) => s.id === screenId)?.file ?? `screens/${screenId}.html`),
    pageViewport: () => (ctx.pageView === PAGE_FILL_VIEWPORT_ID ? null : (ctx.detail.design.viewports.find((viewport) => viewport.id === ctx.pageView) ?? null)),
    size: () => ({ width: ctx.surfaceSize.w, height: ctx.surfaceSize.h }),
    surfaceRect: () => surface.getBoundingClientRect(),
    local: (event) => {
      const rect = ctx.surfaceRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    pinSize: () => (options.compact ? 18 : 24),
  };
  return ctx;
};

/** A hook for something built after the controller that needs it. Calling it before `bind` throws. */
export type Late<T> = { (): T; bind: (value: T) => void };

export const late = <T>(name: string): Late<T> => {
  let bound: { value: T } | null = null;
  const get = (): T => {
    if (!bound) throw new Error(`The wall used ${name} before it was wired up.`);
    return bound.value;
  };
  return Object.assign(get, {
    bind: (value: T): void => {
      bound = { value };
    },
  });
};
