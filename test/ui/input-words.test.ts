// What the wall, the ask bar and the text box say about input (src/ui/model/input-words.ts): a
// phone has no Ctrl, Shift, Esc, Space or arrow keys, so nothing said there may name one.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLICK_AWAY_LINE } from '../../src/ui/model/edit-text-model.ts';
import { inputWords } from '../../src/ui/model/input-words.ts';

const KEYS = /Ctrl|⌘|Shift|\bEsc\b|Escape|Space|[Aa]rrow|Page Up|Page Down|plus and minus|Enter/;

test('on a phone none of the sentences names a key', () => {
  for (const [name, sentence] of Object.entries(inputWords('phone'))) {
    assert.ok(sentence.length > 0, name);
    assert.doesNotMatch(sentence, KEYS, name);
    assert.equal(sentence.includes('—'), false, name);
  }
});

test('the phone’s click-away line names the two buttons it has', () => {
  assert.match(inputWords('phone').editClickAway, /Save/);
  assert.match(inputWords('phone').editClickAway, /Cancel/);
});

test('desktop and tablet keep the keyboard sentences', () => {
  for (const form of ['desktop', 'tablet'] as const) {
    const words = inputWords(form);
    assert.equal(words.editClickAway, CLICK_AWAY_LINE);
    assert.equal(words.fit, 'Fit everything on screen (Shift+1)');
    assert.equal(words.askBar, 'Enter sends, Shift+Enter adds a line.');
    assert.equal(words.wall, 'Design wall. Arrow keys pan, plus and minus zoom, Shift+1 fits everything. Hold Space and drag to pan.');
    assert.equal(words.page, 'Page preview. Arrow keys, Page Up and Page Down scroll the page.');
  }
});
