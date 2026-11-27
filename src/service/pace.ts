// Quiet mode for the resident service (documentation/specs/native-extras.md §4.3). With
// `keepRunning` the service is up for as long as OpenChamber is, so after QUIET_AFTER_MS with no
// frame asking for `GET /changes` (a visible one asks every 15 s) it trims the two things that
// cost while nobody looks: the watcher's backstop poll runs every WATCH_POLL_QUIET_MS and the
// render cache is dropped. fs.watch stays on, so changes still arrive at once. The next request
// goes back to the active pace and polls every design once for anything fs.watch dropped.
//
// No timer of its own: going quiet is decided on the watcher's poll tick.

import { QUIET_AFTER_MS, WATCH_POLL_MS, WATCH_POLL_QUIET_MS } from '../shared/limits.ts';
import type { Logger, Pace } from './context.ts';
import type { Watcher } from './watch.ts';

export type PaceOptions = {
  watcher: Pick<Watcher, 'onTick' | 'setPollMs' | 'pollNow'>;
  /** The render service: its documents are rebuilt when a frame asks again. */
  renders: { dropAll(): void };
  log: Logger;
  now?: () => number;
};

export const createPace = ({ watcher, renders, log, now = Date.now }: PaceOptions): Pace => {
  // The start counts as a request: a service no window ever asks goes quiet 10 minutes after it.
  let touched = now();
  let quiet = false;

  watcher.onTick(() => {
    if (quiet || now() - touched < QUIET_AFTER_MS) return;
    quiet = true;
    watcher.setPollMs(WATCH_POLL_QUIET_MS);
    renders.dropAll();
    log.info('pace.quiet');
  });

  return {
    touch() {
      touched = now();
      if (!quiet) return;
      quiet = false;
      watcher.setPollMs(WATCH_POLL_MS);
      // Not awaited: what it finds reaches the caller's long-poll through the change hub.
      watcher.pollNow({ all: true }).catch((error: unknown) => log.warn('pace.wake-poll-failed', { error: error instanceof Error ? error.message : String(error) }));
      log.info('pace.active');
    },
  };
};
