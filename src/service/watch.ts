// The designs-root watcher (docs/SPEC.md §9.4, §4.8) — a generalisation of design-canvas
// `service/screens-watch.ts`: an `fs.watch(root, { recursive: true })` fast path PLUS a 3 s
// stat-poll backstop, because OneDrive/network roots drop watch events (SPEC §16). On Linux
// the fast path is folder-watch.ts (one plain watch per folder) instead of Node's recursive
// mode. Events debounce 250 ms per slug, then land on the change hub as `added` / `removed` /
// `design` (design.json) / `files` (anything else, with relative paths).
//
// Ignored: every dot-path — root-level `.trash`/`.exports`, per-design `.chamber/`,
// `.versions/`, `.thumb.png` and the store's dot-prefixed tmp files — so the service's own
// writes never echo back as agent changes (together with the byte-equal merge skip in
// store.ts, that closes the watch loop). Hand edits write real design files, so those are told
// apart by bytes instead: a file now holding exactly what the service last wrote there is the
// edit's echo and is dropped from the batch (`selfWrites`, Phase 2 §2.6).
//
// Loose HTML files directly in the root (agent-guidance spec §3.5) are not designs, but the
// panel offers to import them: a root-level `*.html`/`*.htm` event schedules a root rescan, and
// a change in the sorted list of loose names emits one `{ slug: null, kind: 'loose' }`.
//
// The 3 s poll is a backstop, not the main path. While the live watcher is healthy it
// fingerprints only a rotating tenth of the designs per tick (a full pass in about 30 s, so a
// change the watcher silently dropped on OneDrive/network still shows). With no watcher, or on
// a poll-only root, every design gets the cheap fingerprint each tick (design.json, index.html,
// screens, top-level files: changes within 3 s) and the nested walk of `assets/**` rotates
// through the designs the same way (every design's nested files re-checked within about 30 s):
// walking 300 files in each of 300 designs every 3 s cost over a second of CPU per tick.
// A tick never starts while the previous one is still running (slow SMB shares).
//
// A root change (settings) restarts the watcher on the new root and emits one `root` event;
// files are never moved (§9.2). A broken fs.watch degrades to poll-only and is retried; one
// that cannot work on this root — recursive watching unsupported, or Linux's inotify watch
// limit reached (ENOSPC: every folder is a separate inotify watch there) — is logged once and not
// retried until the root changes: the poll backstop alone keeps the list live. It never kills
// the service and never reaches the user.

import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { WATCH_DEBOUNCE_MS, WATCH_POLL_MS } from '../shared/limits.ts';
import type { ChangeHub, Logger, SelfWrites, SettingsStore } from './context.ts';
import { linuxRecursiveWatch } from './folder-watch.ts';
import { isLooseHtmlName } from './loose.ts';
import { isAtomicTempName, isSlug } from './paths.ts';
import { isDirectory } from './root.ts';

/** Top-level files whose mtime/size the poll backstop fingerprints (SPEC §9.4). */
const TRACKED_TOP_FILES = ['design.json', 'index.html', 'DESIGN.md', 'tokens.css'] as const;

/** `<design>/.chamber/check.json`, written by the check CLI or the service's own run: a `checks` event, not a `files` one. */
const CHECK_REPORT = '.chamber/check.json';

/** Entries the nested walk of one fingerprint may add (everything under the top-level folders); top-level files and folders are always keyed. */
export const FINGERPRINT_ENTRIES_MAX = 256;
/** Folder levels a fingerprint lists below the design folder (`assets/` is level 1). */
const FINGERPRINT_DEPTH_MAX = 6;
/** Poll ticks for the rotating sweep to pass over every design while the live watcher is healthy (about 30 s at 3 s). */
const SWEEP_TICKS = 10;

export type Fingerprint = Map<string, string>;

