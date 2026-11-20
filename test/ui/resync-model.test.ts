import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeResyncReview } from '../../src/shared/api.ts';
import {
  GROUP_PAGE,
  NOTHING_TICKED_REASON,
  PARTIAL_NOTE,
  applyBody,
  changeLine,
  changedRows,
  conflictLines,
  conflictRows,
  countsOf,
  defaultTicks,
  failureKind,
  folderInputProblem,
  groupState,
  groupToggleLabel,
  isCodeReview,
  isTicked,
  matchesSentence,
  nothingTicked,
  resyncedSentence,
  reviewGroups,
  reviewIsEmpty,
  scanningLabel,
  selectionLine,
  setGroup,
  setTick,
  swatchable,
} from '../../src/ui/model/resync-model.ts';

const review = (over: Partial<CodeResyncReview> = {}): CodeResyncReview => ({
  kind: 'code',
  changed: [
    { name: '--brand', mode: 'dark', from: '#6fc2ba', to: '#4fd1c5' },
    { name: '--brand', mode: 'light', from: '#2f6f6a', to: '#0b6e66' },
    { name: '--space-4', mode: 'light', from: '16px', to: '20px' },
  ],
  conflicts: [{ name: '--text-muted', mode: 'light', mine: '#5d6a68', code: '#4a5755' }],
  added: ['--accent', '--space-8'],
  removed: ['--danger'],
  assets: [{ path: 'public/logo.svg', kind: 'logo' }],
  partial: false,
  ...over,
});

test('the review is cut into groups in a fixed order, and empty groups are left out', () => {
  assert.deepEqual(reviewGroups(review()).map((group) => group.id), ['changes', 'conflicts', 'add', 'remove', 'assets']);
  assert.deepEqual(reviewGroups(review({ conflicts: [], removed: [], assets: [] })).map((group) => group.id), ['changes', 'add']);
  assert.deepEqual(reviewGroups(review()).map((group) => group.title), ['Changed', 'Conflicts', 'New', 'No longer in the code', 'New fonts and logos']);
});

test('a token that changed in both modes is one row with light first, and one tick', () => {
  const rows = changedRows(review());
  assert.deepEqual(rows.map((row) => row.name), ['--brand', '--space-4']);
  assert.deepEqual(rows[0]?.values.map((value) => value.mode), ['light', 'dark']);
  assert.equal(reviewGroups(review())[0]?.ids.length, 2);
  assert.equal(changeLine(rows[0]!), 'Light: #2f6f6a → #0b6e66 · Dark: #6fc2ba → #4fd1c5');
  assert.equal(changeLine(rows[1]!), '16px → 20px');
});

test('a conflict says what the code now says, in the user’s words', () => {
  const [row] = conflictRows(review());
  assert.deepEqual(conflictLines(row!), ['You changed this here. The code now says #4a5755.']);
  const both = conflictRows(review({ conflicts: [{ name: '--x', mode: 'light', mine: 'a', code: 'b' }, { name: '--x', mode: 'dark', mine: 'c', code: 'd' }] }));
  assert.deepEqual(conflictLines(both[0]!), ['Light: You changed this here. The code now says b.', 'Dark: You changed this here. The code now says d.']);
});

test('what starts ticked: Changed and New on; removals, files and the code’s side of a conflict off', () => {
  const ticks = defaultTicks(review());
  assert.deepEqual([...ticks.changes].sort(), ['--brand', '--space-4']);
  assert.deepEqual([...ticks.add].sort(), ['--accent', '--space-8']);
  assert.equal(ticks.remove.size, 0);
  assert.equal(ticks.assets.size, 0);
  assert.equal(ticks.useCode.size, 0);
  assert.equal(isTicked(ticks, 'conflicts', '--text-muted'), false, 'Keep mine is the default');
});

test('ticking one row, a whole group, and the group button’s words', () => {
  let ticks = defaultTicks(review());
  ticks = setTick(ticks, 'remove', '--danger', true);
  assert.equal(isTicked(ticks, 'remove', '--danger'), true);
  ticks = setTick(ticks, 'changes', '--space-4', false);
  assert.equal(groupState(ticks, 'changes', ['--brand', '--space-4']), 'some');
  assert.equal(groupToggleLabel('changes', 'some'), 'Tick all');
  assert.equal(groupToggleLabel('changes', 'all'), 'Untick all');
  assert.equal(groupToggleLabel('conflicts', 'none'), 'Use all the code’s');
  assert.equal(groupToggleLabel('conflicts', 'all'), 'Keep all mine');
  ticks = setGroup(ticks, 'changes', ['--brand', '--space-4'], true);
  assert.equal(groupState(ticks, 'changes', ['--brand', '--space-4']), 'all');
  ticks = setGroup(ticks, 'conflicts', ['--text-muted'], true);
  assert.equal(isTicked(ticks, 'conflicts', '--text-muted'), true);
  assert.equal(ticks.useCode.has('--text-muted'), true);
  ticks = setTick(ticks, 'conflicts', '--text-muted', false);
  assert.equal(ticks.useCode.size, 0);
});

test('ticking never changes the ticks it was given', () => {
  const first = defaultTicks(review());
  setTick(first, 'remove', '--danger', true);
  setGroup(first, 'add', [], false);
  assert.equal(first.remove.size, 0);
  assert.equal(first.add.size, 2);
});

