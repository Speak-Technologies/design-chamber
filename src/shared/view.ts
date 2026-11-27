// What the user has open (documentation/specs/use-the-project-and-native-agent.md §2.4): the one
// small record the rail and the page report to `PUT /view`, which the service writes to `view.json`
// beside settings.json and the agent's `dc read` reads. Pure and free of Node imports, so the
// service, the guest reporter and the CLI agree on the shape, the caps and the freshness rule.
//
// No file content and no comment text ever goes in: a design's slug and title, the screen and
// viewport ids, the mode, and the one element the user has selected (a selector and a short text).

/** `view.json`, beside `settings.json` in Design Chamber's app-data folder (not in the designs root, which may be synced). */
export const VIEW_FILE = 'view.json';

export const VIEW_FILE_VERSION = 1;

/** `selection.selector` and `selection.text` caps (the same sizes as a check finding's selector and an anchor's text). */
export const VIEW_SELECTOR_MAX = 300;
export const VIEW_SELECTION_TEXT_MAX = 120;

/** The guest waits this long after the last change before it reports (a quick click through screens sends one). */
export const VIEW_REPORT_DEBOUNCE_MS = 500;
/** While the surface is visible the guest repeats the last report this often, so the file stays fresh. */
export const VIEW_HEARTBEAT_MS = 60_000;
/** The reader treats a file older than this as "nothing open". */
export const VIEW_STALE_MS = 180_000;

/** The service writes a changed report at most this often; a faster one is held and written once the gap has passed. */
export const VIEW_WRITE_MIN_GAP_MS = 250;
/** An unchanged report only refreshes `at`, and at most this often (the heartbeat is 60 s, the stale limit 180 s). */
export const VIEW_AT_REFRESH_MS = 10_000;

export type ViewSurface = 'rail' | 'page';
export type ViewMode = 'edit' | 'play';
export type ViewSelection = { selector: string; text: string };

/** One report, as the service stores it. `slug` null is the list, a system page or nothing open; every other field is then null. */
export type ViewFile = {
  v: typeof VIEW_FILE_VERSION;
  /** ISO time of the last report the service accepted. */
  at: string;
  surface: ViewSurface;
  slug: string | null;
  /** The design's title when the report was written. */
  title: string | null;
  /** Canvas screen id; null for a page and when none is focused. */
  screen: string | null;
  /** A viewport id or `PAGE_FILL_VIEWPORT_ID`. */
  viewport: string | null;
  mode: ViewMode | null;
  selection: ViewSelection | null;
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f  ]+/g;

/** One line of at most `max` characters: control characters and whitespace runs become one space, then trimmed and cut. */
export const clipViewText = (text: string, max: number): string => {
  const flat = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

/** Whether `view` is recent enough to say what the user has open (a clock far in the future counts as stale too). */
export const isViewFresh = (view: Pick<ViewFile, 'at'>, nowMs: number): boolean => {
  const at = Date.parse(view.at);
  return Number.isFinite(at) && Math.abs(nowMs - at) <= VIEW_STALE_MS;
};
