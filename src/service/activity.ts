// What each linked agent is doing, from session events (documentation/specs/phase-1-5-sdk-2-7.md
// §3.4, §U4.2). Seam stub: remembers nothing yet, so Work Status shows no agent state. The
// turn-events branch (U4) fills it: `turn-started` → working, `turn-finished` → done,
// `turn-failed` → failed, at most `ACTIVITY_SESSIONS_MAX` sessions, `working` expiring after
// `ACTIVITY_WORKING_EXPIRY_MS`.

import type { ActivityTracker } from './context.ts';

export const createActivityTracker = (): ActivityTracker => ({
  record: () => undefined,
  of: () => null,
  working: () => [],
});
