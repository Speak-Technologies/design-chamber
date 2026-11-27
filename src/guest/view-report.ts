// Tells the service what this surface has open, so the agent can know (documentation/specs/
// use-the-project-and-native-agent.md §2.4). The rail and the page each make one reporter and call
// `report` wherever the open design, screen, viewport, mode or selected element changes; this module
// owns the timing: one request 500 ms after the last change, a repeat every 60 s while the surface is
// visible (the service treats a record older than 3 minutes as "nothing open"), and `slug: null` when
// the surface goes away. It carries ids, a selector and a short text, never file content or comments.
//
// A report is a hint, so a failed request is dropped: the next change or heartbeat sends the state
// again, and nothing in the UI waits for it.

import type { ViewBody } from '../shared/api.ts';
import {
  clipViewText,
  VIEW_HEARTBEAT_MS,
  VIEW_REPORT_DEBOUNCE_MS,
  VIEW_SELECTION_TEXT_MAX,
  VIEW_SELECTOR_MAX,
  type ViewMode,
  type ViewSurface,
} from '../shared/view.ts';

/** What a caller reports; the surface is the reporter's. `slug` null is the list, a system page or nothing open. */
export type ViewState = {
  slug: string | null;
  screen?: string | null;
  viewport?: string | null;
  mode?: ViewMode | null;
  selection?: { selector: string; text: string } | null;
};

export type ViewReporterTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type ViewReporterOptions = {
  surface: ViewSurface;
  /** `(body) => client.call('PUT /view', { body })`. */
  send: (body: ViewBody) => Promise<unknown>;
  /** The heartbeat only runs while this says the surface can be seen. */
  isVisible: () => boolean;
  /** Test seam; defaults to the page's own timers. */
  timers?: ViewReporterTimers;
};

export type ViewReporter = {
  /** The open design changed: send it after the debounce. The same state again sends nothing. */
  report(state: ViewState): void;
  /** The surface is going away (`pagehide`): send `slug: null` now. */
  leave(): void;
  /** The surface can be seen again: send the last state now. */
  resume(): void;
  /** Stop the timers; nothing more is sent. */
  dispose(): void;
};

const pageTimers: ViewReporterTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** The body for a state: a null slug carries nothing else, and the selection is made one line within its caps. */
export const viewBodyOf = (surface: ViewSurface, state: ViewState): ViewBody => {
  if (state.slug === null) return { surface, slug: null };
  const selector = state.selection ? clipViewText(state.selection.selector, VIEW_SELECTOR_MAX) : '';
  return {
    surface,
    slug: state.slug,
    screen: state.screen ?? null,
    viewport: state.viewport ?? null,
    mode: state.mode ?? null,
    selection: state.selection && selector !== '' ? { selector, text: clipViewText(state.selection.text, VIEW_SELECTION_TEXT_MAX) } : null,
  };
};

export const createViewReporter = (options: ViewReporterOptions): ViewReporter => {
  const timers = options.timers ?? pageTimers;
  /** The state to keep reporting; null until the first `report`. */
  let current: ViewBody | null = null;
  /** The body last sent (or on its way), to skip a repeat of the same state. */
  let sent: string | null = null;
  let debounce: unknown = null;
  let disposed = false;

  const cancelDebounce = (): void => {
    if (debounce !== null) timers.clearTimeout(debounce);
    debounce = null;
  };

  const transmit = (body: ViewBody): void => {
    if (disposed) return;
    sent = JSON.stringify(body);
    // Dropped on failure on purpose: see the header.
    options.send(body).catch(() => undefined);
  };

  // A null slug is sent once, on change. Repeating it would let an idle surface on the list overwrite the
  // design another surface has open; the reader's stale rule already reads a missing report as nothing open.
  const heartbeat = timers.setInterval(() => {
    if (current !== null && current.slug !== null && debounce === null && options.isVisible()) transmit(current);
  }, VIEW_HEARTBEAT_MS);

  return {
    report(state) {
      if (disposed) return;
      const body = viewBodyOf(options.surface, state);
      current = body;
      cancelDebounce();
      if (JSON.stringify(body) === sent) return;
      debounce = timers.setTimeout(() => {
        debounce = null;
        transmit(body);
      }, VIEW_REPORT_DEBOUNCE_MS);
    },
    leave() {
      if (disposed) return;
      cancelDebounce();
      transmit({ surface: options.surface, slug: null });
    },
    resume() {
      if (disposed || current === null) return;
      cancelDebounce();
      transmit(current);
    },
    dispose() {
      disposed = true;
      cancelDebounce();
      timers.clearInterval(heartbeat);
    },
  };
};

/** The page events a surface wires its reporter to: `pagehide` leaves, becoming visible again resumes. */
export type ViewReporterWindow = {
  addEventListener(type: 'pagehide' | 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'pagehide' | 'visibilitychange', listener: () => void): void;
  document: { visibilityState: string };
};

/** Wire a reporter to the window; returns the undo. */
export const attachViewReporter = (reporter: ViewReporter, win: ViewReporterWindow): (() => void) => {
  const onPageHide = (): void => reporter.leave();
  const onVisibility = (): void => {
    if (win.document.visibilityState === 'visible') reporter.resume();
  };
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('visibilitychange', onVisibility);
  return () => {
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('visibilitychange', onVisibility);
  };
};
