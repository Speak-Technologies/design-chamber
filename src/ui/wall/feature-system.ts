// Phase 2.5 feature mount: the design system chip, its update banner and the notices after a change.
// Full-screen: at the left end of the header status slot, before Checks. Rail: in the second header row,
// in the room between the mode controls and the zoom (the title row is full at 320 px). Hidden while an old version is on show, because the system describes the files as
// they are now.

import { mountSystemChip } from '../components/system-chip.ts';
import type { FeatureMount } from './view-context.ts';

export const mount: FeatureMount = (ctx) => {
  const chip = mountSystemChip({ slug: ctx.slug, surface: ctx.surface, host: ctx.actions.host, notices: ctx.notices, onOpenSystem: ctx.actions.onOpenSystem });
  (ctx.surface === 'page' ? ctx.slots.statusSlot : ctx.slots.railTools).prepend(chip.el);
  const syncViewing = (): void => chip.setHidden(ctx.viewing() !== null);
  syncViewing();
  const unwatch = ctx.onViewing(syncViewing);
  return () => {
    unwatch();
    chip.dispose();
  };
};
