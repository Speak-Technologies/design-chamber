// Words typed into a comment card are never lost to a pan, a zoom or a closed card
// (src/ui/model/comment-drafts.ts): what counts as unsaved, where it is kept and when it goes.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composerDraftKey, createDraftStore, threadDraftKey, unsavedText } from '../../src/ui/model/comment-drafts.ts';

test('unsavedText: only words that differ from what is saved count; an empty card has nothing to lose', () => {
  assert.equal(unsavedText(''), null);
  assert.equal(unsavedText('  \n '), null);
  assert.equal(unsavedText('Make it bigger'), 'Make it bigger');
  assert.equal(unsavedText('  two  spaces \n'), '  two  spaces \n', 'kept exactly as typed');
  assert.equal(unsavedText('Same', 'Same'), null, 'a thread that was not edited');
  assert.equal(unsavedText(' Same\n', 'Same'), null);
  assert.equal(unsavedText('Same, but shorter', 'Same'), 'Same, but shorter');
  assert.equal(unsavedText('', 'Same'), null, 'an emptied comment cannot be saved, so there is nothing to keep');
});

test('draft store: kept text comes back for the same card until it is dropped', () => {
  const drafts = createDraftStore();
  assert.equal(drafts.get('a'), null);
  drafts.keep('a', 'half a thought');
  assert.equal(drafts.get('a'), 'half a thought');
  assert.equal(drafts.get('a'), 'half a thought', 'reading does not use it up');
  assert.equal(drafts.get('b'), null);
  drafts.drop('a');
  assert.equal(drafts.get('a'), null);
});

test('draft store: closing a card whose text was cleared forgets the older draft', () => {
  const drafts = createDraftStore();
  drafts.keep('a', 'old words');
  drafts.keep('a', null);
  assert.equal(drafts.get('a'), null);
});

test('draft keys: a canvas element is per artboard, a page element is the same at every size, designs never share', () => {
  const at = { slug: 'coffee', screen: 'home', artboard: 'home@laptop', selector: 'main > h1', pageMode: false };
  assert.equal(composerDraftKey(at), composerDraftKey({ ...at }));
  for (const other of [{ slug: 'tea' }, { artboard: 'home@phone' }, { selector: 'main > p' }]) assert.notEqual(composerDraftKey(at), composerDraftKey({ ...at, ...other }));
  const page = { ...at, pageMode: true, screen: null, artboard: 'page@full' };
  assert.equal(composerDraftKey(page), composerDraftKey({ ...page, artboard: 'page@phone' }), 'switching View keeps the draft');
  assert.notEqual(threadDraftKey('coffee', 'c_1'), threadDraftKey('coffee', 'c_2'));
  assert.notEqual(threadDraftKey('coffee', 'c_1'), threadDraftKey('tea', 'c_1'));
});
