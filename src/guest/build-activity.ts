// What the linked agent is doing to this design right now (documentation/specs/phase-1-review-loop.md §2).
// Two sources the frame already has: file events for the design (the change feed) and the linked
// chat's activity (`onSessions`). A pure reducer folds them, with the design detail and the
// feed status, into one `BuildTrack`; `phaseOf` turns a track and the clock into the phase the
// strip shows (first match wins); `nextDeadline` says when that can change by time alone, so the
// watcher keeps one `setTimeout` and never polls. No UI here, and no host call but the
// read-only `listProjects` and `onSessions`.

import type { GuestSessionActivity, GuestSessionsSnapshot } from '@openchamber/sdk';

import type { DesignDetailResponse } from '../shared/api.ts';
import type { ChangeEvent } from '../shared/types.ts';
import type { ChangeFeed, FeedStatus } from './changes.ts';
import { sameDirectory } from './flows.ts';
import type { GuestHost } from './host.ts';

// ---- Timings (read only by this module, its tests and the strip's copy) ----

/** A file landed less than this long ago: the agent is writing right now. */
export const WRITING_WINDOW_MS = 15_000;
/** Working this long with nothing saved: the strip says so. */
export const QUIET_MS = 120_000;
/** How long "Done" stays after the turn ends. */
export const DONE_LINGER_MS = 8_000;
/** A design with nothing written this long after it was created: probably waiting on a question. */
export const PENDING_STALL_MS = 180_000;
/** The feed has to be failing this long before the strip admits it. */
export const FEED_DOWN_MS = 5_000;
/** How long the board the agent just wrote stays highlighted. */
export const RECENT_MS = 6_000;
/**
 * After a user's restore (a `files` event with no list) the folder watcher re-reports every file
 * the restore wrote, a debounce later and in batches. Listed file events inside this window are
 * the restore's echo, not the agent writing.
 */
export const RESTORE_QUIET_MS = 3_000;
/** A host that reports `unknown` activity mid-turn (a reconnect) is believed to be where it was for this long. */
export const UNKNOWN_HOLD_MS = 30_000;
/** Distinct files remembered for one turn ("Updated 3 files"). */
const TURN_FILES_MAX = 50;

// ---- Types ----

/** The host's activity, or what we know without it: `gone` (not in the project's chats), `none` (no link, no project, no grant). */
export type LinkedActivity = GuestSessionActivity | 'gone' | 'none';
export type TurnOutcome = 'completed' | 'failed' | null;

export type BuildInput =
  | { kind: 'files'; at: number; files: string[]; created: boolean } // already filtered by `agentFiles`
  | { kind: 'session'; at: number; activity: LinkedActivity; outcome: TurnOutcome }
  | { kind: 'detail'; at: number; pending: boolean; created: number; screensWritten: number; screensTotal: number; isCanvas: boolean }
  | { kind: 'feed'; at: number; state: FeedStatus['state'] }
  | { kind: 'dismiss'; at: number }
  /** The service restarted or the feed fell behind: whatever "last file" we hold is stale. */
  | { kind: 'reset'; at: number }
  /** The user restored a version: its file events are not the agent. */
  | { kind: 'restore'; at: number };

export type BuildTrack = {
  activity: LinkedActivity;
  outcome: TurnOutcome;
  turnStartedAt: number | null;
  /** This frame saw the turn start, so Done and Failed may be claimed for it. */
  turnSeen: boolean;
  idleAt: number | null;
  /** Distinct agent files since the turn started, capped at 50. */
  turnFiles: string[];
  /** `path: null` is "the agent started writing" with no file name (an `added` event). */
  lastFile: { path: string | null; at: number } | null;
  pending: boolean;
  createdAt: number;
  screensWritten: number;
  screensTotal: number;
  isCanvas: boolean;
  feedDownSince: number | null;
  dismissedAt: number | null;
  /** When the host last started reporting `unknown`; `activity` keeps its last known value until `UNKNOWN_HOLD_MS` has passed. */
  unknownSince: number | null;
  /** When a user's restore was last seen; agent files inside `RESTORE_QUIET_MS` of it are its echo. */
  restoredAt: number | null;
  /** Whether the strip was showing when the feed went down; the offline notice is only for a strip the user was already watching. */
  visible: boolean;
};

export type BuildPhase = 'hidden' | 'offline' | 'question' | 'permission' | 'failed' | 'writing' | 'retrying' | 'working' | 'done' | 'stalled';

export const initialTrack = (now: number): BuildTrack => ({
  activity: 'none',
  outcome: null,
  turnStartedAt: null,
  turnSeen: false,
  idleAt: null,
  turnFiles: [],
  lastFile: null,
  pending: false,
  createdAt: now,
  screensWritten: 0,
  screensTotal: 0,
  isCanvas: false,
  feedDownSince: null,
  dismissedAt: null,
  unknownSince: null,
  restoredAt: null,
  visible: false,
});

