// Links a design to the chat that carries its chip, from the session events OpenChamber posts
// (`POST /session-events`). This is how a design started with `/design` or `/page` in a chat with
// no project gets its chat: OpenChamber keeps such chats in its own folder
// (`~/.config/openchamber/chats/<date>/session-<id>`), which is not a project, so no guest's
// `onSessions(projectId)` lists them and the guest reconciliation (`src/guest/flows.ts`) never sees
// them. It runs for every chat, with a project or not, and with no Design Chamber window open.
//
// The evidence is the chip, never timing (the dropped U4b rule): OpenChamber stores a chip the user
// sent as a linked item `guest:<providerId>:<chip id>` with the chip's URL, and lists it in every
// event's `linked`. The URL carries the design's marker (its created time, `markChipUrl`), so a chip
// left on an old chat by a deleted design never claims a new design that reuses the slug; a chip
// without a marker (made before markers) links nothing. A design is linked only while it has no
// chat, under its lock (`store.linkIfUnlinked`), and never moved from one chat to another; the guest
// reconciliation keeps the job of repairing a link to a chat that is gone.

import { chipMarkerInUrl } from '../shared/agent/chip.ts';
import { SLUG_PATTERN, TURN_EVENT_QUEUE_MAX } from '../shared/limits.ts';
import { CHIP_PROVIDER_ID } from '../shared/types.ts';
import type { DesignIndex, DesignStore, Logger } from './context.ts';
import { ApiError } from './http.ts';

/** How OpenChamber names our chip among a chat's linked items (`buildChip` makes the id `design:<slug>`). */
const CHIP_LINK_PREFIX = `guest:${CHIP_PROVIDER_ID}:design:`;

/** Design chips read from one event; a chat carries one or two in practice. */
export const LINKED_CHIPS_MAX = 16;

/**
 * The part of a session event this module reads. `linked` is `unknown[]`: the SDK reader checks the
 * list is an array, not what is in it, so every item is checked here.
 */
export type LinkEvent = { session: { id: string; parentId: string | null }; linked: readonly unknown[] };

/** One of our design chips on a chat: the design's slug and the marker of the design it was made for. */
export type ChipRef = { slug: string; marker: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Our marked design chips on a chat: valid slugs, once each, at most `LINKED_CHIPS_MAX`. Anything else is skipped. */
export const chipsOf = (linked: readonly unknown[]): ChipRef[] => {
  const chips: ChipRef[] = [];
  for (const item of linked) {
    if (!isRecord(item) || item.kind !== 'guest' || typeof item.id !== 'string' || typeof item.url !== 'string') continue;
    if (!item.id.startsWith(CHIP_LINK_PREFIX)) continue;
    const slug = item.id.slice(CHIP_LINK_PREFIX.length);
    const marker = chipMarkerInUrl(item.url);
    if (marker === null || !SLUG_PATTERN.test(slug) || chips.some((chip) => chip.slug === slug)) continue;
    chips.push({ slug, marker });
    if (chips.length === LINKED_CHIPS_MAX) break;
  }
  return chips;
};

export type SessionLinksDeps = {
  store: Pick<DesignStore, 'linkIfUnlinked'>;
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
  // Per chat, the chips of its latest event, in arrival order; one worker drains it.
  const pending = new Map<string, ChipRef[]>();
  let running: Promise<void> | null = null;
  let disposed = false;

  const linkOne = async (sessionId: string, chip: ChipRef): Promise<void> => {
    // A design the index already shows linked costs no disk read.
    const known = index.get(chip.slug);
    if (known !== null && known.sessionId !== null) return;
    try {
      const outcome = await store.linkIfUnlinked(chip.slug, sessionId, chip.marker);
      if (outcome === 'linked') log.info('session-links.linked', { slug: chip.slug, sessionPrefix: sessionId.slice(0, 8) });
    } catch (error) {
      // The chip outlived its design (deleted or renamed): nothing to link.
      if (error instanceof ApiError && (error.code === 'not-found' || error.code === 'bad-slug')) return;
      throw error;
    }
  };

  const drain = async (): Promise<void> => {
    while (!disposed) {
      const next = pending.entries().next();
      if (next.done) return;
      const [sessionId, chips] = next.value;
      pending.delete(sessionId);
      for (const chip of chips) {
        if (disposed) return;
        try {
          await linkOne(sessionId, chip);
        } catch (error) {
          // One design failing must not stop the others; the chat's next event tries again.
          log.warn('session-links.failed', { slug: chip.slug, error: error instanceof Error ? error.message : String(error) });
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
      let chips: ChipRef[];
      try {
        chips = chipsOf(event.linked);
      } catch (error) {
        // Not expected (every item is checked), but the route relies on take never throwing:
        // a link lost here must not cost the turn its snapshot.
        log.warn('session-links.take-failed', { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (chips.length === 0) return;
      // The latest event wins for its chat; re-inserting keeps the order fair.
      pending.delete(event.session.id);
      pending.set(event.session.id, chips);
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
