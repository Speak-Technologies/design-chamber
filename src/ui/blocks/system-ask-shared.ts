// What the SystemAsk block's views share (documentation/specs/phase-2-5-technical.md §8.12, SP-4):
// the frame (head, scrolling body, pinned footer), the one place an answer leaves the block, the
// "host cannot take an answer" state with Copy my answer, and the refetch timer.

import { mountButton, type ButtonHandle } from '@openchamber/sdk/ui';

import { isHostError } from '../../guest/flows.ts';
import { h } from '../components/dom.ts';
import { icon, type IconName } from '../components/icons.ts';
import { HOST_CANNOT_TAKE, REFUSED_ANSWER } from '../model/system-ask-model.ts';
import type { BlockContext } from './block-view.ts';

export type Frame = {
  el: HTMLElement;
  body: HTMLElement;
  /** Null for a block that has nothing to press (an answered or read-only one). */
  foot: HTMLElement | null;
};

let counter = 0;
/** An id for one drawn block: ids must be unique inside the frame. */
export const uid = (prefix: string): string => `${prefix}${(counter += 1)}`;

export type FrameOptions = {
  icon: IconName;
  title: string;
  /** Under the title: the round, or what the proposal does. */
  sub: string | null;
  /** The quiet word at the end of the head (the proposal id). */
  side?: string | null;
  foot: boolean;
};

export const frame = (options: FrameOptions): Frame => {
  const titleId = uid('dcb-ask-title');
  const body = h('div', { class: 'dcb-ask-body' });
  const foot = options.foot ? h('footer', { class: 'dcb-ask-foot' }) : null;
  const el = h(
    'section',
    { class: 'dcb-block dcb-ask', 'aria-labelledby': titleId },
    h(
      'header',
      { class: 'dcb-ask-head' },
      h('span', { class: 'dcb-ask-icon' }, icon(options.icon, 16)),
      h('div', { class: 'dcb-ask-titles' }, h('h2', { class: 'dcb-ask-title', id: titleId }, options.title), options.sub ? h('p', { class: 'dcb-ask-sub' }, options.sub) : null),
      options.side ? h('span', { class: 'dcb-ask-side' }, options.side) : null,
    ),
    body,
    foot,
  );
  return { el, body, foot };
};

export type SendOutcome = 'sent' | 'host-rejected' | 'refused';

/**
 * Hands the answer to the host. Called from the click itself with the text already built: the host
 * takes an answer only inside the user's activation, so nothing is awaited before `answerBlock`.
 */
export const sendAnswer = (ctx: BlockContext, text: string): Promise<SendOutcome> =>
  ctx.host.answerBlock(text).then(
    (): SendOutcome => 'sent',
    (error: unknown): SendOutcome => (isHostError(error, 'HOST_REJECTED') ? 'host-rejected' : 'refused'),
  );

/** The sentence a refused answer leaves in the footer; the form stays as it was. */
export const refusedLine = (): HTMLElement => h('p', { class: 'dcb-ask-problem', role: 'alert' }, REFUSED_ANSWER);

/** The host cannot take an answer from this block: say so, and offer the answer to copy. */
export const cannotTake = (ctx: BlockContext, text: string): { el: HTMLElement; dispose: () => void } => {
  const slot = h('span', { class: 'dcb-ask-btn' });
  let handle: ButtonHandle | null = null;
  const status = h('p', { class: 'dcb-ask-reason', role: 'status' }, HOST_CANNOT_TAKE);
  handle = mountButton(slot, {
    label: 'Copy my answer',
    variant: 'outline',
    size: 'sm',
    onClick: () => {
      // A click: the clipboard write needs the activation, so it comes before anything else.
      ctx.host.writeClipboard(text).then(
        () => ctx.toast('success', 'Copied. Paste it in the chat.'),
        () => ctx.toast('error', 'Couldn’t copy. Select the answer and copy it yourself.'),
      );
    },
  });
  return { el: h('div', { class: 'dcb-ask-cannot' }, status, slot), dispose: () => handle?.dispose() };
};

/** Runs `tick` on window focus and every `ms` while the frame is visible; one at a time. */
export const startRefetch = (tick: () => Promise<void>, ms: number): (() => void) => {
  let busy = false;
  const run = (): void => {
    if (busy || document.visibilityState === 'hidden') return;
    busy = true;
    tick()
      .catch((error: unknown) => console.warn('Design Chamber: refetch failed', error))
      .finally(() => {
        busy = false;
      });
  };
  const timer = setInterval(run, ms);
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', run);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', run);
    document.removeEventListener('visibilitychange', run);
  };
};

/** The primary button of the footer: the kit's button, marked as the one filled action. */
export const primaryOf = (slot: HTMLElement): HTMLButtonElement | null => {
  const button = slot.querySelector('button');
  button?.setAttribute('data-emphasis', 'primary');
  return button;
};
