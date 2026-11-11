// The ask bar: a prompt docked under the design. The user types what to change, optionally with
// an element attached as a chip, and it goes to the design's linked chat. This file is the view;
// the rules (keys, what Send may do, the copy) are in `model/ask-bar-model.ts`, and
// `wall/feature-ask-bar.ts` connects it to the wall and the chat.

import type { AskOutcome } from '../../guest/flows.ts';
import {
  askFailureText,
  askKeyAction,
  askPlaceholder,
  askResultText,
  askSendState,
  askTarget,
  chipLabel,
  type AskKey,
} from '../model/ask-bar-model.ts';
import type { WallSelection } from '../wall/wall-types.ts';
import { errorText, h, nextId } from './dom.ts';
import { btn, iconBtn } from './kit.ts';

/** How long "Sent to the chat." stays under the bar. */
const STATUS_MS = 4000;
const MAX_ROWS = { panel: 4, page: 6 } as const;

export type AskLink = { sessionId: string | null; selectedId: string | null; selectedTitle: string | null };

export type AskBarOptions = {
  surface: 'panel' | 'page';
  /** Send the message (and the attached element, if any). Rejects with a sentence for the user. */
  onSend: (text: string, selection: WallSelection | null) => Promise<AskOutcome>;
  /** The chip is gone (removed, or its message went out): the wall can forget the selected element. */
  onChipRemoved: () => void;
  /** Escape with nothing to remove: hand the keyboard back to the wall. */
  onLeave: () => void;
};

export type AskBarHandle = {
  el: HTMLElement;
  /** Show or remove the chip. Does not call `onChipRemoved`: the caller is reacting to the wall. */
  setSelection: (selection: WallSelection | null) => void;
  selection: () => WallSelection | null;
  /** Put words in the box (the text editor hands over what the user typed) and keep them; `focus` moves the caret to the end. */
  setText: (text: string) => void;
  /** Move the keyboard into the box. */
  focus: () => void;
  setLink: (link: AskLink) => void;
  /** An old version is on show: the agent edits the current files, so asking is off. */
  setViewing: (viewing: boolean) => void;
  /** Another filled primary is on screen (the Tweaks panel's Save): Send drops to the outline look and keeps working. */
  setQuiet: (quiet: boolean) => void;
  dispose: () => void;
};

const keyOf = (event: KeyboardEvent): AskKey => ({
  key: event.key,
  shift: event.shiftKey,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
  // keyCode 229 is how older engines report a key swallowed by an IME.
  composing: event.isComposing || event.keyCode === 229,
});

