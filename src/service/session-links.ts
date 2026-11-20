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
//
// Phase 2.5 (§8.5): a design system's chip (`system:<id>`, `buildSystemChip`) links the system the
// same way: marker-gated (the system's created time), only while its `sessionId` is null, under the
// system's lock, never moved to another chat.
//
// S8 (§2.12): a build chip (`system-build:<ticket>`, `buildSystemBuildChip`) records its chat in the
// ticket the same way: marker-gated (the ticket's created time), only while the ticket has none, on
// the tickets' queue (`builds.linkSession`), so a chat started by Build with the agent… is known
// before the agent's BUILD.json is adopted.

import { chipMarkerInUrl, chipMarkerOf } from '../shared/agent/chip.ts';
import { SLUG_PATTERN, SYSTEM_BUILD_TICKET_PATTERN, SYSTEM_ID_PATTERN, TURN_EVENT_QUEUE_MAX } from '../shared/limits.ts';
import { CHIP_PROVIDER_ID } from '../shared/types.ts';
import type { ChangeHub, DesignIndex, DesignStore, Logger } from './context.ts';
import { ApiError } from './http.ts';
import type { BuildTickets } from './systems/builds.ts';
import type { SystemStore } from './systems/store.ts';

/** How OpenChamber names our chip among a chat's linked items (`buildChip` makes the id `design:<slug>`). */
const CHIP_LINK_PREFIX = `guest:${CHIP_PROVIDER_ID}:design:`;
/** A design system's chip (`buildSystemChip` makes the id `system:<id>`). */
const SYSTEM_CHIP_LINK_PREFIX = `guest:${CHIP_PROVIDER_ID}:system:`;
/** A build chip (`buildSystemBuildChip` makes the id `system-build:<ticket>`). */
const BUILD_CHIP_LINK_PREFIX = `guest:${CHIP_PROVIDER_ID}:system-build:`;

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

/** One of our system chips on a chat: the system's id and the marker of the system it was made for. */
export type SystemChipRef = { system: string; marker: string };

/** Our marked system chips on a chat: valid ids, once each, at most `LINKED_CHIPS_MAX`. Anything else is skipped. */
export const systemChipsOf = (linked: readonly unknown[]): SystemChipRef[] => {
  const chips: SystemChipRef[] = [];
  for (const item of linked) {
    if (!isRecord(item) || item.kind !== 'guest' || typeof item.id !== 'string' || typeof item.url !== 'string') continue;
    if (!item.id.startsWith(SYSTEM_CHIP_LINK_PREFIX)) continue;
    const system = item.id.slice(SYSTEM_CHIP_LINK_PREFIX.length);
    const marker = chipMarkerInUrl(item.url);
    if (marker === null || !SYSTEM_ID_PATTERN.test(system) || chips.some((chip) => chip.system === system)) continue;
    chips.push({ system, marker });
    if (chips.length === LINKED_CHIPS_MAX) break;
  }
  return chips;
};

/** One of our build chips on a chat: the ticket and the marker of the ticket it was made for. */
export type BuildChipRef = { ticket: string; marker: string };

/** Our marked build chips on a chat: valid tickets, once each, at most `LINKED_CHIPS_MAX`. Anything else is skipped. */
export const buildChipsOf = (linked: readonly unknown[]): BuildChipRef[] => {
  const chips: BuildChipRef[] = [];
  for (const item of linked) {
    if (!isRecord(item) || item.kind !== 'guest' || typeof item.id !== 'string' || typeof item.url !== 'string') continue;
    if (!item.id.startsWith(BUILD_CHIP_LINK_PREFIX)) continue;
    const ticket = item.id.slice(BUILD_CHIP_LINK_PREFIX.length);
    const marker = chipMarkerInUrl(item.url);
    if (marker === null || !SYSTEM_BUILD_TICKET_PATTERN.test(ticket) || chips.some((chip) => chip.ticket === ticket)) continue;
    chips.push({ ticket, marker });
    if (chips.length === LINKED_CHIPS_MAX) break;
  }
  return chips;
};

