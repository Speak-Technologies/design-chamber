// View-model of the ask bar: keys, whether Send is allowed and why not, the chip, and the copy.
// No DOM, so the rules are tested without one.

import { MESSAGES } from '../../guest/flows.ts';
import type { AskOutcome } from '../../guest/flows.ts';
import { ASK_TEXT_MAX } from '../../shared/limits.ts';
import type { WallSelection } from '../wall/wall-types.ts';

/** The counter appears once the message is this long, so it is silent for ordinary messages. */
export const ASK_COUNTER_FROM = 10_000;
const CHIP_TEXT_MAX = 40;
const CHAT_TITLE_MAX = 40;

export type AskKey = { key: string; shift: boolean; ctrl: boolean; meta: boolean; composing: boolean };

/**
 * What a key press in the textarea does. `newline` is the browser's own behaviour (the view does
 * not prevent it). Nothing special while an IME is composing: Enter there confirms a candidate.
 */
export const askKeyAction = (press: AskKey, state: { hasChip: boolean }): 'send' | 'newline' | 'clear-chip' | 'leave' | null => {
  if (press.composing) return null;
  if (press.key === 'Enter') return press.shift ? 'newline' : 'send';
  if (press.key === 'Escape') return state.hasChip ? 'clear-chip' : 'leave';
  return null;
};

const VIEWING = 'Go back to the current design to ask the agent.';

export type AskSendState = { enabled: boolean; reason: string | null; counter: string | null };

/** Send's state. Lengths are of the trimmed text, which is what the service checks. */
export const askSendState = (input: { text: string; sending: boolean; viewingVersion: boolean }): AskSendState => {
  const length = input.text.trim().length;
  const counter = length >= ASK_COUNTER_FROM ? `${length.toLocaleString()} / ${ASK_TEXT_MAX.toLocaleString()}` : null;
  if (input.viewingVersion) return { enabled: false, reason: VIEWING, counter };
  if (length > ASK_TEXT_MAX) {
    const over = length - ASK_TEXT_MAX;
    return { enabled: false, reason: `That's ${over.toLocaleString()} ${over === 1 ? 'character' : 'characters'} over the limit. Shorten it to send.`, counter };
  }
  return { enabled: length > 0 && !input.sending, reason: null, counter };
};

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** The chip: the tag, the element's text in quotes (cut), and where it is. Every part is plain text. */
export const chipLabel = (selection: WallSelection): { tag: string; text: string; where: string } => {
  const text = oneLine(selection.element.anchor.text);
  return { tag: `<${selection.tag}>`, text: text === '' ? '' : `“${clip(text, CHIP_TEXT_MAX)}”`, where: selection.where };
};

export const askPlaceholder = (link: 'linked' | 'none'): string => (link === 'linked' ? 'Ask the agent to change something' : 'Ask the agent. This starts a new chat.');

/** Where the message will go, in one short line. */
export const askTarget = (link: { sessionId: string | null; selectedId: string | null; selectedTitle: string | null }): string => {
  if (link.sessionId === null) return 'Starts a new chat';
  const title = oneLine(link.selectedTitle ?? '');
  if (link.selectedId === link.sessionId && title !== '') return `Goes to “${clip(title, CHAT_TITLE_MAX)}”`;
  return 'Goes to the linked chat';
};

export const askResultText = (outcome: AskOutcome): string => {
  switch (outcome) {
    case 'sent':
      return 'Sent to the chat.';
    case 'composed':
      return MESSAGES.busyAsk;
    case 'outbox':
      return 'Opening the linked chat to send it.';
    case 'new-session':
      return 'Started a new chat with your message.';
  }
};

/** Under the bar when a send fails; the message and the chip are still there. */
export const askFailureText = (reason: string): string => `Couldn't send. ${reason.trim()} Your message is still here.`;
