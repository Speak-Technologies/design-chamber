// Saved page data, service side (Phase 2 technical design §8.1, §8.2; feature 19): one store per
// design at `<design>/.chamber/page-state.json`, kept in memory once touched, capped at 1 MB of
// keys plus values, written at most once per second per design, flushed on shutdown.
//
// Safety rules this module holds:
// - Every path goes through `resolvePlainTarget` from the design folder (containment, then the
//   realpath compared with the lexical path), so a `.chamber` or a `page-state.json` that is a
//   link reads as empty and every write refuses. `.chamber` is also lstat'd before each write.
// - A design that was removed is never re-created: `.chamber` is made with a non-recursive mkdir,
//   the atomic write never creates folders, and a `removed` event drops the pending write.
// - The file is untrusted: size-capped before it is read, validated by `parsePageStateFile`,
//   empty (`damaged`) when wrong; the next save replaces it.
// - The data is personal: no key, value or file text ever reaches a log line, an event or an
//   error message (logs carry the slug, an error code, and counts at most).
// - Clear never comes back: a per-design clear counter, answered as `gen`, refuses a PATCH made
//   before the last Clear (`isOlderClear`).
//
// Each design's load, write and clear run one at a time on a per-slug chain, so a write that was
// due can never land after a Clear unlinked the file.

import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { PageStateClearResponse, PageStatePatchResponse, PageStateResponse } from '../shared/api.ts';
import { PAGE_STATE_CACHE_MAX_BYTES, PAGE_STATE_FILE_MAX_BYTES, PAGE_STATE_MAX_CHARS, PAGE_STATE_WRITE_MIN_MS } from '../shared/limits.ts';
import { applyPageStateDelta, formatGen, isOlderClear, parsePageStateFile, serializePageStateFile, type PageStateDelta } from '../shared/page-state.ts';
import type { ChangeHub, DesignStore, Logger, ServiceContext } from './context.ts';
import { ApiError } from './http.ts';
import { assertSlug, resolvePlainTarget, writeFileAtomic } from './paths.ts';
import { folderErrorSentence } from './root.ts';

/** Where the data lives inside a design folder. */
export const PAGE_STATE_SEGMENTS = ['.chamber', 'page-state.json'] as const;

/** A clean entry nobody touched for this long is dropped from memory (§8.2). */
export const PAGE_STATE_IDLE_MS = 10 * 60 * 1000;

export const PAGE_STATE_GONE_SENTENCE = 'That design is no longer in your Designs folder.';
export const PAGE_STATE_CAP_SENTENCE = "This design tried to save more than 1 MB of page data. The extra wasn't saved.";
export const PAGE_STATE_STALE_SENTENCE = 'Saved page data was cleared in another window, so these changes were not saved.';
export const PAGE_STATE_LINK_SENTENCE = "This design's .chamber folder or its page data file is a link or not a normal file, so Design Chamber won't save page data there.";

/** One-shot timer seam: answers a cancel function. Tests pass a fake clock. */
export type Schedule = (run: () => void, ms: number) => () => void;

const defaultSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

export type PageStateDeps = {
  store: Pick<DesignStore, 'dir'>;
  hub: Pick<ChangeHub, 'epoch' | 'emit' | 'subscribe'>;
  log: Logger;
  /** Milliseconds; defaults to `Date.now`. */
  now?: () => number;
  schedule?: Schedule;
  /** Memory bound across designs (bytes, two per character); defaults to `PAGE_STATE_CACHE_MAX_BYTES`. */
  cacheMaxBytes?: number;
};

export type PageStateService = {
  read(slug: string): Promise<PageStateResponse>;
  /** Apply a validated delta made at `gen`. 409 `stale` before a newer Clear, 413 over the cap; nothing applied on either. */
  patch(slug: string, gen: string, delta: PageStateDelta): Promise<PageStatePatchResponse>;
  clear(slug: string): Promise<PageStateClearResponse>;
  /** Write every pending change now (shutdown, root change). Never throws. */
  flush(): Promise<void>;
  /** Flush, then stop listening. */
  dispose(): Promise<void>;
};

