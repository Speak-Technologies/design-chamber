// Links a design to the chat that carries its chip, from the session events OpenChamber posts
// (`POST /session-events`). This is how a design started with `/design` or `/page` in a chat with
// no project gets its chat: OpenChamber keeps such chats in its own folder
// (`~/.config/openchamber/chats/<date>/session-<id>`), which is not a project, so no guest's
// `onSessions(projectId)` lists them and the guest reconciliation (`src/guest/flows.ts`) never sees
// them. It runs for every chat, with a project or not, and with no Design Chamber window open.
//
// The evidence is the chip, never timing (the dropped U4b rule): OpenChamber stores a chip the user
// sent as a linked item `guest:<providerId>:<chip id>` and lists it in every event's `linked`. A
// design is linked only while it has no chat, and never moved from one chat to another; the guest
// reconciliation keeps the job of repairing a link to a chat that is gone.

import type { GuestSessionLinkedItem } from '@openchamber/sdk';

import { SLUG_PATTERN, TURN_EVENT_QUEUE_MAX } from '../shared/limits.ts';
import { CHIP_PROVIDER_ID } from '../shared/types.ts';
import type { DesignIndex, DesignRecord, DesignStore, Logger } from './context.ts';
import { ApiError } from './http.ts';

/** How OpenChamber names our chip among a chat's linked items (`buildChip` makes the id `design:<slug>`). */
const CHIP_LINK_PREFIX = `guest:${CHIP_PROVIDER_ID}:design:`;

/** Design chips read from one event; a chat carries one or two in practice. */
export const LINKED_CHIPS_MAX = 16;

/** The part of a session event this module reads. */
export type LinkEvent = { session: { id: string; parentId: string | null }; linked: readonly GuestSessionLinkedItem[] };

/** The slugs of our design chips on a chat, valid and unique, at most `LINKED_CHIPS_MAX`. */
export const chipSlugsOf = (linked: readonly GuestSessionLinkedItem[]): string[] => {
  const slugs: string[] = [];
  for (const item of linked) {
    if (item.kind !== 'guest' || !item.id.startsWith(CHIP_LINK_PREFIX)) continue;
    const slug = item.id.slice(CHIP_LINK_PREFIX.length);
    if (!SLUG_PATTERN.test(slug) || slugs.includes(slug)) continue;
    slugs.push(slug);
    if (slugs.length === LINKED_CHIPS_MAX) break;
  }
  return slugs;
};

export type SessionLinksDeps = {
  store: Pick<DesignStore, 'get' | 'patch'>;
  index: Pick<DesignIndex, 'get'>;
  log: Logger;
};

export type SessionLinks = {
  /** Queue an accepted event; never throws, never waits. */
  take(event: LinkEvent): void;
  /** Settles once the queue is empty (tests and shutdown). */
  idle(): Promise<void>;
  /** Drop pending work and stop. */
  dispose(): void;
};

export const createSessionLinks = ({ store, index, log }: SessionLinksDeps): SessionLinks => {
  // Per chat, the chip slugs of its latest event, in arrival order; one worker drains it.
  const pending = new Map<string, string[]>();
  let running: Promise<void> | null = null;
  let disposed = false;

  const linkOne = async (sessionId: string, slug: string): Promise<void> => {
    // A design the index already shows linked costs no disk read.
    const known = index.get(slug);
    if (known !== null && known.sessionId !== null) return;
    let current: DesignRecord;
    try {
      current = await store.get(slug);
    } catch (error) {
      // The chip outlived its design (deleted or renamed): nothing to link.
      if (error instanceof ApiError && (error.code === 'not-found' || error.code === 'bad-slug')) return;
      throw error;
    }
    if (current.design.sessionId !== null) return;
    // Two writers can race here only with another explicit link, and every one of them (the
    // New dialog, Continue in chat, guest reconciliation) also writes a chat that carries this
    // chip, so whichever lands last the design is linked to a chat the user sent it in.
    await store.patch(slug, { sessionId });
    log.info('session-links.linked', { slug, sessionPrefix: sessionId.slice(0, 8) });
  };

  const drain = async (): Promise<void> => {
    while (!disposed) {
      const next = pending.entries().next();
      if (next.done) return;
      const [sessionId, slugs] = next.value;
      pending.delete(sessionId);
      for (const slug of slugs) {
        if (disposed) return;
        try {
          await linkOne(sessionId, slug);
        } catch (error) {
          // One design failing must not stop the others; the chat's next event tries again.
          log.warn('session-links.failed', { slug, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  };

  const start = (): void => {
    if (running !== null || disposed) return;
    running = drain().finally(() => {
      running = null;
      if (pending.size > 0) start();
    });
  };

  return {
    take(event) {
      if (disposed || event.session.parentId !== null) return; // a subagent's chat is not the user's
      const slugs = chipSlugsOf(event.linked);
      if (slugs.length === 0) return;
      // The latest event wins for its chat; re-inserting keeps the order fair.
      pending.delete(event.session.id);
      pending.set(event.session.id, slugs);
      if (pending.size > TURN_EVENT_QUEUE_MAX) {
        const oldest = pending.keys().next();
        if (!oldest.done) pending.delete(oldest.value);
        log.warn('session-links.queue-full', { dropped: 1 });
      }
      start();
    },
    async idle() {
      while (running !== null) await running;
    },
    dispose() {
      disposed = true;
      pending.clear();
    },
  };
};
