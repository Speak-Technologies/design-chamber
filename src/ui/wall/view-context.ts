// Seam S9: what a Phase 1 feature gets when the design view mounts it. Each `feature-*.ts` file
// exports `mount(ctx)`, called once after the wall is built, and returns a disposer that runs
// when the view closes. A feature fills a slot, listens, and calls the wall; it never edits
// `design-view.ts` or `wall.ts`.

import type { DesignDetailResponse } from '../../shared/api.ts';
import type { ActionContext } from '../components/actions.ts';
import type { Scope } from '../components/dom.ts';
import type { SheetHandle } from '../components/kit.ts';
import type { NoticesHandle } from '../components/notices.ts';
import type { WallHandle } from './wall.ts';
import type { DirectionKeepPress } from './wall-types.ts';

/** Empty, always-present elements the view lays out for features to fill. */
export type ViewSlots = {
  /** Full-screen toolbar, between the mode controls and the right-hand buttons (grows, may shrink to nothing). */
  statusSlot: HTMLElement;
  /** Over the wall inside the stage (`pointer-events: none`; children opt in), below popovers and sheets. */
  overlay: HTMLElement;
  /** A layout row under the wall, above the page edge; the wall shrinks and refits when it has content. */
  bottomDock: HTMLElement;
  /** Rail header row one, between the title and the menu. Detached on the full-screen page, which has room for full buttons. */
  compactActions: HTMLElement;
  /** Full-screen toolbar, between Comments and Versions: the Tweaks button goes here (empty and out of the layout while it has no content). */
  tweaksSlot: HTMLElement;
};

export type DrawerKind = 'comments' | 'versions' | 'tweaks';

/** What a feature puts in a drawer's sheet: the view opens the sheet, the feature fills it and tears it down. */
export type DrawerContent = { dispose: () => void };

export type ViewContext = {
  slug: string;
  surface: 'panel' | 'page';
  isPage: boolean;
  /** The design as last loaded. */
  detail: () => DesignDetailResponse;
  /** Called after every new answer for this design has reached the view. Returns the unsubscribe function. */
  onDetail: (listener: () => void) => () => void;
  /** The saved version on show (read only), or null for the current design. */
  viewing: () => { id: string; compare: boolean } | null;
  onViewing: (listener: () => void) => () => void;
  wall: WallHandle;
  slots: ViewSlots;
  /**
   * The Comments, Versions and Tweaks drawers (a full-screen sheet in the rail; Tweaks is a bottom sheet there, the wall live above it).
   * `toggle` opens one, or closes it when it is the open one. `register` gives the Tweaks drawer its content (the view builds the sheet).
   */
  drawers: {
    toggle: (kind: DrawerKind) => void;
    active: () => DrawerKind | null;
    onChange: (listener: () => void) => () => void;
    register: (kind: 'tweaks', fill: (sheet: SheetHandle) => DrawerContent) => () => void;
    /** Close whichever drawer is open. */
    close: () => void;
    /** The open drawer is the rail's bottom sheet (wall visible above it). */
    isBottomSheet: () => boolean;
  };
  /**
   * Leaving the design (back, another design): each guard may answer false to keep the user here (Tweaks asks "Save your tweaks?").
   * Returns the function that removes the guard.
   */
  onBeforeLeave: (guard: () => Promise<boolean>) => () => void;
  /** "Keep this one" was pressed on a direction row's board (Phase 2 §6.3). Returns the unsubscribe function. */
  onKeepDirection: (listener: (press: DirectionKeepPress) => void) => () => void;
  /** The aria-live notices region (also a seam: transient notices, S7). */
  notices: NoticesHandle;
  actions: ActionContext;
  /** Disposed with the view. */
  scope: Scope;
};

/** A Phase 1 feature's entry point. The returned function undoes everything the mount did. */
export type FeatureMount = (ctx: ViewContext) => () => void;
