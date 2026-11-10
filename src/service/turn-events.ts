// The work behind `POST /session-events` (documentation/specs/phase-1-5-sdk-2-7.md §U4.2): the
// route answers at once and hands each accepted event to `take`; a serial queue records the
// activity, emits `activity` change events and takes a turn snapshot of every linked design.
//
// Seam stub: `take` does nothing yet. The turn-events branch (U4) fills it (queue bound
// `TURN_EVENT_QUEUE_MAX`, subagent skip, the index wait and the `versions.turn` fallback).

import type { GuestSessionEventRequest } from '@openchamber/sdk';

import type { ActivityTracker, ChangeHub, DesignIndex, Logger, TurnEventType } from './context.ts';
import type { VersionsService } from './versions.ts';

/** The event types Design Chamber subscribes to; must match the manifest's `contributes.sessionEvents.events`. */
export const TURN_EVENT_TYPES: readonly TurnEventType[] = ['turn-started', 'turn-finished', 'turn-failed'];

export const isTurnEventType = (value: string): value is TurnEventType => (TURN_EVENT_TYPES as readonly string[]).includes(value);

/** One host event, as the SDK reader returns it (identifiers only: no `content` is subscribed). */
export type SessionEvent = GuestSessionEventRequest['event'];

export type TurnEventsDeps = {
  index: DesignIndex;
  versions: Pick<VersionsService, 'turn'>;
  activity: ActivityTracker;
  hub: Pick<ChangeHub, 'emit'>;
  log: Logger;
};

export type TurnEvents = {
  /** Queue an accepted event; never throws, never waits. */
  take(event: SessionEvent & { type: TurnEventType }): void;
  /** Settles once the queue is empty (tests and shutdown). */
  idle(): Promise<void>;
  /** Drop pending work and stop. */
  dispose(): void;
};

export const createTurnEvents = (_deps: TurnEventsDeps): TurnEvents => ({
  take: () => undefined,
  idle: async () => undefined,
  dispose: () => undefined,
});
