// Tells the service what this frame has open, so the user's agent can answer "this one" (use-the-project
// spec §2.4). The rail and the page each start one reporter when they mount (a frame is one surface);
// place memory reports the open design and the list, the wall reports the screen, viewport, mode and
// selection. Always on, and a failed report is never shown (model/view-report-model.ts `quietSender`).

import { attachViewReporter, createViewReporter, type ViewReporter, type ViewState } from '../../guest/view-report.ts';
import { client } from '../guest.ts';
import type { PlaceSurface } from '../model/place-model.ts';
import { quietSender } from '../model/view-report-model.ts';

let reporter: ViewReporter | null = null;
/** The wall's last report, so coming back to the design (a system page closed) repeats it whole. */
let lastWall: ViewState | null = null;

/** Start this frame's reporter; returns the undo (the apps never call it, a test does). */
export const startViewReport = (surface: PlaceSurface): (() => void) => {
  reporter?.dispose();
  const next = createViewReporter({
    surface: surface === 'panel' ? 'rail' : 'page',
    send: quietSender((body) => client.call('PUT /view', { body }), (message) => console.warn(message)),
    isVisible: () => document.visibilityState === 'visible',
  });
  reporter = next;
  lastWall = null;
  const detach = attachViewReporter(next, window);
  return () => {
    detach();
    next.dispose();
    if (reporter === next) reporter = null;
  };
};

/** A design opened (its wall is still loading, so only the slug is known yet). */
export const reportOpen = (slug: string): void => {
  lastWall = null;
  reporter?.report({ slug });
};

/** The design is on top again (a system page or a build closed over it): repeat what its wall last said. */
export const reportReturn = (slug: string): void => reporter?.report(lastWall?.slug === slug ? lastWall : { slug });

/** The list, a system page or a build is what is on screen. */
export const reportNothingOpen = (): void => reporter?.report({ slug: null });

/** The wall of the open design says what is in view now. */
export const reportWall = (state: ViewState): void => {
  lastWall = state;
  reporter?.report(state);
};
