// The library's empty state (Phase 2.6 L1a, the approved canvas's library-states screen): the kit
// empty plus a chip row naming every active filter. The scope chip is fixed (Clear filters keeps
// the scope); search, kind and system chips clear on their own. Copy comes from the pure model
// (list-model.ts emptyStateOf); this file only mounts it.

import { mountEmpty } from '@openchamber/sdk/ui';

import type { EmptyChip, LibraryEmpty } from '../model/list-model.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { btn } from './kit.ts';

export type LibraryEmptyHandlers = {
  /** The one action: New canvas, Show all designs, Clear filters, New design system… or Try again, per the model. */
  onAction: () => void;
  onClearChip: (id: Exclude<EmptyChip['id'], 'scope'>) => void;
  /**
   * First run only (no designs and no systems yet): a second action that starts a design system, and a line
   * that starts one from a system the project already has (the approved canvas's First run board).
   */
  firstRun?: { onNewSystem: () => void; onExistingSystem: () => void };
};

const ACTION_LABEL: Record<LibraryEmpty['action'], string> = {
  new: 'New canvas',
  'show-all': 'Show all designs',
  'clear-filters': 'Clear filters',
  'new-system': 'New design system…',
  'retry-systems': 'Try again',
};

const CLEAR_LABEL: Record<Exclude<EmptyChip['id'], 'scope'>, string> = {
  search: 'Clear search',
  tab: 'Clear the kind filter',
  system: 'Clear the system filter',
};

export const mountLibraryEmpty = (wrap: HTMLElement, model: LibraryEmpty, handlers: LibraryEmptyHandlers): void => {
  mountEmpty(wrap, { title: model.title, body: model.body, action: { label: model.actionLabel ?? ACTION_LABEL[model.action], onClick: handlers.onAction } });
  if (model.kind === 'no-designs' && handlers.firstRun) {
    const { onNewSystem, onExistingSystem } = handlers.firstRun;
    const more = btn({ label: 'Start a design system', variant: 'outline', size: 'sm', icon: 'system', onClick: onNewSystem });
    const existing = h('button', { type: 'button', class: 'dc-link' }, 'From an existing system…');
    existing.addEventListener('click', onExistingSystem);
    const slot = wrap.querySelector('.oc-sdk-empty-action');
    if (slot) slot.append(more.el);
    else wrap.append(more.el);
    wrap.append(h('p', { class: 'dc-empty-note' }, icon('info', 14), h('span', null, 'Already have a design system in a project? Start one from it with ', existing)));
  }
  if (model.chips.length === 0) return;
  const row = h('div', { class: 'dc-empty-filters', role: 'group', 'aria-label': 'Active filters' });
  for (const chip of model.chips) {
    const el = h('span', { class: 'dc-empty-chip', 'data-fixed': chip.fixed ? 'true' : 'false' }, chip.icon ? icon(chip.icon, 12) : null, h('span', { class: 'dc-empty-chip-name' }, chip.label));
    if (!chip.fixed && chip.id !== 'scope') {
      const id = chip.id;
      const label = CLEAR_LABEL[id];
      const clear = h('button', { type: 'button', class: 'dc-empty-chip-x', 'aria-label': label, title: label }, icon('close', 12));
      clear.addEventListener('click', () => handlers.onClearChip(id));
      el.append(clear);
    }
    row.append(el);
  }
  // Between the body and the action, as the canvas draws it (the kit empty has no slot of its own).
  const slot = wrap.querySelector('.oc-sdk-empty-action');
  if (slot) slot.before(row);
  else wrap.append(row);
};
