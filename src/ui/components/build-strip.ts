// The live build strip (documentation/specs/phase-1-review-loop.md §2.6, §2.7): a pill over the
// wall, with full text on the full-screen page and short text on the rail. It only draws a `BuildView`;
// the model decides what it says. The root stays in the page even when nothing shows, so the
// live region is already there when the first phase arrives and screen readers speak it. What is
// read aloud is not always what is on screen: the text may name each file the agent reads, the
// announcement does not.

import type { BuildActivity } from '../../guest/build-activity.ts';
import { buildView, paintTrack, type BuildView, type ToolHold } from '../model/build-strip-model.ts';
import type { ToolDesign } from '../model/tool-model.ts';
import { h } from './dom.ts';
import { btn, iconBtn } from './kit.ts';

const REPAINT_MS = 1000;

export type BuildStripOptions = {
  /** The rail's short pill (short text, icon buttons) instead of the full-screen one. */
  compact: boolean;
  onOpenChat: () => void;
  onDismiss: () => void;
};

export type BuildStripHandle = { update: (view: BuildView) => void; dispose: () => void };

export const mountBuildStrip = (host: HTMLElement, options: BuildStripOptions): BuildStripHandle => {
  const dot = h('span', { class: 'dc-build-dot', 'aria-hidden': 'true' });
  const text = h('span', { class: 'dc-build-text' });
  const elapsed = h('span', { class: 'dc-build-elapsed', 'aria-hidden': 'true', hidden: true });
  const main = h('span', { class: 'dc-build-main' }, dot, text, elapsed);
  // The live region holds the announcement and nothing else, so neither the clock nor a file being read is spoken.
  const live = h('span', { class: 'dc-build-live dc-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const detail = h('span', { class: 'dc-build-detail', hidden: true });

  const openChat = options.compact
    ? iconBtn({ icon: 'chat', label: 'Open chat', size: 'sm', onClick: () => options.onOpenChat() })
    : btn({ label: 'Open chat', icon: 'chat', variant: 'ghost', size: 'xs', onClick: () => options.onOpenChat() }).el;
  const dismiss = options.compact
    ? iconBtn({ icon: 'close', label: 'Dismiss', size: 'sm', onClick: () => options.onDismiss() })
    : btn({ label: 'Dismiss', variant: 'ghost', size: 'xs', onClick: () => options.onDismiss() }).el;
  const actions = h('span', { class: 'dc-build-actions', hidden: true }, openChat, dismiss);

  const root = h('div', { class: 'dc-build', 'data-phase': 'hidden', 'data-compact': String(options.compact) }, main, live, detail, actions);
  host.append(root);

  return {
    update: (view) => {
      root.dataset.phase = view.phase;
      root.dataset.tone = view.tone;
      const shown = view.announce === null ? '' : options.compact ? view.pill : view.text;
      if (text.textContent !== shown) text.textContent = shown;
      // The rail says its own short words; when the announcement is something else (a read), it says that instead.
      const spoken = view.announce === null ? '' : view.announce === view.text ? shown : view.announce;
      // Rewrite the live text only when the announcement changes, so it is spoken once per change.
      if (live.textContent !== spoken) live.textContent = spoken;
      // The same words twice would be read twice; different ones stay readable by browsing.
      if (shown === spoken) text.setAttribute('aria-hidden', 'true');
      else text.removeAttribute('aria-hidden');
      text.title = view.announce === null ? '' : (view.title ?? view.text);
      elapsed.textContent = view.elapsed ?? '';
      elapsed.hidden = view.elapsed === null;
      detail.textContent = options.compact ? '' : (view.detail ?? '');
      detail.hidden = options.compact || view.detail === null;
      openChat.hidden = !view.actions.includes('open-chat');
      dismiss.hidden = !view.actions.includes('dismiss');
      actions.hidden = view.actions.length === 0;
    },
    dispose: () => root.remove(),
  };
};

export type BuildDriveOptions = {
  /** The open design, for the paths a tool names; null where there is none. */
  design: () => ToolDesign | null;
  locale: () => string;
};

/**
 * Keeps a strip painted from its watcher: on every change of the track, once a second while an elapsed time
 * shows and the document is visible, and once more when a held-back tool may show. Returns the stop.
 */
export const driveBuildStrip = (strip: BuildStripHandle, watcher: BuildActivity, options: BuildDriveOptions): (() => void) => {
  let tick: ReturnType<typeof setInterval> | null = null;
  let held: ToolHold | null = null;
  let release: ReturnType<typeof setTimeout> | null = null;

  const render = (): void => {
    const now = Date.now();
    const painted = paintTrack(held, watcher.get(), now);
    held = painted.held;
    if (release !== null) clearTimeout(release);
    release = painted.wait === null ? null : setTimeout(render, painted.wait);
    const view = buildView(painted.track, now, options.locale(), options.design());
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

  return () => {
    unwatch();
    document.removeEventListener('visibilitychange', render);
    if (tick !== null) clearInterval(tick);
    if (release !== null) clearTimeout(release);
  };
};
