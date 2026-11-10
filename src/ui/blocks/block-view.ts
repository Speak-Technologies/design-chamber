// What every chat block view gets and gives back, and the one-sentence state both blocks use for
// "nothing to show here" (bad arguments, a design that is gone, a service that does not answer).

import type { ToastKind } from '@openchamber/sdk';
import { mountButton } from '@openchamber/sdk/ui';

import type { HostLike } from '../../guest/host.ts';
import type { ServiceClient } from '../../guest/service-client.ts';
import { h } from '../components/dom.ts';
import { icon, type IconName } from '../components/icons.ts';

export type BlockContext = {
  client: ServiceClient;
  host: Pick<HostLike, 'openSurface' | 'answerBlock'>;
  /** Best effort: a toast that cannot be shown is logged, never thrown. */
  toast: (kind: ToastKind, message: string) => void;
};

export type BlockView = {
  /** The host replays the call (after a reload, and once answered) with the answer it kept. */
  update: (answered: string | null) => void;
  dispose: () => void;
};

export type NoticeOptions = {
  icon: IconName;
  text: string;
  /** A second, quieter sentence under the first. */
  detail?: string;
  action?: { label: string; onClick: () => void };
};

/** A block that has only a sentence to say, with at most one way forward. */
export const notice = (options: NoticeOptions): HTMLElement => {
  const body = h('div', { class: 'dcb-notice-body' }, h('p', { class: 'dcb-notice-text' }, options.text), options.detail ? h('p', { class: 'dcb-notice-detail' }, options.detail) : null);
  const el = h('div', { class: 'dcb-block dcb-notice', role: 'status' }, h('span', { class: 'dcb-notice-icon' }, icon(options.icon, 16)), body);
  if (options.action) {
    const slot = h('div', { class: 'dcb-notice-action' });
    body.append(slot);
    mountButton(slot, { label: options.action.label, variant: 'outline', size: 'sm', onClick: options.action.onClick });
  }
  return el;
};
