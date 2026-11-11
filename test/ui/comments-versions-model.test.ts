import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Comment, Screen, VersionSummary } from '../../src/shared/types.ts';
import { countByStatus, groupComments, pinAriaLabel, pinGlyph, pinNumbers, sendResultCopy, sendState, sendThisProblem, viewportOf } from '../../src/ui/model/comments-model.ts';
import { historyNotice, reasonLabel, versionRows, viewingBanner } from '../../src/ui/model/versions-model.ts';

const comment = (id: string, over: Partial<Comment> = {}): Comment => ({
  id,
  screen: 'home',
  viewport: 'laptop',
  anchor: { selector: 'h1', text: 'Hello', html: '<h1>', rect: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 0.5, y: 0.5 } },
  body: 'Make it shorter',
  status: 'open',
  created: '2026-10-26T10:00:00.000Z',
  sentAt: null,
  sentVersion: null,
  ...over,
});

const screens: Screen[] = [
  { id: 'home', title: 'Home', file: 'screens/home.html' },
  { id: 'pricing', title: 'Pricing', file: 'screens/pricing.html' },
];

test('pinNumbers follow creation order, not array order, and break ties by array order', () => {
  const list = [
    comment('c_b', { created: '2026-10-26T10:05:00.000Z' }),
    comment('c_a', { created: '2026-10-26T10:00:00.000Z' }),
    comment('c_c', { created: '2026-10-26T10:05:00.000Z' }),
  ];
  const numbers = pinNumbers(list);
  assert.equal(numbers.get('c_a'), 1);
  assert.equal(numbers.get('c_b'), 2);
  assert.equal(numbers.get('c_c'), 3);
});

test('groupComments keeps wall order, puts artifact comments first and surfaces orphans', () => {
  const list = [comment('c_1', { screen: 'pricing' }), comment('c_2', { screen: 'home' }), comment('c_3', { screen: 'gone' }), comment('c_4', { screen: null })];
  const groups = groupComments(list, screens, 'Artifact');
  assert.deepEqual(groups.map((g) => g.key), ['page', 'home', 'pricing', '__removed:gone']);
  assert.deepEqual(groups.map((g) => g.comments.map((c) => c.id)), [['c_4'], ['c_2'], ['c_1'], ['c_3']]);
});

test('comments on a screen that was moved to trash group under "<id> · Screen removed", one group per removed screen, after the listed ones', () => {
  const list = [
    comment('c_1', { screen: 'checkout' }),
    comment('c_2', { screen: 'home' }),
    comment('c_3', { screen: 'old-pricing' }),
    comment('c_4', { screen: 'checkout' }),
  ];
  const groups = groupComments(list, screens, 'Tidepool');
  assert.deepEqual(groups.map((g) => g.title), ['Home', 'checkout · Screen removed', 'old-pricing · Screen removed']);
  assert.deepEqual(groups.map((g) => g.removed ?? false), [false, true, true]);
  assert.deepEqual(groups[1]?.comments.map((c) => c.id), ['c_1', 'c_4']);
  // Undo puts the screen back: its comments are in a normal group again, with nothing left over.
  const restored = groupComments(list, [...screens, { id: 'checkout', title: 'Checkout', file: 'screens/checkout.html' }], 'Tidepool');
  assert.deepEqual(restored.map((g) => g.title), ['Home', 'Checkout', 'old-pricing · Screen removed']);
});

test('sendState says why it is disabled and counts only open comments', () => {
  const none = sendState([comment('c_1', { status: 'sent' })], true);
  assert.equal(none.enabled, false);
  assert.match(none.reason ?? '', /Add a comment/);
  const two = sendState([comment('c_1'), comment('c_2'), comment('c_3', { status: 'resolved' })], true);
  assert.deepEqual([two.enabled, two.label, two.reason], [true, 'Send 2 comments to chat', null]);
  assert.equal(sendState([comment('c_1')], true).label, 'Send 1 comment to chat');
  assert.match(sendState([comment('c_1')], false).reason ?? '', /new chat/);
});

test('pin glyph and label never rely on colour alone', () => {
  assert.equal(pinGlyph(comment('c_1'), 3), '3');
  assert.equal(pinGlyph(comment('c_1', { status: 'resolved' }), 3), '✓');
  assert.equal(pinAriaLabel(comment('c_1', { status: 'sent' }), 2), 'Comment 2: Make it shorter (sent to chat)');
  assert.ok(pinAriaLabel(comment('c_1', { body: 'x'.repeat(100) }), 1).includes('…'));
  assert.deepEqual(countByStatus([comment('a'), comment('b', { status: 'sent' }), comment('c', { status: 'sent' })]), { open: 1, sent: 2, resolved: 0 });
});

const version = (n: number, reason: VersionSummary['reason']): VersionSummary => ({
  id: `v${n}`,
  n,
  created: '2026-10-26T10:00:00.000Z',
  reason,
  sessionId: null,
  treeHash: `hash${n}`,
  bytes: 10,
  fileCount: 4,
});

