// The living-page card of a repo-backed design system (Phase 2.5 U6, technical design §9.6): one label, one tone, one
// sentence and only the actions the state allows. It describes the committed page; it never renders it. The model
// (`living-page-model.ts`) decides every word and which button is on; this only draws them.

import { mountBadge, mountSwitch } from '@openchamber/sdk/ui';

import { h } from '../components/dom.ts';
import { btn } from '../components/kit.ts';
import type { IconName } from '../components/icons.ts';
import { LIVING_TITLE, REGENERATING_LABEL, type LivingAction, type LivingActionId, type LivingCard } from '../model/living-page-model.ts';

export type LivingCardHandlers = {
  onAction: (id: LivingActionId) => void;
  onEmbedFonts: (checked: boolean) => void;
};

const ICON: Readonly<Partial<Record<LivingActionId, IconName>>> = { ask: 'chat', fix: 'chat', preview: 'eye' };

const actionButton = (action: LivingAction, handlers: LivingCardHandlers): HTMLElement => {
  const handle = btn({
    label: action.label,
    variant: action.look === 'tinted' ? 'default' : action.look,
    size: 'sm',
    ...(ICON[action.id] ? { icon: ICON[action.id] as IconName } : {}),
    disabled: !action.enabled,
    ...(action.why ? { title: action.why } : {}),
    onClick: () => handlers.onAction(action.id),
  });
  handle.el.dataset.action = action.id;
  if (action.look === 'tinted') handle.el.classList.add('dc-living-tint');
  return handle.el;
};

export const renderLivingCard = (card: LivingCard, handlers: LivingCardHandlers): HTMLElement => {
  const badge = h('span', { class: 'dc-living-badge' });
  mountBadge(badge, { label: card.regenerating ? REGENERATING_LABEL : card.label, tone: card.regenerating ? 'neutral' : card.tone });

  const reasons = card.reasons.length > 0 ? h('ul', { class: 'dc-living-reasons' }, ...card.reasons.map((reason) => h('li', null, reason))) : null;
  const whys = [...new Set(card.actions.filter((action) => !action.enabled && action.why !== null && action.why !== REGENERATING_LABEL && action.id !== 'preview').map((action) => action.why as string))];

  const root = h(
    'article',
    { class: 'dc-living', 'data-kind': card.kind, 'data-tone': card.tone, 'data-regenerating': String(card.regenerating), 'aria-label': LIVING_TITLE },
    h('div', { class: 'dc-living-head' }, h('h4', { class: 'dc-living-title' }, LIVING_TITLE), badge),
    h('p', { class: 'dc-living-line' }, card.sentence),
    reasons,
    ...card.omitted.map((line) => h('p', { class: 'dc-living-line dc-muted' }, line)),
    card.secretLine === null ? null : h('p', { class: 'dc-living-secret', role: 'alert' }, card.secretLine),
    h('p', { class: 'dc-living-path dc-muted' }, card.pathLine),
    card.actions.length === 0 ? null : h('div', { class: 'dc-living-actions' }, ...card.actions.map((action) => actionButton(action, handlers))),
    ...whys.map((why) => h('p', { class: 'dc-living-why dc-muted' }, why)),
  );

  if (card.fonts !== null) {
    const holder = h('div', { class: 'dc-living-fonts' });
    mountSwitch(holder, { label: card.fonts.label, description: card.fonts.help, checked: card.fonts.checked, disabled: card.fonts.disabled, onChange: (checked) => handlers.onEmbedFonts(checked) });
    root.append(holder);
  }
  return root;
};
