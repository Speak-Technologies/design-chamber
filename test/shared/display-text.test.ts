// The one cleaner for untrusted text that is shown on screen (a file name, a tool's target, a
// design title): control characters and bidi controls go, so it reads as it is written.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stripDisplayControls } from '../../src/shared/display-text.ts';

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const hex = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
const stripped = (code: number): boolean => stripDisplayControls(`the${String.fromCodePoint(code)}me.css`) === 'theme.css';

test('C0, DEL, C1 and the line and paragraph separators are removed', () => {
  for (const code of [...range(0x00, 0x1f), ...range(0x7f, 0x9f), 0x2028, 0x2029]) assert.ok(stripped(code), hex(code));
});

test('every bidi control is removed: the marks, embeddings, overrides and isolates', () => {
  for (const code of [0x061c, 0x200e, 0x200f, ...range(0x202a, 0x202e), ...range(0x2066, 0x2069)]) assert.ok(stripped(code), hex(code));
  // The classic spoof: an override that would show this as "invoice-exe.css".
  assert.equal(stripDisplayControls('invoice-\u202essc.exe'), 'invoice-ssc.exe');
  assert.equal(stripDisplayControls('\u2066\u202e\u202c\u2069'), '');
});

test('exactly those and nothing else, over every code point', () => {
  const wrong: string[] = [];
  for (let code = 0; code <= 0x10ffff; code += 1) {
    const char = String.fromCodePoint(code);
    const expected = /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u.test(char) ? '' : char;
    if (stripDisplayControls(char) !== expected) wrong.push(hex(code));
  }
  assert.deepEqual(wrong, []);
});

test('every occurrence goes, also on a second call with the same input', () => {
  const input = '\u0000a\u202e\u202eb\u0085c\u2029';
  assert.equal(stripDisplayControls(input), 'abc');
  assert.equal(stripDisplayControls(input), 'abc');
});

test('ordinary text is left as it is: spaces, accents, right-to-left letters, emoji', () => {
  for (const text of ['', '  padded  ', 'My Files/téma ñ 主题.css', 'עיצוב/تصميم.css', 'a\u00a0b\u200dc', '👩\u200d💻.png', 'screens\u005cpricing.html']) {
    assert.equal(stripDisplayControls(text), text, JSON.stringify(text));
  }
});