// ---- Files ----

const SERVICE_FOLDERS = ['.versions/', '.chamber/', '.trash/'];

/** Paths the agent wrote, from a `files` event's list: the service's own folders, design.json and temp files (`index.html.2bba59ef828e.tmp`, mid-write) are not the agent's output. A display filter, not a security check. */
export const agentFiles = (files: readonly string[]): string[] => [
  ...new Set(files.filter((file) => file !== 'design.json' && !file.endsWith('.tmp') && !SERVICE_FOLDERS.some((folder) => file.startsWith(folder)))),
];

/**
 * What one feed batch says about the agent writing this design. A `files` event with no list is
 * what a user's restore emits: `restored` is true and the batch's file lists are dropped (they
 * are the restore's own writes). An `added` event counts as "started writing" with no file name.
 */
export const batchAgentFiles = (events: readonly ChangeEvent[], slug: string): { files: string[]; created: boolean; restored: boolean } => {
  const files: string[] = [];
  let created = false;
  let restored = false;
  for (const event of events) {
    if (event.slug !== slug) continue;
    if (event.kind === 'added') created = true;
    else if (event.kind === 'files') {
      if (event.files) files.push(...event.files);
      else restored = true;
    }
  }
  return { files: restored ? [] : agentFiles(files), created, restored };
};

/** Inside the echo of a user's restore: file events are not the agent's. */
export const inRestoreQuiet = (track: BuildTrack, now: number): boolean => track.restoredAt !== null && now - track.restoredAt < RESTORE_QUIET_MS;

// ---- Pure core ----

const isWorking = (activity: LinkedActivity): boolean => activity === 'running' || activity === 'retrying';
const isActive = (activity: LinkedActivity): boolean => isWorking(activity) || activity === 'waiting-permission' || activity === 'waiting-question';
const isLinkLost = (activity: LinkedActivity): boolean => activity === 'none' || activity === 'gone';

/** This frame watched a turn start and the chat is idle again: the turn is over. */
const turnOver = (track: BuildTrack): boolean => track.turnSeen && track.activity === 'idle';
/**
 * A recent file is the agent "writing" unless the turn is over, or the linked chat is known to be idle
 * (then the save is the user's own, or another tool's: files still count toward a turn, they just are not shown as the agent at work).
 * Files-only mode (`none`, `gone`) and an `unknown` hold keep showing it.
 */
const showsWriting = (track: BuildTrack): boolean => track.lastFile !== null && !turnOver(track) && track.activity !== 'idle';

const mergeFiles = (known: readonly string[], more: readonly string[]): string[] => [...new Set([...known, ...more])].slice(0, TURN_FILES_MAX);

export const reduceBuild = (track: BuildTrack, input: BuildInput): BuildTrack => {
  switch (input.kind) {
    case 'files': {
      if (input.files.length === 0 && !input.created) return track;
      if (inRestoreQuiet(track, input.at)) return track;
      // Order inside a batch must not matter: the name shown is the last in sort order.
      const path = [...input.files].sort().at(-1) ?? null;
      return { ...track, lastFile: { path, at: input.at }, turnFiles: mergeFiles(track.turnFiles, input.files), pending: false, dismissedAt: null };
    }
    case 'session': {
      if (input.activity === 'unknown') {
        // The host does not know (a reconnect): hold the last known state, for a while.
        return track.unknownSince !== null ? track : { ...track, unknownSince: input.at };
      }
      const held = track.unknownSince !== null;
      if (track.activity === input.activity && track.outcome === input.outcome) return held ? { ...track, unknownSince: null } : track;
      let next: BuildTrack = { ...track, activity: input.activity, outcome: input.outcome, unknownSince: null };
      const wasActive = isActive(track.activity);
      const nowActive = isActive(input.activity);
      if (!wasActive && nowActive) {
        return { ...next, turnSeen: true, turnStartedAt: input.at, turnFiles: [], lastFile: null, idleAt: null, dismissedAt: null };
      }
      if (isLinkLost(input.activity)) {
        // No session knowledge: the strip never claims Done or Failed from silence.
        next = { ...next, turnSeen: false, turnStartedAt: null, idleAt: null };
      } else if (input.activity === 'idle' && track.activity !== 'idle') {
        next = { ...next, idleAt: next.turnSeen ? (next.idleAt ?? input.at) : null };
      }
      return next;
    }
    case 'detail': {
      if (
        track.pending === input.pending &&
        track.createdAt === input.created &&
        track.screensWritten === input.screensWritten &&
        track.screensTotal === input.screensTotal &&
        track.isCanvas === input.isCanvas
      ) {
        return track;
      }
      return { ...track, pending: input.pending, createdAt: input.created, screensWritten: input.screensWritten, screensTotal: input.screensTotal, isCanvas: input.isCanvas };
    }
    case 'feed': {
      if (input.state === 'retrying') {
        if (track.feedDownSince !== null) return track;
        // Was the strip showing before the outage? Judged without the outage itself.
        const visible = phaseOf({ ...track, feedDownSince: null }, input.at) !== 'hidden';
        return { ...track, feedDownSince: input.at, visible };
      }
      // Connecting, live, paused (hidden frame) and stopped are not an outage.
      return track.feedDownSince === null ? track : { ...track, feedDownSince: null, visible: false };
    }
    case 'dismiss':
      return track.dismissedAt === input.at ? track : { ...track, dismissedAt: input.at };
    case 'reset':
      return track.lastFile === null ? track : { ...track, lastFile: null };
    case 'restore': {
      // A batch of the restore's writes can land before its own event: forget a "last file" from just before it too.
      const echoed = track.lastFile !== null && input.at - track.lastFile.at < RESTORE_QUIET_MS;
      return { ...track, restoredAt: input.at, lastFile: echoed ? null : track.lastFile };
    }
  }
};

