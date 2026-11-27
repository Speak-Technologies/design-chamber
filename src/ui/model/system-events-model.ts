// Which change events a system view reads again on (system-builder-depth T21). A board comment's event
// (`systemChange: 'comments'`) changes nothing a system, its board or its list row shows, so only the comments are read
// again on it. Pure.

type EventLike = { kind: string; system?: string | undefined; systemChange?: string | undefined };
type BatchLike = { reset: boolean; events: readonly EventLike[] };

/** A board comment was added, changed, deleted or marked sent. Nothing drawn changed, so nothing else needs reading. */
export const isBoardCommentsEvent = (event: EventLike): boolean => event.kind === 'system' && event.systemChange === 'comments';

/** The systems list reads again on a system or root change, but not on a comment: a comment changes no row. */
export const systemsListShouldRefresh = (batch: BatchLike): boolean =>
  batch.reset || batch.events.some((event) => (event.kind === 'system' && !isBoardCommentsEvent(event)) || event.kind === 'root');

/** This system's comments changed (or the feed restarted, so anything may have). */
export const boardCommentsChanged = (batch: BatchLike, systemId: string): boolean =>
  batch.reset || batch.events.some((event) => event.system === systemId && isBoardCommentsEvent(event));

/** The system page reads the system again for anything of its own but comments, which it reads on their own. */
export const systemDetailChanged = (batch: BatchLike, systemId: string): boolean =>
  batch.reset || batch.events.some((event) => event.system === systemId && !isBoardCommentsEvent(event));
