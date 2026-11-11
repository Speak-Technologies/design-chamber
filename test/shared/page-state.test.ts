// Saved page data, pure rules (Phase 2 technical design §8.1, §8.2): the file parser that turns a
// hostile or hand-edited page-state.json into "no data", the delta validator, the cap (keys plus
// values in UTF-16 code units, all or nothing), and the gen rule that keeps a Clear from coming back.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PAGE_STATE_CHANGES_MAX, PAGE_STATE_MAX_CHARS } from '../../src/shared/limits.ts';
import {
  applyPageStateDelta,
  formatGen,
  isOlderClear,
  PAGE_STATE_GEN_MAX,
  pageStateChars,
  parseGen,
  parsePageStateDelta,
  parsePageStateFile,
  serializePageStateFile,
} from '../../src/shared/page-state.ts';

const file = (items: unknown, extra: Record<string, unknown> = {}): string => JSON.stringify({ v: 1, updated: '2026-11-11T00:00:00.000Z', items, ...extra });

describe('parsePageStateFile: only the exact shape reads as data', () => {
  test('pairs in order, with the character count', () => {
    const parsed = parsePageStateFile(file([['checklist:done', '[1,3,4]'], ['theme', 'dark']]));
    assert.ok(parsed);
    assert.deepEqual([...parsed.items], [['checklist:done', '[1,3,4]'], ['theme', 'dark']]);
    assert.equal(parsed.chars, 'checklist:done'.length + '[1,3,4]'.length + 'theme'.length + 'dark'.length);
  });

  test('prototype-looking and numeric keys are plain data', () => {
    const parsed = parsePageStateFile(file([['__proto__', 'x'], ['constructor', 'y'], ['1', 'z']]));
    assert.ok(parsed);
    assert.equal(parsed.items.get('__proto__'), 'x');
    assert.deepEqual([...parsed.items.keys()], ['__proto__', 'constructor', '1']);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
  });

  test('a repeated key keeps its first value and costs nothing more', () => {
    const parsed = parsePageStateFile(file([['a', '1'], ['a', '22222']]));
    assert.ok(parsed);
    assert.equal(parsed.items.get('a'), '1');
    assert.equal(parsed.chars, 2);
  });

  test('every malformed or hostile shape reads as no data', () => {
    const cases: [string, string][] = [
      ['not JSON', '{"v":1,"items":[['],
      ['empty file', ''],
      ['a list at the top', '[]'],
      ['null', 'null'],
      ['another version', JSON.stringify({ v: 2, items: [] })],
      ['no version', JSON.stringify({ items: [] })],
      ['items an object', JSON.stringify({ v: 1, items: { a: 'b' } })],
      ['a three-element entry', file([['a', 'b', 'c']])],
      ['a one-element entry', file([['a']])],
      ['a number value', file([['a', 1]])],
      ['a null value', file([['a', null]])],
      ['a number key', file([[1, 'a']])],
      ['an object entry', file([{ key: 'a', value: 'b' }])],
    ];
    for (const [label, text] of cases) assert.equal(parsePageStateFile(text), null, label);
  });

  test('the cap: exactly at it reads; one character over is no data', () => {
    const atCap = file([['k', 'v'.repeat(PAGE_STATE_MAX_CHARS - 1)]]);
    assert.equal(parsePageStateFile(atCap)?.chars, PAGE_STATE_MAX_CHARS);
    assert.equal(parsePageStateFile(file([['k', 'v'.repeat(PAGE_STATE_MAX_CHARS)]])), null);
    // Counted in UTF-16 code units, like browsers: an emoji is two.
    assert.equal(parsePageStateFile(file([['k', '😀']]))?.chars, 3);
    assert.equal(parsePageStateFile(file([['k', '😀']]), 2), null);
  });

  test('serialize then parse keeps the pairs and their order', () => {
    const items = new Map([['z', '1'], ['a', 'two'], ['__proto__', 'three'], ['', 'empty key']]);
    const text = serializePageStateFile(items, '2026-11-11T00:00:00.000Z');
    assert.deepEqual(JSON.parse(text), { v: 1, updated: '2026-11-11T00:00:00.000Z', items: [...items] });
    assert.deepEqual([...(parsePageStateFile(text)?.items ?? [])], [...items]);
    assert.equal(pageStateChars(items), pageStateChars(parsePageStateFile(text)?.items ?? []));
  });
});

describe('parsePageStateDelta: the request shape', () => {
  test('clear and changes are both optional', () => {
    assert.deepEqual(parsePageStateDelta(undefined, undefined), { clear: false, changes: [] });
    assert.deepEqual(parsePageStateDelta(true, [['a', 'b'], ['c', null]]), { clear: true, changes: [['a', 'b'], ['c', null]] });
  });

  test('every malformed shape is refused', () => {
    const cases: [string, unknown, unknown][] = [
      ['clear as a string', 'yes', []],
      ['clear as a number', 1, []],
      ['changes an object', false, { a: 'b' }],
      ['a three-element change', false, [['a', 'b', 'c']]],
      ['a number value', false, [['a', 1]]],
      ['a number key', false, [[1, 'a']]],
      ['a missing value', false, [['a']]],
      ['too many changes', false, Array.from({ length: PAGE_STATE_CHANGES_MAX + 1 }, (_, i) => [`k${i}`, 'v'])],
    ];
    for (const [label, clear, changes] of cases) assert.equal(parsePageStateDelta(clear, changes), null, label);
    assert.ok(parsePageStateDelta(false, Array.from({ length: PAGE_STATE_CHANGES_MAX }, (_, i) => [`k${i}`, 'v'])));
  });
});

