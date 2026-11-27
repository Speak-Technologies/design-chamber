// A design system as a row (Phase 2.6 L1b): the rail's row, shared by the Design systems list and the library's
// Systems tab (extracted from systems-list.ts), and the page List view's column row. Both carry the plate, the
// name, Draft or Ready, and the used-by count as a link that lands in the library filtered to that system. The
// link sits beside the row's main button, never inside it. Names, paths and reasons are text, never markup.

import { mountBadge } from '@openchamber/sdk/ui';

import type { SystemSummary } from '../../shared/types.ts';
import { toast } from '../components/actions.ts';
import { errorText, h } from '../components/dom.ts';
import { icon } from '../components/icons.ts';
import { attachMenu, iconBtn, type MenuEntry } from '../components/kit.ts';
import { client, host } from '../guest.ts';
import { relativeTime } from '../model/format.ts';
import { libraryTileLabel, librarySystemMenu, systemRow, usedByLinkLabel, type LibrarySystemMenuId, type ProjectLabel, type RowTone } from '../model/systems-model.ts';
import { mountPlate } from './system-plate.ts';
import { menuOnThisDevice } from '../components/device.ts';

export const toneBadge = (label: string, tone: RowTone, title?: string): HTMLElement => {
  const holder = h('span', { class: 'dc-sys-badge', title: title ?? null });
  mountBadge(holder, { label, tone });
  return holder;
};

export type SystemRowOptions = {
  /** `list`: a row of the Design systems view. `library`: the same row inside the library's Systems and All tabs. */
  variant?: 'list' | 'library';
  label: ProjectLabel;
  onOpen: (id: string) => void;
  /** The used-by link: close this view and show the designs that use the system. */
  onShowDesigns: (id: string) => void;
  entries: () => readonly MenuEntry[];
  onMenu: (id: string) => void;
};

/** The used-by fact: a link while some design uses the system, plain words while none does. */
export const usedByControl = (summary: Pick<SystemSummary, 'id' | 'name' | 'usedBy'>, text: string, onShowDesigns: (id: string) => void): HTMLElement => {
  if (summary.usedBy === 0) return h('span', { class: 'dc-sys-used', 'data-zero': 'true' }, text);
  const link = h('button', { type: 'button', class: 'dc-link dc-sys-used', 'aria-label': usedByLinkLabel(summary.usedBy), title: `Show the designs that use ${summary.name}` }, text);
  link.addEventListener('click', () => onShowDesigns(summary.id));
  return link;
};

/** The rail row: plate and name over the badges and the meta line. */
export const mountSystemRow = (summary: SystemSummary, options: SystemRowOptions): HTMLElement => {
  const model = systemRow(summary, { nowMs: Date.now(), locale: host.snapshot()?.locale ?? 'en', label: options.label });
  const unreadable = model.unreadable !== null;

  const title = h('span', { class: 'dc-sys-title', title: model.name }, model.name);
  const nameLine = h('span', { class: 'dc-sys-name' }, title, unreadable ? toneBadge('Can’t read', 'error') : toneBadge(model.status.label, model.status.tone));
  const plate = h('span', { class: 'dc-sys-plate' }, mountPlate(summary, 'row'));
  const main = unreadable
    ? h('div', { class: 'dc-sys-main', 'data-static': 'true', role: 'group', 'aria-label': model.ariaLabel }, plate, nameLine)
    : h('button', { type: 'button', class: 'dc-sys-main', 'aria-label': model.ariaLabel }, plate, nameLine);
  if (!unreadable) main.addEventListener('click', () => options.onOpen(summary.id));

  const more = iconBtn({ icon: 'more', label: `Actions for ${summary.name}`, size: 'sm', onClick: () => undefined });
  attachMenu(more, () => options.entries(), options.onMenu);
  const body: HTMLElement[] = [];
  if (unreadable) body.push(h('p', { class: 'dc-sys-reason' }, model.unreadable ?? ''));
  else {
    const badges = h('span', { class: 'dc-sys-line' }, toneBadge(model.home.label, 'neutral', model.home.title), ...model.badges.map((badge) => toneBadge(badge.label, badge.tone)));
    if (model.more) badges.append(h('span', { class: 'dc-sys-more', title: model.more.title }, model.more.text, h('span', { class: 'dc-sr-only' }, `: ${model.more.title}`)));
    body.push(badges);
    if (model.notice) body.push(h('span', { class: 'dc-sys-notice' }, model.notice));
    const meta = h('span', { class: 'dc-sys-meta' });
    const parts: Node[] = [...(model.metaParts.depth === null ? [] : [h('span', null, model.metaParts.depth)]), ...model.metaParts.source.map((text) => h('span', null, text)), usedByControl(summary, model.metaParts.usedBy.text, options.onShowDesigns), ...(model.metaParts.updated === null ? [] : [h('span', null, model.metaParts.updated)])];
    parts.forEach((part, index) => {
      if (index > 0) meta.append(h('span', { class: 'dc-sys-dot', 'aria-hidden': 'true' }, '·'));
      meta.append(part);
    });
    body.push(meta);
  }
  return h('li', { class: options.variant === 'library' ? 'dc-libsys' : 'dc-sys', 'data-id': summary.id, 'data-state': unreadable ? 'unreadable' : summary.status }, h('div', { class: 'dc-sys-top' }, main, more), ...body);
};

