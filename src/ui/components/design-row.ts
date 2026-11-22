// One design row, two layouts (Phase 2.6 L1a, extracted from the rail's rowFor): the rail's
// thumbnail row and the page List view's column row. Same facts, same ⋯ menu, same drag to a
// folder; the system chip (L1b) arrives through `chip`, a sibling of the row's main button and
// never nested in it, so adding it touches this file alone. Names and titles are text, never markup.

import { mountBadge } from '@openchamber/sdk/ui';

import type { DesignSummary } from '../../shared/types.ts';
import { host } from '../guest.ts';
import { cardProjectLine, kindLabel, kindSummary, rowAriaLabel, SYSTEM_UPDATED_LABEL, systemUpdated, type ListScope, type ProjectGroup } from '../model/list-model.ts';
import { plural, relativeTime } from '../model/format.ts';
import { DESIGN_DRAG_TYPE, listDesignMenu, runListAction, type DesignMenuView } from './folder-actions.ts';
import type { ActionContext } from './actions.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { attachMenu, iconBtn } from './kit.ts';
import { mountThumb, type ThumbHandle } from './thumb.ts';

export type DesignRowView = {
  scope: ListScope;
  groups: readonly ProjectGroup[];
  root: string;
  /** What the row's menu offers: the folder or manual project being viewed, if any (F2). */
  menu: DesignMenuView;
};

export type DesignRowOptions = {
  /** `rail`: one button with thumb and text. `list`: the page's column row with a whole-row hit button. */
  variant: 'rail' | 'list';
  view: DesignRowView;
  actions: ActionContext;
  onOpen: (slug: string) => void;
  /** The frame's thumbnail handles, kept across repaints (the caller disposes the gone ones). */
  thumbs: Map<string, ThumbHandle>;
  /** L1b: the system chip, rendered beside the main button. Null while the design has no system. */
  chip?: HTMLElement | null;
};

/** The small status marks a row carries: waiting, system update, open comments, linked chat. */
const rowFlags = (design: DesignSummary): HTMLElement => {
  const flags = h('span', { class: 'dc-row-flags' });
  if (design.pending) flags.append(h('span', { class: 'dc-flag', 'data-tone': 'warning' }, 'Waiting for agent'));
  if (systemUpdated(design)) flags.append(h('span', { class: 'dc-flag', 'data-tone': 'info', title: `${design.system?.name ?? 'The design system'} was updated since this design copied it.` }, SYSTEM_UPDATED_LABEL));
  if (design.openComments > 0) flags.append(h('span', { class: 'dc-flag', title: plural(design.openComments, 'open comment') }, icon('pin', 12), String(design.openComments)));
  if (design.sessionId) flags.append(h('span', { class: 'dc-flag dc-flag-icon', title: 'Linked to a chat', role: 'img', 'aria-label': 'Linked to a chat' }, icon('chat', 12)));
  return flags;
};

export const mountDesignRow = (design: DesignSummary, options: DesignRowOptions): HTMLElement => {
  const { variant, view, actions, onOpen, thumbs } = options;
  let thumb = thumbs.get(design.slug);
  if (thumb) thumb.update(design);
  else {
    thumb = mountThumb(design, 'rail');
    thumbs.set(design.slug, thumb);
  }
  const locale = host.snapshot()?.locale ?? 'en';
  const line = cardProjectLine(design, view.scope, view.groups, view.root);
  const project = line ? h('span', { class: 'dc-row-project', title: line.title }, icon('layers', 12), h('span', { class: 'dc-row-project-name' }, line.label)) : null;
  const flags = rowFlags(design);
  const more = iconBtn({ icon: 'more', label: `Actions for ${design.title}`, size: 'sm', onClick: () => undefined });
  const ref = { slug: design.slug, title: design.title, kind: design.kind, sessionId: design.sessionId };
  attachMenu(more, () => listDesignMenu(view.menu), (id) => runListAction(id, ref, actions, view.menu));
  const chip = options.chip ?? null;
  const pending = design.pending ? 'true' : 'false';

  if (variant === 'list') {
    // The column row: a whole-row hit button under the cells (the approved canvas), so the chip
    // and the menu stay clickable above it. The cells themselves are not interactive.
    const hit = h('button', { type: 'button', class: 'dc-row-hit', 'aria-label': rowAriaLabel(design) });
    hit.addEventListener('click', () => onOpen(design.slug));
    const kindBadge = h('span');
    mountBadge(kindBadge, { label: kindLabel(design.kind), tone: 'neutral' });
    const item = h(
      'li',
      { class: 'dc-row dc-list-row', 'data-slug': design.slug, 'data-pending': pending, draggable: 'true' },
      hit,
      h('span', { class: 'dc-row-thumb' }, thumb.el),
      h('span', { class: 'dc-row-name' }, h('span', { class: 'dc-row-title' }, design.title), h('span', { class: 'dc-row-sub' }, kindBadge, flags.childElementCount > 0 ? flags : null)),
      chip === null ? null : h('span', { class: 'dc-row-system' }, chip),
      h('span', { class: 'dc-row-in' }, project),
      h('span', { class: 'dc-row-when' }, relativeTime(design.updated, Date.now(), locale)),
      more,
    );
    // Drag a row onto a folder in the sidebar to add it, exactly like a card.
    item.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData(DESIGN_DRAG_TYPE, design.slug);
      event.dataTransfer.effectAllowed = 'copy';
      item.dataset.dragging = 'true';
    });
    item.addEventListener('dragend', () => {
      delete item.dataset.dragging;
    });
    return item;
  }

  // The rail row, unchanged from the extraction: thumb and text in one button, the menu beside it.
  const meta = h('span', { class: 'dc-row-meta' }, `${kindSummary(design)} · ${relativeTime(design.updated, Date.now(), locale)}`);
  const main = h(
    'button',
    { type: 'button', class: 'dc-row-main', 'aria-label': rowAriaLabel(design) },
    thumb.el,
    h('span', { class: 'dc-row-text' }, h('span', { class: 'dc-row-title' }, design.title), meta, project, flags.childElementCount > 0 ? flags : null),
  );
  main.addEventListener('click', () => onOpen(design.slug));
  return h('li', { class: 'dc-row', 'data-pending': pending, 'data-slug': design.slug }, main, more, chip);
};