export type SessionLinksDeps = {
  store: Pick<DesignStore, 'linkIfUnlinked'>;
  index: Pick<DesignIndex, 'get'>;
  log: Logger;
  /** Phase 2.5: system chips; absent → system chips are ignored. */
  systems?: { store: Pick<SystemStore, 'index' | 'withLock' | 'updateStateLocked'>; hub: Pick<ChangeHub, 'emit'> };
  /** Phase 2.5 S8: build chips; absent → build chips are ignored. */
  builds?: Pick<BuildTickets, 'linkSession'>;
};

type Work = { designs: ChipRef[]; systems: SystemChipRef[]; builds: BuildChipRef[] };

export type SessionLinks = {
  /** Queue an accepted event; never throws, never waits. */
  take(event: LinkEvent): void;
  /** Settles once the queue is empty (tests and shutdown). */
  idle(): Promise<void>;
  /** Drop pending work and stop. */
  dispose(): void;
};

export const createSessionLinks = ({ store, index, log, systems, builds }: SessionLinksDeps): SessionLinks => {
  // Per chat, the chips of its latest event, in arrival order; one worker drains it.
  const pending = new Map<string, Work>();
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

  /** Link a system to the chat under its lock, only while it has none and only for the system the chip was made for. */
  const linkSystem = async (sessionId: string, chip: SystemChipRef): Promise<void> => {
    if (systems === undefined) return;
    // Only a system the index knows (no disk for an id that is not ours); a linked one stays linked.
    if (!systems.store.index().some((row) => row.id === chip.system)) return;
    let linked = false;
    try {
      await systems.store.withLock(chip.system, () =>
        systems.store.updateStateLocked(chip.system, (state) => {
          if (state.sessionId !== null || chipMarkerOf(state.created) !== chip.marker) return null;
          linked = true;
          return { ...state, sessionId };
        }),
      );
    } catch (error) {
      // The chip outlived its system (deleted): nothing to link.
      if (error instanceof ApiError && (error.code === 'not-found' || error.code === 'bad-slug' || error.code === 'bad-request')) return;
      throw error;
    }
    if (!linked) return;
    systems.hub.emit({ slug: null, kind: 'system', system: chip.system, systemChange: 'state' });
    log.info('session-links.system-linked', { system: chip.system, sessionPrefix: sessionId.slice(0, 8) });
  };

  const drain = async (): Promise<void> => {
    while (!disposed) {
      const next = pending.entries().next();
      if (next.done) return;
      const [sessionId, work] = next.value;
      pending.delete(sessionId);
      for (const chip of work.designs) {
        if (disposed) return;
        try {
          await linkOne(sessionId, chip);
        } catch (error) {
          // One design failing must not stop the others; the chat's next event tries again.
          log.warn('session-links.failed', { slug: chip.slug, error: error instanceof Error ? error.message : String(error) });
        }
      }
      for (const chip of work.systems) {
        if (disposed) return;
        try {
          await linkSystem(sessionId, chip);
        } catch (error) {
          log.warn('session-links.system-failed', { system: chip.system, error: error instanceof Error ? error.message : String(error) });
        }
      }
      for (const chip of work.builds) {
        if (disposed || builds === undefined) return;
        try {
          // The ticket is written only while it has no chat and only for the ticket the chip was made for.
          await builds.linkSession(chip.ticket, sessionId, chip.marker);
        } catch (error) {
          log.warn('session-links.build-failed', { ticket: chip.ticket, error: error instanceof Error ? error.message : String(error) });
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
      let systemChips: SystemChipRef[];
      let buildChips: BuildChipRef[];
      try {
        chips = chipsOf(event.linked);
        systemChips = systems === undefined ? [] : systemChipsOf(event.linked);
        buildChips = builds === undefined ? [] : buildChipsOf(event.linked);
      } catch (error) {
        // Not expected (every item is checked), but the route relies on take never throwing:
        // a link lost here must not cost the turn its snapshot.
        log.warn('session-links.take-failed', { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (chips.length === 0 && systemChips.length === 0 && buildChips.length === 0) return;
      // The latest event wins for its chat; re-inserting keeps the order fair.
      pending.delete(event.session.id);
      pending.set(event.session.id, { designs: chips, systems: systemChips, builds: buildChips });
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
