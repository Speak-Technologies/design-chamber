// The rail's This chat group (documentation/specs/native-extras.md §4.2, U6): which designs lead the list after a
// click on a chat's sidebar mark, and when the group stays away.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DesignSummary } from '../../src/shared/types.ts';
import { THIS_CHAT_ROWS, chatChip, chatDesigns, thisChatGroup } from '../../src/ui/model/list-model.ts';

const design = (slug: string, sessionId: string | null, updated: string): DesignSummary => ({
  slug,
  kind: 'canvas',
  title: slug,
  created: '2026-10-01T10:00:00.000Z',
  updated,
  pending: false,
  screenCount: 3,
  viewports: [],
  sessionId,
  projectDirectory: null,
  openComments: 0,
  thumb: { state: 'ready', key: null },
  warnings: [],
});

const designs = [
  design('a', 'ses_1', '2026-11-01T10:00:00.000Z'),
  design('b', 'ses_2', '2026-11-05T10:00:00.000Z'),
  design('c', 'ses_1', '2026-11-03T10:00:00.000Z'),
  design('d', null, '2026-11-09T10:00:00.000Z'),
  design('e', 'ses_1', '2026-11-08T10:00:00.000Z'),
  design('f', 'ses_1', '2026-11-02T10:00:00.000Z'),
  design('g', 'ses_1', '2026-11-07T10:00:00.000Z'),
];
const idle = { searching: false, chatOnly: false };
const slugs = (list: readonly DesignSummary[]): string[] => list.map((entry) => entry.slug);

test('no chat: no group, and no designs belong to it (an unlinked design never matches a missing chat)', () => {
  assert.equal(thisChatGroup(designs, null, idle), null);
  assert.equal(thisChatGroup(designs, '', idle), null);
  assert.deepEqual(chatDesigns(designs, null), []);
});

test('a chat with no designs: no group (nothing to point at)', () => {
  assert.equal(thisChatGroup(designs, 'ses_none', idle), null);
  assert.equal(thisChatGroup([], 'ses_1', idle), null);
});

test('one design: one row, no Show all', () => {
  assert.deepEqual(thisChatGroup(designs, 'ses_2', idle), { designs: [designs[1]], total: 1, showAll: null });
});

test('three designs: all three, newest first, no Show all', () => {
  const three = designs.filter((entry) => ['a', 'c', 'e'].includes(entry.slug));
  const group = thisChatGroup(three, 'ses_1', idle);
  assert.deepEqual(slugs(group?.designs ?? []), ['e', 'c', 'a']);
  assert.equal(group?.showAll, null);
});

test('more than three: the newest three, then Show all with the count', () => {
  const group = thisChatGroup(designs, 'ses_1', idle);
  assert.equal(THIS_CHAT_ROWS, 3);
  assert.deepEqual(slugs(group?.designs ?? []), ['e', 'g', 'c']);
  assert.equal(group?.total, 5);
  assert.deepEqual(group?.showAll, { label: 'Show all 5', aria: 'Show all 5 designs from this chat' });
  assert.deepEqual(slugs(chatDesigns(designs, 'ses_1')), ['e', 'g', 'c', 'f', 'a']);
});

test('a search in progress or a list already narrowed to the chat hides the group', () => {
  assert.equal(thisChatGroup(designs, 'ses_1', { searching: true, chatOnly: false }), null);
  assert.equal(thisChatGroup(designs, 'ses_1', { searching: false, chatOnly: true }), null);
});

test('the chip names the chat filter and how to leave it', () => {
  assert.deepEqual(chatChip(5), { label: 'This chat', title: 'Showing 5 designs from this chat', removeLabel: 'Show all designs again' });
  assert.equal(chatChip(1).title, 'Showing 1 design from this chat');
});