type Entry = {
  slug: string;
  /** The design folder as resolved at load (a root change keeps writing to it). */
  dir: string;
  items: Map<string, string>;
  chars: number;
  damaged: boolean;
  /** `.chamber` or the file is a link: reads empty, every write refuses. */
  linked: boolean;
  /** Memory is newer than the file. */
  dirty: boolean;
  /** When the last write began (ms), for the once-a-second rule. */
  lastWriteAt: number | null;
  cancelTimer: (() => void) | null;
  /** The last write failed with this error; the next PATCH answers it once and retries the write. */
  failure: unknown;
  lastUsed: number;
  /** Dropped by a `removed` event or a root change: queued work on it is skipped. */
  dropped: boolean;
};

/** `store.dir`, with the Phase 2 sentence for a design that is gone (the routes check the slug through this first). */
export const pageStateDirOf = async (store: Pick<DesignStore, 'dir'>, slug: string): Promise<string> => {
  try {
    return await store.dir(slug);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not-found') throw new ApiError('not-found', PAGE_STATE_GONE_SENTENCE);
    throw error;
  }
};

const errorCode = (error: unknown): string => (error as NodeJS.ErrnoException | null)?.code ?? 'unknown';
const isMissing = (error: unknown): boolean => errorCode(error) === 'ENOENT';
/** `resolvePlainTarget`'s refusals: a link inside the design (`invalid`) or one leading out of it (`bad-path`). */
const isLinkRefusal = (error: unknown): boolean => error instanceof ApiError && (error.code === 'invalid' || error.code === 'bad-path');

