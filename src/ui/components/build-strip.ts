// The live build strip (documentation/specs/phase-1-review-loop.md §2.6, §2.7): a pill over the
// wall, with full text on the full-screen page and short text on the rail. It only draws a `BuildView`;
// the model decides what it says. The root stays in the page even when nothing shows, so the
// live region is already there when the first phase arrives and screen readers speak it.

import { h } from './dom.ts';
import { btn, iconBtn } from './kit.ts';
import type { BuildView } from '../model/build-strip-model.ts';

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
  // The live region holds the announcement and nothing that ticks: the elapsed time is aria-hidden.
  const live = h('span', { class: 'dc-build-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, dot, text, elapsed);
  const detail = h('span', { class: 'dc-build-detail', hidden: true });

  const openChat = options.compact
    ? iconBtn({ icon: 'chat', label: 'Open chat', size: 'sm', onClick: () => options.onOpenChat() })
    : btn({ label: 'Open chat', icon: 'chat', variant: 'ghost', size: 'xs', onClick: () => options.onOpenChat() }).el;
  const dismiss = options.compact
    ? iconBtn({ icon: 'close', label: 'Dismiss', size: 'sm', onClick: () => options.onDismiss() })
    : btn({ label: 'Dismiss', variant: 'ghost', size: 'xs', onClick: () => options.onDismiss() }).el;
  const actions = h('span', { class: 'dc-build-actions', hidden: true }, openChat, dismiss);

  const root = h('div', { class: 'dc-build', 'data-phase': 'hidden', 'data-compact': String(options.compact) }, live, detail, actions);
  host.append(root);

  let announced: string | null = null;
  return {
    update: (view) => {
      root.dataset.phase = view.phase;
      root.dataset.tone = view.tone;
      // Rewrite the live text only when the announcement changes, so it is spoken once per change.
      if (view.announce !== announced) {
        text.textContent = view.announce === null ? '' : options.compact ? view.pill : view.text;
        announced = view.announce;
      }
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