/** `unknown` held for too long stops being "where it was": the track then reads as unknown. */
const settled = (track: BuildTrack, now: number): BuildTrack =>
  track.unknownSince !== null && now - track.unknownSince >= UNKNOWN_HOLD_MS ? { ...track, activity: 'unknown' } : track;

/** The phase the strip is in at `now`; first match wins (§2.3). */
export const phaseOf = (held: BuildTrack, now: number): BuildPhase => {
  const track = settled(held, now);
  const dismissed = track.dismissedAt !== null;
  if (track.feedDownSince !== null && track.visible && now - track.feedDownSince >= FEED_DOWN_MS) return 'offline';
  if (track.activity === 'waiting-question') return 'question';
  if (track.activity === 'waiting-permission') return 'permission';
  if (turnOver(track) && track.outcome === 'failed' && !dismissed) return 'failed';
  // Once the turn is over the files are the turn's: they count in "Updated 3 files", they are not "Writing".
  if (track.lastFile && showsWriting(track) && now - track.lastFile.at < WRITING_WINDOW_MS) return 'writing';
  if (track.activity === 'retrying') return 'retrying';
  if (track.activity === 'running') return 'working';
  if (turnOver(track) && track.outcome !== 'failed' && track.idleAt !== null && now - track.idleAt < DONE_LINGER_MS) return 'done';
  if (track.pending && !isActive(track.activity) && !dismissed && now - track.createdAt >= PENDING_STALL_MS) return 'stalled';
  return 'hidden';
};

/** The next moment, after `now`, at which `phaseOf` can answer differently with no new input; null when none. */
export const nextDeadline = (held: BuildTrack, now: number): number | null => {
  const track = settled(held, now);
  const at: number[] = [];
  if (held.unknownSince !== null) at.push(held.unknownSince + UNKNOWN_HOLD_MS);
  if (track.feedDownSince !== null && track.visible) at.push(track.feedDownSince + FEED_DOWN_MS);
  if (track.lastFile && showsWriting(track)) at.push(track.lastFile.at + WRITING_WINDOW_MS);
  if (isWorking(track.activity)) {
    const since = track.lastFile?.at ?? track.turnStartedAt;
    if (since !== null) at.push(since + QUIET_MS);
  }
  if (turnOver(track) && track.outcome !== 'failed' && track.idleAt !== null) at.push(track.idleAt + DONE_LINGER_MS);
  if (track.pending && !isActive(track.activity) && track.dismissedAt === null) at.push(track.createdAt + PENDING_STALL_MS);
  const upcoming = at.filter((time) => time > now);
  return upcoming.length > 0 ? Math.min(...upcoming) : null;
};

// ---- Watcher ----

export type BuildActivity = {
  get(): BuildTrack;
  /** Called after every change to the track and at each timed deadline. No replay. */
  subscribe(listener: (track: BuildTrack) => void): () => void;
  dismiss(): void;
  dispose(): void;
};

export type BuildActivityDeps = {
  host: GuestHost;
  feed: ChangeFeed;
  slug: string;
  detail: () => DesignDetailResponse | null;
  onDetail: (listener: () => void) => () => void;
  now?: () => number;
};