// ---------------------------------------------------------------- the library's own handling

export type LibrarySystemActions = {
  onOpen: (id: string) => void;
  /** The living page's preview (the system page's own surface for it). */
  onPreview: (id: string) => void;
};

/** One handler for the short menu the library gives a system: Open, Preview living page, Reveal in folder. */
export const runLibrarySystemAction = async (id: LibrarySystemMenuId, summary: Pick<SystemSummary, 'id' | 'name'>, actions: LibrarySystemActions): Promise<void> => {
  if (id === 'open') return actions.onOpen(summary.id);
  if (id === 'preview') return actions.onPreview(summary.id);
  try {
    await client.call('POST /reveal', { body: { system: summary.id, target: 'folder' } });
  } catch (error) {
    toast('error', `Couldn’t open the folder. ${errorText(error)}`);
  }
};

export type LibrarySystemOptions = LibrarySystemActions & {
  label: ProjectLabel;
  onShowDesigns: (id: string) => void;
};

/** The page List view's column row for a system: hit button under the cells, as the design rows are. */
export const mountSystemListRow = (summary: SystemSummary, options: LibrarySystemOptions): HTMLElement => {
  const locale = host.snapshot()?.locale ?? 'en';
  const model = systemRow(summary, { nowMs: Date.now(), locale, label: options.label });
  const unreadable = model.unreadable !== null;
  const hit = unreadable ? null : h('button', { type: 'button', class: 'dc-row-hit', 'aria-label': libraryTileLabel(summary, { nowMs: Date.now(), locale }) });
  hit?.addEventListener('click', () => options.onOpen(summary.id));
  const kind = h('span', { class: 'dc-sys-kind' });
  mountBadge(kind, { label: 'System', tone: 'primary' });
  const home = h('span', { class: 'dc-card-project', title: model.home.title }, icon(summary.home === 'internal' ? 'system' : 'repo', 12), h('span', { class: 'dc-row-project-name' }, model.home.label));
  const more = iconBtn({ icon: 'more', label: `Actions for ${summary.name}`, size: 'sm', onClick: () => undefined });
  attachMenu(more, () => menuOnThisDevice(librarySystemMenu(summary)), (id) => void runLibrarySystemAction(id as LibrarySystemMenuId, summary, options));
  const updated = relativeTime(summary.updated, Date.now(), locale);
  return h(
    'li',
    { class: 'dc-row dc-list-row', 'data-kind': 'system', 'data-system-id': summary.id },
    hit,
    h('span', { class: 'dc-row-thumb dc-sys-plate' }, mountPlate(summary, 'row')),
    h(
      'span',
      { class: 'dc-row-name' },
      h('span', { class: 'dc-row-title', title: summary.name }, summary.name),
      h('span', { class: 'dc-row-sub' }, kind, unreadable ? toneBadge('Can’t read', 'error', model.unreadable ?? undefined) : toneBadge(model.status.label, model.status.tone)),
    ),
    h('span', { class: 'dc-row-system' }, unreadable ? null : usedByControl(summary, model.metaParts.usedBy.text, options.onShowDesigns)),
    h('span', { class: 'dc-row-in' }, home),
    h('span', { class: 'dc-row-when' }, updated),
    more,
  );
};
