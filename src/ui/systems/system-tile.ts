// A design system as a tile in the page's library grid (Phase 2.6 L1b, the approved canvas's system tile): the
// plate where a design shows its thumbnail, then the name, where it lives (Repo or In Design Chamber), the
// kind and status badges and when it changed. The foot says who uses it, as a link into the library filtered to
// this system, and a repo-backed system with a living page gets a button for it. The menu is the short one
// (Open, Preview living page, Reveal in folder). Names, paths and reasons are text, never markup.

import { mountBadge } from '@openchamber/sdk/ui';

import type { SystemSummary } from '../../shared/types.ts';
import { btn, attachMenu, iconBtn } from '../components/kit.ts';
import { h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import { host } from '../guest.ts';
import { relativeTime } from '../model/format.ts';
import { librarySystemMenu, libraryTileLabel, showsLivingPageButton, systemRow, type LibrarySystemMenuId } from '../model/systems-model.ts';
import { mountPlate } from './system-plate.ts';
import { runLibrarySystemAction, toneBadge, usedByControl, type LibrarySystemOptions } from './system-row.ts';

export type SystemTileOptions = LibrarySystemOptions & {
  /** The tile for the system the library is filtered to; it leads the grid. */
  lead?: boolean;
};

export const mountSystemTile = (summary: SystemSummary, options: SystemTileOptions): HTMLElement => {
  const locale = host.snapshot()?.locale ?? 'en';
  const model = systemRow(summary, { nowMs: Date.now(), locale, label: options.label });
  const unreadable = model.unreadable !== null;

  const kind = h('span', { class: 'dc-sys-kind' });
  mountBadge(kind, { label: 'System', tone: 'primary' });
  const status = unreadable ? toneBadge('Can’t read', 'error', model.unreadable ?? undefined) : toneBadge(model.status.label, model.status.tone);
  const first = model.badges[0];
  const updated = relativeTime(summary.updated, Date.now(), locale);
  const body = h(
    'span',
    { class: 'dc-card-body' },
    h('span', { class: 'dc-card-title', title: summary.name }, summary.name),
    h('span', { class: 'dc-card-project', title: model.home.title }, icon(summary.home === 'internal' ? 'system' : 'repo', 12), h('span', { class: 'dc-card-project-name' }, model.home.label)),
    h(
      'span',
      { class: 'dc-card-meta' },
      kind,
      status,
      updated === '' ? null : h('span', { class: 'dc-muted' }, updated),
      first && !unreadable ? h('span', { class: 'dc-flag', 'data-tone': first.tone === 'warning' ? 'warning' : first.tone === 'info' ? 'info' : null }, first.label) : null,
    ),
  );
  const thumb = h('span', { class: 'dc-card-thumb dc-sys-plate' }, mountPlate(summary, 'tile'));
  const main = unreadable
    ? h('div', { class: 'dc-card-main', 'data-static': 'true', role: 'group', 'aria-label': libraryTileLabel(summary, { nowMs: Date.now(), locale }) }, thumb, body, h('span', { class: 'dc-sys-reason dc-sys-tile-reason' }, model.unreadable ?? ''))
    : h('button', { type: 'button', class: 'dc-card-main', 'aria-label': libraryTileLabel(summary, { nowMs: Date.now(), locale }) }, thumb, body);
  if (!unreadable) main.addEventListener('click', () => options.onOpen(summary.id));

  const foot = h('div', { class: 'dc-card-foot dc-sys-tile-foot' });
  if (!unreadable) foot.append(usedByControl(summary, model.metaParts.usedBy.text, options.onShowDesigns));
  if (showsLivingPageButton(summary)) {
    const living = btn({ label: 'Living page', variant: 'outline', size: 'xs', icon: 'external', onClick: () => options.onPreview(summary.id) });
    living.el.classList.add('dc-sys-living');
    living.el.setAttribute('aria-label', `Open the living page for ${summary.name}`);
    foot.append(h('span', { class: 'dc-spacer' }), living.el);
  }

  const more = iconBtn({ icon: 'more', label: `Actions for ${summary.name}`, size: 'sm', onClick: () => undefined });
  more.classList.add('dc-card-more');
  attachMenu(more, () => librarySystemMenu(summary), (id) => void runLibrarySystemAction(id as LibrarySystemMenuId, summary, options));
  return h('li', { class: 'dc-card dc-sys-tile', 'data-kind': 'system', 'data-system-id': summary.id, 'data-lead': options.lead === true ? 'true' : 'false' }, main, foot.childElementCount > 0 ? foot : null, more);
};
