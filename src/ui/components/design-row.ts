// One design row, two layouts (Phase 2.6 L1a, extracted from the rail's rowFor): the rail's
// thumbnail row and the page List view's column row. Same facts, same ⋯ menu, same drag to a
// folder. The system chip (L1b) is a sibling of the row's main button, never nested in it; it names the
// design's system and opens it. Names and titles are text, never markup.

import { mountBadge } from '@openchamber/sdk/ui';

import type { DesignSummary } from '../../shared/types.ts';
import { mountSwatchDot } from '../systems/system-plate.ts';
import { host } from '../guest.ts';
import { cardProjectLine, kindLabel, kindSummary, rowAriaLabel, SYSTEM_UPDATED_LABEL, systemUpdated, type ListScope, type ManualProjects, type ProjectGroup } from '../model/list-model.ts';
import { plural, relativeTime } from '../model/format.ts';
import { DESIGN_DRAG_TYPE, listDesignMenu, runListAction, type DesignMenuView } from './folder-actions.ts';
import { toast, type ActionContext } from './actions.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { attachMenu, iconBtn } from './kit.ts';
import { mountThumb, type ThumbHandle } from './thumb.ts';

export type DesignRowView = {
  scope: ListScope;
  groups: readonly ProjectGroup[];
  root: string;
  /** The registry's manual project members, so a design filed by hand shows its project line. */
  manual?: ManualProjects;
  /** What the row's menu offers: the folder or manual project being viewed, if any (F2). */
  menu: DesignMenuView;
};

export type DesignRowOptions = {
  /** `rail`: one button with thumb and text. `list`: the page's column row with a whole-row hit button. `titles`: the rail's one-line row. */
  variant: 'rail' | 'list' | 'titles';
  view: DesignRowView;
  actions: ActionContext;
  onOpen: (slug: string) => void;
  /** The frame's thumbnail handles, kept across repaints (the caller disposes the gone ones). */
  thumbs: Map<string, ThumbHandle>;
  /** The first readable colour of a system, for the chip's dot; null when it has none or is not loaded. */
  swatchOf?: (systemId: string) => string | null;
};

export const SYSTEM_DELETED_TOAST = 'This system was deleted. The design keeps its own copy.';

/**
 * The system chip: a button beside the row's or card's main button. Draft systems carry a Draft mark, a deleted
 * one reads "<name> (deleted)" and says so when pressed. No system, no chip.
 */
export const designSystemChip = (design: Pick<DesignSummary, 'system'>, deps: { actions: ActionContext; swatchOf?: (systemId: string) => string | null }): HTMLElement | null => {
  const link = design.system ?? null;
  if (link === null) return null;
  const deleted = link.state === 'deleted';
  const draft = link.state === 'draft';
  const colour = deleted ? null : deps.swatchOf?.(link.id) ?? null;
  const chip = h(
    'button',
    {
      type: 'button',
      class: 'dc-design-system-chip',
      'data-state': deleted ? 'gone' : draft ? 'draft' : 'ok',
      'data-system-id': link.id,
      'aria-label': deleted ? `${link.name}, deleted system` : draft ? `Open system ${link.name}, Draft` : `Open system ${link.name}`,
      title: deleted ? SYSTEM_DELETED_TOAST : draft ? `${link.name} (Draft)` : link.name,
    },
    mountSwatchDot(colour, 'dc-design-system-dot'),
    h('span', { class: 'dc-design-system-name' }, deleted ? `${link.name} (deleted)` : link.name),
    draft ? h('span', { class: 'dc-design-system-mark' }, 'Draft') : null,
  );
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    if (deleted) toast('info', SYSTEM_DELETED_TOAST);
    else deps.actions.onOpenSystem?.(link.id);
  });
  return chip;
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

  if (variant === 'titles') {
    // The rail's compact view: the title on one line and the ⋯ menu, nothing else. No thumbnail is
    // mounted, so a long list costs no screenshots. The kind, system and flags are in the accessible
    // name and the tooltip, and the richer List view is one press away in Filters.
    const menu = iconBtn({ icon: 'more', label: `Actions for ${design.title}`, size: 'sm', onClick: () => undefined });
    const ref = { slug: design.slug, title: design.title, kind: design.kind, sessionId: design.sessionId };
    attachMenu(menu, () => listDesignMenu(view.menu), (id) => runListAction(id, ref, actions, view.menu));
    const main = h(
      'button',
      { type: 'button', class: 'dc-row-main dc-row-main-title', 'aria-label': rowAriaLabel(design), title: `${design.title}\n${kindSummary(design)}` },
      h('span', { class: 'dc-row-title' }, design.title),
    );
    main.addEventListener('click', () => onOpen(design.slug));
    return h('li', { class: 'dc-row dc-row-titles', 'data-pending': design.pending ? 'true' : 'false', 'data-slug': design.slug }, main, menu);
  }

  let thumb = thumbs.get(design.slug);
  if (thumb) thumb.update(design);
  else {
    thumb = mountThumb(design, 'rail');
    thumbs.set(design.slug, thumb);
  }
  const locale = host.snapshot()?.locale ?? 'en';
  const line = cardProjectLine(design, view.scope, view.groups, view.root, view.manual);
  const project = line ? h('span', { class: 'dc-row-project', title: line.title, 'data-filed': line.manual ? 'true' : null }, icon('layers', 12), h('span', { class: 'dc-row-project-name' }, line.label)) : null;
  const flags = rowFlags(design);
  const more = iconBtn({ icon: 'more', label: `Actions for ${design.title}`, size: 'sm', onClick: () => undefined });
  const ref = { slug: design.slug, title: design.title, kind: design.kind, sessionId: design.sessionId };
  attachMenu(more, () => listDesignMenu(view.menu), (id) => runListAction(id, ref, actions, view.menu));
  const chip = designSystemChip(design, { actions, swatchOf: options.swatchOf });
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
      h('span', { class: 'dc-row-system' }, chip),
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
  return h('li', { class: 'dc-row', 'data-pending': pending, 'data-slug': design.slug, 'data-chip': chip === null ? 'false' : 'true' }, main, more, chip === null ? null : h('div', { class: 'dc-row-foot' }, chip));
};
