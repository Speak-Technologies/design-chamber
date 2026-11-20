// The build strip on a design system's page (Phase 2.5 U2): what the linked agent is doing to this system
// right now. The design strip's watcher already knows how to read the chat's activity and a stream of file
// events, but it is keyed by a design slug. This file feeds it the system's events dressed as a design's, so the
// phases, the timings and the words stay the same in both places.

import { watchBuildActivity, type BuildActivity } from '../../guest/build-activity.ts';
import type { ChangeBatch, ChangeFeed } from '../../guest/changes.ts';
import type { DesignDetailResponse } from '../../shared/api.ts';
import type { ChangeEvent } from '../../shared/types.ts';
import { mountBuildStrip } from '../components/build-strip.ts';
import { feed, guestHost, host } from '../guest.ts';
import { buildView } from '../model/build-strip-model.ts';

const REPAINT_MS = 1000;

/** The system's own events, shaped like a design's (`files` and `added` for the system id). */
const systemEvents = (events: readonly ChangeEvent[], id: string): ChangeEvent[] =>
  events.flatMap((event): ChangeEvent[] => {
    if (event.system !== id) return [];
    if (event.systemChange === 'files') return [{ ...event, slug: id, kind: 'files' }];
    if (event.systemChange === 'added') return [{ ...event, slug: id, kind: 'added' }];
    return [];
  });

const systemFeed = (id: string): ChangeFeed => ({
  start: () => feed.start(),
  stop: () => feed.stop(),
  status: () => feed.status(),
  onStatus: (listener) => feed.onStatus(listener),
  subscribe: (listener: (batch: ChangeBatch) => void) => feed.subscribe((batch) => listener({ ...batch, events: systemEvents(batch.events, id) })),
});

export type SystemBuildOptions = {
  id: string;
  /** Where the pill goes (over the board). */
  host: HTMLElement;
  compact: boolean;
  sessionId: () => string | null;
  created: () => string;
  onOpenChat: () => void;
};

export type SystemBuildHandle = { watcher: BuildActivity; /** The system's chat link or creation time changed. */ relink: () => void; dispose: () => void };

export const mountSystemBuild = (options: SystemBuildOptions): SystemBuildHandle => {
  const listeners = new Set<() => void>();
  // The watcher reads a design detail for the link and the creation time; a system has no screens and is never "pending".
  const detail = (): DesignDetailResponse =>
    ({
      slug: options.id,
      path: '',
      design: { kind: 'page', sessionId: options.sessionId(), projectDirectory: null, created: options.created(), screens: [] },
      pending: false,
      files: { screens: {} },
      warnings: [],
      screensStamp: null,
      designJson: 'ok',
    }) as unknown as DesignDetailResponse;

  const watcher = watchBuildActivity({
    host: guestHost,
    feed: systemFeed(options.id),
    slug: options.id,
    detail,
    onDetail: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  const strip = mountBuildStrip(options.host, {
    compact: options.compact,
    onOpenChat: () => options.onOpenChat(),
    onDismiss: () => watcher.dismiss(),
  });

  let tick: ReturnType<typeof setInterval> | null = null;
  const render = (): void => {
    const view = buildView(watcher.get(), Date.now(), host.snapshot()?.locale ?? 'en');
    strip.update(view);
    const wantsTick = view.elapsed !== null && !document.hidden;
    if (wantsTick && tick === null) tick = setInterval(render, REPAINT_MS);
    else if (!wantsTick && tick !== null) {
      clearInterval(tick);
      tick = null;
    }
  };
  const unwatch = watcher.subscribe(render);
  document.addEventListener('visibilitychange', render);
  render();
  // A change of link (the first message creates the chat) reaches the watcher through `onDetail`.
  const relink = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const stopSession = guestHost.session.subscribe(relink);

  return {
    watcher,
    relink,
    dispose: () => {
      unwatch();
      stopSession();
      document.removeEventListener('visibilitychange', render);
      if (tick !== null) clearInterval(tick);
      watcher.dispose();
      strip.dispose();
    },
  };
};
