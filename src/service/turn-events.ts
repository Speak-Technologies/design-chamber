// The work behind `POST /session-events` (documentation/specs/phase-1-5-sdk-2-7.md §U4.2,
// docs/SPEC.md §9.11): the route answers at once and hands each accepted event to `take`; one
// serial worker records the activity, emits an `activity` change per linked design and, after a
// finished or failed turn, takes a turn snapshot of every design linked to that chat.
//
// Events come from every project, so most are not ours. A subagent's event is dropped in `take`
// (its parent's `turn-finished` follows it). For the rest, the in-memory design index decides:
// a session no design is linked to never reaches the disk. The queue holds at most
// `TURN_EVENT_QUEUE_MAX` sessions; a newer event for a session already waiting replaces it in
// place (keeping a pending snapshot), and a full queue drops its oldest entry with one warning.
//
// The event may itself have started the service (a turn longer than the 10-minute idle stop), so
// the index may still be loading. The worker waits up to `DESIGN_INDEX_TURN_WAIT_MS` for it, on
// its own timer as well as the index's; past that, a finished or failed turn calls
// `versions.turn`, which lists the store itself: one disk walk instead of a lost snapshot.
//
// `versions.turn` dedupes a session within `TURN_SNAPSHOT_DEDUPE_MS` and skips unchanged trees,
// so the open page's own turn snapshot (docs/SPEC.md §10.6) and this one make one version.
// Nothing of an event is logged beyond its type and the first 8 characters of its session id.

import type { GuestSessionEventRequest } from '@openchamber/sdk';

import { DESIGN_INDEX_TURN_WAIT_MS, TURN_EVENT_QUEUE_MAX } from '../shared/limits.ts';
import type { ActivityTracker, ChangeHub, DesignIndex, LogFields, Logger, TurnEventType } from './context.ts';
import type { VersionsService } from './versions.ts';

/** The event types Design Chamber subscribes to; must match the manifest's `contributes.sessionEvents.events`. */
export const TURN_EVENT_TYPES: readonly TurnEventType[] = ['turn-started', 'turn-finished', 'turn-failed'];

export const isTurnEventType = (value: string): value is TurnEventType => (TURN_EVENT_TYPES as readonly string[]).includes(value);

/** One host event, as the SDK reader returns it (identifiers only: no `content` is subscribed). */
export type SessionEvent = GuestSessionEventRequest['event'];

export type TurnEvent = SessionEvent & { type: TurnEventType };

export type TurnEventsDeps = {
  index: DesignIndex;
  versions: Pick<VersionsService, 'turn'>;
  activity: ActivityTracker;
  hub: Pick<ChangeHub, 'emit'>;
  log: Logger;
  /** How long the worker waits for the index (test seam); `DESIGN_INDEX_TURN_WAIT_MS` outside tests. */
  indexWaitMs?: number;
};

export type TurnEvents = {
  /** Queue an accepted event; never throws, never waits. */
  take(event: TurnEvent): void;
  /** Settles once the queue is empty (tests and shutdown). */
  idle(): Promise<void>;
  /** Drop pending work and stop. */
  dispose(): void;
};

/** One waiting session: its newest event, and whether any event folded into it ended a turn. */
type Pending = { event: TurnEvent; snapshot: boolean };

const endsTurn = (type: TurnEventType): boolean => type === 'turn-finished' || type === 'turn-failed';

/** What a log line may say about an event. */
const logFieldsOf = (event: TurnEvent): LogFields => ({ type: event.type, sessionPrefix: event.session.id.slice(0, 8) });

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const createTurnEvents = ({ index, versions, activity, hub, log, indexWaitMs = DESIGN_INDEX_TURN_WAIT_MS }: TurnEventsDeps): TurnEvents => {
  // Insertion order is queue order; updating an existing key keeps its place.
  const queue = new Map<string, Pending>();
  let disposed = false;
  let pumping = false;
  let current: Promise<void> = Promise.resolve();
  let overflowWarned = false;
  let cancelWait: (() => void) | null = null;

  /** `true` when the index has loaded; `false` after `indexWaitMs` or on dispose, even if the index never answers. */
  const waitForIndex = (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (loaded: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        cancelWait = null;
        resolve(loaded);
      };
      timer = setTimeout(() => finish(false), indexWaitMs);
      cancelWait = () => finish(false);
      index.ready(indexWaitMs).then(finish, () => finish(false));
    });

  const snapshot = async (event: TurnEvent): Promise<void> => {
    try {
      await versions.turn(event.session.id);
    } catch (error) {
      log.warn('turn-events.snapshot-failed', { ...logFieldsOf(event), error: messageOf(error) });
    }
  };

  const handle = async ({ event, snapshot: endedTurn }: Pending): Promise<void> => {
    const sessionId = event.session.id;
    activity.record({ sessionId, type: event.type, at: event.at, directory: event.project.directory });
    const loaded = await waitForIndex();
    if (disposed) return;
    if (!loaded) {
      // Cold start: no slugs known, so no activity changes; the snapshot lists the store itself.
      log.info('turn-events.index-not-ready', logFieldsOf(event));
      if (endedTurn) await snapshot(event);
      return;
    }
    const slugs = index.bySession(sessionId);
    if (slugs.length === 0) return; // not linked to any design: nothing touches the disk
    for (const slug of slugs) hub.emit({ slug, kind: 'activity' });
    if (endedTurn) await snapshot(event);
  };

  const pump = (): void => {
    if (pumping || disposed) return;
    pumping = true;
    current = (async () => {
      try {
        while (!disposed) {
          const next = queue.entries().next();
          if (next.done) break;
          const [sessionId, pending] = next.value;
          queue.delete(sessionId);
          try {
            await handle(pending);
          } catch (error) {
            log.error('turn-events.event-failed', { ...logFieldsOf(pending.event), error: messageOf(error) });
          }
        }
      } finally {
        // Same synchronous step as the empty-queue check above, so a `take` never finds the
        // worker both busy and about to stop.
        pumping = false;
        overflowWarned = false;
      }
    })();
  };

  return {
    take(event) {
      if (disposed) return;
      if (event.session.parentId !== null) return; // a subagent: its parent's turn-finished follows
      const sessionId = event.session.id;
      const waiting = queue.get(sessionId);
      if (waiting) {
        waiting.event = event;
        waiting.snapshot ||= endsTurn(event.type);
      } else {
        if (queue.size >= TURN_EVENT_QUEUE_MAX) {
          const oldest = queue.keys().next();
          if (!oldest.done) queue.delete(oldest.value);
          if (!overflowWarned) {
            overflowWarned = true;
            log.warn('turn-events.queue-full', { max: TURN_EVENT_QUEUE_MAX });
          }
        }
        queue.set(sessionId, { event, snapshot: endsTurn(event.type) });
      }
      pump();
    },

    async idle() {
      while (pumping) await current;
    },

    dispose() {
      disposed = true;
      queue.clear();
      cancelWait?.();
    },
  };
};