export const watchBuildActivity = (deps: BuildActivityDeps): BuildActivity => {
  const { host, feed, slug } = deps;
  const now = deps.now ?? Date.now;
  const listeners = new Set<(track: BuildTrack) => void>();
  let track = initialTrack(now());
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // The link this watcher follows. `generation` retires an older async lookup when the link changes.
  let link: { sessionId: string | null; projectDirectory: string | null } = { sessionId: null, projectDirectory: null };
  let linkKey: string | null = null;
  let generation = 0;
  let stopSessions: (() => void) | null = null;
  /** Session knowledge is the selected chat's busy flag, not `onSessions` (no project, no grant). */
  let fallback = false;

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (disposed) return;
    const current = now();
    const deadline = nextDeadline(track, current);
    if (deadline === null) return;
    timer = setTimeout(() => {
      timer = null;
      notify();
      schedule();
    }, Math.max(0, deadline - current));
  };

  const notify = (): void => {
    for (const listener of [...listeners]) listener(track);
  };

  const apply = (input: BuildInput): void => {
    if (disposed) return;
    const next = reduceBuild(track, input);
    if (next === track) return;
    track = next;
    schedule();
    notify();
  };

  const applySession = (activity: LinkedActivity, outcome: TurnOutcome = null): void => apply({ kind: 'session', at: now(), activity, outcome });

  // ---- session activity ----

  const applyFallback = (): void => {
    const selected = host.session.get();
    if (link.sessionId !== null && selected?.id === link.sessionId) applySession(selected.busy ? 'running' : 'idle');
    else applySession('none');
  };

  const useFallback = (): void => {
    fallback = true;
    applyFallback();
  };

  const onSnapshot = (snapshot: GuestSessionsSnapshot, sessionId: string): void => {
    if (snapshot.state === 'loading') return;
    if (snapshot.state === 'error') {
      useFallback();
      return;
    }
    fallback = false;
    const found = snapshot.sessions.find((session) => session.id === sessionId);
    if (found) applySession(found.activity, found.outcome);
    else applySession('gone');
  };

  const subscribeSessions = async (mine: number, sessionId: string, projectDirectory: string | null): Promise<void> => {
    try {
      const { projects } = await host.client.listProjects();
      if (mine !== generation) return;
      // The design's own project when the host knows it, else the frame's current one (the order `startLinkedSession` uses).
      const frameDirectory = host.directory.get();
      const project =
        (projectDirectory ? projects.find((entry) => sameDirectory(entry.directory, projectDirectory)) : undefined) ??
        (frameDirectory ? projects.find((entry) => sameDirectory(entry.directory, frameDirectory)) : undefined);
      if (!project) {
        useFallback();
        return;
      }
      const stop = await host.client.onSessions(project.id, (snapshot) => {
        if (mine === generation) onSnapshot(snapshot, sessionId);
      });
      if (mine !== generation) stop();
      else stopSessions = stop;
    } catch (error) {
      if (mine !== generation) return;
      // A withdrawn `sessions` grant or a host without the API: the strip works from files alone.
      console.warn('Design Chamber: the build strip cannot read chat activity', error);
      useFallback();
    }
  };

  const relink = (): void => {
    const design = deps.detail()?.design;
    if (!design) return;
    const key = JSON.stringify([design.sessionId, design.projectDirectory, host.directory.get()]);
    if (key === linkKey) return;
    linkKey = key;
    generation += 1;
    stopSessions?.();
    stopSessions = null;
    link = { sessionId: design.sessionId, projectDirectory: design.projectDirectory };
    fallback = false;
    if (design.sessionId === null) {
      applySession('none');
      return;
    }
    void subscribeSessions(generation, design.sessionId, design.projectDirectory);
  };

  // ---- detail, files, feed ----

  const syncDetail = (): void => {
    const detail = deps.detail();
    if (!detail) return;
    const { design } = detail;
    const created = Date.parse(design.created);
    apply({
      kind: 'detail',
      at: now(),
      pending: detail.pending,
      created: Number.isFinite(created) ? created : track.createdAt,
      screensTotal: design.screens.length,
      screensWritten: design.screens.filter((screen) => detail.files.screens[screen.id]?.exists === true).length,
      isCanvas: design.kind === 'canvas',
    });
    relink();
  };

  const unsubscribers = [
    deps.onDetail(syncDetail),
    feed.subscribe((batch) => {
      if (batch.reset) apply({ kind: 'reset', at: now() });
      const { files, created, restored } = batchAgentFiles(batch.events, slug);
      if (restored) apply({ kind: 'restore', at: now() });
      if (files.length > 0 || created) apply({ kind: 'files', at: now(), files, created });
    }),
    feed.onStatus((status) => apply({ kind: 'feed', at: now(), state: status.state })),
    host.session.subscribe(() => {
      if (fallback) applyFallback();
    }),
    host.directory.subscribe(relink),
  ];
  apply({ kind: 'feed', at: now(), state: feed.status().state });
  syncDetail();

  return {
    get: () => track,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dismiss: () => apply({ kind: 'dismiss', at: now() }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const unsubscribe of unsubscribers) unsubscribe();
      stopSessions?.();
      stopSessions = null;
      listeners.clear();
    },
  };
};
