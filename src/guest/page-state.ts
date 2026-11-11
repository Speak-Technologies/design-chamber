// Saved page data, page side (Phase 2 technical design §8.4; feature 19). One controller per open
// live design per surface. It keeps the design's one map (shared by every screen and viewport),
// coalesces the frames' `storage-batch` writes into at most one PATCH per second, and pushes the
// accepted changes to the surface's other live frames as `storage-sync`. Inline vs upload is
// decided by bytes, not characters (`fitsOneRequest`), so a multi-byte delta is uploaded, never
// answered 413. A Clear elsewhere wins over this surface's dirty keys (no resurrection), whether it
// is seen as a 409 on a PATCH or as a `page-state` change event.
//
// No UI and no filesystem here: every write is a service route (the service enforces containment
// and the cap), and the frames are fed through the wall's `syncFrames` / `reloadFrames` seams. The
// data is personal: it is never logged, and only the slug travels in a notice.

import type { PageStateClearResponse, PageStatePatchBody, PageStateResponse } from '../shared/api.ts';
import type { StorageChange, StorageInit } from '../shared/bridge-protocol.ts';
import { PAGE_STATE_CHANGES_MAX, PAGE_STATE_FLUSH_MS, PAGE_STATE_MAX_CHARS, UPLOAD_TOTAL_MAX } from '../shared/limits.ts';
import { isOlderClear, pageStateChars, type PageStateDelta } from '../shared/page-state.ts';
import type { StorageBatch } from './bridge/storage-shim.ts';
import type { ChangeBatch } from './changes.ts';
import { fitsOneRequest, isServiceError, toServiceError, type ServiceClient } from './service-client.ts';

/** Load waits at most this long; a later answer is ignored for this view (§8.4). */
export const PAGE_STATE_LOAD_TIMEOUT_MS = 2000;
/** A `page-state` change event refetches after this quiet (§8.4). */
export const PAGE_STATE_REFETCH_DEBOUNCE_MS = 500;
/** After this many failed flushes the "can't be saved right now" notice shows once (§8.4). */
export const PAGE_STATE_FAIL_NOTICE = 3;

export const PAGE_STATE_UNSAVED_SENTENCE = "Page data can't be saved right now. Changes last until you close this design.";
export const PAGE_STATE_CAP_SENTENCE = "This design tried to save more than 1 MB of page data. The extra wasn't saved.";
export const PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE = 'Saved page data was cleared.';

/** The background notices the controller raises; each shows once per view session (§8.6). */
export type PageStateNoticeKind = 'unsaved' | 'cap' | 'cleared-elsewhere';
export type PageStateNotice = { id: 'page-data'; kind: PageStateNoticeKind; message: string };

/** One-shot timer seam: answers a cancel function. Tests pass a fake clock. */
export type Schedule = (run: () => void, ms: number) => () => void;

const defaultSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** Page visibility, injectable for tests (the same shape the change feed uses). */
export type VisibilitySource = { hidden(): boolean; onChange(listener: () => void): () => void };

