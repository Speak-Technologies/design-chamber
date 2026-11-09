// Phase 1 feature mount (seam S9): the rail viewer's header carries a Comments chip with the
// open count and a Versions button, so both are one tap away instead of inside the ⋯ menu.
// The first-run tip lives in the rail list (rail/list-view.ts) and restore with Undo in the
// view's restore flow (components/restore-flow.ts); both read their copy from model/findability-model.ts.

import { iconBtn, btn } from '../components/kit.ts';
import { commentsChip } from '../model/findability-model.ts';
import type { FeatureMount } from './view-context.ts';

export const mount: FeatureMount = (ctx) => {
  // The full-screen page has room for full "Comments" and "Versions" buttons in its toolbar.
  if (ctx.surface !== 'panel') return () => undefined;

  const chip = btn({ label: '', icon: 'comment', variant: 'outline', size: 'xs', pressed: false, onClick: () => ctx.drawers.toggle('comments') });
  chip.el.classList.add('dc-comments-chip');
  const versions = iconBtn({ icon: 'history', label: 'Versions', size: 'sm', pressed: false, onClick: () => ctx.drawers.toggle('versions') });
  versions.classList.add('dc-versions-btn');

  const paint = (): void => {
    const open = ctx.detail().design.comments.filter((comment) => comment.status === 'open').length;
    const { label, aria } = commentsChip(open);
    chip.set({ label, title: aria, pressed: ctx.drawers.active() === 'comments' });
    chip.el.setAttribute('aria-label', aria);
    chip.el.dataset.count = open > 0 ? 'some' : 'none';
    versions.setAttribute('aria-pressed', String(ctx.drawers.active() === 'versions'));
  };

  ctx.slots.compactActions.append(chip.el, versions);
  paint();
  const stops = [ctx.onDetail(paint), ctx.drawers.onChange(paint)];

  return () => {
    for (const stop of stops) stop();
    chip.el.remove();
    versions.remove();
  };
};
