// Phase 1 feature mount (seam S9): the docked ask bar. It fills the bottom dock (S3), listens to
// the wall's element selection (S4) for the chip, and sends through `flows.ask`.

import { createAskBar, type AskBarHandle } from '../components/ask-bar.ts';
import { flows, guestHost } from '../guest.ts';
import type { FeatureMount } from './view-context.ts';
import type { WallHandle } from './wall.ts';

/** The bar each open view mounted, so a sibling feature (Edit text's "Ask agent") can hand it an element and words. */
const bars = new WeakMap<WallHandle, AskBarHandle>();
export const askBarFor = (wall: WallHandle): AskBarHandle | undefined => bars.get(wall);

export const mount: FeatureMount = (ctx) => {
  const bar = createAskBar({
    surface: ctx.surface,
    onSend: async (text, selection) => (await flows.ask(ctx.slug, { text, element: selection?.element ?? null })).outcome,
    onChipRemoved: () => ctx.wall.clearSelection(),
    onLeave: () => ctx.wall.focus(),
  });

  const syncLink = (): void => {
    const session = guestHost.session.get();
    bar.setLink({ sessionId: ctx.detail().design.sessionId, selectedId: session?.id ?? null, selectedTitle: session?.title ?? null });
  };
  const syncViewing = (): void => {
    const viewing = ctx.viewing() !== null;
    bar.setViewing(viewing);
    // An element chip names a place in the current design; an old version has none.
    if (viewing && bar.selection() !== null) {
      bar.setSelection(null);
      ctx.wall.clearSelection();
    }
  };

  const offSelection = ctx.wall.onSelection((event) => {
    if (event.type === 'selected') bar.setSelection(event.selection);
    // The element got a comment instead: nothing left to ask about.
    else if (event.type === 'commented' && bar.selection()?.key === event.key) bar.setSelection(null);
    // `cleared` (the composer was cancelled) keeps the chip on purpose: the user may still ask about it.
  });

  // Play mode uses the design like a prototype; there is no selected element in it. The wall keeps
  // its mode on a `data-mode` attribute and has no event for it yet.
  const modeEl = ctx.wall.el.matches('[data-mode]') ? ctx.wall.el : ctx.wall.el.querySelector<HTMLElement>('[data-mode]');
  const modeWatch = new MutationObserver(() => {
    if (modeEl?.dataset.mode === 'play' && bar.selection() !== null) {
      bar.setSelection(null);
      ctx.wall.clearSelection();
    }
  });
  if (modeEl) modeWatch.observe(modeEl, { attributes: true, attributeFilter: ['data-mode'] });

  const offDetail = ctx.onDetail(syncLink);
  const offSession = guestHost.session.subscribe(syncLink);
  const offViewing = ctx.onViewing(syncViewing);
  syncLink();
  syncViewing();
  ctx.slots.bottomDock.append(bar.el);
  bars.set(ctx.wall, bar);

  return () => {
    bars.delete(ctx.wall);
    offSelection();
    modeWatch.disconnect();
    offDetail();
    offSession();
    offViewing();
    bar.dispose();
  };
};