describe('applyPageStateDelta: clear first, then changes in order, all or nothing at the cap', () => {
  test('sets, replaces and removes; null removes', () => {
    const items = new Map([['a', '1'], ['b', '2']]);
    const outcome = applyPageStateDelta(items, 4, { clear: false, changes: [['a', '11'], ['b', null], ['c', '3']] });
    assert.deepEqual(outcome, { ok: true, chars: 3 + 2, changed: true });
    assert.deepEqual([...items], [['a', '11'], ['c', '3']]);
  });

  test('clear runs before the changes of the same delta', () => {
    const items = new Map([['a', '1'], ['b', '2']]);
    const outcome = applyPageStateDelta(items, 4, { clear: true, changes: [['b', 'new']] });
    assert.deepEqual(outcome, { ok: true, chars: 4, changed: true });
    assert.deepEqual([...items], [['b', 'new']]);
  });

  test('a removed-then-set key moves to the end, as in order', () => {
    const items = new Map([['a', '1'], ['b', '2']]);
    applyPageStateDelta(items, 4, { clear: false, changes: [['a', null], ['a', '9']] });
    assert.deepEqual([...items], [['b', '2'], ['a', '9']]);
  });

  test('exactly at the cap is accepted; one over applies nothing at all', () => {
    const items = new Map([['keep', 'me']]);
    const room = PAGE_STATE_MAX_CHARS - 6;
    const fits = applyPageStateDelta(items, 6, { clear: false, changes: [['k', 'v'.repeat(room - 1)]] });
    assert.deepEqual(fits, { ok: true, chars: PAGE_STATE_MAX_CHARS, changed: true });

    // One character over, from empty: refused.
    const empty = new Map<string, string>();
    assert.deepEqual(applyPageStateDelta(empty, 0, { clear: false, changes: [['k', 'v'.repeat(PAGE_STATE_MAX_CHARS)]] }), { ok: false, chars: 0 });
    assert.equal(empty.size, 0);

    const before = [...items];
    const over = applyPageStateDelta(items, PAGE_STATE_MAX_CHARS, { clear: false, changes: [['small', 'ok'], ['x', 'y']] });
    assert.deepEqual(over, { ok: false, chars: PAGE_STATE_MAX_CHARS });
    assert.deepEqual([...items], before, 'nothing of the refused delta was applied, not even the first change');
  });

  test('the total is the net result: shrinking one key makes room for another in the same delta', () => {
    const items = new Map([['big', 'x'.repeat(PAGE_STATE_MAX_CHARS - 3)]]);
    const outcome = applyPageStateDelta(items, PAGE_STATE_MAX_CHARS, { clear: false, changes: [['other', 'y'.repeat(100)], ['big', 'x']] });
    assert.deepEqual(outcome, { ok: true, chars: 4 + 105, changed: true });
    // A later change to a key replaces an earlier one in the count: a huge value then a small one fits.
    const fresh = new Map<string, string>();
    assert.equal(applyPageStateDelta(fresh, 0, { clear: false, changes: [['k', 'x'.repeat(PAGE_STATE_MAX_CHARS)], ['k', 'x']] }).ok, true);
    assert.equal(fresh.get('k'), 'x');
  });

  test('a clear makes room: over the cap only counts what stays', () => {
    const items = new Map([['big', 'x'.repeat(PAGE_STATE_MAX_CHARS - 3)]]);
    const outcome = applyPageStateDelta(items, PAGE_STATE_MAX_CHARS, { clear: true, changes: [['new', 'y'.repeat(1000)]] });
    assert.deepEqual(outcome, { ok: true, chars: 1003, changed: true });
  });

  test('a retried delta changes nothing (idempotent, so not written or announced again)', () => {
    const items = new Map([['a', '1']]);
    assert.deepEqual(applyPageStateDelta(items, 2, { clear: false, changes: [['a', '1'], ['gone', null]] }), { ok: true, chars: 2, changed: false });
    assert.deepEqual(applyPageStateDelta(new Map(), 0, { clear: true, changes: [] }), { ok: true, chars: 0, changed: false });
  });
});

describe('gen: a PATCH older than a Clear is refused, another epoch is not', () => {
  test('format and parse', () => {
    assert.equal(formatGen('3f1c2a9e-7b1d-4c55-9f0e-1a2b3c4d5e6f', 2), '3f1c2a9e-7b1d-4c55-9f0e-1a2b3c4d5e6f:2');
    assert.deepEqual(parseGen('abc:0'), { epoch: 'abc', clears: 0 });
    assert.deepEqual(parseGen('abc:12'), { epoch: 'abc', clears: 12 });
  });

  test('parseGen refuses everything else', () => {
    for (const bad of [undefined, null, 3, '', 'abc', 'abc:', ':1', 'abc:-1', 'abc:01', 'abc:1.5', 'a:b:1', 'abc:1 ', ' abc:1', `${'e'.repeat(PAGE_STATE_GEN_MAX)}:1`, 'abc:99999999999999999']) {
      assert.equal(parseGen(bad), null, String(bad));
    }
  });

  test('isOlderClear: same epoch and fewer clears only', () => {
    assert.equal(isOlderClear('e:0', 'e:1'), true);
    assert.equal(isOlderClear('e:4', 'e:9'), true);
    assert.equal(isOlderClear('e:1', 'e:1'), false, 'the same gen');
    assert.equal(isOlderClear('e:2', 'e:1'), false, 'newer than the service (impossible, accepted)');
    assert.equal(isOlderClear('old:0', 'e:5'), false, 'another epoch: the service restarted since');
    assert.equal(isOlderClear('garbage', 'e:1'), false);
    assert.equal(isOlderClear('e:0', 'garbage'), false);
  });
});
