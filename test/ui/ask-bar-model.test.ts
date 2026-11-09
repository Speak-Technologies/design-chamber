import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ASK_TEXT_MAX } from '../../src/shared/limits.ts';
import {
  ASK_COUNTER_FROM,
  askFailureText,
  askKeyAction,
  askPlaceholder,
  askResultText,
  askSendState,
  askTarget,
  chipLabel,
  type AskKey,
} from '../../src/ui/model/ask-bar-model.ts';
import type { WallSelection } from '../../src/ui/wall/wall-types.ts';

const key = (name: string, extra: Partial<AskKey> = {}): AskKey => ({ key: name, shift: false, ctrl: false, meta: false, composing: false, ...extra });

describe('askKeyAction', () => {
  const none = { hasChip: false };
  const chip = { hasChip: true };

  test('Enter and Ctrl or Command + Enter send', () => {
    assert.equal(askKeyAction(key('Enter'), none), 'send');
    assert.equal(askKeyAction(key('Enter', { ctrl: true }), none), 'send');
    assert.equal(askKeyAction(key('Enter', { meta: true }), chip), 'send');
  });

  test('Shift + Enter adds a line, even with Ctrl held', () => {
    assert.equal(askKeyAction(key('Enter', { shift: true }), none), 'newline');
    assert.equal(askKeyAction(key('Enter', { shift: true, ctrl: true }), none), 'newline');
  });

  test('Escape removes the chip when there is one, else leaves the bar', () => {
    assert.equal(askKeyAction(key('Escape'), chip), 'clear-chip');
    assert.equal(askKeyAction(key('Escape'), none), 'leave');
  });

  test('nothing special while an IME is composing, Enter and Escape included', () => {
    assert.equal(askKeyAction(key('Enter', { composing: true }), none), null);
    assert.equal(askKeyAction(key('Enter', { composing: true, ctrl: true }), none), null);
    assert.equal(askKeyAction(key('Escape', { composing: true }), chip), null);
  });

  test('other keys are left alone', () => {
    for (const name of ['a', 'Tab', 'Backspace', 'ArrowUp', ' ']) assert.equal(askKeyAction(key(name), chip), null);
  });
});

describe('askSendState', () => {
  const idle = { text: 'Make it bigger', sending: false, viewingVersion: false };

  test('a message that is ready can be sent', () => {
    assert.deepEqual(askSendState(idle), { enabled: true, reason: null, counter: null });
  });

  test('blank or whitespace only: disabled, nothing to say', () => {
    for (const text of ['', '   ', '\n\t \n']) assert.deepEqual(askSendState({ ...idle, text }), { enabled: false, reason: null, counter: null });
  });

  test('sending: disabled, so a second Enter cannot send twice', () => {
    assert.equal(askSendState({ ...idle, sending: true }).enabled, false);
  });

  test('viewing an old version: disabled with the way back', () => {
    const state = askSendState({ ...idle, viewingVersion: true });
    assert.equal(state.enabled, false);
    assert.equal(state.reason, 'Go back to the current design to ask the agent.');
  });

  test('the counter shows from 10 000 characters, in numbers only', () => {
    assert.equal(ASK_COUNTER_FROM, 10_000);
    assert.equal(askSendState({ ...idle, text: 'a'.repeat(ASK_COUNTER_FROM - 1) }).counter, null);
    const shown = askSendState({ ...idle, text: 'a'.repeat(ASK_COUNTER_FROM) });
    assert.equal(shown.enabled, true);
    assert.equal(shown.counter?.replace(/\D/g, ''), `${ASK_COUNTER_FROM}${ASK_TEXT_MAX}`);
    assert.ok(shown.counter?.includes('/'));
  });

  test('exactly the limit sends; one over does not, and says by how many', () => {
    assert.equal(askSendState({ ...idle, text: 'a'.repeat(ASK_TEXT_MAX) }).enabled, true);
    const one = askSendState({ ...idle, text: 'a'.repeat(ASK_TEXT_MAX + 1) });
    assert.equal(one.enabled, false);
    assert.equal(one.reason, "That's 1 character over the limit. Shorten it to send.");
    const many = askSendState({ ...idle, text: 'a'.repeat(ASK_TEXT_MAX + 250) });
    assert.equal(many.reason, "That's 250 characters over the limit. Shorten it to send.");
  });

  test('the length that counts is the trimmed one, like the service', () => {
    assert.equal(askSendState({ ...idle, text: `  ${'a'.repeat(ASK_TEXT_MAX)}\n` }).enabled, true);
  });

  test('viewing a version outranks the other reasons', () => {
    assert.equal(askSendState({ text: 'a'.repeat(ASK_TEXT_MAX + 5), sending: true, viewingVersion: true }).reason, 'Go back to the current design to ask the agent.');
  });
});

