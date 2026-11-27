// Sidebar marks on linked design chats (documentation/specs/native-extras.md §4.2).
//
// Every chat that has a design gets one mark on its sidebar row: a palette, neutral, with the
// design's title; warning when a design has check errors (not warnings) or comments the user
// added and has not sent. Only the design index is read, so `/design-system` chats (which link
// systems, never designs) get no mark (the user's decision 5).
//
// All in memory: marks live as long as the process (N13), so nothing is persisted and a restart
// sets them again from the files. Quiet and cheap: one reconcile at most every
// `MARKS_DEBOUNCE_MS`, never two at once; a design's check counts are read again only after it
// has been quiet for `MARK_SETTLE_MS` and its chat is not working; changes go out at most
// `MARKS_RATE_PER_MIN` in any minute, newest chats first, and only what differs is sent.
//
// Agent-written text (titles, slugs) reaches the host only as the mark's plain `text` through
// `markText`, and never a log line: logs carry counts and outcomes only.

import { SERVICE_MARK_TEXT_MAX, SERVICE_MARKS_MAX, type ServiceMark } from '@openchamber/sdk';

import { DESIGN_INDEX_TURN_WAIT_MS, MARK_CHECK_READ_MS, MARK_SETTLE_MS, MARKS_DEBOUNCE_MS, MARKS_RATE_PER_MIN } from '../shared/limits.ts';
import { stripDisplayControls } from '../shared/display-text.ts';
import { flattenViewText } from '../shared/view.ts';
import type { ChangeEvent, ChangeKind, DesignSummary } from '../shared/types.ts';
import type { ActivityTracker, ChangeHub, DesignIndex, HostCalls, Logger } from './context.ts';

/** The one icon every mark uses (Remixicon). */
export const MARK_ICON = 'palette';
/** How long sending stops after the host says `limited` (its rate window is a minute). */
export const MARKS_LIMITED_PAUSE_MS = 60_000;
/** After a host that once answered stops answering, one retry this much later. */
export const MARKS_UNAVAILABLE_RETRY_MS = 60_000;

/** A design's counted check errors; `null` when it has never been read (or the read failed with nothing known). */
export type MarkCounts = { errors: number } | null;

// ---- text ----

/** One line, without anything that breaks it or reorders the tooltip (bidi controls included); a bidi control between spaces leaves one. */
const cleanTitle = (title: string): string =>
  stripDisplayControls(flattenViewText(title)).replace(/ {2,}/g, ' ').trim() || 'Untitled design';

/** `text` cut so its length (UTF-16 units, as the host counts) is at most `max`, ending in "…"; never splits a surrogate pair. */
const clip = (text: string, max: number): string => {
  if (text.length <= max) return text;
  if (max <= 0) return '';
  let out = '';
  for (const point of text) {
    if (out.length + point.length > max - 1) break;
    out += point;
  }
  return `${out.trimEnd()}…`;
};

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * The mark's tooltip (the host puts "Design Chamber: " before it). `titles` newest first; the
 * first names the chat. Only the non-zero issue parts are said. Always ≤ `SERVICE_MARK_TEXT_MAX`:
 * the title is what gets cut.
 */
export const markText = (titles: readonly string[], issues: { errors: number; comments: number }): string => {
  const others = titles.length - 1;
  const more = others > 0 ? ` and ${plural(others, 'other design', 'other designs')}` : '';
  const parts: string[] = [];
  if (issues.errors > 0) parts.push(plural(issues.errors, 'check error', 'check errors'));
  if (issues.comments > 0) parts.push(plural(issues.comments, 'comment not sent', 'comments not sent'));
  const tail = `${more}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`;
  const title = clip(cleanTitle(titles[0] ?? ''), SERVICE_MARK_TEXT_MAX - tail.length);
  return clip(`${title}${tail}`, SERVICE_MARK_TEXT_MAX);
};

// ---- plan ----

const timeOf = (iso: string): number => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

/**
 * The marks the sidebar should show, in priority order (the chat with the newest design first),
 * at most `max`. Pure.
 */
