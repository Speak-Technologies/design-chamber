// What the rail and the page tell the service the user has open (use-the-project spec §2.4), as pure
// decisions: which screen and viewport count as "the one in view", and which parts of an element selection
// may leave the panel. The wiring is components/view-report.ts; the timing is guest/view-report.ts.
//
// The service refuses a whole report when its screen or viewport is not one the design has (400), so
// every id is checked against the design here: a screen the agent just deleted must not make the next
// report fail and leave the user looking like they have nothing open.

import type { ViewState } from '../../guest/view-report.ts';
import type { AskElement } from '../../shared/api.ts';
import type { BridgeMode } from '../../shared/bridge-protocol.ts';
import { PAGE_FILL_VIEWPORT_ID } from '../../shared/limits.ts';

/** The artboard the user last focused (a label press, a pin's thread): a screen of a canvas at one of its viewports. */
export type ViewFocus = { screen: string | null; viewport: string };

/** What the wall knows about the open design. `selection` is the element the comment composer is open on. */
export type WallViewFacts = {
  slug: string;
  /** A page design (one frame shown like a browser tab) rather than a canvas wall. */
  isPage: boolean;
  mode: BridgeMode;
  /** A page's "View": `PAGE_FILL_VIEWPORT_ID` or a viewport id. */
  pageView: string;
  screenIds: readonly string[];
  viewportIds: readonly string[];
  focus: ViewFocus | null;
  selection: Pick<AskElement, 'screen' | 'viewport' | 'anchor'> | null;
};

const known = (id: string | null, ids: readonly string[]): id is string => id !== null && ids.includes(id);

/**
 * The report for an open design. A page has no screens and shows one viewport (`pageView`). A canvas shows
 * the selected element's screen and viewport, else the last focused artboard, else its only screen.
 * There is no selection in Play mode (the wall does not select there), and none whose screen is gone.
 */
export const viewStateOf = (facts: WallViewFacts): ViewState => {
  const { slug, mode } = facts;
  const selectionPlace = facts.selection && mode === 'edit' ? facts.selection : null;
  // Only the selector and the clipped text leave the panel: not the opening tag, the rect or the comment.
  const selection = selectionPlace && (facts.isPage || known(selectionPlace.screen, facts.screenIds)) ? { selector: selectionPlace.anchor.selector, text: selectionPlace.anchor.text } : null;

  if (facts.isPage) {
    const viewport = facts.pageView === PAGE_FILL_VIEWPORT_ID || facts.viewportIds.includes(facts.pageView) ? facts.pageView : PAGE_FILL_VIEWPORT_ID;
    return { slug, screen: null, viewport, mode, selection };
  }

  const place = selection ? selectionPlace : facts.focus;
  const screen = known(place?.screen ?? null, facts.screenIds) ? (place?.screen ?? null) : facts.screenIds.length === 1 ? (facts.screenIds[0] ?? null) : null;
  const viewport = place && known(place.viewport, facts.viewportIds) ? place.viewport : null;
  return { slug, screen, viewport, mode, selection };
};

/**
 * One line to the console the first time a report fails, then silence: a report is a hint the next change or
 * heartbeat repeats, so the user never sees an error for it. The returned sender always resolves.
 */
export const quietSender = <B>(send: (body: B) => Promise<unknown>, warn: (message: string) => void): ((body: B) => Promise<void>) => {
  let warned = false;
  return async (body) => {
    try {
      await send(body);
    } catch (error) {
      if (warned) return;
      warned = true;
      warn(`Design Chamber: could not tell the service what is open (${error instanceof Error ? error.message : 'unknown error'}); trying again on the next change.`);
    }
  };
};