const fingerprintEntry = (info: { mtimeMs: number; size: number } | null): string | null =>
  info === null ? null : `${info.mtimeMs}:${info.size}`;

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Cheap per-design stat set: tracked top files, every screens/*.html, the assets/ mtime, extra
 * top-level files by `mtime:size`, and a capped depth-first walk of the other top-level folders
 * (`assets` first, then by name, names sorted per folder: readdir order differs by platform and an
 * unsorted walk would move the cap boundary and invent changes). Dot names and symlinks are
 * skipped, so a link to `/` cannot send the poll across the disk; once `budget` entries are used
 * the walk stops and a `<dir>/…` marker is recorded. With `nested` false the walk is skipped
 * (the cheap, per-tick form); `carryNested` fills those keys in from the last full one. The design
 * folder's own mtime is not used:
 * the service's dot writes in it (`.thumb.png` publish, design.json tmp files) would read as
 * content changes.
 */
export const takeFingerprint = async (dir: string, budget: number = FINGERPRINT_ENTRIES_MAX, nested = true): Promise<Fingerprint> => {
  const fingerprint: Fingerprint = new Map();
  for (const name of TRACKED_TOP_FILES) {
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) fingerprint.set(name, fingerprintEntry(info) ?? '');
  }
  const screensDir = path.join(dir, 'screens');
  for (const entry of await readdir(screensDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const info = await stat(path.join(screensDir, entry.name)).catch(() => null);
    if (info !== null) fingerprint.set(`screens/${entry.name}`, fingerprintEntry(info) ?? '');
  }
  // The one `.chamber/` file that is news to the UI: a finished design check.
  const checkReport = await stat(path.join(dir, CHECK_REPORT)).catch(() => null);
  if (checkReport?.isFile()) fingerprint.set(CHECK_REPORT, fingerprintEntry(checkReport) ?? '');
  const assets = await stat(path.join(dir, 'assets')).catch(() => null);
  if (assets?.isDirectory()) fingerprint.set('assets/', `${assets.mtimeMs}:dir`);

  // Every top-level file and folder is keyed first and outside the walk budget, so the cheap form
  // (`nested` false) and the full one always agree on them. If the walk's budget gated these keys,
  // a design past the cap would flip `fonts/` in and out between the two forms and read as changed.
  const top = (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'screens' && !isAtomicTempName(entry.name))
    .sort(byName);
  for (const entry of top) {
    if (!entry.isFile() || fingerprint.has(entry.name)) continue;
    const info = await stat(path.join(dir, entry.name)).catch(() => null);
    if (info !== null) fingerprint.set(entry.name, fingerprintEntry(info) ?? '');
  }
  const folders = top.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).sort((a, b) => (a.name === 'assets' ? -1 : b.name === 'assets' ? 1 : byName(a, b)));
  // `assets/` already has its mtime key; the others get a presence key like a walked folder does.
  for (const entry of folders) if (entry.name !== 'assets') fingerprint.set(`${entry.name}/`, 'dir');
  if (!nested) return fingerprint;

  let left = budget;
  /** Spend one walk entry; false (and the `<topDir>/…` marker) once the budget is gone. */
  const spend = (topDir: string): boolean => {
    if (left > 0) {
      left -= 1;
      return true;
    }
    fingerprint.set(`${topDir}/…`, 'truncated');
    return false;
  };

  /** Depth-first, sorted. Answers false when the budget ran out (the caller stops everything). */
  const walk = async (absDir: string, relDir: string, topDir: string, depth: number): Promise<boolean> => {
    const entries = (await readdir(absDir, { withFileTypes: true }).catch(() => [])).filter((entry) => !entry.name.startsWith('.') && !isAtomicTempName(entry.name)).sort(byName);
    for (const entry of entries) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!spend(topDir)) return false;
        fingerprint.set(`${rel}/`, 'dir');
        if (depth < FINGERPRINT_DEPTH_MAX && !(await walk(path.join(absDir, entry.name), rel, topDir, depth + 1))) return false;
      } else if (entry.isFile()) {
        if (!spend(topDir)) return false;
        const info = await stat(path.join(absDir, entry.name)).catch(() => null);
        if (info !== null) fingerprint.set(rel, fingerprintEntry(info) ?? '');
      }
    }
    return true;
  };

  for (const entry of folders) {
    if (!(await walk(path.join(dir, entry.name), entry.name, entry.name, 1))) return fingerprint;
  }
  return fingerprint;
};

