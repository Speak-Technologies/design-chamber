import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DesignWarning } from '../../src/shared/types.ts';
import { WARNING_LINES_SHOWN, bandLabel, moreLabel, warningLines } from '../../src/ui/model/design-warnings-model.ts';

const warn = (message: string, code = 'x'): DesignWarning => ({ code, message });

test('no warnings: nothing to show', () => {
  assert.deepEqual(warningLines([]), { all: [], shown: [], more: 0 });
});

test('the service sentences come through word for word, in order', () => {
  const unknown = "The agent asked to add this design to Q4, but there's no folder with that name.";
  const waiting = "Folders couldn't load, so the agent's request wasn't applied.";
  const lines = warningLines([warn(unknown, 'folder-request-unknown'), warn(waiting, 'folder-request-waiting')]);
  assert.deepEqual(lines.all, [unknown, waiting]);
  assert.deepEqual(lines.shown, [unknown, waiting]);
  assert.equal(lines.more, 0);
});

test('empty and repeated sentences are dropped, the rest keep their order', () => {
  const lines = warningLines([warn('  '), warn('A'), warn('B'), warn(' A '), warn('')]);
  assert.deepEqual(lines.all, ['A', 'B']);
});

test('only the first lines show; the count behind "Show N more" is the rest', () => {
  const many = ['one', 'two', 'three', 'four', 'five'].map((line) => warn(line));
  const lines = warningLines(many);
  assert.equal(lines.shown.length, WARNING_LINES_SHOWN);
  assert.deepEqual(lines.shown, ['one', 'two']);
  assert.equal(lines.more, 3);
  assert.equal(lines.all.length, 5);
});

test('the toggle says what it does, both ways', () => {
  assert.equal(moreLabel(3, false), 'Show 3 more');
  assert.equal(moreLabel(3, true), 'Show fewer');
});

test('the region name counts the problems', () => {
  assert.equal(bandLabel(1), 'A problem with this design');
  assert.equal(bandLabel(4), '4 problems with this design');
});
