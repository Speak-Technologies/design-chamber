// POST /session-events (documentation/specs/phase-1-5-sdk-2-7.md §U4.2): OpenChamber posts every
// event Design Chamber subscribed to, from every project, with the service bearer (checked by the
// router like every route). The body is read with the SDK's own reader; anything it refuses is
// HTTP 400. An event of a type or shape we do not act on is answered `{ ok: true }` and dropped:
// it is not an error, and an error answer would make the host back off for 30 s.
//
// The answer goes out before any work: `links.take` and `turnEvents.take` only queue. Nothing of
// the event is logged beyond its type, the first 8 characters of the session id and, when a design
// gets linked, that design's slug.

import { readSessionEventRequest } from '@openchamber/sdk';

import type { SessionEventsResponse } from '../../shared/api.ts';
import { SESSION_ID_MAX } from '../../shared/limits.ts';
import type { ServiceContext } from '../context.ts';
import { ApiError, type Router } from '../http.ts';
import { createSessionLinks, type SessionLinks } from '../session-links.ts';
import { isTurnEventType, type TurnEvents } from '../turn-events.ts';

/** Printable, no control characters, 1 to `SESSION_ID_MAX` characters. */
const isSessionId = (value: string): boolean => value.length >= 1 && value.length <= SESSION_ID_MAX && !/[\u0000-\u001f\u007f]/.test(value);

/** The context's linker, stopped with the service (shutdown waits for a link write in flight). */
export const sessionLinksOf = (ctx: ServiceContext): SessionLinks => {
  const links = createSessionLinks({ store: ctx.store, index: ctx.designIndex, log: ctx.log });
  ctx.onDispose(async () => {
    links.dispose();
    await links.idle();
  });
  return links;
};

/**
 * Registers:
 * - 'POST /session-events'
 *
 * `links` defaults to the context's linker (a chat that carries a design's chip gets the design
 * linked, project or not, session-links.ts); only that default reads `ctx`, so a test can pass its
 * own linker with an empty context.
 */
export function registerSessionEventsRoutes(router: Router, ctx: ServiceContext, turnEvents: TurnEvents, links: Pick<SessionLinks, 'take'> = sessionLinksOf(ctx)): void {
  router.on('POST /session-events', ({ body }): SessionEventsResponse => {
    // The router already parsed the JSON; the SDK reader takes the text.
    const request = body === undefined ? null : readSessionEventRequest(JSON.stringify(body));
    if (request === null) throw new ApiError('bad-request', 'That is not a session event Design Chamber can read.');
    const { event } = request;
    if (!isTurnEventType(event.type) || !isSessionId(event.session.id)) return { ok: true };
    // Linking first: on `turn-started` it lands before the turn ends, so that turn's snapshot finds it.
    // `take` never throws (it checks every item and logs its own failures), so the turn always reaches its queue.
    links.take(event);
    turnEvents.take({ ...event, type: event.type });
    return { ok: true };
  });
}