describe('chipLabel', () => {
  const selection = (text: string, tag = 'button'): WallSelection => ({
    key: 'a:b',
    tag,
    where: 'Pricing · Laptop',
    element: { screen: 'pricing', viewport: 'laptop', anchor: { selector: 'main > button', text, html: '<button>', rect: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0, y: 0 } } },
  });

  test('tag in angle brackets, the element text quoted, and where it is', () => {
    assert.deepEqual(chipLabel(selection('Start free trial')), { tag: '<button>', text: '“Start free trial”', where: 'Pricing · Laptop' });
  });

  test('long text is cut to 40 characters with an ellipsis; whitespace is collapsed', () => {
    const { text } = chipLabel(selection(`  ${'word '.repeat(30)}`));
    assert.ok(text.startsWith('“word word') && text.endsWith('…”'));
    assert.ok(text.length <= 40 + 2, `${text.length}`);
    assert.ok(!text.includes('  '));
  });

  test('an element with no text has no quoted part', () => {
    assert.equal(chipLabel(selection('')).text, '');
    assert.equal(chipLabel(selection(' \n ')).text, '');
  });
});

describe('copy', () => {
  test('placeholder', () => {
    assert.equal(askPlaceholder('linked'), 'Ask the agent to change something');
    assert.equal(askPlaceholder('none'), 'Ask the agent. This starts a new chat.');
  });

  test('target line: selected linked chat by title, linked but elsewhere, none', () => {
    assert.equal(askTarget({ sessionId: 'ses_1', selectedId: 'ses_1', selectedTitle: 'Coffee site' }), 'Goes to “Coffee site”');
    assert.equal(askTarget({ sessionId: 'ses_1', selectedId: 'ses_2', selectedTitle: 'Other' }), 'Goes to the linked chat');
    assert.equal(askTarget({ sessionId: 'ses_1', selectedId: null, selectedTitle: null }), 'Goes to the linked chat');
    assert.equal(askTarget({ sessionId: null, selectedId: 'ses_2', selectedTitle: 'Other' }), 'Starts a new chat');
  });

  test('a long chat title is cut so the target line stays one line', () => {
    const line = askTarget({ sessionId: 's', selectedId: 's', selectedTitle: 'x'.repeat(200) });
    assert.ok(line.length < 80, `${line.length}`);
    assert.ok(line.endsWith('…”'));
  });

  test('a blank chat title falls back to the plain line', () => {
    assert.equal(askTarget({ sessionId: 's', selectedId: 's', selectedTitle: '  ' }), 'Goes to the linked chat');
  });

  test('result per outcome', () => {
    assert.equal(askResultText('sent'), 'Sent to the chat.');
    assert.equal(askResultText('composed'), 'The agent is busy, so your message is waiting in the composer.');
    assert.equal(askResultText('outbox'), 'Opening the linked chat to send it.');
    assert.equal(askResultText('new-session'), 'Started a new chat with your message.');
  });
});

test('failure text keeps the reason and says the message is still there', () => {
  assert.equal(askFailureText('The local service did not answer. '), "Couldn't send. The local service did not answer. Your message is still here.");
});
