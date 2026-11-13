// Phase 1 feature mount (seam S9): the live build strip. It watches what the linked agent is
// doing to this design (file events + the chat's activity, src/guest/build-activity.ts), draws
// it as a pill over the wall (the stage overlay, S2: short on the rail, full text on the
// full-screen page), and lights the board the agent just wrote. A 1 s repaint runs only while an elapsed time is showing and
// the document is visible; otherwise the watcher's own deadline timer is all there is.

import { RECENT_MS, batchAgentFiles, inRestoreQuiet, watchBuildActivity, type BuildActivity } from '../../guest/build-activity.ts';
import { affectedSources } from '../../guest/store.ts';
import { continueInChat } from '../components/actions.ts';
import { mountBuildStrip } from '../components/build-strip.ts';
import { feed, guestHost, host } from '../guest.ts';
import { buildView } from '../model/build-strip-model.ts';
import type { FeatureMount } from './view-context.ts';
import type { WallHandle } from './wall.ts';

const REPAINT_MS = 1000;

/** The watcher each open view mounted, so a sibling feature (Edit text's agent-working hint) reads the same phase the strip shows. */
const watchers = new WeakMap<WallHandle, BuildActivity>();
export const buildActivityFor = (wall: WallHandle): BuildActivity | undefined => watchers.get(wall);

const sameSet = (a: ReadonlySet<string | null> | null, b: ReadonlySet<string | null> | null): boolean =>
  a === b || (a !== null && b !== null && a.size === b.size && [...a].every((value) => b.has(value)));

export const mount: FeatureMount = (ctx) => {
  // The rail gets the short pill. The full-screen toolbar's status slot (S1) is left with about
  // 66 px at 1400 px wide, so the page gets the full-text pill over the wall instead.
  const compact = ctx.surface === 'panel';
  // The overlay sits after the wall in the stage; the pill's buttons should come before the wall's surface in Tab order.
  // It is absolutely positioned with its own z-index, so its place in the DOM changes nothing on screen.
  ctx.slots.overlay.parentElement?.prepend(ctx.slots.overlay);

  const watcher = watchBuildActivity({ host: guestHost, feed, slug: ctx.slug, detail: ctx.detail, onDetail: ctx.onDetail });
  watchers.set(ctx.wall, watcher);
  const strip = mountBuildStrip(ctx.slots.overlay, {
    compact,
    onOpenChat: () => void continueInChat(ctx.slug),
    onDismiss: () => {
      watcher.dismiss();
      // The focused button has just left the strip; keep the keyboard on the design.
      ctx.wall.focus();
    },
  });

  // ---- paint ----

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
  const onVisibility = (): void => render();
  document.addEventListener('visibilitychange', onVisibility);
  render();

  // ---- the board the agent just wrote ----

  let recentFiles: string[] = [];
  let recentTimer: ReturnType<typeof setTimeout> | null = null;
  let lit: ReadonlySet<string | null> | null = null;

  /** `restart`: a fresh batch, so the wall starts the fade over even for a board that is already lit. */
  const setLit = (next: ReadonlySet<string | null> | null, restart = false): void => {
    if (!restart && sameSet(lit, next)) return;
    lit = next;
    ctx.wall.markRecent(next);
  };
  const clearRecent = (): void => {
    if (recentTimer !== null) clearTimeout(recentTimer);
    recentTimer = null;
    recentFiles = [];
    setLit(null);
  };
  /** Screens the last batch touched, against the design as it is now. `all` (tokens, assets) or a page: nothing to point at. */
  const sourcesOf = (): ReadonlySet<string | null> | null => {
    const touched = affectedSources(ctx.detail().design, recentFiles);
    return touched === 'all' || touched.length === 0 ? null : new Set(touched);
  };

  const unfeed = feed.subscribe((batch) => {
    const { files, restored } = batchAgentFiles(batch.events, ctx.slug);
    // A user's restore is not the agent: nothing lights up, and what was lit just before it goes out.
    // (The watcher subscribed first, so its track already knows about this batch.)
    if (restored) clearRecent();
    if (files.length === 0 || inRestoreQuiet(watcher.get(), Date.now())) return;
    if (recentTimer !== null) clearTimeout(recentTimer);
    recentFiles = files;
    setLit(sourcesOf(), true);
    recentTimer = setTimeout(clearRecent, RECENT_MS);
  });
  // A screen the batch named may only reach the design's screen list with the next detail answer.
  const undetail = ctx.onDetail(() => {
    if (recentFiles.length > 0) setLit(sourcesOf());
  });

  return () => {
    watchers.delete(ctx.wall);
    unfeed();
    undetail();
    unwatch();
    document.removeEventListener('visibilitychange', onVisibility);
    if (tick !== null) clearInterval(tick);
    clearRecent();
    strip.dispose();
    watcher.dispose();
  };
};