const documentVisibility = (): VisibilitySource | null => {
  if (typeof document === 'undefined') return null;
  return {
    hidden: () => document.hidden,
    onChange: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
};

// ---- The flush plan (pure, exported for tests) ----

/**
 * Split a flush into deltas the service accepts: each holds ≤ `PAGE_STATE_CHANGES_MAX` entries and
 * serializes to ≤ `UPLOAD_TOTAL_MAX` characters (so `upload` never refuses it); `clear` rides only
 * the first. A single entry too large for one upload is dropped (refused like the cap) — the caller
 * shows the cap notice. The inline-vs-upload choice is made per delta at flush time, not here.
 */
export const splitPageStateDelta = (
  gen: string,
  clear: boolean,
  changes: readonly StorageChange[],
): { deltas: PageStateDelta[]; dropped: StorageChange[] } => {
  const dropped: StorageChange[] = [];
  const groups: StorageChange[][] = [];
  let current: StorageChange[] = [];
  // Serialized length of `{"gen":…,"clear":…,"changes":[…groups…]}`; each entry adds its own JSON
  // plus a comma once the group is non-empty.
  let length = JSON.stringify({ gen, clear, changes: [] }).length;
  const close = (): void => {
    if (current.length > 0) groups.push(current);
    current = [];
    length = JSON.stringify({ gen, clear: false, changes: [] }).length;
  };
  for (const change of changes) {
    const cost = JSON.stringify(change).length + (current.length === 0 ? 0 : 1);
    if (current.length === 0 && length + cost > UPLOAD_TOTAL_MAX) {
      dropped.push(change); // one value too large for even one upload
      continue;
    }
    if (current.length > 0 && (current.length >= PAGE_STATE_CHANGES_MAX || length + cost > UPLOAD_TOTAL_MAX)) close();
    current.push(change);
    length += cost;
  }
  close();
  if (groups.length === 0) return { deltas: clear ? [{ clear, changes: [] }] : [], dropped };
  return { deltas: groups.map((group, index) => ({ clear: clear && index === 0, changes: group })), dropped };
};

/** The difference `before → after` as storage changes, skipping keys this surface still holds dirty. */
export const pageStateDiff = (before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>, dirty: ReadonlyMap<string, string | null>): StorageChange[] => {
  const changes: StorageChange[] = [];
  for (const [key, value] of after) {
    if (dirty.has(key)) continue;
    if (before.get(key) !== value) changes.push([key, value]);
  }
  for (const key of before.keys()) {
    if (dirty.has(key) || after.has(key)) continue;
    changes.push([key, null]);
  }
  return changes;
};

// ---- Controller ----

export type PageStateControllerDeps = {
  client: ServiceClient;
  slug: string;
  onNotice: (notice: PageStateNotice) => void;
  /** Forward accepted changes to the design's other live frames (`storage-sync`), except `exceptBoard`. */
  syncFrames: (batch: StorageBatch, exceptBoard: string | null) => void;
  /** Reload the design's live frames so they reseed from `init()` (the reload path a `files` event uses). */
  reloadFrames: () => void;
  now?: () => number;
  schedule?: Schedule;
  visibility?: VisibilitySource | null;
  loadTimeoutMs?: number;
};

export type PageStateController = {
  /** GET the data before the frames are created; resolves within the load timeout either way. */
  load(): Promise<void>;
  /** The seed for every new live frame of the design. */
  init(): StorageInit;
  /** One frame's `storage-batch` (only a live board's; the wall checks that before calling). */
  apply(board: string, batch: StorageBatch): void;
  /** Wire to the change feed: a `page-state` event for this slug refetches (debounced). */
  applyChanges(batch: ChangeBatch): void;
  /** Flush now (visibility hidden, closing the design). */
  flush(): Promise<void>;
  /** Clear saved page data (the ⋯ menu action); resolves with the service answer. */
  clear(): Promise<PageStateClearResponse>;
  /** Current saved-data size, for the menu's enabled state (`chars > 0`). */
  chars(): number;
  /** Whether this view persists (false after a load failure or timeout). */
  persisting(): boolean;
  dispose(): Promise<void>;
};

const sizeOf = (key: string, value: string | null): number => key.length + (value === null ? 0 : value.length);

export const createPageStateController = (deps: PageStateControllerDeps): PageStateController => {
  const { client, slug, onNotice, syncFrames, reloadFrames } = deps;
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? defaultSchedule;
  const visibility = deps.visibility === undefined ? documentVisibility() : deps.visibility;
  const loadTimeoutMs = deps.loadTimeoutMs ?? PAGE_STATE_LOAD_TIMEOUT_MS;

  let items = new Map<string, string>();
  let chars = 0;
  let gen = '';
  let persist = false;
  let disposed = false;

  /** Unflushed changes: the last value per key, plus a pending `clear()`. */
  let dirty = new Map<string, string | null>();
  let dirtyClear = false;
  let failures = 0;
  let lastFlushAt: number | null = null;
  let flushTimer: (() => void) | null = null;
  let inflight: Promise<void> | null = null;
  let clearing = false;
  let refetchTimer: (() => void) | null = null;
  let unwatchVisibility: (() => void) | null = null;
  const shown = new Set<PageStateNoticeKind>();

  const noticeOnce = (kind: PageStateNoticeKind, message: string): void => {
    if (shown.has(kind)) return;
    shown.add(kind);
    onNotice({ id: 'page-data', kind, message });
  };

  const adopt = (answer: PageStateResponse): void => {
    items = new Map(answer.items);
    chars = answer.chars;
    gen = answer.gen;
  };

  // ---- load ----

  const load = (): Promise<void> =>
    new Promise<void>((resolve) => {
      let settled = false;
      let cancelTimeout: (() => void) | null = null;
      const finish = (answer: PageStateResponse | null): void => {
        if (settled || disposed) return;
        settled = true;
        cancelTimeout?.();
        if (answer) {
          adopt(answer);
          persist = true;
        } else {
          // A failure or the timeout: this view runs empty and unsaved; a late answer is ignored.
          items = new Map();
          chars = 0;
          persist = false;
          noticeOnce('unsaved', PAGE_STATE_UNSAVED_SENTENCE);
        }
        resolve();
      };
      cancelTimeout = schedule(() => finish(null), loadTimeoutMs);
      client
        .call('GET /designs/:slug/page-state', { params: { slug } })
        .then((answer) => finish(answer))
        .catch(() => finish(null));
    });

  // ---- flush ----

  const cancelFlushTimer = (): void => {
    flushTimer?.();
    flushTimer = null;
  };

  const scheduleFlush = (): void => {
    if (flushTimer !== null || disposed || !persist) return;
    const wait = lastFlushAt === null ? 0 : Math.max(0, lastFlushAt + PAGE_STATE_FLUSH_MS - now());
    flushTimer = schedule(() => {
      flushTimer = null;
      void runFlush();
    }, wait);
  };

  const sendDelta = async (delta: PageStateDelta): Promise<void> => {
    const json = JSON.stringify({ gen, ...delta });
    let body: PageStatePatchBody;
    if (fitsOneRequest(json)) body = { gen, ...delta };
    else {
      const uploadId = await client.upload(json);
      body = { gen, uploadId };
    }
    const answer = await client.call('PATCH /designs/:slug/page-state', { params: { slug }, body });
    gen = answer.gen;
  };

  /** A Clear elsewhere won: drop every dirty key, refetch, reload the frames with the fetched data. */
  const handleStaleClear = async (): Promise<void> => {
    dirty.clear();
    dirtyClear = false;
    cancelFlushTimer();
    try {
      const answer = await client.call('GET /designs/:slug/page-state', { params: { slug } });
      adopt(answer);
      persist = true;
    } catch {
      persist = false;
      noticeOnce('unsaved', PAGE_STATE_UNSAVED_SENTENCE);
    }
    reloadFrames();
    noticeOnce('cleared-elsewhere', PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE);
  };

  const runFlush = async (): Promise<void> => {
    if (inflight) return; // one flush at a time; the running one reschedules if more is dirty
    if (disposed || !persist || (dirty.size === 0 && !dirtyClear)) return;
    const clear = dirtyClear;
    const changes = [...dirty];
    dirty = new Map();
    dirtyClear = false;
    lastFlushAt = now();
    const { deltas, dropped } = splitPageStateDelta(gen, clear, changes);
    if (dropped.length > 0) noticeOnce('cap', PAGE_STATE_CAP_SENTENCE);
    const task = (async () => {
      for (const delta of deltas) await sendDelta(delta);
    })();
    inflight = task;
    try {
      await task;
      failures = 0;
    } catch (error) {
      if (isServiceError(error, 'stale')) {
        await handleStaleClear();
      } else if (isServiceError(error, 'too-large')) {
        // The cap backstop (another surface filled the store): the extra wasn't saved, and a
        // permanent refusal is not retried. The dropped keys stay out of the dirty set.
        noticeOnce('cap', PAGE_STATE_CAP_SENTENCE);
      } else if (!clearing) {
        // Keep the changes dirty (idempotent "set these keys"); newer keys keep their newer value.
        dirtyClear = dirtyClear || clear;
        for (const [key, value] of changes) if (!dirty.has(key)) dirty.set(key, value);
        failures += 1;
        if (failures >= PAGE_STATE_FAIL_NOTICE) noticeOnce('unsaved', PAGE_STATE_UNSAVED_SENTENCE);
      }
    } finally {
      inflight = null;
    }
    if (dirty.size > 0 || dirtyClear) scheduleFlush();
  };

  const flush = async (): Promise<void> => {
    cancelFlushTimer();
    if (inflight) await inflight.catch(() => undefined);
    await runFlush();
  };

  // ---- frame writes ----

  const apply = (board: string, batch: StorageBatch): void => {
    if (disposed || !persist) return;
    if (batch.clear) {
      items.clear();
      chars = 0;
      dirty.clear();
      dirtyClear = true;
    }
    const accepted: StorageChange[] = [];
    let capped = false;
    for (const [key, value] of batch.changes) {
      const old = items.get(key);
      const before = old === undefined ? 0 : sizeOf(key, old);
      const next = chars + sizeOf(key, value) - before;
      if (next > PAGE_STATE_MAX_CHARS) {
        capped = true; // drop this change; earlier data is untouched
        continue;
      }
      if (value === null) items.delete(key);
      else items.set(key, value);
      chars = next;
      dirty.set(key, value);
      accepted.push([key, value]);
    }
    if (capped) noticeOnce('cap', PAGE_STATE_CAP_SENTENCE);
    if (batch.clear || accepted.length > 0) syncFrames({ clear: batch.clear, changes: accepted }, board);
    scheduleFlush();
  };

  // ---- change feed ----

  const refetch = async (): Promise<void> => {
    if (disposed) return;
    let answer: PageStateResponse;
    try {
      answer = await client.call('GET /designs/:slug/page-state', { params: { slug } });
    } catch {
      return; // a transient read failure; the next event or flush retries
    }
    if (disposed) return;
    if (isOlderClear(gen, answer.gen)) {
      dirty.clear();
      dirtyClear = false;
      cancelFlushTimer();
      adopt(answer);
      persist = true;
      reloadFrames();
      noticeOnce('cleared-elsewhere', PAGE_STATE_CLEARED_ELSEWHERE_SENTENCE);
      return;
    }
    gen = answer.gen;
    if (dirtyClear) return; // this surface's pending clear wins; keep the cleared local state
    const before = items;
    const fetched = new Map(answer.items);
    const changes = pageStateDiff(before, fetched, dirty);
    items = fetched;
    for (const [key, value] of dirty) {
      if (value === null) items.delete(key);
      else items.set(key, value);
    }
    chars = pageStateChars(items);
    if (changes.length > 0) syncFrames({ clear: false, changes }, null);
  };

  const scheduleRefetch = (): void => {
    refetchTimer?.();
    refetchTimer = schedule(() => {
      refetchTimer = null;
      void refetch();
    }, PAGE_STATE_REFETCH_DEBOUNCE_MS);
  };

  const applyChanges = (batch: ChangeBatch): void => {
    if (disposed) return;
    if (batch.reset) {
      scheduleRefetch();
      return;
    }
    for (const event of batch.events) {
      if (event.kind === 'page-state' && event.slug === slug) {
        scheduleRefetch();
        return;
      }
    }
  };

  // ---- clear ----

  const clear = async (): Promise<PageStateClearResponse> => {
    cancelFlushTimer();
    clearing = true;
    try {
      if (inflight) await inflight.catch(() => undefined);
      dirty.clear();
      dirtyClear = false;
      const answer = await client.call('DELETE /designs/:slug/page-state', { params: { slug } });
      gen = answer.gen;
      items.clear();
      chars = 0;
      reloadFrames();
      return answer;
    } finally {
      clearing = false;
    }
  };

  // ---- lifecycle ----

  if (visibility) {
    unwatchVisibility = visibility.onChange(() => {
      if (visibility.hidden()) void flush();
    });
  }

  return {
    load,
    init: () => ({ persist, items: [...items] }),
    apply,
    applyChanges,
    flush,
    clear,
    chars: () => chars,
    persisting: () => persist,
    dispose: async () => {
      if (disposed) return;
      await flush();
      disposed = true;
      cancelFlushTimer();
      refetchTimer?.();
      refetchTimer = null;
      unwatchVisibility?.();
      unwatchVisibility = null;
    },
  };
};