/** A key from inside a folder (`assets/a.png`, `assets/img/`, `assets/…`), not a top-level one, `<top>/`, or `screens/*.html`. */
const isNestedKey = (key: string): boolean => {
  if (key.startsWith('screens/')) return false;
  const segments = key.split('/');
  return segments.length >= 3 || (segments.length === 2 && segments[1] !== '');
};

/**
 * A cheap fingerprint plus the nested keys of the last full one, for the folders that still exist,
 * so a tick that skipped the walk reports no change for files it did not look at.
 */
export const carryNested = (previous: Fingerprint | undefined, cheap: Fingerprint): Fingerprint => {
  if (previous === undefined) return cheap;
  const merged: Fingerprint = new Map(cheap);
  for (const [key, value] of previous) {
    if (isNestedKey(key) && cheap.has(`${key.slice(0, key.indexOf('/'))}/`)) merged.set(key, value);
  }
  return merged;
};

/**
 * The next `count` entries of the sorted list from `cursor`, wrapping, and where the following
 * slice starts. An empty list yields an empty slice; a cursor past a list that shrank wraps.
 */
export const sweepSlice = (sorted: readonly string[], cursor: number, count: number): { slice: string[]; next: number } => {
  const size = sorted.length;
  if (size === 0) return { slice: [], next: 0 };
  const take = Math.min(Math.max(0, Math.floor(count)), size);
  const start = ((Math.floor(cursor) % size) + size) % size;
  const slice: string[] = [];
  for (let i = 0; i < take; i += 1) slice.push(sorted[(start + i) % size] ?? '');
  return { slice, next: (start + take) % size };
};

const diffFingerprints = (previous: Fingerprint, next: Fingerprint): string[] => {
  const changed: string[] = [];
  for (const [key, value] of next) if (previous.get(key) !== value) changed.push(key);
  for (const key of previous.keys()) if (!next.has(key)) changed.push(key);
  return changed.sort();
};

export type WatcherOptions = {
  settings: SettingsStore;
  hub: ChangeHub;
  log: Logger;
  /** Default `WATCH_DEBOUNCE_MS` (250). */
  debounceMs?: number;
  /** Default `WATCH_POLL_MS` (3000). Tests inject a small value. */
  pollMs?: number;
  /** Test seam; defaults to `fs.watch` (Linux: `linuxRecursiveWatch`). */
  watchImpl?: typeof fsWatch;
  /** Ticks for the rotating sweep to cover every design while the live watcher is healthy. Default `SWEEP_TICKS` (10). */
  sweepTicks?: number;
  /** Test seam; defaults to `takeFingerprint`. `nested: false` is the cheap per-tick form. */
  fingerprint?: (dir: string, options: { nested: boolean }) => Promise<Fingerprint>;
  /**
   * The service's own writes (Phase 2 §2.6): a file whose current bytes are the ones the service
   * left there is the echo of a hand edit and is not reported. Without it every change is reported.
   */
  selfWrites?: SelfWrites;
};

export type Watcher = {
  stop(): void;
  /**
   * Settles once the current root's baseline is seeded (at startup, and again after each root
   * switch); a folder created before then is part of it, not `added`.
   */
  readonly ready: Promise<void>;
  /** Run one poll tick now (test seam: deterministic, no timers). Rejects if the tick fails. */
  pollNow(): Promise<void>;
};

/** Pending debounced batch per slug (`ROOT_KEY` = a whole-root rescan). */
type PendingEntry = { files: Set<string>; timer: ReturnType<typeof setTimeout> };

const ROOT_KEY = '\0root';

