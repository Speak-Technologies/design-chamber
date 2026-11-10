// The design index (documentation/specs/phase-1-5-sdk-2-7.md §3.1): the store's design list kept
// in memory and refreshed from the change hub, so the routes the host calls on its own clock
// (mentions within 2 s, session events, Work Status) answer without walking the designs root.
//
// One `store.list()` at creation; afterwards one refresh `refreshMs` after the first content
// event, with every event in that window folded in. Never two lists in flight: an event during a
// list marks the index dirty and one more refresh follows. A list that fails keeps the last good
// one and logs; the next event tries again.

import { DESIGN_INDEX_REFRESH_MS } from '../shared/limits.ts';
import type { ChangeEvent, ChangeKind, DesignSummary } from '../shared/types.ts';
import type { ChangeHub, DesignIndex, DesignStore, Logger } from './context.ts';

/** Kinds that can change a summary the index serves; thumbnails, versions, checks, open requests and activity do not. */
const REFRESH_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['added', 'removed', 'design', 'comments', 'files', 'root']);

export type DesignIndexDeps = {
  store: Pick<DesignStore, 'list'>;
  hub: Pick<ChangeHub, 'subscribe'>;
  log: Logger;
  /** Test seam; defaults to `DESIGN_INDEX_REFRESH_MS`. */
  refreshMs?: number;
};

const timeOf = (iso: string): number => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

/** Newest `updated` first; the slug breaks ties so the order is stable. */
const newestFirst = (designs: readonly DesignSummary[]): DesignSummary[] =>
  [...designs].sort((a, b) => timeOf(b.updated) - timeOf(a.updated) || a.slug.localeCompare(b.slug));

export const createDesignIndex = ({ store, hub, log, refreshMs = DESIGN_INDEX_REFRESH_MS }: DesignIndexDeps): DesignIndex => {
  let designs: readonly DesignSummary[] = [];
  let bySlug = new Map<string, DesignSummary>();
  let loaded = false;
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const readyWaiters = new Set<() => void>();

  const schedule = (): void => {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, refreshMs);
  };

  const refresh = (): void => {
    if (disposed) return;
    if (inFlight !== null) {
      dirty = true;
      return;
    }
    let listing: Promise<DesignSummary[]>;
    try {
      listing = store.list();
    } catch (error) {
      // A store that throws synchronously is a failed list, not a crash.
      listing = Promise.reject(error);
    }
    inFlight = listing
      .then(
        (list) => {
          designs = newestFirst(list);
          bySlug = new Map(designs.map((design) => [design.slug, design]));
          if (!loaded) {
            loaded = true;
            for (const wake of [...readyWaiters]) wake();
          }
        },
        (error: unknown) => {
          log.warn('design-index.refresh-failed', { loaded, error: error instanceof Error ? error.message : String(error) });
        },
      )
      .finally(() => {
        inFlight = null;
        if (dirty) {
          dirty = false;
          schedule();
        }
      });
  };

  const unsubscribe = hub.subscribe((event: ChangeEvent) => {
    if (REFRESH_KINDS.has(event.kind)) schedule();
  });
  refresh();

  return {
    all: () => designs,
    get: (slug) => bySlug.get(slug) ?? null,
    bySession: (sessionId) => designs.filter((design) => design.sessionId === sessionId).map((design) => design.slug),
    ready: (timeoutMs) => {
      if (loaded) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const wake = (): void => {
          clearTimeout(timeout);
          readyWaiters.delete(wake);
          resolve(true);
        };
        const timeout = setTimeout(() => {
          readyWaiters.delete(wake);
          resolve(false);
        }, Math.max(0, timeoutMs));
        readyWaiters.add(wake);
      });
    },
    dispose: async () => {
      disposed = true;
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      await inFlight;
    },
  };
};
