// What each linked agent is doing, from session events (documentation/specs/phase-1-5-sdk-2-7.md
// §3.4, §U4.2): `turn-started` → working, `turn-finished` → done, `turn-failed` → failed. In memory
// only; a restart forgets it and the next event fills it again.
//
// Bounded: at most `ACTIVITY_SESSIONS_MAX` sessions (events arrive from every project), the oldest
// `at` dropped to make room. A `working` entry with no event for `ACTIVITY_WORKING_EXPIRY_MS` reads
// as unknown, because a turn the user stopped emits nothing and would otherwise look busy forever.

import { ACTIVITY_SESSIONS_MAX, ACTIVITY_WORKING_EXPIRY_MS, PROJECT_DIRECTORY_MAX } from '../shared/limits.ts';
import type { ActivityTracker, SessionActivity, TurnEventType } from './context.ts';

const STATE_OF: Readonly<Record<TurnEventType, SessionActivity['state']>> = {
  'turn-started': 'working',
  'turn-finished': 'done',
  'turn-failed': 'failed',
};

export type ActivityTrackerOptions = {
  /** Clock for the working expiry (test seam); `Date.now` outside tests. */
  now?: () => number;
};

export const createActivityTracker = ({ now = Date.now }: ActivityTrackerOptions = {}): ActivityTracker => {
  const sessions = new Map<string, SessionActivity>();

  const expired = (entry: SessionActivity): boolean => entry.state === 'working' && now() - entry.at > ACTIVITY_WORKING_EXPIRY_MS;

  const dropOldest = (): void => {
    let oldest: SessionActivity | null = null;
    for (const entry of sessions.values()) if (oldest === null || entry.at < oldest.at) oldest = entry;
    if (oldest !== null) sessions.delete(oldest.sessionId);
  };

  return {
    record({ sessionId, type, at: reported, directory }) {
      // The host stamps every event; a missing or broken stamp counts as now, so it still expires.
      const at = Number.isFinite(reported) ? reported : now();
      const previous = sessions.get(sessionId);
      // Events come in order, but a coalesced or retried one may be older than what we hold.
      if (previous && at < previous.at) return;
      if (!previous && sessions.size >= ACTIVITY_SESSIONS_MAX) dropOldest();
      // A path longer than any real one is not a directory a status row could match; keep nothing.
      const kept = directory !== null && directory.length <= PROJECT_DIRECTORY_MAX ? directory : null;
      sessions.set(sessionId, { sessionId, state: STATE_OF[type], at, directory: kept });
    },

    of(sessionId) {
      const entry = sessions.get(sessionId);
      return entry === undefined || expired(entry) ? null : entry;
    },

    working() {
      return [...sessions.values()].filter((entry) => entry.state === 'working' && !expired(entry));
    },
  };
};