export const planMarks = (
  designs: readonly DesignSummary[],
  counts: ReadonlyMap<string, MarkCounts>,
  max: number = SERVICE_MARKS_MAX,
): Map<string, ServiceMark> => {
  const bySession = new Map<string, DesignSummary[]>();
  for (const design of designs) {
    if (design.sessionId === null || design.sessionId === '') continue;
    const list = bySession.get(design.sessionId);
    if (list === undefined) bySession.set(design.sessionId, [design]);
    else list.push(design);
  }
  const groups = [...bySession.entries()].map(([sessionId, list]) => {
    const sorted = [...list].sort((a, b) => timeOf(b.updated) - timeOf(a.updated) || a.slug.localeCompare(b.slug));
    // Safe: every group is created with one design.
    const newest = timeOf((sorted[0] as DesignSummary).updated);
    return { sessionId, sorted, newest };
  });
  groups.sort((a, b) => b.newest - a.newest || a.sessionId.localeCompare(b.sessionId));

  const plan = new Map<string, ServiceMark>();
  for (const { sessionId, sorted } of groups.slice(0, Math.max(0, max))) {
    let errors = 0;
    let comments = 0;
    for (const design of sorted) {
      errors += counts.get(design.slug)?.errors ?? 0;
      comments += design.openComments;
    }
    const tone = errors > 0 || comments > 0 ? 'warning' : 'neutral';
    plan.set(sessionId, { icon: MARK_ICON, tone, text: markText(sorted.map((design) => design.title), { errors, comments }) });
  }
  return plan;
};

const keyOf = (mark: ServiceMark): string => `${mark.icon}\u0000${mark.tone}\u0000${mark.text}`;

/**
 * The next change to send, or `null` when the sidebar matches: sets in priority order (a new
 * chat waits while `held` is at the host cap), then removals of chats no longer wanted.
 */
export const nextChange = (
  desired: ReadonlyMap<string, ServiceMark>,
  applied: ReadonlyMap<string, string>,
  max: number = SERVICE_MARKS_MAX,
): { sessionId: string; mark: ServiceMark | null } | null => {
  for (const [sessionId, mark] of desired) {
    const held = applied.get(sessionId);
    if (held === keyOf(mark)) continue;
    if (held === undefined && applied.size >= max) continue;
    return { sessionId, mark };
  }
  for (const sessionId of applied.keys()) if (!desired.has(sessionId)) return { sessionId, mark: null };
  return null;
};

// ---- rate window ----

export type RateWindow = {
  /** Take one send: `0` when allowed (and counted), else the milliseconds until one is (nothing counted). */
  take(): number;
};

/**
 * At most `perMinute` sends in any 60 s, over a sliding window. A token bucket that starts full
 * would allow a burst plus a minute of refill (nearly twice the rate) in one window, over the
 * host's `SERVICE_MARK_RATE_MAX`.
 */
export const createRateWindow = (perMinute: number, now: () => number): RateWindow => {
  const sends: number[] = [];
  return {
    take() {
      const t = now();
      while (sends.length > 0 && (sends[0] as number) <= t - 60_000) sends.shift();
      if (sends.length < perMinute) {
        sends.push(t);
        return 0;
      }
      // Safe: the window is full, so it holds perMinute ≥ 1 entries.
      return (sends[0] as number) + 60_000 - t;
    },
  };
};

// ---- the running module ----

export type MarkTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type SessionMarksDeps = {
  index: Pick<DesignIndex, 'all' | 'ready'>;
  /** The design checks (`ensureChecksService(ctx)`); only `counts.errors` is read. */
  checks: { get(slug: string): Promise<{ counts: { errors: number } }> };
  activity: Pick<ActivityTracker, 'of'>;
  hostCalls: Pick<HostCalls, 'setMark'>;
  hub: Pick<ChangeHub, 'subscribe'>;
  log: Logger;
  now?: () => number;
  /** Test seam: a fake clock's timers. */
  timers?: MarkTimers;
  /** Test seam; the host's cap otherwise. */
  max?: number;
};

export type SessionMarks = {
  /** Wait for the design index, then set the marks (neutral at once, warnings as counts come in). */
  start(): Promise<void>;
  /** Stop: no more calls; settles once a reconcile or send in flight has finished. */
  dispose(): Promise<void>;
  /** Test seam: resolves when no reconcile or send is running. */
  idle(): Promise<void>;
};