test('nothing ticked turns Apply off and says why; otherwise it says what Apply saves', () => {
  const none = setGroup(setGroup(defaultTicks(review()), 'changes', [], false), 'add', [], false);
  assert.equal(nothingTicked(none), true);
  assert.deepEqual(selectionLine(none), { text: NOTHING_TICKED_REASON, canApply: false });
  const some = setTick(defaultTicks(review()), 'remove', '--danger', true);
  assert.equal(selectionLine(some).canApply, true);
  assert.match(selectionLine(some).text, /2 changed, 2 added, 1 removed/);
});

test('a conflict settled with the code’s value counts as changed', () => {
  const ticks = setTick(defaultTicks(review()), 'conflicts', '--text-muted', true);
  assert.deepEqual(countsOf(ticks), { changed: 3, added: 2, removed: 0, files: 0 });
});

test('the notice sentence leaves out what is zero', () => {
  assert.equal(resyncedSentence('Acme', { changed: 5, added: 2, removed: 1, files: 0 }), 'Re-synced Acme: 5 changed, 2 added, 1 removed.');
  assert.equal(resyncedSentence('Acme', { changed: 1, added: 0, removed: 0, files: 0 }), 'Re-synced Acme: 1 changed.');
  assert.equal(resyncedSentence('Acme', { changed: 0, added: 0, removed: 0, files: 0 }), 'Re-synced Acme.');
});

test('the request names tokens and paths, sorted, and carries no values', () => {
  let ticks = defaultTicks(review());
  ticks = setTick(ticks, 'remove', '--danger', true);
  ticks = setTick(ticks, 'conflicts', '--text-muted', true);
  ticks = setTick(ticks, 'assets', 'public/logo.svg', true);
  const body = applyBody('sc_1', 'aa:bb', ticks);
  assert.deepEqual(body, {
    scanId: 'sc_1',
    stamp: 'aa:bb',
    changes: ['--brand', '--space-4'],
    add: ['--accent', '--space-8'],
    remove: ['--danger'],
    useCode: ['--text-muted'],
    assets: ['public/logo.svg'],
  });
  assert.equal(JSON.stringify(body).includes('#'), false, 'no value travels');
});

test('an empty review is "already matches"; a partial one with nothing listed is too', () => {
  const empty = review({ changed: [], conflicts: [], added: [], removed: [], assets: [] });
  assert.equal(reviewIsEmpty(empty), true);
  assert.equal(reviewIsEmpty({ ...empty, partial: true }), true);
  assert.equal(reviewIsEmpty(review()), false);
  assert.equal(reviewIsEmpty(review({ changed: [], conflicts: [], added: [], assets: [] })), false, 'a removal alone is something to review');
  assert.equal(matchesSentence('Acme', 'shop'), 'Acme already matches shop.');
  assert.equal(reviewGroups(empty).length, 0);
});

test('a partial scan: the note is the service’s sentence, and the model never invents removals', () => {
  assert.equal(PARTIAL_NOTE, 'Some files weren’t scanned, so tokens from them aren’t listed as removed.');
  const partial = review({ partial: true, removed: [] });
  assert.equal(reviewGroups(partial).some((group) => group.id === 'remove'), false);
});

test('a long group is paged, and the tick lists still cover every row', () => {
  const many = Array.from({ length: GROUP_PAGE + 25 }, (_, n) => `--gone-${n}`);
  const big = review({ removed: many });
  const group = reviewGroups(big).find((one) => one.id === 'remove');
  assert.equal(group?.ids.length, many.length);
  const ticks = setGroup(defaultTicks(big), 'remove', group?.ids ?? [], true);
  assert.equal(applyBody('s', 'a:b', ticks).remove?.length, many.length);
});

test('how a stop is told apart', () => {
  assert.equal(failureKind('conflict', 'Your Designs folder changed. Nothing was changed.'), 'root-changed');
  assert.equal(failureKind('conflict', 'Acme changed after the scan, so nothing was changed. Scan again.'), 'stale');
  assert.equal(failureKind('conflict', 'That scan was made for another design system. Scan again.'), 'stale');
  assert.equal(failureKind('not-found', 'That scan is no longer available. Scan the folder again.'), 'stale');
  assert.equal(failureKind('bad-path', "Design Chamber can't read C:\\work\\shop. The folder doesn't exist."), 'folder');
  assert.equal(failureKind(null, 'Design Chamber can’t read C:\\work\\shop. Permission denied.'), 'folder');
  assert.equal(failureKind('internal', 'The service did not answer. Try again.'), 'plain');
});

test('the folder typed to read instead must be a full path', () => {
  assert.equal(folderInputProblem('   '), 'Type the full path of the folder.');
  assert.match(folderInputProblem('shop') ?? '', /full path/);
  assert.equal(folderInputProblem('C:\\work\\shop'), null);
  assert.equal(folderInputProblem('/Users/you/shop'), null);
  assert.equal(folderInputProblem('\\\\server\\share\\shop'), null);
});

test('the scanning line', () => {
  assert.equal(scanningLabel('shop', 0), 'Reading shop…');
  assert.equal(scanningLabel('shop', 1), 'Reading shop… 1 file looked at');
  assert.equal(scanningLabel('shop', 480), 'Reading shop… 480 files looked at');
});

test('only a real colour gets a swatch', () => {
  assert.equal(swatchable('#0b6e66'), true);
  assert.equal(swatchable('16px'), false);
  assert.equal(swatchable(''), false);
  assert.equal(swatchable('url(javascript:alert(1))'), false);
});

test('the repo flavour is told apart from the code one (the seam for U6)', () => {
  assert.equal(isCodeReview(review()), true);
  assert.equal(isCodeReview({ kind: 'repo' } as never), false);
});
