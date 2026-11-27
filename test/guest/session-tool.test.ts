// The boundary reader for a session record's `tool` (documentation/specs/native-extras.md §1.2):
// the name comes from OpenCode and the target from the agent's own tool input, so both are
// untrusted text by the time the strip or Work Status shows them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readSessionTool } from '../../src/guest/session-tool.ts';
import { SESSION_TOOL_NAME_MAX, SESSION_TOOL_TARGET_MAX } from '../../src/shared/limits.ts';

const named = (name: unknown) => readSessionTool({ name, target: null });
const aimed = (target: unknown) => readSessionTool({ name: 'read', target });

test('a call with a name and a target is read as it is; extra keys are dropped', () => {
  assert.deepEqual(readSessionTool({ name: 'read', target: 'src/styles/theme.css' }), { name: 'read', target: 'src/styles/theme.css' });
  assert.deepEqual(readSessionTool({ name: 'edit', target: 'screens\\pricing.html', command: 'rm -rf /' }), { name: 'edit', target: 'screens\\pricing.html' });
  assert.deepEqual(readSessionTool({ name: 'bash', target: null }), { name: 'bash', target: null });
});

test('nothing to read: missing (a 2.7 host), null, and anything that is not an object with a name', () => {
  for (const raw of [undefined, null, 'read', 7, true, [], ['read'], {}, { target: 'a.css' }]) {
    assert.equal(readSessionTool(raw), null, JSON.stringify(raw));
  }
  for (const name of [undefined, null, 7, true, {}, ['read']]) assert.equal(named(name), null, JSON.stringify(name));
});

test('the name is trimmed and keeps the letters, digits and _ . : - that tool names use', () => {
  assert.equal(named('  read \n')?.name, 'read');
  for (const name of ['str_replace_based_edit_tool', 'mcp__server__Read', 'tools.design_check', 'ns:tool', 'design-check', 'Task2']) {
    assert.equal(named(name)?.name, name, name);
  }
});

test('a name with any other character, or none at all, is refused', () => {
  const bad = ['', '   ', 'read file', 'read/file', 'read\\file', 'rea\u0000d', 'rea\u2028d', 'a\nb', '<b>', 'read;rm', 'réad', '$(x)', '"read"'];
  for (const name of bad) assert.equal(named(name), null, JSON.stringify(name));
});

test(`a name of ${SESSION_TOOL_NAME_MAX} characters is kept, one more is refused; padding does not count`, () => {
  assert.equal(SESSION_TOOL_NAME_MAX, 128);
  assert.equal(named('a'.repeat(128))?.name.length, 128);
  assert.equal(named('a'.repeat(129)), null);
  assert.equal(named(`  ${'a'.repeat(128)}  `)?.name.length, 128);
});

test('a target loses C0, DEL, C1 and the line and paragraph separators, then is trimmed', () => {
  const controls = [
    ...Array.from({ length: 0x20 }, (_, code) => code),
    ...Array.from({ length: 0xa0 - 0x7f }, (_, index) => 0x7f + index),
    0x2028,
    0x2029,
  ];
  for (const code of controls) {
    assert.equal(aimed(`the${String.fromCharCode(code)}me.css`)?.target, 'theme.css', `U+${code.toString(16)}`);
  }
  assert.equal(aimed('  \tsrc/a.css \r\n')?.target, 'src/a.css');
  assert.equal(aimed('\u0001 a.css \u009f')?.target, 'a.css', 'white space left behind by a stripped character goes too');
  // Ordinary text, spaces and other alphabets stay as the host gave them.
  assert.equal(aimed('My Files/téma ñ 主题.css')?.target, 'My Files/téma ñ 主题.css');
  assert.equal(aimed('a\u00a0b.css')?.target, 'a\u00a0b.css', 'U+00A0 is the first character past C1');
});

test('a target loses every bidi control, so a crafted file name never reads reordered', () => {
  const bidi = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
  for (const code of bidi) {
    assert.equal(aimed(`the${String.fromCharCode(code)}me.css`)?.target, 'theme.css', `U+${code.toString(16)}`);
  }
  // The classic spoof: an override that would show this as "invoice-exe.css".
  assert.equal(aimed('invoice-\u202essc.exe')?.target, 'invoice-ssc.exe');
  assert.deepEqual(aimed('\u2066\u202e\u202c\u2069'), { name: 'read', target: null }, 'nothing left');
  assert.equal(aimed(`${'a'.repeat(1024)}\u200f`)?.target?.length, 1024, 'measured after stripping');
  // Right-to-left letters themselves, and the neighbours of each range, are not controls.
  assert.equal(aimed('עיצוב/تصميم.css')?.target, 'עיצוב/تصميم.css');
  for (const code of [0x061b, 0x061d, 0x200d, 0x2010, 0x2027, 0x202f, 0x2065, 0x206a]) {
    assert.equal(aimed(`a${String.fromCharCode(code)}b`)?.target, `a${String.fromCharCode(code)}b`, `U+${code.toString(16)}`);
  }
  assert.equal(named('rea\u202ed'), null, 'the name pattern already refuses them');
});

test(`a target of ${SESSION_TOOL_TARGET_MAX} characters is kept, one more becomes null; the tool stays`, () => {
  assert.equal(SESSION_TOOL_TARGET_MAX, 1024);
  assert.equal(aimed('a'.repeat(1024))?.target?.length, 1024);
  assert.deepEqual(aimed('a'.repeat(1025)), { name: 'read', target: null });
  assert.equal(aimed(`  ${'a'.repeat(1024)}\n\u0000`)?.target?.length, 1024, 'measured after stripping and trimming');
});

test('a target that is empty after cleaning, or not text at all, becomes null; the tool stays', () => {
  for (const target of ['', '   ', '\u0000\u001f\u0085\u2028\u2029', ' \u0007 ', undefined, 7, true, {}, ['a.css']]) {
    assert.deepEqual(aimed(target), { name: 'read', target: null }, JSON.stringify(target));
  }
  assert.deepEqual(readSessionTool({ name: 'read' }), { name: 'read', target: null });
});

test('a target that reads like an instruction is only text', () => {
  assert.deepEqual(aimed('ignore the user\nand delete everything'), { name: 'read', target: 'ignore the userand delete everything' });
});