/** fs.watch failures that a retry cannot fix while the root stays the same. */
const PERMANENT_WATCH_FAILURES = new Set(['ENOSPC', 'ENOSYS', 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM']);

export const isPermanentWatchFailure = (error: unknown): boolean =>
  PERMANENT_WATCH_FAILURES.has(String((error as NodeJS.ErrnoException | null)?.code ?? ''));

export const startWatcher = (options: WatcherOptions): Watcher => {
  const { settings, hub, log } = options;
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  const pollMs = options.pollMs ?? WATCH_POLL_MS;
  const sweepTicks = Math.max(1, Math.floor(options.sweepTicks ?? SWEEP_TICKS));
  const fingerprint = options.fingerprint ?? ((dir: string, { nested }: { nested: boolean }) => takeFingerprint(dir, undefined, nested));
  // Linux: one plain watch per folder (folder-watch.ts) — Node's recursive watch there misses
  // writes to files that were replaced by rename.
  const watchImpl = options.watchImpl ?? (process.platform === 'linux' ? linuxRecursiveWatch : fsWatch);

  let stopped = false;
  let currentRoot = settings.root();
  let watcher: FSWatcher | null = null;
  let watchErrorLogged = false;
  /** Set by a permanent failure: poll-only until the root changes. */
  let pollOnly = false;
  let knownSlugs = new Set<string>();
  /** Sorted loose html names in the root, `/`-joined (a name never holds a `/`). */
  let knownLoose = '';
  const fingerprints = new Map<string, Fingerprint>();
  /** Where the next rotating sweep slice starts in the sorted slug list. */
  let sweepCursor = 0;
  const pending = new Map<string, PendingEntry>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const schedule = (key: string, files: string[]): void => {
    if (stopped) return;
    const existing = pending.get(key);
    if (existing !== undefined) {
      for (const file of files) existing.files.add(file);
      return;
    }
    const entry: PendingEntry = {
      files: new Set(files),
      timer: setTimeout(() => {
        pending.delete(key);
        const batch = new Set(entry.files);
        const run = key === ROOT_KEY ? scanRoot() : flushSlug(key, batch);
        run.catch((error) => log.warn('watch.flush-failed', { key, error: error instanceof Error ? error.message : String(error) }));
      }, debounceMs),
    };
    // Never hold the process open for a pending tick.
    entry.timer.unref?.();
    pending.set(key, entry);
  };

  /** Fill knownSlugs/knownLoose/fingerprints WITHOUT emitting — used at startup and after a root switch. */
  const seedScan = async (): Promise<void> => {
    const root = currentRoot;
    const listing = await readRoot(root);
    knownSlugs = listing.slugs;
    knownLoose = listing.loose;
    for (const slug of knownSlugs) fingerprints.set(slug, await fingerprint(path.join(root, slug), { nested: true }));
  };

  /** One readdir of the root: design folders, and the loose html files (regular files only, as `GET /designs` lists them). */
  const readRoot = async (root: string): Promise<{ slugs: Set<string>; loose: string }> => {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => null);
    if (entries === null) return { slugs: new Set(), loose: '' };
    return {
      slugs: new Set(entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && isSlug(entry.name)).map((entry) => entry.name)),
      loose: entries
        .filter((entry) => entry.isFile() && isLooseHtmlName(entry.name))
        .map((entry) => entry.name)
        .sort()
        .join('/'),
    };
  };

  /** Root-level diff: slugs that appeared or vanished since the last scan, and the loose html set. */
  const scanRoot = async (): Promise<void> => {
    if (stopped) return;
    const root = currentRoot;
    const listing = await readRoot(root);
    const current = listing.slugs;
    if (listing.loose !== knownLoose) {
      knownLoose = listing.loose;
      hub.emit({ slug: null, kind: 'loose' });
    }
    for (const slug of knownSlugs) {
      if (current.has(slug)) continue;
      fingerprints.delete(slug);
      hub.emit({ slug, kind: 'removed' });
    }
    for (const slug of current) {
      if (knownSlugs.has(slug)) continue;
      fingerprints.set(slug, await fingerprint(path.join(root, slug), { nested: true }));
      hub.emit({ slug, kind: 'added' });
    }
    knownSlugs = current;
  };

  /**
   * E10: remove from the batch every file that now holds exactly the bytes the service itself
   * left there (the user's own write, already announced with `origin: "user"`). The entry is not
   * consumed, so a doubled Windows event or the poll backstop reading it later is dropped too. A
   * file holding other bytes is the agent's: kept, and its entry forgotten, so a later write that
   * happens to restore the user's bytes (B, then A again) is still shown.
   */
  const dropEchoes = async (slug: string, dir: string, files: Set<string>): Promise<void> => {
    const selfWrites = options.selfWrites;
    if (selfWrites === undefined) return;
    for (const rel of [...files]) {
      if (rel === CHECK_REPORT) continue; // the check CLI's report, never a hand edit
      if (await selfWrites.isEcho(slug, rel, dir)) files.delete(rel);
      else selfWrites.forget(slug, rel);
    }
  };

  const flushSlug = async (slug: string, files: Set<string>): Promise<void> => {
    if (stopped) return;
    const dir = path.join(currentRoot, slug); // slug passed isSlug at schedule time or came from readSlugs
    if (!isSlug(slug) || !(await isDirectory(dir))) {
      fingerprints.delete(slug);
      if (knownSlugs.delete(slug)) hub.emit({ slug, kind: 'removed' });
      return;
    }
    if (!knownSlugs.has(slug)) {
      knownSlugs.add(slug);
      fingerprints.set(slug, await fingerprint(dir, { nested: true }));
      hub.emit({ slug, kind: 'added' });
      return;
    }
    const previous = fingerprints.get(slug);
    const next = await fingerprint(dir, { nested: true });
    fingerprints.set(slug, next);
    // Windows' recursive watch and OneDrive drop or coalesce events: a change this batch did not
    // name is reported with it, because the fingerprint just moved past it and the poll backstop
    // would never see it again (a design.json left unreconciled, a design stuck provisional).
    if (previous !== undefined) for (const key of diffFingerprints(previous, next)) files.add(key);
    await dropEchoes(slug, dir, files);
    const hasDesignJson = files.delete('design.json');
    const hasChecks = files.delete(CHECK_REPORT);
    const rest = [...files].sort();
    if (hasDesignJson) hub.emit({ slug, kind: 'design' });
    if (rest.length > 0) hub.emit({ slug, kind: 'files', files: rest });
    if (hasChecks) hub.emit({ slug, kind: 'checks' });
  };

  const onWatchEvent = (filename: string | Buffer | null): void => {
    if (stopped) return;
    if (filename === null) {
      // Some platforms never name the file: rescan the root instead.
      schedule(ROOT_KEY, []);
      return;
    }
    const relative = String(filename).replace(/\\/g, '/');
    const segments = relative.split('/').filter((segment) => segment.length > 0);
    const first = segments[0];
    if (segments.length === 1 && first !== undefined && !first.startsWith('.') && /\.html?$/i.test(first)) {
      // A loose html file in the root appeared, changed or vanished: the rescan decides whether the set changed.
      schedule(ROOT_KEY, []);
      return;
    }
    if (first === undefined || !isSlug(first) || first.startsWith('.')) return; // other root-level files, .trash/.exports, non-designs
    const rest = segments.slice(1);
    if (rest.length === 2 && rest.join('/') === CHECK_REPORT) {
      schedule(first, [CHECK_REPORT]);
      return;
    }
    // .chamber/, .versions/, .thumb.png and the store's .tmp files are service-owned: ignored.
    if (rest.some((segment) => segment.startsWith('.'))) return;
    // An older build's undotted temp name (`index.html.2bba59ef828e.tmp`) is service-owned too.
    if (isAtomicTempName(segments[segments.length - 1] ?? '')) return;
    schedule(first, rest.length > 0 ? [rest.join('/')] : []);
  };

  /** Log a watch failure once per root; a permanent one switches this root to poll-only. */
  const noteWatchFailure = (event: 'watch.degraded' | 'watch.unavailable', error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (isPermanentWatchFailure(error)) {
      if (!pollOnly) log.info('watch.poll-only', { root: currentRoot, code: (error as NodeJS.ErrnoException).code, error: message });
      pollOnly = true;
      watchErrorLogged = true;
      return;
    }
    if (!watchErrorLogged) {
      watchErrorLogged = true;
      log.warn(event, { root: currentRoot, error: message });
    }
  };

  const startFsWatch = (): void => {
    if (stopped || watcher !== null || pollOnly) return;
    try {
      watcher = watchImpl(currentRoot, { recursive: true, persistent: false }, (_event, filename) => onWatchEvent(filename));
      watcher.on('error', (error) => {
        // A broken fs.watch (EMFILE, network root) degrades to poll-only; pollTick retries
        // unless the failure is permanent (inotify limit).
        noteWatchFailure('watch.degraded', error);
        closeWatcher();
      });
    } catch (error) {
      // Root missing (retried by pollTick once it exists) or recursive watch unsupported.
      watcher = null;
      noteWatchFailure('watch.unavailable', error);
    }
  };

  const pollTick = async (): Promise<void> => {
    if (stopped) return;
    // Judged BEFORE a restart below: a watcher that was down since the last tick missed events, and
    // a fresh one does not replay them, so this tick must look at every design.
    const healthy = watcher !== null && !pollOnly;
    if (watcher === null && !pollOnly && (await isDirectory(currentRoot))) startFsWatch();
    await scanRoot();
    // A healthy live watcher reports changes itself, so the poll only re-checks a rotating slice,
    // fully, as the net under events the platform dropped. Without one (never started, died,
    // poll-only root) every design gets the cheap fingerprint and the rotating slice also gets the
    // nested walk: that walk is what costs, and every design still gets it within `sweepTicks` ticks.
    const sorted = [...knownSlugs].sort();
    const swept = sweepSlice(sorted, sweepCursor, Math.ceil(sorted.length / sweepTicks));
    sweepCursor = swept.next;
    const deep = new Set(swept.slice);
    for (const slug of healthy ? swept.slice : sorted) {
      const dir = path.join(currentRoot, slug);
      const nested = deep.has(slug);
      const previous = fingerprints.get(slug);
      const taken = await fingerprint(dir, { nested });
      const next = nested ? taken : carryNested(previous, taken);
      fingerprints.set(slug, next);
      if (previous === undefined) continue; // baseline seeded this tick
      const changed = diffFingerprints(previous, next);
      if (changed.length > 0) schedule(slug, changed);
    }
  };

  const clearPending = (): void => {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
  };

  const closeWatcher = (): void => {
    try {
      watcher?.close();
    } catch {
      /* already closed */
    }
    watcher = null;
  };

  const unsubscribeRoot = settings.onRootChange((newRoot) => {
    // Never move files (§9.2): just re-point the watcher and tell the clients to refetch all.
    closeWatcher();
    clearPending();
    currentRoot = newRoot;
    pollOnly = false;
    watchErrorLogged = false;
    knownSlugs = new Set();
    knownLoose = '';
    fingerprints.clear();
    sweepCursor = 0;
    hub.emit({ slug: null, kind: 'root' });
    startFsWatch();
    ready = seedScan().catch((error) => log.warn('watch.seed-failed', { error: error instanceof Error ? error.message : String(error) }));
  });

  startFsWatch();
  let ready = seedScan().catch((error) => log.warn('watch.seed-failed', { error: error instanceof Error ? error.message : String(error) }));
  let tickRunning = false;
  pollTimer = setInterval(() => {
    if (tickRunning) return; // a slow share: let the running tick finish instead of stacking another
    tickRunning = true;
    pollTick()
      .catch((error) => log.warn('watch.poll-failed', { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        tickRunning = false;
      });
  }, pollMs);
  pollTimer.unref?.();

  return {
    get ready() {
      return ready;
    },
    pollNow: () => pollTick(),
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribeRoot();
      closeWatcher();
      clearPending();
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
    },
  };
};
