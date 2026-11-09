// Phase 1 feature mount (seam S9): the Checks badge.
// Full-screen: in the header status slot, right-aligned against the buttons (S1). Rail: in the
// compact actions of the title row (S8). Hidden while an old version is on show, because the
// checks describe the files as they are now.

import { mountChecksBadge } from '../components/checks-badge.ts';
import type { FeatureMount } from './view-context.ts';

export const mount: FeatureMount = (ctx) => {
  const badge = mountChecksBadge({ slug: ctx.slug, surface: ctx.surface, host: ctx.actions.host });
  (ctx.surface === 'page' ? ctx.slots.statusSlot : ctx.slots.compactActions).append(badge.el);
  const syncViewing = (): void => badge.setHidden(ctx.viewing() !== null);
  syncViewing();
  const unwatch = ctx.onViewing(syncViewing);
  return () => {
    unwatch();
    badge.dispose();
  };
};