export const createPageStateService = (deps: PageStateDeps): PageStateService => {
  const { store, hub, log } = deps;
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? defaultSchedule;
  const cacheMaxBytes = deps.cacheMaxBytes ?? PAGE_STATE_CACHE_MAX_BYTES;

  const entries = new Map<string, Entry>();
  // Kept apart from the data cache, so evicting an entry never forgets a Clear (§8.2).
  const clears = new Map<string, number>();
  const chains = new Map<string, Promise<unknown>>();

  const genOf = (slug: string): string => formatGen(hub.epoch, clears.get(slug) ?? 0);

  /** Run `task` after every earlier task of this slug settled. */
  const chained = <T>(slug: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(slug) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    chains.set(slug, tail);
    void tail.then(() => {
      if (chains.get(slug) === tail) chains.delete(slug);
    });
    return run;
  };

  // ---- memory ----

  const isIdle = (entry: Entry): boolean => !entry.dirty && entry.cancelTimer === null && !chains.has(entry.slug);

  /**
   * Drop clean entries idle past `PAGE_STATE_IDLE_MS`, then least recently used ones while over the
   * byte bound. Runs before each access (so an expired entry is reloaded, not refreshed) and after
   * each write.
   */
  const sweep = (): void => {
    const at = now();
    let bytes = 0;
    for (const entry of entries.values()) {
      if (isIdle(entry) && at - entry.lastUsed >= PAGE_STATE_IDLE_MS) entries.delete(entry.slug);
      else bytes += entry.chars * 2;
    }
    if (bytes <= cacheMaxBytes) return;
    const byAge = [...entries.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of byAge) {
      if (bytes <= cacheMaxBytes) break;
      if (!isIdle(entry)) continue;
      entries.delete(entry.slug);
      bytes -= entry.chars * 2;
    }
  };

  const empty = (slug: string, dir: string): Entry => ({
    slug,
    dir,
    items: new Map(),
    chars: 0,
    damaged: false,
    linked: false,
    dirty: false,
    lastWriteAt: null,
    cancelTimer: null,
    failure: null,
    lastUsed: now(),
    dropped: false,
  });

  /** Read the file into a fresh entry. Never throws for the file's own faults: they read as empty. */
  const loadEntry = async (slug: string, dir: string): Promise<Entry> => {
    const entry = empty(slug, dir);
    let file: string;
    try {
      file = await resolvePlainTarget(dir, PAGE_STATE_SEGMENTS, { allowAbsent: true });
    } catch (error) {
      if (isLinkRefusal(error)) entry.linked = true;
      else {
        entry.damaged = true;
        log.warn('page-state.unreadable', { slug, code: errorCode(error) });
      }
      return entry;
    }
    let text: string;
    try {
      // O_NOFOLLOW: the leaf was checked above; a link swapped in since is refused, never followed.
      const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > PAGE_STATE_FILE_MAX_BYTES) {
          entry.damaged = true;
          log.warn('page-state.unreadable', { slug, code: info.isFile() ? 'too-large' : 'not-a-file' });
          return entry;
        }
        text = await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (isMissing(error)) return entry;
      entry.damaged = true;
      log.warn('page-state.unreadable', { slug, code: errorCode(error) });
      return entry;
    }
    const parsed = parsePageStateFile(text);
    if (parsed === null) {
      entry.damaged = true;
      log.warn('page-state.unreadable', { slug });
      return entry;
    }
    entry.items = parsed.items;
    entry.chars = parsed.chars;
    return entry;
  };

  /** The design's entry, loaded on first use. Call only inside the slug's chain. */
  const entryFor = async (slug: string, dir: string): Promise<Entry> => {
    const existing = entries.get(slug);
    if (existing && !existing.dropped) {
      existing.lastUsed = now();
      return existing;
    }
    const loaded = await loadEntry(slug, dir);
    entries.set(slug, loaded);
    return loaded;
  };

  // ---- disk ----

  /** `<dir>/.chamber` as a real folder, created (non-recursively) when absent; a link or a file there refuses. */
  const chamberFolder = async (dir: string): Promise<void> => {
    const target = path.join(dir, PAGE_STATE_SEGMENTS[0]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new ApiError('invalid', PAGE_STATE_LINK_SENTENCE);
        return;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      try {
        // Never recursive: when the design folder is gone this fails with ENOENT, and nothing is re-created.
        await mkdir(target);
        return;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
    }
    throw new ApiError('invalid', PAGE_STATE_LINK_SENTENCE);
  };

  /** The checked file path for a write; refusals keep their sentence. */
  const writableFile = async (dir: string): Promise<string> => {
    await chamberFolder(dir);
    try {
      return await resolvePlainTarget(dir, PAGE_STATE_SEGMENTS, { allowAbsent: true });
    } catch (error) {
      if (isLinkRefusal(error)) throw new ApiError('invalid', PAGE_STATE_LINK_SENTENCE);
      throw error;
    }
  };

  /** Write the entry's memory copy if it is newer than the file (inside the slug's chain). */
  const writeNow = async (entry: Entry): Promise<void> => {
    if (entry.dropped || !entry.dirty || entry.linked) return;
    entry.dirty = false;
    entry.lastWriteAt = now();
    const text = serializePageStateFile(entry.items, new Date(now()).toISOString());
    try {
      const file = await writableFile(entry.dir);
      await writeFileAtomic(file, text, { createDirs: false });
      entry.failure = null;
      entry.damaged = false;
    } catch (error) {
      if (isLinkRefusal(error)) {
        entry.linked = true;
        log.warn('page-state.write-refused', { slug: entry.slug, reason: 'link' });
        return;
      }
      // Memory stays the newer copy; the next PATCH reports this and tries again.
      entry.dirty = true;
      entry.failure = error;
      log.warn('page-state.write-failed', { slug: entry.slug, code: errorCode(error) });
    }
  };

  /** At most one write per design per `PAGE_STATE_WRITE_MIN_MS`; a write already due absorbs later changes. */
  const scheduleWrite = (entry: Entry): void => {
    if (entry.cancelTimer !== null) return;
    const wait = entry.lastWriteAt === null ? 0 : Math.max(0, entry.lastWriteAt + PAGE_STATE_WRITE_MIN_MS - now());
    entry.cancelTimer = schedule(() => {
      entry.cancelTimer = null;
      void chained(entry.slug, () => writeNow(entry)).then(sweep);
    }, wait);
  };

  const cancelWrite = (entry: Entry): void => {
    entry.cancelTimer?.();
    entry.cancelTimer = null;
  };

  const flush = async (): Promise<void> => {
    const pending = [...entries.values()].filter((entry) => entry.dirty || entry.cancelTimer !== null);
    await Promise.all(
      pending.map((entry) => {
        cancelWrite(entry);
        return chained(entry.slug, () => writeNow(entry));
      }),
    );
    // Writes of entries a root change already forgot are still on their chains.
    await Promise.all([...chains.values()]);
  };

  const unsubscribe = hub.subscribe((event) => {
    if (event.kind === 'removed' && event.slug !== null) {
      // The folder went to the trash: its pending write is dropped, never re-creating it.
      const entry = entries.get(event.slug);
      if (entry) {
        cancelWrite(entry);
        entry.dropped = true;
        entries.delete(event.slug);
      }
      clears.delete(event.slug);
    } else if (event.kind === 'root') {
      // Forget every entry at once (requests from now on load from the new root), and flush the old
      // ones to the folders they were loaded from.
      const old = [...entries.values()];
      entries.clear();
      clears.clear();
      for (const entry of old) {
        cancelWrite(entry);
        if (entry.dirty) void chained(entry.slug, () => writeNow(entry));
      }
    }
  });

  return {
    async read(slug) {
      const dir = await pageStateDirOf(store, slug);
      sweep();
      return chained(slug, async (): Promise<PageStateResponse> => {
        const entry = await entryFor(slug, dir);
        return { items: [...entry.items], chars: entry.chars, gen: genOf(slug), ...(entry.damaged ? { damaged: true as const } : {}) };
      });
    },

    async patch(slug, gen, delta) {
      const dir = await pageStateDirOf(store, slug);
      sweep();
      return chained(slug, async (): Promise<PageStatePatchResponse> => {
        const entry = await entryFor(slug, dir);
        // Checked inside the chain, right before anything is applied: a Clear counted while this
        // waited behind a write or a load is seen.
        if (isOlderClear(gen, genOf(slug))) throw new ApiError('stale', PAGE_STATE_STALE_SENTENCE);
        if (entry.linked) throw new ApiError('invalid', PAGE_STATE_LINK_SENTENCE);
        if (entry.failure !== null) {
          const failure = entry.failure;
          entry.failure = null;
          scheduleWrite(entry);
          throw new ApiError('internal', folderErrorSentence(failure, dir));
        }
        const outcome = applyPageStateDelta(entry.items, entry.chars, delta, PAGE_STATE_MAX_CHARS);
        if (!outcome.ok) throw new ApiError('too-large', PAGE_STATE_CAP_SENTENCE);
        if (outcome.changed) {
          entry.chars = outcome.chars;
          entry.damaged = false;
          entry.dirty = true;
          scheduleWrite(entry);
          hub.emit({ slug, kind: 'page-state' });
        }
        return { chars: entry.chars, gen: genOf(slug) };
      });
    },

    async clear(slug) {
      assertSlug(slug);
      // The Clear takes its place on the slug's chain synchronously, before anything waits, and looks
      // the folder up inside it: a PATCH asked after this Clear joins the chain behind it (its own
      // folder lookup comes first), so it is checked against the counted Clear even when its lookup
      // answers before this one's. A design that is gone answers 404 without counting a Clear.
      const gen = await chained(slug, async (): Promise<string> => {
        const dir = await pageStateDirOf(store, slug);
        clears.set(slug, (clears.get(slug) ?? 0) + 1);
        const counted = genOf(slug);
        const previous = entries.get(slug);
        if (previous) {
          cancelWrite(previous);
          previous.dropped = true;
        }
        const fresh = empty(slug, dir);
        entries.set(slug, fresh);
        let file: string;
        try {
          file = await resolvePlainTarget(dir, PAGE_STATE_SEGMENTS, { allowAbsent: true });
        } catch (error) {
          if (isLinkRefusal(error)) {
            fresh.linked = true;
            throw new ApiError('invalid', PAGE_STATE_LINK_SENTENCE);
          }
          // `.chamber` is a plain file: there is no saved data to remove.
          if (errorCode(error) === 'ENOTDIR') return counted;
          throw new ApiError('internal', folderErrorSentence(error, dir));
        }
        try {
          await unlink(file);
        } catch (error) {
          if (isMissing(error)) return counted;
          // Could not remove it (a Windows lock): replace it with no data instead, so it never comes back.
          fresh.dirty = true;
          await writeNow(fresh);
          if (fresh.failure !== null) {
            const failure = fresh.failure;
            fresh.failure = null;
            throw new ApiError('internal', folderErrorSentence(failure, dir));
          }
        }
        return counted;
      });
      hub.emit({ slug, kind: 'page-state' });
      return { ok: true, gen };
    },

    flush,

    async dispose() {
      unsubscribe();
      await flush();
    },
  };
};

// ---- wiring (routes and shutdown share one instance per context) ----

const instances = new WeakMap<ServiceContext, PageStateService>();

export const ensurePageStateService = (ctx: ServiceContext): PageStateService => {
  const existing = instances.get(ctx);
  if (existing) return existing;
  const created = createPageStateService({ store: ctx.store, hub: ctx.hub, log: ctx.log });
  instances.set(ctx, created);
  ctx.onDispose(() => created.dispose());
  return created;
};
