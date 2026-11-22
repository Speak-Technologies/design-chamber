// The library's empty state (Phase 2.6 L1a, the approved canvas's library-states screen): the kit
// empty plus a chip row naming every active filter. The scope chip is fixed (Clear filters keeps
// the scope); search, kind and system chips clear on their own. Copy comes from the pure model
// (list-model.ts emptyStateOf); this file only mounts it.

import { mountEmpty } from '@openchamber/sdk/ui';

import type { EmptyChip, LibraryEmpty } from '../model/list-model.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export type LibraryEmptyHandlers = {
  /** The one action: New canvas, Show all designs, Clear filters, New design system… or Try again, per the model. */
  onAction: () => void;
  onClearChip: (id: Exclude<EmptyChip['id'], 'scope'>) => void;
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
