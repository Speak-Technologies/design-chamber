// Per-view source cache for the text editor (Phase 2 technical design §3.5). `GET /source`
// answers are cached per (slug, screen) so a 2 MB page is fetched once per selection burst,
// not once per click. An entry is dropped when a change event says its file changed, so the
// editor always locates the edit in fresh source (E2/E4). At most `maxEntries` (default 4)
// entries per view, least recently used evicted. No UI here: the view wires `applyChanges` to
// the change feed and calls `clear()` when it closes.

import type { SourceResponse } from '../shared/api.ts';
import { ENTRY_FILE, screenFileOf } from '../shared/design-json.ts';
import type { ChangeBatch } from './changes.ts';

export type SourceCacheDeps = {
  /** Reads one source; the store's `loadSource` (errors are `ServiceError`). */
  load: (slug: string, screen: string | null) => Promise<SourceResponse>;
  /** Entries kept per view; default 4 (§3.5). */
  maxEntries?: number;
};

export type SourceCache = {
  /** The cached source for one page (`screen` null) or canvas screen, fetched on a miss. */
  get(slug: string, screen?: string | null): Promise<SourceResponse>;
  /** Drop entries a change batch invalidates; wire to the change feed. */
  applyChanges(batch: ChangeBatch): void;
  /** The view closed: drop everything. */
  clear(): void;
};

/** The default number of sources one view keeps (§3.5). */
export const SOURCE_CACHE_MAX_ENTRIES = 4;

const keyOf = (slug: string, screen: string | null): string => `${slug}\u0000${screen ?? ''}`;

const parseKey = (key: string): { slug: string; screen: string | null } => {
  const sep = key.indexOf('\u0000');
  const screen = key.slice(sep + 1);
  return { slug: key.slice(0, sep), screen: screen === '' ? null : screen };
};

/** The file a source is read from: the page entry, or a canvas screen (§6.2 fixes `screens/<id>.html`). */
const fileOf = (screen: string | null): string => (screen === null ? ENTRY_FILE : screenFileOf(screen));

export const createSourceCache = ({ load, maxEntries = SOURCE_CACHE_MAX_ENTRIES }: SourceCacheDeps): SourceCache => {
  /** Insertion order = LRU order (oldest first). */
  const cache = new Map<string, SourceResponse>();
  const inflight = new Map<string, Promise<SourceResponse>>();
  /**
   * Per-key invalidation epoch. A fetch captures its key's epoch and only caches its answer if
   * the epoch is unchanged, so a write that lands while the fetch is in flight is never cached
   * as fresh source.
   */
  const epochs = new Map<string, number>();

  const bumpEpoch = (key: string): void => {
    epochs.set(key, (epochs.get(key) ?? 0) + 1);
  };

  /** Drop every cached or in-flight entry the predicate matches, and retire any in-flight answer. */
  const invalidate = (matches: (slug: string, screen: string | null) => boolean): void => {
    const keys = new Set([...cache.keys(), ...inflight.keys()]);
    for (const key of keys) {
      const { slug, screen } = parseKey(key);
      if (!matches(slug, screen)) continue;
      cache.delete(key);
      bumpEpoch(key);
    }
  };

  const get = (slug: string, screen: string | null = null): Promise<SourceResponse> => {
    const key = keyOf(slug, screen);
    const cached = cache.get(key);
    if (cached) {
      // Refresh recency.
      cache.delete(key);
      cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const running = inflight.get(key);
    if (running) return running;
    const epoch = epochs.get(key) ?? 0;
    const task = (async () => {
      const response = await load(slug, screen);
      // A write that landed while this fetch ran retired the epoch: do not cache the stale bytes.
      if ((epochs.get(key) ?? 0) === epoch) {
        cache.set(key, response);
        while (cache.size > maxEntries) {
          const oldest = cache.keys().next();
          if (oldest.done) break;
          cache.delete(oldest.value);
        }
      }
      return response;
    })().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, task);
    return task;
  };

  const applyChanges = (batch: ChangeBatch): void => {
    if (batch.reset) {
      invalidate(() => true);
      return;
    }
    for (const event of batch.events) {
      switch (event.kind) {
        case 'root':
          invalidate(() => true);
          break;
        case 'files': {
          const slug = event.slug;
          if (slug === null) break;
          const files = event.files;
          if (!files) {
            // A restore (no list) rewrote every tracked file of this design.
            invalidate((s) => s === slug);
          } else {
            const named = new Set(files);
            invalidate((s, screen) => s === slug && named.has(fileOf(screen)));
          }
          break;
        }
        case 'design':
        case 'added':
        case 'removed': {
          // The screen list, kind or existence changed: every source of this design is suspect.
          const slug = event.slug;
          if (slug !== null) invalidate((s) => s === slug);
          break;
        }
        default:
          // comments, versions, thumb, checks, open, activity, page-state, loose: no source change.
          break;
      }
    }
  };

  return {
    get,
    applyChanges,
    clear: () => invalidate(() => true),
  };
};