/** Events after which the marks may differ; thumbnails, versions, open requests and the like cannot change one. */
const TRIGGER_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['added', 'removed', 'design', 'comments', 'files', 'root', 'checks', 'activity']);
/** Events that make a design's check counts stale. */
const RECOUNT_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['added', 'design', 'files', 'checks']);

const defaultTimers: MarkTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  // Safe: the handle passed back is always one this object's setTimeout returned.
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const createSessionMarks = ({
  index,
  checks,
  activity,
  hostCalls,
  hub,
  log,
  now = Date.now,
  timers = defaultTimers,
  max = SERVICE_MARKS_MAX,
}: SessionMarksDeps): SessionMarks => {
  const counts = new Map<string, MarkCounts>();
  /** Designs whose counts are stale, with the time of the last event that made them so. */
  const touched = new Map<string, number>();
  const applied = new Map<string, string>();
  const rate = createRateWindow(MARKS_RATE_PER_MIN, now);
  let desired = new Map<string, ServiceMark>();

  let started = false;
  let disposed = false;
  let stopped = false; // the host refused: nothing more until the next service start
  let everSaved = false;
  let waitForTrigger = false; // the host was unavailable: send again on the next event or retry, not on every plan
  let unsubscribe: (() => void) | null = null;

  let reconcileTimer: unknown = null;
  let reconcileAt = 0;
  let reconciling: Promise<void> | null = null;
  let reconcileAgain = false;
  let sendTimer: unknown = null;
  let sending: Promise<void> | null = null;

  // ---- reconcile scheduling: coalesced, never two in flight ----

  const scheduleReconcile = (delayMs: number): void => {
    if (disposed || stopped || !started) return;
    const at = now() + Math.max(0, delayMs);
    if (reconcileTimer !== null) {
      if (at >= reconcileAt) return; // the one already planned comes first and covers this
      timers.clearTimeout(reconcileTimer);
    }
    reconcileAt = at;
    reconcileTimer = timers.setTimeout(() => {
      reconcileTimer = null;
      runReconcile();
    }, Math.max(0, delayMs));
  };

  const runReconcile = (): void => {
    if (disposed || stopped) return;
    if (reconciling !== null) {
      reconcileAgain = true;
      return;
    }
    reconciling = reconcile()
      .catch((error: unknown) => {
        log.warn('session-marks.reconcile-failed', { error: error instanceof Error ? error.name : 'unknown' });
      })
      .finally(() => {
        reconciling = null;
        if (reconcileAgain) {
          reconcileAgain = false;
          scheduleReconcile(MARKS_DEBOUNCE_MS);
        }
      });
  };

  const linkedDesigns = (): DesignSummary[] => {
    const designs = index.all();
    const sessions = new Set(planMarks(designs, counts, max).keys());
    return designs.filter((design) => design.sessionId !== null && sessions.has(design.sessionId));
  };

  const plan = (): void => {
    desired = planMarks(index.all(), counts, max);
    pump();
  };

  /** One check read, raced against `MARK_CHECK_READ_MS`; `undefined` when it lost or failed. */
  const readErrors = (slug: string): Promise<number | undefined> =>
    new Promise((resolve) => {
      const timer = timers.setTimeout(() => resolve(undefined), MARK_CHECK_READ_MS);
      checks.get(slug).then(
        (result) => {
          timers.clearTimeout(timer);
          const errors = result.counts.errors;
          resolve(Number.isFinite(errors) && errors >= 0 ? errors : undefined);
        },
        () => {
          timers.clearTimeout(timer);
          resolve(undefined);
        },
      );
    });

  const reconcile = async (): Promise<void> => {
    // Marks first with what is known (neutral on a cold start), then the counts that are due.
    plan();
    let failed = 0;
    let soonest = Number.POSITIVE_INFINITY;
    for (const design of linkedDesigns()) {
      if (disposed || stopped) return;
      const slug = design.slug;
      const known = counts.has(slug);
      const since = touched.get(slug);
      if (known && since === undefined) continue; // counted, nothing changed since
      if (since !== undefined && now() - since < MARK_SETTLE_MS) {
        soonest = Math.min(soonest, since + MARK_SETTLE_MS - now());
        continue; // the agent may still be writing: wait for it to settle
      }
      // Safe: linkedDesigns keeps only designs with a session.
      if (activity.of(design.sessionId as string)?.state === 'working') continue; // the turn's end triggers us again
      const errors = await readErrors(slug);
      if (disposed) return;
      if (errors === undefined) {
        failed += 1;
        // A failed read keeps the last count; never a warning from a failed read alone.
        if (!known) counts.set(slug, null);
        continue;
      }
      // An event during the read made this one stale already: keep it due.
      if (touched.get(slug) === since) touched.delete(slug);
      counts.set(slug, { errors });
    }
    if (failed > 0) log.warn('session-marks.counts-unread', { designs: failed });
    plan();
    if (Number.isFinite(soonest)) scheduleReconcile(soonest);
  };

  // ---- sending: rate-limited, always from the latest desired state ----

  const scheduleSend = (delayMs: number): void => {
    if (disposed || stopped || sendTimer !== null) return;
    sendTimer = timers.setTimeout(() => {
      sendTimer = null;
      pump();
    }, Math.max(0, delayMs));
  };

  const pump = (): void => {
    if (disposed || stopped || waitForTrigger || sending !== null || sendTimer !== null) return;
    sending = send().finally(() => {
      sending = null;
    });
  };

  const send = async (): Promise<void> => {
    for (;;) {
      if (disposed || stopped) return;
      const change = nextChange(desired, applied, max);
      if (change === null) return;
      const wait = rate.take();
      if (wait > 0) return scheduleSend(wait);
      const result = await hostCalls.setMark({ sessionId: change.sessionId }, change.mark);
      if (disposed) return;
      if (result === 'saved') {
        everSaved = true;
        if (change.mark === null) applied.delete(change.sessionId);
        else applied.set(change.sessionId, keyOf(change.mark));
        continue;
      }
      if (result === 'limited') {
        // The send timer holds every send (a plan only calls pump, which waits for it); the state
        // sent when it fires is the one wanted then.
        log.warn('session-marks.limited', { pauseMs: MARKS_LIMITED_PAUSE_MS, held: applied.size });
        return scheduleSend(MARKS_LIMITED_PAUSE_MS);
      }
      if (result === 'refused') {
        stopped = true;
        log.warn('session-marks.stopped', { reason: 'refused' });
        cancelTimers();
        return;
      }
      // unavailable: no host here (host-calls logs that once), or it stopped answering. Without a
      // host nothing loops; the next trigger tries again. A host that answered before gets one retry.
      waitForTrigger = true;
      if (everSaved) {
        sendTimer = timers.setTimeout(() => {
          sendTimer = null;
          waitForTrigger = false;
          pump();
        }, MARKS_UNAVAILABLE_RETRY_MS);
      }
      return;
    }
  };

  const cancelTimers = (): void => {
    if (reconcileTimer !== null) timers.clearTimeout(reconcileTimer);
    if (sendTimer !== null) timers.clearTimeout(sendTimer);
    reconcileTimer = null;
    sendTimer = null;
  };

  const onEvent = (event: ChangeEvent): void => {
    if (!TRIGGER_KINDS.has(event.kind)) return;
    waitForTrigger = false;
    if (event.kind === 'root') {
      counts.clear();
      touched.clear();
    } else if (event.slug !== null) {
      if (event.kind === 'removed') {
        counts.delete(event.slug);
        touched.delete(event.slug);
      } else if (RECOUNT_KINDS.has(event.kind)) {
        touched.set(event.slug, now());
      }
    }
    scheduleReconcile(MARKS_DEBOUNCE_MS);
  };

  return {
    async start() {
      if (started || disposed) return;
      started = true;
      unsubscribe = hub.subscribe(onEvent);
      await index.ready(DESIGN_INDEX_TURN_WAIT_MS);
      if (disposed) return;
      runReconcile();
    },

    async dispose() {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
      cancelTimers();
      await reconciling;
      await sending;
    },

    async idle() {
      while (reconciling !== null || sending !== null) {
        await reconciling;
        await sending;
      }
    },
  };
};
