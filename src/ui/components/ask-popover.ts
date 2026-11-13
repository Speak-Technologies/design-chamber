// A small box hung under a control that sends one request to the design's linked chat: "+ Screen" ("What
// should the new screen show?") and Try 3 directions share it (Phase 2 technical design §5.4, §6.3). It is
// the ask flow with a different brief, not a write: nothing in the design changes until the agent answers.
//
// The words the user types are kept whatever happens: a failure puts a sentence under the box and turns
// Ask the agent back on; Esc and Cancel close it without sending. The rules (the room for the words, the
// counter, when Send is on) are in `model/screens-model.ts`.

import type { AskOutcome } from '../../guest/flows.ts';
import { askFailureText } from '../model/ask-bar-model.ts';
import { askNoteBox } from '../model/screens-model.ts';
import { toast } from './actions.ts';
import { errorText, h, nextId } from './dom.ts';
import { btn, openPopover, type PopoverHandle } from './kit.ts';

export type AskPopoverOptions = {
  /** Where the box mounts (the app root, so it uses the app's variables). */
  host: HTMLElement;
  /** The control it hangs under; it gets focus back when the box closes. */
  anchor: HTMLElement;
  /** The question: the box's heading and the textarea's label. */
  title: string;
  placeholder?: string;
  /** Characters the user's words may take. */
  room: number;
  /** "Goes to the linked chat" and its siblings: where the message will land, read when the box opens. */
  target: string;
  /** Send the words (the whole ask text is the caller's to build). Rejects with a sentence for the user. */
  send: (note: string) => Promise<AskOutcome>;
  /** The message went; the box has closed. */
  onSent: (outcome: AskOutcome) => void;
  /** The box closed, however it did. */
  onClose?: () => void;
};

export const openAskPopover = (options: AskPopoverOptions): PopoverHandle => {
  const ids = { hint: nextId('dc-ask-pop-hint'), count: nextId('dc-ask-pop-count') };
  let sending = false;
  let closed = false;
  const popover = openPopover(options.host, options.anchor, {
    title: options.title,
    onClose: () => {
      closed = true;
      options.onClose?.();
    },
  });

  const area = h('textarea', {
    class: 'oc-sdk oc-sdk-input dc-textarea',
    rows: 3,
    'aria-label': options.title,
    'aria-describedby': `${ids.hint} ${ids.count}`,
    'aria-keyshortcuts': 'Control+Enter Meta+Enter',
    placeholder: options.placeholder,
    spellcheck: true,
  });
  const failure = h('p', { class: 'dc-form-error', role: 'alert', hidden: true });
  const hint = h('p', { class: 'dc-pop-hint', id: ids.hint }, options.target);
  const counter = h('span', { class: 'dc-pop-count', id: ids.count });
  const cancel = btn({ label: 'Cancel', variant: 'ghost', size: 'sm', onClick: () => popover.close() });
  const send = btn({ label: 'Ask the agent', variant: 'default', size: 'sm', emphasis: 'primary', onClick: () => void submit() });
  popover.el.classList.add('dc-ask-pop');
  popover.body.append(area, failure, h('div', { class: 'dc-ask-pop-meta' }, hint, counter));
  popover.foot.append(h('span', { class: 'dc-pop-actions' }, cancel.el, send.el));
  // The box opened empty: now that its content is in, put it where the room is (over the anchor, near the bottom of the window).
  popover.reposition();

  const paint = (): void => {
    const box = askNoteBox({ typed: area.value, room: options.room, sending });
    area.readOnly = sending;
    popover.el.setAttribute('aria-busy', String(sending));
    send.set({ disabled: !box.canSend, loading: sending });
    counter.textContent = box.counter ?? '';
    counter.dataset.state = box.over ? 'over' : 'ok';
    counter.hidden = box.counter === null;
    // Over the limit the button is off; the counter says by how many, and the sentence names the way out.
    area.title = box.over ? 'Shorten it to send.' : '';
  };

  const submit = async (): Promise<void> => {
    if (sending || !askNoteBox({ typed: area.value, room: options.room, sending }).canSend) return;
    sending = true;
    failure.hidden = true;
    paint();
    try {
      const outcome = await options.send(area.value.trim());
      sending = false;
      popover.close();
      options.onSent(outcome);
    } catch (error) {
      sending = false;
      if (closed) {
        // Cancelled while it was on its way: there is no box to put the sentence in.
        toast('error', askFailureText(errorText(error)));
        return;
      }
      failure.textContent = askFailureText(errorText(error));
      failure.hidden = false;
      paint();
      popover.reposition();
      area.focus();
    }
  };

  area.addEventListener('input', () => {
    // A new edit is the answer to the last failure.
    failure.hidden = true;
    paint();
  });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  });

  paint();
  area.focus();
  return popover;
};