test('versionRows lists newest first and marks current only when nothing changed since', () => {
  const rows = versionRows([version(1, 'auto'), version(3, 'turn'), version(2, 'restore-point')], false);
  assert.deepEqual(rows.map((r) => r.title), ['v3', 'v2', 'v1']);
  assert.deepEqual(rows.map((r) => r.current), [true, false, false]);
  assert.equal(versionRows([version(1, 'auto')], true)[0]?.current, false);
});

test('version copy uses the labels the spec names', () => {
  assert.equal(reasonLabel('turn'), 'After agent turn');
  assert.equal(reasonLabel('manual'), 'Saved manually');
  assert.equal(reasonLabel('restore-point'), 'Before restore');
  assert.equal(reasonLabel('user-edit'), 'Before your edits');
  assert.equal(reasonLabel('keep-direction'), 'Before keeping a direction');
  assert.equal(viewingBanner(12, false), 'Viewing v12 (read only)');
  assert.match(viewingBanner(12, true), /Comparing v12/);
});

test('viewportOf names a page comment made in Full width, and a real viewport of that id still wins', () => {
  const laptop = { id: 'laptop', label: 'Laptop', width: 1280, height: 800 };
  assert.equal(viewportOf([laptop], 'laptop'), 'Laptop 1280×800');
  assert.equal(viewportOf([laptop], 'fill'), 'Full width');
  assert.equal(viewportOf([{ id: 'fill', label: 'Wide', width: 1920, height: 1080 }], 'fill'), 'Wide 1920×1080');
  assert.equal(viewportOf([laptop], 'gone'), 'gone');
});

test('sendResultCopy: the batch copy is unchanged, one comment is named by its pin number', () => {
  const base = { commentIds: ['a', 'b'], omitted: [] as string[] };
  assert.deepEqual(sendResultCopy({ ...base, outcome: 'sent' }, null), { kind: 'success', message: '2 comments sent to the chat.' });
  assert.deepEqual(sendResultCopy({ ...base, outcome: 'outbox' }, null), { kind: 'success', message: '2 comments sent to the chat.' });
  assert.deepEqual(sendResultCopy({ ...base, outcome: 'new-session' }, null), { kind: 'success', message: 'Started a new chat with 2 comments.' });
  assert.deepEqual(sendResultCopy({ ...base, outcome: 'sent', omitted: ['c'] }, null), { kind: 'info', message: '2 of 3 comments sent. Send again for the rest.' });
  assert.equal(sendResultCopy({ ...base, outcome: 'composed' }, null), null, 'the flow already told the user the agent is busy');
  assert.deepEqual(sendResultCopy({ commentIds: [], omitted: [], outcome: 'nothing' }, null), { kind: 'info', message: 'There are no open comments to send.' });
  assert.equal(sendResultCopy({ ...base, outcome: 'sent', markFailed: true }, null)?.kind, 'info');
  assert.match(sendResultCopy({ ...base, outcome: 'sent', markFailed: true }, null)?.message ?? '', /could not be marked as sent/);

  const one = { commentIds: ['a'], omitted: [] as string[] };
  assert.deepEqual(sendResultCopy({ ...one, outcome: 'sent' }, 3), { kind: 'success', message: 'Comment 3 sent to the chat.' });
  assert.deepEqual(sendResultCopy({ ...one, outcome: 'new-session' }, 3), { kind: 'success', message: 'Started a new chat with comment 3.' });
  assert.deepEqual(sendResultCopy({ ...one, outcome: 'sent' }, null), { kind: 'success', message: '1 comment sent to the chat.' });
  assert.equal(sendResultCopy({ ...one, outcome: 'composed' }, 3), null);
});

test('sendThisProblem: only an open comment may be sent on its own; the card can be older than the comment', () => {
  assert.equal(sendThisProblem(comment('c_a')), null);
  assert.equal(sendThisProblem(comment('c_a', { status: 'sent' })), 'That comment was already sent to the chat.');
  assert.equal(sendThisProblem(comment('c_a', { status: 'resolved' })), 'That comment is resolved, so it was not sent. Reopen it first.');
  assert.equal(sendThisProblem(undefined), 'That comment is gone, so there is nothing to send.');
});

test('historyNotice has a calm, specific notice for every history state', () => {
  const states = ['repaired', 'recovered', 'reset', 'unsupported'] as const;
  assert.deepEqual(states.map((state) => historyNotice(state).tone), ['warning', 'warning', 'warning', 'info']);
  assert.equal(historyNotice('repaired').title, 'Some versions could not be read');
  assert.match(historyNotice('repaired').body, /hidden from this list/);
  assert.equal(historyNotice('recovered').title, 'Version list restored from its backup');
  assert.match(historyNotice('recovered').body, /newest version may be missing/);
  assert.equal(historyNotice('reset').title, 'Older versions could not be recovered');
  assert.match(historyNotice('reset').body, /old files are kept/);
  assert.equal(historyNotice('unsupported').title, 'Saved by a newer Design Chamber');
  assert.match(historyNotice('unsupported').body, /Update the extension/);
  for (const state of states) assert.ok(!/[\u2014\u2013]/.test(historyNotice(state).title + historyNotice(state).body), `${state}: no dashes`);
});