export const createAskBar = (options: AskBarOptions): AskBarHandle => {
  const ids = { target: nextId('dc-ask-target'), hint: nextId('dc-ask-hint') };
  let selection: WallSelection | null = null;
  let link: AskLink = { sessionId: null, selectedId: null, selectedTitle: null };
  let viewing = false;
  let sending = false;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  const area = h('textarea', {
    class: 'oc-sdk oc-sdk-input dc-ask-input',
    rows: 1,
    'aria-label': 'Message to the agent',
    'aria-describedby': `${ids.target} ${ids.hint}`,
    spellcheck: true,
  });
  const chipTag = h('code', { class: 'dc-chip-code' });
  const chipText = h('span', { class: 'dc-ask-chip-text' });
  const chipWhere = h('span', { class: 'dc-ask-chip-where' });
  const removeChip = iconBtn({ icon: 'close', label: 'Remove the attached element', size: 'sm', onClick: () => clearChip() });
  const chip = h('div', { class: 'dc-ask-chip', role: 'group', 'aria-label': 'Attached element', hidden: true }, chipTag, chipText, chipWhere, removeChip);
  const failure = h('p', { class: 'dc-form-error dc-ask-msg', role: 'alert', hidden: true });
  const status = h('span', { class: 'dc-ask-status', role: 'status', 'aria-live': 'polite' });
  const target = h('span', { class: 'dc-ask-target', id: ids.target });
  const counter = h('span', { class: 'dc-ask-counter' });
  const send = btn({ label: 'Send', variant: 'default', size: 'sm', icon: 'send', emphasis: 'primary', onClick: () => void submit() });
  const hint = h('span', { class: 'dc-ask-sr', id: ids.hint }, 'Enter sends, Shift+Enter adds a line.');

  const el = h(
    'form',
    { class: 'dc-ask', 'data-surface': options.surface, 'aria-label': 'Ask the agent', novalidate: true },
    h('div', { class: 'dc-ask-box' }, chip, area, failure, h('div', { class: 'dc-ask-foot' }, target, status, counter, send.el), hint),
  );
  el.addEventListener('submit', (event) => event.preventDefault());

  /** Grow with the text up to the row limit, then scroll. Empty or not on screen yet: the CSS height. */
  const fit = (): void => {
    area.style.height = '';
    if (!area.isConnected || area.value === '') return;
    const style = getComputedStyle(area);
    const sum = (...values: string[]): number => values.reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
    const borders = sum(style.borderTopWidth, style.borderBottomWidth);
    const chrome = borders + sum(style.paddingTop, style.paddingBottom);
    const line = Number.parseFloat(style.lineHeight);
    const limit = Number.isFinite(line) ? line * MAX_ROWS[options.surface] + chrome : Number.POSITIVE_INFINITY;
    area.style.height = `${Math.min(area.scrollHeight + borders, limit)}px`;
  };

  const paint = (): void => {
    const state = askSendState({ text: area.value, sending, viewingVersion: viewing });
    area.placeholder = askPlaceholder(link.sessionId === null ? 'none' : 'linked');
    area.readOnly = sending;
    area.disabled = viewing;
    el.setAttribute('aria-busy', String(sending));
    send.set({ disabled: !state.enabled, loading: sending });
    // A reason (old version, over the limit) takes the target line's place and outranks the confirmation;
    // the rail otherwise keeps only the reason on screen.
    const line = state.reason ?? askTarget(link);
    target.textContent = line;
    target.title = line;
    target.dataset.reason = state.reason === null ? 'none' : viewing ? 'viewing' : 'limit';
    area.title = line;
    const confirmed = status.textContent !== '' && state.reason === null;
    target.hidden = confirmed;
    status.hidden = !confirmed;
    // Over the limit the reason already says by how many.
    counter.textContent = state.counter ?? '';
    counter.hidden = state.counter === null || state.reason !== null;
    if (selection) {
      const label = chipLabel(selection);
      chipTag.textContent = label.tag;
      chipText.textContent = label.text;
      chipText.hidden = label.text === '';
      chipWhere.textContent = label.where;
    }
    chip.hidden = selection === null;
    removeChip.disabled = sending;
  };

  const showStatus = (text: string): void => {
    clearTimeout(statusTimer);
    status.textContent = text;
    paint();
    if (text !== '') statusTimer = setTimeout(() => showStatus(''), STATUS_MS);
  };

  const showFailure = (text: string | null): void => {
    failure.hidden = text === null;
    failure.textContent = text ?? '';
  };

  const clearChip = (): void => {
    if (selection === null) return;
    selection = null;
    paint();
    options.onChipRemoved();
  };

  const submit = async (): Promise<void> => {
    if (sending || !askSendState({ text: area.value, sending, viewingVersion: viewing }).enabled) return;
    const text = area.value.trim();
    const sent = selection;
    sending = true;
    showFailure(null);
    showStatus('');
    paint();
    try {
      const outcome = await options.onSend(text, sent);
      sending = false;
      area.value = '';
      fit();
      // The chip goes with the message, unless the user picked another element while it was on its way:
      // that element's comment card is theirs, and is left alone.
      const pickedAnother = selection !== null && selection.key !== sent?.key;
      if (!pickedAnother) selection = null;
      paint();
      if (sent !== null && !pickedAnother) options.onChipRemoved();
      showStatus(askResultText(outcome));
    } catch (error) {
      sending = false;
      paint();
      showFailure(askFailureText(errorText(error)));
      area.focus();
    }
  };

  area.addEventListener('input', () => {
    // A new edit is the answer to the last failure and makes the last success old news.
    showFailure(null);
    showStatus('');
    fit();
    paint();
  });
  area.addEventListener('keydown', (event) => {
    const action = askKeyAction(keyOf(event), { hasChip: selection !== null });
    if (action === 'send') {
      event.preventDefault();
      void submit();
    } else if (action === 'clear-chip') {
      event.preventDefault();
      event.stopPropagation();
      clearChip();
    } else if (action === 'leave') {
      event.preventDefault();
      event.stopPropagation();
      options.onLeave();
    }
  });

  paint();
  fit();
  return {
    el,
    setSelection: (next) => {
      selection = next;
      paint();
    },
    selection: () => selection,
    setText: (text) => {
      area.value = text;
      showFailure(null);
      showStatus('');
      fit();
      paint();
    },
    focus: () => {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    },
    setLink: (next) => {
      link = next;
      paint();
    },
    setViewing: (next) => {
      viewing = next;
      paint();
    },
    setQuiet: (quiet) => {
      if (quiet) delete send.el.dataset.emphasis;
      else send.el.dataset.emphasis = 'primary';
      send.el.dataset.variant = quiet ? 'outline' : 'default';
    },
    dispose: () => {
      clearTimeout(statusTimer);
      el.remove();
    },
  };
};
