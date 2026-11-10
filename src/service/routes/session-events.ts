// POST /session-events (documentation/specs/phase-1-5-sdk-2-7.md §U4.2): OpenChamber posts every
// event Design Chamber subscribed to, from every project, with the service bearer (checked by the
// router like every route). The body is read with the SDK's own reader; anything it refuses is
// HTTP 400. An event of a type or shape we do not act on is answered `{ ok: true }` and dropped:
// it is not an error, and an error answer would make the host back off for 30 s.
//
// The answer goes out before any work: `turnEvents.take` only queues. Nothing of the event is
// logged beyond its type and the first 8 characters of the session id.

import { readSessionEventRequest } from '@openchamber/sdk';

import type { SessionEventsResponse } from '../../shared/api.ts';
import { SESSION_ID_MAX } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { isTurnEventType, type TurnEvents } from '../turn-events.ts';

/** Printable, no control characters, 1 to `SESSION_ID_MAX` characters. */
const isSessionId = (value: string): boolean => value.length >= 1 && value.length <= SESSION_ID_MAX && !/[\u0000-\u001f\u007f]/.test(value);

/**
 * Registers:
 * - 'POST /session-events'
 */
export function registerSessionEventsRoutes(router: Router, _ctx: ServiceContext, turnEvents: TurnEvents): void {
  router.on('POST /session-events', ({ body }): SessionEventsResponse => {
    // The router already parsed the JSON; the SDK reader takes the text.
    const request = body === undefined ? null : readSessionEventRequest(JSON.stringify(body));
    if (request === null) throw new ApiError('bad-request', 'That is not a session event Design Chamber can read.');
    const { event } = request;
    if (!isTurnEventType(event.type) || !isSessionId(event.session.id)) return { ok: true };
    turnEvents.take({ ...event, type: event.type });
    return { ok: true };
  });
}
