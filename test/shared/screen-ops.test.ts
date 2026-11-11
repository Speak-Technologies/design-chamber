// Pure screen-list planning (Phase 2 technical design §5.2, §6.1, §17): which raw entries are the
// listed screens, reorder that keeps every other raw entry where it is, free copy ids inside the
// id pattern, the copy's raw entry, removal, and the notice's description of a move.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeDesign } from '../../src/shared/design-json.ts';
import { SCREEN_ID_PATTERN, SCREENS_MAX, TITLE_MAX } from '../../src/shared/limits.ts';
import {
  copyTitle,
  describeMove,
  directionGroups,
  duplicateRaw,
  freeCopyId,
  listedSlots,
  removeRaw,
  reorderRaw,
} from '../../src/shared/screen-ops.ts';
import type { JsonValue } from '../../src/shared/types.ts';

const normalisedIds = (screens: JsonValue[]): string[] =>
  normalizeDesign({ kind: 'canvas', screens }, { kind: 'canvas', fallbackTitle: 'x', fallbackTime: '2026-11-11T00:00:00.000Z' }).design.screens.map((screen) => screen.id);

/** A raw list with every kind of entry the normaliser drops between the listed ones. */
const MESSY: JsonValue[] = [
  { id: 'home', title: 'Home', file: 'screens/home.html', note: 'agent key' },
  'not an entry',
  { id: 'Bad Id', title: 'Broken' },
  { id: 'pricing', title: 'Pricing', direction: { of: 'home', letter: 'A', name: 'Bold' } },
  { id: 'checkout', file: 'screens/elsewhere.html' },
  { id: 'checkout', title: 'Checkout' },
  { id: 'home', title: 'Home again' },
  null,
];

describe('listedSlots', () => {
  test('answers the raw index of each listed screen, agreeing with the normaliser', () => {
    assert.deepEqual(listedSlots(MESSY), [
      { index: 0, id: 'home' },
      { index: 3, id: 'pricing' },
      { index: 5, id: 'checkout' },
    ]);
    assert.deepEqual(listedSlots(MESSY).map((slot) => slot.id), normalisedIds(MESSY));
  });

  test('stops at the screen cap like the normaliser', () => {
    const many: JsonValue[] = Array.from({ length: SCREENS_MAX + 2 }, (_, n) => ({ id: `s${n}` }));
    const slots = listedSlots(many);
    assert.equal(slots.length, SCREENS_MAX);
    assert.deepEqual(slots.map((slot) => slot.id), normalisedIds(many));
  });
});

describe('reorderRaw', () => {
  test('permutes only the listed entries, verbatim; every dropped entry keeps its index', () => {
    const next = reorderRaw(MESSY, ['checkout', 'home', 'pricing']);
    assert.ok(next);
    assert.deepEqual(next, [MESSY[5], MESSY[1], MESSY[2], MESSY[0], MESSY[4], MESSY[3], MESSY[6], MESSY[7]]);
    assert.deepEqual(normalisedIds(next), ['checkout', 'home', 'pricing']);
    assert.notEqual(next, MESSY, 'a new array; the input is not touched');
    assert.deepEqual(MESSY[0], { id: 'home', title: 'Home', file: 'screens/home.html', note: 'agent key' });
  });

  test('refuses an order that is not exactly the listed ids once each', () => {
    assert.equal(reorderRaw(MESSY, ['home', 'pricing']), null);
    assert.equal(reorderRaw(MESSY, ['home', 'pricing', 'checkout', 'extra']), null);
    assert.equal(reorderRaw(MESSY, ['home', 'home', 'pricing']), null);
    assert.equal(reorderRaw(MESSY, ['home', 'pricing', 'Bad Id']), null);
  });
});

describe('describeMove', () => {
  test('one screen moved: which one and what it now sits above (null at the end)', () => {
    assert.deepEqual(describeMove(['a', 'b', 'c', 'd'], ['a', 'd', 'b', 'c']), { moved: 'd', above: 'b' });
    assert.deepEqual(describeMove(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a']), { moved: 'a', above: null });
    assert.deepEqual(describeMove(['a', 'b', 'c'], ['b', 'a', 'c']), { moved: 'a', above: 'c' }, 'an adjacent swap names the first in the old order');
  });

  test('several moved, or nothing moved: null', () => {
    assert.equal(describeMove(['a', 'b', 'c', 'd'], ['b', 'a', 'd', 'c']), null);
    assert.equal(describeMove(['a', 'b', 'c'], ['a', 'b', 'c']), null);
  });
});

describe('freeCopyId', () => {
  test('<id>-copy, then -copy-2, -copy-3…', () => {
    assert.equal(freeCopyId('home', new Set(['home'])), 'home-copy');
    assert.equal(freeCopyId('home', new Set(['home', 'home-copy'])), 'home-copy-2');
    assert.equal(freeCopyId('home', new Set(['home', 'home-copy', 'home-copy-2'])), 'home-copy-3');
  });

  test('at the 41-character edge the base is cut so the id still fits the pattern', () => {
    const long = 'a'.repeat(41);
    const copy = freeCopyId(long, new Set([long]));
    assert.equal(copy, `${'a'.repeat(36)}-copy`);
    assert.match(copy ?? '', SCREEN_ID_PATTERN);
    const edge = 'a'.repeat(36);
    assert.equal(freeCopyId(edge, new Set([edge])), `${edge}-copy`, 'exactly 41 characters fits');
    const second = freeCopyId(long, new Set([long, `${'a'.repeat(36)}-copy`]));
    assert.equal(second, `${'a'.repeat(34)}-copy-2`);
    assert.match(second ?? '', SCREEN_ID_PATTERN);
  });

  test('a cut that ends on "-" is trimmed', () => {
    const id = `${'a'.repeat(35)}-bbbbb`;
    assert.equal(freeCopyId(id, new Set([id])), `${'a'.repeat(35)}-copy`);
  });
});

describe('the copy and removal', () => {
  test('copyTitle stays inside TITLE_MAX', () => {
    assert.equal(copyTitle('Home'), 'Home copy');
    const title = copyTitle('x'.repeat(TITLE_MAX));
    assert.equal(title.length, TITLE_MAX);
    assert.ok(title.endsWith(' copy'));
  });

  test('duplicateRaw inserts a clone right after the original: id, file and title replaced, direction removed, the rest kept', () => {
    const raw: JsonValue[] = [
      { id: 'home', title: 'Home' },
      { id: 'pricing', title: 'Pricing', viewports: ['laptop'], description: 'Plans', direction: { of: 'home', letter: 'A', name: 'Bold' }, extra: 1 },
      'junk',
    ];
    const next = duplicateRaw(raw, 'pricing', 'pricing-copy', 'Pricing copy');
    assert.deepEqual(next, [
      raw[0],
      raw[1],
      { id: 'pricing-copy', title: 'Pricing copy', viewports: ['laptop'], description: 'Plans', extra: 1, file: 'screens/pricing-copy.html' },
      'junk',
    ]);
    assert.equal(duplicateRaw(raw, 'nope', 'nope-copy', 'x'), null);
  });

  test('removeRaw drops every entry carrying a named id (a hidden duplicate must not come back as the screen); the rest stays', () => {
    const next = removeRaw(MESSY, new Set(['home', 'checkout']));
    assert.deepEqual(next, [MESSY[1], MESSY[2], MESSY[3], MESSY[7]]);
    assert.deepEqual(normalisedIds(next), ['pricing']);
  });

  test('directionGroups is re-exported from design-json', () => {
    assert.equal(typeof directionGroups, 'function');
  });
});
